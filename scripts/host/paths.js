/**
 * Module: scripts/host/paths.js
 * Responsibility: Centralized filesystem paths, environment constants, and bundle markers for the host patcher.
 */

const os = require('os');
const path = require('path');

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || os.homedir();
const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME_DIR, 'AppData', 'Roaming');
const APP_STORAGE_PATH = path.join(APPDATA, 'Antigravity', 'app_storage.json');
const DEVTOOLS_PORT_FILE = path.join(APPDATA, 'Antigravity', 'DevToolsActivePort');
const ASAR_PATH = path.join(LOCAL_APPDATA, 'Programs', 'antigravity', 'resources', 'app.asar');
const LS_BIN_PATH = path.join(
  LOCAL_APPDATA,
  'Programs',
  'antigravity',
  'resources',
  'bin',
  process.platform === 'win32' ? 'language_server.exe' : 'language_server'
);
const AGY_DIR = path.join(HOME_DIR, '.gemini', 'antigravity');
const WEB_BUNDLE_DIR = path.join(AGY_DIR, 'web_bundle');
const WEB_BUNDLE_META_PATH = path.join(WEB_BUNDLE_DIR, '.agy_bundle_meta.json');
const CONFIG_JSON_PATH = path.join(HOME_DIR, '.gemini', 'config', 'config.json');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(PLUGIN_ROOT, 'scripts');
const RENDERER_DIR = path.join(SCRIPTS_DIR, 'renderer');
const KO_SCRIPT_PATH = path.join(SCRIPTS_DIR, 'ko_thought_autoinject.js');

const STATUSBAR_AUTOINJECT_PATH = path.join(AGY_DIR, 'statusbar_autoinject.js');
const ENSURE_STATUSBAR_PATCH_PATH = path.join(AGY_DIR, 'ensure_statusbar_patch.js');
const WATCHER_PID_PATH = path.join(AGY_DIR, 'ko_thought_watcher.pid');
const LLM_BASE_URL = process.env.AGY_LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434';

const BEGIN_MARKER = '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===';
const END_MARKER = '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===';

const RENDERER_MODULE_FILES = [
  '01-bootstrap-and-cache.js',
  '02-static-ui-dict.js',
  '03-text-tokenizer.js',
  '04-translation-adapters.js',
  '05-fiber-pretranslator.js',
  '06-settings-modal-ui.js',
  '07-statusbar-adapter.js',
  '08-dom-observer.js',
];

module.exports = {
  HOME_DIR,
  LOCAL_APPDATA,
  APPDATA,
  APP_STORAGE_PATH,
  DEVTOOLS_PORT_FILE,
  ASAR_PATH,
  LS_BIN_PATH,
  AGY_DIR,
  WEB_BUNDLE_DIR,
  WEB_BUNDLE_META_PATH,
  CONFIG_JSON_PATH,
  PLUGIN_ROOT,
  SCRIPTS_DIR,
  RENDERER_DIR,
  KO_SCRIPT_PATH,
  STATUSBAR_AUTOINJECT_PATH,
  ENSURE_STATUSBAR_PATCH_PATH,
  WATCHER_PID_PATH,
  LLM_BASE_URL,
  BEGIN_MARKER,
  END_MARKER,
  RENDERER_MODULE_FILES,
};
