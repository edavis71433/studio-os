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

  // Oct 2026 audit, gap 5: the rail cards used to be asked for at the end of
  // renderFactsProse(), which returns early when /health carries no `facts` —
  // a fixture without them hid the Domain and Health cards. loadToday() asks now.
  test('overview: the Domain, Health check and Recent activity cards render even when /health has no facts', async ({ page }) => {
    await installApp(page, { api: { ...BOARD_API, ...EXTRAS, '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.' } } } });
    await page.goto('/presence.html');
    await expect(page.locator('#healthCard').getByRole('heading', { name: 'Health check' })).toBeVisible();
    await expect(page.locator('#domainCard')).toContainText('temporary address');
    await expect(page.locator('#activitySec').getByRole('heading', { name: 'Recent activity' })).toBeVisible();
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

  // ── Benchmark item 4 (docs/design/BENCHMARK-2026-10.md): how the page reads on
  // Google. A live search-result preview with the 60/160 counters under the two
  // search fields, a three-question setup that writes them when they are empty,
  // and a "what's left" list in the search card where each task is a door. ──
  test.describe('Search preview and setup', () => {
    // the Search Console surface, disconnected — the task shows as a door to /connections.html
    const CONNECTIONS = (status: string) => ({ data: { groups: { 'Being found': [
      { key: 'google_search_console', label: 'how you show up in Google Search', availability: 'Read-only', connection: { status, health: 'unknown' } },
    ] } } });
    const SEO_API = { ...BOARD_API, '/connections': CONNECTIONS('disconnected') };

    test('the preview reads the fixtures: name, address, the headline falls back to the name, the empty description says so', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#business');
      const srp = page.locator('#srp');
      await expect(srp.locator('#srpName')).toHaveText('Marlow’s Kitchen');
      await expect(srp.locator('#srpUrl')).toHaveText('marlows.example');   // /site custom_domain
      await expect(srp.locator('#srpTitle')).toHaveText('Marlow’s Kitchen');  // seo_title empty → the business name
      await expect(srp.locator('#srpTitle')).toHaveCSS('color', 'rgb(26, 13, 171)');   // Google's blue
      await expect(srp.locator('#srpDesc')).toHaveClass(/empty/);
      await expect(page.locator('#cnt-seo_title')).toHaveText('Empty — Google shows your business name');
      await expect(page.locator('#cnt-seo_description')).toContainText('Empty — and so is your description');
    });

    test('the preview and the counters follow the keyboard: green up to 60, amber over with "may be cut off", and the title is cut the way Google cuts it', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#business');
      const title = page.locator('#f-seo_title');
      await title.fill('Marlow’s Kitchen — Italian restaurant in Burbank');   // 48 chars
      await expect(page.locator('#srpTitle')).toHaveText('Marlow’s Kitchen — Italian restaurant in Burbank');
      await expect(page.locator('#cnt-seo_title')).toHaveText('48 of 60');
      await expect(page.locator('#cnt-seo_title')).toHaveClass(/good/);
      await title.fill('Marlow’s Kitchen — Italian restaurant, catering and private events in Burbank');   // 77 chars
      await expect(page.locator('#cnt-seo_title')).toHaveText('77 of 60 — may be cut off');
      await expect(page.locator('#cnt-seo_title')).toHaveClass(/warn/);
      await expect(page.locator('#srpTitle')).toHaveText(/ \.\.\.$/);   // the preview shows the cut, not the full line
      const desc = page.locator('#f-seo_description');
      await desc.fill('Seasonal plates in Burbank.');   // 27 — a little short
      await expect(page.locator('#srpDesc')).toHaveText('Seasonal plates in Burbank.');
      await expect(page.locator('#cnt-seo_description')).toContainText('27 of 160 — a little short');
      await expect(page.locator('#cnt-seo_description')).toHaveClass(/warn/);
      await desc.fill('Seasonal Italian plates, natural wine and a sunny patio in Burbank. Walk-ins welcome, private events by request.');   // 112
      await expect(page.locator('#cnt-seo_description')).toHaveText('112 of 160');
      await expect(page.locator('#cnt-seo_description')).toHaveClass(/good/);
      // the field is no longer hard-capped at 60 — the counter guides instead
      expect(await title.getAttribute('maxlength')).not.toBe('60');
    });

    test('the business name typed above changes the preview too (it is the fallback headline)', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#business');
      await page.locator('#f-business_name').fill('Marlow’s');
      await expect(page.locator('#srpName')).toHaveText('Marlow’s');
      await expect(page.locator('#srpTitle')).toHaveText('Marlow’s');
      await expect(page.locator('#srpFav')).toHaveText('M');
    });

    test('three questions → one PUT /identity with the headline, the description and where you work; the fields and the preview follow', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#business');
      await page.locator('#btnSeoSetup').click();
      const panel = page.locator('#seoSetup');
      await expect(panel).toBeVisible();
      await expect(page.locator('#sw-name')).toHaveValue('Marlow’s Kitchen');   // prefilled
      await expect(page.locator('#sw-name')).toBeFocused();
      await expect(page.locator('#swReplaceWrap')).toBeHidden();   // nothing to replace yet
      await page.locator('#sw-places').fill('Burbank, Glendale');
      await page.locator('#sw-words').fill('Italian restaurant, catering, private events');
      // the panel shows what Save writes, as the search result it becomes
      await expect(page.locator('#swTitle')).toHaveText('Marlow’s Kitchen — Italian restaurant in Burbank');
      await expect(page.locator('#swDesc')).toHaveText('Marlow’s Kitchen: Italian restaurant, catering and private events in Burbank and Glendale.');
      await expect(page.locator('#swArea')).toHaveText('Where you work becomes “Serving Burbank and Glendale”.');
      const put = page.waitForRequest((r) => r.method() === 'PUT' && /\/presence\/identity$/.test(r.url()));
      await page.locator('#swSave').click();
      const body = (await put).postDataJSON();
      expect(body).toEqual({
        seo_title: 'Marlow’s Kitchen — Italian restaurant in Burbank',
        seo_description: 'Marlow’s Kitchen: Italian restaurant, catering and private events in Burbank and Glendale.',
        service_area: 'Serving Burbank and Glendale',
      });
      await expect(panel).toBeHidden();
      await expect(page.locator('#f-seo_title')).toHaveValue('Marlow’s Kitchen — Italian restaurant in Burbank');
      await expect(page.locator('#f-seo_description')).toHaveValue(/private events in Burbank and Glendale\.$/);
      await expect(page.locator('#f-service_area')).toHaveValue('Serving Burbank and Glendale');
      await expect(page.locator('#srpTitle')).toHaveText('Marlow’s Kitchen — Italian restaurant in Burbank');
      await expect(page.locator('#cnt-seo_title')).toHaveText('48 of 60');
      await expect(page.locator('#topWhisper')).toHaveText(/Saving…|Saved just now/);
    });

    test('a headline that is already there is kept unless "Replace" is ticked; a changed name is saved as the business name', async ({ page }) => {
      await installApp(page, { api: { ...SEO_API,
        '/site': { data: { ...BOARD_API['/site'].data, identity: { business_name: 'Marlow’s Kitchen', seo_title: 'Marlow’s Kitchen | Burbank', seo_description: '', service_area: 'Serving Burbank' } } },
      } });
      await page.goto('/presence.html#business');
      await page.locator('#btnSeoSetup').click();
      await expect(page.locator('#sw-places')).toHaveValue('Burbank');   // "Serving Burbank" → the place
      await expect(page.locator('#swReplaceWrap')).toBeVisible();
      await page.locator('#sw-name').fill('Marlow’s Kitchen & Bar');
      await page.locator('#sw-words').fill('wine bar');
      await expect(page.locator('#swTitle')).toHaveText('Marlow’s Kitchen | Burbank');   // kept
      await expect(page.locator('#swArea')).toHaveText('Where you work stays “Serving Burbank”.');
      const put = page.waitForRequest((r) => r.method() === 'PUT' && /\/presence\/identity$/.test(r.url()));
      await page.locator('#swSave').click();
      const body = (await put).postDataJSON();
      expect(body).toEqual({ business_name: 'Marlow’s Kitchen & Bar', seo_description: 'Marlow’s Kitchen & Bar: wine bar in Burbank. Get in touch to find out more.' });
      await expect(page.locator('h1#siteTitle')).toHaveText('Marlow’s Kitchen & Bar');
      // now replace
      await page.locator('#btnSeoSetup').click();
      await page.locator('#sw-words').fill('wine bar');
      await page.locator('#swReplace').check();
      await expect(page.locator('#swTitle')).toHaveText('Marlow’s Kitchen & Bar — wine bar in Burbank');
      const put2 = page.waitForRequest((r) => r.method() === 'PUT' && /\/presence\/identity$/.test(r.url()));
      await page.locator('#swSave').click();
      expect((await put2).postDataJSON()).toEqual({ seo_title: 'Marlow’s Kitchen & Bar — wine bar in Burbank', seo_description: 'Marlow’s Kitchen & Bar: wine bar in Burbank. Get in touch to find out more.' });
    });

    test('"Not now" closes the setup without a save and returns focus to the opener', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#business');
      let puts = 0; page.on('request', (r) => { if (r.method() === 'PUT') puts++; });
      await page.locator('#btnSeoSetup').click();
      await page.locator('#swCancel').click();
      await expect(page.locator('#seoSetup')).toBeHidden();
      await expect(page.locator('#btnSeoSetup')).toBeFocused();
      expect(puts).toBe(0);
    });

    test('the search card lists what is left, each task a door; the setup clears the first two', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#business');
      const tasks = page.locator('#searchCard #seoTasks');
      await expect(tasks).toContainText('What’s left');
      const links = tasks.locator('.seo-tasks a');
      await expect(links).toHaveText(['Add a search headline', 'Add a search description', 'Connect Google Search Console', 'Publish your changes']);
      await expect(links.nth(2)).toHaveAttribute('href', '/connections.html');
      await expect(links.nth(3)).toHaveAttribute('href', '#publish');   // the publish ritual
      // the card sits with the search fields, not at the end of the view
      await expect(page.locator('#searchCardSlot #searchCard')).toBeVisible();
      // the headline task is a door to the field
      await links.nth(0).click();
      await expect(page.locator('#f-seo_title')).toBeFocused();
      // the setup clears the first two tasks
      await page.locator('#btnSeoSetup').click();
      await page.locator('#sw-places').fill('Burbank');
      await page.locator('#sw-words').fill('Italian restaurant');
      await page.locator('#swSave').click();
      await expect(links).toHaveText(['Connect Google Search Console', 'Publish your changes']);
    });

    test('every state is honest: connected Search Console drops off the list, a never-published site says "Publish your website", a draft with nothing to do says so', async ({ page }) => {
      await installApp(page, { api: { ...SEO_API,
        '/connections': CONNECTIONS('connected'),
        '/site': { data: { ...BOARD_API['/site'].data, identity: { business_name: 'Marlow’s Kitchen', seo_title: 'Marlow’s Kitchen — Burbank', seo_description: 'Seasonal Italian plates, natural wine and a sunny patio in Burbank.' } } },
        '/health': { data: { ...BOARD_API['/health'].data, facts: { ...BOARD_API['/health'].data.facts, website: { state: 'none', label: 'Not published yet', detail: '' } } } },
      } });
      await page.goto('/presence.html#business');
      const links = page.locator('#searchCard .seo-tasks a');
      await expect(links).toHaveText(['Publish your website']);
      // and the card's own sentence speaks now that it is true
      await expect(page.locator('#searchCard')).toContainText('Your search headline and description are set.');
    });

    test('nothing left: the list says so', async ({ page }) => {
      await installApp(page, { api: { ...SEO_API,
        '/connections': CONNECTIONS('connected'),
        '/site': { data: { ...BOARD_API['/site'].data, identity: { business_name: 'Marlow’s Kitchen', seo_title: 'Marlow’s Kitchen — Burbank', seo_description: 'Seasonal Italian plates, natural wine and a sunny patio in Burbank.' } } },
        '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
      } });
      await page.goto('/presence.html#business');
      await expect(page.locator('#searchCard #seoTasks')).toContainText('Nothing left to set up');
      await expect(page.locator('#searchCard .seo-tasks')).toHaveCount(0);
    });

    test('no domain yet: the address line is a placeholder and "Connect your domain" is a task', async ({ page }) => {
      await installApp(page, { api: { ...SEO_API,
        '/site': { data: { ...BOARD_API['/site'].data, site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'restaurant-classic', template_version: 1 } } },
        '/health': { data: { ...BOARD_API['/health'].data, facts: { ...BOARD_API['/health'].data.facts, domain: { label: 'No custom domain', state: 'none', detail: '' } } } },
      } });
      await page.goto('/presence.html#business');
      await expect(page.locator('#srpUrl')).toHaveText('yourdomain.com');
      await expect(page.locator('#srpUrl')).toHaveClass(/muted/);
      const dom = page.locator('#searchCard .seo-tasks a', { hasText: 'Connect your domain' });
      await expect(dom).toHaveAttribute('href', '#domain');
    });

    test('a plan without search insights keeps its message, and the task list still stands', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.route('**/functions/v1/presence/search/health', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'feature_locked' }) }));
      await page.goto('/presence.html#business');
      await expect(page.locator('#searchCard')).toContainText('Search insights aren’t part of your plan yet');
      await expect(page.locator('#searchCard .seo-tasks a').first()).toHaveText('Add a search headline');
    });

    test('per-page previews: each built-in page shows the default it renders with, and follows its own fields', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#business');
      const fine = page.locator('#searchCard details', { hasText: 'Fine-tune how each built-in page reads' });
      await fine.locator('summary').click();
      const about = page.locator('#srp-about');
      await expect(about.locator('.srp-title')).toHaveText('About — Marlow’s Kitchen');
      await expect(about.locator('.srp-url')).toHaveText('marlows.example › about');
      await expect(page.locator('#srp-contact .srp-title')).toHaveText('Contact & Hours — Marlow’s Kitchen');
      await expect(page.locator('#srp-contact .srp-desc')).toHaveText('Address, phone, and hours for Marlow’s Kitchen.');
      await expect(page.locator('#srp-offerings .srp-title')).toHaveText('Services — Marlow’s Kitchen');   // the vocabulary word (generic here: no site.template, no industry_key in the fixtures)
      await page.getByLabel('Search headline for About').fill('Our story — Marlow’s Kitchen, Burbank');
      await expect(about.locator('.srp-title')).toHaveText('Our story — Marlow’s Kitchen, Burbank');
      await expect(page.locator('#cnt-about-title')).toHaveText('37 of 60');
      await expect(page.locator('#cnt-about-description')).toHaveText('Empty — and so is your description, so add one');   // the fixture's identity has no description either
    });

    test('#search deep-links to the preview itself (the Today card’s "Add one")', async ({ page }) => {
      await installApp(page, { api: SEO_API });
      await page.goto('/presence.html#search');
      await expect(page.locator('#view-business')).toBeVisible();
      await expect(page.locator('#srp')).toBeInViewport();
    });
  });
});

// The full-screen preview ("See your site", ?view=preview from get-started, History
// previews) must always have a way out. The shell bar (z 2147483000) once covered
// the stage bar, so "← Back" took no clicks and a new owner was stranded.
test.describe('Website preview stage', () => {
  const backIsTopmost = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const b = document.getElementById('btnStageClose')!; const r = b.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t === b || b.contains(t);
  });

  test('"← Back" sits on top and closes the preview', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html?view=preview');   // the onboarding "Review & preview your website →" link
    await expect(page.locator('#stage')).toHaveClass(/\bon\b/);
    expect(await backIsTopmost(page)).toBe(true);
    await expect(page.locator('#verSeg button').first()).toBeVisible();
    await page.locator('#btnStageClose').click();   // a real click: fails if anything covers it
    await expect(page.locator('#stage')).not.toHaveClass(/\bon\b/);
  });

  test('Escape closes the preview and returns focus to the button that opened it', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html');
    // "See your site" on desktop/tablet; phones hide it and open the stage from the dock
    await expect(page.locator('#btnPreview, #dock [data-tab="preview"]').locator('visible=true').first()).toBeVisible();
    const opener = page.locator('#btnPreview, #dock [data-tab="preview"]').locator('visible=true').first();
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#stage')).toHaveClass(/\bon\b/);
    expect(await backIsTopmost(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#stage')).not.toHaveClass(/\bon\b/);
    await expect(opener).toBeFocused();
  });
});

// ── Speak as the studio when acting for a client (studio audit Oct 2026, change 2) ──
// The SAME ritual, two voices. The owner's own room keeps every word ("Here's what
// changes." / "Your live site stays as it is until the moment you decide." /
// "Every word on your site came from you") — pinned here so the scoped voice can
// never leak into it. Scoped in (?client= + the shell's context carrying
// scope.name), the ritual names the client, speaks of THEIR customers and THEIR
// site, and the receipt says who it was published for.
test.describe('Publish ritual — the owner\'s voice and the studio\'s voice', () => {
  const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const SCOPED_CTX = { data: {
    site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
    edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
    capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
    scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' },
  } };
  // the ONE publish door: the top-row button on desktop/tablet, the bottom dock's
  // Publish on a phone (the top row is hidden there) — both call openRitual()
  const openRitual = (page: import('@playwright/test').Page) => page.locator('#btnPublish:visible, #dockPublish:visible').first().click();
  const RITUAL_API = { ...PRESENCE_API,
    '/changes': { data: { count: 2, first_publish: false, changes: [
      { section: 'offerings', sentence: '“Download menu (PDF)” joins Mains.', entity_id: 'o1' },
      { section: 'business', sentence: 'Saturday hours change from 10–4 to 9–5.' },
    ], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
    '/publish': { data: { status: 'live', message: 'Your site is live.', summary: '2 changes' } },
  };

  test('the owner\'s own ritual + receipt keep their words (byte-identical pin)', async ({ page }) => {
    await installApp(page, { api: { ...RITUAL_API, '/portal/context': ctx(ALL_FEATURES) } });
    await page.goto('/presence.html');
    await openRitual(page);
    const rit = page.locator('#ritualWrap');
    await expect(rit.locator('#ritTitle')).toHaveText('Here’s what changes.');
    await expect(rit.locator('#ritSub')).toHaveText('2 changes, read exactly as customers will experience them. Your live site stays as it is until the moment you decide.');
    // the change lines keep their section wording
    await expect(rit.locator('.jrow .jsec').first()).toHaveText('Menu');   // sentence case since the experience review (#27)
    const publish = rit.getByRole('button', { name: 'Publish these 2 changes' });
    await expect(publish).toBeVisible();
    await publish.click();
    await expect(rit.locator('.receipt .rp')).toHaveText('Published');
    await expect(rit.locator('.receipt .rl')).toContainText('Every word on your site came from you.');
  });

  test('scoped into a client, the ritual names them, speaks of THEIR site, and the receipt says "Published for"', async ({ page }) => {
    await installApp(page, { api: { ...RITUAL_API, '/portal/context': SCOPED_CTX } });
    await page.goto(`/presence.html?client=${CLIENT}`);
    await expect(page.locator('#dds-ctxbar')).toContainText('Marlow’s Kitchen');   // the shell knows whose room this is
    await openRitual(page);
    const rit = page.locator('#ritualWrap');
    await expect(rit.locator('#ritTitle')).toHaveText('Here’s what changes on Marlow’s Kitchen’s site');
    await expect(rit.locator('#ritSub')).toHaveText('2 changes, read exactly as their customers will experience them. Their live site stays as it is until you decide.');
    // section wording unchanged; button unchanged
    await expect(rit.locator('.jrow .jsec').first()).toHaveText('Menu');   // sentence case since the experience review (#27)
    const publish = rit.getByRole('button', { name: 'Publish these 2 changes' });
    await expect(publish).toBeVisible();
    await publish.click();
    await expect(rit.locator('.receipt .rp')).toHaveText('Published for Marlow’s Kitchen');
    await expect(rit.locator('.receipt .rl')).toHaveText('This version is kept safe, always.');
    await expect(rit.locator('.receipt')).not.toContainText('came from you');
  });

  test('scoped, nothing waiting: the up-to-date sentence is about THEIR website', async ({ page }) => {
    await installApp(page, { api: { ...RITUAL_API, '/portal/context': SCOPED_CTX, '/changes': PRESENCE_API['/changes'] } });
    await page.goto(`/presence.html?client=${CLIENT}`);
    await expect(page.locator('#dds-ctxbar')).toContainText('Marlow’s Kitchen');
    await openRitual(page);
    await expect(page.locator('#ritTitle')).toHaveText('Marlow’s Kitchen is up to date.');
    await expect(page.locator('#ritSub')).toHaveText('Every word in the draft is already on their website. There’s nothing waiting.');
  });
});
