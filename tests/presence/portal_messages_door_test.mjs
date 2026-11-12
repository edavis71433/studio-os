// ── One Messages door in the client portal (builder list item 179, part three) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_messages_door_test.mjs
// The server half: every conversation in the list says something real. A request
// nobody has answered yet reads as its own first words, said as "you", and the
// opening text itself never travels with the list.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const AGENCY = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R1 = 'r1r1r1r1-0000-4000-8000-000000000001'.replace(/r/g, 'a');
const R2 = 'r2r2r2r2-0000-4000-8000-000000000002'.replace(/r/g, 'b');
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
const CD = await import('../../supabase/functions/presence/routes/client_delivery.ts');

const SITE = { id: 'f0f0f0f0-0000-4000-8000-000000000000', client_id: CUSTOMER };
const PRINCIPAL = { kind: 'client', userId: 'u-1', email: 'client@example.com' };
const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function installFetch(db) {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('presence_service_links')) return jr([{ project_id: null, agency_site_id: AGENCY, customer_client_id: CUSTOMER }]);
    if (url.includes('presence_support_requests')) return jr(db.requests);
    if (url.includes('presence_support_messages')) return db.messagesFail ? jr({ message: 'boom' }, 500) : jr(db.messages);
    return jr([]);
  };
}
const list = async () => (await (await CD.handleClientSupport(new Request('https://x/client/support'), SITE, PRINCIPAL, {})).json()).data;

const requests = () => [
  { id: R1, subject: 'Extra page: Weddings', status: 'open', project_id: null, created_at: '2026-11-09T10:00:00Z', updated_at: '2026-11-09T10:00:00Z', requester: 'u-1', body: 'We’d like a page\nfor wedding flowers.' },
  { id: R2, subject: 'Billing question', status: 'resolved', project_id: null, created_at: '2026-10-12T10:00:00Z', updated_at: '2026-10-13T10:00:00Z', resolved_at: '2026-10-13T10:00:00Z', requester: 'u-1', body: 'Is the invoice right?' },
];
{
  installFetch({ requests: requests(), messages: [{ request_id: R2, author: 'studio-1', body: 'Yes, all sorted.', created_at: '2026-10-12T12:00:00Z' }] });
  const rows = await list();
  const r1 = rows.find((r) => r.id === R1), r2 = rows.find((r) => r.id === R2);
  ok('door: a request with no replies yet reads as its own first words, said as you', r1.last_message && r1.last_message.from === 'you' && r1.last_message.text === 'We’d like a page for wedding flowers.');
  ok('door: a request with replies still reads as the newest line someone wrote', r2.last_message && r2.last_message.from === 'studio' && r2.last_message.text === 'Yes, all sorted.');
  ok('door: the opening text itself never travels with the list, nor the client’s own key', rows.every((r) => !('body' in r) && !('requester' in r)));
}
{
  installFetch({ requests: requests(), messagesFail: true });
  const rows = await list();
  ok('door: when the replies can’t be read, each request still says its first words', rows.every((r) => r.last_message && r.last_message.from === 'you') && rows.every((r) => !('body' in r)));
}
{
  installFetch({ requests: [{ ...requests()[0], body: '   ' }], messages: [] });
  const rows = await list();
  ok('door: a request with no words of its own carries no line (the page says why it’s there)', rows[0].last_message === undefined);
}

globalThis.fetch = realFetch;
const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
