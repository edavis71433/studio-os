import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// ── Retired lens pages forward to their homes (Oct 2026 workflow audit, change 1) ──
// Each old URL still works — bookmarks, emails and old notices land on the page
// that now shows the same thing, with ?client= (and any other query) kept.
const CASES: [string, RegExp][] = [
  ['/attention.html?client=marlows', /\/inbox\.html\?client=marlows#website$/],
  ['/approval-center.html', /\/inbox\.html#ok$/],
  ['/snapshot-history.html', /\/presence\.html#history$/],
  ['/upcoming.html', /\/today\.html#coming-up$/],
  ['/business-insights.html?period=last_30', /\/analytics\.html\?period=last_30#insights$/],
];

test.describe('Retired lens pages', () => {
  for (const [from, to] of CASES) {
    test(`${from} forwards to its home`, async ({ page }) => {
      await installApp(page);
      await page.goto(from);
      await expect(page).toHaveURL(to);
    });
  }
  test('the stubs are noindex and carry a plain link for no-JS visitors', async ({ request }) => {
    const res = await request.get('/attention.html');
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain('href="/inbox.html#website"');
  });
});
