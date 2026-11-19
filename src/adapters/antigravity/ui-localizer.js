'use strict';

const { isAlreadyKoreanOrNonEnglish } = require('../../core/text-tokenizer');

// D-0042 & Rev5-F7: 100% standard CSS selectors ONLY (ZERO non-standard attribute-name wildcards like [data-line-*]).
const BASE_EXCLUDED_SELECTOR =
  'style, script, code, pre, kbd, samp, var, svg, math, [contenteditable="true"], ' +
  '.monaco-editor, .xterm, .cm-editor, .cm-content, .cm-line, .shiki, .code-block, .code-line, .line-content, .token, ' +
  '[class*="language-"], ' +
  '[data-line-number], [data-line], [data-line-start], [data-line-end], [data-start-line], [data-end-line], ' +
  '[data-diff-type], [data-diff-line], [data-file-uri], [data-active-file-uri], ' +
  '[data-current-line], [data-current-start-line], [data-current-end-line], ' +
  '[data-uri], [data-symbol-name], [data-variable-name], [data-repo-slug], [data-quotable-inline], [data-quotable], ' +
  '[data-testid="code-viewer"], [data-testid="diff-viewer"], [data-testid="file-viewer"], ' +
  '[data-testid="terminal-output"], [data-testid="command-output"], [data-testid="lsp-hover"], ' +
  '[data-agy-no-translate="true"], [translate="no"], ' +
  '.agy-ko-settings-root, #agy-ko-translator-modal, .agy-ko-thought-wrap, ' +
  '[data-testid="model-selector-trigger"], [data-testid="permissions-preset-selector"], [data-testid="permissions-selector-trigger"], ' +
  'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"], ' +
  '[data-testid="side-question-answer"] button[aria-expanded], ' +
  '[data-testid="planner-response-text"], [data-testid="user-message-bubble"], ' +
  '[data-testid="side-question-followup-user"], [data-testid="browser-subagent-thinking"], ' +
  '.cursor-edit, [data-agy-ko-thought-host="1"]';

const TEXT_EXCLUDED_SELECTOR = 'textarea, ' + BASE_EXCLUDED_SELECTOR;

const STATIC_UI_SUBTREE_PRUNE_SELECTOR = TEXT_EXCLUDED_SELECTOR;

const EXCLUDED_CODE_DATA_ATTR_PREFIX_REGEX =
  /^data-(?:line-|quotable|diff-|code-|token-|syntax-|file-path|file-uri|symbol-|lsp-)/i;

function hasExcludedCodeDataAttrPrefix(el, rootBoundary = null) {
  let cur = el;
  while (cur && cur.nodeType === 1) {
    const attrs = cur.attributes;
    if (attrs && typeof attrs.length === 'number') {
      for (let i = 0; i < attrs.length; i++) {
        const attrName = attrs[i] && attrs[i].name;
        if (attrName && EXCLUDED_CODE_DATA_ATTR_PREFIX_REGEX.test(attrName)) {
          return true;
        }
      }
    }
    if (cur === rootBoundary) break;
    cur = cur.parentElement;
  }
  return false;
}

function isExcludedByFontMonoInheritance(el) {
  if (!el || typeof el.closest !== 'function') return false;
  const monoEl = el.closest('.font-mono');
  if (!monoEl) return false;
  const sansEl = el.closest('.font-sans');
  if (sansEl && typeof monoEl.contains === 'function' && monoEl.contains(sansEl)) {
    return false;
  }
  return true;
}

function createAntigravityUiLocalizer({
  targetDoc,
  catalog,
  translationService = null,
  isDisposed = () => false,
} = {}) {
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);

  function translateSync(raw) {
    return catalog && typeof catalog.translateSync === 'function' ? catalog.translateSync(raw) : null;
  }

  function isExcludedFromStaticUiLocalization(el, forAttributes = false, rootBoundary = null) {
    if (!el || typeof el.closest !== 'function') return true;
    const selector = forAttributes ? BASE_EXCLUDED_SELECTOR : TEXT_EXCLUDED_SELECTOR;
    if (el.closest(selector)) {
      return true;
    }
    if (hasExcludedCodeDataAttrPrefix(el, rootBoundary)) {
      return true;
    }
    if (!forAttributes && isExcludedByFontMonoInheritance(el)) {
      return true;
    }

    if (!forAttributes && el.closest('[data-testid="side-question-question"]')) {
      const txt = String(el.textContent || '').trim();
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
      const txt = String(el.textContent || '').trim();
      if (txt === 'Thinking...' || txt === '생각하는 중...') {
        return false;
      }
      return true;
    }

    // D-0011, D-0018 & Rev7-F5 #2: Preserve Lexical sibling <p> placeholder & queued-messages-card static labels
    if (el.closest('[data-testid="agent-input-box"]')) {
      const inQueuedCard = el.closest('[data-testid="queued-messages-card"]');
      if (inQueuedCard) {
        if (!forAttributes && el.classList && el.classList.contains('line-clamp-2')) {
          const txt = String(el.textContent || '').trim();
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
        const txt = String(el.textContent || '').trim();
        if (
          el.tagName === 'P' &&
          !el.closest('[contenteditable="true"]') &&
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

    const testId =
      (typeof el.getAttribute === 'function' && el.getAttribute('data-testid')) ||
      (el.closest('[data-testid]') && el.closest('[data-testid]').getAttribute('data-testid')) ||
      '';

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
        (typeof el.getAttribute === 'function' && el.getAttribute('data-testid') === 'project-header' ? el : null) ||
        el.closest('[data-testid="project-header"]');
      const projLabel =
        (headerEl && typeof headerEl.getAttribute === 'function' && headerEl.getAttribute('data-project-label')) ||
        String(el.textContent || '').trim();
      const trimmedLabel = String(projLabel || '').trim();
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
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return;
    const els = rootNode.querySelectorAll('input[placeholder], textarea[placeholder], [title], [aria-label]');
    for (const el of els) {
      if (isExcludedFromStaticUiLocalization(el, true, rootNode)) continue;
      for (const attr of ['placeholder', 'title', 'aria-label']) {
        const val = el.getAttribute(attr);
        if (!val) continue;
        const trimmed = val.trim();
        if (!trimmed) continue;
        const ko = translateSync(trimmed);
        if (ko && ko !== trimmed) {
          let origMap = {};
          let appliedMap = {};
          try {
            origMap = JSON.parse(el.getAttribute('data-agy-orig-attr') || '{}');
          } catch (_err) {}
          try {
            appliedMap = el.__agyAppliedAttrs || {};
          } catch (_err) {}
          if (origMap[attr] === undefined || appliedMap[attr] !== trimmed) {
            origMap[attr] = val;
            el.setAttribute('data-agy-orig-attr', JSON.stringify(origMap));
          }
          appliedMap[attr] = ko;
          el.__agyAppliedAttrs = appliedMap;
          el.setAttribute(attr, ko);
        }
      }
    }
  }

  function localizeQuestionAndPermissionWidgets(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return;
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
      if (isExcludedFromStaticUiLocalization(el, false, rootNode)) continue;
      if (el.children && el.children.length > 0 && el.querySelector('p, div, ul, ol')) continue;
      const raw = String(el.textContent || '').trim();
      if (!raw) continue;
      const syncKo = translateSync(raw);
      if (syncKo && syncKo !== raw) {
        if (el.childNodes && el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
          const tn = el.firstChild;
          if (!tn.__agyOrigValue || tn.__agyKoApplied !== raw) tn.__agyOrigValue = tn.nodeValue;
          tn.__agyKoApplied = syncKo;
          tn.nodeValue = syncKo;
        }
        continue;
      }
      if (
        translationService &&
        typeof translationService.translateText === 'function' &&
        !isAlreadyKoreanOrNonEnglish(raw) &&
        el.childNodes &&
        el.childNodes.length === 1 &&
        el.firstChild.nodeType === 3 &&
        el.__agyDynamicSource !== raw &&
        !el.__agyTranslatingDynamic
      ) {
        el.__agyDynamicSource = raw;
        el.__agyTranslatingDynamic = true;
        translationService
          .translateText(raw)
          .then((ko) => {
            const wasTranslating = Boolean(el.__agyTranslatingDynamic);
            delete el.__agyTranslatingDynamic;
            if (isDisposed() || !wasTranslating || !ko || ko === raw || el.isConnected === false) {
              if (el.__agyDynamicSource === raw) delete el.__agyDynamicSource;
              return;
            }
            if (
              String(el.textContent || '').trim() !== raw ||
              !el.childNodes ||
              el.childNodes.length !== 1 ||
              el.firstChild.nodeType !== 3
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

  function localizeStaticUiInRoot(rootNode, observer = null) {
    const activeDoc = (rootNode && rootNode.ownerDocument) || doc;
    if (!rootNode || !activeDoc || typeof activeDoc.createTreeWalker !== 'function') return;
    if (
      rootNode.nodeType === 1 &&
      typeof rootNode.getAttribute === 'function' &&
      (rootNode.getAttribute('data-agy-no-translate') === 'true' || rootNode.getAttribute('translate') === 'no')
    ) {
      return;
    }

    localizeAttributesInRoot(rootNode);

    const walker = activeDoc.createTreeWalker(rootNode, 5, {
      acceptNode(node) {
        if (!node) return 2;
        if (node.nodeType === 1) {
          if (node !== rootNode) {
            if (typeof node.matches === 'function' && node.matches(STATIC_UI_SUBTREE_PRUNE_SELECTOR)) {
              return 2;
            }
            if (hasExcludedCodeDataAttrPrefix(node, node)) {
              return 2;
            }
          }
          return 3;
        }
        return 1;
      },
    });

    let textNode;
    while ((textNode = walker.nextNode())) {
      if (textNode.nodeType && textNode.nodeType !== 3) continue;
      const parent = textNode.parentElement;
      if (!parent || isExcludedFromStaticUiLocalization(parent, false, rootNode)) continue;
      if (
        (typeof parent.getAttribute === 'function' && parent.getAttribute('data-agy-orig-label') === '1') ||
        (parent.classList && parent.classList.contains('agy-ko-trigger-label'))
      ) {
        continue;
      }

      const raw = textNode.nodeValue;
      if (!raw) continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      if (textNode.__agyOrigValue && textNode.__agyOrigValue.trim() === 'New') {
        const btn = parent.closest('button');
        const btnText = btn ? String(btn.textContent || '').trim() : '';
        const isStandaloneNewBtn =
          Boolean(btn) &&
          !btn.closest('[role="menu"], [role="listbox"], [role="menuitem"]') &&
          (btnText === 'New' || btnText === '새로 만들기');
        if (!isStandaloneNewBtn) {
          textNode.nodeValue = textNode.__agyOrigValue;
          delete textNode.__agyOrigValue;
          delete textNode.__agyKoApplied;
          continue;
        }
      }

      if (textNode.__agyKoApplied === trimmed && !/^\(권장\)\s+[A-Za-z]/.test(trimmed)) continue;

      let syncKo = null;
      if (trimmed === 'New') {
        const btn = parent.closest('button');
        const btnText = btn ? String(btn.textContent || '').trim() : '';
        const isStandaloneNewBtn =
          Boolean(btn) &&
          !btn.closest('[role="menu"], [role="listbox"], [role="menuitem"]') &&
          (btnText === 'New' || btnText === '새로 만들기');
        syncKo = isStandaloneNewBtn ? '새로 만들기' : null;
      } else if (
        trimmed === 'Type' &&
        textNode.nextSibling &&
        textNode.nextSibling.nodeType === 1 &&
        (textNode.nextSibling.tagName === 'KBD' || textNode.nextSibling.tagName === 'CODE')
      ) {
        // D-0030: Contextual "Type <kbd>/<code>" -> "채팅창에" (never "유형")
        syncKo = '채팅창에';
      } else {
        syncKo = translateSync(trimmed);
      }

      if (syncKo && syncKo !== trimmed) {
        const leading = (raw.match(/^\s*/) || [''])[0];
        const trailing = (raw.match(/\s*$/) || [''])[0];
        const nextVal = leading + syncKo + trailing;
        // NB5: Always update __agyOrigValue when React replaced the text node in-place with new source text.
        if (!textNode.__agyOrigValue || textNode.__agyKoApplied !== trimmed) {
          textNode.__agyOrigValue = raw;
        }
        textNode.__agyKoApplied = syncKo;
        textNode.nodeValue = nextVal;
      }
    }

    localizeQuestionAndPermissionWidgets(rootNode);
    if (observer && typeof observer.takeRecords === 'function') {
      observer.takeRecords();
    }
  }

  function restoreAllMutatedNodes() {
    if (!doc || !doc.body) return;
    try {
      delete doc.body.__agyDynamicSource;
      delete doc.body.__agyTranslatingDynamic;
      if (typeof doc.createTreeWalker === 'function') {
        const restoreWalker = doc.createTreeWalker(doc.body, 5);
        let rn;
        while ((rn = restoreWalker.nextNode())) {
          if (rn.nodeType === 1) {
            delete rn.__agyDynamicSource;
            delete rn.__agyTranslatingDynamic;
            continue;
          }
          if (rn.__agyOrigValue !== undefined) {
            const parentEl = rn.parentElement;
            rn.nodeValue = rn.__agyOrigValue;
            delete rn.__agyOrigValue;
            delete rn.__agyKoApplied;
            if (parentEl) {
              delete parentEl.__agyDynamicSource;
              delete parentEl.__agyTranslatingDynamic;
            }
          }
        }
      }
      if (typeof doc.querySelectorAll === 'function') {
        doc.querySelectorAll('[data-agy-orig-attr]').forEach((el) => {
          try {
            const origMap = JSON.parse(el.getAttribute('data-agy-orig-attr') || '{}');
            for (const [k, v] of Object.entries(origMap)) {
              el.setAttribute(k, v);
            }
            el.removeAttribute('data-agy-orig-attr');
          } catch (_err) {}
        });
      }
    } catch (_err) {}
  }

  return {
    isExcludedFromStaticUiLocalization,
    localizeAttributesInRoot,
    localizeQuestionAndPermissionWidgets,
    localizeStaticUiInRoot,
    restoreAllMutatedNodes,
  };
}

module.exports = {
  BASE_EXCLUDED_SELECTOR,
  TEXT_EXCLUDED_SELECTOR,
  STATIC_UI_SUBTREE_PRUNE_SELECTOR,
  EXCLUDED_CODE_DATA_ATTR_PREFIX_REGEX,
  hasExcludedCodeDataAttrPrefix,
  isExcludedByFontMonoInheritance,
  createAntigravityUiLocalizer,
};
