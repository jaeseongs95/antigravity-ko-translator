---
name: ko-thought-translator
description: Antigravity 2.0의 Thinking(추론 과정) 및 고정 UI 한글 번역 패치 상태를 점검하거나 수동 재적용할 때 사용한다.
---

# Antigravity 2.0 한국어 번역기 스킬 (`ko-thought-translator` `v2.0.0`)

사용자가 Thinking(추론 과정) 및 고정 UI 한글 번역 상태를 확인·수정·재적용·제거·롤백하려고 할 때 이 스킬을 사용한다.
- **실시간 비동기 번역**: Thinking 본문(`.cursor-edit`, 사이드 질문 추론, 브라우저 서브에이전트 실시간 추론) 및 동적 질문 위젯에만 적용하며 코드·경로·식별자(`⟦C0⟧`, `⟦T0⟧`)를 원문 보호한다.
- **0ms 정적 사전 치환**: 메뉴바, 좌측 사이드바, 우측 패널, 설정/맞춤 설정 고정 항목, 권한 승인 창에만 적용하며 코드 뷰어·diff·구문 강조(`.code-block`, `.code-line`, `.line-content`, `.token`, `[data-line-number]`, `[data-diff-type]`, `[data-quotable]`, `data-(line-|quotable|diff-|code-|token-|syntax-|file-path|file-uri|symbol-|lsp-)` 접두사 속성, `.font-mono`)는 원문을 100% 보존한다(`D-0042`).
- **번역 제외(원문 유지)**: 하단 상태바(`.agy-ctx-statusbar`), 입력창 모델/권한 선택 컨트롤, 모델 드롭다운 `New` 배지, MCP/플러그인/모델 등 모든 고유명사.

## 주요 파일 경로 (`v2.0.0` 헥사고날 아키텍처)
- **순수 코어 계층**: `~/.gemini/config/plugins/ko-thought-translator/src/core/`
- **어댑터 계층**: `~/.gemini/config/plugins/ko-thought-translator/src/adapters/`
- **원격 제어 승격·ESM/Worker 샌드박스 계층**: `~/.gemini/config/plugins/ko-thought-translator/src/remote/`
- **런타임 컴포지션 루트**: `~/.gemini/config/plugins/ko-thought-translator/src/runtime/`
- **호스트 CLI·데몬·패처 계층**: `~/.gemini/config/plugins/ko-thought-translator/host/`
- **단일 빌드 파이프라인**: `~/.gemini/config/plugins/ko-thought-translator/scripts/build.js`
- **배포 미러 번들(4개 바이트 동일)**: `dist/ko_thought_autoinject.js`, `scripts/ko_thought_autoinject.js`, `plugins/ko-thought-translator/scripts/ko_thought_autoinject.js`, `skills/ko-thought-translator/scripts/ko_thought_inject.js`
- **호스트 설정 정본(SSOT)**: `~/.gemini/antigravity/ko_translator_settings.json`

## 상태 점검·적용·제거·롤백 명령
```powershell
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --status
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --worker
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --uninstall
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --rollback
```

## 번역 어댑터 및 사전 번역 제어
```powershell
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider google-translate
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider local-llm
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate off
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate on
```
- 런타임 API:
  - `window.__agySetTranslationProvider('google-translate' | 'local-llm' | '<custom-id>')`
  - `window.__agyGetTranslationProvider()` / `window.__agyListTranslationProviders()`
  - `window.__agySetLlmConfig({ baseUrl, model, apiFormat, allowRemoteHttps, timeoutMs })`
  - `window.__agyUpsertCustomProvider(spec)` / `window.__agyRemoveCustomProvider(id)`
  - `window.__agyRetranslateVisibleThoughts(clearCache)`
