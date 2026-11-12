import { test, expect } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, CLIENT_NAV, ALL_FEATURES } from './helpers/app';

// Builder items 201 and 202 (Nov 12 review, file 06 findings 65, 67 to 70, 73, 74, 76):
// Help reachable on an iPhone, the bell and account menu with the keyboard, Switch site
// rows read as links, focus kept after "Yes"; and the names: Messages and Invoices inside
// a client, Help cards that open what they name, one helper behind both Help boxes,
// "Business profile" and "Services and prices" in Settings, and search that lists only
// what the person can open.
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const studioCtx = (extra: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'view_all'], landing: '/agency.html',
  attention_count: 3, nav: STUDIO_LEVEL_NAV, ...extra,
} });
const inClient = () => studioCtx({ nav: CLIENT_NAV, scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } });

test.describe('The frame (builder 201)', () => {
  test('Help is the account menu’s first row and opens the how-do-I panel, on a phone too', async ({ page }, testInfo) => {
    await installApp(page);
    await page.goto('/today.html');
    if (testInfo.project.name === 'mobile') await expect(page.locator('#dds-help')).toBeHidden();   // no room for the ? button under 420px
    await page.locator('#dds-profile').click();
    const menu = page.getByRole('region', { name: 'Account menu' });
    await expect(menu.locator('a.row').first()).toContainText('Help');
    await menu.locator('#dds-help-row').click();
    const help = page.getByRole('region', { name: 'Help — how do I…?' });
    await expect(help).toBeVisible();
    await expect(menu).toBeHidden();
    await expect(page.locator('#dds-help-q')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    // focus goes back to whatever opens Help on this screen: the ? button, or on a phone the account menu
    await expect(page.locator(testInfo.project.name === 'mobile' ? '#dds-profile' : '#dds-help')).toBeFocused();
  });

  test('the bell says its number, takes focus when opened from the keyboard, and gives it back', async ({ page }) => {
    await installApp(page);   // two things need you
    await page.goto('/today.html');
    const bell = page.locator('#dds-bell');
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 need you');
    await bell.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Notifications', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'All' })).toBeFocused();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    // Shift+Tab from its first control closes it, back on the bell
    await page.keyboard.press('Shift+Tab');
    await expect(panel).toBeHidden();
    await expect(bell).toBeFocused();
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    // Tab past its last control (the Inbox link at the foot) closes it too
    await page.keyboard.press('Enter');
    await expect(panel.locator('.foot')).toBeVisible();
    await panel.locator('.foot').focus();
    await page.keyboard.press('Tab');
    await expect(panel).toBeHidden();
    await expect(bell).toBeFocused();
  });

  test('the account menu opened from the keyboard starts on its first row; Escape gives focus back', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const btn = page.locator('#dds-profile');
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dds-help-row')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Account menu' })).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('Switch site rows are links, each in a list item', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': inClient(),
      '/agency/sites': { data: [
        { site_id: CLIENT, name: 'Joe’s Plumbing', address: 'https://joes.example', state_words: 'Live' },
        { site_id: OTHER, name: 'Maple & Rye Bakery', address: 'https://maplerye.example', state_words: 'Live' },
      ] },
    } });
    await page.goto(`/today.html?client=${CLIENT}`);
    await page.locator('#dds-site-switch').click();
    const pop = page.getByRole('dialog', { name: 'Switch site' });
    await expect(pop.getByRole('listitem')).toHaveCount(2);
    await expect(pop.getByRole('listitem').getByRole('link')).toHaveCount(2);
    await expect(pop.getByRole('link', { name: /Maple & Rye Bakery/ })).toHaveAttribute('href', `/today.html?client=${OTHER}`);
  });

  test('Which client?: at studio level a website card asks which client, and a pick opens that client at the same place', async ({ page }, testInfo) => {
    const sites = { data: [
      { site_id: CLIENT, name: 'Joe’s Plumbing', address: 'https://joes.example', state_words: 'Live' },
      { site_id: OTHER, name: 'Maple & Rye Bakery', address: '', state_words: 'Not live yet' },
    ] };
    await installApp(page, { api: { '/portal/context': studioCtx({ site_live: false }), '/agency/sites': sites } });
    await page.goto('/settings.html');
    const card = page.locator('#cards .setcard', { has: page.locator('b', { hasText: /^Domain & email$/ }) });
    await card.click();
    const ask = page.getByRole('dialog', { name: 'Which client’s website?' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('Domain & email is part of each client’s website');
    await expect(page).toHaveURL(/\/settings\.html/);   // the studio's own empty site never opened
    await expect(ask.getByRole('listitem')).toHaveCount(2);
    await expect(ask.getByRole('link', { name: /Joe’s Plumbing/ })).toHaveAttribute('href', `/presence.html?client=${CLIENT}#domain`);
    await expect(ask.getByRole('link', { name: /Maple & Rye Bakery/ })).toHaveAttribute('href', `/presence.html?client=${OTHER}#domain`);
    await expect(ask.getByRole('link', { name: 'Your studio’s own site (not live yet)' })).toHaveAttribute('href', '/presence.html#domain');
    await expect(ask.getByRole('link', { name: 'All sites →' })).toHaveAttribute('href', '/sites.html');
    await expect(page.getByLabel('Find a client')).toBeFocused();
    await page.getByLabel('Find a client').fill('maple');
    await expect(ask.getByRole('listitem')).toHaveCount(1);
    if (testInfo.project.name === 'mobile') {
      // a sheet from the bottom on a phone
      const box = await ask.boundingBox(), vp = page.viewportSize();
      expect(box && vp && Math.abs(box.y + box.height - vp.height) < 2).toBeTruthy();
    }
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    await expect(card).toBeFocused();
  });

  test('Which client?: search results and Help’s Your website ask too; a studio whose own site is live, or a client, never sees it', async ({ page }) => {
    const sites = { data: [{ site_id: CLIENT, name: 'Joe’s Plumbing', address: 'https://joes.example', state_words: 'Live' }] };
    const nav = [...STUDIO_LEVEL_NAV.filter((s) => s.key !== 'website'), { key: 'website', label: 'Your website', utility: true, items: [
      { key: 'content', label: 'Your studio’s own site', href: '/presence.html', hidden: true },
      { key: 'publish', label: 'Publish', href: '/presence.html#publish', hidden: true },
    ] }];
    await page.route(/\/presence\.html/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>builder</title><p>builder</p>' }));
    await installApp(page, { api: { '/portal/context': studioCtx({ site_live: false, nav }), '/agency/sites': sites } });
    await page.goto('/agency.html');
    await page.locator('#dds-search').click();
    await page.getByRole('combobox', { name: 'Search' }).fill('publish');
    await page.locator('.dds-palette .res', { hasText: 'Publish' }).first().click();
    const ask = page.getByRole('dialog', { name: 'Which client’s website?' });
    await expect(ask).toContainText('Publishing is part of each client’s website');
    await expect(ask.getByRole('link', { name: /Joe’s Plumbing/ })).toHaveAttribute('href', `/presence.html?client=${CLIENT}#publish`);
    await page.keyboard.press('Escape');
    // "Your studio’s own site" in search opens it, asking nothing
    await page.locator('#dds-search').click();
    await page.getByRole('combobox', { name: 'Search' }).fill('own site');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/presence\.html$/);
    // Help's Your website card asks too
    await page.goto('/help.html');
    await page.locator('.setgrid .setcard', { hasText: 'Your website' }).click();
    await expect(page.getByRole('dialog', { name: 'Which client’s website?' })).toContainText('Editing a website is part of each client’s website');
    // a studio whose own site is live opens it, as before
    await installApp(page, { api: { '/portal/context': studioCtx({ site_live: true }), '/agency/sites': sites } });
    await page.goto('/help.html');
    await page.locator('.setgrid .setcard', { hasText: 'Your website' }).click();
    await expect(page).toHaveURL(/\/presence\.html$/);
    // inside a client a website link is that client's, so nothing is asked
    await installApp(page, { api: { '/portal/context': { data: { ...inClient().data, site_live: false } }, '/agency/sites': sites } });
    await page.goto(`/help.html?client=${CLIENT}`);
    await page.locator('.setgrid .setcard', { hasText: 'Your website' }).click();
    await expect(page).toHaveURL(new RegExp(`/presence\\.html\\?client=${CLIENT}`));
  });

  test('after Yes in an in-place question, focus stays on the button that asked', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.waitForFunction(() => !!(window as unknown as { ddsListKit?: unknown }).ddsListKit);
    await page.evaluate(() => { const b = document.createElement('button'); b.id = 'askme'; b.type = 'button'; b.textContent = 'Delete'; const m = document.getElementById('main') || document.body; m.insertBefore(b, m.firstChild); });   // in the page, clear of a phone's bottom bar
    const answer = page.evaluate(() => (window as unknown as { ddsListKit: { confirmIn: (a: Element | null, o: unknown) => Promise<boolean> } }).ddsListKit.confirmIn(document.getElementById('askme'), { text: 'Delete it?', yes: 'Yes, delete' }));
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    expect(await answer).toBe(true);
    await expect(page.locator('#askme')).toBeFocused();
  });
});

test.describe('Names (builder 202)', () => {
  test('inside a client, the Inbox page is their Messages, and the bell says so', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': inClient() } });
    await page.goto(`/inbox.html?client=${CLIENT}`);
    await expect(page).toHaveTitle('Messages — Joe’s Plumbing — Studio OS');
    await expect(page.locator('#inboxH1')).toHaveText('Messages');
    await page.locator('#dds-bell').click();
    await expect(page.locator('.dds-bell-pop .foot')).toHaveText('See everything in Messages →');
  });

  test('at studio level the Inbox keeps its name', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': studioCtx() } });
    await page.goto('/inbox.html');
    await expect(page).toHaveTitle('Inbox — Studio OS');
    await expect(page.locator('#inboxH1')).toHaveText('Inbox');
  });

  test('Settings for a business owner: Business profile, Services and prices, and Notifications holds the switch', async ({ page }) => {
    await installApp(page);   // a business owner, not a studio
    await page.goto('/settings.html');
    const cards = page.locator('#cards .setcard');
    // by its title (Connections' line names Google's "Business Profile")
    const titled = (t: string) => cards.filter({ has: page.locator('b', { hasText: new RegExp(`^${t}$`) }) });
    await expect(titled('Business profile')).toHaveCount(1);
    await expect(titled('Studio profile')).toHaveCount(0);
    await expect(titled('Services and prices')).toHaveAttribute('href', '/pipeline.html?services=1');
    await expect(titled('Invoices & agreements')).toHaveCount(0);
    await titled('Business profile').click();
    await expect(page.locator('#profileHead')).toHaveText('Business profile');
    await expect(page.locator('label[for="f-name"]')).toHaveText('Business name');
    const notify = titled('Notifications');
    await expect(notify).toHaveAttribute('href', '#notify');
    await notify.click();
    await expect(page).toHaveURL(/\/settings\.html/);   // never the Inbox, where there is nothing to switch
    await expect(page.locator('#notify')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Ring this device' })).toBeVisible();
  });

  test('Settings for a studio keeps Studio profile', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': studioCtx() } });
    await page.goto('/settings.html');
    const titled = (t: string) => page.locator('#cards .setcard').filter({ has: page.locator('b', { hasText: new RegExp(`^${t}$`) }) });
    await expect(titled('Studio profile')).toHaveCount(1);
    await expect(titled('Business profile')).toHaveCount(0);
  });

  test('search lists "Your plan" only for whoever can open it', async ({ page }) => {
    const nav = [...STUDIO_LEVEL_NAV, { key: 'settings', label: 'Settings', utility: true, items: [
      { key: 'settings', label: 'Settings', href: '/settings.html' },
      { key: 'plan', label: 'Your plan', href: '/settings.html#billing', hidden: true },
    ] }];
    // a team member: Settings hides the plan from them, so search doesn't offer it
    await installApp(page, { api: { '/portal/context': studioCtx({ nav, site_role: 'business_staff', capabilities: ['edit', 'view_all'] }) } });
    await page.goto('/agency.html');
    await page.locator('#dds-search').click();
    await page.getByRole('combobox', { name: 'Search' }).fill('plan');
    await expect(page.locator('.dds-palette .res', { hasText: 'Your plan' })).toHaveCount(0);
    // the account's owner still finds it
    await installApp(page, { api: { '/portal/context': studioCtx({ nav }) } });
    await page.goto('/agency.html');
    await page.locator('#dds-search').click();
    await page.getByRole('combobox', { name: 'Search' }).fill('plan');
    await expect(page.locator('.dds-palette .res', { hasText: 'Your plan' })).toHaveCount(1);
  });

  test('Help: the page box asks the same helper as the ? panel, and shows where it’s done', async ({ page }) => {
    const asked: string[] = [];
    await installApp(page);
    await page.route('**/functions/v1/presence/help/ask', (route) => {
      asked.push(route.request().postDataJSON().question);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { matched: true, id: 'enquiries', answer: 'A new enquiry from your website lands in your Inbox and your email.', links: [{ href: '/inbox.html#enquiries', label: 'Open your enquiries' }, { href: '/customers.html', label: 'Open Customers' }, { href: 'javascript:alert(1)', label: 'Not a place' }] } }) });
    });
    let concierge = 0;
    await page.route('**/functions/v1/presence/concierge/ask', (route) => { concierge++; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await page.goto('/help.html');
    await page.locator('#suggest button', { hasText: 'Where do enquiries go?' }).click();
    await expect(page.locator('#ans')).toContainText('A new enquiry from your website lands in your Inbox');
    await expect(page.locator('#ans .links a')).toHaveText(['Open your enquiries →', 'Open Customers →']);   // never a link that isn't one of our pages
    await expect(page.locator('#ans .links a').first()).toHaveAttribute('href', '/inbox.html#enquiries');
    expect(asked).toEqual(['Where do enquiries go?']);
    expect(concierge).toBe(0);
  });

  test('Help: each card opens the place it names', async ({ page }) => {
    await installApp(page);   // a business owner
    await page.goto('/help.html');
    const card = (t: string) => page.locator('.setgrid .setcard', { hasText: t });
    await expect(card('Customers and deals')).toHaveAttribute('href', '/customers.html');
    await expect(card('Invoices and payments')).toHaveAttribute('href', '/invoices.html');
    await expect(card('Client sites')).toBeHidden();   // a studio's card
    await card('Getting started').click();
    await expect(page.locator('#a-around')).toHaveAttribute('open', '');
    await expect(page.locator('#first-owner')).toBeVisible();
    await expect(page.locator('#first-owner')).toContainText('The first things to do');
    // a studio sees its own card and its own first steps
    await installApp(page, { api: { '/portal/context': studioCtx() } });
    await page.goto('/help.html');
    await expect(card('Client sites')).toBeVisible();
    await card('Getting started').click();
    await expect(page.locator('#first-studio')).toBeVisible();
    await expect(page.locator('#first-owner')).toBeHidden();
  });
});
