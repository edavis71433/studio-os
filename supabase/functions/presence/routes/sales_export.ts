// ── "Download my data" (sales review item 69, Nov 2026) ──────────────────────
// Salesforce's Data Export: one zip of CSVs, so a studio can walk out with what
// it keeps here (Studio OS imports CSVs on three lists; this is the way back
// out). Customers, contacts, deals, proposals, agreements, estimates, invoices
// and payments, recurring invoices, enquiries, support requests and tasks. Every read is this studio's
// own (site_id pinned); a table that can't be read is listed in READ-ME.txt
// rather than shipped as an empty file that looks like "none".
// Sales item 212 (Nov 22 review): it was said to be complete (item 103) but left out the
// history and the newer contact fields. contacts.csv now carries the second phone, job
// title, address, tags, notes, Good to know (item 211), when they joined your list and
// your own fields; history.csv holds every call, email, meeting and note logged (on a
// deal, on a person or customer with no deal, on a customer's record, on an enquiry);
// messages.csv holds the conversations (project messages, support replies, your replies
// to enquiries). A removed log (item 186) is left out, as it is everywhere else.
// Sales items 179 to 184 (Nov 23): the name typed on each yes, an estimate's version and whether
// it is Extra work, when Remind was pressed, and a deal's rounds of changes. Where a signature came
// from (the internet address and browser) stays out: it is kept for the certificate only.
import { svc } from '../lib/db.ts';
import { siteCan, isSiteRole } from '../lib/site_roles.ts';
import { loadStageLabels } from '../lib/stage_names.ts';
import { toCsv, zipStore } from '../lib/zip_csv.ts';
import { proposalTotals } from '../lib/sales_lifecycle.ts';
import { tableMissing } from './estimates.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { ADDRESS_KEYS, normalizeAddress, normalizeTags } from '../lib/contact_fields.ts';
import { loadContactFieldDefs } from '../lib/contact_row.ts';
import { isActivityRow } from '../crm/deal_activity.ts';
import { CONNECT_INTENT_TAG } from './sales.ts';
import { leadReplies, leadNote } from './commercial.ts';

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

// ── item 212: the newer contact fields, the history and the conversations (pure) ─────────
export const CONTACT_HEADER = ['Name', 'Email', 'Phone', 'Second phone', 'Business', 'Job title', 'Street', 'Town', 'State', 'ZIP', 'Country', 'Tags', 'Notes', 'Good to know', 'How they found you', 'Joined your list', 'Added'];
/** One contact as contacts.csv shows it (before your own fields). The notes leave out the
 *  connect-on-signup marker, which is Studio OS's, not a note. */
export function contactRow(c: any): unknown[] {
  const a = normalizeAddress(c.address);
  const notes = s(c.notes).split(CONNECT_INTENT_TAG).join(' ').replace(/\s+\n/g, '\n').trim();
  return [c.name, c.email, c.phone, c.phone2, c.company, c.job_title, ...ADDRESS_KEYS.map((k) => a[k] || ''), normalizeTags(c.tags).join(', '), notes, c.good_to_know, c.found_via, s(c.subscribed_at).slice(0, 10), s(c.created_at).slice(0, 10)];
}
export const HISTORY_HEADER = ['When', 'Who', 'Deal', 'What', 'Subject', 'Words', 'Logged by', 'How'];
const LOG_WORD: Record<string, string> = { call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note' };
const VIA_WORD: Record<string, string> = { '': 'Logged by hand', app: 'Sent from Studio OS', bcc: 'From your BCC address' };
type Named = (id: unknown) => string;
/** history.csv, oldest first: the logs on people and customers, on deals (a removed one or a
 *  change line is no log), the notes on customers' records and the notes on enquiries. null
 *  when a read failed (READ-ME.txt names the file). Pure. */
export function historyRows(i: { personLogs: any[] | null; dealNotes: any[] | null; recordNotes: any[] | null; enquiries: any[] | null; personName: Named; clientName: Named; dealContact: Named; dealTitle: Named; siteClientName: Named }): unknown[][] | null {
  if (!i.personLogs || !i.dealNotes || !i.recordNotes || !i.enquiries) return null;
  const out: Array<{ at: string; row: unknown[] }> = [];
  for (const e of i.personLogs) {
    const at = s(e.occurred_at || e.created_at);
    out.push({ at, row: [at.slice(0, 10), e.contact_id ? i.personName(e.contact_id) : i.clientName(e.client_id), '', LOG_WORD[s(e.kind)] || 'Note', e.subject, e.body, e.actor, VIA_WORD[s(e.via)] ?? VIA_WORD[''] ] });
  }
  for (const e of i.dealNotes) {
    if (!isActivityRow(e)) continue;
    const d = e.detail || {}, at = s(d.occurred_at || e.created_at);
    out.push({ at, row: [at.slice(0, 10), i.dealContact(e.deal_id), i.dealTitle(e.deal_id), LOG_WORD[s(d.activity_kind)] || 'Note', d.subject, d.body, e.actor, VIA_WORD[s(d.via)] ?? VIA_WORD[''] ] });
  }
  for (const n of i.recordNotes) {
    const at = s(n.created_at);
    out.push({ at, row: [at.slice(0, 10), i.siteClientName(n.site_id), '', 'Note', '', n.body, n.author, n.audience === 'shared' ? 'On their record, shared with them' : 'On their record' ] });
  }
  for (const q of i.enquiries) {
    const n = leadNote(q.fields);
    if (n) out.push({ at: n.at || s(q.created_at), row: [s(n.at || q.created_at).slice(0, 10), s(q.name || q.email), '', 'Note', '', n.body, '', 'On their enquiry'] });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((x) => x.row);
}
export const MESSAGES_HEADER = ['When', 'Conversation', 'From', 'Message', 'Team only'];
/** messages.csv, oldest first: the messages on projects, the replies on support requests (the
 *  first message of each is in support-requests.csv) and your replies to enquiries (what they
 *  wrote is in enquiries.csv). null when a read failed. Pure. */
export function messageRows(i: { projectMsgs: any[] | null; supportMsgs: any[] | null; enquiries: any[] | null; projectName: Named; requestSubject: Named }): unknown[][] | null {
  if (!i.projectMsgs || !i.supportMsgs || !i.enquiries) return null;
  const from = (m: any) => s(m.author) || (m.author_kind === 'client' ? 'Your client' : 'Your studio');
  const out: Array<{ at: string; row: unknown[] }> = [];
  for (const m of i.projectMsgs) out.push({ at: s(m.created_at), row: [s(m.created_at).slice(0, 10), `Project: ${i.projectName(m.project_id) || 'a project'}`, from(m), m.body, m.audience === 'internal' ? 'yes' : ''] });
  for (const m of i.supportMsgs) out.push({ at: s(m.created_at), row: [s(m.created_at).slice(0, 10), `Support: ${i.requestSubject(m.request_id) || 'a request'}`, from(m), m.body, ''] });
  for (const q of i.enquiries) for (const r of leadReplies(q.fields)) out.push({ at: r.at || s(q.created_at), row: [s(r.at || q.created_at).slice(0, 10), `Enquiry: ${s(q.name || q.email) || 'someone'}`, 'Your studio', r.body, ''] });
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((x) => x.row);
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
    readPages(`presence_service_links?agency_site_id=eq.${id}&select=customer_client_id,customer_site_id,status,created_at,id`).then((r) => ('rows' in r ? r : null)),
    readNew(`presence_estimates?site_id=eq.${id}&select=*`),
    readNew(`presence_recurring_invoices?site_id=eq.${id}&select=*`),
    // item 212: the history and the conversations. A person's or a customer's own logs
    // (0173; before it, none yet); a deal's logs are its note events, which keep no deleted_at
    readNew(`presence_person_events?site_id=eq.${id}&select=*`),
    readPages(`presence_deal_events?site_id=eq.${id}&kind=eq.note&select=*`).then((r) => ('rows' in r ? r : null)),
    readAll(`presence_project_messages?site_id=eq.${id}&select=*`),
    readAll(`presence_support_messages?site_id=eq.${id}&select=*`),
  ]);
  const labels = await labelsP;
  const [contacts, deals, proposals, contracts, invoices, enquiries, support, dealTasks, tasks, projects, links, estimates, recurring, personLogs, dealNotes, projectMsgs, supportMsgs] = reads.map((r) => (r ? r.rows : null));
  // which reads reached the bound, by the file each one fills (said so in READ-ME.txt)
  const CUT_FILE = ['contacts.csv', 'deals.csv', 'proposals.csv', 'agreements.csv', 'invoices-and-payments.csv', 'enquiries.csv', 'support-requests.csv', 'tasks.csv', 'tasks.csv', 'tasks.csv', 'customers.csv', 'estimates.csv', 'recurring-invoices.csv', 'history.csv', 'history.csv', 'messages.csv', 'messages.csv'];
  const cutFiles = [...new Set(reads.map((r, i) => (r && r.cut ? CUT_FILE[i] : '')).filter(Boolean))];
  // item 212: the notes kept on each customer's own record live on that customer's site
  const customerSites = [...new Set((links || []).map((l: any) => s(l.customer_site_id)).filter((x: string) => UUID_RE.test(x)))];
  let recordNotes: any[] | null = [];
  for (let i = 0; i < customerSites.length && recordNotes; i += 100) {
    const r = await readAll(`presence_relationship_notes?site_id=in.(${customerSites.slice(i, i + 100).join(',')})&select=*`);
    if (r && r.cut) cutFiles.push('history.csv');
    recordNotes = r ? recordNotes.concat(r.rows) : null;
  }
  const fieldDefs = await loadContactFieldDefs(id).catch(() => []);
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
  // item 212: who a line is about, as the lists name them
  const personName = (cid: unknown) => { const c = contactById.get(s(cid)); return c ? s(c.name || c.email) : ''; };
  const clientName = (id2: unknown) => { const c = clientById.get(s(id2)); return c ? s(c.name || c.email || c.contact_email) : ''; };
  const siteClient = new Map((links || []).filter((l: any) => l.customer_site_id).map((l: any) => [s(l.customer_site_id), s(l.customer_client_id)]));
  const requestById = new Map((support || []).map((r: any) => [s(r.id), r]));
  const history = historyRows({ personLogs, dealNotes, recordNotes, enquiries, personName, clientName, dealContact: (dealId) => personName(dealById.get(s(dealId))?.contact_id), dealTitle, siteClientName: (site2) => clientName(siteClient.get(s(site2))) });
  const messages = messageRows({ projectMsgs, supportMsgs, enquiries, projectName: (pid) => s(projectById.get(s(pid))?.name), requestSubject: (rid) => s(requestById.get(s(rid))?.subject) });

  const files: Array<{ name: string; header: string[]; rows: unknown[][] | null }> = [
    { name: 'customers.csv', header: ['Customer', 'Email', 'Working together', 'Since'],
      rows: links && clients ? (links as any[]).filter((l) => clientById.has(s(l.customer_client_id))).map((l) => { const c = clientById.get(s(l.customer_client_id)); return [c.name, c.email || c.contact_email, l.status, s(l.created_at).slice(0, 10)]; }) : null },
    // item 212: every field a contact keeps, your own fields last (one column each, by their label)
    { name: 'contacts.csv', header: [...CONTACT_HEADER, ...fieldDefs.map((f) => f.label)],
      rows: contacts && contacts.map((c) => [...contactRow(c), ...fieldDefs.map((f) => s(c.custom && typeof c.custom === 'object' ? (c.custom as any)[f.key] : ''))]) },
    { name: 'deals.csv', header: ['Deal', 'Stage', 'Value', 'Expected close', 'Where it came from', 'How they found you', 'Contact email', 'Not a fit because', 'Opened', 'Won on', 'Rounds of changes included'],
      rows: deals && deals.map((d) => [d.title, stage(d.stage), dollars(d.expected_value_cents), d.expected_close, d.source, d.found_via, contactEmail(d.contact_id), d.lost_reason, s(d.created_at).slice(0, 10), s(d.converted_at).slice(0, 10), d.revision_rounds ?? '']) },
    { name: 'proposals.csv', header: ['Deal', 'Proposal', 'Version', 'Status', 'Total', 'Sent', 'Decided', 'Accepted by', 'Reminded'],
      rows: proposals && proposals.map((p) => [dealTitle(p.deal_id), p.title, p.version, p.status, dollars(proposalTotalCents(p)), s(p.sent_at).slice(0, 10), s(p.decided_at).slice(0, 10), p.decided_name, s(p.reminded_at).slice(0, 10)]) },
    { name: 'agreements.csv', header: ['Deal', 'Agreement', 'Status', 'Sent', 'Signed', 'Signed by', 'Reminded'],
      rows: contracts && contracts.map((c) => [dealTitle(c.deal_id), c.title, c.status === 'voided' ? 'withdrawn' : c.status, s(c.sent_at).slice(0, 10), s(c.signed_at).slice(0, 10), c.signer_name || c.signed_name, s(c.reminded_at).slice(0, 10)]) },
    { name: 'estimates.csv', header: ['Deal', 'Estimate', 'Version', 'Extra work', 'Status', 'Total', 'Sent', 'Answered', 'Approved by', 'Their note', 'Reminded'],
      rows: estimates && estimates.map((e) => [dealTitle(e.deal_id), e.title, e.version ?? 1, e.extra_work ? 'yes' : '', e.status === 'declined' ? 'not now' : e.status, dollars(proposalTotals(e.line_items).total_cents), s(e.sent_at).slice(0, 10), s(e.decided_at).slice(0, 10), e.decided_name, e.decided_note, s(e.reminded_at).slice(0, 10)]) },
    { name: 'recurring-invoices.csv', header: ['Deal', 'What it’s for', 'Amount', 'How often', 'Next invoice', 'Sent so far', 'How many in all', 'Status', 'Started'],
      rows: recurring && recurring.map((r) => [dealTitle(r.deal_id), r.title, dollars(r.amount_cents), r.every === 'quarter' ? 'every 3 months' : r.every === 'year' ? 'every year' : 'every month', s(r.next_on).slice(0, 10), r.sent_count, r.times ?? 'until stopped', r.status, s(r.created_at).slice(0, 10)]) },
    { name: 'invoices-and-payments.csv', header: ['Deal', 'Invoice', 'Amount', 'Status', 'Due', 'Paid on', 'Created'],
      rows: invoices && invoices.map((v) => [dealTitle(v.deal_id), v.title, dollars(v.amount_cents), v.status, s(v.due_date).slice(0, 10), s(v.paid_at).slice(0, 10), s(v.created_at).slice(0, 10)]) },
    { name: 'enquiries.csv', header: ['Name', 'Email', 'Phone', 'Message', 'Page', 'Status', 'Spam', 'Received'],
      rows: enquiries && enquiries.map((e) => [e.name, e.email, e.phone, e.message, e.source_page, e.status, e.spam ? 'yes' : '', s(e.created_at).slice(0, 10)]) },
    { name: 'support-requests.csv', header: ['Subject', 'From', 'Status', 'Priority', 'Opened', 'Resolved', 'First message'],
      rows: support && support.map((r) => [r.subject, clientById.get(s(r.client_id))?.name || (s(r.requester).includes('@') ? r.requester : ''), r.status, r.priority, s(r.created_at).slice(0, 10), s(r.resolved_at).slice(0, 10), r.body]) },
    { name: 'history.csv', header: HISTORY_HEADER, rows: history },
    { name: 'messages.csv', header: MESSAGES_HEADER, rows: messages },
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
    'history.csv holds every call, email, meeting and note you logged. messages.csv holds your conversations with customers.',
    ...(missing.length ? ['', `These couldn't be read just now, so they aren't included: ${missing.join(', ')}. Download again in a minute to get them.`] : []),
    // F6: a table past the bound says where it stops, never a file that just ends
    ...(cutFiles.length ? ['', `These hold only their first ${(EXPORT_PAGE * EXPORT_PAGES).toLocaleString('en-US')} rows, oldest first: ${[...new Set(cutFiles)].join(', ')}. Write to us for the rest.`] : []),
  ].join('\r\n') + '\r\n';
  const zip = zipStore([
    { name: 'READ-ME.txt', data: enc.encode(readme) },
    ...files.filter((f) => f.rows).map((f) => ({ name: f.name, data: enc.encode(toCsv(f.header, f.rows as unknown[][])) })),
  ]);
  return new Response(zip.buffer as ArrayBuffer, { status: 200, headers: { ...cors, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="studio-data-${today}.zip"`, 'Cache-Control': 'no-store' } });
}
