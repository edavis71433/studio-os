// ── Phase J: production activation dashboard contract ────────────────────────
// Locks the shape of `/system/health`'s secret dashboard: every production
// capability group is reported, the derived capability flags exist, and a clean
// environment (no secrets) reports ok:false with the core secrets missing — so
// the owner's activation view can never silently drop a dependency.
//
//   deno run --allow-read --allow-env tests/presence/activation_test.mjs
import { validateSecrets } from '../../supabase/functions/presence/routes/system.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const v = validateSecrets();

// ═══ 1. every production capability group is present ═══
{
  const expected = ['core', 'commerce', 'email', 'hosting', 'approvals', 'ai', 'connected', 'site'];
  ok('dashboard reports every secret group', expected.every((g) => g in v.groups), Object.keys(v.groups).join(','));
  ok('each group lists secrets with name/required/enables/present', Object.values(v.groups).flat().every((s) => s.name && typeof s.required === 'boolean' && s.enables && typeof s.present === 'boolean'));
}

// ═══ 2. the derived "what's live" capability flags exist ═══
{
  const caps = ['platform_boots', 'purchase_and_billing', 'email', 'publishing', 'scheduled_publishing', 'one_tap_approvals', 'ai', 'visual_studio', 'connected_platform', 'stripe_webhooks'];
  ok('capability map reports every product capability', caps.every((c) => c in v.capabilities), Object.keys(v.capabilities).join(','));
  ok('capability flags are booleans', Object.values(v.capabilities).every((x) => typeof x === 'boolean'));
}

// ═══ 3. core secrets are required; everything else degrades gracefully ═══
{
  const core = v.groups.core;
  ok('the 4 core secrets are marked required', core.length === 4 && core.every((s) => s.required));
  ok('non-core secrets are optional (degrade gracefully)', Object.entries(v.groups).filter(([g]) => g !== 'core').flatMap(([, s]) => s).every((s) => !s.required));
}

// ═══ 4. a clean environment fails honestly (no false "activated") ═══
{
  // in this test env no secrets are set → the dashboard must say so, not pretend
  ok('clean env → ok:false (does not falsely report activated)', v.ok === false);
  ok('clean env → core secrets reported missing', v.missing_required.length === 4);
  ok('clean env → no capability falsely live', Object.values(v.capabilities).every((x) => x === false));
}

// ═══ 5. one-tap approvals accept either APPROVAL_SECRET or SCHEDULER_SECRET ═══
{
  const approvals = v.groups.approvals;
  ok('approvals group documents the SCHEDULER_SECRET fallback', approvals.some((s) => /SCHEDULER_SECRET/.test(s.enables)));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
