# Antigravity 2.0 Korean Thought & UI Translator (`ko-thought-translator`)

> 🌐 **Language**: **English** | [한국어 문서 (README.ko.md)](./README.ko.md)

Real-time Korean localization plugin for the Antigravity 2.0 desktop app and **Remote Control web/mobile browser (`https://antigravity.google.com/r/...`)** (`v1.2.32` / `v13.27`). Automatically translates streaming **Thinking blocks**, **step progress summaries (`Worked for ...`)**, **conversation navigator & subagent/cron statuses**, and **static UI menus, settings, and widgets** into natural Korean with zero-latency static dictionary lookup and Port & Adapter translation engines.

---

## Table of Contents

1. [Enabling Korean Localization on Remote Control Web & Mobile](#1-enabling-korean-localization-on-remote-control-web--mobile)
   - [Option A. 1-Click Bookmarklet (PC & Mobile Chrome)](#option-a-1-click-bookmarklet-pc--mobile-chrome)
   - [Option B. Automatic Mount via Tampermonkey UserScript (Recommended for PC Chrome)](#option-b-automatic-mount-via-tampermonkey-userscript-recommended-for-pc-chrome)
   - [Option C. Automatic Co-Loading with `antigravity-statusbar`](#option-c-automatic-co-loading-with-antigravity-statusbar)
2. [Desktop App Installation & Auto-Healing](#2-desktop-app-installation--auto-healing)
3. [Translation Settings & UI Controls](#3-translation-settings--ui-controls)
4. [Key Features](#4-key-features)
5. [CLI Commands](#5-cli-commands)
6. [Module Architecture (SOLID)](#6-module-architecture-solid)
7. [License](#7-license)

---

## 1. Enabling Korean Localization on Remote Control Web & Mobile

The Remote Control web app (`https://antigravity.google.com/r/...`) enforces strict browser security policies (CSP `nonce`, `TrustedTypes`, and cross-origin `iframe` isolation). This script automatically bridges the top-level `<ga-remote-control>` Angular shell with the internal workbench `iframe` (`hubFrame`) to deliver the exact same Korean UI and Thinking translation experience as the desktop app.

### Option A. 1-Click Bookmarklet (PC & Mobile Chrome)

Register a single bookmark on your Chrome bookmarks bar to enable Korean localization with one click—no browser extension required.

1. Right-click the Chrome bookmarks bar → **`Add page...`** (or **`Add new bookmark`** in Bookmark Manager).
2. **Name**: `한글번역` (or `AGY KO`)
3. **URL**: Copy and paste the single-line bookmarklet below and save:

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js?t='+Date.now()).then(r=>r.text()).then(c=>{const s=document.createElement('script'),n=document.querySelector('script[nonce]')?.nonce,p=window.trustedTypes?.createPolicy('agy-ko-'+Date.now(),{createScript:x=>x});if(n)s.nonce=n;s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();
```

4. **How to use**:
   - **PC Chrome**: Open your `https://antigravity.google.com/r/...` remote session and click **`한글번역`** on the bookmarks bar. Within ~1 second, the workbench connects and localizes all UI elements and Thinking blocks into Korean.
   - **Mobile Chrome**: Tap the address bar, type `한글번역`, and tap the matching `★ 한글번역` bookmark from the dropdown list.

---

### Option B. Automatic Mount via Tampermonkey UserScript (Recommended for PC Chrome)

To automatically mount Korean localization whenever you open a Remote Control session:

1. Install **Tampermonkey** from the Chrome Web Store.
2. Navigate to `chrome://extensions` → enable **`Developer mode`** (top right) → click **`Details`** on Tampermonkey → enable **`Allow User Scripts`**.
3. Click the Tampermonkey icon → **`Create a new script...`**, paste the contents from the Raw URL below, and save (`Ctrl+S`):
   - **Raw UserScript URL**: `https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js`
4. Every visit to `https://antigravity.google.com/r/*` will now automatically mount the Korean localizer and companion plugins.

---

### Option C. Automatic Co-Loading with `antigravity-statusbar`

When `ko-thought-translator` is installed on the host PC, running either **`antigravity-statusbar`** or **`antigravity-mcp-manager`** in a remote browser automatically detects the host plugin configuration and co-loads Korean translation. Conversely, running the **`한글번역`** bookmarklet alone also conditionally synchronizes `antigravity-statusbar` and `antigravity-mcp-manager` if they are installed on the host.

---

## 2. Desktop App Installation & Auto-Healing

On the desktop Antigravity 2.0 application, a background storage watcher daemon and lifecycle hooks automatically maintain the patch across app updates and restarts.

```powershell
# 1. Clone into the Antigravity plugins directory
git clone https://github.com/jaeseongs95/antigravity-ko-translator.git "$HOME\.gemini\config\plugins\ko-thought-translator"

# 2. Apply the patch immediately and start the background watcher daemon
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --worker

# 3. Check current patch & translation engine status
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --status
```

---

## 3. Translation Settings & UI Controls

While Korean localization is active (both Desktop and Remote Browser), you can control all options in real time from three places:

1. **Bottom Status Bar `[ 번역:구글 ]` / `[ 번역:LLM ]` Pill** (when integrated with `antigravity-statusbar`):
   - **Click**: Toggle the quick settings modal (`#agy-ko-translator-modal`).
   - **`Shift + Click`**: Instantly switch between `Google Translate` and `Local LLM`.
2. **Bottom-Left `Settings` (`설정`) → `한글 번역` (`KoTranslator`) Tab**:
   - **Translation Adapter**: `Google 번역 (무료 API, 자원 소모 없음)` / `로컬 LLM (127.0.0.1:11434, 외부 전송 없음)`
   - **Thinking Translation (`ON/OFF`)**: Enable or disable Korean translation of reasoning bodies (restores original English text immediately when turned off).
   - **Show Thinking (`ON/OFF`)**: Show or hide Thinking blocks in the conversation view.
   - **Pre-translate Thinking (`ON/OFF`)**: Pre-translate collapsed historical Thinking blocks in the background.
   - **Retranslate Current View / Clear Translation Cache**
3. **Model Selector Dropdown & `Settings > Appearance > Chat`**:
   - Includes a dedicated **Show Thinking (`ON/OFF`)** toggle switch while preserving the native `Conversation Steps` (`verboseConversationSteps: Default / Verbose`) preference.

---

## 4. Key Features

1. **Port & Adapter Translation Layer (`google-translate` / `local-llm`)**
   - Protects inline code (`⟦C0⟧`), identifiers, and Korean quoted strings (`⟦T0⟧`), strips unexpected Kana/CJK hanja noise, automatically fixes Korean postpositions (`은/는`, `이/가`, `을/를`, `과/와`, `으로/로`), debounces streaming chunks, and persists translations in `localStorage` + `memCache`.
   - **`google-translate` (Default)**: Runs with zero local GPU/RAM overhead on both desktop and remote web. Switching to `google-translate` automatically terminates any idle local LLM server process.
   - **`local-llm`**: Uses a local OpenAI-compatible server (`http://127.0.0.1:11434`) for 100% offline translation.
   - **Custom Adapter Extension**: Register custom translation providers at runtime via `window.__agyRegisterTranslationAdapter(id, { maxConcurrency, translate })`.

2. **0ms Synchronous Static UI & Widget Localization (`STATIC_UI_MAP`)**
   - Instantly localizes the menu bar, sidebar (`새 대화`, `맞춤 설정`, `대화 기록`, `CLI 프로젝트`), right side panel (`개요`, `변경사항 검토`, `서브에이전트`, `백그라운드 명령`), conversation navigator (`대화 턴 목록`), schedule/cron/subagent/compacting/checkpoint/browser-tool steps, settings categories, remote control settings, `ask_question`, and permission prompts in 0ms.
   - Preserves the status bar (`.agy-ctx-statusbar`), model/permission selector triggers, `New` model badges, user project/workspace names, and code identifiers untouched.

3. **Automatic App Update Detection & Self-Healing**
   - A detached background daemon (`--watch-storage`) monitors `app.asar` and `DevToolsActivePort` every 2 seconds to re-apply patches and inject via Live CDP immediately after an Antigravity update.
   - `SessionStart`, `PreInvocation`, and `PostInvocation` hooks verify patch integrity synchronously (`spawnSync`).

---

## 5. CLI Commands

```powershell
# Check patch status or synchronize immediately
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --status
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --worker

# Switch translation adapter (google-translate | local-llm)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider google-translate
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider local-llm

# Toggle background Thinking pre-translation (off | on, default: off)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate off
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate on
```

---

## 6. Module Architecture (SOLID)

- **Renderer Layer (`scripts/renderer/`)**:
  - `01-bootstrap-and-cache.js`: Version guard (`v13.27`), automatic activation of `remove-conversation-history: false` (`대화 기록` menu), read-only inspection of native `verboseConversationSteps`, full DOM restoration on disable, and translation cache (`memCache` / `localStorage`) persistence.
  - `02-static-ui-dict.js`: 0ms static UI Korean dictionary (`STATIC_UI_MAP`) and synchronous pattern matcher (`matchStaticUiPatternUncached`).
  - `03-text-tokenizer.js`: Code (`⟦C0⟧`) and identifier/quote (`⟦T0⟧`) protective tokenizer, Korean postposition fixer, and Markdown segment extractor.
  - `04-translation-adapters.js`: Port & Adapter translation engine (`local-llm`, `google-translate`, custom adapters) with concurrency & cancellation queues.
  - `05-fiber-pretranslator.js`: Persistent settings loader and React Fiber background pre-translator.
  - `06-settings-modal-ui.js`: Stylesheet, native Antigravity 2.0 settings modal (`.settings-modal-container`) integration, and quick settings modal (`#agy-ko-translator-modal`).
  - `07-statusbar-adapter.js`: Pure `StatusBarAdapter` bridge (`window.agyStatusBar.registerAdapter` / `unregisterAdapter` / `updateAll`) for `antigravity-statusbar`.
  - `08-dom-observer.js`: Remote Control `<ga-remote-control>` (`getDebugNode(rcEl).componentInstance`) same-origin `hubFrame` bridge, conditional companion plugin loader, streaming Thinking block renderer, static UI `TreeWalker`, and `MutationObserver` lifecycle manager.
- **Host Layer (`scripts/host/` & `scripts/ensure_ko_thought_patch.js`)**:
  - `paths.js`: Host paths, distributable bundle mirrors (`scripts/`, `dist/`, `plugins/`, `skills/`), and environment constants.
  - `ensure_statusbar_patch.js`: Built-in `app.asar` and Live CDP patcher fallback for standalone installations.
  - `local-llm-service.js`: Local LLM server startup, health-check, and process-tree termination adapter.
  - `settings-storage.js`: Single Source of Truth (`config.json`) & `app_storage.json` atomic synchronization and background storage watcher daemon.
  - `bundle-injector.js`: Assembles `scripts/renderer/*.js` modules and synchronizes `statusbar_autoinject.js` (supporting both line and block markers).
  - `ensure_ko_thought_patch.js`: CLI / Hook orchestrator entry point.

---

## 7. License

This project is licensed under the [MIT License](./LICENSE).
