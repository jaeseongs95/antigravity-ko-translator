# Antigravity Korean Thought & UI Translator v3.2.1

## English

### Bug Fixes
- **Removed all hardcoded/stale preset model lists (`CLOUD_API_PRESETS`)**: The model `<select>` box no longer fabricates hardcoded model IDs (such as outdated Claude 4.5 / Gemini 2.5 / GPT-4o-mini presets) before fetching from a provider's API. Until live models are fetched for the selected provider, the dropdown shows only the placeholder prompt (`API 키 입력 후 [불러오기]로 조회`) + `직접 입력...` (plus the currently saved model when it belongs to that same provider).
- **Active, currently-served models only across all vendors**:
  - **Anthropic**: Queries `GET /v1/models?limit=100&lifecycle=active` and additionally filters out `deprecated`, `retired`, `legacy`, and `deprecated_at` entries client-side.
  - **OpenAI**: Excludes non-Chat-Completions / voice / specialized / retired entries (`gpt-live-*`, `*-healthcare`, `*-pro`, `*-codex`, `chat-latest`, `whisper`, `tts`, `image`, `audio`, `realtime`, `embedding`, `moderation`, `sora`, `dall-e`, legacy `gpt-3.5`/`gpt-4`/`o1`, `ft:*`, and explicit deprecated/shutdown metadata) and collapses redundant dated snapshots (`-YYYY-MM-DD`) so only actively-served canonical chat models appear.
  - **Google Gemini**: Requires `generateContent`, excludes deprecated/discontinued descriptions and non-text families (`imagen`, `veo`, `embedding`, `aqa`, `tts`, `image`, `audio`, `live`, `robotics`, `computer-use`), and deduplicates numbered revisions (`-001`) when the canonical alias is present.
  - **OpenAI-compatible**: Excludes entries marked `deprecated`, `retired`, `inactive`, or past `shutdown_date`.

---

## 한국어

### 결함 수정
- **임의 하드코딩 모델 프리셋 목록 완전 제거**: API 제공자를 전환하거나 아직 모델 목록을 불러오지 않은 상태에서 임의로 하드코딩한 구버전 모델(Claude 4.5, Gemini 2.5 등)을 `<select>` 박스에 채우던 동작을 제거했습니다. 라이브 조회 전에는 `API 키 입력 후 [불러오기]로 조회` 안내와 `직접 입력...`(및 동일 제공자에 이미 저장된 모델)만 표시합니다.
- **현재 서비스 중인 텍스트 번역용 모델만 표시**:
  - **Anthropic**: `GET /v1/models?limit=100&lifecycle=active`로 활성 모델만 조회하고 클라이언트 측에서도 `deprecated`/`retired`/`legacy`/`deprecated_at` 항목을 제외합니다.
  - **OpenAI**: 채팅 번역에 쓸 수 없는 실시간 음성(`gpt-live-*`), Responses 전용·특수 모델(`*-healthcare`, `*-pro`, `*-codex`, `chat-latest`), 음성/이미지/임베딩/종료 모델, 중복 날짜 스냅샷(`-YYYY-MM-DD`) 및 `deprecated` 메타데이터 항목을 제외하고 현재 서비스 중인 표준 채팅 모델만 표시합니다.
  - **Google Gemini**: `generateContent` 지원 모델 중 비텍스트(`imagen`/`veo`/`tts`/`live`/`audio`/`embedding` 등)와 종료/지원 중단 설명 모델, 중복 숫자 리비전(`-001`)을 제외합니다.
  - **OpenAI 호환**: 응답 메타데이터에 `deprecated`/`retired`/`inactive`/종료일이 지난 항목을 제외합니다.
