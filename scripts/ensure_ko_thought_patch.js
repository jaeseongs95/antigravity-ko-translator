#!/usr/bin/env node
/**
 * Antigravity 2.0 Korean Thought & Full UI Localizer Auto-Patcher
 *
 * Ensures that:
 * 1. `statusbar_autoinject.js` embeds the latest `ko_thought_autoinject.js` bundle.
 * 2. `%APPDATA%\Antigravity\app_storage.json` (`agy-statusbar-code`) is synced for 0ms preload injection.
 * 3. `app.asar` (`dist/preload.js`, `dist/utils.js`, `dist/main.js`) is automatically re-patched whenever
 *    Antigravity updates.
 * 4. All currently open Antigravity windows receive the live localization script immediately via CDP.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || os.homedir();
const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME_DIR, 'AppData', 'Roaming');
const APP_STORAGE_PATH = path.join(APPDATA, 'Antigravity', 'app_storage.json');
const AGY_DIR = path.join(HOME_DIR, '.gemini', 'antigravity');
const CONFIG_JSON_PATH = path.join(HOME_DIR, '.gemini', 'config', 'config.json');
const KO_SCRIPT_PATH = path.join(
  HOME_DIR,
  '.gemini',
  'config',
  'plugins',
  'ko-thought-translator',
  'scripts',
  'ko_thought_autoinject.js'
);
const STATUSBAR_AUTOINJECT_PATH = path.join(AGY_DIR, 'statusbar_autoinject.js');
const ENSURE_STATUSBAR_PATCH_PATH = path.join(AGY_DIR, 'ensure_statusbar_patch.js');
const WATCHER_PID_PATH = path.join(AGY_DIR, 'ko_thought_watcher.pid');
const LLM_BASE_URL = process.env.AGY_LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434';

const BEGIN_MARKER = '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===';
const END_MARKER = '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===';

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
  } catch {}
  return null;
}

function resolveLocalLlmCommand() {
  const bin = process.env.AGY_LOCAL_LLM_SERVER_BIN || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_BIN');
  if (!bin) return null;
  const rawArgs = process.env.AGY_LOCAL_LLM_SERVER_ARGS || readWindowsUserEnv('AGY_LOCAL_LLM_SERVER_ARGS') || 'serve';
  return {
    bin,
    args: rawArgs.split(/\s+/).filter(Boolean),
  };
}

function probeLocalLlmServer(timeoutMs = 500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const url = new URL('/v1/models', LLM_BASE_URL);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: url.pathname,
          method: 'GET',
          headers: { Origin: 'https://127.0.0.1:58033' },
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
              models = Array.isArray(parsed?.data) ? parsed.data.map((m) => m.id) : [];
            } catch {}
            done({
              reachable: true,
              statusCode: res.statusCode,
              corsAllowed: corsOrigin === '*' || corsOrigin.includes('127.0.0.1'),
              corsOrigin,
              models,
            });
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        done({ reachable: false, corsAllowed: false, models: [] });
      });
      req.on('error', () => done({ reachable: false, corsAllowed: false, models: [] }));
      req.end();
    } catch {
      done({ reachable: false, corsAllowed: false, models: [] });
    }
  });
}

async function ensureLocalLlmServer() {
  if (!isPluginEnabled()) return { skipped: true };
  const probe = await probeLocalLlmServer(450);
  if (probe.reachable && probe.corsAllowed) {
    return probe;
  }
  const cmd = resolveLocalLlmCommand();
  if (!cmd) return probe;
  try {
    if (process.platform === 'win32') {
      const os = require('os');
      const vbsPath = path.join(os.tmpdir(), 'agy_start_local_llm_headless.vbs');
      const escapedBin = cmd.bin.replace(/"/g, '""');
      const escapedArgs = cmd.args.join(' ').replace(/"/g, '""');
      const vbsContent = [
        'Set sh = CreateObject("WScript.Shell")',
        `sh.Run """${escapedBin}"" ${escapedArgs}", 0, False`,
      ].join('\r\n');
      fs.writeFileSync(vbsPath, vbsContent, 'utf8');
      const psScript = [
        '$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly',
        '$si.ShowWindow = [uint16]0',
        '$envList = [System.Collections.Generic.List[string]]::new()',
        'foreach ($de in [Environment]::GetEnvironmentVariables("Machine").GetEnumerator()) { $envList.Add("$($de.Key)=$($de.Value)") }',
        'foreach ($de in [Environment]::GetEnvironmentVariables("User").GetEnumerator()) { $envList.Add("$($de.Key)=$($de.Value)") }',
        '$si.EnvironmentVariables = $envList.ToArray()',
        `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'wscript.exe //B //NoLogo "${vbsPath.replace(/'/g, "''")}"'; ProcessStartupInformation = $si } | Out-Null`,
      ].join('; ');
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      const child = spawn(cmd.bin, cmd.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env },
      });
      child.unref();
    }
  } catch {}
  return probe;
}

function stopLocalLlmServer() {
  let stoppedCount = 0;
  try {
    const url = new URL('/v1/models', LLM_BASE_URL);
    const port = Number(url.port) || 11434;
    if (process.platform === 'win32') {
      const res = spawnSync('netstat', ['-ano'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const pids = new Set();
      if (res.stdout) {
        const lines = res.stdout.split(/\r?\n/);
        for (const line of lines) {
          if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
            const parts = line.trim().split(/\s+/);
            const pid = Number(parts[parts.length - 1]);
            if (pid > 0 && pid !== process.pid) {
              pids.add(pid);
            }
          }
        }
      }
      for (const pid of pids) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
        stoppedCount++;
      }
      const cmd = resolveLocalLlmCommand();
      if (cmd && cmd.bin) {
        const exeName = path.basename(cmd.bin);
        if (exeName && /\.exe$/i.test(exeName)) {
          spawnSync('taskkill', ['/F', '/T', '/IM', exeName], {
            stdio: 'ignore',
            windowsHide: true,
          });
        }
      }
    } else {
      const res = spawnSync('lsof', ['-ti', `:${port}`], {
        encoding: 'utf8',
      });
      if (res.stdout) {
        const pids = res.stdout
          .split(/\r?\n/)
          .map((s) => Number(s.trim()))
          .filter((n) => n > 0 && n !== process.pid);
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGTERM');
            stoppedCount++;
          } catch {}
        }
      }
    }
  } catch {}
  return { stoppedCount };
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

function ensureStorageWatcher() {
  try {
    const mySig = String(Math.floor(fs.statSync(__filename).mtimeMs));
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
    const child = spawn(process.execPath, [__filename, '--watch-storage'], {
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

function runStorageWatcherLoop() {
  try {
    const mySig = String(Math.floor(fs.statSync(__filename).mtimeMs));
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
        syncCombinedAutoinject(opts.pretranslateEnabled, opts.translationProvider);
        if (curProvider !== prevProvider) {
          if (curProvider === 'local-llm') {
            await ensureLocalLlmServer();
          } else {
            stopLocalLlmServer();
          }
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

function syncCombinedAutoinject(pretranslateEnabled = false, translationProvider = 'local-llm') {
  if (!fs.existsSync(STATUSBAR_AUTOINJECT_PATH) || !fs.existsSync(KO_SCRIPT_PATH)) {
    return false;
  }
  const rawStatusbar = fs.readFileSync(STATUSBAR_AUTOINJECT_PATH, 'utf8');
  const koCode = fs
    .readFileSync(KO_SCRIPT_PATH, 'utf8')
    .trim()
    .replace(
      /const DEFAULT_PRETRANSLATE_ENABLED = (?:true|false);/,
      `const DEFAULT_PRETRANSLATE_ENABLED = ${pretranslateEnabled ? 'true' : 'false'};`
    )
    .replace(
      /const DEFAULT_TRANSLATION_PROVIDER = '[^']+';/,
      `const DEFAULT_TRANSLATION_PROVIDER = '${translationProvider || 'local-llm'}';`
    );

  // Strip any previous embedded block
  let baseCode = rawStatusbar;
  const bIdx = baseCode.indexOf(BEGIN_MARKER);
  const eIdx = baseCode.indexOf(END_MARKER);
  if (bIdx !== -1 && eIdx !== -1 && eIdx > bIdx) {
    baseCode = baseCode.slice(0, bIdx).trimEnd();
  } else {
    baseCode = baseCode.trimEnd();
  }

  let nextCombined = baseCode + '\n';
  if (isPluginEnabled()) {
    nextCombined += `\n${BEGIN_MARKER}\n${koCode}\n${END_MARKER}\n`;
  } else {
    nextCombined += `\n${BEGIN_MARKER}\nif (window.__agyKoThoughtCleanup) { try { window.__agyKoThoughtCleanup(); } catch (e) {} }\n${END_MARKER}\n`;
  }

  if (rawStatusbar !== nextCombined) {
    fs.writeFileSync(STATUSBAR_AUTOINJECT_PATH, nextCombined, 'utf8');
    return true;
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--watch-storage')) {
    runStorageWatcherLoop();
    return;
  }

  // Drain stdin when invoked as a hook
  if (process.argv.includes('--hook')) {
    try {
      fs.readFileSync(0);
    } catch {}
  }

  ensureStorageWatcher();

  const cliPretranslate = parsePretranslateCliArg(args);
  const cliProvider = parseProviderCliArg(args);
  const { pretranslateEnabled, translationProvider } = getOrSetTranslatorOptions(cliPretranslate, cliProvider);

  if (translationProvider === 'local-llm') {
    await ensureLocalLlmServer();
  } else {
    stopLocalLlmServer();
  }

  const changed = syncCombinedAutoinject(pretranslateEnabled, translationProvider);

  if (fs.existsSync(ENSURE_STATUSBAR_PATCH_PATH)) {
    if (args.includes('--status')) {
      const res = spawnSync(process.execPath, [ENSURE_STATUSBAR_PATCH_PATH, '--status'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (res.stdout) {
        try {
          const parsed = JSON.parse(res.stdout);
          parsed.translationProvider = translationProvider;
          parsed.pretranslateEnabled = pretranslateEnabled;
          process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');
        } catch {
          process.stdout.write(res.stdout);
        }
      }
      process.exit(res.status || 0);
    } else if (args.includes('--worker') || cliPretranslate !== null || cliProvider !== null || changed) {
      spawnSync(process.execPath, [ENSURE_STATUSBAR_PATCH_PATH, '--worker'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if ((cliPretranslate !== null || cliProvider !== null) && !args.includes('--hook')) {
        process.stdout.write(
          JSON.stringify({ translationProvider, pretranslateEnabled }, null, 2) + '\n'
        );
      }
    } else {
      const child = spawn(process.execPath, [ENSURE_STATUSBAR_PATCH_PATH, '--hook'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    }
  }

  if (process.argv.includes('--hook')) {
    process.stdout.write('{}\n');
  }
}

void main();
