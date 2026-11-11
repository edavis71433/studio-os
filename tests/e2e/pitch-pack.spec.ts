import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Pitch packs (Semrush review, sales item 113): building one from a Prospects
// row, and the public pitch.html the prospect is sent. Hermetic; names made up.

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const saved = (over: Record<string, unknown> = {}) => ({
  id: P1, business_name: 'Old Diner', phone: '(818) 555-0101', website: 'https://old-diner.example',
  address: '2 Main St, Burbank, CA 91501', industry: 'Diner', site_health: 'dated', score: 65,
  status: 'New', search_query: 'diners in Burbank', source: 'Google Maps', notes: null, deal_id: null,
  created_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z', health_word: 'Dated site',
  pack_status: null, pack_url: null, ...over,
});

const PACK = {
  business_name: 'Old Diner', town: 'Burbank', industry: 'Diner',
  you: { name: 'Old Diner', domain: 'old-diner.example', summary: { overall: 41, label: 'Needs work', top_issues: ['No phone number above the fold', 'Images slow the first view', 'Missing page titles'] } },
  rivals: [
    { name: 'Shiny Dental', domain: 'shiny-dental.example', summary: { overall: 82, label: 'Strong', top_issues: [] } },
    { name: 'Brand New Bakery', domain: 'bakery.example', summary: { overall: 74, label: 'Strong', top_issues: [] } },
  ],
  rivals_note: null,
  ai: { summary: null, why: 'ai_unavailable', note: 'The AI check isn’t switched on for this platform.' },
  built_at: '2026-11-10T19:00:00Z',
  brand: { name: 'Davis Digital Studio', logo_url: null, accent: '#5b3fa0' },
  report_base: 'https://tools.example',
};

test.describe('Pitch pack — build and share (item 113)', () => {
  test('a pack builds piece by piece and hands back its link', async ({ page }) => {
    await installApp(page);
    let builds = 0;
    await page.route('**/functions/v1/presence/sales/prospects**', async (route) => {
      const m = route.request().method();
      const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
      const ok = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (/\/pack$/.test(path) && m === 'POST') {
        builds++;
        return ok({ data: { state: builds >= 3 ? 'ready' : 'building', done: Math.min(builds, 4), total: 4, share_url: builds >= 3 ? `/pitch.html?t=${TOKEN}` : null, business_name: 'Old Diner' } });
      }
      if (path === '/sales/prospects' && m === 'GET') return ok({ data: [saved(builds >= 3 ? { pack_status: 'ready', pack_url: `/pitch.html?t=${TOKEN}` } : {})] });
      return ok({ data: {} });
    });
    await page.goto('/prospects.html');
    const row = page.locator('.saved-row').first();
    await row.getByRole('button', { name: 'Pitch pack' }).click();
    const dlg = page.locator('#packDlg');
    await expect(dlg).toContainText('one link you can send them');
    await dlg.getByRole('button', { name: 'Build it' }).click();
    await expect(dlg).toContainText('The link below is public but unguessable');
    await expect(dlg.getByRole('link', { name: 'Open the pack' })).toHaveAttribute('href', `/pitch.html?t=${TOKEN}`);
    expect(builds).toBe(3);
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(row.getByRole('link', { name: 'Open pack' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Pitch pack' })).toHaveCount(0);
  });

  test('a half-built pack offers to carry on', async ({ page }) => {
    await installApp(page, { api: { '/sales/prospects': { data: [saved({ pack_status: 'building' })] } } });
    await page.goto('/prospects.html');
    await page.locator('.saved-row').first().getByRole('button', { name: 'Finish the pack' }).click();
    await expect(page.locator('#packDlg').getByRole('button', { name: 'Carry on building' })).toBeVisible();
  });

  test('the public pitch page shows the comparison, the fixes and the AI note', async ({ page }) => {
    await page.route(`**/functions/v1/presence/sales/pack/${TOKEN}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: PACK }) }));
    await page.goto(`/pitch.html?t=${TOKEN}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('How Old Diner’s web presence compares in Burbank');
    await expect(page.locator('.col.you')).toContainText('This is you');
    await expect(page.locator('.col.you .score')).toHaveText('41');
    await expect(page.locator('.col').nth(1)).toContainText('Shiny Dental');
    await expect(page.locator('.col').nth(1)).toContainText('82');
    await expect(page.locator('.col').nth(2)).toContainText('74');
    await expect(page.getByRole('heading', { name: 'What we’d fix first on your site' })).toBeVisible();
    await expect(page.locator('ul.iss li')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'When people ask AI for a recommendation' })).toBeVisible();
    await expect(page.locator('body')).toContainText('isn’t switched on');
    await expect(page.locator('.foot')).toContainText('Prepared by Davis Digital Studio');
    await expect(page.getByRole('button', { name: 'Print / save as PDF' })).toBeVisible();
  });

  test('a dead or rebuilt link says so kindly', async ({ page }) => {
    await page.route('**/functions/v1/presence/sales/pack/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/pitch.html?t=deadbeefdeadbeefdeadbeefdeadbeef');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('This link isn’t live');
  });

  test('a prospect name with markup stays text on the public page', async ({ page }) => {
    const sneaky = { ...PACK, business_name: '<img src=x onerror=alert(1)> Diner', you: { ...PACK.you, name: '<img src=x>' } };
    await page.route(`**/functions/v1/presence/sales/pack/${TOKEN}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: sneaky }) }));
    await page.goto(`/pitch.html?t=${TOKEN}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('<img src=x onerror=alert(1)> Diner');
  });
});
