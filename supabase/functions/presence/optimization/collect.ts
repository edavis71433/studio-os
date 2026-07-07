// ── Optimization Engine collection (M10) — ALL new I/O lives here ───────────
// Same discipline as evidence/collect.ts: collectors do I/O up front, then
// pure providers observe the gathered input. Every probe here is individually
// fenced (short timeout, try/catch → null) so one dead network dependency
// never poisons a run — failure isolation is structural. Probes only run when
// there is something real to probe (a custom domain, a live site).
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { ExtractedKnowledge } from './knowledge.ts';

export interface OptDns { apex: boolean; www: boolean; mx: boolean; spf: boolean; dmarc: boolean }
export interface OptInput {
  domain: string | null;                       // the custom domain, if any
  dns: OptDns | null;                          // null = not probed (no custom domain / probe failed)
  domainExpires: string | null;                // RDAP expiration date, if learnable
  httpProbe: { status: number; redirectsToHttps: boolean; hops: number } | null;
  homeProbe: { url: string; ms: number; contentEncoding: string; cacheControl: string; contentType: string } | null;
  robotsTxt: string | null;                    // live robots.txt body
  sitemapXml: string | null;                   // live sitemap.xml body
  knowledgeDocs: Array<{ id: string; filename: string; extracted: ExtractedKnowledge }>;
}

const fence = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
const timed = (ms: number) => AbortSignal.timeout(ms);

async function doh(name: string, type: string): Promise<Array<{ type: number; data: string }> | null> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { accept: 'application/dns-json' }, signal: timed(4000) });
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j?.Answer) ? j.Answer : [];
}

async function probeDns(domain: string): Promise<OptDns | null> {
  const [apex, www, mx, txt, dmarc] = await Promise.all([
    fence(doh(domain, 'A')), fence(doh(`www.${domain}`, 'A')),
    fence(doh(domain, 'MX')), fence(doh(domain, 'TXT')), fence(doh(`_dmarc.${domain}`, 'TXT')),
  ]);
  if (apex === null && www === null) return null;          // resolver unreachable — observe nothing
  return {
    apex: (apex ?? []).length > 0,
    www: (www ?? []).length > 0,
    mx: (mx ?? []).length > 0,
    spf: (txt ?? []).some((t) => /v=spf1/i.test(t.data)),
    dmarc: (dmarc ?? []).some((t) => /v=dmarc1/i.test(t.data)),
  };
}

async function probeRdap(domain: string): Promise<string | null> {
  const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`,
    { headers: { accept: 'application/rdap+json' }, signal: timed(5000), redirect: 'follow' });
  if (!r.ok) return null;
  const j = await r.json();
  const ev = (j?.events || []).find((e: { eventAction: string }) => e.eventAction === 'expiration');
  return typeof ev?.eventDate === 'string' ? ev.eventDate.slice(0, 10) : null;
}

async function probeHttp(domain: string): Promise<OptInput['httpProbe']> {
  let url = `http://${domain}/`, hops = 0, redirectsToHttps = false, status = 0;
  for (; hops < 5; hops++) {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: timed(5000) });
    status = r.status;
    const loc = r.headers.get('location');
    if (status >= 300 && status < 400 && loc) {
      url = new URL(loc, url).href;
      if (url.startsWith('https://')) redirectsToHttps = true;
      continue;
    }
    break;
  }
  return { status, redirectsToHttps, hops };
}

async function probeHome(liveUrl: string): Promise<OptInput['homeProbe']> {
  const t0 = Date.now();
  const r = await fetch(liveUrl, { headers: { 'accept-encoding': 'gzip, br' }, signal: timed(8000) });
  const ms = Date.now() - t0;
  await r.body?.cancel();
  return {
    url: liveUrl, ms,
    contentEncoding: r.headers.get('content-encoding') || '',
    cacheControl: r.headers.get('cache-control') || '',
    contentType: r.headers.get('content-type') || '',
  };
}

async function fetchText(url: string, cap = 100_000): Promise<string | null> {
  const r = await fetch(url, { signal: timed(5000) });
  if (!r.ok) return null;
  return (await r.text()).slice(0, cap);
}

export async function collectOptimization(site: SiteRow, liveUrl: string | null, domainOverride: string | null = null): Promise<OptInput> {
  // M11: Monitor sites probe the customer's EXTERNAL domain (read-only)
  const domain = domainOverride || site.custom_domain || null;
  const [dns, domainExpires, httpProbe, homeProbe, robotsTxt, sitemapXml, docsQ] = await Promise.all([
    domain ? fence(probeDns(domain)) : Promise.resolve(null),
    domain ? fence(probeRdap(domain)) : Promise.resolve(null),
    domain ? fence(probeHttp(domain)) : Promise.resolve(null),
    liveUrl ? fence(probeHome(liveUrl)) : Promise.resolve(null),
    liveUrl ? fence(fetchText(new URL('/robots.txt', liveUrl).href, 20_000)) : Promise.resolve(null),
    liveUrl ? fence(fetchText(new URL('/sitemap.xml', liveUrl).href)) : Promise.resolve(null),
    fence(svc(`presence_knowledge_docs?site_id=eq.${site.id}&deleted_at=is.null&select=id,filename,extracted&order=created_at.desc&limit=10`)),
  ]);
  return {
    domain, dns: dns ?? null, domainExpires: domainExpires ?? null,
    httpProbe: httpProbe ?? null, homeProbe: homeProbe ?? null,
    robotsTxt: robotsTxt ?? null, sitemapXml: sitemapXml ?? null,
    knowledgeDocs: ((docsQ as { json?: Array<{ id: string; filename: string; extracted: ExtractedKnowledge }> } | null)?.json ?? []).filter((d) => d.extracted),
  };
}
