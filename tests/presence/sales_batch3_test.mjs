// ── Sales review batch three (Nov 2026): items 15, 18, 22 ───────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch3_test.mjs
//
//   15  Home said all four watch-plan clients were "Live"; Analytics said none
//       were and called them drafts. One rule (siteState): a monitor-edition
//       site is hosted elsewhere, a published one is live, the rest are drafts.
//   18  the Inbox listed the studio's own worklog ("A task moved") and the
//       reminders about conversations it already listed.
//   22  a won deal that never became a customer had no way to convert from the
//       list; the signed notice and Home's Convert opened the deal's Overview.
const C = await import('../../supabase/functions/presence/analytics/compose.ts');
const W = await import('../../supabase/functions/presence/routes/workspace.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── 15 ──
eq('a watch-plan site is hosted elsewhere, published or not', [C.siteState({ edition: 'monitor' }), C.siteState({ edition: 'monitor', last_published_at: '2026-01-01' })], ['elsewhere', 'elsewhere']);
eq('a published site here is live', [C.siteState({ edition: 'presence', last_published_at: '2026-01-01' }), C.siteState({ edition: 'presence', status: 'live' })], ['live', 'live']);
eq('anything else is a draft', C.siteState({ edition: 'presence' }), 'draft');
const rows = C.websiteRows([{ site_id: 'w', edition: 'monitor' }, { site_id: 'h', edition: 'presence', last_published_at: '2026-01-01' }, { site_id: 'd', edition: 'presence' }], {});
eq('Analytics rows carry the three-way site_state', rows.map((r) => r.site_state), ['elsewhere', 'live', 'draft']);
eq('…and keep draft_live for older pages', rows.map((r) => r.draft_live), ['draft', 'live', 'draft']);
const home = read('agency.html');
ok('Home mirrors the rule: monitor → "Hosted elsewhere", before Live', /if\(c\.edition==='monitor'\)return'Hosted elsewhere';\s*if\(c\.status==='live'\|\|c\.last_published_at\)return'Live';/.test(home));
const an = read('analytics.html');
ok('Analytics counts live, hosted elsewhere and drafts apart', /stOf\(w\)==='elsewhere'/.test(an) && /hosted elsewhere/.test(an));

// ── 18 ──
const inbox = read('inbox.html');
ok('the Inbox draws no worklog rows', !/tag:'Project activity'/.test(inbox) && !/function notifLink/.test(inbox));
ok('reminders about a listed conversation are not rows', /const DUP_NUDGES=new Set\(\['website_enquiry','support_aging','lead_followup'\]\)/.test(inbox));

// ── 22 ──
const SIGNED = 'abcdef01-2345-4678-9abc-def012345678';
eq('the signed notice opens its deal at Convert', W.noticeHrefFor({ kind: 'deal_signed', period: `signed:${SIGNED}` }), `/pipeline.html?deal=${SIGNED}#convert`);
eq('the accepted notice opens its deal', W.noticeHrefFor({ kind: 'deal_signed', period: `accepted:${SIGNED}` }), `/pipeline.html?deal=${SIGNED}`);
eq('a malformed period keeps the kind\'s landing', W.noticeHrefFor({ kind: 'deal_signed', period: 'signed:nope' }), W.noticeHref('deal_signed'));
eq('a lead reminder still deep-links its enquiry', W.noticeHrefFor({ kind: 'lead_followup', period: 'lead:l1' }), '/inbox.html#enquiries?sel=lead:l1');
const pipe = read('pipeline.html');
ok('#convert opens Billing at Convert', /WANT_CONVERT=location\.hash==='#convert'\|\|WANT_CONVERT_NEXT/.test(pipe) && /\(WANT_SCHEDULE\|\|WANT_CONVERT\)\?'billing'/.test(pipe));
ok('a won row that is not a customer says so and opens at Convert', /const needsConvert=\(d\)=>d\.stage==='won'&&!d\.converted_client_id;/.test(pipe) && /Not a customer yet — open to make them one/.test(pipe));
const ny = read('supabase/functions/presence/agency/needs_you.ts');
ok('Home\'s Convert row lands on Convert', /\$\{signed \? '#convert' : ''\}/.test(ny));

// ── page freshness after a deploy (found while checking PR 136 live) ──
// Netlify serves the app at clean URLs; only /*.html had a no-cache rule, so app
// pages fell to /* (an hour) and shell.js to /*.js (a day).
const headers = read('_headers');
const ruleFor = (path) => { const m = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\s*Cache-Control: ([^\\n]+)`, 'm').exec(headers); return m ? m[1] : null; };
const nav = read('supabase/functions/presence/lib/navigation.ts');
const appPages = [...new Set([...nav.matchAll(/'\/([a-z0-9-]+)\.html/g)].map((m) => '/' + m[1]))];
ok(`the menu names app pages (${appPages.length})`, appPages.length >= 10);
for (const p of appPages) ok(`${p} revalidates on every load`, /no-cache/.test(ruleFor(p) || ''));
for (const p of ['/shell.js', '/shell.css']) ok(`${p} revalidates on every load`, /no-cache/.test(ruleFor(p) || ''));
for (const p of ['/studio', '/sign', '/set-password', '/portal']) ok(`${p} keeps its no-store policy at the clean URL`, /no-store/.test(ruleFor(p) || ''));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
