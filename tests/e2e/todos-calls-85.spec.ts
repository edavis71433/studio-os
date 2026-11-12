import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 85 (Nov 2026), the parts on pages that already exist: a person with no deal has an
// Activity tab, Log a call and To-do work for them (kept on the person), and "Follow up on"
// (Tomorrow, Next week, or a day) adds a to-do in the same step, on the record and on a deal's
// own Log a call.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const ymd = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const CONTACT_RECORD = { data: {
  identity: { contact_id: CID, deal_id: null, client_id: null, customer_site_id: null, project_id: null },
  header: { name: 'Jordan Ellis', company: 'Larkspur Kitchen', email: 'jordan@example.com', phone: '(555) 010-2468', status: 'contact' },
  highlights: {}, sections: { overview: false, details: true, deal: false, delivery: false }, default_tab: 'details', canonical: { key: 'contact', value: CID },
} };
type Sent = { method: string; path: string; body: Record<string, unknown> | null };
async function spy(page: Page, sent: Sent[], match: RegExp, answer: (s: Sent) => unknown = () => ({ data: { ok: true } })) {
  await page.route((u) => u.pathname.includes('/functions/v1/presence/') && match.test(u.pathname), (route: Route) => {
    const r = route.request(); if (r.method() === 'GET') return route.fallback();
    const s = { method: r.method(), path: new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body: r.postDataJSON?.() ?? null };
    sent.push(s);
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(answer(s)) });
  });
}
// the record's rail is beside the page on a wide screen and its own tab on a narrow one
async function openActivity(page: Page) {
  await page.goto(`/crm.html?contact=${CID}&tab=activity`);
  await expect(page.locator('#composer [data-ct="logcall"]')).toBeVisible();
}

test.describe('Calls and to-dos for someone with no deal (item 85)', () => {
  test('their record has Activity: Log a call keeps it on them, and "Follow up on" adds a to-do for them', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/record': CONTACT_RECORD, '/crm/activity': { data: { items: [], upcoming: [] } } } });
    await spy(page, sent, /\/sales\/(people\/activity|tasks)$/, (s) => s.path.endsWith('/activity') ? { data: { item: { id: 'pe-1' }, last_contacted_at: new Date().toISOString(), follow_up: s.body?.follow_up ? { id: 't-1' } : undefined } } : { data: { id: 't-2' } });
    await openActivity(page);
    await expect(page.locator('#composer [data-ct]')).toHaveText(['Email', 'Message', 'Log a call', 'To-do']);   // item 80: Email first when there's an address
    await page.locator('#composer [data-ct="logcall"]').click();
    await page.locator('#logBody').fill('Talked about the spring menu');
    await page.locator('#composer [data-fu="7"]').click();
    const week = ymd(Date.now() + 7 * 86400000);
    await expect(page.locator('#logFollow')).toHaveValue(week);
    await page.locator('#logGo').click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].path).toBe('/sales/people/activity');
    expect(sent[0].body).toMatchObject({ kind: 'call', body: 'Talked about the spring menu', contact_id: CID, client_id: null, follow_up: week, follow_up_title: 'Follow up with Jordan Ellis' });
    await expect(page.locator('.dds-toast').last()).toContainText('Logged, and a to-do to follow up on');
    // a to-do for them, from the To-do tab
    await page.locator('#composer [data-ct="task"]').click();
    await page.locator('#taskTitle').fill('Send the menu mockup');
    await page.locator('#taskDue').fill('2030-02-01');
    await page.locator('#taskGo').click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ method: 'POST', path: '/sales/tasks', body: { title: 'Send the menu mockup', due_date: '2030-02-01', contact_id: CID, client_id: null } });
  });
});

const DEAL = 'dddddddd-0000-4000-8000-000000000001';
const DEALS = [{ id: DEAL, title: 'Harbor Dental site', stage: 'proposal', contact_id: 'ct-1', expected_value_cents: 420000, source: 'manual', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-08T00:00:00Z' }];
const PIPE = {
  '/portal/context': STUDIO_CTX,
  '/sales/deals': { data: DEALS },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Marcus Bell', email: 'marcus@example.com' }] },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 420000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], expected: { value_cents: 0 }, ar: { outstanding_cents: 0, count: 0 } } },
  '/settings': { data: { stage_stale_days: {} } },
  [`/sales/deals/${DEAL}`]: { data: { deal: { ...DEALS[0], expected_close: null, next_step: null, next_step_at: null, notes: '', converted_client_id: null, retainer: null },
    contact: { id: 'ct-1', name: 'Marcus Bell', email: 'marcus@example.com', phone: '', company: 'Harbor Dental', notes: '' },
    proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null } },
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/templates': { data: [] }, '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Example Studio' } },
};

test.describe('A deal\'s own Log a call takes "Follow up on" too (item 85)', () => {
  test('Tomorrow fills the day, and the log carries it', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: PIPE });
    await spy(page, sent, /\/sales\/deals\/[^/]+\/activity$/, () => ({ data: { item: { id: 'e-1' }, last_contacted_at: new Date().toISOString(), follow_up: { id: 't-9' } } }));
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=activity`);
    await expect(page.locator('#qlSave')).toBeVisible();
    await page.locator('#detailInner [data-fu="1"]').click();
    const tomorrow = ymd(Date.now() + 86400000);
    await expect(page.locator('#qlFollow')).toHaveValue(tomorrow);
    await page.locator('#qlSave').click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toMatchObject({ kind: 'call', follow_up: tomorrow, follow_up_title: 'Follow up with Marcus Bell' });
    await expect(page.locator('.dds-toast').last()).toContainText('Logged, and a to-do to follow up on');
  });
});
