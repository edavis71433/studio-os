// ── /crm/activity pure-module suite (slice 1 — the record page's ONE timeline) ─
// Proves the pure merge/shape logic behind GET /crm/activity: every conversation
// channel normalizes to { kind, type, title, body, at, meta, href } with the type
// (message|email|call|task|note|system) that drives the icon/color; deal system
// events never double the manual activities the conversation already carries;
// the merge is newest-first + capped; the Upcoming & Overdue band derives open
// to-dos + next step + unpaid invoices with honest overdue flags.
//
//   deno run --allow-read --allow-env tests/presence/crm_activity_test.mjs
import {
  mapConversationItem, mapSiteEvent, mapDealEvent, mapDoneTask, mergeActivity, buildUpcoming,
} from '../../supabase/functions/presence/crm/activity.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-16T12:00:00.000Z';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';

// ═══ 1. conversation channels → typed items (the /crm/messages shapes) ═══
{
  const msg = mapConversationItem({ id: 'm1', kind: 'message', from: 'studio', body: 'Hi there', created_at: NOW });
  ok('project message → type message, actor line, expandable body', msg.type === 'message' && msg.title === 'You sent a message' && msg.body === 'Hi there' && msg.at === NOW);
  const theirs = mapConversationItem({ id: 'm2', kind: 'message', from: 'client', body: 'Hello', created_at: NOW });
  ok('client message reads as the client', theirs.title === 'The client sent a message');

  const sup = mapConversationItem({ id: 's1', kind: 'support', support_id: 's1', from: 'client', subject: 'Logo tweak', status: 'in_progress', body: 'Can we…', created_at: NOW });
  ok('support → status chip in meta + deep link', sup.type === 'message' && sup.meta === 'Support · in progress' && sup.title.includes('Logo tweak') && sup.href === '/projects.html?support=s1');
  const rep = mapConversationItem({ id: 'r1', kind: 'support_reply', support_id: 's1', from: 'studio', body: 'Done!', created_at: NOW });
  ok('support reply → "You replied" under the Support tag', rep.title === 'You replied' && rep.meta === 'Support');

  const enq = mapConversationItem({ id: 'e1', kind: 'enquiry', from: 'client', subject: 'Website enquiry', body: 'Quote me', created_at: NOW });
  ok('enquiry → message type, Website enquiry tag', enq.type === 'message' && enq.meta === 'Website enquiry');
  const book = mapConversationItem({ id: 'b1', kind: 'booking', from: 'client', subject: 'Booked: intro call · 2026-07-20 10:00', created_at: NOW });
  ok('booking → call type, Booking tag', book.type === 'call' && book.meta === 'Booking' && book.title.includes('intro call'));
  const bc = mapConversationItem({ id: 'bc1', kind: 'broadcast', from: 'studio', subject: 'July news', created_at: NOW });
  ok('broadcast → email type', bc.type === 'email' && bc.title.includes('July news'));
}

// ═══ 2. logged activities — each kind lands on its icon/color type ═══
{
  const call = mapConversationItem({ id: 'a1', kind: 'activity', activity_kind: 'call', from: 'studio', body: 'They said yes', created_at: NOW });
  const email = mapConversationItem({ id: 'a2', kind: 'activity', activity_kind: 'email', from: 'studio', body: '', created_at: NOW });
  const meeting = mapConversationItem({ id: 'a3', kind: 'activity', activity_kind: 'meeting', from: 'studio', body: '', created_at: NOW });
  const note = mapConversationItem({ id: 'a4', kind: 'activity', activity_kind: 'note', from: 'studio', body: 'Prefers Tuesdays', created_at: NOW });
  ok('logged call → call', call.type === 'call' && call.title === 'You logged a call');
  ok('logged email → email', email.type === 'email' && email.title === 'You logged an email');
  ok('logged meeting → call type, Meeting tag', meeting.type === 'call' && meeting.meta === 'Meeting');
  ok('logged note → note', note.type === 'note' && note.body === 'Prefers Tuesdays');
  ok('empty body stays null (no empty expander)', email.body === null);
  // sent-document stamps are the deal ledger's job — never doubled
  ok('proposal_sent stamp → null (deal events cover it)', mapConversationItem({ id: 'a5', kind: 'activity', activity_kind: 'proposal_sent', from: 'studio', created_at: NOW }) === null);
  ok('unknown kind → null, undated → null', mapConversationItem({ id: 'x', kind: 'mystery', created_at: NOW }) === null && mapConversationItem({ id: 'm', kind: 'message', from: 'studio' }) === null);
}

// ═══ 3. deal system events → system items, no doubled manual activities ═══
{
  const move = mapDealEvent({ id: 'ev1', kind: 'stage_change', to_stage: 'proposal', created_at: NOW }, DEAL);
  ok('stage change → system item with the human label', move.type === 'system' && move.title === 'Moved to Proposal sent' && move.meta === 'Deal');
  ok('deal event deep-links to the pipeline', move.href === `/pipeline.html?deal=${DEAL}`);
  const paid = mapDealEvent({ id: 'ev2', kind: 'invoice_paid', detail: { amount_cents: 150000, purpose: 'deposit' }, created_at: NOW }, DEAL);
  ok('invoice_paid carries the amount', paid.title.includes('Deposit paid') && paid.title.includes('$1,500'));
  // a manual activity rides presence_deal_events as kind='note' — the conversation channel owns it
  const manual = mapDealEvent({ id: 'ev3', kind: 'note', detail: { activity_kind: 'call', body: 'x', occurred_at: NOW }, created_at: NOW }, DEAL);
  ok('manual activity row → null (conversation channel owns it)', manual === null);
  ok('bare note event → null too', mapDealEvent({ id: 'ev4', kind: 'note', detail: {}, created_at: NOW }, DEAL) === null);
}

// ═══ 4. site-ops events + notes (the /crm/timeline shapes) ═══
{
  const pub = mapSiteEvent({ id: 'pub:1', at: NOW, kind: 'publish', audience: 'shared', title: 'Published the site' });
  ok('publish → system with Website tag', pub.type === 'system' && pub.title === 'Published the site' && pub.meta === 'Website');
  const n = mapSiteEvent({ id: 'note:2', at: NOW, kind: 'note', audience: 'internal', title: 'Note', detail: 'Call them Monday' });
  ok('relationship note → note type, audience-labeled', n.type === 'note' && n.meta === 'Internal note' && n.body === 'Call them Monday');
  const shared = mapSiteEvent({ id: 'note:3', at: NOW, kind: 'note', audience: 'shared', title: 'Note', detail: 'x' });
  ok('shared note labeled Shared', shared.meta === 'Shared note');
  ok('undated site event → null', mapSiteEvent({ id: 'x', at: '', kind: 'publish', audience: 'shared', title: 't' }) === null);
}

// ═══ 5. completed to-dos → task history ═══
{
  const done = mapDoneTask({ id: 't1', title: 'Send sitemap', status: 'done', completed_at: NOW, created_at: '2026-07-01T00:00:00Z' }, DEAL);
  ok('done to-do → task item at its completion time', done.type === 'task' && done.title === 'To-do completed — Send sitemap' && done.at === NOW);
  ok('open to-do is NOT history', mapDoneTask({ id: 't2', title: 'x', status: 'open' }, DEAL) === null);
}

// ═══ 6. merge — newest first, capped, null-safe ═══
{
  const a = mapConversationItem({ id: '1', kind: 'message', from: 'studio', body: 'old', created_at: '2026-01-01T00:00:00Z' });
  const b = mapConversationItem({ id: '2', kind: 'message', from: 'studio', body: 'new', created_at: '2026-06-01T00:00:00Z' });
  const merged = mergeActivity([[a, null], [b]]);
  ok('merge sorts newest first + drops nulls', merged.length === 2 && merged[0].body === 'new' && merged[1].body === 'old');
  const many = Array.from({ length: 500 }, (_, i) => mapConversationItem({ id: String(i), kind: 'message', from: 'studio', body: 'x', created_at: NOW }));
  ok('merge caps length', mergeActivity([many]).length === 400);
}

// ═══ 7. Upcoming & Overdue — to-dos, next step, unpaid invoices ═══
{
  const up = buildUpcoming({
    tasks: [
      { id: 't1', title: 'Chase signature', due_date: '2026-07-10', status: 'open' },   // overdue
      { id: 't2', title: 'Kickoff prep', due_date: '2026-07-20', status: 'open' },      // upcoming
      { id: 't3', title: 'Old thing', due_date: '2026-07-01', status: 'done' },         // done → excluded
      { id: 't4', title: 'Someday', due_date: null, status: 'open' },                   // undated → last
    ],
    deal: { id: DEAL, next_step: 'Send the agreement', next_step_at: '2026-07-18' },
    invoices: [
      { id: 'i1', title: 'Deposit', amount_cents: 250000, due_date: '2026-07-14', status: 'open' },  // overdue
      { id: 'i2', title: 'Paid one', amount_cents: 100, due_date: '2026-07-01', status: 'paid' },    // paid → excluded
    ],
  }, NOW);
  ok('upcoming: open items only (done/paid excluded)', up.length === 5 && !up.some((u) => u.title.includes('Old thing') || u.title.includes('Paid one')));
  const t1 = up.find((u) => u.title === 'Chase signature');
  ok('past-due to-do flagged overdue + checkbox id', t1.overdue === true && t1.kind === 'task' && t1.id === 't1');
  ok('future to-do not overdue', up.find((u) => u.title === 'Kickoff prep').overdue === false);
  ok('next step rides along with its date', up.some((u) => u.kind === 'next_step' && u.title.includes('Send the agreement') && u.due === '2026-07-18'));
  const inv = up.find((u) => u.kind === 'invoice');
  ok('unpaid invoice → overdue + amount + pipeline link', inv.overdue === true && inv.title.includes('$2,500') && inv.href === `/pipeline.html?deal=${DEAL}`);
  ok('sorted soonest-first, undated last', up[0].due === '2026-07-10' && up[up.length - 1].due === null);
  ok('empty inputs → empty band', buildUpcoming({}, NOW).length === 0);
}

// ═══ 8. hardening — the overdue boundary, tie stability, hostile strings ═══
{
  // due EXACTLY today is not overdue — overdue means strictly past-due
  const today = buildUpcoming({ tasks: [{ id: 'tb', title: 'Due today', due_date: '2026-07-16', status: 'open' }] }, NOW);
  ok('due exactly today is NOT overdue (strict boundary)', today.length === 1 && today[0].overdue === false);
  ok('due yesterday IS overdue', buildUpcoming({ tasks: [{ id: 'ty', title: 'x', due_date: '2026-07-15', status: 'open' }] }, NOW)[0].overdue === true);

  // equal timestamps keep group insertion order (stable sort — no jitter across refreshes)
  const a = mapConversationItem({ id: 'A', kind: 'message', from: 'studio', body: 'first', created_at: NOW });
  const b = mapConversationItem({ id: 'B', kind: 'message', from: 'client', body: 'second', created_at: NOW });
  const c = mapDoneTask({ id: 'C', title: 'x', status: 'done', completed_at: NOW }, DEAL);
  const tie = mergeActivity([[a, b], [c]]);
  ok('equal-timestamp merge keeps insertion order (stable)', tie.map((i) => i.id).join('|') === 'conv:message:A|conv:message:B|task:C');

  // hostile strings ride through the normalizers VERBATIM — the module never
  // renders HTML or builds queries; esc() at render time owns the escaping
  const evil = '<script>alert(1)</script>';
  const pg = 'a),(b*"\\%or=1.eq.1';   // PostgREST filter grammar chars
  const sup = mapConversationItem({ id: 's', kind: 'support', support_id: 's', from: 'client', subject: evil, status: 'open', body: pg, created_at: NOW });
  ok('script-tag subject passes through unmangled', sup.title.includes(evil) && sup.body === pg && sup.type === 'message');
  const nt = mapSiteEvent({ id: 'note:9', at: NOW, kind: 'note', audience: 'shared', title: evil, detail: pg });
  ok('hostile note title/detail unmangled', nt.title === evil && nt.body === pg);
  const tk = mapDoneTask({ id: 'th', title: pg, status: 'done', completed_at: NOW }, DEAL);
  ok('filter-grammar chars in a task title survive', tk.title === `To-do completed — ${pg}`);
  const bc = mapConversationItem({ id: 'bh', kind: 'broadcast', from: 'studio', subject: evil, created_at: NOW });
  ok('hostile broadcast subject unmangled', bc.title === `You sent a broadcast — ${evil}`);
  const uh = buildUpcoming({ tasks: [{ id: 'uh', title: evil, due_date: null, status: 'open' }] }, NOW);
  ok('hostile to-do title survives the upcoming band', uh[0].title === evil);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
