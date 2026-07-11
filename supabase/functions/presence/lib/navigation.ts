// ── Studio OS Information Architecture (A7.5) — navigation as DATA ────────────
// ONE catalog; the visible nav is derived from the caller's role + edition +
// capabilities. This is why Studio OS is one product across every edition/role:
// a capability the caller doesn't have simply doesn't appear — no empty menus,
// no dead ends, no separate builds. Pure — reads the frozen role/visibility
// models, never modifies them.
import type { SiteRole, SiteCapability } from './site_roles.ts';
import { editionFlags, type EditionKey, type EditionFlags } from '../commerce/editions.ts';

export interface NavItem { key: string; label: string; href: string; }
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

  // ── Architecture v1.0 (frozen): the PRIMARY bar is OUTCOMES ONLY —
  // Today · Website · Customers · Files · Analytics · Inbox · (Studio). Utilities
  // (Connections, Settings, Help) are composed the same way but flagged `utility`
  // so the shell renders them in the profile/overflow menu. No CMS/CRM/DAM/portal
  // words ever reach the UI; the internal routes are unchanged. A single-item
  // section renders as a top-level button; multi-item sections render as a group.
  const f = flagsOf(c);
  const sections: NavSection[] = [];
  const single = (key: string, label: string, href: string) => sections.push({ key, label, items: [{ key, label, href }] });
  const utility = (key: string, label: string, href: string) => sections.push({ key, label, items: [{ key, label, href }], utility: true });

  // Today — the calm home
  if (f.hasBusinessOS) single('today', 'Today', '/today.html');

  // Website — one home; its contents are sub-items (internally: the CMS)
  if (f.hasWebsite) {
    const website: NavItem[] = [{ key: 'content', label: 'Website', href: '/presence.html' }];
    website.push({ key: 'business_info', label: 'Business info', href: '/presence.html#business' });
    if (c.edition !== 'monitor') website.push({ key: 'design', label: 'Design', href: '/presence.html#design' });
    if (canPublish(c)) website.push({ key: 'publish', label: 'Publish', href: '/presence.html#publish' });
    if (canPublish(c)) website.push({ key: 'history', label: 'History', href: '/presence.html#history' });
    sections.push({ key: 'website', label: 'Website', items: website });
  }

  // Customers — the relationship area (internally: the CRM). Leads + the P2-C
  // sales Pipeline fold in here as sub-items (the primary bar stays outcomes-only).
  if (f.hasRelationship) {
    const customers: NavItem[] = [{ key: 'customers', label: 'Customers', href: '/crm.html' }];
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

  // Inbox — ONE place for what needs you: messages, approvals, notifications, leads
  single('inbox', 'Inbox', '/inbox.html');

  // Studio — the agency scope (agency roles only); open a client to re-scope
  if (f.hasAgency && c.isAgency) single('studio', 'Studio', '/agency.html');

  // ── Utilities — rendered in the profile/overflow menu, not the primary bar ──
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
  if (c.role === 'client_reviewer') return '/client.html';
  if (c.isAgency) return '/agency.html';
  const f = flagsOf(c);
  if (!f.hasBusinessOS && f.hasWebsite) return '/presence.html';
  return '/today.html';
}
