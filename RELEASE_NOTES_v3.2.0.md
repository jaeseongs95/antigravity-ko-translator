# Antigravity Korean Thought & UI Translator v3.2.0 Release Notes

## English

### Highlights
- **Dynamic Vendor Model `<select>` & Live `/models` Fetching**:
  - Replaces the plain model text field in the **외부 API** settings card with a semantic model `<select>` box populated with each vendor's curated models plus a live **`[불러오기]`** button (and automatic background refresh when an API key is already stored).
  - Supports real vendor model listing APIs via Extenra `ctx.secrets` + `net.fetch({ secretHeaders })`:
    - **OpenAI**: `GET /v1/models` (filters out non-chat models such as embeddings/whisper/tts/dall-e and sorts newest first)
    - **Anthropic (Claude)**: `GET /v1/models?limit=100` (`anthropic-version: 2023-06-01` + `x-api-key`)
    - **Google Gemini**: `GET /v1beta/models?pageSize=100` (`generateContent`-capable models, strips `models/` prefix)
    - **OpenAI-compatible**: `GET /v1/models` (OpenRouter, DeepSeek, Groq, etc.)
  - Includes a **`직접 입력...`** option to manually enter any custom model ID when needed.
- **OpenAI Modern / Reasoning Model Compatibility (`gpt-6-luna`, `gpt-5*`, `o1`/`o3`/`o4`)**:
  - Fixes HTTP 400 errors on modern OpenAI Chat Completions models by switching the official OpenAI preset from legacy `max_tokens` to `max_completion_tokens`, omitting `temperature: 0` on reasoning-capable models, and allocating reasoning-safe completion token budgets (`512` for connection probe, `2048` for translation).
- **Sanitized Server Error Details & Button Layout Fix**:
  - Surfaces actual API error messages (`error.message`) on HTTP 4xx/5xx failures with automatic secret redaction (`sk-...`, `AIza...`, `Bearer ...` → `[REDACTED]`).
  - Adds `white-space: nowrap; flex-shrink: 0;` to `.ko-qs-btn` so buttons like `키 삭제` never wrap onto two lines.

---

## 한국어

### 주요 변경 사항
- **벤더 API 모델 목록 자동 조회 및 `<select>` 선택 박스 추가**:
  - **외부 API** 설정 카드의 모델 입력란을 벤더별 추천 모델 + **`[불러오기]`** 버튼이 결합된 `<select>` 박스로 개편했습니다(API 키가 이미 저장되어 있으면 자동으로 해당 벤더의 최신 모델 목록을 불러옵니다).
  - Extenra `ctx.secrets` + `net.fetch({ secretHeaders })`를 통해 각 벤더의 실제 모델 목록 API를 직접 조회합니다:
    - **OpenAI**: `GET /v1/models` (임베딩·음성·이미지 등 비채팅 모델 자동 제외, 최신순 정렬)
    - **Anthropic (Claude)**: `GET /v1/models?limit=100` (`anthropic-version` + `x-api-key`)
    - **Google Gemini**: `GET /v1beta/models?pageSize=100` (`generateContent` 지원 모델 필터링)
    - **OpenAI 호환**: `GET /v1/models` (OpenRouter, DeepSeek, Groq 등)
  - 목록에 없는 커스텀 모델을 쓰고 싶을 때는 맨 아래 **`직접 입력...`** 을 선택해 직접 입력할 수 있습니다.
- **OpenAI 최신·추론 모델(`gpt-6-luna`, `gpt-5*`, `o1`/`o3`/`o4`) HTTP 400 수정**:
  - 공식 OpenAI 프리셋에서 레거시 `max_tokens` 대신 `max_completion_tokens`를 전송하고, 기본 추론이 활성화된 최신 모델군에는 `temperature: 0`을 생략하며 추론 토큰을 고려한 출력 한도(연결 테스트 `512`, 번역 `2048`)를 적용해 HTTP 400 오류를 해결했습니다.
- **서버 오류 상세 표시 및 `키 삭제` 버튼 줄바꿈 수정**:
  - HTTP 4xx/5xx 실패 시 서버 응답 JSON의 `error.message`를 비밀 토큰 마스킹(`[REDACTED]`) 후 함께 표시합니다.
  - `.ko-qs-btn`에 `white-space: nowrap; flex-shrink: 0;`을 추가해 `키 삭제` 버튼이 두 줄로 깨지던 문제를 수정했습니다.
