'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Window } = require('happy-dom');

const {
  CLOUD_API_PRESETS,
  DEFAULT_CLOUD_API_CONFIG,
  getCloudSecretKeyForPreset,
  validateCloudApiConfig,
  buildCloudApiRequest,
  extractCloudApiResponseText,
  probeCloudApiConnection,
  createCloudApiAdapter,
} = require('../../src/adapters/translators/cloud-api');
const {
  createKoTranslator,
  createQuickSettingsUi,
  createHostCapabilityAdapter,
  createHostAwareFetch,
  mountIfBrowser,
  STATUSBAR_ADDON_ID,
} = require('../../src/index');
const {
  saveTranslatorSettings,
  readTranslatorSettings,
  sanitizeCloudApiConfig,
} = require('../../host/config-store');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_V3_PATH = path.join(REPO_ROOT, 'addon-manifest.v3.json');
const EXTENRA_SDK_PATH = path.resolve(REPO_ROOT, '..', 'extenra', 'packages', 'sdk', 'src', 'test-host.js');
const HAS_EXTENRA_SDK = fs.existsSync(EXTENRA_SDK_PATH);

test('cloud-api validates HTTPS-only non-loopback endpoints and rejects SSRF / secret query / bad model', () => {
  const ok = validateCloudApiConfig({
    preset: 'anthropic',
    baseUrl: 'https://api.anthropic.com/',
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 25000,
  });
  assert.equal(ok.preset, 'anthropic');
  assert.equal(ok.protocol, 'anthropic');
  assert.equal(ok.baseUrl, 'https://api.anthropic.com');
  assert.equal(ok.secretKey, 'cloud_api_key_anthropic');

  assert.throws(() => validateCloudApiConfig({ preset: 'openai', baseUrl: 'http://127.0.0.1:11434' }));
  assert.throws(() => validateCloudApiConfig({ preset: 'openai', baseUrl: 'https://127.0.0.1:8443' }));
  assert.throws(() => validateCloudApiConfig({ preset: 'openai', baseUrl: 'https://169.254.169.254/latest' }));
  assert.throws(() =>
    validateCloudApiConfig({ preset: 'openai', baseUrl: 'https://api.openai.com/v1?api_key=sk-leak' })
  );
  assert.throws(() =>
    validateCloudApiConfig({ preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: '../evil' })
  );
});

test('cloud-api builds protocol-accurate requests and parses responses for OpenAI, Anthropic, Gemini, and OpenAI-compat', async () => {
  const seen = [];
  const makeFetch = (bodyFactory) => async (url, init) => {
    seen.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return bodyFactory(url, init);
      },
    };
  };

  // 1. OpenAI
  let currentCfg = { ...DEFAULT_CLOUD_API_CONFIG };
  const openaiAdapter = createCloudApiAdapter({
    cloudApiConfigPort: { getCloudApiConfig: () => currentCfg },
    fetchFn: makeFetch(() => ({
      choices: [{ message: { content: '⟦C0⟧ 파일을 확인합니다.' } }],
    })),
  });
  const outOpenAi = await openaiAdapter.translate('Check ⟦C0⟧ file.');
  assert.equal(outOpenAi, '⟦C0⟧ 파일을 확인합니다.');
  assert.equal(seen[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.deepEqual(seen[0].init.secretHeaders, {
    Authorization: { secretKey: 'cloud_api_key_openai', prefix: 'Bearer ' },
  });
  assert.equal(seen[0].init.headers.Authorization, undefined);

  // 2. Anthropic (Claude)
  currentCfg = {
    preset: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5-20251001',
    timeoutMs: 20000,
  };
  const anthropicAdapter = createCloudApiAdapter({
    cloudApiConfigPort: { getCloudApiConfig: () => currentCfg },
    fetchFn: makeFetch(() => ({
      content: [{ type: 'text', text: '⟦C0⟧ 테스트를 실행합니다.' }],
    })),
  });
  const outAnthropic = await anthropicAdapter.translate('Run ⟦C0⟧ test.');
  assert.equal(outAnthropic, '⟦C0⟧ 테스트를 실행합니다.');
  assert.equal(seen[1].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[1].init.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(seen[1].init.secretHeaders, {
    'x-api-key': { secretKey: 'cloud_api_key_anthropic' },
  });

  // 3. Google Gemini
  currentCfg = {
    preset: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    timeoutMs: 20000,
  };
  const geminiAdapter = createCloudApiAdapter({
    cloudApiConfigPort: { getCloudApiConfig: () => currentCfg },
    fetchFn: makeFetch(() => ({
      candidates: [{ content: { parts: [{ text: '⟦T0⟧ 결과를 검토합니다.' }] } }],
    })),
  });
  const outGemini = await geminiAdapter.translate('Review ⟦T0⟧ output.', {
    cleanText: 'Review `build.js` output.',
    savedTokens: ['`build.js`'],
  });
  assert.equal(outGemini, '⟦T0⟧ 결과를 검토합니다.');
  assert.equal(
    seen[2].url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
  );
  assert.deepEqual(seen[2].init.secretHeaders, {
    'x-goog-api-key': { secretKey: 'cloud_api_key_gemini' },
  });

  // 4. OpenAI-compatible (OpenRouter)
  const compatReq = buildCloudApiRequest(
    validateCloudApiConfig({
      preset: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
    }),
    'Hello'
  );
  assert.equal(compatReq.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(compatReq.secretHeaders, {
    Authorization: { secretKey: 'cloud_api_key_openai_compat', prefix: 'Bearer ' },
  });
  assert.equal(
    extractCloudApiResponseText('openai', { choices: [{ message: { content: [{ type: 'text', text: '안녕' }] } }] }),
    '안녕'
  );
});

test('config-store rejects plaintext apiKey/secret fields in cloudApiConfig and persists safe metadata only', () => {
  assert.throws(
    () => sanitizeCloudApiConfig({ preset: 'openai', apiKey: 'sk-plain-leak' }, DEFAULT_CLOUD_API_CONFIG, { strict: true }),
    /FORBIDDEN_SECRET_FIELD_IN_CLOUD_API_CONFIG/
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-cloud-cfg-'));
  try {
    const overrides = {
      SETTINGS_PATH: path.join(dir, 'ko_translator_settings.json'),
      SETTINGS_LOCK_PATH: path.join(dir, 'ko_translator_settings.lock'),
    };
    const saved = saveTranslatorSettings(
      {
        provider: 'claude',
        cloudApiConfig: {
          preset: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5-20250929',
          timeoutMs: 30000,
        },
      },
      overrides
    );
    assert.equal(saved.provider, 'cloud-api');
    assert.equal(saved.cloudApiConfig.preset, 'anthropic');

    const loaded = readTranslatorSettings(overrides, { strict: true });
    assert.equal(loaded.provider, 'cloud-api');
    assert.equal(loaded.cloudApiConfig.model, 'claude-sonnet-4-5-20250929');
    assert.equal('apiKey' in loaded.cloudApiConfig, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hostAwareFetch fails closed when secretHeaders is requested without v3 net.fetch bridge', async () => {
  let fallbackCalled = false;
  const f = createHostAwareFetch({
    hostCapability: null,
    fallbackFetch: async () => {
      fallbackCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  await assert.rejects(
    () =>
      f('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        secretHeaders: { Authorization: { secretKey: 'cloud_api_key_openai', prefix: 'Bearer ' } },
        body: '{}',
      }),
    /ERR_SECRETS_NET_BRIDGE_REQUIRED/
  );
  assert.equal(fallbackCalled, false);
});

test('Quick Settings UI renders 3rd 외부 API card, saves secret via ctx.secrets without persisting key in settings, deletes key, and preserves 4-switch invariant', async () => {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  const doc = win.document;
  const secretsMap = new Map();
  const savedPatches = [];
  const netCalls = [];

  const mockV3 = {
    apiVersion: 3,
    meta: { pluginId: 'ko-thought-translator', displayName: 'Translator', version: '3.1.0', trustLevel: 'trusted', sourceSchemaVersion: 3 },
    env: {
      surface: 'desktop',
      layoutMode: 'desktop',
      capabilities: {
        hasNetHttps: true,
        hasLocalLoopback: true,
        hasSecrets: true,
        secretsPersistence: 'os-encrypted',
        hasConfigBridge: false,
        hasSettingsBridge: true,
        hasDocumentTransform: true,
      },
    },
    ui: {
      registerStatusItem: (spec) => ({ id: spec.id, update() {}, dispose() {} }),
      registerSettingsPage: (spec) => ({ id: spec.id, open: () => null, dispose() {} }),
      registerCommand: () => ({ unregister() {}, dispose() {} }),
      openModal: (opts = {}) => {
        const dlg = doc.createElement('dialog');
        const bodyEl = doc.createElement('div');
        dlg.appendChild(bodyEl);
        doc.body.appendChild(dlg);
        return {
          element: dlg,
          bodyEl,
          close() {
            if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
            if (typeof opts.onClose === 'function') opts.onClose();
          },
        };
      },
      injectStyle() {},
      removeStyle() {},
    },
    storage: {
      get: async () => undefined,
      set: async (_k, v) => {
        savedPatches.push(v);
        return true;
      },
      delete: async () => true,
      keys: async () => [],
      clear: async () => {},
      onDidChange: () => () => {},
    },
    services: { has: () => false, list: () => [], provide: () => ({ dispose() {} }), call: () => null },
    dom: { isElementInsideIgnored: () => false },
    secrets: {
      getPersistenceMode: () => 'os-encrypted',
      set: async (k, v) => {
        secretsMap.set(k, v);
        return { ok: true, key: k, persistence: 'os-encrypted' };
      },
      has: async (k) => secretsMap.has(k),
      delete: async (k) => secretsMap.delete(k),
      keys: async () => Array.from(secretsMap.keys()),
    },
    net: {
      fetch: async (url, init) => {
        netCalls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          bodyText: JSON.stringify({ content: [{ type: 'text', text: '준비 완료.' }] }),
        };
      },
    },
    lifecycle: { signal: null, onDispose() {}, dispose() {} },
  };

  const inst = mountIfBrowser(win, mockV3);
  try {
    const portal = inst.openQuickSettings();
    const card = portal.bodyEl.querySelector('[data-testid="ko-qs-card"]');
    assert.ok(card);

    // Exact 4-switch invariant preserved
    assert.equal(card.querySelectorAll('input[role="switch"]').length, 4);

    // Click 3rd engine card (외부 API)
    const cloudBtn = card.querySelector('[data-testid="ko-qs-engine-cloud-api"]');
    assert.ok(cloudBtn);
    cloudBtn.click();
    const cloudSection = card.querySelector('[data-testid="ko-qs-cloud-section"]');
    assert.equal(cloudSection.hidden, false);

    // Switch preset to anthropic -> auto-fills Anthropic defaults
    const presetSel = card.querySelector('[data-testid="ko-qs-cloud-preset"]');
    presetSel.value = 'anthropic';
    presetSel.dispatchEvent(new win.Event('change'));
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(card.querySelector('[data-testid="ko-qs-cloud-url"]').value, CLOUD_API_PRESETS.anthropic.baseUrl);
    assert.equal(card.querySelector('[data-testid="ko-qs-cloud-model"]').value, CLOUD_API_PRESETS.anthropic.defaultModel);

    // Enter API key & click Connection Test -> saves secret into ctx.secrets, clears input, probes via secretHeaders
    const keyInp = card.querySelector('[data-testid="ko-qs-cloud-apikey"]');
    keyInp.value = 'sk-ant-secret-value-12345';
    card.querySelector('[data-testid="ko-qs-cloud-test"]').click();
    await new Promise((r) => setTimeout(r, 25));

    assert.equal(secretsMap.get(getCloudSecretKeyForPreset('anthropic')), 'sk-ant-secret-value-12345');
    assert.equal(keyInp.value, '', 'Password input must clear immediately after saving secret');
    assert.equal(card.querySelector('[data-testid="ko-qs-cloud-test-result"]').getAttribute('data-kind'), 'ok');
    assert.equal(netCalls.length, 1);
    assert.equal(netCalls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.deepEqual(netCalls[0].init.secretHeaders, {
      'x-api-key': { secretKey: 'cloud_api_key_anthropic' },
    });

    // Click Save -> saves provider='cloud-api' & cloudApiConfig WITHOUT any plaintext key in settings
    card.querySelector('[data-testid="ko-qs-save"]').click();
    await new Promise((r) => setTimeout(r, 25));

    assert.equal(inst.getStatus().provider, 'cloud-api');
    assert.equal(savedPatches.length >= 1, true);
    const lastSaved = savedPatches[savedPatches.length - 1];
    assert.equal(lastSaved.provider, 'cloud-api');
    assert.equal(lastSaved.cloudApiConfig.preset, 'anthropic');
    assert.equal(JSON.stringify(lastSaved).includes('sk-ant-secret-value-12345'), false);

    // Reopen modal & delete secret key
    const portal2 = inst.openQuickSettings();
    await new Promise((r) => setTimeout(r, 15));
    const card2 = portal2.bodyEl.querySelector('[data-testid="ko-qs-card"]');
    assert.equal(card2.querySelector('[data-testid="ko-qs-cloud-key-status"]').getAttribute('data-state'), 'saved');
    card2.querySelector('[data-testid="ko-qs-cloud-key-delete"]').click();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(secretsMap.has(getCloudSecretKeyForPreset('anthropic')), false);
  } finally {
    inst.dispose();
    win.happyDOM.close();
  }
});

test(
  'Real Extenra v3.3.0 SDK createTestHost end-to-end Desktop & Remote Web ctx.secrets + secretHeaders parity',
  { skip: HAS_EXTENRA_SDK ? false : 'Sibling extenra repo not present in CI' },
  async () => {
    const { createTestHost } = require(EXTENRA_SDK_PATH);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_V3_PATH, 'utf8'));

    for (const surface of ['desktop', 'remote-web']) {
      const seenHeaders = [];
      const host = createTestHost({
        surface,
        remoteBridgeConnected: surface === 'remote-web',
        netHandler: (_pid, url, init) => {
          seenHeaders.push({ url, headers: init.headers });
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            bodyText: JSON.stringify({ choices: [{ message: { content: 'SDK 외부 API 번역 완료.' } }] }),
          };
        },
      });

      const ctx = await host.mountPlugin(manifest, async (v3Ctx) => {
        assert.equal(v3Ctx.env.capabilities.hasSecrets, true);
        assert.equal(
          v3Ctx.env.capabilities.secretsPersistence,
          surface === 'desktop' ? 'os-encrypted' : 'remote-bridge'
        );
        // allowRead: false -> ctx.secrets.get MUST be omitted
        assert.equal(v3Ctx.secrets.get, undefined);

        const setRes = await v3Ctx.secrets.set(getCloudSecretKeyForPreset('openai'), 'sk-real-sdk-test-key');
        assert.equal(setRes.ok, true);

        const adapted = createHostCapabilityAdapter(v3Ctx);
        const hostFetch = createHostAwareFetch({ hostCapability: adapted });
        const probe = await probeCloudApiConnection({
          config: DEFAULT_CLOUD_API_CONFIG,
          fetchFn: hostFetch,
        });
        assert.equal(probe.ok, true);
        assert.equal(probe.sample, 'SDK 외부 API 번역 완료.');

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
        await translator.saveSettings({ provider: 'cloud-api', cloudApiConfig: DEFAULT_CLOUD_API_CONFIG });
      });

      assert.ok(ctx);
      assert.equal(seenHeaders.length, 1);
      assert.equal(seenHeaders[0].url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(seenHeaders[0].headers.Authorization, 'Bearer sk-real-sdk-test-key');

      const items = host.getStatusItems();
      assert.equal(items.length, 1);
      assert.equal(items[0].id, STATUSBAR_ADDON_ID);
      assert.equal(items[0].label, '번역:API');

      assert.equal(host.disposePlugin('ko-thought-translator'), true);
    }
  }
);
