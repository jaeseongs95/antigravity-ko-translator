# `antigravity-ko-translator` v2.0.0 — Hexagonal Architecture (`docs/ARCHITECTURE.md`)

## 1. Overview & Strict Acyclic Dependency DAG

`antigravity-ko-translator` `v2.0.0` uses a strict CommonJS **Ports & Adapters (Hexagonal)** architecture compiled deterministically into a single IIFE bundle (`scripts/build.js`) for renderer/bookmarklet execution and backed by standalone Node.js host services (`host/*`).

```
                      +-----------------------------------+
                      |   src/runtime/bootstrap.js        |
                      |   src/runtime/observer-scheduler  |
                      |   (Composition Root / Frame Mount)|
                      +----+------------+------------+----+
                           |            |            |
         +-----------------+            |            +-----------------+
         v                              v                              v
+-------------------------+   +-----------------------+   +-------------------------+
| src/adapters/*          |   | src/core/*            |   | src/remote/*            |
| - host-adapter-config   |   | - disposable-registry |   | - remote-host-port      |
| - statusbar-port        |-->| - dictionary-port     |<--| - csp-security-policy   |
| - translators/*         |   | - text-tokenizer      |   | - asset-url-rewriter    |
| - antigravity/*         |   | - provider-registry   |   | - js-module-compiler    |
|   (RemoteHostPort impl) |   | - translation-service |   | - worker-bridge         |
+-------------------------+   +-----------------------+   | - dom-guard-installer   |
                                                          | - workbench-promoter    |
                                                          +-------------------------+
```

### Enforced Boundary Rules (`test/unit/architecture-boundaries.test.js`)
1. **`src/core/*`**: Pure domain logic. Imports **only** sibling `src/core/*` modules. Zero `window`, `document`, `Node`, `localStorage`, `fetch`, or vendor/provider/HTTP literals.
2. **`src/remote/*`**: Vendor-free same-origin promotion & Worker/ESM sandbox. Imports **only** `src/core/disposable-registry.js` and sibling `src/remote/*` modules. Zero imports from `src/adapters/*`, and zero vendor, companion, or host boot-script literals (`main.js`, `prism_bundle.js`, `gstatic`, `usercontent`, `antigravity`, `ga-remote-control`, etc.). All host specifics enter through `HostAdapterConfig` and `RemoteHostPort`.
3. **`src/adapters/host-adapter-config.js`**: 100% vendor-neutral `HostAdapterConfig` validator enforcing:
   - **Apex-Pinned Suffix Invariant**: Every suffix `s` in `trustedHostOriginSuffixes` must match an explicit `https://${s.slice(1)}` entry in `trustedHostOrigins` (structurally rejecting multi-tenant parent wildcards such as `.usercontent.goog`).
   - **Disjoint Sandbox-vs-Script Invariant**: `sandboxIframeHosts` (exact hostnames only) must be disjoint from `trustedHostOrigins`, `trustedHostOriginSuffixes`, and `cdnMirrorHosts`.
4. **`src/adapters/*`**: Owns translator providers (`google-translate`, `local-llm`, `custom-provider`), SSRF endpoint validation (`endpoint-validator.js`), and all Antigravity DOM/Angular/React/Storage/Dictionary adapters (`src/adapters/antigravity/*`). Imports `src/core/*` and the pure `src/remote/remote-host-port.js` shape validator (`0` concrete `src/remote/*` imports).
5. **`src/runtime/*` & `src/index.js`**: Composition root (`mount(targetWin, targetDoc)`) explicitly passing `(targetWin, targetDoc)` into every adapter so parent and promoted child frames remain isolated even under a single cached CommonJS module graph.
6. **`host/*` & `scripts/ensure_ko_thought_patch.js`**: Host SSOT store (`ko_translator_settings.json`, `0o600`), shared lock-serialized `statusbar_autoinject.js` & `app_storage.json` sync, cryptographic-token loopback IPC process sentinels (`0` OS signals to unowned PIDs), non-thrashing `--watch-storage` daemon, `LOCK_PATH`-serialized `--rollback` (`R1`–`R5`) and `--uninstall` (`U1`–`U4`), and standalone `ensure_statusbar_patch.js` (`PATCH_MARKER = 'AGY_STATUSBAR_AUTOINJECT_V6'`, `PATCHER_CAPABILITY_REVISION = 'AGY_STATUSBAR_PATCHER_V6_R1'`).

---

## 2. Key Security & Correctness Invariants

- **Dual-Boundary CSP & `TrustedScriptURL` Isolation**: `CspSecurityPort.isTrustedIframePreflightUrl(parsed)` permits `sandboxIframeHosts` (`['antigravity.static.usercontent.goog']`) **only** for initial `iframe.src` preflight and CDN URL rewriting; `isTrustedScriptUrl(rawUrl)` / `createAuthorizedScriptUrl(rawUrl)` strictly rejects `sandboxIframeHosts` and all `*.usercontent.goog` domains.
- **Origin-Local Secret Isolation**: `CustomProviderSpec.headers` (API keys / `Authorization`) are stored **exclusively** in renderer-local `window.localStorage['agy-ko-custom-providers-v2']` and are never written to `window.nativeStorage`, `app_storage.json`, `ko_translator_settings.json`, `statusbar_autoinject.js`, `dist/*.js`, `--status`, or logs.
- **Two-Layer Code / Diff / Token / Monospace Exclusion (`D-0042`)**: `ui-localizer.js` combines a 100% standard CSS `BASE_EXCLUDED_SELECTOR` (`0` invalid attribute-name wildcards), a JS `hasExcludedCodeDataAttrPrefix(el)` walk (`/^data-(?:line-|quotable|diff-|code-|token-|syntax-|file-path|file-uri|symbol-|lsp-)/i`), and a `.font-mono` inheritance guard so code tokens like `import org.pgledger.application.history.Change;` are never translated into `...변경;`.
- **True ECMA-262 Live ESM Semantics**: `js-module-compiler.js` executes 3 phases (`instantiate` -> DFS post-order `link` -> DFS post-order `evaluate`) with live namespace/re-export getters, uninitialized `let x;` -> `x = undefined;`, mutable local bindings + live `default` getters on named `export default function`/`class`, and RHS-first TDZ/const evaluation.
- **Atomic Host Lifecycle (`--worker`, `--watch-storage`, `--uninstall`, `--rollback`)**:
  - `app.asar` writes use `.tmp` + `fsyncSync` + SHA-256 readback + `fs.renameSync` only (`0` `fs.copyFileSync` fallback).
  - `probeAsarReplaceableFast` checks `fs.openSync(asarPath, 'r+')` in `< 0.1ms` before reading or staging when Electron holds `app.asar` open on Windows.
  - `--rollback` holds `LOCK_PATH` (`statusbar_patch.lock`) across `R1`–`R5` (preflight -> stop watcher -> atomic `.orig` restore -> `runUninstall`) while `--watch-storage` uses a non-blocking 1-shot `LOCK_PATH` attempt, preventing any watcher re-patch race or IPC delay.
