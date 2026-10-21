// ── Speak as the studio when acting for a client (studio audit Oct 2026, change 2) ──
//   deno run --allow-read --allow-env tests/presence/studio_voice_test.mjs
// Behavioural pins on the pure attribution helpers (lib/actor_kind.ts) + the
// wiring that makes them matter: publish.ts records 'operator' and raises the
// client's notice, room.ts reads the studio's hand back as "published by your
// studio", connections.ts logs the operator, migration 0133 + its apply pack
// widen the CHECKs, and the two pages carry the scoped copy while the owner's
// copy stays byte-identical. No network, no database.
const AK = await import('../../supabase/functions/presence/lib/actor_kind.ts');
const { actsForClient, publishActorKind, changeActorKind, connectionActorKind, studioActed, lastPublishDetail, actorKindCheckViolation, legacyActorKind } = AK;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const CLIENT = { site_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Marlow’s Kitchen' };
const owner = { kind: 'client' };                      // the business owner in their own room
const operator = { kind: 'client', scope: CLIENT };    // an agency member drilled into a client
const staff = { kind: 'staff' };                       // platform staff
const staffScoped = { kind: 'staff', scope: CLIENT };
const system = { kind: 'system' };

// ═══ 1. who is acting for a client ═══
ok('actsForClient: the owner is not', actsForClient(owner) === false);
ok('actsForClient: an agency member with an authorised scope is', actsForClient(operator) === true);
ok('actsForClient: platform staff are staff, even scoped', actsForClient(staff) === false && actsForClient(staffScoped) === false);
ok('actsForClient: a null/empty scope never counts', actsForClient({ kind: 'client', scope: null }) === false && actsForClient({ kind: 'client', scope: { site_id: '', name: 'x' } }) === false);

// ═══ 2. the publish record's actor_kind ═══
ok('publishActorKind: owner → client', publishActorKind(owner) === 'client');
ok('publishActorKind: scoped agency member → operator (the audit\'s bug 4, closed)', publishActorKind(operator) === 'operator');
ok('publishActorKind: platform staff → staff, scoped or not', publishActorKind(staff) === 'staff' && publishActorKind(staffScoped) === 'staff');
ok('changeActorKind: same vocabulary + system for the scheduler', changeActorKind(system) === 'system' && changeActorKind(operator) === 'operator' && changeActorKind(owner) === 'client' && changeActorKind(staff) === 'staff');

// ═══ 3. the connections audit's two-word vocabulary ═══
ok('connectionActorKind: owner → customer', connectionActorKind(owner) === 'customer');
ok('connectionActorKind: scoped agency member → operator (was "customer")', connectionActorKind(operator) === 'operator');
ok('connectionActorKind: platform staff → operator (unchanged)', connectionActorKind(staff) === 'operator');

// ═══ 4. the room's last-publish sentence ═══
ok('room: staff publish → "published by your studio"', lastPublishDetail('staff') === 'published by your studio');
ok('room: operator publish → "published by your studio" (was "published by you")', lastPublishDetail('operator') === 'published by your studio');
ok('room: the owner\'s own publish → "published by you"', lastPublishDetail('client') === 'published by you');
ok('room: unknown/legacy/system falls to "published by you" (unchanged behaviour)', lastPublishDetail('system') === 'published by you' && lastPublishDetail(undefined) === 'published by you' && lastPublishDetail('') === 'published by you');
ok('studioActed: staff + operator only', studioActed('staff') && studioActed('operator') && !studioActed('client') && !studioActed('system') && !studioActed(null));

// ═══ 5. the pre-0133 degrade: only an actor_kind CHECK violation retries ═══
ok('degrade: PostgREST 23514 naming the actor_kind constraint is recognised',
  actorKindCheckViolation({ code: '23514', message: 'new row for relation "presence_publishes" violates check constraint "presence_publishes_actor_kind_check"' }, ''));
ok('degrade: …and the created_by_kind one on snapshots',
  actorKindCheckViolation({ code: '23514', message: 'violates check constraint "presence_snapshots_created_by_kind_check"' }, ''));
ok('degrade: a check violation on ANOTHER column is NOT swallowed', !actorKindCheckViolation({ code: '23514', message: 'violates check constraint "presence_publishes_status_check"' }, ''));
ok('degrade: a unique-violation 409 / unrelated error is NOT a check violation', !actorKindCheckViolation({ code: '23505', message: 'duplicate key value violates unique constraint "presence_publishes_inflight"' }, '') && !actorKindCheckViolation(null, 'actor_kind'));
ok('degrade: operator → staff (still the studio\'s hand); everything else untouched', legacyActorKind('operator') === 'staff' && legacyActorKind('client') === 'client' && legacyActorKind('staff') === 'staff');

// ═══ 6. wiring — the helpers are what the routes actually use ═══
{
  const pub = read('supabase/functions/presence/routes/publish.ts');
  ok('publish.ts: actor_kind comes from publishActorKind (no inline staff/client ternary left)',
    /publishActorKind\(principal\)/.test(pub) && !/principal\.kind === 'staff' \? 'staff' : 'client'/.test(pub));
  ok('publish.ts: the snapshot and the publish record both carry the same actorKind',
    /created_by_kind: byKind/.test(pub) && /actor_kind: byKind/.test(pub) && /insertSnapshot\(actorKind\)/.test(pub) && /insertRecord\(actorKind\)/.test(pub));
  ok('publish.ts: an operator publish raises the client\'s studio_published notice, one row per publish',
    /actorKind === 'operator' && site\.client_id/.test(pub) && /kind: 'studio_published', period: `pub:\$\{pubId\}`, headline: 'Your studio published a change'/.test(pub));
  ok('publish.ts: the notice body carries the change count (and a restore says so instead)',
    /published \$\{n\} change\$\{n === 1 \? '' : 's'\} to your website/.test(pub) && /brought back an earlier version/.test(pub));
  ok('publish.ts: the count is the diff engine\'s (what the ritual button showed), read only for an operator',
    /if \(publishActorKind\(principal\) === 'operator'\)/.test(pub) && /describeChanges\(snapshot\.content, liveContent\)\.count/.test(pub));
  ok('publish.ts: pre-0133 degrade is wired for both inserts', (pub.match(/actorKindCheckViolation\(/g) || []).length >= 2 && /legacyActorKind\(actorKind\)/.test(pub));

  const room = read('supabase/functions/presence/routes/room.ts');
  ok('room.ts: /health last_publish.detail is lastPublishDetail(actor_kind)', /detail: lastPublishDetail\(st\.lastLive\.actor_kind\)/.test(room) && !/actor_kind === 'staff' \? 'published by your studio'/.test(room));

  const conn = read('supabase/functions/presence/routes/connections.ts');
  ok('connections.ts: every connection event uses connectionActorKind (4 event inserts incl. the ask + disconnect + the write audit)',
    (conn.match(/actor_kind: connectionActorKind\(principal\)/g) || []).length === 4 && /storeDisconnect\(site\.id, key, connectionActorKind\(principal\)\)/.test(conn) && /const actorOf = \(principal: Principal\) => connectionActorKind\(principal\)/.test(conn) && !/principal\.kind === 'staff' \? 'operator' : 'customer'/.test(conn));

  const prov = read('supabase/functions/presence/lib/provenance.ts');
  ok('provenance.ts: change events use changeActorKind', /changeActorKind\(opts\.principal\)/.test(prov));
  const staging = read('supabase/functions/presence/lib/staging.ts'), dw = read('supabase/functions/presence/lib/draft_writer.ts');
  ok('staging.ts + draft_writer.ts: snapshots they write attribute the same way', /publishActorKind\(p\)/.test(staging) && /publishActorKind\(principal\)/.test(dw));

  const bulk = read('supabase/functions/presence/agency/routes.ts');
  ok('agency/routes.ts: the bulk publish hands handlePublish a principal scoped to EACH site (operator attribution + client notice)',
    /const scoped: Principal = \{ \.\.\.principal, scope: \{ site_id: site\.id, name: names\.get\(site\.id\) \|\| 'Client' \} \};\s*\n\s*const resp = await handlePublish\(null, site, scoped, \{\}\)/.test(bulk) && !/handlePublish\(null, site, principal, \{\}\)/.test(bulk));
  ok('agency/routes.ts: a scoped copy per site — the member\'s principal is never mutated', /\{ \.\.\.principal, scope:/.test(bulk) && !/principal\.scope = /.test(bulk));
  // behavioural: the per-site copy attributes as operator for a member, staff for staff
  ok('bulk: a member\'s per-site copy → operator; staff\'s → staff', publishActorKind({ ...operator, scope: null, ...{ kind: 'client' }, scope: CLIENT }) === 'operator' && publishActorKind({ kind: 'staff', scope: CLIENT }) === 'staff');

  const idx = read('supabase/functions/presence/index.ts');
  ok('index.ts: the principal is stamped with the scope ONLY after resolveScopedSite allowed it',
    /if \(!sc\.ok\) return json\(\{ error: 'scope_denied'[\s\S]{0,800}principal\.scope = \{ site_id: sc\.scoped\.site_id, name: sc\.scoped\.name \}/.test(idx));
  const auth = read('supabase/functions/_shared/auth.ts');
  ok('auth.ts: Principal carries the optional scope flag', /scope\?: \{ site_id: string; name: string \} \| null;/.test(auth));

  const ws = read('supabase/functions/presence/routes/workspace.ts');
  ok('workspace.ts: studio_published lands on the client\'s Website overview', /studio_published: '\/presence\.html'/.test(ws));
  const feed = read('supabase/functions/presence/lib/inbox_feed.ts');
  ok('inbox_feed.ts: studio_published is NOT protected → dismissible', !/studio_published/.test(feed));

  const tl = read('supabase/functions/presence/lib/website_timeline.ts');
  ok('website_timeline.ts: operator already reads as "Your studio" on the timeline', /case 'staff': case 'operator': return 'Your studio'/.test(tl));
}

// ═══ 7. migration 0133 + apply pack ═══
{
  const mig = read('supabase/migrations/0133_actor_kind_operator.sql');
  for (const c of ['presence_snapshots_created_by_kind_check', 'presence_publishes_actor_kind_check', 'presence_change_events_actor_kind_check']) {
    ok(`0133: drops + re-adds ${c} with 'operator'`, new RegExp(`drop constraint if exists ${c};[\\s\\S]{0,200}add constraint ${c}\\s+check \\([a-z_]+ in \\('client','staff','operator','system'\\)\\)`).test(mig));
  }
  ok('0133: widens the notice-kind CHECK to studio_published, carrying the 0127 superset', /presence_plan_notices_kind_check/.test(mig) && /'studio_published'/.test(mig) && /'retainer_status','deal_task_due'/.test(mig) && /'invoice_void_paid'/.test(mig));
  ok('0133: first line is the rollback note (migrations/README convention)', /^-- rollback:/.test(mig));
  const pack = read('docs/presence/APPLY-0133-prod.sql');
  ok('APPLY-0133: the owner-apply pack carries the same four constraints + a verify query', /presence_publishes_actor_kind_check/.test(pack) && /presence_snapshots_created_by_kind_check/.test(pack) && /presence_change_events_actor_kind_check/.test(pack) && /'studio_published'/.test(pack) && /-- Verify/.test(pack));
  // every notice kind the code raises must be in the migration's list
  const kinds = new Set(); const re = /raiseNotice(?:Detailed)?\(\{[\s\S]{0,400}?kind: '([a-z_]+)'/g; let m;
  for (const f of ['routes/publish.ts']) { const src = read('supabase/functions/presence/' + f); while ((m = re.exec(src)) !== null) kinds.add(m[1]); }
  ok('0133: every kind publish.ts raises is in the CHECK list', [...kinds].every((k) => mig.includes(`'${k}'`)), [...kinds].join(','));
}

// ═══ 8. the pages ═══
{
  const html = read('presence.html');
  ok('presence.html: scopedClientName reads ?client= + the shell context\'s scope.name', /function scopedClientName\(\)/.test(html) && /window\.__ddsContext, sc = c && c\.scope/.test(html));
  ok('presence.html: scoped ritual title names the client\'s site', /Here’s what changes on \$\{possessive\(forClient\)\} site/.test(html));
  ok('presence.html: scoped intro — THEIR customers, THEIR site, YOU decide', /read exactly as their customers will experience \$\{c\.count === 1 \? "it" : "them"\}\. Their live site stays as it is until you decide\./.test(html));
  ok('presence.html: scoped receipt says "Published for <client>" and drops "came from you"', /Published for \$\{esc\(forClient\)\}/.test(html) && /forClient\s*\?\s*\(firstPublish \? esc\(forClient\) \+ " has a home now\.<br>This first version is kept safe, always\." : "This version is kept safe, always\."\)/.test(html));
  ok('presence.html: the OWNER copy is byte-identical (title, intro, receipt)',
    html.includes('$("ritTitle").textContent = "Here’s what changes.";') &&
    html.includes('read exactly as customers will experience ${c.count === 1 ? "it" : "them"}. Your live site stays as it is until the moment you decide.') &&
    html.includes('"Every word on your site came from you.<br>This version is kept safe, always."') &&
    html.includes('" has a home now — and every word of it came from you.<br>This first version is kept safe, always."'));
  ok('presence.html: the publish button label is untouched (Publish these N changes)', html.includes('`Publish ${c.count === 1 ? "this change" : "these " + c.count + " changes"}`'));
  ok('possessive: Marlow’s Kitchen → Marlow’s Kitchen’s; Dunn Bros → Dunn Bros’', /function possessive\(name\) \{ return \/s\$\/i\.test\(name\) \? name \+ "’" : name \+ "’s"; \}/.test(html));

  const conn = read('connections.html');
  ok('connections.html: scoped row copy — "You connect this for <client> with a Google account that has access to their property."', /You connect this for \$\{esc\(CLIENT_NAME \|\| 'this client'\)\} with a Google account that has access to their property\./.test(conn));
  ok('connections.html: the owner copy "Who owns it: you do" stays for the un-scoped page', /<b>Who owns it:<\/b> you do\. It’s your account and your permission/.test(conn) && /\$\{SCOPE\s*\n?\s*\?/.test(conn));
  ok('connections.html: the client name is the shell context\'s scope.name, resolved before the first render', /c\.scope && c\.scope\.name/.test(conn) && /CLIENT_NAME = await resolveClientName\(\);\s*\n\s*await reload\(\);/.test(conn));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error('FAILED:\n' + failed.map((f) => '  ' + f.n).join('\n')); Deno.exit(1); }
