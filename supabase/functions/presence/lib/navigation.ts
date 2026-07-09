// ── Studio OS Information Architecture (A7.5) — navigation as DATA ────────────
// ONE catalog; the visible nav is derived from the caller's role + edition +
// capabilities. This is why Studio OS is one product across every edition/role:
// a capability the caller doesn't have simply doesn't appear — no empty menus,
// no dead ends, no separate builds. Pure — reads the frozen role/visibility
// models, never modifies them.
import type { SiteRole, SiteCapability } from './site_roles.ts';
import { editionFlags, type EditionKey, type EditionFlags } from '../commerce/editions.ts';

export interface NavItem { key: string; label: string; href: string; }
export interface NavSection { key: string; label: string; items: NavItem[]; }

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

  // ── Architecture v1.0: customer-facing OUTCOME areas, composed from Edition ×
  // Role. Areas: Today · Website · Customers · Files · Inbox · (Connections) ·
  // (Studio) · Settings · Help. No CMS/CRM/DAM/portal words ever reach the UI;
  // the internal routes are unchanged. A single-item section renders as a
  // top-level button; multi-item sections render as a labelled group.
  const f = flagsOf(c);
  const sections: NavSection[] = [];
  const single = (key: string, label: string, href: string) => sections.push({ key, label, items: [{ key, label, href }] });

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

  // Customers — the relationship area (internally: the CRM). Leads fold in here + Inbox.
  if (f.hasRelationship) single('customers', 'Customers', '/crm.html');

  // Files — the asset library (internally: the DAM). Photos + generated assets.
  if (f.hasWebsite) {
    const files: NavItem[] = [{ key: 'files_photos', label: 'Photos', href: '/presence.html#media' }];
    if (canDraft(c)) files.push({ key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html' });
    sections.push({ key: 'files', label: 'Files', items: files });
  }

  // Inbox — ONE place for what needs you: messages, approvals, notifications, leads
  single('inbox', 'Inbox', '/inbox.html');

  // Connections — integrations (the connected services)
  if (f.hasConnected) single('connections', 'Connections', '/connections.html');

  // Studio — the agency scope (agency roles only); open a client to re-scope
  if (f.hasAgency && c.isAgency) single('studio', 'Studio', '/agency.html');

  // Settings — account, sharing/access, developer (Billing lives here, per the constitution)
  const settings: NavItem[] = [{ key: 'settings', label: 'Settings', href: '/presence.html#settings' }];
  if (f.hasClientPortal && has(c, 'invite')) settings.push({ key: 'sharing', label: 'Sharing & access', href: '/sharing.html' });
  if (f.hasDeveloper && has(c, 'use_developer_mode')) settings.push({ key: 'developer', label: 'Developer Mode', href: '/developer.html' });
  sections.push({ key: 'settings', label: 'Settings', items: settings });

  // Help
  single('help', 'Help', '/help.html');

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
