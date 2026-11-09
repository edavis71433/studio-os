// ── "Send me a test" on Send an update (bold redesign, Nov 2026) ──────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/broadcast_test_send_test.mjs
//
// POST /broadcasts/:id/test sends the draft to ONE address: the signed-in person's
// own (never one from the request), through the one send point, the subject marked
// [Test]. Nothing changes on the broadcast — no claim, no count toward the day's
// cap, no history — and ten tests an hour per studio. Driven through a fetch fake:
// who it goes to, what it says, what it never touches, and every refusal.
const ROOT = new URL('../../', import.meta.url);
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');

const { handleBroadcastTest } = await import('../../supabase/functions/presence/routes/broadcasts.ts');

const SITE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const BC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER = { kind: 'operator', userId: 'u-1', email: 'Owner@Brightline.example' };
const row = (over = {}) => ({ id: BC, site_id: SITE.id, subject: 'Spring news from {{business_name}}', body: 'Hi {{first_name}},\n\nWe have **free** photo sessions this month.', audience: 'customers', status: 'draft', ...over });

let calls = [];
let cfg = {};
const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || 'GET').toUpperCase();
  let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
  calls.push({ url, method, body });
  if (url.includes('api.resend.com/emails')) return cfg.resendDown ? jr({ message: 'down' }, 500) : jr({ id: 're_1' });
  if (url.includes('/rpc/rate_hit')) return jr(cfg.rateOk === false ? false : true);
  if (url.includes('presence_broadcasts') && method === 'GET') return jr(cfg.row === null ? [] : [cfg.row || row()]);
  if (url.includes('presence_identity')) return jr([{ business_name: 'Brightline Studio', email: 'hello@brightline.example' }]);
  return jr([]);
};
const realWarn = console.warn, realErr = console.error; console.warn = () => {}; console.error = () => {};
const ask = async (principal = OWNER, c = {}) => {
  calls = []; cfg = c;
  const res = await handleBroadcastTest(SITE, principal, BC, {});
  return { status: res.status, body: await res.json().catch(() => null), calls: calls.slice() };
};
const resendCalls = (cs) => cs.filter((c) => c.url.includes('api.resend.com/emails'));
const writes = (cs) => cs.filter((c) => c.method !== 'GET' && c.url.includes('/rest/v1/') && !c.url.includes('/rpc/rate_hit'));

try {
  // ── a draft: one email, to the signed-in person, marked [Test] ──
  {
    const r = await ask();
    const sent = resendCalls(r.calls);
    ok('a draft answers 200 and says where it went', r.status === 200 && r.body?.data?.ok === true && r.body.data.to === 'owner@brightline.example', JSON.stringify(r.body));
    ok('exactly one email goes out', sent.length === 1, String(sent.length));
    const to = sent[0]?.body?.to;
    ok('…to the signed-in person’s own address and no one else', JSON.stringify(Array.isArray(to) ? to : [to]) === JSON.stringify(['owner@brightline.example']), JSON.stringify(to));
    ok('the subject is marked [Test] and filled in', String(sent[0]?.body?.subject || '').startsWith('[Test] Spring news from '), sent[0]?.body?.subject);
    const html = String(sent[0]?.body?.html || '');
    ok('the body is the update, filled in the way the preview shows it', /Hi there/.test(html) && /<strong>free<\/strong>|<b>free<\/b>/.test(html), html.slice(0, 200));
    ok('nothing about the broadcast changes: no claim, no count, no history', writes(r.calls).length === 0, JSON.stringify(writes(r.calls).map((c) => c.method + ' ' + c.url)));
    ok('the open counter is not in a test', !/\/o\/|open-pixel|pixel/i.test(html));
    ok('one test costs one hit on the studio’s hourly limit', r.calls.filter((c) => c.url.includes('/rpc/rate_hit')).length === 1 && /broadcast_test:/.test(JSON.stringify(r.calls.find((c) => c.url.includes('/rpc/rate_hit'))?.body)));
  }
  // ── a scheduled update can still be tested ──
  {
    const r = await ask(OWNER, { row: row({ status: 'scheduled' }) });
    ok('a scheduled update can be tested too', r.status === 200 && resendCalls(r.calls).length === 1);
  }
  // ── refusals: nothing goes out ──
  {
    const none = await ask({ ...OWNER, email: null });
    ok('a sign-in with no email: refused, nothing sent', none.status === 400 && none.body?.error === 'no_email' && resendCalls(none.calls).length === 0);
    const bad = await ask({ ...OWNER, email: 'not an address' });
    ok('a sign-in whose email isn’t an address: refused', bad.status === 400 && resendCalls(bad.calls).length === 0);
    const sentAlready = await ask(OWNER, { row: row({ status: 'sent' }) });
    ok('an update that has gone out: refused', sentAlready.status === 409 && resendCalls(sentAlready.calls).length === 0);
    const sending = await ask(OWNER, { row: row({ status: 'sending' }) });
    ok('an update going out right now: refused', sending.status === 409 && resendCalls(sending.calls).length === 0);
    const gone = await ask(OWNER, { row: null });
    ok('a broadcast that isn’t here: 404', gone.status === 404 && resendCalls(gone.calls).length === 0);
    const noSubj = await ask(OWNER, { row: row({ subject: '' }) });
    ok('no subject yet: refused with the reason', noSubj.status === 400 && noSubj.body?.error === 'no_subject' && resendCalls(noSubj.calls).length === 0);
    const noBody = await ask(OWNER, { row: row({ body: '   ' }) });
    ok('no message yet: refused with the reason', noBody.status === 400 && noBody.body?.error === 'no_body' && resendCalls(noBody.calls).length === 0);
    const limited = await ask(OWNER, { rateOk: false });
    ok('over ten an hour: 429, nothing sent', limited.status === 429 && resendCalls(limited.calls).length === 0);
    const down = await ask(OWNER, { resendDown: true });
    ok('the mail service failing: 502, and it says nothing went to the list', down.status === 502 && /nothing went to your list/.test(down.body?.message || ''));
    const junk = await handleBroadcastTest(SITE, OWNER, 'not-a-uuid', {});
    ok('a junk id: 404 before any read', junk.status === 404);
  }
  // ── wiring ──
  {
    const idx = Deno.readTextFileSync(new URL('supabase/functions/presence/index.ts', ROOT));
    ok('POST /broadcasts/:id/test is wired to the handler, beside send', /route\.match\(\/\^\\\/broadcasts\\\/\(\[0-9a-f-\]\{36\}\)\\\/test\$\/\);\s*\n\s*if \(m && method === 'POST'\) return handleBroadcastTest\(site, principal, m\[1\], cors\);/.test(idx));
    const roles = Deno.readTextFileSync(new URL('supabase/functions/presence/lib/site_roles.ts', ROOT));
    ok('a member needs edit for it (it only ever reaches their own inbox), not publish', /`POST \/broadcasts\/\$\{ID\}\/test`/.test(roles));
    const src = Deno.readTextFileSync(new URL('supabase/functions/presence/routes/broadcasts.ts', ROOT));
    const fn = (src.match(/export async function handleBroadcastTest[\s\S]*?\n}\n/) || [''])[0];
    ok('the handler never reads an address from the request', !/req\b/.test(fn.split('{')[0]) && !/\.json\(\)/.test(fn));
  }
} finally {
  globalThis.fetch = realFetch; console.warn = realWarn; console.error = realErr;
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
