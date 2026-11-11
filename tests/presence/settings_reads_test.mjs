// ── Bug hunt C4 + C16 (Nov 10 2026): a read that failed is not "nothing saved" ──
//   deno run --allow-read --allow-env --allow-net tests/presence/settings_reads_test.mjs
// Settings showed empty boxes and defaults when a read failed, and the next save wrote
// them over the real settings. The page now holds a part whose read failed (pinned at
// the end and in tests/e2e/settings-reads.spec.ts); the server's two reads that used
// the forgiving reader (readReservedJson: a failure reads as "nothing saved") are strict
// now, driven here through a PostgREST fetch fake:
//   · GET /sales/stages answers 502 instead of "no renames, every percent as usual",
//     and a PUT that can't read the half it keeps saves nothing;
//   · GET /agency/nav answers 502 instead of "nothing hidden";
//   · C16: GET /agency/nav says whether the caller may change the menu (can_edit), by
//     the same rule its PUT keeps (manage_clients), so Settings never shows switches
//     that every press of would fail.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { handleSalesStages } = await import('../../supabase/functions/presence/routes/sales.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');

const SITE = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const OWN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const jr = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let STORE, readFails, writes;
const reset = (store = {}) => { STORE = { ...store }; readFails = false; writes = []; };
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input instanceof Request ? input.url : input));
  const method = (init.method || 'GET').toUpperCase();
  const table = u.pathname.split('/').pop();
  if (u.pathname.includes('/auth/v1/user')) return jr({ id: 'u-1', email: 'pat@studio.example' });
  if (table === 'presence_sites') return jr([{ id: OWN, client_id: 'c-own', status: 'live', edition: 'presence' }]);   // the studio's own site (resolveSite)
  if (table === 'presence_sales_templates') {
    const name = decodeURIComponent((u.searchParams.get('name') || '').replace(/^eq\./, ''));
    if (method === 'GET') return readFails ? jr({ message: 'boom' }, 503) : jr(STORE[name] !== undefined ? [{ id: 'r-' + name, body: JSON.stringify(STORE[name]), updated_at: '2026-11-01T00:00:00Z' }] : []);
    writes.push({ method, name, body: init.body ? JSON.parse(init.body) : null });
    if (method === 'PATCH') { STORE[name] = JSON.parse(JSON.parse(init.body).body); return jr([{ id: 'r-' + name }]); }
    return jr([{ id: 'r-new' }], 201);
  }
  return jr([]);
};
const stages = async (method, body) => {
  const res = await handleSalesStages(new Request('https://fn.example/presence/sales/stages', { method, body: body ? JSON.stringify(body) : undefined }), SITE, { kind: 'operator', email: 'eric@studio.example' }, {});
  return { status: res.status, body: await res.json() };
};
const member = (role) => ({ agency_id: 'ag-1', member_id: 'm-1', email: 'pat@studio.example', role, agency_name: 'Bright Studio', plan: 'agency', branding: {} });
const nav = async (role, method = 'GET', body) => {
  const req = new Request('https://fn.example/presence/agency/nav', { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'jwt-studio' } });
  const res = await handleAgency(req, '/agency/nav', method, member(role), { kind: 'client', userId: 'u-1', email: 'pat@studio.example' }, {});
  return { status: res.status, body: await res.json() };
};

// ── GET /sales/stages ──
{
  reset({ __stage_names__: { lead: 'Enquiry' }, __stage_chances__: { lead: 20 } });
  const r = await stages('GET');
  ok('stages: a good read answers the studio\'s names and percents', r.status === 200 && r.body.data.custom.lead === 'Enquiry' && r.body.data.chances.lead === 20);
  readFails = true;
  const f = await stages('GET');
  ok('stages: a failed read answers 502, not "nothing renamed"', f.status === 502 && f.body.error === 'read_failed' && !f.body.data);
}
// ── PUT /sales/stages ──
{
  reset({ __stage_names__: { lead: 'Enquiry' }, __stage_chances__: { lead: 20 } });
  readFails = true;
  const f = await stages('PUT', { names: { lead: 'Enquiry', qualified: 'Talking' } });
  ok('stages: a PUT that can\'t read the half it keeps saves nothing', f.status === 502 && writes.length === 0);
  ok('stages: …and says so in plain words', /nothing was saved/.test(f.body.message || ''));
  readFails = false;
  const w = await stages('PUT', { names: { lead: 'Enquiry', qualified: 'Talking' } });
  ok('stages: with the read back, the names save and the percents come back as they were', w.status === 200 && STORE.__stage_names__.qualified === 'Talking' && w.body.data.chances.lead === 20 && !writes.some((x) => x.name === '__stage_chances__'));
}

// ── GET /agency/nav ──
{
  reset({ __nav_hidden__: { hidden: ['sites', 'files'] } });
  const r = await nav('owner');
  ok('menu: a good read answers what is hidden', r.status === 200 && JSON.stringify(r.body.data.hidden) === '["sites","files"]');
  ok('C16: an owner may change it', r.body.data.can_edit === true);
  ok('C16: an account manager may too (manage_clients)', (await nav('account_manager')).body.data.can_edit === true);
  ok('C16: a designer sees it but may not change it', (await nav('designer')).body.data.can_edit === false);
  ok('C16: …and the PUT agrees: a designer\'s change is refused', (await nav('designer', 'PUT', { hidden: [] })).status === 403);
  const put = await nav('owner', 'PUT', { hidden: ['sites'] });
  ok('C16: a change that saved says the caller may change it', put.status === 200 && put.body.data.can_edit === true);
  readFails = true;
  const f = await nav('owner');
  ok('C4: a failed read answers 502, not "nothing hidden"', f.status === 502 && f.body.error === 'read_failed' && !f.body.data);
}

// ── the page's half (settings.html) ──
{
  const h = Deno.readTextFileSync(new URL('../../settings.html', import.meta.url));
  ok('page: it knows whether each read answered', /IDENT_READ = i\.ok; SETTINGS_READ = s\.ok;/.test(h));
  ok('page: a held part keeps its save off', /if \(!IDENT_READ \|\| !SETTINGS_READ\) return;/.test(h) && /if \(!SETTINGS_READ\) \{ if \(undo\) undo\(\);/.test(h));
  ok('page: the menu\'s switches follow can_edit', /MENU\.can_edit === false/.test(h));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ SETTINGS READS (bug hunt C4, C16): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
