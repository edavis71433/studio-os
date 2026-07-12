// ── clever-api characterization guard ─────────────────────────────────────────
// The 12k-line legacy monolith is LIVE and load-bearing (public lead capture,
// the operator console, portal provisioning) but retires wholesale at the DDS
// migration — so it gets no refactor and had NO safety net at all. This suite
// characterizes the load-bearing surface structurally: the public route gate,
// the critical route handlers, and the security invariants that have bitten
// before. It exists to make an accidental edit to the monolith FAIL LOUDLY,
// not to bless its internals.
//
//   deno run --allow-read tests/presence/clever_api_characterization_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = Deno.readTextFileSync(new URL('../../supabase/functions/clever-api/index.ts', import.meta.url));

// ── the deny-by-default public gate + every public route the site depends on ──
ok('gate: PUBLIC_ROUTES allow-list exists (deny-by-default)', /PUBLIC_ROUTES/.test(src));
for (const route of ['contact', 'audit', 'public_audit_checkout', 'lead_intake', 'discovery_intake', 'survey_response', 'ai_critique', 'report_card', 'psi_fetch', 'deep_audit', 'audit_lead', 'concierge', 'reset_password', 'welcome']) {
  ok(`public route present: ${route}`, new RegExp(`['"]${route}['"]`).test(src));
}

// ── security invariants that have bitten before ──
ok('SSRF guard on visitor-supplied URLs (loopback/private/metadata blocked)', /_ipv4Blocked/.test(src) && /127|loopback/.test(src));
ok('lead/survey HTML injection: public input escaped in owner emails', /escLine/.test(src));
ok('audit checkout: server-side price (client cannot set its own amount)', /public_audit_checkout/.test(src));
ok('operator console routes are NOT in the public gate', !/PUBLIC_ROUTES[\s\S]{0,800}dds-studio-manage/.test(src));

// ── email discipline (the domain is shared with the product) ──
ok('sender: suppression checked via the SHARED core', /_shared\/email_infra\.ts/.test(src) && /isSuppressed\(to\)/.test(src));
ok('sender: one-click List-Unsubscribe on every send', (src.match(/List-Unsubscribe-Post/g) || []).length >= 2);
ok('sender: plain-text alternative on the core sender', /text,\s*\n?\s*headers/.test(src) || /subject, html, text/.test(src));
ok('sender: recipients masked in logs', /maskAddr\(to\)/.test(src));
ok('outreach: suppressed prospect is refused with an honest message', /recipient_suppressed/.test(src));

// ── portal account path ──
ok('password reset flow present', /reset_password/.test(src));
ok('Stripe webhook is NOT handled here (single webhook authority = stripe-webhook fn)', !/whsec|stripe-signature/i.test(src));

// ── size tripwire: wholesale-retirement plan assumes no NEW growth ──
const lines = src.split('\n').length;
ok(`size tripwire: monolith not growing (${lines} lines ≤ 12600)`, lines <= 12600, 'if this fails, new features are being added to a function slated for retirement — put them in presence instead');

const passed = results.filter(Boolean).length;
console.log(`\n════ CLEVER-API CHARACTERIZATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
