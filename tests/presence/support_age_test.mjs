// ── How long a support request has waited, for Home's Clear (item 96 follow-up) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/support_age_test.mjs
// Live on Nov 8 2026: four support requests opened in July and never answered read
// "Opened 3 months ago" on Home, yet "2 of these have waited over a month" left them out.
// Their updated_at was that afternoon, all within one second: the owner stamp (B2) had
// written them. A request's age is now its newest message, or its opening, read in one go.
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const SITE = '11111111-1111-4111-8111-111111111111';
const R1 = 'a1a1a1a1-0000-4000-8000-000000000001', R2 = 'a2a2a2a2-0000-4000-8000-000000000002', R3 = 'a3a3a3a3-0000-4000-8000-000000000003';
let calls = [], answer = null;
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (answer === 'fail') return new Response('{"message":"boom"}', { status: 500 });
  if (answer === 'throw') throw new Error('network down');
  return new Response(JSON.stringify(answer || []), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { supportActivity } = await import('../../supabase/functions/presence/lib/service_bridge.ts');
const rows = [
  { id: R1, created_at: '2026-07-14T10:00:00Z' },   // answered since
  { id: R2, created_at: '2026-07-22T10:00:00Z' },   // never a message
  { id: R3, created_at: '2026-11-08T10:00:00Z' },
  { id: 'not-an-id', created_at: '2026-07-01T10:00:00Z' },
];
{
  calls = []; answer = [   // newest first, as asked
    { request_id: R1, created_at: '2026-11-08T17:09:15Z' },
    { request_id: R3, created_at: '2026-11-08T12:00:00Z' },
    { request_id: R1, created_at: '2026-07-15T09:00:00Z' },
  ];
  const a = await supportActivity(SITE, rows);
  ok('a request with messages is as old as its newest one', a?.[R1] === '2026-11-08T17:09:15Z', JSON.stringify(a));
  ok('a request with none is as old as its opening', a?.[R2] === '2026-07-22T10:00:00Z');
  ok('anything that isn’t a request id is left out', a && !('not-an-id' in a));
  const u = decodeURIComponent(calls[0] || '');
  ok('one read for every request', calls.length === 1);
  ok('…scoped to this site, these requests and live messages, newest first', u.includes(`presence_support_messages?site_id=eq.${SITE}&`) && u.includes(`request_id=in.(${R1},${R2},${R3})`) && u.includes('deleted_at=is.null') && u.includes('order=created_at.desc') && !u.includes('not-an-id'), u);
}
{
  answer = 'fail';
  ok('a failed read says it doesn’t know (null), so no request is counted old', (await supportActivity(SITE, rows)) === null);
  answer = 'throw';
  ok('…and so does a network failure, without throwing', (await supportActivity(SITE, rows)) === null);
  answer = null; calls = [];
  ok('no requests: no read', JSON.stringify(await supportActivity(SITE, [])) === '{}' && calls.length === 0);
}
{
  const src = read('supabase/functions/presence/agency/routes.ts');
  ok('Home reads it beside the owner stamp, and ages each request by it', /const \[owners, activity\] = await Promise\.all\(\[healSupportOwners\(own\.id, supportRows\), supportActivity\(own\.id, supportRows/.test(src) && /if \(activity\) for \(const r of supportRows\) \(r as \{ last_activity_at\?: string \| null \}\)\.last_activity_at = activity\[r\.id\] \|\| null;/.test(src));
  const ny = read('supabase/functions/presence/agency/needs_you.ts');
  ok('the list ages a request by that, never by updated_at', /at: s\.last_activity_at \?\? null, clear: \{ kind: 'support'/.test(ny) && !/at: s\.updated_at/.test(ny));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
