'use strict';

/**
 * Translation Endpoint SSRF Validator backed by `ipaddr.js`.
 *
 * Runs identically in both Node.js (Host Settings Store / Sidecar) and Browser
 * (bundled into `dist/renderer.js` via `esbuild`).
 */

const ipaddr = require('ipaddr.js');

function stripBracketsAndTrailingDots(rawHostname) {
  let host = String(rawHostname || '').trim();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  host = host.replace(/\.+$/, '');
  return host.toLowerCase();
}

function parseIpv4Uint32(host) {
  if (!ipaddr.IPv4.isValidFourPartDecimal(host)) return null;
  const octets = ipaddr.IPv4.parse(host).octets;
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function parseIpv6Groups(host) {
  if (!host || !host.includes(':')) return null;
  const zoneIdx = host.indexOf('%');
  const clean = zoneIdx !== -1 ? host.slice(0, zoneIdx) : host;
  if (!ipaddr.IPv6.isValid(clean)) return null;
  return ipaddr.IPv6.parse(clean).parts.slice();
}

function isForbiddenIpv4Addr(v4) {
  if (!v4 || v4.kind() !== 'ipv4') return true;
  if (v4.range() !== 'unicast') return true;
  // Defense-in-depth for RFC 5737 TEST-NET-1/2/3 documentation ranges if not classified non-unicast
  const [b0, b1, b2] = v4.octets;
  if (b0 === 192 && b1 === 0 && b2 === 2) return true;
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;
  return false;
}

function isForbiddenIpv4Uint32(ip) {
  const octets = [(ip >>> 24) & 0xff, (ip >>> 16) & 0xff, (ip >>> 8) & 0xff, ip & 0xff];
  return isForbiddenIpv4Addr(new ipaddr.IPv4(octets));
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
  // IPv4-compatible ::w.x.y.z (excluding :: and ::1)
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
  if (!ipaddr.isValid(host)) return false;

  const addr = ipaddr.parse(host);
  if (addr.kind() === 'ipv4') {
    return isForbiddenIpv4Addr(addr);
  }

  // IPv6
  const range = addr.range();
  if (range !== 'unicast') {
    // Allow public 6to4 / NAT64 only if embedded IPv4 is also public unicast? No:
    // Teredo (2001:0000::/32) is always blocked; 6to4/NAT64/IPv4-mapped are checked via embedded IPv4 below.
    if (range === 'ipv4Mapped' && addr.isIPv4MappedAddress()) {
      return isForbiddenIpv4Addr(addr.toIPv4Address());
    }
    if (range === 'rfc6052' || range === '6to4') {
      const embedded = extractEmbeddedIpv4FromIpv6(addr.parts);
      if (embedded !== null && isForbiddenIpv4Uint32(embedded)) return true;
      return false;
    }
    return true;
  }

  // Defense-in-depth for NAT64 local-use (64:ff9b:1::/48) or IPv4-compatible (::w.x.y.z)
  const embeddedV4 = extractEmbeddedIpv4FromIpv6(addr.parts);
  if (embeddedV4 !== null && isForbiddenIpv4Uint32(embeddedV4)) {
    return true;
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
  if (!ipaddr.isValid(cleanHost) && !cleanHost.includes('.')) {
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
