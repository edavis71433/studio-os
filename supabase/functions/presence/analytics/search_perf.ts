// ── Phase AN-3: Search Performance — plain-English composition (PURE, no AI) ──
// Composes Google Search Console metrics that already live in the shared `signals`
// table (source='gsc', keyed by client_id) into calm sentences. Reads NOTHING new,
// invents NOTHING: when there is no GSC data (the honest state today — no presence-
// native ingestion exists yet), every composer returns empty and the surface shows
// an honest "connect Google Search Console" card instead of a fabricated number.
// No SEO jargon reaches the customer (AN-3 §9): impressions→"seen on Google",
// clicks→"clicked through", CTR→"1 in N who saw you", position→"near the top".
import type { Insight } from './compose.ts';

export interface GscMetrics {
  impressions: number; clicks: number;
  priorImpressions: number | null; priorClicks: number | null;
  ctr: number | null;            // 0..1 (only from a per-client OAuth connection)
  position: number | null;       // average rank (only from OAuth)
  period: string;                // 'YYYY-MM' of the latest data
  hasData: boolean;
  totalImpressions: number;      // all retained periods (for milestones)
  totalClicks: number;
  firstImpressionAt: string | null;
  firstSearchClickAt: string | null;
}

const n = (x: number) => x.toLocaleString('en-US');
const trend = (cur: number, prior: number | null): string => {
  if (prior === null || prior === 0) return '';
  const d = Math.round(((cur - prior) / prior) * 100);
  if (d >= 10) return ` — up ${d}% from the month before`;
  if (d <= -10) return ` — down ${Math.abs(d)}% from the month before`;
  return ' — about the same as the month before';
};
const monthLabel = (period: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(period || '');
  if (!m) return 'recently';
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `in ${names[Number(m[2]) - 1] || ''}`;
};

/** Plain-English Search Performance cards. Empty when there's no GSC data (honest). */
export function searchInsights(g: GscMetrics): Insight[] {
  if (!g.hasData) return [];
  const when = monthLabel(g.period);
  const out: Insight[] = [];
  out.push({ key: 'search_impressions', title: 'Found on Google', number: g.impressions, tone: 'good',
    sentence: `People saw your business ${n(g.impressions)} ${g.impressions === 1 ? 'time' : 'times'} on Google ${when}${trend(g.impressions, g.priorImpressions)}.`,
    detail: 'That’s how often you showed up in Google’s results.' });
  out.push({ key: 'search_clicks', title: 'Clicked through', number: g.clicks, tone: g.clicks > 0 ? 'good' : 'neutral',
    sentence: g.clicks > 0
      ? `${n(g.clicks)} of them clicked through to your website${trend(g.clicks, g.priorClicks)}.`
      : 'No one clicked through from Google yet — a clearer title and description can help.',
    href: '/presence.html#business' });
  // CTR + position only exist via a full (OAuth) connection — translated, never jargon.
  if (g.ctr !== null && g.impressions > 0) {
    const oneIn = g.ctr > 0 ? Math.max(1, Math.round(1 / g.ctr)) : 0;
    if (oneIn) out.push({ key: 'search_ctr', title: 'How compelling you look', tone: 'neutral',
      sentence: `About 1 in ${oneIn} people who saw you on Google clicked — the rest kept scrolling.` });
  }
  if (g.position !== null && g.position > 0) {
    const p = Math.round(g.position);
    out.push({ key: 'search_position', title: 'Where you land', tone: p <= 10 ? 'good' : 'neutral',
      sentence: p <= 3 ? 'You usually appear right near the top of Google’s results.'
        : p <= 10 ? 'You usually appear on the first page of Google’s results.'
        : `You usually appear around ${p}th in Google’s results — climbing takes fresh, well-described pages.` });
  }
  return out;
}

/** A single Search moment — only on a MEANINGFUL change, never noise (AN-3 §Today). */
export function searchNotice(g: GscMetrics): { headline: string; summary: string; tone: 'good' | 'attention' } | null {
  if (!g.hasData || g.priorImpressions === null || g.priorImpressions < 20) return null;
  if (g.impressions >= g.priorImpressions * 1.5) return { headline: 'More people are finding you on Google.', summary: `You were seen ${n(g.priorImpressions)} → ${n(g.impressions)} times.`, tone: 'good' };
  if (g.impressions <= g.priorImpressions * 0.5) return { headline: 'Fewer people are finding you on Google.', summary: `Search views dropped ${n(g.priorImpressions)} → ${n(g.impressions)} — worth a look at your titles and a fresh update.`, tone: 'attention' };
  return null;
}

/** Health-Coach input derived from search: is visibility falling / absent? Pure. */
export function searchHealth(g: GscMetrics): { impressionsFalling: boolean; noVisibility: boolean } {
  const falling = g.hasData && g.priorImpressions !== null && g.priorImpressions >= 20 && g.impressions <= g.priorImpressions * 0.5;
  const none = g.hasData && g.impressions === 0;
  return { impressionsFalling: falling, noVisibility: none };
}

/** Genuine search milestones from real GSC totals. No fake milestones. Pure. */
export function searchMilestones(totalImpressions: number, totalClicks: number, firstImpressionAt: string | null, firstClickAt: string | null): Array<{ key: string; label: string; achieved: boolean; note: string }> {
  return [
    { key: 'first_impression', label: 'First seen on Google', achieved: !!firstImpressionAt, note: firstImpressionAt ? 'Your business showed up in Google search for the first time. 🎉' : 'Once Google indexes you, your first appearance shows here.' },
    { key: 'first_search_click', label: 'First Google click', achieved: !!firstClickAt, note: firstClickAt ? 'Someone found you on Google and clicked through. 🎉' : 'Your first click from Google search will show here.' },
    { key: 'impressions_1k', label: '1,000 times seen on Google', achieved: totalImpressions >= 1000, note: totalImpressions >= 1000 ? 'Over 1,000 people have seen you on Google. 🎉' : `${n(totalImpressions)} of your first 1,000 Google appearances so far.` },
  ];
}

/** Agency: classify a client's search state for the portfolio (AN-3 §Agency). Pure. */
export function agencySearchState(g: GscMetrics): 'not_connected' | 'growing' | 'falling' | 'steady' {
  if (!g.hasData) return 'not_connected';
  if (g.priorImpressions !== null && g.priorImpressions >= 20) {
    if (g.impressions >= g.priorImpressions * 1.3) return 'growing';
    if (g.impressions <= g.priorImpressions * 0.7) return 'falling';
  }
  return 'steady';
}
