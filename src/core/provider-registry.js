'use strict';

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeProviderId(rawId, aliasMap = null) {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim().toLowerCase();
  if (!trimmed || FORBIDDEN_KEYS.has(trimmed)) return null;
  const mapped =
    aliasMap && typeof aliasMap === 'object' && Object.prototype.hasOwnProperty.call(aliasMap, trimmed)
      ? String(aliasMap[trimmed]).trim().toLowerCase()
      : trimmed;
  if (!mapped || FORBIDDEN_KEYS.has(mapped) || !PROVIDER_ID_PATTERN.test(mapped)) {
    return null;
  }
  return mapped;
}

function createProviderRegistry({ aliasMap = null } = {}) {
  const providers = Object.create(null);
  const listeners = new Set();

  function notify(event) {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch (_err) {}
    }
  }

  function normalizeId(rawId) {
    return normalizeProviderId(rawId, aliasMap);
  }

  function registerProvider(provider) {
    if (!provider || typeof provider !== 'object') {
      throw new TypeError('Provider must be an object');
    }
    const normId = normalizeId(provider.id);
    if (!normId) {
      throw new RangeError(`Invalid translation provider id: "${String(provider.id)}"`);
    }
    if (typeof provider.translate !== 'function') {
      throw new TypeError(`Translation provider "${normId}" must implement translate(text, ctx)`);
    }

    const record = Object.create(null);
    Object.defineProperties(record, {
      id: { value: normId, enumerable: true },
      label: {
        enumerable: true,
        get() {
          return typeof provider.label === 'string' && provider.label.trim() ? provider.label.trim() : normId;
        },
      },
      description: {
        enumerable: true,
        get() {
          return typeof provider.description === 'string' ? provider.description : '';
        },
      },
      supportsRemote: {
        enumerable: true,
        get() {
          return provider.supportsRemote === undefined ? false : Boolean(provider.supportsRemote);
        },
      },
      maxConcurrency: {
        enumerable: true,
        get() {
          const raw = Number(provider.maxConcurrency);
          return Number.isFinite(raw) && raw > 0 ? Math.min(8, Math.max(1, Math.trunc(raw))) : 2;
        },
      },
      translate: {
        enumerable: true,
        value: (...args) => provider.translate(...args),
      },
      onDeactivate: {
        enumerable: true,
        value: typeof provider.onDeactivate === 'function' ? () => provider.onDeactivate() : null,
      },
    });

    providers[normId] = Object.freeze(record);
    notify({ type: 'register', id: normId, provider: providers[normId] });
    return providers[normId];
  }

  function unregisterProvider(rawId) {
    const normId = normalizeId(rawId);
    if (!normId || !Object.prototype.hasOwnProperty.call(providers, normId)) {
      return false;
    }
    delete providers[normId];
    notify({ type: 'unregister', id: normId });
    return true;
  }

  function getProvider(rawId) {
    const normId = normalizeId(rawId);
    if (!normId || !Object.prototype.hasOwnProperty.call(providers, normId)) {
      return null;
    }
    return providers[normId];
  }

  function hasProvider(rawId) {
    return Boolean(getProvider(rawId));
  }

  function listProviderIds() {
    return Object.keys(providers);
  }

  function listProviders() {
    return Object.keys(providers).map((id) => providers[id]);
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    normalizeId,
    registerProvider,
    unregisterProvider,
    getProvider,
    hasProvider,
    listProviderIds,
    listProviders,
    onChange,
  };
}

module.exports = {
  PROVIDER_ID_PATTERN,
  normalizeProviderId,
  createProviderRegistry,
};
