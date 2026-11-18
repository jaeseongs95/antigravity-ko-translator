'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { resolveHostPaths, DEFAULT_LLM_BASE_URL } = require('./paths');
const {
  isProcessAlive,
  waitForProcessExitSync,
  waitForProcessExitAsync,
  writeFileAtomicSync,
  buildSentinelIpcEndpoint,
  sendSentinelIpcCommand,
  createAuthenticatedSentinelServer,
} = require('./process-sentinel');
const {
  isCanonicalLoopbackHost,
  validateTranslationEndpointUrl,
} = require('../src/adapters/translators/endpoint-validator');

function readWindowsUserEnv(varName) {
  if (process.platform !== 'win32') return null;
  try {
    const res = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', varName], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.status === 0 && res.stdout) {
      const m = res.stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/i);
      if (m && m[1]) return m[1].trim();
    }
  } catch (_err) {}
  return null;
}

function parseCommandArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== 'string') return [];
  const args = [];
  let current = '';
  let quoteChar = null;
  let hasToken = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const ch = rawArgs[i];
    if (ch === '\\') {
      let slashCount = 1;
      while (i + slashCount < rawArgs.length && rawArgs[i + slashCount] === '\\') {
        slashCount++;
      }
      const nextCh = rawArgs[i + slashCount];
      if (nextCh === '"' && quoteChar !== "'") {
        current += '\\'.repeat(Math.floor(slashCount / 2));
        hasToken = true;
        if (slashCount % 2 === 1) {
          current += '"';
        } else {
          quoteChar = quoteChar === '"' ? null : '"';
        }
        i += slashCount;
        continue;
      }
      if (nextCh === "'" && quoteChar === "'") {
        current += '\\'.repeat(Math.floor(slashCount / 2));
        hasToken = true;
        if (slashCount % 2 === 1) {
          current += "'";
          i += slashCount;
          continue;
        }
      }
      current += '\\'.repeat(slashCount);
      hasToken = true;
      i += slashCount - 1;
      continue;
    }
    if (quoteChar) {
      if (ch === quoteChar) quoteChar = null;
      else current += ch;
      hasToken = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) args.push(current);
  return args;
}

function resolveLocalLlmCommand(env = process.env) {
  const bin = env.AGY_LOCAL_LLM_SERVER_BIN || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_BIN');
  if (!bin) return null;
  const rawArgs = env.AGY_LOCAL_LLM_SERVER_ARGS || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_ARGS') || 'serve';
  return {
    bin,
    args: parseCommandArgs(rawArgs),
  };
}

function parseLoopbackLlmEndpoint(rawBaseUrl = DEFAULT_LLM_BASE_URL) {
  try {
    const parsed = validateTranslationEndpointUrl(rawBaseUrl || DEFAULT_LLM_BASE_URL, {
      allowRemoteHttps: true,
    });
    if (!isCanonicalLoopbackHost(parsed.hostname)) {
      return {
        valid: true,
        isLoopback: false,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
        basePath: parsed.pathname.replace(/\/+$/, ''),
        baseUrl: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`,
      };
    }
    const defaultPort = parsed.protocol === 'https:' ? 443 : 11434;
    const port = parsed.port ? Number(parsed.port) : defaultPort;
    const basePath = parsed.pathname.replace(/\/+$/, '');
    const probePath = /\/v1$/i.test(basePath) ? `${basePath}/models` : `${basePath}/v1/models`;
    return {
      valid: true,
      isLoopback: true,
      protocol: parsed.protocol,
      hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
      port,
      basePath,
      probePath,
      baseUrl: `${parsed.origin}${basePath}`,
    };
  } catch (_err) {
    return {
      valid: false,
      isLoopback: false,
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: 11434,
      basePath: '',
      probePath: '/v1/models',
      baseUrl: DEFAULT_LLM_BASE_URL,
    };
  }
}

async function resolveProbeOrigin(options = {}) {
  if (options && typeof options.probeOrigin === 'string' && options.probeOrigin.trim()) {
    return options.probeOrigin.trim();
  }
  const envOrigin = (
    process.env.AGY_FRONTEND_ORIGIN ||
    readWindowsUserEnv('AGY_FRONTEND_ORIGIN') ||
    ''
  ).trim();
  if (envOrigin) return envOrigin;

  const { DEVTOOLS_PORT_FILE } = resolveHostPaths(process.env);
  const dtPortFile = (options && options.devtoolsPortFile) || DEVTOOLS_PORT_FILE;
  try {
    if (dtPortFile && fs.existsSync(dtPortFile)) {
      const lines = fs.readFileSync(dtPortFile, 'utf8').trim().split(/\r?\n/);
      const dtPort = parseInt(lines[0], 10);
      if (dtPort && !Number.isNaN(dtPort)) {
        const discovered = await new Promise((resolve) => {
          const req = http.get(
            { host: '127.0.0.1', port: dtPort, path: '/json/list', timeout: 120 },
            (res) => {
              let raw = '';
              res.on('data', (c) => {
                raw += c;
              });
              res.on('end', () => {
                try {
                  const list = JSON.parse(raw);
                  const wb = Array.isArray(list)
                    ? list.find((t) => t && t.type === 'page' && /^https?:\/\//i.test(String(t.url || '')))
                    : null;
                  resolve(wb ? new URL(wb.url).origin : null);
                } catch (_err) {
                  resolve(null);
                }
              });
            }
          );
          req.on('timeout', () => {
            req.destroy();
            resolve(null);
          });
          req.on('error', () => resolve(null));
        });
        if (discovered) return discovered;
      }
    }
  } catch (_err) {}

  return 'https://127.0.0.1';
}

async function probeLocalLlmServer(timeoutMs = 500, options = {}) {
  const rawBaseUrl =
    (options && options.baseUrl) ||
    (options && options.llmConfig && options.llmConfig.baseUrl) ||
    process.env.AGY_LOCAL_LLM_BASE_URL ||
    DEFAULT_LLM_BASE_URL;
  const ep = parseLoopbackLlmEndpoint(rawBaseUrl);
  const probeOrigin = await resolveProbeOrigin(options);

  if (!ep.valid || !ep.isLoopback) {
    return {
      reachable: false,
      isLoopback: ep.isLoopback,
      corsAllowed: false,
      probeOrigin,
      models: [],
    };
  }

  const clientMod = ep.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const req = clientMod.request(
        {
          hostname: ep.hostname,
          port: ep.port,
          path: ep.probePath,
          method: 'GET',
          headers: { Origin: probeOrigin },
          timeout: timeoutMs,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            const corsOrigin = res.headers['access-control-allow-origin'] || '';
            let models = [];
            try {
              const parsed = JSON.parse(body);
              models = Array.isArray(parsed && parsed.data) ? parsed.data.map((m) => m.id) : [];
            } catch (_err) {
              models = [];
            }
            const corsAllowed =
              corsOrigin === '*' ||
              corsOrigin === probeOrigin ||
              (probeOrigin === 'https://127.0.0.1' && corsOrigin.includes('127.0.0.1'));
            done({
              reachable: true,
              isLoopback: true,
              port: ep.port,
              statusCode: res.statusCode,
              corsAllowed,
              corsOrigin,
              probeOrigin,
              models,
            });
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        done({ reachable: false, isLoopback: true, port: ep.port, corsAllowed: false, probeOrigin, models: [] });
      });
      req.on('error', () =>
        done({ reachable: false, isLoopback: true, port: ep.port, corsAllowed: false, probeOrigin, models: [] })
      );
      req.end();
    } catch (err) {
      done({
        reachable: false,
        isLoopback: true,
        port: ep.port,
        corsAllowed: false,
        probeOrigin,
        models: [],
        error: err.message,
      });
    }
  });
}

function resolveEffectiveLlmPidPath(options = {}) {
  if (options && options.llmPidPath) return options.llmPidPath;
  return resolveHostPaths(process.env).LLM_PID_PATH;
}

function removeFileQuietly(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_err) {}
}

// Rev6-F3: LLM Shutdown Caller Contract:
// 1) Send `{ op: 'stop', authToken }` FIRST (v1.x `--llm-sentinel` exits ONLY on `stop`; v2.0.0 exits on both).
// 2) If `reply?.stopped !== true && !Number.isInteger(reply?.terminatedPid)` and `!waitForProcessExitAsync(pid, 400)`,
//    send `{ op: 'shutdown', authToken }` fallback!
// 3) Zero OS signals to unowned/recycled PIDs!
async function stopLocalLlmServer(_forceProcessScan = false, options = {}) {
  const llmPidPath = resolveEffectiveLlmPidPath(options);
  try {
    if (!llmPidPath || !fs.existsSync(llmPidPath)) {
      return { stoppedCount: 0, skippedReason: 'no_owned_pid_file' };
    }

    let record = null;
    try {
      record = JSON.parse(fs.readFileSync(llmPidPath, 'utf8'));
    } catch (_parseErr) {
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'corrupt_pid_file' };
    }

    const targetPid = Number(record && record.pid);
    const sentinelPid = Number(record && record.sentinelPid);
    if (!Number.isInteger(targetPid) || targetPid <= 0 || targetPid === process.pid) {
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'invalid_pid_record' };
    }

    const sentinelEndpoint = typeof record.sentinelEndpoint === 'string' ? record.sentinelEndpoint : '';
    const authToken = typeof record.authToken === 'string' ? record.authToken : '';
    const instanceId = typeof record.instanceId === 'string' ? record.instanceId : '';

    if (!sentinelEndpoint || !authToken || !instanceId) {
      removeFileQuietly(llmPidPath);
      return { stoppedCount: 0, skippedReason: 'identity_mismatch' };
    }

    const ipcTimeoutMs = (options && options.ipcTimeoutMs) || 2800;
    const reply1 = await sendSentinelIpcCommand(
      sentinelEndpoint,
      { op: 'stop', authToken },
      ipcTimeoutMs
    );

    if (!reply1 || reply1.ok !== true || reply1.instanceId !== instanceId) {
      const stillAlive = isProcessAlive(targetPid);
      removeFileQuietly(llmPidPath);
      return {
        stoppedCount: 0,
        skippedReason: stillAlive ? 'identity_mismatch' : 'already_exited',
      };
    }

    let stoppedPid = Number.isInteger(reply1.terminatedPid) ? reply1.terminatedPid : targetPid;
    if (reply1.stopped !== true && !Number.isInteger(reply1.terminatedPid)) {
      const exitedFast = await waitForProcessExitAsync(stoppedPid, 400);
      if (!exitedFast) {
        const reply2 = await sendSentinelIpcCommand(
          sentinelEndpoint,
          { op: 'shutdown', authToken },
          ipcTimeoutMs
        );
        if (reply2 && Number.isInteger(reply2.terminatedPid)) {
          stoppedPid = reply2.terminatedPid;
        }
      }
    }

    await waitForProcessExitAsync(stoppedPid, 800);
    if (Number.isInteger(sentinelPid) && sentinelPid > 0) {
      await waitForProcessExitAsync(sentinelPid, 400);
    }
    removeFileQuietly(llmPidPath);
    return { stoppedCount: 1, terminatedPid: stoppedPid };
  } catch (_err) {
    return { stoppedCount: 0, skippedReason: 'unexpected_error' };
  }
}

async function ensureLocalLlmServer(pluginEnabled = true, options = {}) {
  if (!pluginEnabled) return { skipped: true };

  const rawBaseUrl =
    (options && options.baseUrl) ||
    (options && options.llmConfig && options.llmConfig.baseUrl) ||
    process.env.AGY_LOCAL_LLM_BASE_URL ||
    DEFAULT_LLM_BASE_URL;
  const ep = parseLoopbackLlmEndpoint(rawBaseUrl);

  // Rev6-F4 #1: If `llmConfig.baseUrl` is non-loopback (remote `https://`), NEVER spawn local daemon — stop any existing owned daemon!
  if (!ep.valid || !ep.isLoopback) {
    await stopLocalLlmServer(false, options);
    return {
      skipped: true,
      reason: 'non_loopback_endpoint',
      baseUrl: rawBaseUrl,
    };
  }

  // If an owned daemon is running on a DIFFERENT port than the newly configured loopback port, stop it first!
  const llmPidPath = resolveEffectiveLlmPidPath(options);
  if (llmPidPath && fs.existsSync(llmPidPath)) {
    try {
      const existingMeta = JSON.parse(fs.readFileSync(llmPidPath, 'utf8'));
      if (existingMeta && Number.isInteger(existingMeta.port) && existingMeta.port !== ep.port) {
        await stopLocalLlmServer(false, options);
      }
    } catch (_err) {}
  }

  const probe = await probeLocalLlmServer(450, { ...options, baseUrl: ep.baseUrl });
  if (probe.reachable) {
    return { ...probe, ownedByPlugin: false };
  }

  const cmd =
    options && options.commandOverride
      ? options.commandOverride
      : resolveLocalLlmCommand(options && options.env ? options.env : process.env);
  if (!cmd) return probe;

  if (options && typeof options.spawnFn === 'function') {
    const child = options.spawnFn(cmd.bin, cmd.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, OLLAMA_HOST: `${ep.hostname}:${ep.port}` },
    });
    if (child && typeof child.unref === 'function') child.unref();
    return { ...probe, ownedByPlugin: Boolean(child && child.pid), pid: (child && child.pid) || null };
  }

  const instanceId = crypto.randomBytes(16).toString('hex');
  const authToken = crypto.randomBytes(32).toString('hex');
  const sentinelEndpoint = buildSentinelIpcEndpoint('llm', instanceId);
  const supervisorScript = (options && options.supervisorScriptPath) || __filename;

  const sentinel = spawn(process.execPath, [supervisorScript, '--llm-sentinel'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      OLLAMA_HOST: `${ep.hostname}:${ep.port}`,
      AGY_KO_LLM_SENTINEL_CFG: JSON.stringify({
        bin: cmd.bin,
        args: cmd.args,
        port: ep.port,
        hostname: ep.hostname,
        llmPidPath,
        instanceId,
        authToken,
        sentinelEndpoint,
      }),
    },
  });
  if (sentinel && typeof sentinel.unref === 'function') {
    sentinel.unref();
  }

  const waitBudgetMs = options && options.fastHook ? 350 : 1600;
  const deadline = Date.now() + waitBudgetMs;
  let ownedChildPid = null;

  const tryReadOwnedChildPid = () => {
    try {
      if (llmPidPath && fs.existsSync(llmPidPath)) {
        const meta = JSON.parse(fs.readFileSync(llmPidPath, 'utf8'));
        if (meta && meta.instanceId === instanceId && Number.isInteger(meta.pid) && meta.pid > 0) {
          return meta.pid;
        }
      }
    } catch (_err) {}
    return null;
  };

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 40));
    ownedChildPid = ownedChildPid || tryReadOwnedChildPid();
    const postProbe = await probeLocalLlmServer(200, { ...options, baseUrl: ep.baseUrl });
    if (postProbe.reachable) {
      while (!ownedChildPid && Date.now() < deadline) {
        if (sentinel && sentinel.pid && !isProcessAlive(sentinel.pid)) {
          ownedChildPid = tryReadOwnedChildPid();
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
        ownedChildPid = tryReadOwnedChildPid();
      }
      return { ...postProbe, ownedByPlugin: true, pid: ownedChildPid };
    }
    if (sentinel && sentinel.pid && !isProcessAlive(sentinel.pid) && !ownedChildPid) {
      break;
    }
  }

  ownedChildPid = ownedChildPid || tryReadOwnedChildPid();
  return { ...probe, ownedByPlugin: Boolean(ownedChildPid), pid: ownedChildPid };
}

// Rev6-F4 #1: Reconcile daemon state whenever provider or llmConfig changes!
async function reconcileLocalLlmRuntime({
  pluginEnabled = true,
  translationProvider = 'google-translate',
  llmConfig = null,
  options = {},
} = {}) {
  const baseUrl = (llmConfig && llmConfig.baseUrl) || DEFAULT_LLM_BASE_URL;
  const ep = parseLoopbackLlmEndpoint(baseUrl);
  if (!pluginEnabled || translationProvider !== 'local-llm' || !ep.valid || !ep.isLoopback) {
    return stopLocalLlmServer(false, options);
  }
  return ensureLocalLlmServer(pluginEnabled, { ...options, baseUrl: ep.baseUrl, llmConfig });
}

function normalizeExecutableImageName(binPath) {
  const raw = String(binPath || '').trim();
  if (!raw) return '';
  const base = path.basename(raw);
  if (!base) return '';
  if (process.platform === 'win32') {
    const lower = base.toLowerCase();
    return /\.[a-z0-9]+$/i.test(lower) ? lower : `${lower}.exe`;
  }
  return base;
}

function runLlmSentinelSupervisor() {
  let cfg = null;
  try {
    cfg = JSON.parse(process.env.AGY_KO_LLM_SENTINEL_CFG || '{}');
  } catch (_err) {
    process.exit(1);
    return;
  }
  delete process.env.AGY_KO_LLM_SENTINEL_CFG;

  const {
    bin,
    args = [],
    port = 11434,
    hostname = '127.0.0.1',
    llmPidPath,
    instanceId,
    authToken,
    sentinelEndpoint,
  } = cfg || {};
  if (!bin || !llmPidPath || !instanceId || !authToken || !sentinelEndpoint) {
    process.exit(1);
    return;
  }

  let child = null;
  let childExited = false;
  let shuttingDown = false;
  let sentinelHandle = null;

  const removeOwnedPidFile = () => {
    try {
      if (llmPidPath && fs.existsSync(llmPidPath)) {
        const cur = JSON.parse(fs.readFileSync(llmPidPath, 'utf8'));
        if (cur && cur.instanceId === instanceId) {
          fs.unlinkSync(llmPidPath);
        }
      }
    } catch (_err) {}
  };

  const cleanupAndExit = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    removeOwnedPidFile();
    if (sentinelHandle) {
      sentinelHandle.close();
      sentinelHandle = null;
    }
    process.exit(exitCode);
  };

  // Direct OS ChildProcess handle termination ONLY (never signals arbitrary PIDs!)
  const terminateDirectChild = () => {
    if (childExited || !child || !Number.isInteger(child.pid) || child.pid <= 0) {
      return 0;
    }
    const cPid = child.pid;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(cPid)], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 2500,
      });
      waitForProcessExitSync(cPid, 700);
    } else {
      try {
        child.kill('SIGTERM');
      } catch (_err) {}
      if (!waitForProcessExitSync(cPid, 500) && !childExited) {
        try {
          child.kill('SIGKILL');
        } catch (_err) {}
        waitForProcessExitSync(cPid, 400);
      }
    }
    return cPid;
  };

  sentinelHandle = createAuthenticatedSentinelServer({
    creds: { instanceId, authToken, sentinelEndpoint },
    onShutdownRequest: () => {
      const terminatedPid = terminateDirectChild();
      removeOwnedPidFile();
      setTimeout(() => cleanupAndExit(0), 60).unref();
      return { terminatedPid };
    },
    getExtraStatus: () => ({
      alive: !childExited,
      childPid: (child && child.pid) || 0,
      port,
    }),
  });

  try {
    child = spawn(bin, Array.isArray(args) ? args : [], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, OLLAMA_HOST: `${hostname}:${port}` },
    });
  } catch (_err) {
    cleanupAndExit(1);
    return;
  }

  child.once('error', () => {
    childExited = true;
    cleanupAndExit(1);
  });
  child.once('exit', () => {
    childExited = true;
    cleanupAndExit(0);
  });

  if (!child.pid || !Number.isInteger(child.pid) || child.pid <= 0) {
    cleanupAndExit(1);
    return;
  }

  const normalizedImage = normalizeExecutableImageName(bin);
  try {
    writeFileAtomicSync(
      llmPidPath,
      JSON.stringify(
        {
          schema: 'agy-ko-llm-sentinel-v2',
          pid: child.pid,
          sentinelPid: process.pid,
          port,
          hostname,
          bin,
          imageName: normalizedImage,
          instanceId,
          sentinelEndpoint,
          authToken,
          spawnedAt: Date.now(),
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    );
  } catch (_err) {
    terminateDirectChild();
    cleanupAndExit(1);
  }
}

if (require.main === module && process.argv.includes('--llm-sentinel')) {
  runLlmSentinelSupervisor();
}

module.exports = {
  parseCommandArgs,
  resolveLocalLlmCommand,
  parseLoopbackLlmEndpoint,
  resolveProbeOrigin,
  probeLocalLlmServer,
  ensureLocalLlmServer,
  stopLocalLlmServer,
  reconcileLocalLlmRuntime,
  runLlmSentinelSupervisor,
};
