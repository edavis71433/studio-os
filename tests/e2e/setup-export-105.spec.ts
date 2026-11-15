import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 105's last parts: a setup strip on Home that can be hidden; one clear
// button on every empty list; and the export for a bookkeeper on Invoices. Drawn in
// Figma first (page "Sales 94 · 105 · 93 · 120", part 4). Runs at all three sizes.
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'delete', 'export'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const HOME = {
  '/portal/context': STUDIO_CTX,
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [] } },
  '/sales/deals': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/sales/my-tasks': { data: { partial: false, total: 0, items: [] } },
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'Everything is paid and published.', partial: false, own_site: true, next_by_site: {}, next_by_client: {}, old: { count: 0, items: [] }, snooze_ready: true, snoozed: [] } },
};
const STEPS = [
  { key: 'business', title: 'Your business details', why: 'Your name and address on invoices and emails', act: 'Add them', href: '/settings.html#studio', done: true },
  { key: 'logo', title: 'Your logo', why: 'On emails, invoices and the client portal', act: 'Choose it', href: '/files.html', done: false },
  { key: 'services', title: 'Services and prices', why: 'Proposals fill themselves in', act: 'Add a service', href: '/pipeline.html?services=1', done: true },
  { key: 'contact', title: 'Your first contact', why: 'Add one, or bring in a list', act: 'Add a contact', href: '/contacts.html?add=1', done: false },
  { key: 'deal', title: 'Your first deal', why: 'Pipeline follows it to Won', act: 'Add a deal', href: '/pipeline.html', done: true },
];
const SETUP = { data: { steps: STEPS, hidden: false, shows: true, done: 3, total: 5 } };
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test.describe('sales item 105 — setup strip, empty lists, the export for a bookkeeper', () => {
  test('Home: the setup strip says what is left, each with its one button, and Hide puts it away with an Undo', async ({ page }) => {
    const sent: Array<{ path: string; body: unknown }> = [];
    await installApp(page, { api: { ...HOME, '/sales/setup': SETUP } });
    await page.route(/\/functions\/v1\/presence\/sales\/setup$/, async (route: Route) => {
      if (route.request().method() === 'POST') { sent.push({ path: '/sales/setup', body: route.request().postDataJSON() }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { hidden: true } }) }); }
      return route.fallback();
    });
    await page.goto('/agency.html');
    const strip = page.getByRole('region', { name: 'Finish setting up' });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('3 of 5 done');
    const steps = strip.getByRole('listitem');
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(0)).toContainText('Done');
    await expect(steps.nth(1).getByRole('link', { name: 'Choose it' })).toHaveAttribute('href', '/files.html');
    await expect(steps.nth(3).getByRole('link', { name: 'Add a contact' })).toHaveAttribute('href', '/contacts.html?add=1');
    // the next thing to do is the one filled button; the others are outlined
    await expect(steps.nth(1).getByRole('link', { name: 'Choose it' })).not.toHaveClass(/ghost/);
    await expect(steps.nth(3).getByRole('link', { name: 'Add a contact' })).toHaveClass(/ghost/);
    // it sits above Needs you
    const sBox = await strip.boundingBox(), nBox = await page.locator('#needs').boundingBox();
    if (sBox && nBox && nBox.height) expect(sBox.y).toBeLessThan(nBox.y);
    await noOverflow(page);
    await strip.getByRole('button', { name: 'Hide' }).click();
    await expect(strip).toBeHidden();
    expect(sent).toEqual([{ path: '/sales/setup', body: { hidden: true } }]);
    await expect(page.getByText('Setup steps hidden.')).toBeVisible();
  });

  test('Home: nothing left to do, or a server without the strip, shows nothing', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/sales/setup': { data: { steps: STEPS.map((s) => ({ ...s, done: true })), hidden: false, shows: false, done: 5, total: 5 } } } });
    await page.goto('/agency.html');
    await expect(page.locator('#needs')).toBeVisible();
    await expect(page.locator('#setup')).toBeHidden();
  });

  test('Invoices: the export for a bookkeeper asks for the days picked and downloads the zip', async ({ page }) => {
    let asked = '';
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/invoices': { data: { items: [], today: '2026-11-12', partial: false } } } });
    await page.route(/\/functions\/v1\/presence\/sales\/export\/accounting/, (route: Route) => {
      asked = new URL(route.request().url()).search;
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="for-your-bookkeeper-2026-10-01-to-2026-10-31.zip"' }, body: 'PK' });
    });
    await page.goto('/invoices.html');
    // an empty list offers its one thing to do
    await expect(page.locator('#ilist').getByRole('button', { name: 'Send an invoice' })).toBeVisible();
    await page.getByRole('button', { name: 'For your bookkeeper' }).click();
    const dlg = page.getByRole('dialog', { name: 'Export for your bookkeeper' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('invoices.csv');
    await expect(dlg).toContainText('payments.csv');
    await dlg.getByRole('button', { name: 'Last month' }).click();
    await expect(dlg.getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.getByLabel('From')).toBeHidden();   // the days only show for Pick dates
    await dlg.getByRole('button', { name: 'Download the zip' }).scrollIntoViewIfNeeded();
    await expect(dlg.getByRole('button', { name: 'Download the zip' })).toBeInViewport();
    const dl = page.waitForEvent('download');
    await dlg.getByRole('button', { name: 'Download the zip' }).click();
    expect((await dl).suggestedFilename()).toBe('for-your-bookkeeper-2026-10-01-to-2026-10-31.zip');
    const q = new URLSearchParams(asked);
    const t = new Date(), last = new Date(t.getFullYear(), t.getMonth(), 0), first = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    expect([q.get('from'), q.get('to'), q.get('tzo')]).toEqual([ymd(first), ymd(last), String(new Date().getTimezoneOffset())]);
    await expect(dlg).toBeHidden();
    await noOverflow(page);
  });

  test('Invoices: an export that couldn\'t be made says why in the dialog and downloads nothing', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/invoices': { data: { items: [], today: '2026-11-12', partial: false } } } });
    await page.route(/\/functions\/v1\/presence\/sales\/export\/accounting/, (route: Route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed', message: 'Your invoices couldn’t load just now, so nothing was downloaded. Try again in a moment.' }) }));
    await page.goto('/invoices.html');
    await page.getByRole('button', { name: 'For your bookkeeper' }).click();
    const dlg = page.getByRole('dialog', { name: 'Export for your bookkeeper' });
    await dlg.getByRole('button', { name: 'Pick dates' }).click();
    await expect(dlg.getByLabel('From')).toBeVisible();
    await dlg.getByRole('button', { name: 'Download the zip' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Your invoices couldn’t load just now, so nothing was downloaded. Try again in a moment.');
    await expect(dlg.getByRole('button', { name: 'Download the zip' })).toBeEnabled();
  });

  test('empty lists: Contacts offers Add a contact, and ?add=1 opens it straight away', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/contacts': { data: [], total: 0 } } });
    await page.goto('/contacts.html');
    const empty = page.locator('#listZone');
    await expect(empty.getByRole('heading', { name: 'No contacts yet.' })).toBeVisible();
    await empty.getByRole('button', { name: '+ Add a contact' }).click();
    await expect(page.locator('#newDlg')).toBeVisible();
    await page.goto('/contacts.html?add=1');
    await expect(page.locator('#newDlg')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');   // the address loses ?add=1, so a reload doesn't open it again
  });

  test('empty lists: a board with no open deals offers + New deal; an empty People list offers + Add a person', async ({ page }) => {
    const won = [{ id: '11111111-1111-4111-8111-1111111111d9', title: 'Willow Spa — site', stage: 'won', contact_id: null, expected_value_cents: 195000, source: 'manual', converted_client_id: 'c9', converted_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
    await installApp(page, { api: { '/sales/deals': { data: won }, '/sales/contacts': { data: [] }, '/settings': { data: { stage_stale_days: {} } },
      '/sales/summary': { data: { total: 1, open: { count: 0, value_cents: 0 }, won_month: { count: 1, value_cents: 195000 }, win_rate: { pct: null, won: 1, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0 } } } } });
    await page.goto('/pipeline.html');
    await expect(page.getByText('No open deals yet. Add one to start the pipeline.')).toBeVisible();
    await page.locator('[data-first-deal]').click();
    await expect(page.locator('#formDlg')).toBeVisible();
    await installApp(page, { api: { '/studio/customers': { data: [] }, '/sales/contacts': { data: [] } } });
    await page.goto('/customers.html?tab=people');
    await expect(page.getByRole('link', { name: '+ Add a person' })).toHaveAttribute('href', '/contacts.html?add=1');
  });
});
