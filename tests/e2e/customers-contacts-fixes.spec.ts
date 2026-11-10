import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Nov 10 bug hunt, Customers and Contacts (B3 and three small ones):
//   B3  Customers picks up the renewed sign-in pass (it kept the first one and said
//       "sign in" an hour after the page opened)
//   B21 the preview says a failed read of the latest, and the next open asks again
//       (it was remembered as "Nothing yet"); a search narrows the ticked rows to the
//       ones it shows; "Updated" counts calendar days, not 24-hour blocks
// Every name below is made up.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', person_name: 'Ada Park', email: 'ada@acme.example', project_id: 'p1', project_name: 'Website rebuild', status: 'active', customer_site_id: 'site-acme', open_support: 0, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', person_name: 'Bo Reyes', email: 'bo@beta.example', project_id: 'p2', project_name: 'Booking page', status: 'active', customer_site_id: 'site-beta', open_support: 0, project_count: 1 },
] };
const RECORD = { data: {
  identity: { client_id: 'c-acme', customer_site_id: 'site-acme', project_id: 'p1', deal_id: 'aaaaaaaa-0000-4000-8000-0000000000d1', contact_id: null },
  header: { name: 'Acme Bakery', company: 'Acme Bakery', email: 'ada@acme.example', phone: '', status: 'customer' },
  highlights: { value_cents: 320000, stage: 'proposal' },
  sections: { overview: true, details: true, deal: true, delivery: true }, default_tab: 'details', canonical: { key: 'client', value: 'site-acme' },
} };
const ACTIVITY = { data: { reply_to: null, reply_support_to: null, upcoming: [], items: [
  { id: 'a1', kind: 'deal_activity', type: 'call', title: 'You called Ada', body: null, at: ago(2), meta: 'Deal', href: null },
] } };
const pinTable = (page: Page) => page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'table'); } catch { /* denied */ } });

test.describe('item 99 — Customers keeps you signed in (B3)', () => {
  test('after the hourly renewal, the next read carries the new pass', async ({ page }) => {
    await installApp(page, { api: { '/studio/customers': CUSTOMERS, '/sales/contacts': { data: [] } } });
    // a stand-in that remembers who listens for the renewal (helpers/app.ts's stub drops them)
    await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route) => route.fulfill({ contentType: 'application/javascript', body: `
      window.supabase = { createClient: function () { return { auth: {
        getSession: async function () { return { data: { session: window.__E2E_SESSION || null } }; },
        getUser: async function () { return { data: { user: (window.__E2E_SESSION || {}).user || null } }; },
        onAuthStateChange: function (cb) { (window.__authCbs = window.__authCbs || []).push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: async function () { return { error: null }; },
      } }; } };` }));
    const people: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('/sales/contacts')) people.push(r.headers()['x-dds-user-jwt']); });
    await page.goto('/customers.html');
    await expect(page.getByText('Acme Bakery').first()).toBeVisible();
    await page.evaluate(() => (window as unknown as { __authCbs: Array<(e: string, s: unknown) => void> }).__authCbs.forEach((cb) => cb('TOKEN_REFRESHED', { access_token: 'renewed-token' })));
    await page.getByRole('tab', { name: /People/ }).click();
    await expect.poll(() => people.length).toBeGreaterThan(0);
    expect(people.every((t) => t === 'renewed-token')).toBe(true);
  });
});

test.describe('the Customers preview and picks (B21)', () => {
  test('a failed read of the latest says so, and opening it again asks again', async ({ page }) => {
    await installApp(page, { api: { '/studio/customers': CUSTOMERS, '/crm/record': RECORD, '/crm/activity': ACTIVITY } });
    let fail = true, asked = 0;
    await page.route('**/functions/v1/presence/crm/activity**', (route) => { asked++; return fail ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"read_failed"}' }) : route.fallback(); });
    await page.goto('/customers.html');
    const open = () => page.locator('.cust').filter({ hasText: 'Acme Bakery' }).getByRole('button', { name: 'Preview Acme Bakery' }).click();
    await open();
    const pv = page.locator('#cprev');
    await expect(pv).toContainText('We couldn’t load the latest just now.');
    await expect(pv).not.toContainText('Nothing yet');
    fail = false;
    await pv.getByRole('button', { name: 'Close preview' }).click();
    await open();
    await expect(pv.locator('.cp-latest li')).toHaveCount(1);
    await expect(pv).toContainText('You called Ada');
    expect(asked).toBe(2);
  });

  test('a search narrows the ticked rows to the ones it shows', async ({ page }) => {
    let listBody: unknown = null;
    await pinTable(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.route('**/functions/v1/presence/broadcasts/lists', (route) => { listBody = route.request().postDataJSON(); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'list-0042' } }) }); });
    await page.goto('/customers.html');
    await page.getByLabel('Select Acme Bakery').check();
    await page.getByLabel('Select Beta Salon').check();
    const bar = page.getByRole('region', { name: 'Selected customers' });
    await expect(bar).toContainText('2 selected');
    await page.locator('#search').fill('beta');
    await expect(bar).toContainText('1 selected');
    await bar.getByRole('button', { name: 'Send an update' }).click();
    await expect(page).toHaveURL(/\/broadcasts\.html\?list=list-0042$/);
    expect(listBody).toEqual({ name: '', people: [{ email: 'bo@beta.example', name: 'Beta Salon' }] });
  });
});

test.describe('Contacts — "Updated" counts calendar days (B21)', () => {
  test('last night at 11pm is "yesterday" at 9am, not "today"', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-10T09:00:00Z') });   // the suite's browsers run on UTC
    await installApp(page, { api: { '/sales/contacts': { data: [] } } });
    await page.goto('/contacts.html');
    const got = await page.evaluate(() => { const f = (window as unknown as { relWhen: (s: string) => string }).relWhen; return [f('2026-11-09T23:00:00Z'), f('2026-11-10T00:30:00Z'), f('2026-11-08T09:30:00Z'), f('2026-11-03T08:00:00Z')]; });
    expect(got).toEqual(['yesterday', 'today', '2 days ago', 'last week']);
  });
});
