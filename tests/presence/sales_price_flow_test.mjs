// ── "The price is typed once and flows to the end" (operator audit 1, 2, 8 + two long-tail) ──
// Five defects, one theme: the number Eric types into a proposal must reach the
// contract placeholders, the deposit invoice, the pipeline rollup and the deal's
// record without being retyped — and the drawer must never contradict the signed
// fact. This suite pins each link in that chain:
//   1. proposal ACCEPT backfills the deal value (never clobbering a hand-set one)
//   2. contract SEND mints the deposit — once, ever, from the SAME split the
//      document printed; skips + warns on a valueless deal; never $0
//   3. the drawer guidance branches on the signed FACT (convert, not "get it signed")
//   4. the renewal reminder can actually arm (hint + honest prefill, no invented dates)
//   5. the enquiry text travels onto the deal (notes + the created event)
//
//   deno run --allow-read tests/presence/sales_price_flow_test.mjs
import { depositSplit, buildPlaceholderValues } from '../../supabase/functions/presence/lib/doc_placeholders.ts';
import { agreementSigned, impliedTermMonths, summarizePipeline, proposalTotals } from '../../supabase/functions/presence/lib/sales_lifecycle.ts';
import { PIPELINE_GUIDANCE, CONTRACT_SIGNED_GUIDANCE, guidanceFor } from '../../supabase/functions/presence/lib/pipeline_guidance.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const sales = read('supabase/functions/presence/routes/sales.ts');
const pipe = read('pipeline.html');

// ═══ 0. depositSplit — the ONE split both the document and the invoice speak ═══
{
  ok('50/50 on a whole amount', JSON.stringify(depositSplit(380000)) === JSON.stringify({ deposit_cents: 190000, balance_cents: 190000 }));
  const odd = depositSplit(100001);
  ok('an odd total never loses a cent (deposit rounds, balance takes the remainder)', odd.deposit_cents === 50001 && odd.balance_cents === 50000 && odd.deposit_cents + odd.balance_cents === 100001);
  ok('zero / null / garbage → an honest 0-0 split, never NaN', [0, null, undefined, 'x'].every((v) => { const s = depositSplit(v); return s.deposit_cents === 0 && s.balance_cents === 0; }));
  ok('a negative value clamps to 0 (never a negative invoice)', depositSplit(-500).deposit_cents === 0);
  // the placeholder renderer actually uses it — the printed deposit IS this split
  const src = read('supabase/functions/presence/lib/doc_placeholders.ts');
  ok('buildPlaceholderValues computes its figures THROUGH depositSplit (one source of truth)', /depositSplit\(cents\)/.test(src) && !/Math\.round\(cents \/ 2\);\s*\/\/ §2/.test(src));
  const vals = buildPlaceholderValues({ deal: { expected_value_cents: 380000 }, contact: null, studioName: '', now: new Date(Date.UTC(2026, 7, 7)) });
  ok('the printed deposit equals depositSplit’s figure', vals.deposit_amount === '$1,900' && vals.balance_amount === '$1,900');
}

// ═══ 1. Accept → backfill (the deal value is written exactly once) ═══
{
  const h = sales.slice(sales.indexOf('export async function handleSalesProposalDecide'), sales.indexOf('export async function handleSalesProposalDelete'));
  ok('accept backfills expected_value_cents from the accepted proposal’s totals', /proposalTotals\(p\.line_items\)\.total_cents/.test(h) && /expected_value_cents: total/.test(h));
  ok('the backfill NEVER clobbers a hand-set value — eq.0 guard rides in the PATCH’s WHERE', /presence_deals\?id=eq\.\$\{dealId\}&site_id=eq\.\$\{tok\.site_id\}&expected_value_cents=eq\.0/.test(h));
  ok('the backfill is bounded like every other value write ($1,000,000 cap)', /Math\.min\(1_000_000_00, proposalTotals/.test(h));
  ok('a $0 proposal total backfills nothing (total > 0 gate)', /if \(total > 0\)/.test(h));
  ok('the change is ON THE RECORD — value_backfilled_cents rides the proposal_decided event', /value_backfilled_cents: backfilledCents/.test(h));
  ok('only an accept backfills (the whole block is decision===accepted-gated)', /if \(decision === 'accepted'\) \{\s*\n\s*try \{/.test(h));
  ok('best-effort: a failed backfill cannot sink the accept (try/catch around it)', /catch \{ \/\* best-effort — the summary/.test(h));
  // the drawer's history line names the backfill (pipeline.html mirror)
  ok('pipeline.html’s event label surfaces the backfilled value', /value_backfilled_cents\?' — deal value set to '\+money\(d\.value_backfilled_cents\)/.test(pipe));

  // …and the backfilled value is exactly what the rollup then counts as won:
  const total = proposalTotals([{ label: 'Site', qty: 1, unit_cents: 380000 }]).total_cents;
  const now = '2026-08-10T12:00:00.000Z';
  const summary = summarizePipeline([{ stage: 'won', expected_value_cents: total, converted_at: '2026-08-09T00:00:00.000Z' }], now);
  ok('won rolls up the backfilled value (never $0 again)', summary.won_month.value_cents === 380000 && summary.won_month.count === 1, `won_month=${summary.won_month.value_cents}`);
  const zero = summarizePipeline([{ stage: 'won', expected_value_cents: 0, converted_at: '2026-08-09T00:00:00.000Z' }], now);
  ok('…which is precisely the defect: a 0-value won deal rolls up as $0', zero.won_month.value_cents === 0);
}

// ═══ 2. Contract send → the deposit mints itself (once, honestly) ═══
{
  ok('ensureDepositForContractSend exists', /async function ensureDepositForContractSend\(/.test(sales));
  const h = sales.slice(sales.indexOf('async function ensureDepositForContractSend'), sales.indexOf('export async function handleSalesContractSend'));
  ok('amount comes from the SAME depositSplit the document printed', /depositSplit\(deal\.expected_value_cents\)/.test(h));
  ok('NEVER a ~$0 invoice — Stripe’s 50¢ floor gates the mint', /deposit_cents < 50/.test(h));
  ok('a valueless deal skips the mint AND warns (no_value rides back to the drawer)', /warning: 'no_value'/.test(h));
  ok('a body that never says "deposit" mints nothing (the doc made no promise)', /\/deposit\/i\.test\(String\(contract\.body/.test(h));
  ok('AT MOST ONCE, EVER — the prior-deposit guard matches ANY status (open, paid, void)', /purpose=eq\.deposit&deleted_at=is\.null&select=id,status&limit=1/.test(h) && !/purpose=eq\.deposit&status=eq\.open[^`]*limit=1`\)\);\s*\n\s*if \(prior/.test(h));
  ok('the minted row is the SAME shape "Request a deposit" writes (purpose deposit, open)', /purpose: 'deposit', status: 'open'/.test(h));
  ok('the mint is on the deal’s record (invoice_sent event, marked automatic)', /'invoice_sent', principal, \{ detail: \{ invoice_id: inv\.id, amount_cents: deposit_cents, purpose: 'deposit', auto: 'contract_send' \}/.test(h));
  ok('the deposit is NOT emailed at send (the pay link is handed over on the sign page)', !/emailInvoice\(/.test(h));
  ok('Stripe-unconfigured environments skip the mint (a linkless invoice can’t land on pay)', /if \(!stripeConfigured\(\)\) return \{ minted: false \}/.test(h));
  ok('best-effort by construction — the whole helper is wrapped, a mint failure never blocks the send', /^async function ensureDepositForContractSend[\s\S]*?try \{[\s\S]*?\} catch \{ return \{ minted: false \}; \}\s*\}/m.test(h));

  const send = sales.slice(sales.indexOf('export async function handleSalesContractSend'), sales.indexOf('export async function handleSalesContractDelete'));
  ok('the FRESH send runs the mint and returns `deposit` to the drawer', /const deposit = await ensureDepositForContractSend\(site, principal, rows\(up\)\[0\]\)/.test(send) && /emailed, deposit \}/.test(send));
  ok('a RESEND runs the same idempotent ensure (an old send still lands its signer on pay; the guard means never twice)', /already_sent: true, deposit: dep/.test(send));
  // the sign→pay handoff this exists FOR is still in place
  ok('sign→pay: the sign route still hands back the open deposit’s pay link', /purpose=eq\.deposit&status=eq\.open&deleted_at=is\.null&select=stripe_url,amount_cents/.test(sales));

  // drawer half: the pre-send warning for valueless deals + the minted-deposit toast
  ok('pipeline.html warns BEFORE sending a valueless agreement (money-blank confirm, same shape as unfilledBlanks)', /const MONEY_BLANK_RE=\/\\\[\(\?:project fee\|50% deposit\|50% balance\)\\\]\//.test(pipe) && /function confirmMoneyBlanks\(/.test(pipe));
  ok('…wired into BOTH send paths (the list button and Save & send)', (pipe.match(/confirmMoneyBlanks\(/g) || []).length >= 3);
  ok('the send toast reports the minted deposit (and drops the stale "request it now" tip)', /dep\.minted\?'\. A '\+money\(dep\.amount_cents\)\+' deposit request is ready/.test(pipe));
}

// ═══ 3. The drawer stops contradicting itself on signed deals ═══
{
  // the signed FACT helper — exported from sales_lifecycle for the sweep to reuse
  ok('agreementSigned: a signed contract row → true', agreementSigned([{ status: 'sent' }, { status: 'signed' }]) === true);
  ok('agreementSigned: sent/draft only → false', agreementSigned([{ status: 'sent' }, { status: 'draft' }]) === false);
  ok('agreementSigned: a soft-deleted signed row does NOT count', agreementSigned([{ status: 'signed', deleted_at: '2026-01-01' }]) === false);
  ok('agreementSigned: garbage in → false, never a throw', agreementSigned(null) === false && agreementSigned('x') === false && agreementSigned([null, 42]) === false);

  // the three-way guidance branch
  ok('unsigned contract stage keeps the current copy', guidanceFor('contract') === PIPELINE_GUIDANCE.contract && guidanceFor('contract', {}) === PIPELINE_GUIDANCE.contract);
  ok('signed-unconverted → the convert copy, never "Get it signed"', guidanceFor('contract', { agreement_signed: true }) === CONTRACT_SIGNED_GUIDANCE && !/signed/i.test(PIPELINE_GUIDANCE.contract.tip.slice(0, 0) + CONTRACT_SIGNED_GUIDANCE.suggested_action));
  ok('the signed copy tells him to convert', /convert/i.test(CONTRACT_SIGNED_GUIDANCE.tip) && /convert/i.test(CONTRACT_SIGNED_GUIDANCE.suggested_action));
  ok('converted → falls back to the stage table (the drawer shows such a deal as won)', guidanceFor('contract', { agreement_signed: true, converted: true }) === PIPELINE_GUIDANCE.contract);
  ok('other stages ignore the facts entirely', guidanceFor('proposal', { agreement_signed: true }) === PIPELINE_GUIDANCE.proposal);
  // same wording discipline as the stage table (pipeline_guidance_test §2/§5)
  const g = CONTRACT_SIGNED_GUIDANCE;
  ok('the signed copy meets the calm bounds (tip ≤160, action ≤120, todos 2-5 ≤200, no markup)',
    g.tip.length <= 160 && g.suggested_action.length <= 120 && g.todos.length >= 2 && g.todos.length <= 5
    && g.todos.every((t) => t.length <= 200 && !/[<>]/.test(t)) && !/[<>]/.test(g.tip + g.suggested_action));

  // pipeline.html mirrors the branch by hand (the existing convention)
  ok('pipeline.html carries the CONTRACT_SIGNED_GUIDANCE mirror', /const CONTRACT_SIGNED_GUIDANCE=\{tip:'They’ve signed — convert them to open their portal and start the project\.'/.test(pipe));
  ok('the client guidanceFor branches on the signed fact', /if\(s==='contract'&&facts&&facts\.signed&&!facts\.converted\)return CONTRACT_SIGNED_GUIDANCE/.test(pipe));
  ok('the drawer passes the signed fact into the guidance strip', /guidanceFor\(stage,\{signed:signedNow,converted:!!d\.converted_client_id\}\)/.test(pipe));
  ok('…and into the stage to-do presets (both the dropdown and its wiring)', (pipe.match(/guidanceFor\(d\.stage,\{signed:signedNow,converted:!!d\.converted_client_id\}\)/g) || []).length >= 2);
  ok('the signed "Do next" DEEP-LINKS the convert button', /id="guideConvert"/.test(pipe) && /const gc=\$\('guideConvert'\); if\(gc\)gc\.onclick=/.test(pipe));
  // the mirror's todos are real strings the server copy also carries (no hand-mirror drift)
  ok('the mirror’s to-dos match the server’s exactly', g.todos.every((t) => pipe.includes(t)));
}

// ═══ 4. The renewal reminder can actually arm ═══
{
  // operative term language → months
  ok('"12-month term" → 12', impliedTermMonths('This engagement is a 12-month term beginning at signing.') === 12);
  ok('"a term of twelve (12) months" → 12', impliedTermMonths('The term of this Agreement is twelve (12) months.') === 12);
  ok('"for a term of 6 months" → 6', impliedTermMonths('The parties engage for a term of 6 months.') === 6);
  ok('"for a period of three (3) months" → 3', impliedTermMonths('Reporting continues for a period of three (3) months.') === 3);
  // the honesty guard: §10's liability lookback is a damages window, NOT a term
  const LOOKBACK = 'in no event shall studio’s total liability exceed the fees paid by client to studio under this agreement in the twelve (12) months immediately preceding the event giving rise to the claim';
  ok('§10’s liability lookback NEVER reads as a term (no invented dates)', impliedTermMonths(LOOKBACK) === null);
  ok('"thirty (30) days" is not months', impliedTermMonths('negotiate for a minimum period of thirty (30) days') === null);
  ok('empty / garbage → null, never a throw', impliedTermMonths('') === null && impliedTermMonths(null) === null && impliedTermMonths(12) === null);
  ok('absurd terms are refused (0 or >60 months)', impliedTermMonths('a 99-month term') === null);

  // the SHIPPED agreements state no operative term — so no default may be
  // derived from them (the audit's premise checked against the actual text:
  // their only twelve-month wording is the §10 lookback).
  const a = pipe.indexOf('/* ==== agreement packages: start'), b = pipe.indexOf('/* ==== agreement packages: end ==== */');
  const PKGS = new Function(`${pipe.slice(a, b)}\nreturn DDS_AGREEMENT_PACKAGES;`)();
  for (const k of Object.keys(PKGS)) {
    ok(`the shipped ${k} agreement yields NO implied term (hint only, no invented default)`, impliedTermMonths(PKGS[k].body) === null);
  }

  // the client mirror is EXECUTED and compared (doc_placeholders_test §7 idiom)
  const start = pipe.indexOf('function impliedTermMonths(');
  let depth = 0, end = -1;
  for (let j = pipe.indexOf('{', start); j < pipe.length; j++) { if (pipe[j] === '{') depth++; else if (pipe[j] === '}' && --depth === 0) { end = j + 1; break; } }
  const mirror = new Function(`${pipe.slice(start, end)}\nreturn impliedTermMonths;`)();
  const CASES = ['a 12-month term', 'The term of this Agreement is twelve (12) months.', 'for a term of 6 months', LOOKBACK, PKGS.growth.body, PKGS.custom_photography.body, PKGS.template_build.body, '', 'no term at all', 'a 99-month term'];
  ok('the pipeline.html mirror ≡ the server helper on every case', CASES.every((c) => mirror(c) === impliedTermMonths(c)),
    CASES.filter((c) => mirror(c) !== impliedTermMonths(c)).map((c) => c.slice(0, 40)).join(' · '));

  // drawer wiring: the hint chip + the visible default (one-tap Save confirms)
  ok('a signed agreement missing term_end renders the hint chip', /No renewal date — the renewal reminder can’t arm\./.test(pipe));
  ok('a detected term PREFILLS signed_at + N months into the date input', /termDefault=addMonthsISO\(k\.signed_at,termMonths\)/.test(pipe) && /value="\$\{esc\(termEnd\|\|termDefault\)\}"/.test(pipe));
  ok('nothing is ever set silently — the default routes through the SAME Save button', /data-set-term="\$\{k\.id\}"/.test(pipe) && !/api\('\/sales\/contracts\/'\+[^)]*\/term'[^)]*\)[^;]*;\s*\/\/ auto/.test(pipe));
  ok('the hint says the default is not set until Save', /press Save to confirm it \(nothing is set until you do\)/.test(pipe));
  // addMonthsISO math (extract + execute)
  const amLine = pipe.split('\n').find((l) => l.startsWith('const addMonthsISO='));
  const addMonths = new Function(`${amLine}\nreturn addMonthsISO;`)();
  ok('addMonthsISO: +12 months lands on the anniversary', addMonths('2026-07-15T10:00:00.000Z', 12) === '2027-07-15');
  ok('addMonthsISO: a month-end overflow normalizes, never NaN', addMonths('2026-01-31', 1) === '2026-03-03' || addMonths('2026-01-31', 1) === '2026-02-28' ? true : false, addMonths('2026-01-31', 1));
  ok('addMonthsISO: garbage → empty string', addMonths('', 12) === '' && addMonths('not-a-date', 12) === '');
}

// ═══ 5. The enquiry text lands on the deal ═══
{
  const h = sales.slice(sales.indexOf('export async function handleSalesDeals'), sales.indexOf('async function loadDeal'));
  ok('the submission read fetches the MESSAGE alongside the tenant check (one query)', /presence_form_submissions\?id=eq\.\$\{srcSub\}&site_id=eq\.\$\{site\.id\}&select=id,message&limit=1/.test(h));
  ok('the enquiry lands in the deal’s notes (visible + editable in Details)…', /enquiry \? clean\(`Website enquiry: \$\{enquiry\}`, 2000\) : ''/.test(h));
  ok('…but NEVER overwrites notes the caller typed (typed notes win)', /notes: clean\(b\.notes, 2000\) \|\| \(enquiry \?/.test(h));
  ok('the enquiry also rides the immutable created event (survives a notes rewrite)', /detail: \{ source_submission_id: srcSub, \.\.\.\(enquiry \? \{ enquiry: enquiry\.slice\(0, 500\) \} : \{\}\) \}/.test(h));
  ok('ADJACENT FIX: the created event no longer posts source_submission_id as a top-level column (presence_deal_events has no such column — the insert 400’d silently and NO created event was ever written)', !/dealEvent\(site\.id, deal\.id, 'created', principal, \{ to_stage: 'lead', source_submission_id/.test(sales));
  ok('the enquiry text is control-char-cleaned and bounded like every operator string', /enquiry = clean\(sub\.message, 2000\)/.test(h));
  // leads.html still promotes with the submission link (the server does the rest)
  const leads = read('leads.html');
  ok('leads.html still links the submission (source_submission_id) — the server carries the text', /source_submission_id:id/.test(leads));
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ SALES PRICE FLOW (audit 1/2/8 + long-tail): ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
