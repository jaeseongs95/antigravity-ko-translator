/**
 * Official Antigravity UI Sidecar Backend (AUX_PANE) for ko-thought-translator.
 *
 * Manages ONLY `~/.gemini/antigravity/ko_translator_settings.json` (read/write via fail-closed lock)
 * and reads plugin/loader status read-only. NEVER touches Antigravity host internal storage or `config.json`.
 *
 * Security controls on POST /api/settings:
 * - Loopback Host & Origin validation (blocks cross-site web CSRF & DNS rebinding)
 * - Strict `application/json` Content-Type check (415)
 * - Per-instance cryptographic CSRF token (`x-ko-csrf-token`, timingSafeEqual)
 * - Strict 64 KiB body cap returning HTTP 413 Payload Too Large (zero silent truncation)
 */

import crypto from 'node:crypto';
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
export const MAX_BODY_BYTES = 64 * 1024;
const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

function normalizeHeaders(rawHeaders) {
  const out = {};
  if (!rawHeaders) return out;
  if (typeof rawHeaders.forEach === 'function') {
    rawHeaders.forEach((v, k) => {
      out[String(k).toLowerCase()] = String(v);
    });
    return out;
  }
  if (typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (v !== undefined && v !== null) {
        out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }
  }
  return out;
}

function timingSafeMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string' || !expected || !actual) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSettingsRequestHandler(pathOverrides = null, options = null) {
  const paths = {
    ...resolveHostPaths(process.env),
    ...(pathOverrides || {}),
  };
  const csrfToken =
    options && typeof options.csrfToken === 'string' && options.csrfToken.length >= 16
      ? options.csrfToken
      : crypto.randomBytes(24).toString('hex');

  function jsonResponse(status, body) {
    return {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
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
      csrfToken,
      settings,
      diagnostics: {
        pluginEnabled,
        manifestRegistered: Boolean(manifest),
        asarLoaderInstalled,
        settingsPath: paths.SETTINGS_PATH,
      },
    };
  }

  function validateMutationSecurity(headers) {
    const host = headers.host || '';
    if (host && !LOOPBACK_HOST_RE.test(host.trim())) {
      return jsonResponse(403, { ok: false, error: 'FORBIDDEN_HOST' });
    }
    const origin = headers.origin || '';
    if (origin && !LOOPBACK_ORIGIN_RE.test(origin.trim())) {
      return jsonResponse(403, { ok: false, error: 'FORBIDDEN_ORIGIN' });
    }
    const contentType = String(headers['content-type'] || '').toLowerCase().trim();
    if (!contentType.startsWith('application/json')) {
      return jsonResponse(415, { ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    const providedToken = String(headers['x-ko-csrf-token'] || '').trim();
    if (!timingSafeMatch(csrfToken, providedToken)) {
      return jsonResponse(403, { ok: false, error: 'INVALID_CSRF_TOKEN' });
    }
    return null;
  }

  const handler = function handleRequest({ method = 'GET', urlPath = '/', rawBody = '', headers = {} } = {}) {
    const cleanPath = String(urlPath || '/').split('?')[0];
    const normHeaders = normalizeHeaders(headers);

    if (method === 'GET' && (cleanPath === '/' || cleanPath === '/index.html')) {
      const html = fs
        .readFileSync(INDEX_HTML_PATH, 'utf8')
        .replace('__KO_CSRF_TOKEN__', csrfToken);
      return {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
        body: html,
      };
    }

    if (method === 'GET' && cleanPath === '/api/settings') {
      return jsonResponse(200, buildStatusPayload());
    }

    if (method === 'POST' && cleanPath === '/api/settings') {
      const secErr = validateMutationSecurity(normHeaders);
      if (secErr) return secErr;

      if (Buffer.byteLength(String(rawBody || ''), 'utf8') > MAX_BODY_BYTES) {
        return jsonResponse(413, { ok: false, error: 'PAYLOAD_TOO_LARGE' });
      }

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
          csrfToken,
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

  handler.csrfToken = csrfToken;
  return handler;
}

export function createStandaloneHttpServer(handleRequest) {
  return http.createServer((req, res) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        const body = JSON.stringify({ ok: false, error: 'PAYLOAD_TOO_LARGE' });
        res.writeHead(413, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'connection': 'close',
        });
        res.end(body, () => {
          try { req.destroy(); } catch (_err) {}
        });
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge || res.writableEnded) return;
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const out = handleRequest({
        method: req.method,
        urlPath: req.url,
        rawBody,
        headers: req.headers,
      });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  });
}

async function startSidecar() {
  const handleRequest = createSettingsRequestHandler();

  try {
    const sdk = await import('sidecar_sdk');
    if (sdk && typeof sdk.SidecarApp === 'function' && typeof sdk.Response === 'function') {
      const app = new sdk.SidecarApp();
      app.route('GET', '/', (req) => {
        const res = handleRequest({ method: 'GET', urlPath: '/', headers: req?.headers });
        return new sdk.Response(res.body, { status: res.status, headers: res.headers });
      });
      app.route('GET', '/api/settings', (req) => {
        const res = handleRequest({ method: 'GET', urlPath: '/api/settings', headers: req?.headers });
        return new sdk.Response(res.body, { status: res.status, headers: res.headers });
      });
      app.route('POST', '/api/settings', async (req) => {
        const rawBody = typeof req?.text === 'function' ? await req.text() : String(req?.body || '');
        const res = handleRequest({
          method: 'POST',
          urlPath: '/api/settings',
          rawBody,
          headers: req?.headers,
        });
        return new sdk.Response(res.body, { status: res.status, headers: res.headers });
      });
      await app.start();
      return;
    }
  } catch (_err) {
    // Standalone HTTP fallback when launched directly outside Antigravity sidecar_sdk runtime
  }

  const port = Number(process.env.KO_TRANSLATOR_SIDECAR_PORT || 0);
  const server = createStandaloneHttpServer(handleRequest);
  server.listen(port, '127.0.0.1');
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
  void startSidecar();
}
