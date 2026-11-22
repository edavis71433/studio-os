// ── publish-journey.yml: the real publish journey, designed and switched off (builder item 421) ──
//   deno run --allow-read tests/workflows/publish_journey_test.mjs
// The journey publishes a throwaway site for real on a separate Netlify test team, which
// costs credits, so it stays off until Eric agrees (the workflow's header says how to switch
// it on). This holds what must stay true until then, and after: no schedule runs it yet, it
// refuses without the test team's own token, it never reads a production secret, it builds
// on a scratch database, and it deletes the test site whatever happens.

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`); };
const WF = read('.github/workflows/publish-journey.yml');
const SCRIPT = read('scripts/publish-journey.sh');

ok('switched off: no schedule runs it (the lines are there, commented out)', !/^ {2}schedule:/m.test(WF) && /^ {2}# schedule:\n {2}# {3}- cron: "/m.test(WF));
ok('runs only by hand until then', /^on:\n {2}workflow_dispatch:$/m.test(WF) && !/^ {2}(push|pull_request):/m.test(WF));
ok('refuses without the test team\'s token, before anything else', WF.indexOf('NETLIFY_TEST_TOKEN (a token for a separate Netlify test team)') > 0 && WF.indexOf('NETLIFY_TEST_TOKEN (a token') < WF.indexOf('actions/checkout'));
ok('reads no production secret: only the test team\'s token', [...WF.matchAll(/secrets\.(\w+)/g)].every((m) => m[1] === 'NETLIFY_TEST_TOKEN') && !/SUPABASE_PROJECT_REF_PROD|SUPABASE_ACCESS_TOKEN|NETLIFY_AUTH_TOKEN: \$\{\{/.test(WF));
ok('the server it publishes through is a scratch one, from this commit', SCRIPT.includes('supabase start') && SCRIPT.includes('supabase functions serve') && !SCRIPT.includes('qksstlqzbhesadrrofgn'));
ok('every site it makes lands on the test team (the server is handed the test token)', SCRIPT.includes('echo "NETLIFY_AUTH_TOKEN=$NETLIFY_TEST_TOKEN"'));
ok('it deletes the test site whatever happens', /trap cleanup EXIT/.test(SCRIPT) && /-X DELETE -H "Authorization: Bearer \$NETLIFY_TEST_TOKEN" "\$NETLIFY\/sites\/\$SITE_ID"/.test(SCRIPT));
ok('the journey: publish, live, the site answers with its own name, offline, the holding page', ['$P/publish', 'status" = live', 'grep -qF "$name"', '$P/site/offline'].every((x) => SCRIPT.includes(x)));
ok('it says it hasn\'t been run yet', WF.includes('Not yet run') && SCRIPT.includes('NOT YET RUN'));
ok('the cost is written where the switch is', /15 credits each/.test(WF) && /900\s*#?\s*credits a month/.test(WF.replace(/\n# /g, ' ')));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ PUBLISH JOURNEY (421): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
