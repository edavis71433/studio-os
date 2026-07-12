// ── P2-F G3: unified website-attention notices (structural) ──────────────────
//   deno run --allow-read tests/presence/website_notices_test.mjs
// Website-attention events must ride the ONE notice model (presence_plan_notices),
// idempotent, with a deep link — no second notification system, no storms.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const notice = read('supabase/functions/presence/lib/notice.ts');
const publish = read('supabase/functions/presence/routes/publish.ts');
const presence = read('presence.html');

// one model, idempotent, best-effort
ok('helper: raiseNotice writes the ONE model (plan_notices, unique client/kind/period)', /presence_plan_notices\?on_conflict=client_id,kind,period/.test(notice) && /resolution=ignore-duplicates,return=representation/.test(notice));
ok('helper: returns true only on a fresh insert (no double-fire) + never throws', /const created = ins\.ok && Array\.isArray\(ins\.json\) && ins\.json\.length > 0/.test(notice) && /return created/.test(notice) && /catch \(e\)/.test(notice));
ok('helper: clearNotice can drop a resolved attention item', /export async function clearNotice/.test(notice));

// publish failure → notice, idempotent per publish, cleared on success
ok('publish: a failure raises a website-attention notice on the one model', /raiseNotice\(\{[\s\S]*?kind: 'publish_failed', period: `pub:\$\{pubId\}`/.test(publish));
ok('publish: idempotent per publish id (no storm on retry)', /period: `pub:\$\{pubId\}`/.test(publish));
ok('publish: a successful publish clears the lingering publish-failed notice', /if \(live && site\.client_id\) await clearNotice\(site\.client_id, 'publish_failed'\)/.test(publish));

// frontend: no dead-ends — every kind has a deep-link action
ok('UI: publish_failed / connection_expired / website_enquiry render with deep links', /publish_failed:\s*\{ label:[^}]*href:/.test(presence) && /connection_expired:\s*\{ label:[^}]*href: "connections\.html"/.test(presence) && /website_enquiry:\s*\{ label:[^}]*href: "leads\.html"/.test(presence));
ok('UI: notices are prioritized (website-attention first) not limited to 5 kinds', /NOTICE_PRIORITY = \["publish_failed", "connection_expired", "website_enquiry"/.test(presence) && /for \(const k of NOTICE_PRIORITY\)/.test(presence));
ok('UI: the action label + href come from the kind map (no hardcoded See plans only)', /const up = el\("a", "textact", act\.label\)/.test(presence) && /up\.href = act\.href/.test(presence));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-F G3 WEBSITE-ATTENTION NOTICES (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
