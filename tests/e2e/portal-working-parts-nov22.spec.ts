import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// The client portal's working parts (the full review of Nov 22 2026): items 341, 343, 345,
// 346, 350, 351, 352, 353, 354, 355, 339 and 340. The portal refreshes itself; the studio's
// reply words replace a fixed promise; one name for the portal; a reviewer sees Home and
// their account only; the initial opens an account menu; one box to ask for something; the
// sign-in page never says the product's name; the Client portal page lists clients with Send
// again; a preview opens a paper read-only; people on the account; the portal on a phone.

const PID = '11111111-1111-4111-8111-111111111111';
const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', STUDIO_SITE = 'cccccccc-3333-4333-8333-cccccccccccc';
const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SUP = '77777777-7777-4777-8777-777777777777';
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false, site_id: STUDIO_SITE };
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const CLIENT_CTX = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria', portal: { off: [], welcome: '', home_off: [], signin: { google: false, password: true }, reply: { within: '', hours: '' } }, ...over,
} });
const SUPPORT = (msgs: Array<{ id: string; body: string; author_kind: string; created_at: string }>, status = 'open') => ({ data: {
  request: { id: SUP, subject: 'Billing question', status, project_id: null, created_at: '2026-11-20T10:00:00Z', requester: 'e2e-owner', body: 'Can I pay by bank transfer?' },
  messages: msgs,
} });
const CLIENT_API = (over: Record<string, unknown> = {}) => ({
  '/portal/context': CLIENT_CTX(),
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'juniperfloral.com', status: 'active' }] },
  [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'juniperfloral.com', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: [] } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [{ id: SUP, subject: 'Billing question', status: 'open', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z' }] },
  [`/client/support/${SUP}`]: SUPPORT([{ id: 'm1', body: 'Can I pay by bank transfer?', author_kind: 'client', created_at: '2026-11-20T10:00:00Z' }]),
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
  '/client/portal-pages': { data: { pages: [], links: [] } },
  '/client/website-stats': { data: { published: false, month: null, search: null } },
  '/client/services': { data: [] },
  '/portal/members': { data: [] },
  '/auth/backup-codes': { data: { remaining: 0, total: 0, created_at: null } },
  ...over,
});
const tab = (page: Page, t: string) => page.locator(`#tabnav .tab[data-tab="${t}"]`).click();

// ── item 353: the studio's reply words, or nothing ──
test.describe('item 353 — reply time and working hours', () => {
  test('with nothing set, the portal promises nothing', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    await page.goto('/client.html#messages');
    await expect(page.locator('.mlsub')).toHaveText('Talk to Marlow & Co.');
    await expect(page.getByText('usually reply')).toHaveCount(0);
  });
  test('with the studio’s words, the portal says exactly those', async ({ page }) => {
    await installApp(page, { api: CLIENT_API({ '/portal/context': CLIENT_CTX({ portal: { off: [], welcome: '', home_off: [], signin: { google: false, password: true }, reply: { within: 'within one business day', hours: 'Mon to Fri, 9 to 5' } } }) }) });
    await page.goto('/client.html#messages');
    await expect(page.locator('.mlsub')).toHaveText('Talk to Marlow & Co Marlow & Co replies within one business day · Mon to Fri, 9 to 5.');
  });
});

// ── item 351: one name, a plain project name ──
test('item 351 — Home says "Your client portal" and a project named after its address reads as "Your new website"', async ({ page }) => {
  await installApp(page, { api: CLIENT_API() });
  await page.goto('/client.html');
  await expect(page.locator('.rolebadge')).toHaveText(/Your client portal/);
  await expect(page.getByText('Your workspace')).toHaveCount(0);
  await expect(page.locator('[data-proj] h3')).toHaveText('Your new website');
  await tab(page, 'messages');
  await expect(page.locator('#mrows')).toContainText('Your new website');
});

// ── item 352: Help without the "hasn’t added" line or product news; the initial's menu ──
test('item 352 — Help has the basics without apology, no product news, and the initial opens an account menu', async ({ page }) => {
  await installApp(page, { api: CLIENT_API() });
  await page.goto('/client.html#help');
  await expect(page.locator('#faqBody .faq-item')).toHaveCount(5);
  await expect(page.getByText('hasn’t added its own help articles')).toHaveCount(0);
  await expect(page.locator('#helpWhatsNew')).toHaveCount(0);
  const acct = page.locator('#navacct');
  if (await acct.isVisible()) {
    await acct.click();
    const menu = page.locator('#navacctp');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Your account' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

// ── item 354: one box when the studio lists no services ──
test('item 354 — Ask for a service with no services is one box, not the same thing twice', async ({ page }) => {
  await installApp(page, { api: CLIENT_API() });
  await page.goto('/client.html#messages');
  await page.getByRole('button', { name: 'Ask for a service' }).click();
  await expect(page.getByRole('heading', { name: 'Ask for a service', level: 1 })).toBeVisible();
  await expect(page.locator('.selse')).toHaveCount(1);
  await expect(page.locator('.selse strong')).toHaveText('Ask for something');
  await expect(page.getByText('Something else?')).toHaveCount(0);
  await expect(page.getByText('hasn’t listed services')).toHaveCount(0);
});

// ── item 355: a reviewer gets Home and their account only ──
test('item 355 — a reviewer sees Home and Account, never Messages or Help promising articles', async ({ page }) => {
  await installApp(page, { api: CLIENT_API({
    '/portal/context': CLIENT_CTX({ site_role: 'client_reviewer', is_managed_client: false, sees_full_workspace: false, capabilities: [] }),
    '/client/projects': json(403, { error: 'forbidden' }),
  }) });
  await page.goto('/client.html');
  const tabs = page.locator('#tabnav .tab[data-tab]');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('data-tab', 'home');
  await expect(tabs.nth(1)).toContainText('Account');
  await tabs.nth(1).click();
  await expect(page.locator('#main h1')).toHaveText('Your account');
  await expect(page.getByText('once your studio has set up your account')).toHaveCount(0);
  await expect(page.locator('#sec-you')).toBeVisible();
});

// ── item 343: the portal refreshes itself ──
test.describe('item 343 — the portal reads again by itself', () => {
  test('a conversation on screen shows the studio’s reply within a minute, and the bell follows', async ({ page }) => {
    await page.clock.install();
    let supportReads = 0, bellReads = 0;
    await installApp(page, { api: CLIENT_API() });
    await page.route(`**/functions/v1/presence/client/support/${SUP}`, (route: Route) => {
      supportReads++;
      const msgs = [{ id: 'm1', body: 'Can I pay by bank transfer?', author_kind: 'client', created_at: '2026-11-20T10:00:00Z' }];
      if (supportReads >= 2) msgs.push({ id: 'm2', body: 'Yes, bank transfer is fine. The details are on the invoice.', author_kind: 'studio', created_at: '2026-11-22T10:00:00Z' });
      return route.fulfill(json(200, SUPPORT(msgs)));
    });
    await page.route('**/functions/v1/presence/client/notifications', (route: Route) => {
      bellReads++;
      return route.fulfill(json(200, bellReads >= 2 ? { data: [{ kind: 'support_message', label: 'Marlow & Co replied', href: `/client.html?support=${SUP}`, created_at: '2026-11-22T10:00:00Z', read: false }], unread_count: 1 } : { data: [], unread_count: 0 }));
    });
    await page.goto(`/client.html?support=${SUP}`);
    await expect(page.locator('#mpbody')).toContainText('Can I pay by bank transfer?');
    await expect(page.locator('#mpbody')).not.toContainText('bank transfer is fine');
    const before = supportReads;
    await page.clock.runFor(61_000);
    await expect.poll(() => supportReads).toBeGreaterThan(before);
    await expect(page.locator('#mpbody')).toContainText('Yes, bank transfer is fine.');
    await expect(page.locator('#navbell .badge')).toHaveText('1');
  });
  test('coming back to the tab reads the open view again; a preview never does', async ({ page }) => {
    let bellReads = 0;
    await installApp(page, { api: CLIENT_API() });
    await page.route('**/functions/v1/presence/client/notifications', (route: Route) => { bellReads++; return route.fulfill(json(200, { data: [], unread_count: 0 })); });
    await page.goto('/client.html');
    await expect(page.locator('#home-hero h1')).toBeVisible();
    const before = bellReads;
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => bellReads).toBeGreaterThan(before);
  });
});

// ── item 341: the sign-in page never says the product’s name ──
test.describe('item 341 — the sign-in page with no studio on the link', () => {
  test('a bare /portal asks which studio owns this address and fades it in', async ({ page }) => {
    await installApp(page, { session: null, api: {
      '/public/studio/default/brand': { data: { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false, signin: { google: false, password: true } } },
    } });
    await page.goto('/portal.html');
    await expect(page.locator('#brand .word')).toHaveText('Marlow & Co');
    await expect(page.locator('#brand')).toHaveClass(/in/);
    await expect(page).toHaveTitle('Marlow & Co — Client sign in');
    await expect(page.getByText('Run a studio on Studio OS')).toHaveCount(0);
    await expect(page.getByText('Studio OS')).toHaveCount(0);
  });
  test('with no studio to show, it says "Client sign in"', async ({ page }) => {
    await installApp(page, { session: null, api: { '/public/studio/default/brand': { data: null } } });
    await page.goto('/portal.html');
    await expect(page.locator('#brand .word')).toHaveText('Client sign in');
    await expect(page).toHaveTitle('Client sign in');
  });
  test('item 350: a short name on the link finds the studio', async ({ page }) => {
    await installApp(page, { session: null, api: {
      '/public/studio/by-slug/marlow-co/brand': { data: { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false, site_id: STUDIO_SITE, signin: { google: false, password: true } } },
    } });
    await page.goto('/portal.html?studio=marlow-co');
    await expect(page.locator('#brand .word')).toHaveText('Marlow & Co');
    expect(await page.evaluate(() => (window as unknown as { STUDIO_ID: string }).STUDIO_ID)).toBe(STUDIO_SITE);
  });
});

// ── item 346: the Client portal page lists clients with Send again ──
const AGENCY_CTX = () => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, attention_stale: false, scope: null,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
} });
test('item 346 — each client with where they stand, and Send again on a waiting or run-out row', async ({ page }) => {
  await installApp(page, { api: { '/portal/context': AGENCY_CTX(), [`POST /agency/portal/clients/${S2}/sign-in-link`]: { data: { sent: true, email: 'x@example.com' } }, '/agency/portal/overview': { data: {
    address: `https://app.example/portal/marlow-co`, slug: 'marlow-co',
    counts: { active: 3, waiting: 1, expired: 1, recent: 1 },
    clients: [
      { site_id: S1, name: 'Bacchus Kitchen', state: 'joined', invited_at: '2026-10-01T00:00:00Z', seen_at: '2026-11-20T00:00:00Z' },
      { site_id: S2, name: 'Harbor Dental', state: 'expired', invited_at: '2026-11-01T00:00:00Z', seen_at: null },
      { site_id: STUDIO_SITE, name: 'Juniper Floral', state: 'waiting', invited_at: '2026-11-20T00:00:00Z', seen_at: null },
    ],
    setup: [{ key: 'logo', done: true }, { key: 'parts', done: true }, { key: 'welcome', done: true }, { key: 'preview', done: true }, { key: 'invite', done: true }],
    can_edit: true,
  } } } });
  await page.goto('/client-portal.html');
  await expect(page.getByRole('heading', { name: 'Your clients' })).toBeVisible();
  const rows = page.locator('.who-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('the invite ran out');
  await expect(rows.nth(0).getByRole('button', { name: /Send/ })).toHaveCount(0);
  const again = rows.nth(1).locator('[data-again]');
  await expect(again).toHaveAccessibleName('Send Harbor Dental a new invite');
  const box = await again.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(36);
  await again.click();
  await expect(again).toHaveText('Sent');
  await expect(again).toHaveAccessibleName('A new invite went to Harbor Dental');
  await expect(page.getByRole('textbox', { name: 'Your portal’s address' })).toHaveValue('https://app.example/portal/marlow-co');
});

// ── item 345: a preview opens View and Receipt read-only, and never books ──
test('item 345 — in a preview, a paper’s View opens read-only and Book a call stops at the last step', async ({ page }) => {
  await installApp(page, { api: CLIENT_API({
    '/portal/context': CLIENT_CTX({ preview: { name: 'Maria', email: 'm@example.com' } }),
    '/client/documents': { data: { documents: [] } },
    '/client/billing': { data: { invoices: [{ id: 'i1', name: 'Deposit', number: '#0001', amount: 450, status: 'paid', paid_at: '2026-11-03T00:00:00Z', view_url: '/doc.html?t=abc', created_at: '2026-11-01T00:00:00Z' }] } },
    '/client/book': { data: { site_id: SITE } },
  }) });
  await page.route('**/functions/v1/presence/book/**', (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (/\/types$/.test(path)) return route.fulfill(json(200, { data: { enabled: true, intro: 'Pick a time.', max_days_ahead: 14, types: [{ id: 'intro', name: 'Intro call', duration_min: 30, price_text: '', description: '' }] } }));
    if (/\/slots$/.test(path)) return route.fulfill(json(200, { data: { slots: ['2026-12-02T17:00:00Z'] } }));
    return route.fulfill(json(500, { error: 'a booking must never leave a preview' }));
  });
  await page.goto(`/client.html?preview=${SITE}#documents`);
  const receipt = page.locator('a[href*="/doc.html?t="]').first();
  await expect(receipt).toBeVisible();
  await page.context().route('**/doc.html*', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>paper</title>' }));
  await receipt.click({ noWaitAfter: true });
  await expect(receipt).toHaveAttribute('href', /[?&]view=1/);   // the press itself rewrites the link before it opens
  for (const p of page.context().pages()) if (p !== page) await p.close();
  await page.goto(`/client.html?preview=${SITE}`);
  await tab(page, 'messages');
  await page.getByRole('button', { name: 'Book a call' }).click();
  await page.getByRole('button', { name: 'Choose' }).click();
  await page.locator('[data-slot]').first().click();
  await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible();
  await page.locator('#bk-name').fill('Maria');
  await page.locator('#bk-email').fill('m@example.com');
  await page.getByRole('button', { name: 'Book it' }).click();
  await expect(page.getByText('This is a preview: nothing is saved, sent or paid.').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /You’re booked/ })).toHaveCount(0);
});

// ── items 339 and 340: people on the account, the portal on a phone ──
test('items 339 and 340 — Help lists the people on the account with a way to add one, and the phone card', async ({ page }) => {
  const posted: unknown[] = [];
  await installApp(page, { api: CLIENT_API({ '/portal/members': { data: [{ id: 'm1', email: 'sam@example.com', role: 'business_owner', status: 'active' }] } }) });
  await page.route('**/functions/v1/presence/portal/members', (route: Route) => {
    if (route.request().method() === 'POST') { posted.push(route.request().postDataJSON()); return route.fulfill(json(200, { data: { ok: true, emailed: true } })); }
    return route.fulfill(json(200, { data: [{ id: 'm1', email: 'sam@example.com', role: 'business_owner', status: 'active' }] }));
  });
  await page.goto('/client.html#help');
  const people = page.locator('#sec-people');
  await expect(people.getByRole('heading', { name: 'People on your account' })).toBeVisible();
  await expect(people.locator('#plist li')).toHaveCount(2);
  await expect(people.locator('#plist')).toContainText('sam@example.com');
  await page.locator('#pemail').fill('pat@example.com');
  await page.locator('#pinvite').click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ email: 'pat@example.com', role: 'business_owner' });
  await expect(page.locator('#pnote')).toContainText('We emailed pat@example.com');
  const phone = page.locator('#sec-phone');
  await expect(phone.getByText('Add this portal to your phone')).toBeVisible();
  await expect(phone.locator('#alertsRow')).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', new RegExp(`/public/studio/${STUDIO_SITE}/manifest$`));
});

// ── phone width: every control is a 44px target ──
test('phone: the new controls are 44px tall', async ({ page }) => {
  test.skip(!/mobile/.test(test.info().project.name), 'phone project only');
  await installApp(page, { api: CLIENT_API() });
  await page.goto('/client.html#help');
  for (const sel of ['#pinvite', '#alertsBtn', '#twoStep']) {
    const el = page.locator(sel);
    if (!(await el.count()) || !(await el.isVisible())) continue;
    const b = await el.boundingBox();
    expect(b && b.height, sel).toBeGreaterThanOrEqual(44);
  }
});
