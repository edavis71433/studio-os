import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// The workspace (presence.html) as the CMS surface — edition gating (Phase SKU),
// hash deep-links (Phase OS), and terminology (Phase PP: "Photos").
const PRESENCE_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
  // GET /changes returns an OBJECT (routes/room.ts handleChanges) — renderRecent
  // reads data.changes.length, so an array-shaped fixture throws in the page.
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/moments': { data: [] },
  // routes newer page code calls on boot / #design — real shapes from the routes:
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: ['accent', 'accent_soft', 'accent_dark', 'soft', 'ink', 'bg', 'radius', 'font_display', 'font_body', 'spacing_scale', 'font_scale'], can_edit_css: false, updated_at: null, updated_by: null } },
  '/schedule': { data: { scheduled: [] } },
  '/content-library': { data: [] },
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
    await expect(page.locator('#lnkConnections')).toBeHidden();   // Business-OS ('connected') — not in a CMS edition
    // Visual Studio folded under the 'website' feature (it makes site imagery),
    // so a drafting CMS edition keeps it — only watch-plan (monitor) sites lose it.
    await expect(page.locator('#lnkVisual')).toBeVisible();
  });

  test('the media section is called "Files" everywhere (Architecture v1.0 terminology)', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html#media');
    // the sub-view tab strip (#nav) is the section map off the overview
    await expect(page.locator('#nav .navitem[data-view="media"]')).toHaveText('Files');
    await expect(page.locator('#nav .navitem[data-view="media"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#view-media h1.doc')).toHaveText('Files');
  });

  // ── the overview board (visual refresh): top row · stat strip · pages ·
  // waiting to publish · the rail cards. Every number is read from the
  // fixtures the page already fetches — the assertions pin the mapping. ──
  const BOARD_API = {
    ...PRESENCE_API,
    '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'restaurant-classic', template_version: 1, custom_domain: 'marlows.example' }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
    '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: {
      website: { state: 'live', label: 'Live', detail: 'marlows.example' },
      draft: { state: 'changes', label: '2 changes', detail: 'ready to publish' },
      last_publish: { label: 'Sun, Oct 5', detail: 'published by you' },
      domain: { label: 'marlows.example', state: 'ok', detail: 'connected' },
    } } },
    '/changes': { data: { count: 2, first_publish: false, changes: [
      { section: 'offerings', sentence: '“Download menu (PDF)” joins Mains.', entity_id: 'o1' },
      { section: 'business', sentence: 'Saturday hours change from 10–4 to 9–5.' },
    ], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
    '/settings': { data: { pages: [{ slug: 'events', title: 'Private events', blocks: [{ type: 'title' }, { type: 'richtext' }] }] } },
    '/media': { data: [
      { id: 'm1', alt_text: 'Pasta', thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', created_at: new Date().toISOString(), used_by: [] },
      { id: 'm2', alt_text: 'Bar', thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', created_at: '2026-01-01T00:00:00Z', used_by: [] },
    ] },
    '/dev/customization': { data: { theme_tokens: { accent: '#b9471f', soft: '#f4e9dc', ink: '#2b2420', font_display: "'Fraunces', serif", font_body: "'Inter', sans-serif" }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, updated_at: null, updated_by: null } },
    '/site/templates': { data: { current: { slug: 'restaurant-classic', version: '1.0.0' }, templates: [{ slug: 'restaurant-classic', name: 'Restaurant classic', version: '1.0.0' }, { slug: 'editorial', name: 'Editorial', version: '1.0.0' }] } },
    '/analytics/dashboard': { data: { period: 'this_month', website: { traffic: { visitors: 412, pageviews: 1180 } } } },
    '/forms/inbox': { data: { submissions: [
      { id: 'l1', status: 'new', created_at: new Date().toISOString() },
      { id: 'l2', status: 'read', created_at: new Date().toISOString() },
      { id: 'l3', status: 'read', created_at: '2026-01-02T00:00:00Z' },
    ], unread: 1 } },
    '/commerce/first-run': { data: { dismissed: false, complete: false, done: 3, total: 5, steps: [
      { key: 'details', title: 'Add your business details', done: true, hint: '' },
      { key: 'brand', title: 'Set how your business sounds', done: true, hint: '' },
      { key: 'domain', title: 'Connect your domain', done: true, hint: '' },
      { key: 'connect', title: 'Add Google Business Profile', done: false, hint: 'Shows your hours on Google Maps' },
      { key: 'publish', title: 'Publish your website', done: false, hint: 'One calm ritual — preview, then publish.' },
    ] } },
    '/portal/context': ctx(ALL_FEATURES),
  };

  test('overview: the top row carries the site name, address, Live chip, last publish, saved state and ONE filled Publish button', async ({ page }) => {
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html');
    await expect(page.locator('h1#siteTitle')).toHaveText('Marlow’s Kitchen');
    const sub = page.locator('#factsWrap');
    await expect(sub.locator('a')).toHaveText('marlows.example');
    await expect(sub.locator('a')).toHaveAttribute('href', 'https://marlows.example');
    await expect(sub.locator('#siteLiveChip')).toHaveText('Live');
    await expect(sub.locator('#siteLiveChip')).toHaveClass(/good/);
    await expect(sub).toContainText('Last published Oct 5');
    await expect(sub.locator('#topWhisper')).toHaveText('Everything saved');
    await expect(page.locator('#btnPublish')).toHaveText('Publish 2 changes');
    await expect(page.locator('#btnPublish')).toHaveClass(/inked/);
    await expect(page.locator('#btnLive')).toHaveAttribute('href', 'https://marlows.example');
    // one filled button per screen: the primary is the only .inked control on the board
    await expect(page.locator('#view-today .pillbtn.inked, .topbar .pillbtn.inked')).toHaveCount(1);
    // the tab strip stays out of the way on the overview
    await expect(page.locator('#nav')).toBeHidden();
  });

  // ── Oct 2026 workflow audit, change 2: the overview took in health, the map, the story and the domain ──
  const HEALTH = { data: { overall: 'attention', headline: 'One thing to look at', summary: 'Mostly good — one thing deserves a look.', ok_count: 5, attention_count: 1, categories: [
    { key: 'found', label: 'Being found', checks: [
      { title: 'Your site has a description for Google', why: 'It is the line under your name in search.', state: 'attention', status_label: 'Needs a look', action_label: 'Add one', action_href: '/presence.html#search' },
      { title: 'Your site is live', why: 'People can visit.', state: 'ok', status_label: 'Working' },
    ] },
  ] } };
  const TREE = { data: { site_status: 'draft_changes', has_unpublished_changes: true, last_published_at: null, attention_count: 1, pages: [
    { key: 'about', label: 'About', path: '/about/', status: 'missing_required', status_label: 'Needs something before publishing', issue_count: 1, editor_link: '/presence.html#business', auto: false, sections: [] },
  ] } };
  const TIMELINE = { data: { total: 7, last_activity_at: null, last_activity_when: null, upcoming_count: 0, groups: [
    { key: 'today', label: 'Today', events: [
      { title: 'You published 2 changes', at: '2026-10-19T10:00:00Z', when: 'today', icon: '🚀', category: 'Publishing', actor: 'You', href: '/presence.html#history' },
      { title: 'A quote request arrived', at: '2026-10-19T09:00:00Z', when: 'today', icon: '✉️', category: 'Communication', actor: 'A visitor' },
    ] },
    { key: 'earlier', label: 'Earlier', events: [1, 2, 3, 4, 5].map((i) => ({ title: `Older event ${i}`, at: '2026-10-01T00:00:00Z', when: '3 weeks ago', icon: '•', category: 'Website', actor: 'Automatic' })) },
  ] } };
  const EXTRAS = { '/website-health': HEALTH, '/content-tree': TREE, '/website-timeline': TIMELINE, '/foundations/domain': { data: null } };

  test('overview: Health check card shows what needs a look, with its one action', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, ...EXTRAS } });
    await page.goto('/presence.html');
    const card = page.locator('#healthCard');
    await expect(card.getByRole('heading', { name: 'Health check' })).toBeVisible();
    await expect(card).toContainText('1 to look at');
    await expect(card).toContainText('Your site has a description for Google');
    await expect(card.getByRole('link', { name: 'Add one' })).toHaveAttribute('href', '/presence.html#search');
    // the Site health tile agrees with the card (one answer per screen)
    await expect(page.locator('#statHealth .v')).toHaveText('Needs a look');
    // the Site health tile is a door to this card (it used to do nothing)
    await page.locator('#statHealth').click();
    await expect(card).toBeFocused();
  });

  test('overview: a page the map says is blocked wears that word instead of "changes waiting"', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, ...EXTRAS } });
    await page.goto('/presence.html');
    const about = page.locator('#pagesList .hb-row[data-page="about"] .hb-chip');
    await expect(about).toHaveText('Needs something before publishing');
    await expect(about).toHaveClass(/warn/);
  });

  test('overview: Recent activity lists the newest five, See all shows the rest in place', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, ...EXTRAS } });
    await page.goto('/presence.html');
    const sec = page.locator('#activitySec');
    await expect(sec.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expect(sec.locator('.hb-row')).toHaveCount(5);
    await expect(sec.locator('.hb-row').first()).toContainText('You published 2 changes');
    await expect(sec.getByRole('link', { name: 'Open — You published 2 changes' })).toHaveAttribute('href', '/presence.html#history');
    await sec.getByRole('button', { name: 'See all' }).click();
    await expect(sec.locator('.hb-row')).toHaveCount(7);
    await expect(sec.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('overview: no domain yet → Your domain card → the desk opens on "type your domain", ready', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, ...EXTRAS,
      '/foundations': { data: { dns: { sentence: 'Temporary address.', records: [] }, ssl: { sentence: 'Padlock on.' }, email: { sentence: 'No email yet.', has_mail: false, spf: false, dmarc: false }, hosting: { sentence: 'Hosted.' } } },
      '/foundations/plans': { data: [] }, '/launch': { data: { launched: true, sentence: 'Live.', items: [] } } } });
    await page.goto('/presence.html');
    const card = page.locator('#domainCard');
    await expect(card).toContainText('temporary address');
    await card.getByRole('button', { name: 'Connect your domain' }).click();
    await expect(page.getByPlaceholder('yourbusiness.com')).toBeFocused();
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/foundations\/domain$/.test(new URL(r.url()).pathname));
    await page.getByPlaceholder('yourbusiness.com').fill('marlowskitchen.com');
    await page.getByRole('button', { name: /Connect it/ }).click();
    expect((await post).postDataJSON()).toEqual({ domain: 'marlowskitchen.com' });
  });

  test('overview: a connected, healthy domain says so — no Connect button', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, ...EXTRAS, '/foundations/domain': { data: { custom_domain: 'marlows.example', health: 'ok' } } } });
    await page.goto('/presence.html');
    await expect(page.locator('#domainCard')).toContainText('marlows.example is live and secure.');
    await expect(page.locator('#domainCard').getByRole('button', { name: 'Connect your domain' })).toHaveCount(0);
  });

  test('deep links: #domain opens the desk ready to type, #addpage opens the new-page dialog on Design', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, ...EXTRAS,
      '/foundations': { data: { dns: { sentence: 'Temporary address.', records: [] }, ssl: { sentence: 'Padlock on.' }, email: { sentence: 'No email yet.', has_mail: false, spf: false, dmarc: false }, hosting: { sentence: 'Hosted.' } } },
      '/foundations/plans': { data: [] }, '/launch': { data: { launched: true, sentence: 'Live.', items: [] } } } });
    await page.goto('/presence.html#domain');
    await expect(page.getByPlaceholder('yourbusiness.com')).toBeFocused();
    await page.goto('/presence.html#addpage');
    await expect(page.getByPlaceholder(/Services, Gallery/)).toBeVisible();
  });

  test('overview: the stat strip reads changes, health, visitors and enquiries from the real routes', async ({ page }) => {
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html');
    const strip = page.locator('#statStrip');
    await expect(strip).toBeVisible();
    await expect(strip.locator('.hb-stat:visible')).toHaveCount(4);
    await expect(strip.locator('#statWaiting .v')).toHaveText('2');
    await expect(strip.locator('#statWaiting .s')).toContainText('Home');      // business changes land on Home/About/Contact
    await expect(strip.locator('#statHealth .v')).toHaveText('Good');
    await expect(strip.locator('#statHealth .s')).toContainText('Domain connected');
    await expect(strip.locator('#statHealth .s')).toContainText('verified');   // /search/health (default fixture)
    await expect(strip.locator('#statVisitors .v')).toHaveText('412');
    await expect(strip.locator('#statVisitors .s')).toHaveText('1,180 page views');
    await expect(strip.locator('#statVisitors')).toHaveAttribute('href', '/analytics.html');
    await expect(strip.locator('#statEnquiries .v')).toHaveText('2');        // this month only
    await expect(strip.locator('#statEnquiries .s')).toHaveText('1 still new');
    await expect(strip.locator('#statEnquiries')).toHaveAttribute('href', '/inbox.html#enquiries');
  });

  test('overview: a CMS edition without reports/forms drops those two tiles (no empty cells)', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, '/portal/context': ctx(['website', 'developer', 'client_portal']) } });
    await page.goto('/presence.html');
    await expect(page.locator('#statStrip .hb-stat:visible')).toHaveCount(2);
    await expect(page.locator('#statVisitors')).toBeHidden();
    await expect(page.locator('#statEnquiries')).toBeHidden();
  });

  test('overview: the Pages list has one row per page with a status chip, and Edit opens that page’s editor', async ({ page }) => {
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html');
    const rows = page.locator('#pagesList .hb-row');
    await expect(rows).toHaveCount(7);   // six template pages + the owner's own page
    await expect(rows.nth(0).locator('b')).toHaveText('Home');
    await expect(rows.nth(0).locator('.hb-chip')).toHaveText('1 change waiting');   // the business change
    await expect(rows.nth(1).locator('b')).toHaveText('Services');   // the generic industry's vocabulary (VOCAB)
    await expect(rows.nth(1).locator('.hb-chip')).toHaveText('1 change waiting');   // the offerings change
    await expect(rows.nth(3).locator('b')).toHaveText('Questions');
    await expect(rows.nth(3).locator('.hb-chip')).toHaveText('Published');
    await expect(rows.nth(6).locator('b')).toHaveText('Private events');
    await expect(rows.nth(6).locator('.t span')).toHaveText('2 sections');
    // Edit on Services → the offerings editor; Edit on the owner's page → the Design builder on that page
    await rows.nth(1).getByRole('button', { name: 'Edit Services' }).click();
    await expect(page.locator('#view-offerings')).toBeVisible();
    await expect(page.locator('#nav')).toBeVisible();
    await page.locator('#nav .navitem[data-view="today"]').click();
    await expect(page.locator('#view-today')).toBeVisible();
    await page.locator('#pagesList .hb-row').nth(6).getByRole('button', { name: 'Edit Private events' }).click();
    await expect(page.locator('#view-design')).toBeVisible();
    await expect(page.locator('#pagesBar .page-pill.on .pp-name')).toHaveText('Private events');
  });

  test('overview: Waiting to publish lists every pending change with Preview + Edit and the quiet "nothing goes live" row', async ({ page }) => {
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html');
    const list = page.locator('#recentList');
    await expect(list.locator('.hb-row:not(.quiet)')).toHaveCount(2);
    await expect(list.locator('.hb-row').nth(0).locator('b')).toHaveText('“Download menu (PDF)” joins Mains.');
    await expect(list.locator('.hb-row').nth(0).locator('.t span')).toHaveText('Menu · ready to publish');   // the diff section's word
    await expect(list.locator('.hb-row').nth(0).getByRole('button', { name: 'Preview' })).toBeVisible();
    await expect(list.locator('.hb-row').nth(0).getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(list.locator('.hb-row.quiet')).toContainText('Nothing goes live until you press Publish');
    await expect(list.locator('.hb-row.quiet a')).toHaveAttribute('href', '#schedule');
    // Preview opens the proofing desk on the page the change touches
    await list.locator('.hb-row').nth(0).getByRole('button', { name: 'Preview' }).click();
    await expect(page.locator('#stage')).toHaveClass(/on/);
    await expect(page.locator('#pageWords button.on')).toHaveAttribute('data-page', '/services/');   // VOCAB's path for the offerings page
  });

  test('overview: an up-to-date site hides the waiting list and says so in the tile', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, '/changes': PRESENCE_API['/changes'], '/health': { data: { ...BOARD_API['/health'].data, facts: { ...BOARD_API['/health'].data.facts, draft: { state: 'clean', label: 'Up to date', detail: 'no unpublished changes' } } } } } });
    await page.goto('/presence.html');
    await expect(page.locator('#recentWrap')).toBeHidden();
    await expect(page.locator('#statWaiting .v')).toHaveText('0');
    await expect(page.locator('#statWaiting .s')).toHaveText('Everything is live');
    await expect(page.locator('#btnPublish')).toHaveText('Publish');
  });

  test('overview: the rail — Setup progress from first-run, Design swatches + fonts + template, Photos thumbnails + count', async ({ page }) => {
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html');
    const setup = page.locator('#setupCard');
    await expect(setup).toBeVisible();
    await expect(setup.locator('.meta')).toHaveText('3 of 5 done');
    await expect(setup.locator('.hb-progress')).toHaveAttribute('aria-valuenow', '3');
    await expect(setup.locator('.hb-task.done')).toHaveCount(3);
    await expect(setup.locator('button.hb-task')).toHaveCount(2);
    await expect(setup.locator('button.hb-task').first().locator('span.t span')).toHaveText('Shows your hours on Google Maps');
    const design = page.locator('#designRailCard');
    await expect(design.locator('#designSwatches i')).toHaveCount(3);
    await expect(design.locator('#designSwatches i').first()).toHaveCSS('background-color', 'rgb(185, 71, 31)');   // the accent token
    await expect(design.locator('#designSwatches span')).toHaveText('Fraunces and Inter');
    await expect(design.locator('#designNote')).toContainText('Template: Restaurant classic.');
    await expect(design.locator('.hb-card-h a')).toHaveText('Change');
    const photos = page.locator('#photosCard');
    await expect(photos.locator('#photoThumbs img')).toHaveCount(2);
    await expect(photos.locator('#photoCount')).toHaveText('2 photos · 1 added this month.');
    await expect(photos.locator('#lnkVisual')).toHaveAttribute('href', '/visual-studio.html');
  });

  test('overview: a dismissed or complete setup hides the card; a first-run step routes to its editor', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, '/commerce/first-run': { data: { ...BOARD_API['/commerce/first-run'].data, complete: true } } } });
    await page.goto('/presence.html');
    await expect(page.locator('#statStrip')).toBeVisible();
    await expect(page.locator('#setupCard')).toBeHidden();
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html');
    await page.locator('#setupCard button.hb-task', { hasText: 'Add Google Business Profile' }).click();
    await expect(page.locator('#view-today')).toBeVisible();   // the connect step stays on the overview
  });

  test('overview: a site that needs a look shows the health band; a healthy one does not', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, '/health': { data: { ...BOARD_API['/health'].data, state: 'needs_attention', sentence: 'Your domain needs a look.', detail: 'DNS is still pointing elsewhere.' } } } });
    await page.goto('/presence.html');
    await expect(page.locator('#healthWrap .hb-band')).toContainText('Your domain needs a look.');
    await expect(page.locator('#healthWrap .hb-band')).toContainText('DNS is still pointing elsewhere.');
    await expect(page.locator('#statHealth .v')).toHaveText('Needs a look');
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html');
    await expect(page.locator('#healthWrap')).toBeHidden();
  });

  test('a save on the Business view says "Saving…" then rests back on "Everything saved" in the top row', async ({ page }) => {
    await installApp(page, { api: BOARD_API });
    await page.goto('/presence.html#business');
    await page.locator('#f-tagline').fill('Wine, pasta, friends');
    await expect(page.locator('#topWhisper')).toHaveText(/Saving…|Saved just now/);
    await expect(page.locator('#topWhisper')).toHaveText('Everything saved', { timeout: 6000 });
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
    // the template-family gallery lives in the on-demand Design settings panel now
    await page.locator('#btnSettingsOpen').click();
    await expect(page.locator('#designGallery .tg-card[data-look="business-classic"]')).toBeVisible();
    await expect(page.locator('#designGallery .tg-card[data-look="editorial"]')).toBeVisible();
    await expect(page.locator('#designGallery')).toContainText('Editorial');
    await expect(page.locator('#designGallery')).toContainText('print serif'); // the family's swatch tag
  });
});
