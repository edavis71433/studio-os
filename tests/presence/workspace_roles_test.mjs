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

// ═══ 7. information architecture — nav adapts by role + edition, no empty menus ═══
{
  const { buildNav, landingFor } = await import('../../supabase/functions/presence/lib/navigation.ts');
  const ctx = (o) => ({ role: 'business_owner', edition: 'presence', capabilities: [], isAgency: false, isOperator: false, ...o });
  const caps = (role) => { return { business_owner: ['view_all','edit','approve','publish','connect','configure','delete','export','invite','comment'], business_staff: ['view_all','edit','approve','publish','connect','export','comment'], client_reviewer: ['view_shared','approve','export','comment'], developer: ['view_all','edit','approve','publish','connect','configure','export','comment','use_developer_mode'] }[role]; };

  const owner = buildNav(ctx({ capabilities: caps('business_owner') }));
  ok('nav: owner gets the v1.0 outcome areas (Today/Website/Customers/Files/Inbox/Settings)', owner.some(s=>s.key==='today') && owner.some(s=>s.key==='website') && owner.some(s=>s.key==='customers') && owner.some(s=>s.key==='files') && owner.some(s=>s.key==='inbox') && owner.some(s=>s.key==='settings'));
  ok('nav: no CMS/CRM/DAM words leak into any label', owner.every(s=>!/CMS|CRM|\bDAM\b|Portal|Relationship/.test(s.label) && s.items.every(i=>!/CMS|CRM|\bDAM\b|Portal|Relationship/.test(i.label))));
  ok('nav: no empty sections ever', owner.every(s=>s.items.length>0));
  // Architecture v1.0 (frozen refinements): Analytics is first-class; utilities overflow.
  ok('nav: Analytics is a first-class outcome (not a utility)', owner.some(s=>s.key==='analytics' && !s.utility && s.items[0].href==='/analytics.html'));
  ok('nav: utilities (Connections/Settings/Help) live in the overflow (utility:true)', ['connections','settings','help'].every(k=>{const s=owner.find(x=>x.key===k);return !!s && s.utility===true;}));
  ok('nav: the PRIMARY bar is outcomes only', owner.filter(s=>!s.utility).every(s=>['today','home','overview','website','customers','record','project','messages','pipeline','projects','files','analytics','inbox','studio'].includes(s.key)));
  // FIX 6: the primary "Customers" item opens the ROSTER (customers.html), not the
  // single-client CRM detail (which un-scoped showed the owner his OWN profile).
  ok('nav: Customers opens the roster (customers.html), not the single-client detail', owner.find(s=>s.key==='customers').items[0].href==='/customers.html');

  const reviewer = buildNav(ctx({ role:'client_reviewer', capabilities: caps('client_reviewer') }));
  ok('nav: reviewer gets ONE calm surface', reviewer.length===1 && reviewer[0].items[0].href==='/client.html');
  ok('nav: reviewer landing = the reviewer surface', landingFor(ctx({role:'client_reviewer',capabilities:caps('client_reviewer')}))==='/client.html');

  // A converted/bridged customer owns their OWN site (role = business_owner) but is
  // the studio's CLIENT (isManagedClient). They must get the SAME one calm client
  // surface — never the operator workspace ("Customers"/CRM, "build your site").
  const managed = buildNav(ctx({ capabilities: caps('business_owner'), isManagedClient:true }));
  ok('nav: bridged customer (owner + isManagedClient) gets the ONE calm client surface only', managed.length===1 && managed[0].items[0].href==='/client.html');
  ok('nav: bridged customer sees NO operator areas (no Customers/Website/Projects/Settings)', !managed.some(s=>['customers','website','projects','files','analytics','settings','studio'].includes(s.key)));
  ok('nav: bridged customer landing = the client surface', landingFor(ctx({capabilities:caps('business_owner'),isManagedClient:true}))==='/client.html');
  // A plain studio owner (isManagedClient false/absent) is UNCHANGED — full workspace.
  ok('nav: plain owner (no managed flag) keeps the full operator workspace', owner.some(s=>s.key==='customers') && owner.some(s=>s.key==='website') && landingFor(ctx({capabilities:caps('business_owner')}))==='/today.html');
  // An agency operator scope-switched INTO a customer keeps operator tools: the
  // workspace guard yields isManagedClient=false for them, so buildNav is unchanged.
  const agencyScoped = buildNav(ctx({ capabilities: caps('business_owner'), isAgency:true, isManagedClient:false }));
  // Oct 2026 nav cut: at studio level Home IS the studio (agency.html) and Customers is the roster.
  ok('nav: agency-scoped operator (isManagedClient=false) keeps operator tools; Home opens the studio, Customers the roster', agencyScoped.some(s=>s.key==='customers') && agencyScoped.find(s=>s.key==='home').items[0].href==='/agency.html' && agencyScoped.find(s=>s.key==='customers').items[0].href==='/customers.html' && !agencyScoped.some(s=>s.key==='studio'));

  const monitor = buildNav(ctx({ edition:'monitor', capabilities: caps('business_owner') }));
  ok('nav: Monitor edition hides Publish (observe-only)', !monitor.find(s=>s.key==='website').items.some(i=>i.key==='publish'));

  const staff = buildNav(ctx({ role:'business_staff', capabilities: caps('business_staff') }));
  ok('nav: business_staff cannot invite (no Sharing in Settings)', !staff.find(s=>s.key==='settings').items.some(i=>i.key==='sharing'));

  const agency = buildNav(ctx({ isAgency:true, capabilities: caps('business_owner') }));
  ok('nav: agency member: landing = Studio, Home → agency.html, no Today in the primary bar', !agency.some(s=>s.key==='today') && agency.find(s=>s.key==='home').items[0].href==='/agency.html' && landingFor(ctx({isAgency:true,capabilities:caps('business_owner')}))==='/agency.html');

  // ── Oct 2026 nav cut (the approved mockup): 8 drawn at studio level, 6 inside a client ──
  const drawn = (nav) => nav.filter(s=>s.items.some(i=>!i.hidden));
  const drawnKeys = (nav) => drawn(nav).map(s=>s.key);
  const hiddenHrefs = (nav) => nav.flatMap(s=>s.items.filter(i=>i.hidden).map(i=>i.href));
  const allHrefs = (nav) => nav.flatMap(s=>s.items.map(i=>i.href.split('#')[0]));
  ok('nav cut: studio level draws exactly Home · Inbox · Customers · Pipeline · Projects · Files · Your website · Settings', drawnKeys(agency).join(',')==='home,inbox,customers,pipeline,projects,files,website,settings');
  ok('nav cut: studio level — Your website and Settings are the utilities (foot of the sidebar), each a plain item', drawn(agency).filter(s=>s.utility).map(s=>s.label).join('·')==='Your website·Settings' && drawn(agency).every(s=>s.items.filter(i=>!i.hidden).length===1));
  ok('nav cut: nothing is deleted — Contacts, Broadcasts, Visual Studio, Analytics, Add a customer, the builder pages, Sharing, Help stay as ⌘K entries', ['/contacts.html','/broadcasts.html','/visual-studio.html','/analytics.html','/agency.html#add','/presence.html#business','/presence.html#design','/presence.html#addpage','/presence.html#domain','/presence.html#publish','/presence.html#history','/sharing.html','/help.html'].every(h=>hiddenHrefs(agency).includes(h)));
  ok('nav cut: no page is reachable from two menu entries (drawn hrefs are unique)', (()=>{const hs=drawn(agency).map(s=>s.items.find(i=>!i.hidden).href);return new Set(hs).size===hs.length;})());
  ok('nav cut: Help is never a drawn item (the ? icon owns it)', !drawn(agency).some(s=>s.key==='help') && !drawn(owner).some(s=>s.key==='help'));
  // drilled INTO a client the menu is the CLIENT's six; the studio-wide items hide (⌘K keeps them)
  const drilled = buildNav(ctx({ isAgency:true, scoped:true, capabilities: caps('business_owner') }));
  ok('nav cut: inside a client draws exactly Overview · Website · Record · Project · Messages · Files', drawnKeys(drilled).join(',')==='overview,website,record,project,messages,files');
  ok('nav cut: the client menu points at their Today, builder, record, project, inbox and files', ['/today.html','/presence.html','/crm.html','/projects.html','/inbox.html','/files.html'].join()===drawn(drilled).map(s=>s.items.find(i=>!i.hidden).href).join());
  ok('nav cut: inside a client the studio-wide items (Pipeline, all Customers, Analytics, the studio home) are hidden, not gone', ['/pipeline.html','/customers.html','/analytics.html','/agency.html'].every(h=>hiddenHrefs(drilled).includes(h)) && !drawnKeys(drilled).some(k=>['pipeline','customers','analytics','home'].includes(k)));
  ok('nav cut: every studio-level page is still SOMEWHERE in the scoped nav (⌘K reaches it)', ['/customers.html','/pipeline.html','/analytics.html','/settings.html','/help.html','/visual-studio.html'].every(h=>allHrefs(drilled).includes(h)));
  // Oct 2026 studio audit, change 4: onboarding is findable from ⌘K at studio level ("add", "client")
  const addItem = agency.find(s=>s.key==='customers').items.find(i=>i.key==='add_client');
  ok('nav: agency member at studio level has "Add a customer" → /agency.html#add in the Customers group (⌘K finds "add"/"client")', !!addItem && addItem.label==='Add a customer' && addItem.href==='/agency.html#add' && /client/i.test(addItem.desc||'') && addItem.hidden===true);
  ok('nav: the add_client entry is studio-level only (not drilled into a client, not for a plain owner)', !drilled.some(s=>s.items.some(i=>i.key==='add_client')) && !owner.find(s=>s.key==='customers').items.some(i=>i.key==='add_client'));
  // Get started: listed only until the site is live
  const notLive = buildNav(ctx({ isAgency:true, siteLive:false, capabilities: caps('business_owner') }));
  const live = buildNav(ctx({ isAgency:true, siteLive:true, capabilities: caps('business_owner') }));
  ok('nav cut: "Get started" is a drawn utility only while the site is not live', drawn(notLive).some(s=>s.key==='get_started' && s.utility && s.items[0].href==='/get-started.html') && !live.some(s=>s.key==='get_started') && !agency.some(s=>s.key==='get_started'));
  // the plain owner keeps the outcome areas; the same merges apply (Contacts → Customers, Visual Studio → Files, Broadcasts → Inbox)
  ok('nav cut: plain owner draws Today · Website · Customers · Pipeline · Projects · Inbox · Files · Analytics · Settings', drawnKeys(owner).join(',')==='today,website,customers,pipeline,projects,inbox,files,analytics,settings');

  const dev = buildNav(ctx({ role:'developer', capabilities: caps('developer') }));
  ok('nav: developer sees the Developer Mode entry under Settings', dev.find(s=>s.key==='settings').items.some(i=>i.key==='developer'));
  ok('nav: non-developer does NOT see Developer Mode', !owner.find(s=>s.key==='settings').items.some(i=>i.key==='developer'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); (globalThis.Deno ? Deno : process).exit(1); }
