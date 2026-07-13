// ── Content Performance — plain-English "what this means" for visit data ──────
// Turns the first-party visit aggregates the platform ALREADY collects (via
// lib/visits.ts → aggregateVisits: topPages / topSources / devices / visitors)
// into 1–3 short, ACTIONABLE sentences an owner with no technical knowledge can
// act on — e.g. "Your Services page gets the most visits; your FAQ page the
// fewest — linking it from your home page could help more visitors find it."
//
// Deterministic. No AI, no new tracking, no new event kinds. This is a pure
// projection over already-aggregated counts — reading it costs ZERO AI tokens
// and adds ZERO data collection.
//
// Honesty Rules (same standard as analytics/compose.ts + lib/visits.ts):
//   • Never state a number that isn't in the input. Every figure is one of the
//     aggregate's own counts (or the plain English derived from them).
//   • `truncated` (the fetch-cap flag from loadVisits) means the row set may be
//     incomplete → we suppress any claim that depends on seeing the WHOLE
//     distribution (the "fewest" ranking, device/source majorities). We keep only
//     the single clear leader, which is robust to an undercounted tail.
//   • Below a small volume, or when nothing meaningful stands out, we say so
//     calmly and emit no advice — never a fabricated or padded suggestion.

/** The subset of aggregateVisits(...) output this composer reads (structural, so
 *  it stays decoupled from the store — pass a VisitAgg or any matching shape). */
export interface ContentPerfInput {
  visitors: number;
  pageviews: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; visits: number }>;
  devices: Array<{ device: string; share: number }>;   // share = integer PERCENT (lib/visits.ts)
  hasData: boolean;
  truncated: boolean;
}

export interface ContentSuggestion {
  key: string;
  text: string;                 // the plain-English, actionable sentence
  tone: 'good' | 'neutral';
}

export interface ContentPerformance {
  /** True when we had enough real data to say something worth acting on. */
  enough: boolean;
  /** The calm line shown when there isn't enough yet (honest empty state). */
  note: string;
  /** 1–3 short suggestions, in a calm priority order. Empty when !enough. */
  suggestions: ContentSuggestion[];
}

// Volume gate: below this many visitors the page/source/device mix is noise, and
// advice would be over-reading a handful of visits. Matches the conservative bar
// used elsewhere for traffic "moments" (analytics/compose.ts trafficNotice).
const MIN_VISITORS = 8;
const MIN_PAGE_VIEWS = 3;       // don't rank a page off one or two views
const MIN_SOURCE_VISITS = 3;
const DEVICE_MAJORITY = 60;     // a clear majority (percent) before we call it
const TOP_PAGES_CAP = 5;        // aggregateVisits returns topN(pages, 5)

/** Friendly page label from a path. '/' → "home page"; '/faq' → "FAQ page". */
function pageLabel(path: string): string {
  if (!path || path === '/' ) return 'home page';
  const seg = path.replace(/^\/|\/$/g, '').split('/')[0].replace(/[-_]+/g, ' ').trim();
  if (!seg) return 'home page';
  // Common acronyms read best upper-cased; everything else is plain title case.
  const ACRONYMS = new Set(['faq', 'faqs', 'about us']);
  const pretty = ACRONYMS.has(seg.toLowerCase())
    ? seg.toUpperCase()
    : seg.replace(/\b\w/g, (c) => c.toUpperCase());
  return `${pretty} page`;
}

const isSearch = (s: string) => /^(google|bing|duckduckgo)$/i.test(s);
const isSocial = (s: string) => /facebook|instagram|x \/ twitter|twitter|linkedin|yelp|tiktok|pinterest/i.test(s);

/** Compose the calm, actionable content-performance suggestions. Pure. */
export function buildContentPerformance(agg: ContentPerfInput): ContentPerformance {
  const NOT_ENOUGH = 'We’ll show what’s working — and what could use a nudge — once your site has had a few more visits.';
  if (!agg || !agg.hasData || agg.visitors < MIN_VISITORS) {
    return { enough: false, note: NOT_ENOUGH, suggestions: [] };
  }

  const out: ContentSuggestion[] = [];
  const pages = Array.isArray(agg.topPages) ? agg.topPages : [];
  const sources = Array.isArray(agg.topSources) ? agg.topSources : [];
  const devices = Array.isArray(agg.devices) ? agg.devices : [];

  // ── 1. Most / least visited page ───────────────────────────────────────────
  // topPages is already sorted views-desc by aggregateVisits → [0] is the leader.
  const most = pages[0];
  if (most && most.views >= MIN_PAGE_VIEWS) {
    const least = pages[pages.length - 1];
    // The "fewest" half is only truthful when we can see the WHOLE set of pages
    // (fewer than the cap → nothing is hidden below the tail) and the row set
    // isn't truncated. Otherwise a page below the cap could actually be lowest.
    const canRankLeast =
      !agg.truncated &&
      pages.length >= 2 &&
      pages.length < TOP_PAGES_CAP &&
      least && least.path !== most.path &&
      least.path !== '/' &&                    // never advise "link your home page from your home page"
      most.views > least.views;
    if (canRankLeast) {
      out.push({
        key: 'pages_most_least',
        tone: 'neutral',
        text: `Your ${pageLabel(most.path)} gets the most visits; your ${pageLabel(least.path)} gets the fewest — linking to it from your home page could help more visitors find it.`,
      });
    } else {
      out.push({
        key: 'pages_most',
        tone: 'neutral',
        text: `Your ${pageLabel(most.path)} is getting the most attention right now.`,
      });
    }
  }

  // ── 2. A notable traffic source ────────────────────────────────────────────
  // Only when one source clearly dominates (≥ half of counted visits) AND there's
  // contrast (more than one source), and never under truncation (share unreliable).
  const src = sources[0];
  if (!agg.truncated && src && src.visits >= MIN_SOURCE_VISITS && sources.length > 1) {
    const total = sources.reduce((a, b) => a + (b.visits || 0), 0) || 1;
    if (src.visits >= total * 0.5) {
      if (isSearch(src.source)) {
        out.push({ key: 'source', tone: 'good', text: `Most visitors find you through ${src.source} search — your pages are being discovered. Keeping your page titles and descriptions current helps that continue.` });
      } else if (/^direct$/i.test(src.source)) {
        out.push({ key: 'source', tone: 'neutral', text: `Most visitors come straight to your site — they already know your address. Sharing it more widely could bring new faces.` });
      } else if (isSocial(src.source)) {
        out.push({ key: 'source', tone: 'good', text: `Most visitors arrive from ${src.source} — that channel is working, so it’s worth keeping active.` });
      } else {
        out.push({ key: 'source', tone: 'neutral', text: `Most visitors arrive from ${src.source}.` });
      }
    }
  }

  // ── 3. A device skew worth knowing ─────────────────────────────────────────
  const dev = devices[0];
  if (!agg.truncated && dev && dev.share >= DEVICE_MAJORITY) {
    if (dev.device === 'mobile') {
      out.push({ key: 'device', tone: 'good', text: `Most visitors are on phones — your site adapts to small screens automatically, so they get a good experience.` });
    } else if (dev.device === 'desktop') {
      out.push({ key: 'device', tone: 'neutral', text: `Most visitors are on desktop computers — there’s room for larger images and more detail on bigger screens.` });
    } else if (dev.device === 'tablet') {
      out.push({ key: 'device', tone: 'neutral', text: `Most visitors are on tablets.` });
    }
  }

  const suggestions = out.slice(0, 3);
  if (!suggestions.length) {
    return { enough: false, note: NOT_ENOUGH, suggestions: [] };
  }
  return { enough: true, note: '', suggestions };
}
