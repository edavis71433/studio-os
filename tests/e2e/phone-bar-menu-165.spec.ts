import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV, CLIENT_NAV } from './helpers/app';
import { installIosFocusSemantics } from './helpers/ios-focus';

// Builder item 165 (Nov 2026; review file 05, finding 8; drawn in Figma 296:29).
// Websites are a third of the product, and on a phone they were two taps away,
// behind a nine-dot button that screen readers and the tour called "App Launcher".
// The bar is now Home · Sites · + · Inbox · Menu for a studio, Overview · Website ·
// Messages · Menu inside a client, and Home · Website · Inbox · Menu for an owner
// running their own site (the drawing gives them a + too; Create is a studio's for now). Menu (the word, everywhere) opens the whole list as a sheet:
// the same places as the sidebar on a computer, Pipeline and Customers included.

const SITES = { key: 'sites', label: 'Sites', items: [
  { key: 'sites', label: 'Sites', href: '/sites.html' },
  { key: 'domains', label: 'Domains', href: '/domains.html', hidden: true },
] };
// a studio's menu as lib/navigation.ts draws it: Sites second
const STUDIO_MENU = [STUDIO_LEVEL_NAV[0], SITES, ...STUDIO_LEVEL_NAV.slice(1)];
const studio = (extra: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 3, nav: STUDIO_MENU, plan_key: 'presence', upsell: null, scope: null, ...extra,
} });
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const API = { '/identity': { data: { business_name: 'Bright Studio' } }, '/settings': { data: {} } };
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 761;
// what the bar shows, in order: an id where it has one, else its words
const barItems = (page: Page) => page.locator('#dds-mbar > a, #dds-mbar > button').evaluateAll((els) => els.map((e) => e.id || (e.textContent || '').replace(/\s+\d+\+?$/, '').trim()));

test.describe('Websites on a phone, without the App Launcher (builder item 165)', () => {
  test('a studio’s bar: Home · Sites · + · Inbox · Menu, and the top bar has no second Menu', { tag: '@layout' }, async ({ page }) => {
    test.skip(!isPhone(page), 'the bottom bar is phones-only');
    await installApp(page, { api: { ...API, '/portal/context': studio() } });
    await page.goto('/settings.html');
    const bar = page.locator('#dds-mbar');
    await expect(bar).toBeVisible();
    expect(await barItems(page)).toEqual(['Home', 'Sites', 'dds-mbar-create', 'Inbox', 'dds-mbar-menu']);
    await expect(bar.locator('a[data-mbar="sites"]')).toHaveAttribute('href', '/sites.html');
    await expect(bar.locator('a[data-mbar="sites"] svg.nic')).toHaveCount(1);
    await expect(bar.locator('#dds-mbar-menu')).toHaveText('Menu');
    await expect(bar.locator('a[data-mbar="inbox"] .mdot')).toHaveText('3');
    await expect(page.locator('#dds-waffle')).toBeHidden();
    // five even places, none wider than the screen
    const vw = page.viewportSize()!.width;
    for (const b of await bar.locator('> a, > button').all()) {
      const box = (await b.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('Menu opens the whole list as a sheet — the sidebar’s places, Pipeline and Customers included', { tag: '@layout' }, async ({ page }) => {
    test.skip(!isPhone(page), 'the phone sheet');
    await installApp(page, { api: { ...API, '/portal/context': studio() } });
    await page.goto('/settings.html');
    const menu = page.locator('#dds-mbar-menu');
    const sheet = page.locator('#dds-drawer');
    await menu.click();
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('aria-label', 'Menu');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(sheet.locator('.dh')).toHaveText('Menu');
    await expect(sheet.locator('.g a')).toHaveText(['Home', 'Sites', 'Inbox', 'Customers', 'Pipeline', 'Projects', 'Files', 'Your website', 'Settings']);
    await expect(sheet.locator('.g a svg.nic')).toHaveCount(9);                       // a row per place, each with its icon
    await expect(sheet.locator('.g a[aria-current="page"]')).toHaveText('Settings');  // where you are
    await sheet.locator('.dsheet').evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    // the sheet rises from the bottom and ends where the bar begins; the bar stays on top
    const sh = (await sheet.locator('.dsheet').boundingBox())!, b = (await page.locator('#dds-mbar').boundingBox())!;
    expect(Math.abs(sh.y + sh.height - b.y)).toBeLessThanOrEqual(1);
    for (const row of await sheet.locator('.g a').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // the page above is dimmed: a tap there only closes the sheet (nothing underneath is pressed)
    await page.mouse.click(20, 80);
    await expect(sheet).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(new URL(page.url()).pathname).toBe('/settings.html');
    // Menu closes what it opened, and Escape hands focus back to it
    await menu.click();
    await expect(sheet).toBeVisible();
    await menu.click();
    await expect(sheet).toBeHidden();
    await menu.click();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(menu).toBeFocused();
    // a row goes where it says
    await menu.click();
    await sheet.getByRole('link', { name: 'Pipeline', exact: true }).click();
    await page.waitForURL(/\/pipeline\.html/);
  });

  test('a tap on a row of the sheet reaches it (iOS blur semantics)', { tag: '@touch' }, async ({ page }) => {
    test.skip(!isPhone(page), 'touch + the phone sheet');
    await installApp(page, { api: { ...API, '/portal/context': studio() } });
    await installIosFocusSemantics(page);
    await page.goto('/settings.html');
    await page.locator('#dds-mbar-menu').tap();
    const row = page.locator('#dds-drawer').getByRole('link', { name: 'Customers', exact: true });
    await expect(row).toBeVisible();
    await row.tap();
    await page.waitForURL(/\/customers\.html/);
  });

  test('inside a client: Overview · Website · Messages · Menu, and Menu holds the client’s places', { tag: '@layout' }, async ({ page }) => {
    test.skip(!isPhone(page), 'the bottom bar is phones-only');
    await installApp(page, { api: { ...API, '/portal/context': studio({ nav: CLIENT_NAV, scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } }) } });
    await page.goto(`/today.html?client=${CLIENT}`);
    expect(await barItems(page)).toEqual(['Overview', 'Website', 'Messages', 'dds-mbar-menu']);
    await expect(page.locator('#dds-mbar a[data-mbar="website"]')).toHaveAttribute('href', `/presence.html?client=${CLIENT}`);
    await expect(page.locator('#dds-mbar-create')).toHaveCount(0);   // no Create inside a client
    await page.locator('#dds-mbar-menu').click();
    await expect(page.locator('#dds-drawer .g a')).toHaveText(['Overview', 'Website', 'Record', 'Project', 'Messages', 'Files']);
  });

  test('an owner running their own site: Home · Website · Inbox · Menu', { tag: '@layout' }, async ({ page }) => {
    test.skip(!isPhone(page), 'the bottom bar is phones-only');
    await installApp(page);   // a business owner
    await page.goto('/today.html');
    expect(await barItems(page)).toEqual(['Home', 'Website', 'Inbox', 'dds-mbar-menu']);
    await expect(page.locator('#dds-mbar a[data-mbar="website"]')).toHaveAttribute('href', '/presence.html');
    await expect(page.locator('#dds-mbar a[data-mbar="home"]')).toHaveAttribute('aria-current', 'page');
  });

  test('a studio that hid Sites in Your menu: no Sites on the bar either', async ({ page }) => {
    test.skip(!isPhone(page), 'the bottom bar is phones-only');
    const nav = STUDIO_MENU.map((s) => s.key === 'sites' ? { ...s, items: s.items.map((i) => ({ ...i, hidden: true })) } : s);
    await installApp(page, { api: { ...API, '/portal/context': studio({ nav }) } });
    await page.goto('/settings.html');
    expect(await barItems(page)).toEqual(['Home', 'dds-mbar-create', 'Inbox', 'dds-mbar-menu']);
  });

  test('on a computer and an iPad, the sidebar’s button is called Menu and opens the same list', { tag: '@layout' }, async ({ page }) => {
    test.skip(isPhone(page), 'the sidebar shows ≥761px');
    await installApp(page, { api: { ...API, '/portal/context': studio() } });
    await page.goto('/settings.html');
    const btn = page.locator('#dds-waffle');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-label', 'Menu');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(1);
    await btn.click();
    const panel = page.locator('#dds-drawer');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.g a')).toHaveText(['Home', 'Sites', 'Inbox', 'Customers', 'Pipeline', 'Projects', 'Files', 'Your website', 'Settings']);
    await expect(panel.locator('.dh')).toBeHidden();   // the popover sits under its button; the phone sheet carries the title
    for (const ic of await panel.locator('.g a svg.nic').all()) expect((await ic.boundingBox())!.width).toBeLessThanOrEqual(20);
  });

  test('nobody says "App Launcher" any more: the shell, screen readers and the tour say Menu', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': studio() } });
    // the first-login tour runs for this role (installApp marks every role seen)
    await page.addInitScript(() => { try { localStorage.removeItem('dds-toured:business_owner'); } catch { /* */ } });
    await page.goto('/settings.html');
    const card = page.locator('.dds-tour-card');
    await expect(card).toBeVisible();
    const titles: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = (await card.locator('#dds-tour-t').textContent()) || '';
      titles.push(t);
      if (t === 'Menu') {
        // the ring sits on the Menu that shows here: the bar's on a phone, the sidebar's elsewhere
        const target = page.locator(isPhone(page) ? '#dds-mbar-menu' : '#dds-waffle');
        // the ring glides from the last step: measure once it has landed
        await expect.poll(async () => {
          const tb = (await target.boundingBox())!, rb = (await page.locator('.dds-tour-ring').boundingBox())!;
          return Math.max(Math.abs((rb.x + rb.width / 2) - (tb.x + tb.width / 2)), Math.abs((rb.y + rb.height / 2) - (tb.y + tb.height / 2)));
        }).toBeLessThanOrEqual(2);
        await expect(card.locator('#dds-tour-p')).toContainText('Menu opens the whole list of places');
      }
      if ((await card.locator('.next').textContent()) === 'Done') break;
      await card.locator('.next').click();
    }
    expect(titles).toContain('Menu');
    expect(titles).not.toContain('App Launcher');
    await card.locator('.next').click();
    await expect(card).toBeHidden();
    expect(await page.evaluate(() => document.body.innerHTML.includes('App Launcher'))).toBe(false);
  });

  test('the open sheet has no serious or critical accessibility findings, light and dark', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, in Chromium at a phone’s width');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: { ...API, '/portal/context': studio() } });
      await page.goto('/settings.html');
      await page.locator('#dds-mbar-menu').click();
      await expect(page.locator('#dds-drawer')).toBeVisible();
      await page.locator('#dds-drawer .dsheet').evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('#dds-drawer').include('#dds-mbar').analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    }
  });
});
