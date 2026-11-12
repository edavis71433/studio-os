// ── A pitch pack's notes for the studio (sales item 119, Nov 2026) ──────────
// When a piece of a pack can't be built (no website, the day's checking budget
// used up, the AI check switched off), the pack keeps only a reason code. These
// are the words the STUDIO reads about it, on Prospects and in the build dialog.
// They never reach the public pack: a prospect reading "the day's checking
// budget is used up" about their own business is the studio talking to itself
// in front of them. Pure, and light: Prospects' list reads it without loading
// the scan engines.

const clean = (s: unknown, max = 200) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);

export const STUDIO_WORDS: Record<string, string> = {
  no_site: 'They have no working website, so the pack leads with that.',
  resting: 'The day’s checking budget was used up. Rebuild the pack tomorrow to fill this in.',
  failed: 'It couldn’t be checked just now. Rebuild the pack to try again.',
  unreachable: 'The website wouldn’t load for the checker. Rebuild the pack to try again.',
  blocked: 'The website blocked the checker, so it has no score.',
  ai_unavailable: 'The AI check isn’t switched on for this platform, so the pack leaves it out.',
  engines_failed: 'The AI services couldn’t be reached just now. Rebuild the pack to try again.',
  ambiguous: 'Too many businesses share this name for a clean AI answer, so the pack leaves it out.',
  no_town: 'Without a town on record, the AI check can’t tell this business from namesakes, so the pack leaves it out.',
};
export const NO_RIVALS = 'No nearby rivals on your list yet. Save a couple with websites, then rebuild the pack.';
const studioWord = (why: string) => STUDIO_WORDS[why] || 'This piece couldn’t be built. Rebuild the pack to try again.';

/** The studio's notes on a pack: each piece that couldn't be built, and what to do. */
export function packNotes(pieces: unknown): string[] {
  const p: any = pieces && typeof pieces === 'object' ? pieces : {};
  const out: string[] = [];
  if (p.you && !p.you.summary && p.you.why) out.push(`Their website: ${studioWord(String(p.you.why))}`);
  if (Array.isArray(p.rivals)) {
    if (!p.rivals.length) out.push(NO_RIVALS);
    for (const r of p.rivals) if (r && !r.summary && r.why) out.push(`${clean(r.name, 120) || 'A nearby business'}: ${studioWord(String(r.why))}`);
  }
  if (p.ai && !p.ai.summary && p.ai.why) out.push(`The AI check: ${studioWord(String(p.ai.why))}`);
  return out;
}
