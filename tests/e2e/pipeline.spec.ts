import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Pipeline (redesign slice 3): a 3-way List · Board · Table display (persisted),
// the Table as a sortable list view whose rows open the SAME full-screen drawer,
// and the drawer's "Move stage" button stack replaced by the Path chevron bar —
// visually the record page's (crm.html) Path, advancing via the EXISTING stage
// POST, with the guidance strip rendering BOTH the tip AND the action (the
// pipeline.html:694 g.suggested_action → g.action fix, regression-pinned here).

const DEAL = '11111111-1111-4111-8111-111111111111';
const DEAL2 = '22222222-2222-4222-8222-222222222222';
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const pastDay = (d: number) => past(d).slice(0, 10);

const DEALS = { data: [
  { id: DEAL, title: 'Acme website', stage: 'proposal', source: 'manual', expected_value_cents: 500000, expected_close: '2026-08-01', contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: 'Follow up call', next_step_at: pastDay(2), last_contacted_at: past(3), agreement_signed: false },
  { id: DEAL2, title: 'Beta rebrand', stage: 'lead', source: 'enquiry', expected_value_cents: 250000, expected_close: null, contact_id: 'ct-2', converted_client_id: null, updated_at: past(2), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false },
] };

const DEAL_DETAIL = { data: {
  deal: { id: DEAL, title: 'Acme website', stage: 'proposal', expected_value_cents: 500000, expected_close: '2026-08-01', next_step: 'Follow up call', next_step_at: pastDay(2), notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null },
  contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [],
  last_contacted_at: past(3),
} };

const API = {
  '/sales/deals': DEALS,
  [`/sales/deals/${DEAL}`]: DEAL_DETAIL,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 2, open: { count: 2, value_cents: 750000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [{ label: 'New lead', count: 1, value_cents: 250000 }, { label: 'Proposal sent', count: 1, value_cents: 500000 }], ar: {} } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: past(1) }, { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com', phone: '', company: 'Beta', updated_at: past(2) }] },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};

const pinTable = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => { try { if (!localStorage.getItem('dds-display:pipeline')) localStorage.setItem('dds-display:pipeline', 'table'); } catch { /* denied */ } });

test.describe('Pipeline table view', () => {
  test('renders sortable columns; the Contact column joins names client-side', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#viewTable')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#table table')).toBeVisible();
    // columns per the spec
    for (const col of ['Deal', 'Contact', 'Stage', 'Value', 'Next step (due)', 'Last contacted']) {
      await expect(page.locator('#table thead')).toContainText(col);
    }
    // default sort: next-step due first (overdue on top), aria-sort set
    await expect(page.locator('#table th[aria-sort="ascending"]')).toContainText('Next step');
    await expect(page.locator('#table tbody tr').first()).toContainText('Acme website');
    // the contact name arrives from the cached /sales/contacts join
    await expect(page.locator('#table tbody tr').first()).toContainText('Sam Rivera');
    // overdue next step is highlighted; stage renders as the chip
    await expect(page.locator('#table .over').first()).toContainText('Due: Follow up call');
    await expect(page.locator('#table .stage').first()).toContainText('Proposal sent');
    // sorting flips: Deal column, ascending → Acme first; descending → Beta first
    await page.locator('[data-tsort="title"]').click();
    await expect(page.locator('#table th[aria-sort="ascending"]')).toContainText('Deal');
    await page.locator('[data-tsort="title"]').click();
    await expect(page.locator('#table th[aria-sort="descending"]')).toContainText('Deal');
    await expect(page.locator('#table tbody tr').first()).toContainText('Beta rebrand');
    // the summary strip and stage filter chips survive alongside the table
    await expect(page.locator('#summary')).toContainText('Open:');
    await expect(page.locator('#filters .chip').first()).toBeVisible();
  });

  test('the Contact column degrades to “—” when the contacts read fails — and the failure is not cached', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    // fail the join read: registered AFTER installApp so this route wins
    await page.route('**/functions/v1/presence/sales/contacts**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'plan-gated' }) }));
    await page.goto('/pipeline.html');
    await expect(page.locator('#table table')).toBeVisible();
    await expect(page.locator(`#table tr[data-id="${DEAL}"] td`).nth(1)).toHaveText('—');
    await expect(page.locator(`#table tr[data-id="${DEAL2}"] td`).nth(1)).toHaveText('—');
    // the failed read was NOT cached: heal the route — the next render retries
    await page.unroute('**/functions/v1/presence/sales/contacts**');
    await page.locator('[data-tsort="title"]').click();
    await expect(page.locator(`#table tr[data-id="${DEAL}"] td`).nth(1)).toHaveText('Sam Rivera');
    await expect(page.locator(`#table tr[data-id="${DEAL2}"] td`).nth(1)).toHaveText('Dana Lee');
  });

  test('a table row opens the full-screen deal drawer', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await page.locator(`#table tr[data-id="${DEAL}"]`).click();
    await expect(page.locator('#detailWrap')).toBeVisible();
    await expect(page.locator('#dtitle')).toContainText('Acme website');
    await expect(page.locator('#listWrap')).toBeHidden();
  });

  test('the 3-way display toggle persists in localStorage', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    // no stored choice → List (today's default), cards render
    await expect(page.locator('#viewList')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#list .card').first()).toBeVisible();
    await page.locator('#viewTable').click();
    await expect(page.locator('#table table')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dds-display:pipeline'))).toBe('table');
    await page.goto('/pipeline.html');                         // reload — the choice sticks
    await expect(page.locator('#viewTable')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#table table')).toBeVisible();
    // Board still works from the same control
    await page.locator('#viewBoard').click();
    await expect(page.locator('#board .col').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dds-display:pipeline'))).toBe('board');
  });
});

// ── SS5: pipeline to the roster standard — .lhead anatomy, soft ↻ refresh,
// client-side search across title/company/contact (caret-safe: the input is
// static; only the list re-renders). Money meta uses the page's money0.
test.describe('SS5 roster standard (.lhead + search + soft refresh)', () => {
  test('boots under the roster anatomy: .lhead, ONE h1, money meta — zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.lhead .obj-ic')).toBeVisible();
    // 2 deals, $5,000 + $2,500 expected value
    await expect(page.locator('.lhead .lmeta')).toContainText('2 deals · $7,500 total · Updated just now');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    await expect(page.locator('#dealSearch')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('↻ soft refresh keeps the last good list and toasts on failure — never the error screen', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(2);
    // now the network sours — the soft refresh must NOT wipe the list
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) }));
    await page.locator('#refreshBtn').click();
    await expect(page.locator('.dds-toast')).toContainText('Couldn’t refresh just now.');
    await expect(page.locator('#list .card')).toHaveCount(2);          // last good render kept
    await expect(page.locator('.dds-error')).toHaveCount(0);           // no error screen on soft
    // the network heals — the same button refreshes in place
    await page.unroute(/\/functions\/v1\/presence\/sales\/deals(\?|$)/);
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#list .card')).toHaveCount(2);
  });

  test('search filters by title, contact name, and company — the input keeps focus and caret', async ({ page }) => {
    const contacts = { data: [
      { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: past(1) },
      { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com', phone: '', company: 'Northwind', updated_at: past(2) },
    ] };
    await installApp(page, { api: { ...API, '/sales/contacts': contacts } });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(2);
    const s = page.locator('#dealSearch');
    // by title
    await s.pressSequentially('acme');
    await expect(page.locator('#list .card')).toHaveCount(1);
    await expect(page.locator('#list .card')).toContainText('Acme website');
    await expect(page.locator('.lhead .lmeta')).toContainText('1 deal · $5,000 total');
    // the input survived every list re-render: same element, focused, caret at the end
    await expect(s).toBeFocused();
    expect(await s.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(4);
    // by CONTACT name (client-side join)
    await s.fill('');
    await s.pressSequentially('dana');
    await expect(page.locator('#list .card')).toHaveCount(1);
    await expect(page.locator('#list .card')).toContainText('Beta rebrand');
    // by COMPANY (only the contact record knows "Northwind")
    await s.fill('northwind');
    await expect(page.locator('#list .card')).toHaveCount(1);
    await expect(page.locator('#list .card')).toContainText('Beta rebrand');
    // no match → the honest "no match" state, never the starter empty state
    await s.fill('zzz-nothing');
    await expect(page.locator('#list')).toContainText('No deals match that.');
    await expect(page.locator('#list')).not.toContainText('No deals yet');
    // clearing restores the roster
    await s.fill('');
    await expect(page.locator('#list .card')).toHaveCount(2);
  });

  test('mobile/tablet: the page body never scrolls horizontally — wide views scroll in their own containers', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch-viewport pin');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(2);
    const noOverflow = () => page.evaluate(() => {
      const d = document.scrollingElement!;
      return d.scrollWidth <= d.clientWidth + 1;
    });
    expect(await noOverflow()).toBe(true);
    await page.locator('#viewBoard').click();
    await expect(page.locator('#board .col').first()).toBeVisible();
    expect(await noOverflow()).toBe(true);   // the board scrolls inside .board-scroll, not the page
    await page.locator('#viewTable').click();
    await expect(page.locator('#table table')).toBeVisible();
    expect(await noOverflow()).toBe(true);   // the table scrolls inside .tscroll, not the page
  });

  test('search narrows the table and the board too', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#table tbody tr')).toHaveCount(2);
    await page.locator('#dealSearch').fill('beta');
    await expect(page.locator('#table tbody tr')).toHaveCount(1);
    await expect(page.locator('#table tbody tr')).toContainText('Beta rebrand');
    // board: the same query keeps filtering
    await page.locator('#viewBoard').click();
    await expect(page.locator('#board .col').first()).toBeVisible();
    await expect(page.locator('#board .bcard')).toHaveCount(1);
    await expect(page.locator('#board .bcard')).toContainText('Beta rebrand');
  });
});

// ── SS5: request-generation guards (REQ_SEQ/DET_SEQ) + honest boot retry.
test.describe('SS5 stale-race guards + boot retry', () => {
  test('a slow older roster response can never paint over a newer one (REQ_SEQ)', async ({ page }) => {
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => { releaseSlow = r; });
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, async (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage');
      if (stage === 'qualified') {          // the OLDER request — held until the newer one has rendered
        await slowGate;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEALS) });
    });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(2);
    await page.locator('#filters .chip[data-stage="qualified"]').click();   // starts the held request
    await page.locator('#filters .chip[data-stage=""]').click();           // newer request, resolves NOW
    await expect(page.locator('#list .card')).toHaveCount(2);
    releaseSlow();                                                          // stale empty arrives late…
    await page.waitForTimeout(150);
    await expect(page.locator('#list .card')).toHaveCount(2);               // …and is discarded, not painted
    await expect(page.locator('#list')).not.toContainText('Nothing in');
  });

  test('a slow older deal-detail response can never paint over a newer drawer (DET_SEQ)', async ({ page }) => {
    const DETAIL2 = JSON.parse(JSON.stringify(DEAL_DETAIL));
    DETAIL2.data.deal = { ...DETAIL2.data.deal, id: DEAL2, title: 'Beta rebrand', stage: 'lead' };
    DETAIL2.data.contact = { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com', phone: '', company: 'Beta', notes: '' };
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => { releaseSlow = r; });
    await installApp(page, { api: { ...API, [`/sales/deals/${DEAL2}`]: DETAIL2, [`/sales/deals/${DEAL2}/tasks`]: { data: [] } } });
    await page.route(new RegExp(`/functions/v1/presence/sales/deals/${DEAL}(\\?|$)`), async (route) => {
      await slowGate;                        // the FIRST deal opened — its read hangs
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEAL_DETAIL) });
    });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(2);
    // open the hung deal, then the other one — the second render must win
    await page.evaluate((id) => { (window as any).openDeal(id); return 0; }, DEAL);   // fire-and-forget: this read hangs
    await page.evaluate((id) => { (window as any).openDeal(id); return 0; }, DEAL2);
    await expect(page.locator('#dtitle')).toContainText('Beta rebrand');
    releaseSlow();                                                          // the stale Acme response lands late…
    await page.waitForTimeout(150);
    await expect(page.locator('#dtitle')).toContainText('Beta rebrand');    // …and is discarded
  });

  test('a failed boot renders honest trouble with a Try again that recovers in place', async ({ page }) => {
    await installApp(page, { api: API });
    // a supabase stub whose getSession fails until the test heals it
    await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route) =>
      route.fulfill({ contentType: 'application/javascript', body: `
        window.supabase = { createClient: function(){ return { auth: {
          getSession: async function(){ if (!window.__HEALED) throw new Error('boom'); return { data: { session: window.__E2E_SESSION || null } }; },
          getUser: async function(){ return { data: { user: (window.__E2E_SESSION||{}).user || null } }; },
          onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
          signOut: async function(){ return { error: null }; },
        } }; } };` }));
    await page.goto('/pipeline.html');
    await expect(page.locator('#list')).toContainText('We couldn’t load your pipeline just now.');
    const retry = page.locator('#list .retry');
    await expect(retry).toContainText('Try again');
    await page.evaluate(() => { (window as any).__HEALED = 1; });
    await retry.click();                                                    // recovers IN PLACE — no navigation
    await expect(page.locator('#list .card')).toHaveCount(2);
    await expect(page.locator('.lhead .lmeta')).toContainText('2 deals');
  });
});

// ── SS5: board affordances — the .bc-move popup's full keyboard contract and
// the tablist-shaped rows downgraded to what they are (role=group + pressed).
const pinBoard = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => { try { if (!localStorage.getItem('dds-display:pipeline')) localStorage.setItem('dds-display:pipeline', 'board'); } catch { /* denied */ } });

test.describe('SS5 board popup contract + group semantics', () => {
  test('the Move menu: opens focused, arrows walk it, Escape closes back to the invoker, outside click dismisses', async ({ page }) => {
    await pinBoard(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const move = page.locator(`#board .bcard[data-id="${DEAL}"] .bc-move`);
    await move.click();
    const menu = page.locator('#board .bc-menu');
    await expect(menu).toBeVisible();
    await expect(move).toHaveAttribute('aria-expanded', 'true');
    // opening moves focus INTO the menu (keyboard users aren't stranded)
    const items = menu.locator('button');
    await expect(items.first()).toBeFocused();
    // arrows walk the options
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.first()).toBeFocused();
    // Escape closes and RETURNS focus to the invoker
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(move).toHaveAttribute('aria-expanded', 'false');
    await expect(move).toBeFocused();
    // outside click also dismisses (and resets the expanded state)
    await move.click();
    await expect(page.locator('#board .bc-menu')).toBeVisible();
    await page.locator('h1').click();
    await expect(page.locator('#board .bc-menu')).toHaveCount(0);
    await expect(move).toHaveAttribute('aria-expanded', 'false');
  });

  test('Move popup touch targets meet the 44px floor', async ({ page }) => {
    await pinBoard(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const move = page.locator(`#board .bcard[data-id="${DEAL}"] .bc-move`);
    const mb = await move.boundingBox();
    expect(mb && mb.height).toBeGreaterThanOrEqual(44);
    await move.click();
    for (const it of await page.locator('#board .bc-menu button').all()) {
      const b = await it.boundingBox();
      expect(b && b.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('the filter row and the view toggle are role=group with aria-pressed — no fake tablists', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(2);
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);
    await expect(page.locator('#filters')).toHaveAttribute('role', 'group');
    await expect(page.locator('.viewtog')).toHaveAttribute('role', 'group');
    await expect(page.locator('#viewList')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#viewTable')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#viewTable').click();
    await expect(page.locator('#viewTable')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#viewList')).toHaveAttribute('aria-pressed', 'false');
    // filter chips carry pressed-state too
    await expect(page.locator('#filters .chip[data-stage=""]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#filters .chip[data-stage="lead"]').click();
    await expect(page.locator('#filters .chip[data-stage="lead"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#filters .chip[data-stage=""]')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ── SS5 item 4 (D1, pipeline half): a linkable ?stage= landing. The board hides
// won/lost, so analytics' "View won deals" needs a URL that provably renders
// them: ?stage=won lands in List with the Won chip pressed and values showing.
test.describe('SS5 ?stage=won landing (D1)', () => {
  const WON = '33333333-3333-4333-8333-333333333333';
  const WON_DEALS = { data: [
    { id: WON, title: 'Gamma launch', stage: 'won', source: 'manual', expected_value_cents: 999000, expected_close: null, contact_id: 'ct-1', converted_client_id: 'cl-9', updated_at: past(4), next_step: null, next_step_at: null, last_contacted_at: past(9), agreement_signed: true },
  ] };

  test('?stage=won renders the won List view: chip pressed, values + Won ✓ badges, stage sent to the API', async ({ page }) => {
    let sentStage = '';
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage') || '';
      if (stage) sentStage = stage;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stage === 'won' ? WON_DEALS : DEALS) });
    });
    await page.goto('/pipeline.html?stage=won');
    await expect(page.locator('#viewList')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#filters .chip[data-stage="won"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#list .card')).toHaveCount(1);
    await expect(page.locator('#list .card .stage.won')).toContainText('Won ✓');
    await expect(page.locator('#list .card .val')).toContainText('$9,990');
    await expect(page.locator('.lhead .lmeta')).toContainText('1 deal · $9,990 total');
    expect(sentStage).toBe('won');
  });

  test('an empty won view is honest — never the "add your first deal" starter', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage') || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stage === 'won' ? { data: [] } : DEALS) });
    });
    await page.goto('/pipeline.html?stage=won');
    await expect(page.locator('#list')).toContainText('No won deals yet');
    await expect(page.locator('#list')).toContainText('Deals you win show up here with their values.');
    await expect(page.locator('#list')).not.toContainText('No deals yet');
  });

  test('a persisted Board choice yields to the ?stage= landing without being overwritten', async ({ page }) => {
    await pinBoard(page);
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, (route) => {
      const stage = new URL(route.request().url()).searchParams.get('stage') || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stage === 'won' ? WON_DEALS : DEALS) });
    });
    await page.goto('/pipeline.html?stage=won');
    await expect(page.locator('#list .card')).toHaveCount(1);           // List rendered, not the board
    await expect(page.locator('#board')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('dds-display:pipeline'))).toBe('board');   // choice untouched
  });

  test('chip clicks keep the URL linkable, and closing a deal restores it', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await page.locator('#filters .chip[data-stage="proposal"]').click();
    await expect(page).toHaveURL(/\?stage=proposal$/);
    await page.locator(`#list [data-id="${DEAL}"]`).click();
    await expect(page.locator('#dtitle')).toContainText('Acme website');
    await page.locator('#closeD').click();
    await expect(page).toHaveURL(/\?stage=proposal$/);                  // the filter survives the round-trip
    await expect(page.locator('#filters .chip[data-stage="proposal"]')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ── SS5 honest .lmeta math: the roster read asks for the server's real page cap
// (MAX_PAGE=100 — not the 25-row DEFAULT_PAGE the old bare read got clamped to),
// and when a FULL page comes back the meta stops claiming a "total" it can't
// prove (the server may hold more rows). Below the cap the exact complete-set
// wording is already pinned above (:133, :169, :387).
test.describe('SS5 honest meta (fetch cap + at-cap wording)', () => {
  test('the roster read requests limit=100, and a full page drops the "total" claim', async ({ page }) => {
    let dealsUrl = '';
    // 100 rows = exactly the server cap; one fractional value pins money0's cents pair
    const capped = { data: Array.from({ length: 100 }, (_, i) => ({
      id: `dd-${String(i).padStart(3, '0')}`, title: `Deal ${i}`, stage: 'lead', source: 'manual',
      expected_value_cents: i === 0 ? 100050 : 100000, expected_close: null, contact_id: null,
      converted_client_id: null, updated_at: past(1), next_step: null, next_step_at: null,
      last_contacted_at: null, agreement_signed: false })) };
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, (route) => {
      dealsUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capped) });
    });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(100);
    // (a) the read asked for the server's MAX_PAGE — not the 25-row default
    expect(new URL(dealsUrl).searchParams.get('limit')).toBe('100');
    // (b) at the cap the meta scopes itself to what it actually has — never "total"
    //     99 × $1,000 + one $1,000.50 = $100,000.50 (the cents pair, never "$….5")
    await expect(page.locator('.lhead .lmeta')).toContainText('Latest 100 deals · $100,000.50');
    await expect(page.locator('.lhead .lmeta')).not.toContainText('total');
    // a search over a capped page stays scoped too ("N of the latest 100")
    await page.locator('#dealSearch').fill('Deal 1');   // Deal 1, Deal 10…19 → 11 matches
    await expect(page.locator('#list .card')).toHaveCount(11);
    await expect(page.locator('.lhead .lmeta')).toContainText('11 of the latest 100 deals · $11,000');
    await expect(page.locator('.lhead .lmeta')).not.toContainText('total');
  });

  // SS5 item 2: the Board renders ONLY open, unconverted deals — so in Board
  // view the meta must count and sum exactly those cards ("$X open", the sweep's
  // wording), never the won/lost rows the board deliberately hides. The
  // board-foot keeps explaining where the rest live; List restores the
  // full-fetched-set meta.
  test('Board view: the meta counts only the rendered open cards — "$X open"', async ({ page }) => {
    const mixed = { data: [
      ...DEALS.data,   // proposal $5,000 + lead $2,500 — the two open cards
      { id: '55555555-5555-4555-8555-555555555555', title: 'Gamma launch', stage: 'won', source: 'manual', expected_value_cents: 999000, expected_close: null, contact_id: 'ct-1', converted_client_id: 'cl-9', updated_at: past(4), next_step: null, next_step_at: null, last_contacted_at: past(9), agreement_signed: true },
      { id: '66666666-6666-4666-8666-666666666666', title: 'Delta site', stage: 'lost', source: 'manual', expected_value_cents: 100000, expected_close: null, contact_id: 'ct-2', converted_client_id: null, updated_at: past(5), next_step: null, next_step_at: null, last_contacted_at: past(20), agreement_signed: false },
    ] };
    await pinBoard(page);
    await installApp(page, { api: { ...API, '/sales/deals': mixed } });
    await page.goto('/pipeline.html');
    await expect(page.locator('#board .bcard')).toHaveCount(2);
    // the meta reflects what the board shows: 2 open cards, $5,000 + $2,500
    await expect(page.locator('.lhead .lmeta')).toContainText('2 open deals · $7,500 open');
    await expect(page.locator('.lhead .lmeta')).not.toContainText('total');
    // the board-foot still explains the hidden outcomes
    await expect(page.locator('.board-foot')).toContainText('2 won or closed deals — see them in List view.');
    // switching to List restores the full-fetched-set semantics (item 1)
    await page.locator('#viewList').click();
    await expect(page.locator('#list .card')).toHaveCount(4);
    await expect(page.locator('.lhead .lmeta')).toContainText('4 deals · $18,490 total');
  });

  // SS5 item 3: creating a deal with a NEW contact invalidated only the Table's
  // CONTACT_NAME join — the search index (CONTACT_TEXT) kept the stale set, so
  // searching the new contact's company found nothing until a full reload.
  test('after creating a deal with a new contact, searching that company finds the deal', async ({ page }) => {
    const DEAL3 = '44444444-4444-4444-8444-444444444444';
    const NEWDEAL = { id: DEAL3, title: 'Gamma site', stage: 'lead', source: 'manual', expected_value_cents: 0, expected_close: null, contact_id: 'ct-3', converted_client_id: null, updated_at: past(0), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false };
    const DETAIL3 = { data: {
      deal: { id: DEAL3, title: 'Gamma site', stage: 'lead', expected_value_cents: 0, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-3', converted_client_id: null, retainer: null },
      contact: { id: 'ct-3', name: 'Pat Field', email: 'pat@newco.com', phone: '', company: 'Newco', notes: '' },
      proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
    } };
    await installApp(page, { api: { ...API, [`/sales/deals/${DEAL3}`]: DETAIL3, [`/sales/deals/${DEAL3}/tasks`]: { data: [] } } });
    let created = false;   // flips when the new contact is POSTed — the fixtures grow with it
    await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?|$)/, (route) => {
      if (route.request().method() === 'POST') {
        created = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-3' } }) });
      }
      const base = [
        { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: past(1) },
        { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com', phone: '', company: 'Beta', updated_at: past(2) },
      ];
      const contacts = created ? [{ id: 'ct-3', name: 'Pat Field', email: 'pat@newco.com', phone: '', company: 'Newco', updated_at: past(0) }, ...base] : base;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: contacts }) });
    });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?|$)/, (route) => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: DEAL3 } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created ? { data: [NEWDEAL, ...DEALS.data] } : DEALS) });
    });
    await page.goto('/pipeline.html');
    await expect(page.locator('#list .card')).toHaveCount(2);
    // prime the contact-search cache with the OLD contact set
    const s = page.locator('#dealSearch');
    await s.fill('acme');
    await expect(page.locator('#list .card')).toHaveCount(1);
    await s.fill('');
    await expect(page.locator('#list .card')).toHaveCount(2);
    // create a deal with a brand-new contact at a brand-new company
    await page.locator('#newDeal').click();
    await page.locator('#f-title').fill('Gamma site');
    await page.locator('#f-email').fill('pat@newco.com');
    await page.locator('#f-name').fill('Pat Field');
    await page.locator('#dealForm button[type="submit"]').click();
    await expect(page.locator('#dtitle')).toContainText('Gamma site');   // lands straight in the new deal
    await page.locator('#closeD').click();
    await expect(page.locator('#list .card')).toHaveCount(3);
    // the company search must find the new deal — the search cache was invalidated too
    await s.fill('newco');
    await expect(page.locator('#list .card')).toHaveCount(1);
    await expect(page.locator('#list .card')).toContainText('Gamma site');
    await expect(page.locator('#list')).not.toContainText('No deals match that.');
  });

  // SS5 item 4: the contacts join asked for limit=500, but the server's
  // clampLimit caps every read at MAX_PAGE=100 — code must never claim a
  // capacity the server refuses. Pin the honest request.
  test('the contacts-name join requests the 100 the server actually grants — never 500', async ({ page }) => {
    let contactsUrl = '';
    await pinTable(page);
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?|$)/, (route) => {
      contactsUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(API['/sales/contacts']) });
    });
    await page.goto('/pipeline.html');
    await expect(page.locator(`#table tr[data-id="${DEAL}"] td`).nth(1)).toHaveText('Sam Rivera');
    expect(new URL(contactsUrl).searchParams.get('limit')).toBe('100');
  });
});

// ── SS5 polish: tab-out closes the Move menu (no zombie aria-expanded), and an
// OPEN-stage ?stage= landing respects a persisted Board choice — only won/lost
// (the outcomes the board can't show) force the List view.
test.describe('SS5 polish (menu focusout + open-stage landings)', () => {
  test('tabbing out of the Move menu closes it and resets aria-expanded', async ({ page }) => {
    await pinBoard(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const move = page.locator(`#board .bcard[data-id="${DEAL}"] .bc-move`);
    await move.click();
    const items = page.locator('#board .bc-menu button');
    await expect(items.first()).toBeFocused();
    // walk to the last option (proposal → contract · qualified · lost), then Tab OUT
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#board .bc-menu')).toHaveCount(0);
    await expect(move).toHaveAttribute('aria-expanded', 'false');
  });

  test('?stage=<open stage> keeps a persisted Board choice — only won/lost force List', async ({ page }) => {
    await pinBoard(page);
    await installApp(page, { api: API });
    await page.goto('/pipeline.html?stage=proposal');
    await expect(page.locator('#board .col').first()).toBeVisible();   // the board survives
    await expect(page.locator('#list .card')).toHaveCount(0);
    // switching to List applies the carried filter: the Proposal chip is pressed
    await page.locator('#viewList').click();
    await expect(page.locator('#filters .chip[data-stage="proposal"]')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Deal drawer Path', () => {
  test('the Path chevron bar renders with guidance tip AND action (suggested_action fix)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await expect(page.locator('#detailWrap')).toBeVisible();
    // four chevron steps: done ✓ · current · todo
    await expect(page.locator('#pathHost .pstep')).toHaveCount(4);
    await expect(page.locator('#pathHost .pstep.done')).toHaveCount(2);        // lead + qualified
    await expect(page.locator('#pathHost .pstep.current')).toContainText('Proposal sent');
    await expect(page.locator('#pathHost .pstep.done').first()).toContainText('✓');
    // ONLY the current step and the one legal back-target are interactive
    await expect(page.locator('#pathHost .pstep[aria-disabled="true"]')).toHaveCount(2); // lead (not a legal back-move) + contract (todo)
    await expect(page.locator('#pathHost .pstep.canback')).toHaveCount(1);     // qualified — the one BOARD_NEXT back-target
    // the guidance strip renders BOTH halves — the g.suggested_action bug is dead
    const guide = page.locator('#pathHost .path-guide');
    await expect(guide).toContainText('Your proposal is with them — a gentle nudge often seals it.');   // tip
    await expect(guide).toContainText('Follow up, then send the agreement once they say yes');          // action
    // forward is the brand "Mark Stage as Complete" button
    await expect(page.locator('#markComplete')).toContainText('Mark Stage as Complete');
    // "Mark as lost" stays the separate quiet action, outside the Path
    await expect(page.locator('#markLost')).toContainText('Mark as lost');
  });

  test('the current chevron toggles the guidance; the back-target asks before moving', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await expect(page.locator('#pathHost .path-guide')).toBeVisible();
    await page.locator('#pathHost .pstep.current').click();                    // toggle guidance off
    await expect(page.locator('#pathHost .path-guide')).toHaveCount(0);
    await page.locator('#pathHost .pstep.current').click();                    // and back on
    await expect(page.locator('#pathHost .path-guide')).toBeVisible();
    await page.locator('#pathHost .pstep.canback').click();                    // one-back needs a confirm
    await expect(page.locator('#pathHost .path-confirm')).toContainText('Move this deal back to');
    await page.locator('#backNo').click();
    await expect(page.locator('#pathHost .path-confirm')).toHaveCount(0);
  });

  test('Mark Stage as Complete advances via the existing stage POST', async ({ page }) => {
    let stagePost = '';
    await installApp(page, { api: API });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/stage`, async (route) => {
      stagePost = route.request().postData() || '';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await page.locator('#markComplete').click();
    await expect(page.locator('.dds-toast')).toContainText('Moved to Agreement out');
    expect(JSON.parse(stagePost)).toEqual({ to: 'contract' });
  });

  test('embed mode still renders the drawer + Path with the list hidden', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto(`/pipeline.html?deal=${DEAL}&embed=1`);
    await expect(page.locator('#detailWrap')).toBeVisible();
    await expect(page.locator('#pathHost .pstep')).toHaveCount(4);
    await expect(page.locator('#listWrap')).toBeHidden();                      // html.dds-embed hides the list side
    await expect(page.locator('.backbar')).toBeHidden();                       // and the backbar
  });
});

// ── CRM deal page (ask 2): the deal's CONTACT is editable ────────────────────
// The real bug: a deal created with neither a name nor an email had contact_id
// null forever, so emailSalesDoc always returned false and contracts/proposals/
// invoices could never send themselves — with no way to fix it from the deal.
const DEAL3 = '33333333-3333-4333-8333-333333333333';
const CONTACTLESS = { data: {
  deal: { id: DEAL3, title: 'Nameless enquiry', stage: 'contract', expected_value_cents: 380000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: null, converted_client_id: null, retainer: null },
  contact: null,
  proposals: [], contracts: [{ id: 'k-1', title: 'Service agreement', status: 'draft', body: 'A complete agreement with no blanks left in it.', signer_name: null, signed_at: null, version: 1, terms_snapshot: null }],
  events: [], timeline: [], invoices: [], last_contacted_at: null,
} };
const CONTACT_API = { ...API, [`/sales/deals/${DEAL3}`]: CONTACTLESS, [`/sales/deals/${DEAL3}/tasks`]: { data: [] } };

test.describe('deal page — Contact block (ask 2)', () => {
  test('renders pre-filled for a deal that HAS a contact, and Save patches that contact', async ({ page }) => {
    let patched: { url: string; body: string } | null = null;
    await installApp(page, { api: CONTACT_API });
    await page.route('**/functions/v1/presence/sales/contacts/**', async (route) => {
      patched = { url: route.request().url(), body: route.request().postData() || '' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-1' } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    // pre-filled from data.contact — no hunting to crm.html to edit it
    await expect(page.locator('#ed-cname')).toHaveValue('Sam Rivera');
    await expect(page.locator('#ed-cemail')).toHaveValue('sam@example.com');
    await expect(page.locator('#ed-cphone')).toHaveValue('');
    await expect(page.locator('#ed-cnote')).toContainText('email themselves');
    await page.locator('#ed-cphone').fill('555-0101');
    await page.locator('#ed-save').click();
    await expect(page.locator('.dds-toast')).toContainText('Saved');
    expect(patched!.url).toContain('/sales/contacts/ct-1');
    expect(JSON.parse(patched!.body)).toEqual({ name: 'Sam Rivera', email: 'sam@example.com', phone: '555-0101' });
  });

  test('a CONTACTLESS deal gains a contact: create, then link it to the deal', async ({ page }) => {
    const calls: Array<{ path: string; method: string; body: string }> = [];
    await installApp(page, { api: CONTACT_API });
    await page.route('**/functions/v1/presence/sales/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      const method = route.request().method();
      if (method !== 'GET') {
        calls.push({ path, method, body: route.request().postData() || '' });
        if (path === '/sales/contacts') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-new', name: 'Jo Vance', email: 'jo@example.com' } }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
      }
      return route.fallback();
    });
    await page.goto(`/pipeline.html?deal=${DEAL3}`);
    await expect(page.locator('#ed-cname')).toHaveValue('');
    await expect(page.locator('#ed-cnote')).toContainText('Add their email');
    await page.locator('#ed-cname').fill('Jo Vance');
    await page.locator('#ed-cemail').fill('jo@example.com');
    await page.locator('#ed-save').click();
    await expect(page.locator('.dds-toast')).toContainText('Saved');
    // two steps, in order: create the contact, then LINK it via the deal PATCH
    const create = calls.find((c) => c.path === '/sales/contacts' && c.method === 'POST');
    const link = calls.find((c) => c.path === `/sales/deals/${DEAL3}` && c.method === 'PATCH' && c.body.includes('contact_id'));
    expect(create).toBeTruthy();
    expect(JSON.parse(create!.body)).toMatchObject({ name: 'Jo Vance', email: 'jo@example.com' });
    expect(link).toBeTruthy();
    expect(JSON.parse(link!.body).contact_id).toBe('ct-new');
    expect(calls.indexOf(create!)).toBeLessThan(calls.indexOf(link!));
  });

  // Saving a contactless deal is TWO calls — create the contact, then link it.
  // If the link fails, the contact already exists; a plain retry used to POST a
  // second one. Server dedupe keys on (site, email) only, so an email-bearing
  // contact self-heals but a NAME-ONLY contact duplicated on every retry.
  test('a failed LINK doesn’t leave a duplicate contact behind on retry', async ({ page }) => {
    const creates: string[] = [];
    let linkFails = true;
    await installApp(page, { api: CONTACT_API });
    await page.route('**/functions/v1/presence/sales/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      const method = route.request().method();
      if (method === 'GET') return route.fallback();
      if (path === '/sales/contacts' && method === 'POST') {
        creates.push(route.request().postData() || '');
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-new', name: 'Jo Vance' } }) });
      }
      if (path === `/sales/deals/${DEAL3}` && method === 'PATCH' && (route.request().postData() || '').includes('contact_id')) {
        if (linkFails) { linkFails = false; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'That didn’t go through.' }) }); }
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL3}`);
    await page.locator('#ed-cname').fill('Jo Vance');            // NAME ONLY — no email to dedupe on
    await page.locator('#ed-save').click();
    await expect(page.locator('.dds-toast').last()).toContainText('didn’t go through');
    expect(creates).toHaveLength(1);
    // retry the identical save — the contact from the first attempt is REUSED
    await page.locator('#ed-save').click();
    await expect(page.locator('.dds-toast').last()).toContainText('Saved');
    expect(creates).toHaveLength(1);
  });

  // The server's (site, email) dedupe hands back SOMEBODY ELSE's contact row and
  // links it — discarding the name and phone that were just typed. The edit path
  // already refuses this with a 409; the create path must at least say so.
  test('an email that already belongs to someone else says whose — never a silent swap', async ({ page }) => {
    await installApp(page, { api: CONTACT_API });
    await page.route('**/functions/v1/presence/sales/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      if (route.request().method() === 'GET') return route.fallback();
      if (path === '/sales/contacts') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com', phone: '555-0000' }, deduped: true }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL3}`);
    await page.locator('#ed-cname').fill('Jo Vance');
    await page.locator('#ed-cemail').fill('dana@example.com');   // already Dana Lee's
    await page.locator('#ed-save').click();
    const toast = page.locator('.dds-toast').last();
    await expect(toast).toContainText('dana@example.com');
    await expect(toast).toContainText('Dana Lee');
    await expect(toast).toContainText('Jo Vance');               // …and that the typed name was NOT kept
  });

  test('a phone with no name or email is refused with a plain reason (never a silent no-op)', async ({ page }) => {
    await installApp(page, { api: CONTACT_API });
    await page.goto(`/pipeline.html?deal=${DEAL3}`);
    await page.locator('#ed-cphone').fill('555-0199');
    await page.locator('#ed-save').click();
    await expect(page.locator('.dds-toast')).toContainText('needs a name or an email');
  });

  test('sending with NO client email says exactly why, and points at the fix', async ({ page }) => {
    await installApp(page, { api: CONTACT_API });
    await page.route(`**/functions/v1/presence/sales/contracts/k-1/send`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://example.test/sign/abc', emailed: false }) }));
    await page.goto(`/pipeline.html?deal=${DEAL3}`);
    await page.locator('[data-send-contract="k-1"]').first().click();
    const toast = page.locator('.dds-toast');
    await expect(toast).toContainText('there’s no client email on this deal, so nothing was sent');
    await expect(toast).toContainText('Add their email in Details');
  });
});

// ── CRM deal page (ask 3): the to-do box knows what stage the deal is at ─────
test.describe('deal page — stage-aware to-do presets (ask 3)', () => {
  test('the dropdown offers THIS stage’s to-dos and fills the still-editable input', async ({ page }) => {
    let posted = '';
    await installApp(page, { api: API });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/tasks`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted = route.request().postData() || '';
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'tk-1' } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL}`);                            // DEAL is at stage 'proposal'
    const pick = page.locator('#dt-preset');
    await expect(pick).toBeVisible();
    await expect(pick.locator('option')).toContainText([
      'Pick a to-do for this stage…', 'Follow up on the proposal', 'Answer their questions', 'Send the agreement once they say yes', 'Something else…',
    ]);
    // picking a preset FILLS the input — it does not post on its own
    await pick.selectOption({ label: 'Follow up on the proposal' });
    await expect(page.locator('#dt-title')).toHaveValue('Follow up on the proposal');
    expect(posted).toBe('');
    // …and it stays editable before Add
    await page.locator('#dt-title').fill('Follow up on the proposal — call, not email');
    await page.locator('#dt-add').click();
    await expect.poll(() => posted).not.toBe('');
    expect(JSON.parse(posted).title).toBe('Follow up on the proposal — call, not email');
    // "Something else…" hands back to a blank free-text box
    await pick.selectOption('__custom__');
    await expect(page.locator('#dt-title')).toHaveValue('');
  });

  test('a lead-stage deal is offered the LEAD to-dos, not the proposal ones', async ({ page }) => {
    const LEAD_DETAIL = { data: { ...DEAL_DETAIL.data, deal: { ...DEAL_DETAIL.data.deal, id: DEAL2, stage: 'lead' } } };
    await installApp(page, { api: { ...API, [`/sales/deals/${DEAL2}`]: LEAD_DETAIL, [`/sales/deals/${DEAL2}/tasks`]: { data: [] } } });
    await page.goto(`/pipeline.html?deal=${DEAL2}`);
    await expect(page.locator('#dt-preset option')).toContainText(['Pick a to-do for this stage…', 'Call them', 'Send an intro email', 'Book a discovery call', 'Look at their current site', 'Something else…']);
  });
});

// ── CRM deal page (ask 1): the services catalog seeds itself ─────────────────
// The proposal line-item DROPDOWN already existed — it was hidden only because
// the catalog was empty (hasCat false). NOTE: the shared API fixture stubs
// '/sales/services' as { data: [] }, which now renders the starter rows; that is
// deliberate and is exactly what these cases assert.
const STARTER = [
  ['Website — Template build', '1500'],
  ['Website — Custom + Photography', '3800'],
  ['Growth Partnership (monthly)', '400'],
  ['Site audit — Starter Audit', '99'],
  ['Site audit — Digital Health Check', '499'],
  ['Site audit — Competitive Intelligence', '899'],
] as const;

test.describe('services catalog — starter list (ask 1)', () => {
  test('“Manage services” is reachable from the page toolbar, not just inside a deal', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#mngServicesTop')).toBeVisible();
    await page.locator('#mngServicesTop').click();
    await expect(page.locator('#svcDlg')).toBeVisible();
  });

  test('an EMPTY catalog opens pre-filled with the studio’s own prices — and writes nothing until Save', async ({ page }) => {
    let puts = 0;
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/sales/services', async (route) => {
      if (route.request().method() === 'PUT') { puts++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
    await page.goto('/pipeline.html');
    await page.locator('#mngServicesTop').click();
    await expect(page.locator('#svcStarterNote')).toContainText('Starting points from your pricing page');
    await expect(page.locator('#svcRows .svc-row')).toHaveCount(STARTER.length);
    for (const [i, [name, price]] of STARTER.entries()) {
      await expect(page.locator('#svcRows .svc-row').nth(i).locator('.svc-name')).toHaveValue(name);
      await expect(page.locator('#svcRows .svc-row').nth(i).locator('.svc-price')).toHaveValue(price);
    }
    // merely LOOKING at them persists nothing
    expect(puts).toBe(0);
    await page.locator('#svcCancel').click();
    expect(puts).toBe(0);
  });

  test('the starter rows are editable and deletable, and Save sends exactly what’s on screen', async ({ page }) => {
    let body = '';
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/sales/services', async (route) => {
      if (route.request().method() === 'PUT') { body = route.request().postData() || ''; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
    await page.goto('/pipeline.html');
    await page.locator('#mngServicesTop').click();
    await page.locator('#svcRows .svc-row').nth(0).locator('.svc-price').fill('1750');   // his price, not ours
    await page.locator('#svcRows .svc-row').nth(5).locator('.svc-del').click();          // drop one he doesn't sell
    await page.locator('#svcSave').click();
    await expect.poll(() => body).not.toBe('');
    const sent = JSON.parse(body).services;
    expect(sent).toHaveLength(5);
    expect(sent[0]).toEqual({ name: 'Website — Template build', price_cents: 175000 });
    expect(sent[2]).toEqual({ name: 'Growth Partnership (monthly)', price_cents: 40000 });
    expect(sent.some((s: { name: string }) => s.name.includes('Competitive Intelligence'))).toBe(false);
  });

  test('a catalog that already has services is shown as-is — no starter note, no seeding', async ({ page }) => {
    await installApp(page, { api: { ...API, '/sales/services': { data: [{ name: 'Logo refresh', price_cents: 60000 }] } } });
    await page.goto('/pipeline.html');
    await page.locator('#mngServicesTop').click();
    await expect(page.locator('#svcRows .svc-row')).toHaveCount(1);
    await expect(page.locator('#svcRows .svc-name').first()).toHaveValue('Logo refresh');
    await expect(page.locator('#svcStarterNote')).toHaveCount(0);
  });

  // The editor no longer opens on one blank row, so a late autofocus is a real
  // input bug, not a test flake: an operator with six pre-filled rows in front of
  // them clicks a PRICE, starts typing, and a focus() firing 20ms after the paint
  // redirects those keystrokes into the first name field ("1750Website — …").
  test('a PRE-FILLED editor never steals the caret — the operator’s first click wins', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/sales/services', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
    await page.goto('/pipeline.html');
    await page.locator('#mngServicesTop').click();
    await expect(page.locator('#svcRows .svc-row').first()).toBeVisible();
    await page.waitForTimeout(200);                                   // well past the old 20ms focus()
    // nothing inside the seeded editor may have grabbed the caret
    await expect(page.locator('#svcRows .svc-name').first()).not.toBeFocused();
    // …so a click on a price owns it, and the keystrokes land in the price
    const price = page.locator('#svcRows .svc-row').nth(0).locator('.svc-price');
    await price.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('1750');
    await expect(page.locator('#svcRows .svc-row').nth(0).locator('.svc-name')).toHaveValue(STARTER[0][0]);
    await expect(price).toHaveValue('1750');
  });

  // …but a genuinely blank row is still one keystroke away from typing: an
  // editor that opens on a nameless row takes the caret straight away.
  test('an editor that opens BLANK still takes the caret', async ({ page }) => {
    await installApp(page, { api: { ...API, '/sales/services': { data: [{ name: '', price_cents: 0 }] } } });
    await page.goto('/pipeline.html');
    await page.locator('#mngServicesTop').click();
    await expect(page.locator('#svcRows .svc-row')).toHaveCount(1);
    await expect(page.locator('#svcRows .svc-name').first()).toHaveValue('');
    await expect(page.locator('#svcRows .svc-name').first()).toBeFocused();
  });

  test('"Add a service" focuses the row it just added', async ({ page }) => {
    await installApp(page, { api: { ...API, '/sales/services': { data: [{ name: 'Logo refresh', price_cents: 60000 }] } } });
    await page.goto('/pipeline.html');
    await page.locator('#mngServicesTop').click();
    await expect(page.locator('#svcRows .svc-row')).toHaveCount(1);
    await page.locator('#svcAdd').click();
    await expect(page.locator('#svcRows .svc-name').nth(1)).toBeFocused();
  });
});

// ── CRM deal page (ask 4): the studio's real agreement is the default ────────
test.describe('agreement form — the studio’s standard contract (ask 4)', () => {
  test('an empty agreement form opens with the real 19-section agreement, placeholders FILLED', async ({ page }) => {
    await installApp(page, { api: API });                                      // '/sales/templates': { data: [] } → no saved templates
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await page.locator('#addCon').click();
    const body = page.locator('#conForm textarea');
    await expect(body).toBeVisible();
    await expect.poll(async () => (await body.inputValue()).length, { timeout: 7000 }).toBeGreaterThan(10000);
    const text = await body.inputValue();
    expect(text).toContain('Project Agreement & Scope of Work');
    expect(text).toContain('19. ENTIRE AGREEMENT');
    expect(text).not.toContain('SAMPLE');
    // the placeholders are RESOLVED — a client must never receive a raw token
    expect(text).not.toMatch(/\{\{/);
    expect(text).toContain('Test Studio');                                     // {{studio_name}} ← /identity
    // ONE legal seller, everywhere: this tenant is "Test Studio", so the
    // letterhead, the operative parties clause and the signature block must all
    // name THEM — a contract that binds a company the client never dealt with is
    // not a contract they can sign.
    expect(text.split('\n')[0]).toBe('TEST STUDIO');                           // letterhead ← {{studio_name_upper}}
    expect(text).toContain('entered into between Test Studio ("Studio")');     // the operative parties clause
    expect(text).toMatch(/\nTest Studio +\[Client Name \/ Title\]/);           // the signature block
    expect(text).not.toMatch(/Davis Digital Studio/i);                         // …and never anyone else's name
    expect(text).not.toContain('Eric Davis');                                  // nor anyone else's PERSON
    expect(text).toContain('Acme');                                            // {{client_company}} ← the contact
    expect(text).toContain('Acme website');                                    // {{deal_title}}
    expect(text).toContain('$5,000');                                          // {{deal_value}}
    expect(text).toContain('$2,500');                                          // 50/50 deposit + balance
    // the title is prefilled too, and everything stays editable
    await expect(page.locator('#conForm input').first()).toHaveValue('Service agreement — Sam Rivera');
    await expect(body).toBeEditable();
  });

  test('a SAVED agreement template wins over the built-in default', async ({ page }) => {
    const saved = { data: [{ id: 'tpl-1', kind: 'contract', name: 'My agreement', title: 'My agreement', line_items: [], updated_at: past(1) }] };
    await installApp(page, { api: { ...API, '/sales/templates': saved } });
    await page.route('**/functions/v1/presence/sales/templates?with_body=contract', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'tpl-1', name: 'My agreement', title: 'My agreement', body: 'MY OWN WORDING for {{client_company}} — {{deal_value}}.' }] }) }));
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await page.locator('#addCon').click();
    const body = page.locator('#conForm textarea');
    await expect.poll(async () => await body.inputValue(), { timeout: 7000 }).toContain('MY OWN WORDING');
    const text = await body.inputValue();
    expect(text).toBe('MY OWN WORDING for Acme — $5,000.');                     // his tokens filled too
    expect(text).not.toContain('DAVIS DIGITAL STUDIO');                         // the built-in default stood aside
  });

  test('a deal with no value and no contact degrades readably — no {{tokens}}, no misleading $0', async ({ page }) => {
    const BARE = { data: { ...CONTACTLESS.data, deal: { ...CONTACTLESS.data.deal, expected_value_cents: 0, title: '' }, contracts: [] } };
    await installApp(page, { api: { ...API, [`/sales/deals/${DEAL3}`]: BARE, [`/sales/deals/${DEAL3}/tasks`]: { data: [] } } });
    await page.goto(`/pipeline.html?deal=${DEAL3}`);
    await page.locator('#addCon').click();
    const body = page.locator('#conForm textarea');
    await expect.poll(async () => (await body.inputValue()).length, { timeout: 7000 }).toBeGreaterThan(10000);
    const text = await body.inputValue();
    expect(text).not.toMatch(/\{\{/);
    expect(text).toContain('[project fee]');
    expect(text).toContain('[50% deposit]');
    expect(text).toContain('[50% balance]');
    expect(text).toContain('the client');
    expect(text).toContain('the project');
    expect(text).not.toMatch(/\$0(?!\d)/);                                      // never a made-up price
  });
});

// ── Removing an unsent draft (Eric's duplicate $3,200 proposal) ─────────────
// Two drafts of the same proposal landed on one deal and there was no way to
// take either off. The rule is the server's: only a never-sent DRAFT goes, and
// it goes softly. The deal page must offer Delete on exactly those rows — a
// sent proposal or a signed agreement is a record and shows no control at all,
// so the page can never ask for something the API would refuse.
const DEAL4 = '44444444-4444-4444-8444-444444444444';
const DRAFTS = { data: {
  deal: { id: DEAL4, title: 'Bacchus', stage: 'proposal', expected_value_cents: 320000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null },
  contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' },
  proposals: [
    { id: 'p-dup', title: 'Website build', status: 'draft', version: 1, line_items: [{ label: 'Build', qty: 1, unit_cents: 320000 }], first_viewed_at: null, expires_at: null },
    { id: 'p-sent', title: 'Website build', status: 'sent', version: 1, line_items: [{ label: 'Build', qty: 1, unit_cents: 320000 }], first_viewed_at: null, expires_at: null },
  ],
  contracts: [
    { id: 'k-draft', title: 'Service agreement', status: 'draft', signer_name: null, signed_at: null, version: 1, terms_snapshot: null },
    { id: 'k-signed', title: 'Service agreement', status: 'signed', signer_name: 'Sam Rivera', signed_at: past(2), version: 1, terms_snapshot: null },
  ],
  events: [], timeline: [], invoices: [], last_contacted_at: null,
} };
const DRAFT_API = { ...API, [`/sales/deals/${DEAL4}`]: DRAFTS, [`/sales/deals/${DEAL4}/tasks`]: { data: [] } };

const rowFor = (page: import('@playwright/test').Page, sel: string) => page.locator(`#detailInner .lr:has(${sel})`);

test.describe('deal page — remove an unsent draft', () => {
  test('a DRAFT proposal offers Delete and removes on confirm; a SENT one offers nothing', async ({ page }) => {
    const calls: Array<{ path: string; method: string }> = [];
    await installApp(page, { api: DRAFT_API });
    await page.route('**/functions/v1/presence/sales/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      if (route.request().method() === 'GET') return route.fallback();
      calls.push({ path, method: route.request().method() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL4}`);

    // the draft row carries a Delete; the sent row carries none
    await expect(page.locator('[data-del-prop="p-dup"]')).toBeVisible();
    await expect(page.locator('[data-del-prop="p-sent"]')).toHaveCount(0);
    // …and the sent row's own controls are still there, so this is a targeted absence
    await expect(page.locator('[data-link-proposal="p-sent"]')).toBeVisible();
    await expect(rowFor(page, '[data-link-proposal="p-sent"]')).not.toContainText('Delete');

    // destructive → confirm first; dismissing does nothing at all
    page.once('dialog', (d) => d.dismiss());
    await page.locator('[data-del-prop="p-dup"]').click();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

    // accepting sends the DELETE, then re-renders the deal and says so plainly
    page.once('dialog', (d) => d.accept());
    await page.locator('[data-del-prop="p-dup"]').click();
    await expect(page.locator('.dds-toast')).toContainText('Draft removed');
    expect(calls).toContainEqual({ path: '/sales/proposals/p-dup', method: 'DELETE' });
  });

  test('a DRAFT agreement offers Delete; a SIGNED one never does', async ({ page }) => {
    const calls: Array<{ path: string; method: string }> = [];
    await installApp(page, { api: DRAFT_API });
    await page.route('**/functions/v1/presence/sales/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      if (route.request().method() === 'GET') return route.fallback();
      calls.push({ path, method: route.request().method() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL4}`);

    await expect(page.locator('[data-del-con="k-draft"]')).toBeVisible();
    await expect(page.locator('[data-del-con="k-signed"]')).toHaveCount(0);
    // the signed row still shows its evidence — nothing about it became removable
    await expect(rowFor(page, '[data-doc-con="k-signed"]')).toContainText('Signed');
    await expect(rowFor(page, '[data-doc-con="k-signed"]')).not.toContainText('Delete');

    page.once('dialog', (d) => d.accept());
    await page.locator('[data-del-con="k-draft"]').click();
    await expect(page.locator('.dds-toast')).toContainText('Draft removed');
    expect(calls).toContainEqual({ path: '/sales/contracts/k-draft', method: 'DELETE' });
  });

  test('a server refusal is surfaced honestly, and the row stays', async ({ page }) => {
    await installApp(page, { api: DRAFT_API });
    await page.route('**/functions/v1/presence/sales/proposals/**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'already_sent', message: 'This was already sent — it stays on the record.' }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL4}`);
    page.once('dialog', (d) => d.accept());
    await page.locator('[data-del-prop="p-dup"]').click();
    await expect(page.locator('.dds-toast')).toContainText('already sent');
    await expect(page.locator('[data-del-prop="p-dup"]')).toBeVisible();        // still there to try again
  });
});

// ── An agreement PER PACKAGE ────────────────────────────────────────────────
// The old single template hardcoded "Package: Custom + Photography" on its cover
// and carried that package's what's-included list, so every deal — Growth or not
// — got that document. pipeline.html now ships one agreement per package with
// the scope of work INSIDE it (cover → scope → legal terms: one document, one
// signature), and the form asks which package before it seeds anything.
const DEAL5 = '55555555-5555-4555-8555-555555555555';
const GROWTH_DEAL = { data: {
  deal: { id: DEAL5, title: 'Bacchus website', stage: 'contract', expected_value_cents: 640000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null },
  contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Bacchus Wine Bar', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
} };
const PKG_API = { ...API, [`/sales/deals/${DEAL5}`]: GROWTH_DEAL, [`/sales/deals/${DEAL5}/tasks`]: { data: [] } };
const conBody = (page: import('@playwright/test').Page) => page.locator('#conForm textarea');
const seeded = async (page: import('@playwright/test').Page) => {
  await expect.poll(async () => (await conBody(page).inputValue()).length, { timeout: 7000 }).toBeGreaterThan(10000);
  return conBody(page).inputValue();
};

test.describe('agreement — one per package', () => {
  test('the form asks which package, defaults to the first, and seeds Growth with the deal’s fees', async ({ page }) => {
    await installApp(page, { api: PKG_API });
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('#addCon').click();

    // the chooser offers every shipped package, in order, and defaults sensibly
    const pick = page.locator('#conPkg');
    await expect(pick).toBeVisible();
    await expect(pick.locator('option')).toHaveText(['Growth', 'Custom + Photography']);
    await expect(pick).toHaveValue('growth');

    const text = await seeded(page);
    // the cover names THIS package — never another one's
    expect(text).toContain('Package:        Growth');
    expect(text).not.toContain('Custom + Photography');
    // the scope of work is IN the agreement, ahead of the legal terms
    expect(text).toContain('SCOPE OF WORK — GROWTH PACKAGE');
    for (const h of ['1. THE PACKAGE', '4. WHAT IS NOT INCLUDED', '11. SCOPE ACKNOWLEDGMENT']) expect(text).toContain(`\n${h}\n`);
    expect(text.indexOf('SCOPE OF WORK — GROWTH PACKAGE')).toBeLessThan(text.indexOf('\nPROJECT AGREEMENT\n'));
    expect(text).toContain('19. ENTIRE AGREEMENT');
    // the fee lines are FILLED from the deal — $6,400 split 50/50
    expect(text).not.toMatch(/\{\{/);
    expect(text).toContain('Growth package, one time project fee                    $6,400');
    expect(text).toContain('Deposit due at signing, 50 percent                      $3,200');
    expect(text).toContain('Balance due at launch, 50 percent                       $3,200');
    expect(text).toContain('Bacchus Wine Bar');                                  // {{client_company}}
    expect(text.split('\n')[0]).toBe('TEST STUDIO');                             // one legal seller, still
    // the fill-in blanks survive into the box so he can complete them
    expect(text).toContain('[LIST THE FIVE CORE PAGES]');
    await expect(conBody(page)).toBeEditable();
  });

  test('choosing Custom + Photography swaps to that agreement, scope and all', async ({ page }) => {
    await installApp(page, { api: PKG_API });
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('#addCon').click();
    await seeded(page);
    await page.locator('#conPkg').selectOption('custom_photo');
    await expect(page.locator('.dds-toast')).toContainText('Custom + Photography agreement loaded');
    const text = await conBody(page).inputValue();
    expect(text).toContain('Package:        Custom + Photography');
    expect(text).toContain('Art-directed photography direction');                // its own what's-included list
    expect(text).not.toContain('SCOPE OF WORK — GROWTH PACKAGE');                // …and none of Growth's scope
    expect(text).not.toContain('[LIST THE FIVE CORE PAGES]');
    expect(text).not.toMatch(/\{\{/);
    expect(text).toContain('$6,400');
  });

  test('the legal terms are byte-identical whichever package is chosen', async ({ page }) => {
    await installApp(page, { api: PKG_API });
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('#addCon').click();
    const growth = await seeded(page);
    await page.locator('#conPkg').selectOption('custom_photo');
    const custom = await conBody(page).inputValue();
    const legalOf = (t: string) => t.slice(t.indexOf('\nPROJECT AGREEMENT\n\n'));
    expect(legalOf(growth).length).toBeGreaterThan(10000);
    expect(legalOf(growth)).toBe(legalOf(custom));                               // one shared const, not two copies
  });

  test('switching away from words HE typed asks first; declining keeps them', async ({ page }) => {
    await installApp(page, { api: PKG_API });
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('#addCon').click();
    await seeded(page);
    await conBody(page).fill('MY OWN WORDING, typed by hand.');
    page.once('dialog', (d) => { expect(d.message()).toContain('Custom + Photography'); d.dismiss(); });
    await page.locator('#conPkg').selectOption('custom_photo');
    await expect(conBody(page)).toHaveValue('MY OWN WORDING, typed by hand.');   // untouched
    await expect(page.locator('#conPkg')).toHaveValue('growth');                 // …and the select snapped back
  });
});

// ── The unfilled-blanks guard ───────────────────────────────────────────────
// The Growth skeleton ships 25 [BRACKETED] fill-in points. A client must never
// receive "[LIST THE FIVE CORE PAGES]" — but a half-filled draft sent to himself
// is legitimate, so this warns and lets him through, never blocks.
test.describe('agreement — the unfilled-blanks warning', () => {
  const postsTo = async (page: import('@playwright/test').Page, calls: string[]) =>
    page.route('**/functions/v1/presence/sales/**', async (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      calls.push(path);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'k-new' }, url: 'https://example.test/sign/x', emailed: true }) });
    });

  test('Save & send warns, names the blanks, and sends nothing when he declines', async ({ page }) => {
    const calls: string[] = [];
    await installApp(page, { api: PKG_API });
    await postsTo(page, calls);
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('#addCon').click();
    await seeded(page);
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
    await page.locator('#conForm .row2 .btn:not(.ghost)').click();               // Save & send for signature →
    await expect(page.locator('.dds-toast')).toContainText('Not sent — fill in the blanks');
    expect(msg).toContain('25 fill-in blanks');
    expect(msg).toContain('[LIST THE FIVE CORE PAGES]');
    expect(msg).toContain('Send it anyway?');
    expect(calls).toHaveLength(0);                                              // not even saved as a draft
  });

  test('…and sends it anyway when he says yes — the warning never blocks', async ({ page }) => {
    const calls: string[] = [];
    await installApp(page, { api: PKG_API });
    await postsTo(page, calls);
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('#addCon').click();
    await seeded(page);
    page.once('dialog', (d) => d.accept());
    await page.locator('#conForm .row2 .btn:not(.ghost)').click();
    await expect.poll(() => calls).toContain(`/sales/deals/${DEAL5}/contracts`);
    await expect.poll(() => calls).toContain('/sales/contracts/k-new/send');
  });

  test('no warning at all once every blank is filled', async ({ page }) => {
    const calls: string[] = [];
    let dialogs = 0;
    await installApp(page, { api: PKG_API });
    await postsTo(page, calls);
    page.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('#addCon').click();
    const text = await seeded(page);
    await conBody(page).fill(text.replace(/\[[A-Z]{2}[^\]\n]*\]/g, 'Squarespace'));
    await page.locator('#conForm .row2 .btn:not(.ghost)').click();
    await expect.poll(() => calls).toContain('/sales/contracts/k-new/send');
    expect(dialogs).toBe(0);
  });

  test('a SAVED draft still full of blanks warns at its own Send button', async ({ page }) => {
    const withBlanks = { data: { ...GROWTH_DEAL.data, contracts: [
      { id: 'k-blank', title: 'Service agreement', status: 'draft', signer_name: null, signed_at: null, version: 1, terms_snapshot: null, body: 'Five core pages: [LIST THE FIVE CORE PAGES] built on [PLATFORM].' },
    ] } };
    const calls: string[] = [];
    await installApp(page, { api: { ...PKG_API, [`/sales/deals/${DEAL5}`]: withBlanks } });
    await postsTo(page, calls);
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
    await page.locator('[data-send-contract="k-blank"]').first().click();
    await expect(page.locator('.dds-toast')).toContainText('Not sent — fill in the blanks');
    expect(msg).toContain('2 fill-in blanks');
    expect(calls).toHaveLength(0);
  });

  test('a SAVED draft with nothing left to fill sends straight out', async ({ page }) => {
    const done = { data: { ...GROWTH_DEAL.data, contracts: [
      { id: 'k-done', title: 'Service agreement', status: 'draft', signer_name: null, signed_at: null, version: 1, terms_snapshot: null, body: 'Five core pages: Home, About, Menu, Events, Contact — built on Squarespace.' },
    ] } };
    const calls: string[] = [];
    let dialogs = 0;
    await installApp(page, { api: { ...PKG_API, [`/sales/deals/${DEAL5}`]: done } });
    await postsTo(page, calls);
    page.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await page.goto(`/pipeline.html?deal=${DEAL5}`);
    await page.locator('[data-send-contract="k-done"]').first().click();
    await expect.poll(() => calls).toContain('/sales/contracts/k-done/send');
    expect(dialogs).toBe(0);
  });
});
