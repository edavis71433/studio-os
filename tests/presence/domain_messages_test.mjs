// ── Nov 2026 review, builder list item 164: clearer domain messages ──
//   deno run --allow-read --allow-env tests/presence/domain_messages_test.mjs
// Findings 13, 16, 17 and 18 (domains file): no message when the domain went live, a
// waiting screen with no sense of time and a wrong promise ("usually within an hour"),
// "I need to get one" was three lines and a goodbye, and the hosting company's words
// ("netlify.app address", "Detail (operator)") reached clients. The rules first, then the
// routes and the daily check against stubs. No outside call leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';
const { domainChangeEmail, announceLiveOnce } = await import(`${P}/lib/domain_notify.ts`);
const { handleDomain } = await import(`${P}/routes/admin.ts`);
const { checkOneDomain } = await import(`${P}/commerce/lifecycle.ts`);
const NOW = '2026-11-11T12:00:00.000Z';

// ═══ the live email's words ═══
{
  const a = domainChangeEmail('live', { domain: 'bistro.example' });
  ok('live: the address, the padlock, and both names that reach it', a.subject === 'Your website is live at bistro.example' && /href="https:\/\/bistro\.example"/.test(a.html) && /padlock on/.test(a.html) && /Visitors who type bistro\.example or www\.bistro\.example end up there/.test(a.html));
  ok('live: a www. main name names the same pair', /Visitors who type bistro\.example or www\.bistro\.example/.test(domainChangeEmail('live', { domain: 'www.bistro.example' }).html));
  ok('live: a sub-name has no www. twin to promise', !/Visitors who type/.test(domainChangeEmail('live', { domain: 'shop.bistro.example' }).html));
  ok('live: never the hosting company’s name', !/netlify/i.test(a.subject + a.html));
}

// ═══ against stubs ═══
let w;
function world(over = {}) {
  w = { mails: [], live: null, liveWrites: [], netlifyFail: false, ssl: 'issued', pages: { 'bistro.example': '<h1>v2</h1>', 'presence-abc.netlify.app': '<h1>v2</h1>' }, a: ['75.2.60.5'], ...over };
}
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
const TYPE = { A: 1, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };
const { NETLIFY_APEX_IP } = await import(`${P}/platform/dns.ts`);
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); w.mails.push({ to: Array.isArray(b.to) ? b.to.join(',') : String(b.to), subject: b.subject, html: b.html }); return reply({ id: 'em' }); }
  if (u.hostname === 'dns.google') {
    const n = u.searchParams.get('name'), t = u.searchParams.get('type');
    const v = t === 'A' && (n === 'bistro.example') ? [NETLIFY_APEX_IP] : t === 'CNAME' && n === 'www.bistro.example' ? ['presence-abc.netlify.app'] : [];
    return reply({ Status: 0, Answer: v.map((d) => ({ name: n + '.', type: TYPE[t], data: d + '.' })) });
  }
  if (u.hostname === 'api.netlify.com') {
    if (u.pathname.endsWith('/ssl')) return method === 'POST' ? reply({}) : reply({ state: w.ssl, domains: ['bistro.example', 'www.bistro.example'], expires_at: '2027-02-01T00:00:00Z' });
    if (method === 'PATCH') return w.netlifyFail ? reply({ message: 'Domain already in use by another Netlify site' }, 422) : reply({ id: 'nf1', name: 'bistro', default_domain: 'presence-abc.netlify.app', custom_domain: null, domain_aliases: [] });
    return reply({ id: 'nf1', name: 'bistro', default_domain: 'presence-abc.netlify.app', custom_domain: 'bistro.example', domain_aliases: [] });
  }
  if (u.hostname === 'rdap.org') return reply({}, 404);
  if (w.pages[u.hostname]) return reply(w.pages[u.hostname], 200, { Server: 'Netlify' });
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (table === 'presence_sales_templates' && q.includes('__domain_live__')) {
    if (method === 'GET') return reply(w.live ? [{ id: 'lv1', body: JSON.stringify(w.live), updated_at: '2026-11-01T00:00:00Z' }] : []);
    const b = JSON.parse(init.body); const next = JSON.parse(b.body); w.liveWrites.push(next);
    if (method === 'PATCH') { if (!w.live) return reply([]); w.live = next; return reply([{ id: 'lv1' }]); }
    w.live = next; return reply([{ id: 'lv1', ...b }], 201);
  }
  // the compare-and-swap update names the row by its id (lib/reserved_store.ts updateReservedJson)
  if (table === 'presence_sales_templates' && method === 'PATCH' && q.includes('id=eq.lv1')) { const next = JSON.parse(JSON.parse(init.body).body); w.liveWrites.push(next); w.live = next; return reply([{ id: 'lv1' }]); }
  if (table === 'presence_sales_templates' && method === 'POST' && !q.includes('__domain_live__')) {
    const b = JSON.parse(init.body); if (b.name === '__domain_live__') { const next = JSON.parse(b.body); w.liveWrites.push(next); w.live = next; return reply([{ id: 'lv1', ...b }], 201); }
    return reply([{ id: 'x' }], 201);
  }
  if (table === 'clients') return reply([{ email: 'owner@bistro.example' }]);
  if (table === 'presence_service_links') return reply([{ agency_site_id: 'studio1' }]);
  if (table === 'presence_identity') return reply([{ business_name: 'Bright Studio', email: 'eric@studio.example' }]);
  return reply([]);
};
const quiet = async (fn) => { const e = console.error, x = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = x; } };
const jsonOf = async (res) => ({ status: res.status, body: await res.json() });
const SITE = (custom) => ({ id: 'site1', client_id: 'c1', status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', custom_domain: custom, netlify_site_id: 'nf1', edition: 'presence' });
const req = (method, body) => new Request('http://stub.local/functions/v1/presence/foundations/domain', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
// builder item 191: removing a domain asks for a fresh code; these people signed in with their
// authenticator app's code a moment ago, so it counts (lib/fresh_code.ts)
const { freshDeps } = await import(`${P}/lib/fresh_code.ts`);
freshDeps.user = async (jwt) => ({ id: jwt === 'jwt-studio' ? 'u2' : 'u1', email: 'owner@bistro.example', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });
freshDeps.claims = () => ({ aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] });
const OWNER = { kind: 'client', userId: 'u1', email: 'owner@bistro.example', jwt: 'jwt-owner' };

world();
ok('live, the first time: the owner and the studio are told, and it is remembered', await quiet(() => announceLiveOnce({ id: 'site1', client_id: 'c1' }, 'bistro.example', NOW)) === true && w.mails.length === 2 && w.mails.every((m) => m.subject === 'Your website is live at bistro.example') && w.live && w.live.domain === 'bistro.example', JSON.stringify(w.mails.map((m) => m.to)));
w.mails = []; w.liveWrites = [];
ok('…the second time: nothing sent, nothing written', await quiet(() => announceLiveOnce({ id: 'site1', client_id: 'c1' }, 'bistro.example', NOW)) === false && w.mails.length === 0 && w.liveWrites.length === 0);
ok('…a new domain goes live: told again', await quiet(() => announceLiveOnce({ id: 'site1', client_id: 'c1' }, 'new.example', NOW)) === true && w.mails.some((m) => m.subject === 'Your website is live at new.example'));

world();
{
  const r = await quiet(async () => jsonOf(await handleDomain(req('GET'), 'GET', SITE('bistro.example'), OWNER, {})));
  ok('the sheet, every check passing: "your website is live" goes out once', r.status === 200 && r.body.data.all_ok === true && w.mails.filter((m) => m.subject === 'Your website is live at bistro.example').length === 2, JSON.stringify({ all_ok: r.body.data.all_ok, mails: w.mails.map((m) => m.subject) }));
  w.mails = [];
  await quiet(async () => handleDomain(req('GET'), 'GET', SITE('bistro.example'), OWNER, {}));
  ok('…opening it again sends nothing', w.mails.length === 0);
}
world({ ssl: 'pending' });
{
  await quiet(async () => handleDomain(req('GET'), 'GET', SITE('bistro.example'), OWNER, {}));
  ok('the sheet, padlock not on yet: no live email', w.mails.length === 0 && w.live === null);
}
world();
{
  await quiet(() => checkOneDomain({ id: 'site1', client_id: 'c1', custom_domain: 'bistro.example', netlify_site_id: 'nf1', edition: 'presence', cert_pending_since: null }, NOW));
  ok('the daily check, every check passing: the same once-only email', w.mails.filter((m) => m.subject === 'Your website is live at bistro.example').length === 2);
}
world({ netlifyFail: true });
{
  const r = await quiet(async () => jsonOf(await handleDomain(req('POST', { domain: 'bistro.example' }), 'POST', SITE(null), OWNER, {})));
  ok('a refused attach is said plainly, the hosting company’s words kept for the log', r.status === 502 && r.body.message === 'That domain couldn’t be connected. It may still be connected to a website somewhere else: remove it there first, or ask your studio.' && !/operator|Netlify|provider/i.test(r.body.message));
  const d = await quiet(async () => jsonOf(await handleDomain(req('DELETE', { confirm: 'bistro.example' }), 'DELETE', SITE('bistro.example'), OWNER, {})));
  ok('a failed removal too', d.status === 502 && d.body.message === 'The domain couldn’t be removed just now. Try again in a minute.');
}
world();
{
  const d = await quiet(async () => jsonOf(await handleDomain(req('DELETE', { confirm: 'bistro.example' }), 'DELETE', SITE('bistro.example'), OWNER, {})));
  ok('a removal says the site is still online at its built-in address', d.status === 200 && d.body.data.message === 'Domain removed. Your site is still online at its built-in address.');
}

// ═══ the wiring ═══
{
  const page = read('presence.html');
  ok('the waiting card shows its steps with times and the honest wait', /function waitSteps\(dstat, dom\)/.test(page) && /domCard\.appendChild\(waitSteps\(dstat, dom\)\)/.test(page) && /const DOMAIN_WAIT = "Usually within an hour of adding the records, sometimes a day or two\."/.test(page) && /stepLine\(String\(dstat\.wait \|\| DOMAIN_WAIT\)\)/.test(page));   // builder item 194: one wait, said one way
  ok('the waiting steps make their own lines (renderFoundations’ stepLine is local to it; without this the whole sheet failed to draw)', /function waitSteps\(dstat, dom\) \{\n[^\n]*\n  const stepLine = /.test(page));
  ok('the main name is said plainly', /"Visitors who type " \+ bareName \+ " or www\." \+ bareName \+ " end up on "/.test(page));
  ok('"I need to get one" checks a name and opens three companies with it filled in', /needPanel\.dataset\.need = "domain"/.test(page) && /registration\/results\/\?domain=/.test(page) && /porkbun\.com\/checkout\/search\?q=/.test(page) && /domainsearch\/find\?domainToCheck=/.test(page) && /Buy it in your own name and email, and turn on auto-renew/.test(page));
  const sheet = page.slice(page.indexOf('function renderFoundations('), page.indexOf('// ── M11: Presence Monitor'));
  ok('the sheet no longer promises an hour, guesses companies or says "temporary"', !/usually within an hour/.test(sheet) && !/wherever you bought it/.test(sheet) && !/temporary address/.test(sheet) && !/DNS is set/.test(sheet));
  ok('nowhere on the page is the site "on a temporary address"', !/temporary address/.test(page));
  const admin = read('supabase/functions/presence/routes/admin.ts');
  const dom = admin.slice(admin.indexOf('export async function handleDomain('), admin.indexOf('// ═══ 4. LIFECYCLE'));
  ok('the domain routes never show the hosting company’s words to the client', !/Detail \(operator\)/.test(dom) && !/netlify\.app address/.test(dom));
  ok('the reserved name for the live email is listed', /domainLive: '__domain_live__'/.test(read('supabase/functions/presence/lib/reserved_store.ts')));
}

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
