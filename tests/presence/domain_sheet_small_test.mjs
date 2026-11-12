// ── Nov 12 2026 review, builder list item 194: the Domain sheet, smaller ──
//   deno run --allow-read --allow-env --allow-net tests/presence/domain_sheet_small_test.mjs
// Findings 18 to 26 of the code pass:
//   18. developer words, a second weaker checklist, and a date written 2027-02-12
//   19. a domain on a sub-name got steps that could never pass
//   20. a forwarded domain was shown as working the moment it was added
//   21. the time promises disagreed, and "nothing for you to do" could be wrong
//   22. the client was told a domain was connected, not what to do
//   23. email records were shown with full names
//   24. the Domains page said "Connected" on a plain "something answered"
//   25. opening the sheet was slow and saved a row every time
//   26. the domain box had no name, and every Copy button was just "Copy"
// The rules first, then the routes against stubbed DNS, hosting, database and email.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';
const { NETLIFY_APEX_IP } = await import(`${P}/platform/dns.ts`);
const { connectRecords, guessRegistered, DOMAIN_WAIT } = await import(`${P}/lib/domain_health.ts`);
const { domainChangeEmail, nextStepsHtml } = await import(`${P}/lib/domain_notify.ts`);
const { handleDomain, handleClientDomain, clientDomainCard } = await import(`${P}/routes/admin.ts`);
const { handleFoundationsGet, plainDate } = await import(`${P}/routes/foundations.ts`);
const { buildLaunchChecklist } = await import(`${P}/platform/launch.ts`);
const { planConnectDomain } = await import(`${P}/platform/plans.ts`);
const { buildDomains } = await import(`${P}/agency/sites.ts`);

const T = 'presence-abc.netlify.app';

// ═══ 19. a sub-name gets its own one-record step ═══
{
  const pair = connectRecords('bistro.example', 'bistro.example', T);
  ok('a registered name gets the usual two, written as the form wants them', pair.kind === 'pair' && pair.records.map((r) => `${r.type} ${r.host} ${r.value}`).join(' | ') === `A @ ${NETLIFY_APEX_IP} | CNAME www ${T}`);
  ok('…the same when www. is the main name', connectRecords('www.bistro.example', 'bistro.example', T).records.map((r) => r.name).join() === 'bistro.example,www.bistro.example');
  const sub = connectRecords('shop.bistro.example', 'bistro.example', T);
  ok('a sub-name gets ONE record, for itself, never "@" and "www"', sub.kind === 'sub' && sub.records.length === 1 && sub.records[0].type === 'CNAME' && sub.records[0].host === 'shop' && sub.records[0].name === 'shop.bistro.example' && sub.records[0].value === T, JSON.stringify(sub));
  ok('a deeper sub-name keeps every part of its own name', connectRecords('a.shop.bistro.example', 'bistro.example', T).records[0].host === 'a.shop');
  ok('before the lookup has said, a three-part name is a sub-name', connectRecords('shop.bistro.example', null, T).kind === 'sub');
  ok('…unless its ending is two parts itself', guessRegistered('bistro.co.uk') === 'bistro.co.uk' && connectRecords('bistro.co.uk', null, T).kind === 'pair' && connectRecords('shop.bistro.co.uk', null, T).records[0].host === 'shop');
  ok('the lookup’s answer wins over the guess', connectRecords('bistro.example.zz', 'bistro.example.zz', T).kind === 'pair');
}

// ═══ 18. plain words, dates as dates ═══
ok('a date is written as a date', plainDate('2027-02-12T00:00:00Z') === 'February 12, 2027' && plainDate(null) === '' && plainDate('nonsense') === '');
{
  const base = { edition: 'presence', domain: 'bistro.example', apex_resolves: true, https_ok: true, published: true, monitor_verified: false, sitemap_present: true, gbp_connected: true, analytics_connected: true, email_has_mx: true, email_authenticated: true, accessibility_criticals: 0, review_done: true };
  const words = [buildLaunchChecklist(base), buildLaunchChecklist({ ...base, domain: null, apex_resolves: null, https_ok: null, email_authenticated: false })].flatMap((l) => l.items.map((i) => i.how)).join(' ');
  ok('the launch list’s words are plain', !/resolves|drift|HTTPS|\bDNS\b|SPF|DMARC|provision|connect-domain plan/.test(words), words);
  const plan = planConnectDomain('bistro.example', T);
  const pw = [plan.title, plan.summary, ...plan.steps.flatMap((s) => [s.what, s.why])].join(' ');
  ok('the connect steps’ words are plain', !/\bDNS\b|HTTPS|provisions|The platform|a few hours/.test(pw) && /Email, and everything else on the domain, is untouched/.test(plan.summary), pw);
  ok('…and carry the one wait', plan.summary.includes(DOMAIN_WAIT));
}

// ═══ 22. the email says what to do ═══
{
  const recs = connectRecords('bistro.example', 'bistro.example', T).records;
  const a = domainChangeEmail('attached', { domain: 'bistro.example', by: 'your studio', records: recs, recordsAt: 'Cloudflare', signIn: 'https://dash.cloudflare.com/', link: 'https://app.example/presence.html#domain' });
  ok('the "connected" email lists the two records', a.html.includes(`<td>A</td><td>@</td><td>${NETLIFY_APEX_IP}</td>`) && a.html.includes(`<td>CNAME</td><td>www</td><td>${T}</td>`), a.html);
  ok('…names the company that keeps them, with its sign-in page', /these two records are added at Cloudflare\./.test(a.html) && a.html.includes('<a href="https://dash.cloudflare.com/">Sign in to Cloudflare</a>'));
  ok('…links back to check, with the one wait', a.html.includes('<a href="https://app.example/presence.html#domain">Check if it’s ready</a>') && a.html.includes(DOMAIN_WAIT));
  ok('…and says to leave the email records alone', /Leave anything marked MX or Mail alone/.test(a.html));
  const sub = domainChangeEmail('attached', { domain: 'shop.bistro.example', by: 'your studio', records: connectRecords('shop.bistro.example', 'bistro.example', T).records });
  ok('a sub-name’s email has its one record, and no company it doesn’t know', /this record is added where the domain’s settings are kept/.test(sub.html) && sub.html.includes(`<td>CNAME</td><td>shop</td><td>${T}</td>`) && !/<td>@<\/td>/.test(sub.html));
  ok('a sign-in address that isn’t https is never linked', !/href="javascript/.test(nextStepsHtml({ records: recs, recordsAt: 'X', signIn: 'javascript:alert(1)' })));
  const c = domainChangeEmail('changed', { domain: 'new.example', old: 'old.example', forwarded: true, by: 'your studio', records: connectRecords('new.example', null, T).records });
  ok('a change of domain carries the new name’s records too', c.html.includes(`<td>A</td><td>@</td><td>${NETLIFY_APEX_IP}</td>`));
  ok('no hosting company’s name in the words (the site’s own address aside)', !/netlify/i.test(a.html.replaceAll(T, '')));
}

// ═══ 22. the portal's card ═══
{
  const base = { custom_domain: 'bistro.example', provider: { records_at: { company: 'Cloudflare', sign_in: 'https://dash.cloudflare.com/' } }, records: connectRecords('bistro.example', 'bistro.example', T).records };
  const none = clientDomainCard({ ...base, health: 'dns_pending', names: [{ name: 'bistro.example', points: false }, { name: 'www.bistro.example', points: false }] });
  ok('nothing added yet: both records, where, and the wait', none.state === 'records' && none.records.length === 2 && none.where.company === 'Cloudflare' && none.wait === DOMAIN_WAIT, JSON.stringify(none));
  const one = clientDomainCard({ ...base, health: 'ssl_pending', names: [{ name: 'bistro.example', points: true }, { name: 'www.bistro.example', points: false }] });
  ok('one in, one to go: only the record still missing', one.state === 'records' && one.records.length === 1 && one.records[0].host === 'www');
  ok('both in, padlock coming', clientDomainCard({ ...base, health: 'ssl_pending', names: [{ name: 'bistro.example', points: true }, { name: 'www.bistro.example', points: true }] }).state === 'padlock');
  ok('live only when every check passed', clientDomainCard({ ...base, health: 'ok', all_ok: true, checklist: [{ ok: true, words: 'x' }], names: [] }).state === 'live' && clientDomainCard({ ...base, health: 'ok', all_ok: false, checklist: [{ ok: false, words: 'The padlock isn’t on yet' }], names: [] }).left.join() === 'The padlock isn’t on yet');
  ok('no checklist is no claim here either', clientDomainCard({ ...base, health: 'ok', names: [] }).state === 'unchecked');
  ok('no domain, no card', clientDomainCard({ custom_domain: null }).domain === null);
}

// ═══ 24. the Domains list ═══
{
  const row = { site_id: 's1', name: 'Bistro', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'bistro.example', uptime_ok: true, domain_expires_at: '2027-06-01T00:00:00Z' };
  const one = (over) => buildDomains([{ ...row, ...over }], '2026-11-12T12:00:00.000Z').domains[0];
  ok('"something answered" is Not checked yet, not Connected', one({}).status_words === 'Not checked yet' && one({}).tone === 'quiet');
  ok('Connected once the page comparison has run and matched', one({ domain_serving: 'latest' }).status_words === 'Connected');
}

// ═══ the routes, against stubs ═══
let w;
function world(over = {}) { w = { dns: {}, asked: [], siteGets: 0, sslGets: 0, aliases: [], ssl: 'issued', sslExpires: '2027-02-12T00:00:00Z', snapshotsToday: 0, snapshotPosts: 0, mails: [], sitePatches: [], rdap: null, ...over }; }
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
const TYPE = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); w.mails.push({ to: Array.isArray(b.to) ? b.to.join(',') : String(b.to), subject: b.subject, html: b.html }); return reply({ id: 'em' }); }
  if (u.hostname === 'cloudflare-dns.com' || u.hostname === 'dns.google') {
    const n = u.searchParams.get('name'), t = u.searchParams.get('type');
    w.asked.push(`${u.hostname === 'dns.google' ? 'g' : 'c'}:${n}|${t}`);
    return reply({ Status: 0, Answer: ((w.dns[n] || {})[t] || []).map((d) => ({ name: n + '.', type: TYPE[t], data: d })) });
  }
  if (u.hostname === 'api.netlify.com') {
    if (u.pathname.endsWith('/ssl')) { if (method === 'POST') return reply({}); w.sslGets++; return reply({ state: w.ssl, domains: ['bistro.example', 'www.bistro.example'], expires_at: w.sslExpires }); }
    if (method === 'PATCH') { const b = JSON.parse(init.body); return reply({ id: 'nf1', name: 'bistro', default_domain: T, custom_domain: b.custom_domain ?? null, domain_aliases: w.aliases, state: 'current', ssl_url: null }); }
    w.siteGets++;
    return reply({ id: 'nf1', name: 'bistro', default_domain: T, custom_domain: 'bistro.example', domain_aliases: w.aliases, state: 'current', ssl_url: null });
  }
  if (u.hostname === 'rdap.org') return reply({}, 404);
  if (u.hostname !== 'stub.local') return reply('<h1>page</h1>', 200, { Server: 'Netlify' });
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (table === 'presence_zone_snapshots' && method === 'GET') return reply(Array.from({ length: w.snapshotsToday }, (_, i) => ({ id: 'z' + i })));
  if (table === 'presence_zone_snapshots' && method === 'POST') { w.snapshotPosts++; w.snapshotsToday++; return reply([], 201); }
  if (table === 'presence_sites' && method === 'PATCH') { w.sitePatches.push(JSON.parse(init.body)); return reply([]); }
  if (table === 'presence_sites' && method === 'GET' && q.includes('domain_registered_name')) return reply([{ domain_registered_name: w.registered ?? null, domain_registrar: 'Registrar B', domain_dns_host: 'Cloudflare', domain_lookup_status: 'ok' }]);
  if (table === 'clients') return reply([{ email: 'owner@bistro.example' }]);
  if (table === 'presence_service_links') return reply([]);
  return reply([]);
};
const quiet = async (fn) => { const e = console.error, x = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = x; } };
const jsonOf = async (res) => ({ status: res.status, body: await res.json() });
const SITE = (custom) => ({ id: 'site1', client_id: 'c1', status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', custom_domain: custom, netlify_site_id: 'nf1', edition: 'presence' });
const OWNER = { kind: 'client', userId: 'u1', email: 'owner@bistro.example', requestId: 'r1' };
const get = (site) => quiet(async () => jsonOf(await handleDomain(new Request('http://stub.local/functions/v1/presence/foundations/domain'), 'GET', site, OWNER, {})));
const BOTH = { 'bistro.example': { A: [NETLIFY_APEX_IP] }, 'www.bistro.example': { CNAME: [T + '.'], A: [T + '.', '198.51.100.7'] } };

// 25: one open asks each thing once
world({ dns: BOTH, registered: 'bistro.example' });
{
  const r = await get(SITE('bistro.example'));
  const lookups = w.asked.filter((a) => a.startsWith('g:'));
  ok('a live domain: all checks pass', r.body.data.all_ok === true, JSON.stringify(r.body.data.checklist));
  ok('the hosting company is asked for the site once and the padlock once', w.siteGets === 1 && w.sslGets === 1, `site ${w.siteGets}, padlock ${w.sslGets}`);
  ok('each name is looked up once: two questions for each of the two names', lookups.length === 4 && new Set(lookups).size === 4, lookups.join(' '));
  ok('the answer carries both names, the records and the one wait', r.body.data.names.length === 2 && r.body.data.records.length === 2 && r.body.data.wait === DOMAIN_WAIT && r.body.data.shape === 'pair');
}
// 25: one snapshot a day
world({ dns: BOTH });
{
  await quiet(async () => handleFoundationsGet(SITE('bistro.example'), {}));
  await quiet(async () => handleFoundationsGet(SITE('bistro.example'), {}));
  await quiet(async () => handleFoundationsGet(SITE('bistro.example'), {}));
  ok('three opens in a day save one picture of the records', w.snapshotPosts === 1, String(w.snapshotPosts));
}
// 18: the sheet's own sentences
world({ dns: { ...BOTH, 'bistro.example': { A: [NETLIFY_APEX_IP], MX: ['10 mx1.mail.example.'], TXT: ['"v=spf1 include:mail.example ~all"'] } } });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsGet(SITE('bistro.example'), {})));
  const d = r.body.data;
  ok('the padlock sentence writes its date as a date', /renews itself before February 12, 2027/.test(d.ssl.sentence) && !/2027-02-12/.test(d.ssl.sentence), d.ssl.sentence);
  const said = [d.dns.sentence, d.ssl.sentence, d.email.sentence, d.hosting.sentence].join(' ');
  ok('no developer words in the sheet’s sentences', !/CDN|deploys|\bDNS\b|HTTPS|authenticated|certificate|plan you approve/.test(said), said);
  // 23: the card names the missing record
  ok('the email card names the record that is missing', d.email.missing.join() === 'fakes' && /one record is missing: the one that tells inboxes what to do with fakes/.test(d.email.sentence), d.email.sentence);
}
world({ dns: { 'bistro.example': { MX: ['10 mx1.mail.example.'] } } });
{
  const d = (await quiet(async () => jsonOf(await handleFoundationsGet(SITE('bistro.example'), {})))).body.data;
  ok('…and both when both are', d.email.missing.join() === 'sender,fakes' && /two records are missing/.test(d.email.sentence));
}

// 19: a sub-name, end to end
world({ dns: {}, registered: 'bistro.example' });
{
  const r = await get(SITE('shop.bistro.example'));
  ok('a sub-name’s sheet gets one record and checks one name', r.body.data.shape === 'sub' && r.body.data.records.length === 1 && r.body.data.records[0].host === 'shop' && r.body.data.names.length === 1 && r.body.data.names[0].name === 'shop.bistro.example', JSON.stringify(r.body.data.records));
}

// 21: both names before "nothing for you to do"
world({ dns: { 'bistro.example': { A: [NETLIFY_APEX_IP] } }, ssl: 'pending', registered: 'bistro.example' });
{
  const r = await get(SITE('bistro.example'));
  ok('records in for the bare name only: the answer says www. still doesn’t point here', r.body.data.health === 'ssl_pending' && r.body.data.names.find((n) => n.name === 'www.bistro.example').points === false && r.body.data.names.find((n) => n.name === 'bistro.example').points === true);
  const card = (await quiet(async () => jsonOf(await handleClientDomain(SITE('bistro.example'), {})))).body.data;
  ok('…and the portal shows that one record, not "nothing to do"', card.state === 'records' && card.records.length === 1 && card.records[0].host === 'www' && card.where.company === 'Cloudflare', JSON.stringify(card));
}
world();
{
  const none = (await quiet(async () => jsonOf(await handleClientDomain(SITE(null), {})))).body.data;
  ok('the portal route with no domain says so and asks nobody', none.domain === null && w.asked.length === 0 && w.siteGets === 0);
}

// 20: a forwarded domain waits until a check sees it
world({ dns: { ...BOTH, 'old.example': { A: [NETLIFY_APEX_IP] } }, aliases: ['old.example', 'www.old.example', 'gone.example'], registered: 'bistro.example' });
{
  const r = await get(SITE('bistro.example'));
  const fc = Object.fromEntries(r.body.data.forward_checks.map((c) => [c.name, c]));
  ok('a forward whose record is in is seen', fc['old.example'].points === true && fc['old.example'].records.length === 0);
  ok('its www. twin, not in yet, waits and shows its own record', fc['www.old.example'].points === false && fc['www.old.example'].records.length === 1 && fc['www.old.example'].records[0].host === 'www' && fc['www.old.example'].records[0].value === T, JSON.stringify(fc['www.old.example']));
  ok('one with nothing in waits and shows its record', fc['gone.example'].points === false && fc['gone.example'].records[0].host === '@');
  ok('the forwards list itself is unchanged', r.body.data.forwards.join() === 'gone.example,old.example,www.old.example');
}

// 22: attaching sends the records
world();
{
  const r = await quiet(async () => jsonOf(await handleDomain(new Request('http://stub.local/functions/v1/presence/foundations/domain', { method: 'POST', body: JSON.stringify({ domain: 'bistro.example' }), headers: { 'Content-Type': 'application/json' } }), 'POST', SITE(null), OWNER, {})));
  const m = w.mails.find((x) => x.to === 'owner@bistro.example');
  ok('attaching a domain emails the owner the records and a way back to check', r.status === 200 && !!m && m.subject === 'bistro.example was connected to your website' && m.html.includes(`<td>A</td><td>@</td><td>${NETLIFY_APEX_IP}</td>`) && m.html.includes(`<td>CNAME</td><td>www</td><td>${T}</td>`) && m.html.includes('https://app.example/presence.html#domain'), m ? m.html : 'no email');
  ok('…and the new name’s lookup is saved on the site', w.sitePatches.some((p) => 'domain_lookup_status' in p));
}

// ═══ the pages ═══
{
  const page = read('presence.html');
  const fn = (name) => { const i = page.indexOf(`function ${name}(`); let d = 0, j = page.indexOf('{', i); for (let k = j; k < page.length; k++) { if (page[k] === '{') d++; else if (page[k] === '}') { d--; if (d === 0) return page.slice(i, k + 1); } } return ''; };
  // 23: the name, the way a provider's form wants it
  const dnsRecHost = new Function(`${fn('dnsRecHost')}; return dnsRecHost;`)();
  ok('23: the bare name is "@"', dnsRecHost('bistro.example', 'bistro.example') === '@' && dnsRecHost('Bistro.Example.', 'www.bistro.example') === '@');
  ok('23: _dmarc.x.com is shown as _dmarc, never the full name', dnsRecHost('_dmarc.bistro.example', 'bistro.example') === '_dmarc' && dnsRecHost('google._domainkey.bistro.example', 'www.bistro.example') === 'google._domainkey');
  ok('23: a name on another domain stays whole', dnsRecHost('other.example', 'bistro.example') === 'other.example' && dnsRecHost('x.example', '') === 'x.example');
  ok('23: plan rows use it', page.includes('card.appendChild(dnsRecordRow(r.type, dnsRecHost(r.name, dstat && dstat.custom_domain), r.value));') && !page.includes('`${r.type}   ${r.name}   →   ${r.value}`'));
  // 18 + 25: one checklist, one read
  const desk = fn('openFoundationsDesk');
  ok('18 + 25: the sheet no longer asks for the launch list', !desk.includes('"/launch"') && !fn('renderFoundations').includes('launch.items') && desk.includes('api("GET", "/foundations/domain")'));
  // 19
  ok('19: the steps come from the server’s records, one for a sub-name', page.includes('"2. Add this one record exactly — tap Copy so there are no typos:"') && page.includes('dstat.records.map((r) => [r.type, r.host, r.value || cname])'));
  // 20
  ok('20: a forward says waiting until it is seen', page.includes('" is waiting for its records. It sends visitors to "') && page.includes('dstat.forward_checks'));
  // 21
  ok('21: one wait, said one way', !page.includes('usually within a few minutes') && !page.includes('we’ll email you the moment it is') && !page.includes('while the internet catches up') && page.includes(`const DOMAIN_WAIT = "${DOMAIN_WAIT}";`));
  ok('21: "nothing for you to do" waits for both names', page.includes('filter((n) => n && n.points === false).map((n) => n.name)') && page.includes('": its record is in. One more to add, for "'));
  // 26
  ok('26: the domain box has a name', page.includes('inp.setAttribute("aria-label", "Your domain")'));
  ok('26: every Copy button says what it copies', page.includes('cp.setAttribute("aria-label", "Copy the value of the " + type + " record for " + host + ": " + val)') && (page.match(/el\("button", "textact", "Copy"\)/g) || []).length === 1);
  // 22: the portal
  const portal = read('client.html');
  ok('22: the portal asks for the domain and has a Check button', portal.includes("api('/client/domain')") && portal.includes('id="home-domain" hidden') && portal.includes('id="domcheck"') && portal.includes('loadDomainCard(true)'));
  const idx = read('supabase/functions/presence/index.ts');
  ok('22: the portal route is wired', idx.includes("if (route === '/client/domain' && method === 'GET') return handleClientDomain(site, cors);"));
  // the portal card's words, from the page's own function
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cardSrc = portal.slice(portal.indexOf('function domainCardHtml(d){'), portal.indexOf('async function loadDomainCard('));
  const domainCardHtml = new Function('esc', `${cardSrc}; return domainCardHtml;`)(esc);
  const html = domainCardHtml({ domain: 'bistro.example', state: 'records', records: [{ type: 'A', host: '@', value: NETLIFY_APEX_IP }, { type: 'CNAME', host: 'www', value: T }], where: { company: 'Cloudflare', sign_in: 'https://dash.cloudflare.com/' }, wait: DOMAIN_WAIT });
  ok('22: the card shows the two records, where to add them and Check', /isn’t live yet\. Add these two records at Cloudflare\./.test(html) && html.includes('Sign in to Cloudflare ↗') && html.includes(NETLIFY_APEX_IP) && html.includes('>Check if it’s ready</button>') && html.includes(DOMAIN_WAIT), html);
  ok('22: its Copy buttons are named too', html.includes(`aria-label="Copy the value of the CNAME record for www: ${T}"`));
  ok('22: a live domain needs no card', domainCardHtml({ domain: 'bistro.example', state: 'live' }) === '' && domainCardHtml({ domain: null }) === '');
  ok('22: a card never carries script from a record', !domainCardHtml({ domain: 'x.example', state: 'records', records: [{ type: 'A', host: '@', value: '<script>1</script>' }], wait: '' }).includes('<script>'));
}

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
