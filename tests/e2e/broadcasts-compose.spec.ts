import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Bold redesign — Send an update (Nov 2026). Who gets it, your message and what
// they see sit side by side: the lists as cards (chips on a phone), the message
// with its fill-in chips, and a live picture of the email as you type. The send
// button says how many it goes to. Nothing goes out from here: Send and Schedule
// both open Preview & send, with the exact branded email, where the real press is.

const D_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SEGS = { data: { segments: [
  { key: 'customers', label: 'Your customers', description: 'Everyone you’ve worked with.', count: 5 },
  { key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 1 },
  { key: 'enquiries', label: 'Website enquiries', description: 'Everyone who has messaged you through your website.', count: null },
] } };
const LIST = { data: { broadcasts: [
  { id: 'cccccccc-3333-4333-8333-cccccccccccc', subject: 'Holiday hours', audience: 'customers', status: 'sent', scheduled_at: null, sent_at: new Date(Date.now() - 14 * 86400000).toISOString(), recipient_count: 5, sent_count: 5, skipped_count: 0, failed_count: 0, created_at: '2026-10-20T10:00:00Z' },
] } };
const DETAIL = { data: {
  broadcast: { id: D_ID, subject: 'Spring', body: 'Hi', audience: 'customers', status: 'draft', scheduled_at: null },
  audience_label: 'Your customers', recipient_count: 5, suppressed_count: 0,
  preview_subject: 'Spring', preview_html: '<html><body><p>Hi there</p></body></html>',
} };
const API = { '/broadcasts/segments': SEGS, '/broadcasts': LIST, ['/broadcasts/' + D_ID]: DETAIL, '/identity': { data: { business_name: 'Brightline Studio' } } };
// the bare /broadcasts path answers the list on GET and makes the draft on POST
const draftOnPost = (page: import('@playwright/test').Page) => page.route((u) => /\/presence\/broadcasts$/.test(u.pathname), (route) =>
  route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: D_ID, subject: 'Spring', body: 'Hi', audience: 'customers' } }) })
    : route.fallback());

test.describe('Send an update — who, what, and what they see (bold redesign)', () => {
  test('what they see follows the typing: the fill-ins as the server fills them, the formatting as the email shows it', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    const pv = page.locator('#livePv');
    await expect(pv).toContainText('Your message shows here as you write it.');
    await expect(pv).toContainText('Brightline Studio');
    await page.locator('#subj').fill('News from {{business_name}}');
    await page.locator('#bodytx').fill('Hi {{first_name}}, we have **free** photos.\n\n- One\n- Two\n\nSee [our site](https://example.com).');
    await expect(pv.locator('.mail-subj')).toHaveText('News from Brightline Studio');
    await expect(pv.locator('.mail-body p').first()).toHaveText('Hi there, we have free photos.');
    await expect(pv.locator('.mail-body b')).toHaveText('free');
    await expect(pv.locator('.mail-body li')).toHaveText(['One', 'Two']);
    await expect(pv.locator('.mail-body u')).toHaveText('our site');
    await expect(pv).toContainText('Unsubscribe');
    // typed markup is text, never code
    await page.locator('#bodytx').fill('<img src=x onerror=alert(1)>');
    await expect(pv.locator('.mail-body img')).toHaveCount(0);
    await expect(pv.locator('.mail-body')).toContainText('<img src=x onerror=alert(1)>');
  });

  test('the send button says how many it goes to, and follows the list picked', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    await expect(page.locator('#sendUpdate')).toHaveText('Send to 1 person');   // All contacts is picked to start, as it always was
    await page.locator('[data-seg="customers"]').click();
    await expect(page.locator('#sendUpdate')).toHaveText('Send to 5 people');
    await page.locator('[data-seg="enquiries"]').click();
    await expect(page.locator('#sendUpdate')).toHaveText('Send update');   // a list that couldn't be counted never claims a number
    // the last update sent sits under the lists
    await expect(page.locator('.lastup')).toContainText('Last update: “Holiday hours” · sent to 5 · 2 weeks ago');
  });

  test('Schedule opens Preview & send on its schedule side; nothing is sent', async ({ page }) => {
    await installApp(page, { api: API });
    await draftOnPost(page);
    const sends: string[] = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/send$/.test(new URL(r.url()).pathname)) sends.push(r.url()); });
    await page.goto('/broadcasts.html');
    await page.locator('#subj').fill('Spring');
    await page.locator('#bodytx').fill('Hi');
    await page.locator('#schedule').click();
    await expect(page.locator('#stage')).toContainText('Preview & send');
    await expect(page.locator('[name=whenmode][value=later]')).toBeChecked();
    await expect(page.locator('#when')).toBeVisible();
    await expect(page.locator('#when')).toBeFocused();
    await expect(page.locator('#send')).toHaveText('Schedule');
    expect(sends).toHaveLength(0);
  });

  test('a phone: the lists are chips, and the send button stays in reach above the bar', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    await expect(page.locator('[data-seg="customers"] .d')).toBeHidden();
    const [a, b] = await Promise.all([page.locator('[data-seg="customers"]').boundingBox(), page.locator('[data-seg="contacts"]').boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);   // side by side, a row of chips
    await page.locator('#bodytx').click();
    const btn = page.locator('#sendUpdate');
    await expect(btn).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('no serious/critical axe violations on the composer', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    await page.locator('#subj').fill('Spring');
    const r = await new AxeBuilder({ page }).include('#main').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});
