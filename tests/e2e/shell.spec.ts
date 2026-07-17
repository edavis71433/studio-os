import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── slice 7 fixtures: a nav whose Customers section is multi-item (the real
// buildNav shape) so the context bar renders it as label + dropdown caret.
const CRM_NAV = [
  { key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] },
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Website', href: '/presence.html' },
    { key: 'business_info', label: 'Business info', href: '/presence.html#business' },
  ] },
  { key: 'customers', label: 'Customers', items: [
    { key: 'customers', label: 'Customers', href: '/customers.html' },
    { key: 'leads', label: 'Enquiries', href: '/leads.html' },
    { key: 'contacts', label: 'Contacts', href: '/contacts.html' },
    { key: 'pipeline', label: 'Pipeline', href: '/pipeline.html' },
    { key: 'broadcasts', label: 'Broadcasts', href: '/broadcasts.html' },
  ] },
  { key: 'inbox', label: 'Inbox', items: [{ key: 'inbox', label: 'Inbox', href: '/inbox.html' }] },
  { key: 'settings', label: 'Settings', utility: true, items: [{ key: 'settings', label: 'Settings', href: '/presence.html#settings' }] },
];
const crmCtx = () => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: CRM_NAV,
} });

// The one application shell (shell.js) — on every signed-in page. It draws nav,
// the ⌘K palette, the unified notification bell + attention badge, and profile.
test.describe('App shell', () => {
  test('signed-in: brand, nav sections, search, attention badge, profile', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const shell = page.locator('#dds-shell');
    await expect(shell.locator('.dds-brand')).toContainText('Studio OS');
    await expect(shell.locator('.dds-nav')).toContainText('Website');
    await expect(shell.locator('.dds-nav')).toContainText('Customers');
    await expect(shell.locator('.dds-nav')).toContainText('Inbox');
    await expect(page.locator('#dds-search')).toContainText('Search');
    // the attention badge reflects context.attention_count (2)
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
    await expect(page.locator('#dds-profile')).toBeVisible();
  });

  test('bell opens the unified feed — notices first, then approvals (Phase FLOW/OS)', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-pop');
    await expect(pop).toContainText('Needs a look');
    await expect(pop).toContainText('A quote request is waiting for a reply'); // the notice
    await expect(pop).toContainText('Waiting for approval');                    // the pending approval
  });

  test('⌘K command palette opens, filters, and targets the right destination', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    // the ⌘K listener is wired when the shell renders (after /portal/context) —
    // wait for the shell's search control before pressing, or the key is lost.
    await expect(page.locator('#dds-search')).toBeVisible();
    await page.keyboard.press('Control+k');
    const pal = page.locator('.dds-palette');
    await expect(pal).toBeVisible();
    await pal.locator('input').fill('Design');
    await expect(pal.locator('.res.sel')).toHaveAttribute('href', '/presence.html#design');
  });

  test('profile menu exposes sign out', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.locator('#dds-profile').click();
    await expect(page.locator('.dds-pop')).toContainText('Sign out');
  });

  test('Architecture v1.0: primary bar is outcomes; utilities live in the profile menu', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const nav = page.locator('#dds-shell .dds-nav');
    await expect(nav).toContainText('Analytics');            // Analytics is first-class
    await expect(nav).not.toContainText('Settings');         // utilities are NOT in the primary bar
    await expect(nav).not.toContainText('Connections');
    await page.locator('#dds-profile').click();
    const pop = page.locator('.dds-pop');
    await expect(pop).toContainText('Settings');             // …they live in the overflow menu
    await expect(pop).toContainText('Connections');
    await expect(pop).toContainText('Help');
  });

  test('no attention → no badge', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
      edition_features: ['website', 'business_moments', 'connected', 'ai', 'relationship', 'client_portal', 'reports'],
      is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'view_all'],
      landing: '/today.html', attention_count: 0,
      nav: [{ key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] }],
    } } } });
    await page.goto('/today.html');
    await expect(page.locator('#dds-bell')).toBeVisible();
    await expect(page.locator('#dds-bell .dot')).toHaveCount(0);
  });

  test('signed-out: shell degrades to brand + sign-in, no nav or search', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/today.html');
    await expect(page.locator('#dds-shell .dds-brand')).toContainText('Studio OS');
    await expect(page.locator('.dds-nav')).toHaveCount(0);
    await expect(page.locator('#dds-search')).toHaveCount(0);
    await expect(page.locator('#dds-waffle')).toHaveCount(0); // no App Launcher signed out
  });
});

// ── Slice 7 — the Lightning context bar ──────────────────────────────────────
test.describe('Context bar (slice 7)', () => {
  test('waffle App Launcher opens the full destination list, Escape/outside click close it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop popover behaviour; mobile covered below');
    await installApp(page);
    await page.goto('/today.html');
    const waffle = page.locator('#dds-waffle');
    await expect(waffle).toBeVisible();
    await expect(waffle).toHaveAttribute('aria-expanded', 'false');
    await waffle.click();
    const panel = page.locator('#dds-drawer');
    await expect(panel).toBeVisible();
    await expect(waffle).toHaveAttribute('aria-expanded', 'true');
    // EVERY destination is reachable here, grouped by section — primary AND utility
    for (const label of ['Today', 'Website', 'Business info', 'Design', 'Publish', 'History', 'Customers', 'Files', 'Visual Studio', 'Analytics', 'Inbox', 'Connections', 'Settings', 'Help']) {
      await expect(panel).toContainText(label);
    }
    // slice-2 popup contract: Escape closes and returns focus to the trigger
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(waffle).toBeFocused();
    // outside click closes too (a click anywhere that isn't the panel/trigger)
    await waffle.click();
    await expect(panel).toBeVisible();
    await page.evaluate(() => document.body.click());
    await expect(panel).toBeHidden();
  });

  test('waffle panel links carry the operator drill-in scope', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'one width is enough for href checks');
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await installApp(page, { api: {
      '/portal/context': { data: {
        site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
        edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
        capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
        scope: { site_id: CLIENT, name: 'Joe’s Plumbing' },
      } },
    } });
    await page.goto(`/today.html?client=${CLIENT}`);
    await page.locator('#dds-waffle').click();
    const inboxLink = page.locator('#dds-drawer a[href^="/inbox.html"]');
    await expect(inboxLink).toHaveAttribute('href', `/inbox.html?client=${CLIENT}`);
  });

  test('a multi-item section is a caret dropdown: click opens, arrows move, Escape returns focus, outside click closes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the flat bar is hidden on phones');
    await installApp(page, { api: { '/portal/context': crmCtx() } });
    await page.goto('/today.html');
    const btn = page.locator('.dds-nav .sec > button[data-sec="customers"]');
    const menu = page.locator('.dds-nav .sec:has(button[data-sec="customers"]) .menu');
    await expect(btn).toHaveAttribute('aria-haspopup', 'true');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();                                       // CLICK-invoked, never hover
    await expect(menu).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('a').first()).toBeFocused();   // opening focuses the first item
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('a').nth(1)).toBeFocused();    // arrows move
    await page.keyboard.press('ArrowUp');
    await expect(menu.locator('a').first()).toBeFocused();
    await page.keyboard.press('Escape');                     // Escape closes + returns focus
    await expect(menu).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(menu).toBeVisible();
    await page.evaluate(() => document.body.click());        // outside click closes
    await expect(menu).toBeHidden();
  });

  test('the Customers caret lists quick actions (+ New deal → pipeline, + Contact → contacts)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the flat bar is hidden on phones');
    await installApp(page, { api: { '/portal/context': crmCtx() } });
    await page.goto('/today.html');
    await page.locator('.dds-nav .sec > button[data-sec="customers"]').click();
    const menu = page.locator('.dds-nav .sec:has(button[data-sec="customers"]) .menu');
    await expect(menu).toContainText('Quick actions');
    await expect(menu.locator('a.qa', { hasText: '+ New deal' })).toHaveAttribute('href', '/pipeline.html');
    await expect(menu.locator('a.qa', { hasText: '+ Contact' })).toHaveAttribute('href', '/contacts.html');
  });

  test('active item gets the underline treatment on each page (aria-current marks it)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the flat bar is hidden on phones');
    await installApp(page, { api: { '/portal/context': crmCtx() } });
    // a single-link section: Inbox is the active flat item on inbox.html
    await page.goto('/inbox.html');
    await expect(page.locator('.dds-nav .sec.active > a[data-href="/inbox.html"]')).toHaveAttribute('aria-current', 'page');
    // a multi-item section: leads.html lights the Customers item (child match)
    await page.goto('/leads.html');
    await expect(page.locator('.dds-nav .sec.active > button[data-sec="customers"]')).toHaveAttribute('aria-current', 'true');
    // the record page is never IN the nav — it still lights Customers
    await page.goto('/crm.html?client_id=c-1');
    await expect(page.locator('.dds-nav .sec.active > button[data-sec="customers"]')).toBeVisible();
    // …and only ONE item is ever lit
    await expect(page.locator('.dds-nav .sec.active')).toHaveCount(1);
  });

  test('a ⌘K record selection lands in the Customers caret as a Recent record', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the caret dropdown is a desktop surface');
    await installApp(page, { api: {
      '/portal/context': crmCtx(),
      '/crm/search': { data: { results: [{ label: 'Lea Chan', href: '/crm.html?client_id=c-lea', sub: 'Customer' }] } },
    } });
    await page.goto('/today.html');
    await expect(page.locator('#dds-search')).toBeVisible();
    await page.keyboard.press('Control+k');
    const pal = page.locator('.dds-palette');
    await pal.locator('input').fill('lea');
    const rec = pal.locator('.res[data-rec-label="Lea Chan"]');
    await expect(rec).toBeVisible();
    await rec.click();                                        // selecting caches the record…
    await page.waitForURL('**/crm.html**');
    const cached = await page.evaluate(() => localStorage.getItem('dds-recent-records') || '');
    expect(cached).toContain('Lea Chan');
    // …and the Customers caret now shows it under "Recent"
    await page.goto('/today.html');
    await page.locator('.dds-nav .sec > button[data-sec="customers"]').click();
    const menu = page.locator('.dds-nav .sec:has(button[data-sec="customers"]) .menu');
    await expect(menu).toContainText('Recent');
    await expect(menu.locator('a.rec', { hasText: 'Lea Chan' })).toHaveAttribute('href', '/crm.html?client_id=c-lea');
  });

  test('mobile: the bottom bar is unchanged and the waffle panel is the mobile nav', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone-only behaviour');
    await installApp(page);
    await page.goto('/today.html');
    // the bottom bar: Home · Inbox (badge) · Menu — exactly as before slice 7
    const mbar = page.locator('#dds-mbar');
    await expect(mbar).toBeVisible();
    await expect(mbar.locator('a[href^="/today"]')).toContainText('Home');
    await expect(mbar.locator('a[href^="/inbox"]')).toContainText('Inbox');
    await expect(mbar.locator('.mdot')).toHaveText('2');       // attention badge intact
    // the flat items hide; the waffle stays in the top bar
    await expect(page.locator('.dds-nav')).toBeHidden();
    await expect(page.locator('#dds-waffle')).toBeVisible();
    // Menu opens the SAME full-capability panel the burger sheet used to hold
    await mbar.locator('#dds-mbar-menu').click();
    const panel = page.locator('#dds-drawer');
    await expect(panel).toBeVisible();
    for (const label of ['Today', 'Website', 'Business info', 'Customers', 'Files', 'Visual Studio', 'Analytics', 'Inbox', 'Settings', 'Help']) {
      await expect(panel).toContainText(label);
    }
    // Menu toggles it closed again (aria-expanded tracks)
    await mbar.locator('#dds-mbar-menu').click();
    await expect(panel).toBeHidden();
    // the waffle opens the same panel too
    await page.locator('#dds-waffle').click();
    await expect(panel).toBeVisible();
  });
});
