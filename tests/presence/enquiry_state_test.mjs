// ── Bug hunt C5 + C15 (Nov 10 2026): where a website enquiry stands ──────────
//   deno run --allow-read --allow-env --allow-net tests/presence/enquiry_state_test.mjs
// An enquiry made a deal, or a customer, is marked `converted`. The Inbox used to read
// "✓ In pipeline — view deal" from that status alone: after the deal was deleted, or
// for a customer made with no deal, the link opened nothing and "Make it a deal" was
// gone. Pinned here, through a PostgREST fetch fake:
//   · GET /forms/inbox says In pipeline only with a live deal (converted + deal_id),
//     Customer when the person became one, and otherwise nothing more than seen;
//   · deleting a deal puts its enquiry back in the queue (Read, or Replied when the
//     studio had answered it) — never a customer's, never one another deal still carries;
//   · C15: the queue answers the newest 100 and says when there were more (`more`).
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { enquiryState, reopenedStatus, reopenEnquiry, customerEmails } = await import('../../supabase/functions/presence/lib/enquiry_state.ts');
const { handleFormInbox, FORM_INBOX_PAGE } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { handleSalesDeal } = await import('../../supabase/functions/presence/routes/sales.ts');

const SITE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_id: null };
const E1 = '11111111-1111-4111-8111-111111111111', E2 = '22222222-2222-4222-8222-222222222222', E3 = '33333333-3333-4333-8333-333333333333', E4 = '44444444-4444-4444-8444-444444444444';
const D1 = 'dddddddd-1111-4111-8111-111111111111', D9 = 'dddddddd-9999-4999-8999-999999999999';
const jr = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// ── the fake: tables in memory, PostgREST's filters as far as these routes use them ──
let T, calls, fail;
const reset = (t = {}) => { T = { presence_form_submissions: [], presence_deals: [], presence_contacts: [], ...t }; calls = []; fail = {}; };
const unq = (v) => decodeURIComponent(v).replace(/^"|"$/g, '').replace(/\\"/g, '"');
function matches(row, k, v) {
  if (v.startsWith('eq.')) return String(row[k] ?? '') === v.slice(3);
  if (v === 'is.null') return row[k] == null;
  if (v === 'not.is.null') return row[k] != null;
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(unq).includes(String(row[k] ?? ''));
  return true;
}
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input instanceof Request ? input.url : input));
  const method = (init.method || 'GET').toUpperCase();
  const table = u.pathname.split('/').pop();
  calls.push({ table, method, query: decodeURIComponent(u.search), body: init.body ? JSON.parse(init.body) : null });
  if (fail[table]) return jr({ message: 'boom' }, 500);
  const where = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
  const hit = (T[table] || []).filter((r) => where.every(([k, v]) => matches(r, k, v)));
  if (method === 'GET') { const lim = Number(u.searchParams.get('limit')) || hit.length; return jr(hit.slice(0, lim)); }
  if (method === 'PATCH') { const b = JSON.parse(init.body); hit.forEach((r) => Object.assign(r, b)); return jr(hit); }
  return jr([], 201);
};
const inbox = async () => { const res = await handleFormInbox(SITE, {}); return (await res.json()).data; };
const sub = (id, over = {}) => ({ id, site_id: SITE.id, spam: false, form_kind: 'quote', name: 'Sam', email: 'Sam@Example.com', phone: '', message: 'Hi', source_page: '/', status: 'new', created_at: '2026-10-01T00:00:00Z', fields: {}, ...over });

// ── pure ──
ok('enquiryState: a live deal → in pipeline', JSON.stringify(enquiryState('converted', D1, false)) === '{"converted":true,"customer":false}');
ok('enquiryState: converted, no deal, a customer → Customer', JSON.stringify(enquiryState('converted', null, true)) === '{"converted":false,"customer":true}');
ok('enquiryState: converted, no deal, not a customer → neither (its deal was deleted)', JSON.stringify(enquiryState('converted', null, false)) === '{"converted":false,"customer":false}');
ok('enquiryState: a customer flag means nothing unless it was converted', enquiryState('read', null, true).customer === false);
ok('reopenedStatus: answered from the Inbox → Replied', reopenedStatus({ __studio_replies: [{ body: 'Thanks!', at: 'x' }] }) === 'replied');
ok('reopenedStatus: never answered → Read', reopenedStatus({}) === 'read' && reopenedStatus(null) === 'read' && reopenedStatus({ __studio_replies: [] }) === 'read');

// ── GET /forms/inbox ──
{
  reset({
    presence_form_submissions: [
      sub(E1, { status: 'converted' }),                                   // a live deal
      sub(E2, { status: 'converted', email: 'Kim@Example.com' }),         // made a customer, no deal
      sub(E3, { status: 'converted', email: 'lee@example.com' }),         // its deal was deleted
      sub(E4, { status: 'replied', email: 'new@example.com' }),
    ],
    presence_deals: [
      { id: D1, site_id: SITE.id, source_submission_id: E1, deleted_at: null },
      { id: D9, site_id: SITE.id, source_submission_id: E3, deleted_at: '2026-10-05T00:00:00Z' },
    ],
    presence_contacts: [
      { id: 'c1', site_id: SITE.id, email: 'kim@example.com', client_id: 'cl-1', deleted_at: null },   // the customer route keeps it lowercased
      { id: 'c2', site_id: SITE.id, email: 'lee@example.com', client_id: null, deleted_at: null },    // a contact, not a customer
    ],
  });
  const d = await inbox();
  const s = Object.fromEntries((d.submissions || []).map((x) => [x.id, x]));
  ok('C5: a live deal → converted with its deal id', s[E1].converted === true && s[E1].deal_id === D1 && s[E1].customer === false);
  ok('C5: made a customer with no deal → Customer, not In pipeline', s[E2].converted === false && s[E2].deal_id === null && s[E2].customer === true);
  ok('C5: the customer is found whatever case the visitor typed', s[E2].customer === true);
  ok('C5: its deal was deleted → neither In pipeline nor Customer', s[E3].converted === false && s[E3].customer === false && s[E3].deal_id === null);
  ok('C5: an ordinary enquiry is untouched', s[E4].converted === false && s[E4].customer === false && s[E4].status === 'replied');
  ok('C5: the customer lookup asks only about the converted ones without a deal', calls.filter((c) => c.table === 'presence_contacts').length === 1 && /kim@example\.com/i.test(calls.find((c) => c.table === 'presence_contacts').query) && !/new@example/.test(calls.find((c) => c.table === 'presence_contacts').query));
  ok('C15: under the page → no word of more', d.more === false);
  fail.presence_contacts = true;
  const d2 = await inbox();
  const s2 = Object.fromEntries((d2.submissions || []).map((x) => [x.id, x]));
  ok('C5: the customer read failed → seen, never a customer it might not be', s2[E2].customer === false && s2[E2].converted === false);
}
{
  reset({ presence_form_submissions: Array.from({ length: FORM_INBOX_PAGE + 1 }, (_, i) => sub(`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)) });
  const d = await inbox();
  ok('C15: 101 enquiries → the newest 100', FORM_INBOX_PAGE === 100 && d.submissions.length === 100);
  ok('C15: …and the queue says there are more', d.more === true);
  ok('C15: it asked for one past the page', /limit=101/.test(calls.find((c) => c.table === 'presence_form_submissions').query));
}

// ── reopenEnquiry: what happens to the enquiry when its deal goes ──
{
  reset({ presence_form_submissions: [sub(E3, { status: 'converted', email: 'lee@example.com' })] });
  ok('reopen: no other deal, not a customer → back to Read', (await reopenEnquiry(SITE.id, E3)) === true && T.presence_form_submissions[0].status === 'read');
  const patch = calls.find((c) => c.method === 'PATCH');
  ok('reopen: the write is this site\'s, and only while it is still converted', patch && /site_id=eq\.aaaaaaaa/.test(patch.query) && /status=eq\.converted/.test(patch.query));
}
{
  reset({ presence_form_submissions: [sub(E3, { status: 'converted', fields: { __studio_replies: [{ body: 'Happy to help', at: '2026-10-02T00:00:00Z' }] } })] });
  await reopenEnquiry(SITE.id, E3);
  ok('reopen: answered from the Inbox → back to Replied', T.presence_form_submissions[0].status === 'replied');
}
{
  reset({ presence_form_submissions: [sub(E2, { status: 'converted', email: 'Kim@Example.com' })], presence_contacts: [{ id: 'c1', site_id: SITE.id, email: 'kim@example.com', client_id: 'cl-1', deleted_at: null }] });
  ok('reopen: they became a customer → it stays theirs', (await reopenEnquiry(SITE.id, E2)) === false && T.presence_form_submissions[0].status === 'converted');
}
{
  reset({ presence_form_submissions: [sub(E1, { status: 'converted' })], presence_deals: [{ id: D1, site_id: SITE.id, source_submission_id: E1, deleted_at: null }] });
  ok('reopen: another live deal still carries it → left alone', (await reopenEnquiry(SITE.id, E1)) === false && T.presence_form_submissions[0].status === 'converted');
}
{
  reset({ presence_form_submissions: [sub(E4, { status: 'not_a_fit' })] });
  ok('reopen: only a converted enquiry is touched', (await reopenEnquiry(SITE.id, E4)) === false && T.presence_form_submissions[0].status === 'not_a_fit');
  reset({ presence_form_submissions: [sub(E3, { status: 'converted' })] });
  fail.presence_contacts = true;
  ok('reopen: unsure whether they are a customer (the read failed) → left alone', (await reopenEnquiry(SITE.id, E3)) === false && T.presence_form_submissions[0].status === 'converted');
  ok('reopen: not an id → nothing read, nothing written', (await reopenEnquiry(SITE.id, 'nope')) === false);
  ok('customerEmails: null on a failed read', (await customerEmails(SITE.id, ['a@b.co'])) === null);
}

// ── DELETE /sales/deals/:id reopens the enquiry it came from ──
{
  reset({
    presence_form_submissions: [sub(E3, { status: 'converted', email: 'lee@example.com' })],
    presence_deals: [{ id: D9, site_id: SITE.id, title: 'Lee — quote', stage: 'lead', source_submission_id: E3, converted_at: null, deleted_at: null }],
  });
  const res = await handleSalesDeal(new Request(`https://fn.example/presence/sales/deals/${D9}`, { method: 'DELETE' }), SITE, { kind: 'operator' }, D9, {});
  ok('delete: the deal is deleted', res.status === 200 && !!T.presence_deals[0].deleted_at);
  ok('delete: …and its enquiry is back in the queue as seen', T.presence_form_submissions[0].status === 'read');
}

// ── the Inbox (inbox.html): the deal link only with a deal to open ──
{
  const html = Deno.readTextFileSync(new URL('../../inbox.html', import.meta.url));
  ok('page: In pipeline needs a deal id', /const inPipeline=\(l\)=>!!\(l&&l\.converted&&l\.deal_id\);/.test(html));
  ok('page: the deal link is drawn only in pipeline', /inPipe\?`<a class="btnlink" href="\/crm\.html\?deal=\$\{esc\(l\.deal_id\)\}&tab=deal"/.test(html));
  ok('page: a customer says Customer', /if\(l\.customer\)return 'Customer';/.test(html));
  ok('page: Make customer with no deal marks a customer, not In pipeline', /if\(dealId\)\{l\.converted=true;l\.deal_id=dealId;\}else l\.customer=true;/.test(html));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ ENQUIRY STATE (bug hunt C5, C15): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
