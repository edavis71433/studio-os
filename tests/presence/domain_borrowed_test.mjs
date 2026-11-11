// ── Nov 2026 review, builder list item 174: domains, borrowed from Namecheap and Squarespace ──
//   deno run --allow-read --allow-env tests/presence/domain_borrowed_test.mjs
// Auto-renew in every row (as the studio noted it), one pick that fills every record for
// Gmail, a plain form for another domain that sends its visitors here, and "Use www" with
// the main name said. The rules first, then the routes against stubbed hosting, DNS,
// database and email. No outside call leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';
const { forwardsOf, domainChangeEmail, withForwarding } = await import(`${P}/lib/domain_notify.ts`);
const { handleDomain, handleDomainForward } = await import(`${P}/routes/admin.ts`);
const { buildDomains } = await import(`${P}/agency/sites.ts`);

// ═══ the rules ═══
ok('the forwarding names leave out the main name and its www. twin, once each, in order', forwardsOf(['www.bistro.example', 'OLD.example', 'bistro.example', 'old.example', 'www.old.example', ''], 'bistro.example').join() === 'old.example,www.old.example');
ok('…the same for a www. main name', forwardsOf(['bistro.example', 'old.example'], 'www.bistro.example').join() === 'old.example');
ok('…and nothing without a main name to send to, beyond the names themselves', forwardsOf([], 'bistro.example').length === 0);
{
  const m = domainChangeEmail('main', { domain: 'www.bistro.example', old: 'bistro.example', by: 'your studio' });
  ok('the www. switch: the main address now, and the other still works', m.subject === 'Your website’s main address is now www.bistro.example' && /bistro\.example<\/strong> still works: it sends visitors there/.test(m.html));
  const a = domainChangeEmail('forward_added', { domain: 'old.example', old: 'bistro.example', by: 'your studio' });
  ok('a forward added: what, to where, and when it starts', a.subject === 'old.example now sends visitors to your website' && /From the next publish it sends its visitors to bistro\.example, to the same page, once its two records point at your website too/.test(a.html));
  const s = domainChangeEmail('forward_stopped', { domain: 'old.example', old: 'bistro.example', by: 'owner@bistro.example' });
  ok('a forward stopped', s.subject === 'old.example no longer sends visitors to your website' && /by owner@bistro\.example/.test(s.html));
  ok('no hosting company’s name in any of them', [m, a, s].every((x) => !/netlify/i.test(x.subject + x.html)));
}
ok('the forwards publish as rules on top, like a kept old name', withForwarding('', forwardsOf(['old.example'], 'bistro.example'), 'bistro.example').includes('https://old.example/* https://bistro.example/:splat 301!'));
{
  const base = { site_id: 's1', name: 'Bistro', edition: 'presence', status: 'live', custom_domain: 'bistro.example', uptime_ok: true, domain_expires_at: '2027-06-01T00:00:00Z' };
  const one = (over) => buildDomains([{ ...base, ...over }], '2026-11-11T12:00:00Z').domains[0];
  ok('each row says whether it renews by itself, as the studio noted it', one({ domain_renews: 'yes', domain_renews_confirmed_at: '2026-11-11' }).renews === 'yes' && one({ domain_renews: 'yes', domain_renews_confirmed_at: '2026-11-11' }).renews_confirmed_at === '2026-11-11');
  ok('…and "don’t know" until someone says', one({}).renews === 'unknown' && one({ domain_renews: 'maybe' }).renews === 'unknown' && one({}).renews_confirmed_at === null);
}

// ═══ the routes, against stubs ═══
let w;
function world(over = {}) { w = { netlify: [], aliases: [], getFails: false, others: [], events: [], mails: [], ...over }; }
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const siteJson = (custom) => ({ id: 'nf1', name: 'bistro', default_domain: 'presence-abc.netlify.app', custom_domain: custom, domain_aliases: w.aliases, state: 'current', ssl_url: null });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); w.mails.push({ to: Array.isArray(b.to) ? b.to.join(',') : String(b.to), subject: b.subject, html: b.html }); return reply({ id: 'em' }); }
  if (u.hostname === 'dns.google') return reply({ Status: 0, Answer: [] });
  if (u.hostname === 'api.netlify.com') {
    if (u.pathname.endsWith('/ssl')) return method === 'POST' ? reply({}) : reply({ state: 'issued', domains: [], expires_at: null });
    if (method === 'PATCH') { const b = JSON.parse(init.body); w.netlify.push(b); if ('domain_aliases' in b) w.aliases = b.domain_aliases; return reply(siteJson('custom_domain' in b ? b.custom_domain : 'bistro.example')); }
    return w.getFails ? reply({ message: 'boom' }, 500) : reply(siteJson('bistro.example'));
  }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (table === 'presence_sites' && method === 'GET' && q.includes('custom_domain=in.')) return reply(w.others);
  if (table === 'presence_change_events' && method === 'POST') { w.events.push(JSON.parse(init.body)); return reply([]); }
  if (table === 'clients') return reply([{ email: 'owner@bistro.example' }]);
  if (table === 'presence_service_links') return reply([{ agency_site_id: 'studio1' }]);
  if (table === 'presence_identity') return reply([{ business_name: 'Bright Studio', email: 'eric@studio.example' }]);
  return reply([]);
};
const quiet = async (fn) => { const e = console.error, x = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = x; } };
const jsonOf = async (res) => ({ status: res.status, body: await res.json() });
const SITE = (custom) => ({ id: 'site1', client_id: 'c1', status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', custom_domain: custom, netlify_site_id: 'nf1', edition: 'presence' });
const req = (path, method, body) => new Request('http://stub.local/functions/v1/presence' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const STUDIO = { kind: 'client', userId: 'u2', email: 'eric@studio.example', scope: { site_id: 'site1', name: 'Bistro Nine' } };
const fwd = (method, body, site = SITE('bistro.example')) => quiet(async () => jsonOf(await handleDomainForward(req('/foundations/domain/forward', method, body), method, site, STUDIO, {})));

// the www. switch
world({ aliases: ['old.example'] });
{
  const r = await quiet(async () => jsonOf(await handleDomain(req('/foundations/domain', 'POST', { domain: 'www.bistro.example', keep_old: true }), 'POST', SITE('bistro.example'), STUDIO, {})));
  ok('www. switch: the twin becomes the main name, and no extra name is added or lost', r.status === 200 && w.netlify[0].custom_domain === 'www.bistro.example' && w.netlify.length === 1 && w.aliases.join() === 'old.example' && r.body.data.forwarding === null, JSON.stringify(w.netlify));
  ok('www. switch: the history says it plainly', w.events.some((e) => e.summary === 'Made www.bistro.example the main name (bistro.example sends visitors there)'));
  ok('www. switch: the owner reads the switch, not "no longer shows your website"', w.mails.some((m) => m.to === 'owner@bistro.example' && m.subject === 'Your website’s main address is now www.bistro.example') && !w.mails.some((m) => /no longer shows/.test(m.html)));
}
// another domain sends its visitors here
world({ aliases: ['ancient.example'] });
{
  const r = await fwd('POST', { domain: 'https://Old.Example/' });
  ok('forward added: the name and its www. join the extras, the others stay', r.status === 200 && w.aliases.join() === 'ancient.example,old.example,www.old.example' && r.body.data.forwards.join() === 'ancient.example,old.example,www.old.example', JSON.stringify([w.aliases, r.body]));
  ok('forward added: in the history, and the owner and the studio are told', w.events.some((e) => e.summary === 'Added old.example, which forwards to bistro.example') && w.mails.filter((m) => m.subject === 'old.example now sends visitors to your website').length === 2);
}
world();
ok('a forward of the main name itself is refused', (await fwd('POST', { domain: 'www.bistro.example' })).body.error === 'is_main' && w.netlify.length === 0);
world();
ok('half a name is refused', (await fwd('POST', { domain: 'old' })).status === 400);
world({ others: [{ id: 'site9', custom_domain: 'old.example' }] });
ok('the main name of another site here is refused, nothing written', (await fwd('POST', { domain: 'old.example' })).body.error === 'taken_here' && w.netlify.length === 0);
world({ getFails: true, aliases: ['keep.example'] });
{
  const r = await fwd('POST', { domain: 'old.example' });
  ok('the site’s names can’t be read: nothing written, so the forwards already there survive', r.status === 502 && r.body.error === 'read_failed' && w.netlify.length === 0);
}
world();
ok('no main domain yet: forwarding waits for it', (await fwd('POST', { domain: 'old.example' }, SITE(null))).body.error === 'no_domain');
// stopping one
world({ aliases: ['ancient.example', 'old.example', 'www.old.example'] });
{
  const r = await fwd('DELETE', { domain: 'old.example' });
  ok('forward stopped: the name and its www. leave, the others stay', r.status === 200 && w.aliases.join() === 'ancient.example' && r.body.data.forwards.join() === 'ancient.example');
  ok('forward stopped: in the history, and told', w.events.some((e) => e.summary === 'Stopped old.example forwarding to bistro.example') && w.mails.some((m) => m.subject === 'old.example no longer sends visitors to your website'));
}
world({ aliases: ['ancient.example'] });
ok('stopping one that isn’t forwarding says so, nothing written', (await fwd('DELETE', { domain: 'old.example' })).status === 404 && w.netlify.length === 0);

// ═══ the wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('the forward route is wired before the domain route', idx.indexOf("route === '/foundations/domain/forward'") > 0 && idx.indexOf("route === '/foundations/domain/forward'") < idx.indexOf("route === '/foundations/domain' &&"));
  ok('a forward is a domain setting for the role gate', /'\(POST\|DELETE\) \/foundations\/domain\/forward'/.test(read('supabase/functions/presence/lib/site_roles.ts')));
  const sites = read('supabase/functions/presence/agency/sites.ts');
  ok('the list reads every domain’s notes in one go, and the notes save merges what it’s sent', /name=eq\.\$\{encodeURIComponent\(RESERVED_NAMES\.domainNotes\)\}/.test(sites) && /updateReservedJson\(siteId, RESERVED_NAMES\.domainNotes, \(cur\) => \(\{ \.\.\.normalizeDomainNotes\(\{ \.\.\.normalizeDomainNotes\(cur\), \.\.\.sent \}\)/.test(sites));
  const dp = read('domains.html');
  ok('each row has its renews-by-itself switch, saved straight to the notes', /function renewsSwitch\(d\)/.test(dp) && /\$\{renewsSwitch\(d\)\}/.test(dp) && /apiSend\('PUT','\/agency\/domains\/'\+encodeURIComponent\(id\)\+'\/notes',\{renews:v,/.test(dp));
  ok('the panel offers Gmail’s records, and says which other domains send visitors here', /\['email_setup','Gmail on this domain'\]/.test(dp) && /'Also sends visitors here'/.test(dp));
  const page = read('presence.html');
  ok('the sheet names the main name and can switch it to www.', /pm\.dataset\.main = "name"/.test(page) && /api\("POST", "\/foundations\/domain", \{ domain: twin \}\)/.test(page));
  ok('the forwarding block makes its own lines (renderFoundations’ stepLine is local to it)', /function forwardsBlock\(dstat\) \{\n[^\n]*\n  const stepLine = /.test(page));
  ok('the sheet has the plain forwarding form', /function forwardsBlock\(dstat\)/.test(page) && /api\("POST", "\/foundations\/domain\/forward", \{ domain: d \}\)/.test(page) && /api\("DELETE", "\/foundations\/domain\/forward", \{ domain: n \}\)/.test(page));
  ok('the email card fills every Gmail record in one pick', /api\("POST", "\/foundations\/prepare", \{ goal: "email_setup", provider: "google_workspace" \}\)/.test(page));
}

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
