// ── Nov 2026 review, builder list item 162: the Domains page does things ──
//   deno run --allow-read --allow-env tests/presence/domains_page_test.mjs
// Findings 6, 9, 10, 23 and 24 (domains file): the page was a read-only report. The
// public record's other facts (the transfer lock, who runs the DNS, words such as
// "redemption period") were thrown away; there was no way to check a domain now, see
// all its records, or write down whose account it is in. The rules first, then the
// daily check writing the new facts against a stubbed registry, and the wiring. The
// routes themselves are tested in studio_sites_test (section 9).
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';
const { parseRdapFacts, dnsHostOf, registryWarnings, sameCompany, lockIsReported } = await import(`${P}/lib/rdap.ts`);
const { recordsFromAnswer } = await import(`${P}/lib/domain_health.ts`);
const { buildDomains, normalizeDomainNotes, CHECK_NOW_GAP_MS } = await import(`${P}/agency/sites.ts`);
const { buildNeedsYou } = await import(`${P}/agency/needs_you.ts`);
const { RESERVED_NAMES } = await import(`${P}/lib/reserved_store.ts`);
const { NETLIFY_APEX_IP } = await import(`${P}/platform/dns.ts`);

// ═══ what else the public record says ═══
const RDAP = {
  ldhName: 'BISTRO.EXAMPLE',
  status: ['client transfer prohibited', 'Client Update Prohibited', 'active'],
  nameservers: [{ ldhName: 'NS51.DOMAINCONTROL.COM' }, { ldhName: 'ns52.domaincontrol.com.' }],
  events: [{ eventAction: 'registration', eventDate: '2014-03-02T10:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-03-02T10:00:00Z' }],
  secureDNS: { delegationSigned: false },
};
{
  const f = parseRdapFacts(RDAP);
  ok('the lock is on when the registry says transfer prohibited', f.lock === true);
  ok('who runs the DNS comes from the nameservers', f.dns_host === 'GoDaddy' && f.nameservers.join(',') === 'ns51.domaincontrol.com,ns52.domaincontrol.com.', JSON.stringify(f));
  ok('the status words are kept, in lower case', f.statuses.join('|') === 'client transfer prohibited|client update prohibited|active');
  ok('the registration date and DNSSEC are read', f.registered_at === '2014-03-02T10:00:00.000Z' && f.dnssec === false);
  ok('a .com-style name with no lock word is unlocked', parseRdapFacts({ ldhName: 'bistro.com', status: ['active'] }).lock === false);
  ok('a country ending that has no lock word is "not known", never "off"', parseRdapFacts({ ldhName: 'bistro.co.uk', status: ['active'] }).lock === null && parseRdapFacts({ ldhName: 'bistro.de', status: ['active'] }).lock === null);
  ok('…and its lock is on when it does say so', parseRdapFacts({ ldhName: 'bistro.co.uk', status: ['server transfer prohibited'] }).lock === true);
  ok('an empty answer reads as nothing known', (() => { const e = parseRdapFacts(null); return e.lock === null && e.dns_host === '' && e.statuses.length === 0 && e.registered_at === null && e.dnssec === null; })());
  ok('which endings report the lock', lockIsReported('bistro.com') && lockIsReported('bistro.shop') && lockIsReported('bistro.us') && lockIsReported('bistro.co') && !lockIsReported('bistro.co.uk') && !lockIsReported('bistro.de'));
}
ok('DNS companies by their nameservers', [
  [['kate.ns.cloudflare.com'], 'Cloudflare'], [['dns1.registrar-servers.com'], 'Namecheap'], [['ns-cloud-a1.googledomains.com'], 'Google Domains (now Squarespace)'],
  [['ns-123.awsdns-15.com'], 'Amazon Route 53'], [['dns1.p01.nsone.net'], 'NS1 (Netlify DNS runs on it)'], [['ns1.example-dns.net'], 'example-dns.net'], [[], ''],
].every(([ns, want]) => dnsHostOf(ns) === want), [['kate.ns.cloudflare.com'], ['ns1.example-dns.net']].map((n) => dnsHostOf(n)).join(','));
ok('the DNS company and the seller are the same company, loosely by name', sameCompany('GoDaddy', 'GoDaddy.com, LLC') && sameCompany('Namecheap', 'NameCheap, Inc.') && sameCompany('Amazon Route 53', 'Amazon Registrar, Inc.') && sameCompany('Squarespace', 'Squarespace Domains II LLC'));
ok('…and different ones are told apart, unknowns never match', !sameCompany('Cloudflare', 'NameCheap, Inc.') && !sameCompany('', 'GoDaddy.com, LLC') && !sameCompany('GoDaddy', '') && !sameCompany('Google Domains (now Squarespace)', 'Squarespace Domains II LLC'));

// ═══ what the status words mean ═══
{
  const keys = (statuses, lock = true) => registryWarnings({ lock, statuses }).map((w) => w.key).join(',');
  ok('about to be deleted comes first, then the redemption period', keys(['redemption period', 'pending delete']) === 'pending_delete,redemption');
  ok('a hold (either side) is the domain not answering', keys(['client hold']) === 'hold' && keys(['server hold']) === 'hold');
  ok('the three in trouble are "bad", the open doors "warn"', registryWarnings({ lock: false, statuses: ['pending delete', 'auto renew period'] }).map((w) => w.severity).join(',') === 'bad,warn,warn');
  ok('a grace period is a quiet check, not an alarm', keys(['auto renew period']) === 'grace' && keys(['renew period']) === 'grace');
  ok('an unlocked domain is said; an unknown lock is not', keys(['active'], false) === 'unlocked' && keys(['active'], null) === '' && keys([], false) === '');
  ok('nothing known, nothing said', registryWarnings(null).length === 0 && keys(['active', 'client transfer prohibited']) === '');
  ok('the words are plain and say what to do', /renew it today/.test(registryWarnings({ lock: true, statuses: ['pending delete'] })[0].words) && /the provider has to lift it/.test(registryWarnings({ lock: true, statuses: ['client hold'] })[0].words));
}

// ═══ the records list: only what is set at that name ═══
{
  const www = [{ name: 'www.bistro.example.', type: 5, data: 'bistro.netlify.app.' }, { name: 'bistro.netlify.app.', type: 1, data: '1.2.3.4' }];
  ok('a CNAME on the way to an address is its own row, and the address behind it isn’t the client’s', recordsFromAnswer('www.bistro.example', 'A', www).length === 0 && recordsFromAnswer('www.bistro.example', 'CNAME', www).join() === 'bistro.netlify.app');
  ok('an address at the name itself is listed', recordsFromAnswer('bistro.example', 'A', [{ name: 'bistro.example.', type: 1, data: NETLIFY_APEX_IP }]).join() === NETLIFY_APEX_IP);
  ok('a TXT keeps its case and loses its quotes, and long ones join up', recordsFromAnswer('bistro.example', 'TXT', [{ name: 'bistro.example.', type: 16, data: '"google-site-verification=AbC123"' }, { name: 'bistro.example.', type: 16, data: '"v=spf1 include:a.example" " ~all"' }]).join(' | ') === 'google-site-verification=AbC123 | v=spf1 include:a.example ~all');
  ok('mail records keep their priority', recordsFromAnswer('bistro.example', 'MX', [{ name: 'bistro.example.', type: 15, data: '10 MX1.Mail.example.' }]).join() === '10 mx1.mail.example');
  ok('no answer is no rows', recordsFromAnswer('bistro.example', 'A', undefined).length === 0);
}

// ═══ the studio's notes on a domain ═══
{
  const n = normalizeDomainNotes({ account: '  The client’s own account  ', renews: 'yes', renews_confirmed_at: '2026-11-11', note: '  Card on file ends 2027 ', junk: 1 });
  ok('notes are tidied and only known fields kept', n.account === 'The client’s own account' && n.renews === 'yes' && n.renews_confirmed_at === '2026-11-11' && n.note === 'Card on file ends 2027' && !('junk' in n));
  ok('long fields are cut to size', normalizeDomainNotes({ account: 'a'.repeat(300), note: 'b'.repeat(900) }).account.length === 120 && normalizeDomainNotes({ note: 'b'.repeat(900) }).note.length === 600);
  ok('anything but yes or no is "don’t know", which has no confirmed date', normalizeDomainNotes({ renews: 'maybe', renews_confirmed_at: '2026-11-11' }).renews === 'unknown' && normalizeDomainNotes({ renews: 'maybe', renews_confirmed_at: '2026-11-11' }).renews_confirmed_at === null);
  ok('a date that isn’t a day is dropped', normalizeDomainNotes({ renews: 'no', renews_confirmed_at: 'next week' }).renews_confirmed_at === null);
  ok('nothing saved yet reads as empty notes', JSON.stringify(normalizeDomainNotes(null)) === JSON.stringify({ account: '', renews: 'unknown', renews_confirmed_at: null, note: '', updated_by: null, updated_at: null }));
  ok('the notes live in their own reserved row', RESERVED_NAMES.domainNotes === '__domain_notes__');
  ok('Check now waits a minute between checks', CHECK_NOW_GAP_MS === 60_000);
}

// ═══ the Domains page and Home ═══
const NOW = '2026-11-11T12:00:00.000Z';
{
  const base = { site_id: 's1', name: 'Bistro', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'bistro.example', uptime_ok: true, domain_expires_at: '2027-06-01T00:00:00Z', domain_registrar: 'GoDaddy.com, LLC', domain_lookup_status: 'ok' };
  const one = (over) => buildDomains([{ ...base, ...over }], NOW).domains[0];
  ok('the registry’s words come first: in the redemption period', one({ domain_statuses: ['redemption period'] }).status === 'registry' && one({ domain_statuses: ['redemption period'] }).status_words === 'In the redemption period' && one({ domain_statuses: ['redemption period'] }).tone === 'bad');
  ok('…about to be deleted, and on hold', one({ domain_statuses: ['pending delete'] }).status_words === 'About to be deleted' && one({ domain_statuses: ['server hold'] }).status_words === 'On hold at the registry');
  ok('…even when the date looks fine (a lapsed name’s date can jump ahead)', one({ domain_statuses: ['redemption period'], domain_expires_at: '2027-11-01T00:00:00Z' }).status === 'registry');
  const rank = buildDomains([{ ...base, site_id: 'a', custom_domain: 'a.example', domain_expires_at: '2026-11-01T00:00:00Z' }, { ...base, site_id: 'b', custom_domain: 'b.example', domain_statuses: ['pending delete'] }], NOW).domains.map((d) => d.domain);
  ok('a domain in trouble at the registry sorts above an expired one', rank.join() === 'b.example,a.example');
  ok('DNS run somewhere else is named', one({ domain_dns_host: 'Cloudflare' }).dns_host === 'Cloudflare');
  ok('…and not when it’s the company it was bought from', one({ domain_dns_host: 'GoDaddy' }).dns_host === '');
  ok('the lock travels as on, off or not known', one({ domain_lock: true }).lock === true && one({ domain_lock: false }).lock === false && one({}).lock === null);
  ok('the row carries what the words mean, and how bad', (() => { const w = one({ domain_lock: false, domain_statuses: ['active'] }).warnings; return w.length === 1 && w[0].key === 'unlocked' && w[0].severity === 'warn' && /transfer lock is off/.test(w[0].words); })());
  ok('a lock the registry doesn’t report raises nothing', one({ domain_lock: null, domain_statuses: ['active'] }).warnings.length === 0);
  ok('not checked since the new facts: nothing claimed', (() => { const d = one({}); return d.warnings.length === 0 && d.dns_host === '' && d.lock === null && d.registered_at === null; })());
  ok('the registration date travels', one({ domain_registered_at: '2014-03-02T10:00:00.000Z' }).registered_at === '2014-03-02T10:00:00.000Z');
}
{
  const input = (site) => ({ nowIso: NOW, links: [{ site_id: 's1', status: 'active' }], clientNames: { s1: 'Bistro' }, sites: [{ id: 's1', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'bistro.example', domain_registrar: 'GoDaddy.com, LLC', ...site }] });
  const row = (rows) => rows.find((r) => r.key === 'broken:registry:s1');
  const del = row(buildNeedsYou(input({ domain_statuses: ['pending delete'] })));
  ok('Home asks when a domain is about to be deleted, and where', del && /bistro\.example is about to be deleted/.test(del.what) && del.when === 'At GoDaddy.com, LLC' && del.href === '/domains.html' && del.verb === 'Fix', JSON.stringify(del));
  ok('…in the redemption period, or on hold', /redemption period/.test(row(buildNeedsYou(input({ domain_statuses: ['redemption period'] })))?.what || '') && /on hold/.test(row(buildNeedsYou(input({ domain_statuses: ['client hold'] })))?.what || ''));
  ok('…and not for ordinary words, or a site with no domain', !row(buildNeedsYou(input({ domain_statuses: ['active', 'client transfer prohibited'] }))) && !row(buildNeedsYou(input({ domain_statuses: ['pending delete'], custom_domain: null }))));
  ok('…even for a site on its own host (the name is still the client’s)', !!row(buildNeedsYou(input({ domain_statuses: ['pending delete'], edition: 'monitor' }))));
}

// ═══ the daily check writes the new facts down ═══
let w;
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'dns.google') { const n = u.searchParams.get('name'), t = u.searchParams.get('type'); const v = n === 'bistro.example' && t === 'A' ? [NETLIFY_APEX_IP] : n === 'www.bistro.example' && t === 'CNAME' ? ['bistro.netlify.app'] : []; return reply({ Answer: v.map((d) => ({ name: n + '.', type: t === 'A' ? 1 : 5, data: d + '.' })) }); }
  if (u.hostname === 'api.netlify.com') { if (u.pathname.endsWith('/ssl')) return method === 'POST' ? reply({}) : reply({ state: 'issued', domains: ['bistro.example', 'www.bistro.example'], expires_at: '2027-02-01T00:00:00Z' }); return reply({ id: 'nf1', name: 'bistro', default_domain: 'bistro.netlify.app', url: 'https://bistro.netlify.app' }); }
  if (u.hostname === 'rdap.org') return w.rdap ? reply(w.rdap) : w.rdap404 ? reply({}, 404) : reply({ error: 'busy' }, 503);
  if (u.hostname === 'bistro.example' || u.hostname === 'bistro.netlify.app') return reply('<h1>Bistro</h1>', 200, { Server: 'Netlify' });
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  if (table === 'presence_sites' && method === 'PATCH') { w.patches.push(JSON.parse(init.body)); return reply([]); }
  // part two: the rate limiter, the sheet's facts, the seller for "make sure it renews", a saved plan
  if (table === 'rpc/rate_hit') return reply(w.rateOk === false ? false : true);
  if (table === 'presence_sites' && method === 'GET' && u.search.includes('domain_lookup_status')) return reply(w.facts ? [w.facts] : []);
  if (table === 'presence_sites' && method === 'GET' && u.search.includes('select=domain_registrar&')) return reply(w.sold ? [{ domain_registrar: w.sold }] : []);
  if (table === 'presence_infra_plans' && method === 'POST') { const b = JSON.parse(init.body); (w.plans = w.plans || []).push(b); return reply([{ id: 'plan1', status: 'proposed', ...b }]); }
  return reply([]);
};
const quiet = async (fn) => { const e = console.error, x = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = x; } };
const { checkOneDomain } = await import(`${P}/commerce/lifecycle.ts`);
const SITE = { id: 'site1', client_id: 'c1', custom_domain: 'bistro.example', netlify_site_id: 'nf1', edition: 'presence', cert_pending_since: null };
{
  w = { rdap: { ...RDAP, status: ['redemption period'] }, patches: [] };
  const r = await quiet(() => checkOneDomain(SITE, NOW));
  const p = w.patches[0] || {};
  ok('one check writes the lock (off: no lock word on a generic ending), the DNS company, the words and the date', r.lookup === 'ok' && p.domain_lock === false && p.domain_dns_host === 'GoDaddy' && JSON.stringify(p.domain_statuses) === '["redemption period"]' && p.domain_registered_at === '2014-03-02T10:00:00.000Z', JSON.stringify(p));
}
{
  w = { rdap: RDAP, patches: [] };
  await quiet(() => checkOneDomain(SITE, NOW));
  ok('…and on when the registry says transfer prohibited', (w.patches[0] || {}).domain_lock === true);
}
{
  w = { rdap: { ...RDAP, ldhName: 'bistro.co.uk', status: ['active'] }, patches: [] };
  await quiet(() => checkOneDomain({ ...SITE, custom_domain: 'bistro.co.uk', netlify_site_id: null }, NOW));
  ok('a lock that isn’t reported is written as not known', (w.patches[0] || {}).domain_lock === null && 'domain_lock' in (w.patches[0] || {}));
}
{
  w = { rdap: null, patches: [] };
  await quiet(() => checkOneDomain(SITE, NOW));
  const p = w.patches[0] || {};
  ok('a failed lookup keeps yesterday’s facts (nothing overwritten with blanks)', p.domain_lookup_status === 'failed' && !('domain_lock' in p) && !('domain_statuses' in p) && !('domain_dns_host' in p) && typeof p.domain_checked_at === 'string', JSON.stringify(p));
}

// ═══ the wiring ═══
{
  const mig = read('supabase/migrations/0162_domain_registry_facts.sql'), pack = read('docs/presence/APPLY-0162-prod.sql');
  const cols = ['domain_lock boolean', 'domain_dns_host text', 'domain_statuses jsonb', 'domain_registered_at timestamptz'];
  ok('the migration and its production pack add the same four columns', cols.every((c) => mig.includes(`add column if not exists ${c}`) && pack.includes(`add column if not exists ${c}`)));
  const sites = read('supabase/functions/presence/agency/sites.ts');
  ok('the Domains page reads the new facts', /domain_lock,domain_dns_host,domain_statuses,domain_registered_at`/.test(sites));
  ok('Home reads the registry’s words', /domain_serving,domain_statuses&limit=1000/.test(read('supabase/functions/presence/agency/routes.ts')));
  ok('one domain’s routes: the panel, the notes (manage_clients) and Check now (once a minute)', /\\\/agency\\\/domains\\\/\(\[0-9a-f-\]\{36\}\)\(\?:\\\/\(notes\|check\)\)\?\$/.test(sites) && /what === 'notes' && method === 'PUT'\) \{\s*if \(!can\(member\.role, 'manage_clients'\)\)/.test(sites) && /since < CHECK_NOW_GAP_MS/.test(sites));
  ok('Check now runs the same check as the daily watch', /\)\.checkOneDomain\(/.test(sites) && /const r = await checkOneDomain\(site, nowIso\)/.test(read('supabase/functions/presence/commerce/lifecycle.ts')));
  const page = read('domains.html');
  ok('the page has the filters, the side panel, Download and the Last checked column', ['attention:', 'expiring:', 'waiting:', 'nodomain:'].every((k) => page.includes(k)) && /<dialog class="dpanel" id="dpanel"/.test(page) && /id="dlBtn"/.test(page) && /\['checked','Last checked'/.test(page));
  ok('the panel calls the three routes', /api\('\/agency\/domains\/'\+encodeURIComponent\(siteId\)\)/.test(page) && /apiSend\('POST','\/agency\/domains\/'\+encodeURIComponent\(d\.site_id\)\+'\/check'\)/.test(page) && /apiSend\('PUT','\/agency\/domains\/'\+encodeURIComponent\(d\.site_id\)\+'\/notes',body\)/.test(page));
}


// ═══ part two: where to go, the lookup as they type, the guides, mail and history (findings 6, 7, 8, 10, 23) ═══
const { providerGuide, whereToGo, lookupPatch, registrarTip, expiryWords } = await import(`${P}/lib/rdap.ts`);
const { mailHealth, domainHistory } = await import(`${P}/agency/sites.ts`);
{
  ok('one table names each company: by its registrar name, its DNS name or a nameserver', providerGuide('GoDaddy.com, LLC')?.company === 'GoDaddy' && providerGuide('NAMECHEAP INC')?.company === 'Namecheap' && providerGuide('Cloudflare')?.company === 'Cloudflare' && providerGuide('Google Domains (now Squarespace)')?.company === 'Squarespace Domains' && providerGuide('ns-123.awsdns-15.com')?.company === 'Amazon Route 53');
  ok('…unknown or blank is no guide', providerGuide('Weird Registrar GmbH') === null && providerGuide('') === null && providerGuide(null) === null);
  ok('every guide has a sign-in page, a path to the records and one to renewal', ['godaddy', 'namecheap', 'cloudflare', 'squarespace', 'porkbun', 'wix', 'network solutions', 'ionos', 'route 53', 'hover', 'dnsimple', 'digitalocean'].every((n) => { const g = providerGuide(n); return g && /^https:\/\//.test(g.sign_in) && g.records && g.renewal; }));
  ok('the old tips read from the same table, word for word', registrarTip('GoDaddy.com, LLC') === 'At GoDaddy: My Products → your domain → Manage DNS (renewal lives under Billing).' && registrarTip('Weird Registrar GmbH').includes('Weird Registrar GmbH') && registrarTip('') === '');
  const w1 = whereToGo('NameCheap, Inc.', 'Cloudflare');
  ok('records at the company that runs the DNS, renewal at the seller', w1.records_at.company === 'Cloudflare' && w1.records_at.sign_in === 'https://dash.cloudflare.com/' && w1.renew_at.company === 'Namecheap' && /Auto-Renew/.test(w1.renew_at.path));
  const w2 = whereToGo('GoDaddy.com, LLC', '');
  ok('DNS company not known yet: the seller, for both', w2.records_at.company === 'GoDaddy' && w2.renew_at.company === 'GoDaddy');
  const w3 = whereToGo('Weird Registrar GmbH', 'example-dns.net');
  ok('companies we have no guide for are still named, with no made-up link', w3.records_at.company === 'example-dns.net' && w3.records_at.sign_in === '' && w3.renew_at.company === 'Weird Registrar GmbH' && w3.renew_at.sign_in === '');
  const w4 = whereToGo('', '');
  ok('nothing known, nothing claimed', w4.records_at === null && w4.renew_at === null);
}
{
  const p = lookupPatch({ status: 'ok', name: 'bistro.example', info: { registrar: 'GoDaddy.com, LLC', expires_at: '2027-03-02T10:00:00.000Z' }, facts: parseRdapFacts(RDAP) });
  ok('one lookup writes the registrar, expiry, name, lock, DNS company, words and date', p.domain_lookup_status === 'ok' && p.domain_registered_name === 'bistro.example' && p.domain_registrar === 'GoDaddy.com, LLC' && p.domain_expires_at === '2027-03-02T10:00:00.000Z' && p.domain_lock === true && p.domain_dns_host === 'GoDaddy' && Array.isArray(p.domain_statuses) && p.domain_registered_at === '2014-03-02T10:00:00.000Z', JSON.stringify(p));
  ok('a failed or empty lookup writes only its status', JSON.stringify(lookupPatch({ status: 'failed' })) === '{"domain_lookup_status":"failed"}' && JSON.stringify(lookupPatch({ status: 'not_found' })) === '{"domain_lookup_status":"not_found"}');
}
{
  ok('mail: none, protected, or what is missing', mailHealth([], [], []).words === 'No email runs on this domain.' && mailHealth(['10 mx.example'], ['v=spf1 include:mx.example ~all'], ['v=DMARC1; p=none']).words === 'Email runs here and is protected: SPF and DMARC are both set.' && mailHealth(['10 mx.example'], ['v=spf1 -all'], []).words === 'Email runs here but isn’t fully protected: no DMARC record.' && mailHealth(['10 mx.example'], ['google-site-verification=x'], []).words === 'Email runs here but isn’t fully protected: no SPF record and no DMARC record.');
  ok('mail: a near miss is not an SPF record', mailHealth(['10 mx.example'], ['v=spf10 nope'], ['v=DMARC1']).spf === false);
  const ev = [{ action: 'create', summary: 'Attached domain bistro.example', actor_kind: 'operator', created_at: '2026-10-01T09:00:00Z' }, { action: 'delete', summary: 'Removed domain old.example', actor_kind: 'client', created_at: '2026-09-01T09:00:00Z' }, { summary: 'Something', actor_kind: 'system', created_at: '2026-08-01T09:00:00Z' }];
  const nt = [{ period: 'exp:bistro.example:2026-11-18:30', created_at: '2026-10-19T00:00:00Z' }, { period: 'exp:bistro.example:2026-11-18:weird', created_at: '2026-10-20T00:00:00Z' }];
  const h = domainHistory(ev, nt, false);
  ok('history: newest first, with who did it and each reminder that went out', h.map((x) => x.words).join(' | ') === '30-day reminder sent to the client and you | Attached domain bistro.example, by your studio | Removed domain old.example, by the client | Something, automatically', JSON.stringify(h));
  ok('history: on the studio’s own domain, the studio did it and the reminder went to it', domainHistory(ev.slice(1, 2), nt.slice(0, 1), true).map((x) => x.words).join(' | ') === '30-day reminder sent | Removed domain old.example, by your studio');
  ok('history: eight at most', domainHistory(Array.from({ length: 12 }, (_, i) => ({ summary: 'E' + i, actor_kind: 'operator', created_at: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` })), [], false).length === 8);
}
{
  ok('the first reminder asks whether it renews by itself, and how to give access safely', /Is it set to renew by itself\? A quick look at GoDaddy settles it\./.test(expiryWords('a.com', 30, 'GoDaddy').after) && /add them as a user there rather than sharing your password/.test(expiryWords('a.com', 30, 'GoDaddy').body));
  ok('…with no seller known, it still reads right', /A quick look at the company it’s registered with settles it/.test(expiryWords('a.com', 30, '').after));
  ok('…and the later, urgent ones stay short', !/renew by itself\?/.test(expiryWords('a.com', 15, 'GoDaddy').after) && !/renew by itself\?/.test(expiryWords('a.com', 7, 'GoDaddy').after) && !/renew by itself\?/.test(expiryWords('a.com', -1, 'GoDaddy').after));
}
// the routes: the lookup as they type, the sheet's facts the first time, a guide's preview
{
  const { handleDomainLookup, handleDomain } = await import(`${P}/routes/admin.ts`);
  const { handleFoundationsPrepare } = await import(`${P}/routes/foundations.ts`);
  const HOSTED = { id: 'site1', client_id: 'c1', custom_domain: 'bistro.example', netlify_site_id: 'nf1', edition: 'presence', status: 'live' };
  const get = (path) => new Request('http://stub.local/functions/v1/presence' + path);
  const post = (path, body) => new Request('http://stub.local/functions/v1/presence' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const jsonOf = async (res) => ({ status: res.status, body: await res.json() });
  const PRIN = { kind: 'client', userId: 'u1', email: 'owner@bistro.example' };
  const SOLD_AT_NAMECHEAP = { ...RDAP, entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'NameCheap, Inc.']]] }], nameservers: [{ ldhName: 'kate.ns.cloudflare.com' }] };

  w = { rdap: SOLD_AT_NAMECHEAP, patches: [] };
  const l1 = await jsonOf(await quiet(() => handleDomainLookup(get('/foundations/domain/lookup?name=' + encodeURIComponent('https://Bistro.Example/menu')), HOSTED, {})));
  ok('lookup: a typed address is tidied, and names who sold it and who keeps its records', l1.status === 200 && l1.body.data.name === 'bistro.example' && l1.body.data.found === true && l1.body.data.renew_at.company === 'Namecheap' && l1.body.data.records_at.company === 'Cloudflare' && l1.body.data.records_at.sign_in === 'https://dash.cloudflare.com/', JSON.stringify(l1.body));
  ok('lookup: nothing is written while they type', w.patches.length === 0);
  w = { rdap: null, rdap404: true, patches: [] };
  ok('lookup: a name nobody owns says so', (await jsonOf(await quiet(() => handleDomainLookup(get('/foundations/domain/lookup?name=free-name.example'), HOSTED, {})))).body.data.found === false);
  w = { rdap: null, patches: [] };
  ok('lookup: a registry that didn’t answer is "couldn’t check", not "free"', (await jsonOf(await quiet(() => handleDomainLookup(get('/foundations/domain/lookup?name=bistro.example'), HOSTED, {})))).body.data.found === null);
  ok('lookup: half a name is refused politely', (await jsonOf(await quiet(() => handleDomainLookup(get('/foundations/domain/lookup?name=bistro'), HOSTED, {})))).status === 400);
  w = { rdap: RDAP, patches: [], rateOk: false };
  ok('lookup: too many in ten minutes waits', (await jsonOf(await quiet(() => handleDomainLookup(get('/foundations/domain/lookup?name=bistro.example'), HOSTED, {})))).status === 429);

  w = { rdap: RDAP, patches: [], facts: { domain_registered_name: null, domain_registrar: null, domain_dns_host: null, domain_lookup_status: null } };
  const s1 = await jsonOf(await quiet(() => handleDomain(get('/foundations/domain'), 'GET', HOSTED, PRIN, {})));
  ok('the client’s sheet: a domain never looked up is looked up on the spot and saved', w.patches.some((p) => p.domain_lookup_status === 'ok' && p.domain_dns_host === 'GoDaddy') && s1.body.data.provider && s1.body.data.provider.records_at.company === 'GoDaddy', JSON.stringify(s1.body.data && s1.body.data.provider));
  w = { rdap: RDAP, patches: [], facts: { domain_registered_name: 'bistro.example', domain_registrar: 'NameCheap, Inc.', domain_dns_host: 'Cloudflare', domain_lookup_status: 'ok' } };
  const s2 = await jsonOf(await quiet(() => handleDomain(get('/foundations/domain'), 'GET', HOSTED, PRIN, {})));
  ok('…and once known, it isn’t asked again', w.patches.length === 0 && s2.body.data.provider.records_at.company === 'Cloudflare' && s2.body.data.provider.renew_at.company === 'Namecheap');

  w = { rdap: RDAP, patches: [], plans: [], sold: 'NameCheap, Inc.' };
  const pv = await jsonOf(await quiet(() => handleFoundationsPrepare(post('/foundations/prepare', { goal: 'registrar_care', preview: true }), HOSTED, PRIN, {})));
  ok('a guide’s preview saves nothing', pv.status === 200 && pv.body.data.preview === true && w.plans.length === 0, JSON.stringify(pv.body).slice(0, 200));
  ok('"make sure it renews" names the seller, its sign-in page and where the switch is', /^Sign in to Namecheap \(https:\/\/ap\.www\.namecheap\.com\/domains\/list\/\) and turn on auto-renew for bistro\.example: it’s under the Auto-Renew switch/.test(String(pv.body.data && pv.body.data.steps && pv.body.data.steps[0].what)), JSON.stringify(pv.body.data && pv.body.data.steps && pv.body.data.steps[0]));
  const sent = await jsonOf(await quiet(() => handleFoundationsPrepare(post('/foundations/prepare', { goal: 'registrar_care' }), HOSTED, PRIN, {})));
  ok('…and without preview it is saved for the client’s OK', sent.status === 200 && w.plans.length === 1 && w.plans[0].kind === 'registrar_care', JSON.stringify(sent.body).slice(0, 200));
  w = { rdap: RDAP, patches: [], plans: [] };
  const cd = await jsonOf(await quiet(() => handleFoundationsPrepare(post('/foundations/prepare', { goal: 'connect_domain', preview: true }), HOSTED, PRIN, {})));
  ok('"the records this site needs" points www at the site’s real address, not a placeholder', JSON.stringify(cd.body.data && cd.body.data.steps).includes('bistro.netlify.app'), JSON.stringify(cd.body).slice(0, 300));
}
// the wiring for part two
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('the lookup route is wired before the domain route', idx.indexOf("route === '/foundations/domain/lookup'") > 0 && idx.indexOf("route === '/foundations/domain/lookup'") < idx.indexOf("route === '/foundations/domain' &&"));
  const fd = read('supabase/functions/presence/routes/foundations.ts');
  ok('a preview answers before anything is saved', fd.indexOf('if (body.preview === true) return') > 0 && fd.indexOf('if (body.preview === true) return') < fd.indexOf('presence_infra_plans?select='));
  ok('the daily check and the sheet write a lookup the same way', /\.\.\.lookupPatch\(look\)/.test(read('supabase/functions/presence/commerce/lifecycle.ts')) && /lookupPatch\(await rdapLookupDetailed\(site\.custom_domain\)\)/.test(read('supabase/functions/presence/routes/admin.ts')));
  const dp = read('domains.html');
  ok('the studio panel reads a guide first, inside the client’s site, then puts it on their page', /apiSend\('POST','\/foundations\/prepare',\{goal,preview:true\},scopeFor\(d\)\)/.test(dp) && /apiSend\('POST','\/foundations\/prepare',\{goal\},scopeFor\(d\)\)/.test(dp) && /'x-dds-scope-site':d\.site_id/.test(dp));
  const pr = read('presence.html');
  ok('the client’s sheet looks the typed domain up, names the company in step 1, offers the guides and shows every record', /"\/foundations\/domain\/lookup\?name=" \+ encodeURIComponent\(v\)/.test(pr) && /s1\.dataset\.step = "provider"/.test(pr) && /\["registrar_care", "Make sure it renews by itself"\]/.test(pr) && /all\.dataset\.records = "all"/.test(pr));
}

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
