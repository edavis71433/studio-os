// ── The hand-over kit (builder list item 176) ────────────────────────────────
// Wix Studio's client kit: who to call, how-tos, video links and files, written
// once by the studio and shown under Help in the client's portal. This suite
// proves the rules (lib/handover_kit.ts) and drives the studio's routes
// (agency/client_tools.ts) and the portal's (routes/client_kit.ts) against an
// in-memory PostgREST:
//   · a new kit starts from the studio's own details and three how-tos, off;
//   · a save is checked (titles, https video links, an email that's an email,
//     up to ten files, all from this client's own Files) and keeps its dates;
//   · nothing reaches the portal until it's switched on, and then the files
//     come with download links and the site's facts ride along;
//   · "Tell them it's ready" needs it shown and an owner; a view-only seat can
//     look but not change, and another studio's site is not found.
//   deno run --allow-read --allow-env tests/presence/handover_kit_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('APP_URL', 'https://app.example');
Deno.env.set('RESEND_KEY', 're_test');
const K = await import('../../supabase/functions/presence/lib/handover_kit.ts');
const { handleClientTools } = await import('../../supabase/functions/presence/agency/client_tools.ts');
const { handleClientKit } = await import('../../supabase/functions/presence/routes/client_kit.ts');
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-11-11T10:00:00.000Z';

// ═══ 1. the rules (pure) ═══
{
  const d = K.defaultKit({ name: 'Bright Studio', email: 'hello@bright.example', phone: '(555) 010-4477' });
  ok('a new kit: the studio’s details to call, three how-tos, nothing else, off', d.contact.name === 'Bright Studio' && d.contact.email === 'hello@bright.example' && d.guides.length === 3 && d.videos.length === 0 && d.files.length === 0 && d.shown === false);
  ok('a new kit: a studio email that isn’t one is left out', K.defaultKit({ name: 'X', email: 'nope' }).contact.email === '');
  ok('videos: https links only', K.videoUrl('https://www.loom.com/share/abc') === 'https://www.loom.com/share/abc' && K.videoUrl('http://x.example/v') === null && K.videoUrl('javascript:alert(1)') === null && K.videoUrl('https://a b.example') === null && K.videoUrl('https://localhost') === null);
  const base = { contact: { name: ' Sam  at Bright ', email: 'sam@bright.example', phone: '555', hours: 'Weekdays' }, guides: [{ title: 'Change a photo', body: 'Send it in Requests.' }], videos: [{ title: 'Tour', url: 'https://youtu.be/x' }], files: [], shown: true };
  const s = K.kitFromSave(base, null, 'sam@bright.example', NOW);
  ok('save: tidied, shown now, by whom', s.ok && s.kit.contact.name === 'Sam at Bright' && s.kit.shown && s.kit.shown_at === NOW && s.kit.updated_by === 'sam@bright.example' && s.kit.updated_at === NOW);
  const s2 = K.kitFromSave({ ...base }, s.kit, 'pat@bright.example', '2026-11-12T10:00:00.000Z');
  ok('save again: "shown since" keeps its first date; switched off, it has none', s2.ok && s2.kit.shown_at === NOW && K.kitFromSave({ ...base, shown: false }, s.kit, 'x', NOW).kit.shown_at === null);
  ok('save: a how-to with no title is refused', !K.kitFromSave({ ...base, guides: [{ title: ' ', body: 'x' }] }, null, 'x', NOW).ok);
  ok('save: a video link that isn’t https is refused, by name', (() => { const r = K.kitFromSave({ ...base, videos: [{ title: 'Tour', url: 'ftp://x' }] }, null, 'x', NOW); return !r.ok && r.message.includes('Tour'); })());
  ok('save: a bad email is refused', !K.kitFromSave({ ...base, contact: { ...base.contact, email: 'sam@' } }, null, 'x', NOW).ok);
  ok('save: more than ten files, eight how-tos or eight videos is refused', !K.kitFromSave({ ...base, files: Array.from({ length: 11 }, () => crypto.randomUUID()) }, null, 'x', NOW).ok && !K.kitFromSave({ ...base, guides: Array.from({ length: 9 }, () => ({ title: 't' })) }, null, 'x', NOW).ok && !K.kitFromSave({ ...base, videos: Array.from({ length: 9 }, () => ({ title: 't', url: 'https://a.example' })) }, null, 'x', NOW).ok);
  ok('save: shown with nobody to call is refused', !K.kitFromSave({ ...base, contact: {} }, null, 'x', NOW).ok && K.kitFromSave({ ...base, contact: {}, shown: false }, null, 'x', NOW).ok);
  ok('a damaged stored kit reads as none; a stored one keeps only good links', K.normalizeKit({ v: 2 }) === null && K.normalizeKit({ v: 1, videos: [{ title: 'a', url: 'http://x' }, { title: 'b', url: 'https://y.example' }] }).videos.length === 1);
}

// ═══ 2. the routes ═══
const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
const SITE = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', THEIRS = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', STUDIO = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3', CLIENT = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4';
const LOGO = '11111111-2222-4333-8444-555555555555', MENU = '11111111-2222-4333-8444-666666666666', ELSEWHERE = '11111111-2222-4333-8444-777777777777';
let T, mail, clock = 0;
function reset() {
  T = {
    presence_agency_clients: [{ agency_id: AG, site_id: SITE, status: 'active' }],
    presence_sites: [{ id: SITE, client_id: CLIENT, status: 'live', last_published_at: '2026-10-20T00:00:00Z', template_slug: 't', template_version: '1', custom_domain: 'harbordental.example', netlify_site_id: 'n1', edition: 'presence', domain_registrar: 'Namecheap', domain_expires_at: '2027-03-14T00:00:00Z' }],
    presence_identity: [{ site_id: SITE, business_name: 'Harbor Dental' }, { site_id: STUDIO, business_name: 'Bright Studio', email: 'hello@bright.example', phone: '(555) 010-4477' }],
    clients: [{ id: CLIENT, name: 'Ana Ruiz', email: 'ana@harbor.example' }],
    presence_publishes: [{ site_id: SITE, status: 'live', created_at: '2026-10-03T09:00:00Z' }, { site_id: SITE, status: 'live', created_at: '2026-10-20T09:00:00Z' }],
    presence_media: [
      { id: LOGO, site_id: SITE, alt_text: 'Logo — full colour', mime: 'image/png', storage_path: `presence-media/${SITE}/logo.png`, created_at: '2026-10-01T00:00:00Z', deleted_at: null },
      { id: MENU, site_id: SITE, alt_text: 'Brand colours and fonts', mime: 'application/pdf', storage_path: `presence-media/${SITE}/brand.pdf`, created_at: '2026-10-02T00:00:00Z', deleted_at: null },
      { id: ELSEWHERE, site_id: THEIRS, alt_text: 'Not theirs', mime: 'image/png', storage_path: `presence-media/${THEIRS}/x.png`, created_at: '2026-10-02T00:00:00Z', deleted_at: null },
    ],
    presence_sales_templates: [],
  };
  mail = [];
}
const CTRL = ['select', 'limit', 'order'];
function match(r, k, v) {
  const val = r[k] == null ? null : String(r[k]);
  if (v === 'is.null') return r[k] == null;
  if (v.startsWith('eq.')) return val === decodeURIComponent(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(decodeURIComponent).includes(val);
  return true;
}
const hits = (table, params) => (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v)));
function pick(rows, params) {
  let out = rows;
  const o = params.get('order') || '';
  if (o.startsWith('created_at.asc')) out = [...out].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (o.startsWith('created_at.desc')) out = [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (o.startsWith('updated_at.desc')) out = [...out].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const sel = params.get('select');
  if (sel && sel !== '*') out = out.map((r) => Object.fromEntries(sel.split(',').map((c) => [c, r[c]])));
  const lim = Number(params.get('limit'));
  return lim ? out.slice(0, lim) : out;
}
const tick = () => new Date(Date.UTC(2026, 10, 11, 10, 0, clock++)).toISOString();
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const reply = (b, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(init.body)); return reply({ id: 'mail' }); }
  if (u.pathname.startsWith('/storage/v1/object/sign/')) return reply({ signedURL: u.pathname.replace('/storage/v1', '') + '?token=s' });
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  if (table === 'rpc/rate_hit') return reply(true);
  if (method === 'GET') return reply(pick(hits(table, u.searchParams), u.searchParams));
  const body = init.body ? JSON.parse(init.body) : null;
  if (method === 'POST') { const row = { id: crypto.randomUUID(), created_at: tick(), updated_at: tick(), deleted_at: null, ...body }; (T[table] = T[table] || []).push(row); return reply([row], 201); }
  if (method === 'PATCH') { const h = hits(table, u.searchParams); h.forEach((r) => Object.assign(r, body, { updated_at: tick() })); return reply(h.map((r) => ({ id: r.id }))); }
  return reply([]);
};
const member = (over = {}) => ({ agency_id: AG, member_id: 'm1', email: 'sam@bright.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const deps = { ownSite: async () => ({ id: STUDIO }), needs: async () => ({ rows: [] }), gather: async () => ({ links: [], clientNames: {} }) };
async function studio(method, route, body, m = member()) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
  const res = await handleClientTools(req, route, method, m, { kind: 'client', userId: 'u1', email: m.email }, {}, deps);
  return { status: res.status, body: await res.json() };
}
const portal = async () => { const res = await handleClientKit(new Request('http://stub.local/x'), T.presence_sites[0], { kind: 'client', userId: 'c', email: 'ana@harbor.example' }, {}); return { status: res.status, body: await res.json() }; };

reset();
{
  const g = await studio('GET', `/agency/sites/${SITE}/kit`);
  const d = g.body.data;
  ok('studio: no kit yet — suggestions from the studio’s own details, not saved', g.status === 200 && d.saved === false && d.kit.contact.name === 'Bright Studio' && d.kit.contact.phone === '(555) 010-4477' && d.kit.guides.length === 3);
  ok('studio: the site’s facts fill in — address, first live day, domain renewal and where', d.facts.address === 'https://harbordental.example' && d.facts.live_since === '2026-10-03T09:00:00Z' && d.facts.domain_expires_at === '2027-03-14T00:00:00Z' && d.facts.domain_registrar === 'Namecheap');
  ok('studio: their own Files to pick from (never another site’s), and the owner to tell', d.files.map((x) => x.id).sort().join() === [LOGO, MENU].sort().join() && d.owner.email === 'ana@harbor.example');
  ok('portal: nothing until the studio saves and switches it on', (await portal()).body.data === null);
  ok('studio: a view-only seat can look but not save', (await studio('GET', `/agency/sites/${SITE}/kit`, null, member({ role: 'readonly' }))).status === 200 && (await studio('PUT', `/agency/sites/${SITE}/kit`, d.kit, member({ role: 'readonly' }))).status === 403);
  ok('studio: another studio’s site is not found', (await studio('GET', `/agency/sites/${THEIRS}/kit`)).status === 404);
  ok('studio: a file from another site is refused', (await studio('PUT', `/agency/sites/${SITE}/kit`, { ...d.kit, files: [ELSEWHERE] })).status === 400);
  ok('studio: telling them before it’s in their portal is refused', (await studio('POST', `/agency/sites/${SITE}/kit/email`)).status === 409);
  const saved = await studio('PUT', `/agency/sites/${SITE}/kit`, { ...d.kit, videos: [{ title: 'A 3-minute tour', url: 'https://www.loom.com/share/7d0c' }], files: [MENU, LOGO], shown: false });
  ok('studio: saved off — kept, not in the portal', saved.status === 200 && saved.body.data.kit.shown === false && (await portal()).body.data === null);
  const tools = await studio('GET', '/agency/site-tools');
  ok('cards: the line says it isn’t in their portal yet', tools.body.data[SITE].kit.shown === false && tools.body.data[SITE].intake === null);
  await studio('PUT', `/agency/sites/${SITE}/kit`, { ...saved.body.data.kit, shown: true });
  const p = await portal();
  const k = p.body.data;
  ok('portal: once on — who to call, the how-tos and videos', p.status === 200 && k.contact.name === 'Bright Studio' && k.guides.length === 3 && k.videos[0].url === 'https://www.loom.com/share/7d0c');
  ok('portal: the files in the kit’s order, each with a signed download link, never the stored record', k.files.map((x) => x.name).join() === 'Brand colours and fonts,Logo — full colour' && k.files.every((x) => /^http:\/\/stub\.local\/storage\/v1\/object\/sign\//.test(x.url) && !('storage_path' in x) && !('id' in x)));
  ok('portal: the website’s facts', k.website.address === 'https://harbordental.example' && k.website.live_since === '2026-10-03T09:00:00Z' && k.website.domain_expires_at === '2027-03-14T00:00:00Z');
  const em = await studio('POST', `/agency/sites/${SITE}/kit/email`);
  const m0 = mail[0] || {};
  ok('tell them: emails the owner, with a link to their portal, replies to the studio’s Inbox', em.status === 200 && [].concat(m0.to || [])[0] === 'ana@harbor.example' && String(m0.html || '').includes(`https://app.example/portal.html?studio=${STUDIO}`) && /Your website kit from/.test(m0.subject || '') && !!em.body.data.kit.emailed_at);
  const again = await studio('PUT', `/agency/sites/${SITE}/kit`, { ...em.body.data.kit, guides: [] });
  ok('a later save keeps "they were told"', again.body.data.kit.emailed_at === em.body.data.kit.emailed_at && again.body.data.kit.guides.length === 0);
  T.clients[0].email = null;
  ok('tell them: a site with no owner yet is refused, plainly', (await studio('POST', `/agency/sites/${SITE}/kit/email`)).status === 409);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
