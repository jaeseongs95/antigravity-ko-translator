# Antigravity 2.0 Korean Thought & UI Translator (`v2.1.0`)

[한국어 README](./README.ko.md)

Clean-slate, **Desktop Native App Only** Korean localization plugin for Antigravity 2.0, hosted via **`antigravity-native-addon-host`** (`AddonManifest.v1`):
- **Real-time Thinking translation** with code/identifier/path preservation and Korean particle normalization.
- **Static English UI localization** with strict exclusions for code viewers, diff lines, terminals, inputs, assistant response bodies, and all sibling plugin UI slots (`[data-addon-host-owner]`, `addonHost.getNoTranslateSelector()`).
- **Official Antigravity Sidecar (`AUX_PANE`) Settings & Diagnostics Panel** (`sidecars/ko-translator-settings/`) with live settings sync via `host/main-hook.js`.
- **Zero-Interference & AddonManifest.v1 Architecture**:
  - **Zero `app.asar` access**: `app.asar` patching and rollback belong exclusively to [antigravity-native-addon-host](https://github.com/jaeseongs95/antigravity-native-addon-host).
  - Zero `fetch` / `lsClient` / Protobuf / `React Fiber` / `Angular` / `Worker` / `AudioWorklet` / `iframe` hooks.
  - Declarative `addon-manifest.v1.json` (`slot: "document-transform"`, `scope: "native-host-only"`, `respectsNoTranslate: true`, `loadOrder: 200`) registered under `~/.gemini/antigravity/addons.d/ko-thought-translator.json`.
  - Uses the host's scoped capability handle (`addonHost.getNoTranslateSelector()`, `addonHost.injectStyle()`, `addonHost.removeStyle()`, `addonHost.onDispose()`).
  - Remote Control web support is intentionally separated into `antigravity-remote-plugin`.

## Architecture

```text
addon-manifest.v1.json     # Declarative AddonManifest.v1 contract
src/
├── core/                  # Pure vendor-independent domain (tokenizer, dictionary, cache, registry)
├── adapters/
│   ├── translators/       # Google Translate, Local LLM (Ollama/OpenAI), Custom HTTP
│   └── antigravity/       # Pure read-only DOM overlay, trigger controller, isolated storage
├── runtime/               # createTranslatorRuntime({ win, doc, hostAdapter, providerBundle, hostCapability })
└── index.js               # Single bundle entry -> dist/renderer.js (consumes addonHost capability handle)
sidecars/
└── ko-translator-settings/# Official Antigravity AUX_PANE Settings & Diagnostics UI
host/
├── addon-registry.js      # AddonManifest.v1 validator & addons.d registration (0 app.asar access)
├── main-hook.js           # AddonManifest.v1 mainHook (Isolated World 999 settings sync & live watch)
├── config-store.js        # Fail-closed isolated ko_translator_settings.json store
├── paths.js & profiles/   # Profile-driven path resolution
└── cli.js                 # Explicit CLI (--status, --install, --uninstall, --rollback)
```

## Commands

```bash
npm run build            # Build deterministic dist/renderer.js
npm test                 # Verify bundle determinism and run all unit & integration tests
npm run status           # Read-only AddonManifest.v1 & settings status report
npm run install:addon    # Register addon-manifest.v1.json into addons.d/ko-thought-translator.json
npm run uninstall:addon  # Unregister manifest and clean ko_translator_settings.json
```
