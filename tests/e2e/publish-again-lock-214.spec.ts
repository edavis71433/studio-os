import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 214 (Nov 12 review, file 03 finding 2; Figma "A · Publish again, and Lock
// publishing", approved Nov 14): an earlier publish goes live again in one step from Versions,
// after one question, and the draft is left alone; a Lock publishing switch per site holds the
// live site as it is, with a note the client reads. While it is on the bar's Publish says
// Locked and the publish card says why: the studio gets Unlock, the client a Publish that waits.
// The server's half is tests/presence/publish_lock_214_test.mjs.
const SITE = { id: 's1', edition: 'presence', status: 'live', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'n1', last_published_at: '2026-11-12T10:42:00Z' };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}section{padding:48px 24px;min-height:320px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread</h2></section></main></body></html>';
const PUBS = [
  { id: 'p-now', kind: 'publish', status: 'live', summary: 'Changed the opening hours and 2 sections', label: '', at: '2026-11-12T10:42:00Z', restorable: true, by_kind: 'client' },
  { id: 'p-old', kind: 'publish', status: 'live', summary: 'The new lunch page and photos', label: 'Spring menu', at: '2026-11-08T09:15:00Z', restorable: true, by_kind: 'operator' },
];
const LOCKED = { on: true, at: '2026-11-12T15:40:00Z', by_kind: 'operator', words: 'Launch freeze until Friday, Nov 14.' };
const ctx = (studio: boolean) => ({ data: {
  site_role: studio ? 'agency_owner' : 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: studio, is_operator: false, scope: studio ? { site_id: 's1', name: 'Marlow’s Kitchen' } : null,
  sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} });
type Opts = { studio?: boolean; lock?: Record<string, unknown>; canChange?: boolean; again?: { status: number; body: unknown } };
async function mount(page: Page, hash: string, o: Opts = {}) {
  let lock: Record<string, unknown> = { on: false, at: null, by_kind: null, words: '', ...(o.lock || {}), can_change: o.canChange ?? !!o.studio };
  await installApp(page, { api: {
    '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
    '/settings': { data: { blocks: [{ type: 'title', title: 'Fresh bread' }], section_meta: { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} } } },
    '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
    '/changes': { data: { count: 2, first_publish: false, changes: [{ section: 'site', sentence: 'Your opening hours changed.' }, { section: 'site', sentence: 'A new photo on the home page.' }], blockers: 0, warnings: 0, draft_hash: 'h' } },
    '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
    '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] }, '/launches': { data: [] },
    '/publishes': { data: PUBS, stars: [] },
    '/publishes/checkpoints': { data: [{ id: 'cp1', name: 'Before the spring menu', at: '2026-11-11T16:10:00Z' }] },
    '/preview/status': { data: { draft: { unpublished_changes: 2 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-11-12T10:42:00Z' } } },
    '/portal/context': ctx(!!o.studio),
  } });
  const writes: Array<{ method: string; path: string; body: any }> = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (path === '/site/publish-lock') {
      if (req.method() === 'PUT') {
        const b = req.postDataJSON(); writes.push({ method: 'PUT', path, body: b });
        lock = b.on ? { ...lock, on: true, at: lock.on ? lock.at : '2026-11-14T09:00:00Z', by_kind: lock.on ? lock.by_kind : 'operator', words: b.words !== undefined ? b.words : lock.words } : { ...lock, on: false, words: '' };
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: lock }) });
    }
    if (req.method() === 'GET') return route.fallback();
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/restore' && o.again) return route.fulfill({ status: o.again.status, contentType: 'application/json', body: JSON.stringify(o.again.body) });
    if (path === '/restore') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'deploying' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview?**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1, 'publish-atomic': 1 })); localStorage.setItem('dds-toured:agency_owner', '1'); } catch { /* storage may be denied */ } });
  await page.goto((o.studio ? '/presence.html?client=s1' : '/presence.html') + hash);
  return { writes };
}
const rows = (page: Page) => page.locator('#pubList .hentry');
// the Publish control a person sees: the bar's on a computer and tablet, the dock's on a phone
const publishControl = (page: Page) => page.locator('#btnPublish:visible, #dockPublish:visible').first();
const restores = (w: Array<{ path: string }>) => w.filter((x) => x.path === '/restore');

test.describe('Publish again', () => {
  test('an earlier publish offers it, the one live now and a checkpoint don’t; Restore says where it goes', async ({ page }) => {
    await mount(page, '#history', { studio: true });
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(0).getByRole('button', { name: 'Publish again' })).toHaveCount(0);   // live now
    await expect(rows(page).nth(1).getByRole('button', { name: 'Publish again' })).toHaveCount(0);   // a checkpoint, never live
    await expect(rows(page).nth(2).getByRole('button', { name: 'Publish again' })).toBeVisible();
    for (const i of [0, 1, 2]) await expect(rows(page).nth(i).getByRole('button', { name: 'Restore to draft', exact: true })).toBeVisible();
    const w = page.viewportSize()!.width;   // every action stays on the screen, a phone's too
    for (const b of await page.locator('#pubList .hacts button').all()) { const r = (await b.boundingBox())!; expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5); }
  });

  test('it asks once, in plain words, then that version goes live and the draft is left alone', async ({ page }) => {
    const { writes } = await mount(page, '#history', { studio: true });
    await rows(page).nth(2).getByRole('button', { name: 'Publish again' }).click();
    await expect(page.locator('#againTitle')).toHaveText('Publish this version again?');
    await expect(page.locator('#againSub')).toHaveText('“Spring menu”, published Nov 8, goes on your live site again now, all at once, in place of today’s version.');
    await expect(page.locator('#againScrim')).toContainText('Your draft stays as it is, so what you’ve changed since is still there for your next publish.');
    expect(restores(writes)).toEqual([]);   // nothing until it is said yes to
    await page.locator('#btnAgainGo').click();
    await expect.poll(() => restores(writes).map((x) => x.body)).toEqual([{ publish_id: 'p-old' }]);
    await expect(page.getByText('That version is going live. It usually takes under a minute.')).toBeVisible();
    expect(writes.filter((x) => x.path === '/settings' || x.path === '/restore-to-draft')).toEqual([]);
  });

  test('a refusal says why', async ({ page }) => {
    await mount(page, '#history', { studio: true, again: { status: 409, body: { error: 'site_paused', message: 'Your site is currently paused. Contact your studio to resume publishing.' } } });
    await rows(page).nth(2).getByRole('button', { name: 'Publish again' }).click();
    await page.locator('#btnAgainGo').click();
    await expect(page.getByText('Your site is currently paused. Contact your studio to resume publishing.')).toBeVisible();
  });
});

test.describe('Lock publishing', () => {
  test('the studio locks it with a note for the client; Publish again waits and the bar says Locked', async ({ page }) => {
    const { writes } = await mount(page, '#history', { studio: true });
    const box = page.locator('#pubLock');
    await expect(box).toContainText('Nothing goes live until it’s unlocked: for a launch freeze, or while something is being sorted out.');
    await box.getByRole('switch', { name: 'Lock publishing' }).click();
    await expect.poll(() => writes.filter((x) => x.path === '/site/publish-lock').map((x) => x.body)).toEqual([{ on: true }]);
    await expect(box).toHaveClass(/\bon\b/);
    await expect(box.getByRole('switch', { name: 'Publishing is locked' })).toBeChecked();
    await expect(box.getByRole('switch')).toBeFocused();   // drawn again, and the keyboard is still on it
    await expect(box).toContainText('Since Nov 14, by your team.');
    const note = box.getByLabel('What your client sees');
    await note.fill('Launch freeze until Friday, Nov 14.'); await note.blur();
    await expect.poll(() => writes.filter((x) => x.path === '/site/publish-lock').at(-1)?.body).toEqual({ on: true, words: 'Launch freeze until Friday, Nov 14.' });
    await expect(rows(page).nth(2).getByRole('button', { name: 'Publish again' })).toBeDisabled();
    await expect(publishControl(page)).toHaveText('Locked');
  });

  test('while locked, the studio’s publish card says why and unlocks', async ({ page }) => {
    const { writes } = await mount(page, '#publish', { studio: true, lock: LOCKED });
    await expect(page.locator('#ritTitle')).toHaveText('Publishing is locked.');
    await expect(page.locator('#ritSub')).toHaveText('Locked since Nov 12. Your client reads: “Launch freeze until Friday, Nov 14.”');
    await expect(page.locator('#ritBody')).toContainText('2 changes are waiting in the draft. Unlock to publish them, or leave it locked and they wait.');
    await page.locator('#ritActions').getByRole('button', { name: 'Unlock publishing' }).click();
    await expect.poll(() => writes.filter((x) => x.path === '/site/publish-lock').map((x) => x.body)).toEqual([{ on: false }]);
    await expect(page.locator('#ritActions').getByRole('button', { name: 'Publish these 2 changes' })).toBeEnabled();
  });

  test('the client sees the lock and why, with no switch, and a Publish that waits', async ({ page }) => {
    await mount(page, '#history', { lock: LOCKED, canChange: false });
    const box = page.locator('#pubLock');
    await expect(box).toHaveText('Your studio locked publishing on Nov 12. Their note: “Launch freeze until Friday, Nov 14.” Ask them if something needs to go live.');
    await expect(box.getByRole('switch')).toHaveCount(0);
    await expect(publishControl(page)).toHaveText('Locked');
    await publishControl(page).click();
    await expect(page.locator('#ritTitle')).toHaveText('Publishing is locked.');
    await expect(page.locator('#ritSub')).toHaveText('Your studio locked publishing on Nov 12. Their note: “Launch freeze until Friday, Nov 14.”');
    await expect(page.locator('#ritBody')).toContainText('Your 2 changes are safe in your draft and go live once it’s unlocked. Ask your studio if something needs to go live sooner.');
    await expect(page.locator('#ritActions').getByRole('button', { name: 'Publish these 2 changes' })).toBeDisabled();
  });

  test('a client whose studio looks after the site sees nothing about it until it is locked', async ({ page }) => {
    await mount(page, '#history', { canChange: false });
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator('#pubLock')).toBeEmpty();
    await expect(publishControl(page)).not.toHaveText('Locked');
  });
});
