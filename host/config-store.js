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

const { resolveHostPaths, PLUGIN_ID } = require('./paths');
const { validateTranslationEndpointUrl } = require('../src/adapters/translators/endpoint-validator');
const { validateCustomProviderSpec } = require('../src/adapters/translators/custom-provider');

const DEFAULT_LLM_CONFIG = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma3:4b',
  apiFormat: 'ollama',
  allowRemoteHttps: false,
  timeoutMs: 15000,
});

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  translateThinking: true,
  showThinking: true,
  translateStaticUi: true,
  provider: 'google-translate',
  llmConfig: DEFAULT_LLM_CONFIG,
  customProviders: Object.freeze([]),
});

function isProcessAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function acquireExclusiveLock(lockPath, staleMs = 15000) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = crypto.randomBytes(12).toString('hex');
  const payload = JSON.stringify({ pid: process.pid, token, ts: Date.now() });

  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, payload, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    return token;
  } catch (err) {
    if (!err || err.code !== 'EEXIST') {
      return null;
    }
  }

  try {
    const stat = fs.statSync(lockPath);
    let ownerAlive = false;
    let corrupt = false;
    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const info = JSON.parse(raw);
      ownerAlive = Boolean(info && info.pid && isProcessAlive(info.pid));
    } catch (_parseErr) {
      corrupt = true;
      ownerAlive = false;
    }
    const ageMs = Date.now() - stat.mtimeMs;
    const isStale = !ownerAlive && (ageMs > staleMs || (corrupt && ageMs >= Math.min(staleMs, 1000)));
    if (!isStale) return null;

    // Atomic stale-lock quarantine via renameSync prevents unlink->open TOCTOU races.
    const quarantinePath = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockPath, quarantinePath);
    } catch (_renameErr) {
      return null;
    }
    try {
      fs.unlinkSync(quarantinePath);
    } catch (_unlinkErr) {}

    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, payload, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    return token;
  } catch (_err) {
    return null;
  }
}

function releaseExclusiveLock(lockPath, token) {
  if (!lockPath || !token) return;
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const info = JSON.parse(raw);
    if (info && info.token === token) {
      fs.unlinkSync(lockPath);
    }
  } catch (_err) {}
}

function writeFileAtomicSync(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, targetPath);
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_err) {}
    }
  }
}

function normalizeProviderId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'google-translate';
  if (s === 'google' || s === 'gtx' || s === 'google-translate') return 'google-translate';
  if (s === 'local' || s === 'llm' || s === 'ollama' || s === 'local-llm') return 'local-llm';
  if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(s)) return s;
  throw new Error(`Invalid provider id: ${raw}`);
}

function sanitizeLlmConfig(raw, existing = DEFAULT_LLM_CONFIG) {
  const base = { ...DEFAULT_LLM_CONFIG, ...(existing || {}) };
  if (!raw || typeof raw !== 'object') return base;

  const allowRemoteHttps =
    typeof raw.allowRemoteHttps === 'boolean' ? raw.allowRemoteHttps : Boolean(base.allowRemoteHttps);
  const rawUrl = raw.baseUrl !== undefined ? String(raw.baseUrl).trim() : base.baseUrl;
  const parsedUrl = validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps });

  const model =
    raw.model !== undefined && String(raw.model).trim()
      ? String(raw.model).trim().slice(0, 128)
      : base.model;
  const rawFormat = String(raw.apiFormat || '').trim().toLowerCase();
  const apiFormat =
    rawFormat === 'openai' || rawFormat === 'openai-compat'
      ? 'openai'
      : rawFormat === 'ollama'
        ? 'ollama'
        : base.apiFormat === 'openai-compat'
          ? 'openai'
          : base.apiFormat;
  const timeoutMs =
    typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs >= 1000 && raw.timeoutMs <= 120000
      ? Math.floor(raw.timeoutMs)
      : base.timeoutMs;

  return {
    baseUrl: parsedUrl.href.replace(/\/+$/, ''),
    model,
    apiFormat,
    allowRemoteHttps,
    timeoutMs,
  };
}

const SECRET_HEADER_RE = /^(?:authorization|x-api-key|api-key)$/i;

function sanitizeCustomProviders(rawList, { strict = false } = {}) {
  if (!Array.isArray(rawList)) return [];
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
      const normalizedInput = {
        ...item,
        endpointUrl: item.endpointUrl !== undefined ? item.endpointUrl : item.url,
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

function isPluginEnabled(configJsonPath) {
  const target = configJsonPath || resolveHostPaths(process.env).CONFIG_JSON_PATH;
  try {
    if (!target || !fs.existsSync(target)) return true;
    const cfg = JSON.parse(fs.readFileSync(target, 'utf8'));
    const entry = cfg && cfg.plugins && cfg.plugins[PLUGIN_ID];
    if (entry && entry.enabled === false) return false;
    return true;
  } catch (_err) {
    return true;
  }
}

function readTranslatorSettings(pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  try {
    if (!fs.existsSync(p.SETTINGS_PATH)) {
      return {
        ...DEFAULT_SETTINGS,
        llmConfig: { ...DEFAULT_LLM_CONFIG },
        customProviders: [],
      };
    }
    const parsed = JSON.parse(fs.readFileSync(p.SETTINGS_PATH, 'utf8'));
    return {
      schemaVersion: 1,
      translateThinking: parsed.translateThinking !== false,
      showThinking: parsed.showThinking !== false,
      translateStaticUi: parsed.translateStaticUi !== false,
      provider: normalizeProviderId(parsed.provider),
      llmConfig: sanitizeLlmConfig(parsed.llmConfig, DEFAULT_LLM_CONFIG),
      customProviders: sanitizeCustomProviders(parsed.customProviders, { strict: false }),
    };
  } catch (_err) {
    return {
      ...DEFAULT_SETTINGS,
      llmConfig: { ...DEFAULT_LLM_CONFIG },
      customProviders: [],
    };
  }
}

function saveTranslatorSettings(patch, pathOverrides = null) {
  const p = { ...resolveHostPaths(process.env), ...(pathOverrides || {}) };
  const lockToken = acquireExclusiveLock(p.SETTINGS_LOCK_PATH);
  if (!lockToken) {
    throw new Error('SETTINGS_LOCK_BUSY');
  }
  try {
    const current = readTranslatorSettings(p);
    const next = {
      schemaVersion: 1,
      translateThinking:
        typeof patch.translateThinking === 'boolean' ? patch.translateThinking : current.translateThinking,
      showThinking: typeof patch.showThinking === 'boolean' ? patch.showThinking : current.showThinking,
      translateStaticUi:
        typeof patch.translateStaticUi === 'boolean' ? patch.translateStaticUi : current.translateStaticUi,
      provider: patch.provider !== undefined ? normalizeProviderId(patch.provider) : current.provider,
      llmConfig:
        patch.llmConfig !== undefined
          ? sanitizeLlmConfig(patch.llmConfig, current.llmConfig)
          : current.llmConfig,
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
  DEFAULT_SETTINGS,
  acquireExclusiveLock,
  releaseExclusiveLock,
  writeFileAtomicSync,
  normalizeProviderId,
  sanitizeLlmConfig,
  isPluginEnabled,
  readTranslatorSettings,
  saveTranslatorSettings,
  removeTranslatorSettings,
};
