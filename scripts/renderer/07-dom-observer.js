// Module: 07-dom-observer.js
// Responsibility: Streaming Thinking block DOM renderer, static UI DOM tree walker, MutationObserver, and cleanup lifecycle.
  function tryTranslateBlockElementSync(origEl) {
    if (origEl.tagName === 'UL' || origEl.tagName === 'OL') {
      const items = Array.from(origEl.querySelectorAll(':scope > li'));
      const syncItems = [];
      for (const li of items) {
        const sLi = tryTranslateBlockElementSync(li);
        if (!sLi) return null;
        syncItems.push(sLi);
      }
      const listClone = origEl.cloneNode(false);
      for (const sLi of syncItems) listClone.appendChild(sLi);
      return listClone;
    }

    const { tokenizedText, savedCodes } = tokenizeBlockClone(origEl);
    if (!tokenizedText || isAlreadyKoreanOrNonEnglish(tokenizedText)) {
      return origEl.cloneNode(true);
    }
    if (memCache.has(tokenizedText)) {
      const cached = memCache.get(tokenizedText);
      if (!isInvalidCachedOrTranslatedText(cached, tokenizedText)) {
        return buildTranslatedElement(origEl, savedCodes, cached);
      }
      memCache.delete(tokenizedText);
    }
    return null;
  }

  async function translateBlockElement(origEl, signal = null) {
    const { tokenizedText, savedCodes } = tokenizeBlockClone(origEl);
    if (!tokenizedText || isAlreadyKoreanOrNonEnglish(tokenizedText)) {
      return { node: origEl.cloneNode(true), translated: true };
    }

    const translatedText = await translateThoughtTextEnToKo(tokenizedText, { signal });
    const isTranslated =
      translatedText !== tokenizedText && !isInvalidCachedOrTranslatedText(translatedText, tokenizedText);
    return {
      node: buildTranslatedElement(origEl, savedCodes, translatedText),
      translated: isTranslated,
    };
  }

  function processTriggerButton(btn) {
    const spans = Array.from(btn.querySelectorAll(':scope > span'));
    const origSpan = spans.find((s) => !s.classList.contains('agy-ko-trigger-label'));
    if (!origSpan) return;

    const rawText = (origSpan.textContent || '').trim();
    const koText = translateStaticUiSync(rawText);
    if (!koText) return;

    origSpan.setAttribute('data-agy-orig-label', '1');
    origSpan.style.display = 'none';
    let koSpan = spans.find((s) => s.classList.contains('agy-ko-trigger-label'));
    if (!koSpan) {
      koSpan = document.createElement('span');
      koSpan.className = origSpan.className + ' agy-ko-trigger-label';
      origSpan.insertAdjacentElement('afterend', koSpan);
    }

    if (koSpan.__lastRawText !== rawText) {
      koSpan.__lastRawText = rawText;
      koSpan.textContent = koText;
    }
  }

  function processCursorEdit(cursorEdit, triggerBtn) {
    const origContainer = Array.from(cursorEdit.children).find(
      (ch) => ch.tagName === 'DIV' && !ch.classList.contains('agy-ko-thought-wrap')
    );
    if (!origContainer) return;

    const blockChildren = Array.from(origContainer.children).filter(
      (el) => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT'
    );

    const rawSnapshot = (
      blockChildren.length > 0
        ? blockChildren.map((ch) => (ch.textContent || '').trim()).filter(Boolean).join('\n\n')
        : (origContainer.textContent || '').trim()
    ).trim();
    if (!rawSnapshot) return;

    const hasEnglishBlock =
      blockChildren.length > 0
        ? blockChildren.some((ch) => !isAlreadyKoreanOrNonEnglish(ch.textContent || ''))
        : !isAlreadyKoreanOrNonEnglish(rawSnapshot);

    if (!hasEnglishBlock) {
      if (cursorEdit.__agyAbortCtrl) {
        cursorEdit.__agyAbortCtrl.abort();
        delete cursorEdit.__agyAbortCtrl;
      }
      if (cursorEdit.__agyStreamDebounce) {
        clearTimeout(cursorEdit.__agyStreamDebounce);
        delete cursorEdit.__agyStreamDebounce;
      }
      const oldWrap = cursorEdit.querySelector(':scope > .agy-ko-thought-wrap');
      if (oldWrap) oldWrap.remove();
      cursorEdit.removeAttribute('data-agy-ko-ready');
      cursorEdit.__agyLastSnapshot = rawSnapshot;
      delete cursorEdit.__agyPendingSnapshot;
      if (triggerBtn) processTriggerButton(triggerBtn);
      return;
    }

    if (
      (cursorEdit.__agyLastSnapshot === rawSnapshot && cursorEdit.getAttribute('data-agy-ko-ready') === '1') ||
      cursorEdit.__agyPendingSnapshot === rawSnapshot
    ) {
      if (triggerBtn) processTriggerButton(triggerBtn);
      return;
    }

    // Cancel any previous streaming snapshot's in-flight/queued requests immediately (IMP-004)
    if (cursorEdit.__agyAbortCtrl) {
      cursorEdit.__agyAbortCtrl.abort();
      delete cursorEdit.__agyAbortCtrl;
    }
    if (cursorEdit.__agyStreamDebounce) {
      clearTimeout(cursorEdit.__agyStreamDebounce);
      delete cursorEdit.__agyStreamDebounce;
    }

    let wrap = cursorEdit.querySelector(':scope > .agy-ko-thought-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = origContainer.className + ' agy-ko-thought-wrap';
      cursorEdit.appendChild(wrap);
    }

    const prevWrapChildren = Array.from(wrap.children);

    if (blockChildren.length > 0) {
      const nextFragment = document.createDocumentFragment();
      const slots = blockChildren.map((ch, idx) => {
        const syncNode = tryTranslateBlockElementSync(ch);
        let initialNode = syncNode;
        if (!initialNode) {
          const prevSlot = prevWrapChildren[idx];
          if (prevSlot && /[가-힣]/.test(prevSlot.textContent || '')) {
            initialNode = prevSlot.cloneNode(true);
          } else {
            initialNode = ch.cloneNode(true);
          }
        }
        nextFragment.appendChild(initialNode);
        return { orig: ch, slot: initialNode, alreadyDone: !!syncNode };
      });

      wrap.innerHTML = '';
      wrap.appendChild(nextFragment);
      cursorEdit.setAttribute('data-agy-ko-ready', '1');
      if (triggerBtn) processTriggerButton(triggerBtn);

      const pendingSlots = slots.filter((s) => !s.alreadyDone);
      if (pendingSlots.length === 0) {
        cursorEdit.__agyLastSnapshot = rawSnapshot;
        delete cursorEdit.__agyPendingSnapshot;
        return;
      }

      cursorEdit.__agyPendingSnapshot = rawSnapshot;
      cursorEdit.__agyStreamDebounce = setTimeout(async () => {
        delete cursorEdit.__agyStreamDebounce;
        if (cursorEdit.__agyPendingSnapshot !== rawSnapshot) return;
        const abortCtrl = new AbortController();
        cursorEdit.__agyAbortCtrl = abortCtrl;
        let allTranslated = true;

        try {
          await Promise.all(
            pendingSlots.map(async ({ orig, slot }) => {
              if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) {
                allTranslated = false;
                return;
              }
              if (orig.tagName === 'UL' || orig.tagName === 'OL') {
                const listClone = orig.cloneNode(false);
                const items = Array.from(orig.querySelectorAll(':scope > li'));
                const itemResults = await Promise.all(
                  items.map((li) => translateBlockElement(li, abortCtrl.signal))
                );
                if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) {
                  allTranslated = false;
                  return;
                }
                for (const res of itemResults) {
                  if (!res.translated) allTranslated = false;
                  listClone.appendChild(res.node);
                }
                if (slot.parentNode === wrap) wrap.replaceChild(listClone, slot);
              } else {
                const res = await translateBlockElement(orig, abortCtrl.signal);
                if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) {
                  allTranslated = false;
                  return;
                }
                if (!res.translated) allTranslated = false;
                if (slot.parentNode === wrap) wrap.replaceChild(res.node, slot);
              }
            })
          );

          if (!abortCtrl.signal.aborted && cursorEdit.__agyPendingSnapshot === rawSnapshot) {
            delete cursorEdit.__agyPendingSnapshot;
            if (allTranslated) {
              cursorEdit.__agyLastSnapshot = rawSnapshot;
            }
            cursorEdit.setAttribute('data-agy-ko-ready', '1');
          }
          if (triggerBtn) processTriggerButton(triggerBtn);
        } finally {
          if (cursorEdit.__agyAbortCtrl === abortCtrl) {
            delete cursorEdit.__agyAbortCtrl;
          }
          if (cursorEdit.__agyPendingSnapshot === rawSnapshot && cursorEdit.__agyLastSnapshot !== rawSnapshot) {
            delete cursorEdit.__agyPendingSnapshot;
          }
        }
      }, 150);
    } else {
      const p = document.createElement('p');
      p.textContent = rawSnapshot;
      const syncNode = tryTranslateBlockElementSync(p);
      if (syncNode) {
        wrap.innerHTML = '';
        wrap.appendChild(syncNode);
        cursorEdit.setAttribute('data-agy-ko-ready', '1');
        cursorEdit.__agyLastSnapshot = rawSnapshot;
        delete cursorEdit.__agyPendingSnapshot;
        if (triggerBtn) processTriggerButton(triggerBtn);
        return;
      }

      if (wrap.children.length === 0) {
        wrap.appendChild(p.cloneNode(true));
      }
      cursorEdit.setAttribute('data-agy-ko-ready', '1');
      cursorEdit.__agyPendingSnapshot = rawSnapshot;

      cursorEdit.__agyStreamDebounce = setTimeout(async () => {
        delete cursorEdit.__agyStreamDebounce;
        if (cursorEdit.__agyPendingSnapshot !== rawSnapshot) return;
        const abortCtrl = new AbortController();
        cursorEdit.__agyAbortCtrl = abortCtrl;
        try {
          const res = await translateBlockElement(p, abortCtrl.signal);
          if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) return;
          wrap.innerHTML = '';
          wrap.appendChild(res.node);
          delete cursorEdit.__agyPendingSnapshot;
          if (res.translated) {
            cursorEdit.__agyLastSnapshot = rawSnapshot;
          }
          cursorEdit.setAttribute('data-agy-ko-ready', '1');
          if (triggerBtn) processTriggerButton(triggerBtn);
        } finally {
          if (cursorEdit.__agyAbortCtrl === abortCtrl) {
            delete cursorEdit.__agyAbortCtrl;
          }
          if (cursorEdit.__agyPendingSnapshot === rawSnapshot && cursorEdit.__agyLastSnapshot !== rawSnapshot) {
            delete cursorEdit.__agyPendingSnapshot;
          }
        }
      }, 150);
    }
  }

  // Excludes:
  // 1) Statusbar (`.agy-ctx-statusbar`, `.agy-ctx-modal-backdrop`)
  // 2) Input box toolbar (`[data-testid="agent-input-box"]`, `[data-testid="model-selector-trigger"]`, `[data-testid="permissions-preset-selector"]`)
  // 3) Thinking/Worked trigger buttons (handled by non-destructive sibling spans)
  // 4) Chat messages, code blocks, editors, terminals, file links
  function isExcludedFromStaticUiLocalization(el, forAttributes = false) {
    if (!el || !el.closest) return true;
    const baseExcluded =
      'style, script, code, pre, [contenteditable="true"], .monaco-editor, .xterm, ' +
      '.agy-ctx-statusbar, .agy-ctx-modal-backdrop, .agy-ko-settings-root, #agy-ko-translator-modal, ' +
      '[data-testid="agent-input-box"], [data-testid="model-selector-trigger"], [data-testid="permissions-preset-selector"], ' +
      'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], ' +
      '[data-testid="planner-response-text"], [data-testid="user-message-bubble"], ' +
      '[data-uri], [data-quotable-inline="true"], .cursor-edit';
    const selector = forAttributes ? baseExcluded : 'textarea, ' + baseExcluded;
    if (el.closest(selector)) {
      return true;
    }
    const testId = el.getAttribute('data-testid') || el.closest('[data-testid]')?.getAttribute('data-testid');
    if (testId === 'conversation-row-sidebar') {
      if (forAttributes && el.tagName === 'BUTTON') return false;
      if (!forAttributes && el.closest('[data-screenshot-volatile="true"]')) return false;
      return true;
    }
    if (
      testId === 'breadcrumb-segment' ||
      testId === 'project-header'
    ) {
      return true;
    }
    return false;
  }

  function localizeAttributesInRoot(rootNode) {
    if (!rootNode || !rootNode.querySelectorAll) return;
    const els = rootNode.querySelectorAll('input[placeholder], textarea[placeholder], [title], [aria-label]');
    for (const el of els) {
      if (isExcludedFromStaticUiLocalization(el, true)) continue;
      for (const attr of ['placeholder', 'title', 'aria-label']) {
        const val = el.getAttribute(attr);
        if (!val) continue;
        const trimmed = val.trim();
        if (!trimmed) continue;
        const ko = translateStaticUiSync(trimmed);
        if (ko && ko !== trimmed) {
          let origMap = {};
          try {
            origMap = JSON.parse(el.getAttribute('data-agy-orig-attr') || '{}');
          } catch (e) {}
          if (origMap[attr] === undefined) {
            origMap[attr] = val;
            el.setAttribute('data-agy-orig-attr', JSON.stringify(origMap));
          }
          el.setAttribute(attr, ko);
        }
      }
    }
  }

  function localizeQuestionAndPermissionWidgets(rootNode) {
    if (!rootNode || !rootNode.querySelectorAll) return;
    const targets = rootNode.querySelectorAll(
      '[data-testid="ask-question-header-text"] p, ' +
        '[data-testid="ask-question-header-text"] span, ' +
        '[data-testid="ask-question-option-text"] p, ' +
        '[data-testid="ask-question-option-text"] span, ' +
        '[data-testid="ask-question-option-hover-card"] p, ' +
        '[data-testid="ask-question-option-hover-card"] span, ' +
        'p.text-xs.text-secondary-foreground.leading-relaxed'
    );
    for (const el of targets) {
      if (el.children.length > 0 && el.querySelector('p, div, ul, ol')) continue;
      const raw = (el.textContent || '').trim();
      if (!raw) continue;
      const syncKo = translateStaticUiSync(raw);
      if (syncKo && syncKo !== raw) {
        if (el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE) {
          const tn = el.firstChild;
          if (!tn.__agyOrigValue) tn.__agyOrigValue = tn.nodeValue;
          tn.__agyKoApplied = syncKo;
          tn.nodeValue = syncKo;
        } else {
          el.textContent = syncKo;
        }
        continue;
      }
      if (!isAlreadyKoreanOrNonEnglish(raw) && el.__agyDynamicSource !== raw) {
        el.__agyDynamicSource = raw;
        translateThoughtTextEnToKo(raw).then((ko) => {
          if (!ko || ko === raw || !el.isConnected) return;
          if ((el.textContent || '').trim() !== raw) return;
          if (el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE) {
            const tn = el.firstChild;
            if (!tn.__agyOrigValue) tn.__agyOrigValue = tn.nodeValue;
            tn.__agyKoApplied = ko;
            tn.nodeValue = ko;
          } else {
            el.textContent = ko;
          }
        });
      }
    }
  }

  function localizeStaticUiInRoot(rootNode) {
    if (!rootNode) return;
    localizeAttributesInRoot(rootNode);
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const parent = textNode.parentElement;
      if (!parent || isExcludedFromStaticUiLocalization(parent)) continue;
      if (
        parent.getAttribute('data-agy-orig-label') === '1' ||
        parent.classList.contains('agy-ko-trigger-label')
      ) {
        continue;
      }

      const raw = textNode.nodeValue;
      if (!raw) continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const btn = parent.closest('button');
      const isStandaloneNewBtn =
        !!btn &&
        !btn.closest('[role="menu"], [role="listbox"], [role="menuitem"]') &&
        ((btn.textContent || '').trim() === 'New' || (btn.textContent || '').trim() === '새로 만들기');

      if (textNode.__agyOrigValue && textNode.__agyOrigValue.trim() === 'New' && !isStandaloneNewBtn) {
        textNode.nodeValue = textNode.__agyOrigValue;
        delete textNode.__agyOrigValue;
        delete textNode.__agyKoApplied;
        continue;
      }

      if (textNode.__agyKoApplied === trimmed && !/^\(권장\)\s+[A-Za-z]/.test(trimmed)) continue;

      const syncKo = trimmed === 'New' ? (isStandaloneNewBtn ? '새로 만들기' : null) : translateStaticUiSync(trimmed);
      if (syncKo && syncKo !== trimmed) {
        const leading = raw.match(/^\s*/)[0];
        const trailing = raw.match(/\s*$/)[0];
        const nextVal = leading + syncKo + trailing;
        if (!textNode.__agyOrigValue) textNode.__agyOrigValue = raw;
        textNode.__agyKoApplied = syncKo;
        textNode.nodeValue = nextVal;
      }
    }
    localizeQuestionAndPermissionWidgets(rootNode);
  }

  function scanTriggerButtonsSync() {
    ensureStyle();
    const thinkingBtns = document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]');
    for (const btn of thinkingBtns) {
      processTriggerButton(btn);
    }
    const workedBtns = document.querySelectorAll('button[data-testid="worked-for-collapsible"]');
    for (const btn of workedBtns) {
      processTriggerButton(btn);
    }
  }

  function retranslateVisibleThoughts(clearCache = false) {
    if (clearCache) {
      memCache.clear();
      inflightMap.clear();
      try {
        localStorage.removeItem(CACHE_STORAGE_KEY);
      } catch (e) {}
    }
    document.querySelectorAll('.cursor-edit').forEach((el) => {
      if (el.__agyAbortCtrl) {
        try {
          el.__agyAbortCtrl.abort();
        } catch (e) {}
        delete el.__agyAbortCtrl;
      }
      if (el.__agyStreamDebounce) {
        clearTimeout(el.__agyStreamDebounce);
        delete el.__agyStreamDebounce;
      }
      delete el.__agyLastSnapshot;
      delete el.__agyPendingSnapshot;
      const wrap = el.querySelector(':scope > .agy-ko-thought-wrap');
      if (wrap) {
        Array.from(wrap.children).forEach((ch) => ch.removeAttribute('data-agy-src'));
      }
    });
    scanThoughtBlocks();
    refreshTranslatorSettingsUi();
    return {
      clearedCache: Boolean(clearCache),
      cacheSize: memCache.size,
      provider: activeTranslationProvider,
    };
  }
  window.__agyRetranslateVisibleThoughts = retranslateVisibleThoughts;

  function scanThoughtBlocks() {
    scanTriggerButtonsSync();
    const allCursorEdits = document.querySelectorAll('.cursor-edit');
    for (const cursorEdit of allCursorEdits) {
      const container = cursorEdit.closest('.relative') || cursorEdit.parentElement;
      const btn = container
        ? container.querySelector('button[data-testid="thinking-collapsible-trigger"]')
        : null;
      processCursorEdit(cursorEdit, btn);
    }
    if (isPretranslateEnabled()) {
      pretranslateCollapsedThoughtsInBackground();
    }
  }

  function scanAll() {
    ensureStyle();
    if (document.body) {
      localizeStaticUiInRoot(document.body);
      ensureNativeSettingsModalIntegration();
    }
    scanThoughtBlocks();
  }

  // Coalesce DOM mutations into a fast 16ms pass (works even when window is in background)
  let scanTimerScheduled = false;

  function scheduleCoalescedScan() {
    if (!scanTimerScheduled) {
      scanTimerScheduled = true;
      setTimeout(() => {
        scanTimerScheduled = false;
        if (disposed) return;
        if (document.body) {
          localizeStaticUiInRoot(document.body);
          ensureNativeSettingsModalIntegration();
        }
        scanTriggerButtonsSync();
        const allCursorEdits = document.querySelectorAll('.cursor-edit');
        for (const cursorEdit of allCursorEdits) {
          const container = cursorEdit.closest('.relative') || cursorEdit.parentElement;
          const btn = container
            ? container.querySelector('button[data-testid="thinking-collapsible-trigger"]')
            : null;
          processCursorEdit(cursorEdit, btn);
        }
      }, 16);
    }
    if (isPretranslateEnabled() && !thoughtDebounceTimer) {
      thoughtDebounceTimer = setTimeout(() => {
        thoughtDebounceTimer = null;
        pretranslateCollapsedThoughtsInBackground();
      }, 120);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        scheduleCoalescedScan();
        return;
      }
      if (m.type === 'characterData' && m.target) {
        const parent = m.target.parentElement;
        if (parent && parent.closest('.cursor-edit') && !parent.closest('.agy-ko-thought-wrap')) {
          scheduleCoalescedScan();
          return;
        }
      }
      if (m.type === 'attributes' && m.target && m.target.closest) {
        if (
          !m.target.closest('.agy-ko-settings-root') &&
          m.target.closest('.settings-modal-container, [role="dialog"]')
        ) {
          scheduleCoalescedScan();
          return;
        }
      }
    }
  });

  function startObserver() {
    const root = document.body || document.documentElement;
    if (!root) {
      window.addEventListener('DOMContentLoaded', startObserver, { once: true });
      return;
    }
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    document.querySelectorAll('.agy-ctx-btn-ko-settings, #agy-ko-translator-modal').forEach((el) => el.remove());
    delete window.__agyOpenTranslatorSettingsModal;
    loadPersistentTranslatorSettings();
    if (activeTranslationProvider === 'local-llm') {
      resolveLocalLlmEndpoint().then(() => refreshTranslatorSettingsUi());
    }
    scanAll();
  }

  startObserver();
  const intervalId = setInterval(scanAll, 2500);
  window.__agyKoLocalizerActive = KO_LOCALIZER_VERSION;

  window.__agyKoThoughtCleanup = (fullRestore = false) => {
    disposed = true;
    while (adapterQueue.length > 0) {
      const item = adapterQueue.shift();
      try {
        item.reject(new Error('DISPOSED'));
      } catch (e) {}
    }
    clearInterval(intervalId);
    if (saveCacheTimer) clearTimeout(saveCacheTimer);
    if (thoughtDebounceTimer) clearTimeout(thoughtDebounceTimer);
    if (settingsFeedbackTimer) clearTimeout(settingsFeedbackTimer);
    observer.disconnect();
    delete window.__agyKoLocalizerActive;
    document.querySelectorAll('.cursor-edit').forEach((el) => {
      if (el.__agyAbortCtrl) {
        try {
          el.__agyAbortCtrl.abort();
        } catch (e) {}
        delete el.__agyAbortCtrl;
      }
      if (el.__agyStreamDebounce) {
        clearTimeout(el.__agyStreamDebounce);
        delete el.__agyStreamDebounce;
      }
      delete el.__agyLastSnapshot;
      delete el.__agyPendingSnapshot;
    });
    document
      .querySelectorAll(
        '#agy-ko-translator-modal, #agy-ko-settings-card, #agy-ko-settings-pane, .agy-ctx-btn-ko-settings, button[data-testid="settings-nav-item-KoTranslator"]'
      )
      .forEach((el) => {
        if (el.getAttribute('data-testid') === 'settings-nav-item-KoTranslator' && el.parentElement) {
          el.parentElement.remove();
        } else {
          el.remove();
        }
      });
    document.querySelectorAll('[data-agy-prev-display]').forEach((el) => {
      el.style.display = el.getAttribute('data-agy-prev-display');
      el.removeAttribute('data-agy-prev-display');
    });
    if (fullRestore) {
      const st = document.getElementById(STYLE_ID);
      if (st) st.remove();
      document.querySelectorAll('.agy-ko-thought-wrap, .agy-ko-trigger-label').forEach((el) => el.remove());
      document.querySelectorAll('[data-agy-orig-label]').forEach((el) => {
        el.removeAttribute('data-agy-orig-label');
        el.style.display = '';
      });
      document.querySelectorAll('.cursor-edit[data-agy-ko-ready]').forEach((el) => {
        el.removeAttribute('data-agy-ko-ready');
      });
      restoreAllMutatedNodes();
    }
  };
