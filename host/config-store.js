'use strict';

const fs = require('fs');
const { resolveHostPaths } = require('./paths');
const {
  writeFileAtomicSync,
  acquireExclusiveFileLockWithWait,
  releaseExclusiveFileLock,
} = require('./process-sentinel');
const { validateTranslationEndpointUrl } = require('../src/adapters/translators/endpoint-validator');

const DEFAULT_LLM_CONFIG = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'gemma3:4b',
  apiFormat: 'ollama',
  allowRemoteHttps: false,
  timeoutMs: 15000,
});

function normalizeProviderId(raw) {
  const val = String(raw || '').trim().toLowerCase();
  if (!val) return null;
  if (val === 'google' || val === 'gtx' || val === 'google-translate') return 'google-translate';
  if (val === 'local' || val === 'llm' || val === 'ollama' || val === 'local-llm') return 'local-llm';
  if (val === '__proto__' || val === 'constructor' || val === 'prototype') return null;
  if (/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(val)) return val;
  return null;
}

function sanitizeLlmConfig(rawCandidate, fallback = DEFAULT_LLM_CONFIG) {
  const base = fallback || DEFAULT_LLM_CONFIG;
  if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) {
    return Object.freeze({ ...base });
  }
  const allowRemoteHttps =
    typeof rawCandidate.allowRemoteHttps === 'boolean'
      ? rawCandidate.allowRemoteHttps
      : Boolean(base.allowRemoteHttps);
  const rawUrl =
    typeof rawCandidate.baseUrl === 'string' && rawCandidate.baseUrl.trim()
      ? rawCandidate.baseUrl.trim()
      : base.baseUrl;
  let validatedUrl = base.baseUrl;
  try {
    const parsed = validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps });
    validatedUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch (_err) {
    return Object.freeze({ ...base });
  }
  const model =
    typeof rawCandidate.model === 'string' && rawCandidate.model.trim()
      ? rawCandidate.model.trim().slice(0, 128)
      : base.model;
  const apiFormat =
    rawCandidate.apiFormat === 'openai' || rawCandidate.apiFormat === 'ollama'
      ? rawCandidate.apiFormat
      : base.apiFormat;
  const timeoutNum = Number(rawCandidate.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutNum)
    ? Math.min(60000, Math.max(1000, Math.trunc(timeoutNum)))
    : base.timeoutMs;
  return Object.freeze({
    baseUrl: validatedUrl,
    model,
    apiFormat,
    allowRemoteHttps,
    timeoutMs,
  });
}

function parseLlmConfigRaw(rawVal, fallback = DEFAULT_LLM_CONFIG) {
  if (!rawVal) return null;
  let obj = rawVal;
  if (typeof rawVal === 'string') {
    try {
      obj = JSON.parse(rawVal);
    } catch (_err) {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const allowRemoteHttps = Boolean(obj.allowRemoteHttps);
  const rawUrl = typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : '';
  if (rawUrl) {
    try {
      validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps });
    } catch (_err) {
      return null;
    }
  }
  return sanitizeLlmConfig(obj, fallback);
}

function parsePretranslateCliArg(args) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] || '');
    if (a.startsWith('--pretranslate=')) {
      const val = a.slice(a.indexOf('=') + 1).trim().toLowerCase();
      if (val === 'on' || val === 'true' || val === '1') return true;
      if (val === 'off' || val === 'false' || val === '0') return false;
    } else if (a === '--pretranslate' && i + 1 < args.length) {
      const val = String(args[i + 1] || '').trim().toLowerCase();
      if (val === 'on' || val === 'true' || val === '1') return true;
      if (val === 'off' || val === 'false' || val === '0') return false;
    }
  }
  return null;
}

function parseProviderCliArg(args) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] || '');
    if (a.startsWith('--provider=') || a.startsWith('--adapter=')) {
      const norm = normalizeProviderId(a.slice(a.indexOf('=') + 1));
      if (norm) return norm;
    } else if ((a === '--provider' || a === '--adapter') && i + 1 < args.length) {
      const norm = normalizeProviderId(args[i + 1]);
      if (norm) return norm;
    }
  }
  return null;
}

function resolveEffectivePaths(pathOverrides = null) {
  const defaults = resolveHostPaths(process.env);
  if (!pathOverrides || typeof pathOverrides !== 'object') return defaults;
  return {
    ...defaults,
    CONFIG_JSON_PATH: pathOverrides.configPath || pathOverrides.CONFIG_JSON_PATH || defaults.CONFIG_JSON_PATH,
    SETTINGS_SSOT_PATH:
      pathOverrides.settingsSsotPath || pathOverrides.SETTINGS_SSOT_PATH || defaults.SETTINGS_SSOT_PATH,
    SETTINGS_SSOT_LOCK_PATH:
      pathOverrides.settingsSsotLockPath ||
      (pathOverrides.settingsSsotPath ? `${pathOverrides.settingsSsotPath}.lock` : defaults.SETTINGS_SSOT_LOCK_PATH),
    APP_STORAGE_PATH:
      pathOverrides.appStoragePath || pathOverrides.APP_STORAGE_PATH || defaults.APP_STORAGE_PATH,
    APP_STORAGE_LOCK_PATH:
      pathOverrides.appStorageLockPath || pathOverrides.APP_STORAGE_LOCK_PATH || defaults.APP_STORAGE_LOCK_PATH,
  };
}

function readJsonFileSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function isPluginEnabled(pathOverrides = null) {
  const { CONFIG_JSON_PATH } = resolveEffectivePaths(pathOverrides);
  const cfg = readJsonFileSafe(CONFIG_JSON_PATH);
  const entry = cfg && cfg.plugins && cfg.plugins['ko-thought-translator'];
  if (entry && entry.enabled === false) return false;
  return true;
}

// 100% read-only status/options reader (NEVER writes to disk — safe for `--status`!)
function readTranslatorOptionsReadOnly(pathOverrides = null) {
  const p = resolveEffectivePaths(pathOverrides);
  const cfg = readJsonFileSafe(p.CONFIG_JSON_PATH);
  const ssot = readJsonFileSafe(p.SETTINGS_SSOT_PATH);
  const appStorage = readJsonFileSafe(p.APP_STORAGE_PATH);

  const pluginEntry = (cfg && cfg.plugins && cfg.plugins['ko-thought-translator']) || {};
  const pluginEnabled = pluginEntry.enabled !== false;

  const ssotPre = ssot && typeof ssot.pretranslateEnabled === 'boolean' ? ssot.pretranslateEnabled : null;
  const ssotProv = ssot && ssot.translationProvider ? normalizeProviderId(ssot.translationProvider) : null;
  const ssotLlm = ssot && ssot.llmConfig ? parseLlmConfigRaw(ssot.llmConfig) : null;
  const ssotPendingAsar = Boolean(ssot && ssot.pendingAsarPatch);

  const legacyPre = typeof pluginEntry.pretranslate === 'boolean' ? pluginEntry.pretranslate : null;
  const legacyProv = pluginEntry.provider ? normalizeProviderId(pluginEntry.provider) : null;

  const storagePre =
    appStorage && appStorage['agy-ko-thought-pretranslate'] !== undefined
      ? appStorage['agy-ko-thought-pretranslate'] === '1' || appStorage['agy-ko-thought-pretranslate'] === true
      : null;
  const storageProv =
    appStorage && appStorage['agy-ko-thought-provider']
      ? normalizeProviderId(appStorage['agy-ko-thought-provider'])
      : null;
  const storageLlm =
    appStorage && appStorage['agy-ko-llm-config'] !== undefined
      ? parseLlmConfigRaw(appStorage['agy-ko-llm-config'])
      : null;

  // Precedence: SSOT (`ko_translator_settings.json`) > legacy `config.json` (1-time migration) > `app_storage.json` > defaults
  const pretranslateEnabled =
    ssotPre !== null ? ssotPre : legacyPre !== null ? legacyPre : storagePre !== null ? storagePre : false;
  const translationProvider = ssotProv || legacyProv || storageProv || 'google-translate';
  const llmConfig = ssotLlm || storageLlm || DEFAULT_LLM_CONFIG;

  return {
    pluginEnabled,
    pretranslateEnabled,
    translationProvider,
    llmConfig,
    pendingAsarPatch: ssotPendingAsar,
  };
}

// Writes/syncs SSOT (`ko_translator_settings.json` 0o600 under `ko_translator_settings.lock`) and renderer keys in `app_storage.json` (under `APP_STORAGE_LOCK_PATH`).
// NEVER writes custom provider headers (`agy-ko-custom-providers-v2`)!
function updateTranslatorSettings({
  explicitPretranslate = null,
  explicitProvider = null,
  explicitLlmConfig = null,
  pendingAsarPatch = null,
  syncToAppStorage = true,
  pathOverrides = null,
} = {}) {
  const p = resolveEffectivePaths(pathOverrides);
  const ssotLockTok = acquireExclusiveFileLockWithWait(p.SETTINGS_SSOT_LOCK_PATH, 2500, 15000);
  let nextRecord;
  try {
    const current = readTranslatorOptionsReadOnly(pathOverrides);
    const normProv =
      explicitProvider !== null && explicitProvider !== undefined
        ? normalizeProviderId(explicitProvider) || current.translationProvider
        : current.translationProvider;
    const nextPre =
      explicitPretranslate !== null && explicitPretranslate !== undefined
        ? Boolean(explicitPretranslate)
        : current.pretranslateEnabled;
    const nextLlm =
      explicitLlmConfig !== null && explicitLlmConfig !== undefined
        ? sanitizeLlmConfig(explicitLlmConfig, current.llmConfig)
        : current.llmConfig;
    const nextPending =
      pendingAsarPatch !== null && pendingAsarPatch !== undefined
        ? Boolean(pendingAsarPatch)
        : current.pendingAsarPatch;

    nextRecord = {
      schemaVersion: 2,
      pretranslateEnabled: nextPre,
      translationProvider: normProv,
      llmConfig: nextLlm,
      pendingAsarPatch: nextPending,
      updatedAt: new Date().toISOString(),
    };

    writeFileAtomicSync(p.SETTINGS_SSOT_PATH, JSON.stringify(nextRecord, null, 2) + '\n', { mode: 0o600 });
  } finally {
    if (ssotLockTok) {
      releaseExclusiveFileLock(p.SETTINGS_SSOT_LOCK_PATH, ssotLockTok);
    }
  }

  if (syncToAppStorage && p.APP_STORAGE_PATH && fs.existsSync(p.APP_STORAGE_PATH)) {
    const appLockTok = acquireExclusiveFileLockWithWait(p.APP_STORAGE_LOCK_PATH, 2500, 15000);
    if (appLockTok) {
      try {
        const data = readJsonFileSafe(p.APP_STORAGE_PATH);
        if (data) {
          const desiredPreStr = nextRecord.pretranslateEnabled ? '1' : '0';
          const desiredLlmStr = JSON.stringify(nextRecord.llmConfig);
          let changed = false;
          if (data['agy-ko-thought-pretranslate'] !== desiredPreStr) {
            data['agy-ko-thought-pretranslate'] = desiredPreStr;
            changed = true;
          }
          if (data['agy-ko-thought-provider'] !== nextRecord.translationProvider) {
            data['agy-ko-thought-provider'] = nextRecord.translationProvider;
            changed = true;
          }
          if (data['agy-ko-llm-config'] !== desiredLlmStr) {
            data['agy-ko-llm-config'] = desiredLlmStr;
            changed = true;
          }
          if (changed) {
            writeFileAtomicSync(p.APP_STORAGE_PATH, JSON.stringify(data, null, 2));
          }
        }
      } finally {
        releaseExclusiveFileLock(p.APP_STORAGE_LOCK_PATH, appLockTok);
      }
    }
  }

  return nextRecord;
}

function removeSettingsSsotFile(pathOverrides = null) {
  const p = resolveEffectivePaths(pathOverrides);
  const ssotLockTok = acquireExclusiveFileLockWithWait(p.SETTINGS_SSOT_LOCK_PATH, 2500, 15000);
  try {
    if (fs.existsSync(p.SETTINGS_SSOT_PATH)) {
      fs.unlinkSync(p.SETTINGS_SSOT_PATH);
      return true;
    }
    return false;
  } catch (_err) {
    return false;
  } finally {
    if (ssotLockTok) {
      releaseExclusiveFileLock(p.SETTINGS_SSOT_LOCK_PATH, ssotLockTok);
    }
  }
}

module.exports = {
  DEFAULT_LLM_CONFIG,
  normalizeProviderId,
  sanitizeLlmConfig,
  parseLlmConfigRaw,
  parsePretranslateCliArg,
  parseProviderCliArg,
  resolveEffectivePaths,
  isPluginEnabled,
  readTranslatorOptionsReadOnly,
  updateTranslatorSettings,
  removeSettingsSsotFile,
};
