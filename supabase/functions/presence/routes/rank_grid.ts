// ── The map rank grid, the Search tab's routes (builder list item 185) ───────────
//   GET  /visibility/maps             the setting, each search's latest scan, the history
//   PUT  /visibility/maps             { enabled?, phrases?, size?, spacing? }
//   PUT  /visibility/maps/place       { place_id, source }: the business on Google (null forgets it)
//   POST /visibility/maps/find        { query? }: find the business by name and address
//   GET  /visibility/maps/names?ids=  names for up to six place ids, asked for now, never kept
//   POST /visibility/maps/scan        { phrase }: Scan now, three a day per client
// "The studio" is platform staff or a studio scoped into its client (lib/actor_kind.ts).
// The grid spends the platform's Google key, so only the studio switches it on, scans,
// sees a cost or a rival's name. A client sees their own grid and its numbers once the
// studio has switched it on, nothing before. None of the writes is on the member table
// (lib/site_roles.ts), so every seat is refused at the gate, and these handlers refuse
// anyone else who isn't the studio. Under /visibility for the reason routes/visibility.ts
// gives: search works whoever hosts the site.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow } from '../lib/ratelimit.ts';
import { updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { actsForClient } from '../lib/actor_kind.ts';
import {
  COORDS_KEEP_DAYS, GRID_FINDS_PER_DAY, GRID_NAME_ASKS_PER_DAY, GRID_NOW_PER_DAY, PLACE_ID_RE, PRICES,
  applyGridChange, checkPlaceId, costWords, findPlaces, mapsPlaceUrl, nextScanDay, normalizeGridSetting,
  placeIdFromReviewUri, placeNames, scanCost, type GridSetting, type PlaceSource,
} from '../lib/rank_grid.ts';
import { SCAN_COLS, readGridSetting, scanAndKeep } from '../ops/rank_grid_scans.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const missing = (r: { ok?: boolean; status?: number; json?: unknown } | null) => !!r && !r.ok && (r.status === 404 || /PGRST205|42P01/.test(JSON.stringify(r.json ?? '')));
const HIST_COLS = 'id,phrase,kind,scanned_at,size,spacing_mi,ranks,total,top3,found,avg_rank,cost_usd';
const DAY_MS = 86_400_000;

/** Platform staff, or a studio scoped into this client. Pure. */
export const isStudio = (p: Pick<Principal, 'kind' | 'scope'>) => p.kind === 'staff' || actsForClient(p);
const studioOnly = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'The map rank grid is the studio’s to set up and run.' }, 403, cors);
const noKey = (cors: Record<string, string>) => json({ error: 'places_not_configured', message: 'Google isn’t connected for the platform yet: it needs the Places key first.' }, 503, cors);
const needsUpdate = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'The map rank grid needs a one-time database update first.' }, 503, cors);
export const SCAN_WORDS: Record<string, string> = {
  places_not_configured: 'Google isn’t connected for the platform yet: it needs the Places key first.',
  no_place: 'Confirm the business on Google first.',
  not_found: 'Google can’t find the business’s place any more. Find it again in the grid’s settings.',
  google_refused: 'Google turned the search down just now. Try again in a few minutes.',
  google_unreachable: 'Google couldn’t be reached just now. Try again in a few minutes.',
  google_quota: 'Google’s daily allowance for these searches is used up for the platform. It starts again overnight; try tomorrow.',
  too_many_gaps: 'Google didn’t answer for enough of the spots. Try again in a few minutes.',
  no_center: 'Google hides this business’s address, and its business details have no address or town to centre the grid on. Add one under Business details, then scan again.',
  not_ready: 'The map rank grid needs a one-time database update first.',
  not_kept: 'The scan ran but didn’t save. Try again.',
};

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try { const b = await req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; }
}
const todayStartMs = (nowMs: number) => Math.floor(nowMs / DAY_MS) * DAY_MS;

/** The setting as the studio's page reads it. Pure. */
export function settingView(s: GridSetting, nowIso: string) {
  return {
    enabled: s.enabled, phrases: s.phrases, size: s.size, spacing: s.spacing, next: nextScanDay(nowIso),
    place: s.place ? { ...s.place, maps: mapsPlaceUrl(s.place.id) } : null,
    last_result: s.last_result,
  };
}

/** One scan as the card shows it. The client's view leaves out who came up ahead, the
 *  place ids, where the spots are and the cost. Pure. */
export function scanView(row: Record<string, any>, studio: boolean, nowMs: number, prev: Record<string, any> | null) {
  const ranks: Array<number | null> = Array.isArray(row.ranks) ? row.ranks.map((v: unknown) => (v == null ? null : Number(v))) : [];
  const read = ranks.filter((v) => v != null).length;
  const base = {
    id: String(row.id), phrase: String(row.phrase), kind: String(row.kind), scanned_at: String(row.scanned_at),
    size: Number(row.size), spacing: Number(row.spacing_mi), ranks,
    total: Number(row.total) || ranks.length, read, top3: Number(row.top3) || 0, top10: Number(row.top10) || 0,
    found: Number(row.found) || 0, out: ranks.filter((v) => v === 0).length,
    avg: row.avg_rank == null ? null : Number(row.avg_rank),
    change: prev ? { top3: (Number(row.top3) || 0) - (Number(prev.top3) || 0), since: String(prev.scanned_at) } : null,
  };
  if (!studio) return base;
  const fresh = row.center_lat != null && row.center_lng != null && nowMs - Date.parse(String(row.scanned_at)) < COORDS_KEEP_DAYS * DAY_MS;
  const cost = Number(row.cost_usd) || 0;
  return {
    ...base, place_id: String(row.place_id || ''),
    tops: Array.isArray(row.tops) ? row.tops : [], rivals: Array.isArray(row.rivals) ? row.rivals.slice(0, 3) : [],
    center: fresh ? { lat: Number(row.center_lat), lng: Number(row.center_lng) } : null,
    requests: row.requests && typeof row.requests === 'object' ? row.requests : {},
    cost_usd: cost, cost_words: costWords(cost),
  };
}

/** A line of the history: when, which search, how it ran, the small grid. Pure. */
export function histView(h: Record<string, any>, studio: boolean) {
  const base = {
    id: String(h.id), phrase: String(h.phrase), kind: String(h.kind), scanned_at: String(h.scanned_at), size: Number(h.size), spacing: Number(h.spacing_mi) || 1,
    ranks: Array.isArray(h.ranks) ? h.ranks.map((v: unknown) => (v == null ? null : Number(v))) : [],
    total: Number(h.total) || 0, top3: Number(h.top3) || 0, found: Number(h.found) || 0, avg: h.avg_rank == null ? null : Number(h.avg_rank),
  };
  if (!studio) return base;
  const cost = Number(h.cost_usd) || 0;
  return { ...base, cost_usd: cost, cost_words: costWords(cost) };
}

/** The business on Google before the studio confirms one: the client's connected
 *  listing first (its review link carries the place id), then an id pasted for reviews. */
async function suggestedPlace(siteId: string): Promise<{ id: string; source: PlaceSource; maps: string } | null> {
  const [dataQ, identQ] = await Promise.all([
    svc(`presence_connected_data?site_id=eq.${siteId}&provider_key=eq.google_business_profile&select=data&limit=1`).catch(() => null),
    svc(`presence_identity?site_id=eq.${siteId}&select=google_place_id&limit=1`).catch(() => null),
  ]);
  const listing = placeIdFromReviewUri(rows(dataQ)[0]?.data?.listing_review_uri);
  if (listing) return { id: listing, source: 'listing', maps: mapsPlaceUrl(listing) };
  const pasted = String(rows(identQ)[0]?.google_place_id || '').trim();
  return PLACE_ID_RE.test(pasted) ? { id: pasted, source: 'pasted', maps: mapsPlaceUrl(pasted) } : null;
}

export async function handleMapsGet(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const studio = isStudio(principal);
  const nowMs = Date.now(), nowIso = new Date(nowMs).toISOString();
  const [s, histQ] = await Promise.all([
    readGridSetting(site.id),
    svc(`presence_rank_grid_scans?site_id=eq.${site.id}&select=${HIST_COLS}&order=scanned_at.desc&limit=60`).catch(() => null),
  ]);
  const ready = !!(histQ && histQ.ok);
  // a client sees nothing until the studio switches the grid on
  if (!studio && !s.enabled) return json({ data: { ready, studio: false, enabled: false } }, 200, cors);
  const hist = ready ? rows(histQ) : [];
  const byPhrase = new Map<string, any[]>();
  for (const h of hist) { const k = String(h.phrase); const l = byPhrase.get(k) || []; l.push(h); byPhrase.set(k, l); }
  // each current search's newest scan in full (one read), and the one before for the change
  const phrases = s.phrases.length ? s.phrases : [...byPhrase.keys()].slice(0, 3);
  const newest = phrases.map((p) => byPhrase.get(p)?.[0]?.id).filter((id): id is string => !!id);
  const fullQ = newest.length ? await svc(`presence_rank_grid_scans?site_id=eq.${site.id}&id=in.(${newest.join(',')})&select=${SCAN_COLS}`).catch(() => null) : null;
  const full = new Map(rows(fullQ).map((r) => [String(r.id), r]));
  const latest: Record<string, unknown> = {};
  for (const p of phrases) {
    const list = byPhrase.get(p) || [];
    const row = list[0] ? full.get(String(list[0].id)) : null;
    if (row) latest[p] = scanView(row, studio, nowMs, list[1] || null);
  }
  const data: Record<string, unknown> = {
    ready, studio, enabled: s.enabled, phrases, size: s.size, spacing: s.spacing, next: nextScanDay(nowIso),
    latest, history: hist.slice(0, 24).map((h) => histView(h, studio)),
  };
  if (studio) {
    const since = todayStartMs(nowMs);
    Object.assign(data, {
      key: !!Deno.env.get('PLACES_KEY'),
      place: s.place ? { ...s.place, maps: mapsPlaceUrl(s.place.id) } : null,
      suggested: s.place ? null : await suggestedPlace(site.id),
      last_result: s.last_result,
      today: { used: hist.filter((h) => h.kind === 'now' && Date.parse(String(h.scanned_at)) >= since).length, cap: GRID_NOW_PER_DAY },
      prices: { as_of: PRICES.as_of, source: PRICES.source, scan_usd: scanCost({ location: 1 }), scan_words: costWords(scanCost({ location: 1 })), hidden_usd: scanCost({ location: 1, address: 1 }), hidden_words: costWords(scanCost({ location: 1, address: 1 })), name_usd: PRICES.name, find_usd: PRICES.find },
    });
  }
  return json({ data }, 200, cors);
}

export async function handleMapsPut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!isStudio(principal)) return studioOnly(cors);
  const b = await readBody(req);
  if (!['enabled', 'phrases', 'size', 'spacing'].some((k) => b[k] !== undefined)) return json({ error: 'bad_request', message: 'Say what to change: on or off, the searches, or the grid.' }, 400, cors);
  const nowIso = new Date().toISOString();
  let refused = '';
  const saved = await updateReservedJson(site.id, RESERVED_NAMES.rankGrid, (cur) => {
    const r = applyGridChange(normalizeGridSetting(cur), b, principal.email || null, nowIso);
    if ('error' in r) { refused = r.error; throw new Error('refused'); }
    return r;
  }, principal.email || 'studio').catch(() => null);
  if (refused) return json({ error: 'bad_request', message: refused }, 400, cors);
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  return json({ data: settingView(saved, nowIso) }, 200, cors);
}

export async function handleMapsPlace(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!isStudio(principal)) return studioOnly(cors);
  const b = await readBody(req);
  const nowIso = new Date().toISOString(), who = principal.email || null;
  const save = (change: (s: GridSetting) => GridSetting) => updateReservedJson(site.id, RESERVED_NAMES.rankGrid, (cur) => change(normalizeGridSetting(cur)), who || 'studio').catch(() => null);
  if (b.place_id === null) {   // forget the business: the grid can't run without one, so it switches off
    const saved = await save((s) => ({ ...s, place: null, enabled: false, updated_by: who, updated_at: nowIso }));
    return saved ? json({ data: settingView(saved, nowIso) }, 200, cors) : json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  }
  const raw = clean(b.place_id, 600);
  const id = /^https?:\/\//i.test(raw) ? placeIdFromReviewUri(raw) || '' : raw;
  if (!PLACE_ID_RE.test(id)) return json({ error: 'bad_place_id', message: 'That doesn’t look like a Google place id. Find the business by name instead.' }, 400, cors);
  const source: PlaceSource = b.source === 'listing' || b.source === 'pasted' ? b.source : 'search';
  const key = Deno.env.get('PLACES_KEY') || '';
  if (!key) return noKey(cors);
  const chk = await checkPlaceId(key, id);   // free: the id field only
  if (!chk.ok) return chk.reason === 'not_found'
    ? json({ error: 'not_found', message: 'Google doesn’t know that place. Find the business by name instead.' }, 400, cors)
    : json({ error: chk.reason, message: SCAN_WORDS[chk.reason] }, 502, cors);
  const saved = await save((s) => ({ ...s, place: { id: chk.id, source, confirmed_by: who, confirmed_at: nowIso }, updated_by: who, updated_at: nowIso }));
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  return json({ data: settingView(saved, nowIso) }, 200, cors);
}

/** The search to start from: the business's name and its address on file. */
async function defaultQuery(siteId: string): Promise<string> {
  const [identQ, locQ] = await Promise.all([
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => null),
    svc(`presence_locations?site_id=eq.${siteId}&select=address_line1,city,region&limit=1`).catch(() => null),
  ]);
  const loc = rows(locQ)[0] || {};
  return clean([rows(identQ)[0]?.business_name, loc.address_line1, loc.city, loc.region].map((x) => clean(x, 80)).filter(Boolean).join(', '), 160);
}

export async function handleMapsFind(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!isStudio(principal)) return studioOnly(cors);
  const key = Deno.env.get('PLACES_KEY') || '';
  if (!key) return noKey(cors);
  const b = await readBody(req);
  const query = clean(b.query, 160) || await defaultQuery(site.id);
  if (query.length < 3) return json({ error: 'validation', message: 'Type the business’s name and its town.' }, 400, cors);
  if (!(await rateAllow(`rank_grid_find:${site.id}`, GRID_FINDS_PER_DAY, 86_400))) return json({ error: 'too_many', message: 'That’s plenty of searches for today. Try again tomorrow.' }, 429, cors);
  const r = await findPlaces(key, query);
  if (!r.ok) return json({ error: r.reason, message: SCAN_WORDS[r.reason] }, 502, cors);
  return json({ data: { query, found: r.found, cost_words: costWords(PRICES.find) } }, 200, cors);
}

export async function handleMapsNames(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!isStudio(principal)) return studioOnly(cors);
  const key = Deno.env.get('PLACES_KEY') || '';
  if (!key) return noKey(cors);
  const ids = [...new Set(String(new URL(req.url).searchParams.get('ids') || '').split(',').map((x) => x.trim()).filter((x) => PLACE_ID_RE.test(x)))].slice(0, 6);
  if (!ids.length) return json({ error: 'validation', message: 'Say which places to name.' }, 400, cors);
  if (!(await rateAllow(`rank_grid_names:${site.id}`, GRID_NAME_ASKS_PER_DAY, 86_400))) return json({ error: 'too_many', message: 'That’s plenty of names for today. They come back tomorrow.' }, 429, cors);
  const names = await placeNames(key, ids);
  return json({ data: { names, cost_words: costWords(PRICES.name * ids.length) } }, 200, cors);
}

export async function handleMapsScan(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!isStudio(principal)) return studioOnly(cors);
  const b = await readBody(req);
  const s = await readGridSetting(site.id);
  if (!s.enabled) return json({ error: 'off', message: 'Switch the map rank grid on for this client first.' }, 409, cors);
  if (!s.place) return json({ error: 'no_place', message: SCAN_WORDS.no_place }, 409, cors);
  const asked = clean(b.phrase, 80).toLowerCase();
  const phrase = asked ? s.phrases.find((p) => p.toLowerCase() === asked) : s.phrases[0];
  if (!phrase) return json({ error: 'validation', message: 'Scan one of this client’s searches.' }, 400, cors);
  if (!Deno.env.get('PLACES_KEY')) return noKey(cors);
  // three a day: counted from the scans kept today (UTC); the limiter stops a burst of clicks
  const since = new Date(todayStartMs(Date.now())).toISOString();
  const usedQ = await svc(`presence_rank_grid_scans?site_id=eq.${site.id}&kind=eq.now&scanned_at=gte.${encodeURIComponent(since)}&select=id&limit=10`).catch(() => null);
  if (missing(usedQ)) return needsUpdate(cors);
  if (rows(usedQ).length >= GRID_NOW_PER_DAY || !(await rateAllow(`rank_grid_now:${site.id}`, GRID_NOW_PER_DAY, 86_400))) {
    return json({ error: 'too_many', message: `That’s ${GRID_NOW_PER_DAY} scans today for this client. The next can run tomorrow.` }, 429, cors);
  }
  const got = await scanAndKeep(site.id, s, phrase, 'now', principal.email || null);
  if (!got.ok) return json({ error: got.reason, message: SCAN_WORDS[got.reason] || 'The scan didn’t run. Try again in a few minutes.' }, got.reason === 'not_ready' ? 503 : got.reason === 'google_quota' ? 429 : 502, cors);
  return json({ data: scanView(got.row, true, Date.now(), null) }, 201, cors);
}
