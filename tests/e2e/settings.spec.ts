import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Oct 2026 review: Settings is its own page ────────────────────────────────
// /presence.html#settings landed on the website builder, which waited on its
// whole read wave before it could switch views ("Setting the table…"). The nav
// now points at /settings.html: eight cards that route to where each thing
// already lives, plus the studio profile editable inline (GET/PUT /identity,
// the industry via /settings). The old hash keeps working as a deep link.
const IDENTITY = { data: { site_id: 's1', business_name: 'Davis Digital Studio', email: 'hello@example.com', phone: '', service_area: 'Burbank, CA', tagline: '', description: '', story: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '', updated_at: '2026-10-01T00:00:00Z' } };
const API = {
  '/identity': IDENTITY,
  '/settings': { data: { industry_key: 'generic' } },
  '/connections': { data: { services: [{ key: 'ga4', status: 'connected' }, { key: 'gsc', status: 'connected' }, { key: 'gbp', status: 'attention' }] } },
  '/commerce/subscription': { data: { plan_name: 'Studio', status: 'active', can_manage_billing: true } },
};

test.describe('Settings page', () => {
  test('the shell’s Settings link points at the page, and the page loads in one go', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.locator('#dds-settings')).toHaveAttribute('href', '/settings.html');
    // the eight areas, each a link to where the thing lives
    const cards = page.locator('#cards .setcard');
    await expect(cards).toHaveCount(8);
    await expect(page.locator('[data-card="team"]')).toHaveAttribute('href', '/sharing.html');
    await expect(page.locator('[data-card="connections"]')).toHaveAttribute('href', '/connections.html');
    await expect(page.locator('[data-card="dev"]')).toHaveAttribute('href', '/developer.html');
    await expect(page.locator('[data-card="money"]')).toHaveAttribute('href', '/pipeline.html?services=1');
    // the profile form is pre-filled from /identity — no second load, no loadline
    await expect(page.locator('#f-name')).toHaveValue('Davis Digital Studio');
    await expect(page.locator('#f-area')).toHaveValue('Burbank, CA');
    await expect(page.locator('#f-industry')).toHaveValue('generic');
    await expect(page.locator('#main')).not.toContainText('Setting the table');
    // quick statuses, never blockers
    await expect(page.locator('[data-card="connections"] .st')).toContainText('2 connected · 1 needs attention');
    await expect(page.locator('[data-card="billing"] .st')).toContainText('Studio · Active');
  });

  test('Save writes PUT /identity and PUT /settings (industry) with what was typed', async ({ page }) => {
    const puts: Array<{ path: string; body: unknown }> = [];
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      puts.push({ path: new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...IDENTITY.data, business_name: 'DDS', industry_key: 'web_design' } }) });
    });
    await page.goto('/settings.html');
    await expect(page.locator('#f-name')).toHaveValue('Davis Digital Studio');
    await page.locator('#f-name').fill('DDS');
    await page.locator('#f-phone').fill('555-0100');
    const opts = await page.locator('#f-industry option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const pick = opts.includes('web_design') ? 'web_design' : opts[1];
    await page.locator('#f-industry').selectOption(pick);
    await page.locator('#profileSave').click();
    await expect(page.locator('.dds-toast')).toContainText('Saved');
    expect(puts).toEqual([
      { path: '/identity', body: { business_name: 'DDS', email: 'hello@example.com', phone: '555-0100', service_area: 'Burbank, CA' } },
      { path: '/settings', body: { industry_key: pick } },
    ]);
  });

  test('cards a plan or role does not include are left out; the billing card is owner-only', async ({ page }) => {
    const ctx = { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'cms_only', edition_name: 'CMS', edition_features: ['website', 'forms'],
      is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish'],
      landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
    } };
    await installApp(page, { api: { ...API, '/portal/context': ctx } });
    await page.goto('/settings.html?client=site-9');
    await expect(page.locator('[data-card="studio"]')).toBeVisible();
    await expect(page.locator('[data-card="domains"]')).toBeVisible();
    await expect(page.locator('[data-card="team"]')).toHaveCount(0);        // no client_portal / invite
    await expect(page.locator('[data-card="connections"]')).toHaveCount(0); // no 'connected'
    await expect(page.locator('[data-card="dev"]')).toHaveCount(0);
    await expect(page.locator('[data-card="billing"]')).toHaveCount(0);     // scoped into a client: never the studio's own billing
  });

  test('the old /presence.html#settings deep link still opens the builder’s Business view — and before the data lands', async ({ page }) => {
    const PRESENCE_API = {
      '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
      '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
      '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
      '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
      '/moments': { data: [] }, '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, updated_at: null, updated_by: null } },
      '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
    };
    await installApp(page, { api: PRESENCE_API });
    // hold the slowest read of the wave: the page must NOT sit on Today's loadline meanwhile
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/media', async (route) => { await held; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }); });
    await page.goto('/presence.html#settings');
    await expect(page.locator('#view-business')).toBeVisible();
    await expect(page.locator('#view-today')).toBeHidden();
    release();
    await expect(page.locator('#view-business')).toBeVisible();
  });
});
