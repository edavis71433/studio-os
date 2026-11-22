// ── The eight built-in templates, drawn once (builder list item 103) ──────────
// Every built-in template is this one drawing with its own look. This file holds the
// page shell (head, header, menu, footer), the home page's section order, every page
// the site carries, the helpers (photos, hours, contact lines, JSON-LD) and the site
// files (sitemap, feed, robots, forwards). A template's own file holds only what makes
// it itself: its stylesheet, its first-paint rules, its favicon, its post cover frame,
// and the few named choices in TemplateLook below. So a change to how sites draw is
// made here, once, and every template has it. Before item 103 each template carried
// its own copy of all of this, and the copies had started to drift.
//
// The same laws as ever: snapshot in, FileMap out; no network, no clock (snapshot
// timestamps only), no randomness, no JavaScript beyond the first-party search, the
// tag filter and the Open now line. Every interpolation is escaped, markdown goes
// through the sanitizer, links through safeHref. The site's kind of business picks
// the words, paths and schema.org types (lib/industry_vocab.ts).
import { esc, attr, safeHref, renderMarkdown } from './markdown.ts';
import { normalizeSnapshotContent } from './render_types.ts';
import { vocabFor, type IndustryVocab } from './industry_vocab.ts';
import { renderSiteBlocks, reviewsSchema, BLOCK_JS, type RenderedBlock } from './site_blocks.ts';
import { renderNavList, NAV_DROPDOWN_CSS } from './site_nav.ts';
import { seoHead } from './seo_emit.ts';
import { privacyBody, accessibilityBody, legalFooterLinks, notSentInner } from './legal_pages.ts';
import { searchBoxHtml, searchPageBody, searchClientScript, searchIndexJson, normalizeTags } from './search_index.ts';
import { postListBody, postPageBody, postLd, postCategories, categoryPath, postPageCount, postListPath, POST_CSS, type PostDraw } from './post_render.ts';
import { contactPlace, footerPlace, ldPlaces, PLACE_CSS } from './place_render.ts';
import { SHELL_CSS, SHELL_CRITICAL, SHELL_NOSCRIPT, MENU_JS, menuButtonHtml } from './site_shell.ts';

/** The site's script file: the phone menu (lib/site_shell.ts) and the gallery and carousel (lib/site_blocks.ts). */
export const SITE_JS = `${MENU_JS}\n${BLOCK_JS}`;
export const SITE_JS_PATH = `/assets/site-${fnv(SITE_JS)}.js`;
import type { PostCategory } from './blog.ts';
import type { FileMap, HolidayException, HoursDay, LocationContent, MediaRef, RenderFn, Snapshot, SnapshotContent, SiteConfig } from './render_types.ts';

type Offering = SnapshotContent['offerings'][number];

/** What makes a template itself. Everything not named here is drawn the same for all eight. */
export interface TemplateLook {
  /** The template's stylesheet: its own rules, with BLOCK_CSS and SEARCH_CSS inside it. */
  css: string;
  /** The first-paint rules every page carries in its head. */
  critical: string;
  /** The favicon around the business name's first letter (already escaped). */
  favicon: (letter: string) => string;
  /** The frame around an update's cover photo. */
  postFrame: string;
  /** How offerings draw: cards (the default), name-and-price lines with a dotted leader
   *  (Atelier), or a printed menu (Restaurant Classic). */
  offerings?: 'cards' | 'lines' | 'menu';
  /** Harbor: the welcome text sits beside an "At a glance" panel, the strip under it lists
   *  the email too, and each simple page's heading band holds its own inner wrap. */
  hero?: 'stacked' | 'panel';
  /** The words a template says its own way. */
  words?: Partial<Words>;
  /** Restaurant Classic: always a restaurant, whatever kind of business the site says. */
  vocab?: IndustryVocab;
  /** Restaurant Classic's own older choices, kept so its sites draw exactly as before. */
  classic?: Classic;
}

/** Restaurant Classic was the first template; these are the places it still differs. */
export interface Classic {
  /** The welcome section shows no service-area line above the name, and no Contact us
   *  button beside the booking or ordering one. */
  plainWelcome: true;
  /** The welcome photo's sizes hint. */
  heroPhotoSizes: string;
  /** The contact form styles its fields inline, with a line break after each label. */
  inlineForm: true;
  /** The business JSON-LD names acceptsReservations and leaves out areaServed. */
  reservations: true;
  /** Site files: robots.txt asks no page to be skipped, a _headers file of its own, no
   *  meta-refresh page for a forward, sitemap lines indented, and this letter on the
   *  favicon of a site with no name yet. */
  files: { headers: string; initial: string };
}

/** The words a template can say its own way, with Business Classic's as the default. */
export interface Words {
  /** The home page's reviews heading. */
  reviews: string;
  /** About page: the heading over the service area. */
  where: string;
  /** Contact page: the first card's heading. */
  reach: string;
  /** Contact page: its description for search engines. */
  contactDescription: (name: string) => string;
  /** The offerings page's description for search engines. */
  offeringsDescription: (label: string, name: string) => string;
  /** The button to the offerings page when there is no booking or ordering link. */
  seeOfferings: (label: string) => string;
}
const WORDS: Words = {
  reviews: 'What customers say',
  where: 'Where we work',
  reach: 'Reach us',
  contactDescription: (name) => `Address, phone, and hours for ${name}.`,
  offeringsDescription: (label, name) => `${label} from ${name}.`,
  seeOfferings: (label) => `See our ${label.toLowerCase()}`,
};

// ═════════ helpers ═════════

const loc0 = (c: SnapshotContent): LocationContent | null => c.locations?.[0] ?? null;
/** Builder list item 334: the business goes to its customers, so no street address and no
 *  directions are drawn; the areas it serves (identity.service_area) stand where they were. */
const goesOut = (c: SnapshotContent): boolean => loc0(c)?.goes_to_customers === true;
/** "We come to you" and the areas served, as one block of lines ('' when there's nothing to say). */
function areaBlock(c: SnapshotContent, heading: string): string {
  const area = (c.identity.service_area || '').trim();
  return goesOut(c) && area ? `<p class="area"${pr('identity.service_area')}><strong>${esc(heading)}</strong><br>${esc(area)}</p>` : '';
}
/** Region marker (reconciliation R3): a stable attribute tying a drawn region to the content
 *  it shows, so the builder can outline it. Deterministic and invisible. */
const pr = (region: string): string => ` data-pr="${attr(region)}"`;
/** Entity region marker: kind + row id, e.g. data-pr="offering" data-pr-id="…". */
const prE = (kind: string, id: string): string => ` data-pr="${attr(kind)}" data-pr-id="${attr(id)}"`;

/** Category names in the site's chosen order, then in the order they first appear. */
function orderedCats(c: SnapshotContent): string[] {
  const encounter: string[] = [];
  for (const o of bySort(c.offerings)) if (!encounter.includes(o.category)) encounter.push(o.category);
  const chosen = (c.settings?.category_order || []).filter((x) => encounter.includes(x));
  return [...chosen, ...encounter.filter((x) => !chosen.includes(x))];
}

/** A deterministic content hash (fnv1a-64) for the stylesheet's file name. */
export function fnv(s: string): string {
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
function img(m: MediaRef | null | undefined, sizes: string, lazy = true, cls = '', focal = false): string {
  if (!m || !m.variants) return '';
  // item 293: the welcome photo is cropped to a shape, so the focal point the owner set keeps its place
  const fx = Number(m.focal?.x), fy = Number(m.focal?.y);
  const pos = focal && m.focal && Number.isFinite(fx) && Number.isFinite(fy) ? ` style="object-position:${Math.min(100, Math.max(0, fx))}% ${Math.min(100, Math.max(0, fy))}%"` : '';
  const v = m.variants;
  const order = ['w400', 'w800', 'w1600'].filter((k) => v[k]);
  const srcset = order.map((k) => `${attr(v[k])} ${k.slice(1)}w`).join(', ');
  const src = v.w800 || v.w400 || Object.values(v)[0];
  if (!src) return '';
  const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  const imgTag = `<img src="${attr(src)}"${srcset ? ` srcset="${srcset}" sizes="${attr(sizes)}"` : ''} alt="${attr(m.alt)}"${dims}${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'}${cls ? ` class="${cls}"` : ''}${pos}>`;
  if (!srcset) return imgTag;   // single variant: nothing to choose between formats
  // <picture>: AVIF first (browser picks the first it supports), WebP next, the
  // <img> is the ultimate fallback. Self-hosted variants only — zero external origins.
  const avifSrcset = order.map((k) => `${attr(avifOf(v[k]))} ${k.slice(1)}w`).join(', ');
  const sz = ` sizes="${attr(sizes)}"`;
  return `<picture><source type="image/avif" srcset="${avifSrcset}"${sz}><source type="image/webp" srcset="${srcset}"${sz}>${imgTag}</picture>`;
}

// The tiny static Open now script: it reads a JSON data island in the browser (the
// renderer itself never touches a clock). Under 1 KB.
const OPEN_NOW_JS = `(function(){var el=document.getElementById('open-now');var d=document.getElementById('hours-data');if(!el||!d)return;try{var cfg=JSON.parse(d.textContent);if(!cfg.days||!Object.keys(cfg.days).length)return;var now=new Date(new Date().toLocaleString('en-US',{timeZone:cfg.tz}));var ds=['sun','mon','tue','wed','thu','fri','sat'];var key=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');var day=(cfg.ex&&cfg.ex[key])?cfg.ex[key]:cfg.days[ds[now.getDay()]];var mins=now.getHours()*60+now.getMinutes();var open=false;if(day&&!day.closed)for(var i=0;i<day.iv.length;i++){var a=day.iv[i][0],b=day.iv[i][1];if(b<=a)b+=1440;if(mins>=a&&mins<b)open=true;if(b>1440&&mins+1440>=a&&mins+1440<b)open=true}var tr=document.querySelector('table.hours tr[data-day="'+ds[now.getDay()]+'"]');if(tr)tr.setAttribute('data-today','');el.textContent=open?'Open now':'Closed now';el.className='open-now '+(open?'yes':'no')}catch(e){el.textContent=''}})();`;

function hoursData(c: SnapshotContent): string {
  const loc = loc0(c)!;
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const days: Record<string, { closed: boolean; iv: number[][] }> = {};
  for (const d of loc.hours) days[d.day] = { closed: !!d.closed, iv: (d.intervals || []).map((i) => [toMin(i.open), toMin(i.close)]) };
  const ex: Record<string, { closed: boolean; iv: number[][] }> = {};
  for (const e of loc.holiday_exceptions || []) ex[e.date] = { closed: !!e.closed, iv: (e.intervals || []).map((i) => [toMin(i.open), toMin(i.close)]) };
  return JSON.stringify({ tz: loc.timezone, days, ex });
}

// Item 303: a holiday's date in words, the way posts and events print theirs: "Thu Nov 26".
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1) return String(ymd);
  return `${DAYS_SHORT[d.getUTCDay()]} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

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
    return `<li>${esc(e.label)}, <time datetime="${attr(e.date)}">${esc(dayDate(e.date))}</time>: ${esc(val)}</li>`;
  }).join('');
  return `<table class="hours"${pr('location.hours')}><caption>${esc(caption)}</caption><tbody>${rows}</tbody></table>` +
    (holidays ? `<div class="holiday"><strong>Holiday hours</strong><ul>${holidays}</ul></div>` : '');
}

function contactBits(c: SnapshotContent): { addr: string; tel: string; mail: string } {
  const l = loc0(c); const i = c.identity;
  const addr = l && !goesOut(c) ? [l.address_line1, l.address_line2, `${l.city}, ${l.region} ${l.postal_code}`].filter(Boolean).map(esc).join('<br>') : '';
  const phone = (l?.phone || i.phone || '').trim();
  const tel = phone ? `<a href="tel:${attr(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a>` : '';
  const mail = i.email ? `<a href="mailto:${attr(i.email)}">${esc(i.email)}</a>` : '';
  return { addr, tel, mail };
}

function mapsHref(c: SnapshotContent): string | null {
  const l = loc0(c); if (!l || goesOut(c)) return null;
  const q = encodeURIComponent(`${c.identity.business_name}, ${l.address_line1}, ${l.city}, ${l.region} ${l.postal_code}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ═════════ JSON-LD (industry-correct: the business's own schema.org type) ═════════

function ldBusiness(c: SnapshotContent, site: SiteConfig, v: IndustryVocab, reservations: boolean): object {
  const l = loc0(c);   // may be null on a brand-new/empty draft — must not crash the render
  const spec = (l?.hours || []).filter((d) => !d.closed && d.intervals?.length).flatMap((d) =>
    d.intervals.map((i) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_LABEL[d.day], opens: i.open, closes: i.close })));
  const special = (l?.holiday_exceptions || []).map((e) => e.closed
    ? { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: '00:00', closes: '00:00' }
    : { '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: e.intervals?.[0]?.open, closes: e.intervals?.[0]?.close });
  return {
    '@context': 'https://schema.org', '@type': v.schemaType,
    name: c.identity.business_name, description: c.identity.short_description || c.identity.description, url: site.baseUrl,
    telephone: l?.phone || c.identity.phone || undefined, email: c.identity.email || undefined,
    // item 334: a business that goes to its customers shows no street; its town and state, when kept, still place it
    address: l && !goesOut(c) ? { '@type': 'PostalAddress', streetAddress: [l.address_line1, l.address_line2].filter(Boolean).join(', '), addressLocality: l.city, addressRegion: l.region, postalCode: l.postal_code, addressCountry: l.country }
      : l && (l.city || l.region) ? { '@type': 'PostalAddress', addressLocality: l.city || undefined, addressRegion: l.region || undefined, addressCountry: l.country } : undefined,
    openingHoursSpecification: spec, specialOpeningHoursSpecification: special.length ? special : undefined,
    areaServed: reservations ? undefined : c.identity.service_area || undefined,
    menu: v.isMenu ? `${site.baseUrl}${v.offeringPath}` : undefined,
    acceptsReservations: reservations ? c.identity.booking_url || undefined : undefined,
    sameAs: Object.values(c.identity.social || {}).filter(Boolean),
  };
}

/** Offerings schema: Menu family for food; ItemList of the industry's item type otherwise. */
function ldOfferings(c: SnapshotContent, site: SiteConfig, v: IndustryVocab): object {
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

// ═════════ the page shell ═════════

interface PageOpts { path: string; title: string; description: string; ld: object[]; ogImage?: string; shareTitle?: string; shareDescription?: string; shareImage?: string; active: string; body: string; ogType?: 'article'; published?: string; feed?: boolean }
interface Extras { announce: string; icon: string; nav: Array<[string, string, string]>; tokens: Record<string, string> }

function shell(look: TemplateLook, c: SnapshotContent, site: SiteConfig, cssPath: string, o: PageOpts, x: Extras, jsPath = SITE_JS_PATH): string {
  const i = c.identity;
  const logo = c.settings?.logo || null;   // the logo sits in the brand slot
  const { addr, tel, mail } = contactBits(c);
  const social = Object.entries(i.social || {}).map(([k, v]) => {
    const href = safeHref(v); if (!href) return '';
    const label = k === 'x' ? 'X' : k === 'google_maps' ? 'Google Maps' : k[0].toUpperCase() + k.slice(1);
    return `<a href="${attr(href)}" rel="noopener">${esc(label)}</a>`;
  }).filter(Boolean).join(' · ');
  const closedNotice = loc0(c)?.temporarily_closed
    ? `<div class="notice" role="status">${esc(loc0(c)!.temporarily_closed_note || 'We are temporarily closed. See you soon.')}</div>` : '';
  const credit = site.brand?.credit ? `<span>${esc(site.brand.credit)}</span>` : '';
  // Item 296: the header shows the logo and the name, the logo alone (the name stays as its alt text,
  // so a screen reader still hears it), or the name alone; the logo's height is the owner's choice.
  const hasLogo = !!logo?.variants?.w400;
  const brandMode = hasLogo && x.tokens.header_brand === 'logo' ? 'logo' : x.tokens.header_brand === 'name' ? 'name' : 'both';
  const logoH = /^\d{2}$/.test(x.tokens.logo_height || '') ? Number(x.tokens.logo_height) : 0;
  const logoImg = hasLogo && brandMode !== 'name'
    ? `<img src="${attr(logo!.variants!.w400)}" alt="${brandMode === 'logo' ? attr(i.business_name) : ''}" class="brandlogo"${logo!.width && logo!.height ? ` width="${logo!.width}" height="${logo!.height}"` : ''}>` : '';
  const brand = `<a class="brand${brandMode === 'logo' ? ' brand-logo-only' : ''}" href="/"${logoH ? ` style="--logo-h:${logoH}px"` : ''}>${logoImg}${brandMode === 'logo' ? '' : esc(i.business_name)}</a>`;

  return `${seoHead(o, site, c, x, look.critical + SHELL_CRITICAL, cssPath).replace('</head>', `${SHELL_NOSCRIPT}\n</head>`)}
<body>
<a class="skip" href="#main">Skip to main content</a>
${x.announce}
${closedNotice}
<header class="site"><div class="wrap nav${c.settings?.nav_style === 'centered' ? ' centered' : ''}">
  ${brand}
  ${menuButtonHtml()}
  <div class="site-menu" id="site-menu"><nav class="primary" aria-label="Main"><ul>${
    c.settings?.nav?.length
      ? renderNavList(c.settings.nav, o.path, esc, attr)
      : x.nav.map(([p, label, key]) => `<li><a href="${attr(p)}"${o.active === key ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`).join('')
  }</ul></nav>
  ${x.tokens.site_search === 'off' ? '' : searchBoxHtml()}</div>
</div></header>
<main id="main">
${o.body}
</main>
<footer class="site"><div class="wrap">
  <div class="cols">
    <div><h2>${esc(i.business_name)}</h2>${addr ? `<address>${addr}</address>` : ''}${areaBlock(c, 'We come to you')}<p>${[tel, mail].filter(Boolean).join('<br>')}</p>${footerPlace(c)}${(c.settings?.footer?.social !== false) && social ? `<p>${social}</p>` : ''}</div>
    <div>${(c.settings?.footer?.hours !== false) && loc0(c) ? hoursTable(c, 'Hours') : ''}</div>
  </div>
  <div class="credit"><span>© ${esc(i.business_name)}</span><span>${legalFooterLinks()}</span>${credit}</div>
</div></footer>
${o.body.includes('id="open-now"') ? `<script id="hours-data" type="application/json">${loc0(c) ? hoursData(c).replaceAll('<', '\\u003c') : '{}'}</script>
<script>${OPEN_NOW_JS}</script>
` : ''}<script src="${attr(jsPath)}" defer></script>
</body>
</html>`;
}

/** Item 308: a preload for the first photo on a page that has no eager one, from its own srcset. Pure. */
export function firstPhotoPreload(body: string): string {
  if (body.includes('fetchpriority="high"')) return '';
  const m = /<img src="([^"]+)"(?: srcset="([^"]*)" sizes="([^"]*)")?[^>]*\sloading="lazy"/.exec(body);
  if (!m) return '';
  return `<link rel="preload" as="image" href="${m[1]}"${m[2] ? ` imagesrcset="${m[2]}" imagesizes="${m[3]}"` : ''} fetchpriority="high">`;
}

/** A simple page's heading band: the thanks, not-sent, 404 and owner's pages. */
const band = (look: TemplateLook, inner: string): string =>
  look.hero === 'panel' ? `<section class="hero"><div class="wrap">${inner}</div></section>` : `<section class="hero wrap">${inner}</section>`;

// ═════════ offerings, in the template's own presentation ═════════

/** Atelier's line: the name, a dotted leader and the price, the description under it. */
function offeringLine(o: Offering, withImg = false): string {
  return `<div class="svc"${prE('offering', o.id)}><div class="svc-line"><span class="nm">${esc(o.name)}</span>${o.price_text ? `<span class="lead" aria-hidden="true"></span><span class="pr">${esc(o.price_text)}</span>` : ''}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${withImg && o.media ? img(o.media, '(max-width:640px) 100vw, 420px') : ''}</div>`;
}

/** One offering, as the home page (photo false) or the offerings page (photo true) shows it. */
function offeringItem(look: TemplateLook, o: Offering, photo: boolean): string {
  if (look.offerings === 'lines') return offeringLine(o, photo);
  if (look.offerings === 'menu') {
    return `<li class="item"${prE('offering', o.id)}><div><div class="nm">${esc(o.name)}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${photo && o.media ? img(o.media, '(max-width:560px) 100vw, 400px') : ''}</div><div class="dots" aria-hidden="true"></div>${o.price_text ? `<div class="pr">${esc(o.price_text)}</div>` : ''}</li>`;
  }
  return `<div class="svc"${prE('offering', o.id)}><div class="nm">${esc(o.name)}</div>${o.description ? `<div class="ds">${esc(o.description)}</div>` : ''}${photo && o.media ? img(o.media, '(max-width:640px) 100vw, 320px') : ''}${o.price_text ? `<div class="pr">${esc(o.price_text)}</div>` : ''}</div>`;
}

/** The home page's offerings section, inside its band. */
function featuredOfferings(look: TemplateLook, featured: Offering[], v: IndustryVocab): string {
  const items = featured.map((o) => `
  ${offeringItem(look, o, false)}`).join('');
  if (look.offerings === 'menu') return `<h2>From the menu</h2><ul class="items">${items}
</ul><p style="margin-top:18px"><a class="btn ghost" href="${attr(v.offeringPath)}">Full menu</a></p>`;
  return `<h2>${esc(v.offeringLabel)}</h2><div class="svc-grid">${items}
</div><p style="margin-top:${look.offerings === 'lines' ? 26 : 22}px"><a class="btn ghost" href="${attr(v.offeringPath)}">All ${esc(v.offeringLabel.toLowerCase())}</a></p>`;
}

function offeringsBody(look: TemplateLook, c: SnapshotContent, v: IndustryVocab): string {
  const cats = orderedCats(c);
  const menu = look.offerings === 'menu';
  const items = (cat: string) => bySort(c.offerings).filter((o) => o.category === cat).map((o) => `
  ${offeringItem(look, o, true)}`).join('');
  return `<section class="block wrap"><h1>${esc(v.offeringLabel)}</h1>
${cats.map((cat) => (menu
    ? `<div class="menu-cat"><h2>${esc(cat)}</h2><ul class="items">${items(cat)}
</ul></div>`
    : `<div><h2 class="cat-h">${esc(cat)}</h2><div class="svc-grid">${items(cat)}
</div></div>`)).join('')}
${cats.length === 0 ? (menu ? '<p>Our menu is being updated — check back soon.</p>' : `<p>Our ${esc(v.offeringLabel.toLowerCase())} are being updated — check back soon.</p>`) : ''}</section>`;
}

// ═════════ the home page ═════════

// Harbor's "At a glance" panel beside the welcome text: a checklist of the first offerings,
// a few honest counts and how to reach the business, all from content; with nothing to
// show the panel disappears and the welcome text takes the whole width.
function heroPanel(c: SnapshotContent, v: IndustryVocab): string {
  const items = bySort(c.offerings).slice(0, 4);
  const cats = orderedCats(c);
  const { tel, mail } = contactBits(c);
  const stats: Array<[string, string]> = [];
  if (c.offerings.length) stats.push([String(c.offerings.length), v.offeringLabel]);
  if (cats.length > 1) stats.push([String(cats.length), 'Categories']);
  if (c.testimonials.length) stats.push([String(c.testimonials.length), 'Client reviews']);
  // The label's class is hp-lb: plain `lb` is the gallery's full-screen photo viewer (site_blocks
  // BLOCK_CSS), and `.hp-stats .lb` outranked its display:none, laying a dark sheet over the page.
  const rows = [
    items.length ? `<ul class="checklist">${items.map((o) => `<li>${esc(o.name)}</li>`).join('')}</ul>` : '',
    stats.length ? `<div class="hp-stats">${stats.map(([n, l]) => `<div class="stat"><span class="num">${esc(n)}</span><span class="hp-lb">${esc(l)}</span></div>`).join('')}</div>` : '',
    (tel || mail) ? `<p class="hp-contact">${[tel, mail].filter(Boolean).join('<br>')}</p>` : '',
  ].filter(Boolean).join('');
  return rows ? `<aside class="hero-panel" aria-label="At a glance"><p class="hp-title">At a glance</p>${rows}</aside>` : '';
}

// Phase CP-2 (DS-2): home sections — owner-chosen order + visibility, structured.
// Phase T-BLOCKS: enabled structured blocks (block_<type>) join the same order/
// visibility machinery — they default after the core sections, reorderable/hideable.
// The welcome section ('hero') takes part here too: it moves like the others, and
// stays first until a saved order names it, so an order saved before it could
// move never shifts it. The builder reads data-dds-movable to know it can move.
const HOME_SECTIONS = ['hero', 'about', 'offerings', 'testimonials', 'faqs'];
export function homeSectionOrder(c: SnapshotContent, blockKeys: string[] = []): string[] {
  const all = [...HOME_SECTIONS, ...blockKeys];
  const hidden = new Set(c.settings?.sections?.hidden || []);
  const chosen = (c.settings?.sections?.order || []).filter((k) => all.includes(k));
  const lead = chosen.includes('hero') ? [] : ['hero'];
  const rest = all.filter((k) => !chosen.includes(k) && !lead.includes(k));
  return [...lead, ...chosen, ...rest].filter((k) => !hidden.has(k));
}

function homeBody(look: TemplateLook, c: SnapshotContent, v: IndustryVocab, words: Words, blocks: RenderedBlock[] = []): string {
  const i = c.identity;
  const panel = look.hero === 'panel', plain = !!look.classic?.plainWelcome;
  // The welcome photo: the owner's cover first, then the first offering or update photo.
  // A logo never stands in for it.
  const hero = c.settings?.cover || bySort(c.offerings).find((o) => o.media)?.media || c.posts.find((p) => p.hero)?.hero || null;
  const featured = bySort(c.offerings).slice(0, 6);
  const tst = bySort(c.testimonials).slice(0, 3);
  const faqs = bySort(c.faqs).slice(0, 4);
  const { tel, mail } = contactBits(c);
  const maps = mapsHref(c);
  const book = safeHref(i.booking_url || '');
  const order = safeHref(i.ordering_url || '');
  const heroText = `${plain ? '' : `
  ${i.service_area ? `<p class="kicker"${pr('identity.service_area')}>${esc(i.service_area)}</p>` : ''}`}
  <h1${pr('identity.business_name')}>${esc(i.business_name)}</h1>
  ${i.tagline ? `<p class="tagline"${pr('identity.tagline')}>${esc(i.tagline)}</p>` : ''}
  <div class="cta-row">
    ${book ? `<a class="btn" href="${attr(book)}" rel="noopener">${esc(v.primaryAction)}</a>` : ''}
    ${order ? `<a class="btn${book ? ' ghost' : ''}" href="${attr(order)}" rel="noopener">Order online</a>` : ''}
    ${!book && !order ? `<a class="btn" href="${attr(v.offeringPath)}">${esc(words.seeOfferings(v.offeringLabel))}</a>` : ''}${plain ? '' : `
    ${(book || order) ? `<a class="btn ghost" href="/contact/">Contact us</a>` : ''}`}
  </div>`;
  // DS-6 split layout — the first CROPPING presentation, so the focal point (DS-5) drives it
  const useSplit = c.settings?.hero_layout === 'split' && !!hero;
  // Item 292: words over the photo, under a dark veil (hero_layout "photo") or a light one ("photo-light")
  const usePhoto = !useSplit && (c.settings?.hero_layout === 'photo' || c.settings?.hero_layout === 'photo-light') && !!hero?.variants;
  const photoVeil = c.settings?.hero_layout === 'photo-light' ? 'veil-light' : 'veil-dark';
  const focalStyle = hero?.focal ? ` style="object-position:${hero.focal.x}% ${hero.focal.y}%"` : '';
  const splitImg = useSplit && hero?.variants
    ? `<div class="split-img"><img src="${attr(hero.variants.w800 || hero.variants.w400 || '')}"${hero.variants.w400 && hero.variants.w1600 ? ` srcset="${attr(hero.variants.w400)} 400w, ${attr(hero.variants.w800 || hero.variants.w1600)} 800w, ${attr(hero.variants.w1600)} 1600w" sizes="${panel ? '(max-width:860px) 100vw, 42vw' : '(max-width:760px) 100vw, 45vw'}"` : ''} alt="${attr(hero.alt)}" fetchpriority="high"${focalStyle}></div>`
    : '';
  const heroOff = new Set(c.settings?.sections?.hidden || []).has('hero');   // hero is removable from the canvas
  // The address strip belongs under the welcome section and moves with it; with
  // the welcome section removed it keeps its old place at the top.
  const showMail = panel && !!mail;
  const strip = (loc0(c) || tel || maps || showMail) ? `<div class="strip"><div class="wrap">
  <span id="open-now" class="open-now" aria-live="polite"></span>
  ${loc0(c) && !goesOut(c) ? `<span${pr('location.address')}>${esc(loc0(c)!.address_line1)}, ${esc(loc0(c)!.city)}</span>` : ''}${goesOut(c) && plain && i.service_area ? `<span${pr('identity.service_area')}>${esc(i.service_area)}</span>` : ''}
  ${tel ? `<span>${tel}</span>` : ''}${panel ? `
  ${mail ? `<span>${mail}</span>` : ''}` : ''}
  ${maps ? `<span><a href="${attr(maps)}" rel="noopener">Get directions</a></span>` : ''}
</div></div>` : '';
  const photoSizes = look.classic?.heroPhotoSizes || '(max-width: 1000px) 100vw, 960px';
  let welcome: string;
  if (usePhoto) {
    welcome = `<section class="hero hero-photo ${photoVeil}" data-dds-core="hero" data-dds-movable><div class="hero-bg" aria-hidden="true">${img(hero, '100vw', false, '', true)}</div><div class="wrap hero-copy">${heroText}</div>
</section>`;
  } else if (panel) {
    const right = useSplit ? splitImg : heroPanel(c, v);
    welcome = `<section class="hero" data-dds-core="hero" data-dds-movable><div class="wrap hero-grid${right ? '' : ' solo'}"><div class="hero-copy">${heroText}</div>${right}</div>
${hero && !useSplit ? `<div class="wrap"><div class="hero-img">${img(hero, photoSizes, false, '', true)}</div></div>` : ''}
</section>`;
  } else {
    welcome = `<section class="hero wrap" data-dds-core="hero" data-dds-movable>${useSplit ? `<div class="hero-split"><div>${heroText}</div>${splitImg}</div>` : `${heroText}
  ${hero ? `<div class="hero-img">${img(hero, photoSizes, false, '', true)}</div>` : ''}`}
</section>`;
  }
  return `${heroOff ? strip : ''}
${(() => {
  const parts: Record<string, string> = {
    hero: `
${welcome}
${strip}`,
    about: i.description ? `<section class="block wrap" data-dds-core="about"><h2>About us</h2><p${pr('identity.description')}>${esc(i.description)}</p></section>` : '',   // no description, no lone "About us" heading
    offerings: featured.length ? `<section class="block alt" data-dds-core="offerings"><div class="wrap">${featuredOfferings(look, featured, v)}</div></section>` : '',
    testimonials: tst.length ? `<section class="block wrap" data-dds-core="testimonials"><h2>${esc(words.reviews)}</h2><div class="cards">${tst.map((t) => `
  <div class="card"${prE('testimonial', t.id)}><blockquote class="t"><p>“${esc(t.quote)}”</p><footer>— ${esc(t.author)}${t.source ? `, ${esc(t.source)}` : ''}</footer></blockquote></div>`).join('')}
</div></section>` : '',
    faqs: faqs.length ? `<section class="block alt" data-dds-core="faqs"><div class="wrap"><h2>Good to know</h2><dl class="faq">${faqs.map((f) =>
  `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd class="prose">${renderMarkdown(f.answer)}</dd>`).join('')}
</dl><p style="margin-top:18px"><a href="/faq/">All questions →</a></p></div></section>` : '',
  };
  for (const b of blocks) parts[b.key] = b.html;   // Phase T-BLOCKS: enabled structured blocks
  return homeSectionOrder(c, blocks.map((b) => b.key)).map((k) => parts[k] || '').join('');
})()}`;
}

// ═════════ the other pages ═════════

function aboutBody(c: SnapshotContent, words: Words): string {
  const i = c.identity;
  return `<section class="block wrap"><h1>About ${esc(i.business_name)}</h1>
<p>${esc(i.description)}</p>
${i.story ? `<div class="prose">${renderMarkdown(i.story)}</div>` : ''}
${i.service_area ? `<h2>${esc(words.where)}</h2><p>${esc(i.service_area)}</p>` : ''}</section>`;
}

function faqBody(c: SnapshotContent): string {
  return `<section class="block wrap"><h1>Frequently asked questions</h1><dl class="faq">${bySort(c.faqs).map((f) =>
    `<dt${prE('faq', f.id)}>${esc(f.question)}</dt><dd class="prose">${renderMarkdown(f.answer)}</dd>`).join('')}</dl>
${c.faqs.length === 0 ? '<p>Questions? Get in touch — we answer fast.</p>' : ''}</section>`;
}

function contactBody(look: TemplateLook, c: SnapshotContent, site: SiteConfig, words: Words): string {
  const { addr, tel, mail } = contactBits(c);
  const maps = mapsHref(c);
  const i = c.identity;
  // Restaurant Classic styles its fields inline, with a line break after each label.
  const inline = !!look.classic?.inlineForm;
  const br = inline ? '<br>' : '', fs = inline ? ' style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px"' : '';
  const form = site.formEndpoint
    ? `<form method="post" action="${attr(site.formEndpoint)}" class="card" style="margin-top:24px">
<h2>Send us a message</h2>
<input type="hidden" name="form_kind" value="contact">
<input type="hidden" name="source_page" value="/contact/">
<p class="hp" aria-hidden="true"><label for="f-hp">Leave this field empty</label><input id="f-hp" name="_hp" tabindex="-1" autocomplete="off"></p>
<p><label for="f-name">Your name</label>${br}<input id="f-name" name="name" required maxlength="120"${fs}></p>
<p><label for="f-email">Email</label>${br}<input id="f-email" type="email" name="email" required maxlength="254" autocomplete="email" inputmode="email"${fs}></p>
<p><label for="f-phone">Phone <span class="f-opt">(optional)</span></label>${br}<input id="f-phone" type="tel" name="phone" maxlength="40" autocomplete="tel" inputmode="tel"${fs}></p>
<p><label for="f-msg">Message</label>${br}<textarea id="f-msg" name="message" required maxlength="2000" rows="5"${fs}></textarea></p>
<p style="font-size:.85rem;color:var(--soft)">Please don’t include sensitive personal, financial, or medical information.</p>
<button class="btn" type="submit">Send</button>
<noscript><p class="ff-noscript">Please call or email us; this form needs scripts turned on.</p></noscript></form>`
    : (mail ? `<p style="margin-top:18px"><a class="btn" href="mailto:${attr(i.email)}">Email us</a></p>` : '');
  return `<section class="block wrap"><h1>Contact &amp; hours</h1>
<div class="cards"${inline ? '' : ' style="margin-top:8px"'}>
  <div class="card"><h2>${esc(words.reach)}</h2>${addr ? `<address>${addr}</address>` : ''}${areaBlock(c, words.where)}<p>${[tel, mail].filter(Boolean).join('<br>')}</p>${maps ? `<p><a href="${attr(maps)}" rel="noopener">Get directions</a></p>` : ''}</div>
  <div class="card">${loc0(c) ? hoursTable(c, 'Hours') : ''}</div>${contactPlace(c, hoursTable)}
</div>${form}</section>`;
}

function postDate(iso: string): string {
  const d = new Date(iso);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// Builder list item 40: the list, a page per category and the post are drawn once for every
// template (lib/post_render.ts); the template brings its photos, its dates and its cover's frame.
const postDraw = (look: TemplateLook): PostDraw => ({ img, date: postDate, prE, frame: look.postFrame });

// ═════════ the render function (the contract) ═════════

/** A template's render function: this drawing in the template's own look. */
export function makeRender(look: TemplateLook): RenderFn {
  const words: Words = { ...WORDS, ...(look.words || {}) };
  const classic = look.classic;
  return (snapshot: Snapshot, _manifest, site: SiteConfig): FileMap => {
    const c = normalizeSnapshotContent(snapshot.content);
    const i = c.identity;
    const v = look.vocab || vocabFor(c.settings?.industry);   // THE industry realization
    const files: FileMap = {};

    // Append the dropdown-nav CSS only when the owner set a custom nav → sites without
    // one keep the exact same stylesheet + hash (byte-identical).
    const effCss = look.css + POST_CSS + PLACE_CSS + SHELL_CSS + (c.settings?.nav?.length ? '\n' + NAV_DROPDOWN_CSS : '');
    const cssPath = `/assets/site-${fnv(effCss)}.css`;
    files[`assets/site-${fnv(effCss)}.css`] = effCss;
    // Items 288 and 298: the site's one script file (the phone menu and the header's height, the
    // gallery's zoom view and the carousel's arrows), named by its hash like the stylesheet
    files[SITE_JS_PATH.slice(1)] = SITE_JS;

    const siteTitle = i.seo_title || i.business_name;
    const siteDesc = i.seo_description || i.short_description || i.description;   // item 127
    // The owner's chosen share image wins; then the cover (item 67), offerings, posts; then the logo
    const ogImg = c.settings?.og_image?.variants?.w1600
      || c.settings?.cover?.variants?.w1600
      || (bySort(c.offerings).find((o) => o.media)?.media?.variants?.w1600)
      || (c.posts.find((p) => p.hero)?.hero?.variants?.w1600)
      || c.settings?.logo?.variants?.w1600;

    // The announcement bar, with its expiry read against the snapshot's own time
    const ann = c.settings?.announcement;
    const annLive = ann && ann.text && (!ann.expires_at || String(ann.expires_at) > snapshot.created_at);
    const annHref = annLive && ann!.url ? safeHref(ann!.url) : '';
    const announce = annLive
      ? `<div class="annbar" role="status">${annHref ? `<a href="${attr(annHref)}">${esc(ann!.text)}</a>` : esc(ann!.text)}</div>` : '';
    const icon = c.settings?.logo?.variants?.w400 || '';   // the logo becomes the favicon when present
    // Item 297: the FAQ page and the Updates page exist only once they have something on them;
    // until then they are out of the menu (the owner's own menu too), the sitemap and the site.
    const hasFaq = c.faqs.length > 0, hasUpdates = c.posts.length > 0;
    const emptyPaths = new Set([...(hasFaq ? [] : ['/faq/']), ...(hasUpdates ? [] : ['/updates/'])]);
    const nav: Array<[string, string, string]> = [
      ['/', 'Home', 'home'], [v.offeringPath, v.offeringLabel, 'offerings'], ['/about/', 'About', 'about'],
      ...(hasFaq ? [['/faq/', 'FAQ', 'faq'] as [string, string, string]] : []), ...(hasUpdates ? [['/updates/', 'Updates', 'updates'] as [string, string, string]] : []), ['/contact/', 'Contact', 'contact'],
    ];
    if (emptyPaths.size && c.settings?.nav?.length) {
      const kept = c.settings.nav.map((it) => ({ ...it, ...(Array.isArray(it.children) ? { children: it.children.filter((k) => !emptyPaths.has(k.href)) } : {}) }))
        .filter((it) => !emptyPaths.has(it.href) && !(it.folder && !(it.children || []).length));
      c.settings.nav = kept.length ? kept : undefined;
    }
    // Multi-page: the owner's own pages join the main nav (after Contact), unless hidden.
    for (const cp of (c.settings?.pages || [])) { if (!cp.hideNav) nav.push([`/${cp.slug}/`, cp.title, `page:${cp.slug}`]); }
    // Items 295 and 296: the header's own choices live with the style settings (lib/devmode.ts)
    const tokens: Record<string, string> = { ...((snapshot.dev_customization?.theme_tokens as Record<string, string> | undefined) || {}) };
    const extras: Extras = { announce, icon, nav, tokens };

    // Phase SD: "Show this page on Google?" — noindex + sitemap exclusion per page,
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
      // Item 308: the first photo on a page is the main thing it paints, so the page asks for it at
      // once (a preload in the head; the welcome photo already loads first and needs none).
      const html = shell(look, c, site, cssPath, { path, ...opts }, extras).replace('</head>', `${firstPhotoPreload(opts.body)}</head>`);
      const file = path === '/' ? 'index.html' : `${path.replace(/^\/|\/$/g, '')}/index.html`;
      files[file] = html;
    };
    const postIndexBody = (cat: PostCategory | null = null) => postListBody(c, postDraw(look), cat);

    // Item 299: an event happens at the business's address unless it names its own place
    const l0 = loc0(c);
    // item 334: a business that goes to its customers lends no address to an event that has no place of its own
    const place = l0 && l0.address_line1 && !goesOut(c) ? { name: i.business_name, address: [l0.address_line1, l0.address_line2, l0.city, [l0.region, l0.postal_code].filter(Boolean).join(' ')].map((x) => String(x || '').trim()).filter(Boolean).join(', ') } : undefined;
    const blocks = renderSiteBlocks(c.settings?.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at, src: c.settings?.blocks_src, place });   // Phase T-BLOCKS (+ FB form blocks + BK booking + EXP window)
    const ldBiz = ldBusiness(c, site, v, !!classic?.reservations);
    // Phase RV: fold the HONEST reviews schema (AggregateRating + Review, approved rows
    // only) onto the ONE business node — home only, where the reviews_wall is visible.
    const rSchema = reviewsSchema(c.settings?.blocks, snapshot.created_at);
    const ldBizHome = rSchema ? { ...ldBiz, ...rSchema } : ldBiz;
    page('/', { title: siteTitle, description: siteDesc, ...(i.short_description ? { shareDescription: i.short_description } : {}), ld: [ldBizHome, ...ldPlaces(c, site, v.schemaType), ldSite(c, site), ...blocks.flatMap((b) => (b.ld ? [b.ld] : []))], ogImage: ogImg, active: 'home', body: homeBody(look, c, v, words, blocks) });
    page(v.offeringPath, { ...seoOv('offerings', `${v.offeringLabel} — ${i.business_name}`, words.offeringsDescription(v.offeringLabel, i.business_name)), ld: [ldOfferings(c, site, v)], ogImage: ogImg, active: 'offerings', body: offeringsBody(look, c, v) });
    if (noidx.has('offerings')) markNoindex(`${v.offeringPath.replace(/^\/|\/$/g, '')}/index.html`);
    page('/about/', { ...seoOv('about', `About — ${i.business_name}`, siteDesc), ld: [ldCrumbs(site, [[i.business_name, '/'], ['About', '/about/']])], active: 'about', body: aboutBody(c, words) });
    if (noidx.has('about')) markNoindex('about/index.html');
    if (hasFaq) {
      page('/faq/', { ...seoOv('faq', `FAQ — ${i.business_name}`, `Answers to common questions about ${i.business_name}.`), ld: [ldFaq(c)], active: 'faq', body: faqBody(c) });
      if (noidx.has('faq')) markNoindex('faq/index.html');
    }
    page('/contact/', { ...seoOv('contact', `Contact & Hours — ${i.business_name}`, goesOut(c) ? `Phone, hours and the places ${i.business_name} serves.` : words.contactDescription(i.business_name)), ld: [ldBiz, ...ldPlaces(c, site, v.schemaType)], active: 'contact', body: contactBody(look, c, site, words) });
    if (noidx.has('contact')) markNoindex('contact/index.html');
    page('/thanks/', { title: `Thank you — ${i.business_name}`, description: `Your message to ${i.business_name} was sent.`, ld: [], active: 'contact', body: band(look, `<h1>Thank you — your message was sent.</h1><p class="tagline">${esc(i.business_name)} will get back to you soon.</p><div class="cta-row"><a class="btn" href="/">Back to the site</a></div>`) });
    files['thanks/index.html'] = (files['thanks/index.html'] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">');
    // item 62: where a message that didn't send lands — it says why and goes back to the form with the words kept
    page('/not-sent/', { title: `Not sent — ${i.business_name}`, description: `Your message to ${i.business_name} didn’t send.`, ld: [], active: 'contact', body: band(look, notSentInner()) });
    files['not-sent/index.html'] = (files['not-sent/index.html'] as string).replace('</title>', '</title>\n<meta name="robots" content="noindex">');
    // Phase Q (FD-M3): the generated legal foundation — facts-true, the owner never writes legal HTML
    page('/privacy/', { title: `Privacy — ${i.business_name}`, description: `How ${i.business_name} handles your information.`, ld: [], active: '', body: privacyBody(c, snapshot.created_at.slice(0, 10), site) });
    page('/accessibility/', { title: `Accessibility — ${i.business_name}`, description: `${i.business_name}’s accessibility commitment.`, ld: [], active: '', body: accessibilityBody(c) });
    // Item 300: the list pages at 20 (/updates/page/2/ …), every list page names the feed, and a
    // post shares as an article. Item 297: no Updates pages at all until there is a post.
    const listPages: string[] = [];
    const listPage = (cat: PostCategory | null, n: number, total: number) => {
      const path = postListPath(cat, n);
      const suffix = n > 1 ? ` (page ${n} of ${total})` : '';
      page(path, cat
        ? { title: `${cat.name}${suffix} — ${i.business_name}`, description: `${cat.name}: news and updates from ${i.business_name}.`, ld: [ldCrumbs(site, [[i.business_name, '/'], ['Updates', '/updates/'], [cat.name, categoryPath(cat)]])], active: 'updates', feed: true, body: postListBody(c, postDraw(look), cat, n) }
        : { ...seoOv('updates', `Updates${suffix} — ${i.business_name}`, `News and updates from ${i.business_name}.`), ld: [], active: 'updates', feed: true, body: postListBody(c, postDraw(look), null, n) });
      if (noidx.has('updates')) markNoindex(`${path.slice(1)}index.html`);
      listPages.push(path);
    };
    if (hasUpdates) {
      const total = postPageCount(c.posts.length);
      for (let n = 1; n <= total; n++) listPage(null, n, total);
      for (const p of c.posts) {
        page(`/updates/${p.slug}/`, {
          title: `${p.title} — ${i.business_name}`, description: p.excerpt || siteDesc,
          ld: [ldCrumbs(site, [[i.business_name, '/'], ['Updates', '/updates/'], [p.title, `/updates/${p.slug}/`]]), postLd(site, i.business_name, p)],
          ogImage: p.hero?.variants?.w1600, active: 'updates', ogType: 'article', published: p.published_at, feed: true, body: postPageBody(c, p, postDraw(look)),
        });
        if (p.noindex) markNoindex(`updates/${p.slug}/index.html`);
      }
      // Builder list item 40: a page per category, listed like the Updates page
      for (const cat of postCategories(c)) {
        const total = postPageCount(c.posts.filter((p) => p.category?.id === cat.id).length);
        for (let n = 1; n <= total; n++) listPage(cat, n, total);
      }
    }

    // Multi-page: the owner's own pages, each rendered with the SAME shell/nav/footer
    // and the shared block engine — so a custom page is a first-class page of the site.
    // (Their slugs never take a built-in page's: lib/page_ops.ts RESERVED_PAGE_SLUGS.)
    for (const cp of (c.settings?.pages || [])) {
      const cblocks = renderSiteBlocks(cp.blocks, { esc, attr, safeHref, formEndpoint: site.formEndpoint, bookEndpoint: site.bookEndpoint, now: snapshot.created_at, src: cp.blocks_src, place });
      page(`/${cp.slug}/`, {
        ...seoOv(`page:${cp.slug}`, `${cp.title} — ${i.business_name}`, siteDesc),
        ld: [ldCrumbs(site, [[i.business_name, '/'], [cp.title, `/${cp.slug}/`]]), ...cblocks.flatMap((b) => (b.ld ? [b.ld] : []))],
        active: `page:${cp.slug}`,
        body: `${band(look, `<h1>${esc(cp.title)}</h1>`)}${cblocks.map((b) => b.html).join('')}`,
      });
      if (noidx.has(`page:${cp.slug}`)) markNoindex(`${cp.slug}/index.html`);
    }

    // Phase SEARCH: static, privacy-safe on-site search — the site's own content
    // index (zero external origins, no outside trackers) + a calm results page whose
    // first-party inline script filters it client-side. Kept out of the sitemap +
    // noindexed (a thin utility page).
    files['search-index.json'] = searchIndexJson(c, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel });
    page('/search/', { title: `Search — ${i.business_name}`, description: `Search ${i.business_name}.`, ld: [], active: '', body: searchPageBody(esc, { offeringPath: v.offeringPath, offeringLabel: v.offeringLabel, faqPage: hasFaq, updatesPage: hasUpdates }) + searchClientScript() });
    markNoindex('search/index.html');

    files['404.html'] = shell(look, c, site, cssPath, {
      path: '/404.html', title: `Page not found — ${i.business_name}`, description: siteDesc, ld: [], active: '',
      body: band(look, `<h1>That page isn’t here</h1><p class="tagline">The page you’re after may have moved.</p><div class="cta-row"><a class="btn" href="/">Back to ${esc(i.business_name)}</a><a class="btn ghost" href="${attr(v.offeringPath)}">${esc(words.seeOfferings(v.offeringLabel))}</a></div>`),
    }, extras);

    const initial = classic?.files.initial || 'B';
    const letter = (i.business_name || initial).trim()[0]?.toUpperCase() || initial;
    files['favicon.svg'] = look.favicon(esc(letter));

    // item 99: no page records when it last changed, so only a post (its own date) carries one
    const lastmod = '';
    const KEY_PATHS: Array<[string, string]> = [['offerings', v.offeringPath], ['about', '/about/'], ...(hasFaq ? [['faq', '/faq/'] as [string, string]] : []), ['contact', '/contact/']];
    const urls: Array<{ loc: string; lastmod: string }> = [{ loc: '/', lastmod }, ...KEY_PATHS.filter(([k]) => !noidx.has(k)).map(([, p]) => ({ loc: p, lastmod })), ...(noidx.has('updates') ? [] : listPages.map((p) => ({ loc: p, lastmod }))), { loc: '/privacy/', lastmod }, { loc: '/accessibility/', lastmod }, ...c.posts.filter((p) => !p.noindex).map((p) => ({ loc: `/updates/${p.slug}/`, lastmod: String(p.published_at || snapshot.created_at).slice(0, 10) })), ...(c.settings?.pages || []).filter((cp) => !noidx.has(`page:${cp.slug}`)).map((cp) => ({ loc: `/${cp.slug}/`, lastmod }))];
    const indent = classic ? '  ' : '';
    files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `${indent}<url><loc>${esc(site.baseUrl + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
    files['robots.txt'] = classic ? `User-agent: *\nAllow: /\n\nSitemap: ${site.baseUrl}/sitemap.xml\n` : `User-agent: *\nAllow: /\nDisallow: /thanks/\nDisallow: /not-sent/\n\nSitemap: ${site.baseUrl}/sitemap.xml\n`;
    // RSS feed for /updates/ — subscribers + SEO (a WordPress default the SMB builders lack)
    {
      const feedItems = c.posts.filter((p) => !p.noindex).slice(0, 20).map((p) => {
        const link = esc(site.baseUrl + `/updates/${p.slug}/`);
        const pub = p.published_at ? `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>` : '';
        const desc = p.excerpt ? `<description>${esc(p.excerpt)}</description>` : '';
        const cats = [...(p.category ? [p.category.name] : []), ...normalizeTags(p.tags)].map((t) => `<category>${esc(t)}</category>`).join('');
        return `<item><title>${esc(p.title || 'Update')}</title><link>${link}</link><guid>${link}</guid>${pub}${cats}${desc}</item>`;
      }).join('');
      files['feed.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(i.business_name)} — Updates</title><link>${esc(site.baseUrl + '/updates/')}</link><description>${esc('Latest updates from ' + i.business_name)}</description>${feedItems}</channel></rss>\n`;
    }

    // Item 270: real 301s on Netlify, forced (the `!`), so the forward answers even where a file
    // sits at the old address. Until Nov 22 2026 seven templates also wrote a small refresh page at
    // the old address; Netlify serves a file over an unforced rule, so that page could answer in
    // place of the 301. No refresh page is written any more.
    const _redir = (c.redirects || []).map((r) => `${r.from_path}  ${r.to_path}  301!`).join('\n');
    files['_redirects'] = _redir ? _redir + '\n' : '';
    if (classic) files['_headers'] = classic.files.headers;

    return files;
  };
}
