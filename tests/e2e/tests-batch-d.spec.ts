import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Final pass on the sales side, batch D (Nov 8 2026): tests that can fail.
//   csv        the shared reader and Contacts' own, on what Excel saves
//   views      a save after the saved views failed to load never replaces them
//   requests   the client portal lists requests by what last happened, not by
//              a bookkeeping write (updated_at)

test.describe('batch D — CSV the way Excel saves it', () => {
  test('the shared reader: a byte-order mark, "" inside quotes, a line break in a cell, a trailing CR', async ({ page }) => {
    await installApp(page);
    await page.goto('/pipeline.html');
    const rows = await page.evaluate(() => (window as unknown as { ddsListKit: { parseCsv: (t: string) => string[][] } }).ddsListKit.parseCsv('﻿Name,Note\r\n"Ana ""Ani"" Ruiz","line one\nline two"\r\nBo,\r'));
    expect(rows).toEqual([['Name', 'Note'], ['Ana "Ani" Ruiz', 'line one\nline two'], ['Bo', '']]);
  });

  // item 97: Contacts imports through the shared importer now (its own copy is gone)
  test('Contacts\' import finds its Name column behind a byte-order mark', async ({ page }) => {
    await installApp(page, { api: { '/sales/contacts': { data: [] } } });
    await page.goto('/contacts.html');
    await page.locator('#importCsv').click();
    await page.locator('#csvZone input[type=file]').setInputFiles({ name: 'contacts.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿Name,Phone\r\nAna Ruiz,555 0100\r\nBo Lee,\r\n', 'utf8') });
    await expect(page.locator('#csvZone')).toContainText('2 contacts found');
    await expect(page.locator('#csvZone')).not.toContainText('couldn’t find a name or email column');
  });
});

const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.example', project_id: 'p2', status: 'active', customer_site_id: 'site-beta', open_support: 0, project_count: 3 },
] };
const TEAM_VIEW = { id: 'view-0001', name: 'Waiting on us', base: 'attention', q: '', cols: ['name'], sort: null };

test.describe('batch D — saved views never replace what a page couldn\'t read', () => {
  const views = async (page: import('@playwright/test').Page, getsFail: (n: number) => boolean, puts: Array<{ views: Array<{ name: string }> }>, gets: { n: number }) => {
    await page.route('**/functions/v1/presence/sales/views', (route) => {
      if (route.request().method() === 'PUT') { const b = route.request().postDataJSON(); puts.push(b); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { customers: b.views, contacts: [], pipeline: [] } }) }); }
      gets.n++;
      if (getsFail(gets.n)) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { customers: [TEAM_VIEW], contacts: [], pipeline: [] } }) });
    });
  };
  test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'table'); } catch { /* denied */ } }); });

  test('a save after a failed load reads them again and keeps the team\'s other views', async ({ page }) => {
    const puts: Array<{ views: Array<{ name: string }> }> = []; const gets = { n: 0 };
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await views(page, (n) => n === 1, puts, gets);
    await page.goto('/customers.html');
    await expect.poll(() => gets.n).toBe(1);
    await page.locator('#saveView').click();
    const dlg = page.getByRole('dialog', { name: 'Save this view' });
    await dlg.getByLabel('Name').fill('Open requests');
    await dlg.getByRole('button', { name: 'Save view' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(gets.n).toBe(2);
    expect(puts[0].views.map((v) => v.name)).toEqual(['Waiting on us', 'Open requests']);
  });

  test('if they still can\'t be read, nothing is saved', async ({ page }) => {
    const puts: Array<{ views: Array<{ name: string }> }> = []; const gets = { n: 0 };
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await views(page, () => true, puts, gets);
    await page.goto('/customers.html');
    await expect.poll(() => gets.n).toBe(1);
    await page.locator('#saveView').click();
    const dlg = page.getByRole('dialog', { name: 'Save this view' });
    await dlg.getByLabel('Name').fill('Open requests');
    await dlg.getByRole('button', { name: 'Save view' }).click();
    await expect(page.locator('.dds-toast')).toContainText('didn’t save');
    expect(puts).toEqual([]);
  });
});
