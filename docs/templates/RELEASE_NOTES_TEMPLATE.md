# Release `v2.0.0` — Clean-Slate Desktop Native Architecture

## Highlights
- **Desktop Native App Only**: Removed all legacy remote control web hacks, shared sibling scripts, host internal storage writes, background watcher daemons, and per-turn hooks.
- **Pure Read-Only DOM Overlay (`dist/renderer.js`)**: Exposes `createKoTranslator({ win, doc, settings, onStatus }) -> { start(), updateSettings(), registerCustomProvider(), unregisterCustomProvider(), dispose(), getStatus() }`.
- **Official Sidecar (`AUX_PANE`)**: Dedicated settings & diagnostics panel with loopback Host/Origin, CSRF, Content-Type, and streaming 413 protections.
- **Isolated Drop-In Loader**: `schemaVersion: 1` manifest, realpath containment, fail-closed `config.json` gate, exact-size `dist/main.js` anchor, and full-archive integrity verification on install/rollback.
