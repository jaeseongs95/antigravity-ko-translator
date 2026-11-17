/**
 * Module: scripts/host/settings-storage.js
 * Responsibility: Translator option persistence (`config.json` & `app_storage.json`), CLI flag parsing,
 * and headless background watcher process (`windowsHide: true` / `CREATE_NO_WINDOW`) for real-time
 * Native Settings UI synchronization and automatic recovery after Antigravity app updates or restarts.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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
      const val = a.split('=')[1].trim().toLowerCase();
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
  if (/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(val)) return val;
  return null;
}

function parseProviderCliArg(args) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] || '');
    if (a.startsWith('--provider=') || a.startsWith('--adapter=')) {
      const norm = normalizeProviderName(a.split('=')[1]);
      if (norm) return norm;
    } else if ((a === '--provider' || a === '--adapter') && i + 1 < args.length) {
      const norm = normalizeProviderName(args[i + 1]);
      if (norm) return norm;
    }
  }
  return null;
}

function writeFileAtomicSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch {
      fs.copyFileSync(tmpPath, targetPath);
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

function isProcessAlive(pid) {
  if (!pid || isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

function waitForProcessExitSync(pid, timeoutMs = 1500) {
  if (!isProcessAlive(pid)) return true;
  const deadline = Date.now() + Math.max(50, timeoutMs);
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    sleepSyncMs(20);
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
    const forceDeadline = Date.now() + 300;
    while (Date.now() < forceDeadline) {
      if (!isProcessAlive(pid)) return true;
      sleepSyncMs(20);
    }
  }
  return !isProcessAlive(pid);
}

function readWatcherPidRecord(pidFilePath) {
  try {
    if (!pidFilePath || !fs.existsSync(pidFilePath)) {
      return { pid: null, sig: '' };
    }
    const raw = fs.readFileSync(pidFilePath, 'utf8').trim();
    if (!raw) return { pid: null, sig: '' };
    const sepIdx = raw.indexOf(':');
    const pidStr = sepIdx === -1 ? raw : raw.slice(0, sepIdx);
    const sig = sepIdx === -1 ? '' : raw.slice(sepIdx + 1);
    const parsedPid = Number(pidStr);
    return {
      pid: Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : null,
      sig,
    };
  } catch {
    return { pid: null, sig: '' };
  }
}

/**
 * Spawns the background storage & app-update watcher directly via Node/libuv with
 * `windowsHide: true` (`CREATE_NO_WINDOW = 0x08000000`) and `stdio: 'ignore'`
 * so Windows never allocates a console or triggers Windows Terminal (`DefTerm`).
 */
function spawnDetachedWatcherProcess(entryScriptPath, pidFilePath = WATCHER_PID_PATH) {
  const childEnv = { ...process.env };
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
  return child.pid || null;
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

function ensureStorageWatcher(entryScriptPath, options = {}) {
  try {
    const pidFilePath =
      (options && options.watcherPidPath) || process.env.AGY_KO_WATCHER_PID_PATH || WATCHER_PID_PATH;
    const spawnFn =
      options && typeof options.spawnFn === 'function' ? options.spawnFn : spawnDetachedWatcherProcess;
    const exitWaitTimeoutMs =
      options && typeof options.exitWaitTimeoutMs === 'number' ? options.exitWaitTimeoutMs : 1500;
    const mySig = computeWatcherSignature(entryScriptPath);

    const existing = readWatcherPidRecord(pidFilePath);
    if (existing.pid && isProcessAlive(existing.pid)) {
      if (existing.sig === mySig) {
        return existing.pid;
      }
      try {
        process.kill(existing.pid, 'SIGTERM');
      } catch (killErr) {
        if (killErr && killErr.code !== 'ESRCH') {
          process.stderr.write(
            `[ko-thought-translator] Failed to terminate stale watcher ${existing.pid}: ${killErr.message}\n`
          );
        }
      }
      waitForProcessExitSync(existing.pid, exitWaitTimeoutMs);
    }

    const spawnedPid = spawnFn(entryScriptPath, pidFilePath);
    if (spawnedPid) {
      writeFileAtomicSync(pidFilePath, `${spawnedPid}:${mySig}`);
    }
    return spawnedPid;
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

  try {
    const existing = readWatcherPidRecord(pidFilePath);
    if (existing.pid && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
      return {
        stop() {},
        isStopped: () => true,
      };
    }
    const mySig = computeWatcherSignature(entryScriptPath);
    writeFileAtomicSync(pidFilePath, `${process.pid}:${mySig}`);
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] watcher pid write error: ${err.message}\n`);
  }

  let stopped = false;
  let intervalHandle = null;
  const followupTimers = new Set();

  const hasWatcherOwnership = () => !stopped && readWatcherPidRecord(pidFilePath).pid === process.pid;

  const stopWatcherLoop = ({ removeOwnPidFile = false } = {}) => {
    if (stopped) return;
    stopped = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    for (const timer of followupTimers) {
      clearTimeout(timer);
    }
    followupTimers.clear();
    process.removeListener('SIGTERM', onSignalTerminate);
    process.removeListener('SIGINT', onSignalTerminate);
    if (removeOwnPidFile && readWatcherPidRecord(pidFilePath).pid === process.pid) {
      try {
        fs.unlinkSync(pidFilePath);
      } catch {}
    }
  };

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

  void checkStorageAndAppHealth();
  intervalHandle = setInterval(checkStorageAndAppHealth, Math.max(15, Number(pollIntervalMs) || 400));
  return {
    stop: () => stopWatcherLoop({ removeOwnPidFile: true }),
    isStopped: () => stopped,
  };
}

module.exports = {
  isPluginEnabled,
  parsePretranslateCliArg,
  normalizeProviderName,
  parseProviderCliArg,
  writeFileAtomicSync,
  getOrSetTranslatorOptions,
  isProcessAlive,
  waitForProcessExitSync,
  spawnDetachedWatcherProcess,
  ensureStorageWatcher,
  runStorageWatcherLoop,
  isAsarCurrentlyPatched,
};
