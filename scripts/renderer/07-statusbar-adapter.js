// Module: 07-statusbar-adapter.js
// Responsibility: Pure StatusBarAdapter bridge (`window.agyStatusBar.registerAdapter` / `unregisterAdapter` / `updateAll`) with zero direct DOM or CSS manipulation of statusbar regions.
  const STATUSBAR_ADAPTER_ID = 'ko-translator';

  function getStatusbarCompactProviderTag(id) {
    if (id === 'local-llm') return 'LLM';
    if (id === 'google-translate') return '구글';
    return getProviderDisplayMeta(id).shortLabel;
  }

  function formatStatusbarAdapterLabel() {
    return `[ 번역:${getStatusbarCompactProviderTag(activeTranslationProvider)} ]`;
  }

  function formatStatusbarAdapterTitle() {
    const meta = getProviderDisplayMeta(activeTranslationProvider);
    return `한글 번역 설정 (${KO_LOCALIZER_VERSION}) — 활성: ${meta.title}\n클릭: 한글 번역 계층 설정창 열기/닫기\nShift+클릭: 로컬 LLM ↔ Google 번역 빠른 전환`;
  }

  let disposeStatusbarAdapter = null;
  let boundStatusBarRef = null;

  function createKoTranslatorStatusbarAdapter() {
    return {
      id: STATUSBAR_ADAPTER_ID,
      slot: 'right',
      order: 30,
      className: 'agy-ko-translator-status-btn',
      label: () => formatStatusbarAdapterLabel(),
      title: () => formatStatusbarAdapterTitle(),
      onClick(_ctx, event) {
        if (event && event.shiftKey) {
          const nextProv = activeTranslationProvider === 'local-llm' ? 'google-translate' : 'local-llm';
          window.__agySetTranslationProvider(nextProv);
        } else {
          openOrToggleTranslatorSettingsModal();
        }
      },
      unmount() {
        closeTranslatorSettingsModal();
      },
    };
  }

  function registerStatusbarTranslatorAdapter() {
    if (disposed) return false;
    const sb = window.agyStatusBar;
    if (sb && typeof sb.registerAdapter === 'function') {
      if (boundStatusBarRef === sb && typeof disposeStatusbarAdapter === 'function') {
        return true;
      }
      boundStatusBarRef = sb;
      disposeStatusbarAdapter = sb.registerAdapter(createKoTranslatorStatusbarAdapter());
      return true;
    }

    if (!window.__agyCustomStatusBarAdapters || !(window.__agyCustomStatusBarAdapters instanceof Map)) {
      window.__agyCustomStatusBarAdapters = new Map();
    }
    if (!window.__agyCustomStatusBarAdapters.has(STATUSBAR_ADAPTER_ID)) {
      window.__agyCustomStatusBarAdapters.set(STATUSBAR_ADAPTER_ID, createKoTranslatorStatusbarAdapter());
    }
    return false;
  }

  function refreshStatusbarTranslatorAdapter() {
    if (disposed) return;
    registerStatusbarTranslatorAdapter();
    if (window.agyStatusBar && typeof window.agyStatusBar.updateAll === 'function') {
      window.agyStatusBar.updateAll();
    }
  }

  function unregisterStatusbarTranslatorAdapter() {
    try {
      if (typeof disposeStatusbarAdapter === 'function') {
        disposeStatusbarAdapter();
      } else if (window.agyStatusBar && typeof window.agyStatusBar.unregisterAdapter === 'function') {
        window.agyStatusBar.unregisterAdapter(STATUSBAR_ADAPTER_ID);
      }
      if (window.__agyCustomStatusBarAdapters && typeof window.__agyCustomStatusBarAdapters.delete === 'function') {
        window.__agyCustomStatusBarAdapters.delete(STATUSBAR_ADAPTER_ID);
      }
    } catch (e) {}
    disposeStatusbarAdapter = null;
    boundStatusBarRef = null;
    closeTranslatorSettingsModal();
    delete window.__agyOpenTranslatorSettingsModal;
  }
