// ── Changes: who changed what, and when (builder list item 215, Nov 2026) ──────
//   GET /change-log                    one site's changes, newest first, in sentences, with
//                                      this month's numbers by who made them (inside a client,
//                                      or an owner's own site)
//   GET /change-log/went-live?id=       what one publish put live: its kept version against
//                                      the one live before it, in the publish sheet's words
//   GET /agency/change-log             every client's changes for the studio, with the
//                                      week's numbers (handled from agency/routes.ts)
//   GET /agency/change-log/went-live?site=&id=   the same "what went live", for a client's publish
// All take ?before= (an ISO time: older than) for the next page, ?area= (website, photos,
// live, people, settings), ?who= (studio, client, auto) and ?tz= (the viewer's clock); the
// numbers ignore the filters. Read only. The sentences come from lib/change_log.ts, from
// what is already kept. Who may see what: a reviewer never reaches this (index.ts
// reviewerAllowed), and the People lines (who was invited, who lost access) need a role
// that may manage people.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { siteCan, isSiteRole } from '../lib/site_roles.ts';
import { vocabFor } from '../lib/industry_vocab.ts';
import { signInEmail } from '../lib/service_bridge.ts';
import { describeChanges } from '../lib/diff.ts';
import { normalizeSnapshotContent } from '../lib/render_types.ts';
import { changeItems, changeSummary, sideOf, CHANGE_AREAS, nameFromEmail, type ChangeArea, type ChangeItem, type Person, type RawChange, type Vocab } from '../lib/change_log.ts';
import { can, agencySiteIds, type AgencyMember } from '../agency/auth.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from '../lib/site.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rowsOf = <T = any>(q: unknown): T[] | null => (q && (q as { ok?: boolean }).ok && Array.isArray((q as { json?: unknown }).json)) ? (q as { json: T[] }).json : null;
const soft = () => ({ ok: false, status: 0, json: null as unknown, text: '' });
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** How many records a page reads from each source, and how many it shows at most. */
export const PAGE_EVENTS = 200, PAGE_OTHER = 100, PAGE_RAW = 160;
/** The band's window: a site's month so far, the studio's last seven days. */
export const SUMMARY_EVENTS = 1000;

/** ?before= as an ISO time; now when missing or wrong. Pure. */
export function beforeOf(v: string | null, nowIso: string): string {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : nowIso;
}

/** The kept records for some sites in a window [since, before), each source newest first,
 *  and the floor no page may pass: the oldest record of any source that filled its read. */
async function readRaw(siteIds: string[], before: string, since: string | null, limits: { events: number; other: number }): Promise<{ rows: RawChange[]; floor: string | null }> {
  const IN = `in.(${siteIds.join(',')})`;
  const win = (col: string) => `${col}=lt.${encodeURIComponent(before)}${since ? `&${col}=gte.${encodeURIComponent(since)}` : ''}`;
  const pubCols = 'id,site_id,kind,status,actor,actor_kind,change_summary,version_label,created_at';
  const [evQ, pubQ0, memQ, cpQ] = await Promise.all([
    svc(`presence_change_events?site_id=${IN}&${win('created_at')}&select=id,site_id,entity_type,entity_id,action,summary,actor_user_id,actor_kind,detail,created_at&order=created_at.desc&limit=${limits.events}`).catch(soft),
    svc(`presence_publishes?site_id=${IN}&${win('created_at')}&select=${pubCols},unchanged&order=created_at.desc&limit=${limits.other}`).catch(soft),
    svc(`presence_site_members?site_id=${IN}&select=id,site_id,email,role,status,invited_by,created_at,updated_at&limit=500`).catch(soft),
    svc(`presence_launches?site_id=${IN}&status=eq.checkpoint&${win('created_at')}&select=id,site_id,name,created_by,created_at&order=created_at.desc&limit=${limits.other}`).catch(soft),
  ]);
  // before migration 0205 a publish has no `unchanged`: every one counted, as it did
  const pubQ = rowsOf(pubQ0) ? pubQ0 : await svc(`presence_publishes?site_id=${IN}&${win('created_at')}&select=${pubCols}&order=created_at.desc&limit=${limits.other}`).catch(soft);
  const events = rowsOf<any>(evQ) || [], pubs = rowsOf<any>(pubQ) || [], members = rowsOf<any>(memQ) || [], cps = rowsOf<any>(cpQ) || [];
  const inWin = (at: string) => at < before && (!since || at >= since);
  const rows: RawChange[] = [
    ...events.map((e) => ({ id: String(e.id), at: String(e.created_at), site_id: String(e.site_id), source: 'event' as const, actor: e.actor_user_id || null, actor_kind: e.actor_kind || null, entity_type: e.entity_type, action: e.action, summary: e.summary || '', fields: Array.isArray(e.detail?.fields) ? e.detail.fields.map(String) : [], entity_id: e.entity_id || null })),
    ...pubs.map((p) => ({ id: String(p.id), at: String(p.created_at), site_id: String(p.site_id), source: 'publish' as const, actor: p.actor || null, actor_kind: p.actor_kind || null, kind: p.kind, status: p.status, summary: p.change_summary || '', label: p.version_label || '', unchanged: p.unchanged === true })),
    ...members.flatMap((m) => {
      const out: RawChange[] = [];
      const at = String(m.created_at || ''), off = String(m.updated_at || '');
      if (at && inWin(at)) out.push({ id: `${m.id}:in`, at, site_id: String(m.site_id), source: 'member', actor: m.invited_by || null, email: m.email, role: m.role, state: 'invited' });
      if (m.status === 'revoked' && off && inWin(off)) out.push({ id: `${m.id}:off`, at: off, site_id: String(m.site_id), source: 'member', actor: null, email: m.email, role: m.role, state: 'removed' });
      return out;
    }),
    ...cps.map((c) => ({ id: String(c.id), at: String(c.created_at), site_id: String(c.site_id), source: 'checkpoint' as const, actor: c.created_by || null, name: c.name || '' })),
  ];
  rows.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  // a source that filled its read may have more, older: the page can't go past its oldest
  const oldest = (list: any[], n: number) => (list.length >= n ? String(list[list.length - 1].created_at) : null);
  const floors = [oldest(events, limits.events), oldest(pubs, limits.other), oldest(cps, limits.other)].filter((x): x is string => !!x);
  return { rows, floor: floors.length ? floors.sort().slice(-1)[0] : null };
}

/** One page of a read: the newest records down to the floor of any source that filled its
 *  read, PAGE_RAW at most, and where the next page starts (null: nothing older). Pure. */
export function pageOf(r: { rows: RawChange[]; floor: string | null }): { rows: RawChange[]; next: string | null } {
  const kept = r.floor ? r.rows.filter((x) => x.at >= r.floor!) : r.rows;
  if (kept.length <= PAGE_RAW) return { rows: kept, next: r.floor };
  const rows = kept.slice(0, PAGE_RAW);
  return { rows, next: rows[rows.length - 1].at };
}

/** The people a page names: the studio's team, each site's seats and owner, and anyone
 *  else from their sign-in (Studio OS support), ten lookups at most. */
async function peopleFor(siteIds: string[], rows: RawChange[], agencyIds: string[], maskClient: boolean): Promise<{ people: Map<string, Person>; ownerOf: Map<string, Person> }> {
  const IN = `in.(${siteIds.join(',')})`;
  const [studioQ, seatQ, siteQ] = await Promise.all([
    agencyIds.length ? svc(`presence_agency_members?agency_id=in.(${agencyIds.join(',')})&select=email,user_id,role&limit=500`).catch(soft) : Promise.resolve(null),
    svc(`presence_site_members?site_id=${IN}&select=site_id,email,user_id,role&limit=500`).catch(soft),
    svc(`presence_sites?id=${IN}&select=id,client_id&limit=1000`).catch(soft),
  ]);
  const people = new Map<string, Person>(), ownerOf = new Map<string, Person>();
  const put = (keys: unknown[], p: Person) => { for (const k of keys) { const kk = lower(k); if (kk && !people.has(kk)) people.set(kk, p); } };
  const hide = (p: Person): Person => (maskClient ? { ...p, name: 'Someone on their side', email: '' } : p);
  for (const s of rowsOf<any>(studioQ) || []) put([s.user_id, s.email], { name: nameFromEmail(s.email), email: lower(s.email), side: 'studio', role: s.role });
  for (const s of rowsOf<any>(seatQ) || []) put([s.user_id, s.email], hide({ name: nameFromEmail(s.email), email: lower(s.email), side: 'seat', role: s.role }));
  // each site's owner: the client record's contact (lib/site_transfer.ts ownerWho's rule:
  // the contact's name unless it is only the business's)
  const sites = rowsOf<{ id: string; client_id: string | null }>(siteQ) || [];
  const cids = [...new Set(sites.map((s) => String(s.client_id || '')).filter((x) => UUID.test(x)))];
  const clients = cids.length ? rowsOf<any>(await svc(`clients?id=in.(${cids.join(',')})&select=id,name,email,contact_email,contact_id&limit=1000`).catch(soft)) || [] : [];
  const contactIds = [...new Set(clients.map((c) => String(c.contact_id || '')).filter((x) => UUID.test(x)))];
  const contacts = contactIds.length ? rowsOf<any>(await svc(`contacts?id=in.(${contactIds.join(',')})&select=id,name,email,auth_user_id&limit=1000`).catch(soft)) || [] : [];
  const contactBy = new Map(contacts.map((c) => [String(c.id), c]));
  const clientBy = new Map(clients.map((c) => [String(c.id), c]));
  for (const s of sites) {
    const c = clientBy.get(String(s.client_id || '')); if (!c) continue;
    const ct = c.contact_id ? contactBy.get(String(c.contact_id)) : null;
    const email = lower(c.email) || lower(c.contact_email) || lower(ct?.email);
    const own = String(ct?.name || '').trim();
    const name = own && lower(own) !== lower(c.name) ? own : nameFromEmail(email);
    const p = hide({ name, email, side: 'owner' });
    ownerOf.set(String(s.id), p);
    put([ct?.auth_user_id, email], p);
  }
  // anyone else who signed in (platform staff, a former member): their sign-in's email
  const unknown = [...new Set(rows.map((r) => lower(r.actor)).filter((a) => UUID.test(a) && !people.has(a)))].slice(0, 10);
  const found = await Promise.all(unknown.map(async (uid) => [uid, await signInEmail(uid).catch(() => '')] as const));
  for (const [uid, email] of found) if (email) people.set(uid, { name: nameFromEmail(email), email: lower(email), side: 'support' });
  return { people, ownerOf };
}

/** Current names for the items a page mentions by id: services, questions, blog posts. */
async function namesFor(rows: RawChange[]): Promise<Map<string, string>> {
  const ids = (t: string) => [...new Set(rows.filter((r) => r.source === 'event' && r.entity_type === t && UUID.test(String(r.entity_id || ''))).map((r) => String(r.entity_id)))].slice(0, 100);
  const [o, f, p] = [ids('offering'), ids('faq'), ids('post')];
  const [oq, fq, pq] = await Promise.all([
    o.length ? svc(`presence_offerings?id=in.(${o.join(',')})&select=id,name`).catch(soft) : Promise.resolve(null),
    f.length ? svc(`presence_faqs?id=in.(${f.join(',')})&select=id,question`).catch(soft) : Promise.resolve(null),
    p.length ? svc(`presence_posts?id=in.(${p.join(',')})&select=id,title`).catch(soft) : Promise.resolve(null),
  ]);
  const out = new Map<string, string>();
  const clip = (s: unknown) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > 60 ? t.slice(0, 59) + '…' : t; };
  for (const r of rowsOf<any>(oq) || []) if (r.name) out.set(String(r.id), clip(r.name));
  for (const r of rowsOf<any>(fq) || []) if (r.question) out.set(String(r.id), clip(r.question));
  for (const r of rowsOf<any>(pq) || []) if (r.title) out.set(String(r.id), clip(r.title));
  return out;
}

/** Each site's words for its items ("menu item", "service") and its name. */
async function sitesFacts(siteIds: string[]): Promise<{ vocab: Map<string, Vocab>; name: Map<string, string> }> {
  const IN = `in.(${siteIds.join(',')})`;
  const [setQ, idQ] = await Promise.all([
    svc(`presence_settings?site_id=${IN}&select=site_id,industry_key&limit=1000`).catch(soft),
    svc(`presence_identity?site_id=${IN}&select=site_id,business_name&limit=1000`).catch(soft),
  ]);
  const vocab = new Map<string, Vocab>(), name = new Map<string, string>();
  for (const s of rowsOf<any>(setQ) || []) {
    const v = vocabFor(String(s.industry_key || 'generic'));
    vocab.set(String(s.site_id), v.isMenu ? { item: 'menu item', items: 'menu items', offeringsLabel: v.offeringLabel } : { item: String(v.offeringLabelSingular || 'Service').toLowerCase(), items: String(v.offeringLabel || 'Services').toLowerCase(), offeringsLabel: v.offeringLabel });
  }
  for (const s of rowsOf<any>(idQ) || []) if (s.business_name) name.set(String(s.site_id), String(s.business_name));
  return { vocab, name };
}

/** ?area= and ?who= on a page's lines; "You" are on the viewer's side. Pure. */
export function filterItems(items: ChangeItem[], area: string | null, who: string | null, viewerSide: 'studio' | 'client' = 'studio'): ChangeItem[] {
  const a = CHANGE_AREAS.includes(area as ChangeArea) ? area as ChangeArea : null;
  const w = ['studio', 'client', 'auto'].includes(String(who)) ? who : null;
  return items.filter((it) => (!a || it.area === a) && (!w || sideOf(it.side, viewerSide) === w));
}

/** "YYYY-MM-DD" for a time in a zone. Pure. */
export function dayIn(iso: string, tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return iso.slice(0, 10); }
}
const zoneOf = (v: string | null) => { try { if (v) { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v; } } catch { /* a zone the server doesn't know */ } return 'UTC'; };

interface Built { items: ChangeItem[]; next: string | null; summary: ReturnType<typeof changeSummary>; names: Map<string, string> }

/** The page and its band, for some sites. */
async function build(siteIds: string[], o: { before: string; nowIso: string; summarySince: string; summaryDays: string[]; inBand?: (iso: string) => boolean; tz: string; viewer: string | null; viewerSide: 'studio' | 'client'; agencyIds: string[]; canPeople: boolean; maskClient: boolean }): Promise<Built> {
  const page = pageOf(await readRaw(siteIds, o.before, null, { events: PAGE_EVENTS, other: PAGE_OTHER }));
  // the band's window, read again only when the page doesn't already reach back to it
  const reaches = o.before >= o.nowIso && (!page.next || page.next <= o.summarySince);
  const band = (reaches ? page.rows.filter((r) => r.at >= o.summarySince) : (await readRaw(siteIds, o.nowIso, o.summarySince, { events: SUMMARY_EVENTS, other: PAGE_OTHER * 2 })).rows)
    .filter((r) => !o.inBand || o.inBand(r.at));
  const all = [...page.rows, ...band];
  const [{ people, ownerOf }, names, facts] = await Promise.all([peopleFor(siteIds, all, o.agencyIds, o.maskClient), namesFor(page.rows), sitesFacts(siteIds)]);
  const ctx = { viewer: o.viewer, viewerSide: o.viewerSide, people, ownerOf, names, vocab: (id: string) => facts.vocab.get(id) || { item: 'service', items: 'services', offeringsLabel: 'Services' }, canPeople: o.canPeople };
  const items = changeItems(page.rows, ctx);
  const summary = changeSummary(changeItems(band, ctx), o.summaryDays, (iso) => dayIn(iso, o.tz), o.viewerSide);
  return { items, next: page.next, summary, names: facts.name };
}

/** The days of a window ending today, oldest first, in a zone. Pure. */
export function daysBack(nowIso: string, n: number, tz: string): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayIn(new Date(Date.parse(nowIso) - i * 86_400_000).toISOString(), tz));
  return [...new Set(out)];
}
/** How far a zone is ahead of UTC at a moment, in ms. Pure. */
function zoneAhead(ms: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - Math.floor(ms / 1000) * 1000;
}
/** The first moment of this month on a zone's clock, as ISO. Pure. */
export function monthStartIn(nowIso: string, tz: string): string {
  const day = dayIn(nowIso, tz);
  const utcMidnight = Date.parse(`${day.slice(0, 8)}01T00:00:00Z`);
  return new Date(utcMidnight - zoneAhead(utcMidnight, tz)).toISOString();
}

/** GET /change-log: one site's changes. */
export async function handleChangeLog(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>, nowIso = new Date().toISOString()) {
  const url = new URL(req.url);
  const tz = zoneOf(url.searchParams.get('tz'));
  const studio = !!principal.scope || principal.kind === 'staff';
  const seat = principal.member && principal.member.site_id === site.id ? principal.member.role : null;
  const canPeople = studio || !seat || (isSiteRole(seat) && siteCan(seat, 'invite'));
  // the studio that looks after the site names its own people
  const agencyIds = rowsOf<{ agency_id: string }>(await svc(`presence_agency_clients?site_id=eq.${site.id}&status=eq.active&select=agency_id&limit=5`).catch(soft))?.map((r) => r.agency_id) || [];
  // the studio reads its own people by name, as the drawing has it; a client reads "You"
  const b = await build([site.id], { before: beforeOf(url.searchParams.get('before'), nowIso), nowIso, summarySince: monthStartIn(nowIso, tz), summaryDays: [], tz, viewer: studio ? null : principal.userId || null, viewerSide: studio ? 'studio' : 'client', agencyIds, canPeople, maskClient: false });
  return json({ data: {
    items: filterItems(b.items, url.searchParams.get('area'), url.searchParams.get('who'), studio ? 'studio' : 'client'),
    next_before: b.next, site_name: b.names.get(site.id) || '',
    month: { label: new Date(nowIso).toLocaleDateString('en-US', { month: 'long', timeZone: tz }), total: b.summary.total, went_live: b.summary.went_live, by_side: b.summary.by_side, people: b.summary.people.slice(0, 6) },
    can_people: canPeople, viewer_side: studio ? 'studio' : 'client',
  } }, 200, cors);
}

/** What one publish put live, from its kept version against the one live before it. */
async function wentLive(siteId: string, publishId: string): Promise<{ kept: boolean; first: boolean; sentences: string[] } | null> {
  const pub = rowsOf<any>(await svc(`presence_publishes?id=eq.${publishId}&site_id=eq.${siteId}&select=id,snapshot_id,created_at,status&limit=1`).catch(soft))?.[0];
  if (!pub) return null;
  const prev = rowsOf<any>(await svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&created_at=lt.${encodeURIComponent(pub.created_at)}&select=snapshot_id&order=created_at.desc&limit=1`).catch(soft))?.[0];
  const ids = [pub.snapshot_id, prev?.snapshot_id].filter((x) => UUID.test(String(x || '')));
  const snaps = ids.length ? rowsOf<any>(await svc(`presence_snapshots?id=in.(${ids.join(',')})&site_id=eq.${siteId}&select=id,content`).catch(soft)) || [] : [];
  const now = snaps.find((s) => s.id === pub.snapshot_id), was = prev ? snaps.find((s) => s.id === prev.snapshot_id) : null;
  // versions are kept twenty deep: an older publish no longer has its words
  if (!now || (prev && !was)) return { kept: false, first: !prev, sentences: [] };
  const set = describeChanges(normalizeSnapshotContent(now.content), was ? normalizeSnapshotContent(was.content) : null);
  return { kept: true, first: set.first_publish, sentences: set.changes.map((c) => c.sentence).slice(0, 12) };
}

/** GET /change-log/went-live?id= */
export async function handleWentLive(req: Request, site: SiteRow, cors: Record<string, string>) {
  const id = String(new URL(req.url).searchParams.get('id') || '');
  if (!UUID.test(id)) return json({ error: 'bad_request', message: 'Say which publish.' }, 400, cors);
  const d = await wentLive(site.id, id);
  if (!d) return json({ error: 'not_found', message: 'That publish isn’t in this site’s history.' }, 404, cors);
  return json({ data: d }, 200, cors);
}

/** GET /agency/change-log(/went-live), or null when the route is someone else's. */
export async function handleAgencyChangeLog(req: Request, route: string, method: string, member: AgencyMember, cors: Record<string, string>, nowIso = new Date().toISOString()): Promise<Response | null> {
  if (method !== 'GET' || (route !== '/agency/change-log' && route !== '/agency/change-log/went-live')) return null;
  if (!can(member.role, 'read')) return json({ error: 'forbidden', message: 'Your role can’t see this.' }, 403, cors);
  const url = new URL(req.url);
  const ids = (await agencySiteIds(member.agency_id)).filter((x) => UUID.test(String(x)));
  if (route === '/agency/change-log/went-live') {
    const site = String(url.searchParams.get('site') || ''), id = String(url.searchParams.get('id') || '');
    if (!ids.includes(site) || !UUID.test(id)) return json({ error: 'not_found', message: 'That publish isn’t one of your clients’.' }, 404, cors);
    const d = await wentLive(site, id);
    return d ? json({ data: d }, 200, cors) : json({ error: 'not_found', message: 'That publish isn’t in this site’s history.' }, 404, cors);
  }
  const tz = zoneOf(url.searchParams.get('tz'));
  const one = String(url.searchParams.get('site') || '');
  const sites = one && ids.includes(one) ? [one] : ids;
  if (!sites.length) return json({ data: { items: [], next_before: null, sites: {}, week: null, can_people: false } }, 200, cors);
  const canPeople = can(member.role, 'manage_clients');
  const days = daysBack(nowIso, 7, tz);
  const since = new Date(Date.parse(`${days[0]}T00:00:00Z`) - 14 * 3_600_000).toISOString();   // early enough for any zone; the band keeps the zone's seven days
  const b = await build(sites, { before: beforeOf(url.searchParams.get('before'), nowIso), nowIso, summarySince: since, summaryDays: days, inBand: (iso) => days.includes(dayIn(iso, tz)), tz, viewer: null, viewerSide: 'studio', agencyIds: [member.agency_id], canPeople, maskClient: !can(member.role, 'bulk_publish') });
  const week = { days: b.summary.days, total: b.summary.total, went_live: b.summary.went_live, by_side: b.summary.by_side, people: b.summary.people.slice(0, 6), site_count: b.summary.sites.length, sites: b.summary.sites.slice(0, 3).map((x) => ({ ...x, name: b.names.get(x.site_id) || '' })) };
  return json({ data: {
    items: filterItems(b.items, url.searchParams.get('area'), url.searchParams.get('who'), 'studio').map((it) => ({ ...it, site: b.names.get(it.site_id) || '' })),
    next_before: b.next, sites: Object.fromEntries(ids.map((x) => [x, b.names.get(x) || ''])), week, can_people: canPeople,
  } }, 200, cors);
}
