'use strict';

const JS_REGEX_PREFIX_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'delete',
  'void',
  'typeof',
  'await',
  'yield',
  'in',
  'instanceof',
  'of',
  'new',
  'else',
  'do',
  'export',
  'default',
]);

const JS_HEADER_PAREN_KEYWORDS = new Set(['if', 'for', 'while', 'with', 'catch']);

const JS_RESERVED_KEYWORDS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

function isIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || ch === '$';
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function lexJsTokens(source) {
  const src = String(source ?? '');
  const tokens = [];
  const braceStack = [];
  const parenStack = [];
  let regexAllowed = true;
  let prevHeaderKw = false;
  let i = 0;

  const emit = (type, value, start, end) => {
    tokens.push({ type, value, start, end });
  };

  const scanTemplateChunk = (chunkStart, openPrefix) => {
    let k = chunkStart;
    while (k < src.length) {
      if (src[k] === '\\') {
        k += 2;
        continue;
      }
      if (src[k] === '$' && src[k + 1] === '{') {
        emit('template_head', `${openPrefix}${src.slice(chunkStart, k)}\${`, chunkStart - openPrefix.length, k + 2);
        braceStack.push('template');
        regexAllowed = true;
        prevHeaderKw = false;
        i = k + 2;
        return;
      }
      if (src[k] === '`') {
        emit('template_tail', `${openPrefix}${src.slice(chunkStart, k)}\``, chunkStart - openPrefix.length, k + 1);
        regexAllowed = false;
        prevHeaderKw = false;
        i = k + 1;
        return;
      }
      k++;
    }
    emit('template_tail', `${openPrefix}${src.slice(chunkStart, k)}`, chunkStart - openPrefix.length, k);
    regexAllowed = false;
    prevHeaderKw = false;
    i = k;
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      let j = i + 1;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r' || src[j] === '\n')) j++;
      emit('ws', src.slice(i, j), i, j);
      i = j;
      continue;
    }

    if (ch === '/' && next === '/') {
      const nl = src.indexOf('\n', i + 2);
      const end = nl === -1 ? src.length : nl;
      emit('comment', src.slice(i, end), i, end);
      i = end;
      continue;
    }

    if (ch === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      emit('comment', src.slice(i, end), i, end);
      i = end;
      continue;
    }

    if (ch === '/' && regexAllowed && next !== '=') {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const rc = src[j];
        if (rc === '\\') {
          j += 2;
          continue;
        }
        if (rc === '[' && !inClass) {
          inClass = true;
          j++;
          continue;
        }
        if (rc === ']' && inClass) {
          inClass = false;
          j++;
          continue;
        }
        if (rc === '/' && !inClass) {
          j++;
          break;
        }
        if (rc === '\n' || rc === '\r') break;
        j++;
      }
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
      emit('regex', src.slice(i, j), i, j);
      regexAllowed = false;
      prevHeaderKw = false;
      i = j;
      continue;
    }

    if (ch === '\'' || ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      emit('string', src.slice(i, j), i, j);
      regexAllowed = false;
      prevHeaderKw = false;
      i = j;
      continue;
    }

    if (ch === '`') {
      scanTemplateChunk(i + 1, '`');
      continue;
    }

    if (isIdentStart(ch) || (ch === '#' && isIdentStart(next))) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j])) j++;
      const word = src.slice(i, j);
      let prevSigIdx = tokens.length - 1;
      while (prevSigIdx >= 0 && (tokens[prevSigIdx].type === 'ws' || tokens[prevSigIdx].type === 'comment')) {
        prevSigIdx--;
      }
      const prevSig = prevSigIdx >= 0 ? tokens[prevSigIdx] : null;
      const isAfterDot = prevSig && (prevSig.value === '.' || prevSig.value === '?.');
      emit(word[0] === '#' ? 'private_ident' : 'ident', word, i, j);
      if (!isAfterDot && JS_REGEX_PREFIX_KEYWORDS.has(word)) {
        regexAllowed = true;
        prevHeaderKw = false;
      } else if (!isAfterDot && JS_HEADER_PAREN_KEYWORDS.has(word)) {
        regexAllowed = false;
        prevHeaderKw = true;
      } else {
        regexAllowed = false;
        prevHeaderKw = false;
      }
      i = j;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || (ch === '.' && next >= '0' && next <= '9')) {
      let j = i + 1;
      while (j < src.length && /[0-9A-Za-z_.]/.test(src[j])) {
        if ((src[j] === 'e' || src[j] === 'E') && (src[j + 1] === '+' || src[j + 1] === '-')) {
          j += 2;
          continue;
        }
        j++;
      }
      emit('number', src.slice(i, j), i, j);
      regexAllowed = false;
      prevHeaderKw = false;
      i = j;
      continue;
    }

    if (ch === '(') {
      parenStack.push(prevHeaderKw);
      prevHeaderKw = false;
      regexAllowed = true;
      emit('punct', '(', i, i + 1);
      i++;
      continue;
    }

    if (ch === ')') {
      const afterCloseRegex = Boolean(parenStack.pop());
      prevHeaderKw = false;
      regexAllowed = afterCloseRegex;
      emit('punct', ')', i, i + 1);
      i++;
      continue;
    }

    if (ch === '{') {
      braceStack.push('block');
      prevHeaderKw = false;
      regexAllowed = true;
      emit('punct', '{', i, i + 1);
      i++;
      continue;
    }

    if (ch === '}') {
      const kind = braceStack.pop();
      if (kind === 'template') {
        scanTemplateChunk(i + 1, '}');
        continue;
      }
      prevHeaderKw = false;
      regexAllowed = true;
      emit('punct', '}', i, i + 1);
      i++;
      continue;
    }

    if (ch === ']') {
      prevHeaderKw = false;
      regexAllowed = false;
      emit('punct', ']', i, i + 1);
      i++;
      continue;
    }

    // Multi-char punctuators (longest first)
    const fourChar = src.slice(i, i + 4);
    if (fourChar === '>>>=') {
      emit('punct', fourChar, i, i + 4);
      prevHeaderKw = false;
      regexAllowed = true;
      i += 4;
      continue;
    }
    const threeChar = src.slice(i, i + 3);
    if (
      threeChar === '...' ||
      threeChar === '===' ||
      threeChar === '!==' ||
      threeChar === '>>>' ||
      threeChar === '<<=' ||
      threeChar === '>>=' ||
      threeChar === '**=' ||
      threeChar === '&&=' ||
      threeChar === '||=' ||
      threeChar === '??='
    ) {
      emit('punct', threeChar, i, i + 3);
      prevHeaderKw = false;
      regexAllowed = true;
      i += 3;
      continue;
    }
    const twoChar = src.slice(i, i + 2);
    if (twoChar === '++' || twoChar === '--') {
      emit('punct', twoChar, i, i + 2);
      prevHeaderKw = false;
      regexAllowed = false;
      i += 2;
      continue;
    }
    if (twoChar === '?.') {
      emit('punct', twoChar, i, i + 2);
      prevHeaderKw = false;
      regexAllowed = false;
      i += 2;
      continue;
    }
    if (
      twoChar === '=>' ||
      twoChar === '==' ||
      twoChar === '!=' ||
      twoChar === '<=' ||
      twoChar === '>=' ||
      twoChar === '&&' ||
      twoChar === '||' ||
      twoChar === '??' ||
      twoChar === '**' ||
      twoChar === '<<' ||
      twoChar === '>>' ||
      twoChar === '+=' ||
      twoChar === '-=' ||
      twoChar === '*=' ||
      twoChar === '/=' ||
      twoChar === '%=' ||
      twoChar === '&=' ||
      twoChar === '|=' ||
      twoChar === '^='
    ) {
      emit('punct', twoChar, i, i + 2);
      prevHeaderKw = false;
      regexAllowed = true;
      i += 2;
      continue;
    }

    if (ch === '.') {
      emit('punct', '.', i, i + 1);
      prevHeaderKw = false;
      regexAllowed = false;
      i++;
      continue;
    }

    emit('punct', ch, i, i + 1);
    prevHeaderKw = false;
    regexAllowed = true;
    i++;
  }

  return tokens;
}

function unquoteJsStringLiteral(lit) {
  const s = String(lit || '');
  if (s.length < 2) return s;
  const q = s[0];
  if (q !== '\'' && q !== '"') return s;
  try {
    if (q === '"') return JSON.parse(s);
    const inner = s
      .slice(1, -1)
      .replace(/\\'/g, '\'')
      .replace(/"/g, '\\"');
    return JSON.parse(`"${inner}"`);
  } catch (_err) {
    return s.slice(1, -1);
  }
}

function nextSig(tokens, idx) {
  let k = idx;
  while (k < tokens.length && (tokens[k].type === 'ws' || tokens[k].type === 'comment')) k++;
  return k;
}

function prevSig(tokens, idx) {
  let k = idx;
  while (k >= 0 && (tokens[k].type === 'ws' || tokens[k].type === 'comment')) k--;
  return k;
}

function hasNewlineBetween(tokens, fromExclusive, toExclusive) {
  for (let k = fromExclusive + 1; k < toExclusive && k < tokens.length; k++) {
    if (tokens[k].value.includes('\n') || tokens[k].value.includes('\r')) return true;
  }
  return false;
}

function findMatchingClose(tokens, openIdx) {
  const openVal = tokens[openIdx].value;
  const closeVal = openVal === '(' ? ')' : openVal === '[' ? ']' : openVal === '{' ? '}' : '';
  if (!closeVal) return openIdx;
  let depth = 0;
  let tmplDepth = 0;
  for (let k = openIdx; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'template_head') {
      tmplDepth++;
      continue;
    }
    if (t.type === 'template_tail' && t.value.startsWith('}')) {
      tmplDepth = Math.max(0, tmplDepth - 1);
      continue;
    }
    if (t.type !== 'punct') continue;
    if (t.value === openVal && tmplDepth === 0) depth++;
    else if (t.value === closeVal && tmplDepth === 0) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return tokens.length - 1;
}

function extractPatternIdentifiers(tokens, startIdx, endIdxExclusive, outNames) {
  let k = nextSig(tokens, startIdx);
  if (k >= endIdxExclusive) return;
  const tok = tokens[k];
  if (tok.type === 'punct' && tok.value === '...') {
    extractPatternIdentifiers(tokens, k + 1, endIdxExclusive, outNames);
    return;
  }
  if (tok.type === 'ident' && !JS_RESERVED_KEYWORDS.has(tok.value)) {
    outNames.push(tok.value);
    return;
  }
  if (tok.type === 'punct' && (tok.value === '{' || tok.value === '[')) {
    const isObj = tok.value === '{';
    const closeIdx = Math.min(findMatchingClose(tokens, k), endIdxExclusive - 1);
    let itemStart = k + 1;
    let pD = 0;
    let bD = 0;
    let cD = 0;
    const flushItem = (iStart, iEnd) => {
      let s = nextSig(tokens, iStart);
      if (s >= iEnd) return;
      if (tokens[s].type === 'punct' && tokens[s].value === '...') {
        extractPatternIdentifiers(tokens, s + 1, iEnd, outNames);
        return;
      }
      // Strip top-level `= defaultExpr`
      let eqPos = -1;
      let colonPos = -1;
      let sp = 0;
      let sb = 0;
      let sc = 0;
      for (let m = s; m < iEnd; m++) {
        const mt = tokens[m];
        if (mt.type !== 'punct') continue;
        if (mt.value === '(') sp++;
        else if (mt.value === ')') sp = Math.max(0, sp - 1);
        else if (mt.value === '[') sb++;
        else if (mt.value === ']') sb = Math.max(0, sb - 1);
        else if (mt.value === '{') sc++;
        else if (mt.value === '}') sc = Math.max(0, sc - 1);
        else if (sp === 0 && sb === 0 && sc === 0) {
          if (isObj && colonPos === -1 && eqPos === -1 && mt.value === ':') {
            colonPos = m;
          } else if (eqPos === -1 && mt.value === '=') {
            eqPos = m;
            break;
          }
        }
      }
      const lhsEnd = eqPos !== -1 ? eqPos : iEnd;
      const targetStart = isObj && colonPos !== -1 ? colonPos + 1 : s;
      extractPatternIdentifiers(tokens, targetStart, lhsEnd, outNames);
    };
    for (let m = k + 1; m < closeIdx; m++) {
      const mt = tokens[m];
      if (mt.type === 'punct') {
        if (mt.value === '(') pD++;
        else if (mt.value === ')') pD = Math.max(0, pD - 1);
        else if (mt.value === '[') bD++;
        else if (mt.value === ']') bD = Math.max(0, bD - 1);
        else if (mt.value === '{') cD++;
        else if (mt.value === '}') cD = Math.max(0, cD - 1);
        else if (mt.value === ',' && pD === 0 && bD === 0 && cD === 0) {
          flushItem(itemStart, m);
          itemStart = m + 1;
        }
      }
    }
    flushItem(itemStart, closeIdx);
  }
}

function findStatementEndTokenIndex(tokens, startIdx) {
  let pD = 0;
  let bD = 0;
  let cD = 0;
  let tmplD = 0;
  for (let k = startIdx; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'template_head') {
      tmplD++;
      continue;
    }
    if (t.type === 'template_tail' && t.value.startsWith('}')) {
      tmplD = Math.max(0, tmplD - 1);
      continue;
    }
    if (tmplD > 0) continue;
    if (t.type === 'punct') {
      if (t.value === '(') pD++;
      else if (t.value === ')') pD = Math.max(0, pD - 1);
      else if (t.value === '[') bD++;
      else if (t.value === ']') bD = Math.max(0, bD - 1);
      else if (t.value === '{') cD++;
      else if (t.value === '}') cD = Math.max(0, cD - 1);
      else if (t.value === ';' && pD === 0 && bD === 0 && cD === 0) {
        return k + 1;
      }
    }
    if (t.type === 'ws' && (t.value.includes('\n') || t.value.includes('\r')) && pD === 0 && bD === 0 && cD === 0) {
      const pIdx = prevSig(tokens, k - 1);
      const nIdx = nextSig(tokens, k + 1);
      const pTok = pIdx >= startIdx ? tokens[pIdx] : null;
      const nTok = nIdx < tokens.length ? tokens[nIdx] : null;
      const continuationPrev =
        pTok &&
        ((pTok.type === 'punct' &&
          (pTok.value === ',' ||
            pTok.value === '=' ||
            pTok.value === '+' ||
            pTok.value === '-' ||
            pTok.value === '*' ||
            pTok.value === '/' ||
            pTok.value === '%' ||
            pTok.value === '&&' ||
            pTok.value === '||' ||
            pTok.value === '??' ||
            pTok.value === '?' ||
            pTok.value === ':' ||
            pTok.value === '.' ||
            pTok.value === '?.' ||
            pTok.value === '=>')) ||
          (pTok.type === 'ident' &&
            (pTok.value === 'from' ||
              pTok.value === 'as' ||
              pTok.value === 'import' ||
              pTok.value === 'export' ||
              pTok.value === 'default' ||
              pTok.value === 'const' ||
              pTok.value === 'let' ||
              pTok.value === 'var' ||
              pTok.value === 'async')));
      const continuationNext =
        nTok &&
        ((nTok.type === 'punct' &&
          (nTok.value === '.' ||
            nTok.value === '?.' ||
            nTok.value === ',' ||
            nTok.value === '=' ||
            nTok.value === '?' ||
            nTok.value === ':' ||
            nTok.value === '&&' ||
            nTok.value === '||' ||
            nTok.value === '??')) ||
          (nTok.type === 'ident' && (nTok.value === 'from' || nTok.value === 'as')));
      if (pTok && !continuationPrev && !continuationNext) {
        return k;
      }
    }
  }
  return tokens.length;
}

function splitDeclarators(tokens, startIdx, endIdxExclusive) {
  const list = [];
  let pD = 0;
  let bD = 0;
  let cD = 0;
  let tmplD = 0;
  let curStart = startIdx;
  let endBound = endIdxExclusive;
  const lastSig = prevSig(tokens, endIdxExclusive - 1);
  if (lastSig >= startIdx && tokens[lastSig].type === 'punct' && tokens[lastSig].value === ';') {
    endBound = lastSig;
  }

  const pushDecl = (dStart, dEnd) => {
    const s = nextSig(tokens, dStart);
    if (s >= dEnd) return;
    let eqIdx = -1;
    let dp = 0;
    let db = 0;
    let dc = 0;
    let dt = 0;
    for (let m = s; m < dEnd; m++) {
      const mt = tokens[m];
      if (mt.type === 'template_head') {
        dt++;
        continue;
      }
      if (mt.type === 'template_tail' && mt.value.startsWith('}')) {
        dt = Math.max(0, dt - 1);
        continue;
      }
      if (dt > 0 || mt.type !== 'punct') continue;
      if (mt.value === '(') dp++;
      else if (mt.value === ')') dp = Math.max(0, dp - 1);
      else if (mt.value === '[') db++;
      else if (mt.value === ']') db = Math.max(0, db - 1);
      else if (mt.value === '{') dc++;
      else if (mt.value === '}') dc = Math.max(0, dc - 1);
      else if (mt.value === '=' && dp === 0 && db === 0 && dc === 0) {
        eqIdx = m;
        break;
      }
    }
    const lhsEnd = eqIdx !== -1 ? eqIdx : dEnd;
    const names = [];
    extractPatternIdentifiers(tokens, s, lhsEnd, names);
    list.push({
      lhsStart: s,
      lhsEnd,
      eqIdx,
      rhsStart: eqIdx !== -1 ? nextSig(tokens, eqIdx + 1) : -1,
      rhsEnd: dEnd,
      names,
    });
  };

  for (let k = startIdx; k < endBound; k++) {
    const t = tokens[k];
    if (t.type === 'template_head') {
      tmplD++;
      continue;
    }
    if (t.type === 'template_tail' && t.value.startsWith('}')) {
      tmplD = Math.max(0, tmplD - 1);
      continue;
    }
    if (tmplD > 0 || t.type !== 'punct') continue;
    if (t.value === '(') pD++;
    else if (t.value === ')') pD = Math.max(0, pD - 1);
    else if (t.value === '[') bD++;
    else if (t.value === ']') bD = Math.max(0, bD - 1);
    else if (t.value === '{') cD++;
    else if (t.value === '}') cD = Math.max(0, cD - 1);
    else if (t.value === ',' && pD === 0 && bD === 0 && cD === 0) {
      pushDecl(curStart, k);
      curStart = k + 1;
    }
  }
  pushDecl(curStart, endBound);
  return list;
}

// Builds a lexical scope tree over `tokens` (`startIdx..endIdxExclusive`) so nested bindings shadow module bindings accurately!
function analyzeScopes(tokens) {
  const rootScope = {
    kind: 'module',
    parent: null,
    bindings: new Set(),
    start: 0,
    end: tokens.length,
  };
  const tokenScope = new Array(tokens.length).fill(rootScope);
  const declarationNameTokens = new Set();
  const scopeStack = [rootScope];

  const currentFunctionOrModuleScope = () => {
    for (let s = scopeStack.length - 1; s >= 0; s--) {
      if (scopeStack[s].kind === 'function' || scopeStack[s].kind === 'module') {
        return scopeStack[s];
      }
    }
    return rootScope;
  };

  let pendingScopeForNextBrace = null;
  const closeAtToken = new Map();

  for (let i = 0; i < tokens.length; i++) {
    while (closeAtToken.has(i)) {
      const toPop = closeAtToken.get(i);
      closeAtToken.delete(i);
      for (let p = 0; p < toPop; p++) {
        if (scopeStack.length > 1) scopeStack.pop();
      }
    }

    const tok = tokens[i];
    const activeScope = scopeStack[scopeStack.length - 1];
    tokenScope[i] = activeScope;

    if (tok.type === 'ident') {
      const pIdx = prevSig(tokens, i - 1);
      const pTok = pIdx >= 0 ? tokens[pIdx] : null;
      const isAfterDot = pTok && pTok.type === 'punct' && (pTok.value === '.' || pTok.value === '?.');
      if (isAfterDot) continue;

      if (tok.value === 'function') {
        let cur = nextSig(tokens, i + 1);
        if (cur < tokens.length && tokens[cur].type === 'punct' && tokens[cur].value === '*') {
          cur = nextSig(tokens, cur + 1);
        }
        let fnNameIdx = -1;
        if (cur < tokens.length && tokens[cur].type === 'ident') {
          fnNameIdx = cur;
          cur = nextSig(tokens, cur + 1);
        }
        if (cur < tokens.length && tokens[cur].type === 'punct' && tokens[cur].value === '(') {
          const closeParen = findMatchingClose(tokens, cur);
          const bodyBrace = nextSig(tokens, closeParen + 1);
          if (bodyBrace < tokens.length && tokens[bodyBrace].type === 'punct' && tokens[bodyBrace].value === '{') {
            const closeBrace = findMatchingClose(tokens, bodyBrace);
            // Statement function declaration binds name in outer scope; expression binds inside fnScope
            const isStmtFn =
              !pTok ||
              (pTok.type === 'punct' && (pTok.value === ';' || pTok.value === '{' || pTok.value === '}')) ||
              (pTok.type === 'ident' && (pTok.value === 'export' || pTok.value === 'default' || pTok.value === 'async'));
            const fnScope = {
              kind: 'function',
              parent: activeScope,
              bindings: new Set(),
              start: cur,
              end: closeBrace + 1,
            };
            if (fnNameIdx !== -1) {
              const fnName = tokens[fnNameIdx].value;
              declarationNameTokens.add(fnNameIdx);
              if (isStmtFn) activeScope.bindings.add(fnName);
              fnScope.bindings.add(fnName);
            }
            const paramNames = [];
            // Extract params inside (...)
            const paramDecls = splitDeclarators(tokens, cur + 1, closeParen);
            for (const pd of paramDecls) {
              for (const n of pd.names) fnScope.bindings.add(n);
            }
            // Mark param pattern ident tokens as declaration sites
            for (let pk = cur + 1; pk < closeParen; pk++) {
              if (tokens[pk].type === 'ident' && fnScope.bindings.has(tokens[pk].value)) {
                const pp = prevSig(tokens, pk - 1);
                const pn = nextSig(tokens, pk + 1);
                const isProp =
                  (pp >= 0 && tokens[pp].type === 'punct' && tokens[pp].value === '.') ||
                  (pn < closeParen && tokens[pn].type === 'punct' && tokens[pn].value === ':');
                if (!isProp) declarationNameTokens.add(pk);
              }
            }
            // Apply fnScope across parameter list & body
            scopeStack.push(fnScope);
            closeAtToken.set(closeBrace + 1, (closeAtToken.get(closeBrace + 1) || 0) + 1);
            pendingScopeForNextBrace = { braceIdx: bodyBrace, reuseTop: true };
          }
        }
        continue;
      }

      if (tok.value === 'class') {
        let cur = nextSig(tokens, i + 1);
        if (cur < tokens.length && tokens[cur].type === 'ident' && tokens[cur].value !== 'extends') {
          const clsName = tokens[cur].value;
          declarationNameTokens.add(cur);
          const isStmtCls =
            !pTok ||
            (pTok.type === 'punct' && (pTok.value === ';' || pTok.value === '{' || pTok.value === '}')) ||
            (pTok.type === 'ident' && (pTok.value === 'export' || pTok.value === 'default'));
          if (isStmtCls) {
            activeScope.bindings.add(clsName);
          }
        }
        continue;
      }

      if (tok.value === 'catch') {
        const openP = nextSig(tokens, i + 1);
        if (openP < tokens.length && tokens[openP].type === 'punct' && tokens[openP].value === '(') {
          const closeP = findMatchingClose(tokens, openP);
          const bodyBrace = nextSig(tokens, closeP + 1);
          if (bodyBrace < tokens.length && tokens[bodyBrace].type === 'punct' && tokens[bodyBrace].value === '{') {
            const closeBrace = findMatchingClose(tokens, bodyBrace);
            const catchScope = {
              kind: 'block',
              parent: activeScope,
              bindings: new Set(),
              start: openP,
              end: closeBrace + 1,
            };
            const catchNames = [];
            extractPatternIdentifiers(tokens, openP + 1, closeP, catchNames);
            for (const cn of catchNames) catchScope.bindings.add(cn);
            for (let ck = openP + 1; ck < closeP; ck++) {
              if (tokens[ck].type === 'ident' && catchScope.bindings.has(tokens[ck].value)) {
                declarationNameTokens.add(ck);
              }
            }
            scopeStack.push(catchScope);
            closeAtToken.set(closeBrace + 1, (closeAtToken.get(closeBrace + 1) || 0) + 1);
            pendingScopeForNextBrace = { braceIdx: bodyBrace, reuseTop: true };
          }
        }
        continue;
      }

      if (tok.value === 'for') {
        const afterFor = nextSig(tokens, i + 1);
        let openP = afterFor;
        if (openP < tokens.length && tokens[openP].type === 'ident' && tokens[openP].value === 'await') {
          openP = nextSig(tokens, openP + 1);
        }
        if (openP < tokens.length && tokens[openP].type === 'punct' && tokens[openP].value === '(') {
          const closeP = findMatchingClose(tokens, openP);
          const initKwIdx = nextSig(tokens, openP + 1);
          if (
            initKwIdx < closeP &&
            tokens[initKwIdx].type === 'ident' &&
            (tokens[initKwIdx].value === 'let' || tokens[initKwIdx].value === 'const')
          ) {
            const afterClose = nextSig(tokens, closeP + 1);
            let loopEnd = afterClose + 1;
            if (afterClose < tokens.length && tokens[afterClose].type === 'punct' && tokens[afterClose].value === '{') {
              loopEnd = findMatchingClose(tokens, afterClose) + 1;
            } else {
              loopEnd = findStatementEndTokenIndex(tokens, afterClose);
            }
            const forScope = {
              kind: 'block',
              parent: activeScope,
              bindings: new Set(),
              start: openP,
              end: loopEnd,
            };
            scopeStack.push(forScope);
            closeAtToken.set(loopEnd, (closeAtToken.get(loopEnd) || 0) + 1);
          }
        }
        continue;
      }

      if (tok.value === 'let' || tok.value === 'const' || tok.value === 'var') {
        const nextIdx = nextSig(tokens, i + 1);
        if (
          nextIdx < tokens.length &&
          ((tokens[nextIdx].type === 'ident' && !JS_RESERVED_KEYWORDS.has(tokens[nextIdx].value)) ||
            (tokens[nextIdx].type === 'punct' && (tokens[nextIdx].value === '{' || tokens[nextIdx].value === '[')))
        ) {
          // Check if inside `for (let x of ...)` / `for (const x in ...)`
          let declBound = findStatementEndTokenIndex(tokens, nextIdx);
          let pD = 0;
          let bD = 0;
          let cD = 0;
          for (let m = nextIdx; m < declBound; m++) {
            const mt = tokens[m];
            if (mt.type === 'punct') {
              if (mt.value === '(') pD++;
              else if (mt.value === ')') {
                if (pD === 0) {
                  declBound = m;
                  break;
                }
                pD--;
              } else if (mt.value === '[') bD++;
              else if (mt.value === ']') bD = Math.max(0, bD - 1);
              else if (mt.value === '{') cD++;
              else if (mt.value === '}') cD = Math.max(0, cD - 1);
              else if (mt.value === ';' && pD === 0 && bD === 0 && cD === 0) {
                declBound = m;
                break;
              }
            } else if (
              mt.type === 'ident' &&
              (mt.value === 'in' || mt.value === 'of') &&
              pD === 0 &&
              bD === 0 &&
              cD === 0
            ) {
              declBound = m;
              break;
            }
          }
          const decls = splitDeclarators(tokens, nextIdx, declBound);
          const targetScope = tok.value === 'var' ? currentFunctionOrModuleScope() : activeScope;
          for (const d of decls) {
            for (const n of d.names) targetScope.bindings.add(n);
            for (let dk = d.lhsStart; dk < d.lhsEnd; dk++) {
              if (tokens[dk].type === 'ident' && d.names.includes(tokens[dk].value)) {
                const pp = prevSig(tokens, dk - 1);
                const pn = nextSig(tokens, dk + 1);
                const isObjKey =
                  (pp >= 0 && tokens[pp].type === 'punct' && tokens[pp].value === '.') ||
                  (pn < d.lhsEnd && tokens[pn].type === 'punct' && tokens[pn].value === ':');
                if (!isObjKey) declarationNameTokens.add(dk);
              }
            }
          }
        }
        continue;
      }
    }

    // Arrow function `(...) =>` or `id =>`
    if (tok.type === 'punct' && tok.value === '=>') {
      const beforeArrow = prevSig(tokens, i - 1);
      const afterArrow = nextSig(tokens, i + 1);
      if (beforeArrow >= 0 && afterArrow < tokens.length) {
        let paramNames = [];
        let paramStart = beforeArrow;
        if (tokens[beforeArrow].type === 'ident') {
          paramNames.push(tokens[beforeArrow].value);
          declarationNameTokens.add(beforeArrow);
        } else if (tokens[beforeArrow].type === 'punct' && tokens[beforeArrow].value === ')') {
          // Find matching `(` backwards
          let depth = 0;
          for (let b = beforeArrow; b >= 0; b--) {
            if (tokens[b].type === 'punct') {
              if (tokens[b].value === ')') depth++;
              else if (tokens[b].value === '(') {
                depth--;
                if (depth === 0) {
                  paramStart = b;
                  break;
                }
              }
            }
          }
          const pDecls = splitDeclarators(tokens, paramStart + 1, beforeArrow);
          for (const pd of pDecls) {
            for (const n of pd.names) paramNames.push(n);
            for (let pk = pd.lhsStart; pk < pd.lhsEnd; pk++) {
              if (tokens[pk].type === 'ident' && pd.names.includes(tokens[pk].value)) {
                const pp = prevSig(tokens, pk - 1);
                const pn = nextSig(tokens, pk + 1);
                const isObjKey =
                  (pp >= 0 && tokens[pp].type === 'punct' && tokens[pp].value === '.') ||
                  (pn < pd.lhsEnd && tokens[pn].type === 'punct' && tokens[pn].value === ':');
                if (!isObjKey) declarationNameTokens.add(pk);
              }
            }
          }
        }
        let bodyEnd = afterArrow + 1;
        const isBlockBody = tokens[afterArrow].type === 'punct' && tokens[afterArrow].value === '{';
        if (isBlockBody) {
          bodyEnd = findMatchingClose(tokens, afterArrow) + 1;
        } else {
          // Expression body ends at top-level `,`, `;`, `)`, `]`, `}`
          let ep = 0;
          let eb = 0;
          let ec = 0;
          let et = 0;
          bodyEnd = tokens.length;
          for (let ek = afterArrow; ek < tokens.length; ek++) {
            const etok = tokens[ek];
            if (etok.type === 'template_head') {
              et++;
              continue;
            }
            if (etok.type === 'template_tail' && etok.value.startsWith('}')) {
              et = Math.max(0, et - 1);
              continue;
            }
            if (et > 0 || etok.type !== 'punct') continue;
            if (etok.value === '(') ep++;
            else if (etok.value === ')') {
              if (ep === 0) {
                bodyEnd = ek;
                break;
              }
              ep--;
            } else if (etok.value === '[') eb++;
            else if (etok.value === ']') {
              if (eb === 0) {
                bodyEnd = ek;
                break;
              }
              eb--;
            } else if (etok.value === '{') ec++;
            else if (etok.value === '}') {
              if (ec === 0) {
                bodyEnd = ek;
                break;
              }
              ec--;
            } else if ((etok.value === ',' || etok.value === ';') && ep === 0 && eb === 0 && ec === 0) {
              bodyEnd = ek;
              break;
            }
          }
        }
        const arrowScope = {
          kind: 'function',
          parent: activeScope,
          bindings: new Set(paramNames),
          start: paramStart,
          end: bodyEnd,
        };
        for (let ak = paramStart; ak <= i; ak++) {
          tokenScope[ak] = arrowScope;
        }
        scopeStack.push(arrowScope);
        closeAtToken.set(bodyEnd, (closeAtToken.get(bodyEnd) || 0) + 1);
        if (isBlockBody) {
          pendingScopeForNextBrace = { braceIdx: afterArrow, reuseTop: true };
        }
        continue;
      }
    }

    if (tok.type === 'punct' && tok.value === '{') {
      if (pendingScopeForNextBrace && pendingScopeForNextBrace.braceIdx === i) {
        pendingScopeForNextBrace = null;
        continue;
      }
      // Distinguish block `{ ... }` vs object literal `{ a: 1 }`
      const pIdx = prevSig(tokens, i - 1);
      const pTok = pIdx >= 0 ? tokens[pIdx] : null;
      const isObjLiteral =
        pTok &&
        ((pTok.type === 'punct' &&
          (pTok.value === '=' ||
            pTok.value === ':' ||
            pTok.value === ',' ||
            pTok.value === '(' ||
            pTok.value === '[' ||
            pTok.value === '?' ||
            pTok.value === '&&' ||
            pTok.value === '||' ||
            pTok.value === '??')) ||
          (pTok.type === 'ident' &&
            (pTok.value === 'return' || pTok.value === 'throw' || pTok.value === 'yield' || pTok.value === 'await')));
      // Method shorthand `{ foo(a, b) { ... } }` inside class/object
      if (pTok && pTok.type === 'punct' && pTok.value === ')') {
        let openP = -1;
        let d = 0;
        for (let b = pIdx; b >= 0; b--) {
          if (tokens[b].type === 'punct') {
            if (tokens[b].value === ')') d++;
            else if (tokens[b].value === '(') {
              d--;
              if (d === 0) {
                openP = b;
                break;
              }
            }
          }
        }
        const beforeOpenP = openP > 0 ? prevSig(tokens, openP - 1) : -1;
        const bTok = beforeOpenP >= 0 ? tokens[beforeOpenP] : null;
        const isControlParen =
          bTok && bTok.type === 'ident' && (bTok.value === 'if' || bTok.value === 'for' || bTok.value === 'while' || bTok.value === 'switch' || bTok.value === 'with');
        if (openP >= 0 && !isControlParen && bTok && (bTok.type === 'ident' || bTok.type === 'private_ident' || (bTok.type === 'punct' && bTok.value === ']'))) {
          const closeB = findMatchingClose(tokens, i);
          const methodScope = {
            kind: 'function',
            parent: activeScope,
            bindings: new Set(),
            start: openP,
            end: closeB + 1,
          };
          const mParams = splitDeclarators(tokens, openP + 1, pIdx);
          for (const mp of mParams) {
            for (const n of mp.names) methodScope.bindings.add(n);
            for (let mk = mp.lhsStart; mk < mp.lhsEnd; mk++) {
              if (tokens[mk].type === 'ident' && mp.names.includes(tokens[mk].value)) {
                declarationNameTokens.add(mk);
              }
            }
          }
          for (let mk = openP; mk <= i; mk++) tokenScope[mk] = methodScope;
          scopeStack.push(methodScope);
          closeAtToken.set(closeB + 1, (closeAtToken.get(closeB + 1) || 0) + 1);
          continue;
        }
      }
      if (!isObjLiteral) {
        const closeB = findMatchingClose(tokens, i);
        const blockScope = {
          kind: 'block',
          parent: activeScope,
          bindings: new Set(),
          start: i,
          end: closeB + 1,
        };
        scopeStack.push(blockScope);
        closeAtToken.set(closeB + 1, (closeAtToken.get(closeB + 1) || 0) + 1);
      }
    }
  }

  return { rootScope, tokenScope, declarationNameTokens };
}

function isShadowedInNestedScope(scope, rootScope, identName) {
  let cur = scope;
  while (cur && cur !== rootScope) {
    if (cur.bindings.has(identName)) return true;
    cur = cur.parent;
  }
  return false;
}

function isPropertyOrObjectKeyPosition(tokens, idx) {
  const pIdx = prevSig(tokens, idx - 1);
  const nIdx = nextSig(tokens, idx + 1);
  const pTok = pIdx >= 0 ? tokens[pIdx] : null;
  const nTok = nIdx < tokens.length ? tokens[nIdx] : null;

  if (pTok && pTok.type === 'punct' && (pTok.value === '.' || pTok.value === '?.')) {
    return { isMemberAccess: true, isObjKey: false, isShorthandObjProp: false, isMethodKey: false };
  }

  // Check enclosing `{ ... }` for object literal property vs block label
  let braceOpenIdx = -1;
  let pD = 0;
  let bD = 0;
  let cD = 0;
  let tD = 0;
  for (let b = idx - 1; b >= 0; b--) {
    const bt = tokens[b];
    if (bt.type === 'template_tail' && bt.value.startsWith('}')) {
      tD++;
      continue;
    }
    if (bt.type === 'template_head') {
      if (tD === 0) break;
      tD--;
      continue;
    }
    if (tD > 0 || bt.type !== 'punct') continue;
    if (bt.value === ')') pD++;
    else if (bt.value === '(') {
      if (pD === 0) break;
      pD--;
    } else if (bt.value === ']') bD++;
    else if (bt.value === '[') {
      if (bD === 0) break;
      bD--;
    } else if (bt.value === '}') cD++;
    else if (bt.value === '{') {
      if (cD === 0) {
        braceOpenIdx = b;
        break;
      }
      cD--;
    }
  }

  const immediatelyAfterBraceOrComma =
    braceOpenIdx !== -1 &&
    pTok &&
    pTok.type === 'punct' &&
    (pIdx === braceOpenIdx || pTok.value === ',');

  if (nTok && nTok.type === 'punct' && nTok.value === ':' && immediatelyAfterBraceOrComma) {
    return { isMemberAccess: false, isObjKey: true, isShorthandObjProp: false, isMethodKey: false };
  }

  // Object/class method definition: `foo(...) {`
  if (nTok && nTok.type === 'punct' && nTok.value === '(' && braceOpenIdx !== -1) {
    const closeP = findMatchingClose(tokens, nIdx);
    const afterCloseP = nextSig(tokens, closeP + 1);
    if (afterCloseP < tokens.length && tokens[afterCloseP].type === 'punct' && tokens[afterCloseP].value === '{') {
      if (
        pTok &&
        ((pTok.type === 'punct' && (pTok.value === '{' || pTok.value === ',' || pTok.value === '}' || pTok.value === ';')) ||
          (pTok.type === 'ident' && (pTok.value === 'static' || pTok.value === 'async' || pTok.value === 'get' || pTok.value === 'set')))
      ) {
        return { isMemberAccess: false, isObjKey: false, isShorthandObjProp: false, isMethodKey: true };
      }
    }
  }

  const isShorthandObjProp =
    immediatelyAfterBraceOrComma &&
    nTok &&
    nTok.type === 'punct' &&
    (nTok.value === ',' || nTok.value === '}');

  return { isMemberAccess: false, isObjKey: false, isShorthandObjProp, isMethodKey: false };
}

// Rewrites non-shadowed bare worker globals (such as `location`) cleanly without touching member access, object keys, or shadowed locals!
function rewriteWorkerGlobalBindings(source, replacements = { location: '__workerLocation' }) {
  const tokens = lexJsTokens(source);
  const { rootScope, tokenScope, declarationNameTokens } = analyzeScopes(tokens);
  const mapObj = replacements && typeof replacements === 'object' ? replacements : {};
  let out = '';

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (
      tok.type === 'ident' &&
      Object.prototype.hasOwnProperty.call(mapObj, tok.value) &&
      !declarationNameTokens.has(i) &&
      !rootScope.bindings.has(tok.value) &&
      !isShadowedInNestedScope(tokenScope[i], rootScope, tok.value)
    ) {
      const posInfo = isPropertyOrObjectKeyPosition(tokens, i);
      if (!posInfo.isMemberAccess && !posInfo.isObjKey && !posInfo.isMethodKey) {
        const rep = mapObj[tok.value];
        out += posInfo.isShorthandObjProp ? `${tok.value}: ${rep}` : rep;
        continue;
      }
    }
    out += tok.value;
  }
  return out;
}

const COMPOUND_ASSIGN_OPS = new Set([
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '<<=',
  '>>=',
  '>>>=',
  '&=',
  '|=',
  '^=',
  '&&=',
  '||=',
  '??=',
]);

function findRhsExpressionEnd(tokens, rhsStartIdx) {
  let pD = 0;
  let bD = 0;
  let cD = 0;
  let tD = 0;
  for (let k = rhsStartIdx; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'template_head') {
      tD++;
      continue;
    }
    if (t.type === 'template_tail' && t.value.startsWith('}')) {
      tD = Math.max(0, tD - 1);
      continue;
    }
    if (tD > 0) continue;
    if (t.type === 'punct') {
      if (t.value === '(') pD++;
      else if (t.value === ')') {
        if (pD === 0) return k;
        pD--;
      } else if (t.value === '[') bD++;
      else if (t.value === ']') {
        if (bD === 0) return k;
        bD--;
      } else if (t.value === '{') cD++;
      else if (t.value === '}') {
        if (cD === 0) return k;
        cD--;
      } else if ((t.value === ',' || t.value === ';') && pD === 0 && bD === 0 && cD === 0) {
        return k;
      }
    }
    if (t.type === 'ws' && (t.value.includes('\n') || t.value.includes('\r')) && pD === 0 && bD === 0 && cD === 0) {
      const pIdx = prevSig(tokens, k - 1);
      const nIdx = nextSig(tokens, k + 1);
      const pTok = pIdx >= rhsStartIdx ? tokens[pIdx] : null;
      const nTok = nIdx < tokens.length ? tokens[nIdx] : null;
      const contPrev =
        pTok &&
        ((pTok.type === 'punct' &&
          (pTok.value === '+' ||
            pTok.value === '-' ||
            pTok.value === '*' ||
            pTok.value === '/' ||
            pTok.value === '%' ||
            pTok.value === '&&' ||
            pTok.value === '||' ||
            pTok.value === '??' ||
            pTok.value === '?' ||
            pTok.value === ':' ||
            pTok.value === '.' ||
            pTok.value === '?.' ||
            pTok.value === '=>' ||
            pTok.value === '=')) ||
          (pTok.type === 'ident' && (pTok.value === 'await' || pTok.value === 'yield' || pTok.value === 'typeof' || pTok.value === 'new')));
      const contNext =
        nTok &&
        nTok.type === 'punct' &&
        (nTok.value === '.' ||
          nTok.value === '?.' ||
          nTok.value === '?' ||
          nTok.value === ':' ||
          nTok.value === '&&' ||
          nTok.value === '||' ||
          nTok.value === '??' ||
          nTok.value === '+' ||
          nTok.value === '-' ||
          nTok.value === '*' ||
          nTok.value === '/');
      if (pTok && !contPrev && !contNext) {
        return k;
      }
    }
  }
  return tokens.length;
}

// Rewrites expression/statement slice with live import bindings, TDZ checks, and ECMA-262 RHS-first assignment semantics!
function renderRewrittenSlice(tokens, startIdx, endIdxExclusive, ctx) {
  const {
    rootScope,
    tokenScope,
    declarationNameTokens,
    importBindings, // Map<localName, { expr, localName }>
    tdzBindings, // Map<localName, { kind: 'let'|'const'|'class', varName }>
    skipDeclIdentIndices,
    modUrl,
    registerDep,
  } = ctx;

  let out = '';
  let i = startIdx;

  while (i < endIdxExclusive) {
    const tok = tokens[i];

    // `import.meta.url` / `import.meta` / `import('...')`
    if (tok.type === 'ident' && tok.value === 'import') {
      const n1 = nextSig(tokens, i + 1);
      if (n1 < endIdxExclusive && tokens[n1].type === 'punct' && tokens[n1].value === '.') {
        const n2 = nextSig(tokens, n1 + 1);
        if (n2 < endIdxExclusive && tokens[n2].type === 'ident' && tokens[n2].value === 'meta') {
          const n3 = nextSig(tokens, n2 + 1);
          const n4 = n3 < endIdxExclusive ? nextSig(tokens, n3 + 1) : endIdxExclusive;
          if (
            n3 < endIdxExclusive &&
            tokens[n3].type === 'punct' &&
            tokens[n3].value === '.' &&
            n4 < endIdxExclusive &&
            tokens[n4].type === 'ident' &&
            tokens[n4].value === 'url'
          ) {
            out += JSON.stringify(modUrl);
            i = n4 + 1;
            continue;
          }
          out += `({ url: ${JSON.stringify(modUrl)} })`;
          i = n2 + 1;
          continue;
        }
      }
      if (n1 < endIdxExclusive && tokens[n1].type === 'punct' && tokens[n1].value === '(') {
        const closeP = findMatchingClose(tokens, n1);
        const argIdx = nextSig(tokens, n1 + 1);
        const afterArg = nextSig(tokens, argIdx + 1);
        if (argIdx < closeP && tokens[argIdx].type === 'string' && afterArg === closeP) {
          const spec = unquoteJsStringLiteral(tokens[argIdx].value);
          const depRef = registerDep(spec);
          out += `Promise.resolve(${depRef})`;
          i = closeP + 1;
          continue;
        }
      }
    }

    // Prefix `++x` / `--x` on import or TDZ/const binding
    if (tok.type === 'punct' && (tok.value === '++' || tok.value === '--')) {
      const targetIdx = nextSig(tokens, i + 1);
      if (targetIdx < endIdxExclusive && tokens[targetIdx].type === 'ident') {
        const name = tokens[targetIdx].value;
        const shadowed = isShadowedInNestedScope(tokenScope[targetIdx], rootScope, name);
        const posInfo = isPropertyOrObjectKeyPosition(tokens, targetIdx);
        const nextAfterTarget = nextSig(tokens, targetIdx + 1);
        const isMemberBase =
          nextAfterTarget < endIdxExclusive &&
          tokens[nextAfterTarget].type === 'punct' &&
          (tokens[nextAfterTarget].value === '.' ||
            tokens[nextAfterTarget].value === '?.' ||
            tokens[nextAfterTarget].value === '[');
        if (!shadowed && !posInfo.isMemberAccess && !isMemberBase) {
          if (importBindings.has(name)) {
            out += `__constErr(${JSON.stringify(name)})`;
            i = targetIdx + 1;
            continue;
          }
          if (tdzBindings.has(name)) {
            const bInfo = tdzBindings.get(name);
            const opDelta = tok.value === '++' ? '+ 1' : '- 1';
            if (bInfo.kind === 'const') {
              out += `(__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}), __constErr(${JSON.stringify(name)}))`;
            } else {
              out += `(__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}), ${bInfo.varName} = ${bInfo.varName} ${opDelta})`;
            }
            i = targetIdx + 1;
            continue;
          }
        }
      }
    }

    // `typeof x` where `x` is TDZ binding: must still trigger TDZ ReferenceError!
    if (tok.type === 'ident' && tok.value === 'typeof') {
      const targetIdx = nextSig(tokens, i + 1);
      if (targetIdx < endIdxExclusive && tokens[targetIdx].type === 'ident') {
        const name = tokens[targetIdx].value;
        const shadowed = isShadowedInNestedScope(tokenScope[targetIdx], rootScope, name);
        const posInfo = isPropertyOrObjectKeyPosition(tokens, targetIdx);
        const nextAfterTarget = nextSig(tokens, targetIdx + 1);
        const isStandaloneIdent =
          !nextAfterTarget ||
          nextAfterTarget >= endIdxExclusive ||
          !(
            tokens[nextAfterTarget].type === 'punct' &&
            (tokens[nextAfterTarget].value === '.' ||
              tokens[nextAfterTarget].value === '?.' ||
              tokens[nextAfterTarget].value === '[' ||
              tokens[nextAfterTarget].value === '(')
          );
        if (!shadowed && !posInfo.isMemberAccess && isStandaloneIdent && tdzBindings.has(name)) {
          const bInfo = tdzBindings.get(name);
          out += `(typeof __checkTdz(${bInfo.varName}, ${JSON.stringify(name)}))`;
          i = targetIdx + 1;
          continue;
        }
      }
    }

    // Destructuring write `[imp] = rhs` or `({ a: imp } = rhs)` on import / const / TDZ bindings
    if (
      tok.type === 'ident' &&
      !declarationNameTokens.has(i) &&
      !skipDeclIdentIndices.has(i) &&
      !isShadowedInNestedScope(tokenScope[i], rootScope, tok.value)
    ) {
      const name = tok.value;
      const isImp = importBindings.has(name);
      const isTdz = tdzBindings.has(name);
      if (isImp || isTdz) {
        const posInfo = isPropertyOrObjectKeyPosition(tokens, i);
        if (!posInfo.isMemberAccess && !posInfo.isObjKey && !posInfo.isMethodKey) {
          const nIdx = nextSig(tokens, i + 1);
          const nTok = nIdx < endIdxExclusive ? tokens[nIdx] : null;

          // Postfix `x++` / `x--` (only if no newline between ident and `++`/`--`)
          if (
            nTok &&
            nTok.type === 'punct' &&
            (nTok.value === '++' || nTok.value === '--') &&
            !hasNewlineBetween(tokens, i, nIdx)
          ) {
            if (isImp) {
              out += `__constErr(${JSON.stringify(name)})`;
            } else {
              const bInfo = tdzBindings.get(name);
              if (bInfo.kind === 'const') {
                out += `(__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}), __constErr(${JSON.stringify(name)}))`;
              } else {
                const delta = nTok.value === '++' ? '+ 1' : '- 1';
                out += `((__old) => (${bInfo.varName} = __old ${delta}, __old))(+__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}))`;
              }
            }
            i = nIdx + 1;
            continue;
          }

          // Simple assignment `x = rhs` (ECMA-262 §13.15.2: evaluate RHS FIRST, then check TDZ, then check const!)
          if (nTok && nTok.type === 'punct' && nTok.value === '=') {
            // Ensure this `=` is not default value inside destructuring pattern `[x = 1] = arr`:
            // check if an outer `=` follows a closing `]` or `}` on the same expression!
            let isDestructuringDefault = false;
            let pD = 0;
            let bD = 0;
            let cD = 0;
            for (let scan = nIdx + 1; scan < endIdxExclusive; scan++) {
              const st = tokens[scan];
              if (st.type !== 'punct') continue;
              if (st.value === '(') pD++;
              else if (st.value === ')') {
                if (pD === 0) break;
                pD--;
              } else if (st.value === '[') bD++;
              else if (st.value === ']') {
                if (bD === 0) {
                  const afterClose = nextSig(tokens, scan + 1);
                  if (afterClose < endIdxExclusive && tokens[afterClose].type === 'punct' && tokens[afterClose].value === '=') {
                    isDestructuringDefault = true;
                  }
                  break;
                }
                bD--;
              } else if (st.value === '{') cD++;
              else if (st.value === '}') {
                if (cD === 0) {
                  const afterClose = nextSig(tokens, scan + 1);
                  if (afterClose < endIdxExclusive && tokens[afterClose].type === 'punct' && tokens[afterClose].value === '=') {
                    isDestructuringDefault = true;
                  }
                  break;
                }
                cD--;
              } else if (st.value === ';' && pD === 0 && bD === 0 && cD === 0) {
                break;
              }
            }

            if (!isDestructuringDefault) {
              const rhsStart = nextSig(tokens, nIdx + 1);
              const rhsEnd = Math.min(findRhsExpressionEnd(tokens, rhsStart), endIdxExclusive);
              const rewrittenRhs = renderRewrittenSlice(tokens, rhsStart, rhsEnd, ctx);
              if (isImp) {
                out += `((__v) => (__constErr(${JSON.stringify(name)}), __v))(${rewrittenRhs})`;
              } else {
                const bInfo = tdzBindings.get(name);
                if (bInfo.kind === 'const') {
                  out += `((__v) => (__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}), __constErr(${JSON.stringify(name)}), __v))(${rewrittenRhs})`;
                } else {
                  out += `((__v) => (__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}), ${bInfo.varName} = __v))(${rewrittenRhs})`;
                }
              }
              i = rhsEnd;
              continue;
            }
          }

          // Compound assignment `x += rhs` (ECMA-262: GetValue(lref) runs FIRST -> __checkTdz, then RHS, then const check or write!)
          if (nTok && nTok.type === 'punct' && COMPOUND_ASSIGN_OPS.has(nTok.value)) {
            const op = nTok.value.slice(0, -1);
            const rhsStart = nextSig(tokens, nIdx + 1);
            const rhsEnd = Math.min(findRhsExpressionEnd(tokens, rhsStart), endIdxExclusive);
            const rewrittenRhs = renderRewrittenSlice(tokens, rhsStart, rhsEnd, ctx);
            if (isImp) {
              const impExpr = importBindings.get(name).expr;
              if (op === '&&' || op === '||' || op === '??') {
                out += `((__l) => (__l ${op} (__constErr(${JSON.stringify(name)}))))(${impExpr})`;
              } else {
                out += `((__l) => ((void (${rewrittenRhs})), __constErr(${JSON.stringify(name)})))(${impExpr})`;
              }
            } else {
              const bInfo = tdzBindings.get(name);
              if (bInfo.kind === 'const') {
                if (op === '&&' || op === '||' || op === '??') {
                  out += `((__l) => (__l ${op} ((__v) => (__constErr(${JSON.stringify(name)}), __v))(${rewrittenRhs})))(__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}))`;
                } else {
                  out += `((__l) => ((__v) => (__constErr(${JSON.stringify(name)}), __v))(${rewrittenRhs}))(__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}))`;
                }
              } else if (op === '&&' || op === '||' || op === '??') {
                out += `(__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}) ${op} (${bInfo.varName} = (${rewrittenRhs})))`;
              } else {
                out += `((__l) => (${bInfo.varName} = __l ${op} (${rewrittenRhs})))(__checkTdz(${bInfo.varName}, ${JSON.stringify(name)}))`;
              }
            }
            i = rhsEnd;
            continue;
          }

          // Check if `x` is a destructuring assignment target (e.g. `[x] = [1]` or `({ a: x } = obj)`)
          let isDestructuringWriteTarget = false;
          let bDepth = 0;
          let cDepth = 0;
          let pDepth = 0;
          for (let scan = i + 1; scan < endIdxExclusive; scan++) {
            const st = tokens[scan];
            if (st.type !== 'punct') continue;
            if (st.value === '(') pDepth++;
            else if (st.value === ')') {
              if (pDepth === 0) break;
              pDepth--;
            } else if (st.value === '[') bDepth++;
            else if (st.value === ']') {
              if (bDepth === 0) {
                let closePos = scan;
                while (closePos < endIdxExclusive) {
                  const after = nextSig(tokens, closePos + 1);
                  if (after < endIdxExclusive && tokens[after].type === 'punct' && (tokens[after].value === ']' || tokens[after].value === '}')) {
                    closePos = after;
                  } else if (after < endIdxExclusive && tokens[after].type === 'punct' && tokens[after].value === '=') {
                    isDestructuringWriteTarget = true;
                    break;
                  } else {
                    break;
                  }
                }
                break;
              }
              bDepth--;
            } else if (st.value === '{') cDepth++;
            else if (st.value === '}') {
              if (cDepth === 0) {
                let closePos = scan;
                while (closePos < endIdxExclusive) {
                  const after = nextSig(tokens, closePos + 1);
                  if (after < endIdxExclusive && tokens[after].type === 'punct' && (tokens[after].value === ']' || tokens[after].value === '}')) {
                    closePos = after;
                  } else if (after < endIdxExclusive && tokens[after].type === 'punct' && tokens[after].value === '=') {
                    isDestructuringWriteTarget = true;
                    break;
                  } else {
                    break;
                  }
                }
                break;
              }
              cDepth--;
            } else if (st.value === ';' && pDepth === 0 && bDepth === 0 && cDepth === 0) {
              break;
            }
          }

          if (isDestructuringWriteTarget) {
            if (isImp) {
              const targetProp = `get t() { return undefined; }, set t(_v) { __constErr(${JSON.stringify(name)}); }`;
              out += posInfo.isShorthandObjProp
                ? `${name}: ({ ${targetProp} }).t`
                : `({ ${targetProp} }).t`;
              i++;
              continue;
            }
            const bInfo = tdzBindings.get(name);
            if (bInfo.kind === 'const') {
              const targetProp = `set t(_v) { __checkTdz(${bInfo.varName}, ${JSON.stringify(name)}); __constErr(${JSON.stringify(name)}); }`;
              out += posInfo.isShorthandObjProp
                ? `${name}: ({ ${targetProp} }).t`
                : `({ ${targetProp} }).t`;
              i++;
              continue;
            }
            const targetProp = `set t(__v) { __checkTdz(${bInfo.varName}, ${JSON.stringify(name)}); ${bInfo.varName} = __v; }`;
            out += posInfo.isShorthandObjProp
              ? `${name}: ({ ${targetProp} }).t`
              : `({ ${targetProp} }).t`;
            i++;
            continue;
          }

          // Pure read reference!
          const readExpr = isImp
            ? importBindings.get(name).expr
            : `__checkTdz(${tdzBindings.get(name).varName}, ${JSON.stringify(name)})`;
          if (posInfo.isShorthandObjProp) {
            out += `${name}: ${readExpr}`;
          } else {
            // Preserve unbound `this` when calling imported function `(0, __mod_0.fn)(...)`
            const isCallCallee = isImp && nTok && nTok.type === 'punct' && nTok.value === '(' && !importBindings.get(name).isNamespace;
            out += isCallCallee ? `(0, ${readExpr})` : readExpr;
          }
          i++;
          continue;
        }
      }
    }

    out += tok.value;
    i++;
  }

  return out;
}

function parseImportClause(clauseStr, modVar, importBindings, namespaceConsts) {
  const clean = clauseStr.trim();
  if (!clean) return;

  const parseSpecifiers = (inner) => {
    for (const rawPart of inner.split(',')) {
      const part = rawPart.trim();
      if (!part) continue;
      const asMatch = part.match(/^([A-Za-z_$][\w$]*|default)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        importBindings.set(asMatch[2], {
          expr: `${modVar}[${JSON.stringify(asMatch[1])}]`,
          localName: asMatch[2],
          isNamespace: false,
        });
      } else {
        importBindings.set(part, {
          expr: `${modVar}[${JSON.stringify(part)}]`,
          localName: part,
          isNamespace: false,
        });
      }
    }
  };

  if (clean.startsWith('*')) {
    const nsMatch = clean.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (nsMatch) {
      namespaceConsts.push({ localName: nsMatch[1], modVar });
      importBindings.set(nsMatch[1], {
        expr: modVar,
        localName: nsMatch[1],
        isNamespace: true,
      });
    }
    return;
  }

  if (clean.startsWith('{') && clean.endsWith('}')) {
    parseSpecifiers(clean.slice(1, -1));
    return;
  }

  const commaIdx = clean.indexOf(',');
  if (commaIdx === -1) {
    importBindings.set(clean, {
      expr: `${modVar}.default`,
      localName: clean,
      isNamespace: false,
    });
    return;
  }

  const defIdent = clean.slice(0, commaIdx).trim();
  if (defIdent) {
    importBindings.set(defIdent, {
      expr: `${modVar}.default`,
      localName: defIdent,
      isNamespace: false,
    });
  }
  const rest = clean.slice(commaIdx + 1).trim();
  if (rest.startsWith('*')) {
    const nsMatch = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (nsMatch) {
      namespaceConsts.push({ localName: nsMatch[1], modVar });
      importBindings.set(nsMatch[1], {
        expr: modVar,
        localName: nsMatch[1],
        isNamespace: true,
      });
    }
  } else if (rest.startsWith('{') && rest.endsWith('}')) {
    parseSpecifiers(rest.slice(1, -1));
  }
}

// Compiles a single ES module into a 3-phase closure:
// - Phase 1 (declaration): top-level `let <id> = __TDZ`, hoisted `let fn = function fn...`
// - Phase 2 (`link()`): defines live export getters & star re-exports (intended to run in DFS post-order!)
// - Phase 3 (`evaluate()`): executes top-level statements in exact ECMA-262 source order!
function compileEsModule(source, { modUrl = 'file:///module.js', modId = 0, resolveDep } = {}) {
  const tokens = lexJsTokens(source);
  const { rootScope, tokenScope, declarationNameTokens } = analyzeScopes(tokens);

  const depOrder = [];
  const depMap = new Map();
  const registerDep = (spec) => {
    if (depMap.has(spec)) return depMap.get(spec).varExpr;
    if (typeof resolveDep === 'function') {
      const info = resolveDep(spec, modUrl);
      depMap.set(spec, info);
      depOrder.push(info.id);
      return info.varExpr;
    }
    const fallbackId = depOrder.length;
    const info = { id: fallbackId, url: spec, varExpr: `__mods[${fallbackId}]` };
    depMap.set(spec, info);
    depOrder.push(fallbackId);
    return info.varExpr;
  };

  const importBindings = new Map();
  const namespaceConsts = [];
  const tdzBindings = new Map(); // name -> { kind: 'let'|'const'|'class', varName: name }
  const hoistedFunctionDecls = []; // { name, start, end }
  const explicitExports = []; // { expName, getterExpr }
  const starReExports = []; // modVar
  const topStatements = []; // array of { type, ... }
  const skipDeclIdentIndices = new Set();

  // Pass 1 over top-level statements: classify imports, exports, hoisted functions, and TDZ lexical bindings
  let cursor = 0;
  while (cursor < tokens.length) {
    const sIdx = nextSig(tokens, cursor);
    if (sIdx >= tokens.length) {
      topStatements.push({ type: 'raw', start: cursor, end: tokens.length });
      break;
    }
    if (sIdx > cursor) {
      topStatements.push({ type: 'raw', start: cursor, end: sIdx });
    }
    const tok = tokens[sIdx];

    // Top-level `import ...` (not `import(...)` or `import.meta`)
    if (tok.type === 'ident' && tok.value === 'import') {
      const afterImp = nextSig(tokens, sIdx + 1);
      const afterTok = afterImp < tokens.length ? tokens[afterImp] : null;
      if (afterTok && !(afterTok.type === 'punct' && (afterTok.value === '(' || afterTok.value === '.'))) {
        const stmtEnd = findStatementEndTokenIndex(tokens, sIdx);
        if (afterTok.type === 'string') {
          registerDep(unquoteJsStringLiteral(afterTok.value));
          cursor = stmtEnd;
          continue;
        }
        // Find `from "..."` near end of import statement
        let fromIdx = -1;
        let strIdx = -1;
        for (let m = stmtEnd - 1; m > sIdx; m--) {
          if (tokens[m].type === 'string' && strIdx === -1) {
            strIdx = m;
          } else if (strIdx !== -1 && tokens[m].type === 'ident' && tokens[m].value === 'from') {
            fromIdx = m;
            break;
          }
        }
        if (fromIdx !== -1 && strIdx !== -1) {
          const modVar = registerDep(unquoteJsStringLiteral(tokens[strIdx].value));
          let clauseText = '';
          for (let m = sIdx + 1; m < fromIdx; m++) {
            if (tokens[m].type !== 'comment') clauseText += tokens[m].value;
          }
          parseImportClause(clauseText, modVar, importBindings, namespaceConsts);
          for (let m = sIdx; m < stmtEnd; m++) skipDeclIdentIndices.add(m);
          cursor = stmtEnd;
          continue;
        }
      }
    }

    // Top-level `export ...`
    if (tok.type === 'ident' && tok.value === 'export') {
      const e1 = nextSig(tokens, sIdx + 1);
      const eTok = e1 < tokens.length ? tokens[e1] : null;

      // `export * from '...'` or `export * as ns from '...'`
      if (eTok && eTok.type === 'punct' && eTok.value === '*') {
        const stmtEnd = findStatementEndTokenIndex(tokens, sIdx);
        const e2 = nextSig(tokens, e1 + 1);
        if (e2 < stmtEnd && tokens[e2].type === 'ident' && tokens[e2].value === 'as') {
          const nsIdx = nextSig(tokens, e2 + 1);
          const fromIdx = nextSig(tokens, nsIdx + 1);
          const strIdx = nextSig(tokens, fromIdx + 1);
          if (strIdx < stmtEnd && tokens[strIdx].type === 'string') {
            const modVar = registerDep(unquoteJsStringLiteral(tokens[strIdx].value));
            const expName = tokens[nsIdx].value;
            explicitExports.push({ expName, localName: null, customGetter: `() => ${modVar}` });
            cursor = stmtEnd;
            continue;
          }
        } else if (e2 < stmtEnd && tokens[e2].type === 'ident' && tokens[e2].value === 'from') {
          const strIdx = nextSig(tokens, e2 + 1);
          if (strIdx < stmtEnd && tokens[strIdx].type === 'string') {
            const modVar = registerDep(unquoteJsStringLiteral(tokens[strIdx].value));
            starReExports.push(modVar);
            cursor = stmtEnd;
            continue;
          }
        }
      }

      // `export { ... } [from '...']`
      if (eTok && eTok.type === 'punct' && eTok.value === '{') {
        const closeB = findMatchingClose(tokens, eTok ? e1 : sIdx);
        const afterClose = nextSig(tokens, closeB + 1);
        let stmtEnd = closeB + 1;
        let fromModVar = null;
        if (afterClose < tokens.length && tokens[afterClose].type === 'ident' && tokens[afterClose].value === 'from') {
          const strIdx = nextSig(tokens, afterClose + 1);
          stmtEnd = findStatementEndTokenIndex(tokens, strIdx);
          if (strIdx < tokens.length && tokens[strIdx].type === 'string') {
            fromModVar = registerDep(unquoteJsStringLiteral(tokens[strIdx].value));
          }
        } else if (afterClose < tokens.length && tokens[afterClose].type === 'punct' && tokens[afterClose].value === ';') {
          stmtEnd = afterClose + 1;
        }
        let innerStr = '';
        for (let m = e1 + 1; m < closeB; m++) {
          if (tokens[m].type !== 'comment') innerStr += tokens[m].value;
        }
        for (const rawPart of innerStr.split(',')) {
          const part = rawPart.trim();
          if (!part) continue;
          const asM = part.match(/^([A-Za-z_$][\w$]*|default)\s+as\s+([A-Za-z_$][\w$]*|default)$/);
          const localN = asM ? asM[1] : part;
          const expN = asM ? asM[2] : part;
          if (fromModVar) {
            explicitExports.push({
              expName: expN,
              localName: null,
              customGetter: `() => ${fromModVar}[${JSON.stringify(localN)}]`,
            });
          } else {
            explicitExports.push({ expName: expN, localName: localN, customGetter: null });
          }
        }
        for (let m = sIdx; m < stmtEnd; m++) skipDeclIdentIndices.add(m);
        cursor = stmtEnd;
        continue;
      }

      // `export default ...`
      if (eTok && eTok.type === 'ident' && eTok.value === 'default') {
        const d1 = nextSig(tokens, e1 + 1);
        const dTok = d1 < tokens.length ? tokens[d1] : null;

        // `export default [async] function [*] [Foo](...) { ... }`
        if (
          dTok &&
          dTok.type === 'ident' &&
          (dTok.value === 'function' ||
            (dTok.value === 'async' &&
              nextSig(tokens, d1 + 1) < tokens.length &&
              tokens[nextSig(tokens, d1 + 1)].value === 'function' &&
              !hasNewlineBetween(tokens, d1, nextSig(tokens, d1 + 1))))
        ) {
          const fnKwIdx = dTok.value === 'async' ? nextSig(tokens, d1 + 1) : d1;
          let cur = nextSig(tokens, fnKwIdx + 1);
          if (cur < tokens.length && tokens[cur].type === 'punct' && tokens[cur].value === '*') {
            cur = nextSig(tokens, cur + 1);
          }
          let fnName = null;
          if (cur < tokens.length && tokens[cur].type === 'ident') {
            fnName = tokens[cur].value;
            skipDeclIdentIndices.add(cur);
            cur = nextSig(tokens, cur + 1);
          }
          const closeP = findMatchingClose(tokens, cur);
          const bodyBrace = nextSig(tokens, closeP + 1);
          const closeB = findMatchingClose(tokens, bodyBrace);
          if (fnName) {
            // Rev6-F4 #3: Named `export default function Foo` creates a hoisted mutable local binding `Foo` AND live default getter!
            rootScope.bindings.add(fnName);
            hoistedFunctionDecls.push({ name: fnName, start: d1, end: closeB + 1 });
            explicitExports.push({ expName: 'default', localName: fnName, customGetter: null });
          } else {
            const defVar = '__default';
            tdzBindings.set(defVar, { kind: 'let', varName: defVar, label: '*default*' });
            explicitExports.push({
              expName: 'default',
              localName: null,
              customGetter: `() => __checkTdz(__default, '*default*')`,
            });
            topStatements.push({ type: 'anon_default_expr', exprStart: d1, exprEnd: closeB + 1 });
          }
          cursor = closeB + 1;
          continue;
        }

        // `export default class [Bar] ... { ... }`
        if (dTok && dTok.type === 'ident' && dTok.value === 'class') {
          let cur = nextSig(tokens, d1 + 1);
          let clsName = null;
          if (cur < tokens.length && tokens[cur].type === 'ident' && tokens[cur].value !== 'extends') {
            clsName = tokens[cur].value;
            skipDeclIdentIndices.add(cur);
          }
          // Find class body `{ ... }`
          let bodyOpen = cur;
          while (bodyOpen < tokens.length && !(tokens[bodyOpen].type === 'punct' && tokens[bodyOpen].value === '{')) {
            bodyOpen++;
          }
          const closeB = findMatchingClose(tokens, bodyOpen);
          if (clsName) {
            // Rev6-F4 #3: Named `export default class Bar` creates a TDZ-checked mutable local binding `Bar` AND live default getter!
            rootScope.bindings.add(clsName);
            tdzBindings.set(clsName, { kind: 'class', varName: clsName });
            explicitExports.push({ expName: 'default', localName: clsName, customGetter: null });
            topStatements.push({ type: 'class_decl', name: clsName, start: d1, end: closeB + 1 });
          } else {
            const defVar = '__default';
            tdzBindings.set(defVar, { kind: 'let', varName: defVar, label: '*default*' });
            explicitExports.push({
              expName: 'default',
              localName: null,
              customGetter: `() => __checkTdz(__default, '*default*')`,
            });
            topStatements.push({ type: 'anon_default_expr', exprStart: d1, exprEnd: closeB + 1 });
          }
          cursor = closeB + 1;
          continue;
        }

        // Anonymous `export default <AssignmentExpression>;`
        const stmtEnd = findStatementEndTokenIndex(tokens, d1);
        let exprEnd = stmtEnd;
        const lastS = prevSig(tokens, stmtEnd - 1);
        if (lastS >= d1 && tokens[lastS].type === 'punct' && tokens[lastS].value === ';') {
          exprEnd = lastS;
        }
        const defVar = '__default';
        tdzBindings.set(defVar, { kind: 'let', varName: defVar, label: '*default*' });
        explicitExports.push({
          expName: 'default',
          localName: null,
          customGetter: `() => __checkTdz(__default, '*default*')`,
        });
        topStatements.push({ type: 'anon_default_expr', exprStart: d1, exprEnd });
        cursor = stmtEnd;
        continue;
      }

      // `export [async] function [*] fn(...) { ... }`
      if (
        eTok &&
        eTok.type === 'ident' &&
        (eTok.value === 'function' ||
          (eTok.value === 'async' &&
            nextSig(tokens, e1 + 1) < tokens.length &&
            tokens[nextSig(tokens, e1 + 1)].value === 'function'))
      ) {
        const fnKwIdx = eTok.value === 'async' ? nextSig(tokens, e1 + 1) : e1;
        let cur = nextSig(tokens, fnKwIdx + 1);
        if (cur < tokens.length && tokens[cur].type === 'punct' && tokens[cur].value === '*') {
          cur = nextSig(tokens, cur + 1);
        }
        const fnName = tokens[cur].value;
        skipDeclIdentIndices.add(cur);
        const openP = nextSig(tokens, cur + 1);
        const closeP = findMatchingClose(tokens, openP);
        const bodyBrace = nextSig(tokens, closeP + 1);
        const closeB = findMatchingClose(tokens, bodyBrace);
        rootScope.bindings.add(fnName);
        hoistedFunctionDecls.push({ name: fnName, start: e1, end: closeB + 1 });
        explicitExports.push({ expName: fnName, localName: fnName, customGetter: null });
        cursor = closeB + 1;
        continue;
      }

      // `export class Foo ... { ... }`
      if (eTok && eTok.type === 'ident' && eTok.value === 'class') {
        const nameIdx = nextSig(tokens, e1 + 1);
        const clsName = tokens[nameIdx].value;
        skipDeclIdentIndices.add(nameIdx);
        let bodyOpen = nameIdx + 1;
        while (bodyOpen < tokens.length && !(tokens[bodyOpen].type === 'punct' && tokens[bodyOpen].value === '{')) {
          bodyOpen++;
        }
        const closeB = findMatchingClose(tokens, bodyOpen);
        rootScope.bindings.add(clsName);
        tdzBindings.set(clsName, { kind: 'class', varName: clsName });
        explicitExports.push({ expName: clsName, localName: clsName, customGetter: null });
        topStatements.push({ type: 'class_decl', name: clsName, start: e1, end: closeB + 1 });
        cursor = closeB + 1;
        continue;
      }

      // `export const/let/var ...`
      if (eTok && eTok.type === 'ident' && (eTok.value === 'const' || eTok.value === 'let' || eTok.value === 'var')) {
        const kind = eTok.value;
        const declListStart = nextSig(tokens, e1 + 1);
        const stmtEnd = findStatementEndTokenIndex(tokens, declListStart);
        const decls = splitDeclarators(tokens, declListStart, stmtEnd);
        for (const d of decls) {
          for (const n of d.names) {
            rootScope.bindings.add(n);
            if (kind === 'let' || kind === 'const') {
              tdzBindings.set(n, { kind, varName: n });
            }
            explicitExports.push({ expName: n, localName: n, customGetter: null });
          }
          for (let dk = d.lhsStart; dk < d.lhsEnd; dk++) skipDeclIdentIndices.add(dk);
        }
        topStatements.push({ type: 'var_decl', kind, decls, stmtEnd });
        cursor = stmtEnd;
        continue;
      }
    }

    // Non-exported top-level `[async] function [*] fn(...) { ... }`
    if (
      tok.type === 'ident' &&
      (tok.value === 'function' ||
        (tok.value === 'async' &&
          nextSig(tokens, sIdx + 1) < tokens.length &&
          tokens[nextSig(tokens, sIdx + 1)].value === 'function' &&
          !hasNewlineBetween(tokens, sIdx, nextSig(tokens, sIdx + 1))))
    ) {
      const fnKwIdx = tok.value === 'async' ? nextSig(tokens, sIdx + 1) : sIdx;
      let cur = nextSig(tokens, fnKwIdx + 1);
      if (cur < tokens.length && tokens[cur].type === 'punct' && tokens[cur].value === '*') {
        cur = nextSig(tokens, cur + 1);
      }
      if (cur < tokens.length && tokens[cur].type === 'ident') {
        const fnName = tokens[cur].value;
        skipDeclIdentIndices.add(cur);
        const openP = nextSig(tokens, cur + 1);
        if (openP < tokens.length && tokens[openP].type === 'punct' && tokens[openP].value === '(') {
          const closeP = findMatchingClose(tokens, openP);
          const bodyBrace = nextSig(tokens, closeP + 1);
          if (bodyBrace < tokens.length && tokens[bodyBrace].type === 'punct' && tokens[bodyBrace].value === '{') {
            const closeB = findMatchingClose(tokens, bodyBrace);
            rootScope.bindings.add(fnName);
            hoistedFunctionDecls.push({ name: fnName, start: sIdx, end: closeB + 1 });
            cursor = closeB + 1;
            continue;
          }
        }
      }
    }

    // Non-exported top-level `class Foo ... { ... }`
    if (tok.type === 'ident' && tok.value === 'class') {
      const nameIdx = nextSig(tokens, sIdx + 1);
      if (nameIdx < tokens.length && tokens[nameIdx].type === 'ident' && tokens[nameIdx].value !== 'extends') {
        const clsName = tokens[nameIdx].value;
        skipDeclIdentIndices.add(nameIdx);
        let bodyOpen = nameIdx + 1;
        while (bodyOpen < tokens.length && !(tokens[bodyOpen].type === 'punct' && tokens[bodyOpen].value === '{')) {
          bodyOpen++;
        }
        if (bodyOpen < tokens.length) {
          const closeB = findMatchingClose(tokens, bodyOpen);
          rootScope.bindings.add(clsName);
          tdzBindings.set(clsName, { kind: 'class', varName: clsName });
          topStatements.push({ type: 'class_decl', name: clsName, start: sIdx, end: closeB + 1 });
          cursor = closeB + 1;
          continue;
        }
      }
    }

    // Non-exported top-level `let / const / var ...`
    if (tok.type === 'ident' && (tok.value === 'let' || tok.value === 'const' || tok.value === 'var')) {
      const kind = tok.value;
      const declListStart = nextSig(tokens, sIdx + 1);
      if (
        declListStart < tokens.length &&
        ((tokens[declListStart].type === 'ident' && !JS_RESERVED_KEYWORDS.has(tokens[declListStart].value)) ||
          (tokens[declListStart].type === 'punct' &&
            (tokens[declListStart].value === '{' || tokens[declListStart].value === '[')))
      ) {
        const stmtEnd = findStatementEndTokenIndex(tokens, declListStart);
        const decls = splitDeclarators(tokens, declListStart, stmtEnd);
        for (const d of decls) {
          for (const n of d.names) {
            rootScope.bindings.add(n);
            if (kind === 'let' || kind === 'const') {
              tdzBindings.set(n, { kind, varName: n });
            }
          }
          for (let dk = d.lhsStart; dk < d.lhsEnd; dk++) skipDeclIdentIndices.add(dk);
        }
        topStatements.push({ type: 'var_decl', kind, decls, stmtEnd });
        cursor = stmtEnd;
        continue;
      }
    }

    // Generic top-level statement (control flow, expression, block, etc.)
    if (tok.type === 'punct' && tok.value === '{') {
      const closeB = findMatchingClose(tokens, sIdx);
      topStatements.push({ type: 'raw', start: sIdx, end: closeB + 1 });
      cursor = closeB + 1;
      continue;
    }

    if (tok.type === 'ident' && (tok.value === 'if' || tok.value === 'for' || tok.value === 'while' || tok.value === 'switch' || tok.value === 'try')) {
      // Advance carefully over compound control statement
      let stmtEnd = findStatementEndTokenIndex(tokens, sIdx);
      let scan = sIdx + 1;
      while (scan < tokens.length) {
        const sig = nextSig(tokens, scan);
        if (sig >= tokens.length) {
          stmtEnd = tokens.length;
          break;
        }
        if (tokens[sig].type === 'punct' && tokens[sig].value === '(') {
          scan = findMatchingClose(tokens, sig) + 1;
          continue;
        }
        if (tokens[sig].type === 'punct' && tokens[sig].value === '{') {
          const closeB = findMatchingClose(tokens, sig);
          const afterB = nextSig(tokens, closeB + 1);
          if (
            afterB < tokens.length &&
            tokens[afterB].type === 'ident' &&
            (tokens[afterB].value === 'else' || tokens[afterB].value === 'catch' || tokens[afterB].value === 'finally')
          ) {
            scan = afterB + 1;
            continue;
          }
          stmtEnd = closeB + 1;
          break;
        }
        stmtEnd = findStatementEndTokenIndex(tokens, sig);
        break;
      }
      topStatements.push({ type: 'raw', start: sIdx, end: stmtEnd });
      cursor = stmtEnd;
      continue;
    }

    const stmtEnd = findStatementEndTokenIndex(tokens, sIdx);
    topStatements.push({ type: 'raw', start: sIdx, end: stmtEnd });
    cursor = stmtEnd;
  }

  const rewriteCtx = {
    rootScope,
    tokenScope,
    declarationNameTokens,
    importBindings,
    tdzBindings,
    skipDeclIdentIndices,
    modUrl,
    registerDep,
  };

  // Emit Phase 1 (instantiate declarations inside single module closure)
  const phase1Lines = [];
  for (const ns of namespaceConsts) {
    phase1Lines.push(`const ${ns.localName} = ${ns.modVar};`);
  }
  const declaredVarNames = new Set();
  for (const [varName] of tdzBindings) {
    declaredVarNames.add(varName);
    phase1Lines.push(`let ${varName} = __TDZ;`);
  }
  for (const stmt of topStatements) {
    if (stmt.type === 'var_decl' && stmt.kind === 'var') {
      for (const d of stmt.decls) {
        for (const n of d.names) {
          if (!declaredVarNames.has(n)) {
            declaredVarNames.add(n);
            phase1Lines.push(`var ${n} = undefined;`);
          }
        }
      }
    }
  }
  for (const fnDecl of hoistedFunctionDecls) {
    const renderedFn = renderRewrittenSlice(tokens, fnDecl.start, fnDecl.end, rewriteCtx);
    phase1Lines.push(`let ${fnDecl.name} = ${renderedFn};`);
  }

  // Emit Phase 2 (`link()` — called in DFS post-order so leaf modules populate exports before star re-exporters!)
  const linkLines = [];
  const explicitExportNameSet = new Set();
  for (const exp of explicitExports) {
    if (!exp.expName || explicitExportNameSet.has(exp.expName)) continue;
    explicitExportNameSet.add(exp.expName);
    let getterFn = exp.customGetter;
    if (!getterFn) {
      const localN = exp.localName;
      if (importBindings.has(localN)) {
        getterFn = `() => ${importBindings.get(localN).expr}`;
      } else if (tdzBindings.has(localN)) {
        getterFn = `() => __checkTdz(${tdzBindings.get(localN).varName}, ${JSON.stringify(localN)})`;
      } else {
        getterFn = `() => ${localN}`;
      }
    }
    linkLines.push(
      `Object.defineProperty(__exports, ${JSON.stringify(exp.expName)}, { enumerable: true, configurable: true, get: ${getterFn} });`
    );
  }
  for (const starModVar of starReExports) {
    linkLines.push(
      `Object.keys(${starModVar}).forEach((__k) => { if (__k !== 'default' && !Object.prototype.hasOwnProperty.call(__exports, __k)) { Object.defineProperty(__exports, __k, { enumerable: true, configurable: true, get: () => ${starModVar}[__k] }); } });`
    );
  }

  // Emit Phase 3 (`evaluate()` — executes top-level statements in exact source order)
  const evalChunks = [];
  for (const stmt of topStatements) {
    if (stmt.type === 'raw') {
      evalChunks.push(renderRewrittenSlice(tokens, stmt.start, stmt.end, rewriteCtx));
      continue;
    }
    if (stmt.type === 'anon_default_expr') {
      const exprCode = renderRewrittenSlice(tokens, stmt.exprStart, stmt.exprEnd, rewriteCtx);
      evalChunks.push(`__default = (${exprCode});\n`);
      continue;
    }
    if (stmt.type === 'class_decl') {
      const clsExpr = renderRewrittenSlice(tokens, stmt.start, stmt.end, rewriteCtx);
      evalChunks.push(`${stmt.name} = (${clsExpr});\n`);
      continue;
    }
    if (stmt.type === 'var_decl') {
      const initStmts = [];
      for (const d of stmt.decls) {
        const lhsText = tokens
          .slice(d.lhsStart, d.lhsEnd)
          .map((t) => t.value)
          .join('')
          .trim();
        if (d.eqIdx !== -1) {
          const rhsCode = renderRewrittenSlice(tokens, d.rhsStart, d.rhsEnd, rewriteCtx).trim();
          if (/^[A-Za-z_$][\w$]*$/.test(lhsText)) {
            initStmts.push(`${lhsText} = (${rhsCode});`);
          } else {
            // Destructuring declaration (`const { a, b = 1 } = rhs` or `let [x, y] = rhs`):
            // Evaluate into temporary destructuring locals then flip each module binding out of __TDZ!
            const tmpMap = d.names.map((n, idx) => ({ orig: n, tmp: `__d_${modId}_${idx}_${n}` }));
            let tmpLhs = lhsText;
            for (const { orig, tmp } of tmpMap) {
              tmpLhs = tmpLhs.replace(new RegExp(`\\b${orig}\\b`, 'g'), (m, off, s) => {
                let p = off - 1;
                while (p >= 0 && /\s/.test(s[p])) p--;
                let nx = off + m.length;
                while (nx < s.length && /\s/.test(s[nx])) nx++;
                if (s[nx] === ':' && (p < 0 || s[p] === '{' || s[p] === ',')) return m;
                if ((p < 0 || s[p] === '{' || s[p] === ',') && (nx >= s.length || s[nx] === ',' || s[nx] === '}' || s[nx] === '=')) {
                  return `${orig}: ${tmp}`;
                }
                return tmp;
              });
            }
            const assigns = tmpMap.map(({ orig, tmp }) => `${orig} = ${tmp};`).join(' ');
            initStmts.push(`{ const ${tmpLhs} = (${rhsCode}); ${assigns} }`);
          }
        } else if (stmt.kind === 'let') {
          // Rev6-F4 #3: Uninitialized `let x;` MUST transition from `__TDZ` to `undefined` at the declaration point!
          for (const n of d.names) {
            initStmts.push(`${n} = undefined;`);
          }
        }
      }
      evalChunks.push(`${initStmts.join(' ')}\n`);
    }
  }

  const factoryCode = [
    `function __createMod_${modId}(__exports, __mods, __TDZ, __checkTdz, __constErr) {`,
    phase1Lines.join('\n'),
    '  return {',
    '    link() {',
    `      ${linkLines.join('\n      ')}`,
    '    },',
    '    async evaluate() {',
    evalChunks.join(''),
    '    },',
    '  };',
    '}',
  ]
    .join('\n')
    .replace(/<\/(script)/gi, '<\\/$1');

  return {
    modId,
    modUrl,
    deps: depOrder,
    factoryCode,
  };
}

// Bundles a module graph (rootUrl + transitive dependencies) into a self-contained async runner executing:
// Phase 1: instantiate all module closures -> Phase 2: link() in DFS post-order -> Phase 3: evaluate() in DFS post-order!
async function buildEsModuleGraphBundle({
  entryUrl,
  fetchSource,
  resolveImportUrl,
  workerGlobalsPreamble = '',
}) {
  if (typeof fetchSource !== 'function') {
    throw new TypeError('buildEsModuleGraphBundle requires fetchSource(url)');
  }
  const moduleByUrl = new Map();
  const modulesById = [];

  const getOrCreateEntry = (url) => {
    let entry = moduleByUrl.get(url);
    if (!entry) {
      const id = modulesById.length;
      entry = { id, url, compiled: null };
      moduleByUrl.set(url, entry);
      modulesById.push(entry);
    }
    return entry;
  };

  const resolveDep = (specifier, importerUrl) => {
    const resolvedUrl =
      typeof resolveImportUrl === 'function'
        ? resolveImportUrl(specifier, importerUrl)
        : new URL(specifier, importerUrl).href;
    const depEntry = getOrCreateEntry(resolvedUrl);
    return {
      id: depEntry.id,
      url: resolvedUrl,
      varExpr: `__mods[${depEntry.id}]`,
    };
  };

  const visited = new Set();
  const postOrderIds = [];

  const visitDfs = async (curUrl) => {
    const entry = getOrCreateEntry(curUrl);
    if (visited.has(entry.id)) return;
    visited.add(entry.id);
    const rawCode = await fetchSource(curUrl);
    const compiled = compileEsModule(rawCode, {
      modUrl: curUrl,
      modId: entry.id,
      resolveDep,
    });
    entry.compiled = compiled;
    for (const depId of compiled.deps) {
      const depEntry = modulesById[depId];
      if (depEntry && !visited.has(depEntry.id)) {
        await visitDfs(depEntry.url);
      }
    }
    postOrderIds.push(entry.id);
  };

  await visitDfs(entryUrl);

  const lines = [
    '(async () => {',
    workerGlobalsPreamble || '',
    "const __TDZ = Symbol('TDZ');",
    'const __checkTdz = (v, n) => { if (v === __TDZ) throw new ReferenceError(`Cannot access \'${n}\' before initialization`); return v; };',
    'const __constErr = (n) => { throw new TypeError(`Assignment to constant variable \'${n}\'.`); };',
    `const __mods = Array.from({ length: ${modulesById.length} }, () => Object.create(null));`,
  ];

  for (const modEntry of modulesById) {
    lines.push(modEntry.compiled.factoryCode);
  }

  // Phase 1: Instantiate all module closures
  lines.push(`const __records = [${modulesById.map((m) => `__createMod_${m.id}(__mods[${m.id}], __mods, __TDZ, __checkTdz, __constErr)`).join(', ')}];`);

  // Phase 2: Link in DFS post-order (leaf dependencies BEFORE parent star re-exporters!)
  lines.push(`const __postOrder = ${JSON.stringify(postOrderIds)};`);
  lines.push('for (const __id of __postOrder) { __records[__id].link(); }');

  // Phase 3: Evaluate in DFS post-order
  lines.push('for (const __id of __postOrder) { await __records[__id].evaluate(); }');
  lines.push('return __mods[0];');
  lines.push('})()');

  return {
    bundleExpression: lines.join('\n').replace(/<\/(script)/gi, '<\\/$1'),
    moduleCount: modulesById.length,
    postOrderIds,
  };
}

module.exports = {
  lexJsTokens,
  analyzeScopes,
  rewriteWorkerGlobalBindings,
  compileEsModule,
  buildEsModuleGraphBundle,
};
