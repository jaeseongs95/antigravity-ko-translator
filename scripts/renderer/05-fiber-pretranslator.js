// Module: 05-fiber-pretranslator.js
// Responsibility: Persistent settings hydration and React Fiber background pre-translation for collapsed Thinking blocks.
  let pretranslateEnabled = DEFAULT_PRETRANSLATE_ENABLED;
  try {
    const savedPre = localStorage.getItem(PRETRANSLATE_STORAGE_KEY);
    if (savedPre === '1' || savedPre === 'true') {
      pretranslateEnabled = true;
    } else if (savedPre === '0' || savedPre === 'false') {
      pretranslateEnabled = false;
    } else {
      localStorage.setItem(PRETRANSLATE_STORAGE_KEY, pretranslateEnabled ? '1' : '0');
    }
  } catch (e) {}

  async function loadPersistentTranslatorSettings() {
    if (window.nativeStorage && typeof window.nativeStorage.getItems === 'function') {
      try {
        const items = await window.nativeStorage.getItems();
        if (!items) return;
        let changed = false;
        const savedProv = items[PROVIDER_STORAGE_KEY];
        if (savedProv && TRANSLATION_ADAPTERS[savedProv] && savedProv !== activeTranslationProvider) {
          activeTranslationProvider = savedProv;
          try {
            localStorage.setItem(PROVIDER_STORAGE_KEY, activeTranslationProvider);
          } catch (e) {}
          changed = true;
        }
        const savedPre = items[PRETRANSLATE_STORAGE_KEY];
        if (savedPre !== undefined) {
          const nextPre = savedPre === '1' || savedPre === 'true' || savedPre === true;
          if (nextPre !== pretranslateEnabled) {
            pretranslateEnabled = nextPre;
            window.__agyPretranslateStats.enabled = pretranslateEnabled;
            try {
              localStorage.setItem(PRETRANSLATE_STORAGE_KEY, pretranslateEnabled ? '1' : '0');
            } catch (e) {}
            changed = true;
          }
        }
        if (changed) {
          refreshTranslatorSettingsUi();
        }
      } catch (e) {}
    }
  }

  const pretranslatedRawSet = new Set();
  let pretranslateRunning = false;
  let thoughtDebounceTimer = null;
  window.__agyPretranslateStats = {
    enabled: pretranslateEnabled,
    scannedThoughts: 0,
    queuedSegments: 0,
    completedSegments: 0,
  };

  function isPretranslateEnabled() {
    return Boolean(pretranslateEnabled);
  }

  function collectHiddenThinkingStringsFromFiber() {
    const found = [];
    if (!isPretranslateEnabled()) return found;
    try {
      const rootEl = document.querySelector('#root, #app') || (document.body && document.body.firstElementChild);
      if (!rootEl) return found;
      const fiberKey = Object.keys(rootEl).find(
        (k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')
      );
      const startFiber = fiberKey ? rootEl[fiberKey] : null;
      const seenObj = new WeakSet();

      function scanObj(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 7) return;
        if (seenObj.has(obj) || obj instanceof Node || obj instanceof Window) return;
        seenObj.add(obj);
        if (typeof obj.thinking === 'string') {
          const t = obj.thinking.trim();
          if (t.length > 5 && !pretranslatedRawSet.has(t)) {
            found.push(t);
          }
        }
        if (Array.isArray(obj)) {
          for (let i = 0; i < Math.min(obj.length, 150); i++) scanObj(obj[i], depth + 1);
          return;
        }
        const keys = Object.keys(obj);
        for (let i = 0; i < Math.min(keys.length, 50); i++) {
          const k = keys[i];
          if (
            k.startsWith('_') ||
            k === 'children' ||
            k === 'return' ||
            k === 'sibling' ||
            k === 'child' ||
            k === 'stateNode'
          ) {
            continue;
          }
          try {
            scanObj(obj[k], depth + 1);
          } catch (e) {}
        }
      }

      if (startFiber) {
        const stack = [startFiber];
        const visited = new Set();
        while (stack.length > 0) {
          const node = stack.pop();
          if (!node || visited.has(node)) continue;
          visited.add(node);
          if (node.memoizedProps) scanObj(node.memoizedProps, 0);
          if (node.memoizedState) {
            let st = node.memoizedState;
            let sc = 0;
            while (st && sc < 12) {
              if (st.memoizedState) scanObj(st.memoizedState, 0);
              st = st.next;
              sc++;
            }
          }
          if (node.child) stack.push(node.child);
          if (node.sibling) stack.push(node.sibling);
        }
      }

      if (window.__agyStore && typeof window.__agyStore.getState === 'function') {
        try {
          scanObj(window.__agyStore.getState(), 0);
        } catch (e) {}
      }
    } catch (e) {}
    return found;
  }

  async function pretranslateCollapsedThoughtsInBackground() {
    if (disposed || pretranslateRunning || !isPretranslateEnabled()) return;
    const rawList = collectHiddenThinkingStringsFromFiber();
    if (rawList.length === 0) return;

    pretranslateRunning = true;
    try {
      const uniqueNew = Array.from(new Set(rawList)).reverse();
      for (const raw of uniqueNew) {
        if (disposed || !isPretranslateEnabled()) break;
        pretranslatedRawSet.add(raw);
        window.__agyPretranslateStats.scannedThoughts++;
        const segments = extractTokenizedSegmentsFromMarkdown(raw);
        for (const seg of segments) {
          if (disposed || !isPretranslateEnabled()) break;
          if (!memCache.has(seg)) {
            window.__agyPretranslateStats.queuedSegments++;
            await translateThoughtTextEnToKo(seg);
            window.__agyPretranslateStats.completedSegments++;
          }
        }
      }
    } finally {
      pretranslateRunning = false;
    }
  }

  window.__agyGetPretranslate = () => isPretranslateEnabled();
  window.__agySetPretranslate = (enabled) => {
    pretranslateEnabled = Boolean(enabled);
    window.__agyPretranslateStats.enabled = pretranslateEnabled;
    try {
      localStorage.setItem(PRETRANSLATE_STORAGE_KEY, pretranslateEnabled ? '1' : '0');
    } catch (e) {}
    if (window.nativeStorage && typeof window.nativeStorage.updateItems === 'function') {
      try {
        window.nativeStorage.updateItems({
          [PROVIDER_STORAGE_KEY]: activeTranslationProvider,
          [PRETRANSLATE_STORAGE_KEY]: pretranslateEnabled ? '1' : '0',
        });
      } catch (e) {}
    }
    if (!pretranslateEnabled) {
      if (thoughtDebounceTimer) {
        clearTimeout(thoughtDebounceTimer);
        thoughtDebounceTimer = null;
      }
    } else {
      pretranslateCollapsedThoughtsInBackground();
    }
    if (typeof refreshTranslatorSettingsUi === 'function') {
      refreshTranslatorSettingsUi();
    }
    try {
      document.querySelectorAll('iframe').forEach((ifr) => {
        try {
          const cw = ifr.contentWindow;
          if (cw && cw !== window && typeof cw.__agySetPretranslate === 'function') {
            cw.__agySetPretranslate(pretranslateEnabled);
          }
        } catch (e) {}
      });
    } catch (e) {}
    return {
      pretranslateEnabled,
      stats: window.__agyPretranslateStats,
    };
  };
