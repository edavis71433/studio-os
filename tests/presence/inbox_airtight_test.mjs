// ── Inbox airtight: every needs-you signal reaches the ONE bell + Inbox ──────
//   deno run --allow-read tests/presence/inbox_airtight_test.mjs
// Three prior leaks are closed by making existing signals ride the ONE notice
// model / feed path — NOT by adding a table, store, or workflow engine. This is
// a structural guard (regex over source) matching website_notices_test.mjs: it
// pins the wiring so a future edit can't silently re-open a leak.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const workspace = read('supabase/functions/presence/routes/workspace.ts');
const bell = read('supabase/functions/presence/lib/inbox_feed.ts');   // the pure badge arithmetic
const store = read('supabase/functions/presence/connected/store.ts');
const inbox = read('inbox.html');
const today = read('today.html');

// ── FIX 1: new website enquiries ring the bell + show in the Inbox ───────────
ok('FIX1: attention_count counts new form submissions (owner-scoped, status=new)',
  /seesFull \? svc\(`presence_form_submissions\?site_id=eq\.\$\{site\.id\}&spam=eq\.false&status=eq\.new/.test(workspace));
// The badge ARITHMETIC moved to lib/inbox_feed.ts studioBellCount (pure, so the
// rules below are now behaviourally tested in operator_notify_fixes_test.mjs);
// the route still owns the reads and must still hand both inputs over.
ok('FIX1: new-enquiry count is deduped against the lead_followup cron notice (no stacking)',
  /const leadFollowups = notices\.filter\(\(n\) => n && n\.kind === 'lead_followup'\)\.length/.test(bell) &&
  /const newEnquiries = Math\.max\(0, \(i\.newEnquiries \|\| 0\) - leadFollowups\)/.test(bell) &&
  /\+ \(i\.filesPending \|\| 0\) \+ newEnquiries/.test(bell) &&
  /newEnquiries: \(\(eQ\.json as any\[\]\)\?\.length \|\| 0\)/.test(workspace) &&
  /notices: \(\(nQ\.json as any\[\]\) \|\| \[\]\)/.test(workspace));
ok('FIX1: the feed emits ONE synthetic website_enquiry row (deduped), keyed for the bell',
  /notices\.unshift\(\{[\s\S]*?kind: 'website_enquiry'/.test(workspace) &&
  /const newEnquiries = Math\.max\(0, \(\(\(enqQ\.ok[\s\S]*?\)\.length - leadFollowups\)/.test(workspace));
ok('FIX1: the enquiry feed row is owner-only (reviewers never see leads)',
  /if \(seesFull\) \{[\s\S]*?kind: 'website_enquiry'/.test(workspace));
ok('FIX1: inbox.html filters the aggregate row so it is not double-listed with /forms/inbox',
  /feed\.notices\|\|\[\]\)\.filter\(n=>n\.kind!=='website_enquiry'\)/.test(inbox));

// ── FIX 2: degraded connections reach the bell + Inbox ───────────────────────
ok('FIX2: markStatus raises a connection_expired notice on degrade (per-provider period)',
  /kind: 'connection_expired', period,/.test(store) && /const period = `conn:\$\{providerKey\}`/.test(store));
ok('FIX2: degrade covers expired/error/revoked + attention/down health',
  /\['expired', 'error', 'revoked'\]\.includes\(status\) \|\| \['attention', 'down'\]\.includes\(health\)/.test(store));
ok('FIX2: recovery clears the notice exactly (idempotent, same period key)',
  /status === 'connected' && health === 'ok'[\s\S]*?clearNotice\(clientId, 'connection_expired', period\)/.test(store));
ok('FIX2: it rides the ONE notice model (reuses raiseNotice/clearNotice, no new store)',
  /import \{ raiseNotice, clearNotice \} from '\.\.\/lib\/notice\.ts'/.test(store));
ok('FIX2: connection_expired has a NOTICE_HREF so its CTA lands on connections.html',
  /connection_expired: '\/connections\.html'/.test(workspace));
ok('FIX1: website_enquiry has a NOTICE_HREF (leads.html)', /website_enquiry: '\/leads\.html'/.test(workspace));

// ── FIX 3: Today and the bell never disagree on the number ───────────────────
ok('FIX3: Today sources its needs count from ctx.attention_count (the bell badge)',
  /const bellCount = \(ctx && typeof ctx\.attention_count === 'number'\) \? ctx\.attention_count : shown/.test(today) &&
  /const needs = Math\.max\(shown, bellCount\)/.test(today));
ok('FIX3: when the bell rings but nothing is renderable inline, Today points to the Inbox (no false all-clear)',
  /if\(shown === 0 && bellCount > 0\)\{[\s\S]*?\/inbox\.html/.test(today));

// ── FIX 4: missing-required content shows in the main feed, not only Attention Center
ok('FIX4: the feed emits a missing_required row reusing the Content Tree signal',
  /siteContentTree/.test(workspace) && /kind: 'missing_required'/.test(workspace) &&
  /status === 'missing_required'/.test(workspace));
ok('FIX4: missing_required has a NOTICE_HREF (content-tree.html)', /missing_required: '\/content-tree\.html'/.test(workspace));

// ── moat: still ONE model — no new table/store/engine introduced here ────────
ok('MOAT: no new notification table/store is created (reuses presence_plan_notices only)',
  !/create\s+table/i.test(store) && !/create\s+table/i.test(workspace));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ INBOX AIRTIGHT (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
