import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 179, part three: one Messages door. Requests and Support fold
// into Messages, six tabs become five, a conversation reads like a chat, and Book
// a call and Ask for a service start from the top of the list. Drawn in Figma
// first (page "Client portal — parts 2 to 4", part 3).
const PID = '11111111-1111-4111-8111-111111111111';
const SD = 'd0d0d0d0-0000-4000-8000-000000000001';   // a question the studio has answered and closed
const SS = 'd0d0d0d0-0000-4000-8000-000000000002';   // a service ask, waiting for a price
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria',
} };
const MSGS = [
  { id: 'm2', body: 'Love it. Can we try a warmer green?', author_kind: 'client', created_at: '2026-11-10T15:00:00Z' },
  { id: 'm1', body: 'Here is the first homepage draft.', author_kind: 'staff', created_at: '2026-11-09T15:00:00Z' },
];
const EVENTS = [
  { id: 'e1', kind: 'deliverable_added', created_at: '2026-11-09T16:00:00Z', detail: { title: 'Homepage.pdf' } },
  { id: 'e2', kind: 'approval_decided', created_at: '2026-11-10T16:00:00Z', detail: { from: 'client', decision: 'approved' } },
];
const API = {
  '/portal/context': CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: { data: {
    project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: EVENTS, deliverables: [],
    approvals: [], surveys: [], progress: { total: 0, done: 0, pct: 0 },
  } },
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: MSGS },
  '/client/support': { data: [
    { id: SD, subject: 'Change the opening hours', status: 'resolved', project_id: null, updated_at: '2026-11-08T00:00:00Z', last_activity_at: '2026-11-08T12:00:00Z',
      last_message: { from: 'studio', text: 'Done. Have a look.' } },
    { id: SS, subject: 'Service request: Logo refresh', status: 'open', project_id: null, updated_at: '2026-11-07T00:00:00Z', last_activity_at: '2026-11-07T00:00:00Z',
      last_message: { from: 'you', text: 'A lighter logo for the shop sign.' } },
  ] },
  [`/client/support/${SD}`]: { data: {
    request: { id: SD, subject: 'Change the opening hours', body: 'Could Saturday read 9 to 3?', status: 'resolved', project_id: null, created_at: '2026-11-08T09:00:00Z' },
    messages: [{ id: 's1', body: 'Done. Have a look.', author_kind: 'staff', created_at: '2026-11-08T12:00:00Z' }],
  } },
  [`/client/support/${SS}`]: { data: {
    request: { id: SS, subject: 'Service request: Logo refresh', body: 'A lighter logo for the shop sign.', status: 'open', project_id: null, created_at: '2026-11-07T00:00:00Z' },
    messages: [],
  } },
  '/client/billing': { data: { invoices: [] } },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
};

async function start(page: Page, api: Record<string, unknown> = {}) {
  await installApp(page, { api: { ...API, ...api } });
}
const openMessages = async (page: Page) => {
  await page.locator('#tabnav [data-tab="messages"]').click();
  await expect(page.locator('#mrows [role="option"]').first()).toBeVisible();
};
const conv = (page: Page, title: string) => page.locator('.mrow', { has: page.locator('.rname', { hasText: title }) });

test.describe('Client portal part three — one Messages door (item 179)', () => {
  test('five tabs; Messages opens on Write, Book a call and Ask for a service, and counts its conversations', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    const tabs = page.locator('#tabnav [data-tab]');
    await expect(tabs).toHaveCount(5);
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')))).toEqual(['home', 'messages', 'files', 'invoices', 'help']);
    await openMessages(page);
    await expect(page).toHaveTitle('Messages — Marlow & Co');
    await expect(page.locator('#mnew')).toHaveText('Write');
    await expect(page.locator('#mnew')).toHaveAttribute('aria-label', 'Write to Marlow & Co');
    await expect(page.locator('.mlsub')).toHaveText('Talk to Marlow & Co. They usually reply within a day.');
    await expect(page.locator('#mbook')).toContainText('Pick a time to talk');
    await expect(page.locator('#msvc')).toContainText('See what they offer');
    await expect(page.locator('#mlmeta')).toHaveText('Conversations · 3');
    // the project conversation leads (its newest line is the freshest), with the studio's initial
    await expect(page.locator('#mrows [role="option"]').first()).toContainText('Website build');
    await expect(conv(page, 'Website build').locator('.mav')).toHaveText('M');
    // a question the studio closed says Done, and who wrote its last line
    await expect(conv(page, 'Change the opening hours').locator('.schip')).toHaveText('Done');
    await expect(conv(page, 'Change the opening hours')).toContainText('Marlow & Co: Done. Have a look.');
    // a service ask reads as the service, with a sparkle and "Asked" until it's handled
    await expect(conv(page, 'Logo refresh').locator('.mav')).toHaveText('✦');
    await expect(conv(page, 'Logo refresh').locator('.schip')).toHaveText('Asked');
    await expect(conv(page, 'Logo refresh')).toContainText('You: A lighter logo for the shop sign.');
    await expect(page.locator('.rname', { hasText: 'Service request:' })).toHaveCount(0);
  });

  test('a project conversation reads like a chat: the studio on the left, you on the right, the days marked, what happened as a quiet line', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await openMessages(page);
    await conv(page, 'Website build').click();
    const pane = page.locator('#mpane');
    await expect(pane.locator('.mpname')).toHaveText('Website build');
    await expect(pane.locator('.mpsub')).toContainText('With Marlow & Co · they usually reply within a day');
    const bubbles = pane.locator('.cmsg');
    await expect(bubbles).toHaveCount(2);
    // oldest first: the studio's draft, then your answer on your side
    await expect(bubbles.nth(0)).not.toHaveClass(/\bme\b/);
    await expect(bubbles.nth(0)).toContainText('Here is the first homepage draft.');
    await expect(bubbles.nth(1)).toHaveClass(/\bme\b/);
    await expect(bubbles.nth(1)).toContainText('Love it. Can we try a warmer green?');
    const studioBox = await bubbles.nth(0).locator('.cb').boundingBox();
    const mineBox = await bubbles.nth(1).locator('.cb').boundingBox();
    expect(mineBox!.x + mineBox!.width).toBeGreaterThan(studioBox!.x + studioBox!.width);   // yours sits to the right
    await expect(pane.locator('.cday')).toHaveCount(2);   // two days, each marked once
    await expect(pane.locator('.csys').nth(0)).toHaveText('Marlow & Co shared a file: Homepage.pdf');
    await expect(pane.locator('.csys').nth(1)).toContainText('You approved a change');
    // screen readers hear who wrote each line
    await expect(bubbles.nth(0).locator('.sr-only')).toHaveText('Marlow & Co: ');
    await expect(bubbles.nth(1).locator('.sr-only')).toHaveText('You: ');
    // the header's link opens the project itself
    await pane.getByRole('link', { name: 'Open the project →' }).click();
    await expect(page.locator('#main').getByRole('heading', { name: 'Website build', level: 1 })).toBeVisible();
  });

  test('writing in the chat: your line shows at once on your side; the paperclip sends files into the project', async ({ page }) => {
    const posted: string[] = [];
    let urls = 0, recorded = 0;
    const msgs = MSGS.slice();
    await start(page);
    await page.route(`**/functions/v1/presence/client/projects/${PID}/messages*`, (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}').body;
        posted.push(body);
        const row = { id: 'm9', body, author_kind: 'client', created_at: new Date().toISOString() };
        msgs.unshift(row);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: row }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: msgs }) });
    });
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) => { urls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { media_id: 'm' + urls, upload_url: 'https://storage.example/up/' + urls } }) }); });
    await page.route('https://storage.example/**', (route) => route.fulfill({ status: 200, body: '' }));
    await page.route('**/functions/v1/presence/client/projects/*/uploads', (route) => { recorded++; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'nd' + recorded } }) }); });
    await page.goto('/client.html');
    await openMessages(page);
    await conv(page, 'Website build').click();
    const box = page.getByRole('textbox', { name: 'Write to Marlow & Co' });
    await box.fill('Friday works for the photos.');
    await page.locator('#msend').click();
    await expect.poll(() => posted).toEqual(['Friday works for the photos.']);
    await expect(page.locator('#mpane .cmsg.me').last()).toContainText('Friday works for the photos.');
    await expect(box).toHaveValue('');
    await expect(conv(page, 'Website build')).toContainText('Friday works for the photos.');   // the list row follows
    // the paperclip: two photos at once, each recorded on the project
    await expect(page.getByRole('button', { name: 'Send a file to Marlow & Co' })).toBeVisible();
    await page.locator('#mfiles').setInputFiles([
      { name: 'Shopfront.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') },
      { name: 'Logo.png', mimeType: 'image/png', buffer: Buffer.from('png') },
    ]);
    await expect(page.locator('#toast')).toContainText('2 files sent to your studio ✓');
    expect(urls).toBe(2);
    expect(recorded).toBe(2);
  });

  test('a finished request stays readable, says Done, and Write starts a new conversation', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await openMessages(page);
    await conv(page, 'Change the opening hours').click();
    const pane = page.locator('#mpane');
    await expect(pane.locator('#msupstatus')).toHaveText('Done');
    await expect(pane.locator('.cmsg.me')).toContainText('Could Saturday read 9 to 3?');   // what you asked, on your side
    await expect(pane.locator('.cmsg:not(.me)')).toContainText('Done. Have a look.');
    await expect(pane.locator('#smsg')).toHaveCount(0);   // no reply box on a closed request
    await expect(pane.locator('#mpcomp')).toContainText('This one is done. Write to start a new conversation.');
    await pane.locator('#sdonewrite').click();
    await expect(page.locator('#mpane .mpname')).toHaveText('Write to Marlow & Co');
    await expect(page.getByLabel('What would you like to say?')).toBeVisible();
  });

  test('a service ask opens as a conversation that says Asked until the studio replies', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await openMessages(page);
    await conv(page, 'Logo refresh').click();
    await expect(page.locator('#mpane .mpname')).toHaveText('Logo refresh');
    await expect(page.locator('#msupstatus')).toHaveText('Asked');
    await expect(page.locator('#mpane .cmsg.me')).toContainText('A lighter logo for the shop sign.');
    await expect(page.getByRole('textbox', { name: 'Write to Marlow & Co' })).toBeVisible();   // still open, so you can add to it
  });

  test('Help’s Write to your studio opens the writing pane inside Messages', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="help"]').click();
    await page.getByRole('button', { name: 'Write to your studio' }).click();
    await expect(page.locator('#tabnav [data-tab="messages"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#mpane .mpname')).toHaveText('Write to Marlow & Co');
  });

  test('a bell link to a request with no id lands on the Messages list, never a missing project section', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect(page.locator('#needs-h')).toBeVisible();
    await page.evaluate((pid) => (window as any).navFromHref(`/projects/${pid}#support`), PID);
    await expect(page.locator('#tabnav [data-tab="messages"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#mrows [role="option"]')).toHaveCount(3);
  });

  test('phone: a conversation takes the screen, and ← Messages comes back to the list', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the stacked list-then-pane is the <720px layout');
    await start(page);
    await page.goto('/client.html');
    await openMessages(page);
    await conv(page, 'Website build').click();
    await expect(page.locator('#mconsole')).toHaveClass(/pane-open/);
    await expect(page.locator('#mrows')).toBeHidden();
    await expect(page.locator('#mback')).toBeFocused();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator('#mback').click();
    await expect(page.locator('#mconsole')).not.toHaveClass(/pane-open/);
    await expect(page.locator('#mrows')).toBeVisible();
  });
});
