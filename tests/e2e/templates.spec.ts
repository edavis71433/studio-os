import { test, expect, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 166 (Nov 10 review, file 05 finding 13): starter kits could be saved
// but never seen, renamed or removed. The Templates tab on Sites lists every template
// and starter kit. The fixtures are GET /agency/kits's real shape (agency/routes.ts):
// { data: [{ id, name, industry_key, created_from_site, created_by, created_at, from_name,
// brings, kind, summary? }], can_manage }; tests/presence/kits_manage_test.mjs pins it.
const KITS = [
  { id: 'k1', name: 'Realty — three pages', industry_key: 'realty', created_from_site: 's1', created_by: 'owner@studio.example', created_at: '2026-11-10T00:00:00Z', from_name: 'Maple & Main Realty',
    brings: { offerings: 2, faqs: 1, voice: true, colors: true }, kind: 'template', summary: { pages: 3, sections: 14, photos: 9 } },
  { id: 'k2', name: 'Florist starter', industry_key: 'florist', created_from_site: 's9', created_by: 'pat@studio.example', created_at: '2026-11-02T00:00:00Z', from_name: '',
    brings: { offerings: 6, faqs: 4, voice: true, colors: true }, kind: 'kit' },
];
const ctx = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'agency', upsell: null } };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openTemplates(page, kits: unknown[] = KITS, over: Record<string, unknown> = {}) {
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  await installApp(page, { api: { '/portal/context': ctx } });
  await page.route(/\/functions\/v1\/presence\/agency\/kits(\/[^/]+)?$/, async (route: Route) => {
    const method = route.request().method(), path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    if (method === 'GET') return route.fulfill(json({ data: kits, can_manage: true, ...over }));
    const body = route.request().postDataJSON();
    writes.push({ method, path, body });
    if (method === 'PATCH') return route.fulfill(json({ data: { id: path.split('/')[3], name: String(body.name).trim() } }));
    return route.fulfill(json({ data: { ok: true, photos_removed: 0 } }));
  });
  await page.goto('/templates.html');
  return { writes };
}

test.describe('Templates (builder list item 166)', () => {
  test('every template and starter kit: what it brings, where it came from, a third tab on Sites', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openTemplates(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible();
    await expect(page.locator('.lmeta')).toHaveText('1 template · 1 starter kit · newest first');
    await expect(page.locator('.tabs a')).toHaveText(['Sites', 'Domains', 'Templates', 'Usage']);   // item 210: the Usage tab
    await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText('Templates');
    const rows = page.locator('.krow');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.kchip')).toHaveText('Template');
    await expect(rows.nth(0).locator('.kb')).toHaveText('3 pages · 14 sections · 9 photos, plus 2 services · 1 FAQ · voice and colors');
    await expect(rows.nth(0).locator('.kf')).toHaveText('From Maple & Main Realty · Saved Nov 10 by owner@studio.example');
    await expect(rows.nth(1).locator('.kchip')).toHaveText('Starter kit');
    await expect(rows.nth(1).locator('.kb')).toHaveText('6 services · 4 FAQs · voice and colors');
    await expect(rows.nth(1).locator('.kf')).toHaveText('From a site no longer in your list · Saved Nov 2 by pat@studio.example');
    expect(errors).toEqual([]);
  });

  test('Rename in place: Save sends the new name, Escape leaves it as it was', async ({ page }) => {
    const t = await openTemplates(page);
    await page.getByRole('button', { name: 'Rename Florist starter' }).click();
    const input = page.locator('#kn-k2');
    await expect(input).toBeFocused();
    await input.fill('Florist — setup only');
    await page.keyboard.press('Escape');
    await expect(page.locator('.krow').nth(1).locator('b')).toHaveText('Florist starter');
    expect(t.writes).toHaveLength(0);
    await page.getByRole('button', { name: 'Rename Florist starter' }).click();
    await page.locator('#kn-k2').fill('  Florist — setup only ');
    await page.locator('#kn-k2').press('Enter');
    await expect(page.locator('.krow').nth(1).locator('b')).toHaveText('Florist — setup only');
    await expect(page.locator('.dds-toast', { hasText: 'Renamed “Florist — setup only”.' })).toBeVisible();
    expect(t.writes).toEqual([{ method: 'PATCH', path: '/agency/kits/k2', body: { name: 'Florist — setup only' } }]);
  });

  test('Remove asks with a second press, then the row goes', async ({ page }) => {
    const t = await openTemplates(page);
    const remove = page.getByRole('button', { name: 'Remove Realty — three pages' });
    await remove.click();
    await expect(page.locator('[data-remove="k1"]')).toHaveText('Remove Realty — three pages? Press again');
    expect(t.writes).toHaveLength(0);
    await page.locator('[data-remove="k1"]').click();
    await expect(page.locator('.krow')).toHaveCount(1);
    await expect(page.locator('.dds-toast', { hasText: 'Removed “Realty — three pages”. Sites already started from it keep everything they got.' })).toBeVisible();
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['DELETE /agency/kits/k1']);
  });

  test('nothing saved yet says where to save one; a view-only seat sees no buttons', async ({ page }) => {
    await openTemplates(page, []);
    await expect(page.getByText('No templates or starter kits yet.')).toBeVisible();
    await expect(page.locator('.center a[href="/sites.html"]')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a view-only seat sees the list without Rename or Remove', async ({ page }) => {
    await openTemplates(page, KITS, { can_manage: false });
    await expect(page.locator('.krow')).toHaveCount(2);
    await expect(page.locator('[data-edit], [data-remove]')).toHaveCount(0);
  });

  test('phone width: rows stack and fit, buttons are a full-size tap', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTemplates(page);
    const row = page.locator('.krow').first();
    const box = await row.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    const b = await row.locator('[data-edit]').boundingBox();
    expect(b && b.height >= 44).toBe(true);
    const chip = await row.locator('.kchip').boundingBox();   // a label, not a tap target: the shell's 44px rule for .chip must not reach it
    expect(chip && chip.height < 30).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
