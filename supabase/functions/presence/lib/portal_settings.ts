// ── Builder list items 229 and 233 (Nov 2026): what a studio's clients see in the portal ──
// Drawn in Figma first (page "Client portal — from the Agiled check", sections 229 and 233).
//
// Kept once per studio, on its own site, as reserved JSON (no migration):
//   { off: Part[],                                    the parts hidden from every client
//     clients: { [clientSiteId]: { [part]: boolean } }, one client's own choice for a part
//                                                       (true shown, false hidden), else the studio's
//     welcome: string,                                 a note at the top of every client's Home
//     home_off: Card[],                                Home's cards the studio hides
//     parts_at: iso | null,                            when a part was last switched (item 236's set-up list)
//     previewed_at: iso | null,                        when the studio first saw a client's portal (item 232)
//     signin: { google, password } }                   item 230: how clients sign in; the emailed code is always on
// Needs you is always on Home. A failed read hides nothing: the portal shows everything
// rather than going quiet by accident. These hide parts of a client's own portal; they
// are not a lock on anyone else's data (every /client/* route stays scoped to the caller).
import { readReservedJson, RESERVED_NAMES } from './reserved_store.ts';
import { linksForCustomer } from './service_bridge.ts';

export const PORTAL_PARTS = ['messages', 'book', 'services', 'invoices', 'proposals', 'agreements', 'files', 'reports', 'help'] as const;
export type PortalPart = typeof PORTAL_PARTS[number];
/** Each part's name and what it is, in the words Settings shows. */
export const PART_WORDS: Readonly<Record<PortalPart, readonly [string, string]>> = Object.freeze({
  messages: ['Messages', 'Writing to you and your replies'],
  book: ['Book a call', 'Picking a time to talk'],
  services: ['Ask for a service', 'Your services, with “Ask for this” (needs Messages)'],
  invoices: ['Invoices', 'Each invoice, with Pay and a receipt'],
  proposals: ['Proposals and estimates', 'To read and accept'],
  agreements: ['Agreements', 'To read and sign'],
  files: ['Files', 'Files on Documents, and “Send your studio a file”'],
  reports: ['Monthly reports', 'The PDF of each month’s report'],
  help: ['Help answers', 'Your answers and the hand-over kit'],
});
export const HOME_CARDS = ['website', 'updates', 'projects'] as const;
export type HomeCard = typeof HOME_CARDS[number];
export const CARD_WORDS: Readonly<Record<HomeCard, readonly [string, string]>> = Object.freeze({
  website: ['Your website', 'The picture of the site, where it stands, visits'],
  updates: ['From your studio', 'Your latest updates'],
  projects: ['Your projects', 'Each project and how far along it is'],
});
export const WELCOME_MAX = 500;
/** A studio's client list is capped well above any real one; past it, the oldest entries go. */
export const PORTAL_MAX_CLIENTS = 1000;

export type ClientChoices = Partial<Record<PortalPart, boolean>>;
/** Builder list item 230: the ways a client may sign in besides the emailed code, which is
 *  always on so nobody is locked out. Google is off until the studio turns it on; a password
 *  stays on, as it was before the switch existed. */
export interface SignIn { google: boolean; password: boolean }
/** Builder item 353 (Nov 22 review): what the studio says about replying, in its own words.
 *  "They usually reply within a day" was fixed text no studio set; now the studio picks a reply
 *  time and may add its working hours, and the portal says exactly that, or nothing at all. */
export interface ReplyWords { within: ReplyWithin; hours: string }
export const REPLY_WITHIN = ['', 'within a few hours', 'within one business day', 'within two business days', 'within a week'] as const;
export type ReplyWithin = typeof REPLY_WITHIN[number];
export const REPLY_HOURS_MAX = 60;
/** The reply words as kept: a known reply time (else none) and working hours as one short plain line. Pure. */
export function cleanReply(v: unknown): ReplyWords {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const w = String(r.within ?? '');
  const within = (REPLY_WITHIN as readonly string[]).includes(w) ? w as ReplyWithin : '';
  const hours = String(typeof r.hours === 'string' ? r.hours : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REPLY_HOURS_MAX);
  return { within, hours };
}
export const SIGNIN_KEYS = ['google', 'password'] as const;
export interface PortalSettings { off: PortalPart[]; clients: Record<string, ClientChoices>; welcome: string; home_off: HomeCard[]; parts_at: string | null; previewed_at: string | null; signin: SignIn; reply: ReplyWords; reminders_off: string[] }

const SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSiteId = (v: unknown): v is string => typeof v === 'string' && SITE_ID.test(v);
export const isPart = (v: unknown): v is PortalPart => typeof v === 'string' && (PORTAL_PARTS as readonly string[]).includes(v);
export const isCard = (v: unknown): v is HomeCard => typeof v === 'string' && (HOME_CARDS as readonly string[]).includes(v);

/** A list of parts, known ones only, each once, in the order Settings lists them. Pure. */
export function partsOf(v: unknown): PortalPart[] {
  const want = new Set(Array.isArray(v) ? v.filter(isPart) : []);
  return PORTAL_PARTS.filter((p) => want.has(p));
}
/** A list of Home's cards, known ones only, each once, in Home's order. Pure. */
export function cardsOf(v: unknown): HomeCard[] {
  const want = new Set(Array.isArray(v) ? v.filter(isCard) : []);
  return HOME_CARDS.filter((c) => want.has(c));
}
/** The welcome note as kept: plain text, no control characters, at most two blank lines in a
 *  row, trimmed, at most WELCOME_MAX characters. Pure. */
export function cleanWelcome(v: unknown): string {
  return String(typeof v === 'string' ? v : '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, WELCOME_MAX);
}
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
function choicesOf(v: unknown): ClientChoices {
  const out: ClientChoices = {};
  if (!v || typeof v !== 'object') return out;
  for (const p of PORTAL_PARTS) { const x = (v as Record<string, unknown>)[p]; if (typeof x === 'boolean') out[p] = x; }
  return out;
}

/** The stored setting, cleaned: anything unreadable is the default (everything shown, no
 *  note), real client site ids only, clients without a choice dropped. Pure. */
export function normalizePortal(raw: unknown): PortalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const clients: Record<string, ClientChoices> = {};
  const src = r.clients && typeof r.clients === 'object' ? r.clients as Record<string, unknown> : {};
  for (const [id, v] of Object.entries(src)) {
    if (!isSiteId(id)) continue;
    const c = choicesOf(v);
    if (Object.keys(c).length) clients[id.toLowerCase()] = c;
  }
  const keys = Object.keys(clients);
  if (keys.length > PORTAL_MAX_CLIENTS) for (const k of keys.slice(0, keys.length - PORTAL_MAX_CLIENTS)) delete clients[k];
  const si = (r.signin && typeof r.signin === 'object' ? r.signin : {}) as Record<string, unknown>;
  return { off: partsOf(r.off), clients, welcome: cleanWelcome(r.welcome), home_off: cardsOf(r.home_off), parts_at: isoOrNull(r.parts_at), previewed_at: isoOrNull(r.previewed_at),
    signin: { google: si.google === true, password: si.password !== false }, reply: cleanReply(r.reply),
    // builder item 336: the clients the studio asked us not to remind (their site ids)
    reminders_off: Array.from(new Set((Array.isArray(r.reminders_off) ? r.reminders_off : []).filter(isSiteId).map((id) => String(id).toLowerCase()))).slice(0, PORTAL_MAX_CLIENTS) };
}

/** Is this part shown to this client? The client's own choice first, else the studio's. Pure. */
export function partShown(s: PortalSettings, clientSiteId: string | null | undefined, part: PortalPart): boolean {
  const c = clientSiteId ? s.clients[String(clientSiteId).toLowerCase()] : undefined;
  if (c && typeof c[part] === 'boolean') return c[part] as boolean;
  return !s.off.includes(part);
}
/** Every part hidden from this client, in Settings' order. Ask for a service lives in
 *  Messages (a request becomes a conversation), so with Messages off it is off too. Pure. */
export function resolveOff(s: PortalSettings, clientSiteId: string | null | undefined): PortalPart[] {
  const off = new Set(PORTAL_PARTS.filter((p) => !partShown(s, clientSiteId, p)));
  if (off.has('messages')) off.add('services');
  return PORTAL_PARTS.filter((p) => off.has(p));
}

export interface StudioChange { part?: { key: PortalPart; shown: boolean }; card?: { key: HomeCard; shown: boolean }; welcome?: string; signin?: { key: typeof SIGNIN_KEYS[number]; on: boolean }; reply?: ReplyWords }
/** The studio-wide change Settings sends, one thing at a time so two quick flips (or two
 *  people) never undo each other: { part, shown }, { card, shown } or { welcome }. Pure. */
export function pickStudioChange(b: unknown): StudioChange {
  const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const out: StudioChange = {};
  if (isPart(r.part) && typeof r.shown === 'boolean') out.part = { key: r.part, shown: r.shown };
  if (isCard(r.card) && typeof r.shown === 'boolean') out.card = { key: r.card, shown: r.shown };
  if (typeof r.welcome === 'string') out.welcome = cleanWelcome(r.welcome);
  const si = (r.signin && typeof r.signin === 'object' ? r.signin : {}) as Record<string, unknown>;
  if ((SIGNIN_KEYS as readonly string[]).includes(String(si.key)) && typeof si.on === 'boolean') out.signin = { key: si.key as typeof SIGNIN_KEYS[number], on: si.on };
  if (r.reply && typeof r.reply === 'object') out.reply = cleanReply(r.reply);   // item 353
  return out;
}
/** The change applied to what's stored now (read just before the write). A part's switch
 *  stamps parts_at, which ticks "Choose what clients see" on the set-up list. Pure. */
export function applyStudioChange(cur: PortalSettings, change: StudioChange, nowIso = new Date().toISOString()): PortalSettings {
  const off = new Set(cur.off), homeOff = new Set(cur.home_off);
  if (change.part) { if (change.part.shown) off.delete(change.part.key); else off.add(change.part.key); }
  if (change.card) { if (change.card.shown) homeOff.delete(change.card.key); else homeOff.add(change.card.key); }
  const signin = change.signin ? { ...cur.signin, [change.signin.key]: change.signin.on } : cur.signin;
  return normalizePortal({ ...cur, off: [...off], home_off: [...homeOff], welcome: change.welcome === undefined ? cur.welcome : change.welcome, parts_at: change.part ? nowIso : cur.parts_at, signin, reply: change.reply || cur.reply });
}
/** One client's change: { part, shown: true | false | null } (null: back to the studio's
 *  choice for that part) or { reset: true } (every part back to the studio's). Pure. */
export function pickClientChange(b: unknown): { reset: true } | { part: PortalPart; shown: boolean | null } | { reminders: boolean } | null {
  const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  if (r.reset === true) return { reset: true };
  if (typeof r.reminders === 'boolean') return { reminders: r.reminders };   // item 336: remind this client, or not
  if (!isPart(r.part)) return null;
  if (r.shown === null || typeof r.shown === 'boolean') return { part: r.part, shown: r.shown as boolean | null };
  return null;
}
export function applyClientChange(cur: PortalSettings, clientSiteId: string, change: NonNullable<ReturnType<typeof pickClientChange>>, nowIso = new Date().toISOString()): PortalSettings {
  const id = clientSiteId.toLowerCase();
  const clients = { ...cur.clients };
  if ('reminders' in change) {   // item 336: the switch is its own thing; parts_at stays
    const off = new Set(cur.reminders_off);
    if (change.reminders) off.delete(id); else off.add(id);
    return normalizePortal({ ...cur, reminders_off: [...off] });
  }
  if ('reset' in change) delete clients[id];
  else {
    const c: ClientChoices = { ...(clients[id] || {}) };
    // a choice that matches the studio's is no choice: kept as "same as studio"
    if (change.shown === null || change.shown === !cur.off.includes(change.part)) delete c[change.part];
    else c[change.part] = change.shown;
    if (Object.keys(c).length) clients[id] = c; else delete clients[id];
  }
  return normalizePortal({ ...cur, clients, parts_at: nowIso });
}
/** The first time the studio saw a client's portal (item 232); kept, never moved. Pure. */
export function markPreviewed(cur: PortalSettings, nowIso = new Date().toISOString()): PortalSettings {
  return cur.previewed_at ? cur : normalizePortal({ ...cur, previewed_at: nowIso });
}

/** Which part a /client/* request belongs to, or null when it isn't one a studio can turn
 *  off. Proposals, estimates and agreements share one read and are filtered inside it.
 *  Files are left open here: a to-do's "Send your content and photos" uploads through the
 *  same route, and an approval of a file still needs its download. Pure. */
export function partForClientRoute(route: string, method: string): PortalPart | null {
  if (route === '/client/billing' || /^\/client\/retainers\//.test(route)) return 'invoices';
  if (route === '/client/reports' || /^\/client\/reports\/\d{4}-\d{2}\/pdf$/.test(route)) return 'reports';
  if (route === '/client/book') return 'book';
  if (route === '/client/services') return 'services';
  if (route === '/client/support' || /^\/client\/support\//.test(route) || /^\/client\/projects\/[^/]+\/messages$/.test(route)) return 'messages';
  if (route === '/client/faq' || route === '/client/kit' || /^\/client\/kit\//.test(route)) return 'help';   // the kit's own files too
  void method;
  return null;
}

// ── reads ──
/** A studio's portal settings (the default when there are none or the read fails). */
export async function readPortalSettings(studioSiteId: string): Promise<PortalSettings> {
  return normalizePortal(await readReservedJson(studioSiteId, RESERVED_NAMES.portalSettings));
}
const OFF_CACHE = new Map<string, { at: number; off: PortalPart[] }>();
const OFF_TTL_MS = 20_000;
/** The parts hidden from the client whose own site this is (none when it has no studio). A
 *  short memory per site keeps it to one read per client every 20 seconds. */
export async function portalOffFor(site: { id: string; client_id?: string | null }): Promise<PortalPart[]> {
  const hit = OFF_CACHE.get(site.id);
  if (hit && Date.now() - hit.at < OFF_TTL_MS) return hit.off;
  let off: PortalPart[] = [];
  try {
    const links = site.client_id ? await linksForCustomer(String(site.client_id)) : [];
    const studio = links[0]?.agency_site_id;
    if (studio) off = resolveOff(await readPortalSettings(String(studio)), site.id);
  } catch { off = []; }
  if (OFF_CACHE.size > 2000) OFF_CACHE.clear();
  OFF_CACHE.set(site.id, { at: Date.now(), off });
  return off;
}
/** Forget the memory (a studio just changed its settings, on this server). */
export function forgetPortalOff(): void { OFF_CACHE.clear(); }
