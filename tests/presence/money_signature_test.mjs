// ── Money and signature (studio audit 2026-10 changes 7 + 10; benchmark 6 + 13) ─
// Pure rules + the page mirrors:
//   · signature moves the deal (stageAfterSignature / stageAfterDepositPaid)
//   · the invoice reminder schedule: −7 · due · +N, once per leg, never twice a day
//   · the deal nudge ("no next step for N days") and the three-switch defaults
//   · stale-after-N-days per stage, and pipeline.html's verbatim mirror of it
//   · the enquiry acknowledgement sentence, and settings.html showing it verbatim
//   · the deal page keeps ONE filled button per view (filesystem pins)
//   deno run --allow-read --allow-env tests/presence/money_signature_test.mjs
import { stageAfterSignature, stageAfterDepositPaid, depositStillOpen, dealStaleAfter, staleDaysFor, dealQuietDays, DEFAULT_STALE_DAYS } from '../../supabase/functions/presence/lib/sales_lifecycle.ts';
import { invoiceReminderSlot, invoiceReminderPeriod, invoiceReminderCopy, dealNudgeDue, dealNudgeCopy, automationSettings, AUTOMATION_DEFAULTS } from '../../supabase/functions/presence/commerce/lifecycle.ts';
import { enquiryAckCopy, ENQUIRY_ACK_SENTENCE } from '../../supabase/functions/presence/lib/commercial.ts';
import { invoiceIdOfPeriod, invoiceReminderIds } from '../../supabase/functions/presence/lib/inbox_feed.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ═══ 1. signature moves the deal ═══
{
  const open = { status: 'open', purpose: 'deposit', processing_since: null, deleted_at: null };
  const paid = { status: 'paid', purpose: 'deposit' };
  const settling = { status: 'open', purpose: 'deposit', processing_since: '2026-10-19T00:00:00Z' };
  const voided = { status: 'void', purpose: 'deposit' };
  ok('sign: no deposit at all → Won', stageAfterSignature({ currentStage: 'contract', deposits: [] }) === 'won');
  ok('sign: deposit already paid → Won', stageAfterSignature({ currentStage: 'contract', deposits: [paid] }) === 'won');
  ok('sign: deposit settling (ACH) → Won (not waiting)', stageAfterSignature({ currentStage: 'contract', deposits: [settling] }) === 'won');
  ok('sign: deposit voided → Won', stageAfterSignature({ currentStage: 'contract', deposits: [voided] }) === 'won');
  ok('sign: deposit still OPEN → stays Agreement out', stageAfterSignature({ currentStage: 'contract', deposits: [open] }) === 'contract');
  ok('sign: an open NON-deposit invoice does not hold the deal', stageAfterSignature({ currentStage: 'contract', deposits: [{ ...open, purpose: 'service' }] }) === 'won');
  ok('sign: a lost deal stays lost; a won deal stays won', stageAfterSignature({ currentStage: 'lost', deposits: [] }) === 'lost' && stageAfterSignature({ currentStage: 'won', deposits: [open] }) === 'won');
  ok('depositStillOpen: open & unsettled only', depositStillOpen(open) && !depositStillOpen(paid) && !depositStillOpen(settling) && !depositStillOpen({ ...open, deleted_at: '2026-10-01' }) && !depositStillOpen(null));
  ok('deposit paid: signed + open stage → Won', stageAfterDepositPaid({ currentStage: 'contract', signed: true, purpose: 'deposit' }) === 'won');
  ok('deposit paid: NOT signed → leave the stage', stageAfterDepositPaid({ currentStage: 'contract', signed: false, purpose: 'deposit' }) === null);
  ok('deposit paid: a service invoice is not a close', stageAfterDepositPaid({ currentStage: 'contract', signed: true, purpose: 'service' }) === null);
  ok('deposit paid: already won/lost → null', stageAfterDepositPaid({ currentStage: 'won', signed: true, purpose: 'deposit' }) === null && stageAfterDepositPaid({ currentStage: 'lost', signed: true, purpose: 'deposit' }) === null);
  ok('deposit paid: from an earlier stage (proposal) still → Won once signed', stageAfterDepositPaid({ currentStage: 'proposal', signed: true, purpose: 'deposit' }) === 'won');
  // the route half: the sign handler reads the deposits and moves; the paid echo moves a signed deal
  const sales = read('supabase/functions/presence/routes/sales.ts');
  const commerce = read('supabase/functions/presence/routes/commerce.ts');
  ok('sales.ts: the sign handler asks stageAfterSignature and advances to won', /stageAfterSignature\(\{ currentStage: curStage, deposits: rows\(depR\) \}\) === 'won'/.test(sales) && /advanceStage\(tok\.site_id, dealId, 'won', \['lead', 'qualified', 'proposal', 'contract'\], sys\)/.test(sales));
  ok('sales.ts: the "ready to convert" notice is still raised on signature', /raiseDealReady\(tok\.site_id, dealId, 'signed', id\)/.test(sales));
  ok('commerce.ts: the paid echo moves a signed deal to won (guarded to open stages)', /stageAfterDepositPaid\(/.test(commerce) && /stage=in\.\(lead,qualified,proposal,contract\)&select=id`, \{ method: 'PATCH'/.test(commerce));
}

// ═══ 2. the invoice reminder schedule: −7 · due · +N ═══
{
  const inv = (over) => ({ status: 'open', stripe_url: 'https://pay.example/x', created_at: '2026-10-01T10:00:00Z', due_date: '2026-10-20', processing_since: null, ...over });
  const slot = (today, over = {}, n = 2) => invoiceReminderSlot(inv(over), today, n);
  ok('schedule: 8 days before due → nothing', slot('2026-10-12') === null);
  ok('schedule: 7 days before due → before', slot('2026-10-13') === 'before');
  ok('schedule: the day before due → still the before-leg (one leg per window)', slot('2026-10-19') === 'before');
  ok('schedule: on the due date → due', slot('2026-10-20') === 'due');
  ok('schedule: 1 day after (N=2) → still the due-leg', slot('2026-10-21') === 'due');
  ok('schedule: N days after → after', slot('2026-10-22') === 'after');
  ok('schedule: long after → after (never a fourth)', slot('2026-12-01') === 'after');
  ok('schedule: N is the studio’s — N=5 moves the after-leg', slot('2026-10-22', {}, 5) === 'due' && slot('2026-10-25', {}, 5) === 'after');
  ok('schedule: never on the day the invoice was sent', slot('2026-10-20', { created_at: '2026-10-20T08:00:00Z' }) === null);
  ok('schedule: sent inside the before-window → before, from the next day', slot('2026-10-16', { created_at: '2026-10-15T08:00:00Z' }) === 'before');
  ok('schedule: a settling (processing) payment is not unpaid', slot('2026-10-22', { processing_since: '2026-10-21T00:00:00Z' }) === null);
  ok('schedule: an unsent invoice (no link) has nothing to pay', slot('2026-10-22', { stripe_url: null }) === null);
  ok('schedule: a paid invoice → nothing', slot('2026-10-22', { status: 'paid' }) === null);
  // undated: due a week after sending, no before-leg
  ok('undated: no before-leg (nobody set a date)', slot('2026-10-05', { due_date: null }) === null);
  ok('undated: due = sent + 7 → due-leg', slot('2026-10-08', { due_date: null }) === 'due');
  ok('undated: sent + 7 + N → after', slot('2026-10-10', { due_date: null }) === 'after');
  // disjoint windows ⇒ at most one leg per day, three per invoice
  const days = []; for (let d = 1; d <= 60; d++) days.push(new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10));
  const legs = days.map((t) => slot(t)).filter(Boolean);
  ok('schedule: the legs come in order before → due → after and never regress', JSON.stringify([...new Set(legs)]) === JSON.stringify(['before', 'due', 'after']));
  ok('period: one dedupe key per leg', invoiceReminderPeriod('inv-1', 'before') === 'invremind:inv-1:before' && invoiceReminderPeriod('inv-1', 'after') === 'invremind:inv-1:after');
  const c = invoiceReminderCopy('after', 'invoice', '$1,250.00', '');
  ok('copy: the after-leg is the gentle reminder', /A gentle reminder/.test(c.subject) && /still open/.test(c.line));
  ok('copy: the before-leg says coming up; the due-leg says due today', /Coming up/.test(invoiceReminderCopy('before', 'deposit', '$1', 'Deposit').subject) && /Due today/.test(invoiceReminderCopy('due', 'deposit', '$1', 'Deposit').subject));
  // the inbox feed still finds the invoice id inside the new period shape
  ok('inbox feed: invoice id parses from both period shapes', invoiceIdOfPeriod('invremind:11111111-1111-4111-8111-111111111111:after') === '11111111-1111-4111-8111-111111111111' && invoiceIdOfPeriod('invremind:11111111-1111-4111-8111-111111111111') === '11111111-1111-4111-8111-111111111111');
  ok('inbox feed: invoiceReminderIds dedupes the three legs to one id', invoiceReminderIds([{ kind: 'deal_followup', period: 'invremind:11111111-1111-4111-8111-111111111111:before' }, { kind: 'deal_followup', period: 'invremind:11111111-1111-4111-8111-111111111111:after' }]).length === 1);
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  ok('lifecycle: the sweep is gated on the site’s invoice_reminders switch', /if \(!auto\.invoice_reminders\) continue;/.test(life));
  ok('lifecycle: the earlier legs are silent ledger rows; the after-leg is the active "Still unpaid"', /status: operatorHears \? 'active' : 'dismissed'/.test(life));
  ok('lifecycle: the void route clears the three-leg rows too', /clearNoticePrefix\(site\.client_id, 'deal_followup', `invremind:\$\{id\}:`\)/.test(read('supabase/functions/presence/routes/sales.ts')));
}

// ═══ 3. the three switches: defaults off, N bounded; the deal nudge rule ═══
{
  ok('defaults: every switch OFF', AUTOMATION_DEFAULTS.auto_ack_enquiries === false && AUTOMATION_DEFAULTS.invoice_reminders === false && AUTOMATION_DEFAULTS.deal_nudges === false);
  ok('defaults: +2 days after due, 3 quiet days', AUTOMATION_DEFAULTS.invoice_remind_after_days === 2 && AUTOMATION_DEFAULTS.deal_nudge_days === 3);
  ok('settings: a missing row (pre-0134) reads as the defaults', JSON.stringify(automationSettings(null)) === JSON.stringify(AUTOMATION_DEFAULTS));
  ok('settings: only a literal true switches on', automationSettings({ invoice_reminders: 'true' }).invoice_reminders === false && automationSettings({ invoice_reminders: true }).invoice_reminders === true);
  ok('settings: N outside 1–90 falls back', automationSettings({ invoice_remind_after_days: 0 }).invoice_remind_after_days === 2 && automationSettings({ deal_nudge_days: 400 }).deal_nudge_days === 3 && automationSettings({ deal_nudge_days: 10 }).deal_nudge_days === 10);
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const ago = (d) => new Date(NOW - d * 86400_000).toISOString();
  const deal = (over) => ({ stage: 'proposal', converted_client_id: null, updated_at: ago(5), last_contacted_at: null, next_step_at: null, ...over });
  ok('nudge: quiet 5 days, N=3 → due', dealNudgeDue(deal({}), NOW, 3) === true);
  ok('nudge: quiet 5 days, N=7 → not yet', dealNudgeDue(deal({}), NOW, 7) === false);
  ok('nudge: a logged contact yesterday resets the clock', dealNudgeDue(deal({ last_contacted_at: ago(1) }), NOW, 3) === false);
  ok('nudge: a next step dated ahead is a plan, not silence', dealNudgeDue(deal({ next_step_at: '2026-10-25' }), NOW, 3) === false);
  ok('nudge: a next step dated in the PAST does not excuse it', dealNudgeDue(deal({ next_step_at: '2026-10-10' }), NOW, 3) === true);
  ok('nudge: lead / won / lost / converted never', !dealNudgeDue(deal({ stage: 'lead' }), NOW, 3) && !dealNudgeDue(deal({ stage: 'won' }), NOW, 3) && !dealNudgeDue(deal({ stage: 'lost' }), NOW, 3) && !dealNudgeDue(deal({ converted_client_id: 'c1' }), NOW, 3));
  ok('nudge copy: names N', dealNudgeCopy('qualified', 3) === 'This deal has had no next step for 3 days — a quick follow-up keeps it moving.' && /a day/.test(dealNudgeCopy('qualified', 1)));
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  ok('lifecycle: the deal nudge is gated on the site’s deal_nudges switch and its N', /if \(!auto\.deal_nudges\) continue;/.test(life) && /dealNudgeDue\(deal, Date\.now\(\), auto\.deal_nudge_days\)/.test(life));
  // settings.html mirrors the nudge sentence (N=3 default) verbatim
  const settings = read('settings.html');
  ok('settings.html: the nudge preview is the lifecycle sentence', settings.includes(`<span id="say-deal">${dealNudgeCopy('qualified', 3)}</span>`));
  const invLine = invoiceReminderCopy('after', 'invoice', '$1,250.00', '').line.replace(/<\/?strong>/g, '').replace(/'/g, '’');
  ok('settings.html: the invoice preview is the lifecycle sentence', settings.includes(`<span id="say-inv">${invLine}</span>`), invLine);
  ok('settings.html: three switches, default off, each writes /settings', (settings.match(/role="switch"/g) || []).length === 3 && /flip\('sw-ack', 'auto_ack_enquiries'\)/.test(settings) && /flip\('sw-inv', 'invoice_reminders'\)/.test(settings) && /flip\('sw-deal', 'deal_nudges'\)/.test(settings));
  const content = read('supabase/functions/presence/routes/content.ts');
  ok('content.ts: /settings accepts the six 0134 fields, N bounded 1–90', /auto_ack_enquiries: \{ kind: 'bool' \}/.test(content) && /invoice_remind_after_days: \{ kind: 'int', min: 1, max: 90 \}/.test(content) && /stage_stale_days: \{ kind: 'stage_days' \}/.test(content));
  ok('content.ts: the settings read retries without the 0134 columns (deploy-order tolerant)', /pre-0134/.test(content));
  ok('migration 0134 + its apply pack exist and add the six columns', /add column if not exists stage_stale_days jsonb/.test(read('supabase/migrations/0134_automation_switches.sql')) && /add column if not exists deal_nudge_days integer not null default 3/.test(read('docs/presence/APPLY-0134-prod.sql')));
}

// ═══ 4. the enquiry acknowledgement ═══
{
  const c = enquiryAckCopy({ name: 'Sam Rivera', studio: 'Davis Digital Studio' });
  ok('ack: greets by first name, then the one sentence', c.sentence === 'Hi Sam — thanks for getting in touch — we’ve got your message and will reply within one business day.');
  ok('ack: no name → the bare sentence', enquiryAckCopy({}).sentence === ENQUIRY_ACK_SENTENCE);
  ok('ack: the subject names the studio', c.subject === 'We got your message — Davis Digital Studio' && enquiryAckCopy({}).subject === 'We got your message');
  ok('settings.html shows the exact sentence that will be sent', read('settings.html').includes(`<span id="say-ack">${ENQUIRY_ACK_SENTENCE}</span>`));
  const commercial = read('supabase/functions/presence/routes/commercial.ts');
  ok('commercial.ts: both form paths acknowledge (non-spam only), gated on auto_ack_enquiries', (commercial.match(/acknowledgeEnquiry\(siteId, /g) || []).length === 2 && /if \(!auto\.auto_ack_enquiries\) return false;/.test(commercial));
}

// ═══ 5. stale after N days per stage — and pipeline.html's verbatim mirror ═══
{
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const ago = (d) => new Date(NOW - d * 86400_000).toISOString();
  ok('stale: default 14 everywhere', staleDaysFor('lead', {}) === 14 && staleDaysFor('proposal', null) === 14 && DEFAULT_STALE_DAYS === 14);
  ok('stale: a per-stage override wins; junk falls back', staleDaysFor('proposal', { proposal: 7 }) === 7 && staleDaysFor('lead', { proposal: 7 }) === 14 && staleDaysFor('lead', { lead: 0 }) === 14 && staleDaysFor('lead', { lead: '400' }) === 14);
  ok('quiet days: the later of contact and edit', dealQuietDays({ updated_at: ago(20), last_contacted_at: ago(3) }, NOW) === 3 && dealQuietDays({ updated_at: ago(2), last_contacted_at: ago(9) }, NOW) === 2 && dealQuietDays({}, NOW) === null);
  ok('stale: 15 quiet days, default → stale', dealStaleAfter({ stage: 'proposal', updated_at: ago(15) }, NOW, {}) === true);
  ok('stale: 10 quiet days, default → not yet; proposal:7 → stale', dealStaleAfter({ stage: 'proposal', updated_at: ago(10) }, NOW, {}) === false && dealStaleAfter({ stage: 'proposal', updated_at: ago(10) }, NOW, { proposal: 7 }) === true);
  ok('stale: never for won / lost / converted', !dealStaleAfter({ stage: 'won', updated_at: ago(40) }, NOW, {}) && !dealStaleAfter({ stage: 'lost', updated_at: ago(40) }, NOW, {}) && !dealStaleAfter({ stage: 'lead', updated_at: ago(40), converted_client_id: 'c' }, NOW, {}));
  // the page mirror: extract the three functions from pipeline.html and run the same cases
  const pipe = read('pipeline.html');
  const fnSrc = (name) => { const m = pipe.match(new RegExp('function ' + name + '\\([^)]*\\)\\{.*?\\n', 's')); return m ? m[0] : ''; };
  const src = fnSrc('staleDaysFor') + fnSrc('dealQuietDays') + fnSrc('dealStaleAfter');
  const mirror = new Function('DEFAULT_STALE_DAYS', 'OPEN_STAGES_LIST', src + ';return {staleDaysFor,dealQuietDays,dealStaleAfter};')(14, ['lead', 'qualified', 'proposal', 'contract']);
  const cases = [
    [{ stage: 'proposal', updated_at: ago(15) }, {}], [{ stage: 'proposal', updated_at: ago(10) }, {}], [{ stage: 'proposal', updated_at: ago(10) }, { proposal: 7 }],
    [{ stage: 'won', updated_at: ago(40) }, {}], [{ stage: 'lead', updated_at: ago(40), last_contacted_at: ago(1) }, {}], [{ stage: 'contract' }, {}],
  ];
  ok('pipeline.html mirror agrees with lib/sales_lifecycle.ts on every case', cases.every(([d, s]) => mirror.dealStaleAfter(d, NOW, s) === dealStaleAfter(d, NOW, s)) && mirror.staleDaysFor('lead', { lead: 3 }) === 3);
  ok('pipeline.html: the board card uses the mirror and names N in the badge', /const stale=dealStaleAfter\(d,Date\.now\(\),STALE_DAYS\);/.test(pipe) && /No movement in \$\{staleN\}\+ days/.test(pipe));
  ok('pipeline.html: STALE_DAYS comes from /settings stage_stale_days, best-effort', /api\('\/settings'\)\.then\(r=>\{const v=r&&r\.data&&r\.data\.stage_stale_days;/.test(pipe));
  ok('pipeline.html: ticking the LAST open to-do asks what’s next (and only then)', /const prompt=\(opts\.justTicked&&openNow===0\)\?whatsNextHtml\(\):'';/.test(pipe) && /loadDealTasks\(id,\{justTicked:c\.checked\}\)/.test(pipe));
}

// ═══ 6. the deal page keeps ONE filled button per view ═══
{
  const pipe = read('pipeline.html');
  ok('back bar: "Open customer record →" is quiet', /<a class="btn ghost" href="\/crm\.html\?deal=\$\{esc\(id\)\}&client=" data-noscope="1" style="margin-left:auto[^>]*>Open customer record →<\/a>/.test(pipe));
  ok('billing: ONE primary is chosen in order (convert · both · agreement · proposal · + Proposal · + Agreement)', /const BILL_PRIMARY=!dealOpen&&!canConvert\?'':canConvert\?'convert':SEND_BOTH\?'both':draftCon\?\('con:'\+draftCon\.id\):draftProp\?\('prop:'\+draftProp\.id\):/.test(pipe));
  ok('billing: the row sends are filled only as THE primary', /fillIf\(BILL_PRIMARY==='prop:'\+p\.id\)/.test(pipe) && /fillIf\(BILL_PRIMARY==='con:'\+k\.id\)/.test(pipe));
  ok('billing: the convert card’s other buttons went quiet', /<button class="btn ghost" data-send-contract="\$\{draftContract\.id\}">Send the agreement for signature →<\/button>/.test(pipe) && /<button class="btn ghost" disabled>Sign the agreement first<\/button>/.test(pipe) && /<a class="btn ghost" href="\/projects\.html\?project=\$\{esc\(d\.created_project_id\)\}/.test(pipe));
  ok('billing: the invoice & deposit actions stay quiet', /<button class="btn ghost" id="sendInvoice">Send an invoice<\/button><button class="btn ghost" id="sendDeposit">Request a deposit<\/button><button class="btn ghost" id="setupPlan">/.test(pipe));
  ok('header: the won deal’s Send invoice is filled only once converted — and only on Overview and Billing', /<button\$\{d\.converted_client_id\?' data-primary-for="overview billing"':''\} class="\$\{fillIf\(!!d\.converted_client_id\)\}" id="wonInvoice">Send invoice<\/button>/.test(pipe));
  ok('the Path bar’s do-next is filled on Overview only (data-primary-for, applied on every tab switch and path repaint)', /data-primary-for="overview" class="btn" id="markComplete"/.test(pipe) && /function applyTabPrimaries\(tab\)/.test(pipe) && /applyTabPrimaries\(tab\);/.test(pipe) && /applyTabPrimaries\(DTAB\);/.test(pipe));
  ok('overview: a won-but-unconverted deal’s do-next is Convert (the Path side button)', /if\(stage==='won'&&!d\.converted_client_id\)side=`<button type="button" data-primary-for="overview" class="btn" id="pathConvert">Convert to customer ↓<\/button>`;/.test(pipe));
  ok('guidance: a won-but-unconverted deal reads "convert them", not "open their project"', /if\(s==='won'&&facts&&!facts\.converted\)return CONTRACT_SIGNED_GUIDANCE;/.test(pipe));
  // every id the e2e spec pins is still there
  for (const id of ['wonInvoice', 'convert', 'sendBothBtn', 'markComplete', 'pathConvert', 'guideConvert', 'sendInvoice', 'sendDeposit', 'setupPlan', 'addProp', 'addCon', 'setupRetainer', 'resendInvite', 'closeD', 'dt-add', 'dt-preset']) ok(`id survives: #${id}`, pipe.includes(`id="${id}"`));
}

// ═══ 7. the roster shows money ═══
{
  const ag = read('agency.html');
  ok('agency.html: an Outstanding column, sortable', /\['owed','Outstanding',\(c\)=>Number\(c\.outstanding_cents\|\|0\)\]/.test(ag) && /<td class="money">\$\{owedCell\(c\)\}<\/td>/.test(ag));
  ok('agency.html: an Outstanding chip (fixed view)', /\['owed','Outstanding'\]/.test(ag) && /if\(VIEWNAME==='owed'\)return Number\(c\.outstanding_cents\|\|0\)>0;/.test(ag));
  ok('agency.html: money comes from /sales/receivables grouped by the invoice’s customer', /api\('\/sales\/receivables'\)/.test(ag) && /add\(bySite,i\.customer_site_id\);add\(byClient,i\.client_id\);/.test(ag));
  ok('sales.ts: each receivable names its customer (client_id · customer_site_id)', /client_id: customerOf\(i\.deal_id\)\.client_id, customer_site_id: customerOf\(i\.deal_id\)\.site_id/.test(read('supabase/functions/presence/routes/sales.ts')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MONEY & SIGNATURE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
