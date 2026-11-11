// ── Nov 2026 review, builder list item 134 (second half): "Connected" means the domain
//    shows OUR site, and both names are checked before we say both work ──
//   deno run --allow-read --allow-env tests/presence/domain_truth_test.mjs
// Findings 3 and 5 (domains file): uptime called any normal answer "Connected", so a
// parking page, an old host or a caching proxy read as healthy; and the client sheet
// said "both names work" without checking the second one. The rules first, then the
// live checks and the daily watch against stubbed DNS, Netlify, pages and database.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';
const { classifyServing, twinName, domainChecklist, checklistOk, domainTruth } = await import(`${P}/lib/domain_health.ts`);
const { buildDomains } = await import(`${P}/agency/sites.ts`);
const { buildNeedsYou } = await import(`${P}/agency/needs_you.ts`);
const { NETLIFY_APEX_IP } = await import(`${P}/platform/dns.ts`);

// ═══ what the domain shows ═══
const O = { ok: true, hash: 'aaa' };
ok('the same page as our own address is the latest site', classifyServing({ ok: true, server: 'Netlify', hash: 'aaa' }, O) === 'latest');
ok('Netlify answering with a different page is an old copy (another project or a cache)', classifyServing({ ok: true, server: 'Netlify', hash: 'bbb' }, O) === 'old_copy');
ok('anyone else answering is something else (parking page, old host, proxy)', classifyServing({ ok: true, server: 'nginx', hash: 'bbb' }, O) === 'other' && classifyServing({ ok: true, server: 'APISIX', hash: 'bbb' }, O) === 'other');
ok('no answer at the domain is unreachable', classifyServing({ ok: false, server: '', hash: null }, O) === 'unreachable');
ok('if our own address didn’t answer, nothing is claimed', classifyServing({ ok: true, server: 'Netlify', hash: 'aaa' }, { ok: false, hash: null }) === null);

// ═══ the pair of names ═══
ok('www. has the bare name as its twin', twinName('www.bistro.example') === 'bistro.example');
ok('a plain two-part name has www. as its twin', twinName('bistro.example') === 'www.bistro.example');
ok('a sub-name has no twin, known or not', twinName('shop.bistro.example') === null && twinName('shop.bistro.example', 'bistro.example') === null);
ok('a registered three-part name gets its www. twin', twinName('bistro.co.uk', 'bistro.co.uk') === 'www.bistro.co.uk' && twinName('bistro.co.uk') === null);

// ═══ the checklist ═══
const names = (a, b) => [{ name: 'bistro.example', points: true, leftovers: [] }, ...(b ? [b] : [])].map((n, i) => i === 0 ? { ...n, ...a } : n);
{
  const all = domainChecklist({ domain: 'bistro.example', names: names({}, { name: 'www.bistro.example', points: true, leftovers: [] }), padlockOn: true, padlockNames: ['bistro.example', 'www.bistro.example'], serving: 'latest' });
  ok('everything right: every line ticked, and the list says so', checklistOk(all) && all.map((l) => l.words).join(' | ') === 'bistro.example points here | www.bistro.example points here | The padlock covers both names | Showing your latest site', all.map((l) => l.words).join(' | '));
  const www = domainChecklist({ domain: 'bistro.example', names: names({}, { name: 'www.bistro.example', points: false, leftovers: [] }), padlockOn: true, padlockNames: ['bistro.example'], serving: 'latest' });
  ok('the second name not set up is its own line, and the list isn’t all right', !checklistOk(www) && www.some((l) => l.words === 'www.bistro.example doesn’t point here yet' && !l.ok));
  const left = domainChecklist({ domain: 'bistro.example', names: names({ leftovers: ['1.2.3.4'] }), padlockOn: true, padlockNames: [], serving: 'latest' });
  ok('an old record beside ours says which to delete', left.some((l) => l.words === 'An old record is still on bistro.example: delete 1.2.3.4 at the provider' && !l.ok));
  const pad = domainChecklist({ domain: 'bistro.example', names: names({}, { name: 'www.bistro.example', points: true, leftovers: [] }), padlockOn: true, padlockNames: ['bistro.example'], serving: 'latest' });
  ok('a padlock that misses a name that points here says so', pad.some((l) => l.key === 'padlock' && !l.ok && /doesn’t cover www\.bistro\.example/.test(l.words)));
  const old = domainChecklist({ domain: 'bistro.example', names: names({}), padlockOn: true, padlockNames: [], serving: 'old_copy' });
  ok('an old copy is a failing line in plain words', old.some((l) => l.key === 'serving' && !l.ok && /old copy/.test(l.words)));
  ok('no padlock yet is a failing line', domainChecklist({ domain: 'a.example', names: names({}), padlockOn: false, padlockNames: [], serving: null }).some((l) => l.key === 'padlock' && !l.ok));
}

// ═══ the Domains page and Home ═══
const NOW = '2026-11-11T12:00:00.000Z';
{
  const base = { site_id: 's1', name: 'Bistro', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'bistro.example', uptime_ok: true, domain_expires_at: '2027-06-01T00:00:00Z' };
  const one = (over) => buildDomains([{ ...base, ...over }], NOW).domains[0];
  ok('"Connected" when it shows our latest site', one({ domain_serving: 'latest', domain_checks: [{ key: 'serving', ok: true, words: 'Showing your latest site' }] }).status === 'connected');
  ok('"Showing an old copy" even when uptime says it answers', one({ domain_serving: 'old_copy' }).status_words === 'Showing an old copy' && one({ domain_serving: 'old_copy' }).tone === 'bad');
  ok('"Showing something else" for a parking page or old host', one({ domain_serving: 'other' }).status_words === 'Showing something else');
  ok('"Not fully set up" when a name or the padlock still needs doing', one({ domain_serving: 'latest', domain_checks: [{ key: 'points:www.bistro.example', ok: false, words: 'www.bistro.example doesn’t point here yet' }] }).status_words === 'Not fully set up');
  ok('the lines travel for the row', one({ domain_checks: [{ key: 'x', ok: false, words: 'W' }] }).checks.length === 1);
  ok('not checked yet, uptime still decides (no false alarm before the first daily check)', one({}).status === 'connected');
  ok('a site on its own host is never judged by our page', one({ edition: 'monitor', domain_serving: 'other' }).status === 'elsewhere');
  const rank = buildDomains([{ ...base, site_id: 'a', custom_domain: 'a.example', domain_serving: 'latest' }, { ...base, site_id: 'b', custom_domain: 'b.example', domain_serving: 'old_copy' }], NOW).domains.map((d) => d.domain);
  ok('an old copy sorts above a healthy domain', rank[0] === 'b.example');
}
{
  const input = (site) => ({ nowIso: NOW, links: [{ site_id: 's1', status: 'active' }], clientNames: { s1: 'Bistro' }, sites: [{ id: 's1', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'bistro.example', ...site }] });
  const row = (rows) => rows.find((r) => r.key === 'broken:serving:s1');
  ok('Home asks when the domain shows an old copy', /showing an old copy/.test(row(buildNeedsYou(input({ domain_serving: 'old_copy' })))?.what || ''));
  ok('…or something else', /something else/.test(row(buildNeedsYou(input({ domain_serving: 'other' })))?.what || ''));
  ok('…and not when it shows the site, or for a site on its own host', !row(buildNeedsYou(input({ domain_serving: 'latest' }))) && !row(buildNeedsYou(input({ domain_serving: 'other', edition: 'monitor' }))));
}

// ═══ the wiring ═══
{
  const mig = read('supabase/migrations/0153_domain_shows_our_site.sql'), pack = read('docs/presence/APPLY-0153-prod.sql');
  const cols = ['domain_serving', 'domain_checks', 'domain_serving_checked_at', 'domain_registered_name'];
  ok('the migration and its production pack add the same four columns and check', cols.every((c) => mig.includes(`add column if not exists ${c}`) && pack.includes(`add column if not exists ${c}`)) && [mig, pack].every((x) => /domain_serving in \('latest','old_copy','other','unreachable'\)/.test(x)));
  const page = read('presence.html');
  ok('the client’s sheet no longer claims both names work without checking', !/either way works/.test(page) && /dstat\.all_ok === true/.test(page) && /lines\.forEach\(\(c\) => \{ const l = stepLine/.test(page));
  ok('the Search tab card follows the same rule', /const left = Array\.isArray\(d\.checklist\)/.test(page));
  const admin = read('supabase/functions/presence/routes/admin.ts');
  ok('the sheet’s check carries the checklist', /checklist: truth\.checklist, all_ok: truth\.all_ok/.test(admin));
  ok('Home and the Domains page read what the domain shows', /cert_pending_since,domain_serving&limit=1000/.test(read('supabase/functions/presence/agency/routes.ts')) && /domain_serving,domain_checks`/.test(read('supabase/functions/presence/agency/sites.ts')));
}

// ═══ the live checks, against stubs ═══
let w;
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
function world(over = {}) {
  w = { dns: { 'bistro.example': { CNAME: [], A: [NETLIFY_APEX_IP] }, 'www.bistro.example': { CNAME: ['bistro.netlify.app'], A: [] } },
    ssl: { state: 'issued', domains: ['bistro.example', 'www.bistro.example'], expires_at: '2027-02-01T00:00:00Z' },
    pages: { 'bistro.netlify.app': { body: '<h1>Bistro v2</h1>', server: 'Netlify' }, 'bistro.example': { body: '<h1>Bistro v2</h1>', server: 'Netlify' } },
    site: { domain: 'bistro.example', registered: null }, patches: [], ...over };
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'dns.google') { const n = u.searchParams.get('name'), t = u.searchParams.get('type'); return reply({ Answer: ((w.dns[n] || {})[t] || []).map((d) => ({ data: d + '.' })) }); }
  if (u.hostname === 'api.netlify.com') { if (u.pathname.endsWith('/ssl')) return method === 'POST' ? reply({}) : reply(w.ssl); return reply({ id: 'nf1', name: 'bistro', default_domain: 'bistro.netlify.app', url: 'https://bistro.netlify.app' }); }
  if (u.hostname === 'rdap.org') return reply({ events: [{ eventAction: 'expiration', eventDate: '2027-06-01T00:00:00Z' }], entities: [] });
  if (w.pages[u.hostname]) { const p = w.pages[u.hostname]; if (p.fail) throw new Error('down'); return reply(p.body, 200, { Server: p.server }); }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (table === 'presence_sites' && method === 'PATCH') { w.patches.push(JSON.parse(init.body)); return reply([]); }
  if (table === 'presence_sites' && q.includes('custom_domain=not.is.null')) return reply([{ id: 'site1', client_id: 'c1', custom_domain: w.site.domain, netlify_site_id: 'nf1', edition: 'presence', cert_pending_since: null }]);
  return reply([]);
};
const quiet = async (fn) => { const e = console.error, x = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = x; } };
const site = { custom_domain: 'bistro.example', netlify_site_id: 'nf1' };

world();
{
  const t = await quiet(() => domainTruth(site));
  ok('both names right, the padlock on both, and the same page: all good, latest', t.all_ok && t.serving === 'latest', JSON.stringify(t.checklist.map((l) => l.words)));
}
world(); w.pages['bistro.example'] = { body: '<h1>Bistro v1</h1>', server: 'Netlify' };
ok('Netlify serving an older page is an old copy', (await quiet(() => domainTruth(site))).serving === 'old_copy');
world(); w.pages['bistro.example'] = { body: '<h1>This domain is parked</h1>', server: 'APISIX' };
{ const t = await quiet(() => domainTruth(site)); ok('a parking page is something else, and not all good', t.serving === 'other' && !t.all_ok); }
world(); w.dns['www.bistro.example'] = { CNAME: [], A: [] };
{ const t = await quiet(() => domainTruth(site)); ok('www. not set up: its line fails', t.checklist.some((l) => l.words === 'www.bistro.example doesn’t point here yet') && !t.all_ok); }
world(); w.dns['bistro.example'] = { CNAME: [], A: [NETLIFY_APEX_IP, '1.2.3.4'] };
{ const t = await quiet(() => domainTruth(site)); ok('an old address beside ours is named', t.checklist.some((l) => /delete 1\.2\.3\.4/.test(l.words))); }
world(); w.ssl = { state: 'issued', domains: ['bistro.example'] };
{ const t = await quiet(() => domainTruth(site)); ok('a padlock without www. is named', t.checklist.some((l) => /doesn’t cover www\.bistro\.example/.test(l.words))); }
world(); w.pages['bistro.netlify.app'] = { fail: true };
ok('our own address down: no claim about what the domain shows', (await quiet(() => domainTruth(site))).serving === null);

// the daily watch writes it all down
const { runDomainWatch } = await import(`${P}/commerce/lifecycle.ts`);
world(); w.pages['bistro.example'] = { body: '<h1>Bistro v1</h1>', server: 'Netlify' };
await quiet(() => runDomainWatch(10));
{
  const p = w.patches[0] || {};
  ok('the watch records what the domain shows, the checklist and the registered name', p.domain_serving === 'old_copy' && Array.isArray(p.domain_checks) && p.domain_checks.length >= 4 && p.domain_registered_name === 'bistro.example' && typeof p.domain_serving_checked_at === 'string', JSON.stringify(Object.keys(p)));
}

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
