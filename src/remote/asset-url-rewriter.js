'use strict';

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isProtectedPathname(pathname, protectedPrefixes) {
  if (!pathname || !Array.isArray(protectedPrefixes)) return false;
  for (const prefix of protectedPrefixes) {
    if (!prefix) continue;
    const cleanNoSlash = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    if (pathname === cleanNoSlash || pathname.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function resolveRemoteCdnContext({
  hostCfg,
  cspSecurityPort,
  hostOrigin,
  hostHref,
  candidateUrls,
}) {
  if (!hostCfg || !cspSecurityPort) return null;
  const stripPrefix = String(hostCfg.pathPrefixToStrip || '');
  const stripRe = stripPrefix ? new RegExp(`^${escapeRegExp(stripPrefix)}(?=/|$)`) : null;
  const webPrefix = String(hostCfg.webVersionPrefix || '');
  const webPrefixRe = webPrefix ? new RegExp(`^(${escapeRegExp(webPrefix)}[^/]+)`) : null;
  const protectedPrefixes = Array.isArray(hostCfg.protectedHostPathPrefixes)
    ? hostCfg.protectedHostPathPrefixes
    : [];
  const sandboxHostSet = new Set(
    (Array.isArray(hostCfg.sandboxIframeHosts) ? hostCfg.sandboxIframeHosts : []).map((h) => String(h).toLowerCase())
  );
  const mirrorHostSet = new Set(
    (Array.isArray(hostCfg.cdnMirrorHosts) ? hostCfg.cdnMirrorHosts : []).map((h) => String(h).toLowerCase())
  );
  const cdnMirrorBase = String(hostCfg.cdnMirrorBase || '').replace(/\/+$/, '');
  const baseHref = hostHref && hostHref !== 'about:blank' ? hostHref : `${hostOrigin || hostCfg.cdnScriptOrigin}/`;

  for (const rawCandidate of Array.isArray(candidateUrls) ? candidateUrls : []) {
    const matchUrl = String(rawCandidate || '').match(/https?:\/\/[^\s"'<>)+]+/);
    const urlStr = matchUrl ? matchUrl[0] : String(rawCandidate || '').trim();
    if (!urlStr || urlStr === 'about:blank') continue;
    try {
      const parsed = new URL(urlStr, baseHref);
      if (!cspSecurityPort.isTrustedIframePreflightUrl(parsed)) continue;
      const cleanPath = stripRe ? parsed.pathname.replace(stripRe, '') : parsed.pathname;
      const webMatch = webPrefixRe ? cleanPath.match(webPrefixRe) : null;
      const basePath = (webMatch ? webMatch[1] : cleanPath).replace(/\/+$/, '');
      if (!basePath || isProtectedPathname(basePath, protectedPrefixes) || /(?:\.\.|\\|\/\/|[\s"'<>])/.test(basePath)) {
        continue;
      }
      let appVersion = String(hostCfg.defaultAppVersion || '');
      if (webPrefix && basePath.startsWith(webPrefix)) {
        const verSeg = basePath.slice(webPrefix.length).split('/')[0];
        if (verSeg) appVersion = verSeg;
      }
      const parsedHost = String(parsed.hostname || '').toLowerCase();
      const cdnOrigin =
        sandboxHostSet.has(parsedHost) ||
        mirrorHostSet.has(parsedHost) ||
        (hostOrigin && parsed.origin.toLowerCase() === hostOrigin.toLowerCase())
          ? cdnMirrorBase
          : parsed.origin;
      const cdnBaseUrl = `${cdnOrigin}${basePath}`;
      const bootScripts = Array.isArray(hostCfg.shellBootScripts) ? hostCfg.shellBootScripts : [];
      if (
        bootScripts.length > 0 &&
        bootScripts.every((scriptName) => {
          try {
            if (typeof scriptName !== 'string' || !scriptName.trim() || scriptName.includes('\\')) return false;
            const resolvedBoot = new URL(scriptName, `${cdnBaseUrl}/`).href;
            return resolvedBoot.startsWith(`${cdnBaseUrl}/`) && cspSecurityPort.isTrustedScriptUrl(resolvedBoot);
          } catch (_err) {
            return false;
          }
        })
      ) {
        return Object.freeze({
          basePath,
          appVersion,
          cdnOrigin,
          cdnBaseUrl,
        });
      }
    } catch (_err) {}
  }
  return null;
}

function createAssetUrlRewriter({
  hostCfg,
  cspSecurityPort,
  hostOrigin,
  hostHref,
  basePath,
  cdnOrigin,
  cdnBaseUrl,
}) {
  const stripPrefix = String((hostCfg && hostCfg.pathPrefixToStrip) || '');
  const webPrefix = String((hostCfg && hostCfg.webVersionPrefix) || '');
  const cdnScriptOrigin = String((hostCfg && hostCfg.cdnScriptOrigin) || '').replace(/\/+$/, '');
  const protectedPrefixes = Array.isArray(hostCfg && hostCfg.protectedHostPathPrefixes)
    ? hostCfg.protectedHostPathPrefixes
    : [];
  const sandboxHostSet = new Set(
    (Array.isArray(hostCfg && hostCfg.sandboxIframeHosts) ? hostCfg.sandboxIframeHosts : []).map((h) =>
      String(h).toLowerCase()
    )
  );
  const effectiveOrigin = String(hostOrigin || '').replace(/\/+$/, '');
  const effectiveHref =
    hostHref && hostHref !== 'about:blank' ? hostHref : `${effectiveOrigin || cdnScriptOrigin}/`;

  function mapPathnameToCdn(pathname, search, hash, preserveRootRelative) {
    if (!pathname) return null;
    if (isProtectedPathname(pathname, protectedPrefixes)) {
      return effectiveOrigin ? `${effectiveOrigin}${pathname}${search}${hash}` : null;
    }
    if (stripPrefix && (pathname === stripPrefix || pathname.startsWith(`${stripPrefix}/`))) {
      return `${cdnScriptOrigin}${pathname}${search}${hash}`;
    }
    if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
      return `${cdnBaseUrl}${pathname.slice(basePath.length)}${search}${hash}`;
    }
    if (webPrefix && pathname.startsWith(webPrefix)) {
      return `${cdnOrigin}${pathname}${search}${hash}`;
    }
    if (preserveRootRelative) {
      return `${cdnBaseUrl}${pathname}${search}${hash}`;
    }
    return `${cdnOrigin}${pathname}${search}${hash}`;
  }

  function rewriteAssetUrl(rawInput) {
    if (rawInput === null || rawInput === undefined) return '';
    const isUrlObj =
      typeof rawInput === 'object' &&
      rawInput !== null &&
      typeof rawInput.href === 'string' &&
      typeof rawInput.protocol === 'string';
    if (typeof rawInput !== 'string' && !isUrlObj) return rawInput;
    const trimmed = String(isUrlObj ? rawInput.href : rawInput).trim();
    if (!trimmed) return trimmed;
    if (/^(?:blob:|data:|javascript:|vbscript:|mailto:|tel:|about:|#|\?)/i.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      try {
        const parsedRootRel = new URL(trimmed, effectiveHref);
        const mapped = mapPathnameToCdn(
          parsedRootRel.pathname,
          parsedRootRel.search,
          parsedRootRel.hash,
          true
        );
        return mapped || `${cdnBaseUrl}${trimmed}`;
      } catch (_err) {
        return `${cdnBaseUrl}${trimmed}`;
      }
    }
    if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) && !trimmed.startsWith('//')) {
      try {
        const virtualBase = `${effectiveOrigin || cdnScriptOrigin}${basePath}/`;
        const resolvedRel = new URL(trimmed, virtualBase);
        if (!effectiveOrigin || resolvedRel.origin.toLowerCase() === effectiveOrigin.toLowerCase()) {
          const mapped = mapPathnameToCdn(
            resolvedRel.pathname,
            resolvedRel.search,
            resolvedRel.hash,
            false
          );
          if (mapped) return mapped;
        }
      } catch (_err) {}
      return trimmed;
    }
    try {
      const parsedAsset = new URL(trimmed, effectiveHref);
      const parsedHost = String(parsedAsset.hostname || '').toLowerCase();
      const isHostSameOrigin =
        Boolean(effectiveOrigin) && parsedAsset.origin.toLowerCase() === effectiveOrigin.toLowerCase();
      const isSandboxHost = sandboxHostSet.has(parsedHost);
      if (isHostSameOrigin || isSandboxHost) {
        if (isHostSameOrigin && isProtectedPathname(parsedAsset.pathname, protectedPrefixes)) {
          return parsedAsset.href;
        }
        const mapped = mapPathnameToCdn(
          parsedAsset.pathname,
          parsedAsset.search,
          parsedAsset.hash,
          isHostSameOrigin
        );
        if (mapped) return mapped;
      }
    } catch (_err) {}
    return trimmed;
  }

  function createWorkerUrlResolver(workerUrl) {
    const parsedWorker = new URL(String(workerUrl), effectiveHref);
    return function resolveWorkerUrl(rawInput) {
      const isUrlObj =
        rawInput &&
        typeof rawInput === 'object' &&
        typeof rawInput.href === 'string' &&
        typeof rawInput.protocol === 'string';
      if (typeof rawInput !== 'string' && !isUrlObj) return rawInput;
      const trimmed = String(isUrlObj ? rawInput.href : rawInput).trim();
      if (!trimmed || /^(?:blob:|data:|javascript:|vbscript:|about:|#|\?)/i.test(trimmed)) {
        return trimmed;
      }
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        return rewriteAssetUrl(trimmed);
      }
      try {
        const abs = new URL(trimmed, parsedWorker.href).href;
        return rewriteAssetUrl(abs) || abs;
      } catch (_err) {
        return rawInput;
      }
    };
  }

  function toAuthorizedScriptUrl(rawVal) {
    if (rawVal && typeof rawVal === 'object' && typeof rawVal.href !== 'string') {
      return rawVal;
    }
    const rewritten = rewriteAssetUrl(rawVal);
    if (cspSecurityPort && typeof rewritten === 'string') {
      return cspSecurityPort.createAuthorizedScriptUrl(rewritten);
    }
    return rewritten;
  }

  return {
    rewriteAssetUrl,
    createWorkerUrlResolver,
    toAuthorizedScriptUrl,
  };
}

module.exports = {
  isProtectedPathname,
  resolveRemoteCdnContext,
  createAssetUrlRewriter,
};
