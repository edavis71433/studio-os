import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 197 (Nov 12 review, file 06, findings 37 to 40): a page rename carries its pop-up
// choice; "changed elsewhere" names the studio; a logo picked in Styles saves at once; Put back
// for a deleted page waits its turn behind the editor's saves and says when the menu doesn't
// show the page.
const LOGO = '55555555-5555-4555-8555-555555555555';
const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c96"/></svg>');
const BLOCKS = [{ type: 'title', title: 'Fresh bread', subtitle: 'Baked daily' }];
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}section{padding:56px 24px;min-height:300px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const ctx = (studio: boolean) => ({ data: {
  site_role: studio ? 'agency_owner' : 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: studio, is_operator: false, scope: studio ? { site_id: 's1', name: 'Marlow’s Kitchen' } : null,
  sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} });
type Call = { method: string; path: string; body: any; at: number; done?: number };
type Opts = { studio?: boolean; settings?: Record<string, unknown>; slowPut?: number; staleWho?: string; deleted?: unknown[] };
async function mount(page: Page, hash: string, o: Opts = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} }, ...(o.settings || {}) };
  await installApp(page, { api: {
    '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
    '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/notes': { data: [] }, '/moments': { data: [] }, '/health': { data: {} },
    '/media': { data: [{ id: LOGO, thumb: PHOTO, alt_text: 'Our logo', created_at: '2026-11-01T00:00:00Z', used_by: [] }] },
    '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
    '/settings': { data: settings }, '/portal/context': ctx(!!o.studio),
    '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
    '/dev/brand-kit': { data: { brand_kit: { logo_media_id: null, primary: '#2f5d8a' } } },
    '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] }, '/publishes': { data: [] }, '/publishes/checkpoints': { data: [] },
    '/pages/deleted': { data: o.deleted || [], ready: true, keep_days: 30 },
  } });
  const calls: Call[] = [];
  await page.route('**/functions/v1/presence/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    const c: Call = { method: req.method(), path, body, at: Date.now() }; calls.push(c);
    if (path === '/settings') {
      if (o.staleWho) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'stale_draft', message: 'x', current_hash: 'h2', last_change: { actor_kind: o.staleWho, summary: 'Changed the hours', at: new Date().toISOString() } }) });
      if (o.slowPut) await new Promise((r) => setTimeout(r, o.slowPut));
      settings = { ...settings, ...body }; c.done = Date.now();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) });
    }
    if (/^\/pages\/deleted\/[^/]+\/restore$/.test(path)) { c.done = Date.now(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { slug: 'team', title: 'Our team', moved: false } }) }); }
    c.done = Date.now();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1, 'publish-atomic': 1 })); localStorage.setItem('dds-toured:agency_owner', '1'); } catch { /* storage may be denied */ } });
  await page.goto((o.studio ? '/presence.html?client=s1' : '/presence.html') + hash);
  return { calls, settingsPuts: () => calls.filter((c) => c.path === '/settings').map((c) => c.body) };
}

test('a renamed page keeps its pop-up: the choice follows the new address (finding 37)', async ({ page }) => {
  const { settingsPuts } = await mount(page, '#design', { settings: {
    pages: [{ slug: 'offers', title: 'Offers', blocks: [] }, { slug: 'about-us', title: 'About us', blocks: [] }],
    popup: { on: true, heading: 'Ten percent off', pages: 'pick', picked: ['home', 'page:offers'] },
  } });
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await page.evaluate(() => (0, eval)('dcSavePageName("offers", "Deals", "deals")'));
  await expect.poll(() => settingsPuts().find((b) => b && b.pages)?.popup?.picked).toEqual(['home', 'page:deals']);
  const put = settingsPuts().find((b) => b && b.pages);
  expect(put.pages.find((p: { slug: string }) => p.slug === 'deals')).toMatchObject({ title: 'Deals', prev_slug: 'offers' });
  expect(put.popup).toMatchObject({ on: true, heading: 'Ten percent off', pages: 'pick' });
});

test('a rename of a page the pop-up doesn’t name leaves the pop-up alone', async ({ page }) => {
  const { settingsPuts } = await mount(page, '#design', { settings: {
    pages: [{ slug: 'offers', title: 'Offers', blocks: [] }, { slug: 'about-us', title: 'About us', blocks: [] }],
    popup: { on: true, heading: 'Ten percent off', pages: 'pick', picked: ['page:offers'] },
  } });
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await page.evaluate(() => (0, eval)('dcSavePageName("about-us", "Our story", "our-story")'));
  await expect.poll(() => settingsPuts().filter((b) => b && b.pages).length).toBe(1);
  expect('popup' in settingsPuts().find((b) => b && b.pages)).toBe(false);
});

test.describe('“changed elsewhere” says who (finding 38)', () => {
  test('to a client, a change their studio made is their studio’s, not “someone else on your account”', async ({ page }) => {
    await mount(page, '#design', { staleWho: 'operator' });
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await page.evaluate(() => { (0, eval)('settingsPut({ nav_style: "centered" }).catch(() => {})'); });
    await expect(page.getByText('This site was changed by your studio while you had it open', { exact: false })).toBeVisible();
    await expect(page.getByText('someone else on your account', { exact: false })).toHaveCount(0);
  });

  test('to the studio inside a client, the owner’s change is “your client”', async ({ page }) => {
    await mount(page, '#design', { studio: true, staleWho: 'client' });
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await page.evaluate(() => { (0, eval)('settingsPut({ nav_style: "centered" }).catch(() => {})'); });
    await expect(page.getByText('This site was changed by your client while you had it open', { exact: false })).toBeVisible();
  });
});

test('a logo picked in Styles is saved at once, and says so (finding 39)', async ({ page }) => {
  const { settingsPuts } = await mount(page, '#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await page.evaluate(() => { (0, eval)('openSettingsPanel("styles"); stylesTab("colours")'); });
  const card = page.locator('#brandKitCard');
  await card.getByRole('button', { name: 'Choose logo' }).click();
  await page.locator('#pickerGrid .mcell').first().click();
  await expect.poll(() => settingsPuts().find((b) => b && 'logo_media_id' in b)?.logo_media_id).toBe(LOGO);
  await expect(page.getByText('Logo saved. Publish to show it on your live site.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Change logo' })).toBeVisible();
  // nothing else is needed: no "Build & apply brand kit" to press
  expect(settingsPuts().filter((b) => b && 'logo_media_id' in b)).toHaveLength(1);
});

test.describe('Put back for a deleted page (finding 40)', () => {
  const DELETED = [{ id: '66666666-6666-4666-8666-666666666666', slug: 'team', title: 'Our team', sections: 2, deleted_at: '2026-11-11T10:00:00Z', days_left: 29 }];
  test('it waits for a save that is still on its way, then goes', async ({ page }) => {
    const { calls } = await mount(page, '#history', { slowPut: 1500, deleted: DELETED, settings: { nav: [{ label: 'Home', href: '/' }, { label: 'Our team', href: '/team/' }] } });
    const back = page.getByRole('button', { name: 'Put back the page Our team' });
    await expect(back).toBeVisible();
    await page.evaluate(() => { (0, eval)('settingsPut({ nav_style: "centered" })'); });   // a save on its way, slow to answer
    await expect.poll(() => calls.filter((c) => c.path === '/settings').length).toBe(1);
    await back.click();
    await expect.poll(() => calls.find((c) => c.path.startsWith('/pages/deleted/'))?.at).toBeTruthy();
    const put = calls.find((c) => c.path === '/settings')!, restore = calls.find((c) => c.path.startsWith('/pages/deleted/'))!;
    expect(put.done, 'the save answered').toBeTruthy();
    expect(restore.at).toBeGreaterThanOrEqual(put.done!);   // it went after the save landed, not across it
    await expect(page.getByText('“Our team” is back in your pages')).toBeVisible();
  });

  test('a page the menu doesn’t list comes back saying so', async ({ page }) => {
    await mount(page, '#history', { deleted: DELETED, settings: { nav: [{ label: 'Home', href: '/' }] } });
    await page.getByRole('button', { name: 'Put back the page Our team' }).click();
    await expect(page.getByText('“Our team” is back in your pages. It isn’t in your menu yet: add it from Pages.')).toBeVisible();
  });
});
