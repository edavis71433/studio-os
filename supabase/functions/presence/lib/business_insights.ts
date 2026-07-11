// ── CMS-UX-7 — Business Insights: pure adapter ───────────────────────────────
// "What should I know about how my business and website are performing?" — a
// small set of calm observations, like sitting down with a trusted advisor.
// NOT Google Analytics, NOT GA4, NOT charts, NOT a metrics dashboard.
//
// The customer story: Content Tree · Timeline · Attention Center · Website Health
// · Upcoming Changes · Approval Center · Business Insights ("what should I know").
//
// A PURE reframing of the EXISTING insight sentences the platform already
// composes (analytics/compose.ts + analytics/search_perf.ts) — it does NOT
// recompute analytics or fork those sentences. It takes the composed `Insight[]`
// and re-groups them into customer-friendly categories, adding only the two
// things an observation needs beyond the fact: why it matters, and whether to
// act. Every observation is the platform's own evidence-backed sentence; the
// route passes ONLY insights that are genuinely measured (Honesty Rule).
//
// Client-safe: only presentation fields leave here.

// structural (no import) — matches analytics/compose.ts Insight (AN-9 style guard)
export interface Insight {
  key: string;
  title: string;
  sentence: string;
  number?: number | null;
  detail?: string;
  href?: string;
  tone?: 'good' | 'neutral' | 'attention';
}

export type InsightCategory = 'Visitors' | 'Enquiries' | 'Content' | 'Search' | 'Engagement' | 'Growth';

export interface Observation {
  observation: string;    // what happened — the platform's own plain sentence
  detail?: string;        // one supporting clause
  why: string;            // why it matters
  should_i: string;       // should I do anything
  action_label?: string;  // one optional action
  action_href?: string;
  icon: string;
}
export interface InsightGroup { key: InsightCategory; label: string; observations: Observation[] }
export interface BusinessInsights {
  headline: string;
  total: number;
  groups: InsightGroup[];
}

const CATEGORY_ORDER: InsightCategory[] = ['Visitors', 'Enquiries', 'Content', 'Search', 'Engagement', 'Growth'];
const ICON: Record<InsightCategory, string> = {
  Visitors: '👥', Enquiries: '✉️', Content: '📄', Search: '🔎', Engagement: '👋', Growth: '📈',
};

// map an existing insight `key` → its customer category + why it matters.
// (Unknown keys fall through to Growth — never dropped silently.)
const META: Record<string, { category: InsightCategory; why: string }> = {
  traffic: { category: 'Visitors', why: 'Knowing how many people visit tells you whether your website is being seen.' },
  device: { category: 'Visitors', why: 'Knowing what people browse on helps make sure your site feels right on their screen.' },
  source: { category: 'Visitors', why: 'Knowing where visitors come from helps you focus effort where it’s already working.' },
  inquiries: { category: 'Enquiries', why: 'Enquiries are the clearest sign your website is turning visitors into customers.' },
  top_page: { category: 'Content', why: 'Your most-visited page is where first impressions happen — worth keeping strong.' },
  publishing: { category: 'Content', why: 'A recently updated site keeps customers, and search engines, confident you’re active.' },
  search: { category: 'Search', why: 'Showing up in search is how new customers find you.' },
  search_readiness: { category: 'Search', why: 'Being set up well for search helps people discover you.' },
  contact_clicks: { category: 'Engagement', why: 'These are visitors taking a real step toward becoming customers.' },
  journey: { category: 'Growth', why: 'A sign your presence is growing.' },
  milestone: { category: 'Growth', why: 'A sign your presence is growing.' },
};
function metaFor(key: string): { category: InsightCategory; why: string } {
  if (META[key]) return META[key];
  if (key.startsWith('search')) return { category: 'Search', why: 'Showing up in search is how new customers find you.' };
  return { category: 'Growth', why: 'A useful sign of how things are going.' };
}

function shouldI(tone: Insight['tone'], href?: string): { text: string; label?: string } {
  if (tone === 'attention') return { text: 'Worth a look when you have a moment.', label: href ? 'Take a look' : undefined };
  return { text: 'Nothing to do — just good to know.' };
}

/** Reframe existing composed insights into grouped observations. Pure. */
export function buildBusinessInsights(insights: Insight[]): BusinessInsights {
  const byCat = new Map<InsightCategory, Observation[]>();
  for (const ins of insights || []) {
    if (!ins || !ins.sentence) continue;
    const m = metaFor(ins.key);
    const s = shouldI(ins.tone, ins.href);
    const obs: Observation = {
      observation: ins.sentence,
      detail: ins.detail || undefined,
      why: m.why,
      should_i: s.text,
      icon: ICON[m.category],
      ...(s.label && ins.href ? { action_label: s.label, action_href: ins.href } : {}),
    };
    const list = byCat.get(m.category) || [];
    list.push(obs);
    byCat.set(m.category, list);
  }

  const groups: InsightGroup[] = CATEGORY_ORDER
    .filter((c) => (byCat.get(c) || []).length > 0)
    .map((c) => ({ key: c, label: c, observations: byCat.get(c)! }));

  const total = groups.reduce((n, g) => n + g.observations.length, 0);
  const headline = total > 0
    ? 'Here’s what stands out right now.'
    : 'Nothing to report just yet.';

  return { headline, total, groups };
}
