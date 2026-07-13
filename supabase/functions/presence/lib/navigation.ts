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
export interface NavItem { key: string; label: string; href: string; desc?: string; }
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

  // ── Architecture v1.0 (frozen): the PRIMARY bar is OUTCOMES ONLY —
  // Today · Website · Customers · Files · Analytics · Inbox · (Studio). Utilities
  // (Connections, Settings, Help) are composed the same way but flagged `utility`
  // so the shell renders them in the profile/overflow menu. No CMS/CRM/DAM/portal
  // words ever reach the UI; the internal routes are unchanged. A single-item
  // section renders as a top-level button; multi-item sections render as a group.
  const f = flagsOf(c);
  const sections: NavSection[] = [];
  const single = (key: string, label: string, href: string, desc?: string) => sections.push({ key, label, items: [{ key, label, href, desc }] });
  const utility = (key: string, label: string, href: string, desc?: string) => sections.push({ key, label, items: [{ key, label, href, desc }], utility: true });

  // Today — the calm home
  if (f.hasBusinessOS) single('today', 'Today', '/today.html');

  // Website — one home; its contents are sub-items (internally: the CMS)
  if (f.hasWebsite) {
    const website: NavItem[] = [{ key: 'content', label: 'Website', href: '/presence.html' }];
    website.push({ key: 'business_info', label: 'Business info', href: '/presence.html#business' });
    if (c.edition !== 'monitor') website.push({ key: 'design', label: 'Design', href: '/presence.html#design' });
    if (canPublish(c)) website.push({ key: 'publish', label: 'Publish', href: '/presence.html#publish' });
    if (canPublish(c)) website.push({ key: 'schedule', label: 'Scheduled publishes', href: '/schedule.html' });
    if (canPublish(c)) website.push({ key: 'history', label: 'History', href: '/presence.html#history' });
    sections.push({ key: 'website', label: 'Website', items: website });
  }

  // Customers — the relationship area (internally: the CRM). Leads + the P2-C
  // sales Pipeline fold in here as sub-items (the primary bar stays outcomes-only).
  if (f.hasRelationship) {
    const customers: NavItem[] = [{ key: 'customers', label: 'Customers', href: '/crm.html' }];
    customers.push({ key: 'leads', label: 'Enquiries', href: '/leads.html' });
    customers.push({ key: 'contacts', label: 'Contacts', href: '/contacts.html' });
    customers.push({ key: 'pipeline', label: 'Pipeline', href: '/pipeline.html' });
    sections.push({ key: 'customers', label: 'Customers', items: customers });
  }

  // Projects — the service-delivery area (P2-D): the work you do FOR customers.
  // A first-class outcome; its tasks/files/messages/approvals live on the project.
  if (f.hasRelationship) single('projects', 'Projects', '/projects.html');

  // Files — the business library (internally: the DAM). Photos, brand, documents,
  //  downloads — plus AI-generated assets via Visual Studio.
  if (f.hasWebsite) {
    const files: NavItem[] = [{ key: 'files_all', label: 'Files', href: '/files.html' }];
    if (canDraft(c)) files.push({ key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html' });
    sections.push({ key: 'files', label: 'Files', items: files });
  }

  // Analytics — a first-class OUTCOME: plain-English understanding of the business
  //  (internally: Analytics/reporting). Reserved home; the later phase enriches it.
  if (f.hasReports) single('analytics', 'Analytics', '/analytics.html');

  // Inbox — THE ONE place for what needs you: messages, approvals, notices, leads.
  // Everything below in "Focused views" is just a narrower cut of this same data —
  // the label + desc make Inbox read as the primary, the rest as optional lenses.
  single('inbox', 'Inbox', '/inbox.html', 'The one place for everything that needs you — messages, approvals, notices, and new enquiries.');

  // Studio — the agency scope (agency roles only); open a client to re-scope
  if (f.hasAgency && c.isAgency) single('studio', 'Studio', '/agency.html');

  // ── Deeper views (profile/overflow menu + ⌘K, never the primary bar) ─────────
  // Every capability stays reachable — nothing is retired. The old single long
  // "More views" list was the confusion, so it's split into two clearly-named,
  // purpose-labelled groups. Nothing here competes with the Inbox: the first group
  // is explicitly focused CUTS of the Inbox, the second is calm read-outs you look
  // at on purpose (history / what's ahead / understanding), never a to-do.
  if (has(c, 'view_all')) {
    // Group 1 — focused cuts of the Inbox (the same "needs you" data, one lens).
    const focus: NavItem[] = [];
    if (f.hasBusinessOS || f.hasWebsite) {
      focus.push({ key: 'attention', label: 'Website attention', href: '/attention.html', desc: 'Just your website’s to-dos — the website-only slice of your Inbox.' });
      focus.push({ key: 'approval_center', label: 'Approvals', href: '/approval-center.html', desc: 'Only the things waiting for your go-ahead before they go live.' });
    }
    if (focus.length) sections.push({ key: 'focus_views', label: 'Focused views', items: focus, utility: true });

    // Group 2 — calm read-outs: understand the business, look back, look ahead.
    const lenses: NavItem[] = [];
    if (f.hasWebsite) lenses.push({ key: 'view_content_tree', label: 'Website map', href: '/content-tree.html', desc: 'Every page and section of your site, laid out as one simple tree.' });
    if (f.hasWebsite) lenses.push({ key: 'view_site_health', label: 'Website health', href: '/website-health.html', desc: 'A plain-English check-up of your live site.' });
    if (f.hasWebsite) lenses.push({ key: 'view_timeline', label: 'Website story', href: '/timeline.html', desc: 'A plain-English history of everything that’s happened to your site.' });
    if (f.hasWebsite) lenses.push({ key: 'view_snapshots', label: 'Version history', href: '/snapshot-history.html', desc: 'Past saved versions of your site you can look back on or restore.' });
    if (f.hasWebsite) lenses.push({ key: 'view_upcoming', label: 'What’s coming next', href: '/upcoming.html', desc: 'Scheduled and expected changes — a calm look ahead, nothing guessed.' });
    if (f.hasBusinessOS) lenses.push({ key: 'view_insights', label: 'Business insights', href: '/business-insights.html', desc: 'Plain observations about how your business is doing — only what we can measure.' });
    if (lenses.length) sections.push({ key: 'views', label: 'Understand your site', items: lenses, utility: true });
  }

  // Connections — integrations (the connected services)
  if (f.hasConnected) utility('connections', 'Connections', '/connections.html');

  // Settings — account, sharing/access, developer (Billing lives here, per the constitution)
  const settings: NavItem[] = [{ key: 'settings', label: 'Settings', href: '/presence.html#settings' }];
  if (f.hasClientPortal && has(c, 'invite')) settings.push({ key: 'sharing', label: 'Sharing & access', href: '/sharing.html' });
  if (f.hasDeveloper && has(c, 'use_developer_mode')) settings.push({ key: 'developer', label: 'Developer Mode', href: '/developer.html' });
  sections.push({ key: 'settings', label: 'Settings', items: settings, utility: true });

  // Help
  utility('help', 'Help', '/help.html');

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
