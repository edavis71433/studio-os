// ── Deposit paid moves the deal — and the move shows up (post-#50 defect) ────
//   deno run --allow-read --allow-env --allow-net tests/presence/deposit_moves_deal_test.mjs
//
// The paid echo (routes/commerce.ts handleInvoicePaidEcho) moves a signed deal
// to Won when its deposit lands and writes a stage_change event. #50 wrote
// to_stage INSIDE detail, leaving the to_stage COLUMN '' — so pipeline.html's
// evtLabel and crm/deal_activity.ts describeSystemEvent (both read row.to_stage)
// never rendered "Moved to Won"; the history said only "Moved stage". This
// drives the echo through a fetch fake and pins the row's shape + its label.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const AGENCY = '11111111-1111-4111-8111-111111111111';
const OWNER_CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INVOICE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SECRET = 'test-commerce-secret';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('PLATFORM_REPLY_TO', 'eric@davisdigitalstudio.com');
Deno.env.set('OPS_ALERT_EMAIL', 'ops@davisdigitalstudio.com');
Deno.env.set('AGENCY_SITE_ID', AGENCY);
Deno.env.set('BILLING_SYNC_SECRET', SECRET);
Deno.env.set('SITE_URL', 'https://davisdigitalstudio.com');

const { handleCommerce } = await import('../../supabase/functions/presence/routes/commerce.ts');
const { describeSystemEvent } = await import('../../supabase/functions/presence/crm/deal_activity.ts');

const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** cfg.signed false → no signed agreement on the deal; cfg.stage → the deal's current stage */
function installFetch(cfg = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com/emails')) return jr({ id: 're_1' }, 200);
    if (url.includes('suppressed_emails')) return jr([]);
    if (url.includes('/rpc/rate_hit')) return jr(true);
    if (url.includes('presence_plan_notices') && method === 'POST') return jr([{ id: 'notice_1' }], 201);
    if (url.includes('presence_invoices')) return jr([{ id: INVOICE, site_id: AGENCY, deal_id: DEAL, title: 'Deposit', amount_cents: 50000, purpose: 'deposit' }]);
    if (url.includes('presence_sites')) return jr([{ id: AGENCY, client_id: OWNER_CLIENT }]);
    if (url.includes('presence_identity')) return jr([{ business_name: 'Davis Digital Studio', email: 'studio@davisdigitalstudio.com' }]);
    if (url.includes('presence_brand_kits') || url.includes('brand_kit')) return jr([]);
    if (url.includes(`clients?id=eq.${OWNER_CLIENT}`)) return jr([{ id: OWNER_CLIENT, name: 'Davis Digital Studio', email: 'eric@davisdigitalstudio.com', contact_email: '' }]);
    if (url.includes('presence_deal_events')) return jr(null, 201);
    if (url.includes('presence_deals') && method === 'PATCH') return jr([{ id: DEAL }]);
    if (url.includes('presence_deals')) return jr([{ id: DEAL, title: 'Bacchus website', stage: cfg.stage || 'contract', contact_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created_project_id: PROJECT }]);
    if (url.includes('presence_contracts')) return jr(cfg.signed === false ? [] : [{ id: 'k-1' }]);
    if (url.includes('presence_contacts')) return jr([{ name: 'Claud Beltran' }]);
    if (url.includes('presence_tasks') && method === 'PATCH') return jr([{ id: 'task_1', title: 'Deposit paid', client_visible: false }]);
    if (url.includes('presence_tasks')) return jr([{ id: 'task_x' }]);
    if (url.includes('presence_project_events')) return jr(null, 201);
    if (url.includes('presence_push_subscriptions')) return jr([]);
    return jr([]);
  };
  return { calls };
}
const restore = () => { globalThis.fetch = realFetch; };
const realWarn = console.warn; console.warn = () => {};

const echoReq = () => new Request('https://x/commerce/invoice-paid', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-commerce-secret': SECRET },
  body: JSON.stringify({ invoice_id: INVOICE }),
});
const PRINCIPAL = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
const echo = (req) => handleCommerce(req, '/commerce/invoice-paid', 'POST', PRINCIPAL, {});

try {
  // ═══ A · signed deal at Agreement out, deposit lands → Won, and the event SAYS so ═══
  {
    const { calls } = installFetch({ signed: true, stage: 'contract' });
    const r = await echo(echoReq());
    const out = await r.json();
    ok('A1: the echo answers 200 and reports the move', r.status === 200 && out.data?.moved === true, JSON.stringify(out));
    const patch = calls.find((c) => c.url.includes('presence_deals') && c.method === 'PATCH');
    ok('A2: the stage PATCH is guarded to still-open stages and writes won', /stage=in\.\(lead,qualified,proposal,contract\)/.test(String(patch?.url || '')) && patch?.body?.stage === 'won');
    const ev = calls.find((c) => c.url.includes('presence_deal_events') && c.method === 'POST');
    ok('A3: exactly one stage_change event is written', !!ev && calls.filter((c) => c.url.includes('presence_deal_events') && c.method === 'POST').length === 1 && ev.body?.kind === 'stage_change');
    ok('A4: to_stage is the COLUMN, not a key inside detail', ev?.body?.to_stage === 'won' && (ev?.body?.detail == null || ev.body.detail.to_stage === undefined), JSON.stringify(ev?.body));
    ok('A5: the event names its deal, site, and the system actor (stripe)', ev?.body?.deal_id === DEAL && ev?.body?.site_id === AGENCY && ev?.body?.actor === 'stripe' && ev?.body?.actor_kind === 'system');
    ok('A6: the reason rides in detail (because: deposit_paid)', ev?.body?.detail?.because === 'deposit_paid');
    // the row as the server would read it back — the SAME label the pipeline's History strip draws
    const stored = { kind: ev?.body?.kind, to_stage: ev?.body?.to_stage ?? '', detail: ev?.body?.detail ?? {} };
    ok('A7: the server timeline reads that row as "Moved to Won" (not a bare "Moved stage")', describeSystemEvent(stored) === 'Moved to Won', describeSystemEvent(stored));
    restore();
  }
  // ═══ B · no signature yet → the stage stays, no stage_change event at all ═══
  {
    const { calls } = installFetch({ signed: false, stage: 'contract' });
    const r = await echo(echoReq());
    const out = await r.json();
    ok('B1: unsigned → moved:false, no PATCH, no event', r.status === 200 && out.data?.moved === false
      && !calls.some((c) => c.url.includes('presence_deals') && c.method === 'PATCH')
      && !calls.some((c) => c.url.includes('presence_deal_events') && c.method === 'POST'));
    restore();
  }
  // ═══ C · pipeline.html's own label reads the column too (the page has no bundler) ═══
  {
    const page = Deno.readTextFileSync(new URL('../../pipeline.html', import.meta.url));
    ok('C1: pipeline.html evtLabel renders stage_change from e.to_stage (the column)', /if\(e\.kind==='stage_change'&&e\.to_stage\)return 'Moved to '\+stageLabel\(e\.to_stage\);/.test(page));
    const commerce = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/commerce.ts', import.meta.url));
    ok('C2: commerce.ts writes to_stage at the top level of the event row', /kind: 'stage_change', actor: 'stripe', actor_kind: 'system', to_stage: to, detail: \{ because: 'deposit_paid' \}/.test(commerce));
  }
} finally { restore(); console.warn = realWarn; }

const passed = results.filter(Boolean).length;
console.log(`\n════ DEPOSIT PAID MOVES THE DEAL (to_stage column): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
