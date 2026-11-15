// ── A Designer sees the website and nothing of the business (builder item 220) ──
// Wix's Website Designer "cannot access Inbox, contacts and other sensitive info"
// (Nov 12 review, file 02, finding 4). Here a client who wanted their nephew to fix the
// photos had to make him Staff, who reads every customer message. A Designer seat works
// on the website (its words, pages, styles and photos, the draft's versions and notes)
// and publishes only when their seat's switch says so. This proves, against the real
// code with a stubbed PostgREST, GoTrue and Resend (nothing leaves the process):
//   · the role table: what a Designer holds, and the seat's publish switch;
//   · the router, route by route: every route in index.ts after the site is known is
//     read here, and a Designer reaches exactly the decided list below, reads included;
//     a new route fails here until someone decides whether it is website work;
//   · the gate in index.ts sits with the reviewer's, before the write gate and any route;
//   · the write gate: publishing needs the switch, deleting, approving and settings never pass;
//   · Styles: colours and fonts, never custom code;
//   · their own screen: the context's role sentence, menu and landing, with no read of
//     the business behind the site;
//   · invites and role changes carry the switch, and the email says the role in one sentence;
//   · every role's sentence, and the migration that lets the role exist.
//
//   deno run --allow-read --allow-env --allow-net tests/presence/designer_role_test.mjs
for (const [k, v] of Object.entries({
  SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY',
  SITE_URL: 'https://studio.example', APP_URL: 'https://app.studio.example', RESEND_KEY: 're_test',
})) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const R = await import(`${P}/lib/site_roles.ts`);
const { SITE_ROLES, siteCan, capabilitiesOf, seatCan, seatCapabilities, seesSite, seesFullWorkspace, designerAllowed, SEAT_WORDS, publishWords, memberWriteNeeds, contentWriteNeeds } = R;
const { memberWriteGate, handlePortalContext, handleMemberAdd, handleMemberRole, handleMembersList, SEAT_ROLE_WORDS } = await import(`${P}/routes/workspace.ts`);
const { addSiteMember, changeSiteMemberRole, resolveMemberSite, listSiteMembers } = await import(`${P}/lib/workspace.ts`);
const { buildNav, landingFor } = await import(`${P}/lib/navigation.ts`);
const { visibleTo } = await import(`${P}/lib/visibility.ts`);
const { designAllowed, devModeAllowed, handleDevCustomizationPut } = await import(`${P}/routes/dev.ts`);
const { STUDIO_ROLE_WORDS, can } = await import(`${P}/agency/auth.ts`);
const { handleWebsiteTimeline, WEBSITE_CHANGE_TYPES } = await import(`${P}/routes/timeline.ts`);

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const quiet = (fn) => async (...a) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(...a); } finally { console.error = e; console.warn = w; } };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const ID = uuid('a'), SITE = uuid('1'), CLIENT = uuid('2');
const SITE_ROW = { id: SITE, client_id: CLIENT, status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'atelier', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const USERS = { 'jwt-lee': { id: uuid('3'), email: 'lee@pixel.example' }, 'jwt-owner': { id: uuid('4'), email: 'sam@maple.example' } };
const cors = {};

// ═══ 1. the role table and the seat ═══
{
  ok('roles: Designer is a site role', SITE_ROLES.includes('designer'));
  ok('roles: a Designer holds the website, editing, notes and styling, and nothing else', JSON.stringify(capabilitiesOf('designer')) === JSON.stringify(['view_site', 'edit', 'comment', 'design']));
  for (const cap of ['view_all', 'view_shared', 'approve', 'publish', 'connect', 'configure', 'delete', 'export', 'invite', 'use_developer_mode']) ok(`roles: a Designer's role never gives ${cap}`, !siteCan('designer', cap));
  ok('roles: a Designer sees the site but not the full workspace', seesSite('designer') && !seesFullWorkspace('designer'));
  ok('roles: a reviewer still sees neither', !seesSite('client_reviewer') && !seesFullWorkspace('client_reviewer'));
  ok('roles: the owner seat and a developer may restyle; staff and reviewers may not', siteCan('business_owner', 'design') && siteCan('developer', 'design') && !siteCan('business_staff', 'design') && !siteCan('client_reviewer', 'design'));
  ok('seat: a Designer publishes only when the seat says so', !seatCan({ role: 'designer' }, 'publish') && !seatCan({ role: 'designer', can_publish: false }, 'publish') && seatCan({ role: 'designer', can_publish: true }, 'publish'));
  ok('seat: the switch is never "truthy enough"', !seatCan({ role: 'designer', can_publish: 'true' }, 'publish') && !seatCan({ role: 'designer', can_publish: 1 }, 'publish'));
  ok('seat: every other role ignores the switch', seatCan({ role: 'business_staff', can_publish: false }, 'publish') && !seatCan({ role: 'client_reviewer', can_publish: true }, 'publish'));
  ok('seat: the switch gives publish and nothing more', JSON.stringify(seatCapabilities({ role: 'designer', can_publish: true })) === JSON.stringify(['view_site', 'edit', 'comment', 'design', 'publish']) && !seatCapabilities({ role: 'designer' }).includes('publish'));
  ok('seat: an unknown role holds nothing', seatCapabilities({ role: 'boss' }).length === 0 && !seatCan({ role: 'boss' }, 'edit'));
  for (const role of SITE_ROLES) ok(`words: ${role} has a name, a sentence and a "you" sentence`, !!SEAT_WORDS[role]?.name && /^Sees /.test(SEAT_WORDS[role].sees) && /^You /.test(SEAT_WORDS[role].you) && SEAT_ROLE_WORDS[role] === SEAT_WORDS[role].name);
  ok('words: the Designer\'s sentence names everything they never see', ['customers', 'contacts', 'deals', 'invoices', 'messages'].every((w) => SEAT_WORDS.designer.sees.toLowerCase().includes(w) && SEAT_WORDS.designer.you.toLowerCase().includes(w)));
  ok('words: who publishes, said both ways', /owner or the studio publishes/.test(publishWords({ role: 'designer' })) && /can publish/.test(publishWords({ role: 'designer', can_publish: true })) && publishWords({ role: 'business_staff' }) === '');
  for (const s of ['cms_pages', 'published', 'drafts', 'media', 'files', 'comments']) ok(`visibility: a Designer sees ${s}`, visibleTo('designer', s));
  for (const s of ['business_moments', 'approvals', 'messages', 'internal_notes', 'knowledge', 'growth', 'reports', 'connected']) ok(`visibility: a Designer never sees ${s}, shared or not`, !visibleTo('designer', s) && !visibleTo('designer', s, { shared: true }));
}

// ═══ 2. the router, route by route ═══
// Every route index.ts answers once the caller's site is known (the reviewer and Designer
// boundary sits there). Routes before it are the public ones, platform staff's, the
// studio's /agency and the account's /commerce, each holding its own door.
const DESIGNER_DECIDED = [
  'GET /portal/context',
  'GET /site', 'GET /site/templates',
  'GET /identity', 'PUT /identity', 'GET /location', 'PUT /location', 'GET /settings', 'PUT /settings', 'GET /brand/profile', 'PUT /brand/profile', 'GET /brand/studio',
  ...['offerings', 'testimonials', 'faqs', 'posts'].flatMap((c) => [`GET /${c}`, `POST /${c}`, `GET /${c}/:id`, `PUT /${c}/:id`, `PATCH /${c}/:id`]),
  'POST /posts/:id/publish', 'POST /posts/:id/unpublish',
  'GET /pages/ready', 'GET /pages/refs', 'GET /pages/deleted', 'POST /pages/duplicate', 'POST /pages/deleted/:id/restore',
  'GET /page-locks', 'POST /page-locks', 'GET /blocks/suggested', 'GET /content-tree',
  'GET /redirects', 'POST /redirects', 'GET /redirects/suggest',
  'GET /media', 'POST /media/upload-url', 'PUT /media/:id',
  'GET /assets', 'GET /assets/collections', 'GET /assets/health', 'GET /assets/match', 'GET /assets/trash', 'POST /assets/bulk', 'POST /assets/folders/move',
  'GET /assets/:id', 'PATCH /assets/:id', 'GET /assets/:id/download', 'GET /assets/:id/social', 'GET /assets/:id/cards',
  ...['replace', 'rollback', 'duplicate', 'suggest', 'remove-background', 'cutout', 'put-back'].map((a) => `POST /assets/:id/${a}`),   // item 218: put-back deletes nothing
  'GET /assets/cutout/:job',
  'GET /stock/search', 'POST /stock/import',
  'GET /content-library', 'POST /content-library', 'PUT /content-library/:id',
  'GET /dev/customization', 'PUT /dev/customization', 'GET /dev/brand-kit', 'PUT /dev/brand-kit', 'POST /dev/brand-kit/apply',
  'POST /writer/generate', 'POST /writer/rewrite', 'GET /writer/drafts', 'GET /writer/drafts/:id', 'POST /writer/drafts/:id/accept', 'POST /writer/drafts/:id/discard',
  'POST /editor/improve',
  'POST /review/run', 'POST /brand/review', 'GET /review/reports', 'GET /brand/reports', 'GET /review/reports/:id', 'GET /brand/reports/:id', 'POST /review/reports/:id/dismiss', 'POST /brand/reports/:id/dismiss',
  'GET /preview', 'GET /preview/status', 'GET /changes', 'GET /health', 'GET /website-timeline',
  'POST /preview/section', 'POST /preview/share-link', 'POST /preview/publish',
  'GET /publishes', 'GET /publishes/compare', 'GET /publishes/timewarp', 'GET /publishes/checkpoints', 'POST /publishes/checkpoints', 'POST /publishes/checkpoints/:id/restore',
  'POST /publishes/:id/label', 'PUT /publishes/stars', 'POST /restore-to-draft',
  'GET /launches', 'POST /launches', 'GET /launches/:id', 'POST /launches/:id/recapture', 'POST /launches/:id/cancel',
  'POST /publish', 'POST /restore', 'POST /preview/promote', 'GET /schedule', 'POST /schedule', 'POST /schedule/:id/cancel',
  'POST /launches/:id/schedule', 'POST /launches/:id/promote', 'POST /launches/:id/rollback',
  'GET /site/publish-lock',   // builder item 214: reading the lock; PUT stays the studio's
  'GET /comments', 'POST /comments', 'POST /comments/:id/resolve',
];
const JOB = 'abcdefghij.' + 'A'.repeat(32);
const fill = (name) => { const [m, p] = name.split(' '); return [m, p.replaceAll(':id', ID).replaceAll(':job', JOB)]; };
const normal = (p) => p.replaceAll(ID, ':id').replace(/^\/assets\/cutout\/[a-z0-9]{10,64}\.[A-Za-z0-9_-]{32}$/, '/assets/cutout/:job');

// Sample paths from the router's own text: its exact routes, and its patterns expanded
// into one path per alternative (an id is a uuid, a key a word, an optional part both ways).
function expand(src) {
  let i = 0;
  const cls = (c, n) => (/0-9a-f-/.test(c) && n === 36 ? ID : (/a-z/.test(c) ? 'a' : /A-Z/.test(c) ? 'A' : '1').repeat(Math.max(1, n)));
  function seq() {
    let outs = [''];
    while (i < src.length && src[i] !== ')' && src[i] !== '|') {
      let atom;
      const c = src[i];
      if (c === '(') { i++; if (src.startsWith('?:', i)) i += 2; atom = alt(); if (src[i] !== ')') throw new Error('unbalanced: ' + src); i++; }
      else if (c === '[') { const j = src.indexOf(']', i); const k = src.slice(i, j + 1); i = j + 1; let n = 1; if (src[i] === '{') { const e = src.indexOf('}', i); n = Number(src.slice(i + 1, e).split(',')[0]); i = e + 1; } else if (src[i] === '+') { i++; n = 6; } atom = [cls(k, n)]; }
      else if (c === '\\') { const e = src[i + 1]; i += 2; atom = [e === 'd' ? '1' : e === 'w' ? 'a' : e]; if (src[i] === '+') i++; }
      else { i++; atom = [c]; }
      if (src[i] === '?') { i++; atom = ['', ...atom]; }
      const next = []; for (const a of outs) for (const b of atom) next.push(a + b); outs = next.slice(0, 400);
    }
    return outs;
  }
  function alt() { const out = [...seq()]; while (src[i] === '|') { i++; out.push(...seq()); } return out; }
  return alt();
}
const idx = read('supabase/functions/presence/index.ts');
const gateAt = idx.indexOf("if (siteRole === 'designer' && !designerAllowed(route, method))");
const routerEnd = idx.indexOf('return json({ error: \'not_found\', message: `No route for ${method} ${route}.` }, 404, cors);');
const region = idx.slice(gateAt, routerEnd);
const SAMPLES = new Set();
for (const m of region.matchAll(/route === '([^']+)'/g)) SAMPLES.add(m[1]);
for (const m of region.matchAll(/route\.startsWith\('([^']+)'\)/g)) { SAMPLES.add(m[1]); SAMPLES.add(m[1] + '/' + ID); }
for (const m of region.matchAll(/(?:route\.match\(|^|[^\w.])\/\^((?:\\\/|[^/\n])+)\$\/(?:\.test\(route\)|\))/gm)) for (const p of expand(m[1])) if (p.startsWith('/')) SAMPLES.add(p);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
{
  ok('router: the region after the boundary was found and read', gateAt > 0 && routerEnd > gateAt && SAMPLES.size > 300, String(SAMPLES.size));
  const wrongYes = [], wrongNo = [];
  for (const p of SAMPLES) for (const m of METHODS) {
    const expected = DESIGNER_DECIDED.includes(`${m} ${normal(p)}`);
    const got = designerAllowed(p, m);
    if (got && !expected) wrongYes.push(`${m} ${p}`);
    if (!got && expected) wrongNo.push(`${m} ${p}`);
  }
  ok('router: no route outside the decided list lets a Designer in', wrongYes.length === 0, wrongYes.slice(0, 12).join(', '));
  ok('router: every decided route lets a Designer in', wrongNo.length === 0, wrongNo.slice(0, 12).join(', '));
  const routed = new Set([...SAMPLES].map(normal));
  const stale = DESIGNER_DECIDED.filter((name) => !routed.has(name.split(' ')[1]));
  ok('router: every decided route is a real route', stale.length === 0, stale.join(', '));
  ok('decided: nothing listed twice', new Set(DESIGNER_DECIDED).size === DESIGNER_DECIDED.length);
  for (const name of DESIGNER_DECIDED) { const [m, p] = fill(name); if (!designerAllowed(p, m)) ok(`decided: ${name} is let in`, false); }
  // the business, family by family: a sample of the router in each, all refused
  const FAMILIES = ['/sales', '/crm', '/contacts', '/customers', '/client/', '/projects', '/support', '/threads', '/inbox', '/forms', '/messages', '/notifications', '/moments',
    '/bookings', '/reviews', '/broadcasts', '/export', '/analytics', '/business-insights', '/report', '/visibility', '/search', '/connections', '/foundations', '/monitor',
    '/approvals', '/approve', '/handover', '/calendar', '/email', '/concierge', '/coach', '/knowledge', '/portal/feed', '/portal/members', '/portal/shares', '/portal/transfer',
    '/portal/studio-requests', '/site/offline', '/site/online', '/site/password', '/site/coming-soon', '/site/usable', '/site/template', '/dev/files', '/website-health', '/commerce'];
  for (const fam of FAMILIES) {
    const hits = [...SAMPLES].filter((p) => p === fam || p.startsWith(fam.endsWith('/') ? fam : fam + '/') || (fam.endsWith('/') && p.startsWith(fam)));
    const let_in = hits.flatMap((p) => METHODS.filter((m) => designerAllowed(p, m)).map((m) => `${m} ${p}`));
    ok(`business: a Designer reaches nothing under ${fam}${hits.length ? '' : ' (no route there today)'}`, let_in.length === 0, let_in.join(', '));
  }
  ok('business: the routes a client\'s customers write to are refused too', !designerAllowed(`/forms/inbox/${ID}`, 'POST') && !designerAllowed('/sales/contacts', 'GET') && !designerAllowed(`/sales/invoices/${ID}/send`, 'POST'));
  ok('code: no custom code, files or keys for a Designer', !designerAllowed('/dev/files', 'GET') && !designerAllowed('/site/template', 'PUT'));
  ok('Trash: a Designer may look in it and put a file back, never delete one for good', designerAllowed('/assets/trash', 'GET') && designerAllowed(`/assets/${ID}/put-back`, 'POST') && !designerAllowed(`/assets/${ID}/forever`, 'DELETE') && !designerAllowed(`/assets/${ID}`, 'DELETE') && !designerAllowed(`/media/${ID}`, 'DELETE'));
  ok('AI images: no Visual Studio for a Designer (keeping an image is an approval, and each costs money)', [...SAMPLES].filter((p) => p.startsWith('/visual')).every((p) => METHODS.every((m) => !designerAllowed(p, m))));
}

// ═══ 3. the boundary in index.ts ═══
{
  const at = (s) => idx.indexOf(s);
  const rev = at("if (siteRole === 'client_reviewer' && !reviewerAllowed(route, method))");
  ok('index: the Designer boundary sits beside the reviewer\'s, before the write gate and the router', rev > 0 && gateAt > rev && gateAt < at('if (principal.member && isWrite) {') && gateAt < at('// 5. router'));
  ok('index: it refuses with a 403 that says why, and returns', /if \(siteRole === 'designer' && !designerAllowed\(route, method\)\) \{\s*return json\(\{ error: 'forbidden', role: 'designer', message: 'That isn’t part of a Designer’s role\./.test(idx));
  ok('index: it reads the role the seat gave, the same one the reviewer check reads', /const siteRole = await resolveSiteRoleCached\(principal, jwt, site\.id\);\s*if \(siteRole === 'client_reviewer'/.test(idx));
  ok('index: designerAllowed comes from the one role table', idx.includes("import { designerAllowed } from './lib/site_roles.ts';"));
}

// ═══ 4. the write gate, for a Designer's seat ═══
{
  const req = (m, r, b) => new Request(`http://stub.local/functions/v1/presence${r}`, { method: m, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
  const gate = async (m, r, seat, b = {}) => memberWriteGate(req(m, r, b), r, m, seat, cors);
  const writes = DESIGNER_DECIDED.filter((n) => !n.startsWith('GET ')).map(fill);
  const needs = writes.map(([m, p]) => [m, p, contentWriteNeeds(p, m, p === '/settings' ? ['blocks'] : []) ?? memberWriteNeeds(p, m)]);
  const odd = needs.filter(([, , n]) => !['edit', 'comment', 'publish', 'open'].includes(n));
  ok('gate: every write a Designer reaches needs edit, comment, publish, or checks the role itself', odd.length === 0, odd.map((x) => x.join(' ')).join(', '));
  const opens = needs.filter(([, , n]) => n === 'open').map(([m, p]) => `${m} ${p}`);
  ok('gate: the open ones are the restyle routes alone, which ask designAllowed', JSON.stringify(opens.sort()) === JSON.stringify(['POST /dev/brand-kit/apply', 'PUT /dev/brand-kit', 'PUT /dev/customization']), opens.join(', '));
  const wrong = [];
  for (const [m, p, n] of needs) {
    const off = await gate(m, p, { site_id: SITE, role: 'designer' }, p === '/settings' ? { blocks: [] } : {});
    const on = await gate(m, p, { site_id: SITE, role: 'designer', can_publish: true }, p === '/settings' ? { blocks: [] } : {});
    if (n === 'publish' ? !(off?.status === 403 && on === null) : !(off === null && on === null)) wrong.push(`${m} ${p}`);
  }
  ok('gate: publishing passes only with the switch; the rest passes either way', wrong.length === 0, wrong.join(', '));
  const pub = await gate('POST', '/publish', { site_id: SITE, role: 'designer' });
  ok('gate: a Designer without the switch is told their work waits in the draft', pub?.status === 403 && /saved in the draft\. The owner or the studio publishes them/.test((await pub.json()).message));
  ok('gate: settings past the website\'s own fields stay closed', (await gate('PUT', '/settings', { site_id: SITE, role: 'designer' }, { google_site_verification: 'x' }))?.status === 403);
  ok('gate: deleting a photo, approving a file and DNS stay closed even if a route were let in', (await gate('DELETE', `/media/${ID}`, { site_id: SITE, role: 'designer', can_publish: true }))?.status === 403
    && (await gate('POST', `/assets/${ID}/status`, { site_id: SITE, role: 'designer', can_publish: true }))?.status === 403
    && (await gate('POST', '/foundations/domain', { site_id: SITE, role: 'designer', can_publish: true }))?.status === 403);
  const seat = { site_id: SITE, role: 'designer' };
  ok('gate: a website write is cleared for the seat\'s data path', await gate('PUT', '/identity', seat) === null && seat.cleared === true);
  ok('gate: the switch on staff\'s row changes nothing for staff', await gate('POST', '/publish', { site_id: SITE, role: 'business_staff', can_publish: false }) === null);
}

// ═══ 5. Styles: colours and fonts, never custom code ═══
let DB, reads, writes, emails, minted;
function reset(over = {}) {
  DB = {
    presence_sites: [{ ...SITE_ROW }],
    presence_identity: [{ site_id: SITE, business_name: 'Maple & Main Realty' }],
    presence_site_members: [
      { id: uuid('5'), site_id: SITE, email: 'lee@pixel.example', user_id: USERS['jwt-lee'].id, role: 'designer', status: 'active', can_publish: false, created_at: '2026-11-01T00:00:00Z' },
      { id: uuid('6'), site_id: SITE, email: 'dana@maple.example', user_id: null, role: 'business_staff', status: 'active', can_publish: false, created_at: '2026-10-01T00:00:00Z' },
    ],
    presence_dev_customizations: [{ site_id: SITE, theme_tokens: { accent: '#111111' }, custom_css: '.dev{color:red}', custom_html: '<p>dev</p>' }],
    clients: [{ id: CLIENT, name: 'Maple & Main Realty', email: 'sam@maple.example', contact_email: 'sam@maple.example', contact_id: null, deleted_at: null }],
    ...over,
  };
  reads = []; writes = []; emails = []; minted = [];
}
const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const eqs = (u) => Object.fromEntries([...u.searchParams.entries()].filter(([, v]) => /^(eq|neq|in)\./.test(v)).map(([k, v]) => [k, v]));
const keep = (row, filters) => Object.entries(filters).every(([k, v]) => v.startsWith('eq.') ? String(row[k]) === decodeURIComponent(v.slice(3)) : v.startsWith('neq.') ? String(row[k]) !== decodeURIComponent(v.slice(4)) : decodeURIComponent(v.slice(3)).replace(/^\(|\)$/g, '').split(',').includes(String(row[k])));
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const token = (new Headers(init.headers).get('Authorization') || '').replace(/^Bearer /, '');
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.hostname === 'api.resend.com') { emails.push(body); return reply({ id: 'e' + emails.length }); }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  if (u.pathname === '/auth/v1/admin/generate_link') { minted.push(body); return reply({ action_link: 'http://stub.local/verify' }); }
  if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  if (method === 'HEAD') { reads.push(table); return new Response(null, { status: 200, headers: { 'content-range': '*/0' } }); }
  if (method === 'GET') {
    reads.push(table);
    let rows = (DB[table] || []).filter((r) => keep(r, eqs(u)));
    const or = u.searchParams.get('or');
    if (or) { const ids = [...or.matchAll(/(user_id|email)\.eq\.([^,)]+)/g)].map((m) => [m[1], decodeURIComponent(m[2])]); rows = rows.filter((r) => ids.some(([k, v]) => String(r[k]) === v)); }
    return reply(rows);
  }
  writes.push({ table, method, body, query: u.search });
  if (table === 'presence_site_members' && method === 'POST') { const row = { id: uuid('9'), created_at: new Date().toISOString(), ...body }; DB[table].push(row); return reply([row], 201); }
  if (method === 'PATCH') { const rows = (DB[table] || []).filter((r) => keep(r, eqs(u))); rows.forEach((r) => Object.assign(r, body)); return reply(rows); }
  if (method === 'POST' && table === 'presence_dev_customizations') return reply([{ ...body }], 201);
  return reply([]);
};
{
  ok('styles: a Designer may restyle; Developer Mode stays a developer\'s', designAllowed('designer', 'client') && !devModeAllowed('designer', 'client'));
  ok('styles: staff and reviewers still may not', !designAllowed('business_staff', 'client') && !designAllowed('client_reviewer', 'client'));
  reset();
  const lee = { kind: 'client', userId: USERS['jwt-lee'].id, email: USERS['jwt-lee'].email, jwt: 'jwt-lee', role: 'client', tenantId: null, requestId: 't', member: { site_id: SITE, role: 'designer', can_publish: false } };
  const r = await quiet(() => handleDevCustomizationPut(new Request('http://stub.local/x', { method: 'PUT', body: JSON.stringify({ theme_tokens: { accent: '#6d3fd4' }, custom_css: 'body{display:none}', custom_html: '<script>x()</script>' }) }), 'jwt-lee', SITE_ROW, lee, cors))();
  const saved = writes.find((w) => w.table === 'presence_dev_customizations')?.body;
  ok('styles: a Designer\'s save keeps the colours and leaves the developer\'s code exactly as it was', r.status === 200 && saved && saved.custom_css === '.dev{color:red}' && saved.custom_html === '<p>dev</p>' && JSON.stringify(saved.theme_tokens).includes('6d3fd4'));
}

// ═══ 6. their own screen: the context, with nothing of the business read ═══
{
  const BUSINESS = ['presence_form_submissions', 'presence_support_requests', 'presence_project_events', 'presence_plan_notices', 'presence_infra_plans', 'presence_connection_writes', 'presence_media', 'presence_service_links', 'presence_activity_reads', 'presence_section_comments'];
  const ctxOf = async (canPublish) => {
    reset(); DB.presence_site_members[0].can_publish = canPublish;
    const principal = { kind: 'client', userId: USERS['jwt-lee'].id, email: USERS['jwt-lee'].email, jwt: 'jwt-lee', role: 'client', tenantId: null, requestId: 't', member: { site_id: SITE, role: 'designer', can_publish: canPublish } };
    const res = await quiet(() => handlePortalContext('jwt-lee', SITE_ROW, principal, cors))();
    return (await res.json()).data;
  };
  const d = await ctxOf(false);
  ok('context: the role is Designer and the landing is the website', d.site_role === 'designer' && d.landing === '/presence.html');
  ok('context: their sentence, in their own words, and who publishes', d.my_role?.name === 'Designer' && d.my_role.you === SEAT_WORDS.designer.you && /owner or the studio publishes/.test(d.my_role.publish) && d.my_role.can_publish === false);
  ok('context: the role card names the business', d.my_role?.business === 'Maple & Main Realty');
  ok('context: no publish without the switch, and neither the full workspace nor the client portal', !d.capabilities.includes('publish') && d.sees_full_workspace === false && d.is_client_portal === false && d.is_managed_client === false);
  ok('context: the menu is the website, its files and Help', JSON.stringify(d.nav.map((s) => s.key)) === JSON.stringify(['website', 'files', 'help']));
  ok('context: no Publish or Versions entry without the switch... Versions stays to look', !d.nav[0].items.some((i) => i.key === 'publish') && d.nav[0].items.some((i) => i.key === 'history'));
  ok('context: the bell counts nothing', d.attention_count === 0);
  const touched = BUSINESS.filter((t) => reads.includes(t));
  ok('context: not one read of the business behind the site', touched.length === 0, touched.join(', '));
  const p = await ctxOf(true);
  ok('context: with the switch on, publishing joins their abilities and menu, and the line says so', p.capabilities.includes('publish') && p.nav[0].items.some((i) => i.key === 'publish') && /can publish/.test(p.my_role.publish));
  ok('context: an owner gets no role card', (await (async () => { reset(); const res = await quiet(() => handlePortalContext('jwt-owner', SITE_ROW, { kind: 'client', userId: USERS['jwt-owner'].id, email: USERS['jwt-owner'].email, jwt: 'jwt-owner', role: 'client', tenantId: null, requestId: 't' }, cors))(); return (await res.json()).data; })()).my_role === null);
  const nav = (caps, edition = 'presence') => buildNav({ role: 'designer', edition, capabilities: caps, isAgency: false, isOperator: false });
  ok('menu: a Designer\'s holds no business place, not even as a search entry', !JSON.stringify(nav(['view_site', 'edit', 'comment', 'design', 'publish'])).match(/today|inbox|customers|pipeline|invoices|projects|analytics|settings|domain|contacts/i));
  ok('menu: a Designer who is also on a studio\'s team still gets the Designer\'s menu', JSON.stringify(buildNav({ role: 'designer', edition: 'presence', capabilities: ['view_site', 'edit'], isAgency: true, isOperator: false }).map((s) => s.key)) === JSON.stringify(['website', 'files', 'help']));
  ok('menu: landing is the website for a Designer, whatever else they are', landingFor({ role: 'designer', edition: 'presence', capabilities: [], isAgency: true, isOperator: false }) === '/presence.html');
}

// ═══ 6b. the editor's Activity card: the website's story, never the business ═══
// The editor reads /website-timeline for everyone, and a Designer may read it. For an owner
// it carries enquiries (a customer's name, email and message), the business notes and the
// studio's project messages; a Designer gets the website's part only.
{
  const AGENCY = uuid('e'), PROJECT = uuid('d');
  const seed = () => reset({
    presence_form_submissions: [   // the stub ignores order and limit: the first row is the "first enquiry" milestone
      { id: uuid('0'), site_id: SITE, spam: false, form_kind: 'contact', name: 'Ann Earlier', email: 'ann@customer.example', message: 'Are you open Sundays?', created_at: '2026-10-01T10:00:00Z' },
      { id: uuid('7'), site_id: SITE, spam: false, form_kind: 'contact', name: 'Jo Customer', email: 'jo@customer.example', message: 'Can you quote my kitchen?', created_at: '2026-11-10T10:00:00Z' },
    ],
    presence_moments: [{ id: uuid('8'), site_id: SITE, status: 'active', moment_key: 'busy', headline: 'Three enquiries this week', summary: 'Busier than usual', created_at: '2026-11-10T09:00:00Z' }],
    presence_change_events: [
      { id: uuid('b'), site_id: SITE, entity_type: 'identity', action: 'update', summary: 'Updated the opening hours', actor_kind: 'client', created_at: '2026-11-09T10:00:00Z' },
      { id: uuid('c'), site_id: SITE, entity_type: 'contact', action: 'create', summary: 'Asked jo@customer.example to connect with you', actor_kind: 'client', created_at: '2026-11-09T11:00:00Z' },
    ],
    presence_service_links: [{ customer_client_id: CLIENT, status: 'active', project_id: PROJECT, agency_site_id: AGENCY }],
    presence_project_events: [{ id: uuid('f'), site_id: AGENCY, project_id: PROJECT, client_visible: true, kind: 'message', actor_kind: 'staff', detail: { title: 'Your invoice for October is attached' }, created_at: '2026-11-11T10:00:00Z' }],
  });
  const BUSINESS_WORDS = ['Jo Customer', 'jo@customer.example', 'kitchen', 'Three enquiries', 'invoice for October', 'Your first website enquiry'];
  const story = async (opts) => { seed(); const res = await quiet(() => handleWebsiteTimeline(SITE_ROW, cors, opts))(); return { status: res.status, text: JSON.stringify(await res.json()) }; };
  const owner = await story(undefined);
  const ownerSaw = BUSINESS_WORDS.filter((w) => owner.text.includes(w));
  ok('timeline: an owner\'s carries the enquiry, the note, the studio\'s message and the contact line (so the checks below can fail)', owner.status === 200 && ['Jo Customer', 'jo@customer.example', 'Three enquiries', 'invoice for October', 'Asked jo@customer.example'].every((w) => owner.text.includes(w)), ownerSaw.join(', '));
  const lee = await story({ websiteOnly: true });
  const leaked = [...BUSINESS_WORDS, 'Asked jo@customer.example'].filter((w) => lee.text.includes(w));
  ok('timeline: a Designer\'s holds no customer, message, note or contact line', lee.status === 200 && leaked.length === 0, leaked.join(', '));
  ok('timeline: a Designer\'s still tells the website\'s story', lee.text.includes('Updated the opening hours'));
  const asked = ['presence_form_submissions', 'presence_moments', 'presence_service_links', 'presence_project_events'].filter((t) => reads.includes(t));
  ok('timeline: for a Designer the enquiries, notes and the studio\'s project are never read', asked.length === 0, asked.join(', '));
  ok('timeline: the change lines a Designer gets are website work only', !WEBSITE_CHANGE_TYPES.some((t) => ['contact', 'deal', 'client', 'internal_note'].includes(t)) && ['identity', 'post', 'media', 'site', 'domain'].every((t) => WEBSITE_CHANGE_TYPES.includes(t)));
  ok('index: the route answers a Designer with the website\'s part, from the seat the boundary read', idx.includes("if (route === '/website-timeline' && method === 'GET') return handleWebsiteTimeline(site, cors, { websiteOnly: siteRole === 'designer' });"));
}

// ═══ 7. invites and role changes carry the switch; the email says the role ═══
{
  reset();
  const lee = await quiet(() => addSiteMember(SITE, 'pat@pixel.example', 'designer', 'owner', { canPublish: true }))();
  const row = DB.presence_site_members.find((s) => s.email === 'pat@pixel.example');
  ok('invite: a Designer can be invited with publishing on', lee.ok && row?.role === 'designer' && row.can_publish === true);
  const mail = emails[emails.length - 1];
  ok('invite: the email is about the website, not running the business', /work on Maple & Main Realty’s website/.test(mail?.subject || '') && /as a Designer/.test(mail?.html || ''));
  ok('invite: it says the role in one sentence, and that they can publish', (mail?.html || '').includes('What a Designer can see') && (mail?.html || '').includes(SEAT_WORDS.designer.you) && /You can publish your changes/.test(mail?.html || ''));
  ok('invite: a Designer signs in at the studio door, where the website lives', minted.some((m) => /\/studio\.html$/.test(m.redirect_to)));
  reset();
  await quiet(() => addSiteMember(SITE, 'jo@maple.example', 'business_staff', 'owner', { canPublish: true }))();
  ok('invite: only a Designer\'s seat stores the switch; staff\'s is stored off', DB.presence_site_members.find((s) => s.email === 'jo@maple.example')?.can_publish === false);
  ok('invite: staff are invited to help run the business, as Staff, with their sentence', /help run Maple & Main Realty/.test(emails[0]?.subject || '') && (emails[0]?.html || '').includes('as Staff') && (emails[0]?.html || '').includes(SEAT_WORDS.business_staff.you));
  reset();
  await quiet(() => addSiteMember(SITE, 'off@pixel.example', 'designer', 'owner', {}))();
  ok('invite: the switch starts off', DB.presence_site_members.find((s) => s.email === 'off@pixel.example')?.can_publish === false && /owner or the studio publishes your changes/.test(emails[0]?.html || ''));
  reset();
  const turnOn = await changeSiteMemberRole(SITE, uuid('5'), 'designer', { canPublish: true });
  ok('switch: turning it on is the role route with the same role', turnOn.ok && DB.presence_site_members[0].can_publish === true && DB.presence_site_members[0].role === 'designer');
  await changeSiteMemberRole(SITE, uuid('5'), 'business_staff', { canPublish: true });
  ok('switch: a seat that stops being a Designer loses it', DB.presence_site_members[0].role === 'business_staff' && DB.presence_site_members[0].can_publish === false);
  reset();
  const listed = await listSiteMembers(SITE);
  ok('list: each seat says whether it may publish', listed.every((m) => typeof m.can_publish === 'boolean'));
  reset(); DB.presence_site_members[0].can_publish = true;
  const found = await resolveMemberSite({ userId: USERS['jwt-lee'].id, email: USERS['jwt-lee'].email });
  ok('seat: the member\'s own seat carries the switch onto the request', found?.member?.role === 'designer' && found.member.can_publish === true);
  const roleRoute = read('supabase/functions/presence/routes/workspace.ts');
  ok('routes: the invite and the role change pass the switch on, as a strict true', roleRoute.includes("canPublish: body?.can_publish === true });") && roleRoute.split('canPublish: body?.can_publish === true').length === 3);
  ok('routes: the People list carries each seat\'s sentence and who publishes', roleRoute.includes("role_sentence: SEAT_WORDS[m.role as SiteRole]?.sees || '', publish_words: publishWords(m, false)"));
  ok('routes: a wrong role is answered with Designer among the choices', roleRoute.includes("'Pick a role: Co-owner, Staff, Designer or Reviewer.'"));
}

// ═══ 8. the studio's own team, in one sentence a role ═══
{
  const roles = ['owner', 'admin', 'account_manager', 'content_strategist', 'designer', 'developer', 'support', 'readonly'];
  for (const r of roles) ok(`studio: ${r} has a name and two sentences`, !!STUDIO_ROLE_WORDS[r]?.name && /^(Sees|Opens) /.test(STUDIO_ROLE_WORDS[r].sees) && /^You /.test(STUDIO_ROLE_WORDS[r].you));
  for (const r of roles) ok(`studio: ${r}'s sentence says it ${can(r, 'bulk_publish') ? 'opens' : 'can’t open'} a client, as lib/scope.ts decides`, can(r, 'bulk_publish') ? /Opens every client|every client/.test(STUDIO_ROLE_WORDS[r].sees) : !/Opens every client/.test(STUDIO_ROLE_WORDS[r].sees));
  const ag = read('supabase/functions/presence/agency/routes.ts');
  ok('studio: the team invite says the role and its sentence', ag.includes("intro: `You’ve been invited to join the <strong>${agencyNameHtml}</strong> team${roleWords ? ` as ${roleWords.name}` : ''}.`") && ag.includes('role: roleWords ? { title: `What a ${roleWords.name} can see`, lines: [roleWords.you] } : undefined,'));
}

// ═══ 9. the rest of the server, and the migration ═══
{
  const log = read('supabase/functions/presence/routes/email_log.ts');
  ok('mail-in: a Designer\'s email never logs onto a customer\'s record', log.includes("select=email,role&limit=50") && log.includes("if (m.role !== 'designer') add(m.email);"));
  const db = read('supabase/functions/presence/lib/db.ts');
  ok('data path: a Designer\'s seat reaches the website\'s content (and memberWriteGate clears each write)', db.includes('seesSite(principal.member.role as SiteRole)'));
  const sites = read('supabase/functions/presence/agency/sites.ts');
  ok('Sites: a Designer is named on the card\'s Can edit line', sites.includes("designer: 'Designer' };"));
  const mig = read('supabase/migrations/0223_designer_seat.sql');
  const pack = read('docs/presence/APPLY-0223-prod.sql');
  const CHECK = "check (role in ('business_owner', 'business_staff', 'client_reviewer', 'developer', 'designer'))";
  ok('migration: the role check gains designer and keeps the four', mig.includes(CHECK) && pack.includes(CHECK));
  ok('migration: the switch is a column, off by default', mig.includes('add column if not exists can_publish boolean not null default false') && pack.includes('add column if not exists can_publish boolean not null default false'));
  ok('migration: the old check is found by what it says, so its name doesn\'t matter', mig.includes("pg_get_constraintdef(oid) ilike '%role%business_staff%'") && pack.includes("pg_get_constraintdef(oid) ilike '%role%business_staff%'"));
  ok('pack: plain ASCII, so a paste can\'t mangle it', /^[\x00-\x7F]*$/.test(pack));
  ok('pack: it says to run before the deploy', /BEFORE[\s-]+the deploy\.yml run/.test(pack));
}

// ═══ 10. the pages say the same words, and hide what the role can't use ═══
{
  const people = read('people.js');
  const peopleRoles = Object.fromEntries([...people.matchAll(/\{ key: '([a-z_]+)', name: '([^']+)', desc: '([^']+)'/g)].map((m) => [m[1], { name: m[2], desc: m[3] }]));
  for (const role of SITE_ROLES) ok(`people.js: ${role}'s sentence is the server's, word for word`, peopleRoles[role]?.desc === SEAT_WORDS[role].sees && peopleRoles[role]?.name === SEAT_WORDS[role].name, peopleRoles[role]?.desc);
  ok('people.js: the invite offers every role but the paused Developer', people.includes("var OFFERED = ROLES.filter(function (r) { return r.key !== 'developer'; });"));
  ok('people.js: the switch is sent for a Designer alone, as a strict true or false', people.includes("me.pick === 'designer' ? { email: me.email, role: me.pick, can_publish: me.canPub === true } : { email: me.email, role: me.pick }") && people.includes("{ role: 'designer', can_publish: on }"));
  ok('people.js: the switch is a real switch with a name, and each seat says its role', people.includes('<input type="checkbox" class="pp-switch" role="switch" ') && people.includes("aria-label=\"' + esc('Can publish to the live site: ' + m.email) + '\"") && people.includes('<p class="pp-sent" data-sent="'));
  ok('pages: both People pages load the new people.js', read('sites.html').includes('<script src="/people.js?v=220"></script>') && read('sharing.html').includes('<script src="/people.js?v=220"></script>'));
  const settings = read('settings.html');
  const studio = Object.fromEntries([...settings.matchAll(/^  ([a-z_]+): \{ sees: '([^']+)', opens: ([01]), team: ([01]), plan: ([01]) \},$/gm)].map((m) => [m[1], { sees: m[2], opens: m[3] === '1', team: m[4] === '1', plan: m[5] === '1' }]));
  for (const r of Object.keys(STUDIO_ROLE_WORDS)) ok(`settings.html: the Team's ${r} says the server's sentence and reaches what the server lets it`, studio[r]?.sees === STUDIO_ROLE_WORDS[r].sees && studio[r].opens === can(r, 'bulk_publish') && studio[r].team === can(r, 'manage_members') && studio[r].plan === (r === 'owner'), JSON.stringify(studio[r]));
  ok('settings.html: the long role paragraph is gone; the picked role and the Who sees what table took its place', !settings.includes('const ROLE_HELP') && settings.includes("$('roleHelp').innerHTML = whoSeesHtml();") && settings.includes('<div class="rolepick" id="rolePick" aria-live="polite" hidden></div>'));
  const shell = read('shell.js'), css = read('shell.css');
  ok('shell: a Designer lacks the business, approving, and publishing unless their seat allows it', ["if (caps.indexOf('publish') < 0) lacks.push('publish');", "if (caps.indexOf('approve') < 0) lacks.push('approve');", "if (caps.indexOf('design') < 0) lacks.push('design');", "if (caps.indexOf('view_all') < 0) lacks.push('business');"].every((l) => shell.includes(l)));
  ok('shell: a member\'s own screen carries their role card, on the menu and in a phone\'s Menu', shell.includes("brandHtml + roleCardHtml() +") && shell.includes("drawer.innerHTML = (sidebarMode() ? '' : roleCardHtml(true)) + html;") && shell.includes('var r = CTX && CTX.my_role;'));
  ok('shell: a page outside a Designer\'s role says so, everywhere but the website, Files and Help', shell.includes('var DESIGNER_PAGES = /^\\/(presence|files|help)(\\.html)?$/;') && shell.includes("if (!ctx || ctx.site_role !== 'designer' || ctx.scope || ctx.is_operator) return;") && /guardRolePage\(ctx\);\n  \}/.test(shell));
  for (const need of ['publish', 'approve', 'design', 'business']) ok(`css: data-needs="${need}" goes for a role lacking it`, css.includes(`html[data-dds-lacks~="${need}"] [data-needs="${need}"]`));
  ok('css: the bell goes with the business; the page\'s own content goes outside the role', css.includes('html[data-dds-lacks~="business"] #dds-bell') && css.includes('html.dds-notyours body > :not([id^="dds-"])'));
  ok('css: a note for someone who can\'t publish shows in Publish\'s place', css.includes('html[data-dds-lacks~="publish"] [data-if-lacks="publish"][hidden]{display:inline-flex!important}'));
  const builder = read('presence.html');
  ok('builder: all three Publish buttons are marked, each with its pill', ['id="btnPublish" type="button" data-needs="publish"', 'id="dcBtnPublish" data-needs="publish"', 'id="dockPublish" aria-pressed="false" data-needs="publish"', 'id="btnWaitPub" type="button" hidden data-if-lacks="publish"', 'id="dcBtnWait" hidden data-if-lacks="publish"', 'id="dockWait" aria-pressed="false" hidden data-if-lacks="publish"'].every((m) => builder.includes(m)));
  ok('builder: the publish step never opens for a role that can\'t publish', /function openRitual\(opts\) \{\n  if \(window\.ddsLacks && window\.ddsLacks\("publish"\)\) \{ openWaitNote\(\); return; \}/.test(builder));
  ok('builder: launching, scheduling, rolling back and publishing a preview are marked; approving a launch too', ['acts.lastChild.dataset.needs = "approve"; }', 'acts.lastChild.dataset.needs = "publish";   // builder item 220: a Designer goes live only when their seat says so', 'acts.lastChild.dataset.needs = "publish"; }', 'acts.lastChild.dataset.needs = "publish";   // builder item 220\n'].every((m) => builder.includes(m)));
  ok('builder: the business tabs are marked and never open for a Designer', builder.includes('if (isBusinessTab(view)) b.dataset.needs = "business";') && builder.includes('if (isBusinessTab(view) && window.ddsLacks && window.ddsLacks("business")) view = "today";'));
  ok('builder: Styles is restyling (design), and the brand card makes no AI images for someone who can\'t approve them', builder.includes('id="btnSettingsOpen" data-needs="design"') && builder.includes('if (window.ddsLacks && window.ddsLacks("approve")) return;'));
  ok('files: Make an image needs approve', read('files.html').includes('id="makeImage" href="/visual-studio.html" data-needs="approve"'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DESIGNER ROLE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
