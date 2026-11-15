import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { expectOneHeader } from './helpers/page-header';

// Builder item 165 (Figma 295:3), group 2: the one page header on Customers, Contacts, the Inbox
// (and a client's Messages), Send an update, Analytics, Files, Visual Studio, Help and the Health
// Center. Each page loads with fixtures shaped like its own spec's, then the shared helper checks
// the header the same way on every page, and axe reads the header in light and dark. Every name
// here is made up.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const ymd = (d: number) => { const t = new Date(Date.now() + d * DAY); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };

// ── Customers: customers-preview.spec's shapes ──
const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', person_name: 'Ada Park', email: 'ada@acme.example', project_id: 'p1', project_name: 'Website rebuild', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', person_name: 'Bo Reyes', email: 'bo@beta.example', project_id: 'p2', project_name: 'Booking page', status: 'on_hold', customer_site_id: null, open_support: 0, project_count: 1 },
  { client_id: 'c-cedar', name: 'Cedar Garage', person_name: '', email: 'hi@cedar.example', project_id: 'p3', project_name: 'Site', status: 'complete', customer_site_id: 'site-cedar', open_support: 0, project_count: 2 },
] };
const RECEIVABLES = { data: { items: [
  { id: 'i1', title: 'Deposit', amount_cents: 120000, due_date: ymd(-3), status: 'open', state: 'overdue', overdue: true, deal_id: 'd1', client_id: 'c-acme', customer_site_id: 'site-acme' },
  { id: 'i3', title: 'Invoice', amount_cents: 80000, due_date: ymd(9), status: 'open', state: 'upcoming', overdue: false, deal_id: 'd2', client_id: 'c-cedar', customer_site_id: 'site-cedar' },
], paid: [], total_cents: 200000, overdue_cents: 120000 } };
const PEOPLE = { data: [
  { id: 'ct-1', name: 'Ada Park', email: 'ada@acme.example', phone: '', company: 'Acme Bakery', client_id: 'c-acme', updated_at: ago(2) },
  { id: 'ct-2', name: 'Lena Moss', email: 'lena@example.com', phone: '', company: '', client_id: null, updated_at: ago(5) },
], total: 2 };
const CUST_API = { '/studio/customers': CUSTOMERS, '/sales/receivables': RECEIVABLES, '/sales/contacts': PEOPLE };

// ── Contacts: rosters.spec's shapes ──
const CONTACTS = { data: [
  { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '(555) 111-2222', company: 'Acme', updated_at: ago(2) },
  { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com', phone: '', company: 'Beta', updated_at: ago(90) },
] };

// ── Inbox: inbox-chips.spec's feed ──
const FEED = { data: {
  role: 'business_owner', moments: [], notices: [], last_published: null,
  pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
  client_messages: [
    { type: 'message', project: 'Site build', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', client_id: 'c-1', client: 'Juniper Floral Co.', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 2, thread_key: 'client:c-1', unread: true, href: '/projects.html' },
    { type: 'support', id: 's-1', subject: 'Logo tweak', status: 'open', project: '', client_id: 'c-1', client: 'Juniper Floral Co.', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
  ],
  enquiries: [],
} };
const INBOX_API = { '/portal/feed': FEED, '/forms/inbox': { data: { submissions: [], unread: 0 } }, '/notifications': { data: [], unread_count: 0 } };

// ── Send an update: broadcasts.spec's lists and history ──
const BC_API = {
  '/broadcasts': { data: { broadcasts: [{ id: 'cccccccc-3333-4333-8333-cccccccccccc', subject: 'June recap', audience: 'contacts', status: 'sent', scheduled_at: null, sent_at: '2026-06-30T10:00:00Z', recipient_count: 46, sent_count: 42, skipped_count: 3, failed_count: 1, created_at: '2026-06-30T09:00:00Z' }] } },
  '/broadcasts/segments': { data: { segments: [
    { key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 12 },
    { key: 'enquiries', label: 'All website enquiries', description: 'Everyone who has messaged you through your website.', count: 8 },
  ] } },
};

// ── Analytics: analytics.spec's dashboard ──
const DASH = { data: {
  period: 'this_month', generated_at: '2026-07-17T14:14:00Z',
  sales: {
    pipeline: { open: { count: 2, value_cents: 360000 }, stages: [{ stage: 'lead', label: 'New lead', count: 2, value_cents: 360000 }] },
    won: { this_month: { count: 1, value_cents: 145000 }, last_month: { count: 0, value_cents: 0 } },
    enquiries: { count: 3, unanswered: 1, weekly: [1, 0, 2, 1, 0, 1, 2, 1, 0, 1, 2, 3] },
    support: { open: 1, oldest_age_days: 2 },
    invoices: { paid_cents: 90000, sent_cents: 0, overdue_cents: 0, outstanding_cents: 0, paid_count: 1, sent_count: 0, overdue_count: 0 },
    recent_wins: [{ title: 'Patio rebuild', value_cents: 145000, closed_at: '2026-07-12T00:00:00Z' }],
  },
  website: { traffic: { visitors: 40, pageviews: 90, actions: 2, top_pages: [{ path: '/', views: 50 }], top_sources: [{ source: 'Google', visits: 20, share: 50 }], weekly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], has_data: true },
    search: { clicks: 4, impressions: 300, period: '2026-06', top_terms: [{ term: 'patio builder', clicks: 4, impressions: 300 }] } },
} };

// ── Files: files-layout.spec's library ──
const fid = (n: number) => `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const fbase = { tags: [], asset_status: 'approved', state: 'approved', created_at: new Date().toISOString(), favorite: false, in_use: false, kind: 'image', mime: 'image/jpeg', bytes: 40000 };
const FILES_API = {
  '/assets/collections': { data: [{ name: 'Brand', count: 1 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [
    { ...fbase, id: fid(1), name: 'Brightline logo', alt_text: 'Logo', brand: true, in_use: true, collection: 'Brand' },
    { ...fbase, id: fid(2), name: 'Shopfront at dusk', alt_text: 'Shopfront', in_use: true },
    { ...fbase, id: fid(3), name: 'Bouquet', alt_text: 'Bouquet', client_id: 'c1', client_name: 'Juniper Floral Co.', project_id: 'p1', client_private: true },
  ], total: 3, shown: 3, live_count: 2, policy: 'immediate' } },
};

// ── Visual Studio: visual-studio.spec's kinds ──
const KINDS = { data: { available: true, kinds: [
  { kind: 'hero', label: 'Page banner', purpose: 'The wide image across the top of a page.', width: 1600, height: 900, aspect: '16:9' },
  { kind: 'general', label: 'General image', purpose: 'A general-purpose image for anywhere on your site.', width: 1024, height: 1024, aspect: '1:1' },
] } };

// ── the Health Center: admin-health.spec's areas ──
const HC = { data: { overall: 'attention', areas: [
  { key: 'platform', label: 'Platform', state: 'ok', detail: 'All required configuration is present.' },
  { key: 'domains', label: 'Domains', state: 'attention', detail: '2 expiring within 30 days.' },
  { key: 'usage', label: 'Usage', state: 'ok', detail: '12 sites live.' },
] } };

const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const STUDIO_CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: true, sees_full_workspace: true,
  is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } };

type Open = (page: Page) => Promise<void>;
type Want = Parameters<typeof expectOneHeader>[1];
const PAGES: Array<{ name: string; open: Open; want: Want; ready?: string }> = [
  { name: 'Customers', open: async (page) => { await installApp(page, { api: CUST_API }); await page.goto('/customers.html'); },
    want: { title: 'Customers', icon: 'customers', line: /^3 customers · \$2,000 owed to you · Updated just now/, picker: 'All customers', filled: '+ Add a customer', tabs: ['Customers', /^People/] as unknown as string[] } },
  { name: 'Customers, the People tab', open: async (page) => { await installApp(page, { api: CUST_API }); await page.goto('/customers.html?tab=people'); },
    want: { title: 'Customers', icon: 'customers', line: '2 people · 1 not a customer yet', filled: null } },
  { name: 'Contacts', open: async (page) => { await installApp(page, { api: { '/sales/contacts': CONTACTS } }); await page.goto('/contacts.html'); },
    want: { title: 'Contacts', icon: 'customers', line: /^2 contacts · Updated just now/, picker: 'All contacts', filled: '+ Add a contact' } },
  { name: 'Inbox', open: async (page) => { await installApp(page, { api: INBOX_API }); await page.goto('/inbox.html'); },
    want: { title: 'Inbox', icon: 'inbox', line: /^\d+ conversations · \d+ waiting for a reply/, picker: 'Everything', filled: null }, ready: '#rows [role=option]' },
  { name: 'a client’s Messages', open: async (page) => { await installApp(page, { api: { ...INBOX_API, '/portal/context': STUDIO_CTX } }); await page.goto(`/inbox.html?client=${CLIENT}`); },
    want: { title: 'Messages', icon: 'messages', line: /conversation/, picker: 'Everything', filled: null }, ready: '#rows [role=option]' },
  { name: 'Send an update', open: async (page) => { await installApp(page, { api: BC_API }); await page.goto('/broadcasts.html'); },
    want: { title: 'Send an update', icon: 'update', trail: 'Inbox', line: /^One email to many people\./, filled: 'Write an update' } },
  // builder item 202's names: inside a client the Inbox is their Messages, so the trail says so
  { name: 'a client’s Send an update', open: async (page) => { await installApp(page, { api: { ...BC_API, '/portal/context': STUDIO_CTX } }); await page.goto(`/broadcasts.html?client=${CLIENT}`); },
    want: { title: 'Send an update', icon: 'update', trail: 'Messages', line: /^One email to many people\./, filled: 'Write an update' } },
  { name: 'Analytics', open: async (page) => { await installApp(page, { api: { '/analytics/dashboard': DASH } }); await page.goto('/analytics.html'); },
    want: { title: 'Analytics', icon: 'analytics', line: /^Your business at a glance\. Numbers only where they’re real\.\s*·\s*As of /, filled: null } },
  { name: 'Files', open: async (page) => { await installApp(page, { api: FILES_API }); await page.goto('/files.html'); },
    want: { title: 'Files', icon: 'files', line: /^2 files · 1 private to a client · Updated just now/, filled: '+ Add files' } },
  { name: 'Visual Studio', open: async (page) => { await installApp(page, { api: { '/visual/kinds': KINDS, '/visual/plans': { data: [] } } }); await page.goto('/visual-studio.html'); },
    want: { title: 'Visual Studio', icon: 'spark', trail: 'Files', line: /^Make images for your website/, filled: null } },
  { name: 'Help', open: async (page) => { await installApp(page); await page.goto('/help.html'); },
    want: { title: 'Help', icon: 'help', line: /^How can we help\?$/, filled: null } },
  { name: 'Health Center', open: async (page) => { await installApp(page, { api: { '/admin/health-center': HC } }); await page.goto('/admin-health.html'); },
    want: { title: 'Health Center', icon: 'health', line: 'How every site is doing, in one place: online, fast, secure and found on Google.', filled: null }, ready: '#refreshBtn:not([hidden])' },
];

test.describe('One page header, group 2 (builder item 165)', () => {
  for (const p of PAGES) {
    test(`${p.name}: the icon, the title, its line, the actions with at most one filled`, { tag: '@layout' }, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await p.open(page);
      if (p.ready) await expect(page.locator(p.ready).first()).toBeAttached();
      await expectOneHeader(page, p.want);
      const head = page.locator('header.dds-ph');
      if ((page.viewportSize()?.width || 0) < 761 && await head.locator('.dds-ph-more > :not([hidden])').count()) {
        // the others wait behind ⋯ in a sheet; Escape puts it away
        await head.locator('.dds-ph-dots').click();
        await expect(head.locator('.dds-ph-more')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(head.locator('.dds-ph-more')).toBeHidden();
      }
      // nothing in the header spills sideways (the header and everything in it end inside the window)
      expect(await head.evaluate((h) => Math.max(...[h, ...h.querySelectorAll('*')].filter((e) => e.getClientRects().length > 0).map((e) => e.getBoundingClientRect().right)) - window.innerWidth)).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }

  test('Customers: the view picker beside the title still opens its menu and changes the view', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: CUST_API });
    await page.goto('/customers.html');
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="owes"]').click();
    await expect(page.locator('#viewBtn')).toContainText('Owes you');
    await expect(page.locator('#lmeta')).toContainText('2 customers');
    await page.locator('#tabPeople').click();
    await expect(page.locator('header.dds-ph h1')).toHaveText('Customers');   // People keeps the page's title, with its tab
    await expect(page.locator('#tabPeople')).toHaveAttribute('aria-selected', 'true');
  });

  test('Inbox: the old tools menu’s items are the header’s other actions and still open', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: INBOX_API });
    await page.goto('/inbox.html');
    const head = page.locator('header.dds-ph');
    if ((page.viewportSize()?.width || 0) < 761) await head.locator('.dds-ph-dots').click();
    await expect(head.locator('#sendUpdate')).toHaveAttribute('href', '/broadcasts.html');
    await head.locator('#ovfSaved').click();
    await expect(page.locator('#sheet-list')).toBeVisible();
    await expect(page.locator('#ovfBtn')).toHaveCount(0);   // one ⋯, the header's
  });

  test('Send an update: Write an update takes you to the message', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: BC_API });
    await page.goto('/broadcasts.html');
    await page.locator('#writeJump').click();
    await expect(page.locator('#subj')).toBeFocused();
  });

  for (const p of PAGES) {
    test(`${p.name}: no serious or critical accessibility findings in the header, light and dark`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once');
      test.slow();
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await p.open(page);
        await expect(page.locator('header.dds-ph h1')).toBeVisible();
        if (p.ready) await expect(page.locator(p.ready).first()).toBeAttached();
        if (p.want.line) await expect(page.locator('header.dds-ph .dds-ph-line')).toHaveText(p.want.line);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('header.dds-ph').analyze();
        const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        expect(serious.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      }
    });
  }
});
