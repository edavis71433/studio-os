// ── The fifteen evidence providers (M9.0) ────────────────────────────────────
// Pure functions: (input, emit) → observations. No I/O, no clock, no
// randomness — `input.now` is the only time that exists. Independent and
// composable: each provider stands alone; the engine runs whatever the
// registry holds; adding a provider is appending to PROVIDERS.
// NO interpretation, NO prioritization, NO summaries — emit what is measured.
import type { ObservationInput } from './collect.ts';
import type { EvidenceItem } from './contract.ts';
import { makeEmit } from './contract.ts';
import { OPTIMIZATION_PROVIDERS } from '../optimization/providers.ts';

export interface Provider {
  name: string;
  provide: (input: ObservationInput, emit: ReturnType<typeof makeEmit>) => void;
}

/* ── tiny deterministic HTML readers (regex-scoped; templates are our own output) ── */
const one = (html: string, re: RegExp) => (html.match(re) || [])[1] ?? null;
const all = (html: string, re: RegExp) => [...html.matchAll(re)];
const title = (h: string) => one(h, /<title>([^<]*)<\/title>/i)?.trim() ?? null;
const metaDesc = (h: string) => one(h, /<meta\s+name="description"\s+content="([^"]*)"/i)?.trim() ?? null;
const bodyText = (h: string) => (h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const words = (s: string) => (s ? s.split(/\s+/).length : 0);
const daysBetween = (a: string, b: string) => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
const digits = (s: string) => (s || '').replace(/\D/g, '');
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Flesch reading ease — arithmetic, not intelligence. */
function flesch(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const wordList = text.split(/\s+/).filter(Boolean);
  if (!wordList.length) return 100;
  const syllables = wordList.reduce((n, w) => n + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
  return Math.round(206.835 - 1.015 * (wordList.length / sentences) - 84.6 * (syllables / wordList.length));
}

export const PROVIDERS: Provider[] = [

  { name: 'website', provide(i, emit) {
    if (!i.everPublished) emit('website.not_live', 'ledger', '');
    if (!i.site.netlify_site_id) emit('website.hosting_missing', 'site', '');
    if (i.liveFetch?.attempted) {
      if (i.liveFetch.error) emit('website.live_fetch_failed', 'live', i.liveFetch.url, { url: i.liveFetch.url, error: i.liveFetch.error });
      else if (!i.liveFetch.ok) emit('website.http_status', 'live', i.liveFetch.url, { url: i.liveFetch.url, status: i.liveFetch.status });
    }
  } },

  { name: 'seo', provide(i, emit) {
    const titles = new Map<string, string[]>(), descs = new Map<string, string[]>();
    for (const p of i.pages) {
      const t = title(p.html);
      if (!t) emit('seo.title_missing', 'render', p.path, { page: p.path });
      else {
        titles.set(t, [...(titles.get(t) || []), p.path]);
        if (t.length < 15 || t.length > 60) emit('seo.title_length', 'render', p.path, { page: p.path, length: t.length });
      }
      const d = metaDesc(p.html);
      if (!d) emit('seo.description_missing', 'render', p.path, { page: p.path });
      else {
        descs.set(d, [...(descs.get(d) || []), p.path]);
        if (d.length < 50 || d.length > 160) emit('seo.description_length', 'render', p.path, { page: p.path, length: d.length });
      }
      if (!/<link\s+rel="canonical"/i.test(p.html)) emit('seo.canonical_missing', 'render', p.path, { page: p.path });
      const h1s = all(p.html, /<h1[\s>]/gi).length;
      if (h1s === 0) emit('seo.h1_missing', 'render', p.path, { page: p.path });
      if (h1s > 1) emit('seo.h1_multiple', 'render', p.path, { page: p.path, count: h1s });
      const w = words(bodyText(p.html));
      if (w < 40) emit('seo.thin_content', 'render', p.path, { page: p.path, words: w, floor: 40 });
    }
    for (const [t, pages] of titles) if (pages.length > 1) emit('seo.title_duplicate', 'render', pages.join(','), { title: t, pages: pages.join(', ') });
    for (const [, pages] of descs) if (pages.length > 1) emit('seo.description_duplicate', 'render', pages.join(','), { pages: pages.join(', ') });
    if (i.fileMapFrom !== 'none') {
      if (!('robots.txt' in i.fileMap)) emit('seo.robots_missing', 'filemap', '');
      if (!('sitemap.xml' in i.fileMap)) emit('seo.sitemap_missing', 'filemap', '');
    }
  } },

  { name: 'accessibility', provide(i, emit) {
    for (const p of i.pages) {
      const bare = all(p.html, /<img\b(?![^>]*\balt=)[^>]*>/gi).length;
      if (bare > 0) emit('accessibility.img_alt_missing', 'render', p.path, { page: p.path, count: bare });
      for (const m of all(p.html, /<a\b[^>]*>([^<]{1,40})<\/a>/gi)) {
        const text = m[1].trim().toLowerCase();
        if (['click here', 'here', 'read more', 'learn more', 'more'].includes(text)) {
          emit('accessibility.link_text_vague', 'render', `${p.path}#${text}`, { page: p.path, text });
        }
      }
      if (!/lang=/i.test(one(p.html, /(<html[^>]*>)/i) || '')) emit('accessibility.lang_missing', 'render', p.path, { page: p.path });
      const levels = all(p.html, /<h([1-6])[\s>]/gi).map((m) => Number(m[1]));
      for (let k = 1; k < levels.length; k++) {
        if (levels[k] > levels[k - 1] + 1) { emit('accessibility.heading_skip', 'render', p.path, { page: p.path, from: levels[k - 1], to: levels[k] }); break; }
      }
    }
    const home = i.pages.find((p) => p.path === '/');
    if (home) for (const lm of ['main', 'nav', 'footer']) {
      if (!new RegExp(`<${lm}[\\s>]`, 'i').test(home.html)) emit('accessibility.landmark_missing', 'render', '/', { page: '/', landmark: lm });
    }
  } },

  { name: 'performance', provide(i, emit) {
    const LIMIT_KB = 600, PAGE_KB = 150;
    for (const m of i.mediaRows) {
      const kb = Math.round((m.bytes ?? 0) / 1024);
      if (kb > LIMIT_KB) emit('performance.image_oversized', 'media', m.id, { id: m.id, alt: m.alt_text, kb, limit: LIMIT_KB });
      if (m.width == null || m.height == null) emit('performance.image_dimensions_missing', 'media', m.id, { id: m.id, alt: m.alt_text });
    }
    for (const p of i.pages) {
      const kb = Math.round(p.html.length / 1024);
      if (kb > PAGE_KB) emit('performance.page_weight', 'render', p.path, { page: p.path, kb, budget: PAGE_KB });
      const head = one(p.html, /<head>([\s\S]*?)<\/head>/i) || '';
      const blocking = all(head, /<script\b[^>]*\bsrc=/gi).filter((m) => !/defer|async/.test(m[0])).length;
      if (blocking > 0) emit('performance.blocking_scripts', 'render', p.path, { page: p.path, count: blocking });
      if (/fonts\.googleapis\.com\/css/.test(head) && !/display=swap/.test(head)) emit('performance.font_swap_missing', 'render', p.path, { page: p.path });
    }
  } },

  { name: 'structured_data', provide(i, emit) {
    const home = i.pages.find((p) => p.path === '/');
    let anyValid = false;
    for (const p of i.pages) {
      for (const m of all(p.html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
        try { JSON.parse(m[1]); anyValid = true; }
        catch (e) { emit('structured_data.ldjson_invalid', 'render', p.path, { page: p.path, error: (e as Error).message.slice(0, 60) }); }
      }
    }
    if (home) {
      const blocks = all(home.html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
      if (!blocks.length) emit('structured_data.schema_missing', 'render', '/', { page: '/' });
      else if (anyValid) {
        let biz: Record<string, unknown> | null = null;
        for (const b of blocks) { try { const j = JSON.parse(b[1]); const node = Array.isArray(j) ? j[0] : j; if (node && node['@type']) biz = node; } catch { /* reported above */ } }
        if (biz) {
          const schema = String(biz['@type']);
          for (const [field, key] of [['name', 'name'], ['address', 'address'], ['telephone', 'telephone'], ['opening hours', 'openingHoursSpecification']] as const) {
            if (!(key in biz)) emit('structured_data.schema_field_missing', 'render', `/:${key}`, { page: '/', schema, field });
          }
        }
      }
    }
  } },

  { name: 'metadata', provide(i, emit) {
    const home = i.pages.find((p) => p.path === '/');
    if (home) {
      const missing = ['og:title', 'og:description'].filter((k) => !new RegExp(`property="${k}"`, 'i').test(home.html));
      if (missing.length) emit('metadata.og_missing', 'render', '/', { page: '/', missing: missing.join(', ') });
      const hasFavicon = /rel="(?:shortcut )?icon"/i.test(home.html) || 'favicon.ico' in i.fileMap || 'favicon.svg' in i.fileMap;
      if (!hasFavicon) emit('metadata.favicon_missing', 'render', '');
    }
  } },

  { name: 'freshness', provide(i, emit) {
    if (i.everPublished && i.lastLiveAt) {
      const d = daysBetween(i.now, i.lastLiveAt);
      if (d >= 90) emit('freshness.publish_stale', 'ledger', '', { days: d, last: i.lastLiveAt.slice(0, 10), threshold: 90 });
    }
    if (i.unpublishedChangeEvents > 0 && i.oldestUnpublishedChangeAt) {
      const d = daysBetween(i.now, i.oldestUnpublishedChangeAt);
      if (d >= 14) emit('freshness.draft_idle', 'ledger', '', { count: i.unpublishedChangeEvents, days: d, oldest: i.oldestUnpublishedChangeAt.slice(0, 10) });
    }
    const shown = (i.draft.posts || []).filter((p) => p.published_at).map((p) => p.published_at).sort().reverse();
    if (i.everPublished && shown.length) {
      const d = daysBetween(i.now, shown[0]);
      if (d >= 120) emit('freshness.updates_quiet', 'content', '', { days: d, last: shown[0].slice(0, 10), threshold: 120 });
    }
    if (i.everPublished && i.lastOfferingChangeAt) {
      const d = daysBetween(i.now, i.lastOfferingChangeAt);
      if (d >= 180) emit('freshness.menu_unchanged', 'ledger', '', { days: d, last: i.lastOfferingChangeAt.slice(0, 10), threshold: 180 });
    }
  } },

  { name: 'business_info', provide(i, emit) {
    const id = i.draft.identity || ({} as Record<string, string>);
    for (const f of ['business_name', 'description'] as const) {
      if (!String(id[f] || '').trim()) emit('business_info.identity_incomplete', 'draft', f, { field: f.replace('_', ' ') });
    }
    const loc = i.draft.locations?.[0];
    if (loc) {
      const set = new Map((loc.hours || []).map((d) => [d.day, d]));
      const missing = DAY_KEYS.filter((d) => { const e = set.get(d); return !e || (!e.closed && !(e.intervals || []).length); });
      if (missing.length) emit('business_info.hours_incomplete', 'draft', 'hours', { days: missing.join(', ') });
      if (!(loc.holiday_exceptions || []).length) emit('business_info.holiday_hours_missing', 'draft', 'holiday_exceptions');
      for (const f of ['address_line1', 'city', 'postal_code'] as const) {
        if (!String(loc[f] || '').trim()) emit('business_info.address_incomplete', 'draft', f, { field: f.replace(/_/g, ' ') });
      }
      if (loc.temporarily_closed && i.lastLocationChangeAt) {
        const d = daysBetween(i.now, i.lastLocationChangeAt);
        if (d >= 30) emit('business_info.closed_longstanding', 'draft', 'temporarily_closed', { days: d, since: i.lastLocationChangeAt.slice(0, 10) });
      }
      const a = digits(id.phone || ''), b = digits(loc.phone || '');
      if (a && b && a !== b) emit('business_info.phone_mismatch', 'draft', 'phone', { a: id.phone || '', b: loc.phone || '' });
    }
  } },

  { name: 'media', provide(i, emit) {
    for (const m of i.mediaRows) {
      const alt = (m.alt_text || '').trim();
      if (alt && alt.length < 8) emit('media.alt_short', 'media', m.id, { id: m.id, alt, length: alt.length, floor: 8 });
    }
    const used = new Set(i.usedMediaIds);
    const unused = i.mediaRows.filter((m) => !used.has(m.id)).length;
    if (unused > 0) emit('media.unused', 'media', '', { count: unused });
    const noPhoto = (i.draft.offerings || []).filter((o) => o.is_visible !== false && !o.media).length;
    if (noPhoto > 0) emit('media.offering_photo_missing', 'draft', '', { count: noPhoto });
  } },

  { name: 'links', provide(i, emit) {
    if (i.fileMapFrom === 'none') return;
    const keys = new Set(Object.keys(i.fileMap));
    const exists = (href: string) => {
      const clean = href.split('#')[0].split('?')[0];
      if (!clean || clean === '/') return keys.has('index.html');
      const asDir = clean.replace(/^\//, '').replace(/\/$/, '') + '/index.html';
      const asFile = clean.replace(/^\//, '');
      return keys.has(asDir) || keys.has(asFile);
    };
    for (const p of i.pages) {
      const seen = new Set<string>();
      for (const m of all(p.html, /href="(\/[^"]*)"/gi)) {
        const href = m[1];
        if (seen.has(href)) continue; seen.add(href);
        if (!exists(href)) emit('links.internal_broken', 'render', `${p.path}→${href}`, { page: p.path, href });
      }
    }
    for (const r of i.draft.redirects || []) {
      if (!exists(r.to_path)) emit('links.redirect_to_missing', 'draft', `${r.from_path}→${r.to_path}`, { from: r.from_path, to: r.to_path });
    }
  } },

  { name: 'local_presence', provide(i, emit) {
    emit('local_presence.profile_unconnected', 'destinations', '');
    const home = i.pages.find((p) => p.path === '/');
    if (home) {
      const missing: string[] = [];
      if (!/tel:/i.test(home.html)) missing.push('tappable phone');
      const loc = i.draft.locations?.[0];
      if (loc?.address_line1 && !home.html.includes(loc.address_line1)) missing.push('street address');
      if (missing.length) emit('local_presence.map_signal_missing', 'render', '/', { missing: missing.join(', ') });
    }
  } },

  { name: 'reviews', provide(i, emit) {
    emit('reviews.source_unconnected', 'destinations', '');
    const vis = (i.draft.testimonials || []);
    if (!vis.length) emit('reviews.testimonials_none', 'content', '');
    else {
      const dated = vis.map((t) => t.quote_date).filter(Boolean).sort().reverse() as string[];
      if (dated.length) {
        const d = daysBetween(i.now, dated[0]);
        if (d >= 365) emit('reviews.testimonials_stale', 'content', '', { days: d, last: dated[0] });
      }
    }
  } },

  { name: 'trust', provide(i, emit) {
    if (i.liveFetch?.attempted && !i.liveFetch.error && !i.liveFetch.https) {
      emit('trust.ssl_missing', 'live', i.liveFetch.url, { url: i.liveFetch.url });
    }
    const id = i.draft.identity || ({} as Record<string, string>);
    if (!String(id.phone || '').trim() && !String(id.email || '').trim()) emit('trust.contact_missing', 'draft', 'contact');
    const draftHours = (i.draft.locations?.[0]?.hours || []).some((d) => !d.closed && (d.intervals || []).length);
    if (draftHours && !i.everPublished) emit('trust.hours_not_public', 'ledger', '');
    for (const page of ['privacy']) {
      emit('trust.policy_page_missing', 'contract', page, { page });
    }
    if (i.liveFetch?.attempted && i.liveFetch.ok) {
      for (const h of ['strict-transport-security', 'x-content-type-options']) {
        if (!i.liveFetch.headers[h]) emit('trust.security_header_missing', 'live', h, { header: h });
      }
    }
  } },

  { name: 'content', provide(i, emit) {
    if (!(i.draft.faqs || []).length) emit('content.faqs_none', 'content', '');
    if (!(i.draft.posts || []).filter((p) => p.published_at).length) emit('content.updates_none', 'content', '');
    const desc = String(i.draft.identity?.description || '');
    const w = words(desc);
    if (w > 0 && w < 15) emit('content.description_thin', 'draft', 'description', { words: w, floor: 15 });
    if (!String(i.draft.identity?.booking_url || '').trim() && !String(i.draft.identity?.ordering_url || '').trim()) {
      emit('content.cta_missing', 'draft', 'cta');
    }
    if (w >= 15) {
      const score = flesch(desc);
      if (score < 45) emit('content.reading_hard', 'draft', 'description', { field: 'description', score, floor: 45 });
    }
    const names = new Map<string, number>();
    for (const o of (i.draft.offerings || []).filter((o) => o.is_visible !== false)) {
      names.set(o.name, (names.get(o.name) || 0) + 1);
    }
    for (const [name, count] of names) if (count > 1) emit('content.offering_duplicate', 'draft', name, { name, count });
  } },

  { name: 'conversion', provide(i, emit) {
    const id = i.draft.identity || ({} as Record<string, string>);
    if (!String(id.booking_url || '').trim()) emit('conversion.booking_missing', 'draft', 'booking_url');
    if (!String(id.ordering_url || '').trim()) emit('conversion.ordering_missing', 'draft', 'ordering_url');
    const noPrice = (i.draft.offerings || []).filter((o) => o.is_visible !== false && !String(o.price_text || '').trim()).length;
    if (noPrice > 0) emit('conversion.prices_missing', 'draft', '', { count: noPrice });
  } },

  // M10: the twelve optimization providers, appended exactly as this
  // registry's header prescribes ("adding a provider is appending here").
  ...OPTIMIZATION_PROVIDERS,
];

/** Run every provider purely; a provider failure never poisons the others. */
export function runProviders(input: ObservationInput, providers: Provider[] = PROVIDERS): {
  items: EvidenceItem[];
  record: Array<{ name: string; ok: boolean; items: number; error?: string }>;
} {
  const items: EvidenceItem[] = [];
  const record: Array<{ name: string; ok: boolean; items: number; error?: string }> = [];
  for (const p of providers) {
    const before = items.length;
    try {
      p.provide(input, makeEmit(input.site.id, p.name, input.now, items));
      record.push({ name: p.name, ok: true, items: items.length - before });
    } catch (e) {
      items.length = before; // a failed provider contributes nothing, not partial output
      record.push({ name: p.name, ok: false, items: 0, error: (e as Error)?.message?.slice(0, 200) });
    }
  }
  return { items, record };
}
