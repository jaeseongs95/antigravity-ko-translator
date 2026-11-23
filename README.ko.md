# Antigravity 2.0 한국어 번역기 (`v2.2.0` · 데스크톱 전용)

[English README](./README.md) | [릴리스 노트 (`v2.2.0` 영문/국문)](./RELEASE_NOTES_v2.2.0.md)

공용 네이티브 애드온 호스트([antigravity-native-addon-host](https://github.com/jaeseongs95/antigravity-native-addon-host) `>= v2.2.0` 권장 / `>= v2.1.0` 최소, `AddonManifest.v2`) 위에서 동작하는 Antigravity 2.0 **데스크톱 네이티브 앱 전용** 렌더러 전용 한국어 번역 플러그인입니다.

### v2.2.0 주요 업데이트
- **상태바 번역 엔진 버튼 및 중앙 정렬 인앱 Shadow DOM 빠른 설정 모달**: 하단 상태바에 실시간 엔진 상태(`번역:구글` / `번역:LLM` / `번역:꺼짐`)와 `Shift+클릭` 구글↔로컬 LLM 즉시 전환을 제공하고, 클릭 시 화면 정중앙 Shadow DOM 모달(`addonHost.openModal`, `exclusive: false`, Tailwind Preflight 환경에서도 중앙 정렬 유지)에서 엔진·로컬 LLM 설정 및 연결 테스트·지금 다시 번역·캐시 초기화·손상 설정 복구를 처리합니다. 변경 내용은 신뢰 호스트 `settingsBridge.saveSettings()`를 통해 모든 창에 영구 저장·즉시 반영됩니다.
- **기존 Sidecar `AUX_PANE` 완전 제거**: `sidecars/ko-translator-settings/`와 `plugin.json`의 `"sidecars"` 항목을 완전히 제거해 불필요한 사이드카 창이 뜨지 않습니다.

### 주요 기능

- **실시간 Thinking(추론 과정) 한국어 번역**: 백틱 코드·식별자·파일 경로를 원형 보존하고 한국어 조사를 자연스럽게 보정합니다.
- **영문 고정 UI 한글화**: 코드 뷰어·diff·터미널·입력창·에이전트 본문 응답뿐 아니라 타 플러그인 UI 슬롯(`[data-addon-host-owner]`, `[data-addon-host-slot]`, `[data-addon-host-no-translate]`, `addonHost.isElementInsideIgnored()`)을 Shadow DOM 경계까지 영구 제외하고 메뉴·버튼·설정 안내만 한글화합니다.
- **인앱 상태바 버튼 + Shadow DOM 빠른 설정 모달 + 호스트 `settingsBridge`**: 모달이나 `Shift+클릭`으로 변경한 설정을 호스트 `settingsBridge.saveSettings()`로 `~/.gemini/antigravity/ko_translator_settings.json`에 영구 저장하고 실행 중인 모든 World `998` 창에 즉시 브로드캐스트합니다.
- **완전 격리·무간섭·Fail-Closed 설계 (`AddonManifest.v2`)**:
  - **`app.asar` 직접 패치 0% & `mainHook` 완전 제거**: `app.asar` 패치·원복은 공용 호스트(`antigravity-native-addon-host`)에 전임하며 메인 프로세스 플러그인 코드를 일절 실행하지 않습니다.
  - **`localStorage` 캐시 전용 제한 & World `998` 전역 비노출**: 보안 설정(`enabled`, `provider`, `llmConfig`, `customProviders`)은 `localStorage`에서 읽거나 쓰지 않고 `addonHost` 환경에서 `window.__agyKoTranslator`를 노출하지 않아 동적 LS 포트 변경 시 fail-open 외부 전송과 `localStorage` 변조를 근본 차단합니다.
  - **Fail-Closed 설정 보호**: 호스트 설정 파일이 누락되거나 손상되면 `enabled: false, provider: null`로 안전 차단하여 외부 번역 요청을 0건으로 유지합니다.
  - 원격 제어 웹(`antigravity.google.com/r/...`) 지원은 별도 프로젝트(`antigravity-remote-plugin`)로 완전 분리했습니다.

## 아키텍처

- `addon-manifest.v2.json` — `AddonManifest.v2` 선언 정본 (`trustLevel: "trusted"`, `minHostVersion: "2.1.0"`, `capabilities: ["renderer"]`, `settingsBridge`)
- `src/core/` — 벤더·DOM 비종속 핵심 도메인 (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`)
- `src/adapters/translators/` — 번역기 어댑터 (`google-translate`, `local-llm`, `custom-provider`, `endpoint-validator`)
- `src/adapters/antigravity/` — 순수 읽기 전용 DOM 어댑터 (`dictionaries/`, `dom-tokenizer`, `thinking-translator`, `trigger-controller`, `ui-localizer`, `quick-settings-ui`, 캐시 전용 `storage-port`)
- `src/runtime/` — `createTranslatorRuntime` 및 `observer-scheduler` (`addonHost.getSettings()`, `onSettingsChange()`, `saveSettings()`, `isElementInsideIgnored()` 연동)
- `host/` — `addon-registry.js`, `config-store.js`, `paths.js`, `profiles/antigravity.js`, CLI (`--status`/`--install`/`--uninstall`/`--rollback`)
- `dist/renderer.js` — 결정적 단일 렌더러 번들 (`scripts/build.js`)

## 설치 및 명령어

심볼릭 링크 없이 실제 파일을 `~/.gemini/config/plugins/ko-thought-translator/`에 복사한 뒤, 호스트 `v2.1.0+`에서 매니페스트 등록과 신뢰 승인을 진행합니다.

```bash
npm run build            # dist/renderer.js 단일 번들 빌드
npm test                 # 번들 무결성 확인 및 전체 단위·통합 시험 실행
npm run status           # AddonManifest.v2·설정 상태 읽기 전용 조회
npm run install:addon    # addons.d/ko-thought-translator.json 등록 및 누락 설정 초기화
npm run uninstall:addon  # 매니페스트 및 전용 설정 파일 제거

# antigravity-native-addon-host (>= v2.1.0)에서 실행:
addon-host --register ~/.gemini/config/plugins/ko-thought-translator/addon-manifest.v2.json
addon-host trust approve ko-thought-translator
addon-host --doctor
```
