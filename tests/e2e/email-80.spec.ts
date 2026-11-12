import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 80 (Nov 2026): email a person from their record or their deal, with or without a
// project (drawn in Figma 264:1136 on the record, 264:1604 in Pipeline's deal card, 265:1452 on
// a phone). Who it goes to comes from the server, never typed; it goes out as the studio; it is
// kept on their timeline; a reply comes back to the Inbox. A stopped address and an older server
// are said before anything is written.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const CONTACT_RECORD = { data: {
  identity: { contact_id: CID, deal_id: null, client_id: null, customer_site_id: null, project_id: null },
  header: { name: 'Jordan Ellis', company: 'Larkspur Kitchen', email: 'jordan@example.com', phone: '(555) 010-2468', status: 'contact' },
  highlights: {}, sections: { overview: false, details: true, deal: false, delivery: false }, default_tab: 'details', canonical: { key: 'contact', value: CID },
} };
const INFO = (over: Record<string, unknown> = {}) => ({ data: { to: { name: 'Jordan Ellis', email: 'jordan@example.com' }, stopped: null, unsubscribed: false, as: 'Bright Pixel Studio', from: 'hello@example.test', replies: 'inbox', reply_to: 'site@reply.example.test', ...over } });
const REPLIES = { data: { replies: [{ id: 'r1', title: 'Thanks for reaching out', body: 'Thanks for reaching out! Here is what happens next.' }] } };
const BASE = { '/portal/context': STUDIO_CTX, '/crm/record': CONTACT_RECORD, '/crm/activity': { data: { items: [], upcoming: [] } }, '/sales/email': INFO(), '/service/saved-replies': REPLIES };
type Sent = { method: string; path: string; body: Record<string, unknown> | null };
// POST /sales/email answers from `answer` (one per send, the last repeats); GETs go to installApp's table
async function spySend(page: Page, sent: Sent[], answers: Array<{ status: number; body: unknown }>) {
  await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/email'), (route: Route) => {
    const r = route.request(); if (r.method() !== 'POST') return route.fallback();
    sent.push({ method: 'POST', path: '/sales/email', body: r.postDataJSON?.() ?? null });
    const a = answers[Math.min(sent.length, answers.length) - 1];
    return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
  });
}
const SENT_OK = { status: 200, body: { data: { sent: true, at: new Date().toISOString(), to: 'jordan@example.com', name: 'Jordan Ellis', logged: true } } };
const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });
async function openRecord(page: Page) {
  await page.goto(`/crm.html?contact=${CID}&tab=activity`);
  await expect(page.locator('#composer [data-ct="email"]')).toBeVisible();
}

test.describe('Email from a record (item 80)', () => {
  test('a person with no deal or project: the record opens on Email, To is them, and a send is kept on their timeline', async ({ page }) => {
    const sent: Sent[] = [];
    let reads = 0;
    await installApp(page, { api: BASE });
    page.on('request', (r) => { if (r.method() === 'GET' && /\/crm\/activity/.test(r.url())) reads++; });
    await spySend(page, sent, [SENT_OK]);
    await openRecord(page);
    await expect(page.locator('#composer [data-ct]')).toHaveText(['Email', 'Message', 'Log a call', 'To-do']);
    await expect(page.locator('#composer [data-ct="email"]')).toHaveAttribute('aria-selected', 'true');
    const box = page.locator('#emBox');
    await expect(box.locator('.dm-to')).toContainText('Jordan Ellis');
    await expect(box.locator('.dm-to')).toContainText('jordan@example.com');
    await expect(box.locator('.dm-n')).toHaveText('Sent as Bright Pixel Studio from hello@example.test · Replies come to your Inbox');
    await page.locator('#emSubject').fill('Good to meet you on Tuesday');
    await page.locator('#emBody').fill('Hi Jordan,');
    await box.getByLabel('Insert a saved reply').selectOption('r1');
    await expect(page.locator('#emBody')).toHaveValue('Hi Jordan,\n\nThanks for reaching out! Here is what happens next.');
    const before = reads;
    await box.getByRole('button', { name: 'Send email' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toEqual({ contact_id: CID, subject: 'Good to meet you on Tuesday', body: 'Hi Jordan,\n\nThanks for reaching out! Here is what happens next.' });
    await expect(toastWith(page, 'Email sent to Jordan.')).toBeVisible();
    await expect.poll(() => reads).toBeGreaterThan(before);   // the timeline reads again, so the email shows on it
    await expect(page.locator('#emSubject')).toHaveValue('');
    await expect(page.locator('#emBody')).toHaveValue('');
  });

  test('the header: Log a call and Email in front for a person with no deal; Email opens its tab with the caret in Subject', async ({ page }) => {
    await installApp(page, { api: BASE });
    await openRecord(page);
    await expect(page.locator('#act-log')).toBeVisible();
    await expect(page.locator('#act-email')).toBeVisible();
    await page.locator('#composer [data-ct="logcall"]').click();
    await expect(page.locator('#emBox')).toHaveCount(0);
    await page.locator('#act-email').click();
    await expect(page.locator('#composer [data-ct="email"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#emSubject')).toBeFocused();
    // Message is still a tab, and under More in the header
    await page.locator('#act-more').click();
    await expect(page.locator('#act-menu #act-message')).toBeVisible();
  });

  test('a send that fails keeps every word and says nothing went out; the next press sends once', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: BASE });
    await spySend(page, sent, [{ status: 503, body: { error: 'not_sent', message: 'We couldn’t send that just now. Nothing went out. Try again in a moment, or use your email app.' } }, SENT_OK]);
    await openRecord(page);
    await page.locator('#emSubject').fill('Your quote');
    await page.locator('#emBody').fill('Here it is.');
    await page.locator('#emBox').getByRole('button', { name: 'Send email' }).click();
    await expect(page.locator('#emBox [role=alert]')).toHaveText('We couldn’t send that just now. Nothing went out. Try again in a moment, or use your email app.');
    await expect(page.locator('#emSubject')).toHaveValue('Your quote');
    await expect(page.locator('#emBody')).toHaveValue('Here it is.');
    await page.locator('#emBox').getByRole('button', { name: 'Send email' }).click();
    await expect(toastWith(page, 'Email sent to Jordan.')).toBeVisible();
    expect(sent.length).toBe(2);
  });

  test('no subject or no message: it asks, and nothing is sent', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: BASE });
    await spySend(page, sent, [SENT_OK]);
    await openRecord(page);
    await page.locator('#emBox').getByRole('button', { name: 'Send email' }).click();
    await expect(page.locator('#emBox [role=alert]')).toHaveText('Give the email a subject.');
    await expect(page.locator('#emSubject')).toBeFocused();
    await page.locator('#emSubject').fill('Hello');
    await page.locator('#emBox').getByRole('button', { name: 'Send email' }).click();
    await expect(page.locator('#emBox [role=alert]')).toHaveText('Write your message first.');
    expect(sent.length).toBe(0);
  });

  test('what’s typed stays through a redraw of the timeline', async ({ page }) => {
    await installApp(page, { api: BASE });
    await openRecord(page);
    await page.locator('#emSubject').fill('Draft subject');
    await page.locator('#emBody').fill('Half a thought');
    // logging a call reads the timeline again, which draws the composer again
    await page.route((u) => u.pathname.endsWith('/sales/people/activity'), (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { item: { id: 'pe-1' } } }) }));
    await page.locator('#composer [data-ct="logcall"]').click();
    await page.locator('#logGo').click();
    await expect(toastWith(page, 'Logged.')).toBeVisible();
    await page.locator('#composer [data-ct="email"]').click();
    await expect(page.locator('#emSubject')).toHaveValue('Draft subject');
    await expect(page.locator('#emBody')).toHaveValue('Half a thought');
  });

  test('a bounced address is said before anything is written', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/sales/email': INFO({ stopped: 'bounce' }) } });
    await openRecord(page);
    await expect(page.locator('#emBox .dm-say')).toHaveText('Email to jordan@example.com bounced, so it can’t be sent there. Check the address on their details.');
    await expect(page.locator('#emBox form')).toHaveCount(0);
  });

  test('a spam report is said too', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/sales/email': INFO({ stopped: 'complaint' }) } });
    await openRecord(page);
    await expect(page.locator('#emBox .dm-say')).toHaveText('Jordan marked an earlier email as spam, so no more email goes to them from here.');
  });

  test('an unsubscribe from updates still lets a written email through, and says so', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/sales/email': INFO({ unsubscribed: true }) } });
    await openRecord(page);
    await expect(page.locator('#emBox .dm-hint')).toHaveText('Jordan unsubscribed from your updates. An email you write to just them still reaches them.');
    await expect(page.locator('#emBox').getByRole('button', { name: 'Send email' })).toBeVisible();
  });

  test('an older server: the Email tab says it’s on its way', async ({ page }) => {
    await installApp(page, { api: BASE });
    await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/email'), (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
    await openRecord(page);
    await expect(page.locator('#emBox .dm-say')).toHaveText('Email from here arrives with an update that’s on its way. Try again a little later.');
  });

  test('a record with no email address keeps the old tabs', async ({ page }) => {
    const rec = JSON.parse(JSON.stringify(CONTACT_RECORD)); rec.data.header.email = '';
    await installApp(page, { api: { ...BASE, '/crm/record': rec } });
    await page.goto(`/crm.html?contact=${CID}&tab=activity`);
    await expect(page.locator('#composer [data-ct]')).toHaveText(['Message', 'Log a call', 'To-do']);
    await expect(page.locator('#act-email')).toHaveCount(0);
  });
});

// ── Pipeline's deal card ──
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const D1 = '11111111-1111-4111-8111-1111111111d1';
const DEALS = [{ id: D1, title: 'Blue Finch — online orders', stage: 'proposal', contact_id: 'c1', expected_value_cents: 185000, source: 'manual', created_at: ago(5), updated_at: ago(1) }];
const PIPE = {
  '/portal/context': STUDIO_CTX,
  '/sales/deals': { data: DEALS },
  '/sales/contacts': { data: [{ id: 'c1', name: 'Maya Ruiz', email: 'maya@example.com', company: 'Blue Finch Café' }] },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 185000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], expected: { value_cents: 0 }, ar: { outstanding_cents: 0, count: 0 } } },
  '/settings': { data: { stage_stale_days: {} } },
  '/crm/activity': { data: { items: [{ id: 'a1', kind: 'deal_event', type: 'system', title: 'Proposal opened (3rd time)', at: ago(0.1) }] } },
  '/sales/email': INFO({ to: { name: 'Maya Ruiz', email: 'maya@example.com' } }),
  '/service/saved-replies': { data: { replies: [] } },
};
const pv = (page: Page) => page.locator('#dprev');

test.describe('Email from Pipeline’s deal card (item 80)', () => {
  test('Email opens a box in the card; it sends on the deal, puts itself away and the card reads the deal again', async ({ page }) => {
    const sent: Sent[] = [];
    let reads = 0;
    await installApp(page, { api: PIPE });
    page.on('request', (r) => { if (r.method() === 'GET' && /\/crm\/activity\?deal=/.test(r.url())) reads++; });
    await spySend(page, sent, [{ status: 200, body: { data: { sent: true, at: new Date().toISOString(), to: 'maya@example.com', name: 'Maya Ruiz', logged: true } } }]);
    await page.goto('/pipeline.html');
    await page.locator(`#board .bcard[data-id="${D1}"]`).click();
    await expect(pv(page).getByRole('group', { name: 'Quick actions' }).getByRole('button')).toHaveText(['Log a call', 'Email', 'Proposal', 'Invoice']);
    const email = pv(page).getByRole('button', { name: 'Email', exact: true });
    await email.click();
    await expect(email).toHaveAttribute('aria-expanded', 'true');
    await expect(pv(page).locator('#dpm-h')).toHaveText('Email Maya');
    await expect(pv(page).locator('#dpmSubject')).toBeFocused();
    await expect(pv(page).locator('.dm-to')).toContainText('maya@example.com');
    await pv(page).locator('#dpmSubject').fill('Following up on the proposal');
    await pv(page).locator('#dpmBody').fill('Hi Maya, happy to walk through it this week.');
    const before = reads;
    await pv(page).getByRole('button', { name: 'Send email' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toEqual({ deal_id: D1, subject: 'Following up on the proposal', body: 'Hi Maya, happy to walk through it this week.' });
    await expect(toastWith(page, 'Email sent to Maya.')).toBeVisible();
    await expect(pv(page).locator('.dp-mail')).toHaveCount(0);
    await expect(email).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => reads).toBeGreaterThan(before);
  });

  test('a repaint behind the box keeps what’s typed and where the caret was; × puts it away', async ({ page }) => {
    await installApp(page, { api: PIPE });
    await page.goto('/pipeline.html');
    await page.locator(`#board .bcard[data-id="${D1}"]`).click();
    await pv(page).getByRole('button', { name: 'Email', exact: true }).click();
    await pv(page).locator('#dpmSubject').fill('Still here');
    await pv(page).locator('#dpmBody').fill('Typing');
    // the card repaints when its deal moves or the list reads again: here, the page's own repaint
    await page.evaluate(() => (window as unknown as { dpPaint: () => void }).dpPaint());
    await expect(pv(page).locator('#dpmSubject')).toHaveValue('Still here');
    await expect(pv(page).locator('#dpmBody')).toBeFocused();
    await page.keyboard.type(' on');
    await expect(pv(page).locator('#dpmBody')).toHaveValue('Typing on');
    await pv(page).getByRole('button', { name: 'Put the email away' }).click();
    await expect(pv(page).locator('.dp-mail')).toHaveCount(0);
    await expect(pv(page).getByRole('button', { name: 'Email', exact: true })).toBeFocused();
  });
});

test.describe('The Email box reads clearly and fits a phone (item 80)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`it passes the contrast check (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: BASE });
      await openRecord(page);
      await expect(page.locator('#emBox .dm-go')).toBeVisible();
      const r = await new AxeBuilder({ page }).include('#emBox').withRules(['color-contrast']).analyze();
      expect(r.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
    });
  }

  test('on a phone nothing is wider than the screen and the controls are finger-sized', async ({ page }) => {
    await installApp(page, { api: BASE });
    await openRecord(page);
    const w = page.viewportSize()?.width || 1200;
    test.skip(w >= 768, 'phone only');
    await expect(page.locator('#emBox .dm-go')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    for (const sel of ['#emSubject', '#emBox .dm-go']) expect((await page.locator(sel).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    // 16px type, so focusing a field never zooms the page
    expect(await page.locator('#emBody').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  });
});
