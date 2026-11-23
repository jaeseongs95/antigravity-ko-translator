# Antigravity 2.0 Korean Thought & UI Translator v2.2.0 Release Notes

> **Language**: English | [한국어](#한국어-릴리스-노트)

## English Release Notes

### Overview
`v2.2.0` brings back fast in-app translation engine switching (**Google Translate ↔ Local LLM**) directly inside Antigravity Desktop via a live **statusbar button** and a **centered Shadow DOM Quick Settings Modal** backed by `antigravity-native-addon-host >= v2.2.0` `settingsBridge.saveSettings()`, while completely removing the legacy Sidecar `AUX_PANE`.

### What's New
- **Statusbar Engine Toggle (`window.statusbarAddons.register`)**:
  - Displays live status (`번역:구글` / `번역:LLM` / `번역:꺼짐`) on the Antigravity Statusbar.
  - **Click** opens the Quick Settings Modal; **`Shift+click`** immediately toggles between Google Translate and Local LLM (with capture-phase modifier tracking so it works seamlessly with `antigravity-statusbar` v3.1.0+).
- **Centered In-App Shadow DOM Quick Settings Modal (`addonHost.openModal`)**:
  - Declared as `slot: "modal"`, `slotId: "ko-translator.quick-settings-modal"`, `exclusive: false`, `shadow: true` (coexisting cleanly with sibling plugin modals in the host LIFO stack).
  - Self-centers horizontally and vertically below the 36px titlebar even under app Tailwind Preflight resets (`* { margin: 0 }`).
  - Supports engine selection, Local LLM URL/model/API format (`ollama` / `openai`) + SSRF URL validation + live endpoint connection test, toggles (`enabled`, `translateThinking`, `showThinking`, `translateStaticUi`), live cache count, **Retranslate Now**, **Clear Cache**, and corrupted-settings one-click recovery.
  - Zero `innerHTML` usage (`createElement` + `textContent` only).
- **Legacy Sidecar `AUX_PANE` Removed**:
  - Deleted `sidecars/ko-translator-settings/` and removed `"sidecars"` from `plugin.json`.

### Upgrade & Installation
- Upgrade `antigravity-native-addon-host` to **`v2.2.0`** (`addon-host --upgrade`, zero `app.asar` re-patch).
- Copy real files (no symlinks) to `~/.gemini/config/plugins/ko-thought-translator/`, register `addon-manifest.v2.json`, pin SHA-256 trust (`addon-host trust approve ko-thought-translator`), and restart Antigravity Desktop.

---

## 한국어 릴리스 노트

### 개요
`v2.2.0`은 Antigravity Desktop 내부에서 **구글 번역 ↔ 로컬 LLM**을 즉시 전환할 수 있는 **상태바 버튼**과 **정중앙 Shadow DOM 빠른 설정 모달**을 추가(`antigravity-native-addon-host >= v2.2.0` `settingsBridge.saveSettings()` 연동)하고, 불필요했던 기존 Sidecar `AUX_PANE`을 완전히 제거한 마이너 릴리스입니다.

### 주요 변경 사항
- **상태바 번역 엔진 버튼 (`window.statusbarAddons.register`)**:
  - 하단 상태바에 실시간 엔진 상태(`번역:구글` / `번역:LLM` / `번역:꺼짐`)를 표시합니다.
  - **클릭** 시 빠른 설정 모달을 열고, **`Shift+클릭`** 시 구글 번역 ↔ 로컬 LLM을 즉시 전환합니다(캡처 단계 수식키 추적으로 `antigravity-statusbar` v3.1.0+와 완벽 호환).
- **정중앙 인앱 Shadow DOM 빠른 설정 모달 (`addonHost.openModal`)**:
  - `slot: "modal"`, `slotId: "ko-translator.quick-settings-modal"`, `exclusive: false`, `shadow: true`로 선언해 다른 플러그인 모달과 충돌 없이 공존합니다.
  - 앱 Tailwind Preflight(`* { margin: 0 }`) 환경에서도 타이틀바(36px) 아래 가로·세로 정중앙에 배치됩니다.
  - 번역 엔진 선택, 로컬 LLM 주소/모델/API 형식(`ollama`/`openai`) + SSRF URL 검증 + 실시간 연결 테스트, 각 번역 토글(`한국어 번역 사용`, `Thinking 번역`, `Thinking 블록 표시`, `영문 고정 UI 한글화`), 실시간 캐시 건수, **지금 다시 번역**, **캐시 초기화**, 손상된 설정 원클릭 복구를 제공합니다.
  - `innerHTML`을 전혀 사용하지 않고 안전한 DOM API(`createElement` + `textContent`)로만 구성했습니다.
- **기존 Sidecar `AUX_PANE` 완전 제거**:
  - `sidecars/ko-translator-settings/` 디렉터리와 `plugin.json`의 `"sidecars"` 선언을 삭제했습니다.

### 업그레이드 및 설치 안내
- `antigravity-native-addon-host`를 **`v2.2.0`**으로 업그레이드합니다(`addon-host --upgrade`, `app.asar` 재패치 없음).
- 심볼릭 링크 없이 실제 파일을 `~/.gemini/config/plugins/ko-thought-translator/`에 복사한 뒤 매니페스트 등록 및 SHA-256 신뢰 승인(`addon-host trust approve ko-thought-translator`)을 완료하고 Antigravity Desktop을 재시작합니다.
