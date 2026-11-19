'use strict';

/**
 * Antigravity Desktop Host Profile.
 *
 * Encapsulates Antigravity-specific filesystem layout, ASAR anchor,
 * and Hub URL policy so `host/paths.js` and `host/dropin-loader.js`
 * remain vendor-neutral and reusable across other desktop hosts.
 */

const PATCH_MARKER = 'AGY_UI_EXTENSIONS_LOADER_V1';

const MAIN_ANCHOR_TARGET = "electron_1.app.on('web-contents-created', (_event, contents) => {";
const MAIN_ANCHOR_REPLACEMENT =
  "electron_1.app.on('web-contents-created', (_event, contents) => {\n" +
  `    // ${PATCH_MARKER}\n` +
  "    try { const _h = process.env.USERPROFILE || process.env.HOME || require('os').homedir(); const _p = require('path').join(_h, '.gemini', 'antigravity', 'ui-extensions-loader.js'); if (require('fs').existsSync(_p)) require(_p).attach(contents); } catch (_e) { try { console.error('[ko-thought-translator] loader bootstrap error:', _e && _e.message ? _e.message : _e); } catch (_i) {} }";

const ANTIGRAVITY_HOST_PROFILE = Object.freeze({
  id: 'antigravity-desktop',
  pluginId: 'ko-thought-translator',
  configRootSegments: Object.freeze(['.gemini']),
  appDirSegments: Object.freeze(['.gemini', 'antigravity']),
  configDirSegments: Object.freeze(['.gemini', 'config']),
  asarRelativeSegments: Object.freeze(['Programs', 'antigravity', 'resources', 'app.asar']),
  asarEnvVar: 'AGY_ASAR_PATH',
  uiExtensionsDirName: 'ui-extensions.d',
  loaderScriptName: 'ui-extensions-loader.js',
  settingsFileName: 'ko_translator_settings.json',
  settingsLockName: 'ko_translator_settings.lock',
  asarLockName: 'ui_extensions_asar.lock',
  patchMarker: PATCH_MARKER,
  mainEntryInAsar: 'dist/main.js',
  unchangedEntriesInAsar: Object.freeze(['dist/utils.js', 'dist/preload.js']),
  initialSettingsGlobalName: '__AGY_KO_TRANSLATOR_INITIAL_SETTINGS__',
  logPrefix: '[ko-thought-translator]',
  mainAnchorTarget: MAIN_ANCHOR_TARGET,
  mainAnchorReplacement: MAIN_ANCHOR_REPLACEMENT,
  allowedHubUrlRe: /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i,
  legacyPatchMarkers: Object.freeze(['AGY_STATUSBAR', 'AGY_KO_THOUGHT', 'ui-extensions-loader']),
});

module.exports = {
  PATCH_MARKER,
  MAIN_ANCHOR_TARGET,
  MAIN_ANCHOR_REPLACEMENT,
  ANTIGRAVITY_HOST_PROFILE,
};
