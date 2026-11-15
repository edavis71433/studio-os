// ── + New site's gallery, the Templates tab and the site count (builder item 198) ──
// File 06, findings 43 and 44. + New site asks what kind of business it is and starts on
// one of the eight built-in designs, and the Templates tab lists them; the plan's limit
// is shown as "8 of 25 sites", the Trash doesn't count, and every door that adds a site
// follows the same rule. This suite pins:
//   · the gallery's data (lib/design_gallery.ts): every built-in design has its words and
//     its picture, every kind is one the site's words know, and each kind's three
//     suggestions are real designs;
//   · the rule (lib/site_room.ts), pure;
//   · the routes, through the real handleAgency(): GET /agency/designs, the count on
//     GET /agency/sites, what POST /agency/sites saves for the kind and the look, the
//     limit at + New site, Add to your list and Restore, and the sales doors' wiring.
//   deno run --allow-read --allow-env tests/presence/new_site_gallery_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('NETLIFY_AUTH_TOKEN', 'netlify-test');
Deno.env.set('RESEND_KEY', 're_test');
const G = await import('../../supabase/functions/presence/lib/design_gallery.ts');
const R = await import('../../supabase/functions/presence/lib/site_room.ts');
const { listTemplates } = await import('../../supabase/functions/presence/lib/render.ts');
const { isKnownIndustry } = await import('../../supabase/functions/presence/lib/industry_vocab.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const exists = (p) => { try { Deno.statSync(new URL('../../' + p, import.meta.url)); return true; } catch { return false; } };
const NOW = '2026-11-15T12:00:00.000Z';

// ═══ 1. the gallery's data ═══
{
  const tpls = listTemplates();
  ok('there are eight built-in designs', tpls.length === 8, tpls.map((t) => t.slug).join(', '));
  ok('every built-in design has its words (a line and who it suits)', tpls.every((t) => G.DESIGN_WORDS[t.slug]?.line && G.DESIGN_WORDS[t.slug]?.good_for), tpls.filter((t) => !G.DESIGN_WORDS[t.slug]).map((t) => t.slug).join(', '));
  ok('…and no words for a design that isn\'t there', Object.keys(G.DESIGN_WORDS).every((s) => tpls.some((t) => t.slug === s)));
  ok('every built-in design has its picture (thumbs/templates/<slug>.jpg)', tpls.every((t) => exists(`thumbs/templates/${t.slug}.jpg`)));
  const keys = G.galleryIndustryKeys();
  ok('every kind of business is one the site\'s words know (lib/industry_vocab.ts)', keys.every((k) => isKnownIndustry(k)), keys.filter((k) => !isKnownIndustry(k)).join(', '));
  ok('ten kinds, each its own key, each listing itself first under "More exactly"', G.BUSINESS_KINDS.length === 10 && new Set(G.BUSINESS_KINDS.map((k) => k.key)).size === 10 && G.BUSINESS_KINDS.every((k) => k.exact[0].key === k.key));
  ok('no closer kind sits under two kinds', keys.length === G.BUSINESS_KINDS.reduce((n, k) => n + k.exact.length, 0));
  const fams = Object.keys(G.SUGGESTED);
  ok('every family has three different suggestions, all real designs', fams.length === 10 && fams.every((f) => G.SUGGESTED[f].length === 3 && new Set(G.SUGGESTED[f]).size === 3 && G.SUGGESTED[f].every((s) => tpls.some((t) => t.slug === s))));
  ok('every family has its badge', fams.every((f) => typeof G.FAMILY_BADGE[f] === 'string' && G.FAMILY_BADGE[f].length > 4));
  ok('a florist is a shop, a plumber is home services, and anything unknown is "something else"', G.familyOf('florist') === 'retail' && G.familyOf('plumber') === 'home' && G.familyOf('who-knows') === 'other' && G.familyOf(null) === 'other');
  ok('a restaurant sees Restaurant Classic first; a plumber sees Harbor first', G.suggestedFor('bakery')[0] === 'restaurant-classic' && G.suggestedFor('plumber')[0] === 'harbor');
  ok('"Something else" keeps Atelier first, the look every new site had before', G.SUGGESTED.other[0] === 'atelier' && /'atelier'/.test(read('supabase/migrations/0110_atelier_default.sql')));
  const p = G.galleryPayload(tpls);
  ok('the payload: eight designs with name, words and picture; the kinds; the suggestions', p.designs.length === 8 && p.designs.every((d) => d.name && d.line && d.picture === `/thumbs/templates/${d.slug}.jpg`) && p.kinds.length === 10 && p.default_kind === 'generic');
}

// ═══ 2. the rule, pure ═══
{
  const r1 = R.roomOf(['active', 'archived', 'trashed', 'trashed'], 25);
  ok('the count: every site but the ones in the Trash (archived ones count)', r1.used === 2 && r1.limit === 25 && r1.full === false);
  ok('full at the limit, not before', R.roomOf(['active', 'active'], 2).full === true && R.roomOf(['active', 'trashed'], 2).full === false);
  ok('a missing or nonsense limit is no limit (never full), as the old check had it; a real 0 is full', R.roomOf(['active'], 'x').full === false && R.roomOf(['active'], undefined).full === false && R.roomOf(['active'], null).limit === null && R.roomOf([], 0).full === true);
  const list = [{ site_id: 'a', status: 'active' }, { site_id: 't', status: 'trashed' }];
  ok('a site already in the list adds nothing; a new one, or one back from the Trash, adds one', !R.addsToRoom(list, 'a') && R.addsToRoom(list, 'n') && R.addsToRoom(list, 't'));
  ok('each door says it in plain words, naming the limit and the Trash', /^Your plan covers 25 sites, and all 25 are in use\. Sites in the Trash don’t count/.test(R.roomFullMessage(25, 'new'))
    && /Move one you no longer need to the Trash on Sites, then add them\. Nothing was made\./.test(R.roomFullMessage(25, 'add'))
    && R.roomFullMessage(25, 'convert').length < 160 && /bring this one back/.test(R.roomFullMessage(25, 'restore')) && /covers 1 site, and all 1 is in use/.test(R.roomFullMessage(1, 'new')));
}

// ═══ the harness: the real handleAgency() against an in-memory PostgREST (from new_site_owner_test.mjs) ═══
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
let MAIL_DOWN = false;   // builder item 192: the mail service refuses the email
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
  if (u.host === 'api.resend.com') { outside.push({ to: 'resend', method, body }); return MAIL_DOWN ? reply({ message: 'refused' }, 422) : reply({ id: 'em-1' }); }
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

// ═══ 3. the routes ═══
const TRASHED = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
{
  reset();
  const d = await call(asMember(), 'GET', '/agency/designs');
  ok('GET /agency/designs: the eight designs and the ten kinds', d.status === 200 && d.body.data.designs.length === 8 && d.body.data.kinds.length === 10 && d.body.data.suggested.retail[0] === 'atelier');
  ok('GET /agency/designs: no writes, nothing outside', writes.length === 0 && outside.length === 0);
}
{
  reset();
  T.presence_agency_clients.push({ site_id: TRASHED, agency_id: AG, status: 'trashed', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: NOW, trashed_at: NOW });
  const s = await call(asMember({ client_limit: 2 }), 'GET', '/agency/sites');
  ok('GET /agency/sites: the count leaves out the Trash ("1 of 2 sites")', s.status === 200 && s.body.room && s.body.room.used === 1 && s.body.room.limit === 2 && s.body.room.full === false, JSON.stringify(s.body.room));
  const made = await call(asMember({ client_limit: 2 }), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.' });
  ok('+ New site: a studio at 2 sites with one in the Trash may still make one', made.status === 201);
  const full = await call(asMember({ client_limit: 2 }), 'POST', '/agency/sites', { business_name: 'One Too Many' });
  ok('+ New site: once the plan is full it says so plainly, 409 client_limit, with the count', full.status === 409 && full.body.error === 'client_limit' && /Your plan covers 2 sites, and all 2 are in use\./.test(full.body.message) && full.body.room?.used === 2);
  const back = await call(asMember({ client_limit: 2 }), 'POST', `/agency/sites/${TRASHED}/restore`);
  ok('Restore: a site can\'t come back from the Trash past the limit, and stays in it', back.status === 409 && back.body.error === 'client_limit' && /bring this one back/.test(back.body.message) && T.presence_agency_clients.find((l) => l.site_id === TRASHED).status === 'trashed');
  const again = await call(asMember({ client_limit: 3 }), 'POST', `/agency/sites/${TRASHED}/restore`);
  ok('Restore: with room, it comes back as before', again.status === 200 && T.presence_agency_clients.find((l) => l.site_id === TRASHED).status === 'active');
  const add = await call(asMember({ client_limit: 3 }), 'POST', '/agency/clients', { site_id: STRANGER });
  ok('Add to your list: the same rule (409 client_limit when full)', add.status === 409 && add.body.error === 'client_limit');
}
{
  reset();
  const r = await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.', template_slug: 'meadow', industry_key: 'florist' });
  const made = r.body.data || {};
  ok('+ New site: 201, and it says the look and the kind were saved', r.status === 201 && made.look && made.look.slug === 'meadow' && made.look.name === 'Meadow' && made.look.applied === true && made.industry && made.industry.key === 'florist' && made.industry.applied === true, JSON.stringify({ look: made.look, industry: made.industry }));
  const site = T.presence_sites.find((s) => s.id === made.site_id);
  ok('+ New site: the site wears the picked design, at its newest version', site && site.template_slug === 'meadow' && /^\d+\.\d+\.\d+$/.test(String(site.template_version)));
  const set = (T.presence_settings || []).find((x) => x.site_id === made.site_id);
  ok('+ New site: the kind is the site\'s own setting (Settings → Kind of business)', set && set.industry_key === 'florist');
  ok('+ New site: the history says which design it started with', writes.some((w) => w.table === 'presence_change_events' && /Started with the Meadow design/.test(JSON.stringify(w.body))));
  ok('+ New site: still nobody emailed and no sign-in made', !outside.some((o) => o.to === 'auth' || o.to === 'resend'));
}
{
  reset();
  const bad = await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.', template_slug: 'not-a-design' });
  ok('+ New site: a design that isn\'t built in is refused before anything is made', bad.status === 400 && bad.body.error === 'bad_template');
  const badKind = await call(asMember(), 'POST', '/agency/sites', { business_name: 'Juniper Floral Co.', industry_key: 'dragons' });
  ok('+ New site: a kind of business that isn\'t on the list is refused too', badKind.status === 400 && badKind.body.error === 'bad_industry');
  ok('+ New site: the refusals wrote nothing and reached nobody', writes.length === 0 && outside.length === 0);
  const plain = await call(asMember(), 'POST', '/agency/sites', { business_name: 'Just A Name' });
  ok('+ New site: a name alone still works, with no look or kind written', plain.status === 201 && plain.body.data.look === null && plain.body.data.industry === null && !(T.presence_settings || []).length);
  const kitAndLook = await call(asMember(), 'POST', '/agency/sites', { business_name: 'Kit And Look', kit_id: KIT, template_slug: 'slate' });
  const ks = T.presence_sites.find((s) => s.id === kitAndLook.body.data?.site_id);
  ok('+ New site: a starter kit adds its setup on top of the picked design (it never changes the look)', kitAndLook.status === 201 && kitAndLook.body.data.look?.applied === true && ks?.template_slug === 'slate' && kitAndLook.body.data.kit?.id === KIT);
}

// ═══ 4. the sales doors: Add a customer and Convert follow the same rule ═══
{
  const sales = read('supabase/functions/presence/routes/sales.ts');
  const add = sales.slice(sales.indexOf('export async function handleSalesAddCustomer'));
  ok('Add a customer: a full plan is refused before anything is made (before the account path)', add.indexOf('const fullAt = await fullPlanFor(principal, email);') > 0 && add.indexOf('const fullAt = await fullPlanFor(principal, email);') < add.indexOf('provisionCustomerAccount('));
  const conv = sales.slice(sales.indexOf('export async function handleSalesConvert'), sales.indexOf('export async function handleSalesConvert') + 9000);
  ok('Convert: the same, and the deal is let go (unclaimed) when it says so', /const fullAt = await fullPlanFor\(principal, email\);\n  if \(fullAt\) \{ await unclaim\(\); return json\(\{ error: 'client_limit'/.test(conv) && conv.indexOf('fullPlanFor(') < conv.indexOf('provisionCustomerAccount('));
  ok('the sales rule: only a studio has a list; an email already in it adds nothing', /async function fullPlanFor\(principal: Principal, email: string\)/.test(sales) && /if \(!am\) return null;/.test(sales) && /addsToRoom\(list, String\(x\.id\)\)/.test(sales));
  const routes = read('supabase/functions/presence/agency/routes.ts');
  ok('the usage count follows the rule too (the Trash doesn\'t count)', /clients: \{ used: room\.used,/.test(routes));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ NEW SITE GALLERY + SITE COUNT (item 198): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
