// ── Free Tools: what the Site Review crawler is allowed to fetch ─────────────
// The same SSRF rules as clever-api's assertPublicHttpUrl (copied, not
// imported, so the public tools never reach into the monolith): http and https
// only, no localhost / .local / .internal / metadata hosts, no private,
// loopback, link-local or CGNAT addresses, and a hostname is resolved first so
// a public name that points at a private address is refused too. fetchPublic
// (site_discovery.ts) runs this on the first URL and on every redirect hop.

function ipv4Blocked(ip: string): boolean {
  const p = ip.split('.').map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 127) return true;              // this-host / loopback
  if (a === 10) return true;                          // private
  if (a === 172 && b >= 16 && b <= 31) return true;   // private
  if (a === 192 && b === 168) return true;            // private
  if (a === 169 && b === 254) return true;            // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  if (a >= 224) return true;                          // multicast / reserved
  return false;
}

export function ipBlocked(host: string): boolean {
  const s = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (s.includes(':')) {                              // IPv6
    if (s === '::1' || s === '::') return true;
    if (/^fe[89ab]/.test(s)) return true;             // link-local fe80::/10
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique-local fc00::/7
    const m = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped ::ffff:a.b.c.d
    if (m) return ipv4Blocked(m[1]);
    return false;
  }
  return ipv4Blocked(s);
}

const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

type Resolver = (host: string, type: 'A' | 'AAAA') => Promise<string[]>;
const defaultResolver = (): Resolver | null => {
  const r = (Deno as unknown as { resolveDns?: Resolver }).resolveDns;
  return typeof r === 'function' ? r : null;
};

export async function assertPublicHttpUrl(raw: string, resolve: Resolver | null = defaultResolver()): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked_scheme');
  if (u.username || u.password) throw new Error('blocked_credentials');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('blocked_host');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host === 'metadata' || host === 'metadata.google.internal') {
    throw new Error('blocked_host');
  }
  if (isIpLiteral(host)) {
    if (ipBlocked(host)) throw new Error('blocked_ip');
    return u;
  }
  if (!host.includes('.')) throw new Error('blocked_host');   // single-label names resolve inside the network
  if (resolve) {
    const [a, aaaa] = await Promise.all([
      resolve(host, 'A').catch(() => [] as string[]),
      resolve(host, 'AAAA').catch(() => [] as string[]),
    ]);
    const ips = [...(a || []), ...(aaaa || [])];
    if (ips.some((ip) => ipBlocked(ip))) throw new Error('blocked_resolved');
  }
  return u;
}

/** Visitor input → a clean absolute URL, or null. Adds https:// when the
 *  scheme is missing, drops the fragment, refuses anything that isn't a
 *  plausible public web address. */
export function normalizeSiteUrl(input: unknown): string | null {
  let s = String(input ?? '').trim();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:]+:\d+/.test(s)) return null;   // some other scheme (mailto:, ftp:)
    s = 'https://' + s.replace(/^\/+/, '');
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    u.hash = '';
    return u.toString();
  } catch { return null; }
}
