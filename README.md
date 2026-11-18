# Antigravity 2.0 Korean Thought & UI Translator (`ko-thought-translator`)

> 🌐 **Language**: **English** | [한국어 문서 (README.ko.md)](./README.ko.md)

Real-time Korean localization plugin (`v2.0.0`) for the Antigravity 2.0 desktop app and **Remote Control web/mobile browser (`https://antigravity.google.com/r/...`)**. Built on a strict acyclic **Hexagonal CommonJS Architecture** (`src/core`, `src/adapters`, `src/remote`, `src/runtime`, `host/`), it translates streaming **Thinking blocks** (including Side Question reasoning & Browser Subagent live thoughts), **step progress summaries (`Worked for ...`)**, and **static UI menus, settings, and widgets** into natural Korean while keeping source code, diffs, monospace tokens, and user text 100% untouched.

---

## Table of Contents

1. [Enabling Korean Localization on Remote Control Web & Mobile](#1-enabling-korean-localization-on-remote-control-web--mobile)
   - [Option A. 1-Click Bookmarklet (PC & Mobile Chrome)](#option-a-1-click-bookmarklet-pc--mobile-chrome)
   - [Option B. Automatic Mount via Tampermonkey UserScript (Recommended for PC Chrome)](#option-b-automatic-mount-via-tampermonkey-userscript-recommended-for-pc-chrome)
   - [Option C. Automatic Co-Loading with `antigravity-statusbar` / `antigravity-mcp-manager`](#option-c-automatic-co-loading-with-antigravity-statusbar--antigravity-mcp-manager)
2. [Desktop App Installation, Auto-Healing & Rollback](#2-desktop-app-installation-auto-healing--rollback)
3. [Translation Settings, Custom Providers & UI Controls](#3-translation-settings-custom-providers--ui-controls)
4. [CLI Commands](#4-cli-commands)
5. [Hexagonal Architecture (`v2.0.0`)](#5-hexagonal-architecture-v200)
6. [License](#6-license)

---

## 1. Enabling Korean Localization on Remote Control Web & Mobile

The Remote Control web app (`https://antigravity.google.com/r/...`) enforces strict browser security policies (CSP3 nonce-hiding, `worker-src 'self'`, `require-trusted-types-for 'script'`, and cross-origin sandbox `iframe`). `ko-thought-translator` safely promotes the `<ga-remote-control>` workbench `iframe` to same-origin via a deterministic Finite State Machine (`IDLE -> PREFLIGHT -> PROMOTING_BLANK -> BOOTING_WORKBENCH -> READY | ROLLED_BACK | EXTERNAL_PROMOTED`), `0`-arg `document.open()/close()` URL inheritance, `INITIAL_CONFIG` `MessagePort` replay, and an ECMA-262 live-binding ESM/classic Worker bridge.

### Option A. 1-Click Bookmarklet (PC & Mobile Chrome)

1. Right-click the Chrome bookmarks bar → **`Add page...`**.
2. **Name**: `한글번역`
3. **URL**: Copy and paste the single-line bookmarklet below and save:

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js?t='+Date.now()).then(r=>r.ok?r.text():'').then(c=>{if(!c)return;try{const s=document.createElement('script'),n=[...document.querySelectorAll('script,style,link')].map(e=>e.nonce||e.getAttribute('nonce')).find(Boolean),t=window.trustedTypes;let u=0,p=null;if(t?.createPolicy){for(const k of['agy-ko-translator-bm','agy-ko-translator'])try{p=t.createPolicy(k,{createScript:x=>{if(u||x!==c)throw new TypeError();u=1;return x}});if(p)break}catch{}if(!p)return}if(n){s.nonce=n;s.setAttribute('nonce',n)}s.text=p?p.createScript(c):c;(document.head||document.documentElement).appendChild(s)}catch{}})})();
```

### Option B. Automatic Mount via Tampermonkey UserScript (Recommended for PC Chrome)

- **Raw UserScript URL**: `https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js`

### Option C. Automatic Co-Loading with `antigravity-statusbar` / `antigravity-mcp-manager`

When `ko-thought-translator` is installed on the host PC, running `antigravity-statusbar` or `antigravity-mcp-manager` in a remote browser automatically co-loads Korean translation. Conversely, running the `한글번역` bookmarklet conditionally synchronizes installed host companion plugins via authenticated Language Server RPCs.

---

## 2. Desktop App Installation, Auto-Healing & Rollback

```powershell
# 1. Clone into the Antigravity plugins directory
git clone https://github.com/jaeseongs95/antigravity-ko-translator.git "$HOME\.gemini\config\plugins\ko-thought-translator"

# 2. Apply the V6 patch and start the background watcher daemon
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --worker

# 3. Check current read-only status
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --status
```

---

## 3. Translation Settings, Custom Providers & UI Controls

1. **Bottom Status Bar `[ 번역:구글 ]` / `[ 번역:LLM ]` Pill**: Click to open `#agy-ko-translator-modal`; `Shift + Click` to cycle registered translation providers.
2. **`Settings` (`설정`) → `한글 번역` Tab & Quick Modal (`#agy-ko-translator-modal`)**:
   - Select between **`google-translate`**, **`local-llm`** (configurable Ollama/OpenAI endpoint, model, timeout, and remote HTTPS toggle), or **Origin-Local Custom HTTP Providers** (`CustomProviderSpec`, with custom auth headers isolated strictly in origin-local `window.localStorage` and never written to disk or shared bundles).
   - Toggle **Thinking Translation**, **Background Pre-translation**, and **Cache Clear / Immediate Retranslation**.
3. **Model Selector Dropdown & `Settings > Appearance > Chat`**:
   - Dedicated **Show Thinking (`Thinking (추론 과정) 표시`)** switch while preserving native `verboseConversationSteps` (`Default` / `Verbose`) read-only.

---

## 4. CLI Commands

```powershell
# Build & check 4-mirror deterministic bundle parity
npm run build
npm run build:check

# Run full unit (13 suites) + real Chromium CDP E2E (S0-S5) verification
npm test

# Host patch, status, provider/pretranslate configuration, uninstall, and atomic ASAR rollback
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --status
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --worker
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider google-translate
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider local-llm
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate off
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate on
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --uninstall
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --rollback
```

---

## 5. Hexagonal Architecture (`v2.0.0`)

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`docs/TEST_CASES.md`](./docs/TEST_CASES.md) for full architectural invariants and verification specifications:
- **`src/core/`**: Pure domain logic (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`) — zero DOM/network/vendor globals.
- **`src/adapters/`**: Vendor-neutral `host-adapter-config` validator, SSRF-hardened `translators/` (`endpoint-validator`, `google-translate`, `local-llm`, `custom-provider`), `statusbar-port`, and `antigravity/` UI/DOM/Storage/Settings/Companion adapters.
- **`src/remote/`**: Zero-vendor `csp-security-policy`, `asset-url-rewriter`, 3-phase ECMA-262 `js-module-compiler`, `worker-bridge`, `dom-guard-installer`, and `workbench-promoter` FSM.
- **`src/runtime/` & `scripts/build.js`**: Parameterized `mount(targetWin, targetDoc)` composition root, `observer-scheduler`, and deterministic LF CommonJS bundler.
- **`host/`**: `cli`, `config-store` (`ko_translator_settings.json` SSOT), cryptographic IPC `process-sentinel`, `local-llm-daemon`, `bundle-injector`, and standalone `AGY_STATUSBAR_AUTOINJECT_V6` `ensure_statusbar_patch`.

---

## 6. License

This project is licensed under the [MIT License](./LICENSE).
