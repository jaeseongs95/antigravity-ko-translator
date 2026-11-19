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

function makeTempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-host-test-'));
  const agyDir = path.join(dir, '.gemini', 'antigravity');
  const cfgDir = path.join(dir, '.gemini', 'config');
  const pluginsDir = path.join(cfgDir, 'plugins');
  fs.mkdirSync(agyDir, { recursive: true });
  fs.mkdirSync(path.join(pluginsDir, 'ko-thought-translator', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir, 'ko-thought-translator', 'dist', 'renderer.js'), '// renderer\n', 'utf8');
  return {
    dir,
    paths: {
      PLUGIN_ID: 'ko-thought-translator',
      RENDERER_BUNDLE_PATH: path.join(pluginsDir, 'ko-thought-translator', 'dist', 'renderer.js'),
      UI_EXTENSIONS_DIR: path.join(agyDir, 'ui-extensions.d'),
      MANIFEST_PATH: path.join(agyDir, 'ui-extensions.d', 'ko-thought-translator.json'),
      LOADER_SCRIPT_PATH: path.join(agyDir, 'ui-extensions-loader.js'),
      SETTINGS_PATH: path.join(agyDir, 'ko_translator_settings.json'),
      SETTINGS_LOCK_PATH: path.join(agyDir, 'ko_translator_settings.lock'),
      ASAR_LOCK_PATH: path.join(agyDir, 'ui_extensions_asar.lock'),
      CONFIG_JSON_PATH: path.join(cfgDir, 'config.json'),
      PLUGINS_ROOT_DIR: pluginsDir,
      ASAR_PATH: path.join(dir, 'nonexistent-app.asar'),
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('host CLI --status is 100% read-only and --install/--uninstall manage manifest cleanly', async () => {
  const { dir, paths } = makeTempEnv();
  try {
    const before = buildStatusReport(paths);
    assert.equal(before.manifestRegistered, false);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), false);

    await runCli(['--install'], paths);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), true);
    assert.equal(fs.existsSync(paths.LOADER_SCRIPT_PATH), true);

    await runCli(['--uninstall'], paths);
    assert.equal(fs.existsSync(paths.MANIFEST_PATH), false);

    // F4: Non-standard entryScript outside PLUGINS_ROOT_DIR/<pluginId> MUST fail closed (never fake INSTALLED)
    const outsideEntry = path.join(dir, 'outside-renderer.js');
    fs.writeFileSync(outsideEntry, '// outside\n', 'utf8');
    const prevExitCode = process.exitCode;
    const failedInst = await runCli(['--install'], { ...paths, RENDERER_BUNDLE_PATH: outsideEntry });
    assert.equal(failedInst.status, 'FAILED');
    assert.equal(process.exitCode, 1);
    assert.equal(buildStatusReport(paths).manifestRegistered, false);
    process.exitCode = prevExitCode || 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
