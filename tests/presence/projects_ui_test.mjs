// ── projects.html: Studio App surface structural checks (P2-D-5 → slice 9) ───
//   deno run --allow-read tests/presence/projects_ui_test.mjs
// Not a browser test (that's the Playwright e2e suite). Confirms the page is on
// the ONE shared shell, uses the portal auth realm, wires to the real
// /projects/* endpoints, avoids anti-patterns (prompt/alert, a second config) —
// and, since redesign slice 9, carries the Lightning anatomy: the shared .lhead
// list-view header + sortable roster table, and the record page with breadcrumb,
// highlights panel, milestones-as-Path, and the two-column related-list body.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const h = read('projects.html');
const nav = read('supabase/functions/presence/lib/navigation.ts');

ok('shell: loads the ONE shared shell (shell.js + shell.css)', /src="\/shell\.js"/.test(h) && /href="\/shell\.css"/.test(h));
ok('auth: uses the portal auth realm (dds-portal-auth) + supabase-js', /storageKey:'dds-portal-auth'/.test(h) && /supabase-js[-@]2\.45\.4/.test(h)); // [-@]: the pinned 2.45.4 build is now vendored (/vendor/supabase-js-2.45.4.js), no longer the CDN @-URL
ok('auth: sends a signed-out visitor to the STUDIO door (owner surface)', /studio\.html/i.test(h) && !/portal\.html/.test(h));
ok('config: single supabase config (prod ref), scope header for agency drill-in', /qksstlqzbhesadrrofgn/.test(h) && /x-dds-scope-site':scope\(\)/.test(h));
ok('wires: list + detail + report endpoints', /api\('\/projects'/.test(h) && /\/projects\/'\+id\)/.test(h) && /\/report'/.test(h));
ok('wires: task + milestone + status mutations', /\/tasks\/'\+/.test(h) && /\/milestones\/'\+/.test(h) && /\/status','POST'/.test(h));
ok('wires: deliverable upload (reuses the media store) + download', /\/deliverables\/upload-url','POST'/.test(h) && /\/deliverables\/'\+.*\/download/.test(h));
ok('wires: approvals decide + messages thread', /\/approvals\/'\+.*\/decide','POST'/.test(h) && /\/messages','POST'/.test(h));
ok('a11y/ux: no prompt()/alert()/confirm() — uses dialogs + ddsToast', !/\bprompt\(/.test(h) && !/\balert\(/.test(h) && !/\bconfirm\(/.test(h) && /ddsToast/.test(h));
ok('ux: valid next-stage buttons mirror the bounded ladders (no illegal jumps in UI)', /P_NEXT=\{active:\['on_hold','complete','archived'\]/.test(h) && /T_NEXT=\{todo:\['in_progress','blocked','done'\]/.test(h));
ok('ux: shared/internal + client-action tags reflect visibility', /tag client/.test(h) && /your action/.test(h));
ok('ux: write controls are hidden for the client view (STUDIO gate)', /STUDIO\?/.test(h) && /\$\('newProject'\)\.hidden=!STUDIO/.test(h));
ok('slice 9: record body is the two-column related-list layout (main + rail)', /class="dgrid/.test(h) && /class="dside"/.test(h) && /class="dmain"/.test(h) && /#detailWrap\{max-width/.test(h));
ok('FIX B: a customer’s general (project-less) messages surface inside their view', /loadClientGeneral/.test(h) && /\/client-messages/.test(h) && /id="genList"/.test(h));
ok('nav: Projects is a primary outcome, gated to the relationship area', /single\('projects', 'Projects', '\/projects\.html'\)/.test(nav) && /if \(f\.hasRelationship\) single\('projects'/.test(nav));

// ── slice 9: the Lightning roster + record anatomy ──────────────────────────
ok('slice 9: shared .lhead list-view header — 📁 object icon, #pagehead H1, refresh, meta', /class="lhead"/.test(h) && /class="obj-ic"/.test(h) && /id="pagehead" tabindex="-1"/.test(h) && /id="refreshBtn"/.test(h) && /updatedLabel\(\)/.test(h));
ok('slice 9: sortable roster table in its own scroll container (aria-sort + th buttons)', /class="tscroll"/.test(h) && /aria-sort=/.test(h) && /data-sort=/.test(h) && /table aria-label="Projects"/.test(h));
ok('slice 9: Table ⇄ Cards display toggle persisted (customers.html mobile pattern)', /dds-display:projects/.test(h) && /id="dispTable"/.test(h) && /id="dispCards"/.test(h));
ok('slice 9: roster enrichment uses EXISTING routes only (per-project /report + /studio/customers), no fake numbers', /ensureReports/.test(h) && /ensureCustomers/.test(h) && /\/studio\/customers/.test(h) && /—/.test(h));
ok('slice 9: record page breadcrumb (Projects › name)', /class="crumbs" aria-label="Breadcrumb"/.test(h) && /aria-current="page"/.test(h));
ok('slice 9: highlights panel tiles (Customer · Target · Progress · Waiting · Files)', /class="hl-panel"/.test(h) && /Waiting on client/.test(h) && /class="hl-k"/.test(h));
ok('slice 9: the Path IS the milestones — rendered only when milestones exist, single aria-current step', /pathHtml/.test(h) && /if\(!milestones\.length\)return ''/.test(h) && /aria-current="step"/.test(h) && /findIndex\(m=>m\.status!=='complete'\)/.test(h));
ok('slice 9: the Path action completes the CURRENT milestone via the existing PATCH', /id="msComplete"/.test(h) && /Mark Milestone Complete/.test(h));
ok('slice 9: Status ▾ popup carries the slice-2 contract (aria-haspopup + aria-expanded + Escape + delegated outside-click closer)', /aria-haspopup="menu"/.test(h) && /id="statusMenu"/.test(h) && /aria-expanded/.test(h) && /closest\('\.statusdd'\)/.test(h));
ok('slice 9: tasks are a checkbox list (done ⇄ todo) that keeps the other ladder moves', /data-tdone=/.test(h) && /checked\?'done':'todo'/.test(h) && /data-task=/.test(h));
ok('slice 9: friendly empty states (surveys check-in nudge)', /No surveys yet — /.test(h) && /send a check-in →/.test(h) && /No milestones yet/.test(h) && /No tasks yet/.test(h));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PROJECTS UI (P2-D-5 structural → slice 9): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
