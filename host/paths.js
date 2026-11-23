'use strict';

/**
 * Profile-Driven Host Filesystem Path Resolver (AddonManifest.v2).
 *
 * Resolves plugin manifest, renderer entry, shared `addons.d` registry,
 * and isolated plugin settings paths without ever referencing `app.asar` or `mainHook`.
 */

const os = require('node:os');
const path = require('node:path');

const { ANTIGRAVITY_HOST_PROFILE } = require('./profiles/antigravity');

const PLUGIN_ID = ANTIGRAVITY_HOST_PROFILE.pluginId;
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SOURCE_MANIFEST_PATH = path.join(PLUGIN_ROOT, 'addon-manifest.v2.json');
const RENDERER_BUNDLE_PATH = path.join(PLUGIN_ROOT, 'dist', 'renderer.js');

function resolveHostPaths(env = process.env, profile = ANTIGRAVITY_HOST_PROFILE) {
  const activeProfile = profile || ANTIGRAVITY_HOST_PROFILE;
  const HOME_DIR = (env && (env.USERPROFILE || env.HOME)) || os.homedir();
  const LOCAL_APPDATA = (env && env.LOCALAPPDATA) || path.join(HOME_DIR, 'AppData', 'Local');
  const GEMINI_DIR = path.join(HOME_DIR, ...activeProfile.configRootSegments);
  const AGY_DIR = path.join(HOME_DIR, ...activeProfile.appDirSegments);
  const CONFIG_DIR = path.join(HOME_DIR, ...activeProfile.configDirSegments);
  const PLUGINS_ROOT_DIR = path.join(CONFIG_DIR, 'plugins');
  const CONFIG_JSON_PATH = path.join(CONFIG_DIR, 'config.json');

  const ADDONS_DIR = path.join(AGY_DIR, activeProfile.addonsDirName || 'addons.d');
  const MANIFEST_PATH = path.join(ADDONS_DIR, `${activeProfile.pluginId}.json`);
  const ADDONS_LOCK_PATH = path.join(AGY_DIR, activeProfile.addonsLockName || 'addon-host-addons.lock');
  const LOADER_SCRIPT_PATH = path.join(AGY_DIR, activeProfile.loaderScriptName || 'addon-host-loader.js');
  const SETTINGS_PATH = path.join(AGY_DIR, activeProfile.settingsFileName);
  const SETTINGS_LOCK_PATH = path.join(AGY_DIR, activeProfile.settingsLockName);

  return {
    PLUGIN_ID: activeProfile.pluginId,
    PLUGIN_ROOT,
    SOURCE_MANIFEST_PATH,
    RENDERER_BUNDLE_PATH,
    HOME_DIR,
    LOCAL_APPDATA,
    GEMINI_DIR,
    AGY_DIR,
    CONFIG_DIR,
    PLUGINS_ROOT_DIR,
    CONFIG_JSON_PATH,
    ADDONS_DIR,
    MANIFEST_PATH,
    ADDONS_LOCK_PATH,
    LOADER_SCRIPT_PATH,
    SETTINGS_PATH,
    SETTINGS_LOCK_PATH,
  };
}

module.exports = {
  PLUGIN_ID,
  PLUGIN_ROOT,
  SOURCE_MANIFEST_PATH,
  RENDERER_BUNDLE_PATH,
  resolveHostPaths,
};
