// ── "Ask for access" on a domain (builder list item 222) ─────────────────────
// Nov 12 review, file 04, findings 2 and 4: a studio got the client's registrar password, or
// did it on a call; and the "get a domain" guide never said the first year is the cheap one.
// This suite pins:
//   · the pure rules (lib/domain_access.ts): each company's steps, found by any of its names;
//     the companies the sheet offers; what an invite field holds; the email the client gets,
//     in plain words, with what the access allows and that they keep their password; the ask
//     as kept, asked again, ticked off and undone;
//   · the routes, through the real handleAgency() against an in-memory PostgREST and a
//     stand-in for the email service: preview writes nothing; Ask sends from the studio, to
//     the client, and keeps the ask; who may; the studio's own domain; no domain; no email;
//     a company that can't share; It arrived, Undo, Not needed; the list's pill; a changed
//     domain starts again;
//   · the client's "I need to get one" guide warns about the renewal price.
//   deno run --allow-read --allow-env --allow-net tests/presence/domain_access_222_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
const DA = await import('../../supabase/functions/presence/lib/domain_access.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const { RESERVED_NAMES } = await import('../../supabase/functions/presence/lib/reserved_store.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ═══ 1. the pure rules ═══
{
  ok('guide: found by any of a company\'s names', DA.accessGuide('NameCheap, Inc.').company === 'Namecheap' && DA.accessGuide('GoDaddy.com, LLC').company === 'GoDaddy' && DA.accessGuide('Cloudflare').company === 'Cloudflare' && DA.accessGuide('Google Domains').company === 'Squarespace Domains');
  ok('guide: a company we have no steps for gets the general one', DA.accessGuide('Registrar Nobody Knows').company === DA.OTHER_COMPANY && DA.accessGuide('').company === DA.OTHER_COMPANY && DA.accessGuide(DA.OTHER_COMPANY) === DA.GENERIC_GUIDE);
  ok('guide: Namecheap\'s exact path, read from its own help page: only "Manage Host Records"', DA.accessGuide('Namecheap').steps.join(' ').includes('Sharing & Transfer') && DA.accessGuide('Namecheap').steps.some((s) => s.includes('tick only “Manage Host Records”')) && DA.accessGuide('Namecheap').exact === true);
  ok('guide: a company with no records-only level says what else it allows', DA.accessGuide('Squarespace Domains').exact === false && /move the domain/.test(DA.accessGuide('Squarespace Domains').caveat) && /buy with your saved card/.test(DA.accessGuide('Porkbun').caveat));
  ok('guide: Hover, IONOS and Route 53 can\'t share access from the client\'s side: send the records instead', ['Hover', 'IONOS', 'Amazon Route 53'].every((c) => DA.accessGuide(c).shareable === false && DA.accessGuide(c).steps.length === 0 && /records/.test(DA.accessGuide(c).studio_note)));
  ok('guide: every one that can share has steps, a note for the studio, and a sign-in page', DA.ACCESS_GUIDES.filter((g) => g.shareable).every((g) => g.steps.length >= 2 && g.studio_note && /^https:\/\//.test(g.sign_in)));
  ok('guide: Porkbun invites a username, the rest an email', DA.accessGuide('Porkbun').asks === 'username' && DA.ACCESS_GUIDES.filter((g) => g.company !== 'Porkbun').every((g) => g.asks === 'email'));
  const cs = DA.accessCompanies('NameCheap, Inc.');
  ok('companies: the one found first, every other, then "Another company"', cs[0] === 'Namecheap' && cs[cs.length - 1] === DA.OTHER_COMPANY && cs.filter((c) => c === 'Namecheap').length === 1 && cs.length === DA.ACCESS_GUIDES.length + 1);
  ok('companies: nothing found starts with the list', DA.accessCompanies('')[0] === 'GoDaddy' && DA.accessCompanies('Unknown Ltd')[0] === 'GoDaddy');
  ok('invite: an email, lower-cased; a username for Porkbun', DA.cleanInvite(' Hello@DavisDigital.Studio ', 'email') === 'hello@davisdigital.studio' && DA.cleanInvite('not an email', 'email') === null && DA.cleanInvite('<x@y.zz>', 'email') === null && DA.cleanInvite('davis_studio', 'username') === 'davis_studio' && DA.cleanInvite('a b', 'username') === null);
  const m = DA.accessEmail({ domain: 'brightbakery.com', company: 'Namecheap', invite: 'hello@davisdigital.studio', studio: 'Davis Digital Studio', firstName: 'Dana', note: 'Thanks, Dana!' });
  ok('email: the subject names the studio and the domain', m.subject === 'Give Davis Digital Studio access to brightbakery.com’s records');
  ok('email: hello by name, why, and the company\'s steps with the domain and the address filled in', m.html.includes('<p>Hi Dana,</p>') && m.html.includes('To finish connecting brightbakery.com to your new website, we need to change its DNS records at Namecheap.') && m.steps[1] === 'Press Manage next to brightbakery.com, then open Sharing & Transfer.' && m.steps[2].includes('hello@davisdigital.studio') && !/\{(domain|invite|studio)\}/.test(m.html));
  ok('email: they keep their password and their account, and can take the access away', m.html.includes('You keep your password, your account and the right to renew or move the domain. You can take our access away any time, on the same Namecheap page.'));
  ok('email: a sign-in link to the company, their own line, and the studio\'s name', m.html.includes('href="https://ap.www.namecheap.com/domains/list/"') && m.html.includes('<p>Thanks, Dana!</p>') && m.html.trim().endsWith('<p>Davis Digital Studio</p>'));
  ok('email: the text copy holds the same, numbered', m.text.startsWith('Hi Dana,\n') && m.text.includes('\n2. Press Manage next to brightbakery.com') && m.text.includes('Sign in to Namecheap: https://ap.www.namecheap.com/domains/list/'));
  const c = DA.accessEmail({ domain: 'harbor.example', company: 'Squarespace Domains', invite: 'a@b.cc', studio: 'S', connected: true });
  ok('email: a connected domain is looked after, not finished; no name says Hello; the caveat is said', c.html.includes('<p>Hello,</p>') && c.html.includes('So we can look after harbor.example’s DNS records for you') && c.html.includes('could also move the domain'));
  const gen = DA.accessEmail({ domain: 'x.example', company: 'Registrar Nobody Knows', invite: 'a@b.cc', studio: 'S' });
  ok('email: the general one names no company and offers the records instead', !/ at Another company/.test(gen.html) && gen.html.includes('send you the records to add yourself instead') && !gen.html.includes('href='));
  const evil = DA.accessEmail({ domain: 'x.example', company: 'Namecheap', invite: 'a@b.cc', studio: '<b>S</b>', note: '<script>x</script>' });
  ok('email: what the studio typed is escaped', !evil.html.includes('<script>') && evil.html.includes('&lt;script&gt;') && evil.html.includes('&lt;b&gt;S&lt;/b&gt;'));
  ok('first name: the first word of a person\'s name, never junk', DA.firstWord('Dana Ruiz') === 'Dana' && DA.firstWord('  ') === null && DA.firstWord('<x>') === null && DA.firstWord('J') === null);
  const now = '2026-11-15T12:00:00.000Z';
  const a1 = DA.askedAccess(null, { domain: 'BrightBakery.com', company: 'Namecheap', invite: 'a@b.cc', to: 'o@b.cc', by: 'eric@studio.example', now });
  const a2 = DA.askedAccess(a1, { domain: 'brightbakery.com', company: 'Namecheap', invite: 'a@b.cc', to: 'o@b.cc', by: 'pat@studio.example', now: '2026-11-18T09:00:00.000Z' });
  ok('ask: kept with when, by whom and to whom; asking again keeps the first day and counts', a1.status === 'asked' && a1.asks === 1 && a1.domain === 'brightbakery.com' && a2.asks === 2 && a2.asked_at === now && a2.last_asked_at === '2026-11-18T09:00:00.000Z' && a2.asked_by === 'eric@studio.example');
  const t1 = DA.tickAccess(a2, { domain: 'brightbakery.com', arrived: true, by: 'eric@studio.example', now });
  ok('tick: it arrived, and Undo goes back to waiting', t1.status === 'arrived' && t1.arrived_by === 'eric@studio.example' && DA.tickAccess(t1, { domain: 'brightbakery.com', arrived: false, by: 'x', now }).status === 'asked');
  ok('tick: "We already have it" without an ask, and its Undo leaves nothing', DA.tickAccess(null, { domain: 'a.example', arrived: true, by: 'x', now }).status === 'arrived' && DA.tickAccess(DA.tickAccess(null, { domain: 'a.example', arrived: true, by: 'x', now }), { domain: 'a.example', arrived: false, by: 'x', now }) === null);
  ok('kept: an ask for another domain (the site\'s domain changed) or a bad status is no ask', DA.normalizeAccess(a1, 'brightbakery.com').status === 'asked' && DA.normalizeAccess(a1, 'newname.com') === null && DA.normalizeAccess({ ...a1, status: 'maybe' }, 'brightbakery.com') === null && DA.normalizeAccess(null, 'x') === null && DA.normalizeAccess({}, 'x') === null);
  ok('pill: asked since the first ask, or arrived since the tick', JSON.stringify(DA.accessBadge(a2)) === JSON.stringify({ status: 'asked', since: now }) && DA.accessBadge(t1).status === 'arrived' && DA.accessBadge(null) === null);
}

// ═══ 2. the routes ═══
const AG = 'aaaaaaaa-0000-4000-8000-000000000222';
const ME = '11111111-1111-4111-8111-111111111222', RO = '33333333-3333-4333-8333-333333333222', UID = '99999999-0000-4000-8000-000000000222';
const S1 = '51000000-0000-4000-8000-000000000001', HOVER = '51000000-0000-4000-8000-000000000002', NOMAIL = '51000000-0000-4000-8000-000000000003', BARE = '51000000-0000-4000-8000-000000000004', OWN = '51000000-0000-4000-8000-0000000000aa', STRANGER = '51000000-0000-4000-8000-0000000000ff';
const C1 = 'c2220000-0000-4000-8000-000000000001', C2 = 'c2220000-0000-4000-8000-000000000002', C3 = 'c2220000-0000-4000-8000-000000000003', C4 = 'c2220000-0000-4000-8000-000000000004', CO = 'c2220000-0000-4000-8000-0000000000aa';
let T, writes, mails;
function reset() {
  const link = (site_id) => ({ site_id, agency_id: AG, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: '2026-01-01T00:00:00Z' });
  const site = (id, client, over = {}) => ({ id, client_id: client, edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: null, domain_registrar: null, domain_dns_host: null, domain_serving: null, netlify_site_id: 'nf-' + id.slice(-2), template_slug: 'business-classic', template_version: '1.0.0', created_at: '2026-01-01T00:00:00Z', ...over });
  T = {
    presence_agency_members: [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active', user_id: UID }, { id: RO, agency_id: AG, email: 'ro@studio.example', role: 'readonly', status: 'active' }],
    presence_agency_clients: [link(S1), link(HOVER), link(NOMAIL), link(BARE)],
    presence_sites: [
      site(S1, C1, { custom_domain: 'brightbakery.com', domain_registrar: 'NameCheap, Inc.' }),
      site(HOVER, C2, { custom_domain: 'harbor.example', domain_registrar: 'Hover' }),
      site(NOMAIL, C3, { custom_domain: 'quiet.example', domain_registrar: 'GoDaddy.com, LLC', domain_serving: 'latest' }),
      site(BARE, C4),
      site(OWN, CO, { custom_domain: 'mystudio.example', domain_registrar: 'Namecheap' }),
      site(STRANGER, 'c-x', { custom_domain: 'not-yours.example' }),
    ],
    clients: [{ id: C1, name: 'Bright Bakery', email: 'owner@brightbakery.com', contact_id: 'k1' }, { id: C2, name: 'Harbor', email: 'h@harbor.example' }, { id: C3, name: 'Quiet Co', email: null, contact_email: null }, { id: C4, name: 'Bare', email: 'b@bare.example' }],
    contacts: [{ id: 'k1', name: 'Dana Ruiz', email: 'owner@brightbakery.com' }],
    presence_identity: [{ site_id: OWN, business_name: 'Davis Digital Studio' }],
    presence_sales_templates: [], presence_change_events: [],
  };
  writes = []; mails = [];
}
function match(r, k, v) {
  const val = (x) => decodeURIComponent(x);
  if (v.startsWith('eq.')) return String(r[k]) === val(v.slice(3));
  if (v.startsWith('in.(')) return val(v.slice(4, -1)).split(',').includes(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  return true;
}
const CTRL = ['select', 'limit', 'order', 'on_conflict'];
const anyOf = (r, v) => v.slice(1, -1).split(',').some((alt) => { const [col, ...rest] = alt.split('.'); return match(r, col, rest.join('.')); });
function rowsFor(table, params) {
  let rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || (k === 'or' ? anyOf(r, v) : match(r, k, v))));
  if (params.get('order')) rows = rows.slice().reverse();   // newest first, as the reserved reads ask
  const lim = Number(params.get('limit')); if (lim) rows = rows.slice(0, lim);
  return rows;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.host === 'api.resend.com') { mails.push(JSON.parse(String(init.body))); return reply({ id: 'e' + mails.length }); }
  if (u.pathname.startsWith('/storage/')) return reply({});
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  const auth = String((init.headers || {}).Authorization || '');
  if (method === 'GET' && table === 'presence_sites' && /jwt-studio/.test(auth)) return reply(T.presence_sites.filter((s) => s.id === OWN));
  if (method === 'GET' && /jwt-/.test(auth)) return reply([]);
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  const body = init.body ? JSON.parse(init.body) : null;
  writes.push({ table, method, body, query: decodeURIComponent(u.search) });
  if (method === 'PATCH') { const hit = rowsFor(table, u.searchParams); hit.forEach((r) => Object.assign(r, body, { updated_at: new Date().toISOString() })); return reply(hit); }
  if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, ...r })); (T[table] = T[table] || []).push(...rows); return reply(rows, 201); }
  return reply([]);
};
const asMember = (over = {}) => ({ agency_id: AG, member_id: ME, email: 'eric@studio.example', role: 'owner', agency_name: 'Davis Digital Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const PRINCIPAL = { kind: 'client', userId: UID, email: 'eric@studio.example', tenantId: null, role: 'client', jwt: 'jwt-studio', requestId: 't' };
async function call(member, method, route, body) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-studio' } });
  const res = await handleAgency(req, route.split('?')[0], method, member, PRINCIPAL, {});
  return { status: res.status, body: await res.json() };
}
const kept = (siteId) => { const r = T.presence_sales_templates.filter((x) => x.site_id === siteId && x.name === RESERVED_NAMES.domainAccess).pop(); return r ? JSON.parse(r.body) : null; };
const ASK = { company: 'Namecheap', invite: 'hello@davisdigital.studio', note: 'Thanks, Dana!' };

{
  reset();
  const p = await call(asMember(), 'POST', `/agency/domains/${S1}/access`, { ...ASK, preview: true });
  ok('preview: the email the client would get, to whom, and nothing written or sent', p.status === 200 && p.body.data.to === 'owner@brightbakery.com' && p.body.data.to_name === 'Bright Bakery' && p.body.data.subject === 'Give Davis Digital Studio access to brightbakery.com’s records' && p.body.data.text.startsWith('Hi Dana,') && writes.length === 0 && mails.length === 0, JSON.stringify(p.body).slice(0, 200));
  ok('preview: the company\'s facts for the sheet', p.body.data.company === 'Namecheap' && p.body.data.exact === true && /7 days/.test(p.body.data.studio_note) && p.body.data.asks === 'email' && p.body.data.studio === 'Davis Digital Studio' && p.body.data.invite_ok === true);
  const blank = await call(asMember(), 'POST', `/agency/domains/${S1}/access`, { company: 'Porkbun', invite: '', preview: true });
  ok('preview: before an address is typed, the steps show where it goes, and Send waits', blank.status === 200 && blank.body.data.invite_ok === false && /username/.test(blank.body.data.invite_message) && blank.body.data.steps.some((s) => s.includes('[your Porkbun username]')) && writes.length === 0 && mails.length === 0);
  const d = await call(asMember(), 'GET', `/agency/domains/${S1}`);
  ok('panel: nothing asked yet, and the sheet\'s companies start with the one that keeps its records', d.status === 200 && d.body.data.access === null && d.body.data.access_companies[0] === 'Namecheap', JSON.stringify(d.body.data?.access_companies));
  ok('panel: the sheet invites the studio member\'s own address unless they type another', d.body.data.access_invite === 'eric@studio.example');
  const s = await call(asMember(), 'POST', `/agency/domains/${S1}/access`, ASK);
  ok('ask: sent, once, to the client', s.status === 200 && mails.length === 1 && mails[0].to === 'owner@brightbakery.com' && mails[0].subject === 'Give Davis Digital Studio access to brightbakery.com’s records', JSON.stringify(s.body).slice(0, 200));
  ok('ask: from the studio by name, with the steps and the password promise', /Davis Digital Studio/.test(String(mails[0].from)) && mails[0].html.includes('tick only “Manage Host Records”') && mails[0].html.includes('You keep your password'));
  ok('ask: kept on the client\'s site, and the answer says so', kept(S1)?.status === 'asked' && kept(S1).invite === 'hello@davisdigital.studio' && kept(S1).to === 'owner@brightbakery.com' && s.body.data.access.status === 'asked' && s.body.data.access.asks === 1);
  const ev = T.presence_change_events.find((e) => e.site_id === S1);
  ok('ask: the domain\'s history says the studio asked', ev && ev.entity_type === 'domain' && ev.summary === 'Asked the client for access to the records at Namecheap' && ev.actor_kind === 'operator', JSON.stringify(ev));
  const list = await call(asMember(), 'GET', '/agency/domains');
  const row = (list.body.data?.domains || []).find((x) => x.site_id === S1);
  ok('list: the row\'s pill says asked, since when; the studio\'s own domain carries none', row && row.access && row.access.status === 'asked' && !!row.access.since && (list.body.data.domains.find((x) => x.own) || {}).access === null, JSON.stringify(row?.access));
  const again = await call(asMember(), 'POST', `/agency/domains/${S1}/access`, ASK);
  ok('ask again: a second email, the same first day, counted', again.status === 200 && mails.length === 2 && kept(S1).asks === 2 && kept(S1).asked_at === s.body.data.access.asked_at);
  const arrived = await call(asMember(), 'PUT', `/agency/domains/${S1}/access`, { arrived: true });
  ok('It arrived: ticked off, by whom', arrived.status === 200 && arrived.body.data.access.status === 'arrived' && kept(S1).arrived_by === 'eric@studio.example' && T.presence_change_events.some((e) => e.site_id === S1 && e.summary === 'Access to the records arrived'));
  const undo = await call(asMember(), 'PUT', `/agency/domains/${S1}/access`, { arrived: false });
  ok('Undo: back to waiting', undo.status === 200 && undo.body.data.access.status === 'asked');
  const gone = await call(asMember(), 'DELETE', `/agency/domains/${S1}/access`);
  ok('Not needed: the ask is gone', gone.status === 200 && gone.body.data.access === null && (await call(asMember(), 'GET', `/agency/domains/${S1}`)).body.data.access === null);
  ok('It arrived: a yes or no is needed', (await call(asMember(), 'PUT', `/agency/domains/${S1}/access`, { arrived: 'yes' })).status === 400);
}
{
  reset();
  const n = () => writes.length + mails.length;
  ok('who: a view-only member can\'t ask, tick or clear', (await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'POST', `/agency/domains/${S1}/access`, ASK)).status === 403 && (await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'PUT', `/agency/domains/${S1}/access`, { arrived: true })).status === 403 && n() === 0);
  ok('the studio\'s own domain: no one to ask', (await call(asMember(), 'POST', `/agency/domains/${OWN}/access`, ASK)).body.error === 'own_domain' && n() === 0);
  ok('someone else\'s site is not yours', (await call(asMember(), 'POST', `/agency/domains/${STRANGER}/access`, ASK)).status === 404 && n() === 0);
  const hv = await call(asMember(), 'POST', `/agency/domains/${HOVER}/access`, { invite: 'hello@davisdigital.studio' });
  ok('a company that can\'t share (found from the record): says to send the records instead', hv.status === 422 && hv.body.error === 'cannot_share' && /Hover has no way to share access/.test(hv.body.message) && n() === 0);
  const nm = await call(asMember(), 'POST', `/agency/domains/${NOMAIL}/access`, { invite: 'hello@davisdigital.studio' });
  ok('no email on the client\'s record: says so, and copying the message is the way; nothing sent or kept', nm.status === 409 && nm.body.error === 'no_email' && /copy the message/.test(nm.body.message) && n() === 0);
  const pv = await call(asMember(), 'POST', `/agency/domains/${NOMAIL}/access`, { invite: 'hello@davisdigital.studio', preview: true });
  ok('…and its preview still gives the message to copy, for GoDaddy, as looking after a connected domain', pv.status === 200 && pv.body.data.to === '' && pv.body.data.company === 'GoDaddy' && /So we can look after quiet\.example’s DNS records/.test(pv.body.data.text));
  ok('a bad address is refused; Porkbun asks for a username', (await call(asMember(), 'POST', `/agency/domains/${S1}/access`, { company: 'Namecheap', invite: 'nope' })).body.error === 'bad_invite' && /username/.test((await call(asMember(), 'POST', `/agency/domains/${S1}/access`, { company: 'Porkbun', invite: 'a@b.cc' })).body.message) && n() === 0);
  ok('a site with no domain of its own has nothing to ask about', (await call(asMember(), 'POST', `/agency/domains/${BARE}/access`, ASK)).status === 404 || (await call(asMember(), 'POST', `/agency/domains/${BARE}/access`, ASK)).body.error === 'no_domain');
  await call(asMember(), 'POST', `/agency/domains/${S1}/access`, ASK);
  T.presence_sites.find((x) => x.id === S1).custom_domain = 'brightbakery.co';
  ok('a changed domain starts again: the old ask isn\'t this one\'s', (await call(asMember(), 'GET', `/agency/domains/${S1}`)).body.data.access === null);
}

// ═══ 3. the pages ═══
{
  const pres = read('presence.html');
  const need = pres.slice(pres.indexOf('needPanel.dataset.need = "domain";'), pres.indexOf('const BUY = ['));
  ok('"I need to get one": warns to check the renewal price before buying, before the buy line', /Check the renewal price before you buy/.test(need) && /The first year is often cheap/.test(need) && need.indexOf('renewal price') < need.indexOf('Buy it in your own name'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ASK FOR ACCESS (item 222): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
