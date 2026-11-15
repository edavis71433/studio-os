import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 179, reopened: Home while the website isn't live yet. Every
// client site starts unpublished, so the website card still leads (being built,
// draft ready, approved), Home never leaves an empty half, and the platform's
// stand-in name never shows. Drawn in Figma first ("A — while the website is
// being built").
const PID = '11111111-1111-4111-8111-111111111111';
const AW = 'a0a0a0a0-0000-4000-8000-000000000001';
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const ctx = (studio: unknown) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio, client_first_name: 'Maria',
} });
const TASKS = [
  { id: 'c1', title: 'Send back your project questionnaire', status: 'todo', client_action_required: true, source: 'checklist:questionnaire_returned', derived: {} },
  { id: 'c2', title: 'Send your content and photos', status: 'todo', client_action_required: true, source: 'checklist:content_received', derived: {} },
  { id: 'c3', title: 'Review the design draft', status: 'todo', client_action_required: true, source: 'checklist:client_review', derived: {} },
];
const ap = (status: string) => ({ id: AW, subject_type: 'website', subject_id: 'e0e0e0e0-0000-4000-8000-000000000000', title: 'Your website draft', summary: 'Does this feel like your shop?', content_hash: 'h1', status, decided_at: status === 'approved' ? '2026-11-10T00:00:00Z' : null });
const bundle = (over: Record<string, unknown> = {}) => ({ data: {
  project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: TASKS, events: [], deliverables: [],
  approvals: [], surveys: [{ id: 'sv1', title: 'Project questionnaire' }], progress: { total: 3, done: 0, pct: 0 }, ...over,
} });
const MSGS = [{ id: 'm1', body: 'Welcome aboard.', author_kind: 'operator', created_at: '2026-11-10T17:00:00Z' }];
const API: Record<string, unknown> = {
  '/portal/context': ctx(STUDIO),
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [{ key: `message-${PID}`, kind: 'message', project_id: PID, read: false, created_at: '2026-11-10T17:00:00Z', title: 'A new message' }], unread_count: 1 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: bundle(),
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: MSGS },
  '/client/support': { data: [] },
  '/client/billing': { data: { invoices: [] } },
  '/client/website-stats': { data: { published: false, month: null, search: null } },
  '/client/website-thumb': { data: { html: '<html><body><h1 id="dh">Fresh flowers daily</h1></body></html>', version: 'draft' } },
};
const start = (page: Page, api: Record<string, unknown> = {}) => installApp(page, { api: { ...API, ...api } });
const card = (page: Page) => page.locator('#home-website .wsbuild');

test.describe('Client portal while the website is being built (item 179)', () => {
  test('being built: the card leads Home, says what comes next, and has no button', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect(card(page).locator('.pill-build')).toHaveText('Being built');
    await expect(card(page).locator('h3')).toHaveText('Your website is on its way.');
    await expect(card(page).locator('.wslead')).toHaveText('It isn’t live yet. Marlow & Co is building it. Next: the 2 things under Needs you.');
    await expect(card(page).getByRole('button')).toHaveCount(0);
    await expect(card(page).locator('.wspic.dim iframe')).toHaveCount(1);   // the draft so far, faded
    // the draft review asks for nothing yet, so only the two real asks are queued
    await expect(page.locator('#needs-h')).toHaveText('Needs you · 2');
    await expect(page.locator('#needs-body').getByRole('heading', { name: 'Review the design draft' })).toHaveCount(0);
    await expect(page.locator(`#glance-${PID}`)).toContainText('2 to-dos for you');
    // the tour comes after the website, what needs them and their projects
    const order = await page.locator('#main > *').evaluateAll((els) => els.map((e) => e.id));
    expect(order.indexOf('welcome')).toBeGreaterThan(order.indexOf('home-projects'));
  });

  test('draft ready: Review the draft opens the draft itself', async ({ page }) => {
    await start(page, { [`/client/projects/${PID}`]: bundle({ approvals: [ap('pending')] }) });
    await page.route(`**/functions/v1/presence/client/approvals/${AW}/draft*`, (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { approval: { id: AW, status: 'pending' }, page: '', pages: [{ slug: '', title: 'Home' }], sections: [], notes: [], html: '<html><body><h1>Fresh flowers daily</h1></body></html>' } }) }));
    await page.goto('/client.html');
    await expect(card(page).locator('.pill-draft')).toHaveText('Draft ready');
    await expect(card(page).locator('h3')).toHaveText('Your draft is ready to look at.');
    await expect(card(page).locator('.wslead')).toContainText('Marlow & Co asked: “Does this feel like your shop?”');
    await expect(card(page).locator('.wspic.dim')).toHaveCount(0);
    await card(page).getByRole('button', { name: 'Review the draft' }).click();
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
  });

  test('approved: says so and what happens next', async ({ page }) => {
    await start(page, { [`/client/projects/${PID}`]: bundle({ approvals: [ap('approved')] }) });
    await page.goto('/client.html');
    await expect(card(page).locator('.pill-live')).toHaveText('Approved');
    await expect(card(page).locator('h3')).toHaveText('You approved your website.');
    await expect(card(page).locator('.wslead')).toContainText('Marlow & Co is getting it ready to go live.');
    await expect(card(page).getByRole('button', { name: 'See the draft again' })).toBeVisible();
  });

  test('Home never leaves an empty half: with no card, the projects move up beside Needs you', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'two columns are the computer’s layout');
    await start(page);
    await page.route('**/functions/v1/presence/client/website-stats', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed' }) }));
    await page.goto('/client.html');
    await expect(page.locator('#needs-body .qrow').first()).toBeVisible();
    await expect(page.locator('#home-website')).toBeHidden();
    const top = (sel: string) => page.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    expect(Math.abs(await top('#home-projects') - await top('#home-needs'))).toBeLessThan(4);
  });

  test('…and with the card, the website sits beside Needs you', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'two columns are the computer’s layout');
    await start(page);
    await page.goto('/client.html');
    await expect(card(page)).toBeVisible();
    const top = (sel: string) => page.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    expect(Math.abs(await top('#home-website') - await top('#home-needs'))).toBeLessThan(4);
  });

  test('a studio with no name of its own is “your studio”, never the platform', async ({ page }) => {
    await start(page, { '/portal/context': ctx({ name: 'Studio OS', logo_url: null, accent: '#5b3fa0', is_default: true }) });
    await page.goto('/client.html');
    await expect(card(page)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Studio OS');
    await expect(page.locator('#footby')).toHaveText('by your studio');
    await expect(card(page).locator('.wslead')).toContainText('Your studio is building it.');
    await page.locator('#tabnav [data-tab="messages"]').click();
    await expect(page.locator('#mrows .mrow').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Studio OS');
    await expect(page.locator('#mrows .mav').first()).toHaveText('✦');
    await page.locator('#tabnav [data-tab="documents"]').click();
    await expect(page.locator('#main h1')).toHaveText('Documents');
    await expect(page.locator('body')).not.toContainText('Studio OS');
  });

  test('the studio’s own name and initial lead the bar', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect(page.locator('#tabnav .cb-name')).toHaveText('Marlow & Co');
    await expect(page.locator('#tabnav .cb-mark')).toHaveText('M');
  });

  test('Messages on a computer opens the newest conversation and keeps its dot', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'a phone shows the list first');
    await start(page);
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="messages"]').click();
    await expect(page.locator('#mpane')).toContainText('Welcome aboard.');
    await expect(page.locator('.mrow[aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('#mpane')).not.toContainText('Pick a conversation');
  });

  test('…the newest one still going, not a finished request', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'a phone shows the list first');
    const DONE = 'd0d0d0d0-0000-4000-8000-000000000001';
    await start(page, { '/client/support': { data: [{ id: DONE, subject: 'Service request: Custom request', status: 'closed', created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z', last_activity_at: '2026-11-11T10:00:00Z', last_message: { text: 'Please ignore and close.', from: 'you' } }] },
      [`/client/support/${DONE}`]: { data: { request: { id: DONE, subject: 'Service request: Custom request', status: 'closed' }, messages: [] } } });
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="messages"]').click();
    await expect(page.locator('.mrow').first()).toContainText('Custom request');   // newest in the list…
    await expect(page.locator('.mrow[aria-selected="true"]')).toContainText('Website build');   // …but the live one is open
    await expect(page.locator('#mpane')).toContainText('Welcome aboard.');
  });

  test('on a phone each Needs you row keeps its button on the right', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'the phone’s layout');
    await start(page);
    await page.goto('/client.html');
    const row = page.locator('#needs-body .qrow').first();
    await expect(row).toBeVisible();
    const box = (sel: string) => row.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    const main = await box('.qmain'), act = await box('.qact');
    expect(act.left).toBeGreaterThanOrEqual(main.right - 1);
    expect(act.top).toBeLessThan(main.bottom);
    await expect(row.locator('.qmain p')).toHaveText('A short questionnaire');   // one project: its name isn't repeated on every row
  });

  test('a returning client’s Home reads leave together', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect(card(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dds-portal-persona:e2e-owner'))).toBe('client');
    // hold the context read: on the second visit the others must already be out before it answers
    const seen: string[] = [];
    page.on('request', (r) => { const m = r.url().match(/\/functions\/v1\/presence(\/[^?]*)/); if (m) seen.push(m[1]); });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/portal/context', async (route) => { await held; return route.fallback(); });
    await page.goto('about:blank'); await page.goto('/client.html');
    // everything Home needs is out before the context answers: the project's details follow the list at once
    await expect.poll(() => ['/client/notifications', '/client/website-stats', '/client/website-thumb', '/client/projects', '/portal/feed', '/client/billing', `/client/projects/${PID}`].every((p) => seen.includes(p))).toBe(true);
    release();
    await expect(card(page)).toBeVisible();
    await expect(page.locator('#needs-h')).toHaveText('Needs you · 2');
    for (const p of ['/client/notifications', '/client/website-stats', '/client/billing', `/client/projects/${PID}`]) expect(seen.filter((x) => x === p).length, p).toBe(1);
  });

  test('a first visit: Home’s reads go out beside the notifications, not after them', async ({ page }) => {
    await start(page);
    const seen: string[] = [];
    page.on('request', (r) => { const m = r.url().match(/\/functions\/v1\/presence(\/[^?]*)/); if (m) seen.push(m[1]); });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/client/notifications', async (route) => { await held; return route.fallback(); });
    await page.goto('/client.html');
    await expect.poll(() => ['/client/website-stats', '/client/website-thumb', '/client/billing', `/client/projects/${PID}`].every((p) => seen.includes(p))).toBe(true);
    release();
    await expect(card(page)).toBeVisible();
    await expect(page.locator('#needs-h')).toHaveText('Needs you · 2');
    expect(seen.filter((x) => x === `/client/projects/${PID}`).length).toBe(1);   // the card and Needs you share the one read
  });

  test('the card says Your website and its state on one line, as drawn', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    const top = (sel: string) => card(page).locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    expect(Math.abs(await top('.tag') - await top('.pill-build'))).toBeLessThan(4);
  });

  test('the questionnaire says what the answers are for', async ({ page }) => {
    await start(page, { '/client/surveys/sv1': { data: { survey: { title: 'Project questionnaire', questions: [{ key: 'goal', label: 'What does your business do?', type: 'text' }] }, my_response: null } } });
    await page.goto('/client.html');
    await page.locator('#needs-body .qrow', { hasText: 'questionnaire' }).getByRole('button', { name: /^Start/ }).click();
    await expect(page.locator('#main h1')).toHaveText('Project questionnaire');
    await expect(page.locator('#main .sheet .sub')).toHaveText('Your answers help Marlow & Co write your pages.');
  });

  test('every server read asks to run beside the database', async ({ page }) => {
    await start(page);
    const regions = new Set<string>();
    page.on('request', (r) => { if (r.url().includes('/functions/v1/presence/') && r.method() !== 'OPTIONS') regions.add(r.headers()['x-region'] || 'none'); });
    await page.goto('/client.html');
    await expect(card(page)).toBeVisible();
    expect([...regions]).toEqual(['us-west-2']);
  });

  test('a returning client sees the last Home at once, and it cannot be pressed until the fresh one is in', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect(page.locator('#needs-h')).toHaveText('Needs you · 2');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dds-portal-home:')).length)).toBe(1);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('dds-portal-home:'))!)!));
    expect(kept.main).toContain('Needs you · 2');
    expect(kept.main).not.toContain('<iframe');   // the site's picture is drawn fresh, never kept
    // the next visit: hold the context read, and the kept Home is already there
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/portal/context', async (route) => { await held; return route.fallback(); });
    await page.goto('about:blank'); await page.goto('/client.html');
    await expect(page.locator('#main #needs-h')).toHaveText('Needs you · 2');
    await expect(page.locator('#main')).toHaveAttribute('inert', '');
    await expect(page.locator('#tabnav .cb-name')).toHaveText('Marlow & Co');
    release();
    await expect(page.locator('#main')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#needs-h')).toHaveText('Needs you · 2');
    await expect(page.locator('#needs-body .qrow').first().getByRole('button')).toBeEnabled();
  });

  test('a link to a project never shows the kept Home first', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dds-portal-home:')).length)).toBe(1);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/portal/context', async (route) => { await held; return route.fallback(); });
    await page.goto('about:blank'); await page.goto(`/client.html?project=${PID}`);
    await page.waitForTimeout(300);
    await expect(page.locator('#main #home-hero')).toHaveCount(0);
    release();
    await expect(page.locator('#main h1')).toHaveText('Website build');
  });

  test('signing out wipes the kept Home from the device', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dds-portal-home:')).length)).toBe(1);
    // the sign-in page is a blank stand-in: the test's sign-in never really ends, and the real
    // page would send a signed-in browser straight back to the portal (which keeps a fresh copy)
    await page.route('**/portal.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Sign in</title>' }));
    await page.evaluate(() => (window as unknown as { doSignOut: (e?: unknown) => Promise<void> }).doSignOut());
    await page.waitForURL('**/portal.html');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dds-portal-home:')).length)).toBe(0);
  });
});
