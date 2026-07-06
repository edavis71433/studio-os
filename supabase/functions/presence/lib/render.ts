// ── Template registry + render invocation ────────────────────────────────────
// Templates are versioned folders statically imported here. Shipping a template
// version = deploying the function (deliberately boring, per blueprint §2).
// Old versions are never deleted while any site pins them.
import type { RenderFn, Snapshot, SiteConfig, TemplateManifest, FileMap } from './render_types.ts';
import { render as restaurantClassic_1_0_0 } from '../templates/restaurant-classic/1.0.0/render.ts';
import manifest_rc_1_0_0 from '../templates/restaurant-classic/1.0.0/manifest.json' with { type: 'json' };

const REGISTRY: Record<string, Record<string, { render: RenderFn; manifest: TemplateManifest }>> = {
  'restaurant-classic': {
    '1.0.0': { render: restaurantClassic_1_0_0, manifest: manifest_rc_1_0_0 as unknown as TemplateManifest },
  },
};

export function getTemplate(slug: string, version: string): { render: RenderFn; manifest: TemplateManifest } | null {
  return REGISTRY[slug]?.[version] ?? null;
}

/** Render a snapshot with its PINNED template version. Throws only on unknown
 *  template/version or contract-version mismatch — never on content (publish
 *  validation guarantees a valid snapshot before render is ever called). */
export function renderSnapshot(snapshot: Snapshot, site: SiteConfig): FileMap {
  const t = getTemplate(snapshot.template_slug, snapshot.template_version);
  if (!t) throw new Error(`unknown template ${snapshot.template_slug}@${snapshot.template_version}`);
  if (t.manifest.content_contract_version !== snapshot.content_contract_version) {
    throw new Error(`contract mismatch: template consumes v${t.manifest.content_contract_version}, snapshot is v${snapshot.content_contract_version}`);
  }
  return t.render(snapshot, t.manifest, site);
}
