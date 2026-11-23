// ── Builder item 392: the old server's last public doors, moved to the main server ──
//   deno run --allow-read --allow-env --allow-net tests/presence/old_server_392_test.mjs
// The three sign-in pages asked the old server (clever-api) "is this person on the
// platform's own team?", and the project survey posted there. Both now live on the main
// server; this suite drives them through the real router (index.ts, std's serve() handed a
// fake listener) on the in-memory PostgREST:
//   1  GET /team/whoami: staff hear their role, everyone else isTeam false, never cached
//   2  POST /survey: kept first, then the owner is emailed; the page hears both truthfully
//   3  the survey's words are escaped in the owner's email, and the name comes from the record
//   4  limits: ten an hour from one sender, fifty a day in all
// (The old server's fixed picker reads are in clever_api_characterization_test.mjs.)
import { installFakePostgrest } from './fake_pgrst.mjs';

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const U_STAFF = uuid('1'), U_CLIENT = uuid('2'), U_NOBODY = uuid('3'), SITE = uuid('a'), CLIENT = uuid('c');
const CONFIRMED = '2026-01-05T10:00:00Z';
const USERS = {
  'jwt-staff': { id: U_STAFF, email: 'ops@platform.example', email_confirmed_at: CONFIRMED },
  'jwt-client': { id: U_CLIENT, email: 'owner@bakery.example', email_confirmed_at: CONFIRMED },
  'jwt-nobody': { id: U_NOBODY, email: 'someone@example.com', email_confirmed_at: CONFIRMED },
};
const db = installFakePostgrest({ users: USERS, ownSite: { 'jwt-client': SITE } });
Deno.env.set('RESEND_KEY', 're_test_stub');
Deno.env.set('OPS_ALERT_EMAIL', 'ops@platform.example');
db.tables.memberships = [{ user_id: U_STAFF, tenant_id: 'tenant-1', role: 'owner' }];
db.tables.clients = [{ id: CLIENT, name: 'Harbor Bakery', email: 'owner@bakery.example', tenant_id: 'tenant-1' }];
db.tables.presence_sites = [{ id: SITE, client_id: CLIENT, slug: 'harbor', status: 'draft' }];

const fake = globalThis.fetch;
const counts = new Map(), mail = [];
let mailDown = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.resend.com/emails')) {
    if (mailDown) return new Response('{"message":"down"}', { status: 503 });
    mail.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: `e${mail.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/rest/v1/rpc/rate_hit')) {
    const b = JSON.parse(String(init.body));
    const k = `${b.p_bucket}|${b.p_window}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    return new Response(JSON.stringify(counts.get(k) <= b.p_max), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fake(url, init);
};

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

/* ── the real index.ts, with std's serve() handed a fake listener: no socket opens ── */
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => resolve(await r) }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
async function call(jwt, method, route, body, ip = '203.0.113.7') {
  const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': ip };
  if (jwt) headers['x-dds-user-jwt'] = jwt;
  const res = await send(new Request(`http://stub.local/functions/v1/presence${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, headers: res.headers };
}

// ═══ 1. GET /team/whoami ═══
{
  const staff = await call('jwt-staff', 'GET', '/team/whoami');
  ok('a staff sign-in hears isTeam with its role and email', staff.status === 200 && staff.json?.isTeam === true && staff.json?.role === 'owner' && staff.json?.email === 'ops@platform.example', JSON.stringify(staff.json));
  ok('the answer is never kept by a browser or a proxy', /no-store/.test(staff.headers.get('Cache-Control') || ''));
  const client = await call('jwt-client', 'GET', '/team/whoami');
  ok('a business owner signed in hears isTeam false, role null', client.status === 200 && client.json?.isTeam === false && client.json?.role === null, JSON.stringify(client.json));
  const nobody = await call('jwt-nobody', 'GET', '/team/whoami');
  ok('a signed-in stranger hears isTeam false', nobody.status === 200 && nobody.json?.isTeam === false);
  const out = await call(null, 'GET', '/team/whoami');
  ok('signed out: isTeam false (200, not "please sign in"), as the old server answered', out.status === 200 && out.json?.isTeam === false && !('email' in (out.json || {})));
  const bad = await call('jwt-unknown', 'GET', '/team/whoami');
  ok('a token the sign-in service refuses: isTeam false', bad.status === 200 && bad.json?.isTeam === false);
  ok('a POST to it is not an answer (only GET is the door)', (await call('jwt-staff', 'POST', '/team/whoami', {})).json?.isTeam === undefined);
}

// ═══ 2. POST /survey: kept, then told ═══
const answer = (over = {}) => ({ type: 'survey_response', clientName: '', clientEmail: '', subject: 'New project survey: 5★', message: 'Rating: 5/5\n\nWhat worked: everything\n\nImprove: <b>nothing</b>', meta: { client_id: CLIENT }, ...over });
{
  const r = await call(null, 'POST', '/survey', answer());
  const row = (db.tables.survey_responses || [])[0];
  ok('the answer is kept (survey_responses) with the client id from the link', r.status === 200 && r.json?.ok === true && r.json?.saved === true && row?.client_id === CLIENT, JSON.stringify(r.json));
  ok('the name comes from the client record when the form sent none (a link carries the id only)', row?.client_name === 'Harbor Bakery');
  ok('the owner is emailed, and the page hears it did', r.json?.emailed === true && mail.length === 1 && mail[0].to === 'ops@platform.example');
  const html = String(mail[0]?.html || '');
  ok('the words are escaped in the owner\'s email, never markup', html.includes('&lt;b&gt;nothing&lt;/b&gt;') && !html.includes('<b>nothing</b>'));
  ok('the subject names who wrote', /New project survey: 5★ from Harbor Bakery/.test(String(mail[0]?.subject || '')), mail[0]?.subject);
  ok('the button opens Studio OS on the app\'s own address', /href="https:\/\/app\.davisdigitalstudio\.com\/studio\.html"/.test(html) || (Deno.env.get('SITE_URL') && html.includes(Deno.env.get('SITE_URL'))));
}
{
  mailDown = true;
  const r = await call(null, 'POST', '/survey', answer({ message: 'Rating: 4/5' }), '203.0.113.8');
  ok('the sending service down: still kept, and the page hears emailed false', r.json?.saved === true && r.json?.emailed === false);
  mailDown = false;
  db.fail.add('survey_responses');
  const r2 = await call(null, 'POST', '/survey', answer({ message: 'Rating: 3/5' }), '203.0.113.9');
  ok('the database down: still emailed, and the page hears saved false', r2.json?.saved === false && r2.json?.emailed === true);
  db.fail.delete('survey_responses');
  const empty = await call(null, 'POST', '/survey', answer({ message: '   ' }));
  ok('nothing written: refused in plain words, nothing kept or sent', empty.status === 400 && /few words/.test(empty.json?.message || ''));
  const notId = await call(null, 'POST', '/survey', answer({ meta: { client_id: 'not-an-id' } }), '203.0.113.10');
  ok('a client id that isn\'t one is dropped, not stored', notId.json?.saved === true && (db.tables.survey_responses || []).at(-1)?.client_id === null);
  const huge = await call(null, 'POST', '/survey', answer({ message: 'x'.repeat(9000), clientName: 'n'.repeat(900) }), '203.0.113.11');
  const last = (db.tables.survey_responses || []).at(-1);
  ok('sizes are capped (4,000 characters of words, 200 of name)', huge.json?.saved === true && last?.message.length === 4000 && last?.client_name.length === 200);
}

// ═══ 4. limits ═══
{
  let lastStatus = 0, through = 0;
  for (let i = 0; i < 11; i++) { const r = await call(null, 'POST', '/survey', answer({ message: `try ${i}` }), '198.51.100.5'); lastStatus = r.status; if (r.status === 200) through++; }
  ok('one sender: ten an hour go through, the eleventh is told to try later', through === 10 && lastStatus === 429);
  let dayStop = 0;
  for (let i = 0; i < 60 && !dayStop; i++) { const r = await call(null, 'POST', '/survey', answer({ message: `day ${i}` }), `192.0.2.${i + 1}`); if (r.status === 429) dayStop = i; }
  // 15 of the day's 50 went above (5 in part 2, 10 from the one sender); the eleventh from that
  // sender was stopped by its own hour and never counted against the day. So 35 more, then no.
  ok('all senders together: fifty a day, and a sender stopped by their own hour doesn\'t use the day up', dayStop === 35, `stopped at ${dayStop}`);
  ok('a visitor\'s address is never stored in a limit bucket', [...counts.keys()].every((k) => !/(\d{1,3}\.){3}\d{1,3}/.test(k)));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ OLD SERVER, ITEM 392: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
