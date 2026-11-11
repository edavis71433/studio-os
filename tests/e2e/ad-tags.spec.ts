import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';
import { adTagsScript } from '../../supabase/functions/presence/lib/ad_tags';

// List item 152: the Google tag and the Meta Pixel. On a published page they wait
// behind a cookie notice and load only after "Yes"; the answer is remembered, and the
// privacy page's button asks again. On Connections, the owner pastes the two IDs.

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A site</title></head><body><main><h1>Fresh bread daily</h1>`
  + `<p><button type="button" id="presence-consent-change">Change your cookie choice</button></p></main>`
  + adTagsScript({ google: 'G-ABC123XYZ9', meta: '1234567890123456' }) + '</body></html>';

async function site(page: Page) {
  const loaded: string[] = [];
  await page.route('https://site.example/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
  await page.route(/googletagmanager\.com|connect\.facebook\.net/, (r) => { loaded.push(new URL(r.request().url()).hostname); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  return loaded;
}

test.describe('ad tags on a published page', () => {
  test('nothing loads until the visitor says yes; then both tags do, and the notice doesn’t ask again', async ({ page }) => {
    const loaded = await site(page);
    await page.goto('https://site.example/');
    const notice = page.getByRole('region', { name: 'Cookie choice' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('We use cookies from Google and Meta to see how our ads work.');
    await page.waitForTimeout(300);
    expect(loaded, 'nothing before an answer').toEqual([]);
    await notice.getByRole('button', { name: 'Yes, that’s fine' }).click();
    await expect(notice).toBeHidden();
    await expect.poll(() => loaded.slice().sort()).toEqual(['connect.facebook.net', 'www.googletagmanager.com']);
    await page.goto('https://site.example/about/');
    await expect(notice).toBeHidden();   // answered once, for every page
    await expect.poll(() => loaded.length).toBe(4);   // and the tags load on the next page too
  });

  test('no means nothing loads, on this page or the next; the privacy page’s button asks again', async ({ page }) => {
    const loaded = await site(page);
    await page.goto('https://site.example/');
    const notice = page.getByRole('region', { name: 'Cookie choice' });
    await notice.getByRole('button', { name: 'No, thanks' }).click();
    await expect(notice).toBeHidden();
    await page.goto('https://site.example/privacy/');
    await expect(notice).toBeHidden();
    await page.waitForTimeout(300);
    expect(loaded).toEqual([]);
    await page.getByRole('button', { name: 'Change your cookie choice' }).click();
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Yes, that’s fine' }).click();
    await expect.poll(() => loaded.length).toBe(2);
  });

  test('while it shows, the page gets room at the bottom so the notice covers nothing', async ({ page }) => {
    await site(page);
    await page.goto('https://site.example/');
    const notice = page.getByRole('region', { name: 'Cookie choice' });
    await expect(notice).toBeVisible();
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
    const h = await notice.evaluate((n) => (n as HTMLElement).offsetHeight);
    expect(pad).toBeGreaterThanOrEqual(h);
    await notice.getByRole('button', { name: 'No, thanks' }).click();
    expect(await page.evaluate(() => document.body.style.paddingBottom)).toBe('');
  });
});

test.describe('ad tags on Connections', () => {
  const SURFACE = { data: { edition: 'studio_os', note: '', groups: { Google: [{ key: 'google_analytics', label: 'Google Analytics', purpose: '', reads: [], approval: '', availability: 'Read-only', connection: { status: 'connected', health: 'ok', last_sync_at: null, connected_at: null, reason: '' }, data: null }] } } };

  test('the owner pastes the IDs and saves them as the site’s settings, and the page says the notice comes with them', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE, '/settings': { data: { google_tag_id: '', meta_pixel_id: '' } } } });
    const sent: any[] = [];
    await page.route('**/functions/v1/presence/settings', (r) => {
      if (r.request().method() !== 'PUT') return r.fallback();
      const b = r.request().postDataJSON(); sent.push(b);
      return r.fulfill({ json: { data: { google_tag_id: b.google_tag_id.toUpperCase(), meta_pixel_id: b.meta_pixel_id } } });
    });
    await page.goto('/connections.html');
    const card = page.locator('#adSec');
    await expect(card).toBeVisible();
    await expect(card).toContainText('the tags load only for people who say yes, and your privacy page says so');
    await expect(card.locator('#adSave')).toHaveAttribute('data-needs', 'configure');
    await card.getByLabel('Google tag ID').fill('g-abc123xyz9');
    await card.getByLabel('Meta Pixel ID').fill('1234567890123456');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ google_tag_id: 'g-abc123xyz9', meta_pixel_id: '1234567890123456' });
    await expect(card.getByLabel('Google tag ID')).toHaveValue('G-ABC123XYZ9');   // the server's own cleaned copy
  });

  test('an ID that doesn’t fit gets the server’s plain sentence', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE, '/settings': { data: { google_tag_id: '', meta_pixel_id: '' } } } });
    await page.route('**/functions/v1/presence/settings', (r) => r.request().method() !== 'PUT' ? r.fallback()
      : r.fulfill({ status: 422, json: { error: 'validation_failed', message: 'A Google tag ID looks like G-XXXXXXXXXX or AW-XXXXXXXXX.' } }));
    await page.goto('/connections.html');
    await page.locator('#adSec').getByLabel('Google tag ID').fill('UA-1234-5');
    await page.locator('#adSec').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'A Google tag ID looks like G-XXXXXXXXXX' })).toHaveCount(1);   // the shell's toast, or the page's own
  });
});
