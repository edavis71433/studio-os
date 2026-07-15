// ── meadow 1.0.0 — pure render function (#183 template family) ────────────────
// "Meadow": a warm, organic look for wellness, health, nonprofits, and family
// businesses. Soft warm cream ground with deep moss-green ink, a muted sage/moss
// accent, large friendly corner radii, airy spacing, green-tinted layered shadows,
// a gentle sage→cream hero wash, pill buttons, hand-warmed testimonial cards with
// a tilted quote mark, and small leaf-like CSS dots (zero images). Same engine,
// same laws as every template: snapshot in → FileMap out; no network, no clock
// (snapshot timestamps only), no randomness, zero emitted JavaScript beyond the
// shared first-party search/tag-filter scripts. Accessibility/SEO/performance are
// properties of this file, never author responsibilities.
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

// ═════════ CSS — warm, organic, garden-calm (zero external assets) ═════════
// Ground: warm cream. Ink: deep moss. Accent: muted sage/moss (#4a7c59 — white on
// it is 4.87:1, AA). Soft (#55624f) is 5.8:1 on cream and 5.6:1 on the sage wash.
// Radii are large and friendly (20–26px), shadows are layered with a green tint,
// buttons are pills, headings use --font-display with a Georgia-ending fallback,
// and leaf-like dots (pure CSS radial-gradients) mark section headings.
const CSS = `:root{--ink:#243428;--soft:#55624f;--paper:var(--bg,#faf7f0);--card:#fffdf7;--accent:#4a7c59;--accent-dark:#345c41;--line:#e4dfcd;--wash:#edf2e2;--sprout:#7ba374;--seed:#b8cfa2}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,"Seravek","Gill Sans",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background-color:var(--paper);background-image:radial-gradient(120% 620px at 50% -120px,#e7efd9 0%,rgba(231,239,217,0) 72%);background-repeat:no-repeat;color:var(--ink);line-height:1.7;font-size:1.04rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);line-height:1.14;letter-spacing:-.015em;font-weight:700}
h1{font-size:clamp(2.3rem,5.6vw,3.7rem)}h2{font-size:clamp(1.5rem,3.2vw,2.05rem);margin-bottom:18px}h3{font-size:1.16rem}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.hero-split{display:grid;grid-template-columns:1.1fr 1fr;gap:44px;align-items:center;text-align:left}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{border-radius:26px;overflow:hidden;box-shadow:0 3px 8px rgba(53,92,66,.07),0 28px 64px rgba(53,92,66,.14)}
.hero-split .split-img img{width:100%;height:100%;min-height:300px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr}}
.annbar{background:var(--accent);color:#fff;text-align:center;padding:11px 16px;font-size:.95rem;font-weight:500}
.annbar a{color:#fff;text-decoration:underline}
.notice{background:#fbf0dc;color:#6a4d15;text-align:center;padding:10px 16px;font-size:.95rem}
header.site{background:rgba(250,247,240,.85);backdrop-filter:saturate(1.4) blur(12px);-webkit-backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;flex-wrap:wrap}
.brand{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-weight:700;font-size:1.3rem;letter-spacing:-.015em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:10px}
nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:9px 16px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.94rem;border-radius:999px}
nav.primary a:hover{color:var(--accent-dark);background:var(--wash)}
nav.primary a[aria-current="page"]{color:#fff;background:var(--accent)}
.hero{padding:calc(100px * var(--spacing-scale,1)) 0 calc(64px * var(--spacing-scale,1))}
.hero .kicker{display:inline-block;color:var(--accent-dark);background:var(--wash);border:1px solid #dbe6cb;font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;padding:7px 16px;border-radius:999px}
.hero h1{margin:18px 0 14px;max-width:20ch;text-wrap:balance}
.tagline{font-size:1.26rem;color:var(--soft);max-width:54ch;line-height:1.55}
.cta-row{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:15px 30px;border-radius:999px;text-decoration:none;font-weight:700;font-size:1rem;box-shadow:0 2px 6px rgba(53,92,66,.12),0 10px 26px rgba(53,92,66,.22);transition:transform .12s,box-shadow .12s,background-color .12s}
.btn:hover{background:var(--accent-dark);transform:translateY(-1px);box-shadow:0 3px 8px rgba(53,92,66,.14),0 14px 32px rgba(53,92,66,.26)}
.btn.ghost{background:transparent;color:var(--accent-dark);border:2px solid #cfdcc0;box-shadow:none}
.btn.ghost:hover{background:var(--wash);border-color:var(--accent);transform:none}
.hero-img{margin-top:48px;border-radius:26px;overflow:hidden;box-shadow:0 3px 8px rgba(53,92,66,.07),0 32px 72px rgba(53,92,66,.15)}
.hero-img img{width:100%;height:auto;display:block}
.strip{background:var(--ink);color:#dfe7db;font-size:.92rem}
.strip .wrap{display:flex;gap:22px;flex-wrap:wrap;padding:13px 24px}
.strip a{color:#c2dcc0}
.block{padding:calc(76px * var(--spacing-scale,1)) 0}
.block.alt{background:var(--wash)}
.block>.wrap>h1::before,.block.wrap>h1::before,.block>.wrap>h2::before,.block.wrap>h2::before{content:"";display:block;width:46px;height:10px;margin-bottom:14px;background:radial-gradient(9px 10px at 5px 5px,var(--accent) 60%,transparent 64%),radial-gradient(9px 10px at 22px 5px,var(--sprout) 60%,transparent 64%),radial-gradient(9px 10px at 39px 5px,var(--seed) 60%,transparent 64%)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:22px;margin-top:8px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px;box-shadow:0 1px 3px rgba(53,92,66,.05),0 6px 18px rgba(53,92,66,.05);transition:transform .12s,box-shadow .12s}
.svc:hover{transform:translateY(-3px);box-shadow:0 2px 6px rgba(53,92,66,.07),0 20px 44px rgba(53,92,66,.12)}
.svc .nm{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-weight:700;font-size:1.12rem}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:6px}
.svc .pr{color:var(--accent-dark);font-weight:700;margin-top:10px}
.svc img{width:100%;height:auto;border-radius:16px;margin-top:14px}
.cat-h{margin-top:42px;padding-bottom:8px;border-bottom:2px solid #dbe6cb}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px;box-shadow:0 1px 3px rgba(53,92,66,.05),0 8px 26px rgba(53,92,66,.06)}
blockquote.t{position:relative;padding-top:16px}
blockquote.t::before{content:"\\201C";position:absolute;top:-8px;left:-4px;font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-size:3.6rem;line-height:1;color:var(--accent);opacity:.3;transform:rotate(-9deg)}
blockquote.t p{font-size:1.05rem}
blockquote.t footer{margin-top:12px;color:var(--soft);font-size:.92rem;font-weight:700}
dl.faq dt{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-weight:700;margin-top:24px;font-size:1.08rem}
dl.faq dd{color:var(--soft);margin-top:6px}
table.hours{border-collapse:collapse;width:100%;max-width:420px}
table.hours caption{text-align:left;font-weight:700;margin-bottom:10px;font-size:1.05rem}
table.hours th{text-align:left;font-weight:600;padding:7px 14px 7px 0;color:var(--soft)}
table.hours td{padding:7px 0}
.holiday{margin-top:14px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card label{font-weight:700;font-size:.94rem}
form.card input,form.card textarea{width:100%;padding:12px 14px;border:1px solid #d5d0bd;border-radius:14px;font:inherit;margin-top:5px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
form.card p{margin-bottom:14px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:26px 0;border-bottom:1px solid var(--line)}
.post-list h2 a{color:var(--ink)}
.post-meta{color:var(--soft);font-size:.9rem;margin:4px 0 8px}
article.post{max-width:720px}
article.post p{margin-bottom:16px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.3em 0 .4em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--accent-dark);text-decoration:underline}
footer.site{background:var(--ink);color:#dfe7db;padding:56px 0 36px;margin-top:80px;border-radius:26px 26px 0 0}
footer.site a{color:#bcd9bb}
footer.site h2{font-size:1.15rem}
footer.site table.hours th{color:#a9bda5}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:32px}
.credit{margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.16);font-size:.88rem;color:#9db29a;display:flex;gap:14px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn,.svc{transition:none}.btn:hover,.svc:hover{transform:none}}
@media (max-width:640px){.hero{padding:64px 0 44px}.block{padding:52px 0}}
@media print{body{background:#fff}.annbar,.skip{display:none}header.site{position:static}.btn,.svc,.card,.hero-img{box-shadow:none}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#243428;--soft:#55624f;--paper:var(--bg,#faf7f0);--accent:#4a7c59;--line:#e4dfcd}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-body,"Seravek","Gill Sans",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background-color:var(--paper);background-image:radial-gradient(120% 620px at 50% -120px,#e7efd9 0%,rgba(231,239,217,0) 72%);background-repeat:no-repeat;color:var(--ink);line-height:1.7;font-size:16.5px}h1{font-size:clamp(2.3rem,5.6vw,3.7rem);line-height:1.14;letter-spacing:-.015em;font-weight:700;font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif)}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;flex-wrap:wrap}nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:9px 16px;text-decoration:none;color:#55624f;font-weight:600}.hero{padding:100px 0 64px}`;

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

// ═════════ JSON-LD (industry-correct — same contract as every template) ═════════

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

// Phase CP-2 (DS-2): home sections — owner-chosen order + visibility, structured.
// Phase T-BLOCKS: enabled structured blocks (block_<type>) join the same order/
// visibility machinery — they default after the core sections, reorderable/hideable.
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
  const hero = c.settings?.cover || bySort(c.offerings).find((o) => o.media)?.media || c.posts.find((p) => p.hero)?.hero || c.settings?.logo || null;
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
  const heroOff = new Set(c.settings?.sections?.hidden || []).has('hero');   // hero is removable from the canvas
  return `${heroOff ? '' : `
<section class="hero wrap">${useSplit ? `<div class="hero-split"><div>${heroText}</div>${splitImg}</div>` : `${heroText}
  ${heroImgOk ? `<div class="hero-img">${img(hero, '(max-width: 1000px) 100vw, 960px', false)}</div>` : ''}`}
</section>`}
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
  `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd class="prose">${renderMarkdown(f.answer)}</dd>`).join('')}
</dl><p style="margin-top:18px"><a href="/faq/">All questions →</a></p></div></section>` : '',
  };
  for (const b of blocks) parts[b.key] = b.html;   // Phase T-BLOCKS: enabled structured blocks
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
${p.hero ? `<div style="margin:20px 0;border-radius:20px;overflow:hidden">${img(p.hero, '(max-width: 900px) 100vw, 860px', false)}</div>` : ''}
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
  const announce = annLive
    ? `<div class="annbar" role="status">${(ann!.url && safeHref(ann!.url)) ? `<a href="${attr(safeHref(ann!.url)!)}">${esc(ann!.text)}</a>` : esc(ann!.text)}</div>` : '';
  const icon = c.settings?.logo?.variants?.w400 || '';
  const nav: Array<[string, string, string]> = [
    ['/', 'Home', 'home'], [v.offeringPath, v.offeringLabel, 'offerings'], ['/about/', 'About', 'about'],
    ['/faq/', 'FAQ', 'faq'], ['/updates/', 'Updates', 'updates'], ['/contact/', 'Contact', 'contact'],
  ];
  // Multi-page: the owner's own pages join the main nav (after Contact), unless hidden.
  for (const cp of (c.settings?.pages || [])) { if (!cp.hideNav) nav.push([`/${cp.slug}/`, cp.title, `page:${cp.slug}`]); }
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

  const blocks = renderSiteBlocks(c.settings?.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at });   // Phase T-BLOCKS (+ FB form blocks + BK booking + EXP window)
  const ldBiz = ldBusiness(c, site, v.schemaType, v.offeringPath, v.isMenu);
  // Phase RV: fold the HONEST reviews schema (AggregateRating + Review, approved rows
  // only) onto the ONE business node — home only, where the reviews_wall is visible.
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

  // Multi-page: the owner's own pages, each rendered with the SAME shell/nav/footer
  // and the shared block engine — so a custom page is a first-class page of the site.
  for (const cp of (c.settings?.pages || [])) {
    const cblocks = renderSiteBlocks(cp.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at });
    page(`/${cp.slug}/`, {
      title: `${cp.title} — ${i.business_name}`, description: siteDesc,
      ld: [ldCrumbs(site, [[i.business_name, '/'], [cp.title, `/${cp.slug}/`]]), ...cblocks.flatMap((b) => (b.ld ? [b.ld] : []))],
      active: `page:${cp.slug}`,
      body: `<section class="hero wrap"><h1>${esc(cp.title)}</h1></section>${cblocks.map((b) => b.html).join('')}`,
    });
    if (noidx.has(`page:${cp.slug}`)) markNoindex(`${cp.slug}/index.html`);
  }

  // Phase SEARCH: static, privacy-safe on-site search — the site's own content
  // index (zero external origins, zero trackers) + a calm results page whose
  // first-party inline script filters it client-side. Kept out of the sitemap +
  // noindexed (a thin utility page).
  files['search-index.json'] = searchIndexJson(c, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel });
  page('/search/', { title: `Search — ${i.business_name}`, description: `Search ${i.business_name}.`, ld: [], active: '', body: searchPageBody(esc, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel }) + searchClientScript() });
  markNoindex('search/index.html');

  files['404.html'] = shell(c, site, cssPath, {
    path: '/404.html', title: `Page not found — ${i.business_name}`, description: siteDesc, ld: [], active: '',
    body: `<section class="hero wrap"><h1>That page isn’t here</h1><p class="tagline">The page you’re after may have moved.</p><div class="cta-row"><a class="btn" href="/">Back to ${esc(i.business_name)}</a><a class="btn ghost" href="${attr(v.offeringPath)}">See our ${esc(v.offeringLabel.toLowerCase())}</a></div></section>`,
  }, extras);

  const letter = (i.business_name || 'B').trim()[0]?.toUpperCase() || 'B';
  files['favicon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="#4a7c59"/><text x="32" y="44" font-family="Georgia,serif" font-size="34" font-weight="700" fill="#faf7f0" text-anchor="middle">${esc(letter)}</text></svg>`;

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
