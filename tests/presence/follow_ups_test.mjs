// Sales item 87 (Nov 2026 review): follow-ups that go out on their own, and the recipes.
// lib/follow_ups.ts decides; commerce/lifecycle.ts sends; settings.html and inbox.html show.
//   deno run --allow-read --allow-env tests/presence/follow_ups_test.mjs
import {
  FOLLOWUP_DEFAULT_DAYS, FOLLOWUP_WORDS, followupDays, followupWords, followupStepDue, followupStopReason,
  followupPlan, echoOfMessage, quoteBlock, wordsHtml, followupEmail, quoteExpiryDue, quoteExpiryCopy, QUOTE_EXPIRY_LEAD_DAYS,
} from '../../supabase/functions/presence/lib/follow_ups.ts';
import { automationSettings, followupSettingsOf, invoiceReminderSlot, invoiceReminderCopy, legToSend, INVOICE_AGAIN_DAYS, AUTOMATION_COLS_0175 } from '../../supabase/functions/presence/commerce/lifecycle.ts';
import { enquiryAckCopy, ENQUIRY_ACK_SENTENCE } from '../../supabase/functions/presence/lib/commercial.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-20T15:00:00Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();

// ═══ 1. the days and the words ═══
{
  ok('days: defaults 3 and 7', JSON.stringify(followupDays(undefined, undefined)) === '[3,7]' && FOLLOWUP_DEFAULT_DAYS[0] === 3 && FOLLOWUP_DEFAULT_DAYS[1] === 7);
  ok('days: the second is at least two days after the first', JSON.stringify(followupDays(5, 6)) === '[5,7]' && JSON.stringify(followupDays(14, 3)) === '[14,16]');
  ok('days: clamped to 1–14 and up to 30', JSON.stringify(followupDays(0, 99)) === '[1,30]' && JSON.stringify(followupDays(40, 40)) === '[14,30]');
  ok('words: trimmed, control characters out, newlines kept, capped', followupWords('  Hi\r\nthere\u0007  ') === 'Hi\nthere' && followupWords('x'.repeat(2000)).length === 1200 && followupWords(null) === '');
  const s = automationSettings({ enquiry_followups: true, enquiry_followup_1_days: 2, enquiry_followup_2_days: 3, enquiry_followup_1_message: ' Mine ', auto_ack_message: 'Hello!' });
  ok('settings: read and made sane', s.enquiry_followups === true && s.enquiry_followup_1_days === 2 && s.enquiry_followup_2_days === 4 && s.enquiry_followup_1_message === 'Mine' && s.auto_ack_message === 'Hello!');
  ok('settings: every new switch is off with no row', (() => { const d = automationSettings(null); return !d.enquiry_followups && !d.invoice_overdue_repeat && !d.quote_expiry_reminders && d.auto_ack_message === ''; })());
  const f = followupSettingsOf(s);
  ok('settings: the series in lib/follow_ups.ts shape', f.on === true && f.days[0] === 2 && f.days[1] === 4 && f.words[0] === 'Mine' && f.words[1] === '');
  ok('settings: the 0175 columns are read after the older ones', AUTOMATION_COLS_0175.endsWith('auto_ack_message,enquiry_followups,enquiry_followup_1_days,enquiry_followup_2_days,enquiry_followup_1_message,enquiry_followup_2_message,invoice_overdue_repeat,quote_expiry_reminders'));
}

// ═══ 2. which follow-up is due ═══
{
  const cfg = { on: true, days: [3, 7], words: ['', ''] };
  const sub = (d, extra = {}) => ({ created_at: ago(d), status: 'new', spam: false, email: 'sam@example.com', ...extra });
  ok('due: nothing before day 3', followupStepDue(sub(2.9), NOW, cfg, {}) === null);
  ok('due: the first from day 3', followupStepDue(sub(3), NOW, cfg, {}) === 1 && followupStepDue(sub(6.9), NOW, cfg, {}) === 1);
  ok('due: switched on late, an old enquiry gets nothing', followupStepDue(sub(8), NOW, cfg, {}) === null && followupStepDue(sub(30), NOW, cfg, {}) === null);
  ok('due: the second from day 7, once the first went', followupStepDue(sub(7), NOW, cfg, { 1: ago(4) }) === 2 && followupStepDue(sub(6), NOW, cfg, { 1: ago(3) }) === null);
  ok('due: never two within two days', followupStepDue(sub(7), NOW, cfg, { 1: ago(1) }) === null);
  ok('due: the second has a week, then nothing', followupStepDue(sub(14.1), NOW, cfg, { 1: ago(10) }) === null);
  ok('due: after both, nothing ever again', followupStepDue(sub(8), NOW, cfg, { 1: ago(5), 2: ago(1) }) === null);
  ok('due: switch off, spam, no email, a settled enquiry → nothing', followupStepDue(sub(3), NOW, { ...cfg, on: false }, {}) === null && followupStepDue(sub(3, { spam: true }), NOW, cfg, {}) === null
    && followupStepDue(sub(3, { email: '' }), NOW, cfg, {}) === null && ['converted', 'not_a_fit', 'archived'].every((st) => followupStepDue(sub(3, { status: st }), NOW, cfg, {}) === null));
  ok('due: Read and Replied enquiries still get them', followupStepDue(sub(3, { status: 'read' }), NOW, cfg, {}) === 1 && followupStepDue(sub(3, { status: 'replied' }), NOW, cfg, {}) === 1);
  ok('stop: the owner\'s marks first, then what the person did', followupStopReason({ status: 'not_a_fit' }, { booked: true }) === 'marked' && followupStopReason({ spam: true }, {}) === 'spam'
    && followupStopReason({ status: 'new' }, { off: true, booked: true }) === 'off' && followupStopReason({ status: 'new' }, { laterEnquiry: true }) === 'wrote_again'
    && followupStopReason({ status: 'new' }, { booked: true }) === 'booked' && followupStopReason({ status: 'new' }, { wroteBack: true }) === 'wrote_back' && followupStopReason({ status: 'read' }, {}) === null);
}

// ═══ 3. what the Inbox shows ═══
{
  const cfg = { on: true, days: [3, 7], words: ['', ''] };
  const s = { created_at: ago(1), status: 'new', email: 'sam@example.com' };
  const p1 = followupPlan(s, {}, cfg, NOW);
  ok('inbox: the first goes on day 3', p1.next && p1.next.n === 1 && Date.parse(p1.next.at) === Date.parse(s.created_at) + 3 * DAY && p1.sent.length === 0 && !p1.off);
  const p2 = followupPlan({ ...s, created_at: ago(4) }, { __followups: [{ n: 1, at: ago(1) }] }, cfg, NOW);
  ok('inbox: after the first, the second on day 7', p2.sent.length === 1 && p2.sent[0].n === 1 && p2.next && p2.next.n === 2);
  ok('inbox: stopped by the owner → no next', followupPlan(s, { __followups_off: true }, cfg, NOW).off === true && followupPlan(s, { __followups_off: true }, cfg, NOW).next === null);
  ok('inbox: switch off → nothing planned, what went still shows', followupPlan(s, { __followups: [{ n: 1, at: ago(1) }] }, { ...cfg, on: false }, NOW).next === null && followupPlan(s, { __followups: [{ n: 1, at: ago(1) }] }, { ...cfg, on: false }, NOW).sent.length === 1);
  ok('inbox: junk in the list is ignored', followupPlan(s, { __followups: [{ n: 3 }, 'x', null, { n: 2, at: 5 }] }, cfg, NOW).sent.length === 0);
}

// ═══ 4. the emails ═══
{
  ok('echo: web addresses out, an email address keeps its domain', echoOfMessage('see https://spam.example/x and www.bad.biz or buy-now.ru today, mail sam@cornercafe.com') === 'see [link] and [link] or [link] today, mail sam@cornercafe.com');
  ok('echo: tidied and capped with an ellipsis', echoOfMessage('a   b\n\n\n\nc') === 'a b\n\nc' && echoOfMessage('x'.repeat(700)).length === 600 && echoOfMessage('x'.repeat(700)).endsWith('…'));
  ok('quote: escaped, with its label; nothing for an empty message', quoteBlock('<b>hi</b>').includes('&lt;b&gt;hi&lt;/b&gt;') && quoteBlock('hi').includes('You wrote:') && quoteBlock('  ') === '');
  ok('words: a blank line makes a new paragraph, escaped', wordsHtml('One\n\nTwo <x>\nthree') === '<p>One</p><p>Two &lt;x&gt;<br>three</p>');
  const e1 = followupEmail(1, { name: 'Sam Lee', business: 'Corner Café', message: 'Do you cater?' });
  ok('follow-up 1: greets by first name, the standard words, what they wrote', e1.subject === 'Following up on your message — Corner Café' && e1.html.startsWith('<p>Hi Sam,</p>') && e1.html.includes(FOLLOWUP_WORDS[0].replace(/’/g, '’')) && e1.html.includes('Your message:'));
  const e2 = followupEmail(2, { name: '', business: '', words: 'Our own\n\nwords' });
  ok('follow-up 2: the owner\'s words, no name → Hi,', e2.subject === 'One last note about your message' && e2.html.startsWith('<p>Hi,</p><p>Our own</p><p>words</p>'));
  const a = enquiryAckCopy({ name: 'Sam Lee', studio: 'Corner Café', words: 'We read every message.' });
  ok('ack: the owner\'s words get their own line after the greeting', a.sentence === 'Hi Sam,\n\nWe read every message.' && a.subject === 'We got your message — Corner Café');
  ok('ack: no words → the standard sentence, unchanged', enquiryAckCopy({ name: 'Sam' }).sentence === 'Hi Sam — ' + ENQUIRY_ACK_SENTENCE.charAt(0).toLowerCase() + ENQUIRY_ACK_SENTENCE.slice(1));
  const commercial = read('supabase/functions/presence/routes/commercial.ts');
  ok('ack: both form paths pass the message, and the email quotes it', /acknowledgeEnquiry\(siteId, \{ name: fv\.sub\.name, email: fv\.sub\.email, message: fv\.sub\.message \}\)/.test(commercial) && /quoteBlock\(sub\.message\)/.test(commercial) && /words: auto\.auto_ack_message/.test(commercial));
}

// ═══ 5. the second overdue reminder ═══
{
  const inv = { status: 'open', stripe_url: 'https://pay.example/x', created_at: '2026-10-01T10:00:00Z', due_date: '2026-10-20' };
  ok('again: off → the after-leg as before', invoiceReminderSlot(inv, '2026-10-30', 2) === 'after' && invoiceReminderSlot(inv, '2026-10-30', 2, false) === 'after');
  ok('again: on → from N+7 days past due', invoiceReminderSlot(inv, '2026-10-28', 2, true) === 'after' && invoiceReminderSlot(inv, '2026-10-29', 2, true) === 'again');
  ok('again: only a week after the after-leg went', legToSend('again', ago(6.4), NOW) === null && legToSend('again', ago(6.6), NOW) === 'again' && INVOICE_AGAIN_DAYS === 7);
  ok('again: with no after-leg yet, that one goes first', legToSend('again', null, NOW) === 'after' && legToSend('due', null, NOW) === 'due');
  const c = invoiceReminderCopy('again', 'invoice', '$400.00', 'Website');
  ok('again: its own words', c.subject === 'Still open — Website ($400.00)' && /second reminder/.test(c.line));
}

// ═══ 6. a week before it runs out ═══
{
  ok('expiry: inside the week, sent, not replaced', quoteExpiryDue({ status: 'sent', expires_at: new Date(NOW + 6 * DAY).toISOString() }, NOW) && QUOTE_EXPIRY_LEAD_DAYS === 7);
  ok('expiry: not yet, already gone, decided or replaced → no', !quoteExpiryDue({ status: 'sent', expires_at: new Date(NOW + 8 * DAY).toISOString() }, NOW) && !quoteExpiryDue({ status: 'sent', expires_at: new Date(NOW - 1000).toISOString() }, NOW)
    && !quoteExpiryDue({ status: 'accepted', expires_at: new Date(NOW + 2 * DAY).toISOString() }, NOW) && !quoteExpiryDue({ status: 'sent', superseded: true, expires_at: new Date(NOW + 2 * DAY).toISOString() }, NOW));
  const q = quoteExpiryCopy('proposal', 'Website refresh', '2026-12-11T20:00:00Z', 'America/Los_Angeles');
  ok('expiry: the day in the studio\'s time zone, the title escaped', q.subject === 'Good until December 11 — Website refresh' && q.line.includes('<strong>December 11</strong>') && quoteExpiryCopy('estimate', '<i>', '2026-12-11T20:00:00Z').line.includes('&lt;i&gt;'));
}

// ═══ 7. the pages ═══
{
  const st = read('settings.html');
  ok('settings: the follow-up placeholders are the standard words', st.includes(`placeholder="${FOLLOWUP_WORDS[0]}"`) && st.includes(`placeholder="${FOLLOWUP_WORDS[1]}"`));
  ok('settings: the acknowledgement placeholder and preview are the standard sentence', st.includes(`placeholder="${ENQUIRY_ACK_SENTENCE}"`) && st.includes(`const ACK_SENTENCE = '${ENQUIRY_ACK_SENTENCE}';`));
  ok('settings: the week-before preview mirrors quoteExpiryCopy', st.includes('A quick note: your proposal for Website refresh is good until December 11, a week from now. Here’s the link if you’d like another look.'));
  ok('settings: six recipes, two of them a client\'s too', (st.match(/\{ key: '(ack|fu|inv|exp|rev|deal)', title:/g) || []).length === 6 && (st.match(/row: 'row-(ack|fu)', scoped: true \}/g) || []).length === 2);
  ok('settings: each new switch saves its own column', ["flip('sw-fu', 'enquiry_followups')", "flip('sw-inv2', 'invoice_overdue_repeat')", "flip('sw-exp', 'quote_expiry_reminders')"].every((x) => st.includes(x)));
  const content = read('supabase/functions/presence/routes/content.ts');
  ok('content.ts: PUT /settings takes the 0175 fields, and reads step down past them', /enquiry_followup_1_days: \{ kind: 'int', min: 1, max: 14 \}/.test(content) && /const OPTIONAL_SETTINGS_COLS = \[(?:[A-Z_]+, )*RECIPE_SETTINGS_COLS,/.test(content));
  const inbox = read('inbox.html');
  ok('inbox: the follow-ups show on the enquiry, with Stop follow-ups', /function followupHtml\(l\)/.test(inbox) && /\$\{followupHtml\(l\)\}/.test(inbox) && /api\('\/forms\/inbox\/'\+encodeURIComponent\(it\.lead_id\),'POST',\{followups:'off'\}\)/.test(inbox));
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  ok('lifecycle: the follow-ups ride the leads step, the expiry note the documents step', /const followups = \(await runEnquiryFollowups\(limit\)/.test(life) && /const expiry = \(await runQuoteExpiryReminders\(limit\)/.test(life));
  ok('lifecycle: a follow-up is sent only after its ledger row is new, and is not critical', /period: `enqfollow:\$\{sub\.id\}:\$\{step\}`, status: 'dismissed'/.test(life) && /if \(!fresh\) continue;   \/\/ this one already went: never twice/.test(life) && /mail\.html, brand, \{ asBusiness: true, siteId: sub\.site_id, replyTo \}\)/.test(life));
  const mig = read('supabase/migrations/0175_follow_ups_recipes.sql');
  ok('0175: the auto-reply defaults on for new rows; every new switch off', /alter column auto_ack_enquiries set default true/.test(mig) && /enquiry_followups boolean not null default false/.test(mig) && /invoice_overdue_repeat boolean not null default false/.test(mig) && /quote_expiry_reminders boolean not null default false/.test(mig));
  ok('0175: an apply pack with a check', /select column_name, data_type, column_default/.test(read('docs/presence/APPLY-0175-prod.sql')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FOLLOW-UPS & RECIPES: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
