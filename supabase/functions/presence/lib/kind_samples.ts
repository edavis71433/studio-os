// ── One sample business for each kind of business (builder list item 331) ─────
// The ten kinds in + New site (lib/design_gallery.ts families) each have a whole sample
// site, written once in kind_samples.json (scripts/thumbnails/kind_samples.ts makes it):
// a name, words, services, reviews, questions, hours, and the kind's stand-in picture
// (lib/stand_in.ts) wherever a photo goes. The design pictures in + New site are shot from
// these, eight designs per kind, so a salon owner sees eight salons; "See it full size"
// draws the same sample live in the design picked. Fake names only. Pure, apart from the
// one render.
import SAMPLES from './kind_samples.json' with { type: 'json' };
import { FAMILIES, familyOf, type Family } from './design_gallery.ts';
import { getTemplate, latestTemplateVersion, renderSnapshot } from './render.ts';
import type { Snapshot, SnapshotContent } from './render_types.ts';

/** Samples carry no clock: one fixed date keeps every picture and every full-size view the same. */
export const SAMPLE_CREATED_AT = '2026-11-22T00:00:00.000Z';

/** The family a kind names: a family itself, or any industry key ("salon" → beauty). Pure. */
export const sampleFamily = (kind: string | null | undefined): Family =>
  (FAMILIES as readonly string[]).includes(String(kind)) ? kind as Family : familyOf(kind);

/** A copy of a kind's sample words, so a caller can't change the shared one. Pure. */
export function kindSampleContent(kind: string | null | undefined): SnapshotContent {
  return structuredClone((SAMPLES as Record<string, unknown>)[sampleFamily(kind)]) as SnapshotContent;
}

/** A kind's sample as a snapshot of one design. Null for a design that isn't built in. Pure. */
export function sampleSnapshot(kind: string | null | undefined, templateSlug: string): Snapshot | null {
  const version = latestTemplateVersion(templateSlug);
  if (!version || !getTemplate(templateSlug, version)) return null;
  return { content: kindSampleContent(kind), content_contract_version: 1, template_slug: templateSlug, template_version: version, created_at: SAMPLE_CREATED_AT };
}

/** "See it full size": a kind's sample home page in one design, as one page a frame can show
 *  (the stylesheet inside it, no scripts, photos from the app). Null for an unknown design. */
const PAGES = new Map<string, string>();   // drawn once per design and kind for this instance: the samples never change
export async function samplePage(kind: string | null | undefined, templateSlug: string): Promise<string | null> {
  const key = `${templateSlug}|${sampleFamily(kind)}`;
  if (PAGES.has(key)) return PAGES.get(key)!;
  const snap = sampleSnapshot(kind, templateSlug);
  if (!snap) return null;
  const files = await renderSnapshot(snap, { baseUrl: 'https://example.com' });
  let html = String(files['index.html'] || '');
  const css = Object.keys(files).find((k) => k.startsWith('assets/') && k.endsWith('.css'));
  if (css) html = html.replace(/<link rel="stylesheet" href="[^"]*">/, () => `<style>${files[css]}</style>`);
  const page = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '')
    .replace(/<link\b[^>]*\brel="(?:preload|prefetch|modulepreload|preconnect|dns-prefetch|manifest|icon|apple-touch-icon|alternate|canonical)"[^>]*>/gi, '')
    .replace(/<source\b[^>]*>/gi, '')
    .replace(/\s(?:srcset|sizes)="[^"]*"/gi, '')
    .replaceAll('https://example.com', '');
  PAGES.set(key, page);
  return page;
}
