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
  createStoragePort,
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

  // 4) F5: When local-llm or custom provider fails, MUST NOT silently fall back to google-translate (zero data leakage)
  let leakGoogleCalls = 0;
  const isoReg = createProviderRegistry();
  isoReg.registerProvider({
    id: 'google-translate',
    label: 'Google',
    supportsRemote: true,
    async translate(t) {
      leakGoogleCalls += 1;
      return `[유출] ${t}`;
    },
  });
  isoReg.registerProvider({
    id: 'local-llm',
    label: 'Local LLM',
    supportsRemote: false,
    async translate() {
      throw new Error('ECONNREFUSED');
    },
  });
  const isoSvc = createTranslationService({
    registry: isoReg,
    storage: createMemStorage({ 'ko-thought-provider': 'local-llm' }),
    defaultProviderId: 'google-translate',
  });
  const fallbackResult = await isoSvc.translateText('Private internal secret thought.');
  assert.equal(fallbackResult, 'Private internal secret thought.');
  assert.equal(leakGoogleCalls, 0, 'F5: Failed local-llm must NEVER silently leak text to google-translate');
  isoSvc.dispose();

  pendingSvc.dispose();
});

test('Isolated StoragePort & LocalLlmAdapter: zero host nativeStorage access and loopback Ollama translation', async () => {
  let nativeStorageTouched = false;
  const fakeWin = {
    localStorage: createMemStorage(),
    nativeStorage: {
      async getItems() {
        nativeStorageTouched = true;
        return {};
      },
      async updateItems() {
        nativeStorageTouched = true;
      },
    },
  };

  const storage = createStoragePort({
    targetWin: fakeWin,
    initialSettings: {
      provider: 'local-llm',
      llmConfig: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen2.5:7b',
        apiFormat: 'ollama',
        allowRemoteHttps: false,
        timeoutMs: 12000,
      },
    },
  });

  storage.setItem(STORAGE_KEYS.provider, 'local-llm');
  assert.equal(storage.getItem(STORAGE_KEYS.provider), 'local-llm');
  assert.equal(storage.getInitialSettings().llmConfig.model, 'qwen2.5:7b');
  assert.equal(nativeStorageTouched, false, 'StoragePort must NEVER read or write host nativeStorage');

  const fetchCalls = [];
  const localLlmProvider = createLocalLlmAdapter({
    llmConfigPort: {
      getLlmConfig: () => storage.getInitialSettings().llmConfig,
    },
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
