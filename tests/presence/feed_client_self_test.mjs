// ── The studio's updates row is for the client only (builder item 173) ───────
//   deno run --allow-read --allow-env --allow-net tests/presence/feed_client_self_test.mjs
//
// Live on Nov 10 2026 the studio opened a client's Overview and was told "An update
// from your studio": the feed's bridge row, written for the client, was built for
// anyone with owner rights on the client's site, including the studio drilled in.
// It is now built only for the client themself: no drill-in (principal.scope), no
// platform staff, no staff or developer seat, the same test /portal/context uses for
// the bridged-customer links.
const W = await import('../../supabase/functions/presence/routes/workspace.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const ROOT = new URL('../../', import.meta.url);
const src = Deno.readTextFileSync(new URL('supabase/functions/presence/routes/workspace.ts', ROOT));

const me = { kind: 'user', scope: null };
ok('the client on their own site is the client', W.isTheClientThemself(me, 'business_owner') === true);
ok('the studio drilled into the client is not', W.isTheClientThemself({ kind: 'user', scope: { site_id: 's', name: 'Garage Ten' } }, 'business_owner') === false);
ok('platform staff are not', W.isTheClientThemself({ kind: 'staff', scope: null }, 'business_owner') === false);
ok('the system is not', W.isTheClientThemself({ kind: 'system', scope: null }, 'business_owner') === false);
ok('a staff seat is not', W.isTheClientThemself(me, 'business_staff') === false);
ok('a developer seat is not', W.isTheClientThemself(me, 'developer') === false);
ok('an undefined scope counts as none', W.isTheClientThemself({ kind: 'user' }, 'business_owner') === true);

// wiring: the bridge links are only read, and the row only built, for the client themself
const feed = src.slice(src.indexOf('export async function buildPortalFeed'));
ok('the feed works out who is asking once', /const clientSelf = isTheClientThemself\(principal, role\)/.test(feed));
ok('the bridge links read waits on clientSelf', /seesFull && site\.client_id && clientSelf \? svc\(`presence_service_links/.test(feed));
ok('the updates row waits on clientSelf', /if \(seesFull && site\.client_id && clientSelf\) \{[\s\S]{0,1600}updates from your studio/.test(feed));
ok('no other place builds the updates row', (src.match(/'An update from your studio'/g) || []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
