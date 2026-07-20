// ── atelier 1.0.0 — pure render function ─────────────────────────────────────
// An elegant boutique/luxury design language for salons, studios, photographers,
// and premium services: ivory ground, near-black ink, fine serif display
// headings, a restrained bronze accent used ONLY for rules/kickers/small-caps
// labels (never large fills), hairline rules instead of shadows, a centered hero
// with a small-caps letterspaced kicker over a huge serif headline, offerings as
// a refined name — dotted leader — price list, understated 1px-ink-border
// buttons that fill with ink on hover, and a quiet centered colophon footer.
// Same engine, same laws as every template: snapshot in → FileMap out; no
// network, no clock (snapshot timestamps only), no randomness, zero emitted
// JavaScript beyond the shared first-party search/tag-filter scripts.
// Accessibility/SEO/performance are properties of this file, never author
// responsibilities.
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

// ═════════ CSS — ivory, ink, bronze hairlines: quiet luxury (zero external assets) ═════════
// Contrast notes (AA): ink #1c1b18 on ivory #fbfaf7 ≈ 15.9:1; soft #5b564c ≈ 7.0:1;
// bronze TEXT uses the darkened --accent-ink #7a5f3a ≈ 5.7:1 — the lighter #9a7b4f
// bronze is reserved for 1px rules and decorative leaders only.
const CSS = `:root{--ink:#1c1b18;--soft:#5b564c;--paper:var(--bg,#fbfaf7);--card:#ffffff;--accent:#9a7b4f;--accent-ink:#7a5f3a;--line:#e5e0d5;--wash:#f4f1e9}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,"Avenir Next","Helvetica Neue",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.7;font-size:1.02rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,Georgia,"Times New Roman",serif);line-height:1.08;letter-spacing:-.01em;font-weight:500}
h1{font-size:clamp(2.7rem,7vw,4.8rem)}h2{font-size:clamp(1.6rem,3.4vw,2.3rem);margin-bottom:18px}h3{font-size:1.25rem}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:var(--paper);padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.annbar{background:var(--ink);color:#f6f2ea;text-align:center;padding:10px 16px;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase}
.annbar a{color:#f6f2ea;text-decoration:underline}
.notice{background:var(--wash);color:#6a5533;text-align:center;padding:10px 16px;font-size:.92rem;border-bottom:1px solid var(--line)}
header.site{background:var(--paper);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;flex-wrap:wrap}
.nav.centered{flex-direction:column;gap:10px;justify-content:center;text-align:center}
.brand{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.45rem;letter-spacing:.02em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:36px;width:auto;vertical-align:middle;margin-right:12px}
nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:8px 12px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;border-bottom:1px solid transparent}
nav.primary a:hover{color:var(--accent-ink)}
nav.primary a[aria-current="page"]{color:var(--ink);border-bottom:1px solid var(--accent)}
.hero{padding:calc(96px * var(--spacing-scale,1)) 0 calc(64px * var(--spacing-scale,1));text-align:center}
.hero .kicker{display:inline-block;color:var(--accent-ink);font-weight:600;font-size:.74rem;letter-spacing:.28em;text-transform:uppercase}
.hero .kicker::after{content:"";display:block;width:36px;margin:14px auto 0;border-top:1px solid var(--accent)}
.hero h1{margin:18px auto 16px;max-width:17ch;text-wrap:balance}
.tagline{font-size:1.22rem;color:var(--soft);max-width:52ch;margin:0 auto;line-height:1.6}
.cta-row{display:flex;gap:14px;margin-top:34px;flex-wrap:wrap;justify-content:center}
.btn{display:inline-block;background:transparent;color:var(--ink);border:1px solid var(--ink);padding:15px 32px;text-decoration:none;font-weight:600;font-size:.74rem;letter-spacing:.2em;text-transform:uppercase;font-family:inherit;cursor:pointer;transition:background .15s,color .15s}
.btn:hover{background:var(--ink);color:var(--paper)}
.btn.ghost{border-color:var(--line);color:var(--soft)}
.btn.ghost:hover{background:transparent;border-color:var(--ink);color:var(--ink)}
.hero-img{margin:52px auto 0;max-width:960px;overflow:hidden;border:1px solid var(--line)}
.hero-img img{width:100%;height:auto;display:block}
.hero-split{display:grid;grid-template-columns:1.05fr 1fr;gap:44px;align-items:center;text-align:left}
.hero-split h1{margin-left:0;margin-right:0}
.hero-split .tagline{margin-left:0}
.hero-split .kicker::after{margin-left:0}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{overflow:hidden;border:1px solid var(--line)}
.hero-split .split-img img{width:100%;height:100%;min-height:320px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr;text-align:center}.hero-split .cta-row{justify-content:center}.hero-split .tagline{margin:0 auto}.hero-split .kicker::after{margin-left:auto}}
.strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--soft)}
.strip .wrap{display:flex;gap:28px;flex-wrap:wrap;justify-content:center;padding:14px 24px}
.strip a{color:var(--accent-ink);text-decoration:none}
.strip a:hover{text-decoration:underline}
.block{padding:calc(64px * var(--spacing-scale,1)) 0}
.block>.wrap>h1::after,.block>.wrap>h2::after,.block.wrap>h1::after,.block.wrap>h2::after{content:"";display:block;width:44px;border-top:1px solid var(--accent);margin-top:16px}
.block.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 48px;margin-top:10px}
.svc{border-top:1px solid var(--line);padding:18px 0}
.svc-line{display:flex;align-items:baseline;gap:10px}
.svc .nm{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.18rem}
.svc .lead{flex:1;min-width:24px;border-bottom:1px dotted var(--accent);position:relative;top:-4px}
.svc .pr{color:var(--accent-ink);font-size:.95rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:5px;max-width:60ch}
.svc img{width:100%;height:auto;margin-top:14px}
.cat-h{margin-top:44px;padding-bottom:8px;border-bottom:1px solid var(--ink);font-size:.76rem;letter-spacing:.24em;text-transform:uppercase;color:var(--accent-ink);font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}
.card{background:var(--card);border:1px solid var(--line);padding:28px}
blockquote.t p{font-family:var(--font-display,Georgia,serif);font-size:1.24rem;font-style:italic;line-height:1.5}
blockquote.t footer{margin-top:14px;color:var(--soft);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
dl.faq dt{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.18rem;margin-top:24px;padding-top:24px;border-top:1px solid var(--line)}
dl.faq dt:first-of-type{border-top:none;padding-top:0;margin-top:0}
dl.faq dd{color:var(--soft);margin-top:8px}
table.hours{border-collapse:collapse;width:100%;max-width:440px}
table.hours caption{text-align:left;font-family:var(--font-display,Georgia,serif);font-weight:500;margin-bottom:12px;font-size:1.15rem}
table.hours th{text-align:left;font-weight:400;padding:8px 14px 8px 0;color:var(--soft)}
table.hours td{padding:8px 0;font-variant-numeric:tabular-nums}
table.hours tr{border-bottom:1px solid var(--line)}
.holiday{margin-top:16px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card{margin-top:28px}
form.card label{font-weight:600;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
form.card input,form.card textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius,0);font:inherit;margin-top:6px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent-ink);outline-offset:1px}
form.card p{margin-bottom:16px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:26px 0;border-top:1px solid var(--line)}
.post-list article:first-of-type{border-top:none}
.post-list h2 a{color:var(--ink);text-decoration:none}
.post-list h2 a:hover{color:var(--accent-ink)}
.post-meta{color:var(--soft);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;margin:6px 0 10px}
article.post{max-width:680px;margin:0 auto}
article.post p{margin-bottom:18px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.4em 0 .5em}
.prose h2::after{display:none}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:1px solid var(--accent);padding-left:18px;margin:0 0 1em;color:var(--soft);font-style:italic}
.prose a{color:var(--accent-ink);text-decoration:underline}
footer.site{background:var(--paper);color:var(--ink);border-top:1px solid var(--line);padding:56px 0 40px;margin-top:80px;text-align:center}
footer.site a{color:var(--accent-ink)}
footer.site h2{font-family:var(--font-display,Georgia,serif);font-size:1.35rem;font-weight:500}
footer.site h2::after{content:"";display:block;width:36px;border-top:1px solid var(--accent);margin:12px auto 14px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:34px;justify-items:center}
.cols table.hours{margin:0 auto}
.cols table.hours caption{text-align:center}
.credit{margin-top:36px;padding-top:22px;border-top:1px solid var(--line);font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--soft);display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
:focus-visible{outline:2px solid var(--accent-ink);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn{transition:none}}
@media print{body{background:#fff;color:#000}.annbar,.skip{display:none}header.site{position:static}}
@media (max-width:640px){.hero{padding:64px 0 44px}.block{padding:48px 0}.svc-grid{gap:0}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#1c1b18;--soft:#5b564c;--paper:var(--bg,#fbfaf7);--accent:#9a7b4f;--accent-ink:#7a5f3a;--line:#e5e0d5}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-body,"Avenir Next","Helvetica Neue",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.7;font-size:16.5px}h1{font-size:clamp(2.7rem,7vw,4.8rem);line-height:1.08;font-family:var(--font-display,Georgia,serif);font-weight:500}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:var(--paper);padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}header.site{border-bottom:1px solid var(--line)}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;flex-wrap:wrap}.brand{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.45rem;color:var(--ink);text-decoration:none}nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:8px 12px;text-decoration:none;color:#5b564c;font-weight:600;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase}.hero{padding:96px 0 64px;text-align:center}`;

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

// The signature offering row: name — dotted leader — price, description beneath.
function svcItem(o: SnapshotContent['offerings'][number], withImg = false): string {
  return `<div class="svc"${prE('offering', o.id)}><div class="svc-line"><span class="nm">${esc(o.name)}</span>${o.price_text ? `<span class="lead" aria-hidden="true"></span><span class="pr">${esc(o.price_text)}</span>` : ''}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${withImg && o.media ? img(o.media, '(max-width:640px) 100vw, 420px') : ''}</div>`;
}

// ═════════ JSON-LD (industry-correct) ═════════

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

// Home sections — owner-chosen order + visibility, structured. Enabled structured
// blocks (block_<type>) join the same order/visibility machinery — they default
// after the core sections, reorderable/hideable.
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
  // Split layout — a CROPPING presentation, so the focal point drives it
  const useSplit = c.settings?.hero_layout === 'split' && heroImgOk;
  const focalStyle = hero?.focal ? ` style="object-position:${hero.focal.x}% ${hero.focal.y}%"` : '';
  const splitImg = useSplit && hero?.variants
    ? `<div class="split-img"><img src="${attr(hero.variants.w800 || hero.variants.w400 || '')}"${hero.variants.w400 && hero.variants.w1600 ? ` srcset="${attr(hero.variants.w400)} 400w, ${attr(hero.variants.w800 || hero.variants.w1600)} 800w, ${attr(hero.variants.w1600)} 1600w" sizes="(max-width:760px) 100vw, 45vw"` : ''} alt="${attr(hero.alt)}" fetchpriority="high"${focalStyle}></div>`
    : '';
  const heroOff = new Set(c.settings?.sections?.hidden || []).has('hero');   // hero is removable from the canvas
  return `${heroOff ? '' : `
<section class="hero wrap" data-dds-core="hero">${useSplit ? `<div class="hero-split"><div>${heroText}</div>${splitImg}</div>` : `${heroText}
  ${heroImgOk ? `<div class="hero-img">${img(hero, '(max-width: 1000px) 100vw, 960px', false)}</div>` : ''}`}
</section>`}
<div class="strip"><div class="wrap">
  ${loc0(c) ? `<span${pr('location.address')}>${esc(loc0(c)!.address_line1)}, ${esc(loc0(c)!.city)}</span>` : ''}
  ${tel ? `<span>${tel}</span>` : ''}
  ${maps ? `<span><a href="${attr(maps)}" rel="noopener">Get directions</a></span>` : ''}
</div></div>
${(() => {
  const parts: Record<string, string> = {
    about: `<section class="block wrap" data-dds-core="about"><h2>About us</h2><p${pr('identity.description')}>${esc(i.description)}</p></section>`,
    offerings: featured.length ? `<section class="block alt" data-dds-core="offerings"><div class="wrap"><h2>${esc(v.offeringLabel)}</h2><div class="svc-grid">${featured.map((o) => `
  ${svcItem(o)}`).join('')}
</div><p style="margin-top:26px"><a class="btn ghost" href="${attr(v.offeringPath)}">All ${esc(v.offeringLabel.toLowerCase())}</a></p></div></section>` : '',
    testimonials: tst.length ? `<section class="block wrap" data-dds-core="testimonials"><h2>What customers say</h2><div class="cards">${tst.map((t) => `
  <div class="card"${prE('testimonial', t.id)}><blockquote class="t"><p>“${esc(t.quote)}”</p><footer>— ${esc(t.author)}${t.source ? `, ${esc(t.source)}` : ''}</footer></blockquote></div>`).join('')}
</div></section>` : '',
    faqs: faqs.length ? `<section class="block alt" data-dds-core="faqs"><div class="wrap"><h2>Good to know</h2><dl class="faq">${faqs.map((f) =>
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
  ${svcItem(o, true)}`).join('')}
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
${p.hero ? `<div style="margin:20px 0;border:1px solid var(--line);overflow:hidden">${img(p.hero, '(max-width: 900px) 100vw, 860px', false)}</div>` : ''}
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

  // "Show this page on Google?" — noindex + sitemap exclusion per page,
  // and per-page search headline/description overrides. Plain choices, our plumbing.
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

  const blocks = renderSiteBlocks(c.settings?.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at, src: c.settings?.blocks_src });   // structured blocks (+ form blocks + booking + window)
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
  page('/thanks/', { title: `Thank you — ${i.business_name}`, description: `Your message to ${i.business_name} was sent.`, ld: [], active: 'contact', body: `<section class="hero wrap"><h1>Thank you — your message was sent.</h1><p class="tagline">${esc(i.business_name)} will get back to you soon.</p><div class="cta-row"><a class="btn" href="/">Back to the site</a></div></section>` });
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
    const cblocks = renderSiteBlocks(cp.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at, src: cp.blocks_src });
    page(`/${cp.slug}/`, {
      ...seoOv(`page:${cp.slug}`, `${cp.title} — ${i.business_name}`, siteDesc),
      ld: [ldCrumbs(site, [[i.business_name, '/'], [cp.title, `/${cp.slug}/`]]), ...cblocks.flatMap((b) => (b.ld ? [b.ld] : []))],
      active: `page:${cp.slug}`,
      body: `<section class="hero wrap"><h1>${esc(cp.title)}</h1></section>${cblocks.map((b) => b.html).join('')}`,
    });
    if (noidx.has(`page:${cp.slug}`)) markNoindex(`${cp.slug}/index.html`);
  }

  // Static, privacy-safe on-site search — the site's own content index (zero
  // external origins, zero trackers) + a calm results page whose first-party
  // inline script filters it client-side. Kept out of the sitemap + noindexed.
  files['search-index.json'] = searchIndexJson(c, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel });
  page('/search/', { title: `Search — ${i.business_name}`, description: `Search ${i.business_name}.`, ld: [], active: '', body: searchPageBody(esc, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel }) + searchClientScript() });
  markNoindex('search/index.html');

  files['404.html'] = shell(c, site, cssPath, {
    path: '/404.html', title: `Page not found — ${i.business_name}`, description: siteDesc, ld: [], active: '',
    body: `<section class="hero wrap"><h1>That page isn’t here</h1><p class="tagline">The page you’re after may have moved.</p><div class="cta-row"><a class="btn" href="/">Back to ${esc(i.business_name)}</a><a class="btn ghost" href="${attr(v.offeringPath)}">See our ${esc(v.offeringLabel.toLowerCase())}</a></div></section>`,
  }, extras);

  const letter = (i.business_name || 'B').trim()[0]?.toUpperCase() || 'B';
  files['favicon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#1c1b18"/><text x="32" y="44" font-family="Georgia,serif" font-size="34" font-weight="500" fill="#fbfaf7" text-anchor="middle">${esc(letter)}</text></svg>`;

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

  // real 301s on Netlify (SEO-safe — passes full ranking signal)
  const _redir = (c.redirects || []).map((r) => `${r.from_path}  ${r.to_path}  301`).join('\n');
  files['_redirects'] = _redir ? _redir + '\n' : '';
  // meta-refresh pages remain as a fallback for any host without _redirects support
  for (const r of c.redirects) files[`${r.from_path.replace(/^\/|\/$/g, '')}/index.html`] = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attr(r.to_path)}"><link rel="canonical" href="${attr(site.baseUrl + r.to_path)}"><title>Moved</title></head><body><p>Moved to <a href="${attr(r.to_path)}">${esc(r.to_path)}</a>.</p></body></html>`;

  return files;
};
