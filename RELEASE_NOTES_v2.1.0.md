# Release Notes — `antigravity-ko-translator` v2.1.0

> **Language**: English | 한국어 (아래 포함)

## English

### Highlights

`antigravity-ko-translator` `v2.1.0` completes the migration to **`antigravity-native-addon-host` `v2.1.0` (`AddonManifest.v2`)**, eliminating all Main-process `mainHook` code and closing `localStorage`-based privacy and World `998` tampering risks.

- **Renderer-Only `AddonManifest.v2` (`addon-manifest.v2.json`)**:
  - Deleted `addon-manifest.v1.json`, `host/main-hook.js`, and `dist/main-hook.js`.
  - Declares `schemaVersion: 2`, `trustLevel: "trusted"`, `minHostVersion: "2.1.0"`, `capabilities: ["renderer"]`, `uiSlots` (`document-transform`, `shadow: false`, `scope: "native-host-only"`), and `settingsBridge: { fileName: "ko_translator_settings.json", maxBytes: 65536 }`.
- **Host `settingsBridge` Consumption & Fail-Closed Persistence**:
  - Consumes deep-frozen settings snapshots from `addonHost.getSettings()` and live pushes from `addonHost.onSettingsChange(cb)` (auto-disposed via `addonHost.onDispose()`).
  - Fails closed (`enabled: false`, `provider: null`, zero external requests) when the host settings snapshot is `missing` or `error`.
  - Survives Antigravity dynamic loopback LS port rotations without reverting to Google Translate.
- **Security Hardening**:
  - Confined `window.localStorage` strictly to `STORAGE_KEYS.cache` (zero `localStorage` authority over `enabled`, `provider`, `llmConfig`, `customProviders`).
  - Stopped exposing mutable `window.__agyKoTranslator` / `window.__agyCreateKoTranslator` globals on shared World `998` `window` when running under `addonHost`.
  - Replaced removed `getNoTranslateSelector()` with `addonHost.isElementInsideIgnored()` across `ui-localizer.js`, `trigger-controller.js`, `thinking-translator.js`, and `observer-scheduler.js`, plus `[data-addon-host-slot]` and `[data-addon-host-no-translate]` fallbacks.
  - Added defense-in-depth secret header (`Authorization`, `X-API-Key`, etc.) and secret query parameter blocking in `src/adapters/translators/custom-provider.js`.
  - Tightened `sidecars/ko-translator-settings/main.mjs` `validateLoopbackRequest` to enforce `isOriginMatchingHost(origin, host)` (blocking cross-port loopback origins).

---

## 한국어

### 주요 변경 사항

`antigravity-ko-translator` `v2.1.0`은 **`antigravity-native-addon-host` `v2.1.0` (`AddonManifest.v2`)** 호환 마이그레이션을 완료하며, 메인 프로세스 `mainHook` 코드를 완전히 제거하고 `localStorage` 기반 프라이버시 및 World `998` 변조 위협을 차단합니다.

- **렌더러 전용 `AddonManifest.v2` 전환 (`addon-manifest.v2.json`)**:
  - `addon-manifest.v1.json`, `host/main-hook.js`, `dist/main-hook.js` 완전 삭제.
  - `schemaVersion: 2`, `trustLevel: "trusted"`, `minHostVersion: "2.1.0"`, `capabilities: ["renderer"]`, `uiSlots` (`document-transform`, `shadow: false`, `scope: "native-host-only"`), `settingsBridge: { fileName: "ko_translator_settings.json", maxBytes: 65536 }` 선언.
- **호스트 `settingsBridge` 연동 및 Fail-Closed 영속성**:
  - `addonHost.getSettings()` 및 `addonHost.onSettingsChange(cb)`로 호스트 정본 설정을 수신하며, Sidecar 저장 시 실행 중인 창에 즉시 반영됩니다.
  - 호스트 설정 스냅샷이 `missing` 또는 `error`이면 `enabled: false, provider: null`로 안전 차단하여 외부 Google 번역 요청을 0건으로 유지합니다.
  - Antigravity 동적 loopback LS 포트 회전 시에도 `localStorage` 초기화와 무관하게 설정이 영구 유지됩니다.
- **보안 하드닝**:
  - `window.localStorage`를 번역 캐시(`STORAGE_KEYS.cache`) 전용으로 제한하고 모든 보안 설정 키의 권한을 제거했습니다.
  - `addonHost` 환경에서 공유 World `998`의 `window.__agyKoTranslator` / `window.__agyCreateKoTranslator` 전역을 노출하지 않습니다.
  - 제거된 `getNoTranslateSelector()` 대신 `addonHost.isElementInsideIgnored()`를 4개 DOM 경로(`ui-localizer`, `trigger-controller`, `thinking-translator`, `observer-scheduler`)에 연동했습니다.
  - `custom-provider.js`에 시크릿 헤더·쿼리 파라미터 심층 차단을 추가하고, Sidecar `main.mjs`의 `validateLoopbackRequest`에 `isOriginMatchingHost(origin, host)`를 적용했습니다.
