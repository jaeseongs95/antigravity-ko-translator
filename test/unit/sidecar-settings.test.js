'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('Official Sidecar manifest conforms to Antigravity AUX_PANE schema', () => {
  const manifestPath = path.join(REPO_ROOT, 'sidecars', 'ko-translator-settings', 'sidecar.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.command, 'node');
  assert.deepEqual(manifest.args, ['main.mjs']);
  assert.equal(manifest.has_web_ui, true);
  assert.equal(manifest.ui_config.views[0].entrypoint, 'SIDECAR_UI_ENTRYPOINT_AUX_PANE');
  assert.equal(manifest.ui_config.views[0].path, '/');
});

test('Official Sidecar handler serves HTML UI, reads diagnostics, and validates/saves settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-sidecar-test-'));
  try {
    const mainUrl = pathToFileURL(path.join(REPO_ROOT, 'sidecars', 'ko-translator-settings', 'main.mjs')).href;
    const { createSettingsRequestHandler } = await import(mainUrl);

    const agyDir = path.join(dir, '.gemini', 'antigravity');
    const cfgDir = path.join(dir, '.gemini', 'config');
    fs.mkdirSync(agyDir, { recursive: true });
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ plugins: { 'ko-thought-translator': { enabled: true } } }),
      'utf8'
    );

    const handle = createSettingsRequestHandler({
      SETTINGS_PATH: path.join(agyDir, 'ko_translator_settings.json'),
      SETTINGS_LOCK_PATH: path.join(agyDir, 'ko_translator_settings.lock'),
      CONFIG_JSON_PATH: path.join(cfgDir, 'config.json'),
      MANIFEST_PATH: path.join(agyDir, 'ui-extensions.d', 'ko-thought-translator.json'),
      ASAR_PATH: path.join(dir, 'missing.asar'),
    });

    const htmlRes = handle({ method: 'GET', urlPath: '/' });
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.body, /Antigravity 한국어 번역 설정/);

    const getRes = handle({ method: 'GET', urlPath: '/api/settings' });
    assert.equal(getRes.status, 200);
    const initial = JSON.parse(getRes.body);
    assert.equal(initial.ok, true);
    assert.equal(initial.settings.provider, 'google-translate');
    assert.equal(initial.diagnostics.pluginEnabled, true);

    const badUrlRes = handle({
      method: 'POST',
      urlPath: '/api/settings',
      rawBody: JSON.stringify({
        provider: 'local-llm',
        llmConfig: { baseUrl: 'http://evil.example.com:11434', model: 'gemma3:4b' },
      }),
    });
    assert.equal(badUrlRes.status, 400);

    const saveRes = handle({
      method: 'POST',
      urlPath: '/api/settings',
      rawBody: JSON.stringify({
        provider: 'local-llm',
        translateThinking: true,
        showThinking: false,
        translateStaticUi: false,
        llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b' },
      }),
    });
    assert.equal(saveRes.status, 200);
    const saved = JSON.parse(saveRes.body);
    assert.equal(saved.ok, true);
    assert.equal(saved.settings.provider, 'local-llm');
    assert.equal(saved.settings.translateStaticUi, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
