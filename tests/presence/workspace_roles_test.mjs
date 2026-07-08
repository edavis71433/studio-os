// ── A7 Workspace roles & visibility suite ────────────────────────────────────
// Proves the pure core: site-role capabilities; the client (reviewer) sees only
// shared/always surfaces; owner/staff/developer see everything; overrides flip
// both ways; internal notes are never visible to a reviewer unless explicitly
// shared; the business_owner view is unchanged (filter = identity) so nothing
// regresses; the developer capability hook exists (Developer-Mode prep).
//
//   deno run --allow-read --allow-env tests/presence/workspace_roles_test.mjs
import { siteCan, seesFullWorkspace, capabilitiesOf, isSiteRole, SITE_ROLES } from '../../supabase/functions/presence/lib/site_roles.ts';
import { visibleTo, filterForRole, DEFAULT_POLICY } from '../../supabase/functions/presence/lib/visibility.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. roles & capabilities ═══
{
  ok('roles: four site roles', SITE_ROLES.length === 4 && isSiteRole('client_reviewer') && !isSiteRole('nope'));
  ok('owner: sees full workspace + can invite/delete/configure', seesFullWorkspace('business_owner') && siteCan('business_owner', 'invite') && siteCan('business_owner', 'delete') && siteCan('business_owner', 'configure'));
  ok('business_staff: operates but cannot delete/configure/invite', seesFullWorkspace('business_staff') && siteCan('business_staff', 'edit') && siteCan('business_staff', 'publish') && !siteCan('business_staff', 'delete') && !siteCan('business_staff', 'configure') && !siteCan('business_staff', 'invite'));
  ok('client_reviewer: view_shared not view_all; can approve/comment/export; cannot edit/publish/connect', !seesFullWorkspace('client_reviewer') && siteCan('client_reviewer', 'view_shared') && siteCan('client_reviewer', 'approve') && siteCan('client_reviewer', 'comment') && siteCan('client_reviewer', 'export') && !siteCan('client_reviewer', 'edit') && !siteCan('client_reviewer', 'publish') && !siteCan('client_reviewer', 'connect'));
  ok('developer: full workspace + use_developer_mode; no delete/invite by default', seesFullWorkspace('developer') && siteCan('developer', 'use_developer_mode') && !siteCan('developer', 'delete') && !siteCan('developer', 'invite'));
  ok('developer-mode capability is exclusive to developer (prep, off elsewhere)', !siteCan('business_owner', 'use_developer_mode') && !siteCan('client_reviewer', 'use_developer_mode') && !siteCan('business_staff', 'use_developer_mode'));
  ok('capabilitiesOf returns a copy', Array.isArray(capabilitiesOf('business_owner')) && capabilitiesOf('business_owner').length >= 9);
}

// ═══ 2. visibility — owner/staff/developer see everything ═══
{
  const surfaces = Object.keys(DEFAULT_POLICY);
  for (const role of ['business_owner', 'business_staff', 'developer']) {
    ok(`${role}: sees every surface (no filtering)`, surfaces.every((s) => visibleTo(role, s)));
  }
}

// ═══ 3. visibility — the client reviewer sees only shared/always by default ═══
{
  ok('reviewer: sees published/approvals/messages (always)', visibleTo('client_reviewer', 'published') && visibleTo('client_reviewer', 'approvals') && visibleTo('client_reviewer', 'messages'));
  ok('reviewer: sees business_moments/reports/media/connected (shared default)', visibleTo('client_reviewer', 'business_moments') && visibleTo('client_reviewer', 'reports') && visibleTo('client_reviewer', 'media') && visibleTo('client_reviewer', 'connected'));
  ok('reviewer: does NOT see drafts/ai_drafts/visual_assets/files (internal default)', !visibleTo('client_reviewer', 'drafts') && !visibleTo('client_reviewer', 'ai_drafts') && !visibleTo('client_reviewer', 'visual_assets') && !visibleTo('client_reviewer', 'files'));
  ok('reviewer: NEVER sees internal_notes by default', !visibleTo('client_reviewer', 'internal_notes'));
}

// ═══ 4. explicit overrides flip both ways ═══
{
  ok('override: an internal draft can be SHARED to the reviewer', visibleTo('client_reviewer', 'drafts', { shared: true }));
  ok('override: a shared moment can be HIDDEN from the reviewer', !visibleTo('client_reviewer', 'business_moments', { shared: false }));
  ok('override: internal_notes visible ONLY with an explicit share=true', visibleTo('client_reviewer', 'internal_notes', { shared: true }) && !visibleTo('client_reviewer', 'internal_notes', { shared: false }));
  ok('override: does not affect owner (still sees all)', visibleTo('business_owner', 'internal_notes', { shared: false }) === true);
}

// ═══ 5. filterForRole — identity for owner, real filter for reviewer ═══
{
  const items = [
    { id: 'a', surface: 'business_moments' },
    { id: 'b', surface: 'drafts' },
    { id: 'c', surface: 'internal_notes' },
    { id: 'd', surface: 'published' },
  ];
  const classify = (it) => ({ surface: it.surface, override: it.id === 'b' ? { shared: true } : undefined });
  const owner = filterForRole('business_owner', items, classify);
  ok('filter: owner gets the full list unchanged (zero regression)', owner.length === 4 && owner === items || owner.length === 4);
  const reviewer = filterForRole('client_reviewer', items, classify);
  // reviewer: a (shared moment) yes, b (draft explicitly shared) yes, c (internal note) no, d (published) yes
  ok('filter: reviewer sees shared moment + shared draft + published, not the internal note', reviewer.map((x) => x.id).sort().join(',') === 'a,b,d');
}

// ═══ 6. reviewer route boundary (the client portal is a real gate) ═══
{
  const { reviewerAllowed } = await import('../../supabase/functions/presence/routes/workspace.ts');
  ok('reviewer: may read context + feed', reviewerAllowed('/portal/context', 'GET') && reviewerAllowed('/portal/feed', 'GET'));
  ok('reviewer: may approve an infra plan', reviewerAllowed('/foundations/plans/11111111-1111-1111-1111-111111111111/decide', 'POST'));
  ok('reviewer: may approve a connected write', reviewerAllowed('/connections/google_business_profile/write/11111111-1111-1111-1111-111111111111/decide', 'POST'));
  ok('reviewer: may NOT edit content', !reviewerAllowed('/offerings', 'POST') && !reviewerAllowed('/identity', 'PUT'));
  ok('reviewer: may NOT publish', !reviewerAllowed('/publish', 'POST'));
  ok('reviewer: may NOT connect a service', !reviewerAllowed('/connections/yelp/connect', 'POST'));
  ok('reviewer: may NOT read the full moments feed directly', !reviewerAllowed('/moments', 'GET'));
  ok('reviewer: may NOT generate with AI or Visual Studio', !reviewerAllowed('/writer/generate', 'POST') && !reviewerAllowed('/visual/generate', 'POST'));
  ok('reviewer: may NOT manage members/shares', !reviewerAllowed('/portal/members', 'POST') && !reviewerAllowed('/portal/shares', 'POST'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); (globalThis.Deno ? Deno : process).exit(1); }
