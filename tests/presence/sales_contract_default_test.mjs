// ── The empty agreement form's "my newest saved wording" read ────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_contract_default_test.mjs
//
// GET /sales/templates?with_body=contract is the ONE route that hands a template
// BODY back to the deal page, which seeds it straight into the agreement
// textarea. It is also the one branch that does NOT carry the plain list's
// name=neq.__services_catalog__ / __crm_contact_fields__ exclusions — it leaned
// entirely on kind=eq.contract to keep the reserved sentinel rows out. Those
// rows are not agreements: __crm_contact_fields__'s body is contact FIELD-
// DEFINITION JSON, so a leak here puts `[{"key":"budget","type":"number"}]` in
// front of a client as the text of their contract.
//
// Dropping the kind filter left every existing test green, so this suite pins it
// two ways: STRUCTURALLY (the filters are in the query) and BEHAVIOURALLY (the
// route is executed against a fake PostgREST and never returns a sentinel, no
// matter which single filter is removed).
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const ROOT = new URL('../../', import.meta.url);
const sales = Deno.readTextFileSync(new URL('supabase/functions/presence/routes/sales.ts', ROOT));
const { handleSalesTemplates } = await import('../../supabase/functions/presence/routes/sales.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const SERVICES_CATALOG_NAME = '__services_catalog__';
const CONTACT_FIELDS_NAME = '__crm_contact_fields__';
const SITE = { id: '11111111-1111-4111-8111-111111111111' };
const OTHER_SITE = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL = { email: 'eric@example.com', userId: 'u1' };
const CORS = {};

// ═══ 1. Structural — the filters are actually in the query ═══
{
  const branch = (sales.match(/with_body'\) === 'contract'\)\s*\{([\s\S]*?)\n\s*\}/) || [])[1] || '';
  ok('the with_body=contract branch exists', branch.length > 0);
  ok('it filters kind=eq.contract (the sentinel rows are kind=proposal)', /kind=eq\.contract/.test(branch));
  ok('it is site-scoped and skips deleted rows', /site_id=eq\.\$\{site\.id\}/.test(branch) && /deleted_at=is\.null/.test(branch));
  // belt AND braces: the plain list's name exclusions now ride along here too, so
  // a sentinel row that ever lands with the wrong `kind` still can't be served
  // as somebody's contract.
  ok('it ALSO excludes the reserved names by name (belt and braces)',
    /name=neq\.\$\{encodeURIComponent\(SERVICES_CATALOG_NAME\)\}/.test(branch) && /name=neq\.\$\{encodeURIComponent\(CONTACT_FIELDS_NAME\)\}/.test(branch));
  ok('it returns exactly one row, newest first (a body is up to 50KB)', /order=updated_at\.desc&limit=1/.test(branch));
}

// ═══ A fake PostgREST — enough of the filter grammar this route speaks ═══
const world = { rows: [], escaped: [], lastPath: '' };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const matches = (row, key, expr) => {
  if (expr === 'is.null') return row[key] === null || row[key] === undefined;
  if (expr === 'is.notnull') return row[key] !== null && row[key] !== undefined;
  const [op, ...rest] = expr.split('.');
  const want = decodeURIComponent(rest.join('.'));
  if (op === 'eq') return String(row[key]) === want;
  if (op === 'neq') return String(row[key]) !== want;
  throw new Error('fake PostgREST does not speak: ' + key + '=' + expr);
};
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  if (u.hostname !== 'example.supabase.co' || !u.pathname.startsWith('/rest/v1/presence_sales_templates')) {
    world.escaped.push(url); return Promise.resolve(jres(500, { error: 'escaped the fake' }));
  }
  if ((init?.method || 'GET').toUpperCase() !== 'GET') return Promise.resolve(jres(201, []));
  world.lastPath = u.search;
  let out = world.rows.slice();
  for (const [key, expr] of u.searchParams) {
    if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
    out = out.filter((r) => matches(r, key, expr));
  }
  const order = u.searchParams.get('order');
  if (order) { const [col, dir] = order.split('.'); out.sort((a, b) => (dir === 'desc' ? -1 : 1) * String(a[col]).localeCompare(String(b[col]))); }
  const lim = Number(u.searchParams.get('limit'));
  if (Number.isFinite(lim) && lim > 0) out = out.slice(0, lim);
  return Promise.resolve(jres(200, out));
};

const getWithBody = async () => {
  const r = await handleSalesTemplates(new Request('http://x/sales/templates?with_body=contract'), SITE, PRINCIPAL, CORS);
  return { status: r.status, data: (await r.json()).data };
};

// ═══ 2. Behavioural — a reserved row is NEVER served as an agreement ═══
{
  // The sentinels are the NEWEST rows, so any missing filter surfaces one.
  const REAL = { id: 'c1', site_id: SITE.id, kind: 'contract', name: 'My agreement', title: 'My agreement', body: 'MY OWN WORDING for {{client_company}}.', deleted_at: null, updated_at: '2026-01-01T00:00:00Z' };
  const FIELDS = { id: 's1', site_id: SITE.id, kind: 'proposal', name: CONTACT_FIELDS_NAME, title: '', body: '[{"key":"budget","label":"Budget","type":"number"}]', deleted_at: null, updated_at: '2026-09-09T00:00:00Z' };
  const CATALOG = { id: 's2', site_id: SITE.id, kind: 'proposal', name: SERVICES_CATALOG_NAME, title: '', body: '', deleted_at: null, updated_at: '2026-09-08T00:00:00Z' };
  // an ordinary PROPOSAL template — not reserved, not an agreement, and newer
  // than the real one, so only kind=eq.contract keeps it out
  const PROP = { id: 'p1', site_id: SITE.id, kind: 'proposal', name: 'Standard package', title: 'Standard package', body: '', deleted_at: null, updated_at: '2026-09-07T00:00:00Z' };

  world.rows = [REAL, FIELDS, CATALOG, PROP];
  {
    const r = await getWithBody();
    ok('with_body=contract returns the studio’s real saved agreement', r.status === 200 && r.data.length === 1 && r.data[0].id === 'c1', JSON.stringify(r.data));
    ok('…and NOT the contact field-definitions row', !r.data.some((t) => t.name === CONTACT_FIELDS_NAME));
    ok('…and NOT the services catalog row', !r.data.some((t) => t.name === SERVICES_CATALOG_NAME));
    ok('…and NOT an ordinary PROPOSAL template (a proposal has no agreement body)', !r.data.some((t) => t.id === 'p1'));
    ok('the body it hands the agreement textarea is agreement text, not field-definition JSON', !/"key"\s*:/.test(String(r.data[0]?.body || '')));
  }

  // The failure mode this route must survive: a sentinel row that somehow carries
  // kind=contract (a future writer, a hand-edit, a restore). kind=eq.contract
  // alone would serve it; the name exclusions are what stop it.
  world.rows = [REAL, { ...FIELDS, kind: 'contract' }, { ...CATALOG, kind: 'contract' }];
  {
    const r = await getWithBody();
    ok('a MISLABELLED sentinel (kind=contract) is still refused by name', r.data.length === 1 && r.data[0].id === 'c1', JSON.stringify(r.data.map((t) => t.name)));
  }

  // No saved agreement at all → an empty list, so the deal page falls through to
  // the built-in standard agreement. It must NOT fall through to a sentinel.
  world.rows = [FIELDS, CATALOG, PROP];
  {
    const r = await getWithBody();
    ok('no saved agreement → an EMPTY list (the built-in default then wins)', r.status === 200 && r.data.length === 0, JSON.stringify(r.data));
  }

  // Tenant isolation: another site's saved agreement is never handed over.
  world.rows = [{ ...REAL, id: 'c9', site_id: OTHER_SITE, updated_at: '2026-12-12T00:00:00Z' }];
  {
    const r = await getWithBody();
    ok('another site’s saved agreement is never returned', r.data.length === 0, JSON.stringify(r.data));
  }

  ok('every call went through the fake — nothing escaped to the network', world.escaped.length === 0, world.escaped[0] || '');
}

// ═══ 3. The plain list keeps its own exclusions (unchanged, still pinned) ═══
{
  world.rows = [
    { id: 'p1', site_id: SITE.id, kind: 'proposal', name: 'Standard package', title: '', line_items: [], deleted_at: null, updated_at: '2026-02-02T00:00:00Z' },
    { id: 's1', site_id: SITE.id, kind: 'proposal', name: CONTACT_FIELDS_NAME, title: '', line_items: [], deleted_at: null, updated_at: '2026-09-09T00:00:00Z' },
    { id: 's2', site_id: SITE.id, kind: 'proposal', name: SERVICES_CATALOG_NAME, title: '', line_items: [], deleted_at: null, updated_at: '2026-09-08T00:00:00Z' },
  ];
  const r = await handleSalesTemplates(new Request('http://x/sales/templates'), SITE, PRINCIPAL, CORS);
  const data = (await r.json()).data;
  ok('the plain list still hides both reserved rows', data.length === 1 && data[0].id === 'p1', JSON.stringify(data.map((t) => t.name)));
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ SALES CONTRACT DEFAULT: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
