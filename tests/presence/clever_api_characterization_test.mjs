// ── clever-api characterization guard ─────────────────────────────────────────
// The old monolith is still LIVE for a few things (the Growth page, the contact
// form, the project survey, the help chat and one nightly job) but retires
// wholesale later — so it gets no refactor. This suite characterizes what is left
// structurally: the deny-by-default gate, the request kinds it still answers and
// who sends each one, and the security invariants that have bitten before. It
// exists to make an accidental edit to the monolith FAIL LOUDLY, not to bless its
// internals.
//
//   deno run --allow-read tests/presence/clever_api_characterization_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (rel) => Deno.readTextFileSync(new URL(`../../${rel}`, import.meta.url));
const src = read('supabase/functions/clever-api/index.ts');

// ── builder item 213: the old server keeps only the requests something still sends ──
// Every kind below has a sender today; the 123 others were removed (Nov 12 2026) after a
// repo-wide search and seven days of the function's own request log showed none.
const SENT_BY = {
  whoami: ['studio.html', 'portal.html', 'set-password.html', 'admin-growth.html'],
  version: ['.github/workflows/deploy.yml', '.github/workflows/rollback.yml'],   // the deploy's smoke test
  lead_intake: ['contact.html'],
  survey_response: ['project-survey.html'],
  concierge: ['concierge.js'],
  run_scheduled_jobs: ['supabase/ops/clever-api-legacy/02-schedule-cron.sql'],   // the nightly-data-sync job
};
const GROWTH = ['admin_query', 'partnership_dashboard', 'partnership_list', 'partnership_get', 'partnership_upsert',
  'partnership_delete', 'reminders_feed', 'review_upsert', 'review_draft', 'review_publish', 'rec_decide', 'rec_to_task',
  'rec_generate', 'rec_upsert', 'note_delete', 'note_upsert', 'goal_upsert', 'worklog_upsert', 'content_upsert', 'health_upsert'];
for (const k of GROWTH) SENT_BY[k] = ['admin-growth.html'];

const answered = [...new Set([...src.matchAll(/if \(type === '([a-z_0-9]+)'\)/g)].map((m) => m[1]))].sort();
ok('it answers exactly the kinds something still sends', JSON.stringify(answered) === JSON.stringify(Object.keys(SENT_BY).sort()),
  `extra: ${answered.filter((k) => !SENT_BY[k]).join(', ') || 'none'}; missing: ${Object.keys(SENT_BY).filter((k) => !answered.includes(k)).join(', ') || 'none'}`);
// a page only counts as a sender if the public build ships it
const build = read('scripts/build-public.sh');
const unshipped = new Set([...build.matchAll(/for f in ([^;]+); do\s*\n\s*rm -f "dist\/\$f"/g)].flatMap((m) => m[1].trim().split(/\s+/)));
ok('the retired pages are still left out of the build (so they send nothing)', ['audit.html', 'ai-critique.html', 'report-card.html', 'buy-audit.html', 'provision.html'].every((f) => unshipped.has(f)));
for (const [kind, senders] of Object.entries(SENT_BY)) {
  const found = senders.filter((f) => { try { return new RegExp(`['"]${kind}['"]`).test(read(f)) || (kind === 'version' && /"type":"version"/.test(read(f))); } catch { return false; } });
  ok(`sender: ${kind} ← ${found.join(', ') || 'NONE'}`, found.length === senders.length && found.every((f) => !unshipped.has(f)));
}
ok('sender: concierge.js is loaded by a page the build ships', /src="\/concierge\.js"/.test(read('portal-terms.html')) && !unshipped.has('portal-terms.html'));

// ── the deny-by-default gate ──
const setOf = (name) => { const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`)); return m ? [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]).sort() : null; };
ok('gate: PUBLIC_ROUTES is the six public kinds, each guarded inside', JSON.stringify(setOf('PUBLIC_ROUTES')) === JSON.stringify(['concierge', 'lead_intake', 'run_scheduled_jobs', 'survey_response', 'version', 'whoami']));
const roles = src.match(/const ROUTE_MIN_ROLE[^{]*\{([\s\S]*?)\n\};/);
const roleKeys = roles ? [...roles[1].matchAll(/^\s*([a-z_0-9]+)\s*:/gm)].map((m) => m[1]).sort() : [];
ok('gate: every Growth kind needs a staff role, and nothing else is listed', JSON.stringify(roleKeys) === JSON.stringify([...GROWTH].sort()));
ok('gate: deleting a partnership is owner-only', /partnership_delete:\s*'owner'/.test(src));
ok('gate: an unknown kind is refused (unknown_route), and no relay answers invented kinds', /else if \(!PUBLIC_ROUTES\.has\(String\(type\)\)\) \{[\s\S]{0,400}unknown_route/.test(src) && !/NOTIFY_RELAY_TYPES/.test(src));
ok('admin_query reads only the two lists the Growth page loads, and only with GET', JSON.stringify(setOf('ADMIN_READ_TABLES')) === JSON.stringify(['clients', 'contacts']) && /method: 'GET', \/\/ hard-coded/.test(src));
ok('the operator console routes are NOT in the public gate', !/PUBLIC_ROUTES[\s\S]{0,800}dds-studio-manage/.test(src));

// ── security invariants that have bitten before ──
ok('lead/survey HTML injection: public input escaped in owner emails', /escLine/.test(src));
ok('rate limits: the two public forms, the help chat and the two AI drafts', JSON.stringify(setOf('RATE_LIMITED_TYPES')) === JSON.stringify(['concierge', 'lead_intake', 'rec_generate', 'review_draft', 'survey_response']));
ok('no route left takes a web address from a visitor, so the old address guard went with them', !/assertPublicHttpUrl|deepAudit\(|psi_fetch/.test(src));

// ── email discipline (the domain is shared with the product) ──
ok('sender: suppression checked via the SHARED core', /_shared\/email_infra\.ts/.test(src) && /maySend\(to/.test(src));
// item 186 took out the outreach route's own Resend call: the core sender is the one send point left
ok('sender: one-click List-Unsubscribe on every send', /List-Unsubscribe-Post/.test(src) && (src.match(/List-Unsubscribe-Post/g) || []).length === (src.match(/api\.resend\.com\/emails/g) || []).length);
// sales items 74 + 75: …on every send an unsubscribe can stop, with a plain Unsubscribe link at its foot; none on a critical send
ok('sender: the header and the footer link ride only on mail an unsubscribe stops', /const optional = !\(opts && opts\.critical\);/.test(src) && /headers: optional \? \{/.test(src) && /html: optional \? withUnsubscribeLink\(/.test(src));
// item 213 removed the quote and portal sign-in routes; the nightly job's two money emails remain
ok('sender: an invoice reminder and a payment receipt always arrive', (src.match(/\{ \.\.\.CLIENT_OPTS, critical: true \}/g) || []).length === 2);
ok('sender: plain-text alternative on the core sender', /text,\s*\n?\s*headers/.test(src) || /subject, html, text/.test(src));
ok('sender: recipients masked in logs', /maskAddr\(to\)/.test(src));
ok('sender: a suppressed address is refused with an honest message', /recipient_suppressed/.test(src));
ok('Stripe webhook is NOT handled here (single webhook authority = stripe-webhook fn)', !/whsec|stripe-signature/i.test(src));

// ── builder list item 186: the old prospect, outreach, watchlist and review-reading routes are gone ──
for (const route of ['prospect_discover', 'prospect_insights', 'lead_brief', 'prospect_email_draft', 'prospect_email_send',
  'visibility_list', 'visibility_check', 'visibility_add', 'visibility_remove', 'visibility_sync_clients', 'review_list', 'review_get']) {
  ok(`gone: ${route}, its handler and its place in the route table`, !src.includes(route));
}
// ── builder list item 213: a sample of what left, including the ones that could delete ──
for (const route of ['client_purge', 'delete_client_cascade', 'delete_client_auth', 'admin_db', 'admin_write', 'team_remove',
  'client_archive', 'lead_delete', 'invite_client', 'create_client_auth', 'reset_password', 'public_audit_checkout', 'quote_view', 'integration_callback']) {
  ok(`gone: ${route}`, !new RegExp(`'${route}'`).test(src));
}

// ── size tripwire: wholesale-retirement plan assumes no NEW growth ──
const lines = src.split('\n').length;
ok(`size tripwire: monolith not growing (${lines} lines ≤ 3300)`, lines <= 3300, 'if this fails, new features are being added to a function slated for retirement — put them in presence instead');

const passed = results.filter(Boolean).length;
console.log(`\n════ CLEVER-API CHARACTERIZATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
