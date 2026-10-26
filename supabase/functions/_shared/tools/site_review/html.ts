// ── Site Review: read one HTML page into plain facts ─────────────────────────
// Pure string work (no DOM in the edge runtime), the same regex approach as
// clever-api's deepAudit, but kept per page so the checks can compare pages
// (unique titles, name/address/phone matching across pages and schema).
// Every value here may end up quoted in a report, so text is decoded,
// whitespace-collapsed and length-capped.

export interface LinkFact { href: string; text: string; inNav: boolean; inFooter: boolean }

export interface PageFacts {
  url: string;
  path: string;
  title: string;
  metaDescription: string;
  canonical: string | null;
  noindex: boolean;
  lang: boolean;
  viewport: boolean;
  favicon: boolean;
  h1s: string[];
  headingLevels: number[];
  contentH1s: string[];          // H1s inside the page's own content (not header/footer)
  truncated: boolean;            // the fetch hit the size cap: the end of the page is missing
  images: { total: number; missingAlt: number };
  og: { title: boolean; description: boolean; image: boolean; siteName: string };
  jsonld: { blocks: number; parseErrors: number; items: Record<string, unknown>[] };
  telLinks: string[];
  mailtoLinks: number;
  forms: number;
  phonesInText: string[];
  address: string | null;
  addressInFooter: boolean;
  mapEmbed: boolean;
  links: LinkFact[];
  wordCount: number;
  firstParagraph: string;
  placeholder: string | null;
  mixedContent: string[];
  cta: string | null;
  social: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®' };

export function decode(s: string): string {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const clean = (s: string, max = 300) => decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);

/** Value of attribute `name` in one tag's source, or null. */
export function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function metaContent(html: string, key: 'name' | 'property', value: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const v = attr(m[0], key);
    if (v && v.toLowerCase() === value) return attr(m[0], 'content') ?? '';
  }
  return null;
}

const strip = (html: string, tags: string[]) => tags.reduce((h, t) => h.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}>`, 'gi'), ' '), html);

function regions(html: string) {
  const body = (html.match(/<body\b[\s\S]*$/i) || [html])[0];
  const navs = [...body.matchAll(/<(nav|header)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const footers = [...body.matchAll(/<footer\b[\s\S]*?<\/footer>/gi)].map((m) => m[0]);
  // No <footer>: treat the last fifth of the body as the footer, where builders put address and phone.
  const footer = footers.length ? footers.join(' ') : body.slice(Math.floor(body.length * 0.8));
  return { body, nav: navs.join(' '), footer };
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;
// At least one word between the number and the suffix: "5000 square feet"
// and "3 Court dates" are copy, not addresses (audit 2.8).
const STREET = /\b\d{1,6}\s+(?:[A-Z0-9][\w.'-]*\s+){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Sq|Square)\b\.?(?:[\s,]+(?:Suite|Ste|Unit|#)\s*[\w-]+)?/i;
// "your business name" only as a template slot ("[Your Business Name]", "your
// business name here"): real copy says "not just your business name".
const PLACEHOLDER = /\[your (?:business|company) name\]|\b(lorem ipsum|dolor sit amet|your (?:business|company) name here|sample text|insert (?:text|content) here|john doe|jane doe|example\.com|coming soon placeholder|blog post title (?:one|two|three|four)|first blog post|sample (?:page|post)|this is (?:an? )?(?:example|sample) (?:page|post))\b/i;
const CTA = /\b(book(?: now| online| a| an)?|reserve|reservations?|call(?: now| us| today)?|order(?: now| online)?|get a (?:quote|free quote|estimate)|free (?:quote|estimate|consultation)|request (?:a )?(?:quote|appointment|estimate)|schedule|make an appointment|appointments?|buy now|shop(?: now)?|get started|sign up|contact us|view menu|see (?:the )?menu)\b/i;

export function parseJsonLd(html: string): { blocks: number; parseErrors: number; items: Record<string, unknown>[] } {
  const out = { blocks: 0, parseErrors: 0, items: [] as Record<string, unknown>[] };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    out.blocks++;
    try {
      const parsed = JSON.parse(m[1].trim());
      const push = (x: unknown) => { if (x && typeof x === 'object' && !Array.isArray(x)) out.items.push(x as Record<string, unknown>); };
      const walk = (x: unknown) => {
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === 'object') {
          const g = (x as Record<string, unknown>)['@graph'];
          if (Array.isArray(g)) g.forEach(walk); else push(x);
        }
      };
      walk(parsed);
    } catch { out.parseErrors++; }
  }
  return out;
}

export function parsePage(html: string, url: string, socialProfiles: (html: string, base: string, schemas: unknown[]) => string[], truncated = false): PageFacts {
  const u = new URL(url);
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [''])[0] || html.slice(0, 50000);
  const { body, nav, footer } = regions(html);

  const robots = (metaContent(head, 'name', 'robots') || '') + ' ' + (metaContent(head, 'name', 'googlebot') || '');
  const canonTag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, 'rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  const iconTag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(attr(t, 'rel') || ''));

  const headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  // No alt, or an empty one, counts as missing. The exception is an image the
  // page itself marks as decorative (role="presentation"/"none" or aria-hidden),
  // where alt="" is the correct markup.
  const decorative = (t: string) => /\srole\s*=\s*["']?(presentation|none)\b/i.test(t) || /\saria-hidden\s*=\s*["']?true\b/i.test(t);
  const missingAlt = imgs.filter((t) => {
    const a = attr(t, 'alt');
    if (a === null) return true;
    return a.trim() === '' && !decorative(t);
  }).length;

  const jsonld = parseJsonLd(html);

  // Links from the page's real markup only: an <a> written inside a script or
  // template is a JavaScript string ("/'+esc(href)+'"), not a link.
  const links: LinkFact[] = [];
  const inRegion = (region: string, tag: string) => region.length > 0 && region.includes(tag);
  const linkHtml = strip(body, ['script', 'template', 'noscript', 'style']);
  for (const m of linkHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[0], 'href');
    if (!href || /['"<>{}\\]|%22|%27|\+\s*\w+\s*\(/.test(href)) continue;
    links.push({ href, text: clean(m[1], 80), inNav: inRegion(nav, m[0]), inFooter: inRegion(footer, m[0]) });
  }
  const tel = links.filter((l) => /^tel:/i.test(l.href)).map((l) => l.href.replace(/^tel:/i, '').trim());

  const mainHtml = strip(body, ['script', 'style', 'noscript', 'svg', 'template']);
  const contentHtml = strip(mainHtml, ['nav', 'header', 'footer']);
  const text = clean(mainHtml, 200000);
  const contentText = clean(contentHtml, 200000);
  const footerText = clean(strip(footer, ['script', 'style']), 20000);
  const words = contentText ? contentText.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length : 0;

  const firstP = (contentHtml.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1];
  // The footer is where the real address lives; the body only as a fallback.
  const street = footerText.match(STREET) || text.match(STREET);

  // "First screen": the start of the page's own content, up to the SECOND
  // section heading (builders put a tagline <h2> under the H1, before the
  // button; audit 2.3) or about 6,000 characters of markup past the H1,
  // whichever comes first. Builders put the hero CTA there.
  const firstScreen = (() => {
    const h = contentHtml;
    const h2s = [...h.matchAll(/<h2\b/gi)].map((m) => m.index ?? 0);
    const cut = Math.min(h2s[1] ?? h.length, 6000 + Math.max(0, h.search(/<h1\b/i)));
    return h.slice(0, cut);
  })();
  const ctaTexts = [...firstScreen.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(m[2], 60) || clean(attr(m[0], 'aria-label') || '', 60))
    .concat([...firstScreen.matchAll(/<input\b[^>]*type\s*=\s*["']?submit[^>]*>/gi)].map((m) => clean(attr(m[0], 'value') || '', 60)));
  const ctaEl = ctaTexts.find((t) => CTA.test(t));
  // Heading outline from the page's own content: builder footers end in
  // h4-h6 column titles that would read as a skipped level (audit 2.12).
  const contentHeadingLevels = [...contentHtml.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  const contentH1s = [...contentHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1], 200));
  // Header buttons ("Book now" in the top bar) are on the first screen too.
  const navCta = [...nav.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(m[2], 60)).find((t) => CTA.test(t) && !/^contact us$/i.test(t));

  const mixed: string[] = [];
  if (u.protocol === 'https:') {
    for (const m of html.matchAll(/<(?:img|script|iframe|source|video|audio)\b[^>]*\ssrc\s*=\s*["']?(http:\/\/[^"'\s>]+)/gi)) { if (mixed.length < 5) mixed.push(m[1]); }
    for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*href\s*=\s*["']?(http:\/\/[^"'\s>]+)/gi)) { if (mixed.length < 5) mixed.push(m[1]); }
  }

  const placeholder = (text.match(PLACEHOLDER) || [])[0] || null;
  const phones = [...new Set((text.match(PHONE) || []).map((p) => p.trim()))].slice(0, 5);

  return {
    url,
    path: u.pathname || '/',
    title: clean((head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '', 200),
    metaDescription: clean(metaContent(head, 'name', 'description') || '', 400),
    canonical: canonTag ? attr(canonTag, 'href') : null,
    noindex: /\bnoindex\b/i.test(robots),
    lang: /<html\b[^>]*\slang\s*=\s*["']?[a-z]/i.test(html),
    viewport: metaContent(head, 'name', 'viewport') !== null,
    favicon: !!iconTag,
    h1s: headings.filter((h) => h[1] === '1').map((h) => clean(h[2], 200)),
    headingLevels: contentHeadingLevels,
    contentH1s,
    truncated,
    images: { total: imgs.length, missingAlt },
    og: {
      title: !!metaContent(head, 'property', 'og:title'),
      description: !!metaContent(head, 'property', 'og:description'),
      image: !!metaContent(head, 'property', 'og:image'),
      siteName: clean(metaContent(head, 'property', 'og:site_name') || '', 120),
    },
    jsonld,
    telLinks: [...new Set(tel)].slice(0, 5),
    mailtoLinks: links.filter((l) => /^mailto:/i.test(l.href)).length,
    forms: (body.match(/<form\b/gi) || []).length,
    phonesInText: phones,
    address: street ? street[0].replace(/\s+/g, ' ').trim() : null,
    addressInFooter: STREET.test(footerText),
    mapEmbed: /<iframe\b[^>]*src\s*=\s*["']?[^"'>]*(google\.[a-z.]+\/maps|maps\.google\.|maps\.googleapis\.com|mapbox\.com|maps\.apple\.com|openstreetmap\.org)/i.test(html) ||
      /maps\.googleapis\.com\/maps\/api\/js|data-(?:block-)?type\s*=\s*["']?(?:map|4)\b|sqs-block-map/i.test(html),
    links,
    wordCount: words,
    firstParagraph: clean(firstP || '', 400),
    placeholder,
    mixedContent: mixed,
    cta: ctaEl || navCta || null,
    social: socialProfiles(html, url, jsonld.items),
  };
}
