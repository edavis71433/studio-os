// ── Builder list item 230 (Nov 2026): clients sign in with a code we email them ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_signin_test.mjs
// The emailed code is always on, so nobody is locked out. Google and a password are the
// studio's to add (Settings › Client portal › How clients sign in); the sign-in page shows
// "Continue with Google" only when the studio turned it on and the sign-in service offers
// it, and "Use a password instead" only while passwords are allowed. Five wrong codes and
// the page asks for a new one; a new code can go out once a minute.
import * as P from '../../supabase/functions/presence/lib/portal_settings.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const EMPTY = P.normalizePortal(null);

// ── the setting ──
ok('nothing stored: Google off, a password allowed (as before the switch existed)', same(EMPTY.signin, { google: false, password: true }));
ok('only true turns Google on; only false turns passwords off', same(P.normalizePortal({ signin: { google: 'yes', password: 0 } }).signin, { google: false, password: true }) && same(P.normalizePortal({ signin: { google: true, password: false } }).signin, { google: true, password: false }));
ok('a change takes one way and true or false', same(P.pickStudioChange({ signin: { key: 'google', on: true } }), { signin: { key: 'google', on: true } }) && same(P.pickStudioChange({ signin: { key: 'password', on: false } }), { signin: { key: 'password', on: false } }));
ok('the emailed code can’t be switched, nor a way that isn’t one', !Object.keys(P.pickStudioChange({ signin: { key: 'code', on: false } })).length && !Object.keys(P.pickStudioChange({ signin: { key: 'google', on: 'yes' } })).length);
ok('a change keeps the other way and everything else', (() => {
  const s = P.applyStudioChange(P.normalizePortal({ off: ['help'], welcome: 'Hi', signin: { google: true } }), { signin: { key: 'password', on: false } });
  return same(s.signin, { google: true, password: false }) && same(s.off, ['help']) && s.welcome === 'Hi';
})());
ok('other changes leave the sign-in ways alone', same(P.applyStudioChange(P.normalizePortal({ signin: { google: true } }), { part: { key: 'files', shown: false } }).signin, { google: true, password: true }));

// ── the wiring ──
const routes = read('supabase/functions/presence/agency/routes.ts');
ok('Settings reads and saves them with the portal’s other choices', /signin: ps\.signin, clients,/.test(routes) && /home_off: saved\.home_off, signin: saved\.signin \}/.test(routes));
const brand = read('supabase/functions/presence/routes/studio_brand.ts');
ok('the sign-in page’s public answer carries them (and nothing hidden fails it)', /readPortalSettings\(siteId\)\)\.then\(\(s\) => s\.signin\)\.catch\(\(\) => \(\{ google: false, password: true \}\)\)/.test(brand) && /data: \{ \.\.\.brand, signin \}/.test(brand));
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the portal’s context carries them, for the brand the device keeps', /home_off: s\.home_off, signin: s\.signin \}/.test(ws));
const client = read('client.html');
ok('the portal keeps them with the studio’s name for the sign-in page', client.includes("signin:(PORTAL.ctx.portal&&PORTAL.ctx.portal.signin)||null}));}catch(_){}}"));

const door = read('portal.html');
ok('the sign-in page leads with the emailed code', door.includes('<button id="sendGo" type="submit">Email me a code</button>') && door.includes('We’ll email you a code. No password to remember.') && door.includes('<h1>Check your email</h1>'));
ok('the code goes in six boxes over the one #code input, typed by the phone from the email', /window\.ddsFresh\.boxes\(\{ id: 'code', describedBy: 'codeSub'/.test(door) && /autocomplete="one-time-code"/.test(door));
ok('five wrong codes and the page asks for a new one', /var CODEBOX = null, WRONG = 0, WRONG_MAX = 5;/.test(door) && /if \(WRONG >= WRONG_MAX\) \{ errIn\('errCode', 'That’s five wrong tries\. Send a new code to keep going\.'\); b\.disabled = true; return; \}/.test(door));
ok('a new code once a minute, the wait shown as m:ss, and a new code starts the count again', (door.match(/startResendCooldown\(60\);/g) || []).length === 2 && door.includes('"Send a new code in " + Math.floor(left / 60) + ":"') && /WRONG = 0; codeClear\(\);/.test(door));
ok('Google shows only when the studio turned it on and the sign-in service offers it', /var g = SIGNIN\.google && GOOGLE_ON === true;/.test(door) && /if \(SIGNIN\.google && GOOGLE_ON === null\) \{/.test(door) && /GOOGLE_ON = !!\(j && j\.external && j\.external\.google\)/.test(door) && /signInWithOAuth\(\{ provider: 'google', options: \{ redirectTo: back \} \}\)/.test(door));
ok('the password way shows only while passwords are allowed', /\$\('pwWay'\)\.hidden = !SIGNIN\.password;/.test(door));
ok('the choices are known before the brand paints (none reset after)', door.indexOf('var SIGNIN = {') < door.indexOf('(function studioBrandBoot(){'));
ok('signing in still never makes an account by email', /shouldCreateUser: false/.test(door));

const settings = read('settings.html');
ok('Settings: the emailed code is shown always on; Google waits for the service; a password can go', /row\('code', 'Emailed code', 'Always on, so nobody is locked out\.', true, true, 'Always on'\)/.test(settings) && /Not available yet: Google sign-in needs a one-time set-up for Studio OS first\./.test(settings) && /api\('\/agency\/portal', 'PUT', \{ signin: \{ key, on \} \}\)/.test(settings));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ CLIENT SIGN-IN (item 230): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
