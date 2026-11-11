// ── Pitch packs (Semrush review, sales item 113, Nov 2026) ───────────────────
// One link per prospect that makes the case for the studio: THEIR website's
// Site Review score and AI Visibility result, beside two nearby rivals. The
// same engines the free tools run — nothing here invents a number.
//
// Built ONE SCAN PER REQUEST: a full Site Review or AI check can take most of
// a minute, so POST /sales/prospects/:id/pack does the next missing piece and
// answers with honest progress; the page keeps calling until the pack is ready.
// Fresh reports are dear, so a tool_reports row under 30 days old is reused.
//
//   POST /sales/prospects/:id/pack — build the next piece (gate: edit)
//   GET  /sales/pack/:token        — the finished pack, PUBLIC by token alone
//
// Rivals come from the saved prospects first (same town, has a website); with
// a PLACES_KEY they are topped up from a Places search. A piece that can't be
// built (no website, AI not configured, scan failed) is skipped WITH ITS REASON
// — the pack says what it knows, never pretends.
import { json } from '../../_shared/http.ts';
import { insert, select } from '../../_shared/tools/db.ts';
import { logUsage, spendCapReached } from '../../_shared/tools/guard.ts';
import { TOOLS_BASE_URL } from '../../_shared/tools/config.ts';
import { assertPublicHttpUrl } from '../../_shared/tools/url_guard.ts';
import { ERROR_MESSAGES, runSiteReview, type ScanDeps } from '../../_shared/tools/site_review/scan.ts';
import { runAiVisibility, type AiScanDeps } from '../../_shared/tools/ai_visibility/scan.ts';
import { enabledEngines } from '../../_shared/tools/ai_visibility/engines.ts';
import { reportUrlFilter } from '../lib/search_visibility.ts';
import { svc } from '../lib/db.ts';
import { rateAllow } from '../lib/ratelimit.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { tableMissing } from './estimates.ts';
import { studioBrandOf } from './studio_brand.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const clean = (s: unknown, max = 200) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const needsUpdate = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Pitch packs need a one-time database update before they can be made.' }, 503, cors);
const PACKS_PER_DAY = 6;
const FRESH_DAYS = 30;

// Overridable for tests: the engines and the clock.
export const packDeps: { scan?: Partial<ScanDeps>; ai?: Partial<AiScanDeps>; now?: () => number } = {};
const now = () => (packDeps.now ? packDeps.now() : Date.now());

const host = (u: unknown) => { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** "2 Main St, Burbank, CA 91501" → "Burbank"; else the town in "plumbers in Burbank". */
export function townOf(p: { address?: unknown; search_query?: unknown }): string {
  const parts = String(p.address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return clean(parts[parts.length - 2].replace(/\d{4,}.*$/, ''), 60);
  const m = String(p.search_query || '').match(/\sin\s+(.+)$/i);
  return clean(m ? m[1] : '', 60);
}

/** The small summary a pack keeps: the score and the three things to lead with. */
function packScore(row: any) {
  const scores = (row?.scores && typeof row.scores === 'object') ? row.scores : {};
  const overall = Number(scores.overall);
  if (!Number.isFinite(overall)) return null;
  const items = Array.isArray(row?.findings?.items) ? row.findings.items : [];
  return {
    overall: Math.round(overall),
    label: clean(scores.label, 40),
    top_issues: items.slice(0, 3).map((f: any) => clean(f.title, 120)).filter(Boolean),
    report_id: row.id ? String(row.id) : null,
    checked_at: String(row.created_at || ''),
  };
}
const fresh = (row: any) => !!row && (now() - Date.parse(String(row.created_at || 0))) < FRESH_DAYS * 86_400_000;

async function latestFresh(tool: 'site_review' | 'ai_visibility', domain: string) {
  const filter = reportUrlFilter(domain);
  if (!filter) return null;
  const got = await select(`tool_reports?tool=eq.${tool}&${filter}&select=id,input,scores,findings,created_at&order=created_at.desc&limit=1`).catch(() => null);
  const row = got && got[0];
  return fresh(row) ? row : null;
}

/** A full Site Review for one business, reusing a fresh report. null = couldn't. */
async function reviewFor(url: string, businessType: string, city: string, note: string): Promise<{ summary: any; why?: string }> {
  const domain = host(url);
  if (!domain) return { summary: null, why: 'no_site' };
  const kept = await latestFresh('site_review', domain);
  if (kept) { const s = packScore(kept); if (s) return { summary: s }; }
  if (await spendCapReached()) return { summary: null, why: 'resting' };
  const result = await runSiteReview({ url, businessType: clean(businessType, 60) || 'local business', city }, { guard: assertPublicHttpUrl, ...(packDeps.scan || {}) }).catch(() => null);
  if (!result) return { summary: null, why: 'failed' };
  if (!result.ok) return { summary: null, why: result.error };
  const row = await insert('tool_reports', { tool: 'site_review', input: result.input, raw_results: result.raw, findings: result.findings, scores: result.scores, unlocked: true, unlocked_at: new Date().toISOString() }).catch(() => null);
  if (!row) return { summary: null, why: 'failed' };
  await logUsage({ tool: 'site_review', kind: 'scan', report_id: String(row.id), cost_usd: result.costUsd, note }).catch(() => {});
  const s = packScore(row);
  return s ? { summary: s } : { summary: null, why: 'failed' };
}

/** Two rivals: saved prospects with websites in the same town first (best sites
 *  first — the contrast is the pitch), topped up from Places when a key is set. */
async function pickRivals(site: SiteRow, p: any, town: string): Promise<Array<{ name: string; website: string }>> {
  const mine = host(p.website);
  const kept = rows(await svc(`presence_prospects?site_id=eq.${site.id}&deleted_at=is.null&id=neq.${p.id}&website=not.is.null&select=business_name,website,address,search_query,score&order=score.asc.nullslast&limit=200`).catch(() => null) || { json: [] });
  const townLc = town.toLowerCase();
  const near = kept.filter((k: any) => !townLc || townOf(k).toLowerCase() === townLc || String(k.address || '').toLowerCase().includes(townLc));
  const out: Array<{ name: string; website: string }> = [];
  const seen = new Set<string>(mine ? [mine] : []);
  for (const k of [...near, ...kept]) {
    const h = host(k.website);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push({ name: clean(k.business_name, 120), website: clean(k.website, 300) });
    if (out.length === 2) return out;
  }
  const KEY = Deno.env.get('PLACES_KEY') || '';
  if (KEY && town) {
    try {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'places.displayName,places.websiteUri' },
        body: JSON.stringify({ textQuery: `${clean(p.industry, 60) || 'businesses'} in ${town}`, maxResultCount: 10 }),
        signal: AbortSignal.timeout(15_000),
      });
      const d = await r.json().catch(() => ({}));
      for (const pl of (Array.isArray(d.places) ? d.places : [])) {
        const site_ = clean(pl?.websiteUri, 300), h = host(site_);
        const name = clean(pl?.displayName?.text, 120);
        if (!h || !name || seen.has(h)) continue;
        seen.add(h);
        out.push({ name, website: site_ });
        if (out.length === 2) break;
      }
    } catch { /* rivals stay as found */ }
  }
  return out;
}

const SKIP_WORDS: Record<string, string> = {
  no_site: 'They have no working website — which is the whole story.',
  resting: 'The day’s checking budget is used up; try again tomorrow.',
  failed: 'Their website couldn’t be checked just now.',
  ai_unavailable: 'The AI check isn’t switched on for this platform.',
  engines_failed: 'The AI services couldn’t be reached just now.',
  ambiguous: 'Too many businesses share this name for a clean AI answer.',
};
const skipWord = (why: string) => SKIP_WORDS[why] || (ERROR_MESSAGES as Record<string, string>)[why] || 'This piece couldn’t be built.';

async function loadProspect(siteId: string, id: string): Promise<any | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await svc(`presence_prospects?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=id,business_name,phone,website,address,industry,site_health,score,search_query&limit=1`).catch(() => null);
  return r && (r as any).ok ? rows(r)[0] || null : null;
}
const token = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);

function progress(pack: any, prospect: any) {
  const pieces = pack.pieces || {};
  const total = 4;
  let done = 0;
  if (pieces.you) done++;
  if (Array.isArray(pieces.rivals)) done += pieces.rivals.filter((r: any) => r.summary || r.why).length ? (pieces.rivals.every((r: any) => r.summary || r.why) ? 2 : 1) : 0;
  if (pieces.ai !== undefined) done++;
  return {
    state: pack.status, done, total,
    share_url: pack.status === 'ready' ? `/pitch.html?t=${pack.token}` : null,
    business_name: prospect.business_name,
  };
}

// ── build the next piece ──────────────────────────────────────────────────────
export async function handleProspectPack(req: Request, site: SiteRow, _principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  const p = await loadProspect(site.id, id);
  if (!p) return json({ error: 'not_found', message: 'That prospect isn’t on your list.' }, 404, cors);
  let body: any = {}; try { body = req.body ? await req.json() : {}; } catch { body = {}; }

  // one pack per prospect; making a NEW one is the rate-limited act
  let packR = await svc(`presence_pitch_packs?site_id=eq.${site.id}&prospect_id=eq.${p.id}&select=id,token,status,pieces,built_at&limit=1`).catch(() => null);
  if (packR && !(packR as any).ok && tableMissing(packR as any)) return needsUpdate(cors);
  let pack = packR && (packR as any).ok ? rows(packR)[0] : null;
  if (pack && pack.status === 'ready' && body.rebuild) {
    if (!(await rateAllow(`pitch_pack:${site.id}`, PACKS_PER_DAY, 86_400))) return json({ error: 'too_many', message: 'That’s plenty of packs for today. Try again tomorrow.' }, 429, cors);
    const r = await svc(`presence_pitch_packs?id=eq.${pack.id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify({ status: 'building', pieces: {}, built_at: null, updated_at: new Date().toISOString() }) }).catch(() => null);
    pack = r && (r as any).ok ? rows(r)[0] : null;
    if (!pack) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  }
  if (!pack) {
    if (!(await rateAllow(`pitch_pack:${site.id}`, PACKS_PER_DAY, 86_400))) return json({ error: 'too_many', message: 'That’s plenty of packs for today. Try again tomorrow.' }, 429, cors);
    const ins = await svc('presence_pitch_packs', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify({ site_id: site.id, prospect_id: p.id, token: token() }) }).catch(() => null);
    if (ins && !(ins as any).ok && tableMissing(ins as any)) return needsUpdate(cors);
    pack = ins && (ins as any).ok ? rows(ins)[0] : null;
    if (!pack) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  }
  if (pack.status === 'ready') return json({ data: progress(pack, p) }, 200, cors);

  const pieces = pack.pieces && typeof pack.pieces === 'object' ? pack.pieces : {};
  const town = townOf(p);

  // ONE expensive thing per request, in a fixed order
  if (!pieces.you) {
    if (!p.website || p.site_health === 'no_website' || p.site_health === 'unreachable') {
      pieces.you = { name: p.business_name, domain: host(p.website) || null, summary: null, why: 'no_site', note: SKIP_WORDS.no_site };
    } else {
      const got = await reviewFor(String(p.website), String(p.industry || ''), town, 'pitch pack: the prospect');
      pieces.you = { name: p.business_name, domain: host(p.website), summary: got.summary, ...(got.why ? { why: got.why, note: skipWord(got.why) } : {}) };
    }
  } else if (!Array.isArray(pieces.rivals)) {
    const rivals = await pickRivals(site, p, town);
    pieces.rivals = rivals.map((r) => ({ name: r.name, domain: host(r.website), website: r.website, summary: null }));
    if (!pieces.rivals.length) pieces.rivals_note = 'No nearby rivals on your list yet — save a couple with websites and rebuild the pack.';
  } else if (pieces.rivals.some((r: any) => !r.summary && !r.why)) {
    const r = pieces.rivals.find((x: any) => !x.summary && !x.why);
    const got = await reviewFor(String(r.website || ''), String(p.industry || ''), town, 'pitch pack: a rival');
    r.summary = got.summary;
    if (got.why) { r.why = got.why; r.note = skipWord(got.why); }
    delete r.website;   // the public pack names rivals; it doesn't link them
  } else if (pieces.ai === undefined) {
    const kept = p.business_name && town ? await latestFresh('ai_visibility', host(p.website)) : null;
    if (kept) {
      pieces.ai = { summary: packScore(kept) };
    } else if (!town) {
      pieces.ai = { summary: null, why: 'failed', note: 'Without a town on record, the AI check can’t tell this business from namesakes.' };
    } else if (!((packDeps.ai?.engines ?? enabledEngines()).length)) {
      pieces.ai = { summary: null, why: 'ai_unavailable', note: SKIP_WORDS.ai_unavailable };
    } else if (await spendCapReached()) {
      pieces.ai = { summary: null, why: 'resting', note: SKIP_WORDS.resting };
    } else {
      const result = await runAiVisibility(
        { businessName: String(p.business_name), city: town, businessType: '', searchPhrases: '', url: p.website ? String(p.website) : null, detail: '' },
        { guard: assertPublicHttpUrl, ...(packDeps.ai || {}) },
      ).catch(() => null);
      if (result && result.ok) {
        const row = await insert('tool_reports', { tool: 'ai_visibility', input: result.input, raw_results: result.raw, findings: result.findings, scores: result.scores, unlocked: true, unlocked_at: new Date().toISOString() }).catch(() => null);
        if (row) await logUsage({ tool: 'ai_visibility', kind: 'scan', report_id: String(row.id), cost_usd: result.costUsd, note: 'pitch pack' }).catch(() => {});
        pieces.ai = row ? { summary: packScore(row) } : { summary: null, why: 'failed', note: SKIP_WORDS.failed };
      } else {
        const why = result && !result.ok ? String((result as any).error || 'failed') : 'failed';
        pieces.ai = { summary: null, why, note: skipWord(why === 'not_configured' ? 'ai_unavailable' : why) };
      }
    }
  }

  const ready = !!pieces.you && Array.isArray(pieces.rivals) && pieces.rivals.every((r: any) => r.summary || r.why) && pieces.ai !== undefined;
  const patch: Record<string, unknown> = { pieces, updated_at: new Date().toISOString() };
  if (ready) { patch.status = 'ready'; patch.built_at = new Date().toISOString(); }
  const upd = await svc(`presence_pitch_packs?id=eq.${pack.id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(patch) }).catch(() => null);
  const saved = upd && (upd as any).ok ? rows(upd)[0] : null;
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  return json({ data: progress(saved, p) }, 200, cors);
}

// ── the finished pack, by token alone (pre-auth; pitch.html renders it) ───────
export async function handlePackPublic(tokenRaw: string, cors: Record<string, string>): Promise<Response> {
  const t = clean(tokenRaw, 64);
  if (!/^[0-9a-f]{24,64}$/.test(t)) return json({ error: 'not_found' }, 404, cors);
  const r = await svc(`presence_pitch_packs?token=eq.${t}&status=eq.ready&select=site_id,prospect_id,pieces,built_at&limit=1`).catch(() => null);
  if (r && !(r as any).ok && tableMissing(r as any)) return json({ error: 'not_found' }, 404, cors);
  const pack = r && (r as any).ok ? rows(r)[0] : null;
  if (!pack) return json({ error: 'not_found' }, 404, cors);
  const p = rows(await svc(`presence_prospects?id=eq.${pack.prospect_id}&select=business_name,address,industry,site_health&limit=1`).catch(() => null) || { json: [] })[0];
  const brand = await studioBrandOf(pack.site_id).catch(() => null);
  const pieces = pack.pieces || {};
  return json({ data: {
    business_name: clean(p?.business_name, 200) || String(pieces.you?.name || ''),
    town: p ? townOf(p) : '',
    industry: clean(p?.industry, 80),
    you: pieces.you || null,
    rivals: Array.isArray(pieces.rivals) ? pieces.rivals : [],
    rivals_note: pieces.rivals_note ? String(pieces.rivals_note) : null,
    ai: pieces.ai ?? null,
    built_at: pack.built_at,
    brand: brand ? { name: brand.name, logo_url: brand.logo_url, accent: brand.accent } : null,
    report_base: TOOLS_BASE_URL,
  } }, 200, cors);
}
