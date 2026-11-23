// ── Seen a lot, clicked little (builder list item 384, Nov 2026) ─────────────────
// Wix's SEO page lists the pages Google shows often that few people pick. The Search
// tab does the same from the page numbers Search Console already keeps for the month
// (presence_search_terms, dimension 'page'): a page Google showed at least SEEN_MIN
// times that fewer than 2 in 100 people picked, most seen first, each with one plain
// hint. Google decides how often a page is shown; its title and description on Google
// decide whether people pick it, so that is what the hint is about. Pure.

export const SEEN_MIN = 100;      // seen fewer times than this in a month is too few to judge
export const PICKED_UNDER = 0.02; // and picked by fewer than 2 in 100 of the people who saw it
export const SEEN_LIST_MAX = 5;

export interface SeenLittle { path: string; seen: number; clicks: number; hint: string }

const times = (n: number) => (n === 1 ? 'once' : `${n.toLocaleString('en-US')} times`);

/** The pages seen a lot and clicked little, most seen first, at most five. Pure. */
export function seenLittleClicked(pages: Array<{ path: string; clicks: number; impressions: number }>): SeenLittle[] {
  return pages
    .filter((p) => p && p.path && p.impressions >= SEEN_MIN && p.clicks / p.impressions < PICKED_UNDER)
    .sort((a, b) => b.impressions - a.impressions || a.clicks - b.clicks || a.path.localeCompare(b.path))
    .slice(0, SEEN_LIST_MAX)
    .map((p) => {
      const lead = `Google showed it ${times(p.impressions)} and ${p.clicks ? `people picked it ${times(p.clicks)}` : 'no one picked it'}.`;
      const fix = p.path === '/'
        ? 'Make its title on Google say what you do and where, and its description give one reason to pick you.'
        : 'Make its title on Google say what this page offers, and its description say why it’s the one to pick.';
      return { path: p.path, seen: p.impressions, clicks: p.clicks, hint: `${lead} ${fix}` };
    });
}
