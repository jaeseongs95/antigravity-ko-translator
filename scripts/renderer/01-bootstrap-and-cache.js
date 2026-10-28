// Module: 01-bootstrap-and-cache.js
// Responsibility: Version guard, DOM restoration on full disable, and translation cache (memCache / localStorage) persistence.
  const KO_LOCALIZER_VERSION = 'v12.7';
  const DEFAULT_PRETRANSLATE_ENABLED = false;
  const PRETRANSLATE_STORAGE_KEY = 'agy-ko-thought-pretranslate';
  const DEFAULT_TRANSLATION_PROVIDER = 'local-llm';
  const PROVIDER_STORAGE_KEY = 'agy-ko-thought-provider';
  let disposed = false;

  // 1. Restore all previously mutated DOM text nodes and attributes to clean original state (only on full plugin disable)
  function restoreAllMutatedNodes() {
    try {
      if (!document.body) return;
      const restoreWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let rn;
      while ((rn = restoreWalker.nextNode())) {
        if (rn.__agyOrigValue !== undefined) {
          rn.nodeValue = rn.__agyOrigValue;
          delete rn.__agyOrigValue;
          delete rn.__agyKoApplied;
          delete rn.__agyPendingDynamic;
        }
      }

      document.querySelectorAll('[data-agy-orig-attr]').forEach((el) => {
        try {
          const origMap = JSON.parse(el.getAttribute('data-agy-orig-attr') || '{}');
          for (const [k, v] of Object.entries(origMap)) {
            el.setAttribute(k, v);
          }
          el.removeAttribute('data-agy-orig-attr');
        } catch (e) {}
      });
    } catch (e) {}
  }

  const CACHE_STORAGE_KEY = 'agy-ko-thought-cache-v5';
  const MAX_CACHE_ENTRIES = 3000;
  const memCache = new Map();
  const inflightMap = new Map();

  function isInvalidCachedOrTranslatedText(translated, sourceText) {
    if (!translated || typeof translated !== 'string') return true;
    const t = translated.trim();
    if (!t || !/[가-힣]/.test(t)) return true;
    const src = String(sourceText || '');
    const cjkKanaMatches = t.match(/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g);
    if (cjkKanaMatches && cjkKanaMatches.some((ch) => !src.includes(ch))) {
      return true;
    }
    if (/'(?:s|m|re|ve|ll|d|t)\b[^'\n]+'/i.test(t)) {
      return true;
    }
    if (/(?:⟦|\[|【)\s*T\d+\s*(?:⟧|\]|】)/i.test(t)) {
      return true;
    }
    const srcCodeTokens = src.match(/⟦C\d+⟧/g);
    if (srcCodeTokens) {
      for (const tok of srcCodeTokens) {
        const num = tok.slice(2, -1);
        const tokRe = new RegExp(`(?:⟦|\\[|【)\\s*C${num}\\s*(?:⟧|\\]|】)`, 'i');
        if (!tokRe.test(t)) return true;
      }
    }
    return false;
  }

  let saveCacheTimer = null;
  function flushCleanCacheToStorage() {
    if (disposed) return;
    try {
      const entries = Array.from(memCache.entries())
        .filter(([k, v]) => !isInvalidCachedOrTranslatedText(v, k))
        .slice(-MAX_CACHE_ENTRIES);
      const obj = {};
      for (const [k, v] of entries) {
        obj[k] = v;
      }
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  function scheduleSaveCache() {
    if (disposed || saveCacheTimer) return;
    saveCacheTimer = setTimeout(() => {
      saveCacheTimer = null;
      flushCleanCacheToStorage();
    }, 1000);
  }

  function hydrateTranslationCache() {
    try {
      const raw = localStorage.getItem(CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          let purged = 0;
          const validEntries = [];
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string' && v && !isInvalidCachedOrTranslatedText(v, k)) {
              validEntries.push([k, v]);
            } else {
              purged++;
            }
          }
          // Purge incomplete streaming prefix fragments (keys that are strict prefixes of another key and do not end with sentence punctuation)
          const sortedKeys = validEntries.map(([k]) => k).sort();
          const prefixFragmentSet = new Set();
          for (let i = 0; i < sortedKeys.length - 1; i++) {
            const cur = sortedKeys[i];
            const next = sortedKeys[i + 1];
            if (next.length > cur.length && next.startsWith(cur) && !/[.!?:)"'\]]$/.test(cur.trim())) {
              prefixFragmentSet.add(cur);
            }
          }
          for (const [k, v] of validEntries) {
            if (prefixFragmentSet.has(k)) {
              purged++;
            } else {
              memCache.set(k, v);
            }
          }
          if (purged > 0) {
            flushCleanCacheToStorage();
          }
        }
      }
    } catch (e) {}
  }

  function prepareBootstrapLifecycle() {
    if (
      window.__agyKoLocalizerActive === KO_LOCALIZER_VERSION &&
      window.__agyKoThoughtCleanup &&
      typeof window.__agyRetranslateVisibleThoughts === 'function'
    ) {
      if (
        window.__agyLastDefaultPretranslate !== undefined &&
        window.__agyLastDefaultPretranslate !== DEFAULT_PRETRANSLATE_ENABLED &&
        typeof window.__agySetPretranslate === 'function'
      ) {
        window.__agyLastDefaultPretranslate = DEFAULT_PRETRANSLATE_ENABLED;
        window.__agySetPretranslate(DEFAULT_PRETRANSLATE_ENABLED);
      }
      if (
        window.__agyLastDefaultProvider !== undefined &&
        window.__agyLastDefaultProvider !== DEFAULT_TRANSLATION_PROVIDER &&
        typeof window.__agySetTranslationProvider === 'function'
      ) {
        window.__agyLastDefaultProvider = DEFAULT_TRANSLATION_PROVIDER;
        window.__agySetTranslationProvider(DEFAULT_TRANSLATION_PROVIDER);
      }
      return false;
    }
    if (window.__agyKoThoughtCleanup) {
      try { window.__agyKoThoughtCleanup(false); } catch (e) {}
    }
    window.__agyLastDefaultPretranslate = DEFAULT_PRETRANSLATE_ENABLED;
    window.__agyLastDefaultProvider = DEFAULT_TRANSLATION_PROVIDER;
    hydrateTranslationCache();
    return true;
  }
