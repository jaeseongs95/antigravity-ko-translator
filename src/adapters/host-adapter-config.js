'use strict';

function isLoopbackHostname(hostname) {
  const h = String(hostname || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function parseOriginStrict(rawOrigin, fieldName, allowLoopbackForTest) {
  if (typeof rawOrigin !== 'string' || !rawOrigin.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty URL origin string`);
  }
  let parsed;
  try {
    parsed = new URL(rawOrigin.trim());
  } catch (_err) {
    throw new RangeError(`Invalid URL in ${fieldName}: "${rawOrigin}"`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new RangeError(`${fieldName} must not contain credentials, query, or hash: "${rawOrigin}"`);
  }
  const loopback = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol === 'https:') {
    if (loopback && !allowLoopbackForTest) {
      throw new RangeError(`Loopback origin in ${fieldName} requires allowLoopbackForTest: "${rawOrigin}"`);
    }
    return parsed;
  }
  if (parsed.protocol === 'http:' && loopback && allowLoopbackForTest) {
    return parsed;
  }
  throw new RangeError(`${fieldName} must use https: origin: "${rawOrigin}"`);
}

function normalizeExactHostname(rawHost, fieldName, allowLoopbackForTest) {
  if (typeof rawHost !== 'string' || !rawHost.trim()) {
    throw new TypeError(`${fieldName} entry must be a non-empty hostname`);
  }
  const host = rawHost.trim().toLowerCase();
  if (
    host.startsWith('.') ||
    host.endsWith('.') ||
    host.includes('*') ||
    host.includes('/') ||
    host.includes(':') ||
    host.includes('?') ||
    host.includes('#')
  ) {
    throw new RangeError(`${fieldName} entry must be an exact hostname without wildcards or scheme: "${rawHost}"`);
  }
  if (isLoopbackHostname(host)) {
    if (!allowLoopbackForTest) {
      throw new RangeError(`Loopback host in ${fieldName} requires allowLoopbackForTest: "${rawHost}"`);
    }
    return host;
  }
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((lbl) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(lbl))) {
    throw new RangeError(`${fieldName} entry must be a valid multi-label DNS hostname: "${rawHost}"`);
  }
  return host;
}

function validateNonEmptyString(val, fieldName) {
  if (typeof val !== 'string' || !val.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return val.trim();
}

function validateStringArray(arr, fieldName, { allowEmpty = false } = {}) {
  if (!Array.isArray(arr) || (!allowEmpty && arr.length === 0)) {
    throw new TypeError(`${fieldName} must be a ${allowEmpty ? '' : 'non-empty '}array of strings`);
  }
  return arr.map((item, idx) => validateNonEmptyString(item, `${fieldName}[${idx}]`));
}

function createHostAdapterConfig(rawConfig, options = {}) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new TypeError('HostAdapterConfig must be a plain object');
  }
  const allowLoopbackForTest = Boolean(options && options.allowLoopbackForTest);

  const productName = validateNonEmptyString(rawConfig.productName, 'productName');
  const defaultAppVersion = validateNonEmptyString(rawConfig.defaultAppVersion, 'defaultAppVersion');

  const cdnScriptParsed = parseOriginStrict(rawConfig.cdnScriptOrigin, 'cdnScriptOrigin', allowLoopbackForTest);
  if (cdnScriptParsed.pathname !== '/') {
    throw new RangeError(`cdnScriptOrigin must not include a path: "${rawConfig.cdnScriptOrigin}"`);
  }
  const cdnScriptOrigin = cdnScriptParsed.origin;

  const cdnBaseParsed = parseOriginStrict(rawConfig.cdnMirrorBase, 'cdnMirrorBase', allowLoopbackForTest);
  const cdnMirrorBase = `${cdnBaseParsed.origin}${cdnBaseParsed.pathname.replace(/\/+$/, '')}`;

  const cdnMirrorHosts = Object.freeze(
    validateStringArray(rawConfig.cdnMirrorHosts, 'cdnMirrorHosts').map((h, i) =>
      normalizeExactHostname(h, `cdnMirrorHosts[${i}]`, allowLoopbackForTest)
    )
  );
  const cdnMirrorHostSet = new Set(cdnMirrorHosts);

  const trustedHostOriginUrls = validateStringArray(rawConfig.trustedHostOrigins, 'trustedHostOrigins').map((orig, i) => {
    const p = parseOriginStrict(orig, `trustedHostOrigins[${i}]`, allowLoopbackForTest);
    if (p.pathname !== '/') {
      throw new RangeError(`trustedHostOrigins[${i}] must be a pure origin without path: "${orig}"`);
    }
    return p;
  });
  const trustedHostOrigins = Object.freeze(trustedHostOriginUrls.map((p) => p.origin));
  const trustedHostOriginSet = new Set(trustedHostOrigins.map((o) => o.toLowerCase()));
  const trustedHostNameSet = new Set(trustedHostOriginUrls.map((p) => p.hostname.toLowerCase()));

  // Invariant 1 (Apex-Pinned Suffix Invariant):
  // Every suffix `.example.tld` MUST have `>= 2` DNS labels AND an explicit `https://example.tld` in `trustedHostOrigins`.
  const rawSuffixes = validateStringArray(rawConfig.trustedHostOriginSuffixes || [], 'trustedHostOriginSuffixes', {
    allowEmpty: true,
  });
  const normalizedSuffixes = rawSuffixes.map((rawSuffix, idx) => {
    const lower = rawSuffix.toLowerCase();
    if (!lower.startsWith('.') || lower.endsWith('.') || lower.includes('*') || lower.includes('/') || lower.includes(':')) {
      throw new RangeError(
        `trustedHostOriginSuffixes[${idx}] must start with "." and contain no wildcards/ports: "${rawSuffix}"`
      );
    }
    const apexHost = lower.slice(1);
    const labels = apexHost.split('.');
    if (labels.length < 2 || !labels.every((lbl) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(lbl))) {
      throw new RangeError(
        `trustedHostOriginSuffixes[${idx}] must have at least 2 valid DNS labels: "${rawSuffix}"`
      );
    }
    const requiredApexOrigin = `https://${apexHost}`;
    if (!trustedHostOriginSet.has(requiredApexOrigin)) {
      throw new RangeError(
        `Apex-Pinned Invariant violated: suffix "${lower}" requires explicit "${requiredApexOrigin}" in trustedHostOrigins`
      );
    }
    return lower;
  });
  const trustedHostOriginSuffixes = Object.freeze(normalizedSuffixes);

  // Invariant 2 (Disjoint Sandbox-vs-Script Invariant):
  // Every entry in `sandboxIframeHosts` MUST be an exact hostname and disjoint from script-execution hosts.
  const rawSandboxHosts = validateStringArray(rawConfig.sandboxIframeHosts || [], 'sandboxIframeHosts', {
    allowEmpty: true,
  });
  const normalizedSandboxHosts = rawSandboxHosts.map((rawHost, idx) => {
    const exactHost = normalizeExactHostname(rawHost, `sandboxIframeHosts[${idx}]`, allowLoopbackForTest);
    if (trustedHostNameSet.has(exactHost) || cdnMirrorHostSet.has(exactHost)) {
      throw new RangeError(
        `Disjoint Sandbox-vs-Script Invariant violated: sandboxIframeHosts[${idx}] "${exactHost}" overlaps script hosts`
      );
    }
    for (const suffix of trustedHostOriginSuffixes) {
      if (exactHost === suffix.slice(1) || exactHost.endsWith(suffix)) {
        throw new RangeError(
          `Disjoint Sandbox-vs-Script Invariant violated: sandboxIframeHosts[${idx}] "${exactHost}" matches suffix "${suffix}"`
        );
      }
    }
    return exactHost;
  });
  const sandboxIframeHosts = Object.freeze(normalizedSandboxHosts);

  const pathPrefixToStrip = validateNonEmptyString(rawConfig.pathPrefixToStrip, 'pathPrefixToStrip');
  if (!pathPrefixToStrip.startsWith('/')) {
    throw new RangeError(`pathPrefixToStrip must start with "/": "${pathPrefixToStrip}"`);
  }
  const webVersionPrefix = validateNonEmptyString(rawConfig.webVersionPrefix, 'webVersionPrefix');
  if (!webVersionPrefix.startsWith('/')) {
    throw new RangeError(`webVersionPrefix must start with "/": "${webVersionPrefix}"`);
  }

  const protectedHostPathPrefixes = Object.freeze(
    validateStringArray(rawConfig.protectedHostPathPrefixes || [], 'protectedHostPathPrefixes', {
      allowEmpty: true,
    }).map((prefix, idx) => {
      if (!prefix.startsWith('/')) {
        throw new RangeError(`protectedHostPathPrefixes[${idx}] must start with "/": "${prefix}"`);
      }
      return prefix;
    })
  );

  const shellCssFiles = Object.freeze(validateStringArray(rawConfig.shellCssFiles, 'shellCssFiles'));
  const shellBootScripts = Object.freeze(validateStringArray(rawConfig.shellBootScripts, 'shellBootScripts'));
  const remoteControlSelector = validateNonEmptyString(rawConfig.remoteControlSelector, 'remoteControlSelector');
  const trustedTypesPolicyNames = Object.freeze(
    validateStringArray(rawConfig.trustedTypesPolicyNames, 'trustedTypesPolicyNames')
  );

  const trustedCompanionRepoPrefixes = Object.freeze(
    validateStringArray(rawConfig.trustedCompanionRepoPrefixes || [], 'trustedCompanionRepoPrefixes', {
      allowEmpty: true,
    }).map((prefix, idx) => {
      const p = parseOriginStrict(prefix, `trustedCompanionRepoPrefixes[${idx}]`, allowLoopbackForTest);
      return `${p.origin}${p.pathname}`;
    })
  );

  const rawCompanionBundles =
    rawConfig.companionBundles && typeof rawConfig.companionBundles === 'object' && !Array.isArray(rawConfig.companionBundles)
      ? rawConfig.companionBundles
      : {};
  const companionBundlesObj = Object.create(null);
  for (const [bundleKey, bundleUrlRaw] of Object.entries(rawCompanionBundles)) {
    const cleanKey = validateNonEmptyString(bundleKey, 'companionBundles key');
    const cleanUrl = validateNonEmptyString(bundleUrlRaw, `companionBundles.${cleanKey}`);
    const parsedBundle = parseOriginStrict(cleanUrl, `companionBundles.${cleanKey}`, allowLoopbackForTest);
    const fullHref = parsedBundle.href;
    if (
      trustedCompanionRepoPrefixes.length > 0 &&
      !trustedCompanionRepoPrefixes.some((prefix) => fullHref.startsWith(prefix))
    ) {
      if (!(allowLoopbackForTest && isLoopbackHostname(parsedBundle.hostname))) {
        throw new RangeError(
          `companionBundles.${cleanKey} URL "${fullHref}" does not match trustedCompanionRepoPrefixes`
        );
      }
    }
    companionBundlesObj[cleanKey] = fullHref;
  }
  const companionBundles = Object.freeze(companionBundlesObj);

  const configOut = {
    productName,
    defaultAppVersion,
    cdnScriptOrigin,
    cdnMirrorBase,
    cdnMirrorHosts,
    trustedHostOrigins,
    trustedHostOriginSuffixes,
    sandboxIframeHosts,
    pathPrefixToStrip,
    webVersionPrefix,
    protectedHostPathPrefixes,
    shellCssFiles,
    shellBootScripts,
    remoteControlSelector,
    trustedTypesPolicyNames,
    trustedCompanionRepoPrefixes,
    companionBundles,
  };

  if (typeof rawConfig.rootComponentSelector === 'string' && rawConfig.rootComponentSelector.trim()) {
    configOut.rootComponentSelector = rawConfig.rootComponentSelector.trim();
  }
  if (typeof rawConfig.appGlobalNamespace === 'string' && rawConfig.appGlobalNamespace.trim()) {
    configOut.appGlobalNamespace = rawConfig.appGlobalNamespace.trim();
  }
  if (typeof rawConfig.rpcServicePrefix === 'string' && rawConfig.rpcServicePrefix.trim()) {
    configOut.rpcServicePrefix = rawConfig.rpcServicePrefix.trim();
  }

  return Object.freeze(configOut);
}

module.exports = {
  isLoopbackHostname,
  createHostAdapterConfig,
};
