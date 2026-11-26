# Release Notes — `v3.0.0`

## English

### `AddonManifest.v3` API-First Migration & Quick Settings Slide-Switch Redesign
- **`AddonManifest.v3` API-First Contract (`schemaVersion: 3`, `apiVersion: 3`, `minHostVersion: "3.0.0"`)**:
  - Adds [`addon-manifest.v3.json`](./addon-manifest.v3.json) declaring explicit `permissions.ui` (`statusItems`, `settingsPages`, `commands`, `overlays`, `toasts`, `canvas`), `permissions.storage`, `permissions.services.consume: ["host.statusbar"]`, `permissions.net` (`httpsHosts: ["translate.googleapis.com"]`, `localLoopback: [11434]`), `permissions.dom.documentTransform: true`, `settingsBridge`, and `compatibility.surfaces: ["desktop", "remote-web"]`.
  - Introduces `src/adapters/antigravity/host-capability-adapter.js` wrapping `AddonContextV3` (`ui.registerStatusItem`, `ui.registerSettingsPage`, `ui.registerCommand`, `ui.openModal`, `ui.injectStyle`/`removeStyle`, dual-key `net.fetch`, `dom.isElementInsideIgnored`, `settingsBridge`/`storage`, `lifecycle.onDispose`) while preserving backward compatibility with `v2` `addonHost` and standalone execution.
  - Prevents duplicate floating status bars during mixed v2/v3 transitions by checking for `host.statusbar` or absent legacy `window.statusbarAddons`, and uses `ctx.settingsBridge` when provided by the host with automatic `ctx.storage` fallback on `antigravity-addons v3.0.0`.
- **Quick Settings Popup UI/UX Redesign**:
  - Merges the previously overlapping checkboxes (`한국어 번역 사용` + `영문 고정 UI 한글화`) into **1 clear slide ON/OFF switch** (`영문 UI 한글화`), deriving runtime active state cleanly across UI localization, Thinking translation, and Thinking block visibility.
  - Converts all 4 option toggles (`영문 UI 한글화`, `Thinking(추론 과정) 한국어 번역`, `Thinking 블록 표시`, and Local LLM `원격 HTTPS 엔드포인트 허용`) to accessible native `<input type="checkbox" role="switch">` slide ON/OFF controls with `--ag-*` host theme tokens, `:focus-visible` focus rings, `prefers-reduced-motion`, `word-break: keep-all`, and a themed thin dark scrollbar.
- **Public HTTPS Modular Userscript (`ko-thought-translator.user.js` + `.meta.js`)**:
  - Rebuilt against `addon-manifest.v3.json` with `antigravity-addons v3.0.0` (`--build-addon-userscript --grant-xhr --connect translate.googleapis.com`) for 1-click Remote Web installation and automatic updates:
    `https://github.com/jaeseongs95/antigravity-ko-translator/releases/latest/download/ko-thought-translator.user.js`
- **Verification**:
  - `54/54` tests passing (including real `antigravity-addons v3.0.0` manifest validation, `@antigravity-addons/sdk` `createTestHost` Desktop & Remote Web parity, real Headless Chromium Blink CSS + Shadow DOM E2E, and 2-OS GitHub Actions CI).

---

## 한국어

### `AddonManifest.v3` API-First 공식 전환 및 빠른 설정 팝업 슬라이드 UI/UX 개선
- **`AddonManifest.v3` API-First 규격 전환 (`schemaVersion: 3`, `apiVersion: 3`, `minHostVersion: "3.0.0"`)**:
  - [`addon-manifest.v3.json`](./addon-manifest.v3.json)을 추가해 `permissions.ui`(`statusItems`, `settingsPages`, `commands`, `overlays`, `toasts`, `canvas`), `permissions.storage`, `permissions.services.consume: ["host.statusbar"]`, `permissions.net`(`httpsHosts: ["translate.googleapis.com"]`, `localLoopback: [11434]`), `permissions.dom.documentTransform: true`, `settingsBridge`, `compatibility.surfaces: ["desktop", "remote-web"]`를 선언했습니다.
  - `src/adapters/antigravity/host-capability-adapter.js`를 도입해 `AddonContextV3`(`ui.registerStatusItem`, `ui.registerSettingsPage`, `ui.registerCommand`, `ui.openModal`, 듀얼 키 `net.fetch`, `dom.isElementInsideIgnored`, `settingsBridge`/`storage`, `lifecycle.onDispose`)를 주 경로로 사용하면서 기존 v2 `addonHost` 및 단독 실행 호환성도 유지했습니다.
  - v2/v3 혼재 전환기에서 중복 플로팅 상태바가 생기지 않도록 가드하고, 호스트가 `ctx.settingsBridge`를 제공하면 우선 사용하며 `antigravity-addons v3.0.0`에서는 `ctx.storage`로 자동 폴백해 데스크톱·원격 웹 양쪽에서 설정 저장이 정상 동작합니다.
- **빠른 설정 팝업 UI/UX 개선**:
  - 의미가 중복되던 기존 1번(`한국어 번역 사용`)과 4번(`영문 고정 UI 한글화`) 체크박스를 **단일 `영문 UI 한글화` 슬라이드 ON/OFF 스위치**로 통합했습니다.
  - 4개 옵션 토글(`영문 UI 한글화`, `Thinking(추론 과정) 한국어 번역`, `Thinking 블록 표시`, 로컬 LLM `원격 HTTPS 엔드포인트 허용`)을 모두 접근성(`role="switch"`, `:focus-visible`, `prefers-reduced-motion`)과 호스트 테마 토큰(`--ag-*`), `word-break: keep-all`, 다크 얇은 스크롤바가 적용된 **슬라이드 ON/OFF 스위치**로 통일했습니다.
- **공개 HTTPS 모듈형 Userscript (`ko-thought-translator.user.js` + `.meta.js`)**:
  - `antigravity-addons v3.0.0`의 `--build-addon-userscript --grant-xhr --connect translate.googleapis.com`으로 `addon-manifest.v3.json` 기준 1클릭 원격 웹 Userscript를 함께 배포합니다:
    `https://github.com/jaeseongs95/antigravity-ko-translator/releases/latest/download/ko-thought-translator.user.js`
- **검증 근거**:
  - `54/54` 단위·통합·실제 Headless Chromium E2E·실제 `antigravity-addons v3.0.0` 검증기 및 `@antigravity-addons/sdk` Desktop/Remote Web 패리티·2-OS GitHub Actions CI 전부 통과.
