# Release Notes — `v2.4.0`

## English

### Public HTTPS Modular Userscript & CSP/CORS-Resilient Transport
- **1-Click Public HTTPS Userscript Release**: Publishes deterministic, Acorn-AST-verified `ko-thought-translator.user.js` and `ko-thought-translator.meta.js` built with `antigravity-addons v2.8.0` (`--build-addon-userscript --grant-xhr --connect translate.googleapis.com`).
  - Install directly from anywhere (mobile or desktop, zero private IP / zero home PC server):
    `https://github.com/jaeseongs95/antigravity-ko-translator/releases/latest/download/ko-thought-translator.user.js`
  - Automatically `@require`s `https://github.com/jaeseongs95/antigravity-addons/releases/latest/download/antigravity-remote-host.lib.js` and coexists cleanly with other modular Userscripts (`antigravity-statusbar.user.js`, etc.) inside a single Shadow-DOM drawer.
- **Userscript `GM_xmlhttpRequest` Adapter (`src/adapters/translators/gm-fetch.js`)**:
  - Routes `https:` translation requests through `GM_xmlhttpRequest` / `GM.xmlHttpRequest` inside Userscript sandboxes to avoid page CSP `connect-src` or CORS blocks on `https://antigravity.google.com`.
  - Preserves `AbortSignal` cancellation (`req.abort()`) and `anonymous: true` (`credentials: 'omit'`), while keeping Desktop Electron and local loopback HTTP (`http://127.0.0.1:11434`) on standard `fetch`.
- **Hexagonal & Security Invariants Preserved**:
  - Zero `src/core/` or `src/runtime/` vendor/DOM coupling, zero HTML sinks, zero `eval`, zero `app.asar` access, and 0 new runtime dependencies.

---

## 한국어

### 공개 HTTPS 모듈형 Userscript 배포 및 CSP/CORS 내성 전송 어댑터
- **1클릭 공개 HTTPS Userscript 릴리즈**: `antigravity-addons v2.8.0`의 `--build-addon-userscript --grant-xhr --connect translate.googleapis.com`으로 생성한 결정적·Acorn AST 무위반 `ko-thought-translator.user.js` 및 `ko-thought-translator.meta.js`를 배포합니다.
  - 사설 IP나 집 PC 서버 없이 모바일/PC 어디서나 1클릭 설치 및 자동 업데이트:
    `https://github.com/jaeseongs95/antigravity-ko-translator/releases/latest/download/ko-thought-translator.user.js`
  - 공용 호스트 라이브러리(`antigravity-remote-host.lib.js`)를 `@require`로 자동 로드하며 `antigravity-statusbar.user.js` 등 다른 모듈형 Userscript와 단일 Shadow-DOM Drawer에서 충돌 없이 공존합니다.
- **Userscript `GM_xmlhttpRequest` 어댑터 (`src/adapters/translators/gm-fetch.js`)**:
  - `https://antigravity.google.com`의 페이지 CSP `connect-src`·CORS 제약을 우회하도록 Userscript 샌드박스에서 `https:` 번역 요청을 `GM_xmlhttpRequest`(`GM.xmlHttpRequest`)로 자동 라우팅합니다.
  - `AbortSignal` 취소와 `anonymous: true`를 준수하며, 데스크톱 앱과 로컬 루프백 HTTP(`http://127.0.0.1:11434`)에서는 기존 `fetch`를 그대로 사용합니다.
- **헥사고날 아키텍처 및 보안 불변조건 유지**:
  - `src/core/`·`src/runtime/` 벤더/DOM 비종속성, HTML sink 0건, `eval` 0건, `app.asar` 무접촉, 신규 런타임 의존성 0건을 유지했습니다.
