# Antigravity 2.0 한국어 번역기 (`v2.1.0` · 데스크톱 전용)

[English README](./README.md)

공용 네이티브 애드온 호스트([antigravity-native-addon-host](https://github.com/jaeseongs95/antigravity-native-addon-host), `AddonManifest.v1`) 위에서 동작하는 Antigravity 2.0 **데스크톱 네이티브 앱 전용** 한국어 번역 플러그인입니다.
- **실시간 Thinking(추론 과정) 한국어 번역**: 백틱 코드·식별자·파일 경로를 원형 보존하고 한국어 조사를 자연스럽게 보정합니다.
- **영문 고정 UI 한글화**: 코드 뷰어·diff·터미널·입력창·에이전트 본문 응답뿐 아니라 타 플러그인 UI 슬롯(`[data-addon-host-owner]`, `addonHost.getNoTranslateSelector()`)을 영구 제외하고 메뉴·버튼·설정 안내만 한글화합니다.
- **공식 Sidecar(`AUX_PANE`) 설정·진단 패널**: `sidecars/ko-translator-settings/`에서 설정을 저장하면 `host/main-hook.js`가 실행 중인 창에 실시간 동기화합니다.
- **완전 격리·무간섭 설계 (`AddonManifest.v1`)**:
  - **`app.asar` 직접 패치 0%**: `app.asar` 패치·원복은 공용 호스트(`antigravity-native-addon-host`)에 전임합니다.
  - `fetch` / `lsClient` / Protobuf / `React Fiber` / `Angular` / `Worker` / `iframe` 후킹 **0%**.
  - 선언적 `addon-manifest.v1.json`(`slot: "document-transform"`, `scope: "native-host-only"`, `respectsNoTranslate: true`, `loadOrder: 200`)을 `~/.gemini/antigravity/addons.d/ko-thought-translator.json`에 등록합니다.
  - 호스트 capability 핸들(`addonHost.getNoTranslateSelector()`, `injectStyle()`, `removeStyle()`, `onDispose()`)을 통해 타 플러그인과 비침범 공존합니다.
  - 원격 제어 웹(`antigravity.google.com/r/...`) 지원은 별도 프로젝트(`antigravity-remote-plugin`)로 완전 분리했습니다.

## 아키텍처

- `addon-manifest.v1.json` — `AddonManifest.v1` 선언 정본
- `src/core/` — 벤더·DOM 비종속 핵심 도메인 (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`)
- `src/adapters/translators/` — 번역기 어댑터 (`google-translate`, `local-llm`, `custom-provider`, `endpoint-validator`)
- `src/adapters/antigravity/` — 순수 읽기 전용 DOM 어댑터 (`dictionaries/`, `dom-tokenizer`, `thinking-translator`, `trigger-controller`, `ui-localizer`, `storage-port`)
- `src/runtime/` — `createTranslatorRuntime` 및 `observer-scheduler` (호스트 capability 핸들 연동)
- `sidecars/ko-translator-settings/` — Antigravity 공식 Sidecar(`AUX_PANE`) 설정·진단 패널
- `host/` — `addon-registry.js`, `main-hook.js`(격리 월드 999 설정 실시간 동기화), `config-store.js`, CLI (`--status`/`--install`/`--uninstall`)
- `dist/renderer.js` — 결정적 단일 렌더러 번들 (`scripts/build.js`)

## 명령어

```bash
npm run build            # dist/renderer.js 단일 번들 빌드
npm test                 # 번들 무결성 확인 및 전체 단위·통합 시험 실행
npm run status           # AddonManifest.v1·설정 상태 읽기 전용 조회
npm run install:addon    # addons.d/ko-thought-translator.json 매니페스트 등록
npm run uninstall:addon  # 매니페스트 및 전용 설정 파일 제거
```
