// ── pipeline.html: the deal detail is a FULL-SCREEN in-page view ─────────────
// The deal detail used to open as a cramped left-side modal (<dialog id="detail">
// + .showModal()). It now opens full-screen in the same tab — the list and the
// detail are two panels of the ONE page, swapped by showDetail()/hideDetail() —
// matching the operator delivery view (projects.html). These structural guards
// confirm the conversion AND that every deal-detail section + handler survived.
// Pure filesystem; no network.
//   deno run --allow-read tests/presence/pipeline_detail_ui_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const pipe = read('pipeline.html');

// ═══ the modal is gone; a full-screen in-page panel takes its place ═══
ok('the cramped modal <dialog id="detail"> is gone', !/<dialog id="detail"/.test(pipe));
ok('no .showModal() is used to open the deal detail', !/showModal\(\)/.test(pipe) || !/\$\('detail'\)/.test(pipe));
ok('a full-screen in-page detail container exists (#detailWrap) alongside the list (#listWrap)', /id="detailWrap"/.test(pipe) && /class="wrap" id="listWrap"/.test(pipe));
ok('show/hide swap the list and detail panels in-page', /function showDetail\(\)\{ const l=\$\('listWrap'\),d=\$\('detailWrap'\)/.test(pipe) && /function hideDetail\(\)/.test(pipe));
ok('opening a deal shows the full-screen detail (skeleton → showDetail), not a modal', /dds-skeleton[\s\S]{0,90}?showDetail\(\)/.test(pipe));
ok('a clear "← Back to pipeline" affordance returns to the list', /← Back to pipeline/.test(pipe) && /\$\('closeD'\)\.onclick=closeDealDetail/.test(pipe));

// ═══ deep-link + URL/focus cleanup preserved ═══
ok('deep-link: ?deal=<id> still opens the deal (now full-screen) on load', /get\('deal'\); if\(deep\) openDeal\(deep\)/.test(pipe));
ok('open sets the ?deal= URL (deep-linkable)', /history\.replaceState\(null,'','\?deal='\+id/.test(pipe));
// SS5 strengthened this: close restores the ROSTER url via listUrl() — scope
// AND the stage filter both survive (a refresh never reopens a stale deal, and
// a ?stage=won landing keeps its link after a drill-in round-trip)
ok('close cleans the URL back to the roster url (scope + stage intact, never a stale deal)',
  /function closeDealDetail\(\)\{[\s\S]*?history\.replaceState\(null,'',listUrl\(\)\)/.test(pipe)
  && /const listUrl=\(\)=>\{[\s\S]*?p\.set\('client',scope\(\)\)[\s\S]*?p\.set\('stage',FILTER\)/.test(pipe));
ok('close restores keyboard focus to the card we came from', /document\.querySelector\('#list \[data-id="'\+id/.test(pipe));
ok('a11y: an in-view refresh re-lands focus on the deal title', /if\(wasOpen\)\{const t=\$\('dtitle'\);if\(t\)t\.focus\(\)/.test(pipe));
ok('board: a stage move re-renders the OPEN deal via the panel (not a dialog.open check)', /if\(!\$\('detailWrap'\)\.hidden&&CURRENT_DEAL===id\)openDeal\(id\)/.test(pipe));

// ═══ redesign slice 3: the Path chevron bar replaces the "Move stage" stack ═══
ok('Path: chevron bar renders in the drawer (pathHost + pstep steps)', /id="pathHost"/.test(pipe) && /data-pstep=/.test(pipe) && /pstep \$\{cls\}/.test(pipe));
ok('Path: kept in sync with crm.html by hand (the hand-copy contract)', /kept in sync with crm\.html by hand/.test(pipe) && /const PATH_STEPS=\['lead','qualified','proposal','contract'\]/.test(pipe));
ok('Path: guidance renders BOTH tip and action (the :694 suggested_action bug, fixed)', /esc\(g\.tip\)/.test(pipe) && /esc\(g\.action\)/.test(pipe) && !/g\.suggested_action/.test(pipe));
ok('Path: forward = "Mark Stage as Complete" via the EXISTING stage POST', /Mark Stage as Complete/.test(pipe) && /\/stage','POST',\{to\}/.test(pipe));
ok('Path: non-interactive steps leave the tab order (tabindex=-1 + aria-disabled)', /tabindex="-1" aria-disabled="true"/.test(pipe));
ok('Path: won stays convert-only — contract+signed points at the EXISTING Convert section', /id="pathConvert"/.test(pipe) && /signedNow/.test(pipe));
ok('Path: won/lost terminal chips render', /terminal-chip won/.test(pipe) && /terminal-chip lost/.test(pipe));
ok('Path: "Mark as lost" stays the separated quiet action + lost keeps Reopen', /id="markLost"/.test(pipe) && /data-stage="lead">Reopen this deal/.test(pipe));

// ═══ redesign slice 3: List · Board · Table (3-way display, persisted) ═══
ok('Table: a third display option exists (viewTable + #table container)', /id="viewTable"/.test(pipe) && /<div id="table"/.test(pipe));
ok('Table: sortable columns with aria-sort; rows open the SAME drawer', /data-tsort/.test(pipe) && /aria-sort=/.test(pipe) && /openDeal\(tr\.getAttribute\('data-id'\)\)/.test(pipe));
ok('Table: the display choice persists (localStorage), embed exempt', /dds-display:pipeline/.test(pipe) && /if\(!EMBED\)/.test(pipe));

// ═══ every deal-detail section survived the conversion ═══
for (const [label, needle] of [
  ['Move stage / path guidance', '<h3>Move stage</h3>'],
  ['Details (value/close/next step/notes)', '<h3>Details</h3>'],
  ['Proposals', '<h3>Proposals</h3>'],
  ['Agreement', '<h3>Agreement</h3>'],
  ['Invoice & deposit', '<h3>Invoice &amp; deposit</h3>'],
  ['Retainer', '<h3>Retainer</h3>'],
  ['Convert to customer', '<h3>Convert to customer</h3>'],
  ['Activity / timeline', '<h3>Activity</h3>'],
]) ok(`section preserved: ${label}`, pipe.includes(needle));

// ═══ every deal-detail handler survived the conversion ═══
for (const [label, re] of [
  ['stage move buttons', /\[data-stage\]/],
  ['save details', /id="ed-save"/],
  ['send proposal', /data-send-proposal/],
  ['send agreement', /data-send-contract/],
  ['send invoice / request deposit', /id="sendInvoice"/],
  ['set up retainer', /id="setupRetainer"/],
  ['convert to customer', /id="convert"/],
  ['resend welcome email', /id="resendInvite"/],
  ['activity quick-log', /id="qlSave"/],
  ['delete deal', /id="delDeal"/],
]) ok(`handler preserved: ${label}`, re.test(pipe));

// ═══ the OTHER dialogs (new deal, manage services) stay as modals — unaffected ═══
ok('unrelated modals still present (New deal + Manage services)', /<dialog id="formDlg"/.test(pipe) && /<dialog id="svcDlg"/.test(pipe));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PIPELINE DETAIL UI (full-screen conversion): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
