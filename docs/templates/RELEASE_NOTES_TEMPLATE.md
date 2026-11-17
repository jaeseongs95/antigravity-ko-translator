# Release `vX.Y.Z` (`KO_LOCALIZER_VERSION vM.N`)

## Summary

Concise overview of compatibility updates, defect fixes, and architectural improvements included in `vX.Y.Z`.

## Highlights & Defect Fixes

- **`D-XXXX` — <Short Title>**: <Root cause fixed and user-observable behavior verified.>

## Compatibility & Verification

- **Target Runtime**: Antigravity `v2.x` Desktop (`app.asar` + Live CDP) and Remote Control Web (`https://antigravity.google.com/r/...`)
- **Automated Verification**: `npm test` (`node --test test/ko-translator.test.js`) and GitHub Actions CI (`ubuntu-latest`, Node.js 22)

## Upgrade Instructions

```powershell
git -C "$HOME\.gemini\config\plugins\ko-thought-translator" pull --ff-only
node "$HOME\.gemini\config\plugins\ko-thought-translator\scripts\ensure_ko_thought_patch.js" --worker
```
