import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Prospects — the lead list (Semrush review, sales item 112, Nov 2026).
// Hermetic: the API is stubbed; every name is made up. The one promise this
// page makes everywhere — nothing is emailed from here — is asserted on the
// draft dialog and on the calls the page is allowed to make.

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';
const saved = (over: Record<string, unknown> = {}) => ({
  id: P1, business_name: 'Fresh Fades Barbershop', phone: '(818) 555-0102', website: null,
  address: '2 Main St, Burbank, CA 91501', industry: 'Barber shop', site_health: 'no_website',
  score: 95, status: 'New', search_query: 'barbers in Burbank', source: 'Google Maps',
  notes: null, deal_id: null, created_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z',
  health_word: 'No website', ...over,
});
const diner = () => saved({ id: P2, business_name: 'Old Diner', phone: null, website: 'https://old-diner.example',
  site_health: 'dated', score: 65, health_word: 'Dated site', industry: 'Diner' });

/** The page's API, method-aware; returns the calls it saw. */
async function withProspects(page: Page, state: { list: unknown[]; discover?: unknown }) {
  const calls: string[] = [];
  await page.route('**/functions/v1/presence/sales/prospects**', async (route) => {
    const m = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    calls.push(`${m} ${path}`);
    const ok = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/sales/prospects/discover') return ok(state.discover ?? { error: 'places_not_configured', message: 'Finding businesses isn’t switched on yet — the platform needs a Google Places key first.' });
    if (path === '/sales/prospects/export') return route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="prospects.csv"' }, body: 'Business,Phone\nFresh Fades Barbershop,(818) 555-0102\n' });
    if (path === '/sales/prospects' && m === 'GET') return ok({ data: state.list });
    if (path === '/sales/prospects' && m === 'POST') { return ok({ data: { saved: [saved()], skipped: 1 } }, 201); }
    if (/\/convert$/.test(path)) { (state.list[0] as Record<string, unknown>).deal_id = DEAL; (state.list[0] as Record<string, unknown>).status = 'In pipeline'; return ok({ data: { id: DEAL, title: 'Fresh Fades Barbershop', stage: 'lead' } }, 201); }
    if (/\/draft$/.test(path)) return ok({ data: { subject: 'A website for Fresh Fades Barbershop', body: 'Hi,\n\nI’m writing from Davis Digital Studio — I couldn’t find a website for Fresh Fades Barbershop.', sent: false, note: 'This is only a draft to copy — Studio OS doesn’t send it.' } });
    if (m === 'PATCH') return ok({ data: saved({ status: 'Contacted' }) });
    if (m === 'DELETE') { state.list.shift(); return ok({ data: { removed: true } }); }
    return ok({ data: {} });
  });
  return calls;
}

test.describe('Prospects — find, keep, pitch (item 112)', () => {
  test('search finds businesses, warmest first, and the ticked ones are saved', async ({ page }) => {
    await installApp(page);
    const calls = await withProspects(page, { list: [], discover: { data: { query: 'barbers in Burbank', found: 3, finds: [
      { business_name: 'Fresh Fades Barbershop', phone: '(818) 555-0102', website: null, address: '2 Main St, Burbank, CA 91501', industry: 'Barber shop', site_health: 'no_website', score: 95, health_word: 'No website', already_saved: false },
      { business_name: 'Old Diner', phone: null, website: 'https://old-diner.example', address: '1 Main St, Burbank, CA 91501', industry: 'Diner', site_health: 'dated', score: 65, health_word: 'Dated site', already_saved: false },
      { business_name: 'Kept Before Cafe', phone: null, website: null, address: null, industry: null, site_health: 'no_website', score: 95, health_word: 'No website', already_saved: true },
    ] } } });
    await page.goto('/prospects.html');
    await expect(page.getByRole('heading', { name: 'No prospects yet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
    await page.getByLabel('What kind of business').fill('barbers');
    await page.getByLabel('Where').fill('Burbank');
    await page.getByRole('button', { name: 'Find businesses' }).click();
    await expect(page.getByRole('heading', { name: 'What “barbers in Burbank” found' })).toBeVisible();
    await expect(page.locator('#findsCard .row').first()).toContainText('Fresh Fades Barbershop');
    await expect(page.locator('#findsCard .row').first()).toContainText('No website');
    await expect(page.locator('#findsCard .row').nth(2)).toContainText('Already on your list');
    await expect(page.locator('#findsCard .row').nth(2).locator('input[type=checkbox]')).toHaveCount(0);
    await page.getByLabel('Keep Fresh Fades Barbershop').check();
    await page.getByRole('button', { name: 'Save the ticked ones' }).click();
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Saved 1 · 1 already kept');
    expect(calls).toContain('POST /sales/prospects/discover');
    expect(calls).toContain('POST /sales/prospects');
  });

  test('without a Places key, the page says so and keeps working', async ({ page }) => {
    await installApp(page);
    await withProspects(page, { list: [saved()] });
    await page.goto('/prospects.html');
    await page.getByLabel('What kind of business').fill('plumbers');
    await page.getByLabel('Where').fill('Glendale');
    await page.getByRole('button', { name: 'Find businesses' }).click();
    await expect(page.locator('#findNote')).toContainText('needs a Google Places key');
    await expect(page.locator('.saved-row')).toContainText('Fresh Fades Barbershop');
  });

  test('“→ Deal” starts the deal once, then the row opens it', async ({ page }) => {
    await installApp(page);
    const state = { list: [saved(), diner()] };
    const calls = await withProspects(page, state);
    await page.goto('/prospects.html');
    const row = page.locator('.saved-row').first();
    await expect(row).toContainText('Fresh Fades Barbershop');
    await row.getByRole('button', { name: '→ Deal' }).click();
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Deal started.');
    await expect(row.getByRole('link', { name: 'Open the deal' })).toHaveAttribute('href', `/pipeline.html?deal=${DEAL}`);
    await expect(row.getByRole('button', { name: '→ Deal' })).toHaveCount(0);
    expect(calls.filter((c) => c.endsWith('/convert')).length).toBe(1);
  });

  test('the email draft is words to copy, and says nothing is sent', async ({ page }) => {
    await installApp(page);
    const calls = await withProspects(page, { list: [saved()] });
    await page.goto('/prospects.html');
    await page.getByRole('button', { name: 'Draft a first email' }).click();
    const dlg = page.locator('#draftDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Studio OS doesn’t send this');
    await expect(dlg.getByLabel('Subject')).toHaveValue('A website for Fresh Fades Barbershop');
    await expect(dlg.getByLabel('Email')).toHaveValue(/couldn’t find a website/);
    await dlg.getByRole('button', { name: 'Close' }).click();
    // the page never called anything that could send: only the draft read
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /sales/prospects/' + P1 + '/draft']);
  });

  test('Remove asks twice; a name with markup stays text', async ({ page }) => {
    await installApp(page);
    const sneaky = saved({ id: P2, business_name: '<img src=x onerror=alert(1)> Shop', health_word: 'No website' });
    const state = { list: [sneaky, saved()] };
    await withProspects(page, state);
    await page.goto('/prospects.html');
    await expect(page.locator('.saved-row').first()).toContainText('<img src=x onerror=alert(1)> Shop');
    const rm = page.locator('.saved-row').first().getByRole('button', { name: /Remove/ });
    await rm.click();
    await expect(rm).toContainText('sure?');
    await rm.click();
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Off the list.');
    await expect(page.locator('.saved-row')).toHaveCount(1);
  });
});
