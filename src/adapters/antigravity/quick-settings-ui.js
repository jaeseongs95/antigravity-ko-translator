'use strict';

/**
 * Antigravity Statusbar Item & Quick Settings Modal / Settings Page (v3.0.0).
 *
 * - Primary path (`AddonContextV3`):
 *   - Tier-1 `ctx.ui.registerStatusItem` (delegates to `host.statusbar` when installed,
 *     with automatic host fallback bar on Remote Web / standalone Desktop; avoids duplicate
 *     floating bars when legacy v2 `window.statusbarAddons` is mounted without `host.statusbar`).
 *   - Tier-1 `ctx.ui.registerSettingsPage` (Desktop Settings + Remote Web Drawer unified).
 *   - Tier-1 `ctx.ui.registerCommand` (`open-quick-settings`, `toggle-engine`).
 *   - Tier-2/3 `ctx.ui.openModal` (host Top-Layer `<dialog>`, `PlacementEngine`, attribution badge,
 *     Escape LIFO, focus restoration, mobile bottom-sheet responsive).
 * - Backward compatibility: preserves v2 `addonHost` (`openModal`, `registerSettingsTab`,
 *   `registerAction`, `window.statusbarAddons`) and standalone fallback portal.
 * - Redesigned UX (v3.0.0):
 *   - Merges duplicate "한국어 번역 사용" + "영문 고정 UI 한글화" into 1 clear slide ON/OFF switch
 *     (`영문 UI 한글화`), with `enabled` derived cleanly from active localization / thinking-hide state.
 *   - Converts all toggles (`영문 UI 한글화`, `Thinking(추론 과정) 한국어 번역`, `Thinking 블록 표시`,
 *     and Local LLM `원격 HTTPS 엔드포인트 허용`) to accessible `role="switch"` slide ON/OFF controls.
 * - Zero `innerHTML` usage; all nodes are constructed with `createElement` + `textContent`.
 */

const { validateTranslationEndpointUrl } = require('../translators/endpoint-validator');
const {
  DEFAULT_LLM_CONFIG,
  DEFAULT_CLOUD_API_CONFIG,
  CLOUD_API_PRESETS,
  getCloudPreset,
  getCloudSecretKeyForPreset,
} = require('../translators/default-providers');
const {
  validateCloudApiConfig,
  fetchCloudApiModels,
  probeCloudApiConnection,
} = require('../translators/cloud-api');
const { extractV3Context } = require('./host-capability-adapter');

const STATUSBAR_ADDON_ID = 'ko-translator';
const QUICK_SETTINGS_MODAL_SLOT_ID = 'ko-translator.quick-settings-modal';
const QUICK_SETTINGS_TAB_ID = 'ko-translator.quick-settings';
const HOST_ACTION_IDS = Object.freeze({
  openQuickSettings: 'open-quick-settings',
  toggleEngine: 'toggle-engine',
});
const SECRET_QUERY_RE = /[?&](?:key|api_key|apikey|token|access_token|secret|auth)=/i;

const MODAL_CSS = `
:host {
  all: initial;
  font-family: var(--ag-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif);
  color-scheme: dark;
}
.ko-qs-card {
  box-sizing: border-box;
  width: min(492px, calc(100vw - 32px));
  max-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  background: var(--ag-surface, #1a1e26);
  color: var(--ag-text, #e6ebf4);
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.14));
  border-radius: var(--ag-radius, 14px);
  box-shadow: var(--ag-shadow, 0 22px 60px rgba(0, 0, 0, 0.58));
  overflow: hidden;
  font-size: 13px;
  line-height: 1.45;
  font-family: var(--ag-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif);
}
.ko-qs-card[data-embedded="true"] {
  width: 100%;
  max-height: none;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}
.ko-qs-card *, .ko-qs-card *::before, .ko-qs-card *::after {
  box-sizing: border-box;
}
.ko-qs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ag-border, rgba(255, 255, 255, 0.08));
  background: rgba(255, 255, 255, 0.02);
}
.ko-qs-inline-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 0 2px 0;
}
.ko-qs-inline-meta {
  font-size: 11.5px;
  color: var(--ag-text-muted, #97a3b8);
}
.ko-qs-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ko-qs-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ag-text, #f3f6fc);
}
.ko-qs-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(79, 140, 255, 0.18);
  color: #9ec0ff;
  border: 1px solid rgba(79, 140, 255, 0.35);
  white-space: nowrap;
}
.ko-qs-badge[data-state="off"] {
  background: rgba(148, 163, 184, 0.14);
  color: var(--ag-text-muted, #9ba5b8);
  border-color: rgba(148, 163, 184, 0.24);
}
.ko-qs-badge[data-state="error"] {
  background: rgba(242, 95, 92, 0.18);
  color: #ff9c9a;
  border-color: rgba(242, 95, 92, 0.4);
}
.ko-qs-close {
  appearance: none;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.12));
  background: rgba(255, 255, 255, 0.04);
  color: var(--ag-text-muted, #cbd4e3);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ko-qs-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--ag-text, #ffffff);
}
.ko-qs-body {
  padding: 14px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.32) transparent;
}
.ko-qs-body::-webkit-scrollbar {
  width: 6px;
}
.ko-qs-body::-webkit-scrollbar-track {
  background: transparent;
}
.ko-qs-body::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.32);
  border-radius: 999px;
}
.ko-qs-body::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.5);
}
.ko-qs-card[data-embedded="true"] .ko-qs-body {
  padding: 2px 0 12px 0;
}
.ko-qs-banner {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(242, 95, 92, 0.14);
  border: 1px solid rgba(242, 95, 92, 0.36);
  color: #ffb8b6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ko-qs-banner[hidden] {
  display: none;
}
.ko-qs-section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ag-text-muted, #97a3b8);
  margin: 0 0 6px 0;
}
.ko-qs-engine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 460px) {
  .ko-qs-engine-grid {
    grid-template-columns: 1fr;
  }
}
.ko-qs-engine-btn {
  appearance: none;
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.12));
  background: rgba(255, 255, 255, 0.03);
  color: var(--ag-text, #dce3f0);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.ko-qs-engine-btn:hover {
  border-color: rgba(120, 168, 255, 0.5);
  background: rgba(79, 140, 255, 0.08);
}
.ko-qs-engine-btn[aria-checked="true"] {
  border-color: var(--ag-accent, #4f8cff);
  background: rgba(79, 140, 255, 0.16);
  box-shadow: 0 0 0 1px rgba(79, 140, 255, 0.35) inset;
}
.ko-qs-engine-name {
  font-weight: 700;
  font-size: 13px;
  color: var(--ag-text, #f4f7fc);
}
.ko-qs-engine-desc {
  font-size: 11px;
  color: var(--ag-text-muted, #9ba7bc);
}
.ko-qs-hint {
  margin: 6px 0 0 0;
  font-size: 11px;
  color: var(--ag-text-muted, #8b97ad);
}
.ko-qs-llm-box {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.1));
  background: rgba(255, 255, 255, 0.025);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ko-qs-llm-box[hidden],
.ko-qs-cloud-box[hidden] {
  display: none;
}
.ko-qs-cloud-box {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.1));
  background: rgba(255, 255, 255, 0.025);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ko-qs-secret-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ko-qs-secret-row .ko-qs-input {
  flex: 1 1 auto;
  min-width: 0;
}
.ko-qs-model-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ko-qs-model-row .ko-qs-select {
  flex: 1 1 auto;
  min-width: 0;
}
.ko-qs-model-custom {
  margin-top: 6px;
}
.ko-qs-model-custom[hidden] {
  display: none;
}
.ko-qs-secret-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.ko-qs-secret-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(148, 163, 184, 0.12);
  color: var(--ag-text-muted, #9ba7bc);
}
.ko-qs-secret-pill[data-state="saved"] {
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.34);
  color: #7ee2a8;
}
.ko-qs-secret-pill[data-state="warn"] {
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.34);
  color: #fbbf24;
}
.ko-qs-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.ko-qs-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ko-qs-field label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ag-text-muted, #aab5c9);
}
.ko-qs-input, .ko-qs-select {
  width: 100%;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.14));
  background: var(--ag-surface-alt, #12151b);
  color: var(--ag-text, #eef2fa);
  font-size: 12px;
  font-family: inherit;
}
.ko-qs-input:focus-visible,
.ko-qs-select:focus-visible,
.ko-qs-btn:focus-visible,
.ko-qs-engine-btn:focus-visible,
.ko-qs-close:focus-visible {
  outline: 2px solid var(--ag-accent, #6ba0ff);
  outline-offset: 1px;
}
.ko-qs-row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ko-qs-toggles {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.09));
  background: rgba(255, 255, 255, 0.025);
  overflow: hidden;
}
.ko-qs-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 13px;
  cursor: pointer;
  user-select: none;
  transition: background-color 120ms ease;
}
.ko-qs-toggles .ko-qs-toggle-row + .ko-qs-toggle-row {
  border-top: 1px solid var(--ag-border, rgba(255, 255, 255, 0.07));
}
.ko-qs-toggle-row:hover {
  background: rgba(255, 255, 255, 0.035);
}
.ko-qs-llm-box .ko-qs-toggle-row {
  padding: 6px 2px;
  border-radius: 8px;
}
.ko-qs-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.ko-qs-toggle-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ag-text, #e7ecf5);
}
.ko-qs-toggle-sub {
  font-size: 11px;
  line-height: 1.4;
  color: var(--ag-text-muted, #8c98ae);
  word-break: keep-all;
}
.ko-qs-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  width: 42px;
  height: 24px;
}
.ko-qs-switch-input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  pointer-events: none;
}
.ko-qs-switch-track {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 24px;
  padding: 2px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.24);
  border: 1px solid rgba(148, 163, 184, 0.34);
  transition: background-color 160ms ease, border-color 160ms ease;
}
.ko-qs-switch-thumb {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #d5dce8;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.38);
  transform: translateX(0);
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1), background-color 160ms ease;
}
.ko-qs-switch-input:checked + .ko-qs-switch-track {
  background: var(--ag-accent, #3d7eff);
  border-color: var(--ag-accent, #4f8cff);
}
.ko-qs-switch-input:checked + .ko-qs-switch-track .ko-qs-switch-thumb {
  background: #ffffff;
  transform: translateX(18px);
}
.ko-qs-switch-input:focus-visible + .ko-qs-switch-track {
  outline: 2px solid var(--ag-accent, #6ba0ff);
  outline-offset: 2px;
}
.ko-qs-switch-input:disabled + .ko-qs-switch-track {
  opacity: 0.45;
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .ko-qs-engine-btn,
  .ko-qs-toggle-row,
  .ko-qs-switch-track,
  .ko-qs-switch-thumb {
    transition: none;
  }
}
.ko-qs-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.08));
  background: rgba(255, 255, 255, 0.02);
}
.ko-qs-cache-label {
  font-size: 12px;
  color: var(--ag-text-muted, #aeb9cc);
}
.ko-qs-btn-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ko-qs-btn {
  appearance: none;
  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.14));
  background: rgba(255, 255, 255, 0.06);
  color: var(--ag-text, #e6ebf4);
  padding: 6px 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
}
.ko-qs-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
.ko-qs-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ko-qs-btn-primary {
  background: var(--ag-accent, #3d7eff);
  border-color: var(--ag-accent, #4f8cff);
  color: #ffffff;
}
.ko-qs-btn-primary:hover:not(:disabled) {
  background: #5390ff;
}
.ko-qs-btn-danger {
  border-color: rgba(242, 95, 92, 0.45);
  color: #ffadaa;
}
.ko-qs-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--ag-border, rgba(255, 255, 255, 0.08));
  background: rgba(255, 255, 255, 0.02);
}
.ko-qs-card[data-embedded="true"] .ko-qs-footer {
  padding: 12px 0 0 0;
  background: transparent;
}
.ko-qs-feedback {
  font-size: 11.5px;
  color: var(--ag-text-muted, #9ba7bc);
  min-height: 16px;
  flex: 1;
}
.ko-qs-feedback[data-kind="ok"] {
  color: #7ee2a8;
}
.ko-qs-feedback[data-kind="err"] {
  color: #ff9c9a;
}
.ko-qs-test-result {
  font-size: 11.5px;
  color: var(--ag-text-muted, #9ba7bc);
}
.ko-qs-test-result[data-kind="ok"] {
  color: #7ee2a8;
}
.ko-qs-test-result[data-kind="err"] {
  color: #ff9c9a;
}
`;

function isTranslationActiveStatus(status) {
  if (!status || !status.enabled) return false;
  return status.translateStaticUi !== false || status.translateThinking !== false;
}

function deriveToggleSaveState({ translateStaticUi, translateThinking, showThinking }) {
  const staticOn = Boolean(translateStaticUi);
  const thinkingOn = Boolean(translateThinking);
  const showThinkingOn = Boolean(showThinking);
  return {
    enabled: Boolean(staticOn || thinkingOn || !showThinkingOn),
    translateStaticUi: staticOn,
    translateThinking: thinkingOn,
    showThinking: showThinkingOn,
  };
}

function formatErrorMessage(reason) {
  const code = String(reason || 'ERR_SETTINGS_SAVE_FAILED');
  if (code === 'ERR_HOST_SAVE_UNSUPPORTED' || code === 'ERR_SETTINGS_SAVE_UNAVAILABLE') {
    return '호스트 런타임이 구버전입니다. addon-host 업그레이드 후 앱을 재시작해 주세요.';
  }
  if (code === 'ERR_SETTINGS_BRIDGE_NOT_BOUND' || code === 'ERR_SETTINGS_BRIDGE_NOT_DECLARED') {
    return '신뢰된 설정 브리지가 연결되지 않았습니다. addon-host 신뢰 승인을 확인해 주세요.';
  }
  if (code === 'ERR_SETTINGS_FILE_TOO_LARGE') {
    return '설정 파일 크기가 허용 한도를 초과했습니다.';
  }
  if (code === 'ERR_SETTINGS_WRITE_FAILED') {
    return '설정 파일을 저장하지 못했습니다. 파일 잠금이나 권한을 확인해 주세요.';
  }
  return `저장 실패 (${code})`;
}

function computeStatusbarMeta(status) {
  const active = isTranslationActiveStatus(status);
  const provider = status && typeof status.provider === 'string' ? status.provider : null;
  let label;
  let engineName;
  if (!active) {
    label = '번역:꺼짐';
    engineName = '꺼짐';
  } else if (provider === 'local-llm') {
    label = '번역:LLM';
    engineName = '로컬 LLM';
  } else if (provider === 'cloud-api') {
    label = '번역:API';
    engineName = '외부 API';
  } else if (provider === 'google-translate') {
    label = '번역:구글';
    engineName = '구글 번역';
  } else {
    const shortId = String(provider || '커스텀').slice(0, 14);
    label = `번역:${shortId}`;
    engineName = provider || '커스텀';
  }
  const title = active
    ? `한국어 번역기 (${engineName}) · 클릭: 빠른 설정 · Shift+클릭: 구글↔로컬 LLM 즉시 전환`
    : '한국어 번역기 (꺼짐) · 클릭: 빠른 설정 · Shift+클릭: 켜기 및 엔진 전환';
  return {
    id: STATUSBAR_ADDON_ID,
    label,
    title,
    description: '구글 번역 / 로컬 LLM 전환 및 번역 옵션 관리',
    order: 20,
    defaultEnabled: true,
  };
}

function buildProbeUrl(baseUrl, apiFormat) {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  if (apiFormat === 'openai') {
    return /\/v1$/i.test(cleanBase) ? `${cleanBase}/models` : `${cleanBase}/v1/models`;
  }
  return `${cleanBase.replace(/\/v1$/i, '')}/api/tags`;
}

function createQuickSettingsUi({
  win = typeof window !== 'undefined' ? window : null,
  doc = null,
  translator,
  hostCapability = null,
  fetchFn = null,
} = {}) {
  const targetWin = win;
  const targetDoc = doc || (targetWin && targetWin.document) || null;
  if (!targetWin || !targetDoc || !translator) {
    throw new Error('createQuickSettingsUi requires win, doc, and translator');
  }

  const v3Ctx = extractV3Context(hostCapability);
  const isPureV3 = Boolean(hostCapability && hostCapability.isPureV3 && v3Ctx);

  const effectiveFetch =
    typeof fetchFn === 'function'
      ? fetchFn
      : typeof targetWin.fetch === 'function'
        ? targetWin.fetch.bind(targetWin)
        : typeof fetch === 'function'
          ? fetch.bind(globalThis)
          : null;

  let started = false;
  let disposed = false;
  let statusbarRegistered = false;
  let v3StatusItemHandle = null;
  let pollTimer = null;
  let pollTicks = 0;
  let shiftKeyDown = false;
  let lastPointerShift = false;
  let quickToggling = false;
  let unsubStatus = null;

  let activePortal = null;
  let activeModalHandles = null;
  const cleanupListeners = [];
  const hostRegistrations = [];

  function addTrackedListener(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    cleanupListeners.push(() => {
      try {
        if (typeof target.removeEventListener === 'function') {
          target.removeEventListener(type, fn, opts);
        }
      } catch (_err) {}
    });
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      try {
        (targetWin.clearInterval || clearInterval)(pollTimer);
      } catch (_err) {}
      pollTimer = null;
    }
  }

  function hasV3StatusbarService() {
    if (!v3Ctx || !v3Ctx.services || typeof v3Ctx.services.has !== 'function') return false;
    try {
      return Boolean(v3Ctx.services.has('host.statusbar'));
    } catch (_err) {
      return false;
    }
  }

  function unregisterLegacyStatusbar() {
    if (!statusbarRegistered) return;
    if (targetWin.statusbarAddons && typeof targetWin.statusbarAddons.unregister === 'function') {
      try {
        targetWin.statusbarAddons.unregister(STATUSBAR_ADDON_ID);
      } catch (_err) {}
    }
    statusbarRegistered = false;
  }

  function handleStatusClick(evOrCtx, maybeEv) {
    if (disposed) return;
    const shiftPressed = Boolean(
      (maybeEv && maybeEv.shiftKey) || (evOrCtx && evOrCtx.shiftKey) || shiftKeyDown || lastPointerShift
    );
    lastPointerShift = false;
    if (shiftPressed) {
      void toggleEngineQuick();
    } else {
      toggleModal();
    }
  }

  function syncStatusbarButton() {
    if (disposed) return false;
    const meta = computeStatusbarMeta(translator.getStatus());
    const legacyApi = targetWin.statusbarAddons;
    const hasLegacyApi = Boolean(legacyApi && typeof legacyApi.register === 'function');
    const canUseV3StatusItem = Boolean(v3Ctx && v3Ctx.ui && typeof v3Ctx.ui.registerStatusItem === 'function');
    const preferV3StatusItem = Boolean(canUseV3StatusItem && (hasV3StatusbarService() || !hasLegacyApi));

    if (preferV3StatusItem) {
      unregisterLegacyStatusbar();
      try {
        if (v3StatusItemHandle && typeof v3StatusItemHandle.update === 'function') {
          v3StatusItemHandle.update({
            label: meta.label,
            tooltip: meta.title,
            priority: meta.order,
          });
        } else {
          v3StatusItemHandle = v3Ctx.ui.registerStatusItem({
            id: STATUSBAR_ADDON_ID,
            label: meta.label,
            tooltip: meta.title,
            align: 'right',
            priority: meta.order,
            onClick: (ev) => handleStatusClick(ev),
          });
        }
        clearPollTimer();
        return true;
      } catch (_err) {}
    }

    if (!hasLegacyApi) return false;
    if (v3StatusItemHandle && typeof v3StatusItemHandle.dispose === 'function') {
      try {
        v3StatusItemHandle.dispose();
      } catch (_err) {}
      v3StatusItemHandle = null;
    }
    try {
      legacyApi.register({
        ...meta,
        onClick(ctx, ev) {
          handleStatusClick(ctx, ev);
        },
      });
      statusbarRegistered = true;
      clearPollTimer();
      return true;
    } catch (_err) {
      return false;
    }
  }

  async function toggleEngineQuick() {
    if (disposed || quickToggling) return null;
    quickToggling = true;
    try {
      const cfg = translator.getConfigSnapshot();
      const nextProvider = cfg.provider === 'local-llm' || cfg.provider === 'cloud-api' ? 'google-translate' : 'local-llm';
      const patch = {
        enabled: true,
        provider: nextProvider,
      };
      if (!cfg.translateStaticUi && !cfg.translateThinking) {
        patch.translateStaticUi = true;
      }
      const res = await translator.saveSettings(patch);
      if (!res || res.ok !== true) {
        openModal({ initialError: formatErrorMessage(res && res.reason) });
      }
      return res;
    } finally {
      quickToggling = false;
    }
  }

  function createFallbackPortal(onClose) {
    const dlg = targetDoc.createElement('dialog');
    dlg.setAttribute('data-addon-host-modal-dialog', '1');
    dlg.setAttribute('data-addon-host-owner', 'ko-thought-translator');
    dlg.setAttribute('data-addon-host-slot', QUICK_SETTINGS_MODAL_SLOT_ID);
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('translate', 'no');
    dlg.setAttribute('data-addon-host-no-translate', 'true');

    let bodyEl = dlg;
    const shadowHost = targetDoc.createElement('div');
    shadowHost.className = 'addon-host-modal-shadow-host';
    dlg.appendChild(shadowHost);
    if (typeof shadowHost.attachShadow === 'function') {
      const sr = shadowHost.attachShadow({ mode: 'open' });
      const inner = targetDoc.createElement('div');
      inner.className = 'addon-host-slot-root';
      sr.appendChild(inner);
      bodyEl = inner;
    } else {
      bodyEl = shadowHost;
    }

    const hostBody = targetDoc.body || targetDoc.documentElement;
    hostBody.appendChild(dlg);
    if (typeof dlg.showModal === 'function') {
      try {
        dlg.showModal();
      } catch (_err) {}
    }

    let closed = false;
    const onKeyDown = (ev) => {
      if (!ev || ev.key !== 'Escape' || ev.isComposing || ev.keyCode === 229) return;
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      close();
    };
    if (typeof targetWin.addEventListener === 'function') {
      targetWin.addEventListener('keydown', onKeyDown, true);
    }

    function close() {
      if (closed) return;
      closed = true;
      if (typeof targetWin.removeEventListener === 'function') {
        try {
          targetWin.removeEventListener('keydown', onKeyDown, true);
        } catch (_err) {}
      }
      if (typeof dlg.close === 'function' && dlg.open) {
        try {
          dlg.close();
        } catch (_err) {}
      }
      if (dlg.parentNode && typeof dlg.parentNode.removeChild === 'function') {
        try {
          dlg.parentNode.removeChild(dlg);
        } catch (_err) {}
      }
      if (typeof onClose === 'function') {
        try {
          onClose();
        } catch (_err) {}
      }
    }

    return Object.freeze({
      id: 'fallback-quick-settings-modal',
      element: dlg,
      bodyEl,
      close,
    });
  }

  function updateModalLiveHeader(status) {
    if (!activeModalHandles) return;
    const { badgeEl, cacheLabelEl } = activeModalHandles;
    if (badgeEl) {
      if (status.lastError && !status.enabled) {
        badgeEl.textContent = '설정 오류';
        badgeEl.setAttribute('data-state', 'error');
      } else if (!status.enabled) {
        badgeEl.textContent = '꺼짐';
        badgeEl.setAttribute('data-state', 'off');
      } else if (!isTranslationActiveStatus(status)) {
        badgeEl.textContent = '번역 꺼짐';
        badgeEl.setAttribute('data-state', 'off');
      } else if (status.provider === 'local-llm') {
        badgeEl.textContent = '활성 · 로컬 LLM';
        badgeEl.setAttribute('data-state', 'on');
      } else if (status.provider === 'cloud-api') {
        badgeEl.textContent = '활성 · 외부 API';
        badgeEl.setAttribute('data-state', 'on');
      } else if (status.provider === 'google-translate') {
        badgeEl.textContent = '활성 · 구글 번역';
        badgeEl.setAttribute('data-state', 'on');
      } else {
        badgeEl.textContent = `활성 · ${status.provider || '커스텀'}`;
        badgeEl.setAttribute('data-state', 'on');
      }
    }
    if (cacheLabelEl) {
      cacheLabelEl.textContent = `번역 캐시: ${Number(status.cacheSize) || 0}건`;
    }
  }

  function closeModal() {
    if (!activePortal) return false;
    const p = activePortal;
    activePortal = null;
    activeModalHandles = null;
    try {
      p.close();
    } catch (_err) {}
    return true;
  }

  function createSlideSwitchControl(testId, checked) {
    const wrap = targetDoc.createElement('span');
    wrap.className = 'ko-qs-switch';
    const input = targetDoc.createElement('input');
    input.type = 'checkbox';
    input.className = 'ko-qs-switch-input';
    input.setAttribute('role', 'switch');
    input.setAttribute('data-testid', testId);
    input.checked = Boolean(checked);
    input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    input.addEventListener('change', () => {
      input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    });

    const track = targetDoc.createElement('span');
    track.className = 'ko-qs-switch-track';
    track.setAttribute('aria-hidden', 'true');
    const thumb = targetDoc.createElement('span');
    thumb.className = 'ko-qs-switch-thumb';
    track.appendChild(thumb);

    wrap.appendChild(input);
    wrap.appendChild(track);
    return { wrap, input };
  }

  function mountSettingsCard(mountRoot, { embedded = false, onClose = () => closeModal(), initialError = null } = {}) {
    const styleEl = targetDoc.createElement('style');
    styleEl.textContent = MODAL_CSS;
    mountRoot.appendChild(styleEl);

    const cfg = translator.getConfigSnapshot();
    const status = translator.getStatus();
    let selectedProvider = cfg.provider || 'google-translate';
    let saving = false;

    const card = targetDoc.createElement('div');
    card.className = 'ko-qs-card';
    card.setAttribute('data-testid', 'ko-qs-card');
    if (embedded) {
      card.setAttribute('data-embedded', 'true');
    }

    const badgeEl = targetDoc.createElement('span');
    badgeEl.className = 'ko-qs-badge';
    badgeEl.setAttribute('data-testid', 'ko-qs-status-badge');

    let closeBtn = null;
    if (!embedded) {
      const header = targetDoc.createElement('div');
      header.className = 'ko-qs-header';
      const titleWrap = targetDoc.createElement('div');
      titleWrap.className = 'ko-qs-title-wrap';
      const titleEl = targetDoc.createElement('h2');
      titleEl.className = 'ko-qs-title';
      titleEl.textContent = '한국어 번역 설정';
      titleWrap.appendChild(titleEl);
      titleWrap.appendChild(badgeEl);

      closeBtn = targetDoc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ko-qs-close';
      closeBtn.setAttribute('aria-label', '닫기');
      closeBtn.setAttribute('data-testid', 'ko-qs-close');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => onClose());
      header.appendChild(titleWrap);
      header.appendChild(closeBtn);
      card.appendChild(header);
    }

    // Body
    const body = targetDoc.createElement('div');
    body.className = 'ko-qs-body';

    if (embedded) {
      const statusRow = targetDoc.createElement('div');
      statusRow.className = 'ko-qs-inline-status';
      const metaLabel = targetDoc.createElement('span');
      metaLabel.className = 'ko-qs-inline-meta';
      metaLabel.textContent = '현재 상태';
      statusRow.appendChild(metaLabel);
      statusRow.appendChild(badgeEl);
      body.appendChild(statusRow);
    }

    // Corrupted/Missing Banner
    const banner = targetDoc.createElement('div');
    banner.className = 'ko-qs-banner';
    banner.setAttribute('data-testid', 'ko-qs-corrupt-banner');
    banner.hidden = !cfg.failClosed;
    const bannerText = targetDoc.createElement('span');
    bannerText.textContent = cfg.settingsMissing
      ? '설정 파일이 없어 안전 차단 상태입니다. 저장하면 기본 설정으로 복구됩니다.'
      : `설정 오류(${cfg.lastError || 'SETTINGS_FILE_CORRUPTED'})로 안전 차단 상태입니다.`;
    const recoverBtn = targetDoc.createElement('button');
    recoverBtn.type = 'button';
    recoverBtn.className = 'ko-qs-btn ko-qs-btn-danger';
    recoverBtn.setAttribute('data-testid', 'ko-qs-recover');
    recoverBtn.textContent = '기본값 복구';
    banner.appendChild(bannerText);
    banner.appendChild(recoverBtn);
    body.appendChild(banner);

    // Engine selector
    const engineWrap = targetDoc.createElement('div');
    const engineLabel = targetDoc.createElement('div');
    engineLabel.className = 'ko-qs-section-label';
    engineLabel.textContent = '번역 엔진';
    const engineGrid = targetDoc.createElement('div');
    engineGrid.className = 'ko-qs-engine-grid';
    engineGrid.setAttribute('role', 'radiogroup');
    engineGrid.setAttribute('aria-label', '번역 엔진 선택');

    const engineOptions = [
      { id: 'google-translate', name: '구글 번역', desc: '빠른 응답 · 별도 서버 불필요' },
      { id: 'local-llm', name: '로컬 LLM', desc: 'Ollama / OpenAI 호환 로컬 모델' },
      { id: 'cloud-api', name: '외부 API', desc: 'OpenAI · Claude · Gemini' },
    ];
    for (const cp of cfg.customProviders || []) {
      if (cp && cp.id && cp.id !== 'google-translate' && cp.id !== 'local-llm' && cp.id !== 'cloud-api') {
        engineOptions.push({ id: cp.id, name: cp.label || cp.id, desc: '사용자 지정 HTTP 번역기' });
      }
    }

    const engineButtons = new Map();
    const llmBox = targetDoc.createElement('div');
    const cloudBox = targetDoc.createElement('div');

    function syncSelectedEngineUi() {
      for (const [id, btn] of engineButtons.entries()) {
        btn.setAttribute('aria-checked', id === selectedProvider ? 'true' : 'false');
      }
      llmBox.hidden = selectedProvider !== 'local-llm';
      cloudBox.hidden = selectedProvider !== 'cloud-api';
    }

    for (const opt of engineOptions) {
      const btn = targetDoc.createElement('button');
      btn.type = 'button';
      btn.className = 'ko-qs-engine-btn';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('data-testid', `ko-qs-engine-${opt.id}`);
      const nameSpan = targetDoc.createElement('span');
      nameSpan.className = 'ko-qs-engine-name';
      nameSpan.textContent = opt.name;
      const descSpan = targetDoc.createElement('span');
      descSpan.className = 'ko-qs-engine-desc';
      descSpan.textContent = opt.desc;
      btn.appendChild(nameSpan);
      btn.appendChild(descSpan);
      btn.addEventListener('click', () => {
        selectedProvider = opt.id;
        syncSelectedEngineUi();
        if (opt.id === 'cloud-api') {
          void refreshCloudKeyStatus({ autoLoadModels: true });
        }
      });
      engineButtons.set(opt.id, btn);
      engineGrid.appendChild(btn);
    }

    const engineHint = targetDoc.createElement('p');
    engineHint.className = 'ko-qs-hint';
    engineHint.textContent = '팁: 하단 상태바 버튼을 Shift+클릭하면 구글 번역 ↔ 로컬 LLM을 즉시 전환합니다.';
    engineWrap.appendChild(engineLabel);
    engineWrap.appendChild(engineGrid);
    engineWrap.appendChild(engineHint);
    body.appendChild(engineWrap);

    // Local LLM Config Box
    llmBox.className = 'ko-qs-llm-box';
    llmBox.setAttribute('data-testid', 'ko-qs-llm-section');
    const llmCfg = { ...DEFAULT_LLM_CONFIG, ...(cfg.llmConfig || {}) };

    const llmHeader = targetDoc.createElement('div');
    llmHeader.className = 'ko-qs-section-label';
    llmHeader.textContent = '로컬 LLM 연결 설정';
    llmBox.appendChild(llmHeader);

    const llmRow1 = targetDoc.createElement('div');
    llmRow1.className = 'ko-qs-grid-2';

    const formatField = targetDoc.createElement('div');
    formatField.className = 'ko-qs-field';
    const formatLbl = targetDoc.createElement('label');
    formatLbl.textContent = 'API 형식';
    const formatSelect = targetDoc.createElement('select');
    formatSelect.className = 'ko-qs-select';
    formatSelect.setAttribute('data-testid', 'ko-qs-llm-format');
    for (const [val, text] of [
      ['ollama', 'Ollama (/api/chat)'],
      ['openai', 'OpenAI 호환 (/v1/chat/completions)'],
    ]) {
      const o = targetDoc.createElement('option');
      o.value = val;
      o.textContent = text;
      formatSelect.appendChild(o);
    }
    formatSelect.value = llmCfg.apiFormat === 'openai' || llmCfg.apiFormat === 'openai-compat' ? 'openai' : 'ollama';
    formatField.appendChild(formatLbl);
    formatField.appendChild(formatSelect);

    const modelField = targetDoc.createElement('div');
    modelField.className = 'ko-qs-field';
    const modelLbl = targetDoc.createElement('label');
    modelLbl.textContent = '모델명';
    const modelInput = targetDoc.createElement('input');
    modelInput.type = 'text';
    modelInput.className = 'ko-qs-input';
    modelInput.setAttribute('data-testid', 'ko-qs-llm-model');
    modelInput.value = String(llmCfg.model || 'gemma3:4b');
    modelInput.placeholder = 'gemma3:4b';
    modelField.appendChild(modelLbl);
    modelField.appendChild(modelInput);

    llmRow1.appendChild(formatField);
    llmRow1.appendChild(modelField);
    llmBox.appendChild(llmRow1);

    const llmRow2 = targetDoc.createElement('div');
    llmRow2.className = 'ko-qs-grid-2';

    const urlField = targetDoc.createElement('div');
    urlField.className = 'ko-qs-field';
    const urlLbl = targetDoc.createElement('label');
    urlLbl.textContent = '서버 주소 (기본: 127.0.0.1)';
    const urlInput = targetDoc.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'ko-qs-input';
    urlInput.setAttribute('data-testid', 'ko-qs-llm-url');
    urlInput.value = String(llmCfg.baseUrl || 'http://127.0.0.1:11434');
    urlInput.placeholder = 'http://127.0.0.1:11434';
    urlField.appendChild(urlLbl);
    urlField.appendChild(urlInput);

    const timeoutField = targetDoc.createElement('div');
    timeoutField.className = 'ko-qs-field';
    const timeoutLbl = targetDoc.createElement('label');
    timeoutLbl.textContent = '타임아웃 (ms)';
    const timeoutInput = targetDoc.createElement('input');
    timeoutInput.type = 'number';
    timeoutInput.min = '1000';
    timeoutInput.max = '120000';
    timeoutInput.step = '1000';
    timeoutInput.className = 'ko-qs-input';
    timeoutInput.setAttribute('data-testid', 'ko-qs-llm-timeout');
    timeoutInput.value = String(Number(llmCfg.timeoutMs) || 15000);
    timeoutField.appendChild(timeoutLbl);
    timeoutField.appendChild(timeoutInput);

    llmRow2.appendChild(urlField);
    llmRow2.appendChild(timeoutField);
    llmBox.appendChild(llmRow2);

    const remoteRow = targetDoc.createElement('label');
    remoteRow.className = 'ko-qs-toggle-row';
    const remoteTxtWrap = targetDoc.createElement('div');
    remoteTxtWrap.className = 'ko-qs-toggle-text';
    const remoteTitle = targetDoc.createElement('span');
    remoteTitle.className = 'ko-qs-toggle-title';
    remoteTitle.textContent = '원격 HTTPS 엔드포인트 허용';
    const remoteSub = targetDoc.createElement('span');
    remoteSub.className = 'ko-qs-toggle-sub';
    remoteSub.textContent = '기본 꺼짐 · 기본적으로 127.0.0.1 / localhost만 허용합니다.';
    remoteTxtWrap.appendChild(remoteTitle);
    remoteTxtWrap.appendChild(remoteSub);
    const { wrap: remoteSwitchWrap, input: remoteChk } = createSlideSwitchControl(
      'ko-qs-llm-remote',
      Boolean(llmCfg.allowRemoteHttps)
    );
    remoteRow.appendChild(remoteTxtWrap);
    remoteRow.appendChild(remoteSwitchWrap);
    llmBox.appendChild(remoteRow);

    const testRow = targetDoc.createElement('div');
    testRow.className = 'ko-qs-row-between';
    const testResultEl = targetDoc.createElement('span');
    testResultEl.className = 'ko-qs-test-result';
    testResultEl.setAttribute('data-testid', 'ko-qs-llm-test-result');
    testResultEl.textContent = '로컬 모델 서버 응답을 확인할 수 있습니다.';
    const testBtn = targetDoc.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'ko-qs-btn';
    testBtn.setAttribute('data-testid', 'ko-qs-llm-test');
    testBtn.textContent = '연결 테스트';
    testRow.appendChild(testResultEl);
    testRow.appendChild(testBtn);
    llmBox.appendChild(testRow);

    body.appendChild(llmBox);

    // External Cloud API Config Box (Extenra v3.3.0 ctx.secrets + net.fetch secretHeaders)
    cloudBox.className = 'ko-qs-cloud-box';
    cloudBox.setAttribute('data-testid', 'ko-qs-cloud-section');
    const cloudCfg = { ...DEFAULT_CLOUD_API_CONFIG, ...(cfg.cloudApiConfig || {}) };
    const secretsFacade =
      hostCapability && hostCapability.secrets && typeof hostCapability.secrets === 'object'
        ? hostCapability.secrets
        : v3Ctx && v3Ctx.secrets
          ? {
              available: true,
              getPersistenceMode: () =>
                typeof v3Ctx.secrets.getPersistenceMode === 'function'
                  ? v3Ctx.secrets.getPersistenceMode()
                  : 'os-encrypted',
              set: (k, v) => Promise.resolve(v3Ctx.secrets.set(k, v)),
              has: (k) => Promise.resolve(v3Ctx.secrets.has(k)),
              delete: (k) => Promise.resolve(v3Ctx.secrets.delete(k)),
            }
          : {
              available: false,
              getPersistenceMode: () => 'none',
              set: async () => ({ ok: false, reason: 'ERR_SECRETS_UNAVAILABLE' }),
              has: async () => false,
              delete: async () => false,
            };

    const cloudHeader = targetDoc.createElement('div');
    cloudHeader.className = 'ko-qs-section-label';
    cloudHeader.textContent = '외부 API 연결 설정 (Extenra 암호화 시크릿)';
    cloudBox.appendChild(cloudHeader);

    const cloudRow1 = targetDoc.createElement('div');
    cloudRow1.className = 'ko-qs-grid-2';

    const presetField = targetDoc.createElement('div');
    presetField.className = 'ko-qs-field';
    const presetLbl = targetDoc.createElement('label');
    presetLbl.textContent = 'API 제공자';
    const presetSelect = targetDoc.createElement('select');
    presetSelect.className = 'ko-qs-select';
    presetSelect.setAttribute('data-testid', 'ko-qs-cloud-preset');
    for (const key of Object.keys(CLOUD_API_PRESETS)) {
      const pDef = CLOUD_API_PRESETS[key];
      const o = targetDoc.createElement('option');
      o.value = pDef.id;
      o.textContent = pDef.label;
      presetSelect.appendChild(o);
    }
    const initPreset = getCloudPreset(cloudCfg.preset);
    presetSelect.value = initPreset.id;
    let lastPresetId = initPreset.id;
    presetField.appendChild(presetLbl);
    presetField.appendChild(presetSelect);

    const cloudModelField = targetDoc.createElement('div');
    cloudModelField.className = 'ko-qs-field';
    const cloudModelLbl = targetDoc.createElement('label');
    cloudModelLbl.textContent = '모델';
    const cloudModelRow = targetDoc.createElement('div');
    cloudModelRow.className = 'ko-qs-model-row';
    const cloudModelSelect = targetDoc.createElement('select');
    cloudModelSelect.className = 'ko-qs-select';
    cloudModelSelect.setAttribute('aria-label', '외부 API 모델 선택');
    cloudModelSelect.setAttribute('data-testid', 'ko-qs-cloud-model-select');
    const cloudModelRefreshBtn = targetDoc.createElement('button');
    cloudModelRefreshBtn.type = 'button';
    cloudModelRefreshBtn.className = 'ko-qs-btn';
    cloudModelRefreshBtn.setAttribute('data-testid', 'ko-qs-cloud-models-refresh');
    cloudModelRefreshBtn.setAttribute('title', '선택한 API 제공자에서 사용 가능한 모델 목록을 불러옵니다');
    cloudModelRefreshBtn.textContent = '불러오기';
    cloudModelRefreshBtn.disabled = !secretsFacade.available;
    cloudModelRow.appendChild(cloudModelSelect);
    cloudModelRow.appendChild(cloudModelRefreshBtn);

    const cloudModelInput = targetDoc.createElement('input');
    cloudModelInput.type = 'text';
    cloudModelInput.className = 'ko-qs-input ko-qs-model-custom';
    cloudModelInput.setAttribute('data-testid', 'ko-qs-cloud-model');
    cloudModelInput.value = String(cloudCfg.model || '').trim();
    cloudModelInput.placeholder = '모델 ID 직접 입력 (예: API [불러오기] 결과)';
    cloudModelInput.hidden = true;

    cloudModelField.appendChild(cloudModelLbl);
    cloudModelField.appendChild(cloudModelRow);
    cloudModelField.appendChild(cloudModelInput);

    const CLOUD_CUSTOM_MODEL_VALUE = '__custom__';
    const fetchedModelsCache = new Map();
    const savedPresetId = initPreset.id;
    const savedPresetModel = String(cloudCfg.model || '').trim();
    let modelFetchSeq = 0;

    function populateCloudModelSelect(models, desiredModel, { preserveCustomMode = false } = {}) {
      const list = Array.isArray(models) ? models : [];
      const seen = new Set();
      const normalized = [];
      for (const item of list) {
        const id = typeof item === 'string' ? item : item && item.id ? String(item.id) : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        normalized.push({ id, label: typeof item === 'object' && item && item.label ? String(item.label) : id });
      }
      const targetModel = String(desiredModel || '').trim();
      if (targetModel && !preserveCustomMode && !seen.has(targetModel)) {
        normalized.unshift({ id: targetModel, label: targetModel });
        seen.add(targetModel);
      }

      while (cloudModelSelect.firstChild) {
        cloudModelSelect.removeChild(cloudModelSelect.firstChild);
      }
      if (normalized.length === 0) {
        const placeholderOpt = targetDoc.createElement('option');
        placeholderOpt.value = '';
        placeholderOpt.textContent = 'API 키 입력 후 [불러오기]로 조회';
        placeholderOpt.disabled = true;
        cloudModelSelect.appendChild(placeholderOpt);
      } else {
        for (const item of normalized) {
          const opt = targetDoc.createElement('option');
          opt.value = item.id;
          opt.textContent = item.label;
          cloudModelSelect.appendChild(opt);
        }
      }
      const customOpt = targetDoc.createElement('option');
      customOpt.value = CLOUD_CUSTOM_MODEL_VALUE;
      customOpt.textContent = '직접 입력...';
      cloudModelSelect.appendChild(customOpt);

      if (preserveCustomMode) {
        cloudModelSelect.value = CLOUD_CUSTOM_MODEL_VALUE;
        cloudModelInput.hidden = false;
      } else if (normalized.length === 0) {
        cloudModelSelect.value = '';
        cloudModelInput.value = '';
        cloudModelInput.hidden = true;
      } else {
        const activeId = targetModel && seen.has(targetModel) ? targetModel : normalized[0].id;
        cloudModelSelect.value = activeId;
        cloudModelInput.value = activeId;
        cloudModelInput.hidden = true;
      }
    }

    populateCloudModelSelect([], savedPresetModel);

    cloudModelSelect.addEventListener('change', () => {
      if (cloudModelSelect.value === CLOUD_CUSTOM_MODEL_VALUE) {
        cloudModelInput.hidden = false;
        if (typeof cloudModelInput.focus === 'function') {
          try {
            cloudModelInput.focus();
          } catch (_e) {}
        }
      } else if (cloudModelSelect.value) {
        cloudModelInput.value = cloudModelSelect.value;
        cloudModelInput.hidden = true;
      }
    });

    cloudRow1.appendChild(presetField);
    cloudRow1.appendChild(cloudModelField);
    cloudBox.appendChild(cloudRow1);

    const cloudRow2 = targetDoc.createElement('div');
    cloudRow2.className = 'ko-qs-grid-2';

    const cloudUrlField = targetDoc.createElement('div');
    cloudUrlField.className = 'ko-qs-field';
    const cloudUrlLbl = targetDoc.createElement('label');
    cloudUrlLbl.textContent = 'HTTPS API 주소';
    const cloudUrlInput = targetDoc.createElement('input');
    cloudUrlInput.type = 'url';
    cloudUrlInput.className = 'ko-qs-input';
    cloudUrlInput.setAttribute('data-testid', 'ko-qs-cloud-url');
    cloudUrlInput.value = String(cloudCfg.baseUrl || initPreset.baseUrl);
    cloudUrlInput.placeholder = initPreset.baseUrl;
    cloudUrlField.appendChild(cloudUrlLbl);
    cloudUrlField.appendChild(cloudUrlInput);

    const cloudTimeoutField = targetDoc.createElement('div');
    cloudTimeoutField.className = 'ko-qs-field';
    const cloudTimeoutLbl = targetDoc.createElement('label');
    cloudTimeoutLbl.textContent = '타임아웃 (ms)';
    const cloudTimeoutInput = targetDoc.createElement('input');
    cloudTimeoutInput.type = 'number';
    cloudTimeoutInput.min = '1000';
    cloudTimeoutInput.max = '120000';
    cloudTimeoutInput.step = '1000';
    cloudTimeoutInput.className = 'ko-qs-input';
    cloudTimeoutInput.setAttribute('data-testid', 'ko-qs-cloud-timeout');
    cloudTimeoutInput.value = String(Number(cloudCfg.timeoutMs) || 20000);
    cloudTimeoutField.appendChild(cloudTimeoutLbl);
    cloudTimeoutField.appendChild(cloudTimeoutInput);

    cloudRow2.appendChild(cloudUrlField);
    cloudRow2.appendChild(cloudTimeoutField);
    cloudBox.appendChild(cloudRow2);

    const apiKeyField = targetDoc.createElement('div');
    apiKeyField.className = 'ko-qs-field';
    const apiKeyMeta = targetDoc.createElement('div');
    apiKeyMeta.className = 'ko-qs-secret-meta';
    const apiKeyLbl = targetDoc.createElement('label');
    apiKeyLbl.textContent = 'API 키 (설정 JSON에 저장되지 않음)';
    const apiKeyStatusPill = targetDoc.createElement('span');
    apiKeyStatusPill.className = 'ko-qs-secret-pill';
    apiKeyStatusPill.setAttribute('data-testid', 'ko-qs-cloud-key-status');
    apiKeyStatusPill.textContent = secretsFacade.available ? '확인 중...' : 'Extenra v3.3.0+ 필요';
    apiKeyMeta.appendChild(apiKeyLbl);
    apiKeyMeta.appendChild(apiKeyStatusPill);

    const apiKeyRow = targetDoc.createElement('div');
    apiKeyRow.className = 'ko-qs-secret-row';
    const apiKeyInput = targetDoc.createElement('input');
    apiKeyInput.type = 'password';
    apiKeyInput.autocomplete = 'off';
    apiKeyInput.className = 'ko-qs-input';
    apiKeyInput.setAttribute('data-testid', 'ko-qs-cloud-apikey');
    apiKeyInput.placeholder = `${initPreset.keyPlaceholder} (새 키 입력 시에만 갱신)`;
    apiKeyInput.disabled = !secretsFacade.available;

    const apiKeyDelBtn = targetDoc.createElement('button');
    apiKeyDelBtn.type = 'button';
    apiKeyDelBtn.className = 'ko-qs-btn ko-qs-btn-danger';
    apiKeyDelBtn.setAttribute('data-testid', 'ko-qs-cloud-key-delete');
    apiKeyDelBtn.textContent = '키 삭제';
    apiKeyDelBtn.disabled = true;

    apiKeyRow.appendChild(apiKeyInput);
    apiKeyRow.appendChild(apiKeyDelBtn);
    apiKeyField.appendChild(apiKeyMeta);
    apiKeyField.appendChild(apiKeyRow);
    cloudBox.appendChild(apiKeyField);

    const cloudTestRow = targetDoc.createElement('div');
    cloudTestRow.className = 'ko-qs-row-between';
    const cloudTestResultEl = targetDoc.createElement('span');
    cloudTestResultEl.className = 'ko-qs-test-result';
    cloudTestResultEl.setAttribute('data-testid', 'ko-qs-cloud-test-result');
    cloudTestResultEl.textContent = secretsFacade.available
      ? 'API 키는 호스트 암호화 금고에 저장되며 번역 요청 시 호스트가 헤더를 주입합니다.'
      : '외부 API 키 저장을 위해 Extenra v3.3.0 이상 호스트가 필요합니다.';
    const cloudTestBtn = targetDoc.createElement('button');
    cloudTestBtn.type = 'button';
    cloudTestBtn.className = 'ko-qs-btn';
    cloudTestBtn.setAttribute('data-testid', 'ko-qs-cloud-test');
    cloudTestBtn.textContent = '연결 테스트';
    cloudTestBtn.disabled = !secretsFacade.available;
    cloudTestRow.appendChild(cloudTestResultEl);
    cloudTestRow.appendChild(cloudTestBtn);
    cloudBox.appendChild(cloudTestRow);

    body.appendChild(cloudBox);

    function formatPersistenceLabel(mode) {
      if (mode === 'os-encrypted') return 'OS 암호화';
      if (mode === 'remote-bridge') return 'Remote Bridge';
      if (mode === 'session-memory') return '세션 메모리';
      return '미지원';
    }

    async function loadVendorCloudModels({ silent = false } = {}) {
      const seq = ++modelFetchSeq;
      if (!secretsFacade.available) {
        if (!silent) {
          cloudTestResultEl.textContent = 'Extenra v3.3.0 이상 호스트의 시크릿 저장소가 필요합니다.';
          cloudTestResultEl.setAttribute('data-kind', 'err');
        }
        return false;
      }
      if (!effectiveFetch) {
        if (!silent) {
          cloudTestResultEl.textContent = 'fetch API를 사용할 수 없습니다.';
          cloudTestResultEl.setAttribute('data-kind', 'err');
        }
        return false;
      }
      const activePresetId = presetSelect.value;
      const activeBaseUrl = String(cloudUrlInput.value || '').trim() || getCloudPreset(activePresetId).baseUrl;
      const cacheKey = `${activePresetId}|${activeBaseUrl}`;
      if (!silent) {
        const secretSave = await persistPendingCloudSecretIfEntered();
        if (seq !== modelFetchSeq) return false;
        if (!secretSave.ok) {
          cloudTestResultEl.textContent = formatErrorMessage(secretSave.reason);
          cloudTestResultEl.setAttribute('data-kind', 'err');
          return false;
        }
      }
      const hasKey = await secretsFacade.has(getCloudSecretKeyForPreset(activePresetId));
      if (seq !== modelFetchSeq) return false;
      if (!hasKey) {
        if (!silent) {
          cloudTestResultEl.textContent = 'API 키를 입력한 뒤 [불러오기]를 눌러 주세요.';
          cloudTestResultEl.setAttribute('data-kind', 'err');
        }
        return false;
      }

      cloudModelRefreshBtn.disabled = true;
      if (!silent) {
        cloudModelRefreshBtn.textContent = '불러오는 중...';
        cloudTestResultEl.textContent = 'API 제공자에서 모델 목록을 불러오는 중...';
        cloudTestResultEl.setAttribute('data-kind', 'info');
      }
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ac
        ? (targetWin.setTimeout || setTimeout)(() => {
            try {
              ac.abort();
            } catch (_e) {}
          }, 10000)
        : null;
      try {
        const res = await fetchCloudApiModels({
          config: {
            preset: activePresetId,
            baseUrl: activeBaseUrl,
            model: String(cloudModelInput.value || '').trim(),
            timeoutMs: Number(cloudTimeoutInput.value) || 20000,
          },
          fetchFn: effectiveFetch,
          signal: ac ? ac.signal : undefined,
        });
        if (seq !== modelFetchSeq || presetSelect.value !== activePresetId) return false;
        if (res.ok && Array.isArray(res.models) && res.models.length > 0) {
          fetchedModelsCache.set(cacheKey, res.models);
          const preserveCustom = cloudModelSelect.value === CLOUD_CUSTOM_MODEL_VALUE;
          populateCloudModelSelect(res.models, cloudModelInput.value, { preserveCustomMode: preserveCustom });
          if (!silent) {
            cloudTestResultEl.textContent = `모델 목록 ${res.models.length}개를 불러왔습니다.`;
            cloudTestResultEl.setAttribute('data-kind', 'ok');
          }
          return true;
        }
        if (!silent) {
          cloudTestResultEl.textContent = `모델 목록 불러오기 실패 (${res.reason || `HTTP ${res.status}`})`;
          cloudTestResultEl.setAttribute('data-kind', 'err');
        }
        return false;
      } finally {
        if (timer !== null) {
          try {
            (targetWin.clearTimeout || clearTimeout)(timer);
          } catch (_e) {}
        }
        cloudModelRefreshBtn.textContent = '불러오기';
        cloudModelRefreshBtn.disabled = !secretsFacade.available;
      }
    }

    cloudModelRefreshBtn.addEventListener('click', () => {
      void loadVendorCloudModels({ silent: false });
    });

    let keyStatusSeq = 0;
    async function refreshCloudKeyStatus({ autoLoadModels = true } = {}) {
      const seq = ++keyStatusSeq;
      if (!secretsFacade.available) {
        apiKeyStatusPill.textContent = 'Extenra v3.3.0+ 필요';
        apiKeyStatusPill.setAttribute('data-state', 'warn');
        apiKeyDelBtn.disabled = true;
        return false;
      }
      const activePresetId = presetSelect.value;
      const secretKey = getCloudSecretKeyForPreset(activePresetId);
      try {
        const exists = await secretsFacade.has(secretKey);
        if (seq !== keyStatusSeq) return exists;
        const mode = secretsFacade.getPersistenceMode();
        if (exists) {
          apiKeyStatusPill.textContent = `저장됨 · ${formatPersistenceLabel(mode)}`;
          apiKeyStatusPill.setAttribute('data-state', mode === 'session-memory' ? 'warn' : 'saved');
          apiKeyDelBtn.disabled = false;
          const activeBaseUrl = String(cloudUrlInput.value || '').trim() || getCloudPreset(activePresetId).baseUrl;
          const cacheKey = `${activePresetId}|${activeBaseUrl}`;
          if (autoLoadModels && selectedProvider === 'cloud-api' && !fetchedModelsCache.has(cacheKey)) {
            void loadVendorCloudModels({ silent: true });
          }
        } else {
          apiKeyStatusPill.textContent = `미등록 · ${formatPersistenceLabel(mode)}`;
          apiKeyStatusPill.setAttribute('data-state', 'none');
          apiKeyDelBtn.disabled = true;
        }
        return exists;
      } catch (_err) {
        if (seq === keyStatusSeq) {
          apiKeyStatusPill.textContent = '확인 실패';
          apiKeyStatusPill.setAttribute('data-state', 'warn');
          apiKeyDelBtn.disabled = true;
        }
        return false;
      }
    }

    presetSelect.addEventListener('change', () => {
      modelFetchSeq += 1;
      const prevPreset = getCloudPreset(lastPresetId);
      const nextPreset = getCloudPreset(presetSelect.value);
      lastPresetId = nextPreset.id;
      const curUrl = String(cloudUrlInput.value || '').trim();
      if (!curUrl || curUrl === prevPreset.baseUrl) {
        cloudUrlInput.value = nextPreset.baseUrl;
      }
      cloudUrlInput.placeholder = nextPreset.baseUrl;
      const cacheKey = `${nextPreset.id}|${String(cloudUrlInput.value || '').trim()}`;
      const cachedList = fetchedModelsCache.get(cacheKey) || [];
      const nextDesiredModel = nextPreset.id === savedPresetId ? savedPresetModel : '';
      populateCloudModelSelect(cachedList, nextDesiredModel);
      apiKeyInput.placeholder = `${nextPreset.keyPlaceholder} (새 키 입력 시에만 갱신)`;
      apiKeyInput.value = '';
      void refreshCloudKeyStatus();
    });

    apiKeyDelBtn.addEventListener('click', async () => {
      if (!secretsFacade.available) return;
      const activePresetId = presetSelect.value;
      const secretKey = getCloudSecretKeyForPreset(activePresetId);
      apiKeyDelBtn.disabled = true;
      try {
        await secretsFacade.delete(secretKey);
        const cacheKey = `${activePresetId}|${String(cloudUrlInput.value || '').trim()}`;
        fetchedModelsCache.delete(cacheKey);
        populateCloudModelSelect([], activePresetId === savedPresetId ? savedPresetModel : '');
        apiKeyInput.value = '';
        cloudTestResultEl.textContent = '저장된 API 키를 삭제했습니다.';
        cloudTestResultEl.setAttribute('data-kind', 'info');
      } finally {
        await refreshCloudKeyStatus({ autoLoadModels: false });
      }
    });

    // Translation Options (3 clear, non-redundant slide ON/OFF switches)
    const optionsSection = targetDoc.createElement('div');
    const optionsLabel = targetDoc.createElement('div');
    optionsLabel.className = 'ko-qs-section-label';
    optionsLabel.textContent = '번역 옵션';
    const togglesWrap = targetDoc.createElement('div');
    togglesWrap.className = 'ko-qs-toggles';
    togglesWrap.setAttribute('data-testid', 'ko-qs-toggles');

    function makeSwitchRow(testId, title, sub, checked) {
      const row = targetDoc.createElement('label');
      row.className = 'ko-qs-toggle-row';
      const txt = targetDoc.createElement('div');
      txt.className = 'ko-qs-toggle-text';
      const t = targetDoc.createElement('span');
      t.className = 'ko-qs-toggle-title';
      t.textContent = title;
      const s = targetDoc.createElement('span');
      s.className = 'ko-qs-toggle-sub';
      s.textContent = sub;
      txt.appendChild(t);
      txt.appendChild(s);
      const { wrap: switchWrap, input } = createSlideSwitchControl(testId, checked);
      row.appendChild(txt);
      row.appendChild(switchWrap);
      togglesWrap.appendChild(row);
      return input;
    }

    const staticUiChk = makeSwitchRow(
      'ko-qs-opt-static-ui',
      '영문 UI 한글화',
      '코드·diff·터미널·타 플러그인을 제외한 UI를 한글화하며, 끄면 원문으로 복구합니다.',
      cfg.failClosed ? true : Boolean(cfg.enabled && cfg.translateStaticUi)
    );
    staticUiChk.setAttribute('data-merged-enabled', 'true');

    const thinkingChk = makeSwitchRow(
      'ko-qs-opt-thinking',
      'Thinking(추론 과정) 한국어 번역',
      '추론 과정을 한국어로 번역하며, 코드·파일 경로·식별자는 원형을 보존합니다.',
      cfg.failClosed ? true : Boolean(cfg.enabled && cfg.translateThinking)
    );

    const showThinkingChk = makeSwitchRow(
      'ko-qs-opt-show-thinking',
      'Thinking 블록 표시',
      '끄면 작업 내역은 유지하고 추론 블록만 화면에서 숨깁니다.',
      Boolean(cfg.showThinking)
    );

    optionsSection.appendChild(optionsLabel);
    optionsSection.appendChild(togglesWrap);
    body.appendChild(optionsSection);

    // Cache & Instant Actions Bar
    const actionsBar = targetDoc.createElement('div');
    actionsBar.className = 'ko-qs-actions-bar';
    const cacheLabelEl = targetDoc.createElement('span');
    cacheLabelEl.className = 'ko-qs-cache-label';
    cacheLabelEl.setAttribute('data-testid', 'ko-qs-cache-count');
    const actionBtns = targetDoc.createElement('div');
    actionBtns.className = 'ko-qs-btn-group';
    const retranslateBtn = targetDoc.createElement('button');
    retranslateBtn.type = 'button';
    retranslateBtn.className = 'ko-qs-btn';
    retranslateBtn.setAttribute('data-testid', 'ko-qs-retranslate');
    retranslateBtn.textContent = '지금 다시 번역';
    const clearCacheBtn = targetDoc.createElement('button');
    clearCacheBtn.type = 'button';
    clearCacheBtn.className = 'ko-qs-btn';
    clearCacheBtn.setAttribute('data-testid', 'ko-qs-clear-cache');
    clearCacheBtn.textContent = '캐시 초기화';
    actionBtns.appendChild(retranslateBtn);
    actionBtns.appendChild(clearCacheBtn);
    actionsBar.appendChild(cacheLabelEl);
    actionsBar.appendChild(actionBtns);
    body.appendChild(actionsBar);

    card.appendChild(body);

    // Footer
    const footer = targetDoc.createElement('div');
    footer.className = 'ko-qs-footer';
    const feedbackEl = targetDoc.createElement('span');
    feedbackEl.className = 'ko-qs-feedback';
    feedbackEl.setAttribute('role', 'status');
    feedbackEl.setAttribute('aria-live', 'polite');
    feedbackEl.setAttribute('data-testid', 'ko-qs-feedback');

    const footerBtns = targetDoc.createElement('div');
    footerBtns.className = 'ko-qs-btn-group';
    const cancelBtn = targetDoc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ko-qs-btn';
    cancelBtn.setAttribute('data-testid', 'ko-qs-cancel');
    cancelBtn.textContent = '취소';
    const saveBtn = targetDoc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ko-qs-btn ko-qs-btn-primary';
    saveBtn.setAttribute('data-testid', 'ko-qs-save');
    saveBtn.textContent = '저장 및 적용';

    footerBtns.appendChild(cancelBtn);
    footerBtns.appendChild(saveBtn);
    footer.appendChild(feedbackEl);
    footer.appendChild(footerBtns);
    card.appendChild(footer);

    mountRoot.appendChild(card);

    function setFeedback(message, kind = 'info') {
      feedbackEl.textContent = String(message || '');
      feedbackEl.setAttribute('data-kind', kind);
    }

    function readValidatedLlmInput() {
      const rawUrl = String(urlInput.value || '').trim();
      const allowRemoteHttps = Boolean(remoteChk.checked);
      if (SECRET_QUERY_RE.test(rawUrl)) {
        throw new Error('서버 주소에 비밀 쿼리 파라미터(key/token 등)를 넣을 수 없습니다.');
      }
      const parsedUrl = validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps });
      const rawTimeout = Number(timeoutInput.value);
      if (!Number.isFinite(rawTimeout) || rawTimeout < 1000 || rawTimeout > 120000) {
        throw new Error('타임아웃은 1000~120000ms 범위여야 합니다.');
      }
      const model = String(modelInput.value || '').trim().slice(0, 128) || 'gemma3:4b';
      const apiFormat = formatSelect.value === 'openai' ? 'openai' : 'ollama';
      return {
        baseUrl: parsedUrl.href.replace(/\/+$/, ''),
        model,
        apiFormat,
        allowRemoteHttps,
        timeoutMs: Math.floor(rawTimeout),
      };
    }

    function readValidatedCloudInput() {
      const modelValue = String(cloudModelInput.value || '').trim();
      if (!modelValue) {
        throw new Error('모델을 선택하거나 직접 입력해 주세요. (API 키 입력 후 [불러오기]로 현재 제공 모델을 조회할 수 있습니다)');
      }
      const validated = validateCloudApiConfig(
        {
          preset: presetSelect.value,
          baseUrl: String(cloudUrlInput.value || '').trim(),
          model: modelValue,
          timeoutMs: Number(cloudTimeoutInput.value),
        },
        { requireModel: true }
      );
      return {
        preset: validated.preset,
        baseUrl: validated.baseUrl,
        model: validated.model,
        timeoutMs: validated.timeoutMs,
      };
    }

    async function persistPendingCloudSecretIfEntered() {
      const rawKey = String(apiKeyInput.value || '').trim();
      if (!rawKey) return { saved: false, ok: true };
      if (!secretsFacade.available) {
        return { saved: false, ok: false, reason: 'ERR_SECRETS_UNAVAILABLE' };
      }
      const secretKey = getCloudSecretKeyForPreset(presetSelect.value);
      const res = await secretsFacade.set(secretKey, rawKey);
      if (!res || res.ok !== true) {
        return { saved: false, ok: false, reason: (res && res.reason) || 'ERR_SECRETS_SAVE_FAILED' };
      }
      apiKeyInput.value = '';
      await refreshCloudKeyStatus({ autoLoadModels: false });
      return { saved: true, ok: true };
    }

    async function handleSave({ resetToDefaults = false } = {}) {
      if (saving) return;
      let patch;
      if (resetToDefaults) {
        patch = {
          enabled: true,
          translateThinking: true,
          showThinking: true,
          translateStaticUi: true,
          provider: 'google-translate',
          llmConfig: { ...DEFAULT_LLM_CONFIG },
          cloudApiConfig: { ...DEFAULT_CLOUD_API_CONFIG },
        };
      } else {
        let nextLlmConfig;
        try {
          nextLlmConfig = readValidatedLlmInput();
        } catch (err) {
          setFeedback(err && err.message ? err.message : '로컬 LLM 설정이 올바르지 않습니다.', 'err');
          return;
        }
        let nextCloudConfig = { ...DEFAULT_CLOUD_API_CONFIG, ...(cfg.cloudApiConfig || {}) };
        if (selectedProvider === 'cloud-api') {
          try {
            nextCloudConfig = readValidatedCloudInput();
          } catch (err) {
            setFeedback(err && err.message ? err.message : '외부 API 설정이 올바르지 않습니다.', 'err');
            return;
          }
          const secretRes = await persistPendingCloudSecretIfEntered();
          if (!secretRes.ok) {
            setFeedback(formatErrorMessage(secretRes.reason), 'err');
            return;
          }
        }
        const derivedToggles = deriveToggleSaveState({
          translateStaticUi: staticUiChk.checked,
          translateThinking: thinkingChk.checked,
          showThinking: showThinkingChk.checked,
        });
        patch = {
          ...derivedToggles,
          provider: selectedProvider,
          llmConfig: nextLlmConfig,
          cloudApiConfig: nextCloudConfig,
        };
      }

      saving = true;
      saveBtn.disabled = true;
      recoverBtn.disabled = true;
      setFeedback('설정을 저장하는 중...', 'info');
      try {
        const res = await translator.saveSettings(patch);
        if (!res || res.ok !== true) {
          setFeedback(formatErrorMessage(res && res.reason), 'err');
          return;
        }
        banner.hidden = true;
        setFeedback('저장 및 적용 완료', 'ok');
        onClose();
      } finally {
        saving = false;
        saveBtn.disabled = false;
        recoverBtn.disabled = false;
      }
    }

    async function handleTestConnection() {
      if (!effectiveFetch) {
        testResultEl.textContent = 'fetch API를 사용할 수 없습니다.';
        testResultEl.setAttribute('data-kind', 'err');
        return;
      }
      let nextLlm;
      try {
        nextLlm = readValidatedLlmInput();
      } catch (err) {
        testResultEl.textContent = err && err.message ? err.message : '잘못된 서버 주소입니다.';
        testResultEl.setAttribute('data-kind', 'err');
        return;
      }
      testBtn.disabled = true;
      testResultEl.textContent = '연결 확인 중...';
      testResultEl.setAttribute('data-kind', 'info');
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ac
        ? (targetWin.setTimeout || setTimeout)(() => {
            try {
              ac.abort();
            } catch (_e) {}
          }, 5000)
        : null;
      try {
        const probeUrl = buildProbeUrl(nextLlm.baseUrl, nextLlm.apiFormat);
        const res = await effectiveFetch(probeUrl, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          signal: ac ? ac.signal : undefined,
        });
        if (!res || !res.ok) {
          testResultEl.textContent = `연결 실패 (HTTP ${res ? res.status : 'ERR'})`;
          testResultEl.setAttribute('data-kind', 'err');
          return;
        }
        let modelCount = null;
        try {
          const data = await res.json();
          if (data && Array.isArray(data.models)) modelCount = data.models.length;
          else if (data && Array.isArray(data.data)) modelCount = data.data.length;
        } catch (_jsonErr) {}
        testResultEl.textContent =
          modelCount !== null ? `연결 성공 · 모델 ${modelCount}개 확인` : '연결 성공';
        testResultEl.setAttribute('data-kind', 'ok');
      } catch (err) {
        testResultEl.textContent = `연결 실패 (${err && err.message ? err.message : String(err)})`;
        testResultEl.setAttribute('data-kind', 'err');
      } finally {
        if (timer !== null) {
          try {
            (targetWin.clearTimeout || clearTimeout)(timer);
          } catch (_e) {}
        }
        testBtn.disabled = false;
      }
    }

    async function handleTestCloudConnection() {
      if (!secretsFacade.available) {
        cloudTestResultEl.textContent = 'Extenra v3.3.0 이상 호스트의 시크릿 저장소가 필요합니다.';
        cloudTestResultEl.setAttribute('data-kind', 'err');
        return;
      }
      if (!effectiveFetch) {
        cloudTestResultEl.textContent = 'fetch API를 사용할 수 없습니다.';
        cloudTestResultEl.setAttribute('data-kind', 'err');
        return;
      }
      let nextCloud;
      try {
        nextCloud = readValidatedCloudInput();
      } catch (err) {
        cloudTestResultEl.textContent = err && err.message ? err.message : '외부 API 설정이 올바르지 않습니다.';
        cloudTestResultEl.setAttribute('data-kind', 'err');
        return;
      }
      cloudTestBtn.disabled = true;
      cloudTestResultEl.textContent = 'API 연결 및 키 확인 중...';
      cloudTestResultEl.setAttribute('data-kind', 'info');
      try {
        const secretSave = await persistPendingCloudSecretIfEntered();
        if (!secretSave.ok) {
          cloudTestResultEl.textContent = formatErrorMessage(secretSave.reason);
          cloudTestResultEl.setAttribute('data-kind', 'err');
          return;
        }
        const hasKey = await secretsFacade.has(getCloudSecretKeyForPreset(nextCloud.preset));
        if (!hasKey) {
          cloudTestResultEl.textContent = 'API 키가 등록되지 않았습니다. 키를 입력한 뒤 다시 테스트해 주세요.';
          cloudTestResultEl.setAttribute('data-kind', 'err');
          return;
        }
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ac
          ? (targetWin.setTimeout || setTimeout)(() => {
              try {
                ac.abort();
              } catch (_e) {}
            }, 10000)
          : null;
        try {
          const probe = await probeCloudApiConnection({
            config: nextCloud,
            fetchFn: effectiveFetch,
            signal: ac ? ac.signal : undefined,
          });
          if (probe.ok) {
            cloudTestResultEl.textContent = probe.sample
              ? `연결 성공 · 응답: ${probe.sample}`
              : '연결 성공';
            cloudTestResultEl.setAttribute('data-kind', 'ok');
          } else {
            cloudTestResultEl.textContent = `연결 실패 (${probe.reason || `HTTP ${probe.status}`})`;
            cloudTestResultEl.setAttribute('data-kind', 'err');
          }
        } finally {
          if (timer !== null) {
            try {
              (targetWin.clearTimeout || clearTimeout)(timer);
            } catch (_e) {}
          }
        }
      } finally {
        cloudTestBtn.disabled = !secretsFacade.available;
      }
    }

    cancelBtn.addEventListener('click', () => onClose());
    saveBtn.addEventListener('click', () => {
      void handleSave({ resetToDefaults: false });
    });
    recoverBtn.addEventListener('click', () => {
      void handleSave({ resetToDefaults: true });
    });
    testBtn.addEventListener('click', () => {
      void handleTestConnection();
    });
    cloudTestBtn.addEventListener('click', () => {
      void handleTestCloudConnection();
    });
    retranslateBtn.addEventListener('click', () => {
      translator.retranslateNow(false);
      setFeedback('현재 화면의 Thinking 블록을 다시 번역합니다.', 'ok');
    });
    clearCacheBtn.addEventListener('click', () => {
      translator.retranslateNow(true);
      setFeedback('번역 캐시를 초기화했습니다.', 'ok');
    });

    // IME-safe Enter submit inside text inputs
    for (const inp of [urlInput, modelInput, timeoutInput, cloudUrlInput, cloudModelInput, cloudTimeoutInput, apiKeyInput]) {
      inp.addEventListener('keydown', (ev) => {
        if (!ev || ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        void handleSave({ resetToDefaults: false });
      });
    }

    activeModalHandles = {
      mountRoot,
      badgeEl,
      cacheLabelEl,
      setFeedback,
    };

    syncSelectedEngineUi();
    void refreshCloudKeyStatus();
    updateModalLiveHeader(status);
    if (initialError) {
      setFeedback(initialError, 'err');
    } else if (!cfg.canSaveSettings) {
      setFeedback(formatErrorMessage('ERR_HOST_SAVE_UNSUPPORTED'), 'err');
    }

    const activeEngineBtn = engineButtons.get(selectedProvider) || closeBtn || saveBtn;
    if (activeEngineBtn && typeof activeEngineBtn.focus === 'function') {
      try {
        activeEngineBtn.focus();
      } catch (_err) {}
    }

    return activeModalHandles;
  }

  function openModal({ initialError = null } = {}) {
    if (disposed) return null;
    if (activePortal) {
      if (initialError && activeModalHandles && activeModalHandles.setFeedback) {
        activeModalHandles.setFeedback(initialError, 'err');
      }
      return activePortal;
    }

    const onPortalClosed = () => {
      activePortal = null;
      activeModalHandles = null;
    };

    const useV3Overlay = Boolean(isPureV3 && v3Ctx && v3Ctx.ui && typeof v3Ctx.ui.openModal === 'function');
    let portal;
    if (useV3Overlay) {
      portal = v3Ctx.ui.openModal({
        title: '한국어 번역 설정',
        placement: { zone: 'surface-center', width: 516 },
        onClose: onPortalClosed,
      });
    } else if (hostCapability && typeof hostCapability.openModal === 'function') {
      portal = hostCapability.openModal(QUICK_SETTINGS_MODAL_SLOT_ID, { shadow: true, onClose: onPortalClosed });
    } else {
      portal = createFallbackPortal(onPortalClosed);
    }

    activePortal = portal;

    if (!useV3Overlay) {
      if (portal.element && portal.element.style) {
        const st = portal.element.style;
        st.position = 'fixed';
        st.inset = '0';
        st.top = '36px';
        st.top = 'max(env(titlebar-area-height, 36px), 36px)';
        st.right = '0';
        st.bottom = '0';
        st.left = '0';
        st.margin = 'auto';
        st.marginTop = 'auto';
        st.marginRight = 'auto';
        st.marginBottom = 'auto';
        st.marginLeft = 'auto';
        st.width = 'fit-content';
        st.height = 'fit-content';
        st.padding = '0';
        st.border = 'none';
        st.background = 'transparent';
        st.maxWidth = 'calc(100vw - 24px)';
        st.maxHeight = 'calc(100vh - 56px)';
        st.overflow = 'visible';
        st.color = 'inherit';
      }
      if (portal.element && typeof portal.element.addEventListener === 'function') {
        portal.element.addEventListener('click', (ev) => {
          if (ev && ev.target === portal.element) {
            closeModal();
          }
        });
      }
    }

    const mountRoot = portal.bodyEl || portal.element;
    mountSettingsCard(mountRoot, {
      embedded: useV3Overlay,
      onClose: () => closeModal(),
      initialError,
    });

    return portal;
  }

  function toggleModal() {
    if (activePortal) {
      closeModal();
      return null;
    }
    return openModal();
  }

  function start() {
    if (disposed || started) return;
    started = true;

    addTrackedListener(
      targetWin,
      'keydown',
      (ev) => {
        if (ev && (ev.key === 'Shift' || ev.shiftKey)) {
          shiftKeyDown = true;
        }
      },
      true
    );
    addTrackedListener(
      targetWin,
      'keyup',
      (ev) => {
        if (ev && (ev.key === 'Shift' || !ev.shiftKey)) {
          shiftKeyDown = false;
        }
      },
      true
    );
    addTrackedListener(
      targetWin,
      'blur',
      () => {
        shiftKeyDown = false;
        lastPointerShift = false;
      },
      false
    );
    addTrackedListener(
      targetDoc,
      'pointerdown',
      (ev) => {
        lastPointerShift = Boolean(ev && ev.shiftKey);
      },
      true
    );
    addTrackedListener(
      targetDoc,
      'mousedown',
      (ev) => {
        lastPointerShift = Boolean(ev && ev.shiftKey);
      },
      true
    );
    addTrackedListener(
      targetWin,
      'statusbar-addons-ready',
      () => {
        syncStatusbarButton();
      },
      false
    );

    if (typeof translator.subscribeStatus === 'function') {
      unsubStatus = translator.subscribeStatus((st) => {
        if (disposed) return;
        syncStatusbarButton();
        updateModalLiveHeader(st);
      });
    }

    // Tier-1 Unified Settings Page (v3) or Legacy Settings Tab (v2)
    if (v3Ctx && v3Ctx.ui && typeof v3Ctx.ui.registerSettingsPage === 'function') {
      try {
        const pageReg = v3Ctx.ui.registerSettingsPage({
          id: QUICK_SETTINGS_TAB_ID,
          title: '한국어 번역 설정',
          order: 20,
          width: 516,
          render(canvasRoot, handle) {
            if (activePortal && activePortal !== handle) {
              closeModal();
            }
            activePortal = handle;
            mountSettingsCard(canvasRoot, {
              embedded: true,
              onClose: () => {
                if (handle && typeof handle.close === 'function') {
                  handle.close();
                } else {
                  closeModal();
                }
              },
            });
          },
          onClose() {
            activePortal = null;
            activeModalHandles = null;
          },
        });
        if (pageReg) hostRegistrations.push(pageReg);
      } catch (_err) {}
    } else if (hostCapability && typeof hostCapability.registerSettingsTab === 'function') {
      try {
        const reg = hostCapability.registerSettingsTab(QUICK_SETTINGS_TAB_ID, {
          label: '한국어 번역 설정',
          onSelect: () => openModal(),
        });
        if (reg) hostRegistrations.push(reg);
      } catch (_err) {}
    }

    // Tier-1 Commands (v3) or Legacy Actions (v2)
    if (v3Ctx && v3Ctx.ui && typeof v3Ctx.ui.registerCommand === 'function') {
      try {
        const openReg = v3Ctx.ui.registerCommand(HOST_ACTION_IDS.openQuickSettings, {
          label: '한국어 번역 설정 열기',
          run: () => openModal(),
        });
        if (openReg) hostRegistrations.push(openReg);
      } catch (_err) {}
      try {
        const toggleReg = v3Ctx.ui.registerCommand(HOST_ACTION_IDS.toggleEngine, {
          label: '번역 엔진 전환 (구글 ↔ 로컬 LLM)',
          run: () => toggleEngineQuick(),
        });
        if (toggleReg) hostRegistrations.push(toggleReg);
      } catch (_err) {}
    } else if (hostCapability && typeof hostCapability.registerAction === 'function') {
      try {
        const openReg = hostCapability.registerAction(HOST_ACTION_IDS.openQuickSettings, {
          label: '한국어 번역 설정 열기',
          run: () => openModal(),
        });
        if (openReg) hostRegistrations.push(openReg);
      } catch (_err) {}
      try {
        const toggleReg = hostCapability.registerAction(HOST_ACTION_IDS.toggleEngine, {
          label: '번역 엔진 전환 (구글 ↔ 로컬 LLM)',
          run: () => toggleEngineQuick(),
        });
        if (toggleReg) hostRegistrations.push(toggleReg);
      } catch (_err) {}
    }

    if (!syncStatusbarButton()) {
      const setInt = targetWin.setInterval || setInterval;
      pollTicks = 0;
      pollTimer = setInt(() => {
        pollTicks += 1;
        if (disposed || syncStatusbarButton() || pollTicks >= 20) {
          clearPollTimer();
        }
      }, 500);
      if (pollTimer && typeof pollTimer.unref === 'function') {
        pollTimer.unref();
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    started = false;
    clearPollTimer();
    closeModal();
    if (typeof unsubStatus === 'function') {
      try {
        unsubStatus();
      } catch (_err) {}
      unsubStatus = null;
    }
    if (v3StatusItemHandle && typeof v3StatusItemHandle.dispose === 'function') {
      try {
        v3StatusItemHandle.dispose();
      } catch (_err) {}
      v3StatusItemHandle = null;
    }
    while (hostRegistrations.length > 0) {
      const reg = hostRegistrations.pop();
      try {
        if (typeof reg === 'function') {
          reg();
        } else if (reg && typeof reg.dispose === 'function') {
          reg.dispose();
        } else if (reg && typeof reg.unregister === 'function') {
          reg.unregister();
        }
      } catch (_err) {}
    }
    while (cleanupListeners.length > 0) {
      const fn = cleanupListeners.pop();
      try {
        fn();
      } catch (_err) {}
    }
    unregisterLegacyStatusbar();
  }

  return {
    start,
    dispose,
    openModal,
    closeModal,
    toggleModal,
    toggleEngineQuick,
    syncStatusbarButton,
    isModalOpen: () => Boolean(activePortal),
    getOpenModalRoot: () => (activeModalHandles ? activeModalHandles.mountRoot : null),
  };
}

module.exports = {
  STATUSBAR_ADDON_ID,
  QUICK_SETTINGS_MODAL_SLOT_ID,
  QUICK_SETTINGS_TAB_ID,
  HOST_ACTION_IDS,
  isTranslationActiveStatus,
  deriveToggleSaveState,
  computeStatusbarMeta,
  buildProbeUrl,
  createQuickSettingsUi,
};
