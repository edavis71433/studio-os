import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { capabilitiesOf } from '../../supabase/functions/presence/lib/site_roles';

// Builder list item 203. "Join our list" emails a "Yes, add me" link that lands on
// join.html, which says who and what before it adds anyone (mail scanners open links on
// their own). The Inbox's enquiries get a Delete that asks first, in place, and takes the
// files that came with a message; a staff seat, which can't delete, isn't offered it.
const PROD = 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/join';
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

test.describe('join.html: “Yes, add me”', () => {
  test('it asks first, then adds them, and says so', async ({ page }) => {
    let joined = false;
    const posts: unknown[] = [];
    await page.route(`${PROD}?**`, (route) => answer(route, 200, { data: { business: 'Example Shop', email: 'sam@customer.example', joined } }));
    await page.route(PROD, (route) => { posts.push(route.request().postDataJSON()); joined = true; return answer(route, 200, { data: { ok: true, joined: true } }); });
    await page.goto('/join.html?t=abc.def');
    await expect(page.getByRole('heading', { name: 'Join Example Shop’s list?' })).toBeVisible();
    await expect(page.locator('.who')).toHaveText('sam@customer.example');
    expect(posts).toHaveLength(0);   // opening the link adds nobody
    const yes = page.getByRole('button', { name: 'Yes, add me' });
    expect((await yes.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await yes.click();
    await expect(page.getByRole('heading', { name: 'You’re on the list. Thank you!' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Example Shop will send updates to sam@customer.example. Every email has an unsubscribe link.');
    expect(posts).toEqual([{ t: 'abc.def' }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('someone already on the list is told so, with nothing to press', async ({ page }) => {
    await page.route(`${PROD}?**`, (route) => answer(route, 200, { data: { business: 'Example Shop', email: 'sam@customer.example', joined: true } }));
    await page.goto('/join.html?t=abc.def');
    await expect(page.getByRole('heading', { name: 'You’re on the list. Thank you!' })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
  });

  test('a run-out link says so, in the server’s words', async ({ page }) => {
    await page.route(`${PROD}?**`, (route) => answer(route, 410, { error: 'expired', message: 'This link has run out. Join again on the website, and use the new email.' }));
    await page.goto('/join.html?t=old.link');
    await expect(page.getByRole('heading', { name: 'That link didn’t work' })).toBeVisible();
    await expect(page.locator('main')).toContainText('This link has run out.');
  });

  test('a refused press keeps the button and says why', async ({ page }) => {
    await page.route(`${PROD}?**`, (route) => answer(route, 200, { data: { business: 'Example Shop', email: 'sam@customer.example', joined: false } }));
    await page.route(PROD, (route) => answer(route, 502, { error: 'write_failed', message: 'That didn’t go through. Try again in a moment.' }));
    await page.goto('/join.html?t=abc.def');
    await page.getByRole('button', { name: 'Yes, add me' }).click();
    await expect(page.getByRole('alert')).toHaveText('That didn’t go through. Try again in a moment.');
    await expect(page.getByRole('button', { name: 'Yes, add me' })).toBeEnabled();
  });
});

test.describe('the Inbox: Delete an enquiry', () => {
  const LEAD = { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-07-13T00:00:00Z', files: [{ n: 0, key: 'photos', name: 'patio.jpg', type: 'image/jpeg', size: 2048 }] };
  async function open(page: Page, deletes: string[], ctx?: unknown) {
    await installApp(page, { api: {
      ...(ctx ? { '/portal/context': ctx } : {}),
      '/portal/feed': { data: { role: 'business_owner', notices: [], pending_approvals: [], client_messages: [], enquiries: [] } },
      '/forms/inbox': { data: { submissions: [LEAD], unread: 1 } },
    } });
    await page.route('**/functions/v1/presence/forms/inbox/l-9', (route) => {
      if (route.request().method() === 'DELETE') { deletes.push('l-9'); return answer(route, 200, { data: { ok: true, deleted: true } }); }
      return answer(route, 200, { data: { ok: true } });
    });
    await page.goto('/inbox.html#enquiries');
    await page.locator('#rows').getByRole('option').filter({ hasText: 'Sam Rivera' }).click();
  }

  test('Delete asks first, in place; Keep it changes nothing; Delete for good takes it and its file', async ({ page }) => {
    const deletes: string[] = [];
    await open(page, deletes);
    const del = page.locator('#leadDel');
    await expect(del).toBeVisible();
    await del.click();
    const ask = page.getByRole('group', { name: 'Delete this message and the file with it for good?' });
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Delete for good' })).toBeFocused();
    await ask.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.locator('#leadDel')).toBeFocused();
    expect(deletes).toHaveLength(0);
    await page.locator('#leadDel').click();
    await page.getByRole('button', { name: 'Delete for good' }).click();
    await expect.poll(() => deletes).toEqual(['l-9']);
    await expect(page.locator('#rows').getByRole('option').filter({ hasText: 'Sam Rivera' })).toHaveCount(0);
    await expect(page.getByText('Deleted, with the files that came with it.')).toBeVisible();
  });

  test('a staff seat, which can’t delete, isn’t offered Delete', async ({ page }) => {
    await open(page, [], { data: {
      site_role: 'business_staff', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
      is_agency: false, is_operator: false, is_managed_client: false, sees_full_workspace: true, is_client_portal: false,
      capabilities: capabilitiesOf('business_staff'), landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null, scope: null,
    } });
    await expect(page.locator('#rpane')).toContainText('Can I get a quote for a patio?');
    await expect(page.locator('#leadDel')).toBeHidden();
  });
});
