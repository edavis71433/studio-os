import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installApp } from './helpers/app';
import { headerAction } from './helpers/page-header';
import { pinClock, PINNED_NOW, daysFrom } from './helpers/clock';

// Sales items of the Nov 22 2026 review, the page halves (the server halves are in
// tests/presence/sales_two_nov22_test.mjs and setup_strip_105_test.mjs):
//   186  a call you logged can be corrected or removed; Recently deleted puts it back
//   188  Pipeline's List reads past the newest 100 (Show more), and its search asks the server
//   189  Prospects: the number is a call, "Back from your call?", a note line, a call-back day, filters
//   190  Add a customer asks "is this someone you already have?" first
//   191  the deal's history reads older lines (Show older)
//   200  a to-do changes its words and day, moves in one tap, and is deleted with Undo
//   213  Download beside Print makes a spreadsheet of what is on screen
// Every name below is made up.

type Sent = { method: string; path: string; body: unknown };
const ymd = (iso: string) => iso.slice(0, 10);
const day = (n: number) => ymd(daysFrom(PINNED_NOW, n));
/** Record (and answer) every save to paths matching `match`; reads go on to the fixtures. */
async function spy(page: Page, sent: Sent[], match: RegExp, answer: (s: Sent) => unknown = () => ({ data: { ok: true } })) {
  await page.route((u) => u.pathname.includes('/functions/v1/presence/') && match.test(u.pathname), (route: Route) => {
    const r = route.request(); if (r.method() === 'GET') return route.fallback();
    const s = { method: r.method(), path: new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body: r.postDataJSON?.() ?? null };
    sent.push(s);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(s)) });
  });
}
const toastWith = (page: Page, text: string | RegExp) => page.locator('.dds-toast').filter({ hasText: text });

// ── Pipeline ──
const did = (i: number) => `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`;
const deal = (i: number, over: Record<string, unknown> = {}) => ({ id: did(i), title: `Shopfront ${i}`, stage: 'lead', source: 'manual', expected_value_cents: 100000, expected_close: null, contact_id: null, converted_client_id: null, assigned_to: null, next_step: null, next_step_at: null, updated_at: daysFrom(PINNED_NOW, -i / 50), created_at: daysFrom(PINNED_NOW, -60), ...over });

test.describe('item 188 — Pipeline reaches past the newest 100', () => {
  test('Show more reads the next page, and a search asks the server for the deals not loaded', async ({ page }) => {
    await pinClock(page);
    const reads: URLSearchParams[] = [];
    await installApp(page, { api: { '/sales/summary': { data: {} } } });
    await page.route((u) => /\/functions\/v1\/presence\/sales\/deals$/.test(u.pathname), (route: Route) => {
      const q = new URL(route.request().url()).searchParams; reads.push(q);
      const data = q.get('q') ? (q.get('people') === '1' && /juniper/i.test(q.get('q') || '') ? [deal(500, { title: 'Juniper Floral shop' })] : [])
        : q.get('offset') === '100' ? [deal(100), deal(101)] : Array.from({ length: 100 }, (_, i) => deal(i));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    });
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:pipeline', 'list'); } catch { /* */ } });
    await page.goto('/pipeline.html');
    const cards = page.locator('#list .card');
    await expect(cards).toHaveCount(100);
    await expect(page.locator('#lmeta')).toContainText('Latest 100 deals');
    // the search: the loaded 100 hold no Juniper; the server is asked, by person too, and its answer shows
    await page.locator('#dealSearch').fill('juniper');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Juniper Floral shop');
    expect(reads.some((q) => q.get('q') === 'juniper' && q.get('people') === '1')).toBe(true);
    await expect(page.locator('#lmeta')).toContainText('1 deal found');
    await page.locator('#dealSearch').fill('');
    await expect(cards).toHaveCount(100);
    // Show more reads the next 100 from where the list ends; a short page means that's all
    await page.getByRole('button', { name: 'Show more deals' }).click();
    await expect(cards).toHaveCount(102);
    expect(reads.some((q) => q.get('offset') === '100' && q.get('limit') === '100')).toBe(true);
    await expect(page.getByRole('button', { name: 'Show more deals' })).toHaveCount(0);
    await expect(page.locator('#lmeta')).toContainText('102 deals');
    // item 213: Download beside Print is the same table as a spreadsheet, every deal in view
    const [file] = await Promise.all([page.waitForEvent('download'), (await headerAction(page, '#dlBtn')).click()]);
    const csv = readFileSync(await file.path() as string, 'utf8');
    expect(file.suggestedFilename()).toMatch(/^pipeline-all-deals-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split('\r\n')[0]).toBe('﻿Deal,Contact,Stage,Value,Close date,Next step');
    expect(csv.split('\r\n').filter(Boolean).length).toBe(103);
  });
});

test.describe('items 186 + 191 — the deal’s history', () => {
  const D = did(900), L = 'eeeeeeee-0000-4000-8000-000000000001';
  const item = (over: Record<string, unknown>) => ({ id: 'evt:x', at: daysFrom(PINNED_NOW, -2), logged_at: daysFrom(PINNED_NOW, -2), source: 'system', kind: 'stage_change', icon: '', who: '', text: '', backdated: false, ...over });
  test('a call you logged opens to be corrected, and Show older reads the lines before the newest 80', async ({ page }) => {
    await pinClock(page);
    const saves: Sent[] = [];
    await installApp(page, { api: {
      '/sales/summary': { data: {} }, '/sales/templates': { data: [] }, '/sales/services': { data: [] },
      '/sales/deals': { data: [deal(900, { title: 'Bakery website', stage: 'proposal' })] },
      [`/sales/deals/${D}`]: { data: { deal: deal(900, { title: 'Bakery website', stage: 'proposal' }), contact: null, proposals: [], contracts: [], events: [], invoices: [], estimates: [], recurring: [], returns: [], last_contacted_at: null,
        history_before: daysFrom(PINNED_NOW, -30),
        timeline: [
          item({ id: 'act:' + L, log_id: L, source: 'activity', kind: 'call', icon: '📞', who: 'owner@example.com', text: 'Left a voicemail', body: 'Left a voicemail', via: '', edited_at: null, mine: true }),
          item({ id: 'act:other', log_id: 'eeeeeeee-0000-4000-8000-000000000002', source: 'activity', kind: 'email', icon: '✉️', who: 'owner@example.com', text: 'Sent the quote', body: 'Sent the quote', via: 'app', mine: false }),
          item({ id: 'evt:v', kind: 'deal_change', text: 'Value changed from $1,000 to $1,500', change: { kind: 'value', from: 100000, to: 150000 } }),
        ] } },
      [`/sales/deals/${D}/history`]: { data: { timeline: [item({ id: 'evt:old', at: daysFrom(PINNED_NOW, -40), text: 'Moved to Qualified' })], more: false, before: null } },
      [`PATCH /sales/logs/${L}`]: (b: unknown) => { saves.push({ method: 'PATCH', path: `/sales/logs/${L}`, body: b }); return { data: { ok: true } }; },
    } });
    await page.goto(`/pipeline.html?deal=${D}&dtab=activity`);
    const tl = page.locator('#dealTl');
    await expect(tl).toContainText('Value changed from $1,000 to $1,500');
    // only your own hand-logged line offers Change (an email Studio OS sent doesn't)
    await expect(tl.getByRole('button', { name: /^Change or remove/ })).toHaveCount(1);
    await tl.getByRole('button', { name: 'Change or remove this call' }).click();
    const form = tl.locator('form.dds-le');
    await expect(form.locator('textarea')).toBeFocused();
    await expect(form.getByRole('button', { name: 'Call' })).toHaveAttribute('aria-pressed', 'true');
    await form.locator('textarea').fill('Spoke with Ana, she wants a quote by Friday');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].body).toEqual({ kind: 'call', body: 'Spoke with Ana, she wants a quote by Friday' });   // an unchanged day keeps the time it was logged
    await expect(toastWith(page, 'Saved. The line says it was edited.')).toBeVisible();
    // Show older brings the lines before the newest 80, in place
    await page.locator('#dealTl').getByRole('button', { name: 'Show older' }).click();
    await expect(page.locator('#dealTl')).toContainText('Moved to Qualified');
    await expect(page.locator('#dealTl').getByRole('button', { name: 'Show older' })).toHaveCount(0);
  });
});

test.describe('item 186 — Recently deleted puts a removed call back', () => {
  test('a removed call is listed with what it said and where it lived, and Restore asks the logs route', async ({ page }) => {
    await pinClock(page);
    const L = 'eeeeeeee-0000-4000-8000-000000000003';
    const saves: Sent[] = [];
    await installApp(page, { api: {
      '/sales/deleted': { data: { days: 30, customers: [], deals: [], contacts: [], todos: [], partial: [],
        logs: [{ id: L, kind: 'call', body: 'Left a voicemail', at: daysFrom(PINNED_NOW, -3), deleted_at: daysFrom(PINNED_NOW, -1), for_name: 'Bakery website', href: `/pipeline.html?deal=${did(900)}` }] } },
    } });
    await spy(page, saves, /\/sales\/logs\//);
    await page.goto('/recently-deleted.html');
    const row = page.locator(`[data-row="log:${L}"]`);
    await expect(row).toContainText('Left a voicemail');
    await expect(row).toContainText('Call · with Bakery website');
    await expect(page.getByRole('button', { name: /^Calls and notes/ })).toBeVisible();
    await row.getByRole('button', { name: /Restore/ }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ method: 'PATCH', path: `/sales/logs/${L}`, body: { restore: true } });
  });
});

test.describe('items 200 + 213 — a to-do changes where it sits', () => {
  const T = (n: number) => `abababab-0000-4000-8000-00000000000${n}`;
  const tasks = () => ({ data: { partial: false, done_days: 30, total: 2, done: [], items: [
    { kind: 'deal_task', id: T(1), parent_id: '', title: 'Call Maria', due: day(-1), context: 'Your own to-do', href: '/todos.html', blocked: false, later: false, order: null, for: 'me' },
    { kind: 'deal_task', id: T(2), parent_id: '', title: 'Renew my insurance', due: day(3), context: 'Your own to-do', href: '/todos.html', blocked: false, later: false, order: null, for: 'me' },
  ] } });
  test('Tomorrow moves it in a tap, the title opens it to change, and Delete has Undo', async ({ page }) => {
    await pinClock(page);
    const saves: Sent[] = [];
    await installApp(page, { api: { '/sales/tasks': tasks() } });
    await spy(page, saves, /\/sales\/deal-tasks\//);
    await page.goto('/todos.html');
    await page.getByRole('button', { name: 'Move Call Maria to tomorrow' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ method: 'PATCH', path: `/sales/deal-tasks/${T(1)}`, body: { due_date: day(1) } });
    await expect(toastWith(page, 'Moved to')).toBeVisible();
    // the title opens it: its words and day, Save
    await page.getByRole('button', { name: 'Change: Call Maria' }).click();
    const box = page.locator('form.tedit');
    await expect(box.locator('#te-t')).toBeFocused();
    await box.locator('#te-t').fill('Call Maria about the menu');
    await box.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].body).toEqual({ title: 'Call Maria about the menu' });
    // Delete, then Undo brings it back from Recently deleted
    await page.getByRole('button', { name: 'Change: Renew my insurance' }).click();
    await page.locator('form.tedit').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => saves.length).toBe(3);
    expect(saves[2].body).toEqual({ delete: true });
    await toastWith(page, 'Deleted: Renew my insurance').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => saves.length).toBe(4);
    expect(saves[3].body).toEqual({ restore: true });
  });
  test('Download beside Print makes a spreadsheet of the to-dos on screen', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: { '/sales/tasks': tasks() } });
    await page.goto('/todos.html');
    await expect(page.getByRole('button', { name: 'Change: Call Maria' })).toBeVisible();
    const [file] = await Promise.all([page.waitForEvent('download'), (await headerAction(page, '#dlBtn')).click()]);
    const rows = readFileSync(await file.path() as string, 'utf8').split('\r\n').filter(Boolean);
    expect(file.suggestedFilename()).toMatch(/^to-dos-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows[0]).toBe('﻿To-do,For,Due');
    expect(rows.length).toBe(3);
    expect(rows[1]).toMatch(/^Call Maria,You,"?Overdue, /);
  });
});

test.describe('item 189 — Prospects for a calling session', () => {
  const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';
  const pro = (over: Record<string, unknown>) => ({ id: P1, business_name: 'Fresh Fades Barbershop', phone: '(818) 555-0102', website: null, address: '2 Main St, Burbank, CA 91501, USA', industry: 'Barber shop', site_health: 'no_website', score: 95, status: 'New', search_query: 'barbers in Burbank', source: 'Google Maps', notes: null, deal_id: null, created_at: daysFrom(PINNED_NOW, -12), updated_at: daysFrom(PINNED_NOW, -12), health_word: 'No website', ...over });
  test('the number is a call, a call that left the page asks how it went, a call-back day goes on To-dos, and the list filters', async ({ page }) => {
    await pinClock(page);
    const saves: Sent[] = [];
    await installApp(page, { api: {
      '/sales/prospects': { data: [pro({}), pro({ id: P2, business_name: 'Old Diner', phone: null, address: '9 Brand Blvd, Glendale, CA 91203, USA', status: 'Contacted', site_health: 'dated', health_word: 'Dated site' })] },
      '/sales/tool-leads': { data: [] },
    } });
    await spy(page, saves, /\/sales\/(prospects\/|tasks$)/, (s) => (s.path === '/sales/tasks' ? { data: { id: 'x' } } : { data: { ok: true } }));
    // the phone went to its dialler and the page came back (or reloaded) within the half hour
    await page.addInitScript((id) => { try { sessionStorage.setItem('dds-prospect-call', JSON.stringify({ id, at: Date.now(), left: true })); } catch { /* */ } }, P1);
    await page.goto('/prospects.html');
    const row = page.locator(`.saved-row[data-id="${P1}"]`);
    await expect(row.getByRole('link', { name: 'Call Fresh Fades Barbershop on (818) 555-0102' })).toHaveAttribute('href', 'tel:8185550102');
    const ask = row.getByRole('group', { name: 'Back from your call' });
    await expect(ask).toContainText('Back from your call with Fresh Fades Barbershop?');
    await ask.getByRole('button', { name: 'No answer' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].path).toBe(`/sales/prospects/${P1}`);
    expect((saves[0].body as { notes: string }).notes).toMatch(/^Tried \w{3}, Nov 22, no answer\.$/);
    await expect(row.getByRole('group', { name: 'Back from your call' })).toHaveCount(0);
    // a call-back day goes on your To-dos, and the note says so
    await row.getByLabel(/Call Fresh Fades Barbershop back on/).fill(day(3));
    await expect.poll(() => saves.length).toBe(3);
    expect(saves[1]).toEqual({ method: 'POST', path: '/sales/tasks', body: { title: 'Call back Fresh Fades Barbershop on (818) 555-0102', due_date: day(3) } });
    expect((saves[2].body as { notes: string }).notes).toMatch(/no answer\.\nCall back \w{3}, Nov 25\.$/);
    await expect(toastWith(page, 'On your To-dos for')).toBeVisible();
    // the list filters by status and by town
    await page.locator('#pfStatus').selectOption('Contacted');
    await expect(page.locator('.saved-row')).toHaveCount(1);
    await expect(page.locator('.saved-row')).toContainText('Old Diner');
    await page.locator('#pfStatus').selectOption('');
    await page.locator('#pfTown').selectOption('Burbank');
    await expect(page.locator('.saved-row')).toHaveCount(1);
    await expect(page.locator('.saved-row')).toContainText('Fresh Fades Barbershop');
  });
});

test.describe('item 190 — Add a customer asks first', () => {
  test('someone who may already be here is asked about; Add as new anyway saves them', async ({ page }) => {
    const C = 'cccccccc-0000-4000-8000-000000000001';
    const checks: string[] = [];
    const saves: unknown[] = [];
    await installApp(page, { api: {
      '/studio/customers': { data: [] },
      'POST /sales/customers': (b: unknown) => { saves.push(b); return { data: { client_id: 'abababab-0000-4000-8000-000000000009', mode: 'connect', saved: true } }; },
    } });
    await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/people/check'), (route: Route) => {
      checks.push(new URL(route.request().url()).search);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { matches: [{ id: C, name: 'Ana Ruiz', email: 'ana@harbor.example', reasons: ['same email'], score: 1 }] } }) });
    });
    await page.goto('/customers.html');
    await page.locator('#addCust').click();
    await page.locator('#cu-name').fill('Ana Ruiz');
    await page.locator('#cu-email').fill('ana@harbor.example');
    await page.locator('#cu-submit').click();
    const same = page.locator('#cust-same');
    await expect(same).toContainText('Is this someone you already have?');
    await expect(same).toContainText('same email');
    await expect(same.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/crm.html?contact=${C}`);
    expect(checks[0]).toContain('email=ana%40harbor.example');
    expect(saves.length).toBe(0);
    await same.getByRole('button', { name: 'Add as new anyway' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toMatchObject({ mode: 'connect', save: true, name: 'Ana Ruiz', email: 'ana@harbor.example' });
    expect(checks.length).toBe(1);   // asked once
  });
});

test.describe('item 186 — a line you logged on the record', () => {
  test('a note you logged opens to Change; Remove takes it off with Undo', async ({ page }) => {
    await pinClock(page);
    const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc', CID = 'ffffffff-6666-4666-8666-ffffffffffff', CUST = 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
    const L = 'eeeeeeee-0000-4000-8000-000000000004', at = daysFrom(PINNED_NOW, -2);
    const saves: Sent[] = [];
    await installApp(page, { api: {
      '/crm/record': { data: {
        identity: { contact_id: CID, deal_id: null, client_id: CUST, customer_site_id: CLIENT, project_id: null },
        header: { name: 'Harbor Lane Bakery', person: 'Ana Ruiz', company: 'Harbor Lane Bakery', email: 'ana@harbor.example', phone: '', status: 'customer' }, highlights: {},
        sections: { overview: true, messages: true, deal: false, delivery: false, details: true }, default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
      } },
      '/crm/activity': { data: { upcoming: [], reply_to: null, reply_support_to: null, items: [
        { id: 'conv:activity:' + L, kind: 'activity', type: 'note', title: 'You added a note', body: 'Prefers mornings', at, meta: 'Note', href: null, log: { id: L, kind: 'note', body: 'Prefers mornings', at, mine: true, edited_at: null } },
        { id: 'conv:activity:other', kind: 'activity', type: 'note', title: 'Sam added a note', body: 'Asked about prices', at, meta: 'Note', href: null, log: { id: 'eeeeeeee-0000-4000-8000-000000000005', kind: 'note', body: 'Asked about prices', at, mine: false, edited_at: null } },
      ] } },
    } });
    await spy(page, saves, /\/sales\/logs\//);
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.getByRole('button', { name: /You added a note/ }).click();
    await expect(page.getByRole('button', { name: 'Change or remove this line' })).toHaveCount(1);
    await page.getByRole('button', { name: /Sam added a note/ }).click();
    await expect(page.getByRole('button', { name: 'Change or remove this line' })).toHaveCount(1);   // a teammate's stays theirs
    await page.getByRole('button', { name: 'Change or remove this line' }).click();
    await page.locator('form.dds-le').getByRole('button', { name: 'Remove' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ method: 'PATCH', path: `/sales/logs/${L}`, body: { remove: true } });
    await toastWith(page, 'Removed. It stays in Recently deleted for 30 days.').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].body).toEqual({ restore: true });
  });
});
