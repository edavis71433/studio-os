// ── Every client's monthly report on one card (builder list item 160, Nov 2026) ──
//   GET /agency/monthly-reports   one row per client site: on or off, who it goes to,
//                                 what it suggests, how the last one went, and why it
//                                 can't go out when it can't
// Wix Studio sets the client report once and picks which clients get it. Ours lives in
// the studio's own Settings. Read only: each row's switch is the client's own switch
// (PUT /report/monthly, scoped to that client, which refuses a client who can't be
// emailed), so there is one setting and one set of rules, not a second copy of them.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import { RESERVED_NAMES } from '../lib/reserved_store.ts';
import { normalizeReportSetting, blockedReason } from '../ops/monthly_report.ts';

const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };
const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

export interface ReportRow {
  site_id: string; name: string; email: string | null; enabled: boolean; blocked: string | null;
  more: number; copy: boolean; propose: 'off' | 'auto' | 'own'; last: { month: string; status: string; reason: string | null } | null;
}

/** The rows, by name. Pure: the reads put together. */
export function reportRows(i: {
  ids: string[];
  sites: Array<{ id: string; client_id?: string | null }>;
  names: Array<{ site_id: string; business_name?: string | null }>;
  clients: Array<{ id: string; email?: string | null; name?: string | null }>;
  settings: Array<{ site_id: string; body: string }>;
  suppressed: Record<string, string>;   // email (lower case) → opt_out | bounce | complaint
}): ReportRow[] {
  const out: ReportRow[] = [];
  for (const id of i.ids) {
    const site = i.sites.find((s) => s.id === id);
    if (!site) continue;
    const client = i.clients.find((c) => c.id === site.client_id) || null;
    let body: unknown = null; try { body = JSON.parse(i.settings.find((s) => s.site_id === id)?.body || 'null'); } catch { /* an unreadable row reads as off */ }
    const s = normalizeReportSetting(body);
    const email = client?.email ? String(client.email).trim() : null;
    const name = String(i.names.find((n) => n.site_id === id)?.business_name || client?.name || '').trim() || 'Unnamed client';
    out.push({
      site_id: id, name, email, enabled: s.enabled,
      blocked: blockedReason(email, email ? i.suppressed[email.toLowerCase()] || null : null),
      more: s.cc.length, copy: !!s.copy_to, propose: s.propose.mode,
      last: s.last_result ? { month: s.last_result.month, status: s.last_result.status, reason: s.last_result.reason } : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** GET /agency/monthly-reports, or null when the route is someone else's. */
export async function handleMonthlyReports(route: string, method: string, member: AgencyMember, cors: Record<string, string>): Promise<Response | null> {
  if (route !== '/agency/monthly-reports' || method !== 'GET') return null;
  if (!can(member.role, 'read')) return json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);
  const ids = await agencySiteIds(member.agency_id);
  if (!ids.length) return json({ data: { rows: [], can_change: can(member.role, 'manage_clients') } }, 200, cors);
  const list = `(${ids.join(',')})`;
  const [sitesQ, namesQ, setQ] = await Promise.all([
    svc(`presence_sites?id=in.${list}&select=id,client_id&limit=1000`),
    safe(svc(`presence_identity?site_id=in.${list}&select=site_id,business_name&limit=1000`)),
    svc(`presence_sales_templates?site_id=in.${list}&kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.monthlyReport)}&deleted_at=is.null&select=site_id,body&order=updated_at.desc&limit=1000`),
  ]);
  // a failed read of the sites or the settings is not "every report off": the card says it couldn't load
  if (!(sitesQ as { ok?: boolean }).ok || !(setQ as { ok?: boolean }).ok) return json({ error: 'read_failed', message: 'The monthly reports couldn’t load just now.' }, 502, cors);
  const sites = rows(sitesQ);
  const clientIds = [...new Set(sites.map((s) => String(s.client_id || '')).filter(Boolean))];
  const clients = clientIds.length ? rows(await safe(svc(`clients?id=in.(${clientIds.join(',')})&select=id,email,name&limit=1000`))) : [];
  const { suppressionOf } = await import('../routes/email_infra.ts');
  const suppressed: Record<string, string> = {};
  await Promise.all(clients.map(async (c) => { const e = String(c.email || '').trim().toLowerCase(); if (!e) return; const r = await suppressionOf(e).catch(() => null); if (r) suppressed[e] = String(r); }));
  // the newest row per site wins (reserved_store reads it the same way)
  const settings: Array<{ site_id: string; body: string }> = [];
  for (const r of rows(setQ)) if (!settings.some((s) => s.site_id === r.site_id)) settings.push({ site_id: String(r.site_id), body: String(r.body || '') });
  return json({ data: { rows: reportRows({ ids, sites, names: rows(namesQ), clients, settings, suppressed }), can_change: can(member.role, 'manage_clients') } }, 200, cors);
}
