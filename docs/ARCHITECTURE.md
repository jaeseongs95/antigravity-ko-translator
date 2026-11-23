# `antigravity-ko-translator` v2.1.0 — AddonManifest.v2 Desktop Architecture (`docs/ARCHITECTURE.md`)

## 1. Overview & Design Principles

`antigravity-ko-translator` `v2.1.0` is a **Desktop Native App–only**, **renderer-only** Korean translation plugin hosted by **`antigravity-native-addon-host` (`>= v2.1.0`)** under the **`AddonManifest.v2`** contract. Remote Control web support is intentionally excluded from this repository (handled separately by `antigravity-remote-plugin`).

```
+-----------------------------------------------------------------------------+
| Antigravity Desktop Native App + antigravity-native-addon-host (>= v2.1.0)  |
|                                                                             |
|  1) Official Sidecar (AUX_PANE)        2) Renderer (Isolated World 998)     |
|     sidecars/ko-translator-settings/      dist/renderer.js (IIFE)           |
|     - Sole authenticated writer of        - Closure-scoped `addonHost`      |
|       ko_translator_settings.json         - ZERO window.__agyKoTranslator   |
|     - CSRF + same-host Origin/Host        - Consumes host settingsBridge    |
|       + Content-Type + 413 cap              getSettings()/onSettingsChange()|
|                                           - localStorage restricted to      |
|  3) Host Read-Only settingsBridge           translation cache ONLY          |
|     (owned by antigravity-native-         - Respects addonHost.             |
|      addon-host v2.1.0 Main process)        isElementInsideIgnored()        |
|     - Zero plugin mainHook code           - Thinking KO + Static UI KO      |
+-----------------------------------------------------------------------------+
```

### Strict Zero-Interference & Security Invariants (`test/unit/architecture-boundaries.test.js`)
1. **Zero `app.asar` Access & Zero `mainHook`**: `host/main-hook.js` and `dist/main-hook.js` are deleted. Only `antigravity-native-addon-host` owns `app.asar` and read-only `settingsBridge` file watching.
2. **`src/core/*`**: Pure domain logic (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`). Zero `window`, `document`, `Node`, `localStorage`, `fetch`, or vendor Antigravity imports.
3. **`src/adapters/*`**:
   - `storage-port.js`: strictly confines `window.localStorage` to `STORAGE_KEYS.cache`; ignores all security-sensitive settings keys.
   - `custom-provider.js`: defense-in-depth rejection of secret headers (`Authorization`, `X-API-Key`, etc.) and secret query parameters.
   - `ui-localizer.js`, `trigger-controller.js`, `thinking-translator.js`: integrate `addonHost.isElementInsideIgnored()` across Shadow DOM boundaries plus `[data-addon-host-owner]`, `[data-addon-host-slot]`, `[data-addon-host-no-translate]`.
4. **`src/runtime/*` & `src/index.js`**: Vendor-neutral runtime subscribing to `addonHost.getSettings()` / `addonHost.onSettingsChange()` with fail-closed `missing`/`error` handling and zero mutable `window.*` exposure under `addonHost`.
5. **Official Sidecar (`sidecars/ko-translator-settings/`)**: Antigravity `SIDECAR_UI_ENTRYPOINT_AUX_PANE` settings and diagnostics panel with per-instance CSRF token, same-host `isOriginMatchingHost` Origin/Host check, `application/json` `Content-Type`, and strict 64 KiB body cap (`413 Payload Too Large`).
6. **Isolated Host Layer (`addon-manifest.v2.json`, `host/*`, `scripts/build.js`)**:
   - Single deterministic renderer bundle `dist/renderer.js` (`scripts/build.js --check`).
   - Zero `hooks.json`, zero standalone watcher daemons, zero writes to Antigravity host internal storage or `config.json`.
   - `host/addon-registry.js` enforces `AddonManifest.v2` (`schemaVersion: 2`, `trustLevel: "trusted"`, `settingsBridge`, `shadow: false` on `document-transform`, zero `mainHook`) and `<pluginsRoot>/<pluginId>` realpath containment.
