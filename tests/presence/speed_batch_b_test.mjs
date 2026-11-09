// ── Final pass on the sales side, speed batch B (Nov 8 2026) ─────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/speed_batch_b_test.mjs
// Drives the real handlers against the shared in-memory PostgREST (fake_pgrst.mjs):
//   1  a page boot never builds the Needs-you list — it shows the kept total
//      (none yet = null, and says it's stale), and Needs you keeps it
//   2  calls that arrive together share one gather and one Needs-you run;
//      ?fresh=1 doesn't share; an agency write forgets what's shared
//   3  the bell: ?only=total is just the number, and the full answer carries
//      the feed's update rows (one call instead of two)
//   4  the record's activity reads every support reply in ONE read — newest
//      200 per request, the same timeline as before
//   5  the support repair remembers requesters (an unmatched one isn't asked
//      about again) and stamps a requester's requests in one write
//   6  stage names are kept per site; a rename forgets them; a failed read isn't kept
//   7  My tasks reads are ordered, so their caps keep the soonest
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const AG = uuid('a'), STUDIO = uuid('1'), STUDIO_CLIENT = uuid('2'), U = uuid('3'), C1_SITE = uuid('4'), C1 = uuid('5');
const P1 = uuid('6'), D1 = uuid('7'), F1 = uuid('8'), B1 = uuid('9');
const R1 = '0aaaaaaa-0000-4000-8000-000000000001', R2 = '0aaaaaaa-0000-4000-8000-000000000002', R3 = '0aaaaaaa-0000-4000-8000-000000000003';
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@studio.test' } }, ownSite: { 'jwt-owner': STUDIO } });
const AGR = await import('../../supabase/functions/presence/agency/routes.ts');
const WS = await import('../../supabase/functions/presence/routes/workspace.ts');
const CRM = await import('../../supabase/functions/presence/routes/crm.ts');
const SB = await import('../../supabase/functions/presence/lib/service_bridge.ts');
const SN = await import('../../supabase/functions/presence/lib/stage_names.ts');
const SALES = await import('../../supabase/functions/presence/routes/sales.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const cors = {};
const studio = { id: STUDIO, client_id: STUDIO_CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const member = { agency_id: AG, member_id: uuid('b'), email: 'owner@studio.test', role: 'owner', agency_name: 'Test Studio', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} };
const req = (method, path) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-owner' }, body: method === 'GET' ? undefined : '{}' });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const at = (n) => new Date(Date.parse('2026-11-01T00:00:00Z') + n * 60_000).toISOString();

db.reset({
  presence_sites: [studio, { id: C1_SITE, client_id: C1, status: 'live', edition: 'presence' }],
  clients: [{ id: STUDIO_CLIENT, name: 'Test Studio', email: 'owner@studio.test', contact_email: null, deleted_at: null }, { id: C1, name: 'Jordan Ellis', email: 'jordan@example.com', contact_email: null, deleted_at: null }],
  presence_agency_members: [{ id: member.member_id, agency_id: AG, user_id: U, email: 'owner@studio.test', role: 'owner', status: 'active' }],
  presence_agencies: [{ id: AG, name: 'Test Studio', status: 'active', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} }],
  presence_agency_clients: [{ site_id: C1_SITE, agency_id: AG, status: 'active', tags: [], owner_email: 'jordan@example.com' }],
  presence_form_submissions: [{ id: uuid('c'), site_id: C1_SITE, status: 'new', spam: false, name: 'Riley', email: 'riley@example.com', form_kind: 'contact', created_at: at(1) }],
  presence_plan_notices: [{ id: uuid('d'), site_id: STUDIO, client_id: STUDIO_CLIENT, kind: 'invoice_paid', period: 'paid:x', status: 'active', headline: 'Deposit paid', body: '', created_at: at(2) }],
});

// ═══ 1. a page boot never builds the list ═══
{
  db.log = [];
  const r = await res(await WS.handlePortalContext('jwt-owner', studio, owner, cors));
  const d = r.body?.data || {};
  ok('1: before any run the badge is "not known yet", and stale', r.status === 200 && d.attention_count === null && d.attention_stale === true, JSON.stringify({ c: d.attention_count, s: d.attention_stale }));
  ok('1: …and the boot never ran the portfolio gather', db.reads(`presence_agency_clients?agency_id=eq.${AG}`).length === 0);
  ok('1: nothing is kept yet', AGR.keptStudioNeedsTotal(AG) === null);
}

// ═══ 2. shared runs ═══
let total;
{
  db.log = [];
  const now = new Date().toISOString();
  const [a, b] = await Promise.all([AGR.computeStudioNeeds(member, owner, 'jwt-owner', now), AGR.computeStudioNeeds(member, owner, 'jwt-owner', now)]);
  total = Number(a.total);
  ok('2: two Needs-you runs that arrive together are one run', a === b && db.reads(`presence_agency_clients?agency_id=eq.${AG}`).length === 1, String(db.reads(`presence_agency_clients?agency_id=eq.${AG}`).length));
  ok('2: the list has the new enquiry', total >= 1, String(total));
  const kept = AGR.keptStudioNeedsTotal(AG);
  ok('1: Needs you keeps its total, fresh', !!kept && kept.total === total && kept.fresh === true, JSON.stringify(kept));
  const r = await res(await WS.handlePortalContext('jwt-owner', studio, owner, cors));
  ok('1: the next boot shows that total, not stale', r.body?.data?.attention_count === total && r.body?.data?.attention_stale === false, JSON.stringify([r.body?.data?.attention_count, r.body?.data?.attention_stale]));
  db.log = [];
  await AGR.computeStudioNeeds(member, owner, 'jwt-owner', now, { fresh: true });
  ok('2: ?fresh=1 never shares — it reads again', db.reads(`presence_agency_clients?agency_id=eq.${AG}`).length === 1);
  db.log = [];
  await Promise.all([AGR.sharedGather(AG, now), AGR.sharedGather(AG, now), res(await AGR.handleAgency(req('GET', '/agency/portfolio'), '/agency/portfolio', 'GET', member, owner, cors))]);
  ok('2: the portfolio, the archived portfolio and Needs you share one gather', db.reads(`presence_agency_clients?agency_id=eq.${AG}`).length <= 1, String(db.reads(`presence_agency_clients?agency_id=eq.${AG}`).length));
  await AGR.handleAgency(req('POST', '/agency/bulk'), '/agency/bulk', 'POST', member, owner, cors);
  db.log = [];
  await res(await AGR.handleAgency(req('GET', '/agency/portfolio'), '/agency/portfolio', 'GET', member, owner, cors));
  ok('2: an agency write forgets what was shared', db.reads(`presence_agency_clients?agency_id=eq.${AG}`).length === 1);
}

// ═══ 3. the bell ═══
{
  const t = await res(await AGR.handleAgency(req('GET', '/agency/needs-you?only=total'), '/agency/needs-you', 'GET', member, owner, cors));
  ok('3: ?only=total is just the number', t.status === 200 && JSON.stringify(Object.keys(t.body?.data || {}).sort()) === '["partial","total"]' && t.body.data.total === total, JSON.stringify(t.body));
  const f = await res(await AGR.handleAgency(req('GET', '/agency/needs-you?fresh=1'), '/agency/needs-you', 'GET', member, owner, cors));
  const up = f.body?.data?.update_notices;
  ok('3: the full answer carries the feed\'s update rows for the bell', Array.isArray(up) && up.length === 1 && up[0].kind === 'invoice_paid' && up[0].tier === 'update', JSON.stringify(up));
  ok('3: …and only update rows', (up || []).every((n) => n.tier === 'update'));
  // final pass, batch D: invoices that couldn't be read used to come back as "nothing owed"
  db.fail.add('presence_invoices');
  const p = await res(await AGR.handleAgency(req('GET', '/agency/needs-you?fresh=1'), '/agency/needs-you', 'GET', member, owner, cors));
  db.fail.delete('presence_invoices');
  ok('3: invoices that couldn\'t be read make the list "partial"', f.body?.data?.partial === false && p.status === 200 && p.body?.data?.partial === true, JSON.stringify([f.body?.data?.partial, p.body?.data?.partial]));
}

// ═══ 4. the record's activity ═══
{
  const msgs = [{ id: uuid('e'), site_id: STUDIO, project_id: P1, audience: 'client', body: 'Hello', author_kind: 'client', created_at: at(10), deleted_at: null }];
  const replies = [
    ...[11, 12, 13].map((n, i) => ({ id: `0bbbbbbb-0000-4000-8000-00000000000${i}`, request_id: R1, site_id: STUDIO, body: `r1-${n}`, author_kind: i % 2 ? 'client' : 'staff', created_at: at(n), deleted_at: null })),
    { id: '0bbbbbbb-0000-4000-8000-000000000010', request_id: R2, site_id: STUDIO, body: 'r2', author_kind: 'staff', created_at: at(21), deleted_at: null },
    ...Array.from({ length: 205 }, (_, i) => ({ id: `0ccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`, request_id: R3, site_id: STUDIO, body: `r3-${i}`, author_kind: 'staff', created_at: at(100 + i), deleted_at: null })),
  ];
  db.reset({
    ...structuredClone(db.tables),
    presence_service_links: [{ project_id: P1, agency_site_id: STUDIO, customer_client_id: C1, customer_site_id: C1_SITE, status: 'active', created_at: at(0) }],
    presence_project_messages: msgs,
    presence_support_requests: [
      { id: R1, site_id: STUDIO, project_id: P1, client_id: C1, subject: 'Logo', body: 'b1', status: 'open', requester: 'jordan@example.com', requester_kind: 'client', created_at: at(5), deleted_at: null },
      { id: R2, site_id: STUDIO, project_id: null, client_id: C1, subject: 'Invoice', body: 'b2', status: 'resolved', requester: 'jordan@example.com', requester_kind: 'client', created_at: at(6), deleted_at: null },
      { id: R3, site_id: STUDIO, project_id: P1, client_id: C1, subject: 'Hours', body: 'b3', status: 'open', requester: 'jordan@example.com', requester_kind: 'client', created_at: at(7), deleted_at: null },
    ],
    presence_support_messages: replies,
    presence_deals: [{ id: D1, site_id: STUDIO, converted_client_id: C1, stage: 'won', next_step: null, next_step_at: null, source_submission_id: F1, deleted_at: null, updated_at: at(3) }],
    presence_form_submissions: [{ id: F1, site_id: STUDIO, form_kind: 'contact', message: 'I need a site', created_at: at(1), status: 'converted', spam: false }],
    presence_deal_events: [{ id: uuid('f'), deal_id: D1, site_id: STUDIO, kind: 'note', from_stage: '', to_stage: '', detail: { activity_kind: 'call', body: 'Kickoff call' }, actor: 'owner', created_at: at(30) }],
    presence_appointments: [{ id: '0ddddddd-0000-4000-8000-000000000001', site_id: STUDIO, customer_email: 'jordan@example.com', type_name: 'Consult', slot_start_local: '2026-11-03T10:00', slot_start: null, note: '', status: 'confirmed', created_at: at(40) }],
    presence_broadcast_sends: [{ broadcast_id: B1, site_id: STUDIO, email: 'jordan@example.com', status: 'sent', created_at: at(50) }],
    presence_broadcasts: [{ id: B1, subject: 'Holiday hours' }],
  });
  const r = await res(await CRM.handleCrmActivity(req('GET', `/crm/activity?client_id=${C1}`), 'jwt-owner', studio, owner, cors));
  const items = r.body?.data?.items || [];
  const kinds = (k) => items.filter((i) => i.kind === k);
  ok('4: every support reply is read in ONE read', db.reads('presence_support_messages').length === 1, String(db.reads('presence_support_messages').length));
  // the activity rows carry the reply's own id (conv:support_reply:<id>)
  const replyIds = kinds('support_reply').map((i) => String(i.id));
  const r3 = replyIds.filter((id) => id.includes('0ccccccc-'));
  ok('4: newest 200 replies per request, as before', r3.length === 200 && ![0, 1, 2, 3, 4].some((n) => r3.some((id) => id.endsWith(String(n).padStart(12, '0')))), String(r3.length));
  ok('4: the other requests keep all their replies', replyIds.filter((id) => id.includes('0bbbbbbb-')).length === 4, String(replyIds.length));
  ok('4: every channel is there', ['message', 'support', 'enquiry', 'booking', 'activity', 'broadcast'].every((k) => kinds(k).length > 0) && /Holiday hours/.test(String(kinds('broadcast')[0].title)), JSON.stringify([...new Set(items.map((i) => i.kind))]));
  ok('4: one timeline, newest first', items.length > 200 && items.every((it, i) => i === 0 || String(items[i - 1].at) >= String(it.at)));
  ok('4: a reply goes to the newest open request', r.body?.data?.reply_support_to === `/support/${R3}/messages`, String(r.body?.data?.reply_support_to));
  const ownReads = db.log.filter((c) => c.method === 'GET' && /presence_(support|project_messages|deal_events|appointments|broadcast_sends)/.test(c.url));
  ok('4: every read stays on this studio\'s site', ownReads.length > 0 && ownReads.every((c) => c.url.includes(`site_id=eq.${STUDIO}`)));
}

// ═══ 5. the support repair ═══
{
  const nobody = uuid('0');
  db.log = [];
  await SB.healSupportOwners(STUDIO, [{ id: '0eeeeeee-0000-4000-8000-000000000001', requester: nobody }]);
  const first = db.log.length;
  db.log = [];
  await SB.healSupportOwners(STUDIO, [{ id: '0eeeeeee-0000-4000-8000-000000000001', requester: nobody }]);
  ok('5: an unmatched requester isn\'t asked about again', first > 0 && db.log.length === 0, `${first} then ${db.log.length}`);
  db.log = [];
  const out = await SB.healSupportOwners(STUDIO, [{ id: '0eeeeeee-0000-4000-8000-000000000002', requester: 'jordan@example.com' }, { id: '0eeeeeee-0000-4000-8000-000000000003', requester: 'jordan@example.com' }]);
  const stamps = db.writes('presence_support_requests');
  ok('5: a matched requester\'s requests are stamped in one write', stamps.length === 1 && /id=in\.\(0eeeeeee-0000-4000-8000-000000000002,0eeeeeee-0000-4000-8000-000000000003\)/.test(stamps[0].url) && out.clientOf['0eeeeeee-0000-4000-8000-000000000003'] === C1, JSON.stringify(stamps.map((s) => s.url)));
}

// ═══ 6. stage names ═══
{
  const S2 = uuid('2');
  db.reset({ presence_sales_templates: [{ id: 'st', site_id: S2, kind: 'proposal', name: '__stage_names__', body: '{"lead":"Enquiry"}', deleted_at: null, updated_at: at(1) }] });
  const a = await SN.loadStageLabels(S2); const b = await SN.loadStageLabels(S2);
  ok('6: kept per site — the second open doesn\'t read', a.lead === 'Enquiry' && b.lead === 'Enquiry' && db.reads('presence_sales_templates').length === 1);
  SN.forgetStageLabels(S2);
  db.tables.presence_sales_templates[0].body = '{"lead":"First call"}';
  ok('6: a rename forgets them at once', (await SN.loadStageLabels(S2)).lead === 'First call' && db.reads('presence_sales_templates').length === 2);
  const S3 = uuid('3');
  db.fail.add('presence_sales_templates');
  const d = await SN.loadStageLabels(S3);
  db.fail.delete('presence_sales_templates');
  db.tables.presence_sales_templates.push({ id: 'st3', site_id: S3, kind: 'proposal', name: '__stage_names__', body: '{"lead":"Hello"}', deleted_at: null, updated_at: at(2) });
  ok('6: a failed read answers the defaults and isn\'t kept', d.lead === 'New lead' && (await SN.loadStageLabels(S3)).lead === 'Hello');
}

// ═══ 7. My tasks ═══
{
  db.reset({});
  await SALES.loadMyTasks(STUDIO, U);
  const t = db.reads('presence_deal_tasks')[0]?.url || '', p = db.reads('presence_tasks')[0]?.url || '';
  ok('7: both task reads are ordered by due date before their caps', /order=due_date\.asc\.nullslast,created_at\.asc&limit=200/.test(t) && /order=due_date\.asc\.nullslast,created_at\.asc&limit=300/.test(p), `${t} | ${p}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
