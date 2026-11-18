# Antigravity 2.0 한국어 번역기 (`ko-thought-translator`)

> 🌐 **Language**: [English Documentation (README.md)](./README.md) | **한국어**

Antigravity 2.0 데스크톱 앱과 **원격 제어(Remote Control) 웹·모바일 브라우저(`https://antigravity.google.com/r/...`)**에서 스트리밍되는 **Thinking(추론 과정) 본문**(사이드 질문 추론 및 브라우저 서브에이전트 실시간 추론 포함), **작업 단계 요약(`Worked for ...`)**, **앱 전체 정적 UI 메뉴·설정·위젯**을 실시간 한국어로 자동 전환하는 플러그인입니다 (`v2.0.0`). 엄격한 비순환 **헥사고날 CommonJS 아키텍처**(`src/core`, `src/adapters`, `src/remote`, `src/runtime`, `host/`)로 설계되어 소스 코드·Diff·모노스페이스 토큰·사용자 입력 원문을 100% 보호합니다.

---

## 목차

1. [원격 제어(Remote Control) 웹·모바일 브라우저에서 한글 번역 켜는 법](#1-원격-제어remote-control-웹모바일-브라우저에서-한글-번역-켜는-법)
   - [방법 A. 북마크바(북마클릿) 1클릭 실행 (PC & 모바일 크롬 공통)](#방법-a-북마크바북마클릿-1클릭-실행-pc--모바일-크롬-공통)
   - [방법 B. Tampermonkey 유저스크립트로 접속 시마다 자동 실행 (PC 크롬 권장)](#방법-b-tampermonkey-유저스크립트로-접속-시마다-자동-실행-pc-크롬-권장)
   - [방법 C. `antigravity-statusbar` / `antigravity-mcp-manager` 동반 자동 실행](#방법-c-antigravity-statusbar--antigravity-mcp-manager-동반-자동-실행)
2. [데스크톱 앱 설치, 자동 복구 및 원자적 롤백](#2-데스크톱-앱-설치-자동-복구-및-원자적-롤백)
3. [번역 설정, 커스텀 프로바이더 및 UI 제어](#3-번역-설정-커스텀-프로바이더-및-ui-제어)
4. [CLI 제어 명령](#4-cli-제어-명령)
5. [헥사고날 아키텍처 (`v2.0.0`)](#5-헥사고날-아키텍처-v200)
6. [라이선스 (License)](#6-라이선스-license)

---

## 1. 원격 제어(Remote Control) 웹·모바일 브라우저에서 한글 번역 켜는 법

원격 제어 웹(`https://antigravity.google.com/r/...`)은 엄격한 브라우저 보안 정책(CSP3 논스 은닉, `worker-src 'self'`, `require-trusted-types-for 'script'`, 교차 출처 샌드박스 `iframe`)이 적용됩니다. 본 플러그인은 결정론적 유한 상태 기계(`IDLE -> PREFLIGHT -> PROMOTING_BLANK -> BOOTING_WORKBENCH -> READY | ROLLED_BACK | EXTERNAL_PROMOTED`), `0`-인자 `document.open()/close()` URL 상속, `INITIAL_CONFIG` `MessagePort` 리플레이, ECMA-262 라이브 바인딩 ESM/클래식 Worker 브릿지를 통해 안전하게 동일 출처 워크벤치를 기동합니다.

### 방법 A. 북마크바(북마클릿) 1클릭 실행 (PC & 모바일 크롬 공통)

1. 크롬 북마크바 우클릭 → **`페이지 추가...`** 선택
2. **이름**: `한글번역`
3. **URL(주소)**: 아래 한 줄 코드를 그대로 복사해 붙여넣고 저장합니다.

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js?t='+Date.now()).then(r=>r.ok?r.text():'').then(c=>{if(!c)return;try{const s=document.createElement('script'),n=[...document.querySelectorAll('script,style,link')].map(e=>e.nonce||e.getAttribute('nonce')).find(Boolean),t=window.trustedTypes;let u=0,p=null;if(t?.createPolicy){for(const k of['agy-ko-translator-bm','agy-ko-translator'])try{p=t.createPolicy(k,{createScript:x=>{if(u||x!==c)throw new TypeError();u=1;return x}});if(p)break}catch{}if(!p)return}if(n){s.nonce=n;s.setAttribute('nonce',n)}s.text=p?p.createScript(c):c;(document.head||document.documentElement).appendChild(s)}catch{}})})();
```

### 방법 B. Tampermonkey 유저스크립트로 접속 시마다 자동 실행 (PC 크롬 권장)

- **설치용 Raw URL**: `https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/scripts/ko_thought_autoinject.js`

### 방법 C. `antigravity-statusbar` / `antigravity-mcp-manager` 동반 자동 실행

호스트 PC에 `ko-thought-translator`가 설치되어 있으면 원격 브라우저에서 `antigravity-statusbar` 또는 `antigravity-mcp-manager`만 실행해도 한글 번역이 함께 로드되며, 반대로 `한글번역` 북마클릿만 실행해도 호스트에 설치된 동반 플러그인을 조건부로 자동 동기화합니다.

---

## 2. 데스크톱 앱 설치, 자동 복구 및 원자적 롤백

```powershell
# 1. 플러그인 디렉터리에 클론
git clone https://github.com/jaeseongs95/antigravity-ko-translator.git "$HOME\.gemini\config\plugins\ko-thought-translator"

# 2. V6 패치 적용 및 백그라운드 감시 데몬 기동
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --worker

# 3. 읽기 전용 상태 확인
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --status
```

---

## 3. 번역 설정, 커스텀 프로바이더 및 UI 제어

1. **하단 상태바 `[ 번역:구글 ]` / `[ 번역:LLM ]` 버튼**: 일반 클릭으로 `#agy-ko-translator-modal` 열기/닫기, `Shift + 클릭`으로 등록된 번역 어댑터 순환 전환.
2. **`설정` (`Settings`) → `한글 번역` 탭 및 빠른 설정 모달(`#agy-ko-translator-modal`)**:
   - **`google-translate`**, **`local-llm`**(Ollama/OpenAI 호환 엔드포인트·모델·타임아웃·원격 HTTPS 허용 설정), **출신지 로컬 커스텀 HTTP 프로바이더**(`CustomProviderSpec`, 인증 헤더는 오직 브라우저 출처 로컬 `window.localStorage`에만 격리 저장되며 디스크나 공유 번들에 절대 기록되지 않음) 선택·관리.
   - **Thinking 한국어 번역**, **백그라운드 사전 번역**, **캐시 초기화 및 즉시 재번역** 제어.
3. **모델 선택 드롭다운 & `설정 > 모양 및 테마(Appearance) > 채팅(Chat)`**:
   - **`Thinking (추론 과정) 표시` (`ON/OFF`)** 스위치를 제공하며 네이티브 `verboseConversationSteps` 설정은 읽기 전용으로 보존합니다.

---

## 4. CLI 제어 명령

```powershell
# 결정론적 번들 빌드 및 4개 배포 미러 바이트 일치 검증
npm run build
npm run build:check

# 단위 시험(13개 스위트) + 실 Chromium CDP E2E(S0-S5) 통합 실행
npm test

# 호스트 패치, 상태 점검, 어댑터/사전번역 전환, 단독 제거(--uninstall) 및 원자적 원본 복원(--rollback)
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --status
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --worker
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider google-translate
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --provider local-llm
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate off
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --pretranslate on
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --uninstall
node ~/.gemini/config/plugins/ko-thought-translator/scripts/ensure_ko_thought_patch.js --rollback
```

---

## 5. 헥사고날 아키텍처 (`v2.0.0`)

상세 아키텍처 불변식과 시험 명세는 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 및 [`docs/TEST_CASES.md`](./docs/TEST_CASES.md)를 참조하십시오.
- **`src/core/`**: 순수 도메인 계층 (`disposable-registry`, `dictionary-port`, `text-tokenizer`, `provider-registry`, `translation-service`) — DOM/네트워크/벤더 리터럴 0건.
- **`src/adapters/`**: 벤더 중립 `host-adapter-config` 검증기, SSRF 방어 `translators/` (`endpoint-validator`, `google-translate`, `local-llm`, `custom-provider`), `statusbar-port`, `antigravity/` UI·DOM·스토리지·설정·동반 플러그인 어댑터.
- **`src/remote/`**: 벤더 무결 `csp-security-policy`, `asset-url-rewriter`, 3단계 ECMA-262 `js-module-compiler`, `worker-bridge`, `dom-guard-installer`, `workbench-promoter` 유한 상태 기계.
- **`src/runtime/` & `scripts/build.js`**: 매개변수화된 `mount(targetWin, targetDoc)` 컴포지션 루트, `observer-scheduler` 및 결정론적 LF CommonJS 번들러.
- **`host/`**: `cli`, `config-store` (`ko_translator_settings.json` 정본), 암호화 IPC `process-sentinel`, `local-llm-daemon`, `bundle-injector`, 단독 실행형 `AGY_STATUSBAR_AUTOINJECT_V6` `ensure_statusbar_patch`.

---

## 6. 라이선스 (License)

이 프로젝트는 [MIT License](./LICENSE)를 따릅니다.
