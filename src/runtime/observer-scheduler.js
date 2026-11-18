'use strict';

const NO_TRANSLATE_SUBTREE_SELECTOR =
  '.agy-ctx-statusbar, .agy-ctx-menu, #agy-ctx-debug-modal, .agy-ctx-modal-backdrop, ' +
  '.agy-ko-settings-root, #agy-ko-translator-modal, .agy-ko-thought-wrap, ' +
  '[data-agy-no-translate="true"]';

function createObserverScheduler({
  targetWin,
  targetDoc,
  disposables,
  uiLocalizer,
  triggerController,
  thinkingTranslator,
  pretranslator,
  settingsUi,
  statusbarPort,
  workbenchPromoter,
  onSyncPersistentSettings = null,
  periodicIntervalMs = 2500,
} = {}) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  const setTimer =
    win && typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
  const clearTimer =
    win && typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
  const setPeriodic =
    win && typeof win.setInterval === 'function' ? win.setInterval.bind(win) : setInterval;
  const clearPeriodic =
    win && typeof win.clearInterval === 'function' ? win.clearInterval.bind(win) : clearInterval;

  let disposed = false;
  let inFastScan = false;
  let fastScanMicrotaskScheduled = false;
  let fullScanTimer = null;
  let pretranslateTimer = null;
  let periodicTimer = null;
  let lastObservedCascadeId = null;
  let sessionSwitchFreezeTimer = null;
  let sessionSwitchFreezeUntil = 0;
  let observer = null;

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
          if (typeof v.getAnimations === 'function') {
            try {
              const anims = v.getAnimations({ subtree: true });
              if (Array.isArray(anims)) {
                for (const anim of anims) {
                  if (anim && typeof anim.cancel === 'function') anim.cancel();
                }
              }
            } catch (_err) {}
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
    if (disposed || inFastScan || !doc) return;
    inFastScan = true;
    try {
      if (triggerController) {
        triggerController.scanTriggerButtonsSync();
      }
      if (settingsUi) {
        settingsUi.ensureThinkingDisplayMenuIntegration();
      }
      if (uiLocalizer) {
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
        if (typeof doc.getElementById === 'function') {
          for (const companionId of [
            'agy-mcp-manager-modal-backdrop',
            'agy-mcp-edit-popup-backdrop',
            'agy-mcp-oauth-connect-backdrop',
            'agy-mcp-settings-pane',
          ]) {
            const el = doc.getElementById(companionId);
            if (el) uiLocalizer.localizeStaticUiInRoot(el, observer);
          }
        }
        if (typeof doc.querySelectorAll === 'function') {
          doc
            .querySelectorAll('[data-agy-custom-mcp-btn]')
            .forEach((el) => uiLocalizer.localizeStaticUiInRoot(el, observer));
        }
      }
      if (thinkingTranslator) {
        thinkingTranslator.scanThoughtBlocks();
      }
      drainObserverRecords();
    } finally {
      inFastScan = false;
    }
  }

  function scanAll() {
    if (disposed || !doc) return;
    if (settingsUi) settingsUi.ensureStyle();
    if (statusbarPort) statusbarPort.register();
    if (workbenchPromoter) workbenchPromoter.scanAndPromoteAll();
    if (doc.body && uiLocalizer) {
      uiLocalizer.localizeStaticUiInRoot(doc.body, observer);
    }
    if (doc.body && settingsUi) {
      settingsUi.ensureNativeSettingsModalIntegration();
      settingsUi.ensureThinkingDisplayMenuIntegration();
    }
    if (thinkingTranslator) {
      thinkingTranslator.scanThoughtBlocks();
    }
    drainObserverRecords();
  }

  function schedulePretranslateDebounce() {
    if (disposed || !pretranslator || !pretranslator.isEnabled() || pretranslateTimer) return;
    pretranslateTimer = setTimer(() => {
      pretranslateTimer = null;
      if (!disposed && pretranslator.isEnabled()) {
        pretranslator.runPretranslatePass().catch(() => {});
      }
    }, 120);
  }

  function scheduleCoalescedScan() {
    if (disposed) return;
    if (!fastScanMicrotaskScheduled) {
      fastScanMicrotaskScheduled = true;
      Promise.resolve().then(() => {
        fastScanMicrotaskScheduled = false;
        if (!disposed) {
          runFastPass();
        }
      });
    }
    if (!fullScanTimer) {
      fullScanTimer = setTimer(() => {
        fullScanTimer = null;
        if (disposed || !doc) return;
        if (workbenchPromoter) workbenchPromoter.scanAndPromoteAll();
        if (doc.body && uiLocalizer) {
          uiLocalizer.localizeStaticUiInRoot(doc.body, observer);
        }
        if (doc.body && settingsUi) {
          settingsUi.ensureNativeSettingsModalIntegration();
          settingsUi.ensureThinkingDisplayMenuIntegration();
        }
        runFastPass();
        drainObserverRecords();
      }, 16);
    }
    schedulePretranslateDebounce();
  }

  function createMutationObserver() {
    const ObsCtor = (win && win.MutationObserver) || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    if (typeof ObsCtor !== 'function') return null;
    return new ObsCtor((mutations) => {
      if (disposed) return;
      for (const m of mutations) {
        if (m.type === 'childList' && ((m.addedNodes && m.addedNodes.length > 0) || (m.removedNodes && m.removedNodes.length > 0))) {
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
  }

  function start() {
    if (disposed || !doc) return;
    const root = doc.body || doc.documentElement;
    if (!root) {
      if (win && disposables && typeof disposables.registerEvent === 'function') {
        disposables.registerEvent(win, 'DOMContentLoaded', start, { once: true });
      }
      return;
    }
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
    if (typeof onSyncPersistentSettings === 'function') {
      Promise.resolve(onSyncPersistentSettings()).catch(() => {});
    }
    scanAll();
    if (!periodicTimer && periodicIntervalMs > 0) {
      periodicTimer = setPeriodic(scanAll, periodicIntervalMs);
      if (disposables && typeof disposables.registerInterval === 'function') {
        disposables.registerInterval(periodicTimer, clearPeriodic);
      }
    }
  }

  function stop() {
    disposed = true;
    if (fullScanTimer) {
      clearTimer(fullScanTimer);
      fullScanTimer = null;
    }
    if (pretranslateTimer) {
      clearTimer(pretranslateTimer);
      pretranslateTimer = null;
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

  return {
    start,
    stop,
    scanAll,
    runFastPass,
    scheduleCoalescedScan,
    schedulePretranslateDebounce,
    guardSessionSwitchTransitions,
    getObserver: () => observer,
  };
}

module.exports = {
  NO_TRANSLATE_SUBTREE_SELECTOR,
  createObserverScheduler,
};
