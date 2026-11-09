// ── Sales extras, batch 3b (item 69, Nov 2026): "Did they open it?" ─────────
// Counted by Studio OS itself, never by mail-provider tracking:
//   • an emailed update carries a 1×1 image naming its send row; the first load
//     stamps opened_at, and the sent update reads "Opened by N of M";
//   • the first time the client opens a proposal's, agreement's or invoice's page,
//     the deal gets one line — "They opened your proposal".
// Real handlers against the shared in-memory PostgREST; all names are made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_extras_3b_test.mjs
Deno.env.set('APPROVAL_SECRET', 'sign-secret-for-tests-0123456789abcdef');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3'), CT = uuid('4'), DEAL = uuid('5');
const AG = '0eeeeeee-0000-4000-8000-000000000001', MEM = '0eeeeeee-0000-4000-8000-000000000002';
const PROP = uuid('6'), CON = uuid('7'), DEP = uuid('8'), INV = uuid('9'), B1 = uuid('a'), C1 = uuid('b'), C1_SITE = uuid('c'), P1 = uuid('d');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE }, unique: { presence_broadcast_sends: [{ cols: ['broadcast_id', 'email'] }] } });
const EE = await import('../../supabase/functions/presence/lib/email_engagement.ts');
const BC = await import('../../supabase/functions/presence/lib/broadcast.ts');
const BR = await import('../../supabase/functions/presence/routes/broadcasts.ts');
const SALES = await import('../../supabase/functions/presence/routes/sales.ts');
const DOCS = await import('../../supabase/functions/presence/lib/documents.ts');
const DA = await import('../../supabase/functions/presence/crm/deal_activity.ts');
const ACT = await import('../../supabase/functions/presence/crm/activity.ts');
const CRM = await import('../../supabase/functions/presence/routes/crm.ts');
const { openToken } = await import('../../supabase/functions/_shared/email_infra.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (method, path) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-owner' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const at = (n) => new Date(Date.parse('2026-11-01T00:00:00Z') + n * 60_000).toISOString();
const secret = SALES.linkSecret();
const exp = Math.floor(Date.now() / 1000) + 86400;
const opens = () => db.writes('presence_deal_events').filter((w) => w.method === 'POST' && w.body?.kind === 'doc_opened').map((w) => w.body);
const reset = (t) => { db.reset(t); db.fail.add('rpc/rate_hit'); };   // the limiter fails open

// Before APPLY-0144 the columns and the kind don't exist: a read selecting opened_at
// answers 42703, a write naming first_viewed_at on agreements/invoices answers
// PGRST204, and a 'doc_opened' line breaks the kind check (23514).
const before0144 = (fn) => async (...a) => {
  const fake = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url)), body = init.body ? String(init.body) : '';
    const bad = (code, message) => new Response(JSON.stringify({ code, message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (/\/rest\/v1\/presence_broadcast_sends/.test(u) && (/select=[^&]*opened_at/.test(u) || /opened_at/.test(body) || /opened_at=/.test(u))) return bad('42703', 'column presence_broadcast_sends.opened_at does not exist');
    if (/\/rest\/v1\/presence_(contracts|invoices)\?/.test(u) && (/first_viewed_at/.test(u) || /first_viewed_at/.test(body))) return bad('PGRST204', "Could not find the 'first_viewed_at' column");
    if (/\/rest\/v1\/presence_deal_events/.test(u) && /"doc_opened"/.test(body)) return bad('23514', 'new row violates check constraint "presence_deal_events_kind_check"');
    return fake(url, init);
  };
  try { return await fn(...a); } finally { globalThis.fetch = fake; }
};

// ═══ 1. the update's open counter: the image and its link ═══
{
  const url = await EE.openPixelUrl(B1);
  const tok = await openToken(B1);
  ok('1: the link names the send row and its signature, and no address', url === `https://db.test/functions/v1/presence/email/open/${B1}.${tok}.gif` && !/@/.test(url) && tok.length === 32, url);
  ok('1: anything that is not a row id gets no link', (await EE.openPixelUrl('')) === '' && (await EE.openPixelUrl('riley@example.org')) === '');
  const tag = EE.openPixelTag(url);
  ok('1: a 1×1 image with no alt text', /^<img src="https:\/\/db\.test\/[^"]+\.gif" width="1" height="1" alt="" style="[^"]*"/.test(tag), tag);
  ok('1: nothing odd ever lands inside the tag', EE.openPixelTag('javascript:alert(1)') === '' && EE.openPixelTag('https://x.test/a"onerror="x') === '' && EE.openPixelTag('') === '');
  ok('1: the answer is the classic 43-byte transparent GIF', EE.OPEN_PIXEL.length === 43 && String.fromCharCode(...EE.OPEN_PIXEL.slice(0, 6)) === 'GIF89a' && EE.OPEN_PIXEL[42] === 0x3b);
}

// ═══ 2. opening the update stamps its row once ═══
{
  const ROW = uuid('e');
  reset({ presence_broadcast_sends: [{ id: ROW, broadcast_id: B1, site_id: SITE, email: 'riley@example.org', status: 'sent', created_at: at(1) }] });
  const r = await EE.handleEmailOpen(ROW, await openToken(ROW));
  const bytes = new Uint8Array(await r.arrayBuffer());
  ok('2: answers the image, never kept by a cache', r.status === 200 && r.headers.get('content-type') === 'image/gif' && bytes.length === 43 && /no-store/.test(r.headers.get('cache-control') || ''));
  const first = db.tables.presence_broadcast_sends[0].opened_at;
  ok('2: the first open stamps opened_at', typeof first === 'string' && !Number.isNaN(Date.parse(first)));
  const w = db.writes('presence_broadcast_sends').filter((x) => x.method === 'PATCH');
  ok('2: …only on that row, only if sent, only if not stamped yet', w.length === 1 && w[0].url.includes(`id=eq.${ROW}`) && w[0].url.includes('status=eq.sent') && w[0].url.includes('opened_at=is.null'), JSON.stringify(w.map((x) => x.url)));
  await new Promise((s) => setTimeout(s, 5));
  await EE.handleEmailOpen(ROW, await openToken(ROW));
  ok('2: a second open changes nothing', db.tables.presence_broadcast_sends[0].opened_at === first);
  db.log = [];
  const bad = await EE.handleEmailOpen(ROW, 'x'.repeat(32));
  ok('2: a wrong signature still answers the image, and writes nothing', bad.status === 200 && (await bad.arrayBuffer()).byteLength === 43 && db.writes('presence_broadcast_sends').length === 0);
  const other = uuid('f');
  db.log = [];
  await EE.handleEmailOpen(other, await openToken(ROW));
  ok('2: one row\'s signature never opens another row', db.writes('presence_broadcast_sends').length === 0);
  db.fail.add('presence_broadcast_sends');
  const down = await EE.handleEmailOpen(ROW, await openToken(ROW));
  ok('2: a database hiccup still answers the image', down.status === 200 && (await down.arrayBuffer()).byteLength === 43);
}

// ═══ 3. each emailed update carries its own image ═══
{
  reset({ presence_broadcast_sends: [] });
  const sent = [];
  const deps = {
    loadBrand: async () => ({ name: 'Example Studio', accent: '#5b3fa0', accentDark: '#3d2a6e' }),
    resolveFn: async () => ({ recipients: [{ email: 'riley@example.org', firstName: 'Riley' }, { email: 'sam@example.org', firstName: 'Sam' }], suppressed: 0, audience: 2 }),
    sendFn: async (to, subject, html) => { sent.push({ to, html }); return true; },
    sentInLastDayFn: async () => 0, dailyCap: 100,
  };
  const out = await BC.dispatchBroadcast({ id: B1, site_id: SITE, subject: 'Holiday hours', body: 'We close at noon.', audience: 'everyone', status: 'sending' }, deps);
  const rowsNow = db.tables.presence_broadcast_sends || [];
  const idOf = (e) => rowsNow.find((r) => r.email === e)?.id;
  ok('3: both sent', out.sent === 2 && sent.length === 2 && rowsNow.length === 2);
  const expect = async (e) => EE.openPixelTag(await EE.openPixelUrl(idOf(e)));
  ok('3: each email ends with the image for ITS OWN row', sent[0].html.endsWith(await expect('riley@example.org')) && sent[1].html.endsWith(await expect('sam@example.org')) && sent[0].html.includes(idOf('riley@example.org')) && !sent[0].html.includes(idOf('sam@example.org')));
  ok('3: the words of the update are unchanged', sent[0].html.includes('We close at noon.'));
  const again = await BC.dispatchBroadcast({ id: B1, site_id: SITE, subject: 'Holiday hours', body: 'We close at noon.', audience: 'everyone', status: 'sending' }, { ...deps, sendFn: async () => { throw new Error('must not send twice'); } });
  ok('3: the send-once guard still holds', again.already === 2 && again.sent === 0);
  const plain = [];
  await BC.dispatchBroadcast({ id: uuid('0'), site_id: SITE, subject: 'S', body: 'B', audience: 'everyone', status: 'sending' }, { ...deps, claimFn: async () => 'inserted', sendFn: async (to, s, html) => { plain.push(html); return true; } });
  ok('3: no row id, no image (a claim that does not say which row)', plain.length === 2 && !plain.some((h) => /<img/.test(h)));
}

// ═══ 4. who opened a sent update ═══
{
  const e = EE.engagementOf([
    { email: 'a@example.org', opened_at: at(5) }, { email: 'b@example.org', opened_at: null },
    { email: 'c@example.org', opened_at: at(9) }, { email: 'd@example.org' },
  ]);
  ok('4: counts what was sent and what was opened, newest open first', e.sent === 4 && e.opened === 2 && e.opened_by.join() === 'c@example.org,a@example.org', JSON.stringify(e));
  ok('4: the list of names is capped', EE.engagementOf(Array.from({ length: 40 }, (_, i) => ({ email: `p${i}@example.org`, opened_at: at(i) }))).opened_by.length === 25);
  reset({
    presence_broadcasts: [{ id: B1, site_id: SITE, subject: 'Holiday hours', body: 'We close at noon.', audience: 'everyone', status: 'sent', sent_count: 3, sent_at: at(1) }],
    presence_broadcast_sends: [
      { id: uuid('e'), broadcast_id: B1, site_id: SITE, email: 'riley@example.org', status: 'sent', opened_at: at(3) },
      { id: uuid('f'), broadcast_id: B1, site_id: SITE, email: 'sam@example.org', status: 'sent', opened_at: null },
      { id: uuid('0'), broadcast_id: B1, site_id: SITE, email: 'kai@example.org', status: 'sent', opened_at: at(4) },
      { id: uuid('9'), broadcast_id: B1, site_id: SITE, email: 'gone@example.org', status: 'failed', opened_at: null },
      { id: uuid('8'), broadcast_id: B1, site_id: uuid('7'), email: 'other@example.org', status: 'sent', opened_at: at(2) },
    ],
  });
  const g = await res(await BR.handleBroadcastGet(site, B1, cors));
  const en = g.body?.data?.engagement;
  ok('4: the sent update says who opened it (this studio\'s sends only, failed ones left out)', g.status === 200 && en && en.sent === 3 && en.opened === 2 && en.opened_by.join() === 'kai@example.org,riley@example.org', JSON.stringify(en));
  const before = await res(await before0144(() => BR.handleBroadcastGet(site, B1, cors))());
  ok('4: before APPLY-0144 the update still opens, with no count', before.status === 200 && before.body?.data?.engagement === null && before.body?.data?.broadcast?.id === B1);
  db.tables.presence_broadcasts[0].status = 'draft';
  const draft = await res(await BR.handleBroadcastGet(site, B1, cors));
  ok('4: a draft has no count to show', draft.status === 200 && draft.body?.data?.engagement === null);
}

// ═══ 5. the sign page: each document's first open says so on the deal ═══
const docWorld = (over = {}) => ({
  presence_sites: [site],
  presence_deals: [{ id: DEAL, site_id: SITE, contact_id: CT, title: 'Website refresh', stage: 'proposal', deleted_at: null }],
  presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: 'riley@example.org', deleted_at: null }],
  presence_proposals: [{ id: PROP, deal_id: DEAL, site_id: SITE, title: 'Website refresh', line_items: [], subtotal_cents: 250000, currency: 'usd', terms: '', status: 'sent', first_viewed_at: null, expires_at: null, created_at: at(1), deleted_at: null }],
  presence_contracts: [{ id: CON, deal_id: DEAL, site_id: SITE, title: 'Service agreement', body: 'We agree.', content_hash: 'h', status: 'sent', signed_at: null, signer_name: null, created_at: at(2), deleted_at: null }],
  presence_invoices: [{ id: DEP, deal_id: DEAL, site_id: SITE, title: 'Deposit', purpose: 'deposit', status: 'open', amount_cents: 50000, stripe_url: 'https://buy.stripe.test/dep', paid_at: null, created_at: at(3), deleted_at: null }],
  presence_deal_events: [],
  ...over,
});
{
  reset(docWorld());
  const flow = await SALES.signSalesToken({ t: 'flow', id: DEAL, site_id: SITE, exp }, secret);
  const v1 = await res(await SALES.handleSalesPublicView(req('GET', '/sales/view'), flow, cors));
  ok('5: the page opens as before', v1.status === 200 && v1.body?.data?.kind === 'flow' && v1.body?.data?.proposal?.id === PROP && v1.body?.data?.contract?.locked === true, JSON.stringify(v1.body?.data?.contract));
  ok('5: the proposal is stamped and the deal says "They opened your proposal"', !!db.tables.presence_proposals[0].first_viewed_at && opens().length === 1 && opens()[0].deal_id === DEAL && opens()[0].site_id === SITE && opens()[0].detail?.what === 'proposal' && opens()[0].detail?.doc_id === PROP, JSON.stringify(opens()));
  ok('5: a locked agreement (proposal not yet accepted) is not "opened"', !db.tables.presence_contracts[0].first_viewed_at && !opens().some((o) => o.detail?.what === 'agreement'));
  await SALES.handleSalesPublicView(req('GET', '/sales/view'), flow, cors);
  ok('5: opening it again adds nothing', opens().length === 1);
  db.tables.presence_proposals[0].status = 'accepted';
  await SALES.handleSalesPublicView(req('GET', '/sales/view'), flow, cors);
  ok('5: once the agreement can be read, its first open says so too', opens().length === 2 && opens()[1].detail?.what === 'agreement' && opens()[1].detail?.doc_id === CON && !!db.tables.presence_contracts[0].first_viewed_at);
  ok('5: the deposit is not "opened" while its pay button is hidden', !db.tables.presence_invoices[0].first_viewed_at);
  db.tables.presence_contracts[0].status = 'signed';
  const v4 = await res(await SALES.handleSalesPublicView(req('GET', '/sales/view'), flow, cors));
  ok('5: with the pay button in front of them, the deposit counts', v4.body?.data?.deposit?.url === 'https://buy.stripe.test/dep' && opens().length === 3 && opens()[2].detail?.what === 'deposit' && opens()[2].detail?.doc_id === DEP);
  await SALES.handleSalesPublicView(req('GET', '/sales/view'), flow, cors);
  ok('5: and every later visit adds nothing', opens().length === 3);
}
{
  reset(docWorld());
  const pt = await SALES.signSalesToken({ t: 'proposal', id: PROP, site_id: SITE, exp }, secret);
  const v = await res(await SALES.handleSalesPublicView(req('GET', '/sales/view'), pt, cors));
  ok('5: an older proposal-only link works the same way', v.status === 200 && v.body?.data?.kind === 'proposal' && v.body?.data?.id === PROP && !('deal_id' in v.body.data) && opens().length === 1 && opens()[0].detail?.what === 'proposal');
  const ct = await SALES.signSalesToken({ t: 'contract', id: CON, site_id: SITE, exp }, secret);
  const c = await res(await SALES.handleSalesPublicView(req('GET', '/sales/view'), ct, cors));
  await SALES.handleSalesPublicView(req('GET', '/sales/view'), ct, cors);
  ok('5: …and an agreement-only link, once', c.status === 200 && c.body?.data?.kind === 'contract' && !('deal_id' in c.body.data) && opens().length === 2 && opens()[1].detail?.what === 'agreement');
}
{
  reset(docWorld());
  const flow = await SALES.signSalesToken({ t: 'flow', id: DEAL, site_id: SITE, exp }, secret);
  db.tables.presence_proposals[0].status = 'accepted';
  const v = await res(await before0144(() => SALES.handleSalesPublicView(req('GET', '/sales/view'), flow, cors))());
  ok('5: before APPLY-0144 the page still opens, and no line is written', v.status === 200 && v.body?.data?.contract?.id === CON && !v.body?.data?.contract?.locked && opens().length === 0);
  ok('5: …the proposal keeps its stamp, as it always has', !!db.tables.presence_proposals[0].first_viewed_at);
}

// ═══ 6. the invoice copy linked from the email ═══
{
  reset(docWorld({ presence_invoices: [{ id: INV, deal_id: DEAL, site_id: SITE, title: 'Second payment', description: '', purpose: 'service', status: 'open', amount_cents: 120000, currency: 'usd', stripe_url: 'https://buy.stripe.test/inv', due_date: null, paid_at: null, created_at: at(4), deleted_at: null }] }));
  const drawer = await DOCS.signDocToken({ t: 'doc', k: 'invoice', id: INV, site_id: SITE, exp }, secret);
  const r0 = await SALES.handleSalesDocument(req('GET', '/sales/doc'), drawer, cors);
  ok('6: the studio printing it from the deal is not the client opening it', r0.status === 200 && opens().length === 0 && !db.tables.presence_invoices[0].first_viewed_at);
  const emailed = await DOCS.signDocToken({ t: 'doc', k: 'invoice', id: INV, site_id: SITE, exp, e: 1 }, secret);
  const r1 = await SALES.handleSalesDocument(req('GET', '/sales/doc'), emailed, cors);
  const html = await r1.text();
  ok('6: the emailed copy counts: "They opened your invoice"', r1.status === 200 && /Second payment/.test(html) && opens().length === 1 && opens()[0].detail?.what === 'invoice' && opens()[0].detail?.doc_id === INV);
  await SALES.handleSalesDocument(req('GET', '/sales/doc'), emailed, cors);
  ok('6: once', opens().length === 1);
  const vt = await DOCS.verifyDocToken(emailed, secret, Math.floor(Date.now() / 1000));
  ok('6: the emailed mark survives the signature check', vt?.e === 1 && (await DOCS.verifyDocToken(drawer, secret, Math.floor(Date.now() / 1000)))?.e === undefined);
}

// ═══ 7. the words ═══
{
  const line = (what) => DA.describeSystemEvent({ kind: 'doc_opened', detail: { what } });
  ok('7: "They opened your proposal / agreement / invoice / deposit request"', line('proposal') === 'They opened your proposal' && line('agreement') === 'They opened your agreement' && line('invoice') === 'They opened your invoice' && line('deposit') === 'They opened your deposit request');
  ok('7: anything else reads as a document', line('weird') === 'They opened your document' && line(undefined) === 'They opened your document');
  const it = ACT.mapDealEvent({ id: uuid('e'), kind: 'doc_opened', detail: { what: 'proposal' }, created_at: at(9) }, DEAL);
  ok('7: on the record it is a deal line that opens the deal', it?.title === 'They opened your proposal' && it?.kind === 'deal_event' && it?.href === `/pipeline.html?deal=${DEAL}`);
  const tl = DA.mergeDealTimeline([{ id: uuid('e'), kind: 'doc_opened', detail: { what: 'agreement' }, created_at: at(9) }]);
  ok('7: on the deal timeline too', tl.length === 1 && tl[0].text === 'They opened your agreement' && tl[0].kind === 'doc_opened' && tl[0].source === 'system');
  ok('7: an open is not "last contacted" (only what the studio logs is)', DA.lastContactedAt([{ kind: 'doc_opened', detail: { what: 'proposal' }, created_at: at(9) }]) === null);
  const upd = (opened) => ACT.mapConversationItem({ id: B1, kind: 'broadcast', from: 'studio', subject: 'Holiday hours', body: '', created_at: at(1), opened });
  ok('7: an update on the record says when they opened it', upd(true)?.meta === 'Update · Opened' && upd(false)?.meta === 'Update');
}

// ═══ 8. the record reads opens, and still works before APPLY-0144 ═══
{
  const world = {
    presence_sites: [site, { id: C1_SITE, client_id: C1, status: 'live', edition: 'presence' }],
    clients: [{ id: OWNER, name: 'Example Studio', email: 'owner@example.com', contact_email: null, deleted_at: null }, { id: C1, name: 'Jordan Ellis', email: 'jordan@example.com', contact_email: null, deleted_at: null }],
    presence_agency_members: [{ id: MEM, agency_id: AG, user_id: U, email: 'owner@example.com', role: 'owner', status: 'active' }],
    presence_agencies: [{ id: AG, name: 'Example Studio', status: 'active', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} }],
    presence_agency_clients: [{ site_id: C1_SITE, agency_id: AG, status: 'active', tags: [], owner_email: 'jordan@example.com' }],
    presence_service_links: [{ project_id: P1, agency_site_id: SITE, customer_client_id: C1, customer_site_id: C1_SITE, status: 'active', created_at: at(0) }],
    presence_deals: [{ id: DEAL, site_id: SITE, converted_client_id: C1, stage: 'won', next_step: null, next_step_at: null, deleted_at: null, updated_at: at(3) }],
    presence_deal_events: [{ id: uuid('e'), deal_id: DEAL, site_id: SITE, kind: 'doc_opened', from_stage: '', to_stage: '', detail: { what: 'proposal', doc_id: PROP }, actor: 'client-link', created_at: at(30) }],
    presence_broadcast_sends: [{ broadcast_id: B1, site_id: SITE, email: 'jordan@example.com', status: 'sent', created_at: at(50), opened_at: at(55) }],
    presence_broadcasts: [{ id: B1, subject: 'Holiday hours' }],
  };
  reset(world);
  const r = await res(await CRM.handleCrmActivity(req('GET', `/crm/activity?client_id=${C1}`), 'jwt-owner', site, owner, cors));
  const items = r.body?.data?.items || [];
  const upd = items.find((i) => i.kind === 'broadcast'), opened = items.find((i) => i.title === 'They opened your proposal');
  ok('8: the record shows the opened update and the opened proposal', r.status === 200 && upd?.meta === 'Update · Opened' && /Holiday hours/.test(upd?.title || '') && !!opened, JSON.stringify(items.map((i) => [i.kind, i.title, i.meta])));
  // before APPLY-0144 the column isn't there at all (the fake hands back whole rows, so drop it)
  reset({ ...world, presence_broadcast_sends: world.presence_broadcast_sends.map(({ opened_at, ...x }) => x) });
  const b = await res(await before0144(() => CRM.handleCrmActivity(req('GET', `/crm/activity?client_id=${C1}`), 'jwt-owner', site, owner, cors))());
  const upd0 = (b.body?.data?.items || []).find((i) => i.kind === 'broadcast');
  ok('8: before APPLY-0144 the update is still on the record, just without "Opened"', b.status === 200 && upd0?.meta === 'Update' && /Holiday hours/.test(upd0?.title || ''), JSON.stringify(upd0));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:', failed.join(' | ')); Deno.exit(1); }
