'use strict';

const STYLE_ID = 'agy-ko-thought-style';
const STYLE_CSS = `
  .cursor-edit[data-agy-ko-ready="1"] > div:not(.agy-ko-thought-wrap),
  [data-agy-ko-thought-host="1"][data-agy-ko-ready="1"] > div:not(.agy-ko-thought-wrap) {
    display: none !important;
  }
  .agy-ko-thought-wrap {
    position: relative;
    contain: layout style;
  }
  button[data-testid="thinking-collapsible-trigger"] > span[data-agy-orig-label="1"],
  button[data-testid="worked-for-collapsible"] > span[data-agy-orig-label="1"],
  button[data-testid="tool-group-collapsible"] > span[data-agy-orig-label="1"],
  [data-testid="side-question-answer"] button[aria-expanded] > span[data-agy-orig-label="1"] {
    display: none !important;
    font-size: 0 !important;
    visibility: hidden !important;
  }
  button[data-testid="thinking-collapsible-trigger"][data-agy-auto-expanded="1"],
  button[data-testid="worked-for-collapsible"][data-agy-auto-expanded="1"],
  button[data-testid="tool-group-collapsible"][data-agy-auto-expanded="1"],
  button[data-testid="thinking-collapsible-trigger"][data-agy-auto-expanded="1"] *,
  button[data-testid="worked-for-collapsible"][data-agy-auto-expanded="1"] *,
  button[data-testid="tool-group-collapsible"][data-agy-auto-expanded="1"] *,
  button[data-testid="thinking-collapsible-trigger"][data-agy-auto-expanded="1"][aria-expanded="true"] + div,
  button[data-testid="worked-for-collapsible"][data-agy-auto-expanded="1"][aria-expanded="true"] + div,
  button[data-testid="tool-group-collapsible"][data-agy-auto-expanded="1"][aria-expanded="true"] + div,
  button[data-testid="thinking-collapsible-trigger"][data-agy-auto-expanded="1"][aria-expanded="true"] + div *,
  button[data-testid="worked-for-collapsible"][data-agy-auto-expanded="1"][aria-expanded="true"] + div *,
  button[data-testid="tool-group-collapsible"][data-agy-auto-expanded="1"][aria-expanded="true"] + div * {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
    animation: none !important;
  }
  [data-testid="conversation-view"][data-agy-session-switching="1"],
  [data-testid="conversation-view"][data-agy-session-switching="1"] *,
  [data-testid="subagent-tab-conversation"][data-agy-session-switching="1"],
  [data-testid="subagent-tab-conversation"][data-agy-session-switching="1"] *,
  [data-testid="side-question-tab-conversation"][data-agy-session-switching="1"],
  [data-testid="side-question-tab-conversation"][data-agy-session-switching="1"] * {
    transition: none !important;
    animation: none !important;
  }
  html[data-agy-hide-thinking="1"] button[data-testid="thinking-collapsible-trigger"],
  html[data-agy-hide-thinking="1"] button[data-testid="thinking-collapsible-trigger"] + div,
  html[data-agy-hide-thinking="1"] .cursor-edit,
  html[data-agy-hide-thinking="1"] [data-agy-ko-thought-host="1"] {
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
    flex-wrap: wrap;
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
  .agy-ko-pill-btn:hover { opacity: 1; background: rgba(128, 128, 128, 0.16); }
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
    white-space: nowrap;
  }
  .agy-ko-action-btn:hover { background: rgba(128, 128, 128, 0.28); }
  .agy-ko-input {
    width: 100%;
    box-sizing: border-box;
    border-radius: 6px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.45);
    color: inherit;
    font-size: 12px;
    padding: 6px 8px;
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
    padding: 0;
    background: rgba(128, 128, 128, 0.35);
  }
  .agy-ko-switch[aria-checked="true"] { background: #10b981; }
  .agy-ko-switch-thumb {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: #ffffff;
    transform: translateX(4px);
    transition: transform 0.2s ease;
  }
  .agy-ko-switch[aria-checked="true"] .agy-ko-switch-thumb { transform: translateX(24px); }
  .agy-ko-switch.is-compact { height: 18px; width: 34px; }
  .agy-ko-switch.is-compact .agy-ko-switch-thumb { width: 12px; height: 12px; transform: translateX(3px); }
  .agy-ko-switch.is-compact[aria-checked="true"] .agy-ko-switch-thumb { transform: translateX(19px); }
  .agy-ko-model-menu-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 10px;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
  .agy-ko-model-menu-left { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .agy-ko-model-menu-title { font-size: 12px; font-weight: 500; }
  .agy-ko-model-menu-sub { font-size: 10.5px; opacity: 0.65; }
  ga-remote-control { display: block; width: 100%; height: 100%; }
  ga-remote-control .app-container {
    display: flex !important;
    flex-direction: column !important;
    height: 100vh !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  ga-remote-control .iframe-panel { min-height: 0 !important; flex: 1 1 0% !important; overflow: hidden !important; }
  #agy-ko-translator-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.68);
    backdrop-filter: blur(3px);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    color: #e2e8f0;
    box-sizing: border-box;
  }
  .agy-ko-modal-dialog {
    background: #18181d;
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 14px;
    width: 100%;
    max-width: 600px;
    max-height: 88dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .agy-ko-modal-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 13px 16px;
    background: #202027;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    font-size: 14px;
    font-weight: 600;
  }
  .agy-ko-modal-hdr-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .agy-ko-modal-body { padding: 16px; overflow-y: auto; }
  .agy-ko-wrapper { display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; }
  .agy-ko-wrapper.is-full-page { padding: 24px; gap: 20px; max-width: 672px; margin: 0 auto; }
  .agy-ko-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.02);
    overflow: hidden;
  }
  .agy-ko-row { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; width: 100%; box-sizing: border-box; }
  .agy-ko-row + .agy-ko-row { border-top: 1px solid rgba(148, 163, 184, 0.16); }
  .agy-ko-row-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .agy-ko-row-inline { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .agy-ko-info { display: flex; flex-direction: column; gap: 3px; flex: 1 1 0%; min-width: 160px; }
  .agy-ko-title { font-size: 13.5px; font-weight: 600; }
  .agy-ko-desc { font-size: 12px; color: #94a3b8; line-height: 1.45; }
  .agy-ko-ver-badge {
    font-size: 11.5px;
    color: #94a3b8;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    background: rgba(148, 163, 184, 0.12);
    padding: 2px 7px;
    border-radius: 999px;
  }
  .agy-ko-feedback {
    font-size: 12px;
    font-weight: 500;
    padding: 8px 12px;
    border-radius: 8px;
    color: #58d68d;
    background: rgba(88, 214, 141, 0.12);
    border: 1px solid rgba(88, 214, 141, 0.25);
  }
  .settings-modal-container[data-agy-ko-pane-active="1"] button[data-testid^="settings-nav-item-"]:not([data-testid="settings-nav-item-KoTranslator"]) {
    background-color: transparent !important;
  }
  .settings-modal-container[data-agy-ko-pane-active="1"] button[data-testid^="settings-nav-item-"]:not([data-testid="settings-nav-item-KoTranslator"]) span {
    color: var(--text-secondary-foreground, inherit) !important;
  }
`;

function createAntigravitySettingsUi({
  targetWin,
  targetDoc,
  version,
  registry,
  translationService,
  llmConfigPort,
  customProviderStore,
  resolveCspNonce = null,
  getShowThinkingEnabled = () => true,
  onToggleShowThinking = null,
  getTranslateThinkingEnabled = () => true,
  onToggleTranslateThinking = null,
  getPretranslateEnabled = () => false,
  onTogglePretranslate = null,
  onSelectProvider = null,
  onRetranslate = null,
  onRefreshStatusbar = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const win = targetWin || (typeof window !== 'undefined' ? window : null);
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  const boundSettingsNavListeners = [];
  let activeModalEscHandler = null;
  let feedbackMsg = '';
  let feedbackError = false;
  let feedbackTimer = null;

  function getProviderDisplayMeta(id) {
    if (id === 'local-llm') {
      const cfg = llmConfigPort ? llmConfigPort.getLlmConfig() : null;
      return {
        shortLabel: '로컬 LLM',
        compactTag: 'LLM',
        title: `로컬 LLM (${cfg ? cfg.model : 'local-llm'})`,
        desc: `로컬 또는 지정 HTTPS LLM 엔드포인트(${cfg ? cfg.baseUrl : '127.0.0.1:11434'})를 사용하여 문맥을 보존하며 번역합니다.`,
      };
    }
    if (id === 'google-translate') {
      return {
        shortLabel: 'Google 번역',
        compactTag: '구글',
        title: 'Google 번역 (google-translate)',
        desc: 'Google 번역(GTX) 엔드포인트를 사용하여 로컬 자원 소모 없이 빠르게 번역합니다.',
      };
    }
    const prov = registry ? registry.getProvider(id) : null;
    const label = (prov && prov.label) || id;
    return {
      shortLabel: label,
      compactTag: label.slice(0, 6),
      title: `${label} (${id})`,
      desc: (prov && prov.description) || '현재 브라우저 로컬 스토리지에 격리 저장된 사용자 정의 번역 어댑터입니다.',
    };
  }

  function ensureStyle() {
    if (!doc || typeof doc.getElementById !== 'function' || typeof doc.createElement !== 'function') return;
    let st = doc.getElementById(STYLE_ID);
    const nonce = typeof resolveCspNonce === 'function' ? resolveCspNonce(doc) : '';
    if (!st) {
      st = doc.createElement('style');
      st.id = STYLE_ID;
      if (nonce) {
        st.nonce = nonce;
        if (typeof st.setAttribute === 'function') st.setAttribute('nonce', nonce);
      }
      st.textContent = STYLE_CSS;
      const parent = doc.head || doc.documentElement;
      if (parent && typeof parent.appendChild === 'function') {
        parent.appendChild(st);
      }
    } else {
      if (nonce && !st.nonce) {
        st.nonce = nonce;
        if (typeof st.setAttribute === 'function') st.setAttribute('nonce', nonce);
      }
      if (st.textContent !== STYLE_CSS) {
        st.textContent = STYLE_CSS;
      }
    }
  }

  function showFeedback(msg, isErr = false) {
    feedbackMsg = msg;
    feedbackError = Boolean(isErr);
    if (feedbackTimer) clearTimer(feedbackTimer);
    refreshUi();
    feedbackTimer = setTimer(() => {
      feedbackMsg = '';
      feedbackError = false;
      refreshUi();
    }, 3500);
  }

  function renderSettingsContent(container, isFullPage = false, isModal = false) {
    if (!container || !doc) return;
    ensureStyle();
    container.textContent = '';

    const activeId = translationService ? translationService.getEffectiveProviderId() : 'google-translate';
    const desiredId = translationService ? translationService.getDesiredProviderId() : activeId;
    const activeMeta = getProviderDisplayMeta(activeId);

    const wrapper = doc.createElement('div');
    wrapper.className = isFullPage ? 'agy-ko-wrapper is-full-page' : 'agy-ko-wrapper';

    if (isFullPage) {
      const hdr = doc.createElement('div');
      const h2 = doc.createElement('h2');
      h2.className = 'agy-ko-page-title';
      h2.textContent = '한글 번역 설정';
      const sub = doc.createElement('div');
      sub.className = 'agy-ko-desc';
      sub.textContent = `Antigravity 추론 과정(Thinking) 및 UI 한글화 헥사고날 계층 (${version}) 동작 옵션을 설정합니다.`;
      hdr.appendChild(h2);
      hdr.appendChild(sub);
      wrapper.appendChild(hdr);
    } else if (!isModal) {
      const hdr = doc.createElement('div');
      hdr.className = 'agy-ko-row-top';
      const h3 = doc.createElement('span');
      h3.className = 'agy-ko-title';
      h3.textContent = '한글 번역 계층';
      const badge = doc.createElement('span');
      badge.className = 'agy-ko-ver-badge';
      badge.textContent = `${version} · 활성: ${activeMeta.shortLabel}`;
      hdr.appendChild(h3);
      hdr.appendChild(badge);
      wrapper.appendChild(hdr);
    }

    const card = doc.createElement('div');
    card.className = 'agy-ko-card';

    // Row 1: Provider selection
    const rowProv = doc.createElement('div');
    rowProv.className = 'agy-ko-row';
    const rowProvTop = doc.createElement('div');
    rowProvTop.className = 'agy-ko-row-top';
    const provInfo = doc.createElement('div');
    provInfo.className = 'agy-ko-info';
    const provTitle = doc.createElement('span');
    provTitle.className = 'agy-ko-title';
    provTitle.textContent = '번역 엔진 어댑터 (Translation Adapter)';
    const provDesc = doc.createElement('span');
    provDesc.className = 'agy-ko-desc';
    provDesc.textContent = activeMeta.desc;
    provInfo.appendChild(provTitle);
    provInfo.appendChild(provDesc);

    const pillGroup = doc.createElement('div');
    pillGroup.className = 'agy-ko-pill-group';
    const providerIds = registry ? registry.listProviderIds() : ['google-translate', 'local-llm'];
    for (const provId of providerIds) {
      const meta = getProviderDisplayMeta(provId);
      const btn = doc.createElement('button');
      btn.type = 'button';
      const isSelected = provId === desiredId;
      btn.className = 'agy-ko-pill-btn' + (isSelected ? ' active' : '');
      btn.setAttribute('data-agy-provider-option', provId);
      btn.textContent = (isSelected ? '✓ ' : '') + meta.shortLabel;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onSelectProvider === 'function') {
          onSelectProvider(provId);
          showFeedback(`✓ 번역 어댑터가 '${meta.title}'(으)로 적용되었습니다.`);
        }
      };
      pillGroup.appendChild(btn);
    }
    rowProvTop.appendChild(provInfo);
    rowProvTop.appendChild(pillGroup);
    rowProv.appendChild(rowProvTop);
    card.appendChild(rowProv);

    // Row 2: LLM Endpoint Configuration
    if (llmConfigPort) {
      const llmCfg = llmConfigPort.getLlmConfig();
      const rowLlm = doc.createElement('div');
      rowLlm.className = 'agy-ko-row';
      const llmHdr = doc.createElement('span');
      llmHdr.className = 'agy-ko-title';
      llmHdr.textContent = '로컬 / 원격 LLM 엔드포인트 설정 (LlmConfig)';
      rowLlm.appendChild(llmHdr);

      const urlInput = doc.createElement('input');
      urlInput.type = 'url';
      urlInput.className = 'agy-ko-input';
      urlInput.setAttribute('data-testid', 'agy-ko-llm-baseurl-input');
      urlInput.placeholder = 'http://127.0.0.1:11434 또는 https://api.example.com';
      urlInput.value = llmCfg.baseUrl;

      const modelInput = doc.createElement('input');
      modelInput.type = 'text';
      modelInput.className = 'agy-ko-input';
      modelInput.setAttribute('data-testid', 'agy-ko-llm-model-input');
      modelInput.placeholder = 'gemma3:4b';
      modelInput.value = llmCfg.model;

      const formatSelect = doc.createElement('select');
      formatSelect.className = 'agy-ko-input';
      formatSelect.setAttribute('data-testid', 'agy-ko-llm-format-select');
      for (const fmt of ['ollama', 'openai']) {
        const opt = doc.createElement('option');
        opt.value = fmt;
        opt.textContent = fmt === 'ollama' ? 'Ollama (/api/chat)' : 'OpenAI 호환 (/v1/chat/completions)';
        if (llmCfg.apiFormat === fmt) opt.selected = true;
        formatSelect.appendChild(opt);
      }

      const remoteChkLabel = doc.createElement('label');
      remoteChkLabel.className = 'agy-ko-desc';
      const remoteChk = doc.createElement('input');
      remoteChk.type = 'checkbox';
      remoteChk.setAttribute('data-testid', 'agy-ko-llm-remote-https-checkbox');
      remoteChk.checked = Boolean(llmCfg.allowRemoteHttps);
      remoteChkLabel.appendChild(remoteChk);
      remoteChkLabel.appendChild(doc.createTextNode(' 원격 HTTPS 엔드포인트 허용 (사설/메타데이터 IP 자동 차단)'));

      const saveLlmBtn = doc.createElement('button');
      saveLlmBtn.type = 'button';
      saveLlmBtn.className = 'agy-ko-action-btn';
      saveLlmBtn.setAttribute('data-testid', 'agy-ko-llm-save-btn');
      saveLlmBtn.textContent = 'LLM 설정 저장';
      saveLlmBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          llmConfigPort.setLlmConfig({
            baseUrl: urlInput.value.trim(),
            model: modelInput.value.trim(),
            apiFormat: formatSelect.value === 'openai' ? 'openai' : 'ollama',
            allowRemoteHttps: Boolean(remoteChk.checked),
          });
          showFeedback('✓ LLM 설정이 검증되어 저장되었습니다.');
        } catch (err) {
          showFeedback(`⚠ LLM 설정 오류: ${err.message}`, true);
        }
      };

      rowLlm.appendChild(urlInput);
      rowLlm.appendChild(modelInput);
      rowLlm.appendChild(formatSelect);
      rowLlm.appendChild(remoteChkLabel);
      rowLlm.appendChild(saveLlmBtn);
      card.appendChild(rowLlm);
    }

    // Row 3: Custom Provider Registration (Credentials strictly origin-local in localStorage!)
    if (customProviderStore) {
      const rowCustom = doc.createElement('div');
      rowCustom.className = 'agy-ko-row';
      const customTitle = doc.createElement('span');
      customTitle.className = 'agy-ko-title';
      customTitle.textContent = '사용자 정의 번역 어댑터 (헤더는 현재 오리진 로컬 스토리지에만 격리 저장)';
      rowCustom.appendChild(customTitle);

      const existingSpecs = customProviderStore.listSpecs();
      for (const spec of existingSpecs) {
        const specBar = doc.createElement('div');
        specBar.className = 'agy-ko-row-top';
        const specLbl = doc.createElement('span');
        specLbl.className = 'agy-ko-desc';
        specLbl.textContent = `${spec.label} (${spec.id}) → ${spec.endpointUrl}`;
        const delBtn = doc.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'agy-ko-action-btn';
        delBtn.setAttribute('data-testid', `agy-ko-custom-delete-${spec.id}`);
        delBtn.textContent = '삭제';
        delBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (desiredId === spec.id && typeof onSelectProvider === 'function') {
            onSelectProvider('google-translate');
          }
          customProviderStore.removeSpec(spec.id);
          showFeedback(`✓ 사용자 정의 어댑터 '${spec.id}'가 삭제되었습니다.`);
        };
        specBar.appendChild(specLbl);
        specBar.appendChild(delBtn);
        rowCustom.appendChild(specBar);
      }

      const idIn = doc.createElement('input');
      idIn.type = 'text';
      idIn.className = 'agy-ko-input';
      idIn.setAttribute('data-testid', 'agy-ko-custom-id-input');
      idIn.placeholder = '어댑터 ID (소문자, 예: deepl-pro)';

      const lblIn = doc.createElement('input');
      lblIn.type = 'text';
      lblIn.className = 'agy-ko-input';
      lblIn.setAttribute('data-testid', 'agy-ko-custom-label-input');
      lblIn.placeholder = '표시 이름 (예: DeepL Pro)';

      const epIn = doc.createElement('input');
      epIn.type = 'url';
      epIn.className = 'agy-ko-input';
      epIn.setAttribute('data-testid', 'agy-ko-custom-endpoint-input');
      epIn.placeholder = 'https://api.example.com/translate';

      const hdrNameIn = doc.createElement('input');
      hdrNameIn.type = 'text';
      hdrNameIn.className = 'agy-ko-input';
      hdrNameIn.setAttribute('data-testid', 'agy-ko-custom-header-name-input');
      hdrNameIn.placeholder = '인증 헤더 이름 (선택, 예: Authorization)';

      // Masked password input for secret header value (never persisted to nativeStorage / host files!)
      const hdrValIn = doc.createElement('input');
      hdrValIn.type = 'password';
      hdrValIn.autocomplete = 'off';
      hdrValIn.className = 'agy-ko-input';
      hdrValIn.setAttribute('data-testid', 'agy-ko-custom-header-value-input');
      hdrValIn.placeholder = '인증 헤더 값 (마스킹 입력 · 오리진 로컬에만 저장)';

      const bodyIn = doc.createElement('input');
      bodyIn.type = 'text';
      bodyIn.className = 'agy-ko-input';
      bodyIn.setAttribute('data-testid', 'agy-ko-custom-body-input');
      bodyIn.value = '{"q":"{{text}}","source":"{{sourceLang}}","target":"{{targetLang}}"}';

      const pathIn = doc.createElement('input');
      pathIn.type = 'text';
      pathIn.className = 'agy-ko-input';
      pathIn.setAttribute('data-testid', 'agy-ko-custom-path-input');
      pathIn.placeholder = '응답 JSON 경로 (예: translatedText 또는 data.text)';
      pathIn.value = 'translatedText';

      const addCustomBtn = doc.createElement('button');
      addCustomBtn.type = 'button';
      addCustomBtn.className = 'agy-ko-action-btn';
      addCustomBtn.setAttribute('data-testid', 'agy-ko-custom-save-btn');
      addCustomBtn.textContent = '사용자 정의 어댑터 등록';
      addCustomBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const headers = {};
          if (hdrNameIn.value.trim()) {
            headers[hdrNameIn.value.trim()] = hdrValIn.value;
          }
          const parsedBody = JSON.parse(bodyIn.value);
          const epStr = epIn.value.trim();
          const saved = customProviderStore.upsertSpec({
            id: idIn.value.trim(),
            label: lblIn.value.trim() || idIn.value.trim(),
            endpointUrl: epStr,
            method: 'POST',
            headers,
            bodyTemplate: parsedBody,
            responsePath: pathIn.value.trim(),
            allowRemoteHttps: epStr.toLowerCase().startsWith('https://'),
          });
          hdrValIn.value = '';
          showFeedback(`✓ 사용자 정의 어댑터 '${saved.id}'가 등록되었습니다.`);
        } catch (err) {
          showFeedback(`⚠ 어댑터 등록 실패: ${err.message}`, true);
        }
      };

      rowCustom.appendChild(idIn);
      rowCustom.appendChild(lblIn);
      rowCustom.appendChild(epIn);
      rowCustom.appendChild(hdrNameIn);
      rowCustom.appendChild(hdrValIn);
      rowCustom.appendChild(bodyIn);
      rowCustom.appendChild(pathIn);
      rowCustom.appendChild(addCustomBtn);
      card.appendChild(rowCustom);
    }

    // Row 4: Translate Thinking toggle
    const transOn = Boolean(getTranslateThinkingEnabled());
    const rowTrans = doc.createElement('div');
    rowTrans.className = 'agy-ko-row agy-ko-row-inline';
    const transInfo = doc.createElement('div');
    transInfo.className = 'agy-ko-info';
    const transT = doc.createElement('span');
    transT.className = 'agy-ko-title';
    transT.textContent = 'Thinking (추론 과정) 한국어 번역';
    const transD = doc.createElement('span');
    transD.className = 'agy-ko-desc';
    transD.textContent = '대화 중 에이전트의 추론 과정 본문을 한국어로 번역합니다.';
    transInfo.appendChild(transT);
    transInfo.appendChild(transD);
    const transBtn = doc.createElement('button');
    transBtn.type = 'button';
    transBtn.setAttribute('role', 'switch');
    transBtn.setAttribute('data-testid', 'agy-ko-translate-thinking-switch');
    transBtn.setAttribute('aria-checked', transOn ? 'true' : 'false');
    transBtn.className = 'agy-ko-switch';
    const transThumb = doc.createElement('span');
    transThumb.className = 'agy-ko-switch-thumb';
    transBtn.appendChild(transThumb);
    transBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = !getTranslateThinkingEnabled();
      if (typeof onToggleTranslateThinking === 'function') onToggleTranslateThinking(next);
      showFeedback(`✓ Thinking 한국어 번역이 '${next ? '켜짐' : '꺼짐'}'(으)로 변경되었습니다.`);
    };
    rowTrans.appendChild(transInfo);
    rowTrans.appendChild(transBtn);
    card.appendChild(rowTrans);

    // Row 5: Pretranslate toggle
    const preOn = Boolean(getPretranslateEnabled());
    const rowPre = doc.createElement('div');
    rowPre.className = 'agy-ko-row agy-ko-row-inline';
    const preInfo = doc.createElement('div');
    preInfo.className = 'agy-ko-info';
    const preT = doc.createElement('span');
    preT.className = 'agy-ko-title';
    preT.textContent = 'Thinking 백그라운드 사전 번역 (Pre-translation)';
    const preD = doc.createElement('span');
    preD.className = 'agy-ko-desc';
    preD.textContent = '접혀 있는 Thinking 블록을 펼치기 전에 백그라운드에서 미리 번역합니다.';
    preInfo.appendChild(preT);
    preInfo.appendChild(preD);
    const preBtn = doc.createElement('button');
    preBtn.type = 'button';
    preBtn.setAttribute('role', 'switch');
    preBtn.setAttribute('data-testid', 'agy-ko-pretranslate-switch');
    preBtn.setAttribute('aria-checked', preOn ? 'true' : 'false');
    preBtn.className = 'agy-ko-switch';
    const preThumb = doc.createElement('span');
    preThumb.className = 'agy-ko-switch-thumb';
    preBtn.appendChild(preThumb);
    preBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = !getPretranslateEnabled();
      if (typeof onTogglePretranslate === 'function') onTogglePretranslate(next);
      showFeedback(`✓ Thinking 사전 번역이 '${next ? '켜짐' : '꺼짐'}'(으)로 설정되었습니다.`);
    };
    rowPre.appendChild(preInfo);
    rowPre.appendChild(preBtn);
    card.appendChild(rowPre);

    // Row 6: Cache & Retranslate
    const rowCache = doc.createElement('div');
    rowCache.className = 'agy-ko-row agy-ko-row-top';
    const cacheInfo = doc.createElement('div');
    cacheInfo.className = 'agy-ko-info';
    const cacheT = doc.createElement('span');
    cacheT.className = 'agy-ko-title';
    cacheT.textContent = '번역 캐시 및 현재 화면 즉시 재번역';
    const cacheD = doc.createElement('span');
    cacheD.className = 'agy-ko-desc';
    const sz = translationService ? translationService.getCacheSize() : 0;
    cacheD.textContent = `저장된 번역 캐시: ${sz.toLocaleString('en-US')}개 문단`;
    cacheInfo.appendChild(cacheT);
    cacheInfo.appendChild(cacheD);

    const actions = doc.createElement('div');
    actions.className = 'agy-ko-row-top';
    const reBtn = doc.createElement('button');
    reBtn.type = 'button';
    reBtn.className = 'agy-ko-action-btn';
    reBtn.setAttribute('data-testid', 'agy-ko-retranslate-btn');
    reBtn.textContent = '현재 화면 다시 번역';
    reBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onRetranslate === 'function') onRetranslate(false);
      showFeedback('✓ 현재 화면의 Thinking 블록을 다시 번역합니다.');
    };
    const clrBtn = doc.createElement('button');
    clrBtn.type = 'button';
    clrBtn.className = 'agy-ko-action-btn';
    clrBtn.setAttribute('data-testid', 'agy-ko-clear-cache-btn');
    clrBtn.textContent = '캐시 비우기';
    clrBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onRetranslate === 'function') onRetranslate(true);
      showFeedback('✓ 번역 캐시를 모두 비우고 새로 번역합니다.');
    };
    actions.appendChild(reBtn);
    actions.appendChild(clrBtn);
    rowCache.appendChild(cacheInfo);
    rowCache.appendChild(actions);
    card.appendChild(rowCache);

    wrapper.appendChild(card);

    if (feedbackMsg) {
      const fb = doc.createElement('div');
      fb.className = 'agy-ko-feedback';
      if (feedbackError) {
        fb.style.color = '#fca5a5';
        fb.style.borderColor = 'rgba(248,113,113,0.4)';
      }
      fb.textContent = feedbackMsg;
      wrapper.appendChild(fb);
    }

    container.appendChild(wrapper);
  }

  function buildThinkingToggleRowElement(isCompactMenu = false) {
    if (!doc) return null;
    const thinkingVisible = Boolean(getShowThinkingEnabled());
    const toggleHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = !getShowThinkingEnabled();
      if (typeof onToggleShowThinking === 'function') {
        onToggleShowThinking(next);
      }
      syncThinkingDisplayMenuControls();
    };

    if (isCompactMenu) {
      const row = doc.createElement('div');
      row.id = 'agy-ko-model-menu-thinking-row';
      row.className = 'agy-ko-model-menu-row agy-ko-settings-root';
      row.setAttribute('data-testid', 'agy-ko-model-menu-show-thinking');
      const left = doc.createElement('div');
      left.className = 'agy-ko-model-menu-left';
      const title = doc.createElement('span');
      title.className = 'agy-ko-model-menu-title';
      title.textContent = 'Thinking (추론 과정) 표시';
      const sub = doc.createElement('span');
      sub.className = 'agy-ko-model-menu-sub';
      sub.textContent = '작업 내역은 유지하고 추론 블록만 표시/숨김';
      left.appendChild(title);
      left.appendChild(sub);

      const switchBtn = doc.createElement('button');
      switchBtn.type = 'button';
      switchBtn.setAttribute('role', 'switch');
      switchBtn.setAttribute('data-testid', 'agy-ko-show-thinking-switch');
      switchBtn.setAttribute('aria-checked', thinkingVisible ? 'true' : 'false');
      switchBtn.className = 'agy-ko-switch is-compact';
      const thumb = doc.createElement('span');
      thumb.className = 'agy-ko-switch-thumb';
      switchBtn.appendChild(thumb);
      row.appendChild(left);
      row.appendChild(switchBtn);
      row.onclick = toggleHandler;
      return row;
    }

    const row = doc.createElement('div');
    row.id = 'agy-ko-appearance-thinking-row';
    row.setAttribute('data-testid', 'agy-ko-appearance-show-thinking');
    row.className = 'agy-ko-row agy-ko-row-inline agy-ko-settings-root';
    const info = doc.createElement('div');
    info.className = 'agy-ko-info';
    const title = doc.createElement('span');
    title.className = 'agy-ko-title';
    title.textContent = 'Thinking (추론 과정) 표시';
    const desc = doc.createElement('span');
    desc.className = 'agy-ko-desc';
    desc.textContent = '대화 중 에이전트의 추론 과정(Thinking 블록)을 자동으로 펼쳐 표시합니다.';
    info.appendChild(title);
    info.appendChild(desc);

    const switchBtn = doc.createElement('button');
    switchBtn.type = 'button';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('data-testid', 'agy-ko-show-thinking-switch');
    switchBtn.setAttribute('aria-checked', thinkingVisible ? 'true' : 'false');
    switchBtn.className = 'agy-ko-switch';
    const thumb = doc.createElement('span');
    thumb.className = 'agy-ko-switch-thumb';
    switchBtn.appendChild(thumb);
    switchBtn.onclick = toggleHandler;
    row.appendChild(info);
    row.appendChild(switchBtn);
    return row;
  }

  function syncThinkingDisplayMenuControls() {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    const thinkingVisible = Boolean(getShowThinkingEnabled());
    doc.querySelectorAll('[data-testid="agy-ko-show-thinking-switch"]').forEach((btn) => {
      btn.setAttribute('aria-checked', thinkingVisible ? 'true' : 'false');
    });
  }

  function ensureAppearanceChatThinkingIntegration(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return;
    const candidateRows = modal.querySelectorAll('.divide-y > div, .border.border-border > div');
    for (const r of candidateRows) {
      if (r.id === 'agy-ko-appearance-thinking-row') continue;
      const txt = String(r.textContent || '').trim();
      if (
        txt.includes('대화 단계 표시') ||
        txt.includes('Conversation Steps') ||
        txt.includes('default visibility of detailed steps')
      ) {
        const card = r.parentElement;
        if (card && !card.querySelector('#agy-ko-appearance-thinking-row')) {
          const row = buildThinkingToggleRowElement(false);
          if (row) card.appendChild(row);
        }
        // D-0012: Never intercept or mutate native Conversation Steps controls!
        break;
      }
    }
  }

  function ensureNativeSettingsModalIntegration() {
    if (!doc || typeof doc.querySelector !== 'function') return;
    const modal = doc.querySelector('.settings-modal-container');
    if (!modal) return;

    const legacyCard = modal.querySelector('#agy-ko-settings-card');
    if (legacyCard) legacyCard.remove();

    const activateKoPane = () => {
      const rightGrow = modal.querySelector('.grow.w-full');
      if (!rightGrow) return;
      Array.from(rightGrow.children).forEach((ch) => {
        if (ch.id !== 'agy-ko-settings-pane') {
          if (ch.getAttribute('data-agy-prev-display') === null) {
            ch.setAttribute('data-agy-prev-display', (ch.style && ch.style.display) || '');
          }
          if (ch.style) ch.style.display = 'none';
        }
      });
      let pane = rightGrow.querySelector('#agy-ko-settings-pane');
      if (!pane) {
        pane = doc.createElement('div');
        pane.id = 'agy-ko-settings-pane';
        pane.className = 'w-full bg-transparent h-full overflow-y-auto agy-ko-settings-root';
        rightGrow.appendChild(pane);
      }
      if (pane.style) pane.style.display = 'block';
      modal.setAttribute('data-agy-ko-pane-active', '1');
      renderSettingsContent(pane, true, false);
    };

    const deactivateKoPane = () => {
      modal.removeAttribute('data-agy-ko-pane-active');
      const rightGrow = modal.querySelector('.grow.w-full');
      if (rightGrow) {
        const pane = rightGrow.querySelector('#agy-ko-settings-pane');
        if (pane && pane.style && pane.style.display !== 'none') {
          pane.style.display = 'none';
          Array.from(rightGrow.children).forEach((ch) => {
            if (ch.id !== 'agy-ko-settings-pane' && ch.getAttribute('data-agy-prev-display') !== null) {
              if (ch.style) ch.style.display = ch.getAttribute('data-agy-prev-display');
              ch.removeAttribute('data-agy-prev-display');
            }
          });
        }
      }
    };

    // D-0031: keepMounted Settings modal sets aria-hidden="true" when closed; auto-deactivate #agy-ko-settings-pane!
    const backdropEl =
      typeof modal.closest === 'function' ? modal.closest('.settings-modal-backdrop, [aria-hidden]') : modal.parentElement;
    if (
      (backdropEl && typeof backdropEl.getAttribute === 'function' && backdropEl.getAttribute('aria-hidden') === 'true') ||
      (typeof modal.getAttribute === 'function' && modal.getAttribute('aria-hidden') === 'true')
    ) {
      if (modal.getAttribute('data-agy-ko-pane-active') === '1') {
        deactivateKoPane();
      }
      return;
    }

    const modelsNavBtn =
      modal.querySelector('button[data-testid="settings-nav-item-Models"]') ||
      modal.querySelector('button[data-testid^="settings-nav-item-"]');
    const navGroup = modelsNavBtn
      ? (typeof modelsNavBtn.closest === 'function' && modelsNavBtn.closest('.flex.flex-col.gap-0\\.5')) ||
        (modelsNavBtn.parentElement && modelsNavBtn.parentElement.parentElement) ||
        modelsNavBtn.parentElement
      : null;

    if (navGroup && !modal.querySelector('button[data-testid="settings-nav-item-KoTranslator"]')) {
      const navWrap = doc.createElement('div');
      navWrap.className = 'relative group/nav-item mx-2 agy-ko-settings-root';
      const navBtn = doc.createElement('button');
      navBtn.type = 'button';
      navBtn.setAttribute('data-testid', 'settings-nav-item-KoTranslator');
      navBtn.className =
        'flex items-center gap-1.5 w-full px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted';
      const navSpan = doc.createElement('span');
      navSpan.className = 'text-sm select-none truncate flex-1 text-secondary-foreground';
      navSpan.textContent = '한글 번역';
      navBtn.appendChild(navSpan);
      navWrap.appendChild(navBtn);
      navGroup.appendChild(navWrap);
      navBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateKoPane();
      };
    }

    modal
      .querySelectorAll('button[data-testid^="settings-nav-item-"]:not([data-testid="settings-nav-item-KoTranslator"])')
      .forEach((otherBtn) => {
        if (!otherBtn.__agyKoNavBound) {
          const listener = () => deactivateKoPane();
          otherBtn.__agyKoNavBound = listener;
          otherBtn.addEventListener('click', listener, true);
          boundSettingsNavListeners.push({ btn: otherBtn, listener });
        }
      });

    ensureAppearanceChatThinkingIntegration(modal);
  }

  function ensureThinkingDisplayMenuIntegration() {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    ensureStyle();
    doc.querySelectorAll('[data-testid="model-selector-panel"]').forEach((panel) => {
      if (!panel.querySelector('#agy-ko-model-menu-thinking-row')) {
        const row = buildThinkingToggleRowElement(true);
        if (!row) return;
        const footerEl = Array.from(panel.children || []).find(
          (ch) => ch !== row && ch.classList && ch.classList.contains('border-t')
        );
        if (footerEl && typeof panel.insertBefore === 'function') {
          panel.insertBefore(row, footerEl);
        } else {
          panel.appendChild(row);
        }
      }
    });
    const modal = doc.querySelector('.settings-modal-container');
    if (modal) ensureAppearanceChatThinkingIntegration(modal);
    syncThinkingDisplayMenuControls();
  }

  function closeModal() {
    if (activeModalEscHandler && win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('keydown', activeModalEscHandler);
      activeModalEscHandler = null;
    }
    if (doc && typeof doc.getElementById === 'function') {
      const existing = doc.getElementById('agy-ko-translator-modal');
      if (existing) existing.remove();
    }
  }

  function openOrToggleModal() {
    if (!doc || !doc.body) return { open: false };
    const existing = doc.getElementById('agy-ko-translator-modal');
    if (existing) {
      closeModal();
      return { open: false };
    }
    ensureStyle();
    const activeId = translationService ? translationService.getEffectiveProviderId() : 'google-translate';
    const backdrop = doc.createElement('div');
    backdrop.id = 'agy-ko-translator-modal';
    backdrop.className = 'agy-ko-settings-root';

    const dialog = doc.createElement('div');
    dialog.className = 'agy-ko-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', '한글 번역 계층 설정');

    const hdr = doc.createElement('div');
    hdr.className = 'agy-ko-modal-hdr';
    const hdrLeft = doc.createElement('div');
    hdrLeft.className = 'agy-ko-modal-hdr-left';
    const hdrTitle = doc.createElement('span');
    hdrTitle.textContent = '한글 번역 계층 설정';
    const hdrBadge = doc.createElement('span');
    hdrBadge.id = 'agy-ko-translator-modal-badge';
    hdrBadge.className = 'agy-ko-ver-badge';
    hdrBadge.textContent = `${version} · ${getProviderDisplayMeta(activeId).shortLabel}`;
    hdrLeft.appendChild(hdrTitle);
    hdrLeft.appendChild(hdrBadge);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'agy-ko-action-btn';
    closeBtn.textContent = '닫기';
    closeBtn.onclick = closeModal;

    activeModalEscHandler = (e) => {
      if (e && e.key === 'Escape') closeModal();
    };
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('keydown', activeModalEscHandler);
    }
    backdrop.onclick = (e) => {
      if (e && e.target === backdrop) closeModal();
    };

    hdr.appendChild(hdrLeft);
    hdr.appendChild(closeBtn);

    const body = doc.createElement('div');
    body.className = 'agy-ko-modal-body';
    body.id = 'agy-ko-translator-modal-body';
    renderSettingsContent(body, false, true);

    dialog.appendChild(hdr);
    dialog.appendChild(body);
    backdrop.appendChild(dialog);
    doc.body.appendChild(backdrop);
    return { open: true };
  }

  function refreshUi() {
    if (!doc || typeof doc.getElementById !== 'function') return;
    const legacyCard = doc.getElementById('agy-ko-settings-card');
    if (legacyCard) legacyCard.remove();
    const paneEl = doc.getElementById('agy-ko-settings-pane');
    if (paneEl && (!paneEl.style || paneEl.style.display !== 'none')) {
      renderSettingsContent(paneEl, true, false);
    }
    const activeId = translationService ? translationService.getEffectiveProviderId() : 'google-translate';
    const modalBadge = doc.getElementById('agy-ko-translator-modal-badge');
    if (modalBadge) {
      modalBadge.textContent = `${version} · ${getProviderDisplayMeta(activeId).shortLabel}`;
    }
    const modalBody = doc.getElementById('agy-ko-translator-modal-body');
    if (modalBody) renderSettingsContent(modalBody, false, true);
    syncThinkingDisplayMenuControls();
    if (typeof onRefreshStatusbar === 'function') {
      onRefreshStatusbar();
    }
  }

  function dispose(fullRestore = false) {
    if (feedbackTimer) {
      clearTimer(feedbackTimer);
      feedbackTimer = null;
    }
    while (boundSettingsNavListeners.length > 0) {
      const entry = boundSettingsNavListeners.pop();
      if (!entry || !entry.btn) continue;
      try {
        entry.btn.removeEventListener('click', entry.listener, true);
        delete entry.btn.__agyKoNavBound;
      } catch (_err) {}
    }
    closeModal();
    if (doc) {
      const modal = doc.querySelector && doc.querySelector('.settings-modal-container');
      if (modal) modal.removeAttribute('data-agy-ko-pane-active');
      if (fullRestore && typeof doc.querySelectorAll === 'function') {
        doc
          .querySelectorAll(
            '#agy-ko-thought-style, #agy-ko-settings-pane, #agy-ko-appearance-thinking-row, #agy-ko-model-menu-thinking-row, [data-testid="settings-nav-item-KoTranslator"]'
          )
          .forEach((el) => {
            if (el.getAttribute && el.getAttribute('data-testid') === 'settings-nav-item-KoTranslator' && el.parentElement) {
              el.parentElement.remove();
            } else {
              el.remove();
            }
          });
      }
    }
  }

  return {
    STYLE_ID,
    ensureStyle,
    getProviderDisplayMeta,
    ensureNativeSettingsModalIntegration,
    ensureThinkingDisplayMenuIntegration,
    openOrToggleModal,
    closeModal,
    refreshUi,
    dispose,
  };
}

module.exports = {
  STYLE_ID,
  STYLE_CSS,
  createAntigravitySettingsUi,
};
