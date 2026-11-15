import { test, expect, Page, Route } from '@playwright/test';
import { installApp, ALL_FEATURES } from './helpers/app';
import { seatCapabilities, designerAllowed, SEAT_WORDS, publishWords } from '../../supabase/functions/presence/lib/site_roles';

// Builder item 220: a Designer works on the website and sees nothing of the business.
// The server refuses a Designer every route outside lib/site_roles.ts designerAllowed
// (index.ts, before any handler). Here the stub refuses the same routes the same way,
// so these prove the pages a Designer uses never ask for one (a 403 on screen would be
// the page's fault), and that the business's tabs, the bell and Inbox are gone.
const DESIGNER_NAV = [
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Website', href: '/presence.html', desc: 'The website you work on: its pages, styles and photos.' },
    { key: 'design', label: 'Edit site', href: '/presence.html#design', hidden: true },
    { key: 'add_page', label: 'Add a page', href: '/presence.html#addpage', hidden: true },
    { key: 'history', label: 'Versions', href: '/presence.html#history', hidden: true },
  ] },
  { key: 'files', label: 'Files', items: [{ key: 'files_all', label: 'Files', href: '/files.html' }] },
  { key: 'help', label: 'Help', utility: true, items: [{ key: 'help', label: 'Help', href: '/help.html', hidden: true }] },
];
const designerCtx = (canPublish = false) => ({ data: {
  site_role: 'designer', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, is_managed_client: false, sees_full_workspace: false, is_client_portal: false,
  capabilities: seatCapabilities({ role: 'designer', can_publish: canPublish }), landing: '/presence.html', attention_count: 0, nav: DESIGNER_NAV,
  plan_key: 'presence', upsell: null, scope: null, businesses: [], business: null,
  my_role: { role: 'designer', name: 'Designer', you: SEAT_WORDS.designer.you, publish: publishWords({ role: 'designer', can_publish: canPublish }), can_publish: canPublish, business: 'Marlow’s Kitchen' },
} });

const PIC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const SITE_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [{ id: 'o1', name: 'Pasta', category: 'Mains', description: '', price_text: '$12', is_visible: true }] },
  '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [{ id: 'm1', alt_text: 'Pasta', thumb: PIC, created_at: '2026-01-01T00:00:00Z', used_by: [] }] },
  '/settings': { data: {} }, '/health': { data: {} },
  '/changes': { data: { count: 2, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [] } },
  '/schedule': { data: { scheduled: [] } },
  '/preview/status': { data: { draft: { unpublished_changes: 2 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-07-01T00:00:00Z', summary: '' } } },
  '/site/templates': { data: { current: { slug: 'business-classic', version: '1.0.0' }, templates: [{ slug: 'business-classic', name: 'Business classic', version: '1.0.0' }] } },
  '/assets/collections': { data: [] }, '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [], total: 0, shown: 0, live_count: 0, policy: 'immediate' } },
};
// the routes index.ts answers before the boundary: each holds its own door
const BEFORE_BOUNDARY = /^\/(commerce|help\/ask|push|agency|transfers|admin|analytics\/portfolio)(\/|$)/;

/** Signed in as Lee, a Designer: the stub answers like the server, refusing what a Designer can't reach. */
async function asDesigner(page: Page, canPublish = false, api: Record<string, unknown> = SITE_API): Promise<string[]> {
  await installApp(page, { api: { ...api, '/portal/context': designerCtx(canPublish) } as never });
  await page.addInitScript(() => { try { localStorage.setItem('dds-toured:designer', '1'); } catch { /* storage may be denied */ } });
  const refused: string[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '') || '/';
    const method = route.request().method();
    if (method === 'OPTIONS' || BEFORE_BOUNDARY.test(path) || designerAllowed(path, method)) return route.fallback();
    refused.push(`${method} ${path}`);
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', role: 'designer', message: 'That isn’t part of a Designer’s role.' }) });
  });
  return refused;
}
const ready = (page: Page) => page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
const lacks = (page: Page) => page.evaluate(() => (document.documentElement.getAttribute('data-dds-lacks') || '').split(' ').filter(Boolean).sort());
const settle = (page: Page) => page.waitForLoadState('networkidle').catch(() => { /* a long poll is fine */ });

test.describe('A Designer on the website', () => {
  test('the role lacks the business, publishing and settings, and keeps styling', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    expect(await lacks(page)).toEqual(['approve', 'business', 'configure', 'delete', 'owner', 'publish']);
  });

  test('with the publish switch on, publishing is theirs too', async ({ page }) => {
    await asDesigner(page, true);
    await page.goto('/presence.html');
    await ready(page);
    expect(await lacks(page)).toEqual(['approve', 'business', 'configure', 'delete', 'owner']);
  });

  test('the editor asks the server for nothing a Designer can\'t reach', async ({ page }) => {
    const refused = await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    await expect(page.locator('#app')).toBeVisible();
    await settle(page);
    expect(refused).toEqual([]);
  });

  test('the business tabs are gone; the website\'s stay', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    // the editor draws its tabs twice (the sidebar on a computer, the Sections sheet on a phone): count the visible ones
    const visible = (label: string) => page.locator('.navitem:visible', { hasText: new RegExp('^' + label + '$') });
    const all = (label: string) => page.locator('.navitem', { hasText: new RegExp('^' + label + '$') });
    for (const label of ['Search', 'Bookings', 'Reviews', 'Analytics', 'Domain & email', 'Connections', 'Sharing & access', 'See the client’s view']) {
      expect(await all(label).count(), label + ' is drawn (and so hidden by the role, not missing)').toBeGreaterThan(0);
      for (const t of await all(label).all()) expect(await t.evaluate((n) => getComputedStyle(n).display), label + ' is gone').toBe('none');
    }
    await page.locator('.nav-fold .grp').evaluateAll((gs) => gs.forEach((g) => (g as HTMLElement).click()));   // open the folded groups
    for (const label of ['Pages', 'Styles', 'Business details', 'Versions']) await expect(visible(label).first(), label + ' stays').toBeVisible();
  });

  test('a business tab opened by its address shows the Overview instead', async ({ page }) => {
    const refused = await asDesigner(page);
    await page.goto('/presence.html#bookings');
    await ready(page);
    await expect(page.locator('#view-today')).toHaveClass(/\bon\b/);
    await expect(page.locator('#view-bookings')).not.toHaveClass(/\bon\b/);
    await settle(page);
    expect(refused).toEqual([]);
  });

  test('Styles opens for a Designer; changing the template stays the owner\'s', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html#design');
    await ready(page);
    const display = (sel: string) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).display);
    expect(await display('#btnSettingsOpen')).not.toBe('none');
    expect(await display('#designGallery')).toBe('none');
  });

  test('no bell: it would ring for the business', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    await expect(page.locator('#dds-bell')).toBeHidden();
  });
});

test.describe('A Designer in Files', () => {
  test('Files works and asks for nothing a Designer can\'t reach', async ({ page }) => {
    const refused = await asDesigner(page);
    await page.goto('/files.html');
    await ready(page);
    await settle(page);
    expect(refused).toEqual([]);
    await expect(page.locator('#makeImage')).toBeHidden();   // no Visual Studio: keeping an AI image is an approval
  });

  test('on a phone, the bottom bar offers no Inbox', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'the bottom bar is a phone\'s');
    await asDesigner(page);
    await page.goto('/files.html');
    await ready(page);
    await expect(page.locator('#dds-mbar')).toBeAttached();
    await expect(page.locator('#dds-mbar [data-mbar="inbox"]')).toHaveCount(0);
  });
});
