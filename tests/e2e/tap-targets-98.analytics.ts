// Builder item 98's tap-target walk borrows this spec's made-up fixtures, copied as they are from tests/e2e/analytics.spec.ts.
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { headerAction } from './helpers/page-header';
import { installIosFocusSemantics } from './helpers/ios-focus';

// Slice 8 — analytics.html is the Business dashboard. Visual refresh (2026-10):
// the approved "Analytics — business dashboard" board — title + "As of", a
// period SEGMENTED CONTROL (role=group, aria-pressed) + Refresh, a strip of
// stat tiles per band (Sales · Your website) and two-column cards. Per-widget
// honesty is unchanged: null aggregates render empty states, never fake zeros.
const dashHead = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1, name: 'Analytics' });
const seg = (page: import('@playwright/test').Page) => page.locator('#period');
const tileOf = (page: import('@playwright/test').Page, strip: string, name: string) =>
  page.locator(`${strip} .stat`, { has: page.locator('.kt', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const DASH = { data: {
  period: 'this_month',
  generated_at: '2026-07-17T14:14:00Z',
  sales: {
    pipeline: { open: { count: 7, value_cents: 1240000 }, stages: [
      { stage: 'lead', label: 'New lead', count: 3, value_cents: 520000 },
      { stage: 'qualified', label: 'Qualified', count: 2, value_cents: 360000 },
      { stage: 'proposal', label: 'Proposal sent', count: 1, value_cents: 240000 },
      { stage: 'contract', label: 'Agreement out', count: 1, value_cents: 120000 },
    ] },
    won: { this_month: { count: 2, value_cents: 385000 }, last_month: { count: 1, value_cents: 145000 } },
    enquiries: { count: 9, unanswered: 3, weekly: [2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6] },
    support: { open: 4, oldest_age_days: 2 },
    invoices: { paid_cents: 270000, sent_cents: 90000, overdue_cents: 25000, outstanding_cents: 115000, paid_count: 3, sent_count: 1, overdue_count: 1 },
    recent_wins: [
      { title: 'Patio rebuild — Sam R.', value_cents: 240000, closed_at: '2026-07-12T00:00:00Z' },
      { title: 'Site refresh — Marlow’s', value_cents: 145000, closed_at: '2026-07-03T00:00:00Z' },
    ],
  },
  website: {
    traffic: {
      visitors: 214, pageviews: 512, actions: 11,
      top_pages: [{ path: '/', views: 231 }, { path: '/services', views: 104 }, { path: '/contact', views: 54 }],
      top_sources: [{ source: 'Google', visits: 88, share: 41 }, { source: 'Direct', visits: 64, share: 30 }, { source: 'Instagram', visits: 34, share: 16 }],
      weekly: [10, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22],
      has_data: true,
    },
    search: { clicks: 38, impressions: 4100, period: '2026-06', top_terms: [
      { term: 'patio builder near me', clicks: 14, impressions: 890 },
      { term: 'davis landscaping', clicks: 11, impressions: 320 },
    ] },
  },
} };

// A visibly different second period, to prove the chip re-fetches + re-renders.
const DASH_30 = JSON.parse(JSON.stringify(DASH));
DASH_30.data.period = 'last_30';
DASH_30.data.sales.pipeline.open = { count: 9, value_cents: 9990000 };   // $99,900
DASH_30.data.website.traffic.visitors = 999;

// Everything-null: the dashboard must render honestly with no data at all.
const DASH_EMPTY = { data: {
  period: 'this_month', generated_at: '2026-07-17T14:14:00Z',
  sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] },
  website: { traffic: null, search: null },
} };

export const ANALYTICS_98 = { '/analytics/dashboard': DASH };
