import { test, expect } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Bug hunt C17 (Nov 10 2026): a studio that hides Inbox in Settings › Your menu kept
// Inbox in the phone's bottom bar — a fallback put it back when the menu had no
// visible Inbox. The fallback now stands in only for a menu that names no Inbox at
// all, never for one the studio hid (the server makes a hidden area's items ⌘K-only).

const ctx = (nav: unknown) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 3, nav, plan_key: 'presence', upsell: null, scope: null,
} });
// what lib/navigation.ts applyHidden sends for a studio that hid Inbox
const INBOX_HIDDEN = STUDIO_LEVEL_NAV.map((s) => s.key === 'inbox' ? { ...s, items: s.items.map((i) => ({ ...i, hidden: true })) } : s);
const API = { '/identity': { data: { business_name: 'Bright Studio' } }, '/settings': { data: {} } };

test.describe('The phone bar follows Your menu (bug hunt C17)', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

  test('Inbox hidden in Your menu: no Inbox in the bottom bar', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': ctx(INBOX_HIDDEN) } });
    await page.goto('/settings.html');
    const mbar = page.locator('#dds-mbar');
    await expect(mbar.locator('a[href^="/agency"]')).toContainText('Home');
    await expect(mbar.locator('a[href^="/pipeline"]')).toContainText('Pipeline');
    await expect(mbar.locator('#dds-mbar-create')).toBeVisible();
    await expect(mbar.locator('a[href^="/inbox"]')).toHaveCount(0);
    await expect(mbar).not.toContainText('Inbox');
  });

  test('Inbox in the menu: Inbox in the bottom bar, as before', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': ctx(STUDIO_LEVEL_NAV) } });
    await page.goto('/settings.html');
    await expect(page.locator('#dds-mbar a[href^="/inbox"]')).toContainText('Inbox');
  });
});
