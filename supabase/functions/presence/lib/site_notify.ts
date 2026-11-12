// ── Builder list item 126: one notifications switch for each client site ─────
// Like Wix's "Enable notifications for this site", then a Dashboard channel and an
// Email channel. The studio chooses, per client site, whether it hears about that
// site at all, and how:
//   dashboard  the site's news in the bell (published, a busy day, a new review or
//              booking, its domain renewing) and its visitors' new enquiries on Home
//              and in the bell;
//   email      the studio's own copies of the site's emails (domain reminders, a
//              domain changed or its email records gone, "your website is live").
// Never silenced, whatever the switch says: on Home and in the bell, money owed,
// something broken (a failed publish, a domain about to lapse) and a client's own
// message or support request; and every email that goes to the client themself.
//
// Kept once per studio, on its own site, as reserved JSON (no migration):
//   { sites: { [siteId]: { on, dashboard, email } } }
// A site with no entry hears everything, and only sites that hear less are stored.
// A failed read hears everything too: a switch must never go quiet by accident.
import { readReservedJson, RESERVED_NAMES } from './reserved_store.ts';

export interface NotifyPref { on: boolean; dashboard: boolean; email: boolean }
export interface NotifyStore { sites: Record<string, NotifyPref> }
export type NotifyChannel = 'dashboard' | 'email';

export const NOTIFY_ALL: Readonly<NotifyPref> = Object.freeze({ on: true, dashboard: true, email: true });
/** A studio's client list is capped well above any real one; past it, the oldest entries go. */
export const NOTIFY_MAX_SITES = 1000;
const SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSiteId = (v: unknown): v is string => typeof v === 'string' && SITE_ID.test(v);

const flag = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
/** One site's choice, with anything missing or malformed read as "on". */
export function normalizePref(raw: unknown): NotifyPref {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { on: flag(r.on, true), dashboard: flag(r.dashboard, true), email: flag(r.email, true) };
}
const allOn = (p: NotifyPref) => p.on && p.dashboard && p.email;

/** The stored setting, cleaned: real site ids only, all-on entries dropped (that is the
 *  default), at most NOTIFY_MAX_SITES kept. Anything unreadable is an empty setting. */
export function normalizeNotify(raw: unknown): NotifyStore {
  const src = raw && typeof raw === 'object' && (raw as { sites?: unknown }).sites && typeof (raw as { sites?: unknown }).sites === 'object'
    ? (raw as { sites: Record<string, unknown> }).sites : {};
  const sites: Record<string, NotifyPref> = {};
  for (const [id, v] of Object.entries(src)) {
    if (!isSiteId(id)) continue;
    const p = normalizePref(v);
    if (!allOn(p)) sites[id.toLowerCase()] = p;
  }
  const keys = Object.keys(sites);
  if (keys.length > NOTIFY_MAX_SITES) for (const k of keys.slice(0, keys.length - NOTIFY_MAX_SITES)) delete sites[k];
  return { sites };
}

/** What the studio hears about one site (everything, unless it said otherwise). */
export function prefFor(store: NotifyStore | null | undefined, siteId: string | null | undefined): NotifyPref {
  const p = siteId && store && store.sites ? store.sites[String(siteId).toLowerCase()] : undefined;
  return p ? { ...p } : { ...NOTIFY_ALL };
}

/** Does the studio hear about this site on this channel? The site's own switch first. */
export function hears(store: NotifyStore | null | undefined, siteId: string | null | undefined, channel: NotifyChannel): boolean {
  const p = prefFor(store, siteId);
  return p.on && p[channel];
}

/** The sites whose news and visitor enquiries stay off Home and the bell. */
export function quietSites(store: NotifyStore | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys((store && store.sites) || {})) if (!hears(store, id, 'dashboard')) out.add(id);
  return out;
}

/** Apply one site's change (any of on, dashboard, email) and return the new setting. */
export function applyNotifyChange(store: NotifyStore | null | undefined, siteId: string, change: Partial<NotifyPref>): NotifyStore {
  const cur = normalizeNotify(store);
  const id = String(siteId).toLowerCase();
  const next = normalizePref({ ...prefFor(cur, id), ...pickFlags(change) });
  const sites = { ...cur.sites };
  if (allOn(next)) delete sites[id]; else sites[id] = next;
  return normalizeNotify({ sites });
}
/** Only the three booleans of a request body; anything else is left out. */
export function pickFlags(body: unknown): Partial<NotifyPref> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: Partial<NotifyPref> = {};
  for (const k of ['on', 'dashboard', 'email'] as const) if (typeof b[k] === 'boolean') out[k] = b[k] as boolean;
  return out;
}

/** The studio's setting, read from its own site. A failed read hears everything. */
export async function readNotify(studioSiteId: string | null | undefined): Promise<NotifyStore> {
  if (!studioSiteId) return { sites: {} };
  try { return normalizeNotify(await readReservedJson(String(studioSiteId), RESERVED_NAMES.siteNotify)); }
  catch { return { sites: {} }; }
}

/** Should the studio get its copy of an email about this client site? */
export async function studioWantsEmail(studioSiteId: string | null | undefined, siteId: string | null | undefined): Promise<boolean> {
  if (!studioSiteId || !siteId) return true;
  return hears(await readNotify(studioSiteId), siteId, 'email');
}

// ── Repeats fold into one line, and a line names the site, the number and one link ──
// "3 new bookings on Bacchus Kitchen · Open bookings", "Traffic spike on Kismet: 78 page
// views · View analytics". Squarespace's bell names the site, the number and one link;
// Wix folds repeats ("Show 11 more updates like this").
export interface NewsItem { id?: string | null; site_id: string; name: string; kind: string; headline: string; body: string; at: string | null; href: string; tier?: string }
export interface NewsLine extends NewsItem { count: number; title: string; sub: string; link: string }

const LINK_WORDS: Record<string, string> = {
  site_published: 'See the website', traffic_spike: 'View analytics', domain_expiry: 'Open the domain',
  new_review: 'Read the review', new_booking: 'Open bookings',
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The busy day's number, from the spike notice's own headline ("A busy day: 78 page views yesterday"). */
export function spikeViews(headline: string): number | null {
  const m = /(\d[\d,]*)\s+page views?/i.exec(String(headline || ''));
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** One line's words, from its kind, the site's name and how many it folds. */
export function newsWords(kind: string, name: string, count: number, newest: { headline: string; body: string }): { title: string; sub: string; link: string } {
  const link = (kind === 'new_review' && count > 1) ? 'Read the reviews' : (LINK_WORDS[kind] || 'Open');
  const head = String(newest.headline || '').trim();
  if (kind === 'traffic_spike') {
    const v = spikeViews(head);
    return count > 1
      ? { title: `${count} busy days on ${name}`, sub: v !== null ? `The latest: ${v.toLocaleString('en-US')} page views` : head, link }
      : { title: `Traffic spike on ${name}${v !== null ? `: ${v.toLocaleString('en-US')} page views` : ''}`, sub: String(newest.body || ''), link };
  }
  if (kind === 'new_booking') {
    const what = head.replace(/^New booking:\s*/i, '');
    return count > 1 ? { title: `${plural(count, 'new booking', 'new bookings')} on ${name}`, sub: `The latest: ${what}`, link }
      : { title: `New booking on ${name}`, sub: what, link };
  }
  if (kind === 'new_review') {
    return count > 1 ? { title: `${plural(count, 'new review', 'new reviews')} on ${name}`, sub: head, link }
      : { title: `New review on ${name}`, sub: head, link };
  }
  if (kind === 'site_published') {
    return count > 1 ? { title: `${name} was published ${count} times`, sub: `The latest: ${head || 'Published'}`, link }
      : { title: `${head || 'Published'} on ${name}`, sub: String(newest.body || ''), link };
  }
  // domain_expiry and anything newer: the notice already says what, so the line adds whose
  return { title: `${name}: ${head}`, sub: count > 1 ? `${count} reminders` : String(newest.body || ''), link };
}

/** Fold news by site and kind: one line per pair, newest first, carrying the newest
 *  notice's link and time and how many it stands for. */
export function foldNews(items: NewsItem[]): NewsLine[] {
  const groups = new Map<string, NewsItem[]>();
  for (const n of items) {
    const k = `${n.site_id}|${n.kind}`;
    const g = groups.get(k) || []; g.push(n); groups.set(k, g);
  }
  const out: NewsLine[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const newest = g[0];
    out.push({ ...newest, count: g.length, ...newsWords(newest.kind, newest.name, g.length, newest) });
  }
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
