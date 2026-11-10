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
import { svc, svcCount } from '../lib/db.ts';
import { aggregateVisits } from '../lib/visits.ts';
import type { VisitRow } from '../lib/visits.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT } from '../lib/email_brand.ts';
import type { EmailBrand } from '../lib/email_brand.ts';
import { sendEmail } from '../commerce/account.ts';
import { readReservedJson, writeReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { siteOrigin } from '../lib/site.ts';
import type { SiteRow } from '../lib/site.ts';
import { json } from '../../_shared/http.ts';

export const REPORT_NOTE_MAX = 600;
export const REPORT_SEND_DAYS = 3;   // the report goes out on the 1st, 2nd or 3rd of the month

export interface ReportSetting { enabled: boolean; note: string; last_month: string | null; updated_by: string | null; updated_at: string | null }
export interface ReportData {
  month: string;                 // YYYY-MM the report covers
  monthLabel: string;            // "October 2026"
  visitors: number | null; pageviews: number | null; truncated: boolean;
  enquiries: number | null;
  topPages: Array<{ path: string; views: number }>;
  publishes: number | null; lastPublishedAt: string | null;
  address: string;               // the site's address, or ''
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The stored setting, cleaned. Pure. */
export function normalizeReportSetting(raw: unknown): ReportSetting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    note: typeof r.note === 'string' ? r.note.slice(0, REPORT_NOTE_MAX) : '',
    last_month: typeof r.last_month === 'string' && /^\d{4}-\d{2}$/.test(r.last_month) ? r.last_month : null,
    updated_by: typeof r.updated_by === 'string' ? r.updated_by : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}

/** The month before the one `nowIso` is in, as YYYY-MM, with its UTC bounds. Pure. */
export function lastMonth(nowIso: string): { month: string; startIso: string; endIso: string; label: string } {
  const d = new Date(nowIso);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
  const month = start.toISOString().slice(0, 7);
  return { month, startIso: start.toISOString(), endIso: first.toISOString(), label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

/** Is it time to send last month's report to this site? Pure: the first days of a
 *  month, the switch on, and last month not sent yet. */
export function reportDueNow(setting: ReportSetting, nowIso: string): boolean {
  if (!setting.enabled) return false;
  const day = new Date(nowIso).getUTCDate();
  if (day > REPORT_SEND_DAYS) return false;
  return setting.last_month !== lastMonth(nowIso).month;
}

/** Fold the month's reads into the report's numbers. Pure. */
export function foldReport(i: { month: string; label: string; startMs: number; endMs: number; visits: VisitRow[] | null; enquiries: number | null; publishes: Array<{ created_at: string }> | null; address: string; visitsCap: number }): ReportData {
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
  return { month: i.month, monthLabel: i.label, visitors, pageviews, truncated, enquiries: i.enquiries, topPages, publishes: pubs ? pubs.length : null, lastPublishedAt, address: i.address };
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
  if (d.visitors === null) tiles.push(tile('Visitors', '—', 'We couldn’t read the visit counts this time.'));
  else tiles.push(tile('Visitors', n1(d.visitors), `${n1(d.pageviews || 0)} page${(d.pageviews || 0) === 1 ? '' : 's'} viewed${d.truncated ? ', from recent activity' : ''}`));
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
  else parts.push(`<p style="margin:10px 0 14px"><strong>What changed:</strong> ${d.publishes === 1 ? 'one update went live' : `${n1(d.publishes)} updates went live`}${d.lastPublishedAt ? `, the last on ${new Date(d.lastPublishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}` : ''}.</p>`);
  parts.push(`<p style="margin:16px 0 0;font-size:13px;color:#6b6478">Sent once a month by ${esc(o.studioName)}. Reply to this email to reach us.</p>`);
  return { subject: `Your website in ${d.monthLabel}`, html: parts.join('') };
}

const VISITS_CAP = 5000;
/** The month's reads for one site. Each part is best-effort on its own. */
export async function loadReportData(site: SiteRow, win: { month: string; startIso: string; endIso: string; label: string }): Promise<ReportData> {
  const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
  const [vq, enq, pq] = await Promise.all([
    safe(svc(`presence_visits?site_id=eq.${site.id}&ts=gte.${win.startIso}&ts=lt.${win.endIso}&select=ts,kind,path,ref_host,utm_source,device,country,visitor_hash&order=ts.desc&limit=${VISITS_CAP}`)),
    safe(svcCount(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&created_at=gte.${win.startIso}&created_at=lt.${win.endIso}`)),
    safe(svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&created_at=gte.${win.startIso}&created_at=lt.${win.endIso}&select=created_at&limit=500`)),
  ]);
  const rows = <T,>(q: unknown): T[] | null => (q && (q as { ok?: boolean }).ok && Array.isArray((q as { json?: unknown }).json)) ? (q as { json: T[] }).json : null;
  return foldReport({ month: win.month, label: win.label, startMs: Date.parse(win.startIso), endMs: Date.parse(win.endIso), visits: rows<VisitRow>(vq), enquiries: typeof enq === 'number' ? enq : null, publishes: rows<{ created_at: string }>(pq), address: siteOrigin(site), visitsCap: VISITS_CAP });
}

/** The studio that looks after this client site (the active service link), for the brand. */
async function studioSiteOf(siteId: string): Promise<string | null> {
  try {
    const l = await svc(`presence_service_links?customer_site_id=eq.${siteId}&status=eq.active&select=agency_site_id&order=created_at.desc&limit=1`);
    return Array.isArray(l.json) && l.json[0]?.agency_site_id ? String(l.json[0].agency_site_id) : null;
  } catch { return null; }
}
async function brandFor(site: SiteRow): Promise<EmailBrand> {
  const studio = await studioSiteOf(site.id);
  return studio ? await loadEmailBrand(studio) : EMAIL_BRAND_DEFAULT;
}
async function clientOf(site: SiteRow): Promise<{ email: string | null; name: string | null }> {
  if (!site.client_id) return { email: null, name: null };
  const c = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email,name&limit=1`).catch(() => ({ json: [] as unknown[] }));
  const row = (Array.isArray(c.json) ? c.json[0] : null) as { email?: string; name?: string } | null;
  return { email: row?.email || null, name: row?.name || null };
}

export async function readReportSetting(siteId: string): Promise<ReportSetting> {
  return normalizeReportSetting(await readReservedJson(siteId, RESERVED_NAMES.monthlyReport));
}

/** Compose and send one site's report for a window; to the client unless `to` says otherwise. */
export async function sendReport(site: SiteRow, win: ReturnType<typeof lastMonth>, setting: ReportSetting, to?: string | null, preview = false): Promise<boolean> {
  const [data, brand, client] = await Promise.all([loadReportData(site, win), brandFor(site), clientOf(site)]);
  const addr = to || client.email;
  if (!addr) return false;
  const { subject, html } = reportHtml(data, { studioName: brand.name, note: setting.note, clientName: client.name });
  return await sendEmail(addr, preview ? `[Preview] ${subject}` : subject, html, brand, { siteId: site.id });
}

/** The monthly job: on the first days of a month, every switched-on client site that
 *  hasn't had last month's report yet. The reserved row's last_month is the gate. */
export async function runMonthlyReports(limit = 20, nowIso = new Date().toISOString()): Promise<{ sent: number; skipped: number; failures: number; not_due?: boolean }> {
  const day = new Date(nowIso).getUTCDate();
  if (day > REPORT_SEND_DAYS) return { sent: 0, skipped: 0, failures: 0, not_due: true };
  const win = lastMonth(nowIso);
  const q = await svc(`presence_sales_templates?kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.monthlyReport)}&deleted_at=is.null&select=site_id,body&limit=${Math.max(1, Math.min(200, limit * 5))}`);
  const rows = (Array.isArray(q.json) ? q.json : []) as Array<{ site_id: string; body: string }>;
  let sent = 0, skipped = 0, failures = 0;
  for (const r of rows) {
    if (sent >= limit) break;
    let setting: ReportSetting; try { setting = normalizeReportSetting(JSON.parse(r.body)); } catch { skipped++; continue; }
    if (!reportDueNow(setting, nowIso)) { skipped++; continue; }
    const sq = await svc(`presence_sites?id=eq.${r.site_id}&select=*&limit=1`);
    const site = (Array.isArray(sq.json) ? sq.json[0] : null) as SiteRow | null;
    if (!site) { skipped++; continue; }
    const ok = await sendReport(site, win, setting).catch(() => false);
    if (ok) {
      sent++;
      await writeReservedJson(site.id, RESERVED_NAMES.monthlyReport, { ...setting, last_month: win.month }, 'monthly-report');
    } else failures++;
  }
  return { sent, skipped, failures };
}

// ── the site-scoped routes: GET and PUT /report/monthly, POST /report/monthly/preview ──
export async function handleReportGet(site: SiteRow, cors: Record<string, string>) {
  const s = await readReportSetting(site.id);
  return json({ data: { ...s, note_max: REPORT_NOTE_MAX, next_month: new Date().toISOString().slice(0, 7) } }, 200, cors);   // this month's report goes out in the first days of next month
}
export async function handleReportPut(req: Request, site: SiteRow, principal: { email?: string | null }, cors: Record<string, string>) {
  let b: { enabled?: unknown; note?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
  const cur = await readReportSetting(site.id);
  const next: ReportSetting = {
    ...cur,
    enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
    note: typeof b.note === 'string' ? b.note.slice(0, REPORT_NOTE_MAX) : cur.note,
    updated_by: principal.email || cur.updated_by, updated_at: new Date().toISOString(),
  };
  if (typeof b.enabled !== 'boolean' && typeof b.note !== 'string') return json({ error: 'bad_request', message: 'Say whether the report is on, or give the line to send with it.' }, 400, cors);
  const ok = await writeReservedJson(site.id, RESERVED_NAMES.monthlyReport, next, principal.email || 'studio');
  if (!ok) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
  return json({ data: next }, 200, cors);
}
/** A preview of last month's report to the caller, now. */
export async function handleReportPreview(site: SiteRow, principal: { email?: string | null }, cors: Record<string, string>) {
  if (!principal.email) return json({ error: 'bad_request', message: 'Your sign-in has no email to send the preview to.' }, 400, cors);
  const setting = await readReportSetting(site.id);
  const ok = await sendReport(site, lastMonth(new Date().toISOString()), setting, principal.email, true).catch(() => false);
  if (!ok) return json({ error: 'fetch_failed', message: 'The preview didn’t send. Check that email sending is set up, then try again.' }, 502, cors);
  return json({ data: { sent_to: principal.email } }, 200, cors);
}
