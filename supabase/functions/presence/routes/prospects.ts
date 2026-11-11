// ── Prospects — the lead list (Semrush review, sales item 112, Nov 2026) ─────
// Semrush sells a Lead Finder; a studio here gets the same first step free:
// type a trade and a town, get real businesses (Google Places text search) with
// phone, website and address, each scored by a QUICK look at their website —
// no website scores highest, because that's the warmest gap a web studio fills.
// Tick the ones worth keeping; the saved list lives in presence_prospects.
// "→ Deal" starts at most one deal per prospect; "Draft a first email" only
// ever RETURNS words to copy — nothing on this surface sends email, ever.
//
//   POST /sales/prospects/discover  — search + quick score; saves nothing
//   GET  /sales/prospects           — the saved list
//   POST /sales/prospects           — save the ticked finds (dedupes)
//   PATCH /sales/prospects/:id      — status / notes
//   DELETE /sales/prospects/:id     — take one off the list (soft)
//   POST /sales/prospects/:id/convert — start the deal (once)
//   POST /sales/prospects/:id/draft — a first-email draft, never sent
//   GET  /sales/prospects/export    — the list as a CSV
//
// Needs a PLACES_KEY edge secret (a Google key with Places API (New) enabled);
// without it, discover answers places_not_configured and the page says who to ask.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow } from '../lib/ratelimit.ts';
import { toCsv } from '../lib/zip_csv.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { tableMissing } from './estimates.ts';
import { dealEvent } from './sales.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const clean = (s: unknown, max = 200) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const needsUpdate = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Prospects need a one-time database update before they can be kept.' }, 503, cors);
const SEARCHES_PER_DAY = 25;
const HEALTH = new Set(['no_website', 'unreachable', 'dated', 'decent', 'unknown']);
const STATUSES = new Set(['New', 'Contacted', 'In pipeline', 'Not a fit']);
const COLS = 'id,business_name,phone,website,address,industry,site_health,score,status,search_query,source,notes,deal_id,created_at,updated_at';

// dedupe keys: a business is the same business by normalized name or website host
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const host = (u: unknown) => { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ── the quick site look: one bounded GET, no redirects off-page, 6 s ─────────
// Scores OPPORTUNITY, not quality: the worse their web presence, the warmer the
// prospect. Overridable for tests.
export const quickDeps: { fetchPage?: (url: string) => Promise<{ ok: boolean; status: number; html: string } | null> } = {};
async function fetchPage(url: string): Promise<{ ok: boolean; status: number; html: string } | null> {
  if (quickDeps.fetchPage) return quickDeps.fetchPage(url);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'StudioOS-prospect-check/1.0' } });
    const html = (await r.text().catch(() => '')).slice(0, 120_000);
    return { ok: r.ok, status: r.status, html };
  } catch { return null; }
}
export async function quickSiteLook(website: string): Promise<{ health: string; score: number }> {
  const site = clean(website, 300);
  if (!site) return { health: 'no_website', score: 95 };
  let url: URL; try { url = new URL(site); } catch { return { health: 'unreachable', score: 85 }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { health: 'unreachable', score: 85 };
  const page = await fetchPage(url.href);
  if (!page || !page.ok) return { health: 'unreachable', score: 85 };
  const html = page.html.toLowerCase();
  // the two cheap tells of a site nobody maintains: not phone-ready, or not on https
  const dated = url.protocol === 'http:' || !/<meta[^>]+name=["']?viewport/.test(html) || !/<title[\s>]/.test(html);
  return dated ? { health: 'dated', score: 65 } : { health: 'decent', score: 30 };
}
export const HEALTH_WORDS: Record<string, string> = {
  no_website: 'No website', unreachable: 'Site not working', dated: 'Dated site', decent: 'Decent site', unknown: 'Not checked',
};

// ── discover: Places text search + the quick look; saves nothing ─────────────
export async function handleProspectDiscover(req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const KEY = Deno.env.get('PLACES_KEY') || '';
  if (!KEY) return json({ error: 'places_not_configured', message: 'Finding businesses isn’t switched on yet — the platform needs a Google Places key first.' }, 200, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const trade = clean(b.trade, 60), town = clean(b.town, 80);
  if (trade.length < 2 || town.length < 2) return json({ error: 'validation', message: 'Say what kind of business and where — like “plumbers” in “Burbank”.' }, 422, cors);
  if (!(await rateAllow(`prospect_discover:${site.id}`, SEARCHES_PER_DAY, 86_400))) {
    return json({ error: 'too_many', message: 'That’s plenty of searches for today. Try again tomorrow.' }, 429, cors);
  }
  const query = `${trade} in ${town}`;
  let places: any[] = [];
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.nationalPhoneNumber,places.formattedAddress,places.primaryTypeDisplayName',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
      signal: AbortSignal.timeout(15_000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: 'places_error', message: 'Google couldn’t run that search just now. Try again in a minute.' }, 502, cors);
    places = Array.isArray(d.places) ? d.places : [];
  } catch { return json({ error: 'places_error', message: 'Google couldn’t be reached just now. Try again in a minute.' }, 502, cors); }

  // already on the list? (saved prospects, by name or website host)
  const keptR = await svc(`presence_prospects?site_id=eq.${site.id}&deleted_at=is.null&select=business_name,website&limit=1000`).catch(() => null);
  const kept = keptR && (keptR as any).ok ? rows(keptR) : [];
  const keptNames = new Set(kept.map((p: any) => norm(p.business_name)));
  const keptHosts = new Set(kept.map((p: any) => host(p.website)).filter(Boolean));

  const finds = places.map((pl: any) => ({
    business_name: clean(pl?.displayName?.text, 200),
    phone: clean(pl?.nationalPhoneNumber, 40) || null,
    website: clean(pl?.websiteUri, 300) || null,
    address: clean(pl?.formattedAddress, 200) || null,
    industry: clean(pl?.primaryTypeDisplayName?.text, 80) || null,
  })).filter((f) => f.business_name);
  // the quick look, in parallel, bounded per site by its own timeout
  const looks = await Promise.all(finds.map((f) => quickSiteLook(f.website || '')));
  const data = finds.map((f, i) => ({
    ...f, site_health: looks[i].health, score: looks[i].score,
    health_word: HEALTH_WORDS[looks[i].health] || 'Not checked',
    already_saved: keptNames.has(norm(f.business_name)) || (!!f.website && keptHosts.has(host(f.website))),
  })).sort((a, b) => b.score - a.score);
  return json({ data: { query, found: data.length, finds: data } }, 200, cors);
}

// ── the saved list: GET (list) + POST (save the ticked finds) ────────────────
export async function handleProspects(req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    const r = await svc(`presence_prospects?site_id=eq.${site.id}&deleted_at=is.null&select=${COLS}&order=score.desc.nullslast,created_at.desc&limit=500`).catch(() => null);
    if (!r || !(r as any).ok) return r && tableMissing(r as any) ? needsUpdate(cors) : json({ error: 'read_failed', message: 'We couldn’t load your prospects just now.' }, 502, cors);
    // item 113: each row knows its pitch pack (one read; before APPLY-0150 there are simply none)
    const packs = new Map<string, any>();
    const pk = await svc(`presence_pitch_packs?site_id=eq.${site.id}&select=prospect_id,token,status&limit=1000`).catch(() => null);
    if (pk && (pk as any).ok) for (const row of rows(pk)) packs.set(String(row.prospect_id), row);
    return json({ data: rows(r).map((p: any) => { const k = packs.get(String(p.id)); return { ...withWord(p), pack_status: k?.status || null, pack_url: k?.status === 'ready' ? `/pitch.html?t=${k.token}` : null }; }) }, 200, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const asked = Array.isArray(b.prospects) ? b.prospects.slice(0, 20) : [];
    if (!asked.length) return json({ error: 'validation', message: 'Tick at least one business to save.' }, 422, cors);
    const keptR = await svc(`presence_prospects?site_id=eq.${site.id}&deleted_at=is.null&select=business_name,website&limit=1000`).catch(() => null);
    if (keptR && !(keptR as any).ok && tableMissing(keptR as any)) return needsUpdate(cors);
    const kept = keptR && (keptR as any).ok ? rows(keptR) : [];
    const seenNames = new Set(kept.map((p: any) => norm(p.business_name)));
    const seenHosts = new Set(kept.map((p: any) => host(p.website)).filter(Boolean));
    const saved: any[] = []; let skipped = 0;
    for (const f of asked) {
      const name = clean(f?.business_name, 200);
      if (!name) { skipped++; continue; }
      const site_ = clean(f?.website, 300);
      if (seenNames.has(norm(name)) || (site_ && seenHosts.has(host(site_)))) { skipped++; continue; }
      const health = HEALTH.has(String(f?.site_health)) ? String(f.site_health) : 'unknown';
      const score = Number.isFinite(Number(f?.score)) ? Math.min(100, Math.max(0, Math.trunc(Number(f.score)))) : null;
      const ins = await svc(`presence_prospects`, { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify({
        site_id: site.id, business_name: name, phone: clean(f?.phone, 40) || null, website: site_ || null,
        address: clean(f?.address, 200) || null, industry: clean(f?.industry, 80) || null,
        site_health: health, score, search_query: clean(b.query ?? f?.search_query, 160) || null,
      }) }).catch(() => null);
      if (ins && !(ins as any).ok && tableMissing(ins as any)) return needsUpdate(cors);
      const row = ins && (ins as any).ok ? rows(ins)[0] : null;
      if (row) { saved.push(withWord(row)); seenNames.add(norm(name)); if (site_) seenHosts.add(host(site_)); } else skipped++;
    }
    return json({ data: { saved, skipped } }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

function withWord(p: any) { return { ...p, health_word: HEALTH_WORDS[String(p.site_health)] || 'Not checked' }; }
async function loadProspect(siteId: string, id: string): Promise<any | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await svc(`presence_prospects?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=${COLS}&limit=1`).catch(() => null);
  return r && (r as any).ok ? rows(r)[0] || null : null;
}

// ── one prospect: PATCH status/notes · DELETE (soft) ─────────────────────────
export async function handleProspect(req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  const p = await loadProspect(site.id, id);
  if (!p) return json({ error: 'not_found', message: 'That prospect isn’t on your list.' }, 404, cors);
  if (req.method === 'DELETE') {
    const r = await svc(`presence_prospects?id=eq.${p.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString() }) }).catch(() => null);
    if (!r || !(r as any).ok) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
    return json({ data: { removed: true } }, 200, cors);
  }
  if (req.method === 'PATCH') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.status !== undefined) {
      if (!STATUSES.has(String(b.status))) return json({ error: 'validation', message: 'That isn’t a prospect status.' }, 422, cors);
      patch.status = String(b.status);
    }
    if (b.notes !== undefined) patch.notes = clean(b.notes, 2000) || null;
    const r = await svc(`presence_prospects?id=eq.${p.id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(patch) }).catch(() => null);
    if (!r || !(r as any).ok || !rows(r)[0]) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
    return json({ data: withWord(rows(r)[0]) }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ── "→ Deal": at most one deal per prospect, like an enquiry's convert ───────
export async function handleProspectConvert(_req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  const p = await loadProspect(site.id, id);
  if (!p) return json({ error: 'not_found', message: 'That prospect isn’t on your list.' }, 404, cors);
  if (p.deal_id) {
    const d = rows(await svc(`presence_deals?id=eq.${p.deal_id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,stage&limit=1`).catch(() => null) || { json: [] })[0];
    if (d) return json({ data: d, already_converted: true }, 200, cors);
  }
  const facts = [
    p.phone ? `Phone: ${p.phone}` : '', p.website ? `Website: ${p.website}` : 'No website',
    p.address ? `Address: ${p.address}` : '', p.industry ? `Trade: ${p.industry}` : '',
    p.search_query ? `Found by searching: ${p.search_query}` : '',
  ].filter(Boolean).join('\n');
  const ins = await svc('presence_deals', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify({
    site_id: site.id, title: p.business_name, stage: 'lead', source: 'prospecting', notes: `Prospecting find.\n${facts}`.slice(0, 2000),
  }) }).catch(() => null);
  const deal = ins && (ins as any).ok ? rows(ins)[0] : null;
  if (!deal) return json({ error: 'write_failed', message: 'That deal didn’t save — please try again.' }, 502, cors);
  await dealEvent(site.id, deal.id, 'created', principal, { to_stage: 'lead', detail: { prospect_id: p.id } }).catch(() => {});
  await svc(`presence_prospects?id=eq.${p.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ deal_id: deal.id, status: 'In pipeline', updated_at: new Date().toISOString() }) }).catch(() => {});
  return json({ data: deal }, 201, cors);
}

// ── "Draft a first email": words to copy. NOTHING here sends — by design. ────
export async function handleProspectDraft(_req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  const p = await loadProspect(site.id, id);
  if (!p) return json({ error: 'not_found', message: 'That prospect isn’t on your list.' }, 404, cors);
  const identR = await svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`).catch(() => null);
  const studio = clean(identR && (identR as any).ok ? rows(identR)[0]?.business_name : '', 120) || 'our studio';
  const town = p.address ? clean(String(p.address).split(',').slice(-3, -2).join('').trim(), 60) : '';
  const near = town ? ` here in ${town}` : ' nearby';
  const opening: Record<string, string> = {
    no_website: `I looked for ${p.business_name} online and couldn’t find a website — just your listing. These days most people check a business out online before they call, so that’s likely costing you work.`,
    unreachable: `I tried to open your website today and it wouldn’t load for me. If customers are hitting the same wall, that’s likely costing you work.`,
    dated: `I had a look at your website today, and it seems it hasn’t had attention in a while — on a phone especially, where most people will see it first.`,
    decent: `I came across ${p.business_name} and had a look at your website. It’s a solid start, and I think a few changes could bring you more enquiries from it.`,
    unknown: `I came across ${p.business_name} and had a look at how you show up online.`,
  };
  const subject = p.site_health === 'no_website' ? `A website for ${p.business_name}` : `Your website — a quick thought`;
  const body = [
    `Hi,`,
    ``,
    `I’m writing from ${studio} — we build and look after websites for local businesses${near}.`,
    ``,
    opening[String(p.site_health)] || opening.unknown,
    ``,
    `If it’s useful, I’d be glad to put together a free, no-strings look at what I’d do differently — a short note, not a sales call. Just reply and I’ll send it over.`,
    ``,
    `Either way, all the best with the business.`,
  ].join('\n');
  return json({ data: { subject, body, sent: false, note: 'This is only a draft to copy — Studio OS doesn’t send it.' } }, 200, cors);
}

// ── export: the saved list as one CSV ────────────────────────────────────────
export async function handleProspectsExport(site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const r = await svc(`presence_prospects?site_id=eq.${site.id}&deleted_at=is.null&select=${COLS}&order=score.desc.nullslast,created_at.desc&limit=2000`).catch(() => null);
  if (!r || !(r as any).ok) return r && tableMissing(r as any) ? needsUpdate(cors) : json({ error: 'read_failed', message: 'We couldn’t load your prospects just now.' }, 502, cors);
  const csv = toCsv(
    ['Business', 'Phone', 'Website', 'Address', 'Trade', 'Their site', 'Score', 'Status', 'Found by searching', 'Saved'],
    rows(r).map((p: any) => [p.business_name, p.phone, p.website, p.address, p.industry, HEALTH_WORDS[String(p.site_health)] || 'Not checked', p.score, p.status, p.search_query, String(p.created_at || '').slice(0, 10)]),
  );
  return new Response(csv, { status: 200, headers: { ...cors, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="prospects.csv"' } });
}
