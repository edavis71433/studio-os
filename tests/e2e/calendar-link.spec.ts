import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales review item 46 (Nov 2026): your bookings and dated tasks in Google
// Calendar — a private link on Connections that Google Calendar subscribes to.
const SURFACE = { data: { edition: 'presence', note: '', groups: { 'Being found': [{
  key: 'google_search_console', label: 'how you show up in Google Search', purpose: '', reads: [], approval: '', availability: 'Read-only',
  connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' }, data: null,
}] } } };
const URL1 = 'https://example.supabase.co/functions/v1/presence/calendar/feed/' + 'a'.repeat(40) + '.ics';
const URL2 = 'https://example.supabase.co/functions/v1/presence/calendar/feed/' + 'b'.repeat(40) + '.ics';

async function withLink(page, first: Record<string, unknown>) {
  const calls: string[] = [];
  let state = first, n = 0;
  await page.route('**/functions/v1/presence/calendar/link', async (route) => {
    const m = route.request().method(); calls.push(m);
    if (m === 'POST') state = { on: true, url: n++ ? URL2 : URL1, created_at: '2026-11-08T12:00:00Z', can_manage: true };
    if (m === 'DELETE') state = { on: false, url: null, created_at: null, can_manage: true };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state }) });
  });
  return calls;
}

test('make the link, read the steps, make a new one, turn it off', async ({ page }) => {
  await installApp(page, { api: { '/connections': SURFACE } });
  const calls = await withLink(page, { on: false, url: null, created_at: null, can_manage: true });
  await page.goto('/connections.html');
  const card = page.locator('#calSec');
  await expect(card).toContainText('Put your bookings and dated tasks in Google Calendar');
  await card.getByRole('button', { name: 'Make my calendar link' }).click();
  await expect(card.getByLabel('Your private calendar link')).toHaveValue(URL1);
  await expect(card).toContainText('From URL');
  await expect(card).toContainText('a new booking can take a few hours to show');
  await card.getByRole('button', { name: 'Make a new link' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make a new link' }).click();
  await expect(card.getByLabel('Your private calendar link')).toHaveValue(URL2);
  await card.getByRole('button', { name: 'Turn it off' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn it off' }).click();
  await expect(card.getByRole('button', { name: 'Make my calendar link' })).toBeVisible();
  expect(calls).toEqual(['GET', 'POST', 'POST', 'DELETE']);
});

test('Cancel on "Make a new link" changes nothing', async ({ page }) => {
  await installApp(page, { api: { '/connections': SURFACE } });
  const calls = await withLink(page, { on: true, url: URL1, created_at: '2026-11-08T12:00:00Z', can_manage: true });
  await page.goto('/connections.html');
  await page.locator('#calSec').getByRole('button', { name: 'Make a new link' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#calSec').getByLabel('Your private calendar link')).toHaveValue(URL1);
  expect(calls).toEqual(['GET']);
});

test('a seat that can\'t manage it sees whether it is on, and no link', async ({ page }) => {
  await installApp(page, { api: { '/connections': SURFACE } });
  await withLink(page, { on: true, url: null, created_at: null, can_manage: false });
  await page.goto('/connections.html');
  const card = page.locator('#calSec');
  await expect(card).toContainText('Your calendar link is on.');
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(card.locator('input')).toHaveCount(0);
});

test('not while a client is in view, and not from an older server', async ({ page }) => {
  await installApp(page, { api: { '/connections': SURFACE } });
  await page.route('**/functions/v1/presence/calendar/link', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
  await page.goto('/connections.html');
  await expect(page.locator('#svc-google_search_console')).toBeVisible();
  await expect(page.locator('#calSec')).toBeHidden();
  await installApp(page, { api: { '/connections': SURFACE } });
  await withLink(page, { on: true, url: URL1, can_manage: true });
  await page.goto('/connections.html?client=44444444-4444-4444-8444-444444444444');
  await expect(page.locator('#svc-google_search_console')).toBeVisible();
  await expect(page.locator('#calSec')).toBeHidden();
});
