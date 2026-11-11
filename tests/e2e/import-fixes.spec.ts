import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// List item 97 (Nov 10 bug hunt, B2 · B5 · B6 and two small ones): the CSV importers.
// Contacts, Customers and Pipeline share one importer now (shell.js importPanel —
// Contacts had its own copy with every bug twice).
//   B2  a Google or Outlook file: the label/type columns beside each value are never
//       read, and the first column with a value wins (the last one used to, even empty)
//   B5  past 500 rows the panel says how many were left out, before and after
//   B6  Close (Stop, while it runs) stops the run; Import CSV again can't start a second
//   B21 a quote inside a cell ("6" sub") no longer swallows the rows after it, and a
//       "Last activity" column is not a surname
// Every name and address below is made up.

const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });
const csvFile = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const openContactsImport = async (page: Page) => {
  await page.goto('/contacts.html');
  await page.locator('#importCsv').click();
  await expect(page.locator('#csvZone input[type=file]')).toBeVisible();
};
// POST /sales/contacts → a new contact each time (deduped:false). With a gate, every answer waits
// until the gate opens, so a run can be caught mid-way however fast or slow the machine is.
const contactPosts = async (page: Page, gate?: Promise<void>) => {
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/functions/v1/presence/sales/contacts', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    sent.push(route.request().postDataJSON());
    if (gate) await gate;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-' + sent.length } }) });
  });
  return sent;
};

test.describe('item 97 — Google and Outlook files map the right columns (B2)', () => {
  test('Contacts: a Google Contacts export keeps its emails, phones, names and business', async ({ page }) => {
    await installApp(page, { api: { '/sales/contacts': { data: [] } } });
    const sent = await contactPosts(page);
    await openContactsImport(page);
    // the headings a Google Contacts export writes: a label column beside every value, the
    // phonetic names (empty), the organization's title after its name, a second e-mail
    const google = 'First Name,Middle Name,Last Name,Phonetic First Name,Phonetic Last Name,Labels,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Label,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Organization Name,Organization Title\n'
      + 'Ana,,Ruiz,,,* myContacts,* Home,ana@harbor.example,Work,,Mobile,555 0100,Harbor Lane Bakery,Owner\n'
      + 'Bo,,Lee,,,* myContacts,,,Work,bo@northside.example,Home,555 0200,,\n';
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('contacts.csv', google));
    // item 86: Contacts matches the columns first; the guesses are what this test pins
    await expect(page.locator('#csvZone .dds-csvmap select[data-col="7"]')).toHaveValue('email');      // E-mail 1 - Value
    await expect(page.locator('#csvZone .dds-csvmap select[data-col="6"]')).toHaveValue('');           // E-mail 1 - Label: not brought in
    await expect(page.locator('#csvZone .dds-csvmap select[data-col="13"]')).toHaveValue('job_title'); // Organization Title
    await page.locator('#csvZone').getByRole('button', { name: 'Import 2' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent).toContainEqual({ name: 'Ana Ruiz', email: 'ana@harbor.example', phone: '555 0100', company: 'Harbor Lane Bakery', job_title: 'Owner' });   // "* myContacts" is Google's label, not a tag
    expect(sent).toContainEqual({ name: 'Bo Lee', email: 'bo@northside.example', phone: '555 0200' });   // his only e-mail is the second one
    await expect(toastWith(page, '2 added.')).toBeVisible();
  });

  test('Customers: an Outlook export — the business is its Company, never its street; the e-mail is the address, not its type', async ({ page }) => {
    const sent: Array<Record<string, unknown>> = [];
    await installApp(page, { api: { '/studio/customers': { data: [] } } });
    await page.route('**/functions/v1/presence/sales/customers', (route) => { sent.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { mode: 'connect', pending: true } }) }); });
    await page.goto('/customers.html');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    const outlook = 'First Name,Last Name,Company,Business Street,Business City,Business Phone,E-mail Address,E-mail Type,E-mail Display Name,E-mail 2 Address\n'
      + 'Ana,Ruiz,Harbor Lane Bakery,1 Pier Rd,Seaside,555 0100,ana@harbor.example,SMTP,Ana Ruiz (ana@harbor.example),\n'
      + 'Cy,Moss,,9 Elm St,Hillview,555 0300,,SMTP,,cy@moss.example\n';
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('outlook.csv', outlook));
    await expect(page.locator('#csvZone')).toContainText('2 customers found');
    await page.locator('#csvZone').getByRole('button', { name: 'Import 2' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent).toContainEqual({ mode: 'connect', email: 'ana@harbor.example', name: 'Ana Ruiz', business_name: 'Harbor Lane Bakery' });
    expect(sent).toContainEqual({ mode: 'connect', email: 'cy@moss.example', name: 'Cy Moss', business_name: '' });   // no Company: blank, not "9 Elm St"
  });

  test('Deals: a "Last activity date" column is not glued onto the contact’s name (B21)', async ({ page }) => {
    const contacts: unknown[] = [], deals: unknown[] = [];
    await installApp(page, { api: { '/sales/deals': { data: [] }, '/sales/summary': { data: { total: 0 } } } });
    await page.route('**/functions/v1/presence/sales/contacts', (route) => { if (route.request().method() !== 'POST') return route.fallback(); contacts.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-' + contacts.length } }) }); });
    await page.route('**/functions/v1/presence/sales/deals', (route) => { if (route.request().method() !== 'POST') return route.fallback(); deals.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: '{"data":{}}' }); });
    await page.goto('/pipeline.html');
    if (await page.locator('#moreBtn').isVisible()) { await page.locator('#moreBtn').click(); await page.getByRole('menuitem', { name: 'Import CSV' }).click(); }
    else await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('deals.csv', 'Deal,First Name,Last Name,Last activity date,Account Name,Account Owner\nMenu redesign,Ana,Ruiz,2026-11-01,Harbor Lane Bakery,Sam\n'));
    await expect(page.locator('#csvZone')).toContainText('1 deal found');
    await page.locator('#csvZone').getByRole('button', { name: 'Import 1' }).click();
    await expect.poll(() => deals.length).toBe(1);
    expect(contacts).toEqual([{ name: 'Ana Ruiz', company: 'Harbor Lane Bakery' }]);
  });
});

test.describe('item 97 — past 500 rows it says so (B5)', () => {
  test('503 contacts: the preview and the summary both name the 3 left out', async ({ page }) => {
    test.setTimeout(90_000);
    await installApp(page, { api: { '/sales/contacts': { data: [] } } });
    const sent = await contactPosts(page);
    await openContactsImport(page);
    const rows = Array.from({ length: 503 }, (_, i) => `Person ${i + 1},p${i + 1}@example.com`).join('\n');
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('big.csv', 'Name,Email\n' + rows + '\n'));
    await expect(page.locator('#csvZone')).toContainText('503 in the file. This brings in the first 500 now; run it again for the other 3.');   // item 86: said on the matching step
    await page.locator('#csvZone').getByRole('button', { name: 'Import 500' }).click();
    await expect(toastWith(page, '500 added. 3 more in the file weren’t imported — put them in a second file.')).toBeVisible({ timeout: 60_000 });
    expect(sent.length).toBe(500);
    expect(sent.map((s) => s.email)).not.toContain('p501@example.com');
  });
});

test.describe('item 97 — Close stops a running import (B6)', () => {
  test('Stop mid-run: the rows after it never go in, and the summary says how far it got', async ({ page }) => {
    await installApp(page, { api: { '/sales/contacts': { data: [] } } });
    let open!: () => void;
    const sent = await contactPosts(page, new Promise<void>((r) => { open = r; }));   // the first five wait for us
    await openContactsImport(page);
    const rows = Array.from({ length: 40 }, (_, i) => `Person ${i + 1},`).join('\n');   // names only: these can't be matched, so a second run would double them
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('people.csv', 'Name,Email\n' + rows + '\n'));
    await page.locator('#csvZone').getByRole('button', { name: 'Import 40' }).click();
    await expect.poll(() => sent.length).toBe(5);                                                // five at a time, all five on their way
    await expect(page.locator('#csvZone input[type=file]')).toBeDisabled();                     // no second file under a running one
    await page.locator('#importCsv').click();                                                    // Import CSV again: the running panel stays
    await expect(page.locator('#csvZone .dds-csvgo')).toBeDisabled();
    await page.locator('#csvZone').getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('#csvZone input[type=file]')).toHaveCount(0);
    await expect(page.locator('#importCsv')).toBeFocused();
    open();                                                                                      // the five on their way land
    await expect(toastWith(page, 'Stopped after 5 of 40 — 5 added.')).toBeVisible();
    await page.waitForTimeout(600);                                                              // a running import would have sent its next five by now
    expect(sent.length).toBe(5);
  });
});

test.describe('the shared CSV reader (B21)', () => {
  test('a quote inside a cell is an inch mark — the rows after it stay rows', async ({ page }) => {
    await installApp(page);
    await page.goto('/pipeline.html');
    const rows = await page.evaluate(() => (window as unknown as { ddsListKit: { parseCsv: (t: string) => string[][] } }).ddsListKit.parseCsv('Name,Note\nAna,"6"" sub, extra cheese"\nBo,6" sub\nCy,ok\n'));
    expect(rows).toEqual([['Name', 'Note'], ['Ana', '6" sub, extra cheese'], ['Bo', '6" sub'], ['Cy', 'ok']]);
  });
});
