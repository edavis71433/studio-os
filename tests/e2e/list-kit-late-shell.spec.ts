import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';
import { holdShell } from './helpers/late-shell';

// shell.js loads with defer, so a page's own script can draw and wire its list before the
// shared list tools (window.ddsListKit) exist. Columns on Customers and Contacts was wired only
// if they already did, so a draw that beat shell.js left it dead with no error (seen once in this
// suite under load; a slow phone could hit it too). The filter chips on Contacts and Pipeline
// stayed away for the visit, and an edit to a contact opened before the tools came saved it with
// no tags at all. Each test holds shell.js back until the page has drawn, then lets it through.
// WebKit paints nothing while a deferred script is on its way (it still runs the page's script),
// so a press made before shell.js lands is sent from script; the ones after it are real taps.
// Every name is made up.

const kitThere = (page: Page) => page.evaluate(() => typeof (window as unknown as { ddsListKit?: unknown }).ddsListKit === 'object');
// the page's own script must not throw while it waits (a press with no tools yet does nothing)
const errorsOn = (page: Page) => { const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message)); return errs; };
const pin = (page: Page, key: string) => page.addInitScript((k) => { try { localStorage.setItem(k, 'table'); } catch { /* denied */ } }, key);
const NO_VIEWS = { data: { customers: [], contacts: [], pipeline: [] } };   // a saved view would draw the page again and hide the bug

const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.example', project_id: 'p2', status: 'active', customer_site_id: 'site-beta', open_support: 0, project_count: 3 },
] };
const PEOPLE = [
  { id: 'ct-1', name: 'Marcus Bell', email: 'marcus@harbordental.example', phone: '(555) 010-4410', phone2: '', company: 'Harbor Dental', job_title: 'Office manager', tags: ['dental', 'referral'], updated_at: '2026-11-01T00:00:00Z' },
  { id: 'ct-2', name: 'Maya Ruiz', email: 'maya@bluefinch.example', phone: '', phone2: '', company: 'Blue Finch Café', job_title: 'Owner', tags: [], updated_at: '2026-10-28T00:00:00Z' },
];
// the contact list (each read kept), one contact's detail, and the edits sent
async function contactsRoute(page: Page) {
  const reads: URL[] = [], patches: Record<string, unknown>[] = [];
  await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?.*)?$/, (route) => {
    reads.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: PEOPLE, total: PEOPLE.length, limit: 100, offset: 0 }) });
  });
  await page.route(/\/functions\/v1\/presence\/sales\/contacts\/ct-[0-9]+$/, (route) => {
    const r = route.request();
    if (r.method() === 'PATCH') { patches.push(r.postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); }
    const c = PEOPLE.find((x) => r.url().endsWith(x.id))!;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { contact: { ...c, address: {}, found_via: '', custom: {} }, deals: [], timeline: [], custom_fields: [] } }) });
  });
  return { reads, patches };
}

test.describe('the list tools work when shell.js lands after the page has drawn', () => {
  test('Customers: Columns opens its menu', async ({ page }) => {
    const errs = errorsOn(page);
    await pin(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': CUSTOMERS, '/sales/views': NO_VIEWS } });
    const letGo = await holdShell(page);
    await page.goto('/customers.html', { waitUntil: 'commit' });   // the page's load waits on shell.js
    await expect(page.locator('tbody tr')).toHaveCount(2);
    expect(await kitThere(page)).toBe(false);   // drawn and wired, and the tools aren't here yet
    await page.locator('#colsBtn').dispatchEvent('click');   // too soon: nothing happens, and nothing breaks
    await expect(page.getByRole('group', { name: 'Columns to show' })).toHaveCount(0);
    letGo();
    await expect.poll(() => kitThere(page)).toBe(true);
    await page.locator('#colsBtn').click();
    const menu = page.getByRole('group', { name: 'Columns to show' });
    await expect(menu).toBeVisible();
    await expect(page.locator('#colsBtn')).toHaveAttribute('aria-expanded', 'true');
    await menu.getByLabel('Email').uncheck();
    await expect(page.locator('thead')).not.toContainText('Email');
    expect(errs).toEqual([]);
  });

  test('Contacts: Columns opens its menu', async ({ page }) => {
    const errs = errorsOn(page);
    await pin(page, 'dds-display:contacts');
    await installApp(page, { api: { '/sales/views': NO_VIEWS } });
    await contactsRoute(page);
    const letGo = await holdShell(page);
    await page.goto('/contacts.html', { waitUntil: 'commit' });
    await expect(page.locator('tbody tr')).toHaveCount(2);
    expect(await kitThere(page)).toBe(false);
    await page.locator('#colsBtn').dispatchEvent('click');
    await expect(page.getByRole('group', { name: 'Columns to show' })).toHaveCount(0);
    letGo();
    await expect.poll(() => kitThere(page)).toBe(true);
    await page.locator('#colsBtn').click();
    const menu = page.getByRole('group', { name: 'Columns to show' });
    await expect(menu).toBeVisible();
    await menu.getByLabel('Email').uncheck();
    await expect(page.locator('thead')).not.toContainText('Email');
    expect(errs).toEqual([]);
  });

  test('Contacts: the filter chips come, and a chip asks the server', async ({ page }) => {
    const errs = errorsOn(page);
    await pin(page, 'dds-display:contacts');
    await installApp(page, { api: { '/sales/views': NO_VIEWS } });
    const seen = await contactsRoute(page);
    const letGo = await holdShell(page);
    await page.goto('/contacts.html', { waitUntil: 'commit' });
    await expect(page.locator('tbody tr')).toHaveCount(2);
    expect(await kitThere(page)).toBe(false);
    await expect(page.locator('#fchips')).toBeHidden();   // no tools, no chips yet
    letGo();
    const chips = page.locator('#fchips');
    await chips.getByRole('button', { name: 'No deal yet' }).click();
    await expect.poll(() => seen.reads[seen.reads.length - 1].searchParams.get('nodeal')).toBe('1');
    await expect(chips.getByRole('button', { name: 'No deal yet' })).toHaveAttribute('aria-pressed', 'true');
    expect(errs).toEqual([]);
  });

  test('Contacts: an edit saved before the tools come keeps the person’s tags; after, the form has its tag box', async ({ page }) => {
    const errs = errorsOn(page);
    await installApp(page, { api: { '/sales/views': NO_VIEWS } });
    const seen = await contactsRoute(page);
    const letGo = await holdShell(page);
    await page.goto('/contacts.html', { waitUntil: 'commit' });
    const dlg = page.locator('#editDlg');
    await page.locator('[data-edit="ct-1"]').first().dispatchEvent('click');
    await expect(dlg.locator('#e-title')).toHaveValue('Office manager');
    expect(await kitThere(page)).toBe(false);
    await expect(dlg.locator('.dds-tags')).toHaveCount(0);   // the tag box is one of the tools
    await expect(dlg.locator('#e-name')).toBeFocused();   // the form has opened: it puts the cursor in Name 20 ms after it fills in, and typing elsewhere before that went into Name
    await dlg.locator('#e-phone2').fill('(555) 010-9999');
    await dlg.locator('#e-save').dispatchEvent('click');
    await expect.poll(() => seen.patches.length).toBe(1);
    expect(seen.patches[0]).toMatchObject({ phone2: '(555) 010-9999', job_title: 'Office manager' });
    expect(seen.patches[0]).not.toHaveProperty('tags');   // left as they are: it used to send an empty list, which wiped them
    letGo();
    await expect.poll(() => kitThere(page)).toBe(true);
    await expect(dlg).toBeHidden();
    await page.locator('[data-edit="ct-1"]').first().click();
    await expect(dlg.locator('.dds-tags .chip')).toHaveCount(2);
    await dlg.locator('#e-save').click();
    await expect.poll(() => seen.patches.length).toBe(2);
    expect(seen.patches[1]).toMatchObject({ tags: ['dental', 'referral'] });
    expect(errs).toEqual([]);
  });

  test('Pipeline: the filter chips come, and a chip narrows the table', async ({ page }) => {
    const errs = errorsOn(page);
    const day = 86_400_000, ago = (d: number) => new Date(Date.now() - d * day).toISOString();
    const deal = (n: number, title: string, owes: number) => ({ id: `dddddddd-0000-4000-8000-00000000000${n}`, title, stage: 'lead', source: 'manual', expected_value_cents: 100000, expected_close: null, contact_id: null, converted_client_id: null, found_via: '', owes_cents: owes, last_contacted_at: ago(5), created_at: ago(60), updated_at: ago(n) });
    await pin(page, 'dds-display:pipeline');
    await installApp(page, { api: {
      '/sales/deals': { data: [deal(1, 'Harbor Dental site', 0), deal(2, 'Juniper Floral shop', 250000), deal(3, 'Blue Finch orders', 0)] },
      '/sales/contacts': { data: [] },
      '/sales/summary': { data: { total: 3, open: { count: 3, value_cents: 300000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0 } } },
      '/sales/receivables': { data: { items: [], total_cents: 0 } },
      '/settings': { data: { stage_stale_days: {} } },
      '/sales/views': NO_VIEWS,
    } });
    const letGo = await holdShell(page);
    await page.goto('/pipeline.html', { waitUntil: 'commit' });
    await expect(page.locator('#table tbody tr')).toHaveCount(3);
    expect(await kitThere(page)).toBe(false);
    await expect(page.locator('#fchips')).toBeHidden();
    letGo();
    const chips = page.locator('#fchips');
    await chips.getByRole('button', { name: /Owes you money\s*1/ }).click();
    await expect(page.locator('#table tbody tr')).toHaveCount(1);
    await expect(page.locator('#table tbody tr')).toContainText('Juniper Floral shop');
    expect(errs).toEqual([]);
  });
});
