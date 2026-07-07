// ── AI Visual Studio — generation (pure planning + a thin model boundary) ────
// planGeneration() is PURE: it turns a request + brand into a VisualPlan (a
// proposed, approval-gated plan) with no variations yet. runVariations() is the
// one I/O boundary: it asks the injected model for images and returns their raw
// bytes — storage is store.ts's job. Never throws; a missing model is an honest
// "not available", not a failure.
import { buildBrief } from './brief.ts';
import { specFor } from './contract.ts';
import type { VisualKind, VisualPlan, BrandSnapshot, AssetSpec } from './contract.ts';
import type { ImageModelFn } from './model.ts';

/** Build the BrandSnapshot from a site's brand profile + industry + palette. Pure. */
export function brandSnapshotFrom(profile: any, industry: string, palette: string[]): BrandSnapshot {
  const list = (v: unknown): string[] => Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 8) : [];
  return {
    palette: (palette || []).filter((c) => /^#?[0-9a-fA-F]{3,8}$/.test(String(c))).slice(0, 5),
    personality: String(profile?.personality || profile?.voice_characteristics || '').slice(0, 200),
    vocabulary: list(profile?.words_prefer || profile?.preferred_vocabulary),
    avoid: list(profile?.words_avoid),
    industry: String(industry || '').slice(0, 40),
  };
}

/** The proposed plan for a generation — no images yet. Pure and testable. */
export function planGeneration(req: { kind: VisualKind; subject: string; brand: BrandSnapshot }): VisualPlan {
  const spec: AssetSpec = specFor(req.kind);
  const brief = buildBrief(req.subject, spec, req.brand);
  const claimNote = brief.removed_claims.length
    ? ` We left out claim wording (${brief.removed_claims.join(', ')}) — an image can’t stand behind a claim.`
    : '';
  return {
    kind: req.kind,
    title: `${spec.label}: ${(req.subject || 'a new image').slice(0, 60)}`,
    summary: `We’ll create a few ${spec.label.toLowerCase()} options (${spec.width}×${spec.height}) shaped by your brand. Nothing is saved or shown anywhere until you pick one and approve it.${claimNote}`,
    risk: 'Low. These are drafts — they don’t touch your library, your website, or anywhere else until you approve one.',
    reversible: true,
    rollback: 'Discard any option you don’t want; a stored image can be removed from your library any time.',
    requires_approval: true,
    brief: req.subject,
    prompt: brief.prompt,
    brand_snapshot: req.brand,
    width: brief.width,
    height: brief.height,
    variations: [],
    provenance: 'ai',
  };
}

export interface RunResult {
  ok: boolean;
  images: Uint8Array[];
  model: string;
  reason?: 'not_available' | 'failed';
  error?: string;
}

/** Ask the model for `count` images for this plan. The model is injected; when it
 *  is null the Studio is honestly not available on this environment yet. */
export async function runVariations(plan: VisualPlan, modelFn: ImageModelFn | null, count: number): Promise<RunResult> {
  if (!modelFn) return { ok: false, images: [], model: '', reason: 'not_available' };
  const brief = buildBrief(plan.brief, specFor(plan.kind), plan.brand_snapshot);
  const r = await modelFn({ prompt: brief.prompt, negative: brief.negative, width: plan.width, height: plan.height, count: Math.max(1, Math.min(4, count)) });
  if (!r.ok) return { ok: false, images: [], model: r.model, reason: 'failed', error: r.error };
  return { ok: true, images: r.images, model: r.model };
}
