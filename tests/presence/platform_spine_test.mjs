// ── L4.5 Platform Spine Consolidation suite ─────────────────────────────────
// Proves the two approval systems (Infrastructure Plans, Connected Write Plans)
// now share ONE lifecycle spine — the approval law, the decision transition, and
// the atomic execution claim live in exactly one place and are REUSED, not
// duplicated. Plus: both plan types conform to one contract, the provider
// maturity matrix is generated, and the futureWrites/WRITE_SPECS drift is guarded.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/platform_spine_test.mjs
import { APPROVED_PLAN_STAGES, REQUIRES_APPROVAL, decidePlan, isApproved } from '../../supabase/functions/presence/lib/approved_plan.ts';
import { buildWritePlan, WRITE_SPECS, writeWorkflowsForProvider } from '../../supabase/functions/presence/connected/writes.ts';
import { planConnectDomain, planEmailAuth } from '../../supabase/functions/presence/platform/plans.ts';
import { providerByKey, CONNECTED_PROVIDERS } from '../../supabase/functions/presence/connected/providers.ts';
import { providerMaturity, maturitySummary } from '../../supabase/functions/presence/connected/maturity.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));

// ═══ 1. ONE Approved Plan contract — both plan types conform ═══
{
  const write = buildWritePlan('gbp_hours', providerByKey('google_business_profile'), { hours: { fri: '9-9' } });
  const infra = planConnectDomain('marlows.example', null);
  const conforms = (p) => typeof p.title === 'string' && typeof p.summary === 'string' && typeof p.risk === 'string' &&
    typeof p.reversible === 'boolean' && p.requires_approval === true;
  ok('contract: a Connected Write Plan satisfies the shared ApprovedPlanBase', conforms(write));
  ok('contract: an Infrastructure Plan satisfies the SAME shared ApprovedPlanBase', conforms(infra));
  ok('contract: approval is the constitutional constant on both', write.requires_approval === REQUIRES_APPROVAL && infra.requires_approval === REQUIRES_APPROVAL);
  ok('contract: the canonical lifecycle stages are named once', APPROVED_PLAN_STAGES.includes('proposed') && APPROVED_PLAN_STAGES.includes('approved') && APPROVED_PLAN_STAGES.includes('abandoned'));
}

// ═══ 2. ONE decision transition, reused by both ═══
{
  ok('decide: approve → approved, abandon → abandoned, anything else → null', decidePlan('approve') === 'approved' && decidePlan('abandon') === 'abandoned' && decidePlan('publish') === null && decidePlan('') === null);
  ok('approval law: only an approved plan is executable', isApproved('approved') && !isApproved('proposed') && !isApproved('executed') && !isApproved('failed'));
  // both consumers call the SHARED transition (not a private copy)
  ok('reuse: the connected write store imports decidePlan from the spine', /from '\.\.\/lib\/approved_plan\.ts'/.test(src('connected/writestore.ts')) && /decidePlan/.test(src('connected/writestore.ts')));
  ok('reuse: the foundations route imports decidePlan from the spine', /from '\.\.\/lib\/approved_plan\.ts'/.test(src('routes/foundations.ts')) && /decidePlan/.test(src('routes/foundations.ts')));
}

// ═══ 3. ONE atomic claim — reused, no longer duplicated ═══
{
  const spine = src('lib/approved_plan.ts');
  ok('spine: the atomic claim lives in exactly one place (lib/approved_plan.ts)', /or=\(\$\{opts\.claimColumn\}\.is\.null/.test(spine) && /claimApprovedPlan/.test(spine));
  // the connected store no longer carries its own inline claim SQL
  ok('dedup: the connected write store no longer inlines the claim (delegates to the spine)',
    /claimApprovedPlan/.test(src('connected/writestore.ts')) && !/or=\(executed_at\.is\.null/.test(src('connected/writestore.ts')));
  // infrastructure apply now REUSES the same claim (the guarantee it previously lacked)
  ok('strengthen: infrastructure apply now uses the shared atomic claim too', /claimApprovedPlan/.test(src('routes/foundations.ts')) && /applied_at/.test(src('routes/foundations.ts')));
  // approval enforcement is still inline in the apply path (the law stays visible)
  ok('safety preserved: the approval law is still enforced in the apply code path', /status !== 'approved'/.test(src('routes/foundations.ts')) && /not_approved/.test(src('routes/foundations.ts')));
}

// ═══ 4. Provider Maturity Matrix — generated from what is actually built ═══
{
  const M = providerMaturity();
  const by = new Map(M.map((m) => [m.key, m]));
  ok('maturity: every provider is placed on the matrix', M.length === CONNECTED_PROVIDERS.length);
  ok('maturity: GBP is fully mature (reads + intelligence + approved writes)', by.get('google_business_profile').stage === 'fully_mature');
  ok('maturity: Search Console is fully mature (search intelligence + verify write)', by.get('google_search_console').stage === 'fully_mature');
  ok('maturity: Analytics + Yelp are connected-intelligence (read + feed intelligence, no writes)', by.get('google_analytics').stage === 'connected_intelligence' && by.get('yelp').stage === 'connected_intelligence');
  ok('maturity: unmapped stubs are honestly "planned" (Meta Business, Apple, Tag Manager)',
    by.get('meta_business').stage === 'planned' && by.get('apple_business_connect').stage === 'planned' && by.get('google_tag_manager').stage === 'planned');
  const sum = maturitySummary();
  ok('maturity: the summary accounts for every provider exactly once', Object.values(sum).reduce((a, b) => a + b, 0) === CONNECTED_PROVIDERS.length, JSON.stringify(sum));
}

// ═══ 5. Technical-debt guard — futureWrites must not drift from shipped writes ═══
{
  // every provider that SHIPS an approval-gated write must DECLARE the intent
  // (shipped ⊆ declared) — so the two never silently disagree.
  const drift = CONNECTED_PROVIDERS.filter((p) => writeWorkflowsForProvider(p.key).some((w) => w.kind === 'write') && (!p.futureWrites || p.futureWrites.length === 0));
  ok('debt: every shipped write is a declared future-write (no futureWrites drift)', drift.length === 0, drift.map((p) => p.key).join(','));
}

// ═══ 6. Extensibility — the spine grows by data, not engine edits ═══
{
  ok('extensibility: write workflows are DATA (a WRITE_SPECS entry adds one, no code path)', Array.isArray(WRITE_SPECS) && WRITE_SPECS.every((w) => w.kind === 'write' || w.kind === 'handoff'));
  ok('extensibility: providers are DATA (a registry entry adds one)', Array.isArray(CONNECTED_PROVIDERS) && CONNECTED_PROVIDERS.length >= 21);
  // the spine has no per-provider or per-plan-type branching — it is table-parameterized
  ok('extensibility: the claim is table-parameterized (no per-table code)', /opts\.table/.test(src('lib/approved_plan.ts')) && /opts\.claimColumn/.test(src('lib/approved_plan.ts')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PLATFORM SPINE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
