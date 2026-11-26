'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');

const {
  createKoTranslator,
  createQuickSettingsUi,
  STATUSBAR_ADDON_ID,
  QUICK_SETTINGS_MODAL_SLOT_ID,
  QUICK_SETTINGS_TAB_ID,
  HOST_ACTION_IDS,
} = require('../../src/index');

function createMockStatusbarApi() {
  const registered = new Map();
  const unregistered = [];
  return {
    registered,
    unregistered,
    api: {
      register(def) {
        registered.set(def.id, { ...def });
      },
      unregister(id) {
        unregistered.push(id);
        registered.delete(id);
      },
    },
  };
}

function createMockHostCapability(initialData, { allowSave = true } = {}) {
  let currentSnap = initialData;
  const listeners = new Set();
  const savedPayloads = [];
  const openedModals = [];

  const hostCapability = {
    pluginId: 'ko-thought-translator',
    trustLevel: 'trusted',
    hasSettingsBridge: true,
    getSettings: () => currentSnap,
    onSettingsChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ...(allowSave
      ? {
          async saveSettings(nextData) {
            savedPayloads.push(nextData);
            const snap = {
              status: 'ok',
              revision: savedPayloads.length + 1,
              data: JSON.parse(JSON.stringify(nextData)),
              sha256: `sha-${savedPayloads.length}`,
              reason: null,
            };
            currentSnap = snap;
            for (const cb of listeners) cb(snap);
            return { ok: true, reason: null, snapshot: snap };
          },
        }
      : {}),
    openModal(slotId, opts = {}) {
      const doc = opts._doc || globalThis.__testDoc;
      const dlg = doc.createElement('dialog');
      dlg.setAttribute('data-addon-host-modal-dialog', '1');
      dlg.setAttribute('data-addon-host-slot', slotId);
      const wrap = doc.createElement('div');
      dlg.appendChild(wrap);
      const sr = wrap.attachShadow({ mode: 'open' });
      const bodyEl = doc.createElement('div');
      bodyEl.className = 'addon-host-slot-root';
      sr.appendChild(bodyEl);
      doc.body.appendChild(dlg);
      const entry = {
        slotId,
        opts,
        closed: false,
        element: dlg,
        bodyEl,
        close() {
          if (entry.closed) return;
          entry.closed = true;
          if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
          if (typeof opts.onClose === 'function') opts.onClose();
        },
      };
      openedModals.push(entry);
      return Object.freeze({
        id: `mock-modal-${openedModals.length}`,
        element: dlg,
        bodyEl,
        close: () => entry.close(),
      });
    },
    injectStyle() {},
    removeStyle() {},
    onDispose() {},
  };

  return { hostCapability, savedPayloads, openedModals, listeners };
}

test('Statusbar button registers with live engine label, updates reactively, handles Shift+click without MouseEvent arg, and unregisters on dispose', async () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  const doc = win.document;
  globalThis.__testDoc = doc;

  const sb = createMockStatusbarApi();
  win.statusbarAddons = sb.api;

  const mockHost = createMockHostCapability({
    status: 'ok',
    revision: 1,
    data: {
      schemaVersion: 1,
      enabled: true,
      translateThinking: true,
      showThinking: true,
      translateStaticUi: true,
      provider: 'google-translate',
      llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b', apiFormat: 'ollama', timeoutMs: 15000 },
    },
  });

  const translator = createKoTranslator({
    win,
    doc,
    hostCapability: mockHost.hostCapability,
    fetchFn: async () => ({ ok: true, json: async () => [[['번역']]] }),
  });
  const ui = createQuickSettingsUi({
    win,
    doc,
    translator,
    hostCapability: mockHost.hostCapability,
    fetchFn: async () => ({ ok: true, json: async () => ({ models: [{ name: 'gemma3:4b' }] }) }),
  });

  try {
    translator.start();
    ui.start();

    const btn0 = sb.registered.get(STATUSBAR_ADDON_ID);
    assert.ok(btn0, 'Statusbar button must register immediately');
    assert.equal(btn0.label, '번역:구글');
    assert.ok(btn0.label.length <= 24);

    // Simulate real antigravity-statusbar v3.1.0 Shift+click:
    // pointerdown carries shiftKey: true, while onClick receives ONLY ({ sessionId }) with NO DOM MouseEvent!
    doc.dispatchEvent(new win.Event('pointerdown')); // false first
    const shiftDownEv = new win.KeyboardEvent('keydown', { key: 'Shift', shiftKey: true });
    win.dispatchEvent(shiftDownEv);
    btn0.onClick({ sessionId: 'sess-1' });
    await new Promise((r) => setTimeout(r, 20));
    win.dispatchEvent(new win.KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));

    assert.equal(mockHost.savedPayloads.length, 1);
    assert.equal(mockHost.savedPayloads[0].provider, 'local-llm');
    assert.equal(translator.getStatus().provider, 'local-llm');
    assert.equal(sb.registered.get(STATUSBAR_ADDON_ID).label, '번역:LLM');
    assert.equal(ui.isModalOpen(), false, 'Shift+click must toggle engine without opening modal');

    // Second Shift+click via direct MouseEvent arg switches back to google-translate
    sb.registered.get(STATUSBAR_ADDON_ID).onClick({ sessionId: 'sess-1' }, { shiftKey: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mockHost.savedPayloads.length, 2);
    assert.equal(mockHost.savedPayloads[1].provider, 'google-translate');
    assert.equal(sb.registered.get(STATUSBAR_ADDON_ID).label, '번역:구글');
  } finally {
    ui.dispose();
    translator.dispose();
    assert.deepEqual(sb.unregistered, [STATUSBAR_ADDON_ID], 'dispose() must unregister statusbar button');
    delete globalThis.__testDoc;
    win.happyDOM.close();
  }
});

test('Quick Settings Shadow DOM modal opens via addonHost.openModal, validates SSRF URLs, tests Ollama connection, saves via addonHost.saveSettings, and supports Retranslate/Clear Cache', async () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  const doc = win.document;
  globalThis.__testDoc = doc;

  const sb = createMockStatusbarApi();
  win.statusbarAddons = sb.api;

  const mockHost = createMockHostCapability({
    status: 'ok',
    revision: 1,
    data: {
      schemaVersion: 1,
      enabled: true,
      translateThinking: true,
      showThinking: true,
      translateStaticUi: true,
      provider: 'google-translate',
      llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b', apiFormat: 'ollama', timeoutMs: 15000 },
    },
  });

  const probedUrls = [];
  const fetchFn = async (url) => {
    probedUrls.push(String(url));
    return { ok: true, json: async () => ({ models: [{ name: 'gemma3:4b' }, { name: 'qwen3:8b' }] }) };
  };

  const translator = createKoTranslator({
    win,
    doc,
    hostCapability: mockHost.hostCapability,
    fetchFn,
  });
  const ui = createQuickSettingsUi({
    win,
    doc,
    translator,
    hostCapability: mockHost.hostCapability,
    fetchFn,
  });

  try {
    translator.start();
    ui.start();

    // Normal click opens Shadow DOM modal via addonHost.openModal
    sb.registered.get(STATUSBAR_ADDON_ID).onClick({ sessionId: 'sess-1' });
    assert.equal(ui.isModalOpen(), true);
    assert.equal(mockHost.openedModals.length, 1);
    assert.equal(mockHost.openedModals[0].slotId, QUICK_SETTINGS_MODAL_SLOT_ID);
    assert.equal(mockHost.openedModals[0].opts.shadow, true);
    const dlgEl = mockHost.openedModals[0].element;
    assert.equal(dlgEl.style.position, 'fixed');
    assert.equal(dlgEl.style.margin, 'auto');
    assert.equal(dlgEl.style.marginTop, 'auto');
    assert.ok(
      dlgEl.style.top === '36px' || dlgEl.style.top === 'max(env(titlebar-area-height, 36px), 36px)',
      `expected titlebar-safe top inset, got ${dlgEl.style.top}`
    );
    assert.equal(dlgEl.style.width, 'fit-content');
    assert.equal(dlgEl.style.height, 'fit-content');

    const root = ui.getOpenModalRoot();
    assert.ok(root);

    // Switch to Local LLM -> LLM config panel becomes visible
    const llmSection = root.querySelector('[data-testid="ko-qs-llm-section"]');
    assert.equal(llmSection.hidden, true);
    root.querySelector('[data-testid="ko-qs-engine-local-llm"]').click();
    assert.equal(llmSection.hidden, false);

    // Invalid remote HTTP URL MUST be rejected inline without saving
    const urlInput = root.querySelector('[data-testid="ko-qs-llm-url"]');
    urlInput.value = 'http://169.254.169.254/latest/meta-data';
    root.querySelector('[data-testid="ko-qs-save"]').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mockHost.savedPayloads.length, 0, 'Forbidden SSRF URL must never be saved');
    assert.equal(ui.isModalOpen(), true, 'Modal must stay open on validation error');
    assert.equal(root.querySelector('[data-testid="ko-qs-feedback"]').getAttribute('data-kind'), 'err');

    // Valid loopback Ollama URL + connection test
    urlInput.value = 'http://127.0.0.1:11434';
    root.querySelector('[data-testid="ko-qs-llm-model"]').value = 'qwen3:8b';
    root.querySelector('[data-testid="ko-qs-llm-test"]').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(probedUrls.includes('http://127.0.0.1:11434/api/tags'), true);
    assert.match(root.querySelector('[data-testid="ko-qs-llm-test-result"]').textContent, /연결 성공.*2개/);

    // Retranslate Now & Clear Cache actions work cleanly
    root.querySelector('[data-testid="ko-qs-retranslate"]').click();
    assert.match(root.querySelector('[data-testid="ko-qs-feedback"]').textContent, /다시 번역/);
    root.querySelector('[data-testid="ko-qs-clear-cache"]').click();
    assert.match(root.querySelector('[data-testid="ko-qs-feedback"]').textContent, /캐시/);

    // Save & Apply persists via addonHost.saveSettings and closes modal
    root.querySelector('[data-testid="ko-qs-opt-show-thinking"]').checked = false;
    root.querySelector('[data-testid="ko-qs-save"]').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mockHost.savedPayloads.length, 1);
    assert.equal(mockHost.savedPayloads[0].provider, 'local-llm');
    assert.equal(mockHost.savedPayloads[0].llmConfig.model, 'qwen3:8b');
    assert.equal(mockHost.savedPayloads[0].showThinking, false);
    assert.equal(ui.isModalOpen(), false);
    assert.equal(sb.registered.get(STATUSBAR_ADDON_ID).label, '번역:LLM');
  } finally {
    ui.dispose();
    translator.dispose();
    delete globalThis.__testDoc;
    win.happyDOM.close();
  }
});

test('Quick Settings modal handles delayed statusbar-addons-ready event and corrupted settings recovery', async () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  const doc = win.document;
  globalThis.__testDoc = doc;

  const mockHost = createMockHostCapability({
    status: 'error',
    revision: 1,
    data: null,
    reason: 'ERR_SETTINGS_INVALID_JSON',
  });

  const translator = createKoTranslator({
    win,
    doc,
    hostCapability: mockHost.hostCapability,
    fetchFn: async () => ({ ok: true, json: async () => [[['번역']]] }),
  });
  const ui = createQuickSettingsUi({
    win,
    doc,
    translator,
    hostCapability: mockHost.hostCapability,
  });

  try {
    translator.start();
    ui.start();

    // Statusbar attaches AFTER plugin starts and emits statusbar-addons-ready
    const sb = createMockStatusbarApi();
    win.statusbarAddons = sb.api;
    win.dispatchEvent(new win.Event('statusbar-addons-ready'));
    assert.ok(sb.registered.get(STATUSBAR_ADDON_ID), 'Button must register when statusbar-addons-ready fires');
    assert.equal(sb.registered.get(STATUSBAR_ADDON_ID).label, '번역:꺼짐');

    // Open modal -> corrupted banner visible -> click recover
    ui.openModal();
    const root = ui.getOpenModalRoot();
    assert.equal(root.querySelector('[data-testid="ko-qs-corrupt-banner"]').hidden, false);
    root.querySelector('[data-testid="ko-qs-recover"]').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mockHost.savedPayloads.length, 1);
    assert.equal(mockHost.savedPayloads[0].enabled, true);
    assert.equal(mockHost.savedPayloads[0].provider, 'google-translate');
    assert.equal(sb.registered.get(STATUSBAR_ADDON_ID).label, '번역:구글');
  } finally {
    ui.dispose();
    translator.dispose();
    delete globalThis.__testDoc;
    win.happyDOM.close();
  }
});

test('Host v2.3.0 Remote Web integration: registers host settings tab & actions when statusbar is absent, opens modal / toggles engine, and cleans up on dispose', async () => {
  const win = new Window({ url: 'https://antigravity.google.com/r/session-1' });
  const doc = win.document;
  globalThis.__testDoc = doc;

  const mockHost = createMockHostCapability(null);
  const registeredTabs = new Map();
  const registeredActions = new Map();
  let tabUnregistered = 0;
  let actionsUnregistered = 0;

  const remoteHostCapability = {
    ...mockHost.hostCapability,
    hostProfileId: 'antigravity-remote-web',
    registerSettingsTab(tabId, opts) {
      registeredTabs.set(tabId, opts);
      return {
        unregister() {
          tabUnregistered += 1;
          registeredTabs.delete(tabId);
        },
      };
    },
    registerAction(actionId, spec) {
      registeredActions.set(actionId, spec);
      return {
        unregister() {
          actionsUnregistered += 1;
          registeredActions.delete(actionId);
        },
      };
    },
  };

  const translator = createKoTranslator({
    win,
    doc,
    hostCapability: remoteHostCapability,
    fetchFn: async () => ({ ok: true, json: async () => [[['원격 번역']]] }),
  });
  const ui = createQuickSettingsUi({
    win,
    doc,
    translator,
    hostCapability: remoteHostCapability,
  });

  try {
    // No window.statusbarAddons present (Remote Web without statusbar plugin)
    translator.start();
    ui.start();

    assert.equal(translator.getStatus().enabled, true);
    assert.equal(translator.getStatus().provider, 'google-translate');
    assert.equal(registeredTabs.has(QUICK_SETTINGS_TAB_ID), true, 'Must register host settings tab');
    assert.equal(registeredActions.has(HOST_ACTION_IDS.openQuickSettings), true, 'Must register open-quick-settings action');
    assert.equal(registeredActions.has(HOST_ACTION_IDS.toggleEngine), true, 'Must register toggle-engine action');

    // Open Quick Settings Modal via registered Settings Tab onSelect
    registeredTabs.get(QUICK_SETTINGS_TAB_ID).onSelect();
    assert.equal(ui.isModalOpen(), true, 'Settings tab onSelect must open Quick Settings modal');
    ui.closeModal();
    assert.equal(ui.isModalOpen(), false);

    // Open Quick Settings Modal via registered Host Action
    registeredActions.get(HOST_ACTION_IDS.openQuickSettings).run();
    assert.equal(ui.isModalOpen(), true, 'open-quick-settings action must open Quick Settings modal');
    ui.closeModal();

    // Toggle translation engine via registered Host Action
    await registeredActions.get(HOST_ACTION_IDS.toggleEngine).run();
    assert.equal(mockHost.savedPayloads.length, 1);
    assert.equal(mockHost.savedPayloads[0].provider, 'local-llm');
    assert.equal(translator.getStatus().provider, 'local-llm');
  } finally {
    ui.dispose();
    translator.dispose();
    assert.equal(tabUnregistered, 1, 'dispose() must unregister host settings tab');
    assert.equal(actionsUnregistered, 2, 'dispose() must unregister both host actions');
    assert.equal(registeredTabs.size, 0);
    assert.equal(registeredActions.size, 0);
    delete globalThis.__testDoc;
    win.happyDOM.close();
  }
});

test('v3.0.0 UX redesign: merges checkbox #1 & #4 into 1 clear slide ON/OFF switch, converts all toggles to role=switch sliders, and derives enabled accurately', async () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  const doc = win.document;
  globalThis.__testDoc = doc;

  const sb = createMockStatusbarApi();
  win.statusbarAddons = sb.api;

  // Start with the user's real live settings: UI localization ON, Thinking translation OFF, Thinking block hidden
  const mockHost = createMockHostCapability({
    status: 'ok',
    revision: 1,
    data: {
      schemaVersion: 1,
      enabled: true,
      translateThinking: false,
      showThinking: false,
      translateStaticUi: true,
      provider: 'google-translate',
      llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b', apiFormat: 'ollama', timeoutMs: 15000 },
    },
  });

  const translator = createKoTranslator({
    win,
    doc,
    hostCapability: mockHost.hostCapability,
    fetchFn: async () => ({ ok: true, json: async () => [[['번역']]] }),
  });
  const ui = createQuickSettingsUi({
    win,
    doc,
    translator,
    hostCapability: mockHost.hostCapability,
  });

  try {
    translator.start();
    ui.start();
    ui.openModal();

    const root = ui.getOpenModalRoot();
    assert.ok(root);

    // 1. Old duplicate #1 checkbox ('ko-qs-opt-enabled') MUST NOT exist; legacy .ko-qs-checkbox MUST be 0
    assert.equal(root.querySelector('[data-testid="ko-qs-opt-enabled"]'), null);
    assert.equal(root.querySelectorAll('.ko-qs-checkbox').length, 0, 'Zero legacy checkboxes allowed');

    // 2. Exactly 3 main option switches + 1 LLM remote switch, ALL using role="switch" + slide track/thumb
    const mainToggles = root.querySelector('[data-testid="ko-qs-toggles"]');
    const mainSwitches = mainToggles.querySelectorAll('input[role="switch"]');
    assert.equal(mainSwitches.length, 3, 'Main options must have exactly 3 merged slide ON/OFF switches');
    assert.equal(root.querySelectorAll('input[role="switch"]').length, 4, 'All 4 toggles (3 main + 1 LLM remote) must be slide switches');
    assert.equal(root.querySelectorAll('.ko-qs-switch-track .ko-qs-switch-thumb').length, 4);

    const staticSwitch = root.querySelector('[data-testid="ko-qs-opt-static-ui"]');
    const thinkingSwitch = root.querySelector('[data-testid="ko-qs-opt-thinking"]');
    const showThinkingSwitch = root.querySelector('[data-testid="ko-qs-opt-show-thinking"]');

    assert.equal(staticSwitch.getAttribute('data-merged-enabled'), 'true');
    assert.equal(staticSwitch.checked, true);
    assert.equal(staticSwitch.getAttribute('aria-checked'), 'true');
    assert.equal(thinkingSwitch.checked, false);
    assert.equal(thinkingSwitch.getAttribute('aria-checked'), 'false');
    assert.equal(showThinkingSwitch.checked, false);
    assert.equal(showThinkingSwitch.getAttribute('aria-checked'), 'false');

    // 3. Turn OFF merged UI localization switch while Thinking block stays hidden ->
    //    saves translateStaticUi:false, translateThinking:false, showThinking:false, enabled:true (so hiding still works!)
    //    AND statusbar truthfully shows 번역:꺼짐!
    staticSwitch.checked = false;
    staticSwitch.dispatchEvent(new win.Event('change'));
    assert.equal(staticSwitch.getAttribute('aria-checked'), 'false');
    root.querySelector('[data-testid="ko-qs-save"]').click();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(mockHost.savedPayloads.length, 1);
    assert.equal(mockHost.savedPayloads[0].translateStaticUi, false);
    assert.equal(mockHost.savedPayloads[0].translateThinking, false);
    assert.equal(mockHost.savedPayloads[0].showThinking, false);
    assert.equal(mockHost.savedPayloads[0].enabled, true, 'Keep runtime active to honor showThinking:false');
    assert.equal(sb.registered.get(STATUSBAR_ADDON_ID).label, '번역:꺼짐', 'Statusbar must show 번역:꺼짐 when both translation switches are OFF');

    // 4. Reopen modal -> badge shows 번역 꺼짐 -> turn showThinking ON -> now ALL features are idle -> enabled becomes false!
    ui.openModal();
    const root2 = ui.getOpenModalRoot();
    assert.equal(root2.querySelector('[data-testid="ko-qs-status-badge"]').textContent, '번역 꺼짐');
    const showSwitch2 = root2.querySelector('[data-testid="ko-qs-opt-show-thinking"]');
    showSwitch2.checked = true;
    showSwitch2.dispatchEvent(new win.Event('change'));
    root2.querySelector('[data-testid="ko-qs-save"]').click();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(mockHost.savedPayloads.length, 2);
    assert.equal(mockHost.savedPayloads[1].enabled, false, 'Runtime must idle (enabled:false) when all localization is OFF and Thinking is shown');
    assert.equal(sb.registered.get(STATUSBAR_ADDON_ID).label, '번역:꺼짐');
  } finally {
    ui.dispose();
    translator.dispose();
    delete globalThis.__testDoc;
    win.happyDOM.close();
  }
});
