// ── restaurant-classic 1.0.0 — pure render function ─────────────────────────
// Snapshot in, FileMap out. No network, no clock (snapshot timestamps only),
// no randomness. Accessibility, SEO/AEO, and performance are properties of
// this file — never author responsibilities. Every interpolation is escaped;
// markdown passes through the sanitizer; URLs pass through safeHref.
import { esc, attr, safeHref, renderMarkdown } from '../../../lib/markdown.ts';
import { renderSiteBlocks, reviewsSchema, BLOCK_CSS, type RenderedBlock } from '../../../lib/site_blocks.ts';
import { renderNavList, NAV_DROPDOWN_CSS } from '../../../lib/site_nav.ts';
import { seoHead } from '../../../lib/seo_emit.ts';
import { normalizeSnapshotContent } from '../../../lib/render_types.ts';
import { privacyBody, accessibilityBody, legalFooterLinks } from '../../../lib/legal_pages.ts';
import { SEARCH_CSS, searchBoxHtml, searchPageBody, searchClientScript, searchIndexJson, normalizeTags, postTagsAttr, postTagsHtml, tagFilterBar, tagFilterScript } from '../../../lib/search_index.ts';
import type { FileMap, HolidayException, HoursDay, LocationContent, MediaRef, RenderFn, Snapshot, SnapshotContent, SiteConfig, TemplateManifest } from '../../../lib/render_types.ts';

// v1 renders the first (only) location; the contract carries a list (M7).
const loc0 = (c: SnapshotContent): LocationContent | null => c.locations?.[0] ?? null;

/** Region marker (reconciliation R3): stable data attribute mapping rendered
 *  regions to content entities so future preview overlays can outline changes.
 *  Deterministic, invisible, and part of this template's manifest interface. */
const pr = (region: string): string => ` data-pr="${attr(region)}"`;
/** Entity region marker: kind + row id, e.g. data-pr="offering" data-pr-id="…". */
const prE = (kind: string, id: string): string => ` data-pr="${attr(kind)}" data-pr-id="${attr(id)}"`;

/** Order category names by the site's chosen section order, then encounter order. */
function orderedCats(c: SnapshotContent): string[] {
  const encounter: string[] = [];
  for (const o of bySort(c.offerings)) if (!encounter.includes(o.category)) encounter.push(o.category);
  const chosen = (c.settings?.category_order || []).filter((x) => encounter.includes(x));
  return [...chosen, ...encounter.filter((x) => !chosen.includes(x))];
}

// deterministic content hash (fnv1a-64) for asset fingerprinting — sync + stable
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
const DAY_SCHEMA: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
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

// ═════════ CSS (one hand-authored sheet; system font stack — zero external assets) ═════════
// G2 parity: hero_layout 'split' (photo beside the welcome text, cream-framed) and
// nav_style 'centered' (stacked, centered header) — same settings as business-classic.
const CSS = `:root{--ink:#241d1a;--soft:#6b5f58;--cream:var(--bg,#faf6ef);--card:#ffffff;--accent:#8c3b2e;--accent-dark:#6f2e24;--line:#e7ddd0;--good:#2e6b46}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
html{scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
body{font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",sans-serif);background:var(--cream);color:var(--ink);line-height:1.65;font-size:1.03rem}
h1,h2,h3,.brand{font-family:var(--font-display,Georgia,'Iowan Old Style','Times New Roman',serif);font-weight:400;line-height:1.2;text-wrap:balance}
h1{font-size:clamp(2rem,5.5vw,3.2rem)}h2{font-size:clamp(1.5rem,3.5vw,2rem);margin-bottom:.6em}h3{font-size:1.15rem}
a{color:var(--accent)}a:hover{color:var(--accent-dark)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:2px}
.skip{position:absolute;left:-9999px;top:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99;border-radius:0 0 8px 0}
.skip:focus{left:0}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.site{background:var(--cream);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;flex-wrap:wrap}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.brand{font-size:1.35rem;color:var(--ink);text-decoration:none}
nav.primary ul{display:flex;gap:6px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:10px 12px;text-decoration:none;color:var(--ink);border-radius:8px;font-size:.95rem;min-height:44px;line-height:24px}
nav.primary a:hover{background:rgba(140,59,46,.08)}
nav.primary a[aria-current=page]{color:var(--accent);font-weight:600}
main{display:block}
.hero{padding:64px 0 40px;text-align:center}
.hero .tagline{font-size:1.15rem;color:var(--soft);max-width:38rem;margin:14px auto 0}
.hero-img{margin-top:32px}.hero-img img{width:100%;max-width:860px;border-radius:14px;display:block;margin:0 auto}
.cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:26px}
.hero-split{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;align-items:center;text-align:left}
.hero-split .tagline{margin:14px 0 0}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{border-radius:var(--radius,14px);overflow:hidden;border:1px solid var(--line);background:var(--card)}
.hero-split .split-img img{width:100%;height:100%;min-height:280px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr;text-align:center}.hero-split .cta-row{justify-content:center}.hero-split .tagline{margin:14px auto 0}}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;min-height:44px}
.btn:hover{background:var(--accent-dark);color:#fff}
.btn.ghost{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
.strip{background:var(--ink);color:#f7f1e8;padding:12px 0;font-size:.95rem}
.strip .wrap{display:flex;gap:10px 24px;justify-content:center;flex-wrap:wrap;text-align:center}
.strip a{color:#f7f1e8}
.notice{background:#7a2f24;color:#fff;padding:12px 0;text-align:center;font-weight:600}
section.block{padding:calc(44px * var(--spacing-scale,1)) 0}
section.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.menu-cat{margin-bottom:34px}
.menu-cat h3{color:var(--accent);letter-spacing:.04em;text-transform:uppercase;font-size:.95rem;font-family:system-ui,sans-serif;font-weight:700;margin-bottom:14px;border-bottom:1px solid var(--line);padding-bottom:8px}
ul.items{list-style:none}
.item{display:flex;gap:16px;justify-content:space-between;align-items:baseline;padding:10px 0}
.item .nm{font-weight:600}
.item .ds{color:var(--soft);font-size:.95rem;margin-top:2px;max-width:34rem}
.item .pr{white-space:nowrap;color:var(--ink);font-variant-numeric:tabular-nums}
.dots{flex:1;border-bottom:1px dotted var(--line);transform:translateY(-4px);min-width:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius,10px) + 4px);padding:22px}
blockquote.t{font-size:1.05rem}
blockquote.t footer{margin-top:10px;color:var(--soft);font-size:.9rem;font-style:normal}
.faq dt{font-weight:600;margin-top:18px}
.faq dd{margin:6px 0 0;color:var(--soft)}
table.hours{border-collapse:collapse;width:100%;max-width:420px}
table.hours caption{text-align:left;font-weight:600;margin-bottom:8px}
table.hours th{text-align:left;font-weight:600;padding:6px 14px 6px 0}
table.hours td{padding:6px 0;color:var(--soft)}
table.hours tr[data-today] th,table.hours tr[data-today] td{color:var(--accent);font-weight:600}
.open-now{font-weight:700}.open-now.yes{color:#8fd0a5}.open-now.no{color:#f0b9ad}
.holiday{margin-top:14px;font-size:.95rem;color:var(--soft)}
article.post p{margin:0 0 1em}article.post h2,article.post h3{margin:1.4em 0 .5em}
article.post ul,article.post ol{margin:0 0 1em 1.4em}
article.post blockquote{border-left:3px solid var(--accent);padding-left:16px;color:var(--soft);margin:0 0 1em}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.4em 0 .5em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--accent);text-decoration:underline}
.post-meta{color:var(--soft);font-size:.9rem}
.post-list article{padding:22px 0;border-bottom:1px solid var(--line)}
.annbar{background:var(--accent);color:#fff;text-align:center;padding:9px 16px;font-size:.95rem}
.annbar a{color:#fff;text-decoration:underline}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:6px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
footer.site{background:var(--ink);color:#e9e0d2;padding:44px 0 30px;margin-top:56px}
footer.site a{color:#f2d9b8}
footer.site .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:28px}
footer.site h2{font-size:1.05rem;color:#fff;margin-bottom:10px}
footer.site table.hours td,footer.site table.hours th{color:#cfc4b2}
.credit{margin-top:30px;padding-top:16px;border-top:1px solid rgba(255,255,255,.15);font-size:.85rem;color:#a99e8c;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media(max-width:560px){.item{flex-wrap:wrap}.dots{display:none}.item .pr{width:100%}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#241d1a;--soft:#6b5f58;--cream:#faf6ef;--accent:#8c3b2e;--line:#e7ddd0}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--cream);color:var(--ink);line-height:1.65;font-size:16.5px}h1,.brand{font-family:Georgia,'Times New Roman',serif;font-weight:400;line-height:1.2}h1{font-size:clamp(2rem,5.5vw,3.2rem)}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:960px;margin:0 auto;padding:0 20px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;flex-wrap:wrap}nav.primary ul{display:flex;gap:6px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:10px 12px;text-decoration:none;color:var(--ink)}.hero{padding:64px 0 40px;text-align:center}`;

// tiny static "open now" script — reads a JSON data island; runs in the browser
// (renderer itself never touches a clock). <1KB.
const OPEN_NOW_JS = `(function(){var el=document.getElementById('open-now');var d=document.getElementById('hours-data');if(!el||!d)return;try{var cfg=JSON.parse(d.textContent);var now=new Date(new Date().toLocaleString('en-US',{timeZone:cfg.tz}));var ds=['sun','mon','tue','wed','thu','fri','sat'];var key=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');var day=(cfg.ex&&cfg.ex[key])?cfg.ex[key]:cfg.days[ds[now.getDay()]];var mins=now.getHours()*60+now.getMinutes();var open=false;if(day&&!day.closed)for(var i=0;i<day.iv.length;i++){var a=day.iv[i][0],b=day.iv[i][1];if(b<=a)b+=1440;if(mins>=a&&mins<b)open=true;if(b>1440&&mins+1440>=a&&mins+1440<b)open=true}var tr=document.querySelector('table.hours tr[data-day="'+ds[now.getDay()]+'"]');if(tr)tr.setAttribute('data-today','');el.textContent=open?'Open now':'Closed now';el.className='open-now '+(open?'yes':'no')}catch(e){el.textContent=''}})();`;

// ═════════ partials ═════════

function hoursData(c: SnapshotContent): string {
  const loc = loc0(c)!;
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const days: Record<string, { closed: boolean; iv: number[][] }> = {};
  for (const d of loc.hours) days[d.day] = { closed: !!d.closed, iv: (d.intervals || []).map((i) => [toMin(i.open), toMin(i.close)]) };
  const ex: Record<string, { closed: boolean; iv: number[][] }> = {};
  for (const e of loc.holiday_exceptions || []) ex[e.date] = { closed: !!e.closed, iv: (e.intervals || []).map((i) => [toMin(i.open), toMin(i.close)]) };
  return JSON.stringify({ tz: loc.timezone, days, ex });
}

function hoursTable(c: SnapshotContent, caption: string): string {
  const loc = loc0(c)!;
  const byDay = new Map(loc.hours.map((d) => [d.day, d]));
  const rows = ORDER.map((k) => {
    const d = byDay.get(k) as HoursDay | undefined;
    const val = !d || d.closed || !d.intervals?.length
      ? 'Closed'
      : d.intervals.map((i) => `${fmtTime(i.open)}–${fmtTime(i.close)}`).join(', ');
    return `<tr data-day="${k}"><th scope="row">${DAY_LABEL[k]}</th><td>${esc(val)}</td></tr>`;
  }).join('');
  const holidays = (loc.holiday_exceptions || []).map((e: HolidayException) => {
    const val = e.closed ? 'Closed' : (e.intervals || []).map((i) => `${fmtTime(i.open)}–${fmtTime(i.close)}`).join(', ');
    return `<li>${esc(e.label)} (${esc(e.date)}): ${esc(val)}</li>`;
  }).join('');
  return `<table class="hours"${pr("location.hours")}><caption>${esc(caption)}</caption><tbody>${rows}</tbody></table>` +
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

// ═════════ JSON-LD builders (schema.org — honest scope, no aggregateRating) ═════════

function ldRestaurant(c: SnapshotContent, site: SiteConfig): object {
  const l = loc0(c);   // may be null on a brand-new/empty draft — must not crash the render
  const spec = (l?.hours || []).filter((d) => !d.closed && d.intervals?.length).flatMap((d) =>
    d.intervals.map((i) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_SCHEMA[d.day], opens: i.open, closes: i.close })));
  const special = (l?.holiday_exceptions || []).map((e) => e.closed
    ? { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: '00:00', closes: '00:00' }
    : { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: e.intervals?.[0]?.open, closes: e.intervals?.[0]?.close });
  const o: any = {
    '@context': 'https://schema.org', '@type': 'Restaurant',
    name: c.identity.business_name, description: c.identity.description, url: site.baseUrl,
    telephone: l?.phone || c.identity.phone || undefined, email: c.identity.email || undefined,
    address: l ? { '@type': 'PostalAddress', streetAddress: [l.address_line1, l.address_line2].filter(Boolean).join(', '), addressLocality: l.city, addressRegion: l.region, postalCode: l.postal_code, addressCountry: l.country } : undefined,
    openingHoursSpecification: spec, specialOpeningHoursSpecification: special.length ? special : undefined,
    servesCuisine: undefined, menu: `${site.baseUrl}/menu/`,
    acceptsReservations: c.identity.booking_url || undefined,
    sameAs: Object.values(c.identity.social || {}).filter(Boolean),
  };
  return o;
}
const ldMenu = (c: SnapshotContent, site: SiteConfig) => ({
  '@context': 'https://schema.org', '@type': 'Menu', name: `${c.identity.business_name} Menu`, url: `${site.baseUrl}/menu/`,
  hasMenuSection: orderedCats(c).map((cat) => ({
    '@type': 'MenuSection', name: cat,
    hasMenuItem: bySort(c.offerings).filter((o) => o.category === cat).map((o) => ({ '@type': 'MenuItem', name: o.name, description: o.description || undefined, offers: o.price_text ? { '@type': 'Offer', price: o.price_text, priceCurrency: 'USD' } : undefined })),
  })),
});
const ldFaq = (c: SnapshotContent) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: bySort(c.faqs).map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
});
const ldCrumbs = (site: SiteConfig, trail: Array<[string, string]>) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site.baseUrl}${path}` })),
});
const ldSite = (c: SnapshotContent, site: SiteConfig) => ({ '@context': 'https://schema.org', '@type': 'WebSite', name: c.identity.business_name, url: site.baseUrl });

// ═════════ page shell ═════════

interface PageOpts { path: string; title: string; description: string; ld: object[]; ogImage?: string; active: string; body: string }

function shell(c: SnapshotContent, site: SiteConfig, cssPath: string, o: PageOpts, x: { announce?: string; icon?: string } = {}): string {
  const i = c.identity;
  const logo = c.settings?.logo || null;   // Phase V FD-N2: logo in the brand slot
  const nav: Array<[string, string, string]> = [
    ['/', 'Home', 'home'], ['/menu/', 'Menu', 'menu'], ['/about/', 'About', 'about'],
    ['/faq/', 'FAQ', 'faq'], ['/updates/', 'Updates', 'updates'], ['/contact/', 'Contact', 'contact'],
  ];
  for (const cp of (c.settings?.pages || [])) { if (!cp.hideNav) nav.push([`/${cp.slug}/`, cp.title, `page:${cp.slug}`]); }   // multi-page
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
${x.announce || ''}
${closedNotice}
<header class="site"><div class="wrap nav${c.settings?.nav_style === 'centered' ? ' centered' : ''}">
  <a class="brand" href="/">${logo?.variants?.w400 ? `<img src="${attr(logo.variants.w400)}" alt="" class="brandlogo">` : ''}${esc(i.business_name)}</a>
  <nav class="primary" aria-label="Main"><ul>${
    c.settings?.nav?.length
      ? renderNavList(c.settings.nav, o.path, esc, attr)
      : nav.map(([p, label, key]) => `<li><a href="${attr(p)}"${o.active === key ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`).join('')
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
<script id="hours-data" type="application/json">${loc0(c) ? hoursData(c).replaceAll('<', '\\u003c') : '{}'}</script>
<script>${OPEN_NOW_JS}</script>
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

function homeBody(c: SnapshotContent, site: SiteConfig, blocks: RenderedBlock[] = []): string {
  const i = c.identity;
  const hero = c.settings?.cover || bySort(c.offerings).find((o) => o.media)?.media || c.posts.find((p) => p.hero)?.hero || null;
  const featured = bySort(c.offerings).slice(0, 6);
  const tst = bySort(c.testimonials).slice(0, 3);
  const faqs = bySort(c.faqs).slice(0, 4);
  const { tel } = contactBits(c);
  const maps = mapsHref(c);
  const book = safeHref(i.booking_url || '');
  const order = safeHref(i.ordering_url || '');
  const heroText = `
  <h1${pr('identity.business_name')}>${esc(i.business_name)}</h1>
  ${i.tagline ? `<p class="tagline"${pr('identity.tagline')}>${esc(i.tagline)}</p>` : ''}
  <div class="cta-row">
    ${book ? `<a class="btn" href="${attr(book)}" rel="noopener">Reserve a table</a>` : ''}
    ${order ? `<a class="btn${book ? ' ghost' : ''}" href="${attr(order)}" rel="noopener">Order online</a>` : ''}
    ${!book && !order ? `<a class="btn" href="/menu/">See the menu</a>` : ''}
  </div>`;
  // G2 (DS-6 parity): split layout — the photo sits beside the welcome text in a
  // cream frame; a CROPPING presentation, so the focal point (DS-5) drives it.
  const useSplit = c.settings?.hero_layout === 'split' && !!hero;
  const focalStyle = hero?.focal ? ` style="object-position:${hero.focal.x}% ${hero.focal.y}%"` : '';
  const splitImg = useSplit && hero?.variants
    ? `<div class="split-img"><img src="${attr(hero.variants.w800 || hero.variants.w400 || '')}"${hero.variants.w400 && hero.variants.w1600 ? ` srcset="${attr(hero.variants.w400)} 400w, ${attr(hero.variants.w800 || hero.variants.w1600)} 800w, ${attr(hero.variants.w1600)} 1600w" sizes="(max-width:760px) 100vw, 45vw"` : ''} alt="${attr(hero.alt)}" fetchpriority="high"${focalStyle}></div>`
    : '';
  const heroOff = new Set(c.settings?.sections?.hidden || []).has('hero');   // hero is removable from the canvas
  return `${heroOff ? '' : `
<section class="hero wrap">${useSplit ? `<div class="hero-split"><div>${heroText}</div>${splitImg}</div>` : `${heroText}
  ${hero ? `<div class="hero-img">${img(hero, '(max-width: 900px) 100vw, 860px', false)}</div>` : ''}`}
</section>`}
<div class="strip"><div class="wrap">
  <span id="open-now" class="open-now" aria-live="polite"></span>
  ${loc0(c) ? `<span${pr('location.address')}>${esc(loc0(c)!.address_line1)}, ${esc(loc0(c)!.city)}</span>` : ''}
  ${tel ? `<span>${tel}</span>` : ''}
  ${maps ? `<span><a href="${attr(maps)}" rel="noopener">Get directions</a></span>` : ''}
</div></div>
${(() => {
  const parts: Record<string, string> = {
    about: `<section class="block wrap"><h2>About us</h2><p${pr("identity.description")}>${esc(i.description)}</p></section>`,
    offerings: featured.length ? `<section class="block alt"><div class="wrap"><h2>From the menu</h2><ul class="items">${featured.map((o) => `
  <li class="item"${prE('offering', o.id)}><div><div class="nm">${esc(o.name)}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}</div><div class="dots" aria-hidden="true"></div>${o.price_text ? `<div class="pr">${esc(o.price_text)}</div>` : ''}</li>`).join('')}
</ul><p style="margin-top:18px"><a class="btn ghost" href="/menu/">Full menu</a></p></div></section>` : '',
    testimonials: tst.length ? `<section class="block wrap"><h2>What guests say</h2><div class="cards">${tst.map((t) => `
  <div class="card"${prE('testimonial', t.id)}><blockquote class="t"><p>“${esc(t.quote)}”</p><footer>— ${esc(t.author)}${t.source ? `, ${esc(t.source)}` : ''}</footer></blockquote></div>`).join('')}
</div></section>` : '',
    faqs: faqs.length ? `<section class="block alt"><div class="wrap"><h2>Good to know</h2><dl class="faq">${faqs.map((f) =>
  `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd class="prose">${renderMarkdown(f.answer)}</dd>`).join('')}
</dl><p style="margin-top:18px"><a href="/faq/">All questions →</a></p></div></section>` : '',
  };
  for (const b of blocks) parts[b.key] = b.html;   // Phase T-BLOCKS
  return homeSectionOrder(c, blocks.map((b) => b.key)).map((k) => parts[k] || '').join('');
})()}`;
}

function menuBody(c: SnapshotContent): string {
  const cats = orderedCats(c);
  return `<section class="block wrap"><h1>Menu</h1>
${cats.map((cat) => `<div class="menu-cat"><h3>${esc(cat)}</h3><ul class="items">${bySort(c.offerings).filter((o) => o.category === cat).map((o) => `
  <li class="item"${prE('offering', o.id)}><div><div class="nm">${esc(o.name)}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${o.media ? img(o.media, '(max-width:560px) 100vw, 400px') : ''}</div><div class="dots" aria-hidden="true"></div>${o.price_text ? `<div class="pr">${esc(o.price_text)}</div>` : ''}</li>`).join('')}
</ul></div>`).join('')}
${cats.length === 0 ? '<p>Our menu is being updated — check back soon.</p>' : ''}</section>`;
}

function aboutBody(c: SnapshotContent): string {
  const i = c.identity;
  return `<section class="block wrap"><h1>About ${esc(i.business_name)}</h1>
<p>${esc(i.description)}</p>
${i.story ? `<div class="prose">${renderMarkdown(i.story)}</div>` : ''}
${i.service_area ? `<h2>Where to find us</h2><p>${esc(i.service_area)}</p>` : ''}</section>`;
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
<p><label for="f-name">Your name</label><br><input id="f-name" name="name" required maxlength="120" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px"></p>
<p><label for="f-email">Email or phone</label><br><input id="f-email" name="contact" required maxlength="254" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px"></p>
<p><label for="f-msg">Message</label><br><textarea id="f-msg" name="message" required maxlength="2000" rows="5" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px"></textarea></p>
<p style="font-size:.85rem;color:var(--soft)">Please don’t include sensitive personal, financial, or medical information.</p>
<button class="btn" type="submit">Send</button></form>`
    : (mail ? `<p style="margin-top:18px"><a class="btn" href="mailto:${attr(i.email)}">Email us</a></p>` : '');
  return `<section class="block wrap"><h1>Contact &amp; hours</h1>
<div class="cards">
  <div class="card"><h2>Visit or call</h2>${addr ? `<address>${addr}</address>` : ''}<p>${[tel, mail].filter(Boolean).join('<br>')}</p>${maps ? `<p><a href="${attr(maps)}" rel="noopener">Get directions</a></p>` : ''}</div>
  <div class="card">${loc0(c) ? hoursTable(c, 'Hours') : ''}</div>
</div>${form}</section>`;
}

function postDate(iso: string): string {
  const d = new Date(iso);
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
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
${p.hero ? `<div style="margin:20px 0">${img(p.hero, '(max-width: 900px) 100vw, 860px', false)}</div>` : ''}
${renderMarkdown(p.body_md)}
${postTagsHtml(normalizeTags(p.tags), esc)}</article>
<p style="margin-top:28px"><a href="/updates/">← All updates</a></p></section>`;
}

// ═════════ the render function (the contract) ═════════

export const render: RenderFn = (snapshot: Snapshot, manifest: TemplateManifest, site: SiteConfig): FileMap => {
  const c = normalizeSnapshotContent(snapshot.content);
  const i = c.identity;
  const files: FileMap = {};

  // Append the dropdown-nav CSS only when the owner set a custom nav → sites without
  // one keep the exact same stylesheet + hash (byte-identical).
  const effCss = CSS + (c.settings?.nav?.length ? '\n' + NAV_DROPDOWN_CSS : '');
  const cssPath = `/assets/site-${fnv(effCss)}.css`;
  files[`assets/site-${fnv(effCss)}.css`] = effCss;

  const siteTitle = i.seo_title || i.business_name;
  const siteDesc = i.seo_description || i.description;
  // Phase V FD-N3: the owner's chosen share image wins; then offerings/posts; then the logo
  const ogImg = c.settings?.og_image?.variants?.w1600
    || (bySort(c.offerings).find((o) => o.media)?.media?.variants?.w1600)
    || (c.posts.find((p) => p.hero)?.hero?.variants?.w1600)
    || c.settings?.logo?.variants?.w1600;

  // Phase V FD-N4: announcement bar — deterministic expiry against snapshot time
  const ann = c.settings?.announcement;
  const annLive = ann && ann.text && (!ann.expires_at || String(ann.expires_at) > snapshot.created_at);
  const announce = annLive
    ? `<div class="annbar" role="status">${(ann!.url && safeHref(ann!.url)) ? `<a href="${attr(safeHref(ann!.url)!)}">${esc(ann!.text)}</a>` : esc(ann!.text)}</div>` : '';
  // Phase V FD-N2: the logo becomes the favicon when present
  const icon = c.settings?.logo?.variants?.w400 || '';
  const extras = { announce, icon };

  // Phase SD: "Show this page on Google?" — noindex + sitemap exclusion per page,
  // and per-page search headline/description overrides. Plain choices, our plumbing.
  const noidx = new Set(c.settings?.pages_noindex || []);
  const pseo = c.settings?.page_seo || {};
  const seoOv = (key: string, title: string, description: string) => ({
    title: (pseo[key]?.title || '').trim() || title,
    description: (pseo[key]?.description || '').trim() || description,
  });
  const markNoindex = (file: string) => { files[file] = (files[file] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">'); };


  const page = (path: string, opts: Omit<Parameters<typeof shell>[3], 'path'>) => {
    const html = shell(c, site, cssPath, { path, ...opts }, extras);
    const file = path === '/' ? 'index.html' : `${path.replace(/^\/|\/$/g, '')}/index.html`;
    files[file] = html;
  };

  const blocks = renderSiteBlocks(c.settings?.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at });   // Phase T-BLOCKS (+ FB form blocks + BK booking + EXP window)
  // Phase RV: fold the HONEST reviews schema (AggregateRating + Review, approved rows
  // only) onto the ONE business node — home only, where the reviews_wall is visible.
  const rSchema = reviewsSchema(c.settings?.blocks, snapshot.created_at);
  const ldHomeBiz = rSchema ? { ...ldRestaurant(c, site), ...rSchema } : ldRestaurant(c, site);
  page('/', { title: siteTitle, description: siteDesc, ld: [ldHomeBiz, ldSite(c, site), ...blocks.flatMap((b) => (b.ld ? [b.ld] : []))], ogImage: ogImg, active: 'home', body: homeBody(c, site, blocks) });
  page('/menu/', { ...seoOv('offerings', `Menu — ${i.business_name}`, `The menu at ${i.business_name}.`), ld: [ldMenu(c, site)], ogImage: ogImg, active: 'menu', body: menuBody(c) });
  if (noidx.has('offerings')) markNoindex('menu/index.html');
  page('/about/', { ...seoOv('about', `About — ${i.business_name}`, siteDesc), ld: [ldCrumbs(site, [[i.business_name, '/'], ['About', '/about/']])], active: 'about', body: aboutBody(c) });
  if (noidx.has('about')) markNoindex('about/index.html');
  page('/faq/', { ...seoOv('faq', `FAQ — ${i.business_name}`, `Answers to common questions about ${i.business_name}.`), ld: c.faqs.length ? [ldFaq(c)] : [], active: 'faq', body: faqBody(c) });
  if (noidx.has('faq')) markNoindex('faq/index.html');
  page('/contact/', { ...seoOv('contact', `Contact & Hours — ${i.business_name}`, `Address, phone, and opening hours for ${i.business_name}.`), ld: [ldRestaurant(c, site)], active: 'contact', body: contactBody(c, site) });
  if (noidx.has('contact')) markNoindex('contact/index.html');
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

  // Multi-page: the owner's own pages, rendered with the SAME shell/nav/footer.
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

  // Phase V FD-N1: the form's landing page — calm confirmation, noindex, not in nav/sitemap
  page('/thanks/', {
    title: `Thank you — ${i.business_name}`, description: `Your message to ${i.business_name} was sent.`, ld: [], active: 'contact',
    body: `<section class="hero wrap"><h1>Thank you — your message was sent.</h1><p class="tagline">${esc(i.business_name)} will get back to you soon.</p><div class="cta-row"><a class="btn" href="/">Back to the site</a></div></section>`,
  });
  files['thanks/index.html'] = (files['thanks/index.html'] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">');

  // Phase Q (FD-M3): the generated legal foundation — facts-true, the owner never writes legal HTML
  page('/privacy/', { title: `Privacy — ${i.business_name}`, description: `How ${i.business_name} handles your information.`, ld: [], active: '', body: privacyBody(c, snapshot.created_at.slice(0, 10), !!site.formEndpoint) });
  page('/accessibility/', { title: `Accessibility — ${i.business_name}`, description: `${i.business_name}’s accessibility commitment.`, ld: [], active: '', body: accessibilityBody(c) });

  // Phase SEARCH: static, privacy-safe on-site search (zero external origins /
  // trackers) — the site's own content index + a first-party client-filtered
  // results page. Kept out of the sitemap + noindexed (thin utility page).
  files['search-index.json'] = searchIndexJson(c, { offeringPath: '/menu/', offeringLabel: 'Menu' });
  page('/search/', { title: `Search — ${i.business_name}`, description: `Search ${i.business_name}.`, ld: [], active: '', body: searchPageBody(esc, { offeringPath: '/menu/', offeringLabel: 'Menu' }) + searchClientScript() });
  markNoindex('search/index.html');

  // 404 (styled, navigable)
  files['404.html'] = shell(c, site, cssPath, {
    path: '/404.html', title: `Page not found — ${i.business_name}`, description: siteDesc, ld: [], active: '',
    body: `<section class="hero wrap"><h1>That page isn’t here</h1><p class="tagline">The page you’re after may have moved.</p><div class="cta-row"><a class="btn" href="/">Back to ${esc(i.business_name)}</a><a class="btn ghost" href="/menu/">See the menu</a></div></section>`,
  }, extras);

  // favicon: deterministic SVG from the first letter
  const letter = (i.business_name || 'P').trim()[0]?.toUpperCase() || 'P';
  files['favicon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#8c3b2e"/><text x="32" y="44" font-family="Georgia,serif" font-size="36" fill="#faf6ef" text-anchor="middle">${esc(letter)}</text></svg>`;

  // sitemap (lastmod = snapshot time — the only clock the renderer may read)
  const lastmod = snapshot.created_at.slice(0, 10);
  const KEY_PATHS: Array<[string, string]> = [['offerings', '/menu/'], ['about', '/about/'], ['faq', '/faq/'], ['contact', '/contact/'], ['updates', '/updates/']];
  const urls: Array<{ loc: string; lastmod: string }> = [{ loc: '/', lastmod }, ...KEY_PATHS.filter(([k]) => !noidx.has(k)).map(([, p]) => ({ loc: p, lastmod })), { loc: '/privacy/', lastmod }, { loc: '/accessibility/', lastmod }, ...c.posts.filter((p) => !p.noindex).map((p) => ({ loc: `/updates/${p.slug}/`, lastmod: String(p.published_at || snapshot.created_at).slice(0, 10) })), ...(c.settings?.pages || []).filter((cp) => !noidx.has(`page:${cp.slug}`)).map((cp) => ({ loc: `/${cp.slug}/`, lastmod }))];
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(site.baseUrl + u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  files['robots.txt'] = `User-agent: *\nAllow: /\n\nSitemap: ${site.baseUrl}/sitemap.xml\n`;
  // RSS feed for /updates/ — subscribers + SEO
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

  // redirects (301 map) + immutable cache headers for hashed assets
  const redirects = (c.redirects || []).map((r) => `${r.from_path}  ${r.to_path}  301`).join('\n');
  files['_redirects'] = redirects ? redirects + '\n' : '';
  files['_headers'] = `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n`;

  return files;
};

export default render;
