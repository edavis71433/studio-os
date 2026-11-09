import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Bold redesign — the Inbox list (Nov 2026). Under the search, one segmented row:
// Needs reply · Enquiries · Support · All, each with its count. "Needs reply" is
// exactly what the line under them calls "waiting for a reply"; Enquiries counts
// the open ones (the queue's own default). They switch the view in place, and the
// title's menu still lists every view (Needs reply joins it).

const FEED = { data: {
  role: 'business_owner', moments: [], notices: [], last_published: null,
  pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
  client_messages: [
    { type: 'message', project: 'Site build', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', client_id: 'c-1', client: 'Juniper Floral Co.', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 2, thread_key: 'client:c-1', unread: true, href: '/projects.html' },
    { type: 'message', project: 'Booking page', project_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', client_id: 'c-2', client: 'Ortiz Photography', created_at: '2026-07-10T00:00:00Z', needs_reply: false, count: 1, thread_key: 'client:c-2', unread: false, href: '/projects.html' },
    { type: 'support', id: 's-1', subject: 'Logo tweak', status: 'open', project: '', client_id: 'c-1', client: 'Juniper Floral Co.', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
  ],
  enquiries: [
    { id: 'l-9', form_kind: 'quote', name: 'Priya Shah', email: 'priya@example.com', phone: '', message: 'Could you quote a small shop site?', status: 'new', created_at: '2026-07-13T00:00:00Z', thread_key: 'lead:l-9', unread: true },
  ],
} };
const API = {
  '/portal/feed': FEED,
  '/forms/inbox': { data: { submissions: [
    { id: 'l-9', form_kind: 'quote', name: 'Priya Shah', email: 'priya@example.com', phone: '', message: 'Could you quote a small shop site?', source_page: '/contact/', status: 'new', created_at: '2026-07-13T00:00:00Z' },
    { id: 'l-8', form_kind: 'contact', name: 'Dana Whitfield', email: 'dana@example.com', phone: '', message: 'Do you do logos?', source_page: '/', status: 'not_a_fit', created_at: '2026-07-01T00:00:00Z' },
  ], unread: 1 } },
  '/notifications': { data: [], unread_count: 0 },
};
const chips = (page: import('@playwright/test').Page) => page.locator('#vseg [data-vchip]');

test.describe('Inbox — the list’s chips (bold redesign)', () => {
  test('Needs reply · Enquiries · Support · All, with their counts; All to start', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await expect(page.getByRole('group', { name: 'Show' })).toBeVisible();
    await expect(chips(page)).toHaveText(['Needs reply 4', 'Enquiries 1', 'Support 1', 'All 5']);
    await expect(page.locator('#vseg [data-vchip="everything"]')).toHaveAttribute('aria-pressed', 'true');
    // "Needs reply" is the line's "waiting for a reply", to the number
    await expect(page.locator('#lmeta')).toContainText('4 waiting for a reply');
  });

  test('a chip switches the view in place: the list, the title and the pressed chip follow', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#vseg [data-vchip="needs"]').click();
    await expect(page.locator('#vseg [data-vchip="needs"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#vseg [data-vchip="needs"]')).toBeFocused();
    await expect(page.locator('#viewBtn')).toContainText('Needs reply');
    await expect(page.locator('#rows [role=option]')).toHaveCount(4);
    await expect(page.locator('#rows')).not.toContainText('Ortiz Photography');   // you replied — waiting on them, not on you
    await page.locator('#vseg [data-vchip="enquiries"]').click();
    await expect(page.locator('#viewBtn')).toContainText('Enquiries');
    await expect(page.locator('[data-ef="open"]')).toHaveAttribute('aria-pressed', 'true');   // the queue's own Open · New · All
    await expect(page.locator('#rows')).toContainText('Priya Shah');
    await page.locator('#vseg [data-vchip="support"]').click();
    await expect(page.locator('#viewBtn')).toContainText('Support & requests');
    await expect(page.locator('#rows [role=option]')).toHaveCount(1);
    await page.locator('#vseg [data-vchip="everything"]').click();
    await expect(page.locator('#rows')).toContainText('Ortiz Photography');
  });

  test('the title’s menu still lists every view, and Needs reply joins it', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#viewBtn').click();
    await expect(page.locator('#viewMenu [role=option]')).toHaveText([/Everything/, /Needs reply/, /Messages/, /Needs your OK/, /Enquiries/, /Website/, /Support & requests/]);
    await page.locator('#viewMenu [data-view="needs"]').click();
    await expect(page.locator('#vseg [data-vchip="needs"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the counts follow the client lens; the search narrows the list, not the counts', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await expect(chips(page)).toHaveText(['Needs reply 4', 'Enquiries 1', 'Support 1', 'All 5']);
    const lens = page.locator('#lfilters select').first();
    await expect(lens).toBeVisible();
    await lens.selectOption('c-1');
    await expect(chips(page)).toHaveText(['Needs reply 2', 'Enquiries 0', 'Support 1', 'All 2']);   // Juniper's message and support thread
    await lens.selectOption('');
    await page.locator('#q').fill('ortiz');
    await expect(page.locator('#rows [role=option]')).toHaveCount(1);
    await expect(chips(page)).toHaveText(['Needs reply 4', 'Enquiries 1', 'Support 1', 'All 5']);
  });

  test('#needs opens straight onto Needs reply', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html#needs');
    await expect(page.locator('#vseg [data-vchip="needs"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#rows [role=option]')).toHaveCount(4);
  });

  test('a phone: the row fits the width and nothing spills sideways', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await expect(chips(page)).toHaveCount(4);
    const [first, last, host] = await Promise.all([chips(page).first().boundingBox(), chips(page).last().boundingBox(), page.locator('#vseg').boundingBox()]);
    expect(Math.abs(first!.y - last!.y)).toBeLessThan(2);                 // one row
    expect(last!.x + last!.width).toBeLessThanOrEqual(host!.x + host!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('no serious/critical axe violations on the list with the chips', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await expect(chips(page)).toHaveCount(4);
    const r = await new AxeBuilder({ page }).include('.lpane').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});
