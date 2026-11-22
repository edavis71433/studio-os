import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { galleryPayload } from '../../supabase/functions/presence/lib/design_gallery.ts';
import { openingsPayload, KIND_OPENINGS } from '../../supabase/functions/presence/lib/kind_openings.ts';
import { mountCanvas, SETTINGS } from './helpers/editor';

// The openings made for a kind of business (Figma section B, Nov 22 2026): in + New site, a salon,
// a home services business and a restaurant or café each see three ways to open first, as pictures
// with plain names, the first one picked, then the eight designs as before. Picking one sends its
// key on the same POST /agency/sites, with its design. Every other kind is as it was. "See it full
// size" draws an opening. The gallery is the server's own payload (lib/design_gallery.ts with
// lib/kind_openings.ts); tests/presence/kind_openings_test.mjs drives the server. Hermetic.

const TEMPLATES = [['atelier', 'Atelier'], ['aurora', 'Aurora'], ['business-classic', 'Business Classic'], ['editorial', 'Editorial'],
  ['harbor', 'Harbor'], ['meadow', 'Meadow'], ['restaurant-classic', 'Restaurant Classic'], ['slate', 'Slate']].map(([slug, name]) => ({ slug, name }));
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const KITS = [{ id: 't1', name: 'Bakery site', kind: 'template', summary: { pages: 5, sections: 23, photos: 14 } }];
const NAMES = (family: string) => KIND_OPENINGS.filter((o) => o.family === family).map((o) => o.name);
const SAMPLE = (who: string) => `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}</style></head><body><h1 id="who">${who}</h1></body></html>`;

async function openSheet(page: Page) {
  const posts: Array<Record<string, unknown>> = [], samples: string[] = [];
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: [], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90, room: { used: 0, limit: 25, full: false } },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    '/agency/designs': { data: galleryPayload(TEMPLATES, openingsPayload()) },
    '/agency/kits': { data: KITS },
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites$/, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    posts.push(body);
    const o = KIND_OPENINGS.find((x) => x.key === body.opening);
    const look = body.template_slug ? { slug: body.template_slug, name: TEMPLATES.find((t) => t.slug === body.template_slug)?.name, applied: true } : null;
    return route.fulfill(json({ data: { site_id: 's-made', client_id: 'c-made', name: String(body.business_name).trim(), kit: null, look, industry: body.industry_key ? { key: body.industry_key, applied: true } : null,
      opening: o ? { key: o.key, name: o.name, slug: o.design, layout: o.layout, applied: { layout: true, style: true } } : null } }, 201));
  });
  await page.route(/\/functions\/v1\/presence\/agency\/designs\/[a-z-]+\/sample(\?.*)?$/, async (route: Route) => {
    const u = new URL(route.request().url()), slug = u.pathname.split('/').at(-2)!;
    const who = `${slug} · ${u.searchParams.get('kind') || ''} · ${u.searchParams.get('opening') || 'no opening'}`;
    samples.push(who);
    return route.fulfill(json({ data: { html: SAMPLE(who) } }));
  });
  await page.goto('/sites.html');
  await page.getByRole('button', { name: '+ New site' }).first().click();
  const dlg = page.locator('#newDlg');
  await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
  return { dlg, posts, samples };
}
const kind = (dlg: ReturnType<Page['locator']>, name: string) => dlg.locator('#new-kinds .kind', { hasText: name }).click();

test.describe('+ New site: the openings made for a kind of business', () => {
  test('a salon sees its three openings first, the first one picked, then the eight designs as before', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const { dlg } = await openSheet(page);
    await expect(dlg.locator('#new-open-wrap')).toBeHidden();   // no kind yet: the designs alone, as before
    await kind(dlg, 'Salon or spa');
    const cards = dlg.locator('#new-openings .dcard');
    await expect(cards.locator('b')).toHaveText(NAMES('beauty'));
    await expect(cards.first().locator('b')).toHaveText('Split on a colour panel · Blush');
    expect(await cards.locator('img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))).toEqual(['/thumbs/openings/beauty-panel.jpg', '/thumbs/openings/beauty-photo.jpg', '/thumbs/openings/beauty-editorial.jpg']);
    await expect(dlg.locator('#new-open-h')).toHaveText('Made for salons');
    await expect(dlg.locator('#new-openings input:checked')).toHaveValue('op:beauty-panel');
    await expect(dlg.locator('#new-designs input:checked')).toHaveCount(0);
    await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
    // the openings come before the designs on the page
    const [o, d] = await Promise.all([dlg.locator('#new-openings').boundingBox(), dlg.locator('#new-designs').boundingBox()]);
    expect(o!.y).toBeLessThan(d!.y);
    await expect(dlg.locator('#new-lookline')).toContainText('Three ways to open made for salons come first, then the eight designs.');
    await expect(dlg.locator('#new-sum-pic img')).toHaveAttribute('src', '/thumbs/openings/beauty-panel.jpg');
    await expect(dlg.locator('#new-sum-b')).toHaveText('Split on a colour panel · Blush · starts private, nothing published');
    for (const n of [...NAMES('beauty'), ...NAMES('home'), ...NAMES('food')]) expect(n).not.toMatch(/[—–_]/);
    expect(errors).toEqual([]);
  });

  test('picking an opening sends its key with its design, on the same call', async ({ page }) => {
    const { dlg, posts } = await openSheet(page);
    await dlg.locator('#new-biz').fill('Ridge Builders');
    await kind(dlg, 'Home services');
    await expect(dlg.locator('#new-openings input:checked')).toHaveValue('op:home-type');
    await dlg.locator('#new-openings .dcard', { hasText: 'Words over the photo · Steady navy' }).click();
    await expect(dlg.locator('#new-openings input:checked')).toHaveValue('op:home-photo');
    await expect(dlg.locator('#new-sum-b')).toHaveText('Words over the photo · Steady navy · starts private, nothing published');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-look-line')).toHaveText('It starts with the Harbor design, opening as “Words over the photo · Steady navy”. You can change it any time in the editor, under Styles.');
    expect(posts).toEqual([{ business_name: 'Ridge Builders', template_slug: 'harbor', industry_key: 'home_services', opening: 'home-photo' }]);
  });

  test('a restaurant left as it opens sends its first opening; a closer kind keeps it', async ({ page }) => {
    const { dlg, posts } = await openSheet(page);
    await dlg.locator('#new-biz').fill('Vine Bar');
    await kind(dlg, 'Restaurant or café');
    await dlg.locator('#new-exact').selectOption('bar');
    await expect(dlg.locator('#new-openings input:checked')).toHaveValue('op:food-photo');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(posts).toEqual([{ business_name: 'Vine Bar', template_slug: 'restaurant-classic', industry_key: 'bar', opening: 'food-photo' }]);
  });

  test('every other kind is as it was: no openings, its first design picked, no opening sent', async ({ page }) => {
    const { dlg, posts } = await openSheet(page);
    await dlg.locator('#new-biz').fill('Juniper Floral');
    await kind(dlg, 'Shop');
    await expect(dlg.locator('#new-open-wrap')).toBeHidden();
    await expect(dlg.locator('#new-openings .dcard')).toHaveCount(0);
    await expect(dlg.locator('#new-designs input:checked')).toHaveValue('atelier');
    await expect(dlg.locator('#new-lookline')).toContainText('The three that suit shops come first.');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(posts).toEqual([{ business_name: 'Juniper Floral', template_slug: 'atelier', industry_key: 'retail' }]);
  });

  test('a design picked by hand replaces the opening and stays; another kind’s openings replace an opening', async ({ page }) => {
    const { dlg, posts } = await openSheet(page);
    await dlg.locator('#new-biz').fill('Linden Hair');
    await kind(dlg, 'Salon or spa');
    await kind(dlg, 'Home services');
    await expect(dlg.locator('#new-openings input:checked')).toHaveValue('op:home-type');   // an opening belongs to its kind
    await dlg.locator('#new-designs .dcard', { hasText: 'Meadow' }).click();
    await expect(dlg.locator('#new-openings input:checked')).toHaveCount(0);
    await kind(dlg, 'Salon or spa');
    await expect(dlg.locator('#new-designs input:checked')).toHaveValue('meadow');   // a design picked by hand stays picked
    await expect(dlg.locator('#new-openings input:checked')).toHaveCount(0);
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(posts).toEqual([{ business_name: 'Linden Hair', template_slug: 'meadow', industry_key: 'salon' }]);
  });

  test('a saved template is the other kind of start: no opening is sent with it', async ({ page }) => {
    const { dlg, posts } = await openSheet(page);
    await dlg.locator('#new-biz').fill('Rise Bakery');
    await kind(dlg, 'Restaurant or café');
    await dlg.locator('#new-tpls .tcard').click();
    await expect(dlg.locator('#new-openings input:checked')).toHaveCount(0);
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(posts).toEqual([{ business_name: 'Rise Bakery', kit_id: 't1', industry_key: 'restaurant' }]);
  });

  test('See it full size draws an opening, and Use this look picks it', async ({ page }) => {
    const { dlg, samples } = await openSheet(page);
    await kind(dlg, 'Salon or spa');
    await dlg.locator('[data-full-opening="beauty-editorial"]').click();
    const big = page.locator('#bigDlg');
    await expect(big).toBeVisible();
    await expect(big.locator('#bigHead')).toHaveText('Centred editorial · Golden hour');
    await expect(big.locator('#bigSub')).toHaveText('A sample salon opening this way, on the Atelier design. The site’s own words and photos replace it.');
    // the frame shows the page it was given (read from the frame's own srcdoc: WebKit can't always be read
    // inside a frame with no scripts and no origin of its own)
    await expect(big.locator('#bigFrame')).toHaveAttribute('srcdoc', /<h1 id="who">atelier · salon · beauty-editorial<\/h1>/);
    expect(samples).toEqual(['atelier · salon · beauty-editorial']);
    await expect(big.locator('#bigUse')).toHaveText('Use this look');
    await big.locator('#bigUse').click();
    await expect(big).toBeHidden();
    await expect(dlg.locator('#new-openings input:checked')).toHaveValue('op:beauty-editorial');
    // a design's own See it full size is as it was
    await dlg.locator('[data-full="harbor"]').click();
    await expect(big.locator('#bigHead')).toHaveText('Harbor');
    await expect(big.locator('#bigUse')).toHaveText('Use this design');
    await expect(big.locator('#bigFrame')).toHaveAttribute('srcdoc', /<h1 id="who">harbor · salon · no opening<\/h1>/);
  });

  test('every opening and its See it full size is a full 44px tap on a touch screen; a phone shows one to a row', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only');
    const { dlg } = await openSheet(page);
    await kind(dlg, 'Home services');
    const heights = await dlg.locator('#new-openings .dcard, #new-openings .dfull').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights).toHaveLength(6);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    if ((page.viewportSize()?.width || 1280) < 761) {
      const xs = await dlg.locator('#new-openings .dcard').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      expect(new Set(xs).size).toBe(1);
      const over = await dlg.locator('#new-openings').evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(over).toBeLessThanOrEqual(1);
    }
  });
});

// The editor: each opening's own setting stays the owner's to change, beside the layout it goes with
// (Styles, the Looks tab): what sits on the photo, where the colour panel's photo sits, and whether
// Type only's big words are on a band of colour or on the page.
async function styles(page: Page, layout: string, tokens: Record<string, string> = {}) {
  const writes: Array<Record<string, string>> = [];
  let saved = { ...tokens };
  await mountCanvas(page, {
    settings: { ...SETTINGS, hero_layout: layout, cover_media_id: 'm-1' },
    beforeGoto: async (p) => {
      await p.route('**/functions/v1/presence/dev/customization', (route: Route) => {
        if (route.request().method() === 'PUT') { saved = route.request().postDataJSON().theme_tokens || {}; writes.push(saved); }
        return route.fulfill(json({ data: { theme_tokens: saved, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } }));
      });
    },
  });
  await page.evaluate(() => (window as any).openSettingsPanel('styles'));
  await page.locator('#stylesSeg [data-stab="looks"]').click();
  return { writes, row: page.locator('#designCard #heroSide') };
}
test.describe('Styles: each opening’s own setting, beside its layout', () => {
  test('words over the photo: the card on the photo, saved as the opening sets it, and taken off again', async ({ page }) => {
    const { writes, row } = await styles(page, 'photo', { hero_card: 'today' });
    await expect(row.getByRole('button')).toHaveText(['Nothing', 'A form asking for an estimate', 'Today’s hours and booking ✓']);
    await row.getByRole('button', { name: 'Nothing', exact: true }).click();
    await expect.poll(() => writes.at(-1)).toEqual({});
    await expect(page.getByText('On the photo: Nothing. Publish to see it live.')).toBeVisible();
    await page.locator('#stylesSeg [data-stab="looks"]').click();
    await page.locator('#designCard #heroSide').getByRole('button', { name: 'A form asking for an estimate', exact: true }).click();
    await expect.poll(() => writes.at(-1)).toEqual({ hero_card: 'estimate' });
  });

  test('the colour panel: the photo on the left or the right', async ({ page }) => {
    const { writes, row } = await styles(page, 'panel', { hero_photo: 'left', accent: '#123456' });
    await expect(row.getByRole('button')).toHaveText(['On the right', 'On the left ✓']);
    await row.getByRole('button', { name: 'On the right', exact: true }).click();
    await expect.poll(() => writes.at(-1)).toEqual({ accent: '#123456' });
  });

  test('Type only: on a band of colour or on the page, and the line under the layouts says which', async ({ page }) => {
    const { writes, row } = await styles(page, 'type', { hero_band: 'off' });
    await expect(row.getByRole('button')).toHaveText(['A band of your colour', 'The page itself ✓']);
    await expect(page.locator('#designCard #heroSays')).toContainText('Your tagline in big words on the page itself');
    await row.getByRole('button', { name: 'A band of your colour', exact: true }).click();
    await expect.poll(() => writes.at(-1)).toEqual({});
    await page.locator('#stylesSeg [data-stab="looks"]').click();
    await expect(page.locator('#designCard #heroSays')).toContainText('Your tagline in big words on a band of your colour');
  });

  test('the other layouts have no such row; on a touch screen each choice is a full 44px tap', async ({ page }) => {
    const { row } = await styles(page, 'editorial');
    await expect(row).toHaveCount(0);
    if (!test.info().project.use.hasTouch) return;
    const again = await styles(page, 'photo');
    const heights = await again.row.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
    expect(heights).toHaveLength(3);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});
