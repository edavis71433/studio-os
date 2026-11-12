// ── Free Tools: what the Site Review crawler is allowed to fetch ─────────────
// The same SSRF rules as clever-api's assertPublicHttpUrl (copied, not
// imported, so the public tools never reach into the monolith): http and https
// only, no localhost / .local / .internal / metadata hosts, no private,
// loopback, link-local or CGNAT addresses (nor an IPv6 address that carries
// one), and a hostname is resolved first so a public name that points at a
// private address is refused too. fetchPublic (site_discovery.ts) runs this on
// the first URL and on every redirect hop.

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

// An IPv6 address as its eight 16-bit groups, or null when it isn't one. A
// trailing dotted IPv4 part (::ffff:1.2.3.4) counts as the last two groups.
function ipv6Groups(s: string): number[] | null {
  const d = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (d) {
    const q = d.slice(2).map(Number);
    if (q.some((n) => n > 255)) return null;
    s = `${d[1]}${(q[0] * 256 + q[1]).toString(16)}:${(q[2] * 256 + q[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  if (![...head, ...tail].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return null;
  return [...head, ...Array(gap).fill('0'), ...tail].map((g) => parseInt(g, 16));
}

// The URL parser rewrites [::ffff:127.0.0.1] as [::ffff:7f00:1], so an address
// is judged by its groups, never by how it was written. One that carries an
// IPv4 address is judged by that address.
function ipv6Blocked(s: string): boolean {
  const g = ipv6Groups(s);
  if (!g) return true;                                // not a readable address
  const zero = (from: number, to: number) => g.slice(from, to).every((n) => n === 0);
  const v4 = (hi: number, lo: number) => ipv4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (zero(0, 7) && g[7] <= 1) return true;           // :: and loopback ::1
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6], g[7]); // IPv4-mapped ::ffff:0:0/96, IPv4-compatible ::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6], g[7]); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return v4(g[1], g[2]);         // 6to4 2002::/16
  if (g[0] < 0x100) return true;                      // the rest of ::/8 is reserved (::ffff:0:a.b.c.d, 64:ff9b:1::/48)
  if (g[0] >= 0xfc00 && g[0] <= 0xfdff) return true;  // unique-local fc00::/7
  if (g[0] >= 0xfe80 && g[0] <= 0xfeff) return true;  // link-local fe80::/10, old site-local fec0::/10
  if (g[0] >= 0xff00) return true;                    // multicast
  return false;
}

export function ipBlocked(host: string): boolean {
  const s = host.toLowerCase().replace(/^\[|\]$/g, '');
  return s.includes(':') ? ipv6Blocked(s) : ipv4Blocked(s);
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

/** Builder list item 204 (Nov 12 review, finding 93): the one way the server fetches an
 *  address someone typed or a browser handed it (a watched website, a link an owner
 *  typed, a prospect's site, a custom domain, a push endpoint). The guard runs on the
 *  first address and on every redirect hop, which are followed here by hand, at most
 *  `maxHops`, so the server can't be pointed at a private or internal address, the
 *  cloud's metadata service included. Throws when an address is refused or there are
 *  too many hops. With `follow: false` the first answer comes back as it is, a redirect
 *  included (a status check that must see the redirect itself). */
export type GuardedFetchOpts = { maxHops?: number; follow?: boolean; guard?: (u: string) => Promise<unknown>; fetchImpl?: (input: string, init?: RequestInit) => Promise<Response> };
export async function guardedFetch(url: string, init: RequestInit = {}, opts: GuardedFetchOpts = {}): Promise<Response> {
  const guard = opts.guard || ((u: string) => assertPublicHttpUrl(u));
  const doFetch = opts.fetchImpl || ((input: string, i?: RequestInit) => fetch(input, i));
  let current = url;
  for (let hop = 0; hop <= (opts.maxHops ?? 3); hop++) {
    await guard(current);
    const r = await doFetch(current, { ...init, redirect: 'manual' });
    const loc = r.headers.get('location');
    if (opts.follow === false || !(r.status >= 300 && r.status < 400 && loc)) return r;
    try { await r.body?.cancel(); } catch { /* the next hop goes ahead either way */ }
    current = new URL(loc, current).href;
  }
  throw new Error('too_many_redirects');
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
