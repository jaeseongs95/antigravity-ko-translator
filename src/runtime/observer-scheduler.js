'use strict';

/**
 * Vendor-Neutral DOM MutationObserver & Periodic Scan Scheduler.
 *
 * All host-specific CSS selectors and attribute names are injected via `selectors`
 * from the active HostUiAdapter port rather than hardcoded here.
 */

const DEFAULT_SELECTORS = Object.freeze({
  noTranslateSubtree: '[data-ko-no-translate="true"]',
  triggerLabelClass: '',
  conversationViews: '',
  conversationViewFallbackList: Object.freeze([]),
  mountedTurn: '',
  fastPassRoots: '',
  cascadeIdAttr: '',
  viewTestIdAttr: 'data-testid',
  primaryViewTestId: '',
  autoExpandedAttr: '',
  origLabelAttr: '',
});

function createObserverScheduler({
  targetWin,
  targetDoc,
  disposables = null,
  uiLocalizer = null,
  triggerController = null,
  thinkingTranslator = null,
  selectors = null,
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
  const sel = { ...DEFAULT_SELECTORS, ...(selectors && typeof selectors === 'object' ? selectors : {}) };
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

  function queryConversationViews() {
    if (!doc || !sel.conversationViews) return [];
    const views =
      typeof doc.querySelectorAll === 'function'
        ? Array.from(doc.querySelectorAll(sel.conversationViews))
        : [];
    if (views.length === 0 && typeof doc.querySelector === 'function' && Array.isArray(sel.conversationViewFallbackList)) {
      for (const fallbackSelector of sel.conversationViewFallbackList) {
        const single = doc.querySelector(fallbackSelector);
        if (single) {
          views.push(single);
          break;
        }
      }
    }
    return views;
  }

  // Guard session-switch transitions to prevent height/scroll flash during view swap.
  function guardSessionSwitchTransitions() {
    try {
      if (!doc || !sel.conversationViews || !sel.cascadeIdAttr) return;
      const views = queryConversationViews();
      if (views.length === 0) return;

      const hasMountedTurnElement = (viewEl) =>
        Boolean(
          sel.mountedTurn &&
            viewEl &&
            typeof viewEl.querySelector === 'function' &&
            viewEl.querySelector(sel.mountedTurn)
        );

      let switched = false;
      for (const convView of views) {
        if (!convView || typeof convView.getAttribute !== 'function') continue;
        const currentCascadeId = convView.getAttribute(sel.cascadeIdAttr) || null;
        if (!currentCascadeId) continue;
        const testId = sel.viewTestIdAttr ? convView.getAttribute(sel.viewTestIdAttr) || '' : '';
        const isPrimaryConv = Boolean(sel.primaryViewTestId && testId === sel.primaryViewTestId);
        const prevElementCascadeId = convView.__koLastObservedCascadeId ?? null;
        if (currentCascadeId !== prevElementCascadeId) {
          convView.__koLastObservedCascadeId = currentCascadeId;
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
            const liveViews = queryConversationViews();
            const viewsToClear = liveViews.length > 0 ? liveViews : targetViews;
            for (const v of viewsToClear) {
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
          const cid = v.getAttribute ? v.getAttribute(sel.cascadeIdAttr) : null;
          if (hasMountedTurnElement(v)) {
            v.__koTrajectoryMountedForCascade = cid;
            v.__koAwaitingAsyncTrajectoryForCascade = null;
          } else {
            v.__koTrajectoryMountedForCascade = null;
            v.__koAwaitingAsyncTrajectoryForCascade = cid;
          }
        }
        armFreezeTimer(views, 650);
      } else {
        for (const v of views) {
          if (!v || typeof v.querySelector !== 'function') continue;
          const cid = v.getAttribute ? v.getAttribute(sel.cascadeIdAttr) : null;
          if (cid && v.__koTrajectoryMountedForCascade !== cid && hasMountedTurnElement(v)) {
            const wasSwitching =
              v.__koAwaitingAsyncTrajectoryForCascade === cid ||
              v.getAttribute('data-agy-session-switching') === '1' ||
              Boolean(sessionSwitchFreezeTimer);
            v.__koTrajectoryMountedForCascade = cid;
            v.__koAwaitingAsyncTrajectoryForCascade = null;
            if (wasSwitching) {
              armFreezeTimer(views, 250);
            }
          }
        }
      }
    } catch (_err) {}
  }

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
        if (sel.fastPassRoots && typeof doc.querySelectorAll === 'function') {
          doc
            .querySelectorAll(sel.fastPassRoots)
            .forEach((convEl) => uiLocalizer.localizeStaticUiInRoot(convEl, observer));
        } else {
          const fallbackViews = queryConversationViews();
          if (fallbackViews.length > 0) {
            fallbackViews.forEach((convEl) => uiLocalizer.localizeStaticUiInRoot(convEl, observer));
          }
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

  function isIgnoredSubtree(el) {
    if (!el || typeof el.closest !== 'function' || !sel.noTranslateSubtree) return false;
    return Boolean(el.closest(sel.noTranslateSubtree));
  }

  function isTriggerLabelElement(el) {
    return Boolean(sel.triggerLabelClass && el && el.classList && el.classList.contains(sel.triggerLabelClass));
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
          if (tEl && (isIgnoredSubtree(tEl) || isTriggerLabelElement(tEl))) {
            continue;
          }
          scheduleCoalescedScan();
          return;
        }
        if (m.type === 'characterData' && m.target) {
          const parent = m.target.parentElement;
          if (
            parent &&
            !isTriggerLabelElement(parent) &&
            !isIgnoredSubtree(parent) &&
            m.target.__agyKoApplied !== String(m.target.nodeValue || '').trim()
          ) {
            scheduleCoalescedScan();
            return;
          }
        }
        if (m.type === 'attributes' && m.target && typeof m.target.closest === 'function') {
          if (isIgnoredSubtree(m.target)) {
            continue;
          }
          if (sel.cascadeIdAttr && m.attributeName === sel.cascadeIdAttr) {
            guardSessionSwitchTransitions();
            scheduleCoalescedScan();
            return;
          }
          if (m.attributeName === 'aria-expanded') {
            if (
              m.target.__agyProgrammaticClick ||
              (sel.autoExpandedAttr &&
                typeof m.target.getAttribute === 'function' &&
                m.target.getAttribute(sel.autoExpandedAttr) === '1' &&
                m.target.getAttribute('aria-expanded') === 'true')
            ) {
              continue;
            }
            scheduleCoalescedScan();
            return;
          }
          if (
            m.attributeName === 'class' &&
            sel.origLabelAttr &&
            typeof m.target.getAttribute === 'function' &&
            m.target.getAttribute(sel.origLabelAttr) === '1'
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
      const attributeFilter = ['style', 'aria-expanded', 'class', 'aria-hidden'];
      if (sel.cascadeIdAttr && !attributeFilter.includes(sel.cascadeIdAttr)) {
        attributeFilter.push(sel.cascadeIdAttr);
      }
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter,
      });
    }
    scanAll();
    if (!periodicTimer && effectiveIntervalMs > 0) {
      periodicTimer = setPeriodic(scanAll, effectiveIntervalMs);
    }
  }

  function clearSessionSwitchGuards() {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    try {
      const views = doc.querySelectorAll(
        '[data-agy-session-switching], [data-agy-added-no-animations]'
      );
      for (const v of views) {
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
    } catch (_err) {}
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
      sessionSwitchFreezeUntil = 0;
    }
    clearSessionSwitchGuards();
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
  DEFAULT_SELECTORS,
  createObserverScheduler,
};
