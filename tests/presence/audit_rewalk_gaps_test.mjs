// ── Oct 2026 workflow audit, section 6: the five gaps the re-walk found ──────
//   deno run --allow-read --allow-env tests/presence/audit_rewalk_gaps_test.mjs
// docs/design/WORKFLOW-AUDIT-2026-10.md §6 "Gaps the re-walk found". Four of the
// five shipped; gap 4 (a client's first visit) is by design and only noted here.
// Pure helpers are tested behaviourally; the HTML wiring is pinned by regex, the
// same guard style as inbox_airtight_test.mjs. The clicks themselves are measured
// by docs/design/audit/walks/ and pinned in tests/e2e (schedule/inbox/shell/cms).
import { leadFollowupNoticeKey, leadIdOfNoticePeriod } from '../../supabase/functions/presence/lib/commercial.ts';
import { buildNav } from '../../supabase/functions/presence/lib/navigation.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const presence = read('presence.html');
const inbox = read('inbox.html');
const workspace = read('supabase/functions/presence/routes/workspace.ts');
const attention = read('supabase/functions/presence/routes/attention.ts');
const notice = read('supabase/functions/presence/lib/notice.ts');

// ═══ gap 1 · schedule from the menu is 3 clicks: the panel is on the page ═══
{
  const block = presence.slice(presence.indexOf('async function renderRitualSchedule('), presence.indexOf('/* ── G6: share the draft'));
  ok('gap 1: the schedule panel renders without a "Publish later" click (no opener button)', !/Publish later — pick a time…/.test(block) && /el\("div", "sched-panel"\)/.test(block) && /"Or publish later"/.test(block));
  ok('gap 1: the panel arms on focusin / pointerdown and rests when focus leaves it', /panel\.addEventListener\("focusin", arm\)/.test(block) && /panel\.addEventListener\("pointerdown", arm\)/.test(block) && /panel\.addEventListener\("focusout"/.test(block));
  ok('gap 1: armed = Schedule it filled + publish-now quiet; resting = the reverse (one filled button)', /const arm = \(\) => \{ panel\.classList\.add\("armed"\); if \(pubNow\) pubNow\.classList\.add\("quiet"\); \}/.test(block) && /const rest = \(\) => \{ panel\.classList\.remove\("armed"\); if \(pubNow\) pubNow\.classList\.remove\("quiet"\); \}/.test(block));
  ok('gap 1: Schedule it is outlined by CSS and filled only inside an armed panel', /\.schedgo\{[^}]*background:transparent/.test(presence) && /\.sched-panel\.armed \.schedgo\{background:var\(--plum\)/.test(presence));
  ok('gap 1: #schedule / Publish later still land armed with the date field focused', /if \(toSchedule\) \{[^\n]*arm\(\); pub\.inp\.focus\(\); \}/.test(block));
}

// ═══ gap 2 · the lead_followup notice deep-links its row ═══
{
  const k = leadFollowupNoticeKey('abc-123');
  ok('gap 2: leadIdOfNoticePeriod inverts leadFollowupNoticeKey', leadIdOfNoticePeriod(k.period) === 'abc-123');
  ok('gap 2: a weekly bucket, a blank, null and a stranger period give null', [leadIdOfNoticePeriod('2026-W42'), leadIdOfNoticePeriod(''), leadIdOfNoticePeriod(null), leadIdOfNoticePeriod(undefined), leadIdOfNoticePeriod('lead:'), leadIdOfNoticePeriod('lead:a b')].every((v) => v === null));
  ok('gap 2: noticeHrefFor builds /inbox.html#enquiries?sel=lead:<id> for lead_followup and stays kind-only otherwise',
    /export const noticeHrefFor = /.test(workspace) && /const id = n\.kind === 'lead_followup' \? leadIdOfNoticePeriod\(n\.period\) : null;/.test(workspace) && /return id \? `\$\{base\}\?sel=lead:\$\{id\}` : base;/.test(workspace) && /lead_followup: '\/inbox\.html#enquiries'/.test(workspace));
  ok('gap 2: the feed, the attention read and the push all mint the href through noticeHrefFor', /href: noticeHrefFor\(n\), dismissible: noticeDismissible/.test(workspace) && /href: noticeHrefFor\(n\) \}\)\)/.test(attention) && /noticeHrefFor\(n\);/.test(notice));
  ok('gap 2: the attention read selects `period` so the href has the lead id', /select=kind,period,headline,body/.test(attention));
  ok('gap 2: inbox.html reads #view?sel=… once at boot and opens that row after the first paint', /const HASH_LINK=\(\(\)=>\{const raw=String\(location\.hash\|\|''\)\.slice\(1\);const i=raw\.indexOf\('\?'\)/.test(inbox) && /function openLinkedRow\(\)/.test(inbox) && /renderConsole\(\);renderList\(\);renderPane\(\);\n  openLinkedRow\(\);/.test(inbox));
  ok('gap 2: the deep link opens through openItem (dot cleared, pane in) and never invents a row', /const it=m\?\(visibleRows\(\)\.find\(byLead\)\|\|ITEMS\.find\(byLead\)\):ITEMS\.find\(r=>r\.id===want\);\n  if\(!it\)return;\n  openItem\(it\.id\);/.test(inbox));
}

// ═══ gap 3 · ⌘K finds "health" again ═══
{
  const ctx = { role: 'business_owner', edition: 'presence', capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], isAgency: false, isOperator: false, editionKey: 'studio_os', isManagedClient: false, scoped: false };
  const items = buildNav(ctx).flatMap((s) => s.items);
  const website = items.find((i) => i.key === 'content');
  ok('gap 3: the Website item carries a desc that names the health check', !!website && /health check/.test(website.desc || ''));
  // the palette matches on label · section · desc (shell.js) — "health" must find
  // exactly the overview, and the desc must not widen "page" or "domain" (1 each in §6)
  const matches = (q) => items.filter((i) => [i.label, i.desc || ''].some((t) => t.toLowerCase().includes(q)));
  ok('gap 3: "health" → the Website overview only', matches('health').length === 1 && matches('health')[0].key === 'content');
  ok('gap 3: "page" and "domain" still find one destination each (the desc does not say either)', matches('page').length === 1 && matches('domain').length === 1);
}

// ═══ gap 4 · a client's first visit is by design — noted, not changed ═══
ok('gap 4: noted only — the welcome card shows once and is not measured as a regression (no pin, by design)', true);

// ═══ gap 5 · the rail cards no longer depend on /health carrying facts ═══
{
  const loadToday = presence.slice(presence.indexOf('async function loadToday()'), presence.indexOf('/* ── the concierge\'s letters'));
  const facts = presence.slice(presence.indexOf('function renderFactsProse()'), presence.indexOf('function renderNotes('));
  ok('gap 5: loadToday() asks for the board extras itself', /renderStatement\(\); renderFactsProse\(\);[\s\S]*?hbLoadBoardExtras\(\);/.test(loadToday));
  ok('gap 5: renderFactsProse() no longer gates them behind `facts`', !/hbLoadBoardExtras/.test(facts) && /if \(!f\) return;/.test(facts));
  ok('gap 5: hbLoadBoardExtras still runs once (HB_ASKED.extras guard)', /function hbLoadBoardExtras\(\) \{\n  if \(HB_ASKED\.extras\) return; HB_ASKED\.extras = true;/.test(presence));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error('FAILED:\n  ' + failed.map((r) => r.n).join('\n  ')); Deno.exit(1); }
