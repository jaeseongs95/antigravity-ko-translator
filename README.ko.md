# Antigravity 2.0 한국어 번역기 (`v3.0.0` · Desktop & Remote Web)

[English README](./README.md) | [릴리스 노트 (`v2.4.0` 영문/국문)](./RELEASE_NOTES_v2.4.0.md)

공용 네이티브 애드온 호스트([antigravity-addons](https://github.com/jaeseongs95/antigravity-addons) `>= v3.0.0`, `AddonManifest.v3` API-First) 위에서 **Antigravity 2.0 데스크톱 네이티브 앱 및 원격 웹(`antigravity.google.com/r/...`)** 양쪽을 지원하는 렌더러 전용 한국어 번역 플러그인입니다.

### 원격 웹 1클릭 공개 HTTPS Userscript 설치 (사설 IP·개인 PC 불필요)
1. 브라우저(PC Chrome/Edge/Firefox 또는 모바일 Safari Userscripts / Firefox / Edge Canary)에 **Tampermonkey**, **Violentmonkey**, 또는 **Userscripts(iOS Safari)** 를 설치합니다.
2. 아래 공개 HTTPS 링크를 클릭해 1클릭 설치합니다(공용 호스트 라이브러리 `@require` 및 자동 업데이트 포함):
   - 👉 **[ko-thought-translator.user.js 설치하기](https://github.com/jaeseongs95/antigravity-ko-translator/releases/latest/download/ko-thought-translator.user.js)**
3. `https://antigravity.google.com`을 열면 우하단 통합 Addons 드로어에 자동 합류하며, `antigravity-statusbar.user.js` 등 다른 공개 HTTPS 애드온 Userscript와 단일 드로어에서 충돌 없이 공존합니다.

### v3.0.0 주요 업데이트
- **`AddonManifest.v3` API-First 공식 전환 (`schemaVersion: 3`, `apiVersion: 3`, `minHostVersion: "3.0.0"`)**:
  - [`addon-manifest.v3.json`](./addon-manifest.v3.json) 정본을 추가하고 `permissions.ui`(`statusItems`, `settingsPages`, `commands`, `overlays`, `toasts`, `canvas`), `permissions.storage`, `permissions.services.consume: ["host.statusbar"]`, `permissions.net`(`httpsHosts: ["translate.googleapis.com"]`, `localLoopback: [11434]`), `permissions.dom.documentTransform: true`, `compatibility.surfaces: ["desktop", "remote-web"]`를 선언했습니다.
  - `src/adapters/antigravity/host-capability-adapter.js`를 추가해 `AddonContextV3`(`ui.registerStatusItem`, `ui.registerSettingsPage`, `ui.registerCommand`, `ui.openModal`, `net.fetch` 듀얼 키 라우팅, `dom.isElementInsideIgnored`, `settingsBridge`/`storage`, `lifecycle.onDispose`)를 주 경로로 사용하면서 기존 v2 `addonHost` 및 단독 실행 호환성도 보존했습니다.
- **빠른 설정 팝업 UI/UX 개선**:
  - 의미가 겹치던 기존 1번(`한국어 번역 사용`)과 4번(`영문 고정 UI 한글화`) 체크박스를 **단일 `영문 UI 한글화` 슬라이드 ON/OFF 스위치**로 통합했습니다.
  - 모든 토글 옵션(`영문 UI 한글화`, `Thinking(추론 과정) 한국어 번역`, `Thinking 블록 표시`, 로컬 LLM `원격 HTTPS 엔드포인트 허용`)을 접근성(`role="switch"`, 포커스 링, `prefers-reduced-motion`)과 호스트 테마 토큰(`--ag-*`)을 지원하는 **슬라이드 ON/OFF 스위치**로 통일했습니다.
- **`@antigravity-addons/sdk` Desktop/Remote Web 패리티 및 Chromium 시각 검증**:
  - 실제 `antigravity-addons v3.0.0` 매니페스트 검증기와 `@antigravity-addons/sdk` `createTestHost`(`desktop` / `remote-web`) 및 실제 Headless Chromium Blink CSS·Shadow DOM 모달 E2E 시험을 모두 통과했습니다.

### v2.4.0 주요 업데이트
- **공개 HTTPS 모듈형 Userscript 공식 배포 (`ko-thought-translator.user.js` + `.meta.js`)**:
  - `antigravity-addons v2.8.0`의 `--build-addon-userscript`로 생성되며 `@require https://github.com/jaeseongs95/antigravity-addons/releases/latest/download/antigravity-remote-host.lib.js`, `@inject-into content`, `@grant GM_getValue`/`GM_setValue`/`GM_deleteValue`/`GM_xmlhttpRequest`, `@connect translate.googleapis.com` 및 GitHub Releases 자동 업데이트(`@updateURL`/`@downloadURL`)를 포함합니다.
- **Userscript CSP/CORS 내성 HTTPS 전송 어댑터 (`src/adapters/translators/gm-fetch.js`)**:
  - `antigravity.google.com`의 엄격한 페이지 CSP `connect-src` / CORS 환경에서도 `translate.googleapis.com` 번역 요청이 안정적으로 동작하도록 Userscript 샌드박스에서 `GM_xmlhttpRequest`(`GM.xmlHttpRequest`)를 자동 사용하며, `AbortSignal`과 `anonymous: true`를 준수하고 데스크톱·로컬 루프백 HTTP에서는 기존 `fetch`를 그대로 사용합니다.
- **버전 메타데이터 일괄 동기화 (`v2.4.0`)**:
  - `package.json`, `plugin.json`, `addon-manifest.v2.json`, `src/index.js`, `src/runtime/bootstrap.js`, `scripts/build.js`, `host/cli.js`를 `2.4.0`으로 통일했습니다.

### v2.3.0 주요 업데이트
- **`antigravity-native-addon-host v2.3.0` 다중 프로필 공식 대응 (`antigravity-desktop` + `antigravity-remote-web`)**:
  - `addon-manifest.v2.json`에 `compatibility.hostProfiles: ["antigravity-desktop", "antigravity-remote-web"]` 및 `minHostVersion: "2.3.0"`을 선언하고, `host/addon-registry.js`에서 `hostProfiles`·`excludeHostProfiles` 검증을 벤더 중립(DIP) 경계를 유지한 채 지원합니다.
- **원격 웹 첫 기동 정상화 (데스크톱 Fail-Closed 불변조건 100% 보존)**:
  - 원격 웹(`antigravity-remote-web`)에서 사전 시드된 설정 스냅샷 없이 최초 진입해 `addonHost.getSettings()`가 `null`을 반환할 때 안전 기본값(`enabled: true`, `provider: 'google-translate'`)으로 즉시 기동합니다.
  - 손상된 스냅샷(`status: 'error'`, JSON 오류, 잘못된 프로바이더)은 **모든 프로필**에서 계속 Fail-Closed로 차단하며, 데스크톱(`antigravity-desktop`)의 설정 누락·`null` 역시 기존과 동일하게 Fail-Closed(`ERR_SETTINGS_FILE_MISSING`)를 유지합니다.
- **원격 웹 호스트 드로어 설정 탭·액션 등록 및 `[data-addon-host-ignore]` 방어 제외**:
  - `quick-settings-ui`가 상태바 버튼 외에 `addonHost.registerSettingsTab('ko-translator.quick-settings', ...)`과 호스트 액션(`open-quick-settings`, `toggle-engine`)을 함께 등록·해제하여, 상태바 플러그인이 없는 원격 웹 환경에서도 빠른 설정 모달과 엔진 전환에 접근할 수 있습니다.
  - 원격 웹 호스트 제어 드로어 및 폴백 슬롯 독이 부여하는 `[data-addon-host-ignore]` 속성을 `ui-localizer`, `thinking-translator`, `trigger-controller`, `host-adapter`의 다층 제외 선택자에 추가했습니다.
- **버전 메타데이터 일괄 동기화**:
  - 런타임(`src/index.js`, `src/runtime/bootstrap.js`), 번들 배너(`scripts/build.js`), CLI 상태 보고(`host/cli.js`), `package.json`, `plugin.json`, `addon-manifest.v2.json`의 버전을 `2.3.0`으로 통일했습니다.

### 주요 기능
- **실시간 Thinking(추론 과정) 한국어 번역**: 백틱 코드·식별자·파일 경로를 원형 보존하고 한국어 조사를 자연스럽게 보정합니다.
- **영문 고정 UI 한글화**: 코드 뷰어·diff·터미널·입력창·에이전트 본문 응답뿐 아니라 호스트·타 플러그인 UI 슬롯(`[data-addon-host-ignore]`, `[data-addon-host-owner]`, `[data-addon-host-slot]`, `[data-addon-host-no-translate]`, `addonHost.isElementInsideIgnored()`)을 Shadow DOM 경계까지 영구 제외하고 메뉴·버튼·설정 안내만 한글화합니다.
- **상태바 버튼 + 호스트 설정 탭/액션 + Shadow DOM 빠른 설정 모달 + 호스트 `settingsBridge`**: 데스크톱에서는 `~/.gemini/antigravity/ko_translator_settings.json`에 영구 저장·전 창 브로드캐스트하고, 원격 웹에서는 `remote-host-bridge`를 통해 설정을 영구 저장·반영합니다.
- **완전 격리·무간섭·Fail-Closed 설계 (`AddonManifest.v2`)**:
  - **`app.asar` 직접 패치 0% & `mainHook` 완전 제거**: `app.asar` 패치·원복은 공용 호스트(`antigravity-native-addon-host`)에 전임합니다.
  - **HTML Sink 0건 & `eval` 0건**: `antigravity-native-addon-host` v2.3.0의 Chrome MV3 / Trusted Types Acorn AST 보안 검증을 0건 위반으로 통과합니다.
  - **`localStorage` 캐시 전용 제한 & World `998` 전역 비노출**: 보안 설정은 `localStorage`에서 읽지 않고 `addonHost` 환경에서 `window.__agyKoTranslator`를 노출하지 않습니다.

## 아키텍처

- `addon-manifest.v3.json` — `AddonManifest.v3` API-First 다중 표면 선언 정본 (`desktop` + `remote-web`, `minHostVersion: "3.0.0"`)
- `src/core/` — 벤더·DOM 비종속 핵심 도메인 (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`)
- `src/adapters/translators/` — 번역기 어댑터 (`google-translate`, `local-llm`, `custom-provider`, `endpoint-validator`, `gm-fetch`)
- `src/adapters/antigravity/` — 순수 읽기 전용 DOM 어댑터 (`dictionaries/`, `dom-tokenizer`, `thinking-translator`, `trigger-controller`, `ui-localizer`, `host-capability-adapter`, 슬라이드 스위치 `quick-settings-ui`, 캐시 전용 `storage-port`)
- `src/runtime/` — 벤더 중립 `createTranslatorRuntime` 및 `observer-scheduler`
- `host/` — `AddonManifest.v3/v2` 검증 `addon-registry.js`, `config-store.js`, `paths.js`, `profiles/antigravity.js`, CLI (`--status`/`--install`/`--uninstall`/`--rollback`)
- `dist/renderer.js` — 결정적 단일 렌더러 번들 (`scripts/build.js`)

## 설치 및 명령어

심볼릭 링크 없이 실제 파일을 `~/.gemini/config/plugins/ko-thought-translator/`에 복사한 뒤, 호스트 `v3.0.0+`에서 v3 매니페스트 등록과 신뢰 승인을 진행합니다.

```bash
npm run build            # dist/renderer.js 단일 번들 빌드
npm test                 # 번들 무결성 확인 및 전체 단위·SDK v3 패리티·Chromium E2E 시험 실행
npm run status           # AddonManifest.v3·설정 상태 읽기 전용 조회
npm run install:addon    # addons.d/ko-thought-translator.json 등록 및 누락 설정 초기화
npm run uninstall:addon  # 매니페스트 및 전용 설정 파일 제거

# antigravity-addons (>= v3.0.0)에서 실행:
addon-host --register ~/.gemini/config/plugins/ko-thought-translator/addon-manifest.v3.json
addon-host trust approve ko-thought-translator
addon-host --doctor
addon-host --profile remote-web --doctor
```
