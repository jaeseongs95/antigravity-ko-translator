# `antigravity-ko-translator` v2.1.0 — AddonManifest.v2 Desktop Architecture (`docs/ARCHITECTURE.md`)

## 1. Overview & Design Principles

`antigravity-ko-translator` `v2.1.0` is a **Desktop Native App–only**, **renderer-only** Korean translation plugin hosted by **`antigravity-native-addon-host` (`>= v2.1.0`)** under the **`AddonManifest.v2`** contract. Remote Control web support is intentionally excluded from this repository (handled separately by `antigravity-remote-plugin`).

```
+-----------------------------------------------------------------------------+
| Antigravity Desktop Native App + antigravity-native-addon-host (>= v2.1.1)  |
|                                                                             |
|  1) Renderer (Isolated World 998) — dist/renderer.js (IIFE)                 |
|     - Closure-scoped `addonHost` (ZERO window.__agyKoTranslator)            |
|     - Statusbar engine button (`window.statusbarAddons.register`)           |
|       · Click: opens Shadow DOM Quick Settings Modal (`addonHost.openModal`)|
|       · Shift+click: instant Google Translate <-> Local LLM toggle          |
|     - Consumes host `settingsBridge`: `getSettings()`, `onSettingsChange()`,|
|       and trusted `saveSettings()`                                          |
|     - `localStorage` restricted strictly to translation cache ONLY          |
|     - Respects `addonHost.isElementInsideIgnored()` across Shadow DOM       |
|                                                                             |
|  2) Host Confined `settingsBridge` (owned by antigravity-native-addon-host) |
|     - Zero plugin `mainHook` code, zero Sidecar AUX_PANE                    |
|     - Atomic confined read/write/watch on `ko_translator_settings.json`     |
|     - Immediate multi-window snapshot broadcast on save                     |
+-----------------------------------------------------------------------------+
```

### Strict Zero-Interference & Security Invariants (`test/unit/architecture-boundaries.test.js`)
1. **Zero `app.asar` Access & Zero `mainHook`**: `host/main-hook.js` and `dist/main-hook.js` are deleted. Only `antigravity-native-addon-host` owns `app.asar` and read-only `settingsBridge` file watching.
2. **`src/core/*`**: Pure domain logic (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`). Zero `window`, `document`, `Node`, `localStorage`, `fetch`, or vendor Antigravity imports.
3. **`src/adapters/*`**:
   - `storage-port.js`: strictly confines `window.localStorage` to `STORAGE_KEYS.cache`; ignores all security-sensitive settings keys.
   - `custom-provider.js`: defense-in-depth rejection of secret headers (`Authorization`, `X-API-Key`, etc.) and secret query parameters.
   - `ui-localizer.js`, `trigger-controller.js`, `thinking-translator.js`: integrate `addonHost.isElementInsideIgnored()` across Shadow DOM boundaries plus `[data-addon-host-owner]`, `[data-addon-host-slot]`, `[data-addon-host-no-translate]`.
4. **`src/runtime/*` & `src/index.js`**: Vendor-neutral runtime subscribing to `addonHost.getSettings()` / `addonHost.onSettingsChange()` / `addonHost.saveSettings()` with fail-closed `missing`/`error` handling and zero mutable `window.*` exposure under `addonHost`.
5. **In-App Statusbar & Shadow DOM Quick Settings (`src/adapters/antigravity/quick-settings-ui.js`)**: Registers live statusbar button (`번역:구글` / `번역:LLM` / `번역:꺼짐`, `Shift+click` instant toggle) via `window.statusbarAddons.register`, and mounts an isolated Shadow DOM Quick Settings Modal via `addonHost.openModal('ko-translator.quick-settings-modal', { shadow: true })` (legacy Sidecar AUX_PANE removed).
6. **Isolated Host Layer (`addon-manifest.v2.json`, `host/*`, `scripts/build.js`)**:
   - Single deterministic renderer bundle `dist/renderer.js` (`scripts/build.js --check`).
   - Zero `hooks.json`, zero standalone watcher daemons, zero writes to Antigravity host internal storage or `config.json`.
   - `host/addon-registry.js` enforces `AddonManifest.v2` (`schemaVersion: 2`, `trustLevel: "trusted"`, `settingsBridge`, `shadow: false` on `document-transform`, zero `mainHook`) and `<pluginsRoot>/<pluginId>` realpath containment.
