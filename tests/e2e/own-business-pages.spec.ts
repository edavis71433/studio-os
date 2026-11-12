import { test, expect, Page } from '@playwright/test';
import { installApp, STUDIO_NAV, CLIENT_NAV, ALL_FEATURES } from './helpers/app';
import { API as EDITOR_API } from './helpers/editor';

// ── Your own second business is not a studio inside a client (builder item 83, follow-up) ──
// Someone with places in two businesses opens their second one with the same ?client=<site id>
// a studio uses to work inside a client; /portal/context tells the two apart (a studio inside a
// client has a `scope`; your own business is `business`, on your list of `businesses`). The pages
// used to decide from the bare address, so a Co-owner in their second business got a client's
// Settings, Today, Pipeline, Contacts, Projects, Connections, Analytics and editor. Each page
// below is opened three ways and compared: your first business (no ?client=), your second one
// (?client=, the same page as the first, every read and link keeping the business), and a studio
// inside a client (exactly as before).

const B1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const CAPS = ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'approve', 'connect', 'export', 'delete'];
const BASE = {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: CAPS,
  landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
};
const businesses = (current: string) => [
  { site_id: B1, name: 'Maple & Main Realty', role: 'business_owner', role_words: 'Co-owner', current: current === B1, default: true },
  { site_id: B2, name: 'Juniper Floral Co.', role: 'business_owner', role_words: 'Co-owner', current: current === B2, default: false },
];
const own = (current: string) => { const list = businesses(current); return { data: { ...BASE, scope: null, businesses: list, business: list.find((b) => b.current) || null } }; };

interface Who { name: string; ctx: unknown; client: string }
const FIRST: Who = { name: 'your first business', ctx: own(B1), client: '' };
const SECOND: Who = { name: 'your second business', ctx: own(B2), client: B2 };
const STUDIO: Who = { name: 'a studio inside a client', client: CLIENT,
  ctx: { data: { ...BASE, is_agency: true, nav: CLIENT_NAV, scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' }, businesses: [], business: null } } };
const at = (who: Who, path: string) => { if (!who.client) return path; const [p, h] = path.split('#'); return p + (p.includes('?') ? '&' : '?') + 'client=' + who.client + (h ? '#' + h : ''); };

/** every presence read the page makes: its path (with query) and the business it named */
function recorder(page: Page) {
  const seen: Array<{ path: string; scope: string }> = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/\/functions\/v1\/presence\//.test(u.pathname)) seen.push({ path: u.pathname.replace(/^.*\/functions\/v1\/presence/, '') + u.search, scope: r.headers()['x-dds-scope-site'] || '' });
  });
  return { seen, reset: () => { seen.length = 0; }, asked: (p: string) => seen.filter((s) => s.path === p || s.path.startsWith(p + '?')) };
}
async function open(page: Page, who: Who, path: string, api: Record<string, unknown>) {
  await installApp(page, { api: { ...api, '/portal/context': who.ctx } as Record<string, Record<string, unknown>> });
  await page.goto(at(who, path));
}
const errorsOf = (page: Page) => { const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e))); return errors; };

// ── Settings ──────────────────────────────────────────────────────────────────
const SETTINGS_API = {
  '/identity': { data: { site_id: 's1', business_name: 'Juniper Floral Co.', email: 'hello@example.com', phone: '', service_area: 'Glendale, CA', tagline: '', description: '', story: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '', updated_at: '2026-10-01T00:00:00Z' } },
  '/settings': { data: { industry_key: 'generic' } },
  '/connections': { data: { edition: 'studio_os', note: '', groups: { Google: [{ key: 'google_analytics', label: 'Google Analytics', connection: { status: 'connected', health: 'ok' } }] } } },
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-12-03T00:00:00Z', in_grace: false, has_service_billing: false } },
  '/report/monthly': { data: { enabled: false, note: '', last_sent_month: null, send_to: 'owner@example.com' } },
};
const cardKeys = (page: Page) => page.locator('#cards .setcard').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));

test('Settings: your second business shows the same cards as your first, each keeping the business; a client’s shows the client’s', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const errors = errorsOf(page);
  const rec = recorder(page);
  await open(page, FIRST, '/settings.html', SETTINGS_API);
  await expect(page.locator('[data-card="stages"]')).toBeVisible();
  const first = await cardKeys(page);
  expect(first).toEqual(expect.arrayContaining(['stages', 'auto', 'billing', 'calendar']));
  expect(first).not.toContain('report');
  expect(first).not.toContain('replies');   // a client's Enquiry replies card
  const firstProfile = await page.locator('#profileHead').textContent();

  rec.reset();
  await open(page, SECOND, '/settings.html', SETTINGS_API);
  await expect(page.locator('[data-card="stages"]')).toBeVisible();
  expect(await cardKeys(page)).toEqual(first);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(page.locator('#profileHead')).toHaveText(String(firstProfile));
  await expect(page.locator('[data-card="stages"]')).toHaveAttribute('href', '#stages');
  await expect(page.locator('[data-card="connections"]')).toHaveAttribute('href', `/connections.html?client=${B2}`);
  await expect(page.locator('[data-card="dev"]')).toHaveAttribute('href', `/developer.html?client=${B2}`);
  await expect(page.locator('[data-card="dev"]')).not.toHaveAttribute('data-noscope', /./);
  await expect(page.locator('[data-card="dev"] b')).toHaveText('Developer');
  await expect(page.locator('#billing')).toBeVisible();   // the plan is this business's, read with it in hand
  expect(rec.asked('/commerce/subscription').map((s) => s.scope)).toEqual([B2]);
  expect(rec.asked('/identity').every((s) => s.scope === B2)).toBe(true);
  expect(rec.asked('/report/monthly')).toEqual([]);

  rec.reset();
  await open(page, STUDIO, '/settings.html', SETTINGS_API);
  await expect(page.locator('[data-card="report"]')).toBeVisible();
  const inClient = await cardKeys(page);
  for (const k of ['stages', 'auto', 'billing', 'calendar']) expect(inClient).not.toContain(k);
  expect(inClient).toContain('replies');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings — Marlow’s Kitchen');
  await expect(page.locator('#profileHead')).toHaveText('Marlow’s Kitchen’s profile');
  await expect(page.locator('[data-card="dev"]')).toHaveAttribute('href', '/developer.html');
  await expect(page.locator('[data-card="dev"]')).toHaveAttribute('data-noscope', '1');
  expect(rec.asked('/commerce/subscription')).toEqual([]);
  expect(errors).toEqual([]);
});

// ── Today ─────────────────────────────────────────────────────────────────────
const TODAY_API = {
  '/studio/customers': { data: [{ client_id: 'k1', name: 'Larkspur Kitchen', email: 'hi@larkspur.example', project_id: 'p1', project_name: 'Menu refresh', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 }] },
  '/client/projects': { data: [{ id: 'cp1', title: 'Spring website', status: 'active' }] },
  '/commerce/example-data': { data: { present: false } },
};
const studioCard = (page: Page) => page.locator('a', { hasText: 'your studio is on it' });

test('Today: your second business reads and shows what your first does; a client’s Overview reads the client’s record', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const errors = errorsOf(page);
  const rec = recorder(page);
  await open(page, FIRST, '/today.html', TODAY_API);
  await expect(page.locator('#rail-customers')).toBeVisible();
  await expect(studioCard(page)).toHaveAttribute('href', '/client.html');
  expect(rec.asked('/crm/record')).toEqual([]);

  rec.reset();
  await open(page, SECOND, '/today.html', TODAY_API);
  await expect(page.locator('#rail-customers')).toBeVisible();
  await expect(studioCard(page)).toHaveAttribute('href', `/client.html?client=${B2}`);
  for (const p of ['/client/projects', '/studio/customers', '/commerce/example-data']) expect(rec.asked(p).map((s) => s.scope)).toEqual([B2]);

  rec.reset();
  await open(page, STUDIO, '/today.html', TODAY_API);
  await expect.poll(() => rec.asked('/crm/record').map((s) => s.path)).toEqual([`/crm/record?client=${CLIENT}`]);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#rail-customers')).toHaveCount(0);
  await expect(studioCard(page)).toHaveCount(0);
  for (const p of ['/client/projects', '/studio/customers', '/commerce/example-data']) expect(rec.asked(p)).toEqual([]);
  expect(errors).toEqual([]);
});

test('Today: opened cold on your second business (nothing remembered, the context slow), the page settles as your own', async ({ page }) => {
  const rec = recorder(page);
  await installApp(page, { api: { ...TODAY_API, '/portal/context': SECOND.ctx } as Record<string, Record<string, unknown>> });
  // the context lands well after the page's own reads have gone out
  await page.route(/\/presence\/portal\/context$/, async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.fallback(); });
  await page.goto(at(SECOND, '/today.html'));
  await expect(page.locator('#rail-customers')).toBeVisible();
  await expect(studioCard(page)).toHaveAttribute('href', `/client.html?client=${B2}`);
  for (const p of ['/client/projects', '/studio/customers', '/commerce/example-data']) expect(rec.asked(p).map((s) => s.scope)).toEqual([B2]);
  expect(JSON.parse(String(await page.evaluate(() => localStorage.getItem('dds-held-businesses'))))).toEqual([B1, B2]);
});

// ── Pipeline ──────────────────────────────────────────────────────────────────
const PIPE_API = { '/sales/deals': { data: [] }, '/sales/stages': { data: { labels: {}, chances: {} } } };
const hiddenProp = (page: Page, id: string) => page.locator('#' + id).evaluate((n) => (n as HTMLElement).hidden);

test('Pipeline: your second business keeps New deal, Import, Views, Charts and Print; a client’s hides them', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const errors = errorsOf(page);
  const rec = recorder(page);
  for (const who of [FIRST, SECOND]) {
    rec.reset();
    await open(page, who, '/pipeline.html', PIPE_API);
    await expect(page.locator('#newDeal')).toBeVisible();
    await expect.poll(() => hiddenProp(page, 'importDeals')).toBe(false);
    for (const id of ['pvBtn', 'chartsBtn', 'printBtn']) expect(await hiddenProp(page, id), `${who.name}: #${id}`).toBe(false);
    await expect.poll(() => rec.asked('/sales/stages').map((s) => s.scope)).toEqual([who.client]);
  }
  rec.reset();
  await open(page, STUDIO, '/pipeline.html', PIPE_API);
  await expect(page.locator('#viewList')).toBeVisible();
  await page.waitForLoadState('networkidle');
  for (const id of ['newDeal', 'importDeals', 'pvBtn', 'chartsBtn', 'printBtn']) expect(await hiddenProp(page, id), `in a client: #${id}`).toBe(true);
  expect(rec.asked('/sales/stages')).toEqual([]);
  expect(errors).toEqual([]);
});

// ── Contacts ──────────────────────────────────────────────────────────────────
test('Contacts: your second business can add, import and save views as at your first; a client’s says contacts live at the studio level', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const errors = errorsOf(page);
  for (const who of [FIRST, SECOND]) {
    await open(page, who, '/contacts.html', { '/sales/contacts': { data: [] } });
    await expect(page.locator('#new')).toBeVisible();
    await expect(page.locator('#importCsv')).toHaveCount(1);
    await expect(page.getByText('Contacts live at the studio level.')).toHaveCount(0);
  }
  await open(page, STUDIO, '/contacts.html', { '/sales/contacts': { data: [] } });
  await expect(page.getByText('Contacts live at the studio level.')).toBeVisible();
  await expect(page.locator('#new')).toHaveCount(0);
  await expect(page.locator('#importCsv')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ── Projects ──────────────────────────────────────────────────────────────────
test('Projects: your second business reads its own projects and can start one; a client’s reads the studio’s, without New project', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const errors = errorsOf(page);
  const rec = recorder(page);
  const PROJ_API = { '/projects': { data: [], is_studio_view: true }, '/studio/customers': { data: [] } };
  for (const who of [FIRST, SECOND]) {
    rec.reset();
    await open(page, who, '/projects.html', PROJ_API);
    await expect(page.locator('#newProject')).toBeVisible();
    expect(rec.asked('/projects').every((s) => s.scope === who.client)).toBe(true);
    await expect.poll(() => rec.asked('/studio/customers').map((s) => s.scope)).toEqual([who.client]);   // the customers named are this business's
  }
  rec.reset();
  await open(page, STUDIO, '/projects.html', PROJ_API);
  await expect.poll(() => rec.asked('/projects').length).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#newProject')).toHaveCount(0);
  expect(rec.asked('/studio/customers')[0]?.scope).toBe('');   // the studio’s own roster, to find this client (as before)
  expect(errors).toEqual([]);
});

// ── Connections ───────────────────────────────────────────────────────────────
const CONN_API = {
  '/connections': { data: { edition: 'studio_os', note: '', groups: { Google: [
    { key: 'google_analytics', label: 'Google Analytics', connection: { status: 'disconnected', health: 'unknown' } },
    { key: 'google_search_console', label: 'Search Console', connection: { status: 'disconnected', health: 'unknown' } },
  ] } } },
  '/calendar/link': { data: { on: false, url: '', created_at: null, can_manage: true } },
};

test('Connections: your second business speaks to its owner and keeps its calendar link; a client’s offers to ask the client', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const errors = errorsOf(page);
  for (const who of [FIRST, SECOND]) {
    await open(page, who, '/connections.html', CONN_API);
    await expect(page.locator('#calSec')).toBeVisible();
    await expect(page.locator('#askClient')).toHaveCount(0);
  }
  await open(page, STUDIO, '/connections.html', CONN_API);
  await expect(page.locator('#askClient')).toHaveText('Ask Marlow’s Kitchen to connect their Google');
  await expect(page.locator('#calSec')).toBeHidden();
  expect(errors).toEqual([]);
});

// ── Analytics ─────────────────────────────────────────────────────────────────
const ANALYTICS_API = {
  '/analytics/dashboard': { data: { period: 'this_month', generated_at: '2026-11-10T14:14:00Z', sales: { pipeline: null, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] }, website: { traffic: null, search: null } } },
  '/sales/reports': { data: { generated_at: '2026-11-10T16:00:00Z', revenue: { months: [], total_this_year: 0, total_last_year: 0 }, pipeline: { rows: [], count: 0, value_cents: 0, expected_cents: 0 },
    outcomes: { window_days: 365, won: { count: 0, value_cents: 0 }, lost: { count: 0, value_cents: 0 }, win_rate_pct: null, won_by_source: [], won_by_found_via: [], lost_by_reason: [], days_to_close: null },
    enquiries: { rows: [], last_30: 0, last_365: 0, became_deals: 0 }, overdue: { rows: [], total_cents: 0 } } },
};

test('Analytics: your second business keeps its Reports; a client’s leaves them out', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const errors = errorsOf(page);
  for (const who of [FIRST, SECOND]) {
    await open(page, who, '/analytics.html', ANALYTICS_API);
    await expect(page.locator('#reports')).toBeVisible();
  }
  await open(page, STUDIO, '/analytics.html', ANALYTICS_API);
  await expect(page.locator('h1, .band').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#reports')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ── Developer and Get started ─────────────────────────────────────────────────
// Both sent no business at all, so a second business read and saved the first one's website code and setup.
const DEV_API = {
  '/dev/files': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: true, updated_at: null, updated_by: null } },
};

test('Developer and Get started: your second business reads its own; a studio inside a client works on its own site, as before', async ({ page }) => {
  test.slow();   // six pages opened in turn
  const errors = errorsOf(page);
  const rec = recorder(page);
  for (const who of [FIRST, SECOND, STUDIO]) {
    const mine = who === SECOND ? B2 : '';
    rec.reset();
    await open(page, who, '/developer.html', DEV_API);
    await expect.poll(() => rec.asked('/dev/customization').map((s) => s.scope), { message: `developer, ${who.name}` }).toEqual([mine]);
    rec.reset();
    await open(page, who, '/get-started.html', { '/settings': { data: { industry_key: 'generic' } }, '/offerings': { data: [] } });
    await expect.poll(() => rec.asked('/settings').map((s) => s.scope), { message: `get started, ${who.name}` }).toEqual([mine]);
    expect(rec.asked('/identity').map((s) => s.scope)).toEqual([mine]);
  }
  expect(errors).toEqual([]);
});

// ── To-dos, Invoices and Recently deleted (sales 83 and 85) ───────────────────
// Each said "lives at the studio level" whenever ?client= was there, your own second business included.
const LIST_PAGES = [
  { path: '/todos.html', read: '/sales/tasks', notice: 'To-dos live at the studio level.', api: { '/sales/tasks': { data: { partial: false, done_days: 30, total: 0, items: [] } } } },
  { path: '/invoices.html', read: '/sales/invoices', notice: 'Invoices live at the studio level.', api: { '/sales/invoices': { data: { today: '2026-11-12', partial: false, items: [] } } } },
  { path: '/recently-deleted.html', read: '/sales/deleted', notice: 'Recently deleted lives at the studio level.', api: { '/sales/deleted': { data: { days: 30, partial: [], deals: [], contacts: [], todos: [] } } } },
];

test('To-dos, Invoices and Recently deleted: your second business lists its own; a client’s says they live at the studio level', async ({ page }) => {
  test.slow();   // nine pages opened in turn
  const errors = errorsOf(page);
  const rec = recorder(page);
  for (const p of LIST_PAGES) {
    for (const who of [FIRST, SECOND]) {
      rec.reset();
      await open(page, who, p.path, p.api);
      await expect.poll(() => rec.asked(p.read).map((s) => s.scope), { message: `${p.path}, ${who.name}` }).toEqual([who.client]);
      await expect(page.getByRole('heading', { name: p.notice })).toHaveCount(0);
    }
    rec.reset();
    await open(page, STUDIO, p.path, p.api);
    await expect(page.getByRole('heading', { name: p.notice })).toBeVisible();
    expect(rec.asked(p.read)).toEqual([]);
  }
  expect(errors).toEqual([]);
});

// ── The website editor ──────────────────────────────────────────────────────────
const FIRST_RUN = { '/commerce/first-run': { data: { dismissed: false, complete: false, done: 0, total: 1, steps: [{ key: 'details', title: 'Add your business details', done: false }] } } };

test('Website editor: your second business gets its owner’s welcome and plan reads; a client’s never asks for them', async ({ page }) => {
  test.slow();   // three pages opened in turn
  const rec = recorder(page);
  for (const who of [FIRST, SECOND]) {
    rec.reset();
    await open(page, who, '/presence.html', { ...EDITOR_API, ...FIRST_RUN });
    await expect.poll(() => rec.asked('/commerce/first-run').map((s) => s.scope)).toEqual([who.client]);
  }
  rec.reset();
  await open(page, STUDIO, '/presence.html', { ...EDITOR_API, ...FIRST_RUN });
  await expect.poll(() => rec.asked('/site').length).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  expect(rec.asked('/commerce/first-run')).toEqual([]);
});
