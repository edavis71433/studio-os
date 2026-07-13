// ── Owner broadcasts — pure + injected-dep logic (owner-approved email) ──────
//   deno run --allow-read --allow-env --allow-net tests/presence/broadcast_test.mjs
// Segment membership, suppression filtering (a suppressed/opted-out contact is
// NEVER a recipient), merge-token rendering + escaping, scheduled-send due logic,
// send-once idempotency, and recipient-count honesty. All exercised without a live
// database via injectable deps — the same "inject the impure edge" pattern the
// Writer uses for its model caller.
import {
  SEGMENTS, isSegmentKey, segmentLabel,
  firstNameOf, renderMergeTokens, renderSubject, buildEmailHtml,
  normalizeRecipients, partitionSuppressed,
  validSubject, cleanBody, cleanSubject,
  broadcastDue, scheduleDecision,
  resolveSendable, dispatchBroadcast,
} from '../../supabase/functions/presence/lib/broadcast.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ═══ Segments ═══
ok('segments: three site-scoped presets exist', SEGMENTS.length === 3 && SEGMENTS.every((s) => s.key && s.label && s.description));
ok('segments: isSegmentKey guards the whitelist', isSegmentKey('contacts') && isSegmentKey('enquiries_30d') && !isSegmentKey('audit_leads') && !isSegmentKey('') && !isSegmentKey(null));
ok('segments: label lookup, safe fallback', segmentLabel('contacts') === 'All contacts' && segmentLabel('nope') === 'your audience');

// ═══ Merge tokens: rendering + escaping ═══
ok('merge: tokens fill in', renderMergeTokens('Hi {{first_name}} from {{business_name}}', { firstName: 'Ada', businessName: 'Acme Co' }) === 'Hi Ada from Acme Co');
ok('merge: warm fallbacks when values missing', renderMergeTokens('Hi {{first_name}} from {{business_name}}', {}) === 'Hi there from us');
ok('merge: case/space tolerant token syntax', renderMergeTokens('{{ First_Name }}', { firstName: 'Bo' }) === 'Bo');
// HTML/markdown injection through a merge value must be neutralized
ok('merge: html-structural chars stripped from values', renderMergeTokens('{{first_name}}', { firstName: 'Al<script>' }) === 'Alscript');
ok('merge: markdown-formatting chars stripped from values', renderMergeTokens('{{first_name}}', { firstName: '**bold**' }) === 'bold');
const htmlOut = buildEmailHtml('Hello {{first_name}}, welcome to {{business_name}}.', { firstName: 'Al<b>x', businessName: 'A&B' });
ok('merge: rendered body has NO raw html from a hostile name', !htmlOut.includes('<b>') && !htmlOut.toLowerCase().includes('<script'));
ok('merge: rendered body escapes ampersand (markdown escape-first)', htmlOut.includes('A&amp;B') || htmlOut.includes('A&amp;amp;B'));
ok('merge: body renders through markdown (wrapped in <p>)', /^<p>/.test(buildEmailHtml('one line', {})));
ok('firstNameOf: first token only, cleaned', firstNameOf('Ada Lovelace') === 'Ada' && firstNameOf('') === '' && firstNameOf('  Jón  Múller ') === 'Jón');

// ═══ Subject rendering ═══
ok('subject: merges + flattens to one line, bounded', renderSubject('Hi {{first_name}}\nnews', { firstName: 'Bo' }) === 'Hi Bo news');
ok('subject: validSubject rejects empty / over-long', validSubject('A quick note') && !validSubject('') && !validSubject('   ') && !validSubject('x'.repeat(201)));
ok('cleanSubject / cleanBody strip control chars but keep content', cleanSubject('a\r\nb') === 'a b' && cleanBody('para\n\nmore').includes('\n'));

// ═══ Recipient normalization: honesty (dedupe, invalid, blanks) ═══
const norm = normalizeRecipients([
  { email: 'Kay@X.com', name: 'Kay Keep' },
  { email: 'kay@x.com', name: 'dup lowercased' },   // duplicate (case-insensitive)
  { email: 'no-at-sign', name: 'invalid' },          // invalid → dropped
  { email: '', name: 'blank' },                       // blank → dropped
  { email: 'bo@x.com', name: 'Bo Brady' },
]);
ok('recipients: de-duplicated case-insensitively + lower-cased', norm.length === 2 && norm[0].email === 'kay@x.com');
ok('recipients: invalid + blank addresses dropped (count honesty)', norm.every((r) => r.email.includes('@')) && norm[1].email === 'bo@x.com');
ok('recipients: first name derived for merge', norm[0].firstName === 'Kay' && norm[1].firstName === 'Bo');

// ═══ Suppression filtering (pure partition) ═══
const part = partitionSuppressed(
  [{ email: 'a@x.com', firstName: 'A' }, { email: 'b@x.com', firstName: 'B' }, { email: 'c@x.com', firstName: 'C' }],
  new Set(['b@x.com']),
);
ok('suppression: partition keeps un-suppressed, sets aside suppressed', part.kept.length === 2 && part.skipped.length === 1 && part.skipped[0].email === 'b@x.com');

// ═══ Suppression filtering (resolveSendable, injected deps — no DB) ═══
const suppressed = new Set(['supp@x.com']);
const fetchRows = async (_key) => [
  { email: 'keep@x.com', name: 'Kay Keep' },
  { email: 'SUPP@x.com', name: 'Sup Pressed' },     // suppressed → never a recipient
  { email: 'keep@x.com', name: 'dup' },              // duplicate
  { email: 'bad', name: 'invalid' },                  // invalid
];
const sendable = await resolveSendable('site1', 'contacts', { fetchRows, isSuppressed: async (e) => suppressed.has(e) });
ok('sendable: audience counts distinct valid (pre-suppression)', sendable.audience === 2);
ok('sendable: a SUPPRESSED address is NEVER a recipient', sendable.recipients.length === 1 && sendable.recipients[0].email === 'keep@x.com');
ok('sendable: suppressed count reported honestly', sendable.suppressed === 1);

// ═══ Scheduled-send due logic ═══
const NOW = '2026-07-13T12:00:00.000Z';
ok('due: a past scheduled send is due', broadcastDue({ status: 'scheduled', scheduled_at: '2026-07-13T11:00:00.000Z' }, NOW));
ok('due: a future scheduled send is NOT due', !broadcastDue({ status: 'scheduled', scheduled_at: '2026-07-13T13:00:00.000Z' }, NOW));
ok('due: a draft/sent/canceled row is never due', !broadcastDue({ status: 'draft', scheduled_at: '2020-01-01T00:00:00.000Z' }, NOW) && !broadcastDue({ status: 'sent', scheduled_at: '2020-01-01T00:00:00.000Z' }, NOW));
ok('schedule: no time = send now', scheduleDecision(undefined, NOW).mode === 'now' && scheduleDecision('', NOW).mode === 'now');
ok('schedule: a future time schedules', (() => { const d = scheduleDecision('2026-07-14T09:00:00.000Z', NOW); return d.mode === 'scheduled' && d.scheduledAt === '2026-07-14T09:00:00.000Z'; })());
ok('schedule: a past time collapses to send-now', scheduleDecision('2026-07-13T11:59:00.000Z', NOW).mode === 'now');
ok('schedule: an unparseable time is rejected', scheduleDecision('not-a-date', NOW).error === 'bad_time');

// ═══ Dispatch: send-once idempotency + suppression-respecting ═══
{
  const claimed = new Set();
  const claimFn = async (bid, _sid, email) => { const k = bid + '|' + email.toLowerCase(); if (claimed.has(k)) return 'duplicate'; claimed.add(k); return 'inserted'; };
  const sent = [];
  const sendFn = async (to) => { sent.push(to); return true; };
  const loadBrand = async () => ({ name: 'Acme Co', accent: '#5b3fa0', accentDark: '#3a2470' });
  const resolveFn = async () => ({ recipients: [{ email: 'a@x.com', firstName: 'Al' }, { email: 'b@x.com', firstName: 'Bo' }], suppressed: 1, audience: 3 });
  const b = { id: 'bc1', site_id: 's1', subject: 'Hi {{first_name}}', body: 'Hello {{first_name}} from {{business_name}}', audience: 'contacts' };

  const r1 = await dispatchBroadcast(b, { claimFn, sendFn, loadBrand, resolveFn });
  ok('dispatch: sends once to each un-suppressed recipient', r1.sent === 2 && r1.failed === 0 && r1.skipped === 1 && sent.length === 2);

  const r2 = await dispatchBroadcast(b, { claimFn, sendFn, loadBrand, resolveFn });
  ok('dispatch: send-once — a re-run mails NO ONE again (idempotent)', r2.sent === 0 && r2.already === 2 && sent.length === 2);

  // a send failure is counted, not silently dropped
  const failClaimed = new Set();
  const failClaim = async (bid, _s, e) => { const k = bid + '|' + e; if (failClaimed.has(k)) return 'duplicate'; failClaimed.add(k); return 'inserted'; };
  const r3 = await dispatchBroadcast(b, { claimFn: failClaim, sendFn: async () => false, markFailedFn: async () => {}, loadBrand, resolveFn });
  ok('dispatch: a failed send is counted as failed', r3.sent === 0 && r3.failed === 2);
}

// ═══ summary ═══
const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error('FAILED:\n' + failed.map((r) => '  - ' + r.n).join('\n')); Deno.exit(1); }
