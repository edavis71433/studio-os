import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Sharing & access (sharing.html) ──────────────────────────────────────────
// Visual refresh (2026-10): the page follows the approved board — breadcrumb,
// title + explainer, the Invite-a-client card (email · role · Send invite) and
// the "What clients see" rows, each a switch with a Visible/Hidden word beside
// it. The contract underneath is unchanged:
//   GET  /portal/members → { data: [member…] }    POST /portal/members ← { email, role }
//   GET  /portal/shares  → { data: { shares: [{ surface, item_id, shared }] } }
//   POST /portal/shares  ← { surface, shared }
// Defaults: Today · Analytics · Photos · Connected data on; Drafts · Visual
// Studio assets · Documents · Internal notes (private by default) off.

const MEMBERS_NONE = { data: [] };
const SHARES_NONE = { data: { shares: [] } };
const ON = ['Today', 'Analytics', 'Photos', 'Connected data'];
const OFF = ['Drafts', 'Visual Studio assets', 'Documents', 'Internal notes'];

test.describe('Sharing & access', () => {
  test('renders the board: breadcrumb · invite card with role · the eight surfaces with honest defaults and Visible/Hidden words', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });
    await page.goto('/sharing.html');
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/presence.html');
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Sharing & access');
    await expect(page.getByRole('heading', { level: 1, name: 'Sharing & access' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    // invite: email · role (reviewer, view only — the one role a client gets) · Send invite
    await expect(page.getByRole('heading', { name: 'Invite a client' })).toBeVisible();
    await expect(page.locator('#email')).toHaveAttribute('placeholder', 'client@theirbusiness.com');
    await expect(page.locator('#role')).toHaveValue('client_reviewer');
    await expect(page.locator('#role option')).toHaveText(['Reviewer (view only)']);
    await expect(page.getByRole('button', { name: 'Send invite' })).toBeVisible();
    await expect(page.locator('.hint')).toContainText('secure link');
    // the surfaces, in the board's order, each an aria switch + a word
    const rows = page.locator('[role="group"] .rowitem');
    await expect(rows).toHaveCount(8);
    await expect(rows.locator('.t')).toHaveText([...ON, ...OFF].map((t) => new RegExp('^' + t)));
    for (const t of ON) {
      const row = rows.filter({ hasText: t }).first();
      await expect(row.getByRole('switch', { name: `Share ${t} with clients` })).toHaveAttribute('aria-checked', 'true');
      await expect(row.locator('.state')).toHaveText('Visible');
    }
    for (const t of OFF) {
      const row = rows.filter({ hasText: t }).first();
      await expect(row.getByRole('switch', { name: `Share ${t} with clients` })).toHaveAttribute('aria-checked', 'false');
      await expect(row.locator('.state')).toHaveText('Hidden');
    }
    await expect(rows.filter({ hasText: 'Internal notes' }).locator('.pill')).toHaveText('Private by default');
    expect(errors).toEqual([]);
  });

  test('a saved share overrides the default (Drafts shared → Visible) and the switch reflects it', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': { data: { shares: [{ surface: 'drafts', item_id: null, shared: true }, { surface: 'media', item_id: null, shared: false }] } } } });
    await page.goto('/sharing.html');
    const drafts = page.locator('.rowitem').filter({ hasText: 'Drafts' });
    await expect(drafts.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(drafts.locator('.state')).toHaveText('Visible');
    const photos = page.locator('.rowitem').filter({ hasText: 'Photos' });
    await expect(photos.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(photos.locator('.state')).toHaveText('Hidden');
  });

  test('flipping a switch POSTs /portal/shares and the word follows; a failed save flips it back', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });
    let calls = 0;
    await page.route((u) => /\/presence\/portal\/shares$/.test(u.pathname) && true, (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHARES_NONE) });
      calls++;
      return route.fulfill(calls === 1
        ? { status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }
        : { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
    });
    await page.goto('/sharing.html');
    const drafts = page.locator('.rowitem').filter({ hasText: 'Drafts' });
    const sw = drafts.getByRole('switch');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/portal/shares'));
    await sw.click();
    expect((await posted).postDataJSON()).toEqual({ surface: 'drafts', shared: true });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(drafts.locator('.state')).toHaveText('Visible');
    await expect(page.locator('.dds-toast').filter({ hasText: 'Shared with clients.' })).toBeVisible();
    // the second flip fails on the server → the switch and the word revert
    await sw.click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'That didn’t save.' })).toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(drafts.locator('.state')).toHaveText('Visible');
  });

  test('Send invite POSTs the email with the reviewer role; an empty email asks for one and posts nothing', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });
    await page.goto('/sharing.html');
    let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST') posts++; });
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'Enter their email.' })).toBeVisible();
    expect(posts).toBe(0);
    await page.route((u) => /\/presence\/portal\/members$/.test(u.pathname) && true, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { message: 'Invite sent to pat@example.com.' } }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'm-1', email: 'pat@example.com', role: 'client_reviewer', status: 'invited' }] }) }));
    await page.locator('#email').fill('pat@example.com');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/portal/members'));
    await page.getByRole('button', { name: 'Send invite' }).click();
    expect((await posted).postDataJSON()).toEqual({ email: 'pat@example.com', role: 'client_reviewer' });
    await expect(page.locator('.dds-toast').filter({ hasText: 'Invite sent to pat@example.com.' })).toBeVisible();
    // the re-read lists them under the invite, with Resend + Remove
    const person = page.locator('.people .rowitem').filter({ hasText: 'pat@example.com' });
    await expect(person).toBeVisible();
    await expect(person).toContainText('client reviewer · invited');
    await expect(person.getByRole('button', { name: 'Resend invite' })).toBeVisible();
    await expect(person.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  test('the owner row carries no Resend/Remove; a reviewer row does', async ({ page }) => {
    await installApp(page, { api: { '/portal/shares': SHARES_NONE, '/portal/members': { data: [
      { id: 'm-0', email: 'owner@example.com', role: 'business_owner', status: 'active' },
      { id: 'm-1', email: 'pat@example.com', role: 'client_reviewer', status: 'invited' },
    ] } } });
    await page.goto('/sharing.html');
    const owner = page.locator('.people .rowitem').filter({ hasText: 'owner@example.com' });
    await expect(owner).toBeVisible();
    await expect(owner.getByRole('button')).toHaveCount(0);
    await expect(page.locator('.people .rowitem').filter({ hasText: 'pat@example.com' }).getByRole('button')).toHaveCount(2);
  });

  test('a non-owner sees the honest wall, not the controls', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': { data: {
      site_role: 'client_reviewer', sees_full_workspace: false, is_client_portal: true, edition_key: 'studio_os',
      edition_features: ['website', 'client_portal'], attention_count: 0,
      nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
    } } } });
    await page.goto('/sharing.html');
    await expect(page.locator('#main')).toContainText('Only the account owner can manage sharing.');
    await expect(page.locator('#email')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
  });

  test('signed-out shows a sign-in prompt', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/sharing.html');
    await expect(page.locator('#main').getByRole('link', { name: /Sign in/ })).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
  });
});

// ── Client scope (studio audit 2026-10, change 1) ────────────────────────────
// An agency operator drills into a client with ?client=<site uuid>. The shell
// already sent x-dds-scope-site on ITS calls; this page built its own headers
// without it, so "Viewing client Marlow’s Kitchen" on screen invited the
// reviewer to the STUDIO's own site (audit walk S9b: members/shares scope
// "(absent)"). Now every request the page makes — GET/POST /portal/members,
// /portal/members/:id/revoke, GET/POST /portal/shares — carries the scope, the
// heading names the client, and the breadcrumb's way back keeps ?client=.
// Unscoped, nothing changes: no header, plain heading, bare link.
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' },
} };
const REVIEWER = { id: 'm-1', email: 'pat@example.com', role: 'client_reviewer', status: 'invited' };

/** Every presence call the page makes, as [method path, scope header or ''] — oldest first. */
function spyScope(page: import('@playwright/test').Page): Array<[string, string]> {
  const seen: Array<[string, string]> = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!/\/functions\/v1\/presence\//.test(u.pathname)) return;
    seen.push([r.method() + ' ' + u.pathname.replace(/^.*\/functions\/v1\/presence/, ''), r.headers()['x-dds-scope-site'] || '']);
  });
  return seen;
}

test.describe('Sharing & access — client scope', () => {
  test('opened with ?client=, every members/shares request carries x-dds-scope-site, the heading names the client, the breadcrumb keeps the client', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': SCOPED_CTX, '/portal/members': { data: [REVIEWER] }, '/portal/shares': SHARES_NONE } });
    const seen = spyScope(page);
    page.on('dialog', (d) => d.accept());   // "Remove their access?"
    await page.goto(`/sharing.html?client=${CLIENT}`);
    // the page says whose site it is, and the way back stays in scope
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sharing & access — Marlow’s Kitchen');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', `/presence.html?client=${CLIENT}`);
    await expect(page.locator('#dds-ctxbar')).toContainText('Marlow’s Kitchen');
    // the reads
    expect(seen).toContainEqual(['GET /portal/members', CLIENT]);
    expect(seen).toContainEqual(['GET /portal/shares', CLIENT]);
    // the writes: invite · flip a share · remove
    await page.locator('#email').fill('ana@example.com');
    const invited = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members'));
    await page.getByRole('button', { name: 'Send invite', exact: true }).click();
    expect((await invited).headers()['x-dds-scope-site']).toBe(CLIENT);
    const flipped = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/shares'));
    await page.locator('.rowitem').filter({ hasText: 'Drafts' }).getByRole('switch').click();
    expect((await flipped).headers()['x-dds-scope-site']).toBe(CLIENT);
    const revoked = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members/m-1/revoke'));
    await page.locator('.people .rowitem').filter({ hasText: 'pat@example.com' }).getByRole('button', { name: 'Remove' }).click();
    expect((await revoked).headers()['x-dds-scope-site']).toBe(CLIENT);
    // and NOTHING this page sent went to the studio's own site
    await expect.poll(() => seen.length).toBeGreaterThanOrEqual(6);
    expect(seen.filter(([, scope]) => scope !== CLIENT)).toEqual([]);
  });

  test('without ?client= no request carries a scope; the heading and the breadcrumb are the plain ones', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': { data: [REVIEWER] }, '/portal/shares': SHARES_NONE } });
    const seen = spyScope(page);
    await page.goto('/sharing.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sharing & access');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/presence.html');
    await expect(page.locator('#dds-ctxbar')).toHaveCount(0);
    await page.locator('#email').fill('ana@example.com');
    const invited = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members'));
    await page.getByRole('button', { name: 'Send invite', exact: true }).click();
    expect((await invited).headers()['x-dds-scope-site'] || '').toBe('');
    const flipped = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/shares'));
    await page.locator('.rowitem').filter({ hasText: 'Drafts' }).getByRole('switch').click();
    expect((await flipped).headers()['x-dds-scope-site'] || '').toBe('');
    expect(seen.map(([call]) => call)).toEqual(expect.arrayContaining(['GET /portal/members', 'GET /portal/shares', 'POST /portal/members', 'POST /portal/shares']));
    expect(seen.filter(([, scope]) => scope !== '')).toEqual([]);
  });

  test('a ?client= that is not a site uuid is ignored — no scope is sent and the heading stays plain', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });
    const seen = spyScope(page);
    await page.goto('/sharing.html?client=not-a-uuid');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sharing & access');
    await expect.poll(() => seen.map(([call]) => call)).toEqual(expect.arrayContaining(['GET /portal/members', 'GET /portal/shares']));
    expect(seen.filter(([, scope]) => scope !== '')).toEqual([]);
  });
});
