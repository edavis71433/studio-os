// ── One Google app for the back office and the builder's Google connections ──
//   deno run --allow-read --allow-env tests/presence/google_app_reuse_test.mjs
// Eric's call on Nov 8 2026: a Google connection with no CONNECTED_GOOGLE_* pair
// of its own uses the studio's Google app (GOOGLE_CLIENT_ID / _SECRET), which the
// older back office already reads with. Always a whole pair from one place.
import { credsSource, oauthConfigured, authorizeUrl } from '../../supabase/functions/presence/connected/auth.ts';
import { validateSecrets } from '../../supabase/functions/presence/routes/system.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTION_ENC_KEY',
  ...['GOOGLE_SEARCH_CONSOLE', 'GOOGLE_BUSINESS_PROFILE', 'GOOGLE_ANALYTICS', 'FACEBOOK_PAGE', 'LINKEDIN'].flatMap((k) => [`CONNECTED_${k}_CLIENT_ID`, `CONNECTED_${k}_CLIENT_SECRET`])];
const env = (vars) => { for (const k of KEYS) Deno.env.delete(k); for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v); };

env({});
ok('nothing set: no Google connection can start', credsSource('google_search_console') === 'none' && !oauthConfigured('google_search_console') && authorizeUrl('google_search_console', 's') === null);

env({ GOOGLE_CLIENT_ID: 'studio-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'studio-secret' });
for (const k of ['google_search_console', 'google_business_profile', 'google_analytics']) {
  ok(`the studio’s Google app serves ${k}`, credsSource(k) === 'studio_google' && oauthConfigured(k));
}
ok('it never serves another company’s sign-in', credsSource('facebook_page') === 'none' && credsSource('linkedin') === 'none' && !oauthConfigured('facebook_page'));
{
  const u = new URL(authorizeUrl('google_search_console', 'st'));
  ok('the consent link carries the studio app’s id and the app’s callback', u.searchParams.get('client_id') === 'studio-id.apps.googleusercontent.com'
    && u.searchParams.get('redirect_uri') === 'https://app.davisdigitalstudio.com/connections-callback.html', u.search.slice(0, 160));
  ok('and asks only for that product’s permission', u.searchParams.get('scope') === 'https://www.googleapis.com/auth/webmasters.readonly', u.searchParams.get('scope'));
}

env({ GOOGLE_CLIENT_ID: 'studio-id' });
ok('half the studio pair is no pair', credsSource('google_search_console') === 'none' && !oauthConfigured('google_search_console'));

env({ GOOGLE_CLIENT_ID: 'studio-id', GOOGLE_CLIENT_SECRET: 'studio-secret', CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID: 'own-id', CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: 'own-secret' });
ok('a product’s own pair still wins', credsSource('google_search_console') === 'own' && new URL(authorizeUrl('google_search_console', 's')).searchParams.get('client_id') === 'own-id');
ok('while the other Google products keep the studio app', credsSource('google_business_profile') === 'studio_google');

env({ GOOGLE_CLIENT_ID: 'studio-id', GOOGLE_CLIENT_SECRET: 'studio-secret', CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID: 'own-id' });
ok('half an own pair falls back to the whole studio pair, never a mix', credsSource('google_search_console') === 'studio_google'
  && new URL(authorizeUrl('google_search_console', 's')).searchParams.get('client_id') === 'studio-id');

// the activation checklist agrees with what a connect call would do
env({ GOOGLE_CLIENT_ID: 'studio-id', GOOGLE_CLIENT_SECRET: 'studio-secret' });
ok('checklist: no encryption key, no connections, whatever the app', validateSecrets().capabilities.connected_platform === false);
env({ GOOGLE_CLIENT_ID: 'studio-id', GOOGLE_CLIENT_SECRET: 'studio-secret', CONNECTION_ENC_KEY: 'k' });
ok('checklist: the key plus the studio’s Google app turns connections on', validateSecrets().capabilities.connected_platform === true);
ok('checklist: lists the studio’s Google app as present', validateSecrets().groups.connected.filter((s) => s.name.startsWith('GOOGLE_CLIENT_')).every((s) => s.present));
env({ CONNECTION_ENC_KEY: 'k' });
ok('checklist: the key alone turns nothing on', validateSecrets().capabilities.connected_platform === false);
env({});

const fails = results.filter((r) => !r.p);
console.log(`\n════ GOOGLE APP REUSE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
