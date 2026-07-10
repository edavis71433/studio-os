// ── Surveys & Support routes: structural security (P2-D-4) ───────────────────
//   deno run --allow-read tests/presence/service_intake_routes_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const si = read('supabase/functions/presence/routes/service_intake.ts');
const idx = read('supabase/functions/presence/index.ts');
const mig = read('supabase/migrations/0078_p2d_surveys_support.sql');
const wsp = read('supabase/functions/presence/routes/workspace.ts');
const lib = read('supabase/functions/presence/lib/intake.ts');

// tenant scoping
for (const t of ['presence_surveys', 'presence_survey_responses', 'presence_support_requests', 'presence_support_messages']) {
  const uses = si.match(new RegExp(`${t}\\?[^\\\`]*`, 'g')) || [];
  const unscoped = uses.filter((u) => !/site_id=eq\.\$\{site\.id\}/.test(u));
  ok(`tenant: every ${t} query is site-scoped (${uses.length} uses)`, unscoped.length === 0, unscoped[0] || '');
}

// permissions
ok('perms: survey create is studio-only', /handleProjectSurveys[\s\S]*?if \(!studio\) return studioDenied\(cors\)/.test(si) && si.includes("svc('presence_surveys', { method: 'POST'"));
ok('perms: support triage (PATCH) is studio-only', /PATCH[\s\S]{0,120}if \(!studio\) return studioDenied/.test(si));
ok('perms: the client sees only its OWN support requests', /if \(!studio\) path \+= `&requester=eq\.\$\{encodeURIComponent\(readerKey\(principal\)\)\}`/.test(si));
ok('perms: loadSupport refuses another requester’s request for the client side', /if \(!studio && r\.requester !== readerKey\(principal\)\) return null/.test(si));
ok('perms: a client survey view is limited to active + client_visible', /!studio && !\(survey\.client_visible && survey\.status === 'active'\)/.test(si));

// idempotent survey submission
ok('idempotent: one submitted response per respondent (checked + unique index + race-safe)', /status=eq\.submitted&select=id&limit=1[\s\S]*?already: true/.test(si) && /presence_survey_responses_uq[\s\S]*?where status = 'submitted'/.test(mig));

// support status ladder guarded
ok('integrity: support status transitions are guarded (canSupportTransition)', /canSupportTransition\(reqRow\.status, b\.status\)/.test(si));
ok('integrity: resolve stamps resolved_at; reopen clears it', /b\.status === 'resolved' \? nowIso\(\) : \(b\.status === 'open' \? null/.test(si));

// project-linked items feed the ONE activity log
ok('activity: survey + support events written to project_events when project-linked', /'survey_requested'/.test(si) && /'survey_submitted'/.test(si) && /'support_opened'/.test(si) && /'support_resolved'/.test(si) && /'support_message'/.test(si));

// attachments reuse the media store, validated in-site
ok('attach: support message attachment validated in-site', /presence_media\?id=eq\.\$\{attachment\}&site_id=eq\.\$\{site\.id\}/.test(si));

// reviewer boundary: client submits/replies but cannot triage
ok('reviewer: client submits/lists/views surveys + support + replies', wsp.includes('respond$/.test(route)) return true') && wsp.includes("route === '/support' && (method === 'GET' || method === 'POST')) return true") && wsp.includes('messages$/.test(route)) return true'));
ok('reviewer: PATCH /support (triage) is NOT reviewer-allowed', (() => { const fn = wsp.match(/export function reviewerAllowed[\s\S]*?\n\}/)?.[0] || ''; return !/PATCH[\s\S]{0,40}support/.test(fn); })());

// wiring + migration + pure lib
ok('wiring: survey + support routes dispatched', idx.includes('handleProjectSurveys(') && idx.includes('handleSurveyRespond(') && idx.includes('handleSupport(') && idx.includes('handleSupportOne(') && idx.includes('handleSupportMessage('));
ok('migration: 4 tables site-scoped + RLS', ['presence_surveys', 'presence_survey_responses', 'presence_support_requests', 'presence_support_messages'].every((t) => new RegExp(`create table if not exists public\\.${t}[\\s\\S]*?site_id uuid not null references public\\.presence_sites`).test(mig) && new RegExp(`alter table public\\.${t} enable row level security`).test(mig)));
ok('migration: support status + priority CHECKs', /check \(status in \('open','in_progress','resolved','closed'\)\)/.test(mig) && /check \(priority in \('low','normal','high','urgent'\)\)/.test(mig));
ok('migration: activity vocabulary extended for surveys + support', /'survey_requested','survey_submitted','support_opened','support_message','support_resolved'/.test(mig));
ok('migration: rollback present', /drop table if exists public\.presence_surveys;/.test(mig));
ok('lib: intake.ts is pure (no imports)', !/^import /m.test(lib));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SURVEYS & SUPPORT ROUTES (P2-D-4): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
