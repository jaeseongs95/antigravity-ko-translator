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
const { ANTIGRAVITY_HOST_PROFILE } = require(path.join(REPO_ROOT, 'host', 'profiles', 'antigravity.js'));
const {
  readTranslatorSettings,
  saveTranslatorSettings,
  isPluginEnabled,
} = require(path.join(REPO_ROOT, 'host', 'config-store.js'));
const {
  isAddonHostLoaderPresent,
  readRegisteredManifest,
  validateAddonManifestContract,
} = require(path.join(REPO_ROOT, 'host', 'addon-registry.js'));

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
  const activeProfile = (options && options.hostProfile) || ANTIGRAVITY_HOST_PROFILE;
  const paths = {
    ...resolveHostPaths(process.env, activeProfile),
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
    let settings = null;
    let settingsCorrupted = false;
    let settingsError = null;
    try {
      settings = readTranslatorSettings(paths, { strict: true });
    } catch (err) {
      settingsCorrupted = true;
      settingsError = err && err.message ? err.message : 'SETTINGS_FILE_CORRUPTED';
    }
    const pluginEnabled = isPluginEnabled(paths.CONFIG_JSON_PATH, activeProfile.pluginId);
    const manifest = readRegisteredManifest(paths.MANIFEST_PATH);
    const manifestValidation = manifest
      ? validateAddonManifestContract(manifest, paths.PLUGINS_ROOT_DIR, {
          expectedHostProfileId: activeProfile.id,
          checkFilesExist: true,
        })
      : { ok: false, reason: 'MANIFEST_NOT_FOUND' };
    const addonHostInstalled = isAddonHostLoaderPresent(paths.LOADER_SCRIPT_PATH);
    return {
      ok: true,
      version: '2.1.0',
      csrfToken,
      settings,
      settingsCorrupted,
      settingsError,
      diagnostics: {
        pluginEnabled,
        manifestRegistered: Boolean(manifestValidation.ok),
        addonHostInstalled,
        asarLoaderInstalled: addonHostInstalled,
        settingsPath: paths.SETTINGS_PATH,
      },
    };
  }

  function validateLoopbackRequest(headers, { requireHost = false } = {}) {
    const host = String(headers.host || '').trim();
    if (requireHost && !host) {
      return jsonResponse(403, { ok: false, error: 'MISSING_HOST' });
    }
    if (host && !LOOPBACK_HOST_RE.test(host)) {
      return jsonResponse(403, { ok: false, error: 'FORBIDDEN_HOST' });
    }
    const origin = String(headers.origin || '').trim();
    if (origin && !LOOPBACK_ORIGIN_RE.test(origin)) {
      return jsonResponse(403, { ok: false, error: 'FORBIDDEN_ORIGIN' });
    }
    return null;
  }

  function validateMutationSecurity(headers, { requireHost = false } = {}) {
    const baseErr = validateLoopbackRequest(headers, { requireHost });
    if (baseErr) return baseErr;
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

  const handler = function handleRequest({
    method = 'GET',
    urlPath = '/',
    rawBody = '',
    headers = {},
    requireHost = false,
  } = {}) {
    const cleanPath = String(urlPath || '/').split('?')[0];
    const normHeaders = normalizeHeaders(headers);

    if (method === 'GET' && (cleanPath === '/' || cleanPath === '/index.html')) {
      const hostErr = validateLoopbackRequest(normHeaders, { requireHost });
      if (hostErr) return hostErr;
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
      const hostErr = validateLoopbackRequest(normHeaders, { requireHost });
      if (hostErr) return hostErr;
      return jsonResponse(200, buildStatusPayload());
    }

    if (method === 'POST' && cleanPath === '/api/settings') {
      const secErr = validateMutationSecurity(normHeaders, { requireHost });
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
        chunks.length = 0;
        const body = JSON.stringify({ ok: false, error: 'PAYLOAD_TOO_LARGE' });
        res.writeHead(413, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'connection': 'close',
        });
        res.end(body, () => {
          try {
            req.destroy();
          } catch (_err) {}
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
        requireHost: true,
      });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  });
}

export function createSidecarAppRoutes(sdk, handleRequest) {
  const app = new sdk.SidecarApp();
  const readBoundedRawBody = async (req) => {
    const contentLen = Number(normalizeHeaders(req?.headers)['content-length'] || 0);
    if (Number.isFinite(contentLen) && contentLen > MAX_BODY_BYTES) {
      return { tooLarge: true, rawBody: '' };
    }
    // Stream incremental byte counting when req.body is a ReadableStream / AsyncIterable (blocks chunked DoS).
    if (req?.body && typeof req.body.getReader === 'function') {
      const reader = req.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
          total += buf.length;
          if (total > MAX_BODY_BYTES) {
            try { await reader.cancel(); } catch (_err) {}
            return { tooLarge: true, rawBody: '' };
          }
          chunks.push(buf);
        }
      } finally {
        try { reader.releaseLock(); } catch (_err) {}
      }
      return { tooLarge: false, rawBody: Buffer.concat(chunks).toString('utf8') };
    }
    if (req?.body && typeof req.body[Symbol.asyncIterator] === 'function') {
      const chunks = [];
      let total = 0;
      for await (const chunk of req.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_BODY_BYTES) {
          return { tooLarge: true, rawBody: '' };
        }
        chunks.push(buf);
      }
      return { tooLarge: false, rawBody: Buffer.concat(chunks).toString('utf8') };
    }
    let rawBody = '';
    if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      rawBody = JSON.stringify(req.body);
    } else if (typeof req?.body === 'string' || Buffer.isBuffer(req?.body)) {
      rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    } else if (typeof req?.text === 'function') {
      // Only use req.text() when content-length was explicitly declared within MAX_BODY_BYTES (prevents unbounded buffering).
      const rawCl = normalizeHeaders(req?.headers)['content-length'];
      if (rawCl !== undefined && (!Number.isFinite(Number(rawCl)) || Number(rawCl) > MAX_BODY_BYTES)) {
        return { tooLarge: true, rawBody: '' };
      }
      rawBody = await req.text();
    } else {
      rawBody = '';
    }
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return { tooLarge: true, rawBody: '' };
    }
    return { tooLarge: false, rawBody };
  };

  const serveHtml = (req) => {
    const res = handleRequest({
      method: 'GET',
      urlPath: '/',
      headers: req?.headers,
      requireHost: true,
    });
    return new sdk.Response(res.body, { status: res.status, headers: res.headers });
  };
  app.route('GET', '/', serveHtml);
  app.route('GET', '/index.html', serveHtml);
  app.route('GET', '/api/settings', (req) => {
    const res = handleRequest({
      method: 'GET',
      urlPath: '/api/settings',
      headers: req?.headers,
      requireHost: true,
    });
    return new sdk.Response(res.body, { status: res.status, headers: res.headers });
  });
  app.route('POST', '/api/settings', async (req) => {
    const { tooLarge, rawBody } = await readBoundedRawBody(req);
    if (tooLarge) {
      return new sdk.Response(JSON.stringify({ ok: false, error: 'PAYLOAD_TOO_LARGE' }), {
        status: 413,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    const res = handleRequest({
      method: 'POST',
      urlPath: '/api/settings',
      rawBody,
      headers: req?.headers,
      requireHost: true,
    });
    return new sdk.Response(res.body, { status: res.status, headers: res.headers });
  });
  return app;
}

async function startSidecar() {
  const handleRequest = createSettingsRequestHandler();

  let sdk = null;
  try {
    sdk = await import('sidecar_sdk');
  } catch (err) {
    const isMissingSdk = err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND');
    if (!isMissingSdk) {
      process.stderr.write(`[ko-translator-settings] sidecar_sdk import failed: ${err?.message || String(err)}\n`);
      throw err;
    }
  }

  if (sdk && typeof sdk.SidecarApp === 'function' && typeof sdk.Response === 'function') {
    const app = createSidecarAppRoutes(sdk, handleRequest);
    await app.start();
    return;
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
