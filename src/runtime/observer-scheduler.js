'use strict';

/**
 * Clean-Slate Desktop-Only DOM MutationObserver & Periodic Scan Scheduler.
 *
 * - Zero v1.x remnants (no pretranslator, native settingsUi, statusbarPort, workbenchPromoter, or companion modals).
 * - Coalesces DOM mutations into a 0ms microtask fast-pass and 16ms full-pass while draining self-induced records.
 * - Guards session-switch transitions (D-0015) to prevent scroll/animation flashes.
 */

const NO_TRANSLATE_SUBTREE_SELECTOR =
  '.agy-ko-thought-wrap, [data-agy-no-translate="true"]';

function createObserverScheduler({
  targetWin,
  targetDoc,
  disposables = null,
  uiLocalizer = null,
  triggerController = null,
  thinkingTranslator = null,
  isEnabled = () => true,
  isTranslateThinkingEnabled = () => true,
  isTranslateStaticUiEnabled = () => true,
  onEnsureStyle = null,
  onScanAll = null,
  onError = null,
  periodicIntervalMs = 2500,
  scanIntervalMs = null,
} = {}) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  const effectiveIntervalMs =
    typeof scanIntervalMs === 'number' && Number.isFinite(scanIntervalMs) ? scanIntervalMs : periodicIntervalMs;

  const setTimer =
    win && typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
  const clearTimer =
    win && typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
  const setPeriodic =
    win && typeof win.setInterval === 'function' ? win.setInterval.bind(win) : setInterval;
  const clearPeriodic =
    win && typeof win.clearInterval === 'function' ? win.clearInterval.bind(win) : clearInterval;

  let disposed = false;
  let running = false;
  let inFastScan = false;
  let fastScanMicrotaskScheduled = false;
  let fullScanTimer = null;
  let periodicTimer = null;
  let lastObservedCascadeId = null;
  let sessionSwitchFreezeTimer = null;
  let sessionSwitchFreezeUntil = 0;
  let observer = null;

  function reportError(err) {
    if (typeof onError === 'function') {
      try {
        onError(err);
      } catch (_ignored) {}
    }
  }

  function drainObserverRecords() {
    if (observer && typeof observer.takeRecords === 'function') {
      try {
        observer.takeRecords();
      } catch (_err) {}
    }
  }

  // D-0015: Guard session-switch transitions to prevent height/scroll flash during cascade swap
  function guardSessionSwitchTransitions() {
    try {
      if (!doc) return;
      const views =
        typeof doc.querySelectorAll === 'function'
          ? Array.from(
              doc.querySelectorAll(
                '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"]'
              )
            )
          : [];
      if (views.length === 0 && typeof doc.querySelector === 'function') {
        const single =
          doc.querySelector('[data-testid="conversation-view"]') ||
          doc.querySelector('[data-testid="subagent-tab-conversation"]') ||
          doc.querySelector('[data-testid="side-question-tab-conversation"]');
        if (single) views.push(single);
      }
      if (views.length === 0) return;

      const hasMountedTurnElement = (viewEl) =>
        Boolean(
          viewEl &&
            typeof viewEl.querySelector === 'function' &&
            viewEl.querySelector(
              'button[data-testid="worked-for-collapsible"], button[data-testid="thinking-collapsible-trigger"], [data-testid="user-message-bubble"]'
            )
        );

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
          if (!v) continue;
          if (typeof v.setAttribute === 'function' && v.getAttribute('data-agy-session-switching') !== '1') {
            v.setAttribute('data-agy-session-switching', '1');
          }
          if (v.classList && typeof v.classList.contains === 'function' && typeof v.classList.add === 'function') {
            if (!v.classList.contains('no-animations')) {
              v.classList.add('no-animations');
              if (typeof v.setAttribute === 'function') {
                v.setAttribute('data-agy-added-no-animations', '1');
              }
            }
          }
        }
        const now = Date.now();
        const requestedUntil = now + durationMs;
        if (sessionSwitchFreezeTimer && sessionSwitchFreezeUntil > requestedUntil) {
          return;
        }
        sessionSwitchFreezeUntil = Math.max(sessionSwitchFreezeUntil, requestedUntil);
        const remainingMs = Math.max(durationMs, sessionSwitchFreezeUntil - now);
        if (sessionSwitchFreezeTimer) clearTimer(sessionSwitchFreezeTimer);
        sessionSwitchFreezeTimer = setTimer(() => {
          sessionSwitchFreezeTimer = null;
          sessionSwitchFreezeUntil = 0;
          try {
            const liveViews =
              typeof doc.querySelectorAll === 'function'
                ? Array.from(
                    doc.querySelectorAll(
                      '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"]'
                    )
                  )
                : targetViews;
            for (const v of liveViews) {
              if (!v) continue;
              if (typeof v.removeAttribute === 'function') {
                v.removeAttribute('data-agy-session-switching');
              }
              if (
                typeof v.getAttribute === 'function' &&
                v.getAttribute('data-agy-added-no-animations') === '1'
              ) {
                if (v.classList && typeof v.classList.remove === 'function') {
                  v.classList.remove('no-animations');
                }
                if (typeof v.removeAttribute === 'function') {
                  v.removeAttribute('data-agy-added-no-animations');
                }
              }
            }
            drainObserverRecords();
          } catch (_err) {}
        }, remainingMs);
      };

      if (switched) {
        for (const v of views) {
          if (!v) continue;
          const cid = v.getAttribute ? v.getAttribute('data-cascade-id') : null;
          if (hasMountedTurnElement(v)) {
            v.__agyTrajectoryMountedForCascade = cid;
            v.__agyAwaitingAsyncTrajectoryForCascade = null;
          } else {
            v.__agyTrajectoryMountedForCascade = null;
            v.__agyAwaitingAsyncTrajectoryForCascade = cid;
          }
        }
        armFreezeTimer(views, 650);
      } else {
        for (const v of views) {
          if (!v || typeof v.querySelector !== 'function') continue;
          const cid = v.getAttribute ? v.getAttribute('data-cascade-id') : null;
          if (cid && v.__agyTrajectoryMountedForCascade !== cid && hasMountedTurnElement(v)) {
            const wasSwitching =
              v.__agyAwaitingAsyncTrajectoryForCascade === cid ||
              v.getAttribute('data-agy-session-switching') === '1' ||
              Boolean(sessionSwitchFreezeTimer);
            v.__agyTrajectoryMountedForCascade = cid;
            v.__agyAwaitingAsyncTrajectoryForCascade = null;
            if (wasSwitching) {
              armFreezeTimer(views, 250);
            }
          }
        }
      }
    } catch (_err) {}
  }

  // D-0014: 0ms microtask fast-pass for Thinking/Worked triggers and active conversation view
  function runFastPass() {
    guardSessionSwitchTransitions();
    if (disposed || !running || inFastScan || !doc || !isEnabled()) return;
    inFastScan = true;
    try {
      if (typeof onEnsureStyle === 'function') {
        onEnsureStyle();
      }
      if (triggerController) {
        triggerController.scanTriggerButtonsSync(false);
      }
      if (uiLocalizer && isTranslateStaticUiEnabled()) {
        if (typeof doc.querySelectorAll === 'function') {
          doc
            .querySelectorAll(
              '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"], [data-testid="idle-status-text"], [data-testid="conversation-navigator"]'
            )
            .forEach((convEl) => uiLocalizer.localizeStaticUiInRoot(convEl, observer));
        } else if (typeof doc.querySelector === 'function') {
          const convEl =
            doc.querySelector('[data-testid="conversation-view"]') ||
            doc.querySelector('[data-testid="subagent-tab-conversation"]') ||
            doc.querySelector('[data-testid="side-question-tab-conversation"]');
          if (convEl) uiLocalizer.localizeStaticUiInRoot(convEl, observer);
        }
      }
      if (thinkingTranslator && isTranslateThinkingEnabled()) {
        thinkingTranslator.scanThoughtBlocks();
      }
      drainObserverRecords();
    } catch (err) {
      reportError(err);
    } finally {
      inFastScan = false;
    }
  }

  function scanAll() {
    if (disposed || !doc || !isEnabled()) return;
    try {
      if (typeof onScanAll === 'function') {
        onScanAll(observer);
      } else {
        if (typeof onEnsureStyle === 'function') onEnsureStyle();
        if (triggerController) triggerController.scanTriggerButtonsSync(false);
        const root = doc.body || doc.documentElement;
        if (root && uiLocalizer && isTranslateStaticUiEnabled()) {
          uiLocalizer.localizeStaticUiInRoot(root, observer);
        }
        if (thinkingTranslator && isTranslateThinkingEnabled()) {
          thinkingTranslator.scanThoughtBlocks();
        }
      }
      drainObserverRecords();
    } catch (err) {
      reportError(err);
    }
  }

  function scheduleCoalescedScan() {
    if (disposed || !running || !isEnabled()) return;
    if (!fastScanMicrotaskScheduled) {
      fastScanMicrotaskScheduled = true;
      Promise.resolve().then(() => {
        fastScanMicrotaskScheduled = false;
        if (!disposed && running) {
          runFastPass();
        }
      });
    }
    if (!fullScanTimer) {
      fullScanTimer = setTimer(() => {
        fullScanTimer = null;
        if (disposed || !running || !doc || !isEnabled()) return;
        scanAll();
      }, 16);
    }
  }

  function createMutationObserver() {
    const ObsCtor = (win && win.MutationObserver) || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    if (typeof ObsCtor !== 'function') return null;
    return new ObsCtor((mutations) => {
      if (disposed || !running || !isEnabled()) return;
      for (const m of mutations) {
        if (
          m.type === 'childList' &&
          ((m.addedNodes && m.addedNodes.length > 0) || (m.removedNodes && m.removedNodes.length > 0))
        ) {
          const tEl = m.target && m.target.nodeType === 1 ? m.target : m.target && m.target.parentElement;
          if (
            tEl &&
            typeof tEl.closest === 'function' &&
            (tEl.closest(NO_TRANSLATE_SUBTREE_SELECTOR) ||
              (tEl.classList && tEl.classList.contains('agy-ko-trigger-label')))
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
            (!parent.classList || !parent.classList.contains('agy-ko-trigger-label')) &&
            (typeof parent.closest !== 'function' || !parent.closest(NO_TRANSLATE_SUBTREE_SELECTOR)) &&
            m.target.__agyKoApplied !== String(m.target.nodeValue || '').trim()
          ) {
            scheduleCoalescedScan();
            return;
          }
        }
        if (m.type === 'attributes' && m.target && typeof m.target.closest === 'function') {
          if (m.target.closest(NO_TRANSLATE_SUBTREE_SELECTOR)) {
            continue;
          }
          if (m.attributeName === 'data-cascade-id') {
            guardSessionSwitchTransitions();
            scheduleCoalescedScan();
            return;
          }
          if (m.attributeName === 'aria-expanded') {
            if (
              m.target.__agyProgrammaticClick ||
              (typeof m.target.getAttribute === 'function' &&
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
            typeof m.target.getAttribute === 'function' &&
            m.target.getAttribute('data-agy-orig-label') === '1'
          ) {
            scheduleCoalescedScan();
            return;
          }
        }
      }
    });
  }

  function start() {
    if (disposed || running || !doc) return;
    const root = doc.body || doc.documentElement;
    if (!root) {
      if (win && disposables && typeof disposables.registerEvent === 'function') {
        disposables.registerEvent(win, 'DOMContentLoaded', start, { once: true });
      }
      return;
    }
    running = true;
    if (!observer) {
      observer = createMutationObserver();
    }
    if (observer && typeof observer.observe === 'function') {
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'aria-expanded', 'class', 'data-cascade-id', 'aria-hidden'],
      });
    }
    scanAll();
    if (!periodicTimer && effectiveIntervalMs > 0) {
      periodicTimer = setPeriodic(scanAll, effectiveIntervalMs);
    }
  }

  function stop() {
    running = false;
    if (fullScanTimer) {
      clearTimer(fullScanTimer);
      fullScanTimer = null;
    }
    if (sessionSwitchFreezeTimer) {
      clearTimer(sessionSwitchFreezeTimer);
      sessionSwitchFreezeTimer = null;
    }
    if (periodicTimer) {
      clearPeriodic(periodicTimer);
      periodicTimer = null;
    }
    if (observer && typeof observer.disconnect === 'function') {
      try {
        observer.disconnect();
      } catch (_err) {}
    }
  }

  function dispose() {
    disposed = true;
    stop();
  }

  return {
    start,
    stop,
    dispose,
    scanAll,
    runFastPass,
    scheduleCoalescedScan,
    guardSessionSwitchTransitions,
    takeRecords: drainObserverRecords,
    getObserver: () => observer,
    isRunning: () => running,
  };
}

module.exports = {
  NO_TRANSLATE_SUBTREE_SELECTOR,
  createObserverScheduler,
};
