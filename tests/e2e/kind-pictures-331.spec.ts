import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { galleryPayload } from '../../supabase/functions/presence/lib/design_gallery.ts';

// Builder item 331: each kind of business has its own sample, so the design pictures follow the
// kind picked (a salon owner sees eight salons), and "See it full size" draws the kind's sample
// live in the design, at a computer's width or a phone's, in + New site and on Templates. The
// sample page here stands in for GET /agency/designs/:slug/sample (the pure suite drives the
// real one). Hermetic: nothing leaves.

const TEMPLATES = [['atelier', 'Atelier'], ['aurora', 'Aurora'], ['business-classic', 'Business Classic'], ['editorial', 'Editorial'],
  ['harbor', 'Harbor'], ['meadow', 'Meadow'], ['restaurant-classic', 'Restaurant Classic'], ['slate', 'Slate']].map(([slug, name]) => ({ slug, name }));
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const SAMPLE = (slug: string, kind: string) => `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}h1{font-size:48px}</style></head><body><header><b>Sample</b></header><h1 id="who">${slug} · ${kind}</h1><p>${'Words. '.repeat(400)}</p></body></html>`;

async function open(page: Page, path = '/sites.html', sampleStatus = 200) {
  const samples: string[] = [];
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: [], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90, room: { used: 0, limit: 25, full: false } },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    '/agency/designs': { data: galleryPayload(TEMPLATES) },
    '/agency/kits': { data: [], can_manage: true },
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/designs\/[a-z-]+\/sample(\?.*)?$/, async (route: Route) => {
    const u = new URL(route.request().url()), slug = u.pathname.split('/').at(-2)!, kind = u.searchParams.get('kind') || '';
    samples.push(`${slug}?${kind}`);
    return route.fulfill(sampleStatus === 200 ? json({ data: { html: SAMPLE(slug, kind) } }) : json({ error: 'render_failed', message: 'x' }, sampleStatus));
  });
  await page.goto(path);
  return { samples };
}
async function openSheet(page: Page, sampleStatus = 200) {
  const t = await open(page, '/sites.html', sampleStatus);
  await page.getByRole('button', { name: '+ New site' }).first().click();
  const dlg = page.locator('#newDlg');
  await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
  return { ...t, dlg };
}

test.describe('Each kind its own pictures, and See it full size (builder item 331)', () => {
  test('with no kind, each design shows its own sample; pick a kind and all eight show that kind', async ({ page }) => {
    const { dlg } = await openSheet(page);
    await expect(dlg.locator('#new-designs .dcard[data-design="harbor"] img')).toHaveAttribute('src', '/thumbs/templates/harbor.jpg');
    await dlg.locator('#new-kinds .kind', { hasText: 'Salon or spa' }).click();
    const srcs = await dlg.locator('#new-designs .dcard img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
    expect(srcs).toHaveLength(8);
    expect(srcs.every((s) => /^\/thumbs\/templates\/[a-z-]+\/beauty\.jpg$/.test(String(s)))).toBe(true);
    await expect(dlg.locator('#new-sum-pic img')).toHaveAttribute('src', /\/beauty\.jpg$/);
    await dlg.locator('#new-kinds .kind', { hasText: 'Home services' }).click();
    await expect(dlg.locator('#new-designs .dcard[data-design="atelier"] img')).toHaveAttribute('src', '/thumbs/templates/atelier/home.jpg');
  });

  test('See it full size draws the kind’s sample in the design, at a computer’s width, then a phone’s', async ({ page }) => {
    const { dlg, samples } = await openSheet(page);
    await dlg.locator('#new-kinds .kind', { hasText: 'Salon or spa' }).click();
    await dlg.locator('[data-full="harbor"]').click();
    const big = page.locator('#bigDlg');
    await expect(big).toBeVisible();
    await expect(big.locator('#bigHead')).toHaveText('Harbor');
    await expect(big.locator('#bigSub')).toHaveText('A sample salon in this design. The site’s own words and photos replace it.');
    await expect(page.frameLocator('#bigFrame').locator('#who')).toHaveText('harbor · salon');
    expect(samples).toEqual(['harbor?salon']);
    await expect(big.locator('#bigFrame')).not.toHaveAttribute('sandbox', /allow-scripts/);
    if ((page.viewportSize()?.width || 1280) >= 761) {
      await expect(big.locator('#bigDesk')).toHaveAttribute('aria-pressed', 'true');
      expect(await big.locator('#bigFrame').evaluate((f) => (f as HTMLElement).style.width)).toBe('1280px');
    }
    await big.locator('#bigPhone').click();
    await expect(big.locator('#bigPhone')).toHaveAttribute('aria-pressed', 'true');
    const box = await big.locator('#bigFrame').boundingBox();
    expect(Math.round(box!.width)).toBeLessThanOrEqual(390);
  });

  test('Use this design picks it and goes back to the sheet', async ({ page }) => {
    const { dlg } = await openSheet(page);
    await dlg.locator('[data-full="slate"]').click();
    await page.locator('#bigUse').click();
    await expect(page.locator('#bigDlg')).toBeHidden();
    await expect(dlg.locator('#new-designs input:checked')).toHaveValue('slate');
    await expect(dlg.locator('#new-sum-b')).toContainText('Slate look');
  });

  test('a sample that can’t be drawn says so and keeps the picture’s promise', async ({ page }) => {
    const { dlg } = await openSheet(page, 502);
    await dlg.locator('[data-full="meadow"]').click();
    await expect(page.locator('#bigWait')).toHaveText('We couldn’t draw this design just now. Its picture shows how it starts.');
    await page.locator('#bigX').click();
    await expect(page.locator('#bigDlg')).toBeHidden();
  });

  test('Templates: each built-in design can be seen full size, with its own sample', async ({ page }) => {
    const { samples } = await open(page, '/templates.html');
    await expect(page.locator('.dgrid .dcell')).toHaveCount(8);
    await page.locator('.dgrid [data-full="atelier"]').click();
    await expect(page.locator('#bigDlg')).toBeVisible();
    await expect(page.locator('#bigSub')).toHaveText('A sample salon in this design. A site’s own words and photos replace it.');
    await expect(page.frameLocator('#bigFrame').locator('#who')).toHaveText('atelier · beauty');
    expect(samples).toEqual(['atelier?beauty']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#bigDlg')).toBeHidden();
    await expect(page.locator('.dgrid [data-full="atelier"]')).toBeFocused();
  });

  test('on a touch screen See it full size and the viewer’s switches are full-size tap targets', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop-chromium', '44px taps are the touch rule');
    const { dlg } = await openSheet(page);
    expect((await dlg.locator('[data-full="atelier"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dlg.locator('[data-full="atelier"]').click();
    for (const id of ['#bigDesk', '#bigPhone', '#bigX', '#bigUse']) expect((await page.locator(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
