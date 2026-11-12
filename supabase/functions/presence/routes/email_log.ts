// ═══ THE "LOG THIS EMAIL" ADDRESS (sales review item 69, Nov 2026) ═══════════
//   GET    /email/log-address — the studio's private address (shown to those who may manage it)
//   POST   /email/log-address — make an address; a new one turns the old one off (configure)
//   DELETE /email/log-address — turn it off (configure)
// and handleLoggedEmail, called by the inbound door (routes/inbound_email.ts)
// when a message's recipients include a log-<token>@ address. BCC that address
// when you email a client, and the email lands on their deal's activity and
// their record as "You logged an email". lib/email_log.ts holds the rules.
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from '../lib/site.ts';
import { svc } from '../lib/db.ts';
import { RESERVED_NAMES, readReservedJson, writeReservedJson } from '../lib/reserved_store.ts';
import { siteCan, isSiteRole } from '../lib/site_roles.ts';
import { LOG_TOKEN_RE, newLogToken, logAddress, loggedEmailBody } from '../lib/email_log.ts';
import { parseInbound, parseAuthResults, senderAuthVerdict, splitQuotedReply, maskEmail, filterSafe } from '../lib/inbound_email.ts';
import { UUID_RE } from '../lib/uuid.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const OPEN = ['lead', 'qualified', 'proposal', 'contract'];
const inboundDomain = () => (Deno.env.get('RESEND_INBOUND_DOMAIN') || '').trim().toLowerCase();

/** Owners (no seat) and seats that hold 'configure' manage the address. */
function mayManage(principal: Principal): boolean {
  const m = (principal as any).member as { role?: string } | null | undefined;
  if (!m) return true;
  return !!m.role && isSiteRole(m.role) && siteCan(m.role, 'configure');
}

export async function handleEmailLogAddress(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const stored = (await readReservedJson(site.id, RESERVED_NAMES.emailLog)) as { token?: string | null; created_at?: string } | null;
  const token = stored && typeof stored.token === 'string' && LOG_TOKEN_RE.test(stored.token) ? stored.token : '';
  const manage = mayManage(principal), domain = inboundDomain();
  const answer = (t: string, at?: string) => json({ data: { on: !!t, address: manage && t ? logAddress(t, domain) || null : null, created_at: t ? (at || null) : null, can_manage: manage, available: !!domain } }, 200, cors);
  if (req.method === 'GET') return answer(token, stored?.created_at);
  if (!manage) return json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);
  const by = principal.email || principal.userId || 'system';
  if (req.method === 'POST') {
    if (!domain) return json({ error: 'unavailable', message: 'Email replies aren’t set up on this account yet, so there’s no address to give.' }, 409, cors);
    const t = newLogToken(), at = new Date().toISOString();
    const ok = await writeReservedJson(site.id, RESERVED_NAMES.emailLog, { token: t, created_at: at }, by);
    return ok ? answer(t, at) : json({ error: 'write_failed', message: 'Your address didn’t save — please try again.' }, 502, cors);
  }
  if (req.method === 'DELETE') {
    const ok = await writeReservedJson(site.id, RESERVED_NAMES.emailLog, { token: null, created_at: null }, by);
    return ok ? answer('') : json({ error: 'write_failed', message: 'Your address is still on — please try again.' }, 502, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

const ack = () => new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const retry = () => json({ error: 'read_failed' }, 502);
function dropAck(reason: string, email?: string): Response {
  console.warn(`[inbound] log: dropped: ${reason}${email ? ` from ${maskEmail(email)}` : ''}`);
  return ack();
}

/** Everyone who may log for this studio: the site's owner, its business email,
 *  its team seats, and (on the platform's own site) the platform's addresses.
 *  null = couldn't be read (the caller asks Resend to try again). */
async function studioAddresses(siteId: string): Promise<Set<string> | null> {
  const [site, ident, members] = await Promise.all([
    svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`),
    svc(`presence_identity?site_id=eq.${siteId}&select=email&limit=1`),
    svc(`presence_site_members?site_id=eq.${siteId}&status=eq.active&select=email&limit=50`),
  ]);
  if (!site.ok || !ident.ok) return null;
  const out = new Set<string>();
  const add = (e: unknown) => { const v = String(e ?? '').trim().toLowerCase(); if (v.includes('@')) out.add(v); };
  add(rows(ident)[0]?.email);
  if (members.ok) for (const m of rows(members)) add(m.email);
  const owner = rows(site)[0]?.client_id;
  if (owner && UUID_RE.test(String(owner))) {
    const c = await svc(`clients?id=eq.${owner}&select=email,contact_email&limit=1`);
    if (!c.ok) return null;
    add(rows(c)[0]?.email); add(rows(c)[0]?.contact_email);
  }
  if (Deno.env.get('AGENCY_SITE_ID') && Deno.env.get('AGENCY_SITE_ID') === siteId) {
    add(Deno.env.get('PLATFORM_REPLY_TO') || 'eric@davisdigitalstudio.com');
    const from = /<([^<>]+)>/.exec(Deno.env.get('EMAIL_FROM') || ''); add(from ? from[1] : Deno.env.get('EMAIL_FROM'));
  }
  return out;
}

/** The deals one person's logged email belongs on: their newest OPEN deal, else
 *  their newest deal of any kind. A customer's are the deals that won them. */
function pickDeal(deals: any[]): any | null {
  const live = deals.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return live.find((d) => OPEN.includes(String(d.stage)) && !d.converted_client_id) || live[0] || null;
}

/** A message BCC'd to a studio's log address (data = the full message). */
export async function handleLoggedEmail(data: any, token: string): Promise<Response> {
  if (!LOG_TOKEN_RE.test(token)) return dropAck('log_bad_token');
  // 1. whose address: the token is hex-only, so it is safe inside the filter
  const found = await svc(`presence_sales_templates?kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.emailLog)}&deleted_at=is.null&body=like.*${token}*&select=site_id,body&limit=2`);
  if (!found.ok) return retry();
  const row = rows(found).find((r) => { try { return JSON.parse(String(r.body || '{}')).token === token; } catch { return false; } });
  if (!row) return dropAck('log_address_off');
  const siteId = String(row.site_id);

  // 2. a real message, genuinely from the studio's own team
  const parsed = parseInbound({ data });
  if (!parsed) return dropAck('log_unparseable');
  const { from_email, to_emails, subject, text, message_id } = parsed;
  const verdict = senderAuthVerdict(parseAuthResults(data), from_email);
  if (!verdict.ok) return dropAck(`log_sender_auth:${verdict.verdict}`, from_email);
  const team = await studioAddresses(siteId);
  if (!team) return retry();
  if (!team.has(from_email.toLowerCase())) return dropAck('log_not_the_studio', from_email);

  // 3. who it went to: header To + Cc, never the studio itself or our own domain
  const dom = inboundDomain();
  const people = [...new Set(to_emails.map((e) => e.toLowerCase()))]
    .filter((e) => !team.has(e) && !(dom && e.endsWith('@' + dom)) && filterSafe(e) !== null).slice(0, 10);
  if (!people.length) return dropAck('log_no_recipients', from_email);

  // 4. each recipient → a contact or a customer on THIS site → the deal it lands on
  const enc = (e: string) => encodeURIComponent(e);
  const [contactsR, clientsR] = await Promise.all([
    svc(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&or=(${people.map((e) => `email.ilike.${enc(e)}`).join(',')})&select=id,email&limit=50`),
    svc(`clients?or=(${people.flatMap((e) => [`email.ilike.${enc(e)}`, `contact_email.ilike.${enc(e)}`]).join(',')})&deleted_at=is.null&select=id,email,contact_email&limit=50`),
  ]);
  if (!contactsR.ok || !clientsR.ok) return retry();
  const isPerson = (e: unknown) => people.includes(String(e ?? '').trim().toLowerCase());
  const contacts = rows(contactsR).filter((c) => isPerson(c.email));
  let clients = rows(clientsR).filter((c) => isPerson(c.email) || isPerson(c.contact_email));
  if (clients.length) {   // a customer only counts when it is THIS studio's (an active service link)
    const links = await svc(`presence_service_links?agency_site_id=eq.${siteId}&status=eq.active&customer_client_id=in.(${clients.map((c) => c.id).filter((x: string) => UUID_RE.test(String(x))).join(',')})&select=customer_client_id&limit=50`);
    if (!links.ok) return retry();
    const mine = new Set(rows(links).map((l) => String(l.customer_client_id)));
    clients = clients.filter((c) => mine.has(String(c.id)));
  }
  const contactIds = contacts.map((c) => String(c.id)).filter((x) => UUID_RE.test(x));
  const clientIds = clients.map((c) => String(c.id)).filter((x) => UUID_RE.test(x));
  if (!contactIds.length && !clientIds.length) return dropAck('log_no_match', from_email);
  const ors = [...(contactIds.length ? [`contact_id.in.(${contactIds.join(',')})`] : []), ...(clientIds.length ? [`converted_client_id.in.(${clientIds.join(',')})`] : [])];
  const dealsR = await svc(`presence_deals?site_id=eq.${siteId}&deleted_at=is.null&or=(${ors.join(',')})&select=id,stage,contact_id,converted_client_id,updated_at&limit=100`);
  if (!dealsR.ok) return retry();
  const deals = rows(dealsR);
  const targets = new Set<string>();
  // sales item 85: someone with no deal still gets the email, on their own record (person events, 0173)
  const loose: Array<{ contact_id: string | null; client_id: string | null }> = [];
  for (const e of people) {
    const cIds = new Set(contacts.filter((c) => String(c.email).toLowerCase() === e).map((c) => String(c.id)));
    const kIds = new Set(clients.filter((c) => [c.email, c.contact_email].some((x) => String(x || '').toLowerCase() === e)).map((c) => String(c.id)));
    const d = pickDeal(deals.filter((x) => cIds.has(String(x.contact_id)) || kIds.has(String(x.converted_client_id))));
    if (d) targets.add(String(d.id));
    else if (cIds.size || kIds.size) loose.push({ contact_id: [...cIds][0] || null, client_id: [...kIds][0] || null });
  }
  if (!targets.size && !loose.length) return dropAck('log_no_deal', from_email);

  // 5. one "You logged an email" per deal, once per message (a redelivery never doubles it)
  const said = splitQuotedReply(text).text;
  const occurred = (() => { const t = Date.parse(String(data.created_at || '')); return Number.isFinite(t) && t <= Date.now() ? new Date(t).toISOString() : new Date().toISOString(); })();
  const msgId = String(message_id || '').slice(0, 300);
  for (const p of loose) {
    const who = [...(p.contact_id ? [`contact_id.eq.${p.contact_id}`] : []), ...(p.client_id ? [`client_id.eq.${p.client_id}`] : [])].join(',');
    if (msgId) {
      const seen = await svc(`presence_person_events?site_id=eq.${siteId}&message_id=eq.${encodeURIComponent(msgId)}&or=(${who})&select=id&limit=1`);
      if (seen.ok && rows(seen)[0]) continue;
      if (!seen.ok) { console.warn('[inbound] log: person events unavailable (APPLY-0173?)'); break; }   // before 0173: nowhere to put it
    }
    const ins = await svc('presence_person_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      site_id: siteId, contact_id: p.contact_id, client_id: p.client_id, kind: 'email', body: loggedEmailBody(subject, said), subject: String(subject || '').slice(0, 200),
      occurred_at: occurred, via: 'bcc', message_id: msgId, actor: from_email, actor_kind: 'client',
    }) });
    if (!ins.ok) return json({ error: 'write_failed' }, 502);   // Resend redelivers; the message-id check stops a double
  }
  for (const dealId of targets) {
    if (msgId) {
      const seen = await svc(`presence_deal_events?deal_id=eq.${dealId}&site_id=eq.${siteId}&kind=eq.note&detail->>message_id=eq.${encodeURIComponent(msgId)}&select=id&limit=1`);
      if (!seen.ok) return retry();
      if (rows(seen)[0]) continue;
    }
    const ins = await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      deal_id: dealId, site_id: siteId, kind: 'note', actor: from_email, actor_kind: 'client',
      detail: { activity_kind: 'email', body: loggedEmailBody(subject, said), occurred_at: occurred, via: 'bcc', subject: String(subject || '').slice(0, 200), message_id: msgId },
    }) });
    if (!ins.ok) return json({ error: 'write_failed' }, 502);   // Resend redelivers; the message-id check stops a double
    await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ updated_at: new Date().toISOString() }) }).catch(() => {});
  }
  console.log(`[inbound] log: ${targets.size} deal(s) and ${loose.length} person(s) got an email from ${maskEmail(from_email)}`);
  return ack();
}
