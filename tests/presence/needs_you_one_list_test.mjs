// ── One "needs you" list for the studio (sales review, Nov 2026, item 11) ───
//   deno run --allow-read tests/presence/needs_you_one_list_test.mjs
//
// Live on Nov 8 2026 the studio read four different answers to "what needs
// me": the bell 25 (38 before the duplicate-notice fix), Home 5, the Inbox 9,
// Analytics "nothing". The bell counted each open support request twice (the
// request and its weekly "Waiting on you" nudge) and ten enquiries from four
// people as ten; Home missed the studio's own enquiries and "make them a
// customer" entirely; website nags about the studio's practice site rode along.
// The rule now: ONE list (agency/needs_you.ts), one row per thing, and the bell
// at studio level shows its total. This pins the rule and the wiring.
import { buildNeedsYou, needsYouPayload, NEEDS_WEBSITE_KINDS, NEEDS_NUDGE_KINDS } from '../../supabase/functions/presence/agency/needs_you.ts';
const W = await import('../../supabase/functions/presence/routes/workspace.ts').catch(() => null);

let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const NOW = '2026-11-08T15:00:00Z';
const D1 = 'd1d1d1d1-0000-4000-8000-000000000001';
const D2 = 'd2d2d2d2-0000-4000-8000-000000000002';
const D3 = 'd3d3d3d3-0000-4000-8000-000000000003';
const base = () => ({ nowIso: NOW, links: [], clientNames: {}, namesByClient: {}, sites: [] });
const enq = (id, name, email, at, extra = {}) => ({ id, name, email, form_kind: 'contact', status: 'new', tier: 'needs_you', created_at: at, ...extra });

// ── the live shape: 10 enquiries from 4 people, 5 requests, a signed deal, nudges, news, a website nag ──
const live = {
  ...base(),
  support: [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, subject: `request ${n}`, project_id: null, client_id: null, requester_email: 'owner@studio.test', created_at: `2026-07-1${n}T00:00:00Z` })),
  own: {
    site_id: 'studio-site',
    enquiries: [
      enq('e1', 'Harbor Lane Bakery', 'bake@harbor.test', '2026-10-20T00:00:00Z'), enq('e2', 'Harbor Lane Bakery', 'Bake@Harbor.test', '2026-10-21T00:00:00Z'), enq('e3', 'Harbor Lane Bakery', 'bake@harbor.test', '2026-10-22T00:00:00Z'),
      enq('e4', 'Sam', 'sam@x.test', '2026-09-01T00:00:00Z'), enq('e5', 'Sam', 'sam@x.test', '2026-09-02T00:00:00Z'), enq('e6', 'Sam', 'sam@x.test', '2026-09-03T00:00:00Z'), enq('e7', 'Sam', 'sam@x.test', '2026-09-04T00:00:00Z'),
      enq('e8', 'Dana', 'dana@x.test', '2026-09-10T00:00:00Z'), enq('e9', 'Dana', 'dana@x.test', '2026-09-11T00:00:00Z'),
      enq('e10', 'A tester', 'test@x.test', '2026-10-25T00:00:00Z', { form_kind: 'quote' }),
      enq('e11', 'Replied already', 'r@x.test', '2026-10-25T00:00:00Z', { status: 'replied', tier: 'update' }),
    ],
    messages: [
      { type: 'support', tier: 'needs_you', client_id: 'c1', client: 'Maple Street Studio', thread_key: 'support:s1' },   // the support list names it already
      { type: 'message', tier: 'update', client_id: 'c2', client: 'Northside Dental', thread_key: 'client:c2', count: 2 },  // the studio replied last
      { type: 'message', tier: 'needs_you', client_id: 'c3', client: 'Oak & Ivy', thread_key: 'client:c3', count: 3, created_at: '2026-11-07T00:00:00Z', href: '/crm.html?project=p3&tab=messages' },
    ],
    notices: [
      { id: 'n-enq', kind: 'website_enquiry', tier: 'needs_you', headline: '10 new enquiries came in' },
      { id: 'n-sig', kind: 'deal_signed', period: `signed:${D1}`, tier: 'needs_you', headline: 'Agreement signed — ready to convert Willow Day Spa' },
      { id: 'n-acc', kind: 'deal_signed', period: `accepted:${D2}`, tier: 'needs_you', headline: 'Proposal accepted — Cedar Books' },
      { id: 'n-paid', kind: 'invoice_paid', period: 'paid:x', tier: 'update', headline: 'Paid — Invoice ($500.00)' },
      ...[1, 2, 3, 4, 5].map((n) => ({ id: `n-age${n}`, kind: 'support_aging', period: `support:s${n}:w2955`, tier: 'needs_you', headline: `Waiting on you — request ${n}` })),
      { id: 'n-lead', kind: 'lead_followup', period: 'lead:e4:w2955', tier: 'needs_you', headline: 'A quote request is waiting for a reply' },
      { id: 'n-inv', kind: 'deal_followup', period: `invremind:${D3}:due`, tier: 'needs_you', headline: 'Still unpaid — Deposit ($500)' },
      { id: 'n-rem', kind: 'deal_followup', period: 'remind:doc-1', tier: 'needs_you', headline: 'Reminder sent — Proposal', body: 'The proposal has been out a few days, so we sent the client one gentle reminder.' },
      { id: 'n-miss', kind: 'missing_required', tier: 'needs_you', headline: '2 sections need filling in before you can publish' },
      { id: 'n-down', kind: 'site_down', period: 'site:x:2026-11-08', tier: 'needs_you', headline: 'Your website didn’t respond' },
      { id: 'n-quiet', kind: 'deal_followup', period: `deal:${D3}:w2955`, tier: 'needs_you', headline: 'Follow up on Birch Cafe' },
      { id: 'n-trial', kind: 'trial_ending', period: 'trial:1', tier: 'needs_you', headline: 'Your trial ends in 3 days', body: 'Pick a plan to keep everything running.' },
      { id: 'n-book', kind: 'new_booking', period: 'book:1', tier: 'needs_you', headline: 'New booking — Thursday 10:00', body: 'Sam booked a call. Add it to your calendar.' },
    ],
  },
};
const rows = buildNeedsYou(live);
const keys = rows.map((r) => r.key);
const byKind = rows.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {});
eq('one row per person who wrote in (4), not per enquiry (10)', byKind.enquiry, 4);
eq('one row per open request (5), not two', byKind.support, 5);
eq('one row for the client conversation waiting on the studio', byKind.message, 1);
eq('deal rows: signed, accepted, gone quiet', rows.filter((r) => r.kind === 'deal').map((r) => r.key), [`deal:signed:${D1}`, `deal:accepted:${D2}`, `deal:quiet:${D3}`]);
eq('the studio account row', rows.filter((r) => r.kind === 'account').map((r) => r.name), ['Your Studio OS account']);
eq('any other ask is still a row', rows.filter((r) => r.kind === 'notice').map((r) => r.name), ['New booking — Thursday 10:00']);
eq('the total: 4 + 5 + 1 + 3 + 1 + 1 = 15', needsYouPayload(live, 50).total, 15);
ok('never a website nag about the studio\'s own site', !rows.some((r) => /publish|respond/i.test(r.name + r.what) && r.kind !== 'deal'));
ok('never a nudge about a thing already listed', !keys.some((k) => /n-age|n-lead|n-enq|n-inv/.test(k)));
ok('never a report of what the platform did ("Reminder sent")', !keys.some((k) => /n-rem/.test(k)) && !rows.some((r) => /Reminder sent/.test(r.name)));
ok('never the news (a payment landed)', !rows.some((r) => /Paid/.test(r.name)));

// the rows say who and what, in plain words, with one verb that goes somewhere
const harbor = rows.find((r) => r.name === 'Harbor Lane Bakery');
eq('three enquiries from one sender (email case aside) read as one row', harbor?.what, '3 new enquiries through your website');
eq('…opening the newest', harbor?.href, '/inbox.html#enquiries?sel=lead:e3');
eq('a quote form names itself', rows.find((r) => r.name === 'A tester')?.what, 'new quote request through your website');
eq('the longest wait comes first', rows.filter((r) => r.kind === 'enquiry').map((r) => r.name), ['Sam', 'Dana', 'Harbor Lane Bakery', 'A tester']);
const signed = rows.find((r) => r.key === `deal:signed:${D1}`);
eq('signed: named by the deal, verb Convert, opens the deal', [signed?.name, signed?.what, signed?.verb, signed?.href], ['Willow Day Spa', 'signed the agreement — make them a customer', 'Convert', `/pipeline.html?deal=${D1}`]);
eq('accepted: send the agreement', rows.find((r) => r.key === `deal:accepted:${D2}`)?.what, 'accepted your proposal — send the agreement');
eq('quiet: named from "Follow up on …"', rows.find((r) => r.key === `deal:quiet:${D3}`)?.name, 'Birch Cafe');
const msg = rows.find((r) => r.kind === 'message');
eq('a conversation row names the client and goes to the thread', [msg?.name, msg?.what, msg?.verb, msg?.href], ['Oak & Ivy', '3 messages are waiting for your reply', 'Reply', '/crm.html?project=p3&tab=messages']);
eq('the account row reads the notice', rows.find((r) => r.kind === 'account')?.what, 'your trial ends in 3 days');
eq('a generic ask reads its first sentence', rows.find((r) => r.kind === 'notice')?.what, 'sam booked a call');
// the fixed order: money, enquiries, support, messages, deals, …, account, other
const order = rows.map((r) => r.kind).filter((k, i, a) => a.indexOf(k) === i);
eq('kinds in the fixed order', order, ['enquiry', 'support', 'message', 'deal', 'account', 'notice']);

// a late next step and a quiet nudge on the same deal are one row
const lateAndQuiet = buildNeedsYou({ ...base(), deals: [{ id: D3, title: 'Birch Cafe', stage: 'proposal', next_step: 'Call', next_step_at: '2026-11-01' }], own: { notices: [{ id: 'q', kind: 'deal_followup', period: `deal:${D3}:w2955`, tier: 'needs_you', headline: 'Follow up on Birch Cafe' }] } });
eq('late step + quiet nudge on one deal → one row', lateAndQuiet.map((r) => r.key), [`deal:${D3}`]);
// nothing at all
eq('no own rows → nothing added', buildNeedsYou(base()).length, 0);

// the kind lists the two filters share
for (const k of ['missing_required', 'site_down', 'publish_failed', 'connection_expired', 'domain_expiry', 'client_feedback']) ok(`website kind: ${k}`, NEEDS_WEBSITE_KINDS.has(k));
for (const k of ['support_aging', 'lead_followup', 'website_enquiry']) ok(`nudge kind: ${k}`, NEEDS_NUDGE_KINDS.has(k));

// ── the feed at studio level (pure) ──
if (W && W.studioLevelFeed) {
  const f = W.studioLevelFeed({ notices: [{ kind: 'missing_required' }, { kind: 'deal_signed' }, { kind: 'client_feedback' }, { kind: 'site_down' }], moments: [{ id: 'm' }], pending_approvals: [{ id: 'a' }], client_messages: [{ id: 'x' }] });
  eq('studio level: website notices, moments and approvals stay on the Website page', [f.notices.map((n) => n.kind), f.moments.length, f.pending_approvals.length, f.client_messages.length], [['deal_signed'], 0, 0, 1]);
  ok('the two website lists agree', [...NEEDS_WEBSITE_KINDS].every((k) => W.STUDIO_WEBSITE_NOTICE_KINDS.has(k)) && [...W.STUDIO_WEBSITE_NOTICE_KINDS].every((k) => NEEDS_WEBSITE_KINDS.has(k)));
} else ok('workspace.ts imports for the pure feed check', false);

// ── the wiring: one computation behind Home, the bell and the bell's tab ──
const ag = read('supabase/functions/presence/agency/routes.ts');
ok('Home\'s route is the shared computation', /route === '\/agency\/needs-you'[\s\S]{0,200}computeStudioNeeds\(member, principal, jwt, now\)/.test(ag));
ok('…which reads the studio site\'s own Inbox rows from the one feed builder', /buildPortalFeed\(jwt, own, principal\)/.test(ag) && /own: ownFeed \? \{ site_id: own\?\.id \|\| null, enquiries: ownFeed\.enquiries/.test(ag));
ok('…and keeps its total for the bell (a minute)', /needsTotals\.set\(member\.agency_id/.test(ag) && /NEEDS_TOTAL_TTL_MS = 60_000/.test(ag));
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the bell at studio level is that total', /if \(agencyMember && !scopedName && seesFull\)[\s\S]{0,200}studioNeedsTotal\(agencyMember as any, principal, jwt\)/.test(ws));
ok('the feed at studio level drops the website rows', /if \(member\) return studioLevelFeed\(data\)/.test(ws));
ok('the feed reads enough notices for the list (30, not 10)', /presence_plan_notices\?site_id=eq\.\$\{site\.id\}&status=eq\.active&select=id,kind,period,headline,body,created_at&order=created_at\.desc&limit=30/.test(ws));
const shell = read('shell.js');
ok('the bell\'s Needs-you tab lists the same rows at studio level', /studioLevel \? api\('\/agency\/needs-you'\)/.test(shell) && /function studioBellRows\(d, ny\)/.test(shell));
const today = read('today.html');
ok('a studio account at studio level is sent to the one Home', /c0 && c0\.is_agency && !\(c0\.scope && c0\.scope\.site_id\) && !new URLSearchParams\(location\.search\)\.get\('client'\)\)\{ location\.replace\('\/agency\.html'\)/.test(today));
const inbox = read('inbox.html');
ok('the Inbox counts conversations in its own words', /\$\{need\} waiting for a reply · Sorted by newest/.test(inbox) && !/need\$\{need===1\?'s':''\} you/.test(inbox));
const comp = read('supabase/functions/presence/analytics/compose.ts');
ok('Analytics never says "nothing needs you" from the clients alone', !/quiet and current — nothing needs you/.test(comp));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
