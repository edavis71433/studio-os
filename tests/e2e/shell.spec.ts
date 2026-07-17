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
    // …and each is a real LINK (anchor with an href), not just text in the panel
    for (const label of ['Today', 'Website', 'Business info', 'Design', 'Publish', 'History', 'Customers', 'Files', 'Visual Studio', 'Analytics', 'Inbox', 'Connections', 'Settings', 'Help']) {
      await expect(panel.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', /.+/);
    }
    // slice-2 popup contract: Escape closes and returns focus to the trigger
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(waffle).toBeFocused();
    await expect(waffle).toHaveAttribute('aria-expanded', 'false');
    // outside click closes too (a click anywhere that isn't the panel/trigger)
    await waffle.click();
    await expect(panel).toBeVisible();
    await page.evaluate(() => document.body.click());
    await expect(panel).toBeHidden();
    await expect(waffle).toHaveAttribute('aria-expanded', 'false');
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
    await expect(btn).toBeFocused();                         // a POINTER click leaves focus on the trigger (menu-button pattern)
    await page.keyboard.press('ArrowDown');                  // ArrowDown from the trigger enters the menu
    await expect(menu.locator('a').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('a').nth(1)).toBeFocused();    // arrows move
    await page.keyboard.press('ArrowUp');
    await expect(menu.locator('a').first()).toBeFocused();
    await page.keyboard.press('Escape');                     // Escape closes + returns focus
    await expect(menu).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');                      // a KEYBOARD invocation moves focus into the menu
    await expect(menu).toBeVisible();
    await expect(menu.locator('a').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await btn.click();
    await expect(menu).toBeVisible();
    await page.evaluate(() => document.body.click());        // outside click closes
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('focus Tabbing out of an open dropdown closes it without stealing focus back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the flat bar is hidden on phones');
    await installApp(page, { api: { '/portal/context': crmCtx() } });
    await page.goto('/today.html');
    const btn = page.locator('.dds-nav .sec > button[data-sec="customers"]');
    const menu = page.locator('.dds-nav .sec:has(button[data-sec="customers"]) .menu');
    await btn.click();
    await page.keyboard.press('ArrowDown');                  // enter the menu…
    await expect(menu.locator('a').first()).toBeFocused();
    // …Tab past the last item until focus leaves the section entirely
    const links = await menu.locator('a').count();
    for (let i = 0; i < links + 1; i++) await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();                         // closed on focus-out
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).not.toBeFocused();                     // focus was NOT stolen back
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
      // the record page renders the SAME name into #pagehead — shell.js's
      // trackCrmRecent poll (the second recents write path) then agrees with the
      // palette write byte-for-byte, so the entry is deterministic however the
      // poll races the assertions below.
      '/crm/record': { data: { header: { name: 'Lea Chan', status: 'customer' }, sections: { details: true }, identity: {} } },
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

  test('a Recent record is exempt from scope-carry — it navigates exactly as stored', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the caret dropdown is a desktop surface');
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await installApp(page, { api: {
      '/portal/context': { data: { ...crmCtx().data, is_agency: true, scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } } },
    } });
    // an UNSCOPED recent (cached while not drilled in) — must stay unscoped
    await page.addInitScript(() => localStorage.setItem('dds-recent-records',
      JSON.stringify([{ label: 'Nina Okafor', href: '/crm.html?contact=7', at: 1 }])));
    await page.goto(`/today.html?client=${CLIENT}`);
    await page.locator('.dds-nav .sec > button[data-sec="customers"]').click();
    const menu = page.locator('.dds-nav .sec:has(button[data-sec="customers"]) .menu');
    await expect(menu.locator('a.rec', { hasText: 'Nina Okafor' })).toBeVisible();
    // flush the scope-carry MutationObserver pass (rAF-debounced) before the
    // exactness assertion — the rewrite, if it ever happened, happens there
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // the recent's href is EXACTLY the stored one — no client= appended…
    await expect(menu.locator('a.rec', { hasText: 'Nina Okafor' })).toHaveAttribute('href', '/crm.html?contact=7');
    // …while regular nav links DO carry the drill-in scope
    await expect(menu.locator('a', { hasText: 'Contacts' }).first()).toHaveAttribute('href', `/contacts.html?client=${CLIENT}`);
  });

  test('corrupt recents storage (invalid JSON) never breaks the shell or the caret', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the caret dropdown is a desktop surface');
    await installApp(page, { api: { '/portal/context': crmCtx() } });
    await page.addInitScript(() => localStorage.setItem('dds-recent-records', 'not json {{{'));
    await page.goto('/today.html');
    await page.locator('.dds-nav .sec > button[data-sec="customers"]').click();
    const menu = page.locator('.dds-nav .sec:has(button[data-sec="customers"]) .menu');
    await expect(menu).toContainText('Quick actions');       // the menu still opens fine
    await expect(menu.locator('a.rec')).toHaveCount(0);      // no recent rendered
  });

  test('a hostile recents entry (javascript: href) is filtered out, never rendered', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the caret dropdown is a desktop surface');
    await installApp(page, { api: { '/portal/context': crmCtx() } });
    await page.addInitScript(() => localStorage.setItem('dds-recent-records',
      JSON.stringify([{ label: 'x', href: 'javascript:alert(1)' }])));
    await page.goto('/today.html');
    await page.locator('.dds-nav .sec > button[data-sec="customers"]').click();
    const menu = page.locator('.dds-nav .sec:has(button[data-sec="customers"]) .menu');
    await expect(menu).toContainText('Quick actions');
    await expect(menu.locator('a.rec')).toHaveCount(0);
    const hrefs = await menu.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') || ''));
    expect(hrefs.some((h) => h.trim().toLowerCase().startsWith('javascript:'))).toBe(false);
  });

  test('sign out clears the cached recent records (PII on shared machines)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'one width is enough for a storage check');
    await installApp(page);
    // seed ONCE (init scripts re-run on every navigation — an unguarded seed
    // would re-plant the key on the post-signout door page and mask the fix)
    await page.addInitScript(() => {
      if (sessionStorage.getItem('dds-e2e-recents-seeded')) return;
      sessionStorage.setItem('dds-e2e-recents-seeded', '1');
      localStorage.setItem('dds-recent-records', JSON.stringify([{ label: 'Lea Chan', href: '/crm.html?contact=7', at: 1 }]));
    });
    await page.goto('/today.html');
    await page.locator('#dds-profile').click();
    await page.locator('#dds-signout').click();
    // the key is removed synchronously in the click handler, before the redirect;
    // same-origin storage survives navigation, so it stays gone despite it. Poll
    // tolerantly — the sign-out redirect can destroy the evaluation context.
    await expect.poll(async () => {
      try { return await page.evaluate(() => localStorage.getItem('dds-recent-records')); }
      catch { return 'navigating'; }
    }).toBeNull();
  });

  test('layers are mutually exclusive: opening the bell closes the waffle panel and vice versa', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop layer behaviour');
    await installApp(page);
    await page.goto('/today.html');
    const waffle = page.locator('#dds-waffle');
    const bell = page.locator('#dds-bell');
    const panel = page.locator('#dds-drawer');
    const bellPop = page.locator('.dds-pop[aria-label="Notifications"]');
    await waffle.click();
    await expect(panel).toBeVisible();
    await bell.click();                                      // opening the bell…
    await expect(panel).toBeHidden();                        // …closes the waffle panel
    await expect(waffle).toHaveAttribute('aria-expanded', 'false');
    await expect(bellPop).toBeVisible();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await waffle.click();                                    // and vice versa
    await expect(bellPop).toBeHidden();
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeVisible();
    await expect(waffle).toHaveAttribute('aria-expanded', 'true');
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
    // Escape closes the sheet and hands focus back to the control that opened it
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(mbar.locator('#dds-mbar-menu')).toBeFocused();
    await expect(mbar.locator('#dds-mbar-menu')).toHaveAttribute('aria-expanded', 'false');
    // Menu toggles it open and closed again (aria-expanded tracks)
    await mbar.locator('#dds-mbar-menu').click();
    await expect(panel).toBeVisible();
    await mbar.locator('#dds-mbar-menu').click();
    await expect(panel).toBeHidden();
    // the waffle opens the same panel too
    await page.locator('#dds-waffle').click();
    await expect(panel).toBeVisible();
  });
});
