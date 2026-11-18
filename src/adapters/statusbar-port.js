'use strict';

const STATUSBAR_ADAPTER_ID = 'ko-translator';

function createStatusbarAdapterPort({
  targetWin,
  version,
  translationService,
  registry,
  getCompactTag,
  getProviderTitle,
  onToggleSettings,
  onCloseSettings,
  onCycleProvider,
} = {}) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  let disposeAdapterFn = null;
  let boundStatusBarRef = null;
  let disposed = false;

  function resolveCompactTag() {
    const effId = translationService ? translationService.getEffectiveProviderId() : '';
    if (typeof getCompactTag === 'function') {
      return getCompactTag(effId);
    }
    return effId || 'KO';
  }

  function formatLabel() {
    return `[ 번역:${resolveCompactTag()} ]`;
  }

  function formatTitle() {
    const effId = translationService ? translationService.getEffectiveProviderId() : '';
    const titleText =
      typeof getProviderTitle === 'function'
        ? getProviderTitle(effId)
        : translationService
          ? translationService.getEffectiveProviderLabel()
          : effId;
    return `한글 번역 설정 (${version}) — 활성: ${titleText}\n클릭: 한글 번역 계층 설정창 열기/닫기\nShift+클릭: 등록된 번역 어댑터 순환 전환`;
  }

  function buildAdapterSpec() {
    return {
      id: STATUSBAR_ADAPTER_ID,
      slot: 'right',
      order: 30,
      className: 'agy-ko-translator-status-btn',
      label: () => formatLabel(),
      title: () => formatTitle(),
      onClick(_ctx, event) {
        if (event && event.shiftKey) {
          if (typeof onCycleProvider === 'function') {
            onCycleProvider();
            return;
          }
          if (registry && translationService) {
            const ids = registry.listProviderIds();
            if (ids.length > 0) {
              const cur = translationService.getDesiredProviderId();
              const idx = ids.indexOf(cur);
              const next = ids[(idx + 1) % ids.length];
              translationService.setProvider(next);
            }
          }
        } else if (typeof onToggleSettings === 'function') {
          onToggleSettings();
        }
      },
      unmount() {
        if (typeof onCloseSettings === 'function') {
          onCloseSettings();
        }
      },
    };
  }

  function register() {
    if (disposed || !win) return false;
    const sb = win.agyStatusBar;
    if (sb && typeof sb.registerAdapter === 'function') {
      if (boundStatusBarRef === sb && typeof disposeAdapterFn === 'function') {
        return true;
      }
      boundStatusBarRef = sb;
      disposeAdapterFn = sb.registerAdapter(buildAdapterSpec());
      return true;
    }
    const pendingMap = win.__agyCustomStatusBarAdapters;
    if (
      pendingMap &&
      typeof pendingMap.has === 'function' &&
      typeof pendingMap.set === 'function' &&
      !pendingMap.has(STATUSBAR_ADAPTER_ID)
    ) {
      pendingMap.set(STATUSBAR_ADAPTER_ID, buildAdapterSpec());
    }
    return false;
  }

  function refresh() {
    if (disposed || !win) return;
    register();
    if (win.agyStatusBar && typeof win.agyStatusBar.updateAll === 'function') {
      try {
        win.agyStatusBar.updateAll();
      } catch (_err) {}
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (win) {
      try {
        if (typeof disposeAdapterFn === 'function') {
          disposeAdapterFn();
        } else if (win.agyStatusBar && typeof win.agyStatusBar.unregisterAdapter === 'function') {
          win.agyStatusBar.unregisterAdapter(STATUSBAR_ADAPTER_ID);
        }
      } catch (_err) {}
      try {
        if (
          win.__agyCustomStatusBarAdapters &&
          typeof win.__agyCustomStatusBarAdapters.delete === 'function'
        ) {
          win.__agyCustomStatusBarAdapters.delete(STATUSBAR_ADAPTER_ID);
        }
      } catch (_err) {}
    }
    disposeAdapterFn = null;
    boundStatusBarRef = null;
    if (typeof onCloseSettings === 'function') {
      try {
        onCloseSettings();
      } catch (_err) {}
    }
  }

  return {
    id: STATUSBAR_ADAPTER_ID,
    register,
    refresh,
    dispose,
    formatLabel,
    formatTitle,
  };
}

module.exports = {
  STATUSBAR_ADAPTER_ID,
  createStatusbarAdapterPort,
};
