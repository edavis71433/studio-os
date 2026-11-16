import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { expectOneHeader } from './helpers/page-header';

// Builder item 165 (Figma 295:3), group 1: the one page header on Home, Today, Domains, Templates,
// Plan my week, Pipeline, Projects, Prospects, To-dos and Invoices. Each page loads with fixtures
// shaped like its own spec's, then the shared helper checks the header the same way on every page,
// and axe reads the header in light and dark. Every name here is made up.

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const STUDIO = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'agency', upsell: null } };
const ymd = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const day = (n: number) => ymd(Date.now() + n * 86400000);
const iso = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

// ── Home (agency.html): agency.spec's portfolio and needs-you shapes ──
const row = (over: Record<string, unknown>) => ({ site_id: '', name: '', edition: 'presence', status: 'ready', archived: false, tags: [], owner: 'owner@studio.example', assigned: [], has_notes: false,
  domain: null, domain_registrar: null, domain_expires_at: null, moments: 0, criticals: 0, open_opportunities: 0, plans_waiting: 0, drafts_waiting: 0, leads_waiting: 0, files_pending: 0, search_issues: 0,
  billing_issue: false, attention: 0, review_open: false, migration: null, last_published_at: '2026-07-01T00:00:00Z', unpublished_changes: false, last_change_at: null, ...over });
const NEED = { key: 'broken:ev:a1:trust.ssl_missing', kind: 'broken', site_id: 'a1', client_id: null, name: 'Fern Street Bakery', what: 'The padlock is missing', when: 'Found by the health check', verb: 'Fix', href: '/presence.html?client=a1#domain' };
const HOME_API = {
  '/portal/context': STUDIO,
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: [row({ site_id: 'a1', name: 'Fern Street Bakery' }), row({ site_id: 'a2', name: 'Lumen Dental' }), row({ site_id: 'a3', name: 'Ridge Garage' })] },
  '/agency/needs-you': { data: { rows: [NEED], more: 0, rest: [], total: 1, empty_line: '', partial: false, own_site: true, next_by_site: { a1: { what: NEED.what, verb: NEED.verb, href: NEED.href, kind: NEED.kind } }, next_by_client: {} } },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: [] },
};

// ── Domains: studio-sites.spec's /agency/domains shape ──
const dom = (over: Record<string, unknown>) => ({ domain: '', site_id: '', name: '', own: false, status: 'connected', status_words: 'Connected', tone: 'good', days_left: 200, provider: 'Registrar A', expires_at: '2027-05-27T00:00:00Z',
  checked_at: '2026-11-08T00:00:00Z', record: 'ok', padlock_until: null, checks: [], dns_host: '', lock: true, warnings: [], registered_at: null, renews: 'unknown', ...over });
const DOMAINS = { data: { domains: [
  dom({ domain: 'gone.example', site_id: 's9', name: 'Gone Deli', status: 'expired', status_words: 'Expired 2 days ago', tone: 'bad', days_left: -2 }),
  dom({ domain: 'bistro.example', site_id: 's1', name: 'Bistro Nine', status: 'expiring', status_words: 'Expires in 12 days', tone: 'warn', days_left: 12 }),
  dom({ domain: 'garage.example', site_id: 's2', name: 'Garage Ten' }),
], builtin: [{ address: 'presence-cccccccccccc.netlify.app', site_id: 's3', name: 'Cafe Eleven', own: false }] }, partial: false };

// ── Templates: templates.spec's /agency/kits shape ──
const KITS = [
  { id: 'k1', name: 'Realty, three pages', industry_key: 'realty', created_from_site: 's1', created_by: 'owner@studio.example', created_at: '2026-11-10T00:00:00Z', from_name: 'Maple Lane Realty', brings: { offerings: 2, faqs: 1, voice: true, colors: true }, kind: 'template', summary: { pages: 3, sections: 14, photos: 9 } },
  { id: 'k2', name: 'Florist starter', industry_key: 'florist', created_from_site: 's9', created_by: 'pat@studio.example', created_at: '2026-11-02T00:00:00Z', from_name: '', brings: { offerings: 6, faqs: 4, voice: true, colors: true }, kind: 'kit' },
];

// ── Plan my week: client-tools.spec's /agency/week shape ──
const WEEK = { data: { today: '2026-11-16', end: '2026-11-22', late: 1, total: 3, partial: false, text: 'Plan for the week',
  days: [{ day: 'late', count: 1 }, { day: '2026-11-16', count: 1 }, { day: '2026-11-17', count: 1 }, { day: '2026-11-18', count: 0 }, { day: '2026-11-19', count: 0 }, { day: '2026-11-20', count: 0 }, { day: '2026-11-21', count: 0 }, { day: '2026-11-22', count: 0 }],
  clients: [
    { key: 'site:s1', site_id: 's1', client_id: null, name: 'Juniper Florals', own: false, first: true, why: 'A late invoice', items: [{ key: 'money:i1', kind: 'money', what: 'Invoice $900 is 2 days overdue', verb: 'Resend', href: '/pipeline.html#outstanding', day: '2026-11-14', when: 'late', late_days: 2 }] },
    { key: 'site:s2', site_id: 's2', client_id: null, name: 'Harbor Yoga', own: false, first: false, why: 'Their words arrived', items: [{ key: 'intake:s2', kind: 'intake', what: 'Their words arrived', verb: 'Read them', href: '/sites.html', day: null, when: 'today', late_days: 0 }] },
    { key: 'own', site_id: null, client_id: null, name: 'Not tied to a client', own: true, first: false, why: 'Your own to-dos', items: [{ key: 'deal:d9', kind: 'task', what: 'Send the proposal', verb: 'Open deal', href: '/pipeline.html?deal=d9', day: '2026-11-17', when: 'day', late_days: 0 }] },
  ] } };

// ── Pipeline: pipeline.spec's deals ──
const PIPE_API = {
  '/sales/deals': { data: [
    { id: 'd1', title: 'Oak Street website', stage: 'proposal', source: 'manual', expected_value_cents: 500000, expected_close: '2026-08-01', contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: null, next_step_at: null, last_contacted_at: past(3), agreement_signed: false },
    { id: 'd2', title: 'Pine rebrand', stage: 'lead', source: 'enquiry', expected_value_cents: 250000, expected_close: null, contact_id: 'ct-2', converted_client_id: null, updated_at: past(2), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false },
    { id: 'd3', title: 'Old win', stage: 'won', source: 'manual', expected_value_cents: 90000, expected_close: null, contact_id: null, converted_client_id: null, updated_at: past(9), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: true },
  ] },
  '/sales/summary': { data: { total: 3, open: { count: 2, value_cents: 750000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 1, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Ortiz', email: 'sam@example.com', phone: '', company: 'Oak', updated_at: past(1) }, { id: 'ct-2', name: 'Dee Lane', email: 'dee@example.com', phone: '', company: 'Pine', updated_at: past(2) }] },
  '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } }, '/identity': { data: { business_name: 'Test Studio' } },
};

// ── Projects: projects.spec's list ──
const PROJ_API = {
  '/projects': { data: [
    { id: 'p1', name: 'Cove website build', status: 'active', client_visible: true, client_id: 'c1', deal_id: null, start_date: null, target_date: '2026-08-01', updated_at: '2026-07-10T00:00:00Z' },
    { id: 'p2', name: 'Birch brand refresh', status: 'complete', client_visible: true, client_id: 'c2', deal_id: null, start_date: null, target_date: null, updated_at: '2026-07-01T00:00:00Z' },
    { id: 'p3', name: 'Internal ops', status: 'active', client_visible: false, client_id: null, deal_id: null, start_date: null, target_date: null, updated_at: '2026-06-20T00:00:00Z' },
  ], is_studio_view: true },
  '/studio/customers': { data: [{ client_id: 'c1', name: 'Cove Cafe', email: 'a@cove.example', status: 'active', customer_site_id: 'site-c1', open_support: 0, project_count: 1 }] },
};

// ── Prospects: prospects.spec's kept rows ──
const prospect = (id: string, name: string) => ({ id, business_name: name, phone: '(818) 555-0102', website: null, address: '2 Main St, Burbank, CA 91501', industry: 'Barber shop', site_health: 'no_website', score: 95,
  status: 'New', search_query: 'barbers in Burbank', source: 'Google Maps', notes: null, deal_id: null, created_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z', health_word: 'No website' });

// ── To-dos and Invoices: todos-invoices-85.spec's shapes ──
const TASKS = { data: { partial: false, done_days: 30, total: 3, items: [
  { kind: 'deal_task', id: 't1', parent_id: 'c1', title: 'Send the revised quote', due: day(-2), context: 'Jordan Vale', href: '/crm.html?contact=c1', blocked: false, later: false, order: null, for: 'person' },
  { kind: 'deal_task', id: 't2', parent_id: '', title: 'Renew my insurance', due: day(0), context: 'Your own to-do', href: '/todos.html', blocked: false, later: false, order: null, for: 'me' },
  { kind: 'deal_task', id: 't3', parent_id: 'c2', title: 'Send the yearly check-in', due: day(9), context: 'Harbor Yoga', href: '/crm.html?client_id=c2', blocked: false, later: false, order: null, for: 'customer' },
], done: [] } };
const inv = (n: number, over: Record<string, unknown>) => ({ id: `i${n}`, number_label: `#00${60 + n}`, title: 'Website work', amount_cents: 100000, status: 'open', state: 'upcoming', due_date: day(6), issued_at: iso(-8), paid_at: null, paid_method: '',
  processing: false, payment_for: null, deal_id: null, business: 'Cove Cafe', person: 'Ana Cruz', ...over });
const INVOICES = { data: { today: day(0), partial: false, items: [
  inv(1, { amount_cents: 180000 }),
  inv(2, { amount_cents: 65000, state: 'overdue', due_date: day(-11) }),
  inv(3, { amount_cents: 120000, status: 'paid', state: 'paid', paid_at: iso(-1), paid_method: 'check' }),
] } };

type Open = (page: Page) => Promise<void>;
const PAGES: Array<{ name: string; open: Open; want: Parameters<typeof expectOneHeader>[1] }> = [
  { name: 'Home', open: async (page) => { await installApp(page, { api: HOME_API }); await page.goto('/agency.html'); },
    want: { title: 'Home', icon: 'home', line: '3 customers you look after · 1 needs you', filled: '+ Add a customer' } },
  { name: 'Today', open: async (page) => { await installApp(page); await page.goto('/today.html'); },
    want: { title: 'Today', icon: 'today', line: /^Good (morning|afternoon|evening)\. [A-Z][a-z]+, [A-Z][a-z]+ \d{1,2} · /, filled: null } },
  { name: 'a client’s Overview', open: async (page) => { await installApp(page); await page.goto('/today.html?client=aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'); },
    want: { title: 'Overview', icon: 'overview', filled: null } },
  { name: 'Domains', open: async (page) => { await installApp(page, { api: { '/portal/context': STUDIO, '/agency/domains': DOMAINS } }); await page.goto('/domains.html'); },
    want: { title: 'Domains', icon: 'website', line: '3 domains you look after · 2 expiring or expired · 1 site on a built-in address', filled: null, tabs: ['Sites', 'Domains', 'Templates', 'Usage', 'Changes'] } },
  { name: 'Templates', open: async (page) => {
      await installApp(page, { api: { '/portal/context': STUDIO } });
      await page.route(/\/functions\/v1\/presence\/agency\/kits$/, (route) => route.fulfill(json({ data: KITS, can_manage: true })));
      await page.goto('/templates.html'); },
    want: { title: 'Templates', icon: 'templates', line: '1 template · 1 starter kit', filled: null, tabs: ['Sites', 'Domains', 'Templates', 'Usage', 'Changes'] } },
  { name: 'Plan my week', open: async (page) => { await installApp(page, { api: { '/portal/context': STUDIO, '/agency/week': WEEK } }); await page.goto('/week.html'); },
    want: { title: 'Plan my week', icon: 'week', trail: 'Home', line: /3 things across 2 clients and your own · 1 late$/, filled: null } },
  { name: 'Pipeline', open: async (page) => {
      await page.addInitScript(() => { try { localStorage.setItem('dds-display:pipeline', 'list'); } catch { /* denied */ } });
      await installApp(page, { api: PIPE_API }); await page.goto('/pipeline.html'); },
    want: { title: 'Pipeline', icon: 'pipeline', line: '2 open deals worth $7,500', picker: 'Views', filled: '+ New deal' } },
  { name: 'Projects', open: async (page) => { await installApp(page, { api: PROJ_API }); await page.goto('/projects.html'); },
    want: { title: 'Projects', icon: 'projects', line: /^2 running/, filled: '+ New project' } },
  { name: 'Prospects', open: async (page) => {
      await installApp(page);
      await page.route('**/functions/v1/presence/sales/prospects**', (route) => route.fulfill(json({ data: [prospect('p1', 'Fresh Fades Barbershop'), prospect('p2', 'Corner Diner')] })));
      await page.goto('/prospects.html'); },
    want: { title: 'Prospects', icon: 'prospects', line: '2 businesses on your list', filled: null } },
  { name: 'To-dos', open: async (page) => { await installApp(page, { api: { '/portal/context': STUDIO, '/sales/tasks': TASKS } }); await page.goto('/todos.html'); },
    want: { title: 'To-dos', icon: 'todos', line: '3 open · 1 overdue · 1 due today', picker: 'For: Everyone', filled: '+ Add a to-do' } },
  { name: 'Invoices', open: async (page) => { await installApp(page, { api: { '/portal/context': STUDIO, '/sales/invoices': INVOICES } }); await page.goto('/invoices.html'); },
    want: { title: 'Invoices', icon: 'invoices', line: '3 invoices sent · $2,450 owed to you · 1 overdue', filled: 'Send an invoice' } },
];

test.describe('One page header, group 1 (builder item 165)', () => {
  for (const p of PAGES) {
    test(`${p.name}: the icon, the title, its line, the actions with at most one filled`, { tag: '@layout' }, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await p.open(page);
      await expectOneHeader(page, p.want);
      const head = page.locator('header.dds-ph');
      if ((page.viewportSize()?.width || 0) < 761 && await head.locator('.dds-ph-more > *').count()) {
        // the others wait behind ⋯ in a sheet; Escape puts it away
        await head.locator('.dds-ph-dots').click();
        await expect(head.locator('.dds-ph-more')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(head.locator('.dds-ph-more')).toBeHidden();
      }
      // nothing in the header spills sideways (the header and everything in it end inside the window)
      expect(await head.evaluate((h) => {
        // a strip that slides (the tabs on a phone, item 215's five) counts by its own edge, not the tabs scrolled inside it
        const inStrip = (e: Element) => { for (let p = e.parentElement; p && p !== h; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true; return false; };
        return Math.max(...[h, ...h.querySelectorAll('*')].filter((e) => e.getClientRects().length > 0 && !inStrip(e)).map((e) => e.getBoundingClientRect().right)) - window.innerWidth;
      })).toBeLessThanOrEqual(0);
      expect(await head.evaluate((h) => h.scrollWidth - h.clientWidth)).toBeLessThanOrEqual(0);   // and nothing inside the header runs past its own edge (a sliding strip keeps its tabs to itself)
      expect(errors).toEqual([]);
    });
  }

  test('To-dos: + Add a to-do takes you to the box that adds one', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO, '/sales/tasks': TASKS } });
    await page.goto('/todos.html');
    await page.locator('#addJump').click();
    await expect(page.locator('#addTitle')).toBeFocused();
  });

  for (const p of PAGES) {
    test(`${p.name}: no serious or critical accessibility findings in the header, light and dark`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once');
      test.slow();
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await p.open(page);
        await expect(page.locator('header.dds-ph h1')).toBeVisible();
        if (p.want.line) await expect(page.locator('header.dds-ph .dds-ph-line')).toHaveText(p.want.line);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('header.dds-ph').analyze();
        const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        expect(serious.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      }
    });
  }
});
