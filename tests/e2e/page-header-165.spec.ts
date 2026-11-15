import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { expectOneHeader } from './helpers/page-header';

// Builder item 165 (Figma 295:3): one page header, on every page. This spec holds the shared
// header itself (shell.css .dds-ph) and the Sites page, the drawn example; the other pages'
// headers are checked beside their own fixtures with the same helper. Names are made up.

const site = (id: string, name: string) => ({ site_id: id, name, edition: 'presence', state: 'live', state_words: 'Live', address: `https://${id}.example`, domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } }, team: [], tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
  unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: null, copied: null, no_owner: false, owner: null, transfer: null });
const STUDIO = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV } };
const SITES_API = {
  '/portal/context': STUDIO,
  '/agency/sites': { data: [site('s1', 'Bistro Nine'), site('s2', 'Garage Ten'), site('s3', 'Cafe Eleven')], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90 },
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: { s1: { kind: 'message', words: 'A message is waiting' } }, next_by_client: {} } },
};

test.describe('One page header (builder item 165)', () => {
  test('Sites: the icon, the title, the counts, the actions with one filled, the tabs', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: SITES_API });
    await page.goto('/sites.html');
    await expectOneHeader(page, { title: 'Sites', icon: 'sites', line: '3 sites you look after · 1 needs you', filled: '+ New site', tabs: ['Sites', 'Domains', 'Templates', 'Usage', 'Changes'] });
    const head = page.locator('header.dds-ph');
    if ((page.viewportSize()?.width || 0) < 761) {
      // the others behind ⋯: a sheet from the bottom, the refresh button saying its name there
      await head.locator('.dds-ph-dots').click();
      const more = head.locator('.dds-ph-more');
      await expect(more).toBeVisible();
      await expect(more.getByRole('link', { name: 'Plan my week' })).toBeVisible();
      await expect(more.getByRole('button', { name: 'Refresh' })).toContainText('Refresh');
      await page.keyboard.press('Escape');
      await expect(more).toBeHidden();
    } else {
      // the actions on the right: in one row with the title where they fit (beside the iPad's
      // sidebar they drop under it), the filled one at the row's right edge either way
      const t = (await head.locator('h1').boundingBox())!, f = (await head.locator('#newSiteBtn').boundingBox())!, r = (await head.locator('.dds-ph-row').boundingBox())!;
      expect(Math.abs((f.x + f.width) - (r.x + r.width))).toBeLessThanOrEqual(2);
      if ((page.viewportSize()?.width || 0) >= 1200) expect(Math.abs((f.y + f.height / 2) - (t.y + t.height / 2))).toBeLessThan(t.height);
      await expect(head.locator('.dds-ph-dots')).toBeHidden();
      await expect(head.getByRole('button', { name: 'Refresh' })).toBeVisible();
    }
    await expect(page.locator('#lmeta')).toContainText('3 sites');   // the sort and freshness line stays, under the header
  });

  test('the header has no serious or critical accessibility findings, light and dark', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once');
    test.slow();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: SITES_API });
      await page.goto('/sites.html');
      await expect(page.locator('header.dds-ph h1')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('header.dds-ph').analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    }
  });
});
