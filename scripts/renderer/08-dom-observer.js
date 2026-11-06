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
      '[data-testid="agent-input-box"], [data-testid="model-selector-trigger"], [data-testid="permissions-preset-selector"], ' +
      'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"], ' +
      '[data-testid="planner-response-text"], [data-testid="user-message-bubble"], ' +
      '[data-uri], [data-quotable-inline="true"], .cursor-edit';
    const selector = forAttributes ? baseExcluded : 'textarea, ' + baseExcluded;
    if (el.closest(selector)) {
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
        !/\[🔑\s*(?:Auth Header Configured|인증 헤더 설정됨)\]/.test(txt)
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

  function scanTriggerButtonsSync(forceCollapseAll = false) {
    ensureStyle();
    if (typeof syncShowThinkingDomAttribute === 'function') {
      syncShowThinkingDomAttribute();
    }
    const autoExpand = typeof isShowThinkingEnabled === 'function' ? isShowThinkingEnabled() : true;
    const workedBtns = document.querySelectorAll('button[data-testid="worked-for-collapsible"]');
    for (const btn of workedBtns) {
      processTriggerButton(btn);
      if (autoExpand) {
        if (
          btn.getAttribute('aria-expanded') === 'false' &&
          !btn.__agyUserCollapsed &&
          doesWorkedForButtonContainThinking(btn)
        ) {
          expandTriggerButtonIfNeeded(btn);
        }
      } else if (
        btn.getAttribute('aria-expanded') === 'true' &&
        (forceCollapseAll || btn.__agyAutoExpanded || btn.getAttribute('data-agy-auto-expanded') === '1') &&
        doesWorkedForButtonContainThinking(btn)
      ) {
        collapseTriggerButtonIfNeeded(btn);
      }
    }
    const toolGroupBtns = document.querySelectorAll('button[data-testid="tool-group-collapsible"]');
    for (const btn of toolGroupBtns) {
      processTriggerButton(btn);
      if (autoExpand) {
        if (
          btn.getAttribute('aria-expanded') === 'false' &&
          !btn.__agyUserCollapsed &&
          doesToolGroupButtonContainThinking(btn)
        ) {
          expandTriggerButtonIfNeeded(btn);
        }
      } else if (
        btn.getAttribute('aria-expanded') === 'true' &&
        (forceCollapseAll || btn.__agyAutoExpanded || btn.getAttribute('data-agy-auto-expanded') === '1') &&
        doesToolGroupButtonContainThinking(btn)
      ) {
        collapseTriggerButtonIfNeeded(btn);
      }
    }
    const thinkingBtns = document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]');
    for (const btn of thinkingBtns) {
      processTriggerButton(btn);
      if (autoExpand) {
        if (btn.getAttribute('aria-expanded') === 'false' && !btn.__agyUserCollapsed) {
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
    if (rcEl && rcEl.__ngContext__) {
      const ctx = rcEl.__ngContext__;
      const list = Array.isArray(ctx) ? ctx : Array.isArray(ctx.lView) ? ctx.lView : [ctx.component, ctx];
      for (const item of list) {
        if (item && typeof item === 'object' && typeof item.proxyCommand === 'function') {
          window.__agyRemoteControlInstance = item;
          return item;
        }
      }
    }
    const nsRoot = window.default_GoogleAntigravity;
    if (nsRoot && typeof nsRoot === 'object') {
      for (const k of Object.keys(nsRoot)) {
        const mod = nsRoot[k];
        if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) continue;
        const RC = mod.RemoteControlComponent || (typeof mod.prototype?.proxyCommand === 'function' ? mod : null);
        if (RC && RC.prototype && typeof RC.prototype.handleIframeMessage === 'function') {
          if (!RC.prototype.__agyKoProbeHooked) {
            RC.prototype.__agyKoProbeHooked = true;
            const origMsg = RC.prototype.handleIframeMessage;
            RC.prototype.handleIframeMessage = function (ev) {
              window.__agyRemoteControlInstance = this;
              if (ev && ev.data === '__agy_ko_probe__') return;
              return origMsg.apply(this, arguments);
            };
          }
          try {
            if (typeof MessageEvent === 'function') {
              window.dispatchEvent(new MessageEvent('message', { data: '__agy_ko_probe__' }));
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

  function bridgeRemoteControlIframe() {
    if (!document || typeof window.__agyMountKoThoughtLocalizer !== 'function') return;
    const rcEl = document.querySelector('ga-remote-control');
    if (!rcEl) return;

    // Auto-load antigravity-statusbar in Remote Control host if not yet active
    if (!window.agyStatusBar && !window.__agyKoFetchingStatusBar && typeof fetch === 'function') {
      window.__agyKoFetchingStatusBar = true;
      fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js?t=' + Date.now())
        .then((r) => (r && r.ok ? r.text() : ''))
        .then((code) => {
          if (!code || window.agyStatusBar) return;
          const s = document.createElement('script');
          const nonce = document.querySelector('script[nonce]')?.nonce;
          const p = getTrustedPolicyForRemote();
          if (nonce) s.nonce = nonce;
          s.text = p ? p.createScript(code) : code;
          (document.head || document.documentElement).appendChild(s);
          refreshStatusbarTranslatorAdapter();
        })
        .catch(() => {});
    }

    const iframe = rcEl.querySelector('iframe');
    if (!iframe) return;

    try {
      const cw = iframe.contentWindow;
      const cd = iframe.contentDocument;
      const rootEl = cd && cd.getElementById ? cd.getElementById('root') : null;
      if (
        cw &&
        cd &&
        cd.body &&
        cw.location &&
        cw.location.origin === window.location.origin &&
        (cw.__agyMainBooted || (rootEl && rootEl.childElementCount > 0))
      ) {
        if (cw.__agyKoLocalizerActive !== KO_LOCALIZER_VERSION) {
          window.__agyMountKoThoughtLocalizer(cw, cd);
        }
        return;
      }
    } catch (e) {}

    if (iframe.__agyKoPromoted === KO_LOCALIZER_VERSION) return;
    const rcInst = getRemoteControlComponentInstance(rcEl);
    if (!rcInst) return;

    const rawSrc =
      (typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
      iframe.getAttribute('src') ||
      iframe.src ||
      '';
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
    const savedChildPath =
      new URLSearchParams(window.location.search || '').get('p') ||
      rcInst.lastSyncedChildPath ||
      rcInst.initialChildPath ||
      '';
    if (savedChildPath) {
      rcInst.initialChildPath = savedChildPath;
    }

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
            }
            return decorated;
          };
        } catch (e) {}

        try {
          cw.history.replaceState(null, '', `${basePath}/?iframe=true`);
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
          if (typeof origLoad === 'function' && !cw.__initialConfigReceived) {
            try {
              origLoad.call(rcInst);
            } catch (e) {}
          }
          try {
            if (typeof rcInst.markIframeReady === 'function') {
              rcInst.markIframeReady();
            } else {
              rcInst.iframeLoading?.set?.(false);
              rcInst.iframeUiReady?.set?.(true);
            }
          } catch (e) {}
          window.__agyMountKoThoughtLocalizer(cw, cd);
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
    iframe.addEventListener('load', onBlankLoad, { once: true });
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
      if (
        document.getElementById('agy-ko-translator-modal') &&
        !document.querySelector('[data-testid="agy-ko-show-thinking-switch"]') &&
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

  // Fast pre-paint pass for Thinking/Worked triggers and .cursor-edit blocks (prevents session-switch FOUC)
  // paired with a 16ms coalesced timer for full-document static UI localization (prevents main-thread starvation/freeze).
  let inFastScan = false;
  let scanTimerScheduled = false;

  function runFastThoughtAndTriggerScan() {
    ensureVerboseConversationStepsEnabled();
    if (disposed || inFastScan) return;
    inFastScan = true;
    try {
      scanTriggerButtonsSync();
      const mcpModal = document.getElementById('agy-mcp-manager-modal-backdrop');
      if (mcpModal) localizeStaticUiInRoot(mcpModal);
      const mcpEditPopup = document.getElementById('agy-mcp-edit-popup-backdrop');
      if (mcpEditPopup) localizeStaticUiInRoot(mcpEditPopup);
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
    runFastThoughtAndTriggerScan();
    if (!scanTimerScheduled) {
      scanTimerScheduled = true;
      setTimeout(() => {
        scanTimerScheduled = false;
        if (disposed) return;
        if (document.body) {
          localizeStaticUiInRoot(document.body);
          ensureNativeSettingsModalIntegration();
      if (
        document.getElementById('agy-ko-translator-modal') &&
        !document.querySelector('[data-testid="agy-ko-show-thinking-switch"]') &&
        typeof refreshTranslatorSettingsUi === 'function'
      ) {
        refreshTranslatorSettingsUi();
      }
        }
        runFastThoughtAndTriggerScan();
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
        if (m.attributeName === 'aria-expanded') {
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
      attributeFilter: ['style', 'aria-expanded', 'class'],
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
        '#agy-ko-settings-card, #agy-ko-settings-pane, button[data-testid="settings-nav-item-KoTranslator"]'
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
