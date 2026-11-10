import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// One key press, one open (Nov 2026). shell.js turns Enter/Space on a
// role="button" element into a click, for clickable <div>s with no keyboard
// support of their own. The cards below have their own: they open on Enter and
// Space and call preventDefault. The shell clicked them anyway, so every press
// opened the card twice — each read of the record went out twice, and on Files
// the second open took the focus-return target with it (PR 243 found it). The
// shell now leaves an element alone once its own handler has acted. Each check
// presses Enter, then Space, on a real card, counts the page's reads of that
// record, closes it, and checks focus is back on the card.
//
// Reads are counted when the page calls fetch, not when they finish: the second
// open came from the same key press, so it is counted before the first paints.

async function countReads(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __reads: string[] };
    w.__reads = [];
    const real = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      w.__reads.push(String(input instanceof Request ? input.url : input));
      return real(input, init);
    };
  });
}
/** how many times the page asked for this API path — `tail` is matched against the end of the URL */
// a read of that path, with or without a query of its own (the project reads carry ?today=)
const reads = (page: Page, tail: string) => page.evaluate((t) =>
  (window as unknown as { __reads: string[] }).__reads.filter((u) => u.endsWith('/functions/v1/presence' + t) || u.includes('/functions/v1/presence' + t + '?')).length, tail);

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

// ── Pipeline ─────────────────────────────────────────────────────────────────
const D1 = '11111111-1111-4111-8111-1111111111f1';
const D2 = '22222222-2222-4222-8222-2222222222f2';
const DEALS = [
  { id: D1, title: 'Blue Finch — site', stage: 'lead', contact_id: 'c1', expected_value_cents: 250000, source: 'form', created_at: ago(5), updated_at: ago(1) },
  { id: D2, title: 'Harbor Lane — logo', stage: 'qualified', contact_id: 'c2', expected_value_cents: 90000, source: 'manual', created_at: ago(3), updated_at: ago(1) },
];
const PIPELINE = {
  '/sales/deals': { data: DEALS },
  [`/sales/deals/${D1}`]: { data: {
    deal: { ...DEALS[0], next_step: null, next_step_at: null, notes: '', converted_client_id: null, retainer: null },
    contact: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', notes: '' },
    proposals: [], contracts: [], events: [], timeline: [], invoices: [],
  } },
  [`/sales/deals/${D1}/tasks`]: { data: [] },
  '/sales/contacts': { data: [
    { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', company: 'Blue Finch' },
    { id: 'c2', name: 'Dana Cole', email: 'dana@example.com', company: 'Harbor Lane' },
  ] },
  '/sales/summary': { data: { total: 2, open: { count: 2, value_cents: 340000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 },
    by_stage: [{ stage: 'lead', label: 'New lead', count: 1, value_cents: 250000, chance: 10 }, { stage: 'qualified', label: 'Qualified', count: 1, value_cents: 90000, chance: 25 }], ar: {} } },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/settings': { data: { stage_stale_days: {} } },
  '/identity': { data: { business_name: 'Test Studio' } },
  '/crm/activity': { data: { items: [{ title: 'Called Jane about the site', at: ago(2) }] } },
};
const pinDisplay = (page: Page, key: string, v: string) =>
  page.addInitScript(([k, val]) => { try { localStorage.setItem(k, val); } catch { /* storage denied */ } }, [key, v]);

test.describe('One key press opens a card once', () => {
  test('Pipeline board: Enter and Space open the deal’s preview once, and Escape hands focus back to the card', async ({ page }) => {
    await countReads(page);
    await installApp(page, { api: PIPELINE });
    await page.goto('/pipeline.html');
    const card = page.locator(`#board .bcard[data-id="${D1}"]`);
    const latest = page.locator('#dprev .dp-latest');
    let n = 0;
    for (const key of ['Enter', ' ']) {
      await card.focus();
      await page.keyboard.press(key);
      await expect(latest).toContainText('Called Jane about the site');
      n++;
      expect(await reads(page, `/crm/activity?deal=${D1}`)).toBe(n);   // one read per press, not two
      await page.keyboard.press('Escape');
      await expect(page.locator('#dprev')).not.toHaveAttribute('open', '');
      await expect(card).toBeFocused();
    }
  });

  test('Pipeline list: Enter and Space open the full deal once, and Back hands focus back to the card', async ({ page }) => {
    await pinDisplay(page, 'dds-display:pipeline', 'list');
    await countReads(page);
    await installApp(page, { api: PIPELINE });
    await page.goto('/pipeline.html');
    const card = page.locator(`#list .card[data-id="${D1}"]`);
    let n = 0;
    for (const key of ['Enter', ' ']) {
      await card.focus();
      await page.keyboard.press(key);
      await expect(page.locator('#dtitle')).toHaveText('Blue Finch — site');
      n++;
      expect(await reads(page, `/sales/deals/${D1}`)).toBe(n);
      await page.locator('#closeD').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#detailWrap')).toBeHidden();
      await expect(card).toBeFocused();
    }
  });

  // Contacts hands a card off to the record page (crm.html), so there is no
  // focus to hand back here: the check is that one press asks for it once. The
  // count lives in sessionStorage because the page is gone by the time we look.
  test('Contacts: Enter and Space open a contact card’s record once', async ({ page }) => {
    await pinDisplay(page, 'dds-display:contacts', 'cards');
    await installApp(page, { api: {
      '/sales/contacts/fields': { data: [] },
      '/sales/contacts': { data: [
        { id: 'ct-jane', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', updated_at: ago(2) },
        { id: 'ct-dana', name: 'Dana Cole', email: 'dana@example.com', phone: '', company: 'Harbor Lane', updated_at: ago(4) },
      ] },
    } });
    await page.route(/\/crm\.html\?/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Record</title>' }));
    for (const key of ['Enter', ' ']) {
      await page.goto('/contacts.html');
      const card = page.locator('.c[data-open="ct-jane"]');
      await expect(card).toBeVisible();
      await page.evaluate(() => {
        const w = window as unknown as { openDetail: (id: string) => void };
        const real = w.openDetail;
        sessionStorage.setItem('e2e-opens', '0');
        w.openDetail = (id) => { sessionStorage.setItem('e2e-opens', String(Number(sessionStorage.getItem('e2e-opens')) + 1)); real(id); };
      });
      await card.focus();
      await page.keyboard.press(key);
      await page.waitForURL(/\/crm\.html\?contact=ct-jane&tab=details/);
      expect(await page.evaluate(() => sessionStorage.getItem('e2e-opens'))).toBe('1');
    }
  });

  test('Projects: Enter and Space open a project card once, and Back hands focus back to the card', async ({ page }) => {
    const P = 'bbbbbbbb-0000-4000-8000-0000000000f1';
    await countReads(page);
    await installApp(page, { api: {
      '/projects': { data: [{ id: P, name: 'Website build', status: 'active', client_visible: true, client_id: 'c-juniper', target_date: null }], is_studio_view: true },
      '/projects/progress': { data: { [P]: { progress: { done: 7, total: 10, pct: 70 }, pending_approvals: 0, stage: 'review', next: null, waiting: null, overdue: 0 } } },
      '/studio/customers': { data: [{ client_id: 'c-juniper', name: 'Juniper Floral Co.', person_name: 'Ivy Chen' }] },
      '/support': { data: [] },
      [`/projects/${P}`]: { data: { project: { id: P, name: 'Website build', status: 'active', client_visible: true, client_id: 'c-juniper', target_date: null, description: '' },
        milestones: [], tasks: [], deliverables: [], approvals: [], progress: { done: 7, total: 10, pct: 70 }, is_studio_view: true } },
      [`/projects/${P}/report`]: { data: { summary: { progress: { done: 7, total: 10, pct: 70 }, pending_approvals: 0 } } },
      [`/projects/${P}/messages`]: { data: [] },
      [`/projects/${P}/surveys`]: { data: [] },
      [`/projects/${P}/client-messages`]: { data: [], customer: null },
    } });
    await page.goto('/projects.html');
    const card = page.locator(`#list .card[data-id="${P}"]`);
    let n = 0;
    for (const key of ['Enter', ' ']) {
      await card.focus();
      await page.keyboard.press(key);
      await expect(page.locator('#dtitle')).toHaveText('Website build');
      n++;
      expect(await reads(page, `/projects/${P}`)).toBe(n);
      await page.locator('#closeDetail').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#detailWrap')).toBeHidden();
      await expect(card).toBeFocused();
    }
  });

  // The client portal doesn't load shell.js (it has its own nav), so its project
  // cards never opened twice; this keeps it that way. Home reads each project
  // once for its milestone path, so the check counts what each press adds.
  test('Client portal: Enter and Space open a project card once', async ({ page }) => {
    const PID = 'cccccccc-1111-4111-8111-1111111111f1';
    await countReads(page);
    await installApp(page, { api: {
      '/portal/context': { data: {
        site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
        edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
        sees_full_workspace: true, is_client_portal: false, is_managed_client: true, capabilities: ['view_all'],
        landing: '/client.html', attention_count: 0, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
      } },
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/client/notifications': { data: [], unread_count: 0 },
      '/client/projects': { data: [{ id: PID, name: 'Website redesign', status: 'active', target_date: null }] },
      [`/client/projects/${PID}`]: { data: {
        project: { id: PID, name: 'Website redesign', status: 'active', target_date: null },
        milestones: [
          { id: 'm1', title: 'Design', status: 'complete', completed_at: ago(9), sort_order: 1 },
          { id: 'm2', title: 'Build', status: 'open', sort_order: 2 },
        ],
        tasks: [], events: [], deliverables: [], approvals: [], surveys: [], progress: { total: 4, done: 1, pct: 25 },
      } },
      [`/client/projects/${PID}/report`]: { data: { summary: null } },
      [`/client/projects/${PID}/messages`]: { data: [] },
      '/client/support': { data: [] },
      '/client/documents': { data: { documents: [] } },
      '/client/billing': { data: { invoices: [], summary: { open_count: 0, paid_count: 0 } } },
    } });
    await page.goto('/client.html');
    const card = page.locator(`[data-proj="${PID}"]`);
    for (const key of ['Enter', ' ']) {
      await expect(card.locator('.path.mini')).toBeVisible();   // Home's own read has landed
      const before = await reads(page, `/client/projects/${PID}`);
      await card.focus();
      await page.keyboard.press(key);
      await expect(page.getByRole('heading', { name: 'Website redesign', level: 1 })).toBeVisible();
      expect(await reads(page, `/client/projects/${PID}`)).toBe(before + 1);
      await page.locator('#projBack').focus();
      await page.keyboard.press('Enter');
    }
  });
});
