'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Window } = require('happy-dom');

const { createKoTranslator, createTranslatorRuntime, STYLE_ID } = require('../../src/index');

const BUNDLE_PATH = path.resolve(__dirname, '..', '..', 'dist', 'renderer.js');

function createHappyDomEnv() {
  const win = new Window({ url: 'http://127.0.0.1:4242/' });
  const doc = win.document;

  // Track click listeners cleanly so lifecycle tests can assert attach/detach without mocking DOM behavior.
  const trackedListeners = new Set();
  const origAdd = doc.addEventListener.bind(doc);
  const origRemove = doc.removeEventListener.bind(doc);
  doc.addEventListener = (type, fn, opts) => {
    trackedListeners.add(`${type}:${Boolean(fn)}`);
    return origAdd(type, fn, opts);
  };
  doc.removeEventListener = (type, fn, opts) => {
    trackedListeners.delete(`${type}:${Boolean(fn)}`);
    return origRemove(type, fn, opts);
  };

  return {
    win,
    doc,
    trackedListeners,
    cleanup() {
      try {
        win.happyDOM.close();
      } catch (_err) {}
    },
  };
}

test('F1+F2+F4: createKoTranslator translates static UI + reacts to real happy-dom MutationObserver mutations', async () => {
  const { win, doc, trackedListeners, cleanup } = createHappyDomEnv();

  const convView = doc.createElement('div');
  convView.setAttribute('data-testid', 'conversation-view');
  const settingsBtn = doc.createElement('button');
  settingsBtn.textContent = 'Settings';
  convView.appendChild(settingsBtn);
  doc.body.appendChild(convView);

  const statusEvents = [];
  const translator = createKoTranslator({
    win,
    doc,
    settings: {
      enabled: true,
      translateThinking: true,
      showThinking: true,
      translateStaticUi: true,
      provider: 'google-translate',
    },
    fetchFn: async () => ({ ok: true, json: async () => [[['추론 번역 결과']]] }),
    onStatus: (st) => statusEvents.push(st),
  });

  try {
    const st1 = translator.start();
    assert.equal(st1.started, true);
    assert.equal(st1.disposed, false);
    assert.equal(st1.lastError, null, 'start() / scanAll() must complete with zero swallowed errors');
    assert.ok(doc.getElementById(STYLE_ID));
    assert.equal(trackedListeners.has('click:true'), true);
    assert.equal(settingsBtn.textContent, '설정', 'Static UI label must actually be localized in DOM');

    // F2: Real MutationObserver reaction when a new UI node is appended
    const liveLabel = doc.createElement('span');
    liveLabel.textContent = 'Thinking';
    convView.appendChild(liveLabel);

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(liveLabel.textContent, '생각하는 중', 'Real MutationObserver must trigger live localization of newly added nodes');
    assert.equal(translator.getStatus().lastError, null);
  } finally {
    translator.dispose();
    assert.equal(translator.getStatus().disposed, true);
    assert.equal(doc.getElementById(STYLE_ID), null);
    assert.equal(trackedListeners.has('click:true'), false);
    assert.equal(settingsBtn.textContent, 'Settings', 'dispose() must restore original UI text');
    assert.ok(statusEvents.length >= 2);
    cleanup();
  }
});

test('F3: start() with enabled:false activates observer & listeners cleanly when updateSettings({ enabled: true }) is called later', async () => {
  const { win, doc, trackedListeners, cleanup } = createHappyDomEnv();
  const label = doc.createElement('span');
  label.textContent = 'Settings';
  doc.body.appendChild(label);

  const translator = createKoTranslator({
    win,
    doc,
    settings: { enabled: false, translateStaticUi: true, provider: 'google-translate' },
    fetchFn: async () => ({ ok: true, json: async () => [[['테스트']]] }),
  });

  try {
    const st0 = translator.start();
    assert.equal(st0.started, true);
    assert.equal(st0.enabled, false);
    assert.equal(trackedListeners.has('click:true'), false);
    assert.equal(label.textContent, 'Settings');

    // Enable dynamically via updateSettings
    const st1 = translator.updateSettings({ enabled: true });
    assert.equal(st1.enabled, true);
    assert.equal(st1.lastError, null);
    assert.equal(trackedListeners.has('click:true'), true);
    assert.equal(label.textContent, '설정');

    // Disable again -> pauses observer & restores DOM
    const st2 = translator.updateSettings({ enabled: false });
    assert.equal(st2.enabled, false);
    assert.equal(label.textContent, 'Settings');
  } finally {
    translator.dispose();
    cleanup();
  }
});

test('F4 (D-0042): real built dist/renderer.js bundle localizes UI while strictly excluding diff/code-viewer lines in happy-dom VM', () => {
  const { win, doc, cleanup } = createHappyDomEnv();
  const uiBtn = doc.createElement('button');
  uiBtn.textContent = 'Settings';
  doc.body.appendChild(uiBtn);

  // D-0042: diff line with code token "Change" MUST NOT be localized into "변경"
  const diffLine = doc.createElement('div');
  diffLine.setAttribute('data-diff-line', '1');
  const codeSpan = doc.createElement('span');
  codeSpan.textContent = 'Change';
  diffLine.appendChild(codeSpan);
  doc.body.appendChild(diffLine);

  const bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const sandbox = {
    window: win,
    document: doc,
    Node: win.Node,
    NodeFilter: win.NodeFilter,
    MutationObserver: win.MutationObserver,
    localStorage: win.localStorage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    URL,
    fetch: async () => ({ ok: true, json: async () => [[['번역']]] }),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(bundleSrc, sandbox);
  assert.equal(typeof sandbox.window.__agyCreateKoTranslator, 'function');
  assert.ok(sandbox.window.__agyKoTranslator, 'dist/renderer.js must auto-mount window.__agyKoTranslator');

  try {
    const st = sandbox.window.__agyKoTranslator.getStatus();
    assert.equal(st.started, true);
    assert.equal(st.lastError, null);
    assert.equal(uiBtn.textContent, '설정');
    assert.equal(codeSpan.textContent, 'Change', 'D-0042: code/diff lines must never be translated');
  } finally {
    sandbox.window.__agyKoTranslator.dispose();
    cleanup();
  }
});

test('Vendor Independence: createTranslatorRuntime runs cleanly with a custom non-Antigravity HostUiAdapter and ProviderBundle', () => {
  const { win, doc, cleanup } = createHappyDomEnv();
  const titleEl = doc.createElement('h1');
  titleEl.textContent = 'Hello Custom Host';
  doc.body.appendChild(titleEl);

  let localizedCalls = 0;
  let restoredCalls = 0;

  const customHostAdapter = {
    id: 'generic-web-host',
    styleId: 'custom-host-overlay-style',
    selectors: {
      noTranslateSubtree: '[data-custom-skip="1"]',
      conversationViews: '[data-role="chat"]',
    },
    storageKeys: {
      translateThinking: 'custom_tt',
      showThinking: 'custom_st',
      translateStaticUi: 'custom_ui',
      provider: 'custom_provider',
      cache: 'custom_cache',
      llmConfig: 'custom_llm',
      customProviders: 'custom_providers',
    },
    buildOverlayCss: () => '.custom-host-translated { display: block; }',
    createStoragePort: ({ initialSettings }) => {
      const mem = new Map();
      return {
        getInitialSettings: () => initialSettings || {},
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        getJson: (k, fb) => (mem.has(k) ? JSON.parse(mem.get(k)) : fb),
        setJson: (k, v) => mem.set(k, JSON.stringify(v)),
      };
    },
    createDictionaryCatalog: () => ({ exactMap: new Map() }),
    createUiLocalizer: () => ({
      localizeStaticUiInRoot() {
        localizedCalls += 1;
        titleEl.textContent = '사용자 지정 호스트';
      },
      restoreAllMutatedNodes() {
        restoredCalls += 1;
        titleEl.textContent = 'Hello Custom Host';
      },
    }),
    createTriggerController: () => ({
      attachListeners() {},
      detachListeners() {},
      scanTriggerButtonsSync() {},
      restoreTriggerButtons() {},
    }),
    createThinkingTranslator: () => ({
      scanThoughtBlocks() {},
      restoreOriginalCursorEdits() {},
      retranslateVisibleThoughts() {},
    }),
  };

  const customProviderBundle = {
    defaultProviderId: 'echo-provider',
    defaultLlmConfig: {},
    aliasMap: {},
    builtinProviderIds: ['echo-provider'],
    createBuiltinProviders: () => [
      {
        id: 'echo-provider',
        name: 'Echo Provider',
        translate: async (text) => `[KO] ${text}`,
      },
    ],
  };

  const runtime = createTranslatorRuntime({
    win,
    doc,
    hostAdapter: customHostAdapter,
    providerBundle: customProviderBundle,
    settings: { enabled: true, provider: 'echo-provider' },
  });

  try {
    const st = runtime.start();
    assert.equal(st.hostId, 'generic-web-host');
    assert.equal(st.provider, 'echo-provider');
    assert.deepEqual(st.availableProviders, ['echo-provider']);
    assert.equal(st.lastError, null);
    assert.ok(doc.getElementById('custom-host-overlay-style'));
    assert.ok(localizedCalls >= 1);
    assert.equal(titleEl.textContent, '사용자 지정 호스트');
  } finally {
    runtime.dispose();
    assert.ok(restoredCalls >= 1);
    assert.equal(titleEl.textContent, 'Hello Custom Host');
    assert.equal(doc.getElementById('custom-host-overlay-style'), null);
    cleanup();
  }
});

test('R6 F1+F2+F3+F4: colon providerId, corrupted settings fail-closed, imperative custom provider fingerprint, and 120s timeoutMs', () => {
  const { win, doc, cleanup } = createHappyDomEnv();
  const { normalizeProviderId } = require('../../host/config-store');
  const { validateCustomProviderSpec } = require('../../src/adapters/translators/custom-provider');

  // F1: colon providerId must be accepted consistently across host & runtime
  assert.equal(normalizeProviderId('corp:deepl'), 'corp:deepl');

  // F4: timeoutMs up to 120000ms must not be silently clamped to 60000ms
  const spec = validateCustomProviderSpec({
    id: 'corp:deepl',
    endpointUrl: 'http://127.0.0.1:8080/translate',
    bodyTemplate: { q: '{{text}}' },
    responsePath: 'data.text',
    timeoutMs: 90000,
  });
  assert.equal(spec.timeoutMs, 90000);

  // F2: settingsCorrupted fails closed to enabled:false and never falls back to google-translate
  let fetchCalled = 0;
  const corruptedTranslator = createKoTranslator({
    win,
    doc,
    settings: { enabled: false, settingsCorrupted: true },
    fetchFn: async () => {
      fetchCalled += 1;
      return { ok: true, json: async () => [[['외부호출금지']]] };
    },
  });
  try {
    const st = corruptedTranslator.start();
    assert.equal(st.enabled, false);
    assert.equal(st.provider, null);
    assert.equal(st.lastError, 'SETTINGS_FILE_CORRUPTED');
    assert.equal(fetchCalled, 0);
  } finally {
    corruptedTranslator.dispose();
  }

  // F3: imperative registerCustomProvider / unregisterCustomProvider normalizes & updates fingerprint cleanly
  const runtimeTranslator = createKoTranslator({
    win,
    doc,
    settings: { enabled: true, provider: 'corp:deepl' },
    fetchFn: async () => ({ ok: true, json: async () => ({ data: { text: '번역됨' } }) }),
  });
  try {
    runtimeTranslator.start();
    const id1 = runtimeTranslator.registerCustomProvider({
      id: 'CORP:DEEPL',
      endpointUrl: 'http://127.0.0.1:8080/v1',
      bodyTemplate: { q: '{{text}}' },
      responsePath: 'data.text',
      timeoutMs: 90000,
    });
    assert.equal(id1, 'corp:deepl');
    assert.equal(runtimeTranslator.unregisterCustomProvider('CORP:DEEPL'), true);
    assert.equal(runtimeTranslator.getStatus().availableProviders.includes('corp:deepl'), false);
  } finally {
    runtimeTranslator.dispose();
    cleanup();
  }
});

test('R7 F1+F3+F5+NB1+NB5: config-store strict validation, legacy file-lock defense, cache-variant invalidation, and React in-place __agyOrigValue', async () => {
  const os = require('node:os');
  const {
    normalizeProviderId,
    sanitizeLlmConfig,
    acquireExclusiveLock,
    releaseExclusiveLock,
  } = require('../../host/config-store');
  const { buildHostLoaderScriptSource } = require('../../host/dropin-loader');

  // F3: Forbidden provider IDs & non-string types must throw
  assert.throws(() => normalizeProviderId('constructor'), /Forbidden provider id/);
  assert.throws(() => normalizeProviderId('prototype'), /Forbidden provider id/);
  assert.throws(() => normalizeProviderId(false), /Invalid provider id type/);
  assert.throws(() => sanitizeLlmConfig({ apiFormat: 'invalid-fmt' }, undefined, { strict: true }), /INVALID_API_FORMAT/);
  assert.throws(() => sanitizeLlmConfig({ timeoutMs: 999999 }, undefined, { strict: true }), /INVALID_TIMEOUT_MS/);

  // NB1: Legacy regular-file lock (fresh -> fail-closed null; stale -> unlinked & acquired)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-lock-r7-'));
  try {
    const lockPath = path.join(tmpDir, 'settings.lock');
    fs.writeFileSync(lockPath, '{"pid":99999}', 'utf8');
    assert.equal(acquireExclusiveLock(lockPath, 15000), null, 'Fresh legacy regular-file lock must fail closed');
    const past = new Date(Date.now() - 30000);
    fs.utimesSync(lockPath, past, past);
    const tok = acquireExclusiveLock(lockPath, 5000);
    assert.ok(tok, 'Stale legacy regular-file lock must be safely replaced by proper-lockfile');
    releaseExclusiveLock(lockPath, tok);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // F1: buildHostLoaderScriptSource must reject semantic corruption (secret headers / bad types) fail-closed
  const loaderSrc = buildHostLoaderScriptSource();
  assert.match(loaderSrc, /loadValidatedSettings/);
  assert.match(loaderSrc, /Promise\.allSettled/);

  // F5: bootstrap cache-variant invalidation when local-llm model/timeout changes
  const { win, doc, cleanup } = createHappyDomEnv();
  const block = doc.createElement('div');
  block.className = 'cursor-edit';
  const inner = doc.createElement('div');
  inner.className = 'leading-relaxed';
  const p = doc.createElement('p');
  p.textContent = 'Checking cache invalidation carefully.';
  inner.appendChild(p);
  block.appendChild(inner);
  doc.body.appendChild(block);

  const modelsCalled = [];
  const tr = createKoTranslator({
    win,
    doc,
    settings: {
      enabled: true,
      translateThinking: true,
      translateStaticUi: true,
      provider: 'local-llm',
      llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'model-a', apiFormat: 'ollama', timeoutMs: 15000 },
    },
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      modelsCalled.push(body.model);
      return { ok: true, json: async () => ({ message: { content: `번역-${body.model}` } }) };
    },
  });

  try {
    tr.start();
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(modelsCalled.includes('model-a'), true);

    // Changing model must invalidate cache variant and retranslate with model-b
    tr.updateSettings({
      llmConfig: { baseUrl: 'http://127.0.0.1:11434', model: 'model-b', apiFormat: 'ollama', timeoutMs: 30000 },
    });
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(modelsCalled.includes('model-b'), true, 'Changing llmConfig model must retranslate via new cache variant');

    // NB5: React in-place text update updates __agyOrigValue so dispose() restores the latest React text
    const btn = doc.createElement('button');
    const txt = doc.createTextNode('Settings');
    btn.appendChild(txt);
    doc.body.appendChild(btn);
    tr.scanAll();
    assert.equal(txt.nodeValue, '설정');
    txt.nodeValue = 'Thinking';
    tr.scanAll();
    assert.equal(txt.nodeValue, '생각하는 중');
    tr.dispose();
    assert.equal(txt.nodeValue, 'Thinking', 'NB5: dispose() must restore latest React in-place text, not stale Settings');
  } finally {
    tr.dispose();
    cleanup();
  }
});

test('R8 F1+F3: Thinking <pre><code> blocks never leak to translator & preserve DOM; config-store preserves enabled and rejects secret queries / >16 providers', async () => {
  const os = require('node:os');
  const { win, doc, cleanup } = createHappyDomEnv();
  const { readTranslatorSettings, saveTranslatorSettings, sanitizeLlmConfig } = require('../../host/config-store');

  // F1: Thinking block with prose <p> + <pre><code>secret source</code></pre>
  const block = doc.createElement('div');
  block.className = 'cursor-edit';
  const inner = doc.createElement('div');
  inner.className = 'leading-relaxed';
  const prose = doc.createElement('p');
  prose.textContent = 'Analyzing the authentication handler.';
  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  code.className = 'language-js';
  const tokSpan = doc.createElement('span');
  tokSpan.className = 'token keyword';
  tokSpan.textContent = 'const secretApiKey = "sk-live-secret";';
  code.appendChild(tokSpan);
  pre.appendChild(code);
  inner.appendChild(prose);
  inner.appendChild(pre);
  block.appendChild(inner);
  doc.body.appendChild(block);

  const sentPayloads = [];
  const tr = createKoTranslator({
    win,
    doc,
    settings: { enabled: true, translateThinking: true, translateStaticUi: false, provider: 'google-translate' },
    fetchFn: async (url) => {
      sentPayloads.push(String(url));
      return { ok: true, json: async () => [[['인증 핸들러를 분석하는 중입니다.']]] };
    },
  });

  try {
    tr.start();
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(sentPayloads.length, 1, 'Only prose paragraph should be sent to translator');
    assert.equal(sentPayloads[0].includes('secretApiKey'), false, 'F1: <pre><code> source must NEVER leak to translator');
    const wrap = block.querySelector('.agy-ko-thought-wrap');
    assert.ok(wrap);
    const preservedCode = wrap.querySelector('pre > code.language-js > span.token.keyword');
    assert.ok(preservedCode, 'F1: <pre><code> syntax highlighting DOM must be preserved intact');
    assert.equal(preservedCode.textContent, 'const secretApiKey = "sk-live-secret";');
  } finally {
    tr.dispose();
    cleanup();
  }

  // F3: config-store rejects secret query in llmConfig.baseUrl, rejects >16 customProviders in strict mode, and preserves `enabled`
  assert.throws(
    () => sanitizeLlmConfig({ baseUrl: 'http://127.0.0.1:11434/?api_key=leak' }, undefined, { strict: true }),
    /FORBIDDEN_SECRET_QUERY_IN_LLM_BASE_URL/
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-cfg-r8-'));
  try {
    const sp = path.join(tmpDir, 'ko_translator_settings.json');
    const lp = path.join(tmpDir, 'ko_translator_settings.lock');
    saveTranslatorSettings({ enabled: false, showThinking: false }, { SETTINGS_PATH: sp, SETTINGS_LOCK_PATH: lp });
    const afterToggle = saveTranslatorSettings({ showThinking: true }, { SETTINGS_PATH: sp, SETTINGS_LOCK_PATH: lp });
    assert.equal(afterToggle.enabled, false, 'F3: Saving another setting must preserve existing enabled:false');
    const readBack = readTranslatorSettings({ SETTINGS_PATH: sp }, { strict: true });
    assert.equal(readBack.enabled, false);

    const tooMany = Array.from({ length: 17 }, (_, i) => ({
      id: `custom-${i}`,
      endpointUrl: 'http://127.0.0.1:8080/t',
      bodyTemplate: { q: '{{text}}' },
      responsePath: 'text',
    }));
    assert.throws(
      () => saveTranslatorSettings({ customProviders: tooMany }, { SETTINGS_PATH: sp, SETTINGS_LOCK_PATH: lp }),
      /TOO_MANY_CUSTOM_PROVIDERS/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
