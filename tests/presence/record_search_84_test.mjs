// ── Sales item 84: ⌘K finds a phone number, a note, an enquiry, a proposal, a
//    to-do, a website, a domain and a message (Nov 2026) ───────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/record_search_84_test.mjs
// Drives the real /crm/search handler on the in-memory PostgREST (fake_pgrst.mjs):
// every place it reads, the group each result lands in, a phone number matched by
// its digits whatever its format, the studio's own rows only, a failed read said
// (partial / 502), and every link it can return opening what it says (item 76).
import { installFakePostgrest } from './fake_pgrst.mjs';
const S = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const AG = '44444444-4444-4444-8444-444444444444', MEMBER = '55555555-5555-4555-8555-555555555555';
const HARBOR_SITE = '66666666-6666-4666-8666-666666666666', HARBOR_CLIENT = '77777777-7777-4777-8777-777777777777';
const OTHER_SITE = '88888888-8888-4888-8888-888888888888', OTHER_CLIENT = '99999999-9999-4999-8999-999999999999';
const DEAL = 'aaaaaaaa-0000-4000-8000-000000000001', PROJ = 'bbbbbbbb-0000-4000-8000-000000000001', REQ = 'cccccccc-0000-4000-8000-000000000001';
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@studio.test' } } });
const C = await import('../../supabase/functions/presence/routes/crm.ts');
const R = await import('../../supabase/functions/presence/lib/record_search.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: S, client_id: CLIENT, status: 'live', edition: 'presence', custom_domain: 'studio.example' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const search = async (q, who = owner) => { const r = await C.handleCrmSearch(new Request(`https://fn.test/functions/v1/presence/crm/search?q=${encodeURIComponent(q)}`), who.jwt || 'jwt-owner', site, who, cors); return { status: r.status, body: await r.json().catch(() => null) }; };
const at = '2026-11-03T10:00:00Z';
const world = () => ({
  presence_agency_members: [{ id: MEMBER, agency_id: AG, email: 'owner@studio.test', role: 'owner', status: 'active', user_id: U }],
  presence_agencies: [{ id: AG, name: 'Studio', status: 'active', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} }],
  presence_agency_clients: [{ site_id: HARBOR_SITE, agency_id: AG, status: 'active' }, { site_id: OTHER_SITE, agency_id: AG, status: 'active' }],
  presence_sites: [
    { id: S, client_id: CLIENT, custom_domain: 'studio.example', status: 'live', edition: 'presence' },
    { id: HARBOR_SITE, client_id: HARBOR_CLIENT, custom_domain: 'harbordental.example', status: 'live', edition: 'presence' },
    { id: OTHER_SITE, client_id: OTHER_CLIENT, custom_domain: 'quill-books.example', status: 'draft', edition: 'monitor' },
  ],
  presence_identity: [{ site_id: HARBOR_SITE, business_name: 'Harbor Dental' }, { site_id: S, business_name: 'Bright Studio' }],
  clients: [{ id: HARBOR_CLIENT, name: 'Harbor Dental', email: 'office@harbordental.example' }, { id: OTHER_CLIENT, name: 'Quill Books', email: 'hi@quill-books.example' }],
  presence_service_links: [{ agency_site_id: S, customer_client_id: HARBOR_CLIENT, customer_site_id: HARBOR_SITE, status: 'active', project_id: PROJ }],
  presence_contacts: [
    { id: id('dddddddd', 1), site_id: S, name: 'Marcus Bell', email: 'marcus@harbordental.example', phone: '(555) 010-4410', company: 'Harbor Dental', notes: '', deleted_at: null, updated_at: at },
    { id: id('dddddddd', 2), site_id: S, name: 'Ana Ruiz', email: 'ana@example.com', phone: '555.010.2211', company: '', notes: 'Wants Spanish pages next year, like Harbor', deleted_at: null, updated_at: at },
    { id: id('dddddddd', 3), site_id: S, name: 'Bo Reyes', email: 'bo@example.com', phone: '010-9-4410', company: '', notes: '[[connect-on-signup]]', deleted_at: null, updated_at: at },
    { id: id('dddddddd', 4), site_id: S, name: 'Gone Person', email: 'gone@example.com', phone: '5550104410', company: 'Harbor', notes: '', deleted_at: '2026-10-01T00:00:00Z', updated_at: at },
    { id: id('dddddddd', 5), site_id: OTHER_SITE, name: 'Harbor Elsewhere', email: 'x@other.example', phone: '5550104410', company: '', notes: '', deleted_at: null, updated_at: at },
  ],
  presence_deals: [
    { id: DEAL, site_id: S, title: 'Harbor Dental — new website', stage: 'proposal', notes: '', converted_client_id: null, deleted_at: null, updated_at: at },
    { id: id('eeeeeeee', 2), site_id: S, title: 'Logo refresh', stage: 'lead', notes: 'Harbor asked for this too', converted_client_id: null, deleted_at: null, updated_at: at },
  ],
  presence_projects: [{ id: PROJ, site_id: S, name: 'Harbor website build', status: 'active', deleted_at: null }],
  presence_invoices: [{ id: id('ffffffff', 1), site_id: S, title: 'Deposit', amount_cents: 120000, status: 'open', deal_id: DEAL, deleted_at: null, created_at: at }],
  presence_form_submissions: [
    { id: id('abababab', 1), site_id: S, name: 'Lena Ortiz', email: 'lena@example.com', phone: '', message: 'Hello — do you redo dental sites like Harbor’s? We need booking too.', spam: false, created_at: at },
    { id: id('abababab', 2), site_id: S, name: 'Theo Grant', email: 'theo@example.com', phone: '555 010 4410', message: 'Call me back please', spam: false, created_at: at },
    { id: id('abababab', 3), site_id: S, name: 'Spammy Harbor', email: 'spam@example.com', phone: '', message: 'buy now', spam: true, created_at: at },
  ],
  presence_proposals: [{ id: id('acacacac', 1), site_id: S, deal_id: DEAL, title: 'Harbor Dental website proposal', status: 'sent', created_at: at, deleted_at: null }],
  presence_estimates: [{ id: id('adadadad', 1), site_id: S, deal_id: DEAL, title: 'Harbor booking add-on estimate', status: 'draft', created_at: at, deleted_at: null }],
  presence_contracts: [{ id: id('aeaeaeae', 1), site_id: S, deal_id: DEAL, title: 'Harbor Dental agreement', status: 'signed', created_at: at, deleted_at: null }],
  presence_deal_tasks: [{ id: id('afafafaf', 1), site_id: S, deal_id: DEAL, title: 'Send Harbor the logo options', due_date: '2026-11-12', status: 'open', created_at: at, deleted_at: null }],
  presence_tasks: [{ id: id('bcbcbcbc', 1), site_id: S, project_id: PROJ, title: 'Write the Harbor about page', due_date: null, status: 'todo', created_at: at, deleted_at: null }],
  presence_support_requests: [{ id: REQ, site_id: S, subject: 'Hours on the Harbor site are wrong', body: 'Saturday says closed', created_at: at, deleted_at: null }],
  presence_support_messages: [{ id: id('bdbdbdbd', 1), site_id: S, request_id: REQ, body: 'Fixed the Harbor hours, thanks!', created_at: at, deleted_at: null }],
  presence_project_messages: [{ id: id('bebebebe', 1), site_id: S, project_id: PROJ, body: 'The Harbor photos are in the shared folder', created_at: at, deleted_at: null }],
  presence_deal_events: [
    { id: id('bfbfbfbf', 1), site_id: S, deal_id: DEAL, kind: 'note', detail: { activity_kind: 'call', body: 'Talked to Harbor about launch timing', occurred_at: at }, created_at: at },
    { id: id('bfbfbfbf', 2), site_id: S, deal_id: DEAL, kind: 'stage_change', detail: { body: 'Harbor moved' }, created_at: at },
  ],
  presence_relationship_notes: [{ id: id('cdcdcdcd', 1), site_id: HARBOR_SITE, body: 'Harbor prefers texts to calls', created_at: at, deleted_at: null }],
  presence_sales_templates: [],
});
const kinds = (rs) => rs.map((r) => `${r.group}:${r.kind}:${r.label}`);
const findR = (rs, pred) => rs.find(pred);

// ═══ the pure helpers ═══
ok('helper: phoneDigits reads a number or a piece of one, four digits or more', R.phoneDigits('(555) 010-4410') === '5550104410' && R.phoneDigits('010 4410') === '0104410' && R.phoneDigits('4410') === '4410' && R.phoneDigits('441') === '' && R.phoneDigits('harbor 4410') === '');
ok('helper: phonePattern puts a wildcard between digits', R.phonePattern('4410') === '*4*4*1*0*');
ok('helper: phoneHas needs the digits in a row', R.phoneHas('(555) 010-4410', '0104410') && !R.phoneHas('010-9-4410', '0104410'));
ok('helper: snippet keeps the match in view, marks the cuts', (() => { const s = R.snippet('a'.repeat(200) + ' Harbor wants more ' + 'b'.repeat(200), 'harbor', 60); return s.startsWith('…') && s.endsWith('…') && s.includes('Harbor') && s.length <= 62; })());
ok('helper: a short text is the whole text', R.snippet('  Harbor   photos ', 'harbor') === 'Harbor photos');
ok('helper: cleanSearch keeps an underscore, drops the filter grammar', R.cleanSearch(' jane_doe (x),*"% ') === 'jane_doe x');
ok('helper: arrangeResults orders groups, caps them and shows a link once', (() => {
  const rs = [{ kind: 'note', group: 'notes', label: 'n', sub: '', href: '/a' }, ...Array.from({ length: 9 }, (_, i) => ({ kind: 'contact', group: 'people', label: 'p' + i, sub: '', href: '/p' + i })), { kind: 'contact', group: 'people', label: 'p0', sub: 'by phone', href: '/p0' }, { kind: 'proposal', group: 'deals', label: 'x', sub: '', href: '/d' }, { kind: 'deal', group: 'deals', label: 'x', sub: '', href: '/d' }];
  const out = R.arrangeResults(rs);
  return out[0].group === 'people' && out.filter((r) => r.group === 'people').length === 6 && out.at(-1).group === 'notes' && out.filter((r) => r.label === 'p0').length === 1 && out.filter((r) => r.href === '/d').length === 2;
})());

// ═══ every place, in its group ═══
{
  db.reset(world());
  const { status, body } = await search('harbor');
  const rs = body?.data?.results || [];
  ok('harbor: answers 200, not partial', status === 200 && body?.data?.partial === false, JSON.stringify(body).slice(0, 300));
  ok('people: the customer by name', !!findR(rs, (r) => r.group === 'people' && r.kind === 'customer' && r.label === 'Harbor Dental' && r.href === `/crm.html?client=${HARBOR_SITE}`));
  ok('people: a contact by company', !!findR(rs, (r) => r.group === 'people' && r.label === 'Marcus Bell'));
  ok('websites: "Open website" beside the row opens the site itself', !!findR(rs, (r) => r.group === 'websites' && r.alt?.href === 'https://harbordental.example' && r.alt?.label === 'Open website'));
  ok('websites: a client’s website by its name, opening its editor inside the client', !!findR(rs, (r) => r.group === 'websites' && r.label === 'Harbor Dental' && r.sub === 'harbordental.example · Live' && r.href === `/presence.html?client=${HARBOR_SITE}`));
  ok('enquiries: one found by what they wrote, with the words', !!findR(rs, (r) => r.group === 'enquiries' && r.label === 'Lena Ortiz' && /^“.*Harbor/.test(r.snippet || '') && /^Enquiry · Nov 3$/.test(r.sub) && r.href.startsWith('/inbox.html#enquiries?sel=lead:')));
  ok('enquiries: spam never shows', !rs.some((r) => /Spammy/.test(r.label)));
  ok('deals: the deal by title, named by its stage', !!findR(rs, (r) => r.group === 'deals' && r.kind === 'deal' && r.sub === 'Deal · Proposal sent'));
  ok('deals: a proposal, an estimate and an agreement by title', ['proposal', 'estimate', 'agreement'].every((k) => findR(rs, (r) => r.group === 'deals' && r.kind === k && r.href === `/crm.html?deal=${DEAL}&tab=deal`)) && !!findR(rs, (r) => r.kind === 'agreement' && /Signed/.test(r.sub)));
  ok('projects: the project', !!findR(rs, (r) => r.group === 'projects' && r.label === 'Harbor website build'));
  ok('to-dos: a deal to-do and a project task', !!findR(rs, (r) => r.group === 'todos' && r.label === 'Send Harbor the logo options' && /due Nov 12/.test(r.sub)) && !!findR(rs, (r) => r.group === 'todos' && r.label === 'Write the Harbor about page' && r.href === `/crm.html?project=${PROJ}&tab=delivery`));
  ok('messages: a support request, its reply and a project message', !!findR(rs, (r) => r.group === 'messages' && r.label === 'Hours on the Harbor site are wrong' && r.href === `/inbox.html#support?sel=sup:${REQ}`) && !!findR(rs, (r) => r.group === 'messages' && /Fixed the Harbor hours/.test(r.label) && r.href === `/inbox.html#support?sel=sup:${REQ}`) && !!findR(rs, (r) => r.group === 'messages' && /Harbor photos/.test(r.label) && r.href === `/crm.html?project=${PROJ}&tab=activity`));
  ok('notes: a contact’s note, a deal’s note, a logged call and a note on a client’s record', !!findR(rs, (r) => r.group === 'notes' && r.sub === 'Note on Ana Ruiz') && !!findR(rs, (r) => r.group === 'notes' && r.sub === 'Note on Logo refresh') && !!findR(rs, (r) => r.group === 'notes' && /^Logged call/.test(r.sub) && r.href === `/crm.html?deal=${DEAL}&tab=activity`) && !!findR(rs, (r) => r.group === 'notes' && r.sub === 'Note on Harbor Dental' && r.href === `/crm.html?client=${HARBOR_SITE}&tab=details`));
  ok('notes: a system event’s detail is not a note', !rs.some((r) => /Harbor moved/.test(r.label)));
  ok('actions: still offered for the customer', !!findR(rs, (r) => r.group === 'actions' && r.label === 'Send invoice to Harbor Dental'));
  const order = rs.map((r) => R.SEARCH_GROUPS.indexOf(r.group));
  ok('the groups come in order', order.every((g, i) => i === 0 || g >= order[i - 1]), kinds(rs).join(' | '));
  ok('a removed contact and another site’s contact never show', !rs.some((r) => /Gone Person|Harbor Elsewhere/.test(r.label)));
}
{
  db.reset(world());
  const rs = (await search('harbordental.example')).body?.data?.results || [];
  ok('websites: a domain finds its site', !!findR(rs, (r) => r.group === 'websites' && r.label === 'Harbor Dental'));
  const own = (await search('studio.example')).body?.data?.results || [];
  ok('websites: the studio’s own domain finds its own website', !!findR(own, (r) => r.group === 'websites' && r.label === 'Bright Studio (your website)' && r.href === '/presence.html'));
  const mon = (await search('quill')).body?.data?.results || [];
  ok('websites: a site hosted elsewhere says so', !!findR(mon, (r) => r.group === 'websites' && r.sub === 'quill-books.example · Hosted elsewhere'));
}

// ═══ a phone number by its digits ═══
{
  db.reset(world());
  const rs = (await search('010-4410')).body?.data?.results || [];
  ok('phone: "010-4410" finds the contact written "(555) 010-4410", the number beside the name', !!findR(rs, (r) => r.group === 'people' && r.label === 'Marcus Bell' && r.sub === '(555) 010-4410 · Harbor Dental'));
  ok('phone: and the enquiry written "555 010 4410"', !!findR(rs, (r) => r.group === 'enquiries' && r.label === 'Theo Grant' && r.sub === '555 010 4410 · Nov 3'));
  ok('phone: digits in order but not in a row are not a match', !rs.some((r) => r.label === 'Bo Reyes'));
  const loose = db.reads('phone=ilike.*0*1*0*4*4*1*0*');
  ok('phone: the database is asked with the loose pattern, for this studio only', loose.length === 2 && loose.every((c) => c.url.includes(`site_id=eq.${S}`)));
  const plain = (await search('5550104410')).body?.data?.results || [];
  ok('phone: the whole number with no marks finds them too', !!findR(plain, (r) => r.label === 'Marcus Bell'));
}

// ═══ what is read, and what isn't ═══
{
  db.reset(world());
  await search('harbor');
  const reads = db.log.filter((c) => c.method === 'GET' && c.url.startsWith('/rest/v1/'));
  const byIds = /^\/rest\/v1\/(clients|presence_sites|presence_identity|presence_agency_members|presence_agencies|presence_agency_clients|presence_relationship_notes|presence_sales_templates)\?/;
  const stray = reads.filter((c) => !byIds.test(c.url) && !c.url.includes(`site_id=eq.${S}`));
  ok('every read of a studio table names this studio’s site', reads.length > 15 && stray.length === 0, stray.map((c) => c.url.slice(0, 100)).join(' | '));
  ok('a client’s notes are read only on this studio’s own clients’ sites', db.reads('presence_relationship_notes?').every((c) => c.url.includes(`site_id=in.(${HARBOR_SITE},${OTHER_SITE})`)));
  ok('the websites come from this studio’s portfolio', db.reads('presence_agency_clients?').every((c) => c.url.includes(`agency_id=eq.${AG}`)));
  db.reset(world());
  await search('ha');
  ok('two letters: names and titles only — notes, messages and enquiry words wait for a third', !db.reads('presence_support_requests').length && !db.reads('presence_project_messages').length && !db.reads('presence_deal_events').length && !db.reads('notes.ilike').length && !db.reads('message.ilike').length);
  db.reset(world());
  const conn = (await search('connect')).body?.data?.results || [];
  ok('the connect-on-signup marker in a contact’s notes is not a note', !conn.some((r) => r.group === 'notes'));
}

// ═══ money words (and item 76) ═══
{
  db.reset(world());
  const rs = (await search('invoices')).body?.data?.results || [];
  ok('a money word lists what’s open', !!findR(rs, (r) => r.group === 'money' && /Deposit — \$1,200/.test(r.label)));
  ok('item 76: "Who owes you" opens Pipeline’s Who owes you (#outstanding)', !!findR(rs, (r) => r.label === 'Who owes you' && r.href === '/pipeline.html#outstanding'));
}

// ═══ failures are said ═══
{
  db.reset(world());
  db.fail.add('presence_support_requests');
  const r = await search('harbor');
  ok('one place failing: the rest answer, and it says partial', r.status === 200 && r.body?.data?.partial === true && (r.body?.data?.results || []).some((x) => x.label === 'Marcus Bell'));
  db.reset(world());
  for (const t of ['presence_contacts', 'presence_deals', 'presence_projects', 'presence_service_links', 'presence_invoices', 'presence_form_submissions', 'presence_proposals', 'presence_estimates', 'presence_contracts', 'presence_deal_tasks', 'presence_tasks', 'presence_support_requests', 'presence_support_messages', 'presence_project_messages', 'presence_deal_events', 'presence_agency_clients']) db.fail.add(t);
  const all = await search('harbor');
  ok('every place failing: 502 with a sentence, never "nothing matches"', all.status === 502 && all.body?.error === 'read_failed' && /couldn’t load/.test(all.body?.message || ''));
  db.reset(world());
  const stranger = await search('harbor', { kind: 'client', userId: 'x', email: 'someone@example.com', jwt: 'jwt-nobody', requestId: 't' });
  ok('not the studio: nothing is searched', stranger.status === 200 && stranger.body?.data?.results?.length === 0 && db.log.filter((c) => c.url.startsWith('/rest/v1/presence_contacts')).length === 0);
}

// ═══ every link the search can return opens what it says ═══
{
  db.reset(world());
  const all = [];
  for (const q of ['harbor', 'invoices', '010-4410', 'studio.example']) all.push(...((await search(q)).body?.data?.results || []));
  const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
  const crm = read('crm.html'), inbox = read('inbox.html'), pipeline = read('pipeline.html');
  const tabOrder = (/const TAB_ORDER=\[([^\]]*)\]/.exec(crm) || [])[1] || '';
  const bad = all.filter((r) => {
    const [path, hash = ''] = r.href.split('#');
    const u = new URL(path, 'https://app.test');
    if (u.pathname === '/crm.html') { const t = u.searchParams.get('tab'); return !!t && !tabOrder.includes(`'${t}'`); }   // no tab: the record's own first tab
    if (u.pathname === '/inbox.html') { const view = hash.split('?')[0]; return !['enquiries', 'support'].includes(view) || !/sel=(lead|sup):/.test(hash) || !inbox.includes(`'${view}'`); }
    if (u.pathname === '/pipeline.html') return !!hash && !new RegExp(`#${hash}\\b|'${hash}'`).test(pipeline);
    if (u.pathname === '/presence.html') return false;
    return true;
  });
  ok('every link opens a real page at a tab or place that page knows', all.length > 20 && bad.length === 0, bad.map((r) => r.href).join(' | '));
}

console.log(`\n════ SEARCH (item 84): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
