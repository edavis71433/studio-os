// ── Phase FE-1 · Feature-boundary enforcement (outside RLS) ──────────────────
// RLS answers "is this row yours"; entitlement STATUS answers "is your
// subscription active"; this answers "does your EDITION include this capability
// AREA at all". It is the server-side twin of navigation.ts — the nav hides what
// you didn't buy, and this refuses it at the boundary, because hiding a menu was
// never the security control (see commerce/enforce.ts). Denials are a friendly
// upgrade 403, in the same spirit as draftingDenial.
//
// Design invariants:
//   • FAIL-OPEN on denial: an unreadable/absent entitlement resolves to the
//     site's natural edition (Studio OS for a full site) — a paying customer is
//     never wrongly denied by a lookup hiccup. The gate only bites when the
//     edition is DEFINITIVELY a narrower one that excludes the area.
//   • Supersets include everything: Studio OS / Managed / Agency / Enterprise
//     never hit a denial here.
//   • Baseline/shell routes (the app frame: bootstrap, inbox, notes, export,
//     settings, concierge) return null → always allowed, every edition.
//   • The map MUST agree with lib/navigation.ts buildNav (proven by the test
//     matrix): a nav-hidden area is server-denied; a nav-shown area is allowed.

import { svc } from '../lib/db.ts';
import { json } from '../../_shared/http.ts';
import { isPlanKey } from '../commerce/catalog.ts';
import { editionFromPlan, editionFromSite, editionIncludes, type EditionKey, type EditionFeature } from '../commerce/editions.ts';

/** Map a resolved route + method to the ONE capability area it belongs to, or
 *  null for baseline/shell routes that every edition may reach. Pure. Keep this
 *  in lockstep with lib/navigation.ts (the test matrix enforces agreement).
 *
 *  Reads of shared business facts (GET /identity, /voice, /location) are baseline
 *  so the shell can render a name/address; EDITING them is website content. */
export function featureForRoute(route: string, method: string): EditionFeature | null {
  const seg = route.split('/').filter(Boolean);
  const top = seg[0] || '';
  const isWrite = method === 'PUT' || method === 'POST' || method === 'DELETE' || method === 'PATCH';

  switch (top) {
    // ── Website / CMS — authoring, hosting, publishing, the site's own AI ──────
    case 'publish': case 'restore': case 'publishes': case 'launches':
    case 'preview': case 'redirects': case 'search':
    case 'brand': case 'writer': case 'editor': case 'review':
    case 'visual': case 'assets': case 'media': case 'stock': case 'content-library':
    case 'offerings': case 'testimonials': case 'faqs': case 'posts':
      return 'website';
    case 'site':
      return seg.length > 1 ? 'website' : null;          // /site GET = bootstrap (baseline); /site/template(s) = website
    case 'identity': case 'location': case 'voice':
      return isWrite ? 'website' : null;                 // read = baseline; edit = website content
    case 'schedule':
      return isWrite ? 'website' : null;                 // scheduling a publish = website; listing lives in Inbox (baseline)
    case 'foundations':
      return (seg[1] === 'dns' || seg[1] === 'domain') ? 'website' : null;  // custom domain + DNS = website hosting; other foundations are platform baseline
    case 'dev':
      return 'developer';                                // Developer Mode — its own atom (CMS has it; Monitor/Business OS do not)

    // ── Customers / CRM ───────────────────────────────────────────────────────
    case 'crm':
      return 'relationship';

    // ── Sales & Customer Lifecycle (P2-C) — part of the relationship area ─────
    case 'sales':
      return 'relationship';   // authed /sales/* only; public token actions are pre-auth

    // ── Service Delivery (P2-D) — projects/tasks/milestones are Business-OS work ─
    case 'projects':
      return 'relationship';

    // ── Business Moments — the daily intelligence surface ─────────────────────
    case 'moments':
      return 'business_moments';

    // ── Growth/AI intelligence (the Business-OS brains) ───────────────────────
    case 'coach':
      return 'ai';

    // ── Connected services ────────────────────────────────────────────────────
    case 'connections':
      return 'connected';

    // ── Analytics / reporting ─────────────────────────────────────────────────
    case 'analytics':
      return 'reports';

    // ── Baseline / cross-cutting — the app shell, always allowed ──────────────
    // inbox (forms/inbox, approve/send), notes, changes, health, restore-to-draft,
    // portal (context/feed/members/shares), concierge, knowledge, monitor,
    // launch, foundations(non-dns), export, settings, marketplace/features.
    default:
      return null;
  }
}

const FRIENDLY: Record<EditionFeature, string> = {
  website: 'Editing and publishing your website is part of the CMS. Your current plan doesn’t include it — adding it makes Studio OS your website’s home.',
  developer: 'Developer Mode is part of the CMS. Your current plan doesn’t include website authoring yet.',
  forms: 'Lead capture forms come with a hosted website. Your current plan doesn’t include it yet.',
  business_moments: 'Business Moments are part of Business OS — the daily read on your business. Your current plan doesn’t include it yet.',
  connected: 'Connecting the services you already use is part of Business OS. Your current plan doesn’t include it yet.',
  ai: 'That guidance comes with Business OS. Your current plan doesn’t include it yet.',
  relationship: 'The Customers area is part of Business OS. Your current plan doesn’t include it yet.',
  reports: 'Analytics is part of your plan when your business data is being tracked. Your current plan doesn’t include it yet.',
  client_portal: 'Sharing a client view is part of your plan. Your current plan doesn’t include it yet.',
  managed_service: 'That’s handled by our Managed service. Your current plan doesn’t include it yet.',
  agency: 'The Studio (portfolio) view is part of the Agency plan.',
  enterprise: 'That’s part of Enterprise — multi-location, governed publishing.',
};

/** Refuse at the boundary when the edition doesn't include the required feature.
 *  Returns the friendly 403 Response, or null when allowed. Pure over its inputs
 *  (reuses editionIncludes). */
export function requireFeature(edition: EditionKey, feature: EditionFeature, cors: Record<string, string>): Response | null {
  if (editionIncludes(edition, feature)) return null;
  return json({
    error: 'feature_not_in_plan',
    feature,
    upgrade: true,
    message: FRIENDLY[feature] || 'That capability isn’t part of your current plan yet.',
  }, 403, cors);
}

/** Resolve the caller-site's FEATURE edition from its entitlement plan, falling
 *  open to the site's natural edition (never wrongly denies). One svc read; only
 *  called when a route actually requires a feature. */
export async function loadEdition(clientId: string | null, siteEdition: string): Promise<EditionKey> {
  if (clientId) {
    try {
      const r = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(clientId)}&product=eq.presence&select=plan&limit=1`);
      const p = r.ok && Array.isArray(r.json) && r.json.length ? r.json[0].plan : null;
      if (isPlanKey(p)) return editionFromPlan(p);
    } catch { /* fall through to the site's natural edition */ }
  }
  return editionFromSite(siteEdition, {});
}
