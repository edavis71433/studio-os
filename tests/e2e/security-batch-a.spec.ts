import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Final pass on the sales side, security batch A (Nov 8 2026): a studio only
// gets a site it created, one already its customer, or one whose OWNER pressed
// Accept. The owner sees the request at the top of the page; the studio sees
// "Request sent" instead of a takeover.
const REQ = 'aaaaaaaa-5555-4555-8555-000000000001';
const CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ['website', 'relationship'],
  is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/today.html', attention_count: 0, plan_key: 'presence', upsell: null,
  studio_requests: [{ id: REQ, studio: 'Harbor Design Co' }],
} };

test.describe('the owner answers a studio\'s request', () => {
  test('Accept: says what it means, asks the server, and confirms', async ({ page }) => {
    const calls: string[] = [];
    await installApp(page, { api: { '/portal/context': CTX } });
    await page.route(`**/functions/v1/presence/portal/studio-requests/${REQ}/*`, (route) => {
      calls.push(route.request().method() + ' ' + new URL(route.request().url()).pathname.replace(/^.*\/presence/, ''));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { accepted: true, studio: 'Harbor Design Co' } }) });
    });
    await page.goto('/today.html');
    const box = page.getByRole('region', { name: 'A studio asked to work with you' });
    await expect(box).toContainText('Harbor Design Co asked to work with you on Studio OS');
    await expect(box).toContainText('they can open and work on your website');
    await box.getByRole('button', { name: 'Accept' }).click();
    await expect(page.locator('.dds-toast')).toContainText('You’re connected with Harbor Design Co.');
    expect(calls).toEqual([`POST /portal/studio-requests/${REQ}/accept`]);
  });

  test('Decline: the banner goes, nothing else happens', async ({ page }) => {
    const calls: string[] = [];
    await installApp(page, { api: { '/portal/context': CTX } });
    await page.route(`**/functions/v1/presence/portal/studio-requests/${REQ}/*`, (route) => {
      calls.push(new URL(route.request().url()).pathname.split('/').pop() || '');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { declined: true } }) });
    });
    await page.goto('/today.html');
    const box = page.getByRole('region', { name: 'A studio asked to work with you' });
    await box.getByRole('button', { name: 'Decline' }).click();
    await expect(box).toHaveCount(0);
    expect(calls).toEqual(['decline']);
  });

  test('a refusal keeps the banner and says why', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': CTX } });
    await page.route(`**/functions/v1/presence/portal/studio-requests/${REQ}/*`, (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'owned_elsewhere', message: 'Another studio already looks after your website on Studio OS. Ask them to let it go first, then accept this request.' }) }));
    await page.goto('/today.html');
    const box = page.getByRole('region', { name: 'A studio asked to work with you' });
    await box.getByRole('button', { name: 'Accept' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Another studio already looks after your website');
    await expect(box.getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  test('no requests, no banner', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'A studio asked to work with you' })).toHaveCount(0);
  });
});

test('Customers: connecting an account that isn\'t yours says "Request sent"', async ({ page }) => {
  let sent: unknown = null;
  await installApp(page, { api: { '/studio/customers': { data: [] } } });
  await page.route('**/functions/v1/presence/sales/customers', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { mode: 'connect', requested: true, pending: true, connected: false, message: 'x' } }) });
  });
  await page.goto('/customers.html');
  await page.locator('#addCust').click();
  await page.locator('input[name="cumode"][value="connect"]').check();
  await page.locator('#cu-email').fill('sam@harbor.test');
  await page.locator('#cu-submit').click();
  await expect(page.locator('#cust-done')).toContainText('Request sent');
  await expect(page.locator('#cust-done')).toContainText('they need to say yes first');
  await expect(page.locator('#cust-done')).not.toContainText('Their sign-in page');
  expect(sent).toMatchObject({ mode: 'connect', email: 'sam@harbor.test' });
});
