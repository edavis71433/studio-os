// ── How heavy a published page is (builder list item 211) ─────────────────────────
// Review file 01, finding 1: a Squarespace home page took 58 requests and 1.26 MB, and
// one client's 8.4 MB; a page Studio OS publishes is about 25 kB. That is a selling point,
// so it is kept: a test (page_weight_211_test.mjs) fails when any page of any template's
// samples passes PAGE_WEIGHT_LIMIT_KB, and the pitch pack quotes the same numbers.
//
// A page's weight is what a phone must fetch before it can draw it: the page itself and
// the style sheets and scripts it loads from the site. Photos are left out: they are sized
// to the screen and wait until they are scrolled to.

/** The most a published page may weigh, in kB. */
export const PAGE_WEIGHT_LIMIT_KB = 100;
/** What a typical site's pages weigh, in kB, at most (the test keeps it true). */
export const TYPICAL_PAGE_KB = 30;

const enc = new TextEncoder();
const bytesOf = (v: string | Uint8Array): number => (typeof v === 'string' ? enc.encode(v).length : v.byteLength);

/** Each page's weight in bytes, heaviest first: the page and the site's own style sheets
 *  and scripts it names. Pure. */
export function pageWeights(files: Record<string, string | Uint8Array>): Array<{ path: string; bytes: number; parts: string[] }> {
  const out: Array<{ path: string; bytes: number; parts: string[] }> = [];
  for (const [path, body] of Object.entries(files)) {
    if (!path.endsWith('.html')) continue;
    const html = typeof body === 'string' ? body : new TextDecoder().decode(body);
    const parts = [...new Set([...html.matchAll(/(?:href|src)="\/?([^"?#:]+\.(?:css|js))(?:[?#][^"]*)?"/g)].map((m) => m[1]))].filter((p) => files[p] !== undefined);
    out.push({ path, bytes: bytesOf(body) + parts.reduce((n, p) => n + bytesOf(files[p]), 0), parts });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}
