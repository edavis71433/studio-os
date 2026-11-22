// ── Builder list item 350 (Nov 22 review): a short name in the portal's address ──
// The portal's address was a long line ending in a 36-character code, which can't be
// read out on a call or printed on an invoice. Each studio may choose a short name in
// Settings (presence_sites.portal_slug, migration 0248, unique across the platform
// whatever the case); the address is then app.example/portal/<name>, which Netlify
// forwards to portal.html?studio=<name> (_redirects). The sign-in page asks the public
// route /public/studio/by-slug/<name>/brand, which answers the same brand as the id
// route plus the site id, so an old link with the id keeps working as it always did.
export const SLUG_MIN = 3, SLUG_MAX = 40;
/** Names that belong to pages, routes or the product itself, never to a studio. */
export const SLUG_RESERVED: ReadonlySet<string> = new Set(['portal', 'studio', 'app', 'admin', 'api', 'www', 'default', 'public', 'client', 'clients', 'settings', 'help', 'login', 'signin', 'sign-in', 'studio-os', 'studioos', 'test', 'demo', 'mail', 'support', 'by-slug']);

/** The name as kept: lower-case letters, digits and single hyphens, 3 to 40 long, never
 *  starting or ending with a hyphen, never a reserved word; '' when nothing usable is left.
 *  Spaces and other marks become hyphens, so "Marlow & Co" reads as "marlow-co". Pure. */
export function cleanSlug(v: unknown): string {
  const s = String(v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, SLUG_MAX).replace(/-$/, '');
  if (s.length < SLUG_MIN || SLUG_RESERVED.has(s)) return '';
  return s;
}
/** Does a string look like a studio's site id (the long form), as against a short name? Pure. */
export const isSiteIdLike = (v: unknown): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
/** Why a name was refused, in plain words. Pure. */
export function slugRefusal(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw) return 'Type a short name, like your studio’s name.';
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (s.length < SLUG_MIN) return `A short name needs at least ${SLUG_MIN} letters or numbers.`;
  if (SLUG_RESERVED.has(s)) return 'That name is kept for the portal itself. Choose another.';
  return '';
}
/** The portal's address for a studio: the short one when it has a name, else the long one. Pure. */
export function portalAddressOf(base: string, siteId: string, slug: string | null | undefined): string {
  const b = String(base || '').replace(/\/$/, '');
  const s = cleanSlug(slug);
  return s ? `${b}/portal/${s}` : `${b}/portal.html?studio=${siteId}`;
}
