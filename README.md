# Antigravity 2.0 Korean Thought & UI Translator (`v3.1.0`)

[한국어 README](./README.ko.md) | [Release Notes (`v3.1.0` EN/KO)](./RELEASE_NOTES_v3.1.0.md)

Clean-slate, renderer-only Korean localization plugin for **Antigravity 2.0 Desktop Native App & Remote Web (`antigravity.google.com/r/...`)**, built for **[Extenra](https://github.com/jaeseongs95/extenra) `v3.3.0+`** under **`AddonManifest.v3`** API-First architecture (zero `mainHook`, zero Sidecar `AUX_PANE`, Desktop & Remote Web parity via `AddonContextV3`).

### Highlights in v3.1.0
- **External Cloud API Translator (`cloud-api`)**: Supports **OpenAI**, **Anthropic (Claude)**, **Google Gemini**, and **OpenAI-compatible** HTTPS endpoints directly from the Quick Settings modal (`외부 API`).
- **Extenra v3.3.0 `ctx.secrets` + `net.fetch({ secretHeaders })` Integration**: API keys are stored strictly in the Extenra host secrets vault (Desktop OS encryption / Remote Bridge / standalone ephemeral session memory) and injected server-side by the host — never written to `ko_translator_settings.json` or `localStorage`.

### 1-Click Remote Web Install (Public HTTPS Userscript — Zero Private IP / Zero Home PC)
1. Install **Tampermonkey**, **Violentmonkey**, or **Userscripts (iOS/macOS Safari)** in your browser.
2. Click the public HTTPS release link to install with automatic updates and `@require` host runtime:
   - 👉 **[Install ko-thought-translator.user.js](https://github.com/jaeseongs95/antigravity-ko-translator/releases/latest/download/ko-thought-translator.user.js)**
3. Open `https://antigravity.google.com` — the translator joins the unified Shadow-DOM Addons drawer and coexists cleanly with other modular Userscripts (such as `antigravity-statusbar.user.js`).

### Highlights in v3.0.0
- **`AddonManifest.v3` API-First Migration (`schemaVersion: 3`, `apiVersion: 3`, `minHostVersion: "3.0.0"`)**:
  - Adds [`addon-manifest.v3.json`](./addon-manifest.v3.json) with explicit `permissions.ui` (`statusItems`, `settingsPages`, `commands`, `overlays`, `toasts`, `canvas`), `permissions.storage`, `permissions.services.consume: ["host.statusbar"]`, `permissions.net` (`httpsHosts: ["translate.googleapis.com"]`, `localLoopback: [11434]`), `permissions.dom.documentTransform: true`, and `compatibility.surfaces: ["desktop", "remote-web"]`.
  - Adds `src/adapters/antigravity/host-capability-adapter.js` wrapping `AddonContextV3` (`ui.registerStatusItem`, `ui.registerSettingsPage`, `ui.registerCommand`, `ui.openModal`, `ui.injectStyle`/`removeStyle`, `net.fetch` dual-key routing, `dom.isElementInsideIgnored`, `settingsBridge`/`storage`, `lifecycle.onDispose`) while preserving `v2` `addonHost` and standalone compatibility.
- **Quick Settings Popup UI/UX Redesign**:
  - Merges the previously overlapping checkboxes (`한국어 번역 사용` + `영문 고정 UI 한글화`) into **1 clear slide ON/OFF switch** (`영문 UI 한글화`), deriving runtime active state automatically across UI localization, Thinking translation, and Thinking block visibility.
  - Converts all option toggles (`영문 UI 한글화`, `Thinking(추론 과정) 한국어 번역`, `Thinking 블록 표시`, and Local LLM `원격 HTTPS 엔드포인트 허용`) into accessible `role="switch"` slide ON/OFF controls with `--ag-*` host theme tokens, keyboard focus rings, and `prefers-reduced-motion` support.
- **Desktop & Remote Web Parity Verified with `@antigravity-addons/sdk`**:
  - Verified against real `antigravity-addons v3.0.0` `validateAddonManifest` and `@antigravity-addons/sdk` `createTestHost({ surface: 'desktop' | 'remote-web' })` as well as real Headless Chromium Blink CSS & Shadow DOM modal E2E tests.

### Highlights in v2.4.0
- **Public HTTPS Modular Userscript Release (`ko-thought-translator.user.js` + `.meta.js`)**:
  - Built via `antigravity-addons v2.8.0` `--build-addon-userscript` with `@require https://github.com/jaeseongs95/antigravity-addons/releases/latest/download/antigravity-remote-host.lib.js`, `@inject-into content`, `GM_getValue`/`GM_setValue`/`GM_deleteValue`/`GM_xmlhttpRequest`, explicit `@connect translate.googleapis.com`, and automatic GitHub Releases updates (`@updateURL`/`@downloadURL`).
- **CSP/CORS-Resilient Userscript HTTPS Transport (`src/adapters/translators/gm-fetch.js`)**:
  - Transparently routes `https:` translation requests through `GM_xmlhttpRequest` (`GM.xmlHttpRequest`) when running inside a Userscript sandbox so `translate.googleapis.com` works reliably even under strict `antigravity.google.com` page CSP `connect-src`/CORS, while respecting `AbortSignal` + `anonymous: true` and falling back to standard `fetch` on Desktop and local loopback HTTP.
- **Version Metadata Sync (`v2.4.0`)**:
  - Synchronizes `package.json`, `plugin.json`, `addon-manifest.v2.json`, `src/index.js`, `src/runtime/bootstrap.js`, `scripts/build.js`, and `host/cli.js` to `2.4.0`.

### Highlights in v2.3.0
- **`antigravity-native-addon-host v2.3.0` Multi-Profile Compatibility (`antigravity-desktop` + `antigravity-remote-web`)**:
  - Declares `compatibility.hostProfiles: ["antigravity-desktop", "antigravity-remote-web"]` and `compatibility.minHostVersion: "2.3.0"` in `addon-manifest.v2.json`, and updates `host/addon-registry.js` to validate `hostProfiles` and `excludeHostProfiles` cleanly while keeping `src/runtime/` and `host/addon-registry.js` 100% vendor-neutral.
- **Remote Web First-Boot Support (Without Weakening Desktop Fail-Closed Security)**:
  - On `antigravity-remote-web`, when no pre-seeded settings snapshot exists yet (`addonHost.getSettings() === null`), the Antigravity host adapter supplies safe initial defaults (`enabled: true`, `provider: 'google-translate'`), while corrupted snapshots (`status: 'error'`, invalid JSON, invalid provider) still fail closed on **all** host profiles and Desktop missing/null snapshots remain strictly fail-closed (`ERR_SETTINGS_FILE_MISSING`).
- **Remote Web Host Drawer Settings Tab & Actions + `[data-addon-host-ignore]` Protection**:
  - Registers `addonHost.registerSettingsTab('ko-translator.quick-settings', ...)` and host actions (`open-quick-settings`, `toggle-engine`) alongside the statusbar button so Quick Settings Modal & engine toggling work seamlessly even when `antigravity-statusbar` is not mounted.
  - Adds `[data-addon-host-ignore]` defense-in-depth exclusion across `ui-localizer`, `thinking-translator`, `trigger-controller`, and `host-adapter` to protect the Remote Web Host Control Panel Drawer and fallback slot dock.
- **Version Metadata Synchronization**:
  - Synchronizes runtime, bundle banner, CLI status report, manifest, and plugin metadata to `v2.3.0` (removing stale `2.1.1`/`2.2.0` strings).

### Core Features
- **Real-time Thinking translation** with code/identifier/path preservation and Korean particle normalization.
- **Static English UI localization** with strict exclusions for code viewers, diff lines, terminals, inputs, assistant response bodies, and all host/sibling plugin UI slots (`[data-addon-host-ignore]`, `[data-addon-host-owner]`, `[data-addon-host-slot]`, `[data-addon-host-no-translate]`, `addonHost.isElementInsideIgnored()`).
- **In-App Statusbar Button + Host Drawer Settings Tab/Actions + Shadow DOM Quick Settings Modal** backed by host `settingsBridge` (`addonHost.getSettings()` / `addonHost.onSettingsChange()` / `addonHost.saveSettings()`), persisting settings via Electron `ko_translator_settings.json` on Desktop and `remote-host-bridge` on Remote Web.
- **Hardened Zero-Interference `AddonManifest.v2` Architecture**:
  - **Zero `app.asar` access & zero `mainHook`**: `app.asar` patching and rollback belong exclusively to [antigravity-native-addon-host](https://github.com/jaeseongs95/antigravity-native-addon-host).
  - **Zero HTML sinks & zero `eval`**: Passes `antigravity-native-addon-host` v2.3.0 Acorn AST security verification (`0` violations) for Chrome Extension MV3 / Trusted Types packing.
  - **Cache-only `localStorage` & zero World `998` globals**: Security-sensitive settings (`enabled`, `provider`, `llmConfig`, `customProviders`) are never read from `localStorage` and never exposed on `window.__agyKoTranslator` under `addonHost`.

## Architecture

```text
addon-manifest.v3.json     # Declarative AddonManifest.v3 contract (Desktop + Remote Web, minHostVersion 3.0.0)
src/
├── core/                  # Pure vendor-independent domain (tokenizer, dictionary, cache, registry)
├── adapters/
│   ├── translators/       # Google Translate, Local LLM (Ollama/OpenAI), Custom HTTP (secret-guarded)
│   └── antigravity/       # Pure read-only DOM overlay, v3 host-capability-adapter, slide-switch quick-settings-ui, cache-only storage-port
├── runtime/               # Vendor-neutral createTranslatorRuntime consuming AddonContextV3 / addonHost capabilities
└── index.js               # Single bundle entry -> dist/renderer.js (closure-scoped under AddonContextV3 / addonHost)
host/
├── addon-registry.js      # AddonManifest.v3/v2 validator & addons.d registration (0 app.asar access)
├── config-store.js        # Fail-closed isolated ko_translator_settings.json store
├── paths.js & profiles/   # Profile-driven path resolution (World 998, ADDON_HOST_LOADER_V2)
└── cli.js                 # Explicit CLI (--status, --install, --uninstall, --rollback)
```

## Installation & Commands

Install real copied files (no symlinks) into `~/.gemini/config/plugins/ko-thought-translator/`, upgrade `antigravity-addons` to `v3.0.0+`, register the v3 manifest, and approve SHA-256 trust pinning:

```bash
npm run build            # Build deterministic dist/renderer.js
npm test                 # Verify bundle determinism and run all unit, SDK v3 parity & Chromium E2E tests
npm run status           # Read-only AddonManifest.v3 & settings status report
npm run install:addon    # Register addon-manifest.v3.json & initialize missing settings file
npm run uninstall:addon  # Unregister manifest and clean ko_translator_settings.json

# In antigravity-addons (>= v3.0.0):
addon-host --register ~/.gemini/config/plugins/ko-thought-translator/addon-manifest.v3.json
addon-host trust approve ko-thought-translator
addon-host --doctor
addon-host --profile remote-web --doctor
```
