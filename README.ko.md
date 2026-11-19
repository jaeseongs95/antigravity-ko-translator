# Antigravity 2.0 한국어 번역기 (`v2.0.0` · 데스크톱 전용)

[English README](./README.md)

Antigravity 2.0 **데스크톱 네이티브 앱 전용**으로 처음부터 새로 설계한 한국어 번역 플러그인입니다.
- **실시간 Thinking(추론 과정) 한국어 번역**: 백틱 코드·식별자·파일 경로를 원형 보존하고 한국어 조사를 자연스럽게 보정합니다.
- **영문 고정 UI 한글화**: 코드 뷰어·diff·터미널·입력창·에이전트 본문 응답을 엄격히 제외하고 메뉴·버튼·설정 안내만 한글화합니다.
- **공식 Sidecar(`AUX_PANE`) 설정·진단 패널**: 네이티브 설정창 DOM을 변조하지 않고 Antigravity 공식 보조 패널(`sidecars/ko-translator-settings/`)로 설정 UI를 제공합니다.
- **완전 격리·무간섭 설계**:
  - `fetch` / `lsClient` / Protobuf / `React Fiber` / `Angular` / `Worker` / `AudioWorklet` / `iframe` 후킹 **0%**.
  - `statusbar_autoinject.js` 합본, `app_storage.json` 코드 저장, 상주 워처 데몬, 매 턴 `PreInvocation`/`PostInvocation` 훅 **전면 폐지**.
  - 단독 드롭인 매니페스트(`~/.gemini/antigravity/ui-extensions.d/ko-thought-translator.json`) + `config.json` 실시간 `enabled` 게이트로 플러그인을 끄면 즉시 0줄 실행됩니다.
  - 원격 제어 웹(`antigravity.google.com/r/...`) 지원은 별도 프로젝트(`antigravity-remote-plugin`)로 완전 분리했습니다.

## 명령어

```bash
npm run build            # dist/renderer.js 단일 번들 빌드
npm test                 # 번들 무결성 확인 및 전체 단위·통합 시험 실행
npm run status           # 로더·설정 상태 읽기 전용 조회
npm run install:loader   # 드롭인 매니페스트 등록 및 dist/main.js 로더 설치
npm run uninstall:loader # 매니페스트 및 전용 설정 파일 제거
npm run rollback         # 매니페스트 제거 및 검증된 순정 .orig app.asar 원복
```
