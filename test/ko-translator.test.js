'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'scripts', 'renderer');
const HOST_DIR = path.join(ROOT, 'scripts', 'host');
const BUNDLE_INJECTOR_PATH = path.join(HOST_DIR, 'bundle-injector.js');

test('modular SOLID structure and bundle assembly verification', () => {
  const { RENDERER_MODULE_FILES } = require(path.join(HOST_DIR, 'paths.js'));
  const { assembleRendererSourceFromModules } = require(BUNDLE_INJECTOR_PATH);
  assert.equal(RENDERER_MODULE_FILES.length, 8);
  for (const file of RENDERER_MODULE_FILES) {
    const fullPath = path.join(RENDERER_DIR, file);
    assert.ok(fs.existsSync(fullPath), `Missing renderer module: ${file}`);
  }

  for (const hostFile of ['paths.js', 'local-llm-service.js', 'settings-storage.js', 'bundle-injector.js']) {
    const fullPath = path.join(HOST_DIR, hostFile);
    assert.ok(fs.existsSync(fullPath), `Missing host module: ${hostFile}`);
    require(fullPath);
  }

  const bundleCode = assembleRendererSourceFromModules();
  assert.ok(bundleCode.includes("const KO_LOCALIZER_VERSION = 'v13.1';"));
  assert.ok(bundleCode.includes("'remove-conversation-history'"));
  assert.doesNotThrow(() => new vm.Script(bundleCode));
});

test('non-intrusion & SRP boundary enforcement across renderer modules (01, 06, 07, 08)', () => {
  const mod01 = fs.readFileSync(path.join(RENDERER_DIR, '01-bootstrap-and-cache.js'), 'utf8');
  const mod06 = fs.readFileSync(path.join(RENDERER_DIR, '06-settings-modal-ui.js'), 'utf8');
  const mod07 = fs.readFileSync(path.join(RENDERER_DIR, '07-statusbar-adapter.js'), 'utf8');
  const mod08 = fs.readFileSync(path.join(RENDERER_DIR, '08-dom-observer.js'), 'utf8');

  // 1. 01-bootstrap-and-cache.js must not touch .agy-ctx-statusbar or builtin statusbar buttons
  assert.ok(!mod01.includes('.agy-ctx-statusbar'), '01-bootstrap-and-cache.js must not query .agy-ctx-statusbar');
  assert.ok(!mod01.includes('.agy-ctx-btn'), '01-bootstrap-and-cache.js must not touch .agy-ctx-btn');

  // 2. 06-settings-modal-ui.js owns #agy-ko-translator-modal and must not borrow statusbar .agy-ctx-btn or .agy-ctx-statusbar
  assert.ok(mod06.includes('function openOrToggleTranslatorSettingsModal()'), '06-settings-modal-ui.js must own modal open/toggle');
  assert.ok(mod06.includes('function closeTranslatorSettingsModal()'), '06-settings-modal-ui.js must own modal close');
  assert.ok(!mod06.includes('.agy-ctx-statusbar'), '06-settings-modal-ui.js must not intrude on .agy-ctx-statusbar');
  assert.ok(!mod06.includes('agy-ctx-btn'), '06-settings-modal-ui.js must not borrow statusbar button classes');

  // 3. 07-statusbar-adapter.js must be a pure StatusBarAdapter bridge with zero DOM/CSS manipulation
  assert.ok(!mod07.includes('.agy-ctx-statusbar'), '07-statusbar-adapter.js must not query .agy-ctx-statusbar');
  assert.ok(!mod07.includes('document.'), '07-statusbar-adapter.js must not perform direct DOM manipulation');
  assert.ok(!mod07.includes('agy-ctx-btn'), '07-statusbar-adapter.js must not hardcode statusbar internal class names');
  assert.ok(mod07.includes("className: 'agy-ko-translator-status-btn'"), '07-statusbar-adapter.js must use its own button class token');

  // 4. 08-dom-observer.js must not call registerStatusbarTranslatorAdapter inside the 16ms scheduleCoalescedScan loop
  const coalescedMatch = mod08.match(/function scheduleCoalescedScan\(\)\s*\{[\s\S]*?\r?\n  \}/);
  assert.ok(coalescedMatch, 'scheduleCoalescedScan must exist in 08-dom-observer.js');
  assert.ok(
    !coalescedMatch[0].includes('registerStatusbarTranslatorAdapter'),
    'scheduleCoalescedScan must not repeatedly call registerStatusbarTranslatorAdapter'
  );
  assert.ok(coalescedMatch[0].includes('runFastThoughtAndTriggerScan()'), 'scheduleCoalescedScan must run fast thought/trigger scan synchronously');
  assert.ok(coalescedMatch[0].includes('}, 16)'), 'scheduleCoalescedScan must coalesce full-DOM localizeStaticUiInRoot via 16ms timer');
  assert.ok(mod08.includes('observer.takeRecords()'), '08-dom-observer.js must flush self-induced mutation records'
  );
});

test('07-statusbar-adapter pure lifecycle and contract integration', () => {
  const mod07 = fs.readFileSync(path.join(RENDERER_DIR, '07-statusbar-adapter.js'), 'utf8');

  const registered = new Map();
  let updateAllCount = 0;
  let modalOpenCount = 0;
  let modalCloseCount = 0;
  let switchedProvider = null;

  const sandbox = {
    KO_LOCALIZER_VERSION: 'v12.7',
    activeTranslationProvider: 'local-llm',
    disposed: false,
    getProviderDisplayMeta(id) {
      return id === 'local-llm'
        ? { shortLabel: '로컬 LLM', title: '로컬 LLM (Qwen2.5-3B GPU)' }
        : { shortLabel: 'Google 번역', title: 'Google 번역 (웹 API)' };
    },
    openOrToggleTranslatorSettingsModal() {
      modalOpenCount++;
    },
    closeTranslatorSettingsModal() {
      modalCloseCount++;
    },
    window: {
      __agySetTranslationProvider(next) {
        switchedProvider = next;
        sandbox.activeTranslationProvider = next;
      },
      agyStatusBar: {
        registerAdapter(spec) {
          registered.set(spec.id, spec);
          return () => registered.delete(spec.id);
        },
        unregisterAdapter(id) {
          return registered.delete(id);
        },
        updateAll() {
          updateAllCount++;
        },
      },
    },
  };

  vm.runInNewContext(
    `${mod07}\n;globalThis.__testApi = { registerStatusbarTranslatorAdapter, refreshStatusbarTranslatorAdapter, unregisterStatusbarTranslatorAdapter };`,
    sandbox
  );

  const api = sandbox.__testApi;
  assert.equal(api.registerStatusbarTranslatorAdapter(), true);
  assert.equal(registered.has('ko-translator'), true);

  const spec = registered.get('ko-translator');
  assert.equal(spec.slot, 'right');
  assert.equal(spec.order, 30);
  assert.equal(spec.className, 'agy-ko-translator-status-btn');
  assert.equal(spec.label(), '[ 번역:LLM ]');
  assert.ok(spec.title().includes('v12.7'));

  // Click opens/toggles modal via 06-settings-modal-ui.js delegate
  spec.onClick({}, { shiftKey: false });
  assert.equal(modalOpenCount, 1);

  // Shift+Click toggles translation provider
  spec.onClick({}, { shiftKey: true });
  assert.equal(switchedProvider, 'google-translate');
  assert.equal(spec.label(), '[ 번역:구글 ]');

  // Refresh delegates to window.agyStatusBar.updateAll()
  api.refreshStatusbarTranslatorAdapter();
  assert.equal(updateAllCount, 1);

  // Unregister cleans up adapter and closes modal
  api.unregisterStatusbarTranslatorAdapter();
  assert.equal(registered.has('ko-translator'), false);
  assert.equal(modalCloseCount, 1);
});

test('host lifecycle, hooks.json CLI contract, and app-update auto-recovery guarantees', () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
  const lifecycle = hooksJson['ko-thought-translator-lifecycle'];
  assert.ok(lifecycle && lifecycle.enabled === true);

  for (const eventName of ['SessionStart', 'PreInvocation', 'PostInvocation']) {
    assert.ok(Array.isArray(lifecycle[eventName]) && lifecycle[eventName].length > 0, `Missing ${eventName} hook`);
    const cmd = lifecycle[eventName][0].command;
    assert.equal(cmd, 'node ./scripts/ensure_ko_thought_patch.js --hook');
    assert.ok(!cmd.includes('node -e'), `${eventName} must not use fragile node -e wrapper`);
  }

  const entrySource = fs.readFileSync(path.join(ROOT, 'scripts', 'ensure_ko_thought_patch.js'), 'utf8');
  assert.ok(entrySource.includes('runStatusbarPatchWorker()'), 'Entry script must use synchronous runStatusbarPatchWorker()');
  assert.ok(!entrySource.includes("[ENSURE_STATUSBAR_PATCH_PATH, '--hook']"), 'Entry script must not spawn detached --hook child');
  assert.ok(entrySource.includes('onAppRecoveryNeeded'), 'Entry script must wire onAppRecoveryNeeded for app updates');

  const storageMod = require(path.join(HOST_DIR, 'settings-storage.js'));
  assert.equal(typeof storageMod.isAsarCurrentlyPatched, 'function');
  const storageSource = fs.readFileSync(path.join(HOST_DIR, 'settings-storage.js'), 'utf8');
  const llmSource = fs.readFileSync(path.join(HOST_DIR, 'local-llm-service.js'), 'utf8');
  assert.ok(!storageSource.includes('Win32_Process'), 'Watcher spawn must never use WMI Win32_Process (triggers Windows Terminal DefTerm)');
  assert.ok(!storageSource.includes('powershell'), 'Watcher spawn must never invoke powershell.exe');
  assert.ok(storageSource.includes('windowsHide: true'), 'Watcher spawn must pass windowsHide: true (CREATE_NO_WINDOW)');
  assert.ok(!llmSource.includes('Win32_Process'), 'LLM spawn must never use WMI Win32_Process');
  assert.ok(!llmSource.includes('powershell'), 'LLM spawn must never invoke powershell.exe');
  assert.ok(llmSource.includes('windowsHide: true'), 'LLM spawn must pass windowsHide: true (CREATE_NO_WINDOW)');
  assert.ok(storageSource.includes('asar_unpatched'), 'Watcher loop must detect unpatched app.asar after app update');
});

test('Remote Control web support: UserScript header, zero innerHTML (TrustedTypes), Google Translate fallback, and hubFrame bridge', async () => {
  const { assembleRendererSourceFromModules } = require(BUNDLE_INJECTOR_PATH);
  const bundleCode = assembleRendererSourceFromModules();

  // 1. UserScript header for antigravity.google.com & antigravity.static.usercontent.goog
  assert.ok(bundleCode.startsWith('// ==UserScript==\n'), 'Bundle must start with UserScript header');
  assert.ok(bundleCode.includes('// @match        https://antigravity.google.com/*'));
  assert.ok(bundleCode.includes('// @match        https://antigravity.static.usercontent.goog/*'));
  assert.ok(bundleCode.includes('function mountKoThoughtLocalizer(__agyWin, __agyDoc)'));

  // 2. Zero innerHTML/outerHTML assignments across all renderer modules (TrustedTypes compliance)
  const { RENDERER_MODULE_FILES } = require(path.join(HOST_DIR, 'paths.js'));
  for (const file of RENDERER_MODULE_FILES) {
    const src = fs.readFileSync(path.join(RENDERER_DIR, file), 'utf8');
    assert.ok(!src.includes('.innerHTML'), `${file} must not assign .innerHTML (breaks TrustedTypes on Remote Control)`);
  }

  // 3. Static UI dictionary covers Remote Control sidebar & auxiliary pane labels
  const mod02 = fs.readFileSync(path.join(RENDERER_DIR, '02-static-ui-dict.js'), 'utf8');
  const dictSandbox = {};
  vm.runInNewContext(`${mod02}\n;globalThis.translateStaticUiSync = translateStaticUiSync;`, dictSandbox);
  assert.equal(dictSandbox.translateStaticUiSync('Background Commands'), '백그라운드 명령');
  assert.equal(dictSandbox.translateStaticUiSync('CLI Project'), 'CLI 프로젝트');
  assert.equal(dictSandbox.translateStaticUiSync('No conversations yet'), '아직 대화가 없습니다');
  assert.equal(dictSandbox.translateStaticUiSync('Worked for 43m'), '43분 동안 작업함');

  // 4. Remote Control defaults to google-translate and local-llm falls back to google-translate when unreachable
  const mod03 = fs.readFileSync(path.join(RENDERER_DIR, '03-text-tokenizer.js'), 'utf8');
  const mod04 = fs.readFileSync(path.join(RENDERER_DIR, '04-translation-adapters.js'), 'utf8');
  const adapterSandbox = {
    DEFAULT_TRANSLATION_PROVIDER: 'local-llm',
    PROVIDER_STORAGE_KEY: 'agy-ko-thought-provider',
    PRETRANSLATE_STORAGE_KEY: 'agy-ko-thought-pretranslate',
    pretranslateEnabled: false,
    memCache: new Map(),
    inflightMap: new Map(),
    scheduleSaveCache() {},
    isInvalidCachedOrTranslatedText: () => false,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelectorAll: () => [] },
    window: {
      location: { origin: 'https://antigravity.google.com' },
      __APP_CONFIG__: { isRemoteControl: true },
    },
    fetch: async (url) => {
      if (String(url).includes('127.0.0.1')) {
        throw new Error('ECONNREFUSED');
      }
      return {
        ok: true,
        json: async () => [[['리모트 세션 추론 번역 완료', 'Remote session thought translation done']]],
      };
    },
    AbortController,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(
    `${mod03}\n${mod04}\n;globalThis.__adapterApi = { getProvider: () => activeTranslationProvider, translate: translateThoughtTextEnToKo, adapters: TRANSLATION_ADAPTERS };`,
    adapterSandbox
  );
  assert.equal(adapterSandbox.__adapterApi.getProvider(), 'google-translate', 'Remote Control must default to google-translate');

  const fallbackOut = await adapterSandbox.__adapterApi.adapters['local-llm'].translate({
    cleanText: 'Checking remote session state.',
    protectedText: 'Checking remote session state.',
    savedTokens: [],
    signal: null,
  });
  assert.equal(fallbackOut, '리모트 세션 추론 번역 완료', 'local-llm must fall back to google-translate when local server is unreachable');
  const mod08 = fs.readFileSync(path.join(RENDERER_DIR, '08-dom-observer.js'), 'utf8');
  assert.ok(mod08.includes('__agySuppressAutoIframeLoad'), 'must guard onIframeLoad to prevent teardownProxyPort freeze');
  assert.ok(mod08.includes('https://www.gstatic.com/antigravity'), 'must load remote iframe scripts from CSP-allowed gstatic mirror');
  assert.ok(mod08.includes('cw.AudioWorklet.prototype.addModule'), 'must stub AudioWorklet.addModule against cross-origin CSP');
  assert.ok(mod08.includes('runFastThoughtAndTriggerScan()'), 'must run fast thought/trigger scan without blocking on full DOM');
  assert.ok(mod08.includes('scanTimerScheduled = true'), 'must coalesce full-DOM localizeStaticUiInRoot via 16ms timer');
});
