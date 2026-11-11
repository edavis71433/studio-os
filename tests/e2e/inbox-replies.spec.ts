import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Bug hunt C (Nov 10 2026), the Inbox.
// C2  a long website enquiry shows whole (the feed's 400-character copy no longer
//     replaces the queue's whole message), and says so when only the cut copy loaded
// C5  "✓ In pipeline — view deal" only with a deal to open; a customer made with no
//     deal says Customer and can still be made a deal
// C6  a dropped connection on Send gives the button back and says why
// C10 a reply that went takes the row out of Needs reply, and the counts drop, at once;
//     a support request the studio answered last is not "waiting for a reply"
// C12 Send reply and Reply & make it a deal grey together: one reply, one email
// C15 a list the server cut says so
// and: a saved-replies sheet whose read failed never saves its empty list over yours

const PID = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const LONG = 'We run a small bakery and need a new website with an order form. '.repeat(8) + 'Call me on 555 0100 before Friday.';
const feed = (over: Record<string, unknown> = {}) => ({ data: {
  role: 'business_owner', moments: [], notices: [], last_published: null,
  pending_approvals: [],
  client_messages: [
    { type: 'message', project: 'Site build', project_id: PID, client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 2, thread_key: 'client:c-1', unread: true, href: '/crm.html' },
    { type: 'support', id: 's-1', subject: 'Logo tweak', status: 'open', project: '', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
  ],
  enquiries: [
    { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: LONG.slice(0, 400), message_cut: true, status: 'new', created_at: '2026-07-13T00:00:00Z', thread_key: 'lead:l-9', unread: true },
  ],
  ...over,
} });
const queueRow = (over: Record<string, unknown> = {}) => ({ id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: LONG, source_page: '/contact/', status: 'new', created_at: '2026-07-13T00:00:00Z', ...over });
const API = (over: Record<string, unknown> = {}) => ({
  '/portal/feed': feed(),
  '/forms/inbox': { data: { submissions: [queueRow()], unread: 1 } },
  '/notifications': { data: [], unread_count: 0 },
  '/crm/activity': { data: { upcoming: [], items: [{ id: 'i1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'How is it going?', at: '2026-07-15T00:00:00Z', meta: null }], reply_to: `/projects/${PID}/messages`, reply_support_to: null } },
  '/support/s-1': { data: { request: { id: 's-1', subject: 'Logo tweak', status: 'open', body: 'Please tweak the logo', created_at: '2026-07-14T00:00:00Z' }, messages: [{ id: 'sm1', body: 'Can we make it bigger?', author_kind: 'client', created_at: '2026-07-14T01:00:00Z' }], is_studio_view: true } },
  ...over,
});
const rowOf = (page: Page, name: string) => page.locator('#rows [role=option]').filter({ hasText: name });
const chip = (page: Page, v: string) => page.locator(`#vseg [data-vchip="${v}"]`);
async function pick(page: Page, name: string, nth = 0) {
  await rowOf(page, name).nth(nth).click();
  await expect(page.locator('#rpane .pname')).toContainText(name);
  return page.locator('#rpane');
}
async function backToList(page: Page) { const b = page.locator('#paneBack'); if (await b.isVisible()) await b.click(); }
const toast = (page: Page, text: string) => page.locator('.dds-toast', { hasText: text });

test.describe('Inbox — a reply that went leaves Needs reply (bug hunt C10)', () => {
  test('a client message: the row leaves Needs reply, the counts drop, and it reads “You replied”', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/inbox.html#needs');
    await expect(chip(page, 'needs')).toHaveText('Needs reply 3');
    await expect(page.locator('#lmeta')).toContainText('3 waiting for a reply');
    const pane = await pick(page, 'Marlow’s Kitchen', 0);
    await pane.locator('#msgBody').fill('Going well — the draft is ready Friday.');
    await pane.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(toast(page, 'Sent.')).toBeVisible();
    await expect(pane.locator('.pname')).toContainText('Marlow’s Kitchen');   // the pane stays on it
    await backToList(page);
    await expect(chip(page, 'needs')).toHaveText('Needs reply 2');
    await expect(page.locator('#lmeta')).toContainText('2 waiting for a reply');
    await expect(rowOf(page, 'Sent you a message')).toHaveCount(0);
    await chip(page, 'everything').click();
    await expect(rowOf(page, 'You replied — waiting on them')).toHaveCount(1);
  });

  test('a support request: answered, it is still open but no longer waiting for a reply', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/inbox.html#support');
    const pane = await pick(page, 'Marlow’s Kitchen');
    await pane.locator('#supBody').fill('Done — the bigger logo is live.');
    await pane.locator('#supForm button[type=submit]').click();
    await expect(toast(page, 'Sent.')).toBeVisible();
    await backToList(page);
    await expect(rowOf(page, 'Logo tweak')).toHaveCount(1);   // still under Support: it's open
    await expect(chip(page, 'needs')).toHaveText('Needs reply 2');
    await chip(page, 'needs').click();
    await expect(rowOf(page, 'Logo tweak')).toHaveCount(0);
  });

  test('the feed says whose word was last: an answered request is not counted as waiting', async ({ page }) => {
    // the studio answered last and the thread has been read: open, but nobody is waiting
    const f = feed(); Object.assign(f.data.client_messages[1] as Record<string, unknown>, { needs_reply: false, unread: false });
    await installApp(page, { api: API({ '/portal/feed': f }) });
    await page.goto('/inbox.html');
    await expect(chip(page, 'needs')).toHaveText('Needs reply 2');
    await expect(chip(page, 'support')).toHaveText('Support 1');
  });

  test('an enquiry: the reply goes, the row leaves Needs reply, the pane shows what was sent', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/inbox.html#needs');
    const pane = await pick(page, 'Sam Rivera');
    await pane.locator('#leadBody').fill('Hi Sam, happy to help. What day suits you for a call?');
    await pane.locator('#leadSend').click();
    await expect(toast(page, 'Sent to sam@example.com')).toBeVisible();
    await expect(pane.locator('.lreply')).toContainText('What day suits you for a call?');
    await backToList(page);
    await expect(chip(page, 'needs')).toHaveText('Needs reply 2');
    await expect(rowOf(page, 'Sam Rivera')).toHaveCount(0);
  });
});

test.describe('Inbox — sending an enquiry reply (bug hunt C12, C6)', () => {
  test('both send buttons grey while one is sending, so one press is one email', async ({ page }) => {
    await installApp(page, { api: API() });
    let release!: () => void; const held = new Promise<void>((r) => { release = r; });
    let replies = 0;
    await page.route('**/functions/v1/presence/forms/inbox/l-9/reply', async (route) => { replies++; await held; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); });
    await page.goto('/inbox.html#enquiries');
    const pane = await pick(page, 'Sam Rivera');
    await pane.locator('#leadBody').fill('Hi Sam, a quote is on its way.');
    await pane.locator('#leadSend').click();
    await expect(pane.locator('#leadSend')).toBeDisabled();
    await expect(pane.locator('#leadSendDeal')).toBeDisabled();
    await pane.locator('#leadSendDeal').click({ force: true }).catch(() => { /* disabled: nothing to press */ });
    release();
    await expect(toast(page, 'Sent to sam@example.com')).toBeVisible();
    expect(replies).toBe(1);
  });

  test('a dropped connection says so and gives both buttons back', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.route('**/functions/v1/presence/forms/inbox/l-9/reply', (route) => route.abort('internetdisconnected'));
    await page.goto('/inbox.html#enquiries');
    const pane = await pick(page, 'Sam Rivera');
    await pane.locator('#leadBody').fill('Hi Sam, a quote is on its way.');
    await pane.locator('#leadSend').click();
    await expect(toast(page, 'check your connection')).toBeVisible();
    await expect(pane.locator('#leadSend')).toBeEnabled();
    await expect(pane.locator('#leadSend')).toHaveText('Send reply');
    await expect(pane.locator('#leadSendDeal')).toBeEnabled();
    await expect(pane.locator('#leadBody')).toHaveValue('Hi Sam, a quote is on its way.');   // nothing typed is lost
  });

  test('a dropped connection on a client message gives Send back', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.route(`**/functions/v1/presence/projects/${PID}/messages`, (route) => route.abort('internetdisconnected'));
    await page.goto('/inbox.html');
    const pane = await pick(page, 'Marlow’s Kitchen', 0);
    await pane.locator('#msgBody').fill('Going well.');
    await pane.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(toast(page, 'check your connection')).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  });
});

test.describe('Inbox — a long enquiry shows whole (bug hunt C2)', () => {
  test('the whole message, with the phone number at the end', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/inbox.html');
    const pane = await pick(page, 'Sam Rivera');
    await expect(pane.locator('.card .body').first()).toContainText('Call me on 555 0100 before Friday.');
    await expect(pane).not.toContainText('This is the start of a longer message');
  });

  test('when only the cut copy loaded, it says there is more', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.route('**/functions/v1/presence/forms/inbox', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await page.goto('/inbox.html');
    const pane = await pick(page, 'Sam Rivera');
    await expect(pane.locator('.card .body').first()).toContainText('…');
    await expect(pane).toContainText('This is the start of a longer message. Refresh to see all of it.');
  });
});

test.describe('Inbox — where an enquiry went (bug hunt C5)', () => {
  test('converted with no deal to open (its deal was deleted): no dead link, and it can be made a deal again', async ({ page }) => {
    // (a converted enquiry is no longer new, so the feed has no row for it)
    await installApp(page, { api: API({ '/portal/feed': feed({ enquiries: [] }), '/forms/inbox': { data: { submissions: [queueRow({ status: 'converted', converted: true, deal_id: null })], unread: 0 } } }) });
    await page.goto('/inbox.html#enquiries');
    await page.locator('[data-ef="all"]').click();
    await expect(rowOf(page, 'Sam Rivera')).toContainText('Read');
    const pane = await pick(page, 'Sam Rivera');
    await expect(pane.getByRole('link', { name: '✓ In pipeline — view deal' })).toHaveCount(0);
    await expect(pane.getByRole('button', { name: '+ Make it a deal' })).toBeVisible();
  });

  test('made a customer with no deal: it says Customer, and Make it a deal is still there', async ({ page }) => {
    await installApp(page, { api: API({ '/portal/feed': feed({ enquiries: [] }), '/forms/inbox': { data: { submissions: [queueRow({ status: 'converted', converted: false, customer: true, deal_id: null })], unread: 0 } } }) });
    await page.goto('/inbox.html#enquiries');
    await page.locator('[data-ef="all"]').click();
    await expect(rowOf(page, 'Sam Rivera')).toContainText('Customer');
    const pane = await pick(page, 'Sam Rivera');
    await expect(pane.locator('.stchip')).toHaveText('Customer');
    await expect(pane.getByRole('link', { name: '✓ In pipeline — view deal' })).toHaveCount(0);
    await expect(pane.getByRole('button', { name: '+ Make it a deal' })).toBeVisible();
    for (const name of ['Make customer', 'Not a fit']) await expect(pane.getByRole('button', { name })).toHaveCount(0);
    await expect(pane.locator('#leadSpam')).toHaveCount(0);
  });
});

test.describe('Inbox — a list the server cut says so (bug hunt C15)', () => {
  test('the Enquiries view and the conversations', async ({ page }) => {
    await installApp(page, { api: API({
      '/forms/inbox': { data: { submissions: [queueRow()], unread: 1, more: true } },
      '/portal/feed': feed({ client_messages_more: true }),
    }) });
    await page.goto('/inbox.html');
    await expect(page.locator('#lmeta')).toContainText('Showing your newest 2 conversations only');
    await chip(page, 'enquiries').click();
    await expect(page.locator('#lmeta')).toContainText('Showing your newest 1 only');
  });

  test('nothing cut, nothing said', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/inbox.html');
    await expect(page.locator('#lmeta')).toContainText('waiting for a reply');
    await expect(page.locator('#lmeta')).not.toContainText('Showing your newest');
  });
});

test.describe('Inbox — saved replies that couldn’t load', () => {
  test('the sheet says so and Save stays off, so an empty list never replaces yours', async ({ page }) => {
    let puts = 0;
    await installApp(page, { api: API() });
    await page.route('**/functions/v1/presence/service/saved-replies', (route) => {
      if (route.request().method() === 'PUT') { puts++; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }); }
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/inbox.html');
    await page.locator('#ovfBtn').click();
    await page.locator('#ovfSaved').click();
    await expect(page.locator('#sheet-list')).toContainText('Your saved replies couldn’t load just now. Nothing here can be saved until it loads.');
    await expect(page.locator('#sheet-save')).toBeDisabled();
    await expect(page.locator('#sheet-add')).toBeHidden();
    expect(puts).toBe(0);
  });
});
