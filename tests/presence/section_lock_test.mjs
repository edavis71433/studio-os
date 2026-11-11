// ── Locked sections (builder list item 155, Nov 2026) ──
// The studio locks a section so its client can't break it by accident. This proves the
// server's half, pure and through the real PUT /settings:
//   · a client's save that leaves locked sections as they are goes through, whatever else it does
//   · removing one, moving it to another page, restyling it, swapping its photo or adding to
//     its lists is refused; its words may change only when its lock says so
//   · a client can't set a lock, clear one or copy one; renaming a page keeps its locks
//   · the studio and platform staff are never stopped
//
//   deno run --allow-read --allow-env --allow-net tests/presence/section_lock_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'SERVICE-KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'ANON-KEY');

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleSettings } = await import('../../supabase/functions/presence/routes/content.ts');
const { lockOf, lockedEdits, lockedMessage } = await import('../../supabase/functions/presence/lib/section_lock.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + n + (note ? ' — ' + note : '')); } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const what = (e) => e.map((x) => x.what + ':' + x.name).join(', ');

// a gallery the studio locked with its words open, a heading locked shut, and an open section
const GALLERY = { type: 'gallery', title: 'Fresh from the oven', layout: 'grid', items: [{ media_id: 'm1', alt: 'Sourdough', caption: 'Monday' }, { media_id: 'm2', alt: 'Rye', caption: '' }], style: { bg_color: '#f4efe6', text_color: '#241d1a' }, lock: { id: 'lk-gallery1', words: true } };
const HEAD = { type: 'title', title: 'Marlow’s Kitchen', subtitle: 'Since 1998', lock: { id: 'lk-head001', words: false } };
const OPEN = { type: 'richtext', title: 'Our story', body: 'Hello' };
const STORED = { blocks: [HEAD, GALLERY, OPEN], pages: [{ slug: 'lessons', title: 'Lessons', blocks: [clone(GALLERY), { type: 'faq', title: 'Questions' }] }] };
const home = (blocks) => ({ blocks });
const g = () => clone(GALLERY), h = () => clone(HEAD);

// the lock itself
ok('a lock is an id and whether words stay open', JSON.stringify(lockOf(GALLERY)) === '{"id":"lk-gallery1","words":true}' && JSON.stringify(lockOf(HEAD)) === '{"id":"lk-head001","words":false}');
ok('no lock, or a malformed one, is none', lockOf(OPEN) === null && lockOf({ lock: { id: 'x' } }) === null && lockOf({ lock: { id: 'BAD ID!!' } }) === null && lockOf({ lock: true }) === null && lockOf(null) === null);

// what a client may do
ok('nothing touched: nothing refused', lockedEdits(STORED, clone(STORED)).length === 0);
ok('the open section changed, a section added and one moved round: fine', lockedEdits(STORED, home([{ type: 'cta', title: 'Book' }, { ...OPEN, body: 'Hi there' }, h(), g()])).length === 0);
ok('keys in another order: still the same section', lockedEdits(STORED, home([h(), Object.fromEntries(Object.entries(g()).reverse()), OPEN])).length === 0);
{ const x = g(); x.title = 'This week’s bakes'; x.items[0].alt = 'A sourdough loaf'; x.items[1].caption = 'Tuesday';
  ok('words open: its heading, picture descriptions and captions may change', lockedEdits(STORED, home([h(), x, OPEN])).length === 0); }

// what a client may not
ok('removed: refused', what(lockedEdits(STORED, home([h(), OPEN]))) === 'removed:Fresh from the oven');
{ const x = h(); x.title = 'Marlow’s'; ok('words shut: a word changed is refused', what(lockedEdits(STORED, home([x, g(), OPEN]))) === 'changed:Marlow’s Kitchen'); }
{ const x = g(); x.style.bg_color = '#000000'; ok('restyled: refused', what(lockedEdits(STORED, home([h(), x, OPEN]))) === 'changed:Fresh from the oven'); }
{ const x = g(); x.layout = 'masonry'; ok('another layout: refused', what(lockedEdits(STORED, home([h(), x, OPEN]))) === 'changed:Fresh from the oven'); }
{ const x = g(); x.items[0].media_id = 'm9'; ok('a photo swapped: refused', what(lockedEdits(STORED, home([h(), x, OPEN]))) === 'changed:Fresh from the oven'); }
{ const x = g(); x.items.push({ media_id: 'm3', alt: '', caption: '' }); ok('a photo added: refused', what(lockedEdits(STORED, home([h(), x, OPEN]))) === 'changed:Fresh from the oven'); }
{ const x = g(); x.show_until = '2026-12-01'; ok('set to come off on a date: refused', what(lockedEdits(STORED, home([h(), x, OPEN]))) === 'changed:Fresh from the oven'); }
{ const x = g(); delete x.lock; ok('unlocked by the client: refused', what(lockedEdits(STORED, home([h(), x, OPEN]))) === 'removed:Fresh from the oven'); }
{ const x = g(); x.lock.words = false; ok('its words shut by the client: refused', what(lockedEdits(STORED, home([h(), x, OPEN]))) === 'changed:Fresh from the oven'); }
ok('a lock set by the client: refused', what(lockedEdits(STORED, home([h(), g(), { ...OPEN, lock: { id: 'lk-mine0001', words: true } }]))) === 'locked:Our story');
ok('a locked section copied: refused', what(lockedEdits(STORED, home([h(), g(), g(), OPEN]))) === 'locked:Fresh from the oven');

// pages
const pages = (list) => ({ pages: list });
ok('a save of Home leaves the pages alone, and a save of the pages leaves Home', lockedEdits(STORED, home([h(), g(), OPEN])).length === 0 && lockedEdits(STORED, pages(clone(STORED.pages))).length === 0);
ok('moved to another page: refused', what(lockedEdits(STORED, pages([{ slug: 'lessons', title: 'Lessons', blocks: [{ type: 'faq', title: 'Questions' }] }, { slug: 'menu', title: 'Menu', blocks: [g()] }]))) === 'removed:Fresh from the oven, locked:Fresh from the oven');   // gone from one page, a lock the client set on the other
ok('a page holding one, deleted: refused', what(lockedEdits(STORED, pages([]))) === 'removed:Fresh from the oven');
const renamed = [{ slug: 'classes', title: 'Lessons', blocks: clone(STORED.pages[0].blocks) }];
ok('a page’s address renamed: its locks follow it', lockedEdits(STORED, pages(renamed), { lessons: 'classes' }).length === 0 && what(lockedEdits(STORED, pages(renamed))) === 'removed:Fresh from the oven, locked:Fresh from the oven');

// the sentence
ok('the sentence names the section and who to ask', lockedMessage([{ name: 'Fresh from the oven', what: 'changed' }]) === 'Your studio locked “Fresh from the oven” so it stays as designed. Ask them if it needs to change. Nothing was changed.'
  && lockedMessage([{ name: 'x', what: 'locked' }]) === 'Only your studio can lock a section. Nothing was changed.' && lockedMessage([]) === '');

// ═══ through the real PUT /settings, against a stubbed PostgREST ═══
const SITE = '11111111-1111-4111-8111-111111111111';
const site = { id: SITE, status: 'ready', edition: 'presence' };
const client = { kind: 'client', userId: 'u1', tenantId: null, role: 'client', email: 'owner@example.com', jwt: 'jwt', requestId: 'r1' };
const studio = { ...client, scope: { site_id: SITE } };
const staff = { ...client, kind: 'staff' };
let T;
const reset = () => { T = { presence_settings: [{ site_id: SITE, ...clone(STORED), updated_at: '2026-01-01T00:00:00Z' }], presence_change_events: [] }; };
const matches = (row, params) => { for (const [k, v] of params.entries()) { if (['select', 'limit', 'order', 'on_conflict', 'offset'].includes(k)) continue; if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false; } return true; };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const reply = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', ''), method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null, rows = (T[table] ||= []);
  const hit = rows.filter((r) => matches(r, u.searchParams));
  if (method === 'GET') return reply(hit);
  if (method === 'POST') {
    const conflict = u.searchParams.get('on_conflict');
    let row = conflict ? rows.find((r) => r[conflict] === body[conflict]) : null;
    if (row) Object.assign(row, body); else { row = { id: crypto.randomUUID(), ...body }; rows.push(row); }
    return reply([row], 201);
  }
  return reply([]);
};
const db = (path, init) => svc(path, init);
const put = async (who, payload) => {
  const req = new Request('http://stub.local/functions/v1/presence/settings', { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  const r = await handleSettings(req, db, site, who, {});
  return { status: r.status, body: await r.json().catch(() => null) };
};
{
  reset();
  const x = g(); x.style.bg_color = '#000000';
  const r = await put(client, home([h(), x, OPEN]));
  ok('a client restyling a locked section: 403 and the sentence', r.status === 403 && r.body.error === 'section_locked' && /Your studio locked “Fresh from the oven”/.test(r.body.message), JSON.stringify(r.body));
  ok('…and nothing was written', JSON.stringify(T.presence_settings[0].blocks) === JSON.stringify(STORED.blocks));
  const y = g(); y.title = 'This week’s bakes';
  const r2 = await put(client, home([h(), y, { ...OPEN, body: 'Hi' }]));
  ok('a client changing its words (open) and another section: saved', r2.status === 200 && T.presence_settings[0].blocks[1].title === 'This week’s bakes', String(r2.status));
}
{
  reset();
  const x = g(); x.style.bg_color = '#000000'; delete x.lock;
  ok('the studio restyles and unlocks it: saved', (await put(studio, home([h(), x, OPEN]))).status === 200 && !T.presence_settings[0].blocks[1].lock);
  reset();
  ok('platform staff too', (await put(staff, home([h(), OPEN]))).status === 200);
  reset();
  ok('a client renaming a page that holds one: saved', (await put(client, pages([{ slug: 'classes', title: 'Lessons', prev_slug: 'lessons', blocks: clone(STORED.pages[0].blocks) }]))).status === 200);
  reset();
  ok('a client saving something else entirely: no extra check', (await put(client, { nav_style: 'centered' })).status === 200);
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  section lock — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
