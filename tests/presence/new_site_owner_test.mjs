// ── + New site, then Invite the owner (builder list item 135, Nov 2026 review) ──
// File 05, finding 1: a studio could not start a client's site without emailing the
// client. Now "+ New site" on Sites makes a site from a business name and, if picked,
// a starter kit, with nobody emailed and nobody given a login; the card says "No
// owner yet" and Invite the owner is the separate, later step. This suite pins:
//   · the pure rules: who counts as an owner, who can edit, the card's no_owner;
//   · the routes, driven through the real handleAgency() against an in-memory
//     PostgREST plus stand-ins for sign-in (GoTrue), hosting (Netlify) and email
//     (Resend) — nothing leaves the machine: what POST /agency/sites makes (and what
//     it never does), the kit, the database step, and Invite the owner's refusals,
//     its writes and its one email;
//   · the wiring: migration 0152 and its production pack, the page, ⌘K.
//   deno run --allow-read --allow-env tests/presence/new_site_owner_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('NETLIFY_AUTH_TOKEN', 'netlify-test');
Deno.env.set('RESEND_KEY', 're_test');
const { hasOwner, teamOf, buildSites } = await import('../../supabase/functions/presence/agency/sites.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const NOW = '2026-11-10T12:00:00.000Z';

// ═══ 1. the pure rules ═══
{
  ok('owner: an email on the client row is an owner', hasOwner({ id: 'c', email: 'pat@shop.example' }));
  ok('owner: a contact email, or a linked contact (how a sign-in finds its client), is one too', hasOwner({ id: 'c', email: null, contact_email: 'pat@shop.example' }) && hasOwner({ id: 'c', email: null, contact_id: 'k1' }));
  ok('owner: a client made with + New site has none (no email, no contact)', !hasOwner({ id: 'c', name: 'Juniper Floral', email: null, contact_email: null, contact_id: null }) && !hasOwner({ id: 'c', email: '  ' }));
  ok('owner: nothing read is not "no owner" either way', hasOwner(null) === false && hasOwner(undefined) === false);
  const studio = [{ email: 'eric@studio.example', role: 'owner' }];
  const none = teamOf({ studio, seats: [], owner: { id: 'c', name: 'Juniper Floral', email: null }, portalClient: false, me: 'eric@studio.example' });
  ok('who can edit: an owner nobody has invited isn\'t listed (they have no sign-in)', none.length === 1 && none[0].side === 'studio');
  const some = teamOf({ studio, seats: [], owner: { id: 'c', name: 'Pat', email: 'pat@shop.example' }, portalClient: false, me: '' });
  ok('who can edit: an owner with a sign-in still is', some.some((m) => m.side === 'client' && m.role === 'Owner'));
  const row = (owners) => buildSites({ portfolio: [{ site_id: 's', name: 'n', edition: 'presence', status: 'ready', tags: [], domain: null, domain_registrar: null, domain_expires_at: null, last_published_at: null, last_change_at: null, unpublished_changes: false, billing_issue: false }],
    extras: [{ id: 's', client_id: 'c' }], plans: [], seats: [], owners, portalSites: [], studio: [], me: '', opened: {}, pins: [], nowIso: NOW })[0];
  ok('card: no_owner when the client was read and has no owner', row([{ id: 'c', name: 'n', email: null }]).no_owner === true);
  ok('card: …false when it has one, and false when the client couldn\'t be read (never said without knowing)', row([{ id: 'c', name: 'n', email: 'pat@shop.example' }]).no_owner === false && row([]).no_owner === false);
}

// ═══ 2. the routes ═══
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', OTHER_AG = 'aaaaaaaa-0000-4000-8000-000000000002';
const ME = '11111111-1111-4111-8111-111111111111', RO = '33333333-3333-4333-8333-333333333333';
const UID = '99999999-0000-4000-8000-000000000009';
const S1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', OWN = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', STRANGER = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const C1 = 'c1000000-0000-4000-8000-000000000001', CO = 'c5000000-0000-4000-8000-000000000005';
const KIT = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd', THEIR_KIT = 'bcdebcde-bcde-4cde-8cde-bcdebcdebcde';
let T, writes, outside, opts;
function reset(o = {}) {
  opts = { clientsNeedEmail: false, authExists: false, loseOwnerRace: false, ...o };
  T = {
    presence_agency_members: [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active', user_id: UID }, { id: RO, agency_id: AG, email: 'ro@studio.example', role: 'readonly', status: 'active' }],
    presence_agency_clients: [{ site_id: S1, agency_id: AG, status: 'active', tags: [], owner_email: 'owner@bistro.example', assigned: [], notes: '', onboarded_at: NOW }],
    presence_sites: [
      { id: S1, client_id: C1, edition: 'presence', status: 'live', last_published_at: '2026-10-20T00:00:00Z', custom_domain: 'bistro.example', netlify_site_id: 'nf-1', template_slug: 'business-classic', template_version: '1.0.0' },
      { id: OWN, client_id: CO, edition: 'presence', status: 'live', last_published_at: '2026-09-01T00:00:00Z', custom_domain: 'mystudio.example', netlify_site_id: 'nf-own', template_slug: 'business-classic', template_version: '1.0.0' },
      { id: STRANGER, client_id: 'c-x', edition: 'presence', status: 'live', template_slug: 'business-classic', template_version: '1.0.0' },
    ],
    clients: [{ id: C1, name: 'Bistro Nine', email: 'owner@bistro.example', contact_email: 'owner@bistro.example' }, { id: CO, name: 'Bright Studio', email: 'eric@studio.example' }],
    presence_starter_kits: [
      { id: KIT, agency_id: AG, name: 'Florist starter', payload: { industry_key: 'florist', template_slug: 'business-classic', category_order: ['Bouquets'], offerings: [{ name: 'Weekly bouquet', category: 'Bouquets', description: 'Fresh each Monday', price_text: '$40', sort_order: 0 }], faqs: [{ question: 'Do you deliver?', answer: 'Yes, in town.', sort_order: 0 }], voice: { tone_notes: 'Warm', preferred_vocabulary: '', never_claim: '' }, theme_tokens: { accent: '#7a2e5e' } } },
      { id: THEIR_KIT, agency_id: OTHER_AG, name: 'Not yours', payload: {} },
    ],
  };
  writes = []; outside = [];
}
function match(r, k, v) {
  const val = (x) => decodeURIComponent(x).replace(/^"(.*)"$/, '$1');
  if (v.startsWith('eq.')) return String(r[k]) === val(v.slice(3));
  if (v.startsWith('neq.')) return String(r[k]) !== val(v.slice(4));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  if (v === 'is.true') return r[k] === true;
  if (v === 'is.false') return r[k] === false;
  return true;
}
const CTRL = ['select', 'limit', 'order', 'on_conflict'];
const anyOf = (r, v) => decodeURIComponent(v).slice(1, -1).split(',').some((alt) => { const [col, op, ...rest] = alt.split('.'); return match(r, col, `${op}.${encodeURIComponent(rest.join('.'))}`); });
function rowsFor(table, params) {
  let rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || (k === 'or' ? anyOf(r, v) : match(r, k, v))));
  const lim = Number(params.get('limit')); if (lim) rows = rows.slice(0, lim);
  return rows;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const reply = (b, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  // the world outside the database: sign-in, hosting, email
  if (u.host === 'api.netlify.com') {
    outside.push({ to: 'netlify', method, path: u.pathname, body });
    const name = body?.name || u.pathname.split('/').pop();
    return reply({ id: 'nf-new', name, default_domain: `${name}.netlify.app`, state: 'ready' }, method === 'POST' ? 201 : 200);
  }
  if (u.host === 'api.resend.com') { outside.push({ to: 'resend', method, body }); return reply({ id: 'em-1' }); }
  if (u.pathname.startsWith('/auth/v1/')) {
    outside.push({ to: 'auth', method, path: u.pathname, body });
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') return opts.authExists ? reply({ msg: 'A user with this email address has already been registered' }, 422) : reply({ id: crypto.randomUUID(), email: body.email }, 200);
    if (u.pathname === '/auth/v1/admin/generate_link') return reply({ action_link: 'http://stub.local/magic-link' });
    return reply({}, 200);
  }
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  const auth = String((init.headers || {}).Authorization || '');
  // asUser (lib/site.ts resolveSite): the studio's sign-in owns OWN; any other caller owns nothing
  if (method === 'GET' && table === 'presence_sites' && /jwt-studio/.test(auth)) return reply(T.presence_sites.filter((s) => s.id === OWN));
  if (method === 'GET' && /jwt-/.test(auth)) return reply([]);
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  writes.push({ table, method, body, query: u.search });
  if (method === 'POST' && table === 'clients' && opts.clientsNeedEmail && !(body && body.email)) {
    return reply({ code: '23502', message: 'null value in column "email" of relation "clients" violates not-null constraint' }, 400);
  }
  if (method === 'PATCH') {
    if (table === 'clients' && opts.loseOwnerRace) return reply([]);   // someone invited them a moment earlier
    const hit = rowsFor(table, u.searchParams); hit.forEach((r) => Object.assign(r, body)); return reply(hit);
  }
  if (method === 'DELETE') { const hit = rowsFor(table, u.searchParams); T[table] = (T[table] || []).filter((r) => !hit.includes(r)); return reply(hit); }
  if (method === 'POST') {
    const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: crypto.randomUUID(), created_at: NOW, ...r }));
    (T[table] = T[table] || []).push(...rows);
    return reply(rows, 201);
  }
  return reply([]);
};
const asMember = (over = {}) => ({ agency_id: AG, member_id: ME, email: 'eric@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const PRINCIPAL = { kind: 'client', userId: UID, email: 'eric@studio.example' };
async function call(member, method, route, body, { jwt = 'jwt-studio' } = {}) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt } });
  const res = await handleAgency(req, route.split('?')[0], method, member, PRINCIPAL, {});
  return { status: res.status, body: await res.json() };
}
// the invitation email is sent without waiting on it: wait until what's expected has arrived (at most 2s),
// not a fixed 30ms, so a busy machine can't count the mail before it lands
const settle = async (arrived = () => true) => { await new Promise((r) => setTimeout(r, 30)); for (let i = 0; i < 100 && !arrived(); i++) await new Promise((r) => setTimeout(r, 20)); };

// ── POST /agency/sites: the refusals make nothing ──
{
  reset();
  ok('new site: a view-only member is refused', (await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'POST', '/agency/sites', { business_name: 'Juniper Floral' })).status === 403);
  const blank = await call(asMember(), 'POST', '/agency/sites', { business_name: '   ' });
  ok('new site: a business name is the one thing it needs', blank.status === 400 && /Name the business/.test(blank.body.message));
  ok('new site: another studio\'s kit (or a made-up one) is not found', (await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral', kit_id: THEIR_KIT })).status === 404 && (await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral', kit_id: 'nope' })).status === 404);
  ok('new site: at the plan\'s client limit, it says so', (await call(asMember({ client_limit: 1 }), 'POST', '/agency/sites', { business_name: 'Juniper Floral' })).body.error === 'client_limit');
  ok('new site: the refusals wrote nothing and reached nobody', writes.length === 0 && outside.length === 0);
}

// ── before migration 0152: the database refuses an empty email, and the page is told plainly ──
{
  reset({ clientsNeedEmail: true });
  const r = await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral' });
  ok('new site: before the database step, a plain 503 that names it', r.status === 503 && r.body.error === 'needs_database_step' && /one database step/.test(r.body.message));
  ok('new site: …and nothing else was made (no site, no hosting, no portfolio row)', !writes.some((w) => w.table !== 'clients') && !outside.length);
}

// ── POST /agency/sites: the site, made with nobody emailed ──
let MADE;
{
  reset();
  const r = await call(asMember(), 'POST', '/agency/sites', { business_name: '  Juniper   Floral Co. ' });
  MADE = r.body.data || {};
  ok('new site: 201 with the new site and client, the name tidied', r.status === 201 && /^[0-9a-f-]{36}$/.test(MADE.site_id) && /^[0-9a-f-]{36}$/.test(MADE.client_id) && MADE.name === 'Juniper Floral Co.' && MADE.kit === null);
  const client = T.clients.find((c) => c.id === MADE.client_id);
  ok('new site: the client record has the business name and NO email or contact (no owner yet)', client && client.name === 'Juniper Floral Co.' && client.email == null && client.contact_email == null && client.contact_id == null);
  const site = T.presence_sites.find((s) => s.id === MADE.site_id);
  ok('new site: a hosted website on the client, made the one way every site is (status ready, its own address)', site && site.client_id === MADE.client_id && site.edition === 'presence' && site.status === 'ready' && site.netlify_site_id === 'nf-new');
  ok('new site: a website plan, active', T.presence_entitlements.some((e) => e.client_id === MADE.client_id && e.plan === 'presence' && e.status === 'active'));
  const link = T.presence_agency_clients.find((l) => l.site_id === MADE.site_id);
  ok('new site: it joins the studio\'s portfolio with no owner email (so Sites, Home and the doors into it work)', link && link.agency_id === AG && link.status === 'active' && link.owner_email === '');
  ok('new site: nobody gets a sign-in and nobody is emailed', !outside.some((o) => o.to === 'auth' || o.to === 'resend'));
  ok('new site: not a customer yet — no project, no portal link, no contact', !writes.some((w) => ['presence_projects', 'presence_service_links', 'presence_customer_agency', 'presence_contacts', 'contacts'].includes(w.table)));
  const list = await call(asMember(), 'GET', '/agency/sites');
  const card = (list.body.data || []).find((x) => x.site_id === MADE.site_id);
  ok('Sites: the new card says No owner yet and lists only the studio as able to edit', card && card.no_owner === true && card.state === 'not_live' && card.team.every((m) => m.side === 'studio'));
  ok('Sites: a site with an owner doesn\'t; can_create rides along for the owner role', (list.body.data || []).find((x) => x.site_id === S1).no_owner === false && list.body.can_create === true);
  const ro = await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'GET', '/agency/sites');
  ok('Sites: a view-only member isn\'t offered + New site', ro.body.can_create === false);
}

// ── POST /agency/sites with a starter kit ──
{
  reset();
  const r = await call(asMember(), 'POST', '/agency/sites', { business_name: 'Willow Florist', kit_id: KIT });
  const d = r.body.data || {};
  ok('new site + kit: 201 and the kit says what it brought', r.status === 201 && d.kit && d.kit.id === KIT && d.kit.name === 'Florist starter' && d.kit.applied.offerings === 1 && d.kit.applied.faqs === 1 && d.kit.applied.voice === true && d.kit.applied.colors === true);
  ok('new site + kit: the services and FAQs land on the NEW site only', (T.presence_offerings || []).every((o) => o.site_id === d.site_id) && (T.presence_offerings || []).length === 1 && (T.presence_faqs || []).every((f) => f.site_id === d.site_id));
  ok('new site + kit: its history says where it started', (T.presence_change_events || []).some((e) => e.site_id === d.site_id && /Started from the “Florist starter” starter kit/.test(e.summary || '')));
  ok('new site + kit: still nobody emailed', !outside.some((o) => o.to === 'resend' || o.to === 'auth'));
}

// ── POST /agency/sites/:id/invite: the refusals ──
{
  reset();
  const made = (await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.' })).body.data;
  writes = []; outside = [];
  const inv = (id, b, m = asMember()) => call(m, 'POST', `/agency/sites/${id}/invite`, b);
  ok('invite: a view-only member is refused', (await inv(made.site_id, { email: 'june@juniper.example' }, asMember({ member_id: RO, role: 'readonly' }))).status === 403);
  ok('invite: an email is needed, and a crafted one is refused before anything is read', (await inv(made.site_id, {})).status === 422 && (await inv(made.site_id, { email: 'x@y.co,id.not.is.null' })).status === 422);
  ok('invite: another studio\'s site is not found', (await inv(STRANGER, { email: 'june@juniper.example' })).status === 404);
  ok('invite: a site that already has an owner says so', (await inv(S1, { email: 'june@juniper.example' })).body.error === 'has_owner');
  const taken = await inv(made.site_id, { email: 'owner@bistro.example' });
  ok('invite: an email that already belongs to an account is refused, never attached', taken.status === 409 && taken.body.error === 'account_exists' && !outside.some((o) => o.to === 'auth'));
  ok('invite: the refusals wrote nothing and emailed nobody', writes.length === 0 && !outside.length);
  reset({ authExists: true });
  const m2 = (await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.' })).body.data;
  writes = []; outside = [];
  const signsIn = await inv(m2.site_id, { email: 'june@juniper.example' });
  ok('invite: someone who already signs in with that email is refused too', signsIn.status === 409 && signsIn.body.error === 'account_exists' && writes.length === 0 && !outside.some((o) => o.to === 'resend'));
}

// ── a second invitation landing first: ours is undone, nothing lingers ──
{
  reset({ loseOwnerRace: true });
  const made = (await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.' })).body.data;
  writes = []; outside = [];
  const r = await call(asMember(), 'POST', `/agency/sites/${made.site_id}/invite`, { email: 'june@juniper.example' });
  ok('invite race: the loser hears "already has an owner"', r.status === 409 && r.body.error === 'has_owner');
  ok('invite race: its sign-in and contact were taken back, and no email went out', outside.some((o) => o.to === 'auth' && o.method === 'DELETE') && writes.some((w) => w.table === 'contacts' && w.method === 'DELETE') && !(T.contacts || []).length && !outside.some((o) => o.to === 'resend'));
}

// ── POST /agency/sites/:id/invite: the owner gets a sign-in and becomes a customer ──
{
  reset();
  const made = (await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.' })).body.data;
  writes = []; outside = [];
  const r = await call(asMember(), 'POST', `/agency/sites/${made.site_id}/invite`, { email: ' June@Juniper.example ', name: 'June Park' });
  await settle(() => outside.some((o) => o.to === 'resend'));
  ok('invite: 200, with the address it went to', r.status === 200 && r.body.data.email === 'june@juniper.example' && r.body.data.invited === true);
  const user = outside.find((o) => o.to === 'auth' && o.path === '/auth/v1/admin/users' && o.method === 'POST');
  ok('invite: one sign-in is made for that address', !!user && user.body.email === 'june@juniper.example');
  const contact = (T.contacts || [])[0];
  const client = T.clients.find((c) => c.id === made.client_id);
  ok('invite: the client record gets the email and the person behind the sign-in (how their portal finds them)', contact && contact.name === 'June Park' && contact.auth_user_id && client.email === 'june@juniper.example' && client.contact_email === 'june@juniper.example' && client.contact_id === contact.id);
  ok('invite: they become the studio\'s customer — a project and a portal link on the studio\'s site', (T.presence_projects || []).some((p) => p.site_id === OWN && p.client_id === made.client_id) && (T.presence_service_links || []).some((l) => l.agency_site_id === OWN && l.customer_client_id === made.client_id && l.customer_site_id === made.site_id && l.status === 'active'));
  ok('invite: the person is in the studio\'s contacts, linked to the customer', (T.presence_contacts || []).some((c) => c.site_id === OWN && c.email === 'june@juniper.example' && c.client_id === made.client_id));
  ok('invite: the portfolio row names the owner now', T.presence_agency_clients.find((l) => l.site_id === made.site_id).owner_email === 'june@juniper.example');
  const mail = outside.filter((o) => o.to === 'resend');
  ok('invite: exactly one email, to them, with their sign-in link', mail.length === 1 && [].concat(mail[0].body.to).join(',') === 'june@juniper.example' && /magic-link/.test(mail[0].body.html || ''));
  ok('invite: the studio\'s history says who was invited', (T.presence_change_events || []).some((e) => e.site_id === OWN && /Invited the owner of Juniper Floral Co\./.test(e.summary || '')));
  ok('invite: the site itself is untouched (nothing published, nothing changed)', !writes.some((w) => w.table === 'presence_sites' || w.table === 'presence_publishes'));
  const again = await call(asMember(), 'POST', `/agency/sites/${made.site_id}/invite`, { email: 'other@juniper.example' });
  ok('invite: a second invitation is refused — the site has its owner', again.status === 409 && again.body.error === 'has_owner');
  const list = await call(asMember(), 'GET', '/agency/sites');
  ok('Sites: the card no longer says No owner yet', (list.body.data || []).find((x) => x.site_id === made.site_id).no_owner === false);
}

// ═══ 3. the wiring ═══
{
  const mig = read('supabase/migrations/0152_site_without_owner.sql'), pack = read('docs/presence/APPLY-0152-prod.sql');
  ok('0152: the migration and its production pack both let a client\'s email be empty', [mig, pack].every((x) => x.includes('alter table public.clients alter column email drop not null;')));
  const fn = (x) => x.slice(x.indexOf('create or replace function public.my_client_ids()'), x.indexOf('$$;') + 3);
  ok('0152: both give my_client_ids() the same body, which never matches an empty address', fn(mig).length > 200 && fn(mig) === fn(pack) && /coalesce\(auth\.jwt\(\) ->> 'email', ''\) <> ''/.test(fn(mig)) && /security definer/.test(fn(mig)));
  ok('0152: the contact link is still the first way in', /cl\.contact_id in \(\s*select co\.id from public\.contacts co where co\.auth_user_id = auth\.uid\(\)\s*\)/.test(fn(mig)));
  ok('0152: a rollback note, and the pack ends with its checks', /-- rollback:/.test(mig) && /-- check: select is_nullable/.test(pack));
  const page = read('sites.html');
  ok('page: + New site opens the New site box (it used to send you to Home\'s Add a customer)', !/href="\/agency\.html#add"/.test(page) && /id="newDlg"/.test(page) && /\['newSiteBtn','newSiteEmpty'\]\.forEach\(id=>\{const b=\$\(id\);if\(b\)b\.addEventListener\('click',openNewSite\);\}\)/.test(page));
  const box = page.slice(page.indexOf('<dialog id="newDlg"'), page.indexOf('</dialog>', page.indexOf('<dialog id="newDlg"')));
  ok('page: the New site box asks for a business name and nothing else — no email', /id="new-biz"/.test(box) && !/type="email"/.test(box) && /Nobody is emailed until you invite the owner/.test(box));
  ok('page: it makes the site with POST /agency/sites, and invites with /agency/sites/:id/invite', /apiSend\('POST','\/agency\/sites',\{business_name,kit_id:kit_id\|\|undefined\}\)/.test(page) && /'\/agency\/sites\/'\+encodeURIComponent\(s\.site_id\)\+'\/invite'/.test(page));
  ok('page: the card, the ⋯ menu and the table each say No owner yet', /<b>No owner yet<\/b>Nobody has been emailed\./.test(page) && /data-invite="\$\{esc\(s\.site_id\)\}">Invite the owner<\/button>`:''\}/.test(page) && /\$\{s\.no_owner\?' · No owner yet':''\}/.test(page));
  ok('page: #new opens the box once the page knows you may make one', /function openNewFromHash\(\)\{\s*if\(location\.hash!=='#new'\)return;/.test(page) && /render\(\);\s*openNewFromHash\(\);/.test(page));
  const nav = read('supabase/functions/presence/lib/navigation.ts');
  ok('⌘K: "New site" opens it, as a search-only entry under Sites', /hid\('new_site', 'New site', '\/sites\.html#new'/.test(nav));
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('one provisioner: New site uses Add a customer\'s own account path (no email = a studio-managed workspace)', /export async function provisionCustomerAccount\(/.test(sales) && /provisionCustomerAccount\(\{ email: '', businessName: name, plan: 'presence'/.test(read('supabase/functions/presence/agency/sites.ts')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
