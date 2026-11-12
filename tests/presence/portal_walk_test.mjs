// ── The client portal walk (Nov 8, 2026): what it found, fixed ──────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_walk_test.mjs
//
// Walking the portal as a client found three July requests reading "updated 3
// hours ago" and lighting the client's bell, because linking them to their
// customer was a write and the table's touch trigger moved updated_at. A
// request's time is now what people did (opened, wrote, resolved), the bell
// tells the client about the studio's replies and resolutions only, and the
// Requests tab's "Something else?" opens its own request.
const A = await import('../../supabase/functions/presence/lib/support_activity.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── the rules ──
const msgs = [
  { request_id: 'r1', author: 'client-key', body: 'Can we move the logo?', created_at: '2026-07-14T10:00:00Z' },
  { request_id: 'r1', author: 'studio-key', body: 'Done — have a look.', created_at: '2026-07-15T09:00:00Z' },
  { request_id: 'r2', author: 'client-key', body: '  hello   there ', created_at: '2026-07-13T08:00:00Z' },
  { request_id: '', author: 'x', created_at: '2026-07-01T00:00:00Z' },
];
const newest = A.newestPerRequest(msgs, { r1: 'client-key', r2: 'client-key' });
eq('the newest message per request, and who wrote it', [newest.r1.at, newest.r1.mine, newest.r1.studioAt], ['2026-07-15T09:00:00Z', false, '2026-07-15T09:00:00Z']);
eq('the client\'s own message is theirs; no studio reply yet', [newest.r2.mine, newest.r2.studioAt], [true, '']);
eq('order of arrival does not matter', A.newestPerRequest([...msgs].reverse(), { r1: 'client-key' }).r1.at, '2026-07-15T09:00:00Z');
eq('a request\'s time is opened · written in · resolved — never a bookkeeping write', [
  A.supportActivityAt({ created_at: '2026-07-14T03:54:18Z', updated_at: '2026-11-08T13:59:46Z' }, null),
  A.supportActivityAt({ created_at: '2026-07-14T00:00:00Z' }, '2026-07-15T09:00:00Z'),
  A.supportActivityAt({ created_at: '2026-07-14T00:00:00Z', resolved_at: '2026-07-20T00:00:00Z' }, '2026-07-15T09:00:00Z'),
  A.supportActivityAt(null, null),
], ['2026-07-14T03:54:18Z', '2026-07-15T09:00:00Z', '2026-07-20T00:00:00Z', '']);
eq('the client hears about the studio\'s reply', A.clientSupportNews({ subject: 'Logo tweak', status: 'open' }, '2026-07-15T09:00:00Z'), { at: '2026-07-15T09:00:00Z', label: 'Your studio replied: Logo tweak' });
eq('…or the request being resolved, whichever is later', A.clientSupportNews({ subject: 'Logo tweak', status: 'resolved', resolved_at: '2026-07-20T00:00:00Z' }, '2026-07-15T09:00:00Z'), { at: '2026-07-20T00:00:00Z', label: 'Resolved: Logo tweak' });
eq('their own filing, or a link-up, is not news', [A.clientSupportNews({ subject: 'test', status: 'open' }, null), A.clientSupportNews({ subject: 'x', status: 'open', resolved_at: '2026-07-20T00:00:00Z' }, '')], [null, null]);
eq('one line for the list: who wrote it, tidied and capped', [A.lastLine(newest.r1), A.lastLine(newest.r2), A.lastLine(undefined), A.lastLine({ at: 'x', body: 'a'.repeat(200), mine: false, studioAt: '' }).text.length], [{ from: 'studio', text: 'Done — have a look.' }, { from: 'you', text: 'hello there' }, null, 120]);

// ── the wiring ──
const cd = read('supabase/functions/presence/routes/client_delivery.ts');
ok('the client\'s request list times each request by real activity', /row\.last_activity_at = supportActivityAt\(row, n \? n\.at : null\) \|\| String\(row\.updated_at \|\| ''\);/.test(cd));
ok('…and carries the newest line someone wrote', /const ll = lastLine\(n\); if \(ll\) row\.last_message = ll;/.test(cd));
ok('…without handing the page the requester key', /for \(const row of list\) delete row\.requester;/.test(cd));
ok('the client\'s bell: the studio\'s replies and resolutions, never updated_at', /const news = clientSupportNews\(r, newest\[String\(r\.id\)\]\?\.studioAt \|\| null\);/.test(cd) && !/label: `Support: \$\{clean\(r\.subject, 60\)\}`, href: `\/client\.html\?support=\$\{r\.id\}`, created_at: r\.updated_at/.test(cd));
ok('a request the client asked for as new is never folded into an old conversation', /if \(!serviceName && !hasBrief && !projectId && b\.new_request !== true\) \{/.test(cd));
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the studio\'s Inbox times support rows by real activity too', /created_at: supWhen\(r\), thread_key: tk,/.test(ws) && /const supWhen = \(r: any\): string => supportActivityAt\(r, supAnyAt\[String\(r\.id\)\] \|\| null\) \|\| String\(r\.updated_at \|\| ''\);/.test(ws));
const cl = read('client.html');
ok('"Something else?" sends new_request', /\{subject,body:\$\('sup-body'\)\.value\.trim\(\),project_id:pid,new_request:true\}/.test(cl));
ok('a to-do\'s status in words', /const TASK_WORD=\{todo:'To do',in_progress:'In progress',blocked:'Waiting on something',done:'Done'\};/.test(cl));
// item 179: each to-do is its own Needs-you row now; the project card still counts them in words
ok('to-dos are called to-dos; approvals need your OK', /to-do\$\{nt===1\?'':'s'\} for you/.test(cl) && /need\$\{na===1\?'s':''\} your OK/.test(cl));
ok('a paid invoice says when', /Paid\$\{paidOn\?' '\+esc\(paidOn\):''\} — thank you\./.test(cl));
ok('no booking times → Ask for a call, prefilled', /openSupport\(null,'requests',\{subject:'A call',body:'I’d like to book a call\. Times that work for me: '\}\)/.test(cl));
ok('each tab names itself', /document\.title=\(\{home:'Home',messages:'Messages',files:'Files',invoices:'Invoices',requests:'Requests',help:'Help'\}\[tab\]\|\|'Home'\)\+' — '\+studioBrand\(\)/.test(cl));   // builder list item 59: the studio's own name when there is one
// item 179: the at-a-glance strip left Home (its count lives in the "Needs you · N"
// heading), so only the mid-width tab rule remains pinned here.
ok('mid widths fit all six tabs', /@media \(min-width:720px\) and \(max-width:920px\)\{\.tab \.ti\{display:none\}/.test(cl));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
