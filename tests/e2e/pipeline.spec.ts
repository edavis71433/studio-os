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
    await expect(page.locator('#viewTable')).toHaveAttribute('aria-selected', 'true');
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
    await expect(page.locator('#viewList')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#list .card').first()).toBeVisible();
    await page.locator('#viewTable').click();
    await expect(page.locator('#table table')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dds-display:pipeline'))).toBe('table');
    await page.goto('/pipeline.html');                         // reload — the choice sticks
    await expect(page.locator('#viewTable')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#table table')).toBeVisible();
    // Board still works from the same control
    await page.locator('#viewBoard').click();
    await expect(page.locator('#board .col').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dds-display:pipeline'))).toBe('board');
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
