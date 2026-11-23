// ── Builder list item 59 (Nov 2026): the studio's own name and logo on what clients see ──
// One shape, three doors. `studioBrandOf` reads a site's business name, brand
// colour and logo (the same record every email already uses) and signs the logo
// for an hour, which is as long as a page needs it. The PUBLIC read answers the
// sign-in page before anyone is signed in: it gives away only what the studio's
// own website already shows (its name and logo), keyed by a site id nobody can
// guess, and is cached so a busy sign-in page costs one read an hour.
import { appBase } from '../../_shared/app_url.ts';   // builder item 388: every link starts at the app's address
import { json } from '../../_shared/http.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT } from '../lib/email_brand.ts';
import type { SiteRow } from '../lib/site.ts';
import { svc } from '../lib/db.ts';

export interface StudioBrand { name: string; logo_url: string | null; accent: string; is_default: boolean; cover_url: string | null; font: string }

const PAGE_LOGO_TTL = 60 * 60;

/** The studio's name, colour and logo for a page. Never throws; the default when a read fails. */
export async function studioBrandOf(siteId: string): Promise<StudioBrand> {
  const b = await loadEmailBrand(siteId, { logoTtl: PAGE_LOGO_TTL }).catch(() => EMAIL_BRAND_DEFAULT);
  // item 179: a studio that never filled in Business details still has a name, the one
  // on its account. Its clients see that, never the platform's.
  const named = b.name !== EMAIL_BRAND_DEFAULT.name;
  const name = named ? b.name : (await accountNameOf(siteId)) || b.name;
  // items 247 and 335 (direction A): the studio's cover picture and heading font go with its brand
  const look = await import('../lib/portal_settings.ts').then((m) => m.readPortalSettings(siteId)).then((s) => s.look).catch(() => ({ cover_media_id: null, heading_font: 'fraunces' as const }));
  const cover_url = look.cover_media_id ? await coverUrlOf(siteId, look.cover_media_id) : null;
  return { name, logo_url: b.logoUrl || null, accent: b.accent, is_default: name === EMAIL_BRAND_DEFAULT.name && !b.logoUrl, cover_url, font: look.heading_font };
}
/** A signed address for the studio's cover picture (one of its own image files), good for an hour. */
export async function coverUrlOf(siteId: string, mediaId: string): Promise<string | null> {
  const { studioLogoUrl } = await import('../lib/email_brand.ts');
  return await studioLogoUrl(siteId, mediaId, PAGE_LOGO_TTL).catch(() => null);
}

/** The business name on a site's account (clients.name), '' when there is none or the read fails. */
export async function accountNameOf(siteId: string): Promise<string> {
  try {
    if (!/^[0-9a-f-]{36}$/.test(siteId)) return '';
    const s = await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`);
    const clientId = s.ok && Array.isArray(s.json) ? String(s.json[0]?.client_id || '') : '';
    if (!/^[0-9a-f-]{36}$/.test(clientId)) return '';
    const c = await svc(`clients?id=eq.${clientId}&select=name&limit=1`);
    return accountNameFrom(c.ok && Array.isArray(c.json) ? c.json[0]?.name : '');
  } catch { return ''; }
}
/** A name fit to show: trimmed, at most 80 characters, never the platform's own. Pure. */
export function accountNameFrom(raw: unknown): string {
  const n = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n && n !== EMAIL_BRAND_DEFAULT.name ? n : '';
}

/** The contact details a studio's own website already shows (its Business details: the
 *  email and phone on presence_identity, the first location's phone when the identity has
 *  none). Builder item 349: the footer line of the public pages. Never throws. */
export interface PublicContact { email: string | null; phone: string | null }
export async function publicContactOf(siteId: string): Promise<PublicContact> {
  const none: PublicContact = { email: null, phone: null };
  try {
    if (!/^[0-9a-f-]{36}$/.test(siteId)) return none;
    const [i, l] = await Promise.all([
      svc(`presence_identity?site_id=eq.${siteId}&select=email,phone&limit=1`),
      svc(`presence_locations?site_id=eq.${siteId}&select=phone&limit=1`).catch(() => null),
    ]);
    const id = (i.ok && Array.isArray(i.json) && i.json[0]) || {};
    const loc = (l?.ok && Array.isArray(l.json) && l.json[0]) || {};
    return publicContactFrom(id.email, id.phone || loc.phone);
  } catch { return none; }
}
/** Pure: an email only when it looks like one, a phone trimmed to what a phone is, each at most 120 chars. */
export function publicContactFrom(email: unknown, phone: unknown): PublicContact {
  const e = String(email ?? '').trim().slice(0, 120);
  const p = String(phone ?? '').replace(/[^\d+() .-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null, phone: /\d{3,}/.test(p) ? p : null };
}

/** GET /public/studio/:siteId/brand, before sign-in: the sign-in page's header, (builder list
 *  item 230) which ways besides the emailed code this studio's clients may sign in, and (builder
 *  item 349) the studio's public contact details for the footer of the pages a client lands on. */
export async function handlePublicStudioBrand(siteId: string, cors: Record<string, string>): Promise<Response> {
  const [brand, signin, contact] = await Promise.all([
    studioBrandOf(siteId),
    import('../lib/portal_settings.ts').then((m) => m.readPortalSettings(siteId)).then((s) => s.signin).catch(() => ({ google: false, password: true })),
    publicContactOf(siteId),
  ]);
  return json({ data: { ...brand, signin, contact } }, 200, { ...cors, 'Cache-Control': 'public, max-age=900' });
}

/** GET /public/studio/:siteId/logo (builder item 348): the logo's lasting address for emails.
 *  Answers a 302 to a freshly signed address, good for an hour; mail apps follow it. */
export async function handlePublicStudioLogo(siteId: string, cors: Record<string, string>): Promise<Response> {
  try {
    const s = await svc(`presence_settings?site_id=eq.${siteId}&select=brand_kit,logo_media_id&limit=1`);
    const row = (s.ok && Array.isArray(s.json) && s.json[0]) || null;
    const logoId = String(row?.logo_media_id || row?.brand_kit?.logo_media_id || '');
    const { studioLogoUrl } = await import('../lib/email_brand.ts');
    const url = logoId ? await studioLogoUrl(siteId, logoId, PAGE_LOGO_TTL) : null;
    if (!url) return new Response(null, { status: 404, headers: { ...cors, 'Cache-Control': 'public, max-age=300' } });
    return new Response(null, { status: 302, headers: { ...cors, Location: url, 'Cache-Control': 'private, max-age=3000' } });
  } catch { return new Response(null, { status: 404, headers: cors }); }
}

/** GET /public/studio/default/brand (builder item 341): the studio a bare /portal belongs to,
 *  so the app's sign-in page never says the product's name to a client. AGENCY_SITE_ID (the platform's own
 *  studio, already a setting) names it; without that, the first studio on this platform that ever took on a client. */
export async function handlePublicDefaultStudio(cors: Record<string, string>): Promise<Response> {
  const siteId = await defaultStudioSiteId();
  if (!siteId) return json({ data: null }, 200, { ...cors, 'Cache-Control': 'public, max-age=900' });
  return handlePublicStudioBrand(siteId, cors);
}
export async function defaultStudioSiteId(): Promise<string> {
  const env = String(Deno.env.get('AGENCY_SITE_ID') || '').trim();
  if (/^[0-9a-f-]{36}$/i.test(env)) return env.toLowerCase();
  try {
    const q = await svc(`presence_service_links?select=agency_site_id,created_at&status=eq.active&order=created_at.asc&limit=1`);
    const id = q.ok && Array.isArray(q.json) ? String(q.json[0]?.agency_site_id || '') : '';
    return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : '';
  } catch { return ''; }
}

/** GET /public/studio/by-slug/:slug/brand (builder item 350): the studio behind a short address,
 *  the same answer as the id route plus the site id the sign-in page then uses. */
export async function handlePublicStudioBySlug(slug: string, cors: Record<string, string>): Promise<Response> {
  const { cleanSlug } = await import('../lib/portal_slug.ts');
  const s = cleanSlug(slug);
  if (!s) return json({ error: 'not_found' }, 404, cors);
  const q = await svc(`presence_sites?portal_slug=ilike.${encodeURIComponent(s)}&select=id&limit=1`).catch(() => ({ ok: false, json: null }));
  const id = q.ok && Array.isArray(q.json) ? String(q.json[0]?.id || '') : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'not_found', message: 'No studio has that name.' }, 404, { ...cors, 'Cache-Control': 'public, max-age=300' });
  const r = await handlePublicStudioBrand(id, cors);
  const body = await r.json().catch(() => ({}));
  return json({ data: { ...(body?.data || {}), site_id: id } }, 200, { ...cors, 'Cache-Control': 'public, max-age=900' });
}

/** GET /public/studio/:siteId/manifest (builder item 340): the portal as the studio's own app on
 *  a phone: its name, its colour, and the portal as the page it opens. The platform's icons stand
 *  in for every studio (a home-screen icon must be a square PNG, which a logo seldom is). */
export async function handlePublicStudioManifest(siteId: string, cors: Record<string, string>): Promise<Response> {
  const b = await studioBrandOf(siteId);
  const base = appBase();   // item 388: the app's address
  const name = b.is_default ? 'Client portal' : b.name;
  const short = name.length <= 12 ? name : name.split(/\s+/)[0].slice(0, 12);
  const manifest = {
    name, short_name: short, description: `Your client portal with ${name}.`,
    id: `/client.html?studio=${siteId}`, start_url: `${base}/client.html`, scope: `${base}/`, display: 'standalone', orientation: 'portrait-primary',
    theme_color: /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : '#5b3fa0', background_color: '#faf8f5', lang: 'en',
    icons: [{ src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    shortcuts: [{ name: 'Messages', url: `${base}/client.html#messages` }, { name: 'Documents', url: `${base}/client.html#documents` }],
  };
  return new Response(JSON.stringify(manifest), { status: 200, headers: { ...cors, 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=900' } });
}

/** GET /brand/studio, signed in: Settings shows the studio what its clients see. */
export async function handleStudioBrandGet(site: SiteRow, cors: Record<string, string>): Promise<Response> {
  return json({ data: await studioBrandOf(site.id) }, 200, cors);
}
