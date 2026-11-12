import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from '../../tests/e2e/helpers/app';
import { applyPhoneBar } from '../../supabase/functions/presence/lib/phone_bar';

// ── What's new's pictures (builder list item 128, Nov 2026) ──
// Every entry in whats-new.json carries a picture of what changed, taken here on sample
// data, never a client's site: the same hermetic pages the browser suite draws (its
// helper, tests/e2e/helpers/app.ts), and the sample restaurant's own page from the template
// picture record (tests/presence/golden). A tool beside scripts/thumbnails, not part of the
// browser suite, and it only runs when asked, so nothing rewrites the pictures by accident:
//   WHATS_NEW_SHOOT=1 npx playwright test -c scripts/whats-new/playwright.config.ts
// It writes thumbs/whats-new/<id>.jpg at 1280×720, which the panel shows at 16:9.
test.skip(!process.env.WHATS_NEW_SHOOT, 'takes the pictures only when asked');
test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OUT = (id: string) => { mkdirSync(join(ROOT, 'thumbs', 'whats-new'), { recursive: true }); return join(ROOT, 'thumbs', 'whats-new', `${id}.jpg`); };
const shoot = (page: Page, id: string) => page.screenshot({ path: OUT(id), type: 'jpeg', quality: 82 });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const quiet = (page: Page) => page.addInitScript(() => {
  try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1, 'search-plain': 1, 'media-inuse': 1 })); localStorage.setItem('dds-toured:business_owner', '1'); localStorage.setItem('dds-toured:agency', '1'); } catch { /* */ }
});
// The sample restaurant's home page as the template draws it, its photos as warm blocks.
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 16 10.67"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9a27e"/><stop offset="1" stop-color="#7d5a44"/></linearGradient></defs><rect width="16" height="10.67" fill="url(#g)"/></svg>';
async function sampleSite(page: Page, bar?: 'light' | 'dark') {
  const fx = JSON.parse(read('supabase/functions/presence/templates/restaurant-classic/1.0.0/fixture.json'));
  let html = read('tests/presence/golden/restaurant-classic-1.0.0/index.html');
  if (bar) html = String(applyPhoneBar({ 'index.html': html }, bar, { identity: fx.content.identity, locations: fx.content.locations })['index.html']);
  await page.route(/\/__wn_site__\/(index\.html)?$/, (r: Route) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.route(/\/assets\/site\.css$/, (r: Route) => r.fulfill({ status: 200, contentType: 'text/css', body: read('tests/presence/golden/restaurant-classic-1.0.0/assets/site.css') }));
  await page.route(/\/img\/[^/]+\.(webp|avif|jpg|png)$/, (r: Route) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTO }));
  return html;
}

test('phone-bar: a sample restaurant on a phone, with Call, Directions, Hours and Email', async ({ page }) => {
  await sampleSite(page, 'dark');
  await page.route(/\/__wn_frame__$/, (r: Route) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body:
    '<!doctype html><html><body style="margin:0;height:720px;display:grid;place-items:center;background:linear-gradient(135deg,#f3eefc,#fbf7f2)">'
    + '<div style="width:332px;height:676px;border-radius:44px;background:#16131f;padding:12px;box-shadow:0 30px 60px -20px rgba(23,19,32,.45)">'
    + '<iframe src="/__wn_site__/index.html" style="width:390px;height:780px;border:0;border-radius:34px;transform:scale(.8205);transform-origin:0 0;background:#fff"></iframe></div></body></html>' }));
  await page.goto('/__wn_frame__');
  await expect(page.frameLocator('iframe').locator('.dds-phonebar')).toBeVisible();
  await page.waitForTimeout(500);
  await shoot(page, 'phone-bar');
});

test('search-todo: the Search tab’s ranked to-do list', async ({ page }) => {
  await quiet(page);
  const OFF = { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'connect', unavailable: false, has_data: false, property: null, data: null };
  await installApp(page, { api: {
    '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
    '/health': { data: {} }, '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
    '/settings': { data: { blocks: [], section_meta: {}, pages: [] } },
    '/site': { data: { site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: 'restaurant-classic', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' },
      identity: { business_name: 'Marlow’s Kitchen', seo_title: 'Italian restaurant in Burbank — Marlow’s Kitchen', seo_description: '' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [] } },
    '/visibility': { data: { state: 'ready', address: { url: 'https://marlows.example/', domain: 'marlows.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai', console: OFF, listing: OFF,
      tasks: [
        { key: 'console', priority: 'high', done: false, title: 'Connect Google Search Console', sub: 'See what people search to find you, and what they click.', go: 'connect:console' },
        { key: 'description', priority: 'high', done: false, title: 'Add a search description', sub: 'The line under the headline. Google writes its own when there is none.', go: 'wording' },
        { key: 'listing', priority: 'medium', done: false, title: 'Connect your Google listing', sub: 'Your reviews, calls and directions, here.', go: 'connect:listing' },
        { key: 'llms', priority: 'medium', done: false, title: 'Write your llms.txt for AI tools', sub: 'A short file that tells ChatGPT and Claude what you do.', go: 'tool:llms' },
        { key: 'publish', priority: 'critical', done: true, title: 'Your site is published', sub: '', go: null },
        { key: 'title', priority: 'high', done: true, title: 'Add a search headline', sub: '', go: null },
      ] } },
  } as never });
  await page.goto('/presence.html#search');
  const card = page.locator('.sv-card', { has: page.locator('#seoTasks') });
  await expect(card.locator('.sv-todo li').first()).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const c = document.getElementById('seoTasks')!.closest('.sv-card') as HTMLElement; window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 90); });
  await page.waitForTimeout(400);
  await shoot(page, 'search-todo');
});

test('sites-numbers: three sample sites with their health, visitors and Google clicks', async ({ page }) => {
  await quiet(page);
  const site = (over: Record<string, unknown>) => ({
    site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live', address: '', domain: null, domain_registrar: null, domain_expires_at: null,
    plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
    team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
    tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: 'live', copied: null, no_owner: false, ...over });
  const NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
  await installApp(page, { api: {
    '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['view_all'], landing: '/sites.html', attention_count: 0, nav: NAV } },
    '/agency/sites': { data: [site({ site_id: 's1', name: 'Maple & Main Realty', address: 'https://maple.example', domain: 'maple.example' }), site({ site_id: 's2', name: 'Bluebird Bakery', address: 'https://bluebird.example', domain: 'bluebird.example' }), site({ site_id: 's3', name: 'Marlow’s Kitchen', address: 'https://marlows.example', domain: 'marlows.example' })], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90 },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  } as never });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/thumb/, (r: Route) => r.fulfill(json({ data: { html: '<h1 style="font:600 40px Georgia;margin:40px">Home</h1>', version: 'live' } })));
  await page.route(/\/functions\/v1\/presence\/agency\/site-numbers$/, (r: Route) => r.fulfill(json({ data: {
    s1: { visitors: { value: 812, prior: 688 }, visitors_why: null, search: { value: 64, prior: 59 }, search_why: null, health: { score: 92, prior: 88, to_look_at: 2, day: '2026-11-11', prior_day: '2026-10-12' }, health_why: null },
    s2: { visitors: { value: 389, prior: 659 }, visitors_why: null, search: { value: 12, prior: 24 }, search_why: null, health: { score: 61, prior: 76, to_look_at: 7, day: '2026-11-11', prior_day: '2026-10-12' }, health_why: null },
    s3: { visitors: { value: 1204, prior: 1010 }, visitors_why: null, search: { value: 96, prior: 71 }, search_why: null, health: { score: 88, prior: 84, to_look_at: 3, day: '2026-11-11', prior_day: '2026-10-12' }, health_why: null },
  }, month: '2026-10', prior_month: '2026-09', month_label: 'October', prior_label: 'September', partial: false })));
  await page.addInitScript(() => { try { localStorage.setItem('dds-display:sites', 'table'); } catch { /* */ } });
  await page.goto('/sites.html');
  const head = page.getByText('October, compared with September.');
  await expect(head).toBeVisible();
  await page.evaluate(() => { const n = Array.from(document.querySelectorAll('div, p')).find((e) => /^October, compared with September/.test(e.textContent || '')) as HTMLElement; window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 150); });
  await page.waitForTimeout(500);
  await shoot(page, 'sites-numbers');
});

test('portal-look: a sample client’s portal, the studio’s colours up top and the website first', async ({ page }) => {
  const PID = '11111111-1111-4111-8111-111111111111';
  await installApp(page, { api: {
    '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
      is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0, nav: [], studio: { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false }, client_first_name: 'Maria' } },
    '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
    '/client/notifications': { data: [], unread_count: 0 },
    '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
    [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 4, done: 3, pct: 75 }, deliverables: [], approvals: [] } },
    [`/client/projects/${PID}/report`]: { data: { summary: null } },
    [`/client/projects/${PID}/messages`]: { data: [] },
    '/client/documents': { data: { documents: [] } }, '/client/billing': { data: { invoices: [] } }, '/client/reports': { data: { reports: [] } },
    '/client/support': { data: [] }, '/client/faq': { data: { html: '', faq: { items: [] } } }, '/client/kit': { data: null },
  } as never });
  await page.goto('/client.html');
  await expect(page.locator('#tabnav [data-tab]').first()).toBeVisible();
  await page.waitForTimeout(800);
  await shoot(page, 'portal-look');
});

test('floating-editor: Edit site on the sample restaurant, the bar on top and the dock below', async ({ page }) => {
  await quiet(page);
  const html = await sampleSite(page);
  await installApp(page, { api: {
    '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
    '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
    '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
    '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'restaurant-classic', template_version: 1 }, identity: { business_name: 'Vermilion & Vine' }, location: {} } },
    '/settings': { data: { blocks: [], section_meta: { blocks: [], pages: {} } } },
    '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  } as never });
  await page.route('**/functions/v1/presence/preview**', (r: Route) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('/presence.html#design');
  await expect(page.locator('.dc-bar')).toBeVisible();
  await page.waitForTimeout(1500);
  await shoot(page, 'floating-editor');
});

test('real-pictures: the template picker’s pictures, each drawn on sample data', async ({ page }) => {
  const pic = (slug: string) => `<figure style="margin:0;width:360px;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 18px 40px -18px rgba(23,19,32,.35)"><img src="/thumbs/templates/${slug}.jpg" style="display:block;width:100%" alt=""><figcaption style="font:600 15px/1 Inter,system-ui,sans-serif;padding:14px 16px;color:#171522">${slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())}</figcaption></figure>`;
  await page.route(/\/__wn_frame__$/, (r: Route) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body:
    `<!doctype html><html><body style="margin:0;height:720px;display:flex;gap:28px;align-items:center;justify-content:center;background:linear-gradient(135deg,#f3eefc,#fbf7f2)">${['restaurant-classic', 'slate', 'aurora'].map(pic).join('')}</body></html>` }));
  await page.goto('/__wn_frame__');
  await page.waitForTimeout(400);
  await shoot(page, 'real-pictures');
});

// ── This week's builder changes (items 40, 127 and 160), drawn on the same sample restaurant ──
const BUILDER_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: {} }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, font_library: [] } },
};
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day, i) => ({ day, closed: i === 0, intervals: i === 0 ? [] : [{ open: '17:00', close: '22:00' }] }));
const SAMPLE_SITE = (over: Record<string, unknown> = {}) => ({ data: {
  site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: 'restaurant-classic', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' },
  identity: { business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates in Burbank', description: 'We started as a Saturday stall at the farmers market.', short_description: 'A neighbourhood kitchen in Burbank: seasonal plates and sourdough baked every morning.', phone: '(555) 010-0142', email: 'hello@marlows.example', seo_title: 'Italian restaurant in Burbank — Marlow’s Kitchen', seo_description: 'Seasonal plates in Burbank, CA.' },
  location: { address_line1: '12 Main St', city: 'Burbank', region: 'CA', postal_code: '91502', timezone: 'America/Los_Angeles', hours: WEEK,
    second_location: { label: 'Glendale', address_line1: '410 Brand Blvd', address_line2: '', city: 'Glendale', region: 'CA', postal_code: '91203', phone: '(555) 010-0199', same_hours: true, hours: [] } },
  voice: {}, offerings: [], faqs: [], testimonials: [], posts: [], ...over,
} });

test('blog: writing a post on a screen that looks like the site', async ({ page }) => {
  await quiet(page);
  const COVER = '00000000-0000-4000-8000-000000000502';
  await installApp(page, { api: { ...BUILDER_API, '/site': SAMPLE_SITE(),
    '/media': { data: [{ id: COVER, alt_text: 'The patio with its heaters on', mime: 'image/jpeg', width: 1600, height: 1067, thumb: `/__wn_photo__/${COVER}.svg`, used_by: [] }] },
    '/settings': { data: { blocks: [], section_meta: {}, pages: [], post_categories: [{ id: 'news', name: 'News' }], post_authors: [{ id: 'maria-lopez', name: 'Maria Lopez', bio: 'Owner and head chef' }] } },
    '/posts': { data: [{ id: '00000000-0000-4000-8000-000000000011', title: 'Summer patio is open', slug: 'summer-patio', body_md: 'Our patio opens Friday, with heaters for the cool nights and a short menu of plates to share.\n\nBook a table outside, or just walk in.', excerpt: '', hero_media_id: COVER, status: 'draft', published_at: null, tags: [], noindex: false, category: 'news', author: 'maria-lopez', updated_at: '2026-11-10T17:00:00Z' }] },
  } as never });
  await page.route(/\/__wn_photo__\//, (r: Route) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTO }));
  await page.goto('/presence.html#updates');
  await page.locator('.bl-card .bl-title button').first().click();
  await expect(page.locator('.bs-body')).toBeVisible();
  await page.waitForTimeout(800);
  await shoot(page, 'blog');
});

test('business-details: four cards, each field saying where it shows', async ({ page }) => {
  await quiet(page);
  await installApp(page, { api: { ...BUILDER_API, '/site': SAMPLE_SITE(), '/media': { data: [] }, '/posts': { data: [] } } as never });
  await page.goto('/presence.html#business');
  await expect(page.locator('#f-short_description')).toHaveValue(/neighbourhood kitchen/);
  await page.evaluate(() => { const c = document.querySelector('#view-business .biz-grid') as HTMLElement; window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 24); });
  await page.waitForTimeout(500);
  await shoot(page, 'business-details');
});

test('search-phrases: what people type to find you, and Add it to a page', async ({ page }) => {
  await quiet(page);
  const OFF = { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'connect', unavailable: false, has_data: false, property: null, data: null };
  const pages = [
    { key: 'home', label: 'Home', title: 'Italian restaurant in Burbank — Marlow’s Kitchen' },
    { key: 'offerings', label: 'Menu', title: 'Menu — Marlow’s Kitchen' },
    { key: 'page:private-events', label: 'Private events', title: 'Private events — Marlow’s Kitchen' },
  ];
  const phrases = { max: 3, pages, ideas: ['catering burbank', 'wine dinners burbank', 'brunch glendale'],
    list: [{ phrase: 'italian restaurant burbank', found: pages[0] }, { phrase: 'private dining glendale', found: null }],
    tasks: [{ key: 'phrase:private dining glendale', priority: 'high', done: false, title: 'Put “private dining glendale” in a page’s search headline', sub: 'Google reads the headline first. Pick the page that is about it.', go: 'phrases' }] };
  await installApp(page, { api: { ...BUILDER_API, '/site': SAMPLE_SITE(), '/media': { data: [] }, '/posts': { data: [] }, '/settings': { data: { blocks: [], section_meta: {}, pages: [], page_seo: {} } },
    '/visibility': { data: { state: 'ready', address: { url: 'https://marlows.example/', domain: 'marlows.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai', console: OFF, listing: OFF, tasks: phrases.tasks, phrases } },
  } as never });
  await page.goto('/presence.html#search');
  await page.locator('.sv-ph-row[data-phrase="private dining glendale"]').getByRole('button', { name: 'Add it to a page' }).click();
  await page.locator('.sv-ph-pick').getByRole('button', { name: /Private events/ }).click();
  await page.evaluate(() => { const c = document.getElementById('svPhrasesCard')!; window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 24); });
  await page.waitForTimeout(500);
  await shoot(page, 'search-phrases');
});
