// ── Templates and starter kits you can see, rename and remove (builder list item 166) ──
// Nov 10 review, file 05 finding 13: kits could be saved and picked but never seen,
// renamed or removed, and no page called a rename or a delete. The Templates tab on
// Sites (templates.html) does all three. This suite drives the real handleAgency()
// against an in-memory PostgREST and a stand-in for file storage:
//   · GET /agency/kits says what each kit brings and which site it came from, never
//     sending a template's pages; who may manage them rides along;
//   · PATCH /agency/kits/:id renames (who may, an empty name, another studio's kit);
//   · DELETE /agency/kits/:id removes, and a template's own photo copies go with it —
//     only ever from that studio's own template folder.
//   deno run --allow-read --allow-env tests/presence/kits_manage_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const AG = 'aaaaaaaa-0000-4000-8000-000000000001', OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const ME = '11111111-1111-4111-8111-111111111111', RO = '33333333-3333-4333-8333-333333333333';
const S1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', GONE = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const TPL = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdab01', KIT = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdab02', THEIRS = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdab03';
const P1 = 'f1f1f1f1-1111-4111-8111-f1f1f1f1f1f1', P2 = 'f2f2f2f2-2222-4222-8222-f2f2f2f2f2f2';
let T, deleted, writes;
function reset() {
  T = {
    presence_agency_members: [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active' }],
    presence_identity: [{ site_id: S1, business_name: 'Maple & Main Realty' }],
    presence_starter_kits: [
      { id: TPL, agency_id: AG, name: 'Realty — three pages', industry_key: 'realty', created_from_site: S1, created_by: 'eric@studio.example', created_at: '2026-11-10T00:00:00Z',
        payload: { offerings: [{ name: 'Valuations' }, { name: 'Lettings' }], faqs: [{ question: 'q', answer: 'a' }], voice: { tone_notes: 'Warm', preferred_vocabulary: '', never_claim: '' }, theme_tokens: { accent: '#123' },
          layout_summary: { pages: 3, sections: 14, photos: 2 },
          layout: { settings: { blocks: [{ type: 'richtext', body: 'big' }] }, media: [
            { id: 'm1', storage_path: `presence-media/templates/${AG}/${P1}.jpg` },
            { id: 'm2', storage_path: `presence-media/templates/${AG}/${P2}.webp` },
            { id: 'm3', storage_path: `presence-media/${S1}/someone-elses.jpg` },              // never a template's: a site's own photo
            { id: 'm4', storage_path: `presence-media/templates/${OTHER}/${P1}.jpg` },        // another studio's folder
          ] } } },
      { id: KIT, agency_id: AG, name: 'Florist starter', industry_key: 'florist', created_from_site: GONE, created_by: 'pat@studio.example', created_at: '2026-11-02T00:00:00Z',
        payload: { offerings: [], faqs: [], voice: { tone_notes: '', preferred_vocabulary: '', never_claim: '' }, theme_tokens: {} } },
      { id: THEIRS, agency_id: OTHER, name: 'Not yours', payload: {} },
    ],
  };
  deleted = []; writes = [];
}
const CTRL = ['select', 'limit', 'order'];
const match = (r, k, v) => (v.startsWith('eq.') ? String(r[k]) === decodeURIComponent(v.slice(3)) : v.startsWith('in.(') ? v.slice(4, -1).split(',').includes(String(r[k])) : true);
function rowsFor(table, params) {
  let rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v)));
  const sel = params.get('select');
  if (sel) {
    // PostgREST's select, as far as these routes use it: columns, and alias:col->key->key
    rows = rows.map((r) => Object.fromEntries(sel.split(',').map((part) => {
      const m = part.match(/^(\w+):(\w+)((?:->\w+)+)$/);
      if (m) { let v = r[m[2]]; for (const k of m[3].split('->').filter(Boolean)) v = v && typeof v === 'object' ? v[k] ?? null : null; return [m[1], v ?? null]; }
      return [part, r[part]];
    })));
  }
  const lim = Number(params.get('limit')); return lim ? rows.slice(0, lim) : rows;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const reply = (b, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname.startsWith('/storage/v1/object/')) { deleted.push({ method, path: u.pathname.replace('/storage/v1/object/', '') }); return reply({}); }
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  const body = init.body ? JSON.parse(init.body) : null;
  writes.push({ table, method, body });
  const hit = (T[table] || []).filter((r) => [...u.searchParams.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v)));
  if (method === 'PATCH') { hit.forEach((r) => Object.assign(r, body)); return reply(hit.map((r) => ({ id: r.id, name: r.name }))); }
  if (method === 'DELETE') { T[table] = T[table].filter((r) => !hit.includes(r)); return reply(hit); }
  return reply([]);
};
const asMember = (over = {}) => ({ agency_id: AG, member_id: ME, email: 'eric@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
async function call(member, method, route, body) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
  const res = await handleAgency(req, route, method, member, { kind: 'client', userId: 'u', email: member.email }, {});
  return { status: res.status, body: await res.json() };
}

// ── the list ──
{
  reset();
  const r = await call(asMember(), 'GET', '/agency/kits');
  const tpl = r.body.data.find((k) => k.id === TPL), kit = r.body.data.find((k) => k.id === KIT);
  ok('list: this studio\'s kits only', r.status === 200 && r.body.data.length === 2 && !r.body.data.some((k) => k.id === THEIRS));
  ok('list: a template says it is one, and how much it carries', tpl.kind === 'template' && JSON.stringify(tpl.summary) === JSON.stringify({ pages: 3, sections: 14, photos: 2 }));
  ok('list: what each brings — services, FAQs, voice, colors', JSON.stringify(tpl.brings) === JSON.stringify({ offerings: 2, faqs: 1, voice: true, colors: true }) && JSON.stringify(kit.brings) === JSON.stringify({ offerings: 0, faqs: 0, voice: false, colors: false }) && kit.kind === 'kit');
  ok('list: which site it came from, by its business name; a site that\'s gone has none', tpl.from_name === 'Maple & Main Realty' && kit.from_name === '');
  ok('list: a template\'s pages, photos and words are never sent', r.body.data.every((k) => !('payload' in k) && !('offerings' in k) && !('layout' in k)) && !JSON.stringify(r.body).includes('richtext'));
  ok('list: who may manage them rides along', r.body.can_manage === true && (await call(asMember({ member_id: RO, role: 'readonly' }), 'GET', '/agency/kits')).body.can_manage === false);
}

// ── rename ──
{
  reset();
  ok('rename: a view-only member can\'t', (await call(asMember({ member_id: RO, role: 'readonly' }), 'PATCH', `/agency/kits/${KIT}`, { name: 'x' })).status === 403);
  ok('rename: it needs a name', (await call(asMember(), 'PATCH', `/agency/kits/${KIT}`, { name: '   ' })).status === 400);
  ok('rename: another studio\'s kit is not found', (await call(asMember(), 'PATCH', `/agency/kits/${THEIRS}`, { name: 'Mine now' })).status === 404 && T.presence_starter_kits.find((k) => k.id === THEIRS).name === 'Not yours');
  const r = await call(asMember(), 'PATCH', `/agency/kits/${KIT}`, { name: '  Florist   — setup only ' });
  ok('rename: 200, the name tidied and saved, nothing else touched', r.status === 200 && r.body.data.name === 'Florist — setup only' && T.presence_starter_kits.find((k) => k.id === KIT).name === 'Florist — setup only' && writes.filter((w) => w.method === 'PATCH').every((w) => Object.keys(w.body).join() === 'name'));
}

// ── remove ──
{
  reset();
  ok('remove: a view-only member can\'t, and another studio\'s kit is not found', (await call(asMember({ member_id: RO, role: 'readonly' }), 'DELETE', `/agency/kits/${TPL}`)).status === 403 && (await call(asMember(), 'DELETE', `/agency/kits/${THEIRS}`)).status === 404 && deleted.length === 0);
  const k = await call(asMember(), 'DELETE', `/agency/kits/${KIT}`);
  ok('remove: a starter kit goes, with no files to clear', k.status === 200 && k.body.data.photos_removed === 0 && !T.presence_starter_kits.some((x) => x.id === KIT) && deleted.length === 0);
  const t = await call(asMember(), 'DELETE', `/agency/kits/${TPL}`);
  ok('remove: a template goes with its own photo copies', t.status === 200 && t.body.data.photos_removed === 2 && !T.presence_starter_kits.some((x) => x.id === TPL));
  ok('remove: …only from this studio\'s template folder — never a site\'s photo, never another studio\'s', deleted.length === 2 && deleted.every((d) => d.method === 'DELETE' && d.path.startsWith(`presence-media/templates/${AG}/`)) && !deleted.some((d) => d.path.includes(S1) || d.path.includes(OTHER)));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
