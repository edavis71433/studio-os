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
} from './render_types.ts';

/** The block types this engine realizes (⊆ the site_components catalog keys). */
export const REALIZED_BLOCK_TYPES: readonly SiteBlockType[] = [
  'features', 'stats', 'team', 'process', 'pricing', 'certifications', 'service_areas', 'cta',
];

// Per-block item caps — bounded content, never unbounded. Total blocks capped too.
const MAX_BLOCKS = 12;
const CAP = { features: 8, stats: 6, team: 12, process: 10, pricing: 4, certifications: 12, service_areas: 40, tierFeatures: 8 };

const s = (x: unknown, max: number): string => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);

/** Validate a raw stored blocks value into safe, capped, typed instances.
 *  Deterministic: drops anything malformed/empty, keeps the FIRST instance of each
 *  type (a site has one Team section, one Pricing section…), preserves owner order.
 *  This is the authoritative boundary — the render trusts only what this returns. */
export function validateBlocks(raw: unknown): SiteBlock[] {
  const out: SiteBlock[] = [];
  const seen = new Set<string>();
  for (const b of arr(raw)) {
    if (!b || typeof b !== 'object') continue;
    const type = String((b as any).type || '');
    if (!(REALIZED_BLOCK_TYPES as readonly string[]).includes(type) || seen.has(type)) continue;
    const title = s((b as any).title, 80) || undefined;
    let block: SiteBlock | null = null;
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
        const members = arr((b as any).members).map((m) => ({ name: s(m?.name, 80), role: s(m?.role, 80) || undefined, bio: s(m?.bio, 300) || undefined })).filter((m) => m.name).slice(0, CAP.team);
        if (members.length) block = { type: 'team', title, members } as SiteBlockTeam;
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
    }
    if (block) { out.push(block); seen.add(type); }
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
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
          `<div class="card"><div class="nm">${esc(m.name)}</div>${m.role ? `<div class="pr">${esc(m.role)}</div>` : ''}${m.bio ? `<p class="ds">${esc(m.bio)}</p>` : ''}</div>`).join('')}</div></section>`;
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
.block-cta .cta-text{font-size:1.2rem;font-weight:700;margin:0}`;
