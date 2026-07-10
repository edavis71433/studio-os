// ── P2-E W5: notice-dismissal correctness (M2, structural) ───────────────────
//   deno run --allow-read tests/presence/notice_dismiss_test.mjs
// Dismissing the visible card must dismiss ONLY that notice — never silently
// clear unseen lifecycle notices (trial/lapse) whose send-once already fired.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const commerce = read('supabase/functions/presence/routes/commerce.ts');
const presence = read('presence.html');

ok('dismiss: handler reads the request body for {id}', /async function handleNoticeDismiss\(req: Request, jwt: string/.test(commerce) && /body\.id === 'string'/.test(commerce));
ok('dismiss: scopes the PATCH to id AND the caller client_id (svc bypasses RLS)', commerce.includes('id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(site.client_id)}&status=eq.active'));
ok('dismiss: the old dismiss-ALL-for-client is GONE (no unscoped client-wide dismiss)', !/presence_plan_notices\?client_id=eq\.\$\{encodeURIComponent\(site\.client_id\)\}&status=eq\.active`, \{\s*method: 'PATCH', body: JSON\.stringify\(\{ status: 'dismissed' \}\),/.test(commerce));
ok('dismiss: the no-id legacy fallback only clears the capacity card, not lifecycle', /kind=eq\.capacity&status=eq\.active/.test(commerce));
ok('dispatch: the route passes req through', /route === '\/commerce\/notices\/dismiss'[\s\S]*?handleNoticeDismiss\(req, jwt, cors\)/.test(commerce));
ok('frontend: dismiss sends the specific notice id', /notices\/dismiss", \{ id: n\.id \}/.test(presence));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W5 NOTICE DISMISS (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
