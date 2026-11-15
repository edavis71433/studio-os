import { test, expect, Page, Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_NAV } from './helpers/app';
import { seatCapabilities, designerAllowed, SEAT_WORDS, publishWords } from '../../supabase/functions/presence/lib/site_roles';

// Builder item 220: a Designer works on the website and sees nothing of the business.
// The server refuses a Designer every route outside lib/site_roles.ts designerAllowed
// (index.ts, before any handler). Here the stub refuses the same routes the same way,
// so these prove the pages a Designer uses never ask for one (a 403 on screen would be
// the page's fault), and that the business's tabs, the bell and Inbox are gone.
const DESIGNER_NAV = [
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Website', href: '/presence.html', desc: 'The website you work on: its pages, styles and photos.' },
    { key: 'design', label: 'Edit site', href: '/presence.html#design', hidden: true },
    { key: 'add_page', label: 'Add a page', href: '/presence.html#addpage', hidden: true },
    { key: 'history', label: 'Versions', href: '/presence.html#history', hidden: true },
  ] },
  { key: 'files', label: 'Files', items: [{ key: 'files_all', label: 'Files', href: '/files.html' }] },
  { key: 'help', label: 'Help', utility: true, items: [{ key: 'help', label: 'Help', href: '/help.html', hidden: true }] },
];
const designerCtx = (canPublish = false) => ({ data: {
  site_role: 'designer', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, is_managed_client: false, sees_full_workspace: false, is_client_portal: false,
  capabilities: seatCapabilities({ role: 'designer', can_publish: canPublish }), landing: '/presence.html', attention_count: 0, nav: DESIGNER_NAV,
  plan_key: 'presence', upsell: null, scope: null, businesses: [], business: null,
  my_role: { role: 'designer', name: 'Designer', you: SEAT_WORDS.designer.you, publish: publishWords({ role: 'designer', can_publish: canPublish }), can_publish: canPublish, business: 'Marlow’s Kitchen' },
} });

const PIC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const SITE_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [{ id: 'o1', name: 'Pasta', category: 'Mains', description: '', price_text: '$12', is_visible: true }] },
  '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [{ id: 'm1', alt_text: 'Pasta', thumb: PIC, created_at: '2026-01-01T00:00:00Z', used_by: [] }] },
  '/settings': { data: {} }, '/health': { data: {} },
  '/changes': { data: { count: 2, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [] } },
  '/schedule': { data: { scheduled: [] } },
  '/preview/status': { data: { draft: { unpublished_changes: 2 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-07-01T00:00:00Z', summary: '' } } },
  '/site/templates': { data: { current: { slug: 'business-classic', version: '1.0.0' }, templates: [{ slug: 'business-classic', name: 'Business classic', version: '1.0.0' }] } },
  '/assets/collections': { data: [] }, '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [], total: 0, shown: 0, live_count: 0, policy: 'immediate' } },
};
// the routes index.ts answers before the boundary: each holds its own door
const BEFORE_BOUNDARY = /^\/(commerce|help\/ask|push|agency|transfers|admin|analytics\/portfolio)(\/|$)/;

/** Signed in as Lee, a Designer: the stub answers like the server, refusing what a Designer can't reach. */
async function asDesigner(page: Page, canPublish = false, api: Record<string, unknown> = SITE_API): Promise<string[]> {
  await installApp(page, { api: { ...api, '/portal/context': designerCtx(canPublish) } as never });
  await page.addInitScript(() => { try { localStorage.setItem('dds-toured:designer', '1'); } catch { /* storage may be denied */ } });
  const refused: string[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '') || '/';
    const method = route.request().method();
    if (method === 'OPTIONS' || BEFORE_BOUNDARY.test(path) || designerAllowed(path, method)) return route.fallback();
    refused.push(`${method} ${path}`);
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', role: 'designer', message: 'That isn’t part of a Designer’s role.' }) });
  });
  return refused;
}
const ready = (page: Page) => page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
const lacks = (page: Page) => page.evaluate(() => (document.documentElement.getAttribute('data-dds-lacks') || '').split(' ').filter(Boolean).sort());
const settle = (page: Page) => page.waitForLoadState('networkidle').catch(() => { /* a long poll is fine */ });

test.describe('A Designer on the website', () => {
  test('the role lacks the business, publishing and settings, and keeps styling', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    expect(await lacks(page)).toEqual(['approve', 'business', 'configure', 'delete', 'owner', 'publish']);
  });

  test('with the publish switch on, publishing is theirs too', async ({ page }) => {
    await asDesigner(page, true);
    await page.goto('/presence.html');
    await ready(page);
    expect(await lacks(page)).toEqual(['approve', 'business', 'configure', 'delete', 'owner']);
  });

  test('the editor asks the server for nothing a Designer can\'t reach', async ({ page }) => {
    const refused = await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    await expect(page.locator('#app')).toBeVisible();
    await settle(page);
    expect(refused).toEqual([]);
  });

  test('the business tabs are gone; the website\'s stay', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    // the editor draws its tabs twice (the sidebar on a computer, the Sections sheet on a phone): count the visible ones
    const all = (label: string) => page.locator('.navitem', { hasText: new RegExp('^' + label + '$') });
    for (const label of ['Search', 'Bookings', 'Reviews', 'Analytics', 'Domain & email', 'Connections', 'Sharing & access', 'See the client’s view']) {
      expect(await all(label).count(), label + ' is drawn (and so hidden by the role, not missing)').toBeGreaterThan(0);
      for (const t of await all(label).all()) expect(await t.evaluate((n) => getComputedStyle(n).display), label + ' is gone').toBe('none');
    }
    // the website's tabs keep their place (on a phone they sit in the Sections sheet, so ask the role's rule, not the screen)
    for (const label of ['Pages', 'Styles', 'Business details', 'Versions']) {
      expect(await all(label).count(), label + ' is drawn').toBeGreaterThan(0);
      for (const t of await all(label).all()) expect(await t.evaluate((n) => n.matches('[data-needs]')), label + ' stays').toBe(false);
    }
  });

  test('a business tab opened by its address shows the Overview instead', async ({ page }) => {
    const refused = await asDesigner(page);
    await page.goto('/presence.html#bookings');
    await ready(page);
    await expect(page.locator('#view-today')).toHaveClass(/\bon\b/);
    await expect(page.locator('#view-bookings')).not.toHaveClass(/\bon\b/);
    await settle(page);
    expect(refused).toEqual([]);
  });

  test('Styles opens for a Designer; changing the template stays the owner\'s', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html#design');
    await ready(page);
    const display = (sel: string) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).display);
    expect(await display('#btnSettingsOpen')).not.toBe('none');
    expect(await display('#designGallery')).toBe('none');
  });

  test('no bell: it would ring for the business', async ({ page }) => {
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    await expect(page.locator('#dds-bell')).toBeHidden();
  });
});

test.describe('A Designer in Files', () => {
  test('Files works and asks for nothing a Designer can\'t reach', async ({ page }) => {
    const refused = await asDesigner(page);
    await page.goto('/files.html');
    await ready(page);
    await settle(page);
    expect(refused).toEqual([]);
    await expect(page.locator('#makeImage')).toBeHidden();   // no Visual Studio: keeping an AI image is an approval
  });

  test('the Trash opens, and a Designer may put a file back but never delete one for good (item 218)', async ({ page }) => {
    const PHOTO = { id: 'cccccccc-0000-4000-8000-000000000001', name: 'Team photo', alt_text: 'The team', tags: [], asset_status: 'approved', state: 'approved', created_at: '2026-10-01T00:00:00Z', favorite: false, in_use: false, kind: 'image', mime: 'image/jpeg', bytes: 620000, width: 1600, height: 1100 };
    const GONE = { id: 'cccccccc-0000-4000-8000-000000000011', name: 'Waiting room', kind: 'image', bytes: 605000, folder: '', trashed_at: new Date().toISOString(), goes_at: new Date(Date.now() + 30 * 86400000).toISOString(), days_left: 30, by: 'Sam', live: false, kept_live: false, thumb: null };
    const refused = await asDesigner(page, false, { ...SITE_API,
      '/assets': { data: { assets: [PHOTO], total: 1, shown: 1, live_count: 0, policy: 'immediate', trash: 1 } },
      '/assets/trash': { data: { files: [GONE], days: 30, available: true } } });
    const sent: string[] = [];
    page.on('request', (r) => { if (/\/assets\/[0-9a-f-]{36}\/put-back$/.test(r.url())) sent.push(r.method()); });
    await page.goto('/files.html');
    await ready(page);
    await page.locator('#filters [data-col="trash"]').click();
    await expect(page.locator('.tband h2')).toHaveText('Trash');
    const row = page.locator(`.trow[data-trash="${GONE.id}"]`);
    await expect(row.locator('[data-forever]')).toBeHidden();   // deleting for good needs delete, which a Designer never holds
    await row.getByRole('button', { name: 'Put back Waiting room' }).click();
    await expect.poll(() => sent).toEqual(['POST']);
    await settle(page);
    expect(refused).toEqual([]);
  });

  test('on a phone, the bottom bar offers no Inbox', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'the bottom bar is a phone\'s');
    await asDesigner(page);
    await page.goto('/files.html');
    await ready(page);
    await expect(page.locator('#dds-mbar')).toBeAttached();
    await expect(page.locator('#dds-mbar [data-mbar="inbox"]')).toHaveCount(0);
  });
});

// ── the new looks (Figma 404:550, approved Nov 15) ───────────────────────────
test.describe('A Designer\'s own screen', () => {
  test('the menu says the role in one sentence, and who publishes', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'a phone shows it in the Menu (below)');
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    const card = page.locator('#dds-rolecard');
    await expect(card).toBeVisible();
    await expect(card.locator('.rc-t')).toHaveText('You’re a Designer on Marlow’s Kitchen');
    await expect(card.locator('.rc-s')).toHaveText(SEAT_WORDS.designer.you);
    await expect(card.locator('.rc-p')).toHaveText('The owner or the studio publishes your changes.');
  });

  test('on a phone, the Menu opens on the role', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'the Menu sheet is a phone\'s');
    await asDesigner(page);
    await page.goto('/files.html');
    await ready(page);
    await page.locator('#dds-mbar-menu:visible, #dds-waffle:visible').first().click();   // builder item 165: a phone's Menu is the bar's; the nine dots stay hidden there
    await expect(page.locator('#dds-drawer .dds-rolecard')).toBeVisible();
    await expect(page.locator('#dds-drawer .dds-rolecard .rc-t')).toHaveText('You’re a Designer on Marlow’s Kitchen');
  });

  test('Publish waits: the pill says so and opens a note', async ({ page }, info) => {
    await asDesigner(page);
    await page.goto('/presence.html');
    await ready(page);
    const phone = info.project.name === 'mobile';
    const pill = page.locator(phone ? '#dockWait' : '#btnWaitPub');
    await expect(pill).toBeVisible();
    await expect(page.locator(phone ? '#dockPublish' : '#btnPublish')).toBeHidden();
    await expect(pill).toHaveText(phone ? 'Waiting·2' : 'Waiting to be published');
    await pill.click();
    const note = page.locator('#waitNote');
    await expect(note).toBeVisible();
    await expect(note.locator('p')).toHaveText('As a Designer here, the owner or the studio puts them live. Nothing you change shows on the live site until then. Preview shows exactly what they will publish.');
    await note.getByRole('button', { name: 'OK' }).click();
    await expect(note).toBeHidden();
  });

  test('with the publish switch on, Publish is theirs and no pill shows', async ({ page }, info) => {
    await asDesigner(page, true);
    await page.goto('/presence.html');
    await ready(page);
    const phone = info.project.name === 'mobile';
    await expect(page.locator(phone ? '#dockPublish' : '#btnPublish')).toBeVisible();
    await expect(page.locator(phone ? '#dockWait' : '#btnWaitPub')).toBeHidden();
  });

  test('a page outside the role says so, and the way back', async ({ page }) => {
    const refused = await asDesigner(page, false, { ...SITE_API, '/sales/contacts': { data: [] } });
    await page.goto('/customers.html');
    await ready(page);
    const card = page.locator('#dds-notyours');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { level: 1 })).toHaveText('Customers isn’t part of your role');
    await expect(card).toContainText('As a Designer on Marlow’s Kitchen you see the website, its pages, styles and photos.');
    await expect(card.getByRole('link', { name: 'Open the website' })).toHaveAttribute('href', '/presence.html');
    for (const m of await page.locator('main:not(#dds-notyours), [role="main"]:not(#dds-notyours)').all()) await expect(m, 'the page\'s own content is gone').toBeHidden();
    expect(refused.length).toBeGreaterThan(0);   // the page asked, and the stub refused like the server
  });
});

// ── People: every seat in one sentence, and a Designer's switch ──────────────
const OWNER_ME = { name: 'Sam Reyes', email: 'owner@example.com', signed_in: true, me: true };
const peopleOf = (data: unknown[]) => ({ data, owner: OWNER_ME, studio: null, transfer: null, transfer_ready: true, can_transfer: 'owner' });
const DANA = { id: 'm-1', email: 'dana@example.com', role: 'business_staff', role_words: 'Staff', status: 'active', created_at: '2026-10-14T00:00:00Z', joined: true, can_publish: false };
const LEE = { id: 'm-5', email: 'lee@pixel.example', role: 'designer', role_words: 'Designer', status: 'active', created_at: '2026-11-15T00:00:00Z', joined: false, can_publish: false };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('People, as the owner', () => {
  test('every seat says its role in one sentence; a Designer\'s switch saves as it turns', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': peopleOf([DANA, LEE]), '/portal/shares': { data: { shares: [] } } } });
    await page.route(/\/presence\/portal\/members\/m-5\/role$/, (r) => r.fulfill(json({ data: { ok: true, message: 'lee@pixel.example can publish now.' } })));
    await page.goto('/sharing.html');
    const card = page.locator('#peopleCard');
    await expect(card.locator('[data-sent="owner"]')).toHaveText('Sees and decides everything, and is the only one who can hand the site to someone else.');
    await expect(card.locator('[data-sent="m-1"]')).toHaveText('Staff sees the website, customers, messages and invoices, but can’t delete anything or change settings.');
    await expect(card.locator('[data-sent="m-5"]')).toHaveText('A Designer sees only the website, its pages, styles and photos, and never customers, contacts, deals, invoices or messages.');
    const sw = card.getByRole('switch', { name: 'Can publish to the live site: lee@pixel.example' });
    await expect(sw).not.toBeChecked();
    await expect(card.locator('.pp-row-pub .w')).toHaveText('Off: their changes wait in the draft until you publish.');
    await expect(card.getByRole('switch')).toHaveCount(1);   // staff have no switch
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members/m-5/role'));
    await sw.click();
    expect((await posted).postDataJSON()).toEqual({ role: 'designer', can_publish: true });
    await expect(card.locator('.pp-row-pub .w')).toHaveText('On: their changes go live when they press Publish.');
    await expect(sw).toBeChecked();
  });

  test('inviting a Designer: the card says what they see, the switch starts off, and what is sent says it', async ({ page }) => {
    await installApp(page, { api: { '/portal/members': peopleOf([]), '/portal/shares': { data: { shares: [] } } } });
    await page.goto('/sharing.html');
    const card = page.locator('#peopleCard');
    await card.getByRole('button', { name: '+ Invite someone' }).click();
    await expect(card.locator('legend')).toHaveText('What can they see?');
    const designer = card.locator('[data-role-card="designer"]');
    await expect(designer.locator('.ds')).toHaveText(SEAT_WORDS.designer.sees);
    await expect(designer.locator('.pp-can span')).toHaveText(['✓ Website', '✓ Photos', '✕ Customers', '✕ Messages', '✕ Invoices']);
    await expect(designer.getByRole('switch')).toHaveCount(0);   // only once Designer is picked
    await card.locator('#pp-email').fill('lee@pixel.example');
    await card.getByRole('radio', { name: /Designer/ }).check();
    const sw = designer.getByRole('switch');
    await expect(sw).not.toBeChecked();
    await expect(designer.locator('.pp-pub .w')).toHaveText('Off: their changes wait in the draft until you publish.');
    await expect(card.locator('#pp-email')).toHaveValue('lee@pixel.example');   // the pick redraws, the email stays
    await sw.click();
    await expect(designer.locator('.pp-pub .w')).toHaveText('On: their changes go live when they press Publish.');
    await page.route(/\/presence\/portal\/members$/, (r) => r.request().method() === 'POST' ? r.fulfill(json({ data: { ok: true, emailed: true, message: 'Invited as Designer — we’ve emailed them a sign-in link.' } })) : r.fulfill(json(peopleOf([{ ...LEE, can_publish: true }]))));
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/portal/members'));
    await card.getByRole('button', { name: 'Send invite' }).click();
    expect((await posted).postDataJSON()).toEqual({ email: 'lee@pixel.example', role: 'designer', can_publish: true });
    await expect(card.getByRole('switch', { name: 'Can publish to the live site: lee@pixel.example' })).toBeChecked();
  });
});

// ── your studio's Team: each role in one sentence ────────────────────────────
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['view_all', 'edit', 'publish', 'invite', 'configure', 'delete', 'design'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV, scope: null, plan_key: 'agency', upsell: null,
} };
const TEAM_API = {
  '/portal/context': STUDIO_CTX,
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'eric@brightstudio.example', member_id: 't-1' } },
  '/agency/members': { data: [
    { id: 't-1', email: 'eric@brightstudio.example', role: 'owner', status: 'active', created_at: '2026-01-10T00:00:00Z' },
    { id: 't-2', email: 'lee@pixel.example', role: 'designer', status: 'active', created_at: '2026-11-15T00:00:00Z' },
  ] },
  '/agency/usage': { data: { plan: 'agency', seats: { used: 2, limit: 5 }, clients: { used: 3, active: 3, archived: 0, limit: 10 }, editions: {}, publishes_30d: 1 } },
  '/commerce/subscription': { data: { plan: 'agency', plan_name: 'Agency', status: 'active', can_manage_billing: false } },
};
test.describe('Settings › Team', () => {
  test('each person, the role being invited, and a Who sees what table, one sentence a role', async ({ page }) => {
    await installApp(page, { api: TEAM_API as never });
    await page.goto('/settings.html#team');
    const rows = page.locator('#people .member');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.rolesent')).toHaveText('Sees everything: every client, the team, the brand and your plan.');
    await expect(rows.nth(1).locator('.rolesent')).toHaveText('Sees your client list and notes, and works only on the sites you add them to as Designer.');
    const pick = page.locator('#rolePick');
    await expect(pick).toHaveText('Account manager Opens every client to work on their site, records and messages, and publishes; can’t change the team or the brand.');
    await page.locator('#inv-role').selectOption('support');
    await expect(pick).toHaveText('Support Sees your client list and leaves notes; can’t open a client or change anything.');
    const table = page.locator('#roleHelp table');
    await expect(table.locator('tbody tr')).toHaveCount(8);
    const marks = (role: string) => table.locator(`tr[data-role="${role}"] .mk`);
    await expect(marks('owner')).toHaveText(['✓', '✓', '✓']);
    await expect(marks('admin')).toHaveText(['✓', '✓', '✕']);
    await expect(marks('account_manager')).toHaveText(['✓', '✕', '✕']);
    await expect(marks('designer')).toHaveText(['✕', '✕', '✕']);
  });
});
