import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { headerAction } from './helpers/page-header';

// Builder item 199 (Nov 15 2026): nobody signs up by themselves. Studios add their
// clients and invite them, so:
//   · Add a customer has no sign-up wording: "Just save them for now" (no website, no
//     email; Eric, Nov 15) is the default and setting them up is the other choice, on
//     Home, Customers and Contacts;
//   · the builder's plan card opens Settings → Your plan, not the old price page;
//   · Get started says what's missing instead of doing nothing (file 06, finding 46).
// The server's closed sign-up is pinned by tests/presence/no_self_signup_test.mjs.

const OWNER_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} };
const EDITOR_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Test Studio', description: 'Hello' }, location: null } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/moments': { data: [] }, '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [] } },
  '/portal/context': OWNER_CTX,
};

test('Home: Add a customer saves them and nothing else; no sign-up wording, link or price page (items 199, 241)', async ({ page }) => {
  await installApp(page);
  await page.goto('/agency.html');
  await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
  const dlg = page.locator('#custDlg');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#cu-signup, a[href*="pricing"]')).toHaveCount(0);
  await expect(dlg).not.toContainText('sign up themselves');
  await expect(dlg.locator('input[type=radio]')).toHaveCount(0);   // nothing to choose: saving is all it does
  await expect(dlg.locator('#cu-biz')).toBeVisible();
  await expect(dlg.locator('#cu-submit')).toHaveText('Save customer');
});

// Name is the dialog's first field (the save-or-set-up choice comes after Email), so the
// browser focuses it the moment the dialog opens and the page's 20ms nudge to Name comes
// after. The nudge used to
// pull focus back from wherever someone had moved, so under load a typed email landed in
// Name and nothing was sent (seen on CI as an empty result). Here the nudge is stretched so
// it always lands after the move.
const DIALOGS = [
  { where: 'Home', path: '/agency.html', api: {}, open: '#top button:has-text("+ Add a customer")' },
  { where: 'Customers', path: '/customers.html', api: { '/studio/customers': { data: [] } }, open: '#addCust' },
  { where: 'Contacts', path: '/contacts.html', api: { '/sales/contacts': { data: [] } }, open: '#addCust' },
];
for (const d of DIALOGS) {
  test(`${d.where}: the dialog's late focus never pulls focus back from the email field`, async ({ page }) => {
    await page.addInitScript(() => {
      const later = window.setTimeout.bind(window);
      window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => later(fn, ms === 20 ? 300 : ms, ...rest)) as typeof window.setTimeout;
    });
    await installApp(page, { api: d.api });
    await page.goto(d.path);
    await (await headerAction(page, d.open)).first().click();   // behind ⋯ on a phone (builder item 165)
    await expect(page.locator('#cu-name')).toBeFocused();   // the browser's own focus, before the nudge
    await page.locator('#cu-email').focus();
    await page.waitForTimeout(600);   // the stretched nudge has fired by now
    await expect(page.locator('#cu-email')).toBeFocused();
  });

  test(`${d.where}: saving sends who they are, and says no website was made and nothing was emailed`, async ({ page }) => {
    let sent: unknown = null;
    await installApp(page, { api: d.api });
    await page.route('**/functions/v1/presence/sales/customers', (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { mode: 'save', saved: true, created: true, client_id: 'cccccccc-5555-4555-8555-cccccccccccc', email: 'ana@harbor.example' } }) });
    });
    await page.goto(d.path);
    await (await headerAction(page, d.open)).first().click();   // behind ⋯ on a phone (builder item 165)
    await expect(page.locator('#cu-name')).toBeFocused();
    await page.locator('#cu-name').fill('Ana Ruiz');
    await page.locator('#cu-email').fill('ana@harbor.example');
    await page.locator('#cu-submit').click();
    const done = page.locator('#cust-done');
    await expect(done).toContainText('Saved to your customers');
    await expect(done).toContainText('Ana Ruiz is on your Customers list. No website yet, and nothing was emailed.');
    await expect(done).not.toContainText('Invitation sent');
    expect(sent).toEqual({ mode: 'connect', save: true, name: 'Ana Ruiz', email: 'ana@harbor.example' });   // builder item 241: the customer and nothing else
  });
}

test('the builder’s plan card opens Settings → Your plan, never the old price page', async ({ page }) => {
  await installApp(page, { api: { ...EDITOR_API, '/commerce/notices': { data: { notices: [{ id: 'n3', kind: 'capacity', headline: 'You’re close to your plan’s limit', body: 'b', dismissible: true }] } } } });
  await page.goto('/presence.html');
  await expect(page.getByText('You’re close to your plan’s limit')).toBeVisible();
  const go = page.getByRole('link', { name: 'Open Your plan' });
  await expect(go).toBeVisible();
  await expect(go).toHaveAttribute('href', 'settings.html#billing');
  await expect(page.locator('a[href*="pricing.html"]')).toHaveCount(0);
});

test('Get started: with nothing to draft from, Build my website says what’s missing', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/writer/generate')) asked.push(r.url()); });
  await installApp(page, { api: { '/portal/context': OWNER_CTX, '/settings': { data: { industry_key: 'generic' } }, '/offerings': { data: [] }, '/identity': { data: { business_name: 'Harbor Lane Bakery' } } } });
  await page.goto('/get-started.html');
  await expect(page.getByRole('button', { name: 'Build my website →' })).toBeVisible();
  for (const box of await page.locator('[data-svc]').all()) await box.fill('');
  await page.locator('#desc').fill('');
  await page.getByRole('button', { name: 'Build my website →' }).click();
  await expect(page.locator('#needMore')).toBeVisible();
  await expect(page.locator('#needMore')).toHaveText('Add one thing you offer, or a sentence about the business, so there’s something to draft from.');
  await expect(page.locator('#desc')).toBeFocused();
  expect(asked).toEqual([]);
});
