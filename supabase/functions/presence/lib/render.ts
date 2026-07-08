// ── Template registry + render invocation ────────────────────────────────────
// Templates are versioned folders statically imported here. Shipping a template
// version = deploying the function (deliberately boring, per blueprint §2).
// Old versions are never deleted while any site pins them.
import type { RenderFn, Snapshot, SiteConfig, TemplateManifest, FileMap } from './render_types.ts';
import { render as restaurantClassic_1_0_0 } from '../templates/restaurant-classic/1.0.0/render.ts';
import manifest_rc_1_0_0 from '../templates/restaurant-classic/1.0.0/manifest.json' with { type: 'json' };
import { render as businessClassic_1_0_0 } from '../templates/business-classic/1.0.0/render.ts';
import manifest_bc_1_0_0 from '../templates/business-classic/1.0.0/manifest.json' with { type: 'json' };

const REGISTRY: Record<string, Record<string, { render: RenderFn; manifest: TemplateManifest }>> = {
  'restaurant-classic': {
    '1.0.0': { render: restaurantClassic_1_0_0, manifest: manifest_rc_1_0_0 as unknown as TemplateManifest },
  },
  'business-classic': {   // Phase T3: the neutral, vocabulary-driven production default
    '1.0.0': { render: businessClassic_1_0_0, manifest: manifest_bc_1_0_0 as unknown as TemplateManifest },
  },
};

export function getTemplate(slug: string, version: string): { render: RenderFn; manifest: TemplateManifest } | null {
  return REGISTRY[slug]?.[version] ?? null;
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
  return injectDevLayer(t.render(snapshot, t.manifest, site), snapshot.dev_customization);
}
