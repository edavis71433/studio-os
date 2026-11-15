import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list items 229, 233 and 238 (Nov 2026), drawn in Figma first (page "Client
// portal — from the Agiled check"). A studio turns parts of its clients' portal off, for
// every client or for one; writes a welcome note for the top of their Home and picks
// Home's cards. The portal leaves out what's off and never reads it. Documents appears
// with the first paper and stays from then on.

const PID = '22222222-2222-4222-8222-222222222222';
const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PAPERS_KEY = 'dds-portal-papers:e2e-owner';   // helpers/app.ts signs in as e2e-owner
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ymd = (offsetDays: number) => {
  const t = new Date(Date.now() + offsetDays * 86400000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

// ── the portal ──
type Portal = { off?: string[]; welcome?: string; home_off?: string[] } | null;
const CLIENT_CTX = (portal: Portal) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria',
  portal: portal && { off: portal.off || [], welcome: portal.welcome || '', home_off: portal.home_off || [] },
} });
const FILES = [{ id: 'f1', title: 'Homepage mockup.png', note: '', created_at: '2026-11-03T15:00:00Z' }];
const bundle = (deliverables: unknown[] = []) => ({ data: {
  project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [],
  progress: { total: 0, done: 0, pct: 0 }, deliverables, approvals: [],
} });
const INVOICES = [{ id: 'i1', name: 'Website build, second half', amount: 450, status: 'open', due_date: ymd(3), created_at: '2026-11-04T15:00:00Z', pay_url: 'https://pay.example/i1', view_url: 'https://docs.example/i1' }];
const DOCS = [
  { kind: 'estimate', id: 'e1', title: 'Spring refresh', status: 'sent', amount: 1200, created_at: '2026-10-21T15:00:00Z', view_url: 'https://docs.example/e1' },
  { kind: 'contract', id: 'c1', title: 'Website agreement', status: 'signed', signed_at: '2026-09-03T18:00:00Z', created_at: '2026-09-03T16:00:00Z', view_url: 'https://docs.example/c1' },
];
const PORTAL_API = (portal: Portal, over: Record<string, unknown> = {}) => ({
  '/portal/context': CLIENT_CTX(portal),
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: bundle(FILES),
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/documents': { data: { documents: DOCS } },
  '/client/billing': { data: { invoices: INVOICES } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '<p>How to log in.</p>', faq: { items: [] } } },
  '/client/kit': { data: null },
  ...over,
});
// nothing anywhere yet: a new client
const NOTHING = { '/client/billing': { data: { invoices: [] } }, '/client/documents': { data: { documents: [] } }, '/client/reports': { data: { reports: [] } }, [`/client/projects/${PID}`]: bundle([]) };
function readsOf(page: Page) {
  const paths: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/functions/v1/presence/')) paths.push(u.pathname.replace(/^.*\/functions\/v1\/presence/, '')); });
  return paths;
}
const tabsOf = (page: Page) => page.locator('#tabnav [data-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')));
const papersKept = (page: Page) => page.evaluate((k) => localStorage.getItem(k), PAPERS_KEY);

test.describe('items 229, 233 and 238 — the client’s side', () => {
  test('parts the studio turned off are gone from Documents, and never read', async ({ page }) => {
    const reads = readsOf(page);
    await installApp(page, { api: PORTAL_API({ off: ['invoices', 'reports'] }) });
    await page.goto('/client.html');
    await expect(page.locator('#home-hero')).toBeVisible();
    expect(await tabsOf(page)).toEqual(['home', 'messages', 'documents', 'help']);
    await page.locator('#tabnav [data-tab="documents"]').click();
    await expect(page.locator('#shelf .srow', { hasText: 'Spring refresh' })).toBeVisible();
    await expect(page.locator('#shelf .srow', { hasText: 'Website agreement' })).toBeVisible();
    await expect(page.locator('#shelf .srow', { hasText: 'Website build, second half' })).toHaveCount(0);
    await expect(page.locator('#inv-unpaid')).toHaveCount(0);
    await expect(page.locator('.shelfnav [data-shelf="invoices"], .shelfnav [data-shelf="reports"]')).toHaveCount(0);
    expect(reads.filter((p) => p === '/client/billing' || p === '/client/reports')).toEqual([]);
  });

  test('with Messages off: Book a call stays, Help has no “Still need help?”, a project shows Activity with nothing to write in', async ({ page }) => {
    const reads = readsOf(page);
    await installApp(page, { api: PORTAL_API({ off: ['messages', 'services'] }) });
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="messages"]').click();
    await expect(page.locator('#main header .sub')).toHaveText('Marlow & Co takes messages another way.');
    await expect(page.getByRole('button', { name: /Book a call/ })).toBeVisible();
    await expect(page.locator('#mnew')).toHaveCount(0);
    await page.locator('#tabnav [data-tab="help"]').click();
    await expect(page.getByText('How to log in.')).toBeVisible();
    await expect(page.locator('#helpMsg')).toHaveCount(0);
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.locator('#sec-messages h2')).toHaveText('Activity');
    await expect(page.locator('#msg')).toHaveCount(0);
    await expect(page.locator('.chipbar [data-chip="sec-messages"]')).toHaveText('Activity');
    expect(reads.filter((p) => p.endsWith('/messages') || p.startsWith('/client/support'))).toEqual([]);
  });

  test('with Messages, booking and services all off there’s no Messages door, and #messages opens Home', async ({ page }) => {
    await installApp(page, { api: PORTAL_API({ off: ['messages', 'book', 'services'] }) });
    await page.goto('/client.html#messages');
    await expect(page.locator('#home-hero')).toBeVisible();
    expect(await tabsOf(page)).toEqual(['home', 'documents', 'help']);
    await expect(page.locator('#tabnav [data-tab="home"]')).toHaveAttribute('aria-current', 'page');
  });

  test('with Files off a project has no Files section, chip or count', async ({ page }) => {
    await installApp(page, { api: PORTAL_API({ off: ['files'] }) });
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.locator('#sec-messages')).toBeVisible();
    await expect(page.locator('#sec-files')).toHaveCount(0);
    await expect(page.locator('.chipbar [data-chip="sec-files"]')).toHaveCount(0);
    await expect(page.locator('#sec-overview')).not.toContainText('Files shared');
  });

  test('the welcome note sits under the greeting, signed by the studio, as plain text; Home shows the studio’s cards', async ({ page }) => {
    await installApp(page, { api: PORTAL_API({ welcome: 'Thanks for working with us!\nEverything is here. <b>Ask away</b>', home_off: ['updates', 'projects'] }) });
    await page.goto('/client.html');
    const note = page.locator('#home-note');
    await expect(note).toBeVisible();
    await expect(note.locator('.wntext')).toHaveText('Thanks for working with us!Everything is here. <b>Ask away</b>');
    await expect(note.locator('.wntext br')).toHaveCount(1);
    await expect(note.locator('.wntext b')).toHaveCount(0);
    await expect(note.locator('.wnby')).toHaveText('Marlow & Co');
    await expect(note).toHaveAttribute('aria-label', 'A note from Marlow & Co');
    // the note comes after the greeting
    expect(await page.evaluate(() => { const h = document.getElementById('home-hero'), n = document.getElementById('home-note'); return !!(h && n && (h.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)); })).toBe(true);
    await expect(page.locator('#home-needs')).toBeVisible();
    await expect(page.locator('#home-website')).toHaveCount(1);
    await expect(page.locator('#home-updates')).toHaveCount(0);
    await expect(page.locator('#home-projects')).toHaveCount(0);
  });

  test('no note and no choices: Home as before', async ({ page }) => {
    await installApp(page, { api: PORTAL_API(null) });
    await page.goto('/client.html');
    await expect(page.locator('#home-projects')).toBeVisible();
    await expect(page.locator('#home-updates')).toBeVisible();
    await expect(page.locator('#home-note')).toHaveCount(0);
  });

  test('238: a new client with nothing yet sees no Documents door, and #documents opens Home', async ({ page }) => {
    await installApp(page, { api: PORTAL_API(null, NOTHING) });
    await page.goto('/client.html#documents');
    await expect(page.locator('#home-hero')).toBeVisible();
    expect(await tabsOf(page)).toEqual(['home', 'messages', 'help']);
    expect(await papersKept(page)).toBeNull();
  });

  test('238: the first paper brings the door, and it stays from then on', async ({ page }) => {
    await installApp(page, { api: PORTAL_API(null, { ...NOTHING, '/client/billing': { data: { invoices: INVOICES } } }) });
    await page.goto('/client.html');
    await expect(page.locator('#tabnav [data-tab="documents"]')).toBeVisible();
    expect(await papersKept(page)).toBe('1');
    // the invoice is gone (voided, say): the door stays, without waiting for any read
    await page.goto('about:blank');
    await installApp(page, { api: PORTAL_API(null, NOTHING) });
    await page.goto('/client.html');
    await expect(page.locator('#home-hero')).toBeVisible();
    expect(await tabsOf(page)).toEqual(['home', 'messages', 'documents', 'help']);
  });

  test('238: a client whose only papers are files sees the door when their project lands', async ({ page }) => {
    await installApp(page, { api: PORTAL_API(null, { ...NOTHING, [`/client/projects/${PID}`]: bundle(FILES) }) });
    await page.goto('/client.html');
    await expect(page.locator('#tabnav [data-tab="documents"]')).toBeVisible();
    await expect.poll(() => papersKept(page)).toBe('1');
  });

  test('238: a read that fails never hides the door, and isn’t remembered', async ({ page }) => {
    await installApp(page, { api: PORTAL_API(null, NOTHING) });
    await page.route('**/functions/v1/presence/client/documents', (route) => route.fulfill(json(500, { error: 'read_failed' })));
    await page.goto('/client.html');
    await expect(page.locator('#home-hero')).toBeVisible();
    await expect(page.locator('#tabnav [data-tab="documents"]')).toBeVisible();
    expect(await papersKept(page)).toBeNull();
  });

  test('238: a part the server refuses counts as nothing there', async ({ page }) => {
    await installApp(page, { api: PORTAL_API(null, NOTHING) });
    await page.route('**/functions/v1/presence/client/reports', (route) => route.fulfill(json(403, { error: 'hidden', message: 'Your studio has turned this part of your portal off.' })));
    await page.goto('/client.html');
    await expect(page.locator('#home-hero')).toBeVisible();
    expect(await tabsOf(page)).toEqual(['home', 'messages', 'help']);
  });
});

// ── the studio's Settings ──
const AGENCY_CTX = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, attention_stale: false, scope: null,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 4, nav: STUDIO_NAV, ...over,
} });
const SETTINGS_API = {
  '/identity': { data: { site_id: 'own', business_name: 'Brightline Studio', email: 'hello@brightline.example' } },
  '/settings': { data: { industry_key: 'salon' } },
  '/agency/nav': { data: { hidden: [], choices: [], can_edit: true } },
};
const PARTS = [
  ['messages', 'Messages', 'Writing to you and your replies'], ['book', 'Book a call', 'Picking a time to talk'],
  ['services', 'Ask for a service', 'Your services, with “Ask for this” (needs Messages)'], ['invoices', 'Invoices', 'Each invoice, with Pay and a receipt'],
  ['proposals', 'Proposals and estimates', 'To read and accept'], ['agreements', 'Agreements', 'To read and sign'],
  ['files', 'Files', 'Files on Documents, and “Send your studio a file”'], ['reports', 'Monthly reports', 'The PDF of each month’s report'],
  ['help', 'Help answers', 'Your answers and the hand-over kit'],
].map(([key, label, sub]) => ({ key, label, sub }));
const CARDS = [['website', 'Your website', 'The picture of the site, where it stands, visits'], ['updates', 'From your studio', 'Your latest updates'], ['projects', 'Your projects', 'Each project and how far along it is']].map(([key, label, sub]) => ({ key, label, sub }));
const PORTALSET = (over: Record<string, unknown> = {}) => ({ data: {
  off: [], welcome: '', home_off: [], parts: PARTS, cards: CARDS, welcome_max: 500, can_edit: true,
  clients: [{ site_id: S1, name: 'Bacchus Kitchen', choices: {} }, { site_id: S2, name: 'Harbor Dental', choices: { reports: false } }], ...over,
} });

async function portalRoutes(page: Page, opts: { fail?: boolean; start?: Record<string, unknown> } = {}) {
  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const state = { off: [] as string[], welcome: '', home_off: [] as string[], ...(opts.start || {}) } as { off: string[]; welcome: string; home_off: string[] };
  const choices: Record<string, Record<string, boolean>> = { [S2]: { reports: false } };
  await page.route(/\/functions\/v1\/presence\/agency\/portal(\/clients\/[^/?]+)?$/, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const url = route.request().url(), body = route.request().postDataJSON();
    puts.push({ url: url.replace(/^.*\/agency\/portal/, '/agency/portal'), body });
    if (opts.fail) return route.fulfill(json(502, { error: 'write_failed', message: 'That didn’t save.' }));
    const m = url.match(/\/clients\/([^/?]+)$/);
    if (m) {
      const site = decodeURIComponent(m[1]); const c = { ...(choices[site] || {}) };
      if (body.reset) { choices[site] = {}; } else { if (body.shown === !state.off.includes(body.part)) delete c[body.part]; else c[body.part] = body.shown; choices[site] = c; }
      return route.fulfill(json(200, { data: { site_id: site, choices: choices[site], off: [] } }));
    }
    if (body.part) state.off = body.shown ? state.off.filter((x) => x !== body.part) : [...state.off, body.part];
    if (body.card) state.home_off = body.shown ? state.home_off.filter((x) => x !== body.card) : [...state.home_off, body.card];
    if (typeof body.welcome === 'string') state.welcome = body.welcome.trim();
    return route.fulfill(json(200, { data: { ...state } }));
  });
  return puts;
}

test.describe('items 229 and 233 — the studio’s Settings', () => {
  test('What your clients see: a switch for each part, saving one change at a time', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/portal': PORTALSET() } });
    const puts = await portalRoutes(page);
    await page.goto('/settings.html');
    const card = page.locator('[data-card="portal"]');
    await expect(card).toHaveAttribute('href', '#portalParts');
    await expect(card).toContainText('Client portal');
    await card.click();
    const part = page.locator('#portalParts');
    await expect(part).toBeVisible();
    await expect(page.locator('#portalPartsHead')).toBeFocused();
    await expect(page.locator('#portalPartsHead')).toHaveText('What your clients see');
    await expect(part.locator('[data-portal-part]')).toHaveCount(9);
    const inv = page.getByRole('switch', { name: /^Invoices/ });
    await expect(inv).toHaveAttribute('aria-checked', 'true');
    await inv.click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ url: '/agency/portal', body: { part: 'invoices', shown: false } });
    await expect(inv).toHaveAttribute('aria-checked', 'false');
    await expect(part.locator('[data-portal-part="invoices"] .nsaved')).toHaveText('Saved');
    // Messages off takes Ask for a service with it, and says why
    await page.getByRole('switch', { name: /^Messages/ }).click();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1].body).toEqual({ part: 'messages', shown: false });
    const svc = part.locator('[data-portal-part="services"]');
    await expect(svc.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(svc.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
    await expect(svc).toContainText('Off while Messages is off');
    await expect(page.locator('#portalPartsNote')).toContainText('A part that’s off is refused by the server too');
  });

  test('two quick flips both stay', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/portal': PORTALSET() } });
    const puts = await portalRoutes(page);
    await page.goto('/settings.html#portalParts');
    await expect(page.locator('#portalParts')).toBeVisible();
    await page.getByRole('switch', { name: /^Files/ }).click();
    await page.getByRole('switch', { name: /^Monthly reports/ }).click();
    await expect.poll(() => puts.length).toBe(2);
    await expect(page.getByRole('switch', { name: /^Files/ })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('switch', { name: /^Monthly reports/ })).toHaveAttribute('aria-checked', 'false');
  });

  test('inside a client the card is theirs: their own choices, “Same as studio”, and a way back', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX({ scope: { site_id: S2, name: 'Harbor Dental' } }), '/agency/portal': PORTALSET({ off: ['help'] }) } });
    const puts = await portalRoutes(page, { start: { off: ['help'] } });
    await page.goto(`/settings.html?client=${S2}`);
    const card = page.locator('[data-card="portal"]');
    await expect(card).toContainText('Harbor Dental’s portal');
    await card.click();
    await expect(page.locator('#portalPartsHead')).toHaveText('Harbor Dental’s portal');
    const rows = page.locator('#portalParts');
    await expect(rows.locator('[data-portal-part="reports"] .pchip')).toHaveText('Off for Harbor Dental');
    await expect(rows.locator('[data-portal-part="help"] .pchip')).toHaveText('Same as studio');
    await expect(rows.locator('[data-portal-part="help"]').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('switch', { name: /^Files/ }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ url: `/agency/portal/clients/${S2}`, body: { part: 'files', shown: false } });
    await expect(rows.locator('[data-portal-part="files"] .pchip')).toHaveText('Off for Harbor Dental');
    // the note and Home's cards are every client's: kept at studio level
    await expect(page.locator('#portalHome')).toBeHidden();
    await page.getByRole('button', { name: 'Back to your studio’s choices' }).click();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1]).toEqual({ url: `/agency/portal/clients/${S2}`, body: { reset: true } });
    await expect(rows.locator('[data-portal-part="reports"] .pchip')).toHaveText('Same as studio');
    await expect(page.locator('#portalResetRow')).toBeHidden();
  });

  test('the welcome note saves when you leave the box; Home’s cards switch, Needs you stays', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/portal': PORTALSET() } });
    const puts = await portalRoutes(page);
    await page.goto('/settings.html#portalHome');
    const home = page.locator('#portalHome');
    await expect(home).toBeVisible();
    const box = page.getByLabel('Welcome note');
    await box.fill('Thanks for working with us!');
    await expect(page.locator('#portalWelcomeCount')).toHaveText('27 / 500');
    await box.blur();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ url: '/agency/portal', body: { welcome: 'Thanks for working with us!' } });
    await expect(page.locator('#portalWelcomeSaved .nsaved')).toHaveText('Saved');
    await expect(home.getByRole('switch', { name: /^Needs you/ })).toHaveAttribute('aria-disabled', 'true');
    await home.getByRole('switch', { name: /^From your studio/ }).click();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1]).toEqual({ url: '/agency/portal', body: { card: 'updates', shown: false } });
    await expect(home.getByRole('switch', { name: /^From your studio/ })).toHaveAttribute('aria-checked', 'false');
  });

  test('a save that fails puts the switch back and says so; a role that can’t change them sees them greyed', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/portal': PORTALSET() } });
    await portalRoutes(page, { fail: true });
    await page.goto('/settings.html#portalParts');
    const inv = page.getByRole('switch', { name: /^Invoices/ });
    await inv.click();
    await expect(page.getByText('That didn’t save.')).toBeVisible();
    await expect(inv).toHaveAttribute('aria-checked', 'true');

    await page.goto('about:blank');   // a fresh load: the same address with only its # would stay on the page
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/portal': PORTALSET({ can_edit: false }) } });
    await page.goto('/settings.html#portalParts');
    await expect(page.getByRole('switch', { name: /^Invoices/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#portalPartsNote')).toContainText('Your role can see these but not change them');
    await expect(page.getByLabel('Welcome note')).toBeDisabled();
  });

  test('a business that isn’t a studio has no Client portal card', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX({ is_agency: false }), '/agency/portal': PORTALSET() } });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="studio"]')).toBeVisible();
    await expect(page.locator('[data-card="portal"]')).toHaveCount(0);
    await expect(page.locator('#portalParts')).toBeHidden();
  });
});
