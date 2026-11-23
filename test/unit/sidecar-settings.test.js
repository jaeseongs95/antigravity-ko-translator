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
    const {
      createSettingsRequestHandler,
      createStandaloneHttpServer,
      createSidecarAppRoutes,
      startSidecarWithSdk,
      MAX_BODY_BYTES,
    } = await import(mainUrl);

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
      MANIFEST_PATH: path.join(agyDir, 'addons.d', 'ko-thought-translator.json'),
      LOADER_SCRIPT_PATH: path.join(agyDir, 'addon-host-loader.js'),
    });

    const htmlRes = handle({ method: 'GET', urlPath: '/', headers: { host: '127.0.0.1:43210' }, requireHost: true });
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.body, /한글 번역 설정/);
    const metaMatch = htmlRes.body.match(/<meta name="ko-csrf-token" content="([^"]+)" \/>/);
    assert.ok(metaMatch && metaMatch[1] === handle.csrfToken, 'HTML must embed per-instance CSRF token in meta tag');

    // F3: GET / and GET /api/settings MUST reject DNS rebinding Host and missing Host (HTTP/1.0)
    assert.equal(
      handle({ method: 'GET', urlPath: '/', headers: { host: 'rebind.evil.com' }, requireHost: true }).status,
      403
    );
    assert.equal(
      handle({ method: 'GET', urlPath: '/api/settings', headers: { host: 'rebind.evil.com' }, requireHost: true }).status,
      403
    );
    assert.equal(
      handle({ method: 'GET', urlPath: '/api/settings', headers: {}, requireHost: true }).status,
      403
    );

    const getRes = handle({
      method: 'GET',
      urlPath: '/api/settings',
      headers: { host: '127.0.0.1:43210' },
      requireHost: true,
    });
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

    // 2b. Cross-port loopback Origin -> 403 (enforces isOriginMatchingHost in validateLoopbackRequest)
    const crossPortOrigin = handle({
      method: 'POST',
      urlPath: '/api/settings',
      headers: { ...validHeaders, origin: 'http://127.0.0.1:9999' },
      rawBody: JSON.stringify({ provider: 'google-translate' }),
    });
    assert.equal(crossPortOrigin.status, 403);

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

    // 8. F3: Standalone HTTP server returns exact HTTP 413 + JSON body (zero ECONNRESET tolerance)
    const server = createStandaloneHttpServer(handle);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const addr = server.address();
      const oversizedRes = await new Promise((resolve, reject) => {
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
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
          }
        );
        req.on('error', reject);
        req.end('x'.repeat(MAX_BODY_BYTES + 1024));
      });
      assert.equal(oversizedRes.statusCode, 413);
      assert.equal(JSON.parse(oversizedRes.body).error, 'PAYLOAD_TOO_LARGE');
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    }

    // 9. Track A-2 (TC-026): Real sidecar_sdk contract (`page`/`api`/`run` returning http.Server)
    //    wrapped by `attachSidecarSecurityGate` (`rawListeners('request')` + `removeAllListeners('request')`).
    const httpReq = (port, { method = 'GET', reqPath = '/', headers = {}, body = null } = {}) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: reqPath, method, headers },
          (res) => {
            let out = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { out += c; });
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: out }));
          }
        );
        req.on('error', reject);
        if (body !== null) req.end(body);
        else req.end();
      });

    // Contract-accurate SidecarApp mirror (matches installed sidecar_sdk/index.mjs: page/api/run/close)
    const createContractSdk = () => {
      class ContractResponse {
        constructor(body, { contentType = 'text/plain', status = 200, headers } = {}) {
          this.body = body;
          this.contentType = contentType;
          this.status = status;
          this.headers = headers;
        }
      }
      class ContractSidecarApp {
        constructor() {
          this._pages = new Map();
          this._apis = new Map();
          this._server = null;
        }
        page(p, fn) { this._pages.set(p, fn); }
        api(p, fn, method = 'POST') {
          if (!this._apis.has(p)) this._apis.set(p, new Map());
          this._apis.get(p).set(method.toUpperCase(), fn);
        }
        run() {
          this._pages.set('/preload.js', () => '/* sidecar preload */');
          this.api('/_sidecar/echo', (data) => ({ echoed: data }), 'POST');
          const srv = http.createServer(async (req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (req.method === 'GET' && this._pages.has(url.pathname)) {
              const c = await this._pages.get(url.pathname)();
              const body = c instanceof ContractResponse ? c.body : c;
              res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'application/javascript' : 'text/html' });
              res.end(body);
              return;
            }
            if (this._apis.has(url.pathname) && this._apis.get(url.pathname).has(req.method)) {
              let raw = '';
              req.on('data', (ch) => { raw += ch; });
              req.on('end', async () => {
                const payload = raw ? JSON.parse(raw) : {};
                const result = await this._apis.get(url.pathname).get(req.method)(payload);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
              });
              return;
            }
            res.writeHead(404);
            res.end('Not found');
          });
          this._server = srv;
          return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
        }
        close() {
          return new Promise((resolve) => (this._server ? this._server.close(() => resolve()) : resolve()));
        }
      }
      return { SidecarApp: ContractSidecarApp, Response: ContractResponse };
    };

    const verifySdkServer = async (sdkObj, label) => {
      const uiToken = 'sidecar-ui-secret-token-0123456789abcdef';
      const { app, server: sdkSrv } = await startSidecarWithSdk(sdkObj, handle, { sidecarToken: uiToken });
      try {
        // Single gate dispatcher invariant: exactly 1 request listener on the http.Server
        assert.equal(sdkSrv.rawListeners('request').length, 1, `${label}: single gate dispatcher must own request event`);
        const { port } = sdkSrv.address();
        const loopbackHost = `127.0.0.1:${port}`;
        const loopbackOrigin = `http://127.0.0.1:${port}`;

        // GET / and GET /preload.js succeed with loopback Host
        const idxRes = await httpReq(port, { reqPath: '/index.html', headers: { host: loopbackHost } });
        assert.equal(idxRes.statusCode, 200, `${label}: GET /index.html`);
        assert.match(idxRes.body, /ko-csrf-token/);

        const preloadRes = await httpReq(port, { reqPath: '/preload.js', headers: { host: loopbackHost } });
        assert.equal(preloadRes.statusCode, 200, `${label}: GET /preload.js must pass through`);

        // DNS rebinding Host rejected before SidecarApp runs
        const rebindRes = await httpReq(port, { reqPath: '/api/settings', headers: { host: 'rebind.evil.com' } });
        assert.equal(rebindRes.statusCode, 403, `${label}: rebinding host rejected`);

        // Query ?token= bypass without x-sidecar-token header MUST be rejected (401)
        const queryBypass = await httpReq(port, {
          method: 'POST',
          reqPath: `/api/settings?token=${encodeURIComponent(uiToken)}`,
          headers: {
            host: loopbackHost,
            origin: loopbackOrigin,
            'content-type': 'application/json',
            'x-ko-csrf-token': handle.csrfToken,
          },
          body: JSON.stringify({ provider: 'google-translate' }),
        });
        assert.equal(queryBypass.statusCode, 401, `${label}: query ?token= bypass must fail closed`);

        // Cross-site Sec-Fetch-Site rejected (403)
        const crossSite = await httpReq(port, {
          method: 'POST',
          reqPath: '/api/settings',
          headers: {
            host: loopbackHost,
            origin: loopbackOrigin,
            'sec-fetch-site': 'cross-site',
            'content-type': 'application/json',
            'x-sidecar-token': uiToken,
            'x-ko-csrf-token': handle.csrfToken,
          },
          body: JSON.stringify({ provider: 'google-translate' }),
        });
        assert.equal(crossSite.statusCode, 403, `${label}: cross-site Sec-Fetch-Site rejected`);

        // Prototype pollution payload blocked on /api/settings AND /_sidecar/* (400)
        const protoPayload = '{"__proto__":{"polluted":true},"provider":"google-translate"}';
        const protoSettings = await httpReq(port, {
          method: 'POST',
          reqPath: '/api/settings',
          headers: {
            host: loopbackHost,
            origin: loopbackOrigin,
            'content-type': 'application/json',
            'x-sidecar-token': uiToken,
            'x-ko-csrf-token': handle.csrfToken,
          },
          body: protoPayload,
        });
        assert.equal(protoSettings.statusCode, 400, `${label}: __proto__ payload blocked on /api/settings`);

        const protoSidecar = await httpReq(port, {
          method: 'POST',
          reqPath: '/_sidecar/echo',
          headers: {
            host: loopbackHost,
            origin: loopbackOrigin,
            'content-type': 'application/json',
            'x-sidecar-token': uiToken,
          },
          body: protoPayload,
        });
        assert.equal(protoSidecar.statusCode, 400, `${label}: __proto__ payload blocked on /_sidecar/*`);
        assert.equal(({}).polluted, undefined);

        // Oversized body > 64 KiB rejected cleanly with 413 PAYLOAD_TOO_LARGE (no ERR_HTTP_HEADERS_SENT)
        const oversizedSdk = await httpReq(port, {
          method: 'POST',
          reqPath: '/api/settings',
          headers: {
            host: loopbackHost,
            origin: loopbackOrigin,
            'content-type': 'application/json',
            'x-sidecar-token': uiToken,
            'x-ko-csrf-token': handle.csrfToken,
            connection: 'close',
          },
          body: 'x'.repeat(MAX_BODY_BYTES + 1024),
        });
        assert.equal(oversizedSdk.statusCode, 413, `${label}: >64KiB body returns 413`);
        assert.equal(oversizedSdk.headers['x-content-type-options'], 'nosniff');

        // Valid POST /api/settings with both x-sidecar-token and x-ko-csrf-token succeeds (200)
        const okPost = await httpReq(port, {
          method: 'POST',
          reqPath: '/api/settings',
          headers: {
            host: loopbackHost,
            origin: loopbackOrigin,
            'content-type': 'application/json',
            'x-sidecar-token': uiToken,
            'x-ko-csrf-token': handle.csrfToken,
          },
          body: JSON.stringify({ provider: 'google-translate', translateThinking: true }),
        });
        assert.equal(okPost.statusCode, 200, `${label}: valid POST /api/settings succeeds`);
        assert.equal(JSON.parse(okPost.body).settings.provider, 'google-translate');
      } finally {
        if (typeof sdkSrv.closeAllConnections === 'function') sdkSrv.closeAllConnections();
        await app.close();
      }
    };

    // Always verify contract-accurate SidecarApp mirror (runs on all CI environments)
    await verifySdkServer(createContractSdk(), 'contract-sdk');

    // Also verify against the real installed Antigravity sidecar_sdk when present on this machine
    const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();
    const realSdkPath = path.join(homeDir, '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs');
    if (fs.existsSync(realSdkPath)) {
      const prevEnv = {
        ANTIGRAVITY_LS_ADDRESS: process.env.ANTIGRAVITY_LS_ADDRESS,
        ANTIGRAVITY_CSRF_TOKEN: process.env.ANTIGRAVITY_CSRF_TOKEN,
        ANTIGRAVITY_SIDECAR_WEB_PORT: process.env.ANTIGRAVITY_SIDECAR_WEB_PORT,
        ANTIGRAVITY_SIDECAR_UI_TOKEN: process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN,
      };
      process.env.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:49999';
      process.env.ANTIGRAVITY_CSRF_TOKEN = 'test-ls-csrf';
      process.env.ANTIGRAVITY_SIDECAR_WEB_PORT = '0';
      process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN = 'sidecar-ui-secret-token-0123456789abcdef';
      try {
        const realSdk = await import(pathToFileURL(realSdkPath).href);
        await verifySdkServer(realSdk, 'real-installed-sidecar_sdk');
      } finally {
        for (const [k, v] of Object.entries(prevEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
