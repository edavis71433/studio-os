// ── Inbound email capture — PURE parsing + policy core (CRM redesign, slice 6) ─
// A client's email reply lands here (Resend Inbound webhook → the pre-auth route
// in routes/inbound_email.ts). This module is ALL pure logic: payload parsing,
// sender-authentication verdict, auto-responder detection, identity-key shaping,
// thread-append selection. No imports, no I/O — every function is unit-tested in
// tests/presence/inbound_email_test.mjs. The impure route wires these into the
// PostgREST reads/writes + the branded ack.
//
// SENDER-AUTH TRUST BOUNDARY (SA1, security-critical): the go/no-go on a sender's
// authenticity is computed ONLY from the provider's STRUCTURED verdict fields
// (data.dmarc/spf/dkim — a bare string OR an object). We NEVER parse the message's
// own `Authentication-Results` header stanzas for the pass/fail decision. Those
// stanzas travel INSIDE the email body/headers and are attacker-controlled: a
// spoofer can embed `Authentication-Results: dmarc=pass header.from=acme.com` and,
// if we trusted it, walk straight through the gate. We cannot distinguish Resend's
// OWN stamped Authentication-Results from a forged one without an authserv-id
// allowlist (which the proxy-blocked Inbound docs don't give us), so raw AR headers
// are treated as untrusted text and never feed the verdict. Consequence: if Resend
// only ever forwards raw AR headers and supplies no structured verdict, mail FAILS
// CLOSED (verdict 'none' → drop). The mitigation is the runbook's "configure
// DKIM/SPF in Resend so it stamps a structured verdict" step — see
// docs/presence/INBOUND-EMAIL-SETUP.md.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Control-char strip (keeps \t and \n) + length cap — the platform clean() idiom. */
const clean = (s: unknown, max = 500): string =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);

/** The domain part of an email address (lowercased). '' when there is no @. */
function domainOf(email: unknown): string {
  const s = String(email ?? '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  return at >= 0 ? s.slice(at + 1) : '';
}

// ── HTML → text ───────────────────────────────────────────────────────────────
/** Strip HTML to a plain-text body. A 100k INPUT CAP is applied BEFORE any regex
 *  (a hostile megabyte of nested tags is a backtracking / CPU surface, so it is
 *  truncated first, not after). Unclosed <script>/<style> blocks are stripped to
 *  end-of-input (otherwise their raw JS/CSS would leak into the text). Entities
 *  are decoded with &amp; LAST so "&amp;amp;" decodes ONCE to "&amp;", never
 *  twice to "&" (double-decoding a deliberately-escaped entity). Pure. */
export function stripHtml(html: unknown): string {
  let s = String(html ?? '').slice(0, 100_000); // INPUT cap BEFORE the regex passes
  // closed script/style blocks (content and all)
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
       .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  // an UNCLOSED <script>/<style> (no closing tag) → strip to end-of-input
  s = s.replace(/<script\b[^>]*>[\s\S]*$/gi, ' ')
       .replace(/<style\b[^>]*>[\s\S]*$/gi, ' ');
  // block-ish tags → newlines so paragraphs survive the strip
  s = s.replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6]|\/li)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');   // remaining tags
  // entity decode — &amp; LAST (single decode, no double-decode)
  s = s.replace(/&nbsp;/gi, ' ')
       .replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"')
       .replace(/&#0?39;|&apos;/gi, "'")
       .replace(/&amp;/gi, '&');    // LAST
  return s.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Address parsing ─────────────────────────────────────────────────────────
function cleanAddrEmail(raw: string): string {
  const t = raw.replace(/^[<"'\s]+|[>"'\s]+$/g, '').trim().toLowerCase();
  return EMAIL_RE.test(t) ? t : '';
}

/** Parse an address in any display form ("Name" <e@x>, Name <e@x>, e@x) or an
 *  object ({email|address, name}). The email is lowercased; the name is trimmed
 *  (never lowercased). Pure. */
export function parseAddress(input: unknown): { email: string; name: string } {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    return { email: cleanAddrEmail(String(o.email ?? o.address ?? '')), name: String(o.name ?? '').trim() };
  }
  const rawInput = String(input ?? '').trim();
  const m = rawInput.match(/^\s*(?:"([^"]*)"|([^<]*?))?\s*<([^>]+)>\s*$/);
  if (m) return { email: cleanAddrEmail(String(m[3])), name: (m[1] ?? m[2] ?? '').trim() };
  return { email: cleanAddrEmail(rawInput), name: '' };
}

/** The site UUID an inbound message was ADDRESSED to: the local part of a
 *  recipient (before any +tag), gated by the UUID regex. `<siteId>+anything@dom`
 *  and `<siteId>@dom` both resolve; anything whose local part isn't a UUID → null.
 *  Pure. */
export function siteIdFromAddress(input: unknown): string | null {
  const { email } = parseAddress(input);
  const at = email.indexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at).split('+')[0].trim();
  return UUID_RE.test(local) ? local.toLowerCase() : null;
}

// ── Header access (array-of-{name,value} OR object-map, case-insensitive) ────
/** All values for a header name, across both shapes providers send headers in:
 *  an array of {name,value} objects, or a plain object map. Case-insensitive on
 *  the name; a value that is itself an array is joined (multi-value). Pure. */
export function headerValues(headers: unknown, name: string): string[] {
  const want = String(name).toLowerCase();
  const out: string[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) out.push(v.map((x) => String(x)).join(', '));
    else if (v != null) out.push(String(v));
  };
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (h && typeof h === 'object') {
        const hn = String((h as any).name ?? (h as any).key ?? '').toLowerCase();
        if (hn === want) push((h as any).value ?? (h as any).val);
      }
    }
  } else if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.toLowerCase() === want) push(v);
    }
  }
  return out;
}
const headerValue = (headers: unknown, name: string): string => headerValues(headers, name).join(', ');

// ── Sender authentication (DMARC / SPF / DKIM) ───────────────────────────────
export interface AuthResult { result: string; domain: string }
export interface ParsedAuth { dmarc: AuthResult | null; spf: AuthResult | null; dkim: AuthResult[] }

/** Normalize a domain for alignment comparison: lowercase, drop a leading @,
 *  keep only the part after the last @, trim trailing dots/space. */
function cleanDomain(d: unknown): string {
  let s = String(d ?? '').trim().toLowerCase().replace(/^@/, '').replace(/[.\s]+$/, '');
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  return s;
}

/** Coerce a structured auth field — a bare string ("pass") OR an object
 *  ({result|status|verdict, domain}) — into an AuthResult. Null when absent. */
function coerceAuth(v: unknown): AuthResult | null {
  if (v == null) return null;
  if (typeof v === 'string') { const r = v.trim().toLowerCase(); return r ? { result: r, domain: '' } : null; }
  if (typeof v === 'object') {
    const o = v as any;
    const result = String(o.result ?? o.status ?? o.verdict ?? '').trim().toLowerCase();
    const domain = cleanDomain(o.domain ?? o.header_d ?? o.header_i ?? o.mailfrom ?? '');
    return result ? { result, domain } : null;
  }
  return null;
}
function coerceAuthList(v: unknown): AuthResult[] {
  if (Array.isArray(v)) return v.map(coerceAuth).filter((x): x is AuthResult => !!x);
  const one = coerceAuth(v);
  return one ? [one] : [];
}

/** The authentication picture from a webhook `data` payload — computed ONLY from
 *  the provider's STRUCTURED verdict fields (data.dmarc/spf/dkim; each a bare
 *  string OR an object). SECURITY (SA1): the message's own `Authentication-Results`
 *  header stanzas are attacker-controlled and are DELIBERATELY NOT parsed here —
 *  trusting them would let a spoofer stamp their own `dmarc=pass` and bypass the
 *  gate. If the provider supplies no structured verdict, this returns all-null and
 *  senderAuthVerdict fails closed ('none' → drop). Pure. */
export function parseAuthResults(data: unknown): ParsedAuth {
  const d = (data && typeof data === 'object') ? data as any : {};
  return { dmarc: coerceAuth(d.dmarc), spf: coerceAuth(d.spf), dkim: coerceAuthList(d.dkim) };
}

/** Relaxed/suffix domain alignment. NO Public Suffix List is available here, so
 *  the org boundary is APPROXIMATED as a shared suffix (a.example.com aligns with
 *  example.com). HONEST CAVEAT: this can't distinguish a registrable boundary
 *  from a public suffix (it would treat foo.co.uk / bar.co.uk as aligned). This
 *  is acceptable because it is only the SECONDARY trust path — a DMARC pass is
 *  the primary signal — and a spoofer would still need a genuinely passing,
 *  suffix-related SPF *and* DKIM signature. */
function aligned(authDomain: string, fromDomain: string): boolean {
  if (!authDomain || !fromDomain) return false;
  if (authDomain === fromDomain) return true;   // strict alignment
  return authDomain.endsWith('.' + fromDomain) || fromDomain.endsWith('.' + authDomain);
}

/** The go/no-go on a sender's authenticity. Policy:
 *   • DMARC=pass                                     → ok (upstream already proved alignment)
 *   • else SPF=pass AND DKIM=pass, BOTH aligned to the From domain → ok
 *   • NO verdict present at all                      → {ok:false, verdict:'none'} (FAIL CLOSED)
 *  Returns a named verdict so the route can log WHY it dropped. Pure. */
export function senderAuthVerdict(results: ParsedAuth, fromEmail: unknown): { ok: boolean; verdict: string } {
  const fromDomain = domainOf(fromEmail);
  const has = (a: AuthResult | null): boolean => !!a && !!a.result;
  const anyVerdict = has(results.dmarc) || has(results.spf) || results.dkim.some(has);
  if (!anyVerdict) return { ok: false, verdict: 'none' };   // nothing to trust → reject
  if (results.dmarc && results.dmarc.result === 'pass') return { ok: true, verdict: 'dmarc_pass' };
  const spfPass = !!results.spf && results.spf.result === 'pass' && aligned(results.spf.domain, fromDomain);
  const dkimPass = results.dkim.some((d) => d.result === 'pass' && aligned(d.domain, fromDomain));
  if (spfPass && dkimPass) return { ok: true, verdict: 'spf_dkim_aligned' };
  if (results.dmarc && results.dmarc.result !== 'pass') return { ok: false, verdict: `dmarc_${results.dmarc.result}` };
  return { ok: false, verdict: 'unaligned' };
}

// ── Auto-responder detection (never reply to a bot, never loop) ──────────────
/** True when the message looks machine-generated (a vacation autoreply, a bounce,
 *  a bulk blast) — landing it would risk an ack↔autoreply loop. Flags
 *  Auto-Submitted≠no, any X-Auto-Response-Suppress, Precedence bulk/auto_reply/junk.
 *  Does NOT flag Precedence:list (legit mailing list) or Auto-Submitted:no (a real
 *  human reply explicitly marks itself 'no'). Pure. */
export function autoResponderSignal(headers: unknown): boolean {
  const autoSub = headerValue(headers, 'auto-submitted').trim().toLowerCase();
  if (autoSub && autoSub !== 'no') return true;
  if (headerValues(headers, 'x-auto-response-suppress').length) return true;
  const prec = headerValue(headers, 'precedence').toLowerCase();
  if (/\b(bulk|auto_reply|junk)\b/.test(prec)) return true;   // NOT 'list'
  return false;
}

/** True when the sender is OUR OWN identity (a platform/agency outbound address)
 *  or ANY address at the inbound domain — landing our own mail would loop the ack.
 *  `ourIdentities` is [PLATFORM_REPLY_TO, parsed EMAIL_FROM]. Pure. */
export function isSelfSender(fromEmail: unknown, ourIdentities: Array<string | null | undefined>, inboundDomain?: string | null): boolean {
  const from = String(fromEmail ?? '').trim().toLowerCase();
  if (!from) return false;
  for (const id of ourIdentities) { const e = String(id ?? '').trim().toLowerCase(); if (e && e === from) return true; }
  const dom = String(inboundDomain ?? '').trim().toLowerCase().replace(/^@/, '');
  return !!dom && domainOf(from) === dom;
}

// ── PostgREST filter-grammar safety (§5.4) ───────────────────────────────────
/** REJECT (return null) — NEVER mangle — any value carrying PostgREST filter
 *  grammar: ( ) , * " \ . An identity key with these can't be safely embedded in
 *  a filter, and rewriting it would silently change WHOSE thread we match. Pure. */
export function filterSafe(v: unknown): string | null {
  const s = String(v ?? '');
  if (!s) return null;
  return /[(),*"\\]/.test(s) ? null : s;
}

/** The quoted `in.(…)` list form of an identity key (matches crm.ts /
 *  project_comms.ts customerRequesterKeys). Pure. */
export function filterKey(v: unknown): string {
  return encodeURIComponent(`"${String(v ?? '').replace(/"/g, '')}"`);
}

// ── Identity-key shaping ─────────────────────────────────────────────────────
/** The requester key a landed message is authored under: the portal readerKey
 *  (auth user id) when known, else the matched STORED-casing email. Mirrors the
 *  `principal.userId || email` reader key the support store uses everywhere. Pure. */
export function deriveRequesterKey(authId: unknown, storedEmail: unknown): string {
  const a = String(authId ?? '').trim();
  return a || String(storedEmail ?? '').trim();
}

/** The EXACT stored-casing email that matches an inbound From (compared
 *  case-insensitively). The raw stored casing is returned because every channel
 *  (workspace requesterToClient, crm customerRequesterKeys) matches RAW keys —
 *  lowercasing the From would orphan the thread. null when none match. Pure. */
export function matchedStoredEmail(fromEmail: unknown, storedEmails: Array<string | null | undefined>): string | null {
  const from = String(fromEmail ?? '').trim().toLowerCase();
  if (!from) return null;
  for (const s of storedEmails) { const e = String(s ?? '').trim(); if (e && e.toLowerCase() === from) return e; }
  return null;
}

/** Distinct, non-empty identity aliases in order (dedup preserves first seen). Pure. */
export function identityAliases(candidates: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) { const s = String(c ?? '').trim(); if (s && !seen.has(s)) { seen.add(s); out.push(s); } }
  return out;
}

// ── Subject normalization + thread-append selection ──────────────────────────
/** Strip a chain of leading Re:/Fw:/Fwd: markers (incl. "Re[2]:" counts), collapse
 *  whitespace, casefold — so "Re: Fwd: Website copy" and "website copy" match. Pure. */
export function normalizeSubject(subject: unknown): string {
  let s = String(subject ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  let prev: string;
  do { prev = s; s = s.replace(/^\s*(re|fw|fwd)\s*(\[\d+\])?\s*:\s*/i, ''); } while (s !== prev);
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Choose which OPEN thread a reply should append to: the NEWEST-by-created_at
 *  thread whose normalized subject equals the email's. No subject match → null (a
 *  new request is opened). I3: an email whose subject NORMALIZES TO EMPTY does NOT
 *  append — appending a subject-less message to whatever thread happens to be
 *  newest would bury an unrelated topic AND skip the ack. It returns null, so the
 *  route opens a NEW request (fallback subject "Email from <name>") and acks. We
 *  only append on a genuine, non-empty normalized-subject match.
 *  FOLLOW-UP (I4): threading is subject-match only; it ignores In-Reply-To /
 *  References. True RFC-5322 reference threading needs us to capture OUTBOUND
 *  Message-Ids first (out of scope for this slice), so the newest-by-created_at
 *  subject match is the deterministic rule. Pure. */
export function selectAppendTarget<T extends { subject?: unknown; created_at?: unknown }>(openThreads: T[], subject: unknown): T | null {
  const threads = Array.isArray(openThreads) ? openThreads.slice() : [];
  if (!threads.length) return null;
  const norm = normalizeSubject(subject);
  if (!norm) return null;   // I3: empty/normalizes-to-empty subject → open a NEW request, never bury a thread
  const byNewest = (a: T, b: T) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  const matches = threads.filter((t) => normalizeSubject(t.subject) === norm);
  return matches.length ? matches.sort(byNewest)[0] : null;
}

// ── Reference threading (RFC 5322 In-Reply-To / References) ──────────────────
/** The <message-id> tokens a reply carries in its In-Reply-To + References
 *  headers, In-Reply-To first, deduped, order-preserving, capped at 20 entries
 *  of ≤300 chars each. We store INBOUND Message-Ids as external_id (0114/0115),
 *  so a reply inside a thread that STARTED with the sender's own email carries
 *  one of these ids — that pins the reply to its own thread regardless of
 *  subject rewrites or open-status. Pure. */
export function referenceIds(headers: unknown): string[] {
  const raw = `${headerValue(headers, 'in-reply-to')} ${headerValue(headers, 'references')}`;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of raw.matchAll(/<[^<>\s]+>/g)) {
    const id = m[0].slice(0, 300);
    if (!seen.has(id)) { seen.add(id); out.push(id); }
    if (out.length >= 20) break;
  }
  return out;
}

/** R6 — compare-time bracket normalization. A stored external_id is the id
 *  AS-RECEIVED (data.message_id may lack the RFC 5322 angle brackets) while
 *  referenceIds tokens are always bracketed — comparing only one form silently
 *  breaks threading for the other. Returns every comparable form of an id
 *  (as-given, bare, bracketed), deduped, order-preserving; the caller queries
 *  `external_id=in.(…)` with ALL of them. Storage stays untouched (0114/0115
 *  data compatibility — normalization happens at COMPARE time only). Pure. */
export function messageIdVariants(id: unknown): string[] {
  const s = String(id ?? '').trim();
  if (!s) return [];
  const bare = s.replace(/^<\s*/, '').replace(/\s*>\s*$/, '').trim();
  const out: string[] = [];
  for (const v of [s, bare, bare ? `<${bare}>` : '']) if (v && !out.includes(v)) out.push(v);
  return out;
}

// ── Deploy-order tolerance + log masking ─────────────────────────────────────
/** True when a PostgREST error is "the <column> column doesn't exist yet"
 *  (pre-0114 external_id / pre-0115 client_id). PGRST204 / Postgres 42703, or a
 *  message naming the column — so a caller can retry the write without the key
 *  (never SILENTLY, only on this precise signal). Pure. */
export function missingColumnSignal(json: unknown, text: unknown, column = 'external_id'): boolean {
  const j = (json && typeof json === 'object') ? json as any : {};
  const code = String(j.code ?? '');
  if (code === 'PGRST204' || code === '42703') return true;
  const hay = `${String(j.message ?? '')} ${String(j.details ?? '')} ${String(text ?? '')}`.toLowerCase();
  return hay.includes(String(column).toLowerCase()) && /(column|schema cache|does not exist|could not find)/.test(hay);
}

/** Which OPTIONAL insert columns a PostgREST missing-column error asks us to
 *  strip. [] when the error is NOT a missing-column signal at all. When it IS
 *  (PGRST204/42703, or the message names a candidate): the candidates the
 *  message actually NAMES — or, if none is named (a bare code), only the
 *  NON-DEDUP-CRITICAL candidates (R8): external_id is the idempotency key, and
 *  a bare code naming no column can never justify silently landing a row
 *  without dedup. If nothing non-critical remains, [] — the caller surfaces
 *  the failure (502 → the webhook retries) instead of stripping the key. The
 *  route retries the insert with exactly these stripped — precise, bounded,
 *  never a silent strip-everything on an unrelated failure. Pure. */
export function missingInsertColumns(json: unknown, text: unknown, candidates: string[]): string[] {
  const list = Array.isArray(candidates) ? candidates.filter((c) => typeof c === 'string' && c) : [];
  if (!list.length) return [];
  const j = (json && typeof json === 'object') ? json as any : {};
  const code = String(j.code ?? '');
  const hay = `${String(j.message ?? '')} ${String(j.details ?? '')} ${String(text ?? '')}`.toLowerCase();
  const named = list.filter((c) => hay.includes(c.toLowerCase()));
  const signal = code === 'PGRST204' || code === '42703' ||
    (named.length > 0 && /(column|schema cache|does not exist|could not find)/.test(hay));
  if (!signal) return [];
  return named.length ? named : list.filter((c) => c !== 'external_id');   // R8: never strip the dedup key on a bare code
}

/** Mask a recipient for logs (edge logs are operator-visible + retained). Pure. */
export function maskEmail(email: unknown): string {
  const s = String(email ?? '');
  const at = s.indexOf('@');
  return at <= 0 ? '***' : `${s[0]}***@${s.slice(at + 1)}`;
}

// ── The payload parser ───────────────────────────────────────────────────────
export interface Inbound {
  message_id: string; from_email: string; from_name: string;
  to_email: string; to_emails: string[]; subject: string; text: string;
}

function collectAddresses(v: unknown): Array<{ email: string; name: string }> {
  if (v == null) return [];
  const items = Array.isArray(v) ? v : [v];
  const out: Array<{ email: string; name: string }> = [];
  for (const it of items) {
    if (typeof it === 'string') { for (const part of it.split(',')) { const a = parseAddress(part); if (a.email) out.push(a); } }
    else { const a = parseAddress(it); if (a.email) out.push(a); }
  }
  return out;
}

/** Parse a Resend Inbound webhook payload into the fields the route needs, or
 *  null if it isn't a usable message. from = string | {email}; to/cc = string |
 *  string[] | object[]; html-only bodies are stripped to text; subject capped at
 *  200, body cleaned + capped at 5000. Rejects a message with no sender, or with
 *  neither a subject nor a body. Pure. */
export function parseInbound(payload: unknown): Inbound | null {
  const p = (payload && typeof payload === 'object') ? payload as any : null;
  if (!p) return null;
  const data = (p.data && typeof p.data === 'object') ? p.data : p;   // {data:{…}} or a bare data object
  const fromA = parseAddress(data.from ?? data.sender ?? data.from_email);
  const from_email = fromA.email;
  if (!from_email) return null;
  const from_name = clean(fromA.name || (typeof data.from_name === 'string' ? data.from_name : ''), 200);
  const toList = collectAddresses(data.to).concat(collectAddresses(data.cc));
  const to_emails = [...new Set(toList.map((a) => a.email).filter(Boolean))];
  const to_email = to_emails[0] || '';
  const subject = clean(data.subject, 200);
  let text = '';
  if (typeof data.text === 'string' && data.text.trim()) text = data.text;
  else if (typeof data.html === 'string' && data.html.trim()) text = stripHtml(data.html);
  else if (typeof data.body === 'string' && data.body.trim()) text = data.body;
  text = clean(text, 5000);
  const message_id = clean(data.message_id ?? data.messageId ?? data['message-id'] ?? headerValue(data.headers, 'message-id'), 300);
  if (!subject && !text) return null;   // an empty message lands nothing
  return { message_id, from_email, from_name, to_email, to_emails, subject, text };
}
