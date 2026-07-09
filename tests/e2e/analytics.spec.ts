import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// AN-1 — Analytics is plain-English understanding, honest about what isn't measured.
const HOME = { data: {
  period: 'week',
  headline: 'Here’s how your business is doing this week.',
  insights: [
    { key: 'inquiries', title: 'Inquiries', sentence: 'You received 6 inquiries this week — up from 4 the week before.', number: 6, detail: '2 inquiries are still waiting for a reply.', href: '/leads.html', tone: 'good' },
    { key: 'publishing', title: 'Your website', sentence: 'Your website was last updated 5 days ago.', number: 1, href: '/presence.html', tone: 'neutral' },
  ],
  health: { sentence: 'Everything looks healthy.', status: 'healthy', suggestions: [] },
  watching: [{ headline: 'More people are finding you lately.', summary: 'Search interest is up.', moment_type: 'celebration' }],
  not_measured: [{ key: 'traffic', title: 'Website visitors', sentence: 'Visitor numbers aren’t turned on yet — connect Google Analytics.', number: null, href: '/connections.html' }],
} };

test.describe('Analytics (plain-English understanding)', () => {
  test('mounts under the shell and leads with sentences, not charts', async ({ page }) => {
    await installApp(page, { api: { '/analytics': HOME } });
    await page.goto('/analytics.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(page.getByText('You received 6 inquiries this week — up from 4 the week before.')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0); // no charts
  });

  test('is honest about what it cannot measure — never a fabricated number', async ({ page }) => {
    await installApp(page, { api: { '/analytics': HOME } });
    await page.goto('/analytics.html');
    await expect(page.getByText('Not measured yet')).toBeVisible();
    await expect(page.getByText(/Visitor numbers aren’t turned on yet/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Connect →' })).toBeVisible();
  });

  test('forwards the scope header (SC-1) on its data call', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    let sentScope = '';
    await installApp(page, { api: { '/analytics': HOME } });
    await page.route('**/functions/v1/presence/analytics**', (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'] || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HOME) });
    });
    await page.goto(`/analytics.html?client=${CLIENT}`);
    await expect(page.getByText(/inquiries this week/)).toBeVisible();
    expect(sentScope).toBe(CLIENT);
  });
});
