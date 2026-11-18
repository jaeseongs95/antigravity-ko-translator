'use strict';

const { normalizeProviderId } = require('../../core/provider-registry');
const {
  isCanonicalLoopbackHost,
  validateTranslationEndpointUrl,
} = require('./endpoint-validator');
const { createLinkedAbort } = require('./google-translate');

const HEADER_NAME_REGEX = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const FORBIDDEN_HEADER_NAMES = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'host',
  'cookie',
  'cookie2',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'origin',
  'referer',
]);
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const SINGLE_PASS_TEMPLATE_VAR_REGEX = /\{\{(text|sourceLang|targetLang)\}\}/g;

function sanitizeLabel(rawLabel, fallbackId) {
  const cleaned = String(rawLabel || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  if (!cleaned) return fallbackId;
  return cleaned.slice(0, 80);
}

function sanitizeHeaders(rawHeaders) {
  const out = Object.create(null);
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    return Object.freeze(out);
  }
  for (const [rawName, rawVal] of Object.entries(rawHeaders)) {
    const name = String(rawName || '').trim();
    if (!name || !HEADER_NAME_REGEX.test(name)) {
      throw new RangeError(`Invalid HTTP header name: "${rawName}"`);
    }
    const lower = name.toLowerCase();
    if (
      FORBIDDEN_HEADER_NAMES.has(lower) ||
      lower.startsWith('sec-') ||
      lower.startsWith('proxy-')
    ) {
      throw new RangeError(`Forbidden HTTP header name: "${name}"`);
    }
    const val = String(rawVal ?? '');
    if (/[\r\n\0]/.test(val)) {
      throw new RangeError(`Header "${name}" contains forbidden CR/LF/NUL control characters`);
    }
    out[name] = val;
  }
  return Object.freeze(out);
}

function sanitizeBodyTemplate(val, depth = 0) {
  if (depth > 16) {
    throw new RangeError('bodyTemplate exceeds maximum nesting depth (16)');
  }
  if (val === null || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val)) {
    return Object.freeze(val.map((item) => sanitizeBodyTemplate(item, depth + 1)));
  }
  if (typeof val === 'object') {
    const clone = Object.create(null);
    for (const [k, v] of Object.entries(val)) {
      if (FORBIDDEN_PATH_SEGMENTS.has(k)) {
        continue;
      }
      clone[k] = sanitizeBodyTemplate(v, depth + 1);
    }
    return Object.freeze(clone);
  }
  throw new TypeError(`Unsupported value type in bodyTemplate: ${typeof val}`);
}

function validateResponsePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new TypeError('responsePath must be a non-empty dot-separated path');
  }
  const segments = rawPath
    .trim()
    .split('.')
    .map((s) => s.trim());
  if (segments.length === 0 || segments.some((s) => !s || FORBIDDEN_PATH_SEGMENTS.has(s))) {
    throw new RangeError(`Invalid or forbidden segment in responsePath: "${rawPath}"`);
  }
  return segments.join('.');
}

function interpolateTemplateNode(node, vars) {
  if (typeof node === 'string') {
    return node.replace(SINGLE_PASS_TEMPLATE_VAR_REGEX, (_full, key) => String(vars[key] ?? ''));
  }
  if (Array.isArray(node)) {
    return node.map((item) => interpolateTemplateNode(item, vars));
  }
  if (node && typeof node === 'object') {
    const out = Object.create(null);
    for (const k of Object.keys(node)) {
      out[k] = interpolateTemplateNode(node[k], vars);
    }
    return out;
  }
  return node;
}

function extractResponseValue(rootObj, responsePath) {
  const segments = responsePath.split('.');
  let cur = rootObj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return '';
    }
    if (FORBIDDEN_PATH_SEGMENTS.has(seg) || !Object.prototype.hasOwnProperty.call(cur, seg)) {
      return '';
    }
    cur = cur[seg];
  }
  return typeof cur === 'string' ? cur.trim() : '';
}

function validateCustomProviderSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
    throw new TypeError('CustomProviderSpec must be an object');
  }
  const id = normalizeProviderId(rawSpec.id);
  if (!id) {
    throw new RangeError(`Invalid custom provider id: "${String(rawSpec.id)}"`);
  }
  if (id === 'google-translate' || id === 'local-llm') {
    throw new RangeError(`Custom provider id "${id}" conflicts with built-in provider`);
  }
  const label = sanitizeLabel(rawSpec.label, id);
  const allowRemoteHttps = Boolean(rawSpec.allowRemoteHttps);
  const parsedUrl = validateTranslationEndpointUrl(rawSpec.endpointUrl, { allowRemoteHttps });
  const method = rawSpec.method === undefined ? 'POST' : String(rawSpec.method).toUpperCase();
  if (method !== 'POST') {
    throw new RangeError(`Unsupported custom provider HTTP method "${method}" (only POST is allowed)`);
  }
  const headers = sanitizeHeaders(rawSpec.headers);
  if (
    rawSpec.bodyTemplate === null ||
    rawSpec.bodyTemplate === undefined ||
    typeof rawSpec.bodyTemplate !== 'object'
  ) {
    throw new TypeError('bodyTemplate must be a JSON object or array');
  }
  const bodyTemplate = sanitizeBodyTemplate(rawSpec.bodyTemplate);
  const responsePath = validateResponsePath(rawSpec.responsePath);

  const concRaw = Number(rawSpec.maxConcurrency);
  const maxConcurrency = Number.isFinite(concRaw)
    ? Math.min(8, Math.max(1, Math.trunc(concRaw)))
    : 2;
  const timeoutRaw = Number(rawSpec.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.min(60000, Math.max(1000, Math.trunc(timeoutRaw)))
    : 15000;

  return Object.freeze({
    id,
    label,
    endpointUrl: parsedUrl.href,
    method: 'POST',
    headers,
    bodyTemplate,
    responsePath,
    allowRemoteHttps,
    maxConcurrency,
    timeoutMs,
  });
}

function createCustomProviderAdapter(rawSpec, {
  fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof fetchFn !== 'function') {
    throw new TypeError('fetchFn is required for CustomProviderAdapter');
  }
  const spec = validateCustomProviderSpec(rawSpec);
  const parsedUrl = new URL(spec.endpointUrl);
  const supportsRemote = Boolean(
    spec.allowRemoteHttps &&
      parsedUrl.protocol === 'https:' &&
      !isCanonicalLoopbackHost(parsedUrl.hostname)
  );

  return {
    id: spec.id,
    label: spec.label,
    description: `사용자 정의 POST 번역 어댑터 (${parsedUrl.host})`,
    supportsRemote,
    maxConcurrency: spec.maxConcurrency,
    spec,
    async translate(text, ctx = {}) {
      const signal = ctx && ctx.signal ? ctx.signal : undefined;
      if (signal && signal.aborted) return '';

      const vars = {
        text: String(text || ''),
        sourceLang: (ctx && ctx.sourceLang) || 'en',
        targetLang: (ctx && ctx.targetLang) || 'ko',
      };
      const requestBody = interpolateTemplateNode(spec.bodyTemplate, vars);
      const reqHeaders = Object.assign({ 'Content-Type': 'application/json' }, spec.headers);

      const linked = createLinkedAbort(signal, spec.timeoutMs, setTimer, clearTimer);
      try {
        const res = await fetchFn(spec.endpointUrl, {
          method: 'POST',
          headers: reqHeaders,
          credentials: 'omit',
          redirect: 'error',
          body: JSON.stringify(requestBody),
          signal: linked.signal,
        });
        if (!res || !res.ok) {
          throw new Error(`HTTP ${res ? res.status : 'ERR'}`);
        }
        const json = await res.json();
        return extractResponseValue(json, spec.responsePath);
      } finally {
        linked.cleanup();
      }
    },
  };
}

module.exports = {
  FORBIDDEN_HEADER_NAMES,
  sanitizeHeaders,
  sanitizeBodyTemplate,
  validateResponsePath,
  interpolateTemplateNode,
  extractResponseValue,
  validateCustomProviderSpec,
  createCustomProviderAdapter,
};
