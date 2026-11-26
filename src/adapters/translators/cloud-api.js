'use strict';

/**
 * External Cloud LLM Translation Adapter (OpenAI · Anthropic Claude · Google Gemini · OpenAI-Compatible)
 *
 * Security Invariants (v3.1.0 — Extenra v3.3.0 `ctx.secrets` + `net.fetch secretHeaders`):
 * - Strictly HTTPS non-loopback endpoints ONLY (blocks HTTP, loopback, RFC1918, link-local, IMDS, userinfo, secret queries).
 * - NEVER accepts or stores plaintext API keys inside config objects or `localStorage`.
 * - Passes ONLY declarative `secretHeaders` descriptors (`{ HeaderName: { secretKey, prefix? } }`) to `fetchFn`,
 *   so the Extenra host main process (Desktop OS-encrypted vault / Remote Bridge) injects credentials
 *   strictly AFTER the target URL passes allowlist checks.
 */

const {
  isInvalidCachedOrTranslatedText,
  restoreIdentifiersInThoughtText,
} = require('../../core/text-tokenizer');
const {
  isHttpsNonLoopbackEndpoint,
  validateTranslationEndpointUrl,
} = require('./endpoint-validator');
const { createLinkedAbort } = require('./google-translate');
const { LLM_SYSTEM_PROMPT, sanitizeLlmOutput } = require('./local-llm');

const SECRET_QUERY_RE = /[?&](?:key|api_key|apikey|token|access_token|secret|auth)=/i;
const SAFE_MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,127}$/;

const CLOUD_API_PRESETS = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    secretKey: 'cloud_api_key_openai',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    keyPlaceholder: 'sk-...',
  }),
  anthropic: Object.freeze({
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-4-5-20251001',
    secretKey: 'cloud_api_key_anthropic',
    headerName: 'x-api-key',
    headerPrefix: '',
    keyPlaceholder: 'sk-ant-...',
  }),
  gemini: Object.freeze({
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    secretKey: 'cloud_api_key_gemini',
    headerName: 'x-goog-api-key',
    headerPrefix: '',
    keyPlaceholder: 'AIza...',
  }),
  'openai-compat': Object.freeze({
    id: 'openai-compat',
    label: 'OpenAI 호환 (OpenRouter · DeepSeek · Groq 등)',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    secretKey: 'cloud_api_key_openai_compat',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    keyPlaceholder: 'sk-...',
  }),
});

const PRESET_ALIAS_MAP = Object.freeze({
  openai: 'openai',
  gpt: 'openai',
  anthropic: 'anthropic',
  claude: 'anthropic',
  gemini: 'gemini',
  google: 'gemini',
  'google-gemini': 'gemini',
  'openai-compat': 'openai-compat',
  compat: 'openai-compat',
  openrouter: 'openai-compat',
  deepseek: 'openai-compat',
  groq: 'openai-compat',
  custom: 'openai-compat',
});

const DEFAULT_CLOUD_API_CONFIG = Object.freeze({
  preset: 'openai',
  baseUrl: CLOUD_API_PRESETS.openai.baseUrl,
  model: CLOUD_API_PRESETS.openai.defaultModel,
  timeoutMs: 20000,
});

function normalizeCloudPresetId(rawPreset) {
  if (typeof rawPreset !== 'string') return 'openai';
  const key = rawPreset.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PRESET_ALIAS_MAP, key)) {
    return PRESET_ALIAS_MAP[key];
  }
  return 'openai';
}

function getCloudPreset(rawPreset) {
  const id = normalizeCloudPresetId(rawPreset);
  return CLOUD_API_PRESETS[id] || CLOUD_API_PRESETS.openai;
}

function getCloudSecretKeyForPreset(rawPreset) {
  return getCloudPreset(rawPreset).secretKey;
}

function validateCloudApiConfig(rawCfg = {}) {
  const src = rawCfg && typeof rawCfg === 'object' && !Array.isArray(rawCfg) ? rawCfg : {};
  const presetId = normalizeCloudPresetId(src.preset);
  const preset = CLOUD_API_PRESETS[presetId];

  const rawUrl =
    typeof src.baseUrl === 'string' && src.baseUrl.trim() ? src.baseUrl.trim() : preset.baseUrl;
  if (SECRET_QUERY_RE.test(rawUrl)) {
    throw new Error('ERR_CLOUD_API_SECRET_QUERY_FORBIDDEN');
  }
  const parsed = validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps: true });
  if (!isHttpsNonLoopbackEndpoint(parsed.href)) {
    throw new Error('ERR_CLOUD_API_HTTPS_REQUIRED');
  }

  const rawModel =
    typeof src.model === 'string' && src.model.trim() ? src.model.trim() : preset.defaultModel;
  if (!SAFE_MODEL_RE.test(rawModel)) {
    throw new Error('ERR_CLOUD_API_INVALID_MODEL');
  }

  const timeoutRaw = Number(src.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.min(120000, Math.max(1000, Math.trunc(timeoutRaw)))
    : DEFAULT_CLOUD_API_CONFIG.timeoutMs;

  return {
    preset: preset.id,
    protocol: preset.protocol,
    label: preset.label,
    secretKey: preset.secretKey,
    headerName: preset.headerName,
    headerPrefix: preset.headerPrefix,
    baseUrl: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`,
    hostname: parsed.hostname,
    model: rawModel,
    timeoutMs,
  };
}

function buildCloudApiUrl(validated) {
  const cleanBase = String(validated.baseUrl || '').replace(/\/+$/, '');
  if (validated.protocol === 'anthropic') {
    if (/\/v1\/messages$/i.test(cleanBase)) return cleanBase;
    return `${cleanBase.replace(/\/v1$/i, '')}/v1/messages`;
  }
  if (validated.protocol === 'gemini') {
    if (/:generateContent$/i.test(cleanBase)) return cleanBase;
    const stripped = cleanBase.replace(/\/v1beta\/models\/[^/]+$/i, '').replace(/\/v1beta$/i, '');
    return `${stripped}/v1beta/models/${encodeURIComponent(validated.model)}:generateContent`;
  }
  if (/\/chat\/completions$/i.test(cleanBase)) return cleanBase;
  if (/\/v1$/i.test(cleanBase)) return `${cleanBase}/chat/completions`;
  return `${cleanBase}/v1/chat/completions`;
}

function buildCloudApiRequest(validated, userPrompt, { maxTokens = 1024 } = {}) {
  const url = buildCloudApiUrl(validated);
  const headers = { 'Content-Type': 'application/json' };
  const secretHeaders = {
    [validated.headerName]: validated.headerPrefix
      ? { secretKey: validated.secretKey, prefix: validated.headerPrefix }
      : { secretKey: validated.secretKey },
  };

  let bodyObj;
  if (validated.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    bodyObj = {
      model: validated.model,
      max_tokens: maxTokens,
      temperature: 0,
      system: LLM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    };
  } else if (validated.protocol === 'gemini') {
    bodyObj = {
      systemInstruction: {
        parts: [{ text: LLM_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: maxTokens,
      },
    };
  } else {
    bodyObj = {
      model: validated.model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: LLM_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    };
  }

  return {
    url,
    method: 'POST',
    headers,
    secretHeaders,
    body: JSON.stringify(bodyObj),
  };
}

function extractCloudApiResponseText(protocol, data) {
  if (!data || typeof data !== 'object') return '';
  if (protocol === 'anthropic') {
    if (!Array.isArray(data.content)) return '';
    return data.content
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
  }
  if (protocol === 'gemini') {
    const first = Array.isArray(data.candidates) ? data.candidates[0] : null;
    const parts = first && first.content && Array.isArray(first.content.parts) ? first.content.parts : [];
    return parts
      .filter((p) => p && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
  }
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
  }
  return '';
}

function formatCloudApiError(errOrStatus) {
  if (typeof errOrStatus === 'number') {
    if (errOrStatus === 401 || errOrStatus === 403) {
      return `API 인증 실패 (HTTP ${errOrStatus}) — API 키와 권한을 확인해 주세요.`;
    }
    if (errOrStatus === 429) {
      return 'API 호출 한도 초과 (HTTP 429) — 잠시 후 다시 시도해 주세요.';
    }
    return `외부 API HTTP 오류 (${errOrStatus})`;
  }
  const msg = String(errOrStatus && errOrStatus.message ? errOrStatus.message : errOrStatus || '');
  if (msg.startsWith('ERR_SECRET_NOT_FOUND:')) {
    return 'API 키가 등록되지 않았습니다. 설정에서 API 키를 입력하고 저장해 주세요.';
  }
  if (msg === 'ERR_SECRETS_NOT_DECLARED' || msg === 'ERR_SECRETS_NET_BRIDGE_REQUIRED') {
    return 'Extenra v3.3.0 이상 호스트의 시크릿 저장소가 필요합니다.';
  }
  if (msg === 'ERR_NET_HOST_NOT_ALLOWED') {
    return '호스트 네트워크 허용 목록에 없는 도메인입니다. Remote Web의 Allowed HTTPS Hosts에서 도메인을 승인하거나 기본 프리셋을 사용해 주세요.';
  }
  return msg || '외부 API 요청에 실패했습니다.';
}

async function probeCloudApiConnection({ config, fetchFn, signal = undefined } = {}) {
  if (typeof fetchFn !== 'function') {
    return { ok: false, status: 0, sample: '', reason: 'ERR_FETCH_UNAVAILABLE' };
  }
  const validated = validateCloudApiConfig(config);
  const req = buildCloudApiRequest(validated, 'Translate to Korean:\nReady.', { maxTokens: 48 });
  try {
    const res = await fetchFn(req.url, {
      method: req.method,
      headers: req.headers,
      secretHeaders: req.secretHeaders,
      body: req.body,
      timeoutMs: Math.min(validated.timeoutMs, 15000),
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    if (!res || !res.ok) {
      return {
        ok: false,
        status: res ? Number(res.status) || 0 : 0,
        sample: '',
        reason: formatCloudApiError(res ? Number(res.status) || 0 : 'ERR_NO_RESPONSE'),
      };
    }
    const data = await res.json();
    const text = sanitizeLlmOutput(extractCloudApiResponseText(validated.protocol, data));
    if (!text) {
      return { ok: false, status: Number(res.status) || 200, sample: '', reason: '응답 본문에 번역 텍스트가 비어 있습니다.' };
    }
    return { ok: true, status: Number(res.status) || 200, sample: text.slice(0, 60), reason: null };
  } catch (err) {
    return { ok: false, status: 0, sample: '', reason: formatCloudApiError(err) };
  }
}

function createCloudApiAdapter({
  cloudApiConfigPort,
  fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  maxConcurrency = 2,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!cloudApiConfigPort || typeof cloudApiConfigPort.getCloudApiConfig !== 'function') {
    throw new TypeError('cloudApiConfigPort implementing getCloudApiConfig() is required');
  }
  if (typeof fetchFn !== 'function') {
    throw new TypeError('fetchFn is required for CloudApiAdapter');
  }

  return {
    id: 'cloud-api',
    get label() {
      try {
        const cfg = validateCloudApiConfig(cloudApiConfigPort.getCloudApiConfig());
        return `외부 API (${cfg.label} · ${cfg.model})`;
      } catch (_err) {
        return '외부 API (OpenAI · Claude · Gemini)';
      }
    },
    description: 'API 키 연결 외부 LLM 번역 · Extenra 암호화 시크릿 저장소 사용',
    supportsRemote: true,
    maxConcurrency,
    async translate(text, ctx = {}) {
      const signal = ctx && ctx.signal ? ctx.signal : undefined;
      if (signal && signal.aborted) return '';

      const validated = validateCloudApiConfig(cloudApiConfigPort.getCloudApiConfig());

      const normalizedInput = String(text || '')
        .replace(/\(\s*using\s+(⟦[CT]\d+⟧)\s*\)/gi, 'using $1')
        .replace(/\bper\s+(⟦[CT]\d+⟧)/gi, 'according to $1');
      const allPlaceholders = normalizedInput.match(/⟦[CT]\d+⟧/g) || [];
      const tokenHint = allPlaceholders.length > 0 ? ` (필수 포함 토큰: ${allPlaceholders.join(', ')})` : '';

      const requestOnce = async (prefixPrompt) => {
        if (signal && signal.aborted) return '';
        const linked = createLinkedAbort(signal, validated.timeoutMs, setTimer, clearTimer);
        try {
          const req = buildCloudApiRequest(validated, `${prefixPrompt}\n${normalizedInput}`, { maxTokens: 1024 });
          const res = await fetchFn(req.url, {
            method: req.method,
            headers: req.headers,
            secretHeaders: req.secretHeaders,
            body: req.body,
            timeoutMs: validated.timeoutMs,
            credentials: 'omit',
            redirect: 'error',
            signal: linked.signal,
          });
          if (!res || !res.ok) {
            throw new Error(formatCloudApiError(res ? Number(res.status) || 0 : 'ERR_NO_RESPONSE'));
          }
          const data = await res.json();
          const rawOut = extractCloudApiResponseText(validated.protocol, data);
          return sanitizeLlmOutput(rawOut);
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          throw new Error(formatCloudApiError(err));
        } finally {
          linked.cleanup();
        }
      };

      const sourceCheckText = typeof ctx.cleanText === 'string' && ctx.cleanText ? ctx.cleanText : String(text || '');
      const savedTokens = Array.isArray(ctx.savedTokens) ? ctx.savedTokens : [];

      let candidate = await requestOnce(`Translate to Korean (한글만 사용, 모든 토큰 유지)${tokenHint}:`);
      if (signal && signal.aborted) return '';

      const missingToken = allPlaceholders.some((tok) => !candidate.includes(tok));
      const previewRestored = restoreIdentifiersInThoughtText(candidate, savedTokens);
      if (!candidate || missingToken || isInvalidCachedOrTranslatedText(previewRestored, sourceCheckText)) {
        if (signal && signal.aborted) return '';
        const retry = await requestOnce(
          `Translate strictly to Korean (한글만 사용; 일본어·한자 절대 금지; ${allPlaceholders.join(', ')} 토큰 전부 포함):`
        );
        const retryRestored = restoreIdentifiersInThoughtText(retry, savedTokens);
        if (retry && !isInvalidCachedOrTranslatedText(retryRestored, sourceCheckText)) {
          candidate = retry;
        }
      }

      const finalRestored = restoreIdentifiersInThoughtText(candidate, savedTokens);
      if (!candidate || isInvalidCachedOrTranslatedText(finalRestored, sourceCheckText)) {
        return '';
      }
      return candidate;
    },
  };
}

module.exports = {
  CLOUD_API_PRESETS,
  DEFAULT_CLOUD_API_CONFIG,
  normalizeCloudPresetId,
  getCloudPreset,
  getCloudSecretKeyForPreset,
  validateCloudApiConfig,
  buildCloudApiUrl,
  buildCloudApiRequest,
  extractCloudApiResponseText,
  formatCloudApiError,
  probeCloudApiConnection,
  createCloudApiAdapter,
};
