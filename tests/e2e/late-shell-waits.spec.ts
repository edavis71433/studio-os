import { test, expect, type Page, type Request } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_NAV, STUDIO_LEVEL_NAV } from './helpers/app';
import { holdShell } from './helpers/late-shell';

// shell.js loads with defer: it runs once the page has parsed, just before DOMContentLoaded. These
// pages waited for it with `if (document.readyState === 'loading')`, asked after an await. By then
// parsing can be over (readyState 'interactive') while shell.js is still on its way, so the wait was
// skipped: Settings said this browser can't show notifications, a record said "Reload the page to email
// them from here.", Inbox and the record lost their AI help, and your own second business opened as a
// client. Each page now makes its wait while it is still parsing (today.html's SHELL_READY).
// Each test opens a page the way a slow phone does: the session answers once the page has parsed (the
// real supabase-js reads it behind a browser lock; the harness's stand-in answered at once, which hid
// this), and shell.js is held back until the page has done all it can without it.
// A press made before shell.js lands is sent from script (helpers/late-shell.ts says why). Every name
// is made up.

const SESSION_AFTER_PARSE = `
window.supabase = { createClient: function () { return { auth: {
  getSession: function () { return new Promise(function (r) {
    function answer() { if (!window.__e2eSessionAt) window.__e2eSessionAt = performance.now(); r({ data: { session: window.__E2E_SESSION || null } }); }
    if (document.readyState === 'loading') document.addEventListener('readystatechange', answer, { once: true }); else answer();
  }); },
  getUser: async function () { return { data: { user: (window.__E2E_SESSION || {}).user || null } }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { window.__E2E_SESSION = null; return { error: null }; },
} }; } };`;
const isPresence = (r: Request) => r.url().includes('/functions/v1/presence/');
const shellThere = (page: Page) => page.evaluate(() => typeof (window as unknown as { ddsContext?: unknown }).ddsContext === 'function');
const errorsOn = (page: Page) => { const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message)); return errs; };

/** Open `path` with the session answering after the parse and shell.js held. Returns once the page has
 *  gone quiet without it (its session read and its own reads answered), shell.js still held. */
async function openLate(page: Page, path: string): Promise<() => void> {
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route) => route.fulfill({ contentType: 'application/javascript', body: SESSION_AFTER_PARSE }));
  const letGo = await holdShell(page);
  const busy = new Set<Request>();
  let last = Date.now();
  page.on('request', (r) => { if (isPresence(r)) { busy.add(r); last = Date.now(); } });
  const done = (r: Request) => { if (busy.delete(r)) last = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  await page.goto(path, { waitUntil: 'commit' });   // the page's load event waits on shell.js
  await expect.poll(async () => {
    const since = await page.evaluate(() => { const at = (window as unknown as { __e2eSessionAt?: number }).__e2eSessionAt; return at ? performance.now() - at : -1; });
    return since > 400 && busy.size === 0 && Date.now() - last > 400;
  }, { message: 'the page goes quiet without shell.js' }).toBe(true);
  expect(await shellThere(page)).toBe(false);
  return letGo;
}
/** every presence request: its path (with query) and the business it named */
function recorder(page: Page) {
  const seen: Array<{ path: string; scope: string }> = [];
  page.on('request', (r) => {
    if (!isPresence(r)) return;
    const u = new URL(r.url());
    seen.push({ path: u.pathname.replace(/^.*\/functions\/v1\/presence/, '') + u.search, scope: r.headers()['x-dds-scope-site'] || '' });
  });
  return { asked: (p: string) => seen.filter((s) => s.path === p || s.path.startsWith(p + '?')) };
}

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'delete', 'export'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };

test.describe('pages that wait for shell.js still get it when it lands late', () => {
  test('Settings: Ring this device can be switched, and the page asks who you are once', async ({ page }) => {
    const errs = errorsOn(page);
    const rec = recorder(page);
    // a browser that can ring (Playwright's WebKit has no PushManager, which would grey the switch anyway)
    await page.addInitScript(() => { if (!('PushManager' in window)) (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {}; });
    await installApp(page);   // a business owner: Notifications is this device's switch
    const letGo = await openLate(page, '/settings.html#notify');
    letGo();
    const sw = page.getByRole('switch', { name: 'Ring this device' });
    await expect(sw).toBeVisible();
    await expect(page.locator('#pushHow')).toHaveText('A notification on this phone or computer when something needs you, even with Studio OS closed.');
    await expect(sw).not.toHaveAttribute('aria-disabled', 'true');   // it said "This browser can’t show notifications" and stayed grey
    expect(rec.asked('/portal/context')).toHaveLength(1);   // the shell's read, not a second one of the page's own
    expect(errs).toEqual([]);
  });

  test('a record: the Email box opens with Draft it for me, and Where things stand comes', async ({ page }) => {
    const errs = errorsOn(page);
    const DEAL = 'dddddddd-1111-4111-8111-dddddddddddd', CID = 'cccccccc-1111-4111-8111-cccccccccccc';
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/crm/record': { data: {
        identity: { contact_id: CID, deal_id: DEAL, client_id: null, customer_site_id: null, project_id: null },
        header: { name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'contact' },
        highlights: { stage: 'proposal', value_cents: 320000, next_step: 'Send revised logo' },
        sections: { overview: false, details: true, deal: true, delivery: false }, default_tab: 'deal', canonical: { key: 'deal', value: DEAL }, related_projects: [], related_deals: [],
      } },
      '/crm/activity': { data: { upcoming: [], reply_to: null, reply_support_to: null, items: [
        { id: 'i1', kind: 'message', type: 'message', title: 'Ivy sent a message', body: 'Could we try the stacked version on the homepage?', at: '2026-11-14T18:00:00Z', meta: null, href: null },
      ] } },
      '/sales/email': { data: { to: { name: 'Ivy Chen', email: 'ivy@juniper.example' }, stopped: null, unsubscribed: false, as: 'Brightline Studio', from: 'hello@example.test', replies: 'inbox', reply_to: 'site@reply.example.test' } },
      '/service/saved-replies': { data: { replies: [] } },
      '/sales/ai/summary': { data: { summary: null } },
    } });
    const letGo = await openLate(page, `/crm.html?deal=${DEAL}&tab=activity`);
    await expect(page.locator('#composer [data-ct="email"]')).toHaveAttribute('aria-selected', 'true');   // no reply address, so Email is the composer
    letGo();
    await expect(page.locator('#emBody')).toBeVisible();
    await expect(page.locator('#emBox')).not.toContainText('Reload the page');
    await expect(page.locator('#emBox').getByRole('button', { name: 'Draft it for me' })).toBeVisible();
    await expect(page.locator('#aicard .ai-sum').getByRole('heading', { name: 'Where things stand' })).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('Inbox: an enquiry opened before shell.js lands gets Draft a reply', async ({ page }) => {
    const errs = errorsOn(page);
    const lead = { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-11-15T02:00:00Z' };
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, client_messages: [], enquiries: [{ ...lead, thread_key: 'lead:l-9', unread: true, tier: 'needs_you', priority: false }] } },
      '/forms/inbox': { data: { submissions: [lead], unread: 1 } }, '/notifications': { data: [], unread_count: 0 }, '/service/saved-replies': { data: { replies: [] } },
    } });
    const letGo = await openLate(page, '/inbox.html');
    const pane = page.locator('#rpane');
    // a wide screen may have opened it already; else open it (a press sent from script, shell.js is still held)
    if (!(await pane.locator('#leadBody').count())) await page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' }).first().dispatchEvent('click');
    await expect(pane.locator('#leadBody')).toHaveCount(1);   // the reply box is drawn, and the AI help isn't in yet
    letGo();
    await expect(pane.getByRole('button', { name: 'Draft a reply' })).toBeVisible();
    await expect(pane.locator('.ai-row')).toContainText('AI help · about 1¢ a draft · reads this enquiry and your services');
    expect(errs).toEqual([]);
  });
});

// ── Your own second business opened with ?client= (builder item 83) ─────────────
// The context says it is yours (`business`, on your list of `businesses`); a studio inside a client
// has a `scope`. Without the context the pages decide from the address, as a client.
const B1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SECOND = (() => {
  const businesses = [
    { site_id: B1, name: 'Maple & Main Realty', role: 'business_owner', role_words: 'Co-owner', current: false, default: true },
    { site_id: B2, name: 'Juniper Floral Co.', role: 'business_owner', role_words: 'Co-owner', current: true, default: false },
  ];
  return { data: {
    site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
    is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false,
    capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'approve', 'connect', 'export', 'delete'],
    landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
    scope: null, businesses, business: businesses[1],
  } };
})();
// Projects decides before the context lands, from the businesses the shell remembers (after Switch business);
// a first visit with nothing remembered reads as a client, then again once the context says (as designed).
const OWN_PAGES: Array<{ name: string; path: string; api: Record<string, unknown>; reads: string[]; notice?: string; tool?: string; remembered?: boolean }> = [
  { name: 'To-dos', path: '/todos.html', reads: ['/sales/tasks'], notice: 'To-dos live at the studio level.', api: { '/sales/tasks': { data: { partial: false, done_days: 30, total: 0, items: [] } } } },
  { name: 'Invoices', path: '/invoices.html', reads: ['/sales/invoices'], notice: 'Invoices live at the studio level.', api: { '/sales/invoices': { data: { today: '2026-11-15', partial: false, items: [] } } } },
  { name: 'Recently deleted', path: '/recently-deleted.html', reads: ['/sales/deleted'], notice: 'Recently deleted lives at the studio level.', api: { '/sales/deleted': { data: { days: 30, partial: [], deals: [], contacts: [], todos: [] } } } },
  { name: 'Developer', path: '/developer.html', reads: ['/dev/customization'], api: {
    '/dev/files': { data: [] },
    '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: true, updated_at: null, updated_by: null } },
  } },
  { name: 'Get started', path: '/get-started.html', reads: ['/settings', '/identity'], api: { '/settings': { data: { industry_key: 'generic' } }, '/offerings': { data: [] } } },
  { name: 'Projects', path: '/projects.html', reads: ['/projects', '/studio/customers'], tool: '#newProject', remembered: true, api: { '/projects': { data: [], is_studio_view: true }, '/studio/customers': { data: [] } } },
];

test.describe('your own second business keeps its pages when shell.js lands late', () => {
  for (const p of OWN_PAGES) {
    test(`${p.name}: reads and keeps your second business, not a client’s`, async ({ page }) => {
      const errs = errorsOn(page);
      const rec = recorder(page);
      await installApp(page, { api: { ...p.api, '/portal/context': SECOND } as Record<string, Record<string, unknown>> });
      if (p.remembered) await page.addInitScript((ids) => { try { localStorage.setItem('dds-held-businesses', JSON.stringify(ids)); } catch { /* denied */ } }, [B1, B2]);
      const letGo = await openLate(page, `${p.path}?client=${B2}`);
      letGo();
      await expect.poll(() => shellThere(page)).toBe(true);
      if (p.notice) await expect(page.getByRole('heading', { name: p.notice })).toHaveCount(0);   // it said this instead of listing them
      for (const read of p.reads) await expect.poll(() => rec.asked(read).length, { message: `${read} is read` }).toBeGreaterThan(0);
      await page.waitForLoadState('networkidle');
      for (const read of p.reads) expect(rec.asked(read).map((s) => s.scope), `${read} carries the business`).toEqual(rec.asked(read).map(() => B2));
      if (p.tool) await expect(page.locator(p.tool)).toBeVisible();
      expect(errs).toEqual([]);
    });
  }
});

test.describe('pages that reuse the shell’s who-are-you read ask once when shell.js lands late', () => {
  test('Analytics', async ({ page }) => {
    const rec = recorder(page);
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    const letGo = await openLate(page, '/analytics.html');
    letGo();
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(rec.asked('/portal/context')).toHaveLength(1);
  });

  test('Files', async ({ page }) => {
    const rec = recorder(page);
    await installApp(page);
    const letGo = await openLate(page, '/files.html');
    letGo();
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(rec.asked('/portal/context')).toHaveLength(1);
  });
});
