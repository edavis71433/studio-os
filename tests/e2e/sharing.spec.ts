import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Sharing & access (sharing.html) ──────────────────────────────────────────
// Visual refresh (2026-10): breadcrumb, title + explainer, then (builder list item 53,
// Nov 2026) the People sheet the Sites page shares (people.js): the owner, the studio,
// and the people on their side with a role each, invited by role; then the "What a
// reviewer sees" rows, each a switch with a Visible/Hidden word beside it.
//   GET  /portal/members → { data: [seat…], owner, studio, transfer, transfer_ready, can_transfer }
//   POST /portal/members ← { email, role } · { email, resend: true } · { email, role, restore: true }
//   POST /portal/members/:id/role ← { role } · POST /portal/members/:id/revoke
//   POST /portal/transfer ← { email, keep_owner } · POST /portal/transfer/cancel
//   GET  /portal/shares  → { data: { shares: [{ surface, item_id, shared }] } }
//   POST /portal/shares  ← { surface, shared }
// Defaults: Overview · Analytics · Photos · Visitor and review numbers on; Drafts ·
// Images made for you · Documents · Internal notes (private by default) off.

const ME = { name: 'Sam Reyes', email: 'owner@example.com', signed_in: true, me: true };
const people = (over: Record<string, unknown> = {}) => ({ data: [], owner: ME, studio: null, transfer: null, transfer_ready: true, can_transfer: 'owner', ...over });
const MEMBERS_NONE = people();
const SHARES_NONE = { data: { shares: [] } };
const ON = ['Overview', 'Analytics', 'Photos', 'Visitor and review numbers'];   // item 136: named the way a client says them
const OFF = ['Drafts', 'Images made for you', 'Documents', 'Internal notes'];
const DANA = { id: 'm-1', email: 'dana@example.com', role: 'business_staff', role_words: 'Staff', status: 'active', created_at: '2026-10-14T00:00:00Z', joined: true };
const JO = { id: 'm-2', email: 'jo@example.com', role: 'client_reviewer', role_words: 'Reviewer', status: 'active', created_at: '2026-11-10T00:00:00Z', joined: false };
const GONE = { id: 'm-3', email: 'gone@example.com', role: 'developer', role_words: 'Developer', status: 'revoked', created_at: '2026-09-01T00:00:00Z', joined: false };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const peopleCard = (page: import('@playwright/test').Page) => page.locator('#peopleCard');

test.describe('Sharing & access', () => {
  test('renders the board: breadcrumb · the People sheet with the owner · the eight surfaces with honest defaults and Visible/Hidden words', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page, { api: { '/portal/members': people({ data: [DANA, JO] }), '/portal/shares': SHARES_NONE } });
    await page.goto('/sharing.html');
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Website' })).toHaveAttribute('href', '/presence.html');
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Sharing & access');
    await expect(page.getByRole('heading', { level: 1, name: 'Sharing & access' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    // builder item 53: who owns it, and the people with their roles
    const card = peopleCard(page);
    await expect(card.getByRole('heading', { level: 2, name: 'People' })).toBeVisible();
    await expect(card.locator('.pp-note')).toHaveText('You own this site. People on your side each get their own sign-in, with a role.');
    await expect(card.locator('[data-owner]')).toContainText('Sam Reyes');
    await expect(card.locator('[data-owner] .pp-chip')).toHaveText('Owner');
    await expect(card.getByRole('button', { name: 'Transfer ownership' })).toBeVisible();
    await expect(card.locator('[data-seat="m-1"]')).toContainText('Joined Oct 14');
    await expect(card.getByRole('combobox', { name: 'Role for dana@example.com' })).toHaveValue('business_staff');
    await expect(card.locator('[data-seat="m-2"]').getByRole('button', { name: 'Send it again' })).toBeVisible();   // not signed in yet
    await expect(card.locator('[data-seat="m-1"]').getByRole('button', { name: 'Send it again' })).toHaveCount(0);   // already joined
    await expect(card.getByRole('button', { name: '+ Invite someone' })).toBeVisible();
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

  test('invite by role: four roles said plainly, Staff picked first; an empty email asks for one and posts nothing; the pick is what is sent', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });
    await page.goto('/sharing.html');
    const card = peopleCard(page);
    await card.getByRole('button', { name: '+ Invite someone' }).click();
    await expect(card.getByRole('heading', { name: 'Invite someone' })).toBeVisible();
    const roles = card.getByRole('radio');
    await expect(roles).toHaveCount(4);
    await expect(card.getByRole('radio', { name: /Staff/ })).toBeChecked();
    await expect(card.locator('.pp-role').filter({ hasText: 'Co-owner' })).toContainText('Everything you can do, except hand the site to someone else.');
    await expect(card.locator('.pp-role').filter({ hasText: 'Reviewer' }).locator('.pp-can')).toContainText('✓ Approve');
    const tile = (name: string) => card.locator('.pp-role').filter({ has: page.locator('.nm', { hasText: new RegExp('^' + name + '$') }) });
    await expect(tile('Staff').locator('.pp-can .y')).toHaveText(['✓ Edit pages', '✓ Publish']);
    await expect(tile('Developer').locator('.pp-can .y')).toHaveText(['✓ Edit pages', '✓ Publish', '✓ Settings']);
    await expect(tile('Co-owner').locator('.pp-can .y')).toHaveCount(5);
    let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/portal/members')) posts++; });
    await card.getByRole('button', { name: 'Send invite' }).click();
    await expect(card.locator('.pp-err')).toHaveText('Type their email first.');
    expect(posts).toBe(0);
    await page.route(/\/presence\/portal\/members$/, (route) => route.request().method() === 'POST'
      ? route.fulfill(json({ data: { ok: true, emailed: true, message: 'Invited as Developer — we’ve emailed them a sign-in link.' } }))
      : route.fulfill(json(people({ data: [{ ...DANA, id: 'm-9', email: 'alex@example.com', role: 'developer', role_words: 'Developer', joined: false }] }))));
    await card.locator('#pp-email').fill('alex@example.com');
    await card.getByRole('radio', { name: /Developer/ }).check();
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members'));
    await card.getByRole('button', { name: 'Send invite' }).click();
    expect((await posted).postDataJSON()).toEqual({ email: 'alex@example.com', role: 'developer' });
    await expect(page.locator('.dds-toast').filter({ hasText: 'Invited as Developer' })).toBeVisible();
    await expect(card.getByRole('combobox', { name: 'Role for alex@example.com' })).toHaveValue('developer');
  });

  test('someone already here is pointed at, not invited twice; someone removed comes back only on purpose', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': people({ data: [DANA, GONE] }), '/portal/shares': SHARES_NONE } });
    await page.goto('/sharing.html');
    const card = peopleCard(page);
    await page.route(/\/presence\/portal\/members$/, (route) => {
      if (route.request().method() !== 'POST') return route.fulfill(json(people({ data: [DANA, GONE] })));
      const b = route.request().postDataJSON();
      if (b.email === 'dana@example.com') return route.fulfill(json({ error: 'already_member', member: { id: 'm-1', email: 'dana@example.com', role: 'business_staff' }, message: 'dana@example.com are already here as Staff. Change their role in the list instead.' }, 409));
      if (b.restore) return route.fulfill(json({ data: { ok: true, restored: true } }));
      return route.fulfill(json({ error: 'was_removed', member: { id: 'm-3', email: 'gone@example.com', role: 'developer' }, message: 'removed' }, 409));
    });
    await card.getByRole('button', { name: '+ Invite someone' }).click();
    await card.locator('#pp-email').fill('dana@example.com');
    await card.getByRole('button', { name: 'Send invite' }).click();
    await expect(card.locator('.pp-err')).toContainText('already here as Staff');
    await card.getByRole('button', { name: 'Show me' }).click();
    await expect(card.getByRole('combobox', { name: 'Role for dana@example.com' })).toBeFocused();
    // the removed one: the server asks first; Bring them back sends restore with the role picked
    await card.getByRole('button', { name: '+ Invite someone' }).click();
    await card.locator('#pp-email').fill('gone@example.com');
    await card.getByRole('button', { name: 'Send invite' }).click();
    await expect(card.locator('.pp-err')).toContainText('were removed earlier. Bring them back as Staff?');
    const restored = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members'));
    await card.locator('.pp-err').getByRole('button', { name: 'Bring them back' }).click();
    expect((await restored).postDataJSON()).toEqual({ email: 'gone@example.com', role: 'business_staff', restore: true });
  });

  test('a role changes from its own list; Remove asks for a second press; Send it again resends', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': people({ data: [DANA, JO] }), '/portal/shares': SHARES_NONE } });
    await page.goto('/sharing.html');
    const card = peopleCard(page);
    const role = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members/m-1/role'));
    await card.getByRole('combobox', { name: 'Role for dana@example.com' }).selectOption('developer');
    expect((await role).postDataJSON()).toEqual({ role: 'developer' });
    let revokes = 0;
    page.on('request', (r) => { if (r.url().endsWith('/portal/members/m-2/revoke')) revokes++; });
    const jo = card.locator('[data-seat="m-2"]');
    await jo.getByRole('button', { name: 'Remove jo@example.com' }).click();
    await expect(jo.getByRole('button', { name: 'Press again to remove jo@example.com' })).toBeFocused();
    expect(revokes).toBe(0);
    const revoked = page.waitForRequest((r) => r.url().endsWith('/portal/members/m-2/revoke'));
    await jo.getByRole('button', { name: 'Press again to remove jo@example.com' }).click();
    await revoked;
    await expect(page.locator('.dds-toast').filter({ hasText: 'Removed.' })).toBeVisible();
    const again = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members') && r.postDataJSON()?.resend === true);
    await card.locator('[data-seat="m-2"]').getByRole('button', { name: 'Send it again' }).click();
    expect((await again).postDataJSON()).toEqual({ email: 'jo@example.com', resend: true });
  });

  test('transfer ownership: the owner names the new owner, keeps a Co-owner place by default, and can stop it while it waits', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });
    await page.goto('/sharing.html');
    const card = peopleCard(page);
    await card.getByRole('button', { name: 'Transfer ownership' }).click();
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('Hand this site to someone else');
    await expect(card.locator('.pp-step')).toHaveCount(2);   // the owner starts it: only the new owner has to accept
    await expect(card.locator('.pp-step').first()).toContainText('They accept');
    await expect(card.getByRole('checkbox', { name: /Keep me on as Co-owner/ })).toBeChecked();
    await expect(card.getByRole('button', { name: 'Send to them to accept' })).toBeVisible();
    await page.route(/\/presence\/portal\/(members|transfer)(\/cancel)?$/, (route) => {
      const u = route.request().url();
      if (u.endsWith('/portal/transfer')) return route.fulfill(json({ data: { message: 'We’ve emailed ana@example.com to accept. Nothing changes until they do.' } }, 201));
      if (u.endsWith('/portal/transfer/cancel')) return route.fulfill(json({ data: { cancelled: true, message: 'Stopped. Nothing changed.' } }));
      return route.fulfill(json(people({ transfer: { id: 't1', to_email: 'ana@example.com', from_email: 'owner@example.com', status: 'asked_new', started_side: 'owner', keep_old: false, expires_at: '2026-11-25T00:00:00Z', created_at: '2026-11-11T00:00:00Z' } })));
    });
    await card.locator('#pp-to').fill('ana@example.com');
    await card.getByRole('checkbox', { name: /Keep me on as Co-owner/ }).uncheck();
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/transfer'));
    await card.getByRole('button', { name: 'Send to them to accept' }).click();
    expect((await sent).postDataJSON()).toEqual({ email: 'ana@example.com', keep_owner: false });
    await expect(page.locator('.dds-toast').filter({ hasText: 'We’ve emailed ana@example.com to accept.' })).toBeVisible();
    await expect(card.locator('[data-wait]')).toContainText('Handing over to ana@example.com. Waiting for ana@example.com to accept');
    await expect(card.getByRole('button', { name: 'Transfer ownership' })).toHaveCount(0);   // one at a time
    const stop = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/transfer/cancel'));
    await card.getByRole('button', { name: 'Stop the handover' }).click();
    await stop;
    await expect(page.locator('.dds-toast').filter({ hasText: 'Stopped. Nothing changed.' })).toBeVisible();
  });

  test('a refused transfer says why and changes nothing on the page', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });
    await page.route(/\/presence\/portal\/transfer$/, (route) => route.fulfill(json({ error: 'owns_another', message: 'That person already owns a business here, and one sign-in can own one. Add them as a Co-owner instead: they can switch between both.' }, 409)));
    await page.goto('/sharing.html');
    const card = peopleCard(page);
    await card.getByRole('button', { name: 'Transfer ownership' }).click();
    await card.locator('#pp-to').fill('busy@example.com');
    await card.getByRole('button', { name: 'Send to them to accept' }).click();
    await expect(card.locator('.pp-err')).toContainText('Add them as a Co-owner instead');
    await expect(card.locator('#pp-to')).toHaveValue('busy@example.com');
  });

  test('a non-owner sees the honest wall, not the controls', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': { data: {
      site_role: 'client_reviewer', sees_full_workspace: false, is_client_portal: true, edition_key: 'studio_os',
      edition_features: ['website', 'client_portal'], attention_count: 0,
      nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
    } } } });
    await page.goto('/sharing.html');
    await expect(page.locator('#main')).toContainText('Only the account owner can manage sharing.');
    await expect(page.locator('#peopleCard')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
  });

  test('a staff seat (no invite capability) sees the wall too, and nothing is read', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': { data: {
      site_role: 'business_staff', sees_full_workspace: true, is_client_portal: false, edition_key: 'studio_os', edition_features: ALL_FEATURES,
      capabilities: ['view_all', 'edit', 'approve', 'publish', 'connect', 'export', 'comment'], attention_count: 0, nav: STUDIO_NAV, landing: '/today.html',
    } } } });
    const asked: string[] = [];
    page.on('request', (r) => { const p = new URL(r.url()).pathname; if (/\/portal\/(members|shares)$/.test(p)) asked.push(p); });
    await page.goto('/sharing.html');
    await expect(page.locator('#main')).toContainText('Only the account owner can manage sharing.');
    expect(asked).toEqual([]);
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
const REVIEWER = { id: 'm-1', email: 'pat@example.com', role: 'client_reviewer', role_words: 'Reviewer', status: 'active', created_at: '2026-11-01T00:00:00Z', joined: false };

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
    await installApp(page, { api: { '/portal/context': SCOPED_CTX, '/portal/members': people({ data: [REVIEWER], owner: { name: 'Marlow Chen', email: 'marlow@example.com', signed_in: true, me: false }, studio: { name: 'Bright Studio', role: 'Website manager', people: [{ email: 'owner@example.com', role: 'Studio owner', me: true }] }, can_transfer: 'studio' }), '/portal/shares': SHARES_NONE } });
    const seen = spyScope(page);
    await page.goto(`/sharing.html?client=${CLIENT}`);
    // the page says whose site it is, and the way back stays in scope
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sharing & access — Marlow’s Kitchen');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Website' })).toHaveAttribute('href', `/presence.html?client=${CLIENT}`);
    await expect(page.locator('#dds-ctxbar')).toContainText('Marlow’s Kitchen');
    // the reads
    expect(seen).toContainEqual(['GET /portal/members', CLIENT]);
    expect(seen).toContainEqual(['GET /portal/shares', CLIENT]);
    // the writes: invite · flip a share · remove
    const revoked = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members/m-1/revoke'));
    await page.locator('[data-seat="m-1"]').getByRole('button', { name: 'Remove pat@example.com' }).click();
    await page.locator('[data-seat="m-1"]').getByRole('button', { name: 'Press again to remove pat@example.com' }).click();
    expect((await revoked).headers()['x-dds-scope-site']).toBe(CLIENT);
    const flipped = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/shares'));
    await page.locator('.rowitem').filter({ hasText: 'Drafts' }).getByRole('switch').click();
    expect((await flipped).headers()['x-dds-scope-site']).toBe(CLIENT);
    await page.getByRole('button', { name: '+ Invite someone' }).click();
    await page.locator('#pp-email').fill('ana@example.com');
    const invited = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members'));
    await page.getByRole('button', { name: 'Send invite', exact: true }).click();
    expect((await invited).headers()['x-dds-scope-site']).toBe(CLIENT);
    // and NOTHING this page sent went to the studio's own site
    await expect.poll(() => seen.length).toBeGreaterThanOrEqual(6);
    expect(seen.filter(([, scope]) => scope !== CLIENT)).toEqual([]);
  });

  test('without ?client= no request carries a scope; the heading and the breadcrumb are the plain ones', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': people({ data: [REVIEWER] }), '/portal/shares': SHARES_NONE } });
    const seen = spyScope(page);
    await page.goto('/sharing.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sharing & access');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Website' })).toHaveAttribute('href', '/presence.html');
    await expect(page.locator('#dds-ctxbar')).toHaveCount(0);
    await page.getByRole('button', { name: '+ Invite someone' }).click();
    await page.locator('#pp-email').fill('ana@example.com');
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

// ── builder list item 136 (Nov 2026 review, structure finding 6) ──
test.describe('Sharing & access — a studio picks the client first (item 136)', () => {
  test('at studio level the page asks which client, links each to their own page, and never offers to invite to the studio’s site', async ({ page }) => {
    const AGENCY = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
      is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV, scope: null } };
    const sites = [{ site_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Marlow’s Kitchen', domain: 'marlows.example' }, { site_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: 'Harbor Dental', address: 'https://harbor.example' }, { site_id: 'cccccccc-3333-4333-8333-cccccccccccc', name: 'Bright Studio', own: true }];
    await installApp(page, { api: { '/portal/context': AGENCY, '/agency/sites': { data: sites.filter((x) => !x.own) }, '/portal/members': MEMBERS_NONE, '/portal/shares': SHARES_NONE } });   // the real shape: {data:[rows]}, the studio's own site never in it
    const asked: string[] = [];
    page.on('request', (r) => { const p = new URL(r.url()).pathname; if (/\/portal\/(members|shares)$/.test(p)) asked.push(p); });
    await page.goto('/sharing.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sharing & access');
    const list = page.getByRole('list', { name: 'Clients' });
    await expect(list.getByRole('listitem')).toHaveCount(2);                      // the studio's own site isn't a client
    await expect(list.getByRole('listitem').first()).toHaveAttribute('href', '/sharing.html?client=aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    await expect(list).toContainText('Marlow’s Kitchen');
    await expect(page.locator('#peopleCard')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings.html');
    expect(asked).toEqual([]);                                                     // nothing read or written for the studio's own site
  });

  test('a failed client read says so', async ({ page }) => {
    const AGENCY = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_features: ALL_FEATURES, is_agency: true, sees_full_workspace: true, capabilities: ['invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV, scope: null } };
    await installApp(page, { api: { '/portal/context': AGENCY } });
    await page.route(/\/functions\/v1\/presence\/agency\/sites$/, (r) => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"x"}' }));
    await page.goto('/sharing.html');
    await expect(page.locator('#pickList')).toContainText('Your clients wouldn’t load just now.');
  });
});

// Builder list item 150 (review file 05, finding 18): Sharing & access in the accessibility
// scan, light and dark, with people on the list.
test.describe('Sharing & access accessibility (builder list item 150)', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop'); });
  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious/critical axe violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: { '/portal/members': people({ data: [DANA, JO] }), '/portal/shares': SHARES_NONE } });
      await page.goto('/sharing.html');
      await expect(peopleCard(page)).toContainText('dana@example.com');
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.map((n) => n.target.join(' ') + ' ' + String(n.any[0]?.message || '').slice(0, 170)).join(' | ')}`)).toEqual([]);
    });
  }
});
