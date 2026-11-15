// ── P2-E W6: durable terms-acceptance evidence (M4, structural) ──────────────
//   deno run --allow-read tests/presence/terms_acceptance_test.mjs
// Clickwrap at signup is only defensible if we can SHOW what was accepted, when,
// and from where. This locks the capture + the portable copy in the export.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const terms = read('supabase/functions/presence/commerce/terms.ts');
const commerce = read('supabase/functions/presence/routes/commerce.ts');
const exporter = read('supabase/functions/presence/platform/exporter.ts');
const mig = read('supabase/migrations/0084_terms_acceptance.sql');

// ── module ──
ok('module: server owns authoritative versions (env-overridable)', /TERMS_VERSION = Deno\.env\.get\('TERMS_VERSION'\)/.test(terms) && /PRIVACY_VERSION = Deno\.env\.get\('PRIVACY_VERSION'\)/.test(terms));
ok('module: records version + when + ip + ua + method + context', /terms_version: termsVersion[\s\S]*?accepted_at:[\s\S]*?ip:[\s\S]*?user_agent:[\s\S]*?method:[\s\S]*?context:/.test(terms));
ok('module: prefers the PRESENTED version (strongest evidence of what they saw)', /presentedTermsVersion[\s\S]*?\|\| TERMS_VERSION/.test(terms));
ok('module: best-effort — never throws, logs on failure', /catch \(e\)[\s\S]*?non-fatal/.test(terms));

// ── self-serve sign-up is closed (builder item 199, Nov 15 2026) ──
// The clickwrap was recorded at sign-up, the only place an account was made without
// a studio. Sign-up now answers one fixed reply, so no new acceptance is recorded
// until it opens again; the recorder, the table and the export of past ones stay.
ok('signup: closed, so nothing records a clickwrap today (the recorder is kept for when it opens)', !/recordAcceptance/.test(commerce) && /return signupClosed\(cors\)/.test(commerce));

// ── export includes the customer's own consent copy (no IP/UA leak) ──
ok('export: includes terms_acceptances (portable consent record)', /terms_acceptances: acceptQ\.json/.test(exporter) && /presence_terms_acceptances\?client_id=eq/.test(exporter));
ok('export: does NOT leak internal ip/ua in the customer copy', /select=terms_version,privacy_version,accepted_at,method,context/.test(exporter));

// ── migration + frontend ──
ok('migration: append-only evidence table, deny-all RLS, rollback', /create table if not exists public\.presence_terms_acceptances/.test(mig) && /enable row level security/.test(mig) && /drop table if exists public\.presence_terms_acceptances/.test(mig));
ok('frontend: the sign-up page is gone (item 199)', (() => { try { read('signup.html'); return false; } catch { return true; } })());

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W6 TERMS ACCEPTANCE (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
