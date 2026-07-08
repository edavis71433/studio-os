// ── Studio OS Information Architecture (A7.5) — navigation as DATA ────────────
// ONE catalog; the visible nav is derived from the caller's role + edition +
// capabilities. This is why Studio OS is one product across every edition/role:
// a capability the caller doesn't have simply doesn't appear — no empty menus,
// no dead ends, no separate builds. Pure — reads the frozen role/visibility
// models, never modifies them.
import type { SiteRole, SiteCapability } from './site_roles.ts';

export interface NavItem { key: string; label: string; href: string; }
export interface NavSection { key: string; label: string; items: NavItem[]; }

export interface NavContext {
  role: SiteRole;
  edition: string;              // site edition: 'monitor' (observe-only) | 'presence' (full)
  capabilities: SiteCapability[];
  isAgency: boolean;            // the caller is also an agency member
  isOperator: boolean;          // staff/system (operator)
}

const has = (c: NavContext, cap: SiteCapability) => c.capabilities.includes(cap);
const canDraft = (c: NavContext) => c.edition !== 'monitor' && has(c, 'edit');       // Monitor never drafts
const canPublish = (c: NavContext) => c.edition !== 'monitor' && has(c, 'publish');

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

  const sections: NavSection[] = [];

  // Landing / daily
  sections.push({ key: 'today', label: 'Today', items: [
    { key: 'today', label: 'Today', href: '/today.html' },
    { key: 'workspace', label: 'Your Presence', href: '/presence.html' },
  ] });

  // Website (CMS)
  const website: NavItem[] = [{ key: 'content', label: 'Your website', href: '/presence.html' }];
  if (c.edition !== 'monitor') website.push({ key: 'media', label: 'Photos', href: '/presence.html#media' });
  if (canPublish(c)) website.push({ key: 'publish', label: 'Publish', href: '/presence.html#publish' });
  sections.push({ key: 'website', label: 'Website', items: website });

  // Create (drafting) — only where the edition allows drafting
  if (canDraft(c)) sections.push({ key: 'create', label: 'Create', items: [
    { key: 'studio', label: 'Creative Studio', href: '/presence.html' },
    { key: 'visual', label: 'Visual Studio', href: '/visual-studio.html' },
  ] });

  // Grow
  sections.push({ key: 'grow', label: 'Grow', items: [
    { key: 'moments', label: 'Business Moments', href: '/today.html' },
    { key: 'growth', label: 'Growth', href: '/presence.html' },
    { key: 'connect', label: 'Connections', href: '/connections.html' },
  ] });

  // Clients (only for someone who can invite/manage sharing — the owner)
  if (has(c, 'invite')) sections.push({ key: 'clients', label: 'Clients', items: [
    { key: 'sharing', label: 'Sharing & access', href: '/sharing.html' },
    { key: 'preview', label: 'Preview client view', href: '/client.html' },
  ] });

  // Agency (only for agency members)
  if (c.isAgency) sections.push({ key: 'agency', label: 'Agency', items: [
    { key: 'portfolio', label: 'Portfolio', href: '/agency.html' },
  ] });

  // Settings (+ the Developer Mode entry point, only if the capability is granted)
  const settings: NavItem[] = [{ key: 'settings', label: 'Settings', href: '/presence.html#settings' }];
  if (has(c, 'use_developer_mode')) settings.push({ key: 'developer', label: 'Developer Mode', href: '/presence.html#developer' });
  sections.push({ key: 'settings', label: 'Settings', items: settings });

  // Help
  sections.push({ key: 'help', label: 'Help', items: [{ key: 'help', label: 'Help', href: '/help.html' }] });

  return sections.filter((s) => s.items.length > 0);
}

/** The caller's landing surface, by role. */
export function landingFor(c: NavContext): string {
  if (c.role === 'client_reviewer') return '/client.html';
  if (c.isAgency) return '/agency.html';
  return '/today.html';
}
