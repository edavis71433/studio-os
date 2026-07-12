// ── Phase T-BLOCKS · the structured block library, REALIZED ───────────────────
// site_components.ts is the CATALOG (blocks as data). This file is the single
// place that (a) validates a stored block list into safe, capped, typed instances
// and (b) renders each block to deterministic HTML with its correct schema.org +
// accessibility contract. Every template calls the SAME renderer — there is no
// second block-render path, so a block looks and validates identically everywhere.
//
// Constitution-safe: these are CHOSEN-AND-FILLED structured blocks (typed fields →
// deterministic render), never free-form layout or runtime code. Text-only in v1.
// Pure: no I/O, no clock, no randomness. The catalog (COMPONENTS) is the authority
// for which block types exist; the test suite asserts this file only realizes keys
// that the catalog declares.

import type {
  SiteBlock, SiteBlockType, SiteBlockFeatures, SiteBlockStats, SiteBlockTeam,
  SiteBlockProcess, SiteBlockPricing, SiteBlockCertifications, SiteBlockServiceAreas, SiteBlockCtaBanner,
  SiteBlockGallery, SiteBlockBeforeAfter, SiteBlockVideo, MediaRef,
  SiteBlockPartners, SiteBlockReviews, SiteBlockAppointment,
} from './render_types.ts';

/** The block types this engine realizes (⊆ the site_components catalog keys). */
export const REALIZED_BLOCK_TYPES: readonly SiteBlockType[] = [
  'features', 'stats', 'team', 'process', 'pricing', 'certifications', 'service_areas', 'cta',
  'gallery', 'before_after', 'video',
  'partners', 'reviews', 'appointment',
];

// Per-block item caps — bounded content, never unbounded. Total blocks capped too.
const MAX_BLOCKS = 14;
const CAP = { features: 8, stats: 6, team: 12, process: 10, pricing: 4, certifications: 12, service_areas: 40, tierFeatures: 8, gallery: 16, beforeAfter: 8, partners: 12 };

const s = (x: unknown, max: number): string => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (x: unknown): string => { const v = String(x ?? '').trim(); return UUID_RE.test(v) ? v : ''; };

// ── Stored (pre-resolution) shapes for media blocks — carry media by ID; the
//    serializer's resolveBlockMedia() turns IDs into MediaRefs (reusing ref()). ──
interface StoredTeam { type: 'team'; title?: string; members: Array<{ name: string; role?: string; bio?: string; media_id?: string }> }
interface StoredGallery { type: 'gallery'; title?: string; image_ids: string[] }
interface StoredBeforeAfter { type: 'before_after'; title?: string; items: Array<{ before_id: string; after_id: string; caption?: string }> }
interface StoredVideo { type: 'video'; title?: string; url: string; caption?: string; poster_id?: string }
interface StoredPartners { type: 'partners'; title?: string; image_ids: string[] }
export type StoredBlock =
  | SiteBlockFeatures | SiteBlockStats | StoredTeam | SiteBlockProcess | SiteBlockPricing
  | SiteBlockCertifications | SiteBlockServiceAreas | SiteBlockCtaBanner
  | StoredGallery | StoredBeforeAfter | StoredVideo
  | StoredPartners | SiteBlockReviews | SiteBlockAppointment;

/** Validate a raw stored blocks value into safe, capped, typed instances.
 *  Deterministic: drops anything malformed/empty, keeps the FIRST instance of each
 *  type (a site has one Team section, one Pricing section…), preserves owner order.
 *  This is the authoritative boundary — the render trusts only what this returns. */
export function validateBlocks(raw: unknown): StoredBlock[] {
  const out: StoredBlock[] = [];
  const seen = new Set<string>();
  for (const b of arr(raw)) {
    if (!b || typeof b !== 'object') continue;
    const type = String((b as any).type || '');
    if (!(REALIZED_BLOCK_TYPES as readonly string[]).includes(type) || seen.has(type)) continue;
    const title = s((b as any).title, 80) || undefined;
    let block: StoredBlock | null = null;
    switch (type as SiteBlockType) {
      case 'features': {
        const items = arr((b as any).items).map((it) => ({ title: s(it?.title, 80), text: s(it?.text, 240) || undefined })).filter((it) => it.title).slice(0, CAP.features);
        if (items.length) block = { type: 'features', title, items } as SiteBlockFeatures;
        break;
      }
      case 'stats': {
        const items = arr((b as any).items).map((it) => ({ value: s(it?.value, 24), label: s(it?.label, 60) })).filter((it) => it.value && it.label).slice(0, CAP.stats);
        if (items.length) block = { type: 'stats', title, items } as SiteBlockStats;
        break;
      }
      case 'team': {
        const members = arr((b as any).members).map((m) => {
          const mem: StoredTeam['members'][number] = { name: s(m?.name, 80), role: s(m?.role, 80) || undefined, bio: s(m?.bio, 300) || undefined };
          const mid = uid(m?.media_id); if (mid) mem.media_id = mid;
          return mem;
        }).filter((m) => m.name).slice(0, CAP.team);
        if (members.length) block = { type: 'team', title, members };
        break;
      }
      case 'process': {
        const steps = arr((b as any).steps).map((st) => ({ step: s(st?.step, 80), detail: s(st?.detail, 300) || undefined })).filter((st) => st.step).slice(0, CAP.process);
        if (steps.length) block = { type: 'process', title, steps } as SiteBlockProcess;
        break;
      }
      case 'pricing': {
        const tiers = arr((b as any).tiers).map((tr) => ({
          name: s(tr?.name, 60), price_text: s(tr?.price_text, 40) || undefined,
          features: arr(tr?.features).map((f) => s(f, 100)).filter(Boolean).slice(0, CAP.tierFeatures),
        })).filter((tr) => tr.name).slice(0, CAP.pricing);
        if (tiers.length) block = { type: 'pricing', title, tiers } as SiteBlockPricing;
        break;
      }
      case 'certifications': {
        const items = arr((b as any).items).map((it) => ({ name: s(it?.name, 100), issuer: s(it?.issuer, 100) || undefined })).filter((it) => it.name).slice(0, CAP.certifications);
        if (items.length) block = { type: 'certifications', title, items } as SiteBlockCertifications;
        break;
      }
      case 'service_areas': {
        const areas = arr((b as any).areas).map((a) => s(a, 60)).filter(Boolean).slice(0, CAP.service_areas);
        if (areas.length) block = { type: 'service_areas', title, areas } as SiteBlockServiceAreas;
        break;
      }
      case 'cta': {
        const text = s((b as any).text, 160);
        if (text) block = { type: 'cta', text, button: s((b as any).button, 40) || undefined, url: s((b as any).url, 300) || undefined } as SiteBlockCtaBanner;
        break;
      }
      case 'gallery': {
        const image_ids = arr((b as any).image_ids).map(uid).filter(Boolean).slice(0, CAP.gallery);
        if (image_ids.length) block = { type: 'gallery', title, image_ids };
        break;
      }
      case 'before_after': {
        const items = arr((b as any).items).map((it) => ({ before_id: uid(it?.before_id), after_id: uid(it?.after_id), caption: s(it?.caption, 120) || undefined }))
          .filter((it) => it.before_id && it.after_id).slice(0, CAP.beforeAfter);
        if (items.length) block = { type: 'before_after', title, items };
        break;
      }
      case 'video': {
        const url = s((b as any).url, 400);
        // Only http(s) links — the block renders a poster + link-out (never an
        // external iframe: constitution Part 4 requires zero external origins).
        if (/^https?:\/\//i.test(url)) {
          block = { type: 'video', title, url, caption: s((b as any).caption, 160) || undefined };
          const pid = uid((b as any).poster_id); if (pid) (block as StoredVideo).poster_id = pid;
        }
        break;
      }
      case 'partners': {   // "trusted by" logo strip — same media path as gallery
        const image_ids = arr((b as any).image_ids).map(uid).filter(Boolean).slice(0, CAP.partners);
        if (image_ids.length) block = { type: 'partners', title, image_ids };
        break;
      }
      case 'reviews': {    // a rating badge — honest numbers only, bounded 0–5
        const rating = Math.round(Math.min(5, Math.max(0, Number((b as any).rating) || 0)) * 10) / 10;
        const count = Math.min(1000000, Math.max(0, Math.trunc(Number((b as any).count) || 0)));
        if (rating > 0 && count > 0) block = { type: 'reviews', title, rating, count, source: s((b as any).source, 40) || undefined } as SiteBlockReviews;
        break;
      }
      case 'appointment': {   // booking button — link-out only (zero external origins)
        const url = s((b as any).url, 300);
        if (/^https?:\/\//i.test(url)) block = { type: 'appointment', title, url, text: s((b as any).text, 200) || undefined, button: s((b as any).button, 40) || undefined } as SiteBlockAppointment;
        break;
      }
    }
    if (block) { out.push(block); seen.add(type); }
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

/** Resolve stored media IDs → MediaRefs using the serializer's ref() (which also
 *  registers them in the media manifest, so variants are generated — the ONE media
 *  pipeline, reused). A media block whose media can't resolve is dropped; a team
 *  keeps its text even without photos. StoredBlock[] → render-facing SiteBlock[]. */
export function resolveBlockMedia(blocks: StoredBlock[], ref: (id: string) => MediaRef | null): SiteBlock[] {
  const out: SiteBlock[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'team':
        out.push({ type: 'team', title: b.title, members: b.members.map((m) => ({ name: m.name, role: m.role, bio: m.bio, media: m.media_id ? ref(m.media_id) : null })) });
        break;
      case 'gallery': {
        const images = b.image_ids.map((id) => ref(id)).filter((x): x is MediaRef => !!x);
        if (images.length) out.push({ type: 'gallery', title: b.title, images });
        break;
      }
      case 'before_after': {
        const items: SiteBlockBeforeAfter['items'] = [];
        for (const it of b.items) {
          const before = ref(it.before_id), after = ref(it.after_id);
          if (before && after) items.push({ before, after, ...(it.caption ? { caption: it.caption } : {}) });
        }
        if (items.length) out.push({ type: 'before_after', title: b.title, items });
        break;
      }
      case 'video':
        out.push({ type: 'video', title: b.title, url: b.url, caption: b.caption, poster: b.poster_id ? ref(b.poster_id) : null });
        break;
      case 'partners': {
        const logos = b.image_ids.map((id) => ref(id)).filter((x): x is MediaRef => !!x);
        if (logos.length) out.push({ type: 'partners', title: b.title, logos });
        break;
      }
      default:
        out.push(b);
    }
  }
  return out;
}

/** Deterministic <img> from a resolved MediaRef — mirrors each template's img():
 *  responsive srcset, lazy, alt, focal crop. Zero external origins. */
function blockImg(m: MediaRef, esc: (s: string) => string, attr: (s: string) => string, sizes: string): string {
  const v = m.variants || {};
  const srcset = ['w400', 'w800', 'w1600'].filter((k) => v[k]).map((k) => `${attr(v[k])} ${k.slice(1)}w`).join(', ');
  const src = v.w800 || v.w400 || Object.values(v)[0]; if (!src) return '';
  const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  const focal = m.focal ? ` style="object-position:${m.focal.x}% ${m.focal.y}%"` : '';
  return `<img src="${attr(src)}"${srcset ? ` srcset="${srcset}" sizes="${attr(sizes)}"` : ''} alt="${attr(m.alt || '')}"${dims} loading="lazy" decoding="async"${focal}>`;
}

// ── Render context: the escapers + safe-href a template already has, injected so
//    this module stays free of any template's helper imports. ──
export interface BlockRenderCtx {
  esc: (s: string) => string;
  attr: (s: string) => string;
  safeHref: (s: string) => string | null;
}

export interface RenderedBlock { key: string; type: SiteBlockType; html: string; ld?: object }

const numericPrice = (p?: string): string | undefined => {
  if (!p) return undefined;
  const m = p.replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? m[0] : undefined;
};

/** Render validated blocks to deterministic HTML sections + optional JSON-LD.
 *  One section each, stable `block_<type>` key (for section order/visibility),
 *  reusing the template's existing classes (.block/.wrap/.cards/.card/.svc-grid).
 *  Each block meets the site_components a11y contract (lists, headings, text-first). */
export function renderSiteBlocks(blocks: SiteBlock[] | undefined, ctx: BlockRenderCtx): RenderedBlock[] {
  const { esc, attr, safeHref } = ctx;
  const out: RenderedBlock[] = [];
  const h2 = (t: string | undefined, fallback: string) => `<h2>${esc(t || fallback)}</h2>`;

  for (const b of blocks || []) {
    let html = '', ld: object | undefined;
    switch (b.type) {
      case 'features':
        html = `<section class="block wrap block-features">${h2(b.title, 'Why choose us')}<div class="svc-grid">${b.items.map((it) =>
          `<div class="svc"><div class="nm">${esc(it.title)}</div>${it.text ? `<div class="ds">${esc(it.text)}</div>` : ''}</div>`).join('')}</div></section>`;
        break;
      case 'stats':
        html = `<section class="block alt block-stats"><div class="wrap">${h2(b.title, 'By the numbers')}<div class="cards stats">${b.items.map((it) =>
          `<div class="card stat"><div class="stat-v">${esc(it.value)}</div><div class="stat-l">${esc(it.label)}</div></div>`).join('')}</div></div></section>`;
        break;
      case 'team':
        html = `<section class="block wrap block-team">${h2(b.title, 'Meet the team')}<div class="cards">${b.members.map((m) =>
          `<div class="card team-card">${m.media ? `<div class="team-photo">${blockImg(m.media, esc, attr, '(max-width:640px) 100vw, 220px')}</div>` : ''}<div class="nm">${esc(m.name)}</div>${m.role ? `<div class="pr">${esc(m.role)}</div>` : ''}${m.bio ? `<p class="ds">${esc(m.bio)}</p>` : ''}</div>`).join('')}</div></section>`;
        ld = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: b.members.map((m, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Person', name: m.name, jobTitle: m.role || undefined } })) };
        break;
      case 'process':
        html = `<section class="block alt block-process"><div class="wrap">${h2(b.title, 'How it works')}<ol class="process">${b.steps.map((st) =>
          `<li><span class="step-t">${esc(st.step)}</span>${st.detail ? `<span class="step-d">${esc(st.detail)}</span>` : ''}</li>`).join('')}</ol></div></section>`;
        ld = { '@context': 'https://schema.org', '@type': 'HowTo', name: b.title || 'How it works', step: b.steps.map((st, i) => ({ '@type': 'HowToStep', position: i + 1, name: st.step, text: st.detail || st.step })) };
        break;
      case 'pricing':
        html = `<section class="block wrap block-pricing">${h2(b.title, 'Pricing')}<div class="cards">${b.tiers.map((tr) =>
          `<div class="card price-tier"><div class="nm">${esc(tr.name)}</div>${tr.price_text ? `<div class="pr">${esc(tr.price_text)}</div>` : ''}${tr.features.length ? `<ul class="tier-feats">${tr.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div></section>`;
        ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: b.title || 'Pricing', itemListElement: b.tiers.map((tr, i) => {
          const price = numericPrice(tr.price_text);
          return { '@type': 'ListItem', position: i + 1, item: { '@type': 'Offer', name: tr.name, ...(price ? { price, priceCurrency: 'USD' } : {}), ...(tr.features.length ? { description: tr.features.join('; ') } : {}) } };
        }) };
        break;
      case 'certifications':
        html = `<section class="block alt block-certs"><div class="wrap">${h2(b.title, 'Credentials & certifications')}<ul class="certs">${b.items.map((it) =>
          `<li><strong>${esc(it.name)}</strong>${it.issuer ? ` — ${esc(it.issuer)}` : ''}</li>`).join('')}</ul></div></section>`;
        break;
      case 'service_areas':
        html = `<section class="block wrap block-areas">${h2(b.title, 'Areas we serve')}<ul class="areas">${b.areas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></section>`;
        break;
      case 'cta': {
        const href = b.url ? safeHref(b.url) : null;
        html = `<section class="block alt block-cta"><div class="wrap cta-inner"><p class="cta-text">${esc(b.text)}</p>${href ? `<a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button || 'Get started')}</a>` : ''}</div></section>`;
        break;
      }
      case 'gallery':
        html = `<section class="block wrap block-gallery">${h2(b.title, 'Gallery')}<div class="gallery">${b.images.map((m) =>
          `<figure class="ga">${blockImg(m, esc, attr, '(max-width:640px) 50vw, 320px')}${m.alt ? `<figcaption>${esc(m.alt)}</figcaption>` : ''}</figure>`).join('')}</div></section>`;
        break;
      case 'before_after':
        html = `<section class="block alt block-ba"><div class="wrap">${h2(b.title, 'Before &amp; after')}${b.items.map((it) =>
          `<div class="ba-pair">${['Before', 'After'].map((lab, k) => { const m = k ? it.after : it.before; return `<figure class="ba-fig"><span class="ba-lab">${lab}</span>${blockImg(m, esc, attr, '(max-width:640px) 100vw, 340px')}</figure>`; }).join('')}${it.caption ? `<p class="ba-cap">${esc(it.caption)}</p>` : ''}</div>`).join('')}</div></section>`;
        break;
      case 'video': {
        // Poster + link-out — NEVER an external iframe (constitution Part 4: zero
        // external origins on the published site). The link opens the video.
        const href = safeHref(b.url);
        if (href) {
          const label = b.caption || b.title || 'Watch the video';
          const inner = b.poster
            ? `<span class="v-poster">${blockImg(b.poster, esc, attr, '(max-width:900px) 100vw, 820px')}<span class="v-play" aria-hidden="true">▶</span></span>`
            : `<span class="v-textlink">▶ ${esc(label)}</span>`;
          html = `<section class="block wrap block-video">${h2(b.title, 'Video')}<a class="v-link" href="${attr(href)}" rel="noopener" aria-label="${attr('Watch: ' + label)}">${inner}</a>${b.caption ? `<p class="v-cap">${esc(b.caption)}</p>` : ''}</section>`;
        }
        break;
      }
    }
    if (b.type === 'partners') {
      html = `<section class="block wrap block-partners">${h2(b.title, 'Trusted by')}<ul class="partners">${b.logos.map((m) => `<li>${blockImg(m, esc, attr, '150px')}</li>`).join('')}</ul></section>`;
    }
    if (b.type === 'reviews') {
      const full = Math.round(b.rating);
      const stars = '★'.repeat(Math.min(5, full)) + '☆'.repeat(Math.max(0, 5 - full));
      html = `<section class="block alt block-reviews"><div class="wrap rev-inner">${h2(b.title, 'What customers say')}<p class="rev-stars" aria-hidden="true">${stars}</p><p class="rev-text">${esc(String(b.rating))} out of 5 — from ${esc(String(b.count))} reviews${b.source ? ` on ${esc(b.source)}` : ''}</p></div></section>`;
    }
    if (b.type === 'appointment') {
      const href = safeHref(b.url);
      html = href ? `<section class="block wrap block-appt">${h2(b.title, 'Book an appointment')}${b.text ? `<p class="appt-text">${esc(b.text)}</p>` : ''}<p class="appt-cta"><a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button || 'Book now')}</a></p></section>` : '';
    }
    if (html) out.push({ key: `block_${b.type}`, type: b.type, html, ...(ld ? { ld } : {}) });
  }
  return out;
}

/** The extra CSS the block sections need — appended once to a template's stylesheet.
 *  Reuses existing tokens (--accent, --line, --soft…); no external assets. */
export const BLOCK_CSS = `.stats{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.card.stat{text-align:center}.stat-v{font-size:2rem;font-weight:800;color:var(--accent-dark,var(--accent))}.stat-l{color:var(--soft);font-size:.95rem;margin-top:4px}
ol.process{margin:8px 0 0 0;padding:0;list-style:none;counter-reset:step}
ol.process li{counter-increment:step;position:relative;padding:14px 0 14px 46px;border-bottom:1px solid var(--line)}
ol.process li::before{content:counter(step);position:absolute;left:0;top:12px;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
.step-t{display:block;font-weight:700}.step-d{display:block;color:var(--soft);font-size:.95rem;margin-top:2px}
ul.tier-feats,ul.certs,ul.areas{margin:10px 0 0 0;padding-left:18px}
ul.tier-feats li,ul.certs li{margin:4px 0}
ul.areas{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}
ul.areas li{background:var(--wash);color:var(--ink);padding:5px 12px;border-radius:999px;font-size:.92rem}
.block-cta .cta-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.block-cta .cta-text{font-size:1.2rem;font-weight:700;margin:0}
.team-card .team-photo{margin:-2px 0 10px}
.team-card .team-photo img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;display:block}
.partners{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:26px;align-items:center}
.partners li{margin:0}
.partners img{height:44px;width:auto;max-width:150px;object-fit:contain;display:block}
.block-reviews .rev-inner{text-align:center}
.rev-stars{font-size:1.6rem;letter-spacing:4px;color:var(--accent);margin:6px 0 2px}
.rev-text{color:var(--soft);margin:0;font-size:1.02rem}
.block-appt{text-align:center}
.appt-text{color:var(--soft);max-width:56ch;margin:8px auto 0}
.appt-cta{margin-top:14px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.gallery .ga{margin:0}
.gallery .ga img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}
.gallery .ga figcaption{font-size:.85rem;color:var(--soft);margin-top:5px}
.ba-pair{margin-top:12px}
.ba-pair .ba-fig{position:relative;margin:0 0 10px}
.ba-pair .ba-lab{position:absolute;top:8px;left:8px;background:var(--ink,#222);color:#fff;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px}
.ba-pair .ba-fig img{width:100%;border-radius:10px;display:block}
.ba-cap{color:var(--soft);font-size:.95rem;margin-top:4px}
@media(min-width:620px){.ba-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ba-pair .ba-cap{grid-column:1/-1}}
.v-link{display:block;text-decoration:none;color:inherit;margin-top:6px}
.v-poster{position:relative;display:block}
.v-poster img{width:100%;border-radius:12px;display:block}
.v-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px}
.v-textlink{display:inline-block;font-weight:700;color:var(--accent-dark,var(--accent));border:2px solid var(--accent);border-radius:999px;padding:10px 20px}
.v-cap{color:var(--soft);font-size:.95rem;margin-top:8px}`;
