import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Help — the approved "ask in your own words" board. The ask box is the
// EXISTING Concierge (POST /concierge/ask, the same call connections.html and
// today.html make); the topic cards point at real pages; the popular answers
// are the plain answers this page always carried, one row each.
test.describe('Help (ask in your own words)', () => {
  test('title · ask box with ONE filled button · suggested questions · six topic cards · answers · rail', async ({ page }) => {
    await installApp(page);
    await page.goto('/help.html');
    await expect(page.locator('#dds-shell')).toBeAttached();   // the shell mounts (phones keep its nav in the drawer)
    await expect(page.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
    await expect(page.getByLabel('Ask a question')).toBeVisible();
    await expect(page.locator('.btn.primary')).toHaveCount(1);
    await expect(page.locator('.btn.primary')).toHaveText('Ask');
    await expect(page.locator('#suggest button')).toHaveCount(4);
    const cards = page.locator('.setgrid .setcard');
    await expect(cards).toHaveCount(6);
    await expect(cards.locator('b')).toHaveText(['Getting started', 'Your website', 'Customers and deals', 'Invoices and payments', 'Files and sharing', 'Connections']);
    await expect(cards.nth(1)).toHaveAttribute('href', '/presence.html');
    await expect(cards.nth(2)).toHaveAttribute('href', '/crm.html');
    await expect(cards.nth(5)).toHaveAttribute('href', '/connections.html');
    // the answers: one row each, folded, with the original copy inside
    const answers = page.locator('#answers details');
    await expect(answers).toHaveCount(7);
    await expect(answers.nth(0)).not.toHaveAttribute('open', '');
    await answers.nth(0).locator('summary').click();
    await expect(answers.nth(0)).toHaveAttribute('open', '');
    await expect(answers.nth(0)).toContainText('Nothing goes live without your OK.');
    // the rail
    await expect(page.getByRole('heading', { name: 'Still stuck?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Write to support' })).toHaveAttribute('href', /^mailto:support@davisdigitalstudio\.com/);
    await expect(page.getByRole('heading', { name: 'Take the tour again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start the tour' })).toBeVisible();
  });

  test('asking sends the question to /concierge/ask and shows the answer; a chip asks its question', async ({ page }) => {
    const asked: string[] = [];
    await installApp(page);
    await page.route('**/functions/v1/presence/concierge/ask', (route) => {
      asked.push(route.request().postDataJSON().question);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { text: 'Publish from the website builder — nothing goes live until you press Publish.' } }) });
    });
    await page.goto('/help.html');
    await page.getByLabel('Ask a question').fill('How do I publish?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.locator('#ans')).toHaveText('Publish from the website builder — nothing goes live until you press Publish.');
    await expect.poll(() => asked).toEqual(['How do I publish?']);
    await page.locator('#suggest button', { hasText: 'Where do enquiries go?' }).click();
    await expect.poll(() => asked).toEqual(['How do I publish?', 'Where do enquiries go?']);
    await expect(page.getByLabel('Ask a question')).toHaveValue('Where do enquiries go?');
    // the answer box is a polite live region
    await expect(page.locator('#ans')).toHaveAttribute('aria-live', 'polite');
  });

  test('a Concierge that has nothing says so — it never guesses', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/concierge/ask', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/help.html');
    await page.getByLabel('Ask a question').fill('Anything?');
    await page.keyboard.press('Enter');
    await expect(page.locator('#ans')).toContainText('I’d rather say so than guess');
    await expect(page.getByRole('button', { name: 'Ask' })).toBeEnabled();
  });

  test('signed out, the ask box points at the answers and support instead of calling anything', async ({ page }) => {
    let calls = 0;
    await installApp(page, { session: null });
    await page.route('**/functions/v1/presence/concierge/ask', (route) => { calls++; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await page.goto('/help.html');
    await page.getByLabel('Ask a question').fill('How do I publish?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.locator('#ans')).toContainText('Sign in to ask about your own studio');
    expect(calls).toBe(0);
  });

  test('Start the tour runs the shell’s own tour', async ({ page }) => {
    await installApp(page);
    await page.goto('/help.html');
    await page.waitForFunction(() => typeof (window as unknown as { ddsTour?: unknown }).ddsTour === 'function');   // the shell is up
    await page.getByRole('button', { name: 'Start the tour' }).click();
    await expect(page.locator('.dds-tour-card')).toBeVisible();
    await page.locator('.dds-tour-card .skip').click();
    await expect(page.locator('.dds-tour-card')).toHaveCount(0);
  });

  test('a #hash deep link opens its answer', async ({ page }) => {
    await installApp(page);
    await page.goto('/help.html#a-billing');
    await expect(page.locator('#a-billing')).toHaveAttribute('open', '');
    await expect(page.locator('#a-billing')).toContainText('Your plan decides which features you see.');
  });

  test('no serious/critical axe violations (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page);
    await page.goto('/help.html');
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
