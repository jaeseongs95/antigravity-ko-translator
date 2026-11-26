'use strict';

/**
 * AddonManifest.v3 & AddonContextV3 Desktop + Remote Web Parity Tests (v3.0.0).
 *
 * Uses the real `antigravity-addons` v3.0.0 manifest validator and `@antigravity-addons/sdk`
 * `createTestHost({ surface: 'desktop' | 'remote-web' })` when the sibling host repo is present,
 * and also runs standalone AddonContextV3 contract tests so CI stays 100% green in isolated repos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Window } = require('happy-dom');

const {
  createKoTranslator,
  createQuickSettingsUi,
  createHostCapabilityAdapter,
  createHostAwareFetch,
  mountIfBrowser,
  STATUSBAR_ADDON_ID,
  QUICK_SETTINGS_TAB_ID,
  HOST_ACTION_IDS,
} = require('../../src/index');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_V3_PATH = path.join(REPO_ROOT, 'addon-manifest.v3.json');
const SIBLING_ADDONS_ROOT = path.resolve(REPO_ROOT, '..', 'antigravity-addons');
const SDK_TEST_HOST_PATH = path.join(SIBLING_ADDONS_ROOT, 'packages', 'sdk', 'src', 'test-host.js');
const HOST_VALIDATOR_PATH = path.join(SIBLING_ADDONS_ROOT, 'src', 'core', 'manifest-validator.js');

const HAS_SIBLING_HOST = fs.existsSync(SDK_TEST_HOST_PATH) && fs.existsSync(HOST_VALIDATOR_PATH);

function createMockV3Context(doc, win, { surface = 'desktop', hasStatusbarService = false, netCalls = [] } = {}) {
  const storageMap = new Map();
  const storageListeners = new Set();
  const statusItems = new Map();
  const settingsPages = new Map();
  const commands = new Map();
  const injectedStyles = new Map();
  const disposers = [];
  const openedModals = [];

  const ctx = Object.freeze({
    apiVersion: 3,
    meta: Object.freeze({
      pluginId: 'ko-thought-translator',
      displayName: 'Antigravity Korean Thought & UI Translator',
      version: '3.0.0',
      trustLevel: 'trusted',
      sourceSchemaVersion: 3,
    }),
    env: Object.freeze({
      surface,
      layoutMode: 'desktop',
      capabilities: Object.freeze({
        hasNetHttps: true,
        hasLocalLoopback: surface === 'desktop',
        hasConfigBridge: false,
        hasSettingsBridge: true,
        hasDocumentTransform: true,
      }),
    }),
    theme: Object.freeze({
      getMode: () => 'dark',
      getTokens: () => Object.freeze({ '--ag-surface': '#1a1e26', '--ag-accent': '#3d7eff' }),
      getTokenCss: () => ':host { --ag-surface: #1a1e26; --ag-accent: #3d7eff; }',
      onDidChange: () => () => {},
    }),
    i18n: Object.freeze({
      getLocale: () => 'ko',
      t: (k) => k,
    }),
    ui: Object.freeze({
      registerStatusItem(spec) {
        const rec = { ...spec };
        statusItems.set(spec.id, rec);
        return Object.freeze({
          id: spec.id,
          update(patch) {
            Object.assign(rec, patch);
          },
          dispose() {
            statusItems.delete(spec.id);
          },
        });
      },
      registerSettingsPage(spec) {
        settingsPages.set(spec.id, spec);
        return Object.freeze({
          id: spec.id,
          open() {
            const dlg = doc.createElement('dialog');
            const bodyEl = doc.createElement('div');
            dlg.appendChild(bodyEl);
            doc.body.appendChild(dlg);
            const handle = {
              element: dlg,
              bodyEl,
              close() {
                if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
                if (typeof spec.onClose === 'function') spec.onClose();
              },
            };
            spec.render(bodyEl, handle);
            return handle;
          },
          dispose() {
            settingsPages.delete(spec.id);
          },
        });
      },
      registerCommand(commandId, spec) {
        commands.set(commandId, spec);
        return Object.freeze({
          unregister() {
            commands.delete(commandId);
          },
          dispose() {
            commands.delete(commandId);
          },
        });
      },
      openModal(opts = {}) {
        const dlg = doc.createElement('dialog');
        dlg.setAttribute('data-addon-host-v3-overlay', 'modal');
        const bodyEl = doc.createElement('div');
        dlg.appendChild(bodyEl);
        doc.body.appendChild(dlg);
        let closed = false;
        const rec = Object.freeze({
          opts,
          element: dlg,
          bodyEl,
          get closed() {
            return closed;
          },
          close() {
            if (closed) return;
            closed = true;
            if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
            if (typeof opts.onClose === 'function') opts.onClose();
          },
        });
        openedModals.push(rec);
        return rec;
      },
      injectStyle(styleId, cssText) {
        injectedStyles.set(styleId, cssText);
      },
      removeStyle(styleId) {
        return injectedStyles.delete(styleId);
      },
    }),
    storage: Object.freeze({
      async get(k) {
        return storageMap.has(k) ? JSON.parse(JSON.stringify(storageMap.get(k))) : undefined;
      },
      async set(k, v) {
        const oldValue = storageMap.get(k);
        const cloned = JSON.parse(JSON.stringify(v));
        storageMap.set(k, cloned);
        for (const cb of storageListeners) cb({ key: k, oldValue, newValue: cloned });
        return true;
      },
      async delete(k) {
        return storageMap.delete(k);
      },
      async keys() {
        return Array.from(storageMap.keys());
      },
      async clear() {
        storageMap.clear();
      },
      onDidChange(cb) {
        storageListeners.add(cb);
        return () => storageListeners.delete(cb);
      },
    }),
    services: Object.freeze({
      has: (name) => hasStatusbarService && name === 'host.statusbar',
      list: () => [],
      provide: () => ({ dispose() {} }),
      call: () => null,
    }),
    dom: Object.freeze({
      isElementInsideIgnored(el) {
        return Boolean(el && typeof el.closest === 'function' && el.closest('[data-v3-ignored="true"]'));
      },
    }),
    net: Object.freeze({
      async fetch(url, init) {
        netCalls.push({ url: String(url), init });
        if (String(url).includes('translate.googleapis.com')) {
          return { ok: true, status: 200, statusText: 'OK', bodyText: JSON.stringify([[['v3 네트워크 번역']]]) };
        }
        return { ok: true, status: 200, statusText: 'OK', bodyText: JSON.stringify({ models: [{ name: 'gemma3:4b' }] }) };
      },
    }),
    lifecycle: Object.freeze({
      signal: null,
      onDispose(fn) {
        disposers.push(fn);
      },
      dispose() {
        while (disposers.length > 0) {
          const fn = disposers.pop();
          fn();
        }
      },
    }),
  });

  return { ctx, storageMap, statusItems, settingsPages, commands, injectedStyles, openedModals, disposers };
}

test('AddonContextV3 full lifecycle (Desktop & Remote Web): Tier-1 statusItem/settingsPage/commands, Tier-2/3 embedded modal, dual-key net.fetch, storage persistence, and zero leaks on dispose', async () => {
  for (const surface of ['desktop', 'remote-web']) {
    const win = new Window({ url: surface === 'desktop' ? 'http://127.0.0.1:4242/' : 'https://antigravity.google.com/r/s1' });
    const doc = win.document;

    const uiBtn = doc.createElement('button');
    uiBtn.textContent = 'Settings';
    const ignoredEl = doc.createElement('div');
    ignoredEl.setAttribute('data-v3-ignored', 'true');
    const ignoredBtn = doc.createElement('button');
    ignoredBtn.textContent = 'Settings';
    ignoredEl.appendChild(ignoredBtn);
    doc.body.appendChild(uiBtn);
    doc.body.appendChild(ignoredEl);

    const netCalls = [];
    const mock = createMockV3Context(doc, win, { surface, hasStatusbarService: surface === 'desktop', netCalls });

    const inst = mountIfBrowser(win, mock.ctx);
    assert.ok(inst, `mountIfBrowser must mount cleanly on ${surface}`);

    try {
      // Zero globals leaked onto shared World 998 window
      assert.equal(win.__agyKoTranslator, undefined);
      assert.equal(win.__agyCreateKoTranslator, undefined);

      // Static UI localized while v3 dom.isElementInsideIgnored subtree is untouched
      assert.equal(uiBtn.textContent, '설정');
      assert.equal(ignoredBtn.textContent, 'Settings');

      // Tier-1 registrations
      assert.equal(mock.statusItems.has(STATUSBAR_ADDON_ID), true);
      assert.equal(mock.statusItems.get(STATUSBAR_ADDON_ID).label, '번역:구글');
      assert.equal(mock.settingsPages.has(QUICK_SETTINGS_TAB_ID), true);
      assert.equal(mock.commands.has(HOST_ACTION_IDS.openQuickSettings), true);
      assert.equal(mock.commands.has(HOST_ACTION_IDS.toggleEngine), true);

      // Open modal via Tier-1 statusItem click -> uses v3 ui.openModal in embedded mode (no duplicate header!)
      mock.statusItems.get(STATUSBAR_ADDON_ID).onClick({ shiftKey: false });
      assert.equal(mock.openedModals.length, 1);
      assert.equal(mock.openedModals[0].opts.title, '한국어 번역 설정');
      const card = mock.openedModals[0].bodyEl.querySelector('[data-testid="ko-qs-card"]');
      assert.ok(card);
      assert.equal(card.getAttribute('data-embedded'), 'true');
      assert.equal(card.querySelector('.ko-qs-header'), null, 'Embedded v3 modal must not render duplicate header');
      assert.equal(card.querySelectorAll('input[role="switch"]').length, 4);

      // Toggle UI localization OFF & Save -> persists via ctx.storage, restores UI text, updates status item label
      const staticSwitch = card.querySelector('[data-testid="ko-qs-opt-static-ui"]');
      const thinkingSwitch = card.querySelector('[data-testid="ko-qs-opt-thinking"]');
      staticSwitch.checked = false;
      thinkingSwitch.checked = false;
      card.querySelector('[data-testid="ko-qs-save"]').click();
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(mock.openedModals[0].closed, true);
      assert.equal(uiBtn.textContent, 'Settings', 'Disabling merged UI switch must restore original English UI');
      assert.equal(mock.statusItems.get(STATUSBAR_ADDON_ID).label, '번역:꺼짐');
      const savedInStorage = await mock.ctx.storage.get('ko_translator_settings_v1');
      assert.equal(savedInStorage.translateStaticUi, false);
      assert.equal(savedInStorage.enabled, false);

      // Shift+click on v3 statusItem wakes translation & switches engine to local-llm
      mock.statusItems.get(STATUSBAR_ADDON_ID).onClick({ shiftKey: true });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(mock.statusItems.get(STATUSBAR_ADDON_ID).label, '번역:LLM');
      assert.equal(uiBtn.textContent, '설정');

      // Dual-key net.fetch routing verification
      const fallbackCalls = [];
      const hostFetch = createHostAwareFetch({
        hostCapability: createHostCapabilityAdapter(mock.ctx),
        fallbackFetch: async (u) => {
          fallbackCalls.push(String(u));
          return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' };
        },
      });
      const gRes = await hostFetch('https://translate.googleapis.com/translate_a/single?q=hi');
      assert.equal(gRes.ok, true);
      assert.deepEqual(await gRes.json(), [[['v3 네트워크 번역']]]);
      assert.equal(netCalls.some((c) => c.url.includes('translate.googleapis.com')), true);

      const llmRes = await hostFetch('http://127.0.0.1:11434/api/tags');
      assert.equal(llmRes.ok, true);
      if (surface === 'desktop') {
        assert.equal(netCalls.some((c) => c.url.includes('127.0.0.1:11434')), true, 'Desktop loopback:11434 must route via ctx.net.fetch');
      } else {
        assert.equal(fallbackCalls.some((u) => u.includes('127.0.0.1:11434')), true, 'Remote Web hasLocalLoopback=false must not invoke ctx.net.fetch for loopback');
      }
    } finally {
      mock.ctx.lifecycle.dispose();
      assert.equal(mock.statusItems.size, 0, 'dispose must clean up status items');
      assert.equal(mock.settingsPages.size, 0, 'dispose must clean up settings pages');
      assert.equal(mock.commands.size, 0, 'dispose must clean up commands');
      assert.equal(mock.injectedStyles.size, 0, 'dispose must remove injected styles');
      assert.equal(uiBtn.textContent, 'Settings', 'dispose must restore DOM');
      win.happyDOM.close();
    }
  }
});

test(
  'Real antigravity-addons v3.0.0 validator + @antigravity-addons/sdk createTestHost Desktop & Remote Web parity',
  { skip: HAS_SIBLING_HOST ? false : 'Sibling antigravity-addons repo not present in CI' },
  async () => {
    const { validateAddonManifest } = require(HOST_VALIDATOR_PATH);
    const { createTestHost } = require(SDK_TEST_HOST_PATH);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_V3_PATH, 'utf8'));

    // 1. Validate real addon-manifest.v3.json against antigravity-addons v3.0.0 schema validator
    for (const profile of ['antigravity-desktop', 'antigravity-remote-web']) {
      const res = validateAddonManifest(manifest, {
        hostProfileId: profile,
        hostVersion: '3.0.0',
        checkFilesExist: false,
      });
      assert.equal(res.ok, true, `Manifest must validate on ${profile}: ${JSON.stringify(res)}`);
      assert.equal(res.sourceSchemaVersion, 3);
      assert.equal(res.trustLevel, 'trusted');
      assert.equal(res.hasDocumentTransformSlot, true);
      assert.equal(res.hasSettingsBridge, true);
    }

    // 2. Boot real antigravity-addons renderer kernel via SDK createTestHost on BOTH Desktop & Remote Web
    for (const surface of ['desktop', 'remote-web']) {
      const netSeen = [];
      const host = createTestHost({
        surface,
        netHandler: (_pid, url) => {
          netSeen.push(String(url));
          return { ok: true, status: 200, statusText: 'OK', bodyText: JSON.stringify([[['SDK 테스트 번역']]]) };
        },
      });

      const ctx = await host.mountPlugin(manifest, (v3Ctx) => {
        assert.equal(v3Ctx.apiVersion, 3);
        assert.equal(v3Ctx.env.surface, surface);
        assert.equal(v3Ctx.env.capabilities.hasNetHttps, true);
        assert.equal(v3Ctx.env.capabilities.hasLocalLoopback, surface === 'desktop');
        assert.equal(v3Ctx.env.capabilities.hasDocumentTransform, true);

        const adapted = createHostCapabilityAdapter(v3Ctx);
        const translator = createKoTranslator({
          win: host.win,
          doc: host.doc,
          hostCapability: adapted,
        });
        const ui = createQuickSettingsUi({
          win: host.win,
          doc: host.doc,
          translator,
          hostCapability: adapted,
        });
        v3Ctx.lifecycle.onDispose(() => {
          ui.dispose();
          translator.dispose();
        });
        translator.start();
        ui.start();
      });

      assert.ok(ctx);
      const statusItems = host.getStatusItems();
      assert.equal(statusItems.length, 1);
      assert.equal(statusItems[0].pluginId, 'ko-thought-translator');
      assert.equal(statusItems[0].id, STATUSBAR_ADDON_ID);
      assert.equal(statusItems[0].label, '번역:구글');

      const pages = host.getSettingsPages();
      assert.equal(pages.length, 1);
      assert.equal(pages[0].pluginId, 'ko-thought-translator');
      assert.equal(pages[0].id, QUICK_SETTINGS_TAB_ID);

      // Verify net.fetch works through real SDK kernel on both Desktop & Remote Web
      const hostFetch = createHostAwareFetch({ hostCapability: createHostCapabilityAdapter(ctx) });
      const res = await hostFetch('https://translate.googleapis.com/translate_a/single?q=hello');
      assert.equal(res.ok, true);
      assert.deepEqual(await res.json(), [[['SDK 테스트 번역']]]);
      assert.equal(netSeen.length, 1);

      // Dispose plugin via real kernel -> all items & pages cleanly removed
      assert.equal(host.disposePlugin('ko-thought-translator'), true);
      assert.equal(host.getStatusItems().length, 0);
      assert.equal(host.getSettingsPages().length, 0);
    }
  }
);
