import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Sales item 87 (Nov 2026 review): ready-made recipes on Settings → Automations, the
// enquiry auto-reply in the owner's own words, two follow-ups to a quiet enquiry, a
// second overdue-invoice reminder and the week-before-it-runs-out note. The Inbox shows
// the follow-ups an enquiry got and can stop them. Fake data only.
const IDENTITY = { data: { site_id: 's1', business_name: 'Brightline Studio', email: 'hello@example.com', phone: '', service_area: '', updated_at: '2026-10-01T00:00:00Z' } };
const BASE = { industry_key: 'generic', auto_ack_enquiries: false, invoice_reminders: false, invoice_remind_after_days: 2, deal_nudges: false, deal_nudge_days: 3, review_requests: false, review_request_after_days: 3 };
const API = (settings: Record<string, unknown> = BASE) => ({ '/identity': IDENTITY, '/settings': { data: settings } });
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Corner Café' },
} };

/** record every PUT /settings and answer it the way the route does: the whole row, patched */
async function puts(page: Page, base: Record<string, unknown>) {
  const out: Array<Record<string, unknown>> = [];
  const row = { ...base };
  await page.route('**/functions/v1/presence/settings*', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    out.push(body); Object.assign(row, body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...row } }) });
  });
  return out;
}

test.describe('Automations — ready-made recipes (sales item 87)', () => {
  test('a recipe turns its rows on in one save, then says On and goes to its row', async ({ page }) => {
    await installApp(page, { api: API() });
    const sent = await puts(page, BASE);
    await page.goto('/settings.html#automations');
    const card = page.locator('#recipes [data-recipe="inv"]');
    await expect(card).toContainText('Two reminders a week apart for an overdue invoice');
    await card.getByRole('button', { name: 'Turn on' }).click();
    await expect.poll(() => sent).toEqual([{ invoice_reminders: true, invoice_overdue_repeat: true }]);
    await expect(card.locator('.ron')).toHaveText('On');
    await expect(page.locator('#sw-inv')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#sw-inv2')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#sw-inv')).toBeFocused();
    // Change it goes back to the row; the row's own switch turns one part off
    await card.getByRole('button', { name: 'Change it' }).click();
    await page.locator('#sw-inv2').click();
    await expect.poll(() => sent.at(-1)).toEqual({ invoice_overdue_repeat: false });
    await expect(card.getByRole('button', { name: 'Turn on' })).toBeVisible();   // half on is not the recipe
  });

  test('the follow-ups: switch, days kept two apart, and the words saved when the box is left', async ({ page }) => {
    await installApp(page, { api: API() });
    const sent = await puts(page, BASE);
    await page.goto('/settings.html#automations');
    await expect(page.locator('#n-fu1')).toHaveValue('3');
    await expect(page.locator('#n-fu2')).toHaveValue('7');
    await expect(page.locator('#w-fu1')).toHaveAttribute('placeholder', /^Just checking in on your message\./);
    await page.locator('#sw-fu').click();
    await expect.poll(() => sent.at(-1)).toEqual({ enquiry_followups: true });
    await page.locator('#n-fu1').fill('5');
    await page.locator('#n-fu2').fill('6');
    await page.locator('#n-fu2').press('Tab');
    await expect(page.locator('#n-fu2')).toHaveValue('7');
    await expect.poll(() => sent.at(-1)).toEqual({ enquiry_followup_1_days: 5, enquiry_followup_2_days: 7 });
    await page.locator('#w-fu1').fill('Hi again! Still keen to help with your event.');
    await page.locator('#w-fu1').press('Tab');
    await expect.poll(() => sent.at(-1)).toEqual({ enquiry_followup_1_message: 'Hi again! Still keen to help with your event.' });
    await expect(page.locator('#recipes [data-recipe="fu"] .ron')).toHaveText('On');
  });

  test('the auto-reply in your own words: the preview follows as you type, and it saves', async ({ page }) => {
    await installApp(page, { api: API({ ...BASE, auto_ack_enquiries: true }) });
    const sent = await puts(page, { ...BASE, auto_ack_enquiries: true });
    await page.goto('/settings.html#automations');
    await expect(page.locator('#say-ack')).toHaveText('Thanks for getting in touch — we’ve got your message and will reply within one business day.');
    await page.locator('#w-ack').fill('We read every message ourselves and answer within a day.');
    await expect(page.locator('#say-ack')).toHaveText('We read every message ourselves and answer within a day.');
    await page.locator('#w-ack').press('Tab');
    await expect.poll(() => sent.at(-1)).toEqual({ auto_ack_message: 'We read every message ourselves and answer within a day.' });
    await expect(page.locator('#recipes [data-recipe="ack"] .ron')).toHaveText('On');
  });

  test('saved words and switches paint back; the week-before note says what it sends', async ({ page }) => {
    const saved = { ...BASE, enquiry_followups: true, enquiry_followup_1_days: 2, enquiry_followup_2_days: 9, enquiry_followup_2_message: 'Last one from us!', quote_expiry_reminders: true };
    await installApp(page, { api: API(saved) });
    await page.goto('/settings.html#automations');
    await expect(page.locator('#sw-fu')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#sw-exp')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#n-fu1')).toHaveValue('2');
    await expect(page.locator('#n-fu2')).toHaveValue('9');
    await expect(page.locator('#w-fu2')).toHaveValue('Last one from us!');
    await expect(page.locator('#say-exp')).toContainText('is good until December 11, a week from now.');
    await expect(page.locator('#recipes [data-on="1"]')).toHaveCount(2);
  });

  test('inside a client: their website’s auto-reply and follow-ups, saved to their settings', async ({ page }) => {
    await installApp(page, { api: { ...API(), '/portal/context': SCOPED_CTX } });
    const sent = await puts(page, BASE);
    await page.goto('/settings.html?client=' + CLIENT);
    await page.locator('[data-card="replies"]').click();
    await expect(page.locator('#autoHint')).toContainText('What Corner Café’s website sends when someone writes in.');
    await expect(page.locator('#recipes [data-recipe]')).toHaveCount(2);
    await page.locator('#recipes [data-recipe="fu"]').getByRole('button', { name: 'Turn on' }).click();
    await expect.poll(() => sent).toEqual([{ enquiry_followups: true }]);
    await expect(page.locator('#sw-inv')).toBeHidden();
  });
});

// ── the Inbox: what an enquiry got, and Stop follow-ups ──
const queueRow = (over: Record<string, unknown> = {}) => ({ id: 'l-7', form_kind: 'contact', name: 'Sam Lee', email: 'sam@example.com', phone: '', message: 'Do you cater for forty people?', source_page: '/contact/', status: 'read', created_at: new Date(Date.now() - 4 * 86400000).toISOString(), ...over });
const INBOX_API = (row = queueRow()) => ({
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], last_published: null, pending_approvals: [], client_messages: [], enquiries: [] } },
  '/forms/inbox': { data: { submissions: [row], unread: 0, followups_on: true } },
  '/notifications': { data: [], unread_count: 0 },
});

test.describe('Inbox — the follow-ups an enquiry got (sales item 87)', () => {
  test('it lists the one that went and when the next goes; Stop follow-ups stops them and leaves the status', async ({ page }) => {
    const next = new Date(Date.now() + 3 * 86400000).toISOString();
    const row = queueRow({ followups: { sent: [{ n: 1, at: new Date(Date.now() - 86400000).toISOString() }], off: false, next: { n: 2, at: next } } });
    await installApp(page, { api: INBOX_API(row) });
    let posted: unknown = null;
    await page.route('**/functions/v1/presence/forms/inbox/l-7', (route) => { if (route.request().method() !== 'POST') return route.fallback(); posted = route.request().postDataJSON(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"ok":true}}' }); });
    await page.goto('/inbox.html#enquiries');
    await page.locator('#rows [role=option]').filter({ hasText: 'Sam Lee' }).first().click();
    const pane = page.locator('#rpane');
    await expect(pane.locator('.lfu').first()).toContainText('Follow-up 1 sent');
    await expect(pane.locator('.lfu').nth(1)).toContainText('Follow-up 2 goes on');
    await pane.getByRole('button', { name: 'Stop follow-ups' }).click();
    await expect.poll(() => posted).toEqual({ followups: 'off' });
    await expect(page.locator('.dds-toast', { hasText: 'No more automatic follow-ups' })).toBeVisible();
    await expect(pane.locator('.lfu').last()).toHaveText('Follow-ups stopped by you.');
    await expect(pane.getByRole('button', { name: 'Stop follow-ups' })).toHaveCount(0);
  });

  test('with nothing planned there is no Stop button and nothing extra to read', async ({ page }) => {
    await installApp(page, { api: INBOX_API(queueRow({ followups: { sent: [], off: false, next: null } })) });
    await page.goto('/inbox.html#enquiries');
    await page.locator('#rows [role=option]').filter({ hasText: 'Sam Lee' }).first().click();
    await expect(page.locator('#rpane .pname')).toContainText('Sam Lee');
    await expect(page.locator('#rpane .lfu')).toHaveCount(0);
    await expect(page.locator('#rpane').getByRole('button', { name: 'Stop follow-ups' })).toHaveCount(0);
  });
});
