// ── A deletion request must be raisable TWICE ────────────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/deletion_rerequest_test.mjs
//
// The gap this pins: POST /commerce/delete-request raised its notice with a
// LITERAL period of 'once', and POST /commerce/delete-cancel DISMISSES that row
// rather than deleting it. raiseNotice inserts with
// `on_conflict=client_id,kind,period` + `resolution=ignore-duplicates`, so the
// surviving dismissed row kept the key forever: every LATER request returned
// created=false and produced NO notice, NO bell row, NO Today row, NO push —
// silently. Pre-existing, but load-bearing since `deletion_requested` joined
// NOTICE_PROTECTED_KINDS (lib/inbox_feed.ts): the one kind that may never be
// hidden was also the one kind that could never be raised a second time.
//
// The fix: the dedupe scope is the OPEN REQUEST'S OWN ROW ID (`del:<uuid>`) —
// exactly what lib/notice.ts documents `period` to be ("a stable event id").
// 'once' was only ever correct if an account could be deleted once ever; cancel
// exists because it cannot. Nothing is hard-deleted, so a CANCELLED request's
// row stays dismissed under its own key and can never be resurrected.
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('ACCOUNT_DELETION_DAYS', '30');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const commerceSrc = read('supabase/functions/presence/routes/commerce.ts');
const deletionSrc = read('supabase/functions/presence/commerce/deletion.ts');
const feed = read('supabase/functions/presence/lib/inbox_feed.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const CLIENT = 'cccccccc-1111-4111-8111-cccccccccccc';
const SITE = '11111111-1111-4111-8111-111111111111';

// ═══ 1. Structural: the dedupe key is per-request, and cancel still dismisses ═
{
  ok('delete-request no longer raises the deletion notice under a literal \'once\'',
    !/kind: 'deletion_requested', period: 'once'/.test(commerceSrc));
  ok('delete-request keys the notice on the open request\'s own row id',
    /kind: 'deletion_requested', period: reqd\.id \? `del:\$\{reqd\.id\}` : 'once'/.test(commerceSrc));
  ok('requestDeletion returns that id — for a NEW insert and for an idempotent re-click alike',
    /created: boolean; id: string \| null/.test(deletionSrc)
    && /if \(open\) return \{ ok: true, scheduled_for: open\.scheduled_for, created: false, id: open\.id/.test(deletionSrc)
    && /id: row\?\.id \? String\(row\.id\) : null/.test(deletionSrc));
  ok('cancel still DISMISSES rather than deletes (the row is the record it was withdrawn)',
    /kind=eq\.deletion_requested&status=eq\.active`, \{ method: 'PATCH', body: JSON\.stringify\(\{ status: 'dismissed' \}\) \}/.test(commerceSrc));
  ok('cancel dismisses EVERY active deletion notice for the client, whatever its period',
    !/kind=eq\.deletion_requested&status=eq\.active&period=/.test(commerceSrc));
  ok('deletion_requested is still a protected kind, and cancel is still named as its teardown',
    /'deletion_requested'/.test(feed) && /deletion_requested\s+← POST \/commerce\/delete-cancel/.test(feed));
}

// ═══ A fake PostgREST — including the on-conflict semantics raiseNotice needs ═
const world = { sites: [], clients: [], deletions: [], notices: [], entitlements: [], escaped: [] };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const matches = (row, key, expr) => {
  if (expr === 'is.null') return row[key] === null || row[key] === undefined;
  if (expr === 'is.notnull') return row[key] !== null && row[key] !== undefined;
  const [op, ...rest] = expr.split('.');
  const want = decodeURIComponent(rest.join('.'));
  if (op === 'eq') return String(row[key]) === want;
  if (op === 'neq') return String(row[key]) !== want;
  if (op === 'in') return want.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(row[key]));
  throw new Error('fake PostgREST does not speak: ' + key + '=' + expr);
};
const TABLES = {
  presence_sites: 'sites', clients: 'clients', presence_account_deletions: 'deletions',
  presence_plan_notices: 'notices', presence_entitlements: 'entitlements',
};
let uid = 0;
let breakDeletionInsert = false;   // F5 hook — see section 9
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  if (u.hostname !== 'example.supabase.co' || !TABLES[table]) { world.escaped.push(url); return Promise.resolve(jres(500, { error: 'escaped the fake' })); }
  const bucket = world[TABLES[table]];
  const method = (init?.method || 'GET').toUpperCase();
  const filtered = () => {
    let out = bucket.slice();
    for (const [key, expr] of u.searchParams) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset' || key === 'on_conflict') continue;
      out = out.filter((r) => matches(r, key, expr));
    }
    const lim = Number(u.searchParams.get('limit'));
    return (Number.isFinite(lim) && lim > 0) ? out.slice(0, lim) : out;
  };
  if (method === 'GET') return Promise.resolve(jres(200, filtered()));
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    // F5: let a test make the deletion INSERT fail — the one outcome the route
    // never used to look at.
    if (table === 'presence_account_deletions' && breakDeletionInsert) return Promise.resolve(jres(500, { message: 'insert exploded' }));
    const conflict = u.searchParams.get('on_conflict');
    const prefer = String((init.headers || {}).Prefer || '');
    if (conflict && /ignore-duplicates/.test(prefer)) {
      // THE BEHAVIOUR THE WHOLE GAP TURNS ON: a row already holding the unique
      // key is not inserted and NOTHING is returned — so raiseNotice's `created`
      // is false and every downstream effect (row, bell, push, email) is skipped.
      // The dismissed row still holds the key.
      const cols = conflict.split(',');
      if (bucket.some((r) => cols.every((c) => String(r[c]) === String(body[c])))) return Promise.resolve(jres(201, []));
    }
    const row = { id: body.id || `row-${++uid}`, ...body };
    bucket.push(row);
    return Promise.resolve(jres(201, [row]));
  }
  if (method === 'PATCH') {
    const patch = JSON.parse(init.body);
    const hit = filtered();
    for (const r of hit) Object.assign(r, patch);
    return Promise.resolve(jres(200, hit));
  }
  return Promise.resolve(jres(405, { error: 'method not allowed in the fake' }));
};

const { handleCommerce } = await import('../../supabase/functions/presence/routes/commerce.ts');
const PRINCIPAL = { kind: 'client', email: 'owner@example.com', userId: 'u1', jwt: 'jwt-token', tenantId: null, role: null, requestId: 'r1' };
const call = async (route) => {
  const req = new Request(`https://api.example/presence${route}`, { method: 'POST', headers: { 'x-dds-user-jwt': 'jwt-token', 'content-type': 'application/json' }, body: '{}' });
  const r = await handleCommerce(req, route, 'POST', PRINCIPAL, {});
  return { status: r.status, body: await r.json() };
};
const request = () => call('/commerce/delete-request');
const cancel = () => call('/commerce/delete-cancel');

const seed = () => {
  uid = 0;
  world.sites = [{ id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' }];
  world.clients = [{ id: CLIENT, name: 'Rivera Studio' }];   // no email: the confirmation email path is not what this suite is about
  world.deletions = []; world.notices = []; world.entitlements = [{ client_id: CLIENT, product: 'presence' }];
  world.escaped = [];
};
const activeNotices = () => world.notices.filter((n) => n.kind === 'deletion_requested' && n.status === 'active');
const allNotices = () => world.notices.filter((n) => n.kind === 'deletion_requested');
const openDeletions = () => world.deletions.filter((d) => d.status === 'pending' || d.status === 'executing');

// ═══ 2. FIRST request → one open request, one ACTIVE notice ═════════════════
{
  seed();
  const r1 = await request();
  ok('first request: 200', r1.status === 200, JSON.stringify(r1.body));
  ok('first request: it is not reported as already pending', r1.body?.data?.already_pending === false);
  ok('first request: one open deletion row', openDeletions().length === 1);
  ok('first request: one ACTIVE deletion notice', activeNotices().length === 1, JSON.stringify(world.notices));
  ok('first request: the notice is keyed to THIS request, not a literal \'once\'',
    activeNotices()[0]?.period === `del:${openDeletions()[0].id}` && activeNotices()[0]?.period !== 'once');
  ok('first request: the notice is scoped to the client and the site', activeNotices()[0]?.client_id === CLIENT && activeNotices()[0]?.site_id === SITE);
}

// ═══ 3. An idempotent RE-CLICK must NOT mint a second row or a second push ══
{
  seed();
  await request();
  const again = await request();
  ok('re-click while pending: reported as already pending', again.body?.data?.already_pending === true);
  ok('re-click while pending: still ONE open deletion row', openDeletions().length === 1);
  ok('re-click while pending: still ONE notice row (the dedupe key still works)', allNotices().length === 1);
}

// ═══ 4. CANCEL → the request is canceled and the notice goes quiet ══════════
{
  seed();
  await request();
  const c = await cancel();
  ok('cancel: 200 and reported canceled', c.status === 200 && c.body?.data?.canceled === true, JSON.stringify(c.body));
  ok('cancel: the deletion row is canceled', world.deletions[0]?.status === 'canceled' && openDeletions().length === 0);
  ok('cancel: no ACTIVE deletion notice remains', activeNotices().length === 0);
  ok('cancel: the row is DISMISSED, not deleted — the history that it was raised survives',
    allNotices().length === 1 && allNotices()[0].status === 'dismissed');
}

// ═══ 5. THE GAP: a SECOND request after a cancel must raise properly ════════
{
  seed();
  await request();
  const firstPeriod = allNotices()[0].period;
  await cancel();
  const r2 = await request();

  ok('re-request: 200', r2.status === 200, JSON.stringify(r2.body));
  ok('re-request: it is a NEW request, not an idempotent no-op', r2.body?.data?.already_pending === false);
  ok('re-request: a new open deletion row exists', openDeletions().length === 1);
  // THE ASSERTION THE GAP FAILED: silently, there was no notice at all.
  ok('re-request: a NEW ACTIVE notice exists (the bell/Today/push actually fire)', activeNotices().length === 1, JSON.stringify(world.notices));
  ok('re-request: it is a genuinely different row under a different key',
    allNotices().length === 2 && activeNotices()[0].period !== firstPeriod);
  ok('re-request: the new notice is keyed to the NEW request', activeNotices()[0]?.period === `del:${openDeletions()[0].id}`);
  ok('re-request: the notice carries a real headline and body (a raised row, not a husk)',
    /deletion request/i.test(activeNotices()[0]?.headline || '') && (activeNotices()[0]?.body || '').length > 20);
}

// ═══ 6. A CANCELLED request is never resurrected as an active notice ═══════
{
  seed();
  await request();
  const cancelled = allNotices()[0];
  await cancel();
  await request();          // re-raise
  ok('the CANCELLED request\'s own notice row stays dismissed forever', cancelled.status === 'dismissed');
  ok('the cancelled request\'s deletion row stays canceled', world.deletions.filter((d) => d.status === 'canceled').length === 1);
  ok('exactly ONE deletion notice is active — the live request\'s', activeNotices().length === 1 && activeNotices()[0] !== cancelled);

  // …and cancelling the SECOND request takes the second row down too, so the
  // cycle is closed rather than one-shot.
  const c2 = await cancel();
  ok('cancelling the second request works too (the cycle closes)', c2.body?.data?.canceled === true);
  ok('after the second cancel: NO active deletion notice at all', activeNotices().length === 0);
  ok('after the second cancel: both rows survive as dismissed history', allNotices().length === 2 && allNotices().every((n) => n.status === 'dismissed'));
  ok('after the second cancel: no open deletion request remains', openDeletions().length === 0);
}

// ═══ 7. Third time round — this is a cycle, not a one-off fix ══════════════
{
  seed();
  for (let i = 0; i < 3; i++) { await request(); await cancel(); }
  const r = await request();
  ok('a FOURTH request still raises a fresh active notice', r.status === 200 && activeNotices().length === 1);
  ok('every prior request left exactly one dismissed row behind', allNotices().length === 4 && allNotices().filter((n) => n.status === 'dismissed').length === 3);
  ok('no request escaped the fake PostgREST', world.escaped.length === 0, world.escaped[0] || '');
}

// ═══ 8. Cancel with nothing pending is a truthful no-op ════════════════════
{
  seed();
  const c = await cancel();
  ok('cancel with no pending request: reported as not canceled', c.status === 200 && c.body?.data?.canceled === false);
  ok('cancel with no pending request: nothing was touched', world.notices.length === 0 && world.deletions.length === 0);
}

// ═══ 9. F5: an insert that FAILED must never be reported as recorded ══════
// Pre-existing, and cheap: the route never looked at `reqd.ok`. When the
// presence_account_deletions insert failed it still told the client "Your
// deletion request is recorded" and returned {ok:true}, and it still raised the
// notice — under the `reqd.id ? ... : 'once'` fallback, because there was no row
// to key on. `deletion_requested` is a PROTECTED kind (lib/inbox_feed.ts): the
// operator cannot dismiss it by hand. So a failed insert could strand an ACTIVE,
// undismissable "your account will be deleted" row with no deletion behind it
// and no cancel path to take it down (cancelDeletion finds no pending row, so
// `done` is false and the dismiss never runs).
//
// The route now refuses instead: nothing written, nothing claimed, 502 and an
// honest message. The per-request period change above already narrows the
// stranding — a later successful request keys on its own row id rather than
// colliding with the stranded 'once' — but "we recorded it" was still a lie, and
// this is the assertion that makes it one the suite can catch.
{
  seed();
  breakDeletionInsert = true;
  const r = await request();
  breakDeletionInsert = false;

  ok('insert failed: the route does NOT return 200 ok', r.status !== 200, `status ${r.status} body ${JSON.stringify(r.body)}`);
  ok('insert failed: it is a 502 — an upstream write that did not happen', r.status === 502, String(r.status));
  ok('insert failed: it never claims the request is recorded', !/recorded/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  ok('insert failed: the message tells the customer nothing changed and to try again',
    /nothing/i.test(r.body?.message || '') && /again/i.test(r.body?.message || ''), JSON.stringify(r.body));
  ok('insert failed: no deletion row exists', world.deletions.length === 0, JSON.stringify(world.deletions));
  ok('insert failed: NO protected notice is stranded (it could never be dismissed by hand)',
    allNotices().length === 0, JSON.stringify(world.notices));

  // …and the failure wedges nothing: the very next attempt behaves normally.
  const good = await request();
  ok('after a failed attempt, a retry records the request properly', good.status === 200 && openDeletions().length === 1, JSON.stringify(good.body));
  ok('after a failed attempt, the retry\u2019s notice is keyed to ITS row (never the \'once\' fallback)',
    activeNotices().length === 1 && activeNotices()[0].period === `del:${openDeletions()[0].id}`, JSON.stringify(world.notices));
  ok('no request escaped the fake PostgREST', world.escaped.length === 0, world.escaped[0] || '');
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log('  - ' + f.n); Deno.exit(1); }
