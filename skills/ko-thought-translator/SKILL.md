---
name: ko-thought-translator
description: Antigravity 2.0 데스크톱 네이티브 앱 전용 한국어 Thinking 번역 및 영문 고정 UI 한글화 플러그인 관리·진단 스킬입니다.
---

# Antigravity 2.0 한국어 번역기 (데스크톱 전용 · v2.0.0)

## 역할 및 안전 경계

- **단일 책임**: Antigravity 데스크톱 네이티브 앱의 영문 `Thinking` 블록과 고정 UI 텍스트를 순수 읽기 전용 DOM 오버레이로 한국어 표시합니다.
- **호스트 불간섭**: `fetch`, `lsClient`, Protobuf, `React Fiber`, `Angular`, `Worker`, `AudioWorklet`, `iframe`에 일절 개입하지 않으며, 호스트 `app_storage.json`이나 타 플러그인 파일(`statusbar_autoinject.js`)을 읽거나 쓰지 않습니다.
- **코드·diff 보호**: 표준 CSS 선택자 및 `hasExcludedCodeDataAttrPrefix`로 코드 블록, diff 뷰어, 터미널, 입력창, 에이전트 본문 응답을 번역에서 제외합니다.
- **원격 제어 분리**: 원격 제어 웹(`antigravity.google.com/r/...`)은 별도 프로젝트(`antigravity-remote-plugin`)가 담당합니다.

## 공식 Sidecar 설정 패널

- 설정 UI는 Antigravity 공식 보조 패널(`sidecars/ko-translator-settings/sidecar.json`)에서 제공합니다:
  - `[한글 번역 설정](sidecar://ko-thought-translator/ko-translator-settings/)`
- 설정은 전용 파일 `~/.gemini/antigravity/ko_translator_settings.json`에만 저장됩니다.

## 명시적 CLI 명령 (상주 데몬·매 턴 훅 없음)

- 상태 확인 (읽기 전용): `node ./scripts/ensure_ko_thought_patch.js --status`
- 드롭인 로더 설치: `node ./scripts/ensure_ko_thought_patch.js --install`
- 매니페스트·설정 제거: `node ./scripts/ensure_ko_thought_patch.js --uninstall`
- 순정 `app.asar` 원복: `node ./scripts/ensure_ko_thought_patch.js --rollback`
