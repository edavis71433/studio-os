// ── The map rank grid (builder list item 185, Nov 2026) ──────────────────────────
// For a client and a search a customer would type ("plumber"): where does the business
// come up on Google Maps for someone searching from the streets around it? A size × size
// grid of spots, `spacing` miles apart, centred on the business. At each spot, one Places
// API (New) text search leaning on a small circle there, asking ONLY for place ids:
// Google's "Text Search Essentials (IDs Only)" level, which is free with no limit. The
// business's place in that list is its rank from that spot: 1 to 20, or not in the top 20.
//
// Google's rules (developers.google.com/maps/documentation/places/web-service/policies):
// place ids may be kept for good, a latitude and longitude for 30 days at most, names and
// addresses not at all. So a scan keeps place ids and ranks; the centre's coordinates stay
// until the monthly job clears them at 30 days; names are asked for fresh when the studio
// opens the card, and never stored.
//
// Prices (developers.google.com/maps/billing-and-pricing/pricing, read Nov 12 2026), per
// request in US dollars at the first tier, after each kind's free monthly allowance:
//   Text Search Essentials (IDs Only)   free, no limit          every spot
//   Place Details Essentials (IDs Only) free, no limit          checking a place id is real
//   Place Details Essentials            $0.005, 10,000 free     where the business is, once a scan
//   Place Details Pro                   $0.017, 5,000 free      a business's name
//   Text Search Pro                     $0.032, 5,000 free      finding the business by name, and
//                                                               where an address is (see below)
// A business that hides its address on Google (a "service-area business", like many trades
// and the studio's own listing) has no location in Places. Its grid centres on the address in
// its business details instead, looked up with Text Search: about 3.7 cents a scan.
// The studio sees what each scan cost at these prices; the client never sees a cost.
//
// Everything here is pure except the four Google calls at the bottom, whose fetch tests
// replace through `placesDeps`.

export const GRID_SIZES = [5, 7] as const;
export const GRID_SPACINGS = [0.5, 1, 2] as const;   // miles between spots
export const GRID_PHRASES_MAX = 3;
export const GRID_NOW_PER_DAY = 3;                     // "Scan now", per client per UTC day
export const GRID_NAME_ASKS_PER_DAY = 40;              // asks for names (six at most each), per client per day
export const GRID_FINDS_PER_DAY = 10;                  // "find the business" searches, per client per day
export const GRID_MAX_TRIES = 3;                       // a month's scan that fails is tried three times at most
export const GRID_DEPTH = 20;                          // Google's first page: a rank is 1 to 20
export const COORDS_KEEP_DAYS = 30;                    // Google: coordinates for 30 days at most
export const PRICES = {
  as_of: '2026-11-12',
  source: 'https://developers.google.com/maps/billing-and-pricing/pricing',
  ids_only: 0,              // Text Search Essentials (IDs Only), Place Details Essentials (IDs Only)
  location: 0.005,          // Place Details Essentials
  name: 0.017,              // Place Details Pro
  find: 0.032,              // Text Search Pro
  address: 0.032,           // Text Search Pro, the location of an address
} as const;

export type GridSize = typeof GRID_SIZES[number];
export type GridSpacing = typeof GRID_SPACINGS[number];
export type PlaceSource = 'listing' | 'pasted' | 'search';
export interface GridPlace { id: string; source: PlaceSource; confirmed_by: string | null; confirmed_at: string }
export interface GridResult { month: string; status: 'scanned' | 'failed'; reason: string | null; at: string }
export interface GridSetting {
  enabled: boolean;
  phrases: string[];
  size: GridSize;
  spacing: GridSpacing;
  place: GridPlace | null;
  month: string | null;                          // the month the monthly scan was handled for
  tries: { month: string; count: number } | null;
  last_result: GridResult | null;
  updated_by: string | null;
  updated_at: string | null;
}
/** One spot of a scan, as stored: its row and column (row 0 is the north edge), the
 *  business's rank there (null: not in the top 20) and the first three place ids there.
 *  `err` marks a spot Google didn't answer for. */
export interface GridPoint { r: number; c: number; rank: number | null; top: string[]; err?: true }

/** Google's place ids: letters, digits, - and _ (ChIJ…, or longer for some places). */
export const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,400}$/;
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);

/** The stored setting, made safe to read whatever the row holds. Pure. */
export function normalizeGridSetting(raw: unknown): GridSetting {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const phrases: string[] = [];
  for (const p of Array.isArray(o.phrases) ? o.phrases : []) {
    const t = clean(p, 60);
    if (t.length >= 2 && !phrases.some((x) => x.toLowerCase() === t.toLowerCase())) phrases.push(t);
    if (phrases.length >= GRID_PHRASES_MAX) break;
  }
  const pl = o.place && typeof o.place === 'object' && PLACE_ID_RE.test(String(o.place.id || '')) ? o.place : null;
  const tries = o.tries && isMonth(o.tries.month) && Number.isFinite(Number(o.tries.count)) ? { month: o.tries.month, count: Math.max(0, Math.trunc(Number(o.tries.count))) } : null;
  const lr = o.last_result && isMonth(o.last_result.month) && (o.last_result.status === 'scanned' || o.last_result.status === 'failed') ? o.last_result : null;
  return {
    enabled: o.enabled === true,
    phrases,
    size: (GRID_SIZES as readonly number[]).includes(Number(o.size)) ? Number(o.size) as GridSize : 7,
    spacing: (GRID_SPACINGS as readonly number[]).includes(Number(o.spacing)) ? Number(o.spacing) as GridSpacing : 1,
    place: pl ? { id: String(pl.id), source: (['listing', 'pasted', 'search'].includes(pl.source) ? pl.source : 'search') as PlaceSource, confirmed_by: pl.confirmed_by ? String(pl.confirmed_by).slice(0, 200) : null, confirmed_at: String(pl.confirmed_at || '') } : null,
    month: isMonth(o.month) ? o.month : null,
    tries,
    last_result: lr ? { month: lr.month, status: lr.status, reason: lr.reason ? String(lr.reason).slice(0, 80) : null, at: String(lr.at || '') } : null,
    updated_by: o.updated_by ? String(o.updated_by).slice(0, 200) : null,
    updated_at: o.updated_at ? String(o.updated_at) : null,
  };
}

/** A change from the settings sheet. Pure: the new setting, or the reason it is refused,
 *  in words. Switching on needs the business confirmed and one search at least; it makes
 *  this month's scan due at once. */
export function applyGridChange(cur: GridSetting, b: Record<string, unknown>, who: string | null, nowIso: string): GridSetting | { error: string } {
  const next: GridSetting = { ...cur, phrases: [...cur.phrases] };
  if (b.phrases !== undefined) {
    if (!Array.isArray(b.phrases)) return { error: 'Searches come as a list.' };
    const list: string[] = [];
    for (const p of b.phrases) {
      const t = clean(p, 80);
      if (!t) continue;
      if (t.length < 2) return { error: 'A search needs two letters at least.' };
      if (t.length > 60) return { error: 'Keep each search under 60 characters, the way a customer would type it.' };
      if (!list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t);
    }
    if (list.length > GRID_PHRASES_MAX) return { error: `Up to ${GRID_PHRASES_MAX} searches per client.` };
    next.phrases = list;
  }
  if (b.size !== undefined) {
    if (!(GRID_SIZES as readonly number[]).includes(Number(b.size))) return { error: 'The grid is 5 by 5 or 7 by 7.' };
    next.size = Number(b.size) as GridSize;
  }
  if (b.spacing !== undefined) {
    if (!(GRID_SPACINGS as readonly number[]).includes(Number(b.spacing))) return { error: 'Spots are half a mile, 1 mile or 2 miles apart.' };
    next.spacing = Number(b.spacing) as GridSpacing;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { error: 'Say whether the grid is on or off.' };
    if (b.enabled && !next.place) return { error: 'Confirm the business on Google first.' };
    if (b.enabled && !next.phrases.length) return { error: 'Add a search to scan first, like “plumber”.' };
    // switching on: this month's scan is due at once (an earlier month handled stays handled)
    if (b.enabled && !cur.enabled && next.month === nowIso.slice(0, 7)) { next.month = null; next.tries = null; }
    next.enabled = b.enabled;
  }
  if (next.enabled && !next.phrases.length) return { error: 'Keep one search at least while the grid is on, or switch it off.' };
  next.updated_by = who; next.updated_at = nowIso;
  return next;
}

/** Due for its monthly scan: on, with a business and a search, and this month not handled. */
export function gridDueNow(s: GridSetting, nowIso: string): boolean {
  return s.enabled && !!s.place && s.phrases.length > 0 && s.month !== nowIso.slice(0, 7);
}

/** After a monthly scan that failed: under the cap the month is let go, for a later tick;
 *  at the cap it is handled, as failed, and said why. Pure. */
export function afterGridFailure(s: GridSetting, month: string, before: string | null, reason: string, nowIso: string): GridSetting {
  const count = (s.tries && s.tries.month === month ? s.tries.count : 0) + 1;
  if (count >= GRID_MAX_TRIES) return { ...s, month, tries: { month, count }, last_result: { month, status: 'failed', reason, at: nowIso } };
  return { ...s, month: s.month === month ? before : s.month, tries: { month, count } };
}

// ── geometry ──
const M_PER_MILE = 1609.344;
const M_PER_DEG_LAT = 111_320;

/** The spots: row 0 is the north edge, column 0 the west edge; the middle spot is the
 *  business itself. Coordinates rounded to six places (about 10 cm). Pure. */
export function gridPoints(center: { lat: number; lng: number }, size: number, spacingMiles: number): Array<{ r: number; c: number; lat: number; lng: number }> {
  const mid = (size - 1) / 2, step = spacingMiles * M_PER_MILE;
  const perLng = M_PER_DEG_LAT * Math.cos(center.lat * Math.PI / 180);
  const out: Array<{ r: number; c: number; lat: number; lng: number }> = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const north = (mid - r) * step, east = (c - mid) * step;
    out.push({ r, c, lat: Math.round((center.lat + north / M_PER_DEG_LAT) * 1e6) / 1e6, lng: Math.round((center.lng + east / perLng) * 1e6) / 1e6 });
  }
  return out;
}

/** How far around each spot the search leans: half the gap between spots, so each spot
 *  leans on its own streets, 400 m to 2 km. In metres. Pure. */
export function biasRadius(spacingMiles: number): number {
  return Math.round(Math.min(2000, Math.max(400, spacingMiles * M_PER_MILE / 2)));
}

/** Where a spot sits from the business, in words: "2 miles south, 1 mile west". Pure. */
export function spotWords(r: number, c: number, size: number, spacingMiles: number): string {
  const mid = (size - 1) / 2;
  const miles = (n: number) => { const v = Math.abs(n) * spacingMiles; return `${v === 0.5 ? 'half a' : v % 1 ? v.toFixed(1) : String(v)} mile${v === 0.5 || v === 1 ? '' : 's'}`; };
  const parts: string[] = [];
  if (r !== mid) parts.push(`${miles(r - mid)} ${r < mid ? 'north' : 'south'}`);
  if (c !== mid) parts.push(`${miles(c - mid)} ${c < mid ? 'west' : 'east'}`);
  return parts.length ? parts.join(', ') : 'the business’s own spot';
}

// ── reading a scan ──
/** The business's place in one spot's list, 1-based; null when it isn't there. */
export function rankIn(ids: string[], placeId: string): number | null {
  const i = ids.indexOf(placeId);
  return i >= 0 && i < GRID_DEPTH ? i + 1 : null;
}
export type Band = 'top3' | 'top10' | 'top20' | 'out';
export function bandOf(rank: number | null): Band {
  return rank == null ? 'out' : rank <= 3 ? 'top3' : rank <= 10 ? 'top10' : 'top20';
}
/** The card's numbers. Spots Google didn't answer for count in none of them. Pure. */
export function summarize(points: GridPoint[]): { total: number; read: number; top3: number; top10: number; found: number; out: number; avg: number | null } {
  const read = points.filter((p) => !p.err);
  const ranks = read.map((p) => p.rank).filter((r): r is number => r != null);
  return {
    total: points.length, read: read.length,
    top3: ranks.filter((r) => r <= 3).length,
    top10: ranks.filter((r) => r <= 10).length,
    found: ranks.length,
    out: read.length - ranks.length,
    avg: ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length * 10) / 10 : null,
  };
}
/** Who comes up ahead most often: the businesses first at the most spots, then in the
 *  top 3 at the most. Place ids only (names are asked for when shown). Pure. */
export function rivalsOf(points: GridPoint[], placeId: string, k = 3): Array<{ id: string; first: number; top3: number }> {
  const tally = new Map<string, { id: string; first: number; top3: number }>();
  for (const p of points) {
    if (p.err) continue;
    p.top.slice(0, 3).forEach((id, i) => {
      if (!id || id === placeId) return;
      const t = tally.get(id) || { id, first: 0, top3: 0 };
      t.top3++; if (i === 0) t.first++;
      tally.set(id, t);
    });
  }
  return [...tally.values()].sort((a, b) => b.first - a.first || b.top3 - a.top3 || a.id.localeCompare(b.id)).slice(0, k);
}

/** What a scan cost at Google's prices, in dollars to four places. Pure. */
export function scanCost(n: { ids_only?: number; location?: number; address?: number; names?: number; finds?: number }): number {
  const usd = (n.ids_only || 0) * PRICES.ids_only + (n.location || 0) * PRICES.location + (n.address || 0) * PRICES.address + (n.names || 0) * PRICES.name + (n.finds || 0) * PRICES.find;
  return Math.round(usd * 10000) / 10000;
}
/** A cost in words for the studio: "Free", "half a cent", "2 cents", "$1.20". Pure. */
export function costWords(usd: number): string {
  if (!(usd > 0)) return 'Free';
  const cents = usd * 100;
  if (cents < 0.75) return 'half a cent';
  if (cents < 1.25) return '1 cent';
  if (cents < 100) { const r = Math.round(cents * 2) / 2; return `${r % 1 ? Math.floor(r) + '½' : r} cents`; }
  return `$${usd.toFixed(2)}`;
}

/** Google's own place id from a listing's "write a review" link (Business Profile hands
 *  one back as metadata.newReviewUri: …/writereview?placeid=ChIJ…). Pure. */
export function placeIdFromReviewUri(uri: unknown): string | null {
  try {
    const u = new URL(String(uri || ''));
    const id = (u.searchParams.get('placeid') || u.searchParams.get('place_id') || '').trim();
    return PLACE_ID_RE.test(id) ? id : null;
  } catch { return null; }
}
/** Links that cost nothing: a place on Google Maps, and a search from a spot. */
export const mapsPlaceUrl = (placeId: string) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
export const mapsSpotUrl = (phrase: string, lat: number, lng: number) => `https://www.google.com/maps/search/${encodeURIComponent(phrase)}/@${lat},${lng},14z`;

/** The first of next month, as the card says it ("Dec 1"). Pure. */
export function nextScanDay(nowIso: string): string {
  const d = new Date(nowIso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── the four Google calls (Places API (New)); tests replace fetch here ──
export const placesDeps: { fetch?: (url: string, init: RequestInit) => Promise<Response> } = {};
const gfetch = (url: string, init: RequestInit) => (placesDeps.fetch || fetch)(url, init);
const PLACES = 'https://places.googleapis.com/v1';
export type PlacesFail = { ok: false; reason: 'google_refused' | 'google_unreachable' | 'google_quota' | 'not_found' | 'no_location' };
/** Google's 429: the platform's daily (or per-minute) allowance of this kind of search is
 *  used up. Found Nov 12 2026: the project's "SearchTextRequest per day" cap. Not the
 *  client's fault, and asking again only adds to the pile, so it is told apart. */
const refusal = (status: number): PlacesFail => ({ ok: false, reason: status === 429 ? 'google_quota' : 'google_refused' });

/** One spot: the place ids Google lists first for `phrase` leaning on a circle around
 *  the spot. Field mask places.id only, so Google bills it as IDs Only: free. Businesses
 *  that hide their address are asked for too (includePureServiceAreaBusinesses): Text
 *  Search leaves them out otherwise, and Google Maps doesn't. Found Nov 12 2026 on the
 *  studio's own listing, which a search for its own name never returned without it. */
export async function searchIdsAt(key: string, phrase: string, at: { lat: number; lng: number }, radius: number): Promise<{ ok: true; ids: string[] } | PlacesFail> {
  try {
    const r = await gfetch(`${PLACES}/places:searchText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id' },
      body: JSON.stringify({ textQuery: phrase, pageSize: GRID_DEPTH, includePureServiceAreaBusinesses: true, locationBias: { circle: { center: { latitude: at.lat, longitude: at.lng }, radius } } }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return refusal(r.status);
    const ids = (Array.isArray(d.places) ? d.places : []).map((p: any) => String(p?.id || '')).filter((id: string) => PLACE_ID_RE.test(id));
    return { ok: true, ids: ids.slice(0, GRID_DEPTH) };
  } catch { return { ok: false, reason: 'google_unreachable' }; }
}

/** Where the business is: Place Details with the location field (Essentials). Asked
 *  fresh at each scan, as Google keeps coordinates to 30 days. */
export async function placeLocation(key: string, placeId: string): Promise<{ ok: true; lat: number; lng: number } | PlacesFail> {
  try {
    const r = await gfetch(`${PLACES}/places/${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location' }, signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404 || r.status === 400) return { ok: false, reason: 'not_found' };
    if (!r.ok) return refusal(r.status);
    if (!d?.location) return { ok: false, reason: 'no_location' };   // a business that hides its address
    const lat = Number(d.location.latitude), lng = Number(d.location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: 'no_location' };
    return { ok: true, lat, lng };
  } catch { return { ok: false, reason: 'google_unreachable' }; }
}

/** Where an address is: Text Search with the location field only (Pro). For a business
 *  that hides its address on Google, the grid centres on the address in its business
 *  details. Asked fresh at each scan, like the business's own location. */
export async function addressLocation(key: string, address: string): Promise<{ ok: true; lat: number; lng: number } | PlacesFail> {
  try {
    const r = await gfetch(`${PLACES}/places:searchText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.location' },
      body: JSON.stringify({ textQuery: address, pageSize: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return refusal(r.status);
    const loc = Array.isArray(d.places) ? d.places[0]?.location : null;
    const lat = Number(loc?.latitude), lng = Number(loc?.longitude);
    if (!loc || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: 'not_found' };
    return { ok: true, lat, lng };
  } catch { return { ok: false, reason: 'google_unreachable' }; }
}

/** Is this a real place id? Place Details with the id field only (IDs Only): free. A
 *  place that moved answers with its new id. */
export async function checkPlaceId(key: string, placeId: string): Promise<{ ok: true; id: string } | PlacesFail> {
  try {
    const r = await gfetch(`${PLACES}/places/${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,movedPlaceId' }, signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404 || r.status === 400) return { ok: false, reason: 'not_found' };
    if (!r.ok) return refusal(r.status);
    const id = String(d?.movedPlaceId || d?.id || '');
    return PLACE_ID_RE.test(id) ? { ok: true, id } : { ok: false, reason: 'not_found' };
  } catch { return { ok: false, reason: 'google_unreachable' }; }
}

/** Names (and a short address), asked for as they are shown and never kept: Place
 *  Details Pro, one call a place, in parallel. A place Google won't name comes back
 *  without one. */
export async function placeNames(key: string, ids: string[]): Promise<Array<{ id: string; name: string | null; address: string | null; maps: string }>> {
  return Promise.all(ids.map(async (id) => {
    try {
      const r = await gfetch(`${PLACES}/places/${encodeURIComponent(id)}`, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName,shortFormattedAddress,googleMapsUri' }, signal: AbortSignal.timeout(8000) });
      const d = r.ok ? await r.json().catch(() => ({})) : {};
      const name = clean(d?.displayName?.text, 160) || null;
      const maps = String(d?.googleMapsUri || '').startsWith('https://') ? String(d.googleMapsUri).slice(0, 500) : mapsPlaceUrl(id);
      return { id, name, address: clean(d?.shortFormattedAddress, 200) || null, maps };
    } catch { return { id, name: null, address: null, maps: mapsPlaceUrl(id) }; }
  }));
}

/** Finding the business by name and address: Text Search Pro, five at most, shown to
 *  the studio to pick from and never kept. */
export async function findPlaces(key: string, query: string): Promise<{ ok: true; found: Array<{ id: string; name: string; address: string; kind: string; maps: string }> } | PlacesFail> {
  try {
    const r = await gfetch(`${PLACES}/places:searchText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.googleMapsUri' },
      body: JSON.stringify({ textQuery: query, pageSize: 5, includePureServiceAreaBusinesses: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return refusal(r.status);
    const found = (Array.isArray(d.places) ? d.places : []).map((p: any) => ({
      id: String(p?.id || ''), name: clean(p?.displayName?.text, 160), address: clean(p?.formattedAddress, 240),
      kind: clean(p?.primaryTypeDisplayName?.text, 80),
      maps: String(p?.googleMapsUri || '').startsWith('https://') ? String(p.googleMapsUri).slice(0, 500) : mapsPlaceUrl(String(p?.id || '')),
    })).filter((p: { id: string; name: string }) => PLACE_ID_RE.test(p.id) && p.name).slice(0, 5);
    return { ok: true, found };
  } catch { return { ok: false, reason: 'google_unreachable' }; }
}

/** One scan: where the business is (or, when Google hides its address, where the address
 *  in its business details is), then every spot, seven at a time, inside a time budget.
 *  Spots Google didn't answer for are marked; when more than a quarter are, the scan
 *  fails rather than show a grid with holes. */
export async function scanGrid(key: string, s: Pick<GridSetting, 'size' | 'spacing'> & { placeId: string }, phrase: string, opts: { address?: string; budgetMs?: number } = {}): Promise<{ ok: true; center: { lat: number; lng: number }; from: 'place' | 'address'; points: GridPoint[]; requests: { ids_only: number; location: number; address: number; from: 'place' | 'address' } } | PlacesFail | { ok: false; reason: 'too_many_gaps' | 'no_center' }> {
  const started = Date.now(), budgetMs = opts.budgetMs ?? 40_000;
  let loc = await placeLocation(key, s.placeId);
  let from: 'place' | 'address' = 'place', addressAsked = 0;
  if (!loc.ok && loc.reason === 'no_location') {
    const address = String(opts.address || '').trim();
    if (!address) return { ok: false, reason: 'no_center' };
    loc = await addressLocation(key, address); addressAsked = 1; from = 'address';
    if (!loc.ok) return loc.reason === 'not_found' ? { ok: false, reason: 'no_center' } : loc;
  } else if (!loc.ok) return loc;
  const center = { lat: loc.lat, lng: loc.lng };
  const spots = gridPoints(center, s.size, s.spacing);
  const radius = biasRadius(s.spacing);
  const points: GridPoint[] = new Array(spots.length);
  let asked = 0;
  for (let i = 0; i < spots.length; i += 7) {
    const batch = spots.slice(i, i + 7);
    const late = Date.now() - started > budgetMs;
    const got = late ? batch.map(() => null) : await Promise.all(batch.map((p) => searchIdsAt(key, phrase, p, radius)));
    if (!late) asked += batch.length;
    // Google's allowance is used up: stop asking (each further ask only adds to the pile)
    if (got.some((g) => g && !g.ok && g.reason === 'google_quota')) return { ok: false, reason: 'google_quota' };
    got.forEach((g, j) => {
      const p = batch[j];
      points[i + j] = g && g.ok ? { r: p.r, c: p.c, rank: rankIn(g.ids, s.placeId), top: g.ids.slice(0, 3) } : { r: p.r, c: p.c, rank: null, top: [], err: true };
    });
  }
  const gaps = points.filter((p) => p.err).length;
  if (gaps * 4 > points.length) return { ok: false, reason: 'too_many_gaps' };
  return { ok: true, center, from, points, requests: { ids_only: asked, location: 1, address: addressAsked, from } };
}
