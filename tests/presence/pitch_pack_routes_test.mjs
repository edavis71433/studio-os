// ── Pitch packs (Semrush review, sales item 113): the real routes ─────────────
// One scan per request; fresh tool_reports are reused rather than re-bought; a
// piece that can't be built is skipped WITH ITS REASON; the finished pack is a
// public read by its own token and nothing else. Real handlers against the
// shared in-memory PostgREST; the one real scan runs on faked fetchers.
//   deno run --allow-read --allow-env --allow-net tests/presence/pitch_pack_routes_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3'), P_DINER = uuid('4'), P_FADES = uuid('5'), P_DENTAL = uuid('6'), P_BAKERY = uuid('7');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });

// nothing outside the fake database may be reached unless a test allows it
const pg = globalThis.fetch;
let outside = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/rpc/tool_spend_today')) return new Response('0', { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname !== 'db.test') { outside.push(`${(init.method || 'GET').toUpperCase()} ${u.hostname}`); return new Response('{}', { status: 500 }); }
  return pg(url, init);
};
const PP = await import('../../supabase/functions/presence/routes/pitch_pack.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (body) => new Request('https://fn.test/functions/v1/presence/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-owner' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const packs = () => db.tables.presence_pitch_packs || [];
const reports = () => db.tables.tool_reports || [];
const NOW = Date.parse('2026-11-10T12:00:00Z');
PP.packDeps.now = () => NOW;
const freshAt = new Date(NOW - 5 * 86400000).toISOString();
const staleAt = new Date(NOW - 45 * 86400000).toISOString();
const report = (url, overall, tool = 'site_review', at = freshAt) => ({ id: crypto.randomUUID(), tool, input: { url }, scores: { overall, label: overall >= 70 ? 'Strong' : 'Needs work' }, findings: { items: [{ title: 'No phone number above the fold' }, { title: 'Images slow the first view' }, { title: 'Missing page titles' }, { title: 'A fourth thing' }] }, created_at: at });
const prospect = (id, over = {}) => ({ id, site_id: SITE, business_name: 'Old Diner', phone: null, website: 'https://old-diner.example', address: '2 Main St, Burbank, CA 91501', industry: 'Diner', site_health: 'dated', score: 65, status: 'New', search_query: 'diners in Burbank', deleted_at: null, ...over });
const world = (extra = {}) => {
  db.reset({
    presence_sites: [{ id: SITE, client_id: OWNER }],
    presence_prospects: [
      prospect(P_DINER),
      prospect(P_FADES, { business_name: 'Fresh Fades Barbershop', website: null, site_health: 'no_website', score: 95 }),
      prospect(P_DENTAL, { business_name: 'Shiny Dental', website: 'https://shiny-dental.example', site_health: 'decent', score: 30 }),
      prospect(P_BAKERY, { business_name: 'Brand New Bakery', website: 'https://bakery.example', site_health: 'decent', score: 35 }),
    ],
    tool_reports: [report('https://old-diner.example/', 41), report('https://shiny-dental.example/', 82), report('https://bakery.example/', 74)],
    ...extra,
  });
  outside = [];
};
PP.packDeps.ai = { engines: [] };   // the AI check is "not switched on" unless a test says otherwise

// ═══ the build: one piece per request, reusing fresh reports, honest skips ═══
{
  world();
  const states = [];
  for (let i = 0; i < 6; i++) {
    const r = await res(await PP.handleProspectPack(req({}), site, owner, P_DINER, cors));
    ok(`build call ${i + 1} answers 200 with progress`, r.status === 200 && r.body.data && typeof r.body.data.done === 'number', JSON.stringify(r.body));
    states.push(r.body.data);
    if (r.body.data.state === 'ready') break;
  }
  const last = states[states.length - 1];
  ok('the pack finishes and hands back its share link', last.state === 'ready' && /^\/pitch\.html\?t=[0-9a-f]{24,64}$/.test(last.share_url));
  const pk = packs()[0];
  ok('one pack row, ready, with its pieces', packs().length === 1 && pk.status === 'ready' && !!pk.built_at);
  ok('their score came from the fresh report — nothing left the building', pk.pieces.you.summary.overall === 41 && outside.length === 0 && reports().length === 3);
  ok('their top three issues ride along, no more', pk.pieces.you.summary.top_issues.length === 3);
  ok('the two rivals are the best nearby sites, best first', pk.pieces.rivals.map((r) => r.name).join('·') === 'Shiny Dental·Brand New Bakery'
    && pk.pieces.rivals[0].summary.overall === 82 && pk.pieces.rivals[1].summary.overall === 74, JSON.stringify(pk.pieces.rivals));
  ok('a rival is named, never linked', pk.pieces.rivals.every((r) => !('website' in r)));
  ok('the AI piece says plainly it is not switched on', pk.pieces.ai.summary === null && /isn’t switched on/.test(pk.pieces.ai.note));
}

// ═══ the public read: the token is the whole key ═══
{
  const pk = packs()[0];
  const r = await res(await PP.handlePackPublic(pk.token, cors));
  ok('the pack reads publicly by its token', r.status === 200 && r.body.data.business_name === 'Old Diner' && r.body.data.town === 'Burbank');
  ok('it carries you, two rivals and the AI note', r.body.data.you.summary.overall === 41 && r.body.data.rivals.length === 2 && r.body.data.ai.summary === null);
  ok('and the studio brand rides along', !!r.body.data.brand && typeof r.body.data.brand.name === 'string');
  const bad = await res(await PP.handlePackPublic('f'.repeat(32), cors));
  ok('a made-up token is nothing', bad.status === 404);
  const weird = await res(await PP.handlePackPublic('DROP TABLE;--', cors));
  ok('a non-token is nothing', weird.status === 404);
}

// ═══ a building pack is not public yet ═══
{
  const pk = packs()[0];
  await pg(`https://db.test/rest/v1/presence_pitch_packs?id=eq.${pk.id}`, { method: 'PATCH', headers: { Authorization: 'Bearer svc-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'building' }) });
  const r = await res(await PP.handlePackPublic(pk.token, cors));
  ok('a half-built pack answers 404, not half a page', r.status === 404);
  await pg(`https://db.test/rest/v1/presence_pitch_packs?id=eq.${pk.id}`, { method: 'PATCH', headers: { Authorization: 'Bearer svc-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ready' }) });
}

// ═══ rebuild: same token, fresh pieces ═══
{
  const before = packs()[0].token;
  const r = await res(await PP.handleProspectPack(req({ rebuild: true }), site, owner, P_DINER, cors));
  ok('rebuild starts the pack over without breaking the sent link', r.status === 200 && r.body.data.state === 'building' && packs()[0].token === before && packs().length === 1);
}

// ═══ no website: the pack still finishes, and says the quiet part ═══
{
  world();
  let last = null;
  for (let i = 0; i < 6; i++) { const r = await res(await PP.handleProspectPack(req({}), site, owner, P_FADES, cors)); last = r.body.data; if (last.state === 'ready') break; }
  const pk = packs()[0];
  ok('a prospect with no website gets a finished pack', last.state === 'ready' && pk.pieces.you.summary === null);
  ok('…whose note IS the pitch', /no working website — which is the whole story/.test(pk.pieces.you.note));
}

// ═══ a stale report is not reused: the real engine runs on faked fetchers ═══
{
  world({ tool_reports: [report('https://old-diner.example/', 41, 'site_review', staleAt)] });
  const HOME = '<!doctype html><html><head><title>Old Diner — Burbank</title><meta name="viewport" content="width=device-width"><meta name="description" content="Diner"></head><body><h1>Old Diner</h1><p>Call us: (818) 555-0101. 2 Main St, Burbank.</p></body></html>';
  PP.packDeps.scan = {
    guard: async () => {},
    siteFetch: async (u) => (String(u).endsWith('/') || !/\.[a-z]+$/.test(new URL(String(u)).pathname)
      ? new Response(HOME, { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response('', { status: 404 })),
    psiFetch: async () => new Response('{}', { status: 500 }),
    claudeFetch: async () => new Response('{}', { status: 500 }),
  };
  const r = await res(await PP.handleProspectPack(req({}), site, owner, P_DINER, cors));
  const pk = packs()[0];
  ok('a 45-day-old report is re-run, and the new one is saved for every tool', r.status === 200 && pk.pieces.you.summary && Number.isFinite(pk.pieces.you.summary.overall) && reports().length === 2, JSON.stringify(pk.pieces.you) + ' reports:' + reports().length);
  ok('the new report is marked unlocked (the studio bought it)', reports()[1].unlocked === true);
  PP.packDeps.scan = undefined;
}

// ═══ before APPLY-0149 the page says so, plainly ═══
{
  world();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.includes('presence_pitch_packs')) return new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return real(url, init);
  };
  const r = await res(await PP.handleProspectPack(req({}), site, owner, P_DINER, cors));
  ok('before the database update, the build answers 503 with a plain sentence', r.status === 503 && /one-time database update/.test(r.body.message));
  globalThis.fetch = real;
}

// ═══ tripwire: nothing on this surface can send email ═══
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/pitch_pack.ts', import.meta.url));
  ok('the pack routes import no email sender at all', !/sendEmail|resend|broadcast/i.test(src.replace(/\/\/[^\n]*/g, '')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
