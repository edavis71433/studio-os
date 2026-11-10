// ── Builder list item 59 (Nov 2026): the studio's own name and logo on what clients see ──
// One shape, three doors. `studioBrandOf` reads a site's business name, brand
// colour and logo (the same record every email already uses) and signs the logo
// for an hour, which is as long as a page needs it. The PUBLIC read answers the
// sign-in page before anyone is signed in: it gives away only what the studio's
// own website already shows (its name and logo), keyed by a site id nobody can
// guess, and is cached so a busy sign-in page costs one read an hour.
import { json } from '../../_shared/http.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT } from '../lib/email_brand.ts';
import type { SiteRow } from '../lib/site.ts';

export interface StudioBrand { name: string; logo_url: string | null; accent: string; is_default: boolean }

const PAGE_LOGO_TTL = 60 * 60;

/** The studio's name, colour and logo for a page. Never throws; the default when a read fails. */
export async function studioBrandOf(siteId: string): Promise<StudioBrand> {
  const b = await loadEmailBrand(siteId, { logoTtl: PAGE_LOGO_TTL }).catch(() => EMAIL_BRAND_DEFAULT);
  return { name: b.name, logo_url: b.logoUrl || null, accent: b.accent, is_default: b.name === EMAIL_BRAND_DEFAULT.name && !b.logoUrl };
}

/** GET /public/studio/:siteId/brand, before sign-in: the sign-in page's header. */
export async function handlePublicStudioBrand(siteId: string, cors: Record<string, string>): Promise<Response> {
  const data = await studioBrandOf(siteId);
  return json({ data }, 200, { ...cors, 'Cache-Control': 'public, max-age=900' });
}

/** GET /brand/studio, signed in: Settings shows the studio what its clients see. */
export async function handleStudioBrandGet(site: SiteRow, cors: Record<string, string>): Promise<Response> {
  return json({ data: await studioBrandOf(site.id) }, 200, cors);
}
