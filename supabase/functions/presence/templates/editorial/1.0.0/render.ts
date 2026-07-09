// ── editorial 1.0.0 — pure render function (Phase PT) ────────────────────────
// A genuinely different design LANGUAGE from Business Classic: a serif, print-
// inspired editorial look — a double-ruled masthead, centered wordmark, uppercase
// letter-spaced labels, an oversized serif headline, offerings as a ruled list
// (not cards), oversized italic pull-quotes, hairline rules, and a restrained
// oxblood accent on warm paper. Same engine, same laws: reuses every shared
// helper + the same content contract, snapshot in → FileMap out, industry-correct
// vocabulary + schema.org, zero JavaScript, accessibility/SEO are properties of
// this file. Only the presentation differs; a customer would never guess it shares
// code with Business Classic. Consumes the same Design Studio dev tokens.
import { esc, attr, safeHref, renderMarkdown } from '../../../lib/markdown.ts';
import { normalizeSnapshotContent } from '../../../lib/render_types.ts';
import { vocabFor } from '../../../lib/industry_vocab.ts';
import { renderSiteBlocks, BLOCK_CSS, type RenderedBlock } from '../../../lib/site_blocks.ts';
import { privacyBody, accessibilityBody, legalFooterLinks } from '../../../lib/legal_pages.ts';
import type { FileMap, HolidayException, HoursDay, LocationContent, MediaRef, RenderFn, Snapshot, SnapshotContent, SiteConfig } from '../../../lib/render_types.ts';

const loc0 = (c: SnapshotContent): LocationContent | null => c.locations?.[0] ?? null;
const pr = (region: string): string => ` data-pr="${attr(region)}"`;
const prE = (kind: string, id: string): string => ` data-pr="${attr(kind)}" data-pr-id="${attr(id)}"`;

function orderedCats(c: SnapshotContent): string[] {
  const encounter: string[] = [];
  for (const o of bySort(c.offerings)) if (!encounter.includes(o.category)) encounter.push(o.category);
  const chosen = (c.settings?.category_order || []).filter((x) => encounter.includes(x));
  return [...chosen, ...encounter.filter((x) => !chosen.includes(x))];
}

function fnv(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 ^ ((c << 1) + 1)) >>> 0; h2 = (h2 * 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const DAY_LABEL: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const bySort = <T extends { sort_order?: number; id?: string }>(arr: T[]): T[] =>
  [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)));

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const am = h < 12 || h === 24; const hr = ((h + 11) % 12) + 1;
  return `${hr}${m ? ':' + String(m).padStart(2, '0') : ''}${am ? 'am' : 'pm'}`;
}

function img(m: MediaRef | null | undefined, sizes: string, lazy = true, cls = ''): string {
  if (!m || !m.variants) return '';
  const v = m.variants;
  const srcset = ['w400', 'w800', 'w1600'].filter((k) => v[k]).map((k) => `${attr(v[k])} ${k.slice(1)}w`).join(', ');
  const src = v.w800 || v.w400 || Object.values(v)[0];
  if (!src) return '';
  const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  return `<img src="${attr(src)}"${srcset ? ` srcset="${srcset}" sizes="${attr(sizes)}"` : ''} alt="${attr(m.alt)}"${dims}${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'}${cls ? ` class="${cls}"` : ''}>`;
}

// ═════════ CSS — a modern, confident, industry-neutral look (zero external assets) ═════════
const CSS = `:root{--ink:#1a1a1c;--soft:#5f5a52;--paper:var(--bg,#f6f3ec);--card:#fbf9f4;--accent:#6d232a;--accent-dark:#4f181d;--line:#ddd6c8;--wash:#efe9dc}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font-body,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif);background:var(--paper);color:var(--ink);line-height:1.7;font-size:1.06rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,"Iowan Old Style",Palatino,Georgia,serif);line-height:1.1;letter-spacing:-.01em;font-weight:600}
h1{font-size:clamp(2.6rem,7vw,4.6rem)}h2{font-size:clamp(1.5rem,3.4vw,2.1rem);margin-bottom:18px}h3{font-size:1.2rem}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:var(--paper);padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 26px}
.annbar{background:var(--ink);color:var(--paper);text-align:center;padding:9px 16px;font-size:.9rem;letter-spacing:.02em}
.annbar a{color:var(--paper)}
.notice{background:var(--wash);color:var(--accent-dark);text-align:center;padding:10px 16px;font-size:.92rem}
header.site{background:var(--paper);border-top:3px double var(--ink);position:sticky;top:0;z-index:20}
.nav{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 0 0;border-bottom:1px solid var(--line)}
.brand{font-family:var(--font-display,"Iowan Old Style",Palatino,Georgia,serif);font-weight:600;font-size:1.9rem;letter-spacing:.01em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:38px;width:auto;vertical-align:middle;margin-right:12px}
nav.primary{width:100%}
nav.primary ul{display:flex;gap:2px;list-style:none;flex-wrap:wrap;justify-content:center;padding:8px 0 12px}
nav.primary a{display:inline-block;padding:6px 14px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.74rem;letter-spacing:.16em;text-transform:uppercase}
nav.primary a:hover{color:var(--accent)}
nav.primary a[aria-current="page"]{color:var(--accent)}
.hero{padding:calc(84px * var(--spacing-scale,1)) 0 calc(56px * var(--spacing-scale,1));text-align:center}
.hero .kicker{color:var(--accent);font-weight:700;font-size:.76rem;letter-spacing:.22em;text-transform:uppercase}
.hero h1{margin:18px auto 16px;max-width:16ch;text-wrap:balance}
.tagline{font-size:1.35rem;font-style:italic;color:var(--soft);max-width:44ch;margin:0 auto}
.cta-row{display:flex;gap:14px;margin-top:32px;flex-wrap:wrap;justify-content:center}
.btn{display:inline-block;background:var(--ink);color:var(--paper);padding:13px 26px;border-radius:var(--radius,2px);text-decoration:none;font-weight:600;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;font-family:var(--font-body,Georgia,serif)}
.btn:hover{background:var(--accent)}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--ink)}
.btn.ghost:hover{background:var(--ink);color:var(--paper)}
.hero-img{margin:44px auto 0;max-width:920px;overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.hero-img img{width:100%;height:auto;display:block}
.hero-split{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center;text-align:left}
.hero-split h1{margin-left:0;margin-right:0}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{overflow:hidden}
.hero-split .split-img img{width:100%;height:100%;min-height:320px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr;text-align:center}.hero-split .cta-row{justify-content:center}}
.strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--soft)}
.strip .wrap{display:flex;gap:26px;flex-wrap:wrap;justify-content:center;padding:14px 26px}
.strip a{color:var(--accent);text-decoration:none}
.block{padding:calc(62px * var(--spacing-scale,1)) 0}
.block>.wrap>h1::before,.block>.wrap>h2::before,.block.wrap>h1::before,.block.wrap>h2::before{content:"";display:block;width:56px;border-top:2px solid var(--accent);margin:0 0 18px}
.block.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 40px;margin-top:8px}
.svc{border-top:1px solid var(--line);padding:20px 0}
.svc .nm{font-family:var(--font-display,Georgia,serif);font-weight:600;font-size:1.2rem}
.svc .ds{color:var(--soft);font-size:1rem;margin-top:6px}
.svc .pr{color:var(--accent);font-weight:600;margin-top:8px;font-variant-numeric:tabular-nums}
.svc img{width:100%;height:auto;margin-top:14px}
.cat-h{margin-top:38px;padding-bottom:6px;border-bottom:2px solid var(--ink);font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);font-weight:700}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:26px}
.card{background:transparent;border:none;border-top:1px solid var(--line);padding:24px 0}
blockquote.t{position:relative;padding-top:8px}
blockquote.t p{font-family:var(--font-display,Georgia,serif);font-size:1.3rem;font-style:italic;line-height:1.5}
blockquote.t footer{margin-top:14px;color:var(--soft);font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600}
dl.faq dt{font-family:var(--font-display,Georgia,serif);font-weight:600;font-size:1.15rem;margin-top:24px;padding-top:24px;border-top:1px solid var(--line)}
dl.faq dt:first-of-type{border-top:none;padding-top:0;margin-top:0}
dl.faq dd{color:var(--soft);margin-top:8px}
table.hours{border-collapse:collapse;width:100%;max-width:440px}
table.hours caption{text-align:left;font-family:var(--font-display,Georgia,serif);font-weight:600;margin-bottom:12px;font-size:1.15rem}
table.hours th{text-align:left;font-weight:400;padding:8px 14px 8px 0;color:var(--soft)}
table.hours td{padding:8px 0;font-variant-numeric:tabular-nums}
table.hours tr{border-bottom:1px solid var(--line)}
.holiday{margin-top:16px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card{border-top:2px solid var(--ink);padding-top:24px}
form.card label{font-weight:600;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--soft)}
form.card input,form.card textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius,2px);font:inherit;margin-top:6px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
form.card p{margin-bottom:16px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:26px 0;border-top:1px solid var(--line)}
.post-list article:first-of-type{border-top:none}
.post-list h2 a{color:var(--ink);text-decoration:none}
.post-list h2 a:hover{color:var(--accent)}
.post-meta{color:var(--soft);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;margin:6px 0 10px}
article.post{max-width:680px;margin:0 auto}
article.post p{margin-bottom:18px}
footer.site{background:var(--card);color:var(--ink);border-top:3px double var(--ink);padding:52px 0 34px;margin-top:72px}
footer.site a{color:var(--accent)}
footer.site h2{font-family:var(--font-display,Georgia,serif);font-size:1.3rem}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:34px}
.credit{margin-top:34px;padding-top:20px;border-top:1px solid var(--line);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);display:flex;gap:16px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (max-width:640px){.hero{padding:56px 0 40px}.block{padding:46px 0}}
${BLOCK_CSS}`;

const CRITICAL = `:root{--ink:#1a1a1c;--soft:#5f5a52;--paper:var(--bg,#f6f3ec);--accent:#6d232a;--line:#ddd6c8}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-body,"Iowan Old Style",Palatino,Georgia,serif);background:var(--paper);color:var(--ink);line-height:1.7;font-size:17px}h1{font-size:clamp(2.6rem,7vw,4.6rem);line-height:1.1;font-family:var(--font-display,Georgia,serif);font-weight:600}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:var(--paper);padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 26px}header.site{border-top:3px double var(--ink)}.nav{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 0 0;border-bottom:1px solid var(--line)}.brand{font-family:var(--font-display,Georgia,serif);font-weight:600;font-size:1.9rem;color:var(--ink);text-decoration:none}nav.primary ul{display:flex;gap:2px;list-style:none;flex-wrap:wrap;justify-content:center;padding:8px 0 12px}nav.primary a{display:inline-block;padding:6px 14px;text-decoration:none;color:#5f5a52;font-weight:600;font-size:.74rem;letter-spacing:.16em;text-transform:uppercase}.hero{padding:84px 0 56px;text-align:center}`;

// ═════════ partials ═════════

function hoursTable(c: SnapshotContent, caption: string): string {
  const loc = loc0(c)!;
  const byDay = new Map(loc.hours.map((d) => [d.day, d]));
  const rows = ORDER.map((k) => {
    const d = byDay.get(k) as HoursDay | undefined;
    const val = !d || d.closed || !d.intervals?.length ? 'Closed'
      : d.intervals.map((i) => `${fmtTime(i.open)}–${fmtTime(i.close)}`).join(', ');
    return `<tr data-day="${k}"><th scope="row">${DAY_LABEL[k]}</th><td>${esc(val)}</td></tr>`;
  }).join('');
  const holidays = (loc.holiday_exceptions || []).map((e: HolidayException) => {
    const val = e.closed ? 'Closed' : (e.intervals || []).map((i) => `${fmtTime(i.open)}–${fmtTime(i.close)}`).join(', ');
    return `<li>${esc(e.label)} (${esc(e.date)}): ${esc(val)}</li>`;
  }).join('');
  return `<table class="hours"${pr('location.hours')}><caption>${esc(caption)}</caption><tbody>${rows}</tbody></table>` +
    (holidays ? `<div class="holiday"><strong>Holiday hours</strong><ul>${holidays}</ul></div>` : '');
}

function contactBits(c: SnapshotContent): { addr: string; tel: string; mail: string } {
  const l = loc0(c); const i = c.identity;
  const addr = l ? [l.address_line1, l.address_line2, `${l.city}, ${l.region} ${l.postal_code}`].filter(Boolean).map(esc).join('<br>') : '';
  const phone = (l?.phone || i.phone || '').trim();
  const tel = phone ? `<a href="tel:${attr(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a>` : '';
  const mail = i.email ? `<a href="mailto:${attr(i.email)}">${esc(i.email)}</a>` : '';
  return { addr, tel, mail };
}

function mapsHref(c: SnapshotContent): string | null {
  const l = loc0(c); if (!l) return null;
  const q = encodeURIComponent(`${c.identity.business_name}, ${l.address_line1}, ${l.city}, ${l.region} ${l.postal_code}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ═════════ JSON-LD (industry-correct — the whole point of this template) ═════════

function ldBusiness(c: SnapshotContent, site: SiteConfig, schemaType: string, offeringPath: string, isMenu: boolean): object {
  const l = loc0(c)!;
  const spec = (l.hours || []).filter((d) => !d.closed && d.intervals?.length).flatMap((d) =>
    d.intervals.map((i) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_LABEL[d.day], opens: i.open, closes: i.close })));
  const special = (l.holiday_exceptions || []).map((e) => e.closed
    ? { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: '00:00', closes: '00:00' }
    : { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: e.intervals?.[0]?.open, closes: e.intervals?.[0]?.close });
  return {
    '@context': 'https://schema.org', '@type': schemaType,
    name: c.identity.business_name, description: c.identity.description, url: site.baseUrl,
    telephone: l.phone || c.identity.phone || undefined, email: c.identity.email || undefined,
    address: { '@type': 'PostalAddress', streetAddress: [l.address_line1, l.address_line2].filter(Boolean).join(', '), addressLocality: l.city, addressRegion: l.region, postalCode: l.postal_code, addressCountry: l.country },
    openingHoursSpecification: spec, specialOpeningHoursSpecification: special.length ? special : undefined,
    areaServed: c.identity.service_area || undefined,
    menu: isMenu ? `${site.baseUrl}${offeringPath}` : undefined,
    sameAs: Object.values(c.identity.social || {}).filter(Boolean),
  };
}

/** Offerings schema: Menu family for food; ItemList of the industry's item type otherwise. */
function ldOfferings(c: SnapshotContent, site: SiteConfig, v: { isMenu: boolean; offeringPath: string; offeringLabel: string; offeringItemSchema: string }): object {
  if (v.isMenu) {
    return {
      '@context': 'https://schema.org', '@type': 'Menu', name: `${c.identity.business_name} Menu`, url: `${site.baseUrl}${v.offeringPath}`,
      hasMenuSection: orderedCats(c).map((cat) => ({
        '@type': 'MenuSection', name: cat,
        hasMenuItem: bySort(c.offerings).filter((o) => o.category === cat).map((o) => ({ '@type': 'MenuItem', name: o.name, description: o.description || undefined, offers: o.price_text ? { '@type': 'Offer', price: o.price_text, priceCurrency: 'USD' } : undefined })),
      })),
    };
  }
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name: `${c.identity.business_name} ${v.offeringLabel}`, url: `${site.baseUrl}${v.offeringPath}`,
    itemListElement: bySort(c.offerings).map((o, idx) => ({
      '@type': 'ListItem', position: idx + 1,
      item: { '@type': v.offeringItemSchema, name: o.name, description: o.description || undefined, offers: o.price_text ? { '@type': 'Offer', price: o.price_text, priceCurrency: 'USD' } : undefined },
    })),
  };
}
const ldFaq = (c: SnapshotContent) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: bySort(c.faqs).map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
});
const ldCrumbs = (site: SiteConfig, trail: Array<[string, string]>) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site.baseUrl}${path}` })),
});
const ldSite = (c: SnapshotContent, site: SiteConfig) => ({ '@context': 'https://schema.org', '@type': 'WebSite', name: c.identity.business_name, url: site.baseUrl });

// ═════════ shell ═════════

interface PageOpts { path: string; title: string; description: string; ld: object[]; ogImage?: string; active: string; body: string }
interface Extras { announce: string; icon: string; nav: Array<[string, string, string]> }

function shell(c: SnapshotContent, site: SiteConfig, cssPath: string, o: PageOpts, x: Extras): string {
  const i = c.identity;
  const logo = c.settings?.logo || null;
  const { addr, tel, mail } = contactBits(c);
  const social = Object.entries(i.social || {}).map(([k, v]) => {
    const href = safeHref(v); if (!href) return '';
    const label = k === 'x' ? 'X' : k === 'google_maps' ? 'Google Maps' : k[0].toUpperCase() + k.slice(1);
    return `<a href="${attr(href)}" rel="noopener">${esc(label)}</a>`;
  }).filter(Boolean).join(' · ');
  const canonical = `${site.baseUrl}${o.path}`;
  const closedNotice = loc0(c)?.temporarily_closed
    ? `<div class="notice" role="status">${esc(loc0(c)!.temporarily_closed_note || 'We are temporarily closed. See you soon.')}</div>` : '';
  const credit = site.brand?.credit ? `<span>${esc(site.brand.credit)}</span>` : '';

  return `<!DOCTYPE html>
<html lang="${attr(site.locale || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${attr(o.description)}">
<link rel="canonical" href="${attr(canonical)}">
${c.settings?.verification?.google ? `<meta name="google-site-verification" content="${attr(c.settings.verification.google)}">` : ''}${c.settings?.verification?.bing ? `\n<meta name="msvalidate.01" content="${attr(c.settings.verification.bing)}">` : ''}
<link rel="icon" href="${attr(x.icon || '/favicon.svg')}"${x.icon ? '' : ' type="image/svg+xml"'}>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(i.business_name)}">
<meta property="og:title" content="${attr(o.title)}">
<meta property="og:description" content="${attr(o.description)}">
<meta property="og:url" content="${attr(canonical)}">
${o.ogImage ? `<meta property="og:image" content="${attr(site.baseUrl + o.ogImage)}">` : ''}
<meta name="twitter:card" content="${o.ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${attr(o.title)}">
<meta name="twitter:description" content="${attr(o.description)}">
<style>${CRITICAL}</style>
<link rel="stylesheet" href="${attr(cssPath)}">
${o.ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replaceAll('<', '\\u003c')}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
${x.announce}
${closedNotice}
<header class="site"><div class="wrap nav${c.settings?.nav_style === 'centered' ? ' centered' : ''}">
  <a class="brand" href="/">${logo?.variants?.w400 ? `<img src="${attr(logo.variants.w400)}" alt="" class="brandlogo">` : ''}${esc(i.business_name)}</a>
  <nav class="primary" aria-label="Main"><ul>${x.nav.map(([p, label, key]) =>
    `<li><a href="${attr(p)}"${o.active === key ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`).join('')}</ul></nav>
</div></header>
<main id="main">
${o.body}
</main>
<footer class="site"><div class="wrap">
  <div class="cols">
    <div><h2>${esc(i.business_name)}</h2>${addr ? `<address>${addr}</address>` : ''}<p>${[tel, mail].filter(Boolean).join('<br>')}</p>${(c.settings?.footer?.social !== false) && social ? `<p>${social}</p>` : ''}</div>
    <div>${(c.settings?.footer?.hours !== false) && loc0(c) ? hoursTable(c, 'Hours') : ''}</div>
  </div>
  <div class="credit"><span>© ${esc(i.business_name)}</span><span>${legalFooterLinks()}</span>${credit}</div>
</div></footer>
</body>
</html>`;
}

// ═════════ page bodies ═════════

// Phase CP-2 (DS-2): home sections — owner-chosen order + visibility, structured.
const HOME_SECTIONS = ['about', 'offerings', 'testimonials', 'faqs'];
function homeSectionOrder(c: SnapshotContent, blockKeys: string[] = []): string[] {
  const all = [...HOME_SECTIONS, ...blockKeys];
  const hidden = new Set(c.settings?.sections?.hidden || []);
  const chosen = (c.settings?.sections?.order || []).filter((k) => all.includes(k));
  const rest = all.filter((k) => !chosen.includes(k));
  return [...chosen, ...rest].filter((k) => !hidden.has(k));
}

function homeBody(c: SnapshotContent, site: SiteConfig, v: ReturnType<typeof vocabFor>, blocks: RenderedBlock[] = []): string {
  const i = c.identity;
  const hero = bySort(c.offerings).find((o) => o.media)?.media || c.posts.find((p) => p.hero)?.hero || c.settings?.logo || null;
  const featured = bySort(c.offerings).slice(0, 6);
  const tst = bySort(c.testimonials).slice(0, 3);
  const faqs = bySort(c.faqs).slice(0, 4);
  const { tel } = contactBits(c);
  const maps = mapsHref(c);
  const book = safeHref(i.booking_url || '');
  const order = safeHref(i.ordering_url || '');
  const heroText = `
  ${i.service_area ? `<p class="kicker"${pr('identity.service_area')}>${esc(i.service_area)}</p>` : ''}
  <h1${pr('identity.business_name')}>${esc(i.business_name)}</h1>
  ${i.tagline ? `<p class="tagline"${pr('identity.tagline')}>${esc(i.tagline)}</p>` : ''}
  <div class="cta-row">
    ${book ? `<a class="btn" href="${attr(book)}" rel="noopener">${esc(v.primaryAction)}</a>` : ''}
    ${order ? `<a class="btn${book ? ' ghost' : ''}" href="${attr(order)}" rel="noopener">Order online</a>` : ''}
    ${!book && !order ? `<a class="btn" href="${attr(v.offeringPath)}">See our ${esc(v.offeringLabel.toLowerCase())}</a>` : ''}
    ${(book || order) ? `<a class="btn ghost" href="/contact/">Contact us</a>` : ''}
  </div>`;
  const heroImgOk = hero && hero !== c.settings?.logo;
  // DS-6 split layout — the first CROPPING presentation, so the focal point (DS-5) drives it
  const useSplit = c.settings?.hero_layout === 'split' && heroImgOk;
  const focalStyle = hero?.focal ? ` style="object-position:${hero.focal.x}% ${hero.focal.y}%"` : '';
  const splitImg = useSplit && hero?.variants
    ? `<div class="split-img"><img src="${attr(hero.variants.w800 || hero.variants.w400 || '')}"${hero.variants.w400 && hero.variants.w1600 ? ` srcset="${attr(hero.variants.w400)} 400w, ${attr(hero.variants.w800 || hero.variants.w1600)} 800w, ${attr(hero.variants.w1600)} 1600w" sizes="(max-width:760px) 100vw, 45vw"` : ''} alt="${attr(hero.alt)}" fetchpriority="high"${focalStyle}></div>`
    : '';
  return `
<section class="hero wrap">${useSplit ? `<div class="hero-split"><div>${heroText}</div>${splitImg}</div>` : `${heroText}
  ${heroImgOk ? `<div class="hero-img">${img(hero, '(max-width: 1000px) 100vw, 960px', false)}</div>` : ''}`}
</section>
<div class="strip"><div class="wrap">
  ${loc0(c) ? `<span${pr('location.address')}>${esc(loc0(c)!.address_line1)}, ${esc(loc0(c)!.city)}</span>` : ''}
  ${tel ? `<span>${tel}</span>` : ''}
  ${maps ? `<span><a href="${attr(maps)}" rel="noopener">Get directions</a></span>` : ''}
</div></div>
${(() => {
  const parts: Record<string, string> = {
    about: `<section class="block wrap"><h2>About us</h2><p${pr('identity.description')}>${esc(i.description)}</p></section>`,
    offerings: featured.length ? `<section class="block alt"><div class="wrap"><h2>${esc(v.offeringLabel)}</h2><div class="svc-grid">${featured.map((o) => `
  <div class="svc"${prE('offering', o.id)}><div class="nm">${esc(o.name)}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${o.price_text ? `<div class="pr">${esc(o.price_text)}</div>` : ''}</div>`).join('')}
</div><p style="margin-top:22px"><a class="btn ghost" href="${attr(v.offeringPath)}">All ${esc(v.offeringLabel.toLowerCase())}</a></p></div></section>` : '',
    testimonials: tst.length ? `<section class="block wrap"><h2>What customers say</h2><div class="cards">${tst.map((t) => `
  <div class="card"${prE('testimonial', t.id)}><blockquote class="t"><p>“${esc(t.quote)}”</p><footer>— ${esc(t.author)}${t.source ? `, ${esc(t.source)}` : ''}</footer></blockquote></div>`).join('')}
</div></section>` : '',
    faqs: faqs.length ? `<section class="block alt"><div class="wrap"><h2>Good to know</h2><dl class="faq">${faqs.map((f) =>
  `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd>${esc(f.answer).replaceAll('\n', '<br>')}</dd>`).join('')}
</dl><p style="margin-top:18px"><a href="/faq/">All questions →</a></p></div></section>` : '',
  };
  for (const b of blocks) parts[b.key] = b.html;   // Phase T-BLOCKS
  return homeSectionOrder(c, blocks.map((b) => b.key)).map((k) => parts[k] || '').join('');
})()}`;
}

function offeringsBody(c: SnapshotContent, v: ReturnType<typeof vocabFor>): string {
  const cats = orderedCats(c);
  return `<section class="block wrap"><h1>${esc(v.offeringLabel)}</h1>
${cats.map((cat) => `<div><h3 class="cat-h">${esc(cat)}</h3><div class="svc-grid">${bySort(c.offerings).filter((o) => o.category === cat).map((o) => `
  <div class="svc"${prE('offering', o.id)}><div class="nm">${esc(o.name)}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${o.media ? img(o.media, '(max-width:640px) 100vw, 320px') : ''}${o.price_text ? `<div class="pr">${esc(o.price_text)}</div>` : ''}</div>`).join('')}
</div></div>`).join('')}
${cats.length === 0 ? `<p>Our ${esc(v.offeringLabel.toLowerCase())} are being updated — check back soon.</p>` : ''}</section>`;
}

function aboutBody(c: SnapshotContent): string {
  const i = c.identity;
  return `<section class="block wrap"><h1>About ${esc(i.business_name)}</h1>
<p>${esc(i.description)}</p>
${i.story ? i.story.split(/\n{2,}/).map((p) => `<p>${esc(p).replaceAll('\n', '<br>')}</p>`).join('') : ''}
${i.service_area ? `<h2>Where we work</h2><p>${esc(i.service_area)}</p>` : ''}</section>`;
}

function faqBody(c: SnapshotContent): string {
  return `<section class="block wrap"><h1>Frequently asked questions</h1><dl class="faq">${bySort(c.faqs).map((f) =>
    `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd>${esc(f.answer).replaceAll('\n', '<br>')}</dd>`).join('')}</dl>
${c.faqs.length === 0 ? '<p>Questions? Get in touch — we answer fast.</p>' : ''}</section>`;
}

function contactBody(c: SnapshotContent, site: SiteConfig): string {
  const { addr, tel, mail } = contactBits(c);
  const maps = mapsHref(c);
  const i = c.identity;
  const form = site.formEndpoint
    ? `<form method="post" action="${attr(site.formEndpoint)}" class="card" style="margin-top:24px">
<h2>Send us a message</h2>
<input type="hidden" name="form_kind" value="contact">
<input type="hidden" name="source_page" value="/contact/">
<p class="hp" aria-hidden="true"><label for="f-hp">Leave this field empty</label><input id="f-hp" name="_hp" tabindex="-1" autocomplete="off"></p>
<p><label for="f-name">Your name</label><input id="f-name" name="name" required maxlength="120"></p>
<p><label for="f-email">Email or phone</label><input id="f-email" name="contact" required maxlength="254"></p>
<p><label for="f-msg">Message</label><textarea id="f-msg" name="message" required maxlength="2000" rows="5"></textarea></p>
<p style="font-size:.85rem;color:var(--soft)">Please don’t include sensitive personal, financial, or medical information.</p>
<button class="btn" type="submit">Send</button></form>`
    : (mail ? `<p style="margin-top:18px"><a class="btn" href="mailto:${attr(i.email)}">Email us</a></p>` : '');
  return `<section class="block wrap"><h1>Contact &amp; hours</h1>
<div class="cards" style="margin-top:8px">
  <div class="card"><h2>Reach us</h2>${addr ? `<address>${addr}</address>` : ''}<p>${[tel, mail].filter(Boolean).join('<br>')}</p>${maps ? `<p><a href="${attr(maps)}" rel="noopener">Get directions</a></p>` : ''}</div>
  <div class="card">${loc0(c) ? hoursTable(c, 'Hours') : ''}</div>
</div>${form}</section>`;
}

function postDate(iso: string): string {
  const d = new Date(iso);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function postIndexBody(c: SnapshotContent): string {
  const posts = [...c.posts].sort((a, b) => b.published_at.localeCompare(a.published_at));
  return `<section class="block wrap"><h1>Updates</h1><div class="post-list">${posts.map((p) => `
<article${prE('post', p.id)}><h2><a href="/updates/${attr(p.slug)}/">${esc(p.title)}</a></h2>
<p class="post-meta"><time datetime="${attr(p.published_at)}">${esc(postDate(p.published_at))}</time></p>
${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}</article>`).join('')}
${posts.length === 0 ? '<p>No updates yet — our news will land here.</p>' : ''}</div></section>`;
}

function postBody(c: SnapshotContent, p: SnapshotContent['posts'][number]): string {
  return `<section class="block wrap"><article class="post">
<h1>${esc(p.title)}</h1>
<p class="post-meta"><time datetime="${attr(p.published_at)}">${esc(postDate(p.published_at))}</time></p>
${p.hero ? `<div style="margin:20px 0;border-radius:14px;overflow:hidden">${img(p.hero, '(max-width: 900px) 100vw, 860px', false)}</div>` : ''}
${renderMarkdown(p.body_md)}
</article>
<p style="margin-top:28px"><a href="/updates/">← All updates</a></p></section>`;
}

// ═════════ the render function (the contract) ═════════

export const render: RenderFn = (snapshot: Snapshot, _manifest, site: SiteConfig): FileMap => {
  const c = normalizeSnapshotContent(snapshot.content);
  const i = c.identity;
  const v = vocabFor(c.settings?.industry);   // THE industry realization
  const files: FileMap = {};

  const cssPath = `/assets/site-${fnv(CSS)}.css`;
  files[`assets/site-${fnv(CSS)}.css`] = CSS;

  const siteTitle = i.seo_title || i.business_name;
  const siteDesc = i.seo_description || i.description;
  const ogImg = c.settings?.og_image?.variants?.w1600
    || (bySort(c.offerings).find((o) => o.media)?.media?.variants?.w1600)
    || (c.posts.find((p) => p.hero)?.hero?.variants?.w1600)
    || c.settings?.logo?.variants?.w1600;

  const ann = c.settings?.announcement;
  const annLive = ann && ann.text && (!ann.expires_at || String(ann.expires_at) > snapshot.created_at);
  const announce = annLive
    ? `<div class="annbar" role="status">${ann!.url ? `<a href="${attr(ann!.url)}">${esc(ann!.text)}</a>` : esc(ann!.text)}</div>` : '';
  const icon = c.settings?.logo?.variants?.w400 || '';
  const nav: Array<[string, string, string]> = [
    ['/', 'Home', 'home'], [v.offeringPath, v.offeringLabel, 'offerings'], ['/about/', 'About', 'about'],
    ['/faq/', 'FAQ', 'faq'], ['/updates/', 'Updates', 'updates'], ['/contact/', 'Contact', 'contact'],
  ];
  const extras: Extras = { announce, icon, nav };

  // Phase SD: "Show this page on Google?" — noindex + sitemap exclusion per page,
  // and per-page search headline/description overrides. Plain choices, our plumbing.
  const noidx = new Set(c.settings?.pages_noindex || []);
  const pseo = c.settings?.page_seo || {};
  const seoOv = (key: string, title: string, description: string) => ({
    title: (pseo[key]?.title || '').trim() || title,
    description: (pseo[key]?.description || '').trim() || description,
  });
  const markNoindex = (file: string) => { files[file] = (files[file] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">'); };


  const page = (path: string, opts: Omit<PageOpts, 'path'>) => {
    const html = shell(c, site, cssPath, { path, ...opts }, extras);
    const file = path === '/' ? 'index.html' : `${path.replace(/^\/|\/$/g, '')}/index.html`;
    files[file] = html;
  };

  const blocks = renderSiteBlocks(c.settings?.blocks, { esc, attr, safeHref });   // Phase T-BLOCKS
  const ldBiz = ldBusiness(c, site, v.schemaType, v.offeringPath, v.isMenu);
  page('/', { title: siteTitle, description: siteDesc, ld: [ldBiz, ldSite(c, site), ...blocks.flatMap((b) => (b.ld ? [b.ld] : []))], ogImage: ogImg, active: 'home', body: homeBody(c, site, v, blocks) });
  page(v.offeringPath, { ...seoOv('offerings', `${v.offeringLabel} — ${i.business_name}`, `${v.offeringLabel} from ${i.business_name}.`), ld: [ldOfferings(c, site, v)], ogImage: ogImg, active: 'offerings', body: offeringsBody(c, v) });
  if (noidx.has('offerings')) markNoindex(`${v.offeringPath.replace(/^\/|\/$/g, '')}/index.html`);
  page('/about/', { ...seoOv('about', `About — ${i.business_name}`, siteDesc), ld: [ldCrumbs(site, [[i.business_name, '/'], ['About', '/about/']])], active: 'about', body: aboutBody(c) });
  if (noidx.has('about')) markNoindex('about/index.html');
  page('/faq/', { ...seoOv('faq', `FAQ — ${i.business_name}`, `Answers to common questions about ${i.business_name}.`), ld: c.faqs.length ? [ldFaq(c)] : [], active: 'faq', body: faqBody(c) });
  if (noidx.has('faq')) markNoindex('faq/index.html');
  page('/contact/', { ...seoOv('contact', `Contact & Hours — ${i.business_name}`, `Address, phone, and hours for ${i.business_name}.`), ld: [ldBiz], active: 'contact', body: contactBody(c, site) });
  if (noidx.has('contact')) markNoindex('contact/index.html');
  page('/thanks/', { title: `Thank you — ${i.business_name}`, description: `Your message to ${i.business_name} was sent.`, ld: [], active: 'contact', body: `<section class="hero wrap"><h1>Thank you — your message was sent.</h1><p class="tagline">${esc(i.business_name)} will get back to you soon.</p><div class="cta-row"><a class="btn" href="/">Back to the site</a></div></section>` });
  files['thanks/index.html'] = (files['thanks/index.html'] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">');
  // Phase Q (FD-M3): the generated legal foundation — facts-true, the owner never writes legal HTML
  page('/privacy/', { title: `Privacy — ${i.business_name}`, description: `How ${i.business_name} handles your information.`, ld: [], active: '', body: privacyBody(c, snapshot.created_at.slice(0, 10), !!site.formEndpoint) });
  page('/accessibility/', { title: `Accessibility — ${i.business_name}`, description: `${i.business_name}’s accessibility commitment.`, ld: [], active: '', body: accessibilityBody(c) });
  page('/updates/', { ...seoOv('updates', `Updates — ${i.business_name}`, `News and updates from ${i.business_name}.`), ld: [], active: 'updates', body: postIndexBody(c) });
  if (noidx.has('updates')) markNoindex('updates/index.html');
  for (const p of c.posts) {
    page(`/updates/${p.slug}/`, {
      title: `${p.title} — ${i.business_name}`, description: p.excerpt || siteDesc,
      ld: [ldCrumbs(site, [[i.business_name, '/'], ['Updates', '/updates/'], [p.title, `/updates/${p.slug}/`]])],
      ogImage: p.hero?.variants?.w1600, active: 'updates', body: postBody(c, p),
    });
    if (p.noindex) markNoindex(`updates/${p.slug}/index.html`);
  }

  files['404.html'] = shell(c, site, cssPath, {
    path: '/404.html', title: `Page not found — ${i.business_name}`, description: siteDesc, ld: [], active: '',
    body: `<section class="hero wrap"><h1>That page isn’t here</h1><p class="tagline">The page you’re after may have moved.</p><div class="cta-row"><a class="btn" href="/">Back to ${esc(i.business_name)}</a><a class="btn ghost" href="${attr(v.offeringPath)}">See our ${esc(v.offeringLabel.toLowerCase())}</a></div></section>`,
  }, extras);

  const letter = (i.business_name || 'B').trim()[0]?.toUpperCase() || 'B';
  files['favicon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#6d232a"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="600" fill="#f6f3ec" text-anchor="middle">${esc(letter)}</text></svg>`;

  const lastmod = snapshot.created_at.slice(0, 10);
  const KEY_PATHS: Array<[string, string]> = [['offerings', v.offeringPath], ['about', '/about/'], ['faq', '/faq/'], ['contact', '/contact/'], ['updates', '/updates/']];
  const urls = ['/', ...KEY_PATHS.filter(([k]) => !noidx.has(k)).map(([, p]) => p), '/privacy/', '/accessibility/', ...c.posts.filter((p) => !p.noindex).map((p) => `/updates/${p.slug}/`)];
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(site.baseUrl + u)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  files['robots.txt'] = `User-agent: *\nAllow: /\nDisallow: /thanks/\n\nSitemap: ${site.baseUrl}/sitemap.xml\n`;

  for (const r of c.redirects) files[`${r.from_path.replace(/^\/|\/$/g, '')}/index.html`] = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attr(r.to_path)}"><link rel="canonical" href="${attr(site.baseUrl + r.to_path)}"><title>Moved</title></head><body><p>Moved to <a href="${attr(r.to_path)}">${esc(r.to_path)}</a>.</p></body></html>`;

  return files;
};
