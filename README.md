# Antigravity 2.0 한국어 번역기 (`ko-thought-translator`)

Antigravity 2.0 네이티브 앱에서 영어로 스트리밍되는 **Thinking(추론 과정) 본문**과 **앱 전체 정적 UI 메뉴·설정·위젯**을 한국어로 자동 표시하며, **Port & Adapter 기반 번역 계층(`local-llm` / `google-translate`)**, **네이티브 설정창 통합**, **앱 업데이트 시 자동 패치 복구**를 제공하는 플러그인입니다.

## 주요 기능

1. **Port & Adapter 기반 번역 계층 (`local-llm` / `google-translate`)**
   - 상위 번역 정책(인라인 코드 `⟦C0⟧` 및 식별자·한국어 인용구 `⟦T0⟧` 보호, 일본어 가나·CJK 한자 드리프트 차단, 받침 조사 자동 교정, 스트리밍 취소·디바운스, 캐시)과 하위 전송 어댑터를 분리했습니다.
   - **`local-llm` (기본값)**: 로컬 OpenAI 호환 서버(`http://127.0.0.1:11434`, 100% GPU 하드웨어 가속, 완전 헤드리스 구동)를 사용하여 외부 네트워크 전송 없이 번역합니다.
   - **`google-translate`**: Google 번역(GTX) 엔드포인트를 사용하여 로컬 자원 소모 없이 번역합니다. 선택 시 로컬 LLM 서버 프로세스를 자동으로 종료하여 GPU/메모리 자원을 즉시 반환합니다.
   - **커스텀 어댑터 확장**: `window.__agyRegisterTranslationAdapter(id, { maxConcurrency, translate })`를 통해 새 번역 엔진을 코드 수정 없이 등록할 수 있습니다.

2. **Antigravity 2.0 네이티브 설정창 통합**
   - 좌측 하단 **`설정` (`Settings`)** 클릭 시 열리는 기본 **`일반 (General)` 탭 최상단**과 좌측 사이드바의 전용 **`한글 번역` 탭**에서 번역 어댑터 전환, 로컬 LLM 연결 상태 확인, Thinking 사전 번역(`ON/OFF`), 현재 화면 즉시 재번역 및 캐시 초기화를 바로 실행할 수 있습니다.

3. **고정 UI 및 위젯 0ms 동기 한글화 (`STATIC_UI_MAP`)**
   - 메뉴바, 사이드바, 우측 패널 탭, 설정(`Settings`), 맞춤 설정(`Customizations`), 자동화(`/sidecars`), 대화 기록(`/history`), `ask_question` 및 권한 승인 위젯을 네트워크 지연 없이 0ms 즉시 한글화합니다.
   - 하단 상태바(`.agy-ctx-statusbar`), 입력창 모델/권한 컨트롤, 모델 선택 메뉴의 `New` 배지 및 고유명사는 원문을 그대로 보존합니다.

4. **앱 업데이트 시 자동 복구 및 영구 유지**
   - `SessionStart`, `PreInvocation`, `PostInvocation` 훅과 스토리지 감시자를 통해 Antigravity 앱이 업데이트되더라도 자동으로 패치와 설정을 복구·유지합니다.

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
