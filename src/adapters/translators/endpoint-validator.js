'use strict';

function stripBracketsAndTrailingDots(rawHostname) {
  let host = String(rawHostname || '').trim();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  host = host.replace(/\.+$/, '');
  return host.toLowerCase();
}

function parseIpv4Uint32(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function parseIpv6Groups(host) {
  if (!host.includes(':')) return null;
  let working = host;
  const zoneIdx = working.indexOf('%');
  if (zoneIdx !== -1) {
    working = working.slice(0, zoneIdx);
  }

  let embeddedV4Groups = null;
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const v4Int = parseIpv4Uint32(working.slice(lastColon + 1));
    if (v4Int === null) return null;
    embeddedV4Groups = [(v4Int >>> 16) & 0xffff, v4Int & 0xffff];
    working = working.slice(0, lastColon) + ':0:0';
  }

  const dblParts = working.split('::');
  if (dblParts.length > 2) return null;

  const parseSide = (part) => {
    if (!part) return [];
    const tokens = part.split(':');
    const nums = [];
    for (const tok of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(tok)) return null;
      nums.push(parseInt(tok, 16));
    }
    return nums;
  };

  let groups;
  if (dblParts.length === 2) {
    const left = parseSide(dblParts[0]);
    const right = parseSide(dblParts[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...new Array(missing).fill(0), ...right];
  } else {
    groups = parseSide(working);
    if (!groups || groups.length !== 8) return null;
  }

  if (embeddedV4Groups) {
    groups[6] = embeddedV4Groups[0];
    groups[7] = embeddedV4Groups[1];
  }
  return groups;
}

function isForbiddenIpv4Uint32(ip) {
  const b0 = (ip >>> 24) & 0xff;
  const b1 = (ip >>> 16) & 0xff;
  const b2 = (ip >>> 8) & 0xff;
  if (b0 === 0) return true; // 0.0.0.0/8
  if (b0 === 10) return true; // 10.0.0.0/8
  if (b0 === 100 && (b1 & 0xc0) === 64) return true; // 100.64.0.0/10
  if (b0 === 127) return true; // 127.0.0.0/8
  if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12
  if (b0 === 192 && b1 === 0 && b2 === 0) return true; // 192.0.0.0/24
  if (b0 === 192 && b1 === 0 && b2 === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true; // 198.18.0.0/15
  if (b0 === 198 && b1 === 51 && b2 === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (b0 >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  return false;
}

function extractEmbeddedIpv4FromIpv6(groups) {
  const low32 = (((groups[6] << 16) | groups[7]) >>> 0);
  // IPv4-mapped ::ffff:0:0/96
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    return low32;
  }
  // IPv4-compatible ::w.x.y.z (excluding :: and ::1 handled separately)
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0 &&
    low32 > 1
  ) {
    return low32;
  }
  // NAT64 Well-Known Prefix 64:ff9b::/96 and local-use 64:ff9b:1::/48
  if (
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    ((groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) || groups[2] === 0x0001)
  ) {
    return low32;
  }
  // 6to4 2002::/16 -> embedded IPv4 in groups[1..2]
  if (groups[0] === 0x2002) {
    return (((groups[1] << 16) | groups[2]) >>> 0);
  }
  // Teredo 2001:0000::/32 -> obfuscated client IPv4 is bitwise NOT of low32
  if (groups[0] === 0x2001 && groups[1] === 0x0000) {
    return ((~low32) >>> 0);
  }
  return null;
}

function isForbiddenIp(rawHost) {
  const host = stripBracketsAndTrailingDots(rawHost);
  const v4 = parseIpv4Uint32(host);
  if (v4 !== null) {
    return isForbiddenIpv4Uint32(v4);
  }
  const v6 = parseIpv6Groups(host);
  if (v6 !== null) {
    const allZero = v6.every((g) => g === 0);
    if (allZero) return true; // ::
    const isLoopbackV6 = v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1;
    if (isLoopbackV6) return true; // ::1
    if (v6[0] === 0x2001 && v6[1] === 0x0000) return true; // Teredo 2001:0000::/32 itself blocked
    if (v6[0] === 0x2001 && v6[1] === 0x0db8) return true; // Documentation 2001:db8::/32
    if ((v6[0] & 0xfe00) === 0xfc00) return true; // Unique local fc00::/7
    if ((v6[0] & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
    if ((v6[0] & 0xff00) === 0xff00) return true; // Multicast ff00::/8

    const embeddedV4 = extractEmbeddedIpv4FromIpv6(v6);
    if (embeddedV4 !== null && isForbiddenIpv4Uint32(embeddedV4)) {
      return true;
    }
    return false;
  }
  return false;
}

function isCanonicalLoopbackHost(rawHost) {
  const host = stripBracketsAndTrailingDots(rawHost);
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function isHttpsNonLoopbackEndpoint(rawUrl) {
  try {
    const parsed = validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps: true });
    return parsed.protocol === 'https:' && !isCanonicalLoopbackHost(parsed.hostname);
  } catch (_err) {
    return false;
  }
}

function validateTranslationEndpointUrl(rawUrl, { allowRemoteHttps = false } = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new TypeError('Endpoint URL must be a non-empty string');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_err) {
    throw new RangeError(`Malformed endpoint URL: "${rawUrl}"`);
  }

  if (parsed.username || parsed.password) {
    throw new RangeError('Endpoint URL must not contain userinfo credentials');
  }
  if (parsed.hash) {
    throw new RangeError('Endpoint URL must not contain a URL fragment (#)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RangeError(`Unsupported endpoint scheme "${parsed.protocol}" (expected http: or https:)`);
  }

  if (parsed.hostname.includes('%')) {
    throw new RangeError('IPv6 zone identifiers are forbidden in endpoint URLs');
  }

  const cleanHost = stripBracketsAndTrailingDots(parsed.hostname);
  if (!cleanHost) {
    throw new RangeError('Endpoint URL hostname is empty');
  }

  if (cleanHost === '127.0.0.1' || cleanHost === 'localhost' || cleanHost === '::1') {
    return parsed;
  }

  if (!allowRemoteHttps) {
    throw new RangeError(
      `Non-loopback endpoint "${cleanHost}" requires allowRemoteHttps: true (permitted loopback hosts: 127.0.0.1, localhost, ::1)`
    );
  }

  // Non-loopback remote endpoint (allowRemoteHttps === true)
  if (parsed.protocol !== 'https:') {
    throw new RangeError('Remote translation endpoints must use https:');
  }
  if (
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.local') ||
    cleanHost.endsWith('.internal')
  ) {
    throw new RangeError(`Forbidden local/internal hostname for remote HTTPS endpoint: "${cleanHost}"`);
  }
  if (isForbiddenIp(cleanHost)) {
    throw new RangeError(`Forbidden private, loopback, or reserved IP address: "${cleanHost}"`);
  }
  const isIp = parseIpv4Uint32(cleanHost) !== null || parseIpv6Groups(cleanHost) !== null;
  if (!isIp && !cleanHost.includes('.')) {
    throw new RangeError(`Single-label internal hostname is forbidden for remote HTTPS endpoint: "${cleanHost}"`);
  }

  return parsed;
}

module.exports = {
  stripBracketsAndTrailingDots,
  parseIpv4Uint32,
  parseIpv6Groups,
  extractEmbeddedIpv4FromIpv6,
  isForbiddenIpv4Uint32,
  isForbiddenIp,
  isCanonicalLoopbackHost,
  isHttpsNonLoopbackEndpoint,
  validateTranslationEndpointUrl,
};
