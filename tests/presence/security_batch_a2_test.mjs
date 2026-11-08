// ── Final pass on the sales side, batch A, second half (Nov 8 2026) ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/security_batch_a2_test.mjs
//   F2  settings rows: one value everywhere; a second row can't keep an old one
//   F9  two saves at once both land (saved views, picked lists)
//   F8  a list isn't deleted when "is it in use?" can't be answered
//   F3  the calendar feed escapes ; , \ and line breaks, and a bad date can't break it
//   F4  renamed stages never end up with two the same
//   F5  the Won / Not a fit report dates a close by when it closed
//   F6  a client's request list and bell pick requests by real activity
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111';
const db = installFakePostgrest({
  unique: { presence_sales_templates: [{ cols: ['site_id', 'kind', 'name'], where: (r) => r.deleted_at == null && /^__.*__$/.test(String(r.name)) }] },
});
const RS = await import('../../supabase/functions/presence/lib/reserved_store.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const B = await import('../../supabase/functions/presence/routes/broadcasts.ts');
const CAL = await import('../../supabase/functions/presence/routes/calendar.ts');
const F = await import('../../supabase/functions/presence/lib/calendar_feed.ts');
const SN = await import('../../supabase/functions/presence/lib/stage_names.ts');
const SR = await import('../../supabase/functions/presence/lib/sales_reports.ts');
const CD = await import('../../supabase/functions/presence/routes/client_delivery.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: '22222222-2222-4222-8222-222222222222', status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333333', email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const rowsNamed = (name) => (db.tables.presence_sales_templates || []).filter((r) => r.name === name && r.deleted_at == null);

// ═══ F2: one value everywhere ═══
db.reset({ presence_sales_templates: [
  { id: 'a', site_id: SITE, kind: 'proposal', name: '__stage_names__', body: '{"lead":"Old"}', deleted_at: null, updated_at: '2026-01-01T00:00:00Z' },
  { id: 'b', site_id: SITE, kind: 'proposal', name: '__stage_names__', body: '{"lead":"Older"}', deleted_at: null, updated_at: '2025-01-01T00:00:00Z' },
] });
ok('a write reaches every live row of the name (a duplicate can\'t keep an old value)', await RS.writeReservedJson(SITE, '__stage_names__', { lead: 'Enquiry' }, 'x') && rowsNamed('__stage_names__').every((r) => r.body === '{"lead":"Enquiry"}'));
ok('a read takes the newest row', JSON.stringify(await RS.readReservedJson(SITE, '__stage_names__')) === '{"lead":"Enquiry"}');
db.reset({ presence_sales_templates: [] });
ok('the first write creates the row', await RS.writeReservedJson(SITE, '__saved_views__', { a: 1 }, 'x') && rowsNamed('__saved_views__').length === 1);

// ═══ F9: two saves at once ═══
db.reset({ presence_sales_templates: [{ id: 'v', site_id: SITE, kind: 'proposal', name: '__x__', body: '{"n":[]}', deleted_at: null, updated_at: '2026-01-01T00:00:00Z' }] });
{
  const add = (k) => RS.updateReservedJson(SITE, '__x__', (cur) => ({ n: [...((cur && cur.n) || []), k] }), 'x');
  const [a, b] = await Promise.all([add('one'), add('two')]);
  const stored = JSON.parse(rowsNamed('__x__')[0].body).n;
  ok('two changes made at once both land (the second re-reads and re-applies)', a && b && stored.includes('one') && stored.includes('two') && stored.length === 2, JSON.stringify(stored));
}
db.reset({ presence_sales_templates: [] });
{
  const add = (k) => RS.updateReservedJson(SITE, '__x__', (cur) => ({ n: [...((cur && cur.n) || []), k] }), 'x');
  const [a, b] = await Promise.all([add('one'), add('two')]);
  ok('two FIRST saves at once: one row, both changes', a && b && rowsNamed('__x__').length === 1 && JSON.parse(rowsNamed('__x__')[0].body).n.length === 2, JSON.stringify(rowsNamed('__x__')));
}
db.reset({ presence_sales_templates: [] });
{
  const put = (list, name) => S.handleSalesViews(req('PUT', '/sales/views', { list, views: [{ name, base: 'all' }] }), site, owner, cors);
  const [a, b] = await Promise.all([put('customers', 'Hot'), put('pipeline', 'This month')]);
  const all = await RS.readReservedJson(SITE, '__saved_views__');
  ok('Customers and Pipeline views saved at the same moment both stay', a.status === 200 && b.status === 200 && all?.customers?.[0]?.name === 'Hot' && all?.pipeline?.[0]?.name === 'This month', JSON.stringify(all));
}
db.reset({ presence_sales_templates: [], presence_broadcasts: [] });
{
  const mk = (email) => B.handleBroadcastListCreate(req('POST', '/broadcasts/lists', { people: [{ email, name: '' }] }), site, owner, cors);
  const [a, b] = await Promise.all([mk('a@example.com'), mk('b@example.com')]);
  const lists = await RS.readReservedJson(SITE, '__broadcast_lists__');
  ok('two picked lists made at once both stay', a.status === 201 && b.status === 201 && Array.isArray(lists) && lists.length === 2, JSON.stringify(lists));

  // ═══ F8 ═══
  const id = lists[0].id;
  db.fail.add('presence_broadcasts');
  const d = await res(await B.handleBroadcastListDelete(site, owner, id, cors));
  ok('a list isn\'t deleted when "is it in use?" can\'t be answered (503)', d.status === 503 && (await RS.readReservedJson(SITE, '__broadcast_lists__')).length === 2);
  db.fail.delete('presence_broadcasts');
  const d2 = await res(await B.handleBroadcastListDelete(site, owner, id, cors));
  ok('…and is deleted once it can', d2.status === 200 && (await RS.readReservedJson(SITE, '__broadcast_lists__')).length === 1);
}

// ═══ F2 for the calendar: turned off means off ═══
db.reset({ presence_sales_templates: [] });
{
  const made = await res(await CAL.handleCalendarLink(req('POST', '/calendar/link'), site, owner, cors));
  const token = String(made.body?.data?.url || '').match(/([0-9a-f]{40})\.ics$/)?.[1];
  // a duplicate row from before migration 0138, carrying an older link
  const stale = 'b'.repeat(40);
  db.tables.presence_sales_templates.push({ id: 'dup', site_id: SITE, kind: 'proposal', name: '__calendar_feed__', body: JSON.stringify({ token: stale }), deleted_at: null, updated_at: '2025-01-01T00:00:00Z' });
  const off = await res(await CAL.handleCalendarLink(req('DELETE', '/calendar/link'), site, owner, cors));
  const f1 = await CAL.handleCalendarFeed(token);
  const f2 = await CAL.handleCalendarFeed(stale);
  ok('turning the link off turns off every copy of it', off.status === 200 && f1.status === 404 && f2.status === 404, `${f1.status} ${f2.status}`);
}

// ═══ F3: the feed ═══
ok('a semicolon is escaped (the test used to agree with the bug)', F.icsEscape('Review; phase 2') === 'Review\\; phase 2');
ok('commas, backslashes and every kind of line break', F.icsEscape('a,b\\c\r\nd\re\nf') === 'a\\,b\\\\c\\nd\\ne\\nf');
ok('other control characters are dropped (a tab is allowed text and stays)', F.icsEscape('bell\u0007 tab\u0009?') === 'bell tab\t?');
/** A strict reader: what a picky calendar app checks. */
function strictIcs(ics) {
  const errs = [];
  if (!ics.endsWith('\r\n')) errs.push('no final CRLF');
  if (/[^\r]\n/.test(ics)) errs.push('a bare LF');
  for (const l of ics.split('\r\n')) if (new TextEncoder().encode(l).length > 75) errs.push('line over 75 octets');
  const lines = ics.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines[lines.length - 1] !== 'END:VCALENDAR') errs.push('calendar not wrapped');
  const begins = lines.filter((l) => l === 'BEGIN:VEVENT').length, ends = lines.filter((l) => l === 'END:VEVENT').length;
  if (begins !== ends) errs.push('events not balanced');
  let ev = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') { ev = new Set(); continue; }
    if (l === 'END:VEVENT') { for (const need of ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY']) if (!ev.has(need)) errs.push('event without ' + need); ev = null; continue; }
    const name = l.split(/[:;]/)[0];
    if (ev) ev.add(name);
    if (['SUMMARY', 'DESCRIPTION', 'X-WR-CALNAME'].includes(name)) {
      const v = l.slice(l.indexOf(':') + 1);
      for (let i = 0; i < v.length; i++) { if (v[i] === '\\') { if (!'\\;,nN'.includes(v[i + 1] || '')) errs.push('bad escape'); i++; continue; } if (v[i] === ';' || v[i] === ',') errs.push(`unescaped ${v[i]} in ${name}`); }
    }
  }
  return errs;
}
{
  const ics = F.buildIcs('Harbor; Lane, Studio', [
    { uid: 'booking-1', summary: 'Discovery call — Sam; Lee, again', description: 'Line one\nLine two; three', start: '2026-11-10T17:30:00Z', minutes: 45, url: 'https://app.example.com/x' },
    { uid: 'task-2', summary: 'Résumé 🍕 '.repeat(12), allDay: '2026-11-12' },
    { uid: 'bad-3', summary: 'not a day', allDay: '2026-13-01' },
    { uid: 'bad-4', summary: 'not a day either', allDay: '2026-02-30' },
  ], '2026-11-08T12:00:00Z');
  const errs = strictIcs(ics);
  ok('the feed passes a strict reader', errs.length === 0, errs.join('; '));
  ok('impossible dates are skipped, not fatal', (ics.match(/BEGIN:VEVENT/g) || []).length === 2 && !ics.includes('not a day'));
}

// ═══ F4: stage names ═══
const distinct = (custom) => { const l = Object.values(SN.stageLabels(custom)).map((x) => x.toLowerCase()); return new Set(l).size === l.length; };
for (const raw of [{ lead: 'A', qualified: 'A', proposal: 'Qualified' }, { lead: 'B', qualified: 'B', proposal: 'Qualified', contract: 'Proposal sent' }, { qualified: 'New lead', lead: 'x' }, { lead: 'Won' }, { lead: 'Agreement out' }]) {
  ok(`renames ${JSON.stringify(raw)} never leave two stages the same`, distinct(SN.normalizeStageNames(raw)), JSON.stringify(SN.stageLabels(SN.normalizeStageNames(raw))));
}
ok('swapping two names is still allowed', JSON.stringify(SN.normalizeStageNames({ lead: 'Proposal sent', proposal: 'New lead' })) === '{"lead":"Proposal sent","proposal":"New lead"}');
ok('a plain rename still works', JSON.stringify(SN.normalizeStageNames({ lead: 'Enquiry' })) === '{"lead":"Enquiry"}');

// ═══ F5: the Won / Not a fit report ═══
const NOW = '2026-11-08T12:00:00Z';
const deals = [
  { id: '0aaaaaaa-0000-4000-8000-0000000000a1', stage: 'won', converted_client_id: 'c1', converted_at: '2024-10-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', expected_value_cents: 100000, source: 'manual' },
  { id: '0aaaaaaa-0000-4000-8000-0000000000a2', stage: 'lost', updated_at: '2026-11-02T00:00:00Z', expected_value_cents: 5000, lost_reason: 'Price' },
  { id: '0aaaaaaa-0000-4000-8000-0000000000a3', stage: 'lost', updated_at: '2026-11-03T00:00:00Z', expected_value_cents: 7000, lost_reason: 'Timing' },
];
{
  const r = SR.wonAndLost(deals, NOW, 365, { '0aaaaaaa-0000-4000-8000-0000000000a2': '2026-09-01T00:00:00Z', '0aaaaaaa-0000-4000-8000-0000000000a3': '2024-06-01T00:00:00Z' });
  ok('a deal won two years ago and edited last week is not "won this year"', r.won.count === 0, JSON.stringify(r.won));
  ok('a deal closed this year counts; one closed in 2024 doesn\'t, however recently it was edited', r.lost.count === 1 && r.lost.value_cents === 5000, JSON.stringify(r.lost));
  ok('the win rate follows', r.win_rate_pct === 0);
  const legacy = SR.wonAndLost([{ id: 'x', stage: 'lost', updated_at: '2026-10-01T00:00:00Z', expected_value_cents: 1 }], NOW);
  ok('a deal with no close on record still falls back to its last edit', legacy.lost.count === 1);
}
db.reset({
  presence_deals: deals.map((d) => ({ ...d, site_id: SITE, deleted_at: null, created_at: '2024-01-01T00:00:00Z' })),
  presence_deal_events: [
    { deal_id: '0aaaaaaa-0000-4000-8000-0000000000a1', site_id: SITE, kind: 'converted', to_stage: 'won', created_at: '2024-10-01T00:00:00Z' },
    { deal_id: '0aaaaaaa-0000-4000-8000-0000000000a2', site_id: SITE, kind: 'stage_change', to_stage: 'lost', created_at: '2026-09-01T00:00:00Z' },
    { deal_id: '0aaaaaaa-0000-4000-8000-0000000000a3', site_id: SITE, kind: 'stage_change', to_stage: 'lost', created_at: '2024-06-01T00:00:00Z' },
  ],
});
{
  const r = await res(await S.handleSalesReports(req('GET', '/sales/reports'), site, owner, cors));
  const o = r.body?.data?.outcomes;
  ok('the report route reads the close events and uses them', r.status === 200 && o?.won?.count === 0 && o?.lost?.count === 1 && o?.partial === false, JSON.stringify(o));
  ok('…reading only this site\'s events', db.reads('presence_deal_events').every((c) => c.url.includes(`site_id=eq.${SITE}`)));
}

// ═══ F6: the client's list and bell follow what happened, not bookkeeping ═══
// Thirty requests. The studio just answered the one whose updated_at is the
// oldest (replies never move updated_at); the other 29 were bumped by
// bookkeeping writes since. It used to fall outside the 25 the portal read.
{
  const CUST = '44444444-4444-4444-8444-444444444444', CSITE = '55555555-5555-4555-8555-555555555555', PROJ = '66666666-6666-4666-8666-666666666666';
  const client = { kind: 'client', userId: '77777777-7777-4777-8777-777777777777', email: 'cust@example.com', jwt: 'jwt-cust', requestId: 't' };
  const csite = { id: CSITE, client_id: CUST, status: 'live', edition: 'presence' };
  const rid = (i) => `8888888${i.toString(16).padStart(1, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const day = (i) => `2026-10-${String(i).padStart(2, '0')}T09:00:00Z`;
  const reqs = Array.from({ length: 30 }, (_, i) => ({
    id: rid(i), site_id: SITE, requester: client.userId, deleted_at: null, subject: i === 0 ? 'Logo files' : `Request ${i}`,
    status: 'open', priority: 'normal', project_id: null, resolved_at: null,
    created_at: '2026-01-05T09:00:00Z', updated_at: i === 0 ? '2026-01-05T09:00:00Z' : day(i),
  }));
  db.reset({
    presence_service_links: [{ project_id: PROJ, agency_site_id: SITE, customer_client_id: CUST, status: 'active', created_at: '2026-01-01T00:00:00Z' }],
    presence_support_requests: reqs,
    presence_support_messages: [{ id: 'm1', site_id: SITE, request_id: rid(0), author: 'studio-owner', body: 'Here they are.', deleted_at: null, created_at: '2026-11-07T10:00:00Z' }],
    presence_project_events: [], presence_activity_reads: [],
  });
  const list = await res(await CD.handleClientSupport(req('GET', '/client/support'), csite, client, cors));
  const ids = (list.body?.data || []).map((x) => x.id);
  ok('F6: the request the studio just answered heads the client\'s list', list.status === 200 && ids[0] === rid(0), JSON.stringify(ids.slice(0, 3)));
  ok('F6: still one page of 25, newest activity first', ids.length === 25 && ids.slice(1).every((id, i) => i === 0 || id < ids[i]), String(ids.length));
  ok('F6: the list never hands back the requester key', (list.body?.data || []).every((x) => !('requester' in x)));
  const bell = await res(await CD.handleClientNotifications(req('GET', '/client/notifications'), csite, client, cors));
  const hit = (bell.body?.data || []).find((n) => n.href === `/client.html?support=${rid(0)}`);
  ok('F6: and it rings the bell', bell.status === 200 && !!hit && /Your studio replied: Logo files/.test(hit.label), JSON.stringify(bell.body?.data?.slice(0, 2)));
  ok('F6: both read only this client\'s requests on their studio\'s site', db.reads('presence_support_requests').every((c) => c.url.includes(`site_id=eq.${SITE}`) && c.url.includes(`requester=eq.${client.userId}`)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
