import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Bold redesign — the one-screen proposal (Nov 2026). Your services sit over
// the lines as chips to tap (a second tap takes one off), and beside the
// editor is exactly what the client will see, redrawn as you type. The send
// button names who it's going to. Saving and sending are unchanged.

const DEAL = 'dddddddd-1111-4111-8111-dddddddddddd';
const DETAIL = { data: {
  deal: { id: DEAL, title: 'Blue Finch — site', stage: 'qualified', expected_value_cents: 0, contact_id: 'c1', converted_client_id: null, next_step: null, next_step_at: null, notes: '', retainer: null },
  contact: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
} };
const API = {
  [`/sales/deals/${DEAL}`]: DETAIL,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/services': { data: [{ id: 's1', name: 'Website build', price_cents: 320000 }, { id: 's2', name: 'Logo refresh', price_cents: 60000 }] },
  '/sales/templates': { data: [] },
  '/identity': { data: { business_name: 'Bright Studio' } },
};
const openEditor = async (page: Page) => {
  await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
  await page.locator('#addProp').click();
  await expect(page.locator('#propForm .pb-chips')).toBeVisible();
};

test.describe('The one-screen proposal (bold redesign)', () => {
  test('your services are chips: a tap adds the line, a second tap takes it off; the preview follows', async ({ page }) => {
    await installApp(page, { api: API });
    await openEditor(page);
    const chips = page.locator('#propForm [data-svc]');
    await expect(chips).toHaveText(['Website build · $3,200', 'Logo refresh · $600']);
    const pv = page.locator('#plPreview');
    await expect(pv).toContainText('Bright Studio');
    await expect(pv).toContainText('Proposal for Blue Finch');
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.nth(1)).toBeFocused();
    await expect(page.locator('#propForm .pl-label').last()).toHaveValue('Logo refresh');
    await expect(pv.locator('.pb-row').filter({ hasText: 'Logo refresh' })).toContainText('$600');
    await chips.nth(0).click();
    await expect(pv.locator('.pb-total')).toContainText('$3,800');   // the deal's own line (Blue Finch — site, $0) + both services
    await chips.nth(1).click();                                     // off again
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('#propForm .pl-label').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).not.toContain('Logo refresh');
    await expect(pv.locator('.pb-total')).toContainText('$3,200');
  });

  test('the send button names who it goes to; Save draft still saves the lines as they are', async ({ page }) => {
    await installApp(page, { api: API });
    let body: Record<string, unknown> | null = null;
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/proposals`, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      body = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'p-1' } }) });
    });
    await openEditor(page);
    await expect(page.locator('#plSaveSend')).toHaveText('Send to Jane →');
    await page.locator('#propForm [data-svc="0"]').click();
    await page.locator('#plSave').click();
    await expect.poll(() => body).not.toBeNull();
    const items = (body as unknown as { line_items: Array<{ label: string; unit_cents: number; qty: number }> }).line_items;
    expect(items.map((i) => i.label)).toContain('Website build');
    expect(items.find((i) => i.label === 'Website build')!.unit_cents).toBe(320000);
  });
});
