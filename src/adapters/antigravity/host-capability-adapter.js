'use strict';

/**
 * Antigravity Host Capability Adapter (AddonContextV3 Primary + V2 Compat — v3.0.0).
 *
 * Isolates all `AddonContextV3` vs. legacy v2 `addonHost` differences behind a clean
 * capability facade so vendor-neutral `src/runtime/bootstrap.js` and `quick-settings-ui.js`
 * work identically across:
 * - Antigravity Desktop (`antigravity-addons` v3.0.0+ `AddonContextV3` & v2 compat)
 * - Antigravity Remote Web (`AddonContextV3` via Userscript / extension / SDK test host)
 * - Standalone tests without a host capability handle
 */

const { DEFAULT_LLM_CONFIG } = require('../translators/default-providers');
const { validateTranslationEndpointUrl } = require('../translators/endpoint-validator');

const V3_SETTINGS_STORAGE_KEY = 'ko_translator_settings_v1';
const ALLOWED_NET_HTTPS_HOSTS = new Set(['translate.googleapis.com']);
const ALLOWED_NET_LOOPBACK_PORTS = new Set([11434]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_QUERY_RE = /[?&](?:key|api_key|apikey|token|access_token|secret|auth)=/i;

function isAddonContextV3(candidate) {
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      candidate.apiVersion === 3 &&
      candidate.ui &&
      typeof candidate.ui === 'object' &&
      candidate.lifecycle &&
      typeof candidate.lifecycle === 'object'
  );
}

function extractV3Context(candidate) {
  if (isAddonContextV3(candidate)) return candidate;
  if (candidate && typeof candidate === 'object' && isAddonContextV3(candidate.v3)) {
    return candidate.v3;
  }
  return null;
}

function sanitizeDeepPlain(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeepPlain(item, depth + 1));
  }
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = sanitizeDeepPlain(value[k], depth + 1);
    }
    return out;
  }
  return undefined;
}

function buildDefaultSettings() {
  return {
    schemaVersion: 1,
    enabled: true,
    translateThinking: true,
    showThinking: true,
    translateStaticUi: true,
    provider: 'google-translate',
    llmConfig: { ...DEFAULT_LLM_CONFIG },
    customProviders: [],
  };
}

function sanitizeStoredSettings(raw, fallback = buildDefaultSettings()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = sanitizeDeepPlain(raw);
  if (!clean || typeof clean !== 'object') return null;

  const next = {
    ...fallback,
    llmConfig: { ...DEFAULT_LLM_CONFIG, ...(fallback.llmConfig || {}) },
    customProviders: Array.isArray(fallback.customProviders) ? fallback.customProviders.slice() : [],
  };

  if (typeof clean.enabled === 'boolean') next.enabled = clean.enabled;
  if (typeof clean.translateThinking === 'boolean') next.translateThinking = clean.translateThinking;
  if (typeof clean.showThinking === 'boolean') next.showThinking = clean.showThinking;
  if (typeof clean.translateStaticUi === 'boolean') next.translateStaticUi = clean.translateStaticUi;
  if (typeof clean.provider === 'string' && clean.provider.trim()) {
    const p = clean.provider.trim().toLowerCase();
    if (!FORBIDDEN_KEYS.has(p) && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(p)) {
      next.provider = p;
    }
  }
  if (clean.llmConfig && typeof clean.llmConfig === 'object' && !Array.isArray(clean.llmConfig)) {
    const mergedLlm = { ...next.llmConfig, ...clean.llmConfig };
    const allowRemoteHttps = Boolean(mergedLlm.allowRemoteHttps);
    if (typeof mergedLlm.baseUrl === 'string' && mergedLlm.baseUrl.trim() && !SECRET_QUERY_RE.test(mergedLlm.baseUrl)) {
      try {
        const parsed = validateTranslationEndpointUrl(mergedLlm.baseUrl.trim(), { allowRemoteHttps });
        mergedLlm.baseUrl = parsed.href.replace(/\/+$/, '');
      } catch (_err) {
        mergedLlm.baseUrl = DEFAULT_LLM_CONFIG.baseUrl;
        mergedLlm.allowRemoteHttps = false;
      }
    } else {
      mergedLlm.baseUrl = DEFAULT_LLM_CONFIG.baseUrl;
      mergedLlm.allowRemoteHttps = false;
    }
    if (mergedLlm.apiFormat !== 'openai' && mergedLlm.apiFormat !== 'ollama') {
      mergedLlm.apiFormat = 'ollama';
    }
    const rawTimeout = Number(mergedLlm.timeoutMs);
    mergedLlm.timeoutMs =
      Number.isFinite(rawTimeout) && rawTimeout >= 1000 && rawTimeout <= 120000
        ? Math.floor(rawTimeout)
        : DEFAULT_LLM_CONFIG.timeoutMs;
    mergedLlm.model =
      typeof mergedLlm.model === 'string' && mergedLlm.model.trim()
        ? mergedLlm.model.trim().slice(0, 128)
        : DEFAULT_LLM_CONFIG.model;
    mergedLlm.allowRemoteHttps = Boolean(mergedLlm.allowRemoteHttps);
    next.llmConfig = mergedLlm;
  }
  if (Array.isArray(clean.customProviders)) {
    next.customProviders = clean.customProviders.slice(0, 16);
  }
  next.schemaVersion = 1;
  return next;
}

function makeAbortError() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

function shouldUseV3NetFetch(rawUrl, v3Ctx) {
  if (!v3Ctx || !v3Ctx.net || typeof v3Ctx.net.fetch !== 'function') return false;
  const caps = (v3Ctx.env && v3Ctx.env.capabilities) || {};
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch (_err) {
    return false;
  }
  if (parsed.protocol === 'https:') {
    return Boolean(caps.hasNetHttps && ALLOWED_NET_HTTPS_HOSTS.has(parsed.hostname.toLowerCase()));
  }
  if (parsed.protocol === 'http:') {
    if (!caps.hasLocalLoopback) return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost') return false;
    const port = parsed.port ? Number(parsed.port) : 80;
    return ALLOWED_NET_LOOPBACK_PORTS.has(port);
  }
  return false;
}

function createHostAwareFetch({ hostCapability = null, fallbackFetch = null } = {}) {
  const v3Ctx = extractV3Context(hostCapability);
  if (!v3Ctx || !v3Ctx.net || typeof v3Ctx.net.fetch !== 'function') {
    return fallbackFetch;
  }

  return async function hostAwareFetch(url, init = {}) {
    const targetUrl = typeof url === 'string' ? url : String(url || '');
    if (!shouldUseV3NetFetch(targetUrl, v3Ctx)) {
      if (typeof fallbackFetch === 'function') {
        return fallbackFetch(url, init);
      }
      throw new Error('ERR_NET_FETCH_FALLBACK_UNAVAILABLE');
    }

    const opts = init && typeof init === 'object' ? init : {};
    const signal = opts.signal || null;
    if (signal && signal.aborted) {
      throw makeAbortError();
    }

    const netInit = {
      method: typeof opts.method === 'string' && opts.method.trim() ? opts.method.trim().toUpperCase() : 'GET',
    };
    if (opts.headers && typeof opts.headers === 'object') {
      netInit.headers = { ...opts.headers };
    }
    if (opts.body !== undefined && opts.body !== null) {
      netInit.body = String(opts.body);
    }
    if (Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0) {
      netInit.timeoutMs = Math.floor(Number(opts.timeoutMs));
    }

    let aborted = false;
    let onAbort = null;
    const abortPromise =
      signal && typeof signal.addEventListener === 'function'
        ? new Promise((_resolve, reject) => {
            onAbort = () => {
              aborted = true;
              reject(makeAbortError());
            };
            signal.addEventListener('abort', onAbort, { once: true });
          })
        : null;

    try {
      const fetchPromise = Promise.resolve(v3Ctx.net.fetch(targetUrl, netInit));
      const res = abortPromise ? await Promise.race([fetchPromise, abortPromise]) : await fetchPromise;
      if (aborted) throw makeAbortError();

      if (
        res &&
        res.ok === false &&
        !res.status &&
        (res.reason === 'ERR_NET_HOST_NOT_ALLOWED' || res.reason === 'ERR_NET_LOOPBACK_NOT_ALLOWED') &&
        typeof fallbackFetch === 'function'
      ) {
        return fallbackFetch(url, init);
      }

      if (!res || (res.ok === false && !res.status && res.reason)) {
        throw new Error((res && res.reason) || 'ERR_NET_FETCH_FAILED');
      }

      const status = typeof res.status === 'number' ? res.status : res.ok ? 200 : 0;
      const statusText = typeof res.statusText === 'string' ? res.statusText : '';
      const bodyText = typeof res.bodyText === 'string' ? res.bodyText : '';
      return {
        ok: Boolean(res.ok && status >= 200 && status < 300),
        status,
        statusText,
        async text() {
          return bodyText;
        },
        async json() {
          return JSON.parse(bodyText);
        },
      };
    } finally {
      if (signal && onAbort && typeof signal.removeEventListener === 'function') {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (_err) {}
      }
    }
  };
}

function createV3StorageSettingsBridge(v3Ctx) {
  const listeners = new Set();
  let revision = 1;
  let saveSeq = 0;
  let currentData = buildDefaultSettings();
  let currentSnap = Object.freeze({
    status: 'ok',
    revision,
    data: Object.freeze({ ...currentData, llmConfig: Object.freeze({ ...currentData.llmConfig }) }),
    reason: null,
  });

  function makeFrozenSnap(data, rev) {
    return Object.freeze({
      status: 'ok',
      revision: rev,
      data: Object.freeze({
        ...data,
        llmConfig: Object.freeze({ ...(data.llmConfig || DEFAULT_LLM_CONFIG) }),
        customProviders: Object.freeze(Array.isArray(data.customProviders) ? data.customProviders.slice() : []),
      }),
      reason: null,
    });
  }

  function emitSnapshot(snap) {
    currentSnap = snap;
    for (const cb of Array.from(listeners)) {
      try {
        cb(snap);
      } catch (_err) {}
    }
  }

  const storage = v3Ctx && v3Ctx.storage && typeof v3Ctx.storage.get === 'function' ? v3Ctx.storage : null;
  let storageUnsub = null;
  if (storage) {
    const seqAtStart = saveSeq;
    Promise.resolve(storage.get(V3_SETTINGS_STORAGE_KEY))
      .then((stored) => {
        if (saveSeq !== seqAtStart || !stored) return;
        const sanitized = sanitizeStoredSettings(stored, currentData);
        if (!sanitized) return;
        currentData = sanitized;
        revision += 1;
        emitSnapshot(makeFrozenSnap(currentData, revision));
      })
      .catch(() => {});

    if (typeof storage.onDidChange === 'function') {
      try {
        storageUnsub = storage.onDidChange((ev) => {
          if (!ev || ev.key !== V3_SETTINGS_STORAGE_KEY || !ev.newValue) return;
          const sanitized = sanitizeStoredSettings(ev.newValue, currentData);
          if (!sanitized) return;
          currentData = sanitized;
          revision += 1;
          emitSnapshot(makeFrozenSnap(currentData, revision));
        });
      } catch (_err) {}
    }
  }

  return {
    getSettings() {
      return currentSnap;
    },
    onSettingsChange(cb) {
      if (typeof cb !== 'function') return () => {};
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    async saveSettings(nextData) {
      if (!nextData || typeof nextData !== 'object' || Array.isArray(nextData)) {
        return Object.freeze({ ok: false, reason: 'ERR_SETTINGS_MUST_BE_OBJECT', snapshot: null });
      }
      const merged = sanitizeStoredSettings({ ...currentData, ...nextData }, currentData);
      if (!merged) {
        return Object.freeze({ ok: false, reason: 'ERR_SETTINGS_INVALID_JSON', snapshot: null });
      }
      saveSeq += 1;
      if (storage && typeof storage.set === 'function') {
        try {
          await storage.set(V3_SETTINGS_STORAGE_KEY, merged);
        } catch (err) {
          return Object.freeze({
            ok: false,
            reason: (err && err.message) || 'ERR_SETTINGS_WRITE_FAILED',
            snapshot: null,
          });
        }
      }
      currentData = merged;
      revision += 1;
      const snap = makeFrozenSnap(currentData, revision);
      emitSnapshot(snap);
      return Object.freeze({ ok: true, reason: null, snapshot: snap });
    },
    dispose() {
      listeners.clear();
      if (typeof storageUnsub === 'function') {
        try {
          storageUnsub();
        } catch (_err) {}
        storageUnsub = null;
      }
    },
  };
}

function createHostCapabilityAdapter(rawHostCapability) {
  if (!rawHostCapability || typeof rawHostCapability !== 'object') {
    return null;
  }
  if (rawHostCapability.__isHostCapabilityAdapter === true) {
    return rawHostCapability;
  }

  const v3Ctx = extractV3Context(rawHostCapability);
  const pureV3 = isAddonContextV3(rawHostCapability);
  const surface =
    v3Ctx && v3Ctx.env && typeof v3Ctx.env.surface === 'string'
      ? v3Ctx.env.surface
      : rawHostCapability.hostProfileId === 'antigravity-remote-web'
        ? 'remote-web'
        : 'desktop';

  if (!pureV3) {
    // V2 handle (or v2CompatAdapter with optional `.v3` bridge, or unit test mock)
    return Object.freeze({
      ...rawHostCapability,
      __isHostCapabilityAdapter: true,
      v3: v3Ctx,
      surface,
      isV3: Boolean(v3Ctx),
      isPureV3: false,
    });
  }

  // Pure AddonContextV3 (`schemaVersion: 3`)
  const nativeSettingsBridge =
    rawHostCapability.settingsBridge &&
    typeof rawHostCapability.settingsBridge.get === 'function' &&
    typeof rawHostCapability.settingsBridge.save === 'function'
      ? rawHostCapability.settingsBridge
      : null;

  const fallbackStorageBridge = nativeSettingsBridge ? null : createV3StorageSettingsBridge(rawHostCapability);
  if (fallbackStorageBridge && typeof rawHostCapability.lifecycle.onDispose === 'function') {
    try {
      rawHostCapability.lifecycle.onDispose(() => fallbackStorageBridge.dispose());
    } catch (_err) {}
  }

  const adapted = {
    __isHostCapabilityAdapter: true,
    apiVersion: 3,
    isV3: true,
    isPureV3: true,
    v3: rawHostCapability,
    surface,
    pluginId: (rawHostCapability.meta && rawHostCapability.meta.pluginId) || 'ko-thought-translator',
    displayName: (rawHostCapability.meta && rawHostCapability.meta.displayName) || 'ko-thought-translator',
    version: (rawHostCapability.meta && rawHostCapability.meta.version) || '3.0.0',
    trustLevel: (rawHostCapability.meta && rawHostCapability.meta.trustLevel) || 'trusted',
    hasSettingsBridge: true,
    getSettings() {
      if (nativeSettingsBridge) return nativeSettingsBridge.get();
      return fallbackStorageBridge.getSettings();
    },
    onSettingsChange(cb) {
      if (nativeSettingsBridge && typeof nativeSettingsBridge.onChange === 'function') {
        return nativeSettingsBridge.onChange(cb);
      }
      return fallbackStorageBridge.onSettingsChange(cb);
    },
    saveSettings(nextData) {
      if (nativeSettingsBridge) return nativeSettingsBridge.save(nextData);
      return fallbackStorageBridge.saveSettings(nextData);
    },
    injectStyle(styleId, cssText, opts) {
      return rawHostCapability.ui.injectStyle(styleId, cssText, opts);
    },
    removeStyle(styleId) {
      return rawHostCapability.ui.removeStyle(styleId);
    },
    isElementInsideIgnored(nodeOrEvent, opts) {
      if (rawHostCapability.dom && typeof rawHostCapability.dom.isElementInsideIgnored === 'function') {
        return rawHostCapability.dom.isElementInsideIgnored(nodeOrEvent, opts);
      }
      return false;
    },
    onDispose(fn) {
      return rawHostCapability.lifecycle.onDispose(fn);
    },
  };

  return Object.freeze(adapted);
}

module.exports = {
  V3_SETTINGS_STORAGE_KEY,
  ALLOWED_NET_HTTPS_HOSTS,
  ALLOWED_NET_LOOPBACK_PORTS,
  isAddonContextV3,
  extractV3Context,
  shouldUseV3NetFetch,
  createHostAwareFetch,
  createHostCapabilityAdapter,
};
