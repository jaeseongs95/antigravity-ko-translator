#!/usr/bin/env node
/**
 * Antigravity 2.0 Korean Thought & Full UI Localizer Auto-Patcher (CLI / Hook Orchestrator)
 *
 * Delegates responsibilities to single-purpose host modules (`scripts/host/`):
 * - `paths.js`: Environment & path constants
 * - `local-llm-service.js`: Local LLM server startup/health-probe/shutdown
 * - `settings-storage.js`: Translator option persistence & storage watcher daemon
 * - `bundle-injector.js`: Modular renderer source assembly (`scripts/renderer/*.js`) & statusbar bundle sync
 */

const fs = require('fs');
const { spawnSync, spawn } = require('child_process');
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

async function applyProviderRuntimePolicy(translationProvider) {
  if (translationProvider === 'local-llm') {
    await ensureLocalLlmServer(isPluginEnabled());
  } else {
    stopLocalLlmServer();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--watch-storage')) {
    runStorageWatcherLoop({
      entryScriptPath: __filename,
      onSettingsChanged: async ({ pretranslateEnabled, translationProvider, prevProvider }) => {
        syncCombinedAutoinject(pretranslateEnabled, translationProvider);
        if (translationProvider !== prevProvider) {
          await applyProviderRuntimePolicy(translationProvider);
        }
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

  await applyProviderRuntimePolicy(translationProvider);

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
