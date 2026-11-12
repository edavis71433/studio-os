import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// ── Business details: where each field shows, a short description, a second location (builder list item 127, Nov 2026) ──
// Four cards; under each field one sentence says where it shows on the live site (two differ
// on Restaurant Classic); the short description counts to 150 and shows the line a shared
// link carries; a second location saves whole once it has a street and a city, with the
// main location's hours or its own. Hermetic: every write is recorded, nothing leaves.
// Every project runs it: computer, tablet, phone.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day, i) => ({ day, closed: i === 0, intervals: i === 0 ? [] : [{ open: '17:00', close: '22:00' }] }));
const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: {} }, '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, font_library: [] } },
};
const SITE = (template: string, second: Record<string, unknown> | null = null) => ({ data: {
  site: { id: id(1), client_id: id(2), status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: template, last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' },
  identity: { business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates in Burbank', description: 'We started as a Saturday stall at the farmers market.', short_description: '', phone: '(555) 010-0142', email: 'hello@marlows.example' },
  location: { address_line1: '12 Main St', city: 'Burbank', region: 'CA', postal_code: '91502', timezone: 'America/Los_Angeles', hours: WEEK, second_location: second },
  voice: {}, offerings: [], faqs: [], testimonials: [], posts: [],
} });

type Call = { method: string; path: string; body: Record<string, unknown> | null };
async function open(page: Page, template = 'restaurant-classic', second: Record<string, unknown> | null = null): Promise<Call[]> {
  const calls: Call[] = [];
  await installApp(page, { api: { ...PAGE_API, '/site': SITE(template, second) } as never });
  await page.route('**/functions/v1/presence/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (req.method() === 'PUT' && (path === '/identity' || path === '/location')) {
      const body = req.postDataJSON() as Record<string, unknown>;
      calls.push({ method: 'PUT', path, body });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
    }
    return route.fallback();
  });
  await page.goto('/presence.html#business');
  await expect(page.locator('#view-business')).toBeVisible();
  await expect(page.locator('#f-business_name')).toHaveValue('Marlow’s Kitchen');
  return calls;
}
const placePuts = (calls: Call[]) => calls.filter((c) => c.path === '/location' && 'second_location' in (c.body || {}));
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

// No page error, and no error message at any point (one goes after five seconds, so each is
// caught as it's shown).
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.addInitScript(() => {
    const w = window as unknown as { __errToasts: string[] }; w.__errToasts = [];
    let real: ((...a: unknown[]) => unknown) | undefined;
    Object.defineProperty(window, 'ddsToast', { configurable: true, get: () => real,
      set(fn) { real = function (this: unknown, ...a: unknown[]) { if (a[1] === 'err') w.__errToasts.push(String(a[0])); return fn.apply(this, a); }; } });
  });
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __errToasts?: string[] }).__errToasts ?? [])).toEqual([]);
});

test.describe('Business details: where each field shows', () => {
  test('four cards, and a sentence under each field saying where it shows', async ({ page }) => {
    await open(page);
    await expect(page.locator('#view-business .biz-card > h5.rune')).toHaveText([/About your business/, 'Contact', /Locations/, /Hours/, /Privacy/]);
    await expect(page.locator('[data-shows="business_name"]')).toHaveText('Shows at the top of every page, in the browser tab, in Google results and on the emails you send.');
    await expect(page.locator('[data-shows="story"]')).toHaveText('Shows on your About page.');
    await expect(page.locator('[data-shows="address"]')).toContainText('Get directions');
    await expect(page.locator('[data-shows="hours"]')).toHaveText('Shows on your Contact page and in your footer. Google reads them too.');
    const empty = await page.locator('#view-business [data-shows]').evaluateAll((els) => els.filter((e) => !e.textContent!.trim()).length);
    expect(empty).toBe(0);
    await noSideScroll(page);
  });

  test('Restaurant Classic shows Where you work on its About page only, and its button says Reserve a table', async ({ page }) => {
    await open(page, 'restaurant-classic');
    await expect(page.locator('[data-shows="service_area"]')).toHaveText('Shows on your About page.');
    await expect(page.locator('[data-shows="booking_url"]')).toContainText('Reserve a table');
  });

  test('with the footer’s hours switched off, Hours says it shows on the Contact page only', async ({ page }) => {
    await installApp(page, { api: { ...PAGE_API, '/settings': { data: { blocks: [], section_meta: {}, pages: [], footer_hours: false } }, '/site': SITE('restaurant-classic') } as never });
    await page.goto('/presence.html#business');
    await expect(page.locator('[data-shows="hours"]')).toHaveText('Shows on your Contact page. Google reads them too.');
  });

  test('another template shows Where you work at the top of the home page too', async ({ page }) => {
    await open(page, 'business-classic');
    await expect(page.locator('[data-shows="service_area"]')).toHaveText('Shows at the top of your home page and on your About page, and tells Google the places you serve.');
    await expect(page.locator('[data-shows="booking_url"]')).toHaveText('The first button at the top of your home page opens it.');
  });
});

test.describe('Business details: the short description', () => {
  test('it counts to 150, shows the line a shared link carries, and saves', async ({ page }) => {
    const calls = await open(page);
    const preview = page.locator('#bizShareDesc');
    await expect(preview).toHaveText('We started as a Saturday stall at the farmers market.');   // nothing set: the long description stands in
    await expect(page.locator('#bizShareName')).toHaveText('Marlow’s Kitchen');
    await page.locator('#f-short_description').fill('A neighbourhood kitchen in Burbank: seasonal plates and sourdough baked every morning.');
    await expect(page.locator('#cnt-short_description')).toHaveText('86 of 150');
    await expect(preview).toHaveText('A neighbourhood kitchen in Burbank: seasonal plates and sourdough baked every morning.');
    await expect.poll(() => calls.find((c) => c.path === '/identity' && 'short_description' in (c.body || {}))?.body?.short_description)
      .toBe('A neighbourhood kitchen in Burbank: seasonal plates and sourdough baked every morning.');
    await expect(page.locator('#f-short_description')).toHaveAttribute('maxlength', '150');
  });
});

test.describe('Business details: a second location', () => {
  test('it saves once it has a street and a city, with the main location’s hours', async ({ page }) => {
    const calls = await open(page);
    await page.getByRole('button', { name: 'Add a second location' }).click();
    await expect(page.locator('#f2-label')).toBeFocused();
    await page.locator('#f2-label').fill('Glendale');
    await page.locator('#f2-address_line1').fill('410 Brand Blvd');
    await expect(page.locator('#p2Wait')).toBeVisible();
    await page.waitForTimeout(900);
    expect(placePuts(calls)).toHaveLength(0);   // not a place yet
    await page.locator('#f2-city').fill('Glendale');
    await page.locator('#f2-phone').fill('(555) 010-0199');
    await expect.poll(() => placePuts(calls).at(-1)?.body?.second_location).toMatchObject({ label: 'Glendale', address_line1: '410 Brand Blvd', city: 'Glendale', phone: '(555) 010-0199', same_hours: true });
    await expect(page.locator('#p2Wait')).toBeHidden();
    await expect(page.locator('#hoursGrid2')).toBeHidden();
    await noSideScroll(page);
  });

  test('its own hours start as a copy of the main week, and a change saves', async ({ page }) => {
    const calls = await open(page, 'restaurant-classic', { label: 'Glendale', address_line1: '410 Brand Blvd', address_line2: '', city: 'Glendale', region: 'CA', postal_code: '91203', phone: '', same_hours: true, hours: [] });
    await expect(page.locator('#f2-label')).toHaveValue('Glendale');
    await page.getByText('Its own hours').click();
    const rows = page.locator('#hoursGrid2 .hrow');
    await expect(rows).toHaveCount(7);
    await expect(rows.first().locator('input[type=checkbox]')).toBeChecked();   // Monday closed, as the main week
    await rows.nth(1).locator('input[type=checkbox]').check();                   // Tuesday closed here
    await expect.poll(() => {
      const s = placePuts(calls).at(-1)?.body?.second_location as { same_hours?: boolean; hours?: Array<{ day: string; closed: boolean }> } | undefined;
      return s && s.same_hours === false && s.hours?.find((d) => d.day === 'tue')?.closed;
    }).toBe(true);
  });

  test('Remove takes it off in one step, and Put it back brings it back', async ({ page }) => {
    const calls = await open(page, 'restaurant-classic', { label: 'Glendale', address_line1: '410 Brand Blvd', address_line2: '', city: 'Glendale', region: 'CA', postal_code: '91203', phone: '', same_hours: true, hours: [] });
    await page.getByRole('button', { name: 'Remove the second location' }).click();
    await expect.poll(() => placePuts(calls).at(-1)?.body?.second_location).toBeNull();
    await expect(page.getByRole('button', { name: 'Add a second location' })).toBeVisible();
    await page.getByRole('button', { name: 'Put it back' }).click();
    await expect(page.locator('#f2-label')).toHaveValue('Glendale');
    await expect.poll(() => placePuts(calls).at(-1)?.body?.second_location).toMatchObject({ label: 'Glendale', address_line1: '410 Brand Blvd' });
  });
});
