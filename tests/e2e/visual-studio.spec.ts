import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Visual Studio — the approved "make images" board over the EXISTING backend:
// /visual/kinds (what you can make + whether it's switched on), /visual/generate,
// /visual/plans (the history) and /visual/plans/:id/{vary,edit,decide}. Nothing
// is saved until an option is approved; the kinds, sizes and history rows are
// the server's own, never invented.
const KINDS = { data: { available: true, kinds: [
  { kind: 'hero', label: 'Page banner', purpose: 'The wide image across the top of a page.', width: 1600, height: 900, aspect: '16:9' },
  { kind: 'social_square', label: 'Square post', purpose: 'A square image for an Instagram or Facebook post.', width: 1080, height: 1080, aspect: '1:1' },
  { kind: 'open_graph', label: 'Link preview', purpose: 'The preview image shown when your page is shared as a link.', width: 1200, height: 630, aspect: '1.91:1' },
  { kind: 'general', label: 'General image', purpose: 'A general-purpose image for anywhere on your site.', width: 1024, height: 1024, aspect: '1:1' },
] } };
const OFF = { data: { available: false, kinds: KINDS.data.kinds } };
const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="#b9471f"/></svg>');
const PLAN = { data: { id: 'p9', kind: 'hero', title: 'Patio at golden hour', summary: 'Three takes on the patio, warm and uncluttered.', status: 'proposed',
  variations: [{ id: 'a', preview_url: IMG }, { id: 'b', preview_url: IMG }, { id: 'c', preview_url: IMG }] } };
const PLANS = { data: [
  { id: 'p1', kind: 'hero', title: 'Home banner — autumn menu', status: 'stored', created_at: '2026-09-28T00:00:00Z', chosen_variation: 'v1', variations: [{ id: 'v1', preview_url: IMG }] },
  { id: 'p3', kind: 'social_square', title: 'Wine night — Thursday', status: 'proposed', created_at: '2026-10-01T00:00:00Z', variations: [{ id: 'v3', preview_url: IMG }] },
] };
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('Visual Studio (the approved board)', () => {
  test('crumb · title · Upload your own · one pick card per server kind · Brand and Size · one filled button', async ({ page }) => {
    await installApp(page, { api: { '/visual/kinds': KINDS, '/visual/plans': { data: [] }, '/brand/profile': { data: { personality: 'Warm, local', voice_characteristics: ['plain-spoken'] } } } });
    await page.goto('/visual-studio.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Files');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Files' })).toHaveAttribute('href', '/files.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Visual Studio' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upload your own' })).toHaveAttribute('href', '/files.html');
    // the pick cards ARE the server's kinds — label, purpose, aspect + size — as pressable buttons
    const kinds = page.locator('#kinds .kind');
    await expect(kinds).toHaveCount(4);
    await expect(kinds.nth(0)).toContainText('Page banner');
    await expect(kinds.nth(0)).toContainText('The wide image across the top of a page.');
    await expect(kinds.nth(0)).toContainText('16:9 · 1600 × 900');
    await expect(kinds.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#sizeIn')).toHaveText('Pick what you need first');
    await kinds.nth(2).click();
    await expect(kinds.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#kinds [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#sizeIn')).toHaveText('Link preview · 1200 × 630');
    // Brand comes from the site's own profile (read-only)
    await expect(page.locator('#brandIn')).toHaveText('Warm, local · plain-spoken');
    // one filled button on the screen, and it is the one that makes options
    await expect(page.locator('.btn.primary')).toHaveCount(1);
    await expect(page.locator('.btn.primary')).toHaveText('Make 3 options');
    await expect(page.getByText('Every image is AI-made and we say so. Nothing is saved until you approve one.')).toBeVisible();
    // no history → no "Approved before" section at all
    await expect(page.locator('#approved')).toHaveCount(0);
  });

  test('Help me describe it fills a starter for the picked kind, never over your own words', async ({ page }) => {
    await installApp(page, { api: { '/visual/kinds': KINDS, '/visual/plans': { data: [] } } });
    await page.goto('/visual-studio.html');
    await page.locator('[data-kind="social_square"]').click();
    await page.locator('#describe').click();
    await expect(page.locator('#subject')).toHaveValue(/close-up/);
    await page.locator('#subject').fill('Our own words here.');
    await page.locator('#describe').click();
    await expect(page.locator('#subject')).toHaveValue('Our own words here.');   // never overwritten
  });

  test('Make 3 options posts kind + subject + count 3; the options render with Approve; approving posts the decision with alt text', async ({ page }) => {
    let generated: Record<string, unknown> | null = null;
    let decided: Record<string, unknown> | null = null;
    await installApp(page, { api: { '/visual/kinds': KINDS, '/visual/plans': { data: [] } } });
    await page.route('**/functions/v1/presence/visual/generate', (route) => { generated = route.request().postDataJSON(); return route.fulfill(ok(PLAN)); });
    await page.route('**/functions/v1/presence/visual/plans/p9/decide', (route) => { decided = route.request().postDataJSON(); return route.fulfill(ok({ data: { ...PLAN.data, status: 'stored' } })); });
    await page.goto('/visual-studio.html');
    await page.locator('[data-kind="hero"]').click();
    await page.locator('#subject').fill('The patio at golden hour, candles on the tables.');
    await page.locator('#go').click();
    await expect.poll(() => generated).toEqual({ kind: 'hero', subject: 'The patio at golden hour, candles on the tables.', count: 3 });
    const opts = page.locator('#options .opt');
    await expect(opts).toHaveCount(3);
    await expect(opts.nth(0)).toContainText('Option 1');
    await expect(opts.nth(0).getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(page.locator('#options')).toContainText('Three takes on the patio, warm and uncluttered.');
    // the plan-level actions are the existing endpoints, named plainly; the edit box is folded until asked for
    await expect(page.locator('[data-vary]')).toHaveText('Make more like these');
    await expect(page.locator('#editbox')).toBeHidden();
    await page.locator('[data-editopen]').click();
    await expect(page.locator('#editbox')).toBeVisible();
    await expect(page.locator('#editin')).toBeFocused();
    // approve option 2: the alt-text dialog is seeded with the subject, Save posts the decision
    await opts.nth(1).getByRole('button', { name: 'Approve' }).click();
    const dlg = page.locator('dialog[open]');
    await expect(dlg).toContainText('Describe this image in a few words');
    await expect(dlg.locator('input')).toHaveValue('The patio at golden hour, candles on the tables.');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => decided).toEqual({ decision: 'approve', variation_id: 'b', alt_text: 'The patio at golden hour, candles on the tables.' });
    await expect(page.locator('#options .chip')).toHaveText('Saved');
    await expect(page.getByRole('button', { name: 'Make another' })).toBeVisible();
  });

  test('Approved before lists saved plans with Use again, unapproved ones with Reopen — both reopen the plan', async ({ page }) => {
    let opened = '';
    await installApp(page, { api: { '/visual/kinds': KINDS, '/visual/plans': PLANS } });
    await page.route('**/functions/v1/presence/visual/plans/p1', (route) => { opened = 'p1'; return route.fulfill(ok({ data: { ...PLANS.data[0], summary: 'The autumn banner.', variations: [{ id: 'v1', preview_url: IMG }] } })); });
    await page.goto('/visual-studio.html');
    const sec = page.locator('#approved');
    await expect(sec.getByRole('heading', { name: 'Approved before' })).toBeVisible();
    await expect(sec.getByRole('link', { name: 'In Files' })).toHaveAttribute('href', '/files.html');
    const rows = sec.locator('.row:not(.quiet)');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Home banner — autumn menu');
    await expect(rows.nth(0)).toContainText('Page banner · Sep 28');
    await expect(rows.nth(0).locator('.chip')).toHaveText('Saved');
    await expect(rows.nth(0).getByRole('button', { name: 'Use again' })).toBeVisible();
    await expect(rows.nth(1)).toContainText('Wine night — Thursday');
    await expect(rows.nth(1)).toContainText('Square post · Oct 1 · options kept');
    await expect(rows.nth(1).getByRole('button', { name: 'Reopen' })).toBeVisible();
    await expect(sec).toContainText('Your own photos always work too');
    await rows.nth(0).getByRole('button', { name: 'Use again' }).click();
    await expect.poll(() => opened).toBe('p1');
    await expect(page.locator('#options')).toContainText('Home banner — autumn menu');
  });

  test('not switched on → the honest fallback, no pick cards, Files still offered', async ({ page }) => {
    await installApp(page, { api: { '/visual/kinds': OFF, '/visual/plans': { data: [] } } });
    await page.goto('/visual-studio.html');
    await expect(page.getByRole('heading', { name: 'Not switched on yet' })).toBeVisible();
    await expect(page.getByText('Making images isn’t switched on for your studio yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'upload to your Files' })).toHaveAttribute('href', '/files.html');
    await expect(page.locator('#kinds')).toHaveCount(0);
    await expect(page.locator('#go')).toHaveCount(0);
  });

  test('signed out → sign in, nothing else', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/visual-studio.html');
    await expect(page.getByRole('heading', { name: 'Sign in to use the Visual Studio.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in →' })).toHaveAttribute('href', '/studio.html');
  });

  test('no serious/critical axe violations with options on screen (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: { '/visual/kinds': KINDS, '/visual/plans': PLANS } });
    await page.route('**/functions/v1/presence/visual/generate', (route) => route.fulfill(ok(PLAN)));
    await page.goto('/visual-studio.html');
    await page.locator('[data-kind="hero"]').click();
    await page.locator('#subject').fill('The patio at golden hour.');
    await page.locator('#go').click();
    await expect(page.locator('#options .opt')).toHaveCount(3);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
