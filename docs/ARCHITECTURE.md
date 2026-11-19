# `antigravity-ko-translator` v2.0.0 — Clean-Slate Desktop Architecture (`docs/ARCHITECTURE.md`)

## 1. Overview & Design Principles

`antigravity-ko-translator` `v2.0.0` is a **Desktop Native App–only** Korean translation plugin for Antigravity. Remote Control web support is intentionally excluded from this repository (handled separately by `antigravity-remote-plugin`).

```
+-----------------------------------------------------------------------+
| Antigravity Desktop Native App                                        |
|                                                                       |
|  1) Official Sidecar (AUX_PANE)        2) Renderer (Pure DOM Overlay) |
|     sidecars/ko-translator-settings/      dist/renderer.js (IIFE)     |
|     - Reads/writes ONLY                   - createKoTranslator(...)   |
|       ko_translator_settings.json         - Thinking KO translation   |
|     - CSRF + Loopback Origin/Host         - Static English UI KO      |
|       + Content-Type + 413 cap            - Zero fetch/Protobuf/Fiber |
|                                                                       |
|  3) Isolated Drop-In Loader (host/dropin-loader.js)                   |
|     - ~/.gemini/antigravity/ui-extensions.d/ko-thought-translator.json|
|     - Live read-only ~/.gemini/config/config.json `enabled` gate      |
|     - Single `dist/main.js` exact-size anchor (0 preload/utils edits) |
+-----------------------------------------------------------------------+
```

### Strict Zero-Interference Invariants (`test/unit/architecture-boundaries.test.js`)
1. **`src/core/*`**: Pure domain logic (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`). Zero `window`, `document`, `Node`, `localStorage`, `fetch`, or vendor Antigravity imports.
2. **`src/adapters/*`**: Translator adapters (`google-translate`, `local-llm`, `custom-provider`, `endpoint-validator`) and pure DOM Antigravity adapters (`dictionaries/*`, `dom-tokenizer`, `thinking-translator`, `trigger-controller`, `ui-localizer`, `storage-port`). Zero React Fiber, Angular, `Worker`, `iframe`, `fetch`, `lsClient`, or Protobuf hooks.
3. **`src/runtime/*` & `src/index.js`**: Composition root exporting `createKoTranslator({ win, doc, settings, onStatus }) -> { start(), updateSettings(next), dispose(), getStatus() }` and clean `observer-scheduler.js`.
4. **Official Sidecar (`sidecars/ko-translator-settings/`)**: Antigravity `SIDECAR_UI_ENTRYPOINT_AUX_PANE` settings and diagnostics panel. Enforces per-instance CSRF token, loopback `Origin`/`Host`, `application/json` `Content-Type`, and strict 64 KiB body cap (`413 Payload Too Large`).
5. **Isolated Host Layer (`host/*`, `scripts/build.js`)**:
   - Single deterministic renderer bundle `dist/renderer.js` (`scripts/build.js --check`).
   - Zero `hooks.json` (no per-turn `PreInvocation`/`PostInvocation` hooks), zero background watcher daemons, zero sibling plugin file sharing, and zero writes to Antigravity host internal storage or `config.json`.
   - Drop-in loader enforces: `schemaVersion: 1`, realpath containment under `~/.gemini/config/plugins/<pluginId>/`, live `config.json` `enabled` gate, top-frame local Hub URL filter, and safe `JSON.parse`/`JSON.stringify` settings prelude.
   - Atomic `app.asar` rollback verifies `.orig` purity and `.orig.json` SHA-256 before restoring, and preserves manifest/settings if rollback fails.
