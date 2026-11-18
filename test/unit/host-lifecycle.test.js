'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const {
  PATCH_MARKER,
  LEGACY_UTILS_V5_BLOCK,
  LEGACY_MAIN_V5_BLOCK,
  LEGACY_PRELOAD_V5_BLOCK,
  UTILS_ANCHOR_TARGET,
  MAIN_ANCHOR_TARGET,
  PRELOAD_ANCHOR_TARGET,
  computeIntegrity,
  isAsarPatchedFast,
  verifyPureOrigArchive,
  patchAsarOnDisk,
  probeAsarReplaceableFast,
} = require('../../host/ensure_statusbar_patch');
const {
  buildSentinelIpcEndpoint,
  formatWatcherPidRecord,
  stopWatcherSentinel,
} = require('../../host/process-sentinel');
const {
  probeLocalLlmServer,
  ensureLocalLlmServer,
  stopLocalLlmServer,
} = require('../../host/local-llm-daemon');
const {
  syncCombinedAutoinject,
} = require('../../host/bundle-injector');
const {
  updateTranslatorSettings,
} = require('../../host/config-store');
const {
  runStorageWatcherLoop,
  runRollback,
} = require('../../host/cli');

function buildSyntheticAsarBuffer({
  appVersion = '2.33.0',
  utilsBody = null,
  mainBody = null,
  preloadBody = null,
} = {}) {
  const paddingComments = Array.from(
    { length: 45 },
    (_, i) => `// padding comment line ${i} to provide ample headroom for exact-size transform`
  ).join('\n');

  const pkgBuf = Buffer.from(JSON.stringify({ name: 'antigravity', version: appVersion }, null, 2), 'utf8');
  const uBuf = Buffer.from(
    utilsBody ||
      `"use strict";\n${paddingComments}\nfunction makeWin(opts) {\n  ${UTILS_ANCHOR_TARGET}\n  return opts;\n}\nmodule.exports = { makeWin };\n`,
    'utf8'
  );
  const mBuf = Buffer.from(
    mainBody ||
      `"use strict";\n${paddingComments}\nfunction bootMain(win) {\n  ${MAIN_ANCHOR_TARGET}\n    void contents;\n  });\n  return win;\n}\nmodule.exports = { bootMain };\n`,
    'utf8'
  );
  const pBuf = Buffer.from(
    preloadBody ||
      `"use strict";\n${PRELOAD_ANCHOR_TARGET}\n${paddingComments}\nconst preloadReady = true;\nmodule.exports = { preloadReady };\n`,
    'utf8'
  );

  const files = [
    ['package.json', pkgBuf],
    ['dist/utils.js', uBuf],
    ['dist/main.js', mBuf],
    ['dist/preload.js', pBuf],
  ];

  const headerObj = { files: {} };
  let offset = 0n;
  const chunks = [];
  for (const [rel, buf] of files) {
    const meta = {
      size: buf.length,
      offset: offset.toString(),
      integrity: computeIntegrity(buf),
    };
    if (rel.startsWith('dist/')) {
      if (!headerObj.files.dist) headerObj.files.dist = { files: {} };
      headerObj.files.dist.files[rel.slice(5)] = meta;
    } else {
      headerObj.files[rel] = meta;
    }
    chunks.push(buf);
    offset += BigInt(buf.length);
  }

  const headerStrBuf = Buffer.from(JSON.stringify(headerObj), 'utf8');
  const strSize = headerStrBuf.length;
  const alignedStrSize = Math.ceil(strSize / 4) * 4;
  const u8 = 4 + alignedStrSize;
  const u4 = 4 + u8;
  const headerBuf = Buffer.alloc(8 + u4, 0);
  headerBuf.writeUInt32LE(4, 0);
  headerBuf.writeUInt32LE(u4, 4);
  headerBuf.writeUInt32LE(u8, 8);
  headerBuf.writeUInt32LE(strSize, 12);
  headerStrBuf.copy(headerBuf, 16);

  return Buffer.concat([headerBuf, ...chunks]);
}

function makeTempHostEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ko-host-test-'));
  const agyDir = path.join(dir, '.antigravity');
  const resourcesDir = path.join(dir, 'resources');
  fs.mkdirSync(agyDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const pathsObj = {
    AGY_DIR: agyDir,
    ASAR_PATH: path.join(resourcesDir, 'app.asar'),
    AUTOINJECT_PATH: path.join(agyDir, 'statusbar_autoinject.js'),
    STATUSBAR_AUTOINJECT_PATH: path.join(agyDir, 'statusbar_autoinject.js'),
    STATUSBAR_AUTOINJECT_LOCK_PATH: path.join(agyDir, 'statusbar_autoinject.lock'),
    APP_STORAGE_PATH: path.join(agyDir, 'app_storage.json'),
    APP_STORAGE_LOCK_PATH: path.join(agyDir, 'app_storage.lock'),
    SETTINGS_SSOT_PATH: path.join(agyDir, 'ko_translator_settings.json'),
    SETTINGS_LOCK_PATH: path.join(agyDir, 'ko_translator_settings.lock'),
    STATUS_PATH: path.join(agyDir, 'statusbar_patch_status.json'),
    LOCK_PATH: path.join(agyDir, 'statusbar_patch.lock'),
    WATCHER_PID_PATH: path.join(agyDir, 'ko_storage_watcher.pid'),
    WATCHER_LOCK_PATH: path.join(agyDir, 'ko_storage_watcher.pid.lock'),
    LLM_PID_PATH: path.join(agyDir, 'local_llm_server.json'),
    DEVTOOLS_PORT_FILE: path.join(agyDir, 'DevToolsActivePort'),
    CUSTOMIZATIONS_CONFIG_PATH: path.join(dir, 'customizations.json'),
  };
  return { dir, pathsObj };
}

test('Host Lifecycle (V6 ASAR Patcher & Rev7-F4 #1): Case A pure -> .orig + .orig.json, Case B backfill & packed integrity.hash corruption check, Case C V5->V6 upgrade & V4 fail-closed', () => {
  const { dir, pathsObj } = makeTempHostEnv();
  try {
    assert.equal(isAsarPatchedFast(pathsObj.ASAR_PATH), false, 'Missing ASAR must return false');

    fs.writeFileSync(pathsObj.STATUSBAR_AUTOINJECT_PATH, '// autoinject stub\n', 'utf8');
    fs.writeFileSync(pathsObj.APP_STORAGE_PATH, '{}', 'utf8');

    // Case A: Pure unpatched ASAR -> creates `.orig` + `.orig.json` and patches exact size!
    const pureBuf = buildSyntheticAsarBuffer({ appVersion: '2.33.0' });
    fs.writeFileSync(pathsObj.ASAR_PATH, pureBuf);

    const resA = patchAsarOnDisk(pathsObj);
    assert.equal(resA.status, 'PATCHED');
    assert.equal(resA.patchVersion, PATCH_MARKER);
    assert.equal(resA.backupCreated, true);
    assert.equal(fs.statSync(pathsObj.ASAR_PATH).size, pureBuf.length);
    assert.equal(isAsarPatchedFast(pathsObj.ASAR_PATH), true);

    const origPath = `${pathsObj.ASAR_PATH}.v2.33.0.orig`;
    const origJsonPath = `${origPath}.json`;
    assert.equal(fs.existsSync(origPath), true);
    assert.equal(fs.existsSync(origJsonPath), true);

    // Case B + Rev7-F4 #1: Delete `.orig.json` sidecar -> `verifyPureOrigArchive` verifies packed `integrity.hash` and backfills `.orig.json`!
    fs.unlinkSync(origJsonPath);
    const verifiedB = verifyPureOrigArchive(origPath, '2.33.0');
    assert.equal(verifiedB.ok, true);
    assert.equal(fs.existsSync(origJsonPath), true, 'Missing .orig.json must be backfilled after packed SHA-256 verification');

    // Rev7-F4 #1 Corruption Check: Flip 1 byte inside packed payload WITHOUT `.orig.json` -> MUST fail packed `integrity.hash`!
    fs.unlinkSync(origJsonPath);
    const corruptedBuf = Buffer.from(fs.readFileSync(origPath));
    corruptedBuf[corruptedBuf.length - 10] ^= 0xff;
    const corruptOrigPath = `${pathsObj.ASAR_PATH}.corrupt.orig`;
    fs.writeFileSync(corruptOrigPath, corruptedBuf);
    const verifiedCorrupt = verifyPureOrigArchive(corruptOrigPath, '2.33.0');
    assert.equal(verifiedCorrupt.ok, false);
    assert.match(verifiedCorrupt.reason, /FILE_INTEGRITY_MISMATCH/);

    // Case C: V5-patched ASAR WITHOUT `.orig` upgrades cleanly 1:1 to V6
    fs.unlinkSync(origPath);
    if (fs.existsSync(origJsonPath)) fs.unlinkSync(origJsonPath);
    const pad = Array.from({ length: 45 }, (_, i) => `// v5 headroom comment ${i}`).join('\n');
    const v5Buf = buildSyntheticAsarBuffer({
      appVersion: '2.33.0',
      utilsBody: `"use strict";\n${pad}\nfunction u(win, url) {\n${LEGACY_UTILS_V5_BLOCK}\n}\n`,
      mainBody: `"use strict";\n${pad}\nfunction m(electron_1) {\n${LEGACY_MAIN_V5_BLOCK}\n});\n}\n`,
      preloadBody: `"use strict";\n${LEGACY_PRELOAD_V5_BLOCK}\n${pad}\nconst p = 1;\n`,
    });
    fs.writeFileSync(pathsObj.ASAR_PATH, v5Buf);
    const resC = patchAsarOnDisk(pathsObj);
    assert.equal(resC.status, 'PATCHED');
    assert.equal(resC.upgradedFromV5WithoutOrig, true);
    assert.equal(isAsarPatchedFast(pathsObj.ASAR_PATH), true);

    // Unsupported legacy V4 WITHOUT `.orig` fails closed (`FAILED_LEGACY_UNRECOGNIZED_NO_ORIG`)
    const v4Buf = buildSyntheticAsarBuffer({
      appVersion: '2.33.0',
      utilsBody: `"use strict";\n// AGY_STATUSBAR_AUTOINJECT_V4\n${pad}\n`,
      mainBody: `"use strict";\n// AGY_STATUSBAR_AUTOINJECT_V4\n${pad}\n`,
      preloadBody: `"use strict";\n// AGY_STATUSBAR_AUTOINJECT_V4\n${pad}\n`,
    });
    fs.writeFileSync(pathsObj.ASAR_PATH, v4Buf);
    const resV4 = patchAsarOnDisk(pathsObj);
    assert.equal(resV4.status, 'FAILED_LEGACY_UNRECOGNIZED_NO_ORIG');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Host Lifecycle (Rev6-F3 & Rev6-F4 #1): v1.x shutdown-only watcher & stop-only llm-sentinel IPC compatibility, custom :18080 port probe, and remote https:// daemon stop', async () => {
  const { dir, pathsObj } = makeTempHostEnv();
  const mockServers = [];
  let dummyWatcherProc = null;
  try {
    // 1) Rev6-F3: Mock v1.x watcher sentinel accepting ONLY `op === 'shutdown'` (rejecting `'stop'`)
    const watchInstanceId = crypto.randomBytes(8).toString('hex');
    const watchAuth = crypto.randomBytes(16).toString('hex');
    const watchEndpoint = buildSentinelIpcEndpoint('testw', watchInstanceId);
    let watcherReceivedOp = '';

    dummyWatcherProc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const mockV1Watcher = net.createServer((conn) => {
      conn.setEncoding('utf8');
      conn.on('data', (chunk) => {
        const msg = JSON.parse(chunk.trim());
        watcherReceivedOp = msg.op;
        if (msg.authToken === watchAuth && msg.op === 'shutdown') {
          conn.end(JSON.stringify({ ok: true, stopped: true, instanceId: watchInstanceId }) + '\n', () => {
            try {
              dummyWatcherProc.kill();
            } catch (_err) {}
          });
        } else {
          conn.end(JSON.stringify({ ok: false, error: 'unsupported_op' }) + '\n');
        }
      });
    });
    mockServers.push(mockV1Watcher);
    await new Promise((resolve) => mockV1Watcher.listen(watchEndpoint, resolve));

    fs.writeFileSync(
      pathsObj.WATCHER_PID_PATH,
      formatWatcherPidRecord(dummyWatcherProc.pid, 'old-v1-sig', {
        instanceId: watchInstanceId,
        authToken: watchAuth,
        sentinelEndpoint: watchEndpoint,
      }),
      'utf8'
    );

    const stopWatchRes = await stopWatcherSentinel({
      watcherPidPath: pathsObj.WATCHER_PID_PATH,
      watcherLockPath: pathsObj.WATCHER_LOCK_PATH,
    });
    assert.equal(watcherReceivedOp, 'shutdown', 'Rev6-F3: stopWatcherSentinel must send op="shutdown" first for v1.x compatibility');
    assert.equal(stopWatchRes.stopped, true);

    // 2) Rev6-F3: Mock v1.x `--llm-sentinel` accepting ONLY `op === 'stop'` (rejecting `'shutdown'`)
    const llmInstanceId = crypto.randomBytes(8).toString('hex');
    const llmAuth = crypto.randomBytes(16).toString('hex');
    const llmEndpoint = buildSentinelIpcEndpoint('testl', llmInstanceId);
    let llmReceivedOps = [];

    const mockV1LlmSentinel = net.createServer((conn) => {
      conn.setEncoding('utf8');
      conn.on('data', (chunk) => {
        const msg = JSON.parse(chunk.trim());
        llmReceivedOps.push(msg.op);
        if (msg.authToken === llmAuth && msg.op === 'stop') {
          conn.end(JSON.stringify({ ok: true, terminatedPid: 99999992 }) + '\n');
        } else {
          conn.end(JSON.stringify({ ok: false, error: 'unknown_op' }) + '\n');
        }
      });
    });
    mockServers.push(mockV1LlmSentinel);
    await new Promise((resolve) => mockV1LlmSentinel.listen(llmEndpoint, resolve));

    fs.writeFileSync(
      pathsObj.LLM_PID_PATH,
      JSON.stringify({
        pid: 99999992,
        sentinelPid: 99999993,
        port: 18080,
        hostname: '127.0.0.1',
        instanceId: llmInstanceId,
        authToken: llmAuth,
        sentinelEndpoint: llmEndpoint,
      }),
      'utf8'
    );

    // 3) Rev6-F4 #1: Calling `ensureLocalLlmServer` with a remote `https://` endpoint MUST stop the owned local daemon via `'stop'` IPC and NOT spawn a local server!
    const remoteEnsureRes = await ensureLocalLlmServer(true, {
      baseUrl: 'https://api.openai.com/v1',
      llmPidPath: pathsObj.LLM_PID_PATH,
    });
    assert.equal(remoteEnsureRes.skipped, true);
    assert.equal(remoteEnsureRes.reason, 'non_loopback_endpoint');
    assert.equal(llmReceivedOps[0], 'stop', 'Rev6-F3: stopLocalLlmServer must send op="stop" first for v1.x --llm-sentinel');
    assert.equal(fs.existsSync(pathsObj.LLM_PID_PATH), false);

    // 4) Rev6-F4 #1: Custom loopback port probe (OpenAI-compatible `/v1/models` on dynamic loopback port)
    const customHttpSrv = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder' }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    mockServers.push(customHttpSrv);
    await new Promise((resolve) => customHttpSrv.listen(0, '127.0.0.1', resolve));
    const customPort = customHttpSrv.address().port;

    const customProbe = await probeLocalLlmServer(1000, {
      baseUrl: `http://127.0.0.1:${customPort}/v1`,
    });
    assert.equal(customProbe.reachable, true);
    assert.equal(customProbe.port, customPort);
    assert.deepEqual(customProbe.models, ['qwen2.5-coder']);
  } finally {
    if (dummyWatcherProc) {
      try {
        dummyWatcherProc.kill();
      } catch (_err) {}
    }
    for (const srv of mockServers) {
      try {
        srv.close();
      } catch (_err) {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Host Lifecycle (Rev6-F2 & Rev7-F4 #2): active --watch-storage + concurrent --rollback serialized under LOCK_PATH preserves sibling blocks and prevents re-patch race', async () => {
  const { dir, pathsObj } = makeTempHostEnv();
  let watcherHandle = null;
  try {
    const siblingHeader = '// === BEGIN_AGY_STATUSBAR ===\nwindow.agyStatusBar = { active: true };\n// === END_AGY_STATUSBAR ===';
    const siblingFooter = '// === BEGIN_AGY_MCP ===\nwindow.agyMcpManager = { active: true };\n// === END_AGY_MCP ===';
    fs.writeFileSync(pathsObj.STATUSBAR_AUTOINJECT_PATH, `${siblingHeader}\n\n${siblingFooter}\n`, 'utf8');
    fs.writeFileSync(
      pathsObj.APP_STORAGE_PATH,
      JSON.stringify({ 'unrelated-user-key': 'keep-me' }, null, 2),
      'utf8'
    );

    const pureBuf = buildSyntheticAsarBuffer({ appVersion: '2.33.0' });
    fs.writeFileSync(pathsObj.ASAR_PATH, pureBuf);

    // Persist active settings & sync combined autoinject + patch ASAR to V6
    updateTranslatorSettings({
      translationProvider: 'local-llm',
      pretranslateEnabled: true,
      pathOverrides: pathsObj,
    });
    syncCombinedAutoinject({
      translationProvider: 'local-llm',
      pretranslateEnabled: true,
      pathOverrides: pathsObj,
    });
    const patchRes = patchAsarOnDisk(pathsObj);
    assert.equal(patchRes.status, 'PATCHED');
    assert.equal(isAsarPatchedFast(pathsObj.ASAR_PATH), true);
    assert.equal(
      fs.readFileSync(pathsObj.STATUSBAR_AUTOINJECT_PATH, 'utf8').includes('BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2'),
      true
    );

    // 1) Zero-Side-Effect Pre-Flight Check: Temporarily hide `.orig` -> `runRollback` MUST return `ERR_ORIG_MISSING` with ZERO side effects!
    const origPath = `${pathsObj.ASAR_PATH}.v2.33.0.orig`;
    const hiddenOrigPath = `${origPath}.hidden`;
    fs.renameSync(origPath, hiddenOrigPath);
    const errMissingRes = await runRollback({ pathOverrides: pathsObj });
    assert.equal(errMissingRes.status, 'ERR_ORIG_MISSING');
    assert.equal(isAsarPatchedFast(pathsObj.ASAR_PATH), true, 'ASAR must remain untouched on ERR_ORIG_MISSING');
    assert.equal(fs.existsSync(pathsObj.SETTINGS_SSOT_PATH), true, 'SSOT file must remain untouched on ERR_ORIG_MISSING');
    fs.renameSync(hiddenOrigPath, origPath);

    // 2) Start an active aggressive `--watch-storage` loop (polling every 20ms) and execute `runRollback` concurrently!
    watcherHandle = runStorageWatcherLoop({
      pathOverrides: pathsObj,
      pollIntervalMs: 20,
    });
    await new Promise((r) => setTimeout(r, 45));

    const rollbackRes = await runRollback({ pathOverrides: pathsObj });
    assert.equal(rollbackRes.status, 'ROLLED_BACK');
    assert.equal(rollbackRes.asarRestored, true);

    // Wait several watcher poll intervals AFTER rollback releases `LOCK_PATH` to prove 0 re-patch race!
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(watcherHandle.isStopped(), true, 'Active watcher loop must have stopped during rollback');
    assert.equal(isAsarPatchedFast(pathsObj.ASAR_PATH), false, 'ASAR must remain unpatched with 0 re-patch race');
    assert.equal(Buffer.compare(fs.readFileSync(pathsObj.ASAR_PATH), pureBuf), 0, 'Restored ASAR must match pure original byte-for-byte');
    assert.equal(fs.existsSync(pathsObj.SETTINGS_SSOT_PATH), false, 'ko_translator_settings.json must be removed');

    const remainingAutoinject = fs.readFileSync(pathsObj.STATUSBAR_AUTOINJECT_PATH, 'utf8');
    assert.equal(remainingAutoinject.includes('BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2'), false);
    assert.equal(remainingAutoinject.trim(), `${siblingHeader}\n\n${siblingFooter}`);

    const remainingAppStorage = JSON.parse(fs.readFileSync(pathsObj.APP_STORAGE_PATH, 'utf8'));
    assert.equal(remainingAppStorage['unrelated-user-key'], 'keep-me');
    assert.equal(remainingAppStorage['agy-ko-thought-provider'], undefined);
    assert.equal(remainingAppStorage['agy-statusbar-code'].trim(), `${siblingHeader}\n\n${siblingFooter}`);

    // Verify fast probe leaves zero `.tmp` files in resources directory
    const probeAfter = probeAsarReplaceableFast(pathsObj.ASAR_PATH);
    assert.equal(probeAfter.replaceable, true);
    const leftoverTmp = fs.readdirSync(path.dirname(pathsObj.ASAR_PATH)).filter((f) => f.includes('.tmp'));
    assert.deepEqual(leftoverTmp, []);
  } finally {
    if (watcherHandle && !watcherHandle.isStopped()) {
      watcherHandle.stop();
    }
    await stopLocalLlmServer(false, { llmPidPath: pathsObj.LLM_PID_PATH });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
