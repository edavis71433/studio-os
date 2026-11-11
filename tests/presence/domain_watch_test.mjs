// ── Nov 2026 review, builder list items 132, 133 and 134: the daily domain watch ──
//   deno run --allow-read --allow-env tests/presence/domain_watch_test.mjs
// 132: the registration record is asked under the registered name ("www." and other
//      sub-names dropped), and a failed lookup is said on the Domains page.
// 133: reminders at 30, 15, 7 and 1 days and once after expiry, each said once per
//      expiry date, to the client and every time to the studio.
// 134 (padlock half): asked for again while the records are right and it isn't on;
//      its end date kept and shown; Home asks after a day stuck or inside 14 days.
// The pure rules first, then the real job against a stubbed registry, DNS, Netlify,
// database and email. No outside call leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';

const { registrableCandidates, expiryRung, expiryWords } = await import(`${P}/lib/rdap.ts`);
const { padlockAfterCheck, certIsOn } = await import(`${P}/lib/domain_health.ts`);
const { buildDomains } = await import(`${P}/agency/sites.ts`);
const { buildNeedsYou } = await import(`${P}/agency/needs_you.ts`);
const { domainExpiryPeriod } = await import(`${P}/commerce/lifecycle.ts`);

// ═══ 132: the registered name ═══
ok('"www." is dropped before asking', JSON.stringify(registrableCandidates('www.restaurant.com')) === '["restaurant.com"]');
ok('a bare name is asked as it is', JSON.stringify(registrableCandidates('restaurant.com')) === '["restaurant.com"]');
ok('other sub-names are dropped one at a time (finds example.co.uk without a suffix list)', JSON.stringify(registrableCandidates('shop.example.co.uk')) === '["shop.example.co.uk","example.co.uk","co.uk"]');
ok('capitals and a trailing dot are tidied', JSON.stringify(registrableCandidates('WWW.Example.COM.')) === '["example.com"]');
ok('nothing to ask for an empty name', registrableCandidates('').length === 0);

// ═══ 133: the ladder ═══
const rungs = [[45, null], [31, null], [30, '30'], [16, '30'], [15, '15'], [8, '15'], [7, '7'], [2, '7'], [1, '1'], [0, '1'], [-1, 'expired'], [-20, 'expired'], [null, null]];
ok('the rungs are 30, 15, 7, 1 and once after expiry', rungs.every(([d, r]) => expiryRung(d) === r), JSON.stringify(rungs.map(([d]) => expiryRung(d))));
ok('the words: today, tomorrow, in N days, has expired', expiryWords('a.com', 0, '').when === 'expires today' && expiryWords('a.com', 1, '').when === 'expires tomorrow' && expiryWords('a.com', 9, '').when === 'expires in 9 days' && expiryWords('a.com', -2, '').when === 'has expired');
ok('after expiry it says there’s usually still time at the normal price', /about 30 days/.test(expiryWords('a.com', -1, 'GoDaddy').after) && /at GoDaddy/.test(expiryWords('a.com', -1, 'GoDaddy').body));
ok('each rung is said once per domain and expiry date; a renewal starts again', domainExpiryPeriod('a.com', '2026-12-01T10:00:00Z', '7') === 'exp:a.com:2026-12-01:7' && domainExpiryPeriod('a.com', '2027-12-01T10:00:00Z', '7') !== domainExpiryPeriod('a.com', '2026-12-01T10:00:00Z', '7'));

// ═══ 134: the padlock rules ═══
const NOW = '2026-11-11T12:00:00.000Z';
ok('issued and renewed are on; pending and none are not', certIsOn('issued') && certIsOn('renewed') && !certIsOn('pending') && !certIsOn('none'));
{
  const waiting = padlockAfterCheck({ health: 'ssl_pending', ssl: { state: 'pending', expires_at: null } }, null, NOW);
  ok('records right, no padlock: ask again, and start the clock', waiting.reask && waiting.cert_pending_since === NOW && waiting.cert_expires_at === null);
  ok('…and keep the clock running on the next day', padlockAfterCheck({ health: 'ssl_pending', ssl: { state: 'pending', expires_at: null } }, '2026-11-09T00:00:00Z', NOW).cert_pending_since === '2026-11-09T00:00:00Z');
  const on = padlockAfterCheck({ health: 'ok', ssl: { state: 'issued', expires_at: '2027-02-01T00:00:00Z' } }, '2026-11-09T00:00:00Z', NOW);
  ok('padlock on: its end date kept, the clock cleared, nothing asked', !on.reask && on.cert_pending_since === null && on.cert_expires_at === '2027-02-01T00:00:00Z');
  const dns = padlockAfterCheck({ health: 'dns_pending', ssl: { state: 'none', expires_at: null } }, '2026-11-09T00:00:00Z', NOW);
  ok('records not right yet: that’s the client’s side, so no clock and no asking', !dns.reask && dns.cert_pending_since === null);
}
{
  const base = { site_id: 's1', name: 'Bistro', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'bistro.example', uptime_ok: true, domain_expires_at: '2027-06-01T00:00:00Z', domain_lookup_status: 'ok' };
  const one = (over) => buildDomains([{ ...base, ...over }], NOW).domains[0];
  ok('a padlock stuck over a day reads "Padlock not on yet"', one({ cert_pending_since: '2026-11-10T06:00:00Z' }).status_words === 'Padlock not on yet');
  ok('…but not before a day', one({ cert_pending_since: '2026-11-11T06:00:00Z' }).status === 'connected');
  ok('a padlock ending inside 14 days says when', one({ cert_expires_at: '2026-11-20T00:00:00Z' }).status_words === 'Padlock ends in 9 days');
  ok('its end date travels for the Padlock until column', one({ cert_expires_at: '2027-02-01T00:00:00Z' }).padlock_until === '2027-02-01T00:00:00Z');
  ok('a site on its own host has no padlock of ours', one({ edition: 'monitor', cert_expires_at: '2026-11-20T00:00:00Z' }).padlock_until === null);
  ok('a failed or empty lookup reads as unreadable, an untried one as unknown', one({ domain_lookup_status: 'failed' }).record === 'unreadable' && one({ domain_lookup_status: 'not_found' }).record === 'unreadable' && one({ domain_lookup_status: null }).record === 'unknown');
  ok('expiry still comes first', one({ domain_expires_at: '2026-11-20T00:00:00Z', cert_expires_at: '2026-11-20T00:00:00Z' }).status === 'expiring');
}
{
  const input = (site) => ({ nowIso: NOW, links: [{ site_id: 's1', status: 'active' }], clientNames: { s1: 'Bistro' }, sites: [{ id: 's1', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'bistro.example', ...site }] });
  const pad = (rows) => rows.find((r) => r.key === 'broken:padlock:s1');
  const stuck = pad(buildNeedsYou(input({ cert_pending_since: '2026-11-10T06:00:00Z' })));
  ok('Home asks when the padlock has been stuck a day', !!stuck && /hasn’t come on/.test(stuck.what) && stuck.href.endsWith('#domain'));
  ok('…and when it ends inside 14 days', /ends in 9 days/.test(pad(buildNeedsYou(input({ cert_expires_at: '2026-11-20T00:00:00Z' })))?.what || ''));
  ok('…and not otherwise', !pad(buildNeedsYou(input({ cert_expires_at: '2027-02-01T00:00:00Z' }))) && !pad(buildNeedsYou(input({ cert_pending_since: '2026-11-11T06:00:00Z' }))));
}

// ═══ the wiring ═══
{
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  ok('the watch asks under the registered name and records how it went', /rdapLookupDetailed\(site\.custom_domain\)/.test(life) && /\.\.\.lookupPatch\(look\)/.test(life) && /domain_lookup_status: look\.status/.test(read('supabase/functions/presence/lib/rdap.ts')));   // item 162: one home for what a lookup writes
  ok('the studio gets every rung by email', /emailOperator\(String\(studioSite\)/.test(life));
  ok('a stuck padlock is asked for again each day', /if \(padlock\.reask\) \{ await provisionSsl\(site\.netlify_site_id\)/.test(life));
  const admin = read('supabase/functions/presence/routes/admin.ts');
  ok('"Check if it’s ready" asks for the padlock again', /if \(st\.health === 'ssl_pending' && site\.netlify_site_id\) await provisionSsl\(site\.netlify_site_id\)/.test(admin));
  ok('one home for the DNS check', /import \{ domainHealth[^}]*\} from '\.\.\/lib\/domain_health\.ts';/.test(admin) && !/async function dnsLookup/.test(admin));
  const mig = read('supabase/migrations/0149_domain_watch.sql'), pack = read('docs/presence/APPLY-0149-prod.sql');
  const cols = ['domain_lookup_status', 'cert_state', 'cert_expires_at', 'cert_pending_since', 'cert_checked_at'];
  ok('the migration and its production pack add the same five columns', cols.every((c) => mig.includes(`add column if not exists ${c}`) && pack.includes(`add column if not exists ${c}`)));
  ok('both keep the lookup to ok, not_found or failed', [mig, pack].every((x) => /domain_lookup_status in \('ok','not_found','failed'\)/.test(x)));
  ok('Home and the Domains page read the padlock', /cert_expires_at,cert_pending_since[,&]/.test(read('supabase/functions/presence/agency/routes.ts')) && /DOMAIN_COLS = `\$\{EXTRA_COLS\},domain_lookup_status,cert_expires_at,cert_pending_since[,`]/.test(read('supabase/functions/presence/agency/sites.ts')));
  const page = read('domains.html');
  ok('the Domains page has a Padlock until column and says when a record couldn’t be read', /\['padlock','Padlock until'/.test(page) && /Couldn’t read this domain’s record/.test(page));
}

// ═══ the real job, against stubs ═══
const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', STUDIO = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
let world;
function reset(over = {}) {
  world = { domain: 'www.bistro.example', rdap: { 'bistro.example': { status: 200, expires: '2026-11-18T00:00:00Z' } }, ssl: { state: 'pending' }, dnsRight: true, pendingSince: null,
    patches: [], notices: [], dismissed: [], emails: [], reask: 0, rdapAsked: [], clientEmail: 'owner@bistro.example', ...over };
}
const reply = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'rdap.org') { const name = decodeURIComponent(u.pathname.split('/').pop()); world.rdapAsked.push(name); const r = world.rdap[name];
    if (!r) return reply({ errorCode: 404 }, 404); if (r.status !== 200) return reply({}, r.status);
    return reply({ events: [{ eventAction: 'expiration', eventDate: r.expires }], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'GoDaddy']]] }] }); }
  if (u.hostname === 'dns.google') { const type = u.searchParams.get('type'); return reply({ Answer: world.dnsRight && type === 'CNAME' ? [{ data: 'bistro.netlify.app.' }] : [] }); }
  if (u.hostname === 'api.netlify.com') {
    if (u.pathname.endsWith('/ssl') && method === 'POST') { world.reask++; return reply({}); }
    if (u.pathname.endsWith('/ssl')) return reply(world.ssl);
    return reply({ id: 'nf1', name: 'bistro', default_domain: 'bistro.netlify.app', url: 'https://bistro.netlify.app' });
  }
  if (u.hostname === 'api.resend.com') { world.emails.push(JSON.parse(init.body)); return reply({ id: 'em' }); }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (table === 'presence_sites' && method === 'PATCH') { world.patches.push(JSON.parse(init.body)); return reply([]); }
  if (table === 'presence_sites' && q.includes('custom_domain=not.is.null')) return reply([{ id: SITE, client_id: CLIENT, custom_domain: world.domain, netlify_site_id: 'nf1', edition: 'presence', cert_pending_since: world.pendingSince }]);
  if (table === 'presence_sites') return reply([{ id: STUDIO, client_id: 'studio-client' }]);
  if (table === 'presence_plan_notices' && method === 'POST') { const b = JSON.parse(init.body); if (world.notices.some((n) => n.period === b.period)) return reply([]); world.notices.push(b); return reply([{ id: 'n' + world.notices.length }]); }
  if (table === 'presence_plan_notices' && method === 'PATCH') { world.dismissed.push(q); return reply([]); }
  if (table === 'clients') return reply([{ email: world.clientEmail, name: 'Bistro' }]);
  if (table === 'presence_service_links') return reply([{ agency_site_id: STUDIO }]);
  if (table === 'presence_identity') return reply([{ business_name: 'The Studio', email: q.includes(STUDIO) ? 'studio@studio.example' : '' }]);
  return reply([]);
};
const { runDomainWatch } = await import(`${P}/commerce/lifecycle.ts`);
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

// a "www." name, 7 days out, padlock pending with the records right
const realNow = Date.now;
Date.now = () => Date.parse('2026-11-11T12:00:00.000Z');
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { if (!a.length) super(RealDate.now()); else super(...a); } static now() { return RealDate.parse('2026-11-11T12:00:00.000Z'); } };
reset();
{
  const r = await quiet(() => runDomainWatch(10));
  const patch = world.patches[0] || {};
  ok('the "www." name is asked as the registered name, once', JSON.stringify(world.rdapAsked) === '["bistro.example"]', JSON.stringify(world.rdapAsked));
  ok('the expiry and provider are saved, and the lookup is marked ok', patch.domain_lookup_status === 'ok' && patch.domain_expires_at === '2026-11-18T00:00:00.000Z' && patch.domain_registrar === 'GoDaddy');
  ok('the 7-day rung is raised, keyed by domain, date and rung', world.notices.length === 1 && world.notices[0].period === 'exp:www.bistro.example:2026-11-18:7' && world.notices[0].kind === 'domain_expiry', JSON.stringify(world.notices.map((n) => n.period)));
  const to = world.emails.map((e) => e.to);
  ok('the client and the studio are both emailed', to.includes('owner@bistro.example') && to.includes('studio@studio.example'), JSON.stringify(to));
  ok('older rungs and month-keyed reminders are put away', world.dismissed.length === 2 && world.dismissed.some((q) => /period=like\.exp:www\.bistro\.example:%/.test(q)) && world.dismissed.some((q) => /period=not\.like\.exp:%/.test(q)));
  ok('the padlock, records right and not on, is asked for again and its clock starts', world.reask === 1 && patch.cert_pending_since === '2026-11-11T12:00:00.000Z' && patch.cert_state === 'pending' && r.reasked === 1);
  ok('the run counts what it did', r.checked === 1 && r.warned === 1);
}
// the same rung the next day: said once
{
  const before = world.emails.length;
  await quiet(() => runDomainWatch(10));
  ok('the same rung is never said twice', world.notices.length === 1 && world.emails.filter((e) => /bistro/.test(JSON.stringify(e))).length === before);
}
// a sub-name that isn't registered, then the registered one
reset({ domain: 'shop.bistro.example' });
await quiet(() => runDomainWatch(10));
ok('a sub-name is tried, then the registered name', JSON.stringify(world.rdapAsked) === '["shop.bistro.example","bistro.example"]', JSON.stringify(world.rdapAsked));
// the registry fails
reset({ rdap: { 'bistro.example': { status: 503 } } });
await quiet(() => runDomainWatch(10));
ok('a failed lookup is recorded as failed, with nothing guessed', world.patches[0].domain_lookup_status === 'failed' && !('domain_expires_at' in world.patches[0]) && world.notices.length === 0);
// nothing found anywhere
reset({ rdap: {} });
await quiet(() => runDomainWatch(10));
ok('no record under any name is not_found', world.patches[0].domain_lookup_status === 'not_found');
// the padlock is on: its end date kept, nothing asked
reset({ ssl: { state: 'issued', expires_at: '2027-02-01T00:00:00Z' }, pendingSince: '2026-11-09T00:00:00Z', rdap: { 'bistro.example': { status: 200, expires: '2027-06-01T00:00:00Z' } } });
await quiet(() => runDomainWatch(10));
ok('a padlock that is on: end date kept, clock cleared, nothing asked, no reminder', world.patches[0].cert_expires_at === '2027-02-01T00:00:00Z' && world.patches[0].cert_pending_since === null && world.reask === 0 && world.notices.length === 0);
// the records aren't right yet: not stuck on our side
reset({ dnsRight: false, ssl: { state: 'none' } });
await quiet(() => runDomainWatch(10));
ok('records not right yet: no asking, no clock', world.reask === 0 && world.patches[0].cert_pending_since === null);
// a client with no email: the studio is told that too
reset({ clientEmail: '' });
await quiet(() => runDomainWatch(10));
ok('a client without an email: the studio still hears, and is told the client wasn’t', world.emails.length === 1 && world.emails[0].to === 'studio@studio.example' && /no email on their record/.test(world.emails[0].html));
globalThis.Date = RealDate; Date.now = realNow;

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
