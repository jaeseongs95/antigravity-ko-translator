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
const { DEFAULT_LLM_CONFIG } = require('../translators/default-providers');
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
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
.ko-qs-llm-box[hidden] {
  display: none;
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
      const nextProvider = cfg.provider === 'local-llm' ? 'google-translate' : 'local-llm';
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
    ];
    for (const cp of cfg.customProviders || []) {
      if (cp && cp.id && cp.id !== 'google-translate' && cp.id !== 'local-llm') {
        engineOptions.push({ id: cp.id, name: cp.label || cp.id, desc: '사용자 지정 HTTP 번역기' });
      }
    }

    const engineButtons = new Map();
    const llmBox = targetDoc.createElement('div');

    function syncSelectedEngineUi() {
      for (const [id, btn] of engineButtons.entries()) {
        btn.setAttribute('aria-checked', id === selectedProvider ? 'true' : 'false');
      }
      llmBox.hidden = selectedProvider !== 'local-llm';
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
        };
      } else {
        let nextLlmConfig;
        try {
          nextLlmConfig = readValidatedLlmInput();
        } catch (err) {
          setFeedback(err && err.message ? err.message : '로컬 LLM 설정이 올바르지 않습니다.', 'err');
          return;
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
    retranslateBtn.addEventListener('click', () => {
      translator.retranslateNow(false);
      setFeedback('현재 화면의 Thinking 블록을 다시 번역합니다.', 'ok');
    });
    clearCacheBtn.addEventListener('click', () => {
      translator.retranslateNow(true);
      setFeedback('번역 캐시를 초기화했습니다.', 'ok');
    });

    // IME-safe Enter submit inside text inputs
    for (const inp of [urlInput, modelInput, timeoutInput]) {
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
