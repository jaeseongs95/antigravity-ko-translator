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
const LEGACY_OPENAI_TEMP_MODEL_RE = /^(?:gpt-3\.5|gpt-4(?:$|o$|o-|[-.])|chatgpt-4o)/i;
const REASONING_OR_MODERN_OPENAI_MODEL_RE = /^(?:o[1-9](?:$|-|\.)|gpt-(?:[5-9]|\d{2,})(?:$|-|\.)|codex(?:$|-|\.))/i;
const REDACT_SECRET_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{8,})\b/g;

function supportsOpenAiZeroTemperature(validated) {
  const baseModel = String((validated && validated.model) || '').trim().split('/').pop() || '';
  if (validated && validated.preset === 'openai') {
    return LEGACY_OPENAI_TEMP_MODEL_RE.test(baseModel);
  }
  return !REASONING_OR_MODERN_OPENAI_MODEL_RE.test(baseModel);
}

const CLOUD_API_PRESETS = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: '',
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
    defaultModel: '',
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
    defaultModel: '',
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
    defaultModel: '',
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

function validateCloudApiConfig(rawCfg = {}, { requireModel = false } = {}) {
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

  const rawModel = typeof src.model === 'string' ? src.model.trim() : '';
  if (!rawModel) {
    if (requireModel) {
      throw new Error('ERR_CLOUD_API_MODEL_REQUIRED');
    }
  } else if (!SAFE_MODEL_RE.test(rawModel)) {
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
  if (!validated || !validated.model) {
    throw new Error('ERR_CLOUD_API_MODEL_REQUIRED');
  }
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
    const allowZeroTemp = supportsOpenAiZeroTemperature(validated);
    bodyObj = {
      model: validated.model,
      messages: [
        { role: 'system', content: LLM_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    };
    if (allowZeroTemp) {
      bodyObj.temperature = 0;
    }
    if (validated.preset === 'openai') {
      bodyObj.max_completion_tokens = maxTokens;
    } else {
      bodyObj.max_tokens = maxTokens;
    }
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

async function extractCloudApiErrorDetail(res) {
  if (!res || typeof res.text !== 'function') return '';
  let rawText = '';
  try {
    rawText = String((await res.text()) || '').trim();
  } catch (_err) {
    return '';
  }
  if (!rawText) return '';
  let detail = '';
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object') {
      if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string') {
        detail = parsed.error.message;
      } else if (typeof parsed.error === 'string') {
        detail = parsed.error;
      } else if (typeof parsed.message === 'string') {
        detail = parsed.message;
      }
    }
  } catch (_jsonErr) {
    detail = rawText;
  }
  const cleaned = String(detail || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(REDACT_SECRET_RE, '[REDACTED]')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned;
}

function formatCloudApiError(errOrStatus, detail = '') {
  const suffix = typeof detail === 'string' && detail.trim() ? `: ${detail.trim()}` : '';
  if (typeof errOrStatus === 'number') {
    if (errOrStatus === 401 || errOrStatus === 403) {
      return `API 인증 실패 (HTTP ${errOrStatus}) — API 키와 권한을 확인해 주세요${suffix}`;
    }
    if (errOrStatus === 429) {
      return `API 호출 한도 초과 (HTTP 429) — 잠시 후 다시 시도해 주세요${suffix}`;
    }
    return `외부 API HTTP 오류 (${errOrStatus})${suffix}`;
  }
  const msg = String(errOrStatus && errOrStatus.message ? errOrStatus.message : errOrStatus || '');
  if (msg === 'ERR_CLOUD_API_MODEL_REQUIRED') {
    return '모델이 선택되지 않았습니다. API 키 입력 후 [불러오기]로 모델을 선택하거나 직접 입력해 주세요.';
  }
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

function buildCloudModelsUrl(validated) {
  const cleanBase = String(validated.baseUrl || '').replace(/\/+$/, '');
  if (validated.protocol === 'anthropic') {
    const stripped = cleanBase.replace(/\/v1\/messages$/i, '').replace(/\/v1$/i, '');
    return `${stripped}/v1/models?limit=100&lifecycle=active`;
  }
  if (validated.protocol === 'gemini') {
    const stripped = cleanBase
      .replace(/\/v1beta\/models\/[^/]+(?::[A-Za-z]+)?$/i, '')
      .replace(/\/v1beta\/models$/i, '')
      .replace(/\/v1beta$/i, '');
    return `${stripped}/v1beta/models?pageSize=100`;
  }
  const stripped = cleanBase.replace(/\/chat\/completions$/i, '');
  if (/\/models$/i.test(stripped)) return stripped;
  if (/\/v1$/i.test(stripped)) return `${stripped}/models`;
  return `${stripped}/v1/models`;
}

const OPENAI_NON_CHAT_OR_RETIRED_MODEL_RE =
  /(?:^gpt-live(?:$|-|\.)|^ft:|embedding|whisper|tts(?:$|-)|dall-e|moderation|realtime|transcribe|diarize|sora|audio|image|video|search(?:-preview|-api)?(?:$|-)|deep-research|computer-use|-healthcare(?:$|-)|-pro(?:$|-)|-codex(?:$|-)|^codex(?:$|-|\.)|-instruct(?:$|-)|^chat-latest$|^chatgpt-|^babbage|^davinci|^curie|^ada(?:$|-)|^gpt-3\.5(?:$|-|\.)|^gpt-4(?:$|-(?:0|1|3|turbo|vision|preview))|^o1(?:$|-))/i;
const OPENAI_DATED_SNAPSHOT_RE = /-(?:\d{4}-\d{2}-\d{2}|\d{4})$/;
const GEMINI_NON_TEXT_MODEL_RE =
  /(?:^|-)(?:imagen|veo|embedding|aqa|tts|image|audio|live|robotics|computer-use|deep-research|bisociative)(?:$|-)/i;
const GEMINI_DEPRECATED_DESC_RE = /(?:deprecated|discontinued|retired|shut\s*down|legacy\s+model)/i;
const GEMINI_NUMBERED_REV_RE = /-\d{3}$/;
const INACTIVE_STATUS_SET = new Set(['deprecated', 'retired', 'inactive', 'shutdown', 'discontinued', 'legacy']);
const MAX_RETURNED_CLOUD_MODELS = 200;

function isInactiveModelMetadata(item, nowMs = Date.now()) {
  if (!item || typeof item !== 'object') return true;
  if (item.deprecated === true || item.retired === true || item.is_deprecated === true) return true;
  if (item.active === false || item.enabled === false) return true;
  if (typeof item.lifecycle === 'string' && item.lifecycle.trim()) {
    if (item.lifecycle.trim().toLowerCase() !== 'active') return true;
  }
  if (typeof item.status === 'string' && item.status.trim()) {
    if (INACTIVE_STATUS_SET.has(item.status.trim().toLowerCase())) return true;
  }
  if (typeof item.deprecated_at === 'string' && item.deprecated_at.trim()) return true;
  if (typeof item.deprecatedAt === 'string' && item.deprecatedAt.trim()) return true;
  for (const field of ['retires_at', 'retired_at', 'shutdown_date', 'sunset_date']) {
    if (typeof item[field] === 'string' && item[field].trim()) {
      const ts = Date.parse(item[field]);
      if (Number.isFinite(ts) && ts <= nowMs) return true;
    }
  }
  return false;
}

function parseCloudApiModelsResponse(protocol, data, { preset = null, nowMs = Date.now() } = {}) {
  const seen = new Set();
  const rawItems = [];

  if (protocol === 'gemini') {
    const list = data && Array.isArray(data.models) ? data.models : [];
    for (const item of list) {
      if (isInactiveModelMetadata(item, nowMs)) continue;
      if (
        Array.isArray(item.supportedGenerationMethods) &&
        item.supportedGenerationMethods.length > 0 &&
        !item.supportedGenerationMethods.includes('generateContent')
      ) {
        continue;
      }
      if (typeof item.description === 'string' && GEMINI_DEPRECATED_DESC_RE.test(item.description)) {
        continue;
      }
      const id = String(item.name || '').replace(/^models\//i, '').trim();
      if (!id || !SAFE_MODEL_RE.test(id) || seen.has(id)) continue;
      if (GEMINI_NON_TEXT_MODEL_RE.test(id)) continue;
      seen.add(id);
      const displayName = typeof item.displayName === 'string' && item.displayName.trim() ? item.displayName.trim() : '';
      rawItems.push({
        id,
        label: displayName && displayName !== id ? `${id} (${displayName})` : id,
        created: 0,
      });
    }
  } else if (protocol === 'anthropic') {
    const list = data && Array.isArray(data.data) ? data.data : [];
    for (const item of list) {
      if (isInactiveModelMetadata(item, nowMs)) continue;
      const id = String(item.id || '').trim();
      if (!id || !SAFE_MODEL_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      const displayName = typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim() : '';
      rawItems.push({
        id,
        label: displayName && displayName !== id ? `${id} (${displayName})` : id,
        created: item.created_at ? Date.parse(item.created_at) || 0 : 0,
      });
    }
  } else {
    const list =
      data && Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    for (const item of list) {
      if (isInactiveModelMetadata(item, nowMs)) continue;
      const id = String(item.id || '').trim();
      if (!id || !SAFE_MODEL_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      const displayName = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '';
      rawItems.push({
        id,
        label: displayName && displayName !== id ? `${id} (${displayName})` : id,
        created: Number(item.created) || 0,
      });
    }
  }

  let filtered = rawItems;
  if (preset === 'openai') {
    const chatOnly = rawItems.filter((m) => !OPENAI_NON_CHAT_OR_RETIRED_MODEL_RE.test(m.id));
    const undated = chatOnly.filter((m) => !OPENAI_DATED_SNAPSHOT_RE.test(m.id));
    filtered = undated.length > 0 ? undated : chatOnly;
  } else if (protocol === 'gemini') {
    const idSet = new Set(rawItems.map((m) => m.id));
    filtered = rawItems.filter(
      (m) => !(GEMINI_NUMBERED_REV_RE.test(m.id) && idSet.has(m.id.replace(GEMINI_NUMBERED_REV_RE, '')))
    );
  }

  filtered.sort((a, b) => {
    if (b.created !== a.created) return b.created - a.created;
    return a.id.localeCompare(b.id);
  });

  return filtered.slice(0, MAX_RETURNED_CLOUD_MODELS).map(({ id, label }) => ({ id, label }));
}

async function fetchCloudApiModels({ config, fetchFn, signal = undefined } = {}) {
  if (typeof fetchFn !== 'function') {
    return { ok: false, status: 0, models: [], reason: 'ERR_FETCH_UNAVAILABLE' };
  }
  const validated = validateCloudApiConfig(config, { requireModel: false });
  const url = buildCloudModelsUrl(validated);
  const headers = { Accept: 'application/json' };
  if (validated.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
  }
  const secretHeaders = {
    [validated.headerName]: validated.headerPrefix
      ? { secretKey: validated.secretKey, prefix: validated.headerPrefix }
      : { secretKey: validated.secretKey },
  };
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers,
      secretHeaders,
      timeoutMs: Math.min(validated.timeoutMs, 15000),
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    if (!res || !res.ok) {
      const detail = await extractCloudApiErrorDetail(res);
      return {
        ok: false,
        status: res ? Number(res.status) || 0 : 0,
        models: [],
        reason: formatCloudApiError(res ? Number(res.status) || 0 : 'ERR_NO_RESPONSE', detail),
      };
    }
    const data = await res.json();
    const models = parseCloudApiModelsResponse(validated.protocol, data, { preset: validated.preset });
    if (models.length === 0) {
      return {
        ok: false,
        status: Number(res.status) || 200,
        models: [],
        reason: '사용 가능한 모델 목록이 비어 있습니다.',
      };
    }
    return { ok: true, status: Number(res.status) || 200, models, reason: null };
  } catch (err) {
    return { ok: false, status: 0, models: [], reason: formatCloudApiError(err) };
  }
}

async function probeCloudApiConnection({ config, fetchFn, signal = undefined } = {}) {
  if (typeof fetchFn !== 'function') {
    return { ok: false, status: 0, sample: '', reason: 'ERR_FETCH_UNAVAILABLE' };
  }
  let validated;
  try {
    validated = validateCloudApiConfig(config, { requireModel: true });
  } catch (err) {
    return { ok: false, status: 0, sample: '', reason: formatCloudApiError(err) };
  }
  const probeMaxTokens =
    validated.protocol === 'openai' && !supportsOpenAiZeroTemperature(validated) ? 512 : 64;
  const req = buildCloudApiRequest(validated, 'Translate to Korean:\nReady.', { maxTokens: probeMaxTokens });
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
      const detail = await extractCloudApiErrorDetail(res);
      return {
        ok: false,
        status: res ? Number(res.status) || 0 : 0,
        sample: '',
        reason: formatCloudApiError(res ? Number(res.status) || 0 : 'ERR_NO_RESPONSE', detail),
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
        return cfg.model ? `외부 API (${cfg.label} · ${cfg.model})` : `외부 API (${cfg.label})`;
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

      const validated = validateCloudApiConfig(cloudApiConfigPort.getCloudApiConfig(), { requireModel: true });

      const normalizedInput = String(text || '')
        .replace(/\(\s*using\s+(⟦[CT]\d+⟧)\s*\)/gi, 'using $1')
        .replace(/\bper\s+(⟦[CT]\d+⟧)/gi, 'according to $1');
      const allPlaceholders = normalizedInput.match(/⟦[CT]\d+⟧/g) || [];
      const tokenHint = allPlaceholders.length > 0 ? ` (필수 포함 토큰: ${allPlaceholders.join(', ')})` : '';

      const translateMaxTokens =
        validated.protocol === 'openai' && !supportsOpenAiZeroTemperature(validated) ? 2048 : 1024;
      const requestOnce = async (prefixPrompt) => {
        if (signal && signal.aborted) return '';
        const linked = createLinkedAbort(signal, validated.timeoutMs, setTimer, clearTimer);
        try {
          const req = buildCloudApiRequest(validated, `${prefixPrompt}\n${normalizedInput}`, {
            maxTokens: translateMaxTokens,
          });
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
            const detail = await extractCloudApiErrorDetail(res);
            throw new Error(formatCloudApiError(res ? Number(res.status) || 0 : 'ERR_NO_RESPONSE', detail));
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
  buildCloudModelsUrl,
  buildCloudApiRequest,
  parseCloudApiModelsResponse,
  extractCloudApiResponseText,
  extractCloudApiErrorDetail,
  formatCloudApiError,
  fetchCloudApiModels,
  probeCloudApiConnection,
  createCloudApiAdapter,
};
