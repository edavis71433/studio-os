// ── Sales quick fixes (Nov 2026): S4 (picked lists only reach your own people, a
// daily cap) and item 65 (the Pipeline's bulk edges). Real handlers against the
// shared in-memory PostgREST; every name and address is made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_quick_fixes_test.mjs
Deno.env.set('RESEND_KEY', 'test-resend-key');
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const CUST = '66666666-6666-4666-8666-666666666666', PROJ = '55555555-5555-4555-8555-555555555555';
const LIST = 'aaaaaaaa-0000-4000-8000-000000000001', BC = 'ffffffff-0000-4000-8000-000000000001';
const db = installFakePostgrest({ unique: { presence_sales_templates: [{ cols: ['site_id', 'kind', 'name'], where: (r) => r.deleted_at == null && /^__.*__$/.test(String(r.name)) }] } });
const B = await import('../../supabase/functions/presence/routes/broadcasts.ts');
const L = await import('../../supabase/functions/presence/lib/broadcast.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const listsRow = (lists) => ({ id: 'tpl-lists', site_id: SITE, kind: 'proposal', name: '__broadcast_lists__', body: JSON.stringify(lists), deleted_at: null, updated_at: hoursAgo(48) });
const world = (over = {}) => ({
  presence_contacts: [{ id: 'eeeeeeee-0000-4000-8000-000000000001', site_id: SITE, name: 'Ana Ruiz', email: 'Ana@Example.com', deleted_at: null, updated_at: hoursAgo(5) }],
  presence_form_submissions: [{ id: 'cccccccc-0000-4000-8000-000000000001', site_id: SITE, email: 'riley@example.com', name: 'Riley', status: 'new', spam: false, created_at: hoursAgo(30) }],
  presence_service_links: [{ project_id: PROJ, agency_site_id: SITE, customer_client_id: CUST, status: 'active' }],
  clients: [{ id: CUST, name: 'Jordan Ellis', email: 'jordan@example.com', contact_email: null }],
  presence_sales_templates: [listsRow([{ id: LIST, name: 'Spring offer', people: [{ email: 'ana@example.com', name: 'Ana' }, { email: 'stranger@elsewhere.test', name: 'Stranger' }], created_at: hoursAgo(72) }])],
  presence_broadcasts: [],
  presence_broadcast_sends: [],
  ...over,
});
const sends = () => db.log.filter((c) => c.method === 'POST' && c.url === '/emails');

// ═══ S4 · a picked list keeps only your own people ═══
{
  ok('keepKnown: case-insensitive, counts who was left out', (() => { const r = L.keepKnown([{ email: 'A@x.com' }, { email: 'b@y.com' }, {}], new Set(['a@x.com'])); return r.kept.length === 1 && r.kept[0].email === 'A@x.com' && r.dropped === 2; })());

  db.reset(world());
  const r = await res(await B.handleBroadcastListCreate(req('POST', '/broadcasts/lists', { name: 'Mixed', people: [{ email: 'ana@example.com' }, { email: 'RILEY@example.com' }, { email: 'jordan@example.com' }, { email: 'stranger@elsewhere.test' }] }), site, owner, cors));
  const saved = JSON.parse(db.tables.presence_sales_templates.find((t) => t.name === '__broadcast_lists__').body);
  const mixed = saved.find((l) => l.name === 'Mixed');
  ok('list create: a contact, an enquiry and a customer stay; a stranger is left out', r.status === 201 && mixed && mixed.people.map((p) => p.email).sort().join(',') === 'ana@example.com,jordan@example.com,riley@example.com', JSON.stringify(mixed));
  ok('list create: the answer says how many were left out (the composer tells you)', r.body?.data?.left_out === 1 && r.body?.data?.count === 3, JSON.stringify(r.body));
  ok('list create: the known-people reads are this studio\'s only', db.reads('presence_contacts').every((c) => c.url.includes(`site_id=eq.${SITE}`)) && db.reads('presence_form_submissions').every((c) => c.url.includes(`site_id=eq.${SITE}`)) && db.reads('presence_service_links').every((c) => c.url.includes(`agency_site_id=eq.${SITE}`)));

  db.reset(world());
  const none = await res(await B.handleBroadcastListCreate(req('POST', '/broadcasts/lists', { people: [{ email: 'stranger@elsewhere.test' }] }), site, owner, cors));
  ok('list create: only strangers → refused, nothing saved', none.status === 422 && /contacts, enquiries or customers/.test(none.body?.message || '') && JSON.parse(db.tables.presence_sales_templates[0].body).length === 1, JSON.stringify(none));

  db.reset(world()); db.fail.add('presence_contacts');
  const down = await res(await B.handleBroadcastListCreate(req('POST', '/broadcasts/lists', { people: [{ email: 'ana@example.com' }] }), site, owner, cors));
  ok('list create: when your people can\'t be read, nothing is saved (503, never "keep everyone")', down.status === 503 && JSON.parse(db.tables.presence_sales_templates[0].body).length === 1, JSON.stringify(down));

  // a list saved BEFORE this check still reaches only your own people
  db.reset(world());
  const rows = await L.fetchAudienceRows(SITE, `list:${LIST}`);
  ok('send time: an older list with a stranger on it reaches only the known person', rows.length === 1 && rows[0].email === 'ana@example.com', JSON.stringify(rows));
  db.reset(world()); db.fail.add('presence_form_submissions');
  let threw = false; try { await L.fetchAudienceRows(SITE, `list:${LIST}`); } catch { threw = true; }
  ok('send time: when your people can\'t be read, the list resolves to an error, never to strangers', threw);

  db.reset(world());
  const g = await res(await B.handleBroadcastSegments(site, cors));
  const seg = (g.body?.data?.segments || []).find((s) => s.key === `list:${LIST}`);
  ok('the audience picker counts a list by the people it can actually reach', seg && seg.count === 1 && /1 person/.test(seg.description), JSON.stringify(seg));
}

// ═══ S4 · the daily cap ═══
{
  const prev = Deno.env.get('BROADCAST_DAILY_CAP');
  Deno.env.delete('BROADCAST_DAILY_CAP');
  ok('cap: 5,000 people a day by default', L.dailySendCap() === 5000);
  Deno.env.set('BROADCAST_DAILY_CAP', '2'); ok('cap: BROADCAST_DAILY_CAP overrides it', L.dailySendCap() === 2);
  Deno.env.set('BROADCAST_DAILY_CAP', 'nonsense'); ok('cap: a nonsense override falls back to 5,000', L.dailySendCap() === 5000);
  ok('cap: the boundary is "more than the cap"', L.overDailyCap(4999, 1, 5000) === false && L.overDailyCap(4999, 2, 5000) === true);
  ok('cap: the words say the cap, what went out and what this one needs', L.dailyCapMessage(4800, 300, 5000) === 'Updates can reach 5,000 people a day. 4,800 already went out in the last 24 hours, and this one would reach 300. Send it tomorrow, or send it to fewer people.');

  // what went out in the last 24 hours: finished updates in the window, plus any still going out (never the one being sent)
  db.reset(world({ presence_broadcasts: [
    { id: 'b0000000-0000-4000-8000-000000000001', site_id: SITE, status: 'sent', sent_at: hoursAgo(2), sent_count: 3 },
    { id: 'b0000000-0000-4000-8000-000000000002', site_id: SITE, status: 'sent', sent_at: hoursAgo(30), sent_count: 50 },
    { id: 'b0000000-0000-4000-8000-000000000003', site_id: SITE, status: 'sending', recipient_count: 4 },
    { id: BC, site_id: SITE, status: 'sending', recipient_count: 9 },
    { id: 'b0000000-0000-4000-8000-000000000004', site_id: '99999999-9999-4999-8999-999999999999', status: 'sent', sent_at: hoursAgo(1), sent_count: 1000 },
  ] }));
  ok('sentInLastDay: this studio, last 24 hours, plus what is still going out, minus the one being sent', (await L.sentInLastDay(SITE, Date.now(), BC)) === 7);

  // send now, over the cap → 429 with the words; nothing claimed, nothing sent
  Deno.env.set('BROADCAST_DAILY_CAP', '2');
  db.reset(world({ presence_broadcasts: [
    { id: BC, site_id: SITE, subject: 'Spring news', body: 'Hello there', audience: 'enquiries', status: 'draft' },
    { id: 'b0000000-0000-4000-8000-000000000001', site_id: SITE, status: 'sent', sent_at: hoursAgo(1), sent_count: 2 },
  ] }));
  const capped = await res(await B.handleBroadcastSend(req('POST', `/broadcasts/${BC}/send`, {}), site, owner, BC, cors));
  ok('send now: over the daily cap → 429 with the reason, in plain words', capped.status === 429 && capped.body?.error === 'daily_cap' && /Updates can reach 2 people a day\. 2 already went out/.test(capped.body?.message || ''), JSON.stringify(capped));
  ok('send now: …and nothing went out, the draft stays a draft', sends().length === 0 && db.tables.presence_broadcasts.find((b) => b.id === BC).status === 'draft');

  // under the cap it sends as before
  Deno.env.set('BROADCAST_DAILY_CAP', '5');
  db.reset(world({ presence_broadcasts: [{ id: BC, site_id: SITE, subject: 'Spring news', body: 'Hello there', audience: 'enquiries', status: 'draft' }] }));
  const sent = await res(await B.handleBroadcastSend(req('POST', `/broadcasts/${BC}/send`, {}), site, owner, BC, cors));
  ok('send now: under the cap it goes out as before', sent.status === 200 && sends().length === 1 && db.tables.presence_broadcasts.find((b) => b.id === BC).status === 'sent', JSON.stringify(sent));

  // dispatch is the last guard (two sends racing): it throws before ANY email
  let mailed = 0; let capErr = null;
  try {
    await L.dispatchBroadcast({ id: BC, site_id: SITE, subject: 'S', body: 'B', audience: 'contacts' }, {
      loadBrand: async () => ({ name: 'Studio' }), sendFn: async () => { mailed++; return true; },
      claimFn: async () => 'inserted', resolveFn: async () => ({ recipients: [{ email: 'a@x.com', firstName: 'A' }, { email: 'b@x.com', firstName: 'B' }], suppressed: 0, audience: 2 }),
      sentInLastDayFn: async () => 4, dailyCap: 5,
    });
  } catch (e) { capErr = e; }
  ok('dispatch: over the cap it throws DailyCapError before any email goes out', capErr instanceof L.DailyCapError && mailed === 0 && capErr.used === 4 && capErr.n === 2 && capErr.cap === 5);

  // the cron: a capped scheduled update waits (back to scheduled) and is NOT a failure
  Deno.env.set('BROADCAST_DAILY_CAP', '1');
  db.reset(world({ presence_broadcasts: [
    { id: BC, site_id: SITE, subject: 'Spring news', body: 'Hello there', audience: 'enquiries', status: 'scheduled', scheduled_at: hoursAgo(1) },
    { id: 'b0000000-0000-4000-8000-000000000001', site_id: SITE, status: 'sent', sent_at: hoursAgo(1), sent_count: 1 },
  ] }));
  const tick = await L.runScheduledBroadcasts();
  ok('cron: a capped update is held for a later tick, not counted as a failure (no health alarm)', tick.failures === 0 && tick.dispatched === 0 && db.tables.presence_broadcasts.find((b) => b.id === BC).status === 'scheduled' && sends().length === 0, JSON.stringify(tick));
  if (prev === undefined) Deno.env.delete('BROADCAST_DAILY_CAP'); else Deno.env.set('BROADCAST_DAILY_CAP', prev);
}

// ═══ item 65 · exactly the picked deals' contacts ═══
{
  const C1 = 'eeeeeeee-0000-4000-8000-000000000001', C2 = 'eeeeeeee-0000-4000-8000-000000000002';
  db.reset(world({ presence_contacts: [
    { id: C1, site_id: SITE, name: 'Ana Ruiz', email: 'ana@example.com', deleted_at: null, updated_at: hoursAgo(1) },
    { id: C2, site_id: SITE, name: 'Old Contact', email: 'old@example.com', deleted_at: null, updated_at: hoursAgo(9000) },
  ] }));
  const r = await res(await S.handleSalesContacts(req('GET', `/sales/contacts?limit=100&ids=${C2},not-a-uuid,${C2.toUpperCase()}`), site, owner, cors));
  ok('/sales/contacts?ids=: exactly those contacts, however old, junk ids ignored', r.status === 200 && r.body.data.length === 1 && r.body.data[0].id === C2, JSON.stringify(r.body));
  const read = db.reads('presence_contacts').pop();
  ok('/sales/contacts?ids=: still pinned to this site, live contacts only', read && read.url.includes(`site_id=eq.${SITE}`) && read.url.includes(`id=in.(${C2})`) && read.url.includes('deleted_at=is.null'), read && read.url);
  const many = Array.from({ length: 140 }, (_, i) => `eeeeeeee-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
  db.reset(world());
  await S.handleSalesContacts(req('GET', `/sales/contacts?ids=${many}`), site, owner, cors);
  const capRead = db.reads('presence_contacts').pop();
  ok('/sales/contacts?ids=: at most 100 per call', capRead && (capRead.url.match(/eeeeeeee-0000-4000-8000-/g) || []).length === 100);
}

// ═══ item 65 · the pages ═══
{
  const read = (rel) => Deno.readTextFileSync(new URL(rel, import.meta.url));
  const pipe = read('../../pipeline.html'), inbox = read('../../inbox.html'), shell = read('../../shell.js'), bc = read('../../broadcasts.html');
  ok('Pipeline: Send an update looks up the picked deals\' contacts by id, 100 at a time (not "the newest 100")', /api\('\/sales\/contacts\?limit=100&ids='\+c\.map\(encodeURIComponent\)\.join\(','\)\)/.test(pipe) && !/\/sales\/contacts\?limit=100&include_deleted=1'\);\}catch/.test(pipe));
  ok('Pipeline: a failed lookup says so instead of sending to fewer people', /We couldn’t look up the people on those deals just now/.test(pipe));
  ok('Pipeline: renamed stages repaint the list only once the deals have loaded (no walkthrough flash)', /let DEALS_LOADED=false;/.test(pipe) && /DEALS=res\.data\|\|\[\];DEALS_LOADED=true;/.test(pipe) && /renderFilters\(\);if\(DEALS_LOADED\)renderCurrent\(\);/.test(pipe));
  ok('Pipeline: picks from another stage chip are dropped when the deals load', /const live=new Set\(DEALS\.map\(d=>String\(d\.id\)\)\);for\(const id of \[\.\.\.PICKED\]\)if\(!live\.has\(id\)\)PICKED\.delete\(id\);/.test(pipe));
  ok('Inbox: the enquiry note is a composer field kept across a refresh', /const COMPOSER_FIELDS=\['msgBody','supBody','leadBody','leadNote'\];/.test(inbox));
  ok('Inbox: the enquiry pane restores what was typed even when the enquiry left no email', /\n  \}\n  restoreComposer\(it\);   \/\/ item 65/.test(inbox) && !/    restoreComposer\(it\);\n  \}\n  const mr=/.test(inbox));
  ok('Send an update: the composer is told how many picked people were left out', /var left = Number\(r\.body\.data\.left_out\) \|\| 0;/.test(shell) && /'&left=' \+ left/.test(shell) && /new URLSearchParams\(location\.search\)\.get\('left'\)/.test(bc) && /searchParams\.delete\('left'\)/.test(bc));
}

console.log(`\n════ SALES QUICK FIXES (S4 + item 65): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) { console.log('failed:', failed.join(' | ')); Deno.exit(1); }
