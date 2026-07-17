import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Accessibility — automated axe scan (WCAG 2 A/AA) plus the keyboard + ARIA
// basics of the shared shell. Only runs on the desktop project (one scan is
// enough; layout-per-viewport is covered by responsive.spec).
test.describe('Accessibility', () => {
  // hook form: (fixtures, testInfo) is stable across Playwright versions, while
  // the skip-predicate second argument was dropped in newer majors.
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop'); });

  for (const path of ['/today.html', '/leads.html', '/client.html']) {
    test(`no serious/critical axe violations on ${path}`, async ({ page }) => {
      // client.html needs a reviewer context to render its feed
      const api = path === '/client.html' ? {
        '/portal/context': { data: { site_role: 'client_reviewer', sees_full_workspace: false, is_client_portal: true, edition_key: 'studio_os', edition_features: ['website', 'client_portal'], attention_count: 0, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }] } },
        '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } },
      } : {};
      await installApp(page, { api });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    });
  }

  // Slice 7 surfaces get scanned OPEN — a closed popover is display:none and
  // invisible to axe, so these are the only scans that actually cover them.
  test('no serious/critical axe violations with the App Launcher panel open (leads.html)', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await page.waitForLoadState('networkidle');
    await page.locator('#dds-waffle').click();
    await expect(page.locator('#dds-drawer')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });

  test('no serious/critical axe violations with the Customers dropdown open (leads.html)', async ({ page }) => {
    // a multi-item Customers section (the real buildNav shape) so the context
    // bar renders the caret dropdown under test
    const nav = [
      { key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] },
      { key: 'customers', label: 'Customers', items: [
        { key: 'customers', label: 'Customers', href: '/customers.html' },
        { key: 'leads', label: 'Enquiries', href: '/leads.html' },
        { key: 'contacts', label: 'Contacts', href: '/contacts.html' },
        { key: 'pipeline', label: 'Pipeline', href: '/pipeline.html' },
      ] },
      { key: 'inbox', label: 'Inbox', items: [{ key: 'inbox', label: 'Inbox', href: '/inbox.html' }] },
    ];
    await installApp(page, { api: { '/portal/context': { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
      edition_features: ['website', 'forms', 'relationship', 'reports'], is_agency: false, is_operator: false,
      sees_full_workspace: true, capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html',
      attention_count: 0, nav,
    } } } });
    await page.goto('/leads.html');
    await page.waitForLoadState('networkidle');
    await page.locator('.dds-nav .sec > button[data-sec="customers"]').click();
    await expect(page.locator('.dds-nav .sec.open .menu')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });

  test('shell controls carry accessible names', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
    // the App Launcher waffle (slice 7: the burger's successor) shows at every
    // width and carries its accessible name.
    await expect(page.locator('#dds-waffle')).toHaveAttribute('aria-label', 'App Launcher');
    await expect(page.getByRole('button', { name: 'App Launcher' })).toBeVisible();
    await expect(page.getByLabel('Search')).toBeVisible();
  });

  test('keyboard: the command palette is reachable and Escapable', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    // the ⌘K listener is wired when the shell renders (after /portal/context) —
    // wait for the shell's search control before pressing, or the key is lost.
    await expect(page.locator('#dds-search')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.locator('.dds-palette')).toBeVisible();
    // the palette moves focus into its input shortly after opening; Escape is
    // handled there — wait for the focus hand-off before pressing it.
    await expect(page.locator('.dds-palette input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dds-palette')).toBeHidden();
  });
});
