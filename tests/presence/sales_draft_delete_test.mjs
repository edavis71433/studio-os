// ── Removing an UNSENT draft (proposal / agreement) ─────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_draft_delete_test.mjs
//
// The gap this pins: a mistaken proposal draft (Eric drafted the same $3,200
// twice on one deal) was PERMANENT — /sales/* registered create, revise, send,
// decide, sign and term, but no DELETE for either artifact. Nothing in the deal
// page offered a remove.
//
// The rule, and the reason it lives on the SERVER: only a `status='draft'` row
// may go. Once something is sent, decided or signed it is legal/audit-relevant
// material and stays on the record — a UI that hid the button would still leave
// the API open, so the guard is here and the UI merely mirrors it. Removal is a
// SOFT delete (`deleted_at`), never a row deletion: every read already filters
// `deleted_at=is.null`, so the row disappears from the deal while remaining
// recoverable at the data layer. A deal event records that it happened.
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const sales = read('supabase/functions/presence/routes/sales.ts');
const idx = read('supabase/functions/presence/index.ts');
const workspace = read('supabase/functions/presence/routes/workspace.ts');
const mig74 = read('supabase/migrations/0074_p2c_sales_lifecycle.sql');
const mig88 = read('supabase/migrations/0088_notice_kinds.sql');
const mig117 = read('supabase/migrations/0117_deal_event_delete_kinds.sql');
const pipeline = read('pipeline.html');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { handleSalesProposalDelete, handleSalesContractDelete } = await import('../../supabase/functions/presence/routes/sales.ts');

const SITE = { id: '11111111-1111-4111-8111-111111111111' };
const OTHER_SITE = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';
const PRINCIPAL = { kind: 'client', email: 'eric@example.com', userId: 'u1' };
const CORS = {};

const P_DRAFT = '44444444-4444-4444-8444-444444444444';
const P_SENT = '55555555-5555-4555-8555-555555555555';
const P_OTHER = '66666666-6666-4666-8666-666666666666';
const C_DRAFT = '77777777-7777-4777-8777-777777777777';
const C_SIGNED = '88888888-8888-4888-8888-888888888888';

// ═══ 1. Schema: `deleted_at` already exists on BOTH tables (no migration) ═════
{
  const table = (name) => (mig74.match(new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`)) || [])[1] || '';
  ok('presence_proposals carries deleted_at (0074) — soft delete needs no migration', /^\s*deleted_at timestamptz\s*$/m.test(table('presence_proposals')));
  ok('presence_contracts carries deleted_at (0074) — soft delete needs no migration', /^\s*deleted_at timestamptz\s*$/m.test(table('presence_contracts')));

  // The audit event DOES need one. presence_deal_events.kind is CHECK-constrained
  // and dealEvent() swallows write failures, so an un-widened check would drop the
  // removal silently — the row hidden with nothing recording why. 0117 widens it.
  const kinds = (s) => ((s.match(/presence_deal_events\s+add constraint presence_deal_events_kind_check\s+check \(kind in \(([\s\S]*?)\)\)/) || [])[1] || '')
    .replace(/--[^\n]*/g, '').match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1)) || [];
  const now = kinds(mig117);
  ok('0117 widens the deal-event kind check', now.length > 0);
  ok('0117 allows proposal_deleted + contract_deleted (the kinds the handlers write)',
    now.includes('proposal_deleted') && now.includes('contract_deleted'));
  ok('0117 is ADDITIVE — every kind 0088 allowed is carried forward verbatim',
    kinds(mig88).every((k) => now.includes(k)), kinds(mig88).filter((k) => !now.includes(k)).join(','));
  ok('0117 is idempotent (drop if exists, then add)', /drop constraint if exists presence_deal_events_kind_check/.test(mig117));
  ok('0117 documents its rollback', /rollback:/.test(mig117));
  // and the code writes ONLY kinds the constraint allows
  for (const k of sales.match(/dealEvent\([^,]+, [^,]+, '([a-z_]+)'/g) || []) {
    const kind = k.match(/'([a-z_]+)'$/)[1];
    ok(`sales.ts writes deal-event kind '${kind}' — allowed by the check`, now.includes(kind));
  }
}

// ═══ 2. Structural: routing, auth boundary, tenant scope, UUID validation ════
{
  ok('index.ts registers DELETE /sales/proposals/:id',
    /m = route\.match\(\/\^\\\/sales\\\/proposals\\\/\(\[0-9a-f-\]\{36\}\)\$\/\);[\s\S]{0,200}?method === 'DELETE'\) return handleSalesProposalDelete\(/.test(idx));
  ok('index.ts registers DELETE /sales/contracts/:id',
    /m = route\.match\(\/\^\\\/sales\\\/contracts\\\/\(\[0-9a-f-\]\{36\}\)\$\/\);[\s\S]{0,200}?method === 'DELETE'\) return handleSalesContractDelete\(/.test(idx));
  // The delete routes sit INSIDE the same authed /sales/* block as send/revise —
  // past the `principal.kind` gate, on a resolved `site`, and behind the reviewer
  // boundary. A client_reviewer must never reach them.
  const salesBlock = idx.slice(idx.indexOf("if (route === '/sales/contacts')"), idx.indexOf("if (route === '/projects')"));
  ok('both DELETE routes live in the authed /sales/* dispatch block (studio-gated)',
    /handleSalesProposalDelete\(/.test(salesBlock) && /handleSalesContractDelete\(/.test(salesBlock));
  ok('the client_reviewer boundary still admits NO /sales/* route', !/\/sales\//.test(workspace.slice(workspace.indexOf('export function reviewerAllowed'), workspace.indexOf('async function requireManager'))));

  const handler = (name) => (sales.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`)) || [])[0] || '';
  for (const [label, name, table] of [['proposal', 'handleSalesProposalDelete', 'presence_proposals'], ['contract', 'handleSalesContractDelete', 'presence_contracts']]) {
    const h = handler(name);
    ok(`${label} delete: the handler exists`, h.length > 0);
    ok(`${label} delete: validates the id with UUID_RE BEFORE interpolating it`, /if \(!UUID_RE\.test\(id\)\) return json\(\{ error: 'bad_request' \}, 400, cors\);/.test(h));
    const queries = h.match(new RegExp(`${table}\\?[^\\\`]*`, 'g')) || [];
    ok(`${label} delete: every ${table} query is site-scoped (${queries.length})`, queries.length >= 2 && queries.every((q) => q.includes('site_id=eq.${site.id}')));
    ok(`${label} delete: reads and writes skip already-deleted rows`, queries.length >= 2 && queries.every((q) => q.includes('deleted_at=is.null')));
    ok(`${label} delete: the WRITE is a soft delete — PATCH deleted_at, never a DELETE method`,
      /method: 'PATCH'/.test(h) && /deleted_at: nowIso\(\)/.test(h) && !/method: 'DELETE'/.test(h));
    ok(`${label} delete: the status guard is in the PATCH's WHERE too (race-safe)`, /status=eq\.draft/.test(h));
  }
}

// ═══ A fake PostgREST — the filter grammar these two routes speak ════════════
const world = { proposals: [], contracts: [], events: [], escaped: [], patches: [] };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const matches = (row, key, expr) => {
  if (expr === 'is.null') return row[key] === null || row[key] === undefined;
  if (expr === 'is.notnull') return row[key] !== null && row[key] !== undefined;
  const [op, ...rest] = expr.split('.');
  const want = decodeURIComponent(rest.join('.'));
  if (op === 'eq') return String(row[key]) === want;
  if (op === 'neq') return String(row[key]) !== want;
  throw new Error('fake PostgREST does not speak: ' + key + '=' + expr);
};
const TABLES = { presence_proposals: 'proposals', presence_contracts: 'contracts', presence_deal_events: 'events' };
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  if (u.hostname !== 'example.supabase.co' || !TABLES[table]) { world.escaped.push(url); return Promise.resolve(jres(500, { error: 'escaped the fake' })); }
  const bucket = world[TABLES[table]];
  const method = (init?.method || 'GET').toUpperCase();
  const filtered = () => {
    let out = bucket.slice();
    for (const [key, expr] of u.searchParams) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
      out = out.filter((r) => matches(r, key, expr));
    }
    const lim = Number(u.searchParams.get('limit'));
    return (Number.isFinite(lim) && lim > 0) ? out.slice(0, lim) : out;
  };
  if (method === 'GET') return Promise.resolve(jres(200, filtered()));
  if (method === 'POST') { const body = JSON.parse(init.body); bucket.push(body); return Promise.resolve(jres(201, [body])); }
  if (method === 'PATCH') {
    const patch = JSON.parse(init.body);
    const hit = filtered();
    world.patches.push({ table, search: u.search, patch, rows: hit.length });
    for (const r of hit) Object.assign(r, patch);
    return Promise.resolve(jres(200, hit));
  }
  return Promise.resolve(jres(405, { error: 'method not allowed in the fake' }));
};

const seed = () => {
  world.proposals = [
    { id: P_DRAFT, site_id: SITE.id, deal_id: DEAL, title: 'Website build', status: 'draft', deleted_at: null },
    { id: P_SENT, site_id: SITE.id, deal_id: DEAL, title: 'Website build', status: 'sent', deleted_at: null },
    { id: P_OTHER, site_id: OTHER_SITE, deal_id: DEAL, title: 'Someone else’s draft', status: 'draft', deleted_at: null },
  ];
  world.contracts = [
    { id: C_DRAFT, site_id: SITE.id, deal_id: DEAL, title: 'Service agreement', status: 'draft', content_hash: 'h1', deleted_at: null },
    { id: C_SIGNED, site_id: SITE.id, deal_id: DEAL, title: 'Service agreement', status: 'signed', content_hash: 'h1', signer_name: 'Sam Rivera', deleted_at: null },
  ];
  world.events = []; world.escaped = []; world.patches = [];
};
const delProposal = async (id) => { const r = await handleSalesProposalDelete(SITE, PRINCIPAL, id, CORS); return { status: r.status, body: await r.json() }; };
const delContract = async (id) => { const r = await handleSalesContractDelete(SITE, PRINCIPAL, id, CORS); return { status: r.status, body: await r.json() }; };
const row = (bucket, id) => world[bucket].find((r) => r.id === id);

// ═══ 3. A draft goes — soft, and the row is still there ══════════════════════
{
  seed();
  const r = await delProposal(P_DRAFT);
  ok('draft proposal: deleting returns 200', r.status === 200, JSON.stringify(r.body));
  ok('draft proposal: deleted_at is STAMPED (soft delete)', typeof row('proposals', P_DRAFT)?.deleted_at === 'string');
  ok('draft proposal: the row is NOT hard-deleted — it stays recoverable', world.proposals.length === 3);
  ok('draft proposal: status is untouched (the row is hidden, not rewritten)', row('proposals', P_DRAFT)?.status === 'draft');
  ok('draft proposal: no other row was touched', row('proposals', P_SENT)?.deleted_at === null && row('proposals', P_OTHER)?.deleted_at === null);

  seed();
  const c = await delContract(C_DRAFT);
  ok('draft agreement: deleting returns 200', c.status === 200, JSON.stringify(c.body));
  ok('draft agreement: deleted_at is STAMPED (soft delete)', typeof row('contracts', C_DRAFT)?.deleted_at === 'string');
  ok('draft agreement: the row is NOT hard-deleted', world.contracts.length === 2);
  ok('draft agreement: content_hash is untouched (signing integrity is not our business)', row('contracts', C_DRAFT)?.content_hash === 'h1');
}

// ═══ 4. The audit trail records the removal ══════════════════════════════════
{
  seed();
  await delProposal(P_DRAFT);
  const ev = world.events[0];
  ok('audit: deleting a proposal writes ONE deal event', world.events.length === 1);
  ok('audit: the event kind names what happened (proposal_deleted)', ev?.kind === 'proposal_deleted');
  ok('audit: the event is scoped to the deal AND the site', ev?.deal_id === DEAL && ev?.site_id === SITE.id);
  ok('audit: the event carries the removed proposal id', ev?.detail?.proposal_id === P_DRAFT);

  seed();
  await delContract(C_DRAFT);
  const cev = world.events[0];
  ok('audit: deleting an agreement writes ONE deal event', world.events.length === 1);
  ok('audit: the event kind names what happened (contract_deleted)', cev?.kind === 'contract_deleted');
  ok('audit: the event carries the removed contract id', cev?.detail?.contract_id === C_DRAFT);

  // A REFUSED delete must not fabricate history.
  seed();
  await delProposal(P_SENT);
  await delContract(C_SIGNED);
  ok('audit: a refused delete writes NO event', world.events.length === 0);
}

// ═══ 5. Anything past draft is a record — 409, honestly worded ═══════════════
{
  seed();
  const sent = await delProposal(P_SENT);
  ok('sent proposal: refused with 409', sent.status === 409, String(sent.status));
  ok('sent proposal: the error names the reason (already_sent)', sent.body?.error === 'already_sent');
  ok('sent proposal: the message says it stays on the record', /already sent/i.test(sent.body?.message || '') && /record/i.test(sent.body?.message || ''));
  ok('sent proposal: deleted_at is NOT stamped', row('proposals', P_SENT)?.deleted_at === null);

  const signed = await delContract(C_SIGNED);
  ok('signed agreement: refused with 409', signed.status === 409, String(signed.status));
  ok('signed agreement: the error names the reason', typeof signed.body?.error === 'string' && signed.body.error !== 'not_found');
  ok('signed agreement: deleted_at is NOT stamped — a signature is permanent', row('contracts', C_SIGNED)?.deleted_at === null);
  ok('signed agreement: NOTHING was PATCHed', world.patches.length === 0);
}

// ═══ 6. Tenant isolation + malformed input ══════════════════════════════════
{
  seed();
  const cross = await delProposal(P_OTHER);       // a real draft — on somebody ELSE's site
  ok('cross-tenant: another site’s draft is 404 (matches the sibling send routes)', cross.status === 404, String(cross.status));
  ok('cross-tenant: it is untouched', row('proposals', P_OTHER)?.deleted_at === null);
  ok('cross-tenant: nothing was PATCHed', world.patches.length === 0);

  seed();
  const bad = await delProposal('not-a-uuid');
  ok('malformed id: 400 before any query runs', bad.status === 400 && bad.body?.error === 'bad_request');
  const badC = await delContract('../../presence_sites');
  ok('malformed id: the contract route refuses path-ish input too', badC.status === 400);
  ok('malformed id: no query was issued at all', world.patches.length === 0 && world.events.length === 0);

  seed();
  const missing = await delProposal('99999999-9999-4999-8999-999999999999');
  ok('unknown id: 404', missing.status === 404);
  ok('no request escaped the fake PostgREST', world.escaped.length === 0, world.escaped[0] || '');
}

// ═══ 7. The deal page offers Delete ONLY where the server would allow it ════
{
  const propRow = (pipeline.match(/const props=\(data\.proposals\|\|\[\]\)\.map\(p=>\{[\s\S]*?\}\)\.join\(''\)/) || [])[0] || '';
  const conRow = (pipeline.match(/const cons=\(data\.contracts\|\|\[\]\)\.map\(k=>\{[\s\S]*?\}\)\.join\(''\)/) || [])[0] || '';
  ok('deal page: the proposal row renders a delete control', /data-del-prop=/.test(propRow));
  ok('deal page: the agreement row renders a delete control', /data-del-con=/.test(conRow));
  // The SAME condition the server enforces — the UI can never offer what the API refuses.
  ok('deal page: the proposal delete is gated on status===\'draft\'', /p\.status===.draft.\?`<button[^`]*data-del-prop/.test(propRow));
  ok('deal page: the agreement delete is gated on status===\'draft\'', /k\.status===.draft.\?`<button[^`]*data-del-con/.test(conRow));
  // Destructive → confirm first, matching this page's existing idiom (delDeal / data-del-tpl).
  ok('deal page: deleting a proposal confirms first', /data-del-prop\]/.test(pipeline) && /\[data-del-prop\][\s\S]{0,240}confirm\(/.test(pipeline));
  ok('deal page: deleting an agreement confirms first', /\[data-del-con\][\s\S]{0,240}confirm\(/.test(pipeline));
  ok('deal page: both call DELETE on the right route and re-render the deal', /api\('\/sales\/proposals\/'\+[^,]+,'DELETE'\)/.test(pipeline) && /api\('\/sales\/contracts\/'\+[^,]+,'DELETE'\)/.test(pipeline));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log('  - ' + f.n); Deno.exit(1); }
