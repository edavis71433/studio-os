// ── Inbound email capture — the PRE-AUTH webhook door (CRM redesign, slice 6) ──
// A client's email reply enters the platform HERE. Resend Inbound routes
// *@<inbound-domain> to this route; a message addressed to <siteId>@<domain>
// lands on that agency site's support conversation, matched to a KNOWN customer/
// contact by sender email. This is a PRE-AUTH SECURITY DOOR: it sits before the
// caller-site gate (no session) and is authorized ONLY by the svix HMAC signature
// (the sibling of /email/events). It is hardened on the first pass — see the
// numbered decision order below; each step is a verified review finding.
//
// The decision order is DELIBERATE and load-bearing:
//   1. no secret            → 404  (the surface does not exist — fail-closed §5.3)
//   2. missing svix headers → 400
//   3. oversize body        → 413  (declared Content-Length AND a streamed cap, BEFORE any HMAC)
//   4. bad signature        → 401
//   5+ everything past the signature ACKS 200 (a masked warn) — a verified-but-
//      un-landable message must STOP Resend retrying it (an infinite retry of a
//      spam/auth-fail message is its own outage). We only 502 when a landable
//      message hit an INFRA failure and a retry could still succeed.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow } from '../lib/ratelimit.ts';
import { verifySvix } from '../../_shared/email_infra.ts';
import {
  parseInbound, parseAddress, siteIdFromAddress,
  parseAuthResults, senderAuthVerdict, autoResponderSignal, isSelfSender,
  filterSafe, filterKey, deriveRequesterKey, matchedStoredEmail, identityAliases,
  selectAppendTarget, missingColumnSignal, missingInsertColumns, referenceIds, maskEmail,
} from '../lib/inbound_email.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 256 * 1024;   // 256KB — an inbound email above this isn't a real client reply
const PLATFORM_REPLY_TO = Deno.env.get('PLATFORM_REPLY_TO') || 'eric@davisdigitalstudio.com';
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

/** SB1/SC1: a read whose EMPTINESS drives a DROP or a NEW-vs-APPEND decision must
 *  NOT collapse a non-ok DB response (a transient 5xx/timeout) to []. A bare rows()
 *  can't tell "genuinely empty" from "the read failed", so a flaky identity/thread
 *  read would silently 200-drop a real sender OR open a duplicate thread. okRows()
 *  throws InfraRead on a non-ok response; the route catches it and returns 502 so
 *  Resend RETRIES (the message is landable, the failure was infra). A genuinely
 *  empty ok result returns [] and keeps its normal meaning (drop / new request). */
class InfraRead extends Error {}
function okRows(r: { ok?: boolean; json?: unknown }): any[] {
  if (!r || (r as any).ok === false) throw new InfraRead();
  return Array.isArray((r as any).json) ? (r as any).json : [];
}
const readFailed = () => json({ error: 'read_failed' }, 502);   // landable + infra read failure → Resend retries

/** The webhook ACK. 200 so Resend stops retrying a message we've decided about.
 *  NEVER echoes any payload content back to the caller. */
const ack = () => new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
/** Drop the message but ACK it (stop the retry), with a MASKED operator warn. */
function dropAck(reason: string, email?: string): Response {
  console.warn(`[inbound] dropped: ${reason}${email ? ` from ${maskEmail(email)}` : ''}`);
  return ack();
}

/** Read the request body with a HARD streamed cap, BEFORE any HMAC work — so a
 *  hostile multi-megabyte upload is refused without first hashing it. Returns null
 *  when the stream exceeds `max` (the caller answers 413). */
async function readBodyCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) { const t = await req.text(); return t.length > max ? null : t; }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) { try { await reader.cancel(); } catch { /* */ } return null; }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let off = 0; for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

/** Has this exact external_id already landed on this site (either support table,
 *  or — F1 — the project-message thread)? All reads are site-scoped. Best-effort:
 *  pre-0114/0115 the external_id column doesn't exist, so PostgREST errors →
 *  treat that table as NOT landed (dedup degrades to the unique index once the
 *  migration is applied; the code never blocks on the column). */
async function alreadyLanded(siteId: string, externalId: string): Promise<boolean> {
  if (!externalId) return false;
  try {
    const enc = encodeURIComponent(externalId);
    const [m, r, p] = await Promise.all([
      svc(`presence_support_messages?site_id=eq.${siteId}&external_id=eq.${enc}&select=id&limit=1`),
      svc(`presence_support_requests?site_id=eq.${siteId}&external_id=eq.${enc}&select=id&limit=1`),
      svc(`presence_project_messages?site_id=eq.${siteId}&external_id=eq.${enc}&select=id&limit=1`),
    ]);
    // per-table: a missing column (pre-migration) reads as "not landed" THERE
    // without blinding the other tables' checks
    if (m.ok && rows(m).length > 0) return true;
    if (r.ok && rows(r).length > 0) return true;
    if (p.ok && rows(p).length > 0) return true;
    return false;
  } catch { return false; }
}

/** Insert a row carrying its external_id for idempotency. A unique-index conflict
 *  (409) means the message already landed → {duplicate}. ONLY on the precise
 *  missing-column signal (pre-0114 external_id / pre-0115 client_id) do we retry
 *  with EXACTLY the named optional column(s) stripped — never silently stripping
 *  everything. `optionalKeys` names the row's OTHER deploy-order-tolerant columns
 *  (e.g. client_id) so a pre-0115 database degrades to the old insert shape while
 *  KEEPING the dedup key when only client_id is missing. ANY other failure
 *  returns !ok so the route 502s and Resend retries (the message is landable,
 *  the failure was infra). */
async function insertDeduped(table: string, row: Record<string, unknown>, externalId: string, optionalKeys: string[] = []): Promise<{ ok: boolean; row?: any; duplicate?: boolean }> {
  const post = (body: unknown) => svc(table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  let attempt: Record<string, unknown> = { ...row, external_id: externalId };
  // bounded: full → strip the named column(s) → strip all optional (≤3 attempts)
  for (let i = 0; i < 3; i++) {
    const r = await post(attempt);
    if (r.ok && rows(r)[0]) return { ok: true, row: rows(r)[0] };
    if (r.status === 409) return { ok: true, duplicate: true };   // unique(site_id, external_id) → already landed
    const present = ['external_id', ...optionalKeys].filter((k) => k in attempt);
    const strip = missingInsertColumns(r.json, r.text, present);
    if (!strip.length) return { ok: false };
    attempt = { ...attempt };
    for (const k of strip) delete attempt[k];
  }
  return { ok: false };
}

interface SiteIdentity { kind: 'client' | 'contact'; id: string; contactId: string | null; emails: string[]; candidates: number; projectId: string | null }

/** Resolve the inbound sender to a KNOWN identity ON THIS SITE. `clients` is
 *  matched by email (ilike, then an EXACT in-memory recheck — ilike only ever
 *  OVER-matches) and gated by an ACTIVE service_link to THIS agency site (bridged
 *  precedence: a client is only a valid sender for this tenant if it's their
 *  agency). Failing that, `presence_contacts` on this site (a pre-sale CRM
 *  contact) is matched the same way. No 500-row roster pulls — bounded, exact.
 *  null = an unknown sender (the spam surface: we NEVER open a thread from a
 *  stranger's email). */
async function matchSiteIdentity(siteId: string, fromEmail: string): Promise<SiteIdentity | null> {
  const enc = encodeURIComponent(fromEmail.toLowerCase());
  // 1) clients matched by email OR contact_email (ilike over-matches → exact recheck).
  //    SB1: okRows — a non-ok clients read 502s (see okRows), it is NOT read as "no
  //    such client" (which would silently 200-drop a genuine sender as unknown).
  const clientRows = okRows(await svc(`clients?or=(email.ilike.${enc},contact_email.ilike.${enc})&deleted_at=is.null&select=id,email,contact_email,contact_id,created_at&order=created_at.asc,id.asc&limit=25`))
    .filter((c) => String(c.email || '').toLowerCase() === fromEmail.toLowerCase() || String(c.contact_email || '').toLowerCase() === fromEmail.toLowerCase());
  const clientIds = clientRows.map((c) => String(c.id)).filter((id) => UUID_RE.test(id));
  if (clientIds.length) {
    // bridged precedence: only a client with an ACTIVE link to THIS agency site is
    // a valid sender here. The link also carries the delivery PROJECT (F1): the
    // matched client's NEWEST active link names the thread their email lands on.
    const links = okRows(await svc(`presence_service_links?agency_site_id=eq.${siteId}&status=eq.active&customer_client_id=in.(${clientIds.join(',')})&select=customer_client_id,project_id,created_at&order=created_at.desc&limit=25`));
    const bridged = new Set(links.map((l) => String(l.customer_client_id)));
    const hit = clientRows.find((c) => bridged.has(String(c.id)));
    if (hit) {
      const link = links.find((l) => String(l.customer_client_id) === String(hit.id));   // created_at.desc → newest first
      const projectId = link?.project_id && UUID_RE.test(String(link.project_id)) ? String(link.project_id) : null;
      return { kind: 'client', id: String(hit.id), contactId: hit.contact_id ? String(hit.contact_id) : null, emails: [hit.email, hit.contact_email].filter((e) => e && String(e).trim()).map(String), candidates: clientRows.filter((c) => bridged.has(String(c.id))).length, projectId };
    }
  }
  // 2) a CRM contact on THIS site (site-scoped), matched the same way
  const contactRows = okRows(await svc(`presence_contacts?site_id=eq.${siteId}&email=ilike.${enc}&deleted_at=is.null&select=id,email,created_at&order=created_at.asc,id.asc&limit=25`))
    .filter((c) => String(c.email || '').toLowerCase() === fromEmail.toLowerCase());
  if (contactRows.length) {
    const c = contactRows[0];
    return { kind: 'contact', id: String(c.id), contactId: null, emails: [c.email].filter((e) => e && String(e).trim()).map(String), candidates: contactRows.length, projectId: null };
  }
  return null;
}

/** F1 reference threading: the support thread a reply's In-Reply-To/References
 *  point at. We store INBOUND Message-Ids as external_id on BOTH support tables,
 *  so a reply inside a thread that started with (or ever contained) the sender's
 *  own email carries a stored id. Returns the thread row (id, requester, status,
 *  project_id, subject) or null. Pre-0114 (no external_id column) → null (the
 *  precise missing-column signal only); any OTHER non-ok read throws InfraRead
 *  so the route 502s (a flaky read must not silently fork a duplicate thread). */
async function findThreadByReferences(siteId: string, refs: string[]): Promise<any | null> {
  if (!refs.length) return null;
  const list = refs.map((x) => filterKey(x)).join(',');
  const q = async (path: string): Promise<any[]> => {
    const r = await svc(path);
    if (!r.ok) {
      if (missingColumnSignal(r.json, r.text)) return [];   // pre-0114 → reference threading not available yet
      throw new InfraRead();
    }
    return rows(r);
  };
  const [msgHits, reqHits] = await Promise.all([
    q(`presence_support_messages?site_id=eq.${siteId}&deleted_at=is.null&external_id=in.(${list})&select=request_id,created_at&order=created_at.desc&limit=1`),
    q(`presence_support_requests?site_id=eq.${siteId}&deleted_at=is.null&external_id=in.(${list})&select=id,created_at&order=created_at.desc&limit=1`),
  ]);
  const reqId = String(msgHits[0]?.request_id || reqHits[0]?.id || '');
  if (!reqId) return null;
  const enc = encodeURIComponent(reqId);
  return (await q(`presence_support_requests?id=eq.${enc}&site_id=eq.${siteId}&deleted_at=is.null&select=id,subject,requester,status,project_id&limit=1`))[0] || null;
}

/** Auto-acknowledge the sender that their email landed. The SAME branded,
 *  critical, best-effort ack service_intake uses (survives a marketing opt-out),
 *  now on the site's inbound reply-to so a REPLY to the ack lands right back here
 *  (opts.siteId). RFC 3834: the ack marks itself Auto-Submitted:auto-replied so it
 *  never triggers another server's autoresponder. Never throws. */
async function ackSender(siteId: string, toEmail: string): Promise<void> {
  try {
    if (!EMAIL_RE.test(String(toEmail))) return;
    const { sendEmail } = await import('../commerce/account.ts');
    const { loadEmailBrand } = await import('../lib/email_brand.ts');
    const brand = await loadEmailBrand(siteId);
    await sendEmail(toEmail, 'We’ve got your message',
      `<p>Thanks — we’ve got your email and added it to your conversation with us. Nothing more is needed right now; we’ll follow up here.</p>`,
      brand, { critical: true, siteId, headers: { 'Auto-Submitted': 'auto-replied' } });
  } catch { /* an ack must never block or throw */ }
}

/** I1: resolve a sender's auth (portal) user id from their email — the SAME uid
 *  their portal session resolves to. An email-authenticated bridged client whose
 *  linked contact carries NO auth_user_id still logs into the portal via the
 *  clients.email fallback in _shared/auth.ts (resolvePrincipal → the email-match
 *  branch returns `{ kind:'client', userId: uid }`), and the portal reads its own
 *  support with `requester=eq.uid` (client_delivery.ts readerKey = userId||email).
 *  If the inbound thread were keyed on the email instead, it would be INVISIBLE in
 *  that customer's own portal. So when the contact link yields no auth id, mirror
 *  the portal by resolving the auth user by email via the GoTrue admin API (the
 *  same lookup commerce/deletion.ts uses). '' when no auth user exists at all — a
 *  true never-logged-in contact has no portal, so the stored-email key is correct.
 *  Best-effort: never throws (any failure → '' → the email-key fallback). */
async function authUserIdByEmail(email: string): Promise<string> {
  try {
    const SB = Deno.env.get('SUPABASE_URL') || '';
    const KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!SB || !KEY || !EMAIL_RE.test(String(email))) return '';
    const uq = await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=10&filter=${encodeURIComponent(email)}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!uq.ok) return '';
    const users = (await uq.json())?.users || [];
    const u = Array.isArray(users) ? users.find((x: any) => String(x.email || '').toLowerCase() === email.toLowerCase()) : null;
    return u?.id ? String(u.id) : '';
  } catch { return ''; }
}

export async function handleInboundEmail(req: Request): Promise<Response> {
  // (1) fail-closed: no secret configured → the surface does not exist (§5.3)
  const secret = Deno.env.get('RESEND_INBOUND_SECRET') || '';
  if (!secret) return new Response('not found', { status: 404 });

  // (2) the svix signing headers must all be present
  const svixId = req.headers.get('svix-id') || '';
  const ts = req.headers.get('svix-timestamp') || '';
  const sig = req.headers.get('svix-signature') || '';
  if (!svixId || !ts || !sig) return new Response('bad request', { status: 400 });

  // (3) size guard — the declared length AND a hard streamed cap, BOTH before any HMAC
  const declared = Number(req.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > MAX_BODY) return new Response('payload too large', { status: 413 });
  const payload = await readBodyCapped(req, MAX_BODY);
  if (payload === null) return new Response('payload too large', { status: 413 });

  // (4) verify the signature (shared, clock-injectable verifier — replay-windowed)
  if (!(await verifySvix(svixId, ts, sig, payload, secret))) return new Response('invalid signature', { status: 401 });

  // ── (5) past the signature: every reject ACKS 200 (masked warn) ──
  let evt: any;
  try { evt = JSON.parse(payload); } catch { return dropAck('bad_json'); }
  if (String(evt?.type || '') !== 'email.received') return dropAck(`ignored_type:${String(evt?.type || '').slice(0, 40)}`);
  const data = (evt && typeof evt.data === 'object' && evt.data) ? evt.data : evt;

  // (6) parse
  const parsed = parseInbound(evt);
  if (!parsed) return dropAck('unparseable');
  const { from_email, from_name, to_emails, subject, text, message_id } = parsed;

  // (7) auto-responder → never land, never ack↔autoreply loop
  if (autoResponderSignal(data.headers)) return dropAck('auto_responder', from_email);

  // (8) sender authentication — fail closed; the verdict is named in the warn (S1)
  const verdict = senderAuthVerdict(parseAuthResults(data), from_email);
  if (!verdict.ok) return dropAck(`sender_auth:${verdict.verdict}`, from_email);

  // (9) our own outbound identity or any @inbound-domain address → drop (S5b)
  const inboundDomain = Deno.env.get('RESEND_INBOUND_DOMAIN') || '';
  const emailFromAddr = parseAddress(Deno.env.get('EMAIL_FROM') || 'Davis Digital Studio <eric@davisdigitalstudio.com>').email;
  if (isSelfSender(from_email, [PLATFORM_REPLY_TO, emailFromAddr], inboundDomain)) return dropAck('self_sender', from_email);

  // (10) which tenant was this addressed to?
  const siteAddrs = to_emails.map((t) => siteIdFromAddress(t)).filter((x): x is string => !!x);
  if (siteAddrs.length > 1) console.warn(`[inbound] ${siteAddrs.length} site-addressed recipients — using the first (I4)`);
  const siteId = siteAddrs[0];
  if (!siteId) return dropAck('no_site_recipient', from_email);
  // SB1: a non-ok site read 502s (retry), never a silent 'unknown_site' drop.
  let siteRow;
  try { siteRow = okRows(await svc(`presence_sites?id=eq.${siteId}&select=id&limit=1`))[0]; }
  catch (e) { if (e instanceof InfraRead) return readFailed(); throw e; }
  if (!siteRow) return dropAck('unknown_site', from_email);

  // (11) per-site rate limit — 30 inbound / 10 min
  if (!(await rateAllow(`inbound_email:${siteId}`, 30, 600))) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } });
  }

  // (12) the sender must be filter-safe (an identity key can't carry PostgREST grammar)
  if (filterSafe(from_email) === null) return dropAck('unsafe_from', from_email);

  // (13) idempotency: the message id (or the svix id) is the external key
  const externalId = (message_id || `svix:${svixId}`).slice(0, 300);
  if (await alreadyLanded(siteId, externalId)) return dropAck('already_landed', from_email);

  // (14) match the sender to a KNOWN relationship on this site (else spam surface).
  //      SB1: matchSiteIdentity's identity reads use okRows — a transient failure
  //      there 502s (Resend retries), never a silent 'unknown_sender' spam-drop.
  let match: SiteIdentity | null;
  try { match = await matchSiteIdentity(siteId, from_email); }
  catch (e) { if (e instanceof InfraRead) return readFailed(); throw e; }
  if (!match) return dropAck('unknown_sender', from_email);
  if (match.candidates > 1) console.warn(`[inbound] ${match.candidates} identity candidates for ${maskEmail(from_email)} — using the first (I2)`);

  // (15) requester key (I1) + filter-safe aliases. Prefer the portal readerKey
  //      (the auth user id) so a studio reply + the customer's portal + this inbound
  //      path all resolve to ONE requester. The auth id comes from the linked
  //      contact; failing that, from the sender's email (authUserIdByEmail — mirrors
  //      the portal's email-login fallback so an email-authenticated bridged client
  //      whose contact carries no auth_user_id still sees this thread in their own
  //      portal). Only a never-logged-in contact (no auth user at all) falls back to
  //      the matched STORED-casing email (the raw key the studio channels match on —
  //      lowercasing the From would orphan the thread).
  let authId = '';
  if (match.contactId) { const ct = rows(await svc(`contacts?id=eq.${match.contactId}&select=auth_user_id&limit=1`))[0]; authId = ct?.auth_user_id ? String(ct.auth_user_id) : ''; }
  if (!authId) authId = await authUserIdByEmail(from_email);   // I1: mirror the portal's email-login uid
  const storedEmail = matchedStoredEmail(from_email, match.emails) || from_email;
  const requesterKey = deriveRequesterKey(authId, storedEmail);
  if (filterSafe(requesterKey) === null) return dropAck('unsafe_requester', from_email);
  const aliases: string[] = [];
  for (const a of identityAliases([authId, ...match.emails, from_email])) {
    if (filterSafe(a) === null) { console.warn('[inbound] skipping grammar-bearing identity alias'); continue; }
    aliases.push(a);
  }

  // (16) REFERENCE THREADING (F1): before ANY subject/project routing, an
  //      In-Reply-To/References id that matches a STORED inbound Message-Id pins
  //      the reply to ITS OWN support thread — regardless of subject or
  //      open-status. Appending to a resolved/closed thread REOPENS it (the
  //      client answered; a closed ticket must not silently swallow the reply).
  const refs = referenceIds(data.headers).filter((x) => filterSafe(x) !== null);
  let refTarget: any = null;
  if (refs.length) {
    try { refTarget = await findThreadByReferences(siteId, refs); }
    catch (e) { if (e instanceof InfraRead) return readFailed(); throw e; }
  }
  if (refTarget) {
    if (await alreadyLanded(siteId, externalId)) return dropAck('already_landed_race', from_email);
    const ins = await insertDeduped('presence_support_messages',
      { site_id: siteId, request_id: refTarget.id, body: text || subject || '(no content)', author: refTarget.requester, author_kind: 'client' }, externalId);
    if (!ins.ok) return json({ error: 'write_failed' }, 502);
    if (ins.duplicate) return dropAck('duplicate_message', from_email);
    // L1 bump — and the reopen: a reply onto a resolved/closed thread flips it
    // back to open (resolved_at cleared) so the studio's queue surfaces it again.
    const reopen = refTarget.status === 'resolved' || refTarget.status === 'closed';
    await svc(`presence_support_requests?id=eq.${refTarget.id}&site_id=eq.${siteId}`, { method: 'PATCH',
      body: JSON.stringify(reopen ? { status: 'open', resolved_at: null, updated_at: nowIso() } : { updated_at: nowIso() }) }).catch(() => {});
    if (refTarget.project_id) {
      await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ project_id: refTarget.project_id, site_id: siteId, kind: 'support_message', actor: refTarget.requester, actor_kind: 'client', client_visible: true, detail: { from: 'client', request_id: refTarget.id, via: 'email' } }) }).catch(() => {});
    }
    return ack();
  }

  // (17) PROJECT LANDING (F1): a bridged CLIENT with a live delivery project →
  //      their email IS a project message, landed exactly as the portal composer
  //      path (project_comms/client_delivery: audience client, author kind
  //      client, plus the kind:'message' event with detail.from='client' the
  //      workspace feed + inbox Messages grouping key on). The support spine is
  //      only the fallback for clients with no live project (and contacts).
  if (match.kind === 'client' && match.projectId) {
    let proj: any = null;
    try { proj = okRows(await svc(`presence_projects?id=eq.${match.projectId}&site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`))[0]; }
    catch (e) { if (e instanceof InfraRead) return readFailed(); throw e; }
    if (proj) {
      if (await alreadyLanded(siteId, externalId)) return dropAck('already_landed_race', from_email);
      const ins = await insertDeduped('presence_project_messages',
        { site_id: siteId, project_id: match.projectId, audience: 'client', body: text || subject || '(no content)', author: requesterKey, author_kind: 'client' }, externalId);
      if (!ins.ok) return json({ error: 'write_failed' }, 502);   // landable + infra failure → Resend retries
      if (ins.duplicate) return dropAck('duplicate_message', from_email);
      // the ONE activity log — same event the portal client door writes, so the
      // studio bell/feed/Inbox treat an emailed message exactly like a portal one.
      // (Mirrors the portal path: a client→studio message emails no one.)
      await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ project_id: match.projectId, site_id: siteId, kind: 'message', actor: requesterKey, actor_kind: 'client', client_visible: true, detail: { from: 'client', message_id: ins.row?.id, via: 'email' } }) }).catch(() => {});
      return ack();
    }
  }

  // (18) SUPPORT SPINE (fallback): the sender's OPEN threads on this site (any
  //      alias key), newest first. SC1: okRows — a non-ok open-threads read 502s
  //      (retry) rather than reading as "no open threads" and opening a
  //      DUPLICATE new request on a live sender.
  let openThreads;
  try {
    openThreads = aliases.length
      ? okRows(await svc(`presence_support_requests?site_id=eq.${siteId}&status=in.(open,in_progress)&deleted_at=is.null&requester=in.(${aliases.map((a) => filterKey(a)).join(',')})&select=id,subject,requester,project_id,created_at&order=created_at.desc&limit=50`))
      : [];
  } catch (e) { if (e instanceof InfraRead) return readFailed(); throw e; }

  // append to the newest subject-matching open thread, else (19) open a new one
  const target = selectAppendTarget(openThreads, subject);
  if (target) {
    // D1: re-check dedupe RIGHT before the insert (cross-table race). HONEST CAVEAT:
    // this narrows but cannot fully close a sub-second window between the landing
    // tables' external_id keys — the per-table unique index catches a same-table
    // retry; a genuine cross-table collision in that window is the residual gap.
    if (await alreadyLanded(siteId, externalId)) return dropAck('already_landed_race', from_email);
    const ins = await insertDeduped('presence_support_messages',
      { site_id: siteId, request_id: target.id, body: text || subject || '(no content)', author: target.requester, author_kind: 'client' }, externalId);
    if (!ins.ok) return json({ error: 'write_failed' }, 502);   // landable + infra failure → Resend retries
    if (ins.duplicate) return dropAck('duplicate_message', from_email);
    // L1: bump the request's updated_at — the studio bell/feed windows are updated_at-
    // keyed and a bare message INSERT never bumps it. Best-effort PATCH. FOLLOW-UP:
    // the portal reply path (client_delivery handleClientSupportMessage) shares this
    // exact gap and should adopt the same bump.
    await svc(`presence_support_requests?id=eq.${target.id}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ updated_at: nowIso() }) }).catch(() => {});
    // project-linked → feed the ONE activity log (detail.from='client' audience invariant)
    if (target.project_id) {
      await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ project_id: target.project_id, site_id: siteId, kind: 'support_message', actor: target.requester, actor_kind: 'client', client_visible: true, detail: { from: 'client', request_id: target.id, via: 'email' } }) }).catch(() => {});
    }
    return ack();
  }

  // (19) a new support request, in the handleClientSupport shape — stamped with
  //      the matched client's id (F3) so read paths never have to re-derive WHO
  //      this is by string-matching requester keys. client_id rides as an
  //      OPTIONAL column: a pre-0115 database strips exactly it on the precise
  //      missing-column signal and keeps the external_id dedup key.
  const newReq = await insertDeduped('presence_support_requests',
    { site_id: siteId, project_id: null, subject: subject || `Email from ${from_name || from_email}`, body: text || subject || '', status: 'open', priority: 'normal', requester: requesterKey, requester_kind: 'client',
      ...(match.kind === 'client' ? { client_id: match.id } : {}) }, externalId, match.kind === 'client' ? ['client_id'] : []);
  if (!newReq.ok) return json({ error: 'write_failed' }, 502);
  if (newReq.duplicate) return dropAck('duplicate_request', from_email);
  await ackSender(siteId, from_email);
  return ack();
}
