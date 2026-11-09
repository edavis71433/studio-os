import { test, expect, Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Item 66 (Nov 2026): Contacts, People and the pipeline's contact names page past
// 100. The server caps a contacts read at 100; Contacts asked for 500 and People
// for 200, got 100, and never said so, so a studio with 240 people never saw 140
// of them and a search for one of them found nothing. The pages now read 100 at
// a time with the server's total and say "Showing 100 of 240 · Show more"; a
// search past the loaded pages asks the server; the pipeline looks up by id any
// deal's contact the newest 100 left out.

const id = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 240 people, newest first; number 230 is the only "Zed Quill" (on the third page)
const PEOPLE = Array.from({ length: 240 }, (_, i) => ({
  id: id(i + 1), name: i === 229 ? 'Zed Quill' : `Person ${String(i + 1).padStart(3, '0')}`, email: `p${i + 1}@example.com`, phone: '', company: '',
  client_id: i < 5 ? 'c-acme' : null, updated_at: new Date(Date.parse('2026-11-08T12:00:00Z') - i * 60_000).toISOString(),
}));

type Seen = { offset: number; limit: number; q: string; total: string | null; ids: string };
// a contacts route that pages like the server: limit capped at 100, offset, q, ids, total=1
async function serveContacts(page: Page, people = PEOPLE) {
  const seen: Seen[] = [];
  await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const u = new URL(route.request().url());
    const limit = Math.min(100, Number(u.searchParams.get('limit')) || 25), offset = Number(u.searchParams.get('offset')) || 0;
    const q = (u.searchParams.get('q') || '').toLowerCase(), ids = u.searchParams.get('ids') || '';
    seen.push({ offset, limit, q, total: u.searchParams.get('total'), ids });
    let rows = people.filter((c) => !q || `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(q));
    if (ids) { const want = new Set(ids.split(',')); rows = rows.filter((c) => want.has(c.id)); }
    const body: Record<string, unknown> = { data: rows.slice(offset, offset + limit), limit, offset };
    if (u.searchParams.get('total') === '1') body.total = rows.length;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return seen;
}

test.describe('Contacts: 100 at a time, with the count', () => {
  test('says "Showing 100 of 240", and Show more brings the next 100, then the last 40', async ({ page }) => {
    await installApp(page);
    const seen = await serveContacts(page);
    await page.goto('/contacts.html');
    const rows = page.locator('#listZone [data-open]');
    await expect(rows).toHaveCount(100);
    await expect(page.locator('#lmeta')).toContainText('100 of 240 contacts');
    await expect(page.locator('.more-line')).toHaveText('Showing 100 of 240 · Show more');
    expect(seen[0]).toMatchObject({ offset: 0, limit: 100, total: '1' });
    await page.locator('#moreBtn').click();
    await expect(rows).toHaveCount(200);
    await expect(page.locator('.more-line')).toHaveText('Showing 200 of 240 · Show more');
    await expect(page.locator('#moreBtn')).toBeFocused();       // the keyboard stays on the control
    await page.locator('#moreBtn').click();
    await expect(rows).toHaveCount(240);
    await expect(page.locator('.more-line')).toHaveCount(0);   // everyone is here: no line
    await expect(page.locator('#lmeta')).toContainText('240 contacts');
    expect(seen.filter((s) => !s.q).map((s) => s.offset)).toEqual([0, 100, 200]);
    expect(seen.every((s) => s.limit === 100)).toBe(true);     // never more than the server's page
  });

  test('a search finds someone who isn’t loaded yet (the server answers it)', async ({ page }) => {
    await installApp(page);
    const seen = await serveContacts(page);
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await page.locator('#q').fill('Zed');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(1);
    await expect(page.locator('#listZone')).toContainText('Zed Quill');
    expect(seen.some((s) => s.q === 'zed' && s.offset === 0)).toBe(true);
    await page.locator('#q').fill('');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await expect(page.locator('.more-line')).toHaveText('Showing 100 of 240 · Show more');
  });

  test('a small roster shows no line at all', async ({ page }) => {
    await installApp(page);
    await serveContacts(page, PEOPLE.slice(0, 12));
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(12);
    await expect(page.locator('.more-line')).toHaveCount(0);
    await expect(page.locator('#lmeta')).toContainText('12 contacts');
  });
});

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };

test.describe('People (Customers › People): 100 at a time, with the count', () => {
  test('the tab carries the total, chips don’t claim partial counts, Show more pages, a search looks past the loaded ones', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/studio/customers': { data: [] }, '/sales/receivables': { data: { items: [] } } } });
    const seen = await serveContacts(page);
    await page.goto('/customers.html?tab=people');
    const rows = page.locator('tr[data-person]');
    await expect(rows).toHaveCount(100);
    await expect(page.getByRole('tab', { name: /People/ })).toContainText('240');
    await expect(page.locator('.lmeta')).toHaveText('100 of 240 people');
    await expect(page.locator('[data-pchip]')).toHaveText(['All 240', 'Customers', 'Not yet']);
    await expect(page.locator('.more-line')).toHaveText('Showing 100 of 240 · Show more');
    await page.locator('#pMoreBtn').click();
    await expect(rows).toHaveCount(200);
    await expect(page.locator('.more-line')).toHaveText('Showing 200 of 240 · Show more');
    await page.locator('#pMoreBtn').click();
    await expect(rows).toHaveCount(240);
    await expect(page.locator('.more-line')).toHaveCount(0);
    await expect(page.locator('[data-pchip]')).toHaveText(['All 240', 'Customers 5', 'Not yet 235']);   // all loaded: real counts
    expect(seen.filter((s) => !s.q).map((s) => s.offset)).toEqual([0, 100, 200]);
  });

  test('a search on the first page asks the server and finds someone on the third', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/studio/customers': { data: [] }, '/sales/receivables': { data: { items: [] } } } });
    await serveContacts(page);
    await page.goto('/customers.html?tab=people');
    await expect(page.locator('tr[data-person]')).toHaveCount(100);
    await page.locator('#search').fill('quill');
    await expect(page.locator('tr[data-person]')).toHaveCount(1);
    await expect(page.locator('tr[data-person]')).toContainText('Zed Quill');
  });
});

test.describe('Pipeline: every deal says whose it is', () => {
  test('a deal whose contact is older than the newest 100 gets its name, looked up by id', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:pipeline', 'table'); } catch { /* denied */ } });
    const deal = (n: number, contact: string, title: string) => ({ id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`, title, stage: 'proposal', source: 'manual', expected_value_cents: 100000, expected_close: null, contact_id: contact, converted_client_id: null, updated_at: '2026-11-01T00:00:00Z', next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false });
    await installApp(page, { api: {
      '/sales/deals': { data: [deal(1, id(3), 'Recent deal'), deal(2, id(230), 'Older deal'), deal(3, id(999), 'Removed person’s deal')] },
      '/sales/summary': { data: { total: 3, open: { count: 3, value_cents: 300000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
      '/sales/receivables': { data: { items: [], total_cents: 0 } },
    } });
    const seen = await serveContacts(page);
    await page.goto('/pipeline.html');
    const cell = (t: string) => page.locator('#table tbody tr').filter({ hasText: t }).locator('td').nth(2);
    await expect(cell('Recent deal')).toHaveText('Person 003');
    await expect(cell('Older deal')).toHaveText('Zed Quill');        // was "—": outside the newest 100
    await expect(cell('Removed person’s deal')).toHaveText('—');     // not found: still a dash
    const byId = seen.filter((s) => s.ids);
    expect(byId.length).toBe(1);                                      // one look-up, only for the missing
    expect(byId[0].ids.split(',').sort()).toEqual([id(230), id(999)].sort());
    // a search by that person's name now finds the older deal too
    await page.locator('#dealSearch').fill('quill');
    await expect(page.locator('#table tbody tr')).toHaveCount(1);
    await expect(page.locator('#table tbody tr')).toContainText('Older deal');
  });
});
