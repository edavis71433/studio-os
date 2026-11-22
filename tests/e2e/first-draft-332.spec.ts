import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { galleryPayload } from '../../supabase/functions/presence/lib/design_gallery.ts';

// Builder item 332: + New site's optional first draft. One step in the sheet (three things the
// business offers, filled in for its kind; the town; how it should sound). The site is made
// exactly as before (the same POST /agency/sites), then the page asks for the draft and says,
// in the done panel, what was written. Hermetic: every call is recorded, nothing leaves.

const TEMPLATES = [['atelier', 'Atelier'], ['aurora', 'Aurora'], ['business-classic', 'Business Classic'], ['editorial', 'Editorial'],
  ['harbor', 'Harbor'], ['meadow', 'Meadow'], ['restaurant-classic', 'Restaurant Classic'], ['slate', 'Slate']].map(([slug, name]) => ({ slug, name }));
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const DONE = { data: { written: true, services: 3, questions: 3, photos: 'stand_in' } };

async function openSheet(page: Page, drafts: Array<{ status: number; body: unknown }> = [{ status: 200, body: DONE }], kits: unknown[] = []) {
  const made: Array<Record<string, unknown>> = [], asked: Array<Record<string, unknown>> = [];
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: [], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90, room: { used: 0, limit: 25, full: false } },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    '/agency/designs': { data: galleryPayload(TEMPLATES) },
    '/agency/kits': { data: kits },
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites$/, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON(); made.push(body);
    return route.fulfill(json({ data: { site_id: 's-made', client_id: 'c-made', name: String(body.business_name), kit: null, look: null, industry: null } }, 201));
  });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/s-made\/first-draft$/, async (route: Route) => {
    asked.push(route.request().postDataJSON());
    const next = drafts[Math.min(asked.length - 1, drafts.length - 1)];
    return route.fulfill(json(next.body, next.status));
  });
  await page.goto('/sites.html');
  await page.getByRole('button', { name: '+ New site' }).first().click();   // with no sites yet, the empty list offers one too
  const dlg = page.locator('#newDlg');
  await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
  await dlg.locator('#new-biz').fill('Copper Line Plumbing');
  return { dlg, made, asked };
}

test.describe('+ New site: the first draft (builder item 332)', () => {
  test('the step is there, off; on, it asks three services filled in for the kind, the town and a tone', async ({ page }) => {
    const { dlg } = await openSheet(page);
    await expect(dlg.locator('#new-draft-wrap')).toBeVisible();
    await expect(dlg.locator('#new-draft')).not.toBeChecked();
    await expect(dlg.locator('#new-draft-fields')).toBeHidden();
    await dlg.locator('#new-kinds .kind', { hasText: 'Home services' }).click();
    await dlg.locator('label.ndraft-on').click();
    await expect(dlg.locator('#new-draft-fields')).toBeVisible();
    await expect(dlg.locator('#new-svc-0')).toBeFocused();
    await expect(dlg.locator('#new-svc-0')).toHaveValue('Repairs');
    await expect(dlg.locator('#new-svc-1')).toHaveValue('Installations');
    await expect(dlg.locator('#new-svc-2')).toHaveValue('Maintenance');
    await expect(dlg.locator('#new-tones .ntone')).toHaveText(['Friendly', 'Professional', 'Warm', 'Bold', 'Calm']);
    await expect(dlg.locator('#new-tones input:checked')).toHaveValue('friendly');
    // another kind changes the three, until the studio types its own
    await dlg.locator('#new-kinds .kind', { hasText: 'Salon or spa' }).click();
    await expect(dlg.locator('#new-svc-0')).toHaveValue('Haircuts and styling');
    await dlg.locator('#new-svc-0').fill('Balayage');
    await dlg.locator('#new-kinds .kind', { hasText: 'Fitness' }).click();
    await expect(dlg.locator('#new-svc-0')).toHaveValue('Balayage');
  });

  test('Create site makes the site as before, then writes the draft and says what was written', async ({ page }) => {
    const { dlg, made, asked } = await openSheet(page);
    await dlg.locator('#new-kinds .kind', { hasText: 'Home services' }).click();
    await dlg.locator('label.ndraft-on').click();
    await dlg.locator('#new-svc-0').fill('Drain cleaning');
    await dlg.locator('#new-svc-1').fill('Water heaters');
    await dlg.locator('#new-svc-2').fill('Leaks');
    await dlg.locator('#new-town').fill('Burbank, CA');
    await dlg.locator('#new-tones .ntone', { hasText: 'Bold' }).click();
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-draft-line')).toHaveText('The first draft is written: the words for Home, About, Services and Contact, with 3 services and 3 questions answered. It opens with a stand-in picture to swap for a photo of the business. Every word is yours to change in the editor. Nothing is published.');
    expect(made).toHaveLength(1);
    expect(Object.keys(made[0]).sort()).toEqual(['business_name', 'industry_key', 'template_slug']);   // the site is made exactly as before
    expect(asked).toEqual([{ services: ['Drain cleaning', 'Water heaters', 'Leaks'], town: 'Burbank, CA', tone: 'bold' }]);
  });

  test('with the step off nothing is drafted', async ({ page }) => {
    const { dlg, made, asked } = await openSheet(page);
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    await expect(dlg.locator('#new-draft-line')).toHaveCount(0);
    expect(made).toHaveLength(1);
    expect(asked).toEqual([]);
  });

  test('nothing to write from is said before any site is made', async ({ page }) => {
    const { dlg, made } = await openSheet(page);
    await dlg.locator('label.ndraft-on').click();
    for (const i of [0, 1, 2]) await dlg.locator(`#new-svc-${i}`).fill('');
    await dlg.locator('#new-submit').click();
    await expect(page.locator('body')).toContainText('Add one thing they offer, or the town, so the first draft has something to write from.');
    expect(made).toEqual([]);
  });

  test('a draft that fails can be tried again; drafting switched off says so with nothing to retry', async ({ page }) => {
    const { dlg, asked } = await openSheet(page, [{ status: 502, body: { error: 'generate_failed', message: 'The first draft didn’t come through. Nothing was changed; the site is ready with sample words. Try again in a moment.' } }, { status: 200, body: DONE }]);
    await dlg.locator('#new-kinds .kind', { hasText: 'Home services' }).click();
    await dlg.locator('label.ndraft-on').click();
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-draft-line')).toContainText('The first draft didn’t come through.');
    await dlg.locator('#new-draft-again').click();
    await expect(dlg.locator('#new-draft-line')).toContainText('The first draft is written');
    expect(asked).toHaveLength(2);
  });

  test('switched off: the honest words and no Try again', async ({ page }) => {
    const { dlg } = await openSheet(page, [{ status: 503, body: { error: 'writer_unavailable', message: 'Writing the first draft isn’t switched on right now. The site is ready, with sample words to change by hand.' } }]);
    await dlg.locator('#new-kinds .kind', { hasText: 'Home services' }).click();
    await dlg.locator('label.ndraft-on').click();
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-draft-line')).toHaveText('Writing the first draft isn’t switched on right now. The site is ready, with sample words to change by hand.');
    await expect(dlg.locator('#new-draft-again')).toHaveCount(0);
  });

  test('a saved template brings its own words, so the step steps aside', async ({ page }) => {
    const { dlg } = await openSheet(page, undefined, [{ id: 't1', name: 'Bakery site', kind: 'template', summary: { pages: 5, sections: 23, photos: 14 } }]);
    await dlg.locator('#new-tpls .tcard').click();
    await expect(dlg.locator('#new-draft-wrap')).toBeHidden();
  });

  test('on a touch screen the step and the tones are full-size tap targets', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop-chromium', '44px taps are the touch rule');
    const { dlg } = await openSheet(page);
    await dlg.locator('label.ndraft-on').click();
    for (const box of [await dlg.locator('label.ndraft-on').boundingBox(), await dlg.locator('#new-tones .ntone').first().boundingBox()]) expect(box && box.height).toBeGreaterThanOrEqual(44);
  });
});
