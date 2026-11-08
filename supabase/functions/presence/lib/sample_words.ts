// ── Sample words for a new site's preview ───────────────────────────────────
// A brand-new site has no name, line or description yet, so its home page drew an
// empty band under the menu and a lone "About us" heading. The editor and the
// preview show it with sample words instead, each one saying it is a sample.
//
// Only the DRAFT preview passes through here (routes/preview.ts). A publish, a
// kept version and a launch never do, and a publish refuses a site with no name
// (snapshotContentUsable), so these words can't reach a live site. Only empty
// fields are filled: anything the owner wrote is left exactly as it is.
import type { Snapshot } from './render_types.ts';

export const SAMPLE_WORDS: Readonly<Record<'business_name' | 'tagline' | 'description' | 'story', string>> = {
  business_name: 'Your business name',
  tagline: 'A sample line: what you do, in a few words',
  description: 'This is sample text. Say what you offer and why people choose you. Replace it in Business details.',
  story: 'This is sample text for your story. Say how you started and what you care about. Replace it in Business details.',
};

/** The snapshot with SAMPLE_WORDS in any empty field, as a copy; the input is unchanged. */
export function withSampleWords(snapshot: Snapshot): Snapshot {
  const identity = (snapshot.content && snapshot.content.identity) || ({} as Snapshot['content']['identity']);
  const filled: Record<string, unknown> = { ...identity };
  let changed = false;
  for (const [field, words] of Object.entries(SAMPLE_WORDS)) {
    const cur = (identity as Record<string, unknown>)[field];
    if (typeof cur !== 'string' || !cur.trim()) { filled[field] = words; changed = true; }
  }
  if (!changed) return snapshot;
  return { ...snapshot, content: { ...snapshot.content, identity: filled as Snapshot['content']['identity'] } };
}
