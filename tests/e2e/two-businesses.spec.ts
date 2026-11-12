import { test, expect, Page } from '@playwright/test';
import { installApp, OWNER_SESSION, STUDIO_NAV, CLIENT_NAV, ALL_FEATURES } from './helpers/app';

// ── One person, two businesses (builder list item 83) ─────────────────────────
// /portal/context lists `businesses` for someone invited somewhere with two or more,
// each with the role in words, the one in hand `current` and the one the server opens
// unasked `default`. The shell shows which business this is ("You’re Staff") with
// Switch business; a pick opens that business's own first page (the default one with
// no ?client=, any other with ?client=<id>); a business seen through the client portal
// opens at the client door. The sign-in doors open the picked or the last-used one.

const B1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', B3 = 'cccccccc-3333-4333-8333-cccccccccccc';
const BIZ = (current: string) => [
  { site_id: B1, name: 'Maple & Main Realty', role: 'business_staff', role_words: 'Staff', current: current === B1, default: true },
  { site_id: B2, name: 'Juniper Floral Co.', role: 'business_owner', role_words: 'Co-owner', current: current === B2, default: false },
  { site_id: B3, name: 'Bluebird Bakery', role: 'client_reviewer', role_words: 'Reviewer', current: current === B3, default: false },
];
const ctx = (current: string, over: Record<string, unknown> = {}) => {
  const businesses = BIZ(current);
  return { data: {
    site_role: current === B2 ? 'business_owner' : 'business_staff', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
    is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false,
    capabilities: ['view_all', 'edit', 'approve', 'publish', 'connect', 'export', 'comment'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
    scope: null, businesses, business: businesses.find((b) => b.current) || null, ...over,
  } };
};
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
/** the scope header each /portal/context request carried, oldest first */
function contextScopes(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => { if (/\/presence\/portal\/context$/.test(new URL(r.url()).pathname)) seen.push(r.headers()['x-dds-scope-site'] || ''); });
  return seen;
}
const jwtFor = (sub: string) => 'h.' + Buffer.from(JSON.stringify({ sub })).toString('base64url') + '.s';

test.describe('Switch business (builder item 83)', () => {
  test('the bar says which business this is and the role; the switch lists every business with its role', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: { '/portal/context': ctx(B1) } });
    await page.goto('/today.html');
    const bar = page.locator('#dds-ctxbar.biz');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Switch business' })).toBeVisible();
    await expect(bar).toContainText('Maple & Main Realty');
    await expect(bar.locator('.lbl')).toHaveText('You’re Staff');
    await expect(page.getByRole('button', { name: 'Switch site' })).toHaveCount(0);   // the studio's own switcher isn't this
    await bar.getByRole('button', { name: 'Switch business' }).click();
    const pop = page.getByRole('dialog', { name: 'Your businesses' });
    await expect(pop).toBeVisible();
    const rows = pop.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Maple & Main Realty');
    await expect(rows.nth(0)).toContainText('You’re Staff · here now');
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(rows.nth(1)).toContainText('You’re Co-owner');
    await expect(rows.nth(2)).toContainText('You review its work · opens the client view');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Switch business' })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('a pick opens that business’s own first page with its id, asks the server first, and is remembered', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B1) } });
    const scopes = contextScopes(page);
    await page.goto('/today.html');
    await page.route(/\/presence\/portal\/context$/, (route) => route.request().headers()['x-dds-scope-site'] === B2
      ? route.fulfill(json(ctx(B2, { landing: '/presence.html' })))
      : route.fallback());
    await page.locator('#dds-ctxbar').getByRole('button', { name: 'Switch business' }).click();
    await page.getByRole('dialog', { name: 'Your businesses' }).getByRole('listitem').filter({ hasText: 'Juniper Floral Co.' }).click();
    await page.waitForURL(new RegExp(`/presence(\\.html)?\\?client=${B2}`));
    expect(scopes).toContain(B2);
    const last = await page.evaluate(() => localStorage.getItem('dds-last-business'));
    expect(JSON.parse(String(last))).toEqual({ uid: 'e2e-owner', site_id: B2 });
  });

  test('a business seen through the client portal opens at the client door', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B1) } });
    await page.goto('/today.html');
    await page.locator('#dds-ctxbar').getByRole('button', { name: 'Switch business' }).click();
    await page.getByRole('dialog', { name: 'Your businesses' }).getByRole('listitem').filter({ hasText: 'Bluebird Bakery' }).click();
    await page.waitForURL(new RegExp(`/portal\\.html\\?client=${B3}`));
  });

  test('going back to the business the server opens unasked needs no ?client=', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B2) } });
    await page.goto(`/today.html?client=${B2}`);
    await expect(page.locator('#dds-ctxbar.biz')).toContainText('Juniper Floral Co.');
    await expect(page.locator('#dds-ctxbar .lbl')).toHaveText('You’re Co-owner');
    const scopes = contextScopes(page);
    await page.locator('#dds-ctxbar').getByRole('button', { name: 'Switch business' }).click();
    await page.getByRole('dialog', { name: 'Your businesses' }).getByRole('listitem').filter({ hasText: 'Maple & Main Realty' }).click();
    await page.waitForURL(/\/today(\.html)?$/);
    expect(scopes[scopes.length - 1]).toBe('');
  });

  test('someone with one business sees no bar; a studio inside a client still sees its own client card', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B1, { businesses: [], business: null }) } });
    await page.goto('/today.html');
    await expect(page.locator('.dds-brand').first()).toBeVisible();
    await expect(page.locator('#dds-ctxbar')).toHaveCount(0);
    await installApp(page, { api: { '/portal/context': ctx(B1, { is_agency: true, nav: CLIENT_NAV, scope: { site_id: B1, name: 'Maple & Main Realty' }, site_role: 'business_owner' }) } });
    await page.goto(`/today.html?client=${B1}`);
    await expect(page.locator('#dds-ctxbar')).toContainText('Viewing client');
    await expect(page.getByRole('button', { name: 'Switch site' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch business' })).toHaveCount(0);
  });

  test('a page asking "is this a studio inside a client?" is told no for one of your own businesses', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B2) } });
    await page.goto(`/today.html?client=${B2}`);
    await expect(page.locator('#dds-ctxbar.biz')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { ddsScopeInfo: () => unknown }).ddsScopeInfo())).toBeNull();
    expect(JSON.parse(String(await page.evaluate(() => localStorage.getItem('dds-held-businesses'))))).toEqual([B1, B2, B3]);
    // before the context lands (it is held back here), the last visit's list answers the same way
    await page.route(/\/presence\/portal\/context$/, () => { /* never answered */ });
    await page.goto(`/today.html?client=${B3}`);
    await page.waitForFunction(() => typeof (window as unknown as { ddsScopeInfo?: unknown }).ddsScopeInfo === 'function');
    expect(await page.evaluate(() => (window as unknown as { ddsScopeInfo: () => unknown }).ddsScopeInfo())).toBeNull();
    // and a site that isn't one of them is still read as a studio's client, as before
    const other = 'dddddddd-4444-4444-8444-dddddddddddd';
    await page.goto(`/today.html?client=${other}`);
    await page.waitForFunction(() => typeof (window as unknown as { ddsScopeInfo?: unknown }).ddsScopeInfo === 'function');
    expect(await page.evaluate(() => (window as unknown as { ddsScopeInfo: () => unknown }).ddsScopeInfo())).toEqual({ id: other, name: '' });
  });
});

test.describe('The sign-in doors open the picked or last-used business (builder item 83)', () => {
  test('studio door: ?client= is asked for first and kept on the landing', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B2) } });
    const scopes = contextScopes(page);
    await page.goto(`/studio.html?client=${B2}`);
    await page.waitForURL(new RegExp(`/today(\\.html)?\\?client=${B2}`));
    expect(scopes[0]).toBe(B2);
  });

  test('studio door: a business that isn’t yours any more falls back to the usual landing', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B1) } });
    await page.route(/\/presence\/portal\/context$/, (route) => route.request().headers()['x-dds-scope-site']
      ? route.fulfill(json({ error: 'scope_denied', message: 'You don’t have access to that client.' }, 403))
      : route.fallback());
    const scopes = contextScopes(page);
    await page.goto(`/studio.html?client=${B3}`);
    await page.waitForURL(/\/today(\.html)?$/);
    expect(scopes.slice(0, 2)).toEqual([B3, '']);
  });

  test('studio door: the last business this sign-in used on this device, and only for that sign-in', async ({ page }) => {
    await installApp(page, { session: { ...OWNER_SESSION, access_token: jwtFor('e2e-owner') }, api: { '/portal/context': ctx(B2) } });
    await page.addInitScript((id) => localStorage.setItem('dds-last-business', JSON.stringify({ uid: 'e2e-owner', site_id: id })), B2);
    const scopes = contextScopes(page);
    await page.goto('/studio.html');
    await page.waitForURL(new RegExp(`/today(\\.html)?\\?client=${B2}`));
    expect(scopes[0]).toBe(B2);
  });

  test('studio door: someone else’s remembered business is never asked for', async ({ page }) => {
    await installApp(page, { session: { ...OWNER_SESSION, access_token: jwtFor('another-person') }, api: { '/portal/context': ctx(B1) } });
    await page.addInitScript((id) => localStorage.setItem('dds-last-business', JSON.stringify({ uid: 'e2e-owner', site_id: id })), B2);
    const scopes = contextScopes(page);
    await page.goto('/studio.html');
    await page.waitForURL(/\/today(\.html)?$/);
    expect(scopes[0]).toBe('');
  });

  test('client door: a reviewer’s business opens in the client view with its id', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(B3, { site_role: 'client_reviewer', sees_full_workspace: false, is_client_portal: true, landing: '/client.html', nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }] }) } });
    const scopes = contextScopes(page);
    await page.goto(`/portal.html?client=${B3}`);
    await page.waitForURL(new RegExp(`/client\\.html\\?client=${B3}`));
    expect(scopes[0]).toBe(B3);
  });
});

test.describe('Your businesses in the client portal (builder item 83)', () => {
  test('the account area lists the other businesses, each through its own door', async ({ page }) => {
    const reviewer = ctx(B3, { site_role: 'client_reviewer', sees_full_workspace: false, is_client_portal: true, landing: '/client.html', nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }] });
    await installApp(page, { api: { '/portal/context': reviewer, '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } } } });
    await page.goto(`/client.html?client=${B3}#help`);
    const block = page.locator('#acctBiz');
    await expect(block).toContainText('Your businesses');
    await expect(block.getByRole('link', { name: 'Maple & Main Realty' })).toHaveAttribute('href', '/studio.html');               // the default one: no ?client=
    await expect(block.getByRole('link', { name: 'Juniper Floral Co.' })).toHaveAttribute('href', `/studio.html?client=${B2}`);   // full workspace: the studio door
    await expect(block).toContainText('Bluebird Bakery · You review its work · here now');
  });
});
