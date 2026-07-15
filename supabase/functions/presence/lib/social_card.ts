// ── G31 · Branded social cards — one photo → many platform formats ───────────
// Adobe Express "Resize" re-lays out a whole composed design per platform. Our
// honest equivalent: a COMPOSED social card — the owner's photo (focal-aware
// crop) plus their brand (accent bar, logo, business name) and an optional
// headline, re-laid-out per platform preset. This module is the pure composer:
// no I/O, no clock, no randomness — same input → same SVG bytes. The photo and
// logo arrive as PLATFORM-HOSTED variant URLs (the route signs them from the
// same private bucket the width variants use — never an external origin); the
// SVG references them via <image href>, so nothing is rasterized server-side.
//
// Dimensions REUSE the Visual Studio specs (visual/contract.ts) where the
// platform matches — square post / story / link preview stay one source of
// truth with social_crops.ts — and add the two Express presets we don't have
// yet (X 1200×675, Pinterest 1000×1500). The focal-aware crop is real geometry:
// social_crops.focalCropRect drives a nested-<svg> viewBox, so what the card
// keeps visible is exactly what the focal cropper keeps visible. Every dynamic
// string (business name, headline, alt, URLs) is entity-escaped with the SAME
// esc/attr the markdown pipeline uses; colours are normalized hex or defaults.
import { ASSET_SPECS } from '../visual/contract.ts';
import { clampFocal, focalCropRect } from './social_crops.ts';
import { esc, attr } from './markdown.ts';
import { normHex, readableOnWhiteText, darken, mix } from './brand_kit.ts';

export type CardPlatform = 'instagram' | 'story' | 'facebook' | 'x' | 'pinterest';

export interface CardPreset {
  platform: CardPlatform;
  label: string;         // what the customer calls it
  purpose: string;       // one plain sentence: where it's used
  width: number;
  height: number;
  aspect: string;
}

/** The platform presets. Instagram/story/facebook reuse the EXACT Visual Studio
 *  dimensions (the same ones social_crops serves); X and Pinterest extend the
 *  list with their platform-correct sizes. */
export const CARD_PRESETS: Record<CardPlatform, CardPreset> = {
  instagram: { platform: 'instagram', label: 'Instagram post', purpose: 'A square post for your Instagram feed.',
    width: ASSET_SPECS.social_square.width, height: ASSET_SPECS.social_square.height, aspect: ASSET_SPECS.social_square.aspect },
  story: { platform: 'story', label: 'Story', purpose: 'A full-screen Instagram or Facebook story.',
    width: ASSET_SPECS.social_story.width, height: ASSET_SPECS.social_story.height, aspect: ASSET_SPECS.social_story.aspect },
  facebook: { platform: 'facebook', label: 'Facebook link', purpose: 'The card shown when your link is shared on Facebook.',
    width: ASSET_SPECS.open_graph.width, height: ASSET_SPECS.open_graph.height, aspect: ASSET_SPECS.open_graph.aspect },
  x: { platform: 'x', label: 'X post', purpose: 'A summary card for X (Twitter).',
    width: 1200, height: 675, aspect: '16:9' },
  pinterest: { platform: 'pinterest', label: 'Pinterest pin', purpose: 'A tall pin for Pinterest boards.',
    width: 1000, height: 1500, aspect: '2:3' },
};
export const CARD_PLATFORMS = Object.keys(CARD_PRESETS) as CardPlatform[];
export function isCardPlatform(p: unknown): p is CardPlatform { return typeof p === 'string' && (CARD_PLATFORMS as string[]).includes(p); }

export interface CardMedia {
  url: string;                    // platform-hosted (signed) variant URL of the UNCROPPED photo
  width?: number | null;          // source pixel dims — enable the focal-aware crop
  height?: number | null;
  focal?: { x: number; y: number };  // 0–100 %, like the media rows
  alt?: string;
}
export interface CardBrand {
  accent: string;                 // hex (brand kit primary, contrast-derived upstream or here)
  accent_dark?: string;
  logo_url?: string | null;       // platform-hosted (signed) logo variant, if any
}
export interface CardInput {
  media: CardMedia;
  brand: CardBrand;
  business_name: string;
  headline?: string;
}
export interface SocialCard { platform: CardPlatform; label: string; w: number; h: number; svg: string }

export const HEADLINE_MAX = 120;
export const NAME_MAX = 60;

const FONT_DISPLAY = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const INK = '#1b1525';           // scrim/base ink — the platform's own ink token

/** Only a platform-hosted https URL may enter an <image href>. Anything else
 *  (data:, javascript:, relative tricks, whitespace) is dropped. Pure. */
export function httpsUrl(u: unknown): string | null {
  const s = String(u ?? '').trim();
  return /^https:\/\/[^\s"'<>\\]+$/i.test(s) ? s : null;
}

/** Deterministic greedy word-wrap for the headline: at most `maxLines` lines of
 *  ~`perLine` characters; a truncated tail gets an ellipsis. Pure. */
export function wrapHeadline(text: string, perLine: number, maxLines = 2): string[] {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, HEADLINE_MAX);
  if (!t) return [];
  const words = t.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (w.length > perLine) w = w.slice(0, Math.max(1, perLine - 1)) + '…';
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= perLine) { cur = cand; continue; }
    lines.push(cur || w);
    cur = cur ? w : '';
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length > maxLines || (lines.length === maxLines && cur && lines[maxLines - 1] !== cur)) {
    const last = lines[maxLines - 1].replace(/[ .,;:!?…]+$/, '');
    lines.length = maxLines;
    lines[maxLines - 1] = `${last.slice(0, Math.max(1, perLine - 1))}…`;
  }
  return lines;
}

/** Compose ONE platform card as a deterministic standalone SVG. Pure. */
export function composeCard(platform: CardPlatform, input: CardInput): SocialCard {
  const p = CARD_PRESETS[platform];
  const W = p.width, H = p.height;

  // ── sanitized ingredients (defense in depth — the route caps these too) ──
  const name = String(input.business_name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  const primary = normHex(input.brand?.accent) || '#5b3fa0';
  const accent = readableOnWhiteText(primary);                       // white text on it stays readable
  const accentDark = normHex(input.brand?.accent_dark || '') || darken(accent, 0.16);
  const accentSoft = mix(primary, '#ffffff', 0.9);
  const photo = httpsUrl(input.media?.url);
  const logo = httpsUrl(input.brand?.logo_url);
  const alt = String(input.media?.alt ?? '').slice(0, 200);

  // ── layout constants (integer, per preset — same input → same bytes) ──
  const minSide = Math.min(W, H);
  const pad = Math.round(minSide * 0.045);
  const barH = Math.round(minSide * 0.13);
  const imgH = H - barH;
  const logoS = Math.round(barH * 0.64);
  const nameSize = Math.round(barH * 0.34);
  const hs = Math.round(minSide * 0.062);                            // headline font size
  const lineH = Math.round(hs * 1.28);
  const perLine = Math.max(8, Math.floor((W - 2 * pad) / (hs * 0.56)));
  const lines = wrapHeadline(input.headline ?? '', perLine, 2);

  // ── the photo: focal-aware crop via a nested-<svg> viewBox (real geometry,
  //    the SAME rect social_crops computes), else centre-crop, else a soft wash ──
  const focal = clampFocal(input.media?.focal?.x, input.media?.focal?.y);
  const srcW = Math.max(0, Math.round(Number(input.media?.width) || 0));
  const srcH = Math.max(0, Math.round(Number(input.media?.height) || 0));
  let photoEl: string;
  if (photo && srcW > 0 && srcH > 0) {
    const r = focalCropRect(srcW, srcH, W, imgH, focal);
    photoEl = `<svg x="0" y="0" width="${W}" height="${imgH}" viewBox="${r.x} ${r.y} ${r.w} ${r.h}" preserveAspectRatio="xMidYMid slice"><image href="${attr(photo)}" x="0" y="0" width="${srcW}" height="${srcH}" preserveAspectRatio="xMidYMid slice"/></svg>`;
  } else if (photo) {
    photoEl = `<image href="${attr(photo)}" x="0" y="0" width="${W}" height="${imgH}" preserveAspectRatio="xMidYMid slice"/>`;
  } else {
    photoEl = `<rect x="0" y="0" width="${W}" height="${imgH}" fill="${accentSoft}"/>`;
  }

  // ── optional headline: an ink scrim + up to two lines, above the brand bar ──
  let headlineEl = '';
  if (lines.length) {
    const scrimPad = Math.round(hs * 0.55);
    const scrimH = lines.length * lineH + 2 * scrimPad;
    const y0 = imgH - scrimH;
    const texts = lines.map((ln, i) =>
      `<text x="${pad}" y="${y0 + scrimPad + i * lineH + Math.round(hs * 0.82)}" fill="#ffffff" font-family="${attr(FONT_DISPLAY)}" font-size="${hs}" font-weight="600">${esc(ln)}</text>`).join('');
    headlineEl = `<rect x="0" y="${y0}" width="${W}" height="${scrimH}" fill="${INK}" opacity="0.62"/>${texts}`;
  }

  // ── the brand bar: accent field, logo, business name ──
  const logoEl = logo ? `<image href="${attr(logo)}" x="${pad}" y="${imgH + Math.round((barH - logoS) / 2)}" width="${logoS}" height="${logoS}" preserveAspectRatio="xMidYMid meet"/>` : '';
  const nameX = logo ? pad + logoS + Math.round(pad * 0.6) : pad;
  const nameEl = name ? `<text x="${nameX}" y="${imgH + Math.round(barH / 2) + Math.round(nameSize * 0.34)}" fill="#ffffff" font-family="${attr(FONT_DISPLAY)}" font-size="${nameSize}" font-weight="600" letter-spacing="-0.01em">${esc(name)}</text>` : '';
  const barEl = `<rect x="0" y="${imgH}" width="${W}" height="${barH}" fill="${accent}"/><rect x="0" y="${imgH}" width="${W}" height="${Math.max(2, Math.round(barH * 0.05))}" fill="${accentDark}"/>${logoEl}${nameEl}`;

  const title = name ? `${p.label} — ${name}` : p.label;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(title)}"><title>${esc(title)}</title>${alt ? `<desc>${esc(alt)}</desc>` : ''}<rect width="${W}" height="${H}" fill="#f4f2ef"/>${photoEl}${headlineEl}${barEl}</svg>`;
  return { platform, label: p.label, w: W, h: H, svg };
}

/** Compose the full set (or a chosen subset) of platform cards. Pure. */
export function composeSocialCards(input: CardInput, platforms: CardPlatform[] = CARD_PLATFORMS): SocialCard[] {
  return platforms.filter(isCardPlatform).map((p) => composeCard(p, input));
}
