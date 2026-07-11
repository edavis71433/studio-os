// ── /business-insights (CMS-UX-7) — Business Insights ────────────────────────
// "What should I know about how my business is performing?" — calm observations,
// projected from the analytics the platform ALREADY composes. No new analytics
// system, no forked sentences:
//   • first-party traffic   → trafficInsights (visitors / source / top page /
//                             contact taps) over aggregateVisits(loadVisits)
//   • search performance    → searchInsights over readGsc
//   • enquiries             → inquiriesInsight over presence_form_submissions
//   • publishing            → publishingInsight over presence_publishes
// The route passes ONLY genuinely-measured insights to the pure adapter — no
// empty-state or "not measured yet" cards (Evidence Rule).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { loadVisits, readGsc } from './analytics.ts';
import { aggregateVisits } from '../lib/visits.ts';
import { trafficInsights, inquiriesInsight, publishingInsight, windowCounts, type Insight } from '../analytics/compose.ts';
import { searchInsights } from '../analytics/search_perf.ts';
import { buildBusinessInsights } from '../lib/business_insights.ts';

const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);
const WINDOW_DAYS = 30;   // "this month" — the calmest window for a business owner

export async function handleBusinessInsights(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const period = 'month' as const;

  const [visits, gsc, subsR, pubsR] = await Promise.all([
    loadVisits(site.id, period, nowMs),
    readGsc(site.client_id),
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=is.false&select=created_at,form_kind,status&order=created_at.desc&limit=500`),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at&order=created_at.desc&limit=200`),
  ]);

  const traffic = aggregateVisits(visits, nowMs, WINDOW_DAYS);
  const insights: Insight[] = [];

  // Visitors / content / engagement — only when there's real traffic data
  if (traffic.hasData) {
    insights.push(...trafficInsights(traffic, period));
    // a device observation the compose layer doesn't emit — honest, from real
    // shares, only when there's a clear majority device
    const top = (traffic.devices || [])[0];
    if (top && top.share >= 0.5) {
      insights.push({ key: 'device', title: 'How they browse', sentence: `Most of your visitors are on ${top.device} devices.`, tone: 'neutral' });
    }
  }

  // Search — only when Search Console actually has data
  if (gsc && (gsc as any).hasData) insights.push(...searchInsights(gsc));

  // Enquiries — only when there's real inbound (this window or the one before)
  const subs = arr(subsR);
  const createdAts = subs.map((s) => s.created_at).filter(Boolean);
  const { current, prior } = windowCounts(createdAts, nowMs, WINDOW_DAYS);
  if (current > 0 || prior > 0) {
    const wMs = nowMs - WINDOW_DAYS * 86_400_000;
    const byKind = { contact: 0, quote: 0, booking: 0 };
    for (const s of subs) if (Date.parse(s.created_at) > wMs && s.form_kind in byKind) (byKind as any)[s.form_kind]++;
    const unread = subs.filter((s) => s.status === 'new').length;
    insights.push(inquiriesInsight(createdAts, byKind, unread, nowMs, period));
  }

  // Publishing — a real observation once the site has ever been published
  if (site.last_published_at) {
    insights.push(publishingInsight(arr(pubsR).map((p) => p.created_at).filter(Boolean), site.last_published_at, nowMs, period));
  }

  return json({ data: buildBusinessInsights(insights) }, 200, cors);
}
