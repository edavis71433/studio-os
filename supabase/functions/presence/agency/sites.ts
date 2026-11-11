// ── The studio's Sites and Domains (builder list items 43, 45 and 52, Nov 2026) ─
// Squarespace's all-sites dashboard and Wix's Sites table, on our own rows: every
// client site as a card (a live thumbnail, the address, its status, the plan and
// when it renews, who can edit) and as a table (Name · Team · Plan · Published ·
// Last updated · Tags), pinned sites first, then the ones you opened last; every
// domain in one list (status, provider, expiry); Pin and Duplicate on each site's
// menu. Item 135 (Nov 10): + New site makes a site from a business name and,
// if picked, a starter kit, with nobody emailed; Invite the owner is the later
// step that gives the owner a login and makes them a customer.
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
import { registryWarnings, sameCompany, whereToGo } from '../lib/rdap.ts';
import { DOWN_THRESHOLD } from '../monitor/heartbeat.ts';
import { readReservedJson, updateReservedJson, writeReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
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
import type { KitPayload } from '../lib/kits.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';
import { normalizeCopied } from '../lib/site_layout.ts';
import { keepCopied } from '../lib/copied_record.ts';
import { claimPortfolioSite } from '../lib/connect_requests.ts';
import { attachOwnerLogin, validEmail } from '../commerce/account.ts';
import type { AttachOwnerError } from '../commerce/account.ts';
import { provisionCustomerAccount, bridgeCustomerToStudio, ensureConnectContact, linkContactToCustomer, sendCustomerInvite } from '../routes/sales.ts';

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
export interface OwnerRow { id: string; name?: string | null; email?: string | null; contact_email?: string | null; contact_id?: string | null }
/** Item 135: does this client have an owner who can sign in? A site made with
 *  "+ New site" has none until Invite the owner: no email on the client row and
 *  no linked contact (the two ways my_client_ids() finds a client). Pure. */
export function hasOwner(c: OwnerRow | null | undefined): boolean {
  return !!c && !!(String(c.email || '').trim() || String(c.contact_email || '').trim() || c.contact_id);
}
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
  if (i.owner && !i.portalClient && hasOwner(i.owner)) {
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
      // item 135: made with + New site and nobody invited yet (only said when the client was read)
      no_owner: ownerBy.has(clientId) && !hasOwner(ownerBy.get(clientId)),
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
  /** item 134 (findings 3, 5): what the domain shows (latest · old_copy · other · unreachable), and the checklist */
  domain_serving?: string | null; domain_checks?: Array<{ key: string; ok: boolean; words: string }> | null;
  /** item 162 (0162): the transfer lock, who runs the DNS, the registry's status words, since when */
  domain_lock?: boolean | null; domain_dns_host?: string | null; domain_statuses?: string[] | null; domain_registered_at?: string | null;
}
export type DomainTone = 'good' | 'warn' | 'bad' | 'quiet';
/** One domain's status in a few words. Expiry first, on the same 30-day line as
 *  Needs you (needs_you.ts), then what the domain is doing for the site. Pure. */
export function domainStatus(d: DomainIn, nowIso: string): { key: string; words: string; tone: DomainTone; days_left: number | null } {
  const days = daysBetween(nowIso, d.domain_expires_at);
  const is = (key: string, words: string, tone: DomainTone) => ({ key, words, tone, days_left: days });
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  // item 162 (review domains finding 6): the registry's own words beat our dates (a lapsed .com's date can jump a year ahead)
  const st = Array.isArray(d.domain_statuses) ? d.domain_statuses : [];
  if (st.includes('pending delete')) return is('registry', 'About to be deleted', 'bad');
  if (st.includes('redemption period')) return is('registry', 'In the redemption period', 'bad');
  if (st.includes('client hold') || st.includes('server hold')) return is('registry', 'On hold at the registry', 'bad');
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
  // item 134 (review findings 3 and 5): "Connected" needs the domain to show OUR latest site
  if (d.edition !== 'monitor' && d.domain_serving === 'old_copy') return is('old_copy', 'Showing an old copy', 'bad');
  if (d.edition !== 'monitor' && d.domain_serving === 'other') return is('other_site', 'Showing something else', 'bad');
  if (d.edition !== 'monitor' && Array.isArray(d.domain_checks) && d.domain_checks.some((c) => c && c.ok === false && c.key !== 'serving')) return is('partly', 'Not fully set up', 'warn');
  if (d.domain_serving === 'latest') return is('connected', 'Connected', 'good');
  if (d.uptime_ok === true) return is('connected', 'Connected', 'good');
  return is('checking', 'Not checked yet', 'quiet');
}
/** Every custom domain with its status, provider and expiry, the most urgent
 *  first; and the hosted sites still on their built-in address. Pure. */
export function buildDomains(rows: DomainIn[], nowIso: string) {
  const RANK: Record<string, number> = { registry: 0, expired: 1, down: 2, old_copy: 3, other_site: 4, expiring: 5, padlock: 6, partly: 7, offline: 8, checking: 9, not_live: 10, elsewhere: 11, connected: 12 };
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
      checks: r.edition !== 'monitor' && Array.isArray(r.domain_checks) ? r.domain_checks.filter((c) => c && typeof c.words === 'string').map((c) => ({ ok: c.ok === true, words: c.words })) : [],   // item 134: what was checked, for the row
      // item 162: who runs the DNS (when it isn't the seller), the lock, and what the registry's words mean
      dns_host: r.domain_dns_host && !sameCompany(r.domain_dns_host, r.domain_registrar) ? r.domain_dns_host : '',
      lock: typeof r.domain_lock === 'boolean' ? r.domain_lock : null,
      warnings: registryWarnings(Array.isArray(r.domain_statuses) ? { lock: typeof r.domain_lock === 'boolean' ? r.domain_lock : null, statuses: r.domain_statuses } : null),   // { key, severity, words }
      registered_at: r.domain_registered_at || null,
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
const DOMAIN_COLS = `${EXTRA_COLS},domain_lookup_status,cert_expires_at,cert_pending_since,domain_serving,domain_checks,domain_lock,domain_dns_host,domain_statuses,domain_registered_at`;   // domain_serving, domain_checks: 0153; domain_lock…domain_registered_at: 0162

// ── one domain's side panel (item 162) ──
export const CHECK_NOW_GAP_MS = 60_000;   // "Check now" at most once a minute per domain
export interface DomainNotes { account: string; renews: 'yes' | 'no' | 'unknown'; renews_confirmed_at: string | null; note: string; updated_by?: string | null; updated_at?: string | null }
/** Pure: the studio's notes on a domain, cleaned (review domains finding 10): whose account it
 *  is in, whether it renews by itself (and when that was confirmed), and a free note. */
export function normalizeDomainNotes(raw: unknown): DomainNotes {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const renews = r.renews === 'yes' || r.renews === 'no' ? r.renews : 'unknown';
  const conf = typeof r.renews_confirmed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.renews_confirmed_at) ? r.renews_confirmed_at : null;
  return {
    account: typeof r.account === 'string' ? r.account.trim().slice(0, 120) : '',
    renews, renews_confirmed_at: renews === 'unknown' ? null : conf,
    note: typeof r.note === 'string' ? r.note.trim().slice(0, 600) : '',
    updated_by: typeof r.updated_by === 'string' ? r.updated_by : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'] as const;   // the order the panel lists them in

/** Pure: mail on the domain in one line (review domains finding 23), from its MX and TXT
 *  records and the _dmarc name's TXT. */
export function mailHealth(mx: string[], txt: string[], dmarcTxt: string[]) {
  const spf = txt.some((v) => /^v=spf1\b/i.test(v)), dmarc = dmarcTxt.some((v) => /^v=dmarc1\b/i.test(v));
  const missing = [!spf && 'no SPF record', !dmarc && 'no DMARC record'].filter(Boolean) as string[];
  return { has_mail: mx.length > 0, spf, dmarc,
    words: !mx.length ? 'No email runs on this domain.' : !missing.length ? 'Email runs here and is protected: SPF and DMARC are both set.' : `Email runs here but isn’t fully protected: ${missing.join(' and ')}.` };
}
const RUNG_WORDS: Record<string, string> = { '30': '30-day', '15': '15-day', '7': '7-day', '1': '1-day', expired: 'After-expiry' };
/** Pure: the domain's story, newest first (finding 23): attached, changed, removed and by
 *  whom, and each expiry reminder that went out. */
export function domainHistory(events: Array<{ action?: string; summary?: string; actor_kind?: string; created_at?: string }>, reminders: Array<{ period?: string; created_at?: string }>, own: boolean) {
  const who = (k?: string) => k === 'system' ? 'automatically' : k === 'operator' ? 'by your studio' : k === 'staff' ? 'by Studio OS' : own ? 'by your studio' : 'by the client';
  const out: Array<{ at: string; words: string }> = [];
  for (const e of events) if (e.created_at && e.summary) out.push({ at: e.created_at, words: `${e.summary}, ${who(e.actor_kind)}` });
  for (const n of reminders) {
    const rung = String(n.period || '').split(':').pop() || '';
    if (n.created_at && RUNG_WORDS[rung]) out.push({ at: n.created_at, words: `${RUNG_WORDS[rung]} reminder sent${own ? '' : ' to the client and you'}` });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 8);
}
/** Everything the side panel shows for one domain: the row, the registry's facts, the
 *  checklist, every record live (finding 24: the client's card stops at six), and the notes. */
async function domainDetail(siteId: string, nowIso: string) {
  const row = rowsOf<DomainIn & { id: string; domain_registered_name?: string | null; netlify_site_id?: string | null }>(
    await svc(`presence_sites?id=eq.${siteId}&select=${DOMAIN_COLS},edition,status,last_published_at,custom_domain,domain_registrar,domain_expires_at,domain_registered_name&limit=1`).catch(() => ({ ok: false, json: [] })))[0];   // client_id comes with EXTRA_COLS
  if (!row || !row.custom_domain) return null;
  const ident = rowsOf<{ business_name?: string }>(await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => ({ ok: false, json: [] })))[0];
  const built = buildDomains([{ ...row, site_id: siteId, name: String(ident?.business_name || 'This site') }], nowIso).domains[0];
  const { dnsRecords, twinName } = await import('../lib/domain_health.ts');
  const names = [row.custom_domain, twinName(row.custom_domain, row.domain_registered_name || null)].filter(Boolean) as string[];
  const records: Array<{ name: string; type: string; value: string }> = [];
  await Promise.all(names.flatMap((n) => RECORD_TYPES.map(async (t) => { for (const v of await dnsRecords(n, t)) records.push({ name: n, type: t, value: v }); })));
  records.sort((a, b) => a.name.localeCompare(b.name) || RECORD_TYPES.indexOf(a.type as typeof RECORD_TYPES[number]) - RECORD_TYPES.indexOf(b.type as typeof RECORD_TYPES[number]) || a.value.localeCompare(b.value));
  const statuses = Array.isArray(row.domain_statuses) ? row.domain_statuses : [];
  // item 162 (finding 23): mail on the registered name, and the domain's story
  const bare = row.domain_registered_name || (row.custom_domain.startsWith('www.') ? row.custom_domain.slice(4) : row.custom_domain);
  const clientId = (row as { client_id?: string | null }).client_id || null;
  const [mx, txt, dmarcTxt, evQ, ntQ] = await Promise.all([
    dnsRecords(bare, 'MX'), dnsRecords(bare, 'TXT'), dnsRecords(`_dmarc.${bare}`, 'TXT'),
    svc(`presence_change_events?site_id=eq.${siteId}&entity_type=eq.domain&select=action,summary,actor_kind,created_at&order=created_at.desc&limit=6`).catch(() => ({ ok: false, json: [] })),
    clientId ? svc(`presence_plan_notices?client_id=eq.${encodeURIComponent(clientId)}&kind=eq.domain_expiry&period=like.${encodeURIComponent(`exp:${row.custom_domain}:%`)}&select=period,created_at&order=created_at.desc&limit=6`).catch(() => ({ ok: false, json: [] })) : Promise.resolve({ ok: true, json: [] }),
  ]);
  return {
    ...built,
    dns_host_full: row.domain_dns_host || '',   // the row's dns_host is blank when it's the seller; the panel names it either way
    where: whereToGo(row.domain_registrar, row.domain_dns_host),   // findings 6 and 7: records at the DNS company, renewal at the seller (not `provider`: the row's seller name)
    mail: mailHealth(mx, txt, dmarcTxt),
    history: domainHistory(rowsOf(evQ), rowsOf(ntQ), built.own === true),
    statuses, all_checks: Array.isArray(row.domain_checks) ? row.domain_checks : [],
    records, notes: normalizeDomainNotes(await readReservedJson(siteId, RESERVED_NAMES.domainNotes)),
  };
}

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
      clientIds.length ? svc(`clients?id=in.(${clientIds.join(',')})&select=id,name,email,contact_email,contact_id&limit=1000`).catch(soft) : none,
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
    const manage = can(member.role, 'manage_clients');
    return json({ data: rows, partial, can_open: canOpen, can_pin: pins.own, can_duplicate: manage, can_create: manage }, 200, cors);
  }

  // ── + New site (item 135): a site from a business name and, if picked, one of
  //    the studio's starter kits. Nobody is emailed and nobody gets a login: the
  //    client record has no owner until Invite the owner (below). The site joins
  //    the studio's portfolio, so Sites, Home and the doors into it work; it joins
  //    the studio's customers when its owner is invited. The account and the site
  //    are made the one way every customer's are (routes/sales.ts
  //    provisionCustomerAccount, no email: "a studio-managed workspace"). ──
  if (route === '/agency/sites' && method === 'POST') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    let b: { business_name?: unknown; kit_id?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
    const name = String(b.business_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) return json({ error: 'bad_request', message: 'Name the business.' }, 400, cors);
    const kitId = b.kit_id == null || b.kit_id === '' ? '' : String(b.kit_id);
    if (kitId && !UUID_RE.test(kitId)) return json({ error: 'not_found', message: 'That starter kit isn’t one of yours.' }, 404, cors);
    const links = rowsOf<{ site_id: string }>(await svc(`presence_agency_clients?agency_id=eq.${member.agency_id}&select=site_id&limit=1000`));
    if (links.length >= member.client_limit) return json({ error: 'client_limit', message: `The plan covers ${member.client_limit} clients — the limit can grow with the plan.` }, 400, cors);
    // the kit is checked before anything is made, so a wrong one makes nothing
    const kit = kitId ? rowsOf<{ name: string; payload: KitPayload }>(await svc(`presence_starter_kits?id=eq.${kitId}&agency_id=eq.${member.agency_id}&select=name,payload&limit=1`))[0] : null;
    if (kitId && !kit) return json({ error: 'not_found', message: 'That starter kit isn’t one of yours.' }, 404, cors);
    const acct = await provisionCustomerAccount({ email: '', businessName: name, plan: 'presence', actorEmail: member.email });
    if (!acct.ok || !acct.clientId || !acct.siteId) return json({ error: acct.error || 'provision_incomplete', message: acct.message || 'We couldn’t make the site just now — please try again.' }, acct.httpStatus || 502, cors);
    const claim = await claimPortfolioSite(member.agency_id, acct.siteId, '');
    if (claim !== 'linked' && claim !== 'already') {
      await svc(`clients?id=eq.${acct.clientId}`, { method: 'DELETE' }).catch(() => {});   // nothing lingers: the site and its plan go with the client
      return json({ error: 'write_failed', message: 'The site didn’t save — please try again.' }, 502, cors);
    }
    // the kit, on its own: a kit that won't apply never undoes the site (the page offers it again)
    let kitOut: { id: string; name: string; applied?: Record<string, unknown>; skipped?: string[]; failed?: boolean } | null = null;
    if (kit) {
      // a template (item 145) brings pages too: its copied words and photos are recorded under its name, as Apply does
      const tpl = !!kit.payload.layout;
      try { kitOut = { id: kitId, name: kit.name, ...(await applyKitTo(kit.payload, acct.siteId, principal, `Started from the “${kit.name}” ${tpl ? 'template' : 'starter kit'}`, tpl ? { label: `your “${kit.name}” template` } : {})) }; }
      catch { kitOut = { id: kitId, name: kit.name, failed: true }; }
    }
    return json({ data: { site_id: acct.siteId, client_id: acct.clientId, name, kit: kitOut } }, 201, cors);
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

  // ── one domain: the side panel, the studio's notes, and "Check now" (item 162, review domains
  //    findings 9, 10, 23 and 24). A client of this studio's, or the studio's own site. ──
  {
    const dm = route.match(/^\/agency\/domains\/([0-9a-f-]{36})(?:\/(notes|check))?$/);
    if (dm) {
      const siteId = dm[1], what = dm[2] || '';
      if (!can(member.role, 'read')) return forbid(cors);
      const own = await deps.ownSite().catch(() => null);
      if (!(own && own.id === siteId) && !(await agencySiteIds(member.agency_id)).includes(siteId)) return notYours(cors);
      if (what === 'notes' && method === 'PUT') {
        if (!can(member.role, 'manage_clients')) return forbid(cors);
        let b: unknown = null; try { b = await req.json(); } catch { /* answered below */ }
        if (!b || typeof b !== 'object') return json({ error: 'bad_request', message: 'Send the notes to save.' }, 400, cors);
        const next = { ...normalizeDomainNotes(b), updated_by: member.email || null, updated_at: now };
        const ok = await writeReservedJson(siteId, RESERVED_NAMES.domainNotes, next, member.email || 'studio');
        if (!ok) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
        return json({ data: next }, 200, cors);
      }
      if (what === 'check' && method === 'POST') {
        const sq = rowsOf<{ id: string; client_id: string; custom_domain: string | null; netlify_site_id: string | null; edition: string | null; cert_pending_since: string | null; domain_checked_at: string | null }>(
          await svc(`presence_sites?id=eq.${siteId}&select=id,client_id,custom_domain,netlify_site_id,edition,cert_pending_since,domain_checked_at&limit=1`))[0];
        if (!sq || !sq.custom_domain) return json({ error: 'no_domain', message: 'This site has no domain of its own to check.' }, 409, cors);
        const since = sq.domain_checked_at ? Date.parse(now) - Date.parse(sq.domain_checked_at) : Infinity;
        if (since < CHECK_NOW_GAP_MS) return json({ error: 'too_soon', message: 'Checked a moment ago. Give it a minute before checking again.' }, 429, cors);
        await (await import('../commerce/lifecycle.ts')).checkOneDomain({ ...sq, custom_domain: sq.custom_domain }, now);
        const detail = await domainDetail(siteId, now);
        return detail ? json({ data: detail }, 200, cors) : notYours(cors);
      }
      if (what === '' && method === 'GET') {
        const detail = await domainDetail(siteId, now);
        return detail ? json({ data: detail }, 200, { ...cors, 'Cache-Control': 'no-store' }) : notYours(cors);
      }
      return null;
    }
  }

    const m = route.match(/^\/agency\/sites\/([0-9a-f-]{36})\/(thumb|pin|duplicate|copied|invite)$/);
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

  // ── Invite the owner (item 135): the later, separate step for a site made with
  //    + New site. Their login (commerce/account.ts attachOwnerLogin), then what
  //    Add a customer does for a new customer: the studio's project and portal
  //    link, the person in the studio's contacts, and the sign-in email on the
  //    studio's brand. An email that already has an account is refused, never
  //    attached. Nothing on the site changes and nothing is published. ──
  if (what === 'invite' && method === 'POST') {
    if (!can(member.role, 'manage_clients')) return forbid(cors);
    let b: { email?: unknown; name?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
    const email = String(b.email ?? '').trim().toLowerCase().slice(0, 160);
    const person = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!validEmail(email)) return json({ error: 'validation', message: 'Enter their email — that’s where the sign-in link goes.' }, 422, cors);
    if (!(await agencySiteIds(member.agency_id)).includes(siteId)) return notYours(cors);
    const site = rowsOf<{ id: string; client_id: string | null }>(await svc(`presence_sites?id=eq.${siteId}&select=id,client_id&limit=1`))[0];
    const client = site?.client_id ? rowsOf<OwnerRow>(await svc(`clients?id=eq.${site.client_id}&select=id,name,email,contact_email,contact_id&limit=1`))[0] : null;
    if (!client) return notYours(cors);
    if (hasOwner(client)) return json({ error: 'has_owner', message: 'This site already has an owner.' }, 409, cors);
    const own = await deps.ownSite();
    if (!own) return json({ error: 'no_studio_site', message: 'Invitations go out from your studio’s own site, and this sign-in doesn’t have one.' }, 409, cors);
    const login = await attachOwnerLogin(client.id, email, person || String(client.name || ''));
    if (!login.ok) return inviteRefused(login.error, cors);
    const label = String(client.name || '').trim() || 'New customer';
    // best-effort from here, as in Add a customer: the login is the truth
    await bridgeCustomerToStudio({ agencySiteId: own.id, clientId: client.id, customerSiteId: siteId, label }).catch(() => null);
    const ct = await ensureConnectContact(own.id, email, person, false).catch(() => null);
    await linkContactToCustomer(own.id, ct?.id, client.id).catch(() => {});
    await svc(`presence_agency_clients?site_id=eq.${siteId}&agency_id=eq.${member.agency_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ owner_email: email }) }).catch(() => null);
    const invited = await sendCustomerInvite(own.id, email, true).catch(() => false);
    await writeChangeEvent({ siteId: own.id, entityType: 'client', entityId: client.id, action: 'invite', summary: `Invited the owner of ${label}`, principal, provenance: 'human' }).catch(() => {});
    return json({ data: { site_id: siteId, email, invited } }, 200, cors);
  }
  return null;
}

const REFUSED: Record<AttachOwnerError, [number, string]> = {
  account_exists: [409, 'That email already has a Studio OS account, so it can’t be a new owner here. Use another address for this business.'],
  has_owner: [409, 'This site already has an owner.'],
  auth_failed: [502, 'We couldn’t set up their sign-in just now — please try again.'],
  contact_failed: [502, 'We couldn’t set up their sign-in just now — please try again.'],
};
function inviteRefused(error: AttachOwnerError, cors: Record<string, string>): Response {
  const [status, message] = REFUSED[error];
  return json({ error, message }, status, cors);
}
