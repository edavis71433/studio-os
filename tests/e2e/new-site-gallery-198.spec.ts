import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { galleryPayload } from '../../supabase/functions/presence/lib/design_gallery.ts';

// Builder item 198 (Nov 12 review, file 06, findings 43 and 44), drawn in Figma ("New site
// gallery, Templates and the site count"):
//   · + New site is a sheet: the business's name and kind, the eight built-in designs as
//     pictures (the three that suit the kind first), your saved templates, a starter kit;
//   · Sites says "8 of 25 sites", and a full plan says so at New site and at Add a customer;
//   · the Templates tab lists the built-in designs, each starting a new site with it picked.
// The gallery's data is the real lib/design_gallery.ts payload, so the page and the server agree.

const TEMPLATES = [
  ['atelier', 'Atelier'], ['aurora', 'Aurora'], ['business-classic', 'Business Classic'], ['editorial', 'Editorial'],
  ['harbor', 'Harbor'], ['meadow', 'Meadow'], ['restaurant-classic', 'Restaurant Classic'], ['slate', 'Slate'],
].map(([slug, name]) => ({ slug, name }));
const DESIGNS = { data: galleryPayload(TEMPLATES) };

const site = (id: string, name: string) => ({
  site_id: id, name, edition: 'presence', state: 'live', state_words: 'Live', address: `https://${id}.example`, domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
  tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', unpublished_changes: false, billing_issue: false,
  opened_at: null, pinned: false, thumb: null, copied: null, no_owner: false, owner: null, transfer: null,
});
const ROWS = [site('s1', 'Bistro Nine'), site('s2', 'Cafe Eleven')];
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const KITS = [
  { id: 't1', name: 'Bakery site', kind: 'template', summary: { pages: 5, sections: 23, photos: 14 } },
  { id: 'k1', name: 'Florist starter', kind: 'kit', summary: null },
];

async function openSites(page: Page, opts: { room?: unknown; kits?: unknown[]; made?: unknown; madeStatus?: number; path?: string; designs?: unknown } = {}) {
  const posts: Array<Record<string, unknown>> = [];
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: ROWS, partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90, room: opts.room ?? { used: 2, limit: 25, full: false } },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    '/agency/designs': opts.designs ?? DESIGNS,
    '/agency/kits': { data: opts.kits ?? KITS },
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites$/, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    posts.push(body);
    const look = body.template_slug ? { slug: body.template_slug, name: TEMPLATES.find((t) => t.slug === body.template_slug)?.name, applied: true } : null;
    return route.fulfill(json(opts.made ?? { data: { site_id: 's-made', client_id: 'c-made', name: String(body.business_name).trim(), kit: null, look, industry: body.industry_key ? { key: body.industry_key, applied: true } : null } }, opts.madeStatus ?? 201));
  });
  await page.goto(opts.path ?? '/sites.html');
  return { posts };
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 1280) < 761;

test.describe('+ New site: the gallery (builder item 198)', () => {
  test('Sites says "2 of 25 sites"; the sheet asks the kind and shows the eight designs, the three that suit it first', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const t = await openSites(page);
    await expect(page.locator('#roomLine')).toHaveText('2 of 25 sites');
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#newHead')).toHaveText('New site');
    await expect(dlg).toContainText('Nobody is emailed until you invite the owner.');
    await expect(dlg.locator('#new-kinds .kind b')).toHaveText(['Restaurant or café', 'Salon or spa', 'Home services', 'Health care', 'Professional', 'Shop', 'Fitness', 'Photo and creative', 'Nonprofit or church', 'Something else']);
    const cards = dlg.locator('#new-designs .dcard');
    await expect(cards).toHaveCount(8);
    await expect(cards.locator('img').first()).toHaveAttribute('src', '/thumbs/templates/atelier.jpg');
    await expect(dlg.locator('#new-designs input:checked')).toHaveValue('atelier');   // the usual look, shown picked
    await expect(dlg.locator('.dbadge')).toHaveCount(0);                                // no kind yet, no suggestions
    await dlg.locator('#new-biz').fill('Juniper Floral Co.');
    await dlg.locator('#new-kinds .kind', { hasText: 'Shop' }).click();
    await expect(cards.locator('b')).toHaveText(['Atelier', 'Meadow', 'Aurora', 'Business Classic', 'Editorial', 'Harbor', 'Restaurant Classic', 'Slate']);
    await expect(dlg.locator('.dbadge')).toHaveCount(3);
    await expect(dlg.locator('.dbadge').first()).toContainText('Good for shops');
    await expect(dlg.locator('#new-lookline')).toContainText('The three that suit shops come first.');
    await expect(dlg.locator('#new-exact')).toBeVisible();
    await dlg.locator('#new-exact').selectOption('florist');
    await dlg.locator('#new-designs .dcard', { hasText: 'Meadow' }).click();
    // a design picked by hand stays picked when the kind changes
    await dlg.locator('#new-kinds .kind', { hasText: 'Salon or spa' }).click();
    await expect(dlg.locator('#new-designs input:checked')).toHaveValue('meadow');
    await dlg.locator('#new-kinds .kind', { hasText: 'Shop' }).click();
    await dlg.locator('#new-exact').selectOption('florist');
    await expect(dlg.locator('#new-sum-a')).toHaveText('Juniper Floral Co. · Florist');
    await expect(dlg.locator('#new-sum-b')).toHaveText('Meadow look · starts private, nothing published');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toContainText('Juniper Floral Co.’s site is ready');
    await expect(dlg.locator('#new-look-line')).toHaveText('It starts with the Meadow design. You can change it any time in the editor, under Styles.');
    expect(t.posts).toEqual([{ business_name: 'Juniper Floral Co.', template_slug: 'meadow', industry_key: 'florist' }]);
    expect(errors).toEqual([]);
  });

  test('a kind alone sends its first suggestion; an untouched sheet sends no design at all', async ({ page }) => {
    const t = await openSites(page);
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
    await dlg.locator('#new-biz').fill('Plain Name Co.');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    await dlg.locator('#new-close').click();
    await page.getByRole('button', { name: '+ New site' }).click();
    await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
    await dlg.locator('#new-biz').fill('Pipe Pros');
    await dlg.locator('#new-kinds .kind', { hasText: 'Home services' }).click();
    await expect(dlg.locator('#new-designs input:checked')).toHaveValue('harbor');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(t.posts).toEqual([{ business_name: 'Plain Name Co.' }, { business_name: 'Pipe Pros', template_slug: 'harbor', industry_key: 'home_services' }]);
  });

  test('a saved template is the other kind of start: picking it unpicks the design and hides the starter kit', async ({ page }) => {
    const t = await openSites(page);
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-tpls .tcard')).toHaveCount(1);
    await expect(dlg.locator('#new-tpls .tcard')).toContainText('Template: 5 pages with their sections and photos');
    await expect(dlg.locator('#new-kit option')).toHaveText(['None', 'Florist starter']);
    await dlg.locator('#new-biz').fill('Rise Bakery');
    await dlg.locator('#new-kinds .kind', { hasText: 'Restaurant or café' }).click();
    await dlg.locator('#new-tpls .tcard').click();
    await expect(dlg.locator('#new-designs input:checked')).toHaveCount(0);
    await expect(dlg.locator('#new-kit-wrap')).toBeHidden();
    await expect(dlg.locator('#new-sum-b')).toHaveText('From your “Bakery site” template · starts private, nothing published');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(t.posts).toEqual([{ business_name: 'Rise Bakery', kit_id: 't1', industry_key: 'restaurant' }]);
  });

  test('a starter kit goes on top of the picked design', async ({ page }) => {
    const t = await openSites(page);
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await dlg.locator('#new-biz').fill('Willow Florist');
    await dlg.locator('#new-designs .dcard', { hasText: 'Slate' }).click();
    await dlg.locator('#new-kit').selectOption('k1');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(t.posts).toEqual([{ business_name: 'Willow Florist', kit_id: 'k1', template_slug: 'slate' }]);
  });

  test('the Templates tab\'s "New site with this" (#new=meadow) opens the sheet with Meadow picked', async ({ page }) => {
    const t = await openSites(page, { path: '/sites.html#new=meadow' });
    const dlg = page.locator('#newDlg');
    await expect(dlg).toBeVisible();
    await expect(page).not.toHaveURL(/#new/);
    await expect(dlg.locator('#new-designs input:checked')).toHaveValue('meadow');
    await dlg.locator('#new-biz').fill('Fern & Co.');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(t.posts).toEqual([{ business_name: 'Fern & Co.', template_slug: 'meadow' }]);
  });

  test('without the gallery the sheet still makes a site, with the usual look', async ({ page }) => {
    const t = await openSites(page, { designs: { data: {} }, kits: [] });
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-nodesigns')).toBeVisible();
    await expect(dlg.locator('#new-kind-wrap')).toBeHidden();
    await dlg.locator('#new-biz').fill('Quiet Co.');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-done')).toBeVisible();
    expect(t.posts).toEqual([{ business_name: 'Quiet Co.' }]);
  });
});

test.describe('the plan\'s count (builder item 198)', () => {
  test('a full plan: Sites says so, New site says why and makes nothing', async ({ page }) => {
    const t = await openSites(page, { room: { used: 25, limit: 25, full: true } });
    await expect(page.locator('#roomLine')).toHaveText('25 of 25 sites · your plan is full');
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-full')).toBeVisible();
    await expect(dlg.locator('#new-full')).toContainText('Your plan covers 25 sites, and all 25 are in use.');
    await expect(dlg.locator('#new-full')).toContainText('Sites in the Trash don’t count, so moving one you no longer need there makes room.');
    await expect(dlg.locator('#new-submit')).toBeDisabled();
    await dlg.locator('#new-back').click();
    await expect(dlg).toBeHidden();
    expect(t.posts).toEqual([]);
  });

  test('a plan that filled up since the page loaded: the server\'s words, in the sheet', async ({ page }) => {
    await openSites(page, { made: { error: 'client_limit', message: 'Your plan covers 3 sites, and all 3 are in use. Sites in the Trash don’t count, so moving one you no longer need there makes room.', room: { used: 3, limit: 3, full: true } }, madeStatus: 409 });
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await dlg.locator('#new-biz').fill('One Too Many');
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-full')).toContainText('Your plan covers 3 sites, and all 3 are in use.');
    await expect(dlg.locator('#new-submit')).toBeDisabled();
    await expect(dlg.locator('#new-done')).toBeHidden();
  });

  test('Home\'s Add a customer says it in the box, not in a passing toast', async ({ page }) => {
    await installApp(page, { api: { '/agency/kits': { data: [] } } });
    await page.route('**/functions/v1/presence/sales/customers', (route) => route.fulfill(json({ error: 'client_limit', message: 'Your plan covers 25 sites, and all 25 are in use. Move one you no longer need to the Trash on Sites, then add them. Nothing was made.', room: { used: 25, limit: 25, full: true } }, 409)));
    await page.goto('/agency.html');
    await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
    const dlg = page.locator('#custDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#cu-full')).toBeHidden();
    await expect(dlg.locator('#cu-name')).toBeFocused();
    await dlg.getByRole('radio', { name: /Set up their website and invite them/ }).check();   // a full plan only stops setting them up
    await dlg.locator('#cu-email').fill('new@person.example');
    await dlg.locator('#cu-submit').click();
    await expect(dlg.locator('#cu-full')).toBeVisible();
    await expect(dlg.locator('#cu-full')).toContainText('Your plan covers 25 sites, and all 25 are in use.');
    await expect(dlg.locator('#cu-full')).toContainText('Nothing was made.');
    await expect(dlg.locator('#cu-submit')).toBeEnabled();
    await dlg.getByRole('radio', { name: /Just save them for now/ }).check();   // saving makes no site, so the words go
    await expect(dlg.locator('#cu-full')).toBeHidden();
    await expect(dlg.locator('#cu-submit')).toHaveText('Save');
  });
});

test.describe('the sheet on every screen (builder item 198)', () => {
  test('a phone gets the whole screen, one column, and Create site in reach without scrolling', async ({ page }) => {
    test.skip(!isPhone(page), 'phone layout');
    await openSites(page);
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
    const vw = page.viewportSize()!;
    const box = (await dlg.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1);
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(vw.width - 1);
    const go = (await dlg.locator('#new-submit').boundingBox())!;
    expect(go.y + go.height).toBeLessThanOrEqual(vw.height + 1);   // the footer sits at the foot of the screen
    expect(go.width).toBeGreaterThan(vw.width * 0.8);
    const first = (await dlg.locator('#new-designs .dcard').nth(0).boundingBox())!, second = (await dlg.locator('#new-designs .dcard').nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThan(first.y + first.height - 1);   // one under another
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('desktop and tablet: two columns, the designs beside the business', async ({ page }) => {
    test.skip(isPhone(page), 'wide layout');
    await openSites(page);
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-designs .dcard')).toHaveCount(8);
    const left = (await dlg.locator('#new-biz').boundingBox())!, right = (await dlg.locator('#new-designs').boundingBox())!;
    expect(right.x).toBeGreaterThan(left.x + left.width);
    const vw = page.viewportSize()!;
    const go = (await dlg.locator('#new-submit').boundingBox())!;
    expect(go.y + go.height).toBeLessThanOrEqual(vw.height);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious or critical accessibility problems in the open sheet (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openSites(page);
      await page.getByRole('button', { name: '+ New site' }).click();
      await page.locator('#newDlg #new-kinds .kind', { hasText: 'Shop' }).click();
      await expect(page.locator('#newDlg .dbadge')).toHaveCount(3);
      const r = await new AxeBuilder({ page }).include('#newDlg').withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(bad).toEqual([]);
    });
  }
});

test.describe('Templates: the built-in designs (builder item 198)', () => {
  const ctx = studioContext;
  async function openTemplates(page: Page, designs: unknown = DESIGNS, canManage = true) {
    await installApp(page, { api: { '/portal/context': ctx, '/agency/designs': designs } });
    await page.route(/\/functions\/v1\/presence\/agency\/kits$/, (route: Route) => route.fulfill(json({ data: KITS, can_manage: canManage })));
    await page.goto('/templates.html');
  }
  test('the eight designs come first, each with its picture, its words and "New site with this"', async ({ page }) => {
    await openTemplates(page);
    await expect(page.locator('#phLine')).toHaveText('8 built-in designs · 1 template · 1 starter kit');   // the one page header's line (item 165)
    await expect(page.getByRole('heading', { level: 2, name: 'Built-in designs' })).toBeVisible();
    const cells = page.locator('.dgrid .dcell');
    await expect(cells).toHaveCount(8);
    await expect(cells.first().locator('img')).toHaveAttribute('src', '/thumbs/templates/atelier.jpg');
    await expect(cells.first().locator('.dline')).toHaveText('Quiet and elegant. Good for salons, shops and photographers.');
    await expect(cells.nth(5).getByRole('link', { name: 'New site with Meadow' })).toHaveAttribute('href', '/sites.html#new=meadow');
    await expect(page.getByRole('heading', { level: 2, name: 'Saved by your studio' })).toBeVisible();
    await expect(page.locator('.krow')).toHaveCount(2);
  });
  test('a view-only seat sees the designs without the button; without the gallery the tab still lists what\'s saved', async ({ page }) => {
    await openTemplates(page, DESIGNS, false);
    await expect(page.locator('.dgrid .dcell')).toHaveCount(8);
    await expect(page.locator('.dgo')).toHaveCount(0);
    await openTemplates(page, { data: {} });
    await expect(page.locator('.dgrid')).toHaveCount(0);
    await expect(page.locator('#phLine')).toHaveText('1 template · 1 starter kit');
    await expect(page.locator('.krow')).toHaveCount(2);
  });
  test('phone width: one design under another, nothing wider than the screen', async ({ page }) => {
    test.skip(!isPhone(page), 'phone layout');
    await openTemplates(page);
    const a = (await page.locator('.dgrid .dcell').nth(0).boundingBox())!, b = (await page.locator('.dgrid .dcell').nth(1).boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    const go = (await page.locator('.dgo').first().boundingBox())!;
    expect(go.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
