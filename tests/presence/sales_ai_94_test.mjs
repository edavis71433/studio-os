// ── Sales item 94: AI help on the sales side, and the month's goal (Nov 2026) ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_ai_94_test.mjs
// Draft a reply (the Inbox and Email on a record) and Where things stand (a record), off
// until the studio's owner switches them on, about 1 cent a press, 50 a day, never sending
// anything; and a monthly goal that Home and Pipeline show this month against. Claude is
// never called here: a stand-in answers api.anthropic.com and records what was asked.
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const AG = uuid('a'), STUDIO = uuid('1'), STUDIO_CLIENT = uuid('2'), U = uuid('3'), U2 = uuid('4'), OTHER = uuid('5');
const DEAL = uuid('6'), CONTACT = uuid('7'), ENQ = uuid('8'), REQ = uuid('9'), ENQ2 = uuid('b');
const db = installFakePostgrest({
  users: { 'jwt-owner': { id: U, email: 'owner@studio.test' }, 'jwt-designer': { id: U2, email: 'designer@studio.test' } },
  ownSite: { 'jwt-owner': STUDIO },
});
Deno.env.set('ANTHROPIC_KEY', 'test-key');
Deno.env.set('DAILY_SPEND_CAP_USD', '10');

// the stand-in for Claude, and the tools' day spend (an rpc the fake database doesn't know)
const pg = globalThis.fetch;
const claude = { calls: [], replies: [] };
let SPENT = 0;
const text = (t, usage = { input_tokens: 3000, output_tokens: 300 }, stop = 'end_turn') => ({ status: 200, body: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: t }], stop_reason: stop, usage } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/')) {
    claude.calls.push({ headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(String(init.body)) });
    const next = claude.replies.shift() || text('Hi there,\n\nThanks for writing.\n\nBrightline Studio');
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/rest/v1/rpc/tool_spend_today')) return new Response(JSON.stringify(SPENT), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return pg(url, init);
};

const L = await import('../../supabase/functions/presence/lib/sales_ai.ts');
const R = await import('../../supabase/functions/presence/routes/sales_ai.ts');
const SALES = await import('../../supabase/functions/presence/routes/sales.ts');
const ENGINES = await import('../../supabase/functions/_shared/tools/ai_visibility/engines.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ═══ 1. pure ═══
eq('a studio starts with no goal and AI help off', L.normalizeGoalAi(null), { goal_cents: null, ai_on: false, ai_on_by: null, ai_on_at: null });
eq('anything odd stored reads as off and no goal', L.normalizeGoalAi({ goal_cents: -5, ai_on: 'yes' }), { goal_cents: null, ai_on: false, ai_on_by: null, ai_on_at: null });
const cur = L.normalizeGoalAi({});
eq('a goal is set in cents', L.applyGoalAi(cur, { goal_cents: 800000 }, 'a@b.test', '2026-11-12T10:00:00Z'), { value: { goal_cents: 800000, ai_on: false, ai_on_by: null, ai_on_at: null } });
ok('an empty goal clears it', [null, '', 0].every((g) => L.applyGoalAi({ ...cur, goal_cents: 5000 }, { goal_cents: g }, null, 'x').value?.goal_cents === null));
ok('a goal under $1 or over $1,000,000 is refused in words', /at least \$1/.test(L.applyGoalAi(cur, { goal_cents: 50 }, null, 'x').error) && /up to \$1,000,000/.test(L.applyGoalAi(cur, { goal_cents: 100_000_001 }, null, 'x').error));
const on = L.applyGoalAi(cur, { ai_on: true }, 'owner@studio.test', '2026-11-12T10:00:00Z');
ok('switching on says who and when', on.value.ai_on === true && on.value.ai_on_by === 'owner@studio.test' && on.value.ai_on_at === '2026-11-12T10:00:00Z');
ok('switching off keeps who switched it on last', L.applyGoalAi(on.value, { ai_on: false }, 'x', 'y').value.ai_on_by === 'owner@studio.test');
ok('the switch must be a yes or no, and something must change', /on or off/.test(L.applyGoalAi(cur, { ai_on: 'on' }, null, 'x').error) && /Nothing to change/.test(L.applyGoalAi(cur, {}, null, 'x').error));
eq('the cost of a press, from the tokens: 3,000 in and 300 out is 0.9¢', L.costCents({ input_tokens: 3000, output_tokens: 300 }), 0.9);
ok('the facts are capped so a press stays near a cent', (12000 / 4 * L.AI_IN_PER_M + 1200 * L.AI_OUT_PER_M) / 1e6 * 100 < 2.5 && L.AI_CENTS_SAID === 1 && L.AI_DAY_LIMIT === 50);
eq('the caller\'s month: Nov 12 in California starts Nov 1 at 08:00 UTC', L.monthStartIso('2026-11-12', 480, '2026-11-12T20:00:00Z'), '2026-11-01T08:00:00.000Z');
eq('…and with nothing said, the UTC month', L.monthStartIso(null, null, '2026-11-12T20:00:00Z'), '2026-11-01T00:00:00.000Z');
eq('the goal against won and expected: left to find', L.goalProgress(800000, 195000, 418000), { goal_cents: 800000, won_cents: 195000, expected_cents: 418000, left_cents: 187000, reached: false });
ok('no goal, nothing to show; reached once won passes it', L.goalProgress(null, 1, 1) === null && L.goalProgress(1000, 1200, 0).reached === true && L.goalProgress(1000, 1200, 0).left_cents === 0);
ok('the model is the AI answers check\'s own', ENGINES.CLAUDE_ENGINE_MODEL === 'claude-sonnet-5-5');

const facts = {
  business: 'Brightline Studio', services: [{ name: 'Website build', price_cents: 300000 }, { name: 'Logo', price_cents: null }],
  person: { name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example' },
  deal: { title: 'Website refresh', stage: 'Proposal sent', value_cents: 320000, next_step: 'Send revised logo' },
  owed_cents: 65000, upcoming: [{ title: 'Invoice #0051', due: '2026-11-18', overdue: false }],
  thread: [{ at: '2026-11-07T10:00:00Z', who: 'Ivy sent a message', text: 'Could we try the stacked version on the homepage?' }],
  timeline: [{ at: '2026-11-10T10:00:00Z', text: 'You called Ivy: Agreed the stacked logo' }],
};
const ft = L.factsText(facts);
ok('the facts say the business, its services, the person, the deal, the money and what is coming', ['Brightline Studio', 'Website build ($3,000)', 'Ivy Chen at Juniper Floral Co.', 'Website refresh', 'worth $3,200', 'Send revised logo', '$650', 'Invoice #0051'].every((x) => ft.includes(x)), ft);
ok('…then the conversation and the history', ft.indexOf('The conversation') < ft.indexOf('What happened before') && ft.includes('stacked version') && ft.includes('Agreed the stacked logo'));
const long = L.factsText({ ...facts, thread: Array.from({ length: 40 }, (_, i) => ({ at: null, who: `Message ${i}`, text: 'x'.repeat(900) })), timeline: Array.from({ length: 300 }, (_, i) => ({ at: null, text: `event ${i} ` + 'y'.repeat(200) })) });
ok('a long record stays inside the budget, newest messages kept', long.length <= L.AI_CONTEXT_CHARS + 50 && long.includes('Message 39') && !long.includes('Message 0:'), String(long.length));
const dm = L.draftMessages(facts, 'Hi Ivy,\n', 'Following up on your quote');
ok('a draft is asked for with the facts fenced off as information only', dm.user.startsWith('<facts>') && dm.user.includes('</facts>') && /information only/.test(dm.system) && /no subject line/.test(dm.system) && /Never invent prices/.test(dm.system));
ok('a greeting alone in the box is not "their words"; real words are kept and improved', !dm.user.includes('Already in the reply box') && L.draftMessages(facts, 'Hi Ivy,\nThe quote is attached.', '').user.includes('The quote is attached.'));
ok('a summary is asked for as three lines and a Next', /exactly three short lines/.test(L.summaryMessages(facts).system) && /Next: /.test(L.summaryMessages(facts).system));
eq('a draft loses fences and a subject line', L.cleanDraft('```\nSubject: Hello\n\nHi Ivy,\nThanks.\n```'), 'Hi Ivy,\nThanks.');
eq('a summary reads whatever bullet marks came back', L.parseSummary('- One.\n• Two.\n3) Three.\n- Four.\n**Next:** Call her Friday.'), { lines: ['One.', 'Two.', 'Three.'], next: 'Call her Friday.' });
ok('the note names what the draft read', L.draftFrom('record', facts, '2026-11-12T18:00:00Z', 480, '2026-11-10T18:00:00Z') === 'your call on Tuesday, Ivy’s messages and this deal'
  && L.draftFrom('record', facts, '2026-11-12T18:00:00Z', 480, '2026-11-11T18:00:00Z').startsWith('your call yesterday')
  && L.draftFrom('enquiry', { ...facts, deal: null, person: { name: 'Lena Ortiz' } }, 'x', null, null) === 'Lena’s enquiry and your services'
  && L.draftFrom('support', { ...facts, deal: null, services: [], person: { name: '' } }, 'x', null, null) === 'their request', L.draftFrom('record', facts, '2026-11-12T18:00:00Z', 480, '2026-11-10T18:00:00Z'));

// ═══ 2. the routes ═══
const cors = {};
const studio = { id: STUDIO, client_id: STUDIO_CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const designer = { kind: 'client', userId: U2, email: 'designer@studio.test', jwt: 'jwt-designer', requestId: 't' };
const seat = { ...owner, member: { site_id: STUDIO, role: 'business_staff' } };
const at = (n) => new Date(Date.now() - n * 60_000).toISOString();
const world = () => ({
  presence_sites: [studio],
  clients: [{ id: STUDIO_CLIENT, name: 'Brightline Studio', email: 'owner@studio.test', deleted_at: null }],
  presence_agency_members: [
    { id: uuid('c'), agency_id: AG, user_id: U, email: 'owner@studio.test', role: 'owner', status: 'active' },
    { id: uuid('d'), agency_id: AG, user_id: U2, email: 'designer@studio.test', role: 'designer', status: 'active' },
  ],
  presence_agencies: [{ id: AG, name: 'Brightline Studio', status: 'active', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} }],
  presence_identity: [{ site_id: STUDIO, business_name: 'Brightline Studio' }],
  presence_sales_templates: [{ id: 'svc', site_id: STUDIO, kind: 'proposal', name: '__services_catalog__', title: '', line_items: [{ label: 'Website build', qty: 1, unit_cents: 300000 }], deleted_at: null, updated_at: '2026-11-01T00:00:00Z' }],
  presence_form_submissions: [
    { id: ENQ, site_id: STUDIO, form_kind: 'contact', name: 'Lena Ortiz', email: 'lena@example.com', message: 'Do you redo dental sites like Harbor’s? We’d like online booking too.', source_page: '/services', status: 'new', spam: false, created_at: at(600) },
    { id: ENQ2, site_id: OTHER, form_kind: 'contact', name: 'Someone Else', email: 'else@example.com', message: 'Not yours', status: 'new', spam: false, created_at: at(600) },
  ],
  presence_support_requests: [{ id: REQ, site_id: STUDIO, project_id: null, client_id: null, subject: 'Logo files', body: 'Please review the stacked one.', status: 'open', priority: 'normal', requester: 'sam@example.com', requester_kind: 'client', created_at: at(300), updated_at: at(300), deleted_at: null }],
  presence_support_messages: [{ id: uuid('e'), request_id: REQ, site_id: STUDIO, body: 'Any news on the logo?', author: 'Sam Rivera', author_kind: 'client', created_at: at(200), deleted_at: null }],
  presence_contacts: [{ id: CONTACT, site_id: STUDIO, name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', deleted_at: null }],
  presence_deals: [{ id: DEAL, site_id: STUDIO, title: 'Website refresh', contact_id: CONTACT, stage: 'proposal', expected_value_cents: 320000, next_step: 'Send revised logo', next_step_at: null, converted_client_id: null, deleted_at: null, created_at: at(9000), updated_at: at(100) }],
  presence_deal_events: [{ id: uuid('f'), deal_id: DEAL, site_id: STUDIO, kind: 'note', from_stage: '', to_stage: '', detail: { activity_kind: 'call', body: 'Agreed the stacked logo; she will confirm colours by Friday.' }, actor: 'owner@studio.test', created_at: at(4000) }],
});
const call = async (fn, method, path, body, who = owner) => {
  const r = await fn(new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), who.jwt, studio, who, cors);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const goal = (method, body, who) => call(R.handleGoalAi, method, '/sales/goal-ai?today=2026-11-12&tzo=480', body, who);
const draft = (body, who) => call(R.handleAiDraft, 'POST', '/sales/ai/draft', body, who);
const sum = (method, body, who, q = '') => call(R.handleAiSummary, method, '/sales/ai/summary' + q, body, who);
const rowsAi = () => db.tables.presence_sales_ai || [];
const stored = () => { const t = (db.tables.presence_sales_templates || []).find((x) => x.name === '__sales_goal_ai__'); return t ? JSON.parse(t.body) : null; };

db.reset(world());
let r = await goal('GET');
ok('GET: no goal, AI help off, and the owner may switch it', r.status === 200 && r.body.data.goal_cents === null && r.body.data.ai_on === false && r.body.data.can_switch === true && r.body.data.ready === true, JSON.stringify(r.body));
ok('GET: this month\'s use, the limit and the cost each', r.body.data.usage && r.body.data.usage.month_uses === 0 && r.body.data.usage.day_limit === 50 && r.body.data.usage.cents_each === 1);
r = await goal('PUT', { goal_cents: 800000 });
ok('PUT: the goal is kept for the studio, in one reserved row', r.status === 200 && r.body.data.goal_cents === 800000 && stored()?.goal_cents === 800000 && (db.tables.presence_sales_templates || []).filter((x) => x.name === '__sales_goal_ai__').length === 1);
r = await goal('PUT', { goal_cents: 12 });
ok('PUT: a goal that isn\'t one is a 422 in words', r.status === 422 && /at least \$1/.test(r.body.message));
r = await goal('PUT', { ai_on: true }, seat);
ok('PUT: a seat can\'t switch AI help', r.status === 403 && r.body.error === 'owner_only' && stored()?.ai_on !== true);
r = await goal('PUT', { ai_on: true }, designer);
ok('PUT: nor can a studio teammate who isn\'t its owner', r.status === 403 && r.body.error === 'owner_only');
r = await goal('GET', undefined, designer);
ok('GET: …and their Settings says so', r.status === 200 && r.body.data.can_switch === false);

// off: nothing is called, and the answer says who can switch it on
claude.calls.length = 0;
r = await draft({ kind: 'enquiry', id: ENQ });
ok('off: a press is refused, Claude is never asked, and the owner is pointed to Settings', r.status === 409 && r.body.error === 'ai_off' && r.body.can_switch === true && /Switch it on in Settings/.test(r.body.message) && claude.calls.length === 0 && rowsAi().length === 0);
r = await draft({ kind: 'enquiry', id: ENQ }, designer);
ok('off: a teammate is told to ask the owner', r.status === 409 && r.body.can_switch === false && /Ask the studio’s owner/.test(r.body.message));

r = await goal('PUT', { ai_on: true });
ok('PUT: the owner switches it on, and who and when are kept', r.status === 200 && r.body.data.ai_on === true && stored()?.ai_on_by === 'owner@studio.test' && stored()?.goal_cents === 800000);

// before 0201: not ready, nothing called
db.fail.add('presence_sales_ai');
r = await draft({ kind: 'enquiry', id: ENQ });
ok('before 0201 a press says AI help isn\'t ready yet, and calls nothing', r.status === 503 && r.body.error === 'not_ready' && claude.calls.length === 0);
db.fail.delete('presence_sales_ai');
Deno.env.delete('ANTHROPIC_KEY');
r = await draft({ kind: 'enquiry', id: ENQ });
ok('…the same with no key', r.status === 503 && r.body.error === 'not_ready' && claude.calls.length === 0);
Deno.env.set('ANTHROPIC_KEY', 'test-key');

// an enquiry draft
claude.replies.push(text('```\nSubject: Your website\n\nHi Lena,\n\nThanks for writing. Yes, we redo dental sites, and online booking is part of most of them. Would a 15-minute call this week work?\n\nBrightline Studio\n```'));
r = await draft({ kind: 'enquiry', id: ENQ, typed: 'Hi Lena,\n', subject: 'Your enquiry', tzo: 480 });
const c0 = claude.calls[0];
ok('enquiry: the draft comes back clean, for the box', r.status === 200 && r.body.data.text.startsWith('Hi Lena,') && !/Subject:|```/.test(r.body.data.text), JSON.stringify(r.body));
ok('enquiry: the note names what it read', r.body.data.from === 'Lena’s enquiry and your services' && r.body.data.used_today === 1 && r.body.data.day_limit === 50);
ok('enquiry: Claude is asked the way the AI answers check asks', c0 && c0.body.model === 'claude-sonnet-5-5' && c0.body.output_config?.effort === 'low' && c0.body.fallbacks === 'default' && c0.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && c0.headers['x-api-key'] === 'test-key' && !('temperature' in c0.body) && !('tools' in c0.body) && c0.body.max_tokens <= 1200, JSON.stringify(c0?.body).slice(0, 300));
ok('enquiry: it reads their words and the services, fenced off as information', c0.body.messages[0].content.includes('Do you redo dental sites') && c0.body.messages[0].content.includes('Website build ($3,000)') && c0.body.messages[0].content.includes('<facts>') && /information only/.test(c0.body.system));
const row0 = rowsAi()[0];
ok('enquiry: the press is written down with its cost, and the words are not kept', rowsAi().length === 1 && row0.site_id === STUDIO && row0.kind === 'draft' && row0.subject === `enquiry:${ENQ}` && row0.body === null && row0.cost_cents === 0.9 && row0.made_by === 'owner@studio.test', JSON.stringify(row0));
ok('enquiry: and in the tools\' spend log, as the AI answers check is', (db.tables.tool_usage_log || []).some((x) => x.tool === 'sales_ai' && x.kind === 'scan' && x.cost_usd === 0.009));
ok('enquiry: nothing was sent and nothing changed on the enquiry', !db.log.some((c) => c.method !== 'GET' && /presence_form_submissions|presence_email|sales\/email/.test(c.url)));
r = await draft({ kind: 'enquiry', id: ENQ2 });
ok('enquiry: another site\'s enquiry is not here', r.status === 404);

// a support draft, through the request's own read
claude.calls.length = 0;
claude.replies.push(text('Hi Sam,\n\nThe stacked logo is ready for you to look at.\n\nBrightline Studio'));
r = await draft({ kind: 'support', id: REQ });
ok('support: a draft from the request and its messages', r.status === 200 && /stacked logo/.test(r.body.data.text) && claude.calls[0].body.messages[0].content.includes('Please review the stacked one.') && claude.calls[0].body.messages[0].content.includes('Any news on the logo?') && r.body.data.from === 'Sam’s request', JSON.stringify(r.body));

// a record: Where things stand, kept, and Draft it for me on the Email tab
claude.calls.length = 0;
claude.replies.push(text('- Ivy agreed the stacked logo on your call and will confirm colours by Friday.\n- The website refresh is at Proposal sent, worth $3,200.\n- Your next step was to send the revised logo.\nNext: send the revised logo today.'));
r = await sum('POST', { deal: DEAL, today: '2026-11-12' });
const sumAsk = claude.calls[0]?.body.messages[0].content || '';
ok('summary: three lines and a Next', r.status === 200 && r.body.data.summary.lines.length === 3 && r.body.data.summary.next === 'send the revised logo today.' && r.body.data.subject === `deal:${DEAL}`, JSON.stringify(r.body));
ok('summary: it read the record the way the record page does', sumAsk.includes('Ivy Chen') && sumAsk.includes('Agreed the stacked logo') && sumAsk.includes('worth $3,200') && sumAsk.includes('Send revised logo'), sumAsk.slice(0, 600));
const kept = rowsAi().filter((x) => x.kind === 'summary');
ok('summary: kept with its words, on the studio', kept.length === 1 && kept[0].subject === `deal:${DEAL}` && JSON.parse(kept[0].body).lines.length === 3 && r.body.data.kept === true);
r = await sum('GET', undefined, owner, `?subject=deal:${DEAL}`);
ok('summary: a later visit gets it back, with its date, without asking again', r.status === 200 && r.body.data.summary?.lines?.length === 3 && !!r.body.data.summary.at && claude.calls.length === 1);
r = await sum('GET', undefined, designer, `?subject=deal:${DEAL}`);
ok('summary: a teammate sees the same kept summary', r.status === 200 && r.body.data.summary?.next === 'send the revised logo today.');
r = await sum('GET', undefined, { ...owner, member: { site_id: STUDIO, role: 'client_reviewer' } }, `?subject=deal:${DEAL}`);
ok('summary: a client reviewer can\'t read it', r.status === 403);
r = await sum('GET', undefined, owner, '?subject=deal:nope');
ok('summary: a subject that isn\'t one is a 422', r.status === 422);
claude.replies.push(text('Hi Ivy,\n\nThanks for the call on Tuesday. The revised logo comes by Friday.\n\nBrightline Studio'));
r = await draft({ kind: 'record', deal: DEAL, subject: 'Following up', tzo: 480 });
ok('record: Draft it for me reads the call and the deal', r.status === 200 && /revised logo/.test(r.body.data.text) && /this deal$/.test(r.body.data.from) && /^your call/.test(r.body.data.from), JSON.stringify(r.body?.data?.from));
r = await draft({ kind: 'record' });
ok('record: with no record named, a 422 in words', r.status === 422 && /Open a record/.test(r.body.message));

// it couldn't: nothing is lost, and the press still counts
const before = rowsAi().length;
claude.replies.push({ status: 200, body: { id: 'm', type: 'message', role: 'assistant', content: [], stop_reason: 'refusal', usage: { input_tokens: 1000, output_tokens: 0 } } });
r = await draft({ kind: 'enquiry', id: ENQ });
ok('refusal: "Couldn’t write a draft just now. Your message is as you left it."', r.status === 502 && r.body.message === 'Couldn’t write a draft just now. Your message is as you left it.' && rowsAi().length === before + 1);
claude.replies.push({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: not available for this account' } } }, text('Hi Lena,\n\nYes, we do.\n\nBrightline Studio'));
claude.calls.length = 0;
r = await draft({ kind: 'enquiry', id: ENQ });
ok('fallback: an account without the fallback beta is asked again without it', r.status === 200 && claude.calls.length === 2 && claude.calls[1].body.fallbacks === undefined && !claude.calls[1].headers['anthropic-beta']);

// the day's limit and the spend cap: refused before anything is called
db.tables.presence_sales_ai = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, site_id: STUDIO, kind: 'draft', subject: 'x', body: null, cost_cents: 1, made_by: 'x', created_at: at(i + 1) }));
claude.calls.length = 0;
r = await draft({ kind: 'enquiry', id: ENQ });
ok('limit: the 51st press in a day is refused in words, and nothing is called', r.status === 429 && r.body.message === 'That’s 50 AI helps today (about 50¢). It starts again tomorrow.' && claude.calls.length === 0);
db.tables.presence_sales_ai = db.tables.presence_sales_ai.map((x) => ({ ...x, created_at: at(60 * 25) }));
SPENT = 12;
r = await draft({ kind: 'enquiry', id: ENQ });
ok('spend cap: past the tools\' daily cap AI help rests till tomorrow, nothing called', r.status === 503 && r.body.error === 'resting' && claude.calls.length === 0);
SPENT = 0;
r = await goal('GET');
ok('GET: this month\'s use counts every press, with its cost', r.body.data.usage.month_uses === 50 && r.body.data.usage.month_cents === 50 && r.body.data.usage.today_uses === 0, JSON.stringify(r.body.data.usage));

// switched off again: off for everyone
await goal('PUT', { ai_on: false });
r = await sum('POST', { deal: DEAL });
ok('off again: Sum them up is refused too', r.status === 409 && r.body.error === 'ai_off');

// ═══ 3. the goal on Home and Pipeline: /sales/summary carries it ═══
db.reset(world());
db.tables.presence_sales_templates.push({ id: 'g', site_id: STUDIO, kind: 'proposal', name: '__sales_goal_ai__', title: '', body: JSON.stringify({ goal_cents: 800000 }), deleted_at: null, updated_at: '2026-11-02T00:00:00Z' });
db.tables.presence_deals.push({ id: uuid('0'), site_id: STUDIO, title: 'Harbor Dental website', contact_id: null, stage: 'won', expected_value_cents: 195000, converted_client_id: null, converted_at: new Date().toISOString(), deleted_at: null, created_at: at(9000), updated_at: at(10) });
const s = await SALES.handleSalesSummary(new Request('https://fn.test/functions/v1/presence/sales/summary'), studio, owner, cors);
const sd = (await s.json()).data;
ok('summary: the month\'s goal rides on /sales/summary with won and expected', sd.goal && sd.goal.goal_cents === 800000 && sd.goal.won_cents === sd.won_month.value_cents && sd.goal.expected_cents === sd.expected.value_cents && sd.goal.left_cents === Math.max(0, 800000 - sd.won_month.value_cents - sd.expected.value_cents), JSON.stringify(sd.goal));
db.reset(world());
const s2 = (await (await SALES.handleSalesSummary(new Request('https://fn.test/functions/v1/presence/sales/summary'), studio, owner, cors)).json()).data;
ok('summary: no goal, no goal card', s2.goal === null);

// ═══ 4. the wiring ═══
const idx = read('supabase/functions/presence/index.ts');
ok('index: the three routes, lazily', idx.includes("route === '/sales/goal-ai' && (method === 'GET' || method === 'PUT')") && idx.includes("route === '/sales/ai/draft' && method === 'POST'") && idx.includes("route === '/sales/ai/summary' && (method === 'GET' || method === 'POST')"));
const roles = read('supabase/functions/presence/lib/site_roles.ts');
ok('roles: the goal is a setting; a press is an edit', /'PUT \/sales\/goal-ai'/.test(roles.split("['configure', [")[1].split(']],')[0]) && /'POST \/sales\/ai\/\(draft\|summary\)'/.test(roles));
const mig = read('supabase/migrations/0201_sales_ai.sql'), pack = read('docs/presence/APPLY-0201-prod.sql');
ok('0201: one new table, the function\'s alone, safe to run twice', [mig, pack].every((x) => x.includes('create table if not exists public.presence_sales_ai') && x.includes('enable row level security') && x.includes('revoke all on public.presence_sales_ai from anon, authenticated') && x.includes("check (kind in ('draft', 'summary'))")) && /Verify/.test(pack));
ok('0201 is the only migration with that number', [...Deno.readDirSync(new URL('../../supabase/migrations/', import.meta.url))].filter((e) => e.name.startsWith('0201_')).length === 1);
const settings = read('settings.html'), crm = read('crm.html'), inbox = read('inbox.html'), agency = read('agency.html'), pipeline = read('pipeline.html'), kit = read('sales-ai.js'), shell = read('shell.js');
ok('Settings: Goal and AI help, for those who may change settings, with what it costs', settings.includes('id="goal" aria-labelledby="goalHead" hidden data-needs="configure"') && settings.includes('About 1¢ each press.') && settings.includes('Stops at 50 a day') && settings.includes('Never sends anything.') && settings.includes("key: 'goal', href: '#goal'"));
ok('record: Where things stand tops the rail; Draft it for me is in the Email box', crm.includes('<div id="aicard"></div>') && crm.includes("label:'Draft it for me'") && crm.includes('tools:emAiTools') && crm.includes('<script src="/sales-ai.js" defer></script>'));
ok('the Email box offers a row for a page\'s own tools', shell.includes('if (o.tools) o.tools(toolsRow(), { body: body, subj: subj, form: form, go: go });'));
ok('the kit never sends: it fills the box, and Undo puts the words back', kit.includes("o.req('/sales/ai/draft', 'POST'") && !/\/sales\/email|messages'|requestSubmit|\.submit\(\)/.test(kit) && kit.includes('data-ai="undo">Undo draft'));
ok('Home and Pipeline show the goal from the summary they already read', agency.includes('goalCardHtml(summary)') && pipeline.includes('goalStripHtml(s.goal)') && agency.includes('href="/settings.html#goal"') && pipeline.includes('href="/settings.html#goal"'));
ok('the Inbox drafts go through AI help', !inbox.includes('/writer/rewrite') && inbox.includes("aiDraftInto('leadBody','leadDraft'"));

console.log(`\n════ SALES ITEM 94 (AI help + goal): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
