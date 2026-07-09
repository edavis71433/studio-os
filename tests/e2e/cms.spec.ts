import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// The workspace (presence.html) as the CMS surface — edition gating (Phase SKU),
// hash deep-links (Phase OS), and terminology (Phase PP: "Photos").
const PRESENCE_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/changes': { data: [] }, '/notes': { data: [] },
  '/moments': { data: [] },
};
const ctx = (features: string[]) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: features.includes('business_moments') ? 'studio_os' : 'cms_only',
  edition_name: features.includes('business_moments') ? 'Studio OS' : 'CMS', edition_features: features,
  is_agency: false, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} });

test.describe('CMS workspace', () => {
  test('Studio OS shows the Business-OS links (Connections, Visual Studio)', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html');
    await expect(page.locator('#lnkConnections')).toBeVisible();
    await expect(page.locator('#lnkVisual')).toBeVisible();
  });

  test('CMS edition hides the Business-OS links it does not include (Phase SKU)', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(['website', 'developer', 'forms', 'client_portal', 'reports']) } });
    await page.goto('/presence.html');
    await expect(page.locator('#lnkConnections')).toBeHidden();
    await expect(page.locator('#lnkVisual')).toBeHidden();
  });

  test('the media section is called "Files" everywhere (Architecture v1.0 terminology)', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html');
    await expect(page.locator('.navitem[data-view="media"]').first()).toHaveText('Files');
    await expect(page.locator('#view-media h1.doc')).toHaveText('Files');
  });

  test('hash deep-link #design opens the Design view (Phase OS)', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html#design');
    await expect(page.locator('#view-design')).toBeVisible();
  });

  test('hash deep-link #business opens the Business view', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html#business');
    await expect(page.locator('#view-business')).toBeVisible();
  });

  test('Design shows a preview gallery card per template family (PT-2C)', async ({ page }) => {
    await installApp(page, { api: {
      ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES),
      '/site/templates': { data: { current: { slug: 'business-classic', version: '1.0.0' }, templates: [
        { slug: 'business-classic', name: 'Business Classic', version: '1.0.0' },
        { slug: 'editorial', name: 'Editorial', version: '1.0.0' },
      ] } },
    } });
    await page.goto('/presence.html#design');
    await expect(page.locator('#lookSeg button[data-look="business-classic"]')).toBeVisible();
    await expect(page.locator('#lookSeg button[data-look="editorial"]')).toBeVisible();
    await expect(page.locator('#lookSeg')).toContainText('Editorial');
    await expect(page.locator('#lookSeg')).toContainText('print serif'); // the family's swatch tag
  });
});
