---
name: ko-thought-translator
description: Antigravity 2.0의 Thinking(추론 과정) 및 고정 UI 한글 번역 패치 상태를 점검하거나 수동 재적용할 때 사용한다.
---

# Antigravity 2.0 한국어 번역기 스킬 (`ko-thought-translator`)

사용자가 Thinking(추론 과정) 및 고정 UI 한글 번역 상태를 확인·수정·재적용하려고 할 때 이 스킬을 사용한다.
- **실시간 비동기 번역**: 오직 Thinking 본문(`.cursor-edit`) 및 동적 질문 위젯에만 적용(코드·경로·식별자 원문 보호).
- **0ms 정적 사전 치환 (`STATIC_UI_MAP`)**: 상단 메뉴, 좌측 사이드바, 우측 패널 탭, 설정/맞춤 설정 고정 항목, 권한 승인 창에만 적용.
- **번역 제외(원문 유지)**: 하단 상태바(`.agy-ctx-statusbar`), 입력창 모델/권한 선택 컨트롤, 모델 드롭다운 `New` 배지, MCP/플러그인/모델 등 모든 고유명사.

## 주요 파일 경로
- **번역 엔진 스크립트**: `~/.gemini/config/plugins/ko-thought-translator/scripts/ko_thought_autoinject.js`
- **패치 및 업데이트 자동 복구 런처**: `~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js`
- **통합 자동 주입 번들**: `~/.gemini/antigravity/statusbar_autoinject.js`
- **ASAR & CDP 자동 패처**: `~/.gemini/antigravity/ensure_statusbar_patch.js`

## 상태 점검 및 즉시 적용 명령
```powershell
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --worker
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --status
```

## Thinking 사전 번역(Pre-translate) 옵션 켜기 / 끄기
- 기본값: 꺼짐(`off`)
```powershell
# 사전 번역 끄기 (기본)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate off

# 사전 번역 켜기
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate on
```
- 런타임 제어: `window.__agySetPretranslate(true)` / `window.__agySetPretranslate(false)`

## 번역 어댑터(Provider) 전환 (`local-llm` / `google-translate`)
- 기본값: `local-llm`
```powershell
# 로컬 LLM 어댑터 사용 (기본)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider local-llm

# Google 번역 어댑터 사용 (로컬 LLM 서버 자동 종료)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider google-translate
```
- 런타임 제어 및 커스텀 어댑터 등록:
  - `window.__agySetTranslationProvider('local-llm' | 'google-translate')`
  - `window.__agyGetTranslationProvider()`
  - `window.__agyRegisterTranslationAdapter(id, { maxConcurrency, translate })`
  - `window.__agyRetranslateVisibleThoughts(clearCache)` (현재 화면 Thinking 즉시 재번역)

## Antigravity 2.0 네이티브 앱 내 설정창 진입점
- **네이티브 설정창 (`설정` 버튼)**:
  - 좌측 하단 `설정` 클릭 시 열리는 기본 **`일반 (General)` 탭 최상단**에 `한글 번역 계층` 설정 카드가 표시됨.
  - 좌측 설정 사이드바 메뉴의 **`한글 번역` 탭**을 클릭하면 전용 설정 페이지가 열림.
  - 설정창에서 `Google 번역` 어댑터로 전환하면 로컬 LLM 서버가 자동으로 종료되어 GPU/메모리를 반환하고, `로컬 LLM` 어댑터로 전환하면 헤드리스로 자동 재기동됨.
