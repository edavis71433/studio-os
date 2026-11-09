// ── The Search tab and its neighbours say what is true (list item 95) ────────
//   deno run --allow-read --allow-env --allow-net tests/presence/search_words_test.mjs
// The Search tab's tip promised a "Show this page on Google?" switch that moved to the
// Pages tab; its card told the owner to "add your free Search Console code above" (that
// code is only the ownership tag, and Connect is the way) and printed a schema word; a
// paused plan's message carried the page's own "[site]" debugging tag; Draft with help
// named fields by their storage keys ("seo description"); Connections ran "searchas of
// 2026-11-08" together; and the "not switched on yet" help for a Google product named
// secrets nobody needs since it signs in with the studio's Google app.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const presence = read('presence.html');
const tip = presence.match(/search: \["search-plain", "([^"]+)"\]/)?.[1] || '';
ok('the Search tip says what is on the tab, and where a page’s own Google settings are', !!tip && !/Show this page on Google/.test(tip) && /Pages tab/.test(tip), tip);
ok('the Search card prints no schema word', !/h\.schema/.test(presence) && !/LocalBusiness/.test(presence));
ok('its missing step names the Connect button, and is quiet once Search Console is connected',
  !presence.includes('Add your free Google Search Console code above') && /else if \(SEO_CONN !== "connected"\) line\(false, "", "To see how people find you on Google, connect Google Search Console with the button above\."\)/.test(presence));
ok('a paused plan’s message reaches the owner without the page’s tag', /showGate\("Paused for now", String\(err\.message \|\| ""\)\.replace\(\/\^\\\[\[\\w-\]\+\\\] \/, ""\), true\)/.test(presence));
ok('Draft with help names a field as its form label does', /bits\.push\(`\$\{fieldName\(k\)\}: \$\{v\}`\)/.test(presence) && !/k\.replace\(\/_\/g, " "\)\}: \$\{v\}/.test(presence));
const conn = read('connections.html');
ok('Connections separates the date from the last number and says it in words', /<span class="asof"> · as of \$\{esc\(asOfWords\(d\.as_of\)\)\}<\/span>/.test(conn) && /function asOfWords\(iso\)/.test(conn));

// the server's help, behaviourally
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
const { activationHelp } = await import('../../supabase/functions/presence/routes/connections.ts');
const g = activationHelp('google_search_console', 'Google Search Console');
ok('a Google product’s help names the studio’s Google app', JSON.stringify(g.missing) === JSON.stringify(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTION_ENC_KEY']) && /studio’s Google app/.test(g.message) && !/CONNECTED_/.test(g.message));
ok('it still says where the app sends people back, the product’s own extra step, and that nothing is wrong with the account', /connections-callback\.html/.test(g.message) && /webmasters\.readonly/.test(g.message) && /Nothing is wrong with your account/.test(g.message));
const ga = activationHelp('google_analytics', 'Google Analytics');
ok('so does every other Google product', ga.missing[0] === 'GOOGLE_CLIENT_ID' && /analytics\.readonly/.test(ga.message));
const other = activationHelp('mailchimp', 'Mailchimp');
ok('a product that isn’t Google keeps its own pair', JSON.stringify(other.missing) === JSON.stringify(['CONNECTED_MAILCHIMP_CLIENT_ID', 'CONNECTED_MAILCHIMP_CLIENT_SECRET', 'CONNECTION_ENC_KEY']));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
