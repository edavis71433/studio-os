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
import type { Principal } from '../../_shared/auth.ts';

const fence = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

async function linkOk(url: string): Promise<boolean | null> {
  if (!/^https?:\/\//i.test(url)) return null;   // internal / relative → correct by construction
  const head = await fence(fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) }));
  if (head && (head.ok || head.status === 405 || head.status === 403)) return true;  // some hosts refuse HEAD politely
  const get = await fence(fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(4000) }));
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

// ── redirects CRUD (owner; cap 50; plain rules) ──────────────────────────────
const FIXED = new Set(['/', '/about/', '/faq/', '/contact/', '/updates/', '/privacy/', '/accessibility/', '/thanks/', '/menu/', '/services/', '/products/', '/classes/', '/programs/']);

export async function handleRedirectsList(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_redirects?site_id=eq.${site.id}&select=id,from_path,to_path&order=from_path.asc&limit=50`);
  return json({ data: r.json ?? [] }, 200, cors);
}

export async function handleRedirectCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  let from = String(b?.from_path || '').trim().toLowerCase();
  const to = String(b?.to_path || '').trim();
  if (from && !from.startsWith('/')) from = '/' + from;
  if (from && !from.endsWith('/')) from = from + '/';
  if (!/^\/[a-z0-9\-\/]{1,120}\/$/.test(from)) return json({ error: 'bad_from', message: 'The old address should look like /old-page/ — letters, numbers, and dashes.' }, 422, cors);
  if (FIXED.has(from)) return json({ error: 'reserved', message: 'That address is one of your site’s own pages.' }, 422, cors);
  const internal = to.startsWith('/');
  if (!internal && !/^https:\/\/[^\s]+$/i.test(to)) return json({ error: 'bad_to', message: 'Send visitors to one of your pages (like /services/) or a full https:// address.' }, 422, cors);
  const cnt = await svc(`presence_redirects?site_id=eq.${site.id}&select=id&limit=51`);
  if ((cnt.json ?? []).length >= 50) return json({ error: 'limit', message: 'Redirects are capped at 50 — remove one you no longer need.' }, 422, cors);
  const w = await svc('presence_redirects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, from_path: from, to_path: to }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — is the old address already redirected?' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Added a redirect from ${from}`, principal, provenance: 'human', fields: ['redirect'] });
  return json({ data: w.json[0] }, 200, cors);
}

export async function handleRedirectDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad_request', message: 'Invalid redirect reference.' }, 400, cors);
  const w = await svc(`presence_redirects?id=eq.${id}&site_id=eq.${site.id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!w.ok || !Array.isArray(w.json) || !w.json.length) return json({ error: 'not_found', message: 'That redirect isn’t here.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: 'Removed a redirect', principal, provenance: 'human', fields: ['redirect'] });
  return json({ data: { ok: true } }, 200, cors);
}
