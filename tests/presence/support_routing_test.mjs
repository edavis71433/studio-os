// ── Comms routing fix — the portal composer + client_id stamping (F2/F3) ─────
//   deno run --allow-read --allow-env --allow-net tests/presence/support_routing_test.mjs
// Part A behaviorally drives handleClientSupport (routes/client_delivery.ts)
// through a globalThis.fetch PostgREST fake (the inbound_email_test idiom):
// the general composer APPENDS to the requester's newest open project-less
// request (one conversation, never a ticket per message), while service
// requests / project-scoped posts keep minting distinct tickets; new requests
// are stamped client_id with a pre-0115 missing-column degrade.
// Part B pins the OTHER writers/readers structurally (service_intake stamping,
// workspace + crm + project_comms preferring client_id).
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Davis Digital Studio <eric@davisdigitalstudio.com>');

const { handleClientSupport } = await import('../../supabase/functions/presence/routes/client_delivery.ts');

const ME = '22222222-2222-4222-8222-222222222222';        // the caller's clients.id
const AS = '11111111-1111-4111-8111-111111111111';        // the agency site the delivery lives on
const SITE = { id: '99999999-9999-4999-8999-999999999999', client_id: ME };
const PRINCIPAL = { kind: 'client', userId: 'auth-123', email: 'jane@acme.com' };
const CORS = {};

const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function installFetch(cfg = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com/emails')) return jr({ id: 're_1' }, 200);
    if (url.includes('suppressed_emails') || url.includes('presence_settings') || url.includes('presence_identity')) return jr([]);
    if (url.includes('presence_service_links')) return jr(cfg.links !== undefined ? cfg.links : [{ project_id: 'p-1', agency_site_id: AS, customer_client_id: ME }]);
    if (url.includes('presence_offerings')) return jr(cfg.offering || []);
    if (url.includes('clients?id=eq.')) return jr([{ id: ME, email: 'jane@acme.com' }]);
    if (url.includes('presence_support_messages') && method === 'POST') return (cfg.msgInsert || (() => jr([{ id: 'sm_1' }], 201)))(body);
    if (url.includes('presence_support_requests') && method === 'GET') return jr(cfg.openReqs || [], cfg.openReqsStatus || 200);
    if (url.includes('presence_support_requests') && method === 'POST') return (cfg.reqInsert || (() => jr([{ id: 'req_1' }], 201)))(body);
    if (url.includes('presence_support_requests') && method === 'PATCH') return jr(null, 204);
    if (url.includes('presence_project_events') && method === 'POST') return jr(null, 201);
    return jr([]);
  };
  return calls;
}

const post = (body) => new Request('https://x/functions/v1/presence/client/support', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

try {
  // F2: a plain composer message with an OPEN project-less request → APPEND (one conversation)
  {
    const calls = installFetch({ openReqs: [{ id: 'req_open', status: 'open' }] });
    const res = await handleClientSupport(post({ subject: 'Hello there', body: 'Hello there\nSecond line' }), SITE, PRINCIPAL, CORS);
    const j = await res.json();
    const msg = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_messages'));
    const newReq = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('F2: open project-less request exists → the message APPENDS (no new ticket)', res.status === 201 && !!msg && msg.body.request_id === 'req_open' && !newReq);
    ok('F2: the append is authored by the requester (portal reader key)', msg && msg.body.author === 'auth-123' && msg.body.author_kind === 'client');
    ok('F2: the response id is the EXISTING request (the portal opens that thread)', j && j.data && j.data.id === 'req_open');
    ok('F2: the append bumps the request updated_at (bell/feed window)', calls.some((c) => c.method === 'PATCH' && c.url.includes('id=eq.req_open')));
  }

  // F2: no open project-less request → a NEW request, stamped client_id (F3)
  {
    const calls = installFetch({ openReqs: [] });
    const res = await handleClientSupport(post({ subject: 'First message', body: 'First message' }), SITE, PRINCIPAL, CORS);
    const newReq = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('F2: no open conversation → a new request opens', res.status === 201 && !!newReq && newReq.body.subject === 'First message');
    ok('F3: the new request is stamped client_id (write-time identity)', newReq && newReq.body.client_id === ME);
  }

  // F2: a SERVICE REQUEST (service/brief) still mints a DISTINCT ticket even with an open conversation
  {
    const calls = installFetch({ openReqs: [{ id: 'req_open', status: 'open' }] });
    const res = await handleClientSupport(post({ subject: 'Service request: Logo pack', brief: { need: 'A logo pack' } }), SITE, PRINCIPAL, CORS);
    const newReq = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    const msg = calls.find((c) => c.method === 'POST' && c.url.includes('presence_support_messages'));
    ok('F2: a service request (brief) ALWAYS mints its own ticket — never appends', res.status === 201 && !!newReq && !msg);
  }

  // F3 (pre-0115): client_id column missing → retried WITHOUT client_id (graceful degrade)
  {
    let n = 0;
    const calls = installFetch({ openReqs: [], reqInsert: () => { n++; return n === 1 ? jr({ code: 'PGRST204', message: "Could not find the 'client_id' column of 'presence_support_requests'" }, 400) : jr([{ id: 'req_2' }], 201); } });
    const res = await handleClientSupport(post({ subject: 'Degrade', body: 'Degrade' }), SITE, PRINCIPAL, CORS);
    const posts = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_support_requests'));
    ok('F3: pre-0115 missing client_id → one retry without the column, request still lands', res.status === 201 && posts.length === 2 && !('client_id' in (posts[1].body || {})));
  }

  // F2 honesty: a FAILED open-conversation read falls through to a NEW request (never a 500)
  {
    const calls = installFetch({ openReqs: [], openReqsStatus: 500 });
    const res = await handleClientSupport(post({ subject: 'Read flaked', body: 'Read flaked' }), SITE, PRINCIPAL, CORS);
    ok('F2: failed open-thread read → degrades to a new request (message never lost)', res.status === 201 && calls.some((c) => c.method === 'POST' && c.url.includes('presence_support_requests')));
  }
} finally {
  globalThis.fetch = realFetch;
}

// ═══ PART B · structural pins on the other writers/readers ═══
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const si = read('supabase/functions/presence/routes/service_intake.ts');
const ws = read('supabase/functions/presence/routes/workspace.ts');
const crm = read('supabase/functions/presence/routes/crm.ts');
const pc = read('supabase/functions/presence/routes/project_comms.ts');
const mig = read('supabase/migrations/0115_support_client_link.sql');

ok('F3: service_intake stamps client_id on new support requests (resolved requester)', /clientIdForRequester/.test(si) && /client_id/.test(si));
ok('F3: workspace feed PREFERS the stamped client_id (tolerant select fallback)', /client_id/.test(ws) && /requesterToClient/.test(ws));
ok('F3: crm conversation reads project-less tickets by client_id AND falls back to keys', /project_id=is\.null&client_id=eq\./.test(crm) && /requester=in\./.test(crm));
ok('F3: project_comms customer-messages read prefers client_id with the key fallback', /client_id=eq\./.test(pc) && /requester=in\./.test(pc));
ok('0115: adds presence_support_requests.client_id (FK clients, set null)', /presence_support_requests add column if not exists client_id uuid references public\.clients\(id\) on delete set null/.test(mig));
ok('0115: adds presence_project_messages.external_id + the partial unique dedup index', /presence_project_messages add column if not exists external_id text/.test(mig) && /presence_project_messages_extid_uq[\s\S]*?\(site_id, external_id\) where external_id is not null/.test(mig));

const passed = results.filter(Boolean).length;
console.log(`\n════ COMMS ROUTING (composer + client_id): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
