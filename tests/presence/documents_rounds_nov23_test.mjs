// ── Sales items 180 and 179 (Nov 22 2026 review): the Documents page and revision rounds ──
//   deno run --allow-read --allow-env --allow-net tests/presence/documents_rounds_nov23_test.mjs
// 180: every proposal, estimate and agreement in one list with where it stands, and Remind,
// which re-sends the client's link once (never twice). 179: a deal counts its included rounds of
// changes; each Request changes in the portal uses one ("Round 1 of 2"); past the last, the
// request becomes an "Extra work" estimate, and approving it adds a to-do and a draft invoice.
// The pages are in tests/e2e/documents-rounds-nov23.spec.ts. Clock pinned throughout.
Deno.env.set('APPROVAL_SECRET', 'sign-secret-for-tests-0123456789abcdef');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example.com');
Deno.env.delete('STRIPE_SECRET');
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock, PINNED_NOW, daysFrom } from './clock.mjs';
pinClock();
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3'), CT = uuid('4'), DEAL = uuid('5'), EST = uuid('6'), PROP = uuid('8'), CON = uuid('9'), PROJ = uuid('a'), AP1 = uuid('b'), AP2 = uuid('c'), AP3 = uuid('d'), CUST = uuid('e'), LINK = uuid('f');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });
const pg = globalThis.fetch;
const mail = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(String(init.body || '{}'))); return new Response(JSON.stringify({ id: 'em_' + mail.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return pg(url, init);
};
const DL = await import('../../supabase/functions/presence/routes/documents_list.ts');
const RR = await import('../../supabase/functions/presence/lib/revision_rounds.ts');
const DA = await import('../../supabase/functions/presence/crm/deal_activity.ts');
const SALES = await import('../../supabase/functions/presence/routes/sales.ts');
const ES = await import('../../supabase/functions/presence/routes/estimates.ts');
const CD = await import('../../supabase/functions/presence/routes/client_delivery.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const ago = (d) => daysFrom(PINNED_NOW, -d), ahead = (d) => daysFrom(PINNED_NOW, d);
const T = (name) => db.tables[name] || [];
const row = (name, id) => T(name).find((x) => x.id === id);
const LINES = [{ label: 'Homepage', qty: 1, unit_cents: 90000 }];

// ═══ 180: where each document stands, in one word ═══
eq('180: a proposal\'s word: draft, out, opened, expired, replaced, accepted, declined, withdrawn', [
  DL.docState('proposal', { status: 'draft' }, PINNED_NOW),
  DL.docState('proposal', { status: 'sent', expires_at: ahead(5) }, PINNED_NOW),
  DL.docState('proposal', { status: 'sent', expires_at: ahead(5), first_viewed_at: ago(1) }, PINNED_NOW),
  DL.docState('proposal', { status: 'sent', expires_at: ago(1), first_viewed_at: ago(3) }, PINNED_NOW),
  DL.docState('proposal', { status: 'sent', line_items: [...LINES, { __meta__: { superseded_by: PROP } }] }, PINNED_NOW),
  DL.docState('proposal', { status: 'accepted' }, PINNED_NOW), DL.docState('proposal', { status: 'declined' }, PINNED_NOW), DL.docState('proposal', { status: 'withdrawn' }, PINNED_NOW),
], ['draft', 'out', 'opened', 'expired', 'replaced', 'accepted', 'declined', 'withdrawn']);
eq('180: an estimate approved reads accepted; an agreement signed, taken back, or out (they never expire)', [
  DL.docState('estimate', { status: 'approved' }, PINNED_NOW), DL.docState('contract', { status: 'signed' }, PINNED_NOW), DL.docState('contract', { status: 'voided' }, PINNED_NOW), DL.docState('contract', { status: 'sent', expires_at: ago(9) }, PINNED_NOW),
], ['accepted', 'signed', 'withdrawn', 'out']);
eq('180: Remind is for one still waiting, and only once', [DL.canRemind('proposal', { status: 'sent' }, PINNED_NOW), DL.canRemind('proposal', { status: 'sent', reminded_at: ago(1) }, PINNED_NOW), DL.canRemind('proposal', { status: 'sent', expires_at: ago(1) }, PINNED_NOW), DL.canRemind('contract', { status: 'signed' }, PINNED_NOW)], [true, false, false, false]);

const world = (extra = {}) => {
  db.reset({
    presence_sites: [{ id: SITE, client_id: OWNER }],
    presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'contract', contact_id: CT, expected_value_cents: 250000, revision_rounds: null, created_project_id: PROJ, deleted_at: null }],
    presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: 'riley@example.org', company: 'Blue Finch Café' }],
    presence_proposals: [{ id: PROP, site_id: SITE, deal_id: DEAL, title: 'Website', line_items: [{ label: 'Website', qty: 1, unit_cents: 240000 }], status: 'accepted', version: 1, sent_at: ago(9), decided_at: ago(7), created_at: ago(10), deleted_at: null }],
    presence_contracts: [{ id: CON, site_id: SITE, deal_id: DEAL, title: 'Service agreement', status: 'sent', sent_at: ago(2), first_viewed_at: ago(1), created_at: ago(3), deleted_at: null }],
    presence_estimates: [{ id: EST, site_id: SITE, deal_id: DEAL, title: 'Logo', line_items: [{ label: 'Logo', qty: 1, unit_cents: 50000 }], status: 'sent', sent_at: ago(20), expires_at: ago(1), created_at: ago(21), deleted_at: null }],
    presence_deal_events: [], presence_projects: [{ id: PROJ, site_id: SITE, client_id: CUST, deal_id: DEAL, name: 'Blue Finch Café website', status: 'active', client_visible: true, deleted_at: null }],
    presence_approvals: [], presence_tasks: [], presence_invoices: [],
    ...extra,
  });
  db.fail.add('rpc/rate_hit');
  mail.length = 0;
};

world();
{
  const r = await res(await DL.handleDocumentsList(req('GET', `/sales/documents?today=${PINNED_NOW.slice(0, 10)}`), site, cors));
  const by = (id) => (r.body?.data?.items || []).find((x) => x.id === id);
  ok('180: every proposal, estimate and agreement is one row, newest out first', r.status === 200 && r.body.data.items.map((x) => x.kind).join(',') === 'contract,proposal,estimate', JSON.stringify(r.body?.data?.items?.map((x) => [x.kind, x.sent_at])));
  eq('180: each row has its customer, amount and where it stands', [by(CON).business, by(CON).person, by(CON).amount_cents, by(CON).state, by(CON).can_remind, by(PROP).state, by(PROP).amount_cents, by(EST).state, by(EST).can_remind],
    ['Blue Finch Café', 'Riley Park', 240000, 'opened', true, 'accepted', 240000, 'expired', false]);
  let m = await res(await DL.handleDocumentRemind(req('POST', '/sales/documents/remind', { kind: 'contract', id: CON }), site, owner, cors));
  ok('180: Remind re-sends the client\'s link by email and marks it', m.status === 200 && mail.length === 1 && mail[0].to?.includes?.('riley@example.org') !== false && !!row('presence_contracts', CON).reminded_at, JSON.stringify(m.body));
  ok('180: …and the deal\'s history says so', T('presence_deal_events').some((e) => e.kind === 'note' && DA.dealChangeLine(e.detail) === 'Reminder sent for the agreement'));
  m = await res(await DL.handleDocumentRemind(req('POST', '/sales/documents/remind', { kind: 'contract', id: CON }), site, owner, cors));
  ok('180: never twice: a second press sends nothing', m.status === 409 && m.body?.error === 'already_reminded' && mail.length === 1);
  m = await res(await DL.handleDocumentRemind(req('POST', '/sales/documents/remind', { kind: 'estimate', id: EST }), site, owner, cors));
  ok('180: one past its date is not reminded (Revise sends a fresh one)', m.status === 409 && m.body?.error === 'expired' && mail.length === 1);
  m = await res(await DL.handleDocumentRemind(req('POST', '/sales/documents/remind', { kind: 'proposal', id: PROP }), site, owner, cors));
  ok('180: nor one they already answered', m.status === 409 && m.body?.error === 'not_waiting');
}
world({ presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: '', company: 'Blue Finch Café' }] });
{
  const m = await res(await DL.handleDocumentRemind(req('POST', '/sales/documents/remind', { kind: 'contract', id: CON }), site, owner, cors));
  ok('180: with no email on the deal nothing is sent, and the one reminder isn\'t spent', m.status === 409 && m.body?.error === 'not_sent' && !row('presence_contracts', CON).reminded_at && mail.length === 0);
}

// ═══ 179: rounds of changes ═══
eq('179: rounds as typed: a whole number 0 to 20, or nothing', [RR.cleanRounds(2), RR.cleanRounds('0'), RR.cleanRounds(''), RR.cleanRounds(1.5), RR.cleanRounds(21)], [{ ok: true, value: 2 }, { ok: true, value: 0 }, { ok: true, value: null }, { ok: false }, { ok: false }]);
eq('179: both sides read it plainly', [RR.roundsLine({ included: 2, used: 1 }), RR.roundsLine({ included: 2, used: 3 }), RR.roundsLine({ included: null, used: 4 }), RR.nextRoundWords({ included: 2, used: 0 }), RR.nextRoundWords({ included: 2, used: 2 })],
  ['1 of 2 rounds of changes used', '2 of 2 rounds of changes used, and 1 more asked for as extra work', '', 'This is round 1 of 2 included.', 'Your 2 included rounds are used, so your studio will price these changes before doing them.']);
{
  world();
  let r = await res(await SALES.handleSalesDeal(req('PATCH', `/sales/deals/${DEAL}`, { revision_rounds: 2.5 }), site, owner, DEAL, cors));
  ok('179: the deal refuses a part round, out loud', r.status === 422 && /whole number from 0 to 20/.test(r.body?.message || ''));
  r = await res(await SALES.handleSalesDeal(req('PATCH', `/sales/deals/${DEAL}`, { revision_rounds: 2 }), site, owner, DEAL, cors));
  ok('179: the number is set on the deal', r.status === 200 && row('presence_deals', DEAL).revision_rounds === 2);
}
const approval = (id, over = {}) => ({ id, site_id: SITE, project_id: PROJ, subject_type: 'website', subject_id: null, title: 'Homepage draft', summary: '', content_hash: 'h-' + id, status: 'pending', client_visible: true, deleted_at: null, created_at: ago(1), ...over });
const clientSite = { id: uuid('7'), client_id: CUST, status: 'live', edition: 'presence' };
const client = { kind: 'client', userId: uuid('6'), email: 'riley@example.org', jwt: 'jwt-client', requestId: 'c' };
world({
  presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'won', contact_id: CT, expected_value_cents: 250000, revision_rounds: 2, created_project_id: PROJ, deleted_at: null }],
  presence_approvals: [approval(AP1, { status: 'changes_requested', decided_at: ago(5) }), approval(AP2, { status: 'changes_requested', decided_at: ago(3) }), approval(AP3)],
  presence_service_links: [{ id: LINK, agency_site_id: SITE, project_id: PROJ, customer_client_id: CUST, customer_site_id: clientSite.id, status: 'active', created_at: ago(30) }],
});
{
  const view = await res(await CD.handleClientProject(req('GET', `/client/projects/${PROJ}`), clientSite, client, PROJ, cors));
  ok('179: the client\'s project says the included rounds are used, before they ask', view.status === 200 && view.body?.data?.rounds?.used === 2 && /price these changes/.test(view.body.data.rounds.next), JSON.stringify(view.body?.data?.rounds || view.body));
  const d = await res(await CD.handleClientApprovalDecide(req('POST', `/client/approvals/${AP3}/decide`, { decision: 'changes_requested', presented_hash: 'h-' + AP3, note: 'Add a gallery page with our menu photos' }), clientSite, client, AP3, cors));
  const extra = T('presence_estimates').find((e) => e.extra_work === true);
  ok('179: a third request on a 2-round deal is extra work', d.status === 200 && d.body?.data?.round?.n === 3 && d.body.data.round.of === 2 && d.body.data.round.extra === true, JSON.stringify(d.body));
  ok('179: …and it becomes a draft estimate marked Extra work, with their words to price', !!extra && extra.status === 'draft' && extra.title === 'Extra work: Homepage draft' && extra.approval_id === AP3 && extra.project_id === PROJ && extra.line_items[0].label === 'Add a gallery page with our menu photos' && extra.line_items[0].unit_cents === 0, JSON.stringify(extra));
  ok('179: the deal\'s history and the studio\'s Needs you say so', T('presence_deal_events').some((e) => DA.dealChangeLine(e.detail || {}) === 'Extra work estimate drafted: Extra work: Homepage draft') && T('presence_plan_notices').some((n) => n.period === `extrawork:${AP3}`));
  const deal = await res(await SALES.handleSalesDeal(req('GET', `/sales/deals/${DEAL}`), site, owner, DEAL, cors));
  ok('179: the studio\'s deal reads the rounds too', deal.body?.data?.rounds?.used === 3 && deal.body.data.rounds.line === '2 of 2 rounds of changes used, and 1 more asked for as extra work', JSON.stringify(deal.body?.data?.rounds));
  // the studio prices it and sends it; the client approves it by name
  extra.line_items = [{ label: 'Gallery page', qty: 1, unit_cents: 45000 }]; extra.subtotal_cents = 45000; extra.status = 'sent'; extra.sent_at = ago(0.1); extra.expires_at = ahead(30);
  const tok = await SALES.signSalesToken({ t: 'estimate', id: extra.id, site_id: SITE, exp: Math.floor(Date.now() / 1000) + 86400 }, SALES.linkSecret());
  const a = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${extra.id}/decide`, { token: tok, decision: 'approved', name: 'Riley Park' }), extra.id, cors));
  const task = T('presence_tasks').find((t) => t.source === `extra_work:${extra.id}`);
  const inv = T('presence_invoices').find((i) => i.id === row('presence_estimates', extra.id).invoice_id);
  ok('179: approved, it adds a to-do on the project and a draft invoice (not sent)', a.status === 200 && !!task && task.project_id === PROJ && task.title === 'Extra work: Homepage draft' && !!inv && inv.amount_cents === 45000 && inv.status === 'open' && !inv.stripe_url, JSON.stringify([a.body, task, inv]));
  ok('179: …once: a replayed approval adds nothing more', (await ES.extraWorkApproved(SITE, extra.id), T('presence_tasks').filter((t) => t.source === `extra_work:${extra.id}`).length === 1 && T('presence_invoices').length === 1));
}
world({ presence_approvals: [approval(AP1)], presence_service_links: [{ id: LINK, agency_site_id: SITE, project_id: PROJ, customer_client_id: CUST, customer_site_id: clientSite.id, status: 'active', created_at: ago(30) }] });
{
  const d = await res(await CD.handleClientApprovalDecide(req('POST', `/client/approvals/${AP1}/decide`, { decision: 'changes_requested', presented_hash: 'h-' + AP1, note: 'Bigger logo' }), clientSite, client, AP1, cors));
  ok('179: a deal that doesn\'t count rounds answers as before, with no round and no estimate', d.status === 200 && !d.body?.data?.round && !T('presence_estimates').some((e) => e.extra_work));
}

// ═══ Download my data carries the new fields, never where a signature came from ═══
{
  const X = await import('../../supabase/functions/presence/routes/sales_export.ts');
  const Z = await import('../../supabase/functions/presence/lib/zip_csv.ts');
  // the zip reader the export's own suite uses (sales_extras_2_test.mjs)
  const unzip = (bytes) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let e = bytes.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    const n = dv.getUint16(e + 10, true), cdOff = dv.getUint32(e + 16, true);
    const out = {}; let p = cdOff;
    for (let i = 0; i < n; i++) {
      const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
      const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
      const data = bytes.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + size);
      if (Z.crc32(data) !== crc) throw new Error('crc mismatch ' + name);
      out[name] = new TextDecoder().decode(data);
      p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return out;
  };
  world({
    presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'won', contact_id: CT, expected_value_cents: 250000, revision_rounds: 2, created_project_id: PROJ, deleted_at: null, created_at: ago(30) }],
    presence_proposals: [{ id: PROP, site_id: SITE, deal_id: DEAL, title: 'Website', line_items: [{ label: 'Website', qty: 1, unit_cents: 240000 }], status: 'accepted', version: 2, sent_at: ago(9), decided_at: ago(7), decided_name: 'Riley Park', reminded_at: ago(8), created_at: ago(10), deleted_at: null }],
    presence_contracts: [{ id: CON, site_id: SITE, deal_id: DEAL, title: 'Service agreement', status: 'voided', sent_at: ago(2), signed_evidence: { ip_hash: 'scrambled-0123' }, created_at: ago(3), deleted_at: null }],
    presence_estimates: [{ id: EST, site_id: SITE, deal_id: DEAL, title: 'Extra work: Homepage draft', line_items: [{ label: 'Gallery page', qty: 1, unit_cents: 45000 }], status: 'approved', version: 1, extra_work: true, decided_at: ago(1), decided_name: 'Riley Park', sent_at: ago(2), created_at: ago(3), deleted_at: null }],
    presence_sign_evidence: [{ id: uuid('9'), site_id: SITE, deal_id: DEAL, doc_kind: 'proposal', doc_id: PROP, signer_name: 'Riley Park', ip: '203.0.113.7', user_agent: 'Mozilla/5.0 (iPhone)', created_at: ago(7) }],
  });
  const r = await X.handleSalesExport(site, owner, cors);
  const files = unzip(new Uint8Array(await r.arrayBuffer()));
  const first = (name) => (files[name] || '').split('\r\n').slice(0, 2).join('\n');
  ok('Download my data: the deal\'s rounds, the proposal\'s typed name and Remind day', /Rounds of changes included/.test(first('deals.csv')) && /,2$/m.test(first('deals.csv')) && /Accepted by,Reminded/.test(first('proposals.csv')) && /Riley Park/.test(first('proposals.csv')), first('deals.csv') + ' | ' + first('proposals.csv'));
  ok('Download my data: an estimate\'s version, Extra work and who approved it; an agreement taken back reads withdrawn', /Version,Extra work,Status/.test(first('estimates.csv')) && /,1,yes,approved,/.test(first('estimates.csv')) && /Approved by/.test(first('estimates.csv')) && /withdrawn/.test(first('agreements.csv')), first('estimates.csv') + ' | ' + first('agreements.csv'));
  ok('Download my data: where a signature came from stays out of every file', !Object.values(files).some((t) => /203\.0\.113\.7|Mozilla\/5\.0 \(iPhone\)|scrambled-0123/.test(t)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
