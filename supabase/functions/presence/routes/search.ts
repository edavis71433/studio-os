// ── /search/health · /redirects — Phase SD ──────────────────────────────────
// Search visibility as plain answers. The health read derives everything from
// what already exists (settings, identity, validation facts) plus live HEAD
// checks of the CUSTOMER-ENTERED links — the only links that can rot (internal
// links are correct by construction). Redirects get their UI's CRUD (the rows
// always shipped in the snapshot; now the owner can manage them).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { vocabFor } from '../lib/industry_vocab.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import type { SiteRow } from '../lib/site.ts';
import { siteOrigin, hostedName } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { parseRedirectList, planImport, suggestTargets, sitemapLocs, REDIRECT_CAP } from '../lib/redirect_import.ts';
import { assertPublicHttpUrl, normalizeSiteUrl, guardedFetch } from '../../_shared/tools/url_guard.ts';
import { fetchPublic, sameSite, looksLikeHtml } from '../../_shared/site_discovery.ts';

const fence = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

// item 204: a link the owner typed is fetched through the guarded fetcher (no private or
// internal address, on any redirect hop); a refused one reads as broken
export async function linkOk(url: string): Promise<boolean | null> {
  if (!/^https?:\/\//i.test(url)) return null;   // internal / relative → correct by construction
  const head = await fence(guardedFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) }));
  if (head && (head.ok || head.status === 405 || head.status === 403)) return true;  // some hosts refuse HEAD politely
  const get = await fence(guardedFetch(url, { method: 'GET', signal: AbortSignal.timeout(4000) }));
  if (get) await get.body?.cancel().catch(() => {});
  return get ? get.ok : false;
}

export async function handleSearchHealth(site: SiteRow, cors: Record<string, string>) {
  const [identQ, setQ, redirQ] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=seo_title,seo_description,booking_url,ordering_url,social&limit=1`),
    svc(`presence_settings?site_id=eq.${site.id}&select=industry_key,google_site_verification,bing_site_verification,pages_noindex,announcement_url&limit=1`),
    svc(`presence_redirects?site_id=eq.${site.id}&select=to_path&limit=50`),
  ]);
  const ident = identQ.json?.[0] ?? {}; const set = setQ.json?.[0] ?? {};
  const v = vocabFor(set.industry_key);
  // the rot-capable links: everything the customer typed
  const candidates: Array<{ kind: string; url: string }> = [];
  if (ident.booking_url) candidates.push({ kind: 'booking', url: ident.booking_url });
  if (ident.ordering_url) candidates.push({ kind: 'ordering', url: ident.ordering_url });
  if (set.announcement_url) candidates.push({ kind: 'announcement', url: set.announcement_url });
  for (const [k, u] of Object.entries(ident.social || {})) if (u) candidates.push({ kind: `social:${k}`, url: String(u) });
  for (const r of (redirQ.json ?? [])) if (/^https?:\/\//i.test(r.to_path)) candidates.push({ kind: 'redirect', url: r.to_path });
  const links = await Promise.all(candidates.slice(0, 12).map(async (cnd) => ({ ...cnd, ok: await linkOk(cnd.url) })));
  return json({ data: {
    verification: { google: !!String(set.google_site_verification || '').trim(), bing: !!String(set.bing_site_verification || '').trim() },
    seo_fields: { title: !!String(ident.seo_title || '').trim(), description: !!String(ident.seo_description || '').trim() },
    schema: { type: v.schemaType, industry: set.industry_key || 'generic' },
    sitemap: true, robots: true,                    // by construction — stated, not computed
    internal_links: 'correct_by_construction',
    hidden_pages: Array.isArray(set.pages_noindex) ? set.pages_noindex : [],
    links,
  } }, 200, cors);
}

// ── redirects CRUD (owner; plain rules). Item 156: up to 500, the publish check's own
//    limit (it was 50), and a whole list at once (POST /redirects with `list`). ──
const FIXED = new Set(['/', '/about/', '/faq/', '/contact/', '/updates/', '/privacy/', '/accessibility/', '/thanks/', '/menu/', '/services/', '/products/', '/classes/', '/programs/']);

export async function handleRedirectsList(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_redirects?site_id=eq.${site.id}&select=id,from_path,to_path&order=from_path.asc&limit=${REDIRECT_CAP}`);
  return json({ data: r.json ?? [], cap: REDIRECT_CAP }, 200, cors);
}

export async function handleRedirectCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  if (typeof b?.list === 'string') return importRedirects(b, site, principal, cors);   // item 156: a whole list at once
  let from = String(b?.from_path || '').trim().toLowerCase();
  const to = String(b?.to_path || '').trim();
  if (from && !from.startsWith('/')) from = '/' + from;
  if (from && !from.endsWith('/')) from = from + '/';
  if (!/^\/[a-z0-9\-\/]{1,120}\/$/.test(from)) return json({ error: 'bad_from', message: 'The old address should look like /old-page/ — letters, numbers, and dashes.' }, 422, cors);
  if (FIXED.has(from)) return json({ error: 'reserved', message: 'That address is one of your site’s own pages.' }, 422, cors);
  const internal = to.startsWith('/');
  if (!internal && !/^https:\/\/[^\s]+$/i.test(to)) return json({ error: 'bad_to', message: 'Send visitors to one of your pages (like /services/) or a full https:// address.' }, 422, cors);
  const cnt = await svc(`presence_redirects?site_id=eq.${site.id}&select=id&limit=${REDIRECT_CAP + 1}`);
  if ((cnt.json ?? []).length >= REDIRECT_CAP) return json({ error: 'limit', message: `A site keeps at most ${REDIRECT_CAP} forwards. Remove one you no longer need.` }, 422, cors);
  const w = await svc('presence_redirects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, from_path: from, to_path: to }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — is the old address already redirected?' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Added a redirect from ${from}`, principal, provenance: 'human', fields: ['redirect'] });
  return json({ data: w.json[0] }, 200, cors);
}

// ── item 156: a whole list of old addresses at once ──────────────────────────
// `list` is the pasted text or a CSV file's text, one "old, new" per line. With
// `dry_run` it only says what each line would do; without, it saves the lines that
// add or replace a forward, and points older forwards that would now chain straight
// at the final page, so the site still publishes.
const ownPagePaths = (settings: { pages?: unknown; nav?: unknown } | null) => {
  const out = new Set<string>(['/']);
  for (const p of (Array.isArray(settings?.pages) ? settings!.pages as Array<{ slug?: string }> : [])) if (p && p.slug) out.add(`/${String(p.slug).toLowerCase()}/`);
  const walk = (items: unknown) => { for (const it of (Array.isArray(items) ? items as Array<{ href?: string; children?: unknown }> : [])) { if (it && typeof it.href === 'string' && /^\/[a-z0-9\-/]*$/i.test(it.href)) out.add(it.href.toLowerCase().endsWith('/') ? it.href.toLowerCase() : it.href.toLowerCase() + '/'); if (it) walk(it.children); } };
  walk(settings?.nav);
  return out;
};
const ownHostsOf = (site: SiteRow) => [site.custom_domain || '', site.netlify_site_id ? `${hostedName(site.id)}.netlify.app` : ''].filter(Boolean);

async function importRedirects(b: { list: string; dry_run?: unknown }, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const [exQ, setQ] = await Promise.all([
    svc(`presence_redirects?site_id=eq.${site.id}&select=id,from_path,to_path&limit=${REDIRECT_CAP + 1}`),
    svc(`presence_settings?site_id=eq.${site.id}&select=pages,nav&limit=1`),
  ]);
  if (!exQ.ok || !setQ.ok) return json({ error: 'read_failed', message: 'Your forwards couldn’t be read just now, so nothing was brought in.' }, 502, cors);
  const existing = (exQ.json ?? []) as Array<{ id: string; from_path: string; to_path: string }>;
  const settings = ((setQ.json ?? []) as Array<{ pages?: unknown; nav?: unknown }>)[0] || null;
  const own = new Set([...FIXED, ...ownPagePaths(settings)]);
  const { pairs, problems } = parseRedirectList(b.list);
  if (!pairs.length && !problems.length) return json({ error: 'empty', message: 'Paste at least one line: the old address, then where it goes now.' }, 422, cors);
  const plan = planImport({ pairs, problems, existing, ownPages: own, ownHosts: ownHostsOf(site) });
  if (b.dry_run === true) return json({ data: { ...plan, dry_run: true } }, 200, cors);
  const save = plan.rows.filter((r) => r.verdict === 'add' || r.verdict === 'replace').map((r) => ({ site_id: site.id, from_path: r.from, to_path: r.to, source: 'import' }));
  if (save.length) {
    const w = await svc('presence_redirects?on_conflict=site_id,from_path', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(save) });
    if (!w.ok) return json({ error: 'write_failed', message: 'The list didn’t save, so nothing changed. Try again in a moment.' }, 502, cors);
  }
  // older forwards that would now land on a forwarded address go straight to the final page
  await Promise.all(plan.repoint.map((x) => svc(`presence_redirects?id=eq.${x.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ to_path: x.to }) }).catch(() => null)));
  if (save.length || plan.repoint.length) {
    await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Brought in ${plan.add} forward${plan.add === 1 ? '' : 's'}${plan.replace ? `, replaced ${plan.replace}` : ''}`, principal, provenance: 'human', fields: ['redirect'] });
  }
  return json({ data: { ...plan, dry_run: false } }, 200, cors);
}

// ── item 156: read the old website's own page list and suggest where each page goes ──
// GET /redirects/suggest?from=old-site.example. Reads its sitemap (robots.txt's, then
// /sitemap.xml; a sitemap index's first few children), keeps the pages on that site,
// and matches each to a page here by its words, an old blog post to Updates, the rest
// to the home page. A read: nothing is saved until the list is brought in.
const SUGGEST_MAX_PAGES = 500, SUGGEST_MAX_CHILDREN = 6;
const UA = 'Mozilla/5.0 (compatible; StudioOS-Forwards/1.0; +https://davisdigitalstudio.com)';
export async function handleRedirectSuggest(req: Request, site: SiteRow, cors: Record<string, string>) {
  const raw = new URL(req.url).searchParams.get('from') || '';
  const origin = normalizeSiteUrl(raw);
  if (!origin) return json({ error: 'bad_from', message: 'Type the old website’s address, like oldsite.com.' }, 422, cors);
  let host: string; try { host = new URL(origin).hostname; } catch { return json({ error: 'bad_from', message: 'Type the old website’s address, like oldsite.com.' }, 422, cors); }
  const mine = ownHostsOf(site);
  if (mine.some((h) => sameSite(h, host)) || sameSite(new URL(siteOrigin(site) || 'https://invalid.example').hostname, host)) return json({ error: 'same_site', message: 'That’s this website’s own address. Type the old website’s address.' }, 422, cors);
  const guard = (u: string) => assertPublicHttpUrl(u);
  const get = (u: string) => fetchPublic(u, guard, { ua: UA, accept: 'application/xml,text/xml,*/*;q=0.5', timeoutMs: 6000, maxBytes: 3 * 1024 * 1024 });
  const base = new URL(origin).origin;
  const robots = await fetchPublic(base + '/robots.txt', guard, { ua: UA, accept: 'text/plain,*/*;q=0.5', timeoutMs: 5000, maxBytes: 256 * 1024 }).catch(() => null);
  const declared = robots && robots.status === 200 && !looksLikeHtml(robots.text) ? [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const tries = [...declared.filter((u) => { try { return sameSite(new URL(u).hostname, host); } catch { return false; } }), base + '/sitemap.xml'];
  const pages = new Set<string>();
  for (const url of [...new Set(tries)].slice(0, 3)) {
    const r = await get(url).catch(() => null);
    if (!r || r.status !== 200 || looksLikeHtml(r.text)) continue;
    const top = sitemapLocs(r.text);
    const lists = [r.text, ...(await Promise.all(top.children.filter((c) => { try { return sameSite(new URL(c).hostname, host); } catch { return false; } }).slice(0, SUGGEST_MAX_CHILDREN).map((c) => get(c).then((x) => (x && x.status === 200 ? x.text : '')).catch(() => ''))))];
    for (const xml of lists) for (const loc of sitemapLocs(xml).pages) {
      try { const u = new URL(loc); if (sameSite(u.hostname, host) && pages.size < SUGGEST_MAX_PAGES) pages.add(u.pathname); } catch { /* not an address */ }
    }
    if (pages.size) break;
  }
  if (!pages.size) return json({ error: 'no_sitemap', message: `We couldn’t find a list of pages on ${host}. Paste the old addresses instead, one per line.` }, 422, cors);
  const setQ = await svc(`presence_settings?site_id=eq.${site.id}&select=pages,nav&limit=1`);
  const settings = ((setQ.json ?? []) as Array<{ pages?: Array<{ slug?: string; title?: string }>; nav?: unknown }>)[0] || null;
  const titled = new Map<string, string>();
  for (const p of (Array.isArray(settings?.pages) ? settings!.pages! : [])) if (p && p.slug) titled.set(`/${String(p.slug).toLowerCase()}/`, String(p.title || ''));
  const ownList = [...new Set([...FIXED, ...ownPagePaths(settings)])].map((path) => ({ path, title: titled.get(path) || '' }));
  const lines = suggestTargets([...pages], ownList);
  return json({ data: { host, found: pages.size, lines, sure: lines.filter((l) => l.sure).length } }, 200, cors);
}

export async function handleRedirectDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request', message: 'Invalid redirect reference.' }, 400, cors);
  const w = await svc(`presence_redirects?id=eq.${id}&site_id=eq.${site.id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!w.ok || !Array.isArray(w.json) || !w.json.length) return json({ error: 'not_found', message: 'That redirect isn’t here.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: 'Removed a redirect', principal, provenance: 'human', fields: ['redirect'] });
  return json({ data: { ok: true } }, 200, cors);
}
