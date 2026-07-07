// ── External website observation + ownership verification (M11) ─────────────
// READ-ONLY, structurally: this module holds only GET/HEAD fetches and DNS
// lookups. It cannot write to a customer's website — no method exists.
//
// fetchExternalSite: homepage + a handful of same-host pages discovered from
// its own links. Pages feed the SAME providers that observe hosted sites;
// no alternate pipeline exists.
//
// verifyConnection: read-only ownership proof — a DNS TXT record, a meta tag,
// or a file the customer places. The fetcher is injectable so verification
// logic is testable without a network.
import type { LiveFetch } from '../evidence/collect.ts';
import { detectPlatform } from './adapters.ts';

const timed = (ms: number) => AbortSignal.timeout(ms);
const fence = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

export interface ExternalSite {
  pages: Array<{ path: string; html: string }>;
  liveFetch: LiveFetch;
  platform: string;
}

const PAGE_CAP = 8;
const HTML_CAP = 400_000;

/** Same-host internal paths from anchor hrefs, deterministic order. PURE. */
export function discoverPaths(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out: string[] = [];
  const seen = new Set<string>(['/']);
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    let u: URL;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
    const path = u.pathname.replace(/\/$/, '') || '/';
    if (seen.has(path) || /\.(?:png|jpe?g|gif|svg|webp|pdf|zip|css|js|xml|ico|mp4|webm)$/i.test(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= PAGE_CAP - 1) break;
  }
  return out;
}

export async function fetchExternalSite(url: string): Promise<ExternalSite | null> {
  const liveFetch: LiveFetch = { attempted: true, url, ok: false, status: 0, https: false, headers: {}, error: '' };
  let homeHtml = '';
  try {
    const r = await fetch(url, { redirect: 'follow', signal: timed(10_000) });
    liveFetch.ok = r.ok; liveFetch.status = r.status; liveFetch.https = r.url.startsWith('https://');
    for (const h of ['strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'content-type', 'server', 'x-powered-by']) {
      const v = r.headers.get(h); if (v) liveFetch.headers[h] = v;
    }
    homeHtml = (await r.text()).slice(0, HTML_CAP);
  } catch (e) {
    liveFetch.error = (e as Error)?.message?.slice(0, 120) || 'fetch failed';
    return { pages: [], liveFetch, platform: 'custom' };
  }
  const pages: ExternalSite['pages'] = [{ path: '/', html: homeHtml }];
  for (const path of discoverPaths(homeHtml, url)) {
    const html = await fence((async () => {
      const r = await fetch(new URL(path, url).href, { redirect: 'follow', signal: timed(8000) });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) return null;
      return (await r.text()).slice(0, HTML_CAP);
    })());
    if (html) pages.push({ path: path.endsWith('/') ? path : path + '/', html });
  }
  return { pages, liveFetch, platform: detectPlatform(homeHtml, liveFetch.headers) };
}

/* ── ownership verification — read-only proofs, injectable I/O ── */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface VerifyResult { verified: boolean; note: string }

/** PURE matchers — the decision logic, testable without a network. */
export const matchers = {
  meta: (html: string, token: string) =>
    new RegExp(`<meta[^>]+name="dds-site-verification"[^>]+content="${token}"`, 'i').test(html) ||
    new RegExp(`<meta[^>]+content="${token}"[^>]+name="dds-site-verification"`, 'i').test(html),
  file: (body: string, token: string) => body.trim() === token,
  dns: (txtRecords: string[], token: string) => txtRecords.some((t) => t.replace(/^"|"$/g, '').trim() === token),
};

export async function verifyConnection(
  conn: { url: string; domain: string; method: 'dns' | 'meta' | 'file'; token: string },
  fetcher: Fetcher = fetch,
): Promise<VerifyResult> {
  try {
    if (conn.method === 'meta') {
      const r = await fetcher(conn.url, { signal: timed(8000) } as RequestInit);
      if (!r.ok) return { verified: false, note: `The homepage answered ${r.status}.` };
      const html = (await r.text()).slice(0, HTML_CAP);
      return matchers.meta(html, conn.token)
        ? { verified: true, note: 'Meta tag found on the homepage.' }
        : { verified: false, note: 'The verification meta tag isn’t on the homepage yet.' };
    }
    if (conn.method === 'file') {
      const r = await fetcher(new URL(`/dds-verify-${conn.token}.txt`, conn.url).href, { signal: timed(8000) } as RequestInit);
      if (!r.ok) return { verified: false, note: `The verification file isn’t there yet (${r.status}).` };
      return matchers.file(await r.text(), conn.token)
        ? { verified: true, note: 'Verification file found.' }
        : { verified: false, note: 'The file exists but its contents don’t match the token.' };
    }
    // dns: TXT record on _dds-verify.<domain> containing the token
    const r = await fetcher(`https://cloudflare-dns.com/dns-query?name=_dds-verify.${encodeURIComponent(conn.domain)}&type=TXT`,
      { headers: { accept: 'application/dns-json' }, signal: timed(6000) } as RequestInit);
    if (!r.ok) return { verified: false, note: 'DNS lookup didn’t answer — try again shortly.' };
    const j = await r.json();
    const records = (Array.isArray(j?.Answer) ? j.Answer : []).map((a: { data: string }) => String(a.data || ''));
    return matchers.dns(records, conn.token)
      ? { verified: true, note: 'DNS record found.' }
      : { verified: false, note: `No _dds-verify TXT record with the token yet (${records.length} records seen).` };
  } catch (e) {
    return { verified: false, note: `Check failed: ${(e as Error)?.message?.slice(0, 80) || 'network error'}.` };
  }
}
