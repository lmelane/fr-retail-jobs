/**
 * SSRF guard for outbound fetches.
 *
 * URLs reach the fetcher from untrusted places — Serper search results, links
 * scraped from page HTML, and discovery CSV rows written by agents. Without a
 * check, a hostile slug or redirect could make the crawler hit internal targets:
 * the cloud metadata endpoint (169.254.169.254), localhost services, or private
 * RFC1918 ranges. This refuses any URL that is not plain http/https to a public
 * host.
 */

/** Hostnames that must never be fetched, whatever the scheme. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud metadata services (AWS/GCP/Azure/OpenStack) resolve these names too.
  'metadata',
  'metadata.google.internal',
]);

/** IPv4 in a private, loopback, link-local or reserved range. */
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((n) => n > 255)) return true; // malformed -> refuse
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a >= 224 // multicast / reserved
  );
}

/** IPv6 loopback, link-local, unique-local, or an IPv4-mapped private address. */
function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true; // link-local / ULA
  // IPv4-mapped (::ffff:10.0.0.1) — check the trailing IPv4.
  const mapped = h.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped && isPrivateIpv4(mapped[1])) return true;
  // Same address, HEX form: WHATWG's URL parser serializes ::ffff:169.254.169.254
  // as ::ffff:a9fe:a9fe, which slipped past the dotted check (audit R-02).
  const hexMapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const [hi, lo] = [parseInt(hexMapped[1], 16), parseInt(hexMapped[2], 16)];
    const dotted = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    if (isPrivateIpv4(dotted)) return true;
  }
  return false;
}

/** True when this URL is safe to fetch (public http/https host). */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  if (isPrivateIpv4(host)) return false;
  if (host.includes(':') && isPrivateIpv6(host)) return false;

  return true;
}

/** Raised when a URL is blocked by the SSRF guard — never worth retrying. */
export class BlockedUrlError extends Error {
  constructor(url: string) {
    super(`Refusing to fetch non-public or non-HTTP URL: ${url}`);
    this.name = 'BlockedUrlError';
  }
}

/** Throws when a URL must not be fetched. Use before every outbound request. */
export function assertPublicUrl(raw: string): void {
  if (!isPublicHttpUrl(raw)) throw new BlockedUrlError(raw);
}
