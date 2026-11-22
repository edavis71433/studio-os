// ── Money and signature (studio audit 2026-10 changes 7 + 10; benchmark 6 + 13) ─
//   deno run --allow-read --allow-env --allow-net tests/presence/money_signature_test.mjs
//
// The pure rules, then the real routes and sweeps that use them:
//   · a signature moves the deal (stageAfterSignature), and so does a paid deposit's echo
//     (stageAfterDepositPaid); "ready to convert" is raised on signature
//   · the invoice reminder schedule −7 · due · +N, once per leg, never twice a day; the sweep
//     follows each studio's own switch; the earlier legs are silent, the after-leg is the
//     studio's "Still unpaid"; voiding an invoice takes its legs down
//   · the deal nudge ("no next step for N days") and the three-switch defaults; /settings
//     takes the switches with N bounded, and reads on a database before 0134
//   · the enquiry acknowledgement on both form paths, never for spam, only when switched on
//   · stale-after-N-days per stage, and pipeline.html's own copy of it, run side by side
//   · Who owes you names each invoice's customer, for the roster's Outstanding column
// Builder item 212: the server half runs the real handlers, the real index.ts and the real
// sweeps against the shared in-memory PostgREST (fake_pgrst.mjs), a fake Stripe and a fake mail
// service, with TWO studios seeded (Northwind, site A; Southpaw, site B), and checks that one
// studio's call never moves, emails or clears the other's rows. The pages are checked in a
// browser (the list at the end). Text is checked only where the text is the contract: the 0134
// SQL and the sentences settings.html shows by hand. Every name below is made up.
Deno.env.set('APPROVAL_SECRET', 'sign-link-secret-for-tests-0123456789');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example');
Deno.env.set('BILLING_SYNC_SECRET', 'echo-secret-for-tests');
Deno.env.set('STRIPE_SECRET', 'sk_test_fake');
for (const k of ['RESEND_INBOUND_DOMAIN', 'OPS_ALERT_EMAIL', 'OPERATOR_SECRET', 'SCHEDULER_SECRET', 'STATE_SIGNING_SECRET']) Deno.env.delete(k);
import { installFakePostgrest } from './fake_pgrst.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const A = uuid('a'), B = uuid('b'), CLIENT_A = uuid('c'), CLIENT_B = uuid('d');
const DEAL_A = uuid('3'), DEAL_A2 = uuid('2'), DEAL_B = uuid('6'), DEAL_B2 = uuid('9');
const CT_A = uuid('7'), CT_B = uuid('8');
const CON_A = uuid('e'), CON_B = uuid('f');
const INV_A = uuid('4'), INV_A2 = uuid('5'), INV_B = uuid('1'), INV_X = '0000000a-0000-4000-8000-0000000000a1', DEP_A = '0000000a-0000-4000-8000-0000000000a2';
const USERS = {
  'jwt-north': { id: '10000000-0000-4000-8000-00000000000a', email: 'owner@northwind.example' },
  'jwt-south': { id: '10000000-0000-4000-8000-00000000000b', email: 'owner@southpaw.example' },
};
const db = installFakePostgrest({ url: 'https://example.supabase.co', users: USERS, ownSite: { 'jwt-north': A, 'jwt-south': B } });

// the outside world: Stripe, the mail service and the rate limiter answer here and keep what they got
const pg = globalThis.fetch;
const out = { stripe: [], mail: [], escaped: [] };
let olderDb = null;   // a database a migration behind: answers a request the way it would, or null
let beforeWrite = null;   // one shot: runs just before the next matching write reaches the database
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') { out.stripe.push({ method, path: u.pathname }); return jres(200, { id: u.pathname.split('/').pop(), active: false, url: 'https://pay.example/new' }); }
  if (u.hostname === 'api.resend.com') { out.mail.push(JSON.parse(String(init.body))); return jres(200, { id: `em_${out.mail.length}` }); }
  if (u.hostname !== 'example.supabase.co') { out.escaped.push(u.href); return jres(500, {}); }
  if (u.pathname === '/rest/v1/rpc/rate_hit') return jres(200, true);   // under every limit
  if (beforeWrite && method !== 'GET' && beforeWrite.match(u, method)) { const h = beforeWrite; beforeWrite = null; h.run(); }
  if (olderDb) { const r = olderDb(u, method, init); if (r) return r; }
  return pg(url, init);
};

const P = '../../supabase/functions/presence';
const { stageAfterSignature, stageAfterDepositPaid, depositStillOpen, dealStaleAfter, staleDaysFor, dealQuietDays, DEFAULT_STALE_DAYS } = await import(`${P}/lib/sales_lifecycle.ts`);
const { invoiceReminderSlot, invoiceReminderPeriod, invoiceReminderCopy, dealNudgeDue, dealNudgeCopy, automationSettings, AUTOMATION_DEFAULTS, runInvoiceReminders, runDealFollowups } = await import(`${P}/commerce/lifecycle.ts`);
const { enquiryAckCopy, ENQUIRY_ACK_SENTENCE } = await import(`${P}/lib/commercial.ts`);
const { invoiceIdOfPeriod, invoiceReminderIds } = await import(`${P}/lib/inbox_feed.ts`);
const S = await import(`${P}/routes/sales.ts`);
const { handleSettings } = await import(`${P}/routes/content.ts`);
const { handleFormSubmit } = await import(`${P}/routes/commercial.ts`);
const { siteDb } = await import(`${P}/lib/db.ts`);

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
  // pin: settings.html keeps its own copy of the nudge sentence (N=3) by hand; this is the only place it is held to the one the lifecycle sends
  ok('settings.html: the nudge preview is the lifecycle sentence', read('settings.html').includes(`<span id="say-deal">${dealNudgeCopy('qualified', 3)}</span>`));
  const invLine = invoiceReminderCopy('after', 'invoice', '$1,250.00', '').line.replace(/<\/?strong>/g, '').replace(/'/g, '’');
  // pin: the same for the invoice reminder's sentence, a hand-kept copy in settings.html
  ok('settings.html: the invoice preview is the lifecycle sentence', read('settings.html').includes(`<span id="say-inv">${invLine}</span>`), invLine);
}

// ═══ 4. the enquiry acknowledgement ═══
{
  const c = enquiryAckCopy({ name: 'Sam Rivera', studio: 'Davis Digital Studio' });
  ok('ack: greets by first name, then the one sentence', c.sentence === 'Hi Sam — thanks for getting in touch — we’ve got your message and will reply within one business day.');
  ok('ack: no name → the bare sentence', enquiryAckCopy({}).sentence === ENQUIRY_ACK_SENTENCE);
  ok('ack: the subject names the studio', c.subject === 'We got your message — Davis Digital Studio' && enquiryAckCopy({}).subject === 'We got your message');
  // pin: settings.html shows the exact sentence by hand; this holds that copy to the one the acknowledgement sends
  ok('settings.html shows the exact sentence that will be sent', read('settings.html').includes(`<span id="say-ack">${ENQUIRY_ACK_SENTENCE}</span>`));
}

// ═══ 5. stale after N days per stage — and pipeline.html's own copy of it ═══
{
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const ago = (d) => new Date(NOW - d * 86400_000).toISOString();
  ok('stale: default 14 everywhere', staleDaysFor('lead', {}) === 14 && staleDaysFor('proposal', null) === 14 && DEFAULT_STALE_DAYS === 14);
  ok('stale: a per-stage override wins; junk falls back', staleDaysFor('proposal', { proposal: 7 }) === 7 && staleDaysFor('lead', { proposal: 7 }) === 14 && staleDaysFor('lead', { lead: 0 }) === 14 && staleDaysFor('lead', { lead: '400' }) === 14);
  ok('quiet days: the later of contact and edit', dealQuietDays({ updated_at: ago(20), last_contacted_at: ago(3) }, NOW) === 3 && dealQuietDays({ updated_at: ago(2), last_contacted_at: ago(9) }, NOW) === 2 && dealQuietDays({}, NOW) === null);
  ok('stale: 15 quiet days, default → stale', dealStaleAfter({ stage: 'proposal', updated_at: ago(15) }, NOW, {}) === true);
  ok('stale: 10 quiet days, default → not yet; proposal:7 → stale', dealStaleAfter({ stage: 'proposal', updated_at: ago(10) }, NOW, {}) === false && dealStaleAfter({ stage: 'proposal', updated_at: ago(10) }, NOW, { proposal: 7 }) === true);
  ok('stale: never for won / lost / converted', !dealStaleAfter({ stage: 'won', updated_at: ago(40) }, NOW, {}) && !dealStaleAfter({ stage: 'lost', updated_at: ago(40) }, NOW, {}) && !dealStaleAfter({ stage: 'lead', updated_at: ago(40), converted_client_id: 'c' }, NOW, {}));
  // pipeline.html keeps its own copy of these three functions by hand: they are taken out of the
  // page and RUN here on the same cases, so the two copies must agree in what they decide
  const pipe = read('pipeline.html');
  const fnSrc = (name) => { const m = pipe.match(new RegExp('function ' + name + '\\([^)]*\\)\\{.*?\\n', 's')); return m ? m[0] : ''; };
  const src = fnSrc('staleDaysFor') + fnSrc('dealQuietDays') + fnSrc('dealStaleAfter');
  const mirror = new Function('DEFAULT_STALE_DAYS', 'OPEN_STAGES_LIST', src + ';return {staleDaysFor,dealQuietDays,dealStaleAfter};')(14, ['lead', 'qualified', 'proposal', 'contract']);
  const cases = [
    [{ stage: 'proposal', updated_at: ago(15) }, {}], [{ stage: 'proposal', updated_at: ago(10) }, {}], [{ stage: 'proposal', updated_at: ago(10) }, { proposal: 7 }],
    [{ stage: 'won', updated_at: ago(40) }, {}], [{ stage: 'lead', updated_at: ago(40), last_contacted_at: ago(1) }, {}], [{ stage: 'contract' }, {}],
  ];
  ok('pipeline.html’s own copy decides every case as lib/sales_lifecycle.ts does', cases.every(([d, s]) => mirror.dealStaleAfter(d, NOW, s) === dealStaleAfter(d, NOW, s)) && mirror.staleDaysFor('lead', { lead: 3 }) === 3);
}

// ═══ the two studios, seeded fresh for each block ═══
const SITE_A = { id: A, client_id: CLIENT_A, status: 'live', last_published_at: null, template_slug: 'studio', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const SITE_B = { ...SITE_A, id: B, client_id: CLIENT_B };
const HASH = 'cd'.repeat(32);
const DAY = 86400_000;
const today = () => new Date().toISOString().slice(0, 10);
// Sales item 152: the reminder sweep judges each leg on the studio's day and sends from 9 in its
// morning, so it takes a clock: noon Pacific on today's UTC day, the day these fixtures count from.
const NOW = Date.parse(`${today()}T20:00:00Z`);
const dayFrom = (n) => new Date(NOW + n * DAY).toISOString().slice(0, 10);
const agoIso = (n) => new Date(NOW - n * DAY).toISOString();
const invoice = (over = {}) => ({
  id: INV_A, site_id: A, deal_id: DEAL_A, number: 13, title: 'Balance at launch', description: 'Balance', amount_cents: 200000, currency: 'usd', purpose: 'service',
  status: 'open', stripe_url: 'https://pay.example/x', stripe_payment_link_id: 'plink_13', due_date: dayFrom(-10), processing_since: null, paid_at: null, paid_method: '',
  payment_for: null, link_gen: 0, recurring_id: null, created_at: agoIso(20), first_sent_at: agoIso(20), deleted_at: null, ...over,
});
const contract = (over = {}) => ({ id: CON_A, site_id: A, deal_id: DEAL_A, title: 'Service agreement', body: 'The studio builds the site.\n\nThe client pays the invoices.', status: 'sent', content_hash: HASH, signer_name: null, signer_email: null, signed_at: null, signed_evidence: null, sent_at: agoIso(2), created_at: agoIso(3), deleted_at: null, ...over });
const dealRow = (id, site_id, title, contact_id, over = {}) => ({ id, site_id, title, stage: 'contract', contact_id, converted_client_id: null, converted_site_id: null, created_project_id: null, next_step: null, next_step_at: null, updated_at: agoIso(1), deleted_at: null, ...over });
const world = (extra = {}) => {
  db.reset({
    presence_sites: [SITE_A, SITE_B],
    presence_entitlements: [CLIENT_A, CLIENT_B].map((client_id) => ({ client_id, product: 'presence', plan: 'presence', status: 'active' })),
    clients: [{ id: CLIENT_A, email: USERS['jwt-north'].email, tenant_id: 'tenant-1', name: 'Northwind' }, { id: CLIENT_B, email: USERS['jwt-south'].email, tenant_id: 'tenant-1', name: 'Southpaw' }],
    presence_identity: [{ site_id: A, business_name: 'Northwind Studio', email: 'hello@northwind.example' }, { site_id: B, business_name: 'Southpaw Design', email: 'hi@southpaw.example' }],
    presence_deals: [dealRow(DEAL_A, A, 'Website refresh', CT_A), dealRow(DEAL_B, B, 'Harbor menu boards', CT_B)],
    presence_contacts: [
      { id: CT_A, site_id: A, name: 'Ivy Chen', email: 'ivy@juniper.example', company: 'Juniper Floral Co.', deleted_at: null },
      { id: CT_B, site_id: B, name: 'Omar Reyes', email: 'omar@harbor.example', company: 'Harbor Fish Co.', deleted_at: null },
    ],
    presence_contracts: [contract(), contract({ id: CON_B, site_id: B, deal_id: DEAL_B })],
    presence_invoices: [], presence_plan_notices: [], presence_deal_events: [],
    presence_settings: [{ site_id: A }, { site_id: B }],
    ...extra,
  });
  out.stripe.length = 0; out.mail.length = 0; out.escaped.length = 0; olderDb = null; beforeWrite = null;
};
const dealOf = (id) => db.tables.presence_deals.find((d) => d.id === id);
const inv = (id) => (db.tables.presence_invoices || []).find((r) => r.id === id);
const notices = (pred = () => true) => (db.tables.presence_plan_notices || []).filter(pred);
const noticeAt = (client, period) => notices((x) => x.client_id === client && x.period === period)[0];
const events = (kind) => (db.tables.presence_deal_events || []).filter((e) => !kind || e.kind === kind);
const mailTo = (addr) => out.mail.filter((m) => [].concat(m.to).includes(addr));
const req = (method, path, body, headers = {}) => new Request(`https://example.supabase.co/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const res = async (r) => { const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ } return { status: r.status, body, text }; };

// the real index.ts, with std's serve() handed a fake listener: no socket opens
const queue = []; let wake = null;
Deno.listen = () => { let first = true; return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} }; };
Deno.serveHttp = () => ({ nextRequest: () => new Promise((r) => { if (queue.length) r(queue.shift()); else wake = r; }), close() {} });
await import(`${P}/index.ts`);
const send = (request) => new Promise((resolve) => { const ev = { request, respondWith: async (r) => { resolve(await r); } }; if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev); });
const call = async (jwt, method, path, body, headers = {}) => res(await send(req(method, path, body, { ...(jwt ? { 'x-dds-user-jwt': jwt } : {}), ...headers })));
const tokenFor = (id, site_id) => S.signSalesToken({ t: 'contract', id, site_id, exp: Math.floor(Date.now() / 1000) + 3600 }, S.linkSecret());
const sign = async (id, token) => call(null, 'POST', `/sales/contracts/${id}/sign`, { token, signer_name: 'Ivy Chen', signer_email: 'ivy@juniper.example', presented_hash: HASH });
const echo = async (id, secret = 'echo-secret-for-tests') => call(null, 'POST', '/commerce/invoice-paid', { invoice_id: id }, { 'x-commerce-secret': secret });

// ═══ 6. the route half of the signature rules ═══
{
  world();
  const r = await sign(CON_A, await tokenFor(CON_A, A));
  ok('signing with no deposit waiting: the deal is Won', r.status === 200 && dealOf(DEAL_A).stage === 'won' && events('stage_change').some((e) => e.deal_id === DEAL_A && e.to_stage === 'won'), `${r.status} ${r.text.slice(0, 160)}`);
  const ready = noticeAt(CLIENT_A, `signed:${DEAL_A}`);
  ok('…and "ready to convert" is raised for this studio', !!ready && ready.kind === 'deal_signed' && ready.status === 'active' && ready.headline === 'Agreement signed — ready to convert Website refresh', JSON.stringify(notices()));
  ok('…the other studio’s deal and agreement stay as they were', dealOf(DEAL_B).stage === 'contract' && db.tables.presence_contracts.find((k) => k.id === CON_B).status === 'sent' && notices((x) => x.client_id === CLIENT_B).length === 0);
  world({ presence_invoices: [invoice({ id: DEP_A, purpose: 'deposit', title: 'Deposit', due_date: null })] });
  const held = await sign(CON_A, await tokenFor(CON_A, A));
  ok('signing while the deposit is still open: the deal stays at Agreement out', held.status === 200 && dealOf(DEAL_A).stage === 'contract' && events('stage_change').every((e) => e.to_stage !== 'won'), held.text.slice(0, 160));
  ok('…and "ready to convert" is raised all the same', noticeAt(CLIENT_A, `signed:${DEAL_A}`)?.status === 'active');
  world({ presence_invoices: [invoice({ id: DEP_A, purpose: 'deposit', title: 'Deposit', due_date: null, processing_since: agoIso(1) })] });
  await sign(CON_A, await tokenFor(CON_A, A));
  ok('a deposit already settling doesn’t hold it: Won', dealOf(DEAL_A).stage === 'won');
  world();
  const cross = await sign(CON_B, await tokenFor(CON_B, A));
  ok('a link signed for one studio can’t sign the other studio’s agreement: 404, nothing moves', cross.status === 404 && db.tables.presence_contracts.find((k) => k.id === CON_B).status === 'sent' && dealOf(DEAL_B).stage === 'contract' && events().length === 0);
  world({ presence_contracts: [contract({ deal_id: DEAL_B })] });
  const stray = await sign(CON_A, await tokenFor(CON_A, A));
  ok('an agreement whose deal is the other studio’s moves nothing there and tells nobody there', stray.status === 200 && dealOf(DEAL_B).stage === 'contract' && notices((x) => x.client_id === CLIENT_B).length === 0 && mailTo('omar@harbor.example').length === 0, stray.text.slice(0, 160));
  world();
  const [body] = (await tokenFor(CON_A, A)).split('.');
  const forged = await sign(CON_A, `${body}.${'0'.repeat(64)}`);
  ok('a link we didn’t sign signs nothing', forged.status === 403 && db.tables.presence_contracts.find((k) => k.id === CON_A).status === 'sent' && dealOf(DEAL_A).stage === 'contract');
}
{
  // a deposit paid by card: the Stripe webhook's echo moves a signed deal (guarded to open stages)
  const paidDeposit = (over = {}) => invoice({ id: DEP_A, purpose: 'deposit', title: 'Deposit', status: 'paid', paid_at: agoIso(0), due_date: null, ...over });
  const signedA = [contract({ status: 'signed', signed_at: agoIso(1) }), contract({ id: CON_B, site_id: B, deal_id: DEAL_B, status: 'signed', signed_at: agoIso(1) })];
  world({ presence_contracts: signedA, presence_invoices: [paidDeposit()] });
  const r = await echo(DEP_A);
  ok('the paid echo moves a signed deal to Won', r.status === 200 && r.body?.data?.moved === true && dealOf(DEAL_A).stage === 'won' && events('stage_change').some((e) => e.deal_id === DEAL_A && e.to_stage === 'won' && e.actor === 'stripe'), `${r.status} ${r.text.slice(0, 160)}`);
  world({ presence_contracts: signedA, presence_invoices: [paidDeposit()], presence_deals: [dealRow(DEAL_A, A, 'Website refresh', CT_A, { stage: 'lost' }), dealRow(DEAL_B, B, 'Harbor menu boards', CT_B)] });
  await echo(DEP_A);
  ok('…only from an open stage: a lost deal stays lost', dealOf(DEAL_A).stage === 'lost');
  // the studio marks the deal lost in the moment between the echo's read and its write
  world({ presence_contracts: signedA, presence_invoices: [paidDeposit()] });
  beforeWrite = { match: (u, m) => m === 'PATCH' && u.pathname.endsWith('/presence_deals') && u.search.includes('stage=in.'), run: () => { dealOf(DEAL_A).stage = 'lost'; } };
  const raced = await echo(DEP_A);
  ok('…and the move itself is guarded: a deal marked lost a moment before stays lost', raced.status === 200 && raced.body?.data?.moved === false && dealOf(DEAL_A).stage === 'lost' && events('stage_change').length === 0, raced.text.slice(0, 160));
  world({ presence_invoices: [paidDeposit()] });
  await echo(DEP_A);
  ok('…an agreement that isn’t signed leaves the stage', dealOf(DEAL_A).stage === 'contract');
  world({ presence_contracts: signedA, presence_invoices: [paidDeposit({ purpose: 'service', title: 'Balance' })] });
  await echo(DEP_A);
  ok('…a service invoice paid is not a close', dealOf(DEAL_A).stage === 'contract');
  world({ presence_contracts: signedA, presence_invoices: [paidDeposit({ deal_id: DEAL_B })] });
  await echo(DEP_A);
  ok('…and a deposit row that names the other studio’s deal moves nothing there', dealOf(DEAL_B).stage === 'contract' && events('stage_change').length === 0);
  world({ presence_contracts: signedA, presence_invoices: [paidDeposit()] });
  const wrong = await echo(DEP_A, 'not-the-secret');
  ok('…and without the shared secret the echo changes nothing', wrong.status === 403 && dealOf(DEAL_A).stage === 'contract' && notices().length === 0);
}

// ═══ 7. the reminder sweep, Void, and each studio's own switch ═══
{
  world({
    presence_settings: [{ site_id: A, invoice_reminders: true, invoice_remind_after_days: 2 }, { site_id: B, invoice_reminders: false }],
    presence_invoices: [
      invoice(),                                                                                               // A: overdue → the after-leg
      invoice({ id: INV_A2, number: 14, title: 'Second milestone', due_date: dayFrom(3), first_sent_at: agoIso(5), created_at: agoIso(5) }),   // A: due in 3 days → the before-leg
      invoice({ id: INV_X, number: 15, title: 'Stray invoice', deal_id: DEAL_B }),                            // A: names the other studio's deal
      invoice({ id: INV_B, site_id: B, deal_id: DEAL_B, title: 'Menu boards', amount_cents: 90000 }),        // B: overdue, but B's switch is off
    ],
  });
  await runInvoiceReminders(20, NOW);
  const after = noticeAt(CLIENT_A, `invremind:${INV_A}:after`), before = noticeAt(CLIENT_A, `invremind:${INV_A2}:before`);
  ok('the sweep reminds a studio with the switch on: the after-leg is the studio’s active "Still unpaid"', !!after && after.status === 'active' && after.headline === 'Still unpaid — Balance at launch ($2,000.00)', JSON.stringify(notices().map((x) => [x.period, x.status])));
  ok('…and its client gets the gentle reminder with the pay link', mailTo('ivy@juniper.example').some((m) => m.subject === 'A gentle reminder — Balance at launch ($2,000.00)' && m.html.includes('https://pay.example/x')));
  ok('the earlier legs are silent ledger rows: the client hears, the studio’s list doesn’t', !!before && before.status === 'dismissed' && mailTo('ivy@juniper.example').some((m) => /^Coming up — Second milestone/.test(m.subject)));
  ok('a studio with the switch off: nothing raised, nobody emailed', notices((x) => x.client_id === CLIENT_B).length === 0 && mailTo('omar@harbor.example').length === 0);
  const stray = noticeAt(CLIENT_A, `invremind:${INV_X}:after`);
  ok('an invoice that names the other studio’s deal never reaches that studio’s person', !!stray && /no client email on this deal/.test(stray.body) && mailTo('omar@harbor.example').length === 0);
  out.mail.length = 0;
  await runInvoiceReminders(20, NOW);
  ok('run again the same day: no leg twice', out.mail.length === 0 && notices((x) => x.period === `invremind:${INV_A}:after`).length === 1);
}
{
  const legs = (id, client = CLIENT_A, site = A) => ['', ':before', ':due', ':after'].map((s, i) => ({ id: `${id.slice(0, 8)}-${client.slice(0, 2)}-${i}`, client_id: client, site_id: site, kind: 'deal_followup', period: `invremind:${id}${s}`, headline: 'Still unpaid', body: '', status: 'active' }));
  const seeded = () => world({
    presence_invoices: [invoice({ due_date: dayFrom(5) }), invoice({ id: INV_A2, number: 14 }), invoice({ id: INV_B, site_id: B, deal_id: DEAL_B, title: 'Menu boards' })],
    presence_plan_notices: [...legs(INV_A), ...legs(INV_A2), ...legs(INV_B, CLIENT_B, B),
      // a row under the other studio's account that happens to carry the same period stays theirs
      { id: 'b-same-period', client_id: CLIENT_B, site_id: B, kind: 'deal_followup', period: `invremind:${INV_A}:after`, headline: 'Still unpaid', body: '', status: 'active' }],
  });
  seeded();
  const r = await call('jwt-north', 'POST', `/sales/invoices/${INV_A}/void`, {});
  ok('void: the invoice is withdrawn and its card link switched off', r.status === 200 && inv(INV_A).status === 'void' && r.body?.data?.link_deactivated === true && out.stripe.some((c) => c.path === '/v1/payment_links/plink_13'), `${r.status} ${r.text.slice(0, 160)}`);
  ok('void: its reminder rows go, the old one and each of the three legs', legs(INV_A).every((x) => noticeAt(CLIENT_A, x.period)?.status === 'dismissed'));
  ok('void: another invoice’s legs, and the other studio’s rows, stay', legs(INV_A2).every((x) => noticeAt(CLIENT_A, x.period)?.status === 'active') && notices((x) => x.client_id === CLIENT_B).every((x) => x.status === 'active'));
  seeded();
  const south = await call('jwt-south', 'POST', `/sales/invoices/${INV_A}/void`, {});
  ok('the other studio can’t void it: 404, the invoice and its reminders stay', south.status === 404 && inv(INV_A).status === 'open' && legs(INV_A).every((x) => noticeAt(CLIENT_A, x.period)?.status === 'active') && out.stripe.length === 0);
}
{
  // the deal nudge: per studio, behind its switch, after its own N quiet days
  const deals = [
    dealRow(DEAL_A, A, 'Website refresh', CT_A, { stage: 'proposal', updated_at: agoIso(5) }),
    dealRow(DEAL_A2, A, 'Logo cleanup', CT_A, { stage: 'proposal', updated_at: agoIso(2) }),
    dealRow(DEAL_B, B, 'Harbor menu boards', CT_B, { stage: 'proposal', updated_at: agoIso(10) }),
    dealRow(DEAL_B2, B, 'Harbor signage', CT_B, { stage: 'qualified', updated_at: agoIso(5) }),
  ];
  world({ presence_deals: deals, presence_settings: [{ site_id: A, deal_nudges: true, deal_nudge_days: 3 }, { site_id: B, deal_nudges: false }] });
  await runDealFollowups(20);
  const nudges = (client) => notices((x) => x.client_id === client && /^Follow up on /.test(x.headline));
  ok('the deal nudge: a studio with it on hears of a deal quiet past its N', nudges(CLIENT_A).length === 1 && nudges(CLIENT_A)[0].headline === 'Follow up on Website refresh' && nudges(CLIENT_A)[0].body === dealNudgeCopy('proposal', 3), JSON.stringify(nudges(CLIENT_A)));
  ok('…not of one quiet for less, and a studio with it off hears nothing', !nudges(CLIENT_A).some((x) => /Logo cleanup/.test(x.headline)) && nudges(CLIENT_B).length === 0);
  world({ presence_deals: deals, presence_settings: [{ site_id: A, deal_nudges: false }, { site_id: B, deal_nudges: true, deal_nudge_days: 7 }] });
  await runDealFollowups(20);
  ok('…and N is each studio’s own: at 7, ten quiet days nudge and five don’t', nudges(CLIENT_B).length === 1 && nudges(CLIENT_B)[0].headline === 'Follow up on Harbor menu boards' && /7 days/.test(nudges(CLIENT_B)[0].body) && nudges(CLIENT_A).length === 0);
}

// ═══ 8. /settings: the 0134 fields, N bounded; a database before 0134 still reads ═══
{
  const owner = { kind: 'client', userId: USERS['jwt-north'].id, email: USERS['jwt-north'].email, tenantId: 'tenant-1', role: 'client', jwt: 'jwt-north', requestId: 'r', scope: { site_id: A, name: 'Northwind' } };
  const dbA = siteDb('jwt-north', SITE_A, owner);   // the service role, pinned to site A (lib/db.ts)
  const put = async (body) => res(await handleSettings(req('PUT', '/settings', body), dbA, SITE_A, owner, {}));
  const rowOf = (site) => db.tables.presence_settings.find((r) => r.site_id === site);
  world({ presence_settings: [{ site_id: A, industry_key: 'generic' }, { site_id: B, industry_key: 'bakery', deal_nudges: false }] });
  const bBefore = JSON.stringify(rowOf(B));
  const r = await put({ auto_ack_enquiries: true, invoice_reminders: true, invoice_remind_after_days: 5, deal_nudges: true, deal_nudge_days: 10, stage_stale_days: { proposal: 7, lead: 21 } });
  const a = rowOf(A);
  ok('/settings takes the six 0134 fields and stores them', r.status === 200 && a.auto_ack_enquiries === true && a.invoice_reminders === true && a.invoice_remind_after_days === 5 && a.deal_nudges === true && a.deal_nudge_days === 10 && JSON.stringify(a.stage_stale_days) === JSON.stringify({ proposal: 7, lead: 21 }), `${r.status} ${r.text.slice(0, 200)}`);
  ok('…on this studio only', JSON.stringify(rowOf(B)) === bBefore);
  const edges = await put({ invoice_remind_after_days: 90, deal_nudge_days: 1 });
  ok('N may be anything from 1 to 90', edges.status === 200 && rowOf(A).invoice_remind_after_days === 90 && rowOf(A).deal_nudge_days === 1);
  const writes = db.writes('presence_settings').length;
  const low = await put({ invoice_remind_after_days: 0 }), high = await put({ deal_nudge_days: 91 }), wrongStage = await put({ stage_stale_days: { won: 3 } }), wrongDays = await put({ stage_stale_days: { proposal: 400 } });
  ok('…outside 1 to 90 is refused and nothing is saved', low.status === 422 && high.status === 422 && rowOf(A).invoice_remind_after_days === 90 && rowOf(A).deal_nudge_days === 1);
  ok('…and the stale map takes open stages and 1 to 365 days only', wrongStage.status === 422 && wrongDays.status === 422 && JSON.stringify(rowOf(A).stage_stale_days) === JSON.stringify({ proposal: 7, lead: 21 }) && db.writes('presence_settings').length === writes);
  // a database before 0134: none of the switch columns (nor the later packs') exist yet
  const BASE = new Set('site_id,category_order,cover_media_id,logo_media_id,og_media_id,announcement_text,announcement_url,announcement_expires_at,industry_key,google_site_verification,bing_site_verification,hero_layout,nav_style,sections_hidden,sections_order,footer_hours,footer_social,pages_noindex,page_seo,blocks,pages,nav,updated_at'.split(','));
  world({ presence_settings: [{ site_id: A, industry_key: 'salon', announcement_text: 'Open late' }] });
  olderDb = (u) => {
    if (!u.pathname.endsWith('/presence_settings')) return null;
    const sel = (u.searchParams.get('select') || '').split(',').filter(Boolean);
    const missing = sel.find((c) => !BASE.has(c));
    return missing ? jres(400, { code: '42703', message: `column presence_settings.${missing} does not exist` }) : null;
  };
  const g = await res(await handleSettings(req('GET', '/settings'), dbA, SITE_A, owner, {}));
  ok('a database before 0134: the settings read steps down and still answers', g.status === 200 && g.body?.data?.industry_key === 'salon' && g.body?.data?.announcement_text === 'Open late', `${g.status} ${g.text.slice(0, 160)}`);
  const save = await put({ industry_key: 'florist' });
  ok('…and a save that doesn’t touch the switches still lands', save.status === 200 && rowOf(A).industry_key === 'florist', `${save.status} ${save.text.slice(0, 160)}`);
  olderDb = null;
  // pin: there is no database here; the columns, their defaults and the re-runnable form exist only in the SQL
  ok('migration 0134 + its apply pack exist and add the six columns', /add column if not exists stage_stale_days jsonb/.test(read('supabase/migrations/0134_automation_switches.sql')) && /add column if not exists deal_nudge_days integer not null default 3/.test(read('docs/presence/APPLY-0134-prod.sql')));
}

// ═══ 9. the enquiry acknowledgement, on both form paths ═══
{
  const FORM = { type: 'form', id: 'quote', title: 'Request a quote', kind: 'quote', fields: [
    { key: 'name', label: 'Your name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'details', label: 'Tell us more', type: 'textarea' }] };
  world({ presence_settings: [{ site_id: A, auto_ack_enquiries: true, blocks: [FORM], pages: [] }, { site_id: B, auto_ack_enquiries: false, blocks: [FORM], pages: [] }] });
  const submit = (site, fields) => handleFormSubmit(new Request(`https://example.supabase.co/functions/v1/presence/forms/${site}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ _hp: '', ...fields }) }), site, {});
  const settle = async (addr, n = 1, ms = 4000) => { const end = Date.now() + ms; while (mailTo(addr).length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 60)); return mailTo(addr); };
  const ackOf = (list) => list.find((m) => /^We got your message/.test(m.subject));
  await submit(A, { form_kind: 'contact', name: 'Sam Rivera', email: 'sam@customer.example', message: 'Do you fix gutters?' });
  const fixed = ackOf(await settle('sam@customer.example'));
  ok('the contact form: the person who wrote in gets the acknowledgement', !!fixed && fixed.subject === 'We got your message — Northwind Studio' && fixed.html.includes('thanks for getting in touch'), JSON.stringify(out.mail.map((m) => [m.to, m.subject])));
  await submit(A, { form_id: 'quote', name: 'Dana Lee', email: 'dana@customer.example', details: 'A new menu board' });
  const custom = ackOf(await settle('dana@customer.example'));
  ok('a form built in the Forms area: the same acknowledgement', !!custom && custom.subject === 'We got your message — Northwind Studio', JSON.stringify(out.mail.map((m) => [m.to, m.subject])));
  await submit(A, { form_kind: 'contact', _hp: 'http://spam.example', name: 'Bot', email: 'bot1@spam.example', message: 'Buy now' });
  await submit(A, { form_id: 'quote', _hp: 'http://spam.example', name: 'Bot', email: 'bot2@spam.example', details: 'Buy now' });
  const spam = [...await settle('bot1@spam.example', 1, 800), ...await settle('bot2@spam.example', 1, 800)];
  ok('spam gets no acknowledgement on either path', spam.length === 0 && (db.tables.presence_form_submissions || []).filter((s) => s.spam).length === 2);
  await submit(B, { form_kind: 'contact', name: 'Lee Park', email: 'lee@customer.example', message: 'Menu boards?' });
  await submit(B, { form_id: 'quote', name: 'Kim Ito', email: 'kim@customer.example', details: 'Signage' });
  const off = [...await settle('lee@customer.example', 1, 800), ...await settle('kim@customer.example', 1, 800)];
  ok('a studio with the switch off sends none, on either path (the enquiries are still kept)', !ackOf(off) && (db.tables.presence_form_submissions || []).filter((s) => s.site_id === B && !s.spam).length === 2);
}

// ═══ 10. Who owes you names each invoice's customer (the roster's Outstanding column) ═══
{
  const CUST_CLIENT = uuid('0'), CUST_SITE = '0000000c-0000-4000-8000-0000000000c1';
  world({
    presence_deals: [
      dealRow(DEAL_A, A, 'Website refresh', CT_A, { stage: 'won', converted_client_id: CUST_CLIENT, converted_site_id: CUST_SITE }),
      dealRow(DEAL_A2, A, 'Logo cleanup', CT_A, { stage: 'proposal' }),
      dealRow(DEAL_B, B, 'Harbor menu boards', CT_B, { stage: 'won', converted_client_id: '0000000b-0000-4000-8000-0000000000b1', converted_site_id: '0000000b-0000-4000-8000-0000000000b2' }),
    ],
    presence_invoices: [
      invoice(), invoice({ id: INV_A2, number: 14, deal_id: DEAL_A2, title: 'Logo deposit', purpose: 'deposit' }), invoice({ id: INV_X, number: 15, deal_id: DEAL_B, title: 'Stray invoice' }),
      invoice({ id: INV_B, site_id: B, deal_id: DEAL_B, title: 'Menu boards' }),
    ],
  });
  const r = await call('jwt-north', 'GET', `/sales/receivables?today=${today()}`);
  const items = r.body?.data?.items || [];
  const item = (id) => items.find((i) => i.id === id);
  ok('Who owes you: each invoice names the customer its deal became (client and site)', r.status === 200 && item(INV_A)?.client_id === CUST_CLIENT && item(INV_A)?.customer_site_id === CUST_SITE && item(INV_A)?.deal === 'Website refresh', `${r.status} ${JSON.stringify(items)}`);
  ok('…an unconverted deal’s invoice names no customer', item(INV_A2)?.client_id === null && item(INV_A2)?.customer_site_id === null);
  ok('…only this studio’s invoices are listed', !item(INV_B) && items.length === 3);
  ok('…and an invoice that names the other studio’s deal takes nothing from it', item(INV_X)?.client_id === null && item(INV_X)?.customer_site_id === null && item(INV_X)?.deal === '');
  ok('nothing in this suite reached anywhere but the fakes', out.escaped.length === 0, out.escaped.join(' '));
}

// ═══ the pages are checked in a browser ═══
// Covered in the browser by:
//   settings.html, the four switches, default off, each saving itself to /settings:
//     tests/e2e/settings.spec.ts › Settings — automations › the card opens the section: the recipes and seven switches, all off by default, each with the sentence it will send
//     tests/e2e/settings.spec.ts › Settings — automations › a saved row paints on; flipping a switch PUTs just that field and the sentence follows N
//     tests/e2e/settings.spec.ts › Settings — automations › the review switch: flipping it and changing its days each save just that field
//     tests/e2e/settings-safety.spec.ts › Settings — automations and the status lines (I3, I6, I7) › I3 — two switches flipped close together stay as pressed while their answers come back in either order
//   pipeline.html, stale after N days and what's next:
//     tests/e2e/pipeline.spec.ts › pipeline hygiene — stale after N days per stage, and what’s next › Settings says proposal: 7 → the proposal deal is stalled (and names N); the lead deal keeps the default
//     tests/e2e/pipeline.spec.ts › pipeline hygiene — stale after N days per stage, and what’s next › a failed /settings read leaves the default threshold — never an error
//     tests/e2e/pipeline.spec.ts › pipeline hygiene — stale after N days per stage, and what’s next › ticking the LAST open to-do asks what’s next with this stage’s presets; a chip adds the to-do
//     tests/e2e/pipeline.spec.ts › pipeline hygiene — stale after N days per stage, and what’s next › ticking a to-do while others stay open does not prompt; un-ticking never prompts
//   pipeline.html, the deal page keeps ONE filled button per view:
//     tests/e2e/pipeline.spec.ts › deal page — one filled button per view › an open deal with nothing drafted: Overview = Mark stage complete, Billing = + Proposal, the record link is quiet
//     tests/e2e/pipeline.spec.ts › deal page — one filled button per view › a SIGNED deal: Overview = Convert to customer, Billing = Convert — the agreement row and the Sign-first placeholder are quiet
//     tests/e2e/pipeline.spec.ts › deal page — one filled button per view › a drafted agreement on an unsigned deal: its row Send is Billing’s one; the convert card’s duplicate send is quiet
//     tests/e2e/pipeline.spec.ts › deal page — one filled button per view › Agreement out with BOTH documents drafted and nothing signed: Billing’s one is Send proposal & agreement — Convert waits for the signature
//     tests/e2e/pipeline.spec.ts › deal page — one filled button per view › a WON deal that is not converted yet: Won is not terminal — Convert is the do-next, guidance says so, Send invoice is quiet
//     tests/e2e/pipeline.spec.ts › deal page — one filled button per view › a converted deal: the header’s Send invoice is the one filled button on Overview; Billing adds none
//     tests/e2e/money-signature-212.spec.ts › the deal page’s one filled button › a drafted proposal: its row Send is Billing’s one
//     tests/e2e/money-signature-212.spec.ts › the deal page’s one filled button › a sent proposal and no agreement: + Agreement is Billing’s one
//     tests/e2e/money-signature-212.spec.ts › the deal page’s one filled button › the back bar’s record link is quiet, and opens this deal’s record as the studio
//     tests/e2e/money-signature-212.spec.ts › the deal page’s one filled button › the path repainted on Billing keeps its do-next quiet
//     tests/e2e/money-signature-212.spec.ts › the deal page’s one filled button › before a signature the convert card offers only a quiet, disabled Sign the agreement first
//     tests/e2e/money-signature-212.spec.ts › the deal page’s one filled button › a converted deal: Open their project and Resend welcome email are quiet, and Resend sends it again
//     (every other id the old suite listed is driven by the specs above: wonInvoice, convert, sendBothBtn, markComplete, pathConvert,
//      guideConvert, sendInvoice, sendDeposit, setupPlan, addProp, addCon, setupRetainer, closeD, dt-add, dt-preset)
//   agency.html, the roster's Outstanding column and chip, from /sales/receivables grouped by customer:
//     tests/e2e/agency.spec.ts › Agency roster — Outstanding › the column totals what each client owes, marks overdue, and sorts
//     tests/e2e/agency.spec.ts › Agency roster — Outstanding › the Outstanding chip shows only clients who owe
//     tests/e2e/agency.spec.ts › Agency roster — Outstanding › a settling (processing) payment is not owed: Outstanding matches the server’s total_cents, never the sum of every row

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MONEY & SIGNATURE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
