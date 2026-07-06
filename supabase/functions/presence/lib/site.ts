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
}

export async function resolveSite(jwt: string): Promise<SiteRow | null> {
  const r = await asUser(jwt, 'presence_sites?select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id&limit=1');
  if (!r.ok || !Array.isArray(r.json) || r.json.length === 0) return null;
  return r.json[0] as SiteRow;
}
