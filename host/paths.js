'use strict';

const os = require('os');
const path = require('path');

function resolveHostPaths(env = process.env) {
  const homeDir = env.USERPROFILE || env.HOME || os.homedir();
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const appData = env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

  const appStoragePath = env.AGY_KO_APP_STORAGE_PATH || path.join(appData, 'Antigravity', 'app_storage.json');
  const devtoolsPortFile = env.AGY_KO_DEVTOOLS_PORT_FILE || path.join(appData, 'Antigravity', 'DevToolsActivePort');
  const asarPath = env.AGY_KO_ASAR_PATH || path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar');
  const agyDir = env.AGY_KO_AGY_DIR || path.join(homeDir, '.gemini', 'antigravity');
  const configJsonPath = env.AGY_KO_CONFIG_JSON_PATH || path.join(homeDir, '.gemini', 'config', 'config.json');

  const settingsSsotPath = env.AGY_KO_SETTINGS_SSOT_PATH || path.join(agyDir, 'ko_translator_settings.json');
  const settingsSsotLockPath = `${settingsSsotPath}.lock`;

  const statusbarAutoinjectPath = env.AGY_KO_AUTOINJECT_PATH || path.join(agyDir, 'statusbar_autoinject.js');
  const statusbarAutoinjectLockPath = path.join(agyDir, 'statusbar_autoinject.lock');
  const statusbarPatchLockPath = path.join(agyDir, 'statusbar_patch.lock');
  const appStorageLockPath = path.join(agyDir, 'app_storage_sync.lock');
  const statusbarPatchStatusPath = path.join(agyDir, 'statusbar_patch_status.json');
  const ensureStatusbarPatchPath = path.join(agyDir, 'ensure_statusbar_patch.js');

  const watcherPidPath = env.AGY_KO_WATCHER_PID_PATH || path.join(agyDir, 'ko_thought_watcher.pid');
  const watcherLockPath = `${watcherPidPath}.lock`;
  const llmPidPath = env.AGY_KO_LLM_PID_PATH || path.join(agyDir, 'ko_thought_llm.pid');
  const llmLockPath = `${llmPidPath}.lock`;

  return {
    HOME_DIR: homeDir,
    LOCAL_APPDATA: localAppData,
    APPDATA: appData,
    APP_STORAGE_PATH: appStoragePath,
    DEVTOOLS_PORT_FILE: devtoolsPortFile,
    ASAR_PATH: asarPath,
    AGY_DIR: agyDir,
    CONFIG_JSON_PATH: configJsonPath,
    SETTINGS_SSOT_PATH: settingsSsotPath,
    SETTINGS_SSOT_LOCK_PATH: settingsSsotLockPath,
    STATUSBAR_AUTOINJECT_PATH: statusbarAutoinjectPath,
    STATUSBAR_AUTOINJECT_LOCK_PATH: statusbarAutoinjectLockPath,
    LOCK_PATH: statusbarPatchLockPath,
    APP_STORAGE_LOCK_PATH: appStorageLockPath,
    STATUS_PATH: statusbarPatchStatusPath,
    ENSURE_STATUSBAR_PATCH_PATH: ensureStatusbarPatchPath,
    WATCHER_PID_PATH: watcherPidPath,
    WATCHER_LOCK_PATH: watcherLockPath,
    LLM_PID_PATH: llmPidPath,
    LLM_LOCK_PATH: llmLockPath,
  };
}

const DEFAULT_PATHS = resolveHostPaths(process.env);

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(PLUGIN_ROOT, 'scripts');
const KO_SCRIPT_PATH = path.join(SCRIPTS_DIR, 'ko_thought_autoinject.js');
const DIST_KO_SCRIPT_PATH = path.join(PLUGIN_ROOT, 'dist', 'ko_thought_autoinject.js');
const LEGACY_PLUGIN_KO_SCRIPT_PATH = path.join(
  PLUGIN_ROOT,
  'plugins',
  'ko-thought-translator',
  'scripts',
  'ko_thought_autoinject.js'
);
const LEGACY_SKILL_KO_SCRIPT_PATH = path.join(
  PLUGIN_ROOT,
  'skills',
  'ko-thought-translator',
  'scripts',
  'ko_thought_inject.js'
);
const BUNDLED_ENSURE_STATUSBAR_PATCH_PATH = path.join(__dirname, 'ensure_statusbar_patch.js');
const CLI_ENTRY_SCRIPT_PATH = path.join(SCRIPTS_DIR, 'ensure_ko_thought_patch.js');

const DEFAULT_LLM_BASE_URL = process.env.AGY_LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434';

const BEGIN_MARKER = '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===';
const END_MARKER = '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===';
const BEGIN_BLOCK_MARKER = '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */';
const END_BLOCK_MARKER = '/* === END_AGY_KO_THOUGHT_LOCALIZER_V2 === */';

module.exports = {
  ...DEFAULT_PATHS,
  resolveHostPaths,
  PLUGIN_ROOT,
  SCRIPTS_DIR,
  KO_SCRIPT_PATH,
  DIST_KO_SCRIPT_PATH,
  LEGACY_PLUGIN_KO_SCRIPT_PATH,
  LEGACY_SKILL_KO_SCRIPT_PATH,
  BUNDLED_ENSURE_STATUSBAR_PATCH_PATH,
  CLI_ENTRY_SCRIPT_PATH,
  DEFAULT_LLM_BASE_URL,
  BEGIN_MARKER,
  END_MARKER,
  BEGIN_BLOCK_MARKER,
  END_BLOCK_MARKER,
};
