// ── Template registry + render invocation ────────────────────────────────────
// Templates are versioned folders registered here. Shipping a template version =
// deploying the function (deliberately boring, per blueprint §2). Old versions
// are never deleted while any site pins them.
import { fontFaceCss, libraryFontsIn } from './fonts.ts';
import type { RenderFn, Snapshot, SnapshotContent, SiteConfig, TemplateManifest, FileMap } from './render_types.ts';
import { lazyRoutes } from './lazy.ts';
import manifest_rc_1_0_0 from '../templates/restaurant-classic/1.0.0/manifest.json' with { type: 'json' };
import manifest_bc_1_0_0 from '../templates/business-classic/1.0.0/manifest.json' with { type: 'json' };
import manifest_ed_1_0_0 from '../templates/editorial/1.0.0/manifest.json' with { type: 'json' };
import manifest_au_1_0_0 from '../templates/aurora/1.0.0/manifest.json' with { type: 'json' };
import manifest_sl_1_0_0 from '../templates/slate/1.0.0/manifest.json' with { type: 'json' };
import manifest_me_1_0_0 from '../templates/meadow/1.0.0/manifest.json' with { type: 'json' };
import manifest_at_1_0_0 from '../templates/atelier/1.0.0/manifest.json' with { type: 'json' };
import manifest_ha_1_0_0 from '../templates/harbor/1.0.0/manifest.json' with { type: 'json' };
import { trackerScript } from './visits.ts';
import { injectSender } from './site_send.ts';
import { injectPopup } from './popup.ts';
import { withAiCrawlerChoice } from './ai_crawlers.ts';
import { injectAdTags } from './ad_tags.ts';
import { sanitizeDevHtml, sanitizeDevCss } from './devmode.ts';
import { BLOCK_CSS, sectionStyles, pageClasses } from './site_blocks.ts';
import { applyPageChrome } from './page_access.ts';

// ── FD-T2: indexed template registry; each template's code loads on first use ──
// slug → version → { manifest, code loader }. Render resolution goes through this
// ONE boundary and is memoized. The manifests are small and load with the function,
// so getTemplate stays SYNCHRONOUS for everything that only reads a manifest (the
// catalog, media limits, contract checks). A template's drawing code (render.ts,
// about 50 KB each) loads the first time something draws with it and stays loaded
// for the life of the worker (builder list item 107; lib/lazy.ts is the same
// stand-in the router uses for its rarely used route groups). Drawing is therefore
// async: renderSnapshot and renderForBuilder return a promise. Keep each import()
// specifier a string literal: that is what puts the file in the deploy bundle and
// in `deno check`.
interface TemplateEntry { render: (...args: Parameters<RenderFn>) => Promise<FileMap>; manifest: TemplateManifest }
const MANIFESTS: Record<string, Record<string, TemplateManifest>> = {
  'restaurant-classic': { '1.0.0': manifest_rc_1_0_0 as unknown as TemplateManifest },
  'business-classic': { '1.0.0': manifest_bc_1_0_0 as unknown as TemplateManifest },  // Phase T3 production default
  'editorial': { '1.0.0': manifest_ed_1_0_0 as unknown as TemplateManifest },         // Phase PT premium family
  'aurora': { '1.0.0': manifest_au_1_0_0 as unknown as TemplateManifest },            // #183 modern family
  'slate': { '1.0.0': manifest_sl_1_0_0 as unknown as TemplateManifest },             // #183 bold dark professional
  'meadow': { '1.0.0': manifest_me_1_0_0 as unknown as TemplateManifest },            // #183 warm organic wellness
  'atelier': { '1.0.0': manifest_at_1_0_0 as unknown as TemplateManifest },           // #183 boutique luxury serif
  'harbor': { '1.0.0': manifest_ha_1_0_0 as unknown as TemplateManifest },            // #183 structured navy trust
};
const CODE: Record<string, Record<string, () => Promise<{ render: RenderFn }>>> = {
  'restaurant-classic': { '1.0.0': () => import('../templates/restaurant-classic/1.0.0/render.ts') },
  'business-classic': { '1.0.0': () => import('../templates/business-classic/1.0.0/render.ts') },
  'editorial': { '1.0.0': () => import('../templates/editorial/1.0.0/render.ts') },
  'aurora': { '1.0.0': () => import('../templates/aurora/1.0.0/render.ts') },
  'slate': { '1.0.0': () => import('../templates/slate/1.0.0/render.ts') },
  'meadow': { '1.0.0': () => import('../templates/meadow/1.0.0/render.ts') },
  'atelier': { '1.0.0': () => import('../templates/atelier/1.0.0/render.ts') },
  'harbor': { '1.0.0': () => import('../templates/harbor/1.0.0/render.ts') },
};
const _entryCache = new Map<string, TemplateEntry>();

export function getTemplate(slug: string, version: string): TemplateEntry | null {
  const key = `${slug}@${version}`;
  const cached = _entryCache.get(key);
  if (cached) return cached;
  const manifest = MANIFESTS[slug]?.[version];
  const load = CODE[slug]?.[version];
  if (!manifest || !load) return null;
  const entry: TemplateEntry = { render: lazyRoutes(load).render, manifest };
  _entryCache.set(key, entry);
  return entry;
}

/** Loads a template's drawing code now instead of on its first draw. False for an
 *  unknown template or a file that fails to load or has no render function. The
 *  registry test runs it for every entry, so a template whose code can't load
 *  can't ship. */
export async function templateCodeLoads(slug: string, version: string): Promise<boolean> {
  const load = CODE[slug]?.[version];
  if (!load) return false;
  try { return typeof (await load()).render === 'function'; } catch { return false; }
}

export interface TemplateIndexEntry { slug: string; name: string; versions: string[]; latest: string; content_contract_version: number }
let _index: TemplateIndexEntry[] | null = null;
/** The template catalog — computed once, metadata-first (no repeated scanning). */
export function templateIndex(): TemplateIndexEntry[] {
  if (_index) return _index;
  _index = Object.entries(MANIFESTS).map(([slug, vs]) => {
    const versions = Object.keys(vs).sort();
    const latest = versions[versions.length - 1];
    const m = getTemplate(slug, latest)!.manifest;
    return { slug, name: m.name, versions, latest, content_contract_version: m.content_contract_version };
  });
  return _index;
}

/** Phase CP-1: the newest version of a template (via the index). */
export function latestTemplateVersion(slug: string): string | null {
  const e = templateIndex().find((x) => x.slug === slug);
  return e ? e.latest : null;
}
/** The switchable-template catalog (slug, name, latest version). */
export function listTemplates(): Array<{ slug: string; name: string; version: string }> {
  return templateIndex().map((e) => ({ slug: e.slug, name: e.name, version: e.latest }));
}

/** Registry integrity — every entry loads and its manifest matches its keys. Pure;
 *  the guard test runs this so a mis-keyed template can't ship silently at scale. */
export function registryIntegrity(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const [slug, vs] of Object.entries(MANIFESTS)) {
    for (const version of Object.keys(vs)) {
      const t = getTemplate(slug, version);
      if (!t) { problems.push(`${slug}@${version}: not loadable`); continue; }
      if (t.manifest.slug !== slug) problems.push(`${slug}@${version}: manifest.slug=${t.manifest.slug}`);
      if (t.manifest.version !== version) problems.push(`${slug}@${version}: manifest.version=${t.manifest.version}`);
      if (typeof t.manifest.content_contract_version !== 'number') problems.push(`${slug}@${version}: missing content_contract_version`);
    }
  }
  for (const [slug, vs] of Object.entries(CODE)) {
    for (const version of Object.keys(vs)) if (!MANIFESTS[slug]?.[version]) problems.push(`${slug}@${version}: code but no manifest`);
  }
  return { ok: problems.length === 0, problems };
}

// ── Phase B1: the ONE render pipeline, Developer-Mode-aware ──────────────────
// A developer's customization lives in the snapshot (a sibling of content). It
// is applied here, deterministically, as a post-render pass over the template's
// output — template-agnostic, so every template gets it identically and the
// shipped templates stay immutable (no per-version edits). With no customization
// the pass is a no-op and output is byte-identical to before. This runs for
// publish, preview, and restore because they all render through renderSnapshot.

const HTML_ESCAPE_TOKEN = /[^#0-9a-zA-Z_.,%()\-\s]/g; // token values are pre-validated; this is belt-and-suspenders

/** Build the developer <style> (theme tokens as :root vars + custom CSS) and the
 *  custom HTML block. Pure. Values are already sanitized upstream. */
export function devLayerFragments(dev: Snapshot['dev_customization']): { style: string; block: string } {
  if (!dev) return { style: '', block: '' };
  const tokens = dev.theme_tokens || {};
  const vars = Object.entries(tokens)
    .flatMap(([k, v]) => {
      const key = k.replace(/[^a-z0-9_]/gi, '');
      const val = String(v).replace(HTML_ESCAPE_TOKEN, '');
      const out = [`--${key}:${val}`];
      // Phase COMP: underscore tokens also emit their dash form (templates use
      // dash-cased vars like --accent-dark); additive, so existing output keeps.
      if (key.includes('_')) out.push(`--${key.replace(/_/g, '-')}:${val}`);
      return out;
    })
    .join(';');
  // Defense-in-depth: re-sanitize at render, never trust stored values. This is
  // a no-op for content already sanitized on save, but guarantees that even a
  // future write path that bypassed buildCustomization cannot become stored XSS
  // on the live site.
  const css = sanitizeDevCss(dev.custom_css || '');
  // a library font the style names loads from the site's own copy (lib/fonts.ts)
  const faces = fontFaceCss(libraryFontsIn(tokens));
  const style = (vars || css)
    ? `<style id="presence-dev">${vars ? `:root{${vars}}` : ''}${faces}${css ? `\n${css}` : ''}</style>`
    : '';
  const safeHtml = dev.custom_html ? sanitizeDevHtml(dev.custom_html) : '';
  const block = safeHtml ? `<div class="presence-dev-block">${safeHtml}</div>` : '';
  return { style, block };
}

/** Apply the developer layer to a rendered file map (HTML files only). Pure.
 *  Idempotent-safe: skips a file that already carries the marker. */
export function injectDevLayer(fileMap: FileMap, dev: Snapshot['dev_customization']): FileMap {
  const { style, block } = devLayerFragments(dev);
  if (!style && !block) return fileMap;
  const out: FileMap = {};
  for (const [path, contents] of Object.entries(fileMap)) {
    if (typeof contents === 'string' && path.endsWith('.html') && !contents.includes('id="presence-dev"')) {
      let html = contents;
      if (style) html = html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`;
      if (block) html = html.includes('</body>') ? html.replace('</body>', `${block}</body>`) : `${html}${block}`;
      out[path] = html;
    } else {
      out[path] = contents;
    }
  }
  return out;
}

/** Render a snapshot with its PINNED template version, then apply the developer
 *  layer from the SAME snapshot. This is the ONE render entry — publish, preview,
 *  and restore all call it, so a developer edit is indistinguishable from any
 *  other change: same snapshot → same render → same bytes. Throws only on unknown
 *  template/version or contract-version mismatch — never on content.
 *  `allSectionStyles` keeps every section style in the stylesheet (the builder's
 *  canvas, renderForBuilder); without it the site ships only the ones it uses. */
export async function renderSnapshot(snapshot: Snapshot, site: SiteConfig, opts: { allSectionStyles?: boolean } = {}): Promise<FileMap> {
  const t = getTemplate(snapshot.template_slug, snapshot.template_version);
  if (!t) throw new Error(`unknown template ${snapshot.template_slug}@${snapshot.template_version}`);
  if (t.manifest.content_contract_version !== snapshot.content_contract_version) {
    throw new Error(`contract mismatch: template consumes v${t.manifest.content_contract_version}, snapshot is v${snapshot.content_contract_version}`);
  }
  // Item 61: the owner's switch decides the counter; the privacy page reads the same switch.
  const counting = (snapshot.content as SnapshotContent)?.settings?.visit_counter !== false;
  // List item 175: switched off, AI assistants are asked to stay out in robots.txt.
  // items 48 and 120: an own page can leave out the site's header or footer, everywhere it is drawn
  const pages = (snapshot.content as SnapshotContent)?.settings?.pages;
  const drawn = withAiCrawlerChoice(tintFavicon(applyPageChrome(await t.render(snapshot, t.manifest, site), pages), snapshot.dev_customization?.theme_tokens?.accent, snapshot.template_slug), (snapshot.content as SnapshotContent)?.settings);
  // item 148: the pop-up and any form a "#form-<id>" link opens (lib/popup.ts), then item 131:
  // pages with the site's forms send them from the page (lib/site_send.ts)
  const content = snapshot.content as SnapshotContent;
  const dressed = injectSender(injectPopup(injectDevLayer(drawn, snapshot.dev_customization), content, site), content, site);
  // List item 152: the Google tag and the Meta Pixel, behind a cookie notice, on a site that has them.
  const tagged = injectAdTags(opts.allSectionStyles ? dressed : trimSectionStyles(dressed), content?.settings);
  return injectCsp(injectAnalytics(tagged, counting ? site.siteId : undefined));
}

/** What the builder's canvas and the studio's site cards draw (routes/preview.ts,
 *  agency/sites.ts). They share the preview cache under one key, so they must draw
 *  alike. Every section style stays: the canvas swaps in a section drawn on its own
 *  (POST /preview/section) before the save's full redraw, and that section may use a
 *  rule nothing else on the page does yet, like the dark band just picked for it. */
export function renderForBuilder(snapshot: Snapshot): Promise<FileMap> {
  return renderSnapshot(snapshot, { baseUrl: 'https://preview.invalid' }, { allSectionStyles: true });
}

// deterministic content hash (fnv1a-64), the one the templates name their stylesheet with
function fnv(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 ^ ((c << 1) + 1)) >>> 0; h2 = (h2 * 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// Item 106: every site ships only the section styles it uses. Each template's stylesheet
// carries the section styles (BLOCK_CSS) whole; this pass swaps them for the rules the site's
// pages can use (sectionStyles in lib/site_blocks.ts), read across every page, since a site
// has one stylesheet. The developer layer is already in, so its markup counts too. The
// stylesheet's name is its hash and visitors keep it for a year, so the trimmed one gets its
// own name and every page links to that: a site that adds a gallery can never be served a
// cached stylesheet without the gallery's rules.
export function trimSectionStyles(fileMap: FileMap): FileMap {
  const cssKey = Object.keys(fileMap).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k));
  const css = cssKey ? fileMap[cssKey] : undefined;
  if (typeof css !== 'string' || !css.includes(BLOCK_CSS)) return fileMap;
  const classes = new Set<string>();
  for (const [k, v] of Object.entries(fileMap)) if (k.endsWith('.html') && typeof v === 'string') pageClasses(v, classes);
  const trimmed = css.replace(BLOCK_CSS, () => sectionStyles(classes));
  const key = `assets/site-${fnv(trimmed)}.css`;
  const out: FileMap = {};
  for (const [k, v] of Object.entries(fileMap)) {
    if (k === cssKey) out[key] = trimmed;
    else out[k] = typeof v === 'string' && k.endsWith('.html') ? v.split(`/${cssKey}`).join(`/${key}`) : v;
  }
  return out;
}

// Item 99: the favicon wears the accent the site chose (a palette, a brand kit or Developer
// Mode), as the page's buttons and links do. Each template marks the part that carries it
// with data-accent="fill" or "stroke"; with no accent chosen it keeps the template's own.
// A template that keeps its own colours over the style layer (Slate) keeps its favicon too.
export const FIXED_COLOR_TEMPLATES = new Set(['slate']);
export function tintFavicon(fileMap: FileMap, accent: unknown, templateSlug: string): FileMap {
  const svg = fileMap['favicon.svg'];
  if (typeof svg !== 'string' || typeof accent !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(accent) || FIXED_COLOR_TEMPLATES.has(templateSlug)) return fileMap;
  const tinted = svg.replace(/<[^>]*\bdata-accent="(fill|stroke)"[^>]*>/g, (tag, attr) => tag.replace(new RegExp(`\\b${attr}="#[0-9a-fA-F]{3,8}"`), `${attr}="${accent}"`));
  return tinted === svg ? fileMap : { ...fileMap, 'favicon.svg': tinted };
}

// ── Published-site Content-Security-Policy (defense-in-depth) ────────────────
// A second layer beneath the developer-HTML sanitizer. It ships ONLY directives
// that add real protection with zero breakage risk on our output:
//   • object-src 'none'  — blocks <object>/<embed>/plugin injection
//   • base-uri 'self'    — blocks a <base> tag hijacking every relative URL
// Scripts/styles/images stay permissive ('unsafe-inline', https:, data:) because
// the templates legitimately use an inline analytics script, inline JSON-LD +
// styles, and storage-hosted images. Tightening script-src (to actually block
// injected inline JS) requires hashing/externalising the per-site analytics
// script AND a browser smoke on a real published page — QUEUED, not shipped here.
// Exported as the ONE source of truth for the published-site CSP policy string.
// The <meta> tag below (defense-in-depth) and the response-header CSP that
// routes/publish.ts ships via lib/security_headers.ts both derive from THIS
// constant, so the two can never drift apart.
export const PUBLISHED_CSP = "default-src 'self' https: data: 'unsafe-inline'; object-src 'none'; base-uri 'self'";
export function injectCsp(fileMap: FileMap): FileMap {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PUBLISHED_CSP}">`;
  const out: FileMap = {};
  for (const [path, contents] of Object.entries(fileMap)) {
    if (typeof contents === 'string' && path.endsWith('.html') && !contents.includes('Content-Security-Policy')) {
      out[path] = contents.includes('<head>')
        ? contents.replace('<head>', `<head>${meta}`)
        : (contents.includes('</head>') ? contents.replace('</head>', `${meta}</head>`) : `${meta}${contents}`);
    } else out[path] = contents;
  }
  return out;
}

/** AN-2: inject the ONE first-party analytics tracker into every rendered page.
 *  Mirrors injectDevLayer — a single template-agnostic pass over .html files,
 *  idempotent, before </body>. Skips entirely when the site id or the function
 *  base URL is absent (e.g. local preview), so bytes are unchanged there. */
export function injectAnalytics(fileMap: FileMap, siteId?: string): FileMap {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  if (!siteId || !base) return fileMap;
  const tag = trackerScript(siteId, `${base}/functions/v1/presence`);
  const out: FileMap = {};
  for (const [path, contents] of Object.entries(fileMap)) {
    if (typeof contents === 'string' && path.endsWith('.html') && !contents.includes('id="presence-analytics"') && contents.includes('</body>')) {
      out[path] = contents.replace('</body>', `${tag}</body>`);
    } else {
      out[path] = contents;
    }
  }
  return out;
}
