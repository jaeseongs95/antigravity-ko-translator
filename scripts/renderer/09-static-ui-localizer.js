// Module: 09-static-ui-localizer.js
// Responsibility: Subtree exclusion policy, attribute localizer, dynamic ask_question/permission widget translator, and 0ms TreeWalker static UI localizer.
  // Excludes:
  // 1) Statusbar & custom no-translate roots (`[data-agy-no-translate="true"]`, `.agy-ctx-statusbar`, `.agy-ctx-menu`, `#agy-ctx-debug-modal`, `.agy-ctx-modal-backdrop`)
  // 2) Input box toolbar (`[data-testid="agent-input-box"]`, `[data-testid="model-selector-trigger"]`, `[data-testid="permissions-preset-selector"]`)
  // 3) Thinking/Worked trigger buttons (handled by non-destructive sibling spans)
  // 4) Chat messages, code blocks, editors, terminals, file links
  const CUSTOM_NO_TRANSLATE_SUBTREE_SELECTOR =
    '[data-agy-no-translate="true"], .agy-ctx-statusbar, .agy-ctx-menu, #agy-ctx-debug-modal, .agy-ctx-modal-backdrop, ' +
    '#agy-mcp-manager-modal-backdrop, #agy-mcp-edit-popup-backdrop, #agy-mcp-oauth-connect-backdrop, #agy-mcp-settings-pane, ' +
    '.agy-ko-thought-wrap, .agy-ko-settings-root, #agy-ko-translator-modal';

  function isExcludedFromStaticUiLocalization(el, forAttributes = false) {
    if (!el || !el.closest) return true;
    const baseExcluded =
      'style, script, code, pre, [contenteditable="true"], .monaco-editor, .xterm, ' +
      '[data-agy-no-translate="true"], .agy-ctx-statusbar, .agy-ctx-menu, #agy-ctx-debug-modal, .agy-ctx-modal-backdrop, ' +
      '.agy-ko-settings-root, #agy-ko-translator-modal, ' +
      '[data-testid="model-selector-trigger"], [data-testid="permissions-preset-selector"], [data-testid="permissions-selector-trigger"], ' +
      'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"], ' +
      '[data-testid="side-question-answer"] button[aria-expanded], ' +
      '[data-testid="planner-response-text"], [data-testid="user-message-bubble"], ' +
      '[data-testid="side-question-followup-user"], [data-testid="browser-subagent-thinking"], ' +
      '[data-uri], [data-quotable-inline="true"], .cursor-edit, [data-agy-ko-thought-host="1"]';
    const selector = forAttributes ? baseExcluded : 'textarea, ' + baseExcluded;
    if (el.closest(selector)) {
      return true;
    }
    if (!forAttributes && el.closest('[data-testid="side-question-question"]')) {
      const txt = (el.textContent || '').trim();
      if (
        el.tagName === 'SPAN' &&
        (txt === 'Side Question' ||
          txt === 'Side Question:' ||
          txt === '사이드 질문' ||
          txt === '사이드 질문:' ||
          txt === 'Help' ||
          txt === 'Help:' ||
          txt === '도움말' ||
          txt === '도움말:')
      ) {
        return false;
      }
      return true;
    }
    if (!forAttributes && el.closest('[data-testid="side-question-answer"]')) {
      if (
        el.closest(
          '[data-testid="side-question-tool-status"], [data-testid="side-question-waiting-status"], [data-testid="side-question-followup-thinking"]'
        )
      ) {
        return false;
      }
      const txt = (el.textContent || '').trim();
      if (txt === 'Thinking...' || txt === '생각하는 중...') {
        return false;
      }
      return true;
    }
    if (el.closest('[data-testid="agent-input-box"]')) {
      const inQueuedCard = el.closest('[data-testid="queued-messages-card"]');
      if (inQueuedCard) {
        if (!forAttributes && el.classList && el.classList.contains('line-clamp-2')) {
          const txt = (el.textContent || '').trim();
          if (
            txt !== 'Empty message' &&
            txt !== '빈 메시지' &&
            !/^\d+\s+comments?$/i.test(txt) &&
            !/^댓글\s+\d+개$/.test(txt)
          ) {
            return true;
          }
        }
        return false;
      }
      if (!forAttributes) {
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
    if (testId === 'conversation-row-sidebar' || testId === 'conversation-row-history') {
      if (forAttributes && el.tagName === 'BUTTON') return false;
      if (!forAttributes && el.closest('[data-screenshot-volatile="true"]')) return false;
      return true;
    }
    if (testId === 'breadcrumb-segment') {
      return true;
    }
    if (testId === 'project-header') {
      const headerEl =
        (el.getAttribute && el.getAttribute('data-testid') === 'project-header' ? el : null) ||
        (el.closest ? el.closest('[data-testid="project-header"]') : null);
      const projLabel =
        (headerEl && headerEl.getAttribute && headerEl.getAttribute('data-project-label')) ||
        (el.textContent || '').trim();
      const trimmedLabel = (projLabel || '').trim();
      if (
        trimmedLabel === 'CLI Project' ||
        trimmedLabel === 'CLI 프로젝트' ||
        trimmedLabel === 'No Project' ||
        trimmedLabel === '프로젝트 없음' ||
        trimmedLabel === 'Not in Project' ||
        trimmedLabel === '프로젝트 미지정' ||
        trimmedLabel === 'Outside of Project' ||
        trimmedLabel === '프로젝트 외부' ||
        trimmedLabel === 'Untitled project' ||
        trimmedLabel === '이름 없는 프로젝트'
      ) {
        return false;
      }
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
      if (
        !isAlreadyKoreanOrNonEnglish(raw) &&
        el.childNodes.length === 1 &&
        el.firstChild.nodeType === Node.TEXT_NODE &&
        el.__agyDynamicSource !== raw &&
        !el.__agyTranslatingDynamic
      ) {
        el.__agyDynamicSource = raw;
        el.__agyTranslatingDynamic = true;
        translateThoughtTextEnToKo(raw)
          .then((ko) => {
            const wasTranslating = Boolean(el.__agyTranslatingDynamic);
            delete el.__agyTranslatingDynamic;
            if (disposed || !wasTranslating || !ko || ko === raw || !el.isConnected) {
              if (el.__agyDynamicSource === raw) delete el.__agyDynamicSource;
              return;
            }
            if (
              (el.textContent || '').trim() !== raw ||
              el.childNodes.length !== 1 ||
              el.firstChild.nodeType !== Node.TEXT_NODE
            ) {
              if (el.__agyDynamicSource === raw) delete el.__agyDynamicSource;
              return;
            }
            const tn = el.firstChild;
            if (!tn.__agyOrigValue) tn.__agyOrigValue = tn.nodeValue;
            tn.__agyKoApplied = ko;
            tn.nodeValue = ko;
          })
          .catch(() => {
            delete el.__agyTranslatingDynamic;
            if (el.__agyDynamicSource === raw) delete el.__agyDynamicSource;
          });
      }
    }
  }

  const STATIC_UI_SUBTREE_PRUNE_SELECTOR =
    'style, script, code, pre, textarea, [contenteditable="true"], .monaco-editor, .xterm, ' +
    '[data-agy-no-translate="true"], .agy-ctx-statusbar, .agy-ctx-menu, #agy-ctx-debug-modal, .agy-ctx-modal-backdrop, ' +
    '#agy-mcp-manager-modal-backdrop, #agy-mcp-edit-popup-backdrop, #agy-mcp-oauth-connect-backdrop, #agy-mcp-settings-pane, ' +
    '.agy-ko-settings-root, #agy-ko-translator-modal, ' +
    '[data-testid="model-selector-trigger"], [data-testid="permissions-preset-selector"], [data-testid="permissions-selector-trigger"], ' +
    'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"], ' +
    '[data-testid="side-question-answer"] button[aria-expanded], ' +
    '[data-testid="planner-response-text"], [data-testid="user-message-bubble"], ' +
    '[data-testid="side-question-followup-user"], [data-testid="browser-subagent-thinking"], ' +
    '[data-uri], [data-quotable-inline="true"], .cursor-edit, [data-agy-ko-thought-host="1"]';

  function localizeStaticUiInRoot(rootNode) {
    if (!rootNode) return;
    if (
      rootNode.nodeType === 1 &&
      typeof rootNode.getAttribute === 'function' &&
      rootNode.getAttribute('data-agy-no-translate') === 'true'
    ) {
      return;
    }
    localizeAttributesInRoot(rootNode);
    const showFilter =
      typeof NodeFilter !== 'undefined' && NodeFilter
        ? (NodeFilter.SHOW_ELEMENT || 1) | (NodeFilter.SHOW_TEXT || 4)
        : 4;
    const walker = document.createTreeWalker(rootNode, showFilter, {
      acceptNode(node) {
        if (!node) return typeof NodeFilter !== 'undefined' && NodeFilter.FILTER_REJECT ? NodeFilter.FILTER_REJECT : 2;
        if (node.nodeType === 1) {
          if (
            node !== rootNode &&
            typeof node.matches === 'function' &&
            node.matches(STATIC_UI_SUBTREE_PRUNE_SELECTOR)
          ) {
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

      if (textNode.__agyOrigValue && textNode.__agyOrigValue.trim() === 'New') {
        const btn = parent.closest('button');
        const isStandaloneNewBtn =
          !!btn &&
          !btn.closest('[role="menu"], [role="listbox"], [role="menuitem"]') &&
          ((btn.textContent || '').trim() === 'New' || (btn.textContent || '').trim() === '새로 만들기');
        if (!isStandaloneNewBtn) {
          textNode.nodeValue = textNode.__agyOrigValue;
          delete textNode.__agyOrigValue;
          delete textNode.__agyKoApplied;
          continue;
        }
      }

      if (textNode.__agyKoApplied === trimmed && !/^\(권장\)\s+[A-Za-z]/.test(trimmed)) continue;

      let syncKo;
      if (trimmed === 'New') {
        const btn = parent.closest('button');
        const isStandaloneNewBtn =
          !!btn &&
          !btn.closest('[role="menu"], [role="listbox"], [role="menuitem"]') &&
          ((btn.textContent || '').trim() === 'New' || (btn.textContent || '').trim() === '새로 만들기');
        syncKo = isStandaloneNewBtn ? '새로 만들기' : null;
      } else if (
        trimmed === 'Type' &&
        textNode.nextSibling &&
        textNode.nextSibling.nodeType === 1 &&
        (textNode.nextSibling.tagName === 'KBD' || textNode.nextSibling.tagName === 'CODE')
      ) {
        syncKo = '채팅창에';
      } else {
        syncKo = translateStaticUiSync(trimmed);
      }
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
