import { test, expect, Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { settled } from './helpers/app';

// Builder list item 225 (Nov 2026): a link name per section, so a menu item or a button can jump
// to it, and a shaped bottom edge between sections. First a client's published page as the
// renderer draws it today for three templates (tests/presence/section_links_225_test.mjs writes
// them, stylesheet inlined, and fails when they go stale); then the editor's new rows.
const SITE = 'https://shop.example';
const page_ = (slug: string) => readFileSync(join(__dirname, 'fixtures', 'section-links-225', `${slug}.html`), 'utf8');
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) <= 620;

async function openSite(page: Page, slug: string) {
  await page.route('**/*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route(`${SITE}/`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: page_(slug) }));
  await page.goto(`${SITE}/`);
  await expect(page.locator('section#hours')).toBeVisible();
}

for (const slug of ['business-classic', 'aurora', 'slate']) {
  test.describe(`a named section with a wave, on a client’s page [${slug}]`, { tag: '@layout' }, () => {
    test('the wave hangs the section’s own colour over the next one and covers none of its words', async ({ page }) => {
      await openSite(page, slug);
      const edge = Math.min(48, Math.max(20, 0.04 * page.viewportSize()!.width));   // clamp(20px,4vw,48px)
      const m = await page.locator('section#hours').evaluate((sec) => {
        const a = getComputedStyle(sec, '::after'), next = sec.nextElementSibling as HTMLElement;
        const r = sec.getBoundingClientRect(), words = next.querySelector('h2, p')!.getBoundingClientRect();
        return { h: parseFloat(a.height), mask: (a as any).maskImage || (a as any).webkitMaskImage || '', bg: a.backgroundColor, own: getComputedStyle(sec).backgroundColor,
          gap: parseFloat(getComputedStyle(next).borderTopWidth), bottom: r.bottom, words: words.top, nextBorder: getComputedStyle(next).borderTopColor };
      });
      expect(m.h).toBeCloseTo(edge + 1, 0);
      expect(m.mask).toContain('data:image/svg+xml');
      expect(m.bg).toBe(m.own);                                   // the section's own colour
      expect(m.own).not.toBe('rgba(0, 0, 0, 0)');
      expect(m.gap).toBeCloseTo(edge, 0);                        // the next section makes room…
      expect(m.nextBorder).toBe('rgba(0, 0, 0, 0)');             // …with a clear border its own colour shows through
      expect(m.words).toBeGreaterThanOrEqual(m.bottom + edge - 1);   // and nothing of it is covered
    });

    test('a button on the page jumps to it', async ({ page }) => {
      await openSite(page, slug);
      await page.locator('a[href="#hours"]').first().click();
      await expect(page).toHaveURL(/#hours$/);
      await expect(page.locator('section#hours h2')).toBeInViewport();
    });

    test('the menu item jumps to it from the site’s root, so it works from every page', async ({ page }) => {
      await openSite(page, slug);
      await expect(page.locator('header a[href="/#hours"]')).toHaveCount(1);
      test.skip(isPhone(page), 'on a phone the menu sits behind its button');
      await page.locator('header a[href="/#hours"]').click();
      await expect(page.locator('section#hours h2')).toBeInViewport();
    });
  });
}

// ── the editor ──
const BLOCKS = [
  { type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' },
  { type: 'richtext', title: 'Opening hours', body: 'Seven to three.', anchor: 'hours', look: { background: 'dark' } },
  { type: 'cta', text: 'Open from seven every morning.', button: 'See our hours', url: '' },
];
const META = { blocks: BLOCKS.map((b, i) => ({ sid: b.type, key: 'block_' + b.type, src_index: i })), pages: {} };
const SECTION = (i: number, type: string, words: string, style = '') => `<section id="s${i}" data-dds-sid="${type}" data-dds-key="block_${type}" data-dds-src="${i}" class="block"${style}><h2 data-dds-field="title">${words}</h2></section>`;
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--paper:#fbf8f3;--ink:#231c17;--accent:#8a4b2a}body{margin:0;background:#fbf8f3}section{padding:48px 24px;min-height:260px}</style></head><body><main id="main">'
  + SECTION(0, 'title', 'Fresh bread, every morning') + SECTION(1, 'richtext', 'Opening hours', ' style="background:#1a1622;color:#f2eef8"') + SECTION(2, 'cta', 'Open from seven every morning.') + '</main></body></html>';
const SITE_ROW = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'n1' };
const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } };
const API = {
  '/site': { data: { site: SITE_ROW, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/media': { data: [] }, '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] }, '/publishes': { data: [] }, '/launches': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/preview/status': { data: { draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-11-10T15:00:00Z' } } },
  '/portal/context': CTX,
};
type Write = { method: string; path: string; body: any };
const json = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
async function editor(page: Page, extra: Record<string, unknown> = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: [], ...extra };
  await installApp(page, { api: { ...API, '/settings': { data: settings } } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return json(route, settings); }
    if (path === '/preview/section') return json(route, { html: SECTION(body.index, body.blocks[body.index].type, String(body.blocks[body.index].title || body.blocks[body.index].text || '')) });
    return json(route, body || {});
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#s1')).toBeVisible();
  return { writes };
}
const lastBlocks = (m: { writes: Write[] }) => m.writes.filter((w) => w.path === '/settings' && w.body && w.body.blocks).at(-1)?.body.blocks;
async function card(page: Page, idx: number, tab: string) {
  await page.evaluate(([i, t]) => (window as any).eeEditBlock(i, t), [idx, tab] as [number, string]);
  await expect(page.locator(`#inspectorSeg [data-itab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.describe('Layout › Link name (builder item 225)', () => {
  test('the section’s name, made tidy, saved, and what jumps to it', async ({ page }) => {
    const m = await editor(page, { nav: [{ label: 'Home', href: '/' }, { label: 'Hours', href: '/#hours' }] });
    await card(page, 1, 'layout');
    const name = page.getByLabel('Link name');
    await expect(name).toHaveValue('hours');
    await expect(page.locator('.ins-anchor-used')).toHaveText('Linked from the menu item “Hours”.');
    await name.fill('Opening Hours!');
    await name.press('Enter');   // Enter keeps the name, as leaving the field does
    await expect(name).toHaveValue('opening-hours');
    await expect.poll(() => lastBlocks(m)?.[1]?.anchor).toBe('opening-hours');
    await expect(page.locator('.ins-anchor-used')).toHaveText('Nothing jumps here yet. Pick it in a menu item’s or a button’s Goes to list.');
  });

  test('a name the site uses for its own parts is refused, and nothing is saved', async ({ page }) => {
    const m = await editor(page);
    await card(page, 1, 'layout');
    const name = page.getByLabel('Link name');
    await name.fill('main');
    await name.press('Enter');   // Enter keeps the name, as leaving the field does
    await expect(page.locator('.ins-link .ins-says')).toHaveText('Your site already uses “main” for one of its own parts. Pick another name.');
    await settled(page);   // the save's own wait is over
    expect(m.writes.filter((w) => w.path === '/settings' && JSON.stringify(w.body || {}).includes('"anchor":"main"'))).toHaveLength(0);
  });
});

test.describe('Layout › Bottom edge (builder item 225)', () => {
  test('six shapes drawn in the section’s colours; picking one saves it', async ({ page }) => {
    const m = await editor(page);
    await card(page, 1, 'layout');
    const edges = page.getByRole('group', { name: 'Bottom edge' });
    await expect(edges.getByRole('button')).toHaveText(['Straight', 'Wave', 'Slant', 'Curve', 'Peak', 'Zigzag']);
    await expect(edges.getByRole('button', { name: 'Straight' })).toHaveAttribute('aria-pressed', 'true');
    // drawn in this section's own colour over the next one's, as the canvas has them
    await expect(edges.locator('.ins-edge-pic rect').nth(1)).toHaveAttribute('fill', 'rgb(26, 22, 34)');
    await edges.getByRole('button', { name: 'Wave' }).click();
    await expect.poll(() => lastBlocks(m)?.[1]?.look).toEqual({ background: 'dark', edge: 'wave' });
    await expect(page.getByRole('group', { name: 'Bottom edge' }).getByRole('button', { name: 'Wave' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a section without a colour of its own says why an edge won’t show @layout', async ({ page }) => {
    await editor(page);
    await card(page, 0, 'layout');
    await expect(page.locator('.ins-edges .ins-says')).toHaveText('This section has no colour of its own yet, so an edge won’t show. Pick a colour theme on the Style tab first.');
    const w = page.viewportSize()!.width;
    for (const b of await page.getByRole('group', { name: 'Bottom edge' }).getByRole('button').all()) {
      await b.scrollIntoViewIfNeeded();
      const r = (await b.boundingBox())!; expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5); expect(r.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('Goes to (builder item 225)', () => {
  test('a button goes to a page or a named part of one; picking writes the link and saves it', async ({ page }) => {
    const m = await editor(page);
    await card(page, 2, 'content');
    await page.locator('#blocksCard .lp-open').click();
    const pop = page.getByRole('menu', { name: 'Where it goes' });
    await expect(pop.locator('.lp-grp')).toHaveText(['Pages', 'Parts of a page', 'Somewhere else']);
    await expect(pop.getByRole('menuitem', { name: 'Home', exact: true })).toBeVisible();
    await pop.getByRole('menuitem', { name: /Home › Opening hours/ }).click();
    await expect(page.locator('#blocksCard input[placeholder="Where the button goes (optional link)"]')).toHaveValue('/#hours');
    await expect.poll(() => lastBlocks(m)?.[2]?.url).toBe('/#hours');
    await expect(page.locator('#blocksCard .lp-says')).toHaveText('Jumps to Opening hours on Home');
  });

  test('Escape closes the list and gives the button back the cursor @layout', async ({ page }) => {
    await editor(page);
    await card(page, 2, 'content');
    const open = page.locator('#blocksCard .lp-open');
    await open.click();
    const pop = page.getByRole('menu', { name: 'Where it goes' });
    await expect(pop).toBeVisible();
    const r = (await pop.boundingBox())!, w = page.viewportSize()!.width, h = page.viewportSize()!.height;
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5); expect(r.y + r.height).toBeLessThanOrEqual(h + 0.5);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('a menu item goes to a named part of a page', async ({ page }) => {
    const m = await editor(page);
    await page.evaluate(() => (window as any).pgOpenLink(null));
    const dlg = page.getByRole('dialog', { name: 'Add a link' });
    await dlg.getByLabel('Label in the menu').fill('Hours');
    await dlg.locator('.lp-open').click();
    await page.getByRole('menu', { name: 'Where it goes' }).getByRole('menuitem', { name: /Home › Opening hours/ }).click();
    await expect(dlg.getByLabel('Links to')).toHaveValue('/#hours');
    await dlg.getByRole('button', { name: 'Add to the menu' }).click();
    await expect.poll(() => m.writes.filter((w) => w.path === '/settings' && w.body && w.body.nav).at(-1)?.body.nav.at(-1)).toEqual({ label: 'Hours', href: '/#hours' });
  });
});
