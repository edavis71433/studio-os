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
