import { test, expect } from '@playwright/test';

// List item 138: the free Site Review and AI Visibility Check load Cloudflare's
// "are you a person" check (about 358 kB) when the visitor starts filling in the
// form, not with the page. Cloudflare is stubbed: a widget that renders but has
// no answer yet, as when the check is still deciding.
const STUB = "window.turnstile = { render: function () { return 'w1'; }, getResponse: function () { return ''; }, reset: function () {} };";

for (const path of ['/site-review.html', '/ai-visibility.html']) {
  test(`${path}: nothing goes to Cloudflare until the visitor starts, then the check loads once`, async ({ page }) => {
    const asked: string[] = [];
    await page.route('https://challenges.cloudflare.com/**', (r) => { asked.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB }); });
    await page.goto(path);
    await expect(page.locator('#srForm')).toBeVisible();
    await page.waitForTimeout(400);
    expect(asked, 'no request before the visitor starts').toEqual([]);
    const first = page.locator('#srForm input[type="text"]').first();
    await first.click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain('/turnstile/v0/api.js');
    await page.locator('#srForm input[type="text"]').nth(1).click();
    await page.waitForTimeout(200);
    expect(asked.length, 'loaded once, not per field').toBe(1);
  });

  test(`${path}: a press before the check has answered asks to wait, and never says it couldn't load`, async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB }));
    await page.goto(path);
    const f = page.locator('#srForm');
    if (path === '/site-review.html') await f.locator('input[name="url"]').fill('example-bistro.com');
    else { await f.locator('input[name="business_name"]').fill('Example Bistro'); await f.locator('input[name="city"]').fill('Burbank'); }
    await f.locator('button[type="submit"]').click();
    await expect(page.locator('#srMsg')).toContainText('press the button again');
    await expect(page.locator('#srError')).toBeHidden();
  });

  test(`${path}: when Cloudflare can't be reached, a press says so plainly`, async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/**', (r) => r.abort());
    await page.goto(path);
    const f = page.locator('#srForm');
    if (path === '/site-review.html') await f.locator('input[name="url"]').fill('example-bistro.com');
    else { await f.locator('input[name="business_name"]').fill('Example Bistro'); await f.locator('input[name="city"]').fill('Burbank'); }
    await page.waitForTimeout(300);   // the failed load reports back
    await f.locator('button[type="submit"]').click();
    await expect(page.locator('#srError')).toBeVisible();
    await expect(page.locator('#srErrorText')).toContainText('challenges.cloudflare.com');
  });
}
