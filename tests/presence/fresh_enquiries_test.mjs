// ── FIX 1 dedupe: one lead never stacks two signals (freshEnquiries) ─────────
//   deno run --allow-read tests/presence/fresh_enquiries_test.mjs
// The lead-followup cron raises a per-lead notice for AGED 'new' enquiries, so
// every counter of new enquiries must subtract those notices. The rule lives in
// ONE pure helper (lib/inbox_feed.ts freshEnquiries); this suite pins its
// behaviour, and that /attention, the portal feed and the bell all route
// through it (/attention used to skip it and showed an aged lead as two cards).
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { freshEnquiries, studioBellCount } = await import('../../supabase/functions/presence/lib/inbox_feed.ts');
const LF = { kind: 'lead_followup' };

// ── behaviour ────────────────────────────────────────────────────────────────
ok('no notices: every new enquiry is fresh', freshEnquiries(3, []) === 3);
ok('each lead_followup notice speaks for one enquiry', freshEnquiries(3, [LF]) === 2 && freshEnquiries(3, [LF, LF]) === 1);
ok('other notice kinds are not subtracted', freshEnquiries(2, [{ kind: 'payment_trouble' }, { kind: 'website_enquiry' }, {}]) === 2);
ok('floored at 0 when follow-ups outnumber new enquiries', freshEnquiries(1, [LF, LF, LF]) === 0 && freshEnquiries(0, [LF]) === 0);
ok('tolerates missing inputs (best-effort reads arrive empty)', freshEnquiries(0, []) === 0 && freshEnquiries(undefined, undefined) === 0 && freshEnquiries(2, [null, LF]) === 1);
const bell = (notices, newEnquiries) => studioBellCount({ notices, newEnquiries, proposedPlans: 0, proposedWrites: 0, filesPending: 0, openFeedback: 0, openSupport: 0, clientEvents: [], lastSeenAt: null });
ok('bell: an aged lead (1 enquiry + its follow-up notice) counts once', bell([LF], 1) === 1, `got ${bell([LF], 1)}`);

// ── wiring: every counter routes through the ONE helper ──────────────────────
const attention = read('supabase/functions/presence/routes/attention.ts');
const workspace = read('supabase/functions/presence/routes/workspace.ts');
ok('/attention dedupes new_enquiries against its notices',
  /import \{ freshEnquiries \} from '\.\.\/lib\/inbox_feed\.ts'/.test(attention) &&
  /new_enquiries: freshEnquiries\(num\(enquiryQ\), notices\)/.test(attention));
ok('portal feed dedupes via freshEnquiries', /const newEnquiries = freshEnquiries\(/.test(workspace));
ok('no inline copy of the rule is left in the routes',
  !/kind === 'lead_followup'\)\.length/.test(workspace) && !/kind === 'lead_followup'\)\.length/.test(attention));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FRESH ENQUIRIES DEDUPE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
