---
name: ko-thought-translator
description: Antigravity 2.0 데스크톱 네이티브 앱 전용 한국어 Thinking 번역 및 영문 고정 UI 한글화 플러그인 관리·진단 스킬입니다.
---

# Antigravity 2.0 한국어 번역기 (데스크톱 전용 · v2.1.0 · AddonManifest.v2)

## 역할 및 안전 경계

- **단일 책임**: Antigravity 데스크톱 네이티브 앱의 영문 `Thinking` 블록과 고정 UI 텍스트를 순수 읽기 전용 DOM 오버레이로 한국어 표시합니다.
- **호스트 불간섭**: `mainHook`과 `app.asar` 직접 패치가 전혀 없는 렌더러 전용(`capabilities: ["renderer"]`) 플러그인입니다. `fetch`, `lsClient`, Protobuf, `React Fiber`, `Angular`, `Worker`, `AudioWorklet`, `iframe`에 개입하지 않으며, 호스트 `app_storage.json`이나 타 플러그인 슬롯(`status-bar` 등)을 건드리지 않습니다.
- **신뢰 경계 및 `settingsBridge`**: `antigravity-native-addon-host`의 호스트 격리 `settingsBridge`(`getSettings` / `onSettingsChange` / `saveSettings`)를 통해 `~/.gemini/antigravity/ko_translator_settings.json`을 읽고 저장합니다. `localStorage`는 번역 캐시 전용이며 보안 설정(프로바이더·엔드포인트·활성 여부) 권한을 갖지 않습니다.
- **코드·diff 보호**: 표준 CSS 선택자, `hasExcludedCodeDataAttrPrefix`, `addonHost.isElementInsideIgnored()`로 코드 블록, diff 뷰어, 터미널, 입력창, 에이전트 본문 응답 및 타 플러그인 Shadow DOM을 번역에서 제외합니다.

## 인앱 상태바 버튼 및 빠른 설정 모달

- 하단 상태바 버튼(`번역:구글` / `번역:LLM` / `번역:꺼짐`)을 통해 번역 엔진과 옵션을 즉시 조작합니다(별도 Sidecar AUX_PANE 없음):
  - **일반 클릭**: Shadow DOM 빠른 설정 모달(`ko-translator.quick-settings-modal`) 열기 (구글 번역 / 로컬 LLM 전환, 모델·주소·연결 테스트, 옵션 토글, 지금 다시 번역, 캐시 초기화)
  - **`Shift+클릭`**: 구글 번역 ↔ 로컬 LLM 즉시 전환
- 설정은 전용 파일 `~/.gemini/antigravity/ko_translator_settings.json`에만 저장되며 호스트 `settingsBridge`가 실행 중인 모든 창에 실시간 반영합니다.

## 설치 및 명시적 CLI 명령

- 실제 파일 설치 경로(심볼릭 링크 금지): `~/.gemini/config/plugins/ko-thought-translator/`
- 호스트 신뢰 승인(최초 설치/업데이트 후 1회): `addon-host trust approve ko-thought-translator`
- 상태 확인 (읽기 전용): `node ./scripts/ensure_ko_thought_patch.js --status`
- 매니페스트 등록 및 기본 설정 초기화: `node ./scripts/ensure_ko_thought_patch.js --install`
- 매니페스트·설정 제거: `node ./scripts/ensure_ko_thought_patch.js --uninstall`
- 매니페스트·설정 원복 (공유 호스트 보존): `node ./scripts/ensure_ko_thought_patch.js --rollback`
