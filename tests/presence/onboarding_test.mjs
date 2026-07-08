// ── Phase I guided-onboarding core suite ─────────────────────────────────────
// Proves the pure first-run pieces: industry intake + smart default services (so
// the member never types from blank), the EXISTING starter_site writer request
// built + bounded from the intake (no new endpoint), the auto-draft readiness
// gate, and the calm first-success milestones + lessons.
//
//   deno run --allow-read --allow-env tests/presence/onboarding_test.mjs
import {
  ONBOARDING_INDUSTRIES, isOnboardingIndustry, industryLabel, suggestedServices,
  buildStarterRequest, canAutoDraft, firstSuccessMilestones, ONBOARDING_LESSONS,
} from '../../supabase/functions/presence/lib/onboarding.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. industry intake + smart defaults (no blank start) ═══
{
  ok('a range of industries offered (not restaurant-only)', ONBOARDING_INDUSTRIES.length >= 7 && ONBOARDING_INDUSTRIES.some((i) => i.key === 'home_services') && ONBOARDING_INDUSTRIES.some((i) => i.key === 'other'));
  ok('every industry pre-fills starter services', ONBOARDING_INDUSTRIES.every((i) => i.services.length >= 2));
  ok('suggestedServices: known industry', suggestedServices('coffee_shop').includes('Coffee & espresso'));
  ok('suggestedServices: unknown → the catch-all defaults', suggestedServices('nope').length >= 1);
  ok('isOnboardingIndustry / industryLabel', isOnboardingIndustry('salon') && !isOnboardingIndustry('zzz') && industryLabel('restaurant') === 'Restaurant');
}

// ═══ 2. starter_site request built from intake (reuses the writer) ═══
{
  const req = buildStarterRequest({ industry: 'home_services', services: ['Repairs', ' Installation ', '', 'Emergency'], description: 'Family plumbing since 1998', goal: 'get more calls' });
  ok('kind is the EXISTING starter_site (no new system)', req.kind === 'starter_site');
  ok('services trimmed + empties dropped', req.starter.services.length === 3 && req.starter.services[1].name === 'Installation');
  ok('goals combines description + goal, capped', req.starter.goals.includes('Family plumbing') && req.starter.goals.includes('get more calls') && req.starter.goals.length <= 300);
  ok('instructions carry the industry + description, capped', /Home Services/.test(req.instructions) && req.instructions.length <= 600);
  ok('services hard-capped at 12', buildStarterRequest({ industry: 'retail', services: Array.from({ length: 30 }, (_, i) => 'S' + i), description: 'x' }).starter.services.length === 12);
}

// ═══ 3. auto-draft readiness gate ═══
{
  ok('can auto-draft with a service', canAutoDraft({ industry: 'retail', services: ['Shoes'], description: '' }));
  ok('can auto-draft with a real description', canAutoDraft({ industry: 'other', services: [], description: 'We fix bikes fast' }));
  ok('cannot auto-draft from nothing', !canAutoDraft({ industry: 'other', services: [''], description: '' }));
}

// ═══ 4. first-success milestones + lessons (calm, real) ═══
{
  const ms = firstSuccessMilestones();
  ok('milestones cover draft→preview→approve→publish→moment', ms.map((m) => m.key).join(',') === 'drafted,previewed,approved,published,moment');
  ok('each milestone explains WHY (education in place)', ms.every((m) => m.why.length > 15));
  ok('approval milestone reinforces the promise', ms.find((m) => m.key === 'approved').why.toLowerCase().includes('without your'));
  ok('lessons teach approvals/ownership/rollback without a tutorial wall', ['approvals', 'ownership', 'rollback', 'moments', 'ai'].every((k) => ONBOARDING_LESSONS[k] && ONBOARDING_LESSONS[k].length > 20));
  ok('lessons carry no score/dashboard vocabulary (Law 13)', !/\b(score|grade|dashboard|rank)\b/i.test(Object.values(ONBOARDING_LESSONS).join(' ')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
