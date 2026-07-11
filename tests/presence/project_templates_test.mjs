// ── Project starter templates (A4) — pure ────────────────────────────────────
//   deno run --allow-read tests/presence/project_templates_test.mjs
import { PROJECT_TEMPLATES, templateByKey, templateChoices } from '../../supabase/functions/presence/lib/project_templates.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

ok('there is at least one template', PROJECT_TEMPLATES.length >= 1);
ok('templateByKey finds a known key', templateByKey('website')?.key === 'website');
ok('templateByKey returns null for an unknown key', templateByKey('nope') === null);
ok('templateByKey tolerates empty/garbage', templateByKey('') === null);

const web = templateByKey('website');
ok('website template has milestones', !!web && web.milestones.length >= 3);
ok('every milestone has a non-empty title', web.milestones.every((m) => typeof m.title === 'string' && m.title.trim().length > 0));
ok('every task has a non-empty title', web.milestones.every((m) => (m.tasks || []).every((t) => t.title && t.title.trim().length > 0)));
ok('at least one task is a client action (surfaces to the customer)', web.milestones.some((m) => (m.tasks || []).some((t) => t.client_action_required === true)));
ok('client-action flag is boolean-or-absent (never a truthy string)', web.milestones.every((m) => (m.tasks || []).every((t) => t.client_action_required === undefined || typeof t.client_action_required === 'boolean')));

const choices = templateChoices();
ok('choices expose key+label only', choices.length === PROJECT_TEMPLATES.length && choices.every((c) => c.key && c.label && Object.keys(c).length === 2));

// safety: nothing in the scaffold is a website-publishing action or destructive verb
const allTitles = web.milestones.flatMap((m) => [m.title, ...(m.tasks || []).map((t) => t.title)]).join(' ').toLowerCase();
ok('scaffold copy is calm/plain (no jargon like "CMS"/"deploy")', !/\bcms\b|\bdeploy\b|\bapi\b/.test(allTitles));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PROJECT TEMPLATES (A4 pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
