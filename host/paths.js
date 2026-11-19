'use strict';

/**
 * Clean-Slate Host Filesystem Paths for Antigravity Desktop ko-thought-translator.
 *
 * Strictly isolated from Antigravity host internal storage and sibling plugin files.
 */

const os = require('os');
const path = require('path');

const PLUGIN_ID = 'ko-thought-translator';
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const RENDERER_BUNDLE_PATH = path.join(PLUGIN_ROOT, 'dist', 'renderer.js');

function resolveHostPaths(env = process.env) {
  const HOME_DIR = (env && (env.USERPROFILE || env.HOME)) || os.homedir();
  const LOCAL_APPDATA = (env && env.LOCALAPPDATA) || path.join(HOME_DIR, 'AppData', 'Local');
  const GEMINI_DIR = path.join(HOME_DIR, '.gemini');
  const AGY_DIR = path.join(GEMINI_DIR, 'antigravity');
  const CONFIG_DIR = path.join(GEMINI_DIR, 'config');
  const PLUGINS_ROOT_DIR = path.join(CONFIG_DIR, 'plugins');
  const CONFIG_JSON_PATH = path.join(CONFIG_DIR, 'config.json');

  const UI_EXTENSIONS_DIR = path.join(AGY_DIR, 'ui-extensions.d');
  const MANIFEST_PATH = path.join(UI_EXTENSIONS_DIR, `${PLUGIN_ID}.json`);
  const LOADER_SCRIPT_PATH = path.join(AGY_DIR, 'ui-extensions-loader.js');
  const SETTINGS_PATH = path.join(AGY_DIR, 'ko_translator_settings.json');
  const SETTINGS_LOCK_PATH = path.join(AGY_DIR, 'ko_translator_settings.lock');
  const ASAR_LOCK_PATH = path.join(AGY_DIR, 'ui_extensions_asar.lock');

  const ASAR_PATH =
    (env && env.AGY_ASAR_PATH) ||
    path.join(LOCAL_APPDATA, 'Programs', 'antigravity', 'resources', 'app.asar');

  return {
    PLUGIN_ID,
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
