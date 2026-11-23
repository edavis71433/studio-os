import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// ── Business details: "We go to our customers" (builder list item 334, Nov 2026) ──
// A business with no shopfront switches the address off: the street, town, state and ZIP
// fold away (kept, unshown), Where you work moves into the Locations card where they were,
// and its hint says it shows where an address would. The switch shows only once /site says
// the database can save it (migration 0255). A failed save puts it back. Hermetic: every
// write is recorded, nothing leaves. Every project runs it: computer, tablet, phone.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day, i) => ({ day, closed: i === 6, intervals: i === 6 ? [] : [{ open: '07:00', close: '19:00' }] }));
const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: {} }, '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, font_library: [] } },
};
const SITE = (location: Record<string, unknown>, fields: string[]) => ({ data: {
  site: { id: id(1), client_id: id(2), status: 'draft', edition: 'presence', custom_domain: null, template_slug: 'harbor', last_published_at: null, netlify_site_id: null },
  identity: { business_name: 'Copper Line Plumbing', tagline: 'Plumbers who come to you', description: 'Licensed plumbers.', short_description: '', phone: '(555) 010-0199', email: 'hi@copperline.example', service_area: '' },
  location: { address_line1: '12 Main St', city: 'Burbank', region: 'CA', postal_code: '91502', timezone: 'America/Los_Angeles', hours: WEEK, second_location: null, ...location },
  location_fields: fields,
  voice: {}, offerings: [], faqs: [], testimonials: [], posts: [],
} });

type Call = { path: string; body: Record<string, unknown> };
async function open(page: Page, location: Record<string, unknown> = {}, fields = ['second_location', 'goes_to_customers'], failGoes = false): Promise<Call[]> {
  const calls: Call[] = [];
  await installApp(page, { api: { ...PAGE_API, '/site': SITE(location, fields) } as never });
  await page.route('**/functions/v1/presence/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (req.method() === 'PUT' && (path === '/identity' || path === '/location')) {
      const body = req.postDataJSON() as Record<string, unknown>;
      calls.push({ path, body });
      if (failGoes && 'goes_to_customers' in body) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed', message: 'That didn’t save. Nothing was changed. Please try again.' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
    }
    return route.fallback();
  });
  await page.goto('/presence.html#business');
  await expect(page.locator('#view-business')).toBeVisible();
  await expect(page.locator('#f-business_name')).toHaveValue('Copper Line Plumbing');
  return calls;
}
const goesPuts = (calls: Call[]) => calls.filter((c) => c.path === '/location' && 'goes_to_customers' in c.body);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test.describe('Business details: We go to our customers', () => {
  test('off: the address shows as before, Where you work stays under Contact', async ({ page }) => {
    await open(page);
    await expect(page.locator('#goesRow')).toBeVisible();
    await expect(page.locator('#goesSwitch')).not.toBeChecked();
    await expect(page.locator('#f-address_line1')).toBeVisible();
    await expect(page.locator('#f-address_line1')).toHaveValue('12 Main St');
    await expect(page.locator('#areaHome #f-service_area')).toHaveCount(1);
    await expect(page.locator('#goesHint')).toBeHidden();
  });

  test('on: the address folds away, Where you work takes its place and says where it shows', async ({ page }) => {
    const calls = await open(page);
    await page.locator('#goesSwitch').check();
    await expect.poll(() => goesPuts(calls).at(-1)?.body).toEqual({ goes_to_customers: true });
    await expect(page.locator('#bizAddr')).toBeHidden();
    await expect(page.locator('#goesArea #f-service_area')).toBeVisible();
    await expect(page.locator('#f-service_area')).toBeFocused();   // empty, so the cursor goes there
    await expect(page.locator('#goesHint')).toHaveText('No street address or Get directions link shows on your site. It names the places you serve instead, from Where you work. Your address stays saved here, unshown.');
    await expect(page.locator('[data-shows="service_area"]')).toHaveText('Shows where an address would: at the top of your home page, in your footer, on your Contact page and on your About page. Google is told the places you serve.');
    await page.locator('#f-service_area').fill('Serving Burbank, Glendale and Pasadena');
    await expect.poll(() => calls.filter((c) => c.path === '/identity').at(-1)?.body).toEqual({ service_area: 'Serving Burbank, Glendale and Pasadena' });
    // and back: the address is there again, untouched, and Where you work goes home
    await page.locator('#goesSwitch').uncheck();
    await expect.poll(() => goesPuts(calls).at(-1)?.body).toEqual({ goes_to_customers: false });
    await expect(page.locator('#f-address_line1')).toBeVisible();
    await expect(page.locator('#f-address_line1')).toHaveValue('12 Main St');
    await expect(page.locator('#areaHome #f-service_area')).toHaveValue('Serving Burbank, Glendale and Pasadena');
    expect(calls.filter((c) => c.path === '/location' && 'address_line1' in c.body)).toEqual([]);   // the address was never cleared
  });

  test('a site saved with it on opens with it on', async ({ page }) => {
    await open(page, { goes_to_customers: true });
    await expect(page.locator('#goesSwitch')).toBeChecked();
    await expect(page.locator('#bizAddr')).toBeHidden();
    await expect(page.locator('#goesArea #f-service_area')).toBeVisible();
  });

  test('before the database can save it, there is no switch', async ({ page }) => {
    await open(page, {}, ['second_location']);
    await expect(page.locator('#goesRow')).toBeHidden();
    await expect(page.locator('#f-address_line1')).toBeVisible();
  });

  test('a save that fails puts the switch back and says so', async ({ page }) => {
    const calls = await open(page, {}, ['second_location', 'goes_to_customers'], true);
    await page.locator('#goesSwitch').click();   // not check(): the switch goes back as soon as the save fails
    await expect.poll(() => goesPuts(calls).length).toBe(1);
    await expect(page.locator('#goesSwitch')).not.toBeChecked();
    await expect(page.locator('#bizAddr')).toBeVisible();
    await expect(page.locator('#areaHome #f-service_area')).toHaveCount(1);
  });

  test('on a touch screen the switch is a full-size tap target', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop-chromium', '44px taps are the touch rule');
    await open(page);
    const box = await page.locator('#goesRow').boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
  });
});
