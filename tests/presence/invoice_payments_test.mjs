// ── Sales items 77, 81 and 82: a payment recorded by hand, a proper invoice, real PDFs ──
//   deno run --allow-read --allow-env --allow-net tests/presence/invoice_payments_test.mjs
//
// 77  Record a payment made by check, cash, bank transfer or Zelle: amount, date, how, a note.
//     All of it marks the invoice paid (reminders stop, the card link is switched off, it
//     counts in Paid and the money reports); part of it gets its own paid row and the invoice
//     drops by the same amount; Undo takes back one recorded by mistake.
// 81  A proper invoice: the studio's running number, both addresses, its lines, the due date;
//     the email greets the person and names the due date.
// 82  A real PDF of an invoice, receipt, proposal, estimate and agreement, instead of the print box.
//
// Builder item 212: this suite proves what the code DOES. Sections 1 to 3 run the pure rules.
// From section 4 on, the real handlers and the real index.ts run against the shared in-memory
// PostgREST (fake_pgrst.mjs), a fake Stripe and a fake mail service, with TWO studios seeded:
// Northwind (site A) and Southpaw (site B). Every money path checks that one studio's call
// never reads, changes, emails or bills the other studio's rows. Only the database step (0167)
// is checked as text, because there is no database here; each of those lines says why.
// Every name and number below is made up.
Deno.env.set('STRIPE_SECRET', 'sk_test_fake');
Deno.env.set('APPROVAL_SECRET', 'doc-link-secret-for-tests-0123456789');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example');
Deno.env.set('BILLING_SYNC_SECRET', 'echo-secret-for-tests');
for (const k of ['RESEND_INBOUND_DOMAIN', 'OPS_ALERT_EMAIL', 'OPERATOR_SECRET', 'SCHEDULER_SECRET', 'STATE_SIGNING_SECRET']) Deno.env.delete(k);
import { installFakePostgrest } from './fake_pgrst.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ── two studios, their owners, a staff seat and a client reviewer on Northwind ──
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const A = uuid('a'), B = uuid('b');                    // Northwind's site, Southpaw's site
const CLIENT_A = uuid('c'), CLIENT_B = uuid('d');      // their accounts
const DEAL_A = uuid('3'), DEAL_B = uuid('6');
const CT_A = uuid('7'), CT_B = uuid('8');
const INV_A = uuid('4'), DEP_A = uuid('5'), INV_B = uuid('9');
const CON_A = uuid('e'), PROP_A = uuid('f'), EST_A = uuid('1');
const USERS = {
  'jwt-north': { id: '10000000-0000-4000-8000-00000000000a', email: 'owner@northwind.example' },
  'jwt-south': { id: '10000000-0000-4000-8000-00000000000b', email: 'owner@southpaw.example' },
  'jwt-staff': { id: '10000000-0000-4000-8000-00000000000c', email: 'staff@northwind.example' },
  'jwt-reviewer': { id: '10000000-0000-4000-8000-00000000000d', email: 'reviewer@juniper.example' },
};
const db = installFakePostgrest({ url: 'https://example.supabase.co', users: USERS, ownSite: { 'jwt-north': A, 'jwt-south': B } });

// ── the outside world: Stripe and the mail service are fakes that keep what they were sent ──
const pg = globalThis.fetch;
const out = { stripe: [], mail: [], escaped: [] };
let stripeOk = true, n = 0;
let beforeWrite = null;   // one shot: runs just before the next matching write reaches the database
let olderDb = null;       // a database a migration behind: answers a request the way it would, or null
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    out.stripe.push({ method, path: u.pathname, form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
    if (!stripeOk) return jres(400, { error: { message: 'Stripe said no' } });
    if (u.pathname === '/v1/prices') return jres(200, { id: `price_${++n}` });
    if (u.pathname === '/v1/payment_links') { n++; return jres(200, { id: `plink_new_${n}`, url: `https://pay.example/new-${n}` }); }
    return jres(200, { id: u.pathname.split('/').pop(), active: false });
  }
  if (u.hostname === 'api.resend.com') { out.mail.push(JSON.parse(String(init.body))); return jres(200, { id: `em_${out.mail.length}` }); }
  if (u.hostname !== 'example.supabase.co') { out.escaped.push(u.href); return jres(500, {}); }
  if (beforeWrite && method !== 'GET' && beforeWrite.match(u, method)) { const h = beforeWrite; beforeWrite = null; h.run(); }
  if (olderDb) { const r = olderDb(u, method, init); if (r) return r; }
  return pg(url, init);
};

const P = '../../supabase/functions/presence';
const { validatePayment, paidAtOf, linesFromProposal, PAY_METHODS } = await import(`${P}/lib/invoice_billing.ts`);
const { invoiceNo, dayLabel, payMethodWords, paidLine, partyLines, invoiceLines, renderInvoiceDocument, renderProposalDocument, renderDocument, signDocToken } = await import(`${P}/lib/documents.ts`);
const { invoicePdf, contractPdf, proposalPdf, estimatePdf, pdfFileName } = await import(`${P}/lib/doc_pdf.ts`);
const { winAnsi, textWidth, wrapText, PdfDoc } = await import(`${P}/lib/pdf.ts`);
const { addressOf, addressText } = await import(`${P}/lib/doc_context.ts`);
const S = await import(`${P}/routes/sales.ts`);
const { firstNameOf } = S;
const { handleInvoicePayment, handleInvoicePaymentUndo } = await import(`${P}/routes/invoice_payments.ts`);
const ES = await import(`${P}/routes/estimates.ts`);
const { base64Of } = await import(`${P}/commerce/account.ts`);
const { memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);

// ═══ 1. a payment, checked (77) ═══
{
  const open = { status: 'open', amount_cents: 200000, processing_since: null, payment_for: null };
  const v = (b, inv = open, today = '2026-11-11') => validatePayment(b, inv, today);
  const all = v({ method: 'check', paid_on: '2026-11-11', note: '  Check   #1042 ' });
  ok('blank amount: all of it, paid in full', all.ok && all.value.amount_cents === 200000 && !all.value.part && all.value.left_cents === 0);
  ok('the note is tidied, kept short', all.ok && all.value.note === 'Check #1042');
  const part = v({ amount_cents: 50000, method: 'zelle', paid_on: '2026-11-08' });
  ok('less than due: a part payment, the rest stays due', part.ok && part.value.part && part.value.left_cents === 150000);
  ok('more than due is refused, with what is due', !v({ amount_cents: 200001, method: 'cash' }).ok && v({ amount_cents: 200001, method: 'cash' }).error === 'more_than_due' && /\$2,000\.00/.test(v({ amount_cents: 200001, method: 'cash' }).message));
  ok('nothing, or nonsense, is refused', !v({ amount_cents: 0, method: 'cash' }).ok && !v({ amount_cents: 'x', method: 'cash' }).ok);
  ok('a day after today is refused (the caller’s day)', !v({ method: 'cash', paid_on: '2026-11-12' }).ok && v({ method: 'cash', paid_on: '2026-11-12' }, open, '2026-11-12').ok);
  ok('a bad day is refused', !v({ method: 'cash', paid_on: '11/08/2026' }).ok && !v({ method: 'cash', paid_on: '1999-12-31' }).ok);
  ok('the five ways, and only those', JSON.stringify([...PAY_METHODS]) === JSON.stringify(['check', 'cash', 'bank_transfer', 'zelle', 'other']) && !v({ method: 'venmo' }).ok && !v({}).ok);
  ok('a paid invoice can’t take a payment', v({ method: 'cash' }, { ...open, status: 'paid' }).error === 'already_paid');
  ok('a voided invoice can’t take a payment', v({ method: 'cash' }, { ...open, status: 'void' }).error === 'bad_state');
  ok('a payment already on its way through Stripe can’t be recorded twice', v({ method: 'cash' }, { ...open, processing_since: '2026-11-10T00:00:00Z' }).error === 'processing');
  ok('a part payment’s own row is not an invoice', v({ method: 'cash' }, { ...open, payment_for: 'x' }).error === 'bad_state');
  ok('the day is stored at its noon in UTC (the same day from Hawaii to New Zealand)', paidAtOf('2026-11-08') === '2026-11-08T12:00:00.000Z');
}

// ═══ 2. the proper invoice (81) ═══
{
  ok('invoiceNo: the running number, four places', invoiceNo(13) === '#0013' && invoiceNo(12345) === '#12345' && invoiceNo(null) === '' && invoiceNo(0) === '');
  ok('dayLabel: a plain date is that day', dayLabel('2026-11-18') === 'Nov 18, 2026');
  ok('dayLabel: a moment is its day in the studio’s zone', dayLabel('2026-11-12T05:00:00Z', 'America/Los_Angeles') === 'Nov 11, 2026' && dayLabel('2026-11-12T05:00:00Z', 'Europe/London') === 'Nov 12, 2026');
  ok('dayLabel: Pacific when the zone is unknown or wrong', dayLabel('2026-11-12T05:00:00Z') === 'Nov 11, 2026' && dayLabel('2026-11-12T05:00:00Z', 'Not/AZone') === 'Nov 11, 2026' && dayLabel('') === '');
  ok('payMethodWords: plain words, online for Stripe', payMethodWords('check') === 'by check' && payMethodWords('cash') === 'in cash' && payMethodWords('bank_transfer') === 'by bank transfer' && payMethodWords('zelle') === 'by Zelle' && payMethodWords('') === 'online' && payMethodWords('other') === '');
  ok('paidLine: when, how and the note', paidLine({ paid_at: '2026-11-11T12:00:00Z', paid_method: 'check', paid_note: 'Check #1042' }, 'America/Los_Angeles') === 'Paid Nov 11, 2026 by check · Check #1042');
  ok('partyLines: name, business, each address line, email', JSON.stringify(partyLines({ name: 'Ivy Chen', company: 'Juniper Floral Co.', address: '48 Elm Ave\nPasadena, CA 91101', email: 'ivy@juniper.example' })) === JSON.stringify(['Ivy Chen', 'Juniper Floral Co.', '48 Elm Ave', 'Pasadena, CA 91101', 'ivy@juniper.example']));
  ok('addressText: item 89’s address shape reads as lines; text as itself; nothing as nothing', addressText({ street: '48 Elm Ave', city: 'Pasadena', state: 'CA', zip: '91101', country: '' }) === '48 Elm Ave\nPasadena, CA 91101' && addressText(' 12 Oak St ') === '12 Oak St' && addressText({}) === '' && addressText(null) === '');
  ok('addressOf: a location row reads as an address', addressOf({ address_line1: '120 Main St', address_line2: '', city: 'Burbank', region: 'CA', postal_code: '91502' }) === '120 Main St\nBurbank, CA 91502' && addressOf(null) === '');
  ok('firstNameOf: the first name, or nothing for a business or an email', firstNameOf('Ivy Chen') === 'Ivy' && firstNameOf('José Ruiz') === 'José' && firstNameOf('ivy@x.example') === '' && firstNameOf('') === '' && firstNameOf('(Studio)') === '');
  const items = [{ label: 'Website refresh, five pages', qty: 1, unit_cents: 260000 }, { label: 'Logo cleanup', qty: 2, unit_cents: 30000 }, { label: 'Unused', qty: 0, unit_cents: 99900 }];
  const lines = linesFromProposal(items, { discount_cents: 32000, tax_cents: 24480 }, { discount: { mode: 'percent', value: 10 }, tax_pct: 8.5 }, [{ label: 'deposit #0012', amount_cents: 120000 }]);
  ok('lines from the proposal: its items, discount, tax, then what was billed comes off', JSON.stringify(lines.map((l) => l.label)) === JSON.stringify(['Website refresh, five pages', 'Logo cleanup', 'Discount (10%)', 'Tax (8.5%)', 'Less deposit #0012']));
  ok('lines from the proposal: an item with no quantity is left out; amounts add up', lines.reduce((n, l) => n + l.amount_cents, 0) === 260000 + 60000 - 32000 + 24480 - 120000 && lines[1].qty === 2);
  ok('invoiceLines: stored lines when they add up to what it bills', invoiceLines({ lines }, 192480).length === 5);
  ok('invoiceLines: otherwise one line, its description (never lines that disagree)', JSON.stringify(invoiceLines({ lines, description: 'Balance — Website refresh' }, 99)) === JSON.stringify([{ label: 'Balance — Website refresh', qty: 1, amount_cents: 99 }]));
  const ctx = {
    studio: { name: 'Northwind Studio', address: '120 Main St\nBurbank, CA 91502', email: 'hello@northwind.example', phone: '(555) 010-4400' },
    billTo: { name: 'Ivy Chen', company: 'Juniper Floral Co.', address: '48 Elm Ave\nPasadena, CA 91101', email: 'ivy@juniper.example' },
    tz: 'America/Los_Angeles', forWhat: 'Website refresh', pdfUrl: 'https://example.supabase.co/functions/v1/presence/sales/doc/abc.def?format=pdf', pdfName: 'Invoice-0013.pdf',
  };
  const inv = { number: 13, title: 'Balance at launch', description: 'Balance — Website refresh', amount_cents: 192480, currency: 'usd', purpose: 'service', status: 'open', stripe_url: 'https://pay.example/x', due_date: '2026-11-18', created_at: '2026-11-04T18:00:00Z', lines };
  const html = renderInvoiceDocument(inv, { name: 'Northwind Studio', accent: '#6d3fd4', accentDark: '#3d2185' }, ctx);
  ok('invoice: its number, as a heading and in the title', html.includes('<div class="doclabel">Invoice #0013</div>') && html.includes('<title>Balance at launch #0013 — Northwind Studio</title>'));
  ok('invoice: both addresses — from the studio, billed to the client', html.includes('<div class="k">From</div><div class="first">Northwind Studio</div><div>120 Main St</div><div>Burbank, CA 91502</div>') && html.includes('<div class="k">Billed to</div>') && html.includes('<div>48 Elm Ave</div><div>Pasadena, CA 91101</div>'));
  ok('invoice: issued and due as plain dates', html.includes('Issued Nov 4, 2026') && html.includes('Due Nov 18, 2026') && !/UTC/.test(html));
  ok('invoice: its lines, with what was billed before coming off', html.includes('Website refresh, five pages') && html.includes('<tr class="less"><td>Less deposit #0012</td><td class="qty"></td><td>−$1,200.00</td></tr>') && html.includes('<td class="qty">2</td>'));
  ok('invoice: no due date says due on receipt', renderInvoiceDocument({ ...inv, due_date: null }, null, ctx).includes('Due on receipt'));
  ok('invoice: Download PDF and Print, the PDF fetched by its own name', html.includes('id="dlpdf">Download PDF</button>') && html.includes('onclick="window.print()">Print</button>') && html.includes(JSON.stringify(ctx.pdfUrl)) && html.includes('"Invoice-0013.pdf"'));
  ok('invoice: the pay button stays off paper', /<aside class="aside no-print">[\s\S]*<a class="paylink" href="https:\/\/pay\.example\/x">Pay \$1,924\.80 securely →<\/a>[\s\S]*<\/aside>/.test(html) && /<div class="paybar no-print">[\s\S]*class="paylink"/.test(html)
    && !/class="paylink"/.test(html.slice(html.indexOf('<div class="paper">'), html.indexOf('<aside'))));   // Sales item 125: the side card and the phone's bar carry it, the paper never does
  const parted = renderInvoiceDocument({ ...inv, amount_cents: 142480 }, null, { ...ctx, payments: [{ amount_cents: 50000, paid_at: '2026-11-08T12:00:00Z', paid_method: 'zelle', paid_note: '' }] });
  ok('a part payment shows under the total, and the amount due is what is left', /Total<\/td><td class="qty"><\/td><td style="color:var\(--soft\)">\$1,924\.80[\s\S]*Paid Nov 8, 2026 by Zelle<\/td><td class="qty"><\/td><td>−\$500\.00[\s\S]*Amount due<\/td><td class="qty"><\/td><td>\$1,424\.80/.test(parted));
  const paid = renderInvoiceDocument({ ...inv, status: 'paid', paid_at: '2026-11-11T12:00:00Z', paid_method: 'check', paid_note: 'Check #1042' }, null, ctx);
  ok('a receipt: Receipt, how and when it was paid, total paid', paid.includes('<div class="doclabel">Receipt #0013</div>') && paid.includes('Paid Nov 11, 2026 by check · Check #1042') && paid.includes('Total paid') && !paid.includes('class="paylink"'));
  ok('without a context the old document still renders (and still prints)', renderInvoiceDocument({ title: 'Invoice', amount_cents: 50000, status: 'open' }).includes('Save as PDF / Print') && renderDocument('invoice', { title: 'x', amount_cents: 1, status: 'open' }) === renderInvoiceDocument({ title: 'x', amount_cents: 1, status: 'open' }));
  ok('a proposal page gets the Download PDF too', renderProposalDocument({ title: 'x', line_items: [] }, null, { pdfUrl: 'https://example.supabase.co/x?format=pdf' }).includes('Download PDF'));
  const evil = '<script>alert(1)</script>';
  const hostile = renderInvoiceDocument({ ...inv, title: evil, lines: [{ label: evil, qty: 1, amount_cents: 192480 }] }, null, { ...ctx, billTo: { name: evil, address: evil }, pdfName: '</script><script>alert(2)</script>' });
  ok('hostile words are escaped everywhere, the file name inside the script too', !hostile.includes('<script>alert(1)</script>') && !hostile.includes('</script><script>alert(2)') && hostile.includes('&lt;script&gt;'));
}

// ═══ 3. the PDF (82) ═══
const dec = (u8) => new TextDecoder().decode(u8);
{
  ok('WinAnsi: accents and curly quotes print; what the fonts lack is "?"', JSON.stringify(winAnsi('café “x”')) === JSON.stringify([99, 97, 102, 233, 32, 0x93, 120, 0x94]) && JSON.stringify(winAnsi('a😀b')) === JSON.stringify([97, 63, 98]) && JSON.stringify(winAnsi('−5')) === JSON.stringify([45, 53]));
  ok('widths: Helvetica’s own (a 10pt "M" is 8.33pt; bold is wider)', Math.abs(textWidth('M', 'R', 10) - 8.33) < 0.01 && textWidth('Hello', 'B', 10) > textWidth('Hello', 'R', 10));
  const wrapped = wrapText('The studio will deliver the work described in the proposal, on time.\n\nSecond paragraph.', 'R', 10, 120);
  ok('wrap: no line wider than asked; paragraphs and blank lines kept', wrapped.every((l) => textWidth(l, 'R', 10) <= 120) && wrapped.includes('') && wrapped[wrapped.length - 1] === 'Second paragraph.');
  ok('wrap: a word longer than the line is broken, not lost', wrapText('a'.repeat(200), 'R', 10, 100).join('') === 'a'.repeat(200));
  // the file is well-formed: every xref offset points at its object
  const xrefOk = (u8) => {
    const s = dec(u8);
    const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)?.[1]);
    const table = s.slice(start).split('\n');
    const count = Number(table[1].split(' ')[1]);
    for (let i = 1; i < count; i++) { const off = Number(table[2 + i].slice(0, 10)); if (!s.startsWith(`${i} 0 obj\n`, off)) return false; }
    return s.startsWith('%PDF-1.4\n') && /\/Root 1 0 R/.test(s) && count > 5;
  };
  const brand = { name: 'Northwind Studio', accent: '#6d3fd4', accentDark: '#3d2185' };
  const ctx = { studio: { address: '120 Main St\nBurbank, CA 91502', email: 'hello@northwind.example' }, billTo: { name: 'Ivy Chen', company: 'Juniper Floral Co.', address: '48 Elm Ave' }, tz: 'America/Los_Angeles', forWhat: 'Website refresh' };
  const inv = invoicePdf({ number: 13, title: 'Balance at launch', amount_cents: 200000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/x', due_date: '2026-11-18', created_at: '2026-11-04T18:00:00Z' }, brand, ctx);
  const s = dec(inv);
  ok('invoice PDF: a well-formed file (header, objects, xref, trailer)', xrefOk(inv));
  ok('invoice PDF: the two standard fonts, nothing embedded', /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/.test(s) && /\/BaseFont \/Helvetica-Bold/.test(s) && !/FontFile/.test(s));
  ok('invoice PDF: number, both parties, due date, amount', s.includes('(INVOICE FOR JUNIPER FLORAL CO.  #0013)') && s.includes('(Ivy Chen)') && s.includes('(48 Elm Ave)') && s.includes('(120 Main St)') && s.includes('(Due Nov 18, 2026)') && s.includes('($2,000.00)'));
  ok('invoice PDF: the pay link is a link you can click', /\/Subtype \/Link [^>]*\/URI \(https:\/\/pay\.example\/x\)/.test(s));
  ok('invoice PDF: the same input gives the same bytes', dec(invoicePdf({ number: 13, title: 'Balance at launch', amount_cents: 200000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/x', due_date: '2026-11-18', created_at: '2026-11-04T18:00:00Z' }, brand, ctx)) === s);
  const rc = dec(invoicePdf({ number: 13, title: 'Balance', amount_cents: 200000, status: 'paid', paid_at: '2026-11-11T12:00:00Z', paid_method: 'check', paid_note: 'Check #1042' }, brand, ctx));
  ok('receipt PDF: RECEIPT, PAID, and how it was paid', rc.includes('(RECEIPT FOR JUNIPER FLORAL CO.  #0013)') && rc.includes('(PAID IN FULL)') && rc.includes('(Paid Nov 11, 2026 by check \\267 Check #1042)'));
  const long = contractPdf({ title: 'Service agreement', body: 'Clause.\n\n'.repeat(400), status: 'signed', signer_name: 'Ivy Chen', signed_at: '2026-10-21T17:03:22Z', content_hash: 'ab'.repeat(32), signed_evidence: { ip_hash: 'a1b2' } }, brand, null);
  const ls = dec(long);
  ok('agreement PDF: a long one runs onto more pages, each numbered', xrefOk(long) && /\/Count (\d+)/.exec(ls) && Number(/\/Count (\d+)/.exec(ls)[1]) > 2 && ls.includes('(Page 1 of ') && ls.includes('(Certificate of record)') && ls.includes('(Signed at: 2026-10-21 17:03:22 UTC)'));
  const pp = dec(proposalPdf({ title: 'Website refresh', line_items: [{ label: 'Build', qty: 1, unit_cents: 300000 }, { __meta__: { discount: { mode: 'fixed', value: 10000 } } }], currency: 'usd', status: 'accepted' }, brand, ctx));
  ok('proposal PDF: lines, discount, total, accepted', pp.includes('(PROPOSAL FOR JUNIPER FLORAL CO.)') && pp.includes('(ACCEPTED)') && pp.includes('(-$100.00)') && pp.includes('($2,900.00)'));
  ok('estimate PDF: ESTIMATE and good-until', dec(estimatePdf({ title: 'Estimate', line_items: [{ label: 'Build', qty: 1, unit_cents: 1000 }], status: 'sent', expires_at: '2026-12-11T00:00:00Z' }, brand, null)).includes('Good until Dec 11, 2026'));
  ok('file names: Invoice-0013, Receipt-0013, Deposit-request, the agreement by title', pdfFileName('invoice', { number: 13, status: 'open' }) === 'Invoice-0013.pdf' && pdfFileName('invoice', { number: 13, status: 'paid' }) === 'Receipt-0013.pdf' && pdfFileName('invoice', { number: 2, purpose: 'deposit', status: 'open' }) === 'Deposit-request-0002.pdf' && pdfFileName('contract', { title: 'Service agreement', status: 'signed' }) === 'Signed-agreement-Service-agreement.pdf' && pdfFileName('proposal', { title: 'Café / Logo' }) === 'Proposal-Cafe-Logo.pdf');
  const d = new PdfDoc('t'); d.text(10, 10, 'a (b) \\ c');
  ok('PDF strings escape ( ) and \\', dec(d.bytes()).includes('(a \\(b\\) \\\\ c) Tj'));
  ok('attachments go to Resend as base64', base64Of(new TextEncoder().encode('%PDF-1.4')) === 'JVBERi0xLjQ=');
}

// ═══ the two studios, seeded fresh for each block ═══
const SITE_A = { id: A, client_id: CLIENT_A, status: 'live', last_published_at: null, template_slug: 'studio', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const SITE_B = { ...SITE_A, id: B, client_id: CLIENT_B };
const ADDRESS_A = { street: '48 Elm Ave', city: 'Pasadena', state: 'CA', zip: '91101', country: '' };
const invoice = (over = {}) => ({
  id: INV_A, site_id: A, deal_id: DEAL_A, customer_client_id: null, customer_site_id: null, number: 13, title: 'Balance at launch', description: 'Balance',
  amount_cents: 200000, currency: 'usd', purpose: 'service', status: 'open', stripe_url: 'https://pay.example/x', stripe_payment_link_id: 'plink_13',
  due_date: '2026-11-18', processing_since: null, paid_at: null, paid_method: '', paid_note: '', paid_private_note: '', payment_for: null, link_gen: 0, lines: null,
  recurring_id: null, created_by: 'owner@northwind.example', created_at: '2026-11-04T18:00:00Z', updated_at: '2026-11-04T18:00:00Z', first_sent_at: '2026-11-04T18:00:00Z', first_viewed_at: null, deleted_at: null, ...over,
});
const notice = (id, client_id, site_id, period, status = 'active') => ({ id, client_id, site_id, kind: 'deal_followup', period, headline: 'Still unpaid', body: '', status, created_at: '2026-11-10T00:00:00Z' });
const world = (extra = {}) => {
  db.reset({
    presence_sites: [SITE_A, SITE_B],
    presence_entitlements: [CLIENT_A, CLIENT_B].map((client_id) => ({ client_id, product: 'presence', plan: 'presence', status: 'active' })),
    clients: [{ id: CLIENT_A, email: USERS['jwt-north'].email, tenant_id: 'tenant-1', name: 'Northwind' }, { id: CLIENT_B, email: USERS['jwt-south'].email, tenant_id: 'tenant-1', name: 'Southpaw' }],
    presence_site_members: [
      { id: uuid('0'), site_id: A, user_id: USERS['jwt-staff'].id, email: USERS['jwt-staff'].email, role: 'business_staff', status: 'active', created_at: '2026-10-01T00:00:00Z' },
      { id: '0000000f-0000-4000-8000-000000000001', site_id: A, user_id: USERS['jwt-reviewer'].id, email: USERS['jwt-reviewer'].email, role: 'client_reviewer', status: 'active', created_at: '2026-10-02T00:00:00Z' },
    ],
    presence_identity: [{ site_id: A, business_name: 'Northwind Studio', email: 'hello@northwind.example', phone: '(555) 010-4400' }, { site_id: B, business_name: 'Southpaw Design', email: 'hi@southpaw.example', phone: '' }],
    presence_locations: [
      { id: 'loc-a', site_id: A, address_line1: '120 Main St', address_line2: '', city: 'Burbank', region: 'CA', postal_code: '91502', timezone: 'America/Los_Angeles', phone: '' },
      { id: 'loc-b', site_id: B, address_line1: '9 Harbor Rd', address_line2: '', city: 'Portland', region: 'OR', postal_code: '97201', timezone: 'America/Los_Angeles', phone: '' },
    ],
    presence_deals: [
      { id: DEAL_A, site_id: A, title: 'Website refresh', stage: 'contract', contact_id: CT_A, converted_client_id: null, converted_site_id: null, created_project_id: null, next_step: null, next_step_at: null, deleted_at: null },
      { id: DEAL_B, site_id: B, title: 'Harbor menu boards', stage: 'contract', contact_id: CT_B, converted_client_id: null, converted_site_id: null, created_project_id: null, next_step: null, next_step_at: null, deleted_at: null },
    ],
    presence_contacts: [
      { id: CT_A, site_id: A, name: 'Ivy Chen', email: 'ivy@juniper.example', phone: '', company: 'Juniper Floral Co.', notes: '', address: ADDRESS_A, deleted_at: null },
      { id: CT_B, site_id: B, name: 'Omar Reyes', email: 'omar@harbor.example', phone: '', company: 'Harbor Fish Co.', notes: '', address: { street: '9 Pier Way', city: 'Portland', state: 'OR', zip: '97201', country: '' }, deleted_at: null },
    ],
    presence_contracts: [
      { id: CON_A, site_id: A, deal_id: DEAL_A, title: 'Service agreement', status: 'signed', deleted_at: null, created_at: '2026-11-01T00:00:00Z' },
      { id: 'con-b', site_id: B, deal_id: DEAL_B, title: 'Service agreement', status: 'signed', deleted_at: null, created_at: '2026-11-01T00:00:00Z' },
    ],
    presence_invoices: [
      invoice(),
      invoice({ id: DEP_A, number: 12, title: 'Deposit', description: 'Deposit', amount_cents: 120000, purpose: 'deposit', stripe_url: null, stripe_payment_link_id: null, due_date: null, created_at: '2026-11-01T18:00:00Z' }),
      // Southpaw's invoice carries the SAME running number: numbers are per studio
      invoice({ id: INV_B, site_id: B, deal_id: DEAL_B, title: 'Menu boards', description: 'Menu boards', amount_cents: 90000, stripe_url: 'https://pay.example/b', stripe_payment_link_id: 'plink_b13' }),
    ],
    presence_plan_notices: [
      notice('n-a-old', CLIENT_A, A, `invremind:${INV_A}`), notice('n-a-after', CLIENT_A, A, `invremind:${INV_A}:after`),
      notice('n-a-dep', CLIENT_A, A, `invremind:${DEP_A}:after`), notice('n-b', CLIENT_B, B, `invremind:${INV_B}:after`),
    ],
    presence_deal_events: [],
    ...extra,
  });
  db.fail.add('rpc/rate_hit');   // the limiter fails open
  out.stripe.length = 0; out.mail.length = 0; out.escaped.length = 0; stripeOk = true; beforeWrite = null; olderDb = null;
};
const row = (id) => (db.tables.presence_invoices || []).find((r) => r.id === id);
const noticeOf = (id) => (db.tables.presence_plan_notices || []).find((x) => x.id === id);
const events = (kind) => (db.tables.presence_deal_events || []).filter((e) => !kind || e.kind === kind);
const snap = (id) => JSON.stringify(row(id));
const mailTo = (addr) => out.mail.filter((m) => [].concat(m.to).includes(addr));
const isPdf = (b64) => { try { return atob(b64).startsWith('%PDF-1.4'); } catch { return false; } };
const OWNER_A = { kind: 'client', userId: USERS['jwt-north'].id, email: USERS['jwt-north'].email, tenantId: 'tenant-1', role: 'client', jwt: 'jwt-north', requestId: 'r' };
const req = (method, path, body, headers = {}) => new Request(`https://example.supabase.co/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const res = async (r) => { const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* html or a pdf */ } return { status: r.status, body, text, headers: r.headers }; };
const pay = async (site, id, body, today = '2026-11-11') => res(await handleInvoicePayment(req('POST', `/sales/invoices/${id}/payment?today=${today}`, body), site, OWNER_A, id, {}));
const undo = async (site, id) => res(await handleInvoicePaymentUndo(req('POST', `/sales/invoices/${id}/payment/undo`, {}), site, OWNER_A, id, {}));
const invWrites = () => db.writes('presence_invoices').length;
const deactivated = () => out.stripe.filter((c) => /^\/v1\/payment_links\/.+/.test(c.path)).map((c) => c.path.split('/').pop());

// ═══ 4. recording a payment, end to end against the shared fake (77) ═══
{
  world();
  const r = await pay(SITE_A, INV_A, { method: 'check', paid_on: '2026-11-11', note: 'Check #1042', email_receipt: false });
  ok('all of it: 200, the invoice is paid that day, that way', r.status === 200 && row(INV_A).status === 'paid' && row(INV_A).paid_at === '2026-11-11T12:00:00.000Z' && row(INV_A).paid_method === 'check' && row(INV_A).paid_note === 'Check #1042', JSON.stringify(r.body));
  ok('all of it: its card link is switched off, and the page is told', JSON.stringify(deactivated()) === JSON.stringify(['plink_13']) && out.stripe[0].form.active === 'false' && r.body.data.link_deactivated === true);
  ok('all of it: its reminders stop, the old one and each leg', noticeOf('n-a-old').status === 'dismissed' && noticeOf('n-a-after').status === 'dismissed');
  ok('all of it: another invoice’s reminders, and the other studio’s, keep going', noticeOf('n-a-dep').status === 'active' && noticeOf('n-b').status === 'active');
  const ev = events('invoice_paid')[0];
  ok('all of it: the deal’s history says who recorded what, how', !!ev && ev.site_id === A && ev.deal_id === DEAL_A && ev.detail.recorded === true && ev.detail.method === 'check' && ev.detail.amount_cents === 200000 && ev.actor === 'owner@northwind.example' && !ev.detail.part, JSON.stringify(ev));
  ok('all of it: the other studio’s invoice with the same number is untouched', row(INV_B).status === 'open' && row(INV_B).amount_cents === 90000 && row(INV_B).paid_method === '');
  ok('all of it: nothing escaped to the outside world', out.escaped.length === 0, out.escaped.join(' '));
  const writesBefore = invWrites(), eventsBefore = events().length;
  const again = await pay(SITE_A, INV_A, { method: 'cash', email_receipt: false });
  ok('a second record on a paid invoice is refused, nothing changes', again.status === 409 && again.body.error === 'already_paid' && row(INV_A).paid_method === 'check' && invWrites() === writesBefore && events().length === eventsBefore);
}
{
  // a card payment starts settling between the read and the write: the card payment wins
  world();
  beforeWrite = { match: (u, m) => m === 'PATCH' && u.pathname.endsWith('/presence_invoices'), run: () => { row(INV_A).processing_since = '2026-11-11T09:00:00Z'; } };
  const r = await pay(SITE_A, INV_A, { method: 'cash', email_receipt: false });
  ok('a card payment that starts settling as it is recorded wins: 409, nothing recorded', r.status === 409 && row(INV_A).status === 'open' && row(INV_A).paid_method === '' && row(INV_A).processing_since !== null && events().length === 0 && deactivated().length === 0, JSON.stringify(r.body));
  // …or Stripe marks it paid in that same moment: still one payment, Stripe's
  world();
  beforeWrite = { match: (u, m) => m === 'PATCH' && u.pathname.endsWith('/presence_invoices'), run: () => { Object.assign(row(INV_A), { status: 'paid', paid_at: '2026-11-11T09:00:00Z' }); } };
  const r2 = await pay(SITE_A, INV_A, { method: 'cash', email_receipt: false });
  ok('paid online that same second: 409 "already paid", and the payment stays Stripe’s', r2.status === 409 && r2.body.error === 'already_paid' && row(INV_A).paid_method === '' && events().length === 0, JSON.stringify(r2.body));
}
{
  world(); stripeOk = false;
  const r = await pay(SITE_A, INV_A, { method: 'zelle', amount_cents: 50000, paid_on: '2026-11-08', email_receipt: false });
  const part = db.tables.presence_invoices.find((x) => x.payment_for === INV_A);
  ok('part of it: the payment is a paid row of its own on this studio, toward the invoice', r.status === 200 && part && part.site_id === A && part.deal_id === DEAL_A && part.status === 'paid' && part.amount_cents === 50000 && part.paid_method === 'zelle' && part.purpose === 'service' && /Part payment — Balance at launch/.test(part.title) && /#0013/.test(part.description), JSON.stringify(r.body));
  ok('part of it: the invoice drops by the same amount and stays open, its old link gone', row(INV_A).status === 'open' && row(INV_A).amount_cents === 150000 && row(INV_A).stripe_url === null && row(INV_A).stripe_payment_link_id === null && row(INV_A).link_gen === 1);
  ok('part of it: Stripe said no, so the page is told the old link may be live', r.body.data.link_deactivated === false && r.body.data.part === true && r.body.data.left_cents === 150000 && r.body.data.fresh_link === false);
  ok('part of it: its reminders keep going (the rest is still due)', noticeOf('n-a-after').status === 'active');
  ok('part of it: the history line says part, and what is left', events('invoice_paid').some((e) => e.detail.part === true && e.detail.left_cents === 150000));
  const u = await undo(SITE_A, part.id);
  ok('undo a part payment: its row goes, its amount goes back on the invoice', u.status === 200 && !!part.deleted_at && row(INV_A).amount_cents === 200000 && row(INV_A).status === 'open', JSON.stringify(u.body));
  ok('undo: the history keeps a line for it', events('payment_undone').some((e) => e.detail.part === true && e.detail.amount_cents === 50000 && e.site_id === A));
}
{
  // with Stripe up, what is left gets a fresh link of its own there and then (sales item 116)
  world();
  const r = await pay(SITE_A, INV_A, { method: 'cash', amount_cents: 50000, email_receipt: false });
  ok('part of it: what is left gets a fresh card link for the new amount, on the invoice', r.status === 200 && r.body.data.fresh_link === true && /^https:\/\/pay\.example\/new-/.test(String(row(INV_A).stripe_url)) && out.stripe.some((c) => c.path === '/v1/prices' && c.form.unit_amount === '150000'), JSON.stringify(out.stripe.map((c) => c.path)));
}
{
  // two part payments at once: the second one's drop finds the amount already moved
  world();
  beforeWrite = { match: (u, m) => m === 'PATCH' && u.pathname.endsWith('/presence_invoices') && u.search.includes('amount_cents=eq.'), run: () => { row(INV_A).amount_cents = 180000; } };
  const r = await pay(SITE_A, INV_A, { method: 'cash', amount_cents: 50000, email_receipt: false });
  const part = db.tables.presence_invoices.find((x) => x.payment_for === INV_A);
  ok('two part payments at once can’t both land: 409, and nothing is half-saved', r.status === 409 && !!part && !!part.deleted_at && row(INV_A).amount_cents === 180000 && events('invoice_paid').length === 0, JSON.stringify(r.body));
}
{
  world();
  await pay(SITE_A, INV_A, { method: 'cash', email_receipt: false });
  const u = await undo(SITE_A, INV_A);
  ok('undo all of it: open again, its paid facts cleared and a fresh card link made', u.status === 200 && row(INV_A).status === 'open' && row(INV_A).paid_at === null && row(INV_A).paid_method === '' && /^https:\/\/pay\.example\/new-/.test(String(row(INV_A).stripe_url)) && u.body.data.fresh_link === true, JSON.stringify(u.body));
  world();
  Object.assign(row(INV_A), { status: 'paid', paid_method: '', paid_at: '2026-11-10T12:00:00Z' });
  const before = snap(INV_A);
  const stripeTook = await undo(SITE_A, INV_A);
  ok('undo: a payment Stripe took is never undone here', stripeTook.status === 409 && snap(INV_A) === before, JSON.stringify(stripeTook.body));
  world();
  const part = await pay(SITE_A, INV_A, { method: 'cash', amount_cents: 50000, email_receipt: false });
  const prow = db.tables.presence_invoices.find((x) => x.payment_for === INV_A);
  Object.assign(row(INV_A), { status: 'paid', paid_method: 'check' });
  const refused = await undo(SITE_A, prow.id);
  ok('undo a part payment after the rest was paid: refused, nothing changes', part.status === 200 && refused.status === 409 && !prow.deleted_at && row(INV_A).status === 'paid');
}
{
  world();
  const r = await pay(SITE_A, DEP_A, { method: 'bank_transfer', email_receipt: false });
  const deal = (id) => db.tables.presence_deals.find((d) => d.id === id);
  ok('a deposit paid in full by hand wins a signed deal, as a card deposit does', r.status === 200 && r.body.data.moved === true && deal(DEAL_A).stage === 'won' && events('stage_change').some((e) => e.to_stage === 'won' && e.deal_id === DEAL_A && e.detail.because === 'deposit_paid'), JSON.stringify(r.body));
  ok('…and the other studio’s deal stays where it was', deal(DEAL_B).stage === 'contract');
  world();
  const p2 = await pay(SITE_A, DEP_A, { method: 'bank_transfer', amount_cents: 20000, email_receipt: false });
  ok('a deposit paid in part moves nothing', p2.status === 200 && deal(DEAL_A).stage === 'contract');
  // a deposit row that names the other studio's deal (a bad row) can never move that deal
  world();
  row(DEP_A).deal_id = DEAL_B;
  const cross = await pay(SITE_A, DEP_A, { method: 'cash', email_receipt: true });
  ok('a deposit that names another studio’s deal moves nothing there, and emails nobody there', cross.status === 200 && deal(DEAL_B).stage === 'contract' && events('stage_change').length === 0 && mailTo('omar@harbor.example').length === 0, JSON.stringify(cross.body));
}
{
  world();
  const r = await pay(SITE_A, INV_A, { method: 'cash', amount_cents: 300000 });
  ok('more than due: 422 and nothing written, nothing sent', r.status === 422 && invWrites() === 0 && events().length === 0 && out.stripe.length === 0 && out.mail.length === 0);
  // the route trusts a caller's today only near the real one (callerToday), so the days are the clock's
  const today = new Date().toISOString().slice(0, 10), after = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const f = await pay(SITE_A, INV_A, { method: 'cash', paid_on: after }, today);
  ok('a day after the caller’s today: 422', f.status === 422 && row(INV_A).status === 'open');
  const reads = db.log.length;
  const bad = await handleInvoicePayment(req('POST', '/x', {}), SITE_A, OWNER_A, 'not-a-uuid', {});
  ok('a bad id: 400 before any read', bad.status === 400 && db.log.length === reads);
}
{
  // tenant safety: Northwind's call names Southpaw's invoice
  world();
  const before = snap(INV_B);
  const r = await pay(SITE_A, INV_B, { method: 'cash', email_receipt: true });
  ok('another studio’s invoice: 404, and it stays exactly as it was', r.status === 404 && snap(INV_B) === before, JSON.stringify(r.body));
  ok('…nothing was written, switched off, emailed or cleared for it', invWrites() === 0 && out.stripe.length === 0 && out.mail.length === 0 && events().length === 0 && noticeOf('n-b').status === 'active');
  Object.assign(row(INV_B), { status: 'paid', paid_method: 'check', paid_at: '2026-11-09T12:00:00Z' });
  const paidB = snap(INV_B);
  const u = await undo(SITE_A, INV_B);
  ok('undo on another studio’s paid invoice: 404, it stays paid', u.status === 404 && snap(INV_B) === paidB && invWrites() === 0);
}
{
  // the receipt: to the deal's person, the receipt PDF attached the way Resend takes it
  world();
  const r = await pay(SITE_A, INV_A, { method: 'check', paid_on: '2026-11-11', note: 'Check #1042' });
  const m = mailTo('ivy@juniper.example')[0];
  ok('the receipt goes to the deal’s person, naming the number and the amount', r.status === 200 && r.body.data.receipt_emailed === true && !!m && m.subject === 'Receipt for #0013 — $2,000.00 received, thank you' && /Hi Ivy,/.test(m.html), JSON.stringify(out.mail.map((x) => x.subject)));
  ok('…with the receipt as a PDF, sent to Resend as base64 under its own name', !!m && m.attachments?.length === 1 && m.attachments[0].filename === 'Receipt-0013.pdf' && isPdf(m.attachments[0].content));
  ok('…and the other studio’s person hears nothing', mailTo('omar@harbor.example').length === 0);
}

// ═══ 5. the same routes through the real index.ts ═══
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
await import(`${P}/index.ts`);
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
const call = async (jwt, method, path, body, headers = {}) => res(await send(req(method, path, body, { ...(jwt ? { 'x-dds-user-jwt': jwt } : {}), ...headers })));
{
  world();
  const r = await call('jwt-north', 'POST', `/sales/invoices/${INV_A}/payment?today=2026-11-11`, { method: 'check', note: 'Check #1042', email_receipt: false });
  ok('routed: the owner records a check on their invoice', r.status === 200 && row(INV_A).status === 'paid' && row(INV_A).paid_method === 'check', `${r.status} ${r.text.slice(0, 160)}`);
  const u = await call('jwt-north', 'POST', `/sales/invoices/${INV_A}/payment/undo`, {});
  ok('routed: …and Undo takes it back', u.status === 200 && row(INV_A).status === 'open' && row(INV_A).paid_method === '', `${u.status} ${u.text.slice(0, 160)}`);
  world();
  const before = snap(INV_A);
  const anon = await call(null, 'POST', `/sales/invoices/${INV_A}/payment`, { method: 'cash' });
  ok('signed out: 401, and the invoice is as it was', anon.status === 401 && snap(INV_A) === before && invWrites() === 0);
  const south = await call('jwt-south', 'POST', `/sales/invoices/${INV_A}/payment`, { method: 'cash' });
  ok('another studio’s owner, signed in to their own site, gets 404 for it, and it stays open', south.status === 404 && snap(INV_A) === before && invWrites() === 0, `${south.status} ${south.text.slice(0, 120)}`);
  const southUndo = await call('jwt-south', 'POST', `/sales/invoices/${INV_A}/payment/undo`, {});
  ok('…and the same for Undo', southUndo.status === 404 && snap(INV_A) === before);
}
{
  ok('roles: recording a payment is an edit, taking one back is a delete', memberWriteNeeds(`/sales/invoices/${INV_A}/payment`, 'POST') === 'edit' && memberWriteNeeds(`/sales/invoices/${INV_A}/payment/undo`, 'POST') === 'delete');
  world();
  const r = await call('jwt-staff', 'POST', `/sales/invoices/${INV_A}/payment?today=2026-11-11`, { method: 'cash', email_receipt: false });
  ok('a staff seat records a payment on the studio it sits on', r.status === 200 && row(INV_A).status === 'paid' && row(INV_A).paid_method === 'cash', `${r.status} ${r.text.slice(0, 160)}`);
  const paidSnap = snap(INV_A);
  const u = await call('jwt-staff', 'POST', `/sales/invoices/${INV_A}/payment/undo`, {});
  ok('…but can’t undo one (that needs delete): 403, it stays paid', u.status === 403 && u.body?.error === 'forbidden' && snap(INV_A) === paidSnap, `${u.status} ${u.text.slice(0, 160)}`);
  const staffB = await call('jwt-staff', 'POST', `/sales/invoices/${INV_B}/payment`, { method: 'cash' });
  ok('…and a staff seat on one studio can’t reach the other studio’s invoice', staffB.status === 404 && row(INV_B).status === 'open');
  world();
  const rv = await call('jwt-reviewer', 'POST', `/sales/invoices/${INV_A}/payment`, { method: 'cash' });
  ok('a client reviewer seat is stopped at the reviewer boundary, nothing recorded', rv.status === 403 && rv.body?.error === 'forbidden' && row(INV_A).status === 'open' && invWrites() === 0, `${rv.status} ${rv.text.slice(0, 120)}`);
}

// ═══ 6. the document: its link, the page, the PDF (81, 82) ═══
const PART_A = '0000000a-0000-4000-8000-0000000000a1';
{
  world({ presence_invoices: [
    invoice({ amount_cents: 150000 }),
    invoice({ id: PART_A, number: null, title: 'Part payment — Balance at launch', description: 'Part payment toward invoice #0013', amount_cents: 50000, status: 'paid', paid_at: '2026-11-08T12:00:00.000Z', paid_method: 'zelle', payment_for: INV_A, stripe_url: null, stripe_payment_link_id: null }),
    invoice({ id: INV_B, site_id: B, deal_id: DEAL_B, title: 'Menu boards', description: 'Menu boards', amount_cents: 90000 }),
  ] });
  const link = await call('jwt-north', 'GET', `/sales/invoices/${INV_A}/document`);
  const token = /\/sales\/doc\/([^?]+)\?format=pdf$/.exec(String(link.body?.pdf_url || ''))?.[1];
  ok('the record’s document link carries the PDF’s address, the same signed copy', link.status === 200 && String(link.body.url).startsWith('https://app.example/doc.html?t=') && String(link.body.pdf_url).startsWith('https://example.supabase.co/functions/v1/presence/sales/doc/') && !!token && decodeURIComponent(token) === new URL(link.body.url).searchParams.get('t'), JSON.stringify(link.body));
  const other = await call('jwt-north', 'GET', `/sales/invoices/${INV_B}/document`);
  ok('…and another studio’s invoice has no link: 404', other.status === 404 && !other.text.includes('/sales/doc/'));
  const pdf = await send(new Request(String(link.body.pdf_url), { method: 'GET' }));
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  ok('?format=pdf answers a real PDF file, downloaded under the invoice’s own name', pdf.status === 200 && pdf.headers.get('Content-Type') === 'application/pdf' && pdf.headers.get('Content-Disposition') === 'attachment; filename="Invoice-0013.pdf"' && dec(bytes).startsWith('%PDF-1.4') && dec(bytes).includes('(INVOICE FOR JUNIPER FLORAL CO.  #0013)'), `${pdf.status} ${pdf.headers.get('Content-Type')}`);
  const page = await call(null, 'GET', `/sales/doc/${token}`);
  ok('the page says who it is from: the studio, its address', page.status === 200 && page.text.includes('<div class="k">From</div><div class="first">Northwind Studio</div><div>120 Main St</div><div>Burbank, CA 91502</div>'), page.text.slice(0, 200));
  ok('…who it is billed to, from the deal’s person and their address', page.text.includes('<div class="k">Billed to</div>') && page.text.includes('Ivy Chen') && page.text.includes('<div>48 Elm Ave</div><div>Pasadena, CA 91101</div>'));
  ok('…its dates, in the studio’s own zone', page.text.includes('Issued Nov 4, 2026') && page.text.includes('Due Nov 18, 2026'));
  ok('…the part payment recorded toward it, and what is left', /Paid Nov 8, 2026 by Zelle[\s\S]*−\$500\.00[\s\S]*Amount due<\/td><td class="qty"><\/td><td>\$1,500\.00/.test(page.text));
  ok('…and its own Download PDF, never anything of the other studio’s', page.text.includes('id="dlpdf">Download PDF</button>') && !page.text.includes('Southpaw') && !page.text.includes('9 Harbor Rd') && !page.text.includes('Omar'));
  const crossTok = await signDocToken({ t: 'doc', k: 'invoice', id: INV_B, site_id: A, exp: Math.floor(Date.now() / 1000) + 3600 }, S.linkSecret());
  const cross = await call(null, 'GET', `/sales/doc/${crossTok}`);
  ok('a link signed for one studio that names another studio’s invoice opens nothing of it', cross.status === 404 && !cross.text.includes('Menu boards') && !cross.text.includes('Southpaw'), `${cross.status}`);
  const [body] = String(token).split('.');
  const forged = await call(null, 'GET', `/sales/doc/${body}.${'0'.repeat(64)}`);
  const forgedPdf = await call(null, 'GET', `/sales/doc/${body}.${'0'.repeat(64)}?format=pdf`);
  ok('a link we didn’t sign opens nothing, page or PDF', forged.status === 403 && !forged.text.includes('Ivy Chen') && forgedPdf.status === 403 && forgedPdf.headers.get('Content-Type') !== 'application/pdf');
}

// ═══ 7. the emails: the invoice, the card receipt, the signed agreement (81, 82) ═══
{
  world();
  const sent = await S.emailInvoice(A, DEAL_A, 'Balance at launch', 'https://pay.example/x', 200000, INV_A);
  const m = mailTo('ivy@juniper.example')[0];
  ok('invoice email: to the deal’s person, its title, number and amount in the subject', sent === true && !!m && m.subject === 'Balance at launch #0013 — $2,000.00', JSON.stringify(out.mail.map((x) => x.subject)));
  ok('invoice email: greets them by first name and names the due date', !!m && m.html.includes('Hi Ivy,') && m.html.includes('due Nov 18, 2026'));
  ok('invoice email: the invoice goes with it as a PDF, base64 for Resend', !!m && m.attachments?.length === 1 && m.attachments[0].filename === 'Invoice-0013.pdf' && isPdf(m.attachments[0].content));
  world();
  Object.assign(db.tables.presence_contacts[0], { name: 'ivy@juniper.example' });
  row(INV_A).due_date = null;
  await S.emailInvoice(A, DEAL_A, 'Balance at launch', 'https://pay.example/x', 200000, INV_A);
  const m2 = mailTo('ivy@juniper.example')[0];
  ok('invoice email: no first name says Hi there; no due date says due on receipt', !!m2 && m2.html.includes('Hi there,') && m2.html.includes('due on receipt') && !m2.html.includes('Hi ivy'));
  world();
  const crossSent = await S.emailInvoice(A, DEAL_B, 'Menu boards', 'https://pay.example/b', 90000, INV_B);
  ok('invoice email: a call for one studio never emails the other studio’s person', crossSent === false && out.mail.length === 0);
}
{
  // the card payment's echo (the Stripe webhook calls it with the shared secret)
  world();
  Object.assign(row(INV_A), { status: 'paid', paid_at: '2026-11-12T18:00:00Z', paid_method: '' });
  const r = await call(null, 'POST', '/commerce/invoice-paid', { invoice_id: INV_A }, { 'x-commerce-secret': 'echo-secret-for-tests' });
  const m = mailTo('ivy@juniper.example')[0];
  ok('the card-payment receipt names the number', r.status === 200 && r.body?.data?.receipted === true && !!m && m.subject === 'Payment received — thank you (#0013)', `${r.status} ${JSON.stringify(out.mail.map((x) => x.subject))}`);
  ok('…and carries the receipt PDF', !!m && m.attachments?.length === 1 && m.attachments[0].filename === 'Receipt-0013.pdf' && isPdf(m.attachments[0].content));
  world();
  Object.assign(row(INV_A), { status: 'paid', paid_at: '2026-11-12T18:00:00Z', paid_method: '' });
  const noSecret = await call(null, 'POST', '/commerce/invoice-paid', { invoice_id: INV_A }, { 'x-commerce-secret': 'wrong' });
  ok('…and without the shared secret the echo does nothing at all', noSecret.status === 403 && out.mail.length === 0 && (db.tables.presence_plan_notices || []).every((x) => x.kind !== 'invoice_paid'));
}
{
  // the signed agreement's copy goes to the signer with the PDF
  const HASH = 'ab'.repeat(32);
  world({ presence_contracts: [{ id: CON_A, site_id: A, deal_id: DEAL_A, title: 'Service agreement', body: 'The studio builds the site.\n\nThe client pays the invoices.', status: 'sent', content_hash: HASH, signer_name: null, signer_email: null, signed_at: null, signed_evidence: null, sent_at: '2026-11-10T00:00:00Z', created_at: '2026-11-09T00:00:00Z', deleted_at: null }] });
  const tok = await S.signSalesToken({ t: 'contract', id: CON_A, site_id: A, exp: Math.floor(Date.now() / 1000) + 3600 }, S.linkSecret());
  const r = await call(null, 'POST', `/sales/contracts/${CON_A}/sign`, { token: tok, signer_name: 'Ivy Chen', signer_email: 'ivy@juniper.example', presented_hash: HASH });
  const m = out.mail.find((x) => /Your signed copy/.test(x.subject));
  ok('the signed agreement goes to the signer with its PDF attached (base64)', r.status === 200 && r.body?.data?.copy_emailed === true && !!m && [].concat(m.to).includes('ivy@juniper.example') && m.attachments?.length === 1 && m.attachments[0].filename === 'Signed-agreement-Service-agreement.pdf' && isPdf(m.attachments[0].content), `${r.status} ${r.text.slice(0, 160)}`);
}

// ═══ 8. what gets billed keeps its lines (81) ═══
const PROPOSAL_LINES = [{ label: 'Website refresh, five pages', qty: 1, unit_cents: 260000 }, { label: 'Logo cleanup', qty: 2, unit_cents: 30000 }, { __meta__: { discount: { mode: 'percent', value: 10 }, tax_pct: 8.5 } }];
const billWorld = () => world({
  presence_proposals: [{ id: PROP_A, site_id: A, deal_id: DEAL_A, title: 'Website refresh', line_items: PROPOSAL_LINES, subtotal_cents: 320000, status: 'accepted', decided_at: '2026-11-02T00:00:00Z', deleted_at: null }],
  presence_invoices: [invoice({ id: DEP_A, number: 12, title: 'Deposit', description: 'Deposit', amount_cents: 120000, purpose: 'deposit', status: 'paid', paid_at: '2026-11-03T12:00:00Z', stripe_url: null, stripe_payment_link_id: null })],
});
const newInvoice = () => db.tables.presence_invoices.find((x) => x.id !== DEP_A && x.site_id === A);
{
  billWorld();
  const r = await call('jwt-north', 'POST', `/sales/deals/${DEAL_A}/invoice`, {});
  const v = newInvoice();
  ok('+ Invoice from the accepted proposal bills what is left and stores the proposal’s lines', r.status === 201 && !!v && v.amount_cents === 192480 && Array.isArray(v.lines) && JSON.stringify(v.lines.map((l) => l.label)) === JSON.stringify(['Website refresh, five pages', 'Logo cleanup', 'Discount (10%)', 'Tax (8.5%)', 'Less deposit #0012']), `${r.status} ${JSON.stringify(v?.lines)}`);
  ok('…the lines add up to exactly what it bills, on this studio’s deal', !!v && v.lines.reduce((s, l) => s + l.amount_cents, 0) === v.amount_cents && v.site_id === A && v.deal_id === DEAL_A);
  billWorld();
  olderDb = (u, m, init) => (m === 'POST' && u.pathname.endsWith('/presence_invoices') && 'lines' in JSON.parse(String(init.body || '{}')))
    ? jres(400, { code: 'PGRST204', message: "Could not find the 'lines' column of 'presence_invoices' in the schema cache" }) : null;
  const r2 = await call('jwt-north', 'POST', `/sales/deals/${DEAL_A}/invoice`, {});
  const v2 = newInvoice();
  ok('…and before the database step (no lines column) the invoice still saves, without them', r2.status === 201 && !!v2 && v2.amount_cents === 192480 && !('lines' in v2), `${r2.status} ${r2.text.slice(0, 160)}`);
}
{
  const EST_LINES = [{ label: 'Homepage refresh', qty: 1, unit_cents: 90000 }, { label: 'Menu page', qty: 2, unit_cents: 20000 }, { __meta__: { discount: { mode: 'percent', value: 10 } } }];
  const estWorld = () => world({ presence_estimates: [{ id: EST_A, site_id: A, deal_id: DEAL_A, title: 'Spring refresh', line_items: EST_LINES, subtotal_cents: 130000, currency: 'usd', terms: '', status: 'approved', invoice_id: null, proposal_id: null, deleted_at: null }], presence_invoices: [] });
  estWorld();
  const r = await call('jwt-north', 'POST', `/sales/estimates/${EST_A}/invoice`, {});
  const v = (db.tables.presence_invoices || [])[0];
  ok('an estimate billed as an invoice keeps its lines, its discount included', r.status === 201 && !!v && v.amount_cents === 117000 && JSON.stringify((v.lines || []).map((l) => [l.label, l.amount_cents])) === JSON.stringify([['Homepage refresh', 90000], ['Menu page', 40000], ['Discount (10%)', -13000]]), `${r.status} ${JSON.stringify(v)}`);
  estWorld();
  const south = await call('jwt-south', 'POST', `/sales/estimates/${EST_A}/invoice`, {});
  ok('…and another studio can’t bill it: 404, no invoice made', south.status === 404 && (db.tables.presence_invoices || []).length === 0);
}

// ═══ 9. the deal read: the address is the contact's own (item 89), read as it is ═══
{
  world();
  const r = await call('jwt-north', 'GET', `/sales/deals/${DEAL_A}`);
  ok('the deal read carries the contact’s address as item 89 keeps it', r.status === 200 && JSON.stringify(r.body.data.contact.address) === JSON.stringify(ADDRESS_A) && r.body.data.contact.name === 'Ivy Chen', `${r.status} ${JSON.stringify(r.body?.data?.contact)}`);
  ok('…its invoices carry their numbers and how each was paid, and only this studio’s', r.body.data.invoices.some((i) => i.id === INV_A && i.number === 13 && i.paid_method === '') && !r.body.data.invoices.some((i) => i.id === INV_B));
  world();
  olderDb = (u, m) => (m === 'GET' && u.pathname.endsWith('/presence_contacts') && /(^|,)address(,|&|$)/.test(decodeURIComponent(u.search).replace(/^.*select=/, '')))
    ? jres(400, { code: '42703', message: 'column presence_contacts.address does not exist' }) : null;
  const old = await call('jwt-north', 'GET', `/sales/deals/${DEAL_A}`);
  ok('before contacts hold an address the deal still reads, from the read without it', old.status === 200 && old.body.data.contact?.name === 'Ivy Chen', `${old.status} ${old.text.slice(0, 160)}`);
  world();
  const contactBefore = JSON.stringify(db.tables.presence_contacts);
  const save = await call('jwt-north', 'PATCH', `/sales/deals/${DEAL_A}`, { title: 'Website refresh, phase two', address: '12 Oak St' });
  const deal = db.tables.presence_deals.find((d) => d.id === DEAL_A);
  ok('a deal save never writes an address: not on the deal, not on the contact', save.status === 200 && deal.title === 'Website refresh, phase two' && !('address' in deal) && JSON.stringify(db.tables.presence_contacts) === contactBefore, `${save.status} ${save.text.slice(0, 160)}`);
  const other = await call('jwt-north', 'GET', `/sales/deals/${DEAL_B}`);
  ok('another studio’s deal reads as 404, with nothing of it in the answer', other.status === 404 && !other.text.includes('Omar') && !other.text.includes('Harbor'));
}

// ═══ 10. the database step (0167): there is no database here, so the SQL is the contract ═══
{
  const mig = read('supabase/migrations/0167_invoice_payments_numbers.sql');
  const pack = read('docs/presence/APPLY-0167-prod.sql');
  const kinds = (s) => ((s.match(/presence_deal_events\s+add constraint presence_deal_events_kind_check\s+check \(kind in \(([\s\S]*?)\)\)/) || [])[1] || '').replace(/--[^\n]*/g, '').match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1)) || [];
  const k145 = kinds(read('supabase/migrations/0145_estimates_recurring_invoices.sql'));
  // pin: the columns exist only in the migration; the fake database has no schema to ask
  ok('0167: the five invoice columns, all re-runnable', ['number integer', "paid_method text not null default ''", "paid_note text not null default ''", 'payment_for uuid references public.presence_invoices(id) on delete cascade', 'lines jsonb'].every((c) => mig.includes('add column if not exists ' + c)));
  // pin: what a migration does NOT touch can only be read in the migration and its pack
  ok('0167: it adds no contact address (that is item 89’s column, read as it is)', !/presence_contacts/.test(mig) && !/presence_contacts/.test(pack));
  // pin: a CHECK constraint lives in the database, not in any code this suite can run
  ok('0167: how it was paid is one of the five ways (or empty, online)', /check \(paid_method in \('', 'check', 'cash', 'bank_transfer', 'zelle', 'other'\)\)/.test(mig));
  // pin: the unique index and the numbering trigger run inside Postgres
  ok('0167: one number per site, every new invoice numbered by a trigger (a part payment’s row is not)', /create unique index if not exists presence_invoices_site_number_uq\s+on public\.presence_invoices \(site_id, number\) where number is not null/.test(mig) && /if new\.number is null and new\.payment_for is null then/.test(mig) && /pg_advisory_xact_lock/.test(mig) && /create trigger presence_invoices_number before insert on public\.presence_invoices/.test(mig));
  // pin: the backfill is a one-off SQL statement, run by the apply pack
  ok('0167: the invoices already there are numbered in the order they were made, after any number given', /row_number\(\) over \(partition by i\.site_id order by i\.created_at, i\.id\)/.test(mig) && /coalesce\(max\(number\), 0\) as top/.test(mig));
  // pin: the kind list is a CHECK constraint each migration must carry forward by hand
  ok('0167: the deal history carries 0145’s whole list forward and adds payment_undone', k145.length === 18 && k145.every((k) => kinds(mig).includes(k)) && kinds(mig).includes('payment_undone') && kinds(mig).length === 19);
  // pin: a grant is database state
  ok('0167: the trigger’s function is out of the API roles’ reach', /revoke all on function public\.presence_invoice_number\(\) from public, anon, authenticated;/.test(mig));
  // pin: the rollback is a comment for the person applying it
  ok('0167: a rollback is written down', /-- rollback:[\s\S]*drop trigger if exists presence_invoices_number/.test(mig));
  // pin: the apply pack is a hand-kept copy of the migration and must say the same statements
  ok('the pack: the same statements as the migration, and the same kind list', pack.includes(mig.slice(mig.indexOf('alter table public.presence_invoices\n  add column if not exists number integer,'), mig.indexOf('-- rollback:')).trim()) && JSON.stringify(kinds(pack)) === JSON.stringify(kinds(mig)));
  // pin: the check query is read by the person applying the pack
  ok('the pack ends in a check query', /-- check: select \(select count\(\*\) from information_schema\.columns[\s\S]*as unnumbered;\s+-- 0\n$/.test(pack));
}

// ═══ the pages (crm.html, pipeline.html) are checked in a browser ═══
// Covered in the browser by:
//   tests/e2e/invoice-payments.spec.ts › item 77 — record a payment on the record › all of it: the form opens under the invoice, then marks it paid by check
//   tests/e2e/invoice-payments.spec.ts › item 77 — record a payment on the record › part of it: the button and the line say what stays due, and the way is picked
//   tests/e2e/invoice-payments.spec.ts › item 77 — record a payment on the record › more than due is caught before anything is sent
//   tests/e2e/invoice-payments.spec.ts › item 77 — record a payment on the record › a paid one says how, and Undo asks first then takes it back
//   tests/e2e/invoice-payments.spec.ts › item 77 — record a payment on the record › a part payment is its own paid row, under the invoice it went toward
//   tests/e2e/invoice-payments.spec.ts › items 81 and 82 — the proper invoice, the PDF, the address › PDF downloads the invoice’s own PDF under its number
//   tests/e2e/invoice-payments.spec.ts › items 81 and 82 — the proper invoice, the PDF, the address › Billing says who invoices go to and where; Edit opens their contact
//   tests/e2e/invoice-payments.spec.ts › items 81 and 82 — the proper invoice, the PDF, the address › before contacts hold an address: Billing names who, and offers nothing it can’t keep
//   tests/e2e/invoice-payments.spec.ts › item 77 — on the deal and in Who owes you › the deal’s invoice rows: numbers, how it was paid, Record payment and Undo
//   tests/e2e/invoice-payments-212.spec.ts › the record › the form offers the five ways, and a receipt box that names the person
//   tests/e2e/invoice-payments-212.spec.ts › the record › a payment Stripe took reads Paid online, and offers no Undo
//   tests/e2e/invoice-payments-212.spec.ts › the record › a staff seat records payments but is offered no Undo
//   tests/e2e/invoice-payments-212.spec.ts › the record › Edit on the billed-to line opens their contact on Details, in its one address box
//   tests/e2e/invoice-payments-212.spec.ts › the deal page › Who owes you: Record payment opens under the row and records it
//   tests/e2e/invoice-payments-212.spec.ts › the deal page › Undo on the deal asks first, then takes the payment back
//   tests/e2e/invoice-payments-212.spec.ts › the deal page › a staff seat is offered no Undo on the deal

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
Deno.exit(0);
