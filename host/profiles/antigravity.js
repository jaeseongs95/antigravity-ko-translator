'use strict';

/**
 * Antigravity Desktop Host Profile for AddonManifest.v2 (`ko-thought-translator`).
 *
 * Zero `app.asar` patching metadata and zero `mainHook`: `app.asar` authority and
 * unidirectional read-only `settingsBridge` delivery belong exclusively to
 * `antigravity-native-addon-host` (>= v2.1.0).
 */

const PATCH_MARKER = 'ADDON_HOST_LOADER_V2';

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
  isolatedWorldId: 998,
  logPrefix: '[ko-thought-translator]',
});

module.exports = {
  PATCH_MARKER,
  ANTIGRAVITY_HOST_PROFILE,
};
