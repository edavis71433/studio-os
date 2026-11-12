import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 196 (Nov 12 review, file 06, findings 30 to 36), the editor's half: a refused
// publish says why; the copied-words item opens the copied section, with the studio's Keep right
// there; a page whose password didn't come with it asks for one; the page chip says Private or
// Password. The server's half is tests/presence/publish_says_196_test.mjs.
const LOCK = '33333333-3333-4333-8333-333333333333';
const BLOCKS = [
  { type: 'title', title: 'Fresh bread', subtitle: 'Baked daily' },
  { type: 'richtext', title: 'Our story', body: 'Hello' },
];
const PAGES = [
  { slug: 'staff', title: 'Staff only', access: 'password', lock: LOCK, blocks: [{ type: 'richtext', title: 'Rota', body: 'Mondays' }] },
  { slug: 'plans', title: 'Plans', access: 'private', blocks: [{ type: 'richtext', title: 'Next year', body: 'Soon' }] },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: { staff: [{ sid: 'richtext', key: 'block_richtext', src_index: 0 }], plans: [{ sid: 'richtext', key: 'block_richtext', src_index: 0 }] } };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}section{padding:56px 24px;min-height:300px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2></section>'
  + '<section id="b" class="block block-richtext" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1"><h2 data-dds-field="title">Our story</h2><p>Hello</p></section></main></body></html>';
const LIVE_HEALTH = { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Nov 8', detail: 'published by you' }, domain: { label: 'marlows.example', state: 'ok', detail: '' } } } };
const SITE = { id: 's1', edition: 'presence', status: 'live', template_slug: 'business-classic', template_version: 1, custom_domain: 'marlows.example', last_published_at: '2026-11-08T12:00:00Z' };
const ctx = (studio: boolean) => ({ data: {
  site_role: studio ? 'agency_owner' : 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: studio, is_operator: false, scope: studio ? { site_id: 's1', name: 'Marlow’s Kitchen' } : null,
  sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} });
const COPIED = 'Still exactly as copied from another site: 1 section (Home: Our story). Change them for this business before publishing.';
const changes = (over: Record<string, unknown> = {}) => ({ data: { count: 1, first_publish: false, changes: [{ section: 'site', sentence: 'Your opening hours changed.' }], blockers: 0, warnings: 0, draft_hash: 'h', ...over } });
type Opts = { studio?: boolean; changesData?: unknown; locks?: string[]; publish?: { status: number; body: unknown } };
async function mount(page: Page, hash: string, o: Opts = {}) {
  const settings = { blocks: BLOCKS, pages: PAGES, section_meta: META };
  await installApp(page, { api: {
    '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
    '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/notes': { data: [] }, '/moments': { data: [] },
    '/health': LIVE_HEALTH, '/changes': o.changesData || changes(), '/settings': { data: settings },
    '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
    '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] }, '/publishes': { data: [] },
    '/page-locks': { data: { ids: o.locks || [], ready: true } },
    '/portal/context': ctx(!!o.studio),
  } });
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    posts.push({ path, body });
    if (path === '/publish' && o.publish) return route.fulfill({ status: o.publish.status, contentType: 'application/json', body: JSON.stringify(o.publish.body) });
    if (path === '/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...settings, ...body } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  // the studio's own first-visit tour and the publish tip would sit over the page (the helper marks the business roles' tours seen)
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1, 'publish-atomic': 1 })); localStorage.setItem('dds-toured:agency_owner', '1'); } catch { /* storage may be denied */ } });
  await page.goto((o.studio ? '/presence.html?client=s1' : '/presence.html') + hash);
  return { posts };
}
const ritualRow = (page: Page) => page.locator('#ritBlockers .blocklist li');

test.describe('the copied-words item (finding 32)', () => {
  test('Fix opens the first copied section, not Business details; a client is told who can keep them', async ({ page }) => {
    await mount(page, '#publish', { changesData: changes({ blockers: 1, blocker_list: [{ field: 'copied', message: COPIED, at: { page: '', index: 1 } }] }) });
    await expect(ritualRow(page)).toHaveCount(1);
    await expect(ritualRow(page)).toContainText(COPIED + ' Or ask your studio to keep them as they are.');
    await expect(ritualRow(page).getByRole('button', { name: 'Keep the copied words and photos as they are' })).toHaveCount(0);
    await ritualRow(page).getByRole('button', { name: /^Fix/ }).click();
    await expect(page.locator('#ritualWrap')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#view-business')).toBeHidden();
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'section');
    await expect(page.locator('#blocksCard input[id^="insTitle-"]')).toHaveValue('Our story');
  });

  test('the studio keeps them right there, and the list is read again', async ({ page }) => {
    const { posts } = await mount(page, '#publish', { studio: true, changesData: changes({ blockers: 1, blocker_list: [{ field: 'copied', message: COPIED, at: { page: '', index: 1 } }] }) });
    await expect(ritualRow(page)).toHaveText(new RegExp(COPIED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(ritualRow(page)).not.toContainText('Or ask your studio');
    await ritualRow(page).getByRole('button', { name: 'Keep the copied words and photos as they are' }).click();
    await expect.poll(() => posts.find((p) => p.path === '/agency/sites/s1/copied')?.body).toEqual({ keep: true });
    await expect(page.getByText('Kept as they are. They can go live now.')).toBeVisible();
  });
});

test.describe('a page whose password didn’t come with it (finding 30)', () => {
  test('the publish item opens that page’s settings, which ask for a password instead of saying it’s saved', async ({ page }) => {
    const msg = '“Staff only” asks for a password, but none is set on this site yet. Set one in its page settings, or choose who can see it.';
    await mount(page, '#publish', { locks: [], changesData: changes({ blockers: 1, blocker_list: [{ field: 'page_lock.staff', message: msg }] }) });
    await ritualRow(page).getByRole('button', { name: /^Fix/ }).click();
    const group = page.locator('.pg-group[data-group="access"]');
    await expect(group).toBeVisible();
    await expect(group.locator('.pg-unset')).toHaveText('This page asks for a password, but none is set on this site yet, so it can’t go live. Set one, or choose who can see it.');
    await expect(group.getByText('Password saved')).toHaveCount(0);
    await expect(group.locator('input[type="password"]')).toBeVisible();
    await expect(group.getByRole('button', { name: 'Cancel' })).toHaveCount(0);   // there's no password to go back to
  });

  test('a password this site holds still reads “Password saved”', async ({ page }) => {
    await mount(page, '#publish', { locks: [LOCK], changesData: changes({ blockers: 1, blocker_list: [{ field: 'page_lock.staff', message: 'x' }] }) });
    await ritualRow(page).getByRole('button', { name: /^Fix/ }).click();
    const group = page.locator('.pg-group[data-group="access"]');
    await expect(group.getByText('Password saved')).toBeVisible();
    await expect(group.locator('.pg-unset')).toHaveCount(0);
  });
});

test.describe('a refused publish says why (finding 31)', () => {
  const publishNow = async (page: Page) => {
    await page.getByRole('button', { name: 'Publish this change' }).click();
    await expect(page.locator('#ritTitle')).toHaveText('That didn’t go through.');
  };
  test('a site the studio paused: the reason, and no Try again that would fail the same way', async ({ page }) => {
    await mount(page, '#publish', { publish: { status: 409, body: { error: 'site_paused', message: 'Your site is currently paused. Contact your studio to resume publishing.' } } });
    await publishNow(page);
    await expect(page.locator('#ritSub')).toHaveText('Your site is currently paused. Contact your studio to resume publishing. Your live site is unchanged.');
    await expect(page.locator('#ritActions').getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.locator('#ritActions').getByRole('button', { name: 'Back to your website' })).toBeVisible();
  });

  test('too soon after the last one: the reason, and Try again waits as long as it was asked to', async ({ page }) => {
    await mount(page, '#publish', { publish: { status: 429, body: { error: 'cooldown', message: 'Just a moment — you can publish again in about 2 seconds.', retry_after: 2 } } });
    await publishNow(page);
    await expect(page.locator('#ritSub')).toContainText('Just a moment — you can publish again in about 2 seconds.');
    const again = page.locator('#ritActions').getByRole('button', { name: 'Try again' });
    await expect(again).toBeDisabled();
    await expect(again).toBeEnabled({ timeout: 5000 });
  });

  test('another publish still running says so', async ({ page }) => {
    await mount(page, '#publish', { publish: { status: 409, body: { error: 'publish_in_progress', message: 'A publish is already in progress — give it a moment to finish.' } } });
    await publishNow(page);
    await expect(page.locator('#ritSub')).toContainText('A publish is already in progress — give it a moment to finish.');
    await expect(page.locator('#ritActions').getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});

test.describe('the page chip (finding 36)', () => {
  for (const [slug, word] of [['plans', 'Private'], ['staff', 'Password']] as const) {
    test(`a ${word.toLowerCase()} page isn’t called “Live”`, async ({ page }) => {
      await mount(page, '#design', { changesData: changes({ count: 0, changes: [] }) });
      await expect(page.locator('html')).toHaveClass(/dc-edit/);
      await page.evaluate((s) => (0, eval)(`dcSwitchPage(${JSON.stringify(s)})`), slug);
      await expect(page.locator('#dcPageName')).toHaveText(slug === 'plans' ? 'Plans' : 'Staff only');
      await expect(page.locator('#dcPageCount')).toHaveText(word);
      await page.evaluate(() => (0, eval)('dcSwitchPage("")'));
      await expect(page.locator('#dcPageCount')).toHaveText('Live');   // Home, open to everyone, nothing waiting
    });
  }
});
