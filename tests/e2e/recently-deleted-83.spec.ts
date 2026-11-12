import { test, expect } from '@playwright/test';
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
