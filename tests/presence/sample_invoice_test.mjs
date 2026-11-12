// ── "Send a test invoice to myself" (builder list item 175, Nov 2026) ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sample_invoice_test.mjs
// The sample invoice is shaped like a real one and draws as one (its two lines add up, so
// the PDF lists them); the email says it is a test, goes to the person asking only, has a
// pay button that leads nowhere, and keeps the real invoice email's words, held here side
// by side with emailInvoice in routes/sales.ts so the two can't drift apart. The route
// writes nothing and is wired where the other invoice routes are, as an everyday write.
import { sampleInvoice, sampleInvoiceEmail, SAMPLE_BILL_TO, SAMPLE_INVOICE_DUE_DAYS } from '../../supabase/functions/presence/lib/sample_invoice.ts';
import { invoiceLines } from '../../supabase/functions/presence/lib/documents.ts';
import { documentPdf, pdfFileName } from '../../supabase/functions/presence/lib/doc_pdf.ts';
import { handleSampleInvoice } from '../../supabase/functions/presence/routes/sample_invoice.ts';
import { memberWriteNeeds } from '../../supabase/functions/presence/lib/site_roles.ts';

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ── the sample ──
{
  const row = sampleInvoice('2026-11-11T21:30:00Z', 'America/Los_Angeles');
  const lines = invoiceLines(row, row.amount_cents);
  ok('sample: open, no number used, issued now', row.status === 'open' && row.number === null && row.created_at === '2026-11-11T21:30:00Z');
  ok('sample: its two lines add up to its amount, so the PDF lists them', lines.length === 2 && lines.reduce((n, l) => n + l.amount_cents, 0) === row.amount_cents);
  ok('sample: due two weeks after today on the studio’s clock', row.due_date === '2026-11-25' && SAMPLE_INVOICE_DUE_DAYS === 14);
  ok('sample: late evening in Los Angeles is still that day there', sampleInvoice('2026-11-12T06:30:00Z', 'America/Los_Angeles').due_date === '2026-11-25');
  ok('sample: a zone that isn’t one falls back to Los Angeles, never throws', sampleInvoice('2026-11-12T06:30:00Z', 'Mars/Olympus').due_date === '2026-11-25');
  ok('sample: billed to a stand-in, never a real customer', SAMPLE_BILL_TO.name === 'Your customer’s name' && !SAMPLE_BILL_TO.email);
  const pdf = documentPdf('invoice', row, { name: 'Brightline Studio', accent: '#5b3fa0', accentDark: '#3a2470' }, { studio: { name: 'Brightline Studio', email: 'hello@example.com', phone: '', address: '' }, billTo: SAMPLE_BILL_TO, tz: 'America/Los_Angeles', payments: [] });
  ok('sample: it draws as a real invoice PDF', pdf instanceof Uint8Array && new TextDecoder().decode(pdf.slice(0, 5)) === '%PDF-');
  ok('sample: its file name says what it is', /^Invoice-Test-invoice\.pdf$/.test(pdfFileName('invoice', row)), pdfFileName('invoice', row));
}

// ── the email ──
{
  const e = sampleInvoiceEmail({ studioName: 'Brightline Studio', accent: '#5b3fa0', amountCents: 45000, dueLabel: 'Nov 25, 2026', title: 'Test invoice', pdf: true });
  ok('email: the subject says it is a test, then reads like the real one', e.subject === '[Test] Test invoice — $450.00', e.subject);
  ok('email: the note on top says it went to you only and nothing can be paid', e.html.startsWith('<p') && e.html.includes('<strong>This is a test.</strong>') && e.html.includes('sent only to you') && e.html.includes('nothing can be paid'));
  ok('email: the pay button is drawn but leads nowhere', e.html.includes('Pay $450.00 securely →') && !/<a\s/i.test(e.html));
  ok('email: a line under it says what a real one does', e.html.includes('this button opens Stripe’s secure page for the amount'));
  ok('email: the studio’s name, the amount and the due date', e.html.includes('Brightline Studio has sent you an invoice (Test invoice) for <strong>$450.00</strong>, due Nov 25, 2026.'));
  ok('email: a studio with no name of its own yet reads "Here is"', sampleInvoiceEmail({ studioName: '', accent: '#5b3fa0', amountCents: 45000, dueLabel: '', title: 'Test invoice', pdf: false }).html.includes('Here is an invoice (Test invoice) for <strong>$450.00</strong>, due on receipt.'));
  ok('email: the PDF line only when a PDF goes with it', e.html.includes('The invoice is attached as a PDF.') && !sampleInvoiceEmail({ studioName: '', accent: '#5b3fa0', amountCents: 1, dueLabel: '', title: 'x', pdf: false }).html.includes('attached as a PDF'));
  ok('email: a name with markup in it is shown, not run', sampleInvoiceEmail({ studioName: '<b>Shop</b>', accent: '#5b3fa0', amountCents: 100, dueLabel: '', title: 'T', pdf: false }).html.includes('&lt;b&gt;Shop&lt;/b&gt; has sent you'));
  // the real invoice email's words, so a change there shows up here
  const sales = read('supabase/functions/presence/routes/sales.ts');
  const real = sales.slice(sales.indexOf('export async function emailInvoice'), sales.indexOf('export function firstNameOf'));
  ok('mirror: the real email still says "has sent you" and "Here is"', real.includes('`${who} has sent you`') && real.includes("'Here is'"));
  ok('mirror: the real email still ends its sentence the same way', real.includes('. You can pay securely here — nothing else needed.</p>') && e.html.includes('. You can pay securely here — nothing else needed.</p>'));
  ok('mirror: the real button still reads "Pay … securely →"', real.includes('>Pay ${amount} securely →</a>'));
  ok('mirror: the real email is still transactional, from the studio in its name', /critical: true, asBusiness: true, siteId/.test(real));
}

// ── the route ──
{
  const src = read('supabase/functions/presence/routes/sample_invoice.ts');
  ok('route: it writes nothing (no table read or write of its own)', !/\bsvc\(/.test(src) && !/method: '(POST|PATCH|DELETE)'/.test(src));
  ok('route: it sends to the person asking, and nobody else', /const to = String\(principal\.email \|\| ''\)\.trim\(\);/.test(src) && (src.match(/sendEmail\(/g) || []).length === 1 && /sendEmail\(to, subject, html, brand/.test(src));
  ok('route: sent the way a real invoice is', /\{ critical: true, asBusiness: true, siteId: site\.id/.test(src));
  ok('route: it says whether real invoices can go out yet', /stripe: stripeConfigured\(\)/.test(src));
  const res = await handleSampleInvoice({ id: '00000000-0000-0000-0000-000000000001' }, { email: '' }, {});
  const body = await res.json();
  ok('route: a sign-in with no email is told so, and nothing is read or sent', res.status === 400 && /no email/.test(body.message));
  const idx = read('supabase/functions/presence/index.ts');
  ok('wiring: POST /sales/invoices/test reaches it', /if \(route === '\/sales\/invoices\/test' && method === 'POST'\) return \(await import\('\.\/routes\/sample_invoice\.ts'\)\)\.handleSampleInvoice\(site, principal, cors\);/.test(idx));
  ok('wiring: it sits with the other invoice routes, inside the studio’s sales block', idx.indexOf("'/sales/invoices/test'") > idx.indexOf('/^\\/sales\\/invoices\\/([0-9a-f-]{36})\\/void$/'));
  ok('members: an everyday write, like Send me a test on an update', memberWriteNeeds('/sales/invoices/test', 'POST') === 'edit' && memberWriteNeeds('/broadcasts/00000000-0000-0000-0000-000000000001/test', 'POST') === 'edit');
}

const passed = results.filter(Boolean).length;
console.log(`\n════ SAMPLE INVOICE (item 175): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
