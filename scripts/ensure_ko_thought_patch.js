#!/usr/bin/env node
/**
 * Antigravity 2.0 Korean Thought & Full UI Localizer Auto-Patcher (CLI / Hook Orchestrator)
 *
 * Delegates responsibilities to single-purpose host modules (`scripts/host/`):
 * - `paths.js`: Environment & path constants
 * - `local-llm-service.js`: Local LLM server startup/health-probe/shutdown
 * - `settings-storage.js`: Translator option persistence, storage watcher daemon & app-update recovery
 * - `bundle-injector.js`: Modular renderer source assembly (`scripts/renderer/*.js`) & statusbar bundle sync
 */

const fs = require('fs');
const { spawnSync } = require('child_process');
const { ENSURE_STATUSBAR_PATCH_PATH } = require('./host/paths');
const { ensureLocalLlmServer, stopLocalLlmServer } = require('./host/local-llm-service');
const {
  isPluginEnabled,
  parsePretranslateCliArg,
  parseProviderCliArg,
  getOrSetTranslatorOptions,
  ensureStorageWatcher,
  runStorageWatcherLoop,
} = require('./host/settings-storage');
const { syncCombinedAutoinject } = require('./host/bundle-injector');

async function applyProviderRuntimePolicy(translationProvider, forceStopScan = false) {
  if (translationProvider === 'local-llm') {
    await ensureLocalLlmServer(isPluginEnabled());
  } else {
    await stopLocalLlmServer(forceStopScan);
  }
}

function runStatusbarPatchWorker() {
  if (!fs.existsSync(ENSURE_STATUSBAR_PATCH_PATH)) {
    return false;
  }
  spawnSync(process.execPath, [ENSURE_STATUSBAR_PATCH_PATH, '--worker'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--watch-storage')) {
    runStorageWatcherLoop({
      entryScriptPath: __filename,
      onSettingsChanged: async ({ pretranslateEnabled, translationProvider, prevProvider }) => {
        syncCombinedAutoinject(pretranslateEnabled, translationProvider);
        runStatusbarPatchWorker();
        if (translationProvider !== prevProvider) {
          await applyProviderRuntimePolicy(translationProvider, true);
        }
      },
      onAppRecoveryNeeded: async () => {
        const { pretranslateEnabled, translationProvider } = getOrSetTranslatorOptions(null, null);
        syncCombinedAutoinject(pretranslateEnabled, translationProvider);
        runStatusbarPatchWorker();
      },
    });
    return;
  }

  // Drain stdin when invoked as a hook
  if (process.argv.includes('--hook')) {
    try {
      fs.readFileSync(0);
    } catch {}
  }

  ensureStorageWatcher(__filename);

  const cliPretranslate = parsePretranslateCliArg(args);
  const cliProvider = parseProviderCliArg(args);
  const { pretranslateEnabled, translationProvider } = getOrSetTranslatorOptions(cliPretranslate, cliProvider);

  await applyProviderRuntimePolicy(translationProvider, cliProvider !== null);

  syncCombinedAutoinject(pretranslateEnabled, translationProvider);

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
    } else {
      // Run `--worker` synchronously so Windows Job Object cleanup on hook exit
      // never kills an in-flight `app.asar` patch or Live CDP injection.
      runStatusbarPatchWorker();
      if ((cliPretranslate !== null || cliProvider !== null) && !args.includes('--hook')) {
        process.stdout.write(
          JSON.stringify({ translationProvider, pretranslateEnabled }, null, 2) + '\n'
        );
      }
    }
  }

  if (process.argv.includes('--hook')) {
    process.stdout.write('{}\n');
  }
}

void main();
