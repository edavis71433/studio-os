import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// ── Who owns each site, on the Sites page (builder list item 53) ──────────────
// Wix's model: the client owns the site and the studio works on it with a role,
// said plainly on every card ("Sam Reyes owns it · You: Website manager"), with a
// People sheet (people.js) for one client's site, opened from the card, its menu or
// the table, every request scoped to that site; Transfer ownership on the menu; and
// in the table, Owner and People columns, with the studio's role said once.

const row = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live', address: '', domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [], tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-09T00:00:00Z',
  unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: null, copied: null, no_owner: false, owner: null, transfer: null, ...over,
});
const MAPLE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', BLUE_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', HARBOR_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const MAPLE = row({ site_id: MAPLE_ID, name: 'Maple & Main Realty', address: 'https://maple.example', domain: 'maple.example', owner: { name: 'Sam Reyes', email: 'sam@maple.example' },
  team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }, { who: 'Sam Reyes', email: 'sam@maple.example', side: 'client', role: 'Owner', me: false, invited: false }, { who: 'dana@maple.example', email: 'dana@maple.example', side: 'client', role: 'Staff', me: false, invited: false }] });
const BLUE = row({ site_id: BLUE_ID, name: 'Bluebird Bakery', address: 'https://bluebird.example', owner: { name: 'Lena Park', email: 'lena@bluebird.example' },
  transfer: { id: 't1', to_email: 'ana@bluebird.example', from_email: 'lena@bluebird.example', status: 'asked_owner', started_side: 'studio', keep_old: true, expires_at: '2026-11-25T00:00:00Z', created_at: '2026-11-11T00:00:00Z' } });
const HARBOR = row({ site_id: HARBOR_ID, name: 'Harbor Dental', state: 'elsewhere', state_words: 'Hosted elsewhere', edition: 'monitor', no_owner: true, updated_at: null, published_at: null });
const body = (rows: unknown[], over: Record<string, unknown> = {}) => ({ data: rows, partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, can_people: true, studio_role: 'Website manager', studio_name: 'Bright Studio', trash: [], trash_days: 90, ...over });
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV } };
const PEOPLE = { data: [{ id: 'm-1', email: 'dana@maple.example', role: 'business_staff', role_words: 'Staff', status: 'active', created_at: '2026-10-14T00:00:00Z', joined: true }],
  owner: { name: 'Sam Reyes', email: 'sam@maple.example', signed_in: false, me: false }, studio: { name: 'Bright Studio', role: 'Website manager', people: [{ email: 'owner@studio.example', role: 'Studio owner', me: true }] },
  transfer: null, transfer_ready: true, can_transfer: 'studio' };
const json = (b: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });

async function openSites(page: Page, rows: unknown[] = [MAPLE, BLUE, HARBOR], over: Record<string, unknown> = {}) {
  await installApp(page, { api: { '/portal/context': studioContext, '/agency/sites': body(rows, over), '/portal/members': PEOPLE,
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } } } });
  const scoped: Array<[string, string]> = [];
  page.on('request', (r) => { const p = new URL(r.url()).pathname; if (/\/presence\/portal\/(members|transfer)/.test(p)) scoped.push([r.method() + ' ' + p.replace(/^.*\/presence/, ''), r.headers()['x-dds-scope-site'] || '']); });
  await page.goto('/sites.html');
  await expect(page.locator('.scard').first()).toBeVisible();
  return scoped;
}
const card = (page: Page, name: string) => page.locator('.scard').filter({ has: page.getByRole('heading', { name }) });

test.describe('Sites: who owns each site (builder item 53)', () => {
  test('each card says who owns it and what you are on it; the foot is just when it changed', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await openSites(page);
    const maple = card(page, 'Maple & Main Realty');
    await expect(maple.locator('.who')).toContainText('Sam Reyes owns it');
    await expect(maple.locator('.who .ochip')).toHaveText('Owner');
    await expect(maple.locator('.who')).toContainText('You: Website manager');
    await expect(maple.locator('.who .sav')).toHaveText('BS');
    await expect(maple.getByRole('button', { name: 'People on Maple & Main Realty' })).toBeVisible();
    await expect(maple.locator('.sfoot')).toHaveText('Edited Nov 9');
    await expect(page.locator('.scard').filter({ hasText: 'Can edit:' })).toHaveCount(0);
    const blue = card(page, 'Bluebird Bakery');
    await expect(blue.locator('.handing')).toHaveText('Handing over to ana@bluebird.example. Waiting for Lena to agree.');
    const harbor = card(page, 'Harbor Dental');
    await expect(harbor.locator('.owner')).toContainText('No owner yet');
    await expect(harbor.locator('.who')).not.toContainText('owns it');
    await expect(harbor.locator('.who')).toContainText('You: Website manager');
    expect(errors).toEqual([]);
  });

  test('People › opens the sheet for that site, and every request it makes names that site', async ({ page }) => {
    const scoped = await openSites(page);
    await card(page, 'Maple & Main Realty').getByRole('button', { name: 'People on Maple & Main Realty' }).click();
    await expect(page.getByRole('dialog', { name: 'People' })).toBeVisible();
    const sheet = page.locator('#dds-people');   // its name follows its heading, which changes with the view
    await expect(sheet.locator('.pp-head .sub')).toHaveText('Maple & Main Realty · maple.example');
    await expect(sheet.locator('.pp-note')).toHaveText('Sam Reyes owns this site. Your studio works on it as Website manager. People on Sam’s side each get their own sign-in, with a role.');
    await expect(sheet.locator('[data-owner]')).toContainText('Hasn’t signed in yet');
    await expect(sheet.getByRole('combobox', { name: 'Role for dana@maple.example' })).toHaveValue('business_staff');
    await sheet.getByRole('button', { name: '+ Invite someone' }).click();
    await sheet.locator('#pp-email').fill('alex@maple.example');
    await sheet.getByRole('radio', { name: /Co-owner/ }).check();
    const invited = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members'));
    await sheet.getByRole('button', { name: 'Send invite' }).click();
    expect((await invited).postDataJSON()).toEqual({ email: 'alex@maple.example', role: 'business_owner' });
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.filter(([, s]) => s !== MAPLE_ID)).toEqual([]);
    // a change re-reads the list when the sheet closes, so the card follows
    const reread = page.waitForRequest((r) => r.method() === 'GET' && /\/presence\/agency\/sites$/.test(new URL(r.url()).pathname));
    await sheet.getByRole('button', { name: 'Close' }).click();
    await reread;
    await expect(sheet).toBeHidden();
    await expect(card(page, 'Maple & Main Realty').getByRole('button', { name: 'People on Maple & Main Realty' })).toBeFocused();
  });

  test('the menu has People and roles, and Transfer ownership where there is an owner and nothing waiting', async ({ page }) => {
    const scoped = await openSites(page);
    await card(page, 'Maple & Main Realty').getByRole('button', { name: 'More for Maple & Main Realty' }).click();
    let menu = page.getByRole('menu', { name: 'More for Maple & Main Realty' });
    await expect(menu.getByRole('menuitem', { name: 'People and roles' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Transfer ownership' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { level: 2 })).toHaveText('Hand Maple & Main Realty to someone else');
    await expect(sheet.locator('.pp-step')).toHaveCount(3);   // the studio starts it: Sam agrees first
    await expect(sheet.locator('.pp-step').first()).toContainText('Sam agrees');
    await sheet.locator('#pp-to').fill('ana@maple.example');
    await page.route(/\/presence\/portal\/transfer$/, (route: Route) => route.fulfill(json({ data: { message: 'We’ve emailed Sam Reyes to agree. Then ana@maple.example gets an email to accept.' } }, 201)));
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/transfer'));
    await sheet.getByRole('button', { name: 'Send to Sam to agree' }).click();
    expect((await sent).postDataJSON()).toEqual({ email: 'ana@maple.example', keep_owner: true });
    await expect(page.locator('.dds-toast').filter({ hasText: 'We’ve emailed Sam Reyes to agree.' })).toBeVisible();
    expect(scoped.filter(([, s]) => s !== MAPLE_ID)).toEqual([]);
    await sheet.getByRole('button', { name: 'Close' }).click();
    // a handover already waiting, or no owner yet: no Transfer ownership on the menu
    for (const name of ['Bluebird Bakery', 'Harbor Dental']) {
      await card(page, name).getByRole('button', { name: `More for ${name}` }).click();
      menu = page.getByRole('menu', { name: `More for ${name}` });
      await expect(menu.getByRole('menuitem', { name: 'People and roles' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Transfer ownership' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  });

  test('the table: Owner and People columns, the studio’s role said once, People opens the sheet', async ({ page }) => {
    await openSites(page);
    await page.getByRole('button', { name: 'Table' }).click();
    const table = page.locator('#tableHost');
    await expect(table.locator('.trole')).toHaveText('You are Website manager on all 3 sites. Each business owns its own site.');
    const head = table.locator('thead th');
    await expect(head.filter({ hasText: 'Owner' })).toHaveCount(1);
    await expect(head.filter({ hasText: 'People' })).toHaveCount(1);
    const maple = table.locator('tr', { hasText: 'Maple & Main Realty' });
    await expect(maple).toContainText('Sam Reyes');
    await expect(table.locator('tr', { hasText: 'Bluebird Bakery' })).toContainText('Handing over to ana@bluebird.example');
    await expect(table.locator('tr', { hasText: 'Harbor Dental' })).toContainText('No owner yet');
    const wide = (page.viewportSize()?.width || 0) > 760;
    if (wide) {
      await maple.getByRole('button', { name: 'People on Maple & Main Realty' }).click();
      await expect(page.getByRole('dialog', { name: 'People' })).toBeVisible();
    } else {
      await expect(head.filter({ hasText: 'Owner' })).toBeHidden();   // on a phone the card carries them
    }
  });

  test('a studio seat that can’t open clients reads View only, and gets no People', async ({ page }) => {
    await openSites(page, [MAPLE], { can_open: false, can_people: false, can_create: false, can_duplicate: false, can_trash: false, studio_role: 'View only' });
    const maple = card(page, 'Maple & Main Realty');
    await expect(maple.locator('.who')).toContainText('You: View only');
    await expect(maple.getByRole('button', { name: /People on/ })).toHaveCount(0);
    await maple.getByRole('button', { name: 'More for Maple & Main Realty' }).click();
    const menu = page.getByRole('menu', { name: 'More for Maple & Main Realty' });
    await expect(menu.getByRole('menuitem', { name: 'People and roles' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Transfer ownership' })).toHaveCount(0);
  });
});
