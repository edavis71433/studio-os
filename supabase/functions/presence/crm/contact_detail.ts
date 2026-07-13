// ── Contact detail composition — PURE logic ──────────────────────────────────
// Tapping a contact should answer, at a glance: who they are, their deals (stage
// + value + when last contacted), their recent activity, and "last spoke {when}".
// This composes that view from rows the route fetches — reusing the deal-activity
// timeline machinery so a contact's activity reads identically to a deal's.
//
// PURE: no network, no clock beyond passed-in `now`. Tested in isolation
// (tests/presence/contacts_detail_test.mjs).
import { mapDealTimelineItem, lastContactedAt, type DealTimelineItem } from './deal_activity.ts';
import { humanWhen } from './contract.ts';

export interface ContactDealSummary {
  id: string;
  title: string;
  stage: string;
  expected_value_cents: number;
  expected_close: string | null;
  converted_client_id: string | null;
  updated_at: string;
  last_contacted_at: string | null;
}

// A timeline item enriched with which deal it belongs to (a contact spans several
// deals, so each activity/event names its deal).
export interface ContactTimelineItem extends DealTimelineItem {
  deal_id: string | null;
  deal_title: string;
}

export interface ContactDetailComposition {
  deals: ContactDealSummary[];
  timeline: ContactTimelineItem[];
  last_contacted_at: string | null;
}

function pickDeal(d: any): Omit<ContactDealSummary, 'last_contacted_at'> {
  return {
    id: String(d?.id || ''),
    title: String(d?.title || ''),
    stage: String(d?.stage || ''),
    expected_value_cents: Math.max(0, Math.trunc(Number(d?.expected_value_cents)) || 0),
    expected_close: (typeof d?.expected_close === 'string' && d.expected_close) || null,
    converted_client_id: (typeof d?.converted_client_id === 'string' && d.converted_client_id) || null,
    updated_at: String(d?.updated_at || ''),
  };
}

/** Compose a contact's deals (each with its own last-contacted) + a merged
 *  recent-activity timeline across ALL their deals + the overall last-contacted.
 *  `eventRows` are raw presence_deal_events rows (each carrying `deal_id`), the
 *  same shape mergeDealTimeline consumes. */
export function composeContactDetail(
  dealRows: any[],
  eventRows: any[],
  opts: { timelineLimit?: number } = {},
): ContactDetailComposition {
  const deals = Array.isArray(dealRows) ? dealRows : [];
  const events = Array.isArray(eventRows) ? eventRows : [];
  const titleByDeal = new Map<string, string>();
  for (const d of deals) titleByDeal.set(String(d?.id || ''), String(d?.title || ''));

  // group events by deal for the per-deal "last contacted"
  const eventsByDeal = new Map<string, any[]>();
  for (const e of events) {
    const did = String(e?.deal_id || '');
    const g = eventsByDeal.get(did) || [];
    g.push(e);
    eventsByDeal.set(did, g);
  }

  const dealViews: ContactDealSummary[] = deals.map((d) => {
    const base = pickDeal(d);
    return { ...base, last_contacted_at: lastContactedAt(eventsByDeal.get(base.id) || []) };
  });

  // ONE reverse-chronological activity feed across the contact's deals — reuse
  // the deal timeline mapper, then tag each item with its deal.
  const limit = Math.max(1, Math.min(200, opts.timelineLimit ?? 30));
  const timeline: ContactTimelineItem[] = events
    .map((r, i) => {
      const it = mapDealTimelineItem(r, i);
      const did = (typeof r?.deal_id === 'string' && r.deal_id) || null;
      return { ...it, deal_id: did, deal_title: (did && titleByDeal.get(did)) || '' };
    })
    .filter((x) => x.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  return { deals: dealViews, timeline, last_contacted_at: lastContactedAt(events) };
}

/** Calm "Last spoke {relative}" line for the contact header. Empty when never
 *  contacted (the UI then shows nothing rather than a hollow label). */
export function lastSpokeLabel(iso: string | null, nowIso: string): string {
  if (!iso) return '';
  return `Last spoke ${humanWhen(iso, nowIso)}`;
}
