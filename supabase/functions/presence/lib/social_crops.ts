// ── Focal-aware social crops — pure cores ─────────────────────────────────────
// From a stored focal point (focal_x/focal_y, 0-100 %) produce the correct social
// aspect ratios (square / portrait / story / link-preview). The DIMENSIONS are the
// EXACT specs already defined for AI Visual Studio (visual/contract.ts) — one
// source of truth for "what size is a square post / a story / an OG image", reused
// here so the library and the Studio never disagree.
//
// No I/O here. The route turns a spec into a signed self-hosted transform URL via
// the SAME Supabase image transform used for the width variants (media.ts) — never
// an external origin. This module only computes: which ratios, the transform params
// (width + height + cover, i.e. a real HEIGHT crop, not just a width resize), the
// focal-aware crop geometry, and the CSS object-position for a faithful preview.
import { ASSET_SPECS, type AssetSpec } from '../visual/contract.ts';

export type SocialCropKey = 'square' | 'portrait' | 'story' | 'og';

/** The social ratios, each reusing the platform-correct dimensions from the Visual
 *  Studio contract (square 1:1 · portrait 4:5 · story 9:16 · link-preview 1.91:1). */
export const SOCIAL_CROPS: Record<SocialCropKey, { key: SocialCropKey; label: string; purpose: string; spec: AssetSpec }> = {
  square:   { key: 'square',   label: 'Square',        purpose: 'A square post for Instagram or Facebook.',        spec: ASSET_SPECS.social_square },
  portrait: { key: 'portrait', label: 'Portrait',      purpose: 'A taller post that fills more of the feed.',       spec: ASSET_SPECS.social_portrait },
  story:    { key: 'story',    label: 'Story',         purpose: 'A full-screen story or reel cover.',               spec: ASSET_SPECS.social_story },
  og:       { key: 'og',       label: 'Link preview',  purpose: 'The image shown when your page is shared as a link.', spec: ASSET_SPECS.open_graph },
};
export const SOCIAL_CROP_KEYS = Object.keys(SOCIAL_CROPS) as SocialCropKey[];
export function isSocialCropKey(k: unknown): k is SocialCropKey { return typeof k === 'string' && (SOCIAL_CROP_KEYS as string[]).includes(k); }

/** Clamp a focal coordinate to the photo (0-100 %); default to centre when absent.
 *  Mirrors the serializer's clamp so preview and publish agree. Pure. */
export function clampFocal(fx: unknown, fy: unknown): { x: number; y: number } {
  const c = (v: unknown, d: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(100, Math.max(0, Math.round(n)));
  };
  return { x: c(fx, 50), y: c(fy, 50) };
}

/** CSS object-position for a faithful, focal-aware PREVIEW crop (the same technique
 *  the published templates use — object-position drives which part stays visible). */
export function objectPosition(focal: { x: number; y: number }): string {
  const f = clampFocal(focal.x, focal.y);
  return `${f.x}% ${f.y}%`;
}

/** The transform params for one social size: a real cover crop to the target W×H
 *  (height crop, not just a width resize), self-hosted webp. Deterministic. */
export interface SocialTransform { width: number; height: number; resize: 'cover'; format: 'webp'; quality: number }
export function socialTransform(spec: AssetSpec, quality = 80): SocialTransform {
  return { width: spec.width, height: spec.height, resize: 'cover', format: 'webp', quality };
}
/** A deterministic, URL-safe query string for the self-hosted render endpoint.
 *  Stable order + no spaces so URLs are cacheable and testable. Pure. */
export function socialTransformQuery(spec: AssetSpec, quality = 80): string {
  const t = socialTransform(spec, quality);
  return `width=${t.width}&height=${t.height}&resize=${t.resize}&format=${t.format}&quality=${t.quality}`;
}

/** Focal-aware crop GEOMETRY in source pixels: the largest rectangle of the source
 *  with the target ratio, positioned so the focal point stays framed (clamped to
 *  the source edges). This is exactly what a focal-aware cropper keeps visible; it
 *  is available to any consumer that can crop by rect. Pure + deterministic. */
export interface CropRect { x: number; y: number; w: number; h: number }
export function focalCropRect(srcW: number, srcH: number, targetW: number, targetH: number, focal: { x: number; y: number }): CropRect {
  const sw = Math.max(1, Math.round(srcW)), sh = Math.max(1, Math.round(srcH));
  const f = clampFocal(focal.x, focal.y);
  const targetRatio = targetW / targetH;
  const srcRatio = sw / sh;
  let w: number, h: number, x: number, y: number;
  if (srcRatio > targetRatio) {
    // source is wider than the target → crop the sides (keep full height)
    h = sh;
    w = Math.min(sw, Math.max(1, Math.round(sh * targetRatio)));
    const cx = (f.x / 100) * sw;                       // focal in source px
    x = Math.round(Math.min(Math.max(cx - w / 2, 0), sw - w));
    y = 0;
  } else {
    // source is taller (or equal) → crop top/bottom (keep full width)
    w = sw;
    h = Math.min(sh, Math.max(1, Math.round(sw / targetRatio)));
    const cy = (f.y / 100) * sh;
    y = Math.round(Math.min(Math.max(cy - h / 2, 0), sh - h));
    x = 0;
  }
  return { x, y, w, h };
}

/** The full crop set for one asset — specs + transform + preview position + (when
 *  source dims are known) the focal crop geometry. Route signs a URL per entry. */
export interface SocialCropInfo {
  key: SocialCropKey; label: string; purpose: string; aspect: string;
  width: number; height: number; transform_query: string; object_position: string;
  crop_rect?: CropRect;
}
export function socialCropList(focal: { x: number; y: number }, source?: { width?: number | null; height?: number | null }): SocialCropInfo[] {
  const pos = objectPosition(focal);
  const sw = Number(source?.width) || 0, sh = Number(source?.height) || 0;
  return SOCIAL_CROP_KEYS.map((key) => {
    const { label, purpose, spec } = SOCIAL_CROPS[key];
    const info: SocialCropInfo = {
      key, label, purpose, aspect: spec.aspect,
      width: spec.width, height: spec.height,
      transform_query: socialTransformQuery(spec),
      object_position: pos,
    };
    if (sw > 0 && sh > 0) info.crop_rect = focalCropRect(sw, sh, spec.width, spec.height, focal);
    return info;
  });
}
