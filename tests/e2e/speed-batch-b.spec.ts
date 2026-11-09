import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Final pass on the sales side, speed batch B (Nov 8 2026). At studio level a
// page boot no longer builds the Needs-you list: /portal/context hands back the
// KEPT total (null when none is kept yet) with attention_stale, and the shell
// reads just the number (/agency/needs-you?only=total) behind the page. Home
// reads the whole list anyway and hands the bell its total. Opening the bell is
// one call: the Needs-you answer carries the feed's update rows.

const ctx = (attention_count: number | null, attention_stale: boolean) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count, attention_stale, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} });
const PAID = { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', kind: 'invoice_paid', period: 'paid:i1', tier: 'update', dismissible: true, headline: 'Paid — Invoice ($500.00)', body: 'The payment landed.', href: '/pipeline.html' };
const ROWS = [
  { key: 'enquiry:own:e1', kind: 'enquiry', site_id: null, client_id: null, name: 'Harbor Lane Bakery', what: '3 new enquiries through your website', when: '2 days ago', verb: 'Reply', href: '/inbox.html#enquiries' },
  { key: 'support:s1', kind: 'support', site_id: 's1', client_id: 'c1', name: 'Maple Street Studio', what: 'support request: can you update our hours', when: 'Opened Jul 22', verb: 'Reply', href: '/inbox.html#support' },
];
const needs = (extra: Record<string, unknown> = {}) => ({ data: { rows: ROWS, more: 0, rest: [], total: 2, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {}, ...extra } });
const FEED = { data: { role: 'business_owner', moments: [], pending_approvals: [], client_messages: [], enquiries: [], notices: [PAID] } };
const HOME_API = {
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
  '/sales/deals': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/portal/feed': FEED,
};
const watch = (page: Page) => {
  const seen: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/functions/v1/presence/')) seen.push(u.pathname.replace(/^.*\/functions\/v1\/presence/, '') + u.search); });
  return seen;
};

test.describe('batch B — the badge without building the list on every page', () => {
  test('a missing total: the page shows no number, then the shell reads just the number behind the page', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: { ...HOME_API, '/portal/context': ctx(null, true), '/agency/needs-you': { data: { total: 4, partial: false } } } });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('4');
    expect(seen.filter((s) => s === '/agency/needs-you?only=total')).toHaveLength(1);
  });

  test('a fresh kept total is shown at once and never re-read', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: { ...HOME_API, '/portal/context': ctx(5, false), '/agency/needs-you': { data: { total: 9, partial: false } } } });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('5');
    await page.waitForTimeout(1600);   // past the shell's 1.2 s wait
    expect(seen.filter((s) => s.startsWith('/agency/needs-you'))).toHaveLength(0);
    await expect(page.locator('#dds-bell .dot')).toHaveText('5');
  });

  test('Home hands the bell its own list total, so the shell never reads it again', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: { ...HOME_API, '/portal/context': ctx(7, true), '/agency/needs-you': needs() } });
    await page.goto('/agency.html');
    await expect(page.locator('#needs #qt-needs')).toHaveText('Needs you 2');   // item 70: the list's first tab
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
    await page.waitForTimeout(1600);
    expect(seen.filter((s) => s.includes('only=total'))).toHaveLength(0);
  });

  test('opening the bell is one call: the Needs-you answer carries the update rows', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: { ...HOME_API, '/portal/context': ctx(2, false), '/agency/needs-you': needs({ update_notices: [PAID] }) } });
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
    const before = seen.length;
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await pop.getByRole('tab', { name: 'Needs you' }).click();
    await expect(pop.locator('.body a.row')).toHaveCount(2);
    await pop.getByRole('tab', { name: 'Updates' }).click();
    await expect(pop.locator('.body')).toContainText('Paid — Invoice ($500.00)');
    const opened = seen.slice(before);
    expect(opened.filter((s) => s.startsWith('/portal/feed'))).toHaveLength(0);
    expect(opened.filter((s) => s === '/agency/needs-you')).toHaveLength(1);
  });

  test('an older server without the update rows still gets them from the feed', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: { ...HOME_API, '/portal/context': ctx(2, false), '/agency/needs-you': needs() } });
    await page.goto('/pipeline.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await pop.getByRole('tab', { name: 'Updates' }).click();
    await expect(pop.locator('.body')).toContainText('Paid — Invoice ($500.00)');
    expect(seen.filter((s) => s.startsWith('/portal/feed'))).toHaveLength(1);
  });
});
