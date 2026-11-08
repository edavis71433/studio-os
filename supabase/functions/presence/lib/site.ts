// Resolve the caller's ONE presence site via RLS. Reading presence_sites under
// the caller's JWT returns exactly their own site (client) or nothing (staff /
// no site) — the ownership chain IS the resolver, no service-role guessing.
import { asUser } from './db.ts';

export interface SiteRow {
  id: string;
  client_id: string;
  status: string;
  last_published_at: string | null;
  template_slug: string;
  template_version: string;
  custom_domain: string | null;
  netlify_site_id: string | null;
  edition: 'monitor' | 'presence';   // M11: monitor = observing an existing external website
}

/** The Netlify name every hosted site gets, built from our own id (the provisioner's
 *  routes/admin.ts and commerce/provision.ts, so reruns converge). */
export const hostedName = (siteId: string): string => `presence-${String(siteId).replace(/-/g, '').slice(0, 12)}`;

/** The address a hosted site answers at: its own domain, else its Netlify name. Never
 *  netlify_site_id, which is Netlify's internal id and not part of any address; built
 *  from it, a page's canonical link, a form's thank-you redirect and the uptime probe
 *  all went to a host that doesn't exist. Empty when there is neither. Pure. */
export function siteOrigin(site: { id?: string | null; custom_domain?: string | null; netlify_site_id?: string | null } | null | undefined): string {
  if (site?.custom_domain) return `https://${site.custom_domain}`;
  if (site?.netlify_site_id && site.id) return `https://${hostedName(site.id)}.netlify.app`;
  return '';
}

export async function resolveSite(jwt: string): Promise<SiteRow | null> {
  const r = await asUser(jwt, 'presence_sites?select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1');
  if (!r.ok || !Array.isArray(r.json) || r.json.length === 0) return null;
  return r.json[0] as SiteRow;
}
