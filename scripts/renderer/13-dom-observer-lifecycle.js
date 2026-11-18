// Module: 13-dom-observer-lifecycle.js
// Responsibility: Session-switch transition guard, fast/coalesced MutationObserver scheduler, periodic rescan, and deterministic DisposableRegistry teardown.
  function scanAll() {
    ensureStyle();
    registerStatusbarTranslatorAdapter();
    bridgeRemoteControlIframe();
    if (document.body) {
      localizeStaticUiInRoot(document.body);
      ensureNativeSettingsModalIntegration();
      ensureThinkingDisplayMenuIntegration();
      if (
        document.getElementById('agy-ko-translator-modal') &&
        !document.querySelector('[data-testid="agy-ko-translate-thinking-switch"]') &&
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
  window.__agyForceRescanAll = scanAll;
  disposables.registerWindowGlobal('__agyForceRescanAll');

  // Fast pre-paint pass for Thinking/Worked triggers and .cursor-edit blocks (prevents session-switch FOUC)
  // paired with microtask deduplication and a 16ms coalesced timer for full-document static UI localization.
  let inFastScan = false;
  let fastScanMicrotaskScheduled = false;
  let scanTimerScheduled = false;
  let lastObservedCascadeId = null;
  let sessionSwitchFreezeTimer = null;
  let sessionSwitchFreezeUntil = 0;

  function guardSessionSwitchTransitions() {
    try {
      if (!document) return;
      const views =
        typeof document.querySelectorAll === 'function'
          ? Array.from(
              document.querySelectorAll(
                '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"]'
              )
            )
          : [];
      if (views.length === 0 && typeof document.querySelector === 'function') {
        const single =
          document.querySelector('[data-testid="conversation-view"]') ||
          document.querySelector('[data-testid="subagent-tab-conversation"]') ||
          document.querySelector('[data-testid="side-question-tab-conversation"]');
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
            } catch (e) {}
          }
        }
        const now = typeof Date !== 'undefined' && typeof Date.now === 'function' ? Date.now() : 0;
        const requestedUntil = now + durationMs;
        if (sessionSwitchFreezeTimer && sessionSwitchFreezeUntil > requestedUntil) {
          return;
        }
        sessionSwitchFreezeUntil = Math.max(sessionSwitchFreezeUntil, requestedUntil);
        const remainingMs = Math.max(durationMs, sessionSwitchFreezeUntil - now);
        if (sessionSwitchFreezeTimer) clearTimeout(sessionSwitchFreezeTimer);
        sessionSwitchFreezeTimer = setTimeout(() => {
          sessionSwitchFreezeTimer = null;
          sessionSwitchFreezeUntil = 0;
          try {
            const liveViews =
              typeof document.querySelectorAll === 'function'
                ? Array.from(
                    document.querySelectorAll(
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
            if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
              observer.takeRecords();
            }
          } catch (e) {}
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
    } catch (e) {}
  }

  function runFastThoughtAndTriggerScan() {
    ensureVerboseConversationStepsEnabled();
    guardSessionSwitchTransitions();
    if (disposed || inFastScan) return;
    inFastScan = true;
    try {
      scanTriggerButtonsSync();
      ensureThinkingDisplayMenuIntegration();
      if (document.querySelectorAll) {
        document
          .querySelectorAll(
            '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"], [data-testid="idle-status-text"], [data-testid="conversation-navigator"]'
          )
          .forEach((convEl) => localizeStaticUiInRoot(convEl));
      } else if (document.querySelector) {
        const convEl =
          document.querySelector('[data-testid="conversation-view"]') ||
          document.querySelector('[data-testid="subagent-tab-conversation"]') ||
          document.querySelector('[data-testid="side-question-tab-conversation"]');
        if (convEl) localizeStaticUiInRoot(convEl);
      }
      const mcpModal = document.getElementById('agy-mcp-manager-modal-backdrop');
      if (mcpModal) localizeStaticUiInRoot(mcpModal);
      const mcpEditPopup = document.getElementById('agy-mcp-edit-popup-backdrop');
      if (mcpEditPopup) localizeStaticUiInRoot(mcpEditPopup);
      const mcpOAuthModal = document.getElementById('agy-mcp-oauth-connect-backdrop');
      if (mcpOAuthModal) localizeStaticUiInRoot(mcpOAuthModal);
      const mcpSettingsPane = document.getElementById('agy-mcp-settings-pane');
      if (mcpSettingsPane) localizeStaticUiInRoot(mcpSettingsPane);
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
      scanSideQuestionAndBrowserSubagentThoughts();
      if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
        observer.takeRecords();
      }
    } finally {
      inFastScan = false;
    }
  }

  function scheduleCoalescedScan() {
    if (disposed) return;
    if (!fastScanMicrotaskScheduled) {
      fastScanMicrotaskScheduled = true;
      Promise.resolve().then(() => {
        fastScanMicrotaskScheduled = false;
        if (!disposed) {
          runFastThoughtAndTriggerScan();
        }
      });
    }
    if (!scanTimerScheduled) {
      scanTimerScheduled = true;
      setTimeout(() => {
        scanTimerScheduled = false;
        if (disposed) return;
        if (document.body) {
          localizeStaticUiInRoot(document.body);
          ensureNativeSettingsModalIntegration();
          ensureThinkingDisplayMenuIntegration();
          if (
            document.getElementById('agy-ko-translator-modal') &&
            !document.querySelector('[data-testid="agy-ko-translate-thinking-switch"]') &&
            typeof refreshTranslatorSettingsUi === 'function'
          ) {
            refreshTranslatorSettingsUi();
          }
        }
        runFastThoughtAndTriggerScan();
        if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
          observer.takeRecords();
        }
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
          (tEl.closest(CUSTOM_NO_TRANSLATE_SUBTREE_SELECTOR) ||
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
          (!parent.closest || !parent.closest(CUSTOM_NO_TRANSLATE_SUBTREE_SELECTOR)) &&
          m.target.__agyKoApplied !== (m.target.nodeValue || '').trim()
        ) {
          scheduleCoalescedScan();
          return;
        }
      }
      if (m.type === 'attributes' && m.target && m.target.closest) {
        if (m.target.closest(CUSTOM_NO_TRANSLATE_SUBTREE_SELECTOR)) {
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
            (m.target.getAttribute &&
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
      disposables.registerEvent(window, 'DOMContentLoaded', startObserver, { once: true });
      return;
    }
    if (document.addEventListener) {
      disposables.registerEvent(document, 'click', onTriggerButtonClickCapture, true);
    }
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'aria-expanded', 'class', 'data-cascade-id'],
    });
    loadPersistentTranslatorSettings();
    registerStatusbarTranslatorAdapter();
    if (activeTranslationProvider === 'local-llm') {
      resolveLocalLlmEndpoint().then(() => refreshTranslatorSettingsUi());
    }
    scanAll();
  }

  startObserver();
  const intervalId = disposables.registerInterval(setInterval(scanAll, 2500));
  window.__agyKoLocalizerActive = KO_LOCALIZER_VERSION;

  const OWN_WINDOW_GLOBALS = [
    '__agyMountKoThoughtLocalizer',
    '__agyKoLocalizerActive',
    '__agyKoThoughtCleanup',
    '__agyTranslateStaticUiSync',
    '__agyGetTranslationProvider',
    '__agyListTranslationProviders',
    '__agyRegisterTranslationAdapter',
    '__agySetTranslationProvider',
    '__agySyncPersistentSettings',
    '__agyPretranslateStats',
    '__agyGetShowThinking',
    '__agySetShowThinking',
    '__agyGetTranslateThinking',
    '__agySetTranslateThinking',
    '__agyGetPretranslate',
    '__agySetPretranslate',
    '__agyOpenTranslatorSettingsModal',
    '__agyRetranslateVisibleThoughts',
    '__agyForceRescanAll',
    '__agyLastDefaultPretranslate',
    '__agyLastDefaultProvider',
    '__agyKoTrustedPolicy',
    '__agyRemoteControlInstance',
    '__agyKoSyncingCompanions',
    '__agyKoCompanionsSynced',
    '__agyLastHostInstalledPluginsRef',
    '__agyKoFetchingStatusBar',
    '__agyKoFetchingMcpManager',
    '__agyLoadingStatusBarCompanion',
    '__agyLoadingMcpManagerCompanion',
    '__agySharedKoMemCache',
  ];
  for (const prop of OWN_WINDOW_GLOBALS) {
    disposables.registerWindowGlobal(prop);
  }

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
    if (sessionSwitchFreezeTimer) clearTimeout(sessionSwitchFreezeTimer);
    observer.disconnect();
    if (typeof cleanupNativeSettingsModalIntegration === 'function') {
      cleanupNativeSettingsModalIntegration();
    }
    delete window.__agyKoLocalizerActive;
    unregisterStatusbarTranslatorAdapter(fullRestore);
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
    });
    document
      .querySelectorAll(
        '#agy-ko-settings-card, #agy-ko-settings-pane, #agy-ko-model-menu-thinking-row, #agy-ko-appearance-thinking-row, button[data-testid="settings-nav-item-KoTranslator"]'
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
      document
        .querySelectorAll('.cursor-edit[data-agy-ko-ready], [data-agy-ko-thought-host="1"]')
        .forEach((el) => {
          el.removeAttribute('data-agy-ko-ready');
          el.removeAttribute('data-agy-ko-thought-host');
        });
      document.querySelectorAll('[data-agy-auto-expanded]').forEach((el) => {
        el.removeAttribute('data-agy-auto-expanded');
      });
      if (document.documentElement) {
        document.documentElement.removeAttribute('data-agy-hide-thinking');
      }
      restoreAllMutatedNodes();
      if (!window.agyStatusBar && !window.__agyMountMcpManager) {
        try {
          delete window.__agyCapturedLsClient;
        } catch (e) {}
      }
    }
    disposables.disposeAll(fullRestore);
  };
