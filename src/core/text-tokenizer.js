'use strict';

const PLACEHOLDER_TOKEN_REGEX = /(?:⟦|\[|【)\s*[CT]\d+\s*(?:⟧|\]|】)/gi;
const INLINE_BACKTICK_CODE_REGEX = /(`+)([^\n]*?)\1/g;
const QUOTED_KO_AND_URL_REGEX =
  /"(?=[^"\n]*[가-힣])[^"\n]{1,140}"|“(?=[^”\n]*[가-힣])[^”\n]{1,140}”|(?<![A-Za-z0-9⟧])'(?=[^'\n]*[가-힣])[^'\n]{1,80}'(?![A-Za-z0-9])|\bhttps?:\/\/\S+/g;
const FILE_EXT_PATH_REGEX =
  /\b[A-Za-z0-9_.-]+\.(?:md|js|mjs|cjs|ts|tsx|json|jsonl|py|sh|ps1|yaml|yml|toml|html|css|asar|exe|lock)\b/g;
const CLI_AND_IDENTIFIER_REGEX =
  /(?:--[a-z0-9-]+)|\b(?:[A-Z0-9]+-[A-Za-z0-9-]+|[a-z]+-[0-9][a-z0-9-]*)\b|\b[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const PROTECT_NON_CODE_IDENTIFIERS_REGEX =
  /("(?=[^"\n]*[가-힣])[^"\n]{1,140}"|“(?=[^”\n]*[가-힣])[^”\n]{1,140}”|(?<![A-Za-z0-9⟧])'(?=[^'\n]*[가-힣])[^'\n]{1,80}'(?![A-Za-z0-9])|\bhttps?:\/\/\S+|\b[A-Za-z0-9_.-]+\.(?:md|js|mjs|cjs|ts|tsx|json|jsonl|py|sh|ps1|yaml|yml|toml|html|css|asar|exe|lock)\b|(?:--[a-z0-9-]+)|\b(?:[A-Z0-9]+-[A-Za-z0-9-]+|[a-z]+-[0-9][a-z0-9-]*)\b|\b[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b)/g;
const RESTORE_TOKEN_WITH_PARTICLE_REGEX =
  /(?:⟦|\[|【)\s*T(\d+)\s*(?:⟧|\]|】)(?:(\(으\)로|\(을\)를|\(이\)가|\(은\)는|\(과\)와|으로|로|와|과|를|을|가|이|는|은)(?=$|[\s.,;:!?)]))?/gi;
const QUOTED_KOREAN_PARTICLE_REGEX =
  /([가-힣A-Za-z0-9_.-]+)(['"`”’⟧\]】]+)(\(으\)로|\(을\)를|\(이\)가|\(은\)는|\(과\)와|으로|로|와|과|를|을|가|이|는|은)(?=$|[\s.,;:!?)])/g;

function selectKoreanParticleByJongseong(jong, particle) {
  if (jong === null || jong === undefined) {
    switch (particle) {
      case '(과)와':
        return '와';
      case '(을)를':
        return '를';
      case '(이)가':
        return '가';
      case '(은)는':
        return '는';
      case '(으)로':
        return '로';
      default:
        return particle;
    }
  }
  const hasJong = jong !== 0;
  const isRieul = jong === 8;
  switch (particle) {
    case '와':
    case '과':
    case '(과)와':
      return hasJong ? '과' : '와';
    case '를':
    case '을':
    case '(을)를':
      return hasJong ? '을' : '를';
    case '가':
    case '이':
    case '(이)가':
      return hasJong ? '이' : '가';
    case '는':
    case '은':
    case '(은)는':
      return hasJong ? '은' : '는';
    case '로':
    case '으로':
    case '(으)로':
      return !hasJong || isRieul ? '로' : '으로';
    default:
      return particle;
  }
}

function resolveEnglishWordJongseong(word) {
  if (!word) return null;
  const isShortUpperInitialism =
    /^[A-Z]{1,3}$/.test(word) &&
    !/^(?:APP|MAP|TOP|POP|TIP|ZIP|PIP|GET|SET|LET|NET|GIT|DOT|BOT|CUT|PUT|CAT|BAT|HAT|RAT|SAT|FAT|MAT|PAT|TAB|JOB|WEB|SUB|DOC|MAC)$/.test(
      word
    );
  if (word.length === 1 || !/[AEIOUYaeiouy]/.test(word) || isShortUpperInitialism) {
    const lastUpper = word[word.length - 1].toUpperCase();
    if (lastUpper === 'L' || lastUpper === 'R') return 8;
    if (lastUpper === 'M' || lastUpper === 'N') return 1;
    return 0;
  }

  const lower = word.toLowerCase();
  if (/[aeiouwy]$/.test(lower)) return 0;
  if (lower.endsWith('e')) {
    if (lower.endsWith('le')) return 8;
    if (/[mn]e$/.test(lower) || lower === 'type') return 1;
    return 0;
  }
  if (lower.endsWith('l')) return 8;
  if (lower.endsWith('m') || lower.endsWith('n')) return 1;
  if (lower.endsWith('ng')) return 1;
  if (/(?:ck|[aiou]k)$/.test(lower) && !/(?:eak|oak)$/.test(lower)) return 1;
  if (/[aeiou]c$/.test(lower)) return 1;
  if (/(?:pp|[aeiou]p)$/.test(lower)) return 1;
  if (/(?:^|[^aeiou])[aeiou]t$/.test(lower) || /(?:out|cut|put)$/.test(lower)) return 1;
  if (/(?:bb|[aeiou]b)$/.test(lower)) return 1;
  return 0;
}

function resolveLastHangulJongseong(tokenText) {
  if (!tokenText) return null;
  const stripped = String(tokenText).replace(/['"`”’⟧\]】)}\/\s]+$/g, '');
  if (!stripped) return null;
  const lastCh = stripped[stripped.length - 1];
  const code = lastCh.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28;
  }
  if (lastCh >= '0' && lastCh <= '9') {
    if (lastCh === '1' || lastCh === '7' || lastCh === '8') return 8;
    if (lastCh === '0' || lastCh === '3' || lastCh === '6') return 1;
    return 0;
  }
  const alphaMatch = stripped.match(/([A-Za-z]+)$/);
  if (alphaMatch) {
    return resolveEnglishWordJongseong(alphaMatch[1]);
  }
  return null;
}

function isAlreadyKoreanOrNonEnglish(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;

  const stripped = trimmed
    .replace(PLACEHOLDER_TOKEN_REGEX, ' ')
    .replace(INLINE_BACKTICK_CODE_REGEX, ' ')
    .replace(QUOTED_KO_AND_URL_REGEX, ' ')
    .replace(FILE_EXT_PATH_REGEX, ' ')
    .replace(CLI_AND_IDENTIFIER_REGEX, ' ');

  const koCount = (stripped.match(/[가-힣]/g) || []).length;
  const enWords = stripped.match(/[A-Za-z]{2,}/g) || [];
  const enCharCount = enWords.reduce((acc, w) => acc + w.length, 0);

  if (enWords.length < 2) return true;
  if (koCount >= 2 && koCount >= enCharCount * 0.25) return true;
  return false;
}

function isInvalidCachedOrTranslatedText(translated, sourceText) {
  if (!translated || typeof translated !== 'string') return true;
  const t = translated.trim();
  if (!t || !/[가-힣]/.test(t)) return true;
  const src = String(sourceText || '');
  const cjkKanaMatches = t.match(/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g);
  if (cjkKanaMatches && cjkKanaMatches.some((ch) => !src.includes(ch))) {
    return true;
  }
  if (/'(?:s|m|re|ve|ll|d|t)\b[^'\n]+'/i.test(t)) {
    return true;
  }
  if (/(?:⟦|\[|【)\s*T\d+\s*(?:⟧|\]|】)/i.test(t)) {
    return true;
  }
  const srcCodeTokens = src.match(/⟦C\d+⟧/g);
  if (srcCodeTokens) {
    for (const tok of srcCodeTokens) {
      const num = tok.slice(2, -1);
      const tokRe = new RegExp(`(?:⟦|\\[|【)\\s*C${num}\\s*(?:⟧|\\]|】)`, 'i');
      if (!tokRe.test(t)) return true;
    }
  }
  return false;
}

function protectIdentifiersInThoughtText(text) {
  const savedTokens = [];
  const stepOne = String(text || '').replace(INLINE_BACKTICK_CODE_REGEX, (match) => {
    const idx = savedTokens.length;
    savedTokens.push(match);
    return `⟦T${idx}⟧`;
  });
  const protectedText = stepOne.replace(PROTECT_NON_CODE_IDENTIFIERS_REGEX, (match) => {
    const idx = savedTokens.length;
    savedTokens.push(match);
    return `⟦T${idx}⟧`;
  });
  return { protectedText, savedTokens };
}

function fixQuotedKoreanParticles(text) {
  if (!text) return text;
  return String(text).replace(QUOTED_KOREAN_PARTICLE_REGEX, (full, innerToken, closingQuote, particle) => {
    const jong = resolveLastHangulJongseong(innerToken);
    if (jong === null) return full;
    return innerToken + closingQuote + selectKoreanParticleByJongseong(jong, particle);
  });
}

function restoreIdentifiersInThoughtText(translatedText, savedTokens) {
  if (!translatedText) return translatedText;
  const tokens = Array.isArray(savedTokens) ? savedTokens : [];
  const restored = tokens.length
    ? String(translatedText).replace(RESTORE_TOKEN_WITH_PARTICLE_REGEX, (full, num, particle) => {
        const idx = parseInt(num, 10);
        if (tokens[idx] === undefined) return full;
        const tokenStr = tokens[idx];
        if (!particle) return tokenStr;
        const jong = resolveLastHangulJongseong(tokenStr);
        return tokenStr + selectKoreanParticleByJongseong(jong, particle);
      })
    : String(translatedText);
  return fixQuotedKoreanParticles(restored);
}

function normalizeMarkdownSegmentToTokenizedText(seg) {
  let s = String(seg || '').trim();
  if (!s) return '';
  s = s.replace(/^#{1,6}\s+/, '');
  let codeIdx = 0;
  s = s.replace(INLINE_BACKTICK_CODE_REGEX, () => `⟦C${codeIdx++}⟧`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  return s.trim();
}

function extractTokenizedSegmentsFromMarkdown(rawThinking) {
  const out = [];
  const blocks = String(rawThinking || '')
    .trim()
    .split(/\n\s*\n+/);
  for (const blk of blocks) {
    const trimmed = blk.trim();
    if (!trimmed || trimmed.startsWith('```')) continue;
    const lines = trimmed.split(/\r?\n/);
    const isList = lines.every((l) => /^\s*(?:[-*+]|\d+\.)\s+/.test(l));
    if (isList) {
      for (const line of lines) {
        const itemBody = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
        const tok = normalizeMarkdownSegmentToTokenizedText(itemBody);
        if (tok && !isAlreadyKoreanOrNonEnglish(tok)) out.push(tok);
      }
    } else {
      const tok = normalizeMarkdownSegmentToTokenizedText(trimmed);
      if (tok && !isAlreadyKoreanOrNonEnglish(tok)) out.push(tok);
    }
  }
  return out;
}

module.exports = {
  selectKoreanParticleByJongseong,
  resolveEnglishWordJongseong,
  resolveLastHangulJongseong,
  isAlreadyKoreanOrNonEnglish,
  isInvalidCachedOrTranslatedText,
  protectIdentifiersInThoughtText,
  fixQuotedKoreanParticles,
  restoreIdentifiersInThoughtText,
  normalizeMarkdownSegmentToTokenizedText,
  extractTokenizedSegmentsFromMarkdown,
};
