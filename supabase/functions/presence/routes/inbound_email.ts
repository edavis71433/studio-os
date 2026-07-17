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
  selectAppendTarget, missingColumnSignal, maskEmail,
} from '../lib/inbound_email.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 256 * 1024;   // 256KB — an inbound email above this isn't a real client reply
const PLATFORM_REPLY_TO = Deno.env.get('PLATFORM_REPLY_TO') || 'eric@davisdigitalstudio.com';
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

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

/** Has this exact external_id already landed on this site (either support table)?
 *  Both reads are site-scoped. Best-effort: pre-0114 the external_id column
 *  doesn't exist, so PostgREST errors → treat as NOT landed (dedup degrades to the
 *  unique index once 0114 is applied; the code never blocks on the column). */
async function alreadyLanded(siteId: string, externalId: string): Promise<boolean> {
  if (!externalId) return false;
  try {
    const enc = encodeURIComponent(externalId);
    const [m, r] = await Promise.all([
      svc(`presence_support_messages?site_id=eq.${siteId}&external_id=eq.${enc}&select=id&limit=1`),
      svc(`presence_support_requests?site_id=eq.${siteId}&external_id=eq.${enc}&select=id&limit=1`),
    ]);
    if (!m.ok || !r.ok) return false;   // column missing (pre-0114) → not landed
    return rows(m).length > 0 || rows(r).length > 0;
  } catch { return false; }
}

/** Insert a row carrying its external_id for idempotency. A unique-index conflict
 *  (409) means the message already landed → {duplicate}. ONLY on the precise
 *  missing-column signal (pre-0114) do we retry ONCE without the key — never
 *  silently stripping it. ANY other failure returns !ok so the route 502s and
 *  Resend retries (the message is landable, the failure was infra). */
async function insertDeduped(table: string, row: Record<string, unknown>, externalId: string): Promise<{ ok: boolean; row?: any; duplicate?: boolean }> {
  const post = (body: unknown) => svc(table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  let r = await post({ ...row, external_id: externalId });
  if (r.ok && rows(r)[0]) return { ok: true, row: rows(r)[0] };
  if (r.status === 409) return { ok: true, duplicate: true };   // unique(site_id, external_id) → already landed
  if (missingColumnSignal(r.json, r.text)) {
    r = await post(row);   // pre-0114 retry — WITHOUT the key, once, only on this signal
    if (r.ok && rows(r)[0]) return { ok: true, row: rows(r)[0] };
    if (r.status === 409) return { ok: true, duplicate: true };
  }
  return { ok: false };
}

interface SiteIdentity { kind: 'client' | 'contact'; id: string; contactId: string | null; emails: string[]; candidates: number }

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
  // 1) clients matched by email OR contact_email (ilike over-matches → exact recheck)
  const clientRows = rows(await svc(`clients?or=(email.ilike.${enc},contact_email.ilike.${enc})&deleted_at=is.null&select=id,email,contact_email,contact_id,created_at&order=created_at.asc,id.asc&limit=25`))
    .filter((c) => String(c.email || '').toLowerCase() === fromEmail.toLowerCase() || String(c.contact_email || '').toLowerCase() === fromEmail.toLowerCase());
  const clientIds = clientRows.map((c) => String(c.id)).filter((id) => UUID_RE.test(id));
  if (clientIds.length) {
    // bridged precedence: only a client with an ACTIVE link to THIS agency site is a valid sender here
    const links = rows(await svc(`presence_service_links?agency_site_id=eq.${siteId}&status=eq.active&customer_client_id=in.(${clientIds.join(',')})&select=customer_client_id&limit=25`));
    const bridged = new Set(links.map((l) => String(l.customer_client_id)));
    const hit = clientRows.find((c) => bridged.has(String(c.id)));
    if (hit) return { kind: 'client', id: String(hit.id), contactId: hit.contact_id ? String(hit.contact_id) : null, emails: [hit.email, hit.contact_email].filter((e) => e && String(e).trim()).map(String), candidates: clientRows.filter((c) => bridged.has(String(c.id))).length };
  }
  // 2) a CRM contact on THIS site (site-scoped), matched the same way
  const contactRows = rows(await svc(`presence_contacts?site_id=eq.${siteId}&email=ilike.${enc}&deleted_at=is.null&select=id,email,created_at&order=created_at.asc,id.asc&limit=25`))
    .filter((c) => String(c.email || '').toLowerCase() === fromEmail.toLowerCase());
  if (contactRows.length) {
    const c = contactRows[0];
    return { kind: 'contact', id: String(c.id), contactId: null, emails: [c.email].filter((e) => e && String(e).trim()).map(String), candidates: contactRows.length };
  }
  return null;
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
  const siteRow = rows(await svc(`presence_sites?id=eq.${siteId}&select=id&limit=1`))[0];
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

  // (14) match the sender to a KNOWN relationship on this site (else spam surface)
  const match = await matchSiteIdentity(siteId, from_email);
  if (!match) return dropAck('unknown_sender', from_email);
  if (match.candidates > 1) console.warn(`[inbound] ${match.candidates} identity candidates for ${maskEmail(from_email)} — using the first (I2)`);

  // (15) requester key (I1) + filter-safe aliases. Prefer the portal readerKey
  //      (auth user id via the linked contact) so a studio reply + the customer's
  //      portal + this inbound path all resolve to ONE requester; else the matched
  //      STORED-casing email (the raw key every channel matches on — lowercasing
  //      the From would orphan the thread).
  let authId = '';
  if (match.contactId) { const ct = rows(await svc(`contacts?id=eq.${match.contactId}&select=auth_user_id&limit=1`))[0]; authId = ct?.auth_user_id ? String(ct.auth_user_id) : ''; }
  const storedEmail = matchedStoredEmail(from_email, match.emails) || from_email;
  const requesterKey = deriveRequesterKey(authId, storedEmail);
  if (filterSafe(requesterKey) === null) return dropAck('unsafe_requester', from_email);
  const aliases: string[] = [];
  for (const a of identityAliases([authId, ...match.emails, from_email])) {
    if (filterSafe(a) === null) { console.warn('[inbound] skipping grammar-bearing identity alias'); continue; }
    aliases.push(a);
  }

  // (16) the sender's OPEN threads on this site (any alias key), newest first
  const openThreads = aliases.length
    ? rows(await svc(`presence_support_requests?site_id=eq.${siteId}&status=in.(open,in_progress)&deleted_at=is.null&requester=in.(${aliases.map((a) => filterKey(a)).join(',')})&select=id,subject,requester,project_id,created_at&order=created_at.desc&limit=50`))
    : [];

  // (17) append to the newest subject-matching open thread, else (18) open a new one
  const target = selectAppendTarget(openThreads, subject);
  if (target) {
    // D1: re-check dedupe RIGHT before the insert (cross-table race). HONEST CAVEAT:
    // this narrows but cannot fully close a sub-second window between the two support
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

  // (18) a new support request, in the handleClientSupport shape
  const newReq = await insertDeduped('presence_support_requests',
    { site_id: siteId, project_id: null, subject: subject || `Email from ${from_name || from_email}`, body: text || subject || '', status: 'open', priority: 'normal', requester: requesterKey, requester_kind: 'client' }, externalId);
  if (!newReq.ok) return json({ error: 'write_failed' }, 502);
  if (newReq.duplicate) return dropAck('duplicate_request', from_email);
  await ackSender(siteId, from_email);
  return ack();
}
