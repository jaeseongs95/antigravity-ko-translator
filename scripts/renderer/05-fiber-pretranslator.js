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
        if (savedProv && TRANSLATION_ADAPTERS[savedProv]) {
          try {
            localStorage.setItem(PROVIDER_STORAGE_KEY, savedProv);
          } catch (e) {}
          if (savedProv !== activeTranslationProvider) {
            activeTranslationProvider = savedProv;
            if (activeTranslationProvider === 'local-llm') {
              resolveLocalLlmEndpoint().then(() => {
                if (typeof refreshTranslatorSettingsUi === 'function') refreshTranslatorSettingsUi();
              });
            } else {
              resolvedLlmEndpoint = null;
            }
            changed = true;
          }
        } else {
          try {
            if (!localStorage.getItem(PROVIDER_STORAGE_KEY)) {
              localStorage.setItem(PROVIDER_STORAGE_KEY, activeTranslationProvider);
            }
          } catch (e) {}
        }
        const savedShow = items[SHOW_THINKING_STORAGE_KEY];
        if (savedShow !== undefined) {
          const nextShow = savedShow === '1' || savedShow === 'true' || savedShow === true;
          if (nextShow !== showThinkingEnabled) {
            showThinkingEnabled = nextShow;
            verboseStepsEnsured = false;
            try {
              localStorage.setItem(SHOW_THINKING_STORAGE_KEY, showThinkingEnabled ? '1' : '0');
            } catch (e) {}
            ensureVerboseConversationStepsEnabled();
            if (typeof scanTriggerButtonsSync === 'function') {
              scanTriggerButtonsSync(!showThinkingEnabled);
            }
            changed = true;
          }
        }
        const savedTransThinking = items[TRANSLATE_THINKING_STORAGE_KEY];
        if (savedTransThinking !== undefined) {
          const nextTrans =
            savedTransThinking === '1' || savedTransThinking === 'true' || savedTransThinking === true;
          if (nextTrans !== translateThinkingEnabled) {
            translateThinkingEnabled = nextTrans;
            try {
              localStorage.setItem(TRANSLATE_THINKING_STORAGE_KEY, translateThinkingEnabled ? '1' : '0');
            } catch (e) {}
            if (typeof applyTranslateThinkingStateToDom === 'function') {
              applyTranslateThinkingStateToDom();
            }
            changed = true;
          }
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
  window.__agySyncPersistentSettings = loadPersistentTranslatorSettings;

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
    return Boolean(
      pretranslateEnabled && (typeof isTranslateThinkingEnabled !== 'function' || isTranslateThinkingEnabled())
    );
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

  window.__agyGetShowThinking = () => isShowThinkingEnabled();
  window.__agySetShowThinking = (enabled, _fromCrossFrame = false) => {
    showThinkingEnabled = Boolean(enabled);
    verboseStepsEnsured = true;
    try {
      localStorage.setItem(SHOW_THINKING_STORAGE_KEY, showThinkingEnabled ? '1' : '0');
      localStorage.setItem(SHOW_THINKING_INIT_STORAGE_KEY, '1');
    } catch (e) {}
    if (typeof syncShowThinkingDomAttribute === 'function') {
      syncShowThinkingDomAttribute();
    }
    if (window.nativeStorage && typeof window.nativeStorage.updateItems === 'function') {
      try {
        window.nativeStorage.updateItems({
          [SHOW_THINKING_STORAGE_KEY]: showThinkingEnabled ? '1' : '0',
        });
      } catch (e) {}
    }
    const st = resolveUserSettingsStore();
    if (st && typeof st.setPrefValue === 'function') {
      Promise.resolve(st.setPrefValue('verboseConversationSteps', true))
        .then(() => {
          if (typeof refreshTranslatorSettingsUi === 'function') {
            refreshTranslatorSettingsUi();
          }
        })
        .catch(() => {});
    }
    if (typeof refreshTranslatorSettingsUi === 'function') {
      refreshTranslatorSettingsUi();
    }
    if (typeof scanTriggerButtonsSync === 'function') {
      scanTriggerButtonsSync(!showThinkingEnabled);
    }
    if (showThinkingEnabled && typeof scanThoughtBlocks === 'function') {
      scanThoughtBlocks();
    }
    if (!_fromCrossFrame) {
      try {
        document.querySelectorAll('iframe').forEach((ifr) => {
          try {
            const cw = ifr.contentWindow;
            if (cw && cw !== window && typeof cw.__agySetShowThinking === 'function') {
              cw.__agySetShowThinking(showThinkingEnabled, true);
            }
          } catch (e) {}
        });
      } catch (e) {}
      try {
        if (
          window.parent &&
          window.parent !== window &&
          typeof window.parent.__agySetShowThinking === 'function'
        ) {
          window.parent.__agySetShowThinking(showThinkingEnabled, true);
        }
      } catch (e) {}
    }
    return {
      showThinkingEnabled,
    };
  };

  window.__agyGetTranslateThinking = () => isTranslateThinkingEnabled();
  window.__agySetTranslateThinking = (enabled, _fromCrossFrame = false) => {
    translateThinkingEnabled = Boolean(enabled);
    try {
      localStorage.setItem(TRANSLATE_THINKING_STORAGE_KEY, translateThinkingEnabled ? '1' : '0');
    } catch (e) {}
    if (window.nativeStorage && typeof window.nativeStorage.updateItems === 'function') {
      try {
        window.nativeStorage.updateItems({
          [TRANSLATE_THINKING_STORAGE_KEY]: translateThinkingEnabled ? '1' : '0',
        });
      } catch (e) {}
    }
    if (!translateThinkingEnabled && thoughtDebounceTimer) {
      clearTimeout(thoughtDebounceTimer);
      thoughtDebounceTimer = null;
    }
    if (typeof applyTranslateThinkingStateToDom === 'function') {
      applyTranslateThinkingStateToDom();
    }
    if (typeof refreshTranslatorSettingsUi === 'function') {
      refreshTranslatorSettingsUi();
    }
    if (!_fromCrossFrame) {
      try {
        document.querySelectorAll('iframe').forEach((ifr) => {
          try {
            const cw = ifr.contentWindow;
            if (cw && cw !== window && typeof cw.__agySetTranslateThinking === 'function') {
              cw.__agySetTranslateThinking(translateThinkingEnabled, true);
            }
          } catch (e) {}
        });
      } catch (e) {}
      try {
        if (
          window.parent &&
          window.parent !== window &&
          typeof window.parent.__agySetTranslateThinking === 'function'
        ) {
          window.parent.__agySetTranslateThinking(translateThinkingEnabled, true);
        }
      } catch (e) {}
    }
    return {
      translateThinkingEnabled,
    };
  };

  window.__agyGetPretranslate = () => isPretranslateEnabled();
  window.__agySetPretranslate = (enabled, _fromCrossFrame = false) => {
    pretranslateEnabled = Boolean(enabled);
    window.__agyPretranslateStats.enabled = pretranslateEnabled;
    try {
      localStorage.setItem(PRETRANSLATE_STORAGE_KEY, pretranslateEnabled ? '1' : '0');
    } catch (e) {}
    if (window.nativeStorage && typeof window.nativeStorage.updateItems === 'function') {
      try {
        window.nativeStorage.updateItems({
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
    if (!_fromCrossFrame) {
      try {
        document.querySelectorAll('iframe').forEach((ifr) => {
          try {
            const cw = ifr.contentWindow;
            if (cw && cw !== window && typeof cw.__agySetPretranslate === 'function') {
              cw.__agySetPretranslate(pretranslateEnabled, true);
            }
          } catch (e) {}
        });
      } catch (e) {}
      try {
        if (
          window.parent &&
          window.parent !== window &&
          typeof window.parent.__agySetPretranslate === 'function'
        ) {
          window.parent.__agySetPretranslate(pretranslateEnabled, true);
        }
      } catch (e) {}
    }
    return {
      pretranslateEnabled,
      stats: window.__agyPretranslateStats,
    };
  };
