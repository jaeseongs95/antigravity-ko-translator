'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readTranslatorSettings,
  saveTranslatorSettings,
  removeTranslatorSettings,
  isPluginEnabled,
  acquireExclusiveLock,
  releaseExclusiveLock,
} = require('../../host/config-store');
const { buildStatusReport, runCli } = require('../../host/cli');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function makeTempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-host-test-'));
  const agyDir = path.join(dir, '.gemini', 'antigravity');
  const cfgDir = path.join(dir, '.gemini', 'config');
  const pluginsDir = path.join(cfgDir, 'plugins');
  const pluginDir = path.join(pluginsDir, 'ko-thought-translator');
  fs.mkdirSync(agyDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'dist', 'renderer.js'), '// renderer\n', 'utf8');
  fs.writeFileSync(path.join(pluginDir, 'dist', 'main-hook.js'), 'module.exports = {};\n', 'utf8');
  return {
    dir,
    pluginDir,
    paths: {
      PLUGIN_ID: 'ko-thought-translator',
      SOURCE_MANIFEST_PATH: path.join(REPO_ROOT, 'addon-manifest.v1.json'),
      RENDERER_BUNDLE_PATH: path.join(pluginDir, 'dist', 'renderer.js'),
      MAIN_HOOK_PATH: path.join(pluginDir, 'dist', 'main-hook.js'),
      ADDONS_DIR: path.join(agyDir, 'addons.d'),
      MANIFEST_PATH: path.join(agyDir, 'addons.d', 'ko-thought-translator.json'),
      ADDONS_LOCK_PATH: path.join(agyDir, 'addon-host-addons.lock'),
      LOADER_SCRIPT_PATH: path.join(agyDir, 'addon-host-loader.js'),
      SETTINGS_PATH: path.join(agyDir, 'ko_translator_settings.json'),
      SETTINGS_LOCK_PATH: path.join(agyDir, 'ko_translator_settings.lock'),
      CONFIG_JSON_PATH: path.join(cfgDir, 'config.json'),
      PLUGINS_ROOT_DIR: pluginsDir,
    },
  };
}

test('config-store persists settings atomically to ko_translator_settings.json and fails closed on busy lock', () => {
  const { dir, paths } = makeTempEnv();
  try {
    const saved = saveTranslatorSettings(
      {
        provider: 'local-llm',
        translateThinking: true,
        showThinking: false,
        translateStaticUi: true,
        llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' },
      },
      paths
    );
    assert.equal(saved.provider, 'local-llm');
    assert.equal(saved.showThinking, false);
    assert.equal(saved.llmConfig.model, 'qwen2.5:7b');

    const reloaded = readTranslatorSettings(paths);
    assert.equal(reloaded.provider, 'local-llm');
    assert.equal(reloaded.llmConfig.model, 'qwen2.5:7b');

    // Fail-closed lock check: holding an active lock MUST throw SETTINGS_LOCK_BUSY (never lockless overwrite!)
    const tok = acquireExclusiveLock(paths.SETTINGS_LOCK_PATH);
    assert.ok(tok);
    try {
      assert.throws(() => saveTranslatorSettings({ provider: 'google-translate' }, paths), /SETTINGS_LOCK_BUSY/);
    } finally {
      releaseExclusiveLock(paths.SETTINGS_LOCK_PATH, tok);
    }

    assert.equal(removeTranslatorSettings(paths), true);
    assert.equal(fs.existsSync(paths.SETTINGS_PATH), false);

    // Corrupted settings file MUST fail closed on save (never silently reset to google-translate)
    fs.writeFileSync(paths.SETTINGS_PATH, '{corrupted-user-settings', 'utf8');
    assert.throws(() => saveTranslatorSettings({ showThinking: false }, paths), /SETTINGS_FILE_CORRUPTED/);
    assert.equal(fs.readFileSync(paths.SETTINGS_PATH, 'utf8'), '{corrupted-user-settings');
    fs.unlinkSync(paths.SETTINGS_PATH);

    // Non-array customProviders and secret headers/query params MUST fail closed
    assert.throws(() => saveTranslatorSettings({ customProviders: 'invalid' }, paths), /INVALID_CUSTOM_PROVIDERS_LIST/);
    assert.throws(
      () =>
        saveTranslatorSettings(
          {
            customProviders: [
              {
                id: 'goog-leak',
                endpointUrl: 'https://api.example.com/v1?api_key=secret',
                allowRemoteHttps: true,
                bodyTemplate: { q: '{{text}}' },
                responsePath: 'text',
              },
            ],
          },
          paths
        ),
      /FORBIDDEN_SECRET_QUERY_IN_HOST_SETTINGS/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isPluginEnabled reads config.json read-only without mutating it', () => {
  const { dir, paths } = makeTempEnv();
  try {
    assert.equal(isPluginEnabled(paths.CONFIG_JSON_PATH), true);
    fs.writeFileSync(
      paths.CONFIG_JSON_PATH,
      JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: false } } }),
      'utf8'
    );
    assert.equal(isPluginEnabled(paths.CONFIG_JSON_PATH), false);

    // Corrupted existing config.json MUST fail closed (false)
    fs.writeFileSync(paths.CONFIG_JSON_PATH, '{broken-config', 'utf8');
    assert.equal(isPluginEnabled(paths.CONFIG_JSON_PATH), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('host CLI --status is 100% read-only and --install/--uninstall/--rollback manage AddonManifest.v1 cleanly without touching app.asar', async () => {
  const { dir, pluginDir, paths } = makeTempEnv();
  try {
    const before = buildStatusReport(paths);
    assert.equal(before.manifestSchema, 'AddonManifest.v1');
    assert.equal(before.manifestRegistered, false);
    assert.equal(before.addonHostInstalled, false);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), false);

    // Simulate installed shared host loader
    fs.writeFileSync(paths.LOADER_SCRIPT_PATH, '// ADDON_HOST_LOADER_V1\n', 'utf8');

    const inst = await runCli(['--install'], paths);
    assert.equal(inst.status, 'INSTALLED');
    assert.equal(inst.addonHostInstalled, true);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), true);
    const afterInstall = buildStatusReport(paths);
    assert.equal(afterInstall.manifestRegistered, true);
    assert.equal(afterInstall.addonHostInstalled, true);

    const uninst = await runCli(['--uninstall'], paths);
    assert.equal(uninst.status, 'UNINSTALLED');
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), false);

    // --rollback only unregisters this addon and never touches shared host loader or app.asar
    await runCli(['--install'], paths);
    const rb = await runCli(['--rollback'], paths);
    assert.equal(rb.status, 'MANIFEST_REMOVED_HOST_PRESERVED');
    assert.equal(rb.manifestRemoved, true);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), false);
    assert.equal(fs.existsSync(paths.LOADER_SCRIPT_PATH), true);

    // Missing confined renderer entry inside PLUGINS_ROOT_DIR/<pluginId> MUST fail closed
    fs.unlinkSync(path.join(pluginDir, 'dist', 'renderer.js'));
    const prevExitCode = process.exitCode;
    const failedInst = await runCli(['--install'], paths);
    assert.equal(failedInst.status, 'FAILED');
    assert.equal(failedInst.error, 'ERR_ENTRY_SCRIPT_NOT_FOUND');
    assert.equal(process.exitCode, 1);
    assert.equal(buildStatusReport(paths).manifestRegistered, false);
    process.exitCode = prevExitCode || 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
