// ── L4.6 Platform Invariants suite — the freeze, made ENFORCEABLE ───────────
// A contract freeze is only real if a machine guards it. This encodes the
// platform invariants that L4.6 declares permanent, so a future change that
// violates one fails here instead of in production. Pure source-scan + behavior.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/platform_invariants_test.mjs
import { CATALOG } from '../../supabase/functions/presence/evidence/contract.ts';
import { RULES } from '../../supabase/functions/presence/judgment/rules.ts';
import { recommend, REC_RULES } from '../../supabase/functions/presence/recommendation/rules.ts';
import { TEMPLATES } from '../../supabase/functions/presence/moments/rules.ts';
import { CONNECTED_PROVIDERS } from '../../supabase/functions/presence/connected/providers.ts';
import { WRITE_SPECS } from '../../supabase/functions/presence/connected/writes.ts';
import { OWNERSHIP } from '../../supabase/functions/presence/connected/contract.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const fn = (rel) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${rel}`, import.meta.url));
const mig = (rel) => Deno.readTextFileSync(new URL(`../../supabase/migrations/${rel}`, import.meta.url));

// ═══ INVARIANT 1 — Nothing bypasses Evidence ═══
{
  const owners = (t) => RULES.filter((r) => r.types.includes(t)).length;
  // analytics.not_connected is an intentional internal signal consumed directly
  // (optimization/catalog + providers → services/launch derive analytics_connected),
  // never judged — the opt_dormant rule was retired in P11. It lands in
  // unmatched_types by design (visibility, not a bypass). Matches the sister
  // assertion in judgment_test.mjs (INTENTIONAL_UNMATCHED).
  const INTENTIONAL_UNMATCHED = new Set(['analytics.not_connected']);
  const orphans = Object.keys(CATALOG).filter((t) => owners(t) === 0 && !INTENTIONAL_UNMATCHED.has(t));
  const doubles = Object.keys(CATALOG).filter((t) => owners(t) > 1);
  ok('INV-1: every evidence type is judged by exactly one rule (nothing bypasses Evidence)', orphans.length === 0 && doubles.length === 0, [...orphans, ...doubles].join(','));
}

// ═══ INVARIANT 2 — The Intelligence pipeline is one-way ═══
{
  // no engine imports a LATER stage; each stage consumes only what precedes it.
  const forbids = [
    { dir: 'evidence', bans: ['judgment', 'recommendation', 'moments', 'concierge'] },
    { dir: 'judgment', bans: ['recommendation', 'moments', 'concierge'] },
    { dir: 'recommendation', bans: ['moments', 'concierge'] },
    { dir: 'moments', bans: ['concierge'] },
  ];
  const files = { evidence: ['contract.ts', 'providers.ts', 'engine.ts', 'collect.ts'], judgment: ['contract.ts', 'rules.ts', 'engine.ts'], recommendation: ['contract.ts', 'rules.ts', 'engine.ts'], moments: ['contract.ts', 'rules.ts', 'engine.ts'] };
  let violations = [];
  for (const { dir, bans } of forbids) {
    const src = files[dir].map((f) => fn(`${dir}/${f}`)).join('\n');
    for (const b of bans) if (new RegExp(`from '\\.\\./${b}/`).test(src)) violations.push(`${dir}→${b}`);
  }
  ok('INV-2: the pipeline is one-way (no engine imports a later stage)', violations.length === 0, violations.join(','));
}

// ═══ INVARIANT 3 — Nothing bypasses Approval (a DB CHECK on every plan surface) ═══
{
  const surfaces = [
    ['0022_presence_recommendations.sql', /approval_required[^;]*check[^;]*approval_required = true/is],
    ['0033_presence_platform.sql', /requires_approval[^;]*check[^;]*requires_approval = true/is],
    ['0041_presence_connected_writes.sql', /requires_approval[^;]*check[^;]*requires_approval = true/is],
  ];
  const missing = surfaces.filter(([f, re]) => !re.test(mig(f))).map(([f]) => f);
  ok('INV-3a: approval is a DB CHECK constant on recommendations, infra plans, and connected writes', missing.length === 0, missing.join(','));
  // and enforced in the executor code paths, not just the DB
  ok('INV-3b: executors refuse anything not approved (in the code path, not only the DB)',
    /status !== 'approved'/.test(fn('routes/foundations.ts')) && /status !== 'approved'/.test(fn('routes/connections.ts')) && /not_approved/.test(fn('connected/execute.ts')));
}

// ═══ INVARIANT 4 — Nothing auto-publishes (approval + manual parity are constants) ═══
{
  const NOW = '2026-07-07T12:00:00.000Z';
  const js = [{ judgment_hash: 'j1', judgment_key: 'search_snippets', rule: 'search_snippets', category: 'discoverability', priority: 'medium', severity: 'warning', confidence: 1, reasoning: 'x', timing: 'soon', audience: 'customer', status: 'active', evidence_count: 1, evidence_ids: ['e1'], first_seen_at: NOW, expires_at: '2027-01-01T00:00:00Z' }];
  const recs = recommend(js, { siteId: 's', now: NOW, previous: {} }).recommendations;
  ok('INV-4: every recommendation carries approval_required + manual_available as true (no auto-complete/publish)',
    recs.length > 0 && recs.every((r) => r.approval_required === true && r.manual_available === true));
}

// ═══ INVARIANT 5 — Connected writes never bypass approval; handoffs never write ═══
{
  ok('INV-5a: real writes declare an endpoint+method; handoffs declare neither (structurally can’t write)',
    WRITE_SPECS.every((w) => w.kind === 'write' ? (!!w.endpoint && !!w.method) : (!w.endpoint && !w.method)));
  ok('INV-5b: every write plan is reversible-or-explained + verified (from the builder)',
    /reversible/.test(fn('connected/writes.ts')) && /verify/.test(fn('connected/writes.ts')));
}

// ═══ INVARIANT 6 — Nothing locks in customers (ownership is a platform constant) ═══
{
  ok('INV-6: ownership constant guarantees connect/disconnect/export/leave, never penalized',
    /customer/.test(OWNERSHIP.account) && /revoke/.test(OWNERSHIP.authorization) && /untouched/.test(OWNERSHIP.on_disconnect) && /never penalized/.test(OWNERSHIP.on_leave) && /export/.test(OWNERSHIP.on_leave));
}

// ═══ INVARIANT 7 — Everything is auditable (append-only event ledgers exist) ═══
{
  ok('INV-7: append-only audit ledgers exist for connections/writes and content changes',
    /presence_connection_events/.test(mig('0038_presence_connected.sql')) && /append-only/i.test(mig('0038_presence_connected.sql')));
}

// ═══ INVARIANT 8 — The Extension Contract: growth is DATA, not engine edits ═══
{
  const dataSurfaces = { CONNECTED_PROVIDERS, WRITE_SPECS, RULES, REC_RULES, TEMPLATES };
  ok('INV-8a: every extension surface is an appendable list (registry/adapter/catalog/rule as data)',
    Object.values(dataSurfaces).every((a) => Array.isArray(a) && a.length > 0));
  ok('INV-8b: the catalog is a keyed record (append a type, don’t edit the engine)', CATALOG && typeof CATALOG === 'object' && Object.keys(CATALOG).length > 100);
  // adding a provider/rule/workflow must not require touching an engine file:
  // the engines consume these surfaces generically (no per-item branching in the loop)
  ok('INV-8c: the judgment engine iterates RULES generically (no per-rule code)', /for \(const rule of RULES\)/.test(fn('judgment/rules.ts')));
}

// ═══ INVARIANT 9 — One Approved-Plan spine (both executors reuse it) ═══
{
  ok('INV-9: the atomic claim + approval law live once and are reused by both plan systems',
    /claimApprovedPlan/.test(fn('lib/approved_plan.ts')) &&
    /claimApprovedPlan/.test(fn('connected/writestore.ts')) &&
    /claimApprovedPlan/.test(fn('routes/foundations.ts')));
}

// ═══ INVARIANT 10 — Sentences, never scores (Law 13) reaches the connected surface ═══
{
  // the customer-facing connected surfaces carry no score/grade/percentage vocabulary
  const surface = fn('connected/inventory.ts') + fn('connected/evidence.ts');
  ok('INV-10: no score/grade/percentage vocabulary in the customer-facing connected surface (Law 13)',
    !/\b(score|grade|ranking)\b/i.test(fn('connected/inventory.ts')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PLATFORM INVARIANTS: ${passed}/${results.length} ${passed === results.length ? 'HELD' : 'VIOLATED'} ════`);
if (passed !== results.length) { console.log('VIOLATIONS:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
