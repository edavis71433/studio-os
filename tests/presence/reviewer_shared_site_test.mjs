// ── Nov 2026 review, client portal finding 5 ──
//   deno run --allow-read --allow-env tests/presence/reviewer_shared_site_test.mjs
// A reviewer seat on a studio's shared site (one that holds work for clients)
// can't be added, and an existing one neither sees nor decides the waiting files
// there, because a reviewer is tied to a site, not to a project. (Findings 1 and
// 4, the reset link and the studio door, are PR 249's.)
// Against a stubbed PostgREST: no Supabase, no credentials, no outside call.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ── the stub: service links decide "shared"; media and seats are recorded ──
const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
let shared = 'yes';   // 'yes' | 'no' | 'fail'
let writes = [];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  if (method !== 'GET') writes.push(`${method} ${table}`);
  if (table === 'presence_service_links') return shared === 'fail' ? reply({ message: 'boom' }, 500) : reply(shared === 'yes' ? [{ id: 'l1' }] : []);
  if (table === 'presence_media') return reply(method === 'GET' ? [{ id: FILE, site_id: SITE, asset_status: 'pending', metadata: {} }] : [{ id: FILE }]);
  if (table === 'presence_site_members') return reply([]);
  return reply([]);
};

const P = '../../supabase/functions/presence';
const { isSharedStudioSite, addSiteMember } = await import(`${P}/lib/workspace.ts`);
const { handleAssetStatus } = await import(`${P}/routes/assets.ts`);
const site = { id: SITE, client_id: 'cccccccc-3333-4333-8333-cccccccccccc', status: 'live', edition: 'presence' };
const reviewer = () => ({ kind: 'client', userId: 'u-rev', email: 'rev@example.com', jwt: 'jwt-rev', requestId: 't', member: { site_id: SITE, role: 'client_reviewer' } });
const owner = () => ({ kind: 'client', userId: 'u-own', email: 'own@example.com', jwt: 'jwt-own', requestId: 't', member: { site_id: SITE, role: 'business_owner' } });
const decide = async (who, action = 'approve') => {
  writes = [];
  const res = await handleAssetStatus(new Request('http://x', { method: 'POST', body: JSON.stringify({ action }) }), site, who, FILE, {});
  return { status: res.status, body: await res.json().catch(() => null), wrote: writes.filter((w) => w.endsWith('presence_media')).length };
};

// shared or not
shared = 'yes'; ok('a site named as the studio side of an active link is shared', (await isSharedStudioSite(SITE)) === true);
shared = 'no'; ok('a site with no such link is not', (await isSharedStudioSite(SITE)) === false);
shared = 'fail'; ok('a failed read says it does not know', (await isSharedStudioSite(SITE)) === null);

// finding 5: a reviewer's decision on a shared site
shared = 'yes';
{
  const r = await decide(reviewer());
  ok('a reviewer on a shared studio site is refused, and nothing is written', r.status === 403 && r.body?.error === 'forbidden' && r.wrote === 0, `${r.status} ${r.wrote}`);
  ok('…with a sentence that says who decides', /approved by the studio/.test(String(r.body?.message)));
}
shared = 'fail';
ok('a reviewer is refused when the check fails (closed, not open)', (await decide(reviewer())).status === 403);
shared = 'no';
ok('a reviewer on a client’s own site still decides', (await decide(reviewer())).status !== 403);
shared = 'yes';
ok('the studio still decides on its own shared site', (await decide(owner())).status !== 403);
ok('a reviewer still may not publish anywhere', (await decide(reviewer(), 'publish')).status === 403);

// finding 5: no new reviewer seats on a shared site
shared = 'yes';
writes = [];
ok('a reviewer seat on a shared studio site is refused, nothing written', (await addSiteMember(SITE, 'rev@example.com', 'client_reviewer', 'owner')).error === 'shared_site' && !writes.some((w) => w.endsWith('presence_site_members')));
shared = 'fail';
ok('…and when the check fails, nobody is added', (await addSiteMember(SITE, 'rev@example.com', 'client_reviewer', 'owner')).error === 'check_failed');
shared = 'no';
writes = [];
ok('a reviewer seat on a client’s own site is added', (await addSiteMember(SITE, 'rev@example.com', 'client_reviewer', 'owner')).ok === true && writes.some((w) => w.endsWith('presence_site_members')));
shared = 'yes';
ok('a staff seat on the shared site is unaffected', (await addSiteMember(SITE, 'staff@example.com', 'business_staff', 'owner')).ok === true);

// finding 5: the feed and the badge leave the files out for such a reviewer
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the feed hides waiting files from a reviewer on a shared site', /const filesHidden = role === 'client_reviewer' \? \(await isSharedStudioSite\(site\.id\)\) !== false : false;/.test(ws) && /fileQ\.ok && !filesHidden && fileQ\.json/.test(ws));
ok('the badge does not count them either', /filesPending: role === 'client_reviewer' && \(await isSharedStudioSite\(site\.id\)\) !== false \? 0 :/.test(ws));
ok('the add-a-person answer says what to do instead', /Open that client and invite the reviewer there instead\./.test(ws));

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
