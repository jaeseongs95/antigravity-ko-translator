# Release `vX.Y.Z` (`KO_LOCALIZER_VERSION vM.N`)

## English

### Summary

Concise overview of compatibility updates, defect resolutions, security hardening, and architectural refinements included in `vX.Y.Z`.

### Highlights & Defect Fixes

- **`D-XXXX` — <Short Title>**: <Root cause resolved at `<file>:<line>` and user-observable runtime behavior verified.>

### Compatibility & Verification

- **Target Runtime**: Antigravity `v2.x` Desktop (`app.asar` + Live CDP) and Remote Control Web (`https://antigravity.google.com/r/...`)
- **Automated Verification**: `npm test` (`node --test test/ko-translator.test.js`) and GitHub Actions CI (`ubuntu-latest`, Node.js 22)

### Upgrade Instructions

```powershell
git -C "$HOME\.gemini\config\plugins\ko-thought-translator" pull --ff-only
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js"
```

---

## 한국어 (Korean)

### 요약

`vX.Y.Z`에 포함된 Antigravity 런타임 호환성 개선, 결함 근본 수정, 보안 강화 및 아키텍처 정비 내역을 요약합니다.

### 주요 변경 사항 및 결함 수정

- **`D-XXXX` — <결함 요약 제목>**: `<파일>:<줄>`의 근본 원인을 수정하고 실제 실행 경로에서 재현·검증한 결과를 기술합니다.

### 호환성 및 검증

- **지원 런타임**: Antigravity `v2.x` 데스크톱(`app.asar` + Live CDP) 및 Remote Control 웹(`https://antigravity.google.com/r/...`)
- **자동화 검증**: `npm test` (`node --test test/ko-translator.test.js`) 및 GitHub Actions CI (`ubuntu-latest`, Node.js 22)

### 업그레이드 안내

```powershell
git -C "$HOME\.gemini\config\plugins\ko-thought-translator" pull --ff-only
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js"
```
