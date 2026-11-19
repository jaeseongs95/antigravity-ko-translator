'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  MAIN_ANCHOR_TARGET,
  isAllowedHubUrl,
  validateDropinManifest,
  collectExecutableExtensions,
  buildHostLoaderScriptSource,
  registerPluginManifest,
  installAsarDropinLoader,
  rollbackAsarDropinLoader,
  isAsarLoaderInstalled,
  isPureUnpatchedArchive,
  readAsarArchive,
} = require('../../host/dropin-loader');
const vm = require('node:vm');

function buildSyntheticAsar(filePath, version = '2.33.0') {
  const pkgBuf = Buffer.from(JSON.stringify({ name: 'antigravity', version }), 'utf8');
  const mainLines = [
    "'use strict';",
    "const electron_1 = require('electron');",
    ...Array.from({ length: 12 }, (_, i) => `// padding comment line ${i} for exact size headroom`),
    MAIN_ANCHOR_TARGET,
    '  void contents;',
    '});',
  ];
  const mainBuf = Buffer.from(mainLines.join('\n') + '\n', 'utf8');
  const makeIntegrity = (buf) => {
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    return { algorithm: 'SHA256', hash, blockSize: 4 * 1024 * 1024, blocks: [hash] };
  };
  const files = {
    'package.json': { size: pkgBuf.length, offset: '0', integrity: makeIntegrity(pkgBuf) },
    dist: {
      files: {
        'main.js': { size: mainBuf.length, offset: String(pkgBuf.length), integrity: makeIntegrity(mainBuf) },
      },
    },
  };
  const headerStr = JSON.stringify({ files });
  const headerStrBuf = Buffer.from(headerStr, 'utf8');
  const aligned = Math.ceil(headerStrBuf.length / 4) * 4;
  const u8 = 4 + aligned;
  const u4 = 4 + u8;
  const hdr = Buffer.alloc(8 + u4, 0);
  hdr.writeUInt32LE(4, 0);
  hdr.writeUInt32LE(u4, 4);
  hdr.writeUInt32LE(u8, 8);
  hdr.writeUInt32LE(headerStrBuf.length, 12);
  headerStrBuf.copy(hdr, 16);
  const full = Buffer.concat([hdr, pkgBuf, mainBuf]);
  fs.writeFileSync(filePath, full);
  return full;
}

test('isAllowedHubUrl allows ONLY local http(s) Hub URLs and rejects devtools/about/data/file', () => {
  assert.equal(isAllowedHubUrl('http://127.0.0.1:4173/index.html'), true);
  assert.equal(isAllowedHubUrl('https://localhost:5387/'), true);
  assert.equal(isAllowedHubUrl('devtools://devtools/bundled/inspector.html'), false);
  assert.equal(isAllowedHubUrl('about:blank'), false);
  assert.equal(isAllowedHubUrl('data:text/html,<h1>x</h1>'), false);
  assert.equal(isAllowedHubUrl('file:///C:/index.html'), false);
  assert.equal(isAllowedHubUrl('https://evil.example.com/'), false);
});

test('validateDropinManifest enforces schemaVersion, pluginId, and rejects path traversal outside plugin dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-dropin-sec-'));
  try {
    const pluginsRoot = path.join(dir, 'plugins');
    const pluginDir = path.join(pluginsRoot, 'ko-thought-translator');
    fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
    const goodScript = path.join(pluginDir, 'dist', 'renderer.js');
    const outsideScript = path.join(dir, 'outside.js');
    fs.writeFileSync(goodScript, '// ok\n', 'utf8');
    fs.writeFileSync(outsideScript, '// escape\n', 'utf8');

    const okRes = validateDropinManifest(
      { schemaVersion: 1, pluginId: 'ko-thought-translator', entryScript: goodScript },
      pluginsRoot
    );
    assert.equal(okRes.ok, true);

    const travRes = validateDropinManifest(
      { schemaVersion: 1, pluginId: 'ko-thought-translator', entryScript: '../../outside.js' },
      pluginsRoot
    );
    assert.equal(travRes.ok, false);
    assert.equal(travRes.reason, 'ENTRY_SCRIPT_ESCAPES_PLUGIN_DIR');

    const badVer = validateDropinManifest(
      { schemaVersion: 2, pluginId: 'ko-thought-translator', entryScript: goodScript },
      pluginsRoot
    );
    assert.equal(badVer.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectExecutableExtensions respects live config.json enabled:false gate immediately', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-dropin-gate-'));
  try {
    const agyDir = path.join(dir, '.gemini', 'antigravity');
    const cfgDir = path.join(dir, '.gemini', 'config');
    const pluginsRoot = path.join(cfgDir, 'plugins');
    const entry = path.join(pluginsRoot, 'ko-thought-translator', 'dist', 'renderer.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, 'window.__loaded = true;\n', 'utf8');

    const overrides = {
      PLUGIN_ID: 'ko-thought-translator',
      RENDERER_BUNDLE_PATH: entry,
      UI_EXTENSIONS_DIR: path.join(agyDir, 'ui-extensions.d'),
      MANIFEST_PATH: path.join(agyDir, 'ui-extensions.d', 'ko-thought-translator.json'),
      LOADER_SCRIPT_PATH: path.join(agyDir, 'ui-extensions-loader.js'),
    };
    registerPluginManifest(overrides);

    const cfgPath = path.join(cfgDir, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: true } } }), 'utf8');
    const enabledList = collectExecutableExtensions({
      uiExtensionsDir: overrides.UI_EXTENSIONS_DIR,
      pluginsRootDir: pluginsRoot,
      configJsonPath: cfgPath,
    });
    assert.equal(enabledList.length, 1);

    // Flip enabled -> false in config.json: immediately 0 executable extensions!
    fs.writeFileSync(cfgPath, JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: false } } }), 'utf8');
    const disabledList = collectExecutableExtensions({
      uiExtensionsDir: overrides.UI_EXTENSIONS_DIR,
      pluginsRootDir: pluginsRoot,
      configJsonPath: cfgPath,
    });
    assert.equal(disabledList.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installAsarDropinLoader patches dist/main.js exact-size and rollbackAsarDropinLoader restores byte-identical .orig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-asar-roundtrip-'));
  try {
    const asarPath = path.join(dir, 'app.asar');
    const origBuf = buildSyntheticAsar(asarPath, '2.33.0');
    const origHash = crypto.createHash('sha256').update(origBuf).digest('hex');

    const overrides = {
      ASAR_PATH: asarPath,
      ASAR_LOCK_PATH: path.join(dir, 'asar.lock'),
      UI_EXTENSIONS_DIR: path.join(dir, 'ui-extensions.d'),
      MANIFEST_PATH: path.join(dir, 'ui-extensions.d', 'ko-thought-translator.json'),
      LOADER_SCRIPT_PATH: path.join(dir, 'ui-extensions-loader.js'),
      RENDERER_BUNDLE_PATH: path.join(dir, 'renderer.js'),
    };

    const inst = installAsarDropinLoader(overrides);
    assert.equal(inst.status, 'INSTALLED');
    assert.equal(isAsarLoaderInstalled(asarPath), true);
    assert.equal(fs.statSync(asarPath).size, origBuf.length);

    const rb = rollbackAsarDropinLoader(overrides);
    assert.equal(rb.status, 'ROLLED_BACK');
    assert.equal(isPureUnpatchedArchive(readAsarArchive(asarPath)), true);
    const restoredHash = crypto.createHash('sha256').update(fs.readFileSync(asarPath)).digest('hex');
    assert.equal(restoredHash, origHash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F4+F5: buildHostLoaderScriptSource executes REAL dist/renderer.js, safely handles corrupted settings JSON, retries on failure, and honors config.json enabled gate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-loader-exec-'));
  try {
    const agyDir = path.join(dir, '.gemini', 'antigravity');
    const extDir = path.join(agyDir, 'ui-extensions.d');
    const cfgDir = path.join(dir, '.gemini', 'config');
    const pluginDir = path.join(cfgDir, 'plugins', 'ko-thought-translator', 'dist');
    fs.mkdirSync(extDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    const realBundlePath = path.resolve(__dirname, '..', '..', 'dist', 'renderer.js');
    const entryScript = path.join(pluginDir, 'renderer.js');
    fs.copyFileSync(realBundlePath, entryScript);
    fs.writeFileSync(
      path.join(extDir, 'ko-thought-translator.json'),
      JSON.stringify({ schemaVersion: 1, pluginId: 'ko-thought-translator', entryScript }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: true } } }),
      'utf8'
    );
    // Write intentionally corrupted settings JSON to prove F5 #3 cannot break JS syntax
    fs.writeFileSync(path.join(agyDir, 'ko_translator_settings.json'), '{corrupted-json', 'utf8');

    const loaderMod = { exports: {} };
    const sandbox = {
      require,
      module: loaderMod,
      exports: loaderMod.exports,
      process: { env: { USERPROFILE: dir, HOME: dir } },
      console: { error() {} },
    };
    vm.runInNewContext(buildHostLoaderScriptSource(), sandbox);
    assert.equal(typeof loaderMod.exports.attach, 'function');

    const executedScripts = [];
    const handlers = {};
    let failOnce = true;
    let exportedFactoryType = '';
    const mockContents = {
      getType: () => 'window',
      isDestroyed: () => false,
      getURL: () => 'http://127.0.0.1:4173/index.html',
      on: (evt, fn) => {
        handlers[evt] = fn;
      },
      executeJavaScript: async (code) => {
        executedScripts.push(code);
        if (failOnce) {
          failOnce = false;
          throw new Error('TRANSIENT_RENDERER_NOT_READY');
        }
        // Execute REAL dist/renderer.js wrapper in VM (with auto-mount disabled so no timers leak)
        const winObj = { __AGY_KO_TRANSLATOR_AUTO_MOUNT__: false };
        const winCtx = { window: winObj, document: {}, globalThis: null, self: null, console: { error() {} } };
        winCtx.globalThis = winCtx;
        winCtx.self = winCtx;
        vm.runInNewContext(code, winCtx);
        exportedFactoryType = typeof winObj.__agyCreateKoTranslator;
        return exportedFactoryType;
      },
    };

    loaderMod.exports.attach(mockContents);
    // First dom-ready fails transiently -> Defect-3: must NOT lock lastInjectedUrl so did-finish-load retries!
    handlers['dom-ready']();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(executedScripts.length, 1);

    // did-finish-load retries and succeeds with REAL dist/renderer.js
    handlers['did-finish-load']();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(executedScripts.length, 2);
    assert.equal(exportedFactoryType, 'function');

    // Subsequent duplicate event on SAME URL after success must NOT double-inject (zero FOUC)
    handlers['did-finish-load']();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(executedScripts.length, 2);

    // After top-frame navigation starts and enabled -> false, firing again must execute 0 new scripts
    handlers['did-start-navigation']({}, 'http://127.0.0.1:4173/index.html', false, true);
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: false } } }),
      'utf8'
    );
    handlers['did-finish-load']();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(executedScripts.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F5: isPureUnpatchedArchive rejects legacy v1.x ASAR patches and rollback fails closed on tampered .orig.json without deleting manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-asar-sec-'));
  try {
    const asarPath = path.join(dir, 'app.asar');
    buildSyntheticAsar(asarPath, '2.33.0');
    const overrides = {
      ASAR_PATH: asarPath,
      ASAR_LOCK_PATH: path.join(dir, 'asar.lock'),
      UI_EXTENSIONS_DIR: path.join(dir, 'ui-extensions.d'),
      MANIFEST_PATH: path.join(dir, 'ui-extensions.d', 'ko-thought-translator.json'),
      LOADER_SCRIPT_PATH: path.join(dir, 'ui-extensions-loader.js'),
      RENDERER_BUNDLE_PATH: path.join(dir, 'renderer.js'),
    };
    registerPluginManifest(overrides);
    const inst = installAsarDropinLoader(overrides);
    assert.equal(inst.status, 'INSTALLED');

    // Tamper .orig.json sha256 -> rollback must fail closed AND keep manifest intact
    const metaPath = `${asarPath}.v2.33.0.orig.json`;
    fs.writeFileSync(metaPath, JSON.stringify({ sha256: '0'.repeat(64), bytes: 1 }), 'utf8');
    const rbFail = rollbackAsarDropinLoader(overrides);
    assert.equal(rbFail.status, 'ERR_ORIG_META_MISMATCH');
    assert.equal(rbFail.manifestRemoved, false);
    assert.equal(fs.existsSync(overrides.MANIFEST_PATH), true);

    // Legacy v1.x patched archive check
    const fakeLegacyArchive = {
      fileMap: new Map([['dist/main.js', Buffer.from('// AGY_STATUSBAR_V6\n', 'utf8')]]),
    };
    assert.equal(isPureUnpatchedArchive(fakeLegacyArchive), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const defaultLocalOrig = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar.v2.33.0.orig')
  : '';
const realAsarFlagIdx = process.argv.indexOf('--real-asar');
const realAsarOrigPath =
  (realAsarFlagIdx !== -1 && process.argv[realAsarFlagIdx + 1]) ||
  process.env.AGY_REAL_ASAR_ORIG ||
  (defaultLocalOrig && fs.existsSync(defaultLocalOrig) ? defaultLocalOrig : '');

const HAS_REAL_ASAR = Boolean(realAsarOrigPath && fs.existsSync(realAsarOrigPath));

test(
  'Real Antigravity app.asar copy: exact-size dist/main.js patch preserves preload/utils and rolls back byte-identically',
  { skip: HAS_REAL_ASAR ? false : 'Local Antigravity app.asar.orig fixture not present in this environment' },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-asar-real-'));
    try {
      const asarPath = path.join(dir, 'app.asar');
      fs.copyFileSync(realAsarOrigPath, asarPath);
      const origBuf = fs.readFileSync(asarPath);
      const origHash = crypto.createHash('sha256').update(origBuf).digest('hex');
      const origArc = readAsarArchive(asarPath);
      const origPreloadHash = crypto.createHash('sha256').update(origArc.fileMap.get('dist/preload.js')).digest('hex');
      const origUtilsHash = crypto.createHash('sha256').update(origArc.fileMap.get('dist/utils.js')).digest('hex');

      const overrides = {
        ASAR_PATH: asarPath,
        ASAR_LOCK_PATH: path.join(dir, 'asar.lock'),
        UI_EXTENSIONS_DIR: path.join(dir, 'ui-extensions.d'),
        MANIFEST_PATH: path.join(dir, 'ui-extensions.d', 'ko-thought-translator.json'),
        LOADER_SCRIPT_PATH: path.join(dir, 'ui-extensions-loader.js'),
        RENDERER_BUNDLE_PATH: path.join(dir, 'renderer.js'),
      };

      const inst = installAsarDropinLoader(overrides);
      assert.equal(inst.status, 'INSTALLED');
      assert.equal(isAsarLoaderInstalled(asarPath), true);
      assert.equal(fs.statSync(asarPath).size, origBuf.length);

      const patchedArc = readAsarArchive(asarPath);
      const patchedPreloadHash = crypto.createHash('sha256').update(patchedArc.fileMap.get('dist/preload.js')).digest('hex');
      const patchedUtilsHash = crypto.createHash('sha256').update(patchedArc.fileMap.get('dist/utils.js')).digest('hex');
      assert.equal(patchedPreloadHash, origPreloadHash);
      assert.equal(patchedUtilsHash, origUtilsHash);

      const rb = rollbackAsarDropinLoader(overrides);
      assert.equal(rb.status, 'ROLLED_BACK');
      const restoredHash = crypto.createHash('sha256').update(fs.readFileSync(asarPath)).digest('hex');
      assert.equal(restoredHash, origHash);
      console.log(
        JSON.stringify({
          realAsarVerified: true,
          appVersion: inst.appVersion,
          bytes: origBuf.length,
          origSha256: origHash,
          patchedSha256: inst.sha256,
          restoredSha256: restoredHash,
          preloadUnchanged: patchedPreloadHash === origPreloadHash,
          utilsUnchanged: patchedUtilsHash === origUtilsHash,
        })
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
