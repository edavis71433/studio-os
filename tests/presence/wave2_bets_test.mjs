// ── Wave 2: the benchmark's bigger bets (items 7, 8, 10, 12), checked by what the code does ──
// Builder item 212 (review finding 108) rewrote this suite. It used to read shell.js, the
// pages and the routes as text; now it drives the real code against an in-memory PostgREST
// (tests/presence/fake_pgrst.mjs), and the page halves live in the browser.
//
//    8  the bell: the pure tier and priority rules, then GET /portal/feed built by the real
//       buildPortalFeed. Every kind of row (notices, approvals, moments, the four made-up
//       rows, conversations, support requests, enquiries) carries its tier and priority, the
//       feed reads no bell table of its own, and another business's rows never show.
//    7  the concierge: the pure chip rule, then POST /concierge/ask (handleConciergeAsk)
//       sends source_labels when the answer is polished and when the AI ceiling skips the
//       polish, drawn only from this business's own moments.
//   12  sample data on a new trial: the pure rows; the seed (once per site, never on a
//       failed read, nothing half-made); provisioning's `created`; the remove (only the
//       marked rows, only on this site, and the enquiry's nudge goes too); both routes
//       through the real router (signed out is a 401, signed in answers for your own site).
//   10  the keyboard is shell.js only, so it is checked in the browser (list at the end).
//
//   deno run --allow-read --allow-env --allow-net tests/presence/wave2_bets_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

const uuid = (c, n = 0) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${String(n).padStart(12, '0')}`;
const SITE_A = uuid('a'), SITE_B = uuid('b'), SITE_S = uuid('5');      // a business, another business, the studio that serves A
const CLIENT_A = uuid('a', 1), CLIENT_B = uuid('b', 1), CLIENT_S = uuid('5', 1);
const USERS = {
  'jwt-owner-a': { id: uuid('a', 9), email: 'owner-a@example.com' },
  'jwt-owner-b': { id: uuid('b', 9), email: 'owner-b@example.com' },
  'jwt-studio': { id: uuid('5', 9), email: 'owner@studio.example.com' },
};
const db = installFakePostgrest({ users: USERS, ownSite: { 'jwt-owner-a': SITE_A, 'jwt-owner-b': SITE_B, 'jwt-studio': SITE_S }, unique: { presence_sites: [['client_id']] } });

// Two things the shared fake doesn't do, kept to this suite:
//  · PostgREST answers a DELETE sent with Prefer: return=representation with the rows it
//    removed (the example-data remove counts them and clears their nudges); the fake says 204
//  · the model the concierge's polish calls (api.anthropic.com): a canned rewording, logged
const fakeFetch = globalThis.fetch;
const modelCalls = [];
let racePost = null;   // provisioning's race: runs just before the site insert reaches the database
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = String(init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.anthropic.com') {
    modelCalls.push(JSON.parse(String(init.body || '{}')));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Customers can’t tell when you’re open. Add your hours and publish.' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (racePost && method === 'POST' && u.pathname === '/rest/v1/presence_sites') { const f = racePost; racePost = null; await f(); }
  if (method === 'DELETE' && String(new Headers(init.headers).get('Prefer') || '').includes('return=representation')) {
    const table = u.pathname.replace('/rest/v1/', '');
    const before = [...(db.tables[table] || [])];
    const r = await fakeFetch(url, init);
    if (!r.ok) return r;
    const left = new Set(db.tables[table] || []);
    return new Response(JSON.stringify(before.filter((row) => !left.has(row))), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fakeFetch(url, init);
};
for (const k of ['CONCIERGE_POLISH', 'ANTHROPIC_KEY', 'AI_CEILING_DISABLED', 'AI_UNLIMITED_CLIENTS', 'AI_CEILING_MULT', 'RESEND_API_KEY', 'OPS_ALERT_EMAIL']) Deno.env.delete(k);

const F = await import('../../supabase/functions/presence/lib/inbox_feed.ts');
const A = await import('../../supabase/functions/presence/concierge/answer.ts');
const X = await import('../../supabase/functions/presence/commerce/example_data.ts');
const PROV = await import('../../supabase/functions/presence/commerce/provision.ts');
const W = await import('../../supabase/functions/presence/routes/workspace.ts');
const C = await import('../../supabase/functions/presence/routes/concierge.ts');
const { periodOf } = await import('../../supabase/functions/presence/commerce/capacity.ts');

// the real index.ts, with std's serve() handed a fake listener: no socket opens (scoped_commerce_test's way)
const queue = []; let wake = null;
Deno.listen = () => {
  let first = true;
  return { addr: { transport: 'tcp', hostname: 'stub', port: 1 }, accept: () => { if (first) { first = false; return Promise.resolve({ localAddr: {}, remoteAddr: {}, close() {} }); } return new Promise(() => {}); }, close() {} };
};
Deno.serveHttp = () => ({ nextRequest: () => new Promise((res) => { if (queue.length) res(queue.shift()); else wake = res; }), close() {} });
await import('../../supabase/functions/presence/index.ts');
function send(request) {
  return new Promise((resolve) => {
    const ev = { request, respondWith: async (r) => { resolve(await r); } };
    if (wake) { const w = wake; wake = null; w(ev); } else queue.push(ev);
  });
}
async function call(jwt, method, route, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers['x-dds-user-jwt'] = jwt;
  const res = await send(new Request(`https://fn.test/functions/v1/presence${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const principalOf = (jwt) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: 't-1', role: 'client', email: USERS[jwt].email, jwt, requestId: 'wave2', scope: null });
const NOW_ISO = new Date().toISOString();
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

// ═══ 8 · the bell grows up ═══
// the pure rules every surface shares
eq('8: a money notice is a needs-you ask', F.noticeTier('payment_trouble'), 'needs_you');
eq('8: a paid invoice is an update', F.noticeTier('invoice_paid'), 'update');
eq('8: the studio publishing for a client is an update', F.noticeTier('studio_published'), 'update');
eq('8: a reviewer’s decision is an update', F.noticeTier('approval_decided'), 'update');
eq('8: an unknown kind is an ask (never silently demoted)', F.noticeTier('something_new'), 'needs_you');
ok('8: priority is money and approvals', F.noticePriority('payment_trouble', '') && F.noticePriority('account_lapsed', '2026-10') && F.noticePriority('invoice_void_paid', 'voidpaid:x') && F.noticePriority('retainer_status', 'retainer:d:past_due:w1') && F.noticePriority('approval_overdue', 'approval:p:a'));
ok('8: an unpaid-invoice reminder is priority; an ordinary deal follow-up is not', F.noticePriority('deal_followup', 'invremind:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') && !F.noticePriority('deal_followup', 'deal:d1:w1'));
ok('8: a lead nudge is an ask, not priority', F.noticeTier('lead_followup') === 'needs_you' && !F.noticePriority('lead_followup', 'lead:l1'));
// the badge counts asks only: the one intentional contract change
const bell = (notices) => F.studioBellCount({ notices, newEnquiries: 0, proposedPlans: 0, proposedWrites: 0, filesPending: 0, openFeedback: 0, openSupport: 0, clientEvents: [], lastSeenAt: null });
eq('8: the badge counts needs-you notices', bell([{ kind: 'publish_failed' }, { kind: 'domain_expiry' }]), 2);
eq('8: an update notice renders but never rings the badge', bell([{ kind: 'publish_failed' }, { kind: 'invoice_paid' }, { kind: 'studio_published' }]), 1);
eq('8: the client_* throttle rows stay out of the count', bell([{ kind: 'client_message' }, { kind: 'invoice_paid' }]), 0);
ok('8: the update kinds are exactly these ten', [...F.UPDATE_NOTICE_KINDS].sort().join() === ['invoice_paid', 'studio_published', 'welcome_back', 'win_back', 'approval_decided', 'booking_reminder', 'invoice_upcoming', 'site_published', 'traffic_spike', 'auto_reply_ceiling'].sort().join());   // builder item 391 added the last   // item 47 added the last two; invoice_upcoming is sales review item 47

// GET /portal/feed, the one read the bell, Today and the Inbox share
const N = { PAY: uuid('e', 1), PAID: uuid('e', 2), INVREM: uuid('e', 3), DEALNUDGE: uuid('e', 4), LEAD: uuid('e', 5), PUBLISHED: uuid('e', 6), B_PAY: uuid('e', 7) };
const INVOICE_A = uuid('c', 1), INVOICE_B = uuid('c', 2), DEAL_A = uuid('d', 1), LEAD_A = uuid('f', 1);
const PLAN_A = uuid('9', 1), WRITE_A = uuid('9', 2), MEDIA_A = uuid('9', 3), MOMENT_FEED_A = uuid('9', 4);
const STUDIO_PROJECT = uuid('7', 1);
const notice = (id, site_id, client_id, kind, period, headline, min) => ({ id, site_id, client_id, kind, period, headline, body: `${headline}.`, status: 'active', created_at: minutesAgo(min) });
const feedWorld = () => ({
  presence_sites: [
    { id: SITE_A, client_id: CLIENT_A, status: 'live', unfinished_sections: 2 },
    { id: SITE_B, client_id: CLIENT_B, status: 'live', unfinished_sections: 4 },
    { id: SITE_S, client_id: CLIENT_S, status: 'live', unfinished_sections: 0 },
  ],
  presence_plan_notices: [
    notice(N.PAY, SITE_A, CLIENT_A, 'payment_trouble', '2026-11', 'Your card was declined', 10),
    notice(N.PAID, SITE_A, CLIENT_A, 'invoice_paid', `paid:${INVOICE_A}`, 'Paid: Photos $400', 11),
    notice(N.INVREM, SITE_A, CLIENT_A, 'deal_followup', `invremind:${INVOICE_A}`, 'Still unpaid: Deposit $1,600', 12),
    notice(N.DEALNUDGE, SITE_A, CLIENT_A, 'deal_followup', `deal:${DEAL_A}:w3`, 'Harbor Dental has gone quiet', 13),
    notice(N.LEAD, SITE_A, CLIENT_A, 'lead_followup', `lead:${LEAD_A}`, 'A quote request is waiting for a reply', 14),
    notice(N.PUBLISHED, SITE_A, CLIENT_A, 'studio_published', '2026-11-14', 'Your studio published your site', 15),
    notice(N.B_PAY, SITE_B, CLIENT_B, 'payment_trouble', '2026-11', 'BRAVO card was declined', 1),
  ],
  presence_invoices: [{ id: INVOICE_A, site_id: SITE_A, status: 'open' }, { id: INVOICE_B, site_id: SITE_B, status: 'open' }],
  presence_infra_plans: [
    { id: PLAN_A, site_id: SITE_A, status: 'proposed', title: 'Protect your email', summary: 'Add email authentication.', risk: 'low' },
    { id: uuid('9', 11), site_id: SITE_B, status: 'proposed', title: 'BRAVO plan', summary: 'Theirs.', risk: 'low' },
  ],
  presence_connection_writes: [{ id: WRITE_A, site_id: SITE_A, status: 'proposed', provider_key: 'gbp', title: 'Update your Google hours', summary: 'Match your site.' }],
  presence_media: [{ id: MEDIA_A, site_id: SITE_A, asset_status: 'pending', deleted_at: null, storage_path: `${SITE_A}/logo-new.png`, alt_text: 'Logo', metadata: { pending_replace: true, title: 'Logo' } }],
  presence_moments: [
    { id: MOMENT_FEED_A, site_id: SITE_A, status: 'active', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', created_at: minutesAgo(30) },
    { id: uuid('9', 14), site_id: SITE_B, status: 'active', headline: 'BRAVO moment', summary: 'Theirs.', moment_type: 'reminder', created_at: minutesAgo(30) },
  ],
  presence_form_submissions: [
    { id: LEAD_A, site_id: SITE_A, spam: false, status: 'new', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', created_at: minutesAgo(2000) },
    { id: uuid('f', 2), site_id: SITE_A, spam: false, status: 'new', form_kind: 'contact', name: 'Dana Lee', email: 'dana@example.com', phone: '', message: 'Do you build shops?', created_at: minutesAgo(20) },
    { id: uuid('f', 3), site_id: SITE_B, spam: false, status: 'new', form_kind: 'contact', name: 'BRAVO lead', email: 'b@example.com', phone: '', message: 'Theirs.', created_at: minutesAgo(5) },
  ],
  presence_section_comments: [
    { id: uuid('6', 1), site_id: SITE_A, author_kind: 'client', status: 'open', deleted_at: null },
    { id: uuid('6', 2), site_id: SITE_B, author_kind: 'client', status: 'open', deleted_at: null },
  ],
  // A is a customer of studio S: the studio's update on A's project lands on A's feed as one row
  presence_service_links: [{ id: uuid('8', 1), customer_client_id: CLIENT_A, agency_site_id: SITE_S, project_id: STUDIO_PROJECT, status: 'active' }],
  presence_project_events: [{ id: uuid('8', 2), site_id: SITE_S, project_id: STUDIO_PROJECT, kind: 'message', client_visible: true, detail: { from: 'studio' }, created_at: minutesAgo(3) }],
});
const feedAs = async (jwt, site) => {
  const r = await W.handlePortalFeed(jwt, site, principalOf(jwt), {});
  return { status: r.status, data: (await r.json()).data };
};
{
  db.reset(feedWorld());
  const { status, data } = await feedAs('jwt-owner-a', { id: SITE_A, client_id: CLIENT_A, status: 'live' });
  const byId = Object.fromEntries((data.notices || []).map((n) => [n.id, n]));
  const tp = (id) => byId[id] ? [byId[id].tier, byId[id].priority] : null;
  ok('8: the feed answers 200 for the owner', status === 200 && Array.isArray(data.notices), String(status));
  eq('8: a declined card is an ask and on top', tp(N.PAY), ['needs_you', true]);
  eq('8: a paid invoice is an update', tp(N.PAID), ['update', false]);
  eq('8: an unpaid-invoice reminder is an ask and on top', tp(N.INVREM), ['needs_you', true]);
  eq('8: a quiet deal is an ask, not on top', tp(N.DEALNUDGE), ['needs_you', false]);
  eq('8: a lead nudge is an ask, not on top', tp(N.LEAD), ['needs_you', false]);
  eq('8: the studio publishing is an update', tp(N.PUBLISHED), ['update', false]);
  const appr = data.pending_approvals || [];
  ok('8: each approval waiting (a plan, a connected change, a file) is an ask and on top', appr.length === 3 && ['infrastructure', 'connected', 'file'].every((k) => appr.some((p) => p.kind === k)) && appr.every((p) => p.tier === 'needs_you' && p.priority === true), JSON.stringify(appr.map((p) => [p.kind, p.tier, p.priority])));
  eq('8: a moment is an update', (data.moments || []).map((m) => [m.id, m.tier, m.priority]), [[MOMENT_FEED_A, 'update', false]]);
  const made = Object.fromEntries((data.notices || []).filter((n) => ['new-enquiries', 'client-feedback', 'missing-required', 'bridge-updates'].includes(n.id)).map((n) => [n.id, [n.tier, n.priority, n.dismissible]]));
  eq('8: the four made-up rows (new enquiry, client feedback, unfinished sections, the studio’s update) are asks no hand can clear', made, { 'bridge-updates': ['needs_you', false, false], 'client-feedback': ['needs_you', false, false], 'new-enquiries': ['needs_you', false, false], 'missing-required': ['needs_you', false, false] });
  ok('8: the made-up rows say what they are about (one fresh enquiry, since the other has its own nudge)', byId['new-enquiries']?.headline === 'A new enquiry came in' && byId['missing-required']?.headline === '2 sections need filling in before you can publish' && byId['bridge-updates']?.headline === 'An update from your studio', JSON.stringify([byId['new-enquiries']?.headline, byId['missing-required']?.headline, byId['bridge-updates']?.headline]));
  ok('8: an enquiry is an ask while it is new', (data.enquiries || []).length === 2 && data.enquiries.every((e) => e.tier === 'needs_you' && e.priority === false), JSON.stringify((data.enquiries || []).map((e) => [e.name, e.tier])));
  ok('8: nothing of another business comes back in the feed', !/BRAVO/.test(JSON.stringify(data)) && !JSON.stringify(data).includes(N.B_PAY), JSON.stringify(data).match(/BRAVO[^"]*/)?.[0] || '');
  ok('8: every row it read was this business’s (or the studio’s rows about it)', db.log.filter((c) => c.method === 'GET' && /\/rest\/v1\/presence_(plan_notices|infra_plans|connection_writes|media|moments|form_submissions|section_comments)\?/.test(c.url)).every((c) => c.url.includes(`site_id=eq.${SITE_A}`)), db.log.filter((c) => c.method === 'GET').map((c) => c.url).join('\n'));
  ok('MOAT: no notification store of its own: the feed reads and writes no bell table', !db.log.some((c) => /bell/i.test(c.url)), db.log.map((c) => c.url).filter((x) => /bell/i.test(x)).join(' '));
}
{
  // the same reads from the other business: its own rows, none of A's
  db.reset(feedWorld());
  const { data } = await feedAs('jwt-owner-b', { id: SITE_B, client_id: CLIENT_B, status: 'live' });
  const ids = (data.notices || []).map((n) => n.id);
  ok('8: the other business gets its own card notice and none of A’s', ids.includes(N.B_PAY) && !ids.includes(N.PAY) && !ids.includes(N.INVREM) && !/Harbor Dental|Sam Rivera|Protect your email/.test(JSON.stringify(data)), ids.join(','));
}
{
  // conversations and support requests on the studio's own site
  const P1 = uuid('7', 11), P2 = uuid('7', 12);
  const C1 = uuid('3', 1), C2 = uuid('3', 2);
  db.reset({
    presence_sites: [{ id: SITE_S, client_id: CLIENT_S, status: 'live', unfinished_sections: 0 }],
    presence_projects: [
      { id: P1, site_id: SITE_S, name: 'Site build', client_id: C1, deleted_at: null },
      { id: P2, site_id: SITE_S, name: 'Menu refresh', client_id: C2, deleted_at: null },
    ],
    presence_service_links: [
      { id: uuid('8', 11), agency_site_id: SITE_S, project_id: P1, customer_client_id: C1, status: 'active' },
      { id: uuid('8', 12), agency_site_id: SITE_S, project_id: P2, customer_client_id: C2, status: 'active' },
    ],
    clients: [{ id: C1, name: 'Marlow’s Kitchen', email: 'jo@marlow.example.com' }, { id: C2, name: 'Beacon Bakery', email: 'bea@beacon.example.com' }],
    presence_project_events: [
      // P1: the client wrote, the studio answered → not waiting on the studio
      { id: uuid('8', 21), site_id: SITE_S, project_id: P1, kind: 'message', detail: { from: 'client' }, created_at: minutesAgo(60) },
      { id: uuid('8', 22), site_id: SITE_S, project_id: P1, kind: 'message', detail: { from: 'studio' }, created_at: minutesAgo(30) },
      // P2: the studio wrote, then the client → waiting on the studio
      { id: uuid('8', 23), site_id: SITE_S, project_id: P2, kind: 'message', detail: { from: 'studio' }, created_at: minutesAgo(50) },
      { id: uuid('8', 24), site_id: SITE_S, project_id: P2, kind: 'message', detail: { from: 'client' }, created_at: minutesAgo(10) },
    ],
    presence_support_requests: [
      { id: uuid('4', 1), site_id: SITE_S, subject: 'Logo tweak', status: 'open', priority: 'normal', project_id: P1, client_id: C1, requester: 'jo@marlow.example.com', created_at: minutesAgo(40), updated_at: minutesAgo(40), deleted_at: null },
      { id: uuid('4', 2), site_id: SITE_S, subject: 'New photos', status: 'in_progress', priority: 'normal', project_id: P2, client_id: C2, requester: 'bea@beacon.example.com', created_at: minutesAgo(45), updated_at: minutesAgo(45), deleted_at: null },
      { id: uuid('4', 3), site_id: SITE_S, subject: 'Done and dusted', status: 'resolved', priority: 'normal', project_id: P1, client_id: C1, requester: 'jo@marlow.example.com', created_at: minutesAgo(90), updated_at: minutesAgo(90), deleted_at: null },
    ],
  });
  const { data } = await feedAs('jwt-studio', { id: SITE_S, client_id: CLIENT_S, status: 'live' });
  const rows = data.client_messages || [];
  const msg = (pid) => rows.find((r) => r.type === 'message' && r.project_id === pid);
  const sup = (subject) => rows.find((r) => r.type === 'support' && r.subject === subject);
  eq('8: a conversation the studio answered last is an update', [msg(P1)?.needs_reply, msg(P1)?.tier, msg(P1)?.priority], [false, 'update', false]);
  eq('8: a conversation where the client wrote last is an ask', [msg(P2)?.needs_reply, msg(P2)?.tier, msg(P2)?.priority], [true, 'needs_you', false]);
  eq('8: an open support request is an ask', [sup('Logo tweak')?.tier, sup('Logo tweak')?.priority], ['needs_you', false]);
  eq('8: a support request in progress is still an ask', [sup('New photos')?.tier, sup('New photos')?.priority], ['needs_you', false]);
  ok('8: a resolved request leaves the feed', !sup('Done and dusted'), JSON.stringify(rows.map((r) => r.subject || r.project)));
}

// ═══ 7 · AI shows its sources ═══
eq('7: the chips are the topic’s headline, then the evidence, without repeats, four at most', A.sourceLabels({ headline: 'Your hours are missing' }, [{ human: 'No opening hours were found on the Contact page.' }, { human: 'Your hours are missing' }, { human: 'b' }, { human: 'c' }, { human: 'd' }]), ['Your hours are missing', 'No opening hours were found on the Contact page.', 'b', 'c']);
eq('7: no topic and no evidence gives no chips (nothing invented)', A.sourceLabels(null, []), []);
ok('7: a long evidence line is cut with an ellipsis', A.sourceLabels(null, [{ human: 'x'.repeat(80) }])[0].length <= 60 && A.sourceLabels(null, [{ human: 'x'.repeat(80) }])[0].endsWith('…'));
const MOMENT_A = uuid('9', 21), MOMENT_B = uuid('9', 22);
const groundingWorld = (usage) => ({
  presence_identity: [{ site_id: SITE_A, business_name: 'Alpha Cafe', settings: {} }, { site_id: SITE_B, business_name: 'Bravo Bistro', settings: {} }],
  presence_offerings: [],
  presence_moments: [
    { id: MOMENT_A, site_id: SITE_A, status: 'active', moment_key: 'hours', moment_type: 'reminder', headline: 'Your hours are missing', summary: 'Customers can’t see when you’re open.', tone: 'calm', supporting_recommendation_ids: ['rec-a'], importance: 5 },
    { id: MOMENT_B, site_id: SITE_B, status: 'active', moment_key: 'menu', moment_type: 'reminder', headline: 'BRAVO menu is out of date', summary: 'BRAVO summary.', tone: 'calm', supporting_recommendation_ids: ['rec-b'], importance: 9 },
  ],
  presence_recommendations: [
    { site_id: SITE_A, recommendation_hash: 'rec-a', rule: 'missing_hours', title: 'Add your hours', description: 'd', reason: 'r', expected_benefit: 'More people visit', estimated_effort: 'low', estimated_risk: 'none', undoability: 'versioned', action: 'edit', timing: 'soon', requires_ai: false, value_dimensions: ['trust'], supporting_judgment_ids: ['jud-a'], created_at: minutesAgo(5) },
    { site_id: SITE_B, recommendation_hash: 'rec-b', rule: 'stale_menu', title: 'BRAVO', description: 'd', reason: 'r', expected_benefit: 'b', estimated_effort: 'low', estimated_risk: 'none', undoability: 'versioned', action: 'edit', timing: 'soon', requires_ai: false, value_dimensions: [], supporting_judgment_ids: ['jud-b'], created_at: minutesAgo(5) },
  ],
  presence_judgments: [
    { site_id: SITE_A, judgment_hash: 'jud-a', rule: 'missing_hours', reasoning: 'r', category: 'trust', confidence: 0.6, evidence_ids: ['ev-a1', 'ev-a2'], created_at: minutesAgo(5) },
    { site_id: SITE_B, judgment_hash: 'jud-b', rule: 'stale_menu', reasoning: 'r', category: 'trust', confidence: 0.6, evidence_ids: ['ev-b1'], created_at: minutesAgo(5) },
  ],
  presence_evidence: [
    { id: 'ev-a1', type: 'page', human: 'No opening hours were found on the Contact page.', confidence: 0.9 },
    { id: 'ev-a2', type: 'listing', human: 'Your Google profile lists hours your site doesn’t.', confidence: 0.4 },
    { id: 'ev-b1', type: 'page', human: 'BRAVO evidence', confidence: 0.9 },
  ],
  presence_entitlements: [{ client_id: CLIENT_A, product: 'presence', plan: 'presence', status: 'active', founder: false }],
  presence_ai_usage: usage ? [{ client_id: CLIENT_A, period: periodOf(new Date()), input_tokens: 0, output_tokens: 0, images: 1000 }] : [],
});
const SITE_ROW_A = { id: SITE_A, client_id: CLIENT_A, status: 'live', last_published_at: '2026-10-01T00:00:00Z' };
const ask = async (body) => {
  const r = await C.handleConciergeAsk(new Request('https://fn.test/functions/v1/presence/concierge/ask', { method: 'POST', body: JSON.stringify(body) }), SITE_ROW_A, {});
  return { status: r.status, d: (await r.json()).data };
};
const LABELS_A = ['Your hours are missing', 'No opening hours were found on the Contact page.', 'Your Google profile lists hours your site doesn’t.'];
{
  Deno.env.set('CONCIERGE_POLISH', 'on'); Deno.env.set('ANTHROPIC_KEY', 'test-key-not-real');
  db.reset(groundingWorld(false)); modelCalls.length = 0;
  const under = await ask({ question: 'What does this mean?', topic_id: MOMENT_A });
  ok('7: under the AI ceiling the answer is polished by the model…', under.status === 200 && modelCalls.length === 1 && under.d.answer === 'Customers can’t tell when you’re open. Add your hours and publish.', `${under.status} calls:${modelCalls.length} ${under.d?.answer}`);
  eq('7: …and still names what it drew on', under.d.source_labels, LABELS_A);
  ok('7: …with the honest low-confidence flag from the evidence', under.d.low_confidence === true && under.d.grounded === true && under.d.sources?.moment_id === MOMENT_A);
  db.reset(groundingWorld(true)); modelCalls.length = 0;
  const over = await ask({ question: 'What does this mean?', topic_id: MOMENT_A });
  ok('7: over the AI ceiling nothing is sent to the model and the plain answer stands…', over.status === 200 && modelCalls.length === 0 && /Customers can’t see when you’re open\./.test(over.d.answer), `${over.status} calls:${modelCalls.length} ${over.d?.answer}`);
  eq('7: …and the chips are there just the same', over.d.source_labels, LABELS_A);
  db.reset(groundingWorld(true));
  const other = await ask({ question: 'What does this mean?', topic_id: MOMENT_B });
  ok('7: asking about another business’s moment draws on nothing of theirs', other.status === 200 && JSON.stringify(other.d.source_labels) === '[]' && !/BRAVO/.test(JSON.stringify(other.d)) && other.d.topic === null, JSON.stringify(other.d).slice(0, 300));
  ok('7: the grounding read only this business’s moments, recommendations and judgments', db.log.filter((c) => /\/rest\/v1\/presence_(moments|recommendations|judgments)\?/.test(c.url)).every((c) => c.url.includes(`site_id=eq.${SITE_A}`)));
  Deno.env.delete('CONCIERGE_POLISH'); Deno.env.delete('ANTHROPIC_KEY');
}

// ═══ 12 · sample data on a new trial ═══
const rows = X.exampleRows('site-1', new Date('2026-10-20T12:00:00Z'), 'ct-1');
ok('12: every example row says so in its name', rows.contact.name.startsWith('Example: ') && rows.contact.company === 'Example: Marlow’s Kitchen' && rows.deal.title.startsWith('Example: ') && rows.submission.name.startsWith('Example: '));
ok('12: the rows are marked with columns the tables already have (no migration): email, source, fields.example', rows.contact.email === X.EXAMPLE_EMAIL && X.EXAMPLE_EMAIL.endsWith('.example') && rows.deal.source === 'example' && rows.submission.fields.example === true && rows.submission.source_page === 'example');
ok('12: the deal joins the contact and has a next step', rows.deal.contact_id === 'ct-1' && rows.deal.stage === 'proposal' && rows.deal.next_step === 'Send the proposal' && rows.deal.next_step_at === '2026-10-22' && rows.deal.expected_close === '2026-11-10');
ok('12: the enquiry is a new quote request (so the Inbox and the bell have something to show)', rows.submission.form_kind === 'quote' && rows.submission.status === 'new' && rows.submission.spam === false);

const writesTo = (t) => db.writes(t).length;
const exampleRowsOn = (site) => ({
  contacts: (db.tables.presence_contacts || []).filter((c) => c.site_id === site && c.email === X.EXAMPLE_EMAIL).length,
  deals: (db.tables.presence_deals || []).filter((d) => d.site_id === site && d.source === 'example').length,
  enquiries: (db.tables.presence_form_submissions || []).filter((s) => s.site_id === site && s.fields?.example === true).length,
});
{
  // the seed, on its own
  const NOW = new Date('2026-11-15T12:00:00Z');
  db.reset({ presence_contacts: [{ id: uuid('2', 1), site_id: SITE_B, name: 'Example: Jo Marlow', email: X.EXAMPLE_EMAIL, deleted_at: null }], presence_deals: [], presence_form_submissions: [] });
  const first = await X.seedExampleData(SITE_A, NOW);
  const ct = db.tables.presence_contacts.find((c) => c.site_id === SITE_A);
  const deal = (db.tables.presence_deals || []).find((d) => d.site_id === SITE_A);
  ok('12: a new site gets one example customer, deal and enquiry', first.seeded === true && JSON.stringify(exampleRowsOn(SITE_A)) === JSON.stringify({ contacts: 1, deals: 1, enquiries: 1 }), JSON.stringify([first, exampleRowsOn(SITE_A)]));
  ok('12: the example deal is joined to the example customer it created', !!ct && deal?.contact_id === ct.id && deal?.next_step_at === '2026-11-17');
  ok('12: another business already holding an example customer doesn’t stop this site’s seed', exampleRowsOn(SITE_B).contacts === 1 && first.seeded === true);
  const before = db.log.filter((c) => c.method !== 'GET').length;
  const again = await X.seedExampleData(SITE_A, NOW);
  ok('12: the seed runs once: a second run finds the example customer and writes nothing', again.seeded === false && db.log.filter((c) => c.method !== 'GET').length === before && JSON.stringify(exampleRowsOn(SITE_A)) === JSON.stringify({ contacts: 1, deals: 1, enquiries: 1 }));
  db.reset({ presence_contacts: [], presence_deals: [], presence_form_submissions: [] }); db.fail.add('presence_contacts');
  const blind = await X.seedExampleData(SITE_A, NOW);
  ok('12: a failed read seeds nothing (it can’t tell whether the rows are there)', blind.seeded === false && db.log.every((c) => c.method === 'GET'));
  db.reset({ presence_contacts: [], presence_deals: [], presence_form_submissions: [] }); db.failMethod.set('presence_contacts', 'POST');
  const half = await X.seedExampleData(SITE_A, NOW);
  ok('12: when the example customer can’t be saved, no deal or enquiry is left without it', half.seeded === false && writesTo('presence_deals') === 0 && writesTo('presence_form_submissions') === 0);
}
{
  // provisioning says whether THIS run created the site row (the seed keys on it)
  const patch = { status: 'active', founder: false, trial_ends_at: '2026-11-29T00:00:00Z' };
  const prov = (clientId) => PROV.provisionForSignup({ clientId, businessName: 'Juniper Floral', plan: 'presence_monitor', patch, actorEmail: 'owner@juniper.example.com' });
  db.reset({ presence_sites: [{ id: uuid('6', 50), client_id: 'client-existing', edition: 'monitor', status: 'live' }] });
  const fresh = await prov('client-new');
  const made = db.tables.presence_sites.filter((s) => s.client_id === 'client-new');
  ok('12: a first provisioning creates the site and says so', fresh.ok === true && fresh.created === true && made.length === 1 && fresh.siteId === made[0].id, JSON.stringify(fresh));
  const rerun = await prov('client-new');
  ok('12: running it again (a re-delivered webhook) finds the same site and says it did not create it', rerun.ok === true && rerun.created === false && rerun.siteId === fresh.siteId && db.tables.presence_sites.filter((s) => s.client_id === 'client-new').length === 1, JSON.stringify(rerun));
  const existing = await prov('client-existing');
  ok('12: an existing site is never reported as created', existing.ok === true && existing.created === false && existing.siteId === uuid('6', 50), JSON.stringify(existing));
  db.reset({ presence_sites: [] });
  racePost = async () => { db.tables.presence_sites.push({ id: uuid('6', 51), client_id: 'client-race', edition: 'monitor', status: 'provisioning', created_at: NOW_ISO }); };
  const raced = await prov('client-race');
  ok('12: losing the race to another run (409) adopts that site and says it did not create it', raced.ok === true && raced.created === false && raced.siteId === uuid('6', 51) && db.tables.presence_sites.length === 1, JSON.stringify(raced));
}
// PR 433 (builder item 199) rewrites this check; left as text until it lands
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const commerce = read('supabase/functions/presence/routes/commerce.ts');
// builder item 199: self-serve sign-up (the trial path) is closed, so the paid webhook path is the one left
ok('12: the seed runs only on a just-created site, and never blocks', (commerce.match(/if \(prov\.created && prov\.siteId\) await seedExampleData\(prov\.siteId\)\.catch\(\(\) => \{\}\);/g) || []).length === 1);

const exampleWorld = () => {
  const ex = (site, n) => [
    { id: uuid('2', n), site_id: site, name: 'Example: Jo Marlow', email: X.EXAMPLE_EMAIL, deleted_at: null },
    { id: uuid('3', n), site_id: site, title: 'Example: Website refresh', source: 'example', deleted_at: null },
    { id: uuid('4', n), site_id: site, name: 'Example: Jo Marlow', fields: { example: true }, source_page: 'example', status: 'new', spam: false },
  ];
  const [aCt, aDeal, aEnq] = ex(SITE_A, 1), [bCt, bDeal, bEnq] = ex(SITE_B, 2);
  return {
    presence_sites: [{ id: SITE_A, client_id: CLIENT_A, status: 'live' }, { id: SITE_B, client_id: CLIENT_B, status: 'live' }],
    clients: [{ id: CLIENT_A, email: 'owner-a@example.com', tenant_id: 't-1' }, { id: CLIENT_B, email: 'owner-b@example.com', tenant_id: 't-1' }],
    presence_contacts: [aCt, bCt, { id: uuid('2', 9), site_id: SITE_A, name: 'Avery Stone', email: 'avery@example.com', deleted_at: null }],
    presence_deals: [aDeal, bDeal, { id: uuid('3', 9), site_id: SITE_A, title: 'Harbor Dental site', source: 'manual', deleted_at: null }],
    presence_form_submissions: [aEnq, bEnq, { id: uuid('4', 9), site_id: SITE_A, name: 'Sam Rivera', fields: {}, source_page: '/contact/', status: 'new', spam: false }],
    presence_plan_notices: [
      notice(uuid('e', 21), SITE_A, CLIENT_A, 'lead_followup', `lead:${aEnq.id}`, 'The example enquiry is waiting', 5),
      notice(uuid('e', 22), SITE_A, CLIENT_A, 'lead_followup', `lead:${uuid('4', 9)}`, 'Sam is waiting', 6),
      notice(uuid('e', 23), SITE_B, CLIENT_B, 'lead_followup', `lead:${bEnq.id}`, 'BRAVO example enquiry is waiting', 7),
    ],
  };
};
const realRowsOnA = () => [db.tables.presence_contacts.some((c) => c.id === uuid('2', 9)), db.tables.presence_deals.some((d) => d.id === uuid('3', 9)), db.tables.presence_form_submissions.some((s) => s.id === uuid('4', 9))];
const statusOfNotice = (id) => db.tables.presence_plan_notices.find((n) => n.id === id)?.status;
{
  db.reset(exampleWorld());
  const removed = await X.removeExampleData(SITE_A, CLIENT_A);
  eq('12: remove deletes the example customer, deal and enquiry, and counts them', removed, { contacts: 1, deals: 1, enquiries: 1 });
  eq('12: …and nothing else on the site', realRowsOnA(), [true, true, true]);
  eq('12: …and nothing of another business’s, examples included', exampleRowsOn(SITE_B), { contacts: 1, deals: 1, enquiries: 1 });
  eq('12: the nudge about the example enquiry is cleared; other nudges stay', [statusOfNotice(uuid('e', 21)), statusOfNotice(uuid('e', 22)), statusOfNotice(uuid('e', 23))], ['dismissed', 'active', 'active']);
  ok('12: every delete named this site', db.log.filter((c) => c.method === 'DELETE').length === 3 && db.log.filter((c) => c.method === 'DELETE').every((c) => c.url.includes(`site_id=eq.${SITE_A}`)));
}
{
  // both routes, through the real router
  db.reset(exampleWorld());
  const before = JSON.stringify(db.tables);
  const r1 = await call(null, 'GET', '/commerce/example-data');
  const r2 = await call(null, 'POST', '/commerce/example-data/remove', {});
  const r3 = await call('jwt-unknown', 'POST', '/commerce/example-data/remove', {});
  ok('12: signed out, both routes answer 401 and nothing changes', r1.status === 401 && r2.status === 401 && r3.status === 401 && JSON.stringify(db.tables) === before && !db.log.some((c) => c.method === 'DELETE'), `${r1.status} ${r2.status} ${r3.status}`);
  const look = await call('jwt-owner-a', 'GET', '/commerce/example-data');
  ok('12: signed in, the read says the example rows are still there, counting only your own', look.status === 200 && look.body?.data?.present === true && JSON.stringify(look.body.data.counts) === JSON.stringify({ contacts: 1, deals: 1, enquiries: 1 }), look.text.slice(0, 200));
  const gone = await call('jwt-owner-a', 'POST', '/commerce/example-data/remove', {});
  ok('12: signed in, remove takes away only your own example rows', gone.status === 200 && gone.body?.data?.ok === true && JSON.stringify(gone.body.data.removed) === JSON.stringify({ contacts: 1, deals: 1, enquiries: 1 }) && JSON.stringify(exampleRowsOn(SITE_A)) === JSON.stringify({ contacts: 0, deals: 0, enquiries: 0 }) && JSON.stringify(exampleRowsOn(SITE_B)) === JSON.stringify({ contacts: 1, deals: 1, enquiries: 1 }) && realRowsOnA().every(Boolean), gone.text.slice(0, 200));
  const after = await call('jwt-owner-a', 'GET', '/commerce/example-data');
  ok('12: afterwards the read says nothing is left (Today hides the card)', after.status === 200 && after.body?.data?.present === false, after.text.slice(0, 200));
  const theirs = await call('jwt-owner-b', 'GET', '/commerce/example-data');
  ok('12: the other business still sees its own example rows', theirs.status === 200 && theirs.body?.data?.present === true && theirs.body.data.counts.contacts === 1, theirs.text.slice(0, 200));
}

// ═══ 10, 8, 7 and 12 in the browser: shell.js, shell.css, today.html, help.html, inbox.html and sales-ai.js ═══
// Covered in the browser by:
//   10 keyboard
//   tests/e2e/wave2-bets.spec.ts › 10: `/` opens the search and focuses its input; `?` opens the shortcuts sheet; Escape closes it
//   tests/e2e/wave2-bets.spec.ts › 10: keys are ignored while typing; on the Inbox the sheet lists the Inbox’s own keys
//   tests/e2e/wave2-bets.spec.ts › 10: `n` fires the page’s New action (the Inbox’s + New enquiry) and says so when a page has none
//       (inbox.html's + New enquiry is the button `n` presses)
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: while the search or the tour is open the plain keys do nothing
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: `?` again puts the sheet away; Shift+N and keys with a modifier held do nothing; plain `n` still works
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: typing in a text box, a list or an editable block never fires a key
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: signed out, the keys do nothing
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: `n` presses the [data-new] control first, else the first + / New / Add button, a filled one before a plain one, never a hidden, disabled or shell one
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: on the Inbox the sheet lists its three keys, each with what it does
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: the sheet is a shell layer: a click outside, the bell or the search closes it
//   tests/e2e/wave2-bets-212.spec.ts › keyboard › 10: the sheet draws each key as a key cap
//   8 the bell
//   tests/e2e/wave2-bets.spec.ts › 8: tabs filter by tier; priority rows (money + approvals) sit on top with the accent
//   tests/e2e/wave2-bets.spec.ts › 8: Mark read dims the rows and quiets the badge until the count changes; Clear dismisses only what a hand may clear
//       (Mark read and Clear are two buttons; approvals and moments are never cleared by hand; the heading and the Inbox footer)
//   tests/e2e/shell.spec.ts › bell opens the unified feed — notices first, then approvals (Phase FLOW/OS)
//   tests/e2e/wave2-bets-212.spec.ts › 8: the bell’s views are one tablist of three, and All brings every row back
//   tests/e2e/wave2-bets-212.spec.ts › 8: Clear sends only real notices, never a made-up row, even one marked dismissible
//   tests/e2e/wave2-bets-212.spec.ts › 8: a priority row carries the accent on its left edge; the others don’t
//   tests/e2e/wave2-bets-212.spec.ts › 8: after Mark read the badge stays quiet only until the count changes
//   tests/e2e/wave2-bets-212.spec.ts › 8: opening the bell reads /portal/feed and nothing else
//   7 AI shows its sources and drafts replies
//   tests/e2e/wave2-bets.spec.ts › 7: chips name what the concierge drew on, plus an honest line on low confidence (Today); Help asks the product helper and shows its links
//   tests/e2e/wave2-bets-212.spec.ts › 7: Today shows at most four chips and never an empty one, and reads an answer sent in the older `text` key
//   tests/e2e/wave2-bets.spec.ts › 7: Draft a reply asks AI help, lands in the textarea for editing, never sends
//   tests/e2e/sales-ai-94.spec.ts › Inbox: Draft a reply on an enquiry reads the enquiry and your services, and Send stays yours
//   tests/e2e/sales-ai-94.spec.ts › record: while it writes, Send waits and Cancel puts your words back
//   tests/e2e/sales-ai-94.spec.ts › record: AI help off says how to switch it on; the day’s limit and a failure say so, and the box is untouched
//   tests/e2e/wave2-bets-212.spec.ts › 7: Draft a reply on a support request asks AI help about that request; Send waits while it writes; nothing is sent, and never through the old writer
//   tests/e2e/wave2-bets-212.spec.ts › 7: in each Inbox composer Draft a reply is a pill, and the one filled button is the one that sends
//   12 sample data
//   tests/e2e/wave2-bets.spec.ts › 12: Today shows the example-data card; Remove is two steps and deletes through the one route
//   tests/e2e/wave2-bets.spec.ts › 12: no example rows (or a failed read) → no card; a drilled-in operator never reads it

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log('FAILURES'); failed.forEach((f) => console.log(' -', f)); Deno.exit(1); }
Deno.exit(0);   // the router import leaves its serve loop waiting
