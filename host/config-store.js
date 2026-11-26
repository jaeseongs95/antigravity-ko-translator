'use strict';

/**
 * Isolated Settings Store for `~/.gemini/antigravity/ko_translator_settings.json`.
 *
 * - Fail-closed exclusive file lock on writes (never falls back to lockless overwrite).
 * - Atomic temp-file + rename persistence.
 * - Read-only `isPluginEnabled` check against `~/.gemini/config/config.json` (never writes to `config.json`).
 * - NEVER touches Antigravity host internal storage.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lockfile = require('proper-lockfile');

const { resolveHostPaths, PLUGIN_ID } = require('./paths');
const { DEFAULT_LLM_CONFIG, DEFAULT_CLOUD_API_CONFIG } = require('../src/adapters/translators/default-providers');
const { validateCloudApiConfig } = require('../src/adapters/translators/cloud-api');
const { validateTranslationEndpointUrl } = require('../src/adapters/translators/endpoint-validator');
const { validateCustomProviderSpec } = require('../src/adapters/translators/custom-provider');

const activeLockReleases = new Map();

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  translateThinking: true,
  showThinking: true,
  translateStaticUi: true,
  provider: 'google-translate',
  llmConfig: DEFAULT_LLM_CONFIG,
  cloudApiConfig: DEFAULT_CLOUD_API_CONFIG,
  customProviders: Object.freeze([]),
});

const TRANSIENT_FS_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_DELAYS_MS = Object.freeze([30, 60, 120, 240]);
const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function syncSleepMs(delayMs) {
  const ms = Math.max(0, Math.floor(Number(delayMs) || 0));
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_err) {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

function hasDangerousJsonKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasDangerousJsonKey(item));
  for (const key of Object.keys(value)) {
    if (DANGEROUS_JSON_KEYS.has(key)) return true;
    if (hasDangerousJsonKey(value[key])) return true;
  }
  return false;
}

function parseSafeJson(rawText) {
  let dangerous = false;
  const parsed = JSON.parse(rawText, (key, value) => {
    if (DANGEROUS_JSON_KEYS.has(key)) {
      dangerous = true;
    }
    return value;
  });
  if (dangerous || hasDangerousJsonKey(parsed)) {
    throw new Error('ERR_UNSAFE_JSON_PROTO_KEY');
  }
  return parsed;
}

function acquireExclusiveLock(lockPath, staleMs = 15000, { maxRetries = 4, retryDelayMs = 40 } = {}) {
  if (!lockPath) return null;
  const effectiveStaleMs = Math.max(Number(staleMs) || 15000, 2000);
  const attempts = Math.max(1, Number.isInteger(maxRetries) ? maxRetries + 1 : 5);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      // NB1: Guard against legacy regular-file locks colliding with proper-lockfile's directory lock (ENOTDIR/EEXIST).
      if (fs.existsSync(lockPath)) {
        const st = fs.lstatSync(lockPath);
        if (st.isFile()) {
          if (Date.now() - st.mtimeMs <= effectiveStaleMs) {
            if (attempt + 1 < attempts) {
              syncSleepMs(retryDelayMs * (attempt + 1));
              continue;
            }
            return null;
          }
          fs.unlinkSync(lockPath);
        }
      }
      const sentinelPath = `${lockPath}.target`;
      if (!fs.existsSync(sentinelPath)) {
        fs.writeFileSync(sentinelPath, '', { encoding: 'utf8', mode: 0o600 });
      }
      const release = lockfile.lockSync(sentinelPath, {
        lockfilePath: lockPath,
        stale: effectiveStaleMs,
        realpath: false,
      });
      const token = crypto.randomBytes(12).toString('hex');
      activeLockReleases.set(token, { lockPath, release });
      return token;
    } catch (_err) {
      if (attempt + 1 < attempts) {
        syncSleepMs(retryDelayMs * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

function releaseExclusiveLock(lockPath, token) {
  if (!token) return;
  const entry = activeLockReleases.get(token);
  if (!entry) return;
  if (lockPath && entry.lockPath !== lockPath) return;
  activeLockReleases.delete(token);
  try {
    entry.release();
  } catch (_err) {}
}

function writeFileAtomicSync(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    let lastRenameErr = null;
    for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        fs.renameSync(tmpPath, targetPath);
        lastRenameErr = null;
        break;
      } catch (err) {
        lastRenameErr = err;
        if (
          err &&
          typeof err.code === 'string' &&
          TRANSIENT_FS_ERROR_CODES.has(err.code) &&
          attempt < RENAME_RETRY_DELAYS_MS.length
        ) {
          syncSleepMs(RENAME_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw err;
      }
    }
    if (lastRenameErr) throw lastRenameErr;
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_err) {}
    }
  }
}

const FORBIDDEN_PROVIDER_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeProviderId(raw) {
  if (raw === undefined || raw === null || raw === '') return 'google-translate';
  if (typeof raw !== 'string') {
    throw new Error(`Invalid provider id type: ${typeof raw}`);
  }
  const s = raw.trim().toLowerCase();
  if (!s) return 'google-translate';
  if (FORBIDDEN_PROVIDER_IDS.has(s)) {
    throw new Error(`Forbidden provider id: ${raw}`);
  }
  if (s === 'google' || s === 'gtx' || s === 'google-translate') return 'google-translate';
  if (s === 'local' || s === 'llm' || s === 'ollama' || s === 'local-llm') return 'local-llm';
  if (
    s === 'cloud' ||
    s === 'api' ||
    s === 'openai' ||
    s === 'claude' ||
    s === 'anthropic' ||
    s === 'gemini' ||
    s === 'cloud-api'
  ) {
    return 'cloud-api';
  }
  if (/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(s)) return s;
  throw new Error(`Invalid provider id: ${raw}`);
}

function sanitizeLlmConfig(raw, existing = DEFAULT_LLM_CONFIG, { strict = false } = {}) {
  const base = { ...DEFAULT_LLM_CONFIG, ...(existing || {}) };
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    if (strict) throw new Error('INVALID_LLM_CONFIG');
    return base;
  }

  if (raw.allowRemoteHttps !== undefined && typeof raw.allowRemoteHttps !== 'boolean') {
    if (strict) throw new Error('INVALID_ALLOW_REMOTE_HTTPS');
  }
  const allowRemoteHttps =
    typeof raw.allowRemoteHttps === 'boolean' ? raw.allowRemoteHttps : Boolean(base.allowRemoteHttps);
  const rawUrl = raw.baseUrl !== undefined ? String(raw.baseUrl).trim() : base.baseUrl;
  if (SECRET_QUERY_RE.test(rawUrl)) {
    throw new Error('FORBIDDEN_SECRET_QUERY_IN_LLM_BASE_URL');
  }
  const parsedUrl = validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps });

  if (raw.model !== undefined && typeof raw.model !== 'string') {
    if (strict) throw new Error('INVALID_LLM_MODEL');
  }
  const model =
    typeof raw.model === 'string' && raw.model.trim()
      ? raw.model.trim().slice(0, 128)
      : base.model;

  let apiFormat = base.apiFormat === 'openai-compat' ? 'openai' : base.apiFormat;
  if (raw.apiFormat !== undefined) {
    if (typeof raw.apiFormat !== 'string') {
      if (strict) throw new Error('INVALID_API_FORMAT');
    } else {
      const rawFormat = raw.apiFormat.trim().toLowerCase();
      if (rawFormat === 'openai' || rawFormat === 'openai-compat') {
        apiFormat = 'openai';
      } else if (rawFormat === 'ollama') {
        apiFormat = 'ollama';
      } else if (strict) {
        throw new Error(`INVALID_API_FORMAT:${raw.apiFormat}`);
      }
    }
  }

  let timeoutMs = base.timeoutMs;
  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs >= 1000 && raw.timeoutMs <= 120000) {
      timeoutMs = Math.floor(raw.timeoutMs);
    } else if (strict) {
      throw new Error(`INVALID_TIMEOUT_MS:${raw.timeoutMs}`);
    }
  }

  return {
    baseUrl: parsedUrl.href.replace(/\/+$/, ''),
    model,
    apiFormat,
    allowRemoteHttps,
    timeoutMs,
  };
}

const SECRET_HEADER_RE =
  /^(?:authorization|proxy-authorization|x-api-key|api-key|x-goog-api-key|x-auth-token|x-access-token|x-secret|cookie)$/i;
const SECRET_QUERY_RE = /[?&](?:key|api_key|apikey|token|access_token|secret|auth)=/i;
const FORBIDDEN_CLOUD_SECRET_FIELDS = new Set(['apikey', 'api_key', 'secret', 'token', 'authorization', 'key']);

function sanitizeCloudApiConfig(raw, existing = DEFAULT_CLOUD_API_CONFIG, { strict = false } = {}) {
  const base = { ...DEFAULT_CLOUD_API_CONFIG, ...(existing || {}) };
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    if (strict) throw new Error('INVALID_CLOUD_API_CONFIG');
    return base;
  }
  for (const k of Object.keys(raw)) {
    if (FORBIDDEN_CLOUD_SECRET_FIELDS.has(String(k).toLowerCase())) {
      throw new Error(`FORBIDDEN_SECRET_FIELD_IN_CLOUD_API_CONFIG:${k}`);
    }
  }
  try {
    const validated = validateCloudApiConfig({ ...base, ...raw });
    return {
      preset: validated.preset,
      baseUrl: validated.baseUrl,
      model: validated.model,
      timeoutMs: validated.timeoutMs,
    };
  } catch (err) {
    if (strict) throw err;
    return base;
  }
}

function sanitizeCustomProviders(rawList, { strict = false } = {}) {
  if (!Array.isArray(rawList)) {
    if (strict) throw new Error('INVALID_CUSTOM_PROVIDERS_LIST');
    return [];
  }
  if (strict && rawList.length > 16) {
    throw new Error('TOO_MANY_CUSTOM_PROVIDERS');
  }
  const out = [];
  const seen = new Set();
  for (const item of rawList.slice(0, 16)) {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('INVALID_CUSTOM_PROVIDER_SPEC');
      }
      if (item.headers && typeof item.headers === 'object' && !Array.isArray(item.headers)) {
        for (const k of Object.keys(item.headers)) {
          if (SECRET_HEADER_RE.test(String(k || '').trim())) {
            throw new Error(`FORBIDDEN_SECRET_HEADER_IN_HOST_SETTINGS:${k}`);
          }
        }
      }
      const rawEndpoint = item.endpointUrl !== undefined ? item.endpointUrl : item.url;
      if (SECRET_QUERY_RE.test(String(rawEndpoint || ''))) {
        throw new Error('FORBIDDEN_SECRET_QUERY_IN_HOST_SETTINGS');
      }
      const normalizedInput = {
        ...item,
        endpointUrl: rawEndpoint,
        allowRemoteHttps: Boolean(item.allowRemoteHttps),
      };
      const spec = validateCustomProviderSpec(normalizedInput);
      if (seen.has(spec.id)) {
        throw new Error(`DUPLICATE_CUSTOM_PROVIDER_ID:${spec.id}`);
      }
      seen.add(spec.id);
      out.push({
        id: spec.id,
        label: spec.label,
        endpointUrl: spec.endpointUrl,
        method: spec.method,
        headers: spec.headers,
        bodyTemplate: spec.bodyTemplate,
        responsePath: spec.responsePath,
        allowRemoteHttps: spec.allowRemoteHttps,
        maxConcurrency: spec.maxConcurrency,
        timeoutMs: spec.timeoutMs,
      });
    } catch (err) {
      if (strict) throw err;
    }
  }
  return out;
}

function isPluginEnabled(configJsonPath, pluginId = PLUGIN_ID) {
  const target = configJsonPath || resolveHostPaths(process.env).CONFIG_JSON_PATH;
  const effectivePluginId = pluginId || PLUGIN_ID;
  try {
    if (!target || !fs.existsSync(target)) return true;
    const cfg = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
    const entry = cfg.plugins && cfg.plugins[effectivePluginId];
    if (entry && entry.enabled === false) return false;
    return true;
  } catch (_err) {
    // Fail-closed when an existing config.json is corrupted.
    return false;
  }
}

function readTranslatorSettings(pathOverrides = null, { strict = false } = {}) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  try {
    if (!fs.existsSync(p.SETTINGS_PATH)) {
      return {
        ...DEFAULT_SETTINGS,
        llmConfig: { ...DEFAULT_LLM_CONFIG },
        cloudApiConfig: { ...DEFAULT_CLOUD_API_CONFIG },
        customProviders: [],
      };
    }
    const parsed = parseSafeJson(fs.readFileSync(p.SETTINGS_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('SETTINGS_FILE_CORRUPTED');
    }
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) {
      throw new Error(`UNSUPPORTED_SETTINGS_SCHEMA_VERSION:${parsed.schemaVersion}`);
    }
    if (strict) {
      for (const boolKey of ['enabled', 'translateThinking', 'showThinking', 'translateStaticUi']) {
        if (parsed[boolKey] !== undefined && typeof parsed[boolKey] !== 'boolean') {
          throw new Error(`INVALID_BOOLEAN_SETTING:${boolKey}`);
        }
      }
    }
    return {
      schemaVersion: 1,
      enabled: parsed.enabled !== false,
      translateThinking: parsed.translateThinking !== false,
      showThinking: parsed.showThinking !== false,
      translateStaticUi: parsed.translateStaticUi !== false,
      provider: normalizeProviderId(parsed.provider),
      llmConfig: sanitizeLlmConfig(parsed.llmConfig, DEFAULT_LLM_CONFIG, { strict }),
      cloudApiConfig: sanitizeCloudApiConfig(parsed.cloudApiConfig, DEFAULT_CLOUD_API_CONFIG, { strict }),
      customProviders:
        parsed.customProviders === undefined
          ? []
          : sanitizeCustomProviders(parsed.customProviders, { strict }),
    };
  } catch (err) {
    if (strict) {
      throw new Error(`SETTINGS_FILE_CORRUPTED: ${err && err.message ? err.message : String(err)}`);
    }
    return {
      ...DEFAULT_SETTINGS,
      llmConfig: { ...DEFAULT_LLM_CONFIG },
      cloudApiConfig: { ...DEFAULT_CLOUD_API_CONFIG },
      customProviders: [],
    };
  }
}

function saveTranslatorSettings(patch, pathOverrides = null, { allowCorruptedRecovery = false } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('INVALID_SETTINGS_PATCH');
  }
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  const lockToken = acquireExclusiveLock(p.SETTINGS_LOCK_PATH);
  if (!lockToken) {
    throw new Error('SETTINGS_LOCK_BUSY');
  }
  try {
    let current;
    try {
      current = readTranslatorSettings(p, { strict: true });
    } catch (readErr) {
      if (allowCorruptedRecovery && readErr && String(readErr.message || '').startsWith('SETTINGS_FILE_CORRUPTED')) {
        current = {
          ...DEFAULT_SETTINGS,
          llmConfig: { ...DEFAULT_LLM_CONFIG },
          cloudApiConfig: { ...DEFAULT_CLOUD_API_CONFIG },
          customProviders: [],
        };
      } else {
        throw readErr;
      }
    }
    for (const boolKey of ['enabled', 'translateThinking', 'showThinking', 'translateStaticUi']) {
      if (patch[boolKey] !== undefined && typeof patch[boolKey] !== 'boolean') {
        throw new Error(`INVALID_BOOLEAN_SETTING:${boolKey}`);
      }
    }
    const next = {
      schemaVersion: 1,
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled !== false,
      translateThinking:
        typeof patch.translateThinking === 'boolean' ? patch.translateThinking : current.translateThinking,
      showThinking: typeof patch.showThinking === 'boolean' ? patch.showThinking : current.showThinking,
      translateStaticUi:
        typeof patch.translateStaticUi === 'boolean' ? patch.translateStaticUi : current.translateStaticUi,
      provider: patch.provider !== undefined ? normalizeProviderId(patch.provider) : current.provider,
      llmConfig:
        patch.llmConfig !== undefined
          ? sanitizeLlmConfig(patch.llmConfig, current.llmConfig, { strict: true })
          : current.llmConfig,
      cloudApiConfig:
        patch.cloudApiConfig !== undefined
          ? sanitizeCloudApiConfig(patch.cloudApiConfig, current.cloudApiConfig, { strict: true })
          : current.cloudApiConfig,
      customProviders:
        patch.customProviders !== undefined
          ? sanitizeCustomProviders(patch.customProviders, { strict: true })
          : current.customProviders,
    };
    writeFileAtomicSync(p.SETTINGS_PATH, JSON.stringify(next, null, 2) + '\n');
    return next;
  } finally {
    releaseExclusiveLock(p.SETTINGS_LOCK_PATH, lockToken);
  }
}

function removeTranslatorSettings(pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  const lockToken = acquireExclusiveLock(p.SETTINGS_LOCK_PATH);
  if (!lockToken) {
    throw new Error('SETTINGS_LOCK_BUSY');
  }
  try {
    if (fs.existsSync(p.SETTINGS_PATH)) {
      fs.unlinkSync(p.SETTINGS_PATH);
      return true;
    }
    return false;
  } finally {
    releaseExclusiveLock(p.SETTINGS_LOCK_PATH, lockToken);
  }
}

module.exports = {
  DEFAULT_LLM_CONFIG,
  DEFAULT_CLOUD_API_CONFIG,
  DEFAULT_SETTINGS,
  acquireExclusiveLock,
  releaseExclusiveLock,
  writeFileAtomicSync,
  normalizeProviderId,
  sanitizeLlmConfig,
  sanitizeCloudApiConfig,
  isPluginEnabled,
  readTranslatorSettings,
  saveTranslatorSettings,
  removeTranslatorSettings,
};
