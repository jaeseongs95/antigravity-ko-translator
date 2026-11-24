# Antigravity 2.0 Korean Thought & UI Translator (`v2.3.0`)

[한국어 README](./README.ko.md) | [Release Notes (`v2.3.0` EN/KO)](./RELEASE_NOTES_v2.3.0.md)

Clean-slate, renderer-only Korean localization plugin for **Antigravity 2.0 Desktop Native App & Remote Web (`antigravity.google.com/r/...`)**, hosted via **[antigravity-native-addon-host](https://github.com/jaeseongs95/antigravity-native-addon-host) (`>= v2.3.0`)** under **`AddonManifest.v2`** (zero `mainHook`, zero Sidecar `AUX_PANE`).

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
addon-manifest.v2.json     # Declarative AddonManifest.v2 contract (Desktop + Remote Web, minHostVersion 2.3.0)
src/
├── core/                  # Pure vendor-independent domain (tokenizer, dictionary, cache, registry)
├── adapters/
│   ├── translators/       # Google Translate, Local LLM (Ollama/OpenAI), Custom HTTP (secret-guarded)
│   └── antigravity/       # Pure read-only DOM overlay, quick-settings-ui (statusbar + host tab/actions + Shadow modal), cache-only storage-port
├── runtime/               # Vendor-neutral createTranslatorRuntime consuming addonHost capabilities
└── index.js               # Single bundle entry -> dist/renderer.js (closure-scoped under addonHost)
host/
├── addon-registry.js      # AddonManifest.v2 multi-profile validator & addons.d registration (0 app.asar access)
├── config-store.js        # Fail-closed isolated ko_translator_settings.json store
├── paths.js & profiles/   # Profile-driven path resolution (World 998, ADDON_HOST_LOADER_V2)
└── cli.js                 # Explicit CLI (--status, --install, --uninstall, --rollback)
```

## Installation & Commands

Install real copied files (no symlinks) into `~/.gemini/config/plugins/ko-thought-translator/`, upgrade `antigravity-native-addon-host` to `v2.3.0+`, register the manifest, and approve SHA-256 trust pinning:

```bash
npm run build            # Build deterministic dist/renderer.js
npm test                 # Verify bundle determinism and run all unit & Chromium E2E tests
npm run status           # Read-only AddonManifest.v2 & settings status report
npm run install:addon    # Register addon-manifest.v2.json & initialize missing settings file
npm run uninstall:addon  # Unregister manifest and clean ko_translator_settings.json

# In antigravity-native-addon-host (>= v2.3.0):
addon-host --register ~/.gemini/config/plugins/ko-thought-translator/addon-manifest.v2.json
addon-host trust approve ko-thought-translator
addon-host --doctor
addon-host --profile remote-web --doctor
```
