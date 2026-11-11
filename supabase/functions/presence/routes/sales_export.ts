// ── "Download my data" (sales review item 69, Nov 2026) ──────────────────────
// Salesforce's Data Export: one zip of CSVs, so a studio can walk out with what
// it keeps here (Studio OS imports CSVs on three lists; this is the way back
// out). Customers, contacts, deals, proposals, agreements, estimates, invoices
// and payments, recurring invoices, enquiries, support requests and tasks. Every read is this studio's
// own (site_id pinned); a table that can't be read is listed in READ-ME.txt
// rather than shipped as an empty file that looks like "none".
import { svc } from '../lib/db.ts';
import { siteCan, isSiteRole } from '../lib/site_roles.ts';
import { loadStageLabels } from '../lib/stage_names.ts';
import { toCsv, zipStore } from '../lib/zip_csv.ts';
import { proposalTotals } from '../lib/sales_lifecycle.ts';
import { tableMissing } from './estimates.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';

// Bug hunt F6 (Nov 10): one read used to ask for 5,000 rows, but the database answers at
// most 1,000 to a read, so a busy studio's file stopped at 1,000 rows of a table, oldest
// first, and READ-ME.txt said nothing. Each table is now read a page at a time, in a fixed
// order (oldest first, then by id, so a page can't skip or repeat a row), every page or the
// file is left out and named. Past EXPORT_PAGES pages READ-ME.txt says the table stops there.
export const EXPORT_PAGE = 1000, EXPORT_PAGES = 50;   // 50,000 rows a table at most
const rows = (r: { ok?: boolean; json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const dollars = (c: unknown) => (Math.round(Number(c) || 0) / 100).toFixed(2);
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
type Read = { rows: any[]; cut: boolean } | null;

/** Every page of `path` (no order, limit or offset in it), oldest first. null when a page
 *  fails; `first` answers the first page's failure (the caller decides what it means). */
async function readPages(path: string): Promise<{ rows: any[]; cut: boolean } | { failed: { status: number; json?: unknown; text?: string } | null }> {
  const out: any[] = [];
  for (let p = 0; p < EXPORT_PAGES; p++) {
    const r = await svc(`${path}&order=created_at.asc,id.asc&limit=${EXPORT_PAGE}&offset=${p * EXPORT_PAGE}`).catch(() => null);
    if (!r || !r.ok || !Array.isArray(r.json)) return { failed: p === 0 ? r : null };
    out.push(...r.json);
    if (r.json.length < EXPORT_PAGE) return { rows: out, cut: false };
  }
  return { rows: out, cut: true };
}

/** Read a table for this studio: live rows (deleted_at is null) where the table has
 *  that column, else every row. null = the read failed (said so in READ-ME.txt). Only a
 *  refused query shape (400: no such column) falls back to every row; a read that merely
 *  failed is a failure, never a file with deleted rows in it. */
async function readAll(path: string): Promise<Read> {
  const live = await readPages(`${path}&deleted_at=is.null`);
  if ('rows' in live) return live;
  if (live.failed && live.failed.status === 400) { const any = await readPages(path); return 'rows' in any ? any : null; }
  return null;
}

// item 47: before APPLY-0145 the estimates and recurring tables don't exist yet,
// which means "none yet" — not "couldn't be read just now"
async function readNew(path: string): Promise<Read> {
  const r = await readPages(`${path}&deleted_at=is.null`);
  if ('rows' in r) return r;
  return r.failed && tableMissing(r.failed) ? { rows: [], cut: false } : null;
}
/** What a proposal comes to: its items less the discount, plus tax, the way the client sees
 *  it (proposalTotals, as estimates use). F6: the file printed the stored subtotal, the items
 *  before discount and tax. A proposal with no items keeps its stored subtotal. */
export function proposalTotalCents(p: { line_items?: unknown; subtotal_cents?: unknown }): number {
  const t = proposalTotals(p.line_items);
  return t.subtotal_cents || !Number(p.subtotal_cents) ? t.total_cents : Math.max(0, Math.round(Number(p.subtotal_cents) || 0));
}

export async function handleSalesExport(site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  // owners always; a team seat only when its role may export (site_roles.ts)
  const role = String((principal as any)?.member?.role || '');
  if (role && (!isSiteRole(role) || !siteCan(role, 'export'))) {
    return new Response(JSON.stringify({ error: 'forbidden', message: 'Downloading everything is for the studio’s owner.' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  const id = site.id;
  const labelsP = loadStageLabels(id).catch(() => null);
  const reads = await Promise.all([
    readAll(`presence_contacts?site_id=eq.${id}&select=*`),
    readAll(`presence_deals?site_id=eq.${id}&select=*`),
    readAll(`presence_proposals?site_id=eq.${id}&select=*`),
    readAll(`presence_contracts?site_id=eq.${id}&select=*`),
    readAll(`presence_invoices?site_id=eq.${id}&select=*`),
    readAll(`presence_form_submissions?site_id=eq.${id}&select=*`),
    readAll(`presence_support_requests?site_id=eq.${id}&select=*`),
    readAll(`presence_deal_tasks?site_id=eq.${id}&select=*`),
    readAll(`presence_tasks?site_id=eq.${id}&select=*`),
    readAll(`presence_projects?site_id=eq.${id}&select=id,name`),
    readPages(`presence_service_links?agency_site_id=eq.${id}&select=customer_client_id,status,created_at,id`).then((r) => ('rows' in r ? r : null)),
    readNew(`presence_estimates?site_id=eq.${id}&select=*`),
    readNew(`presence_recurring_invoices?site_id=eq.${id}&select=*`),
  ]);
  const labels = await labelsP;
  const [contacts, deals, proposals, contracts, invoices, enquiries, support, dealTasks, tasks, projects, links, estimates, recurring] = reads.map((r) => (r ? r.rows : null));
  // which reads reached the bound, by the file each one fills (said so in READ-ME.txt)
  const CUT_FILE = ['contacts.csv', 'deals.csv', 'proposals.csv', 'agreements.csv', 'invoices-and-payments.csv', 'enquiries.csv', 'support-requests.csv', 'tasks.csv', 'tasks.csv', 'tasks.csv', 'customers.csv', 'estimates.csv', 'recurring-invoices.csv'];
  const cutFiles = [...new Set(reads.map((r, i) => (r && r.cut ? CUT_FILE[i] : '')).filter(Boolean))];
  // the customers behind this studio's service links (one batched read)
  const clientIds = [...new Set((links || []).map((l: any) => s(l.customer_client_id)).filter((x: string) => UUID_RE.test(x)))];
  let clients: any[] | null = [];
  for (let i = 0; i < clientIds.length && clients; i += 100) {
    const r = await svc(`clients?id=in.(${clientIds.slice(i, i + 100).join(',')})&select=id,name,email,contact_email,created_at`).catch(() => null);
    clients = r && r.ok ? clients.concat(rows(r)) : null;
  }
  const clientById = new Map((clients || []).map((c: any) => [s(c.id), c]));
  const contactById = new Map((contacts || []).map((c: any) => [s(c.id), c]));
  const dealById = new Map((deals || []).map((d: any) => [s(d.id), d]));
  const projectById = new Map((projects || []).map((p: any) => [s(p.id), p]));
  const stage = (k: unknown) => (labels && labels[s(k)]) || s(k);
  const dealTitle = (dealId: unknown) => s(dealById.get(s(dealId))?.title);
  const contactEmail = (cid: unknown) => s(contactById.get(s(cid))?.email);

  const files: Array<{ name: string; header: string[]; rows: unknown[][] | null }> = [
    { name: 'customers.csv', header: ['Customer', 'Email', 'Working together', 'Since'],
      rows: links && clients ? (links as any[]).filter((l) => clientById.has(s(l.customer_client_id))).map((l) => { const c = clientById.get(s(l.customer_client_id)); return [c.name, c.email || c.contact_email, l.status, s(l.created_at).slice(0, 10)]; }) : null },
    { name: 'contacts.csv', header: ['Name', 'Email', 'Phone', 'Business', 'How they found you', 'Added'],
      rows: contacts && contacts.map((c) => [c.name, c.email, c.phone, c.company, c.found_via, s(c.created_at).slice(0, 10)]) },
    { name: 'deals.csv', header: ['Deal', 'Stage', 'Value', 'Expected close', 'Where it came from', 'How they found you', 'Contact email', 'Not a fit because', 'Opened', 'Won on'],
      rows: deals && deals.map((d) => [d.title, stage(d.stage), dollars(d.expected_value_cents), d.expected_close, d.source, d.found_via, contactEmail(d.contact_id), d.lost_reason, s(d.created_at).slice(0, 10), s(d.converted_at).slice(0, 10)]) },
    { name: 'proposals.csv', header: ['Deal', 'Proposal', 'Version', 'Status', 'Total', 'Sent', 'Decided'],
      rows: proposals && proposals.map((p) => [dealTitle(p.deal_id), p.title, p.version, p.status, dollars(proposalTotalCents(p)), s(p.sent_at).slice(0, 10), s(p.decided_at).slice(0, 10)]) },
    { name: 'agreements.csv', header: ['Deal', 'Agreement', 'Status', 'Sent', 'Signed', 'Signed by'],
      rows: contracts && contracts.map((c) => [dealTitle(c.deal_id), c.title, c.status, s(c.sent_at).slice(0, 10), s(c.signed_at).slice(0, 10), c.signer_name || c.signed_name]) },
    { name: 'estimates.csv', header: ['Deal', 'Estimate', 'Status', 'Total', 'Sent', 'Answered', 'Their note'],
      rows: estimates && estimates.map((e) => [dealTitle(e.deal_id), e.title, e.status === 'declined' ? 'not now' : e.status, dollars(proposalTotals(e.line_items).total_cents), s(e.sent_at).slice(0, 10), s(e.decided_at).slice(0, 10), e.decided_note]) },
    { name: 'recurring-invoices.csv', header: ['Deal', 'What it’s for', 'Amount', 'How often', 'Next invoice', 'Sent so far', 'How many in all', 'Status', 'Started'],
      rows: recurring && recurring.map((r) => [dealTitle(r.deal_id), r.title, dollars(r.amount_cents), r.every === 'quarter' ? 'every 3 months' : r.every === 'year' ? 'every year' : 'every month', s(r.next_on).slice(0, 10), r.sent_count, r.times ?? 'until stopped', r.status, s(r.created_at).slice(0, 10)]) },
    { name: 'invoices-and-payments.csv', header: ['Deal', 'Invoice', 'Amount', 'Status', 'Due', 'Paid on', 'Created'],
      rows: invoices && invoices.map((v) => [dealTitle(v.deal_id), v.title, dollars(v.amount_cents), v.status, s(v.due_date).slice(0, 10), s(v.paid_at).slice(0, 10), s(v.created_at).slice(0, 10)]) },
    { name: 'enquiries.csv', header: ['Name', 'Email', 'Phone', 'Message', 'Page', 'Status', 'Spam', 'Received'],
      rows: enquiries && enquiries.map((e) => [e.name, e.email, e.phone, e.message, e.source_page, e.status, e.spam ? 'yes' : '', s(e.created_at).slice(0, 10)]) },
    { name: 'support-requests.csv', header: ['Subject', 'From', 'Status', 'Priority', 'Opened', 'Resolved', 'First message'],
      rows: support && support.map((r) => [r.subject, clientById.get(s(r.client_id))?.name || (s(r.requester).includes('@') ? r.requester : ''), r.status, r.priority, s(r.created_at).slice(0, 10), s(r.resolved_at).slice(0, 10), r.body]) },
    { name: 'tasks.csv', header: ['For', 'Task', 'Due', 'Status'],
      rows: dealTasks && tasks ? [
        ...dealTasks.map((t) => ['Deal: ' + dealTitle(t.deal_id), t.title, s(t.due_date).slice(0, 10), t.status]),
        ...tasks.map((t) => ['Project: ' + s(projectById.get(s(t.project_id))?.name), t.title, s(t.due_date).slice(0, 10), t.status]),
      ] : null },
  ];
  const enc = new TextEncoder();
  const today = new Date().toISOString().slice(0, 10);
  const missing = files.filter((f) => !f.rows).map((f) => f.name);
  const readme = [
    `Your studio's data, downloaded ${today}.`,
    '',
    'Each file opens in Excel, Numbers or Google Sheets. Amounts are in dollars.',
    ...(missing.length ? ['', `These couldn't be read just now, so they aren't included: ${missing.join(', ')}. Download again in a minute to get them.`] : []),
    // F6: a table past the bound says where it stops, never a file that just ends
    ...(cutFiles.length ? ['', `These hold only their first ${(EXPORT_PAGE * EXPORT_PAGES).toLocaleString('en-US')} rows, oldest first: ${cutFiles.join(', ')}. Write to us for the rest.`] : []),
  ].join('\r\n') + '\r\n';
  const zip = zipStore([
    { name: 'READ-ME.txt', data: enc.encode(readme) },
    ...files.filter((f) => f.rows).map((f) => ({ name: f.name, data: enc.encode(toCsv(f.header, f.rows as unknown[][])) })),
  ]);
  return new Response(zip.buffer as ArrayBuffer, { status: 200, headers: { ...cors, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="studio-data-${today}.zip"`, 'Cache-Control': 'no-store' } });
}
