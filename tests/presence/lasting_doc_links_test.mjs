// ── Sales item 79: links to signed agreements and receipts keep working ──
//   deno run --allow-read --allow-env --allow-net tests/presence/lasting_doc_links_test.mjs
// The emailed copy link lasted 90 days, yet the document said "reprint any time from
// your original link". A link to a SIGNED agreement or a PAID invoice (a receipt) now
// opens whatever its date, links already sent included (their date is inside the signed
// token, so the page decides once it knows the document). Anything that can still change
// (a proposal, an estimate, an unpaid invoice) still ends, and says who to ask, by name.
// The document's own last line only promises what is true.
const SECRET = 'test-link-secret';
Deno.env.set('SUPABASE_URL', 'https://db.example');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('APPROVAL_SECRET', SECRET);

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { signDocToken, readDocToken, verifyDocToken, lastingRecord, footerWords, renderDocument } = await import('../../supabase/functions/presence/lib/documents.ts');
const { handleSalesDocument } = await import('../../supabase/functions/presence/routes/sales.ts');

const SITE = '11111111-1111-4111-8111-111111111111';
const CON = '22222222-2222-4222-8222-222222222222';
const INV = '33333333-3333-4333-8333-333333333333';
const PROP = '44444444-4444-4444-8444-444444444444';
const now = Math.floor(Date.now() / 1000);
const old = now - 200 * 86400;   // a link sent seven months ago: its 90 days ran out long since

// ═══════════════════════ pure ═══════════════════════
{
  const tok = await signDocToken({ t: 'doc', k: 'contract', id: CON, site_id: SITE, exp: old, e: 1 }, SECRET);
  ok('reading a token checks its signature but not its date', (await readDocToken(tok, SECRET))?.id === CON);
  ok('verifying it still refuses the date (other callers keep the old rule)', (await verifyDocToken(tok, SECRET, now)) === null);
  ok('a token signed with another secret is never read', (await readDocToken(tok, 'other')) === null);
  ok('a tampered token is never read', (await readDocToken('ZXZpbA.' + tok.split('.')[1], SECRET)) === null && (await readDocToken('', SECRET)) === null);
  ok('lasting: a signed agreement and a paid invoice', lastingRecord('contract', { status: 'signed' }) && lastingRecord('invoice', { status: 'paid' }));
  ok('not lasting: an agreement out for signature, an open or void invoice, any proposal or estimate, nothing at all',
    !lastingRecord('contract', { status: 'sent' }) && !lastingRecord('invoice', { status: 'open' }) && !lastingRecord('invoice', { status: 'void' })
    && !lastingRecord('proposal', { status: 'accepted' }) && !lastingRecord('estimate', { status: 'approved' }) && !lastingRecord('contract', null));
  ok('the last line of a finished record says its link keeps working', footerWords('Fixture Studio', true, true) === 'Prepared by Fixture Studio. Keep this for your records: this link keeps working, and Download PDF saves a copy.');
  ok('…without promising a PDF button it doesn’t have', footerWords('Fixture Studio', true, false) === 'Prepared by Fixture Studio. Keep this for your records: this link keeps working.');
  ok('anything that can still change promises nothing about its link', footerWords('Fixture Studio', false, true) === 'Prepared by Fixture Studio.');
  ok('the name is escaped', footerWords('<b>x</b>', false, false) === 'Prepared by &lt;b&gt;x&lt;/b&gt;.');
  const brand = { name: 'Fixture Studio', accent: '#5b3fa0', accentDark: '#3a2470' };
  const signed = renderDocument('contract', { id: CON, title: 'Service agreement', body: 'Terms.', status: 'signed', signer_name: 'Casey Client', signed_at: '2026-04-01T10:00:00Z', content_hash: 'abc', signed_evidence: {} }, brand, null);
  const receipt = renderDocument('invoice', { id: INV, title: 'Deposit', amount_cents: 50000, currency: 'usd', purpose: 'deposit', status: 'paid', paid_at: '2026-04-02T10:00:00Z', created_at: '2026-04-01T10:00:00Z' }, brand, null);
  const proposal = renderDocument('proposal', { id: PROP, title: 'Website', line_items: [], subtotal_cents: 0, currency: 'usd', status: 'sent' }, brand, null);
  ok('a signed agreement’s page and a receipt’s page say the link keeps working', /this link keeps working/.test(signed) && /this link keeps working/.test(receipt));
  ok('a proposal’s page no longer promises a reprint from its link', !/keeps working|reprint/.test(proposal) && /<footer>Prepared by Fixture Studio\.<\/footer>/.test(proposal));
  ok('no page says "reprint any time" any more', ![signed, receipt, proposal].some((h) => /reprint any time/.test(h)));
}

// ═══════════════════════ the page ═══════════════════════
const rowsBy = {
  [CON]: { id: CON, deal_id: null, title: 'Service agreement', body: 'Terms.', content_hash: 'abc', status: 'signed', signer_name: 'Casey Client', signer_email: 'casey@client.example', signed_at: '2026-04-01T10:00:00Z', signed_evidence: {}, sent_at: '2026-03-30T10:00:00Z', created_at: '2026-03-30T10:00:00Z' },
  [INV]: { id: INV, deal_id: null, title: 'Deposit', description: '', amount_cents: 50000, currency: 'usd', purpose: 'deposit', status: 'paid', stripe_url: null, due_date: null, paid_at: '2026-04-02T10:00:00Z', created_at: '2026-04-01T10:00:00Z', number: 7, paid_method: 'card', paid_note: '', payment_for: null, lines: null },
  [PROP]: { id: PROP, deal_id: null, title: 'Website', line_items: [], subtotal_cents: 0, currency: 'usd', terms: '', status: 'sent', sent_at: '2026-03-30T10:00:00Z', decided_at: null },
};
let inviteStatus = 'paid';
globalThis.fetch = (input, init = {}) => {
  const u = decodeURIComponent(String(typeof input === 'string' ? input : input.url));
  const reply = (b, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }));
  if (u.includes('/rpc/rate_hit')) return reply(true);
  if (u.includes('/presence_identity?')) return reply([{ business_name: 'Fixture Studio', email: 'hello@fixture.example', phone: '' }]);
  for (const id of Object.keys(rowsBy)) if (u.includes(`?id=eq.${id}`)) return reply(id === INV ? [{ ...rowsBy[id], status: inviteStatus }] : [rowsBy[id]]);
  return reply([]);
};
const open = async (k, id, exp) => {
  const tok = await signDocToken({ t: 'doc', k, id, site_id: SITE, exp, e: 1 }, SECRET);
  const r = await handleSalesDocument(new Request(`https://db.example/functions/v1/presence/sales/doc/${tok}`), tok, {});
  return { status: r.status, html: await r.text(), type: r.headers.get('content-type') || '' };
};
{
  const a = await open('contract', CON, old);
  ok('a seven-month-old link to a signed agreement opens it', a.status === 200 && /Service agreement/.test(a.html) && /this link keeps working/.test(a.html), `${a.status} ${a.html.slice(0, 160)}`);
  const r = await open('invoice', INV, old);
  ok('a seven-month-old link to a receipt opens it', r.status === 200 && /Receipt/.test(r.html), `${r.status}`);
  const pdfTok = await signDocToken({ t: 'doc', k: 'contract', id: CON, site_id: SITE, exp: old, e: 1 }, SECRET);
  const pdf = await handleSalesDocument(new Request(`https://db.example/functions/v1/presence/sales/doc/${pdfTok}?format=pdf`), pdfTok, {});
  ok('…and so does its PDF', pdf.status === 200 && /application\/pdf/.test(pdf.headers.get('content-type') || ''));
  const p = await open('proposal', PROP, old);
  ok('an old link to a proposal has still expired, and says who to ask, by name', p.status === 403 && /It has expired\. Ask Fixture Studio for a fresh copy\. Nothing is lost\./.test(p.html));
  inviteStatus = 'open';
  const u = await open('invoice', INV, old);
  ok('an old link to an invoice not yet paid has expired too (its pay button must not outlive it)', u.status === 403);
  inviteStatus = 'paid';
  const fresh = await open('proposal', PROP, now + 3600);
  ok('a link still in date opens as before', fresh.status === 200 && /Website/.test(fresh.html));
  const forged = await handleSalesDocument(new Request('https://db.example/functions/v1/presence/sales/doc/x.y'), 'x.y', {});
  ok('a broken link still says so', forged.status === 403 && /isn’t complete/.test(await forged.text()));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ LASTING DOCUMENT LINKS (sales item 79): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
