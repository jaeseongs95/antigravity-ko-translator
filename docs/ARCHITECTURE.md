# `antigravity-ko-translator` v2.1.0 — AddonManifest.v1 Desktop Architecture (`docs/ARCHITECTURE.md`)

## 1. Overview & Design Principles

`antigravity-ko-translator` `v2.1.0` is a **Desktop Native App–only** Korean translation plugin hosted by **`antigravity-native-addon-host` (`v1.0.1+`)** under the **`AddonManifest.v1`** contract. Remote Control web support is intentionally excluded from this repository (handled separately by `antigravity-remote-plugin`).

```
+-----------------------------------------------------------------------------+
| Antigravity Desktop Native App + antigravity-native-addon-host (Single Host)|
|                                                                             |
|  1) Official Sidecar (AUX_PANE)        2) Renderer (Isolated World 999)     |
|     sidecars/ko-translator-settings/      dist/renderer.js (IIFE)           |
|     - Reads/writes ONLY                   - Receives scoped `addonHost`     |
|       ko_translator_settings.json         - Uses addonHost.injectStyle(),   |
|     - CSRF + Loopback Origin/Host           getNoTranslateSelector(),       |
|       + Content-Type + 413 cap              and onDispose()                 |
|                                           - Skips [data-addon-host-owner]   |
|  3) AddonManifest.v1 Main Hook            - Thinking KO + Static UI KO      |
|     host/main-hook.js                                                       |
|     - Reads ko_translator_settings.json fail-closed                         |
|     - Pushes settings to Isolated World 999 on trusted URLs only            |
|     - Live-watches settings changes & cleans up 100% on dispose()           |
+-----------------------------------------------------------------------------+
```

### Strict Zero-Interference Invariants (`test/unit/architecture-boundaries.test.js`)
1. **Zero `app.asar` Access**: No source file imports `@electron/asar` or mutates `app.asar`. Only `antigravity-native-addon-host` owns `app.asar` install/rollback.
2. **`src/core/*`**: Pure domain logic (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`). Zero `window`, `document`, `Node`, `localStorage`, `fetch`, or vendor Antigravity imports.
3. **`src/adapters/*`**: Translator adapters and pure DOM Antigravity adapters. Zero React Fiber, Angular, `Worker`, `iframe`, `fetch`, `lsClient`, or Protobuf hooks. Always respects `[data-addon-host-owner]` and any extra selectors returned by `addonHost.getNoTranslateSelector()`.
4. **`src/runtime/*` & `src/index.js`**: Vendor-neutral runtime consuming `hostCapability` (`getNoTranslateSelector`, `injectStyle`, `removeStyle`, `onDispose`) with safe fallback when run standalone.
5. **Official Sidecar (`sidecars/ko-translator-settings/`)**: Antigravity `SIDECAR_UI_ENTRYPOINT_AUX_PANE` settings and diagnostics panel with per-instance CSRF token, loopback `Origin`/`Host`, `application/json` `Content-Type`, and strict 64 KiB body cap (`413 Payload Too Large`).
6. **Isolated Host Layer (`addon-manifest.v1.json`, `host/*`, `scripts/build.js`)**:
   - Single deterministic renderer bundle `dist/renderer.js` (`scripts/build.js --check`).
   - Zero `hooks.json` (no per-turn `PreInvocation`/`PostInvocation` hooks), zero standalone watcher daemons, zero sibling plugin file sharing, and zero writes to Antigravity host internal storage or `config.json`.
   - `host/addon-registry.js` enforces `AddonManifest.v1` contract and `<pluginsRoot>/<pluginId>` realpath containment before writing `~/.gemini/antigravity/addons.d/ko-thought-translator.json`.
