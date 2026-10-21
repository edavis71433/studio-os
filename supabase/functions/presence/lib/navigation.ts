// ── Studio OS Information Architecture (A7.5) — navigation as DATA ────────────
// ONE catalog; the visible nav is derived from the caller's role + edition +
// capabilities. This is why Studio OS is one product across every edition/role:
// a capability the caller doesn't have simply doesn't appear — no empty menus,
// no dead ends, no separate builds. Pure — reads the frozen role/visibility
// models, never modifies them.
import type { SiteRole, SiteCapability } from './site_roles.ts';
import { editionFlags, type EditionKey, type EditionFlags } from '../commerce/editions.ts';

// `desc` is a one-line, plain-language note on what the destination is FOR. It
// disambiguates near-synonym surfaces (e.g. the Inbox vs its focused cuts) for a
// non-technical owner. Optional; surfaces that render it (overflow menu / ⌘K)
// show it as a subtitle, but nothing depends on it.
// `hidden: true` items are ⌘K destinations the MENU does not draw (Oct 2026 nav
// cut: the sidebar lists eight places; every deeper page stays one search away
// and is reachable from the place that owns it). The shell skips them in the
// sidebar, the drawer and the account menu; `flatten` (the palette) keeps them.
export interface NavItem { key: string; label: string; href: string; desc?: string; hidden?: boolean; }
// `utility: true` sections are the account/overflow items (Settings, Connections,
// Help). They are composed the same way (Edition × Role) but the shell renders
// them in the profile/overflow menu, keeping the PRIMARY bar to outcomes only
// (Today · Website · Customers · Files · Analytics · Inbox). ⌘K still reaches them.
export interface NavSection { key: string; label: string; items: NavItem[]; utility?: boolean; }

export interface NavContext {
  role: SiteRole;
  edition: string;              // site edition: 'monitor' (observe-only) | 'presence' (full)
  capabilities: SiteCapability[];
  isAgency: boolean;            // the caller is also an agency member
  isOperator: boolean;          // staff/system (operator)
  editionKey?: EditionKey;      // Phase D: the FEATURE edition; when absent, all features (today's behavior)
  isManagedClient?: boolean;    // the caller is an agency's CLIENT signed into their OWN (bridged) site — client experience, not operator tools
  scoped?: boolean;             // Phase 1 overhaul: an agency operator drilled INTO a client (x-dds-scope-site set) — the client's Website is primary there
  siteLive?: boolean;           // Oct 2026 nav cut: the site has been published (presence_sites.status 'live' / last_published_at) — "Get started" is listed only until then
}

const has = (c: NavContext, cap: SiteCapability) => c.capabilities.includes(cap);
const canDraft = (c: NavContext) => c.edition !== 'monitor' && has(c, 'edit');       // Monitor never drafts
const canPublish = (c: NavContext) => c.edition !== 'monitor' && has(c, 'publish');

// Every feature on — the default when no edition entitlement is set, so existing
// behavior is preserved exactly. An explicit editionKey narrows this.
const ALL_FEATURES: EditionFlags = { hasWebsite: true, hasBusinessOS: true, hasRelationship: true, hasConnected: true, hasReports: true, hasClientPortal: true, hasDeveloper: true, hasAgency: true, hasEnterprise: true };
const flagsOf = (c: NavContext): EditionFlags => (c.editionKey ? editionFlags(c.editionKey) : ALL_FEATURES);

/** The client reviewer's whole world is one calm surface. */
function reviewerNav(): NavSection[] {
  return [{ key: 'client', label: 'Your updates', items: [
    { key: 'feed', label: 'Updates', href: '/client.html' },
  ] }];
}

/** Build the visible navigation for a caller. Empty sections are dropped, so
 *  every edition/role feels intentionally designed. */
export function buildNav(c: NavContext): NavSection[] {
  if (c.role === 'client_reviewer') return reviewerNav();
  // A converted/bridged customer owns their own site (role = business_owner) but is
  // the studio's CLIENT — they get the calm client surface, never the operator
  // workspace (no "Customers"/CRM, no "build your site" prompts). Same one surface
  // as the reviewer; presentation only (entitlements/billing/bridge unchanged).
  if (c.isManagedClient) return reviewerNav();

  // ── Architecture v1.0 (frozen): the PRIMARY bar is OUTCOMES ONLY. Utilities
  // (Settings, Connections, Help) are composed the same way but flagged `utility`
  // so the shell renders them at the foot of the sidebar / in the account menu.
  // No CMS/CRM/DAM/portal words ever reach the UI; the internal routes are
  // unchanged. A section with ONE visible item renders as a plain link; a
  // section with several renders as a group. `hidden` items are ⌘K-only.
  //
  // Oct 2026 nav cut (the approved mockup — "it's overwhelming, some stuff
  // shouldn't even be there, some is repetitive"): the menu lists the PLACES,
  // and every tool lives on the place that owns it. Nothing is deleted — a
  // page that leaves the menu keeps its URL, a button on its owner page, and
  // its ⌘K entry (hidden: true). The three menus:
  //   studio level (agency, not scoped) — Home · Inbox · Customers · Pipeline ·
  //     Projects · Files, then Your website · Settings (8)
  //   inside a client (agency, scoped) — Overview · Website · Record · Project ·
  //     Messages · Files (the client's 6; studio-wide items hide)
  //   a plain owner — Today · Website · Customers · Pipeline · Projects · Inbox ·
  //     Files · Analytics, then Settings
  const f = flagsOf(c);
  const sections: NavSection[] = [];
  const single = (key: string, label: string, href: string, desc?: string) => sections.push({ key, label, items: [{ key, label, href, desc }] });
  const utility = (key: string, label: string, href: string, desc?: string) => sections.push({ key, label, items: [{ key, label, href, desc }], utility: true });
  const hid = (key: string, label: string, href: string, desc?: string): NavItem => ({ key, label, href, desc, hidden: true });

  // Phase 1 overhaul / Oct 2026 studio audit: an AGENCY member at studio level
  // (not drilled into a client) lands on agency.html — their home. Drilled into
  // a client, the menu becomes the CLIENT's (their Today is "Overview").
  const studioLevel = !!c.isAgency && !c.scoped;
  const clientScoped = !!c.isAgency && !!c.scoped;

  // The website builder's own pages. Since the nav cut the menu shows ONE door
  // (the builder's own rail has these); each stays a ⌘K destination.
  const websiteSubItems = (): NavItem[] => {
    const items: NavItem[] = [];
    items.push(hid('business_info', 'Business info', '/presence.html#business'));
    if (c.edition !== 'monitor') items.push(hid('design', 'Design', '/presence.html#design'));
    // the two jobs the audit found unfindable (⌘K "domain"/"page" → nothing): named, one search away
    if (canDraft(c)) items.push(hid('add_page', 'Add a page', '/presence.html#addpage', 'A new page on your site — pick a layout or start blank.'));
    if (canPublish(c)) items.push(hid('domain', 'Domain & email', '/presence.html#domain', 'Put your site on your own domain (yourbusiness.com); email records and the padlock.'));
    // Publish now or later — one place (Oct 2026 audit change 3: schedule.html retired;
    // the desc keeps "schedule" findable from ⌘K, which matches on desc).
    if (canPublish(c)) items.push(hid('publish', 'Publish', '/presence.html#publish', 'Publish now, or schedule it to go live on its own — and see or cancel what’s scheduled.'));
    if (canPublish(c)) items.push(hid('history', 'History', '/presence.html#history'));
    return items;
  };
  // the desc keeps "health" findable from ⌘K (website-health.html retired; the
  // Health check is a card on this overview — Oct 2026 audit, gap 3).
  const WEBSITE_DESC = 'Your site at a glance: what’s live, the health check and recent activity.';

  // ── Inside a client: the client's six ──────────────────────────────────────
  if (clientScoped) {
    // Overview — their Today
    if (f.hasBusinessOS) single('overview', 'Overview', '/today.html', 'This client’s Today — what’s changed and what needs you for them.');
    // Website — their builder (one door; the sub-pages stay in ⌘K)
    if (f.hasWebsite) sections.push({ key: 'website', label: 'Website', items: [{ key: 'content', label: 'Website', href: '/presence.html', desc: WEBSITE_DESC }, ...websiteSubItems()] });
    // Record — deal · billing · details (the shell carries ?client=<site> onto every href)
    if (f.hasRelationship) single('record', 'Record', '/crm.html', 'This client’s record — their deal, billing, details and activity on one page.');
    // Project — the work you do for them (projects.html opens the single project directly)
    if (f.hasRelationship) single('project', 'Project', '/projects.html', 'The work you’re doing for this client — tasks, milestones, approvals.');
    // Messages — their conversations
    single('messages', 'Messages', '/inbox.html', 'Everything this client has sent or is waiting on — messages, approvals, requests.');
    // Files — theirs, including their private files (Visual Studio stays a ⌘K entry + a button on Files)
    if (f.hasWebsite) sections.push({ key: 'files', label: 'Files', items: [{ key: 'files_all', label: 'Files', href: '/files.html', desc: 'This client’s photos, brand and documents — including the files private to them.' }, ...(canDraft(c) ? [hid('files_visual', 'Visual Studio', '/visual-studio.html', 'Make an image for their site.')] : [])] });
    // the studio-wide places are one search away while scoped (never drawn)
    if (f.hasRelationship) sections.push({ key: 'studio', label: 'Studio', items: [
      hid('home', 'Studio home', '/agency.html', 'Back to your studio — every client, what needs you today, and your money.'),
      hid('customers', 'All customers', '/customers.html'),
      hid('pipeline', 'Pipeline', '/pipeline.html', 'Deals by stage — proposals, agreements and payments move through here.'),
      ...(f.hasReports ? [hid('analytics', 'Analytics', '/analytics.html')] : []),
    ] });
    // Settings · Help — one search away; the bell · help · account icons sit under the client's menu
    const scopedSettings: NavItem[] = [hid('settings', 'Settings', '/settings.html')];
    if (f.hasClientPortal && has(c, 'invite')) scopedSettings.push(hid('sharing', 'Sharing & access', '/sharing.html'));
    sections.push({ key: 'settings', label: 'Settings', items: scopedSettings, utility: true });
    sections.push({ key: 'help', label: 'Help', items: [hid('help', 'Help', '/help.html')], utility: true });
    return sections.filter((s) => s.items.length > 0);
  }

  // ── Studio level and the plain owner ───────────────────────────────────────
  // Home (studio) / Today (owner) — the calm home. The studio's home carries
  // the Numbers section, so Analytics is a ⌘K entry under it ("See all numbers").
  if (studioLevel) {
    const home: NavItem[] = [{ key: 'home', label: 'Home', href: '/agency.html', desc: 'Your studio’s home — every client, what needs you today, your money and your numbers.' }];
    if (f.hasReports) home.push(hid('analytics', 'Analytics', '/analytics.html', 'All your numbers — visitors, enquiries, money — in plain English.'));
    sections.push({ key: 'home', label: 'Home', items: home });
  } else if (f.hasBusinessOS) {
    single('today', 'Today', '/today.html');
  }

  // Website — one door to the builder (the builder's own rail has its pages).
  // For an agency at studio level their OWN marketing site is a utility item
  // ("Your website", foot of the sidebar); for a plain owner it is their product.
  const websiteSection = (label: string): NavSection => ({ key: 'website', label, items: [{ key: 'content', label, href: '/presence.html', desc: WEBSITE_DESC }, ...websiteSubItems()] });
  if (f.hasWebsite && !studioLevel) sections.push(websiteSection('Website'));

  // Inbox — THE ONE place for what needs you: messages, approvals, notices, leads.
  // Broadcasts ("Send an update") is a button in its toolbar + a ⌘K entry.
  const inbox: NavItem[] = [{ key: 'inbox', label: 'Inbox', href: '/inbox.html', desc: 'The one place for everything that needs you — messages, approvals, notices, and new enquiries.' }];
  if (f.hasRelationship) inbox.push(hid('broadcasts', 'Broadcasts', '/broadcasts.html', 'Send an update to many customers at once.'));
  // Studio level: Home · Inbox · Customers (the approved order). Owner: Today · Website · Customers · … · Inbox.
  if (studioLevel) sections.push({ key: 'inbox', label: 'Inbox', items: inbox });

  // Customers — the relationship area (internally: the CRM): the roster with its
  // People tab and its + Add button. FIX 6: the item opens the ROSTER
  // (customers.html), never the single-client record; a customer opens crm.html.
  if (f.hasRelationship) {
    const customers: NavItem[] = [{ key: 'customers', label: 'Customers', href: '/customers.html', desc: 'Every customer and the people behind them, with their deal, billing, project, files and messages on one record.' }];
    // Oct 2026 studio audit, change 4: onboarding stays findable from ⌘K ("add",
    // "client", "new") — agency.html opens its Add-a-customer dialog on #add.
    if (studioLevel) customers.push(hid('add_client', 'Add a customer', '/agency.html#add', 'Set up a new client — their workspace, their site and their invitation.'));
    customers.push(hid('contacts', 'Contacts', '/contacts.html', 'The people — one may belong to a customer. Also the People tab on Customers.'));
    sections.push({ key: 'customers', label: 'Customers', items: customers });
  }

  // Pipeline — the sales deals, as its own top-level outcome (Phase 1 overhaul:
  // it was a sub-item under Customers, which hid where the money lived).
  if (f.hasRelationship) single('pipeline', 'Pipeline', '/pipeline.html', 'Deals by stage — proposals, agreements and payments move through here.');

  // Projects — the service-delivery area (P2-D): the work you do FOR customers.
  if (f.hasRelationship) single('projects', 'Projects', '/projects.html');

  if (!studioLevel) sections.push({ key: 'inbox', label: 'Inbox', items: inbox });

  // Files — the business library (internally: the DAM). Photos, brand, documents,
  // downloads. Visual Studio ("Make an image") is a button on Files + a ⌘K entry.
  if (f.hasWebsite) {
    const files: NavItem[] = [{ key: 'files_all', label: 'Files', href: '/files.html' }];
    if (canDraft(c)) files.push(hid('files_visual', 'Visual Studio', '/visual-studio.html', 'Make an image for your site or a post.'));
    sections.push({ key: 'files', label: 'Files', items: files });
  }

  // Analytics — a first-class OUTCOME for a plain owner (the studio's lives on Home).
  if (f.hasReports && !studioLevel) single('analytics', 'Analytics', '/analytics.html');

  // Studio — an agency edition WITHOUT the relationship feature still needs a way
  // to its portfolio; with it, Home above IS the studio.
  if (f.hasAgency && studioLevel && !f.hasRelationship) single('studio', 'Studio', '/agency.html');

  // ── utilities (the foot of the sidebar; the account menu on the top bar) ──
  // The agency's OWN website: one door, out of the primary bar.
  if (f.hasWebsite && studioLevel) sections.push({ ...websiteSection('Your website'), utility: true });

  // Connections — integrations. A card on Settings owns them; ⌘K keeps the entry.
  if (f.hasConnected) sections.push({ key: 'connections', label: 'Connections', items: [hid('connections', 'Connections', '/connections.html', 'The services connected to your business — Google, Yelp, booking, email.')], utility: true });

  // Settings — one item; Sharing & access, Developer and Health are cards on the
  // page (Billing lives here, per the constitution) and ⌘K entries.
  const settings: NavItem[] = [{ key: 'settings', label: 'Settings', href: '/settings.html' }];
  if (f.hasClientPortal && has(c, 'invite')) settings.push(hid('sharing', 'Sharing & access', '/sharing.html'));
  if (f.hasDeveloper && has(c, 'use_developer_mode')) settings.push(hid('developer', 'Developer Mode', '/developer.html'));
  sections.push({ key: 'settings', label: 'Settings', items: settings, utility: true });

  // Get started — the guided first run, listed only until the site is live.
  if (c.siteLive === false && f.hasWebsite && canDraft(c)) utility('get_started', 'Get started', '/get-started.html', 'The first week — your profile, your first customer, your first invoice.');

  // Help — the ? icon in every menu's foot; the page stays a ⌘K entry.
  sections.push({ key: 'help', label: 'Help', items: [hid('help', 'Help', '/help.html')], utility: true });

  return sections.filter((s) => s.items.length > 0);
}

/** The caller's landing surface, by role + edition. A CMS-Only account lands on
 *  its website; everyone with Business OS lands on Today; agency on the portfolio. */
export function landingFor(c: NavContext): string {
  if (c.role === 'client_reviewer' || c.isManagedClient) return '/client.html';
  if (c.isAgency) return '/agency.html';
  const f = flagsOf(c);
  if (!f.hasBusinessOS && f.hasWebsite) return '/presence.html';
  return '/today.html';
}
