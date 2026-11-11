import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales item 89 (Nov 2026): a website enquiry notes where the visitor came from.
// The Inbox shows where their visit began and its first page, and "How did they find
// you?" starts from it; Make it a deal and Make customer carry the answer to the
// person and the deal. An enquiry with no visit noted shows nothing of the kind.

const VISIT = { from: 'a Google search', ref_host: 'google.com', utm_source: '', utm_medium: '', utm_campaign: '', landing: '/services', at: '2026-11-03T17:20:00Z', found_via: 'Google' };
const row = (over: Record<string, unknown> = {}) => ({ id: 'l-1', form_kind: 'contact', name: 'Lena Ortiz', email: 'lena@example.com', phone: '(555) 010-6342', message: 'Do you redo dental sites?', source_page: '/contact/', status: 'new', created_at: '2026-11-03T17:31:00Z', visit: VISIT, ...over });
const API = (submissions: unknown[]) => ({
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], last_published: null, pending_approvals: [], client_messages: [], enquiries: [] } },
  '/forms/inbox': { data: { submissions, unread: 1 } },
  '/notifications': { data: [], unread_count: 0 },
});
async function open(page: Page, name = 'Lena Ortiz') {
  await page.goto('/inbox.html#enquiries');
  await page.locator('#rows [role=option]').filter({ hasText: name }).first().click();
  await expect(page.locator('#rpane .pname')).toContainText(name);
  return page.locator('#rpane');
}
// the person and the deal Make it a deal sends
async function catchSends(page: Page) {
  const sent: Record<string, Record<string, unknown>[]> = { contacts: [], deals: [] };
  await page.route(/\/functions\/v1\/presence\/sales\/(contacts|deals)$/, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const which = /contacts$/.test(route.request().url()) ? 'contacts' : 'deals';
    sent[which].push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: which === 'contacts' ? 'ct-1' : 'dl-1' } }) });
  });
  return sent;
}

test.describe('An enquiry says where the visitor came from (item 89)', () => {
  test('the pane shows where the visit began and its first page; the pick starts from it', async ({ page }) => {
    await installApp(page, { api: API([row()]) });
    const pane = await open(page);
    await expect(pane.locator('.lvisit .pchip.src')).toHaveText('Came from a Google search');
    await expect(pane.locator('.lvisit .muted')).toHaveText('first page: /services · Nov 3');
    await expect(pane.locator('#leadFound')).toHaveValue('Google');
    await expect(pane.locator('#leadFoundNote')).toHaveText('filled in from their visit');
    // changed by hand, it no longer says it came from the visit
    await pane.locator('#leadFound').selectOption('Referral');
    await expect(pane.locator('#leadFoundNote')).toBeHidden();
  });

  test('Make it a deal carries the answer to the person and the deal', async ({ page }) => {
    await installApp(page, { api: API([row()]) });
    const sent = await catchSends(page);
    const pane = await open(page);
    await pane.getByRole('button', { name: '+ Make it a deal' }).click();
    await expect.poll(() => sent.deals.length).toBe(1);
    expect(sent.contacts[0]).toMatchObject({ name: 'Lena Ortiz', email: 'lena@example.com', found_via: 'Google' });
    expect(sent.deals[0]).toMatchObject({ contact_id: 'ct-1', source: 'website_form', source_submission_id: 'l-1', found_via: 'Google' });
  });

  test('a pick changed by hand is the one that goes', async ({ page }) => {
    await installApp(page, { api: API([row()]) });
    const sent = await catchSends(page);
    const pane = await open(page);
    await pane.locator('#leadFound').selectOption('Word of mouth');
    await pane.getByRole('button', { name: '+ Make it a deal' }).click();
    await expect.poll(() => sent.deals.length).toBe(1);
    expect(sent.deals[0].found_via).toBe('Word of mouth');
    expect(sent.contacts[0].found_via).toBe('Word of mouth');
  });

  test('a visit that came straight to the site says so, and leaves the pick empty', async ({ page }) => {
    await installApp(page, { api: API([row({ visit: { ...VISIT, from: 'straight to the site', ref_host: '', landing: '/', found_via: '' } })]) });
    const sent = await catchSends(page);
    const pane = await open(page);
    await expect(pane.locator('.lvisit .pchip.src')).toHaveText('Came straight to the site');
    await expect(pane.locator('#leadFound')).toHaveValue('');
    await expect(pane.locator('#leadFoundNote')).toHaveCount(0);
    await pane.getByRole('button', { name: '+ Make it a deal' }).click();
    await expect.poll(() => sent.deals.length).toBe(1);
    expect('found_via' in sent.deals[0]).toBe(false);   // nothing claimed: the deal takes the person's, as before
  });

  test('no visit noted (an older enquiry, or Do Not Track): nothing about it shows', async ({ page }) => {
    await installApp(page, { api: API([row({ visit: null })]) });
    const pane = await open(page);
    await expect(pane.locator('.lvisit')).toHaveCount(0);
    await expect(pane.locator('#leadFound')).toHaveValue('');
  });

  test('already in the pipeline: the visit still shows, the pick doesn\'t', async ({ page }) => {
    await installApp(page, { api: API([row({ status: 'converted', converted: true, deal_id: 'dl-9' })]) });
    await page.goto('/inbox.html#enquiries');
    await page.locator('[data-ef="all"]').click();
    const pane = await open(page);
    await expect(pane.locator('.lvisit .pchip.src')).toHaveText('Came from a Google search');
    await expect(pane.locator('#leadFound')).toHaveCount(0);
  });
});
