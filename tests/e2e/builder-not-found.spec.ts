import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { newPageLock, gatePage, sealPage } from '../../supabase/functions/presence/lib/page_gate';

// The owner's own "not found" page and the password page's own words (builder list item 121,
// Nov 2026; Figma "A · Not found and password pages"). In the Pages card's Not found page, the
// owner picks the ready-made page or one of their own pages that's open to everyone. Under a
// password page's "Who can see it", they write the heading and message its password box shows.
// Then the visitor's side: the box with the owner's words.
const BLOCKS = [{ type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><header class="site"><b>Marlow’s Kitchen</b></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'abc' };
const LOCK = '11111111-2222-4333-8444-555555555555';
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/page-locks': { data: { ids: [LOCK], ready: true } },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Own = { slug: string; title: string; blocks: unknown[]; access?: string; lock?: string; notFound?: boolean; lockTitle?: string; lockNote?: string };
const OWN: Own[] = [
  { slug: 'lost', title: 'Lost', blocks: [] },
  { slug: 'offers', title: 'Offers', blocks: [] },
  { slug: 'members', title: 'Members', blocks: [], access: 'password', lock: LOCK },
  { slug: 'drafts', title: 'Drafts', blocks: [], access: 'private' },
];
type Write = { method: string; path: string; body: any };
async function mount(page: Page, pages: Own[] = OWN) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages };
  await installApp(page, { api: { ...API, '/settings': { data: settings } } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return writes;
}
const lastPages = (writes: Write[]) => (writes.filter((w) => w.path === '/settings' && w.body.pages).at(-1)?.body.pages || []) as Own[];
async function openNotFound(page: Page) {
  await page.locator('#dcPageSwitch').click();
  await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
  await page.locator('#pcNotFound').click();
  await expect(page.locator('#pcNotFoundPane')).toBeVisible();
}
const choice = (page: Page, name: string) => page.locator('.pc-nf-seg button', { hasText: name });

test.describe('the not-found page (builder item 121)', () => {
  test('Ready-made to start; One of my pages picks the first own page, another can be chosen, Ready-made takes it back', async ({ page }) => {
    const writes = await mount(page);
    await openNotFound(page);
    await expect(choice(page, 'Ready-made')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#pcNotFoundPane')).toContainText('a short “That page isn’t here” page');
    await choice(page, 'One of my pages').click();
    await expect.poll(() => lastPages(writes).filter((p) => p.notFound).map((p) => p.slug)).toEqual(['lost']);
    await expect(choice(page, 'One of my pages')).toHaveAttribute('aria-pressed', 'true');
    const pick = page.locator('#pcNotFoundPick');
    await expect(pick.locator('option')).toHaveText(['Lost', 'Offers']);   // never a password or private page
    await pick.selectOption('offers');
    await expect.poll(() => lastPages(writes).filter((p) => p.notFound).map((p) => p.slug)).toEqual(['offers']);
    await expect(page.locator('#pcNotFoundPane')).toContainText('Its own address still works.');
    await choice(page, 'Ready-made').click();
    await expect.poll(() => lastPages(writes).filter((p) => p.notFound).length).toBe(0);
    await expect(page.locator('#pcNotFoundPick')).toHaveCount(0);
  });

  test('with no page of your own, One of my pages waits', async ({ page }) => {
    await mount(page, [{ slug: 'members', title: 'Members', blocks: [], access: 'password', lock: LOCK }]);
    await openNotFound(page);
    await expect(choice(page, 'One of my pages')).toBeDisabled();
    await expect(page.locator('#pcNotFoundPane')).toContainText('Add a page of your own to use it instead.');
  });
});

test.describe('the password page’s own words (builder item 121)', () => {
  test('under a password page’s Who can see it: Heading and Message save on the page, and clear', async ({ page }) => {
    const writes = await mount(page);
    await page.locator('#dcPageSwitch').click();
    await page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: /^Members$/ }) }).locator('.pg-gear').click();
    const panel = page.locator('#pagesCard #pageSettings');
    await expect(panel.getByText('What the password page says')).toBeVisible();
    const heading = panel.locator('#pgLock-lockTitle'), note = panel.locator('#pgLock-lockNote');
    await expect(heading).toHaveAttribute('placeholder', 'This page needs a password');
    await expect(note).toHaveAttribute('placeholder', 'Type the password you were given to see Members.');
    await heading.fill('Members’ prices'); await heading.blur();
    await expect.poll(() => lastPages(writes).find((p) => p.slug === 'members')?.lockTitle).toBe('Members’ prices');
    await note.fill('Ask us at the counter   for this month’s password.'); await note.blur();
    await expect.poll(() => lastPages(writes).find((p) => p.slug === 'members')?.lockNote).toBe('Ask us at the counter for this month’s password.');
    await heading.fill(''); await heading.blur();
    await expect.poll(() => 'lockTitle' in (lastPages(writes).find((p) => p.slug === 'members') || {})).toBe(false);
  });

  test('a visitor sees the box with the owner’s words', async ({ page }) => {
    const LIVE = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Members</title></head><body><header class="site"><b>Marlow’s Kitchen</b></header><main id="main"><h1>Members’ prices</h1></main><footer class="site"><p>Burbank</p></footer></body></html>';
    const lock = await newPageLock('opensesame');
    const html = gatePage(LIVE, await sealPage(LIVE, lock.key), lock, { title: 'Members', heading: 'Members’ prices', note: 'Ask us at the counter for this month’s password.' });
    await page.route('**/zz-members/', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('/zz-members/');
    await expect(page.locator('#dds-lock-form h1')).toHaveText('Members’ prices');
    await expect(page.locator('#dds-lock-form p').first()).toHaveText('Ask us at the counter for this month’s password.');
    await expect(page.locator('header.site')).toContainText('Marlow’s Kitchen');   // the site's own header, logo and all
  });
});
