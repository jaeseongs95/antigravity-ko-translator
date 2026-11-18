'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderRegistry } = require('../../src/core/provider-registry');
const { createTranslationService } = require('../../src/core/translation-service');
const { createLocalLlmAdapter } = require('../../src/adapters/translators/local-llm');
const {
  validateCustomProviderSpec,
  createCustomProviderAdapter,
} = require('../../src/adapters/translators/custom-provider');
const {
  STORAGE_KEYS,
  createAntigravityStorageAdapter,
  createNativeStorageBridge,
  createAntigravityLlmConfigAdapter,
  createOriginLocalCustomProviderStore,
} = require('../../src/adapters/antigravity/storage-port');

function createMemStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
      return true;
    },
    removeItem(k) {
      map.delete(String(k));
      return true;
    },
  };
}

test('TranslationService (D-0026, D-0032, D-0033): lowercase normalization, remote effective resolution without clobbering desired/pending custom provider, and epoch invalidation', async () => {
  const registry = createProviderRegistry();
  let googleCalls = 0;
  let localCalls = 0;

  registry.registerProvider({
    id: 'google-translate',
    label: 'Google 번역',
    supportsRemote: true,
    maxConcurrency: 4,
    async translate(text) {
      googleCalls += 1;
      return `[구글] ${text}`;
    },
  });
  registry.registerProvider({
    id: 'local-llm',
    label: '로컬 LLM',
    supportsRemote: false,
    maxConcurrency: 2,
    async translate(text) {
      localCalls += 1;
      return `[로컬] ${text}`;
    },
  });

  // 1) Remote environment with saved `LOCAL-LLM` (uppercase) normalizes to `local-llm`,
  //    keeps desiredProviderId === 'local-llm', and resolves effectiveProviderId === 'google-translate'
  const remoteStorage = createMemStorage({ 'ko-thought-provider': 'LOCAL-LLM' });
  const remoteSvc = createTranslationService({
    registry,
    storage: remoteStorage,
    defaultProviderId: 'google-translate',
    isRemoteEnv: true,
    saveDebounceMs: 10,
  });

  assert.equal(remoteSvc.getDesiredProviderId(), 'local-llm');
  assert.equal(remoteSvc.getEffectiveProviderId(), 'google-translate');
  assert.equal(remoteStorage.getItem('ko-thought-provider'), 'LOCAL-LLM');

  const out1 = await remoteSvc.translateText('Checking workbench bootstrap sequence.');
  assert.equal(out1, '[구글] Checking workbench bootstrap sequence.');
  assert.equal(googleCalls, 1);
  assert.equal(localCalls, 0);
  remoteSvc.dispose();

  // 2) Pending custom provider id saved before custom store hydrates is NOT overwritten by default
  const customStorage = createMemStorage({ 'ko-thought-provider': 'DEEPL-PRO' });
  const pendingSvc = createTranslationService({
    registry,
    storage: customStorage,
    defaultProviderId: 'google-translate',
    isRemoteEnv: false,
  });
  assert.equal(pendingSvc.getDesiredProviderId(), 'deepl-pro');
  assert.equal(pendingSvc.getPendingCustomProviderId(), 'deepl-pro');
  assert.equal(pendingSvc.getEffectiveProviderId(), 'google-translate');

  registry.registerProvider({
    id: 'deepl-pro',
    label: 'DeepL Pro',
    supportsRemote: true,
    maxConcurrency: 2,
    async translate(text) {
      return `[딥엘] ${text}`;
    },
  });

  assert.equal(pendingSvc.getPendingCustomProviderId(), null);
  assert.equal(pendingSvc.getDesiredProviderId(), 'deepl-pro');
  assert.equal(pendingSvc.getEffectiveProviderId(), 'deepl-pro');

  // 3) Epoch bump (D-0033) discards in-flight translation from older epoch so stale result never pollutes cache
  let releaseSlow;
  registry.registerProvider({
    id: 'slow-prov',
    label: 'Slow Provider',
    supportsRemote: true,
    maxConcurrency: 2,
    translate(text) {
      return new Promise((resolve) => {
        releaseSlow = () => resolve(`[구세대 번역] ${text}`);
      });
    },
  });
  pendingSvc.setProvider('slow-prov');
  const inflight = pendingSvc.translateText('Verifying stale epoch protection.');
  await new Promise((r) => setTimeout(r, 10));
  pendingSvc.clearCache(); // bumps epoch!
  releaseSlow();
  const staleRes = await inflight;
  // Stale result must NOT enter memCache of the new epoch
  assert.equal(pendingSvc.getCachedSync('Verifying stale epoch protection.'), null);
  assert.ok(typeof staleRes === 'string');
  pendingSvc.dispose();
});

test('Storage & LlmConfigPort (Rev5-F3 #1, Rev5-F8): nativeStorage getItems/updateItems-only contract, Ollama keep_alive:0 unload hint, and custom secret isolation', async () => {
  const nativeDb = {
    [STORAGE_KEYS.LLM_CONFIG]: JSON.stringify({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:7b',
      apiFormat: 'ollama',
      allowRemoteHttps: false,
      timeoutMs: 12000,
    }),
  };
  const nativeUpdateCalls = [];

  // Authentic Antigravity nativeStorage has ONLY getItems() & updateItems() — setItem is undefined!
  const fakeWin = {
    localStorage: createMemStorage(),
    nativeStorage: {
      setItem: undefined,
      async getItems() {
        return { ...nativeDb };
      },
      async updateItems(entries) {
        nativeUpdateCalls.push(entries);
        Object.assign(nativeDb, entries);
      },
    },
  };

  const storage = createAntigravityStorageAdapter(fakeWin);
  const nativeBridge = createNativeStorageBridge(fakeWin);
  assert.equal(nativeBridge.hasNativeStorage(), true);

  // Rev5-F8: Attempting to write custom provider credentials to nativeStorage MUST throw!
  assert.throws(
    () => nativeBridge.writeItems({ [STORAGE_KEYS.CUSTOM_PROVIDERS_LOCAL_ONLY]: '[{"headers":{"Authorization":"Bearer secret"}}]' }),
    /Security violation/
  );

  const llmAdapterPort = createAntigravityLlmConfigAdapter({
    targetWin: fakeWin,
    storage,
    nativeBridge,
  });
  await llmAdapterPort.syncFromNativeStorage();
  assert.equal(llmAdapterPort.getLlmConfig().model, 'qwen2.5:7b');

  // Verify Ollama keep_alive: 0 unload hint fires when switching away from active loopback Ollama model
  const fetchCalls = [];
  const localLlmProvider = createLocalLlmAdapter({
    llmConfigPort: llmAdapterPort,
    async fetchFn(url, init) {
      fetchCalls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        async json() {
          return { message: { content: '워크벤치 상태를 점검합니다.' } };
        },
      };
    },
  });

  const ko = await localLlmProvider.translate('Checking workbench status.');
  assert.equal(ko, '워크벤치 상태를 점검합니다.');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://127.0.0.1:11434/api/chat');

  // Switch model -> triggers unload hint (`keep_alive: 0`) for previous `qwen2.5:7b`!
  llmAdapterPort.setLlmConfig({ model: 'gemma3:4b' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[1].url, 'http://127.0.0.1:11434/api/generate');
  assert.deepEqual(fetchCalls[1].body, { model: 'qwen2.5:7b', keep_alive: 0 });
  assert.equal(nativeUpdateCalls.length, 1);

  // Verify CustomProviderStore persists ONLY to origin-local storage, NEVER to nativeStorage!
  const registry = createProviderRegistry();
  const customStore = createOriginLocalCustomProviderStore({
    storage,
    registry,
    async fetchFn() {
      return { ok: true, async json() { return { translations: [{ text: '번역 완료' }] }; } };
    },
  });
  customStore.upsertSpec({
    id: 'my-gateway',
    label: 'My Gateway',
    endpointUrl: 'https://translate.example.com/v2/translate',
    allowRemoteHttps: true,
    headers: { Authorization: 'Bearer top-secret-token' },
    bodyTemplate: { text: ['{{text}}'], target_lang: '{{targetLang}}' },
    responsePath: 'translations.0.text',
  });
  assert.equal(nativeUpdateCalls.length, 1, 'Custom provider upsert must never call nativeStorage.updateItems');
  assert.equal(Object.prototype.hasOwnProperty.call(nativeDb, STORAGE_KEYS.CUSTOM_PROVIDERS_LOCAL_ONLY), false);
  assert.match(fakeWin.localStorage.getItem(STORAGE_KEYS.CUSTOM_PROVIDERS_LOCAL_ONLY), /top-secret-token/);
});

test('CustomProviderAdapter (Rev6-F5 #2): Array bodyTemplate, single-pass {{text|sourceLang|targetLang}} ($& safe), and forbidden headers', async () => {
  // Forbidden headers rejected case-insensitively
  for (const badHeader of ['Cookie', 'HOST', 'Sec-Fetch-Site', 'Proxy-Authorization', 'Origin', 'Referer']) {
    assert.throws(
      () =>
        validateCustomProviderSpec({
          id: 'bad-hdr',
          label: 'Bad',
          endpointUrl: 'https://api.example.com/v1',
          allowRemoteHttps: true,
          headers: { [badHeader]: 'evil' },
          bodyTemplate: { q: '{{text}}' },
          responsePath: 'data.text',
        }),
      /Forbidden HTTP header name/
    );
  }

  let capturedInit = null;
  const spec = validateCustomProviderSpec({
    id: 'array-gateway',
    label: 'Array Gateway',
    endpointUrl: 'https://api.example.com/translate',
    allowRemoteHttps: true,
    headers: { 'X-Api-Key': 'key-123' },
    bodyTemplate: [
      {
        Text: '{{text}}',
        From: '{{sourceLang}}',
        To: '{{targetLang}}',
      },
    ],
    responsePath: '0.translations.0.text',
  });
  assert.equal(Array.isArray(spec.bodyTemplate), true);

  const adapter = createCustomProviderAdapter(spec, {
    async fetchFn(_url, init) {
      capturedInit = init;
      return {
        ok: true,
        async json() {
          return [{ translations: [{ text: '리터럴 {{targetLang}} 및 $& 보존 완료' }] }];
        },
      };
    },
  });

  // Input contains BOTH `$&` AND `{{targetLang}}` — single-pass interpolation MUST NOT double-expand `{{targetLang}}` to `'ko'`!
  const trickyInput = 'Check price $& and template literal {{targetLang}} now.';
  const result = await adapter.translate(trickyInput);
  assert.equal(result, '리터럴 {{targetLang}} 및 $& 보존 완료');

  const sentBody = JSON.parse(capturedInit.body);
  assert.deepEqual(sentBody, [
    {
      Text: 'Check price $& and template literal {{targetLang}} now.',
      From: 'en',
      To: 'ko',
    },
  ]);
});
