/**
 * Module: scripts/host/settings-storage.js
 * Responsibility: Translator option persistence (`config.json` & `app_storage.json`), CLI flag parsing,
 * and headless background watcher process (`windowsHide: true` / `CREATE_NO_WINDOW`) with cryptographic
 * IPC sentinel authentication and race-safe atomic file lock restoration.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const {
  APP_STORAGE_PATH,
  DEVTOOLS_PORT_FILE,
  ASAR_PATH,
  CONFIG_JSON_PATH,
  ENSURE_STATUSBAR_PATCH_PATH,
  WATCHER_PID_PATH,
} = require('./paths');

function isPluginEnabled() {
  try {
    if (!fs.existsSync(CONFIG_JSON_PATH)) return true;
    const cfg = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8'));
    const entry = cfg?.plugins?.['ko-thought-translator'];
    if (entry && entry.enabled === false) return false;
    return true;
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] isPluginEnabled read error: ${err.message}\n`);
    return true;
  }
}

function parsePretranslateCliArg(args) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] || '');
    if (a.startsWith('--pretranslate=')) {
      const val = a.slice(a.indexOf('=') + 1).trim().toLowerCase();
      if (val === 'on' || val === 'true' || val === '1') return true;
      if (val === 'off' || val === 'false' || val === '0') return false;
    } else if (a === '--pretranslate' && i + 1 < args.length) {
      const val = String(args[i + 1] || '').trim().toLowerCase();
      if (val === 'on' || val === 'true' || val === '1') return true;
      if (val === 'off' || val === 'false' || val === '0') return false;
    }
  }
  return null;
}

function normalizeProviderName(raw) {
  const val = String(raw || '').trim().toLowerCase();
  if (!val) return null;
  if (val === 'google' || val === 'gtx' || val === 'google-translate') return 'google-translate';
  if (val === 'local' || val === 'llm' || val === 'ollama' || val === 'local-llm') return 'local-llm';
  if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(val)) return val;
  return null;
}

function parseProviderCliArg(args) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] || '');
    if (a.startsWith('--provider=') || a.startsWith('--adapter=')) {
      const norm = normalizeProviderName(a.slice(a.indexOf('=') + 1));
      if (norm) return norm;
    } else if ((a === '--provider' || a === '--adapter') && i + 1 < args.length) {
      const norm = normalizeProviderName(args[i + 1]);
      if (norm) return norm;
    }
  }
  return null;
}

function writeFileAtomicSync(targetPath, content, options = null) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const writeOpts =
    options && typeof options.mode === 'number'
      ? { encoding: 'utf8', mode: options.mode }
      : 'utf8';
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, content, writeOpts);
    if (options && typeof options.mode === 'number' && process.platform !== 'win32') {
      try {
        fs.chmodSync(tmpPath, options.mode);
      } catch {}
    }
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch {
      fs.copyFileSync(tmpPath, targetPath);
      if (options && typeof options.mode === 'number' && process.platform !== 'win32') {
        try {
          fs.chmodSync(targetPath, options.mode);
        } catch {}
      }
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
  }
}

function getOrSetTranslatorOptions(explicitPretranslate = null, explicitProvider = null, pathOverrides = null) {
  const configPath = (pathOverrides && pathOverrides.configPath) || CONFIG_JSON_PATH;
  const appStoragePath = (pathOverrides && pathOverrides.appStoragePath) || APP_STORAGE_PATH;
  const normalizedExplicitProvider =
    explicitProvider !== null && explicitProvider !== undefined
      ? normalizeProviderName(explicitProvider)
      : null;
  let enabled = false;
  let provider = 'google-translate';
  let appStorage = null;
  try {
    if (fs.existsSync(appStoragePath)) {
      appStorage = JSON.parse(fs.readFileSync(appStoragePath, 'utf8'));
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] app_storage.json read error: ${err.message}\n`);
  }

  try {
    let cfg = {};
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    const existingEntry = cfg?.plugins?.['ko-thought-translator'] || {};
    const configPre =
      typeof existingEntry.pretranslate === 'boolean' ? existingEntry.pretranslate : null;
    const configProv = normalizeProviderName(existingEntry.provider);
    const storagePre =
      appStorage && appStorage['agy-ko-thought-pretranslate'] !== undefined
        ? appStorage['agy-ko-thought-pretranslate'] === '1' || appStorage['agy-ko-thought-pretranslate'] === true
        : null;
    const storageProv =
      appStorage && appStorage['agy-ko-thought-provider']
        ? normalizeProviderName(appStorage['agy-ko-thought-provider'])
        : null;

    // Canonical priority: explicit CLI/UI override > config.json SSOT > app_storage.json fallback > default
    enabled =
      explicitPretranslate !== null
        ? Boolean(explicitPretranslate)
        : configPre !== null
        ? configPre
        : storagePre !== null
        ? storagePre
        : false;
    provider =
      normalizedExplicitProvider !== null
        ? normalizedExplicitProvider
        : configProv || storageProv || 'google-translate';

    if (
      explicitPretranslate !== null ||
      normalizedExplicitProvider !== null ||
      existingEntry.pretranslate !== enabled ||
      existingEntry.provider !== provider
    ) {
      cfg.plugins = cfg.plugins || {};
      cfg.plugins['ko-thought-translator'] = {
        ...existingEntry,
        enabled: existingEntry.enabled !== false,
        pretranslate: enabled,
        provider,
      };
      writeFileAtomicSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    }

    const desiredPreStr = enabled ? '1' : '0';
    if (
      appStorage &&
      (explicitPretranslate !== null ||
        normalizedExplicitProvider !== null ||
        appStorage['agy-ko-thought-pretranslate'] !== desiredPreStr ||
        appStorage['agy-ko-thought-provider'] !== provider)
    ) {
      appStorage['agy-ko-thought-pretranslate'] = desiredPreStr;
      appStorage['agy-ko-thought-provider'] = provider;
      writeFileAtomicSync(appStoragePath, JSON.stringify(appStorage, null, 2));
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] config sync error: ${err.message}\n`);
  }

  return { pretranslateEnabled: enabled, translationProvider: provider };
}

function isZombieProcStatContent(statRaw) {
  if (typeof statRaw !== 'string' || !statRaw) return false;
  const closeParen = statRaw.lastIndexOf(')');
  if (closeParen === -1) return false;
  const stateChar = statRaw.slice(closeParen + 1).trimStart()[0];
  return stateChar === 'Z' || stateChar === 'X' || stateChar === 'x';
}

function isProcessAlive(pid) {
  if (!pid || isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
  // On POSIX, `process.kill(pid, 0)` still succeeds while an exited child sits in
  // zombie (`Z`) or dead (`X`/`x`) state before its parent's event loop runs `waitpid`.
  if (process.platform === 'linux') {
    try {
      const statRaw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (isZombieProcStatContent(statRaw)) return false;
    } catch {
      return false;
    }
  } else if (process.platform === 'darwin' || process.platform === 'freebsd') {
    try {
      const res = spawnSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
      const stateStr = String(res.stdout || '').trim();
      if (!stateStr || stateStr.startsWith('Z')) return false;
    } catch {}
  }
  return true;
}

const SYNC_WAIT_INT32 =
  typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(4)) : null;

function sleepSyncMs(ms) {
  if (ms <= 0) return;
  if (SYNC_WAIT_INT32 && typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function') {
    try {
      Atomics.wait(SYNC_WAIT_INT32, 0, 0, ms);
      return;
    } catch {}
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Fallback short busy wait only when Atomics.wait is unavailable
  }
}

/**
 * Pure non-signaling liveness wait. NEVER sends SIGTERM or SIGKILL to `pid`.
 */
function waitForProcessExitSync(pid, timeoutMs = 1500) {
  if (!isProcessAlive(pid)) return true;
  const deadline = Date.now() + Math.max(20, timeoutMs);
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    sleepSyncMs(20);
  }
  return !isProcessAlive(pid);
}

function timingSafeTokenMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  if (!candidate || candidate.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

function buildWatcherSentinelEndpoint(instanceId) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\agy-ko-watch-${instanceId}`;
  }
  const uidTag = typeof process.getuid === 'function' ? String(process.getuid()) : 'u';
  const sockDir = path.join(os.tmpdir(), `agy-ko-ipc-${uidTag}`);
  try {
    fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(sockDir, 0o700);
  } catch {}
  return path.join(sockDir, `w-${instanceId}.sock`);
}

function createWatcherSentinelCredentials() {
  const instanceId = crypto.randomBytes(12).toString('hex');
  const authToken = crypto.randomBytes(24).toString('hex');
  const sentinelEndpoint = buildWatcherSentinelEndpoint(instanceId);
  return { instanceId, authToken, sentinelEndpoint };
}

function formatWatcherPidRecord(pid, sig, creds = null) {
  if (creds && creds.instanceId && creds.authToken && creds.sentinelEndpoint) {
    const endpointB64 = Buffer.from(creds.sentinelEndpoint, 'utf8').toString('base64url');
    return `${pid}:${sig}:${creds.instanceId}:${creds.authToken}:${endpointB64}`;
  }
  return `${pid}:${sig}`;
}

function readWatcherPidRecord(pidFilePath) {
  try {
    if (!pidFilePath || !fs.existsSync(pidFilePath)) {
      return { pid: null, sig: '', instanceId: '', authToken: '', sentinelEndpoint: '' };
    }
    const raw = fs.readFileSync(pidFilePath, 'utf8').trim();
    if (!raw) return { pid: null, sig: '', instanceId: '', authToken: '', sentinelEndpoint: '' };
    const parts = raw.split(':');
    const parsedPid = Number(parts[0]);
    const sig = parts[1] || '';
    const instanceId = parts[2] || '';
    const authToken = parts[3] || '';
    let sentinelEndpoint = '';
    if (parts[4]) {
      try {
        sentinelEndpoint = Buffer.from(parts[4], 'base64url').toString('utf8');
      } catch {
        sentinelEndpoint = '';
      }
    }
    return {
      pid: Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : null,
      sig,
      instanceId,
      authToken,
      sentinelEndpoint,
    };
  } catch {
    return { pid: null, sig: '', instanceId: '', authToken: '', sentinelEndpoint: '' };
  }
}

const spawnedWatcherCredsByPid = new Map();

/**
 * Spawns the background storage & app-update watcher directly via Node/libuv with
 * `windowsHide: true` (`CREATE_NO_WINDOW = 0x08000000`) and `stdio: 'ignore'`
 * so Windows never allocates a console or triggers Windows Terminal (`DefTerm`).
 */
function spawnDetachedWatcherProcess(entryScriptPath, pidFilePath = WATCHER_PID_PATH, preGeneratedCreds = null) {
  const creds =
    preGeneratedCreds &&
    preGeneratedCreds.instanceId &&
    preGeneratedCreds.authToken &&
    preGeneratedCreds.sentinelEndpoint
      ? preGeneratedCreds
      : createWatcherSentinelCredentials();
  const childEnv = {
    ...process.env,
    AGY_KO_WATCHER_SENTINEL_CFG: JSON.stringify(creds),
  };
  if (pidFilePath && pidFilePath !== WATCHER_PID_PATH) {
    childEnv.AGY_KO_WATCHER_PID_PATH = pidFilePath;
  }
  const child = spawn(process.execPath, [entryScriptPath, '--watch-storage'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: childEnv,
  });
  child.unref();
  if (child.pid) {
    if (spawnedWatcherCredsByPid.size >= 64) {
      const oldest = spawnedWatcherCredsByPid.keys().next().value;
      if (oldest !== undefined) spawnedWatcherCredsByPid.delete(oldest);
    }
    spawnedWatcherCredsByPid.set(child.pid, creds);
  }
  return child.pid || null;
}

function requestWatcherShutdownViaSentinelSync(record, timeoutMs = 1000) {
  if (!record || !record.sentinelEndpoint || !record.authToken || !record.instanceId) {
    return false;
  }
  try {
    const res = spawnSync(process.execPath, [__filename, '--watcher-sentinel-stop'], {
      env: {
        ...process.env,
        AGY_KO_WATCHER_STOP_REQ: JSON.stringify({
          sentinelEndpoint: record.sentinelEndpoint,
          authToken: record.authToken,
          instanceId: record.instanceId,
          timeoutMs: Math.max(150, timeoutMs),
        }),
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: Math.max(400, timeoutMs + 400),
    });
    return Boolean(res && res.status === 0);
  } catch {
    return false;
  }
}

function computeWatcherSignature(entryScriptPath) {
  const files = [
    entryScriptPath,
    __filename,
    path.join(__dirname, 'bundle-injector.js'),
    path.join(__dirname, 'local-llm-service.js'),
  ];
  return files
    .map((f) => {
      try {
        return Math.floor(fs.statSync(f).mtimeMs);
      } catch {
        return 0;
      }
    })
    .join('-');
}

function acquireExclusiveFileLock(lockPath, staleMs = 15000) {
  const token = `${process.pid}:${Date.now()}:${crypto.randomBytes(6).toString('hex')}`;
  const tryOpenWx = () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, ts: Date.now() }), 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    return token;
  };

  try {
    return tryOpenWx();
  } catch (err) {
    if (!err || err.code !== 'EEXIST') return null;
  }

  let reclaimPath = null;
  try {
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    let staleRaw = '';
    let staleToken = null;
    let ownerPid = 0;
    try {
      staleRaw = fs.readFileSync(lockPath, 'utf8');
      const parsed = JSON.parse(staleRaw);
      ownerPid = Number(parsed?.pid || 0);
      staleToken = typeof parsed?.token === 'string' ? parsed.token : null;
    } catch {}
    const ownerAlive = ownerPid > 0 && isProcessAlive(ownerPid);
    const isStale = (ownerPid > 0 && !ownerAlive) || ageMs > staleMs;
    if (!isStale) return null;

    reclaimPath = `${lockPath}.reclaim.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockPath, reclaimPath);
    } catch {
      reclaimPath = null;
      return null;
    }

    let displacedNewLock = false;
    try {
      const movedRaw = fs.readFileSync(reclaimPath, 'utf8');
      let moved = null;
      try {
        moved = JSON.parse(movedRaw);
      } catch {}
      if (staleToken !== null) {
        if (!moved || moved.token !== staleToken) {
          displacedNewLock = true;
        }
      } else if (movedRaw !== staleRaw) {
        displacedNewLock = true;
      }
      if (!displacedNewLock && moved) {
        const movedPid = Number(moved.pid || 0);
        const movedStat = fs.statSync(reclaimPath);
        const movedAgeMs = Date.now() - movedStat.mtimeMs;
        const movedAlive = movedPid > 0 && isProcessAlive(movedPid);
        const stillStale = (movedPid > 0 && !movedAlive) || movedAgeMs > staleMs;
        if (!stillStale) {
          displacedNewLock = true;
        }
      }
    } catch {
      displacedNewLock = true;
    }

    if (displacedNewLock) {
      restoreDisplacedExclusiveLock(reclaimPath, lockPath);
      try {
        fs.unlinkSync(reclaimPath);
      } catch {}
      reclaimPath = null;
      return null;
    }

    try {
      fs.unlinkSync(reclaimPath);
    } catch {}
    reclaimPath = null;
    return tryOpenWx();
  } catch {
    if (reclaimPath && fs.existsSync(reclaimPath)) {
      try {
        restoreDisplacedExclusiveLock(reclaimPath, lockPath);
        fs.unlinkSync(reclaimPath);
      } catch {}
    }
    return null;
  }
}

function restoreDisplacedExclusiveLock(relPath, lockPath) {
  try {
    fs.linkSync(relPath, lockPath);
    return true;
  } catch (linkErr) {
    if (linkErr && linkErr.code === 'EEXIST') {
      return true;
    }
    try {
      const rawBytes = fs.readFileSync(relPath);
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, rawBytes);
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (wxErr) {
      return Boolean(wxErr && wxErr.code === 'EEXIST');
    }
  }
}

function releaseExclusiveFileLock(lockPath, token) {
  if (!lockPath || !token) return false;
  let relPath = null;
  try {
    if (!fs.existsSync(lockPath)) return false;
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!parsed || parsed.token !== token) return false;
    relPath = `${lockPath}.rel.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.renameSync(lockPath, relPath);
    let moved = null;
    try {
      moved = JSON.parse(fs.readFileSync(relPath, 'utf8'));
    } catch {}
    if (!moved || moved.token !== token) {
      restoreDisplacedExclusiveLock(relPath, lockPath);
      try {
        fs.unlinkSync(relPath);
      } catch {}
      return false;
    }
    try {
      fs.unlinkSync(relPath);
    } catch {}
    return true;
  } catch {
    if (relPath && fs.existsSync(relPath)) {
      try {
        const moved = JSON.parse(fs.readFileSync(relPath, 'utf8'));
        if (!moved || moved.token !== token) {
          restoreDisplacedExclusiveLock(relPath, lockPath);
        }
        fs.unlinkSync(relPath);
      } catch {}
    }
    return false;
  }
}

function ensureStorageWatcher(entryScriptPath, options = {}) {
  try {
    const pidFilePath =
      (options && options.watcherPidPath) || process.env.AGY_KO_WATCHER_PID_PATH || WATCHER_PID_PATH;
    const lockPath = (options && options.watcherLockPath) || `${pidFilePath}.lock`;
    const spawnFn =
      options && typeof options.spawnFn === 'function' ? options.spawnFn : spawnDetachedWatcherProcess;
    const fastHook = Boolean(options && options.fastHook);
    const exitWaitTimeoutMs =
      options && typeof options.exitWaitTimeoutMs === 'number'
        ? options.exitWaitTimeoutMs
        : fastHook
        ? 350
        : 1500;
    const lockBudgetMs =
      options && typeof options.lockWaitTimeoutMs === 'number'
        ? options.lockWaitTimeoutMs
        : fastHook
        ? 1200
        : 2000;
    const mySig = computeWatcherSignature(entryScriptPath);

    // Fast lock-free check when an up-to-date live watcher already owns pidFilePath
    const fastExisting = readWatcherPidRecord(pidFilePath);
    if (fastExisting.pid && fastExisting.sig === mySig && isProcessAlive(fastExisting.pid)) {
      return fastExisting.pid;
    }

    let lockToken = null;
    const lockDeadline = Date.now() + Math.max(60, lockBudgetMs);
    while (Date.now() < lockDeadline) {
      lockToken = acquireExclusiveFileLock(lockPath, 15000);
      if (lockToken) break;
      const peerRecord = readWatcherPidRecord(pidFilePath);
      if (peerRecord.pid && peerRecord.sig === mySig && isProcessAlive(peerRecord.pid)) {
        return peerRecord.pid;
      }
      sleepSyncMs(20);
    }
    if (!lockToken) {
      const peerRecord = readWatcherPidRecord(pidFilePath);
      return peerRecord.pid && isProcessAlive(peerRecord.pid) ? peerRecord.pid : null;
    }

    try {
      const existing = readWatcherPidRecord(pidFilePath);
      if (existing.pid && isProcessAlive(existing.pid)) {
        if (existing.sig === mySig) {
          return existing.pid;
        }
        // Authenticate with the live watcher's cryptographic IPC sentinel before waiting.
        // Unauthenticated or recycled PIDs receive ZERO OS signals (never SIGTERM/SIGKILL).
        const stoppedViaSentinel = requestWatcherShutdownViaSentinelSync(existing, exitWaitTimeoutMs);
        if (stoppedViaSentinel) {
          waitForProcessExitSync(existing.pid, exitWaitTimeoutMs);
        }
      }

      const preGeneratedCreds = createWatcherSentinelCredentials();
      const hadPrevSentinelEnv = Object.prototype.hasOwnProperty.call(
        process.env,
        'AGY_KO_WATCHER_SENTINEL_CFG'
      );
      const prevSentinelEnv = process.env.AGY_KO_WATCHER_SENTINEL_CFG;
      process.env.AGY_KO_WATCHER_SENTINEL_CFG = JSON.stringify(preGeneratedCreds);
      let spawnedPid;
      try {
        spawnedPid = spawnFn(entryScriptPath, pidFilePath, preGeneratedCreds);
      } finally {
        if (hadPrevSentinelEnv) {
          process.env.AGY_KO_WATCHER_SENTINEL_CFG = prevSentinelEnv;
        } else {
          delete process.env.AGY_KO_WATCHER_SENTINEL_CFG;
        }
      }
      if (spawnedPid) {
        const mappedCreds = spawnedWatcherCredsByPid.get(spawnedPid) || null;
        spawnedWatcherCredsByPid.delete(spawnedPid);
        const afterSpawnRec = readWatcherPidRecord(pidFilePath);
        if (
          afterSpawnRec.pid === spawnedPid &&
          afterSpawnRec.instanceId &&
          afterSpawnRec.authToken &&
          afterSpawnRec.sentinelEndpoint
        ) {
          if (afterSpawnRec.sig !== mySig) {
            writeFileAtomicSync(
              pidFilePath,
              formatWatcherPidRecord(spawnedPid, mySig, {
                instanceId: afterSpawnRec.instanceId,
                authToken: afterSpawnRec.authToken,
                sentinelEndpoint: afterSpawnRec.sentinelEndpoint,
              }),
              { mode: 0o600 }
            );
          }
        } else {
          const effectiveCreds = mappedCreds || preGeneratedCreds;
          writeFileAtomicSync(pidFilePath, formatWatcherPidRecord(spawnedPid, mySig, effectiveCreds), {
            mode: 0o600,
          });
        }
      }
      return spawnedPid;
    } finally {
      releaseExclusiveFileLock(lockPath, lockToken);
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] ensureStorageWatcher error: ${err.message}\n`);
    return null;
  }
}

function readCurrentDevToolsPort(portFilePath = DEVTOOLS_PORT_FILE) {
  try {
    if (!portFilePath || !fs.existsSync(portFilePath)) return null;
    const lines = fs.readFileSync(portFilePath, 'utf8').trim().split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    return port && !Number.isNaN(port) ? port : null;
  } catch {
    return null;
  }
}

function isAsarCurrentlyPatched() {
  try {
    if (!fs.existsSync(ASAR_PATH) || !fs.existsSync(ENSURE_STATUSBAR_PATCH_PATH)) {
      return true;
    }
    const patcher = require(ENSURE_STATUSBAR_PATCH_PATH);
    if (patcher && typeof patcher.isAsarPatchedFast === 'function') {
      return Boolean(patcher.isAsarPatchedFast(ASAR_PATH));
    }
    return true;
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] isAsarCurrentlyPatched error: ${err.message}\n`);
    return true;
  }
}

function runStorageWatcherLoop({
  entryScriptPath,
  onSettingsChanged,
  onAppRecoveryNeeded,
  watcherPidPath = null,
  appStoragePath = null,
  configPath = null,
  devtoolsPortFile = null,
  isAsarPatchedFn = null,
  pollIntervalMs = 400,
}) {
  const pidFilePath = watcherPidPath || process.env.AGY_KO_WATCHER_PID_PATH || WATCHER_PID_PATH;
  const effectiveAppStoragePath = appStoragePath || APP_STORAGE_PATH;
  const effectiveConfigPath = configPath || CONFIG_JSON_PATH;
  const effectiveDevtoolsPortFile = devtoolsPortFile || DEVTOOLS_PORT_FILE;
  const checkAsarPatched = typeof isAsarPatchedFn === 'function' ? isAsarPatchedFn : isAsarCurrentlyPatched;
  const pathOverrides = {
    configPath: effectiveConfigPath,
    appStoragePath: effectiveAppStoragePath,
  };

  let creds = null;
  if (process.env.AGY_KO_WATCHER_SENTINEL_CFG) {
    try {
      creds = JSON.parse(process.env.AGY_KO_WATCHER_SENTINEL_CFG);
    } catch {
      creds = null;
    }
    delete process.env.AGY_KO_WATCHER_SENTINEL_CFG;
  }
  if (!creds || !creds.instanceId || !creds.authToken || !creds.sentinelEndpoint) {
    creds = createWatcherSentinelCredentials();
  }

  const mySig = computeWatcherSignature(entryScriptPath);
  try {
    const existing = readWatcherPidRecord(pidFilePath);
    if (existing.pid && existing.pid !== process.pid && existing.sig === mySig && isProcessAlive(existing.pid)) {
      return {
        stop() {},
        isStopped: () => true,
      };
    }
    if (existing.pid !== process.pid || existing.sig !== mySig || existing.instanceId !== creds.instanceId) {
      writeFileAtomicSync(pidFilePath, formatWatcherPidRecord(process.pid, mySig, creds), { mode: 0o600 });
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] watcher pid write error: ${err.message}\n`);
  }

  let stopped = false;
  let intervalHandle = null;
  let pidDirWatcher = null;
  let sentinelServer = null;
  const followupTimers = new Set();

  const hasWatcherOwnership = () => {
    if (stopped) return false;
    const cur = readWatcherPidRecord(pidFilePath);
    if (cur.pid !== process.pid) return false;
    if (cur.instanceId && creds.instanceId && cur.instanceId !== creds.instanceId) return false;
    return true;
  };

  const cleanupSentinelSocket = () => {
    if (sentinelServer) {
      try {
        sentinelServer.close();
      } catch {}
      sentinelServer = null;
    }
    if (process.platform !== 'win32' && creds && creds.sentinelEndpoint) {
      try {
        if (fs.existsSync(creds.sentinelEndpoint)) {
          fs.unlinkSync(creds.sentinelEndpoint);
        }
      } catch {}
    }
  };

  const stopWatcherLoop = ({ removeOwnPidFile = false } = {}) => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (stopped) return;
    stopped = true;
    cleanupSentinelSocket();
    if (pidDirWatcher) {
      try {
        pidDirWatcher.close();
      } catch {}
      pidDirWatcher = null;
    }
    for (const timer of followupTimers) {
      clearTimeout(timer);
    }
    followupTimers.clear();
    process.removeListener('SIGTERM', onSignalTerminate);
    process.removeListener('SIGINT', onSignalTerminate);
    if (removeOwnPidFile) {
      const cur = readWatcherPidRecord(pidFilePath);
      if (cur.pid === process.pid && (!cur.instanceId || cur.instanceId === creds.instanceId)) {
        try {
          fs.unlinkSync(pidFilePath);
        } catch {}
      }
    }
  };

  try {
    if (process.platform !== 'win32' && fs.existsSync(creds.sentinelEndpoint)) {
      try {
        fs.unlinkSync(creds.sentinelEndpoint);
      } catch {}
    }
    sentinelServer = net.createServer((conn) => {
      let rawBuf = '';
      conn.setEncoding('utf8');
      conn.on('error', () => {});
      conn.on('data', (chunk) => {
        if (rawBuf.length + chunk.length > 4096) {
          conn.destroy();
          return;
        }
        rawBuf += chunk;
        const nlIdx = rawBuf.indexOf('\n');
        if (nlIdx === -1) return;
        const line = rawBuf.slice(0, nlIdx).trim();
        rawBuf = '';
        let msg = null;
        try {
          msg = JSON.parse(line);
        } catch {
          conn.destroy();
          return;
        }
        if (!msg || !timingSafeTokenMatch(msg.authToken, creds.authToken)) {
          try {
            conn.end(JSON.stringify({ ok: false, error: 'unauthorized' }) + '\n');
          } catch {}
          return;
        }
        if (msg.op === 'shutdown') {
          try {
            conn.end(JSON.stringify({ ok: true, instanceId: creds.instanceId, pid: process.pid }) + '\n');
          } catch {}
          stopWatcherLoop({ removeOwnPidFile: false });
          return;
        }
        try {
          conn.end(JSON.stringify({ ok: true, instanceId: creds.instanceId, pid: process.pid }) + '\n');
        } catch {}
      });
    });
    sentinelServer.on('error', () => {});
    sentinelServer.listen(creds.sentinelEndpoint, () => {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(creds.sentinelEndpoint, 0o600);
        } catch {}
      }
    });
    if (typeof sentinelServer.unref === 'function') {
      sentinelServer.unref();
    }
  } catch {}

  function onSignalTerminate() {
    stopWatcherLoop({ removeOwnPidFile: true });
  }
  process.on('SIGTERM', onSignalTerminate);
  process.on('SIGINT', onSignalTerminate);

  const initialCanonical = getOrSetTranslatorOptions(null, null, pathOverrides);
  let lastProvider = initialCanonical.translationProvider;
  let lastPretranslate = initialCanonical.pretranslateEnabled;
  let lastDevToolsPort = readCurrentDevToolsPort(effectiveDevtoolsPortFile);
  let lastStorageMtimeMs = -1;
  let lastStorageSize = -1;
  let tickCount = 0;
  let busy = false;

  const triggerRecovery = async (reason) => {
    if (!hasWatcherOwnership()) {
      stopWatcherLoop({ removeOwnPidFile: false });
      return;
    }
    if (typeof onAppRecoveryNeeded === 'function') {
      try {
        await onAppRecoveryNeeded({ reason });
      } catch (err) {
        process.stderr.write(`[ko-thought-translator] recovery error (${reason}): ${err.message}\n`);
      }
    }
  };

  const scheduleFollowupRecovery = (reason, delayMs) => {
    const t = setTimeout(() => {
      followupTimers.delete(t);
      if (!hasWatcherOwnership()) {
        stopWatcherLoop({ removeOwnPidFile: false });
        return;
      }
      void triggerRecovery(reason);
    }, delayMs);
    followupTimers.add(t);
  };

  const checkStorageAndAppHealth = async () => {
    if (!hasWatcherOwnership()) {
      stopWatcherLoop({ removeOwnPidFile: false });
      return;
    }
    if (busy) return;
    busy = true;
    tickCount++;
    try {
      // 1. Check Native Settings UI changes in app_storage.json (skip readFileSync + JSON.parse when mtimeMs & size are unchanged)
      if (fs.existsSync(effectiveAppStoragePath)) {
        const stat = fs.statSync(effectiveAppStoragePath);
        if (stat.mtimeMs !== lastStorageMtimeMs || stat.size !== lastStorageSize) {
          lastStorageMtimeMs = stat.mtimeMs;
          lastStorageSize = stat.size;
          const appStorage = JSON.parse(fs.readFileSync(effectiveAppStoragePath, 'utf8'));
          const curProvider =
            normalizeProviderName(appStorage['agy-ko-thought-provider']) || lastProvider || 'google-translate';
          const curPre =
            appStorage['agy-ko-thought-pretranslate'] === '1' || appStorage['agy-ko-thought-pretranslate'] === true;

          if (lastProvider === null) {
            lastProvider = curProvider;
            lastPretranslate = curPre;
          } else if (curProvider !== lastProvider || curPre !== lastPretranslate) {
            if (!hasWatcherOwnership()) {
              stopWatcherLoop({ removeOwnPidFile: false });
              return;
            }
            const prevProvider = lastProvider;
            lastProvider = curProvider;
            lastPretranslate = curPre;
            const opts = getOrSetTranslatorOptions(curPre, curProvider, pathOverrides);
            if (typeof onSettingsChanged === 'function' && hasWatcherOwnership()) {
              await onSettingsChanged({
                pretranslateEnabled: opts.pretranslateEnabled,
                translationProvider: opts.translationProvider,
                prevProvider,
              });
            }
          }
        }
      }

      // 2. Every 5 ticks (~2000ms by default), verify app.asar patch state & DevToolsActivePort for app update / restart recovery
      if (tickCount % 5 === 0) {
        if (!hasWatcherOwnership()) {
          stopWatcherLoop({ removeOwnPidFile: false });
          return;
        }
        const curPort = readCurrentDevToolsPort(effectiveDevtoolsPortFile);
        const portChanged = curPort !== null && curPort !== lastDevToolsPort;
        if (curPort !== null) {
          lastDevToolsPort = curPort;
        }
        const asarUnpatched = !checkAsarPatched();

        if (asarUnpatched || portChanged) {
          await triggerRecovery(asarUnpatched ? 'asar_unpatched' : 'devtools_port_changed');
          if (portChanged && hasWatcherOwnership()) {
            scheduleFollowupRecovery('devtools_port_followup_2s', 2000);
            scheduleFollowupRecovery('devtools_port_followup_5s', 5000);
          }
        }
      }
    } catch (err) {
      process.stderr.write(`[ko-thought-translator] watcher check error: ${err.message}\n`);
    } finally {
      busy = false;
    }
  };

  try {
    const pidDir = path.dirname(pidFilePath);
    const pidBase = path.basename(pidFilePath);
    if (fs.existsSync(pidDir)) {
      pidDirWatcher = fs.watch(pidDir, { persistent: false }, (_eventType, filename) => {
        if (!filename || filename === pidBase) {
          if (!hasWatcherOwnership()) {
            stopWatcherLoop({ removeOwnPidFile: false });
          }
        }
      });
      pidDirWatcher.on('error', () => {});
    }
  } catch {}

  void checkStorageAndAppHealth();
  if (!stopped) {
    intervalHandle = setInterval(checkStorageAndAppHealth, Math.max(15, Number(pollIntervalMs) || 400));
  }
  return {
    stop: () => stopWatcherLoop({ removeOwnPidFile: true }),
    isStopped: () => stopped,
  };
}

function runWatcherSentinelStopCli() {
  let reqCfg = null;
  try {
    reqCfg = JSON.parse(process.env.AGY_KO_WATCHER_STOP_REQ || '{}');
  } catch {
    process.exit(1);
    return;
  }
  const { sentinelEndpoint, authToken, instanceId, timeoutMs = 1000 } = reqCfg || {};
  if (!sentinelEndpoint || !authToken || !instanceId) {
    process.exit(1);
    return;
  }
  let done = false;
  const finish = (code) => {
    if (done) return;
    done = true;
    process.exit(code);
  };
  const timer = setTimeout(() => finish(1), Math.max(150, Number(timeoutMs) || 1000));
  if (timer && typeof timer.unref === 'function') timer.unref();

  try {
    const sock = net.createConnection(sentinelEndpoint);
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => {
      sock.write(JSON.stringify({ op: 'shutdown', authToken }) + '\n');
    });
    sock.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      try {
        const reply = JSON.parse(buf.slice(0, nl).trim());
        sock.destroy();
        if (reply && reply.ok === true && reply.instanceId === instanceId) {
          finish(0);
          return;
        }
      } catch {}
      finish(1);
    });
    sock.on('error', () => finish(1));
    sock.on('close', () => finish(1));
  } catch {
    finish(1);
  }
}

if (require.main === module && process.argv.includes('--watcher-sentinel-stop')) {
  runWatcherSentinelStopCli();
}

module.exports = {
  isPluginEnabled,
  parsePretranslateCliArg,
  normalizeProviderName,
  parseProviderCliArg,
  writeFileAtomicSync,
  getOrSetTranslatorOptions,
  isZombieProcStatContent,
  isProcessAlive,
  waitForProcessExitSync,
  readWatcherPidRecord,
  acquireExclusiveFileLock,
  releaseExclusiveFileLock,
  spawnDetachedWatcherProcess,
  ensureStorageWatcher,
  runStorageWatcherLoop,
  isAsarCurrentlyPatched,
};
