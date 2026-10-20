// ── Oct 2026 benchmark, items 1 + 2: money in four states, one formula ──────
//   deno run --allow-read tests/presence/money_state_test.mjs
// Paid · Processing · Upcoming · Overdue come from ONE function,
// supabase/functions/presence/lib/money_state.ts. The three pages that render
// money (client.html, today.html, crm.html) have no bundler, so each carries a
// VERBATIM JS mirror. This suite imports the module, extracts every page's
// copy, pins the copies byte-identical to each other, and runs ONE case table
// against all four — so a drift in any copy fails here, not in a client's
// Invoices tab. Structural pins lock the wiring: the routes attach `state`,
// the pay link returns to /client.html?paid=, the webhook stamps Processing
// instead of lying "paid" on an unsettled session, and the reminder sweep
// skips a settling payment.
import { moneyState, MONEY_WORD, MONEY_TONE, moneyBuckets } from '../../supabase/functions/presence/lib/money_state.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ── the mirrors: extracted from each page, evaluated, compared ──
const BLOCK = /function moneyState\(i,todayYmd,pending\)\{[\s\S]*?\n\}\nconst MONEY_WORD=[^\n]*\nconst MONEY_TONE=[^\n]*\nfunction moneyBuckets\(list,todayYmd,pending\)\{[\s\S]*?\n  return b;\n\}/;
const pages = {};
for (const f of ['client.html', 'today.html', 'crm.html']) {
  const m = BLOCK.exec(read(f));
  ok(`${f}: carries the verbatim moneyState / MONEY_WORD / MONEY_TONE / moneyBuckets mirror`, !!m);
  if (m) pages[f] = { src: m[0], fns: new Function(m[0] + ';return {moneyState,MONEY_WORD,MONEY_TONE,moneyBuckets};')() };
}
const srcs = Object.values(pages).map((p) => p.src);
ok('the three page mirrors are byte-identical to each other', srcs.length === 3 && srcs.every((s) => s === srcs[0]));
// the module's body, with its TS signatures reduced to the JS ones, must equal the page copy
const lib = read('supabase/functions/presence/lib/money_state.ts')
  .replace(/^\/\*\*[\s\S]*?\*\/\n/gm, '')   // the doc comments between the exports
  .replace(/export function moneyState\([^)]*\)[^{]*\{/, 'function moneyState(i,todayYmd,pending){')
  .replace(/export const MONEY_WORD[^=]*= ?/, 'const MONEY_WORD=')
  .replace(/export const MONEY_TONE[^=]*= ?/, 'const MONEY_TONE=')
  .replace(/export function moneyBuckets\([^)]*\)[^{]*\{/, 'function moneyBuckets(list,todayYmd,pending){')
  .replace(/const b: MoneyBuckets=/, 'const b=');
const libBlock = BLOCK.exec(lib);
ok('lib/money_state.ts: its body (types aside) IS the page mirror', !!libBlock && !!srcs[0] && libBlock[0] === srcs[0]);

// ── one case table, four implementations ──
const T = '2026-10-20';
const CASES = [
  ['null row → no state', [null, T], ''],
  ['paid wins over everything', [{ status: 'paid', due_date: '2020-01-01', processing_since: '2026-10-19T00:00:00Z' }, T], 'paid'],
  ['void → no money state', [{ status: 'void', due_date: '2020-01-01' }, T], ''],
  ['canceled → no money state', [{ status: 'canceled' }, T], ''],
  ['processing_since stamped (ACH settling) → processing, even when overdue', [{ status: 'open', due_date: '2020-01-01', processing_since: '2026-10-19T00:00:00Z' }, T], 'processing'],
  ['the browser just paid it (pending id) → processing', [{ id: 'v2', status: 'open', due_date: '2020-01-01' }, T, ['v2']], 'processing'],
  ['pending id of ANOTHER invoice → not processing', [{ id: 'v3', status: 'open', due_date: '2020-01-01' }, T, ['v2']], 'overdue'],
  ['pending matches by string (ids compare as text)', [{ id: 7, status: 'open' }, T, ['7']], 'processing'],
  ['open, due yesterday → overdue', [{ status: 'open', due_date: '2026-10-19' }, T], 'overdue'],
  ['open, due today → upcoming (due today is not late)', [{ status: 'open', due_date: '2026-10-20' }, T], 'upcoming'],
  ['open, due tomorrow → upcoming', [{ status: 'open', due_date: '2026-10-21' }, T], 'upcoming'],
  ['open, no due date → upcoming', [{ status: 'open', due_date: null }, T], 'upcoming'],
  ['no status at all (receivables items) → open → by date', [{ due_date: '2026-10-01' }, T], 'overdue'],
  ['a timestamp due_date compares by its date part only', [{ status: 'open', due_date: '2026-10-19T23:59:59Z' }, T], 'overdue'],
  ['junk due_date → upcoming, never overdue', [{ status: 'open', due_date: 'soon' }, T], 'upcoming'],
  ['no today → never overdue (the caller forgot its calendar)', [{ status: 'open', due_date: '2020-01-01' }, ''], 'upcoming'],
  ['the caller\'s calendar decides: due 2026-10-20 is overdue only once today is the 21st', [{ status: 'open', due_date: '2026-10-20' }, '2026-10-21'], 'overdue'],
];
for (const [name, args, want] of CASES) {
  const got = [moneyState(...args), ...Object.values(pages).map((p) => p.fns.moneyState(...args))];
  ok(`moneyState: ${name}`, got.every((g) => g === want), `want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}
ok('MONEY_WORD: the four words, exactly', JSON.stringify(MONEY_WORD) === JSON.stringify({ paid: 'Paid', processing: 'Processing', upcoming: 'Upcoming', overdue: 'Overdue' })
  && Object.values(pages).every((p) => JSON.stringify(p.fns.MONEY_WORD) === JSON.stringify(MONEY_WORD)));
ok('MONEY_TONE: one colour family per state — good · info · neutral · bad', JSON.stringify(MONEY_TONE) === JSON.stringify({ paid: 'good', processing: 'info', upcoming: '', overdue: 'bad' })
  && Object.values(pages).every((p) => JSON.stringify(p.fns.MONEY_TONE) === JSON.stringify(MONEY_TONE)));

// buckets: cents or dollars in, counts + cents out; voided rows count nowhere
const LIST = [
  { id: 'a', status: 'paid', amount_cents: 120000 },
  { id: 'b', status: 'open', due_date: '2026-10-01', amount_cents: 90000 },        // overdue
  { id: 'c', status: 'open', due_date: '2026-11-01', amount: 800 },               // upcoming, dollars
  { id: 'd', status: 'open', processing_since: '2026-10-19T00:00:00Z', amount_cents: 50000 },
  { id: 'e', status: 'void', amount_cents: 999999 },
  { id: 'f', status: 'open', due_date: null, amount: 12.34 },                      // upcoming, cents rounding
];
const WANT = { paid: { count: 1, cents: 120000 }, processing: { count: 1, cents: 50000 }, upcoming: { count: 2, cents: 81234 }, overdue: { count: 1, cents: 90000 } };
ok('moneyBuckets: counts + cents per state, dollars converted, void counted nowhere — identical in the module and every page',
  JSON.stringify(moneyBuckets(LIST, T)) === JSON.stringify(WANT) && Object.values(pages).every((p) => JSON.stringify(p.fns.moneyBuckets(LIST, T)) === JSON.stringify(WANT)));
ok('moneyBuckets: the pending ids move a row to processing', moneyBuckets(LIST, T, ['b']).processing.cents === 140000 && moneyBuckets(LIST, T, ['b']).overdue.count === 0);
ok('moneyBuckets: junk in → four empty buckets', JSON.stringify(moneyBuckets(null, T)) === JSON.stringify({ paid: { count: 0, cents: 0 }, processing: { count: 0, cents: 0 }, upcoming: { count: 0, cents: 0 }, overdue: { count: 0, cents: 0 } }));

// ── structural pins: the wiring ──
const cd = read('supabase/functions/presence/routes/client_delivery.ts');
const sales = read('supabase/functions/presence/routes/sales.ts');
const stripe = read('supabase/functions/presence/commerce/stripe.ts');
const hook = read('supabase/functions/stripe-webhook/index.ts');
const life = read('supabase/functions/presence/commerce/lifecycle.ts');
const client = read('client.html');
const today = read('today.html');
const crm = read('crm.html');
ok('/client/billing: imports the one formula and ships `state` per invoice', /from '\.\.\/lib\/money_state\.ts'/.test(cd) && /const state = moneyState\(i, today\);/.test(cd) && /amount: \(Number\(i\.amount_cents\) \|\| 0\) \/ 100, status: i\.status, state,/.test(cd));
ok('/client/billing: pay_url only for the two WAITING states (never processing)', /\(state === 'upcoming' \|\| state === 'overdue'\) && i\.stripe_url\) \? i\.stripe_url : null/.test(cd));
ok('/client/billing: reads processing_since with the pre-0132 fallback (deploy-order tolerant)', /select=\$\{SEL\},processing_since&order=created_at\.desc/.test(cd) && /if \(!r\.ok\) r = await svc\(`presence_invoices\?customer_client_id=eq\.\$\{me\}&deleted_at=is\.null&select=\$\{SEL\}&order/.test(cd));
ok('/sales/receivables: ships state per item, the Paid window and the four buckets, with total_cents = upcoming + overdue only', /state: moneyState\(i, today\), overdue: moneyState\(i, today\) === 'overdue'/.test(sales) && /const buckets = moneyBuckets\(\[\.\.\.items, \.\.\.paid\], today\);/.test(sales) && /total_cents: buckets\.upcoming\.cents \+ buckets\.overdue\.cents, overdue_cents: buckets\.overdue\.cents, processing_cents: buckets\.processing\.cents/.test(sales) && /paid_window_days: PAID_WINDOW_DAYS/.test(sales));
ok('/sales/receivables + the deal read: processing_since with the pre-0132 fallback', /status=eq\.open&select=\$\{SEL\},processing_since&order=due_date\.asc\.nullslast/.test(sales) && /if \(!invR\.ok\) invR = await svc/.test(sales) && /created_at,processing_since&order=due_date\.asc\.nullsfirst,created_at\.asc`\); if \(!r\.ok\) r = await svc/.test(sales));
ok('the deal read: every invoice row carries `state`', /const invoiceRows = rows\(invoices\)\.map\(\(i: any\) => \(\{ \.\.\.i, processing_since: i\.processing_since \|\| null, state: moneyState\(i, invToday\) \}\)\);/.test(sales) && /invoices: invoiceRows \}/.test(sales));
ok('item 1: the service pay link returns the payer to /client.html?paid=<invoice id> (no #fragment — client.html opens the tab)', /'after_completion\[redirect\]\[url\]': `\$\{SITE_URL\}\/client\.html\?paid=\$\{encodeURIComponent\(p\.invoiceId\)\}`/.test(stripe) && !/client\.html\?paid=[^`]*#/.test(stripe));
ok('webhook: an unsettled checkout session (payment_status ≠ paid) stamps Processing instead of flipping paid', /const ps = String\(obj\.payment_status \|\| 'paid'\);\s*if \(ps !== 'paid'\) return await markPresenceInvoiceProcessing\(/.test(hook) && /const markPresenceInvoiceProcessing = async/.test(hook));
ok('webhook: payment_intent.processing stamps; async_payment_succeeded flips paid; async_payment_failed + payment_failed clear the stamp', /type === 'payment_intent\.processing'/.test(hook) && /type === 'checkout\.session\.async_payment_succeeded'[\s\S]*?markPresenceInvoicePaid\(/.test(hook) && /type === 'checkout\.session\.async_payment_failed'[\s\S]*?clearPresenceInvoiceProcessing\(/.test(hook) && /payment_intent\.payment_failed[\s\S]*?clearPresenceInvoiceProcessing\(/.test(hook));
ok('webhook: the paid flip clears processing_since and retries the pre-0132 body (never a 500 that loops a payment)', /flipWith\(\{ status: 'paid', paid_at: eventTime, updated_at: eventTime, processing_since: null \}\);\s*if \(!flipped\.ok\) flipped = await flipWith\(\{ status: 'paid', paid_at: eventTime, updated_at: eventTime \}\);/.test(hook));
ok('webhook: the stamp never 500s before the migration (acknowledged + logged)', /could not stamp presence_invoice \$\{invoiceId\} processing_since \(migration 0132 applied\?\)/.test(hook) && /migration 0132/.test(read('supabase/migrations/0132_invoice_processing.sql').length ? 'migration 0132' : ''));
ok('migration 0132 adds processing_since (nullable, additive) with a rollback line', /^-- rollback: alter table public\.presence_invoices drop column if exists processing_since;/.test(read('supabase/migrations/0132_invoice_processing.sql')) && /add column if not exists processing_since timestamptz;/.test(read('supabase/migrations/0132_invoice_processing.sql')));
ok('the unpaid reminder skips a settling payment (processing_since=is.null, with the pre-0132 fallback)', /stripe_url=not\.is\.null&processing_since=is\.null\$\{TAIL\}/.test(life) && /if \(!q\.ok\) q = await svc\(`presence_invoices\?status=eq\.open&deleted_at=is\.null&stripe_url=not\.is\.null\$\{TAIL\}`\);/.test(life));
// the three surfaces render from the one formula — never from a raw status word
ok('client.html: the Invoices row, the to-pay/Needs-you filter and the Needs-you word all run moneyState', /const st=moneyState\(i,todayYmd,PAID_PENDING\);/.test(client) && /function unpaidInvoices\(b\)\{return \(\(b&&b\.invoices\)\|\|\[\]\)\.filter\(i=>\{const s=invState\(i\);return s==='upcoming'\|\|s==='overdue';\}\);\}/.test(client) && /const stWord=\(MONEY_WORD\[moneyState\(i,nyToday,PAID_PENDING\)\]\|\|''\)\.toLowerCase\(\);/.test(client) && !/function invOverdue/.test(client));
ok('client.html: the chip prints MONEY_WORD in its one tone, and a processing row never offers Pay', /const chip=dead\?'Voided':MONEY_WORD\[st\];/.test(client) && /const pay=st!=='processing'&&i\.pay_url/.test(client) && /\.fst\.pr\{/.test(client));
ok('client.html item 1: ?paid= → remembered, Invoices tab, thank-you toast, polling every 5s for a minute, then the still-confirming line; signed-out → payment-success.html?paid=', /const PAID_POLL_MS=5000, PAID_POLL_LIMIT_MS=60000/.test(client) && /toast\('Thank you — we’re confirming your payment\.'\)/.test(client) && /Still confirming — it can take a few minutes, you don’t need to do anything\./.test(client) && /Paid — confirming your payment\./.test(client) && /if\(row&&row\.status==='paid'\)\{PAID_PENDING=\[\];/.test(client) && /location\.replace\('\/payment-success\.html\?paid='\+encodeURIComponent\(pp\)\)/.test(client));
ok('client.html item 1: "Paid" only when the server says so — the pending id alone never renders the paid state', !/pending[^\n]*return'paid'/.test(srcs[0]) && /if\(s==='paid'\)return'paid';/.test(srcs[0]));
ok('today.html: the band derives its sentence AND the four buckets from the one formula over the one list', /const b=moneyBuckets\(items\.concat\(paidRows\|\|\[\]\),today\);/.test(today) && /data-bucket="\$\{k\}"/.test(today) && /filter\(k=>k!=='paid'\|\|paidRows\)/.test(today));
ok('crm/activity.ts: the server-composed record band runs the one formula (processing/void/paid excluded, overdue is its word)', /const st = iv \? moneyState\(iv, today\) : '';\s*if \(st !== 'upcoming' && st !== 'overdue'\) continue;/.test(read('supabase/functions/presence/crm/activity.ts')) && /overdue: st === 'overdue'/.test(read('supabase/functions/presence/crm/activity.ts')) && /select=id,title,amount_cents,due_date,status,deal_id,processing_since&limit=100`\);\s*if \(!ir\.ok\) ir = await svc/.test(read('supabase/functions/presence/routes/crm.ts')));
ok('crm.html: the Billing chip, the Outstanding tile and the record band run the one formula', /const st=invState\(v\);/.test(crm) && /const mb=moneyBuckets\(inv,recTodayYmd\(\)\);/.test(crm) && /for\(const iv of invWaiting\(\(DEAL&&DEAL\.invoices\)\|\|\[\]\)\)upcoming\.push/.test(crm) && /\.schip\.info\{/.test(crm));

const failed = results.filter((r) => !r.p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
