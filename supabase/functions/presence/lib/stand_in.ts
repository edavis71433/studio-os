// ── Stand-in pictures (builder list items 331 and 332) ─────────────────────────
// Until the stock library's key is in (item 263), a first draft made in + New site has no
// photo to open with. It gets a stand-in instead: one photo per kind of business, kept in the
// app (thumbs/stand-ins/<family>.jpg; approved Pexels photos, credited in scripts/stand-ins/CREDITS.md), the
// same pictures the template pictures in + New site use. A stand-in is imported into the site's own Files
// like any photo, so it is self-hosted and replaceable in one click, and it says what it is:
// its alt text starts with STAND_IN_ALT, the publish check warns while one is still the
// opening photo, and the Files collection is "stand-in". Pure, apart from the one fetch.
import type { Family } from './design_gallery.ts';

/** The words every stand-in carries as its alt text. The publish check looks for them. */
export const STAND_IN_ALT = 'A stand-in picture, to swap for a photo of the business';

/** Where a kind of business's stand-in lives in the app. */
export const standInPath = (family: Family): string => `thumbs/stand-ins/${family}.jpg`;

/** Is this photo a stand-in (by its alt text)? Pure. */
export const isStandIn = (alt: unknown): boolean => String(alt || '').startsWith(STAND_IN_ALT);

/** A stand-in's bytes from the app, or null. A JPEG starts FF D8 FF; anything else (an HTML
 *  404 page) isn't the picture. */
export async function fetchStandIn(family: Family, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  const app = (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
  try {
    const r = await fetcher(`${app}/${standInPath(family)}`);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
  } catch { return null; }
}
