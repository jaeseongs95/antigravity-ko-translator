'use strict';

const {
  isAlreadyKoreanOrNonEnglish,
  isInvalidCachedOrTranslatedText,
  protectIdentifiersInThoughtText,
  restoreIdentifiersInThoughtText,
} = require('./text-tokenizer');

function createTranslationService({
  registry,
  storage,
  defaultProviderId,
  isRemoteEnv = false,
  providerStorageKey = 'ko-thought-provider',
  cacheStorageKey = 'ko-thought-cache-v5',
  maxCacheEntries = 3000,
  saveDebounceMs = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  sharedMemCache = null,
} = {}) {
  if (!registry || typeof registry.getProvider !== 'function' || typeof registry.normalizeId !== 'function') {
    throw new TypeError('registry implementing ProviderRegistry is required');
  }
  const normalizedDefaultId = registry.normalizeId(defaultProviderId);
  if (!normalizedDefaultId) {
    throw new RangeError('defaultProviderId must be a valid provider id');
  }

  const memCache = sharedMemCache instanceof Map ? sharedMemCache : new Map();
  const inflightMap = new Map();
  const queue = [];
  const subscribers = new Set();
  let activeRequests = 0;
  let epoch = 0;
  let disposed = false;
  let saveCacheTimer = null;
  let desiredProviderId = normalizedDefaultId;
  let pendingSavedCustomProviderId = null;

  const savedRaw = storage && typeof storage.getItem === 'function' ? storage.getItem(providerStorageKey) : null;
  const savedNorm = savedRaw ? registry.normalizeId(savedRaw) : null;
  if (savedNorm) {
    desiredProviderId = savedNorm;
    if (!registry.hasProvider(savedNorm)) {
      pendingSavedCustomProviderId = savedNorm;
    }
  } else if (storage && typeof storage.setItem === 'function') {
    storage.setItem(providerStorageKey, desiredProviderId);
  }

  function notifySubscribers() {
    const snap = {
      desiredProviderId,
      effectiveProviderId: getEffectiveProviderId(),
      epoch,
      cacheSize: memCache.size,
    };
    for (const fn of Array.from(subscribers)) {
      try {
        fn(snap);
      } catch (_err) {}
    }
  }

  const offRegistry =
    typeof registry.onChange === 'function'
      ? registry.onChange(({ type, id }) => {
          if (type === 'register' && pendingSavedCustomProviderId && id === pendingSavedCustomProviderId) {
            desiredProviderId = id;
            pendingSavedCustomProviderId = null;
            if (storage && typeof storage.setItem === 'function') {
              storage.setItem(providerStorageKey, id);
            }
          }
          drainQueue();
          notifySubscribers();
        })
      : () => {};

  function resolveEffectiveProvider() {
    const desired = registry.getProvider(desiredProviderId);
    if (desired) {
      if (isRemoteEnv && !desired.supportsRemote) {
        return registry.getProvider(normalizedDefaultId) || desired;
      }
      return desired;
    }
    return registry.getProvider(normalizedDefaultId) || registry.listProviders()[0] || null;
  }

  function getDesiredProviderId() {
    return desiredProviderId;
  }

  function getEffectiveProviderId() {
    const prov = resolveEffectiveProvider();
    return prov ? prov.id : normalizedDefaultId;
  }

  function getEffectiveProvider() {
    return resolveEffectiveProvider();
  }

  function getEffectiveProviderLabel() {
    const prov = resolveEffectiveProvider();
    return prov ? prov.label : desiredProviderId;
  }

  function enforceCacheBound() {
    while (memCache.size > maxCacheEntries) {
      const oldestKey = memCache.keys().next().value;
      if (oldestKey === undefined) break;
      memCache.delete(oldestKey);
    }
  }

  function flushCache() {
    if (disposed || !storage || typeof storage.setItem !== 'function') return;
    enforceCacheBound();
    const entries = Array.from(memCache.entries())
      .filter(([k, v]) => !isInvalidCachedOrTranslatedText(v, k))
      .slice(-maxCacheEntries);
    const serialized = Object.create(null);
    for (const [k, v] of entries) {
      serialized[k] = v;
    }
    storage.setItem(cacheStorageKey, JSON.stringify(serialized));
  }

  function scheduleSaveCache(writeEpoch) {
    enforceCacheBound();
    if (disposed || saveCacheTimer || writeEpoch !== epoch) return;
    saveCacheTimer = setTimer(() => {
      saveCacheTimer = null;
      if (!disposed && writeEpoch === epoch) {
        flushCache();
      }
    }, saveDebounceMs);
  }

  function hydrateCache() {
    if (!storage || typeof storage.getItem !== 'function') return;
    const raw = storage.getItem(cacheStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      let purged = 0;
      const validEntries = [];
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v && !isInvalidCachedOrTranslatedText(v, k)) {
          validEntries.push([k, v]);
        } else {
          purged++;
        }
      }
      const sortedKeys = validEntries.map(([k]) => k).sort();
      const prefixFragments = new Set();
      for (let i = 0; i < sortedKeys.length - 1; i++) {
        const cur = sortedKeys[i];
        const next = sortedKeys[i + 1];
        if (next.length > cur.length && next.startsWith(cur) && !/[.!?:)"'\]]$/.test(cur.trim())) {
          prefixFragments.add(cur);
        }
      }
      for (const [k, v] of validEntries) {
        if (prefixFragments.has(k)) {
          purged++;
        } else {
          memCache.set(k, v);
        }
      }
      enforceCacheBound();
      if (purged > 0) {
        flushCache();
      }
    } catch (_err) {}
  }

  function bumpEpoch() {
    epoch += 1;
    if (saveCacheTimer) {
      clearTimer(saveCacheTimer);
      saveCacheTimer = null;
    }
    inflightMap.clear();
    return epoch;
  }

  function clearCache() {
    bumpEpoch();
    memCache.clear();
    if (storage && typeof storage.removeItem === 'function') {
      storage.removeItem(cacheStorageKey);
    }
    notifySubscribers();
  }

  function setProvider(candidateId, { persist = true } = {}) {
    const normId = registry.normalizeId(candidateId);
    if (!normId || !registry.hasProvider(normId)) {
      throw new Error(
        `Unknown translation provider "${String(candidateId)}". Available: ${registry.listProviderIds().join(', ')}`
      );
    }
    const prevDesired = desiredProviderId;
    const prevEffective = resolveEffectiveProvider();
    desiredProviderId = normId;
    pendingSavedCustomProviderId = null;
    if (persist && storage && typeof storage.setItem === 'function') {
      storage.setItem(providerStorageKey, desiredProviderId);
    }
    const nextEffective = resolveEffectiveProvider();
    if (prevEffective && (!nextEffective || prevEffective.id !== nextEffective.id)) {
      if (typeof prevEffective.onDeactivate === 'function') {
        try {
          prevEffective.onDeactivate();
        } catch (_err) {}
      }
    }
    if (prevDesired !== desiredProviderId) {
      bumpEpoch();
    }
    drainQueue();
    notifySubscribers();
    return {
      desiredProviderId,
      effectiveProviderId: getEffectiveProviderId(),
      availableProviders: registry.listProviderIds(),
    };
  }

  function syncDesiredProviderFromExternal(rawId) {
    const normId = registry.normalizeId(rawId);
    if (!normId) return false;
    if (registry.hasProvider(normId)) {
      const candidate = registry.getProvider(normId);
      if (isRemoteEnv && !candidate.supportsRemote) {
        const currentDesired = registry.getProvider(desiredProviderId);
        if (
          (currentDesired && currentDesired.supportsRemote && desiredProviderId !== normalizedDefaultId) ||
          pendingSavedCustomProviderId
        ) {
          return false;
        }
        desiredProviderId = normId;
        notifySubscribers();
        return true;
      }
      pendingSavedCustomProviderId = null;
      if (desiredProviderId !== normId) {
        const prevEff = resolveEffectiveProvider();
        desiredProviderId = normId;
        if (storage && typeof storage.setItem === 'function') {
          storage.setItem(providerStorageKey, normId);
        }
        const nextEff = resolveEffectiveProvider();
        if (prevEff && (!nextEff || prevEff.id !== nextEff.id) && typeof prevEff.onDeactivate === 'function') {
          try {
            prevEff.onDeactivate();
          } catch (_err) {}
        }
        bumpEpoch();
        drainQueue();
        notifySubscribers();
        return true;
      }
      return false;
    }
    pendingSavedCustomProviderId = normId;
    desiredProviderId = normId;
    if (storage && typeof storage.getItem === 'function' && !storage.getItem(providerStorageKey)) {
      storage.setItem(providerStorageKey, normId);
    }
    notifySubscribers();
    return true;
  }

  function drainQueue() {
    if (disposed) return;
    const prov = resolveEffectiveProvider();
    const maxConc = prov ? prov.maxConcurrency : 2;
    while (activeRequests < maxConc && queue.length > 0) {
      const entry = queue.shift();
      if (entry.signal && entry.signal.aborted) {
        entry.reject(new Error('ABORTED'));
        continue;
      }
      activeRequests += 1;
      Promise.resolve()
        .then(() => entry.fn())
        .then(entry.resolve, entry.reject)
        .finally(() => {
          activeRequests -= 1;
          drainQueue();
        });
    }
  }

  function enqueue(fn, signal = null) {
    if (disposed) return Promise.reject(new Error('DISPOSED'));
    if (signal && signal.aborted) return Promise.reject(new Error('ABORTED'));
    return new Promise((resolve, reject) => {
      const entry = { fn, resolve, reject, signal };
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener(
          'abort',
          () => {
            const idx = queue.indexOf(entry);
            if (idx !== -1) {
              queue.splice(idx, 1);
              reject(new Error('ABORTED'));
            }
          },
          { once: true }
        );
      }
      queue.push(entry);
      drainQueue();
    });
  }

  function abortAllPending(reason = 'ABORTED') {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        item.reject(new Error(reason));
      } catch (_err) {}
    }
  }

  function getCachedSync(rawText) {
    if (typeof rawText !== 'string') return null;
    const clean = rawText.trim();
    if (!clean) return null;
    if (!memCache.has(clean)) return null;
    const cached = memCache.get(clean);
    if (isInvalidCachedOrTranslatedText(cached, clean)) {
      memCache.delete(clean);
      return null;
    }
    return cached;
  }

  async function invokeProviderWithFallback(provider, cleanText, protectedText, savedTokens, signal) {
    const ctx = {
      signal: signal || undefined,
      sourceLang: 'en',
      targetLang: 'ko',
      cleanText,
      protectedText,
      savedTokens,
    };
    const rawOut = await provider.translate(protectedText, ctx);
    if (!rawOut || typeof rawOut !== 'string') return null;
    return restoreIdentifiersInThoughtText(rawOut, savedTokens);
  }

  async function translateText(text, options = {}) {
    if (typeof text !== 'string') return '';
    const clean = text.trim();
    if (!clean || isAlreadyKoreanOrNonEnglish(clean)) return text;

    const cachedHit = getCachedSync(clean);
    if (cachedHit !== null) return cachedHit;

    const signal = options && options.signal ? options.signal : null;
    if (!signal && inflightMap.has(clean)) {
      return inflightMap.get(clean);
    }

    const reqEpoch = epoch;
    const reqEffectiveId = getEffectiveProviderId();

    const runTask = () =>
      enqueue(async () => {
        if (disposed || (signal && signal.aborted)) return text;
        if (epoch !== reqEpoch || getEffectiveProviderId() !== reqEffectiveId) {
          return text;
        }
        const recheck = getCachedSync(clean);
        if (recheck !== null) return recheck;

        const provider = resolveEffectiveProvider();
        if (!provider) return text;

        const { protectedText, savedTokens } = protectIdentifiersInThoughtText(clean);
        let candidate = null;
        try {
          candidate = await invokeProviderWithFallback(provider, clean, protectedText, savedTokens, signal);
        } catch (_err) {
          candidate = null;
        }

        if (signal && signal.aborted) return text;

        if ((!candidate || isInvalidCachedOrTranslatedText(candidate, clean)) && provider.id !== normalizedDefaultId) {
          const fallbackProv = registry.getProvider(normalizedDefaultId);
          if (fallbackProv && fallbackProv.id !== provider.id) {
            try {
              candidate = await invokeProviderWithFallback(fallbackProv, clean, protectedText, savedTokens, signal);
            } catch (_err) {
              candidate = null;
            }
          }
        }

        if (signal && signal.aborted) return text;
        if (candidate && candidate !== clean && !isInvalidCachedOrTranslatedText(candidate, clean)) {
          if (!disposed && epoch === reqEpoch && getEffectiveProviderId() === reqEffectiveId) {
            memCache.set(clean, candidate);
            scheduleSaveCache(reqEpoch);
          }
          return candidate;
        }
        return text;
      }, signal).catch(() => text);

    if (signal) {
      return runTask();
    }

    const p = runTask();
    inflightMap.set(clean, p);
    try {
      return await p;
    } finally {
      if (inflightMap.get(clean) === p) {
        inflightMap.delete(clean);
      }
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }

  function dispose() {
    disposed = true;
    offRegistry();
    abortAllPending('DISPOSED');
    if (saveCacheTimer) {
      clearTimer(saveCacheTimer);
      saveCacheTimer = null;
    }
    inflightMap.clear();
    subscribers.clear();
  }

  hydrateCache();

  return {
    getDesiredProviderId,
    getEffectiveProviderId,
    getEffectiveProvider,
    getEffectiveProviderLabel,
    getPendingCustomProviderId: () => pendingSavedCustomProviderId,
    setProvider,
    syncDesiredProviderFromExternal,
    translateText,
    getCachedSync,
    hydrateCache,
    flushCache,
    clearCache,
    bumpEpoch,
    abortAllPending,
    getCacheSize: () => memCache.size,
    getEpoch: () => epoch,
    getMemCache: () => memCache,
    subscribe,
    dispose,
  };
}

module.exports = {
  createTranslationService,
};
