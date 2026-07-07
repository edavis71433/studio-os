// ── Platform adapters (M11) — a READ-ONLY registry, PURE ────────────────────
// One common architecture for every platform: an adapter is DATA — detection
// markers and a human note. Detection informs observation context (and the
// operator); it never changes behavior per platform, requests credentials,
// or gains write access. A future platform is a new entry here, nothing more.

export interface PlatformAdapter {
  slug: string;
  name: string;
  markers: RegExp[];        // matched against homepage HTML + headers, read-only
  note: string;             // what an operator should know about this platform
}

export const ADAPTERS: PlatformAdapter[] = [
  { slug: 'wordpress', name: 'WordPress',
    markers: [/wp-content\//i, /wp-includes\//i, /<meta name="generator" content="WordPress/i],
    note: 'Self-managed or hosted WordPress; content edits happen in wp-admin.' },
  { slug: 'squarespace', name: 'Squarespace',
    markers: [/squarespace\.com/i, /<!-- This is Squarespace/i, /static1\.squarespace/i],
    note: 'Hosted site builder; content edits happen in the Squarespace editor.' },
  { slug: 'wix', name: 'Wix',
    markers: [/wix\.com/i, /wixstatic\.com/i, /X-Wix-/i],
    note: 'Hosted site builder; content edits happen in the Wix editor.' },
  { slug: 'shopify', name: 'Shopify',
    markers: [/cdn\.shopify\.com/i, /myshopify\.com/i, /Shopify\.theme/i],
    note: 'Commerce platform; products and pages edit in the Shopify admin.' },
  { slug: 'webflow', name: 'Webflow',
    markers: [/website-files\.com/i, /<meta content="Webflow" name="generator"/i, /w-webflow-badge/i],
    note: 'Hosted designer platform; edits happen in the Webflow designer.' },
  { slug: 'framer', name: 'Framer',
    markers: [/framerusercontent\.com/i, /<meta name="generator" content="Framer/i],
    note: 'Hosted designer platform; edits happen in the Framer editor.' },
];

/** Detect the platform from homepage HTML and response headers. Unknown → 'custom'
 *  (covers hand-built HTML and static sites — full observation either way). */
export function detectPlatform(html: string, headers: Record<string, string> = {}): string {
  const haystack = html + '\n' + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  for (const a of ADAPTERS) if (a.markers.some((m) => m.test(haystack))) return a.slug;
  return 'custom';
}
