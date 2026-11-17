import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { galleryPayload } from '../../supabase/functions/presence/lib/design_gallery.ts';

// Builder item 241 (Eric, Nov 15: "it looks like every time a customer has been created, it
// starts their site. shouldnt be that way. i also cant delete whats currently there"), drawn
// in Figma ("Customers: save, Create website, invite, delete — items 241 and 102"):
//   · a customer's profile offers two steps, each on its own: Create website (+ New site's sheet,
//     opened for them) and Invite to their portal; a site that lives somewhere else is kept by
//     its address;
//   · Delete customer asks about their website (the Trash or kept), from their profile and from
//     their preview on Customers; Undo and Recently deleted bring them back.
// Hermetic; every name is made up. The server's side is driven in tests/presence/customers_241_test.mjs.

const CID = 'cccccccc-2410-4241-8241-cccccccccccc';
const SITE = 'eeeeeeee-2410-4241-8241-eeeeeeeeeeee';
const CONTACT = 'aaaaaaaa-2410-4241-8241-aaaaaaaaaaaa';
const state = (over: Record<string, unknown> = {}) => ({ data: {
  client_id: CID, business_name: 'Willow & Ash Bakery', person: { name: 'Maya Ortiz', email: 'maya@willowash.example', company: 'Willow & Ash Bakery' },
  website: { state: 'none', site_id: null, address: null, live: false, last_published_at: null, in_trash: false },
  portal: { state: 'none', email: 'maya@willowash.example', invited_at: null, seen_at: null },
  offers: { create_website: true, invite: true, invite_again: false, delete: true, can_manage_sites: true },
  ...over,
} });
const RECORD = { data: {
  identity: { contact_id: null, deal_id: null, client_id: CID, customer_site_id: null, project_id: null },
  header: { name: 'Willow & Ash Bakery', person: 'Maya Ortiz', company: 'Willow & Ash Bakery', email: 'maya@willowash.example', phone: '', status: 'customer' },
  highlights: {}, sections: { overview: false, messages: true, deal: false, delivery: false, details: false },
  default_tab: 'details', canonical: { key: 'contact', value: '' }, related_projects: [], related_deals: [],
} };
const PROFILE_API = (over: Record<string, unknown> = {}) => ({
  '/crm/record': RECORD,
  '/crm/activity': { data: { items: [], upcoming: [], project_id: null, deal_id: null, reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: {} } },
  [`/sales/customers/${CID}`]: state(),
  ...over,
});
const openProfile = async (page: Page) => { await page.goto(`/crm.html?client_id=${CID}`); await expect(page.locator('#custsteps .cs-row')).toBeVisible(); };
const isPhone = (page: Page) => (page.viewportSize()?.width || 1280) < 761;

test.describe('a customer’s profile: two steps, each on its own', () => {
  test('a customer just saved: no website yet and Create website opens New site for them; not invited yet', async ({ page }) => {
    await installApp(page, { api: PROFILE_API() });
    await openProfile(page);
    const steps = page.locator('#custsteps');
    await expect(steps.getByRole('heading', { name: 'No website yet' })).toBeVisible();
    await expect(steps).toContainText('Pick a look for Willow & Ash Bakery. Their name and business are already filled in. Nothing is published, and nobody is emailed.');
    await expect(steps.getByRole('link', { name: /Create website/ })).toHaveAttribute('href', `/sites.html?for=${CID}`);
    await expect(steps.getByRole('heading', { name: 'Not invited yet' })).toBeVisible();
    await expect(steps.getByRole('button', { name: 'Invite to their portal' })).toBeVisible();
    // nothing on the page is wider than the screen
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (isPhone(page)) {   // on a phone the two steps stack, the website first
      const [w, p] = await Promise.all([steps.locator('.cs-card').nth(0).boundingBox(), steps.locator('.cs-card').nth(1).boundingBox()]);
      expect(w && p && p.y > w.y + w.height - 1).toBeTruthy();
    }
  });

  test('Invite to their portal: their email is filled in, sending says so, and the card says they were invited', async ({ page }) => {
    let sent: unknown = null, invited = false;
    await installApp(page, { api: PROFILE_API({
      [`POST /sales/customers/${CID}/invite`]: (b: unknown) => { sent = b; invited = true; return { data: { invited: true, again: false, email: 'maya@willowash.example', portal_url: 'https://app.test/portal.html?studio=s' } }; },
    }) });
    await page.route(`**/functions/v1/presence/sales/customers/${CID}`, (route) => route.request().method() !== 'GET' ? route.fallback()
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invited ? state({ portal: { state: 'waiting', email: 'maya@willowash.example', invited_at: '2026-11-16T15:00:00Z', seen_at: null }, offers: { create_website: true, invite: false, invite_again: true, delete: true, can_manage_sites: true } }) : state()) }));
    await openProfile(page);
    await page.getByRole('button', { name: 'Invite to their portal' }).click();
    const email = page.getByLabel('Their email');
    await expect(email).toBeFocused();
    await expect(email).toHaveValue('maya@willowash.example');
    await page.getByRole('button', { name: 'Send the invite' }).click();
    await expect.poll(() => sent).toEqual({ email: 'maya@willowash.example' });
    await expect(page.locator('.dds-toast').last()).toContainText('Invitation sent to maya@willowash.example.');
    await expect(page.locator('#custsteps').getByRole('heading', { name: /^Invited / })).toBeVisible();
    await expect(page.locator('#custsteps').getByRole('button', { name: 'Send the sign-in link again' })).toBeVisible();
  });

  test('an invite that didn’t send says so in the card and keeps the form', async ({ page }) => {
    await installApp(page, { api: PROFILE_API() });
    await page.route(`**/functions/v1/presence/sales/customers/${CID}/invite`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'account_exists', message: 'That email already has a Studio OS account, so it can’t sign in to this one. Use another address for them.' }) }));
    await openProfile(page);
    await page.getByRole('button', { name: 'Invite to their portal' }).click();
    await page.getByRole('button', { name: 'Send the invite' }).click();
    await expect(page.locator('#csInvMsg')).toContainText('already has a Studio OS account');
    await expect(page.getByLabel('Their email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send the invite' })).toBeEnabled();
  });

  test('an invite whose email didn’t go out says so honestly: their portal is ready, share the sign-in page instead', async ({ page }) => {
    await installApp(page, { api: PROFILE_API({ [`POST /sales/customers/${CID}/invite`]: { data: { invited: false, again: false, email: 'maya@willowash.example', portal_url: 'https://app.test/portal.html?studio=s' } } }) });
    await openProfile(page);
    await page.getByRole('button', { name: 'Invite to their portal' }).click();
    await page.getByRole('button', { name: 'Send the invite' }).click();
    const t = page.locator('.dds-toast').last();
    await expect(t).toContainText('Their portal is ready, but our email to maya@willowash.example didn’t go out.');
    await expect(t).not.toContainText('Invitation sent');
  });

  test('their site lives somewhere else: the address is kept, and the card says it lives on its own host', async ({ page }) => {
    let sent: unknown = null;
    await installApp(page, { api: PROFILE_API({ [`POST /sales/customers/${CID}/website`]: (b: unknown) => { sent = b; return { data: { site_id: SITE, address: 'acmebakery.example' } }; } }) });
    await page.route(`**/functions/v1/presence/sales/customers/${CID}`, (route) => route.request().method() !== 'GET' ? route.fallback()
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sent ? state({ website: { state: 'elsewhere', site_id: SITE, address: 'acmebakery.example', live: false, last_published_at: null, in_trash: false }, offers: { create_website: false, invite: true, invite_again: false, delete: true, can_manage_sites: true } }) : state()) }));
    await openProfile(page);
    await page.getByRole('button', { name: 'Their site lives somewhere else?' }).click();
    const addr = page.getByLabel('Their website address');
    await expect(addr).toBeFocused();
    await page.getByRole('button', { name: 'Watch it' }).click();   // empty: it asks, nothing sent
    await expect(page.locator('#csElseMsg')).toContainText('Enter the address of their website');
    expect(sent).toBeNull();
    await addr.fill('acmebakery.example');
    await page.getByRole('button', { name: 'Watch it' }).click();
    await expect.poll(() => sent).toEqual({ address: 'acmebakery.example' });
    await expect(page.locator('#custsteps').getByRole('heading', { name: 'On their own host' })).toBeVisible();
    await expect(page.locator('#custsteps')).toContainText('acmebakery.example');
  });

  test('a customer with a live website: the card opens the editor; one who’s in their portal says when', async ({ page }) => {
    await installApp(page, { api: PROFILE_API({ [`/sales/customers/${CID}`]: state({
      website: { state: 'ours', site_id: SITE, address: 'https://willowash.example', live: true, last_published_at: '2026-11-10T12:00:00Z', in_trash: false },
      portal: { state: 'joined', email: 'maya@willowash.example', invited_at: '2026-11-01T12:00:00Z', seen_at: '2026-11-12T12:00:00Z' },
      offers: { create_website: false, invite: false, invite_again: false, delete: true, can_manage_sites: true },
    }) }) });
    await openProfile(page);
    const steps = page.locator('#custsteps');
    await expect(steps.getByRole('heading', { name: 'Live' })).toBeVisible();
    await expect(steps.getByRole('link', { name: /Edit website/ })).toHaveAttribute('href', `/presence.html?client=${SITE}`);
    await expect(steps.getByRole('heading', { name: 'In their portal' })).toBeVisible();
    await expect(steps).not.toContainText('Create website');
    await expect(steps.getByRole('button', { name: /Invite/ })).toHaveCount(0);
  });
});

test.describe('Delete customer', () => {
  test('from their profile: the website goes to the Trash by default; the page says they’re deleted, and Undo brings them back', async ({ page }) => {
    let deleted: unknown = null, restored = 0;
    await installApp(page, { api: PROFILE_API({
      [`/sales/customers/${CID}`]: state({ website: { state: 'ours', site_id: SITE, address: 'https://willowash.example', live: true, last_published_at: '2026-11-10T12:00:00Z', in_trash: false }, offers: { create_website: false, invite: true, invite_again: false, delete: true, can_manage_sites: true } }),
      [`POST /sales/customers/${CID}/delete`]: (b: unknown) => { deleted = b; return { data: { deleted: true, client_id: CID, name: 'Willow & Ash Bakery', site: { site_id: SITE, kept: false, offline: true }, days: 30 } }; },
      [`POST /sales/customers/${CID}/restore`]: () => { restored++; return { data: { restored: true, client_id: CID, name: 'Willow & Ash Bakery', site: { site_id: SITE, restored: true } } }; },
    }) });
    await openProfile(page);
    await page.locator('#act-more').click();
    await page.getByRole('button', { name: 'Delete customer…' }).click();
    const dlg = page.locator('#custDelDlg');
    await expect(dlg.getByRole('heading', { name: 'Delete Willow & Ash Bakery?' })).toBeVisible();
    await expect(dlg).toContainText('Their invoices stay in Invoices');
    await expect(dlg.getByRole('radio', { name: /Move it to the Trash/ })).toBeChecked();
    await expect(dlg).toContainText('It leaves Sites and goes offline. You can restore it from the Trash on Sites for 90 days.');
    await expect(dlg).toContainText('Bring them back from Recently deleted for 30 days, and their website with them.');
    await dlg.getByRole('button', { name: 'Delete customer' }).click();
    await expect.poll(() => deleted).toEqual({ site: 'trash' });
    await expect(page.getByRole('heading', { name: 'Willow & Ash Bakery is deleted' })).toBeFocused();
    await expect(page.locator('#main')).toContainText('Their website went to the Trash on Sites.');
    await expect(page.getByRole('link', { name: 'Back to Customers' })).toHaveAttribute('href', '/customers.html');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => restored).toBe(1);
  });

  test('keeping their website sends keep; a customer with no website is asked nothing about one', async ({ page }) => {
    const sent: unknown[] = [];
    await installApp(page, { api: PROFILE_API({
      [`/sales/customers/${CID}`]: state({ website: { state: 'ours', site_id: SITE, address: 'https://willowash.example', live: false, last_published_at: null, in_trash: false }, offers: { create_website: false, invite: true, invite_again: false, delete: true, can_manage_sites: true } }),
      [`POST /sales/customers/${CID}/delete`]: (b: unknown) => { sent.push(b); return { data: { deleted: true, client_id: CID, name: 'Willow & Ash Bakery', site: { site_id: SITE, kept: true }, days: 30 } }; },
    }) });
    await openProfile(page);
    await page.locator('#act-more').click();
    await page.getByRole('button', { name: 'Delete customer…' }).click();
    const dlg = page.locator('#custDelDlg');
    await expect(dlg).toContainText('It leaves Sites. You can restore it');   // not live: nothing to take offline
    await dlg.getByRole('radio', { name: /Keep it on Sites/ }).check();
    await expect(dlg).toContainText('Bring them back from Recently deleted for 30 days.');
    await dlg.getByRole('button', { name: 'Delete customer' }).click();
    await expect(page.locator('#main')).toContainText('Their website stayed on Sites.');
    expect(sent).toEqual([{ site: 'keep' }]);
    // no website at all: the box asks nothing about one
    await installApp(page, { api: PROFILE_API() });
    await openProfile(page);
    await page.locator('#act-more').click();
    await page.getByRole('button', { name: 'Delete customer…' }).click();
    await expect(page.locator('#custDelDlg fieldset')).toHaveCount(0);
    await page.locator('#custDelDlg').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#custDelDlg')).toHaveCount(0);
    await expect(page.locator('#act-more')).toBeFocused();
  });

  test('a refusal stays in the box, in words, and nothing changes on the page', async ({ page }) => {
    await installApp(page, { api: PROFILE_API() });
    await page.route(`**/functions/v1/presence/sales/customers/${CID}/delete`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: 'Deleting customers needs one database step first.' }) }));
    await openProfile(page);
    await page.locator('#act-more').click();
    await page.getByRole('button', { name: 'Delete customer…' }).click();
    await page.locator('#custDelDlg').getByRole('button', { name: 'Delete customer' }).click();
    await expect(page.locator('#cd-err')).toHaveText('Deleting customers needs one database step first.');
    await expect(page.locator('#custDelDlg').getByRole('button', { name: 'Delete customer' })).toBeEnabled();
    await expect(page.locator('#custsteps .cs-row')).toBeVisible();
  });

  test('from Customers: their preview has Delete customer…, the row goes, and Undo brings it back', async ({ page }) => {
    let restored = 0;
    const ROW = { client_id: CID, name: 'Willow & Ash Bakery', person_name: 'Maya Ortiz', email: 'maya@willowash.example', project_id: 'pppppppp-2410-4241-8241-pppppppppppp', project_name: 'Willow & Ash Bakery', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 };
    await installApp(page, { api: {
      '/studio/customers': { data: [ROW] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
      '/crm/record': RECORD, '/crm/activity': { data: { items: [], upcoming: [] } },
      [`/sales/customers/${CID}`]: state(),
      [`POST /sales/customers/${CID}/delete`]: { data: { deleted: true, client_id: CID, name: 'Willow & Ash Bakery', site: null, days: 30 } },
      [`POST /sales/customers/${CID}/restore`]: () => { restored++; return { data: { restored: true, client_id: CID, name: 'Willow & Ash Bakery', site: null } }; },
    } });
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'table'); } catch (_) { /* */ } });
    await page.goto('/customers.html');
    await page.getByRole('row', { name: /Preview Willow & Ash Bakery/ }).click();
    const pv = page.locator('#cprev');
    await expect(pv.getByRole('heading', { name: 'Willow & Ash Bakery' })).toBeVisible();
    await pv.getByRole('button', { name: 'Delete customer…' }).click();
    const dlg = page.locator('#custDelDlg');
    await expect(dlg.getByRole('heading', { name: 'Delete Willow & Ash Bakery?' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Delete customer' }).click();
    await expect(page.getByRole('row', { name: /Preview Willow & Ash Bakery/ })).toHaveCount(0);
    const toast = page.locator('.dds-toast').last();
    await expect(toast).toContainText('Willow & Ash Bakery is deleted. Recently deleted keeps them for 30 days.');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => restored).toBe(1);
  });
});

test('Recently deleted lists a deleted customer and brings them back, with their website', async ({ page }) => {
  let restored = 0;
  await installApp(page, { api: {
    '/sales/deleted': { data: { days: 30, customers: [{ id: CID, name: 'Willow & Ash Bakery', email: 'maya@willowash.example', site_went: true, site_kept: false, deleted_at: new Date().toISOString() }], deals: [], contacts: [], todos: [], partial: [] } },
    [`POST /sales/customers/${CID}/restore`]: () => { restored++; return { data: { restored: true, client_id: CID, name: 'Willow & Ash Bakery', site: { site_id: SITE, restored: true } } }; },
  } });
  await page.goto('/recently-deleted.html');
  const row = page.locator(`[data-row="customer:${CID}"]`);
  await expect(row).toContainText('Willow & Ash Bakery');
  await expect(row).toContainText('Customer · maya@willowash.example · their website went to the Trash');
  await expect(page.getByRole('button', { name: /^Customers 1/ })).toBeVisible();
  await row.getByRole('button', { name: 'Restore Willow & Ash Bakery' }).click();
  await expect.poll(() => restored).toBe(1);
  await expect(row).toHaveCount(0);
  await expect(page.locator('.dds-toast').last()).toContainText('Willow & Ash Bakery is back in Customers, with their website');
});

// ── Create website: + New site's sheet, opened for the customer ──
const TEMPLATES = [['atelier', 'Atelier'], ['aurora', 'Aurora'], ['business-classic', 'Business Classic'], ['editorial', 'Editorial'], ['harbor', 'Harbor'], ['meadow', 'Meadow'], ['restaurant-classic', 'Restaurant Classic'], ['slate', 'Slate']].map(([slug, name]) => ({ slug, name }));
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null } };

test('Create website opens New site for that customer: it names them, fills in their business, and makes the site for their record', async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: [], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90, room: { used: 2, limit: 25, full: false } },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    '/agency/designs': { data: galleryPayload(TEMPLATES) }, '/agency/kits': { data: [] },
    [`/sales/customers/${CID}`]: state(),
  } });
  // the list's plain fixture would answer the POST too: the made site is answered here
  await page.route(/\/functions\/v1\/presence\/agency\/sites$/, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const b = route.request().postDataJSON(); sent = b;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { site_id: SITE, client_id: CID, name: String(b.business_name), kit: null, look: null, industry: null, for_customer: true } }) });
  });
  await page.goto(`/sites.html?for=${CID}`);
  const dlg = page.locator('#newDlg');
  await expect(dlg.locator('#newHead')).toHaveText('New website for Willow & Ash Bakery');
  await expect(dlg).toContainText('For your customer Maya Ortiz. Nothing is published, and nobody is emailed.');
  await expect(dlg.locator('#new-for')).toContainText('Maya Ortiz · Willow & Ash Bakery');
  await expect(dlg.locator('#new-biz')).toHaveValue('Willow & Ash Bakery');
  await expect.poll(() => new URL(page.url()).search).toBe('');   // a reload doesn't open the sheet again
  await dlg.locator('#new-submit').click();
  await expect.poll(() => sent && sent.client_id).toBe(CID);
  expect(sent).toMatchObject({ business_name: 'Willow & Ash Bakery', client_id: CID });
  await expect(dlg.locator('#new-done')).toContainText('Willow & Ash Bakery’s website is ready');
  await expect(dlg.locator('#new-done')).toContainText('Invite them to their portal from their profile when you’re ready.');
  await expect(dlg.getByRole('link', { name: 'Back to their profile' })).toHaveAttribute('href', `/crm.html?client=${SITE}`);
});
