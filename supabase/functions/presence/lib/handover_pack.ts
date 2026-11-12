// ── A hand-over pack for a client who leaves (sales item 93, Nov 2026) ─────────
// The review (file 07, finding 18) found no hand-over for a client, and our own terms
// promise "a reasonable handoff period" and that clients can take what they own. The
// kit on the portal's Help tab (builder item 176) is for while they stay; this is for
// when they go: one zip with everything they need to run without the studio.
//   START-HERE.html          what is in the pack, readable in any browser
//   website/                 every page as plain files (the one renderer), hostable anywhere
//   photos-and-files/        their uploads; a very large one is a link that works 30 days
//   their-domain.txt         where it's registered, when it renews, the records live now,
//                            and which keep the website and the email working
//   customers/*.csv          enquiries and sign-ups, bookings, reviews
//   invoices-from-us.csv     what the studio billed them and what they paid
//   who-owns-what.txt        the accounts to hand over, with a step for each
// Pure: routes/handover_pack.ts reads the rows and the files; these shape the words.
import { toCsv } from './zip_csv.ts';

export const PACK_MAX_FILE = 12 * 1024 * 1024;     // one file larger than this comes as a link
export const PACK_MAX_FILES_TOTAL = 30 * 1024 * 1024;   // and so does everything past this, so the pack stays a download (the website's own photo sizes come on top)
export const PACK_LINK_DAYS = 30;

const day = (iso: unknown) => String(iso || '').slice(0, 10);
const dollars = (c: unknown) => (Math.round(Number(c) || 0) / 100).toFixed(2);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));

/** A file name that is safe in a zip on every computer, keeping its extension. */
export function safeName(name: unknown, fallback: string): string {
  const s = String(name || '').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^[.-]+/, '').slice(-80);
  return s || fallback;
}

/** Which uploads go inside the zip and which come as a link: the smallest first, until a
 *  file is too big or the pack would be. Each name is used once. Pure. */
export function planFiles<T extends { id: string; name: string; bytes: number }>(files: T[]): { inside: T[]; linked: T[] } {
  const inside: T[] = [], linked: T[] = []; let total = 0;
  for (const f of [...files].sort((a, b) => (a.bytes || 0) - (b.bytes || 0))) {
    const b = Math.max(0, Number(f.bytes) || 0);
    if (b > PACK_MAX_FILE || total + b > PACK_MAX_FILES_TOTAL) { linked.push(f); continue; }
    inside.push(f); total += b;
  }
  return { inside, linked };
}
/** The same name twice in one folder gets "-2", "-3". Pure. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase(); const c = (seen.get(k) || 0) + 1; seen.set(k, c);
    if (c === 1) return n;
    const dot = n.lastIndexOf('.');
    return dot > 0 ? `${n.slice(0, dot)}-${c}${n.slice(dot)}` : `${n}-${c}`;
  });
}

/** customers/*.csv: what the business's own customers sent through the website. */
export function customerCsvs(x: { submissions: any[]; appointments: any[]; reviews: any[] }): Array<{ name: string; text: string; count: number }> {
  return [
    { name: 'customers/enquiries-and-sign-ups.csv', count: x.submissions.length, text: toCsv(['Date', 'Kind', 'Name', 'Email', 'Phone', 'Message', 'Page', 'Status'],
      x.submissions.map((s) => [day(s.created_at), s.form_kind === 'newsletter' ? 'Sign-up' : 'Enquiry', s.name, s.email, s.phone, s.message, s.source_page, s.status])) },
    { name: 'customers/bookings.csv', count: x.appointments.length, text: toCsv(['Starts', 'Service', 'Name', 'Email', 'Phone', 'Minutes', 'Price', 'Status', 'Note'],
      x.appointments.map((a) => [String(a.slot_start_local || a.slot_start || ''), a.type_name, a.customer_name, a.customer_email, a.customer_phone, a.duration_min, a.price_cents ? dollars(a.price_cents) : '', a.status, a.note])) },
    { name: 'customers/reviews.csv', count: x.reviews.length, text: toCsv(['Date', 'Name', 'Email', 'Stars', 'Review', 'Shown on the site', 'Your reply'],
      x.reviews.map((r) => [day(r.created_at), r.reviewer_name, r.reviewer_email, r.rating, r.body, r.status === 'approved' ? 'Yes' : 'No', r.owner_reply])) },
  ];
}

/** invoices-from-us.csv: what the studio billed the client, a part payment under its invoice. */
export function invoicesCsv(rows: any[], numberLabel: (n: unknown) => string): { text: string; count: number } {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const list = rows.filter((r) => r.status !== 'void' && r.status !== 'canceled')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return { count: list.filter((r) => !r.payment_for).length, text: toCsv(['Number', 'What for', 'Amount', 'Status', 'Sent', 'Due', 'Paid on', 'How paid'],
    list.map((r) => {
      const parent = r.payment_for ? byId.get(String(r.payment_for)) : null;
      return [numberLabel((parent || r).number), parent ? `Part payment toward ${String(parent.title || 'an invoice')}` : r.title, dollars(r.amount_cents), r.status === 'paid' ? 'Paid' : r.processing_since ? 'Payment on its way' : 'Open', day(r.created_at), day(r.due_date), day(r.paid_at), r.paid_method || (r.status === 'paid' ? 'Card or bank, through Stripe' : '')];
    })) };
}

export interface DomainFacts {
  domain: string | null; registrar: string; expires_at: string | null; dns_host: string; whose: string; auto_renew: boolean | null; note: string;
  records: Array<{ name: string; type: string; value: string }>;
}
/** their-domain.txt: where the domain lives and what to keep when moving. */
export function domainText(d: DomainFacts, studio: string): string {
  if (!d.domain) return ['Your domain', '', 'This website has no domain of its own yet, so there is nothing to move.', ''].join('\r\n');
  const web = d.records.filter((r) => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME');
  const mail = d.records.filter((r) => r.type === 'MX' || (r.type === 'TXT' && /^v=spf1|^v=DMARC1/i.test(r.value)) || r.name.startsWith('_dmarc.'));
  const line = (r: { name: string; type: string; value: string }) => `  ${r.type.padEnd(6)}${r.name}  ->  ${r.value}`;
  return [
    `Your domain: ${d.domain}`,
    '',
    `Registered at: ${d.registrar || 'not known from here'}${d.whose ? ` (in ${d.whose} account)` : ''}`,
    d.expires_at ? `Renews by: ${day(d.expires_at)}${d.auto_renew === true ? ', and it renews by itself' : d.auto_renew === false ? ', and it does not renew by itself' : ''}` : 'Renewal date: not known from here',
    d.dns_host ? `Its records are kept at: ${d.dns_host}` : '',
    d.note ? `${studio}'s note: ${d.note}` : '',
    '',
    'These records point the website to where it is hosted today. When you move the website, your new host tells you what to put here instead:',
    ...(web.length ? web.map(line) : ['  (none read just now)']),
    '',
    'These records make your email work. Keep them exactly as they are when you move the website:',
    ...(mail.length ? mail.map(line) : ['  (no email records found)']),
    '',
    'Read live from the internet when this pack was made.',
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\r\n');
}

export interface OwnsFacts { studio: string; business: string; domain: string | null; registrar: string; whose: string; google_listing: boolean; search_console: boolean; mail_host: string }
/** who-owns-what.txt: the accounts to make sure are in the business's own name. */
export function ownsText(o: OwnsFacts): string {
  const out = [`Who owns what: ${o.business}`, '', `Before you finish with ${o.studio}, make sure each of these is in your own name.`, ''];
  let n = 0;
  const step = (title: string, how: string) => { n++; out.push(`${n}. ${title}`, `   ${how}`, ''); };
  if (o.domain) step(`Your domain, ${o.domain}`, o.whose && !/^(the )?client|your/i.test(o.whose)
    ? `It sits in ${o.whose} account${o.registrar ? ` at ${o.registrar}` : ''}. Ask for it to be moved to an account of your own (a "transfer" or "change of account" at the company it's registered with).`
    : `Sign in where it's registered${o.registrar ? ` (${o.registrar})` : ''} and check the account and the renewal card are yours.`);
  step('Your website', 'The website/ folder in this pack is your whole site as plain files. Any web host can put it online; give them the folder and point your domain at them (see their-domain.txt).');
  if (o.google_listing) step('Your Google Business Profile', 'Open business.google.com, choose your business, then Settings and Managers. Make yourself the Primary owner and remove anyone who should no longer manage it.');
  if (o.search_console) step('Google Search Console', 'Open search.google.com/search-console, choose your site, then Settings and Users and permissions. Make sure you are an Owner.');
  if (o.mail_host) step('Your email', `Your email is with ${o.mail_host}. It keeps working when the website moves, as long as the email records in their-domain.txt stay as they are.`);
  step('Your photos, customers and invoices', 'They are all in this pack: photos-and-files/, customers/ and invoices-from-us.csv. Keep a copy somewhere safe.');
  return out.join('\r\n');
}

/** START-HERE.html: one page that says what is in the pack, opened in any browser. */
export function startHereHtml(p: { business: string; studio: string; made_at: string; pages: number; files_inside: number; files_linked: number; counts: Record<string, number>; invoices: number; domain: string | null }): string {
  const li = (href: string, title: string, sub: string) => `<li><a href="${esc(href)}">${esc(title)}</a><span>${esc(sub)}</span></li>`;
  const files = p.files_inside + p.files_linked;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hand-over pack: ${esc(p.business)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#171522;background:#f4f3f9;margin:0;padding:32px 16px;line-height:1.5}
main{max-width:640px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 28px 20px;box-shadow:0 12px 40px rgba(26,13,64,.08)}
h1{font-size:26px;margin:0 0 4px}p{color:#55526a;margin:0 0 18px}ul{list-style:none;margin:0;padding:0}li{padding:12px 0;border-top:1px solid #e7e6ef}
li a{display:block;font-weight:600;color:#5b3fa0;text-decoration:none}li span{display:block;color:#55526a;font-size:14px}footer{color:#69667d;font-size:13px;margin-top:16px}</style></head>
<body><main><h1>${esc(p.business)}: everything to take with you</h1><p>From ${esc(p.studio)}, made ${esc(day(p.made_at))}. Nothing here needs ${esc(p.studio)} to work.</p><ul>
${li('website/index.html', 'Your website', `${p.pages} page${p.pages === 1 ? '' : 's'} as plain files. Any web host can put them online.`)}
${li('photos-and-files/', 'Your photos and files', `${files} in all${p.files_linked ? `; ${p.files_linked} very large ${p.files_linked === 1 ? 'one comes' : 'ones come'} as a link in photos-and-files/LINKS.txt, working for ${PACK_LINK_DAYS} days` : ''}.`)}
${li('their-domain.txt', 'Your domain', p.domain ? `${p.domain}: where it is registered, when it renews, and the records that keep the website and email working.` : 'This website has no domain of its own yet.')}
${li('customers/', 'Your customers', `${p.counts.enquiries || 0} enquiries and sign-ups, ${p.counts.bookings || 0} bookings and ${p.counts.reviews || 0} reviews, as spreadsheets.`)}
${li('invoices-from-us.csv', 'Your invoices from us', `${p.invoices} invoice${p.invoices === 1 ? '' : 's'} and what was paid, as a spreadsheet.`)}
${li('who-owns-what.txt', 'Who owns what', 'The accounts to make sure are in your own name, with a step for each.')}
</ul><footer>Open the .csv files with Google Sheets, Excel or Numbers. Open the .txt files with any text editor.</footer></main></body></html>`;
}
