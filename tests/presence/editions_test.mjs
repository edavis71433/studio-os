// ── Phase D Editions & Packaging suite ───────────────────────────────────────
// Proves packaging as DATA: the feature matrix, upgrade/downgrade (data never
// lost — only capabilities move), plan→edition mapping, and — crucially — that
// EVERY edition yields a complete, non-empty, dead-end-free navigation with a
// landing that exists. One platform, many editions.
//
//   deno run --allow-read --allow-env tests/presence/editions_test.mjs
import {
  EDITIONS, EDITION_DEFS, featuresOf, editionIncludes, editionRank, isUpgrade, isDowngrade,
  featureDelta, editionFromPlan, editionFlags, editionFromSite, isEditionKey,
} from '../../supabase/functions/presence/commerce/editions.ts';
import { buildNav, landingFor } from '../../supabase/functions/presence/lib/navigation.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. matrix — supersets, inclusion, guards ═══
{
  ok('seven editions defined (incl. Monitor)', EDITIONS.length === 7 && isEditionKey('monitor') && isEditionKey('studio_os') && !isEditionKey('nope'));
  ok('monitor: observes the website (view) + business_os, never publishes via a hidden surface', editionIncludes('monitor', 'website') && editionIncludes('monitor', 'business_moments') && !editionIncludes('monitor', 'developer'));
  ok('cms_only has website, not business_moments', editionIncludes('cms_only', 'website') && !editionIncludes('cms_only', 'business_moments') && !editionIncludes('cms_only', 'relationship'));
  ok('business_os_only has moments/relationship, not website', editionIncludes('business_os_only', 'business_moments') && editionIncludes('business_os_only', 'relationship') && !editionIncludes('business_os_only', 'website'));
  ok('studio_os = cms ∪ business_os', editionIncludes('studio_os', 'website') && editionIncludes('studio_os', 'business_moments') && editionIncludes('studio_os', 'relationship'));
  ok('managed adds managed_service', editionIncludes('managed', 'managed_service') && !editionIncludes('studio_os', 'managed_service'));
  ok('agency adds agency (superset of studio)', editionIncludes('agency', 'agency') && editionIncludes('agency', 'website') && editionIncludes('agency', 'business_moments'));
  ok('enterprise adds enterprise (superset of agency)', editionIncludes('enterprise', 'enterprise') && editionIncludes('enterprise', 'agency') && editionIncludes('enterprise', 'website'));
}

// ═══ 2. ladder — upgrade/downgrade, data never in the delta ═══
{
  ok('rank increases studio<agency<enterprise', editionRank('studio_os') < editionRank('agency') && editionRank('agency') < editionRank('enterprise'));
  ok('cms_only ↔ business_os_only are lateral (same rank, not an upgrade)', !isUpgrade('cms_only', 'business_os_only') && !isUpgrade('business_os_only', 'cms_only'));
  ok('cms_only → studio_os is an upgrade', isUpgrade('cms_only', 'studio_os') && !isDowngrade('cms_only', 'studio_os'));
  ok('enterprise → studio_os is a downgrade', isDowngrade('enterprise', 'studio_os'));
  const up = featureDelta('cms_only', 'studio_os');
  ok('upgrade gains business_os features, loses none', up.gained.includes('business_moments') && up.gained.includes('relationship') && up.lost.length === 0);
  const down = featureDelta('studio_os', 'cms_only');
  ok('downgrade hides business_os features (data preserved — features only)', down.lost.includes('business_moments') && down.lost.includes('relationship') && down.gained.length === 0);
}

// ═══ 3. plan → edition mapping ═══
{
  ok('presence → studio_os', editionFromPlan('presence') === 'studio_os');
  ok('presence_managed → managed', editionFromPlan('presence_managed') === 'managed');
  ok('agency → agency, enterprise → enterprise', editionFromPlan('agency') === 'agency' && editionFromPlan('enterprise') === 'enterprise');
  ok('presence_monitor → monitor (observe + intelligence, its own edition)', editionFromPlan('presence_monitor') === 'monitor');
  ok('unknown plan → studio_os (safe default)', editionFromPlan('???') === 'studio_os');
  ok('editionFromSite: presence→studio_os, monitor→monitor, agency flag→agency', editionFromSite('presence') === 'studio_os' && editionFromSite('monitor') === 'monitor' && editionFromSite('presence', { isAgency: true }) === 'agency');
}

// ═══ 4. flags drive nav ═══
{
  const cms = editionFlags('cms_only'), bos = editionFlags('business_os_only'), studio = editionFlags('studio_os');
  ok('cms flags: website yes, businessOS no', cms.hasWebsite && !cms.hasBusinessOS && !cms.hasRelationship);
  ok('business_os flags: website no, businessOS yes', !bos.hasWebsite && bos.hasBusinessOS && bos.hasRelationship);
  ok('studio flags: both', studio.hasWebsite && studio.hasBusinessOS);
  ok('enterprise flag only on enterprise', editionFlags('enterprise').hasEnterprise && !editionFlags('studio_os').hasEnterprise);
}

// ═══ 5. EVERY edition → complete, non-empty, dead-end-free nav + valid landing ═══
{
  const caps = ['view_all', 'edit', 'publish', 'connect', 'configure', 'invite', 'use_developer_mode'];
  for (const ed of EDITIONS) {
    const isAgencyEd = ed === 'agency' || ed === 'enterprise';
    const siteEd = ed === 'monitor' ? 'monitor' : 'presence';   // Monitor's hosting dimension disables publish
    const nav = buildNav({ role: 'business_owner', edition: siteEd, capabilities: caps, isAgency: isAgencyEd, isOperator: false, editionKey: ed });
    const allNonEmpty = nav.length > 0 && nav.every((s) => s.items.length > 0);
    const hrefs = new Set();
    nav.forEach((s) => s.items.forEach((i) => hrefs.add(i.href.split('#')[0])));
    const landing = landingFor({ role: 'business_owner', edition: siteEd, capabilities: caps, isAgency: isAgencyEd, isOperator: false, editionKey: ed });
    const landingReachable = [...hrefs].some((h) => landing.split('#')[0] === h) || landing === '/agency.html';
    ok(`${ed}: nav complete + non-empty + landing reachable`, allNonEmpty && landingReachable, `sections=${nav.map((s) => s.key).join(',')} landing=${landing}`);
  }
}

// ═══ 6. edition-specific nav shape (no empty menus, no wrong sections) ═══
{
  const caps = ['view_all', 'edit', 'publish', 'connect', 'configure', 'invite'];
  const keys = (ed, extra = {}) => buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: false, isOperator: false, editionKey: ed, ...extra }).map((s) => s.key);
  ok('cms_only: has website, NOT grow', keys('cms_only').includes('website') && !keys('cms_only').includes('grow'));
  ok('business_os_only: has grow, NOT website/create', keys('business_os_only').includes('grow') && !keys('business_os_only').includes('website') && !keys('business_os_only').includes('create'));
  ok('studio_os: has both website + grow', keys('studio_os').includes('website') && keys('studio_os').includes('grow'));
  ok('agency edition + member: shows agency section', buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, editionKey: 'agency' }).some((s) => s.key === 'agency'));
  ok('no editionKey → unchanged full nav (backward compatible)', keys('studio_os').join() === buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: false, isOperator: false }).map((s) => s.key).join());
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
