// ── Sales item 92: emails and pages stop talking as "your studio" or Eric ──
//   deno run --allow-read --allow-env --allow-net tests/presence/email_words_92_test.mjs
// The one-tap approval page says who is asking and what exactly changes, and "Not
// yet" carries a note to the studio; reminders offer a reply and the invoice, not
// only "Pay"; the studio's own emails speak in its name and come from it; the pay
// pages stop saying "my side" and "message Eric". Part A is pure, B drives the
// approval routes through a fetch fake, C pins the words at their call sites.
const SECRET = 'test-approval-secret';
Deno.env.set('SUPABASE_URL', 'https://db.example');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Platform <hello@example.com>');
Deno.env.set('APPROVAL_SECRET', SECRET);
Deno.env.set('APP_URL', 'https://app.example');

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { approvalDetail, cleanNote, planLines, NOT_YET_NOTE_MAX } = await import('../../supabase/functions/presence/lib/approval_page.ts');
const { platformSenderName } = await import('../../supabase/functions/presence/commerce/account.ts');
const { approvalReminderCopy } = await import('../../supabase/functions/presence/lib/approvals.ts');
const { invoiceReminderMore, REPLY_LINE } = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
const { signApprovalToken } = await import('../../supabase/functions/presence/lib/commercial.ts');
const { handleApproveGet, handleApprovePost } = await import('../../supabase/functions/presence/routes/commercial.ts');

// ═══════════════════════ PART A · pure ═══════════════════════
{
  const post = approvalDetail('connected', {
    workflow: 'gbp_post', what_changes: ['A new post appears on your Google listing.'], what_stays: ['Your hours are untouched.', '  '],
    reversible: true, rollback: 'The post can be deleted in one step.', payload: { summary: '  Spring hours start Monday.  ' },
  });
  ok('a Google post: its tag, its words, what changes, what stays, and how to undo it',
    post.tag === 'Google listing' && post.post === 'Spring hours start Monday.' && post.changes.length === 1 && post.stays.length === 1 && post.undo?.reversible === true && /deleted in one step/.test(post.undo.how), JSON.stringify(post));
  const hours = approvalDetail('connected', { workflow: 'gbp_hours', what_changes: ['New hours.'], reversible: true, rollback: 'Saved.', payload: { hours: { mon: '9-5' } } });
  ok('new hours show no post', hours.post === null && hours.tag === 'Google listing');
  const plan = approvalDetail('infrastructure', { kind: 'connect_domain', steps: [{ what: 'Point the domain at the site', why: 'so it opens' }, { what: '' }, 'Check the padlock'], reversible: true, rollback_note: 'The old records are saved.' });
  ok('a web address plan lists its steps as what changes', plan.tag === 'Web address' && plan.changes.join('|') === 'Point the domain at the site|Check the padlock' && plan.stays.length === 0 && plan.undo?.how === 'The old records are saved.');
  ok('a plan that can’t be undone says no', approvalDetail('infrastructure', { reversible: false, rollback_note: 'A transfer can’t be reversed.' }).undo?.reversible === false);
  ok('nothing known about undoing = no undo line', approvalDetail('connected', {}).undo === null && approvalDetail('connected', null).changes.length === 0);
  ok('lists are capped and lines cut', planLines(Array.from({ length: 30 }, (_, i) => 'x'.repeat(400) + i)).length === 12 && planLines(['y'.repeat(900)])[0].length === 300);
  ok('a note keeps its lines, drops control characters, and is capped', cleanNote('  one\r\ntwo\u0007\n\n\n\nthree  ') === 'one\ntwo\n\nthree' && cleanNote('z'.repeat(5000)).length === NOT_YET_NOTE_MAX && cleanNote(undefined) === '');
  ok('the platform’s own name comes from EMAIL_FROM', platformSenderName() === 'Example Platform');
  const named = approvalReminderCopy('Homepage mockup', '2026-10-21', 'day_before', 'Brightline Studio');
  ok('an approval reminder asks in the studio’s name and offers a reply', /^<p>Brightline Studio would like your answer/.test(named.html) && /tell Brightline Studio what to change/.test(named.html) && /Just reply to this email/.test(named.html) && !/your studio/i.test(named.html));
  ok('…and without a name it reads as before', /Your studio would like your answer/.test(approvalReminderCopy('X', '2026-10-21', 'day_before').html));
  const more = invoiceReminderMore('https://app.example/doc.html?t=abc', '#3a2470');
  ok('an invoice reminder links the invoice and offers a reply', /href="https:\/\/app\.example\/doc\.html\?t=abc"[^>]*>View the invoice →<\/a>/.test(more) && /Paid another way already, or have a question\? Just reply to this email\./.test(more));
  ok('…and without a link still offers the reply', !/View the invoice/.test(invoiceReminderMore(null, '#000')) && /Just reply to this email/.test(invoiceReminderMore(null, '#000')));
  ok('the proposal nudge’s reply line', /Have a question\? Just reply to this email\./.test(REPLY_LINE));
}

// ═══════════════════════ PART B · the approval routes ═══════════════════════
const CAFE = '11111111-1111-4111-8111-111111111111';     // the client's site
const STUDIO = '22222222-2222-4222-8222-222222222222';   // the studio that looks after it
const WRITE = '33333333-3333-4333-8333-333333333333';
const w = { status: 'proposed', emails: [], changes: [], linked: true };
const reply = (b, s = 200) => Promise.resolve(new Response(s === 204 ? null : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }));
globalThis.fetch = (input, init = {}) => {
  const u = decodeURIComponent(String(typeof input === 'string' ? input : input.url)), m = (init.method || 'GET').toUpperCase();
  if (u.startsWith('https://api.resend.com/emails')) { w.emails.push(JSON.parse(init.body)); return reply({ id: 'e' }); }
  if (u.includes('/rpc/rate_hit')) return reply(true);
  if (u.includes('/suppressed_emails')) return reply([]);
  if (u.includes('/presence_service_links?')) return reply(w.linked ? [{ agency_site_id: STUDIO }] : []);
  if (u.includes(`/presence_identity?site_id=eq.${STUDIO}`)) return reply([{ business_name: 'Brightline Studio', email: 'hello@brightline.example' }]);
  if (u.includes(`/presence_identity?site_id=eq.${CAFE}`)) return reply([{ business_name: 'Corner Café', email: 'owner@cafe.example' }]);
  if (u.includes('/presence_sites?')) return reply([{ client_id: null }]);
  if (u.includes('/presence_connection_writes?') && m === 'GET') return reply(w.status === 'proposed' ? [{ title: 'Publish a post to your Google listing', summary: 'A short update.', workflow: 'gbp_post', what_changes: ['A new post appears.'], what_stays: ['Your hours are untouched.'], reversible: true, rollback: 'Delete it in one step.', payload: { summary: 'Spring hours start Monday.' } }] : []);
  if (u.includes('/presence_connection_writes?') && m === 'PATCH') { if (w.status !== 'proposed') return reply([]); w.status = JSON.parse(init.body).status; return reply([{ id: WRITE, status: w.status }]); }
  if (u.includes('/presence_change_events') && m === 'POST') { w.changes.push(JSON.parse(init.body)); return reply(null, 201); }
  return reply([]);
};
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = await signApprovalToken({ site_id: CAFE, kind: 'connected', plan_id: WRITE, exp }, SECRET);
{
  const g = await handleApproveGet(new Request(`https://db.example/functions/v1/presence/approve?token=${encodeURIComponent(token)}`), {});
  const d = (await g.json()).data || {};
  ok('the page learns who is asking: the studio, by its Business details name', d.studio?.name === 'Brightline Studio', JSON.stringify(d.studio));
  ok('…and what exactly is being approved', d.tag === 'Google listing' && d.post === 'Spring hours start Monday.' && d.changes?.[0] === 'A new post appears.' && d.stays?.[0] === 'Your hours are untouched.' && d.undo?.how === 'Delete it in one step.' && d.business_name === 'Corner Café');
  w.linked = false;
  const g2 = await (await handleApproveGet(new Request(`https://db.example/functions/v1/presence/approve?token=${encodeURIComponent(token)}`), {})).json();
  ok('no studio looks after the site → the platform’s own name, never a made-up one', g2.data?.studio?.name === 'Example Platform');
  w.linked = true;
}
{
  const p = await handleApprovePost(new Request('https://db.example/functions/v1/presence/approve', { method: 'POST', body: JSON.stringify({ token, decision: 'reject', note: 'Can we say open late on Fridays too?\n<b>thanks</b>' }) }), {});
  const j = await p.json();
  ok('Not yet with a note sets the change aside', p.status === 200 && j.data?.decision === 'set_aside' && w.status === 'abandoned');
  const mail = w.emails.find((e) => e.to === 'hello@brightline.example');
  ok('the studio is told, with the note (escaped), the business and the change', !!mail && /^Not yet: Publish a post to your Google listing$/.test(mail.subject) && /Corner Café/.test(mail.html) && /Can we say open late on Fridays too\?<br>&lt;b&gt;thanks&lt;\/b&gt;/.test(mail.html), JSON.stringify(mail?.subject));
  ok('…as operator mail: always arrives, the platform as sender', !('List-Unsubscribe' in (mail?.headers || {})) && mail?.from === 'Example Platform <hello@example.com>');
  ok('the site’s change log keeps the note', w.changes.some((c) => /Not yet on “Publish a post to your Google listing”: Can we say open late on Fridays too\?/.test(c.summary || '')));
  const again = await handleApprovePost(new Request('https://db.example/functions/v1/presence/approve', { method: 'POST', body: JSON.stringify({ token, decision: 'reject', note: 'again' }) }), {});
  ok('a second answer is refused as already handled, and tells no one twice', again.status === 409 && w.emails.filter((e) => e.to === 'hello@brightline.example').length === 1);
}
{
  w.status = 'proposed'; w.emails.length = 0;
  const a = await handleApprovePost(new Request('https://db.example/functions/v1/presence/approve', { method: 'POST', body: JSON.stringify({ token, decision: 'approve', note: 'ignored' }) }), {});
  ok('Approve applies and sends no "not yet" mail; a note on Approve is ignored', a.status === 200 && w.status === 'approved' && w.emails.length === 0);
}

// ═══════════════════════ PART C · the words where they are written ═══════════════════════
const FN = new URL('../../supabase/functions/presence/', import.meta.url);
const src = (p) => Deno.readTextFileSync(new URL(p, FN));
const page = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
{
  const sales = src('routes/sales.ts');
  ok('sales emails no longer say "Your studio has prepared" or "has set up"', !/Your studio has (prepared|set up)/.test(sales));
  ok('the portal invitation no longer speaks as Eric ("message me directly", "tell me")', !/message me directly|I read everything|reply and tell me/.test(sales));
  ok('the six studio→client sales emails come from the studio', (sales.match(/brand, \{ critical: true, asBusiness: true, siteId/g) || []).length === 6);
  ok('the invoice email has no "Your studio" stand-in', !/: 'Your studio';/.test(sales));
}
ok('the estimate, the recorded-payment receipt and the paid receipt come from the studio',
  /\{ critical: true, asBusiness: true, siteId \}/.test(src('routes/estimates.ts')) && /\{ critical: true, asBusiness: true, siteId, \.\.\./.test(src('routes/invoice_payments.ts')) && /\{ critical: true, asBusiness: true, siteId: String\(inv\.site_id\)/.test(src('routes/commerce.ts')));
ok('the paid receipt names the studio ("has been told"), not "Your studio has been notified"', !/Your studio has been notified/.test(src('routes/commerce.ts')) && /has been told/.test(src('routes/commerce.ts')));
ok('a support reply is "A reply from <the studio>"', !/'A reply from your studio'/.test(src('routes/service_intake.ts')) && /`A reply from \$\{brand\.name\}`/.test(src('routes/service_intake.ts')));
ok('a project message is "A message from <the studio>"', !/'A message from your studio'/.test(src('routes/project_comms.ts')) && /`A message from \$\{who\}`/.test(src('routes/project_comms.ts')));
ok('the approval email names the studio and links "See what changes"', /\$\{esc\(sender\.name\)\} has \$\{n\} ready for you/.test(src('routes/commercial.ts')) && /See what changes →/.test(src('routes/commercial.ts')) && !/Your studio has \$\{items\.length\}/.test(src('routes/commercial.ts')));
ok('the invoice reminder links the invoice, offers a reply and comes from the studio', /const more = invoiceReminderMore\(doc, brand\.accentDark\);/.test(src('commerce/lifecycle.ts')) && /\{ critical: true, asBusiness: true, siteId: inv\.site_id \}/.test(src('commerce/lifecycle.ts')));
ok('the proposal nudge offers a reply', /<p class="cta">\$\{btn\}<\/p>\$\{REPLY_LINE\}`, brand, \{ siteId: doc\.site_id, asBusiness: true \}/.test(src('commerce/lifecycle.ts')));
{
  const ok1 = page('payment-success.html'), ok2 = page('payment-canceled.html'), ap = page('approve.html');
  ok('the pay pages stop speaking as Eric to every payer', !/On my side/.test(ok1) && !/message Eric/.test(ok2) && !/<title>[^<]*Davis Digital Studio<\/title>/.test(ok1 + ok2));
  ok('…the audit thank-you (Eric’s own audit) still says who reviews it', /Eric personally reviews your site/.test(ok1));
  ok('the approval page no longer hard-codes "Davis Digital Studio" or "your studio"', !/Davis Digital Studio<\/div>/.test(ap) && !/<title>[^<]*Davis Digital Studio/.test(ap) && !/couldn’t reach your studio/.test(ap));
  ok('the approval page shows what changes and takes a note on Not yet', /What changes/.test(ap) && /What stays the same/.test(ap) && /Can it be undone\?/.test(ap) && /What should change\? \(optional\)/.test(ap) && /JSON\.stringify\(\{token,decision,note\}\)/.test(ap));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ EMAIL WORDS + APPROVAL PAGE (sales item 92): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
