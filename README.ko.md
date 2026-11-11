# Antigravity 2.0 한국어 번역기 (`ko-thought-translator`)

> 🌐 **Language**: [English Documentation (README.md)](./README.md) | **한국어**

Antigravity 2.0 데스크톱 앱과 **원격 제어(Remote Control) 웹·모바일 브라우저(`https://antigravity.google.com/r/...`)**에서 영어로 스트리밍되는 **Thinking(추론 과정) 본문**, **작업 단계 요약(`Worked for ...`)**, **앱 전체 정적 UI 메뉴·설정·위젯**을 실시간 한국어로 자동 전환하는 플러그인입니다 (`v1.2.34` / `v13.29`).

---

## 목차

1. [원격 제어(Remote Control) 웹·모바일 브라우저에서 한글 번역 켜는 법](#1-원격-제어remote-control-웹모바일-브라우저에서-한글-번역-켜는-법)
   - [방법 A. 북마크바(북마클릿) 1클릭 실행 (PC & 모바일 크롬 공통)](#방법-a-북마크바북마클릿-1클릭-실행-pc--모바일-크롬-공통)
   - [방법 B. Tampermonkey 유저스크립트로 접속 시마다 자동 실행 (PC 크롬 권장)](#방법-b-tampermonkey-유저스크립트로-접속-시마다-자동-실행-pc-크롬-권장)
   - [방법 C. `antigravity-statusbar` (`커스텀바`) 연동 자동 실행](#방법-c-antigravity-statusbar-커스텀바-연동-자동-실행)
2. [데스크톱 앱 설치 및 자동 복구](#2-데스크톱-앱-설치-및-자동-복구)
3. [번역 설정 및 UI 제어 방법](#3-번역-설정-및-ui-제어-방법)
4. [주요 기능 상세](#4-주요-기능-상세)
5. [CLI 제어 명령](#5-cli-제어-명령)
6. [모듈 구조 (SOLID Architecture)](#6-모듈-구조-solid-architecture)
7. [라이선스 (License)](#7-라이선스-license)

---

## 1. 원격 제어(Remote Control) 웹·모바일 브라우저에서 한글 번역 켜는 법

원격 제어 웹(`https://antigravity.google.com/r/...`)은 브라우저 보안 정책(CSP `nonce`, `TrustedTypes`, 교차 출처 `iframe`)이 적용되어 있습니다. 본 스크립트는 최상위 `<ga-remote-control>` Angular 셸과 내부 워크벤치 `iframe`(`hubFrame`)을 자동으로 브릿지하여 데스크톱과 동일한 한국어 UI·Thinking 번역 환경을 구성합니다.

### 방법 A. 북마크바(북마클릿) 1클릭 실행 (PC & 모바일 크롬 공통)

확장프로그램 설치 없이 **크롬 북마크바에 북마크 하나만 등록**해 두고 클릭하면 즉시 한글 번역이 켜집니다.

1. 크롬 북마크바 우클릭 → **`페이지 추가...`** (또는 북마크 관리자에서 **`새 북마크 추가`**) 선택
2. **이름**: `한글번역`
3. **URL(주소)**: 아래 한 줄 코드를 그대로 복사해 붙여넣고 저장합니다.

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js?t='+Date.now()).then(r=>r.text()).then(c=>{const s=document.createElement('script'),n=document.querySelector('script[nonce]')?.nonce,p=window.trustedTypes?.createPolicy('agy-ko-'+Date.now(),{createScript:x=>x});if(n)s.nonce=n;s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();
```

4. **사용 방법**:
   - **PC 크롬**: `https://antigravity.google.com/r/...` 원격 세션 화면에서 북마크바의 **`한글번역`** 클릭 → 약 1초 내 내부 화면이 연결되며 전체 UI 및 Thinking 블록이 한글로 바뀝니다.
   - **모바일 크롬**: 주소창을 탭하고 `한글번역`을 입력한 뒤, 드롭다운에 뜨는 `★ 한글번역` 북마크를 탭하면 즉시 실행됩니다.

---

### 방법 B. Tampermonkey 유저스크립트로 접속 시마다 자동 실행 (PC 크롬 권장)

매번 북마크를 누르지 않고 원격 제어 페이지에 접속할 때마다 자동으로 한글 번역이 켜지게 하려면 **Tampermonkey** 확장프로그램에 등록합니다.

1. 크롬 웹 스토어에서 **Tampermonkey** 설치
2. 크롬 주소창에 `chrome://extensions` 입력 → **우측 상단 `개발자 모드` 켜기** → Tampermonkey **`세부정보`** 클릭 → **`유저 스크립트 허용` (`Allow User Scripts`)** 활성화
3. Tampermonkey 아이콘 클릭 → **`새 스크립트 추가...`** 선택 후 아래 Raw URL의 내용을 붙여넣고 저장(`Ctrl+S`):
   - **설치용 Raw URL**: `https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js`
4. 이제 `https://antigravity.google.com/r/*`에 접속할 때마다 자동으로 한글 번역과 동반 플러그인이 마운트됩니다.

---

### 방법 C. `antigravity-statusbar` (`커스텀바`) 연동 자동 실행

호스트 PC에 `ko-thought-translator`가 설치되어 있으면, 원격 브라우저에서 **`커스텀바`(`antigravity-statusbar`)** 또는 **`MCP 매니저`(`antigravity-mcp-manager`)** 스크립트만 실행해도 호스트에 설치된 플러그인 구성을 자동 감지하여 **한글 번역까지 함께 로드**됩니다. 반대로 **`한글번역`** 북마클릿만 실행해도 호스트 PC에 설치된 `antigravity-statusbar`와 `antigravity-mcp-manager`를 조건부로 자동 동기화합니다.

---

## 2. 데스크톱 앱 설치 및 자동 복구

데스크톱 Antigravity 2.0 앱에서는 한 번 설치해 두면 백그라운드 감시 데몬과 세션 훅이 앱 업데이트·재시작 시에도 패치를 자동으로 유지합니다.

```powershell
# 1. 플러그인 디렉터리에 클론
git clone https://github.com/jaeseongs95/antigravity-ko-translator.git "$HOME\.gemini\config\plugins\ko-thought-translator"

# 2. 패치 즉시 적용 및 백그라운드 감시 데몬 기동
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --worker

# 3. 현재 패치 및 번역 엔진 상태 확인
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --status
```

---

## 3. 번역 설정 및 UI 제어 방법

한글 번역이 켜진 상태(데스크톱 앱 및 원격 브라우저 공통)에서 다음 세 곳을 통해 실시간으로 옵션을 제어할 수 있습니다.

1. **하단 상태바 `[ 번역:구글 ]` / `[ 번역:LLM ]` 버튼** (`antigravity-statusbar` 연동 시):
   - **일반 클릭**: 빠른 설정 모달(`#agy-ko-translator-modal`) 열기/닫기
   - **`Shift + 클릭`**: `Google 번역` ↔ `로컬 LLM` 즉시 전환
2. **좌측 하단 `설정` (`Settings`) → `한글 번역` 전용 탭 및 빠른 설정 모달(`#agy-ko-translator-modal`)**:
   - **번역 엔진 어댑터 선택**: `Google 번역 (google-translate)` (자원 소모 없음, 기본값) / `로컬 LLM (local-llm)` (`127.0.0.1:11434`, 외부 전송 없음)
   - **Thinking 한국어 번역 (`ON/OFF`)**: 추론 본문의 한국어 번역 활성화/비활성화 (비활성화 시 원문 영문 즉시 복원)
   - **Thinking 백그라운드 사전 번역 (`ON/OFF`)**: 접혀 있는 이전 추론 블록 백그라운드 미리 번역
   - **번역 캐시 및 현재 화면 즉시 재번역**: 현재 화면 추론 다시 번역 및 영구 캐시(`localStorage` + `memCache`) 초기화 후 재번역
3. **채팅 입력창 하단 모델 선택 드롭다운 & `설정 > 모양 및 테마(Appearance) > 채팅(Chat)`**:
   - **`Thinking (추론 과정) 표시` (`ON/OFF`)** 전용 토글 스위치가 분리 통합되어 있으며, 네이티브 `대화 단계 표시`(`verboseConversationSteps: 기본값 / 상세히`) 설정은 그대로 보존합니다.

---

## 4. 주요 기능 상세

1. **Port & Adapter 기반 번역 계층 (`google-translate` / `local-llm`)**
   - 인라인 코드(`⟦C0⟧`) 및 식별자·한국어 인용구(`⟦T0⟧`) 보호 토크나이저, 일본어 가나·CJK 한자 혼입 차단, 한국어 받침 조사(`은/는`, `이/가`, `을/를`, `과/와`, `으로/로`) 자동 교정, 스트리밍 디바운스·취소 큐, 영구 캐시(`localStorage` + `memCache`)를 갖추고 있습니다.
   - **`google-translate` (기본값)**: 브라우저/데스크톱 어디서든 로컬 GPU·메모리 소모 없이 즉시 동작합니다. 전환 시 로컬 LLM 프로세스를 자동 종료하여 자원을 반환합니다.
   - **`local-llm`**: 로컬 OpenAI 호환 서버(`http://127.0.0.1:11434`)를 사용해 외부 네트워크 전송 없이 번역합니다.
   - **커스텀 어댑터 확장**: `window.__agyRegisterTranslationAdapter(id, { maxConcurrency, translate })`로 새 번역 엔진을 런타임에 등록할 수 있습니다.

2. **고정 UI 및 위젯 0ms 동기 한글화 (`STATIC_UI_MAP`)**
   - 메뉴바, 사이드바(`새 대화`, `맞춤 설정`, `대화 기록`, `CLI 프로젝트`), 우측 패널(`개요`, `변경사항 검토`, `서브에이전트`, `백그라운드 명령`), 대화 내비게이터(`대화 턴 목록`), 스케줄·크론·서브에이전트·컴팩팅·체크포인트·브라우저 도구 단계, 설정(`일반`, `애플리케이션`, `모양 및 테마`, `단축키`, `알림`, `모델`), 원격 제어 전용 설정(`이 컴퓨터`, `원격`, `브라우저 서브에이전트`), `ask_question` 및 권한 승인 위젯을 네트워크 지연 없이 0ms에 한글화합니다.
   - 상태바(`.agy-ctx-statusbar`), 입력창 모델/권한 컨트롤, 모델 메뉴의 `New` 배지, 사용자 작업공간/폴더명 및 코드 식별자는 원문을 보존합니다.

3. **앱 업데이트 자동 감지 및 무중단 복구**
   - 독립 백그라운드 데몬(`--watch-storage`)이 2초 주기로 `app.asar` 패치 여부와 `DevToolsActivePort` 변경을 감시하여 앱 업데이트 직후 자동으로 재패치하고 Live CDP를 주입합니다.
   - `SessionStart`, `PreInvocation`, `PostInvocation` 훅이 동기(`spawnSync`) 방식으로 패치 무결성을 보장합니다.

---

## 5. CLI 제어 명령

```powershell
# 패치 상태 확인 및 즉시 동기화
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --status
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --worker

# 번역 어댑터 전환 (google-translate | local-llm)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider google-translate
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider local-llm

# Thinking 사전 번역 옵션 전환 (off | on, 기본값: off)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate off
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate on
```

---

## 6. 모듈 구조 (SOLID Architecture)

- **렌더러 계층 (`scripts/renderer/`)**:
  - `01-bootstrap-and-cache.js`: 버전 가드(`v13.29`), `remove-conversation-history: false`(`대화 기록` 메뉴) 자동 활성화, 네이티브 `verboseConversationSteps`(`대화 단계 표시: 기본값/상세히`) 설정 읽기 전용 조회, 비활성화 시 DOM 원본 복원, 번역 캐시(`memCache`/`localStorage`) 관리
  - `02-static-ui-dict.js`: 0ms 정적 UI 한국어 사전(`STATIC_UI_MAP`) 및 동기 패턴 매처
  - `03-text-tokenizer.js`: 코드(`⟦C0⟧`)·식별자/인용구(`⟦T0⟧`) 보호 토크나이저, 조사 교정, 마크다운 세그먼트 추출
  - `04-translation-adapters.js`: Port & Adapter 번역 엔진(`local-llm`, `google-translate`, 커스텀 어댑터) 및 동시성/취소 큐
  - `05-fiber-pretranslator.js`: 영구 설정 로드 및 React Fiber 백그라운드 사전 번역기
  - `06-settings-modal-ui.js`: 스타일시트, Antigravity 2.0 네이티브 설정 모달(`.settings-modal-container`) 및 빠른 설정 모달(`#agy-ko-translator-modal`) UI 통합
  - `07-statusbar-adapter.js`: `antigravity-statusbar` `StatusBarAdapter` (`window.agyStatusBar.registerAdapter` / `unregisterAdapter` / `updateAll`) 순수 어댑터 브릿지
  - `08-dom-observer.js`: 원격 제어 `<ga-remote-control>`(`getDebugNode(rcEl).componentInstance`) 동일 출처 `hubFrame` 브릿지, 호스트 동반 플러그인 조건부 동기화, 스트리밍 Thinking 블록 렌더러, 정적 UI TreeWalker 및 `MutationObserver` 생명주기 관리
- **호스트 계층 (`scripts/host/` & `scripts/ensure_ko_thought_patch.js`)**:
  - `paths.js`: 호스트 경로, 배포 미러(`scripts/`, `dist/`, `plugins/`, `skills/`) 및 환경 상수
  - `ensure_statusbar_patch.js`: 단독 설치 환경을 위한 내장 `app.asar` 및 Live CDP 패처 폴백
  - `local-llm-service.js`: 로컬 LLM 서버 기동·헬스체크·종료(프로세스 트리 정리) 어댑터
  - `settings-storage.js`: `config.json` 정본(SSOT) 및 `app_storage.json` 원자적 동기화와 백그라운드 스토리지 감시 데몬
  - `bundle-injector.js`: `scripts/renderer/*.js` 모듈 조립 및 `statusbar_autoinject.js` 번들(라인·블록 이중 마커 호환) 동기화
  - `ensure_ko_thought_patch.js`: CLI / Hook 오케스트레이터 진입점

---

## 7. 라이선스 (License)

이 프로젝트는 [MIT License](./LICENSE)를 따릅니다.
