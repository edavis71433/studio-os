// ── harbor 1.0.0 — pure render function ──────────────────────────────────────
// "Harbor": a structured, trustworthy design language for finance, legal,
// insurance, and home services. White ground anchored by deep navy (#1b2a4a)
// with a steel-blue secondary (#4a6fa5); strong left-aligned hierarchy; every
// section opens on a 40px/3px navy accent bar; boxed cards with 10px radii,
// 1px steel borders and a crisp 2px navy bottom rule; a split hero — text left,
// stat/checklist panel on a pale steel wash right; nav links underline on a
// 2px navy rule; tabular numerals on prices/stats; a dark-navy trust strip
// carrying the contact details. Same engine, same laws as every template:
// snapshot in → FileMap out; no network, no clock (snapshot timestamps only),
// no randomness, zero JavaScript beyond the shared first-party search/tag
// scripts. Accessibility/SEO/performance are properties of this file, never
// author responsibilities.
import { esc, attr, safeHref, renderMarkdown } from '../../../lib/markdown.ts';
import { normalizeSnapshotContent } from '../../../lib/render_types.ts';
import { vocabFor } from '../../../lib/industry_vocab.ts';
import { renderSiteBlocks, reviewsSchema, BLOCK_CSS, type RenderedBlock } from '../../../lib/site_blocks.ts';
import { renderNavList, NAV_DROPDOWN_CSS } from '../../../lib/site_nav.ts';
import { seoHead } from '../../../lib/seo_emit.ts';
import { privacyBody, accessibilityBody, legalFooterLinks } from '../../../lib/legal_pages.ts';
import { SEARCH_CSS, searchBoxHtml, searchPageBody, searchClientScript, searchIndexJson, normalizeTags, postTagsAttr, postTagsHtml, tagFilterBar, tagFilterScript } from '../../../lib/search_index.ts';
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

// AVIF variants sit beside WebP at the same widths (self-hosted; the path differs
// only by extension — see serializer.variantPath), so derive the AVIF srcset here.
const avifOf = (webpPath: string): string => webpPath.replace(/\.webp$/, '.avif');
function img(m: MediaRef | null | undefined, sizes: string, lazy = true, cls = ''): string {
  if (!m || !m.variants) return '';
  const v = m.variants;
  const order = ['w400', 'w800', 'w1600'].filter((k) => v[k]);
  const srcset = order.map((k) => `${attr(v[k])} ${k.slice(1)}w`).join(', ');
  const src = v.w800 || v.w400 || Object.values(v)[0];
  if (!src) return '';
  const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  const imgTag = `<img src="${attr(src)}"${srcset ? ` srcset="${srcset}" sizes="${attr(sizes)}"` : ''} alt="${attr(m.alt)}"${dims}${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'}${cls ? ` class="${cls}"` : ''}>`;
  if (!srcset) return imgTag;   // single variant: nothing to choose between formats
  // <picture>: AVIF first (browser picks the first it supports), WebP next, the
  // <img> is the ultimate fallback. Self-hosted variants only — zero external origins.
  const avifSrcset = order.map((k) => `${attr(avifOf(v[k]))} ${k.slice(1)}w`).join(', ');
  const sz = ` sizes="${attr(sizes)}"`;
  return `<picture><source type="image/avif" srcset="${avifSrcset}"${sz}><source type="image/webp" srcset="${srcset}"${sz}>${imgTag}</picture>`;
}

// ═════════ CSS — structured, trustworthy: navy anchor on a white ground (zero external assets) ═════════
// G1 radius token: surfaces (btn, hero panel, hero/split images, svc/card, svc img, inputs, post hero) take var(--radius,<current>); the tiny brandlogo chip stays hardcoded — structural.
const CSS = `:root{--ink:#1c2434;--soft:#4a556a;--paper:var(--bg,#ffffff);--card:#ffffff;--accent:#1b2a4a;--accent-dark:#12203a;--steel:#4a6fa5;--steel-dark:#3a5a8a;--line:#c9d5e6;--wash:#eef2f8}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.65;font-size:1.02rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,inherit);line-height:1.14;letter-spacing:-.015em;font-weight:700;color:var(--accent)}
h1{font-size:clamp(2.1rem,5vw,3.15rem);font-weight:800}h2{font-size:clamp(1.45rem,3vw,1.9rem);margin-bottom:16px}h3{font-size:1.08rem}
.block>.wrap>h1::before,.block>.wrap>h2::before,.block.wrap>h1::before,.block.wrap>h2::before{content:"";display:block;width:40px;border-top:3px solid var(--accent);margin:0 0 14px}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--accent);color:#fff;padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.annbar{background:var(--steel-dark);color:#fff;text-align:center;padding:10px 16px;font-size:.94rem;font-weight:600}
.annbar a{color:#fff;text-decoration:underline}
.notice{background:#fdf3e4;color:#6b4c12;text-align:center;padding:10px 16px;font-size:.95rem}
header.site{background:var(--paper);border-top:4px solid var(--accent);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;flex-wrap:wrap}
.brand{font-weight:800;font-size:1.18rem;letter-spacing:-.02em;color:var(--accent);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:6px}
nav.primary ul{display:flex;gap:18px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:9px 2px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.93rem;border-bottom:2px solid transparent}
nav.primary a:hover{color:var(--accent);border-bottom-color:var(--accent)}
nav.primary a[aria-current="page"]{color:var(--accent);border-bottom-color:var(--accent)}
.hero{padding:calc(72px * var(--spacing-scale,1)) 0 calc(60px * var(--spacing-scale,1))}
.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:44px;align-items:center}
.hero-grid.solo{grid-template-columns:1fr}
.hero .kicker{display:inline-block;color:var(--steel-dark);font-weight:700;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;border-left:3px solid var(--accent);padding-left:10px}
.hero h1{margin:14px 0 12px;max-width:20ch;text-wrap:balance}
.tagline{font-size:1.22rem;color:var(--soft);max-width:54ch;line-height:1.55}
.cta-row{display:flex;gap:12px;margin-top:28px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:12px 26px;border:2px solid var(--accent);border-radius:var(--radius,8px);text-decoration:none;font-weight:700;font-size:.98rem;transition:background .12s,border-color .12s}
.btn:hover{background:var(--accent-dark);border-color:var(--accent-dark)}
.btn.ghost{background:transparent;color:var(--steel-dark);border-color:var(--steel)}
.btn.ghost:hover{background:var(--wash);color:var(--accent);border-color:var(--steel-dark)}
.hero-panel{background:var(--wash);border:1px solid var(--line);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:26px 28px}
.hp-title{font-size:.76rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--steel-dark);margin-bottom:10px}
.checklist{list-style:none}
.checklist li{position:relative;padding:9px 0 9px 26px;border-bottom:1px solid var(--line);font-weight:600;font-size:.97rem}
.checklist li:last-child{border-bottom:0}
.checklist li::before{content:"✓";position:absolute;left:2px;top:8px;color:var(--accent);font-weight:800}
.hp-stats{display:flex;gap:26px;flex-wrap:wrap;margin-top:16px}
.hp-stats .num{display:block;font-size:1.55rem;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;line-height:1.2}
.hp-stats .lb{display:block;font-size:.78rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--soft)}
.hp-contact{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-weight:600;font-variant-numeric:tabular-nums}
.hp-contact a{color:var(--steel-dark)}
.split-img{border-radius:var(--radius,10px);overflow:hidden;border:1px solid var(--line);border-bottom:2px solid var(--accent)}
.split-img img{width:100%;height:100%;min-height:300px;object-fit:cover;display:block}
.hero-img{margin-top:40px;border-radius:var(--radius,10px);overflow:hidden;border:1px solid var(--line);border-bottom:2px solid var(--accent)}
.hero-img img{width:100%;height:auto;display:block}
.strip{background:var(--accent);color:#d9e1f0;font-size:.92rem;font-variant-numeric:tabular-nums}
.strip .wrap{display:flex;gap:24px;flex-wrap:wrap;padding:12px 24px}
.strip a{color:#b9cdea}
.block{padding:calc(60px * var(--spacing-scale,1)) 0}
.block.alt{background:var(--wash)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin-top:8px}
.svc{background:var(--card);border:1px solid var(--steel);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:22px;transition:transform .12s,box-shadow .12s}
.svc:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(27,42,74,.12)}
.svc .nm{font-weight:700;font-size:1.06rem;color:var(--accent)}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:6px}
.svc .pr{color:var(--steel-dark);font-weight:800;margin-top:10px;font-variant-numeric:tabular-nums}
.svc img{width:100%;height:auto;border-radius:var(--radius,6px);margin-top:12px}
.cat-h{margin-top:38px;border-left:3px solid var(--accent);padding-left:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--steel);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:24px}
blockquote.t p{font-size:1.02rem}
blockquote.t footer{margin-top:12px;color:var(--soft);font-size:.92rem;font-weight:700}
dl.faq dt{font-weight:700;margin-top:22px;color:var(--accent)}
dl.faq dd{color:var(--soft);margin-top:6px}
table.hours{border-collapse:collapse;width:100%;max-width:420px;font-variant-numeric:tabular-nums}
table.hours caption{text-align:left;font-weight:700;margin-bottom:10px;font-size:1.02rem}
table.hours th{text-align:left;font-weight:600;padding:7px 14px 7px 0;color:var(--soft)}
table.hours td{padding:7px 0}
.holiday{margin-top:14px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card label{font-weight:700;font-size:.94rem}
form.card input,form.card textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius,8px);font:inherit;margin-top:5px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--steel-dark);outline-offset:1px}
form.card p{margin-bottom:14px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:24px 0;border-bottom:1px solid var(--line)}
.post-meta{color:var(--soft);font-size:.9rem;margin:4px 0 8px;font-variant-numeric:tabular-nums}
article.post{max-width:720px}
article.post p{margin-bottom:16px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.3em 0 .4em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--steel-dark);text-decoration:underline}
footer.site{background:var(--accent);color:#d9e1f0;padding:50px 0 32px;margin-top:72px;border-top:3px solid var(--steel)}
footer.site a{color:#b9cdea}
footer.site h2{font-size:1.08rem;color:#fff}
footer.site table.hours th{color:#b6c4dc}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:30px}
.credit{margin-top:30px;padding-top:18px;border-top:1px solid rgba(255,255,255,.16);font-size:.88rem;color:#a7b6d1;display:flex;gap:14px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--steel-dark);outline-offset:2px}
footer.site :focus-visible,.strip :focus-visible,.annbar :focus-visible{outline-color:#b9cdea}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn,.svc{transition:none}.svc:hover{transform:none}}
@media (max-width:860px){.hero-grid{grid-template-columns:1fr;gap:28px}}
@media (max-width:640px){.hero{padding:52px 0 40px}.block{padding:44px 0}}
@media print{.annbar,.sitesearch,.skip,.cta-row{display:none}header.site{position:static;border-top-color:#000}.strip,footer.site{background:#fff;color:#000;border:0}.strip a,footer.site a{color:#000}footer.site h2{color:#000}footer.site table.hours th{color:#333}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#1c2434;--soft:#4a556a;--paper:var(--bg,#ffffff);--accent:#1b2a4a;--steel:#4a6fa5;--line:#c9d5e6;--wash:#eef2f8}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65;font-size:16.3px}h1{font-size:clamp(2.1rem,5vw,3.15rem);line-height:1.14;letter-spacing:-.015em;font-weight:800;color:var(--accent)}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--accent);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}header.site{border-top:4px solid var(--accent);border-bottom:1px solid var(--line)}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;flex-wrap:wrap}nav.primary ul{display:flex;gap:18px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:9px 2px;text-decoration:none;color:#4a556a;font-weight:600;border-bottom:2px solid transparent}.hero{padding:72px 0 60px}.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:44px;align-items:center}.hero-panel{background:var(--wash);border:1px solid var(--line);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:26px 28px}@media (max-width:860px){.hero-grid{grid-template-columns:1fr;gap:28px}}`;

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

// ═════════ JSON-LD (industry-correct via lib/industry_vocab) ═════════

function ldBusiness(c: SnapshotContent, site: SiteConfig, schemaType: string, offeringPath: string, isMenu: boolean): object {
  const l = loc0(c);   // may be null on a brand-new/empty draft — must not crash the render
  const spec = (l?.hours || []).filter((d) => !d.closed && d.intervals?.length).flatMap((d) =>
    d.intervals.map((i) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_LABEL[d.day], opens: i.open, closes: i.close })));
  const special = (l?.holiday_exceptions || []).map((e) => e.closed
    ? { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: '00:00', closes: '00:00' }
    : { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: e.intervals?.[0]?.open, closes: e.intervals?.[0]?.close });
  return {
    '@context': 'https://schema.org', '@type': schemaType,
    name: c.identity.business_name, description: c.identity.description, url: site.baseUrl,
    telephone: l?.phone || c.identity.phone || undefined, email: c.identity.email || undefined,
    address: l ? { '@type': 'PostalAddress', streetAddress: [l.address_line1, l.address_line2].filter(Boolean).join(', '), addressLocality: l.city, addressRegion: l.region, postalCode: l.postal_code, addressCountry: l.country } : undefined,
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

interface PageOpts { path: string; title: string; description: string; ld: object[]; ogImage?: string; shareTitle?: string; shareDescription?: string; shareImage?: string; active: string; body: string }
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
  const closedNotice = loc0(c)?.temporarily_closed
    ? `<div class="notice" role="status">${esc(loc0(c)!.temporarily_closed_note || 'We are temporarily closed. See you soon.')}</div>` : '';
  const credit = site.brand?.credit ? `<span>${esc(site.brand.credit)}</span>` : '';

  return `${seoHead(o, site, c, x, CRITICAL, cssPath)}
<body>
<a class="skip" href="#main">Skip to main content</a>
${x.announce}
${closedNotice}
<header class="site"><div class="wrap nav${c.settings?.nav_style === 'centered' ? ' centered' : ''}">
  <a class="brand" href="/">${logo?.variants?.w400 ? `<img src="${attr(logo.variants.w400)}" alt="" class="brandlogo">` : ''}${esc(i.business_name)}</a>
  <nav class="primary" aria-label="Main"><ul>${
    c.settings?.nav?.length
      ? renderNavList(c.settings.nav, o.path, esc, attr)
      : x.nav.map(([p, label, key]) => `<li><a href="${attr(p)}"${o.active === key ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`).join('')
  }</ul></nav>
  ${searchBoxHtml()}
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

// Home sections — owner-chosen order + visibility, structured; enabled structured
// blocks (block_<type>) join the same order/visibility machinery.
const HOME_SECTIONS = ['about', 'offerings', 'testimonials', 'faqs'];
function homeSectionOrder(c: SnapshotContent, blockKeys: string[] = []): string[] {
  const all = [...HOME_SECTIONS, ...blockKeys];
  const hidden = new Set(c.settings?.sections?.hidden || []);
  const chosen = (c.settings?.sections?.order || []).filter((k) => all.includes(k));
  const rest = all.filter((k) => !chosen.includes(k));
  return [...chosen, ...rest].filter((k) => !hidden.has(k));
}

// Harbor's signature: the hero's right column is a stat/checklist panel on a pale
// steel wash — top offerings as a checked list, honest counts from the snapshot
// (tabular numerals), and the contact line. Everything derives deterministically
// from content; if there is nothing to show, the panel disappears and the hero
// falls back to a single column.
function heroPanel(c: SnapshotContent, v: ReturnType<typeof vocabFor>): string {
  const items = bySort(c.offerings).slice(0, 4);
  const cats = orderedCats(c);
  const { tel, mail } = contactBits(c);
  const stats: Array<[string, string]> = [];
  if (c.offerings.length) stats.push([String(c.offerings.length), v.offeringLabel]);
  if (cats.length > 1) stats.push([String(cats.length), 'Categories']);
  if (c.testimonials.length) stats.push([String(c.testimonials.length), 'Client reviews']);
  const rows = [
    items.length ? `<ul class="checklist">${items.map((o) => `<li>${esc(o.name)}</li>`).join('')}</ul>` : '',
    stats.length ? `<div class="hp-stats">${stats.map(([n, l]) => `<div class="stat"><span class="num">${esc(n)}</span><span class="lb">${esc(l)}</span></div>`).join('')}</div>` : '',
    (tel || mail) ? `<p class="hp-contact">${[tel, mail].filter(Boolean).join('<br>')}</p>` : '',
  ].filter(Boolean).join('');
  return rows ? `<aside class="hero-panel" aria-label="At a glance"><p class="hp-title">At a glance</p>${rows}</aside>` : '';
}

function homeBody(c: SnapshotContent, site: SiteConfig, v: ReturnType<typeof vocabFor>, blocks: RenderedBlock[] = []): string {
  const i = c.identity;
  const hero = c.settings?.cover || bySort(c.offerings).find((o) => o.media)?.media || c.posts.find((p) => p.hero)?.hero || c.settings?.logo || null;
  const featured = bySort(c.offerings).slice(0, 6);
  const tst = bySort(c.testimonials).slice(0, 3);
  const faqs = bySort(c.faqs).slice(0, 4);
  const { tel, mail } = contactBits(c);
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
  // Split layout with a chosen image respects the focal point; otherwise Harbor's
  // default right column is the stat/checklist panel.
  const useSplit = c.settings?.hero_layout === 'split' && heroImgOk;
  const focalStyle = hero?.focal ? ` style="object-position:${hero.focal.x}% ${hero.focal.y}%"` : '';
  const splitImg = useSplit && hero?.variants
    ? `<div class="split-img"><img src="${attr(hero.variants.w800 || hero.variants.w400 || '')}"${hero.variants.w400 && hero.variants.w1600 ? ` srcset="${attr(hero.variants.w400)} 400w, ${attr(hero.variants.w800 || hero.variants.w1600)} 800w, ${attr(hero.variants.w1600)} 1600w" sizes="(max-width:860px) 100vw, 42vw"` : ''} alt="${attr(hero.alt)}" fetchpriority="high"${focalStyle}></div>`
    : '';
  const right = useSplit ? splitImg : heroPanel(c, v);
  const heroOff = new Set(c.settings?.sections?.hidden || []).has('hero');   // hero is removable from the canvas
  return `${heroOff ? '' : `
<section class="hero"><div class="wrap hero-grid${right ? '' : ' solo'}"><div class="hero-copy">${heroText}</div>${right}</div>
${heroImgOk && !useSplit ? `<div class="wrap"><div class="hero-img">${img(hero, '(max-width: 1000px) 100vw, 960px', false)}</div></div>` : ''}
</section>`}
<div class="strip"><div class="wrap">
  ${loc0(c) ? `<span${pr('location.address')}>${esc(loc0(c)!.address_line1)}, ${esc(loc0(c)!.city)}</span>` : ''}
  ${tel ? `<span>${tel}</span>` : ''}
  ${mail ? `<span>${mail}</span>` : ''}
  ${maps ? `<span><a href="${attr(maps)}" rel="noopener">Get directions</a></span>` : ''}
</div></div>
${(() => {
  const parts: Record<string, string> = {
    about: `<section class="block wrap"><h2>About us</h2><p${pr('identity.description')}>${esc(i.description)}</p></section>`,
    offerings: featured.length ? `<section class="block alt"><div class="wrap"><h2>${esc(v.offeringLabel)}</h2><div class="svc-grid">${featured.map((o) => `
  <div class="svc"${prE('offering', o.id)}><div class="nm">${esc(o.name)}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${o.price_text ? `<div class="pr">${esc(o.price_text)}</div>` : ''}</div>`).join('')}
</div><p style="margin-top:22px"><a class="btn ghost" href="${attr(v.offeringPath)}">All ${esc(v.offeringLabel.toLowerCase())}</a></p></div></section>` : '',
    testimonials: tst.length ? `<section class="block wrap"><h2>What clients say</h2><div class="cards">${tst.map((t) => `
  <div class="card"${prE('testimonial', t.id)}><blockquote class="t"><p>“${esc(t.quote)}”</p><footer>— ${esc(t.author)}${t.source ? `, ${esc(t.source)}` : ''}</footer></blockquote></div>`).join('')}
</div></section>` : '',
    faqs: faqs.length ? `<section class="block alt"><div class="wrap"><h2>Good to know</h2><dl class="faq">${faqs.map((f) =>
  `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd class="prose">${renderMarkdown(f.answer)}</dd>`).join('')}
</dl><p style="margin-top:18px"><a href="/faq/">All questions →</a></p></div></section>` : '',
  };
  for (const b of blocks) parts[b.key] = b.html;   // enabled structured blocks
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
${i.story ? `<div class="prose">${renderMarkdown(i.story)}</div>` : ''}
${i.service_area ? `<h2>Where we work</h2><p>${esc(i.service_area)}</p>` : ''}</section>`;
}

function faqBody(c: SnapshotContent): string {
  return `<section class="block wrap"><h1>Frequently asked questions</h1><dl class="faq">${bySort(c.faqs).map((f) =>
    `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd class="prose">${renderMarkdown(f.answer)}</dd>`).join('')}</dl>
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
  return `<section class="block wrap"><h1>Updates</h1>${tagFilterBar(posts, esc, attr)}<div class="post-list">${posts.map((p) => { const tags = normalizeTags(p.tags); return `
<article${prE('post', p.id)}${postTagsAttr(tags, attr)}><h2><a href="/updates/${attr(p.slug)}/">${esc(p.title)}</a></h2>
<p class="post-meta"><time datetime="${attr(p.published_at)}">${esc(postDate(p.published_at))}</time></p>
${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}${postTagsHtml(tags, esc)}</article>`; }).join('')}
${posts.length === 0 ? '<p>No updates yet — our news will land here.</p>' : ''}</div>${tagFilterScript(posts)}</section>`;
}

function postBody(c: SnapshotContent, p: SnapshotContent['posts'][number]): string {
  return `<section class="block wrap"><article class="post prose">
<h1>${esc(p.title)}</h1>
<p class="post-meta"><time datetime="${attr(p.published_at)}">${esc(postDate(p.published_at))}</time></p>
${p.hero ? `<div style="margin:20px 0;border-radius:var(--radius,10px);overflow:hidden;border:1px solid var(--line)">${img(p.hero, '(max-width: 900px) 100vw, 860px', false)}</div>` : ''}
${renderMarkdown(p.body_md)}
${postTagsHtml(normalizeTags(p.tags), esc)}</article>
<p style="margin-top:28px"><a href="/updates/">← All updates</a></p></section>`;
}

// ═════════ the render function (the contract) ═════════

export const render: RenderFn = (snapshot: Snapshot, _manifest, site: SiteConfig): FileMap => {
  const c = normalizeSnapshotContent(snapshot.content);
  const i = c.identity;
  const v = vocabFor(c.settings?.industry);   // THE industry realization
  const files: FileMap = {};

  // Append the dropdown-nav CSS only when the owner set a custom nav → sites without
  // one keep the exact same stylesheet + hash (byte-identical).
  const effCss = CSS + (c.settings?.nav?.length ? '\n' + NAV_DROPDOWN_CSS : '');
  const cssPath = `/assets/site-${fnv(effCss)}.css`;
  files[`assets/site-${fnv(effCss)}.css`] = effCss;

  const siteTitle = i.seo_title || i.business_name;
  const siteDesc = i.seo_description || i.description;
  const ogImg = c.settings?.og_image?.variants?.w1600
    || (bySort(c.offerings).find((o) => o.media)?.media?.variants?.w1600)
    || (c.posts.find((p) => p.hero)?.hero?.variants?.w1600)
    || c.settings?.logo?.variants?.w1600;

  const ann = c.settings?.announcement;
  const annLive = ann && ann.text && (!ann.expires_at || String(ann.expires_at) > snapshot.created_at);
  const annHref = annLive && ann!.url ? safeHref(ann!.url) : '';
  const announce = annLive
    ? `<div class="annbar" role="status">${annHref ? `<a href="${attr(annHref)}">${esc(ann!.text)}</a>` : esc(ann!.text)}</div>` : '';
  const icon = c.settings?.logo?.variants?.w400 || '';
  const nav: Array<[string, string, string]> = [
    ['/', 'Home', 'home'], [v.offeringPath, v.offeringLabel, 'offerings'], ['/about/', 'About', 'about'],
    ['/faq/', 'FAQ', 'faq'], ['/updates/', 'Updates', 'updates'], ['/contact/', 'Contact', 'contact'],
  ];
  // Multi-page: the owner's own pages join the main nav (after Contact), unless hidden.
  for (const cp of (c.settings?.pages || [])) { if (!cp.hideNav) nav.push([`/${cp.slug}/`, cp.title, `page:${cp.slug}`]); }
  const extras: Extras = { announce, icon, nav };

  // "Show this page on Google?" — noindex + sitemap exclusion per page,
  // and per-page search headline/description overrides.
  const noidx = new Set(c.settings?.pages_noindex || []);
  const pseo = c.settings?.page_seo || {};
  // Wave-1 G7: the same page_seo map now carries optional SHARE overrides — they
  // feed the og:/twitter: tags via the ONE shared seoHead; absent = same bytes.
  const seoOv = (key: string, title: string, description: string) => ({
    title: (pseo[key]?.title || '').trim() || title,
    description: (pseo[key]?.description || '').trim() || description,
    ...((pseo[key]?.share_title || '').trim() ? { shareTitle: String(pseo[key]?.share_title).trim() } : {}),
    ...((pseo[key]?.share_description || '').trim() ? { shareDescription: String(pseo[key]?.share_description).trim() } : {}),
    ...(pseo[key]?.share_image ? { shareImage: String(pseo[key]?.share_image) } : {}),
  });
  const markNoindex = (file: string) => { files[file] = (files[file] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">'); };


  const page = (path: string, opts: Omit<PageOpts, 'path'>) => {
    const html = shell(c, site, cssPath, { path, ...opts }, extras);
    const file = path === '/' ? 'index.html' : `${path.replace(/^\/|\/$/g, '')}/index.html`;
    files[file] = html;
  };

  const blocks = renderSiteBlocks(c.settings?.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at });   // structured blocks (+ form blocks + booking + window)
  const ldBiz = ldBusiness(c, site, v.schemaType, v.offeringPath, v.isMenu);
  // Fold the HONEST reviews schema (AggregateRating + Review, approved rows only)
  // onto the ONE business node — home only, where the reviews_wall is visible.
  const rSchema = reviewsSchema(c.settings?.blocks, snapshot.created_at);
  const ldBizHome = rSchema ? { ...ldBiz, ...rSchema } : ldBiz;
  page('/', { title: siteTitle, description: siteDesc, ld: [ldBizHome, ldSite(c, site), ...blocks.flatMap((b) => (b.ld ? [b.ld] : []))], ogImage: ogImg, active: 'home', body: homeBody(c, site, v, blocks) });
  page(v.offeringPath, { ...seoOv('offerings', `${v.offeringLabel} — ${i.business_name}`, `${v.offeringLabel} from ${i.business_name}.`), ld: [ldOfferings(c, site, v)], ogImage: ogImg, active: 'offerings', body: offeringsBody(c, v) });
  if (noidx.has('offerings')) markNoindex(`${v.offeringPath.replace(/^\/|\/$/g, '')}/index.html`);
  page('/about/', { ...seoOv('about', `About — ${i.business_name}`, siteDesc), ld: [ldCrumbs(site, [[i.business_name, '/'], ['About', '/about/']])], active: 'about', body: aboutBody(c) });
  if (noidx.has('about')) markNoindex('about/index.html');
  page('/faq/', { ...seoOv('faq', `FAQ — ${i.business_name}`, `Answers to common questions about ${i.business_name}.`), ld: c.faqs.length ? [ldFaq(c)] : [], active: 'faq', body: faqBody(c) });
  if (noidx.has('faq')) markNoindex('faq/index.html');
  page('/contact/', { ...seoOv('contact', `Contact & Hours — ${i.business_name}`, `Address, phone, and hours for ${i.business_name}.`), ld: [ldBiz], active: 'contact', body: contactBody(c, site) });
  if (noidx.has('contact')) markNoindex('contact/index.html');
  page('/thanks/', { title: `Thank you — ${i.business_name}`, description: `Your message to ${i.business_name} was sent.`, ld: [], active: 'contact', body: `<section class="hero"><div class="wrap"><h1>Thank you — your message was sent.</h1><p class="tagline">${esc(i.business_name)} will get back to you soon.</p><div class="cta-row"><a class="btn" href="/">Back to the site</a></div></div></section>` });
  files['thanks/index.html'] = (files['thanks/index.html'] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">');
  // The generated legal foundation — facts-true, the owner never writes legal HTML
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

  // Multi-page: the owner's own pages, each rendered with the SAME shell/nav/footer
  // and the shared block engine — so a custom page is a first-class page of the site.
  for (const cp of (c.settings?.pages || [])) {
    const cblocks = renderSiteBlocks(cp.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at });
    page(`/${cp.slug}/`, {
      ...seoOv(`page:${cp.slug}`, `${cp.title} — ${i.business_name}`, siteDesc),
      ld: [ldCrumbs(site, [[i.business_name, '/'], [cp.title, `/${cp.slug}/`]]), ...cblocks.flatMap((b) => (b.ld ? [b.ld] : []))],
      active: `page:${cp.slug}`,
      body: `<section class="hero"><div class="wrap"><h1>${esc(cp.title)}</h1></div></section>${cblocks.map((b) => b.html).join('')}`,
    });
    if (noidx.has(`page:${cp.slug}`)) markNoindex(`${cp.slug}/index.html`);
  }

  // Static, privacy-safe on-site search — the site's own content index (zero
  // external origins, zero trackers) + a results page whose first-party inline
  // script filters it client-side. Kept out of the sitemap + noindexed.
  files['search-index.json'] = searchIndexJson(c, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel });
  page('/search/', { title: `Search — ${i.business_name}`, description: `Search ${i.business_name}.`, ld: [], active: '', body: searchPageBody(esc, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel }) + searchClientScript() });
  markNoindex('search/index.html');

  files['404.html'] = shell(c, site, cssPath, {
    path: '/404.html', title: `Page not found — ${i.business_name}`, description: siteDesc, ld: [], active: '',
    body: `<section class="hero"><div class="wrap"><h1>That page isn’t here</h1><p class="tagline">The page you’re after may have moved.</p><div class="cta-row"><a class="btn" href="/">Back to ${esc(i.business_name)}</a><a class="btn ghost" href="${attr(v.offeringPath)}">See our ${esc(v.offeringLabel.toLowerCase())}</a></div></div></section>`,
  }, extras);

  const letter = (i.business_name || 'B').trim()[0]?.toUpperCase() || 'B';
  files['favicon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1b2a4a"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(letter)}</text></svg>`;

  const lastmod = snapshot.created_at.slice(0, 10);
  const KEY_PATHS: Array<[string, string]> = [['offerings', v.offeringPath], ['about', '/about/'], ['faq', '/faq/'], ['contact', '/contact/'], ['updates', '/updates/']];
  const urls: Array<{ loc: string; lastmod: string }> = [{ loc: '/', lastmod }, ...KEY_PATHS.filter(([k]) => !noidx.has(k)).map(([, p]) => ({ loc: p, lastmod })), { loc: '/privacy/', lastmod }, { loc: '/accessibility/', lastmod }, ...c.posts.filter((p) => !p.noindex).map((p) => ({ loc: `/updates/${p.slug}/`, lastmod: String(p.published_at || snapshot.created_at).slice(0, 10) })), ...(c.settings?.pages || []).filter((cp) => !noidx.has(`page:${cp.slug}`)).map((cp) => ({ loc: `/${cp.slug}/`, lastmod }))];
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(site.baseUrl + u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  files['robots.txt'] = `User-agent: *\nAllow: /\nDisallow: /thanks/\n\nSitemap: ${site.baseUrl}/sitemap.xml\n`;
  // RSS feed for /updates/ — subscribers + SEO (a WordPress default the SMB builders lack)
  {
    const feedItems = c.posts.filter((p) => !p.noindex).slice(0, 20).map((p) => {
      const link = esc(site.baseUrl + `/updates/${p.slug}/`);
      const pub = p.published_at ? `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>` : '';
      const desc = p.excerpt ? `<description>${esc(p.excerpt)}</description>` : '';
      const cats = normalizeTags(p.tags).map((t) => `<category>${esc(t)}</category>`).join('');
      return `<item><title>${esc(p.title || 'Update')}</title><link>${link}</link><guid>${link}</guid>${pub}${cats}${desc}</item>`;
    }).join('');
    files['feed.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(i.business_name)} — Updates</title><link>${esc(site.baseUrl + '/updates/')}</link><description>${esc('Latest updates from ' + i.business_name)}</description>${feedItems}</channel></rss>\n`;
  }

  // real 301s on Netlify (SEO-safe — passes full ranking signal), matching restaurant-classic
  const _redir = (c.redirects || []).map((r) => `${r.from_path}  ${r.to_path}  301`).join('\n');
  files['_redirects'] = _redir ? _redir + '\n' : '';
  // meta-refresh pages remain as a fallback for any host without _redirects support
  for (const r of c.redirects) files[`${r.from_path.replace(/^\/|\/$/g, '')}/index.html`] = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attr(r.to_path)}"><link rel="canonical" href="${attr(site.baseUrl + r.to_path)}"><title>Moved</title></head><body><p>Moved to <a href="${attr(r.to_path)}">${esc(r.to_path)}</a>.</p></body></html>`;

  return files;
};
