// Module: 03-text-tokenizer.js
// Responsibility: Code/identifier/quote placeholder tokenization, Korean particle correction, and Markdown segment extraction.
  function isAlreadyKoreanOrNonEnglish(text) {
    if (!text) return true;
    const trimmed = text.trim();
    if (!trimmed) return true;

    // Strip inline code, Korean quoted strings, placeholders (⟦C0⟧, ⟦T0⟧), URLs, file paths, CLI flags, and code identifiers first.
    // Note: Quotes are matched ONLY when containing Korean (or backticks) so English quoted prose and hyphenated compound words are translated naturally.
    const stripped = trimmed
      .replace(/(?:⟦|\[|【)\s*[CT]\d+\s*(?:⟧|\]|】)/gi, ' ')
      .replace(/`[^`]+`|"(?=[^"\n]*[가-힣])[^"\n]{1,140}"|“(?=[^”\n]*[가-힣])[^”\n]{1,140}”|(?<![A-Za-z0-9⟧])'(?=[^'\n]*[가-힣])[^'\n]{1,80}'(?![A-Za-z0-9])|\bhttps?:\/\/\S+/g, ' ')
      .replace(/\b[A-Za-z0-9_.-]+\.(?:md|js|mjs|cjs|ts|tsx|json|jsonl|py|sh|ps1|yaml|yml|toml|html|css|asar|exe|lock)\b/g, ' ')
      .replace(/(?:--[a-z0-9-]+)|\b(?:[A-Z0-9]+-[A-Za-z0-9-]+|[a-z]+-[0-9][a-z0-9-]*)\b|\b[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g, ' ');

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
    const protectedText = text.replace(
      /(`[^`]+`|"(?=[^"\n]*[가-힣])[^"\n]{1,140}"|“(?=[^”\n]*[가-힣])[^”\n]{1,140}”|(?<![A-Za-z0-9⟧])'(?=[^'\n]*[가-힣])[^'\n]{1,80}'(?![A-Za-z0-9])|\bhttps?:\/\/\S+|\b[A-Za-z0-9_.-]+\.(?:md|js|mjs|cjs|ts|tsx|json|jsonl|py|sh|ps1|yaml|yml|toml|html|css|asar|exe|lock)\b|(?:--[a-z0-9-]+)|\b(?:[A-Z0-9]+-[A-Za-z0-9-]+|[a-z]+-[0-9][a-z0-9-]*)\b|\b[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b)/g,
      (match) => {
        const idx = savedTokens.length;
        savedTokens.push(match);
        return `⟦T${idx}⟧`;
      }
    );
    return { protectedText, savedTokens };
  }

  function restoreIdentifiersInThoughtText(translatedText, savedTokens) {
    if (!savedTokens.length) return translatedText;
    const restored = translatedText.replace(/(?:⟦|\[|【)\s*T(\d+)\s*(?:⟧|\]|】)/gi, (full, num) => {
      const idx = parseInt(num, 10);
      return savedTokens[idx] !== undefined ? savedTokens[idx] : full;
    });
    return restored.replace(
      /([가-힣])(['"”’⟧\]】]*)(와|과|를|을|가|이|는|은)(?=$|[\s.,;:!?)])/g,
      (full, lastKo, closingQuote, particle) => {
        const code = lastKo.charCodeAt(0);
        if (code < 0xac00 || code > 0xd7a3) return full;
        const hasJong = (code - 0xac00) % 28 !== 0;
        const map = {
          와: hasJong ? '과' : '와',
          과: hasJong ? '과' : '와',
          를: hasJong ? '을' : '를',
          을: hasJong ? '을' : '를',
          가: hasJong ? '이' : '가',
          이: hasJong ? '이' : '가',
          는: hasJong ? '은' : '는',
          은: hasJong ? '은' : '는',
        };
        return lastKo + closingQuote + (map[particle] || particle);
      }
    );
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
    let match;
    while ((match = regex.exec(translatedText)) !== null) {
      if (match.index > lastIndex) {
        out.appendChild(document.createTextNode(translatedText.slice(lastIndex, match.index)));
      }
      const idx = parseInt(match[1], 10);
      if (savedCodes[idx]) {
        out.appendChild(savedCodes[idx].cloneNode(true));
      } else {
        out.appendChild(document.createTextNode(match[0]));
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < translatedText.length) {
      out.appendChild(document.createTextNode(translatedText.slice(lastIndex)));
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
