import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Runs in all three projects (desktop / tablet / mobile). The body must never
// scroll sideways, and the core content must render at every width.

// A roster with the kind of values that actually set a table's minimum width:
// a long company name, a long email, a formatted phone.
const CONTACTS = { data: [
  { id: 'ct-1', name: 'Claud Beltran', email: 'claud.beltran@gmail.com', phone: '(626) 234-6081', company: 'Bacchus Kitchen + Wine Bar', updated_at: new Date(Date.now() - 3 * 86400000).toISOString() },
  { id: 'ct-2', name: 'Hettie Smith', email: 'hettie@smithandcompany.example.com', phone: '(310) 555-0134', company: 'Smith & Co', updated_at: new Date(Date.now() - 9 * 86400000).toISOString() },
] };
const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'accounts@acmebakery.example.com', project_id: 'p1', project_name: 'Site refresh', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
] };

const pinTables = (page: Page) => page.addInitScript(() => {
  try {
    localStorage.setItem('dds-display:contacts', 'table');
    localStorage.setItem('dds-display:customers', 'table');
  } catch { /* storage denied */ }
});

test.describe('Responsive layout', () => {
  // ── every page whose .wrap adopted a width tier ────────────────────────────
  // A page that gained width must not have gained a sideways body scroll with
  // it. Eric is on his phone constantly; a horizontal body scroll there is the
  // regression this whole change is most able to cause, so it is asserted for
  // every page touched, in every project (390 / 810 / 1280).
  const TIERED = [
    '/get-started.html', '/schedule.html', '/sharing.html',           // form
    '/help.html', '/visual-studio.html', '/broadcasts.html',          // focused
    '/connections.html', '/leads.html',
    '/today.html', '/crm.html', '/pipeline.html', '/developer.html',  // working
    '/contacts.html', '/customers.html', '/projects.html',            // data
    '/files.html', '/admin-health.html', '/agency.html', '/analytics.html',
  ];
  for (const path of TIERED) {
    test(`${path} has no horizontal overflow`, async ({ page }) => {
      await pinTables(page);
      await installApp(page, { api: { '/sales/contacts': CONTACTS, '/studio/customers': CUSTOMERS } });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls the body sideways`).toBeLessThanOrEqual(1); // sub-pixel rounding tolerance
    });
  }

  test('Today renders its heading and content at this viewport', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('header h1')).toBeVisible();
    await expect(page.locator('.moment.todo').first()).toBeVisible();
  });
});

// ── the roster tables: the action column is REACHABLE ────────────────────────
// Eric's screenshot: the contacts table scrolling sideways inside a 920px
// column with Delete clipped to "Del". At a normal desktop width the table must
// need no sideways scroll at all, and Delete must be fully inside the visible
// box of its own scroll container.
test.describe('Roster action column', () => {
  test.skip(({ viewport }) => !viewport || viewport.width < 1000, 'desktop widths only');

  for (const [path, action] of [['/contacts.html', 'Delete'], ['/customers.html', 'Manage their website']] as const) {
    test(`${path} — the table fits and its last action is fully visible`, async ({ page }) => {
      await pinTables(page);
      await installApp(page, { api: { '/sales/contacts': CONTACTS, '/studio/customers': CUSTOMERS } });
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const scroller = page.locator('.tscroll');
      await expect(scroller).toBeVisible();

      // 1. no sideways scroll inside the container at this width
      const slop = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(slop, 'the table still scrolls sideways inside .tscroll').toBeLessThanOrEqual(1);

      // 2. the action is not clipped: its box sits inside the container's box
      const btn = page.locator('tbody tr').first().getByRole('button', { name: action });
      await expect(btn).toBeVisible();
      const fits = await scroller.evaluate((el, sel) => {
        const b = el.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
        const c = el.getBoundingClientRect();
        return b.left >= c.left - 1 && b.right <= c.right + 1;
      }, `tbody tr .rowact${action === 'Delete' ? '.danger' : ''}`);
      expect(fits, `"${action}" is clipped by its scroll container`).toBe(true);
    });
  }
});
