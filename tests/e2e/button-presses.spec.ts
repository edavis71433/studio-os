import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';
import { trackerScript } from '../../supabase/functions/presence/lib/visits';

// List item 157: the visit counter notes which button was pressed (its words) and how
// long a page stayed open; Analytics says which buttons get pressed.

const SITE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A site</title></head><body><main>`
  + `<a class="btn" href="#menu">See the <b>menu</b></a> <a class="btn ghost" href="tel:+15550100">Call us</a> <a href="https://elsewhere.example/">Our Instagram</a>`
  + `</main><script>document.addEventListener('click',function(e){e.preventDefault()})</script>`
  + trackerScript(SITE_ID, 'https://fn.example/functions/v1/presence') + '</body></html>';

test.describe('the visit counter on a published page', () => {
  test('a button press carries its words; a call its words; a plain link none; leaving sends the page’s time once', async ({ page }) => {
    const beacons: any[] = [];
    await page.route('https://site.example/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
    await page.route('https://fn.example/**', (r) => { try { beacons.push(JSON.parse(r.request().postData() || '{}')); } catch { /* not ours */ } return r.fulfill({ status: 204, body: '' }); });
    await page.goto('https://site.example/');
    await expect.poll(() => beacons.filter((b) => b.k === 'pageview').length).toBe(1);
    await page.getByText('See the menu').click();
    await page.getByText('Call us').click();
    await page.getByText('Our Instagram').click();
    await expect.poll(() => beacons.length).toBe(4);
    expect(beacons.find((b) => b.k === 'button')).toMatchObject({ p: '/', l: 'See the menu' });
    expect(beacons.find((b) => b.k === 'phone')).toMatchObject({ l: 'Call us' });
    expect(beacons.find((b) => b.k === 'outbound')).toMatchObject({ l: '' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pagehide')); });
    await expect.poll(() => beacons.filter((b) => b.k === 'leave').length).toBe(1);
    const leave = beacons.find((b) => b.k === 'leave');
    expect(leave.p).toBe('/');
    expect(leave.ms).toBeGreaterThanOrEqual(1000);
  });
});

test.describe('Analytics: buttons people press', () => {
  const DASH = (traffic: Record<string, unknown>) => ({ data: { period: 'this_month', generated_at: '2026-11-10T14:00:00Z',
    sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] },
    website: { traffic: { visitors: 120, pageviews: 300, actions: 9, top_pages: [{ path: '/', views: 200 }, { path: '/menu/', views: 100 }], pages: [{ path: '/', views: 200, visitors: 90 }, { path: '/menu/', views: 100, visitors: 50 }],
      top_sources: [{ source: 'Google', visits: 60, share: 50 }], weekly: [1,2,3,4,5,6,7,8,9,10,11,12], has_data: true, ...traffic }, search: null } } });

  test('the most-pressed buttons, where they are, and how long pages usually stay open', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH({
      buttons: [{ label: 'Book a table', kind: 'button', path: '/', presses: 14, people: 11 }, { label: 'Call us', kind: 'phone', path: '/contact/', presses: 5, people: 5 }],
      time_on_page: { median_seconds: 75, pages: [{ path: '/', seconds: 64, visits: 80 }, { path: '/menu/', seconds: 130, visits: 40 }] },
    }) } });
    await page.goto('/analytics.html');
    const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Buttons people press' }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText('pages usually stay open 1 min 15 sec');
    const rows = card.locator('#buttonTable tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Book a table');
    await expect(rows.first()).toContainText('14');
    await expect(rows.nth(1)).toContainText('Call');
    const pages = page.locator('#pageTable');
    await expect(pages.locator('thead')).toContainText('Time');
    await expect(pages.locator('tbody tr').nth(1)).toContainText('2 min 10 sec');
  });

  // list item 151: how fast each page shows for real visitors
  test('Top pages says how fast each page loads, and the site’s speed in a sentence', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH({ speed: { sentence: 'A little slow on phones: the menu page takes 3.4 s for most visitors.', pages: [{ path: '/', phones_ms: 1900, computers_ms: 900, samples: 60 }, { path: '/menu/', phones_ms: 3400, computers_ms: null, samples: 25 }] } }) } });
    await page.goto('/analytics.html');
    const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Top pages' }) });
    await expect(card).toContainText('A little slow on phones: the menu page takes 3.4 s for most visitors');
    await expect(card.locator('#pageTable thead')).toContainText('Loads in');
    await expect(card.locator('#pageTable tbody tr').nth(0)).toContainText('1.9 s');
    await expect(card.locator('#pageTable tbody tr').nth(1)).toContainText('3.4 s');
  });

  test('no presses yet says so; a server without the new read shows no card at all', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH({ buttons: [], time_on_page: { median_seconds: null, pages: [] } }) } });
    await page.goto('/analytics.html');
    const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Buttons people press' }) });
    await expect(card).toContainText('No presses yet');
    await expect(page.locator('#pageTable thead')).not.toContainText('Time');
    await installApp(page, { api: { '/analytics/dashboard': DASH({}) } });
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { name: 'Top pages' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Buttons people press' })).toHaveCount(0);
  });
});
