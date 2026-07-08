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

  const f = flagsOf(c);                 // Phase D: which feature areas this edition includes
  const sections: NavSection[] = [];

  // Landing / daily — items appear only if their feature area is in the edition,
  // so CMS-Only and Business-OS-Only each get a complete, non-empty Today.
  const today: NavItem[] = [];
  if (f.hasBusinessOS) today.push({ key: 'today', label: 'Today', href: '/today.html' });
  if (f.hasWebsite) today.push({ key: 'workspace', label: 'Your Presence', href: '/presence.html' });
  if (f.hasRelationship) today.push({ key: 'relationship', label: 'Relationship', href: '/crm.html' });
  if (f.hasWebsite) today.push({ key: 'leads', label: 'Leads', href: '/leads.html' });   // Phase M: surface the FD-2 inbox
  sections.push({ key: 'today', label: 'Today', items: today });

  // Website (CMS) — only when the edition includes it (Business-OS-Only hides it)
  if (f.hasWebsite) {
    const website: NavItem[] = [{ key: 'content', label: 'Your website', href: '/presence.html' }];
    website.push({ key: 'business_info', label: 'Business info', href: '/presence.html#business' });   // CP-2.6: searchable
    if (c.edition !== 'monitor') website.push({ key: 'design', label: 'Design', href: '/presence.html#design' });      // CP-2.6: the Design tab, palette-findable
    if (c.edition !== 'monitor') website.push({ key: 'media', label: 'Photos', href: '/presence.html#media' });
    if (canPublish(c)) website.push({ key: 'publish', label: 'Publish', href: '/presence.html#publish' });
    if (canPublish(c)) website.push({ key: 'scheduled', label: 'Scheduled', href: '/schedule.html' });  // Phase M: surface FD-1 scheduling
    if (canPublish(c)) website.push({ key: 'history', label: 'History & versions', href: '/presence.html#history' });   // CP-2.6
    sections.push({ key: 'website', label: 'Website', items: website });

    if (canDraft(c)) sections.push({ key: 'create', label: 'Create', items: [
      { key: 'studio', label: 'Creative Studio', href: '/presence.html' },
      { key: 'visual', label: 'Visual Studio', href: '/visual-studio.html' },
    ] });
  }

  // Grow (Business OS) — moments/growth/connections; hidden entirely for CMS-Only
  if (f.hasBusinessOS) {
    const grow: NavItem[] = [];
    if (f.hasBusinessOS) grow.push({ key: 'moments', label: 'Business Moments', href: '/today.html' });
    grow.push({ key: 'growth', label: 'Growth', href: '/presence.html' });
    if (f.hasConnected) grow.push({ key: 'connect', label: 'Connections', href: '/connections.html' });
    sections.push({ key: 'grow', label: 'Grow', items: grow });
  }

  // Clients (sharing) — the ownership/relationship surface, for someone who can invite
  if (f.hasClientPortal && has(c, 'invite')) sections.push({ key: 'clients', label: 'Clients', items: [
    { key: 'sharing', label: 'Sharing & access', href: '/sharing.html' },
    { key: 'preview', label: 'Preview client view', href: '/client.html' },
  ] });

  // Agency (only for agency members whose edition includes it)
  if (f.hasAgency && c.isAgency) sections.push({ key: 'agency', label: 'Agency', items: [
    { key: 'portfolio', label: 'Portfolio', href: '/agency.html' },
  ] });

  // Settings (+ Developer Mode when the edition includes it AND the capability is granted)
  const settings: NavItem[] = [{ key: 'settings', label: 'Settings', href: '/presence.html#settings' }];
  if (f.hasDeveloper && has(c, 'use_developer_mode')) settings.push({ key: 'developer', label: 'Developer Mode', href: '/developer.html' });
  sections.push({ key: 'settings', label: 'Settings', items: settings });

  // Help
  sections.push({ key: 'help', label: 'Help', items: [{ key: 'help', label: 'Help', href: '/help.html' }] });

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
