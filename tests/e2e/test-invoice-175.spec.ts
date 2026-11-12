import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Builder list item 175 (Nov 2026): "Send a test to myself" on Invoices, the way Squarespace
// and Wix let you see an invoice before a customer does. POST /sales/invoices/test answers
// { data: { sent_to, stripe } } (routes/sample_invoice.ts; tests/presence/sample_invoice_test.mjs).

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const ymd = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const INVOICES = { data: { today: ymd(Date.now()), partial: false, items: [] } };
const toast = (page: Page, text: string) => page.locator('.dds-toast', { hasText: text });

type Answer = { status: number; body: unknown };
/** The page, with POST /sales/invoices/test answering `answer` (change it between presses). */
async function openInvoices(page: Page, answer: Answer, hold?: Promise<void>) {
  const sent: Array<{ method: string; body: unknown }> = [];
  await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/invoices': INVOICES } });
  await page.route(/\/functions\/v1\/presence\/sales\/invoices\/test$/, async (route: Route) => {
    sent.push({ method: route.request().method(), body: route.request().postDataJSON() });
    if (hold) await hold;
    await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });
  await page.goto('/invoices.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invoices');
  return Object.assign(sent, { answer });
}

test.describe('Invoices: send a test to myself (builder list item 175)', () => {
  test('first in the header tools; one test at a time; it says where it went and that nobody else gets it', async ({ page }) => {
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => { release = r; });
    const sent = await openInvoices(page, { status: 200, body: { data: { sent_to: 'owner@studio.example', stripe: true } } }, hold);
    await expect(page.locator('.head .tools button')).toHaveText(['Send a test to myself', 'Download CSV', 'Send an invoice']);
    const btn = page.getByRole('button', { name: 'Send a test to myself' });
    await btn.click();
    await expect(page.locator('#testInvBtn')).toHaveText('Sending…');
    await expect(page.locator('#testInvBtn')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#testInvBtn').dispatchEvent('click');   // a second press while it sends sends nothing more (Playwright won't click an aria-disabled button)
    release();
    await expect(toast(page, 'A test invoice is on its way to owner@studio.example. It’s a sample: no invoice is made and nobody else gets it.')).toBeVisible();
    await expect(page.locator('#testInvBtn')).toHaveText('Send a test to myself');
    await expect(page.locator('#testInvBtn')).not.toHaveAttribute('aria-disabled', 'true');
    expect([...sent]).toEqual([{ method: 'POST', body: {} }]);
  });

  test('before Stripe is connected it says real invoices need it; a failed send says why; an older server says it is coming', async ({ page }) => {
    const s = await openInvoices(page, { status: 200, body: { data: { sent_to: 'owner@studio.example', stripe: false } } });
    const btn = page.getByRole('button', { name: 'Send a test to myself' });
    await btn.click();
    await expect(toast(page, 'Real invoices need Stripe connected first.')).toBeVisible();

    Object.assign(s.answer, { status: 502, body: { error: 'fetch_failed', message: 'The test didn’t send. Check that email sending is set up, then try again.' } });
    await btn.click();
    await expect(toast(page, 'The test didn’t send. Check that email sending is set up, then try again.')).toBeVisible();

    Object.assign(s.answer, { status: 404, body: {} });
    await btn.click();
    await expect(toast(page, 'Test invoices are on their way to your account. Try again after the next update.')).toBeVisible();
    expect(s).toHaveLength(3);
  });

  test('on a phone the header tools fit, each big enough for a finger', async ({ page }) => {
    await openInvoices(page, { status: 200, body: { data: { sent_to: 'owner@studio.example', stripe: true } } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    if ((page.viewportSize()?.width || 1280) < 768) {
      for (const b of await page.locator('.head .tools button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
