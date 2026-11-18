'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
  resolveHostPaths,
  BUNDLED_ENSURE_STATUSBAR_PATCH_PATH,
  CLI_ENTRY_SCRIPT_PATH,
} = require('./paths');
const {
  isProcessAlive,
  writeFileAtomicSync,
  acquireExclusiveFileLock,
  acquireExclusiveFileLockWithWait,
  releaseExclusiveFileLock,
  createSentinelCredentials,
  formatWatcherPidRecord,
  readWatcherPidRecord,
  createAuthenticatedSentinelServer,
  stopWatcherSentinel,
} = require('./process-sentinel');
const {
  normalizeProviderId,
  parseLlmConfigRaw,
  parsePretranslateCliArg,
  parseProviderCliArg,
  isPluginEnabled,
  readTranslatorOptionsReadOnly,
  updateTranslatorSettings,
  removeSettingsSsotFile,
} = require('./config-store');
const {
  stopLocalLlmServer,
  reconcileLocalLlmRuntime,
  runLlmSentinelSupervisor,
} = require('./local-llm-daemon');
const {
  syncDistributableMirrors,
  syncCombinedAutoinject,
  removeKoBlockFromCombinedAutoinject,
} = require('./bundle-injector');
const {
  PATCH_MARKER,
  PATCHER_CAPABILITY_REVISION,
  probeAsarReplaceableFast,
  isAsarPatchedFast,
  readAsarArchive,
  isPureUnpatchedArchive,
  verifyPureOrigArchive,
  writeBinaryVerifiedAtomicSync,
  patchAsarOnDisk,
  injectViaCdpLive,
  evaluateCleanupViaCdpLive,
  syncAppStorageCode,
  writeStatus,
} = require('./ensure_statusbar_patch');

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

function ensureHostStatusbarPatcherInstalled(targetPath) {
  const effTarget = targetPath || resolveHostPaths(process.env).ENSURE_STATUSBAR_PATCH_PATH;
  try {
    if (!fs.existsSync(BUNDLED_ENSURE_STATUSBAR_PATCH_PATH)) {
      return false;
    }
    const bundledRev = parsePatcherCapabilityRevision(PATCHER_CAPABILITY_REVISION);
    if (fs.existsSync(effTarget)) {
      const currentContent = fs.readFileSync(effTarget, 'utf8');
      const currentRev = parsePatcherCapabilityRevision(currentContent);
      if (bundledRev && currentRev && isPatcherRevisionAtLeast(currentRev, bundledRev)) {
        return false;
      }
      if (!bundledRev && currentContent.includes(PATCHER_CAPABILITY_REVISION)) {
        return false;
      }
    }
    const bundledContent = fs.readFileSync(BUNDLED_ENSURE_STATUSBAR_PATCH_PATH, 'utf8');
    writeFileAtomicSync(effTarget, bundledContent);
    return true;
  } catch (_err) {
    return false;
  }
}

function resolveStatusbarPatcherPathReadOnly(options = {}) {
  const paths = resolveHostPaths((options && options.env) || process.env);
  const hostPath =
    options && options.hostPatcherPath !== undefined
      ? options.hostPatcherPath
      : paths.ENSURE_STATUSBAR_PATCH_PATH;
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
    } catch (_err) {}
  }
  return bundledPath && fs.existsSync(bundledPath) ? bundledPath : null;
}

// 100% read-only status report (`0` file mutations, `0` secrets exposed!)
function buildReadOnlyStatusReport(options = {}) {
  const env = (options && options.env) || process.env;
  const paths = resolveHostPaths(env);
  const pathOverrides = options && options.pathOverrides ? options.pathOverrides : paths;
  const opts = readTranslatorOptionsReadOnly(pathOverrides);
  const asarPath = (pathOverrides && (pathOverrides.asarPath || pathOverrides.ASAR_PATH)) || paths.ASAR_PATH;
  const statusPath = (pathOverrides && (pathOverrides.statusPath || pathOverrides.STATUS_PATH)) || paths.STATUS_PATH;

  const isPatched = isAsarPatchedFast(asarPath);
  let lastStatus = null;
  try {
    if (statusPath && fs.existsSync(statusPath)) {
      lastStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    }
  } catch (_err) {}

  const report = {
    version: '2.0.0',
    isAsarPatched: isPatched,
    patchVersion: PATCH_MARKER,
    capabilityRevision: PATCHER_CAPABILITY_REVISION,
    lastStatus,
    pluginEnabled: opts.pluginEnabled,
    translationProvider: opts.translationProvider,
    pretranslateEnabled: opts.pretranslateEnabled,
    llmConfig: opts.llmConfig,
    pendingAsarPatch: opts.pendingAsarPatch,
  };
  return { report, exitCode: 0 };
}

function computeWatcherSignature(entryScriptPath = CLI_ENTRY_SCRIPT_PATH) {
  const files = [
    entryScriptPath,
    __filename,
    path.join(__dirname, 'config-store.js'),
    path.join(__dirname, 'process-sentinel.js'),
    path.join(__dirname, 'local-llm-daemon.js'),
    path.join(__dirname, 'bundle-injector.js'),
    path.join(__dirname, 'ensure_statusbar_patch.js'),
  ];
  return files
    .map((f) => {
      try {
        return Math.floor(fs.statSync(f).mtimeMs);
      } catch (_err) {
        return 0;
      }
    })
    .join('-');
}

function spawnDetachedWatcherProcess(entryScriptPath, pidFilePath, preGeneratedCreds, envOverrides = null) {
  const creds = preGeneratedCreds || createSentinelCredentials('watch');
  const childEnv = {
    ...process.env,
    ...(envOverrides || {}),
    AGY_KO_WATCHER_SENTINEL_CFG: JSON.stringify(creds),
  };
  if (pidFilePath) {
    childEnv.AGY_KO_WATCHER_PID_PATH = pidFilePath;
  }
  const child = spawn(process.execPath, [entryScriptPath, '--watch-storage'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: childEnv,
  });
  if (child && typeof child.unref === 'function') child.unref();
  return (child && child.pid) || null;
}

async function ensureStorageWatcher(entryScriptPath = CLI_ENTRY_SCRIPT_PATH, options = {}) {
  const paths = resolveHostPaths((options && options.env) || process.env);
  const pidFilePath = (options && options.watcherPidPath) || paths.WATCHER_PID_PATH;
  const lockPath = (options && options.watcherLockPath) || `${pidFilePath}.lock`;
  const fastHook = Boolean(options && options.fastHook);
  const mySig = computeWatcherSignature(entryScriptPath);

  const fastExisting = readWatcherPidRecord(pidFilePath);
  if (fastExisting.pid && fastExisting.sig === mySig && isProcessAlive(fastExisting.pid)) {
    return fastExisting.pid;
  }

  const lockTok = acquireExclusiveFileLockWithWait(lockPath, fastHook ? 1200 : 2000, 15000);
  if (!lockTok) {
    const peer = readWatcherPidRecord(pidFilePath);
    return peer.pid && isProcessAlive(peer.pid) ? peer.pid : null;
  }

  try {
    const existing = readWatcherPidRecord(pidFilePath);
    if (existing.pid && isProcessAlive(existing.pid)) {
      if (existing.sig === mySig) {
        return existing.pid;
      }
    }
  } finally {
    releaseExclusiveFileLock(lockPath, lockTok);
  }

  // Stop older/outdated watcher via authenticated IPC sentinel (v1.x `shutdown` -> `stop` fallback)
  await stopWatcherSentinel({
    watcherPidPath: pidFilePath,
    watcherLockPath: lockPath,
    exitWaitTimeoutMs: fastHook ? 400 : 1500,
  });

  const spawnLockTok = acquireExclusiveFileLockWithWait(lockPath, fastHook ? 1200 : 2000, 15000);
  if (!spawnLockTok) return null;
  try {
    const recheck = readWatcherPidRecord(pidFilePath);
    if (recheck.pid && recheck.sig === mySig && isProcessAlive(recheck.pid)) {
      return recheck.pid;
    }
    const creds = createSentinelCredentials('watch');
    const spawnFn =
      options && typeof options.spawnFn === 'function' ? options.spawnFn : spawnDetachedWatcherProcess;
    const spawnedPid = spawnFn(
      entryScriptPath,
      pidFilePath,
      creds,
      options && options.env ? options.env : null
    );
    if (spawnedPid) {
      writeFileAtomicSync(pidFilePath, formatWatcherPidRecord(spawnedPid, mySig, creds), { mode: 0o600 });
    }
    return spawnedPid;
  } finally {
    releaseExclusiveFileLock(lockPath, spawnLockTok);
  }
}

function readDevToolsRawText(devtoolsPortFile) {
  try {
    if (!devtoolsPortFile || !fs.existsSync(devtoolsPortFile)) return '';
    return fs.readFileSync(devtoolsPortFile, 'utf8').trim();
  } catch (_err) {
    return '';
  }
}

// Anti-Thrash `--watch-storage` daemon (`Rev5-F4`, `Rev6-F2`, `Rev6-F4 #1`, `Rev7-F4 #2`)
function runStorageWatcherLoop({
  entryScriptPath = CLI_ENTRY_SCRIPT_PATH,
  pollIntervalMs = 400,
  healthTickModulo = 5,
  pathOverrides = null,
} = {}) {
  const basePaths = resolveHostPaths(process.env);
  const p = {
    ...basePaths,
    ...(pathOverrides || {}),
  };
  const pidFilePath = p.WATCHER_PID_PATH;

  let creds = null;
  if (process.env.AGY_KO_WATCHER_SENTINEL_CFG) {
    try {
      creds = JSON.parse(process.env.AGY_KO_WATCHER_SENTINEL_CFG);
    } catch (_err) {
      creds = null;
    }
    delete process.env.AGY_KO_WATCHER_SENTINEL_CFG;
  }
  if (!creds || !creds.instanceId || !creds.authToken || !creds.sentinelEndpoint) {
    creds = createSentinelCredentials('watch');
  }

  const mySig = computeWatcherSignature(entryScriptPath);
  const existing = readWatcherPidRecord(pidFilePath);
  if (existing.pid && existing.pid !== process.pid && existing.sig === mySig && isProcessAlive(existing.pid)) {
    return { stop() {}, isStopped: () => true };
  }
  try {
    writeFileAtomicSync(pidFilePath, formatWatcherPidRecord(process.pid, mySig, creds), { mode: 0o600 });
  } catch (_err) {}

  let stopped = false;
  let intervalHandle = null;
  let pidDirWatcher = null;
  let sentinelHandle = null;
  const followupTimers = new Set();

  const hasWatcherOwnership = () => {
    if (stopped) return false;
    const cur = readWatcherPidRecord(pidFilePath);
    if (cur.pid !== process.pid) return false;
    if (cur.instanceId && creds.instanceId && cur.instanceId !== creds.instanceId) return false;
    return true;
  };

  const stopLoop = ({ removeOwnPidFile = false } = {}) => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (stopped) return;
    stopped = true;
    if (sentinelHandle) {
      sentinelHandle.close();
      sentinelHandle = null;
    }
    if (pidDirWatcher) {
      try {
        pidDirWatcher.close();
      } catch (_err) {}
      pidDirWatcher = null;
    }
    for (const t of followupTimers) {
      clearTimeout(t);
    }
    followupTimers.clear();
    process.removeListener('SIGTERM', onSigTerm);
    process.removeListener('SIGINT', onSigTerm);
    if (removeOwnPidFile) {
      const cur = readWatcherPidRecord(pidFilePath);
      if (cur.pid === process.pid && (!cur.instanceId || cur.instanceId === creds.instanceId)) {
        try {
          fs.unlinkSync(pidFilePath);
        } catch (_err) {}
      }
    }
  };

  function onSigTerm() {
    stopLoop({ removeOwnPidFile: true });
  }
  process.on('SIGTERM', onSigTerm);
  process.on('SIGINT', onSigTerm);

  sentinelHandle = createAuthenticatedSentinelServer({
    creds,
    onShutdownRequest: () => {
      setImmediate(() => stopLoop({ removeOwnPidFile: false }));
      return {};
    },
  });

  const initialOpts = readTranslatorOptionsReadOnly(p);
  let lastProvider = initialOpts.translationProvider;
  let lastPretranslate = initialOpts.pretranslateEnabled;
  let lastLlmJson = JSON.stringify(initialOpts.llmConfig);
  let lastDevToolsRaw = readDevToolsRawText(p.DEVTOOLS_PORT_FILE);
  let lastStorageMtimeMs = -1;
  let lastStorageSize = -1;
  let lastLockedAsarFingerprint = '';
  let tickCount = 0;
  let busy = false;

  const scheduleCdpFollowup = (delayMs) => {
    const t = setTimeout(async () => {
      followupTimers.delete(t);
      if (!hasWatcherOwnership() || !isPluginEnabled(p)) return;
      syncAppStorageCode({
        ...p,
        AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
      });
      await injectViaCdpLive({
        ...p,
        AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
      });
    }, delayMs);
    if (t && typeof t.unref === 'function') t.unref();
    followupTimers.add(t);
  };

  const checkHealthTick = async () => {
    if (!hasWatcherOwnership()) {
      stopLoop({ removeOwnPidFile: false });
      return;
    }
    if (busy) return;
    busy = true;
    tickCount += 1;
    try {
      // 1. Check renderer changes in `app_storage.json` (`agy-ko-thought-provider`, `agy-ko-thought-pretranslate`, `agy-ko-llm-config`)
      if (fs.existsSync(p.APP_STORAGE_PATH)) {
        const stat = fs.statSync(p.APP_STORAGE_PATH);
        if (stat.mtimeMs !== lastStorageMtimeMs || stat.size !== lastStorageSize) {
          lastStorageMtimeMs = stat.mtimeMs;
          lastStorageSize = stat.size;
          let appStorage = null;
          try {
            appStorage = JSON.parse(fs.readFileSync(p.APP_STORAGE_PATH, 'utf8'));
          } catch (_err) {}
          if (appStorage && typeof appStorage === 'object') {
            const curProv = normalizeProviderId(appStorage['agy-ko-thought-provider']) || lastProvider;
            const curPre =
              appStorage['agy-ko-thought-pretranslate'] !== undefined
                ? appStorage['agy-ko-thought-pretranslate'] === '1' || appStorage['agy-ko-thought-pretranslate'] === true
                : lastPretranslate;
            const parsedLlm =
              appStorage['agy-ko-llm-config'] !== undefined
                ? parseLlmConfigRaw(appStorage['agy-ko-llm-config'])
                : null;
            const curLlmJson = parsedLlm ? JSON.stringify(parsedLlm) : lastLlmJson;

            if (curProv !== lastProvider || curPre !== lastPretranslate || curLlmJson !== lastLlmJson) {
              if (!hasWatcherOwnership()) {
                stopLoop({ removeOwnPidFile: false });
                return;
              }
              lastProvider = curProv;
              lastPretranslate = curPre;
              lastLlmJson = curLlmJson;

              const updated = updateTranslatorSettings({
                explicitPretranslate: curPre,
                explicitProvider: curProv,
                explicitLlmConfig: parsedLlm || undefined,
                syncToAppStorage: false,
                pathOverrides: p,
              });

              syncCombinedAutoinject({
                pretranslateEnabled: updated.pretranslateEnabled,
                translationProvider: updated.translationProvider,
                llmConfig: updated.llmConfig,
                pathOverrides: p,
              });
              syncAppStorageCode({
                ...p,
                AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
              });
              await injectViaCdpLive({
                ...p,
                AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
              });
              await reconcileLocalLlmRuntime({
                pluginEnabled: isPluginEnabled(p),
                translationProvider: updated.translationProvider,
                llmConfig: updated.llmConfig,
                options: { llmPidPath: p.LLM_PID_PATH, devtoolsPortFile: p.DEVTOOLS_PORT_FILE },
              });
            }
          }
        }
      }

      // 2. Periodic health check (~2s by default): Anti-thrash ASAR writability gate + non-blocking 1-shot `LOCK_PATH`!
      if (tickCount % healthTickModulo === 0) {
        if (!hasWatcherOwnership() || !isPluginEnabled(p)) return;

        const curDevToolsRaw = readDevToolsRawText(p.DEVTOOLS_PORT_FILE);
        const devToolsChanged = Boolean(curDevToolsRaw && curDevToolsRaw !== lastDevToolsRaw);
        if (curDevToolsRaw) {
          lastDevToolsRaw = curDevToolsRaw;
        }

        if (devToolsChanged) {
          syncCombinedAutoinject({ pathOverrides: p });
          syncAppStorageCode({
            ...p,
            AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
          });
          await injectViaCdpLive({
            ...p,
            AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
          });
          scheduleCdpFollowup(2000);
          scheduleCdpFollowup(5000);
        }

        // Rev5-F4 #1: If `app.asar` does NOT exist, never attempt ASAR retries!
        if (!fs.existsSync(p.ASAR_PATH)) {
          return;
        }

        const currentOpts = readTranslatorOptionsReadOnly(p);
        const needsAsarPatch = currentOpts.pendingAsarPatch || !isAsarPatchedFast(p.ASAR_PATH);
        if (!needsAsarPatch) {
          lastLockedAsarFingerprint = '';
          return;
        }

        const asarStat = fs.statSync(p.ASAR_PATH);
        const fingerprint = `${asarStat.mtimeMs}:${asarStat.size}:${curDevToolsRaw}`;
        const writableProbe = probeAsarReplaceableFast(p.ASAR_PATH);
        if (!writableProbe.replaceable) {
          // App is holding `app.asar` open -> record `pendingAsarPatch: true` ONCE per fingerprint and skip `patchAsarOnDisk`!
          if (lastLockedAsarFingerprint !== fingerprint) {
            lastLockedAsarFingerprint = fingerprint;
            if (!currentOpts.pendingAsarPatch) {
              updateTranslatorSettings({
                pendingAsarPatch: true,
                syncToAppStorage: false,
                pathOverrides: p,
              });
            }
          }
          return;
        }

        // Rev7-F4 #2: Non-blocking 1-shot attempt on `LOCK_PATH` (`waitTimeoutMs = 0`) so `--rollback` is NEVER delayed!
        const patchLockToken = acquireExclusiveFileLock(p.LOCK_PATH, 60000);
        if (!patchLockToken) {
          return;
        }
        try {
          if (!hasWatcherOwnership() || !isPluginEnabled(p)) {
            return;
          }
          syncCombinedAutoinject({ pathOverrides: p });
          const patchRes = patchAsarOnDisk({
            ...p,
            AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
          });
          if (patchRes && (patchRes.status === 'PATCHED' || patchRes.status === 'ALREADY_PATCHED')) {
            lastLockedAsarFingerprint = '';
            updateTranslatorSettings({
              pendingAsarPatch: false,
              syncToAppStorage: false,
              pathOverrides: p,
            });
            writeStatus(
              {
                updatedAt: new Date().toISOString(),
                pid: process.pid,
                capabilityRevision: PATCHER_CAPABILITY_REVISION,
                asar: patchRes,
              },
              p
            );
          }
        } finally {
          releaseExclusiveFileLock(p.LOCK_PATH, patchLockToken);
        }
      }
    } catch (_err) {
    } finally {
      busy = false;
    }
  };

  try {
    const pidDir = path.dirname(pidFilePath);
    const pidBase = path.basename(pidFilePath);
    if (fs.existsSync(pidDir)) {
      pidDirWatcher = fs.watch(pidDir, { persistent: false }, (_ev, fname) => {
        if (!fname || fname === pidBase) {
          if (!hasWatcherOwnership()) {
            stopLoop({ removeOwnPidFile: false });
          }
        }
      });
      pidDirWatcher.on('error', () => {});
    }
  } catch (_err) {}

  void checkHealthTick();
  if (!stopped) {
    intervalHandle = setInterval(checkHealthTick, Math.max(15, Number(pollIntervalMs) || 400));
  }

  return {
    stop: () => stopLoop({ removeOwnPidFile: true }),
    isStopped: () => stopped,
  };
}

// Complete Deterministic `--uninstall` (`Rev6-F2` Steps U1–U4)
async function runUninstall(options = {}) {
  const p = {
    ...resolveHostPaths((options && options.env) || process.env),
    ...((options && options.pathOverrides) || {}),
  };
  const skipWatcherStop = Boolean(options && options.watcherAlreadyStopped);

  // Step U1: Stop owned background daemons (`0` signals to external/unowned processes!)
  const watcherRes = skipWatcherStop
    ? { stopped: true, reason: 'already_stopped_by_caller' }
    : await stopWatcherSentinel({
        watcherPidPath: p.WATCHER_PID_PATH,
        watcherLockPath: p.WATCHER_LOCK_PATH,
      });
  const llmRes = await stopLocalLlmServer(false, { llmPidPath: p.LLM_PID_PATH });

  // Step U2: Strip ONLY KO block under `STATUSBAR_AUTOINJECT_LOCK_PATH` (preserving sibling statusbar/MCP blocks byte-for-byte!)
  const stripRes = removeKoBlockFromCombinedAutoinject(p);

  // Step U3: Clean `agy-ko-*` keys & re-sync `agy-statusbar-code` under `APP_STORAGE_LOCK_PATH`
  let appStorageCleaned = false;
  if (p.APP_STORAGE_PATH && fs.existsSync(p.APP_STORAGE_PATH)) {
    const storageLockTok = acquireExclusiveFileLockWithWait(p.APP_STORAGE_LOCK_PATH, 3000, 15000);
    if (storageLockTok) {
      try {
        const data = JSON.parse(fs.readFileSync(p.APP_STORAGE_PATH, 'utf8'));
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          delete data['agy-ko-thought-provider'];
          delete data['agy-ko-thought-pretranslate'];
          delete data['agy-ko-llm-config'];
          const remainingTrimmed = String(stripRes.remainingCode || '').trim();
          if (remainingTrimmed) {
            data['agy-statusbar-code'] = stripRes.remainingCode;
          } else {
            delete data['agy-statusbar-code'];
          }
          writeFileAtomicSync(p.APP_STORAGE_PATH, JSON.stringify(data, null, 2));
          appStorageCleaned = true;
        }
      } catch (_err) {
      } finally {
        releaseExclusiveFileLock(p.APP_STORAGE_LOCK_PATH, storageLockTok);
      }
    }
  }

  // Step U4: Live renderer cleanup via CDP + remove `ko_translator_settings.json` under `ko_translator_settings.lock`
  const cdpCleanup = await evaluateCleanupViaCdpLive({
    ...p,
    AUTOINJECT_PATH: p.STATUSBAR_AUTOINJECT_PATH,
  });
  const ssotRemoved = removeSettingsSsotFile(p);

  return {
    status: 'UNINSTALLED',
    watcherStopped: watcherRes,
    llmStopped: llmRes,
    autoinjectUpdated: stripRes.updated,
    siblingBlocksPreserved: Boolean(String(stripRes.remainingCode || '').trim()),
    appStorageCleaned,
    cdpCleanup,
    ssotRemoved,
  };
}

// `LOCK_PATH`-Serialized Atomic `--rollback` State Machine (`Rev5-F1 #1`, `Rev6-F2`, `Rev7-F4` Steps R1–R5)
async function runRollback(options = {}) {
  const p = {
    ...resolveHostPaths((options && options.env) || process.env),
    ...((options && options.pathOverrides) || {}),
  };
  const lockWaitMs = options && typeof options.lockWaitMs === 'number' ? options.lockWaitMs : 5000;

  // Step R1: Acquire `LOCK_PATH` UP FRONT and hold through completion!
  const patchLockToken = acquireExclusiveFileLockWithWait(p.LOCK_PATH, lockWaitMs, 60000);
  if (!patchLockToken) {
    return {
      status: 'DEFERRED_PATCH_LOCK_BUSY',
      asarRestored: false,
    };
  }

  try {
    let asarStatus = 'SKIPPED_NO_ASAR';
    let asarRestored = false;
    let verifiedBackup = null;
    let appVersion = null;
    let watcherStoppedEarly = false;

    // Step R2: Zero-Side-Effect Pre-Flight Verification under `LOCK_PATH`!
    if (fs.existsSync(p.ASAR_PATH)) {
      const curArchive = readAsarArchive(p.ASAR_PATH);
      appVersion = curArchive.appVersion;

      if (isPureUnpatchedArchive(curArchive)) {
        asarStatus = 'ALREADY_UNPATCHED';
      } else {
        const backupPath = `${p.ASAR_PATH}.v${appVersion}.orig`;
        if (!fs.existsSync(backupPath)) {
          return {
            status: 'ERR_ORIG_MISSING',
            appVersion,
            backupPath,
            asarRestored: false,
          };
        }
        const checkOrig = verifyPureOrigArchive(backupPath, appVersion);
        if (!checkOrig.ok) {
          return {
            status: 'ERR_ORIG_CORRUPT_OR_VERSION_MISMATCH',
            appVersion,
            detail: checkOrig.reason,
            asarRestored: false,
          };
        }
        const writable = probeAsarReplaceableFast(p.ASAR_PATH);
        if (!writable.replaceable) {
          return {
            status: 'DEFERRED_LOCKED',
            appVersion,
            errorCode: writable.code,
            asarRestored: false,
          };
        }
        verifiedBackup = checkOrig.archive;
      }
    }

    // Step R3 & Step R4: If ASAR needs restoration, stop watcher under `LOCK_PATH` BEFORE atomic `.orig -> ASAR_PATH` rename!
    if (verifiedBackup) {
      await stopWatcherSentinel({
        watcherPidPath: p.WATCHER_PID_PATH,
        watcherLockPath: p.WATCHER_LOCK_PATH,
      });
      watcherStoppedEarly = true;

      try {
        writeBinaryVerifiedAtomicSync(p.ASAR_PATH, verifiedBackup.buf);
        asarStatus = 'RESTORED';
        asarRestored = true;
      } catch (err) {
        if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
          await ensureStorageWatcher(options.entryScriptPath || CLI_ENTRY_SCRIPT_PATH, {
            watcherPidPath: p.WATCHER_PID_PATH,
            watcherLockPath: p.WATCHER_LOCK_PATH,
          });
          return {
            status: 'DEFERRED_LOCKED',
            appVersion,
            errorCode: err.code,
            asarRestored: false,
          };
        }
        throw err;
      }
    }

    // Step R5: Complete `runUninstall()` BEFORE releasing `LOCK_PATH`!
    const uninstallReport = await runUninstall({
      ...options,
      pathOverrides: p,
      watcherAlreadyStopped: watcherStoppedEarly,
    });

    const finalReport = {
      status: 'ROLLED_BACK',
      asarStatus,
      asarRestored,
      appVersion,
      uninstall: uninstallReport,
    };
    writeStatus(
      {
        updatedAt: new Date().toISOString(),
        pid: process.pid,
        capabilityRevision: PATCHER_CAPABILITY_REVISION,
        rollback: finalReport,
      },
      p
    );
    return finalReport;
  } finally {
    releaseExclusiveFileLock(p.LOCK_PATH, patchLockToken);
  }
}

function runStatusbarPatchWorker(options = {}) {
  const p = resolveHostPaths((options && options.env) || process.env);
  ensureHostStatusbarPatcherInstalled(p.ENSURE_STATUSBAR_PATCH_PATH);
  const patcherPath = fs.existsSync(p.ENSURE_STATUSBAR_PATCH_PATH)
    ? p.ENSURE_STATUSBAR_PATCH_PATH
    : BUNDLED_ENSURE_STATUSBAR_PATCH_PATH;
  if (!patcherPath || !fs.existsSync(patcherPath)) return false;
  const timeoutMs = options && options.isHook ? 2500 : 15000;
  spawnSync(process.execPath, [patcherPath, '--worker'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: timeoutMs,
    env: (options && options.env) || process.env,
  });
  return true;
}

async function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--llm-sentinel')) {
    runLlmSentinelSupervisor();
    return;
  }

  if (argv.includes('--status')) {
    const { report, exitCode } = buildReadOnlyStatusReport();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = exitCode;
    return;
  }

  if (argv.includes('--sync-mirrors')) {
    const syncRes = syncDistributableMirrors();
    process.stdout.write(JSON.stringify(syncRes, null, 2) + '\n');
    return;
  }

  if (argv.includes('--uninstall')) {
    const res = await runUninstall();
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (argv.includes('--rollback')) {
    const res = await runRollback();
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    if (res.status !== 'ROLLED_BACK') {
      process.exitCode = 1;
    }
    return;
  }

  if (argv.includes('--watch-storage')) {
    runStorageWatcherLoop({ entryScriptPath: CLI_ENTRY_SCRIPT_PATH });
    return;
  }

  const isHook = argv.includes('--hook');
  if (isHook && process.stdin && !process.stdin.isTTY) {
    process.stdin.on('error', () => {});
    process.stdin.resume();
    if (typeof process.stdin.unref === 'function') {
      process.stdin.unref();
    }
  }

  const paths = resolveHostPaths(process.env);
  await ensureStorageWatcher(CLI_ENTRY_SCRIPT_PATH, { fastHook: isHook });

  const cliPretranslate = parsePretranslateCliArg(argv);
  const cliProvider = parseProviderCliArg(argv);
  const updated = updateTranslatorSettings({
    explicitPretranslate: cliPretranslate,
    explicitProvider: cliProvider,
  });

  await reconcileLocalLlmRuntime({
    pluginEnabled: isPluginEnabled(),
    translationProvider: updated.translationProvider,
    llmConfig: updated.llmConfig,
    options: {
      fastHook: isHook,
      llmPidPath: paths.LLM_PID_PATH,
      devtoolsPortFile: paths.DEVTOOLS_PORT_FILE,
    },
  });

  syncCombinedAutoinject({
    pretranslateEnabled: updated.pretranslateEnabled,
    translationProvider: updated.translationProvider,
    llmConfig: updated.llmConfig,
  });

  runStatusbarPatchWorker({ isHook });

  // Check if ASAR is still unpatched after worker (e.g. locked by live Electron) -> record pendingAsarPatch!
  if (fs.existsSync(paths.ASAR_PATH) && !isAsarPatchedFast(paths.ASAR_PATH)) {
    updateTranslatorSettings({
      pendingAsarPatch: true,
      syncToAppStorage: false,
    });
  } else if (updated.pendingAsarPatch) {
    updateTranslatorSettings({
      pendingAsarPatch: false,
      syncToAppStorage: false,
    });
  }

  if ((cliPretranslate !== null || cliProvider !== null) && !isHook) {
    process.stdout.write(
      JSON.stringify(
        {
          translationProvider: updated.translationProvider,
          pretranslateEnabled: updated.pretranslateEnabled,
          llmConfig: updated.llmConfig,
        },
        null,
        2
      ) + '\n'
    );
  }

  if (isHook) {
    process.stdout.write('{}\n');
  }
}

module.exports = {
  parsePatcherCapabilityRevision,
  isPatcherRevisionAtLeast,
  ensureHostStatusbarPatcherInstalled,
  resolveStatusbarPatcherPathReadOnly,
  buildReadOnlyStatusReport,
  computeWatcherSignature,
  ensureStorageWatcher,
  runStorageWatcherLoop,
  runUninstall,
  runRollback,
  runStatusbarPatchWorker,
  runCli,
};

if (require.main === module) {
  runCli().catch((err) => {
    process.stderr.write(`[ko-thought-translator] cli error: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
