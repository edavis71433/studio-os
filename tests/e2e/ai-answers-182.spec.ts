import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 182 (Nov 2026): AI answers over time, on the Search tab, and the monthly
// switch on Settings › Monthly report. The Search tab fixtures are search-tab-124.spec.ts's.
// Builder list items 124 and 181 (Nov 2026): the Search tab as a working page. A row of
// tools (old addresses, verification, sitemap, llms.txt, hide from search), this month's
// numbers, a to-do list ranked Critical, High and Medium with a done dot, the pages that
// moved most on Google, and up to ten searches to follow, month by month. The fixtures
// are GET /visibility's new parts (routes/search_tab.ts) and GET/PUT /visibility/follow;
// tests/presence/search_tools_test.mjs covers the server. A server without them keeps
// the old checklist (builder-backoffice.spec.ts, cms.spec.ts). Fake names only.

const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'maple.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [], search_hidden: false, llms_txt: null } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/site': { data: { site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'maple.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' }, identity: { business_name: 'Maple & Main Realty', seo_title: 'Maple & Main Realty, Burbank', seo_description: '' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [] } },
  '/foundations/domain': { data: { custom_domain: 'maple.example', health: 'ok' } },
  '/redirects': { data: [{ id: 'r1', from_path: '/old-listings/', to_path: '/listings/' }] },
  '/search/health': { data: { verification: { google: true, bing: false }, seo_fields: { title: true, description: false }, schema: { type: 'LocalBusiness', industry: 'generic' }, sitemap: true, robots: true, internal_links: 'correct_by_construction', hidden_pages: [], links: [] } },
};
const CONSOLE = { status: 'connected', health: 'ok', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'measuring', unavailable: false, has_data: true,
  clicks: 64, impressions: 2140, prior_clicks: 59, prior_impressions: 2400, period: '2026-10',
  monthly: [{ period: '2026-09', clicks: 59, impressions: 2400 }, { period: '2026-10', clicks: 64, impressions: 2140 }],
  top_terms: [{ term: 'burbank realtor', clicks: 18, impressions: 300 }], top_pages: [{ path: '/listings/', clicks: 28, impressions: 400 }] };
const TASKS = [
  { key: 'health:links.internal_broken', priority: 'critical', done: false, title: 'Links to pages that aren’t there', sub: 'On 2 pages or parts.', go: 'health' },
  { key: 'description', priority: 'high', done: false, title: 'Add a search description', sub: 'The line under the headline.', go: 'wording' },
  { key: 'listing', priority: 'medium', done: false, title: 'Connect your Google listing', sub: 'Your reviews, calls and directions, here.', go: 'connect:listing' },
  { key: 'llms', priority: 'medium', done: false, title: 'Write your llms.txt for AI tools', sub: 'A short file that tells ChatGPT and Claude what you do.', go: 'tool:llms' },
  { key: 'publish', priority: 'critical', done: true, title: 'Your site is published', sub: '', go: null },
  { key: 'console', priority: 'high', done: true, title: 'Connect Google Search Console', sub: '', go: null },
  { key: 'title', priority: 'high', done: true, title: 'Add a search headline', sub: '', go: null },
];
const VIS = (over: Record<string, unknown> = {}) => ({ data: {
  state: 'ready', address: { url: 'https://maple.example/', domain: 'maple.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai-visibility',
  console: CONSOLE, listing: { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', property: null, data: null },
  tools: { ready: true, redirects: 1, verification: { google: true, bing: false }, sitemap: 'https://maple.example/sitemap.xml', llms: { set: false, chars: 0, url: 'https://maple.example/llms.txt', max: 4000 }, hidden: false },
  tasks: TASKS,
  movers: { period: '2026-10', prior_period: '2026-09', up: [{ path: '/listings/', clicks: 28, prior: 16, delta: 12 }, { path: '/sell/', clicks: 14, prior: 7, delta: 7 }], down: [{ path: '/about/', clicks: 3, prior: 8, delta: -5 }] },
  follow: { count: 2, max: 10 },
  ...over,
} });
const FOLLOW = { data: {
  terms: [
    { term: 'burbank realtor', added_at: '2026-06-01T00:00:00Z', months: [{ period: '2026-08', clicks: 8, impressions: 200, position: 9 }, { period: '2026-09', clicks: 12, impressions: 280, position: 6.2 }, { period: '2026-10', clicks: 18, impressions: 300, position: 4 }], now: { period: '2026-10', clicks: 18, impressions: 300, position: 4 }, prior: { period: '2026-09', clicks: 12, impressions: 280, position: 6.2 } },
    { term: 'homes for sale burbank', added_at: '2026-06-01T00:00:00Z', months: [{ period: '2026-09', clicks: 8, impressions: 400, position: 8 }, { period: '2026-10', clicks: 6, impressions: 380, position: 11 }], now: { period: '2026-10', clicks: 6, impressions: 380, position: 11 }, prior: { period: '2026-09', clicks: 8, impressions: 400, position: 8 } },
  ],
  suggestions: [{ term: 'realtor near me', clicks: 3, impressions: 42 }, { term: 'burbank homes', clicks: 2, impressions: 31 }],
  max: 10, month: '2026-10', prior: '2026-09', connected: true,
} };

async function openSearch(page: Page, o: { vis?: unknown; follow?: unknown; settings?: Record<string, unknown>; routes?: (page: Page) => Promise<void> } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const puts: Array<{ path: string; body: any }> = [];
  await installApp(page, { api: { ...PAGE_API, ...(o.settings ? { '/settings': { data: { ...PAGE_API['/settings'].data, ...o.settings } } } : {}), '/visibility': (o.vis ?? VIS()) as never, '/visibility/llms-draft': { data: { text: '# Maple & Main Realty\n\n> A Burbank real estate office.', max: 4000 } } } as never });
  let follow = (o.follow ?? FOLLOW) as any;
  await page.route(/\/functions\/v1\/presence\/visibility\/follow$/, async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON(); puts.push({ path: '/visibility/follow', body });
      const terms = body.terms.map((t: string) => follow.data.terms.find((x: any) => x.term === t.toLowerCase()) || { term: t.toLowerCase(), added_at: '2026-11-11T00:00:00Z', months: [], now: null, prior: null });
      follow = { data: { ...follow.data, terms, added: terms.filter((t: any) => !follow.data.terms.some((x: any) => x.term === t.term)).map((t: any) => t.term) } };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(follow) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(follow) });
  });
  await page.route(/\/functions\/v1\/presence\/settings$/, async (route: Route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON(); puts.push({ path: '/settings', body });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...PAGE_API['/settings'].data, ...(o.settings || {}), ...body } }) });
  });
  if (o.routes) await o.routes(page);
  await page.goto('/presence.html#search');
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(page.locator('#svTools')).toBeVisible();
  return { errors, puts };
}
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};
const closeTip = async (page: Page) => { const got = page.getByRole('button', { name: 'Got it' }); if (await got.count()) await got.first().click().catch(() => {}); };


const AI = (over: Record<string, unknown> = {}) => ({ data: {
  questions: [
    { text: 'Who is a good realtor in Burbank?', kind: 'unbranded' },
    { text: 'Which Burbank agent helps first-time buyers?', kind: 'unbranded' },
    { text: 'Is Maple & Main Realty well reviewed?', kind: 'branded' },
    { text: 'Where can I sell my house fast in Burbank?', kind: 'unbranded' },
  ],
  defaults: false, max: 10, ready: true, can_check: true,
  watch: { enabled: true, last_result: { month: '2026-11', status: 'checked', reason: null, at: '2026-11-01T00:00:00Z' }, next: 'Dec 1', cost: 'About 24 cents a month for 4 questions' },
  months: [{ month: '2026-10', asked: 3, named: 1, checked_at: '2026-10-01T00:00:00Z' }, { month: '2026-11', asked: 3, named: 2, checked_at: '2026-11-01T00:00:00Z' }],
  latest: { month: '2026-11', checked_at: '2026-11-01T00:00:00Z', engines: [{ id: 'claude', name: 'Claude' }], results: [
    { q: 'Who is a good realtor in Burbank?', kind: 'unbranded', answers: [{ engine: 'claude', name: 'Claude', named: true, excerpt: 'Maple & Main Realty is a local Burbank office with strong reviews.', others: ['Westside Homes Group'] }] },
    { q: 'Which Burbank agent helps first-time buyers?', kind: 'unbranded', answers: [{ engine: 'claude', name: 'Claude', named: false, excerpt: 'Try Westside Homes Group or Valley Key Realty.', others: ['Westside Homes Group', 'Valley Key Realty'] }] },
    { q: 'Is Maple & Main Realty well reviewed?', kind: 'branded', answers: [{ engine: 'claude', name: 'Claude', named: true, excerpt: 'Yes, Maple & Main Realty has 4.6 stars.', others: [] }] },
  ] },
  engines: [{ id: 'claude', name: 'Claude' }],
  ...over,
} });

async function openWithAi(page: Page, ai: unknown, status = 200) {
  const puts: any[] = [];
  const r = await openSearch(page, { routes: async (p) => {
    await p.route(/\/functions\/v1\/presence\/visibility\/ai$/, (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(ai) }));
    await p.route(/\/functions\/v1\/presence\/visibility\/ai\/questions$/, (route) => { const b = route.request().postDataJSON(); puts.push(b); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { questions: b.questions, cost: `About ${b.questions.length * 6} cents a month for ${b.questions.length} questions` } }) }); });
  } });
  return { ...r, aiPuts: puts };
}

test.describe('AI answers over time (builder list item 182)', () => {
  test('the card: this month against last, a point a month, and a tick or cross per question', async ({ page }) => {
    const { errors } = await openWithAi(page, AI());
    const card = page.locator('#svAiWatch');
    await expect(card).toBeVisible();
    await expect(card.locator('#svAiWMeta')).toHaveText('Checked Nov 1, 2026 · next check Dec 1 · every month');
    await expect(card.locator('.sv-ai-big b')).toHaveText('2 of 3');
    await expect(card.locator('.sv-ai-big .sv-chg.up [aria-hidden="true"]')).toHaveText('▲ 1');   // one more question than last month, not a percent
    await expect(card.locator('.sv-ai-big .sv-chg.up .sr-only')).toHaveText('up 1');
    await expect(card.locator('svg.sv-fchart')).toHaveAttribute('aria-label', 'Questions where Claude named you, by month: Oct 1 of 3, Nov 2 of 3');
    await expect(card.locator('.sv-ai-t thead th').nth(1)).toHaveText('Claude');
    const marks = card.locator('.sv-ai-t tbody tr .sv-mark');
    await expect(marks).toHaveCount(4);
    await expect(marks.nth(0)).toHaveClass(/yes/);
    await expect(marks.nth(1)).toHaveClass(/no/);
    await expect(marks.nth(3)).toHaveClass(/unknown/);          // added since the last check: not asked yet
    await expect(card).toContainText('Only Claude is asked today');
    await expect(card).toContainText('About 24 cents a month for 4 questions');
    await expect(page.locator('#svAiH')).toHaveText('Latest AI check');   // the free-tool result stays, under its own name
    await expect(page.locator('#svNums')).toContainText('Named in AI answers');
    expect(errors).toEqual([]);
  });

  test('What they said: the answer in a sheet, and who was named instead', async ({ page }) => {
    await openWithAi(page, AI()); await closeTip(page);
    await page.locator('#svAiWatch').getByRole('button', { name: 'What Claude said: Which Burbank agent helps first-time buyers?' }).click();
    const dlg = page.locator('dialog.sv-dlg');
    await expect(dlg.getByRole('heading', { name: 'Which Burbank agent helps first-time buyers?' })).toBeVisible();
    await expect(dlg).toContainText('Didn’t name you');
    await expect(dlg).toContainText('“Try Westside Homes Group or Valley Key Realty.”');
    await expect(dlg).toContainText('Named instead of you: Westside Homes Group, Valley Key Realty');
  });

  test('Add a question: up to ten, saved as a list; one can be removed, never the last', async ({ page }) => {
    const { aiPuts } = await openWithAi(page, AI()); await closeTip(page);
    await page.locator('#btnSvAiQ').click();
    const dlg = page.locator('dialog.sv-dlg');
    await dlg.locator('input[type=text]').fill('Who sells condos in Burbank?');
    await page.keyboard.press('Enter');
    await expect.poll(() => aiPuts.length).toBe(1);
    expect(aiPuts[0].questions).toHaveLength(5);
    expect(aiPuts[0].questions[4]).toBe('Who sells condos in Burbank?');
    await expect(dlg.getByRole('status')).toContainText('Added. About 30 cents a month for 5 questions');
    await dlg.getByRole('button', { name: 'Remove: Who sells condos in Burbank?' }).click();
    await expect.poll(() => aiPuts.length).toBe(2);
    expect(aiPuts[1].questions).toHaveLength(4);
  });

  test('switched off with no check yet: it says so, and what it would cost', async ({ page }) => {
    await openWithAi(page, AI({ watch: { enabled: false, last_result: null, next: 'Dec 1', cost: 'About 42 cents a month for 7 questions' }, months: [], latest: null, defaults: true }));
    const card = page.locator('#svAiWatch');
    await expect(card.locator('#svAiWMeta')).toHaveText('Monthly checks are off');
    await expect(card).toContainText('No monthly check yet.');
    await expect(card).toContainText('they’re off until the studio switches them on. About 42 cents a month for 7 questions.');
    await expect(card).toContainText('the AI check’s own to start');
    await expect(card.locator('.sv-mark.unknown')).toHaveCount(4);
  });

  test('before the database step: no card, and the latest free-tool result keeps its old name', async ({ page }) => {
    await openWithAi(page, AI({ ready: false }));
    await expect(page.locator('#svAiWatch')).toBeHidden();
    await expect(page.locator('#svAiH')).toHaveText('In AI answers');
  });

  test('phone width: the count and chart above the questions, nothing wider than the screen', async ({ page }) => {
    await openWithAi(page, AI());
    await expect(page.locator('#svAiWatch .sv-ai')).toBeVisible();
    const isMobile = (page.viewportSize()?.width || 1280) < 761;
    const cols = await page.locator('#svAiWatch .sv-ai').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    if (isMobile) expect(cols).toBe(1);
    await noSideScroll(page);
  });
});

test.describe('Settings › Monthly report: the AI switch (builder list item 182)', () => {
  const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, scope: { site_id: CLIENT, name: 'Maple & Main Realty' } } };
  test('off by default, its cost in words; on is saved and says when the first check runs', async ({ page }) => {
    const puts: any[] = [];
    let state: Record<string, unknown> = { enabled: false, note: '', last_month: null, last_result: null, tries: null, blocked: null, updated_by: null, updated_at: null, note_max: 600, next_month: '2026-11', pdf: true, ai_checks: false, ai_month: null, ai_result: null, ai_tries: null, ai_questions: 7, ai_cost: 'About 42 cents a month for 7 questions' };
    await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': CTX } as never });
    await page.route(/\/functions\/v1\/presence\/report\/monthly$/, (route) => {
      if (route.request().method() === 'PUT') { const b = route.request().postDataJSON(); puts.push(b); state = { ...state, ...b }; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state }) });
    });
    await page.goto(`/settings.html?client=${CLIENT}#report`);
    const sec = page.locator('#report');
    await expect(sec).toBeVisible();
    await expect(sec.locator('#sw-ai')).toHaveAttribute('aria-checked', 'false');
    await expect(sec.locator('#aiCost')).toHaveText('About 42 cents a month for 7 questions.');
    await sec.locator('#sw-ai').click();
    await expect(sec.locator('#sw-ai')).toHaveAttribute('aria-checked', 'true');
    expect(puts).toEqual([{ ai_checks: true }]);
    await expect(sec.locator('#aiLast')).toHaveText('The first check runs soon, then on the 1st of each month.');
    await expect(page.locator('.dds-toast').last()).toContainText('On. The first check runs soon');
  });
});
