'use strict';

/**
 * Pure DOM Trigger Controller for Antigravity Thinking & Tool Collapsible Buttons.
 *
 * Strictly read-only with respect to host framework internals:
 * - ZERO React/Angular internal framework inspection.
 * - Never overwrites `origSpan.textContent` (preserves host React child text nodes).
 */

function extractTriggerSpanRawText(origSpan) {
  if (!origSpan) return '';
  if (typeof origSpan.querySelector === 'function' && origSpan.querySelector('[data-slot-out]')) {
    const clone = origSpan.cloneNode(true);
    if (typeof clone.querySelectorAll === 'function') {
      clone.querySelectorAll('[data-slot-out]').forEach((el) => el.remove());
    }
    return String(clone.textContent || '').trim();
  }
  return String(origSpan.textContent || '').trim();
}

function isElementInLatestTurn(btn, doc, NodeCtor) {
  if (!btn || !doc) return false;
  if (typeof doc.querySelector === 'function') {
    const latestTurnEl = doc.querySelector('[data-turn-content="latest"]');
    if (latestTurnEl && typeof latestTurnEl.contains === 'function') {
      return Boolean(latestTurnEl.contains(btn));
    }
  }
  if (
    typeof doc.querySelectorAll === 'function' &&
    typeof btn.compareDocumentPosition === 'function' &&
    NodeCtor &&
    typeof NodeCtor.DOCUMENT_POSITION_FOLLOWING === 'number'
  ) {
    const userBubbles = doc.querySelectorAll('[data-testid="user-message-bubble"]');
    for (const ub of userBubbles) {
      if (ub && (btn.compareDocumentPosition(ub) & NodeCtor.DOCUMENT_POSITION_FOLLOWING) !== 0) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function createAntigravityTriggerController({
  targetDoc,
  targetWin,
  catalog,
  getShowThinkingEnabled = () => true,
  isDisposed = () => false,
} = {}) {
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const NodeCtor = (win && win.Node) || (typeof Node !== 'undefined' ? Node : null);
  let clickListenerAttached = false;

  function translateSync(raw) {
    return catalog && typeof catalog.translateSync === 'function' ? catalog.translateSync(raw) : null;
  }

  function syncShowThinkingDomAttribute() {
    if (!doc || !doc.documentElement) return;
    const show = Boolean(getShowThinkingEnabled());
    if (show) {
      doc.documentElement.removeAttribute('data-agy-hide-thinking');
    } else {
      doc.documentElement.setAttribute('data-agy-hide-thinking', '1');
    }
  }

  function processTriggerButton(btn) {
    if (!btn || !doc || typeof btn.querySelectorAll !== 'function') return;
    const spans = Array.from(btn.querySelectorAll(':scope > span'));
    const origSpan = spans.find((s) => !s.classList || !s.classList.contains('agy-ko-trigger-label'));
    if (!origSpan) return;

    const liveText = extractTriggerSpanRawText(origSpan);
    const rawText = liveText || String(origSpan.__agyOrigLabelText || '').trim();
    const koText = translateSync(rawText);
    if (!koText) return;

    origSpan.__agyOrigLabelText = rawText;
    if (origSpan.getAttribute('data-agy-orig-label') !== '1') {
      origSpan.setAttribute('data-agy-orig-label', '1');
    }
    if (origSpan.style && origSpan.style.display !== 'none') {
      origSpan.style.display = 'none';
    }

    const expectedKoClass = (origSpan.className ? `${origSpan.className} ` : '') + 'agy-ko-trigger-label';
    let koSpan = spans.find((s) => s.classList && s.classList.contains('agy-ko-trigger-label'));
    if (!koSpan) {
      koSpan = doc.createElement('span');
      koSpan.className = expectedKoClass;
      if (typeof origSpan.insertAdjacentElement === 'function') {
        origSpan.insertAdjacentElement('afterend', koSpan);
      } else if (origSpan.parentNode) {
        origSpan.parentNode.insertBefore(koSpan, origSpan.nextSibling);
      }
    } else if (koSpan.className !== expectedKoClass) {
      koSpan.className = expectedKoClass;
    }

    if (koSpan.__lastRawText !== rawText) {
      koSpan.__lastRawText = rawText;
      koSpan.textContent = koText;
    }
  }

  function expandIfNeeded(btn) {
    if (!btn || btn.getAttribute('aria-expanded') !== 'false' || btn.__agyUserCollapsed) {
      return false;
    }
    btn.__agyAutoExpanded = true;
    btn.setAttribute('data-agy-auto-expanded', '1');
    btn.__agyProgrammaticClick = true;
    try {
      btn.click();
    } finally {
      btn.__agyProgrammaticClick = false;
    }
    return true;
  }

  function collapseIfNeeded(btn) {
    if (!btn || btn.getAttribute('aria-expanded') !== 'true') {
      return false;
    }
    delete btn.__agyAutoExpanded;
    btn.removeAttribute('data-agy-auto-expanded');
    btn.__agyProgrammaticClick = true;
    try {
      btn.click();
    } finally {
      btn.__agyProgrammaticClick = false;
    }
    return true;
  }

  function onTriggerClickCapture(e) {
    if (isDisposed() || !e || !e.target || typeof e.target.closest !== 'function') return;
    const btn = e.target.closest(
      'button[data-testid="thinking-collapsible-trigger"], button[data-testid="worked-for-collapsible"], button[data-testid="tool-group-collapsible"]'
    );
    if (!btn || btn.__agyProgrammaticClick || e.isTrusted === false) return;
    const expandedBefore = btn.getAttribute('aria-expanded');
    if (expandedBefore === 'true') {
      btn.__agyUserCollapsed = true;
      btn.removeAttribute('data-agy-auto-expanded');
    } else if (expandedBefore === 'false') {
      btn.__agyUserCollapsed = false;
    }
  }

  function attachListeners() {
    if (!doc || clickListenerAttached || typeof doc.addEventListener !== 'function') return;
    doc.addEventListener('click', onTriggerClickCapture, true);
    clickListenerAttached = true;
  }

  function detachListeners() {
    if (!doc || !clickListenerAttached || typeof doc.removeEventListener !== 'function') return;
    doc.removeEventListener('click', onTriggerClickCapture, true);
    clickListenerAttached = false;
  }

  function scanTriggerButtonsSync(forceCollapse = false) {
    if (isDisposed() || !doc || typeof doc.querySelectorAll !== 'function') return;
    syncShowThinkingDomAttribute();
    const showThinking = Boolean(getShowThinkingEnabled());

    const workedBtns = Array.from(doc.querySelectorAll('button[data-testid="worked-for-collapsible"]'));
    for (const btn of workedBtns) {
      processTriggerButton(btn);
    }

    const toolGroupBtns = Array.from(doc.querySelectorAll('button[data-testid="tool-group-collapsible"]'));
    for (const btn of toolGroupBtns) {
      processTriggerButton(btn);
    }

    const thinkingBtns = Array.from(doc.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]'));
    for (let i = 0; i < thinkingBtns.length; i++) {
      const btn = thinkingBtns[i];
      processTriggerButton(btn);
      const isLatest = isElementInLatestTurn(btn, doc, NodeCtor);
      if (showThinking && !forceCollapse) {
        if (isLatest && btn.getAttribute('aria-expanded') === 'false' && !btn.__agyUserCollapsed) {
          expandIfNeeded(btn);
        }
      } else if (!showThinking && btn.getAttribute('aria-expanded') === 'true') {
        collapseIfNeeded(btn);
      }
    }

    const sideQuestionBtns = Array.from(
      doc.querySelectorAll('[data-testid="side-question-answer"] button[aria-expanded]')
    );
    for (const btn of sideQuestionBtns) {
      processTriggerButton(btn);
    }
  }

  function restoreTriggerButtons() {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    doc.querySelectorAll('.agy-ko-trigger-label').forEach((el) => el.remove());
    doc.querySelectorAll('[data-agy-orig-label]').forEach((el) => {
      el.removeAttribute('data-agy-orig-label');
      if (el.style) el.style.display = '';
      delete el.__agyOrigLabelText;
    });
    doc.querySelectorAll('[data-agy-auto-expanded]').forEach((el) => {
      el.removeAttribute('data-agy-auto-expanded');
      delete el.__agyAutoExpanded;
    });
    if (doc.documentElement) {
      doc.documentElement.removeAttribute('data-agy-hide-thinking');
    }
  }

  return {
    extractTriggerSpanRawText,
    syncShowThinkingDomAttribute,
    processTriggerButton,
    scanTriggerButtonsSync,
    attachListeners,
    detachListeners,
    restoreTriggerButtons,
  };
}

module.exports = {
  extractTriggerSpanRawText,
  createAntigravityTriggerController,
};
