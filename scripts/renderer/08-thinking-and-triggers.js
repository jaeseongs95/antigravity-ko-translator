// Module: 08-thinking-and-triggers.js
// Responsibility: Streaming Thinking block DOM renderer (.cursor-edit, Side Question, Browser Subagent), active-turn predicates, and non-destructive collapsible trigger labels.
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
    const resetHost = (el) => {
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
    };
    document.querySelectorAll('.cursor-edit').forEach(resetHost);
    document.querySelectorAll('[data-agy-ko-thought-host="1"]').forEach(resetHost);
    document.querySelectorAll('[data-testid="browser-subagent-thinking"] span').forEach((el) => {
      delete el.__agyDynamicSource;
      delete el.__agyTranslatingDynamic;
      if (el.firstChild && el.firstChild.__agyOrigValue !== undefined) {
        el.firstChild.nodeValue = el.firstChild.__agyOrigValue;
        delete el.firstChild.__agyOrigValue;
        delete el.firstChild.__agyKoApplied;
      }
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

  function doesWorkedForButtonContainThinking(btn) {
    if (!btn) return false;
    if (btn.__agyHasThinking) return true;
    try {
      let cur =
        typeof getReactFiberFromElement === 'function'
          ? getReactFiberFromElement(btn)
          : (() => {
              const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
              return fk ? btn[fk] : null;
            })();
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
      let cur =
        typeof getReactFiberFromElement === 'function'
          ? getReactFiberFromElement(btn)
          : (() => {
              const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
              return fk ? btn[fk] : null;
            })();
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
      let cur =
        typeof getReactFiberFromElement === 'function'
          ? getReactFiberFromElement(btn)
          : (() => {
              const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
              return fk ? btn[fk] : null;
            })();
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
    let sawLocalActiveFalse = false;
    try {
      let cur =
        typeof getReactFiberFromElement === 'function'
          ? getReactFiberFromElement(btn)
          : (() => {
              const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
              return fk ? btn[fk] : null;
            })();
      for (let i = 0; i < 36 && cur; i++) {
        const mp = cur.memoizedProps;
        if (mp && typeof mp === 'object') {
          if (mp.segment && typeof mp.segment === 'object') {
            if (mp.segment.isLatest === false || mp.segment.isActive === false) return false;
            if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
            if (mp.segment.isLatest === true || mp.segment.isActive === true) return true;
          }
          if (mp.isLastContainer === true || mp.isLastTurn === true) return true;
          if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
          if (mp.container && typeof mp.container === 'object') {
            if (mp.container.isLatest === true || mp.container.isActive === true) return true;
            if (mp.container.isLatest === false || mp.container.isActive === false) return false;
          }
          // Immediate wrapper (e.g. yhc / G_ at depth <= 6) carries turn/step-local isActive/isRunning,
          // whereas higher container fibers (Lhc/oic/pCb at depth 16..31) carry conversation-wide isRunning (status === RUNNING).
          if (i <= 6) {
            if (mp.isActive === true) return true;
            if (mp.isActive === false || mp.isRunning === false) {
              sawLocalActiveFalse = true;
            }
          }
        }
        cur = cur.return;
      }
    } catch (e) {}
    if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
      const latestTurnEl = document.querySelector('[data-turn-content="latest"]');
      if (latestTurnEl && typeof latestTurnEl.contains === 'function') {
        return Boolean(latestTurnEl.contains(btn));
      }
    }
    if (
      typeof document !== 'undefined' &&
      document &&
      typeof document.querySelectorAll === 'function' &&
      typeof btn.compareDocumentPosition === 'function' &&
      typeof Node !== 'undefined'
    ) {
      const userBubbles = document.querySelectorAll('[data-testid="user-message-bubble"]');
      for (const ub of userBubbles) {
        if (ub && (btn.compareDocumentPosition(ub) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
          return false;
        }
      }
    }
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
      if (sawLocalActiveFalse) {
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
    let sawLocalActiveFalse = false;
    try {
      let cur =
        typeof getReactFiberFromElement === 'function'
          ? getReactFiberFromElement(btn)
          : (() => {
              const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
              return fk ? btn[fk] : null;
            })();
      for (let i = 0; i < 36 && cur; i++) {
        const mp = cur.memoizedProps;
        if (mp && typeof mp === 'object') {
          if (mp.segment && typeof mp.segment === 'object') {
            if (mp.segment.isLatest === false || mp.segment.isActive === false) return false;
            if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
            if (mp.segment.isLatest === true || mp.segment.isActive === true) return true;
          }
          if (mp.isLastContainer === true || mp.isLastTurn === true) return true;
          if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
          if (mp.container && typeof mp.container === 'object') {
            if (mp.container.isLatest === true || mp.container.isActive === true) return true;
            if (mp.container.isLatest === false || mp.container.isActive === false) return false;
          }
          if (i <= 6) {
            if (mp.isActive === true) return true;
            if (mp.isActive === false || mp.isRunning === false) {
              sawLocalActiveFalse = true;
            }
          }
        }
        cur = cur.return;
      }
    } catch (e) {}
    if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
      const latestTurnEl = document.querySelector('[data-turn-content="latest"]');
      if (latestTurnEl && typeof latestTurnEl.contains === 'function') {
        return Boolean(latestTurnEl.contains(btn));
      }
    }
    if (
      typeof document !== 'undefined' &&
      document &&
      typeof document.querySelectorAll === 'function' &&
      typeof btn.compareDocumentPosition === 'function' &&
      typeof Node !== 'undefined'
    ) {
      const userBubbles = document.querySelectorAll('[data-testid="user-message-bubble"]');
      for (const ub of userBubbles) {
        if (ub && (btn.compareDocumentPosition(ub) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
          return false;
        }
      }
    }
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
      if (sawLocalActiveFalse) {
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
    if (sawLocalActiveFalse) {
      return false;
    }
    if (Array.isArray(thinkingBtns) && thinkingBtns.length > 0) {
      return btn === thinkingBtns[thinkingBtns.length - 1];
    }
    return false;
  }

  function isWorkedForInActiveOrLatestTurn(btn, isLastInDomList) {
    if (!btn) return false;
    let sawLocalActiveFalse = false;
    try {
      let cur =
        typeof getReactFiberFromElement === 'function'
          ? getReactFiberFromElement(btn)
          : (() => {
              const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
              return fk ? btn[fk] : null;
            })();
      for (let i = 0; i < 36 && cur; i++) {
        const mp = cur.memoizedProps;
        if (mp && typeof mp === 'object') {
          if (mp.segment && typeof mp.segment === 'object') {
            if (mp.segment.isLatest === false || mp.segment.isActive === false) return false;
            if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
            if (mp.segment.isLatest === true || mp.segment.isActive === true) return true;
          }
          if (mp.isLastContainer === true || mp.isLastTurn === true) return true;
          if (mp.isLastContainer === false || mp.isLastTurn === false) return false;
          if (mp.container && typeof mp.container === 'object') {
            if (mp.container.isLatest === true || mp.container.isActive === true) return true;
            if (mp.container.isLatest === false || mp.container.isActive === false) return false;
          }
          if (i <= 6) {
            if (mp.isActive === true) return true;
            if (mp.isActive === false || mp.isRunning === false) {
              sawLocalActiveFalse = true;
            }
          }
        }
        cur = cur.return;
      }
    } catch (e) {}
    if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
      const latestTurnEl = document.querySelector('[data-turn-content="latest"]');
      if (latestTurnEl && typeof latestTurnEl.contains === 'function') {
        return Boolean(latestTurnEl.contains(btn));
      }
    }
    if (
      typeof document !== 'undefined' &&
      document &&
      typeof document.querySelectorAll === 'function' &&
      typeof btn.compareDocumentPosition === 'function' &&
      typeof Node !== 'undefined'
    ) {
      const userBubbles = document.querySelectorAll('[data-testid="user-message-bubble"]');
      for (const ub of userBubbles) {
        if (ub && (btn.compareDocumentPosition(ub) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
          return false;
        }
      }
    }
    if (sawLocalActiveFalse) {
      return false;
    }
    return Boolean(isLastInDomList);
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
      const isLastWorked = isWorkedForInActiveOrLatestTurn(btn, i === workedBtns.length - 1);
      processTriggerButton(btn);
      if (!nativeVerboseSteps) {
        continue;
      }
      if (isHiddenActiveWorkedForButton(btn)) {
        if (btn.getAttribute('aria-expanded') === 'false') {
          btn.__agyUserCollapsed = false;
          expandTriggerButtonIfNeeded(btn);
        }
        continue;
      }
      if (isLastWorked) {
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
    const sideQuestionBtns = document.querySelectorAll('[data-testid="side-question-answer"] button[aria-expanded]');
    for (const btn of sideQuestionBtns) {
      processTriggerButton(btn);
    }
  }

  function scanSideQuestionAndBrowserSubagentThoughts() {
    if (!document || typeof document.querySelectorAll !== 'function') return;
    const sqBtns = document.querySelectorAll('[data-testid="side-question-answer"] button[aria-expanded]');
    for (const btn of sqBtns) {
      processTriggerButton(btn);
      const panel = btn.nextElementSibling;
      if (!panel || panel.tagName !== 'DIV') continue;
      let hostEl = panel.querySelector ? panel.querySelector('.cursor-edit') : null;
      if (!hostEl && typeof panel.querySelectorAll === 'function') {
        hostEl = Array.from(panel.querySelectorAll('div')).find(
          (d) =>
            String(d.className || '').includes('border-l') &&
            Array.from(d.children || []).some(
              (c) => c.tagName === 'DIV' && (!c.classList || !c.classList.contains('agy-ko-thought-wrap'))
            )
        );
      }
      if (
        !hostEl &&
        Array.from(panel.children || []).some(
          (c) => c.tagName === 'DIV' && (!c.classList || !c.classList.contains('agy-ko-thought-wrap'))
        )
      ) {
        hostEl = panel;
      }
      if (hostEl) {
        if (!hostEl.classList || !hostEl.classList.contains('cursor-edit')) {
          if (typeof hostEl.setAttribute === 'function') {
            hostEl.setAttribute('data-agy-ko-thought-host', '1');
          }
        }
        processCursorEdit(hostEl, btn);
      }
    }

    const browserThoughtSpans = document.querySelectorAll('[data-testid="browser-subagent-thinking"] span');
    const translateEnabled = typeof isTranslateThinkingEnabled === 'function' ? isTranslateThinkingEnabled() : true;
    for (const el of browserThoughtSpans) {
      if (!el.childNodes || el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) continue;
      const tn = el.firstChild;
      if (!translateEnabled) {
        delete el.__agyDynamicSource;
        delete el.__agyTranslatingDynamic;
        if (tn.__agyOrigValue !== undefined) {
          tn.nodeValue = tn.__agyOrigValue;
          delete tn.__agyOrigValue;
          delete tn.__agyKoApplied;
        }
        continue;
      }
      const liveVal = tn.nodeValue || '';
      const trimmed = liveVal.trim();
      if (!trimmed) continue;
      if (tn.__agyKoApplied && trimmed === tn.__agyKoApplied) continue;
      tn.__agyOrigValue = liveVal;
      if (isAlreadyKoreanOrNonEnglish(trimmed)) continue;

      const syncKo = translateStaticUiSync(trimmed);
      if (syncKo && syncKo !== trimmed) {
        tn.__agyKoApplied = syncKo;
        tn.nodeValue = syncKo;
        continue;
      }
      if (memCache.has(trimmed)) {
        const cached = memCache.get(trimmed);
        if (!isInvalidCachedOrTranslatedText(cached, trimmed)) {
          tn.__agyKoApplied = cached;
          tn.nodeValue = cached;
          continue;
        }
      }
      if (el.__agyDynamicSource !== trimmed && !el.__agyTranslatingDynamic) {
        el.__agyDynamicSource = trimmed;
        el.__agyTranslatingDynamic = true;
        translateThoughtTextEnToKo(trimmed)
          .then((ko) => {
            const wasTranslating = Boolean(el.__agyTranslatingDynamic);
            delete el.__agyTranslatingDynamic;
            if (disposed || !wasTranslating || !ko || ko === trimmed || el.isConnected === false) {
              if (el.__agyDynamicSource === trimmed) delete el.__agyDynamicSource;
              return;
            }
            if (!el.firstChild || el.firstChild.nodeType !== 3 || (el.firstChild.nodeValue || '').trim() !== trimmed) {
              if (el.__agyDynamicSource === trimmed) delete el.__agyDynamicSource;
              return;
            }
            el.firstChild.__agyOrigValue = el.firstChild.nodeValue;
            el.firstChild.__agyKoApplied = ko;
            el.firstChild.nodeValue = ko;
          })
          .catch(() => {
            delete el.__agyTranslatingDynamic;
            if (el.__agyDynamicSource === trimmed) delete el.__agyDynamicSource;
          });
      }
    }
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
    scanSideQuestionAndBrowserSubagentThoughts();
    if (isPretranslateEnabled()) {
      pretranslateCollapsedThoughtsInBackground();
    }
  }

  function retranslateVisibleThoughts(clearCache = false, _fromCrossFrame = false) {
    if (clearCache) {
      if (typeof clearTranslationCacheState === 'function') {
        clearTranslationCacheState();
      } else {
        if (typeof bumpCacheEpoch === 'function') bumpCacheEpoch();
        if (typeof saveCacheTimer !== 'undefined' && saveCacheTimer) {
          clearTimeout(saveCacheTimer);
          saveCacheTimer = null;
        }
        memCache.clear();
        inflightMap.clear();
        try {
          localStorage.removeItem(CACHE_STORAGE_KEY);
        } catch (e) {}
      }
      if (typeof resetPretranslatedHistory === 'function') {
        resetPretranslatedHistory();
      }
    } else if (typeof bumpCacheEpoch === 'function') {
      bumpCacheEpoch();
    }
    document.querySelectorAll('.cursor-edit, [data-agy-ko-thought-host="1"]').forEach((el) => {
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
    document.querySelectorAll('[data-testid="browser-subagent-thinking"] span').forEach((el) => {
      delete el.__agyDynamicSource;
      delete el.__agyTranslatingDynamic;
      if (el.firstChild && el.firstChild.__agyOrigValue !== undefined) {
        el.firstChild.nodeValue = el.firstChild.__agyOrigValue;
        delete el.firstChild.__agyKoApplied;
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
          }
        } catch (e) {}
      });
      if (
        !_fromCrossFrame &&
        window.parent &&
        window.parent !== window &&
        typeof window.parent.__agyRetranslateVisibleThoughts === 'function'
      ) {
        try {
          window.parent.__agyRetranslateVisibleThoughts(clearCache, true);
        } catch (e) {}
      }
    } catch (e) {}
    return {
      clearedCache: Boolean(clearCache),
      cacheSize: memCache.size,
      provider: activeTranslationProvider,
    };
  }
  window.__agyRetranslateVisibleThoughts = retranslateVisibleThoughts;
  if (typeof disposables !== 'undefined' && disposables) {
    disposables.registerWindowGlobal('__agyRetranslateVisibleThoughts');
  }
