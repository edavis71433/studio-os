// ── Phase 3: one source for numbers + stage-aware next steps — pure rules ────
// renderableNotices / invoiceReminderIds (lib/inbox_feed.ts): one row per real
// record on Today/Inbox/bell. nextStepStaleAfter + ALL_TIME_WINDOW_DAYS
// (lib/sales_lifecycle.ts): a next step that names a thing that has happened is
// cleared; the win rate counts every closed deal.
const F = await import('../../supabase/functions/presence/lib/inbox_feed.ts');
const L = await import('../../supabase/functions/presence/lib/sales_lifecycle.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

const INV_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const INV_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const rows = [
  { id: 'n1', kind: 'deal_followup', period: `invremind:${INV_A}` },     // still open → keep
  { id: 'n2', kind: 'deal_followup', period: `invremind:${INV_B}` },     // paid → stale
  { id: 'n3', kind: 'deal_followup', period: 'remind:doc-1' },           // a document reminder → keep
  { id: 'n4', kind: 'client_message', period: 'thread:1' },              // throttle row → never renders
  { id: 'n5', kind: 'lead_followup', period: 'lead:l1' },                // keep
  { id: 'n6', kind: 'deal_followup', period: 'invremind:not-a-uuid' },   // malformed → keep, never queried
];

// invoiceReminderIds
eq('reminder ids: only the UUID invremind periods, deduped', F.invoiceReminderIds(rows), [INV_A, INV_B]);
eq('reminder ids: empty input → []', F.invoiceReminderIds([]), []);

// renderableNotices with the invoices read in hand
const r = F.renderableNotices(rows, new Set([INV_A]));
eq('keeps the open reminder, the doc reminder, the lead, the malformed one', r.keep.map((n) => n.id), ['n1', 'n3', 'n5', 'n6']);
eq('the paid invoice reminder is stale', r.stale.map((n) => n.id), ['n2']);
ok('the client_message throttle row is neither kept nor stale', !r.keep.some((n) => n.id === 'n4') && !r.stale.some((n) => n.id === 'n4'));

// a failed invoices read (null) keeps every reminder — never an under-count
const r2 = F.renderableNotices(rows, null);
eq('null open-set: reminders all kept', r2.keep.map((n) => n.id), ['n1', 'n2', 'n3', 'n5', 'n6']);
eq('null open-set: nothing stale', r2.stale.length, 0);

// the bell counts the same rows Today renders
const counted = F.studioBellCount({ notices: r.keep, newEnquiries: 0 });
eq('bell: 4 renderable notices → 4', counted, 4);

// nextStepStaleAfter
ok('signed: "Sign contract" is stale', L.nextStepStaleAfter('Sign contract', 'signed'));
ok('signed: "Get the agreement signed" is stale', L.nextStepStaleAfter('Get the agreement signed', 'signed'));
ok('signed: "Call Friday about the menu" stays', !L.nextStepStaleAfter('Call Friday about the menu', 'signed'));
ok('signed: "Request the deposit" stays (not yet done)', !L.nextStepStaleAfter('Request the deposit', 'signed'));
ok('won: "Request the deposit" is stale', L.nextStepStaleAfter('Request the deposit', 'won'));
ok('won: "Close the deal" is stale', L.nextStepStaleAfter('Close the deal', 'won'));
ok('won: "Kickoff call" stays', !L.nextStepStaleAfter('Kickoff call', 'won'));
ok('empty / null → never stale', !L.nextStepStaleAfter('', 'won') && !L.nextStepStaleAfter(null, 'signed'));

// win rate over all time
const NOW = '2026-10-19T12:00:00.000Z';
const deals = [
  { stage: 'won', converted_client_id: 'c1', converted_at: '2026-08-08T10:00:00Z', expected_value_cents: 320000 },
  { stage: 'won', converted_client_id: 'c2', converted_at: '2026-05-01T10:00:00Z', expected_value_cents: 180000 },
  { stage: 'won', converted_client_id: 'c3', converted_at: '2026-01-15T10:00:00Z', expected_value_cents: 90000 },
  { stage: 'lost', updated_at: '2025-11-01T10:00:00Z', expected_value_cents: 1 },
];
const s90 = L.summarizePipeline(deals, NOW);
const sAll = L.summarizePipeline(deals, NOW, L.ALL_TIME_WINDOW_DAYS);
eq('90-day window still sees 1 of 1', [s90.win_rate.won, s90.win_rate.lost], [1, 0]);
eq('all time sees 3 won, 1 lost', [sAll.win_rate.won, sAll.win_rate.lost], [3, 1]);
eq('all time pct = 75', sAll.win_rate.pct, 75);
eq('all time reports its window', sAll.win_rate.window_days, 3650);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log('FAILURES'); failed.forEach((f) => console.log(' -', f)); Deno.exit(1); }
