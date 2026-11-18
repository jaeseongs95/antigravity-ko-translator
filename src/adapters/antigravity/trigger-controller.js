'use strict';

const DOCUMENT_POSITION_FOLLOWING = 4;

function getReactFiberFromElement(el) {
  if (!el || typeof el !== 'object') return null;
  try {
    const keys = Object.keys(el);
    const fk = keys.find((k) => k.startsWith('__reactFiber$'));
    if (fk) return el[fk];
    const ck = keys.find((k) => k.startsWith('__reactContainer$'));
    if (ck) return el[ck];
  } catch (_err) {}
  return null;
}

function extractSettingsStoreFromFiberNode(node) {
  if (!node) return null;
  const val = node.memoizedProps && node.memoizedProps.value;
  if (val && typeof val.getState === 'function' && typeof val.onDidChange === 'function') {
    const st = val.getState();
    if (st && typeof st.getPrefValue === 'function' && typeof st.setPrefValue === 'function') {
      return st;
    }
  }
  return null;
}

function resolveUserSettingsStoreFromDoc(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return null;
  try {
    const anchor =
      doc.querySelector(
        '[data-testid="conversation-view"], [data-testid="worked-for-collapsible"], [data-testid="agent-input-box"]'
      ) ||
      (doc.querySelector('#root, #app') && doc.querySelector('#root, #app').firstElementChild) ||
      (doc.body && doc.body.firstElementChild);
    if (anchor) {
      let cur = getReactFiberFromElement(anchor);
      for (let i = 0; i < 260 && cur; i++) {
        const st = extractSettingsStoreFromFiberNode(cur);
        if (st) return st;
        cur = cur.return;
      }
    }
  } catch (_err) {}
  return null;
}

function extractTriggerSpanRawText(origSpan) {
  if (!origSpan) return '';
  if (origSpan.querySelector && origSpan.querySelector('[data-slot-out]')) {
    const clone = origSpan.cloneNode(true);
    if (clone.querySelectorAll) {
      clone.querySelectorAll('[data-slot-out]').forEach((el) => el.remove());
    }
    return String(clone.textContent || '').trim();
  }
  return String(origSpan.textContent || '').trim();
}

function createAntigravityTriggerController({
  targetDoc,
  catalog,
  disposables,
  getShowThinkingEnabled = () => true,
  onEnsureStyle = null,
} = {}) {
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  let cachedUserSettingsStore = null;

  function translateSync(raw) {
    return catalog && typeof catalog.translateSync === 'function' ? catalog.translateSync(raw) : null;
  }

  function isNativeVerboseConversationStepsEnabled() {
    // D-0012: Read-only check of native verboseConversationSteps; NEVER mutate or overwrite it!
    try {
      if (!cachedUserSettingsStore || typeof cachedUserSettingsStore.getPrefValue !== 'function') {
        cachedUserSettingsStore = resolveUserSettingsStoreFromDoc(doc);
      }
      if (cachedUserSettingsStore && typeof cachedUserSettingsStore.getPrefValue === 'function') {
        const val = cachedUserSettingsStore.getPrefValue('verboseConversationSteps');
        if (typeof val === 'boolean') return val;
      }
    } catch (_err) {}
    return true;
  }

  function syncShowThinkingDomAttribute() {
    if (!doc) return;
    try {
      const show = Boolean(getShowThinkingEnabled());
      const rootEl = doc.documentElement;
      if (rootEl && typeof rootEl.setAttribute === 'function') {
        if (show) {
          if (!rootEl.hasAttribute || rootEl.hasAttribute('data-agy-hide-thinking')) {
            rootEl.removeAttribute('data-agy-hide-thinking');
          }
        } else if (!rootEl.getAttribute || rootEl.getAttribute('data-agy-hide-thinking') !== '1') {
          rootEl.setAttribute('data-agy-hide-thinking', '1');
        }
      }
    } catch (_err) {}
  }

  function processTriggerButton(btn) {
    if (!btn || !doc) return;
    const spans = btn.children
      ? Array.from(btn.children).filter((c) => c && c.tagName === 'SPAN')
      : typeof btn.querySelectorAll === 'function'
        ? Array.from(btn.querySelectorAll(':scope > span'))
        : [];
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
    // D-0005: NEVER overwrite origSpan.textContent = '' when child fibers exist!
    if (!liveText && origSpan.__agyOrigLabelText && (!origSpan.childNodes || origSpan.childNodes.length === 0)) {
      origSpan.textContent = origSpan.__agyOrigLabelText;
    }

    const expectedKoClass = (origSpan.className ? origSpan.className + ' ' : '') + 'agy-ko-trigger-label';
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
    } catch (_err) {
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
    } catch (_err) {
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
    } catch (_err) {}
  }

  if (doc && disposables && typeof disposables.registerEvent === 'function') {
    disposables.registerEvent(doc, 'click', onTriggerButtonClickCapture, true);
  }

  function checkFiberTurnStatus(btn) {
    let sawLocalActiveFalse = false;
    try {
      let cur = getReactFiberFromElement(btn);
      for (let i = 0; i < 36 && cur; i++) {
        const mp = cur.memoizedProps;
        if (mp && typeof mp === 'object') {
          if (mp.segment && typeof mp.segment === 'object') {
            if (mp.segment.isLatest === false || mp.segment.isActive === false) {
              return { decided: true, active: false, sawLocalActiveFalse };
            }
            if (mp.isLastContainer === false || mp.isLastTurn === false) {
              return { decided: true, active: false, sawLocalActiveFalse };
            }
            if (mp.segment.isLatest === true || mp.segment.isActive === true) {
              return { decided: true, active: true, sawLocalActiveFalse };
            }
          }
          if (mp.isLastContainer === true || mp.isLastTurn === true) {
            return { decided: true, active: true, sawLocalActiveFalse };
          }
          if (mp.isLastContainer === false || mp.isLastTurn === false) {
            return { decided: true, active: false, sawLocalActiveFalse };
          }
          if (mp.container && typeof mp.container === 'object') {
            if (mp.container.isLatest === true || mp.container.isActive === true) {
              return { decided: true, active: true, sawLocalActiveFalse };
            }
            if (mp.container.isLatest === false || mp.container.isActive === false) {
              return { decided: true, active: false, sawLocalActiveFalse };
            }
          }
          if (i <= 6) {
            if (mp.isActive === true) {
              return { decided: true, active: true, sawLocalActiveFalse };
            }
            if (mp.isActive === false || mp.isRunning === false) {
              sawLocalActiveFalse = true;
            }
          }
        }
        cur = cur.return;
      }
    } catch (_err) {}
    return { decided: false, active: false, sawLocalActiveFalse };
  }

  function checkDomTurnFallbacks(btn) {
    if (!doc) return null;
    if (typeof doc.querySelector === 'function') {
      const latestTurnEl = doc.querySelector('[data-turn-content="latest"]');
      if (latestTurnEl && typeof latestTurnEl.contains === 'function') {
        return Boolean(latestTurnEl.contains(btn));
      }
    }
    if (typeof doc.querySelectorAll === 'function' && typeof btn.compareDocumentPosition === 'function') {
      const userBubbles = doc.querySelectorAll('[data-testid="user-message-bubble"]');
      for (const ub of userBubbles) {
        if (ub && (btn.compareDocumentPosition(ub) & DOCUMENT_POSITION_FOLLOWING) !== 0) {
          return false;
        }
      }
    }
    return null;
  }

  function isHiddenActiveWorkedForButton(btn) {
    if (!btn) return false;
    if (btn.classList && btn.classList.contains('hidden')) return true;
    try {
      let cur = getReactFiberFromElement(btn);
      for (let i = 0; i < 8 && cur; i++) {
        if (cur.memoizedProps && cur.memoizedProps.triggerVisible === false) {
          return true;
        }
        cur = cur.return;
      }
    } catch (_err) {}
    return false;
  }

  function doesWorkedForButtonContainThinking(btn) {
    if (!btn) return false;
    if (btn.__agyHasThinking) return true;
    try {
      let cur = getReactFiberFromElement(btn);
      for (let i = 0; i < 12 && cur; i++) {
        const segSteps = cur.memoizedProps && cur.memoizedProps.segment && cur.memoizedProps.segment.steps;
        if (Array.isArray(segSteps)) {
          const found = segSteps.some((s) => {
            const val = s && s.step && s.step.value;
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
    } catch (_err) {}
    return false;
  }

  function isWorkedForInActiveOrLatestTurn(btn, isLastInDomList) {
    if (!btn) return false;
    const fiberCheck = checkFiberTurnStatus(btn);
    if (fiberCheck.decided) return fiberCheck.active;
    const domCheck = checkDomTurnFallbacks(btn);
    if (domCheck !== null) return domCheck;
    if (fiberCheck.sawLocalActiveFalse) return false;
    return Boolean(isLastInDomList);
  }

  function isToolGroupInActiveOrLatestTurn(btn, workedBtns) {
    if (!btn) return false;
    const fiberCheck = checkFiberTurnStatus(btn);
    if (fiberCheck.decided) return fiberCheck.active;
    const domCheck = checkDomTurnFallbacks(btn);
    if (domCheck !== null) return domCheck;

    if (Array.isArray(workedBtns) && workedBtns.length > 0) {
      const lastWorked = workedBtns[workedBtns.length - 1];
      const lastContainer =
        lastWorked && typeof lastWorked.closest === 'function' ? lastWorked.closest('.relative') : null;
      if (lastContainer && typeof lastContainer.contains === 'function' && lastContainer.contains(btn)) {
        return true;
      }
      const anyHistoricalContains = workedBtns.slice(0, -1).some((wb) => {
        const c = wb && typeof wb.closest === 'function' ? wb.closest('.relative') : null;
        return Boolean(c && typeof c.contains === 'function' && c.contains(btn));
      });
      if (anyHistoricalContains || fiberCheck.sawLocalActiveFalse) {
        return false;
      }
      if (
        lastWorked &&
        typeof lastWorked.compareDocumentPosition === 'function' &&
        (lastWorked.compareDocumentPosition(btn) & DOCUMENT_POSITION_FOLLOWING) !== 0
      ) {
        return true;
      }
    }
    return false;
  }

  function isThinkingTriggerInActiveOrLatestTurn(btn, workedBtns, thinkingBtns) {
    if (!btn) return false;
    const fiberCheck = checkFiberTurnStatus(btn);
    if (fiberCheck.decided) return fiberCheck.active;
    const domCheck = checkDomTurnFallbacks(btn);
    if (domCheck !== null) return domCheck;

    if (Array.isArray(workedBtns) && workedBtns.length > 0) {
      const lastWorked = workedBtns[workedBtns.length - 1];
      const lastContainer =
        lastWorked && typeof lastWorked.closest === 'function' ? lastWorked.closest('.relative') : null;
      if (lastContainer && typeof lastContainer.contains === 'function' && lastContainer.contains(btn)) {
        return true;
      }
      const anyHistoricalContains = workedBtns.slice(0, -1).some((wb) => {
        const c = wb && typeof wb.closest === 'function' ? wb.closest('.relative') : null;
        return Boolean(c && typeof c.contains === 'function' && c.contains(btn));
      });
      if (anyHistoricalContains || fiberCheck.sawLocalActiveFalse) {
        return false;
      }
      if (
        lastWorked &&
        typeof lastWorked.compareDocumentPosition === 'function' &&
        (lastWorked.compareDocumentPosition(btn) & DOCUMENT_POSITION_FOLLOWING) !== 0
      ) {
        return true;
      }
      return false;
    }
    if (fiberCheck.sawLocalActiveFalse) return false;
    if (Array.isArray(thinkingBtns) && thinkingBtns.length > 0) {
      return btn === thinkingBtns[thinkingBtns.length - 1];
    }
    return false;
  }

  function scanTriggerButtonsSync(forceCollapseAll = false) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    if (typeof onEnsureStyle === 'function') {
      onEnsureStyle();
    }
    syncShowThinkingDomAttribute();
    const autoExpand = Boolean(getShowThinkingEnabled());
    const nativeVerboseSteps = isNativeVerboseConversationStepsEnabled();

    const workedBtns = Array.from(doc.querySelectorAll('button[data-testid="worked-for-collapsible"]'));
    for (let i = 0; i < workedBtns.length; i++) {
      const btn = workedBtns[i];
      const isLastWorked = isWorkedForInActiveOrLatestTurn(btn, i === workedBtns.length - 1);
      processTriggerButton(btn);
      if (!nativeVerboseSteps) continue;
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

    const toolGroupBtns = doc.querySelectorAll('button[data-testid="tool-group-collapsible"]');
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

    const thinkingBtns = Array.from(doc.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]'));
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

    const sideQuestionBtns = doc.querySelectorAll('[data-testid="side-question-answer"] button[aria-expanded]');
    for (const btn of sideQuestionBtns) {
      processTriggerButton(btn);
    }
  }

  function restoreTriggerButtons() {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    try {
      if (doc.documentElement && typeof doc.documentElement.removeAttribute === 'function') {
        doc.documentElement.removeAttribute('data-agy-hide-thinking');
      }
      doc.querySelectorAll('.agy-ko-trigger-label').forEach((el) => el.remove());
      doc.querySelectorAll('[data-agy-orig-label="1"]').forEach((origSpan) => {
        origSpan.removeAttribute('data-agy-orig-label');
        if (origSpan.style) origSpan.style.display = '';
        delete origSpan.__agyOrigLabelText;
      });
    } catch (_err) {}
  }

  return {
    isNativeVerboseConversationStepsEnabled,
    syncShowThinkingDomAttribute,
    processTriggerButton,
    scanTriggerButtonsSync,
    restoreTriggerButtons,
  };
}

module.exports = {
  getReactFiberFromElement,
  extractTriggerSpanRawText,
  createAntigravityTriggerController,
};
