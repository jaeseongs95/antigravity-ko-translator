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

  function processTriggerButton(btn) {
    const spans = Array.from(btn.querySelectorAll(':scope > span'));
    const origSpan = spans.find((s) => !s.classList.contains('agy-ko-trigger-label'));
    if (!origSpan) return;

    const rawText = (origSpan.textContent || '').trim();
    const koText = translateStaticUiSync(rawText);
    if (!koText) return;

    if (origSpan.getAttribute('data-agy-orig-label') !== '1') {
      origSpan.setAttribute('data-agy-orig-label', '1');
    }
    if (origSpan.style.display !== 'none') {
      origSpan.style.display = 'none';
    }
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
        const chSrc = (ch.textContent || '').trim();
        const syncNode = tryTranslateBlockElementSync(ch);
        let initialNode = syncNode;
        if (!initialNode) {
          const prevSlot = prevWrapChildren[idx];
          if (
            prevSlot &&
            prevSlot.getAttribute('data-agy-src') === chSrc &&
            /[가-힣]/.test(prevSlot.textContent || '')
          ) {
            initialNode = prevSlot.cloneNode(true);
          } else {
            initialNode = ch.cloneNode(true);
          }
        }
        initialNode.setAttribute('data-agy-src', chSrc);
        nextFragment.appendChild(initialNode);
        return { orig: ch, slot: initialNode, alreadyDone: !!syncNode, src: chSrc };
      });

      wrap.textContent = '';
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
        wrap.textContent = '';
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
          wrap.textContent = '';
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
    try {
      document.querySelectorAll('iframe').forEach((ifr) => {
        try {
          const cw = ifr.contentWindow;
          if (cw && cw !== window && typeof cw.__agyRetranslateVisibleThoughts === 'function') {
            cw.__agyRetranslateVisibleThoughts(clearCache);
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
      fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js')
        .then((r) => (r && r.ok ? r.text() : ''))
        .then((code) => {
          if (!code || window.agyStatusBar) return;
          const s = document.createElement('script');
          const nonce = document.querySelector('script[nonce]')?.nonce;
          const p = getTrustedPolicyForRemote();
          if (nonce) s.nonce = nonce;
          s.text = p ? p.createScript(code) : code;
          (document.head || document.documentElement).appendChild(s);
          registerStatusbarTranslatorAdapter();
        })
        .catch(() => {});
    }

    const iframe = rcEl.querySelector('iframe');
    if (!iframe) return;

    try {
      const cw = iframe.contentWindow;
      const cd = iframe.contentDocument;
      if (cw && cd && cd.body && cw.location && cw.location.origin === window.location.origin) {
        if (cw.__agyKoLocalizerActive !== KO_LOCALIZER_VERSION) {
          window.__agyMountKoThoughtLocalizer(cw, cd);
        }
        return;
      }
    } catch (e) {}

    if (iframe.__agyKoPromoted) return;
    const rcInst = getRemoteControlComponentInstance(rcEl);
    if (!rcInst) return;

    const rawSrc =
      iframe.getAttribute('src') ||
      (typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
      iframe.src ||
      '';
    if (!rawSrc || !rawSrc.includes('?iframe=true')) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(rawSrc, window.location.href);
    } catch (e) {
      return;
    }
    const staticOrigin = parsedUrl.origin;
    const basePath = parsedUrl.pathname.replace(/\/+$/, '');
    const verMatch = basePath.match(/\/web\/([^/]+)/);
    const appVersion = verMatch ? verMatch[1] : '2.28.2';

    iframe.__agyKoPromoted = true;
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

        const ttPolicy = getTrustedPolicyForRemote();
        const shellHtml =
          `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">` +
          `<link rel="stylesheet" href="${staticOrigin}${basePath}/jetbox.css">` +
          `<link rel="stylesheet" href="${staticOrigin}${basePath}/compiled_tailwind.css">` +
          `<style>html,body,#root{height:100%;margin:0;overflow:hidden;background-color:transparent;overscroll-behavior:none;}</style>` +
          `</head><body><div id="root"></div></body></html>`;

        cd.open();
        cd.write(ttPolicy ? ttPolicy.createHTML(shellHtml) : shellHtml);
        cd.close();

        try {
          cw.history.replaceState(null, '', `${basePath}/?iframe=true`);
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
        try {
          cw.document.documentElement.style.colorScheme = 'dark';
        } catch (e) {}

        const nonce = document.querySelector('script[nonce]')?.nonce || '';
        const prismScript = cd.createElement('script');
        if (nonce) prismScript.nonce = nonce;
        prismScript.async = false;
        const prismUrl = `${staticOrigin}${basePath}/prism_bundle.js`;
        prismScript.src = ttPolicy ? ttPolicy.createScriptURL(prismUrl) : prismUrl;

        const mainScript = cd.createElement('script');
        if (nonce) mainScript.nonce = nonce;
        mainScript.async = false;
        const mainUrl = `${staticOrigin}${basePath}/main.js`;
        mainScript.src = ttPolicy ? ttPolicy.createScriptURL(mainUrl) : mainUrl;

        mainScript.onload = () => {
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

        cd.head.appendChild(prismScript);
        cd.head.appendChild(mainScript);
      } catch (e) {}
    };

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
    if (disposed || inFastScan) return;
    inFastScan = true;
    try {
      scanTriggerButtonsSync();
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
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        scheduleCoalescedScan();
        return;
      }
      if (m.type === 'characterData' && m.target) {
        const parent = m.target.parentElement;
        if (
          parent &&
          (parent.closest('.cursor-edit') ||
            parent.closest('button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"]')) &&
          !parent.classList.contains('agy-ko-trigger-label') &&
          !parent.closest('.agy-ko-thought-wrap')
        ) {
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
        el.removeAttribute('data-agy-orig-label');
        el.style.display = '';
      });
      document.querySelectorAll('.cursor-edit[data-agy-ko-ready]').forEach((el) => {
        el.removeAttribute('data-agy-ko-ready');
      });
      restoreAllMutatedNodes();
    }
  };
