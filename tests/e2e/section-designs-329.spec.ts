import { test, expect, Page, Route, Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { smallTargets, say } from './helpers/tap-walk';

// Builder item 329: the bold section designs Eric picked in Figma (section C, node 455:7). Part one,
// a client's published page with all eight designs, as the renderer draws them today for three
// templates (tests/presence/section_designs_329_test.mjs writes the pages, the stylesheet inlined,
// and fails when they go stale): on a phone each stacks cleanly, nothing is wider than the screen,
// every link, button and question is a 44px target, and on a wider screen each takes its drawn
// layout (the photo off the page's edge under a card, numbered columns, two columns of prices, the
// middle plan raised, the questions beside their heading). Part two, the editor: each design is
// picked on its section's Layout tab by its plain name, saves, and its own choices and fields work.

// ── part one: the published page ──
const SITE = 'https://shop.example';
const TEMPLATES = ['business-classic', 'editorial', 'slate'];
// a 16 by 10 grey picture for every photo the page asks for
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAAFElEQVR42mPYsmoBSYhhVMPQ1AAALgk+0OxUxMMAAAAASUVORK5CYII=', 'base64');
const pageHtml = (slug: string) => readFileSync(join(__dirname, 'fixtures', 'section-designs-329', `${slug}.html`), 'utf8');
async function openPage(page: Page, slug: string) {
  // the last route registered answers first: anything else, then the pictures, then the page
  await page.route('**/*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route(`${SITE}/img/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(`${SITE}/designs/`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml(slug) }));
  await page.goto(`${SITE}/designs/`);
  await expect(page.locator('section.v-overlap').first()).toBeVisible();
}
const wide = (page: Page) => (page.viewportSize()?.width || 0) >= 760;
type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const boxOf = (l: Locator) => l.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width, height: r.height }; }) as Promise<Box>;
const boxesOf = (l: Locator) => l.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width, height: r.height }; })) as Promise<Box[]>;
const section = (page: Page, cls: string, n = 0) => page.locator(`section.${cls}`).nth(n);
const oneColumn = (bs: Box[]) => bs.every((b, i) => i === 0 || (Math.abs(b.left - bs[0].left) < 2 && b.top >= bs[i - 1].bottom - 1));

for (const slug of TEMPLATES) {
  test.describe(`the bold designs on a client’s page [${slug}]`, { tag: '@layout' }, () => {
    test('nothing is wider than the screen; every design’s words sit inside it', async ({ page }) => {
      await openPage(page, slug);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling').toBe(true);
      const width = await page.evaluate(() => innerWidth);
      const words = await boxesOf(page.locator('.iw-card, .iw-words, .fn-item, .ft-tile, .pm-col, .pp-card, .qs-head, .qs-item, .qn-item'));
      expect(words).toHaveLength(24);   // two cards and the frame's words, 3 + 4 features, 3 price columns, 3 plans, the heading and 3 questions, 4 numbered
      for (const b of words) expect(b.left >= -0.5 && b.right <= width + 0.5, `a box at ${Math.round(b.left)}–${Math.round(b.right)} inside ${width}`).toBe(true);
    });

    test('image + text: the photo off the edge under a card; the photo on its colour block, a big number beside', async ({ page }) => {
      await openPage(page, slug);
      const width = await page.evaluate(() => innerWidth);
      const over = section(page, 'v-overlap'), media = await boxOf(over.locator('.iw-media')), card = await boxOf(over.locator('.iw-card'));
      expect(media.left, 'the photo reaches the page’s left edge').toBeLessThanOrEqual(1);
      if (wide(page)) {
        expect(card.left, 'the card overlaps the photo').toBeLessThan(media.right - 20);
        expect(card.top > media.top && card.bottom < media.bottom, 'the card sits within the photo’s height').toBe(true);
        const right = section(page, 'v-overlap', 1), m2 = await boxOf(right.locator('.iw-media')), c2 = await boxOf(right.locator('.iw-card'));
        expect(m2.right, 'picked for the right: the photo reaches the right edge').toBeGreaterThanOrEqual(width - 1);
        expect(c2.right).toBeGreaterThan(m2.left + 20);
      } else {
        expect(media.right, 'on a phone the photo runs edge to edge').toBeGreaterThanOrEqual(width - 1);
        expect(card.top > media.top && card.top < media.bottom, 'the card rises over the photo’s foot').toBe(true);
        expect(card.left >= 0 && card.right <= width).toBe(true);
      }
      const frame = section(page, 'v-frame'), fm = await boxOf(frame.locator('.iw-media')), fw = await boxOf(frame.locator('.iw-words'));
      if (wide(page)) expect(fw.left, 'the words beside the photo').toBeGreaterThan(fm.right);
      else expect(fw.top, 'on a phone the words under the photo').toBeGreaterThanOrEqual(fm.bottom - 1);
      // the colour block behind the photo, offset, in the accent colour
      const block = await frame.locator('.iw-media').evaluate((e) => { const s = getComputedStyle(e, '::before'); return { bg: s.backgroundColor, left: parseFloat(s.left), top: parseFloat(s.top) }; });
      expect(block.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(block.left).toBeGreaterThan(0);
      const big = frame.locator('.iw-big');
      await expect(big).toHaveText('15');
      expect(parseFloat(await big.evaluate((e) => getComputedStyle(e).fontSize)), 'a big number').toBeGreaterThan(48);
    });

    test('features: numbered columns under thick rules; icon tiles on a dark band', async ({ page }) => {
      await openPage(page, slug);
      const items = await boxesOf(section(page, 'block-features.v-numbered').locator('.fn-item'));
      expect(items).toHaveLength(3);
      if (wide(page)) expect(items[1].left > items[0].right && Math.abs(items[1].top - items[0].top) < 2, 'side by side').toBe(true);
      else expect(oneColumn(items), 'one column on a phone').toBe(true);
      expect(await section(page, 'block-features.v-numbered').locator('.fn-item').first().evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth))).toBe(4);
      await expect(section(page, 'block-features.v-numbered').locator('.fn-num').first()).toHaveText('01');
      const tiles = section(page, 'v-tiles');
      expect(await tiles.evaluate((e) => getComputedStyle(e).backgroundColor), 'the dark band').toBe('rgb(26, 22, 34)');
      const tb = await boxesOf(tiles.locator('.ft-tile'));
      expect(tb).toHaveLength(4);
      if (wide(page)) expect(Math.abs(tb[1].top - tb[0].top) < 2 && tb[1].left > tb[0].right, 'tiles in a row').toBe(true);
      else expect(oneColumn(tb), 'one column on a phone').toBe(true);
      await expect(tiles.locator('.ft-ic svg')).toHaveCount(3);
    });

    test('prices: a printed list in two columns; three plans with the middle one raised', async ({ page }) => {
      await openPage(page, slug);
      const menu = section(page, 'v-menu'), cols = await boxesOf(menu.locator('.pm-col'));
      expect(cols).toHaveLength(2);
      if (wide(page)) expect(cols[1].left > cols[0].right && Math.abs(cols[1].top - cols[0].top) < 2, 'two columns').toBe(true);
      else expect(cols[1].top, 'one column on a phone').toBeGreaterThanOrEqual(cols[0].bottom - 1);
      // every row: the name, a dotted line filling the gap, the price at the far end
      for (const row of await menu.locator('.pm-line').all()) {
        const [name, dots, price] = await Promise.all([boxOf(row.locator('.pm-name')), boxOf(row.locator('.pm-dots')), boxOf(row.locator('.pm-price'))]);
        expect(dots.width).toBeGreaterThan(20);
        expect(name.right <= dots.left + 1 && dots.right <= price.left + 1).toBe(true);
      }
      await expect(section(page, 'v-menu', 1).locator('.pm-col')).toHaveCount(1);   // four rows or fewer: one column
      const plans = section(page, 'v-plans'), cards = await boxesOf(plans.locator('.pp-card'));
      expect(cards).toHaveLength(3);
      await expect(plans.locator('.pp-card').nth(1)).toHaveClass(/pp-on/);
      await expect(plans.locator('.pp-on .pp-badge')).toHaveText('Most popular');
      if (wide(page)) {
        expect(cards[1].top < cards[0].top && cards[1].bottom > cards[0].bottom, 'the middle one stands taller').toBe(true);
        expect(Math.abs(cards[0].height - cards[2].height) < 2, 'the other two match').toBe(true);
      } else expect(oneColumn(cards), 'one column on a phone').toBe(true);
    });

    test('questions: beside the heading, opening with a plus; numbered with the answers showing', async ({ page }) => {
      await openPage(page, slug);
      const side = section(page, 'v-side'), head = await boxOf(side.locator('.qs-head')), list = await boxOf(side.locator('.qs-list'));
      if (wide(page)) expect(list.left, 'the questions to the right of the heading').toBeGreaterThan(head.right);
      else expect(list.top).toBeGreaterThanOrEqual(head.bottom - 1);
      await expect(side.locator('.qs-intro')).toBeVisible();
      const items = side.locator('details.qs-item');
      await expect(items.nth(0)).toHaveAttribute('open', '');
      await expect(items.nth(1)).not.toHaveAttribute('open', '');
      const plus = () => items.nth(1).locator('summary').evaluate((e) => getComputedStyle(e, '::after').backgroundImage.split('linear-gradient').length - 1);
      expect(await plus(), 'a plus: two bars').toBe(2);
      await items.nth(1).locator('summary').click();
      await expect(items.nth(1)).toHaveAttribute('open', '');
      expect(await plus(), 'open: a minus, one bar').toBe(1);
      await expect(items.nth(1).locator('.prose')).toBeVisible();
      await items.nth(1).locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(items.nth(1)).not.toHaveAttribute('open', '');
      const numbered = section(page, 'block-accordion.v-numbered');
      expect(await numbered.evaluate((e) => getComputedStyle(e).backgroundColor), 'a tinted band').not.toBe('rgba(0, 0, 0, 0)');
      const q = await boxesOf(numbered.locator('.qn-item'));
      expect(q).toHaveLength(4);
      if (wide(page)) expect(q[2].left > q[0].right && q[1].top > q[0].top, 'two columns, reading down the first').toBe(true);
      else expect(oneColumn(q), 'one column on a phone').toBe(true);
      await expect(numbered.locator('.qn-item .prose').first()).toBeVisible();
    });
  });

  test(`every link, button and question in the designs is a 44px target [${slug}] @touch`, async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only');
    // the site scrolls smoothly unless asked for less motion; the walk scrolls each control to the middle at once
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPage(page, slug);
    for (const within of ['section.v-overlap', 'section.v-frame', 'section.block-accordion.v-side']) {
      const small = await smallTargets(page, within);
      expect(small, `${within}: ${say(small)}`).toEqual([]);
    }
  });
}

// ── part two: the editor ──
const BLOCKS = [
  { type: 'features', title: 'Why clients stay', items: [{ title: 'A fixed fee', text: 'Agreed first.' }, { title: 'A partner on every case', text: 'From the first call.' }, { title: 'Answers within a day', text: 'Always.' }] },
  { type: 'pricing', title: 'Pick how you train', tiers: [{ name: 'Drop in', price_text: '$25', features: ['Any class'] }, { name: 'Unlimited', price_text: '$129 a month', features: ['Every class'] }, { name: 'Ten classes', price_text: '$199', features: ['Share with a friend'] }] },
  { type: 'accordion', title: 'Questions people ask', items: [{ summary: 'Do you charge for estimates?', body: 'No, never.' }, { summary: 'Do you pull the permits?', body: 'Every time.' }] },
  { type: 'image_text', title: 'Gardens that look after themselves', body: 'Native plants and drip watering.', side: 'left' },
];
const META = { blocks: BLOCKS.map((b, i) => ({ sid: b.type, key: 'block_' + b.type, src_index: i })), pages: {} };
const CANVAS = '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>:root{--paper:#fbf8f3;--ink:#231c17;--accent:#8a4b2a}body{margin:0;background:var(--paper);color:var(--ink);font-family:Georgia,serif}section{padding:40px 24px}</style></head><body class="site">'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Fernwood Gardens</h1></section>'
  + BLOCKS.map((b, i) => `<section data-dds-sid="${b.type}" data-dds-key="block_${b.type}" data-dds-src="${i}" class="block block-${b.type}"><h2 data-dds-field="title">${b.title}</h2></section>`).join('')
  + '</main></body></html>';
// what the server draws for one section of the list, marked with the design it was asked for
const drawnSection = (b: any, i: number) => {
  const way = b.variant || (b.type === 'image_text' ? 'side-' + (b.side || 'left') : 'default');
  return `<section class="block block-${b.type} v-${way}" data-dds-src="${i}" data-way="${way}"><h2>${b.title}</h2></section>`;
};
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'meadow', template_version: 1 }, identity: { business_name: 'Fernwood Gardens' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Write = { method: string; path: string; body: any };
async function mountEditor(page: Page) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META };
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
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: CANVAS }));
  // registered last, so it answers the one-section drawings before the page route above
  await page.route('**/functions/v1/presence/preview/section', (route: Route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { html: drawnSection(body.blocks[body.index], body.index) } }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return writes;
}
const openSection = async (page: Page, i: number, tab: string) => { await page.evaluate(([n, t]) => (window as any).eeEditBlock(n, t), [i, tab] as const); await expect(page.locator('#settingsPanel')).toHaveClass(/\bon\b/); };
const toTab = (page: Page, tab: string) => page.locator(`#inspectorSeg [data-itab="${tab}"]`).click();
const tiles = (page: Page) => page.locator('#settingsPanel [data-group="arrangement"] .ins-live-tile');
const names = (page: Page) => tiles(page).locator('.ins-live-name > span:first-child').allTextContents();
const tile = (page: Page, name: string) => tiles(page).filter({ has: page.locator('.ins-live-name > span:first-child', { hasText: new RegExp(`^${name}$`) }) });
const lastBlocks = (writes: Write[]) => writes.filter((w) => w.path === '/settings' && w.body && w.body.blocks).at(-1)?.body.blocks;
const saved = (writes: Write[], i: number) => () => lastBlocks(writes)?.[i];
// the frames each tile draws, read from the editor (the frames run nothing themselves)
const ways = (page: Page) => page.locator('#settingsPanel [data-group="arrangement"]').evaluate((g) => [...g.querySelectorAll('.ins-live-win')].map((w) => {
  const f = w.querySelector('iframe') as HTMLIFrameElement | null;
  return f && f.contentDocument ? f.contentDocument.querySelector('[data-way]')?.getAttribute('data-way') || null : null;
}));

test.describe('picking the bold designs in the editor (builder item 329)', () => {
  test('features: Numbered and Icon tiles on a dark band, each drawn live, picked and saved', async ({ page }) => {
    const writes = await mountEditor(page);
    await openSection(page, 0, 'layout');
    expect(await names(page)).toEqual(['Grid', 'Numbered', 'Icon tiles on a dark band']);
    await expect(tile(page, 'Grid')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => ways(page), { timeout: 10000 }).toEqual(['default', 'numbered', 'tiles']);
    await tile(page, 'Numbered').click();
    await expect.poll(() => saved(writes, 0)()?.variant, { timeout: 8000 }).toBe('numbered');
    await tile(page, 'Icon tiles on a dark band').click();
    await expect.poll(() => saved(writes, 0)()?.variant, { timeout: 8000 }).toBe('tiles');
    await expect(tile(page, 'Icon tiles on a dark band')).toHaveAttribute('aria-pressed', 'true');
    expect(saved(writes, 0)()?.items).toHaveLength(3);   // the words stay as they were
  });

  test('prices: Printed price list and Three plans; the plan to raise, the middle one by default', async ({ page }) => {
    const writes = await mountEditor(page);
    await openSection(page, 1, 'layout');
    expect(await names(page)).toEqual(['Cards', 'Price list', 'Printed price list', 'Three plans']);
    await expect(page.getByLabel('Most popular plan')).toHaveCount(0);   // only with Three plans
    await tile(page, 'Three plans').click();
    await expect.poll(() => saved(writes, 1)()?.variant, { timeout: 8000 }).toBe('plans');
    const raise = page.getByLabel('Most popular plan');
    await expect(raise).toBeVisible();
    await expect(raise).toHaveValue('2');   // Unlimited, the middle one of three
    expect(await raise.locator('option').allTextContents()).toEqual(['None', 'Drop in', 'Unlimited', 'Ten classes']);
    await raise.selectOption({ label: 'Ten classes' });
    await expect.poll(() => saved(writes, 1)()?.featured, { timeout: 8000 }).toBe(3);
    await expect(page.getByLabel('Most popular plan')).toHaveValue('3');
    // a change to the prices themselves keeps the plan raised (the section is rebuilt from its fields)
    await toTab(page, 'content');
    const lines = page.locator('#settingsPanel textarea').first();
    await lines.fill('Drop in | $25 | Any class\nUnlimited | $129 a month | Every class\nTen classes | $189 | Share with a friend');
    await lines.blur();
    await expect.poll(() => saved(writes, 1)()?.tiers?.[2]?.price_text, { timeout: 8000 }).toBe('$189');
    expect(saved(writes, 1)()?.featured).toBe(3);
    expect(saved(writes, 1)()?.variant).toBe('plans');
    await toTab(page, 'layout');
    await tile(page, 'Printed price list').click();
    await expect.poll(() => saved(writes, 1)()?.variant, { timeout: 8000 }).toBe('menu');
    await expect(page.getByLabel('Most popular plan')).toHaveCount(0);
  });

  test('questions: beside the heading with its short line, and numbered', async ({ page }) => {
    const writes = await mountEditor(page);
    await openSection(page, 2, 'layout');
    expect(await names(page)).toEqual(['Accordion', 'Open, in two columns', 'Questions beside the heading', 'Numbered questions']);
    await tile(page, 'Questions beside the heading').click();
    await expect.poll(() => saved(writes, 2)()?.variant, { timeout: 8000 }).toBe('side');
    await toTab(page, 'content');
    const line = page.getByLabel('A short line under the heading (optional)');
    await expect(line).toBeVisible();
    await line.fill('Still not sure? Ask us anything.');
    await line.blur();
    await expect.poll(() => saved(writes, 2)()?.intro, { timeout: 8000 }).toBe('Still not sure? Ask us anything.');
    await toTab(page, 'layout');
    await tile(page, 'Numbered questions').click();
    await expect.poll(() => saved(writes, 2)()?.variant, { timeout: 8000 }).toBe('numbered');
    await toTab(page, 'content');
    await expect(page.getByLabel('A short line under the heading (optional)')).toHaveCount(0);   // that design has no such line
    expect(saved(writes, 2)()?.items).toHaveLength(2);
  });

  test('image + text: Photo off the edge, its side, and Photo in a colour frame with its big number', async ({ page }) => {
    const writes = await mountEditor(page);
    await openSection(page, 3, 'layout');
    expect(await names(page)).toEqual(['Photo on the left', 'Photo on the right', 'Photo off the edge', 'Photo in a colour frame']);
    await expect.poll(() => ways(page), { timeout: 10000 }).toEqual(['side-left', 'side-right', 'overlap', 'frame']);
    await expect(page.locator('#settingsPanel [data-group="photo-side"]')).toHaveCount(0);
    await tile(page, 'Photo off the edge').click();
    await expect.poll(() => saved(writes, 3)()?.variant, { timeout: 8000 }).toBe('overlap');
    await expect(tile(page, 'Photo off the edge')).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, 'Photo on the left')).toHaveAttribute('aria-pressed', 'false');
    const sideGroup = page.locator('#settingsPanel [data-group="photo-side"]');
    await expect(sideGroup.locator('.ins-tile')).toHaveCount(2);
    await sideGroup.locator('.ins-tile', { hasText: 'On the right' }).click();
    await expect.poll(() => saved(writes, 3)()?.side, { timeout: 8000 }).toBe('right');
    expect(saved(writes, 3)()?.variant).toBe('overlap');
    await tile(page, 'Photo in a colour frame').click();
    await expect.poll(() => saved(writes, 3)()?.variant, { timeout: 8000 }).toBe('frame');
    expect(saved(writes, 3)()?.side).toBe('right');   // the side picked stays
    await toTab(page, 'content');
    const num = page.getByLabel('Big number (optional)'), what = page.getByLabel('What the number counts (optional)');
    await num.fill('15');
    await num.blur();
    await what.fill('years planting gardens');
    await what.blur();
    await expect.poll(() => saved(writes, 3)()?.number_label, { timeout: 8000 }).toBe('years planting gardens');
    expect(saved(writes, 3)()?.number).toBe('15');
    // and picking a side photo layout again keeps the words, numbers and all, for when it comes back
    await toTab(page, 'layout');
    await tile(page, 'Photo on the left').click();
    await expect.poll(() => saved(writes, 3)()?.variant ?? '', { timeout: 8000 }).toBe('');
    expect(saved(writes, 3)()?.number).toBe('15');
    expect(saved(writes, 3)()?.side).toBe('left');
  });

  test('@touch the designs’ own choices and fields are full 44px targets', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only');
    await mountEditor(page);
    await openSection(page, 3, 'layout');
    await tile(page, 'Photo in a colour frame').click();
    await expect(page.locator('#settingsPanel [data-group="photo-side"]')).toBeVisible();
    let small = await smallTargets(page, '#settingsPanel [data-group="photo-side"]');
    expect(small, say(small)).toEqual([]);
    await toTab(page, 'content');
    for (const label of ['Big number (optional)', 'What the number counts (optional)']) expect((await page.getByLabel(label).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await openSection(page, 1, 'layout');
    await tile(page, 'Three plans').click();
    await expect(page.getByLabel('Most popular plan')).toBeVisible();
    small = await smallTargets(page, '#settingsPanel [data-group="featured"]');
    expect(small, say(small)).toEqual([]);
    await openSection(page, 2, 'layout');
    await tile(page, 'Questions beside the heading').click();
    await toTab(page, 'content');
    expect((await page.getByLabel('A short line under the heading (optional)').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
