# Antigravity 2.0 한국어 번역기 (`ko-thought-translator`)

Antigravity 2.0 네이티브 앱에서 영어로 스트리밍되는 **Thinking(추론 과정) 본문**과 **앱 전체 정적 UI 메뉴·설정·위젯**을 한국어로 자동 표시하며, **Port & Adapter 기반 번역 계층(`local-llm` / `google-translate`)**, **네이티브 설정창 통합**, **앱 업데이트 시 자동 패치 복구**를 제공하는 플러그인입니다.

## 주요 기능

1. **Port & Adapter 기반 번역 계층 (`local-llm` / `google-translate`)**
   - 상위 번역 정책(인라인 코드 `⟦C0⟧` 및 식별자·한국어 인용구 `⟦T0⟧` 보호, 일본어 가나·CJK 한자 드리프트 차단, 받침 조사 자동 교정, 스트리밍 취소·디바운스, 캐시)과 하위 전송 어댑터를 분리했습니다.
   - **`local-llm` (기본값)**: 로컬 OpenAI 호환 서버(`http://127.0.0.1:11434`, 100% GPU 하드웨어 가속, 완전 헤드리스 구동)를 사용하여 외부 네트워크 전송 없이 번역합니다.
   - **`google-translate`**: Google 번역(GTX) 엔드포인트를 사용하여 로컬 자원 소모 없이 번역합니다. 선택 시 로컬 LLM 서버 프로세스를 자동으로 종료하여 GPU/메모리 자원을 즉시 반환합니다.
   - **커스텀 어댑터 확장**: `window.__agyRegisterTranslationAdapter(id, { maxConcurrency, translate })`를 통해 새 번역 엔진을 코드 수정 없이 등록할 수 있습니다.

2. **Antigravity 2.0 네이티브 설정창 통합 및 커스텀 상태바 어댑터 (`StatusBarAdapter`) 연동**
   - 좌측 하단 **`설정` (`Settings`)** 클릭 시 열리는 기본 **`일반 (General)` 탭 최상단**과 좌측 사이드바의 전용 **`한글 번역` 탭**에서 번역 어댑터 전환, 로컬 LLM 연결 상태 확인, Thinking 사전 번역(`ON/OFF`), 현재 화면 즉시 재번역 및 캐시 초기화를 바로 실행할 수 있습니다.
   - [`antigravity-statusbar`](https://github.com/jaeseongs95/antigravity-statusbar)의 `window.agyStatusBar.registerAdapter` API를 통해 상태바 코어 DOM이나 기존 버튼(`[ compact ]`, `[ context ]`) 영역을 침범하지 않고 우측 슬롯(`slot: 'right'`, `order: 30`)에 `[ 번역:구글 ]` / `[ 번역:LLM ]` 어댑터 버튼을 모듈화하여 장착합니다(클릭 시 빠른 설정 모달 열기/닫기, `Shift+클릭` 시 로컬 LLM ↔ Google 번역 즉시 전환).

3. **고정 UI 및 위젯 0ms 동기 한글화 (`STATIC_UI_MAP`)**
   - 메뉴바, 사이드바, 우측 패널 탭, 설정(`Settings`), 맞춤 설정(`Customizations`), 자동화(`/sidecars`), 대화 기록(`/history`), `ask_question` 및 권한 승인 위젯을 네트워크 지연 없이 0ms 즉시 한글화합니다.
   - 하단 상태바(`.agy-ctx-statusbar`), 입력창 모델/권한 컨트롤, 모델 선택 메뉴의 `New` 배지 및 고유명사는 원문을 그대로 보존합니다.

4. **앱 업데이트 시 자동 복구 및 영구 유지**
   - `SessionStart`, `PreInvocation`, `PostInvocation` 훅과 스토리지 감시자를 통해 Antigravity 앱이 업데이트되더라도 자동으로 패치와 설정을 복구·유지합니다.

## 모듈 구조 (SOLID Architecture)

- **렌더러 계층 (`scripts/renderer/`)**:
  - `01-bootstrap-and-cache.js`: 버전 가드(`v12.7`), 비활성화 시 DOM 원본 복원, 번역 캐시(`memCache`/`localStorage`) 관리
  - `02-static-ui-dict.js`: 0ms 정적 UI 한국어 사전(`STATIC_UI_MAP`) 및 동기 패턴 매처
  - `03-text-tokenizer.js`: 코드(`⟦C0⟧`)·식별자/인용구(`⟦T0⟧`) 보호 토크나이저, 조사 교정, 마크다운 세그먼트 추출
  - `04-translation-adapters.js`: Port & Adapter 번역 엔진(`local-llm`, `google-translate`, 커스텀 어댑터) 및 동시성/취소 큐
  - `05-fiber-pretranslator.js`: 영구 설정 로드 및 React Fiber 백그라운드 사전 번역기
  - `06-settings-modal-ui.js`: 스타일시트, Antigravity 2.0 네이티브 설정 모달(`.settings-modal-container`) 및 빠른 설정 모달(`#agy-ko-translator-modal`) UI 통합
  - `07-statusbar-adapter.js`: `antigravity-statusbar` `StatusBarAdapter` (`window.agyStatusBar.registerAdapter` / `unregisterAdapter` / `updateAll`) 순수 어댑터 브릿지
  - `08-dom-observer.js`: 스트리밍 Thinking 블록 렌더러, 정적 UI TreeWalker, `MutationObserver` 및 생명주기 정리
- **호스트 계층 (`scripts/host/` & `scripts/ensure_ko_thought_patch.js`)**:
  - `paths.js`: 호스트 경로 및 환경 상수
  - `local-llm-service.js`: 로컬 LLM 서버 기동·헬스체크·종료(프로세스 트리 정리) 어댑터
  - `settings-storage.js`: `config.json` 및 `app_storage.json` 동기화와 백그라운드 스토리지 감시 데몬
  - `bundle-injector.js`: `scripts/renderer/*.js` 모듈 조립 및 `statusbar_autoinject.js` 번들 동기화
  - `ensure_ko_thought_patch.js`: CLI / Hook 오케스트레이터 진입점

## CLI 제어 명령

```powershell
# 패치 상태 확인 및 즉시 적용
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --status
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --worker

# 번역 어댑터 전환 (local-llm | google-translate)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider local-llm
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider google-translate

# Thinking 사전 번역 옵션 전환 (off | on, 기본값: off)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate off
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate on
```

## 라이선스 (License)

이 프로젝트는 [MIT License](./LICENSE)를 따릅니다.
