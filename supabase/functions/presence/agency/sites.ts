// ── The studio's Sites and Domains (builder list items 43, 45 and 52, Nov 2026) ─
// Squarespace's all-sites dashboard and Wix's Sites table, on our own rows: every
// client site as a card (a live thumbnail, the address, its status, the plan and
// when it renews, who can edit) and as a table (Name · Team · Plan · Published ·
// Last updated · Tags), pinned sites first, then the ones you opened last; every
// domain in one list (status, provider, expiry); Pin and Duplicate on each site's
// menu.
//
// Where each fact comes from. Nothing new is stored but the pins:
//   • the rows, names, tags and last changes: the portfolio gather (routes.ts), so
//     Home and Sites always name a client the same way;
//   • the plan and its renewal: the client's presence entitlement;
//   • who can edit: the studio's owners, admins and account managers (the roles
//     that may open a client, lib/scope.ts), the site's own seats that can edit,
//     and the owner when they use the full workspace (not the client portal);
//   • "last opened": the member's own visits inside each client, which
//     presence_scoped_access_events already records, so there is no extra write
//     and it follows them from the laptop to the phone;
//   • pins: one reserved JSON row on the studio's own site (lib/reserved_store.ts),
//     keyed by member, so no migration.
// The pure builders take batched reads, so a page costs a fixed number of queries
// whatever the client count. The routes are at the end; routes.ts hands them over.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember, AgencyRole } from './auth.ts';
import type { Principal } from '../../_shared/auth.ts';
import { buildPortfolio, filterPortfolio } from './portfolio.ts';
import type { PortfolioInput } from './portfolio.ts';
import { daysBetween, DOMAIN_SOON_DAYS, PADLOCK_SOON_DAYS, PADLOCK_STUCK_HOURS } from './needs_you.ts';
import { DOWN_THRESHOLD } from '../monitor/heartbeat.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { siteOrigin, hostedName, SITE_COLS } from '../lib/site.ts';
import type { SiteRow } from '../lib/site.ts';
import { getTemplate, renderForBuilder, latestTemplateVersion } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import type { MediaManifestEntry } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { snapshotContentUsable } from '../lib/render_types.ts';
import type { Snapshot } from '../lib/render_types.ts';
import { computeDraftHash } from '../lib/draft_hash.ts';
import { previewCache, previewCacheKey } from '../lib/preview_cache.ts';
import { previewUrlMap } from '../lib/media.ts';
import { withSampleWords } from '../lib/sample_words.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { kitFromSite, applyKitTo, layoutFromSite } from './kit_io.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';
import { normalizeCopied } from '../lib/site_layout.ts';
import { keepCopied } from '../lib/copied_record.ts';

const rowsOf = <T,>(q: { ok?: boolean; json?: unknown } | null | undefined): T[] => (q && q.ok !== false && Array.isArray(q.json) ? (q.json as T[]) : []);

/* ── plans, in the words a studio uses ── */
export const PLAN_WORDS: Record<string, string> = {
  presence_monitor: 'Watch', cms_only: 'Website', business_os_only: 'Business tools',
  presence: 'Website + tools', presence_managed: 'Managed', agency: 'Studio', enterprise: 'Enterprise',
};
export interface PlanRow { client_id: string; plan?: string | null; status?: string | null; term?: string | null; current_period_end?: string | null; trial_ends_at?: string | null; cancel_at_period_end?: boolean | null }
export interface SitePlan { key: string; words: string; status: string; term: string; renews: { kind: 'renews' | 'ends' | 'trial' | 'none'; at: string | null } }

/** The plan on a card and when it next changes: a trial's end, a renewal, or the
 *  day a cancelled plan stops. No entitlement row → "No plan on file". Pure. */
export function planOf(row: PlanRow | null | undefined, nowIso: string): SitePlan {
  if (!row) return { key: '', words: 'No plan on file', status: '', term: '', renews: { kind: 'none', at: null } };
  const key = String(row.plan || '');
  const words = PLAN_WORDS[key] || (key ? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'No plan on file');
  const status = String(row.status || 'active');
  const term = row.term === 'annual' || row.term === 'monthly' ? row.term : '';
  const future = (s: string | null | undefined) => !!s && String(s) > nowIso;
  let renews: SitePlan['renews'] = { kind: 'none', at: null };
  if (future(row.trial_ends_at)) renews = { kind: 'trial', at: String(row.trial_ends_at) };
  else if (row.current_period_end) renews = { kind: row.cancel_at_period_end ? 'ends' : 'renews', at: String(row.current_period_end) };
  return { key, words, status, term, renews };
}

/* ── the website's own state ── */
export interface SiteExtra { id: string; client_id?: string | null; netlify_site_id?: string | null; offline_at?: string | null; uptime_ok?: boolean | null; uptime_fail_streak?: number | null; domain_checked_at?: string | null; template_slug?: string | null; created_at?: string | null }
export type StateKey = 'live' | 'not_live' | 'elsewhere' | 'offline' | 'down' | 'paused';
const STATE_WORDS: Record<StateKey, string> = { live: 'Live', not_live: 'Not live yet', elsewhere: 'Hosted elsewhere', offline: 'Offline', down: 'Not answering', paused: 'Paused' };

/** Home's rule (agency.html statusWord) for live, not live yet and hosted
 *  elsewhere, plus the three facts only the website knows: taken offline, not
 *  answering the uptime probe (two misses in a row, monitor/heartbeat.ts), paused.
 *  "Needs you" is Home's own list; the page lays it over this. Pure. */
export function siteState(p: { edition?: string | null; status?: string | null; last_published_at?: string | null }, x?: SiteExtra | null): { key: StateKey; words: string } {
  const at = (key: StateKey) => ({ key, words: STATE_WORDS[key] });
  if (p.edition === 'monitor') return at('elsewhere');
  if (p.status === 'paused') return at('paused');
  if (!(p.status === 'live' || p.last_published_at)) return at('not_live');
  if (x?.offline_at) return at('offline');
  if ((Number(x?.uptime_fail_streak) || 0) >= DOWN_THRESHOLD) return at('down');
  return at('live');
}

/* ── who can edit ── */
export interface SeatRow { site_id: string; email: string; role: string; status?: string | null }
export interface StudioSeat { email: string; role: string }
export interface OwnerRow { id: string; name?: string | null; email?: string | null }
export interface TeamMember { who: string; email: string; side: 'studio' | 'client'; role: string; me: boolean; invited: boolean }
/** The studio roles that may open a client's site at all (lib/scope.ts asks bulk_publish). */
export const STUDIO_EDITORS: readonly AgencyRole[] = ['owner', 'admin', 'account_manager'];
const STUDIO_ROLE_WORDS: Record<string, string> = { owner: 'Owner', admin: 'Admin', account_manager: 'Account manager' };
/** A site's seats that carry `edit` (lib/site_roles.ts); a reviewer only reviews. */
const SEAT_WORDS: Record<string, string> = { business_owner: 'Owner', business_staff: 'Staff', developer: 'Developer' };

/** Everyone who can change this site: the studio first, then their side. The
 *  owner counts when they use the full workspace; a client the studio serves
 *  through the portal (an active service link) reviews and approves instead, so
 *  they are not listed. One entry per email. Pure. */
export function teamOf(i: { studio: StudioSeat[]; seats: SeatRow[]; owner?: OwnerRow | null; portalClient: boolean; me: string }): TeamMember[] {
  const me = String(i.me || '').toLowerCase();
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  const add = (m: TeamMember) => { const k = m.email || m.who.toLowerCase(); if (!k || seen.has(k)) return; seen.add(k); out.push(m); };
  for (const s of i.studio) {
    if (!STUDIO_EDITORS.includes(s.role as AgencyRole)) continue;
    const email = String(s.email || '').toLowerCase();
    add({ who: email, email, side: 'studio', role: STUDIO_ROLE_WORDS[s.role] || s.role, me: !!me && email === me, invited: false });
  }
  if (i.owner && !i.portalClient) {
    const email = String(i.owner.email || '').toLowerCase();
    add({ who: String(i.owner.name || '').trim() || email, email, side: 'client', role: 'Owner', me: !!me && email === me, invited: false });
  }
  for (const s of i.seats) {
    if (!SEAT_WORDS[s.role] || s.status === 'revoked') continue;
    const email = String(s.email || '').toLowerCase();
    add({ who: email, email, side: 'client', role: SEAT_WORDS[s.role], me: !!me && email === me, invited: s.status === 'invited' });
  }
  return out;
}

/* ── last opened and pins ── */
/** The newest visit per site from rows read newest first. Pure. */
export function lastOpenedBySite(events: Array<{ client_site_id?: string | null; created_at?: string | null }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) {
    const id = String(e.client_site_id || ''), at = String(e.created_at || '');
    if (!id || !at) continue;
    if (!out[id] || at > out[id]) out[id] = at;
  }
  return out;
}
export const MAX_PINS = 50;
/** The stored pins: member id → their pinned site ids, newest pin first. Anything
 *  that isn't a uuid is dropped; each list is de-duplicated and capped. Pure. */
export function normalizePins(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [member, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!UUID_RE.test(member) || !Array.isArray(list)) continue;
    const ids = [...new Set(list.map((x) => String(x)).filter((x) => UUID_RE.test(x)))].slice(0, MAX_PINS);
    if (ids.length) out[member] = ids;
  }
  return out;
}
/** Pin (to the front) or unpin one site for one member, leaving everyone else's pins alone. Pure. */
export function setPinned(raw: unknown, memberId: string, siteId: string, pinned: boolean): Record<string, string[]> {
  const all = normalizePins(raw);
  const mine = (all[memberId] || []).filter((x) => x !== siteId);
  const next = pinned ? [siteId, ...mine].slice(0, MAX_PINS) : mine;
  if (next.length) all[memberId] = next; else delete all[memberId];
  return all;
}

/* ── the rows ── */
export interface SitesInput {
  portfolio: ReturnType<typeof buildPortfolio>;   // the active rows (archived stay on Home's Archived view)
  extras: SiteExtra[];
  plans: PlanRow[];
  seats: SeatRow[];
  owners: OwnerRow[];
  portalSites: string[];          // sites whose owner the studio serves through the client portal
  studio: StudioSeat[];
  me: string;
  opened: Record<string, string>;
  pins: string[];
  nowIso: string;
  /** item 145: the sites started from another site or a template, and whether the studio kept what came across */
  copied?: Record<string, { from: string; kept: boolean }>;
}
export type SiteCard = ReturnType<typeof buildSites>[number];

/** One row per client site, pinned first (in pin order), then last opened, then
 *  by name. Pure. */
export function buildSites(i: SitesInput) {
  const extra = new Map(i.extras.map((x) => [x.id, x]));
  const planBy = new Map(i.plans.map((p) => [p.client_id, p]));
  const ownerBy = new Map(i.owners.map((o) => [o.id, o]));
  const portal = new Set(i.portalSites);
  const seatsBy = new Map<string, SeatRow[]>();
  for (const s of i.seats) seatsBy.set(s.site_id, [...(seatsBy.get(s.site_id) || []), s]);
  const pinAt = new Map(i.pins.map((id, n) => [id, n]));
  const rows = i.portfolio.map((p) => {
    const x = extra.get(p.site_id) || null;
    const clientId = String(x?.client_id || '');
    const state = siteState(p, x);
    const hosted = p.edition !== 'monitor';
    return {
      site_id: p.site_id, name: p.name, edition: p.edition,
      state: state.key, state_words: state.words,
      // the address visitors use: their own domain, else the built-in one (never for a watch plan's site we don't host)
      address: hosted ? siteOrigin({ id: p.site_id, custom_domain: p.domain, netlify_site_id: x?.netlify_site_id }) : (p.domain ? `https://${p.domain}` : ''),
      domain: p.domain, domain_registrar: p.domain_registrar, domain_expires_at: p.domain_expires_at,
      plan: planOf(planBy.get(clientId), i.nowIso),
      team: teamOf({ studio: i.studio, seats: seatsBy.get(p.site_id) || [], owner: ownerBy.get(clientId) || null, portalClient: portal.has(p.site_id), me: i.me }),
      tags: p.tags,
      published_at: p.last_published_at,
      updated_at: p.last_change_at || p.last_published_at || x?.created_at || null,
      unpublished_changes: p.unpublished_changes,
      billing_issue: p.billing_issue,
      opened_at: i.opened[p.site_id] || null,
      pinned: pinAt.has(p.site_id),
      // what the thumbnail route can draw: the live page, else the draft; a site
      // we only watch lives on someone else's host, so there is nothing of ours to draw
      thumb: hosted ? (state.key === 'not_live' ? 'draft' : 'live') : null,
      copied: (i.copied && i.copied[p.site_id]) || null,
    };
  });
  rows.sort((a, b) => {
    const pa = pinAt.has(a.site_id) ? pinAt.get(a.site_id)! : Infinity, pb = pinAt.has(b.site_id) ? pinAt.get(b.site_id)! : Infinity;
    if (pa !== pb) return pa - pb;
    const oa = a.opened_at || '', ob = b.opened_at || '';
    if (oa !== ob) return oa > ob ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' });
  });
  return rows;
}

/* ── the domains ── */
export interface DomainIn {
  site_id: string; name: string; edition?: string | null; status?: string | null; last_published_at?: string | null;
  custom_domain?: string | null; domain_registrar?: string | null; domain_expires_at?: string | null; domain_checked_at?: string | null;
  netlify_site_id?: string | null; uptime_ok?: boolean | null; uptime_fail_streak?: number | null; offline_at?: string | null;
  own?: boolean;
  /** item 132: how the last registration lookup went (ok · not_found · failed) */
  domain_lookup_status?: string | null;
  /** item 134: the padlock's end date, and since when the records were right with no padlock on */
  cert_expires_at?: string | null; cert_pending_since?: string | null;
}
export type DomainTone = 'good' | 'warn' | 'bad' | 'quiet';
/** One domain's status in a few words. Expiry first, on the same 30-day line as
 *  Needs you (needs_you.ts), then what the domain is doing for the site. Pure. */
export function domainStatus(d: DomainIn, nowIso: string): { key: string; words: string; tone: DomainTone; days_left: number | null } {
  const days = daysBetween(nowIso, d.domain_expires_at);
  const is = (key: string, words: string, tone: DomainTone) => ({ key, words, tone, days_left: days });
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  if (days !== null && days < 0) return is('expired', `Expired ${plural(-days)} ago`, 'bad');
  if (days !== null && days <= DOMAIN_SOON_DAYS) return is('expiring', days === 0 ? 'Expires today' : `Expires in ${plural(days)}`, 'warn');
  if (d.edition === 'monitor') return is('elsewhere', 'On their own host', 'quiet');
  if (!(d.status === 'live' || d.last_published_at)) return is('not_live', 'Site not live yet', 'quiet');
  if (d.offline_at) return is('offline', 'Site offline', 'warn');
  // item 134: the padlock, on the same lines as Home's Needs you (needs_you.ts)
  const stuckH = d.cert_pending_since ? (Date.parse(nowIso) - Date.parse(d.cert_pending_since)) / 3600_000 : null;
  if (d.edition !== 'monitor' && stuckH !== null && Number.isFinite(stuckH) && stuckH >= PADLOCK_STUCK_HOURS) return is('padlock', 'Padlock not on yet', 'warn');
  const pe = d.edition !== 'monitor' ? daysBetween(nowIso, d.cert_expires_at) : null;
  if (pe !== null && pe <= PADLOCK_SOON_DAYS) return is('padlock', pe < 0 ? 'Padlock ended' : pe === 0 ? 'Padlock ends today' : `Padlock ends in ${plural(pe)}`, 'warn');
  if ((Number(d.uptime_fail_streak) || 0) >= DOWN_THRESHOLD) return is('down', 'Not answering', 'bad');
  if (d.uptime_ok === true) return is('connected', 'Connected', 'good');
  return is('checking', 'Not checked yet', 'quiet');
}
/** Every custom domain with its status, provider and expiry, the most urgent
 *  first; and the hosted sites still on their built-in address. Pure. */
export function buildDomains(rows: DomainIn[], nowIso: string) {
  const RANK: Record<string, number> = { expired: 0, down: 1, expiring: 2, padlock: 3, offline: 4, checking: 5, not_live: 6, elsewhere: 7, connected: 8 };
  const domains = rows.filter((r) => r.custom_domain).map((r) => {
    const st = domainStatus(r, nowIso);
    return {
      domain: String(r.custom_domain), site_id: r.site_id, name: r.name, own: !!r.own,
      status: st.key, status_words: st.words, tone: st.tone, days_left: st.days_left,
      provider: String(r.domain_registrar || ''),
      expires_at: r.domain_expires_at || null,
      checked_at: r.domain_checked_at || null,
      // item 132: a lookup that failed or found no record is said, never a quiet "Not known yet"
      record: r.domain_lookup_status === 'failed' || r.domain_lookup_status === 'not_found' ? 'unreadable' : r.domain_lookup_status === 'ok' ? 'ok' : 'unknown',
      padlock_until: r.edition !== 'monitor' ? (r.cert_expires_at || null) : null,   // item 134
      hosted: r.edition !== 'monitor',
    };
  });
  domains.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)
    || (a.days_left ?? Infinity) - (b.days_left ?? Infinity)
    || a.domain.localeCompare(b.domain));
  const builtin = rows.filter((r) => !r.custom_domain && r.edition !== 'monitor' && r.netlify_site_id)
    .map((r) => ({ address: `${hostedName(r.site_id)}.netlify.app`, site_id: r.site_id, name: r.name, own: !!r.own }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { domains, builtin };
}

/* ── the live thumbnail ──
 * Published sites refuse to be framed (frame-ancestors 'none', lib/security_headers.ts),
 * and the app's own policy frames only Stripe, Calendly and Cloudflare, so a card
 * can't simply show the live address. Nor does it go to a screenshot service: that
 * would hand every client's address to a third party and widen the app's policy.
 * Instead the server draws the site's home page with the one renderer publish
 * uses, from the live version (or the draft before the first publish), and the
 * page shows it in a sandboxed frame with scripts off, scaled down. It stays cheap:
 *   • the render is the builder's own cached one (lib/preview_cache.ts, same key), so
 *     a site the builder just previewed costs nothing to draw;
 *   • one small photo per image is signed, not all six sizes (the builder's
 *     preview signs every variant of every photo);
 *   • scripts, frames, preloads and video downloads are taken out;
 *   • the page asks only for the cards on screen, two at a time, once per visit. */
export const THUMB_WIDTH = 800;   // the one photo size a scaled-down home page needs
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const THUMB_STYLE = '<style>html,body{overflow:hidden!important;scrollbar-width:none}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent}</style>';
export const THUMB_MAX_CHARS = 1_500_000;

/** The photo size a thumbnail uses for one image: the WebP closest to
 *  THUMB_WIDTH, else whatever is closest. Null for a file that isn't a photo. Pure. */
export function thumbVariant(m: MediaManifestEntry): MediaManifestEntry['variants'][number] | null {
  const imgs = (m.variants || []).filter((v) => v.format !== 'original');
  if (!imgs.length) return null;
  const near = (list: typeof imgs) => list.slice().sort((a, b) => Math.abs(a.width - THUMB_WIDTH) - Math.abs(b.width - THUMB_WIDTH))[0];
  const webp = imgs.filter((v) => v.format === 'webp');
  return near(webp.length ? webp : imgs);
}

/** A rendered home page made fit for a card: no scripts, frames, preloads,
 *  autoplaying video or srcsets, and every image pointed at ONE size. Returns the
 *  html with each image left at its chosen output path, plus the manifest entries
 *  to sign (only the photos the page shows, one size each). Pure. */
export function trimForThumb(html: string, manifest: MediaManifestEntry[]): { html: string; sign: MediaManifestEntry[]; pathOf: Record<string, string> } {
  let out = String(html || '');
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<link\b[^>]*\brel="(?:preload|prefetch|modulepreload|preconnect|dns-prefetch|manifest|icon|apple-touch-icon|alternate|canonical)"[^>]*>/gi, '')
    .replace(/<source\b[^>]*>/gi, '')
    .replace(/\s(?:srcset|sizes)="[^"]*"/gi, '')
    .replace(/\sautoplay\b(?:="[^"]*")?/gi, '')
    .replace(/<video\b/gi, '<video preload="none"')
    .replaceAll('https://preview.invalid', '');
  const pathOf: Record<string, string> = {};   // any variant's output path → the one this thumbnail uses
  const sign: MediaManifestEntry[] = [];
  for (const m of manifest || []) {
    const shown = (m.variants || []).some((v) => out.includes(`"${v.output_path}"`));
    const pick = shown ? thumbVariant(m) : null;
    if (!pick) continue;
    for (const v of m.variants) pathOf[v.output_path] = pick.output_path;
    sign.push({ ...m, variants: [pick] });
  }
  for (const [from, to] of Object.entries(pathOf)) if (from !== to) out = out.replaceAll(`"${from}"`, `"${to}"`);
  out = out.includes('</head>') ? out.replace('</head>', () => `${THUMB_STYLE}</head>`) : THUMB_STYLE + out;
  return { html: out, sign, pathOf };
}

/** Point each chosen photo at its signed address; one that couldn't be signed
 *  becomes a blank pixel, never a broken-image box. Pure. */
export function signThumb(html: string, pathOf: Record<string, string>, signed: Record<string, string>): string {
  let out = html;
  for (const p of new Set(Object.values(pathOf))) out = out.replaceAll(`"${p}"`, `"${signed[p] || PIXEL}"`);
  return out;
}

async function liveSnapshot(siteId: string): Promise<{ snapshot: Snapshot; mediaManifest: MediaManifestEntry[] } | null> {
  const p = await svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&select=snapshot_id&order=created_at.desc&limit=1`);
  const snapId = rowsOf<{ snapshot_id: string | null }>(p)[0]?.snapshot_id;
  if (!snapId) return null;
  const s = await svc(`presence_snapshots?id=eq.${snapId}&site_id=eq.${siteId}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization`);
  const row = rowsOf<any>(s)[0];
  if (!row || !snapshotContentUsable(row.content)) return null;
  return {
    snapshot: { content: row.content, content_contract_version: row.content_contract_version, template_slug: row.template_slug, template_version: row.template_version, created_at: row.created_at, dev_customization: row.dev_customization ?? null } as Snapshot,
    mediaManifest: (row.media_manifest || []) as MediaManifestEntry[],
  };
}

/** The site's home page for a card: the live version, else the draft (with the
 *  sample words a new site is drawn with). The render goes through the builder's
 *  preview cache under the same key routes/preview.ts uses. Null when there's
 *  nothing to draw. */
export async function renderThumb(site: SiteRow): Promise<{ html: string; version: 'live' | 'draft' } | null> {
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return null;
  let snapshot: Snapshot, mediaManifest: MediaManifestEntry[], version: 'live' | 'draft' = 'live';
  let blockers = 0, warnings = 0;
  const live = site.last_published_at ? await liveSnapshot(site.id) : null;
  if (live) ({ snapshot, mediaManifest } = live);
  else {
    version = 'draft';
    const d = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: new Date().toISOString() });
    const v = validateSnapshot(d.snapshot, t.manifest);   // kept with the cached render, as the builder's preview keeps them
    blockers = v.blockers.length; warnings = v.warnings.length;
    snapshot = withSampleWords(d.snapshot); mediaManifest = d.mediaManifest;
  }
  const key = previewCacheKey(site.id, 'draft', await computeDraftHash(snapshot));
  const hit = previewCache.get(key);
  const fileMap = hit ? hit.fileMap : await renderForBuilder(snapshot);
  if (!hit) previewCache.set(key, { fileMap, mediaManifest, blockers, warnings });
  let html = fileMap['index.html'] as string | undefined;
  if (typeof html !== 'string') return null;
  const cssKey = Object.keys(fileMap).find((k) => k.startsWith('assets/') && k.endsWith('.css'));
  if (cssKey) html = html.replace(/<link rel="stylesheet" href="[^"]*">/, () => `<style>${fileMap[cssKey]}</style>`);
  const trimmed = trimForThumb(html, mediaManifest);
  const signed = trimmed.sign.length ? await previewUrlMap(trimmed.sign) : {};
  return { html: signThumb(trimmed.html, trimmed.pathOf, signed), version };
}

/* ── the routes ── */
export interface SitesDeps {
  gather: (agencyId: string, nowIso: string) => Promise<PortfolioInput>;
  ownSite: () => Promise<SiteRow | null>;
}
const forbid = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);
const notYours = (cors: Record<string, string>) => json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
const EXTRA_COLS = 'id,client_id,netlify_site_id,offline_at,uptime_ok,uptime_fail_streak,domain_checked_at,template_slug,created_at';
/** the Domains page also reads the lookup's result and the padlock (items 132 and 134, migration 0149) */
const DOMAIN_COLS = `${EXTRA_COLS},domain_lookup_status,cert_expires_at,cert_pending_since`;

/** The Sites and Domains routes, or null when the route is someone else's. */
export async function handleAgencySites(req: Request, route: string, method: string, member: AgencyMember, principal: Principal, cors: Record<string, string>, deps: SitesDeps): Promise<Response | null> {
  const now = new Date().toISOString();

  // ── every client site, with what its card and its table row show ──
  if (route === '/agency/sites' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const input = await deps.gather(member.agency_id, now);
    const portfolio = filterPortfolio(buildPortfolio(input), {});
    const ids = portfolio.map((r) => r.site_id);
    const clientIds = [...new Set((input.sites as Array<{ id: string; client_id?: string }>).filter((s) => ids.includes(s.id)).map((s) => String(s.client_id || '')).filter((x) => UUID_RE.test(x)))];
    const IN = `in.(${ids.join(',')})`;
    const none = Promise.resolve({ ok: true, json: [] as unknown[] });
    const soft = () => ({ ok: false, json: null as unknown });
    const userId = UUID_RE.test(String(principal.userId || '')) ? String(principal.userId) : '';
    // each read is best-effort: a failed one leaves its column empty and `partial` says so
    const [extraQ, planQ, seatQ, ownerQ, linkQ, studioQ, openQ, pins, copiedQ] = await Promise.all([
      ids.length ? svc(`presence_sites?id=${IN}&select=${EXTRA_COLS}&limit=1000`).catch(soft) : none,
      clientIds.length ? svc(`presence_entitlements?client_id=in.(${clientIds.join(',')})&product=eq.presence&select=client_id,plan,status,term,current_period_end,trial_ends_at,cancel_at_period_end&limit=1000`).catch(soft) : none,
      ids.length ? svc(`presence_site_members?site_id=${IN}&status=in.(active,invited)&select=site_id,email,role,status&limit=2000`).catch(soft) : none,
      clientIds.length ? svc(`clients?id=in.(${clientIds.join(',')})&select=id,name,email&limit=1000`).catch(soft) : none,
      ids.length ? svc(`presence_service_links?customer_site_id=${IN}&status=eq.active&select=customer_site_id&limit=1000`).catch(soft) : none,
      svc(`presence_agency_members?agency_id=eq.${member.agency_id}&status=eq.active&select=email,role&limit=200`).catch(soft),
      // "last opened": this member's own visits inside clients, newest first (psae_operator_idx). Only the
      // page loads (the shell reads /portal/context once per page), not each of a page's thirty-odd
      // requests, so the thousand rows reach back a thousand pages, not thirty.
      userId && ids.length ? svc(`presence_scoped_access_events?operator_user_id=eq.${userId}&outcome=eq.allowed&route=eq.${encodeURIComponent('/portal/context')}&select=client_site_id,created_at&order=created_at.desc&limit=1000`).catch(soft) : none,
      deps.ownSite().then(async (own) => (own ? { ok: true, own: true, pins: normalizePins(await readReservedJson(own.id, RESERVED_NAMES.sitePins))[member.member_id] || [] } : { ok: true, own: false, pins: [] as string[] })).catch(() => ({ ok: false, own: false, pins: [] as string[] })),
      // item 145: which sites were started from another site or a template (their copy records)
      ids.length ? svc(`presence_sales_templates?site_id=${IN}&kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.copiedFrom)}&deleted_at=is.null&select=site_id,body&limit=1000`).catch(soft) : none,
    ]);
    const copied: Record<string, { from: string; kept: boolean }> = {};
    for (const r of rowsOf<{ site_id: string; body: string }>(copiedQ)) {
      let rec = null; try { rec = normalizeCopied(JSON.parse(String(r.body || 'null'))); } catch { rec = null; }
      if (rec) copied[r.site_id] = { from: rec.from, kept: rec.kept };
    }
    const rows = buildSites({
      portfolio, extras: rowsOf<SiteExtra>(extraQ), plans: rowsOf<PlanRow>(planQ), seats: rowsOf<SeatRow>(seatQ), owners: rowsOf<OwnerRow>(ownerQ),
      portalSites: rowsOf<{ customer_site_id: string }>(linkQ).map((l) => String(l.customer_site_id)),
      studio: rowsOf<StudioSeat>(studioQ), me: member.email, opened: lastOpenedBySite(rowsOf(openQ)),
      pins: pins.pins.filter((id) => ids.includes(id)), nowIso: now, copied,
    });
    const partial = [extraQ, planQ, seatQ, ownerQ, linkQ, studioQ, openQ, copiedQ].some((q) => (q as { ok?: boolean }).ok === false) || !pins.ok;
    // a studio seat that can't open a client (lib/scope.ts asks bulk_publish) gets no doors into one,
    // and not the client's own people by name
    const canOpen = can(member.role, 'bulk_publish');
    if (!canOpen) for (const r of rows) r.team = r.team.map((t) => (t.side === 'client' ? { ...t, who: 'Someone on their side', email: '' } : t));
    return json({ data: rows, partial, can_open: canOpen, can_pin: pins.own, can_duplicate: can(member.role, 'manage_clients') }, 200, cors);
  }

  // ── every domain: the clients' and the studio's own ──
  if (route === '/agency/domains' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const input = await deps.gather(member.agency_id, now);
    const portfolio = filterPortfolio(buildPortfolio(input), {});
    const ids = portfolio.map((r) => r.site_id);
    const soft = () => ({ ok: false, json: null as unknown });
    const [extraQ, own] = await Promise.all([
      ids.length ? svc(`presence_sites?id=in.(${ids.join(',')})&select=${DOMAIN_COLS}&limit=1000`).catch(soft) : Promise.resolve({ ok: true, json: [] as unknown[] }),
      deps.ownSite().catch(() => null),
    ]);
    const extra = new Map(rowsOf<SiteExtra>(extraQ).map((x) => [x.id, x]));
    const list: DomainIn[] = portfolio.map((p) => ({ ...(extra.get(p.site_id) || {}), site_id: p.site_id, name: p.name, edition: p.edition, status: p.status, last_published_at: p.last_published_at, custom_domain: p.domain, domain_registrar: p.domain_registrar, domain_expires_at: p.domain_expires_at }));
    if (own && !ids.includes(own.id)) {
      const ownQ = await svc(`presence_sites?id=eq.${own.id}&select=${DOMAIN_COLS},domain_registrar,domain_expires_at&limit=1`).catch(soft);
      const x = rowsOf<SiteExtra & { domain_registrar?: string; domain_expires_at?: string }>(ownQ)[0] || {};
      list.push({ ...x, site_id: own.id, name: String(member.branding?.display_name || member.agency_name || 'Your studio'), edition: own.edition, status: own.status, last_published_at: own.last_published_at, custom_domain: own.custom_domain, own: true });
    }
    return json({ data: buildDomains(list, now), partial: (extraQ as { ok?: boolean }).ok === false }, 200, cors);
  }

  const m = route.match(/^\/agency\/sites\/([0-9a-f-]{36})\/(thumb|pin|duplicate|copied)$/);
  if (!m) return null;
  const siteId = m[1], what = m[2];

  // ── a card's live thumbnail ──
  if (what === 'thumb' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    if (!(await agencySiteIds(member.agency_id)).includes(siteId)) return notYours(cors);
    const site = rowsOf<SiteRow>(await svc(`presence_sites?id=eq.${siteId}&select=${SITE_COLS}&limit=1`))[0];
    if (!site) return notYours(cors);
    if (site.edition === 'monitor') return json({ error: 'hosted_elsewhere', message: 'This site lives on their own host.' }, 404, cors);
    try {
      const t = await renderThumb(site);
      if (!t) return json({ error: 'nothing_to_draw', message: 'There’s nothing to draw yet.' }, 404, cors);
      if (t.html.length > THUMB_MAX_CHARS) return json({ error: 'too_big', message: 'This page is too big to draw small.' }, 422, cors);
      return json({ data: t }, 200, { ...cors, 'Cache-Control': 'no-store' });   // the photo links expire in ten minutes
    } catch (e) {
      console.error('thumb render failed:', (e as Error)?.message);
      return json({ error: 'render_failed', message: 'We couldn’t draw this site just now.' }, 500, cors);
    }
  }

  // ── pin a site to the top of YOUR Sites page (item 45) ──
  if (what === 'pin' && method === 'PUT') {
    if (!can(member.role, 'read')) return forbid(cors);
    let b: { pinned?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
    if (typeof b.pinned !== 'boolean') return json({ error: 'bad_request', message: 'Say pinned true or false.' }, 400, cors);
    if (!(await agencySiteIds(member.agency_id)).includes(siteId)) return notYours(cors);
    const own = await deps.ownSite();
    if (!own) return json({ error: 'no_studio_site', message: 'Pins are kept on your studio’s own site, and this sign-in doesn’t have one.' }, 409, cors);
    const pinned = b.pinned;
    const stored = await updateReservedJson(own.id, RESERVED_NAMES.sitePins, (cur) => setPinned(cur, member.member_id, siteId, pinned), member.email);
    if (!stored) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
    return json({ data: { site_id: siteId, pinned, pins: stored[member.member_id] || [] } }, 200, cors);
  }

  // ── Duplicate site (item 45): a NEW customer's site starts from this one. The
  //    page creates the customer first (POST /sales/customers, the Add a customer
  //    flow) and sends the new site here. Starter kits do the copying
  //    (agency/kit_io.ts): services, FAQs, voice, colors and industry, fill-only-
  //    empty; and since item 145 the pages too: every section with its words and
  //    copies of its photos, the menu, the look. The old business's name in the
  //    words becomes the new one, and publishing lists whatever is still exactly
  //    as copied until it is changed or kept (lib/site_layout.ts). Business
  //    details, reviews, testimonials, posts and contacts are never copied. ──
  if (what === 'duplicate' && method === 'POST') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    let b: { site_id?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
    const target = String(b.site_id || '');
    if (!UUID_RE.test(target) || target === siteId) return json({ error: 'bad_request', message: 'Send the new site to start.' }, 400, cors);
    const ids = await agencySiteIds(member.agency_id, true);
    if (!ids.includes(siteId) || !ids.includes(target)) return notYours(cors);
    const [src, dst] = await Promise.all([siteId, target].map(async (id) => rowsOf<SiteRow>(await svc(`presence_sites?id=eq.${id}&select=${SITE_COLS}&limit=1`))[0]));
    if (!src || !dst) return notYours(cors);
    if (dst.last_published_at || dst.status === 'live') return json({ error: 'not_new', message: 'Duplicate only starts a new site — that one is already live.' }, 409, cors);
    if (src.edition === 'monitor' || dst.edition === 'monitor') return json({ error: 'hosted_elsewhere', message: 'A site that lives on their own host has no setup here to copy.' }, 409, cors);
    const names = rowsOf<{ id: string; name: string }>(await svc(`clients?id=eq.${src.client_id}&select=id,name&limit=1`).catch(() => null));
    const from = String(names[0]?.name || 'another site').trim();
    const kit = await kitFromSite(src.id);
    kit.layout = await layoutFromSite(src.id, { label: from });
    // a site with no pages of its own still passes on its look
    if (!kit.layout.template_slug) kit.layout.template_slug = src.template_slug || null;
    const applied = await applyKitTo(kit, dst.id, principal, `Started from ${from}’s setup`);
    let look = applied.layout && applied.layout.applied ? applied.layout.look : null;
    if (!look) {
      // the look on its own, when no pages came across: the source's template at its latest version, as Styles would set it
      const version = latestTemplateVersion(src.template_slug);
      const tpl = version ? getTemplate(src.template_slug, version) : null;
      if (tpl && src.template_slug !== dst.template_slug) {
        const w = await svc(`presence_sites?id=eq.${dst.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ template_slug: src.template_slug, template_version: version }) });
        if (w.ok) {
          look = tpl.manifest.name;
          await writeChangeEvent({ siteId: dst.id, entityType: 'settings', entityId: null, action: 'update', summary: `Changed the site’s look to ${tpl.manifest.name}`, principal, provenance: 'human', fields: ['template_slug'] });
        } else applied.skipped.push('the look (that didn’t save)');
      } else if (tpl) look = tpl.manifest.name;
    }
    const pages = applied.layout && applied.layout.applied ? { pages: applied.layout.pages, sections: applied.layout.sections, menu: applied.layout.menu, photos: applied.layout.photos, photos_failed: applied.layout.photos_failed } : null;
    return json({ data: { site_id: dst.id, from_site_id: src.id, look, applied: applied.applied, pages, skipped: applied.skipped } }, 200, cors);
  }

  // ── Keep them as they are (item 145): the studio has looked at what Duplicate
  //    or a template copied onto this site, and it may publish as it is. ──
  if (what === 'copied' && method === 'POST') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    let b: { keep?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
    if (b.keep !== true) return json({ error: 'bad_request', message: 'Say keep: true.' }, 400, cors);
    if (!(await agencySiteIds(member.agency_id)).includes(siteId)) return notYours(cors);
    const rec = await keepCopied(siteId, member.email);
    if (!rec) return json({ error: 'not_found', message: 'Nothing was copied onto this site.' }, 404, cors);
    await writeChangeEvent({ siteId, entityType: 'settings', entityId: null, action: 'update', summary: `Kept the words and photos copied from ${rec.from} as they are`, principal, provenance: 'human' }).catch(() => {});
    return json({ data: { site_id: siteId, copied: { from: rec.from, kept: rec.kept } } }, 200, cors);
  }
  return null;
}
