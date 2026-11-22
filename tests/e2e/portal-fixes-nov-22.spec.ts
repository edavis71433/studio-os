import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list items 256, 257, 258, 273, 280, 281 and 287 (the full review of Nov 22 2026):
// the client portal's Book a call works against the server's real visitor rule; a site hosted
// elsewhere is shown as live; a stale sign-in goes to the sign-in page with the place kept and
// the trouble screen has Try again; the password row says a code is coming and hides when the
// studio turned passwords off; quick links and a pinned page reach the menu and Home; the
// studio's "See a client's portal" box opens in the middle of the window.

const PID = '11111111-1111-4111-8111-111111111111';
const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const P1 = '11111111-aaaa-4aaa-8aaa-111111111111', P2 = '55555555-eeee-4eee-8eee-555555555555', L1 = '33333333-cccc-4ccc-8ccc-333333333333', L2 = '66666666-ffff-4fff-8fff-666666666666';
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const CLIENT_CTX = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria', portal: { off: [], welcome: '', home_off: [], signin: { google: false, password: true } }, ...over,
} });
const PAGES = { data: {
  pages: [{ id: P1, title: 'Welcome guide', sub: 'How we’ll work together', words: 'How we’ll work together\n\nEach week you get a short update here.', home: true, updated_at: '2026-11-10T00:00:00Z', items: [] },
    { id: P2, title: 'Brand files', sub: 'Logos and colours', words: 'Logos and colours', home: false, updated_at: '2026-11-10T00:00:00Z', items: [] }],
  links: [{ id: L1, label: 'Your website', to: 'https://example.com/' }, { id: L2, label: 'Book a call', to: 'book' }],
} };
const CLIENT_API = (over: Record<string, unknown> = {}) => ({
  '/portal/context': CLIENT_CTX(),
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: [] } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
  '/client/portal-pages': { data: { pages: [], links: [] } },
  '/client/website-stats': { data: { published: false, month: null, search: null } },
  '/client/book': { data: { site_id: SITE } },
  ...over,
});

// ── item 256: the booking addresses are answered under the server's visitor rule ──
// _shared/cors.ts visitorCors() allows two request headers. A browser refuses, before it
// leaves, any request that carries another, so this pretend server does the same: a
// /book/ request with a header outside that list fails as the browser would fail it.
const ALLOWED = (() => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/cors.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export function visitorCors()'));
  const m = /'Access-Control-Allow-Headers':\s*'([^']+)'/.exec(fn);
  if (!m) throw new Error('visitorCors() has no Access-Control-Allow-Headers line');
  return new Set(m[1].split(',').map((h) => h.trim().toLowerCase()));
})();
// headers the browser itself adds; a page never set them, so a preflight never asks about them
const BROWSERS_OWN = /^(accept|accept-.*|content-length|user-agent|origin|referer|host|connection|cookie|priority|pragma|cache-control|sec-.*|upgrade-insecure-requests|dnt|:.*)$/;
async function bookingServer(page: Page, refused: string[]) {
  await page.route('**/functions/v1/presence/book/**', (route: Route) => {
    const sent = Object.keys(route.request().headers()).map((h) => h.toLowerCase()).filter((h) => !BROWSERS_OWN.test(h));
    const bad = sent.filter((h) => !ALLOWED.has(h));
    if (bad.length) { refused.push(...bad); return route.abort('failed'); }   // the browser's refusal: the request never leaves
    const path = new URL(route.request().url()).pathname;
    if (/\/types$/.test(path)) return route.fulfill(json(200, { data: { enabled: true, intro: 'Pick a time that suits you.', max_days_ahead: 14, types: [{ id: 'intro', name: 'Intro call', duration_min: 30, price_text: '', description: 'A first chat.' }] } }));
    if (/\/slots$/.test(path)) return route.fulfill(json(200, { data: { slots: ['2026-12-02T17:00:00Z', '2026-12-02T18:00:00Z'] } }));
    if (route.request().method() === 'POST') return route.fulfill(json(200, { data: { ok: true } }));
    return route.fulfill(json(404, { error: 'not_found' }));
  });
}

test.describe('item 256 — Book a call against the real visitor rule', () => {
  test('the portal asks for call types, times and books with no sign-in headers, so nothing is refused', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    const refused: string[] = [];
    await bookingServer(page, refused);
    await page.goto('/client.html#messages');
    await page.getByRole('button', { name: 'Book a call' }).click();
    await expect(page.getByRole('heading', { name: 'Book a call', level: 1 })).toBeVisible();
    await expect(page.getByText('We couldn’t check on booking just now')).toHaveCount(0);
    await page.getByRole('button', { name: 'Choose' }).click();
    await expect(page.getByRole('heading', { name: 'Intro call', level: 1 })).toBeVisible();
    const slot = page.locator('[data-slot]').first();
    await expect(slot).toBeVisible();
    await slot.click();
    await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible();
    await page.getByRole('button', { name: 'Book it' }).click();
    await expect(page.getByRole('heading', { name: /You’re booked/ })).toBeVisible();
    expect(refused, 'every /book/ request went out with the allowed headers only').toEqual([]);
  });

  test('the pretend server really refuses a sign-in header (the rule the portal used to break)', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    const refused: string[] = [];
    await bookingServer(page, refused);
    await page.goto('/client.html#help');
    const base = /const SUPABASE_URL\s*=\s*["']([^"']+)/.exec(readFileSync(resolve(__dirname, '../../client.html'), 'utf8'));
    const r = await page.evaluate(async ({ site, fn }) => {
      try { const res = await fetch(fn + '/book/' + site + '/types', { headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': 'stale' } }); return String(res.status); } catch (e) { return 'refused'; }
    }, { site: SITE, fn: (base ? base[1] : '') + '/functions/v1/presence' });
    expect(r).toBe('refused');
    expect(refused).toContain('x-dds-user-jwt');
  });
});

// ── item 258: a site hosted elsewhere is live, not "on its way" ──
test.describe('item 258 — a website hosted elsewhere', () => {
  test('Home says the site is live at its address, with Visit, and never "isn’t live yet"', async ({ page }) => {
    await installApp(page, { api: CLIENT_API({ '/client/website-stats': { data: { published: true, elsewhere: true, month: null, search: { clicks: 12, impressions: 340, period: '2026-11', top_terms: [] }, site: { url: 'https://bacchus.example', last_published_at: null } } } }) });
    await page.goto('/client.html');
    const card = page.locator('#home-website .wscard');
    await expect(card.getByRole('heading', { name: 'Your website is live at bacchus.example.' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Visit your site' })).toHaveAttribute('href', 'https://bacchus.example');
    await expect(card.getByText('12', { exact: true })).toBeVisible();
    await expect(card.locator('.wslead')).toContainText('12 clicks from Google search');
    await expect(page.getByText('It isn’t live yet')).toHaveCount(0);
    await expect(page.getByText('on its way')).toHaveCount(0);
  });
  test('with no Google connected, the card says visits aren’t counted here', async ({ page }) => {
    await installApp(page, { api: CLIENT_API({ '/client/website-stats': { data: { published: true, elsewhere: true, month: null, search: null, site: { url: 'https://bacchus.example', last_published_at: null } } } }) });
    await page.goto('/client.html');
    await expect(page.locator('#home-website').getByText('It lives on its own host, so visits aren’t counted here.')).toBeVisible();
  });
});

// ── item 273: a stale sign-in, and the trouble screen ──
test.describe('item 273 — a sign-in that has gone stale', () => {
  test('a "signed out" answer goes to the sign-in page, with the place they were opening kept', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    await page.route('**/functions/v1/presence/portal/context', (route: Route) => route.fulfill(json(401, { error: 'unauthorized', message: 'Please sign in.' })));
    await page.goto(`/client.html?project=${PID}`);
    await page.waitForURL(/\/portal\.html/);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('dds-portal-return') || 'null'));
    expect(kept && kept.project).toBe(PID);
  });
  test('any other failure shows Try again, which reloads, and a way to sign in', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    let calls = 0;
    await page.route('**/functions/v1/presence/portal/context', (route: Route) => { calls++; return calls === 1 ? route.fulfill(json(500, { error: 'boom' })) : route.fallback(); });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'We couldn’t load your updates just now.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/portal.html');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Maria/ })).toBeVisible();
    await expect(page.locator('#tabnav')).toBeVisible();
  });
});

// ── items 257 and 281: the password row ──
test.describe('items 257 and 281 — the password row in Help', () => {
  test('says a code is coming, and sends one', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    await page.addInitScript(() => { (window as unknown as { __pwReset: string[] }).__pwReset = []; });
    await page.goto('/client.html#help');
    await expect(page.locator('#sec-you').getByText('We’ll email you a code to set a new one.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
    await expect(page.getByText('a link to set a new')).toHaveCount(0);
  });
  test('is hidden when the studio turned passwords off for its clients', async ({ page }) => {
    await installApp(page, { api: CLIENT_API({ '/portal/context': CLIENT_CTX({ portal: { off: [], welcome: '', home_off: [], signin: { google: false, password: false } } }) }) });
    await page.goto('/client.html#help');
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});

// ── item 280: quick links in the menu, a page on Home ──
test.describe('item 280 — the studio’s quick links and pinned page', () => {
  test('the menu carries the quick links (as tabs on a wide screen, under More on a phone), and Home shows the pinned page', async ({ page }) => {
    await installApp(page, { api: CLIENT_API({ '/client/portal-pages': PAGES }) });
    await bookingServer(page, []);
    await page.goto('/client.html');
    const nav = page.locator('#tabnav');
    const wide = ((page.viewportSize() || { width: 1280 }).width) >= 720;
    if (wide) {
      await expect(nav.getByRole('link', { name: 'Your website' })).toHaveAttribute('href', 'https://example.com/');
      await expect(nav.getByRole('button', { name: 'Book a call' })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'More' })).toBeHidden();
    } else {
      await expect(nav.getByRole('link', { name: 'Your website' })).toBeHidden();
      const more = nav.getByRole('button', { name: 'More' });
      await expect(more).toBeVisible();
      await more.click();
      const sheet = page.locator('#navmorep');
      await expect(sheet.getByRole('link', { name: 'Your website' })).toHaveAttribute('href', 'https://example.com/');
      await expect(sheet.getByRole('button', { name: 'Brand files' })).toBeVisible();
      await sheet.getByRole('button', { name: 'Book a call' }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Book a call', level: 1 })).toBeVisible();
      await page.locator('#bk-back').click();
      await page.locator('#tabnav [data-tab="home"]').click();
    }
    const pinned = page.locator('#home-page');
    await expect(pinned.getByRole('heading', { name: 'Welcome guide' })).toBeVisible();
    await expect(pinned.getByText('How we’ll work together')).toBeVisible();
    await expect(page.locator('#main').getByText('Brand files')).toHaveCount(0);   // only the pinned page sits on Home
    await pinned.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome guide', level: 1 })).toBeVisible();
    await expect(page.getByText('Each week you get a short update here.')).toBeVisible();
  });
  test('with no links or pages, the menu is the four tabs and Home has no page card', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { level: 1, name: /Maria/ })).toBeVisible();
    await expect(page.locator('#tabnav .tab[data-tab="home"]')).toBeVisible();
    await expect(page.locator('#tabnav .qtab')).toHaveCount(0);
    await expect(page.locator('#navmore')).toHaveCount(0);
    await expect(page.locator('#home-page')).toBeHidden();
  });
});

// ── item 287: the "See a client's portal" box ──
test.describe('item 287 — See a client’s portal opens in the middle', () => {
  test('the box is centred in the window, the second time too', async ({ page }) => {
    const AGENCY_CTX = { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
      is_agency: true, is_operator: false, sees_full_workspace: true, attention_stale: false, scope: null,
      capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
    } };
    const OVERVIEW = { data: { address: 'https://app.example/portal.html?studio=cccccccc-3333-4333-8333-cccccccccccc', counts: { active: 1, waiting: 0, expired: 0, recent: 1 },
      clients: [{ site_id: SITE, name: 'Bacchus Kitchen', state: 'joined', invited_at: '2026-10-01T00:00:00Z', seen_at: '2026-11-20T00:00:00Z' }],
      setup: [{ key: 'logo', done: true }, { key: 'parts', done: true }, { key: 'welcome', done: true }, { key: 'preview', done: false }, { key: 'invite', done: true }], can_edit: true } };
    await installApp(page, { api: { '/portal/context': AGENCY_CTX, '/agency/portal/overview': OVERVIEW } });
    await page.goto('/client-portal.html');
    const vw = (page.viewportSize() || { width: 1280, height: 800 });
    for (const go of [1, 2]) {
      await page.getByRole('button', { name: 'See a client’s portal' }).first().click();
      const dlg = page.locator('dialog#pick');
      await expect(dlg).toBeVisible();
      const box = await dlg.boundingBox();
      expect(box, `open ${go}: the box has a size`).not.toBeNull();
      const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
      expect(Math.abs(cx - vw.width / 2), `open ${go}: centred left to right`).toBeLessThan(24);
      expect(Math.abs(cy - vw.height / 2), `open ${go}: centred top to bottom`).toBeLessThan(vw.height * 0.2);
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(dlg).toBeHidden();
    }
  });
});
