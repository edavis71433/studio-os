import { test, expect } from '@playwright/test';

// ── doc.html — the Document of Record viewer on OUR origin ───────────────────
// The document itself is server-rendered by GET /sales/doc/<token>, but the
// default *.supabase.co domain rewrites GET text/html responses to text/plain,
// so that URL can't be opened directly in a browser. doc.html fetches the same
// route and document.write()s the returned HTML. These specs fixture the route:
// the success fixture even mimics the platform's text/plain downgrade, proving
// the viewer renders regardless of the response content type.

const FIXTURE_DOC = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Proposal — Fixture Studio</title></head><body><h1>Website Redesign Proposal</h1><p>Prepared for Casey Client — total $4,200.00</p></body></html>`;

test.describe('doc.html viewer', () => {
  test('fetches the tokened document and renders it (title + body)', async ({ page }) => {
    let requested = '';
    await page.route('**/functions/v1/presence/sales/doc/**', (route) => {
      requested = route.request().url();
      // text/plain on purpose: exactly what the *.supabase.co domain serves.
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: FIXTURE_DOC });
    });
    await page.goto('/doc.html?t=fixture-token-123');
    await expect(page.locator('h1')).toHaveText('Website Redesign Proposal');
    await expect(page.getByText('Prepared for Casey Client — total $4,200.00')).toBeVisible();
    await expect(page).toHaveTitle('Proposal — Fixture Studio'); // the written doc replaces the shell <title>
    expect(requested).toContain('/functions/v1/presence/sales/doc/fixture-token-123');
  });

  test('an expired/invalid token (403) shows the friendly error, not raw output', async ({ page }) => {
    await page.route('**/functions/v1/presence/sales/doc/**', (route) =>
      route.fulfill({ status: 403, contentType: 'text/plain; charset=utf-8', body: '<!doctype html><title>Document unavailable</title>' }));
    await page.goto('/doc.html?t=expired-token');
    await expect(page.locator('#state h1')).toHaveText('This document link isn’t working');
    await expect(page.getByText('ask your studio for a fresh copy')).toBeVisible();
  });

  test('a missing token shows the error immediately (no fetch)', async ({ page }) => {
    let called = false;
    await page.route('**/functions/v1/presence/**', (route) => { called = true; return route.abort(); });
    await page.goto('/doc.html');
    await expect(page.locator('#state h1')).toHaveText('This document link isn’t working');
    expect(called).toBe(false);
  });

  test('a network failure shows the error, not a hung “Preparing…” state', async ({ page }) => {
    await page.route('**/functions/v1/presence/sales/doc/**', (route) => route.abort('failed'));
    await page.goto('/doc.html?t=any-token');
    await expect(page.locator('#state h1')).toHaveText('This document link isn’t working');
  });
});
