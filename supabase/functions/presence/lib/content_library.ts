// ── CL-1 · Content Library — pure helpers ────────────────────────────────────
// A library item is exactly ONE validated structured block — the SAME model the
// block editor + renderer already use (reuses validateBlocks; no duplicate block
// definitions). This file only names + validates; storage/routes live elsewhere.
import { validateBlocks } from './site_blocks.ts';
import type { SiteBlock } from './render_types.ts';

export function cleanLibraryName(raw: unknown): string {
  let s = '';
  for (const ch of String(raw ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32) s += ch; }
  return s.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Validate a single saveable block by running it through the ONE block validator.
 *  Returns the validated (stored-shape) block, or null if it isn't a real block. */
export function validateLibraryBlock(raw: unknown): SiteBlock | null {
  const blocks = validateBlocks(Array.isArray(raw) ? raw : [raw]);
  return blocks.length ? blocks[0] as SiteBlock : null;
}
