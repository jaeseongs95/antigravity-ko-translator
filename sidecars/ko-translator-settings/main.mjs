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
import { Readable } from 'node:stream';
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
const DANGEROUS_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
});

function hasDangerousProtoKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousProtoKey(item));
  }
  for (const key of Object.keys(value)) {
    if (DANGEROUS_PROTO_KEYS.has(key)) return true;
    if (hasDangerousProtoKey(value[key])) return true;
  }
  return false;
}

function parseJsonSafe(rawText) {
  let dangerous = false;
  const parsed = JSON.parse(rawText, (key, value) => {
    if (DANGEROUS_PROTO_KEYS.has(key)) {
      dangerous = true;
    }
    return value;
  });
  if (dangerous || hasDangerousProtoKey(parsed)) {
    const err = new Error('DANGEROUS_JSON_KEY');
    err.code = 'DANGEROUS_JSON_KEY';
    throw err;
  }
  return parsed;
}

function isOriginMatchingHost(originHeader, hostHeader) {
  if (!originHeader || !hostHeader) return false;
  if (!LOOPBACK_ORIGIN_RE.test(originHeader) || !LOOPBACK_HOST_RE.test(hostHeader)) return false;
  try {
    const parsedOrigin = new URL(originHeader);
    const parsedHost = new URL(`http://${hostHeader}`);
    return parsedOrigin.host.toLowerCase() === parsedHost.host.toLowerCase();
  } catch (_err) {
    return false;
  }
}

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
      version: '2.1.1',
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
    if (origin) {
      const originAllowed = host ? isOriginMatchingHost(origin, host) : LOOPBACK_ORIGIN_RE.test(origin);
      if (!originAllowed) {
        return jsonResponse(403, { ok: false, error: 'FORBIDDEN_ORIGIN' });
      }
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
      const cspNonce = crypto.randomBytes(16).toString('base64');
      const html = fs
        .readFileSync(INDEX_HTML_PATH, 'utf8')
        .replace('__KO_CSRF_TOKEN__', csrfToken)
        .replaceAll('__KO_CSP_NONCE__', cspNonce);
      return {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            `default-src 'self'; script-src 'nonce-${cspNonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self' http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*`,
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
        parsed = rawBody ? parseJsonSafe(rawBody) : {};
      } catch (err) {
        if (err && err.code === 'DANGEROUS_JSON_KEY') {
          return jsonResponse(400, { ok: false, error: 'INVALID_PAYLOAD' });
        }
        return jsonResponse(400, { ok: false, error: 'INVALID_JSON' });
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return jsonResponse(400, { ok: false, error: 'INVALID_PAYLOAD' });
      }
      try {
        const allowCorruptedRecovery = parsed.resetCorrupted === true;
        const updated = saveTranslatorSettings(parsed, paths, { allowCorruptedRecovery });
        return jsonResponse(200, {
          ok: true,
          csrfToken,
          settings: updated,
          settingsCorrupted: false,
          settingsError: null,
          diagnostics: buildStatusPayload().diagnostics,
        });
      } catch (err) {
        const msg = err && err.message ? err.message : 'SETTINGS_SAVE_FAILED';
        const statusCode = msg === 'SETTINGS_LOCK_BUSY' ? 409 : 400;
        return jsonResponse(statusCode, {
          ok: false,
          error: msg,
        });
      }
    }

    return jsonResponse(404, { ok: false, error: 'NOT_FOUND' });
  };

  handler.csrfToken = csrfToken;
  return handler;
}

export function createStandaloneHttpServer(handleRequest, options = {}) {
  const server = http.createServer((_req, res) => {
    writeJsonError(res, 404, 'NOT_FOUND');
  });
  return attachSidecarSecurityGate(server, handleRequest, options);
}

function writeJsonError(res, status, error, { closeConnection = false, onFlushed = null } = {}) {
  if (res.writableEnded || res.headersSent) return;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS,
    ...(closeConnection ? { connection: 'close' } : {}),
  };
  res.writeHead(status, headers);
  if (typeof onFlushed === 'function') {
    res.end(JSON.stringify({ ok: false, error }), onFlushed);
  } else {
    res.end(JSON.stringify({ ok: false, error }));
  }
}

function readBoundedHttpBody(req, res, onComplete) {
  const rawCl = normalizeHeaders(req.headers)['content-length'];
  if (rawCl !== undefined) {
    const declared = Number(rawCl);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
      writeJsonError(res, 413, 'PAYLOAD_TOO_LARGE', { closeConnection: true });
      // Drain incoming bytes without buffering so Windows Winsock closes with FIN instead of RST.
      req.resume();
      return;
    }
  }

  const chunks = [];
  let totalBytes = 0;
  let tooLarge = false;

  req.on('data', (chunk) => {
    if (tooLarge) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      writeJsonError(res, 413, 'PAYLOAD_TOO_LARGE', { closeConnection: true });
      req.resume();
      return;
    }
    chunks.push(buf);
  });

  req.on('end', () => {
    if (tooLarge || res.writableEnded) return;
    onComplete(Buffer.concat(chunks));
  });
}

function createReplayRequest(req, bodyBuf) {
  const replay = Readable.from(bodyBuf.length > 0 ? [bodyBuf] : []);
  replay.method = req.method;
  replay.url = req.url;
  replay.headers = req.headers;
  replay.rawHeaders = req.rawHeaders;
  replay.httpVersion = req.httpVersion;
  replay.socket = req.socket;
  return replay;
}

function isManagedSettingsRoute(method, cleanPath) {
  if (method === 'GET' && (cleanPath === '/' || cleanPath === '/index.html' || cleanPath === '/api/settings')) {
    return true;
  }
  if (method === 'POST' && cleanPath === '/api/settings') {
    return true;
  }
  return false;
}

/**
 * Wraps the `http.Server` returned by `SidecarApp.run()` by extracting `rawListeners('request')`,
 * removing all unhardened listeners, and installing a single gate dispatcher that enforces:
 * - Loopback Host (mandatory) and Origin / Sec-Fetch-Site checks before any downstream code runs
 * - Header-only constant-time `x-sidecar-token` verification (blocks `?token=` query bypass)
 * - Strict 64 KiB body cap (413) and prototype-safe JSON validation on all mutation routes
 * - Direct dispatch of `/`, `/index.html`, `/api/settings` to `handleRequest` with full `req.headers`
 */
export function attachSidecarSecurityGate(
  server,
  handleRequest,
  { sidecarToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '' } = {}
) {
  const expectedSidecarToken = typeof sidecarToken === 'string' ? sidecarToken.trim() : '';
  const downstreamListeners = server.rawListeners('request');
  server.removeAllListeners('request');

  if (typeof server.on === 'function' && server.listenerCount('error') === 0) {
    server.on('error', (err) => {
      process.stderr.write(`[ko-translator-settings] server error: ${err && err.message ? err.message : String(err)}\n`);
    });
  }

  server.on('request', (req, res) => {
    req.on('error', () => {
      try {
        if (!res.writableEnded) res.destroy();
      } catch (_err) {}
    });
    res.on('error', () => {});

    const normHeaders = normalizeHeaders(req.headers);
    const host = String(normHeaders.host || '').trim();
    if (!host) {
      writeJsonError(res, 403, 'MISSING_HOST');
      return;
    }
    if (!LOOPBACK_HOST_RE.test(host)) {
      writeJsonError(res, 403, 'FORBIDDEN_HOST');
      return;
    }

    const origin = String(normHeaders.origin || '').trim();
    if (origin && !isOriginMatchingHost(origin, host)) {
      writeJsonError(res, 403, 'FORBIDDEN_ORIGIN');
      return;
    }

    const method = String(req.method || 'GET').toUpperCase();
    const isReadMethod = method === 'GET' || method === 'HEAD';
    const rawUrl = String(req.url || '/');
    const cleanPath = rawUrl.split('?')[0];

    // I5: Enforce ANTIGRAVITY_SIDECAR_UI_TOKEN across both mutations and managed read endpoints
    if (expectedSidecarToken) {
      const providedHeaderToken = String(normHeaders['x-sidecar-token'] || '').trim();
      if (!isReadMethod) {
        const fetchSite = String(normHeaders['sec-fetch-site'] || '').toLowerCase().trim();
        if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
          writeJsonError(res, 403, 'FORBIDDEN_CROSS_SITE');
          return;
        }
        // Mutations MUST present header-only x-sidecar-token (query ?token= bypass is forbidden)
        if (!timingSafeMatch(expectedSidecarToken, providedHeaderToken)) {
          writeJsonError(res, 401, 'UNAUTHORIZED');
          return;
        }
      } else if (cleanPath === '/api/settings') {
        // Read API requires header-only x-sidecar-token (prevents unauthenticated local snooping & ?token= leakage)
        if (!timingSafeMatch(expectedSidecarToken, providedHeaderToken)) {
          writeJsonError(res, 401, 'UNAUTHORIZED');
          return;
        }
      } else if (cleanPath === '/' || cleanPath === '/index.html') {
        // Initial webview page load accepts either x-sidecar-token header OR sidecar_sdk's ?token= query
        let queryToken = '';
        try {
          queryToken = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('token') || '';
        } catch (_err) {}
        if (
          !timingSafeMatch(expectedSidecarToken, providedHeaderToken) &&
          !timingSafeMatch(expectedSidecarToken, queryToken)
        ) {
          writeJsonError(res, 401, 'UNAUTHORIZED');
          return;
        }
      }
    } else if (!isReadMethod) {
      const fetchSite = String(normHeaders['sec-fetch-site'] || '').toLowerCase().trim();
      if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        writeJsonError(res, 403, 'FORBIDDEN_CROSS_SITE');
        return;
      }
    }

    if (isManagedSettingsRoute(method, cleanPath)) {
      readBoundedHttpBody(req, res, (bodyBuf) => {
        try {
          const out = handleRequest({
            method,
            urlPath: req.url,
            rawBody: bodyBuf.toString('utf8'),
            headers: req.headers,
            requireHost: true,
          });
          if (!res.writableEnded && !res.headersSent) {
            res.writeHead(out.status, out.headers);
            res.end(out.body);
          }
        } catch (_err) {
          writeJsonError(res, 500, 'INTERNAL_ERROR');
        }
      });
      return;
    }

    if (isReadMethod) {
      for (const listener of downstreamListeners) {
        listener.call(server, req, res);
      }
      return;
    }

    readBoundedHttpBody(req, res, (bodyBuf) => {
      if (bodyBuf.length > 0) {
        try {
          parseJsonSafe(bodyBuf.toString('utf8'));
        } catch (err) {
          if (err && err.code === 'DANGEROUS_JSON_KEY') {
            writeJsonError(res, 400, 'INVALID_PAYLOAD');
            return;
          }
          writeJsonError(res, 400, 'INVALID_JSON');
          return;
        }
      }
      const replayReq = createReplayRequest(req, bodyBuf);
      for (const listener of downstreamListeners) {
        listener.call(server, replayReq, res);
      }
    });
  });

  return server;
}

function toSdkResponse(sdk, out) {
  const contentType =
    (out.headers && (out.headers['content-type'] || out.headers['Content-Type'])) || 'text/plain; charset=utf-8';
  return new sdk.Response(out.body, {
    contentType,
    status: out.status,
    headers: out.headers,
  });
}

export function createSidecarAppRoutes(sdk, handleRequest, { sidecarToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '' } = {}) {
  const app = new sdk.SidecarApp();
  if (typeof app.page !== 'function' || typeof app.api !== 'function' || typeof app.run !== 'function') {
    throw new Error('UNSUPPORTED_SIDECAR_SDK_CONTRACT');
  }
  const hasToken = typeof sidecarToken === 'string' && sidecarToken.trim().length > 0;

  // Register official routes on SidecarApp so SDK introspection and `/preload.js` + `/_sidecar/*` remain intact.
  // Live HTTP traffic to `/`, `/index.html`, and `/api/settings` is handled by `attachSidecarSecurityGate`
  // with full `req.headers`, strict 64 KiB caps, and prototype-safe JSON enforcement.
  const failClosedFallback = () =>
    toSdkResponse(sdk, {
      status: 403,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...SECURITY_HEADERS,
      },
      body: JSON.stringify({ ok: false, error: 'MISSING_SECURITY_GATE' }),
    });

  const servePage = () =>
    hasToken
      ? failClosedFallback()
      : toSdkResponse(
          sdk,
          handleRequest({
            method: 'GET',
            urlPath: '/',
            headers: {},
            requireHost: false,
          })
        );
  app.page('/', servePage);
  app.page('/index.html', servePage);
  app.api(
    '/api/settings',
    () =>
      hasToken
        ? failClosedFallback()
        : toSdkResponse(
            sdk,
            handleRequest({
              method: 'GET',
              urlPath: '/api/settings',
              headers: {},
              requireHost: false,
            })
          ),
    'GET'
  );
  app.api('/api/settings', failClosedFallback, 'POST');
  return app;
}

export async function startSidecarWithSdk(sdk, handleRequest, options = {}) {
  const app = createSidecarAppRoutes(sdk, handleRequest, options);
  const server = await app.run();
  attachSidecarSecurityGate(server, handleRequest, options);
  return { app, server };
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

  if (
    sdk &&
    typeof sdk.SidecarApp === 'function' &&
    typeof sdk.Response === 'function' &&
    typeof sdk.SidecarApp.prototype.run === 'function'
  ) {
    await startSidecarWithSdk(sdk, handleRequest);
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
