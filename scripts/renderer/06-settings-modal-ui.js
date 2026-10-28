// Module: 06-settings-modal-ui.js
// Responsibility: Stylesheet injection and Native Antigravity 2.0 Settings Modal (.settings-modal-container) UI integration.
  const STYLE_ID = 'agy-ko-thought-style';
  const STYLE_CSS = `
    .cursor-edit[data-agy-ko-ready="1"] > div:not(.agy-ko-thought-wrap) {
      display: none !important;
    }
    .agy-ko-thought-wrap {
      position: relative;
    }
    button[data-testid="thinking-collapsible-trigger"] > span[data-agy-orig-label="1"],
    button[data-testid="worked-for-collapsible"] > span[data-agy-orig-label="1"] {
      display: none !important;
    }
    .agy-ko-pill-group {
      display: inline-flex;
      align-items: center;
      border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(128, 128, 128, 0.12);
      padding: 2px;
      gap: 2px;
    }
    .agy-ko-pill-btn {
      appearance: none;
      border: none;
      background: transparent;
      color: inherit;
      opacity: 0.72;
      font-size: 12px;
      font-weight: 500;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .agy-ko-pill-btn:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.16);
    }
    .agy-ko-pill-btn.active {
      opacity: 1;
      font-weight: 600;
      color: #58d68d;
      background: rgba(88, 214, 141, 0.16);
      box-shadow: 0 0 0 1px rgba(88, 214, 141, 0.4) inset;
    }
    .agy-ko-action-btn {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.25);
      background: rgba(128, 128, 128, 0.14);
      color: inherit;
      font-size: 12px;
      font-weight: 500;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .agy-ko-action-btn:hover {
      background: rgba(128, 128, 128, 0.28);
      border-color: rgba(148, 163, 184, 0.45);
    }
    .agy-ko-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      height: 24px;
      width: 44px;
      border-radius: 9999px;
      border: none;
      cursor: pointer;
      transition: background-color 0.2s ease;
      padding: 0;
      background: rgba(128, 128, 128, 0.35);
    }
    .agy-ko-switch[aria-checked="true"] {
      background: #10b981;
    }
    .agy-ko-switch-thumb {
      display: inline-block;
      width: 16px;
      height: 16px;
      border-radius: 9999px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      transition: transform 0.2s ease;
      transform: translateX(4px);
    }
    .agy-ko-switch[aria-checked="true"] .agy-ko-switch-thumb {
      transform: translateX(24px);
    }
  `;

  function ensureStyle() {
    let st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = STYLE_CSS;
      (document.head || document.documentElement).appendChild(st);
    } else if (st.textContent !== STYLE_CSS) {
      st.textContent = STYLE_CSS;
    }
  }

  let settingsFeedbackMsg = '';
  let settingsFeedbackTimer = null;
  function showSettingsFeedback(msg) {
    settingsFeedbackMsg = msg;
    if (settingsFeedbackTimer) clearTimeout(settingsFeedbackTimer);
    if (typeof refreshTranslatorSettingsUi === 'function') {
      refreshTranslatorSettingsUi();
    }
    settingsFeedbackTimer = setTimeout(() => {
      settingsFeedbackMsg = '';
      if (typeof refreshTranslatorSettingsUi === 'function') {
        refreshTranslatorSettingsUi();
      }
    }, 3000);
  }

  // =========================================================================
  // Native 2.0 Settings UI & Quick Statusbar Modal (SD-001 / SD-003)
  // =========================================================================
  function getProviderDisplayMeta(id) {
    if (id === 'local-llm') {
      return {
        shortLabel: '로컬 LLM',
        title: '로컬 LLM (local-llm)',
        desc: '로컬 OpenAI 호환 서버(127.0.0.1:11434, 100% GPU 가속)를 사용하여 외부 전송 없이 번역합니다.',
      };
    }
    if (id === 'google-translate') {
      return {
        shortLabel: 'Google 번역',
        title: 'Google 번역 (google-translate)',
        desc: 'Google 번역(GTX) 엔드포인트를 사용하여 로컬 GPU 자원 소모 없이 빠르게 번역합니다.',
      };
    }
    const custom = TRANSLATION_ADAPTERS[id];
    return {
      shortLabel: custom?.label || id,
      title: `${custom?.label || id} (${id})`,
      desc: custom?.description || '등록된 사용자 정의 번역 어댑터입니다.',
    };
  }

  function renderTranslatorSettingsContent(container, isFullPage = false) {
    if (!container) return;
    container.textContent = '';

    const wrapper = document.createElement('div');
    wrapper.className = isFullPage
      ? 'p-6 flex flex-col gap-6 w-full max-w-2xl mx-auto'
      : 'flex flex-col gap-2 w-full';

    if (isFullPage) {
      const pageHdr = document.createElement('div');
      pageHdr.className = 'flex flex-col gap-1 w-full mb-1';
      const h2 = document.createElement('h2');
      h2.className = 'text-xl m-0 font-medium text-foreground';
      h2.textContent = '한글 번역 설정';
      const sub = document.createElement('div');
      sub.className = 'text-sm text-muted-foreground';
      sub.textContent =
        'Antigravity 2.0 추론 과정(Thinking) 및 UI 한글화에 사용할 어댑터 계층(SD-001/SD-003)과 동작 옵션을 설정합니다.';
      pageHdr.appendChild(h2);
      pageHdr.appendChild(sub);
      wrapper.appendChild(pageHdr);
    } else {
      const secHdr = document.createElement('div');
      secHdr.className = 'flex items-center justify-between';
      const h3 = document.createElement('h3');
      h3.className = 'm-0 text-sm font-medium text-foreground';
      h3.textContent = '한글 번역 계층 (Korean Thought & UI Translator)';
      const verBadge = document.createElement('span');
      verBadge.className = 'text-xs text-muted-foreground font-mono';
      verBadge.textContent = `${KO_LOCALIZER_VERSION} · 활성: ${getProviderDisplayMeta(activeTranslationProvider).shortLabel}`;
      secHdr.appendChild(h3);
      secHdr.appendChild(verBadge);
      wrapper.appendChild(secHdr);
    }

    const card = document.createElement('div');
    card.className = 'bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border';

    // Row 1: Translation Provider Adapter Selection
    const rowProvider = document.createElement('div');
    rowProvider.className = 'py-3 px-3.5 w-full bg-transparent flex flex-col gap-2.5';
    const rowProvTop = document.createElement('div');
    rowProvTop.className = 'flex justify-between gap-4 items-center flex-wrap';

    const provInfo = document.createElement('div');
    provInfo.className = 'flex-1 flex flex-col gap-0.5 min-w-[200px]';
    const provTitle = document.createElement('span');
    provTitle.className = 'text-sm font-medium text-foreground';
    provTitle.textContent = '번역 엔진 어댑터 (Translation Adapter)';
    const provDesc = document.createElement('span');
    provDesc.className = 'text-xs text-muted-foreground leading-relaxed';
    provDesc.textContent = getProviderDisplayMeta(activeTranslationProvider).desc;
    provInfo.appendChild(provTitle);
    provInfo.appendChild(provDesc);

    const pillGroup = document.createElement('div');
    pillGroup.className = 'agy-ko-pill-group shrink-0';
    for (const provId of Object.keys(TRANSLATION_ADAPTERS)) {
      const meta = getProviderDisplayMeta(provId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'agy-ko-pill-btn' + (provId === activeTranslationProvider ? ' active' : '');
      btn.setAttribute('data-agy-provider-option', provId);
      btn.textContent = (provId === activeTranslationProvider ? '✓ ' : '') + meta.shortLabel;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.__agySetTranslationProvider(provId);
        showSettingsFeedback(`✓ 번역 어댑터가 '${meta.title}'(으)로 즉시 적용되었습니다.`);
      };
      pillGroup.appendChild(btn);
    }

    rowProvTop.appendChild(provInfo);
    rowProvTop.appendChild(pillGroup);
    rowProvider.appendChild(rowProvTop);

    // Local LLM Endpoint Status Sub-bar
    const llmStatusRow = document.createElement('div');
    llmStatusRow.className = 'flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground flex-wrap';
    const llmStatusText = document.createElement('span');
    if (activeTranslationProvider !== 'local-llm') {
      llmStatusText.textContent =
        '○ 로컬 LLM 서버 자동 종료됨 (Google 번역 사용 중 — 메모리/GPU 반환)';
    } else if (resolvedLlmEndpoint && resolvedLlmEndpoint.baseUrl) {
      llmStatusText.textContent = `● 로컬 LLM 서버 연결됨: ${resolvedLlmEndpoint.baseUrl} (모델: ${resolvedLlmEndpoint.model})`;
      llmStatusText.style.color = '#58d68d';
    } else {
      llmStatusText.textContent = '○ 로컬 LLM 서버 기동/확인 중...';
    }
    const checkLlmBtn = document.createElement('button');
    checkLlmBtn.type = 'button';
    checkLlmBtn.className = 'agy-ko-action-btn';
    checkLlmBtn.textContent = '서버 연결 확인';
    checkLlmBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      llmStatusText.textContent = '로컬 LLM 서버 확인 중...';
      resolvedLlmEndpoint = null;
      const ep = await resolveLocalLlmEndpoint();
      if (ep) {
        showSettingsFeedback(`✓ 로컬 LLM 연결 확인: ${ep.baseUrl} (${ep.model})`);
      } else {
        showSettingsFeedback('⚠ 로컬 LLM 서버 응답 없음 (127.0.0.1:11434)');
      }
      refreshTranslatorSettingsUi();
    };
    llmStatusRow.appendChild(llmStatusText);
    llmStatusRow.appendChild(checkLlmBtn);
    rowProvider.appendChild(llmStatusRow);
    card.appendChild(rowProvider);

    // Row 2: Pre-translate Toggle Switch
    const rowPre = document.createElement('div');
    rowPre.className = 'py-3 px-3.5 w-full bg-transparent flex justify-between gap-4 items-center';
    const preInfo = document.createElement('div');
    preInfo.className = 'flex-1 flex flex-col gap-0.5';
    const preTitle = document.createElement('span');
    preTitle.className = 'text-sm font-medium text-foreground';
    preTitle.textContent = 'Thinking 백그라운드 사전 번역 (Pre-translation)';
    const preDesc = document.createElement('span');
    preDesc.className = 'text-xs text-muted-foreground leading-relaxed';
    preDesc.textContent =
      '접혀 있는 Thinking 블록을 펼치기 전에 백그라운드에서 미리 번역합니다. (기본값: 꺼짐)';
    preInfo.appendChild(preTitle);
    preInfo.appendChild(preDesc);

    const switchWrap = document.createElement('div');
    switchWrap.className = 'shrink-0 flex items-center gap-2';
    const switchStateLbl = document.createElement('span');
    switchStateLbl.className = 'text-xs font-medium text-muted-foreground';
    switchStateLbl.textContent = pretranslateEnabled ? '켜짐' : '꺼짐';
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('data-testid', 'agy-ko-pretranslate-switch');
    switchBtn.setAttribute('aria-checked', pretranslateEnabled ? 'true' : 'false');
    switchBtn.className = 'agy-ko-switch';
    const thumb = document.createElement('span');
    thumb.className = 'agy-ko-switch-thumb';
    switchBtn.appendChild(thumb);
    switchBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = !pretranslateEnabled;
      window.__agySetPretranslate(next);
      showSettingsFeedback(`✓ Thinking 사전 번역이 '${next ? '켜짐 (ON)' : '꺼짐 (OFF)'}'(으)로 설정되었습니다.`);
    };
    switchWrap.appendChild(switchStateLbl);
    switchWrap.appendChild(switchBtn);
    rowPre.appendChild(preInfo);
    rowPre.appendChild(switchWrap);
    card.appendChild(rowPre);

    // Row 3: Cache & Immediate Retranslate Controls
    const rowCache = document.createElement('div');
    rowCache.className = 'py-3 px-3.5 w-full bg-transparent flex justify-between gap-4 items-center flex-wrap';
    const cacheInfo = document.createElement('div');
    cacheInfo.className = 'flex-1 flex flex-col gap-0.5 min-w-[180px]';
    const cacheTitle = document.createElement('span');
    cacheTitle.className = 'text-sm font-medium text-foreground';
    cacheTitle.textContent = '번역 캐시 및 현재 화면 즉시 재번역';
    const cacheDesc = document.createElement('span');
    cacheDesc.className = 'text-xs text-muted-foreground';
    cacheDesc.textContent = `저장된 번역 캐시: ${memCache.size.toLocaleString('en-US')}개 문단`;
    cacheInfo.appendChild(cacheTitle);
    cacheInfo.appendChild(cacheDesc);

    const actionWrap = document.createElement('div');
    actionWrap.className = 'shrink-0 flex items-center gap-2';
    const retranslateBtn = document.createElement('button');
    retranslateBtn.type = 'button';
    retranslateBtn.className = 'agy-ko-action-btn';
    retranslateBtn.setAttribute('data-testid', 'agy-ko-retranslate-btn');
    retranslateBtn.textContent = '현재 화면 다시 번역';
    retranslateBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      retranslateVisibleThoughts(false);
      showSettingsFeedback(
        `✓ 현재 화면의 Thinking 블록을 '${getProviderDisplayMeta(activeTranslationProvider).shortLabel}' 어댑터로 다시 번역합니다.`
      );
    };

    const clearCacheBtn = document.createElement('button');
    clearCacheBtn.type = 'button';
    clearCacheBtn.className = 'agy-ko-action-btn';
    clearCacheBtn.setAttribute('data-testid', 'agy-ko-clear-cache-btn');
    clearCacheBtn.textContent = '캐시 비우기';
    clearCacheBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      retranslateVisibleThoughts(true);
      showSettingsFeedback('✓ 번역 캐시를 모두 비우고 현재 화면을 새로 번역합니다.');
    };

    actionWrap.appendChild(retranslateBtn);
    actionWrap.appendChild(clearCacheBtn);
    rowCache.appendChild(cacheInfo);
    rowCache.appendChild(actionWrap);
    card.appendChild(rowCache);

    wrapper.appendChild(card);

    if (settingsFeedbackMsg) {
      const fb = document.createElement('div');
      fb.className = 'text-xs font-medium px-2 py-1 rounded';
      fb.style.color = '#58d68d';
      fb.style.background = 'rgba(88, 214, 141, 0.1)';
      fb.textContent = settingsFeedbackMsg;
      wrapper.appendChild(fb);
    }

    container.appendChild(wrapper);
  }

  function ensureNativeSettingsModalIntegration() {
    const modal = document.querySelector('.settings-modal-container');
    if (!modal) return;

    // 1. Inject inline card at top of General tab (#agent-permissions)
    const permEl = modal.querySelector('#agent-permissions');
    if (permEl && permEl.parentElement) {
      let cardEl = modal.querySelector('#agy-ko-settings-card');
      if (!cardEl) {
        cardEl = document.createElement('div');
        cardEl.id = 'agy-ko-settings-card';
        cardEl.className = 'agy-ko-settings-root mb-6';
        permEl.parentElement.insertBefore(cardEl, permEl);
        renderTranslatorSettingsContent(cardEl, false);
      }
    }

    // 2. Inject dedicated '한글 번역' nav tab in left sidebar of Settings modal
    const modelsNavBtn = modal.querySelector('button[data-testid="settings-nav-item-Models"]');
    const navGroup = modelsNavBtn ? modelsNavBtn.closest('.flex.flex-col.gap-0\\.5') || modelsNavBtn.parentElement?.parentElement : null;
    if (navGroup && !modal.querySelector('button[data-testid="settings-nav-item-KoTranslator"]')) {
      const navWrap = document.createElement('div');
      navWrap.className = 'relative group/nav-item mx-2 agy-ko-settings-root';
      const navBtn = document.createElement('button');
      navBtn.type = 'button';
      navBtn.setAttribute('data-testid', 'settings-nav-item-KoTranslator');
      navBtn.className =
        'flex items-center gap-1.5 w-full px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted';
      const navSpan = document.createElement('span');
      navSpan.className =
        'text-sm transition-colors select-none truncate flex-1 text-secondary-foreground group-hover/nav-item:text-foreground';
      navSpan.textContent = '한글 번역';
      navBtn.appendChild(navSpan);
      navWrap.appendChild(navBtn);
      navGroup.appendChild(navWrap);

      const activateKoPane = () => {
        const rightGrow = modal.querySelector('.grow.w-full');
        if (!rightGrow) return;
        Array.from(rightGrow.children).forEach((ch) => {
          if (ch.id !== 'agy-ko-settings-pane') {
            if (ch.getAttribute('data-agy-prev-display') === null) {
              ch.setAttribute('data-agy-prev-display', ch.style.display || '');
            }
            ch.style.display = 'none';
          }
        });
        let pane = rightGrow.querySelector('#agy-ko-settings-pane');
        if (!pane) {
          pane = document.createElement('div');
          pane.id = 'agy-ko-settings-pane';
          pane.className = 'w-full bg-transparent h-full overflow-y-auto agy-ko-settings-root';
          rightGrow.appendChild(pane);
        }
        pane.style.display = 'block';
        renderTranslatorSettingsContent(pane, true);
        navBtn.classList.add('bg-sidebar-secondary');
        navSpan.classList.remove('text-secondary-foreground');
        navSpan.classList.add('text-foreground');
      };

      const deactivateKoPane = () => {
        const rightGrow = modal.querySelector('.grow.w-full');
        if (!rightGrow) return;
        const pane = rightGrow.querySelector('#agy-ko-settings-pane');
        if (!pane || pane.style.display === 'none') return;
        pane.style.display = 'none';
        Array.from(rightGrow.children).forEach((ch) => {
          if (ch.id !== 'agy-ko-settings-pane' && ch.getAttribute('data-agy-prev-display') !== null) {
            ch.style.display = ch.getAttribute('data-agy-prev-display');
            ch.removeAttribute('data-agy-prev-display');
          }
        });
        navBtn.classList.remove('bg-sidebar-secondary');
        navSpan.classList.remove('text-foreground');
        navSpan.classList.add('text-secondary-foreground');
      };

      navBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateKoPane();
      };

      modal
        .querySelectorAll('button[data-testid^="settings-nav-item-"]:not([data-testid="settings-nav-item-KoTranslator"])')
        .forEach((otherBtn) => {
          if (!otherBtn.__agyKoNavBound) {
            otherBtn.__agyKoNavBound = true;
            otherBtn.addEventListener('click', () => deactivateKoPane(), true);
          }
        });
    }
  }

  function refreshTranslatorSettingsUi() {
    const cardEl = document.getElementById('agy-ko-settings-card');
    if (cardEl) renderTranslatorSettingsContent(cardEl, false);
    const paneEl = document.getElementById('agy-ko-settings-pane');
    if (paneEl && paneEl.style.display !== 'none') renderTranslatorSettingsContent(paneEl, true);
    if (typeof refreshStatusbarTranslatorAdapter === 'function') {
      refreshStatusbarTranslatorAdapter();
    }
  }
