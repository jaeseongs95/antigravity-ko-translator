# Antigravity Korean Thought & UI Translator v3.1.0 Release Notes

## English

### Highlights
- **External Cloud LLM Translation Adapter (`cloud-api`)**:
  - Adds a 3rd built-in translation engine (**외부 API**) supporting API-key-authenticated cloud LLM providers:
    - **OpenAI** (`https://api.openai.com/v1`, `Authorization: Bearer ...`)
    - **Anthropic (Claude)** (`https://api.anthropic.com`, `x-api-key` + `anthropic-version: 2023-06-01`)
    - **Google Gemini** (`https://generativelanguage.googleapis.com`, `x-goog-api-key`)
    - **OpenAI-compatible HTTPS endpoints** (OpenRouter, DeepSeek, Groq, xAI, Mistral, Together, or user-approved HTTPS hosts)
  - Preserves all code/path/identifier placeholder tokens (`⟦C0⟧`, `⟦T0⟧`, etc.) with automatic single-retry verification and strict HTTPS non-loopback SSRF validation.
- **Extenra v3.3.0 `ctx.secrets` + `net.fetch({ secretHeaders })` Integration**:
  - Declares `permissions.secrets: { maxKeys: 8, maxBytes: 16384, allowRead: false }` and `compatibility.minHostVersion: "3.3.0"` in `addon-manifest.v3.json`.
  - API keys are stored strictly in the Extenra host secrets vault (OS-encrypted `Electron safeStorage` on Desktop, Desktop Remote Bridge when paired on Remote Web, or ephemeral session memory when standalone) and injected into outbound HTTPS headers by the host — plaintext API keys are NEVER written to `ko_translator_settings.json` or `localStorage`.
- **Quick Settings UI**:
  - Adds the 3rd engine selector card (**외부 API**), preset/model/HTTPS endpoint/timeout fields, password API Key input with live persistence-mode badge (`OS 암호화` / `Remote Bridge` / `세션 메모리` / `미등록`), `[키 삭제]`, and `[연결 테스트]` probe.
  - Statusbar shows `번역:API` when active.

---

## 한국어

### 주요 변경 사항
- **외부 클라우드 LLM 번역 어댑터 (`cloud-api`) 추가**:
  - 기존 구글 번역·로컬 LLM에 이어 **외부 API** 3번째 기본 번역 엔진을 추가했습니다:
    - **OpenAI** (`https://api.openai.com/v1`, `Authorization: Bearer ...`)
    - **Anthropic (Claude)** (`https://api.anthropic.com`, `x-api-key` + `anthropic-version: 2023-06-01`)
    - **Google Gemini** (`https://generativelanguage.googleapis.com`, `x-goog-api-key`)
    - **OpenAI 호환 HTTPS 엔드포인트** (OpenRouter, DeepSeek, Groq, xAI, Mistral, Together 및 사용자 승인 HTTPS 호스트)
  - 기존 로컬 LLM과 동일한 코드·경로·식별자 토큰(`⟦C0⟧`, `⟦T0⟧`) 100% 원형 보존, 누락 시 자동 1회 재시도, 엄격한 HTTPS 비-루프백 SSRF 차단을 적용했습니다.
- **Extenra v3.3.0 `ctx.secrets` + `net.fetch({ secretHeaders })` 공식 연동**:
  - `addon-manifest.v3.json`에 `permissions.secrets: { maxKeys: 8, maxBytes: 16384, allowRead: false }`와 `minHostVersion: "3.3.0"`을 선언했습니다.
  - API 키는 `ko_translator_settings.json`이나 `localStorage`에 절대 저장되지 않으며, Extenra 호스트 시크릿 저장소(Desktop OS 암호화 / Remote Bridge / 단독 실행 시 세션 메모리)에 격리 보관되고 네트워크 요청 시 호스트가 직접 인증 헤더를 주입합니다.
- **빠른 설정 모달 UI 확장**:
  - 3번째 엔진 카드(**외부 API**)와 제공자 프리셋·모델명·HTTPS 주소·타임아웃·비밀번호형 API 키 입력창, 저장 모드 배지(`OS 암호화` / `Remote Bridge` / `세션 메모리` / `미등록`), `[키 삭제]`, `[연결 테스트]`를 추가했습니다.
  - 활성화 시 상태바 버튼에 `번역:API`로 표시됩니다.
