#!/usr/bin/env node
/**
 * Antigravity 2.0 Korean Thought & Full UI Localizer Auto-Patcher (CLI / Hook Orchestrator)
 *
 * Delegates responsibilities to single-purpose host modules (`scripts/host/`):
 * - `paths.js`: Environment & path constants
 * - `local-llm-service.js`: Local LLM server startup/health-probe/owned-child shutdown
 * - `settings-storage.js`: Translator option persistence, lock-serialized storage watcher daemon & app-update recovery
 * - `bundle-injector.js`: Pure renderer source assembly (`scripts/renderer/*.js`), mirror sync & statusbar bundle sync
 */

const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  ENSURE_STATUSBAR_PATCH_PATH,
  BUNDLED_ENSURE_STATUSBAR_PATCH_PATH,
} = require('./host/paths');
const { PATCH_MARKER, PATCHER_CAPABILITY_REVISION } = require('./host/ensure_statusbar_patch');
const { ensureLocalLlmServer, stopLocalLlmServer } = require('./host/local-llm-service');
const {
  isPluginEnabled,
  parsePretranslateCliArg,
  parseProviderCliArg,
  writeFileAtomicSync,
  readTranslatorOptions,
  getOrSetTranslatorOptions,
  ensureStorageWatcher,
  runStorageWatcherLoop,
} = require('./host/settings-storage');
const { syncCombinedAutoinject, syncDistributableMirrors } = require('./host/bundle-injector');

function parsePatcherCapabilityRevision(text) {
  if (typeof text !== 'string' || !text) return null;
  const match = text.match(/AGY_STATUSBAR_PATCHER_V(\d+)_R(\d+)/);
  if (!match) return null;
  const major = Number(match[1]);
  const rev = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(rev)) return null;
  return { major, rev };
}

function isPatcherRevisionAtLeast(candidate, baseline) {
  if (!candidate || !baseline) return false;
  if (candidate.major !== baseline.major) {
    return candidate.major > baseline.major;
  }
  return candidate.rev >= baseline.rev;
}

/**
 * Installs or upgrades the host `~/.gemini/antigravity/ensure_statusbar_patch.js` copy when missing
 * or strictly older than the bundled `PATCHER_CAPABILITY_REVISION`. Never downgrades a newer host copy.
 */
function ensureHostStatusbarPatcherInstalled(targetPath = ENSURE_STATUSBAR_PATCH_PATH) {
  try {
    if (!fs.existsSync(BUNDLED_ENSURE_STATUSBAR_PATCH_PATH)) {
      return false;
    }
    const bundledRev = parsePatcherCapabilityRevision(PATCHER_CAPABILITY_REVISION);
    if (fs.existsSync(targetPath)) {
      const currentContent = fs.readFileSync(targetPath, 'utf8');
      const currentRev = parsePatcherCapabilityRevision(currentContent);
      if (bundledRev && currentRev && isPatcherRevisionAtLeast(currentRev, bundledRev)) {
        return false;
      }
      if (!bundledRev && currentContent.includes(PATCHER_CAPABILITY_REVISION)) {
        return false;
      }
    }
    const bundledContent = fs.readFileSync(BUNDLED_ENSURE_STATUSBAR_PATCH_PATH, 'utf8');
    writeFileAtomicSync(targetPath, bundledContent);
    return true;
  } catch (err) {
    process.stderr.write(`[ko-thought-translator] ensureHostStatusbarPatcherInstalled error: ${err.message}\n`);
    return false;
  }
}

function resolveStatusbarPatcherPathReadOnly(options = {}) {
  const hostPath =
    options && options.hostPatcherPath !== undefined
      ? options.hostPatcherPath
      : ENSURE_STATUSBAR_PATCH_PATH;
  const bundledPath =
    options && options.bundledPatcherPath !== undefined
      ? options.bundledPatcherPath
      : BUNDLED_ENSURE_STATUSBAR_PATCH_PATH;
  const bundledRev = parsePatcherCapabilityRevision(PATCHER_CAPABILITY_REVISION);
  if (hostPath && fs.existsSync(hostPath)) {
    try {
      const currentContent = fs.readFileSync(hostPath, 'utf8');
      const currentRev = parsePatcherCapabilityRevision(currentContent);
      if (
        (bundledRev && currentRev && isPatcherRevisionAtLeast(currentRev, bundledRev)) ||
        (!bundledRev && currentContent.includes(PATCHER_CAPABILITY_REVISION)) ||
        !(bundledPath && fs.existsSync(bundledPath))
      ) {
        return hostPath;
      }
    } catch {}
  }
  return bundledPath && fs.existsSync(bundledPath) ? bundledPath : null;
}

function buildReadOnlyStatusReport(options = {}) {
  const { pluginEnabled, pretranslateEnabled, translationProvider } = readTranslatorOptions(
    options && options.pathOverrides ? options.pathOverrides : null
  );
  const baseReport = {
    isAsarPatched: false,
    patchVersion: PATCH_MARKER,
    capabilityRevision: PATCHER_CAPABILITY_REVISION,
    lastStatus: null,
    pluginEnabled,
    translationProvider,
    pretranslateEnabled,
  };
  const patcherPath = resolveStatusbarPatcherPathReadOnly(options);
  if (!patcherPath) {
    return { report: baseReport, exitCode: 0 };
  }
  const res = spawnSync(process.execPath, [patcherPath, '--status'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    env: (options && options.env) || process.env,
  });
  if (res.stdout) {
    try {
      const parsed = JSON.parse(res.stdout);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          report: {
            ...baseReport,
            ...parsed,
            pluginEnabled,
            translationProvider,
            pretranslateEnabled,
          },
          exitCode: typeof res.status === 'number' ? res.status : 0,
        };
      }
    } catch {}
  }
  return {
    report: baseReport,
    exitCode: typeof res.status === 'number' ? res.status : 0,
  };
}

function resolveStatusbarPatcherPath() {
  ensureHostStatusbarPatcherInstalled(ENSURE_STATUSBAR_PATCH_PATH);
  if (fs.existsSync(ENSURE_STATUSBAR_PATCH_PATH)) {
    return ENSURE_STATUSBAR_PATCH_PATH;
  }
  return fs.existsSync(BUNDLED_ENSURE_STATUSBAR_PATCH_PATH)
    ? BUNDLED_ENSURE_STATUSBAR_PATCH_PATH
    : null;
}

async function applyProviderRuntimePolicy(translationProvider, forceStopScan = false, options = {}) {
  if (translationProvider === 'local-llm') {
    await ensureLocalLlmServer(isPluginEnabled(), options);
  } else {
    await stopLocalLlmServer(forceStopScan, options);
  }
}

function runStatusbarPatchWorker(options = {}) {
  const patcherPath = resolveStatusbarPatcherPath();
  if (!patcherPath || !fs.existsSync(patcherPath)) {
    return false;
  }
  const timeoutMs = options && options.isHook ? 2500 : 15000;
  spawnSync(process.execPath, [patcherPath, '--worker'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: timeoutMs,
  });
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    const { report, exitCode } = buildReadOnlyStatusReport();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = exitCode;
    return;
  }

  if (args.includes('--sync-mirrors')) {
    const syncRes = syncDistributableMirrors();
    process.stdout.write(JSON.stringify(syncRes, null, 2) + '\n');
    return;
  }

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

  const isHook = args.includes('--hook') || process.argv.includes('--hook');
  // Drain stdin non-blockingly AND unref the handle so open parent pipes never pin the Node event loop past hook completion
  if (isHook && process.stdin && !process.stdin.isTTY) {
    process.stdin.on('error', () => {});
    process.stdin.resume();
    if (typeof process.stdin.unref === 'function') {
      process.stdin.unref();
    }
  }

  ensureStorageWatcher(__filename, { fastHook: isHook });

  const cliPretranslate = parsePretranslateCliArg(args);
  const cliProvider = parseProviderCliArg(args);
  const { pretranslateEnabled, translationProvider } = getOrSetTranslatorOptions(cliPretranslate, cliProvider);

  await applyProviderRuntimePolicy(translationProvider, cliProvider !== null, { fastHook: isHook });

  syncCombinedAutoinject(pretranslateEnabled, translationProvider);

  const patcherPath = resolveStatusbarPatcherPath();
  if (patcherPath && fs.existsSync(patcherPath)) {
    // Run `--worker` synchronously with bounded timeout so Windows Job Object cleanup on hook exit
    // never kills an in-flight `app.asar` patch or Live CDP injection.
    if (isHook) {
      runStatusbarPatchWorker({ isHook: true });
    } else {
      runStatusbarPatchWorker();
    }
    if ((cliPretranslate !== null || cliProvider !== null) && !isHook) {
      process.stdout.write(
        JSON.stringify({ translationProvider, pretranslateEnabled }, null, 2) + '\n'
      );
    }
  }

  if (isHook) {
    process.stdout.write('{}\n');
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  parsePatcherCapabilityRevision,
  isPatcherRevisionAtLeast,
  ensureHostStatusbarPatcherInstalled,
  resolveStatusbarPatcherPathReadOnly,
  buildReadOnlyStatusReport,
  resolveStatusbarPatcherPath,
  applyProviderRuntimePolicy,
  runStatusbarPatchWorker,
  main,
};
