# Antigravity 2.0 Korean Thought & UI Translator (`v2.0.0`)

[한국어 README](./README.ko.md)

Clean-slate, **Desktop Native App Only** Korean localization plugin for Antigravity 2.0:
- **Real-time Thinking translation** with code/identifier/path preservation and Korean particle normalization.
- **Static English UI localization** with strict exclusions for code viewers, diff lines, terminals, inputs, and assistant response bodies.
- **Official Antigravity Sidecar (`AUX_PANE`) Settings & Diagnostics Panel** (`sidecars/ko-translator-settings/`).
- **Zero-Interference Architecture**:
  - Zero `fetch` / `lsClient` / Protobuf / `React Fiber` / `Angular` / `Worker` / `AudioWorklet` / `iframe` hooks.
  - Zero shared `statusbar_autoinject.js` splicing, zero `app_storage.json` writes, zero background watcher daemons, zero `PreInvocation`/`PostInvocation` hooks.
  - Shared, isolated `ui-extensions.d/ko-thought-translator.json` drop-in loader with live `config.json` `enabled` gating (turning the plugin off immediately runs 0 bytes).
  - Remote Control web support is intentionally separated into `antigravity-remote-plugin`.

## Architecture

```text
src/
├── core/                  # Pure vendor-independent domain (tokenizer, dictionary, cache, registry)
├── adapters/
│   ├── translators/       # Google Translate, Local LLM (Ollama/OpenAI), Custom HTTP
│   └── antigravity/       # Pure read-only DOM overlay, trigger controller, isolated storage
├── runtime/               # createKoTranslator({ win, doc, settings, onStatus }) & scheduler
└── index.js               # Single bundle entry -> dist/renderer.js
sidecars/
└── ko-translator-settings/# Official Antigravity AUX_PANE Settings & Diagnostics UI
host/                      # Explicit CLI (--status, --install, --uninstall, --rollback) & drop-in loader
```

## Commands

```bash
npm run build            # Build dist/renderer.js
npm test                 # Verify bundle determinism and run all unit & integration tests
npm run status           # Read-only loader & settings status report
npm run install:loader   # Register ui-extensions.d manifest and install dist/main.js drop-in loader
npm run uninstall:loader # Unregister manifest and clean ko_translator_settings.json
npm run rollback         # Unregister manifest and atomically restore verified .orig app.asar
```
