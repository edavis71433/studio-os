// Sales item 125: the documents a studio's customers see wear the product's new look.
//   deno run --allow-read --allow-env tests/presence/document_look_test.mjs
// Every document page, every PDF, the email frame and the two pay pages: a band in the
// studio's own colour with its logo or mark and its name, the title and the number that
// matters, white cards below. Pure: no database, no network. The amounts, numbering,
// signing and paying are held by the suites that already cover them
// (documents_test, invoice_payments_test, agreement_layout_test, proposal_schedule_test);
// this one holds the look, and that the look never moves a number.
import {
  renderDocument, renderInvoiceDocument, renderProposalDocument, renderEstimateDocument, renderContractDocument,
  mixHex, bandColors, money,
} from '../../supabase/functions/presence/lib/documents.ts';
import { documentPdf, invoicePdf, contractPdf } from '../../supabase/functions/presence/lib/doc_pdf.ts';
import { brandEmailShell, emailBand, emailFacts } from '../../supabase/functions/presence/lib/email_brand.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p) => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const dec = (u8) => new TextDecoder().decode(u8);
const count = (s, re) => (s.match(re) || []).length;

const brand = { name: 'Brightline Studio', accent: '#b4532a', accentDark: '#8a3d1d' };
const ctx = {
  studio: { address: '12 Harbor Street\nPortland, OR 97204', email: 'hello@brightline.example' },
  billTo: { name: 'Sam Lee', company: 'Corner Café', address: '88 Oak Avenue' },
  tz: 'America/Los_Angeles', pdfUrl: 'https://example.supabase.co/x?format=pdf', pdfName: 'x.pdf', forWhat: 'Website refresh',
};
const items = [{ label: 'Design', qty: 1, unit_cents: 320000 }, { label: 'Photos', qty: 2, unit_cents: 45000 }];
const invoice = { number: 13, title: 'Website refresh, part 2 of 3', amount_cents: 97500, currency: 'usd', purpose: 'service', status: 'open', created_at: '2026-11-04T18:00:00Z', due_date: '2026-11-18', stripe_url: 'https://pay.example/inv13' };
const paid = { ...invoice, status: 'paid', stripe_url: null, paid_at: '2026-11-11T17:20:00Z', paid_method: 'check', paid_note: 'Check #1042' };
const payments = [{ amount_cents: 50100, paid_at: '2026-11-08T19:00:00Z', paid_method: 'zelle', paid_note: 'ref 8841' }];
const body = 'PROJECT AGREEMENT\n\n1. SCOPE OF WORK\n\nThe studio builds the pages.\n\n2. PAYMENT TERMS\n\nPaid in parts.\n\n3. TIMELINE\n\nThree weeks.';
const signed = { title: 'Website refresh agreement', body, status: 'signed', signer_name: 'Sam Lee', signer_email: 'sam@cornercafe.example', signed_at: '2026-11-06T21:14:09Z', countersigned_name: 'Alex Rivera', countersigned_title: 'Owner', countersigned_at: '2026-11-06T21:14:09Z', content_hash: 'ab'.repeat(32), signed_evidence: { ip_hash: 'a1b2c3' } };
const every = {
  proposal: renderProposalDocument({ title: 'Website refresh', line_items: items, currency: 'usd', status: 'sent', terms: 'Good for 30 days.' }, brand, ctx),
  estimate: renderEstimateDocument({ title: 'Menu page', line_items: items, currency: 'usd', status: 'sent', expires_at: '2026-12-20' }, brand, ctx),
  invoice: renderInvoiceDocument(invoice, brand, { ...ctx, payments }),
  deposit: renderInvoiceDocument({ ...invoice, purpose: 'deposit', title: 'Deposit' }, brand, ctx),
  receipt: renderInvoiceDocument(paid, brand, { ...ctx, payments }),
  voided: renderInvoiceDocument({ ...invoice, status: 'void' }, brand, ctx),
  agreement: renderContractDocument({ title: 'Website refresh agreement', body, status: 'sent' }, brand, ctx),
  signed: renderContractDocument(signed, brand, ctx),
};

// ═══ 1. the band's colours ═══
{
  ok('mixHex: halfway between two colours, and the ends', mixHex('#000000', '#ffffff', 0.5) === '#808080' && mixHex('#b4532a', '#ffffff', 0) === '#b4532a' && mixHex('#b4532a', '#ffffff', 1) === '#ffffff');
  ok('mixHex: short colours work; a colour it cannot read comes back as it is', mixHex('#fff', '#000', 1) === '#000000' && mixHex('rebeccapurple', '#000000', 0.5) === 'rebeccapurple');
  const b = bandColors(brand);
  ok('the band runs from a deep tone of the studio’s colour to the colour itself', b.to === '#b4532a' && b.from === mixHex('#8a3d1d', '#140c1f', 0.3) && b.from !== b.to);
}

// ═══ 2. every document page wears the band ═══
for (const [name, html] of Object.entries(every)) {
  const band = html.slice(html.indexOf('<header class="band">'), html.indexOf('</header>'));
  ok(`${name}: one band, in the studio’s colours, with its mark and name`, count(html, /<header class="band">/g) === 1 && html.includes('--band-b:#b4532a') && html.includes(`--band-a:${bandColors(brand).from}`) && band.includes('<span class="mark" aria-hidden="true">B</span><span class="wordmark">Brightline Studio</span>'));
  ok(`${name}: the band says what it is and carries the one title`, /<div class="kicker"><div class="doclabel">[^<]+<\/div>/.test(band) && count(html, /<h1>/g) === 1 && band.includes('<h1>'));
  ok(`${name}: Print and Download PDF sit in the band, off paper`, band.includes('<div class="toolbar no-print">') && band.includes('id="dlpdf">Download PDF</button>') && band.includes('onclick="window.print()">Print</button>'));
  ok(`${name}: the product’s own fonts, by a link on the same host only`, html.includes('<link rel="stylesheet" href="/fonts/brand.css">') && html.includes('"Fraunces"') && html.includes('"Inter"') && !/(src|href)="https?:\/\/(?!pay\.example|example\.supabase\.co)/.test(html));
  ok(`${name}: paper keeps the band’s colour and drops the buttons, the side card and the pay bar`, /@media print\{[\s\S]*\.no-print,\.toolbar,\.aside,\.rail,\.paybar\{display:none!important\}/.test(html) && /\.band\{[^}]*print-color-adjust:exact/.test(html));
  ok(`${name}: a phone gets one column`, /@media \(max-width:980px\)\{\s*\.body\.cols,\.body\.railed\{grid-template-columns:minmax\(0,1fr\)\}/.test(html) && html.includes('<meta name="viewport" content="width=device-width,initial-scale=1">'));
}

// ═══ 3. what each band says ═══
{
  const bandOf = (html) => html.slice(html.indexOf('<header class="band">'), html.indexOf('</header>'));
  ok('invoice: its number, who it is for, the dates, the amount due and when', bandOf(every.invoice).includes('<div class="doclabel">Invoice #0013</div><span>· For Corner Café</span>') && bandOf(every.invoice).includes('Issued Nov 4, 2026 · Due Nov 18, 2026') && bandOf(every.invoice).includes(`<div class="flbl">Amount due</div><div class="n">${money(97500)}</div><div><span class="pill due">Due Nov 18, 2026</span>`));
  ok('deposit request: says so', bandOf(every.deposit).includes('<div class="doclabel">Deposit request #0013</div>'));
  ok('receipt: total paid (the part payment counted), and paid in full', bandOf(every.receipt).includes('<div class="doclabel">Receipt #0013</div>') && bandOf(every.receipt).includes(`<div class="flbl">Total paid</div><div class="n">${money(97500 + 50100)}</div>`) && bandOf(every.receipt).includes('<span class="pill paid">✓ Paid in full</span>') && bandOf(every.receipt).includes('Paid Nov 11, 2026'));
  ok('voided invoice: says voided, offers no way to pay', bandOf(every.voided).includes('<span class="pill void">Voided</span>') && !every.voided.includes('class="paylink"') && !every.voided.includes('class="paybar'));
  ok('proposal and estimate: the total, and the estimate’s good-until', bandOf(every.proposal).includes(`<div class="flbl">Total</div><div class="n">${money(410000)}</div>`) && bandOf(every.estimate).includes('<span class="pill due">Good until Dec 20, 2026</span>'));
  ok('an accepted proposal and an approved estimate say so in the band', bandOf(renderProposalDocument({ title: 'x', line_items: items, status: 'accepted' }, brand)).includes('<span class="pill paid">Accepted</span>') && bandOf(renderEstimateDocument({ title: 'x', line_items: items, status: 'approved' }, brand)).includes('<span class="pill paid">Approved</span>'));
  ok('agreement: between whom, and where it stands', bandOf(every.agreement).includes('<div class="doclabel">Agreement</div><span>· Between Brightline Studio and Corner Café</span>') && bandOf(every.agreement).includes('<span class="pill due">Waiting for a signature</span>') && bandOf(every.signed).includes('<div class="doclabel">Signed agreement</div>') && bandOf(every.signed).includes('<span class="pill paid">✓ Signed by both</span>'));
  // sales item 118 in the new layout: a bank payment that is settling has no way to pay, anywhere on the page
  const settling = renderInvoiceDocument({ ...invoice, processing_since: '2026-11-10T12:00:00Z' }, brand, ctx);
  ok('a settling invoice: the band, the side card and the lines all say "Payment on its way"; no pay button, no pay bar', bandOf(settling).includes('<span class="pill due">Payment on its way</span>') && bandOf(settling).includes('<div class="flbl">Payment on its way</div>') && bandOf(settling).includes('Issued Nov 4, 2026 · Payment on its way') && settling.includes('<aside class="aside no-print"><div class="lbl">Payment on its way</div>') && !settling.includes('class="paylink"') && !settling.includes('<div class="paybar') && !settling.includes('<body class="has-paybar">') && !settling.replace(/<style>[\s\S]*?<\/style>/, '').includes('Amount due'));
  ok('signed by the client only: "Signed", not "by both"', bandOf(renderContractDocument({ ...signed, countersigned_name: null }, brand, ctx)).includes('<span class="pill paid">✓ Signed</span>'));
}

// ═══ 4. the cards ═══
{
  const inv = every.invoice, rc = every.receipt;
  ok('invoice: From, Billed to and Details side by side', inv.includes('<div class="k">From</div><div class="first">Brightline Studio</div><div>12 Harbor Street</div>') && inv.includes('<div class="k">Billed to</div><div class="first">Sam Lee</div>') && inv.includes('<div class="k">Details</div><div class="first">Invoice no. #0013</div>') && inv.includes('<div>For Website refresh</div>'));
  ok('invoice: the side card has the amount, what is already paid, the pay button and the PDF', /<aside class="aside no-print"><div class="lbl">Amount due<\/div><div class="n">\$975\.00<\/div><p>Due Nov 18, 2026\. \$501\.00 of \$1,476\.00 is already paid\.<\/p><a class="paylink" href="https:\/\/pay\.example\/inv13">Pay \$975\.00 securely →<\/a>/.test(inv) && inv.includes('data-dlpdf>Download PDF</button>'));
  ok('invoice on a phone: a bar at the bottom with PDF and Pay; only an invoice that can be paid has one', inv.includes('<body class="has-paybar">') && /<div class="paybar no-print"><button type="button" class="btn" data-dlpdf>PDF<\/button><a class="paylink" href="https:\/\/pay\.example\/inv13">/.test(inv) && !rc.includes('<body class="has-paybar">') && !every.proposal.includes('<div class="paybar') && !renderInvoiceDocument({ ...invoice, stripe_url: null }, brand, ctx).includes('<div class="paybar'));
  ok('every Download button is wired, whichever one is pressed', inv.includes("document.querySelectorAll('[data-dlpdf]')") && count(inv, /data-dlpdf/g) >= 3);
  ok('receipt: a green banner, and how it was paid, part by part', rc.includes('<div class="banner"><span class="dot" aria-hidden="true">✓</span><div><b>Paid in full. Thank you.</b>Paid Nov 11, 2026 by check · Check #1042 · with 1 earlier part payment: Paid Nov 8, 2026 by Zelle · ref 8841</div></div>') && /<div class="lbl">How it was paid<\/div><div class="row"><span>Nov 8, 2026<small>Zelle · ref 8841<\/small><\/span><span>\$501\.00<\/span><\/div><div class="row"><span>Nov 11, 2026<small>Check · Check #1042<\/small><\/span><span>\$975\.00<\/span><\/div><div class="sum"><span>Total paid<\/span><span>\$1,476\.00<\/span><\/div>/.test(rc) && rc.includes('data-dlpdf>Download the receipt</button>') && rc.includes('<div class="k">Paid by</div>'));
  ok('proposal: who it is from and for, what is included, good to know, and a total card', every.proposal.includes('<div class="k">Prepared for</div><div class="first">Sam Lee</div>') && every.proposal.includes('What’s included') && every.proposal.includes('Good to know</div><p class="terms">Good for 30 days.</p>') && /<aside class="aside no-print"><div class="lbl">Total<\/div><div class="n">\$4,100\.00<\/div>/.test(every.proposal));
  ok('a document with no context still draws (no parties, no side-card PDF button)', (() => { const h = renderDocument('proposal', { title: 'x', line_items: items }); return h.includes('<header class="band">') && !h.includes('<div class="parties">') && h.includes('Save as PDF / Print') && !h.includes('data-dlpdf'); })());
  const sg = every.signed;
  ok('signed agreement: a contents list beside the text that jumps to each section, the signatures and the certificate', /<nav class="rail no-print" aria-label="In this agreement">/.test(sg) && sg.includes('<b>1</b>SCOPE OF WORK</a>') && sg.includes('<a href="#signatures">Signatures</a><a href="#certificate">Certificate of record</a>') && sg.includes('<h2 class="sigh" id="signatures">Signatures</h2>') && sg.includes('<div class="cert" id="certificate"><h2>Certificate of record</h2>') && [...sg.matchAll(/<nav[\s\S]*?<\/nav>/g)][0][0].match(/href="#([^"]+)"/g).every((h) => sg.includes(`id="${h.slice(7, -1)}"`)));
  ok('an unsigned agreement lists its sections but no signatures or certificate; a short one has no list', /<nav class="rail no-print"/.test(every.agreement) && !every.agreement.includes('href="#signatures"') && !/<nav class="rail/.test(renderContractDocument({ title: 'x', body: 'One paragraph.', status: 'sent' }, brand)));
  ok('the certificate is a dark card in the studio’s tone that keeps its colour on paper', /\.cert\{[^}]*background:var\(--band-a\);color:#fff[^}]*print-color-adjust:exact/.test(sg));
}

// ═══ 5. the studio’s logo ═══
{
  const withLogo = renderInvoiceDocument(invoice, { ...brand, logoUrl: 'https://store.example/sign/logo.png?token=abc' }, ctx);
  ok('a logo sits on a white chip in the band, beside the name', withLogo.includes('<span class="logochip"><img src="https://store.example/sign/logo.png?token=abc" alt=""></span><span class="wordmark">Brightline Studio</span>') && !withLogo.includes('<span class="mark"'));
  ok('a logo that is not https is ignored; a hostile one is escaped', !renderInvoiceDocument(invoice, { ...brand, logoUrl: 'javascript:alert(1)' }, ctx).includes('<img') && !renderInvoiceDocument(invoice, { ...brand, logoUrl: 'https://x/a.png"><script>1</script>' }, ctx).includes('"><script>1'));
  ok('the mark is the first letter or digit of the name', renderDocument('proposal', { title: 'x', line_items: [] }, { ...brand, name: '“Ünder” Studio' }).includes('<span class="mark" aria-hidden="true">Ü</span>'));
}

// ═══ 6. the look never moves a number ═══
{
  const plain = (h) => h.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
  ok('invoice: every amount on the page is one of the invoice’s own', (plain(every.invoice).match(/\$[\d,]+\.\d\d/g) || []).every((a) => ['$975.00', '$501.00', '$1,476.00'].includes(a)));
  ok('receipt: the same, with the total paid', (plain(every.receipt).match(/\$[\d,]+\.\d\d/g) || []).every((a) => ['$975.00', '$501.00', '$1,476.00'].includes(a)));
  ok('proposal: lines and total only', (plain(every.proposal).match(/\$[\d,]+\.\d\d/g) || []).every((a) => ['$3,200.00', '$900.00', '$4,100.00'].includes(a)));
  ok('the pay link is the invoice’s own, and only an unpaid invoice has one', count(every.invoice, /href="https:\/\/pay\.example\/inv13"/g) === 2 && !every.receipt.includes('pay.example'));
}

// ═══ 7. the PDFs ═══
{
  const inv = dec(invoicePdf(invoice, brand, { ...ctx, payments }));
  // #b4532a as the PDF writes a fill colour
  const band = /([\d.]+) ([\d.]+) ([\d.]+) rg 0 [\d.]+ 612 [\d.]+ re f/.exec(inv);
  ok('invoice PDF: opens with a band in the studio’s colour, edge to edge', band && Math.abs(Number(band[1]) - 0xb4 / 255) < 0.01 && Math.abs(Number(band[2]) - 0x53 / 255) < 0.01 && Math.abs(Number(band[3]) - 0x2a / 255) < 0.01);
  ok('invoice PDF: the band carries the mark, the name, what it is, the title and the amount due', inv.includes('(B)') && inv.includes('(Brightline Studio)') && inv.includes('(INVOICE FOR CORNER CAF\\311  #0013)') && inv.includes('(Website refresh, part 2 of 3)') && inv.includes('(AMOUNT DUE)') && inv.includes('($975.00)'));
  ok('invoice PDF: From, Billed to, Details', inv.includes('(FROM)') && inv.includes('(BILLED TO)') && inv.includes('(DETAILS)') && inv.includes('(12 Harbor Street)') && inv.includes('(For Website refresh)'));
  const rc = dec(invoicePdf(paid, brand, { ...ctx, payments }));
  ok('receipt PDF: total paid, paid in full, paid by', rc.includes('(TOTAL PAID)') && rc.includes('($1,476.00)') && rc.includes('(PAID IN FULL)') && rc.includes('(PAID BY)'));
  const long = dec(contractPdf({ ...signed, body: 'Clause.\n\n'.repeat(300) }, brand, ctx));
  ok('agreement PDF: later pages carry a small running head; the certificate has its own box', count(long, /\(SIGNED AGREEMENT \\267 WEBSITE REFRESH AGREEMENT\)/g) >= 2 && long.includes('(Certificate of record)') && long.includes('(SIGNED BY BOTH)'));
  for (const kind of ['proposal', 'estimate', 'invoice', 'contract']) {
    const row = kind === 'invoice' ? invoice : kind === 'contract' ? signed : { title: 'Website refresh', line_items: items, status: 'sent' };
    const a = documentPdf(kind, row, brand, ctx), b = documentPdf(kind, row, brand, ctx);
    ok(`${kind} PDF: a well-formed file, the same bytes for the same input, nothing embedded`, dec(a).startsWith('%PDF-1.4\n') && dec(a).endsWith('%%EOF\n') && dec(a) === dec(b) && !/FontFile|\/Image/.test(dec(a)));
  }
}

// ═══ 8. the email frame ═══
{
  const b = { ...brand, address: '12 Harbor Street, Portland, OR 97204' };
  const plain = brandEmailShell('<p>Hello</p>', b, { asBusiness: true });
  ok('email: the card opens with a band in the brand’s colour carrying its name', /<td bgcolor="#b4532a" style="background:#b4532a;[^"]*"><div style="[^"]*font-size:19px;color:#ffffff[^"]*">Brightline Studio<\/div><\/td>/.test(plain) && plain.includes('<p>Hello</p>'));
  const banded = brandEmailShell(`${emailBand('Invoice #0013', 'Website refresh')}<p>Hello</p>`, b, { asBusiness: true });
  ok('email: a headline set with emailBand is lifted into the band, and is not left in the body', /text-transform:uppercase[^"]*">Invoice #0013<\/div><div style="[^"]*font-size:26px[^"]*">Website refresh<\/div><\/td>/.test(banded) && !banded.includes('<!--band:') && banded.includes('<p>Hello</p>'));
  ok('emailBand: escaped, cannot close its own comment, and nothing for an empty title', emailBand('<b>', 'a --> <script>') === '<!--band:&lt;b&gt;\u001fa &#45;&#45;&gt; &lt;script&gt;-->' && emailBand('x', '') === '' && !brandEmailShell(`${emailBand('k', 'a --> <script>alert(1)</script>')}<p>x</p>`, b).includes('<script>'));
  ok('email: a band marker that is not first stays inert', !/font-size:26px/.test(brandEmailShell(`<p>Hello</p>${emailBand('k', 't')}`, b)));
  const facts = emailFacts([['Due', 'Nov 18, 2026'], ['Amount due', '$975.00'], ['Skipped', '']], { big: true });
  ok('emailFacts: a box of rows, the last one large, empty rows dropped, every style inline', count(facts, /<tr><td style="padding:5px/g) === 2 && /font-size:22px;font-weight:600">\$975\.00<\/td>/.test(facts) && facts.includes('>Due</td>') && !facts.includes('Skipped') && !/class=/.test(facts) && emailFacts([]) === '');
  ok('emailFacts: escaped; the green tone for paid and signed', emailFacts([['<i>', '<b>']]).includes('&lt;i&gt;') && emailFacts([['Paid', 'Nov 11']], { tone: 'good' }).includes('background:#e7f1ea'));
  ok('email with a logo: on a white chip in the band, the name as its alt text', /<img src="https:\/\/store\.example\/l\.png" alt="Brightline Studio" style="[^"]*background:#ffffff/.test(brandEmailShell('<p>x</p>', { ...b, logoUrl: 'https://store.example/l.png' })));
  const sales = read('supabase/functions/presence/routes/sales.ts'), com = read('supabase/functions/presence/routes/commerce.ts');
  ok('the document emails set their band: proposal, agreement, the one link, invoice, signed copy, receipt', count(sales, /emailBand\(/g) === 4 && /emailBand\(`\$\{isDeposit \? 'Deposit request' : 'Invoice'\}\$\{no \? ' ' \+ no : ''\}`, title\)/.test(sales) && /emailBand\('Signed agreement', 'Your signed copy'\)/.test(sales) && /emailBand\(`Receipt\$\{no \?/.test(com));
  ok('the invoice email and the receipt carry their facts box', /emailFacts\(\[\['Due', row\?\.due_date \? dayLabel\(row\.due_date, ctx\?\.tz\) : 'On receipt'\], \['Amount due', amount\]\], \{ big: true \}\)/.test(sales) && /emailFacts\(\[\[isDeposit \? 'Deposit' : 'Invoice', `\$\{what\}\$\{no \? ` \$\{no\}` : ''\}`\], \['Amount paid', amount\]\], \{ big: true, tone: 'good' \}\)/.test(com));
}

// ═══ 9. the two pay pages ═══
for (const [file, seal] of [['payment-success.html', '#2f6a4a'], ['payment-canceled.html', '#775d31']]) {
  const html = read(file);
  ok(`${file}: a band, then the card with its round seal`, html.includes('<div class="band"><div class="studio" id="studio"></div></div>') && html.includes('<div class="wrap"><div class="card">') && html.includes(`--seal:${seal}`) && /\.mark \{[^}]*border-radius:50%/.test(html));
  ok(`${file}: the band takes the studio’s name and colour from this browser, a colour only when it is a plain hex`, html.includes("localStorage.getItem('dds-studio-brand')") && html.includes("/^#[0-9a-f]{6}$/i.test(b.accent || '')") && html.includes("root.setProperty('--band-b', hex)") && /t\.textContent = name;/.test(html) && !/innerHTML = name|innerHTML=name/.test(html));
  ok(`${file}: its ids and the product’s fonts are as they were`, html.includes('id="cta"') && html.includes('<link rel="stylesheet" href="/fonts/brand.css">') && html.includes("'Fraunces'") && html.includes('prefers-color-scheme:dark'));
  ok(`${file}: tags balance`, count(html, /<div\b/g) === count(html, /<\/div>/g));
}

// ═══ 10. the pages the browser check opens are the renderer's own ═══
// tests/e2e/document-look.spec.ts opens these three in a real browser (phone and desktop,
// paper too). They are what the renderer draws for the made-up data above, kept in step here:
//   deno run --allow-read --allow-env --allow-write tests/presence/document_look_test.mjs --update-fixtures
{
  const FIXTURES = { invoice: every.invoice, receipt: every.receipt, 'agreement-signed': every.signed };
  for (const [name, html] of Object.entries(FIXTURES)) {
    const url = new URL(`tests/e2e/fixtures/document-look/${name}.html`, ROOT);
    if (Deno.args.includes('--update-fixtures')) { Deno.mkdirSync(new URL('.', url), { recursive: true }); Deno.writeTextFileSync(url, html); }
    let onDisk = ''; try { onDisk = Deno.readTextFileSync(url); } catch { /* missing */ }
    ok(`browser fixture ${name}.html is what the renderer draws today`, onDisk === html);
  }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DOCUMENT LOOK: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
