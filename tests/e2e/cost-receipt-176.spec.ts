import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';
import { pinClock } from './helpers/clock';

// Sales item 176, the part left out of PR 485: "Add a cost" on the record keeps a receipt.
// The receipt is a file in the studio's own Files: one picked from there, or a photo or PDF
// uploaded now through the door Files uses (POST /media/upload-url, then the file itself).
// The cost is saved with receipt_media_id, and the list links the receipt in Files.
// Every name below is made up.

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const PHOTO = '11111111-aaaa-4aaa-8aaa-111111111111';
const PDF = '22222222-bbbb-4bbb-8bbb-222222222222';
const NEW = '33333333-cccc-4ccc-8ccc-333333333333';
const UPLOAD = 'https://uploads.example.test/put/receipt';

const API = (sent: Array<Record<string, unknown>>) => ({
  '/crm/record': { data: {
    identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
    header: { name: 'Juniper Floral Co.', person: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'customer' }, highlights: {},
    sections: { overview: true, messages: true, deal: true, delivery: false, details: true }, default_tab: 'deal', canonical: { key: 'client', value: CLIENT },
  } },
  [`/sales/deals/${DEAL}`]: { data: {
    deal: { id: DEAL, title: 'Website refresh', stage: 'proposal', expected_value_cents: 500000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null },
    contact: { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example' },
    proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null, retainer_paid: { cents: 0, count: 0, last_at: null },
  } },
  [`GET /sales/deals/${DEAL}/costs`]: () => ({ data: { items: sent.length ? [{ id: 'k1', label: 'Domain renewal', amount_cents: 1800, spent_on: '2026-11-20', bill: true, invoice_id: null, note: '', receipt_media_id: sent[sent.length - 1].receipt_media_id ?? null }] : [], unbilled_cents: sent.length ? 1800 : 0 } }),   // read after each save: the list shows what was saved
  [`POST /sales/deals/${DEAL}/costs`]: (body: Record<string, unknown>) => { sent.push(body); return { data: { id: 'k1' } }; },
  '/crm/activity': { data: { items: [], upcoming: [], reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  [`/sales/contacts/${CID}`]: { data: { contact: { id: CID, name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '' }, custom_fields: [], deals: [] } },
  '/assets': { data: { assets: [
    { id: PHOTO, kind: 'image', name: 'Namecheap receipt', thumb: null, asset_status: 'active' },
    { id: PDF, kind: 'document', mime: 'application/pdf', name: 'Plugin invoice', thumb: null, asset_status: 'active' },
    { id: 'old', kind: 'image', name: 'An old banner', thumb: null, asset_status: 'archived' },
  ] } },
  'POST /media/upload-url': (body: Record<string, unknown>) => { sent.push({ upload: body }); return { data: { upload_url: UPLOAD, media_id: NEW } }; },
  [`PATCH /assets/${NEW}`]: (body: Record<string, unknown>) => { sent.push({ named: body }); return { data: { ok: true } }; },
});

async function openCost(page: import('@playwright/test').Page, sent: Array<Record<string, unknown>>) {
  await installApp(page, { api: API(sent) as never });
  // the record's one-time notes hint sits at the bottom of the screen, where Save can be: seen already
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'crm-notes': 1 })); } catch { /* storage may be denied */ } });
  await page.route(UPLOAD, (r) => r.fulfill({ status: 200, body: '' }));
  await pinClock(page);   // the costs hold dates
  await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
  await page.locator('#sendMore').click();
  await page.locator('#sendMoreMenu [data-bform="cost"]').click();
  await page.locator('#co-label').fill('Domain renewal');
  await page.locator('#co-amt').fill('18');
}

test.describe('Add a cost keeps a receipt (sales item 176)', () => {
  test('pick one from Files: live photos and PDFs only; it is saved with the cost and linked in the list', async ({ page }) => {
    const sent: Array<Record<string, unknown>> = [];
    await openCost(page, sent);
    await expect(page.locator('#co-rc-name')).toHaveText('Receipt (optional): none yet.');
    await page.getByRole('button', { name: 'Pick from Files' }).click();
    const dlg = page.getByRole('dialog', { name: 'Pick the receipt' });
    await expect(dlg.getByRole('button')).toHaveText(['Namecheap receipt', 'Plugin invoice', 'Cancel']);   // the archived banner isn't offered
    await dlg.getByRole('button', { name: 'Plugin invoice' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('#co-rc-name')).toHaveText('Receipt: Plugin invoice');
    await expect(page.getByRole('button', { name: 'Remove the receipt' })).toBeVisible();
    await page.getByRole('button', { name: 'Save the cost' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ label: 'Domain renewal', amount_cents: 1800, receipt_media_id: PDF });
    await expect(page.locator('#costsCard').getByRole('link', { name: 'Receipt' })).toHaveAttribute('href', `/files.html?focus=${PDF}`);
  });

  test('upload one: it goes to Files through the upload door, named for the cost, and is saved with it', async ({ page }) => {
    const sent: Array<Record<string, unknown>> = [];
    await openCost(page, sent);
    await page.locator('#co-rc-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
    await expect(page.locator('#co-rc-name')).toHaveText('Receipt: Receipt: Domain renewal');
    expect(sent[0]).toMatchObject({ upload: { mime: 'image/png', bytes: 8, alt_text: 'Receipt: Domain renewal' } });
    expect(sent[1]).toMatchObject({ named: { name: 'Receipt: Domain renewal' } });
    await page.getByRole('button', { name: 'Save the cost' }).click();
    await expect.poll(() => sent.length).toBe(3);
    expect(sent[2]).toMatchObject({ label: 'Domain renewal', receipt_media_id: NEW });
  });

  test('no receipt is fine, and Remove takes a picked one back off', async ({ page }) => {
    const sent: Array<Record<string, unknown>> = [];
    await openCost(page, sent);
    await page.getByRole('button', { name: 'Pick from Files' }).click();
    await page.getByRole('dialog', { name: 'Pick the receipt' }).getByRole('button', { name: 'Namecheap receipt' }).click();
    await page.getByRole('button', { name: 'Remove the receipt' }).click();
    await expect(page.locator('#co-rc-name')).toHaveText('Receipt (optional): none yet.');
    await expect(page.getByRole('button', { name: 'Pick from Files' })).toBeFocused();
    await page.getByRole('button', { name: 'Save the cost' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect('receipt_media_id' in sent[0]).toBe(false);
  });
});
