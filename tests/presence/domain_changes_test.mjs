// ── Nov 2026 review, builder list item 163: safer domain changes ──
//   deno run --allow-read --allow-env tests/presence/domain_changes_test.mjs
// Findings 11, 12, 14 and 21 (domains file): removing a domain took one plain yes and
// told nobody; changing it dropped the old name cold; nothing protected the client's
// email records; a name already on another of our sites failed later in the hosting
// company's words. The pure rules first, then the routes and the daily check against
// stubbed hosting, DNS, database and email. No outside call leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';
const { byWhom, domainChangeEmail, forwardingRules, withForwarding, mailWatch } = await import(`${P}/lib/domain_notify.ts`);
const { domainChanges, handleDomain } = await import(`${P}/routes/admin.ts`);
const { checkOneDomain } = await import(`${P}/commerce/lifecycle.ts`);
const NOW = '2026-11-11T12:00:00.000Z';

// ═══ who, and the words ═══
ok('a studio acting inside the client’s site, or staff, is "your studio"', byWhom({ scope: { site_id: 's1' }, kind: 'client', email: 'eric@studio.example' }) === 'your studio' && byWhom({ kind: 'staff', email: 'x@y' }) === 'your studio');
ok('anyone else is named by their email, or plainly', byWhom({ kind: 'client', email: 'owner@bistro.example' }) === 'owner@bistro.example' && byWhom({ kind: 'client' }) === 'someone on your account');
{
  const a = domainChangeEmail('attached', { domain: 'bistro.example', by: 'your studio' });
  const c = domainChangeEmail('changed', { domain: 'new.example', old: 'old.example', forwarded: true, by: 'your studio' });
  const c2 = domainChangeEmail('changed', { domain: 'new.example', old: 'old.example', forwarded: false, by: 'your studio' });
  const r = domainChangeEmail('removed', { domain: 'bistro.example', by: 'owner@bistro.example', builtIn: 'presence-abc.netlify.app' });
  const m = domainChangeEmail('mail_gone', { domain: 'bistro.example', mx: ['10 mx1.mail.example', '20 mx2.mail.example'], recordsAt: 'Cloudflare' });
  ok('attached: who did it, and when it goes live', a.subject === 'bistro.example was connected to your website' && /by your studio/.test(a.html) && /goes live once its two records are added/.test(a.html));
  ok('changed: from, to, and whether the old one keeps working', c.subject === 'Your website’s address is changing to new.example' && /keeps working: from the next publish, visitors who use it are sent on to new\.example/.test(c.html) && /old\.example no longer shows your website/.test(c2.html));
  ok('removed: still online at its built-in address, linked', r.subject === 'bistro.example was removed from your website' && /by owner@bistro\.example/.test(r.html) && /href="https:\/\/presence-abc\.netlify\.app"/.test(r.html));
  ok('email gone: the old values to put back, and where', m.subject === 'Email for bistro.example may have stopped arriving' && /MX 10 mx1\.mail\.example/.test(m.html) && /MX 20 mx2\.mail\.example/.test(m.html) && /Add them back at Cloudflare/.test(m.html));
  ok('every email offers a reply when it wasn’t expected, and never names the hosting company in a sentence', [a, c, r].every((x) => /reply to this email/.test(x.html)) && [a, c, c2, m].every((x) => !/netlify/i.test(x.subject + x.html)));
  ok('names are escaped', /&lt;b&gt;/.test(domainChangeEmail('attached', { domain: '<b>x.example', by: 'y' }).html));
}

// ═══ forwarding an old name ═══
{
  const rules = forwardingRules(['old.example', 'www.old.example', 'new.example', 'www.new.example', 'not a name', 'OLD.example'], 'new.example').split('\n');
  ok('each kept name goes to the main one, path kept, on http and https', rules.length === 4 && rules[0] === 'https://old.example/* https://new.example/:splat 301!' && rules[1] === 'http://old.example/* https://new.example/:splat 301!' && rules[2] === 'https://www.old.example/* https://new.example/:splat 301!', JSON.stringify(rules));
  ok('the main name and its www. twin are never forwarded (the host does that), junk is dropped, repeats once', !rules.some((l) => /^https?:\/\/(www\.)?new\.example\//.test(l)) && !rules.some((l) => /not a name/.test(l)));
  ok('a www. main name keeps its bare twin too', forwardingRules(['example.com', 'old.example'], 'www.example.com').split('\n').length === 2);
  ok('no main name, no rules', forwardingRules(['old.example'], null) === '' && forwardingRules([], 'new.example') === '');
  const file = withForwarding('/menu /food 301\n', ['old.example'], 'new.example');
  ok('the rules go on top, before the site’s own redirects', file.split('\n')[1] === 'https://old.example/* https://new.example/:splat 301!' && file.trim().endsWith('/menu /food 301') && file.indexOf('old.example') < file.indexOf('/menu'));
  ok('nothing to forward leaves the file alone', withForwarding('/menu /food 301\n', [], 'new.example') === '/menu /food 301\n');
}

// ═══ the client's email records ═══
{
  const saved = { domain: 'bistro.example', mx: ['10 mx1.mail.example'], saved_at: '2026-11-01T00:00:00Z', gone_alerted_at: null };
  ok('the first look keeps a picture, says nothing', (() => { const w = mailWatch(null, 'bistro.example', ['10 MX1.mail.example'], NOW); return !w.alert && w.next.mx[0] === '10 mx1.mail.example'; })());
  ok('…a domain with no email keeps nothing', mailWatch(null, 'bistro.example', [], NOW).next === null);
  ok('the same records: nothing to write', (() => { const w = mailWatch(saved, 'bistro.example', ['10 mx1.mail.example'], NOW); return !w.alert && w.next === null; })());
  ok('changed on purpose (a new mail company): the new picture, no alarm', (() => { const w = mailWatch(saved, 'bistro.example', ['1 smtp.google.example'], NOW); return !w.alert && w.next.mx[0] === '1 smtp.google.example'; })());
  ok('vanished: told once, and marked', (() => { const w = mailWatch(saved, 'bistro.example', [], NOW); return w.alert && w.next.gone_alerted_at === NOW && w.next.mx[0] === '10 mx1.mail.example'; })());
  ok('…not told again the next day', (() => { const w = mailWatch({ ...saved, gone_alerted_at: NOW }, 'bistro.example', [], NOW); return !w.alert && w.next === null; })());
  ok('…and when they come back the watch starts over', (() => { const w = mailWatch({ ...saved, gone_alerted_at: NOW }, 'bistro.example', ['10 mx1.mail.example'], NOW); return !w.alert && w.next.gone_alerted_at === null; })());
  ok('a picture of another domain is replaced, not compared', (() => { const w = mailWatch(saved, 'other.example', [], NOW); return !w.alert && w.next === null; })());
}

// ═══ the sheet's recent changes ═══
ok('recent changes in the owner’s words, three at most', domainChanges([
  { summary: 'Changed domain from old.example to new.example (old.example forwards)', actor_kind: 'operator', created_at: '2026-11-10T10:00:00Z' },
  { summary: 'Attached domain old.example', actor_kind: 'client', created_at: '2026-10-01T10:00:00Z' },
  { summary: 'Something', actor_kind: 'system', created_at: '2026-09-01T10:00:00Z' },
  { summary: 'Older', actor_kind: 'client', created_at: '2026-08-01T10:00:00Z' },
]).map((c) => c.words).join(' | ') === 'Changed domain from old.example to new.example (old.example forwards), by your studio | Attached domain old.example, by someone on your account | Something, automatically');

// ═══ the routes and the daily check, against stubs ═══
let w;
function world(over = {}) {
  w = { netlify: [], aliases: [], dns: { 'bistro.example': { MX: ['10 mx1.mail.example'] } }, dnsStatus: 0, others: [], patches: [], events: [], history: [], mails: [], reserved: null, reservedWrites: [], ownerEmail: 'owner@bistro.example', studioSite: 'studio1', ...over };
}
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
const TYPE = { A: 1, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };
const siteJson = (custom) => ({ id: 'nf1', name: 'bistro', default_domain: 'presence-abc.netlify.app', custom_domain: custom, domain_aliases: w.aliases, state: 'current', ssl_url: null });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); w.mails.push({ to: Array.isArray(b.to) ? b.to.join(',') : String(b.to), subject: b.subject, html: b.html }); return reply({ id: 'em' }); }
  if (u.hostname === 'dns.google') {
    const n = u.searchParams.get('name'), t = u.searchParams.get('type');
    if (w.dnsStatus !== 0) return reply({ Status: w.dnsStatus });
    return reply({ Status: 0, Answer: ((w.dns[n] || {})[t] || []).map((d) => ({ name: n + '.', type: TYPE[t], data: d + '.' })) });
  }
  if (u.hostname === 'api.netlify.com') {
    if (u.pathname.endsWith('/ssl')) return method === 'POST' ? reply({}) : reply({ state: 'issued', domains: [], expires_at: '2027-02-01T00:00:00Z' });
    if (method === 'PATCH') { const b = JSON.parse(init.body); w.netlify.push(b); if ('domain_aliases' in b) w.aliases = b.domain_aliases; return reply(siteJson('custom_domain' in b ? b.custom_domain : null)); }
    return reply(siteJson(null));
  }
  if (u.hostname === 'rdap.org') return reply({}, 404);
  if (u.hostname !== 'stub.local') return reply('<h1>page</h1>', 200, { Server: 'Netlify' });
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (table === 'presence_sites' && method === 'GET' && q.includes('custom_domain=in.')) return reply(w.others);
  if (table === 'presence_sites' && method === 'PATCH') { w.patches.push(JSON.parse(init.body)); return reply([]); }
  if (table === 'presence_sites' && method === 'GET') return reply([]);
  if (table === 'presence_change_events' && method === 'POST') { w.events.push(JSON.parse(init.body)); return reply([]); }
  if (table === 'presence_change_events') return reply(w.history);
  if (table === 'clients') return reply(w.ownerEmail ? [{ email: w.ownerEmail }] : []);
  if (table === 'presence_service_links') return reply(w.studioSite ? [{ agency_site_id: w.studioSite }] : []);
  if (table === 'presence_identity') return reply([{ business_name: 'Bright Studio', email: 'eric@studio.example' }]);
  if (table === 'presence_sales_templates' && method === 'GET') return reply(w.reserved ? [{ id: 'rt1', body: JSON.stringify(w.reserved) }] : []);
  if (table === 'presence_sales_templates' && method === 'PATCH') { if (w.reserved) { w.reserved = JSON.parse(JSON.parse(init.body).body); w.reservedWrites.push(w.reserved); return reply([{ id: 'rt1' }]); } return reply([]); }
  if (table === 'presence_sales_templates' && method === 'POST') { const b = JSON.parse(init.body); w.reserved = JSON.parse(b.body); w.reservedWrites.push(w.reserved); return reply([{ id: 'rt1', ...b }], 201); }
  return reply([]);
};
const quiet = async (fn) => { const e = console.error, x = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = x; console.log = l; } };
const jsonOf = async (res) => ({ status: res.status, body: await res.json() });
const SITE = (custom) => ({ id: 'site1', client_id: 'c1', status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', custom_domain: custom, netlify_site_id: 'nf1', edition: 'presence' });
const req = (method, body) => new Request('http://stub.local/functions/v1/presence/foundations/domain', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const OWNER = { kind: 'client', userId: 'u1', email: 'owner@bistro.example' };
const STUDIO = { kind: 'client', userId: 'u2', email: 'eric@studio.example', scope: { site_id: 'site1', name: 'Bistro Nine' } };

// attach
world();
{
  const r = await quiet(async () => jsonOf(await handleDomain(req('POST', { domain: 'bistro.example' }), 'POST', SITE(null), STUDIO, {})));
  ok('attach: the domain is set, and no extra names are touched', r.status === 200 && w.netlify.length === 1 && w.netlify[0].custom_domain === 'bistro.example', JSON.stringify(w.netlify));
  ok('attach: the history says so', w.events.some((e) => e.summary === 'Attached domain bistro.example' && e.action === 'create'));
  ok('attach: the email records are pictured, to say so if they vanish', w.reservedWrites.length === 1 && w.reservedWrites[0].domain === 'bistro.example' && w.reservedWrites[0].mx.join() === '10 mx1.mail.example');
  ok('attach: the owner and the studio are both told, by the studio’s hand', w.mails.length === 2 && w.mails.every((m) => m.subject === 'bistro.example was connected to your website') && w.mails.some((m) => m.to === 'owner@bistro.example') && w.mails.some((m) => m.to === 'eric@studio.example') && /by your studio/.test(w.mails[0].html), JSON.stringify(w.mails.map((m) => [m.to, m.subject])));
}
// a name already on another of our sites
world({ others: [{ id: 'site9', custom_domain: 'www.bistro.example' }] });
{
  const r = await quiet(async () => jsonOf(await handleDomain(req('POST', { domain: 'bistro.example' }), 'POST', SITE(null), OWNER, {})));
  ok('taken here: said plainly, nothing set at the host', r.status === 409 && r.body.error === 'taken_here' && /already connected to another website here/.test(r.body.message) && w.netlify.length === 0);
  ok('taken here: the studio is told, the owner isn’t emailed about it', w.mails.length === 1 && w.mails[0].to === 'eric@studio.example' && /already connected to another website/.test(w.mails[0].subject));
}
world({ others: [{ id: 'site1', custom_domain: 'bistro.example' }] });
ok('its own row is not "another site"', (await quiet(async () => jsonOf(await handleDomain(req('POST', { domain: 'bistro.example' }), 'POST', SITE(null), OWNER, {})))).status === 200);
// change, keeping the old one
world();
{
  const r = await quiet(async () => jsonOf(await handleDomain(req('POST', { domain: 'new.example', keep_old: true }), 'POST', SITE('old.example'), OWNER, {})));
  ok('change, keeping the old: the new one is main and the old one and its www. stay on the site', r.status === 200 && w.netlify[0].custom_domain === 'new.example' && JSON.stringify(w.netlify[1]) === JSON.stringify({ domain_aliases: ['old.example', 'www.old.example'] }) && r.body.data.forwarding === 'old.example', JSON.stringify(w.netlify));
  ok('change: the history says from, to, and that it forwards', w.events.some((e) => e.summary === 'Changed domain from old.example to new.example (old.example forwards)' && e.action === 'update'));
  ok('change: the owner reads that the old one keeps working', w.mails.some((m) => m.to === 'owner@bistro.example' && m.subject === 'Your website’s address is changing to new.example' && /old\.example keeps working/.test(m.html) && /by owner@bistro\.example/.test(m.html)));
}
world({ aliases: ['ancient.example'] });
{
  await quiet(async () => handleDomain(req('POST', { domain: 'new.example' }), 'POST', SITE('old.example'), OWNER, {}));
  ok('change without keeping: the old name goes, earlier kept names stay as they were', w.netlify.length === 1 && w.aliases.join() === 'ancient.example');
}
world({ aliases: ['old.example', 'www.old.example'] });
{
  await quiet(async () => handleDomain(req('POST', { domain: 'old.example', keep_old: true }), 'POST', SITE('new.example'), OWNER, {}));
  ok('changing back to a kept name: it stops being an extra, and the one it replaces is kept instead', w.aliases.join() === 'new.example,www.new.example', JSON.stringify(w.aliases));
}
// remove
world({ aliases: ['old.example'] });
{
  const none = await quiet(async () => jsonOf(await handleDomain(req('DELETE'), 'DELETE', SITE('bistro.example'), OWNER, {})));
  ok('remove with no name typed: refused, nothing changed', none.status === 400 && none.body.error === 'confirm_needed' && /type bistro\.example exactly/.test(none.body.message) && w.netlify.length === 0 && w.patches.length === 0);
  const wrong = await quiet(async () => jsonOf(await handleDomain(req('DELETE', { confirm: 'bistro.exampel' }), 'DELETE', SITE('bistro.example'), OWNER, {})));
  ok('remove with a different name: refused', wrong.status === 400 && w.netlify.length === 0);
  const right = await quiet(async () => jsonOf(await handleDomain(req('DELETE', { confirm: ' https://Bistro.Example/ ' }), 'DELETE', SITE('bistro.example'), OWNER, {})));
  ok('remove with the name typed (any case, an address pasted): done, and kept names cleared', right.status === 200 && w.netlify[0].custom_domain === null && JSON.stringify(w.netlify[1]) === JSON.stringify({ domain_aliases: [] }) && w.patches.some((p) => p.custom_domain === null), JSON.stringify(w.netlify));
  ok('remove: the owner and the studio are told, with the built-in address', w.mails.length === 2 && w.mails.every((m) => m.subject === 'bistro.example was removed from your website') && /presence-abc\.netlify\.app/.test(w.mails[0].html));
}
// the sheet's recent changes
world({ history: [{ summary: 'Attached domain bistro.example', actor_kind: 'operator', created_at: '2026-11-01T10:00:00Z' }] });
{
  const r = await quiet(async () => jsonOf(await handleDomain(req('GET'), 'GET', SITE(null), OWNER, {})));
  ok('the sheet reads who changed the domain, and when', Array.isArray(r.body.data.changes) && r.body.data.changes[0].words === 'Attached domain bistro.example, by your studio', JSON.stringify(r.body.data.changes));
}
// the daily check watches the email records
const CHECK = { id: 'site1', client_id: 'c1', custom_domain: 'bistro.example', netlify_site_id: null, edition: 'monitor', cert_pending_since: null };
world({ dns: { 'bistro.example': { MX: [] } }, reserved: { domain: 'bistro.example', mx: ['10 mx1.mail.example'], saved_at: '2026-11-01T00:00:00Z', gone_alerted_at: null } });
{
  await quiet(() => checkOneDomain(CHECK, NOW));
  ok('vanished email records: the owner and the studio are told, with what to put back', w.mails.length === 2 && w.mails.every((m) => m.subject === 'Email for bistro.example may have stopped arriving' && /MX 10 mx1\.mail\.example/.test(m.html)), JSON.stringify(w.mails.map((m) => [m.to, m.subject])));
  ok('…and it is marked, so tomorrow is quiet', w.reserved.gone_alerted_at === NOW);
  w.mails = [];
  await quiet(() => checkOneDomain(CHECK, NOW));
  ok('…tomorrow is quiet', w.mails.length === 0);
}
world({ dnsStatus: 2, reserved: { domain: 'bistro.example', mx: ['10 mx1.mail.example'], saved_at: '2026-11-01T00:00:00Z', gone_alerted_at: null } });
{
  await quiet(() => checkOneDomain(CHECK, NOW));
  ok('a lookup that failed is never "the records are gone"', w.mails.length === 0 && w.reservedWrites.length === 0);
}
world({ reserved: null });
{
  await quiet(() => checkOneDomain(CHECK, NOW));
  ok('a domain attached before this: the first check takes the picture, quietly', w.mails.length === 0 && w.reservedWrites.length === 1 && w.reserved.mx.join() === '10 mx1.mail.example');
}

// ═══ the wiring ═══
{
  const pub = read('supabase/functions/presence/routes/publish.ts');
  const at = (s) => pub.indexOf(s);
  ok('publishing puts the forwarding rules on top of _redirects, from the host’s own list, before the deploy', at('withForwarding(') > 0 && at('getSite(site.netlify_site_id)') > 0 && at('withForwarding(') < at('const dep = await deployFileMap('));
  const page = read('presence.html');
  ok('the sheet asks for the domain typed back before removing it', /askText\("Remove " \+ dstat\.custom_domain/.test(page) && /api\("DELETE", "\/foundations\/domain", \{ confirm \}\)/.test(page));
  ok('the sheet can change the domain, keeping the old one working by default', /function askDomainChange\(old\)/.test(page) && /cb\.checked = true/.test(page) && /keep_old: ans\.keepOld/.test(page));
  ok('the steps protect the email records, and the card shows recent changes', /Leave anything marked MX or Mail alone/.test(page) && /ch\.dataset\.changes = "domain"/.test(page));
  ok('the reserved name for the email picture is listed', /domainMail: '__domain_mail__'/.test(read('supabase/functions/presence/lib/reserved_store.ts')));
}

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
