// ── Phase FE-1 · Feature-boundary enforcement — the per-edition proof matrix ──
//   deno run --allow-read --allow-env tests/presence/feature_boundary_test.mjs
//
// Proves, for every edition, EXACTLY what each capability area allows and denies —
// and that the server gate (middleware/feature.ts) agrees with the navigation
// (lib/navigation.ts). If someone widens/narrows an edition or a nav rule without
// updating the other, this matrix breaks.
import { featureForRoute, requireFeature } from '../../supabase/functions/presence/middleware/feature.ts';
import { editionIncludes, editionFlags, EDITIONS } from '../../supabase/functions/presence/commerce/editions.ts';
import { buildNav } from '../../supabase/functions/presence/lib/navigation.ts';
import { capabilitiesOf } from '../../supabase/functions/presence/lib/site_roles.ts';
import { reviewerAllowed } from '../../supabase/functions/presence/routes/workspace.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const cors = {};
// allowed(edition, route, method): would the server let this through?
const allowed = (ed, route, method) => {
  const f = featureForRoute(route, method);
  if (!f) return true;                       // baseline/shell — always allowed
  return requireFeature(ed, f, cors) === null;
};

// ── 1. Route → feature mapping is what we intend (pure) ──────────────────────
const MAP = [
  ['/publish', 'POST', 'website'], ['/identity', 'PUT', 'website'], ['/assets', 'GET', 'website'],
  ['/preview', 'GET', 'website'], ['/site/template', 'PUT', 'website'], ['/schedule', 'POST', 'website'],
  ['/foundations/dns', 'PUT', 'website'], ['/media/upload-url', 'POST', 'website'],
  ['/dev/files', 'GET', 'developer'],
  ['/crm/profile', 'GET', 'relationship'], ['/crm/notes', 'POST', 'relationship'],
  ['/moments', 'GET', 'business_moments'],
  ['/coach/health', 'GET', 'ai'],
  ['/connections', 'GET', 'connected'],
  ['/analytics', 'GET', 'reports'], ['/analytics/website', 'GET', 'reports'],
  // baseline / shell — MUST be null (reachable by every edition)
  ['/site', 'GET', null], ['/identity', 'GET', null], ['/voice', 'GET', null],
  ['/forms/inbox', 'GET', null], ['/schedule', 'GET', null], ['/approve/send', 'POST', null],
  ['/portal/feed', 'GET', null], ['/portal/context', 'GET', null], ['/notes', 'GET', null],
  ['/changes', 'GET', null], ['/export', 'GET', null], ['/settings', 'GET', null],
  ['/concierge/ask', 'POST', null], ['/knowledge/docs', 'GET', null], ['/foundations', 'GET', null],
  ['/marketplace/features', 'GET', null],
];
for (const [route, method, feat] of MAP) {
  ok(`map ${method} ${route} → ${feat}`, featureForRoute(route, method) === feat);
}

// ── 2. The headline product boundaries the phase requires ────────────────────
ok('CMS-only CANNOT call Customers (/crm)', !allowed('cms_only', '/crm/profile', 'GET'));
ok('CMS-only CANNOT call Business Moments', !allowed('cms_only', '/moments', 'GET'));
ok('CMS-only CANNOT call Connected', !allowed('cms_only', '/connections', 'GET'));
ok('CMS-only CANNOT call Growth/AI (/coach)', !allowed('cms_only', '/coach/health', 'GET'));
ok('CMS-only CAN call the website (/publish)', allowed('cms_only', '/publish', 'POST'));
ok('CMS-only CAN edit business info (/identity PUT)', allowed('cms_only', '/identity', 'PUT'));
ok('CMS-only CAN use Developer Mode', allowed('cms_only', '/dev/files', 'GET'));

ok('Business-OS CANNOT publish the website', !allowed('business_os_only', '/publish', 'POST'));
ok('Business-OS CANNOT edit business info', !allowed('business_os_only', '/identity', 'PUT'));
ok('Business-OS CANNOT reach Files/DAM', !allowed('business_os_only', '/assets', 'GET'));
ok('Business-OS CANNOT use Developer Mode', !allowed('business_os_only', '/dev/files', 'GET'));
ok('Business-OS CAN call Customers (/crm)', allowed('business_os_only', '/crm/profile', 'GET'));
ok('Business-OS CAN call Business Moments', allowed('business_os_only', '/moments', 'GET'));
ok('Business-OS CAN call Connected', allowed('business_os_only', '/connections', 'GET'));

ok('Studio OS CAN publish the website', allowed('studio_os', '/publish', 'POST'));
ok('Studio OS CAN call Customers', allowed('studio_os', '/crm/profile', 'GET'));
ok('Studio OS CAN call Business Moments', allowed('studio_os', '/moments', 'GET'));
ok('Studio OS CAN call Connected', allowed('studio_os', '/connections', 'GET'));
ok('Studio OS CAN reach Files/DAM', allowed('studio_os', '/assets', 'GET'));

// Monitor: observes an existing site (has website+intelligence) but no developer/forms.
ok('Monitor CAN reach the website surface (/assets)', allowed('monitor', '/assets', 'GET'));
ok('Monitor CAN call Business Moments', allowed('monitor', '/moments', 'GET'));
ok('Monitor CANNOT use Developer Mode', !allowed('monitor', '/dev/files', 'GET'));

// Supersets never deny any tested area.
for (const ed of ['studio_os', 'managed', 'agency', 'enterprise']) {
  for (const [route, method] of [['/publish','POST'],['/crm/profile','GET'],['/moments','GET'],['/connections','GET'],['/assets','GET'],['/analytics','GET'],['/dev/files','GET']]) {
    ok(`${ed} allows ${method} ${route}`, allowed(ed, route, method));
  }
}

// ── 3. Baseline shell reachable by EVERY edition (the app frame never breaks) ─
const SHELL = [['/site','GET'],['/identity','GET'],['/forms/inbox','GET'],['/notes','GET'],['/export','GET'],['/settings','GET'],['/concierge/ask','POST'],['/portal/feed','GET']];
for (const ed of EDITIONS) {
  for (const [route, method] of SHELL) ok(`${ed} keeps shell ${method} ${route}`, allowed(ed, route, method));
}

// ── 4. Server gate AGREES with navigation (two independent files) ────────────
// For each edition: a nav section is present iff its capability routes are allowed.
const NAV_CHECKS = [
  ['website',   '/publish',       'POST'],   // Website section ⟺ website allowed
  ['customers', '/crm/profile',   'GET'],    // Customers section ⟺ relationship allowed
  ['files',     '/assets',        'GET'],    // Files section ⟺ website allowed (Files tied to website today)
  ['today',     '/moments',       'GET'],    // Today section ⟺ Business-OS/moments allowed
  ['analytics', '/analytics',     'GET'],    // Analytics section ⟺ reports allowed
  ['connections','/connections',  'GET'],    // Connections utility ⟺ connected allowed
];
for (const ed of EDITIONS) {
  const sections = buildNav({ role: 'business_owner', edition: 'presence', capabilities: capabilitiesOf('business_owner'), isAgency: false, isOperator: false, editionKey: ed });
  const keys = new Set(sections.map((s) => s.key));
  for (const [navKey, route, method] of NAV_CHECKS) {
    const shown = keys.has(navKey);
    const canReach = allowed(ed, route, method);
    ok(`${ed}: nav '${navKey}' shown(${shown}) === server allows ${method} ${route}(${canReach})`, shown === canReach);
  }
}

// ── 5. Reviewer boundary — the client audience reaches ONLY feed + approvals ──
ok('reviewer allowed: read the shared feed', reviewerAllowed('/portal/feed', 'GET') === true);
ok('reviewer allowed: read portal context', reviewerAllowed('/portal/context', 'GET') === true);
ok('reviewer allowed: approve a file', reviewerAllowed('/assets/00000000-0000-0000-0000-000000000000/status', 'POST') === true);
ok('reviewer DENIED: Customers/CRM', reviewerAllowed('/crm/profile', 'GET') === false);
ok('reviewer DENIED: publish the site', reviewerAllowed('/publish', 'POST') === false);
ok('reviewer DENIED: Business Moments', reviewerAllowed('/moments', 'GET') === false);
ok('reviewer DENIED: Connected list', reviewerAllowed('/connections', 'GET') === false);
ok('reviewer DENIED: manage members', reviewerAllowed('/portal/members', 'GET') === false);
ok('reviewer DENIED: analytics', reviewerAllowed('/analytics', 'GET') === false);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FEATURE BOUNDARY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
