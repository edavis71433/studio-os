import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// ── Reviews that go to Google (sales review item 115, extending item 93) ──────
// The Reviews tab offers the Google review box as a destination, pastes the
// place id once, lists who just paid as a ticked list, and says plainly when
// Google hasn't approved the listing connection yet. Hermetic: the API is
// fixtures; every name is made up. The one promise asserted throughout —
// nothing sends unless the owner presses the button.

// What presence.html reads while it starts, beyond the helper's defaults.
const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'marlows.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [] } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/site': { data: {
    site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' },
    identity: { business_name: 'Marlow’s Kitchen' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [],
  } },
};

const CT_PAT = '11111111-1111-4111-8111-111111111111';
const CT_SAM = '22222222-2222-4222-8222-222222222222';
const G_NONE = { connected: false, link: null, source: null, place_id: null, can_save_place_id: true, listing: null };
const G_PENDING = { ...G_NONE, connected: true };
const G_PASTED = { ...G_NONE, link: 'https://search.google.com/local/writereview?placeid=ChIJPastedPlace_12', source: 'pasted', place_id: 'ChIJPastedPlace_12' };
const G_LIVE = { connected: true, link: 'https://search.google.com/local/writereview?placeid=FromGoogle123', source: 'google', place_id: null, can_save_place_id: true,
  listing: { rating: 4.6, review_count: 128, new_reviews: 2, unreplied: 3, name: 'Marlow’s Kitchen', maps_uri: 'https://maps.google.com/?cid=1', as_of: '2026-11-10T00:00:00Z' } };
const PAID = [
  { contact_id: CT_PAT, name: 'Pat Jones', email: 'pat@client.example', paid_at: '2026-11-09T12:00:00Z', title: 'New website', amount_cents: 120000, purpose: 'final' },
  { contact_id: CT_SAM, name: 'Sam Lee', email: 'sam@client.example', paid_at: '2026-11-07T12:00:00Z', title: 'Logo', amount_cents: 40000, purpose: 'final' },
];
const reviewsData = (google: unknown, recently_paid: unknown[] = []) =>
  ({ data: { reviews: [], counts: { pending: 0, approved: 0, hidden: 0 }, aggregate: { count: 0, average: 0 }, aggregate_text: '', google, recently_paid } });

/** Mock the two review endpoints after installApp, recording every POST body. */
async function withReviews(page: Page, state: { google: unknown; paid?: unknown[] }) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/functions/v1/presence/reviews**', async (route) => {
    const m = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    const ok = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/reviews' && m === 'GET') return ok(reviewsData(state.google, state.paid || []));
    if (m === 'POST') {
      posts.push({ path, body: route.request().postDataJSON() as Record<string, unknown> });
      if (path === '/reviews/google-link') {
        const id = String((posts[posts.length - 1].body as { place_id?: unknown }).place_id || '');
        return ok({ data: { ok: true, place_id: id || null, link: id ? `https://search.google.com/local/writereview?placeid=${id}` : null } });
      }
      if (path === '/reviews/request') return ok({ data: { ok: true, sent: 1, skipped: [], destination: 'google' } });
    }
    return ok({ data: {} });
  });
  return posts;
}

async function openReviews(page: Page) {
  await page.goto('/presence.html#reviews');
  await expect(page.locator('#view-reviews')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask for a review' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test.describe('Reviews that go to Google (item 115)', () => {
  test('no Google link yet: the Google choice waits, the paste saves the place id', async ({ page }) => {
    await installApp(page, { api: PAGE_API as never });
    const posts = await withReviews(page, { google: G_NONE });
    await openReviews(page);
    await expect(page.getByRole('radio', { name: 'Your website’s review page' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Your Google review box' })).toBeDisabled();
    await expect(page.getByText('paste your Google place id')).toBeVisible();
    await page.getByPlaceholder('Google place id or “write a review” link').fill('ChIJPastedPlace_12');
    await page.getByRole('button', { name: 'Save Google link' }).click();
    await expect(page.locator('.dds-toast, #toast').getByText('Saved — Google requests are ready')).toBeVisible();
    expect(posts).toEqual([{ path: '/reviews/google-link', body: { place_id: 'ChIJPastedPlace_12' } }]);
  });

  test('Google approval pending: the page says so plainly, twice', async ({ page }) => {
    await installApp(page, { api: PAGE_API as never });
    await withReviews(page, { google: G_PENDING });
    await openReviews(page);
    await expect(page.getByText('Google hasn’t approved the listing connection yet, so it hasn’t handed back your review link')).toBeVisible();
    await expect(page.getByText('Your Google reviews will show here once it does')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Your Google review box' })).toBeDisabled();
  });

  test('a pasted place id arms the Google choice, and a single ask carries it', async ({ page }) => {
    await installApp(page, { api: PAGE_API as never });
    const posts = await withReviews(page, { google: G_PASTED });
    await openReviews(page);
    const googleRadio = page.getByRole('radio', { name: 'Your Google review box' });
    await expect(googleRadio).toBeEnabled();
    await expect(page.getByText('Google requests use the place id you pasted.')).toBeVisible();
    await googleRadio.check();
    await page.getByPlaceholder('Customer email').fill('pat@client.example');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.locator('.dds-toast, #toast').getByText('Review request sent')).toBeVisible();
    expect(posts).toEqual([{ path: '/reviews/request', body: { email: 'pat@client.example', name: '', destination: 'google' } }]);
  });

  test('the Google listing feeds the reviews card, read-only and honest', async ({ page }) => {
    await installApp(page, { api: PAGE_API as never });
    await withReviews(page, { google: G_LIVE });
    await openReviews(page);
    await expect(page.getByText('4.6 from 128 Google reviews')).toBeVisible();
    await expect(page.getByText('2 new in the last month · 3 without a reply')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your listing on Google →' })).toHaveAttribute('href', 'https://maps.google.com/?cid=1');
    await expect(page.getByText('Google requests use the review link from your Google listing.')).toBeVisible();
    await expect(page.getByPlaceholder('Google place id or “write a review” link')).toHaveCount(0);
  });

  test('just paid you: tick the people, press the button, ONE send call with the ticked ids', async ({ page }) => {
    await installApp(page, { api: PAGE_API as never });
    const posts = await withReviews(page, { google: G_PASTED, paid: PAID });
    await openReviews(page);
    await expect(page.getByRole('heading', { name: 'Just paid you' })).toBeVisible();
    await expect(page.getByText('Pat Jones')).toBeVisible();
    await expect(page.getByText('Sam Lee')).toBeVisible();
    // nothing was sent just by loading the page
    expect(posts).toEqual([]);
    await page.getByRole('checkbox').first().check();
    await page.getByRole('radio', { name: 'Your Google review box' }).check();
    await page.getByRole('button', { name: 'Ask the ticked customers' }).click();
    await expect(page.locator('.dds-toast, #toast').getByText('Asked 1')).toBeVisible();
    expect(posts).toEqual([{ path: '/reviews/request', body: { contact_ids: [CT_PAT], destination: 'google' } }]);
  });

  test('nothing ticked: the button asks for a tick and sends nothing', async ({ page }) => {
    await installApp(page, { api: PAGE_API as never });
    const posts = await withReviews(page, { google: G_NONE, paid: PAID });
    await openReviews(page);
    await page.getByRole('button', { name: 'Ask the ticked customers' }).click();
    await expect(page.locator('.dds-toast, #toast').getByText('Tick at least one customer')).toBeVisible();
    expect(posts).toEqual([]);
  });
});
