'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
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

test('F5: Official Sidecar enforces CSRF, loopback Origin/Host, Content-Type, 413 payload cap, and validates customProviders & apiFormat', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-sidecar-test-'));
  try {
    const mainUrl = pathToFileURL(path.join(REPO_ROOT, 'sidecars', 'ko-translator-settings', 'main.mjs')).href;
    const { createSettingsRequestHandler, createStandaloneHttpServer, MAX_BODY_BYTES } = await import(mainUrl);

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
    assert.match(htmlRes.body, /한글 번역 설정/);
    const metaMatch = htmlRes.body.match(/<meta name="ko-csrf-token" content="([^"]+)" \/>/);
    assert.ok(metaMatch && metaMatch[1] === handle.csrfToken, 'HTML must embed per-instance CSRF token in meta tag');

    const getRes = handle({ method: 'GET', urlPath: '/api/settings' });
    assert.equal(getRes.status, 200);
    const initial = JSON.parse(getRes.body);
    assert.equal(initial.ok, true);
    assert.equal(initial.csrfToken, handle.csrfToken);

    const validHeaders = {
      host: '127.0.0.1:43210',
      origin: 'http://127.0.0.1:43210',
      'content-type': 'application/json',
      'x-ko-csrf-token': metaMatch[1],
    };

    // 1. Missing CSRF token -> 403
    const noCsrf = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: { host: '127.0.0.1:43210', 'content-type': 'application/json' },
      rawBody: JSON.stringify({ provider: 'google-translate' }),
    });
    assert.equal(noCsrf.status, 403);

    // 2. External web Origin -> 403 (blocks local web CSRF -> SSRF)
    const badOrigin = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: { ...validHeaders, origin: 'https://evil.example.com' },
      rawBody: JSON.stringify({ provider: 'google-translate' }),
    });
    assert.equal(badOrigin.status, 403);

    // 3. External Host header -> 403 (blocks DNS rebinding)
    const badHost = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: { ...validHeaders, host: 'evil.example.com' },
      rawBody: JSON.stringify({ provider: 'google-translate' }),
    });
    assert.equal(badHost.status, 403);

    // 4. Non-JSON Content-Type -> 415
    const badCt = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: { ...validHeaders, 'content-type': 'text/plain' },
      rawBody: JSON.stringify({ provider: 'google-translate' }),
    });
    assert.equal(badCt.status, 415);

    // 5. SSRF URL rejected -> 400
    const badUrlRes = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: validHeaders,
      rawBody: JSON.stringify({
        provider: 'local-llm',
        llmConfig: { baseUrl: 'http://evil.example.com:11434', model: 'gemma3:4b' },
      }),
    });
    assert.equal(badUrlRes.status, 400);

    // 6. Malformed / forbidden-header customProviders rejected -> 400
    const badCustomRes = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: validHeaders,
      rawBody: JSON.stringify({
        customProviders: [
          {
            id: 'my-custom',
            url: 'https://api.example.com/translate',
            headers: { Authorization: 'Bearer secret-must-not-be-stored' },
          },
        ],
      }),
    });
    assert.equal(badCustomRes.status, 400);

    // 7. Valid save canonicalizes apiFormat 'openai-compat' -> 'openai' & persists F2 customProviders with endpointUrl/allowRemoteHttps
    const saveRes = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: validHeaders,
      rawBody: JSON.stringify({
        provider: 'my-custom',
        translateThinking: true,
        showThinking: false,
        translateStaticUi: false,
        llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b', apiFormat: 'openai-compat' },
        customProviders: [
          {
            id: 'my-custom',
            label: 'My Custom',
            endpointUrl: 'https://api.example.com/translate',
            allowRemoteHttps: true,
            method: 'POST',
            bodyTemplate: { q: '{{text}}' },
            responsePath: 'data.text',
          },
        ],
      }),
    });
    assert.equal(saveRes.status, 200);
    const saved = JSON.parse(saveRes.body);
    assert.equal(saved.ok, true);
    assert.equal(saved.settings.provider, 'my-custom');
    assert.equal(saved.settings.llmConfig.apiFormat, 'openai');
    assert.equal(saved.settings.customProviders.length, 1);
    assert.equal(saved.settings.customProviders[0].endpointUrl, 'https://api.example.com/translate');
    assert.equal(saved.settings.customProviders[0].allowRemoteHttps, true);

    // 8. Standalone HTTP server returns 413 Payload Too Large (zero silent truncation)
    const server = createStandaloneHttpServer(handle);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address();
      const oversizedStatus = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: addr.port,
            path: '/api/settings',
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-ko-csrf-token': handle.csrfToken,
              'connection': 'close',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          }
        );
        req.on('error', (err) => {
          if (err.code === 'ECONNRESET') resolve(413);
          else reject(err);
        });
        req.end('x'.repeat(MAX_BODY_BYTES + 1024));
      });
      assert.equal(oversizedStatus, 413);
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
