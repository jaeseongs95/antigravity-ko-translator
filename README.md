# Antigravity 2.0 Korean Thought & UI Translator (`v2.1.0`)

[한국어 README](./README.ko.md)

Clean-slate, **Desktop Native App Only** Korean localization plugin for Antigravity 2.0, hosted via **`antigravity-native-addon-host` (`>= v2.1.0`)** under **`AddonManifest.v2`** (renderer-only, zero `mainHook`, unidirectional read-only `settingsBridge`):
- **Real-time Thinking translation** with code/identifier/path preservation and Korean particle normalization.
- **Static English UI localization** with strict exclusions for code viewers, diff lines, terminals, inputs, assistant response bodies, and all sibling plugin UI slots (`[data-addon-host-owner]`, `[data-addon-host-slot]`, `[data-addon-host-no-translate]`, `addonHost.isElementInsideIgnored()`).
- **Official Antigravity Sidecar (`AUX_PANE`) Settings & Diagnostics Panel** (`sidecars/ko-translator-settings/`) writing `~/.gemini/antigravity/ko_translator_settings.json`, pushed live to World `998` by the host's read-only `settingsBridge` (`addonHost.getSettings()` / `addonHost.onSettingsChange()`).
- **Hardened Zero-Interference `AddonManifest.v2` Architecture**:
  - **Zero `app.asar` access & zero `mainHook`**: `app.asar` patching and rollback belong exclusively to [antigravity-native-addon-host](https://github.com/jaeseongs95/antigravity-native-addon-host).
  - **Cache-only `localStorage` & zero World `998` globals**: Security-sensitive settings (`enabled`, `provider`, `llmConfig`, `customProviders`) are never read from `localStorage` and never exposed on `window.__agyKoTranslator` under `addonHost`, preventing fail-open leaks across dynamic LS port rotations and World `0`/World `998` `localStorage` poisoning.
  - **Fail-closed missing/corrupted settings**: Missing or malformed host settings snapshots fail closed (`enabled: false`, `provider: null`) with zero external translation requests.
  - Declarative `addon-manifest.v2.json` (`trustLevel: "trusted"`, `minHostVersion: "2.1.0"`, `capabilities: ["renderer"]`, `settingsBridge`, `slot: "document-transform"`, `scope: "native-host-only"`, `shadow: false`, `respectsNoTranslate: true`, `loadOrder: 200`).
  - Remote Control web support is intentionally separated into `antigravity-remote-plugin`.

## Architecture

```text
addon-manifest.v2.json     # Declarative AddonManifest.v2 contract (renderer-only + settingsBridge)
src/
├── core/                  # Pure vendor-independent domain (tokenizer, dictionary, cache, registry)
├── adapters/
│   ├── translators/       # Google Translate, Local LLM (Ollama/OpenAI), Custom HTTP (secret-guarded)
│   └── antigravity/       # Pure read-only DOM overlay, trigger controller, cache-only storage-port
├── runtime/               # createTranslatorRuntime consuming addonHost.getSettings/onSettingsChange/isElementInsideIgnored
└── index.js               # Single bundle entry -> dist/renderer.js (closure-scoped under addonHost)
sidecars/
└── ko-translator-settings/# Official Antigravity AUX_PANE Settings & Diagnostics UI (same-host Origin guard)
host/
├── addon-registry.js      # AddonManifest.v2 validator & addons.d registration (0 app.asar access)
├── config-store.js        # Fail-closed isolated ko_translator_settings.json store
├── paths.js & profiles/   # Profile-driven path resolution (World 998, ADDON_HOST_LOADER_V2)
└── cli.js                 # Explicit CLI (--status, --install, --uninstall, --rollback)
```

## Installation & Commands

Install real copied files (no symlinks) into `~/.gemini/config/plugins/ko-thought-translator/`, upgrade `antigravity-native-addon-host` to `v2.1.0+`, register the manifest, and approve SHA-256 trust pinning:

```bash
npm run build            # Build deterministic dist/renderer.js
npm test                 # Verify bundle determinism and run all unit & integration tests
npm run status           # Read-only AddonManifest.v2 & settings status report
npm run install:addon    # Register addon-manifest.v2.json & initialize missing settings file
npm run uninstall:addon  # Unregister manifest and clean ko_translator_settings.json

# In antigravity-native-addon-host (>= v2.1.0):
addon-host --register ~/.gemini/config/plugins/ko-thought-translator/addon-manifest.v2.json
addon-host trust approve ko-thought-translator
addon-host --doctor
```
