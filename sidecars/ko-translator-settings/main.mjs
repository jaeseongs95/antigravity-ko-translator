/**
 * Official Antigravity UI Sidecar Backend (AUX_PANE) for ko-thought-translator.
 *
 * Manages ONLY `~/.gemini/antigravity/ko_translator_settings.json` (read/write via fail-closed lock)
 * and reads plugin/loader status read-only. NEVER touches Antigravity host internal storage or `config.json`.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const { resolveHostPaths } = require(path.join(REPO_ROOT, 'host', 'paths.js'));
const {
  readTranslatorSettings,
  saveTranslatorSettings,
  isPluginEnabled,
} = require(path.join(REPO_ROOT, 'host', 'config-store.js'));
const { isAsarLoaderInstalled, readDropinManifest } = require(path.join(REPO_ROOT, 'host', 'dropin-loader.js'));

const INDEX_HTML_PATH = path.join(__dirname, 'index.html');

export function createSettingsRequestHandler(pathOverrides = null) {
  const paths = {
    ...resolveHostPaths(process.env),
    ...(pathOverrides || {}),
  };

  function jsonResponse(status, body) {
    return {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: JSON.stringify(body),
    };
  }

  function buildStatusPayload() {
    const settings = readTranslatorSettings(paths);
    const pluginEnabled = isPluginEnabled(paths.CONFIG_JSON_PATH);
    const manifest = readDropinManifest(paths.MANIFEST_PATH);
    const asarLoaderInstalled = isAsarLoaderInstalled(paths.ASAR_PATH);
    return {
      ok: true,
      version: '2.0.0',
      settings,
      diagnostics: {
        pluginEnabled,
        manifestRegistered: Boolean(manifest),
        asarLoaderInstalled,
        settingsPath: paths.SETTINGS_PATH,
      },
    };
  }

  return function handleRequest({ method = 'GET', urlPath = '/', rawBody = '' } = {}) {
    const cleanPath = String(urlPath || '/').split('?')[0];

    if (method === 'GET' && (cleanPath === '/' || cleanPath === '/index.html')) {
      const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
      return {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
        body: html,
      };
    }

    if (method === 'GET' && cleanPath === '/api/settings') {
      return jsonResponse(200, buildStatusPayload());
    }

    if (method === 'POST' && cleanPath === '/api/settings') {
      let parsed;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : {};
      } catch (_err) {
        return jsonResponse(400, { ok: false, error: 'INVALID_JSON' });
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return jsonResponse(400, { ok: false, error: 'INVALID_PAYLOAD' });
      }
      try {
        const updated = saveTranslatorSettings(parsed, paths);
        return jsonResponse(200, {
          ok: true,
          settings: updated,
          diagnostics: buildStatusPayload().diagnostics,
        });
      } catch (err) {
        return jsonResponse(400, {
          ok: false,
          error: err && err.message ? err.message : 'SETTINGS_SAVE_FAILED',
        });
      }
    }

    return jsonResponse(404, { ok: false, error: 'NOT_FOUND' });
  };
}

async function startSidecar() {
  const handleRequest = createSettingsRequestHandler();

  try {
    const sdk = await import('sidecar_sdk');
    if (sdk && typeof sdk.SidecarApp === 'function' && typeof sdk.Response === 'function') {
      const app = new sdk.SidecarApp();
      app.route('GET', '/', () => {
        const res = handleRequest({ method: 'GET', urlPath: '/' });
        return new sdk.Response(res.body, { status: res.status, headers: res.headers });
      });
      app.route('GET', '/api/settings', () => {
        const res = handleRequest({ method: 'GET', urlPath: '/api/settings' });
        return new sdk.Response(res.body, { status: res.status, headers: res.headers });
      });
      app.route('POST', '/api/settings', async (req) => {
        const rawBody = typeof req?.text === 'function' ? await req.text() : String(req?.body || '');
        const res = handleRequest({ method: 'POST', urlPath: '/api/settings', rawBody });
        return new sdk.Response(res.body, { status: res.status, headers: res.headers });
      });
      await app.start();
      return;
    }
  } catch (_err) {
    // Standalone HTTP fallback when launched directly outside Antigravity sidecar_sdk runtime
  }

  const port = Number(process.env.KO_TRANSLATOR_SIDECAR_PORT || 0);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => {
      if (chunks.length < 32) chunks.push(c);
    });
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const out = handleRequest({ method: req.method, urlPath: req.url, rawBody });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  });
  server.listen(port, '127.0.0.1');
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
  void startSidecar();
}
