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
ok('verdict: DMARC=pass via Authentication-Results header stanza', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ headers: { 'Authentication-Results': 'mx; dmarc=pass header.from=acme.com' } }), 'jane@acme.com'); return v.ok && v.verdict === 'dmarc_pass'; })());
ok('verdict: SPF+DKIM both pass + aligned → ok', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'pass', domain: 'acme.com' } }), 'jane@acme.com'); return v.ok && v.verdict === 'spf_dkim_aligned'; })());
ok('verdict: relaxed/suffix alignment (mail.acme.com ↔ acme.com)', L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'pass', domain: 'mail.acme.com' } }), 'jane@acme.com').ok === true);
ok('verdict: SPF pass but DKIM UNALIGNED → not ok', L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'pass', domain: 'evil.com' } }), 'jane@acme.com').ok === false);
ok('verdict: SPF pass, DKIM fail → not ok (unaligned)', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ spf: { result: 'pass', domain: 'acme.com' }, dkim: { result: 'fail', domain: 'acme.com' } }), 'jane@acme.com'); return !v.ok && v.verdict === 'unaligned'; })());
ok('verdict: DMARC=fail names the verdict', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({ dmarc: 'fail' }), 'jane@acme.com'); return !v.ok && v.verdict === 'dmarc_fail'; })());
ok('verdict: NO signal at all → fail closed {ok:false, none}', (() => { const v = L.senderAuthVerdict(L.parseAuthResults({}), 'jane@acme.com'); return !v.ok && v.verdict === 'none'; })());
ok('verdict: AR header spf+dkim aligned', L.senderAuthVerdict(L.parseAuthResults({ headers: { 'Authentication-Results': 'mx; spf=pass smtp.mailfrom=acme.com; dkim=pass header.d=acme.com' } }), 'jane@acme.com').ok === true);
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
ok('selectAppendTarget: empty email subject → newest open thread', (() => {
  const t = L.selectAppendTarget([{ id: 'a', subject: 'x', created_at: '2026-01-01T00:00:00Z' }, { id: 'b', subject: 'y', created_at: '2026-05-01T00:00:00Z' }], '');
  return t && t.id === 'b';
})());
ok('selectAppendTarget: no open threads → null', L.selectAppendTarget([], 'anything') === null);

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
    if (url.includes('external_id=eq.')) return jr(cfg.landed ? [{ id: 'seen' }] : []);   // alreadyLanded (both tables)
    if (url.includes('clients?or=')) return jr(cfg.clients || []);
    if (url.includes('presence_service_links')) return jr(cfg.links || []);
    if (url.includes('presence_contacts')) return jr(cfg.contacts || []);
    if (url.includes('/contacts?id=eq.')) return jr(cfg.contactAuth || []);
    if (url.includes('presence_sites')) return jr(cfg.site === false ? [] : [{ id: SITE }]);
    if (url.includes('presence_support_requests') && method === 'GET') return jr(cfg.openThreads || []);
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
} finally {
  globalThis.fetch = realFetch;
}

const passed = results.filter(Boolean).length;
console.log(`\n════ INBOUND EMAIL (slice 6): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
