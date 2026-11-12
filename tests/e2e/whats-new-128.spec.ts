import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// ── What's new (builder list item 128, Nov 2026) ──
// A sparkle beside the bell opens each week's changes to the tools, a picture and a
// sentence each, newest first, with Show me. A studio reads every entry, a business
// running its own site the ones that touch it, and a client finds them at the top of the
// portal's Help tab as New in your portal, in words written for clients. A dot says there
// is something this device hasn't seen; nothing opens by itself. The entries here are
// this file's own, dated from today, so the weeks always read the same.

const day = (offset: number) => { const t = new Date(Date.now() + offset * 86400000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const monday = (() => { const t = new Date(); return -((t.getDay() + 6) % 7); })();   // days back to this week's Monday
const PIC = '/thumbs/whats-new/search-todo.jpg';
const ENTRIES = { entries: [
  { id: 'todo', date: day(monday), who: ['studio', 'owner'], title: 'Your Search tab is a to-do list', sentence: 'What would help you show up on Google, most important first.', picture: PIC, alt: 'The Search tab’s to-do list', show: '/presence.html#search' },
  { id: 'sites', date: day(monday), who: ['studio'], title: 'Every site’s numbers on Sites', sentence: 'Health, visits and Google clicks on every site.', picture: PIC, alt: 'The Sites table', show: '/sites.html' },
  { id: 'portal', date: day(monday - 1), who: ['studio', 'client'], title: 'The client portal’s new look', sentence: 'Four tabs and one Messages door.', picture: PIC, alt: 'A sample portal', show: '/presence.html#clientview',
    client: { title: 'Every conversation with your studio is now in Messages', sentence: 'Your documents are on one shelf.', show: '/client.html' } },
  { id: 'editor', date: day(monday - 3), who: ['studio', 'owner'], title: 'Edit site has a new look', sentence: 'One floating bar on top.', picture: PIC, alt: 'Edit site', show: '/presence.html#design' },
] };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const entries = (page: Page) => page.route(/\/whats-new\.json(\?.*)?$/, (r: Route) => r.fulfill(json(ENTRIES)));
const panel = (page: Page) => page.locator('.wn[role="dialog"]');

async function openOwner(page: Page) {
  await entries(page);
  await installApp(page);
  await page.goto('/today.html');
  await expect(page.locator('#dds-bell')).toBeVisible();
}
async function openStudio(page: Page) {
  await entries(page);
  const NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
  await installApp(page, { api: {
    '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['view_all'], landing: '/sites.html', attention_count: 0, nav: NAV } },
    '/agency/sites': { data: [], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90 },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  } as never });
  await page.route(/\/functions\/v1\/presence\/agency\/site-numbers$/, (r: Route) => r.fulfill(json({ data: {}, month: '2026-10', prior_month: '2026-09', month_label: 'October', prior_label: 'September', partial: false })));
  await page.goto('/sites.html');
  await expect(page.locator('#dds-bell')).toBeVisible();
}
const narrow = (page: Page) => page.viewportSize()!.width <= 420;
async function openPanel(page: Page) {
  if (narrow(page)) {
    await page.locator('#dds-profile').click();
    await page.locator('#dds-new-row').click();
  } else await page.locator('#dds-new').click();
  await expect(panel(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
});
test.afterEach(async ({ page }) => { expect((page as unknown as { __errors: string[] }).__errors).toEqual([]); });

test.describe('What’s new', () => {
  test('a business: the changes that touch its site, by week, a picture and a sentence each, with Show me', async ({ page }) => {
    await openOwner(page);
    await openPanel(page);
    const p = panel(page);
    await expect(p.locator('h2')).toHaveText('What’s new');
    await expect(p.locator('.wn-sub')).toHaveText('Changes to your tools, a picture and a sentence each. New ones every week.');
    await expect(p.locator('.wn-week')).toHaveText([/^This week · /, /^Last week · /]);
    await expect(p.locator('.wn-card h4')).toHaveText(['Your Search tab is a to-do list', 'Edit site has a new look']);   // not the studio's Sites, not the portal's
    const first = p.locator('.wn-card').first();
    await expect(first.locator('img.wn-pic')).toHaveAttribute('alt', 'The Search tab’s to-do list');
    await expect(first.getByRole('link', { name: /Show me/ })).toHaveAttribute('href', '/presence.html#search');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });

  test('Escape closes it and puts you back where you were', async ({ page }) => {
    await openOwner(page);
    await openPanel(page);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator(narrow(page) ? '#dds-profile' : '#dds-new')).toBeFocused();
  });

  test('the dot: something this device hasn’t seen, gone once the panel opens, and still gone after a reload', async ({ page }) => {
    test.skip(narrow(page), 'a narrow phone has the account menu’s row instead of the button');
    await openOwner(page);
    await expect(page.locator('#dds-new .wn-dot')).toBeVisible();
    await expect(page.locator('#dds-new')).toHaveAttribute('aria-label', 'What’s new, with something you haven’t seen');
    await openPanel(page);
    await page.locator('.wn-x').click();
    await expect(page.locator('#dds-new .wn-dot')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#dds-new')).toBeVisible();
    await page.waitForTimeout(1600);   // the dot is drawn once the page has settled
    await expect(page.locator('#dds-new .wn-dot')).toHaveCount(0);
    await expect(page.locator('#dds-new')).toHaveAttribute('aria-label', 'What’s new');
  });

  test('a studio reads every entry', async ({ page }) => {
    await openStudio(page);
    await openPanel(page);
    await expect(panel(page).locator('.wn-card h4')).toHaveText(['Your Search tab is a to-do list', 'Every site’s numbers on Sites', 'The client portal’s new look', 'Edit site has a new look']);
  });

  test('nothing opens by itself', async ({ page }) => {
    await openOwner(page);
    await page.waitForTimeout(1600);
    await expect(panel(page)).toHaveCount(0);
  });

  test('a phone gets it in the account menu when the bar is narrow, and the panel fills the screen', async ({ page }) => {
    test.skip(!narrow(page), 'wider screens have the button beside the bell');
    await openOwner(page);
    await expect(page.locator('#dds-new')).toBeHidden();
    await openPanel(page);
    const box = (await panel(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  });
});

test.describe('New in your portal', () => {
  test('it tops the portal’s Help tab, in words written for clients, and never shows a studio’s entry', async ({ page }) => {
    await entries(page);
    const PID = '11111111-1111-4111-8111-111111111111';
    await installApp(page, { api: {
      '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
        is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0, nav: [], studio: { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false }, client_first_name: 'Maria' } },
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/client/notifications': { data: [], unread_count: 0 },
      '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
      [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
      [`/client/projects/${PID}/report`]: { data: { summary: null } }, [`/client/projects/${PID}/messages`]: { data: [] },
      '/client/documents': { data: { documents: [] } }, '/client/billing': { data: { invoices: [] } }, '/client/reports': { data: { reports: [] } },
      '/client/support': { data: [] }, '/client/faq': { data: { html: '', faq: { items: [] } } }, '/client/kit': { data: null },
    } as never });
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="help"]').click();
    const door = page.locator('#helpWhatsNew');
    await expect(door).toBeVisible();
    await expect(door).toContainText('New in your portal');
    await expect(door.locator('.wn-new')).toHaveText('New');
    const box = await door.boundingBox(), head = await page.locator('#main header h1').boundingBox();
    expect(box!.y).toBeGreaterThan(head!.y);   // under the Help heading, first thing on the tab
    await door.click();
    const p = panel(page);
    await expect(p.locator('h2')).toHaveText('New in your portal');
    await expect(p.locator('.wn-card h4')).toHaveText(['Every conversation with your studio is now in Messages']);
    await expect(p.getByRole('link', { name: /Show me/ })).toHaveAttribute('href', '/client.html');
    await expect(p).not.toContainText('Studio OS');
    await p.locator('.wn-x').click();
    await expect(door.locator('.wn-new')).toHaveCount(0);
    await expect(door).toBeFocused();
  });
});

test('the real entries: every picture loads', async ({ page }) => {
  await page.goto('/today.html');
  const bad = await page.evaluate(async () => {
    const d = await (await fetch('/whats-new.json')).json();
    const out: string[] = [];
    for (const e of d.entries) { const r = await fetch(e.picture); if (!r.ok || !/image\/jpeg/.test(r.headers.get('content-type') || '')) out.push(e.picture); }
    return out;
  });
  expect(bad).toEqual([]);
});
