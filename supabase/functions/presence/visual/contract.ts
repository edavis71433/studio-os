// ── AI Visual Studio — the contract (V1) ────────────────────────────────────
// One shape for every AI-generated image, and one lifecycle: a generation is a
// PROPOSED plan the customer reviews; approval promotes the chosen variation
// into the media library. This module is DATA + pure types — no I/O, no model.
//
// The laws this obeys (existing, not new):
//   • Manual parity (Amendment 1): uploading your own photos is untouched and
//     never degraded — the Studio is an addition, never a requirement.
//   • Approval before use (the ritual + Approved-Plan spine): nothing enters the
//     library, and nothing reaches the live site, until the customer approves it.
//   • Provenance honesty (commercial constitution): a stored asset records origin
//     `ai_approved` — the customer owns it on acceptance, exactly like AI text.
//   • The fact law (Law 11): a generated image never bakes in an unverifiable
//     CLAIM (fake awards, ratings, prices, "#1", certifications). Graphics, not
//     fabricated evidence.
import type { ApprovedPlanBase } from '../lib/approved_plan.ts';

/** The asset kinds a customer can make. Plain labels; real, correct dimensions. */
export type VisualKind =
  | 'hero' | 'social_square' | 'social_portrait' | 'social_story' | 'open_graph' | 'general';

export interface AssetSpec {
  kind: VisualKind;
  label: string;        // what the customer calls it
  purpose: string;      // one plain sentence: where it's used
  width: number;
  height: number;
  aspect: string;       // human-readable ratio, for the UI
}

/** The catalogue. Dimensions are the real, platform-correct sizes. */
export const ASSET_SPECS: Record<VisualKind, AssetSpec> = {
  hero: {
    kind: 'hero', label: 'Page banner', purpose: 'The wide image across the top of a page.',
    width: 1600, height: 900, aspect: '16:9',
  },
  social_square: {
    kind: 'social_square', label: 'Square post', purpose: 'A square image for an Instagram or Facebook post.',
    width: 1080, height: 1080, aspect: '1:1',
  },
  social_portrait: {
    kind: 'social_portrait', label: 'Tall post', purpose: 'A taller post that fills more of the feed.',
    width: 1080, height: 1350, aspect: '4:5',
  },
  social_story: {
    kind: 'social_story', label: 'Story', purpose: 'A full-screen story or reel cover.',
    width: 1080, height: 1920, aspect: '9:16',
  },
  open_graph: {
    kind: 'open_graph', label: 'Link preview', purpose: 'The preview image shown when your page is shared as a link.',
    width: 1200, height: 630, aspect: '1.91:1',
  },
  general: {
    kind: 'general', label: 'General image', purpose: 'A general-purpose image for anywhere on your site.',
    width: 1024, height: 1024, aspect: '1:1',
  },
};

export const VISUAL_KINDS = Object.keys(ASSET_SPECS) as VisualKind[];
export function isVisualKind(k: string): k is VisualKind { return (VISUAL_KINDS as string[]).includes(k); }
export function specFor(kind: VisualKind): AssetSpec { return ASSET_SPECS[kind]; }

/** A single generated candidate. Held in the plan; ephemeral until one is approved. */
export interface Variation {
  id: string;
  storage_path: string;   // draft object in the private bucket (not a library row yet)
  width: number;
  height: number;
  model: string;          // which image model made it (honesty)
  created_at: string;
}

/** A generation — an approval-gated plan. Structurally extends the shared base so
 *  "what / risk / reversible / approval" reads the same wherever a plan appears. */
export interface VisualPlan extends ApprovedPlanBase {
  kind: VisualKind;
  rollback: string;              // how to undo, plain words
  brief: string;                 // the customer's own words
  prompt: string;                // the composed brand-aware brief sent to the model
  brand_snapshot: BrandSnapshot; // what brand cues shaped it
  width: number;
  height: number;
  variations: Variation[];
  provenance: 'ai' | 'ai_approved';
}

/** The brand cues that make a graphic *this business's* graphic, not generic. */
export interface BrandSnapshot {
  palette: string[];        // hex swatches, if the site has them
  personality: string;      // e.g. "warm, unfussy, neighborhood"
  vocabulary: string[];     // words that ring true
  avoid: string[];          // words/looks to steer away from
  industry: string;         // the pack, plain (e.g. "restaurant")
}

/** The platform stance the customer is owed, in plain words. Referenced by the UI
 *  and the docs so the promise is one source of truth. */
export const VISUAL_HONESTY = {
  ownership: 'Images you approve are yours — the same as anything you type. We record that they were AI-made, for honesty, never to limit your use.',
  manual_parity: 'You never have to use this. Uploading your own photos works exactly as before, and is never slower or hidden.',
  approval: 'Nothing is saved to your library or shown on your site until you approve it.',
  fact_law: 'Generated images are graphics, not evidence — we never bake in claims like awards, ratings, or “#1”.',
  disclosure: 'AI-made, and we say so.',
} as const;
