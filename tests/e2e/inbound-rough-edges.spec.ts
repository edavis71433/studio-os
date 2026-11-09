import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Item 71 (Nov 2026): what a studio sees when a client answers by email. The
// emailed reply shows its words, and the quoted earlier email folds behind
// "Show earlier email". A contact (no customer, no portal) is named, and the
// composer tells the truth about how the reply reaches them. Hermetic; every
// name and address is made up.

const QUOTED_REQUEST = 'Sounds good, Tuesday works.\n\nOn Sun, Nov 8, 2026 at 3:17 PM Studio <hello@example.com>\nwrote:\n\n> Hi Jordan,\n>\n> Your proposal is ready to review.\n>\n';
const NESTED_REPLY = 'One more thing: can we add a gallery?\n\nOn Sun, Nov 8, 2026 at 4:13 PM Jordan Ellis <jordan@example.com> wrote:\n\n> Sounds good, Tuesday works.\n>\n> On Sun, Nov 8, 2026 at 3:17 PM Studio <hello@example.com>\n> wrote:\n>\n>> Hi Jordan,\n>>\n';
const INLINE_ANSWERS = 'Answers below.\n\nOn Sun, Nov 8, 2026 at 5:00 PM Studio <hello@example.com> wrote:\n> Which day works?\nTuesday.\n> Which colour?\nBlue.\n';

const feed = (rows: unknown[]) => ({ data: {
  role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null,
  client_messages: rows, enquiries: [],
} });
const contactRow = { type: 'support', id: 's-9', subject: 'Re: Your proposal', status: 'open', project: '', client_id: '', client: 'Jordan Ellis', created_at: '2026-11-08T23:00:00Z', thread_key: 'support:s-9', unread: true, href: '/projects.html?support=s-9' };
const customerRow = { type: 'support', id: 's-10', subject: 'Logo tweak', status: 'open', project: '', client_id: 'c-1', client: 'Larkspur Studio', created_at: '2026-11-07T23:00:00Z', thread_key: 'support:s-10', unread: true, href: '/projects.html?support=s-10' };

const API = {
  '/portal/feed': feed([contactRow, customerRow]),
  '/notifications': { data: [], unread_count: 0 },
  '/forms/inbox': { data: { submissions: [], unread: 0 } },
  '/support/s-9': { data: {
    request: { id: 's-9', subject: 'Re: Your proposal', status: 'open', body: QUOTED_REQUEST, created_at: '2026-11-08T23:00:00Z' },
    messages: [
      { id: 'm1', body: NESTED_REPLY, author_kind: 'client', created_at: '2026-11-08T23:30:00Z' },
      { id: 'm2', body: INLINE_ANSWERS, author_kind: 'client', created_at: '2026-11-08T23:40:00Z' },
    ],
    is_studio_view: true,
  } },
  '/support/s-10': { data: {
    request: { id: 's-10', subject: 'Logo tweak', status: 'open', body: 'Please make the logo bigger.', created_at: '2026-11-07T23:00:00Z' },
    messages: [], is_studio_view: true,
  } },
};

test.describe('Emailed replies in the Inbox (item 71)', () => {
  test('a contact is named, and the quoted earlier email folds behind "Show earlier email"', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    const row = page.locator('#rows [role=option]').filter({ hasText: 'Re: Your proposal' });
    await expect(row).toContainText('Jordan Ellis');
    await row.click();
    const pane = page.locator('#rpane');
    // the request: their words show, the quote is folded (present, not visible)
    await expect(pane.locator('.card .body')).toContainText('Sounds good, Tuesday works.');
    const folds = pane.locator('details.dds-quoted');
    await expect(folds).toHaveCount(2);   // the request and the nested reply; the inline answers are NOT folded
    await expect(pane.getByText('Your proposal is ready to review.', { exact: false })).toBeHidden();
    await expect(folds.first().locator('summary')).toHaveText('Show earlier email');
    // opening the fold shows the earlier email exactly as it came
    await folds.first().locator('summary').click();
    await expect(folds.first().locator('.dds-quoted-body')).toBeVisible();
    await expect(folds.first().locator('.dds-quoted-body')).toContainText('> Your proposal is ready to review.');
    // the nested reply: its own words show, the whole older thread folds as one
    const bubbles = pane.locator('.bub');
    await expect(bubbles.nth(0)).toContainText('One more thing: can we add a gallery?');
    await expect(bubbles.nth(0).locator('details.dds-quoted')).toHaveCount(1);
    // answers written INSIDE the quote stay whole: nothing folded, every answer visible
    await expect(bubbles.nth(1).locator('details.dds-quoted')).toHaveCount(0);
    await expect(bubbles.nth(1)).toContainText('Tuesday.');
    await expect(bubbles.nth(1)).toContainText('Blue.');
    // a contact has no portal: the composer says the reply goes by email and can be answered there
    await expect(page.locator('#pcomposer')).toContainText('Jordan Ellis gets your reply by email and can answer it there');
  });

  test('a customer with a portal still reads "sees it in their portal"; a plain body is untouched', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Logo tweak' }).click();
    const pane = page.locator('#rpane');
    await expect(pane.locator('.card .body')).toHaveText('Please make the logo bigger.');
    await expect(pane.locator('details.dds-quoted')).toHaveCount(0);
    await expect(page.locator('#pcomposer')).toContainText('Larkspur Studio gets an email and sees it in their portal');
  });
});
