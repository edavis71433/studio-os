// ── Builder list item 215: Changes, who changed what and when ──
//   deno run --allow-read --allow-env tests/presence/change_log_215_test.mjs
// Every save, publish, invite and checkpoint already kept, put in sentences: what each
// touched (field names, never values), who did it (the studio's team, a site's seats
// and owner by name; Studio OS for what ran by itself), repeated saves folded into one
// line, the People lines only for those who may manage people, and the band's numbers
// by who made the changes. The routes run against a stubbed database.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const C = await import(`${P}/lib/change_log.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

const SITE = '11111111-1111-4111-8111-111111111111';
const ERIC = 'aaaaaaaa-0000-4000-8000-000000000001', SAM = 'aaaaaaaa-0000-4000-8000-000000000002', JO = 'aaaaaaaa-0000-4000-8000-000000000003', GONE = 'aaaaaaaa-0000-4000-8000-000000000009';
const ev = (id, at, et, action, o = {}) => ({ id: String(id), at, site_id: SITE, source: 'event', actor: ERIC, actor_kind: 'staff', entity_type: et, action, summary: '', fields: [], entity_id: null, ...o });
const say = (r, names) => { const w = C.describeEvent(r, { item: 'menu item', items: 'menu items', offeringsLabel: 'Menu' }, names || new Map()); return w ? w.text : null; };

// ── 1. a save in words ──
{
  eq('identity: the fields named, never their values', [
    say(ev(1, 't', 'identity', 'update', { fields: ['phone'] })), say(ev(2, 't', 'identity', 'update', { fields: ['business_name', 'tagline', 'email'] })),
    say(ev(3, 't', 'identity', 'update', { fields: ['business_name', 'tagline', 'email', 'phone'] })), say(ev(4, 't', 'identity', 'update', { fields: [] })),
  ], ['changed the phone number', 'changed the business name, the tagline and the email address', 'changed the business details', 'changed the business details']);
  eq('location: hours, the address once for its four fields', [say(ev(1, 't', 'location', 'update', { fields: ['hours'] })), say(ev(2, 't', 'location', 'update', { fields: ['address_line1', 'city', 'postal_code'] }))], ['changed the opening hours', 'changed the address']);
  const names = new Map([['o1', 'Birthday cake']]);
  eq('items: the site’s own word, the item’s name when it still has one', [
    say(ev(1, 't', 'offering', 'create')), say(ev(2, 't', 'offering', 'update', { entity_id: 'o1', fields: ['price_text'] }), names),
    say(ev(3, 't', 'offering', 'delete', { entity_id: 'o9' })), say(ev(4, 't', 'offering', 'reorder')), say(ev(5, 't', 'faq', 'hide')), say(ev(6, 't', 'testimonial', 'show')),
  ], ['added a menu item', 'changed the price of “Birthday cake”', 'removed a menu item', 'reordered the menu items', 'hid a question', 'showed again a review']);
  eq('blog: its own sentence', say(ev(1, 't', 'post', 'update', { summary: 'Published a blog post' })), 'published a blog post');
  eq('photos: added, removed, the file manager’s own words, a code-like one plainly', [
    say(ev(1, 't', 'media', 'create', { summary: 'Added a photo' })), say(ev(2, 't', 'media', 'delete', { summary: 'Removed a photo' })),
    say(ev(3, 't', 'media', 'update', { summary: 'Moved 3 files from the folder “A” to “B”' })), say(ev(4, 't', 'media', 'update', { summary: 'File approve → approved' })),
  ], ['added a photo', 'removed a photo', 'moved 3 files from the folder “A” to “B”', 'changed a file']);
  eq('settings: by the fields a save touched', [
    say(ev(1, 't', 'settings', 'update', { summary: 'Updated site settings', fields: ['blocks'] })), say(ev(2, 't', 'settings', 'update', { summary: 'Updated site settings', fields: ['nav'] })),
    say(ev(3, 't', 'settings', 'update', { summary: 'Updated site settings', fields: ['announcement_text', 'announcement_url'] })), say(ev(4, 't', 'settings', 'update', { summary: 'Updated site settings', fields: ['visit_counter'] })),
    say(ev(5, 't', 'settings', 'update', { summary: 'Updated site settings', fields: ['mystery'] })),
  ], ['changed the page sections', 'changed the menu', 'changed the announcement bar', 'changed the visit counter', 'changed the website']);
  eq('settings: a save with its own sentence keeps it, arrows in words', [say(ev(1, 't', 'settings', 'update', { summary: 'Changed the site’s look to Business Classic', fields: ['template_slug'] })), say(ev(2, 't', 'settings', 'update', { summary: 'Changed a page address /a/ → /b/ and added a forward.' }))], ['changed the site’s look to Business Classic', 'changed a page address /a/ to /b/ and added a forward']);
  const area = (r) => C.describeEvent(r).area;
  eq('areas: website, settings, photos', [area(ev(1, 't', 'settings', 'update', { summary: 'Updated site settings', fields: ['google_site_verification'] })), area(ev(2, 't', 'settings', 'update', { summary: 'Updated site settings', fields: ['blocks'] })), area(ev(3, 't', 'media', 'create', { summary: 'Added a photo' })), area(ev(4, 't', 'domain', 'update', { summary: 'Attached domain x.example' }))], ['settings', 'website', 'photos', 'settings']);
  eq('site: set up, status, offline in its words; a handover is People', [
    say(ev(1, 't', 'site', 'create', { summary: 'Provisioned website hosting' })), say(ev(2, 't', 'site', 'update', { summary: 'Site status: live → archived' })),
    say(ev(3, 't', 'site', 'update', { summary: 'Took the website offline — visitors see a simple “temporarily offline” page. Every version is kept.' })),
  ], ['set up the website', 'changed the site from live to archived', 'took the website offline']);
  eq('site: what a kept sentence said after its dash is its own line', C.summaryDetail('Took the website offline — visitors see a simple “temporarily offline” page. Every version is kept.'), 'Visitors see a simple “temporarily offline” page. Every version is kept');
  eq('site: a handover’s area', C.describeEvent(ev(1, 't', 'site', 'update', { summary: 'Started handing the site to new@owner.example' })).area, 'people');
  eq('publish events: the publish’s own record tells it; naming a version stays', [say(ev(1, 't', 'publish', 'publish', { summary: '1 photos change' })), say(ev(2, 't', 'publish', 'update', { summary: 'Named a kept version “Spring”' }))], [null, 'named a kept version “Spring”']);
  eq('restores: one that went live is a publish; into the draft stays', [say(ev(1, 't', 'restore', 'restore', { summary: 'Restored the version from Nov 9' })), say(ev(2, 't', 'restore', 'restore', { summary: 'Brought the version from Nov 9 into the draft' }))], [null, 'brought the version from Nov 9 into the draft']);
}

// ── 2. publishes, seats and checkpoints in words ──
{
  const pub = (o) => ({ id: 'p1', at: '2026-11-15T16:40:00Z', site_id: SITE, source: 'publish', actor: ERIC, actor_kind: 'staff', kind: 'publish', status: 'live', summary: '2 settings changes, 1 photos change', label: '', ...o });
  eq('publish: what went live, counted from its kept summary', C.describePublish(pub({})).text, 'published the site. 3 changes went live');
  eq('publish: a named version says its name', C.describePublish(pub({ label: 'Spring menu', summary: '' })).text, 'published the site as “Spring menu”. The changes went live');
  eq('publish: a failed one says it didn’t go live; one still on its way waits; a skipped one says nothing', [C.describePublish(pub({ status: 'failed' })).text, C.describePublish(pub({ status: 'publishing' })), C.describePublish(pub({ unchanged: true }))], ['tried to publish; it didn’t go live', null, null]);
  eq('publish: a restore that went live', C.describePublish(pub({ kind: 'restore', summary: 'Restored the version from Nov 9' })).text, 'restored the version from Nov 9, and it went live');
  eq('publish: Publish again (item 214) reads as the version going live again, by name or by day', [C.describePublish(pub({ kind: 'restore', summary: 'Published again: “Spring menu”' })).text, C.describePublish(pub({ kind: 'restore', summary: 'Published again: the version from Nov 9' })).text], ['published “Spring menu” again', 'published the version from Nov 9 again']);
  eq('restores: Publish again’s own event is told by its publish', say(ev(3, 't', 'restore', 'restore', { summary: 'Published again: “Spring menu”' })), null);
  eq('site: the publishing lock (item 214) in its own words, under Versions', [say(ev(4, 't', 'site', 'update', { summary: 'Locked publishing: “Launch week”' })), say(ev(5, 't', 'site', 'update', { summary: 'Unlocked publishing' })), C.describeEvent(ev(6, 't', 'site', 'update', { summary: 'Changed the note on the publishing lock' })).where], ['locked publishing: “Launch week”', 'unlocked publishing', 'Website › Versions']);
  eq('count: from the kept summary', [C.countFromSummary('2 settings changes, 1 photos change'), C.countFromSummary('Publishing your site'), C.countFromSummary('1 publish change')], [3, null, 1]);
  eq('names: from an address, words split and capitalised', [C.nameFromEmail('mia.chen@studio.example'), C.nameFromEmail('eric@davisdigitalstudio.com'), C.nameFromEmail('jo_park+site@x.example'), C.nameFromEmail('1234@x.example')], ['Mia Chen', 'Eric', 'Jo Park Site', '']);
}

// ── 3. who did it, and the lines folded ──
{
  const people = new Map([
    [ERIC, { name: 'Eric', email: 'eric@studio.example', side: 'studio' }],
    [SAM, { name: 'Sam Lee', email: 'sam@bakery.example', side: 'owner' }],
    [JO, { name: 'Jo Park', email: 'jo@bakery.example', side: 'seat', role: 'business_staff' }],
  ]);
  const ctx = (o = {}) => ({ viewer: null, viewerSide: 'studio', people, ownerOf: new Map([[SITE, people.get(SAM)]]), canPeople: true, ...o });
  const w = (r, o) => { const x = C.whoOf(r, ctx(o)); return [x.who, x.who_note, x.side]; };
  eq('who: the studio by name, the owner, a seat with its role', [w(ev(1, 't', 'identity', 'update')), w(ev(2, 't', 'identity', 'update', { actor: SAM, actor_kind: 'client' })), w(ev(3, 't', 'identity', 'update', { actor: JO, actor_kind: 'client' }))], [['Eric', '', 'studio'], ['Sam Lee', 'the owner', 'owner'], ['Jo Park', 'staff', 'seat']]);
  eq('who: a client reading their own site: “You”, and the studio “from your studio”', [w(ev(1, 't', 'identity', 'update', { actor: SAM }), { viewer: SAM, viewerSide: 'client' }), w(ev(2, 't', 'identity', 'update'), { viewer: SAM, viewerSide: 'client' })], [['You', '', 'you'], ['Eric', 'from your studio', 'studio']]);
  eq('who: what ran by itself is Studio OS; an unknown sign-in by its side', [w(ev(1, 't', 'publish', 'update', { actor: null, actor_kind: 'system' })), w(ev(2, 't', 'identity', 'update', { actor: 'scheduler' })), w(ev(3, 't', 'identity', 'update', { actor: GONE, actor_kind: 'operator' })), w(ev(4, 't', 'identity', 'update', { actor: GONE, actor_kind: 'client' }))],
    [['Studio OS', '', 'auto'], ['Studio OS', '', 'auto'], ['Someone at your studio', '', 'studio'], ['Someone on the client’s side', '', 'unknown']]);
  eq('who: an invite by "owner" is the site’s owner', w({ id: 'm', at: 't', site_id: SITE, source: 'member', actor: 'owner' }), ['Sam Lee', 'the owner', 'owner']);

  const photo = (id, at, actor = ERIC) => ev(id, at, 'media', 'create', { summary: 'Added a photo', actor });
  const rows = [
    photo(1, '2026-11-15T17:21:00Z'), photo(2, '2026-11-15T17:19:00Z'), photo(3, '2026-11-15T17:18:00Z'), photo(4, '2026-11-15T17:00:00Z'),
    photo(5, '2026-11-15T15:00:00Z'),                      // more than half an hour after the run: its own line
    photo(6, '2026-11-15T14:59:00Z', JO),                  // someone else: its own line
    ev(7, '2026-11-15T14:00:00Z', 'location', 'update', { fields: ['hours'], actor: SAM }),
    { id: 'mem1', at: '2026-11-14T10:00:00Z', site_id: SITE, source: 'member', actor: ERIC, email: 'lee@pixel.example', role: 'designer', state: 'invited' },
    { id: 'mem2', at: '2026-11-13T10:00:00Z', site_id: SITE, source: 'member', actor: null, email: 'old@pixel.example', role: 'business_staff', state: 'removed' },
    { id: 'cp1', at: '2026-11-12T10:00:00Z', site_id: SITE, source: 'checkpoint', actor: ERIC, name: 'Before the spring menu' },
    { id: 'pub1', at: '2026-11-12T09:00:00Z', site_id: SITE, source: 'publish', actor: ERIC, actor_kind: 'staff', kind: 'publish', status: 'live', summary: '1 photos change' },
  ];
  const items = C.changeItems(rows, ctx());
  eq('fold: a run of the same thing by the same person within half an hour is one line', items.map((i) => [i.who, i.text, i.count]), [
    ['Eric', 'added 4 photos', 4], ['Eric', 'added a photo', 1], ['Jo Park', 'added a photo', 1], ['Sam Lee', 'changed the opening hours', 1],
    ['Eric', 'invited lee@pixel.example as a Designer', 1], ['', 'old@pixel.example no longer has access', 1], ['Eric', 'saved a checkpoint “Before the spring menu”', 1], ['Eric', 'published the site. 1 change went live', 1],
  ]);
  eq('fold: the line spans its run, newest to first', [items[0].at, items[0].from], ['2026-11-15T17:21:00Z', '2026-11-15T17:00:00Z']);
  eq('fold: a publish that went live can open what went live', items.filter((i) => i.publish_id).map((i) => i.publish_id), ['pub1']);
  eq('people: the People lines only for those who may manage people', C.changeItems(rows, ctx({ canPeople: false })).filter((i) => i.area === 'people').length, 0);
  const sum = C.changeSummary(items, ['2026-11-14', '2026-11-15'], (iso) => iso.slice(0, 10));
  eq('band: counted by who made them, each save counted, a line with no one left out', [sum.total, sum.by_side, sum.went_live], [10, { studio: 8, client: 2, auto: 0 }, 1]);
  eq('band: the people, most first', sum.people.slice(0, 3).map((p) => [p.who, p.count]), [['Eric', 8], ['Jo Park', 1], ['Sam Lee', 1]]);
  eq('band: by day', sum.days, [{ day: '2026-11-14', studio: 1, client: 0, auto: 0 }, { day: '2026-11-15', studio: 5, client: 2, auto: 0 }]);
  eq('sides: “You” are on the reader’s side', [C.sideOf('you', 'client'), C.sideOf('you', 'studio'), C.sideOf('support'), C.sideOf('seat'), C.sideOf('auto')], ['client', 'studio', 'studio', 'client', 'auto']);
}

// ── 4. the routes, against a stubbed database ──
{
  const L = await import(`${P}/routes/change_log.ts`);
  eq('page: ?before= or now', [L.beforeOf('2026-11-10T00:00:00Z', 'NOW'), L.beforeOf('nonsense', 'NOW'), L.beforeOf(null, 'NOW')], ['2026-11-10T00:00:00.000Z', 'NOW', 'NOW']);
  const raw = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), at: new Date(Date.UTC(2026, 10, 15, 12) - i * 60_000).toISOString(), site_id: SITE, source: 'event' }));
  const p1 = L.pageOf({ rows: raw(10), floor: raw(10)[4].at });
  eq('page: a page never passes the oldest record of a source that filled its read', [p1.rows.length, p1.next], [5, raw(10)[4].at]);
  const p2 = L.pageOf({ rows: raw(200), floor: null });
  eq('page: 160 at most, the next page from the last shown', [p2.rows.length, p2.next], [L.PAGE_RAW, raw(200)[L.PAGE_RAW - 1].at]);
  eq('page: everything read and nothing left: no next page', L.pageOf({ rows: raw(3), floor: null }).next, null);
  const its = [{ area: 'website', side: 'studio' }, { area: 'photos', side: 'owner' }, { area: 'live', side: 'auto' }, { area: 'website', side: 'you' }];
  eq('filter: by area and by who; “You” are on the reader’s side', [L.filterItems(its, 'website', null).length, L.filterItems(its, null, 'client').length, L.filterItems(its, null, 'client', 'client').length, L.filterItems(its, null, 'auto').length, L.filterItems(its, 'nonsense', 'nobody').length], [2, 1, 2, 1, 4]);
  eq('clock: the month starts on the reader’s clock', [L.monthStartIn('2026-11-15T10:00:00Z', 'America/Los_Angeles'), L.monthStartIn('2026-11-15T10:00:00Z', 'UTC'), L.monthStartIn('2026-12-01T03:00:00Z', 'America/Los_Angeles')], ['2026-11-01T07:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T07:00:00.000Z']);
  eq('clock: the last seven days, oldest first', L.daysBack('2026-11-15T10:00:00Z', 7, 'UTC'), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);

  const AG = 'bbbbbbbb-0000-4000-8000-000000000001', CLIENT = 'cccccccc-0000-4000-8000-000000000001', CONTACT = 'dddddddd-0000-4000-8000-000000000001';
  const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url)); const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
    asked.push(`${table}?${q}`);
    if (table === 'presence_change_events') return reply(/created_at=gte/.test(q) ? [] : [
      { id: 11, site_id: SITE, entity_type: 'location', entity_id: null, action: 'update', summary: 'Updated hours & location', actor_user_id: ERIC, actor_kind: 'operator', detail: { fields: ['hours'] }, created_at: '2026-11-15T16:32:00Z' },
      { id: 10, site_id: SITE, entity_type: 'identity', entity_id: null, action: 'update', summary: 'Updated business details', actor_user_id: SAM, actor_kind: 'client', detail: { fields: ['phone'] }, created_at: '2026-11-15T14:10:00Z' },
      { id: 9, site_id: SITE, entity_type: 'offering', entity_id: 'eeeeeeee-0000-4000-8000-000000000001', action: 'update', summary: 'Updated a offering', actor_user_id: ERIC, actor_kind: 'operator', detail: { fields: ['price_text'] }, created_at: '2026-11-14T10:00:00Z' },
    ]);
    if (table === 'presence_publishes') return reply([{ id: 'ffffffff-0000-4000-8000-000000000001', site_id: SITE, kind: 'publish', status: 'live', actor: ERIC, actor_kind: 'operator', change_summary: '3 settings changes', version_label: '', unchanged: false, created_at: '2026-11-15T16:40:00Z' }]);
    if (table === 'presence_site_members') return reply(/select=site_id,email,user_id,role/.test(q) ? [{ site_id: SITE, email: 'jo@bakery.example', user_id: JO, role: 'business_staff' }] : [{ id: 'm1', site_id: SITE, email: 'jo@bakery.example', role: 'business_staff', status: 'active', invited_by: SAM, created_at: '2026-11-13T09:00:00Z', updated_at: '2026-11-13T09:00:00Z' }]);
    if (table === 'presence_launches') return reply([]);
    if (table === 'presence_agency_clients') return reply([{ agency_id: AG, site_id: SITE }]);
    if (table === 'presence_agency_members') return reply([{ email: 'eric@studio.example', user_id: ERIC, role: 'owner' }]);
    if (table === 'presence_sites') return reply([{ id: SITE, client_id: CLIENT }]);
    if (table === 'clients') return reply([{ id: CLIENT, name: 'Bluebird Bakery', email: 'sam@bakery.example', contact_email: '', contact_id: CONTACT }]);
    if (table === 'contacts') return reply([{ id: CONTACT, name: 'Sam Lee', email: 'sam@bakery.example', auth_user_id: SAM }]);
    if (table === 'presence_offerings') return reply([{ id: 'eeeeeeee-0000-4000-8000-000000000001', name: 'Birthday cake' }]);
    if (table === 'presence_settings') return reply([{ site_id: SITE, industry_key: 'bakery' }]);
    if (table === 'presence_identity') return reply([{ site_id: SITE, business_name: 'Bluebird Bakery' }]);
    return reply([]);
  };
  const site = { id: SITE, client_id: CLIENT, edition: 'presence' };
  const studio = { userId: ERIC, kind: 'client', scope: { site_id: SITE, name: 'Bluebird Bakery' } };
  const r1 = await (await L.handleChangeLog(new Request('http://x/change-log?tz=UTC'), site, studio, {}, '2026-11-15T18:00:00Z')).json();
  eq('site: the studio reads every line in sentences, names and all', r1.data.items.map((i) => [i.who, i.who_note, i.text]), [
    ['Eric', '', 'published the site. 3 changes went live'], ['Eric', '', 'changed the opening hours'], ['Sam Lee', 'the owner', 'changed the phone number'],
    ['Eric', '', 'changed the price of “Birthday cake”'], ['Sam Lee', 'the owner', 'invited jo@bakery.example as Staff'],
  ]);
  eq('site: the band, this month so far', [r1.data.month.label, r1.data.month.total, r1.data.month.went_live, r1.data.month.by_side, r1.data.site_name, r1.data.viewer_side, r1.data.next_before], ['November', 5, 1, { studio: 3, client: 2, auto: 0 }, 'Bluebird Bakery', 'studio', null]);
  const staff = { userId: JO, kind: 'client', member: { site_id: SITE, role: 'business_staff' } };
  const r2 = await (await L.handleChangeLog(new Request('http://x/change-log?tz=UTC&who=client'), site, staff, {}, '2026-11-15T18:00:00Z')).json();
  eq('site: a staff seat doesn’t see who was invited; the Who filter keeps the client’s side', [r2.data.can_people, r2.data.items.map((i) => [i.who, i.who_note, i.text])], [false, [['Sam Lee', 'the owner', 'changed the phone number']]]);
  const owner = { userId: SAM, kind: 'client' };
  const r3 = await (await L.handleChangeLog(new Request('http://x/change-log?tz=UTC&area=website'), site, owner, {}, '2026-11-15T18:00:00Z')).json();
  eq('site: the owner reads “You”, and the studio “from your studio”', r3.data.items.map((i) => [i.who, i.who_note, i.text]), [['Eric', 'from your studio', 'changed the opening hours'], ['You', '', 'changed the phone number'], ['Eric', 'from your studio', 'changed the price of “Birthday cake”']]);
  ok('reads: field names and ids only, and each source newest first in one window', asked.some((a) => /presence_change_events\?.*select=id,site_id,entity_type,entity_id,action,summary,actor_user_id,actor_kind,detail,created_at&order=created_at\.desc&limit=200/.test(a)) && !asked.some((a) => /presence_snapshots/.test(a)));

  const member = { agency_id: AG, role: 'owner', email: 'eric@studio.example' };
  const ra = await (await L.handleAgencyChangeLog(new Request('http://x/agency/change-log?tz=UTC'), '/agency/change-log', 'GET', member, {}, '2026-11-15T18:00:00Z')).json();
  eq('studio: every client’s lines, each with its site', ra.data.items.slice(0, 2).map((i) => [i.who, i.text, i.site]), [['Eric', 'published the site. 3 changes went live', 'Bluebird Bakery'], ['Eric', 'changed the opening hours', 'Bluebird Bakery']]);
  eq('studio: the week by day and by who', [ra.data.week.total, ra.data.week.by_side, ra.data.week.days.length, ra.data.week.sites[0].name, ra.data.week.site_count, ra.data.can_people], [5, { studio: 3, client: 2, auto: 0 }, 7, 'Bluebird Bakery', 1, true]);
  const viewOnly = await (await L.handleAgencyChangeLog(new Request('http://x/agency/change-log?tz=UTC'), '/agency/change-log', 'GET', { ...member, role: 'designer' }, {}, '2026-11-15T18:00:00Z')).json();
  ok('studio: a role that can’t open a client reads its people unnamed, and no People lines', viewOnly.data.can_people === false && viewOnly.data.items.every((i) => i.area !== 'people') && viewOnly.data.items.some((i) => i.who === 'Someone on their side'));
  eq('studio: a route that isn’t this one is passed on', await L.handleAgencyChangeLog(new Request('http://x/agency/sites'), '/agency/sites', 'GET', member, {}), null);
  const gone = await L.handleAgencyChangeLog(new Request(`http://x/agency/change-log/went-live?site=99999999-0000-4000-8000-000000000000&id=ffffffff-0000-4000-8000-000000000001`), '/agency/change-log/went-live', 'GET', member, {});
  eq('studio: what went live, only for one of its clients', gone.status, 404);

  const idx = read(`${P}/index.ts`), ag = read(`${P}/agency/routes.ts`), ws = read(`${P}/routes/workspace.ts`);
  ok('wiring: the site routes are read only, after the reviewer boundary', /route === '\/change-log' && method === 'GET'\) return handleChangeLog\(req, site, principal, cors\)/.test(idx) && /route === '\/change-log\/went-live' && method === 'GET'\) return handleWentLive\(req, site, cors\)/.test(idx) && idx.indexOf("route === '/change-log'") > idx.indexOf('reviewerAllowed(route, method)'));
  ok('wiring: a reviewer is never let in', !/change-log/.test(ws));
  ok('wiring: the studio route', /handleAgencyChangeLog\(req, route, method, member, cors, now\)/.test(ag));
  // item 220: a Designer's list of routes leaves /change-log off, so the editor's link hides for them
  ok('wiring: the editor’s link to Changes is for those who see the business', /id="activityChanges" href="\/changes\.html" data-needs="business"/.test(read('../../presence.html')));
}

const failed = results.filter((r) => !r.p).length;
console.log(`change_log_215: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
