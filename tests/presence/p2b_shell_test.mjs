// ── P2-B — App Shells, Navigation & Shared Foundations ───────────────────────
//   deno run --allow-read tests/presence/p2b_shell_test.mjs
// Structural verification of the consolidation: presence.html on the shared
// shell, the shared-state adoption, the reversible portal-workspace retirement,
// and buildNav as the ONE surface-separating nav. No network.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── presence.html adopts the shared shell (Client App) ──
{
  const h = read('presence.html');
  ok('presence.html includes the shared shell (css + js)', /<link[^>]+href="\/shell\.css"/.test(h) && /<script[^>]+src="\/shell\.js"/.test(h));
  ok('presence.html routes toasts through the shared ddsToast (shared success/error/conflict state)', /typeof window\.ddsToast === "function"/.test(h) && /window\.ddsToast\(msg, bad \? "err" : "ok"\)/.test(h));
  ok('presence.html reconciles the rail under the shell (hides the duplicate wordmark)', /dds-has-shell \.rail \.wordmark\{display:none\}/.test(h));
  // M9 optimistic-lock behavior PRESERVED (not touched by the shell adoption)
  ok('M9 PRESERVED: presence.html still sends If-Match from api()', /If-Match.*S\.draftHash/.test(h));
  ok('M9 PRESERVED: presence.html still handles the stale_draft 409', /error === "stale_draft"/.test(h) && /S\.draftHash = \(j && j\.current_hash\)/.test(h));
  ok('M9 PRESERVED: presence.html seeds the held hash from /changes', /c\.data\.draft_hash/.test(h));
  ok('editor JS intact: api()/whisper()/publish path unchanged', /async function api\(method, route, body\)/.test(h) && /function whisper\(id, state\)/.test(h));
}

// ── portal-workspace.html retired via a REVERSIBLE redirect (zero inbound links) ──
{
  const w = read('portal-workspace.html');
  ok('portal-workspace.html is a reversible redirect (RETIRED toggle)', /var RETIRED = true/.test(w) && /if \(RETIRED\) \{ location\.replace\('\/portal\.html#growth'\)/.test(w));
  ok('portal-workspace.html preserves the Growth capability (redirects to its live home)', /\/portal\.html#growth/.test(w));
  ok('portal-workspace.html documents rollback (git history)', /git show HEAD~1:portal-workspace\.html/.test(w));
  // it must be tiny now (retired stub), not the old duplicate app that fetched clever-api
  ok('portal-workspace.html is a small stub, not the old duplicate app', w.length < 2500);
  ok('portal-workspace.html no longer CALLS clever-api (no backend fetch)', !/functions\/v1\/clever-api/.test(w) && !/gp_workspace/.test(w));
}

// ── portal.html KEPT (sign-in entry + deferred capabilities) — NOT retired ──
{
  const p = read('portal.html');
  ok('portal.html is preserved (still the sign-in/portal, not a redirect stub)', /signInWithPassword/.test(p) && p.length > 5000);
}

// ── buildNav is the ONE nav, separating every surface (no rebuild — verify) ──
{
  const nav = read('supabase/functions/presence/lib/navigation.ts');
  ok('nav: Client work surface (Today/Customers/Analytics/Inbox)', /'today', 'Today'/.test(nav) && /key: 'customers', label: 'Customers'/.test(nav) && /'analytics', 'Analytics'/.test(nav) && /'inbox', 'Inbox'/.test(nav));
  ok('nav: Website-management surface → presence.html', /key: 'website'/.test(nav) && /\/presence\.html/.test(nav));
  ok('nav: Account/Settings surface is utility (profile menu), billing lives here', /key: 'settings'.*utility: true|utility\('|settings.*Settings/.test(nav) && /Billing lives here/.test(nav));
  ok('nav: Studio-operations surface gated to agency', /'studio', 'Studio'.*\/agency\.html/.test(nav) && /c\.isAgency/.test(nav));
  ok('nav: client reviewer gets the single calm surface', /reviewerNav/.test(nav) && /client_reviewer/.test(nav));
  ok('SECURITY: internal DDS console is NOT in buildNav (never exposed to clients)', !/dds-studio-manage/.test(nav));
}

// ── the shell is the ONE frame + owns the internal-tools gate + shared states ──
{
  const shell = read('shell.js');
  // Two-door consolidation: the legacy admin console is retired — the shell must
  // NOT link it, and sign-out goes to the role-aware door (client vs studio).
  ok('shell: retired admin console is not linked', !/dds-studio-manage-9k2p\.html/.test(shell));
  ok('shell: sign-out is role-aware (client → portal door, owners → studio door)', /client_reviewer[\s\S]{0,120}\/portal\.html[\s\S]{0,40}\/studio\.html/.test(shell));
  ok('shell: consumes buildNav via /portal/context (does not define nav)', /\/portal\/context/.test(shell) && /CTX\.nav/.test(shell));
  ok('shell: provides the shared state helpers (empty/skeleton/error/toast)', /window\.ddsEmpty/.test(shell) && /window\.ddsSkeleton/.test(shell) && /window\.ddsError/.test(shell) && /window\.ddsToast/.test(shell));
  ok('shell: reuses the ONE auth realm (dds-portal-auth)', /storageKey: 'dds-portal-auth'/.test(shell));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-B SHELLS & NAV: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
