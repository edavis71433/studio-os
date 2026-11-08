// ── One notice row per subject (sales review, Nov 2026, B3) ─────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/notice_one_per_subject_test.mjs
//
// Live on Nov 8 2026: "Waiting on you — <subject>" listed twice on Today, in the
// Inbox and under the bell for each of two support requests, because the weekly
// re-raise (`support:<id>:w<N>`) never retired last week's copy. And "Proposal
// accepted" stayed up beside "Agreement signed" for the same deal. This pins the
// pure rule (renderableNotices) that keeps only the newest bucket per subject and
// drops the accepted step once the same deal is signed, and the two sources the
// fix leans on: the bell reads the period, and stale rows are cleared by their
// own kind.
const F = await import('../../supabase/functions/presence/lib/inbox_feed.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const REQ_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const REQ_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const DEAL = 'cccccccc-3333-4333-8333-cccccccccccc';
const OTHER_DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';

// ── noticeBucket: which periods are bucketed, and how they rank ──
eq('a weekly support bucket', F.noticeBucket('support_aging', `support:${REQ_A}:w2950`), { subject: `support_aging|support:${REQ_A}`, rank: 2950 });
eq('the bare legacy period ranks oldest', F.noticeBucket('support_aging', `support:${REQ_A}`), { subject: `support_aging|support:${REQ_A}`, rank: -1 });
eq('a day bucket (site_down) ranks by date', F.noticeBucket('site_down', 'site:s1:2026-11-08'), { subject: 'site_down|site:s1', rank: 20261108 });
eq('a stall nudge on a deal', F.noticeBucket('deal_followup', `deal:${DEAL}:w2950`)?.rank, 2950);
eq('deal: on another kind is not a stall nudge', F.noticeBucket('deal_signed', `deal:${DEAL}:w2950`), null);
eq('an invoice reminder is not bucketed', F.noticeBucket('deal_followup', `invremind:${REQ_A}:due`), null);
eq('a document reminder is not bucketed', F.noticeBucket('deal_followup', 'remind:doc-1'), null);
eq('an unknown third part is not a bucket', F.noticeBucket('support_aging', `support:${REQ_A}:x9`), null);
eq('a blank period', F.noticeBucket('support_aging', ''), null);

// ── renderableNotices: the live case ──
const rows = [
  { id: 'a2', kind: 'support_aging', period: `support:${REQ_A}:w2951` },   // newest for A → keep
  { id: 'a1', kind: 'support_aging', period: `support:${REQ_A}:w2950` },   // older A → stale
  { id: 'a0', kind: 'support_aging', period: `support:${REQ_A}` },         // legacy A → stale
  { id: 'b1', kind: 'support_aging', period: `support:${REQ_B}:w2950` },   // only B → keep
  { id: 's1', kind: 'deal_signed', period: `signed:${DEAL}` },             // keep
  { id: 'p1', kind: 'deal_signed', period: `accepted:${DEAL}` },           // signed → stale
  { id: 'p2', kind: 'deal_signed', period: `accepted:${OTHER_DEAL}` },     // not signed yet → keep
  { id: 'l1', kind: 'lead_followup', period: 'lead:l1' },                  // a lone legacy row → keep
  { id: 'n1', kind: 'deal_followup', period: 'remind:doc-1' },             // unbucketed → keep
];
const r = F.renderableNotices(rows, null);
eq('keeps one row per subject, in the original order', r.keep.map((n) => n.id), ['a2', 'b1', 's1', 'p2', 'l1', 'n1']);
eq('older weeks and the accepted step are stale', r.stale.map((n) => n.id).sort(), ['a0', 'a1', 'p1']);
eq('the bell counts what Today renders', F.studioBellCount({ notices: r.keep, newEnquiries: 0 }), 6);

// the order rows arrive in does not decide which bucket wins
const rev = F.renderableNotices([...rows].reverse(), null);
eq('reversed input: the same rows kept', rev.keep.map((n) => n.id).sort(), ['a2', 'b1', 'l1', 'n1', 'p2', 's1']);

// a lone bucket of any shape always renders
eq('a single old-shape row is kept', F.renderableNotices([{ id: 'x', kind: 'support_aging', period: `support:${REQ_A}` }], null).keep.length, 1);
eq('two days of the same outage → the newer day', F.renderableNotices([
  { id: 'd1', kind: 'site_down', period: 'site:s1:2026-11-07' }, { id: 'd2', kind: 'site_down', period: 'site:s1:2026-11-08' },
], null).keep.map((n) => n.id), ['d2']);
// the invoice rule still works alongside
eq('a paid invoice reminder is still stale', F.renderableNotices([{ id: 'i', kind: 'deal_followup', period: `invremind:${REQ_A}` }], new Set()).stale.length, 1);

// ── the sources the rule depends on ──
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the bell read selects the period (else nothing can collapse in the count)', /presence_plan_notices\?site_id=eq\.\$\{site\.id\}&status=eq\.active&select=id,kind,period&limit=100/.test(ws));
ok('stale rows are cleared by their own kind, not a hard-coded one', /clearNotice\(String\(site\.client_id\), String\(n\.kind\), String\(n\.period\)\)/.test(ws));
const sales = read('supabase/functions/presence/routes/sales.ts');
ok('signing clears the accepted step at the source', /if \(event === 'signed'\) await clearNotice\(site\.client_id, 'deal_signed', `accepted:\$\{dealId\}`\)/.test(sales));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
