'use strict';

/**
 * AddonManifest.v1 Main Process Hook (`entry.mainHookScript`) for `ko-thought-translator`.
 *
 * Responsibilities (SRP):
 * - Reads isolated `~/.gemini/antigravity/ko_translator_settings.json` strictly (fail-closed on corruption).
 * - Pushes settings into each trusted renderer `WebContents` Isolated World (`isolatedWorldId: 999`)
 *   after verifying `isAllowedRendererUrl(contents.getURL())` on every push (TOCTOU safe).
 * - Live-syncs settings saved by the Official Sidecar (`sidecars/ko-translator-settings/`)
 *   to all active trusted windows via a single debounced `fs.watch`, without requiring app reload.
 * - Cleans up every watcher, timer, and `webContents` listener on `dispose()`.
 */

const fs = require('node:fs');
const path = require('node:path');

const { resolveHostPaths } = require('./paths');
const { ANTIGRAVITY_HOST_PROFILE } = require('./profiles/antigravity');
const { readTranslatorSettings } = require('./config-store');

function serializeSafeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function readFailClosedSettingsPayload(paths) {
  try {
    return readTranslatorSettings(paths, { strict: true });
  } catch (_err) {
    // Fail-closed: NEVER fall back to external translation when settings file is corrupted.
    return { enabled: false, settingsCorrupted: true };
  }
}

function buildSettingsPushScript(settingsPayload, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const globalName = JSON.stringify(activeProfile.initialSettingsGlobalName || '__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__');
  const runtimeName = JSON.stringify(activeProfile.runtimeGlobalName || '__agyKoTranslator');
  const safeJson = serializeSafeInlineJson(settingsPayload);
  return `(function(){
  'use strict';
  const nextSettings = ${safeJson};
  window[${globalName}] = nextSettings;
  const inst = window[${runtimeName}];
  if (inst && typeof inst.updateSettings === 'function') {
    try { inst.updateSettings(nextSettings); } catch (_err) {}
  }
})();`;
}

function createMainHookController({
  pathOverrides = null,
  profile = ANTIGRAVITY_HOST_PROFILE,
  watchDebounceMs = 150,
  fsModule = fs,
} = {}) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const resolvedPaths = {
    ...resolveHostPaths(process.env, activeProfile),
    ...(pathOverrides || {}),
  };
  const worldId =
    Number.isInteger(activeProfile.isolatedWorldId) && activeProfile.isolatedWorldId >= 1
      ? activeProfile.isolatedWorldId
      : 999;

  let active = false;
  let watcher = null;
  let debounceTimer = null;
  const trackedWindows = new Map();

  function execInIsolatedWorld(contents, code) {
    if (typeof contents.executeJavaScriptInIsolatedWorld === 'function') {
      return contents.executeJavaScriptInIsolatedWorld(worldId, [{ code }], true);
    }
    if (typeof contents.executeJavaScript === 'function') {
      return contents.executeJavaScript(code, true);
    }
    return Promise.resolve(false);
  }

  async function pushSettingsToContents(contents, isAllowedRendererUrl) {
    if (!active || !contents) return false;
    if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return false;
    const liveUrl = typeof contents.getURL === 'function' ? contents.getURL() : '';
    if (typeof isAllowedRendererUrl === 'function' && !isAllowedRendererUrl(liveUrl)) {
      return false;
    }
    const payload = readFailClosedSettingsPayload(resolvedPaths);
    const script = buildSettingsPushScript(payload, activeProfile);
    try {
      await execInIsolatedWorld(contents, script);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function broadcastSettingsToAllWindows() {
    if (!active) return;
    for (const [contents, entry] of Array.from(trackedWindows.entries())) {
      if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) {
        detachContents(contents);
        continue;
      }
      void pushSettingsToContents(contents, entry.isAllowedRendererUrl);
    }
  }

  function scheduleBroadcast() {
    if (!active) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcastSettingsToAllWindows();
    }, Math.max(0, Number(watchDebounceMs) || 0));
    if (debounceTimer && typeof debounceTimer.unref === 'function') {
      debounceTimer.unref();
    }
  }

  function ensureSettingsWatcher() {
    if (!active || watcher) return;
    const settingsDir = path.dirname(resolvedPaths.SETTINGS_PATH);
    const settingsBaseName = path.basename(resolvedPaths.SETTINGS_PATH);
    try {
      if (!fsModule.existsSync(settingsDir)) {
        fsModule.mkdirSync(settingsDir, { recursive: true });
      }
      watcher = fsModule.watch(settingsDir, { persistent: false }, (_eventType, filename) => {
        if (!active) return;
        if (!filename || String(filename) === settingsBaseName) {
          scheduleBroadcast();
        }
      });
      if (watcher && typeof watcher.on === 'function') {
        watcher.on('error', () => {
          // Non-fatal: keep hook alive; settings still sync on next dom-ready / did-finish-load.
        });
      }
    } catch (_err) {
      watcher = null;
    }
  }

  function detachContents(contents) {
    const entry = trackedWindows.get(contents);
    if (!entry) return;
    trackedWindows.delete(contents);
    if (contents && typeof contents.removeListener === 'function') {
      try {
        contents.removeListener('dom-ready', entry.onLoad);
        contents.removeListener('did-finish-load', entry.onLoad);
        contents.removeListener('destroyed', entry.onDestroyed);
      } catch (_err) {}
    }
  }

  function activate() {
    if (active) return;
    active = true;
    ensureSettingsWatcher();
  }

  function onWebContentsCreated({ contents, isAllowedRendererUrl } = {}) {
    if (!active || !contents) return;
    if (typeof contents.getType === 'function' && contents.getType() !== 'window') return;
    if (trackedWindows.has(contents)) return;

    const onLoad = () => {
      void pushSettingsToContents(contents, isAllowedRendererUrl);
    };
    const onDestroyed = () => {
      detachContents(contents);
    };

    trackedWindows.set(contents, { isAllowedRendererUrl, onLoad, onDestroyed });
    if (typeof contents.on === 'function') {
      contents.on('dom-ready', onLoad);
      contents.on('did-finish-load', onLoad);
      contents.on('destroyed', onDestroyed);
    }
    // If the window already finished loading a trusted URL, push immediately.
    void pushSettingsToContents(contents, isAllowedRendererUrl);
  }

  function dispose() {
    if (!active && !watcher && trackedWindows.size === 0) return;
    active = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch (_err) {}
      watcher = null;
    }
    for (const contents of Array.from(trackedWindows.keys())) {
      detachContents(contents);
    }
  }

  return Object.freeze({
    activate,
    onWebContentsCreated,
    dispose,
    pushSettingsToContents,
    getTrackedWindowCount: () => trackedWindows.size,
    isActive: () => active,
  });
}

const defaultController = createMainHookController();

module.exports = {
  serializeSafeInlineJson,
  readFailClosedSettingsPayload,
  buildSettingsPushScript,
  createMainHookController,
  activate: (ctx) => defaultController.activate(ctx),
  onWebContentsCreated: (ctx) => defaultController.onWebContentsCreated(ctx),
  dispose: () => defaultController.dispose(),
};
