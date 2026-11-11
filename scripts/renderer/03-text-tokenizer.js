// Module: 03-text-tokenizer.js
// Responsibility: Code/identifier/quote placeholder tokenization, Korean particle correction, and Markdown segment extraction.
  const PLACEHOLDER_TOKEN_REGEX = /(?:⟦|\[|【)\s*[CT]\d+\s*(?:⟧|\]|】)/gi;
  const CODE_AND_QUOTED_KO_REGEX =
    /`[^`]+`|"(?=[^"\n]*[가-힣])[^"\n]{1,140}"|“(?=[^”\n]*[가-힣])[^”\n]{1,140}”|(?<![A-Za-z0-9⟧])'(?=[^'\n]*[가-힣])[^'\n]{1,80}'(?![A-Za-z0-9])|\bhttps?:\/\/\S+/g;
  const FILE_EXT_PATH_REGEX =
    /\b[A-Za-z0-9_.-]+\.(?:md|js|mjs|cjs|ts|tsx|json|jsonl|py|sh|ps1|yaml|yml|toml|html|css|asar|exe|lock)\b/g;
  const CLI_AND_IDENTIFIER_REGEX =
    /(?:--[a-z0-9-]+)|\b(?:[A-Z0-9]+-[A-Za-z0-9-]+|[a-z]+-[0-9][a-z0-9-]*)\b|\b[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
  const PROTECT_IDENTIFIERS_REGEX =
    /(`[^`]+`|"(?=[^"\n]*[가-힣])[^"\n]{1,140}"|“(?=[^”\n]*[가-힣])[^”\n]{1,140}”|(?<![A-Za-z0-9⟧])'(?=[^'\n]*[가-힣])[^'\n]{1,80}'(?![A-Za-z0-9])|\bhttps?:\/\/\S+|\b[A-Za-z0-9_.-]+\.(?:md|js|mjs|cjs|ts|tsx|json|jsonl|py|sh|ps1|yaml|yml|toml|html|css|asar|exe|lock)\b|(?:--[a-z0-9-]+)|\b(?:[A-Z0-9]+-[A-Za-z0-9-]+|[a-z]+-[0-9][a-z0-9-]*)\b|\b[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b)/g;
  const RESTORE_TOKEN_REGEX = /(?:⟦|\[|【)\s*T(\d+)\s*(?:⟧|\]|】)/gi;
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
    if (!text) return true;
    const trimmed = text.trim();
    if (!trimmed) return true;

    // Strip inline code, Korean quoted strings, placeholders (⟦C0⟧, ⟦T0⟧), URLs, file paths, CLI flags, and code identifiers first.
    // Note: Quotes are matched ONLY when containing Korean (or backticks) so English quoted prose and hyphenated compound words are translated naturally.
    const stripped = trimmed
      .replace(PLACEHOLDER_TOKEN_REGEX, ' ')
      .replace(CODE_AND_QUOTED_KO_REGEX, ' ')
      .replace(FILE_EXT_PATH_REGEX, ' ')
      .replace(CLI_AND_IDENTIFIER_REGEX, ' ');

    const koCount = (stripped.match(/[가-힣]/g) || []).length;
    const enWords = stripped.match(/[A-Za-z]{2,}/g) || [];
    const enCharCount = enWords.reduce((acc, w) => acc + w.length, 0);

    if (enWords.length < 2) return true;
    // If surrounding prose outside quotes/code has Korean characters (>= 25% of English chars), it is already Korean prose
    if (koCount >= 2 && koCount >= enCharCount * 0.25) return true;

    return false;
  }

  // Protects backtick code, Korean quoted strings, CLI flags, uppercase/numeric IDs (e.g. AGS-D-0281, SHA-256), snake_case, camelCase, file paths, and URLs
  function protectIdentifiersInThoughtText(text) {
    const savedTokens = [];
    const protectedText = text.replace(PROTECT_IDENTIFIERS_REGEX, (match) => {
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
    const restored = savedTokens.length
      ? translatedText.replace(RESTORE_TOKEN_WITH_PARTICLE_REGEX, (full, num, particle) => {
          const idx = parseInt(num, 10);
          if (savedTokens[idx] === undefined) return full;
          const tokenStr = savedTokens[idx];
          if (!particle) return tokenStr;
          const jong = resolveLastHangulJongseong(tokenStr);
          return tokenStr + selectKoreanParticleByJongseong(jong, particle);
        })
      : translatedText;
    return fixQuotedKoreanParticles(restored);
  }

  function tokenizeBlockClone(origEl) {
    const clone = origEl.cloneNode(true);
    const codeNodes = Array.from(clone.querySelectorAll('code'));
    const savedCodes = [];

    for (let i = 0; i < codeNodes.length; i++) {
      const c = codeNodes[i];
      savedCodes.push(c.cloneNode(true));
      const placeholder = document.createTextNode(`⟦C${i}⟧`);
      c.parentNode.replaceChild(placeholder, c);
    }

    const tokenizedText = (clone.textContent || '').trim();
    return { tokenizedText, savedCodes };
  }

  function buildTranslatedElement(origEl, savedCodes, translatedText) {
    const out = origEl.cloneNode(false);
    if (savedCodes.length === 0) {
      out.textContent = translatedText;
      return out;
    }

    const regex = /(?:⟦|\[|【)\s*C(\d+)\s*(?:⟧|\]|】)/gi;
    let lastIndex = 0;
    let prevRestoredCodeText = null;
    const appendTrailingSegment = (segText) => {
      if (!segText) return;
      let adjusted = segText;
      if (prevRestoredCodeText) {
        const jong = resolveLastHangulJongseong(prevRestoredCodeText);
        adjusted = adjusted.replace(
          /^(\(으\)로|\(을\)를|\(이\)가|\(은\)는|\(과\)와|으로|로|와|과|를|을|가|이|는|은)(?=$|[\s.,;:!?)])/,
          (m) => selectKoreanParticleByJongseong(jong, m)
        );
      }
      out.appendChild(document.createTextNode(adjusted));
      prevRestoredCodeText = null;
    };

    let match;
    while ((match = regex.exec(translatedText)) !== null) {
      if (match.index > lastIndex) {
        appendTrailingSegment(translatedText.slice(lastIndex, match.index));
      } else {
        prevRestoredCodeText = null;
      }
      const idx = parseInt(match[1], 10);
      if (savedCodes[idx]) {
        const codeClone = savedCodes[idx].cloneNode(true);
        out.appendChild(codeClone);
        prevRestoredCodeText = codeClone.textContent || '';
      } else {
        out.appendChild(document.createTextNode(match[0]));
        prevRestoredCodeText = null;
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < translatedText.length) {
      appendTrailingSegment(translatedText.slice(lastIndex));
    }
    return out;
  }

  function normalizeMarkdownSegmentToTokenizedText(seg) {
    let s = String(seg || '').trim();
    if (!s) return '';
    s = s.replace(/^#{1,6}\s+/, '');
    let codeIdx = 0;
    s = s.replace(/`([^`\n]+)`/g, () => `⟦C${codeIdx++}⟧`);
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
