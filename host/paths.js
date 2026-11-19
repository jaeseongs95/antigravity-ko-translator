'use strict';

/**
 * Profile-Driven Host Filesystem Path Resolver.
 *
 * Defaults to `ANTIGRAVITY_HOST_PROFILE` while allowing any compatible HostProfile
 * to be injected for vendor-independent testing or alternate desktop hosts.
 */

const os = require('os');
const path = require('path');

const { ANTIGRAVITY_HOST_PROFILE } = require('./profiles/antigravity');

const PLUGIN_ID = ANTIGRAVITY_HOST_PROFILE.pluginId;
const PLUGIN_ROOT = path.resolve(__dirname, '..');
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

  const UI_EXTENSIONS_DIR = path.join(AGY_DIR, activeProfile.uiExtensionsDirName);
  const MANIFEST_PATH = path.join(UI_EXTENSIONS_DIR, `${activeProfile.pluginId}.json`);
  const LOADER_SCRIPT_PATH = path.join(AGY_DIR, activeProfile.loaderScriptName);
  const SETTINGS_PATH = path.join(AGY_DIR, activeProfile.settingsFileName);
  const SETTINGS_LOCK_PATH = path.join(AGY_DIR, activeProfile.settingsLockName);
  const ASAR_LOCK_PATH = path.join(AGY_DIR, activeProfile.asarLockName);

  const ASAR_PATH =
    (env && activeProfile.asarEnvVar && env[activeProfile.asarEnvVar]) ||
    path.join(LOCAL_APPDATA, ...activeProfile.asarRelativeSegments);

  return {
    PLUGIN_ID: activeProfile.pluginId,
    PLUGIN_ROOT,
    RENDERER_BUNDLE_PATH,
    HOME_DIR,
    LOCAL_APPDATA,
    GEMINI_DIR,
    AGY_DIR,
    CONFIG_DIR,
    PLUGINS_ROOT_DIR,
    CONFIG_JSON_PATH,
    UI_EXTENSIONS_DIR,
    MANIFEST_PATH,
    LOADER_SCRIPT_PATH,
    SETTINGS_PATH,
    SETTINGS_LOCK_PATH,
    ASAR_LOCK_PATH,
    ASAR_PATH,
  };
}

module.exports = {
  PLUGIN_ID,
  PLUGIN_ROOT,
  RENDERER_BUNDLE_PATH,
  resolveHostPaths,
};
