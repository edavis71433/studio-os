// ── Bug hunt C (Nov 10 2026): what the feed tells the Inbox, honestly ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/inbox_feed_honesty_test.mjs
// GET /portal/feed driven through a PostgREST fetch fake (the support_routing_test idiom):
//   · C2  an enquiry's message comes cut at FEED_MESSAGE_CHARS, and says so (message_cut);
//         the Inbox keeps the queue's whole message and shows "…" only when it has no other
//   · C10 an open support request the studio answered last is not "waiting for a reply"
//         (needs_reply), while one the client wrote to last, or nobody has answered, is
//   · C15 the newest FEED_ENQUIRIES new enquiries and FEED_CONVERSATIONS conversations
//         come with a word when there were more (enquiries_more, client_messages_more);
//         the bell's "N new enquiries came in" counts no further than before
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const W = await import('../../supabase/functions/presence/routes/workspace.ts');
const { handlePortalFeed, FEED_ENQUIRIES, FEED_CONVERSATIONS, FEED_MESSAGE_CHARS } = W;
const SITE = { id: '99999999-9999-4999-8999-999999999999', client_id: null };
const OPERATOR = { kind: 'operator', userId: 'op-1', email: 'ops@example.com' };
const jr = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

let world = {};
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET') return jr([], 201);
  if (url.includes('presence_form_submissions')) return jr(world.enquiries || []);
  if (url.includes('presence_support_requests')) return jr(world.support || []);
  if (url.includes('presence_support_messages')) return world.messagesFail ? jr({ message: 'boom' }, 500) : jr(world.messages || []);
  return jr([]);
};
const feed = async (w) => {
  world = w;
  const res = await handlePortalFeed('', SITE, OPERATOR, {});
  return (await res.json()).data;
};
const iso = (n) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();   // minute n of Oct 1
const enquiry = (n, msg = 'Hello') => ({ id: `e-${n}`, form_kind: 'contact', name: `Person ${n}`, email: `p${n}@example.com`, phone: '', message: msg, status: 'new', created_at: iso(1000 - n) });
const request = (n) => ({ id: `s-${n}`, subject: `Request ${n}`, status: 'open', priority: 'normal', assigned_to: null, project_id: null, requester: `r${n}@example.com`, client_id: null, created_at: iso(n), updated_at: iso(n) });

ok('the limits are the ones the Inbox was built on', FEED_ENQUIRIES === 50 && FEED_CONVERSATIONS === 20 && FEED_MESSAGE_CHARS === 400);

// ── C2: a long enquiry is cut, and says so ──
{
  const long = 'Hi, we need a new site for the shop. '.repeat(30) + 'Call me on 555 0100 before Friday.';
  const d = await feed({ enquiries: [enquiry(1, long), enquiry(2, 'Short one')] });
  const e1 = (d.enquiries || []).find((e) => e.id === 'e-1'), e2 = (d.enquiries || []).find((e) => e.id === 'e-2');
  ok('C2: the long message comes cut at 400 characters', !!e1 && e1.message.length === 400 && long.startsWith(e1.message));
  ok('C2: …and says it was cut', e1 && e1.message_cut === true);
  ok('C2: a short message is whole and not marked', e2 && e2.message === 'Short one' && e2.message_cut === false);
}

// ── C15: the new enquiries say when there were more ──
{
  const d51 = await feed({ enquiries: Array.from({ length: 51 }, (_, i) => enquiry(i + 1)) });
  ok('C15: 51 new enquiries → the newest 50 are sent', (d51.enquiries || []).length === 50 && d51.enquiries[0].id === 'e-1' && !d51.enquiries.some((e) => e.id === 'e-51'));
  ok('C15: …with enquiries_more', d51.enquiries_more === true);
  const bell = (d51.notices || []).find((n) => n.kind === 'website_enquiry');
  ok('C15: the bell still says 50 new enquiries, no more than before', !!bell && /^50 new enquiries/.test(bell.headline), bell && bell.headline);
  const d50 = await feed({ enquiries: Array.from({ length: 50 }, (_, i) => enquiry(i + 1)) });
  ok('C15: exactly 50 → all of them, and no word of more', (d50.enquiries || []).length === 50 && d50.enquiries_more === false);
}

// ── C15: the conversations say when there were more ──
{
  const d = await feed({ support: Array.from({ length: 22 }, (_, i) => request(i + 1)), messages: [] });
  ok('C15: 22 open requests → the newest 20 conversations', (d.client_messages || []).length === 20);
  ok('C15: …with client_messages_more', d.client_messages_more === true);
  const few = await feed({ support: [request(1), request(2)], messages: [] });
  ok('C15: 2 → both, and no word of more', (few.client_messages || []).length === 2 && few.client_messages_more === false);
}

// ── C10: whose word was last decides "waiting for a reply" ──
{
  const msgs = [
    { request_id: 's-1', author_kind: 'client', created_at: iso(100) },
    { request_id: 's-1', author_kind: 'studio', created_at: iso(200) },   // the studio answered last
    { request_id: 's-2', author_kind: 'studio', created_at: iso(150) },
    { request_id: 's-2', author_kind: 'client', created_at: iso(300) },   // the client wrote again
  ];
  const d = await feed({ support: [request(1), request(2), request(3)], messages: msgs });
  const row = (id) => (d.client_messages || []).find((r) => r.type === 'support' && r.id === id);
  ok('C10: answered last by the studio → not waiting for a reply', row('s-1') && row('s-1').needs_reply === false);
  ok('C10: …though still open, so still on Home and the bell', row('s-1') && row('s-1').tier === 'needs_you');
  ok('C10: the client wrote last → waiting for a reply', row('s-2') && row('s-2').needs_reply === true);
  ok('C10: nobody has answered yet → waiting for a reply', row('s-3') && row('s-3').needs_reply === true);
  const failed = await feed({ support: [request(1)], messagesFail: true });
  const f1 = (failed.client_messages || []).find((r) => r.id === 's-1');
  ok('C10: the messages read failed → waiting for a reply, as before', f1 && f1.needs_reply === true);
}

// ── the Inbox's side of it (inbox.html) ──
{
  const inbox = Deno.readTextFileSync(new URL('../../inbox.html', import.meta.url));
  ok('C2: joining the feed and the queue keeps the queue\'s whole message', /const whole=String\(q\.message\|\|''\);Object\.assign\(q,l\);if\(whole\.length>=String\(l\.message\|\|''\)\.length\)\{q\.message=whole;q\.message_cut=false;\}/.test(inbox));
  ok('C10: a support row is waiting for a reply by the feed\'s needs_reply', /needs:c\.needs_reply!=null\?!!c\.needs_reply:true/.test(inbox));
  ok('C15: the list says when the server cut it', /Showing your newest \$\{cut\.join\(' and '\)\} only/.test(inbox) && /Showing your newest \$\{CUT\.queue\} only/.test(inbox));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ INBOX FEED HONESTY (bug hunt C2, C10, C15): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
