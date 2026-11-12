import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 83 (Nov 2026): a deleted deal can be brought back. Deleting it asks in place (never
// a pop-up) and offers Undo, which brings it straight back.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
type Sent = { method: string; path: string; body: Record<string, unknown> | null };
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

test.describe('Deleting a deal can be undone (item 83)', () => {
  test('Delete asks in place; Undo brings the deal straight back', async ({ page }) => {
    const sent: Sent[] = [];
    let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.dismiss().catch(() => {}); });
    await installApp(page, { api: PIPE });
    await page.route((u) => u.pathname.endsWith(`/sales/deals/${DEAL}`) || u.pathname.endsWith(`/sales/deals/${DEAL}/restore`), (route) => {
      const r = route.request(); if (r.method() === 'GET') return route.fallback();
      sent.push({ method: r.method(), path: new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body: r.postDataJSON?.() ?? null });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=details`);
    const del = page.getByRole('button', { name: 'Delete this deal' });
    await del.scrollIntoViewIfNeeded();
    await del.click();
    const ask = page.getByRole('group', { name: 'Delete this deal? It leaves your pipeline. You can bring it back from Recently deleted for 30 days.' });
    await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    expect(sent).toEqual([]);
    await del.click();
    await page.getByRole('button', { name: 'Yes, delete it' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'DELETE', path: `/sales/deals/${DEAL}`, body: null });
    await page.locator('.dds-toast', { hasText: 'Deal deleted. It stays in Recently deleted for 30 days.' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ method: 'POST', path: `/sales/deals/${DEAL}/restore`, body: {} });
    expect(dialogs).toBe(0);   // never a pop-up
  });
});

// ── the Recently deleted page (drawn in Figma, section 263:865) ──
const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const DELETED = { data: {
  days: 30, partial: [],
  deals: [
    { id: 'dddddddd-0000-4000-8000-0000000000a1', title: 'Website rebuild — Lakeside Books', stage: 'proposal', stage_label: 'Proposal sent', value_cents: 240000, person: 'Chris Park', deleted_at: ago(3) },
    { id: 'dddddddd-0000-4000-8000-0000000000a2', title: 'Logo refresh — Cedar & Sage Salon', stage: 'lead', stage_label: 'New lead', value_cents: 65000, person: 'Mia Torres', deleted_at: ago(15) },
  ],
  contacts: [{ id: 'cccccccc-0000-4000-8000-0000000000b1', name: 'Sam Ortiz', email: 'sam@harboryoga.example', company: 'Harbor Yoga', deleted_at: ago(22) }],
  todos: [{ id: 'abababab-0000-4000-8000-0000000000c1', title: 'Call back about the menu photos', due_date: '2026-11-06', deal_id: null, deal_title: '', for_name: 'Harbor Yoga', deleted_at: ago(6) }],
} };
test.describe('The Recently deleted page (item 83)', () => {
  test('lists what was deleted, newest first; the chips narrow it; Restore brings each back and says where', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': DELETED } });
    await page.route((u) => /\/sales\/(deals\/[^/]+\/restore|contacts\/[^/]+\/restore|deal-tasks\/[^/]+)$/.test(u.pathname), (route) => {
      const r = route.request();
      sent.push({ method: r.method(), path: new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body: r.postDataJSON?.() ?? null });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, restored: true } }) });
    });
    await page.goto('/recently-deleted.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recently deleted');
    const rows = page.locator('.drow');
    await expect(rows.locator('.dt')).toHaveText(['Website rebuild — Lakeside Books', 'Call back about the menu photos', 'Logo refresh — Cedar & Sage Salon', 'Sam Ortiz']);
    await expect(rows.nth(0).locator('.ds')).toHaveText('Deal · Proposal sent · $2,400 · Chris Park');
    await expect(rows.nth(1).locator('.ds')).toHaveText('To-do · for Harbor Yoga · was due Nov 6');
    await expect(rows.nth(3).locator('.ds')).toHaveText('Contact · Harbor Yoga · sam@harboryoga.example');
    await expect(rows.nth(0).locator('.dw')).toHaveText('Deleted 3 days ago');
    await expect(rows.nth(2).locator('.dw')).toHaveText('Deleted 2 weeks ago');
    await expect(page.locator('.kchip')).toHaveText([/All\s*4/, /Deals\s*2/, /Contacts\s*1/, /To-dos\s*1/]);
    await expect(page.locator('.note')).toContainText('After 30 days things leave this list. Websites you moved to the trash are on Sites.');
    await page.locator('.kchip', { hasText: 'Deals' }).click();
    await expect(rows).toHaveCount(2);
    await expect(page.locator('.kchip', { hasText: 'Deals' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.kchip', { hasText: 'All' }).click();
    // a deal comes back
    await page.getByRole('button', { name: 'Restore Website rebuild — Lakeside Books' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'POST', path: '/sales/deals/dddddddd-0000-4000-8000-0000000000a1/restore', body: {} });
    await expect(rows).toHaveCount(3);
    await expect(page.locator('.dds-toast', { hasText: 'Website rebuild — Lakeside Books is back in Pipeline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore Call back about the menu photos' })).toBeFocused();   // focus moves to the next row
    // a to-do and a contact
    await page.getByRole('button', { name: 'Restore Call back about the menu photos' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ method: 'PATCH', path: '/sales/deal-tasks/abababab-0000-4000-8000-0000000000c1', body: { restore: true } });
    await page.getByRole('button', { name: 'Restore Sam Ortiz' }).click();
    await expect.poll(() => sent.length).toBe(3);
    expect(sent[2].path).toBe('/sales/contacts/cccccccc-0000-4000-8000-0000000000b1/restore');
    await page.locator('.dds-toast', { hasText: 'Sam Ortiz is back in Contacts' }).getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/crm\.html\?contact=cccccccc-0000-4000-8000-0000000000b1/);
  });

  test('nothing deleted says so; a read that failed in part says so', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': { data: { days: 30, partial: [], deals: [], contacts: [], todos: [] } } } });
    await page.goto('/recently-deleted.html');
    await expect(page.locator('.empty h2')).toHaveText('Nothing deleted in the last 30 days');
    await expect(page.locator('.empty')).toContainText('When you delete a deal, a contact or a to-do, it waits here for 30 days so you can bring it back.');
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': { data: { ...DELETED.data, partial: ['todos'] } } } });
    await page.goto('/recently-deleted.html');
    await expect(page.locator('.partial')).toHaveText('We couldn’t read your deleted to-dos just now, so this may not be everything. Refresh to try again.');
  });

  test('Settings has a way in', async ({ page }) => {
    test.skip((page.viewportSize()?.width || 1200) < 768, 'the card list is the same on a phone; one size is enough');
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    await page.goto('/settings.html');
    await expect(page.locator('a[href="/recently-deleted.html"]')).toContainText('Recently deleted');
  });
});

test.describe('The Recently deleted page reads clearly (item 83)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the chips, the rows and the note pass the contrast check (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': DELETED } });
      await page.goto('/recently-deleted.html');
      await expect(page.locator('.drow')).toHaveCount(4);
      expect((await new AxeBuilder({ page }).include('#main').withRules(['color-contrast']).analyze()).violations).toEqual([]);
    });
  }
  test('on a phone the chips are one row, and nothing runs off the side', async ({ page }) => {
    test.skip((page.viewportSize()?.width || 1200) >= 768, 'phone only');
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': DELETED } });
    await page.goto('/recently-deleted.html');
    const tops = await page.locator('.kchip').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
