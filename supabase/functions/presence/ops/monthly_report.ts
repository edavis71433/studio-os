// ── Builder list item 58 (Nov 2026): a monthly report email to clients ────────
// Once a month, for each client site whose studio switched it on, one email to
// the client: visitors and page views, enquiries, the pages people read most,
// what changed (publishes), on the studio's brand, with a line from the studio
// written once. For a watch-plan client this email is most of the relationship.
//
// The setting lives in one reserved JSON row on the CLIENT's site
// (`__monthly_report__`: { enabled, note, last_month, updated_by }), so there is
// no migration; `last_month` is the send-once gate. The numbers come from the
// same reads Analytics and the client view use (presence_visits, aggregateVisits,
// presence_form_submissions, presence_publishes); nothing is estimated. A read
// that fails leaves that part out and says so rather than showing a zero.
//
// Nov 2026 review (files and client findings 1 to 4, server findings 2, 4, 5, 7):
// replies go to the studio's Inbox (the studio's site is the reply home); a client
// who can't be emailed is skipped once for the month and the card says why, never
// retried every tick; the month is CLAIMED before the send with a compare-and-swap
// that writes only the month mark, so two ticks can't both send and a switch
// flipped mid-run stays flipped; switching on marks last month as handled, so the
// first report really is next month's; the visits are read in full pages.
import { svc, svcCount, svcPages } from '../lib/db.ts';
import { aggregateVisits } from '../lib/visits.ts';
import type { VisitRow } from '../lib/visits.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT } from '../lib/email_brand.ts';
import type { EmailBrand } from '../lib/email_brand.ts';
import { sendEmail } from '../commerce/account.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { siteOrigin } from '../lib/site.ts';
import type { SiteRow } from '../lib/site.ts';
import { json } from '../../_shared/http.ts';

export const REPORT_NOTE_MAX = 600;
export const REPORT_SEND_DAYS = 3;   // the report goes out on the 1st, 2nd or 3rd of the month

export const REPORT_MAX_TRIES = 3;   // a send that fails is tried again on the next tick, up to this many times a month

/** What happened to the last month handled: sent, skipped (why), or failed for good. */
export interface ReportResult { month: string; status: 'sent' | 'skipped' | 'failed'; reason: string | null; at: string }
/** `last_month` is the month HANDLED (sent, skipped or given up on), the send-once gate. */
export interface ReportSetting {
  enabled: boolean; note: string; last_month: string | null;
  last_result: ReportResult | null; tries: { month: string; count: number } | null;
  updated_by: string | null; updated_at: string | null;
}
/** Why a client can't be emailed, in the words the card uses. */
export const BLOCK_WORDS: Record<string, string> = {
  no_email: 'there’s no email on their record',
  unsubscribed: 'they unsubscribed from emails',
  bounced: 'emails to them bounce',
};
export interface ReportData {
  month: string;                 // YYYY-MM the report covers
  monthLabel: string;            // "October 2026"
  visitors: number | null; pageviews: number | null; truncated: boolean;
  enquiries: number | null;
  topPages: Array<{ path: string; views: number }>;
  publishes: number | null; lastPublishedAt: string | null;
  address: string;               // the site's address, or ''
  timeZone?: string;             // D7: the site's clock, for the date of the last publish (UTC when absent)
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The stored setting, cleaned. Pure. */
export function normalizeReportSetting(raw: unknown): ReportSetting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    note: typeof r.note === 'string' ? r.note.slice(0, REPORT_NOTE_MAX) : '',
    last_month: typeof r.last_month === 'string' && /^\d{4}-\d{2}$/.test(r.last_month) ? r.last_month : null,
    last_result: normalizeResult(r.last_result),
    tries: r.tries && typeof r.tries === 'object' && typeof (r.tries as any).month === 'string' && Number.isFinite((r.tries as any).count) ? { month: String((r.tries as any).month), count: Math.max(0, Math.floor(Number((r.tries as any).count))) } : null,
    updated_by: typeof r.updated_by === 'string' ? r.updated_by : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}

function normalizeResult(raw: unknown): ReportResult | null {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  if (!r || typeof r.month !== 'string' || !/^\d{4}-\d{2}$/.test(r.month)) return null;
  const status = r.status === 'sent' || r.status === 'skipped' || r.status === 'failed' ? r.status : null;
  if (!status) return null;
  return { month: r.month, status, reason: typeof r.reason === 'string' ? r.reason : null, at: typeof r.at === 'string' ? r.at : '' };
}

/** Pure: the setting after the studio flips the switch or edits the line. Switching
 *  ON marks last month as handled, so nothing goes out until next month's first
 *  days, which is what the card promises (review finding 4). */
export function applyReportChange(cur: ReportSetting, b: { enabled?: unknown; note?: unknown }, who: string | null, nowIso: string, tz = 'UTC'): ReportSetting {
  const next: ReportSetting = { ...cur, updated_by: who || cur.updated_by, updated_at: nowIso };
  if (typeof b.note === 'string') next.note = b.note.slice(0, REPORT_NOTE_MAX);
  if (typeof b.enabled === 'boolean') {
    if (b.enabled && !cur.enabled) {
      const prev = lastMonth(nowIso, tz).month;   // D7: last month on the site's clock, the one the job will look for
      if (!cur.last_month || cur.last_month < prev) next.last_month = prev;
    }
    next.enabled = b.enabled;
  }
  return next;
}

/** Pure: why this address can't get the report, or null. `suppression` is the
 *  do-not-send list's reason for it (opt_out, bounce, complaint), or null. */
export function blockedReason(email: string | null, suppression: string | null): string | null {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'no_email';
  if (!suppression) return null;
  return suppression === 'opt_out' ? 'unsubscribed' : 'bounced';
}

// ── Bug hunt D7 (Nov 10): the month is the site's own, not London's ──
// The month's edges, the first days a report may go, and the date of the last publish
// were all worked out on the UTC clock, so a visit or a publish at 6pm Pacific on October
// 31 counted in November's report, and "the last on …" could name the next day. They now
// follow the site's own time zone (Business details; presence_locations.timezone, Los
// Angeles when none is set, as everywhere else). With no zone given, UTC, as before.
export const REPORT_DEFAULT_TZ = 'America/Los_Angeles';
/** A time zone the clock can use: the one given when it is a real zone, else the default. Pure. */
export function reportZone(tz: unknown, fallback = REPORT_DEFAULT_TZ): string {
  const z = typeof tz === 'string' ? tz.trim() : '';
  if (z) { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { /* not a zone */ } }
  return fallback;
}
/** The wall clock in `tz` at `ms`: year, month (1 to 12), day, and how far it runs ahead of UTC. Pure. */
function zoneClock(ms: number, tz: string): { y: number; m: number; d: number; aheadMs: number } {
  const p: Record<string, number> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms))) {
    if (x.type !== 'literal') p[x.type] = Number(x.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return { y: p.year, m: p.month, d: p.day, aheadMs: wall - Math.floor(ms / 1000) * 1000 };
}
/** The moment the day y-m-d (m from 1) starts in `tz`. Pure. */
function zoneMidnight(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneClock(guess, tz).aheadMs;
  const again = guess - zoneClock(first, tz).aheadMs;   // a clock change between the two guesses
  return again;
}

/** The month before the one `nowIso` is in on the `tz` clock, as YYYY-MM, with its bounds. Pure. */
export function lastMonth(nowIso: string, tz = 'UTC'): { month: string; startIso: string; endIso: string; label: string } {
  const zone = reportZone(tz, 'UTC');
  const { y, m } = zoneClock(Date.parse(nowIso), zone);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const month = `${py}-${String(pm).padStart(2, '0')}`;
  return {
    month,
    startIso: new Date(zoneMidnight(py, pm, 1, zone)).toISOString(),
    endIso: new Date(zoneMidnight(y, m, 1, zone)).toISOString(),
    label: new Date(Date.UTC(py, pm - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}
/** The month `nowIso` is in on the `tz` clock, as YYYY-MM. Pure. */
export function monthNow(nowIso: string, tz = 'UTC'): string {
  const { y, m } = zoneClock(Date.parse(nowIso), reportZone(tz, 'UTC'));
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Is it time to send last month's report to this site? Pure: the first days of a
 *  month on the site's clock, the switch on, and last month not sent yet. */
export function reportDueNow(setting: ReportSetting, nowIso: string, tz = 'UTC'): boolean {
  if (!setting.enabled) return false;
  const day = zoneClock(Date.parse(nowIso), reportZone(tz, 'UTC')).d;
  if (day > REPORT_SEND_DAYS) return false;
  return setting.last_month !== lastMonth(nowIso, tz).month;
}
/** Can it be the first days of a month anywhere? Zones run from 12 hours behind UTC to 14
 *  ahead, so on any other day the monthly job reads nothing at all. Pure. */
export function anyZoneInSendDays(nowIso: string): boolean {
  const ms = Date.parse(nowIso);
  return [-12, 14].some((h) => new Date(ms + h * 3_600_000).getUTCDate() <= REPORT_SEND_DAYS);
}

/** Fold the month's reads into the report's numbers. Pure. */
export function foldReport(i: { month: string; label: string; startMs: number; endMs: number; visits: VisitRow[] | null; enquiries: number | null; publishes: Array<{ created_at: string }> | null; address: string; visitsCap: number; timeZone?: string }): ReportData {
  const inMonth = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) && t >= i.startMs && t < i.endMs; };
  let visitors: number | null = null, pageviews: number | null = null, topPages: ReportData['topPages'] = [], truncated = false;
  if (i.visits) {
    const rows = i.visits.filter((v) => inMonth(String(v.ts)));
    const days = Math.round((i.endMs - i.startMs) / 86_400_000);
    const agg = aggregateVisits(rows, i.endMs, days);
    visitors = agg.visitors; pageviews = agg.pageviews; topPages = agg.topPages.slice(0, 5); truncated = i.visits.length >= i.visitsCap;
  }
  const pubs = i.publishes ? i.publishes.filter((p) => inMonth(p.created_at)) : null;
  const lastPublishedAt = pubs && pubs.length ? pubs.map((p) => p.created_at).sort().slice(-1)[0] : null;
  return { month: i.month, monthLabel: i.label, visitors, pageviews, truncated, enquiries: i.enquiries, topPages, publishes: pubs ? pubs.length : null, lastPublishedAt, address: i.address, ...(i.timeZone ? { timeZone: i.timeZone } : {}) };
}

const n1 = (n: number) => n.toLocaleString('en-US');
const pageName = (p: string) => p === '/' || p === '' ? 'Home page' : p.replace(/^\//, '').replace(/\/$/, '').replace(/[-_]/g, ' ').replace(/\//g, ' › ');

/** The email body (inside the branded shell). Pure. Every line is a sentence; a part
 *  that couldn't be read is said so, never shown as zero. */
export function reportHtml(d: ReportData, o: { studioName: string; note: string; clientName?: string | null }): { subject: string; html: string } {
  const who = (o.clientName || '').trim();
  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b6478">Your website in ${esc(d.monthLabel)}</p>`);
  parts.push(`<h1 style="margin:0 0 14px;font-family:'Iowan Old Style',Palatino,Georgia,serif;font-size:24px;line-height:1.2">${who ? `${esc(who)}, here’s` : 'Here’s'} how your website did${d.address ? ` at <a href="${esc(d.address)}" style="text-decoration:none">${esc(d.address.replace(/^https?:\/\//, ''))}</a>` : ''}.</h1>`);
  if (o.note.trim()) parts.push(`<blockquote style="margin:0 0 18px;padding:12px 16px;border-left:3px solid #d6d4e2;background:#f7f6fb;border-radius:0 10px 10px 0;color:#2b2540">${esc(o.note.trim()).replace(/\n/g, '<br>')}<br><span style="font-size:13px;color:#6b6478">${esc(o.studioName)}</span></blockquote>`);
  const tile = (label: string, value: string, sub: string) => `<td width="50%" style="padding:0 6px 12px 0;vertical-align:top"><div style="background:#f7f6fb;border-radius:12px;padding:14px 16px"><div style="font-size:12px;color:#6b6478">${label}</div><div style="font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:4px 0 2px">${value}</div><div style="font-size:12px;color:#6b6478">${sub}</div></div></td>`;
  const tiles: string[] = [];
  // bug hunt H5: the counter knows a person for one day only, so a month's count is visits
  if (d.visitors === null) tiles.push(tile('Visits', '—', 'We couldn’t read the visit counts this time.'));
  else tiles.push(tile('Visits', n1(d.visitors), `${n1(d.pageviews || 0)} page${(d.pageviews || 0) === 1 ? '' : 's'} viewed${d.truncated ? ', from recent activity' : ''}`));
  if (d.enquiries === null) tiles.push(tile('Enquiries', '—', 'We couldn’t read the enquiries this time.'));
  else tiles.push(tile('Enquiries', n1(d.enquiries), d.enquiries === 0 ? 'No one wrote in through the site' : `${d.enquiries === 1 ? 'Someone' : 'People'} wrote in through your site`));
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tiles.join('')}</tr></table>`);
  if (d.topPages.length) {
    parts.push(`<p style="margin:10px 0 6px"><strong>What people read most</strong></p><ol style="margin:0 0 14px;padding-left:20px">${d.topPages.map((p) => `<li>${esc(pageName(p.path))} <span style="color:#6b6478">· ${n1(p.views)} view${p.views === 1 ? '' : 's'}</span></li>`).join('')}</ol>`);
  } else if (d.visitors !== null && d.visitors === 0) {
    parts.push(`<p style="margin:10px 0 14px">A quiet month for visitors. ${esc(o.studioName)} can help bring people in; just reply to this email.</p>`);
  }
  if (d.publishes === null) parts.push(`<p style="margin:10px 0 14px"><strong>What changed:</strong> we couldn’t read the publish history this time.</p>`);
  else if (d.publishes === 0) parts.push(`<p style="margin:10px 0 14px"><strong>What changed:</strong> nothing was published this month. Your site stayed as it was.</p>`);
  else parts.push(`<p style="margin:10px 0 14px"><strong>What changed:</strong> ${d.publishes === 1 ? 'one update went live' : `${n1(d.publishes)} updates went live`}${d.lastPublishedAt ? `, the last on ${new Date(d.lastPublishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: reportZone(d.timeZone, 'UTC') })}` : ''}.</p>`);
  parts.push(`<p style="margin:16px 0 0;font-size:13px;color:#6b6478">Sent once a month by ${esc(o.studioName)}. Reply to this email to reach us.</p>`);
  return { subject: `Your website in ${d.monthLabel}`, html: parts.join('') };
}

const VISITS_PAGE = 1000, VISITS_PAGES = 50;   // every page or none (lib/db.ts svcPages); 50,000 visits a month at most
/** The month's reads for one site. Each part is best-effort on its own. */
export async function loadReportData(site: SiteRow, win: { month: string; startIso: string; endIso: string; label: string }, timeZone?: string): Promise<ReportData> {
  const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
  const [vq, enq, pq] = await Promise.all([
    safe(svcPages(`presence_visits?site_id=eq.${site.id}&ts=gte.${win.startIso}&ts=lt.${win.endIso}&kind=not.in.(button,leave)&select=ts,kind,path,ref_host,utm_source,device,country,visitor_hash`, 'ts', VISITS_PAGE, VISITS_PAGES)),
    safe(svcCount(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&created_at=gte.${win.startIso}&created_at=lt.${win.endIso}`)),
    safe(svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&created_at=gte.${win.startIso}&created_at=lt.${win.endIso}&select=created_at&limit=500`)),
  ]);
  const rows = <T,>(q: unknown): T[] | null => (q && (q as { ok?: boolean }).ok && Array.isArray((q as { json?: unknown }).json)) ? (q as { json: T[] }).json : null;
  const visits = vq ? (vq.rows as VisitRow[]) : null;
  return foldReport({ month: win.month, label: win.label, startMs: Date.parse(win.startIso), endMs: Date.parse(win.endIso), visits, enquiries: typeof enq === 'number' ? enq : null, publishes: rows<{ created_at: string }>(pq), address: siteOrigin(site), visitsCap: vq?.truncated ? (visits || []).length : Number.MAX_SAFE_INTEGER, timeZone });
}

/** The studio that looks after this client site (the active service link): its brand,
 *  and the reply home, so a client's reply lands in the studio's Inbox. */
async function studioSiteOf(siteId: string): Promise<string | null> {
  try {
    const l = await svc(`presence_service_links?customer_site_id=eq.${siteId}&status=eq.active&select=agency_site_id&order=created_at.desc&limit=1`);
    return Array.isArray(l.json) && l.json[0]?.agency_site_id ? String(l.json[0].agency_site_id) : null;
  } catch { return null; }
}
async function clientOf(site: SiteRow): Promise<{ email: string | null; name: string | null }> {
  if (!site.client_id) return { email: null, name: null };
  const c = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email,name&limit=1`).catch(() => ({ json: [] as unknown[] }));
  const row = (Array.isArray(c.json) ? c.json[0] : null) as { email?: string; name?: string } | null;
  return { email: row?.email ? String(row.email).trim() : null, name: row?.name || null };
}
/** The client's address, their name, and why they can't be emailed (or null). Read
 *  before anything else, so a client who can't be reached costs two small reads. */
export async function reachOf(site: SiteRow): Promise<{ email: string | null; name: string | null; blocked: string | null }> {
  const c = await clientOf(site);
  let suppression: string | null = null;
  if (c.email) { const { suppressionOf } = await import('../routes/email_infra.ts'); suppression = await suppressionOf(c.email).catch(() => null); }
  return { ...c, blocked: blockedReason(c.email, suppression) };
}

/** D7: each site's own time zone (Business details), Los Angeles when none is set or the read fails. */
export async function zonesOf(siteIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(siteIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const r = await svc(`presence_locations?site_id=in.(${ids.slice(i, i + 100).join(',')})&select=site_id,timezone`).catch(() => null);
    for (const row of (r && r.ok && Array.isArray(r.json) ? r.json : []) as Array<{ site_id: string; timezone?: string }>) if (!out.has(String(row.site_id))) out.set(String(row.site_id), reportZone(row.timezone));
  }
  for (const id of ids) if (!out.has(id)) out.set(id, REPORT_DEFAULT_TZ);
  return out;
}
const zoneOfSite = async (siteId: string): Promise<string> => (await zonesOf([siteId])).get(siteId) || REPORT_DEFAULT_TZ;

export async function readReportSetting(siteId: string): Promise<ReportSetting> {
  return normalizeReportSetting(await readReservedJson(siteId, RESERVED_NAMES.monthlyReport));
}

/** Compose and send one site's report for a window, to `to`. Replies belong to the
 *  STUDIO's site: the reply door (routes/inbound_email.ts) admits a client only
 *  through their link to the studio, so a reply address built from the client's
 *  own site id would drop every reply as unknown (review finding 1). */
export async function sendReport(site: SiteRow, win: ReturnType<typeof lastMonth>, setting: ReportSetting, to: string, opts: { preview?: boolean; clientName?: string | null; timeZone?: string } = {}): Promise<boolean> {
  const studio = await studioSiteOf(site.id);
  const [data, brand] = await Promise.all([loadReportData(site, win, opts.timeZone), studio ? loadEmailBrand(studio) : Promise.resolve(EMAIL_BRAND_DEFAULT)]);
  const { subject, html } = reportHtml(data, { studioName: brand.name, note: setting.note, clientName: opts.clientName ?? null });
  return await sendEmail(to, opts.preview ? `[Preview] ${subject}` : subject, html, brand, { siteId: studio || site.id, asBusiness: true });   // sales item 92: from the studio, in its name
}

/** Thrown inside a claim when the month is no longer due, so nothing is written. */
class NotDue extends Error {}
const SAVE = (siteId: string, change: (s: ReportSetting) => ReportSetting) =>
  updateReservedJson(siteId, RESERVED_NAMES.monthlyReport, (cur) => change(normalizeReportSetting(cur)), 'monthly-report');

/** Pure: what to record after a send that failed. Under the cap the month is let
 *  go again (tried on the next tick); at the cap it is handled, as failed. */
export function afterFailure(s: ReportSetting, month: string, before: string | null, nowIso: string): ReportSetting {
  const count = (s.tries && s.tries.month === month ? s.tries.count : 0) + 1;
  if (count >= REPORT_MAX_TRIES) return { ...s, last_month: month, tries: { month, count }, last_result: { month, status: 'failed', reason: 'send_failed', at: nowIso } };
  return { ...s, last_month: s.last_month === month ? before : s.last_month, tries: { month, count } };
}

/** The monthly job: on the first days of a month, every switched-on client site that
 *  hasn't had last month handled yet. Each month is CLAIMED first (a compare-and-swap
 *  on the setting that writes only the month mark), then sent; a client who can't be
 *  emailed is marked skipped once, with the reason, and is not a failure. */
export async function runMonthlyReports(limit = 20, nowIso = new Date().toISOString()): Promise<{ sent: number; skipped: number; unreachable: number; failures: number; not_due?: boolean }> {
  // D7: each site's month turns on its own clock; on a day no clock is in its first days, read nothing
  if (!anyZoneInSendDays(nowIso)) return { sent: 0, skipped: 0, unreachable: 0, failures: 0, not_due: true };
  const q = await svc(`presence_sales_templates?kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.monthlyReport)}&deleted_at=is.null&select=site_id,body&limit=${Math.max(1, Math.min(200, limit * 5))}`);
  const rows = (Array.isArray(q.json) ? q.json : []) as Array<{ site_id: string; body: string }>;
  const zones = rows.length ? await zonesOf(rows.map((r) => String(r.site_id))) : new Map<string, string>();
  let sent = 0, skipped = 0, unreachable = 0, failures = 0;
  for (const r of rows) {
    if (sent >= limit) break;
    let seen: ReportSetting; try { seen = normalizeReportSetting(JSON.parse(r.body)); } catch { skipped++; continue; }
    const tz = zones.get(String(r.site_id)) || REPORT_DEFAULT_TZ;
    if (!reportDueNow(seen, nowIso, tz)) { skipped++; continue; }
    const win = lastMonth(nowIso, tz);
    const sq = await svc(`presence_sites?id=eq.${r.site_id}&select=*&limit=1`);
    const site = (Array.isArray(sq.json) ? sq.json[0] : null) as SiteRow | null;
    if (!site) { skipped++; continue; }
    const reach = await reachOf(site);
    // claim the month: only if it is still due on the LATEST setting; only the month mark (and, for a client who can't be emailed, the reason) changes
    let before: string | null = null, claimedSetting: ReportSetting | null = null;
    const claimed = await SAVE(site.id, (s) => {
      if (!reportDueNow(s, nowIso, tz)) throw new NotDue();
      before = s.last_month;
      const next: ReportSetting = { ...s, last_month: win.month };
      if (reach.blocked) next.last_result = { month: win.month, status: 'skipped', reason: reach.blocked, at: nowIso };
      claimedSetting = next;
      return next;
    }).catch(() => null);
    if (!claimed || !claimedSetting) { skipped++; continue; }   // another tick has it, it was switched off, or the save failed: nothing sent
    if (reach.blocked) { unreachable++; continue; }
    const ok = await sendReport(site, win, claimedSetting, reach.email as string, { clientName: reach.name, timeZone: tz }).catch(() => false);
    if (ok) {
      sent++;
      await SAVE(site.id, (s) => ({ ...s, tries: null, last_result: { month: win.month, status: 'sent', reason: null, at: nowIso } })).catch(() => null);
    } else {
      failures++;
      await SAVE(site.id, (s) => afterFailure(s, win.month, before, nowIso)).catch(() => null);
    }
  }
  return { sent, skipped, unreachable, failures };
}

// ── the site-scoped routes: GET and PUT /report/monthly, POST /report/monthly/preview ──
export async function handleReportGet(site: SiteRow, cors: Record<string, string>) {
  const [s, reach, tz] = await Promise.all([readReportSetting(site.id), reachOf(site).catch(() => null), zoneOfSite(site.id)]);
  return json({ data: { ...s, note_max: REPORT_NOTE_MAX, next_month: monthNow(new Date().toISOString(), tz), blocked: reach ? reach.blocked : null } }, 200, cors);   // this month's report goes out in the first days of next month
}
export async function handleReportPut(req: Request, site: SiteRow, principal: { email?: string | null }, cors: Record<string, string>) {
  let b: { enabled?: unknown; note?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
  if (typeof b.enabled !== 'boolean' && typeof b.note !== 'string') return json({ error: 'bad_request', message: 'Say whether the report is on, or give the line to send with it.' }, 400, cors);
  // switching on for a client who can't be emailed would promise a report that never goes (review finding 2)
  if (b.enabled === true) {
    const reach = await reachOf(site).catch(() => null);
    if (reach?.blocked) return json({ error: 'cannot_send', blocked: reach.blocked, message: `It can’t go out: ${BLOCK_WORDS[reach.blocked] || 'they can’t be emailed'}.${reach.blocked === 'no_email' ? ' Add their email on their record, then switch it on.' : ''}` }, 409, cors);
  }
  const nowIso = new Date().toISOString();
  const tz = typeof b.enabled === 'boolean' ? await zoneOfSite(site.id) : 'UTC';   // only switching on reads the clock
  const next = await updateReservedJson(site.id, RESERVED_NAMES.monthlyReport, (cur) => applyReportChange(normalizeReportSetting(cur), b, principal.email || null, nowIso, tz), principal.email || 'studio');
  if (!next) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
  return json({ data: next }, 200, cors);
}
/** A preview of last month's report to the caller, now. */
export async function handleReportPreview(site: SiteRow, principal: { email?: string | null }, cors: Record<string, string>) {
  if (!principal.email) return json({ error: 'bad_request', message: 'Your sign-in has no email to send the preview to.' }, 400, cors);
  const [setting, client, tz] = await Promise.all([readReportSetting(site.id), clientOf(site), zoneOfSite(site.id)]);
  const ok = await sendReport(site, lastMonth(new Date().toISOString(), tz), setting, principal.email, { preview: true, clientName: client.name, timeZone: tz }).catch(() => false);
  if (!ok) return json({ error: 'fetch_failed', message: 'The preview didn’t send. Check that email sending is set up, then try again.' }, 502, cors);
  return json({ data: { sent_to: principal.email } }, 200, cors);
}
