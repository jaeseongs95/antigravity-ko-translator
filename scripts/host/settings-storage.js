/**
 * Module: scripts/host/settings-storage.js
 * Responsibility: Translator option persistence (`config.json` & `app_storage.json`), CLI flag parsing,
 * and headless background watcher process (`windowsHide: true` / `CREATE_NO_WINDOW`) for real-time
 * Native Settings UI synchronization and automatic recovery after Antigravity app updates or restarts.
 */

const fs = require('fs');
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
  if (val === 'google' || val === 'gtx' || val === 'google-translate') return 'google-translate';
  if (val === 'local' || val === 'llm' || val === 'ollama' || val === 'local-llm') return 'local-llm';
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

function getOrSetTranslatorOptions(explicitPretranslate = null, explicitProvider = null) {
  let enabled = false;
  let provider = 'local-llm';
  let appStorage = null;
  try {
    if (fs.existsSync(APP_STORAGE_PATH)) {
      appStorage = JSON.parse(fs.readFileSync(APP_STORAGE_PATH, 'utf8'));
    }
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] app_storage.json read error: ${err.message}\n`);
  }

  try {
    let cfg = {};
    if (fs.existsSync(CONFIG_JSON_PATH)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8'));
    }
    const existingEntry = cfg?.plugins?.['ko-thought-translator'] || {};
    const storagePre =
      appStorage && appStorage['agy-ko-thought-pretranslate'] !== undefined
        ? appStorage['agy-ko-thought-pretranslate'] === '1' || appStorage['agy-ko-thought-pretranslate'] === true
        : null;
    const storageProv =
      appStorage && appStorage['agy-ko-thought-provider']
        ? normalizeProviderName(appStorage['agy-ko-thought-provider'])
        : null;

    enabled =
      explicitPretranslate !== null
        ? Boolean(explicitPretranslate)
        : storagePre !== null
        ? storagePre
        : existingEntry.pretranslate === true;
    provider =
      explicitProvider !== null
        ? explicitProvider
        : storageProv || normalizeProviderName(existingEntry.provider) || 'local-llm';

    if (
      explicitPretranslate !== null ||
      explicitProvider !== null ||
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
      fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    }

    if (
      appStorage &&
      (explicitPretranslate !== null ||
        explicitProvider !== null ||
        appStorage['agy-ko-thought-pretranslate'] === undefined ||
        appStorage['agy-ko-thought-provider'] === undefined)
    ) {
      appStorage['agy-ko-thought-pretranslate'] = enabled ? '1' : '0';
      appStorage['agy-ko-thought-provider'] = provider;
      fs.writeFileSync(APP_STORAGE_PATH, JSON.stringify(appStorage, null, 2), 'utf8');
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

/**
 * Spawns the background storage & app-update watcher directly via Node/libuv with
 * `windowsHide: true` (`CREATE_NO_WINDOW = 0x08000000`) and `stdio: 'ignore'`
 * so Windows never allocates a console or triggers Windows Terminal (`DefTerm`).
 */
function spawnDetachedWatcherProcess(entryScriptPath) {
  const child = spawn(process.execPath, [entryScriptPath, '--watch-storage'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  return child.pid || null;
}

function ensureStorageWatcher(entryScriptPath) {
  try {
    const mySig = String(Math.floor(fs.statSync(entryScriptPath).mtimeMs));
    if (fs.existsSync(WATCHER_PID_PATH)) {
      const raw = fs.readFileSync(WATCHER_PID_PATH, 'utf8').trim();
      const [pidStr, sig] = raw.split(':');
      const existingPid = Number(pidStr);
      if (isProcessAlive(existingPid)) {
        if (sig === mySig) {
          return existingPid;
        }
        try {
          process.kill(existingPid, 'SIGTERM');
        } catch (killErr) {
          if (killErr && killErr.code !== 'ESRCH') {
            process.stderr.write(`[ko-thought-translator] Failed to terminate stale watcher ${existingPid}: ${killErr.message}\n`);
          }
        }
      }
    }
    const spawnedPid = spawnDetachedWatcherProcess(entryScriptPath);
    if (spawnedPid) {
      fs.writeFileSync(WATCHER_PID_PATH, `${spawnedPid}:${mySig}`, 'utf8');
    }
    return spawnedPid;
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] ensureStorageWatcher error: ${err.message}\n`);
    return null;
  }
}

function readCurrentDevToolsPort() {
  try {
    if (!fs.existsSync(DEVTOOLS_PORT_FILE)) return null;
    const lines = fs.readFileSync(DEVTOOLS_PORT_FILE, 'utf8').trim().split(/\r?\n/);
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

function runStorageWatcherLoop({ entryScriptPath, onSettingsChanged, onAppRecoveryNeeded }) {
  try {
    const mySig = String(Math.floor(fs.statSync(entryScriptPath).mtimeMs));
    fs.writeFileSync(WATCHER_PID_PATH, `${process.pid}:${mySig}`, 'utf8');
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] watcher pid write error: ${err.message}\n`);
  }
  let lastProvider = null;
  let lastPretranslate = null;
  let lastDevToolsPort = readCurrentDevToolsPort();
  let tickCount = 0;
  let busy = false;

  const triggerRecovery = async (reason) => {
    if (typeof onAppRecoveryNeeded === 'function') {
      try {
        await onAppRecoveryNeeded({ reason });
      } catch (err) {
        process.stderr.write(`[ko-thought-translator] recovery error (${reason}): ${err.message}\n`);
      }
    }
  };

  const checkStorageAndAppHealth = async () => {
    if (busy) return;
    busy = true;
    tickCount++;
    try {
      // 1. Check Native Settings UI changes in app_storage.json every 400ms
      if (fs.existsSync(APP_STORAGE_PATH)) {
        const appStorage = JSON.parse(fs.readFileSync(APP_STORAGE_PATH, 'utf8'));
        const curProvider = normalizeProviderName(appStorage['agy-ko-thought-provider']) || 'local-llm';
        const curPre =
          appStorage['agy-ko-thought-pretranslate'] === '1' || appStorage['agy-ko-thought-pretranslate'] === true;

        if (lastProvider === null) {
          lastProvider = curProvider;
          lastPretranslate = curPre;
        } else if (curProvider !== lastProvider || curPre !== lastPretranslate) {
          const prevProvider = lastProvider;
          lastProvider = curProvider;
          lastPretranslate = curPre;
          const opts = getOrSetTranslatorOptions(curPre, curProvider);
          if (typeof onSettingsChanged === 'function') {
            await onSettingsChanged({
              pretranslateEnabled: opts.pretranslateEnabled,
              translationProvider: opts.translationProvider,
              prevProvider,
            });
          }
        }
      }

      // 2. Every ~2000ms (5 ticks), verify app.asar patch state & DevToolsActivePort for app update / restart recovery
      if (tickCount % 5 === 0) {
        const curPort = readCurrentDevToolsPort();
        const portChanged = curPort !== null && curPort !== lastDevToolsPort;
        if (curPort !== null) {
          lastDevToolsPort = curPort;
        }
        const asarUnpatched = !isAsarCurrentlyPatched();

        if (asarUnpatched || portChanged) {
          await triggerRecovery(asarUnpatched ? 'asar_unpatched' : 'devtools_port_changed');
          if (portChanged) {
            setTimeout(() => void triggerRecovery('devtools_port_followup_2s'), 2000);
            setTimeout(() => void triggerRecovery('devtools_port_followup_5s'), 5000);
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
  setInterval(checkStorageAndAppHealth, 400);
}

module.exports = {
  isPluginEnabled,
  parsePretranslateCliArg,
  normalizeProviderName,
  parseProviderCliArg,
  getOrSetTranslatorOptions,
  ensureStorageWatcher,
  runStorageWatcherLoop,
  isAsarCurrentlyPatched,
};
