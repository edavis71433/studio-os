// ── projects.html: Studio App surface structural checks (P2-D-5) ─────────────
//   deno run --allow-read tests/presence/projects_ui_test.mjs
// Not a browser test (that's Phase 6 Gold Master). Confirms the page is on the
// ONE shared shell, uses the portal auth realm, wires to the real /projects/*
// endpoints, and avoids anti-patterns (prompt/alert, a second config).
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const h = read('projects.html');
const nav = read('supabase/functions/presence/lib/navigation.ts');

ok('shell: loads the ONE shared shell (shell.js + shell.css)', /src="\/shell\.js"/.test(h) && /href="\/shell\.css"/.test(h));
ok('auth: uses the portal auth realm (dds-portal-auth) + supabase-js', /storageKey:'dds-portal-auth'/.test(h) && /supabase-js@2\.45\.4/.test(h));
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
ok('ux: detail view redesigned into a roomy two-column layout (overview + sections)', /class="dgrid/.test(h) && /class="dside"/.test(h) && /class="dmain"/.test(h) && /#detailWrap\{max-width/.test(h));
ok('FIX B: a customer’s general (project-less) messages surface inside their view', /loadClientGeneral/.test(h) && /\/client-messages/.test(h) && /id="genList"/.test(h));
ok('nav: Projects is a primary outcome, gated to the relationship area', /single\('projects', 'Projects', '\/projects\.html'\)/.test(nav) && /if \(f\.hasRelationship\) single\('projects'/.test(nav));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PROJECTS UI (P2-D-5 structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
