// ── Branded Documents of Record — the print-ready proposal/invoice/contract ──
//   deno run --allow-read --allow-env --allow-net tests/presence/documents_test.mjs
// Pure renderer + doc-token verification: no DB, no network. Asserts hostile input
// is escaped, the signed-contract record carries content_hash + signing evidence,
// line-item totals are computed (never trusted blindly), and doc tokens refuse a
// tampered / expired / wrong-secret / non-doc token.
import {
  renderProposalDocument, renderInvoiceDocument, renderContractDocument, renderDocument,
  signDocToken, verifyDocToken, money, utcStamp,
} from '../../supabase/functions/presence/lib/documents.ts';
import { subtotalOf } from '../../supabase/functions/presence/lib/sales_lifecycle.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const brand = { name: 'Marlow’s Studio', accent: '#8c3b2e', accentDark: '#5f2820' };
const XSS = '<script>alert(1)</script>';

// ── shell + branding ─────────────────────────────────────────────────────────
{
  const html = renderProposalDocument({ title: 'Website', line_items: [], currency: 'usd', status: 'sent' }, brand);
  ok('renders a full self-contained HTML document', /^<!doctype html>/i.test(html) && html.includes('</html>'));
  ok('carries the studio brand name + accent (from the Brand Kit)', html.includes('Marlow’s Studio') && html.includes('#8c3b2e'));
  ok('has a print affordance + print CSS (Save-as-PDF)', html.includes('window.print()') && html.includes('@media print'));
  ok('no external assets (self-contained)', !/https?:\/\//.test(html));
  ok('default brand when none passed → Studio OS', renderProposalDocument({ title: 'x', line_items: [] }).includes('Studio OS'));
}

// ── escaping (every operator/signer-controlled field) ────────────────────────
{
  const prop = renderProposalDocument({ title: XSS, terms: XSS, line_items: [{ label: XSS, qty: 1, unit_cents: 100 }], currency: 'usd', status: 'draft' }, brand);
  ok('proposal escapes title / terms / line labels', !prop.includes('<script>alert(1)</script>') && prop.includes('&lt;script&gt;'));
  const inv = renderInvoiceDocument({ title: XSS, description: XSS, amount_cents: 5000, currency: 'usd', purpose: 'service', status: 'open' }, brand);
  ok('invoice escapes title / description', !inv.includes('<script>alert(1)</script>') && inv.includes('&lt;script&gt;'));
  const con = renderContractDocument({ title: XSS, body: XSS, status: 'signed', signer_name: XSS, content_hash: 'abc', signed_at: '2026-07-11T14:03:22Z', signed_evidence: { ip_hash: 'ffee' } }, brand);
  ok('contract escapes body / signer name', !con.includes('<script>alert(1)</script>') && con.includes('&lt;script&gt;'));
  ok('a hostile brand name is escaped', renderProposalDocument({ title: 'x', line_items: [] }, { name: XSS, accent: '#000', accentDark: '#000' }).includes('&lt;script&gt;'));
}

// ── signed-contract Document of Record: content_hash + evidence rendered ──────
{
  const HASH = '9f2b7c1a'.repeat(8);   // 64-hex-like fingerprint
  const con = renderContractDocument({
    title: 'Service agreement', body: 'The whole agreement text.', status: 'signed',
    signer_name: 'Dana Lee', signer_email: 'dana@biz.com', signed_at: '2026-07-11T14:03:22.511Z',
    content_hash: HASH, signed_evidence: { hash: HASH, at: '2026-07-11T14:03:22.511Z', ip_hash: 'a1b2c3d4' },
  }, brand);
  ok('signed contract renders a certificate of record', con.includes('Certificate of record') && con.includes('Signed agreement'));
  ok('certificate shows the typed signer + UTC timestamp', con.includes('Dana Lee') && con.includes('2026-07-11 14:03:22 UTC'));
  ok('certificate shows the content_hash fingerprint', con.includes(HASH));
  ok('certificate shows the stored signing evidence (hashed IP)', con.includes('a1b2c3d4'));
  ok('renders the exact executed body', con.includes('The whole agreement text.'));
  // an UNSIGNED contract must NOT read as an executed record
  const draft = renderContractDocument({ title: 'x', body: 'draft body', status: 'sent', content_hash: HASH }, brand);
  ok('unsigned contract shows no certificate + a not-executed note', !draft.includes('Certificate of record') && draft.includes('not an executed agreement'));
}

// ── line-item totals: computed from items, never trusted blindly ─────────────
{
  const items = [{ label: 'Design', qty: 2, unit_cents: 5000 }, { label: 'Build', qty: 1, unit_cents: 15000 }];
  const expected = subtotalOf(items);   // 2*5000 + 15000 = 25000
  ok('subtotalOf math baseline', expected === 25000);
  // a LYING stored subtotal_cents must be ignored — the document recomputes
  const prop = renderProposalDocument({ title: 'P', line_items: items, subtotal_cents: 999999, currency: 'usd', status: 'sent' }, brand);
  ok('total is recomputed from line items (ignores a wrong stored subtotal)', prop.includes(`<td>${money(expected)}</td>`) && !prop.includes('$9,999.99'));
  ok('per-line extended price uses unit × qty', prop.includes(money(5000 * 2)) && prop.includes(money(15000)));
}

// ── money + utc helpers ──────────────────────────────────────────────────────
ok('money formats cents to 2dp with symbol', money(25000) === '$250.00' && money(0) === '$0.00' && money(199, 'eur') === '€1.99');
ok('utcStamp renders an unambiguous UTC stamp', utcStamp('2026-07-11T14:03:22.511Z') === '2026-07-11 14:03:22 UTC' && utcStamp('') === '');

// ── invoice / deposit / receipt variants ─────────────────────────────────────
{
  const dep = renderInvoiceDocument({ title: 'Deposit', amount_cents: 50000, currency: 'usd', purpose: 'deposit', status: 'open', stripe_url: 'https://pay.example/x' }, brand);
  ok('open deposit → Deposit request label + pay link', dep.includes('Deposit request') && dep.includes('https://pay.example/x'));
  const paid = renderInvoiceDocument({ title: 'Invoice', amount_cents: 50000, currency: 'usd', purpose: 'service', status: 'paid', paid_at: '2026-07-11T10:00:00Z', stripe_url: 'https://pay.example/x' }, brand);
  ok('paid invoice → Receipt label, Paid pill, no live pay link', paid.includes('Receipt') && paid.includes('pill paid') && !paid.includes('https://pay.example/x'));
  ok('dispatch renderDocument matches the direct renderers', renderDocument('invoice', { title: 'Invoice', amount_cents: 50000, currency: 'usd', purpose: 'service', status: 'paid', paid_at: '2026-07-11T10:00:00Z' }, brand) === paid);
}

// ── doc tokens: sign + verify, and refuse tampered / expired / wrong-secret ──
{
  const SECRET = 'test-secret-key-0123456789';
  const now = 1_800_000_000;
  const id = '11111111-2222-3333-4444-555555555555';
  const site = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const tok = await signDocToken({ t: 'doc', k: 'contract', id, site_id: site, exp: now + 3600 }, SECRET);
  const good = await verifyDocToken(tok, SECRET, now);
  ok('a valid unexpired doc token verifies', !!good && good.k === 'contract' && good.id === id && good.site_id === site);
  ok('an EXPIRED token is refused', (await verifyDocToken(tok, SECRET, now + 7200)) === null);
  ok('a WRONG-secret token is refused', (await verifyDocToken(tok, 'other-secret', now)) === null);
  ok('a TAMPERED signature is refused', (await verifyDocToken(tok.slice(0, -2) + (tok.endsWith('aa') ? 'bb' : 'aa'), SECRET, now)) === null);
  ok('a TAMPERED payload is refused', (await verifyDocToken('ZXZpbA.' + tok.split('.')[1], SECRET, now)) === null);
  ok('a malformed token is refused', (await verifyDocToken('not-a-token', SECRET, now)) === null && (await verifyDocToken('', SECRET, now)) === null);
  // a doc token is its OWN type — an accept/sign token (t:'proposal') is not a doc token
  const signish = await signDocToken({ t: 'proposal', k: 'proposal', id, site_id: site, exp: now + 3600 }, SECRET);
  ok('a non-doc (t≠doc) token is refused as a doc token', (await verifyDocToken(signish, SECRET, now)) === null);
  ok('a token with a bad kind is refused', (await verifyDocToken(await signDocToken({ t: 'doc', k: 'nope', id, site_id: site, exp: now + 3600 }, SECRET), SECRET, now)) === null);
  ok('a token with a non-uuid id is refused', (await verifyDocToken(await signDocToken({ t: 'doc', k: 'invoice', id: 'x', site_id: site, exp: now + 3600 }, SECRET), SECRET, now)) === null);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DOCUMENTS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
