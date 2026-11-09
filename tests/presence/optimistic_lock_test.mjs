// ── Client UX safety (Presence CMS Phase 1, M9) ──────────────────────────────
//   deno run --allow-read --allow-env tests/presence/optimistic_lock_test.mjs
// Pure optimistic-lock logic + the reused "what will change" diff engine +
// structural wiring. No network.
const L = await import('../../supabase/functions/presence/lib/optimistic_lock.ts');
const { readIfMatch, preconditionOutcome, staleConflictBody, guardStaleDraft, movesDraft, noteDraftBefore, withDraftVersion, DRAFT_VERSION_HEADER } = L;
const D = await import('../../supabase/functions/presence/lib/diff.ts');
const { describeChanges } = D;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const reqWith = (ifMatch) => new Request('http://x/', ifMatch === undefined ? {} : { headers: { 'If-Match': ifMatch } });

// ── readIfMatch: parse the precondition header ──
ok('read: absent → null (no precondition)', readIfMatch(reqWith(undefined)) === null);
ok('read: plain hash → value', readIfMatch(reqWith('abc123')) === 'abc123');
ok('read: quoted ETag → unquoted', readIfMatch(reqWith('"abc123"')) === 'abc123');
ok('read: weak validator W/"x" → x', readIfMatch(reqWith('W/"abc123"')) === 'abc123');
ok('read: wildcard * → *', readIfMatch(reqWith('*')) === '*');

// ── preconditionOutcome: the decision ──
ok('outcome: no header → skip (backward compatible)', preconditionOutcome(null, 'H') === 'skip');
ok('outcome: wildcard → skip', preconditionOutcome('*', 'H') === 'skip');
ok('outcome: empty → skip', preconditionOutcome('', 'H') === 'skip');
ok('outcome: uncomputable current hash → skip (fail-open, never block a save)', preconditionOutcome('H', null) === 'skip');
ok('outcome: matching hash → match (proceed)', preconditionOutcome('H', 'H') === 'match');
ok('outcome: different hash → STALE (refuse, no silent overwrite)', preconditionOutcome('OLD', 'NEW') === 'stale');

// ── staleConflictBody: the 409 payload carries the current hash ──
{
  const b = staleConflictBody('CUR');
  ok('conflict: error=stale_draft', b.error === 'stale_draft');
  ok('conflict: carries current_hash so the client can refresh + reapply', b.current_hash === 'CUR');
  ok('conflict: has a plain-language message', typeof b.message === 'string' && b.message.length > 20);
}

// ── the REUSED "what will change" engine (describeChanges) — real changes only ──
const content = (over = {}) => ({ identity: { business_name: 'Cafe' }, locations: [], offerings: [], testimonials: [], faqs: [], posts: [], settings: {}, ...over });
{
  // first publish (no live) → summarized, flagged first_publish
  const first = describeChanges(content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks' }] }), null);
  ok('diff: first publish flagged + non-empty', first.first_publish === true && first.count > 0);

  // no changes → nothing to publish
  const same = content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks' }] });
  const none = describeChanges(same, same);
  ok('diff: identical draft vs live → zero changes (summarizes only ACTUAL changes)', none.count === 0 && none.first_publish === false);

  // added offering
  const added = describeChanges(content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks' }] }), content({ offerings: [] }));
  ok('diff: an added menu item is reported (section offerings)', added.count === 1 && added.changes[0].section === 'offerings' && /Latte/.test(added.changes[0].sentence));

  // removed offering
  const removed = describeChanges(content({ offerings: [] }), content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks' }] }));
  ok('diff: a removed menu item is reported', removed.count === 1 && /off the menu/i.test(removed.changes[0].sentence));

  // renamed (change, not add+remove)
  const renamed = describeChanges(content({ offerings: [{ id: 'o1', name: 'Flat White', category: 'Drinks' }] }), content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks' }] }));
  ok('diff: a rename is one change tied to the same entity id', renamed.count === 1 && renamed.changes[0].entity_id === 'o1' && /renamed/i.test(renamed.changes[0].sentence));

  // identity change
  const idChg = describeChanges(content({ identity: { business_name: 'New Cafe' } }), content({ identity: { business_name: 'Cafe' } }));
  ok('diff: a business-name change is reported (section business)', idChg.count === 1 && idChg.changes[0].section === 'business');

  // determinism
  const draftD = content({ offerings: [{ id: 'o1', name: 'Latte', category: 'Drinks' }, { id: 'o2', name: 'Tea', category: 'Drinks' }] });
  const liveD = content({ offerings: [{ id: 'o1', name: 'Espresso', category: 'Drinks' }] });
  ok('diff: deterministic — identical inputs → identical output', JSON.stringify(describeChanges(draftD, liveD)) === JSON.stringify(describeChanges(draftD, liveD)));
}

// ── structural wiring ──
{
  const cont = read('supabase/functions/presence/routes/content.ts');
  ok('wiring: collection writes are optimistic-locked', /guardStaleDraft\(req, site, cors\)/.test(cont) && /POST' \|\| method === 'PUT' \|\| method === 'PATCH' \|\| method === 'DELETE'/.test(cont));
  ok('wiring: settings/location singleton PUT is optimistic-locked', (cont.match(/guardStaleDraft\(req, site, cors\)/g) || []).length >= 2);

  const idn = read('supabase/functions/presence/routes/identity.ts');
  ok('wiring: identity PUT is optimistic-locked', /guardStaleDraft\(req, site, cors\)/.test(idn));

  const pub = read('supabase/functions/presence/routes/publish.ts');
  ok('wiring: publish accepts If-Match (publish exactly what you reviewed)', /readIfMatch\(req\)/.test(pub) && /computeDraftHash\(snapshot\)/.test(pub) && /preconditionOutcome\(/.test(pub));

  const room = read('supabase/functions/presence/routes/room.ts');
  ok('wiring: /changes exposes draft_hash (the version to publish with)', /draft_hash: st\.draftHash/.test(room) && /computeDraftHash\(snapshot\)/.test(room));

  const html = read('presence.html');
  ok('wiring: the editor sends If-Match through the ONE shared api() helper', /const version = named !== undefined \? named : S\.draftHash;/.test(html) && /"If-Match": version/.test(html));
  ok('wiring: the editor handles a stale_draft 409 (reload latest, never overwrite)', /error === "stale_draft"/.test(html) && /scheduleChangesRefresh\(\);\s+const lc = j\.last_change/.test(html));
  // a write waiting behind a refused one was built without the other person's change
  ok('wiring: a refusal doesn\'t hand the page the new version', !/S\.draftHash = \(j && j\.current_hash\)/.test(html));
  // Two writes out at once name the same version, and the first to land refuses the other
  const line = new Function('return ' + html.match(/const DRAFT_WRITE = (\/.+\/);/)[1])();
  for (const r of ['/settings', '/identity', '/location', '/offerings', '/offerings/1', '/faqs/1', '/testimonials/1', '/posts/1', '/pages/duplicate']) ok(`line: ${r} is checked against the version, so it waits its turn`, line.test(r));
  for (const r of ['/media/1', '/media/upload-url', '/redirects', '/redirects/1', '/dev/customization', '/dev/brand-kit', '/dev/brand-kit/apply', '/site/template', '/reviews/1/approve', '/publishes/checkpoints/1/restore', '/restore-to-draft', '/writer/drafts/1/accept']) ok(`line: ${r} moves the version, so it waits its turn`, line.test(r));
  for (const r of ['/publish', '/writer/generate', '/editor/improve', '/concierge/ask', '/reviews/request', '/publishes/checkpoints', '/writer/drafts/1/discard', '/settings-other']) ok(`line: ${r} stays out of it`, !line.test(r));
  ok('wiring: the editor seeds + refreshes its held hash from /changes', /S\.draftHash = c\.data\.draft_hash|c\.data && c\.data\.draft_hash/.test(html));

  const lock = read('supabase/functions/presence/lib/optimistic_lock.ts');
  // The server answers a write with the version it left for the routes the page sends one
  // at a time: the same list, or an answer would land out of turn and take back a version.
  ok('wiring: the server\'s draft-moving routes are the page\'s DRAFT_WRITE', String(L.DRAFT_WRITE) === String(line));
  const idx = read('supabase/functions/presence/index.ts');
  ok('wiring: every answer goes through withDraftVersion', /return await withDraftVersion\(req, await route_\(req, cors\)\)/.test(idx));
  ok('wiring: the draft is looked at before the router runs a write', /await noteDraftBefore\(req, route, site\);\s*\n\s*\/\/ 5\. router/.test(idx));
  ok('wiring: the page holds the version a write\'s answer names', /r\.headers\.get\("X-Draft-Version"\)/.test(html));
  ok('wiring: a read\'s version is taken only when the page holds none, or with a full load', /c\.data\.draft_hash && \(DRAFT_SEED \|\| !S\.draftHash\)/.test(html) && /DRAFT_SEED = true;/.test(html));
  ok('wiring: Publish names what was reviewed without the page taking it', /REVIEWED && !S\.draftHash/.test(html) && /api\("POST", "\/publish", undefined, REVIEWED \|\| S\.draftHash\)/.test(html) && !/S\.draftHash = c\.draft_hash/.test(html));
  ok('tenant: the guard hashes THIS site (site-scoped via readDraft)', /await draftVersionBefore\(req, site\)/.test(lock) && /read: DraftReader = readDraft\)/.test(lock) && /read: read\(site\)/.test(lock));
}

// ── the version a write leaves (Nov 2026): no network, the hash is a stub ──
{
  const site = { id: 's1', template_slug: 't', template_version: '1' };
  const cors = { 'Access-Control-Allow-Origin': 'https://x' };
  const put = (route, ifMatch, method = 'PUT') => new Request('http://x/functions/v1/presence' + route, { method, headers: ifMatch === undefined ? {} : { 'If-Match': ifMatch } });
  const answer = (status = 200) => new Response(JSON.stringify({ data: { ok: true } }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  // the draft as the stub reads it: `now` before the write, `after` once it lands
  const draftAt = () => { const d = { now: 'V0', calls: 0 }; d.read = async () => { d.calls++; return { hash: d.now }; }; return d; };

  for (const r of ['/settings', '/identity', '/offerings/1', '/media/1', '/redirects', '/dev/brand-kit', '/restore-to-draft']) ok(`moves: ${r}`, movesDraft('PUT', r) && movesDraft('post', r));
  for (const r of ['/publish', '/notes', '/writer/generate', '/publishes/checkpoints', '/reviews/request']) ok(`moves: ${r} doesn't`, !movesDraft('POST', r));
  ok('moves: a read never does', !movesDraft('GET', '/settings'));

  {
    const d = draftAt(); const req = put('/settings', 'V0');
    await noteDraftBefore(req, '/settings', site, d.read);
    d.now = 'V1';   // the write lands
    const res = await withDraftVersion(req, answer(), d.read);
    ok('answer: the draft where the caller said → the version the write left', res.headers.get(DRAFT_VERSION_HEADER) === 'V1');
    ok('answer: a cross-origin page may read it', res.headers.get('Access-Control-Expose-Headers') === DRAFT_VERSION_HEADER);
    ok('answer: status, body and CORS pass through', res.status === 200 && (await res.json()).data.ok === true && res.headers.get('Access-Control-Allow-Origin') === 'https://x');
    ok('answer: two hashes, one each side of the write', d.calls === 2);
  }
  {
    const d = draftAt(); d.now = 'V0-theirs'; const req = put('/media/1', 'V0');
    await noteDraftBefore(req, '/media/1', site, d.read);
    d.now = 'V1';
    const res = await withDraftVersion(req, answer(), d.read);
    ok('answer: the draft had moved without the caller (an unchecked route) → the caller\'s own version back, so its next checked write is refused', res.headers.get(DRAFT_VERSION_HEADER) === 'V0');
    ok('answer: and no second hash for it', d.calls === 1);
  }
  {
    const d = draftAt(); const req = put('/settings', 'V0');
    await noteDraftBefore(req, '/settings', site, d.read);
    const res = await withDraftVersion(req, answer(422), d.read);
    ok('answer: a write that failed names nothing', res.headers.get(DRAFT_VERSION_HEADER) === null && res.status === 422);
  }
  {
    const d = draftAt(); const req = put('/settings', undefined);
    await noteDraftBefore(req, '/settings', site, d.read);
    const res = await withDraftVersion(req, answer(), d.read);
    ok('answer: a write that named no version isn\'t looked at, and names nothing', d.calls === 0 && res.headers.get(DRAFT_VERSION_HEADER) === null);
  }
  {
    const d = draftAt(); const req = put('/notes', 'V0', 'POST');
    await noteDraftBefore(req, '/notes', site, d.read);
    const a = answer(); const res = await withDraftVersion(req, a, d.read);
    ok('answer: a write that doesn\'t move the draft is passed through untouched', res === a && d.calls === 0);
  }
  {
    const req = put('/settings', 'V0');
    await noteDraftBefore(req, '/settings', site, async () => { throw new Error('db down'); });
    const a = answer(); const res = await withDraftVersion(req, a, async () => ({ hash: 'V1' }));
    ok('answer: a hash that failed before the write lets the write through, naming nothing', res === a);
  }
  {
    const d = draftAt(); const req = put('/settings', 'V0');
    await noteDraftBefore(req, '/settings', site, d.read);
    const a = answer(); const res = await withDraftVersion(req, a, async () => { throw new Error('db down'); });
    ok('answer: a hash that failed after the write names nothing', res === a);
  }
  {
    const req = put('/settings', 'V0');
    await noteDraftBefore(req, '/settings', site, async () => null);
    const a = answer(); const res = await withDraftVersion(req, a, async () => ({ hash: 'V1' }));
    ok('answer: no template to hash with names nothing', res === a);
  }
  {
    const d = draftAt(); const req = put('/settings', 'V0');
    await noteDraftBefore(req, '/settings', site, d.read);
    const stale = await guardStaleDraft(req, site, cors);
    ok('guard: reuses the hash taken before the router (no second serialize)', stale === null && d.calls === 1);
    const req2 = put('/settings', 'OLD');
    const d2 = draftAt(); await noteDraftBefore(req2, '/settings', site, d2.read);
    const refused = await guardStaleDraft(req2, site, cors);
    ok('guard: still refuses a version the draft has left', refused !== null && refused.status === 409 && (await refused.json()).current_hash === 'V0' && d2.calls === 1);
  }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ OPTIMISTIC LOCK + UX SAFETY (M9): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
