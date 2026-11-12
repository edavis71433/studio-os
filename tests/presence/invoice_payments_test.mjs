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
// Every name and number below is made up.
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('STRIPE_SECRET', 'sk_test_fake');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const P = '../../supabase/functions/presence';
const { validatePayment, paidAtOf, linesFromProposal, PAY_METHODS } = await import(`${P}/lib/invoice_billing.ts`);
const { invoiceNo, dayLabel, payMethodWords, paidLine, partyLines, invoiceLines, renderInvoiceDocument, renderProposalDocument, renderDocument } = await import(`${P}/lib/documents.ts`);
const { invoicePdf, contractPdf, proposalPdf, estimatePdf, pdfFileName } = await import(`${P}/lib/doc_pdf.ts`);
const { winAnsi, textWidth, wrapText, PdfDoc } = await import(`${P}/lib/pdf.ts`);
const { addressOf, addressText } = await import(`${P}/lib/doc_context.ts`);
const { firstNameOf } = await import(`${P}/routes/sales.ts`);
const { handleInvoicePayment, handleInvoicePaymentUndo } = await import(`${P}/routes/invoice_payments.ts`);
const { base64Of } = await import(`${P}/commerce/account.ts`);

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
{
  const dec = (u8) => new TextDecoder().decode(u8);
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

// ═══ 4. recording a payment, end to end against a fake database (77) ═══
const SITE = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const INV = '44444444-4444-4444-8444-444444444444';
const DEP = '55555555-5555-4555-8555-555555555555';
const PRINCIPAL = { kind: 'client', userId: 'u1', email: 'owner@studio.example', tenantId: null, role: 'owner', jwt: 'j', requestId: 'r' };
const CORS = {};
const world = { invoices: [], events: [], notices: [], deals: [], contracts: [], patches: [], stripe: [], escaped: [] };
const TABLES = { presence_invoices: 'invoices', presence_deal_events: 'events', presence_plan_notices: 'notices', presence_deals: 'deals', presence_contracts: 'contracts' };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const matches = (row, key, expr) => {
  if (expr === 'is.null') return row[key] === null || row[key] === undefined;
  if (expr === 'not.is.null') return row[key] !== null && row[key] !== undefined;
  const [op, ...rest] = expr.split('.');
  const want = decodeURIComponent(rest.join('.'));
  if (op === 'eq') return String(row[key] ?? '') === want;
  if (op === 'neq') return String(row[key] ?? '') !== want;
  if (op === 'in') return want.replace(/^\(|\)$/g, '').split(',').includes(String(row[key]));
  return true;
};
let stripeMode = 'ok';
let onPatch = null;
globalThis.fetch = (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  if (u.hostname === 'api.stripe.com') { world.stripe.push(u.pathname); return Promise.resolve(stripeMode === 'ok' ? jres(200, { id: 'plink', active: false }) : jres(400, { error: { message: 'no' } })); }
  if (u.hostname !== 'example.supabase.co') { world.escaped.push(u.href); return Promise.resolve(jres(500, {})); }
  const table = u.pathname.replace('/rest/v1/', '');
  const bucket = TABLES[table] ? world[TABLES[table]] : null;
  const method = (init?.method || 'GET').toUpperCase();
  if (!bucket) return Promise.resolve(method === 'GET' ? jres(200, []) : jres(201, []));   // brand, checklist and the like: nothing on file
  const filtered = () => { let out = bucket.slice(); for (const [k, e] of u.searchParams) { if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue; out = out.filter((r) => matches(r, k, e)); } return out; };
  if (method === 'GET') return Promise.resolve(jres(200, filtered()));
  if (method === 'POST') { const body = JSON.parse(init.body); const row = { id: crypto.randomUUID(), deleted_at: null, ...body }; bucket.push(row); return Promise.resolve(jres(201, [row])); }
  if (method === 'PATCH') { if (onPatch) { const f = onPatch; onPatch = null; f(table); } const patch = JSON.parse(init.body); const hit = filtered(); world.patches.push({ table, search: decodeURIComponent(u.search), patch, rows: hit.length }); for (const r of hit) Object.assign(r, patch); return Promise.resolve(jres(200, hit)); }
  return Promise.resolve(jres(405, {}));
};
const seed = () => {
  world.invoices = [
    { id: INV, site_id: SITE.id, deal_id: DEAL, number: 13, title: 'Balance at launch', description: 'Balance', amount_cents: 200000, currency: 'usd', purpose: 'service', status: 'open', stripe_url: 'https://pay.example/x', stripe_payment_link_id: 'plink_13', processing_since: null, paid_at: null, paid_method: '', paid_note: '', payment_for: null, deleted_at: null },
    { id: DEP, site_id: SITE.id, deal_id: DEAL, number: 12, title: 'Deposit', description: 'Deposit', amount_cents: 120000, currency: 'usd', purpose: 'deposit', status: 'open', stripe_url: null, stripe_payment_link_id: null, processing_since: null, paid_at: null, paid_method: '', paid_note: '', payment_for: null, deleted_at: null },
  ];
  world.events = []; world.patches = []; world.stripe = []; world.escaped = []; stripeMode = 'ok';
  world.notices = [{ id: 'n1', client_id: SITE.client_id, kind: 'deal_followup', period: `invremind:${INV}`, status: 'active' }];
  world.deals = [{ id: DEAL, site_id: SITE.id, stage: 'contract', contact_id: null, title: 'Website refresh' }];
  world.contracts = [{ id: 'c1', site_id: SITE.id, deal_id: DEAL, status: 'signed', deleted_at: null }];
};
const req = (path, body) => new Request(`https://example.supabase.co/functions/v1/presence${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const pay = async (id, body, today = '2026-11-11') => { const r = await handleInvoicePayment(req(`/sales/invoices/${id}/payment?today=${today}`, body), SITE, PRINCIPAL, id, CORS); return { status: r.status, body: await r.json() }; };
const undo = async (id) => { const r = await handleInvoicePaymentUndo(req(`/sales/invoices/${id}/payment/undo`, {}), SITE, PRINCIPAL, id, CORS); return { status: r.status, body: await r.json() }; };
const row = (id) => world.invoices.find((r) => r.id === id);
{
  seed();
  const r = await pay(INV, { method: 'check', paid_on: '2026-11-11', note: 'Check #1042', email_receipt: false });
  ok('all of it: 200, the invoice is paid that day, that way', r.status === 200 && row(INV).status === 'paid' && row(INV).paid_at === '2026-11-11T12:00:00.000Z' && row(INV).paid_method === 'check' && row(INV).paid_note === 'Check #1042', JSON.stringify(r.body));
  ok('all of it: the guard rides in the write (open, not settling)', world.patches.some((p) => p.table === 'presence_invoices' && /status=eq\.open/.test(p.search) && /processing_since=is\.null/.test(p.search)));
  ok('all of it: its card link is switched off, and the page is told', world.stripe.includes('/v1/payment_links/plink_13') && r.body.data.link_deactivated === true);
  ok('all of it: its reminders stop', world.notices.find((n) => n.id === 'n1').status !== 'active');
  const ev = world.events.find((e) => e.kind === 'invoice_paid');
  ok('all of it: the deal’s history says who recorded what, how', ev && ev.detail.recorded === true && ev.detail.method === 'check' && ev.detail.amount_cents === 200000 && ev.actor === 'owner@studio.example' && !ev.detail.part);
  ok('all of it: nothing escaped to the outside world', world.escaped.length === 0, world.escaped.join(' '));
  const again = await pay(INV, { method: 'cash', email_receipt: false });
  ok('a second record on a paid invoice is refused, nothing changes', again.status === 409 && again.body.error === 'already_paid' && row(INV).paid_method === 'check');
}
{
  seed(); stripeMode = 'error';
  const r = await pay(INV, { method: 'zelle', amount_cents: 50000, paid_on: '2026-11-08', email_receipt: false });
  const part = world.invoices.find((x) => x.payment_for === INV);
  ok('part of it: the payment is a paid row of its own, toward the invoice', r.status === 200 && part && part.status === 'paid' && part.amount_cents === 50000 && part.paid_method === 'zelle' && part.purpose === 'service' && /Part payment — Balance at launch/.test(part.title) && /#0013/.test(part.description), JSON.stringify(r.body));
  ok('part of it: the invoice drops by the same amount and stays open, its old link gone', row(INV).status === 'open' && row(INV).amount_cents === 150000 && row(INV).stripe_url === null && row(INV).stripe_payment_link_id === null);
  ok('part of it: the drop is guarded on the amount it had (two at once can’t both land)', world.patches.some((p) => /amount_cents=eq\.200000/.test(p.search)));
  ok('part of it: Stripe said no, so the page is told the old link may be live', r.body.data.link_deactivated === false && r.body.data.part === true && r.body.data.left_cents === 150000);
  ok('part of it: its reminders keep going (the rest is still due)', world.notices.find((n) => n.id === 'n1').status === 'active');
  ok('part of it: the history line says part, and what is left', world.events.some((e) => e.kind === 'invoice_paid' && e.detail.part === true && e.detail.left_cents === 150000));
  const u = await undo(part.id);
  ok('undo a part payment: its row goes, its amount goes back on the invoice', u.status === 200 && part.deleted_at && row(INV).amount_cents === 200000 && row(INV).status === 'open', JSON.stringify(u.body));
  ok('undo: the history keeps a line for it', world.events.some((e) => e.kind === 'payment_undone' && e.detail.part === true && e.detail.amount_cents === 50000));
}
{
  seed();
  // the invoice moves between the read and the write: the payment row is taken back off
  onPatch = (t) => { if (t === 'presence_invoices') row(INV).amount_cents = 180000; };
  const r = await pay(INV, { method: 'cash', amount_cents: 50000, email_receipt: false });
  const part = world.invoices.find((x) => x.payment_for === INV);
  ok('a race on a part payment: nothing is half-saved', r.status === 409 && part && part.deleted_at && row(INV).amount_cents === 180000, JSON.stringify(r.body));
}
{
  seed();
  await pay(INV, { method: 'cash', email_receipt: false });
  const u = await undo(INV);
  ok('undo all of it: open again, its paid facts and old link cleared', u.status === 200 && row(INV).status === 'open' && row(INV).paid_at === null && row(INV).paid_method === '' && row(INV).stripe_url === null, JSON.stringify(u.body));
  ok('undo: a payment Stripe took is never undone here', (seed(), row(INV).status = 'paid', row(INV).paid_method = '', (await undo(INV)).status === 409));
  seed();
  const part = await pay(INV, { method: 'cash', amount_cents: 50000, email_receipt: false });
  const prow = world.invoices.find((x) => x.payment_for === INV);
  row(INV).status = 'paid'; row(INV).paid_method = 'check';
  ok('undo a part payment after the rest was paid: refused, nothing changes', part.status === 200 && (await undo(prow.id)).status === 409 && !prow.deleted_at);
}
{
  seed();
  const r = await pay(DEP, { method: 'bank_transfer', email_receipt: false });
  ok('a deposit paid in full by hand wins a signed deal, as a card deposit does', r.status === 200 && r.body.data.moved === true && world.deals[0].stage === 'won' && world.events.some((e) => e.kind === 'stage_change' && e.to_stage === 'won'), JSON.stringify(r.body));
  seed();
  const p2 = await pay(DEP, { method: 'bank_transfer', amount_cents: 20000, email_receipt: false });
  ok('a deposit paid in part moves nothing', p2.status === 200 && world.deals[0].stage === 'contract');
}
{
  seed();
  const r = await pay(INV, { method: 'cash', amount_cents: 300000 });
  ok('more than due: 422 and nothing written', r.status === 422 && world.patches.length === 0 && world.events.length === 0);
  const f = await pay(INV, { method: 'cash', paid_on: '2026-11-12' }, '2026-11-11');
  ok('a day after the caller’s today: 422', f.status === 422);
  const bad = await handleInvoicePayment(req('/x', {}), SITE, PRINCIPAL, 'not-a-uuid', CORS);
  ok('a bad id: 400 before any read', bad.status === 400);
  ok('an invoice on another site is not found', (await pay('66666666-6666-4666-8666-666666666666', { method: 'cash' })).status === 404);
}

// ═══ 5. the database step (0167) ═══
{
  const mig = read('supabase/migrations/0167_invoice_payments_numbers.sql');
  const pack = read('docs/presence/APPLY-0167-prod.sql');
  const kinds = (s) => ((s.match(/presence_deal_events\s+add constraint presence_deal_events_kind_check\s+check \(kind in \(([\s\S]*?)\)\)/) || [])[1] || '').replace(/--[^\n]*/g, '').match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1)) || [];
  const k145 = kinds(read('supabase/migrations/0145_estimates_recurring_invoices.sql'));
  ok('0167: the five invoice columns, all re-runnable', ['number integer', "paid_method text not null default ''", "paid_note text not null default ''", 'payment_for uuid references public.presence_invoices(id) on delete cascade', 'lines jsonb'].every((c) => mig.includes('add column if not exists ' + c)));
  ok('0167: it adds no contact address (that is item 89’s column, read as it is)', !/presence_contacts/.test(mig) && !/presence_contacts/.test(pack));
  ok('0167: how it was paid is one of the five ways (or empty, online)', /check \(paid_method in \('', 'check', 'cash', 'bank_transfer', 'zelle', 'other'\)\)/.test(mig));
  ok('0167: one number per site, every new invoice numbered by a trigger (a part payment’s row is not)', /create unique index if not exists presence_invoices_site_number_uq\s+on public\.presence_invoices \(site_id, number\) where number is not null/.test(mig) && /if new\.number is null and new\.payment_for is null then/.test(mig) && /pg_advisory_xact_lock/.test(mig) && /create trigger presence_invoices_number before insert on public\.presence_invoices/.test(mig));
  ok('0167: the invoices already there are numbered in the order they were made, after any number given', /row_number\(\) over \(partition by i\.site_id order by i\.created_at, i\.id\)/.test(mig) && /coalesce\(max\(number\), 0\) as top/.test(mig));
  ok('0167: the deal history carries 0145’s whole list forward and adds payment_undone', k145.length === 18 && k145.every((k) => kinds(mig).includes(k)) && kinds(mig).includes('payment_undone') && kinds(mig).length === 19);
  ok('0167: the trigger’s function is out of the API roles’ reach', /revoke all on function public\.presence_invoice_number\(\) from public, anon, authenticated;/.test(mig));
  ok('0167: a rollback is written down', /-- rollback:[\s\S]*drop trigger if exists presence_invoices_number/.test(mig));
  ok('the pack: the same statements as the migration, and the same kind list', pack.includes(mig.slice(mig.indexOf('alter table public.presence_invoices\n  add column if not exists number integer,'), mig.indexOf('-- rollback:')).trim()) && JSON.stringify(kinds(pack)) === JSON.stringify(kinds(mig)));
  ok('the pack ends in a check query', /-- check: select \(select count\(\*\) from information_schema\.columns[\s\S]*as unnumbered;\s+-- 0\n$/.test(pack));
}

// ═══ 6. wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  const roles = read('supabase/functions/presence/lib/site_roles.ts');
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('index: the record and undo routes', /\\\/sales\\\/invoices\\\/\(\[0-9a-f-\]\{36\}\)\\\/payment\(\\\/undo\)\?\$/.test(idx) && /handleInvoicePaymentUndo\(req, site, principal, m\[1\], cors\) : handleInvoicePayment\(req, site, principal, m\[1\], cors\)/.test(idx));
  ok('roles: recording is edit, undoing is delete', roles.includes('`POST /sales/invoices/${ID}/(send|payment)`') && roles.includes('`POST /sales/invoices/${ID}/payment/undo`'));
  ok('the document route answers ?format=pdf as a PDF file', /const asPdf = new URL\(req\.url\)\.searchParams\.get\('format'\) === 'pdf';/.test(sales) && /'Content-Type': 'application\/pdf', 'Content-Disposition': `attachment; filename="\$\{pdfName\}"`/.test(sales));
  ok('the document route gives every page its context (from, billed to, dates, part payments)', /const ctx = await docContextFor\(tok\.site_id, tok\.k, row, \{ pdfUrl:/.test(sales) && /return htmlResp\(renderDocument\(tok\.k, data, brand, ctx\)\);/.test(sales));
  ok('the record’s document link carries the PDF’s address', /pdf_url: `\$\{fnBase\(\)\}\/functions\/v1\/presence\/sales\/doc\/\$\{encodeURIComponent\(token\)\}\?format=pdf`/.test(sales));
  const ei = sales.slice(sales.indexOf('export async function emailInvoice('), sales.indexOf('export function firstNameOf('));
  ok('invoice email: greets by first name, names the number and the due date, attaches the PDF', /Hi \$\{escH\(first\)\},/.test(ei) && /'Hi there,'/.test(ei) && /due \$\{dayLabel\(row\.due_date, ctx\?\.tz\)\}/.test(ei) && /'due on receipt'/.test(ei) && /attachments: \[\{ filename: pdfFileName\('invoice', row\), content: pdf \}\]/.test(ei) && /`\$\{title\}\$\{no \? ' ' \+ no : ''\} — \$\{amount\}`/.test(ei));
  ok('+ Invoice from the proposal stores its lines (and saves without them before the database step)', /if \(lines && lines\.length > 1\) newRow\.lines = lines;/.test(sales) && /missingInsertColumns\(ins\.json, ins\.text, \['lines'\]\)/.test(sales));
  ok('the signed copy goes with the signed agreement as a PDF', /signedPdf = \{ filename: pdfFileName\('contract', row\), content: documentPdf\('contract', data, brand, ctx\) \}/.test(sales) && /attachments: \[signedPdf\]/.test(sales));
  ok('the deal read carries the contact’s address when contacts hold one (item 89), the old read otherwise', /select=id,name,email,phone,company,notes,address&limit=1`\)\.then\(\(r\) => r\.ok \? r : svc\(`presence_contacts\?id=eq\.\$\{deal\.contact_id\}&site_id=eq\.\$\{site\.id\}&select=id,name,email,phone,company,notes&limit=1`\)\)/.test(sales) && !/patch\.address =/.test(sales));
  const acct = read('supabase/functions/presence/commerce/account.ts');
  ok('the one email sender passes attachments to Resend as base64', /attachments: opts\.attachments\.map\(\(a\) => \(\{ filename: a\.filename, content: base64Of\(a\.content\) \}\)\)/.test(acct));
  const com = read('supabase/functions/presence/routes/commerce.ts');
  ok('the card-payment receipt names the number and carries the receipt PDF', /`Payment received — thank you\$\{no \? ` \(\$\{no\}\)` : ''\}`/.test(com) && /attachments = \[\{ filename: pdfFileName\('invoice', row\), content: documentPdf\('invoice', data, brand, ctx\) \}\];/.test(com));
  const est = read('supabase/functions/presence/routes/estimates.ts');
  ok('an estimate billed as an invoice keeps its lines', /const lines = linesFromProposal\(items, computeProposalTotals\(items, meta\), meta, \[\]\);/.test(est));
  const crm = read('crm.html');
  ok('record: Record payment opens under the invoice, with the five ways and a receipt box', /function payForm\(row,v\)/.test(crm) && /\['check','Check'\],\['cash','Cash'\],\['bank_transfer','Bank transfer'\],\['zelle','Zelle'\],\['other','Other'\]/.test(crm) && /Email \$\{esc\(first\|\|'them'\)\} a receipt \(the PDF is attached\)/.test(crm) && /'\/payment\?today='\+today,'POST',\{amount_cents:a,paid_on:on,method:how/.test(crm));
  ok('record: a part payment says what stays due', /'Record '\+fmtC\(a\)\+' part payment'/.test(crm) && /stays due on \$\{no\}/.test(crm));
  ok('record: invoice numbers, how each was paid, Undo marked delete, PDF', /const no=invNo\(v\.number\)/.test(crm) && /PAY_WORDS\[v\.paid_method\]\|\|'Paid online'/.test(crm) && /data-undo-pay="\$\{esc\(v\.id\)\}" data-needs="delete"/.test(crm) && /data-pdf="invoices:\$\{esc\(v\.id\)\}"/.test(crm));
  ok('record: who invoices are billed to and where (item 89’s address), Edit opens their contact', /function billedToLine\(\)/.test(crm) && /const addrText=\(a\)=>/.test(crm) && /WANT_EDIT='ec-address';showTab\('details'\)/.test(crm) && !/id="ec-address"/.test(crm));
  const pipe = read('pipeline.html');
  ok('deal page: Record payment and Undo on the deal and in Who owes you', /function openPayForm\(rowEl,inv,refresh,who\)/.test(pipe) && (pipe.match(/data-pay-inv=/g) || []).length >= 2 && /data-needs="delete" data-undo-pay=/.test(pipe));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
