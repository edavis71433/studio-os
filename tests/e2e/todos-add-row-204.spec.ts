import { test, expect, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';
import { pinClock } from './helpers/clock';

// Sales item 204, the parts PR 498 left: one add row on the To-dos page (the header's
// "+ Add a to-do" only jumped to it), which reads "friday" or "tomorrow" at the end of what's
// typed as the date, and a type-to-find box beside "Who it's for" that narrows the picker,
// still grouped under People, Customers and Open deals. The clock is pinned to Sunday Nov 22
// 2026, 10am in Los Angeles. Every name is made up.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const P1 = 'cccccccc-0000-4000-8000-000000000001', P2 = 'cccccccc-0000-4000-8000-000000000003', K1 = 'cccccccc-0000-4000-8000-000000000002';
const API = {
  '/portal/context': STUDIO_CTX,
  '/sales/tasks': { data: { items: [], done: [], now: 0 } },
  '/sales/contacts': { data: [{ id: P1, name: 'Jordan Lee', email: 'jordan@example.com' }, { id: P2, name: 'Ivy Chen', email: 'ivy@example.com' }] },
  '/studio/customers': { data: [{ client_id: K1, name: 'Harbor Yoga' }] },
  '/sales/deals': { data: [{ id: 'dddddddd-0000-4000-8000-000000000001', title: 'Maple & Rye Bakery', stage: 'proposal', converted_client_id: null }] },
};
type Sent = { method: string; path: string; body: unknown };

async function open(page: import('@playwright/test').Page, sent: Sent[]) {
  await installApp(page, { api: API as never });
  await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/tasks'), (route: Route) => {
    const r = route.request(); if (r.method() === 'GET') return route.fallback();
    sent.push({ method: r.method(), path: '/sales/tasks', body: r.postDataJSON?.() ?? null });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 't9' } }) });
  });
  await pinClock(page, '2026-11-22T18:00:00Z');   // Sunday, 10am in Los Angeles
  await page.goto('/todos.html');
}

test.describe('To-dos: one add row that reads a day, and a find box for who it is for (sales item 204)', () => {
  test('one place to add: the row, and the header has no second add button', async ({ page }) => {
    await open(page, []);
    await expect(page.locator('#addForm')).toBeVisible();
    await expect(page.locator('#addJump')).toHaveCount(0);
    await expect(page.locator('header.dds-ph').getByRole('button', { name: /add/i })).toHaveCount(0);
  });

  test('“Call Ivy friday” is “Call Ivy”, due this Friday; “tomorrow” is Monday; the date box shows it as you type', async ({ page }) => {
    const sent: Sent[] = [];
    await open(page, sent);
    await page.locator('#addTitle').fill('Call Ivy friday');
    await expect(page.locator('#addDue')).toHaveValue('2026-11-27');
    await page.locator('#addTitle').press('Enter');
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toEqual({ title: 'Call Ivy', due_date: '2026-11-27' });
    await page.locator('#addTitle').fill('Send the invoice by tomorrow');
    await expect(page.locator('#addDue')).toHaveValue('2026-11-23');
    await page.locator('#addTitle').fill('Send the invoice');   // the day word taken back off: the date it filled goes too
    await expect(page.locator('#addDue')).toHaveValue('');
  });

  test('a date picked by hand wins, and the words stay as typed', async ({ page }) => {
    const sent: Sent[] = [];
    await open(page, sent);
    await page.locator('#addDue').fill('2026-12-01');
    await page.locator('#addTitle').fill('Plan the Sat');
    await expect(page.locator('#addDue')).toHaveValue('2026-12-01');
    await page.locator('#addGo').click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toEqual({ title: 'Plan the Sat', due_date: '2026-12-01' });
  });

  test('type to find who it is for: the picker narrows, keeps its groups and picks the first match', async ({ page }) => {
    const sent: Sent[] = [];
    await open(page, sent);
    await page.locator('#addTitle').fill('Send the spring offer');
    await page.locator('#addFind').fill('har');
    await expect(page.locator('#addFor option')).toHaveText(['Harbor Yoga']);
    await expect(page.locator('#addFor optgroup')).toHaveAttribute('label', 'Customers');
    await expect(page.locator('#addFor')).toHaveValue('client:' + K1);
    await page.locator('#addFind').fill('zz');
    await expect(page.locator('#addFor option')).toHaveText(['No one by that name: for anyone']);
    await page.locator('#addFind').fill('ivy');
    await expect(page.locator('#addFor')).toHaveValue('contact:' + P2);
    await page.locator('#addFind').press('Enter');   // takes the pick, and moves on to it
    await expect(page.locator('#addFor')).toBeFocused();
    await page.locator('#addGo').click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toEqual({ title: 'Send the spring offer', contact_id: P2 });
  });
});
