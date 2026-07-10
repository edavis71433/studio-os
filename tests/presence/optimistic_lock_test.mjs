// ── Client UX safety (Presence CMS Phase 1, M9) ──────────────────────────────
//   deno run --allow-read --allow-env tests/presence/optimistic_lock_test.mjs
// Pure optimistic-lock logic + the reused "what will change" diff engine +
// structural wiring. No network.
const L = await import('../../supabase/functions/presence/lib/optimistic_lock.ts');
const { readIfMatch, preconditionOutcome, staleConflictBody } = L;
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
  ok('wiring: the editor sends If-Match through the ONE shared api() helper', /If-Match.*S\.draftHash/.test(html));
  ok('wiring: the editor handles a stale_draft 409 (reload latest, never overwrite)', /error === "stale_draft"/.test(html) && /S\.draftHash = \(j && j\.current_hash\)/.test(html));
  ok('wiring: the editor seeds + refreshes its held hash from /changes', /S\.draftHash = c\.data\.draft_hash|c\.data && c\.data\.draft_hash/.test(html));

  const lock = read('supabase/functions/presence/lib/optimistic_lock.ts');
  ok('tenant: the guard hashes THIS site (site-scoped via draftHashForSite)', /draftHashForSite\(site\)/.test(lock));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ OPTIMISTIC LOCK + UX SAFETY (M9): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
