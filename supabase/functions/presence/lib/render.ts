// ── Template registry + render invocation ────────────────────────────────────
// Templates are versioned folders statically imported here. Shipping a template
// version = deploying the function (deliberately boring, per blueprint §2).
// Old versions are never deleted while any site pins them.
import type { RenderFn, Snapshot, SiteConfig, TemplateManifest, FileMap } from './render_types.ts';
import { render as restaurantClassic_1_0_0 } from '../templates/restaurant-classic/1.0.0/render.ts';
import manifest_rc_1_0_0 from '../templates/restaurant-classic/1.0.0/manifest.json' with { type: 'json' };
import { render as businessClassic_1_0_0 } from '../templates/business-classic/1.0.0/render.ts';
import manifest_bc_1_0_0 from '../templates/business-classic/1.0.0/manifest.json' with { type: 'json' };
import { render as editorial_1_0_0 } from '../templates/editorial/1.0.0/render.ts';
import manifest_ed_1_0_0 from '../templates/editorial/1.0.0/manifest.json' with { type: 'json' };
import { trackerScript } from './visits.ts';

// ── FD-T2: indexed, lazy-ready template registry ─────────────────────────────
// slug → version → LOADER. Render resolution goes through this ONE boundary and is
// memoized, so: (a) the catalog/index is metadata-first, (b) integrity is guardable
// at scale, and (c) a future switch to per-version code-splitting is a change to the
// loaders ALONE. Static imports are kept (blueprint §2: shipping a version = deploying
// the function), so getTemplate stays SYNCHRONOUS — the frozen render contract and the
// sync renderSnapshot path (publish/preview) are untouched. Enabling true dynamic-import
// code-splitting is FD-T2.1 (staged: it would make renderSnapshot async and needs a
// live-publish bundling validation).
interface TemplateEntry { render: RenderFn; manifest: TemplateManifest }
const LOADERS: Record<string, Record<string, () => TemplateEntry>> = {
  'restaurant-classic': { '1.0.0': () => ({ render: restaurantClassic_1_0_0, manifest: manifest_rc_1_0_0 as unknown as TemplateManifest }) },
  'business-classic': { '1.0.0': () => ({ render: businessClassic_1_0_0, manifest: manifest_bc_1_0_0 as unknown as TemplateManifest }) },  // Phase T3 production default
  'editorial': { '1.0.0': () => ({ render: editorial_1_0_0, manifest: manifest_ed_1_0_0 as unknown as TemplateManifest }) },               // Phase PT premium family
};
const _entryCache = new Map<string, TemplateEntry>();

export function getTemplate(slug: string, version: string): TemplateEntry | null {
  const key = `${slug}@${version}`;
  const cached = _entryCache.get(key);
  if (cached) return cached;
  const loader = LOADERS[slug]?.[version];
  if (!loader) return null;
  const entry = loader();
  _entryCache.set(key, entry);
  return entry;
}

export interface TemplateIndexEntry { slug: string; name: string; versions: string[]; latest: string; content_contract_version: number }
let _index: TemplateIndexEntry[] | null = null;
/** The template catalog — computed once, metadata-first (no repeated scanning). */
export function templateIndex(): TemplateIndexEntry[] {
  if (_index) return _index;
  _index = Object.entries(LOADERS).map(([slug, vs]) => {
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
  for (const [slug, vs] of Object.entries(LOADERS)) {
    for (const version of Object.keys(vs)) {
      const t = getTemplate(slug, version);
      if (!t) { problems.push(`${slug}@${version}: not loadable`); continue; }
      if (t.manifest.slug !== slug) problems.push(`${slug}@${version}: manifest.slug=${t.manifest.slug}`);
      if (t.manifest.version !== version) problems.push(`${slug}@${version}: manifest.version=${t.manifest.version}`);
      if (typeof t.manifest.content_contract_version !== 'number') problems.push(`${slug}@${version}: missing content_contract_version`);
    }
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
  const css = dev.custom_css || '';
  const style = (vars || css)
    ? `<style id="presence-dev">${vars ? `:root{${vars}}` : ''}${css ? `\n${css}` : ''}</style>`
    : '';
  const block = dev.custom_html ? `<div class="presence-dev-block">${dev.custom_html}</div>` : '';
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
 *  template/version or contract-version mismatch — never on content. */
export function renderSnapshot(snapshot: Snapshot, site: SiteConfig): FileMap {
  const t = getTemplate(snapshot.template_slug, snapshot.template_version);
  if (!t) throw new Error(`unknown template ${snapshot.template_slug}@${snapshot.template_version}`);
  if (t.manifest.content_contract_version !== snapshot.content_contract_version) {
    throw new Error(`contract mismatch: template consumes v${t.manifest.content_contract_version}, snapshot is v${snapshot.content_contract_version}`);
  }
  return injectAnalytics(injectDevLayer(t.render(snapshot, t.manifest, site), snapshot.dev_customization), site.siteId);
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
