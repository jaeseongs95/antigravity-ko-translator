// Module: 07-statusbar-adapter.js
// Responsibility: Pluggable StatusBarAdapter integration with antigravity-statusbar (window.agyStatusBar.registerAdapter) and standalone quick settings modal (#agy-ko-translator-modal) without intruding into statusbar core DOM or layout regions.
  const STATUSBAR_ADAPTER_ID = 'ko-translator';
  const STATUSBAR_MODAL_STYLE_ID = 'agy-ko-statusbar-adapter-style';
  const STATUSBAR_MODAL_CSS = `
    .agy-ctx-statusbar [data-agy-adapter-id="ko-translator"] {
      white-space: nowrap;
      flex-shrink: 0;
    }
    .agy-ctx-btn-ko-settings:hover {
      color: #58d68d !important;
      border-color: rgba(88, 214, 141, 0.45) !important;
      background: rgba(88, 214, 141, 0.14) !important;
    }
    #agy-ko-translator-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(2px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .agy-ko-modal-dialog {
      background: #18181d;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 12px;
      width: 100%;
      max-width: 640px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.7);
      overflow: hidden;
    }
    .agy-ko-modal-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #202027;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      font-size: 13.5px;
      font-weight: 600;
    }
    .agy-ko-modal-body {
      padding: 16px;
      overflow-y: auto;
    }
  `;

  function ensureStatusbarAdapterStyle() {
    let st = document.getElementById(STATUSBAR_MODAL_STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STATUSBAR_MODAL_STYLE_ID;
      st.textContent = STATUSBAR_MODAL_CSS;
      (document.head || document.documentElement).appendChild(st);
    } else if (st.textContent !== STATUSBAR_MODAL_CSS) {
      st.textContent = STATUSBAR_MODAL_CSS;
    }
  }

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

  function openOrToggleTranslatorSettingsModal() {
    const existing = document.getElementById('agy-ko-translator-modal');
    if (existing) {
      existing.remove();
      return { open: false };
    }
    ensureStyle();
    ensureStatusbarAdapterStyle();
    if (!resolvedLlmEndpoint && activeTranslationProvider === 'local-llm') {
      resolveLocalLlmEndpoint().then(() => refreshTranslatorSettingsUi());
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'agy-ko-translator-modal';
    backdrop.className = 'agy-ko-settings-root';

    const dialog = document.createElement('div');
    dialog.className = 'agy-ko-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', '한글 번역 계층 설정');

    const hdr = document.createElement('div');
    hdr.className = 'agy-ko-modal-hdr';
    const hdrTitle = document.createElement('span');
    hdrTitle.textContent = `한글 번역 계층 설정 (${KO_LOCALIZER_VERSION})`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'agy-ctx-btn';
    closeBtn.textContent = '[ × ]';
    closeBtn.title = '닫기 (ESC)';

    const closeModal = () => {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKeyDown);
    closeBtn.onclick = closeModal;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeModal();
    };

    hdr.appendChild(hdrTitle);
    hdr.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'agy-ko-modal-body';
    body.id = 'agy-ko-translator-modal-body';
    renderTranslatorSettingsContent(body, false);

    dialog.appendChild(hdr);
    dialog.appendChild(body);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    return { open: true };
  }
  window.__agyOpenTranslatorSettingsModal = openOrToggleTranslatorSettingsModal;

  let disposeStatusbarAdapter = null;
  let boundStatusBarRef = null;

  function createKoTranslatorStatusbarAdapter() {
    return {
      id: STATUSBAR_ADAPTER_ID,
      slot: 'right',
      order: 30,
      className: 'agy-ctx-btn agy-ctx-btn-ko-settings',
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
        const modal = document.getElementById('agy-ko-translator-modal');
        if (modal) modal.remove();
      },
    };
  }

  function registerStatusbarTranslatorAdapter() {
    if (disposed) return false;
    ensureStatusbarAdapterStyle();
    const adapterSpec = createKoTranslatorStatusbarAdapter();

    if (!window.__agyCustomStatusBarAdapters || !(window.__agyCustomStatusBarAdapters instanceof Map)) {
      window.__agyCustomStatusBarAdapters = new Map();
    }
    if (!window.__agyCustomStatusBarAdapters.has(STATUSBAR_ADAPTER_ID)) {
      window.__agyCustomStatusBarAdapters.set(STATUSBAR_ADAPTER_ID, adapterSpec);
    }

    const sb = window.agyStatusBar;
    if (sb && typeof sb.registerAdapter === 'function') {
      const hasAdapter =
        typeof sb.getAdapters === 'function' &&
        Array.isArray(sb.getAdapters()) &&
        sb.getAdapters().some((a) => a && a.id === STATUSBAR_ADAPTER_ID);
      if (boundStatusBarRef !== sb || !hasAdapter) {
        boundStatusBarRef = sb;
        disposeStatusbarAdapter = sb.registerAdapter(adapterSpec);
      }
      return true;
    }
    return false;
  }

  function refreshStatusbarTranslatorAdapter() {
    if (disposed) return;
    registerStatusbarTranslatorAdapter();
    const nextLabel = formatStatusbarAdapterLabel();
    const nextTitle = formatStatusbarAdapterTitle();
    document
      .querySelectorAll(`.agy-ctx-statusbar [data-agy-adapter-id="${STATUSBAR_ADAPTER_ID}"]`)
      .forEach((btn) => {
        if (btn.textContent !== nextLabel) btn.textContent = nextLabel;
        if (btn.getAttribute('title') !== nextTitle) {
          btn.setAttribute('title', nextTitle);
          btn.title = nextTitle;
        }
      });
    const modalBody = document.getElementById('agy-ko-translator-modal-body');
    if (modalBody) {
      renderTranslatorSettingsContent(modalBody, false);
    }
  }

  function unregisterStatusbarTranslatorAdapter(fullRestore = false) {
    try {
      if (typeof disposeStatusbarAdapter === 'function') {
        disposeStatusbarAdapter();
      } else if (window.agyStatusBar && typeof window.agyStatusBar.unregisterAdapter === 'function') {
        window.agyStatusBar.unregisterAdapter(STATUSBAR_ADAPTER_ID);
      }
    } catch (e) {}
    disposeStatusbarAdapter = null;
    boundStatusBarRef = null;
    try {
      if (window.__agyCustomStatusBarAdapters instanceof Map) {
        window.__agyCustomStatusBarAdapters.delete(STATUSBAR_ADAPTER_ID);
      }
    } catch (e) {}
    const modal = document.getElementById('agy-ko-translator-modal');
    if (modal) modal.remove();
    delete window.__agyOpenTranslatorSettingsModal;
    if (fullRestore) {
      const st = document.getElementById(STATUSBAR_MODAL_STYLE_ID);
      if (st) st.remove();
    }
  }
