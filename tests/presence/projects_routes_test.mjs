// ── Projects routes: tenant isolation + structural wiring (P2-D) ─────────────
//   deno run --allow-read tests/presence/projects_routes_test.mjs
// Proves the SECURITY-critical properties structurally (no live DB): every table
// access is site-scoped, writes are studio-only, the client side is filtered to
// client_visible, transitions are guarded, and the migration is sound.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const proj = read('supabase/functions/presence/routes/projects.ts');
const idx = read('supabase/functions/presence/index.ts');
const mig = read('supabase/migrations/0075_p2d_service_delivery.sql');
const feat = read('supabase/functions/presence/middleware/feature.ts');
const wsp = read('supabase/functions/presence/routes/workspace.ts');
const lib = read('supabase/functions/presence/lib/service_delivery.ts');

// ── TENANT ISOLATION: every table access is site-scoped ──
{
  const tables = ['presence_projects', 'presence_milestones', 'presence_tasks', 'presence_project_events'];
  for (const t of tables) {
    const re = new RegExp(`${t}\\?[^\\\`]*`, 'g');
    const uses = proj.match(re) || [];
    const unscoped = uses.filter((u) => !/site_id=eq\.|id=eq\.\$\{project\.id\}/.test(u)); // events/tasks scope via site_id; the orphan-cleanup PATCH targets our own just-created project id
    ok(`tenant: every ${t} query is site-scoped (${uses.length} uses)`, unscoped.length === 0, unscoped[0] || '');
  }
  ok('tenant: inserts carry site_id explicitly', /site_id: site\.id/.test(proj));
  ok('tenant: deal handoff lookup is site-scoped', /presence_deals\?id=eq\.\$\{dealId\}&site_id=eq\.\$\{site\.id\}/.test(proj));
}

// ── STUDIO-ONLY WRITES + client-visibility filter ──
ok('perms: role-based studio check (client_reviewer = client side, not agency-only)', /resolveSiteRole\(jwt, site\.id, principal\.kind\)\) !== 'client_reviewer'/.test(proj));
ok('perms: every write path guards studioDenied (POST/PATCH/status/tasks/milestones)', (proj.match(/if \(!studio\) return studioDenied\(cors\)/g) || []).length >= 4 || (/if \(!\(await isStudioSide[\s\S]*?\)\)\) return studioDenied/.test(proj) && (proj.match(/studioDenied\(cors\)/g) || []).length >= 5));
ok('vis: project list filters client side to client_visible', /if \(!studio\) path \+= `&client_visible=is\.true`/.test(proj));
ok('vis: a non-visible project is 404 for the client side', /!studio && !project\.client_visible\)\) return json\(\{ error: 'not_found'/.test(proj));
ok('vis: detail bundle filters milestones/tasks/events via forViewer', (proj.match(/forViewer\(/g) || []).length >= 3);
ok('vis: progress for the client counts only client_visible tasks', /studio \? tasksAll : tasksAll\.filter\(\(t\) => t\.client_visible === true\)/.test(proj));

// ── GUARDED TRANSITIONS (optimistic prior-state guard in WHERE) ──
ok('integrity: project status move guards the prior status in WHERE', /presence_projects\?id=eq\.\$\{id\}&site_id=eq\.\$\{site\.id\}&status=eq\.\$\{project\.status\}/.test(proj) && /canProjectTransition\(project\.status, to\)/.test(proj));
ok('integrity: task status move guards the prior status in WHERE', /presence_tasks\?id=eq\.\$\{taskId\}&site_id=eq\.\$\{site\.id\}&status=eq\.\$\{task\.status\}/.test(proj) && /canTaskTransition\(task\.status, to\)/.test(proj));
ok('integrity: task done stamps completed_at, reopen clears it', /completed_at: to === 'done' \? nowIso\(\) : null/.test(proj));

// ── IDEMPOTENT convert→project handoff ──
ok('idempotent: create-from-deal returns existing when already handed off', /deal\.created_project_id\)[\s\S]*?idempotent: true/.test(proj));
ok('idempotent: handoff stamp is claimed under created_project_id=is.null (race-safe)', /created_project_id=is\.null&select=id`, \{ method: 'PATCH'/.test(proj));
ok('idempotent: a losing racer drops its orphan project and returns the winner', /deleted_at: nowIso\(\)[\s\S]*?idempotent: true/.test(proj));
ok('idempotent: DB unique index on created_project_id', /presence_deals_created_project_uq[\s\S]*?created_project_id.*where created_project_id is not null/.test(mig));

// ── EVENT LOG on every meaningful change ──
ok('events: created/status/task/milestone changes are recorded', ['project_created', 'status_change', 'task_created', 'task_status_change', 'milestone_created', 'milestone_completed'].every((k) => proj.includes(`'${k}'`)));

// ── VALIDATION: dates + bounded fields ──
ok('validation: dates are YYYY-MM-DD (422, not 502)', /DATE_RE = \//.test(proj) && /Dates must be YYYY-MM-DD/.test(proj));
ok('validation: control chars stripped with the SAFE escaped class (no reversed range)', /\/\[\\u0000-\\u0008\\u000B-\\u001F\\u007F\]\/g/.test(proj));
ok('validation: client_action_required implies client_visible', /client_action_required === true[\s\S]*?client_visible: clientVisible|patch\.client_visible = true/.test(proj));

// ── FEATURE GATE + REVIEWER BOUNDARY ──
ok('gate: authed /projects gated to the relationship edition (like /crm, /sales)', /case 'projects':[\s\S]{0,40}return 'relationship'/.test(feat));
ok('reviewer: client_reviewer may READ its visible projects (GET /projects + GET /projects/:id)', /route === '\/projects'\) return true/.test(wsp) && /\^\\\/projects\\\/\[0-9a-f-\]\{36\}\$\/\.test\(route\)\) return true/.test(wsp));
ok('reviewer: cannot create/modify projects, tasks, milestones, or project status (only read + reply + decide + download)', (() => { const fn = wsp.match(/export function reviewerAllowed[\s\S]*?\n\}/)?.[0] || ''; return !fn.includes('/tasks') && !fn.includes('/milestones') && !/projects[\s\S]{0,60}status/.test(fn) && !/method === 'POST' && route === '\/projects'/.test(fn); })());

// ── WIRING ──
ok('wiring: /projects dispatched after the feature gate + reviewer boundary', idx.includes("route === '/projects') return handleProjects") && idx.indexOf('featureForRoute(route, method)') < idx.indexOf("route === '/projects'"));
ok('wiring: nested task + milestone routes dispatched', idx.includes('\\/tasks\\/([0-9a-f-]{36})$/') && idx.includes('\\/milestones\\/([0-9a-f-]{36})$/') && idx.includes('handleTask(') && idx.includes('handleMilestone('));

// ── MIGRATION: tables, RLS, FKs, indexes ──
{
  for (const t of ['presence_projects', 'presence_milestones', 'presence_tasks', 'presence_project_events']) {
    ok(`migration: ${t} exists, site_id-scoped, RLS enabled`, new RegExp(`create table if not exists public\\.${t}[\\s\\S]*?site_id uuid not null references public\\.presence_sites`).test(mig) && new RegExp(`alter table public\\.${t} enable row level security`).test(mig));
  }
  ok('migration: bounded project + task status CHECKs', /check \(status in \('active','on_hold','complete','archived'\)\)/.test(mig) && /check \(status in \('todo','in_progress','blocked','done'\)\)/.test(mig));
  ok('migration: tasks default INTERNAL (client_visible default false)', /client_visible boolean not null default false/.test(mig));
  ok('migration: project/task/milestone pagination + status indexes present', /presence_projects_site_status_idx/.test(mig) && /presence_tasks_project_status_idx/.test(mig) && /presence_milestones_project_idx/.test(mig));
  ok('migration: cascade on project delete for children', /project_id uuid not null references public\.presence_projects\(id\) on delete cascade/.test(mig));
  ok('migration: rollback block present', /drop table if exists public\.presence_projects;/.test(mig) && /drop column if exists created_project_id/.test(mig));
}

// ── PURE LIB is genuinely pure (no DB/network) ──
ok('lib: service_delivery.ts imports nothing (pure)', !/^import /m.test(lib));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PROJECTS ROUTES (P2-D wiring/tenant): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
