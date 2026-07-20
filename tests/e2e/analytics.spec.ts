import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Slice 8 — analytics.html is the Business dashboard: the Salesforce Lightning
// "Reports & Dashboards" treatment. Two bands (Sales · Your website), an
// "As of" + Refresh header, a session-only Period chip, and per-widget
// honesty: null aggregates render illustration empty states, never fake zeros.
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

test.describe('Analytics (Business dashboard)', () => {
  test('renders both bands with KPI values and the stage funnel', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Analytics');
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    await expect(page.getByText(/^As of /)).toBeVisible();
    // both bands
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your website', exact: true })).toBeVisible();
    // Sales KPIs
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();   // open pipeline
    await expect(page.getByText('7 open deals')).toBeVisible();
    await expect(page.getByText('$3,850', { exact: true })).toBeVisible();    // won this month
    await expect(page.getByText('↑ vs last month')).toBeVisible();
    await expect(page.getByText('3 not yet answered')).toBeVisible();
    await expect(page.getByText('oldest waiting 2 days')).toBeVisible();
    // funnel rows carry label + value·count as real text
    await expect(page.getByText('New lead', { exact: true })).toBeVisible();
    await expect(page.getByText('$5,200 · 3')).toBeVisible();
    await expect(page.getByText('$3,600 · 2')).toBeVisible();
    // Website KPIs + tables
    await expect(page.getByText('214', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('512 page views')).toBeVisible();
    await expect(page.getByText('41% of visits')).toBeVisible();
    await expect(page.getByText('patio builder near me')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Patio rebuild — Sam R.' })).toBeVisible();
    // invoices donut hole total is real DOM text
    await expect(page.getByText('$1,150', { exact: true })).toBeVisible();
    await expect(page.getByText('Overdue · $250')).toBeVisible();
    // charts are SVG (no canvas), hidden from AT — the values are text elsewhere
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.locator('.cb svg[aria-hidden="true"]').count()).toBeGreaterThan(3);
  });

  test('the Period chip is a real popup and switches the data (session-only)', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      const period = new URL(route.request().url()).searchParams.get('period');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(period === 'last_30' ? DASH_30 : DASH) });
    });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    const chip = page.locator('#periodBtn');
    await expect(chip).toContainText('This month');            // opens unfiltered (default)
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#periodMenu')).toBeVisible();
    await page.locator('#periodMenu [data-period="last_30"]').click();
    await expect(page.getByText('$99,900', { exact: true })).toBeVisible();  // re-fetched
    await expect(page.getByText('999', { exact: true }).first()).toBeVisible();
    await expect(page.locator('#periodBtn')).toContainText('Last 30 days');
    // Escape closes the reopened menu and returns focus to the chip
    await page.locator('#periodBtn').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#periodMenu')).toBeHidden();
    await expect(page.locator('#periodBtn')).toBeFocused();
    // outside click closes too
    await page.locator('#periodBtn').click();
    await expect(page.locator('#periodMenu')).toBeVisible();
    await page.getByRole('heading', { name: 'Business dashboard' }).click();
    await expect(page.locator('#periodMenu')).toBeHidden();
  });

  test('Refresh re-fetches the dashboard route', async ({ page }) => {
    let calls = 0;
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      calls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASH) });
    });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await page.getByRole('button', { name: '↻ Refresh' }).click();
    await expect.poll(() => calls).toBe(2);
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
  });

  test('null aggregates render empty states — the invoices card hides, nothing fakes a zero', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH_EMPTY } });
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    // invoices: null → the card is not rendered at all
    await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(0);
    // GSC not connected → honest empty state with a connect path, no invented number
    await expect(page.getByText('Not measured yet').first()).toBeVisible();
    await expect(page.getByText('Connect Search Console to see your Google numbers.')).toBeVisible();
    // traffic:null is a FAILED read — the visitors card says so, distinctly
    await expect(page.getByText('Visitor counts hit a hiccup')).toBeVisible();
    // widget empty states are headed (SLDS illustration pattern)
    await expect(page.getByText('No open deals')).toBeVisible();
    await expect(page.getByText('No enquiries yet')).toBeVisible();
    await expect(page.getByText('No visits yet').first()).toBeVisible();
  });

  test('deploy-order tolerance: a 404 from an old function is a calm warming-up state', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/analytics.html');
    await expect(page.getByText('This dashboard is warming up.')).toBeVisible();
    await expect(page.getByText('try again shortly')).toBeVisible();
  });

  test('a 500 on first load → the trouble state, distinct from 404-warming', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/analytics.html');
    await expect(page.getByText('We couldn’t load your analytics just now.')).toBeVisible();
    await expect(page.getByText('This dashboard is warming up.')).toHaveCount(0);
  });

  test('a slow older period response can never overwrite a newer render (stale-race guard)', async ({ page }) => {
    const DASH_Q = JSON.parse(JSON.stringify(DASH));
    DASH_Q.data.period = 'quarter';
    DASH_Q.data.sales.pipeline.open = { count: 4, value_cents: 4440000 };   // $44,400
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => { releaseSlow = r; });
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', async (route) => {
      const period = new URL(route.request().url()).searchParams.get('period');
      if (period === 'last_30') {   // the OLDER request — held until the newer one has rendered
        await slowGate;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASH_30) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(period === 'quarter' ? DASH_Q : DASH) });
    });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    await page.locator('#periodBtn').click();
    await page.locator('#periodMenu [data-period="last_30"]').click();   // slow (gated)
    await page.locator('#periodBtn').click();
    await page.locator('#periodMenu [data-period="quarter"]').click();   // fast, newer
    await expect(page.getByText('$44,400', { exact: true })).toBeVisible();
    await expect(page.locator('#periodBtn')).toContainText('This quarter');
    releaseSlow();   // NOW the stale last_30 response lands — it must be discarded
    await page.waitForTimeout(250);
    await expect(page.getByText('$44,400', { exact: true })).toBeVisible();
    await expect(page.getByText('$99,900', { exact: true })).toHaveCount(0);
    await expect(page.locator('#periodBtn')).toContainText('This quarter');
  });

  test('a failed period switch rolls back fully — chip, menu selection and board untouched', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      const period = new URL(route.request().url()).searchParams.get('period');
      if (period === 'last_30') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASH) });
    });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    await page.locator('#periodBtn').click();
    await page.locator('#periodMenu [data-period="last_30"]').click();
    await expect(page.getByText('Couldn’t refresh just now.')).toBeVisible();
    // the board and the chip stay exactly as they were
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    await expect(page.locator('#periodBtn')).toContainText('This month');
    // reopened, the menu still marks This month selected — no half-committed checkmark
    await page.locator('#periodBtn').click();
    await expect(page.locator('#periodMenu [data-period="this_month"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#periodMenu [data-period="last_30"]')).toHaveAttribute('aria-selected', 'false');
  });

  test('traffic has_data:false → "Not measured yet" empty states, never zero KPIs', async ({ page }) => {
    const D = JSON.parse(JSON.stringify(DASH));
    D.data.website.traffic = { visitors: 0, pageviews: 0, actions: 0, top_pages: [], top_sources: [], weekly: [0,0,0,0,0,0,0,0,0,0,0,0], has_data: false };
    D.data.website.search = null;
    await installApp(page, { api: { '/analytics/dashboard': D } });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    await expect(page.getByText('Not measured yet').first()).toBeVisible();
    await expect(page.getByText('Visitor counts appear once your site is collecting them.')).toBeVisible();
    // a present-but-empty measurement is NOT a hiccup, and never a fake zero
    await expect(page.getByText('Visitor counts hit a hiccup')).toHaveCount(0);
    await expect(page.getByText('0', { exact: true })).toHaveCount(0);
  });

  test('invoices:null → the deal-value card widens so the Sales row stays 12 columns', async ({ page }) => {
    const D = JSON.parse(JSON.stringify(DASH));
    D.data.sales.invoices = null;
    await installApp(page, { api: { '/analytics/dashboard': D } });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(0);
    // deal value (c4→c6) + recent wins (c4→c6) = a full 12-column row, no hole
    await expect(page.locator('section.card', { has: page.getByRole('heading', { name: 'Deal value by stage' }) })).toHaveClass(/\bc6\b/);
    await expect(page.locator('section.card', { has: page.getByRole('heading', { name: 'Recent wins' }) })).toHaveClass(/\bc6\b/);
  });

  test('a failed Search Console read → a quiet catching-its-breath state, never the connect CTA', async ({ page }) => {
    const D = JSON.parse(JSON.stringify(DASH));
    D.data.website.search = { unavailable: true };
    await installApp(page, { api: { '/analytics/dashboard': D } });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    await expect(page.getByText('Search data is catching its breath').first()).toBeVisible();
    // the user may well be connected — a hiccuped read never shows the connect path
    await expect(page.getByText('Connect Search Console')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Connect Search Console →' })).toHaveCount(0);
  });

  test('forwards the scope header (SC-1) on its dashboard call', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    let sentScope = '';
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'] || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASH) });
    });
    await page.goto(`/analytics.html?client=${CLIENT}`);
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    expect(sentScope).toBe(CLIENT);
    // drill links carry the scope through to the report surfaces
    await expect(page.getByRole('link', { name: 'View pipeline →' }).first()).toHaveAttribute('href', `/pipeline.html?client=${CLIENT}`);
    // D1 + scope together: windows-aware targets carry period AND client
    await expect(page.getByRole('link', { name: 'View website insights →' }).first())
      .toHaveAttribute('href', `/business-insights.html?period=this_month&client=${CLIENT}`);
  });

  test('D1: business-insights drills carry the ACTIVE period; pipeline stays bare (stage=won is SS5)', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
      const period = new URL(route.request().url()).searchParams.get('period');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(period === 'last_30' ? DASH_30 : DASH) });
    });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View website insights →' }).first())
      .toHaveAttribute('href', '/business-insights.html?period=this_month');
    await expect(page.getByRole('link', { name: 'View search insights →' }).first())
      .toHaveAttribute('href', '/business-insights.html?period=this_month');
    // pipeline doesn't understand windows yet — its footers carry NO period,
    // and "View won deals" keeps the plain target until SS5's stage=won landing
    await expect(page.getByRole('link', { name: 'View pipeline →' }).first()).toHaveAttribute('href', '/pipeline.html');
    await expect(page.getByRole('link', { name: 'View won deals →' }).first()).toHaveAttribute('href', '/pipeline.html');
    // switching the period re-labels every windows-aware drill
    await page.locator('#periodBtn').click();
    await page.locator('#periodMenu [data-period="last_30"]').click();
    await expect(page.getByText('$99,900', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View website insights →' }).first())
      .toHaveAttribute('href', '/business-insights.html?period=last_30');
    await expect(page.getByRole('link', { name: 'View pipeline →' }).first()).toHaveAttribute('href', '/pipeline.html');
  });

  test('D2: the period-windowed KPI cards say their window, matching their siblings', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    for (const name of ['New enquiries', 'Visitors', 'Actions taken']) {
      await expect(page.locator('section.card', { has: page.getByRole('heading', { name, exact: true }) }).locator('.ch .s'))
        .toHaveText(/^This month/);
    }
  });

  test('D3: Won this month speaks expected-deal-value truth', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await expect(page.getByText('$3,850', { exact: true })).toBeVisible();
    await expect(page.getByText('expected value of 2 deals won')).toBeVisible();
  });

  test('mobile: the grid stacks to a single column', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'stacking is a phone-width concern');
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
    const cards = page.locator('.grid > .card');
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(first && second && Math.abs(first.x - second.x) < 2).toBeTruthy();   // same left edge → stacked
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 2);            // below, not beside
  });

  test('stencil loading shows only when the fetch runs >300ms, then cross-fades to data', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'timing probe once, on desktop');
    await installApp(page);
    await page.route('**/functions/v1/presence/analytics/dashboard**', async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DASH_EMPTY) });
    });
    await page.goto('/analytics.html');
    await expect(page.locator('.st').first()).toBeVisible();     // slow fetch → stencil blocks
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    await expect(page.locator('.st')).toHaveCount(0);            // replaced by the real board
  });

  test('no serious/critical axe violations on the dashboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});

// ── SS7: the AGENCY PORTFOLIO LENS — an unscoped agency operator lands on the
// same dashboard anatomy as the scoped Business dashboard (AN-7 retired).
// KPI band + insight cards come from /analytics/portfolio; the per-client
// rollup comes from /agency/portfolio (the read that carries site_id), and
// each row drills into that client's SCOPED Business dashboard.
const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence',
  edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: true, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
  plan_key: 'presence', upsell: null,
} };
const PORTFOLIO = { data: {
  headline: 'Across 3 clients, here’s what stands out.',
  client_count: 3,
  insights: [
    { key: 'growing', title: 'New inquiries', sentence: '2 of your 3 clients have new inquiries waiting.', number: 2, detail: 'Marlow’s Kitchen, Beacon Plumbing', tone: 'good' },
    { key: 'attention', title: 'Needs attention', sentence: '1 client needs a look.', number: 1, detail: 'Beacon Plumbing', tone: 'attention' },
    { key: 'search_not_connected', title: 'Connect Search Console', sentence: '1 of 3 clients needs Google Search Console connected.', number: 1, tone: 'neutral', href: '/connections.html?client=s3', cta: 'Connect it for them' },
  ],
  websites: [
    { name: 'Marlow’s Kitchen', draft_live: 'live', leads_waiting: 3, needs_attention: false, plan_status: 'active' },
    { name: 'Beacon Plumbing', draft_live: 'live', leads_waiting: 1, needs_attention: true, plan_status: 'active' },
    { name: 'Cedar Studio', draft_live: 'draft', leads_waiting: 0, needs_attention: false, plan_status: 'active' },
  ],
} };
const AGENCY_ROSTER = { data: [
  { site_id: 's1', name: 'Marlow’s Kitchen', edition: 'presence', status: 'live', attention: 0, leads_waiting: 3 },
  { site_id: 's2', name: 'Beacon Plumbing', edition: 'presence', status: 'live', attention: 2, leads_waiting: 1 },
  { site_id: 's3', name: 'Cedar Studio', edition: 'presence', status: 'draft', attention: 0, leads_waiting: 0 },
] };
const AGENCY_API = { '/portal/context': AGENCY_CTX, '/analytics/portfolio': PORTFOLIO, '/agency/portfolio': AGENCY_ROSTER };

test.describe('Analytics (Agency portfolio lens)', () => {
  test('wears the dashboard anatomy: header · KPI band · insight cards · rollup · print', async ({ page }) => {
    await installApp(page, { api: AGENCY_API });
    await page.goto('/analytics.html');
    // .dhead anatomy, one h1
    await expect(page.getByRole('heading', { name: 'Portfolio dashboard' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByText(/^As of /)).toBeVisible();
    await expect(page.getByRole('button', { name: '↻ Refresh' })).toBeVisible();
    await expect(page.getByText('Across 3 clients, here’s what stands out.')).toBeVisible();
    // KPI band — every number derived from the payload (KPI tiles are c3;
    // insight cards are c4 — 'Needs attention' titles exist in both bands)
    const kpiCard = (name: string) => page.locator('section.card.c3', { has: page.getByRole('heading', { name, exact: true }) });
    await expect(kpiCard('Clients').locator('.kn')).toHaveText('3');
    await expect(kpiCard('Clients').getByRole('link', { name: 'Open Studio →' })).toHaveAttribute('href', '/agency.html');
    await expect(kpiCard('Needs attention').locator('.kn')).toHaveText('1');
    await expect(kpiCard('Enquiries waiting').locator('.kn')).toHaveText('4');   // 3 + 1 + 0
    await expect(kpiCard('Sites live').locator('.kn')).toHaveText('2');
    await expect(kpiCard('Sites live')).toContainText('1 still in draft');
    // insight cards recut to the standard anatomy: tone chip · title · number ·
    // sentence · one .go affordance
    const inquiries = page.locator('section.card.c4', { has: page.getByRole('heading', { name: 'New inquiries' }) });
    await expect(inquiries.locator('.tchip')).toHaveText('Good news');
    await expect(inquiries.locator('.kn')).toHaveText('2');
    await expect(inquiries).toContainText('2 of your 3 clients have new inquiries waiting.');
    await expect(inquiries).toContainText('Marlow’s Kitchen, Beacon Plumbing');
    await expect(page.locator('.tchip.attention')).toHaveText('Needs a look');
    await expect(page.getByRole('link', { name: 'Connect it for them →' })).toHaveAttribute('href', '/connections.html?client=s3');
    // the per-client rollup: one row per client, name links drill SCOPED
    const rows = page.locator('.tscroll tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByRole('link', { name: 'Marlow’s Kitchen' })).toHaveAttribute('href', '/analytics.html?client=s1');
    await expect(rows.nth(1).getByRole('link', { name: 'Beacon Plumbing' })).toHaveAttribute('href', '/analytics.html?client=s2');
    await expect(rows.nth(1).locator('.pill.wait')).toHaveText('2 waiting');
    await expect(rows.nth(0).locator('.pill.ok')).toHaveText('all clear');
    // the print summary affordance survives the recut
    await expect(page.getByRole('button', { name: 'Print this summary' })).toBeVisible();
  });

  // SS7 item 3: the enriched /analytics/portfolio websites[] (site_id + visitors)
  // feeds a Visitors column in the rollup, joined by site_id. Feature-detected on
  // the payload SHAPE — an older function build renders EXACTLY the shipped table.
  const ENRICHED = { data: { ...PORTFOLIO.data, websites: [
    { site_id: 's1', name: 'Marlow’s Kitchen', draft_live: 'live', leads_waiting: 3, needs_attention: false, plan_status: 'active', visitors: 42 },
    { site_id: 's2', name: 'Beacon Plumbing', draft_live: 'live', leads_waiting: 1, needs_attention: true, plan_status: 'active', visitors: null },
    { site_id: 's3', name: 'Cedar Studio', draft_live: 'draft', leads_waiting: 0, needs_attention: false, plan_status: 'active', visitors: 0 },
  ] } };

  test('enriched websites[] adds the Visitors column, joined by site_id (null → honest dash)', async ({ page }) => {
    await installApp(page, { api: { ...AGENCY_API, '/analytics/portfolio': ENRICHED } });
    await page.goto('/analytics.html');
    await expect(page.getByRole('columnheader', { name: 'Visitors (7 days)' })).toBeVisible();
    const rows = page.locator('.tscroll tbody tr');
    await expect(rows.nth(0).locator('td').last()).toHaveText('42');
    // null = the visits read failed server-side — an honest dash, NEVER a fake 0
    await expect(rows.nth(1).locator('td').last()).toHaveText('—');
    // a successful read with no visits is an honest 0
    await expect(rows.nth(2).locator('td').last()).toHaveText('0');
    // the KPI band is unchanged by the extra fields
    const kpiCard = (name: string) => page.locator('section.card.c3', { has: page.getByRole('heading', { name, exact: true }) });
    await expect(kpiCard('Enquiries waiting').locator('.kn')).toHaveText('4');
  });

  test('older function payload (no site_id/visitors) renders EXACTLY the shipped table', async ({ page }) => {
    await installApp(page, { api: AGENCY_API });   // the legacy mock — websites[] rows carry neither field
    await page.goto('/analytics.html');
    await expect(page.locator('.tscroll tbody tr')).toHaveCount(3);
    // no Visitors column, no undefined-render — the four shipped columns only
    await expect(page.getByRole('columnheader', { name: /Visitors/ })).toHaveCount(0);
    await expect(page.locator('.tscroll thead th')).toHaveCount(4);
    await expect(page.locator('.tscroll tbody tr').nth(0).locator('td')).toHaveCount(4);
  });

  test('a rollup row click drills into that client’s SCOPED Business dashboard', async ({ page }) => {
    await installApp(page, { api: { ...AGENCY_API, '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    // click the row itself (not the name link) — the drill still fires
    await page.locator('.tscroll tbody tr[data-drill="/analytics.html?client=s2"] td').nth(1).click();
    await expect(page).toHaveURL(/analytics\.html\?client=s2/);
    // and the destination is the scoped Business dashboard, scope carried
    await expect(page.getByRole('heading', { name: 'Business dashboard' })).toBeVisible();
    await expect(page.getByText('$12,400', { exact: true })).toBeVisible();
  });

  test('a failed portfolio read is the TROUBLE state — never the all-quiet card', async ({ page }) => {
    await installApp(page, { api: AGENCY_API });
    await page.route('**/functions/v1/presence/analytics/portfolio**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/analytics.html');
    await expect(page.getByText('We couldn’t load your analytics just now.')).toBeVisible();
    await expect(page.getByText('All quiet.')).toHaveCount(0);
    await expect(page.locator('.tscroll')).toHaveCount(0);
  });

  test('a 404 from an older function build is the calm warming state', async ({ page }) => {
    await installApp(page, { api: AGENCY_API });
    await page.route('**/functions/v1/presence/analytics/portfolio**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/analytics.html');
    await expect(page.getByText('This dashboard is warming up.')).toBeVisible();
  });

  test('a failed ROSTER read degrades only the rollup — the board stands, with an honest line', async ({ page }) => {
    await installApp(page, { api: AGENCY_API });
    await page.route('**/functions/v1/presence/agency/portfolio**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { name: 'Portfolio dashboard' })).toBeVisible();
    await expect(page.locator('section.card', { has: page.getByRole('heading', { name: 'Clients', exact: true }) }).locator('.kn')).toHaveText('3');
    await expect(page.getByText('The client-by-client list wouldn’t load just now')).toBeVisible();
    await expect(page.locator('.tscroll tbody tr')).toHaveCount(0);
  });

  test('soft ↻ refresh keeps the last-good rollup when only the roster read fails', async ({ page }) => {
    let rosterFails = false;
    await installApp(page, { api: AGENCY_API });
    await page.route('**/functions/v1/presence/agency/portfolio**', (route) => {
      if (rosterFails) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AGENCY_ROSTER) });
    });
    await page.goto('/analytics.html');
    await expect(page.locator('.tscroll tbody tr')).toHaveCount(3);
    // now the roster hiccups while the portfolio read stays fine — ↻ must NOT
    // trade three good rows for the couldn't-load line (loadDash discipline)
    rosterFails = true;
    await page.getByRole('button', { name: '↻ Refresh' }).click();
    await expect(page.getByText('Couldn’t refresh the client list just now.')).toBeVisible();
    await expect(page.locator('.tscroll tbody tr')).toHaveCount(3);   // last-good kept
    await expect(page.getByText('The client-by-client list wouldn’t load just now')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Marlow’s Kitchen' })).toBeVisible();
  });

  test('all-quiet renders ONLY on a successful empty read', async ({ page }) => {
    await installApp(page, { api: { ...AGENCY_API, '/analytics/portfolio': { data: {
      headline: 'All 3 clients are quiet and current — nothing needs you.',
      client_count: 3, insights: [], websites: PORTFOLIO.data.websites,
    } } } });
    await page.goto('/analytics.html');
    await expect(page.getByText('All quiet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Portfolio dashboard' })).toBeVisible();
    await expect(page.locator('.tscroll tbody tr')).toHaveCount(3);   // the rollup still renders
  });

  test('zero clients: never "every client is current" — a calm first-client line instead', async ({ page }) => {
    await installApp(page, { api: { ...AGENCY_API,
      '/analytics/portfolio': { data: { headline: 'No clients yet.', client_count: 0, insights: [], websites: [] } },
      '/agency/portfolio': { data: [] },
    } });
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { name: 'Portfolio dashboard' })).toBeVisible();
    // the all-quiet wording would contradict an empty portfolio
    await expect(page.getByText('Every client is current')).toHaveCount(0);
    await expect(page.getByText('Nothing to watch yet.')).toBeVisible();
    await expect(page.getByText('Add your first client from your Studio tools')).toBeVisible();
    // the rollup keeps its own no-clients empty state
    await expect(page.getByText('No clients yet', { exact: false }).first()).toBeVisible();
  });

  test('no serious/critical axe violations on the portfolio lens', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: AGENCY_API });
    await page.goto('/analytics.html');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Portfolio dashboard' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
