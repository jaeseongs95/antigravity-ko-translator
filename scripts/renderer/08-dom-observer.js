// Module: 08-dom-observer.js
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

  function extractTriggerSpanRawText(origSpan) {
    if (!origSpan) return '';
    if (origSpan.querySelector && origSpan.querySelector('[data-slot-out]')) {
      const clone = origSpan.cloneNode(true);
      if (clone.querySelectorAll) {
        clone.querySelectorAll('[data-slot-out]').forEach((el) => el.remove());
      }
      return (clone.textContent || '').trim();
    }
    return (origSpan.textContent || '').trim();
  }

  function processTriggerButton(btn) {
    const spans = Array.from(btn.querySelectorAll(':scope > span'));
    const origSpan = spans.find((s) => !s.classList.contains('agy-ko-trigger-label'));
    if (!origSpan) return;

    const liveText = extractTriggerSpanRawText(origSpan);
    const rawText = liveText || (origSpan.__agyOrigLabelText || '').trim();
    const koText = translateStaticUiSync(rawText);
    if (!koText) return;

    origSpan.__agyOrigLabelText = rawText;
    if (origSpan.getAttribute('data-agy-orig-label') !== '1') {
      origSpan.setAttribute('data-agy-orig-label', '1');
    }
    if (origSpan.style.display !== 'none') {
      origSpan.style.display = 'none';
    }
    // IMPORTANT: Never clear or overwrite origSpan.textContent!
    // React mounts child fibers (<z6b>, <HZb>, <CZb>) inside origSpan; detaching them via
    // origSpan.textContent = '' triggers NotFoundError (removeChild) and unmounts #root (black screen).
    if (!liveText && origSpan.__agyOrigLabelText && (!origSpan.childNodes || origSpan.childNodes.length === 0)) {
      origSpan.textContent = origSpan.__agyOrigLabelText;
    }
    const expectedKoClass = (origSpan.className ? origSpan.className + ' ' : '') + 'agy-ko-trigger-label';
    let koSpan = spans.find((s) => s.classList.contains('agy-ko-trigger-label'));
    if (!koSpan) {
      koSpan = document.createElement('span');
      koSpan.className = expectedKoClass;
      origSpan.insertAdjacentElement('afterend', koSpan);
    } else if (koSpan.className !== expectedKoClass) {
      koSpan.className = expectedKoClass;
    }

    if (koSpan.__lastRawText !== rawText) {
      koSpan.__lastRawText = rawText;
      koSpan.textContent = koText;
    }
  }

  function restoreOriginalCursorEdits() {
    while (adapterQueue.length > 0) {
      const item = adapterQueue.shift();
      try {
        item.reject(new Error('TRANSLATE_THINKING_DISABLED'));
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
      if (wrap) wrap.remove();
      el.removeAttribute('data-agy-ko-ready');
    });
  }

  function applyTranslateThinkingStateToDom() {
    const enabled = typeof isTranslateThinkingEnabled === 'function' ? isTranslateThinkingEnabled() : true;
    if (!enabled) {
      restoreOriginalCursorEdits();
    } else {
      scanThoughtBlocks();
    }
  }

  function processCursorEdit(cursorEdit, triggerBtn) {
    if (typeof isTranslateThinkingEnabled === 'function' && !isTranslateThinkingEnabled()) {
      if (
        cursorEdit.getAttribute('data-agy-ko-ready') === '1' ||
        cursorEdit.querySelector(':scope > .agy-ko-thought-wrap')
      ) {
        if (cursorEdit.__agyAbortCtrl) {
          try {
            cursorEdit.__agyAbortCtrl.abort();
          } catch (e) {}
          delete cursorEdit.__agyAbortCtrl;
        }
        if (cursorEdit.__agyStreamDebounce) {
          clearTimeout(cursorEdit.__agyStreamDebounce);
          delete cursorEdit.__agyStreamDebounce;
        }
        const oldWrap = cursorEdit.querySelector(':scope > .agy-ko-thought-wrap');
        if (oldWrap) oldWrap.remove();
        cursorEdit.removeAttribute('data-agy-ko-ready');
        delete cursorEdit.__agyLastSnapshot;
        delete cursorEdit.__agyPendingSnapshot;
      }
      if (triggerBtn) processTriggerButton(triggerBtn);
      return;
    }

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
      const slots = blockChildren.map((ch, idx) => {
        const chSrc = (ch.textContent || '').trim();
        const prevSlot = prevWrapChildren[idx];
        if (
          prevSlot &&
          prevSlot.getAttribute('data-agy-src') === chSrc &&
          /[가-힣]/.test(prevSlot.textContent || '')
        ) {
          return { orig: ch, slot: prevSlot, alreadyDone: true, src: chSrc };
        }
        const syncNode = tryTranslateBlockElementSync(ch);
        if (syncNode) {
          syncNode.setAttribute('data-agy-src', chSrc);
          if (!prevSlot) {
            wrap.appendChild(syncNode);
          } else if (prevSlot !== syncNode) {
            wrap.replaceChild(syncNode, prevSlot);
          }
          return { orig: ch, slot: syncNode, alreadyDone: true, src: chSrc };
        }
        if (prevSlot && /[가-힣]/.test(prevSlot.textContent || '')) {
          return { orig: ch, slot: prevSlot, alreadyDone: false, src: chSrc };
        }
        if (prevSlot && prevSlot.getAttribute('data-agy-src') === chSrc) {
          return { orig: ch, slot: prevSlot, alreadyDone: false, src: chSrc };
        }
        const initialNode = ch.cloneNode(true);
        initialNode.setAttribute('data-agy-src', chSrc);
        if (!prevSlot) {
          wrap.appendChild(initialNode);
        } else {
          wrap.replaceChild(initialNode, prevSlot);
        }
        return { orig: ch, slot: initialNode, alreadyDone: false, src: chSrc };
      });
      while (wrap.children.length > slots.length) {
        wrap.lastElementChild.remove();
      }
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
            pendingSlots.map(async ({ orig, slot, src }) => {
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
                listClone.setAttribute('data-agy-src', src);
                if (slot.parentNode === wrap) wrap.replaceChild(listClone, slot);
              } else {
                const res = await translateBlockElement(orig, abortCtrl.signal);
                if (abortCtrl.signal.aborted || cursorEdit.__agyPendingSnapshot !== rawSnapshot) {
                  allTranslated = false;
                  return;
                }
                if (!res.translated) allTranslated = false;
                res.node.setAttribute('data-agy-src', src);
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
        if (wrap.firstElementChild) {
          wrap.replaceChild(syncNode, wrap.firstElementChild);
        } else {
          wrap.appendChild(syncNode);
        }
        while (wrap.children.length > 1) {
          wrap.lastElementChild.remove();
        }
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
          if (wrap.firstElementChild) {
            wrap.replaceChild(res.node, wrap.firstElementChild);
          } else {
            wrap.appendChild(res.node);
          }
          while (wrap.children.length > 1) {
            wrap.lastElementChild.remove();
          }
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
      '[data-testid="model-selector-trigger"], [data-testid="permissions-preset-selector"], ' +
      'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"], ' +
      '[data-testid="planner-response-text"], [data-testid="user-message-bubble"], ' +
      '[data-uri], [data-quotable-inline="true"], .cursor-edit';
    const selector = forAttributes ? baseExcluded : 'textarea, ' + baseExcluded;
    if (el.closest(selector)) {
      return true;
    }
    if (!forAttributes && el.closest('[data-testid="agent-input-box"]')) {
      const txt = (el.textContent || '').trim();
      if (
        el.tagName === 'P' &&
        (txt.startsWith('Ask anything') ||
          txt.startsWith('Message subagent') ||
          txt.startsWith('무엇이든 물어보세요') ||
          txt.startsWith('서브에이전트에게 메시지 보내기'))
      ) {
        return false;
      }
      return true;
    }
    if (
      !forAttributes &&
      el.classList &&
      (el.classList.contains('agy-mcp-server-name') || el.classList.contains('agy-mcp-tool-chip'))
    ) {
      return true;
    }
    if (!forAttributes && el.classList && el.classList.contains('agy-mcp-cmd-preview')) {
      const txt = (el.textContent || '').trim();
      if (
        txt !== '(managed by plugin)' &&
        txt !== '(플러그인에서 관리됨)' &&
        txt !== '(empty command)' &&
        txt !== '(빈 명령어)' &&
        !/\[(?:🔑\s*(?:Auth Header Configured|인증 헤더 설정됨)|🔗\s*OAuth(?:\s*Connected|\s*연결됨)?)\]/.test(txt)
      ) {
        return true;
      }
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
          }
        });
      }
    }
  }

  const STATIC_UI_SUBTREE_PRUNE_SELECTOR =
    'style, script, code, pre, textarea, [contenteditable="true"], .monaco-editor, .xterm, ' +
    '.agy-ctx-statusbar, .agy-ctx-modal-backdrop, .agy-ko-settings-root, #agy-ko-translator-modal, ' +
    '[data-testid="model-selector-trigger"], [data-testid="permissions-preset-selector"], ' +
    'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"], ' +
    '[data-testid="planner-response-text"], [data-testid="user-message-bubble"], ' +
    '[data-uri], [data-quotable-inline="true"], .cursor-edit';

  function localizeStaticUiInRoot(rootNode) {
    if (!rootNode) return;
    localizeAttributesInRoot(rootNode);
    const showFilter =
      typeof NodeFilter !== 'undefined' && NodeFilter
        ? (NodeFilter.SHOW_ELEMENT || 1) | (NodeFilter.SHOW_TEXT || 4)
        : 4;
    const walker = document.createTreeWalker(rootNode, showFilter, {
      acceptNode(node) {
        if (!node) return typeof NodeFilter !== 'undefined' && NodeFilter.FILTER_REJECT ? NodeFilter.FILTER_REJECT : 2;
        if (node.nodeType === 1) {
          if (typeof node.matches === 'function' && node.matches(STATIC_UI_SUBTREE_PRUNE_SELECTOR)) {
            return typeof NodeFilter !== 'undefined' && NodeFilter.FILTER_REJECT ? NodeFilter.FILTER_REJECT : 2;
          }
          return typeof NodeFilter !== 'undefined' && NodeFilter.FILTER_SKIP ? NodeFilter.FILTER_SKIP : 3;
        }
        return typeof NodeFilter !== 'undefined' && NodeFilter.FILTER_ACCEPT ? NodeFilter.FILTER_ACCEPT : 1;
      },
    });
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (textNode.nodeType && textNode.nodeType !== 3) continue;
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
    if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
      observer.takeRecords();
    }
  }

  function doesWorkedForButtonContainThinking(btn) {
    if (!btn) return false;
    if (btn.__agyHasThinking) return true;
    try {
      const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
      let cur = fk ? btn[fk] : null;
      for (let i = 0; i < 12 && cur; i++) {
        const segSteps = cur.memoizedProps?.segment?.steps;
        if (Array.isArray(segSteps)) {
          const found = segSteps.some((s) => {
            const val = s?.step?.value;
            return Boolean(val && (val.thinking || val.rawThinking));
          });
          if (found) {
            btn.__agyHasThinking = true;
            return true;
          }
          return false;
        }
        cur = cur.return;
      }
    } catch (e) {}
    return false;
  }

  function doesToolGroupButtonContainThinking(btn) {
    if (!btn) return false;
    if (btn.__agyHasThinking) return true;
    try {
      const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
      let cur = fk ? btn[fk] : null;
      for (let i = 0; i < 12 && cur; i++) {
        const grpSteps = cur.memoizedProps?.steps || cur.memoizedProps?.group?.steps;
        if (Array.isArray(grpSteps)) {
          const found = grpSteps.some((s) => {
            const val = s?.step?.value;
            return Boolean(val && (val.thinking || val.rawThinking));
          });
          if (found) {
            btn.__agyHasThinking = true;
            return true;
          }
          return false;
        }
        cur = cur.return;
      }
    } catch (e) {}
    return false;
  }

  function expandTriggerButtonIfNeeded(btn) {
    if (!btn || btn.getAttribute('aria-expanded') !== 'false' || btn.__agyUserCollapsed) {
      return false;
    }
    btn.__agyAutoExpanded = true;
    if (typeof btn.setAttribute === 'function') {
      btn.setAttribute('data-agy-auto-expanded', '1');
    }
    btn.__agyProgrammaticClick = true;
    try {
      btn.click();
    } catch (e) {
    } finally {
      btn.__agyProgrammaticClick = false;
    }
    return true;
  }

  function collapseTriggerButtonIfNeeded(btn) {
    if (!btn || btn.getAttribute('aria-expanded') !== 'true') {
      return false;
    }
    delete btn.__agyAutoExpanded;
    if (typeof btn.removeAttribute === 'function') {
      btn.removeAttribute('data-agy-auto-expanded');
    }
    btn.__agyProgrammaticClick = true;
    try {
      btn.click();
    } catch (e) {
    } finally {
      btn.__agyProgrammaticClick = false;
    }
    return true;
  }

  function onTriggerButtonClickCapture(e) {
    try {
      if (!e || !e.target || typeof e.target.closest !== 'function') return;
      const btn = e.target.closest(
        'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"]'
      );
      if (!btn || btn.__agyProgrammaticClick || e.isTrusted === false) return;
      const expandedBeforeClick = btn.getAttribute('aria-expanded');
      if (expandedBeforeClick === 'true') {
        btn.__agyUserCollapsed = true;
        if (typeof btn.removeAttribute === 'function') {
          btn.removeAttribute('data-agy-auto-expanded');
        }
      } else if (expandedBeforeClick === 'false') {
        btn.__agyUserCollapsed = false;
      }
    } catch (err) {}
  }

  function isHiddenActiveWorkedForButton(btn) {
    if (!btn) return false;
    if (btn.classList && btn.classList.contains('hidden')) return true;
    try {
      const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
      let cur = fk ? btn[fk] : null;
      for (let i = 0; i < 8 && cur; i++) {
        if (cur.memoizedProps && cur.memoizedProps.triggerVisible === false) {
          return true;
        }
        cur = cur.return;
      }
    } catch (e) {}
    return false;
  }

  function isToolGroupInActiveOrLatestTurn(btn, workedBtns) {
    if (!btn) return false;
    try {
      const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
      let cur = fk ? btn[fk] : null;
      let sawLocalActiveFalse = false;
      for (let i = 0; i < 16 && cur; i++) {
        const mp = cur.memoizedProps;
        if (mp && typeof mp === 'object') {
          if (mp.isLastContainer === true || mp.isLastTurn === true) return true;
          if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
          if (mp.segment && typeof mp.segment === 'object') {
            if (mp.segment.isLatest === true || mp.segment.isActive === true) return true;
            if (mp.segment.isLatest === false || mp.segment.isActive === false) return false;
          }
          // Immediate wrapper (e.g. yhc / G_ at depth <= 6) carries turn/step-local isActive/isRunning,
          // whereas higher container fibers (Lhc/oic) carry conversation-wide isRunning (status === RUNNING).
          if (i <= 6) {
            if (mp.isActive === true) return true;
            if (mp.isActive === false || mp.isRunning === false) {
              sawLocalActiveFalse = true;
            }
          }
        }
        cur = cur.return;
      }
      if (sawLocalActiveFalse && (!Array.isArray(workedBtns) || workedBtns.length === 0)) {
        return false;
      }
    } catch (e) {}
    if (Array.isArray(workedBtns) && workedBtns.length > 0) {
      const lastWorked = workedBtns[workedBtns.length - 1];
      const lastContainer =
        lastWorked && typeof lastWorked.closest === 'function' ? lastWorked.closest('.relative') : null;
      if (lastContainer && typeof lastContainer.contains === 'function' && lastContainer.contains(btn)) {
        return true;
      }
      const anyHistoricalWorkedContains = workedBtns.slice(0, -1).some((wb) => {
        const c = wb && typeof wb.closest === 'function' ? wb.closest('.relative') : null;
        return Boolean(c && typeof c.contains === 'function' && c.contains(btn));
      });
      if (anyHistoricalWorkedContains) {
        return false;
      }
      const lastTrigger = workedBtns[workedBtns.length - 1];
      if (
        lastTrigger &&
        typeof lastTrigger.compareDocumentPosition === 'function' &&
        typeof Node !== 'undefined' &&
        (lastTrigger.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      ) {
        return true;
      }
      return false;
    }
    return false;
  }

  function isThinkingTriggerInActiveOrLatestTurn(btn, workedBtns, thinkingBtns) {
    if (!btn) return false;
    try {
      const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
      let cur = fk ? btn[fk] : null;
      for (let i = 0; i < 16 && cur; i++) {
        const mp = cur.memoizedProps;
        if (mp && typeof mp === 'object') {
          if (mp.isLastContainer === true || mp.isLastTurn === true) return true;
          if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
          if (mp.segment && typeof mp.segment === 'object') {
            if (mp.segment.isLatest === true || mp.segment.isActive === true) return true;
            if (mp.segment.isLatest === false || mp.segment.isActive === false) return false;
          }
          if (i <= 6) {
            if (mp.isActive === true) return true;
            if (mp.isActive === false) return false;
          }
        }
        cur = cur.return;
      }
    } catch (e) {}
    if (Array.isArray(workedBtns) && workedBtns.length > 0) {
      const lastWorked = workedBtns[workedBtns.length - 1];
      const lastContainer =
        lastWorked && typeof lastWorked.closest === 'function' ? lastWorked.closest('.relative') : null;
      if (lastContainer && typeof lastContainer.contains === 'function' && lastContainer.contains(btn)) {
        return true;
      }
      const anyHistoricalWorkedContains = workedBtns.slice(0, -1).some((wb) => {
        const c = wb && typeof wb.closest === 'function' ? wb.closest('.relative') : null;
        return Boolean(c && typeof c.contains === 'function' && c.contains(btn));
      });
      if (anyHistoricalWorkedContains) {
        return false;
      }
      if (
        lastWorked &&
        typeof lastWorked.compareDocumentPosition === 'function' &&
        typeof Node !== 'undefined' &&
        (lastWorked.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      ) {
        return true;
      }
      return false;
    }
    if (Array.isArray(thinkingBtns) && thinkingBtns.length > 0) {
      return btn === thinkingBtns[thinkingBtns.length - 1];
    }
    return false;
  }

  function scanTriggerButtonsSync(forceCollapseAll = false) {
    ensureStyle();
    if (typeof syncShowThinkingDomAttribute === 'function') {
      syncShowThinkingDomAttribute();
    }
    const autoExpand = typeof isShowThinkingEnabled === 'function' ? isShowThinkingEnabled() : true;
    const nativeVerboseSteps =
      typeof isNativeVerboseConversationStepsEnabled === 'function'
        ? isNativeVerboseConversationStepsEnabled()
        : true;
    const workedBtns = Array.from(document.querySelectorAll('button[data-testid="worked-for-collapsible"]'));
    for (let i = 0; i < workedBtns.length; i++) {
      const btn = workedBtns[i];
      const isLastWorked = i === workedBtns.length - 1;
      processTriggerButton(btn);
      if (!nativeVerboseSteps) {
        continue;
      }
      if (isHiddenActiveWorkedForButton(btn)) {
        // Active/latest turn has triggerVisible=false (.hidden on the button).
        // If collapsed, its entire body (all tool & work steps) unmounts while the trigger button itself is hidden!
        // Always keep it expanded regardless of showThinkingEnabled.
        if (btn.getAttribute('aria-expanded') === 'false') {
          btn.__agyUserCollapsed = false;
          expandTriggerButtonIfNeeded(btn);
        }
        continue;
      }
      if (isLastWorked) {
        // D-0005 & D-0013: Keep ONLY the latest/active turn's worked-for-collapsible expanded (unless manually collapsed by the user).
        // Never force-expand historical completed turns' worked-for-collapsible on session switch (prevents multi-frame height jump & ResizeObserver scroll flicker).
        if (btn.getAttribute('aria-expanded') === 'false' && !btn.__agyUserCollapsed) {
          expandTriggerButtonIfNeeded(btn);
        }
      } else if (
        forceCollapseAll &&
        btn.getAttribute('aria-expanded') === 'true' &&
        (btn.__agyAutoExpanded || btn.getAttribute('data-agy-auto-expanded') === '1') &&
        doesWorkedForButtonContainThinking(btn)
      ) {
        collapseTriggerButtonIfNeeded(btn);
      }
    }
    const toolGroupBtns = document.querySelectorAll('button[data-testid="tool-group-collapsible"]');
    for (const btn of toolGroupBtns) {
      processTriggerButton(btn);
      if (
        nativeVerboseSteps &&
        btn.getAttribute('aria-expanded') === 'false' &&
        !btn.__agyUserCollapsed &&
        isToolGroupInActiveOrLatestTurn(btn, workedBtns)
      ) {
        expandTriggerButtonIfNeeded(btn);
      }
    }
    const thinkingBtns = Array.from(document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]'));
    for (const btn of thinkingBtns) {
      processTriggerButton(btn);
      if (autoExpand) {
        if (
          btn.getAttribute('aria-expanded') === 'false' &&
          !btn.__agyUserCollapsed &&
          isThinkingTriggerInActiveOrLatestTurn(btn, workedBtns, thinkingBtns)
        ) {
          expandTriggerButtonIfNeeded(btn);
        }
      } else if (btn.getAttribute('aria-expanded') === 'true') {
        collapseTriggerButtonIfNeeded(btn);
      }
    }
  }

  function retranslateVisibleThoughts(clearCache = false, _fromCrossFrame = false) {
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
    try {
      document.querySelectorAll('iframe').forEach((ifr) => {
        try {
          const cw = ifr.contentWindow;
          if (cw && cw !== window && typeof cw.__agyRetranslateVisibleThoughts === 'function') {
            if (!_fromCrossFrame) cw.__agyRetranslateVisibleThoughts(clearCache, true);
            if (!_fromCrossFrame && window.parent && window.parent !== window && typeof window.parent.__agyRetranslateVisibleThoughts === 'function') {
              window.parent.__agyRetranslateVisibleThoughts(clearCache, true);
            }
          }
        } catch (e) {}
      });
    } catch (e) {}
    return {
      clearedCache: Boolean(clearCache),
      cacheSize: memCache.size,
      provider: activeTranslationProvider,
    };
  }
  window.__agyRetranslateVisibleThoughts = retranslateVisibleThoughts;

  function getTrustedPolicyForRemote() {
    if (window.__agyKoTrustedPolicy) return window.__agyKoTrustedPolicy;
    if (window.trustedTypes && typeof window.trustedTypes.createPolicy === 'function') {
      const names = [
        'agy-ko-translator',
        'agy-ko-translator-' + Date.now(),
        'angular#unsafe-bypass',
        'default',
      ];
      for (const name of names) {
        try {
          const p = window.trustedTypes.createPolicy(name, {
            createHTML: (s) => s,
            createScript: (s) => s,
            createScriptURL: (s) => s,
          });
          window.__agyKoTrustedPolicy = p;
          return p;
        } catch (e) {}
      }
    }
    return null;
  }

  function getRemoteControlComponentInstance(rcEl) {
    if (window.__agyRemoteControlInstance && !window.__agyRemoteControlInstance.destroyed) {
      return window.__agyRemoteControlInstance;
    }
    const isRcInstance = (obj) =>
      Boolean(
        obj &&
          typeof obj === 'object' &&
          !obj.destroyed &&
          (typeof obj.proxyCommand === 'function' ||
            typeof obj.onIframeLoad === 'function' ||
            typeof obj.handleIframeMessage === 'function')
      );
    const extractFromLContext = (lCtx) => {
      if (!lCtx || typeof lCtx !== 'object') return null;
      if (isRcInstance(lCtx)) return lCtx;
      if (isRcInstance(lCtx.component)) return lCtx.component;
      const lView = lCtx.lView;
      if (Array.isArray(lView)) {
        try {
          const tView = lView[1];
          const nodeIndex = typeof lCtx.nodeIndex === 'number' ? lCtx.nodeIndex : -1;
          const tNode = nodeIndex >= 0 && Array.isArray(tView?.data) ? tView.data[nodeIndex] : null;
          if (tNode && typeof tNode.directiveStart === 'number' && typeof tNode.componentOffset === 'number' && tNode.componentOffset > -1) {
            const comp = lView[tNode.directiveStart + tNode.componentOffset];
            if (isRcInstance(comp)) return comp;
          }
        } catch (e) {}
        for (let i = 0; i < Math.min(lView.length, 300); i++) {
          if (isRcInstance(lView[i])) return lView[i];
        }
      }
      return null;
    };
    const searchNgContext = (ctx) => {
      if (!ctx || typeof ctx !== 'object') return null;
      const direct = extractFromLContext(ctx);
      if (direct) return direct;
      const visited = new Set();
      const queue = [ctx];
      let steps = 0;
      while (queue.length > 0 && steps < 400) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object' || visited.has(cur)) continue;
        visited.add(cur);
        steps++;
        const extracted = extractFromLContext(cur);
        if (extracted) return extracted;
        if (Array.isArray(cur)) {
          const scanLen = Math.min(cur.length, 300);
          for (let i = 0; i < scanLen; i++) {
            if (isRcInstance(cur[i])) return cur[i];
          }
          for (let i = 0; i < scanLen; i++) {
            const item = cur[i];
            if (item && typeof item === 'object' && (Array.isArray(item) || isRcInstance(item.component))) {
              queue.push(item);
            }
          }
        } else {
          for (const k of ['component', 'lView', 'data', 'context', '_lView']) {
            if (cur[k] && typeof cur[k] === 'object') queue.push(cur[k]);
          }
        }
      }
      return null;
    };
    if (rcEl) {
      const ngFn = window.ng && typeof window.ng.getComponent === 'function' ? window.ng.getComponent : null;
      if (ngFn) {
        try {
          const comp = ngFn(rcEl);
          if (isRcInstance(comp)) {
            window.__agyRemoteControlInstance = comp;
            return comp;
          }
        } catch (e) {}
      }
      const ctxKey = Object.keys(rcEl).find((k) => k.startsWith('__ngContext'));
      const found = searchNgContext(rcEl.__ngContext__ || (ctxKey ? rcEl[ctxKey] : null));
      if (found) {
        window.__agyRemoteControlInstance = found;
        return found;
      }
    }
    const gaRootEl = typeof document?.querySelector === 'function' ? document.querySelector('ga-root') : null;
    if (gaRootEl) {
      const rootCtxKey = Object.keys(gaRootEl).find((k) => k.startsWith('__ngContext'));
      const foundFromRoot = searchNgContext(gaRootEl.__ngContext__ || (rootCtxKey ? gaRootEl[rootCtxKey] : null));
      if (foundFromRoot) {
        window.__agyRemoteControlInstance = foundFromRoot;
        return foundFromRoot;
      }
    }
    const nsRoot = window.default_GoogleAntigravity;
    if (nsRoot && typeof nsRoot === 'object') {
      const targetCandidates = [];
      if (rcEl) {
        targetCandidates.push(rcEl);
        if (rcEl.firstElementChild) targetCandidates.push(rcEl.firstElementChild);
        if (typeof rcEl.querySelector === 'function') {
          const innerContainer = rcEl.querySelector('.app-container, .iframe-panel, iframe');
          if (innerContainer && !targetCandidates.includes(innerContainer)) {
            targetCandidates.push(innerContainer);
          }
        }
      }
      if (gaRootEl) {
        targetCandidates.push(gaRootEl);
        if (gaRootEl.firstElementChild) targetCandidates.push(gaRootEl.firstElementChild);
      }
      for (const k of Object.keys(nsRoot)) {
        const mod = nsRoot[k];
        if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) continue;
        for (const targetEl of targetCandidates) {
          if (!targetEl) continue;
          try {
            if (typeof mod.getDebugNode === 'function') {
              const dbgNode = mod.getDebugNode(targetEl);
              const dbgComp = dbgNode?.componentInstance || dbgNode?.context;
              if (isRcInstance(dbgComp)) {
                window.__agyRemoteControlInstance = dbgComp;
                return dbgComp;
              }
              const foundFromDbg = searchNgContext(dbgComp || dbgNode);
              if (foundFromDbg) {
                window.__agyRemoteControlInstance = foundFromDbg;
                return foundFromDbg;
              }
            }
            if (typeof mod.getComponent === 'function') {
              const comp = mod.getComponent(targetEl);
              if (isRcInstance(comp)) {
                window.__agyRemoteControlInstance = comp;
                return comp;
              }
            }
            const getLCtx = mod['\u0275getLContext'] || mod.getLContext;
            if (typeof getLCtx === 'function') {
              const lCtx = getLCtx(targetEl);
              const foundFromLCtx = extractFromLContext(lCtx) || searchNgContext(lCtx?.lView || lCtx);
              if (foundFromLCtx) {
                window.__agyRemoteControlInstance = foundFromLCtx;
                return foundFromLCtx;
              }
            }
          } catch (e) {}
        }
        const RC = mod.RemoteControlComponent || (typeof mod.prototype?.proxyCommand === 'function' ? mod : null);
        if (RC && RC.prototype) {
          if (!RC.prototype.__agyKoProbeHooked) {
            RC.prototype.__agyKoProbeHooked = true;
            for (const mName of [
              'handleIframeMessage',
              'proxyCommand',
              'streamProxyCommand',
              'handlePortRequest',
              'managePolling',
              'shouldPoll',
              'loadInstances',
              'isDisconnected',
              'onIframeLoad',
              'onWindowOnline',
              'onWindowOffline',
              'isOffline',
              'isDirectIngressMode',
              'isTabHidden',
              'getSelectedInstance',
              'instanceInfos',
              'remoteConversationsInfos',
            ]) {
              if (typeof RC.prototype[mName] === 'function') {
                const origFn = RC.prototype[mName];
                RC.prototype[mName] = function (ev) {
                  if (this && !this.destroyed) {
                    window.__agyRemoteControlInstance = this;
                  }
                  if (mName === 'handleIframeMessage' && ev && ev.data === '__agy_ko_probe__') return;
                  return origFn.apply(this, arguments);
                };
              }
            }
          }
          try {
            if (!window.__agyRemoteControlInstance && typeof document?.dispatchEvent === 'function') {
              document.dispatchEvent(new Event('visibilitychange'));
            }
            if (!window.__agyRemoteControlInstance && typeof window?.dispatchEvent === 'function' && typeof Event === 'function') {
              window.dispatchEvent(new Event('online'));
            }
            if (!window.__agyRemoteControlInstance && typeof MessageEvent === 'function') {
              // When RC bound window.addEventListener('message', this.handleIframeMessage.bind(this)) at construction time,
              // the bound listener still invokes methods on `this` (e.g. this.onIframeLoad() when ev.data.type === 'IFRAME_READY',
              // or this.isDisconnected() / this.getSelectedInstance()) when the message comes from iframe.contentWindow.
              const innerIframe = rcEl && typeof rcEl.querySelector === 'function' ? rcEl.querySelector('iframe') : null;
              let innerCw = null;
              try {
                innerCw = innerIframe ? innerIframe.contentWindow : null;
              } catch (e) {}
              let innerOrigin = window.location?.origin || '';
              try {
                const rawIframeSrc = innerIframe?.getAttribute?.('src') || innerIframe?.src || '';
                if (rawIframeSrc) {
                  innerOrigin = new URL(rawIframeSrc, window.location?.href || 'https://antigravity.google.com').origin;
                }
              } catch (e) {}
              const origOnLoadProto = RC.prototype.onIframeLoad;
              let probeIntercepting = true;
              RC.prototype.onIframeLoad = function () {
                if (this && !this.destroyed) {
                  window.__agyRemoteControlInstance = this;
                }
                if (probeIntercepting) return Promise.resolve();
                return typeof origOnLoadProto === 'function' ? origOnLoadProto.apply(this, arguments) : undefined;
              };
              try {
                window.dispatchEvent(new MessageEvent('message', { data: '__agy_ko_probe__' }));
                if (!window.__agyRemoteControlInstance) {
                  const evInit = {
                    data: { type: 'IFRAME_READY', payload: { __agyKoProbe: true } },
                    origin: innerOrigin,
                  };
                  if (innerCw) {
                    try {
                      evInit.source = innerCw;
                    } catch (e) {}
                  }
                  let probeMsgEv;
                  try {
                    probeMsgEv = new MessageEvent('message', evInit);
                  } catch (e) {
                    probeMsgEv = new MessageEvent('message', {
                      data: { type: 'IFRAME_READY', payload: { __agyKoProbe: true } },
                      origin: innerOrigin,
                    });
                    if (innerCw) {
                      try {
                        Object.defineProperty(probeMsgEv, 'source', { get: () => innerCw });
                      } catch (err) {}
                    }
                  }
                  window.dispatchEvent(probeMsgEv);
                }
              } finally {
                probeIntercepting = false;
                RC.prototype.onIframeLoad = origOnLoadProto;
              }
            }
          } catch (e) {}
          break;
        }
      }
    }
    return window.__agyRemoteControlInstance && !window.__agyRemoteControlInstance.destroyed
      ? window.__agyRemoteControlInstance
      : null;
  }

  function decodeBase64Utf8(b64) {
    if (!b64 || typeof b64 !== 'string') return '';
    try {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(b64, 'base64').toString('utf8');
      }
      if (typeof atob === 'function') {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
        if (typeof TextDecoder === 'function') {
          return new TextDecoder('utf-8').decode(bytes);
        }
        return decodeURIComponent(escape(bin));
      }
    } catch (e) {}
    return '';
  }

  function findLineStartMarkerIndex(text, marker, fromIndex = 0) {
    if (!text || !marker) return -1;
    let pos = Math.max(0, fromIndex);
    while (pos <= text.length) {
      const idx = text.indexOf(marker, pos);
      if (idx === -1) return -1;
      const prevChar = idx === 0 ? '\n' : text[idx - 1];
      const afterIdx = idx + marker.length;
      const nextChar = afterIdx >= text.length ? '\n' : text[afterIdx];
      if (
        (prevChar === '\n' || prevChar === '\r') &&
        (nextChar === '\n' || nextChar === '\r' || nextChar === ' ' || nextChar === '\t')
      ) {
        return idx;
      }
      pos = idx + 1;
    }
    return -1;
  }

  function extractCompanionBlock(text, startMarkers, endMarkers) {
    if (!text || typeof text !== 'string') return '';
    const starts = Array.isArray(startMarkers) ? startMarkers : [startMarkers];
    const ends = Array.isArray(endMarkers) ? endMarkers : [endMarkers];
    for (let i = 0; i < starts.length; i++) {
      const sMarker = starts[i];
      const eMarker = ends[i] || ends[0];
      const s = findLineStartMarkerIndex(text, sMarker, 0);
      if (s === -1) continue;
      const e = findLineStartMarkerIndex(text, eMarker, s + sMarker.length);
      if (e !== -1 && e > s) {
        return text.slice(s + sMarker.length, e).trim();
      }
    }
    return '';
  }

  function injectRemoteCompanionScript(code, onDone) {
    if (!code || !document) return;
    try {
      const s = document.createElement('script');
      const nonce = document.querySelector('script[nonce]')?.nonce;
      const p = getTrustedPolicyForRemote();
      if (nonce) s.nonce = nonce;
      s.text = p ? p.createScript(code) : code;
      (document.head || document.documentElement).appendChild(s);
      if (typeof onDone === 'function') onDone();
    } catch (e) {}
  }

  async function probeHostCompanionPluginsForRemote(rcEl) {
    const info = {
      resolved: false,
      statusbarInstalled: Boolean(window.agyStatusBar),
      mcpManagerInstalled: Boolean(window.agyMcpManager),
      statusbarCode: '',
      mcpManagerCode: '',
    };
    if (window.__agyHostInstalledPlugins && typeof window.__agyHostInstalledPlugins === 'object') {
      const override = window.__agyHostInstalledPlugins;
      info.resolved = Boolean(override.resolved !== false);
      info.statusbarInstalled = Boolean(
        override.statusbar || override.hasStatusbar || override['antigravity-statusbar']
      );
      info.mcpManagerInstalled = Boolean(
        override.mcpManager || override.hasMcpManager || override['antigravity-mcp-manager']
      );
      info.statusbarCode = String(override.statusbarCode || override.statusbarBlock || '');
      info.mcpManagerCode = String(override.mcpManagerCode || override.mcpManagerBlock || '');
      if (info.resolved && (info.statusbarInstalled || info.mcpManagerInstalled || override.statusbar !== undefined || override.mcpManager !== undefined)) {
        return info;
      }
    }

    const iframe = rcEl && rcEl.querySelector ? rcEl.querySelector('iframe') : null;
    const cw = iframe && iframe.contentWindow ? iframe.contentWindow : null;
    let cwLsClient = null;
    try {
      cwLsClient = cw && cw.__agyCapturedLsClient ? cw.__agyCapturedLsClient : null;
    } catch (e) {}
    const lsClient =
      window.__agyCapturedLsClient ||
      cwLsClient ||
      null;
    const rcInst = getRemoteControlComponentInstance(rcEl);
    if (!lsClient && (!rcInst || typeof rcInst.proxyCommand !== 'function')) return info;

    const callRpc = async (methods, rpcPath, payload = {}) => {
      if (lsClient) {
        for (const m of methods) {
          if (typeof lsClient[m] === 'function') {
            try {
              const res = await lsClient[m](payload);
              if (res) return res;
            } catch (e) {}
          }
        }
      }
      if (rcInst && typeof rcInst.proxyCommand === 'function' && rpcPath) {
        try {
          const TE = typeof TextEncoder === 'function' ? new TextEncoder() : null;
          const TD = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;
          const reqStr = JSON.stringify(payload || {});
          const reqBytes = TE
            ? TE.encode(reqStr)
            : Uint8Array.from(reqStr.split('').map((c) => c.charCodeAt(0) & 0xff));
          const res = await rcInst.proxyCommand(rpcPath, reqBytes, {
            'content-type': 'application/json',
            'x-is-streaming': 'false',
          });
          if (res && res.payload) {
            const text = TD
              ? TD.decode(res.payload)
              : String.fromCharCode(...new Uint8Array(res.payload));
            if (text) return JSON.parse(text);
          }
        } catch (e) {}
      }
      return null;
    };

    const applyRawBundleInspection = (rawText) => {
      if (!rawText || typeof rawText !== 'string') return;
      info.resolved = true;
      const mcpStartMarkers = [
        '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
        '/* === BEGIN_AGY_MCP_MANAGER_V1 === */',
        '// === BEGIN_AGY_MCP_MANAGER ===',
        '/* === BEGIN_AGY_MCP_MANAGER === */',
      ];
      const mcpEndMarkers = [
        '// === END_AGY_MCP_MANAGER_V1 ===',
        '/* === END_AGY_MCP_MANAGER_V1 === */',
        '// === END_AGY_MCP_MANAGER ===',
        '/* === END_AGY_MCP_MANAGER === */',
      ];
      const koStartMarkers = [
        '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
        '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
      ];
      const sbStartMarkers = ['/* === BEGIN_AGY_STATUSBAR === */', '// === BEGIN_AGY_STATUSBAR ==='];
      const sbEndMarkers = ['/* === END_AGY_STATUSBAR === */', '// === END_AGY_STATUSBAR ==='];

      let sbCode = extractCompanionBlock(rawText, sbStartMarkers, sbEndMarkers);
      const mcpCode = extractCompanionBlock(rawText, mcpStartMarkers, mcpEndMarkers);

      // In statusbar_autoinject.js, antigravity-statusbar is the base segment before the first companion marker
      // (it has no BEGIN_AGY_STATUSBAR wrapper). Slice out the base segment before any line-start companion marker.
      const markerPositions = [];
      for (const m of [...mcpStartMarkers, ...koStartMarkers, ...sbStartMarkers]) {
        const idx = findLineStartMarkerIndex(rawText, m, 0);
        if (idx !== -1) markerPositions.push(idx);
      }
      const firstMarkerIdx =
        markerPositions.length > 0 ? Math.min(...markerPositions) : rawText.length;
      const baseSegment = rawText.slice(0, firstMarkerIdx).trim();

      if (
        !sbCode &&
        baseSegment &&
        (baseSegment.includes('Antigravity Custom Statusbar') ||
          baseSegment.includes('mountContextStatusBar') ||
          baseSegment.includes('./context-window-policy') ||
          (baseSegment.includes('mountStatusBar') && baseSegment.includes('agy-ctx-statusbar')))
      ) {
        sbCode = baseSegment;
      }

      if (sbCode) {
        info.statusbarInstalled = true;
        info.statusbarCode = sbCode;
      }
      if (mcpCode) {
        info.mcpManagerInstalled = true;
        info.mcpManagerCode = mcpCode;
      } else if (
        baseSegment.includes('Antigravity Custom MCP Server Manager') ||
        (baseSegment.includes('mountMcpManager') && !baseSegment.includes('mountContextStatusBar'))
      ) {
        info.mcpManagerInstalled = true;
        info.mcpManagerCode = baseSegment;
      }
    };

    try {
      const userRes = await callRpc(['getLocalUserInfo', 'GetLocalUserInfo'], null, {});
      let homeDir = String(
        userRes?.homeDir || userRes?.userHome || userRes?.userInfo?.homeDir || ''
      )
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
      if (homeDir) {
        const bundlePath = `${homeDir}/.gemini/antigravity/statusbar_autoinject.js`;
        const fileRes = await callRpc(
          ['readFile', 'ReadFile', 'viewFile', 'ViewFile'],
          '/exa.language_server_pb.LanguageServerService/ReadFile',
          {
            uri: bundlePath.startsWith('/') ? `file://${bundlePath}` : `file:///${bundlePath}`,
            path: bundlePath,
            filePath: bundlePath,
            absolutePath: bundlePath,
          }
        );
        const rawContent = String(fileRes?.content || fileRes?.text || fileRes?.data || '');
        const decoded =
          rawContent && !rawContent.includes('function') && !rawContent.includes('===')
            ? decodeBase64Utf8(rawContent) || rawContent
            : rawContent;
        applyRawBundleInspection(decoded);
      }

      const [pluginsRes, statesRes] = await Promise.all([
        callRpc(
          ['getAllPlugins', 'GetAllPlugins'],
          '/exa.language_server_pb.LanguageServerService/GetAllPlugins',
          { workspaceUris: [] }
        ),
        callRpc(
          ['getCustomizationStates', 'GetCustomizationStates'],
          '/exa.language_server_pb.LanguageServerService/GetCustomizationStates',
          {}
        ),
      ]);

      const candidatePaths = [];
      for (const resObj of [pluginsRes, statesRes]) {
        if (!resObj) continue;
        info.resolved = true;
        const rawJson = JSON.stringify(resObj);
        if (/antigravity-statusbar/i.test(rawJson)) info.statusbarInstalled = true;
        if (/antigravity-mcp-manager/i.test(rawJson)) info.mcpManagerInstalled = true;
        if (Array.isArray(resObj.plugins)) {
          for (const p of resObj.plugins) {
            if (p?.path) candidatePaths.push(String(p.path));
          }
        }
        if (Array.isArray(resObj.states)) {
          for (const s of resObj.states) {
            if (s?.path) candidatePaths.push(String(s.path));
          }
        }
      }

      if (!candidatePaths.length && !homeDir) {
        const skillsRes = await callRpc(
          ['getAllSkills', 'GetAllSkills'],
          '/exa.language_server_pb.LanguageServerService/GetAllSkills',
          {}
        );
        if (Array.isArray(skillsRes?.skills)) {
          info.resolved = true;
          for (const sk of skillsRes.skills) {
            if (sk?.path) candidatePaths.push(String(sk.path));
          }
        }
      }

      if (!homeDir && candidatePaths.length > 0) {
        for (const rawPath of candidatePaths) {
          const norm = String(rawPath).replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/');
          const idx = norm.indexOf('/.gemini/');
          if (idx !== -1) {
            const prefix =
              String(rawPath).startsWith('file:///') && norm.startsWith('Users/')
                ? '/'
                : '';
            const geminiDir = (prefix + norm.slice(0, idx + 8)).replace(
              /^\/+([A-Za-z]:\/)/,
              '$1'
            );
            const uriPrefix = geminiDir.startsWith('/') ? 'file://' : 'file:///';
            const uri = `${uriPrefix}${geminiDir}/antigravity/statusbar_autoinject.js`;
            const rf = await callRpc(
              ['readFile', 'ReadFile'],
              '/exa.language_server_pb.LanguageServerService/ReadFile',
              { uri, path: `${geminiDir}/antigravity/statusbar_autoinject.js` }
            );
            const rawContent = String(rf?.content || rf?.text || rf?.data || '');
            const decoded =
              rawContent && !rawContent.includes('function') && !rawContent.includes('===')
                ? decodeBase64Utf8(rawContent) || rawContent
                : rawContent;
            applyRawBundleInspection(decoded);
            break;
          }
        }
      }
    } catch (e) {}

    return info;
  }

  function syncRemoteCompanionPlugins(rcEl) {
    if (!rcEl || window.__agyKoSyncingCompanions) return;
    let cwLsClient = null;
    try {
      cwLsClient = rcEl.querySelector?.('iframe')?.contentWindow?.__agyCapturedLsClient || null;
    } catch (e) {}
    const hasRpcOrOverride = Boolean(
      window.__agyCapturedLsClient ||
        cwLsClient ||
        window.__agyHostInstalledPlugins ||
        getRemoteControlComponentInstance(rcEl)
    );
    if (!hasRpcOrOverride) return;
    if (window.__agyKoCompanionsSynced && window.__agyHostInstalledPlugins === window.__agyLastHostInstalledPluginsRef) {
      return;
    }
    window.__agyKoSyncingCompanions = true;
    window.__agyLastHostInstalledPluginsRef = window.__agyHostInstalledPlugins;

    probeHostCompanionPluginsForRemote(rcEl)
      .then((info) => {
        if (!info || !info.resolved) return;
        window.__agyKoCompanionsSynced = true;

        // Only load antigravity-statusbar when actually installed on the host
        if (info.statusbarInstalled && !window.agyStatusBar && !window.__agyKoFetchingStatusBar) {
          window.__agyKoFetchingStatusBar = true;
          if (info.statusbarCode) {
            injectRemoteCompanionScript(info.statusbarCode, () => refreshStatusbarTranslatorAdapter());
          } else if (typeof fetch === 'function') {
            fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js?t=' + Date.now())
              .then((r) => (r && r.ok ? r.text() : ''))
              .then((code) => {
                if (!code || window.agyStatusBar) return;
                injectRemoteCompanionScript(code, () => refreshStatusbarTranslatorAdapter());
              })
              .catch(() => {});
          }
        }

        // Only load antigravity-mcp-manager when actually installed on the host
        if (info.mcpManagerInstalled && !window.agyMcpManager && !window.__agyKoFetchingMcpManager) {
          window.__agyKoFetchingMcpManager = true;
          const mountMcpIntoInnerFrame = () => {
            try {
              const innerFrame = rcEl.querySelector('iframe');
              if (
                innerFrame &&
                innerFrame.contentWindow &&
                innerFrame.contentDocument &&
                typeof window.__agyMountMcpManager === 'function'
              ) {
                window.__agyMountMcpManager(innerFrame.contentWindow, innerFrame.contentDocument);
              }
            } catch (e) {}
          };
          if (info.mcpManagerCode) {
            injectRemoteCompanionScript(info.mcpManagerCode, mountMcpIntoInnerFrame);
          } else if (typeof fetch === 'function') {
            fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t=' + Date.now())
              .then((r) => (r && r.ok ? r.text() : ''))
              .then((code) => {
                if (!code || window.agyMcpManager) return;
                injectRemoteCompanionScript(code, mountMcpIntoInnerFrame);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        window.__agyKoSyncingCompanions = false;
      });
  }

  function bridgeRemoteControlIframe() {
    if (!document || typeof window.__agyMountKoThoughtLocalizer !== 'function') return;
    const rcEl = document.querySelector('ga-remote-control');
    if (!rcEl) return;

    syncRemoteCompanionPlugins(rcEl);

    const iframe = rcEl.querySelector('iframe');
    if (!iframe) return;

    try {
      const cw = iframe.contentWindow;
      const cd = iframe.contentDocument;
      const rootEl = cd && cd.getElementById ? cd.getElementById('root') : null;
      const cwOrigin = cw && cw.location ? cw.location.origin : '';
      const isSameOriginOrBlank =
        cwOrigin === window.location.origin ||
        cwOrigin === 'null' ||
        (cw && cw.location && cw.location.href === 'about:blank');
      if (
        cw &&
        cd &&
        cd.body &&
        isSameOriginOrBlank &&
        (cw.__agyMainBooted || (rootEl && rootEl.childElementCount > 0))
      ) {
        if (cw.__agyKoLocalizerActive !== KO_LOCALIZER_VERSION) {
          window.__agyMountKoThoughtLocalizer(cw, cd);
        }
        if (typeof window.__agyMountMcpManager === 'function') {
          try {
            window.__agyMountMcpManager(cw, cd);
          } catch (e) {}
        }
        return;
      }
      if (iframe.__agyKoPromoted === KO_LOCALIZER_VERSION && (!cd || !cd.getElementById || !cd.getElementById('root'))) {
        delete iframe.__agyKoPromoted;
      }
    } catch (e) {
      if (iframe.__agyKoPromoted === KO_LOCALIZER_VERSION) {
        delete iframe.__agyKoPromoted;
      }
    }

    if (iframe.__agyKoPromoted === KO_LOCALIZER_VERSION) return;
    const rcInst = getRemoteControlComponentInstance(rcEl);
    if (!rcInst) return;

    const rawCandidate =
      iframe.getAttribute('src') ||
      iframe.src ||
      (typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
      '';
    const rawSrc = rawCandidate.match(/https?:\/\/[^\s"'<>)+]+/)?.[0] || rawCandidate;
    if (!rawSrc || !rawSrc.includes('?iframe=true')) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(rawSrc, window.location.href);
    } catch (e) {
      return;
    }
    const basePath = parsedUrl.pathname.replace(/^\/antigravity/, '').replace(/\/+$/, '');
    const verMatch = basePath.match(/\/web\/([^/]+)/);
    const appVersion = verMatch ? verMatch[1] : '2.28.2';
    // Host CSP on antigravity.google.com blocks script-src from antigravity.static.usercontent.goog
    // but explicitly allows https://www.gstatic.com, which mirrors all /antigravity/web/<ver>/ assets identically.
    const cdnOrigin =
      parsedUrl.hostname === 'antigravity.static.usercontent.goog' || parsedUrl.origin === window.location.origin
        ? 'https://www.gstatic.com/antigravity'
        : parsedUrl.origin;
    const cdnBaseUrl = `${cdnOrigin}${basePath}`;

    iframe.__agyKoPromoted = KO_LOCALIZER_VERSION;
    const savedChildPath = String(
      new URLSearchParams(window.location.search || '').get('p') ||
        rcInst.lastSyncedChildPath ||
        rcInst.initialChildPath ||
        ''
    ).replace(/^\/+/, '');
    if (savedChildPath) {
      rcInst.initialChildPath = savedChildPath;
    }

    const buildInitialIframeHistoryUrl = () => {
      if (!savedChildPath) return `${basePath}/?iframe=true`;
      const qIdx = savedChildPath.indexOf('?');
      const subPath = qIdx >= 0 ? savedChildPath.slice(0, qIdx) : savedChildPath;
      const subQuery = qIdx >= 0 ? savedChildPath.slice(qIdx + 1) : '';
      const cleanSubPath = subPath.replace(/^\/+/, '');
      const fullPath = cleanSubPath ? `${basePath}/${cleanSubPath}` : `${basePath}/`;
      return subQuery ? `${fullPath}?${subQuery}&iframe=true` : `${fullPath}?iframe=true`;
    };

    const origSrcDesc =
      typeof HTMLIFrameElement !== 'undefined'
        ? Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
        : null;
    const spoofedSrc = `${window.location.origin}${basePath}/?iframe=true`;

    // Suppress Angular's automatic (load)="onIframeLoad()" during about:blank & document.write transitions
    // so teardownProxyPort() is NEVER called while main.js is booting or after INITIAL_CONFIG is delivered.
    const rcProto = Object.getPrototypeOf(rcInst);
    if (rcProto && typeof rcProto.onIframeLoad === 'function' && !rcProto.__agyOrigOnIframeLoad) {
      rcProto.__agyOrigOnIframeLoad = rcProto.onIframeLoad;
      rcProto.onIframeLoad = function (...args) {
        if (this.__agySuppressAutoIframeLoad) return Promise.resolve();
        return rcProto.__agyOrigOnIframeLoad.apply(this, args);
      };
    }
    if (typeof rcInst.onIframeLoad === 'function' && !rcInst.__agyOrigOnIframeLoad) {
      rcInst.__agyOrigOnIframeLoad = rcInst.onIframeLoad;
      rcInst.onIframeLoad = function (...args) {
        if (this.__agySuppressAutoIframeLoad) return Promise.resolve();
        return this.__agyOrigOnIframeLoad.apply(this, args);
      };
    }
    rcInst.__agySuppressAutoIframeLoad = true;

    const onBlankLoad = () => {
      try {
        const cw = iframe.contentWindow;
        const cd = iframe.contentDocument;
        if (!cw || !cd) return;

        const nonce = document.querySelector('script[nonce]')?.nonce || '';
        const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
        const ttPolicy = getTrustedPolicyForRemote();
        const shellHtml =
          `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">` +
          `<link rel="stylesheet" href="${cdnBaseUrl}/jetbox.css"${nonceAttr}>` +
          `<link rel="stylesheet" href="${cdnBaseUrl}/compiled_tailwind.css"${nonceAttr}>` +
          `<style>html,body,#root{height:100%;height:100dvh;max-height:100dvh;margin:0;overflow:hidden;background-color:transparent;overscroll-behavior:none;-webkit-text-size-adjust:100%;}</style>` +
          `</head><body><div id="root"></div></body></html>`;

        cd.open();
        cd.write(ttPolicy ? ttPolicy.createHTML(shellHtml) : shellHtml);
        cd.close();

        try {
          const prevDec = cw.__JETSKI_LS_CLIENT_DECORATOR__;
          cw.__JETSKI_LS_CLIENT_DECORATOR__ = function (client) {
            const decorated = typeof prevDec === 'function' ? prevDec(client) || client : client;
            if (decorated && typeof decorated === 'object') {
              cw.__agyCapturedLsClient = decorated;
              window.__agyCapturedLsClient = decorated;
              syncRemoteCompanionPlugins(rcEl);
            }
            return decorated;
          };
        } catch (e) {}

        try {
          cw.history.replaceState(null, '', buildInitialIframeHistoryUrl());
        } catch (e) {}
        try {
          Object.defineProperty(cd, 'referrer', {
            configurable: true,
            get: () => window.location.href,
          });
        } catch (e) {}

        cw.__APP_CONFIG__ = {
          productName: 'antigravity',
          csrfToken: 'csrf_token',
          appVersion,
          isRemoteControl: true,
        };
        const ua = cw.navigator?.userAgent || '';
        const platform =
          ua.indexOf('Windows') >= 0
            ? 'win32'
            : ua.indexOf('Macintosh') >= 0 || ua.indexOf('Mac OS') >= 0
            ? 'darwin'
            : 'linux';
        cw.process = cw.process || {
          env: { NODE_ENV: 'production' },
          platform,
          nextTick: (cb) => Promise.resolve().then(cb),
        };
        if (cw.AudioWorklet && cw.AudioWorklet.prototype) {
          cw.AudioWorklet.prototype.addModule = () => Promise.resolve();
        }
        if (cw.customElements && !cw.customElements.__agyGuarded) {
          const origDef = cw.customElements.define.bind(cw.customElements);
          cw.customElements.define = (name, ctor, opts) => {
            if (!cw.customElements.get(name)) origDef(name, ctor, opts);
          };
          cw.customElements.__agyGuarded = true;
        }
        const imgProto = cw.HTMLImageElement && cw.HTMLImageElement.prototype;
        const imgSrcDesc = imgProto ? Object.getOwnPropertyDescriptor(imgProto, 'src') : null;
        if (imgProto && imgSrcDesc && typeof imgSrcDesc.set === 'function' && !imgProto.__agyImgSrcPatched) {
          Object.defineProperty(imgProto, 'src', {
            configurable: true,
            enumerable: true,
            get: imgSrcDesc.get,
            set(val) {
              if (typeof val === 'string' && basePath && val.startsWith(basePath + '/')) {
                val = `${cdnBaseUrl}${val.slice(basePath.length)}`;
              }
              return imgSrcDesc.set.call(this, val);
            },
          });
          imgProto.__agyImgSrcPatched = true;
        }
        const elProto = cw.Element && cw.Element.prototype;
        if (elProto && typeof elProto.setAttribute === 'function' && !elProto.__agySetAttrPatched) {
          const origSetAttr = elProto.setAttribute;
          elProto.setAttribute = function (name, val) {
            if (
              this.tagName === 'IMG' &&
              typeof name === 'string' &&
              name.toLowerCase() === 'src' &&
              typeof val === 'string' &&
              basePath &&
              val.startsWith(basePath + '/')
            ) {
              val = `${cdnBaseUrl}${val.slice(basePath.length)}`;
            }
            return origSetAttr.call(this, name, val);
          };
          elProto.__agySetAttrPatched = true;
        }
        try {
          cw.document.documentElement.style.colorScheme = 'dark';
        } catch (e) {}

        // Buffer INITIAL_CONFIG messages sent to cw before main.js registers its XChannelTransport(qYc) message listener,
        // and replay the cached event immediately when addEventListener('message', fn) is called.
        // This guarantees main.js receives the very first MessagePort without ever calling rcInst.onIframeLoad() twice
        // (which would run teardownProxyPort() and close the active MessagePort).
        const msgListeners = new Set();
        try {
          if (typeof cw.addEventListener === 'function' && !cw.__agyMsgBufferInstalled) {
            cw.__agyMsgBufferInstalled = true;
            const origAddEv = cw.addEventListener.bind(cw);
            const origRemoveEv = typeof cw.removeEventListener === 'function' ? cw.removeEventListener.bind(cw) : null;
            origAddEv('message', (ev) => {
              if (ev && ev.data && ev.data.type === 'INITIAL_CONFIG') {
                cw.__agyBufferedInitialConfigEvent = ev;
                if (msgListeners.size > 0) {
                  cw.__initialConfigReceived = true;
                }
              }
            });
            cw.addEventListener = function (type, listener, options) {
              if (type === 'message' && typeof listener === 'function') {
                msgListeners.add(listener);
                const res = origAddEv(type, listener, options);
                if (cw.__agyBufferedInitialConfigEvent && !cw.__initialConfigReceived) {
                  const bufferedEv = cw.__agyBufferedInitialConfigEvent;
                  cw.__initialConfigReceived = true;
                  Promise.resolve().then(() => {
                    try {
                      listener.call(cw, bufferedEv);
                    } catch (e) {}
                  });
                }
                return res;
              }
              return origAddEv(type, listener, options);
            };
            if (origRemoveEv) {
              cw.removeEventListener = function (type, listener, options) {
                if (type === 'message' && typeof listener === 'function') {
                  msgListeners.delete(listener);
                }
                return origRemoveEv(type, listener, options);
              };
            }
          }
        } catch (e) {}

        // Wrap cw.Worker so relative worker paths (e.g. '/diff_worker.js?v=...') resolve against cdnBaseUrl via Blob importScripts
        try {
          if (typeof cw.Worker === 'function' && !cw.Worker.__agyWorkerPatched) {
            const OrigWorker = cw.Worker;
            const PatchedWorker = function (scriptURL, options) {
              let urlStr = String(scriptURL || '');
              if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
                const targetWorkerUrl = `${cdnBaseUrl}${urlStr}`;
                try {
                  if (typeof cw.Blob === 'function' && cw.URL && typeof cw.URL.createObjectURL === 'function') {
                    const blob = new cw.Blob([`importScripts(${JSON.stringify(targetWorkerUrl)});`], {
                      type: 'application/javascript',
                    });
                    const blobUrl = cw.URL.createObjectURL(blob);
                    return new OrigWorker(ttPolicy ? ttPolicy.createScriptURL(blobUrl) : blobUrl, options);
                  }
                } catch (e) {}
              }
              return new OrigWorker(scriptURL, options);
            };
            PatchedWorker.prototype = OrigWorker.prototype;
            PatchedWorker.__agyWorkerPatched = true;
            cw.Worker = PatchedWorker;
          }
        } catch (e) {}

        const prismScript = cd.createElement('script');
        if (nonce) prismScript.nonce = nonce;
        prismScript.async = false;
        const prismUrl = `${cdnBaseUrl}/prism_bundle.js`;
        prismScript.src = ttPolicy ? ttPolicy.createScriptURL(prismUrl) : prismUrl;

        const mainScript = cd.createElement('script');
        if (nonce) mainScript.nonce = nonce;
        mainScript.async = false;
        const mainUrl = `${cdnBaseUrl}/main.js`;
        mainScript.src = ttPolicy ? ttPolicy.createScriptURL(mainUrl) : mainUrl;

        mainScript.onload = () => {
          cw.__agyMainBooted = true;
          if (savedChildPath) rcInst.initialChildPath = savedChildPath;
          const origLoad =
            rcInst.__agyOrigOnIframeLoad ||
            rcProto?.__agyOrigOnIframeLoad ||
            rcInst.onIframeLoad;
          let initialConfigInFlight = false;
          const replayBufferedInitialConfig = () => {
            if (!cw.__initialConfigReceived && cw.__agyBufferedInitialConfigEvent && msgListeners.size > 0) {
              const bufferedEv = cw.__agyBufferedInitialConfigEvent;
              cw.__initialConfigReceived = true;
              for (const fn of Array.from(msgListeners)) {
                try {
                  fn.call(cw, bufferedEv);
                } catch (e) {}
              }
            }
          };
          const ensureInitialConfigSent = () => {
            replayBufferedInitialConfig();
            if (typeof origLoad === 'function' && !cw.__initialConfigReceived && !initialConfigInFlight && !cw.__agyOnIframeLoadCalled) {
              initialConfigInFlight = true;
              cw.__agyOnIframeLoadCalled = true;
              if (savedChildPath) rcInst.initialChildPath = savedChildPath;
              try {
                const res = origLoad.call(rcInst);
                Promise.resolve(res)
                  .catch(() => {})
                  .finally(() => {
                    initialConfigInFlight = false;
                    replayBufferedInitialConfig();
                    setTimeout(replayBufferedInitialConfig, 150);
                  });
              } catch (e) {
                initialConfigInFlight = false;
              }
            }
          };
          ensureInitialConfigSent();
          [120, 400, 1000].forEach((delay) => {
            setTimeout(() => {
              if (savedChildPath && typeof rcInst.navigateIframeToChildPath === 'function') {
                try {
                  rcInst.navigateIframeToChildPath(savedChildPath);
                } catch (e) {}
              }
            }, delay);
          });
          try {
            if (typeof rcInst.markIframeReady === 'function') {
              rcInst.markIframeReady();
            } else {
              rcInst.iframeLoading?.set?.(false);
              rcInst.iframeUiReady?.set?.(true);
            }
          } catch (e) {}
          window.__agyMountKoThoughtLocalizer(cw, cd);
          if (typeof window.__agyMountMcpManager === 'function') {
            try {
              window.__agyMountMcpManager(cw, cd);
            } catch (e) {}
          }
        };
        mainScript.onerror = () => {
          delete iframe.__agyKoPromoted;
        };

        cd.head.appendChild(prismScript);
        cd.head.appendChild(mainScript);
      } catch (e) {
        delete iframe.__agyKoPromoted;
      }
    };

    try {
      delete iframe.src;
    } catch (e) {}
    let blankLoadHandled = false;
    const triggerBlankLoadOnce = () => {
      if (blankLoadHandled) return;
      try {
        const cd = iframe.contentDocument;
        const cw = iframe.contentWindow;
        if (!cd || !cw) return;
        blankLoadHandled = true;
      } catch (e) {
        return;
      }
      onBlankLoad();
    };
    iframe.addEventListener('load', triggerBlankLoadOnce, { once: true });
    if (origSrcDesc && typeof origSrcDesc.set === 'function') {
      origSrcDesc.set.call(iframe, 'about:blank');
    } else {
      iframe.src = 'about:blank';
    }
    try {
      Object.defineProperty(iframe, 'src', {
        configurable: true,
        get: () => spoofedSrc,
        set: () => {},
      });
    } catch (e) {}
    setTimeout(() => {
      if (!blankLoadHandled) {
        try {
          if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
            triggerBlankLoadOnce();
          }
        } catch (e) {}
      }
    }, 60);
  }

  function scanThoughtBlocks() {
    ensureVerboseConversationStepsEnabled();
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
    registerStatusbarTranslatorAdapter();
    bridgeRemoteControlIframe();
    if (document.body) {
      localizeStaticUiInRoot(document.body);
      ensureNativeSettingsModalIntegration();
      ensureThinkingDisplayMenuIntegration();
      if (
        document.getElementById('agy-ko-translator-modal') &&
        !document.querySelector('[data-testid="agy-ko-translate-thinking-switch"]') &&
        typeof refreshTranslatorSettingsUi === 'function'
      ) {
        refreshTranslatorSettingsUi();
      }
    }
    scanThoughtBlocks();
    if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
      observer.takeRecords();
    }
  }
  window.__agyForceRescanAll = scanAll;

  // Fast pre-paint pass for Thinking/Worked triggers and .cursor-edit blocks (prevents session-switch FOUC)
  // paired with microtask deduplication and a 16ms coalesced timer for full-document static UI localization.
  let inFastScan = false;
  let fastScanMicrotaskScheduled = false;
  let scanTimerScheduled = false;
  let lastObservedCascadeId = null;
  let sessionSwitchFreezeTimer = null;

  function guardSessionSwitchTransitions() {
    try {
      if (!document) return;
      const views =
        typeof document.querySelectorAll === 'function'
          ? Array.from(
              document.querySelectorAll(
                '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"]'
              )
            )
          : [];
      if (views.length === 0 && typeof document.querySelector === 'function') {
        const single =
          document.querySelector('[data-testid="conversation-view"]') ||
          document.querySelector('[data-testid="subagent-tab-conversation"]');
        if (single) views.push(single);
      }
      if (views.length === 0) return;

      let switched = false;
      for (const convView of views) {
        if (!convView || typeof convView.getAttribute !== 'function') continue;
        const currentCascadeId = convView.getAttribute('data-cascade-id') || null;
        if (!currentCascadeId) continue;
        const testId = convView.getAttribute('data-testid') || '';
        const isPrimaryConv = testId === 'conversation-view';
        const prevElementCascadeId = convView.__agyLastObservedCascadeId ?? null;
        if (currentCascadeId !== prevElementCascadeId) {
          convView.__agyLastObservedCascadeId = currentCascadeId;
          if (
            prevElementCascadeId !== null ||
            (isPrimaryConv && lastObservedCascadeId !== null && currentCascadeId !== lastObservedCascadeId)
          ) {
            switched = true;
          }
        }
        if (isPrimaryConv && currentCascadeId !== lastObservedCascadeId) {
          if (lastObservedCascadeId !== null) switched = true;
          lastObservedCascadeId = currentCascadeId;
        }
      }

      const armFreezeTimer = (targetViews, durationMs) => {
        for (const v of targetViews) {
          if (v && typeof v.setAttribute === 'function' && v.getAttribute('data-agy-session-switching') !== '1') {
            v.setAttribute('data-agy-session-switching', '1');
          }
        }
        if (sessionSwitchFreezeTimer) clearTimeout(sessionSwitchFreezeTimer);
        sessionSwitchFreezeTimer = setTimeout(() => {
          sessionSwitchFreezeTimer = null;
          try {
            const liveViews =
              typeof document.querySelectorAll === 'function'
                ? Array.from(
                    document.querySelectorAll(
                      '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"]'
                    )
                  )
                : targetViews;
            for (const v of liveViews) {
              if (v && typeof v.removeAttribute === 'function') {
                v.removeAttribute('data-agy-session-switching');
              }
            }
            if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
              observer.takeRecords();
            }
          } catch (e) {}
        }, durationMs);
      };

      if (switched) {
        for (const v of views) {
          if (v) v.__agyTrajectoryMountedForCascade = null;
        }
        armFreezeTimer(views, 650);
      } else {
        // When IEc finishes async trajectorySlice load after the spinner (tEc), turns mount into the view.
        // Extend the transition-suppression window by 250ms on that first turn mount so delayed mounts never animate/flicker.
        for (const v of views) {
          if (!v || typeof v.querySelector !== 'function') continue;
          const cid = v.getAttribute ? v.getAttribute('data-cascade-id') : null;
          if (
            cid &&
            v.__agyTrajectoryMountedForCascade !== cid &&
            v.querySelector(
              'button[data-testid="worked-for-collapsible"], button[data-testid="thinking-collapsible-trigger"], [data-testid="user-message-bubble"]'
            )
          ) {
            const wasSwitching =
              v.getAttribute('data-agy-session-switching') === '1' ||
              Boolean(sessionSwitchFreezeTimer);
            v.__agyTrajectoryMountedForCascade = cid;
            if (wasSwitching) {
              armFreezeTimer(views, 250);
            }
          }
        }
      }
    } catch (e) {}
  }

  function runFastThoughtAndTriggerScan() {
    ensureVerboseConversationStepsEnabled();
    guardSessionSwitchTransitions();
    if (disposed || inFastScan) return;
    inFastScan = true;
    try {
      scanTriggerButtonsSync();
      ensureThinkingDisplayMenuIntegration();
      const mcpModal = document.getElementById('agy-mcp-manager-modal-backdrop');
      if (mcpModal) localizeStaticUiInRoot(mcpModal);
      const mcpEditPopup = document.getElementById('agy-mcp-edit-popup-backdrop');
      if (mcpEditPopup) localizeStaticUiInRoot(mcpEditPopup);
      const mcpOAuthModal = document.getElementById('agy-mcp-oauth-connect-backdrop');
      if (mcpOAuthModal) localizeStaticUiInRoot(mcpOAuthModal);
      const mcpSettingsPane = document.getElementById('agy-mcp-settings-pane');
      if (mcpSettingsPane) localizeStaticUiInRoot(mcpSettingsPane);
      if (document.querySelectorAll) {
        document.querySelectorAll('[data-agy-custom-mcp-btn]').forEach((el) => localizeStaticUiInRoot(el));
      }
      const allCursorEdits = document.querySelectorAll('.cursor-edit');
      for (const cursorEdit of allCursorEdits) {
        const container = cursorEdit.closest('.relative') || cursorEdit.parentElement;
        const btn = container
          ? container.querySelector('button[data-testid="thinking-collapsible-trigger"]')
          : null;
        processCursorEdit(cursorEdit, btn);
      }
      if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
        observer.takeRecords();
      }
    } finally {
      inFastScan = false;
    }
  }

  function scheduleCoalescedScan() {
    if (disposed) return;
    if (!fastScanMicrotaskScheduled) {
      fastScanMicrotaskScheduled = true;
      Promise.resolve().then(() => {
        fastScanMicrotaskScheduled = false;
        if (!disposed) {
          runFastThoughtAndTriggerScan();
        }
      });
    }
    if (!scanTimerScheduled) {
      scanTimerScheduled = true;
      setTimeout(() => {
        scanTimerScheduled = false;
        if (disposed) return;
        if (document.body) {
          localizeStaticUiInRoot(document.body);
          ensureNativeSettingsModalIntegration();
          ensureThinkingDisplayMenuIntegration();
          if (
            document.getElementById('agy-ko-translator-modal') &&
            !document.querySelector('[data-testid="agy-ko-translate-thinking-switch"]') &&
            typeof refreshTranslatorSettingsUi === 'function'
          ) {
            refreshTranslatorSettingsUi();
          }
        }
        runFastThoughtAndTriggerScan();
        if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
          observer.takeRecords();
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
      if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        const tEl = m.target && m.target.nodeType === 1 ? m.target : m.target?.parentElement;
        if (
          tEl &&
          tEl.closest &&
          (tEl.closest('.agy-ko-thought-wrap') ||
            tEl.closest('.agy-ko-settings-root') ||
            tEl.classList?.contains('agy-ko-trigger-label'))
        ) {
          continue;
        }
        scheduleCoalescedScan();
        return;
      }
      if (m.type === 'characterData' && m.target) {
        const parent = m.target.parentElement;
        if (
          parent &&
          !parent.classList.contains('agy-ko-trigger-label') &&
          !parent.closest('.agy-ko-thought-wrap') &&
          m.target.__agyKoApplied !== (m.target.nodeValue || '').trim()
        ) {
          scheduleCoalescedScan();
          return;
        }
      }
      if (m.type === 'attributes' && m.target && m.target.closest) {
        if (m.attributeName === 'data-cascade-id') {
          guardSessionSwitchTransitions();
          scheduleCoalescedScan();
          return;
        }
        if (m.attributeName === 'aria-expanded') {
          // Ignore self-induced programmatic expand/collapse or rAF transition state inside an already auto-expanded collapsible
          if (
            m.target.__agyProgrammaticClick ||
            (m.target.getAttribute &&
              m.target.getAttribute('data-agy-auto-expanded') === '1' &&
              m.target.getAttribute('aria-expanded') === 'true')
          ) {
            continue;
          }
          scheduleCoalescedScan();
          return;
        }
        if (
          m.attributeName === 'class' &&
          m.target.getAttribute &&
          m.target.getAttribute('data-agy-orig-label') === '1'
        ) {
          scheduleCoalescedScan();
          return;
        }
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
    if (document.addEventListener) {
      document.addEventListener('click', onTriggerButtonClickCapture, true);
    }
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'aria-expanded', 'class', 'data-cascade-id'],
    });
    loadPersistentTranslatorSettings();
    registerStatusbarTranslatorAdapter();
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
    if (sessionSwitchFreezeTimer) clearTimeout(sessionSwitchFreezeTimer);
    observer.disconnect();
    if (document.removeEventListener) {
      document.removeEventListener('click', onTriggerButtonClickCapture, true);
    }
    delete window.__agyKoLocalizerActive;
    unregisterStatusbarTranslatorAdapter(fullRestore);
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
        '#agy-ko-settings-card, #agy-ko-settings-pane, #agy-ko-model-menu-thinking-row, #agy-ko-appearance-thinking-row, button[data-testid="settings-nav-item-KoTranslator"]'
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
        if (el.__agyOrigLabelText && !el.textContent) {
          el.textContent = el.__agyOrigLabelText;
        }
        delete el.__agyOrigLabelText;
        el.removeAttribute('data-agy-orig-label');
        el.style.display = '';
      });
      document.querySelectorAll('.cursor-edit[data-agy-ko-ready]').forEach((el) => {
        el.removeAttribute('data-agy-ko-ready');
      });
      document.querySelectorAll('[data-agy-auto-expanded]').forEach((el) => {
        el.removeAttribute('data-agy-auto-expanded');
      });
      if (document.documentElement) {
        document.documentElement.removeAttribute('data-agy-hide-thinking');
      }
      restoreAllMutatedNodes();
    }
  };
