// ── The papers shelf in the client portal (builder list item 179, part four) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_shelf_test.mjs
// The server half: every invoice on the shelf opens as the studio's branded copy,
// a receipt once it's paid; a withdrawn invoice opens nothing.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const AGENCY = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('APPROVAL_SECRET', 'test-secret');
const CD = await import('../../supabase/functions/presence/routes/client_delivery.ts');
const { readDocToken } = await import('../../supabase/functions/presence/lib/documents.ts');

const SITE = { id: 'f0f0f0f0-0000-4000-8000-000000000000', client_id: CUSTOMER };
const realFetch = globalThis.fetch;
const jr = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const inv = (id, status, over = {}) => ({ id, title: 'Invoice ' + id, description: '', amount_cents: 45000, status, due_date: '2099-01-01', paid_at: status === 'paid' ? '2026-10-02T00:00:00Z' : null, stripe_url: 'https://pay.example/x', created_at: '2026-10-01T00:00:00Z', site_id: AGENCY, ...over });
const ids = { paid: '0a000000-0000-4000-8000-000000000001', open: '0a000000-0000-4000-8000-000000000002', voided: '0a000000-0000-4000-8000-000000000003', nosite: '0a000000-0000-4000-8000-000000000004' };
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('presence_invoices')) return jr([inv(ids.paid, 'paid'), inv(ids.open, 'open'), inv(ids.voided, 'void'), inv(ids.nosite, 'open', { site_id: null })]);
  return jr([]);
};
const res = await CD.handleClientBilling(new Request('https://x/client/billing'), SITE, { kind: 'client' }, {});
const list = (await res.json()).data.invoices;
const by = (id) => list.find((i) => i.id === id);
const tokenOf = (u) => decodeURIComponent(new URL(u).searchParams.get('t') || '');
{
  const paid = by(ids.paid), open = by(ids.open);
  ok('shelf: a paid invoice opens as its receipt, an unpaid one as the invoice (doc.html)', /\/doc\.html\?t=/.test(paid.view_url || '') && /\/doc\.html\?t=/.test(open.view_url || ''));
  const tp = await readDocToken(tokenOf(paid.view_url), 'test-secret');
  ok('shelf: the link names exactly that invoice on the studio’s site', !!tp && tp.k === 'invoice' && tp.id === ids.paid && tp.site_id === AGENCY);
  ok('shelf: a withdrawn invoice opens nothing; one with no studio site opens nothing', by(ids.voided).view_url === null && by(ids.nosite).view_url === null);
  ok('shelf: paying still works as before (Pay only while waiting)', open.pay_url === 'https://pay.example/x' && paid.pay_url === null && by(ids.voided).pay_url === null);
  ok('shelf: the studio’s site id itself never travels', list.every((i) => !('site_id' in i)));
}
globalThis.fetch = realFetch;
const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
