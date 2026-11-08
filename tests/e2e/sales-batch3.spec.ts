import { test, expect } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_NAV } from './helpers/app';

// Sales review, Nov 2026 — the third batch:
//   item 15  a watch-plan client's site is hosted elsewhere: Home never calls
//            it "Live" and Analytics never calls it a draft (one rule,
//            analytics/compose.ts siteState, mirrored by agency.html).
//   item 18  the Inbox lists what people said or asked (tested in inbox.spec.ts).
//   item 22  a won deal that never became a customer says so on Pipeline and
//            opens at "Convert to customer"; ?deal=X#convert does the same.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null, scope: null,
} };

test.describe('item 15 — hosted elsewhere is its own state', () => {
  test('Home: a watch-plan client reads "Hosted elsewhere", a hosted one "Live", a draft "Not live yet"', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:agency', 'table'); } catch { /* denied */ } });
    const row = (o: Record<string, unknown>) => ({ site_id: '', name: '', edition: 'presence', status: 'ready', archived: false, tags: [], attention: 0, leads_waiting: 0, last_published_at: null, ...o });
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
      '/agency/portfolio': { data: [
        row({ site_id: 'w1', name: 'Watched Cafe', edition: 'monitor', status: 'ready' }),
        row({ site_id: 'h1', name: 'Hosted Bakery', status: 'live', last_published_at: '2026-10-01T00:00:00Z' }),
        row({ site_id: 'd1', name: 'Draft Dental' }),
      ] },
      '/agency/needs-you': { data: { rows: [], rest: [], more: 0, total: 0, empty_line: 'Everything is paid and published.', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
      '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
    } });
    await page.goto('/agency.html');
    const table = page.locator('.tscroll table');
    await expect(table.locator('tbody tr', { hasText: 'Watched Cafe' }).locator('.pill')).toHaveText('Hosted elsewhere');
    await expect(table.locator('tbody tr', { hasText: 'Hosted Bakery' }).locator('.pill')).toHaveText('Live');
    await expect(table.locator('tbody tr', { hasText: 'Draft Dental' }).locator('.pill')).toHaveText('Not live yet');
  });

  test('Analytics: Sites live counts only sites live here, and names the ones hosted elsewhere', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/analytics/portfolio': { data: { headline: 'All 4 clients are quiet and current.', client_count: 4, insights: [], websites: [
        { site_id: 'w1', name: 'Watched Cafe', draft_live: 'draft', site_state: 'elsewhere', leads_waiting: 0, needs_attention: false, plan_status: 'active' },
        { site_id: 'w2', name: 'Watched Gym', draft_live: 'draft', site_state: 'elsewhere', leads_waiting: 0, needs_attention: false, plan_status: 'active' },
        { site_id: 'h1', name: 'Hosted Bakery', draft_live: 'live', site_state: 'live', leads_waiting: 0, needs_attention: false, plan_status: 'active' },
        { site_id: 'd1', name: 'Draft Dental', draft_live: 'draft', site_state: 'draft', leads_waiting: 0, needs_attention: false, plan_status: 'active' },
      ] } },
      '/agency/portfolio': { data: [] },
    } });
    await page.goto('/analytics.html');
    const tile = page.locator('#portfolioStats .stat', { has: page.locator('.kt', { hasText: /^Sites live$/ }) });
    await expect(tile.locator('.v')).toHaveText('1');
    await expect(tile).toContainText('2 hosted elsewhere · 1 still in draft');
  });
});

test.describe('item 22 — won, not a customer yet', () => {
  const WON = '77777777-7777-4777-8777-777777777777';
  const OPEN = '88888888-8888-4888-8888-888888888888';
  const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const deals = { data: [
    { id: OPEN, title: 'Acme website', stage: 'proposal', source: 'manual', expected_value_cents: 500000, contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false },
    { id: WON, title: 'Willow Day Spa', stage: 'won', source: 'manual', expected_value_cents: 195000, contact_id: 'ct-1', converted_client_id: null, updated_at: past(2), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: true },
  ] };
  const detail = { data: {
    deal: { id: WON, title: 'Willow Day Spa', stage: 'won', expected_value_cents: 195000, contact_id: 'ct-1', converted_client_id: null, retainer: null, notes: '' },
    contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Willow', notes: '' },
    proposals: [], contracts: [{ id: 'k1', title: 'Service agreement', status: 'signed', signer_name: 'Sam Rivera', signed_at: past(3) }], events: [], timeline: [], invoices: [], last_contacted_at: null,
  } };
  const API = {
    '/sales/deals': deals, [`/sales/deals/${WON}`]: detail, [`/sales/deals/${WON}/tasks`]: { data: [] },
    '/sales/summary': { data: { total: 2, open: { count: 1, value_cents: 500000 }, won_month: { count: 1, value_cents: 195000 }, win_rate: { pct: 100, won: 1, lost: 0 }, by_stage: [], ar: {} } },
    '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Willow', updated_at: past(1) }] },
    '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
    '/identity': { data: { business_name: 'Test Studio' } },
  };
  const display = (page: import('@playwright/test').Page, v: string) => page.addInitScript((val) => { try { localStorage.setItem('dds-display:pipeline', val); } catch { /* denied */ } }, v);

  test('List: the row says it, and opening it lands on Convert', async ({ page }) => {
    await display(page, 'list');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const card = page.locator('#list .card', { hasText: 'Willow Day Spa' });
    await expect(card).toContainText('Not a customer yet — open to make them one');
    await expect(page.locator('#list .card', { hasText: 'Acme website' })).not.toContainText('Not a customer yet');
    await card.click();
    await expect(page.getByRole('tab', { name: /Billing/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#convert')).toBeFocused();
  });

  test('Table: the stage cell says it too', async ({ page }) => {
    await display(page, 'table');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#table tbody tr', { hasText: 'Willow Day Spa' })).toContainText('not a customer yet');
  });

  test('?deal=X#convert (Home\'s Convert, the signed notice) opens Billing at Convert', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto(`/pipeline.html?deal=${WON}#convert`);
    await expect(page.getByRole('tab', { name: /Billing/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#convert')).toBeFocused();
  });
});
