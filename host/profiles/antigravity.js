'use strict';

/**
 * Antigravity Desktop Host Profile for AddonManifest.v1 (`ko-thought-translator`).
 *
 * Zero `app.asar` patching metadata: `app.asar` authority belongs exclusively to
 * `antigravity-native-addon-host`. This profile declares only the vendor-specific
 * filesystem layout and runtime bridge identifiers consumed by `host/paths.js`,
 * `host/addon-registry.js`, and `host/main-hook.js`.
 */

const PATCH_MARKER = 'ADDON_HOST_LOADER_V1';

const ANTIGRAVITY_HOST_PROFILE = Object.freeze({
  id: 'antigravity-desktop',
  pluginId: 'ko-thought-translator',
  configRootSegments: Object.freeze(['.gemini']),
  appDirSegments: Object.freeze(['.gemini', 'antigravity']),
  configDirSegments: Object.freeze(['.gemini', 'config']),
  addonsDirName: 'addons.d',
  addonsLockName: 'addon-host-addons.lock',
  loaderScriptName: 'addon-host-loader.js',
  settingsFileName: 'ko_translator_settings.json',
  settingsLockName: 'ko_translator_settings.lock',
  patchMarker: PATCH_MARKER,
  isolatedWorldId: 999,
  initialSettingsGlobalName: '__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__',
  runtimeGlobalName: '__agyKoTranslator',
  logPrefix: '[ko-thought-translator]',
});

module.exports = {
  PATCH_MARKER,
  ANTIGRAVITY_HOST_PROFILE,
};
