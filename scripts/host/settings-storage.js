/**
 * Module: scripts/host/settings-storage.js
 * Responsibility: Translator option persistence (`config.json` & `app_storage.json`), CLI flag parsing,
 * and background watcher process for real-time Native Settings UI synchronization.
 */

const fs = require('fs');
const { spawn } = require('child_process');
const { APP_STORAGE_PATH, CONFIG_JSON_PATH, WATCHER_PID_PATH } = require('./paths');

function isPluginEnabled() {
  try {
    if (!fs.existsSync(CONFIG_JSON_PATH)) return true;
    const cfg = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8'));
    const entry = cfg?.plugins?.['ko-thought-translator'];
    if (entry && entry.enabled === false) return false;
    return true;
  } catch {
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
  } catch {}

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
  } catch {}

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
        } catch {}
      }
    }
    const child = spawn(process.execPath, [entryScriptPath, '--watch-storage'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env },
    });
    child.unref();
    if (child.pid) {
      fs.writeFileSync(WATCHER_PID_PATH, `${child.pid}:${mySig}`, 'utf8');
    }
    return child.pid;
  } catch {
    return null;
  }
}

function runStorageWatcherLoop({ entryScriptPath, onSettingsChanged }) {
  try {
    const mySig = String(Math.floor(fs.statSync(entryScriptPath).mtimeMs));
    fs.writeFileSync(WATCHER_PID_PATH, `${process.pid}:${mySig}`, 'utf8');
  } catch {}
  let lastProvider = null;
  let lastPretranslate = null;
  let busy = false;

  const checkStorage = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!fs.existsSync(APP_STORAGE_PATH)) return;
      const appStorage = JSON.parse(fs.readFileSync(APP_STORAGE_PATH, 'utf8'));
      const curProvider = normalizeProviderName(appStorage['agy-ko-thought-provider']) || 'local-llm';
      const curPre =
        appStorage['agy-ko-thought-pretranslate'] === '1' || appStorage['agy-ko-thought-pretranslate'] === true;

      if (lastProvider === null) {
        lastProvider = curProvider;
        lastPretranslate = curPre;
        return;
      }

      if (curProvider !== lastProvider || curPre !== lastPretranslate) {
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
    } catch {
    } finally {
      busy = false;
    }
  };

  void checkStorage();
  setInterval(checkStorage, 400);
}

module.exports = {
  isPluginEnabled,
  parsePretranslateCliArg,
  normalizeProviderName,
  parseProviderCliArg,
  getOrSetTranslatorOptions,
  ensureStorageWatcher,
  runStorageWatcherLoop,
};
