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
  assert.ok(bundleCode.includes("const KO_LOCALIZER_VERSION = 'v13.29';"));
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(pkgJson.version, '1.2.34');
  assert.equal(pluginJson.version, pkgJson.version, 'D-0019: plugin.json version must stay synchronized with package.json');
  assert.ok(bundleCode.includes("const DEFAULT_TRANSLATION_PROVIDER = 'google-translate';"));
  assert.ok(bundleCode.includes("const DEFAULT_TRANSLATE_THINKING_ENABLED = true;"));
  assert.ok(bundleCode.includes("'remove-conversation-history'"));
  assert.ok(bundleCode.includes("isNativeVerboseConversationStepsEnabled"));
  assert.ok(bundleCode.includes("'verboseConversationSteps'"));
  assert.ok(!bundleCode.includes("setPrefValue('verboseConversationSteps'"));
  assert.ok(bundleCode.includes("doesWorkedForButtonContainThinking"));
  assert.ok(bundleCode.includes("doesToolGroupButtonContainThinking"));
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'rules', 'AGENTS.md')),
    'rules/AGENTS.md must NOT exist so UI translator never injects global LLM prompt rules'
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, 'dist', 'ko_thought_autoinject.js')),
    'dist/ko_thought_autoinject.js mirror must be generated for statusbar remote companion fallback'
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, 'plugins', 'ko-thought-translator', 'scripts', 'ko_thought_autoinject.js')),
    'plugins/ko-thought-translator/scripts/ko_thought_autoinject.js mirror must be generated for mcp-manager remote companion fallback'
  );
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
  assert.equal(dictSandbox.translateStaticUiSync('Conversation Steps'), '대화 단계 표시');
  assert.equal(dictSandbox.translateStaticUiSync('Verbose'), '상세히');
  assert.equal(dictSandbox.translateStaticUiSync('Waiting for your approval'), '사용자 승인 대기 중');
  assert.equal(dictSandbox.translateStaticUiSync('Exploring'), '탐색 중');
  assert.equal(dictSandbox.translateStaticUiSync('Explored'), '탐색함');
  assert.equal(dictSandbox.translateStaticUiSync('Explored files, ran commands, edited files'), '파일 탐색, 명령 실행, 파일 수정');
  assert.equal(dictSandbox.translateStaticUiSync('Exploring artifacts'), '산출물 탐색 중');
  assert.equal(dictSandbox.translateStaticUiSync('Reading http-engine-client.ts'), '읽는 중: http-engine-client.ts');
  assert.equal(dictSandbox.translateStaticUiSync('Editing App.tsx'), '수정 중: App.tsx');
  assert.equal(dictSandbox.translateStaticUiSync('Listing src/components'), '목록 조회 중: src/components');
  assert.equal(dictSandbox.translateStaticUiSync('Searching authToken'), '검색 중: authToken');
  assert.equal(dictSandbox.translateStaticUiSync('Analyzing main.js'), '분석 중: main.js');
  assert.equal(dictSandbox.translateStaticUiSync('Running npm test'), '실행 중: npm test');

  // 3b. Antigravity Custom MCP Server Manager (#agy-mcp-manager-modal-backdrop & Customizations injected buttons) static & dynamic localization
  assert.equal(dictSandbox.translateStaticUiSync('🔌 Antigravity Custom MCP Server Manager'), '🔌 Antigravity 커스텀 MCP 서버 매니저');
  assert.equal(dictSandbox.translateStaticUiSync('Native RPC Bridge'), '네이티브 RPC 브리지');
  assert.equal(dictSandbox.translateStaticUiSync('Servers & Tools'), '서버 및 도구');
  assert.equal(dictSandbox.translateStaticUiSync('+ Add / Edit Server'), '+ 서버 추가 / 편집');
  assert.equal(dictSandbox.translateStaticUiSync('{ } Raw mcp_config.json'), '{ } mcp_config.json 원문');
  assert.equal(dictSandbox.translateStaticUiSync('+ Custom MCP'), '+ 커스텀 MCP');
  assert.equal(dictSandbox.translateStaticUiSync('+ Add Custom MCP Server'), '+ 사용자 지정 MCP 서버 추가');
  assert.equal(dictSandbox.translateStaticUiSync('Add Custom MCP Server'), '사용자 지정 MCP 서버 추가');
  assert.equal(dictSandbox.translateStaticUiSync('Manage Custom Servers'), '커스텀 서버 관리');
  assert.equal(dictSandbox.translateStaticUiSync('Manage Servers'), '서버 목록 관리');
  assert.equal(dictSandbox.translateStaticUiSync('{ } Edit mcp_config.json'), '{ } mcp_config.json 편집');
  assert.equal(
    dictSandbox.translateStaticUiSync('⚡ Quick Auto-Add (Enter MCP Server URL, GitHub/npm Address, Command, or JSON):'),
    '⚡ 빠른 자동 추가 (MCP 서버 URL, GitHub/npm 주소, 명령어 또는 JSON 입력):'
  );
  assert.equal(dictSandbox.translateStaticUiSync('Auto-Add & Connect'), '자동 추가 및 연결');
  assert.equal(dictSandbox.translateStaticUiSync('Auto-Fill Form'), '폼 자동 채우기');
  assert.equal(dictSandbox.translateStaticUiSync('↻ Refresh All Servers'), '↻ 모든 서버 새로고침');
  assert.equal(dictSandbox.translateStaticUiSync('Save & Connect Server'), '서버 저장 및 연결');
  assert.equal(dictSandbox.translateStaticUiSync('Save mcp_config.json & Refresh'), 'mcp_config.json 저장 및 새로고침');
  assert.equal(dictSandbox.translateStaticUiSync('Custom Servers: 3 | Active Runtime States: 5'), '커스텀 서버: 3개 | 활성 런타임 상태: 5개');
  assert.equal(
    dictSandbox.translateStaticUiSync('Tools (8) — click a tool chip to enable/disable it in mcp_config.json:'),
    '도구 (8개) — 도구 칩을 클릭해 mcp_config.json에서 활성화/비활성화:'
  );
  assert.equal(dictSandbox.translateStaticUiSync('Automatically added and connected "playwright".'), '"playwright" 서버를 자동으로 추가하고 연결했습니다.');
  assert.equal(dictSandbox.translateStaticUiSync('Server "filesystem" enabled.'), '"filesystem" 서버가 활성화되었습니다.');
  assert.equal(dictSandbox.translateStaticUiSync('Tool "read_file" on "filesystem" disabled.'), '"filesystem" 서버의 "read_file" 도구가 비활성화되었습니다.');
  assert.equal(
    dictSandbox.translateStaticUiSync('Loaded preset "📁 Filesystem". Review placeholders before saving.'),
    '"📁 파일시스템 (Filesystem)" 프리셋을 불러왔습니다. 저장하기 전에 입력값을 확인하세요.'
  );
  // 3c. Antigravity Custom MCP Server Manager v1.2.0 (Edit Popup & Authentication UI)
  assert.equal(
    dictSandbox.translateStaticUiSync('⚙️ Edit Custom MCP Server & Authentication'),
    '⚙️ 커스텀 MCP 서버 설정 및 인증 수정'
  );
  assert.equal(dictSandbox.translateStaticUiSync('Select Custom MCP Server to Edit:'), '수정할 커스텀 MCP 서버 선택:');
  assert.equal(dictSandbox.translateStaticUiSync('+ New Custom MCP Server'), '+ 새 커스텀 MCP 서버');
  assert.equal(
    dictSandbox.translateStaticUiSync('🔐 Authentication Settings (Bearer Token / API Key / Basic / OAuth)'),
    '🔐 인증 설정 (Bearer 토큰 / API Key / Basic / OAuth)'
  );
  assert.equal(dictSandbox.translateStaticUiSync('None (No authentication)'), '없음 (인증 미사용)');
  assert.equal(dictSandbox.translateStaticUiSync('🌐 Open Auth URL in Browser'), '🌐 브라우저에서 인증 URL 열기');
  assert.equal(dictSandbox.translateStaticUiSync('Save & Reconnect'), '저장 및 재연결');
  assert.equal(
    dictSandbox.translateStaticUiSync('HTTP https://mcp.example.com/mcp  [🔑 Auth Header Configured]'),
    'HTTP https://mcp.example.com/mcp  [🔑 인증 헤더 설정됨]'
  );
  assert.equal(
    dictSandbox.translateStaticUiSync('Apply this authentication to all 2 custom HTTP servers (alpha, beta)'),
    '이 인증을 2개 커스텀 HTTP 서버 전체에 일괄 적용 (alpha, beta)'
  );
  assert.equal(
    dictSandbox.translateStaticUiSync('Connected (12 tools available)'),
    '연결됨 (사용 가능한 도구 12개)'
  );
  // 3d. Antigravity Custom MCP Server Manager v1.4.0 (OAuth Portal, Settings Tab & Top Menu Bar)
  assert.equal(dictSandbox.translateStaticUiSync('MCP Servers'), 'MCP 서버');
  assert.equal(dictSandbox.translateStaticUiSync('⚙️ Edit Custom MCP Server Settings'), '⚙️ 사용자 지정 MCP 서버 설정 수정');
  assert.equal(dictSandbox.translateStaticUiSync('⚙️ Edit Server Settings'), '⚙️ 서버 설정 수정');
  assert.equal(dictSandbox.translateStaticUiSync('🔗 OAuth / Auth Settings'), '🔗 OAuth / 인증 설정');
  assert.equal(dictSandbox.translateStaticUiSync('🔗 Connect OAuth / Auth'), '🔗 OAuth 연결 / 인증');
  assert.equal(dictSandbox.translateStaticUiSync('Advanced OAuth Settings'), '고급 OAuth 설정');
  assert.equal(
    dictSandbox.translateStaticUiSync('Automatic Discovery & Dynamic Client Registration'),
    '자동 감지 및 동적 클라이언트 등록'
  );
  assert.equal(dictSandbox.translateStaticUiSync('Custom Client ID & Secret'), 'Client ID 및 Secret 직접 입력');
  assert.equal(dictSandbox.translateStaticUiSync('Create & Connect'), '플러그인으로 생성');
  assert.equal(dictSandbox.translateStaticUiSync('Submit Code'), '코드 제출');
  assert.equal(dictSandbox.translateStaticUiSync('Connect github ↗'), 'github 연결 ↗');
  assert.equal(dictSandbox.translateStaticUiSync('🔗 Connect github ↗'), '🔗 github 연결 ↗');
  assert.equal(
    dictSandbox.translateStaticUiSync('HTTP https://mcp.example.com/mcp  [🔗 OAuth Connected]'),
    'HTTP https://mcp.example.com/mcp  [🔗 OAuth 연결됨]'
  );
  assert.equal(
    dictSandbox.translateStaticUiSync(
      'Antigravity uses browser OAuth authentication to interact with the "github" MCP server. Click Connect below to sign in with your account and authorize access.'
    ),
    'Antigravity는 브라우저 OAuth 인증을 사용하여 "github" MCP 서버와 연동합니다. 아래 연결 버튼을 클릭해 계정으로 로그인하고 접근 권한을 승인하세요.'
  );

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
  assert.ok(mod08.includes('__JETSKI_LS_CLIENT_DECORATOR__'), 'must pre-hook __JETSKI_LS_CLIENT_DECORATOR__ on promoted Mobile Chrome iframe');
  assert.ok(mod08.includes('height:100dvh'), 'must enforce 100dvh viewport on Mobile Chrome remote iframe');
  assert.ok(mod08.includes("el.classList.contains('agy-mcp-server-name')"), 'must exclude .agy-mcp-server-name from static UI text node translation');
  assert.ok(mod08.includes("el.classList.contains('agy-mcp-tool-chip')"), 'must exclude .agy-mcp-tool-chip from static UI text node translation');
  assert.ok(mod08.includes("const mcpModal = document.getElementById('agy-mcp-manager-modal-backdrop');"), 'must localize #agy-mcp-manager-modal-backdrop synchronously in fast scan');
  assert.ok(mod08.includes("const mcpEditPopup = document.getElementById('agy-mcp-edit-popup-backdrop');"), 'must localize #agy-mcp-edit-popup-backdrop synchronously in fast scan');
  assert.ok(mod08.includes("const mcpOAuthModal = document.getElementById('agy-mcp-oauth-connect-backdrop');"), 'must localize #agy-mcp-oauth-connect-backdrop synchronously in fast scan');
  assert.ok(mod08.includes('mcp_manager_autoinject.js'), 'must auto-load mcp_manager_autoinject.js on Remote Control web when bookmarklet runs');
  const mod06 = fs.readFileSync(path.join(RENDERER_DIR, '06-settings-modal-ui.js'), 'utf8');
  const renderTranslatorFnMatch = mod06.match(
    /function renderTranslatorSettingsContent\(container, isFullPage = false, isModal = false\)\s*\{[\s\S]*?\r?\n  \}/
  );
  assert.ok(renderTranslatorFnMatch, 'renderTranslatorSettingsContent must exist in 06-settings-modal-ui.js');
  assert.ok(
    !renderTranslatorFnMatch[0].includes('agy-ko-show-thinking-switch') &&
      !renderTranslatorFnMatch[0].includes('Thinking (추론 과정) 표시'),
    'renderTranslatorSettingsContent (#agy-ko-translator-modal & #agy-ko-settings-pane) must NOT include Thinking (추론 과정) 표시 toggle (separated into dedicated menus)'
  );
  assert.ok(mod06.includes('agy-ko-translate-thinking-switch'), 'modal must include Thinking Korean translation ON/OFF toggle switch');
  assert.ok(mod06.includes('window.__agySetTranslateThinking'), 'modal Thinking translation toggle must invoke window.__agySetTranslateThinking');
  assert.ok(mod06.includes('@media (max-width: 640px)'), 'must include mobile responsive rules for translator modal');
  assert.ok(mod06.includes('.agy-ko-card') && mod06.includes('.agy-ko-title') && mod06.includes('.agy-ko-desc'), 'must use self-contained CSS layout classes for Tailwind-less Remote Control host');
  assert.ok(mod06.includes('.agy-ko-row.agy-ko-row-inline') && mod06.includes('.agy-ko-row.agy-ko-row-top'), 'must override .agy-ko-row column direction with flex-direction: row on inline/top rows');
  assert.ok(!mod06.includes('flex: 1 1 200px'), 'must not use flex-basis: 200px on .agy-ko-info (causes 200px vertical gap if parent is column)');
  assert.ok(mod06.includes('renderTranslatorSettingsContent(body, false, true)'), 'modal must pass isModal=true to omit duplicate section heading');
  assert.ok(mod06.includes('ensureThinkingDisplayMenuIntegration'), 'must provide ensureThinkingDisplayMenuIntegration for dedicated Model Selector & Appearance > Chat menus');
  assert.ok(mod06.includes('agy-ko-model-menu-show-thinking'), 'must inject Thinking display toggle into model-selector-panel');
  assert.ok(mod06.includes('agy-ko-appearance-show-thinking'), 'must inject Thinking display toggle into Appearance > Chat settings card');
  assert.ok(mod06.includes('agy-ko-show-thinking-switch'), 'dedicated menus must include Thinking display ON/OFF toggle switch');
  assert.ok(mod06.includes('window.__agySetShowThinking'), 'dedicated Thinking toggle must invoke window.__agySetShowThinking');
  assert.ok(!mod06.includes("insertBefore(cardEl, permEl)"), 'must not inject #agy-ko-settings-card into General tab');
  assert.ok(mod06.includes('height: 100dvh !important'), 'must enforce 100dvh on ga-remote-control .app-container');

  // 5. D-0012: ensureVerboseConversationStepsEnabled NEVER overwrites native verboseConversationSteps, and isNativeVerboseConversationStepsEnabled reads the native setting cleanly
  const mod01 = fs.readFileSync(path.join(RENDERER_DIR, '01-bootstrap-and-cache.js'), 'utf8');
  let verbosePrefVal = false;
  let setPrefCalls = [];
  const mockProviderFiber = {
    memoizedProps: {
      value: {
        getState: () => ({
          getPrefValue: (k) => (k === 'verboseConversationSteps' ? verbosePrefVal : undefined),
          setPrefValue: (k, v) => {
            setPrefCalls.push([k, v]);
            if (k === 'verboseConversationSteps') verbosePrefVal = v;
            return Promise.resolve();
          },
        }),
        onDidChange: () => () => {},
      },
    },
    return: null,
  };
  const mockAnchor = {
    __reactFiber$xyz: {
      memoizedProps: {},
      return: mockProviderFiber,
    },
  };
  const bootSandbox = {
    window: { location: { origin: 'vscode-file://vscode-app' } },
    document: {
      querySelector: (sel) => (sel.includes('conversation-view') ? mockAnchor : null),
      body: {},
    },
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.runInNewContext(
    `${mod01}\n;globalThis.__ensureVerbose = ensureVerboseConversationStepsEnabled;globalThis.__isNativeVerbose = isNativeVerboseConversationStepsEnabled;`,
    bootSandbox
  );
  bootSandbox.__ensureVerbose();
  assert.deepEqual(setPrefCalls, [], 'D-0012: ensureVerboseConversationStepsEnabled must NEVER call setPrefValue("verboseConversationSteps", true)');
  assert.equal(verbosePrefVal, false, 'D-0012: native verboseConversationSteps=false (Default) must remain untouched');
  assert.equal(bootSandbox.__isNativeVerbose(), false, 'D-0012: isNativeVerboseConversationStepsEnabled must return false when native setting is Default');
  verbosePrefVal = true;
  assert.equal(bootSandbox.__isNativeVerbose(), true, 'D-0012: isNativeVerboseConversationStepsEnabled must return true when native setting is Verbose');

  // 6. processTriggerButton NEVER clears origSpan.textContent (prevents React removeChild Black Screen crash) and strips [data-slot-out] animation residue
  assert.ok(mod08.includes('const liveText = extractTriggerSpanRawText(origSpan);'), 'must extract live text via extractTriggerSpanRawText');
  assert.ok(mod08.includes('origSpan.__agyOrigLabelText = rawText;'), 'must preserve original label text on origSpan.__agyOrigLabelText');
  assert.ok(!mod08.includes("origSpan.textContent = '';"), 'must NEVER clear origSpan.textContent (detaching React child fibers causes NotFoundError removeChild black screen)');
  assert.ok(mod08.includes('!btn.__agyUserCollapsed'), 'must re-expand collapsed buttons unless user manually collapsed them');

  const extractFnMatch = mod08.match(/function extractTriggerSpanRawText\(origSpan\)\s*\{[\s\S]*?\r?\n  \}/);
  const processBtnMatch = mod08.match(/function processTriggerButton\(btn\)\s*\{[\s\S]*?\r?\n  \}/);
  assert.ok(extractFnMatch && processBtnMatch, 'extractTriggerSpanRawText and processTriggerButton must exist');
  const triggerSandbox = {
    translateStaticUiSync: dictSandbox.translateStaticUiSync,
    document: {
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          className: '',
          textContent: '',
          style: {},
          classList: {
            contains(cls) {
              return String(this.className || '').split(/\s+/).includes(cls);
            },
          },
          getAttribute() {
            return null;
          },
          setAttribute() {},
        };
      },
    },
  };
  vm.runInNewContext(
    `${extractFnMatch[0]}\n${processBtnMatch[0]}\n;globalThis.__processTriggerButton = processTriggerButton;`,
    triggerSandbox
  );
  const mockSpans = [];
  const origSpan = {
    className: 'text-muted-foreground',
    textContent: 'Thinking for 1s',
    style: {},
    attrs: {},
    classList: { contains: (c) => c === 'text-muted-foreground' },
    getAttribute(k) {
      return this.attrs[k] || null;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    insertAdjacentElement(pos, el) {
      el.classList = {
        contains: (c) => String(el.className || '').split(/\s+/).includes(c),
      };
      mockSpans.push(el);
    },
  };
  mockSpans.push(origSpan);
  const mockBtn = {
    querySelectorAll: () => mockSpans,
  };
  triggerSandbox.__processTriggerButton(mockBtn);
  assert.equal(origSpan.textContent, 'Thinking for 1s', 'origSpan.textContent must remain intact so React child fibers are never detached');
  assert.equal(origSpan.style.display, 'none');
  assert.equal(origSpan.attrs['data-agy-orig-label'], '1');
  assert.equal(origSpan.__agyOrigLabelText, 'Thinking for 1s');
  assert.equal(mockSpans[1].textContent, '1초 동안 생각하는 중');

  // Simulate React updating origSpan.textContent to "Thought for 8s" and removing animate-shimmer-text on completion
  origSpan.className = 'animate-shimmer-text text-muted-foreground';
  triggerSandbox.__processTriggerButton(mockBtn);
  assert.equal(mockSpans[1].className, 'animate-shimmer-text text-muted-foreground agy-ko-trigger-label');

  origSpan.className = 'text-muted-foreground';
  origSpan.textContent = 'Thought for 8s';
  triggerSandbox.__processTriggerButton(mockBtn);
  assert.equal(origSpan.textContent, 'Thought for 8s', 'origSpan.textContent must remain intact after completion update');
  assert.equal(origSpan.__agyOrigLabelText, 'Thought for 8s');
  assert.equal(mockSpans[1].textContent, '8초 동안 생각함');
  assert.equal(
    mockSpans[1].className,
    'text-muted-foreground agy-ko-trigger-label',
    'must synchronize koSpan.className with origSpan.className to stop stale shimmer flicker after completion'
  );
  assert.ok(!mod08.includes("wrap.textContent = '';"), 'processCursorEdit must update slots in-place without clearing wrap.textContent (prevents streaming flicker)');
  assert.ok(mod06.includes('data-agy-auto-expanded="1"'), 'STYLE_CSS must suppress enter transition flicker on auto-expanded collapsibles');

  // Simulate <CZb> (s_) 320ms slot transition ("Analyzing" out, "Analyzed" in)
  origSpan.textContent = 'AnalyzingAnalyzed';
  origSpan.querySelector = (sel) => (sel === '[data-slot-out]' ? {} : null);
  origSpan.cloneNode = () => ({
    textContent: 'Analyzed',
    querySelectorAll: () => [{ remove() {} }],
  });
  triggerSandbox.__processTriggerButton(mockBtn);
  assert.equal(origSpan.__agyOrigLabelText, 'Analyzed');
  assert.equal(mockSpans[1].textContent, '분석함');

  // 7. doesToolGroupButtonContainThinking, 3-tier collapsible auto-expand, and re-expand after React G_ auto-collapse (unless user-collapsed)
  const toolGrpFnMatch = mod08.match(/function doesToolGroupButtonContainThinking\(btn\)\s*\{[\s\S]*?\r?\n  \}/);
  const workedFnMatch = mod08.match(/function doesWorkedForButtonContainThinking\(btn\)\s*\{[\s\S]*?\r?\n  \}/);
  const hiddenActiveFnMatch = mod08.match(/function isHiddenActiveWorkedForButton\(btn\)\s*\{[\s\S]*?\r?\n  \}/);
  const workedActiveFnMatch = mod08.match(/function isWorkedForInActiveOrLatestTurn\(btn, isLastInDomList\)\s*\{[\s\S]*?\r?\n  \}/);
  const toolGrpActiveFnMatch = mod08.match(/function isToolGroupInActiveOrLatestTurn\(btn, workedBtns\)\s*\{[\s\S]*?\r?\n  \}/);
  const thinkingActiveFnMatch = mod08.match(/function isThinkingTriggerInActiveOrLatestTurn\(btn, workedBtns, thinkingBtns\)\s*\{[\s\S]*?\r?\n  \}/);
  const expandBtnFnMatch = mod08.match(/function expandTriggerButtonIfNeeded\(btn\)\s*\{[\s\S]*?\r?\n  \}/);
  const clickCapFnMatch = mod08.match(/function onTriggerButtonClickCapture\(e\)\s*\{[\s\S]*?\r?\n  \}/);
  const collapseBtnFnMatch = mod08.match(/function collapseTriggerButtonIfNeeded\(btn\)\s*\{[\s\S]*?\r?\n  \}/);
  const scanBtnsMatch = mod08.match(/function scanTriggerButtonsSync\(forceCollapseAll = false\)\s*\{[\s\S]*?\r?\n  \}/);
  assert.ok(
    toolGrpFnMatch &&
      workedFnMatch &&
      hiddenActiveFnMatch &&
      workedActiveFnMatch &&
      toolGrpActiveFnMatch &&
      thinkingActiveFnMatch &&
      expandBtnFnMatch &&
      collapseBtnFnMatch &&
      clickCapFnMatch &&
      scanBtnsMatch,
    '3-tier collapsible expand/collapse and active-turn hidden worked-for protection functions must exist in 08-dom-observer.js'
  );
  assert.ok(mod06.includes('html[data-agy-hide-thinking="1"]'), 'STYLE_CSS must hide thinking trigger and .cursor-edit when data-agy-hide-thinking="1"');

  let clickedOrder = [];
  const makeCollapsibleBtn = (fiberKey, fiberVal, expanded = 'false', isHidden = false) => ({
    [fiberKey]: fiberVal,
    expandedState: expanded,
    attrs: {},
    classList: {
      contains: (c) => (c === 'hidden' ? isHidden : false),
    },
    querySelectorAll: () => [],
    closest() {
      return this;
    },
    getAttribute(k) {
      return k === 'aria-expanded' ? this.expandedState : this.attrs[k] || null;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    click() {
      clickedOrder.push(fiberKey);
      this.expandedState = this.expandedState === 'true' ? 'false' : 'true';
    },
  });

  // Historical completed worked-for button: D-0013 ensures it is NOT force-expanded on session switch!
  const workedWithThinking = makeCollapsibleBtn('__reactFiber$worked1', {
    memoizedProps: { segment: { steps: [{ step: { value: { thinking: 'Step 1 thought' } } }] } },
  });
  const activeHiddenWorked = makeCollapsibleBtn(
    '__reactFiber$workedActiveHidden',
    {
      memoizedProps: { triggerVisible: false, segment: { steps: [{ step: { value: { thinking: 'Active turn thought' } } }] } },
    },
    'true',
    true
  );
  // KO-BUG-01: Historical completed tool-group whose ancestor Lhc fiber (depth 8) has conversation-wide `isRunning: true`
  // while its own turn has `isRunning: false, isActive: false` at depth 2 and `isLastContainer: false, segment: { isLatest: false }` at depth 8.
  const historicalToolGroupInRunningConv = makeCollapsibleBtn('__reactFiber$toolGrpHist', {
    memoizedProps: {},
    return: {
      memoizedProps: {},
      return: {
        // yhc at depth 2
        memoizedProps: { isRunning: false, isActive: false },
        return: {
          memoizedProps: {},
          return: {
            // Lhc at depth 4
            memoizedProps: { isRunning: true, isLastContainer: false, segment: { isLatest: false } },
            return: null,
          },
        },
      },
    },
  });
  const toolGroupWithThinking = makeCollapsibleBtn('__reactFiber$toolGrp1', {
    memoizedProps: { isLastTurn: true, steps: [{ step: { value: { thinking: 'Intermediate tool thought' } } }] },
  });
  const toolGroupWithoutThinking = makeCollapsibleBtn('__reactFiber$toolGrp2', {
    memoizedProps: { isLastTurn: true, steps: [{ step: { value: { thinking: '' } } }] },
  });
  // KO-BUG-02 & KO-NEW-BUG-01: Realistic Antigravity v2.29.0 Fiber hierarchy (`button` i=0 -> `<div.relative>` i=1 -> `<G_ isActive>` i=2 -> `<A6b>` i=3 -> `<Lhc isLastContainer segment.isLatest>` i=4).
  const historicalThinkingTriggerBtn = makeCollapsibleBtn('__reactFiber$thinkingHist', {
    memoizedProps: {},
    return: {
      memoizedProps: {},
      return: {
        // G_ at depth 2
        memoizedProps: { isActive: false },
        return: {
          // A6b at depth 3
          memoizedProps: {},
          return: {
            // Lhc at depth 4
            memoizedProps: { isRunning: true, isLastContainer: false, segment: { isLatest: false } },
            return: null,
          },
        },
      },
    },
  });
  const thinkingGWrapperProps = { isActive: true };
  const thinkingTriggerBtn = makeCollapsibleBtn('__reactFiber$thinking1', {
    memoizedProps: {},
    return: {
      memoizedProps: {},
      return: {
        // G_ at depth 2: transitions isActive: true -> false when thinking step finishes streaming!
        memoizedProps: thinkingGWrapperProps,
        return: {
          // A6b at depth 3
          memoizedProps: {},
          return: {
            // Lhc at depth 4: carries turn-level isLastContainer: true, segment: { isLatest: true }
            memoizedProps: { isRunning: true, isLastContainer: true, segment: { isLatest: true } },
            return: null,
          },
        },
      },
    },
  });

  let showThinkingFlag = true;
  let nativeVerboseStepsFlag = true;
  const expandSandbox = {
    ensureStyle() {},
    processTriggerButton() {},
    syncShowThinkingDomAttribute() {},
    isShowThinkingEnabled: () => showThinkingFlag,
    isNativeVerboseConversationStepsEnabled: () => nativeVerboseStepsFlag,
    document: {
      querySelectorAll(sel) {
        if (sel.includes('worked-for-collapsible')) return [workedWithThinking, activeHiddenWorked];
        if (sel.includes('tool-group-collapsible')) return [historicalToolGroupInRunningConv, toolGroupWithThinking, toolGroupWithoutThinking];
        if (sel.includes('thinking-collapsible-trigger')) return [historicalThinkingTriggerBtn, thinkingTriggerBtn];
        return [];
      },
    },
  };
  vm.runInNewContext(
    `${workedFnMatch[0]}\n${toolGrpFnMatch[0]}\n${hiddenActiveFnMatch[0]}\n${workedActiveFnMatch[0]}\n${toolGrpActiveFnMatch[0]}\n${thinkingActiveFnMatch[0]}\n${expandBtnFnMatch[0]}\n${collapseBtnFnMatch[0]}\n${clickCapFnMatch[0]}\n${scanBtnsMatch[0]}\n;globalThis.__scanTriggerButtonsSync = scanTriggerButtonsSync;globalThis.__doesToolGroupContainThinking = doesToolGroupButtonContainThinking;globalThis.__isWorkedActive = isWorkedForInActiveOrLatestTurn;globalThis.__isToolGrpActive = isToolGroupInActiveOrLatestTurn;globalThis.__isThinkingActive = isThinkingTriggerInActiveOrLatestTurn;globalThis.__onTriggerClick = onTriggerButtonClickCapture;`,
    expandSandbox
  );
  assert.equal(expandSandbox.__doesToolGroupContainThinking(toolGroupWithThinking), true);
  assert.equal(expandSandbox.__doesToolGroupContainThinking(toolGroupWithoutThinking), false);
  assert.equal(
    expandSandbox.__isToolGrpActive(historicalToolGroupInRunningConv, [workedWithThinking, activeHiddenWorked]),
    false,
    'KO-BUG-01: isToolGroupInActiveOrLatestTurn must NOT return true for historical completed turns even when conversation-wide Lhc.isRunning === true'
  );
  assert.equal(
    expandSandbox.__isToolGrpActive(makeCollapsibleBtn('__reactFiber$orphan', {}), []),
    false,
    'KO-BUG-01: isToolGroupInActiveOrLatestTurn fallback must return false when workedBtns is empty or no active/latest signal exists'
  );
  assert.equal(
    expandSandbox.__isThinkingActive(
      historicalThinkingTriggerBtn,
      [workedWithThinking, activeHiddenWorked],
      [historicalThinkingTriggerBtn, thinkingTriggerBtn]
    ),
    false,
    'KO-BUG-02: isThinkingTriggerInActiveOrLatestTurn must return false for historical completed thinking triggers'
  );
  expandSandbox.__scanTriggerButtonsSync();
  assert.deepEqual(
    clickedOrder,
    ['__reactFiber$toolGrp1', '__reactFiber$toolGrp2', '__reactFiber$thinking1'],
    'D-0013 & KO-BUG-01/02: must NOT force-expand historical completed workedWithThinking, historicalToolGroupInRunningConv, or historicalThinkingTriggerBtn on session switch'
  );

  // Simulate React G_ collapsing toolGroupWithThinking, toolGroupWithoutThinking & thinkingTriggerBtn when step finishes (isActive: true -> false at depth 2 <G_>)
  clickedOrder = [];
  thinkingGWrapperProps.isActive = false;
  toolGroupWithThinking.expandedState = 'false';
  toolGroupWithoutThinking.expandedState = 'false';
  thinkingTriggerBtn.expandedState = 'false';
  assert.equal(
    expandSandbox.__isThinkingActive(
      thinkingTriggerBtn,
      [workedWithThinking, activeHiddenWorked],
      [historicalThinkingTriggerBtn, thinkingTriggerBtn]
    ),
    true,
    'KO-NEW-BUG-01: isThinkingTriggerInActiveOrLatestTurn must still return true when <G_> at depth 2 sets isActive:false on completion while <Lhc> at depth 4 has isLastContainer:true'
  );
  // Also verify DOM fallback is reachable when <G_> IS active (or lacks sawLocalActiveFalse) and no higher Lhc fiber exists,
  // whereas when depth 2 <G_> has isActive:false (sawLocalActiveFalse === true) and no latest turn container proves it is in the latest turn,
  // DOM fallback returns false so historical completed thinking blocks are NEVER force-expanded when a new turn starts (KO-NEW-BUG-01-RESIDUAL / D-0013).
  const domFallbackActiveThinkingBtn = makeCollapsibleBtn('__reactFiber$thinkingDomFallbackActive', {
    memoizedProps: {},
    return: null,
  });
  assert.equal(
    expandSandbox.__isThinkingActive(domFallbackActiveThinkingBtn, [], [historicalThinkingTriggerBtn, domFallbackActiveThinkingBtn]),
    true,
    'KO-NEW-BUG-01: DOM fallback must return true for the last thinking button when sawLocalActiveFalse is false and no higher Lhc fiber exists'
  );
  const domFallbackInactiveHistoricalBtn = makeCollapsibleBtn('__reactFiber$thinkingDomFallbackInactive', {
    memoizedProps: {},
    return: {
      memoizedProps: {},
      return: {
        memoizedProps: { isActive: false },
        return: null,
      },
    },
  });
  assert.equal(
    expandSandbox.__isThinkingActive(domFallbackInactiveHistoricalBtn, [], [historicalThinkingTriggerBtn, domFallbackInactiveHistoricalBtn]),
    false,
    'KO-NEW-BUG-01-RESIDUAL (D-0013): DOM fallback must return false when depth 2 <G_> has isActive:false and no latest turn container proves it is in the latest turn'
  );

  // KO-NEW-BUG-01-RESIDUAL: Verify realistic 26+ depth <u_> (CascadeStepItem -> KZb -> div.flex-row -> div.min-w-0 -> JZb -> HZb -> GZb -> wZb.Provider -> IZb -> plannerResponse.renderer -> div.flex-col -> A6b -> G_ -> div.relative -> button) hierarchy:
  // 1) Historical completed turn's <u_> thinking button with <G_ isActive:false> at depth 2, <Lhc isLastContainer:false, segment:{isLatest:false}> at depth 26, and <pCb container:{isLatest:false}> at depth 30 must return FALSE.
  // 2) Latest turn with TWO <u_> thinking buttons where the 1st thinking step finished (<G_ isActive:false> at depth 2) and the 2nd thinking step mounted (<G_ isActive:true> at depth 2), both sharing <Lhc isLastContainer:true, segment:{isLatest:true}> at depth 26 and <pCb container:{isLatest:true}> at depth 30, must return TRUE for BOTH buttons!
  const buildDeepCascadeStepFiber = (gActive, lhcDepth, isLastLhc, pCbDepth, isLatestPCb) => {
    const pCbFiber = {
      memoizedProps: { container: { isLatest: isLatestPCb } },
      return: null,
    };
    let topChain = pCbFiber;
    for (let d = pCbDepth - 1; d > lhcDepth; d--) {
      topChain = { memoizedProps: {}, return: topChain };
    }
    const lhcFiber = {
      memoizedProps: { isRunning: true, isLastContainer: isLastLhc, segment: { isLatest: isLastLhc } },
      return: topChain,
    };
    let curChain = lhcFiber;
    for (let d = lhcDepth - 1; d >= 3; d--) {
      curChain = { memoizedProps: {}, return: curChain };
    }
    // depth 2: <G_ isActive={gActive}>
    const gFiber = {
      memoizedProps: { isActive: gActive },
      return: curChain,
    };
    // depth 1: <div.relative>
    const relFiber = {
      memoizedProps: {},
      return: gFiber,
    };
    // depth 0: <button>
    return {
      memoizedProps: {},
      return: relFiber,
    };
  };
  const deepHistThinkingBtn = makeCollapsibleBtn(
    '__reactFiber$deepHist26',
    buildDeepCascadeStepFiber(false, 26, false, 30, false)
  );
  const deepLatestFirstCompletedThinkingBtn = makeCollapsibleBtn(
    '__reactFiber$deepLatestFirst26',
    buildDeepCascadeStepFiber(false, 26, true, 30, true)
  );
  const deepLatestSecondActiveThinkingBtn = makeCollapsibleBtn(
    '__reactFiber$deepLatestSecond26',
    buildDeepCascadeStepFiber(true, 26, true, 30, true)
  );
  const deepThinkingList = [
    deepHistThinkingBtn,
    deepLatestFirstCompletedThinkingBtn,
    deepLatestSecondActiveThinkingBtn,
  ];
  assert.equal(
    expandSandbox.__isThinkingActive(deepHistThinkingBtn, [], deepThinkingList),
    false,
    'KO-NEW-BUG-01-RESIDUAL (D-0013): 26-depth <u_> historical completed thinking button must return false'
  );
  assert.equal(
    expandSandbox.__isThinkingActive(deepLatestFirstCompletedThinkingBtn, [], deepThinkingList),
    true,
    'KO-NEW-BUG-01-RESIDUAL (D-0002 & D-0005): 1st completed thinking button (isActive:false at depth 2) in latest turn (<Lhc> at depth 26) must return true even when 2nd thinking button is mounted after it'
  );
  assert.equal(
    expandSandbox.__isThinkingActive(deepLatestSecondActiveThinkingBtn, [], deepThinkingList),
    true,
    'KO-NEW-BUG-01-RESIDUAL: 2nd active thinking button in latest turn (<Lhc> at depth 26) must return true'
  );

  // Also verify [data-turn-content="latest"] and [data-testid="user-message-bubble"] DOM fallback guards
  const latestTurnWrapperBtn = makeCollapsibleBtn('__reactFiber$inLatestTurnAttr', { memoizedProps: {}, return: null });
  const oldTurnBeforeUserBubbleBtn = makeCollapsibleBtn('__reactFiber$beforeUserBubble', { memoizedProps: {}, return: null });
  const mockUserBubble = {};
  oldTurnBeforeUserBubbleBtn.compareDocumentPosition = (other) => (other === mockUserBubble ? 4 : 0);
  expandSandbox.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
  expandSandbox.document.querySelector = (sel) =>
    sel === '[data-turn-content="latest"]'
      ? { contains: (el) => el === latestTurnWrapperBtn }
      : null;
  assert.equal(
    expandSandbox.__isThinkingActive(latestTurnWrapperBtn, [], [latestTurnWrapperBtn, oldTurnBeforeUserBubbleBtn]),
    true,
    'KO-NEW-BUG-01-RESIDUAL: [data-turn-content="latest"] wrapper must immediately identify buttons inside the latest turn'
  );
  assert.equal(
    expandSandbox.__isThinkingActive(oldTurnBeforeUserBubbleBtn, [], [latestTurnWrapperBtn, oldTurnBeforeUserBubbleBtn]),
    false,
    'KO-NEW-BUG-01-RESIDUAL: [data-turn-content="latest"] wrapper must immediately reject buttons outside the latest turn'
  );
  expandSandbox.document.querySelector = () => null;
  const origQsa = expandSandbox.document.querySelectorAll;
  expandSandbox.document.querySelectorAll = (sel) =>
    sel === '[data-testid="user-message-bubble"]' ? [mockUserBubble] : origQsa(sel);
  assert.equal(
    expandSandbox.__isThinkingActive(oldTurnBeforeUserBubbleBtn, [], [oldTurnBeforeUserBubbleBtn]),
    false,
    'KO-NEW-BUG-01-RESIDUAL: DOM fallback must return false when a subsequent [data-testid="user-message-bubble"] follows the button'
  );
  expandSandbox.document.querySelectorAll = origQsa;
  expandSandbox.__scanTriggerButtonsSync();
  assert.deepEqual(
    clickedOrder,
    ['__reactFiber$toolGrp1', '__reactFiber$toolGrp2', '__reactFiber$thinking1'],
    'must automatically re-expand active/latest turn tool-group-collapsibles and thinkingTriggerBtn when React G_ collapses active step on completion'
  );

  // Simulate user manually clicking thinkingTriggerBtn while expanded ('true') -> records __agyUserCollapsed = true
  clickedOrder = [];
  assert.equal(thinkingTriggerBtn.getAttribute('data-agy-auto-expanded'), '1');
  expandSandbox.__onTriggerClick({ target: thinkingTriggerBtn, isTrusted: true });
  thinkingTriggerBtn.expandedState = 'false';
  assert.equal(thinkingTriggerBtn.__agyUserCollapsed, true);
  assert.equal(thinkingTriggerBtn.getAttribute('data-agy-auto-expanded'), null);
  expandSandbox.__scanTriggerButtonsSync();
  assert.deepEqual(clickedOrder, [], 'must respect manual user collapse and not re-open');

  // Simulate turning Show Thinking OFF (showThinkingFlag = false) ->
  // MUST NEVER collapse activeHiddenWorked (.hidden) or toolGroup buttons (which hold work items like Analyzed/Ran/Edited),
  // and must only collapse thinkingTriggerBtn (plus older auto-expanded worked-for if forceCollapseAll=true).
  showThinkingFlag = false;
  workedWithThinking.expandedState = 'true';
  workedWithThinking.__agyAutoExpanded = true;
  thinkingTriggerBtn.expandedState = 'true';
  clickedOrder = [];
  expandSandbox.__scanTriggerButtonsSync(true);
  assert.deepEqual(
    clickedOrder,
    ['__reactFiber$worked1', '__reactFiber$thinking1'],
    'when Show Thinking is OFF, must collapse thinkingTriggerBtn and older auto-expanded worked-for, but NEVER collapse activeHiddenWorked or tool-group-collapsible'
  );
  assert.equal(activeHiddenWorked.expandedState, 'true', 'active hidden worked-for button must remain expanded so latest message work steps never disappear');
  assert.equal(toolGroupWithThinking.expandedState, 'true', 'tool-group-collapsible must remain expanded so Analyzed/Ran/Edited work steps remain visible');
  assert.equal(thinkingTriggerBtn.expandedState, 'false', 'thinking-collapsible-trigger must be collapsed when Show Thinking is OFF');

  // Even if activeHiddenWorked was accidentally collapsed ('false') while Show Thinking is OFF, scanTriggerButtonsSync must immediately re-expand it
  activeHiddenWorked.expandedState = 'false';
  clickedOrder = [];
  expandSandbox.__scanTriggerButtonsSync(false);
  assert.deepEqual(clickedOrder, ['__reactFiber$workedActiveHidden']);
  assert.equal(activeHiddenWorked.expandedState, 'true');

  // Even if the latest worked-for button is visible (not .hidden) and has NO thinking step in its fiber,
  // and toolGroupWithoutThinking is collapsed while Show Thinking is OFF, scanTriggerButtonsSync must expand both
  // so the user's latest message work items (Analyzed/Ran/Edited) never disappear (D-0005).
  const latestWorkedNoThinking = makeCollapsibleBtn('__reactFiber$workedLatestNoThinking', {
    memoizedProps: { segment: { steps: [{ step: { value: { thinking: '' } } }] } },
  });
  toolGroupWithoutThinking.expandedState = 'false';
  expandSandbox.document.querySelectorAll = (sel) => {
    if (sel.includes('worked-for-collapsible')) return [workedWithThinking, latestWorkedNoThinking];
    if (sel.includes('tool-group-collapsible')) return [toolGroupWithThinking, toolGroupWithoutThinking];
    if (sel.includes('thinking-collapsible-trigger')) return [thinkingTriggerBtn];
    return [];
  };
  clickedOrder = [];
  expandSandbox.__scanTriggerButtonsSync(false);
  assert.deepEqual(
    clickedOrder,
    ['__reactFiber$workedLatestNoThinking', '__reactFiber$toolGrp2'],
    'D-0005: when Show Thinking is OFF and native Verbose is ON, latest worked-for-collapsible and tool-group-collapsible without thinking must still expand so tool work items never unmount'
  );

  // D-0012: When native 'Conversation Steps' is set to 'Default' (nativeVerboseStepsFlag = false),
  // scanTriggerButtonsSync must NOT force-expand worked-for-collapsible or tool-group-collapsible buttons!
  nativeVerboseStepsFlag = false;
  workedWithThinking.expandedState = 'false';
  latestWorkedNoThinking.expandedState = 'false';
  toolGroupWithThinking.expandedState = 'false';
  toolGroupWithoutThinking.expandedState = 'false';
  clickedOrder = [];
  expandSandbox.__scanTriggerButtonsSync(false);
  assert.deepEqual(
    clickedOrder,
    [],
    'D-0012: when native verboseConversationSteps is false (Default), scanTriggerButtonsSync must NOT auto-expand worked-for-collapsible or tool-group-collapsible'
  );
  nativeVerboseStepsFlag = true;

  // 7b. Translate Thinking ON/OFF toggle (__agySetTranslateThinking): restores original English .cursor-edit when OFF
  const restoreCursorFnMatch = mod08.match(/function restoreOriginalCursorEdits\(\)\s*\{[\s\S]*?\r?\n  \}/);
  assert.ok(restoreCursorFnMatch, 'restoreOriginalCursorEdits must exist in 08-dom-observer.js');
  let wrapRemoved = false;
  const mockCursorEdit = {
    __agyAbortCtrl: { abort() {} },
    __agyLastSnapshot: 'cached',
    __agyPendingSnapshot: 'pending',
    attrs: { 'data-agy-ko-ready': '1' },
    querySelector: (sel) => (sel.includes('.agy-ko-thought-wrap') ? { remove() { wrapRemoved = true; } } : null),
    querySelectorAll: (sel) => (sel === '.agy-ko-thought-wrap' ? [{ remove() { wrapRemoved = true; } }] : []),
    removeAttribute(k) {
      delete this.attrs[k];
    },
  };
  const restoreSandbox = {
    adapterQueue: [],
    document: {
      querySelectorAll: (sel) => (sel === '.cursor-edit' ? [mockCursorEdit] : []),
    },
    clearTimeout,
  };
  vm.runInNewContext(`${restoreCursorFnMatch[0]}\n;globalThis.__restoreOriginalCursorEdits = restoreOriginalCursorEdits;`, restoreSandbox);
  restoreSandbox.__restoreOriginalCursorEdits();
  assert.equal(wrapRemoved, true, 'restoreOriginalCursorEdits must remove .agy-ko-thought-wrap');
  assert.equal(mockCursorEdit.attrs['data-agy-ko-ready'], undefined, 'restoreOriginalCursorEdits must remove data-agy-ko-ready so original English children become visible');

  // 8. Translation provider persistence guard: never overwrite user-selected provider with local-llm on reinjection or showThinking/pretranslate toggles
  const mod05 = fs.readFileSync(path.join(RENDERER_DIR, '05-fiber-pretranslator.js'), 'utf8');
  assert.ok(
    !mod05.includes('[PROVIDER_STORAGE_KEY]: activeTranslationProvider'),
    '05-fiber-pretranslator.js must never overwrite PROVIDER_STORAGE_KEY inside __agySetShowThinking or __agySetPretranslate'
  );
  const { buildRuntimeConfiguredBundle } = require(BUNDLE_INJECTOR_PATH);
  const defaultConfiguredBundle = buildRuntimeConfiguredBundle();
  assert.ok(
    defaultConfiguredBundle.includes("const DEFAULT_TRANSLATION_PROVIDER = 'google-translate';"),
    'buildRuntimeConfiguredBundle() with no arguments must preserve stored google-translate instead of resetting to local-llm'
  );

  let providerSetCalls = [];
  const reinjectSandbox = {
    window: {
      __agyKoLocalizerActive: 'v13.29',
      __agyKoThoughtCleanup: () => {},
      __agyRetranslateVisibleThoughts: () => {},
      __agySetShowThinking: () => {},
      __agyTranslateStaticUiSync: (s) => {
        if (s === 'Open IDE') return 'IDE 열기';
        if (s === 'Exited with code 0') return '종료 코드 0';
        if (s === '2 subagents/tasks running') return '서브에이전트/작업 2개 실행 중';
        if (s === 'CLI Project') return 'CLI 프로젝트';
        if (s === 'Local Checkout') return '로컬 체크아웃';
        if (s === 'Type') return '유형';
        return null;
      },
      __agyLastDefaultPretranslate: false,
      __agyLastDefaultProvider: 'local-llm',
      __agySetTranslationProvider(p) {
        providerSetCalls.push(p);
      },
    },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      body: {},
    },
    localStorage: {
      getItem: (k) => (k === 'agy-ko-thought-provider' ? 'google-translate' : null),
      setItem() {},
    },
  };
  vm.runInNewContext(
    `${mod01}\n;globalThis.__prepareResult = prepareBootstrapLifecycle();`,
    reinjectSandbox
  );
  assert.equal(reinjectSandbox.__prepareResult, false);
  assert.deepEqual(
    providerSetCalls,
    [],
    'prepareBootstrapLifecycle must not overwrite explicit saved provider in localStorage when bundle default changes'
  );

  // 9. Dedicated Thinking display menu integration: Model Selector dropdown footer & Native Settings Appearance > Chat card
  let menuShowThinkingState = true;
  const createdElements = [];
  const makeDomEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      attrs: {},
      children: [],
      parentElement: null,
      onclick: null,
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      getAttribute(k) {
        return this.attrs[k] ?? null;
      },
      appendChild(ch) {
        ch.parentElement = this;
        this.children.push(ch);
        return ch;
      },
      insertBefore(newNode, refNode) {
        newNode.parentElement = this;
        const idx = this.children.indexOf(refNode);
        if (idx >= 0) this.children.splice(idx, 0, newNode);
        else this.children.push(newNode);
        return newNode;
      },
      querySelector(sel) {
        if (sel === '#agy-ko-model-menu-thinking-row') {
          return this.children.find((c) => c.id === 'agy-ko-model-menu-thinking-row') || null;
        }
        if (sel === '#agy-ko-appearance-thinking-row') {
          return this.children.find((c) => c.id === 'agy-ko-appearance-thinking-row') || null;
        }
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    createdElements.push(el);
    return el;
  };

  const mockFooter = { id: 'native-footer', classList: { contains: (c) => c === 'border-t' } };
  const mockModelPanel = makeDomEl('div');
  mockModelPanel.appendChild(mockFooter);

  const mockChatCard = makeDomEl('div');
  const mockConvStepsRow = makeDomEl('div');
  mockConvStepsRow.textContent = '대화 단계 표시 대화 중 에이전트 세부 작업 단계의 기본 표시 수준을 설정합니다';
  let defaultBtnClickCb = null;
  const mockDefaultBtn = {
    textContent: '기본값',
    addEventListener(ev, cb) {
      if (ev === 'click') defaultBtnClickCb = cb;
    },
  };
  mockConvStepsRow.querySelectorAll = (sel) => (sel === 'button' ? [mockDefaultBtn] : []);
  mockChatCard.appendChild(mockConvStepsRow);

  const mockSettingsModal = {
    querySelectorAll: (sel) => (sel.includes('.divide-y > div') ? [mockConvStepsRow] : []),
  };

  let verboseRestoreCalls = 0;
  const menuSandbox = {
    verboseStepsEnsured: true,
    ensureVerboseConversationStepsEnabled() {
      verboseRestoreCalls++;
    },
    isShowThinkingEnabled: () => menuShowThinkingState,
    window: {
      __agySetShowThinking(next) {
        menuShowThinkingState = Boolean(next);
      },
    },
    document: {
      head: { appendChild() {} },
      getElementById: () => ({ textContent: '' }),
      createElement: makeDomEl,
      querySelector: (sel) => (sel === '.settings-modal-container' ? mockSettingsModal : null),
      querySelectorAll(sel) {
        if (sel === '[data-testid="model-selector-panel"]') return [mockModelPanel];
        if (sel === '[data-testid="agy-ko-show-thinking-switch"]') {
          return createdElements.filter((e) => e.attrs['data-testid'] === 'agy-ko-show-thinking-switch');
        }
        if (sel === '[data-agy-show-thinking-label="1"]') {
          return createdElements.filter((e) => e.attrs['data-agy-show-thinking-label'] === '1');
        }
        return [];
      },
    },
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(
    `${mod06}\n;globalThis.__ensureThinkingMenu = ensureThinkingDisplayMenuIntegration;`,
    menuSandbox
  );
  menuSandbox.__ensureThinkingMenu();

  const injectedModelRow = mockModelPanel.querySelector('#agy-ko-model-menu-thinking-row');
  assert.ok(injectedModelRow, 'must inject #agy-ko-model-menu-thinking-row into [data-testid="model-selector-panel"]');
  assert.equal(
    mockModelPanel.children.indexOf(injectedModelRow),
    0,
    'must insert model menu thinking row right before the bottom .border-t footer'
  );
  const injectedAppearanceRow = mockChatCard.querySelector('#agy-ko-appearance-thinking-row');
  assert.ok(injectedAppearanceRow, 'must inject #agy-ko-appearance-thinking-row into Appearance > Chat card');

  // Clicking the model menu thinking row toggles showThinking to false and updates switches & labels
  injectedModelRow.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(menuShowThinkingState, false, 'clicking model menu thinking row must toggle showThinking to false');
  const switches = menuSandbox.document.querySelectorAll('[data-testid="agy-ko-show-thinking-switch"]');
  assert.equal(switches.length, 2);
  assert.ok(switches.every((sw) => sw.getAttribute('aria-checked') === 'false'));

  // Clicking back toggles showThinking to true, and native 'Default' (기본값) button in Appearance > Chat is NOT intercepted by ko-thought-translator (D-0012)
  injectedModelRow.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(menuShowThinkingState, true);
  assert.equal(
    defaultBtnClickCb,
    null,
    'D-0012: ensureAppearanceChatThinkingIntegration must NOT attach click listeners to native Conversation Steps Default/Verbose buttons'
  );
  assert.equal(
    verboseRestoreCalls,
    0,
    'D-0012: must never invoke ensureVerboseConversationStepsEnabled to revert native Default button click'
  );

  // 10. D-0004 & D-0006 regression checks: dual marker blocks, cross-frame parent sync, and conditional remote companion loading
  const { BEGIN_MARKER, END_MARKER, BEGIN_BLOCK_MARKER, END_BLOCK_MARKER } = require(path.join(HOST_DIR, 'paths.js'));
  assert.equal(BEGIN_MARKER, '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===');
  assert.equal(END_MARKER, '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===');
  assert.equal(BEGIN_BLOCK_MARKER, '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */');
  assert.equal(END_BLOCK_MARKER, '/* === END_AGY_KO_THOUGHT_LOCALIZER_V2 === */');
  const modBundleInj = fs.readFileSync(BUNDLE_INJECTOR_PATH, 'utf8');
  assert.ok(
    modBundleInj.includes('BEGIN_BLOCK_MARKER') && modBundleInj.includes('END_BLOCK_MARKER'),
    'D-0006: bundle-injector.js must emit both line and block markers so both statusbar and mcp-manager remote loaders extract koTranslatorCode'
  );
  assert.ok(
    mod04.includes('window.parent.__agySetTranslationProvider(activeTranslationProvider, options, true)'),
    'D-0004: __agySetTranslationProvider must propagate to window.parent when called inside remote workbench iframe'
  );
  assert.ok(
    mod05.includes('window.parent.__agySetPretranslate(pretranslateEnabled, true)'),
    'D-0004: __agySetPretranslate must propagate to window.parent when called inside remote workbench iframe'
  );
  assert.ok(
    mod08.includes('probeHostCompanionPluginsForRemote') && mod08.includes('info.statusbarInstalled') && mod08.includes('info.mcpManagerInstalled'),
    'D-0006: 08-dom-observer.js must verify host companion installation before loading statusbar or mcp-manager in Remote Control web'
  );

  // 11. D-0007 regression checks: Remote Control Settings strings, nested __ngContext__ BFS, initial URL query preservation, and base64 ReadFile decoding
  const rcDictSandbox = {};
  vm.runInNewContext(`${mod02}\n;globalThis.__translateStatic = translateStaticUiSync;`, rcDictSandbox);
  assert.equal(rcDictSandbox.__translateStatic('This Computer'), '이 컴퓨터');
  assert.equal(rcDictSandbox.__translateStatic('Remote'), '원격');
  assert.equal(
    rcDictSandbox.__translateStatic('Controls permissions for remote conversations.'),
    '원격 대화에 대한 권한을 제어합니다.'
  );
  assert.equal(rcDictSandbox.__translateStatic('Browser Subagent'), '브라우저 서브에이전트');
  assert.equal(
    rcDictSandbox.__translateStatic('Configure what the agent can do in local and remote conversations.'),
    '로컬 및 원격 대화에서 에이전트가 수행할 수 있는 작업 권한을 설정합니다.'
  );
  assert.equal(rcDictSandbox.__translateStatic('Learn more.'), '자세히 알아보기.');
  assert.equal(rcDictSandbox.__translateStatic('Advanced >'), '고급 >');
  assert.equal(
    rcDictSandbox.__translateStatic('Ask anything, @ to mention, / for actions'),
    '무엇이든 물어보세요 (@로 멘션, /로 작업 실행)'
  );
  assert.ok(
    mod08.includes('buildInitialIframeHistoryUrl') && mod08.includes('navigateIframeToChildPath'),
    'D-0007: bridgeRemoteControlIframe must preserve savedChildPath query params (?settingsOpen=true&settingsScreen=General) during same-origin promotion'
  );
  assert.ok(
    mod08.includes('mod.getDebugNode') &&
      mod08.includes('dbgNode?.componentInstance') &&
      mod08.includes('\\u0275getLContext') &&
      mod08.includes('initialConfigInFlight'),
    'D-0007: getRemoteControlComponentInstance must resolve Angular 19 componentInstance via getDebugNode(rcEl).componentInstance / ɵgetLContext and guard onIframeLoad against duplicate teardownProxyPort()'
  );
  assert.ok(
    mod08.includes('decodeBase64Utf8') && mod08.includes('/exa.language_server_pb.LanguageServerService/ReadFile'),
    'D-0007: probeHostCompanionPluginsForRemote must support ReadFile { uri } base64 decoding and rcInst.proxyCommand fallback'
  );

  // 12. D-0010 regression checks: Angular 19 LView TNode extraction & deep LView scan, INITIAL_CONFIG message buffering/replay without duplicate onIframeLoad teardown, and Web Host UI dictionary
  assert.equal(rcDictSandbox.__translateStatic('Remote Control Instances'), '원격 제어 인스턴스');
  assert.equal(rcDictSandbox.__translateStatic('Connect your first instance'), '첫 번째 인스턴스 연결');
  assert.equal(rcDictSandbox.__translateStatic('New environment for each conversation'), '대화마다 새 환경 생성');
  assert.equal(rcDictSandbox.__translateStatic('Updated 5m ago'), '5분 전 업데이트됨');
  assert.equal(
    rcDictSandbox.__translateStatic('Remove Lenovo-PC from your instances?'),
    '인스턴스 목록에서 Lenovo-PC 항목을 제거하시겠습니까?'
  );
  assert.equal(rcDictSandbox.__translateStatic('Last active: 2h ago'), '마지막 활동: 2시간 전');
  assert.ok(
    mod08.includes('extractFromLContext') &&
      mod08.includes('tNode.directiveStart + tNode.componentOffset') &&
      mod08.includes('__agyBufferedInitialConfigEvent') &&
      mod08.includes('__agyOnIframeLoadCalled') &&
      mod08.includes('__agyWorkerPatched'),
    'D-0010: 08-dom-observer.js must extract Angular 19 component via TNode directiveStart+componentOffset, buffer/replay INITIAL_CONFIG without calling onIframeLoad twice, and wrap relative Worker URLs'
  );

  // Runtime execution proof for getRemoteControlComponentInstance with deep Angular 19 LView & TNode
  const getRcFnMatch = mod08.match(
    /function getRemoteControlComponentInstance\(rcEl\)\s*\{[\s\S]*?\r?\n  \}\r?\n\r?\n  function decodeBase64Utf8/
  );
  assert.ok(getRcFnMatch, 'getRemoteControlComponentInstance must be extractable for runtime verification');
  const getRcFnCode = getRcFnMatch[0].replace(/\r?\n\r?\n  function decodeBase64Utf8$/, '');
  const mockRcInstance = {
    destroyed: false,
    proxyCommand() {},
    onIframeLoad() {},
    handleIframeMessage() {},
  };
  // Build an Angular 19 LView with 30 heavy nested objects in header slots (0..29) and component at slot 45
  const mockLView = new Array(60).fill(null).map((_, idx) => {
    if (idx === 1) {
      return {
        data: [null, null, { directiveStart: 45, componentOffset: 0 }],
      };
    }
    if (idx === 45) return mockRcInstance;
    // Heavy nested objects that previously exhausted the 250-step BFS queue
    return { a: { b: { c: Array.from({ length: 20 }, () => ({ x: 1 })) } } };
  });
  const rcSandbox = {
    window: {
      default_GoogleAntigravity: {
        y: {
          '\u0275getLContext': () => ({
            lViewId: 2,
            nodeIndex: 2,
            component: undefined,
            get lView() {
              return mockLView;
            },
          }),
        },
      },
    },
    document: {
      querySelector: () => null,
    },
  };
  vm.runInNewContext(`${getRcFnCode}\n;globalThis.__getRc = getRemoteControlComponentInstance;`, rcSandbox);
  const resolvedRc = rcSandbox.__getRc({});
  assert.equal(
    resolvedRc,
    mockRcInstance,
    'D-0010: getRemoteControlComponentInstance must extract RemoteControlComponent from Angular 19 LView TNode slot even when LContext.component is undefined and header slots contain deep objects'
  );

  // 13. D-0011 regression checks: Cross-origin iframe.contentWindow SecurityError defense, Angular 19 dynamic RouterOutlet child element lookup (rcEl.firstElementChild), home greeting & Lexical placeholder localization
  assert.equal(
    rcDictSandbox.__translateStatic('Hi Lenovo, what can we get done today?'),
    '안녕하세요 Lenovo님, 오늘 어떤 작업을 도와드릴까요?'
  );
  assert.equal(rcDictSandbox.__translateStatic('What can we get done today?'), '오늘 어떤 작업을 도와드릴까요?');
  assert.equal(
    rcDictSandbox.__translateStatic('Select project, current: No Project'),
    '프로젝트 선택, 현재: 프로젝트 없음'
  );
  assert.equal(
    rcDictSandbox.__translateStatic('Select model, current: No Model Selected'),
    '모델 선택, 현재: 선택된 모델 없음'
  );

  // Verify getRemoteControlComponentInstance resolves RemoteControlComponent via rcEl.firstElementChild when Bxa(lView, rcEl) === -1 returns null for rcEl
  const childEl = { tagName: 'DIV', className: 'app-container' };
  const hostRcEl = {
    tagName: 'GA-REMOTE-CONTROL',
    __ngContext__: 3, // numeric lViewId in Angular 19 production
    firstElementChild: childEl,
    querySelector: () => childEl,
  };
  const rcChildLView = new Array(25).fill(null);
  rcChildLView[0] = hostRcEl;
  rcChildLView[8] = mockRcInstance;
  rcChildLView[20] = childEl;
  const rcChildSandbox = {
    window: {
      default_GoogleAntigravity: {
        y: {
          // Simulate exact boq-jetski m=_b ug(a)/Bxa(b,a): returns null for hostRcEl, returns LContext for childEl!
          '\u0275getLContext': (el) => {
            if (el === childEl) {
              return { lViewId: 3, nodeIndex: 20, component: undefined, lView: rcChildLView };
            }
            return null;
          },
        },
      },
    },
    document: { querySelector: () => null },
  };
  vm.runInNewContext(`${getRcFnCode}\n;globalThis.__getRcChild = getRemoteControlComponentInstance;`, rcChildSandbox);
  assert.equal(
    rcChildSandbox.__getRcChild(hostRcEl),
    mockRcInstance,
    'D-0011: getRemoteControlComponentInstance must resolve RemoteControlComponent via rcEl.firstElementChild when Angular 19 ɵgetLContext(rcEl) returns null for dynamic RouterOutlet host'
  );

  // Verify syncRemoteCompanionPlugins and probeHostCompanionPluginsForRemote never throw when iframe.contentWindow is cross-origin and throws DOMException SecurityError on property read
  const extractBlockFnsMatch = mod08.match(
    /function findLineStartMarkerIndex\(text, marker, fromIndex = 0\)\s*\{[\s\S]*?\r?\n  \}\r?\n\r?\n  function injectRemoteCompanionScript/
  );
  assert.ok(extractBlockFnsMatch, 'findLineStartMarkerIndex and extractCompanionBlock must be extractable');
  const extractBlockFnsCode = extractBlockFnsMatch[0].replace(/\r?\n\r?\n  function injectRemoteCompanionScript$/, '');
  const syncFnMatch = mod08.match(
    /async function probeHostCompanionPluginsForRemote\(rcEl\)\s*\{[\s\S]*?\r?\n  \}\r?\n\r?\n  function bridgeRemoteControlIframe/
  );
  assert.ok(syncFnMatch, 'probeHostCompanionPluginsForRemote and syncRemoteCompanionPlugins must be extractable');
  const syncFnsCode = syncFnMatch[0].replace(/\r?\n\r?\n  function bridgeRemoteControlIframe$/, '');
  const crossOriginWindow = new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`SecurityError: Blocked a frame from accessing a cross-origin frame (property '${String(prop)}')`);
      },
    }
  );
  const crossOriginRcEl = {
    querySelector: (sel) => (sel === 'iframe' ? { contentWindow: crossOriginWindow } : null),
  };
  const crossOriginSandbox = {
    window: {},
    document: {},
    getRemoteControlComponentInstance: () => null,
    decodeBase64Utf8: () => '',
    injectRemoteCompanionScript: () => {},
    refreshStatusbarTranslatorAdapter: () => {},
  };
  vm.runInNewContext(
    `${extractBlockFnsCode}\n${syncFnsCode}\n;globalThis.__syncComp = syncRemoteCompanionPlugins; globalThis.__probeComp = probeHostCompanionPluginsForRemote; globalThis.__extractBlock = extractCompanionBlock;`,
    crossOriginSandbox
  );
  assert.doesNotThrow(() => {
    crossOriginSandbox.__syncComp(crossOriginRcEl);
  }, 'D-0011: syncRemoteCompanionPlugins must not throw synchronous SecurityError when reading cross-origin iframe.contentWindow.__agyCapturedLsClient');
  const probeRes = await crossOriginSandbox.__probeComp(crossOriginRcEl);
  assert.equal(
    probeRes.resolved,
    false,
    'D-0011: probeHostCompanionPluginsForRemote must safely catch cross-origin iframe.contentWindow SecurityError and return unresolved info'
  );

  // KO-BUG-04a/b & KO-NEW-BUG-02: Verify applyRawBundleInspection extracts baseSegment as statusbarCode (even without BEGIN_AGY_STATUSBAR),
  // line-start anchored extractCompanionBlock ignores inline string literals inside ko-thought-translator,
  // GetLocalUserInfoResponse.homeDirUri is decoded and used, GetAllPluginsResponse embedding ko-thought-translator's own README.md
  // does NOT cause false-positive statusbarInstalled/mcpManagerInstalled on standalone hosts, and Linux candidatePaths preserve leading '/'.
  const realisticCombinedBundle = [
    '// ==UserScript==',
    '// @name         Antigravity Custom Statusbar (Local & Remote Control)',
    'function mountContextStatusBar() { return "agy-ctx-statusbar"; }',
    '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
    'function mountMcpManager() { return "agyMcpManager"; }',
    '// === END_AGY_MCP_MANAGER_V1 ===',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
    'const fakeInlineLiterals = "// === BEGIN_AGY_MCP_MANAGER_V1 === fake /* === BEGIN_AGY_MCP_MANAGER_V1 === */";',
    '/* === END_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
  ].join('\n');
  let capturedReadFileArgs = null;
  const bundleProbeSandbox = {
    window: {
      __agyCapturedLsClient: {
        getLocalUserInfo: async () => ({ homeDirUri: 'file:///C:/Users/Lenovo%20User' }),
        readFile: async (args) => {
          capturedReadFileArgs = args;
          return { content: realisticCombinedBundle };
        },
        getAllPlugins: async () => ({ plugins: [] }),
        getCustomizationStates: async () => ({ states: [] }),
      },
    },
    document: {},
    getRemoteControlComponentInstance: () => null,
    decodeBase64Utf8: (s) => s,
    injectRemoteCompanionScript: () => {},
    refreshStatusbarTranslatorAdapter: () => {},
  };
  vm.runInNewContext(
    `${extractBlockFnsCode}\n${syncFnsCode}\n;globalThis.__probeBundle = probeHostCompanionPluginsForRemote;`,
    bundleProbeSandbox
  );
  const bundleInfo = await bundleProbeSandbox.__probeBundle(null);
  assert.equal(bundleInfo.resolved, true);
  assert.equal(
    capturedReadFileArgs?.path,
    'C:/Users/Lenovo User/.gemini/antigravity/statusbar_autoinject.js',
    'KO-NEW-BUG-02: probeHostCompanionPluginsForRemote must decode homeDirUri (file:///C:/Users/...) and strip leading slash before Windows drive letter'
  );
  assert.equal(bundleInfo.statusbarInstalled, true);
  assert.ok(
    bundleInfo.statusbarCode.includes('mountContextStatusBar') &&
      !bundleInfo.statusbarCode.includes('mountMcpManager'),
    'KO-BUG-04: applyRawBundleInspection must extract statusbar baseSegment before the first companion marker without needing BEGIN_AGY_STATUSBAR'
  );
  assert.equal(bundleInfo.mcpManagerInstalled, true);
  assert.equal(
    bundleInfo.mcpManagerCode,
    'function mountMcpManager() { return "agyMcpManager"; }',
    'KO-BUG-04: extractCompanionBlock must use line-start anchors and ignore inline marker literals'
  );

  // KO-NEW-BUG-02 standalone host check: GetAllPluginsResponse embeds ko-thought-translator's README.md mentioning
  // both 'antigravity-statusbar' and 'antigravity-mcp-manager', and candidatePaths on Linux use 'file:///home/dev/.gemini/...'.
  let linuxReadFileArgs = null;
  const standaloneLinuxSandbox = {
    window: {
      __agyCapturedLsClient: {
        getLocalUserInfo: async () => ({}),
        readFile: async (args) => {
          linuxReadFileArgs = args;
          return {
            content: [
              '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
              'console.log("standalone ko-thought-translator only");',
              '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
            ].join('\n'),
          };
        },
        getAllPlugins: async () => ({
          plugins: [
            {
              name: 'ko-thought-translator',
              id: 'ko-thought-translator',
              path: 'file:///home/dev%20user/.gemini/config/plugins/ko-thought-translator',
              readme:
                'Integrates with antigravity-statusbar (StatusBarAdapter) and antigravity-mcp-manager in Remote Control.',
              description: 'Mentions antigravity-statusbar and antigravity-mcp-manager in docs.',
            },
          ],
        }),
        getCustomizationStates: async () => ({ states: [] }),
      },
    },
    document: {},
    getRemoteControlComponentInstance: () => null,
    decodeBase64Utf8: (s) => s,
    injectRemoteCompanionScript: () => {},
    refreshStatusbarTranslatorAdapter: () => {},
  };
  vm.runInNewContext(
    `${extractBlockFnsCode}\n${syncFnsCode}\n;globalThis.__probeStandalone = probeHostCompanionPluginsForRemote;`,
    standaloneLinuxSandbox
  );
  const standaloneInfo = await standaloneLinuxSandbox.__probeStandalone(null);
  assert.equal(standaloneInfo.resolved, true);
  assert.equal(
    standaloneInfo.statusbarInstalled,
    false,
    'KO-NEW-BUG-02: standalone ko-thought-translator README mentioning antigravity-statusbar must NOT set statusbarInstalled=true'
  );
  assert.equal(
    standaloneInfo.mcpManagerInstalled,
    false,
    'KO-NEW-BUG-02: standalone ko-thought-translator README mentioning antigravity-mcp-manager must NOT set mcpManagerInstalled=true'
  );
  assert.equal(
    linuxReadFileArgs?.path,
    '/home/dev user/.gemini/antigravity/statusbar_autoinject.js',
    'KO-NEW-BUG-02: Linux file:///home/... candidatePaths must preserve leading slash and decode percent-encoding'
  );
  assert.equal(
    linuxReadFileArgs?.uri,
    'file:///home/dev user/.gemini/antigravity/statusbar_autoinject.js',
    'KO-NEW-BUG-02: Linux ReadFile uri must be file:///home/...'
  );

  // KO-BUG-04c & KO-NEW-BUG-03: Verify getRemoteControlComponentInstance captures rcInst when Angular 19 debug APIs return null
  // AND window.addEventListener('message', this.handleIframeMessage.bind(this)) was ALREADY bound at construction time
  // matching real boq-jetski (m=PGmR6b offset 8845378) where handleIframeMessage checks `a.data.type === 'URL_CHANGED'` -> `this.handleUrlChanged(a.data.path || '')`!
  function MockRemoteControlComponent() {
    this.destroyed = false;
  }
  MockRemoteControlComponent.prototype.proxyCommand = function () {};
  MockRemoteControlComponent.prototype.onIframeLoad = function () {
    throw new Error('real onIframeLoad should be suppressed during probe!');
  };
  MockRemoteControlComponent.prototype.handleUrlChanged = function () {
    throw new Error('real handleUrlChanged should be suppressed during probe!');
  };
  MockRemoteControlComponent.prototype.handleIframeMessage = function (a) {
    if (!a || !a.data) return;
    if (a.data.type === 'URL_CHANGED') {
      this.handleUrlChanged(a.data.path || '');
    }
  };
  const preConstructedRc = new MockRemoteControlComponent();
  const boundListeners = [];
  const boundListener = preConstructedRc.handleIframeMessage.bind(preConstructedRc);
  boundListeners.push(boundListener);
  const boundRcSandbox = {
    MessageEvent: class MockMessageEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.data = init.data;
        this.origin = init.origin || '';
        this.source = init.source || null;
      }
    },
    Event: class MockEvent {
      constructor(type) {
        this.type = type;
      }
    },
    window: {
      location: { origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/123' },
      default_GoogleAntigravity: {
        m1: { RemoteControlComponent: MockRemoteControlComponent },
      },
      dispatchEvent(ev) {
        for (const fn of boundListeners) fn(ev);
      },
    },
    document: {
      querySelector: () => null,
      dispatchEvent() {},
    },
  };
  vm.runInNewContext(`${getRcFnCode}\n;globalThis.__getBoundRc = getRemoteControlComponentInstance;`, boundRcSandbox);
  const capturedBoundRc = boundRcSandbox.__getBoundRc({
    querySelector: (sel) =>
      sel === 'iframe'
        ? {
            src: 'https://antigravity.static.usercontent.goog/web/2.29.0/?iframe=true',
            getAttribute: () => 'https://antigravity.static.usercontent.goog/web/2.29.0/?iframe=true',
            contentWindow: {},
          }
        : null,
  });
  assert.equal(
    capturedBoundRc,
    preConstructedRc,
    'KO-NEW-BUG-03: getRemoteControlComponentInstance must capture pre-constructed RC instance via bound boq-jetski handleIframeMessage (URL_CHANGED -> handleUrlChanged) without running real side effects'
  );

  // 14. D-0013~D-0019 & KO-BUG-03/05 & KO-NEW-BUG-04/05 regression checks: session switch flicker prevention, .no-animations Web Animations suppression, 16ms FOUC elimination, worked-for latest turn guard, retranslateVisibleThoughts parent propagation, queued messages card & new strings, SKILL.md & README accuracy
  const readmeText = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(
    readmeText.includes('v13.29') && !readmeText.includes('verboseConversationSteps: true'),
    'KO-BUG-05: README.md must reference v13.29 and must NOT claim verboseConversationSteps: true is force-enabled'
  );
  const skillMdText = fs.readFileSync(path.join(ROOT, 'skills', 'ko-thought-translator', 'SKILL.md'), 'utf8');
  assert.ok(
    skillMdText.includes('기본값: `google-translate`') &&
      !skillMdText.includes('기본값: `local-llm`') &&
      !skillMdText.includes('일반 (General)` 탭 최상단'),
    'D-0019 & KO-NEW-BUG-05: skills/ko-thought-translator/SKILL.md must document google-translate as default and must NOT claim removed General tab card exists'
  );
  assert.ok(
    mod06.includes('[data-testid="conversation-view"][data-agy-session-switching="1"]'),
    'D-0013: STYLE_CSS must suppress transitions on conversation-view during session switching'
  );
  assert.ok(
    mod08.includes('STATIC_UI_SUBTREE_PRUNE_SELECTOR') &&
      mod08.includes('CUSTOM_NO_TRANSLATE_SUBTREE_SELECTOR') &&
      mod08.includes('[data-agy-no-translate="true"]') &&
      mod08.includes('NodeFilter.FILTER_REJECT'),
    'D-0013: localizeStaticUiInRoot and MutationObserver must prune excluded and [data-agy-no-translate="true"] subtrees'
  );
  assert.ok(
    mod08.includes('fastScanMicrotaskScheduled') && mod08.includes('guardSessionSwitchTransitions'),
    'D-0013: scheduleCoalescedScan must deduplicate rapid synchronous mutations into a single microtask and freeze session switch transitions'
  );
  // D-0014: runFastThoughtAndTriggerScan must localize conversation-view & subagent-tab-conversation immediately in pre-paint microtask
  const fastScanFnMatch = mod08.match(/function runFastThoughtAndTriggerScan\(\)\s*\{[\s\S]*?\r?\n  \}/);
  assert.ok(fastScanFnMatch, 'runFastThoughtAndTriggerScan must exist in 08-dom-observer.js');
  assert.ok(
    fastScanFnMatch[0].includes('[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"]') &&
      fastScanFnMatch[0].includes('localizeStaticUiInRoot(convEl)'),
    'D-0014: runFastThoughtAndTriggerScan must immediately localize conversation-view & subagent-tab-conversation before paint to eliminate 16ms timer FOUC'
  );

  // D-0016: Verify isWorkedForInActiveOrLatestTurn prevents historical completed worked-for-collapsible from auto-expanding when latest turn has no worked-for yet
  const histCompletedWorkedAsLastInDom = makeCollapsibleBtn('__reactFiber$workedHistLast', {
    memoizedProps: { isLastContainer: false, segment: { isLatest: false, steps: [] } },
    return: null,
  });
  assert.equal(
    expandSandbox.__isWorkedActive(histCompletedWorkedAsLastInDom, true),
    false,
    'D-0016: isWorkedForInActiveOrLatestTurn must return false when Lhc fiber has isLastContainer:false even if it is the last worked-for button in DOM'
  );
  const workedBeforeNewUserBubble = makeCollapsibleBtn('__reactFiber$workedBeforeBubble', {
    memoizedProps: {},
    return: null,
  });
  workedBeforeNewUserBubble.compareDocumentPosition = (other) => (other === mockUserBubble ? 4 : 0);
  expandSandbox.document.querySelectorAll = (sel) =>
    sel === '[data-testid="user-message-bubble"]' ? [mockUserBubble] : origQsa(sel);
  assert.equal(
    expandSandbox.__isWorkedActive(workedBeforeNewUserBubble, true),
    false,
    'D-0016: isWorkedForInActiveOrLatestTurn must return false when a subsequent [data-testid="user-message-bubble"] follows the button'
  );
  expandSandbox.document.querySelectorAll = origQsa;

  // D-0017: Verify retranslateVisibleThoughts propagates to window.parent even when document.querySelectorAll('iframe') is empty
  const retranslateFnMatch = mod08.match(
    /function retranslateVisibleThoughts\(clearCache = false, _fromCrossFrame = false\)\s*\{[\s\S]*?\r?\n  \}/
  );
  assert.ok(retranslateFnMatch, 'retranslateVisibleThoughts must exist in 08-dom-observer.js');
  let parentRetranslateCalls = [];
  const retranslateSandbox = {
    memCache: new Map(),
    inflightMap: new Map(),
    CACHE_STORAGE_KEY: 'agy-ko-cache',
    activeTranslationProvider: 'google-translate',
    localStorage: { removeItem() {} },
    scanThoughtBlocks() {},
    refreshTranslatorSettingsUi() {},
    document: {
      querySelectorAll: () => [], // zero child iframes inside remote workbench frame!
    },
    window: {
      parent: {
        __agyRetranslateVisibleThoughts(clearCache, fromCrossFrame) {
          parentRetranslateCalls.push([clearCache, fromCrossFrame]);
        },
      },
    },
  };
  vm.runInNewContext(
    `${retranslateFnMatch[0]}\n;globalThis.__retranslate = retranslateVisibleThoughts;`,
    retranslateSandbox
  );
  retranslateSandbox.__retranslate(true, false);
  assert.deepEqual(
    parentRetranslateCalls,
    [[true, true]],
    'D-0017: retranslateVisibleThoughts must propagate to window.parent even when document has 0 child iframes'
  );

  // D-0018: Verify Queued Messages card exclusion refinement & new static/dynamic UI dictionary entries
  assert.equal(rcDictSandbox.__translateStatic('Open IDE'), 'IDE 열기');
  assert.equal(rcDictSandbox.__translateStatic('Open Antigravity IDE'), 'Antigravity IDE 열기');
  assert.equal(rcDictSandbox.__translateStatic('Open in Antigravity IDE'), 'Antigravity IDE에서 열기');
  assert.equal(rcDictSandbox.__translateStatic('Queued messages (2)'), '대기 중인 메시지 (2개)');
  assert.equal(rcDictSandbox.__translateStatic('Collapse queued messages'), '대기 중인 메시지 접기');
  assert.equal(rcDictSandbox.__translateStatic('Expand queued messages'), '대기 중인 메시지 펼치기');
  assert.equal(rcDictSandbox.__translateStatic('Send Now'), '지금 보내기');
  assert.equal(rcDictSandbox.__translateStatic('Cancel Sending Message'), '메시지 전송 취소');
  assert.equal(rcDictSandbox.__translateStatic('Queued message deleted'), '대기 중인 메시지가 삭제되었습니다');
  assert.equal(rcDictSandbox.__translateStatic('Empty message'), '빈 메시지');
  assert.equal(rcDictSandbox.__translateStatic('3 comments'), '댓글 3개');
  assert.equal(rcDictSandbox.__translateStatic('Timed'), '타이머 완료');
  assert.equal(rcDictSandbox.__translateStatic('Timing'), '타이머 대기 중');
  assert.equal(rcDictSandbox.__translateStatic('Rejected'), '거절됨');
  assert.equal(rcDictSandbox.__translateStatic('Canceled'), '취소됨');
  assert.equal(rcDictSandbox.__translateStatic('Interrupted'), '중단됨');
  assert.equal(rcDictSandbox.__translateStatic('Task not found'), '작업을 찾을 수 없음');
  assert.equal(rcDictSandbox.__translateStatic('No browser pages open'), '열려 있는 브라우저 페이지 없음');
  assert.equal(rcDictSandbox.__translateStatic('Full Error'), '전체 오류 보기');
  assert.equal(
    rcDictSandbox.__translateStatic('5m timer: Timer has expired'),
    '5분 타이머: 타이머가 만료되었습니다'
  );
  assert.equal(
    rcDictSandbox.__translateStatic('Unit test execution · Exited with code 0'),
    'Unit test execution · 종료 코드 0'
  );

  const isExcludedFnMatch = mod08.match(
    /function isExcludedFromStaticUiLocalization\(el, forAttributes = false\)\s*\{[\s\S]*?\r?\n  \}/
  );
  assert.ok(isExcludedFnMatch, 'isExcludedFromStaticUiLocalization must exist in 08-dom-observer.js');
  const exclSandbox = {};
  vm.runInNewContext(
    `${isExcludedFnMatch[0]}\n;globalThis.__isExcluded = isExcludedFromStaticUiLocalization;`,
    exclSandbox
  );
  const makeQueuedEl = (tag, text, isLineClamp2 = false) => ({
    tagName: tag,
    textContent: text,
    classList: { contains: (c) => (c === 'line-clamp-2' ? isLineClamp2 : false) },
    getAttribute: () => null,
    closest(sel) {
      if (sel.includes('agent-input-box') || sel.includes('queued-messages-card')) return {};
      return null;
    },
  });
  assert.equal(
    exclSandbox.__isExcluded(makeQueuedEl('SPAN', 'Queued messages (1)', false), false),
    false,
    'D-0018: static header inside [data-testid="queued-messages-card"] must NOT be excluded'
  );
  assert.equal(
    exclSandbox.__isExcluded(makeQueuedEl('DIV', 'Empty message', true), false),
    false,
    'D-0018: "Empty message" placeholder inside .line-clamp-2 must NOT be excluded'
  );
  assert.equal(
    exclSandbox.__isExcluded(makeQueuedEl('DIV', 'User custom follow-up prompt text', true), false),
    true,
    'D-0018: user message text inside .line-clamp-2 of queued-messages-card MUST be excluded from static UI localization'
  );

  // Verify syncShowThinkingDomAttribute does NOT repeatedly mutate <html> attributes when state is unchanged
  const syncAttrFnMatch = mod01.match(/function syncShowThinkingDomAttribute\(\)\s*\{[\s\S]*?\r?\n  \}/);
  assert.ok(syncAttrFnMatch, 'syncShowThinkingDomAttribute must exist in 01-bootstrap-and-cache.js');
  let rootSetAttrCalls = 0;
  let rootRemoveAttrCalls = 0;
  const mockRootAttrs = {};
  const attrSandbox = {
    showThinkingEnabled: true,
    document: {
      documentElement: {
        hasAttribute: (k) => Object.prototype.hasOwnProperty.call(mockRootAttrs, k),
        getAttribute: (k) => mockRootAttrs[k] ?? null,
        setAttribute: (k, v) => {
          rootSetAttrCalls++;
          mockRootAttrs[k] = String(v);
        },
        removeAttribute: (k) => {
          rootRemoveAttrCalls++;
          delete mockRootAttrs[k];
        },
      },
      querySelectorAll: () => [],
    },
  };
  vm.runInNewContext(`${syncAttrFnMatch[0]}\n;globalThis.__syncAttr = syncShowThinkingDomAttribute;`, attrSandbox);
  attrSandbox.__syncAttr();
  attrSandbox.__syncAttr();
  assert.equal(
    rootRemoveAttrCalls,
    0,
    'D-0013: syncShowThinkingDomAttribute must NOT call removeAttribute when data-agy-hide-thinking is already absent'
  );
  attrSandbox.showThinkingEnabled = false;
  attrSandbox.__syncAttr();
  assert.equal(rootSetAttrCalls, 1, 'D-0013: syncShowThinkingDomAttribute must set data-agy-hide-thinking="1" once when turned off');
  attrSandbox.__syncAttr();
  attrSandbox.__syncAttr();
  assert.equal(
    rootSetAttrCalls,
    1,
    'D-0013: syncShowThinkingDomAttribute must NOT call setAttribute repeatedly when data-agy-hide-thinking="1" is already set'
  );

  // Verify guardSessionSwitchTransitions:
  // 1) sets data-agy-session-switching="1" on both conversation-view and subagent-tab-conversation on cascadeId change
  // 2) does NOT shorten the 650ms timer to 250ms on the next microtask when turns are already present
  // 3) arms a 250ms timer when an empty view finishes async trajectorySlice load even after >650ms (700ms)
  const guardSwitchMatch = mod08.match(
    /let lastObservedCascadeId = null;\r?\n  let sessionSwitchFreezeTimer = null;\r?\n  let sessionSwitchFreezeUntil = 0;\r?\n\r?\n  function guardSessionSwitchTransitions\(\)\s*\{[\s\S]*?\r?\n  \}/
  );
  assert.ok(guardSwitchMatch, 'guardSessionSwitchTransitions must exist in 08-dom-observer.js');
  const convAttrs = { 'data-testid': 'conversation-view', 'data-cascade-id': 'session-alpha' };
  const subagentAttrs = { 'data-testid': 'subagent-tab-conversation', 'data-cascade-id': 'subagent-alpha' };
  let convHasTurns = true;
  let fakeNow = 1000;
  let scheduledTimers = [];
  let activeTimerCallback = null;
  const convClasses = new Set();
  const subagentClasses = new Set();
  let canceledAnimationsCount = 0;
  const mockConvEl = {
    classList: {
      contains: (c) => convClasses.has(c),
      add: (c) => convClasses.add(c),
      remove: (c) => convClasses.delete(c),
    },
    getAnimations: () => [
      {
        cancel() {
          canceledAnimationsCount++;
        },
      },
    ],
    getAttribute: (k) => convAttrs[k] ?? null,
    setAttribute: (k, v) => {
      convAttrs[k] = String(v);
    },
    removeAttribute: (k) => {
      delete convAttrs[k];
    },
    querySelector: () => (convHasTurns ? {} : null),
  };
  const mockSubagentEl = {
    classList: {
      contains: (c) => subagentClasses.has(c),
      add: (c) => subagentClasses.add(c),
      remove: (c) => subagentClasses.delete(c),
    },
    getAnimations: () => [],
    getAttribute: (k) => subagentAttrs[k] ?? null,
    setAttribute: (k, v) => {
      subagentAttrs[k] = String(v);
    },
    removeAttribute: (k) => {
      delete subagentAttrs[k];
    },
    querySelector: () => null,
  };
  const switchSandbox = {
    Date: { now: () => fakeNow },
    document: {
      querySelectorAll: () => [mockConvEl, mockSubagentEl],
      querySelector: () => mockConvEl,
    },
    setTimeout: (cb, ms) => {
      activeTimerCallback = cb;
      scheduledTimers.push(ms);
      return scheduledTimers.length;
    },
    clearTimeout: () => {
      activeTimerCallback = null;
    },
  };
  vm.runInNewContext(`${guardSwitchMatch[0]}\n;globalThis.__guardSwitch = guardSessionSwitchTransitions;`, switchSandbox);
  switchSandbox.__guardSwitch();
  assert.equal(convAttrs['data-agy-session-switching'], undefined, 'initial session observation must not mark session switching');

  // Case A: Switch to session-beta where turns are already in DOM at t=1000ms, then next microtask runs at t=1001ms
  convAttrs['data-cascade-id'] = 'session-beta';
  convHasTurns = true;
  scheduledTimers = [];
  switchSandbox.__guardSwitch();
  assert.equal(convAttrs['data-agy-session-switching'], '1');
  assert.equal(subagentAttrs['data-agy-session-switching'], '1');
  assert.equal(convClasses.has('no-animations'), true, 'D-0015: must add .no-animations class during session switch freeze');
  assert.equal(subagentClasses.has('no-animations'), true, 'D-0015: must add .no-animations class to subagent view during session switch freeze');
  assert.equal(canceledAnimationsCount, 1, 'D-0015: must cancel active Web Animations (element.animate) inside targetViews on session switch');
  assert.deepEqual(scheduledTimers, [650], 'initial switch must arm 650ms freeze timer');
  fakeNow = 1001;
  switchSandbox.__guardSwitch();
  assert.deepEqual(
    scheduledTimers,
    [650],
    'KO-NEW-BUG-04: next microtask with switched=false and turns present must NOT overwrite 650ms timer with 250ms'
  );

  // Expire the 650ms timer
  fakeNow = 1700;
  if (activeTimerCallback) activeTimerCallback();
  assert.equal(convAttrs['data-agy-session-switching'], undefined);
  assert.equal(convClasses.has('no-animations'), false, 'D-0015: must remove .no-animations class when session switch freeze timer expires');
  assert.equal(subagentClasses.has('no-animations'), false, 'D-0015: must remove .no-animations class from subagent view when freeze timer expires');

  // Case B: Switch to session-gamma with empty view (spinner) at t=2000ms; async trajectorySlice mounts at t=2700ms (>650ms after timer expired)
  fakeNow = 2000;
  convAttrs['data-cascade-id'] = 'session-gamma';
  convHasTurns = false;
  scheduledTimers = [];
  switchSandbox.__guardSwitch();
  assert.deepEqual(scheduledTimers, [650]);
  // 650ms timer expires at t=2650ms while view is still empty
  fakeNow = 2650;
  if (activeTimerCallback) activeTimerCallback();
  assert.equal(convAttrs['data-agy-session-switching'], undefined);
  // At t=2700ms (700ms after switch), async trajectorySlice finally mounts turns into the view
  fakeNow = 2700;
  convHasTurns = true;
  switchSandbox.__guardSwitch();
  assert.equal(
    convAttrs['data-agy-session-switching'],
    '1',
    'KO-NEW-BUG-04: async trajectorySlice mounting after >650ms must still re-arm data-agy-session-switching="1"'
  );
  assert.deepEqual(
    scheduledTimers,
    [650, 250],
    'KO-NEW-BUG-04: async trajectorySlice mounting after >650ms must arm the 250ms transition-suppression window'
  );
});

test('D-0020, D-0021, D-0022: Antigravity v2.29.0 static UI patterns, CLI Project header localization, and bilingual README contract', () => {
  const mod02 = fs.readFileSync(path.join(RENDERER_DIR, '02-static-ui-dict.js'), 'utf8');
  const mod08 = fs.readFileSync(path.join(RENDERER_DIR, '08-dom-observer.js'), 'utf8');

  const dictSandbox = { window: {} };
  vm.runInNewContext(`${mod02}\n;globalThis.__tr = translateStaticUiSync;`, dictSandbox);
  const tr = dictSandbox.__tr;

  // D-0020: idle-status-text & browser status patterns
  assert.equal(tr('2 subagents/tasks running'), '서브에이전트/작업 2개 실행 중');
  assert.equal(tr('3 subagents/tasks running, 1 blocked'), '서브에이전트/작업 3개 실행 중, 1개 차단됨');
  assert.equal(tr('1 subagent blocked'), '서브에이전트 1개 차단됨');
  assert.equal(tr('2 blocked'), '2개 차단됨');
  assert.equal(tr('Using browser'), '브라우저 사용 중');
  assert.equal(tr('Using browser · Thinking…'), '브라우저 사용 중 · 생각하는 중…');
  assert.equal(tr('Using browser · Thinking (4s)…'), '브라우저 사용 중 · 생각하는 중 (4초)…');
  assert.equal(tr('Thinking (12s)…'), '생각하는 중 (12초)…');

  // D-0020: conversation-navigator patterns
  assert.equal(tr('Conversation turns'), '대화 턴 목록');
  assert.equal(tr('Scroll turns up'), '이전 턴으로 스크롤');
  assert.equal(tr('Scroll turns down'), '다음 턴으로 스크롤');
  assert.equal(tr('Turn 3 of 18'), '전체 18개 중 3번째 턴');
  assert.equal(tr('Turns 1–5'), '1–5번째 턴');
  assert.equal(tr('Turn 7'), '7번째 턴');
  assert.equal(tr('24 turns'), '24개 턴');
  assert.equal(tr('11월 8일 (일), 오전 8:21 – 오후 10:31, 24 turns'), '11월 8일 (일), 오전 8:21 – 오후 10:31, 24개 턴');

  // D-0020: cron / schedule / subagents / compacting / checkpoint / retry / tool steps
  assert.equal(tr('cron (every 20 minutes): Cron trigger #1'), '크론 (20분마다): 크론 트리거 #1');
  assert.equal(tr('cron (every 5 hours)'), '크론 (5시간마다)');
  assert.equal(tr('cron (*/5 * * * *): Cron trigger #3'), '크론 (*/5 * * * *): 크론 트리거 #3');
  assert.equal(tr('Cron trigger #2'), '크론 트리거 #2');
  assert.equal(tr('Found'), '조회됨');
  assert.equal(tr('5 subagents'), '서브에이전트 5개');
  assert.equal(tr('(3 subagents)'), '(서브에이전트 3개)');
  assert.equal(tr('Starting 2 subagents'), '서브에이전트 2개 시작 중');
  assert.equal(tr('Started 2 subagents'), '서브에이전트 2개 시작됨');
  assert.equal(tr('Collapse subagents'), '서브에이전트 접기');
  assert.equal(tr('Expand subagents'), '서브에이전트 펼치기');
  assert.equal(tr('Stop subagent'), '서브에이전트 중지');
  assert.equal(tr('Cancel Task'), '작업 취소');
  assert.equal(tr('No background tasks'), '실행 중인 백그라운드 작업 없음');
  assert.equal(tr('Wait for 10s'), '10초 대기');
  assert.equal(tr('Compacting'), '컨텍스트 압축 중');
  assert.equal(tr('Compacting · 15s'), '컨텍스트 압축 중 · 15초');
  assert.equal(
    tr('Model unavailable, retrying in 5s (attempt 2/4)'),
    '모델 응답 지연, 5초 후 재시도 중 (2/4차 시도)'
  );
  assert.equal(
    tr('Checkpoint #2 (Steps 1–45) (Intent Only)'),
    '체크포인트 #2 (단계 1–45) (의도만 요약)'
  );
  assert.equal(tr('Waiting for command completion (up to 30 seconds)'), '명령 완료 대기 중 (최대 30초)');
  assert.equal(tr('4 chunks'), '청크 4개');
  assert.equal(tr('Chunk 2'), '청크 2');
  assert.equal(tr('3 text resources'), '텍스트 리소스 3개');
  assert.equal(tr('2 images'), '이미지 2개');
  assert.equal(tr('12 results'), '결과 12개');
  assert.equal(tr('Show 5 more'), '5개 더 보기');
  assert.equal(tr('Generation Steps (4)'), '생성 단계 (4개)');
  assert.equal(tr('(4 steps)'), '(4단계)');
  assert.equal(tr('3 questions'), '질문 3개');
  assert.equal(tr('Open the Ledger plugin'), 'Ledger 플러그인 열기');
  assert.equal(tr('Fork in Shared Workspace'), '공유 작업공간에서 포크');

  // D-0021: CLI Project fixed system header is allowed while custom project names are excluded
  assert.equal(tr('CLI Project'), 'CLI 프로젝트');
  const exclMatch = mod08.match(
    /const CUSTOM_NO_TRANSLATE_SUBTREE_SELECTOR =[\s\S]*?function isExcludedFromStaticUiLocalization\(el,\s*forAttributes\s*=\s*false\)\s*\{[\s\S]*?\r?\n  \}/
  );
  assert.ok(exclMatch, 'isExcludedFromStaticUiLocalization must exist in 08-dom-observer.js');
  const exclSandbox = {};
  vm.runInNewContext(`${exclMatch[0]}\n;globalThis.__isExcl = isExcludedFromStaticUiLocalization;`, exclSandbox);
  const isExcl = exclSandbox.__isExcl;

  const makeHeaderSpan = (label) => {
    const headerBtn = {
      tagName: 'BUTTON',
      textContent: label,
      getAttribute: (k) => {
        if (k === 'data-testid') return 'project-header';
        if (k === 'data-project-label') return label;
        return null;
      },
      closest: (sel) => (sel.includes('project-header') ? headerBtn : null),
    };
    return {
      tagName: 'SPAN',
      textContent: label,
      classList: { contains: () => false },
      getAttribute: () => null,
      closest: (sel) => {
        if (sel === '[data-testid]' || sel === '[data-testid="project-header"]') return headerBtn;
        return null;
      },
    };
  };

  assert.equal(
    isExcl(makeHeaderSpan('CLI Project'), false),
    false,
    'D-0021: fixed system header "CLI Project" must NOT be excluded from static UI localization'
  );
  assert.equal(
    isExcl(makeHeaderSpan('No Project'), false),
    false,
    'D-0021: fixed system header "No Project" must NOT be excluded from static UI localization'
  );
  assert.equal(
    isExcl(makeHeaderSpan('my-custom-workspace'), false),
    true,
    'D-0021: user workspace name on project-header MUST remain excluded from static UI localization'
  );

  // D-0022: English README.md and Korean README.ko.md cross-links and version synchronization
  const readmeEnPath = path.join(ROOT, 'README.md');
  const readmeKoPath = path.join(ROOT, 'README.ko.md');
  assert.ok(fs.existsSync(readmeEnPath), 'D-0022: README.md must exist');
  assert.ok(fs.existsSync(readmeKoPath), 'D-0022: README.ko.md must exist');
  const readmeEn = fs.readFileSync(readmeEnPath, 'utf8');
  const readmeKo = fs.readFileSync(readmeKoPath, 'utf8');
  assert.ok(readmeEn.includes('[한국어 문서 (README.ko.md)](./README.ko.md)'), 'D-0022: English README.md must link to README.ko.md at the top');
  assert.ok(readmeKo.includes('[English Documentation (README.md)](./README.md)'), 'D-0022: Korean README.ko.md must link to README.md at the top');
  assert.ok(readmeEn.includes('v1.2.34') && readmeEn.includes('v13.29'), 'D-0022: README.md must reflect v1.2.34 / v13.29');
  assert.ok(readmeKo.includes('v1.2.34') && readmeKo.includes('v13.29'), 'D-0022: README.ko.md must reflect v1.2.34 / v13.29');

  // D-0023: Verify segment.isLatest:false overrides isLastContainer:true on Lhc fiber so historical execution segments inside the latest turn container are NEVER force-expanded on session switch
  const activeHelperMatch = mod08.match(
    /function isToolGroupInActiveOrLatestTurn\(btn, workedBtns\)\s*\{[\s\S]*?function scanTriggerButtonsSync/
  );
  assert.ok(activeHelperMatch, 'active/latest turn helpers must exist in 08-dom-observer.js');
  const activeHelperCode = activeHelperMatch[0].replace(/\r?\n\r?\n  function scanTriggerButtonsSync$/, '');
  const d0023Sandbox = {
    getReactFiberFromElement: (el) => el?.__fiber || null,
    document: {
      querySelector: (sel) =>
        sel === '[data-turn-content="latest"]' ? { contains: () => true } : null,
      querySelectorAll: () => [],
    },
  };
  vm.runInNewContext(
    `${activeHelperCode}\n;globalThis.__isWorked = isWorkedForInActiveOrLatestTurn; globalThis.__isTool = isToolGroupInActiveOrLatestTurn; globalThis.__isThinking = isThinkingTriggerInActiveOrLatestTurn;`,
    d0023Sandbox
  );

  // Build exact fiber hierarchy observed in Live CDP for historical segment inside latest turn:
  // depth 2: <G_ isActive:false>, depth 4: <Lhc isLastContainer:true, segment:{isLatest:false}>, depth 10: <pCb container:{isLatest:true}>
  const makeMultiSegmentTurnBtn = (segIsLatest) => ({
    __fiber: {
      memoizedProps: {},
      return: {
        memoizedProps: {},
        return: {
          memoizedProps: { isActive: false },
          return: {
            memoizedProps: { isActive: false },
            return: {
              memoizedProps: {
                isRunning: true,
                isLastContainer: true,
                segment: { isLatest: segIsLatest, steps: [] },
              },
              return: {
                memoizedProps: { container: { isLatest: true } },
                return: null,
              },
            },
          },
        },
      },
    },
  });

  const histSegmentInLatestTurnBtn = makeMultiSegmentTurnBtn(false);
  const latestSegmentInLatestTurnBtn = makeMultiSegmentTurnBtn(true);

  assert.equal(
    d0023Sandbox.__isWorked(histSegmentInLatestTurnBtn, true),
    false,
    'D-0023: isWorkedForInActiveOrLatestTurn must return false when segment.isLatest is false even if isLastContainer is true and inside [data-turn-content="latest"]'
  );
  assert.equal(
    d0023Sandbox.__isTool(histSegmentInLatestTurnBtn, [histSegmentInLatestTurnBtn]),
    false,
    'D-0023: isToolGroupInActiveOrLatestTurn must return false when segment.isLatest is false even if isLastContainer is true'
  );
  assert.equal(
    d0023Sandbox.__isThinking(histSegmentInLatestTurnBtn, [histSegmentInLatestTurnBtn], [histSegmentInLatestTurnBtn]),
    false,
    'D-0023: isThinkingTriggerInActiveOrLatestTurn must return false when segment.isLatest is false even if isLastContainer is true'
  );
  assert.equal(
    d0023Sandbox.__isWorked(latestSegmentInLatestTurnBtn, true),
    true,
    'D-0023: isWorkedForInActiveOrLatestTurn must return true when segment.isLatest is true and isLastContainer is true'
  );
  assert.equal(
    d0023Sandbox.__isThinking(latestSegmentInLatestTurnBtn, [latestSegmentInLatestTurnBtn], [latestSegmentInLatestTurnBtn]),
    true,
    'D-0023: isThinkingTriggerInActiveOrLatestTurn must return true when segment.isLatest is true and isLastContainer is true'
  );
});

test('D-0024..D-0031 comprehensive audit regressions (v1.2.34 / v13.29 & Antigravity v2.31.0)', async () => {
  const os = require('node:os');
  const mod01 = fs.readFileSync(path.join(RENDERER_DIR, '01-bootstrap-and-cache.js'), 'utf8');
  const mod02 = fs.readFileSync(path.join(RENDERER_DIR, '02-static-ui-dict.js'), 'utf8');
  const mod03 = fs.readFileSync(path.join(RENDERER_DIR, '03-text-tokenizer.js'), 'utf8');
  const mod04 = fs.readFileSync(path.join(RENDERER_DIR, '04-translation-adapters.js'), 'utf8');
  const mod05 = fs.readFileSync(path.join(RENDERER_DIR, '05-fiber-pretranslator.js'), 'utf8');
  const mod06 = fs.readFileSync(path.join(RENDERER_DIR, '06-settings-modal-ui.js'), 'utf8');
  const mod07 = fs.readFileSync(path.join(RENDERER_DIR, '07-statusbar-adapter.js'), 'utf8');
  const mod08 = fs.readFileSync(path.join(RENDERER_DIR, '08-dom-observer.js'), 'utf8');

  // D-0024: README.md and README.ko.md must document '한글 번역' tab options accurately without claiming Show Thinking is inside '한글 번역' tab
  const readmeEn = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const readmeKo = fs.readFileSync(path.join(ROOT, 'README.ko.md'), 'utf8');
  const koTabSectionEn = readmeEn.split('2. **Bottom-Left `Settings`')[1]?.split('3. **Model Selector Dropdown')[0] || '';
  const koTabSectionKo = readmeKo.split('2. **좌측 하단 `설정`')[1]?.split('3. **채팅 입력창 하단')[0] || '';
  assert.ok(koTabSectionEn.length > 0 && !koTabSectionEn.includes('Show Thinking'), 'D-0024: README.md KoTranslator tab section must not claim Show Thinking toggle lives inside KoTranslator tab');
  assert.ok(koTabSectionKo.length > 0 && !koTabSectionKo.includes('Thinking (추론 과정) 표시'), 'D-0024: README.ko.md KoTranslator tab section must not claim Thinking 표시 toggle lives inside 한글 번역 tab');
  assert.ok(readmeEn.includes('Settings > Appearance > Chat'), 'D-0024: README.md must document dedicated Show Thinking placement');
  assert.ok(readmeKo.includes('설정 > 모양 및 테마(Appearance) > 채팅(Chat)'), 'D-0024: README.ko.md must document dedicated Show Thinking placement');

  // D-0025: Korean particle fixer must handle (으)로 (including ㄹ batchim exception) and NEVER corrupt unquoted plain Korean words
  const tokSandbox = {
    document: {
      createTextNode: (txt) => ({ nodeType: 3, nodeValue: txt, textContent: txt, cloneNode: function () { return { ...this }; } }),
    },
  };
  vm.runInNewContext(
    `${mod03}\n;globalThis.__protect = protectIdentifiersInThoughtText; globalThis.__restore = restoreIdentifiersInThoughtText; globalThis.__buildEl = buildTranslatedElement;`,
    tokSandbox
  );

  const p1 = tokSandbox.__protect("Switch to '설정' and `파일` and '모드'");
  const r1 = tokSandbox.__restore('⟦T0⟧로 이동하고 ⟦T1⟧으로 저장하며 ⟦T2⟧(으)로 전환합니다.', p1.savedTokens);
  assert.equal(
    r1,
    "'설정'으로 이동하고 `파일`로 저장하며 '모드'로 전환합니다.",
    'D-0025: restoreIdentifiersInThoughtText must apply 으로 for non-ㄹ batchim and 로 for ㄹ batchim or vowel endings'
  );

  // Plain unquoted Korean vocabulary (있는, 없는, 효과, 차이, 경로) must NEVER be corrupted even when savedTokens is non-empty
  const p2 = tokSandbox.__protect('Check `config.json` path');
  const r2 = tokSandbox.__restore('⟦T0⟧에서 효과가 있는 방법과 없는 경로의 차이를 확인합니다.', p2.savedTokens);
  assert.equal(
    r2,
    '`config.json`에서 효과가 있는 방법과 없는 경로의 차이를 확인합니다.',
    'D-0025: unquoted plain Korean words (있는, 없는, 효과, 경로, 차이) must never be mutated by particle fixer'
  );

  // buildTranslatedElement <code> restoration particle check
  const makeElem = (tag, text = '') => ({
    tagName: tag,
    textContent: text,
    children: [],
    appendChild(ch) {
      this.children.push(ch);
      this.textContent += ch.textContent || ch.nodeValue || '';
    },
    cloneNode(deep) {
      return makeElem(this.tagName, deep ? this.textContent : '');
    },
  });
  const builtP = tokSandbox.__buildEl(
    makeElem('P'),
    [makeElem('CODE', '파일'), makeElem('CODE', '설정')],
    '⟦C0⟧으로 열고 ⟦C1⟧로 저장'
  );
  assert.equal(
    builtP.textContent,
    '파일로 열고 설정으로 저장',
    'D-0025: buildTranslatedElement must adjust particles immediately following restored <code> elements including ㄹ batchim'
  );

  // D-0026: Remote Control web environment guard in loadPersistentTranslatorSettings & custom adapter persistence
  const rcSandbox = {
    DEFAULT_TRANSLATION_PROVIDER: 'google-translate',
    PROVIDER_STORAGE_KEY: 'agy-ko-thought-provider',
    SHOW_THINKING_STORAGE_KEY: 'agy-ko-thought-show-thinking',
    TRANSLATE_THINKING_STORAGE_KEY: 'agy-ko-thought-translate-thinking',
    PRETRANSLATE_STORAGE_KEY: 'agy-ko-thought-pretranslate',
    DEFAULT_PRETRANSLATE_ENABLED: false,
    showThinkingEnabled: true,
    translateThinkingEnabled: true,
    resolvedLlmEndpoint: null,
    resolveLocalLlmEndpoint: async () => null,
    refreshTranslatorSettingsUi: () => {},
    protectIdentifiersInThoughtText: (t) => ({ protectedText: t, savedTokens: [] }),
    restoreIdentifiersInThoughtText: (t) => t,
    isInvalidCachedOrTranslatedText: () => false,
    memCache: new Map(),
    inflightMap: new Map(),
    flushCleanCacheToStorage: () => {},
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    fetch: async () => ({ ok: true, json: async () => [] }),
    localStorage: {
      _map: new Map([['agy-ko-thought-provider', 'custom-deepl']]),
      getItem(k) { return this._map.has(k) ? this._map.get(k) : null; },
      setItem(k, v) { this._map.set(k, String(v)); },
    },
    window: {
      location: { origin: 'https://antigravity.google.com' },
      nativeStorage: {
        getItems: async () => ({ 'agy-ko-thought-provider': 'local-llm' }),
        updateItems: () => {},
      },
    },
  };
  rcSandbox.window.localStorage = rcSandbox.localStorage;
  vm.runInNewContext(`${mod04}\n${mod05}`, rcSandbox);
  assert.equal(
    rcSandbox.window.__agyGetTranslationProvider(),
    'google-translate',
    'D-0026: Remote web must start with google-translate when custom-deepl is not registered yet'
  );
  await rcSandbox.window.__agySyncPersistentSettings();
  assert.equal(
    rcSandbox.window.__agyGetTranslationProvider(),
    'google-translate',
    'D-0026: loadPersistentTranslatorSettings in Remote Control web without __agyLocalLlmConfig must NOT switch to host local-llm'
  );
  // Registering saved custom adapter must restore it automatically
  rcSandbox.localStorage.setItem('agy-ko-thought-provider', 'custom-deepl');
  rcSandbox.window.__agyRegisterTranslationAdapter('custom-deepl', {
    label: 'DeepL Custom',
    translate: async ({ cleanText }) => cleanText,
  });
  assert.equal(
    rcSandbox.window.__agyGetTranslationProvider(),
    'custom-deepl',
    'D-0026: registering a custom adapter matching saved localStorage provider must restore activeTranslationProvider'
  );

  // D-0027: restoreAllMutatedNodes must clear parentElement.__agyDynamicSource & __agyTranslatingDynamic; unregisterStatusbarTranslatorAdapter must delete pending Map entry
  const dynParent = { __agyDynamicSource: 'Allow command execution?', __agyTranslatingDynamic: true };
  const dynTextNode = {
    nodeType: 3,
    nodeValue: '명령 실행을 허용할까요?',
    __agyOrigValue: 'Allow command execution?',
    __agyKoApplied: '명령 실행을 허용할까요?',
    parentElement: dynParent,
  };
  const restoreSandbox = {
    NodeFilter: { SHOW_TEXT: 4 },
    window: { location: { origin: 'https://127.0.0.1:58069' } },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      body: {},
      createTreeWalker: () => {
        let done = false;
        return {
          nextNode() {
            if (done) return null;
            done = true;
            return dynTextNode;
          },
        };
      },
      querySelectorAll: () => [],
    },
  };
  vm.runInNewContext(`${mod01}\n;globalThis.__restoreAll = restoreAllMutatedNodes;`, restoreSandbox);
  restoreSandbox.__restoreAll();
  assert.equal(dynTextNode.nodeValue, 'Allow command execution?');
  assert.equal(dynParent.__agyDynamicSource, undefined, 'D-0027: restoreAllMutatedNodes must delete parentElement.__agyDynamicSource');
  assert.equal(dynParent.__agyTranslatingDynamic, undefined, 'D-0027: restoreAllMutatedNodes must delete parentElement.__agyTranslatingDynamic');

  const pendingAdapters = new Map();
  const sbSandbox = {
    disposed: false,
    activeTranslationProvider: 'google-translate',
    KO_LOCALIZER_VERSION: 'v13.29',
    getProviderDisplayMeta: () => ({ shortLabel: 'Google 번역', title: 'Google 번역' }),
    openOrToggleTranslatorSettingsModal: () => {},
    closeTranslatorSettingsModal: () => {},
    window: { __agyCustomStatusBarAdapters: pendingAdapters },
  };
  vm.runInNewContext(
    `${mod07}\n;globalThis.__regSb = registerStatusbarTranslatorAdapter; globalThis.__unregSb = unregisterStatusbarTranslatorAdapter;`,
    sbSandbox
  );
  sbSandbox.__regSb();
  assert.equal(pendingAdapters.has('ko-translator'), true);
  sbSandbox.__unregSb();
  assert.equal(
    pendingAdapters.has('ko-translator'),
    false,
    'D-0027: unregisterStatusbarTranslatorAdapter must delete stale ko-translator entry from __agyCustomStatusBarAdapters Map'
  );

  // D-0028: local-llm-service.js exact port matching & quoted argument preservation
  const { parseCommandArgs, extractListeningPidsFromNetstat } = require(path.join(HOST_DIR, 'local-llm-service.js'));
  assert.deepEqual(
    parseCommandArgs('serve --model "C:\\Program Files\\Models\\qwen ko.gguf" --port 11434'),
    ['serve', '--model', 'C:\\Program Files\\Models\\qwen ko.gguf', '--port', '11434'],
    'D-0028: parseCommandArgs must preserve quoted paths containing spaces'
  );
  const sampleNetstat = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:52000        127.0.0.1:1143         ESTABLISHED     5151',
    '  TCP    127.0.0.1:1143         0.0.0.0:0              TIME_WAIT       0',
    '  TCP    [::1]:1143             [::]:0                 LISTENING       7777',
    '  TCP    127.0.0.1:1143         0.0.0.0:0              LISTENING       9999',
  ].join('\r\n');
  const matchedPids = extractListeningPidsFromNetstat(sampleNetstat, 1143, 9999);
  assert.deepEqual(
    Array.from(matchedPids),
    [7777],
    'D-0028: extractListeningPidsFromNetstat must match only exact local port in LISTENING state, excluding substring ports (:11434), foreign ports, PID 0, and selfPid'
  );

  // D-0029: ensure_statusbar_patch.js owner-verified lock & writeFileAtomicSync parent mkdir
  const statusbarPatcher = require(path.join(HOST_DIR, 'ensure_statusbar_patch.js'));
  const tmpTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ko-d0029-'));
  try {
    const nestedFile = path.join(tmpTestDir, 'nested', 'sub', 'atomic.json');
    statusbarPatcher.writeFileAtomicSync(nestedFile, '{"ok":true}');
    assert.equal(fs.readFileSync(nestedFile, 'utf8'), '{"ok":true}', 'D-0029: writeFileAtomicSync must create missing parent directories');

    const lockFile = path.join(tmpTestDir, 'locks', 'patch.lock');
    assert.equal(statusbarPatcher.acquireLock(lockFile, 60000), true, 'D-0029: initial acquireLock must succeed');
    // Simulate another worker taking over after lock expiry
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 88888, token: 'other-worker-token' }), 'utf8');
    statusbarPatcher.releaseLock(lockFile);
    assert.equal(
      fs.existsSync(lockFile),
      true,
      'D-0029: releaseLock must NOT unlink lock file when owned by a different worker token'
    );
  } finally {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  }

  // D-0030: Zero duplicate keys in STATIC_UI_MAP + contextual 'Type ' + <kbd>/</kbd> localization
  const mapStart = mod02.indexOf('const STATIC_UI_MAP = {');
  const mapEnd = mod02.indexOf('\n  };', mapStart);
  assert.ok(mapStart >= 0 && mapEnd > mapStart, 'STATIC_UI_MAP block must exist');
  const mapBody = mod02.slice(mapStart + 'const STATIC_UI_MAP = {'.length, mapEnd);
  const keyRegex = /^\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*:/gm;
  const seenKeys = new Set();
  const duplicateKeys = [];
  let km;
  while ((km = keyRegex.exec(mapBody)) !== null) {
    const rawKey = km[1] !== undefined ? km[1] : km[2];
    if (seenKeys.has(rawKey)) duplicateKeys.push(rawKey);
    seenKeys.add(rawKey);
  }
  assert.deepEqual(duplicateKeys, [], 'D-0030: STATIC_UI_MAP must contain zero duplicate keys');

  const dictSandbox = {};
  vm.runInNewContext(`${mod02}\n;globalThis.__tr = translateStaticUiSync;`, dictSandbox);
  assert.equal(dictSandbox.__tr('Type'), '유형', 'D-0030: standalone "Type" must translate to "유형"');
  assert.equal(dictSandbox.__tr('Workspaces'), '작업공간', 'D-0030: "Workspaces" must translate to "작업공간"');

  // Verify contextual 'Type ' followed by <kbd>/</kbd> translates to '채팅창에 '
  const kbdSibling = { nodeType: 1, tagName: 'KBD', textContent: '/' };
  const slashTextNode = {
    nodeType: 3,
    nodeValue: 'Type ',
    nextSibling: kbdSibling,
    parentElement: {
      tagName: 'SPAN',
      classList: { contains: () => false },
      getAttribute: () => null,
      closest: () => null,
    },
  };
  const slashRoot = {
    nodeType: 1,
    getAttribute: () => null,
    querySelectorAll: () => [],
  };
  const domObsSandbox = {
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    Node: { TEXT_NODE: 3 },
    translateStaticUiSync: dictSandbox.__tr,
    isAlreadyKoreanOrNonEnglish: () => true,
    translateThoughtTextEnToKo: async (s) => s,
    observer: { takeRecords: () => [] },
    document: {
      createTreeWalker: () => {
        let step = 0;
        return {
          nextNode() {
            step++;
            return step === 1 ? slashTextNode : null;
          },
        };
      },
    },
  };
  const locStaticMatch = mod08.match(/const CUSTOM_NO_TRANSLATE_SUBTREE_SELECTOR[\s\S]*?function doesWorkedForButtonContainThinking/);
  assert.ok(locStaticMatch, 'localizeStaticUiInRoot section must exist in 08-dom-observer.js');
  const locStaticSource = locStaticMatch[0].replace(/\r?\n\r?\n  function doesWorkedForButtonContainThinking$/, '');
  vm.runInNewContext(
    `${locStaticSource}\n;globalThis.__locRoot = localizeStaticUiInRoot; globalThis.__isExcl = isExcludedFromStaticUiLocalization;`,
    domObsSandbox
  );
  domObsSandbox.__locRoot(slashRoot);
  assert.equal(
    slashTextNode.nodeValue,
    '채팅창에 ',
    'D-0030: "Type " immediately preceding <kbd>/</kbd> must translate contextually to "채팅창에 "'
  );

  // D-0031: Antigravity v2.31.0 static/dynamic strings, conversation-row-history & permissions-selector-trigger exclusions, and keepMounted settings modal deactivation
  assert.equal(dictSandbox.__tr('Local Checkout'), '로컬 체크아웃');
  assert.equal(dictSandbox.__tr('Select Environment'), '환경 선택');
  assert.equal(dictSandbox.__tr('Side Question'), '사이드 질문');
  assert.equal(dictSandbox.__tr('Browse the Marketplace'), '마켓플레이스 둘러보기');
  assert.equal(dictSandbox.__tr('Manage Hooks'), '훅(Hooks) 관리');
  assert.equal(
    dictSandbox.__tr('Agent permissions preset selector, current: Auto'),
    '에이전트 권한 프리셋 선택기, 현재: 자동'
  );
  assert.equal(
    dictSandbox.__tr('This workspace overrides your global permission settings.'),
    '이 작업공간은 전역 권한 설정보다 우선 적용됩니다.'
  );
  assert.equal(dictSandbox.__tr('Reply to Code Reviewer...'), 'Code Reviewer에게 답장...');

  // conversation-row-history title excluded while volatile timestamp remains translatable; permissions-selector-trigger excluded
  const historyRowEl = { getAttribute: (k) => (k === 'data-testid' ? 'conversation-row-history' : null) };
  const historyTitleSpan = {
    tagName: 'SPAN',
    textContent: 'My User Chat Title',
    classList: { contains: () => false },
    getAttribute: () => null,
    closest: (sel) => (sel === '[data-testid]' ? historyRowEl : null),
  };
  const historyTimeSpan = {
    tagName: 'SPAN',
    textContent: '2m ago',
    classList: { contains: () => false },
    getAttribute: () => null,
    closest: (sel) => {
      if (sel === '[data-testid]') return historyRowEl;
      if (sel === '[data-screenshot-volatile="true"]') return {};
      return null;
    },
  };
  const permTriggerChild = {
    tagName: 'SPAN',
    textContent: 'Auto',
    classList: { contains: () => false },
    getAttribute: () => null,
    closest: (sel) => (sel.includes('[data-testid="permissions-selector-trigger"]') ? {} : null),
  };
  assert.equal(domObsSandbox.__isExcl(historyTitleSpan, false), true, 'D-0031: user chat title inside conversation-row-history must be excluded');
  assert.equal(domObsSandbox.__isExcl(historyTimeSpan, false), false, 'D-0031: volatile timestamp inside conversation-row-history must be translated');
  assert.equal(domObsSandbox.__isExcl(permTriggerChild, false), true, 'D-0031: permissions-selector-trigger in v2.31.0 must be excluded');

  // keepMounted settings modal deactivation & dynamic nav button binding check
  assert.ok(
    mod06.includes('.settings-modal-container[data-agy-ko-pane-active="1"]') &&
      mod06.includes("backdropEl.getAttribute('aria-hidden') === 'true'") &&
      mod06.includes('otherBtn.__agyKoNavBound'),
    'D-0031: 06-settings-modal-ui.js must suppress dual nav highlight, bind dynamically rendered nav buttons, and auto-deactivate KoPane when keepMounted backdrop becomes aria-hidden="true"'
  );
});
