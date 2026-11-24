# Antigravity 2.0 Korean Thought & UI Translator v2.3.0 Release Notes

> **Language**: English | [한국어](#한국어-릴리스-노트)

## English Release Notes

### Overview
`v2.3.0` aligns `ko-thought-translator` with **`antigravity-native-addon-host v2.3.0`**, adding first-class **Remote Web (`antigravity-remote-web`)** compatibility alongside **Antigravity Desktop (`antigravity-desktop`)** while preserving every Desktop fail-closed security invariant, DIP boundary, and zero-sink MV3/Trusted Types guarantee.

### What's New
- **Multi-Profile `AddonManifest.v2` Contract (`antigravity-desktop` + `antigravity-remote-web`)**:
  - Updated `addon-manifest.v2.json` with `version: "2.3.0"`, `compatibility.hostProfiles: ["antigravity-desktop", "antigravity-remote-web"]`, and `compatibility.minHostVersion: "2.3.0"`.
  - Updated `host/addon-registry.js` to validate `compatibility.hostProfiles` and `compatibility.excludeHostProfiles` (matching Host v2.3.0 precedence) with zero hardcoded vendor literals.
- **Remote Web First-Boot Support (`resolveUninitializedSettings`)**:
  - Added a vendor-neutral adapter hook `hostAdapter.resolveUninitializedSettings(hostCapability)` so that first-time `antigravity-remote-web` loads with `addonHost.getSettings() === null` (when Host v2.3.0 packs with `includeSettingsSnapshots: false`) boot cleanly enabled with `google-translate`.
  - Preserved strict fail-closed behavior for corrupted snapshots (`status: 'error'`, invalid JSON, missing/invalid provider) on **all** host profiles and for missing/`null` settings snapshots on Desktop (`ERR_SETTINGS_FILE_MISSING`).
- **Host Settings Tab & Actions Registration (`quick-settings-ui.js`)**:
  - Registers `addonHost.registerSettingsTab('ko-translator.quick-settings', ...)` and host actions (`open-quick-settings`, `toggle-engine`) on `start()`, and cleanly unregisters them on `dispose()`, enabling Quick Settings Modal & engine toggling via the Host Control Panel / actions even when `window.statusbarAddons` is absent.
- **Defense-in-Depth `[data-addon-host-ignore]` Exclusion**:
  - Added `[data-addon-host-ignore]` to `host-adapter.js`, `ui-localizer.js`, `thinking-translator.js`, and `trigger-controller.js` alongside `addonHost.isElementInsideIgnored(el)` so the Remote Web Host Drawer and fallback slot dock are never localized.
- **Version Metadata & CLI Sync**:
  - Synchronized version reporting across `package.json`, `plugin.json`, `addon-manifest.v2.json`, `src/index.js`, `src/runtime/bootstrap.js`, `scripts/build.js` bundle banner, and `host/cli.js` (`MIN_REQUIRED_HOST_VERSION = '2.3.0'`).

### Upgrade & Installation
- Upgrade `antigravity-native-addon-host` to **`v2.3.0`** (`addon-host --upgrade`, zero `app.asar` re-patch).
- Copy real files (no symlinks) to `~/.gemini/config/plugins/ko-thought-translator/`, re-register `addon-manifest.v2.json`, pin SHA-256 trust (`addon-host trust approve ko-thought-translator`), and restart Antigravity Desktop (or rebuild your Remote Web extension bundle via `addon-host --build-remote`).

---

## 한국어 릴리스 노트

### 개요
`v2.3.0`은 **`antigravity-native-addon-host v2.3.0`**에 맞춰 `ko-thought-translator`를 업그레이드한 마이너 릴리스입니다. 기존 **Antigravity 데스크톱(`antigravity-desktop`)**의 Fail-Closed 보안 불변조건·DIP 경계·HTML Sink 0건 원칙을 그대로 유지하면서 **원격 웹(`antigravity-remote-web`)**을 공식 지원합니다.

### 주요 변경 사항
- **다중 프로필 `AddonManifest.v2` 계약 적용 (`antigravity-desktop` + `antigravity-remote-web`)**:
  - `addon-manifest.v2.json`을 `version: "2.3.0"`, `compatibility.hostProfiles: ["antigravity-desktop", "antigravity-remote-web"]`, `compatibility.minHostVersion: "2.3.0"`으로 갱신했습니다.
  - `host/addon-registry.js`가 Host v2.3.0과 동일한 우선순위로 `compatibility.hostProfiles` 및 `compatibility.excludeHostProfiles`를 벤더 리터럴 없이 검증합니다.
- **원격 웹 첫 기동 정상화 (`resolveUninitializedSettings`)**:
  - 벤더 중립 어댑터 훅 `hostAdapter.resolveUninitializedSettings(hostCapability)`를 도입해, Host v2.3.0 원격 웹 기본 패킹(`includeSettingsSnapshots: false`)의 최초 진입(`addonHost.getSettings() === null`)에서도 `google-translate` 기본값으로 즉시 기동합니다.
  - 손상된 스냅샷(`status: 'error'`, JSON 오류, 누락·비정상 프로바이더)은 **모든 프로필**에서 계속 Fail-Closed로 차단하며, 데스크톱의 `null`/누락 스냅샷 Fail-Closed(`ERR_SETTINGS_FILE_MISSING`)도 그대로 유지됩니다.
- **호스트 설정 탭 및 액션 등록 (`quick-settings-ui.js`)**:
  - `start()` 시 `addonHost.registerSettingsTab('ko-translator.quick-settings', ...)`과 호스트 액션(`open-quick-settings`, `toggle-engine`)을 등록하고 `dispose()` 시 일괄 해제해, 상태바 플러그인이 없는 원격 웹 환경에서도 빠른 설정 모달 열기와 엔진 전환이 가능합니다.
- **`[data-addon-host-ignore]` 다층 제외 방어**:
  - `addonHost.isElementInsideIgnored(el)` 외에 `host-adapter.js`, `ui-localizer.js`, `thinking-translator.js`, `trigger-controller.js`의 기본 제외 선택자에 `[data-addon-host-ignore]`를 추가해 원격 웹 호스트 드로어 및 폴백 슬롯 독을 보호합니다.
- **버전 메타데이터 및 CLI 동기화**:
  - `package.json`, `plugin.json`, `addon-manifest.v2.json`, `src/index.js`, `src/runtime/bootstrap.js`, `scripts/build.js` 번들 배너, `host/cli.js`(`MIN_REQUIRED_HOST_VERSION = '2.3.0'`)의 버전을 `2.3.0`으로 일괄 동기화했습니다.

### 업그레이드 및 설치 안내
- `antigravity-native-addon-host`를 **`v2.3.0`**으로 업그레이드합니다(`addon-host --upgrade`, `app.asar` 재패치 없음).
- 심볼릭 링크 없이 실제 파일을 `~/.gemini/config/plugins/ko-thought-translator/`에 복사한 뒤 매니페스트 등록 및 SHA-256 신뢰 승인(`addon-host trust approve ko-thought-translator`)을 완료하고 Antigravity Desktop을 재시작하거나 원격 웹 번들(`addon-host --build-remote`)을 다시 빌드합니다.
