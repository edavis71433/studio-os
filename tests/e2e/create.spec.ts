import { test, expect, Page } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, CLIENT_NAV, ALL_FEATURES } from './helpers/app';

// Bold redesign, part 1 — + Create from anywhere. One button (the sidebar's +
// Create on a computer, the big + in the phone bar) opens Log a call, New deal,
// Send an invoice, Send a proposal, Add a customer, Add a to-do and Send an
// update. The first four open in a drawer beside the page and post to the routes
// the record and Pipeline already use; you pick WHO inside the form. Only at
// studio level: never inside a client, never for a client.

const DAY = 86_400_000;
const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const DEALS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Juniper Floral Co. — new site', stage: 'qualified', expected_value_cents: 320000, contact_id: 'cccccccc-0000-4000-8000-000000000001', updated_at: new Date(Date.now() - DAY).toISOString() },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Harbor Dental — patient forms', stage: 'contract', expected_value_cents: 140000, contact_id: 'cccccccc-0000-4000-8000-000000000002', updated_at: new Date(Date.now() - 2 * DAY).toISOString() },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', title: 'Blue Finch Café — rebrand', stage: 'won', expected_value_cents: 120000, contact_id: null, updated_at: new Date(Date.now() - 9 * DAY).toISOString() },
];
const PEOPLE = [
  { id: 'cccccccc-0000-4000-8000-000000000001', name: 'Ivy Chen', email: 'ivy@juniper.example', company: 'Juniper Floral Co.' },
  { id: 'cccccccc-0000-4000-8000-000000000002', name: 'Marcus Bell', email: 'marcus@harbor.example', company: 'Harbor Dental' },
];
const API = { '/sales/deals': { data: DEALS }, '/sales/contacts': { data: PEOPLE } };
type Sent = { method: string; path: string; body: Record<string, unknown> | null };
// answer the writes the drawers make, and remember them
async function captureWrites(page: Page, answer: (path: string, body: Record<string, unknown>) => { status: number; body: unknown } | null = () => null): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route('**/functions/v1/presence/sales/**', (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postDataJSON() as Record<string, unknown> | null;
    sent.push({ method: req.method(), path, body });
    const a = answer(path, body || {});
    if (a) return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
    if (path === '/sales/deals') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'aaaaaaaa-0000-4000-8000-0000000000aa', ...(body || {}) } }) });
    if (/\/invoice$/.test(path)) return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'i-1' }, url: 'https://pay.example/i-1', emailed: true }) });
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
  });
  return sent;
}
const openCreate = async (page: Page, isPhone: boolean) => {
  await page.locator(isPhone ? '#dds-mbar-create' : '#dds-create').click();
  await expect(page.locator('.dds-cr-menu')).toBeVisible();
};

test.describe('+ Create from anywhere', () => {
  test('the menu lists the seven things, takes their letters, and Escape gives focus back', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name === 'mobile';
    await installApp(page, { api: API });
    await page.goto('/today.html');
    await openCreate(page, isPhone);
    const items = page.locator('.dds-cr-menu [data-cr]');
    await expect(items.locator('b')).toHaveText(['Log a call', 'New deal', 'Send an invoice', 'Send a proposal', 'Add a customer', 'Add a to-do', 'Send an update']);
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dds-cr-menu')).toBeHidden();
    await expect(page.locator(isPhone ? '#dds-mbar-create' : '#dds-create')).toBeFocused();
    if (!isPhone) {
      // the c key opens it from anywhere that isn't a text box; a letter picks
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('c');
      await expect(page.locator('.dds-cr-menu')).toBeVisible();
      await page.keyboard.press('t');
      await expect(page.getByRole('dialog', { name: 'Add a to-do' })).toBeVisible();
    }
  });

  test('never inside a client, never for a client', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await installApp(page, { api: { ...API, '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit'], landing: '/agency.html', attention_count: 0, nav: CLIENT_NAV, scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } } } } });
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#dds-shell .dds-brand')).toBeVisible();
    await expect(page.locator('#dds-create, #dds-mbar-create')).toHaveCount(0);
    await installApp(page, { api: { ...API, '/portal/context': { data: { site_role: 'client_reviewer', edition: 'presence', is_agency: false, is_client_portal: true, capabilities: [], landing: '/client.html', attention_count: 0, nav: STUDIO_LEVEL_NAV } } } });
    await page.goto('/client.html');
    await expect(page.locator('#dds-create, #dds-mbar-create')).toHaveCount(0);
  });

  test('Log a call: pick who, how it went, a note and a next step — one call, one to-do, no page change', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name === 'mobile';
    await installApp(page, { api: API });
    const sent = await captureWrites(page);
    await page.goto('/today.html');
    await openCreate(page, isPhone);
    await page.locator('.dds-cr-menu [data-cr="call"]').click();
    const box = page.getByRole('dialog', { name: 'Log a call' });
    await expect(box).toBeVisible();
    // no deal picked yet → it says so instead of posting
    await box.locator('.dds-cr-go').click();
    await expect(box.locator('.dds-cr-err')).toHaveText('Pick who you talked to.');
    // search by the PERSON on the deal, not just its title
    await box.getByRole('searchbox', { name: 'Search your deals and people' }).fill('Marcus');
    await box.locator('[data-deal]', { hasText: 'Harbor Dental' }).click();
    await expect(box.locator('.dds-cr-go')).toHaveText('Log call with Marcus');
    await box.getByRole('button', { name: 'Left a voicemail' }).click();
    await box.getByLabel('What did you say?').fill('About the forms');
    await box.getByLabel(/Next step/).fill('Call back about the forms');
    await box.getByRole('button', { name: 'Friday' }).click();
    await box.locator('.dds-cr-go').click();
    await expect(box).toBeHidden();
    await expect(page.locator('.dds-toast')).toContainText('Call logged on Harbor Dental — patient forms — to-do added for');
    const d = new Date(); d.setHours(12); const add = (5 - d.getDay() + 7) % 7; d.setDate(d.getDate() + (add || 7));
    expect(sent.map((x) => [x.path, x.body])).toEqual([
      ['/sales/deals/aaaaaaaa-0000-4000-8000-000000000002/activity', { kind: 'call', body: 'Left a voicemail — About the forms' }],
      ['/sales/deals/aaaaaaaa-0000-4000-8000-000000000002/tasks', { title: 'Call back about the forms', due_date: ymd(d) }],
    ]);
  });

  test('New deal: a name, a value and a stage in one save', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name === 'mobile';
    await installApp(page, { api: API });
    const sent = await captureWrites(page);
    await page.goto('/today.html');
    await openCreate(page, isPhone);
    await page.locator('.dds-cr-menu [data-cr="deal"]').click();
    const box = page.getByRole('dialog', { name: 'New deal' });
    await box.getByLabel('What’s the deal?').fill('Maple & Main — listings site');
    await box.getByLabel(/Value/).fill('2,400');
    await box.getByRole('button', { name: 'Qualified' }).click();
    await box.getByRole('searchbox', { name: 'Search your contacts' }).fill('Ivy');
    await box.locator('[data-person]', { hasText: 'Ivy Chen' }).click();
    await box.locator('.dds-cr-go').click();
    await expect(box).toBeHidden();
    await expect(page.locator('.dds-toast')).toContainText('Deal added: Maple & Main — listings site.');
    await expect(page.locator('.dds-toast .act')).toHaveText('Open');
    expect(sent).toEqual([{ method: 'POST', path: '/sales/deals', body: { title: 'Maple & Main — listings site', stage: 'qualified', expected_value_cents: 240000, contact_id: 'cccccccc-0000-4000-8000-000000000001' } }]);
  });

  test('Send an invoice: 50% of the deal in one tap, a due date, and a second invoice only when asked', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name === 'mobile';
    await installApp(page, { api: API });
    let first = true;
    const sent = await captureWrites(page, (path, body) => {
      if (/\/invoice$/.test(path) && first && !body.force) { first = false; return { status: 409, body: { error: 'amount_mismatch', message: 'There’s already an open invoice for $500.00 on this deal.' } }; }
      return null;
    });
    await page.goto('/today.html');
    await openCreate(page, isPhone);
    await page.locator('.dds-cr-menu [data-cr="invoice"]').click();
    const box = page.getByRole('dialog', { name: 'Send an invoice' });
    await box.locator('[data-deal]', { hasText: 'Juniper Floral' }).click();
    await expect(box.getByLabel('What for')).toHaveValue('Juniper Floral Co. — new site');
    await box.getByRole('button', { name: '50% of the deal · $1,600' }).click();
    await expect(box.getByLabel('Amount', { exact: true })).toHaveValue('1600.00');
    await box.getByRole('button', { name: '7 days' }).click();
    await expect(box.locator('.dds-cr-prev')).toContainText('What Ivy gets');
    await expect(box.locator('.dds-cr-go')).toHaveText('Send $1,600 invoice');
    await box.locator('.dds-cr-go').click();
    await expect(box.locator('.dds-cr-err')).toContainText('already an open invoice');
    await box.getByRole('button', { name: 'Send a second invoice' }).click();
    await expect(box).toBeHidden();
    await expect(page.locator('.dds-toast')).toContainText('Invoice sent — $1,600 to Juniper Floral Co. — new site.');
    const due = new Date(); due.setHours(12); due.setDate(due.getDate() + 7);
    const body = { amount_cents: 160000, purpose: 'service', due_date: ymd(due), title: 'Juniper Floral Co. — new site' };
    expect(sent.map((x) => x.body)).toEqual([body, { ...body, force: true }]);
    expect(sent[0].path).toBe('/sales/deals/aaaaaaaa-0000-4000-8000-000000000001/invoice');
  });

  test('Add a to-do: it hangs on a deal, with its date', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name === 'mobile';
    await installApp(page, { api: API });
    const sent = await captureWrites(page);
    await page.goto('/today.html');
    await openCreate(page, isPhone);
    await page.locator('.dds-cr-menu [data-cr="todo"]').click();
    const box = page.getByRole('dialog', { name: 'Add a to-do' });
    await box.getByLabel('What needs doing?').fill('Send the photos');
    await box.locator('.dds-cr-go').click();
    await expect(box.locator('.dds-cr-err')).toHaveText('Pick the deal it’s about.');
    await box.locator('[data-deal]', { hasText: 'Juniper' }).click();
    await box.locator('.dds-cr-go').click();
    await expect(box).toBeHidden();
    const t = new Date(); t.setHours(12); t.setDate(t.getDate() + 1);
    expect(sent).toEqual([{ method: 'POST', path: '/sales/deals/aaaaaaaa-0000-4000-8000-000000000001/tasks', body: { title: 'Send the photos', due_date: ymd(t) } }]);
  });

  test('Send a proposal opens the deal’s billing; Add a customer opens the page’s own dialog', async ({ page }, testInfo) => {
    const isPhone = testInfo.project.name === 'mobile';
    await installApp(page, { api: { ...API, '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } }, '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] } } });
    await page.goto('/agency.html');
    await openCreate(page, isPhone);
    await page.locator('.dds-cr-menu [data-cr="customer"]').click();
    await expect(page.getByRole('dialog', { name: 'Add a customer' })).toBeVisible();
    await page.keyboard.press('Escape');
    await openCreate(page, isPhone);
    await page.locator('.dds-cr-menu [data-cr="proposal"]').click();
    const box = page.getByRole('dialog', { name: 'Send a proposal' });
    await box.locator('[data-deal]', { hasText: 'Harbor Dental' }).click();
    await box.locator('.dds-cr-go').click();
    await page.waitForURL(/\/pipeline\.html\?deal=aaaaaaaa-0000-4000-8000-000000000002&dtab=billing/);
  });

  test('the drawer is a dialog: Escape and Cancel close it and give focus back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Cancel is the sheet’s swipe on a phone');
    await installApp(page, { api: API });
    await page.goto('/today.html');
    await openCreate(page, false);
    await page.locator('.dds-cr-menu [data-cr="deal"]').click();
    const box = page.getByRole('dialog', { name: 'New deal' });
    await expect(box).toHaveAttribute('aria-modal', 'true');
    await expect(box.getByLabel('What’s the deal?')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(page.locator('#dds-create')).toBeFocused();
    await page.locator('#dds-create').click();
    await page.locator('.dds-cr-menu [data-cr="deal"]').click();
    await page.getByRole('dialog', { name: 'New deal' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'New deal' })).toHaveCount(0);
  });
});
