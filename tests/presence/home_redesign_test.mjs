// ── Home, the bold redesign (sales list item 70, Nov 2026) ──────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/home_redesign_test.mjs
//
//   Home leads with what needs you: one list with tabs (Needs you · My tasks ·
//   Waiting on them · Snoozed), each row with its verb, Snooze and Done, and
//   "Go through them" to take the list one at a time.
//
//   Snooze is the one new server piece: a row's key and when it wakes, stored
//   per studio (migration 0146). A snoozed row leaves the list, the bell's
//   count and the roster's Next until then. Before APPLY-0146 runs nothing is
//   held back, the list says snooze_ready:false, and a write answers 503.
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const AG = uuid('a'), STUDIO = uuid('1'), STUDIO_CLIENT = uuid('2'), U = uuid('3'), C1_SITE = uuid('4'), C1 = uuid('5'), E1 = uuid('c'), E2 = uuid('e');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@studio.test' } }, ownSite: { 'jwt-owner': STUDIO } });
const AGR = await import('../../supabase/functions/presence/agency/routes.ts');
const NY = await import('../../supabase/functions/presence/agency/needs_you.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const cors = {};
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const member = { agency_id: AG, member_id: uuid('b'), email: 'owner@studio.test', role: 'owner', agency_name: 'Test Studio', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} };
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-owner' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const call = async (method, route, body) => res(await AGR.handleAgency(req(method, route + (method === 'GET' ? '?fresh=1' : ''), body), route, method, member, owner, cors));

// ═══ 1. the rules, as needs_you.ts has them ═══
{
  const NOW = '2026-11-09T15:00:00.000Z';
  eq('a snooze of 2 days wakes 2 days on, same time', NY.snoozeUntil(NOW, 2), '2026-11-11T15:00:00.000Z');
  eq('1 and 30 days are the ends of the range', [NY.snoozeUntil(NOW, 1), NY.snoozeUntil(NOW, 30)], ['2026-11-10T15:00:00.000Z', '2026-12-09T15:00:00.000Z']);
  eq('anything else is no snooze at all (never a guess)', [NY.snoozeUntil(NOW, 0), NY.snoozeUntil(NOW, 31), NY.snoozeUntil(NOW, 1.5), NY.snoozeUntil(NOW, null), NY.snoozeUntil(NOW, 'two'), NY.snoozeUntil('nope', 2)], [null, null, null, null, null, null]);
  ok('a row key is "<kind>:<id>", nothing looser', ['money:abc', 'broken:publish:' + C1_SITE, 'enquiry:own:e1', 'message:project:p1'].every((k) => NY.SNOOZE_KEY_RE.test(k)) && !['x', 'Money:1', 'a: b', 'money:', ':abc', 'money:a b'].some((k) => NY.SNOOZE_KEY_RE.test(k)));
  const asleep = NY.asleepKeys({ 'plan:p1': '2026-11-10T00:00:00Z', 'plan:p2': '2026-11-01T00:00:00Z', 'plan:p3': 'soon' }, NOW);
  eq('only a wake time still ahead keeps a row asleep (past or unreadable wakes it)', [...asleep], ['plan:p1']);

  const input = (snoozed) => ({
    nowIso: NOW, links: [{ site_id: 's1', status: 'active' }], clientNames: { s1: 'Fennel Street Designs' },
    plans: [{ id: 'p1', site_id: 's1', title: 'Protect your email', status: 'approved' }, { id: 'p2', site_id: 's1', title: 'Speed up the homepage', status: 'approved' }],
    snoozed,
  });
  const awake = NY.needsYouPayload(input(undefined));
  const keys = (rows) => rows.map((r) => r.key);
  ok('the fixture builds two rows', awake.total === 2 && keys(awake.rows).length === 2, JSON.stringify(keys(awake.rows)));
  const p = NY.needsYouPayload(input({ [awake.rows[0].key]: '2026-11-11T15:00:00.000Z', 'plan:gone': '2026-11-20T00:00:00Z' }));
  eq('a snoozed row leaves the list and the total (the bell)', [keys(p.rows), p.total], [[awake.rows[1].key], 1]);
  eq('…and travels under snoozed with its wake time', p.snoozed.map((r) => [r.key, r.until]), [[awake.rows[0].key, '2026-11-11T15:00:00.000Z']]);
  ok('…a snooze for a row that no longer exists is simply not shown', !p.snoozed.some((r) => r.key === 'plan:gone'));
  ok('…the roster\'s Next skips it too', JSON.stringify(p.next_by_site.s1) === JSON.stringify({ what: awake.rows[1].what, verb: awake.rows[1].verb, href: awake.rows[1].href, kind: awake.rows[1].kind }));
  const woke = NY.needsYouPayload(input({ [awake.rows[0].key]: '2026-11-09T14:00:00.000Z' }));
  ok('a snooze whose time has passed is over: the row is back', woke.total === 2 && woke.snoozed.length === 0);
}

// ═══ 2. the routes, against the fake database ═══
const world = (extra = {}) => db.reset({
  presence_sites: [{ id: STUDIO, client_id: STUDIO_CLIENT, status: 'live', edition: 'presence' }, { id: C1_SITE, client_id: C1, status: 'live', edition: 'presence' }],
  clients: [{ id: STUDIO_CLIENT, name: 'Test Studio', email: 'owner@studio.test', contact_email: null, deleted_at: null }, { id: C1, name: 'Jordan Ellis', email: 'jordan@example.com', contact_email: null, deleted_at: null }],
  presence_agency_members: [{ id: member.member_id, agency_id: AG, user_id: U, email: 'owner@studio.test', role: 'owner', status: 'active' }],
  presence_agencies: [{ id: AG, name: 'Test Studio', status: 'active', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} }],
  presence_agency_clients: [{ site_id: C1_SITE, agency_id: AG, status: 'active', tags: [], owner_email: 'jordan@example.com' }],
  presence_form_submissions: [
    { id: E1, site_id: C1_SITE, status: 'new', spam: false, name: 'Riley', email: 'riley@example.com', form_kind: 'contact', created_at: '2026-11-01T00:01:00Z' },
  ],
  presence_needs_snoozes: [],
  ...extra,
});
const needs = async () => (await call('GET', '/agency/needs-you')).body?.data || {};
let basePartial = null;
{
  world();
  const before = await needs();
  basePartial = before.partial;
  const row = (before.rows || []).find((r) => r.kind === 'enquiry');
  ok('the list has the client\'s enquiry, and says Snooze is ready', !!row && before.snooze_ready === true, JSON.stringify({ keys: (before.rows || []).map((r) => r.key), ready: before.snooze_ready }));
  const key = row ? row.key : 'enquiry:x';
  const t0 = Date.now();
  const r = await call('POST', '/agency/needs-you/snooze', { key, days: 2 });
  const saved = (db.tables.presence_needs_snoozes || []).filter((x) => x.agency_id === AG && x.row_key === key);
  ok('Snooze answers with the key and its wake time', r.status === 200 && r.body?.data?.key === key && Math.abs(Date.parse(r.body?.data?.until) - (t0 + 2 * 86400000)) < 60000, JSON.stringify(r));
  ok('…one row is stored for the studio, with who did it', saved.length === 1 && saved[0].created_by === 'owner@studio.test');
  ok('…and the studio\'s kept total is forgotten, so the bell recounts', AGR.keptStudioNeedsTotal(AG) === null);
  const after = await needs();
  ok('the list leaves it out, the total drops, and it waits under snoozed', !(after.rows || []).some((x) => x.key === key) && after.total === before.total - 1 && (after.snoozed || []).some((x) => x.key === key && x.until));
  await call('POST', '/agency/needs-you/snooze', { key, days: 7 });
  const again = (db.tables.presence_needs_snoozes || []).filter((x) => x.row_key === key);
  ok('snoozing it again moves the wake time; still one row', again.length === 1 && Date.parse(again[0].until) - Date.now() > 6 * 86400000);
  const w = await call('POST', '/agency/needs-you/wake', { key });
  ok('Wake answers and deletes the row', w.status === 200 && !(db.tables.presence_needs_snoozes || []).some((x) => x.row_key === key));
  const back = await needs();
  ok('…and the item is back in the list', (back.rows || []).some((x) => x.key === key) && back.total === before.total && !(back.snoozed || []).length);
  eq('a key that isn\'t a row key is refused', (await call('POST', '/agency/needs-you/snooze', { key: 'nope', days: 2 })).status, 400);
  const bad = await call('POST', '/agency/needs-you/snooze', { key, days: 31 });
  ok('31 days is refused, in words', bad.status === 400 && /1 to 30 days/.test(bad.body?.message || ''));
  db.failMethod.set('presence_needs_snoozes', 'POST');
  const boom = await call('POST', '/agency/needs-you/snooze', { key, days: 2 });
  ok('a failed write says it didn\'t save (and isn\'t blamed on the missing step)', boom.status === 502 && /didn’t save/.test(boom.body?.message || ''));
  db.failMethod.delete('presence_needs_snoozes');
}
// before APPLY-0146: PostgREST answers 404 PGRST205 for the table
{
  world({ presence_needs_snoozes: [{ agency_id: AG, row_key: 'enquiry:whatever', until: '2099-01-01T00:00:00Z' }] });
  const fake = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (/\/rest\/v1\/presence_needs_snoozes/.test(decodeURIComponent(String(url)))) return new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.presence_needs_snoozes' in the schema cache" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return fake(url, init);
  };
  try {
    const d = await needs();
    ok('before the step: the list holds nothing back and says Snooze isn\'t ready', d.snooze_ready === false && (d.rows || []).some((r) => r.kind === 'enquiry') && !(d.snoozed || []).length, JSON.stringify({ ready: d.snooze_ready }));
    ok('…and isn\'t marked partial for it (nothing is missing from the list)', typeof d.partial === 'boolean' && d.partial === basePartial, JSON.stringify({ partial: d.partial, basePartial }));
    const r = await call('POST', '/agency/needs-you/snooze', { key: 'enquiry:' + E2, days: 2 });
    ok('…a snooze answers 503 in plain words', r.status === 503 && r.body?.message === 'Snooze isn’t switched on yet — it needs one database step.', JSON.stringify(r));
  } finally { globalThis.fetch = fake; }
}

// ═══ 3. the migration and its apply pack ═══
{
  const mig = read('supabase/migrations/0146_needs_snoozes.sql');
  const pack = read('docs/presence/APPLY-0146-prod.sql');
  ok('0146: one table keyed by studio and row, deleted with the studio', /create table if not exists public\.presence_needs_snoozes \(\s*agency_id uuid not null references public\.presence_agencies\(id\) on delete cascade,/.test(mig) && /primary key \(agency_id, row_key\)/.test(mig));
  ok('0146: row level security on, no policies (the Edge Function only)', /alter table public\.presence_needs_snoozes enable row level security;/.test(mig) && !/create policy/i.test(mig));
  ok('0146: says how to roll back', /-- rollback: drop table if exists public\.presence_needs_snoozes;/.test(mig));
  ok('the pack is the same table, safe to run twice, with a check query', pack.includes('create table if not exists public.presence_needs_snoozes') && /enable row level security/.test(pack) && /select c\.relname as table_name, c\.relrowsecurity as rls_on/.test(pack));
  const routes = read('supabase/functions/presence/agency/routes.ts');
  ok('the list reads only snoozes still ahead, for this studio', /presence_needs_snoozes\?agency_id=eq\.\$\{member\.agency_id\}&until=gt\.\$\{encodeURIComponent\(now\)\}/.test(routes));
  ok('anyone who can see the list can snooze it', /route === '\/agency\/needs-you\/snooze' \|\| route === '\/agency\/needs-you\/wake'\) && method === 'POST'\) \{\s*if \(!can\(member\.role, 'read'\)\) return forbid\(cors\);/.test(routes));
}

// ═══ 4. the page ═══
{
  const home = read('agency.html');
  ok('the list comes right after the greeting, before the numbers', home.indexOf('<section id="needs"') > 0 && home.indexOf('<section id="needs"') < home.indexOf('<section id="studio"'));
  ok('Snooze shows only when the server says it is ready', /const snoozeOk=\(\)=>!!\(NEEDS&&NEEDS\.snooze_ready\);/.test(home) && /\$\{snoozeOk\(\)\?`<button type="button" class="qlink" data-snooze=/.test(home));
  const doneOf = (home.match(/function doneOf\(r\)\{[\s\S]*?\n\}/) || [''])[0];
  ok('Done uses the route that owns each thing: an enquiry is marked read', /apiSend\('POST','\/forms\/inbox\/'\+encodeURIComponent\(id\),\{status:'read'\},c\.site_id\|\|''\)/.test(doneOf));
  ok('…a support request closed', /apiSend\('PATCH','\/support\/'\+encodeURIComponent\(id\),\{status:'closed'\}\)/.test(doneOf));
  ok('…a late next step cleared (as My tasks does)', /\^deal:\(\[0-9a-f-\]\{36\}\)\$/.test(doneOf) && /\{next_step:'',next_step_at:''\}/.test(doneOf));
  ok('…a notice dismissed', /\^notice:\(\[0-9a-f-\]\{36\}\)\$/.test(doneOf) && /\/commerce\/notices\/dismiss/.test(doneOf));
  ok('…and money, a broken site or a plan get no Done (doing the thing clears them)', !/money|broken|plan|publish/.test(doneOf.replace(/^.*?\{/, '')));
  ok('My tasks is a tab of the list (and not a second card in the studio strip)', /if\(MYTASKS\)t\.push\(\{k:'tasks',label:'My to-dos'/.test(home) && !/if\(tasks\)h\+=myTasksHtml\(\);/.test(home));
  ok('the tabs follow the keyboard pattern (arrows, Home, End)', /if\(e\.key==='ArrowRight'\)j=\(i\+1\)%tabs\.length;else if\(e\.key==='ArrowLeft'\)/.test(home) && /aria-selected="\$\{x\.k===QTAB\?'true':'false'\}" tabindex="\$\{x\.k===QTAB\?'0':'-1'\}"/.test(home));
  ok('Go through them: → skips, Esc leaves, focus goes back to where it was', /if\(e\.key==='ArrowRight'&&!\(e\.target&&/.test(home) && /d\.addEventListener\('close',\(\)=>\{/.test(home) && /const back=op&&document\.contains\(op\)\?op:\$\('goThrough'\);if\(back\)back\.focus\(\);/.test(home));
  ok('…and on a phone a swipe left skips', /if\(dx<0\)skip\(\);else if\(dn\)take\(doneRow,dn\);/.test(home));
  ok('…a keyboard lands on the verb, a tap on the view (no button looks pressed)', /const g=FOCUS\.keys\?\(d\.querySelector\('\.fgo'\)\|\|d\.querySelector\('\.fend'\)\):d\.querySelector\('\.fwrap'\);/.test(home) && /openFocus\(go,e\.detail===0\)/.test(home));
  const phoneBlock = (home.match(/@media \(max-width:760px\)\{\s*\/\* a phone's greeting[\s\S]*?\n  \}/) || [''])[0];
  ok('on a phone the rows keep only their verb; Snooze and Done live in Go through them', /\.need \.ra \.qlink\{display:none\}/.test(phoneBlock));
  ok('…and the greeting is the count and Go through them (the kinds are the list right below)', /\.hero \.hrow \.rolebadge,\.hero \.hchips button\.hchip\{display:none\}/.test(phoneBlock) && /button\.hgo\{width:100%;/.test(phoneBlock));
  ok('Today reads dates only: what is due or late, then money due this week', /if\(d==null\|\|d<0\|\|d>7\)return;rows\.push\(\{d:d\+0\.5,w:d===0\?'Today':'In '/.test(home));
  ok('"&" or "—" is not a word for initials', /filter\(w=>\/\[\\p\{L\}\\p\{N\}\\p\{Extended_Pictographic\}\]\/u\.test\(w\)\)/.test(home));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n  ' + failed.join('\n  ')); Deno.exit(1); }
