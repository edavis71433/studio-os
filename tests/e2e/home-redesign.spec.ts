import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Home, the bold redesign (sales list item 70, Nov 2026): what needs you comes
// first, as one list with tabs (Needs you · My tasks · Waiting on them ·
// Snoozed); each row carries its verb, Snooze and Done; "Go through them"
// takes the list one at a time. A Today card sits beside the greeting on a
// computer. Runs at all three sizes.

const ymd = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const DEAL = '11111111-1111-4111-8111-111111111111';
const DPROP = '22222222-2222-4222-8222-222222222222';
const DCON = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';
const E1 = '55555555-5555-4555-8555-555555555555';
const S1 = '66666666-6666-4666-8666-666666666666';
const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const ROWS = [
  { key: 'money:inv1', kind: 'money', site_id: null, client_id: null, name: 'Maple & Main Realty', what: 'invoice $1,200 is overdue by 4 days', when: 'Sent Oct 28 · no payment yet', verb: 'Resend', href: `/crm.html?deal=${DEAL}&tab=billing` },
  { key: `enquiry:${E1}`, kind: 'enquiry', site_id: SITE, client_id: null, name: 'Harbor Dental', what: 'new enquiry from Priya', when: 'Nov 6', verb: 'Reply', href: `/inbox.html?client=${SITE}#enquiries?sel=lead:${E1}`, at: ago(3), clear: { kind: 'enquiry', site_id: SITE, ids: [E1] } },
  { key: `support:${S1}`, kind: 'support', site_id: null, client_id: null, name: 'Blue Finch Café', what: 'support request: spring menu', when: 'Opened Nov 5', verb: 'Reply', href: `/inbox.html#support?sel=sup:${S1}`, at: ago(4), clear: { kind: 'support', site_id: null, ids: [S1] } },
  { key: `deal:${DEAL}`, kind: 'deal', site_id: null, client_id: null, name: 'Juniper Floral', what: 'next step “Send the proposal” is 2 days late', when: 'On the deal Juniper Floral — site · due Nov 7', verb: 'Open deal', href: `/crm.html?deal=${DEAL}` },
  { key: `notice:${NOTE}`, kind: 'notice', site_id: null, client_id: null, name: 'A review is waiting', what: 'answer a new review', when: '', verb: 'Open', href: '/inbox.html' },
  { key: `broken:publish:${SITE}`, kind: 'broken', site_id: SITE, client_id: null, name: 'Ortiz Photography', what: 'the last publish didn’t finish', when: 'Found by the health check', verb: 'Fix', href: `/presence.html?client=${SITE}#publish` },
];
const needsYou = (rows = ROWS, over: Record<string, unknown> = {}) => ({ data: {
  rows: rows.slice(0, 8), more: Math.max(0, rows.length - 8), rest: rows.slice(8), total: rows.length,
  empty_line: rows.length ? '' : 'Everything is paid and published.', partial: false, own_site: true,
  next_by_site: {}, next_by_client: {}, old: { count: 0, items: [] }, snooze_ready: true, snoozed: [], ...over,
} });
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const HOME = {
  '/portal/context': STUDIO_CTX,
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 4, open: { count: 3, value_cents: 900000 }, won_month: { count: 1, value_cents: 195000 }, win_rate: { pct: null, won: 1, lost: 0 }, by_stage: [], ar: { outstanding_cents: 190000, count: 2, overdue_count: 1 } } },
  '/sales/deals': { data: [
    { id: DPROP, title: 'Cedar Garage — new website', stage: 'proposal', expected_value_cents: 500000, converted_client_id: null, created_at: ago(9), updated_at: ago(3) },
    { id: DCON, title: 'Larkspur Kitchen — menus', stage: 'contract', expected_value_cents: 250000, converted_client_id: null, created_at: ago(20), updated_at: ago(8) },
    { id: DEAL, title: 'Juniper Floral — site', stage: 'lead', expected_value_cents: 150000, converted_client_id: null, created_at: ago(2), updated_at: ago(2) },
    { id: 'won1', title: 'Willow Day Spa', stage: 'won', expected_value_cents: 195000, converted_client_id: 'c1', converted_at: ago(1), updated_at: ago(1) },
  ] },
  '/sales/receivables': { data: { items: [
    { id: 'inv-soon', title: 'Logo — deposit', amount_cents: 70000, due_date: ymd(3), status: 'open', deal_id: DPROP, deal: 'Cedar Garage — new website', client_id: null, customer_site_id: null, created_at: ago(2) },
    { id: 'inv-late', title: 'Website', amount_cents: 120000, due_date: ymd(-4), status: 'open', deal_id: DEAL, deal: 'Maple & Main Realty', client_id: null, customer_site_id: null, created_at: ago(12) },
  ], total_cents: 190000 } },
  '/sales/my-tasks': { data: { partial: false, total: 3, items: [
    { kind: 'next_step', id: DEAL, parent_id: DEAL, title: 'Send the proposal', due: ymd(-2), context: 'Juniper Floral — site', href: `/pipeline.html?deal=${DEAL}`, blocked: false },
    { kind: 'deal_task', id: 'dt1', parent_id: DCON, title: 'Price the add-ons', due: ymd(0), context: 'Larkspur Kitchen — menus', href: `/pipeline.html?deal=${DCON}`, blocked: false },
    { kind: 'deal_task', id: 'dt2', parent_id: DCON, title: 'Order the photos', due: ymd(9), context: 'Larkspur Kitchen — menus', href: `/pipeline.html?deal=${DCON}`, blocked: false },
  ] } },
  '/agency/needs-you': needsYou(),
};

type Sent = { method: string; path: string; body: unknown; scope: string | null };
/** Record every write, and answer Snooze / Wake as the server does (installApp answers by path only). */
async function server(page: Page, opts: { failDone?: boolean } = {}) {
  const sent: Sent[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET') return;
    const u = new URL(r.url()); if (!u.pathname.includes('/functions/v1/presence/')) return;
    let body: unknown = null; try { body = r.postDataJSON(); } catch { body = null; }
    sent.push({ method: r.method(), path: u.pathname.replace(/^.*\/functions\/v1\/presence/, ''), body, scope: r.headers()['x-dds-scope-site'] || null });
  });
  await page.route(/\/functions\/v1\/presence\/agency\/needs-you\/(snooze|wake)$/, (route) => {
    const body = route.request().postDataJSON() as { key: string; days?: number };
    const until = route.request().url().endsWith('/snooze') ? new Date(Date.now() + (body.days || 2) * 86400000).toISOString() : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { key: body.key, until } }) });
  });
  if (opts.failDone) await page.route(`**/functions/v1/presence/support/${S1}`, (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed', message: 'That request didn’t close just now.' }) }));
  return sent;
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 761;
const row = (page: Page, key: string) => page.locator(`#needs .row[data-need="${key}"]`);

test.describe('Home — the list first (item 70)', () => {
  test('the greeting, Today beside it on a computer, then the list, then the numbers', async ({ page }) => {
    await installApp(page, { api: HOME });
    await server(page);
    await page.goto('/agency.html');
    const needs = page.locator('#needs'), studio = page.locator('#studio');
    await expect(page.locator('#qt-needs')).toHaveText('Needs you 6');
    await expect(studio.locator('#numbers')).toBeVisible();
    expect((await needs.boundingBox())!.y).toBeLessThan((await studio.boundingBox())!.y);
    await expect(page.locator('#heroSub')).toHaveText('6 things need you. 1 is money.');
    const today = page.locator('#todayCard');
    if (isPhone(page)) {
      await expect(today).toBeHidden();
    } else {
      await expect(today).toBeVisible();
      await expect(today.locator('a .tw')).toHaveText(['Late', 'Today', 'In 3 days']);
      await expect(today.locator('a').nth(0)).toContainText('Send the proposal · Juniper Floral — site');
      await expect(today.locator('a').nth(2)).toContainText('Invoice $700 due · Cedar Garage — new website');
      await expect(today.locator('a').nth(2)).toHaveAttribute('href', `/crm.html?deal=${DPROP}&tab=billing`);
      if ((page.viewportSize()?.width || 0) >= 1100) {
        const hero = (await page.locator('#top .hero').boundingBox())!, card = (await today.boundingBox())!;
        expect(card.x).toBeGreaterThan(hero.x + hero.width - 1);   // beside it, not under it
      }
    }
    // the tabs carry their counts; My tasks moved in from the studio strip
    await expect(page.locator('#needs [role=tab]')).toHaveText(['Needs you 6', 'My tasks 3', 'Waiting on them 3']);
    await expect(studio.locator('#my-tasks')).toHaveCount(0);
    // each row: name, kind, what · when, the verb (the first one filled)
    await expect(needs.locator('.row .kchip')).toHaveText(['Money', 'Enquiry', 'Support', 'Deal', 'Notice', 'Website']);
    await expect(needs.locator('.row a.rowact').first()).toHaveClass(/primary/);
  });

  test('Done uses the route that owns each thing; money and a broken site have none', async ({ page }) => {
    test.skip(isPhone(page), 'on a phone, Done lives in Go through them (its own test)');
    await installApp(page, { api: HOME });
    const sent = await server(page);
    await page.goto('/agency.html');
    for (const k of ['money:inv1', `broken:publish:${SITE}`]) await expect(row(page, k).locator('[data-ndone]')).toHaveCount(0);
    await row(page, `enquiry:${E1}`).getByRole('button', { name: 'Done: Harbor Dental' }).click();
    await expect(row(page, `enquiry:${E1}`)).toHaveCount(0);
    await expect(page.locator('#qt-needs')).toHaveText('Needs you 5');
    await row(page, `support:${S1}`).getByRole('button', { name: 'Done: Blue Finch Café' }).click();
    await expect(row(page, `support:${S1}`)).toHaveCount(0);
    await row(page, `deal:${DEAL}`).getByRole('button', { name: 'Done: Juniper Floral' }).click();
    await expect(row(page, `deal:${DEAL}`)).toHaveCount(0);
    await row(page, `notice:${NOTE}`).getByRole('button', { name: 'Done: A review is waiting' }).click();
    await expect(row(page, `notice:${NOTE}`)).toHaveCount(0);
    await expect(page.locator('#qt-needs')).toHaveText('Needs you 2');
    await expect(page.locator('.dds-toast').last()).toContainText('Done: A review is waiting');
    expect(sent.map((s) => [s.method, s.path, s.body, s.scope])).toEqual([
      ['POST', `/forms/inbox/${E1}`, { status: 'read' }, SITE],                 // inside that client's account
      ['PATCH', `/support/${S1}`, { status: 'closed' }, null],
      ['PATCH', `/sales/deals/${DEAL}`, { next_step: '', next_step_at: '' }, null],
      ['POST', '/commerce/notices/dismiss', { id: NOTE }, null],
    ]);
  });

  test('a failed Done keeps the row and says why', async ({ page }) => {
    test.skip(isPhone(page), 'on a phone, Done lives in Go through them');
    await installApp(page, { api: HOME });
    await server(page, { failDone: true });
    await page.goto('/agency.html');
    const b = row(page, `support:${S1}`).getByRole('button', { name: 'Done: Blue Finch Café' });
    await b.click();
    await expect(page.locator('.dds-toast').last()).toContainText('That request didn’t close just now.');
    await expect(b).toBeEnabled();
    await expect(page.locator('#qt-needs')).toHaveText('Needs you 6');
  });

  test('Snooze: the row leaves, the count drops, it waits under Snoozed; Undo brings it back', async ({ page }) => {
    test.skip(isPhone(page), 'on a phone, Snooze lives in Go through them');
    await installApp(page, { api: HOME });
    const sent = await server(page);
    await page.goto('/agency.html');
    await row(page, 'money:inv1').getByRole('button', { name: 'Snooze for 2 days: Maple & Main Realty' }).click();
    await expect(row(page, 'money:inv1')).toHaveCount(0);
    await expect(page.locator('#qt-needs')).toHaveText('Needs you 5');
    await expect(page.locator('#heroSub')).toHaveText('5 things need you.');
    await expect(row(page, `enquiry:${E1}`).locator('a.rowact')).toBeFocused();         // the next row's verb, not <body>
    const t = page.locator('.dds-toast').last();
    await expect(t).toContainText('Snoozed until');
    await expect(t).toContainText('Maple & Main Realty');
    await page.locator('#qt-snoozed').click();
    await expect(page.locator('#qt-snoozed')).toHaveText('Snoozed 1');
    await expect(page.locator('#snoozedList .row')).toContainText('Maple & Main Realty');
    await expect(page.locator('#snoozedList .until')).toContainText('Back ');
    await t.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.map((s) => [s.path, s.body])).toEqual([['/agency/needs-you/snooze', { key: 'money:inv1', days: 2 }], ['/agency/needs-you/wake', { key: 'money:inv1' }]]);
    await expect(page.locator('#qt-needs')).toHaveText('Needs you 6');                  // read fresh: back in its place
    await expect(page.locator('#needs .row').first()).toHaveAttribute('data-need', 'money:inv1');
  });

  test('before the database step there is no Snooze anywhere', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/agency/needs-you': needsYou(ROWS, { snooze_ready: false }) } });
    await server(page);
    await page.goto('/agency.html');
    await expect(page.locator('#needs .row')).toHaveCount(6);
    await expect(page.locator('#needs [data-snooze]')).toHaveCount(0);
    await page.locator('#goThrough').click();
    await expect(page.locator('#focusDlg .fwhat')).toBeVisible();
    await expect(page.locator('#focusDlg .fsnooze')).toHaveCount(0);
  });

  test('Waiting on them: proposals and agreements out, and invoices not yet late', async ({ page }) => {
    await installApp(page, { api: HOME });
    await server(page);
    await page.goto('/agency.html');
    await page.locator('#qt-wait').click();
    const list = page.locator('#waitList .row');
    await expect(list).toHaveCount(3);
    await expect(list.locator('b')).toHaveText(['Larkspur Kitchen — menus', 'Cedar Garage — new website', 'Cedar Garage — new website']);   // waiting longest first
    await expect(list.nth(0)).toContainText('Agreement out · 8 days ago');
    await expect(list.nth(1)).toContainText('Proposal sent · 3 days ago');
    await expect(list.nth(2)).toContainText('Invoice $700 · due');
    await expect(page.locator('#waitList')).not.toContainText('$1,200');                   // the late one is under Needs you
    await expect(list.nth(2).locator('a.rowact')).toHaveAttribute('href', `/crm.html?deal=${DPROP}&tab=billing`);
  });

  test('the tabs follow the keyboard', async ({ page }) => {
    test.skip(isPhone(page), 'a keyboard');
    await installApp(page, { api: HOME });
    await server(page);
    await page.goto('/agency.html');
    await page.locator('#qt-needs').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#qt-tasks')).toBeFocused();
    await expect(page.locator('#qt-tasks')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#my-tasks .trow')).toHaveCount(3);
    await page.keyboard.press('End');
    await expect(page.locator('#qt-wait')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#qt-needs')).toHaveAttribute('aria-selected', 'true');
    // Go through them from the keyboard lands on the card's verb; from a click, on the view (no ring on a button)
    await page.locator('#goThrough').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#focusDlg .fgo')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#focusDlg #fcount')).toHaveText('Needs you · 2 of 6');
    await expect(page.locator('#focusDlg .fgo')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('#goThrough').click();
    await expect(page.locator('#focusDlg .fwrap')).toBeFocused();
  });

  test('Go through them: one at a time; Mark done takes it off and moves on; Snooze; skip; the end says so', async ({ page }) => {
    await installApp(page, { api: HOME });
    const sent = await server(page);
    await page.goto('/agency.html');
    await page.locator('#goThrough').click();
    const f = page.locator('#focusDlg');
    await expect(f.locator('#fcount')).toHaveText('Needs you · 1 of 6');
    await expect(f.locator('.fwhat')).toHaveText('Invoice $1,200 is overdue by 4 days.');
    await expect(f.locator('.fdone')).toHaveCount(0);                                     // money: only doing it clears it
    await f.locator('.fsnooze').click();                                                   // Snooze 2 days
    await expect(f.locator('.fwhat')).toHaveText('New enquiry from Priya.');
    await expect(f.locator('#fcount')).toContainText('1 of 5');
    await f.locator('.fdone').click();                                                     // Mark done: read
    await expect(f.locator('.fwhat')).toHaveText('Support request: spring menu.');
    await f.locator('.fskip').click();
    await expect(f.locator('.fwhat')).toHaveText('Next step “Send the proposal” is 2 days late.');
    for (const left of ['A review is waiting', 'Ortiz Photography']) { await f.locator('.fskip').click(); await expect(f.locator('.fwho b')).toHaveText(left); }
    await f.locator('.fskip').click();
    await expect(f.locator('.fdone-all h2')).toHaveText('That’s the list.');
    await expect(f.locator('.fdone-all p')).toContainText('2 things off your plate');
    await f.locator('.fend').click();
    await expect(f).toBeHidden();
    await expect(page.locator('#goThrough')).toBeFocused();
    await expect(page.locator('#qt-needs')).toHaveText('Needs you 4');
    expect(sent.map((s) => s.path)).toEqual(['/agency/needs-you/snooze', `/forms/inbox/${E1}`]);
  });

  test('a phone: rows keep only their verb, Go through them fills the screen, a swipe left skips', async ({ page }) => {
    test.skip(!isPhone(page), 'phone layout');
    await installApp(page, { api: HOME });
    await server(page);
    await page.goto('/agency.html');
    await expect(page.locator('#needs .row').first().locator('.qlink')).toBeHidden();
    await expect(page.locator('#needs .row').first().locator('a.rowact')).toBeVisible();
    await page.locator('#goThrough').click();
    const f = page.locator('#focusDlg');
    await expect(f.locator('.fswipe')).toBeVisible();
    const box = (await f.boundingBox())!;
    expect(Math.round(box.width)).toBe(page.viewportSize()!.width);
    for (const b of await f.locator('.facts a, .facts button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // a left swipe on the card (touch pointer events, as WebKit sends them)
    await f.locator('.fcard').evaluate((card) => {
      const r = card.getBoundingClientRect(), y = r.top + r.height / 2;
      card.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: r.right - 20, clientY: y, bubbles: true }));
      card.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', clientX: r.left + 20, clientY: y + 4, bubbles: true }));
    });
    await expect(f.locator('#fcount')).toHaveText('Needs you · 2 of 6');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('Home — after + Create (item 70)', () => {
  test('a call, a deal, an invoice or a to-do made with + Create brings Home up to date without a reload', async ({ page }) => {
    const reads: string[] = [];
    page.on('request', (r) => { const p = new URL(r.url()).pathname; if (r.method() === 'GET' && /\/(sales\/my-tasks|agency\/needs-you)$/.test(p)) reads.push(p.replace(/^.*\/presence/, '')); });
    await installApp(page, { api: HOME });
    await page.goto('/agency.html');
    await expect.poll(() => reads.filter((p) => p === '/sales/my-tasks').length).toBeGreaterThan(0);
    await expect.poll(() => reads.filter((p) => p === '/agency/needs-you').length).toBeGreaterThan(0);
    const tasks0 = reads.filter((p) => p === '/sales/my-tasks').length, needs0 = reads.filter((p) => p === '/agency/needs-you').length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dds:created', { detail: { kind: 'todo' } })));   // what create.js sends after a save
    await expect.poll(() => reads.filter((p) => p === '/sales/my-tasks').length).toBeGreaterThan(tasks0);
    await expect.poll(() => reads.filter((p) => p === '/agency/needs-you').length).toBeGreaterThan(needs0);
  });
});
