// ── P2-E W10: email send-once fixes (L5, structural) ─────────────────────────
//   deno run --allow-read tests/presence/email_send_once_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const sync = read('supabase/functions/presence/commerce/entitlement_sync.ts');
const life = read('supabase/functions/presence/commerce/lifecycle.ts');

// welcome-back email rides the notice insert (send-once), not fired blindly
ok('welcome-back: asks for the inserted row (return=representation) to detect freshness', /kind: 'welcome_back'[\s\S]*?resolution=ignore-duplicates,return=representation/.test(sync) || /resolution=ignore-duplicates,return=representation[\s\S]*?welcome_back/.test(sync));
ok('welcome-back: emails ONLY when the notice is newly created', /freshNotice = ins\.ok && Array\.isArray\(ins\.json\) && ins\.json\.length > 0/.test(sync) && /if \(freshNotice && clQ\.json\?\.\[0\]\?\.email\) sendEmail/.test(sync));
ok('welcome-back: the old unconditional email send is gone', !/\n      if \(clQ\.json\?\.\[0\]\?\.email\) sendEmail\(clQ\.json\[0\]\.email, copy\.subject/.test(sync));

// account_lapsed is bounded to the wind-down window (not monthly forever)
ok('lapse nag: account_lapsed only while within the wind-down window', /if \(days < WIND_DOWN_DAYS\) out\.push\('account_lapsed'\)/.test(life));
ok('lapse nag: win_back + winddown_reminder also bounded before takedown', /days >= 30 && days < WIND_DOWN_DAYS\) out\.push\('win_back'\)/.test(life) && /days >= 45 && days < WIND_DOWN_DAYS\) out\.push\('winddown_reminder'\)/.test(life));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W10 EMAIL SEND-ONCE (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
