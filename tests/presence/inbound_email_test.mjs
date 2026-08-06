// ── Inbound email capture (CRM slice 6) — pure helpers + behavioral decision table ─
//   deno run --allow-read --allow-env --allow-net tests/presence/inbound_email_test.mjs
// Part A unit-tests EVERY pure helper in lib/inbound_email.ts. Part B behaviorally
// drives handleInboundEmail through the WHOLE decision table with a globalThis.fetch
// PostgREST fake (the email_infra_test fetch-swap idiom, extended to a router).
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ── env MUST be set before importing the route (module-load reads) ──
const SECRET = 'whsec_' + btoa('inbound-test-secret-32-bytes!!!!');
const SITE = '11111111-1111-4111-8111-111111111111';
const DOMAIN = 'inbound.example.com';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_INBOUND_SECRET', SECRET);
Deno.env.set('RESEND_INBOUND_DOMAIN', DOMAIN);
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Davis Digital Studio <eric@davisdigitalstudio.com>');
Deno.env.set('PLATFORM_REPLY_TO', 'eric@davisdigitalstudio.com');

const L = await import('../../supabase/functions/presence/lib/inbound_email.ts');
const { handleInboundEmail } = await import('../../supabase/functions/presence/routes/inbound_email.ts');

// ═══════════════════════ PART A · pure helpers ═══════════════════════

// stripHtml
ok('stripHtml: unclosed <script> stripped to end-of-input', L.stripHtml('<p>hi</p><script>alert(1)') === 'hi');
ok('stripHtml: unclosed <style> stripped to end-of-input', L.stripHtml('<p>hi</p><style>.a{color:red}') === 'hi');
ok('stripHtml: closed script/style removed with content', L.stripHtml('a<script>x</script>b<style>y</style>c') === 'a b c'.replace(/\s+/g, ' ').trim() || L.stripHtml('a<script>x</script>b') === 'a b');
ok('stripHtml: &amp;amp; decodes ONCE (no double-decode), &amp; LAST', L.stripHtml('A &amp;amp; B &amp; C') === 'A &amp; B & C');
ok('stripHtml: 100k INPUT cap applied before regex', L.stripHtml('<b>' + 'x'.repeat(200000)).length <= 100000);
ok('stripHtml: entities lt/gt/quot/apos decoded', L.stripHtml('&lt;a&gt; &quot;q&quot; &#39;s') === '<a> "q" \'s');

// parseAddress
ok('parseAddress: "Name" <Email> → lowercased email + trimmed name', (() => { const a = L.parseAddress('"Jane Doe" <Jane@Acme.com>'); return a.email === 'jane@acme.com' && a.name === 'Jane Doe'; })());
ok('parseAddress: bare Name <email> form', (() => { const a = L.parseAddress('Bob <bob@x.io>'); return a.email === 'bob@x.io' && a.name === 'Bob'; })());
ok('parseAddress: bare address', L.parseAddress('  ME@X.com ').email === 'me@x.com');
ok('parseAddress: object {email,name}', (() => { const a = L.parseAddress({ email: 'K@Y.com', name: 'Kay' }); return a.email === 'k@y.com' && a.name === 'Kay'; })());
ok('parseAddress: garbage → empty email', L.parseAddress('not-an-address').email === '');

// siteIdFromAddress
ok('siteIdFromAddress: <uuid>@domain resolves', L.siteIdFromAddress(`${SITE}@${DOMAIN}`) === SITE);
ok('siteIdFromAddress: +tag stripped before the UUID gate', L.siteIdFromAddress(`${SITE}+reply-42@${DOMAIN}`) === SITE);
ok('siteIdFromAddress: non-UUID local part → null', L.siteIdFromAddress(`support@${DOMAIN}`) === null);
ok('siteIdFromAddress: object form', L.siteIdFromAddress({ email: `${SITE}@${DOMAIN}` }) === SITE);

// headerValues
ok('headerValues: object-map shape, case-insensitive', JSON.stringify(L.headerValues({ 'Auto-Submitted': 'auto-replied' }, 'auto-submitted')) === JSON.stringify(['auto-replied']));
ok('headerValues: array-of-{name,value} shape', JSON.stringify(L.headerValues([{ name: 'Precedence', value: 'bulk' }], 'precedence')) === JSON.stringify(['bulk']));
ok('headerValues: multi-value array joined', JSON.stringify(L.headerValues({ 'X': ['a', 'b'] }, 'x')) === JSON.stringify(['a, b']));
ok('headerValues: absent → []', L.headerValues({}, 'nope').length === 0);

// parseAuthResults + senderAuthVerdict (BOTH payload shapes + alignment)
ok('verdict: DMARC=pass → ok (structured bare string)', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ dmarc: 'pass' }), 'jane@acme.com'); return v.ok && v.verdict === 'dmarc_pass'; })());
// SA1 (security): a message-borne Authentication-Results header is attacker-controlled
// and is NEVER trusted for the verdict — a forged `dmarc=pass` stanza must NOT pass.
ok('SA1: forged Authentication-Results header does NOT produce ok (fail closed → none)', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ headers: { 'Authentication-Results': 'mx; dmarc=pass header.from=acme.com' } }), 'jane@acme.com'); return v.ok === false && v.verdict === 'none'; })());
ok('SA1: parseAuthResults ignores AR header stanzas entirely (only structured fields)', (() => { const r = L.parseAuthResults({ headers: { 'Authentication-Results': 'mx; spf=pass smtp.mailfrom=acme.com; dkim=pass header.d=acme.com' } }); return r.dmarc === null && r.spf === null && r.dkim.length === 0; })());
ok('verdict: SPF+DKIM both pass + aligned → ok', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'pass', domain: 'acme.com' } }), 'jane@acme.com'); return v.ok && v.verdict === 'spf_dkim_aligned'; })());
ok('verdict: relaxed/suffix alignment (mail.acme.com ↔ acme.com)', L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'pass', domain: 'mail.acme.com' } }), 'jane@acme.com').ok === true);
ok('verdict: SPF pass but DKIM UNALIGNED → not ok', L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'pass', domain: 'evil.com' } }), 'jane@acme.com').ok === false);
ok('verdict: SPF pass, DKIM fail → not ok (unaligned)', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'fail', domain: 'acme.com' } }), 'jane@acme.com'); return !v.ok && v.verdict === 'unaligned'; })());
ok('verdict: DMARC=fail names the verdict', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ dmarc: 'fail' }), 'jane@acme.com'); return !v.ok && v.verdict === 'dmarc_fail'; })());
ok('verdict: NO signal at all → fail closed {ok:false, none}', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({}), 'jane@acme.com'); return !v.ok && v.verdict === 'none'; })());
ok('SA1: forged AR header spf+dkim stanzas do NOT pass (only structured verdicts count)', L.senderAuthVerdict(L.parseAuthResults({ headers: { 'Authentication-Results': 'mx; spf=pass smtp.mailfrom=acme.com; dkim=pass header.d=acme.com' } }), 'jane@acme.com').ok === false);
ok('parseAuthResults: {result|status|verdict, domain} object shape', (() => { const r = L.parseAuthResults({ dmarc: { status: 'pass', domain: 'acme.com' } }); return r.dmarc.result === 'pass' && r.dmarc.domain === 'acme.com'; })());

// autoResponderSignal
ok('autoResp: Auto-Submitted≠no flags', L.autoResponderSignal({ 'Auto-Submitted': 'auto-generated' }) === true);
ok('autoResp: Auto-Submitted:no does NOT flag', L.autoResponderSignal({ 'Auto-Submitted': 'no' }) === false);
ok('autoResp: X-Auto-Response-Suppress flags', L.autoResponderSignal({ 'X-Auto-Response-Suppress': 'All' }) === true);
ok('autoResp: Precedence bulk/auto_reply/junk flag', L.autoResponderSignal({ Precedence: 'bulk' }) && L.autoResponderSignal({ Precedence: 'auto_reply' }) && L.autoResponderSignal({ Precedence: 'junk' }));
ok('autoResp: Precedence:list does NOT flag', L.autoResponderSignal({ Precedence: 'list' }) === false);
ok('autoResp: clean human reply → false', L.autoResponderSignal({ 'Message-Id': '<x>' }) === false);

// isSelfSender
ok('isSelfSender: our own outbound identity', L.isSelfSender('eric@davisdigitalstudio.com', ['eric@davisdigitalstudio.com', 'eric@davisdigitalstudio.com'], DOMAIN) === true);
ok('isSelfSender: any @inbound-domain sender', L.isSelfSender(`bounce@${DOMAIN}`, ['eric@davisdigitalstudio.com'], DOMAIN) === true);
ok('isSelfSender: a real customer is NOT self', L.isSelfSender('jane@acme.com', ['eric@davisdigitalstudio.com'], DOMAIN) === false);

// filterSafe / filterKey
ok('filterSafe: rejects (never mangles) PostgREST grammar', L.filterSafe('a(b),c*"d\\e') === null);
ok('filterSafe: passes a clean value through unchanged', L.filterSafe('jane@acme.com') === 'jane@acme.com');
ok('filterSafe: empty → null', L.filterSafe('') === null);
ok('filterKey: quoted in.() form, strips inner quotes', L.filterKey('jane@acme.com') === encodeURIComponent('"jane@acme.com"'));

// deriveRequesterKey / matchedStoredEmail / identityAliases
ok('deriveRequesterKey: authId wins when present', L.deriveRequesterKey('auth-123', 'jane@acme.com') === 'auth-123');
ok('deriveRequesterKey: falls back to stored email', L.deriveRequesterKey('', 'Jane@Acme.com') === 'Jane@Acme.com');
ok('matchedStoredEmail: returns the EXACT stored casing', L.matchedStoredEmail('jane@acme.com', ['Jane@Acme.com', 'x@y.com']) === 'Jane@Acme.com');
ok('matchedStoredEmail: no match → null', L.matchedStoredEmail('nope@x.com', ['a@b.com']) === null);
ok('identityAliases: distinct, non-empty, order-preserving', JSON.stringify(L.identityAliases(['a', '', 'a', 'b', null, 'c'])) === JSON.stringify(['a', 'b', 'c']));

// normalizeSubject / selectAppendTarget
ok('normalizeSubject: strips Re/Fw/Fwd chains incl [n] + casefolds', L.normalizeSubject('Re: Fwd: Re[2]: Website Copy') === 'website copy');
ok('selectAppendTarget: newest subject-matching open thread', (() => {
  const t = L.selectAppendTarget([
    { id: 'old', subject: 'Website copy', created_at: '2026-01-01T00:00:00Z' },
    { id: 'new', subject: 'RE: Website copy', created_at: '2026-06-01T00:00:00Z' },
    { id: 'other', subject: 'Invoice', created_at: '2026-07-01T00:00:00Z' },
  ], 'website copy');
  return t && t.id === 'new';
})());
ok('selectAppendTarget: no subject match → null (a new request)', L.selectAppendTarget([{ id: 'a', subject: 'Invoice', created_at: '2026-01-01T00:00:00Z' }], 'Website copy') === null);
ok('I3: empty/normalizes-to-empty email subject → null (a NEW request, never buries a thread)', (() => {
  const threads = [{ id: 'a', subject: 'x', created_at: '2026-01-01T00:00:00Z' }, { id: 'b', subject: 'y', created_at: '2026-05-01T00:00:00Z' }];
  return L.selectAppendTarget(threads, '') === null && L.selectAppendTarget(threads, '   ') === null && L.selectAppendTarget(threads, 'Re: ') === null;
})());
ok('selectAppendTarget: no open threads → null', L.selectAppendTarget([], 'anything') === null);

// referenceIds (F1 reference threading — RFC 5322 In-Reply-To / References)
ok('referenceIds: In-Reply-To + References <id> tokens, deduped, order-preserving', JSON.stringify(L.referenceIds({ 'In-Reply-To': '<a@x>', References: '<b@y> <a@x> <c@z>' })) === JSON.stringify(['<a@x>', '<b@y>', '<c@z>']));
ok('referenceIds: absent/empty headers → []', L.referenceIds({}).length === 0 && L.referenceIds(null).length === 0);
ok('referenceIds: array-of-{name,value} header shape', JSON.stringify(L.referenceIds([{ name: 'References', value: '<m1@x>' }])) === JSON.stringify(['<m1@x>']));
ok('referenceIds: caps at 20 entries', L.referenceIds({ References: Array.from({ length: 30 }, (_, i) => `<m${i}@x>`).join(' ') }).length === 20);
ok('referenceIds: ignores non-<...> junk between ids', JSON.stringify(L.referenceIds({ References: 'noise <a@x> more-noise' })) === JSON.stringify(['<a@x>']));

// messageIdVariants (R6 — compare-time bracket normalization: stored external_id may
// be bare (data.message_id without <>) while reference tokens are bracketed)
ok('R6: messageIdVariants — bracketed token → bracketed AND bare forms', JSON.stringify(L.messageIdVariants('<a@x>')) === JSON.stringify(['<a@x>', 'a@x']));
ok('R6: messageIdVariants — bare id → bare AND bracketed forms', JSON.stringify(L.messageIdVariants('a@x')) === JSON.stringify(['a@x', '<a@x>']));
ok('R6: messageIdVariants — inner whitespace trimmed, deduped', JSON.stringify(L.messageIdVariants('< a@x >')) === JSON.stringify(['< a@x >', 'a@x', '<a@x>']));
ok('R6: messageIdVariants — empty/blank → []', L.messageIdVariants('').length === 0 && L.messageIdVariants('   ').length === 0);

// missingInsertColumns (F3 deploy-order tolerance — which optional columns to strip)
ok('missingInsertColumns: names the missing column from the message', JSON.stringify(L.missingInsertColumns({ code: 'PGRST204', message: "Could not find the 'client_id' column" }, '', ['external_id', 'client_id'])) === JSON.stringify(['client_id']));
// R8: a bare code naming NO column must never strip the dedup-critical external_id —
// only the non-critical candidates. If external_id is the ONLY candidate, nothing is
// strippable ([]) and the caller surfaces the error instead of landing undeduped.
ok('R8: bare 42703 with no name → only non-dedup-critical candidates (never external_id)', JSON.stringify(L.missingInsertColumns({ code: '42703' }, '', ['external_id', 'client_id'])) === JSON.stringify(['client_id']));
ok('R8: bare PGRST204, external_id the only candidate → [] (surface, never strip the key)', L.missingInsertColumns({ code: 'PGRST204' }, '', ['external_id']).length === 0);
ok('R8: a message NAMING external_id still strips it (precise pre-0114 degrade intact)', JSON.stringify(L.missingInsertColumns({ code: 'PGRST204', message: "Could not find the 'external_id' column" }, '', ['external_id', 'client_id'])) === JSON.stringify(['external_id']));
ok('missingInsertColumns: unrelated error → []', L.missingInsertColumns({ code: '23505', message: 'duplicate key' }, '', ['external_id']).length === 0);
ok('missingInsertColumns: message naming a candidate without a code still signals', JSON.stringify(L.missingInsertColumns({ message: 'column "external_id" does not exist' }, '', ['external_id', 'client_id'])) === JSON.stringify(['external_id']));

// missingColumnSignal / maskEmail
ok('missingColumnSignal: PGRST204', L.missingColumnSignal({ code: 'PGRST204' }, '') === true);
ok('missingColumnSignal: 42703', L.missingColumnSignal({ code: '42703' }, '') === true);
ok('missingColumnSignal: message naming external_id', L.missingColumnSignal({ message: "column \"external_id\" does not exist" }, '') === true);
ok('missingColumnSignal: unrelated error → false', L.missingColumnSignal({ code: '23505', message: 'duplicate key' }, '') === false);
ok('maskEmail: masks local part, keeps domain', L.maskEmail('jane@acme.com') === 'j***@acme.com' && L.maskEmail('') === '***');

// parseInbound variants
ok('parseInbound: from string, to string', (() => { const p = L.parseInbound({ type: 'email.received', data: { from: 'Jane <jane@acme.com>', to: 'x@y.com', subject: 'Hi', text: 'body' } }); return p && p.from_email === 'jane@acme.com' && p.from_name === 'Jane' && p.to_email === 'x@y.com'; })());
ok('parseInbound: from object, to object[]', (() => { const p = L.parseInbound({ type: 'email.received', data: { from: { email: 'a@b.com' }, to: [{ email: 'x@y.com' }, { email: 'z@y.com' }], subject: 'S', text: 't' } }); return p && p.from_email === 'a@b.com' && p.to_emails.length === 2; })());
ok('parseInbound: html-only body → stripped text', (() => { const p = L.parseInbound({ type: 'email.received', data: { from: 'a@b.com', to: 'x@y.com', subject: 'S', html: '<p>Body &amp; more</p>' } }); return p && p.text === 'Body & more'; })());
ok('parseInbound: subject capped at 200, body at 5000', (() => { const p = L.parseInbound({ type: 'email.received', data: { from: 'a@b.com', to: 'x@y.com', subject: 'S'.repeat(300), text: 'B'.repeat(9000) } }); return p && p.subject.length === 200 && p.text.length === 5000; })());
ok('parseInbound: empty (no subject AND no body) → null', L.parseInbound({ type: 'email.received', data: { from: 'a@b.com', to: 'x@y.com', subject: '', text: '' } }) === null);
ok('parseInbound: no sender → null', L.parseInbound({ type: 'email.received', data: { to: 'x@y.com', subject: 'Hi' } }) === null);
ok('parseInbound: cc folded into to_emails', (() => { const p = L.parseInbound({ type: 'email.received', data: { from: 'a@b.com', to: 'x@y.com', cc: ['c@y.com'], subject: 'S', text: 't' } }); return p && p.to_emails.includes('c@y.com'); })());

// ═══════════════════════ PART B · behavioral decision table ═══════════════════════
const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function installFetch(cfg = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com/emails')) return jr({ id: 're_1' }, 200);
    if (url.includes('/rpc/rate_hit')) return jr(cfg.rateAllow === false ? false : true);
    if (url.includes('suppressed_emails')) return jr([]);
    if (url.includes('presence_settings') || url.includes('presence_identity')) return jr([]);
    if (url.includes('/auth/v1/admin/users')) return jr({ users: cfg.authUsers || [] });   // I1: auth-user-by-email lookup
    if (url.includes('external_id=eq.')) return jr(cfg.landed ? [{ id: 'seen' }] : []);   // alreadyLanded (all landing tables)
    // F1 reference threading: the stored-Message-Id lookups (external_id=in.(…))
    if (url.includes('external_id=in.')) {
      if (url.includes('presence_support_messages')) return jr(cfg.refMsgHits || [], cfg.refStatus || 200);
      return jr(cfg.refReqHits || [], cfg.refStatus || 200);
    }
    if (url.includes('presence_support_requests?id=eq.')) return jr(cfg.reqById || []);   // the referenced thread row
    if (url.includes('presence_project_messages') && method === 'POST') return (cfg.projMsgInsert || (() => jr([{ id: 'pm_1' }], 201)))(body);
    if (url.includes('presence_project_messages')) return jr([]);
    if (url.includes('presence_projects')) return jr(cfg.projects || []);   // F1: the bridged link's project
    if (url.includes('clients?or=')) return jr(cfg.clients || [], cfg.clientsStatus || 200);   // SB1: clientsStatus drives a 5xx
    if (url.includes('presence_service_links')) return jr(cfg.links || []);
    if (url.includes('presence_contacts')) return jr(cfg.contacts || []);
    if (url.includes('/contacts?id=eq.')) return jr(cfg.contactAuth || []);
    if (url.includes('presence_sites')) return jr(cfg.site === false ? [] : [{ id: SITE }]);
    if (url.includes('presence_support_requests') && method === 'GET') return jr(cfg.openThreads || [], cfg.openThreadsStatus || 200);   // SC1: openThreadsStatus drives a 5xx
    if (url.includes('presence_support_messages') && method === 'POST') return (cfg.msgInsert || (() => jr([{ id: 'msg_1' }], 201)))(body);
    if (url.includes('presence_support_requests') && method === 'POST') return (cfg.reqInsert || (() => jr([{ id: 'req_1' }], 201)))(body);
    if (url.includes('presence_support_requests') && method === 'PATCH') return jr(null, 204);
    if (url.includes('presence_project_events') && method === 'POST') return jr(null, 201);
    return jr([]);
  };
  return calls;
}

async function sign(payloadObj, { badSig = false, omit = null, extraHeaders = {} } = {}) {
  const payload = JSON.stringify(payloadObj);
  const id = 'msg_evt_1';
  const ts = String(Math.floor(Date.now() / 1000));
  const keyRaw = Uint8Array.from(atob(SECRET.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`)));
  const sig = btoa(String.fromCharCode(...sigBytes));
  const h = new Headers({ 'content-type': 'application/json' });
  if (omit !== 'id') h.set('svix-id', id);
  if (omit !== 'ts') h.set('svix-timestamp', ts);
  if (omit !== 'sig') h.set('svix-signature', badSig ? ('v1,AAAA' + sig.slice(4)) : `v1,${sig}`);
  for (const [k, v] of Object.entries(extraHeaders)) h.set(k, v);
  return new Request('https://x/functions/v1/presence/email/inbound', { method: 'POST', body: payload, headers: h });
}

const emailReceived = (over = {}) => ({
  type: 'email.received',
  data: {
    from: 'Jane <jane@acme.com>', to: [`${SITE}@${DOMAIN}`], subject: 'Website copy', text: 'Here are my edits.',
    message_id: '<abc-123@acme.com>', dmarc: 'pass', headers: {}, ...over,
  },
});
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_ID_2 = '44444444-4444-4444-8444-444444444444';
const BRIDGED = { clients: [{ id: CLIENT_ID, email: 'jane@acme.com', contact_email: 'jane@acme.com', contact_id: CONTACT_ID, created_at: '2026-01-01T00:00:00Z' }], links: [{ customer_client_id: CLIENT_ID }], contactAuth: [{ auth_user_id: 'auth-123' }] };

try {
  // 1. no-secret → 404
  { Deno.env.delete('RESEND_INBOUND_SECRET'); installFetch(); const r = await handleInboundEmail(await sign(emailReceived())); ok('route: no RESEND_INBOUND_SECRET → 404 (fail-closed)', r.status === 404); Deno.env.set('RESEND_INBOUND_SECRET', SECRET); }

  // 2. missing svix header → 400
  { installFetch(); const r = await handleInboundEmail(await sign(emailReceived(), { omit: 'sig' })); ok('route: missing svix-signature → 400', r.status === 400); }

  // 3a. oversize by declared Content-Length → 413 (before HMAC)
  {
    installFetch();
    const r = await handleInboundEmail(new Request('https://x/e', { method: 'POST', body: 'x'.repeat(300 * 1024), headers: { 'svix-id': 'a', 'svix-timestamp': '1', 'svix-signature': 'v1,x' } }));
    ok('route: oversize (declared Content-Length > 256KB) → 413', r.status === 413);
  }
  // 3b. oversize by STREAMED read (no content-length, chunked) → 413
  {
    installFetch();
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('y'.repeat(300 * 1024))); c.close(); } });
    const req = new Request('https://x/e', { method: 'POST', body: stream, headers: { 'svix-id': 'a', 'svix-timestamp': '1', 'svix-signature': 'v1,x' }, duplex: 'half' });
    const r = await handleInboundEmail(req);
    ok('route: oversize (streamed read, no Content-Length) → 413', r.status === 413);
  }

  // 4. bad signature → 401
  { installFetch(); const r = await handleInboundEmail(await sign(emailReceived(), { badSig: true })); ok('route: bad signature → 401', r.status === 401); }

  // 5. bad JSON / wrong type → 200 ack
  {
    installFetch();
    // a validly-signed but non-JSON body
    const payload = 'not json {';
    const id = 'm', ts = String(Math.floor(Date.now() / 1000));
    const keyRaw = Uint8Array.from(atob(SECRET.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`)))));
    const req = new Request('https://x/e', { method: 'POST', body: payload, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' } });
    const r = await handleInboundEmail(req);
    ok('route: bad JSON → 200 ack (stop Resend retrying)', r.status === 200);
  }
  { installFetch(); const r = await handleInboundEmail(await sign({ type: 'email.delivered', data: {} })); ok('route: wrong event type → 200 ack', r.status === 200); }

  // 7. auto-responder → drop + ack, no insert
  {
    const calls = installFetch(BRIDGED);
    const r = await handleInboundEmail(await sign(emailReceived({ headers: { 'Auto-Submitted': 'auto-generated' } })));
    ok('route: auto-responder → 200 ack, nothing inserted', r.status === 200 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url)));
  }

  // 8. sender auth fail (dmarc=fail) and none → drop + ack
  { const calls = installFetch(BRIDGED); const r = await handleInboundEmail(await sign(emailReceived({ dmarc: 'fail' }))); ok('route: DMARC=fail → 200 ack, no insert', r.status === 200 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url))); }
  { const calls = installFetch(BRIDGED); const r = await handleInboundEmail(await sign(emailReceived({ dmarc: undefined }))); ok('route: NO auth signal → 200 ack, no insert (fail closed)', r.status === 200 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url))); }

  // 9. self-sender → drop + ack
  { const calls = installFetch(BRIDGED); const r = await handleInboundEmail(await sign(emailReceived({ from: `bounce@${DOMAIN}` }))); ok('route: self-sender (@inbound-domain) → 200 ack, no insert', r.status === 200 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url))); }

  // 10. no site-addressed recipient / unknown site → drop
  { installFetch(BRIDGED); const r = await handleInboundEmail(await sign(emailReceived({ to: ['hello@example.com'] }))); ok('route: no <siteId>@ recipient → 200 ack', r.status === 200); }
  { installFetch({ ...BRIDGED, site: false }); const r = await handleInboundEmail(await sign(emailReceived())); ok('route: site uuid not found → 200 ack', r.status === 200); }

  // 11. rate-limited → 429
  { installFetch({ ...BRIDGED, rateAllow: false }); const r = await handleInboundEmail(await sign(emailReceived())); ok('route: over per-site rate cap → 429', r.status === 429); }

  // 13. dedupe short-circuit → ack, no insert
  { const calls = installFetch({ ...BRIDGED, landed: true }); const r = await handleInboundEmail(await sign(emailReceived())); ok('route: already-landed external_id → 200 ack, no insert', r.status === 200 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url))); }

  // 14. unknown sender (no client, no contact) → drop
  { const calls = installFetch({ clients: [], contacts: [] }); const r = await handleInboundEmail(await sign(emailReceived())); ok('route: unknown sender → 200 ack, no insert (spam surface)', r.status === 200 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url))); }

  // 17. subject-match APPEND → message author = thread.requester + external_id + updated_at bump + project event
  {
    const calls = installFetch({ ...BRIDGED, openThreads: [{ id: 'thr_1', subject: 'RE: Website copy', requester: 'auth-123', project_id: 'proj_1', created_at: '2026-06-01T00:00:00Z' }] });
    const r = await handleInboundEmail(await sign(emailReceived()));
    const msgPost = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_messages'));
    const bump = calls.find((c) => c.method === 'PATCH' && c.url.includes('presence_support_requests') && c.url.includes('id=eq.thr_1'));
    const evt = calls.find((c) => c.method === 'POST' && c.url.includes('presence_project_events'));
    ok('route: subject-match append inserts a message on the thread', r.status === 200 && !!msgPost && msgPost.body.request_id === 'thr_1');
    ok('route: appended message author = thread.requester (not lowercased From)', msgPost && msgPost.body.author === 'auth-123' && msgPost.body.author_kind === 'client');
    ok('route: appended message carries the external_id (idempotency)', msgPost && msgPost.body.external_id === '<abc-123@acme.com>');
    ok('route: append bumps request.updated_at (L1 bell/feed window)', !!bump);
    ok('route: project-linked append emits support_message event {from:client, via:email}', evt && evt.body.kind === 'support_message' && evt.body.detail.from === 'client' && evt.body.detail.via === 'email' && evt.body.client_visible === true);
  }

  // 18. NEW request → requester = auth id + ack (reply_to = <siteId>@<domain>)
  {
    const calls = installFetch({ ...BRIDGED, openThreads: [] });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'A brand new topic' })));
    const reqPost = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    const ackSend = calls.find((c) => c.url.includes('api.resend.com/emails'));
    ok('route: new request opened with the handleClientSupport shape', r.status === 200 && !!reqPost && reqPost.body.status === 'open' && reqPost.body.priority === 'normal' && reqPost.body.requester_kind === 'client' && reqPost.body.project_id === null);
    ok('route: new request requester = the portal auth id (I1)', reqPost && reqPost.body.requester === 'auth-123');
    ok('route: new request carries external_id', reqPost && reqPost.body.external_id === '<abc-123@acme.com>');
    ok('route: new request auto-acks the sender', !!ackSend);
    ok('route: R1 loop-closure — ack reply_to is <siteId>@<inbound-domain>', ackSend && ackSend.body.reply_to === `${SITE}@${DOMAIN}` && (ackSend.body.headers || {})['Auto-Submitted'] === 'auto-replied');
  }

  // new request from a bridged customer WITHOUT an auth id → requester = stored email
  {
    const calls = installFetch({ clients: [{ id: CLIENT_ID_2, email: 'Jane@Acme.com', contact_email: 'Jane@Acme.com', contact_id: null, created_at: '2026-01-01T00:00:00Z' }], links: [{ customer_client_id: CLIENT_ID_2 }], openThreads: [] });
    await handleInboundEmail(await sign(emailReceived({ subject: 'No auth id here' })));
    const reqPost = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('route: no auth id → requester = matched STORED-casing email (not lowercased)', reqPost && reqPost.body.requester === 'Jane@Acme.com');
  }

  // degrade ONLY on missing-column: first insert PGRST204 → retry WITHOUT external_id → success
  {
    let n = 0;
    const calls = installFetch({ ...BRIDGED, openThreads: [], reqInsert: (b) => { n++; return n === 1 ? jr({ code: 'PGRST204', message: "Could not find the 'external_id' column" }, 400) : jr([{ id: 'req_9' }], 201); } });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Degrade path' })));
    const reqPosts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('route: missing-column → retries insert ONCE without the key (pre-0114)', r.status === 200 && reqPosts.length === 2 && !('external_id' in (reqPosts[1].body || {})));
  }
  // 502 on ANY OTHER failure (never silently strip the key)
  {
    const calls = installFetch({ ...BRIDGED, openThreads: [], reqInsert: () => jr({ code: '23503', message: 'some other db error' }, 500) });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Hard fail' })));
    const reqPosts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('route: non-missing-column failure → 502 (Resend retries), key NOT stripped', r.status === 502 && reqPosts.length === 1);
  }

  // SB1: a 500 on the clients (identity) read → 502, NOT a silent unknown-sender drop
  {
    const calls = installFetch({ ...BRIDGED, clientsStatus: 500 });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Identity read flaked' })));
    ok('SB1: 500 on the clients read → 502 (retry), not an unknown-sender drop', r.status === 502 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url)));
  }

  // SC1: a 500 on the open-threads read → 502, NOT a silently-opened duplicate new request
  {
    const calls = installFetch({ ...BRIDGED, openThreadsStatus: 500 });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Threads read flaked' })));
    ok('SC1: 500 on the open-threads read → 502 (retry), not a duplicate new request', r.status === 502 && !calls.some((c) => c.method === 'POST' && /presence_support_requests/.test(c.url)));
  }

  // T2: an insert-time 409 unique-conflict (insertDeduped → {duplicate}) → ack as duplicate, no 502, no double-land
  {
    const calls = installFetch({ ...BRIDGED, openThreads: [], reqInsert: () => jr({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409) });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Insert races to a dup' })));
    const reqPosts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('T2: insert 409 unique-conflict → 200 ack (duplicate), not 502, single insert attempt', r.status === 200 && reqPosts.length === 1);
    ok('T2: no auto-ack sent on a duplicate (nothing new landed)', !calls.some((c) => c.url.includes('api.resend.com/emails')));
  }
  // T2b: a 409 on an APPEND insert (message table) → ack as duplicate, no 502
  {
    const calls = installFetch({ ...BRIDGED, openThreads: [{ id: 'thr_1', subject: 'RE: Website copy', requester: 'auth-123', project_id: null, created_at: '2026-06-01T00:00:00Z' }], msgInsert: () => jr({ code: '23505', message: 'duplicate key' }, 409) });
    const r = await handleInboundEmail(await sign(emailReceived()));
    ok('T2b: append insert 409 → 200 ack (duplicate), not 502', r.status === 200);
  }

  // ═══════════ PART C · comms routing fix (F1 project landing + reference threading, F3 client_id) ═══════════
  const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
  const BRIDGED_PROJ = { ...BRIDGED, links: [{ customer_client_id: CLIENT_ID, project_id: PROJECT_ID, created_at: '2026-01-02T00:00:00Z' }], projects: [{ id: PROJECT_ID, status: 'active', client_visible: true }] };

  // F1: a bridged CLIENT with an active project → the email lands as a PROJECT
  // MESSAGE (the portal composer's shape), NEVER on the support spine — even when
  // an open support thread's subject matches (the old subject-append path).
  {
    const calls = installFetch({ ...BRIDGED_PROJ, openThreads: [{ id: 'thr_1', subject: 'RE: Website copy', requester: 'auth-123', project_id: null, created_at: '2026-06-01T00:00:00Z' }] });
    const r = await handleInboundEmail(await sign(emailReceived()));
    const pm = calls.find((c) => c.method === 'POST' && c.url.includes('presence_project_messages'));
    const supPosts = calls.filter((c) => c.method === 'POST' && /presence_support/.test(c.url));
    const evt = calls.find((c) => c.method === 'POST' && c.url.includes('presence_project_events'));
    ok('F1: bridged client w/ project → presence_project_messages in the portal shape', r.status === 200 && !!pm && pm.body.project_id === PROJECT_ID && pm.body.audience === 'client' && pm.body.author === 'auth-123' && pm.body.author_kind === 'client' && pm.body.body === 'Here are my edits.');
    ok('F1: the project message carries external_id (0114-style dedup)', pm && pm.body.external_id === '<abc-123@acme.com>');
    ok('F1: NOTHING lands on the support spine (no ticket, no support append)', supPosts.length === 0);
    ok('F1: emits the kind:message project event {from:client, via:email, client_visible}', evt && evt.body.kind === 'message' && evt.body.detail.from === 'client' && evt.body.detail.via === 'email' && evt.body.client_visible === true && evt.body.actor_kind === 'client');
    ok('R9: the message event actor is EMAIL-FIRST (projectEvent parity), not the uid key', evt && evt.body.actor === 'jane@acme.com');
  }

  // F1: project-message insert 409 (unique external_id conflict) → duplicate ack, no support fallthrough
  {
    const calls = installFetch({ ...BRIDGED_PROJ, projMsgInsert: () => jr({ code: '23505', message: 'duplicate key' }, 409) });
    const r = await handleInboundEmail(await sign(emailReceived()));
    ok('F1: duplicate project message (409) → 200 ack, no support insert', r.status === 200 && !calls.some((c) => c.method === 'POST' && /presence_support/.test(c.url)));
  }

  // F1 (pre-0115): presence_project_messages.external_id missing → ONE retry without the key
  {
    let n = 0;
    const calls = installFetch({ ...BRIDGED_PROJ, projMsgInsert: () => { n++; return n === 1 ? jr({ code: 'PGRST204', message: "Could not find the 'external_id' column" }, 400) : jr([{ id: 'pm_2' }], 201); } });
    const r = await handleInboundEmail(await sign(emailReceived()));
    const posts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_project_messages'));
    ok('F1: pre-0115 missing external_id on project messages → retried once without the key', r.status === 200 && posts.length === 2 && !('external_id' in (posts[1].body || {})));
  }

  // F1: client whose link's project is GONE (deleted/missing) → the support spine
  // fallback (append-or-create) — and F3: the new request is STAMPED client_id.
  {
    const calls = installFetch({ ...BRIDGED_PROJ, projects: [], openThreads: [] });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'A fresh topic' })));
    const reqPost = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('F1: no live project → falls back to a support request (spine preserved)', r.status === 200 && !!reqPost && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_project_messages')));
    ok('F3: the fallback support request is stamped client_id', reqPost && reqPost.body.client_id === CLIENT_ID);
  }

  // F3 (pre-0115): client_id column missing → retry WITHOUT client_id but KEEPING external_id
  {
    let n = 0;
    const calls = installFetch({ ...BRIDGED_PROJ, projects: [], openThreads: [], reqInsert: () => { n++; return n === 1 ? jr({ code: 'PGRST204', message: "Could not find the 'client_id' column of 'presence_support_requests'" }, 400) : jr([{ id: 'req_c' }], 201); } });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Client id degrade' })));
    const posts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('F3: pre-0115 missing client_id → retried without client_id, external_id KEPT', r.status === 200 && posts.length === 2 && !('client_id' in (posts[1].body || {})) && posts[1].body.external_id === '<abc-123@acme.com>');
  }

  // F3: a CRM-contact sender (not a bridged client) opens a request with NO client_id key
  {
    const calls = installFetch({ clients: [], contacts: [{ id: CONTACT_ID, email: 'jane@acme.com', created_at: '2026-01-01T00:00:00Z' }], openThreads: [] });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'From a contact' })));
    const reqPost = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('F3: contact-matched sender → support request WITHOUT a client_id key', r.status === 200 && !!reqPost && !('client_id' in (reqPost.body || {})));
  }

  // F1 reference threading: an In-Reply-To that matches a STORED inbound
  // Message-Id pins the reply to ITS OWN support thread — beating BOTH the
  // project landing and the subject match, regardless of open-status.
  {
    const calls = installFetch({
      ...BRIDGED_PROJ,
      refMsgHits: [{ request_id: 'thr_9', created_at: '2026-05-01T00:00:00Z' }],
      reqById: [{ id: 'thr_9', subject: 'An older matter', requester: 'auth-123', status: 'resolved', project_id: null, created_at: '2026-04-01T00:00:00Z' }],
    });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Totally different subject', headers: { 'In-Reply-To': '<ref-1@acme.com>' } })));
    const msgPost = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_messages'));
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('id=eq.thr_9'));
    ok('F1: reference hit → appends to the referenced thread (subject/status ignored)', r.status === 200 && !!msgPost && msgPost.body.request_id === 'thr_9' && msgPost.body.author === 'auth-123');
    ok('F1: reference append beats the project landing (no project message)', !calls.some((c) => c.method === 'POST' && c.url.includes('presence_project_messages')));
    ok('F1: appending to a RESOLVED thread REOPENS it (status back to open)', patch && patch.body.status === 'open' && patch.body.resolved_at === null);
  }

  // reference append on an OPEN thread: no status change, just the L1 bump
  {
    const calls = installFetch({
      ...BRIDGED_PROJ,
      refReqHits: [{ id: 'thr_8', created_at: '2026-05-02T00:00:00Z' }],
      reqById: [{ id: 'thr_8', subject: 'Open matter', requester: 'auth-123', status: 'open', project_id: 'proj_z', created_at: '2026-05-01T00:00:00Z' }],
    });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Re: Open matter', headers: { References: '<ref-2@acme.com>' } })));
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('id=eq.thr_8'));
    const evt = calls.find((c) => c.method === 'POST' && c.url.includes('presence_project_events'));
    ok('F1: reference append on an open thread bumps updated_at without touching status', r.status === 200 && !!patch && !('status' in (patch.body || {})));
    ok('F1: project-linked referenced thread still emits the support_message event', evt && evt.body.kind === 'support_message' && evt.body.detail.from === 'client');
  }

  // F1/R2: an unknown sender STILL creates nothing — even with a FULLY RESOLVABLE
  // reference chain (refMsgHits AND reqById both configured). The original test
  // left reqById unset, so the chain never completed and the no-insert assertion
  // passed vacuously — a mutation hoisting reference threading above identity
  // matching sailed through. Now the chain resolves, and we ALSO pin the ordering
  // directly: a stranger's email must trigger NO stored-Message-Id lookup at all.
  {
    const calls = installFetch({
      clients: [], contacts: [],
      refMsgHits: [{ request_id: 'thr_9', created_at: '2026-05-01T00:00:00Z' }],
      reqById: [{ id: 'thr_9', subject: 'A real thread', requester: 'auth-123', status: 'open', project_id: null, created_at: '2026-04-01T00:00:00Z' }],
    });
    const r = await handleInboundEmail(await sign(emailReceived({ headers: { 'In-Reply-To': '<ref-1@acme.com>' } })));
    ok('F1/R2: unknown sender + RESOLVABLE reference chain → 200 ack, NOTHING inserted (spam surface intact)', r.status === 200 && !calls.some((c) => c.method === 'POST' && (/presence_support/.test(c.url) || c.url.includes('presence_project_messages'))));
    ok('R2: identity matching precedes ANY thread lookup (no external_id=in. read for a stranger)', !calls.some((c) => c.url.includes('external_id=in.')));
  }

  // ═══════════ PART D · adversarial-review R-fixes ═══════════

  // R1 (security BLOCKER): a reference hit on ANOTHER requester's thread must NOT
  // append. Any known sender whose email carries a victim's stored Message-Id
  // (forged, or honestly accumulated via forward/reply-all References) would
  // otherwise inject into the victim's thread AS the victim — and reopen it.
  {
    const calls = installFetch({
      ...BRIDGED_PROJ,
      refMsgHits: [{ request_id: 'thr_victim', created_at: '2026-05-01T00:00:00Z' }],
      reqById: [{ id: 'thr_victim', subject: 'Victim matter', requester: 'victim-uid-999', status: 'resolved', project_id: null, created_at: '2026-04-01T00:00:00Z' }],
    });
    const r = await handleInboundEmail(await sign(emailReceived({ headers: { 'In-Reply-To': '<stolen-ref@acme.com>' } })));
    const supMsg = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_messages'));
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('id=eq.thr_victim'));
    const pm = calls.find((c) => c.method === 'POST' && c.url.includes('presence_project_messages'));
    ok('R1: reference hit on ANOTHER requester\'s thread → NO append as the victim', r.status === 200 && !supMsg);
    ok('R1: the victim thread is untouched (no reopen / updated_at bump)', !patch);
    ok('R1: ownership mismatch falls through to normal routing (project landing here)', !!pm && pm.body.project_id === PROJECT_ID);
  }
  // R1 continuity: a thread stamped with the MATCHED client's own client_id (its
  // requester an alternate key from an earlier era) is still the sender's own.
  {
    const calls = installFetch({
      ...BRIDGED_PROJ,
      refMsgHits: [{ request_id: 'thr_alt', created_at: '2026-05-01T00:00:00Z' }],
      reqById: [{ id: 'thr_alt', subject: 'Alt-key matter', requester: 'old-alt-uid', status: 'open', project_id: null, client_id: CLIENT_ID, created_at: '2026-04-01T00:00:00Z' }],
    });
    const r = await handleInboundEmail(await sign(emailReceived({ headers: { 'In-Reply-To': '<alt-ref@acme.com>' } })));
    const supMsg = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_messages'));
    ok('R1: client_id match (same client, alternate requester key) still appends', r.status === 200 && !!supMsg && supMsg.body.request_id === 'thr_alt');
  }

  // R3: the project landing requires a LIVE (status=active), CLIENT-VISIBLE project —
  // matching the portal composer's semantics. Completed/archived/hidden projects
  // must not swallow email forever; the support spine is the fallback.
  {
    const calls = installFetch({ ...BRIDGED_PROJ, projects: [{ id: PROJECT_ID, status: 'complete', client_visible: true }], openThreads: [] });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'After the project wrapped' })));
    ok('R3: completed project → support spine, NOT a project message', r.status === 200 && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_project_messages')) && !!calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests')));
  }
  {
    const calls = installFetch({ ...BRIDGED_PROJ, projects: [{ id: PROJECT_ID, status: 'active', client_visible: false }], openThreads: [] });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Hidden project' })));
    ok('R3: client-invisible project → support spine (the client could not even READ that thread)', r.status === 200 && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_project_messages')) && !!calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests')));
  }

  // R6: the stored-Message-Id lookup must match BOTH stored formats — external_id
  // is stored as-received (data.message_id may lack angle brackets) while
  // reference tokens are always bracketed.
  {
    const calls = installFetch({ ...BRIDGED_PROJ });
    await handleInboundEmail(await sign(emailReceived({ headers: { 'In-Reply-To': '<ref-6@acme.com>' } })));
    const look = calls.find((c) => c.url.includes('external_id=in.'));
    const dec = look ? decodeURIComponent(look.url) : '';
    ok('R6: reference lookup queries the bracketed AND the bare stored form', !!look && dec.includes('"<ref-6@acme.com>"') && dec.includes('"ref-6@acme.com"'));
  }

  // R8: a bare missing-column code naming NO column must never strip the dedup key.
  {
    let n = 0;
    const calls = installFetch({ ...BRIDGED, openThreads: [], reqInsert: () => { n++; return n === 1 ? jr({ code: '42703' }, 400) : jr([{ id: 'req_r8' }], 201); } });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Bare 42703 degrade' })));
    const posts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('R8: bare 42703 → retry strips ONLY client_id; external_id survives every attempt', r.status === 200 && posts.length === 2 && posts.every((p) => 'external_id' in (p.body || {})) && !('client_id' in (posts[1].body || {})));
  }
  {
    const calls = installFetch({ ...BRIDGED, openThreads: [], reqInsert: () => jr({ code: '42703' }, 400) });
    const r = await handleInboundEmail(await sign(emailReceived({ subject: 'Bare 42703 hard fail' })));
    const posts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('R8: bare 42703 persisting → 502 surfaced (never silently landed without dedup)', r.status === 502 && posts.every((p) => 'external_id' in (p.body || {})));
  }

  // I1: a bridged client whose contact has NO auth_user_id but who CAN log into the
  // portal (an auth user exists by email) → requester = that portal uid, so the
  // email-created thread is visible in their own portal (readerKey = userId).
  {
    const calls = installFetch({
      clients: [{ id: CLIENT_ID_2, email: 'Jane@Acme.com', contact_email: 'Jane@Acme.com', contact_id: null, created_at: '2026-01-01T00:00:00Z' }],
      links: [{ customer_client_id: CLIENT_ID_2 }], openThreads: [],
      authUsers: [{ id: 'portal-uid-777', email: 'jane@acme.com' }],
    });
    await handleInboundEmail(await sign(emailReceived({ subject: 'Email-login bridged client' })));
    const reqPost = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('I1: contact auth_user_id NULL but email-login user exists → requester = portal uid', reqPost && reqPost.body.requester === 'portal-uid-777');
  }
} finally {
  globalThis.fetch = realFetch;
}

const passed = results.filter(Boolean).length;
console.log(`\n════ INBOUND EMAIL (slice 6): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
