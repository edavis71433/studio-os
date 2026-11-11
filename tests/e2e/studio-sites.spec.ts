import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Builder list items 43, 45 and 52 (Nov 2026): the studio's Sites page (every client
// site as a card with a live picture, or a table), Pin and Duplicate on each site's
// menu, and the Domains page. The fixtures match the REAL shapes: buildSites() and
// buildDomains() in supabase/functions/presence/agency/sites.ts, wrapped by its
// routes as { data, partial, can_pin, can_duplicate } and { data: { domains, builtin } }.
// tests/presence/studio_sites_test.mjs checks the keys below against buildSites().

const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live',
  address: '', domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
  tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
  unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: 'live', copied: null, no_owner: false,
  owner: null, transfer: null,   // item 53, who owns it and a transfer of ownership waiting
  ...over,
});
const BISTRO = site({ site_id: 's1', name: 'Bistro Nine', address: 'https://bistro.example', domain: 'bistro.example', domain_expires_at: '2026-11-20T00:00:00Z', tags: ['restaurant'],
  team: [
    { who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false },
    { who: 'am@studio.example', email: 'am@studio.example', side: 'studio', role: 'Account manager', me: false, invited: false },
    { who: 'staff@bistro.example', email: 'staff@bistro.example', side: 'client', role: 'Staff', me: false, invited: false },
  ], opened_at: '2026-11-07T09:00:00Z' });
const GARAGE = site({ site_id: 's2', name: 'Garage Ten', edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', address: 'https://garage.example', domain: 'garage.example', thumb: null,
  plan: { key: 'presence_monitor', words: 'Watch', status: 'active', term: '', renews: { kind: 'none', at: null } }, published_at: null });
const CAFE = site({ site_id: 's3', name: 'Cafe Eleven', state: 'not_live', state_words: 'Not live yet', address: '', thumb: 'draft', published_at: null, unpublished_changes: true,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: '', renews: { kind: 'trial', at: '2026-11-15T00:00:00Z' } } });
const sitesBody = (rows: unknown[], over: Record<string, unknown> = {}) => ({ data: rows, partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90, ...over });

const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [
  { key: 'sites', label: 'Sites', href: '/sites.html' }, { key: 'domains', label: 'Domains', href: '/domains.html', hidden: true },
] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const THUMB_HTML = (name: string) => `<!doctype html><html><head><style>body{margin:0;font:48px Georgia;background:#f4efe6}</style></head><body><h1 id="thumb-mark">${name} home page</h1></body></html>`;
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** The app plus the Sites routes. The harness matches by prefix, so the routes under
 *  /agency/sites/:id/… get their own handlers (registered after it, so they win). */
type ToolsOpts = { path?: string; kits?: unknown; made?: unknown; madeStatus?: number; invite?: unknown; inviteStatus?: number; apply?: unknown };
async function openSites(page: Page, rows: unknown[] = [BISTRO, GARAGE, CAFE], opts: { body?: Record<string, unknown>; thumbDelay?: number; needs?: Record<string, unknown>; needsRows?: unknown[]; dupPages?: unknown } & ToolsOpts = {}) {
  const thumbs: string[] = []; let inFlight = 0, maxInFlight = 0;
  const writes: Array<{ method: string; path: string; body: any }> = [];
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': sitesBody(rows, opts.body),
    '/agency/needs-you': { data: { rows: opts.needsRows || [], more: 0, rest: [], total: (opts.needsRows || []).length, empty_line: '', partial: false, own_site: true, next_by_site: opts.needs || {}, next_by_client: {} } },
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/thumb/, async (route: Route) => {
    const id = route.request().url().split('/agency/sites/')[1].split('/')[0];
    thumbs.push(id); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, opts.thumbDelay ?? 0));
    inFlight--;
    const s = (rows as Array<{ site_id: string; name: string }>).find((x) => x.site_id === id);
    await route.fulfill(json({ data: { html: THUMB_HTML(s ? s.name : id), version: 'live' } }));
  });
  await page.route(/\/functions\/v1\/presence\/(agency\/sites\/[^/]+\/(pin|duplicate|copied|invite|trash|restore)|sales\/customers|agency\/kits$|agency\/kits\/[^/]+\/apply)/, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    if (path === '/agency/kits' && route.request().method() !== 'POST') return route.fulfill(json(opts.kits ?? { data: [] }));
    const body = route.request().postDataJSON();
    writes.push({ method: route.request().method(), path, body });
    if (path.endsWith('/pin')) return route.fulfill(json({ data: { site_id: path.split('/')[3], pinned: body.pinned, pins: body.pinned ? [path.split('/')[3]] : [] } }));
    if (path.endsWith('/trash')) return route.fulfill(json({ data: { site_id: path.split('/')[3], trashed_at: '2026-11-10T12:00:00Z', goes_at: '2027-02-08T12:00:00Z', was_live: true, offline: true } }));
    if (path.endsWith('/restore')) return route.fulfill(json({ data: { site_id: path.split('/')[3], restored: true } }));
    if (path === '/sales/customers') return route.fulfill(json({ data: { created: true, client_id: 'c-new', site_id: 'snew', invited: true } }, 201));
    if (path.endsWith('/copied')) return route.fulfill(json({ data: { site_id: path.split('/')[3], copied: { from: 'Bistro Nine', kept: true } } }));
    if (path === '/agency/kits') return route.fulfill(json({ data: { id: 'k-new', name: body.name, offerings: 4, faqs: 2, kind: 'template', summary: { pages: 1, sections: 5, photos: 2 } } }));
    if (path.endsWith('/invite')) return route.fulfill(json(opts.invite ?? { data: { site_id: path.split('/')[3], email: String(body.email).trim().toLowerCase(), invited: true } }, opts.inviteStatus ?? 200));
    if (path.endsWith('/apply')) return route.fulfill(json(opts.apply ?? { data: { applied: { offerings: 6, faqs: 4, voice: true, colors: true, industry: 'florist' }, skipped: [] } }));
    return route.fulfill(json({ data: { site_id: 'snew', from_site_id: path.split('/')[3], look: 'Business Classic', applied: { offerings: 4, faqs: 2, voice: true, colors: true, industry: 'restaurant' }, pages: opts.dupPages ?? null, skipped: [] } }));
  });
  // item 135: + New site (POST to the list's own address; its GET stays the list) and the studio's kits
  await page.route(/\/functions\/v1\/presence\/agency\/sites$/, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    writes.push({ method: 'POST', path: '/agency/sites', body });
    const kit = body.kit_id ? { id: body.kit_id, name: 'Florist starter', applied: { offerings: 6, faqs: 4, voice: true, colors: true, industry: 'florist' }, skipped: [] } : null;
    return route.fulfill(json(opts.made ?? { data: { site_id: 's-made', client_id: 'c-made', name: String(body.business_name).trim(), kit } }, opts.madeStatus ?? 201));
  });
  // the kits list (GET) for + New site; a save (POST, Save as a template) goes on to the handler above
  await page.route(/\/functions\/v1\/presence\/agency\/kits$/, (route: Route) => (route.request().method() === 'GET' ? route.fulfill(json(opts.kits ?? { data: [] })) : route.fallback()));
  await page.goto(opts.path ?? '/sites.html');
  return { thumbs, writes, maxInFlight: () => maxInFlight };
}

test.describe('Sites (builder list items 43 and 45)', () => {
  test('boots: one h1, a card per site, Sites marked in the menu, the Domains tab — no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await openSites(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Sites' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.scard')).toHaveCount(3);
    await expect(page.locator('.lmeta')).toContainText('3 sites · Pinned first, then the ones you opened last');
    await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText('Sites');
    await expect(page.locator('.tabs a[href="/domains.html"]')).toHaveText('Domains');
    const isMobile = (page.viewportSize()?.width || 1280) < 761;
    if (!isMobile) await expect(page.locator('.dds-nav .sec.active > a[data-href="/sites.html"]')).toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });

  // Item 135 (Nov 10 review, file 05 finding 1): "+ New site" used to open Home's Add a
  // customer, which needs the client's email and sends them a sign-in link at once. Now it
  // makes a site from a business name, with nobody emailed; inviting the owner comes later.
  test('+ New site makes a site from a business name — no email asked, nobody emailed', async ({ page }) => {
    const t = await openSites(page);
    const btn = page.getByRole('button', { name: '+ New site' });
    await expect(btn).toBeVisible();
    await btn.click();
    const dlg = page.locator('#newDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('h3')).toHaveText('New site');
    await expect(dlg).toContainText('Nobody is emailed until you invite the owner.');
    await expect(dlg.locator('input[type="email"]')).toHaveCount(0);
    await expect(dlg.locator('#new-from-wrap')).toBeHidden();        // no kits saved: just the business name
    await dlg.locator('#new-submit').click();                       // no name yet → nothing sent
    expect(t.writes).toHaveLength(0);
    await dlg.locator('#new-biz').fill('Juniper Floral Co.');
    await dlg.locator('#new-submit').click();
    const done = dlg.locator('#new-done');
    await expect(done).toContainText('Juniper Floral Co.’s site is ready');
    await expect(done).toContainText('Nobody has been emailed. Invite the owner from its card when you’re ready to show them.');
    await expect(done.locator('#new-open')).toHaveAttribute('href', '/presence.html?client=s-made');
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /agency/sites']);
    expect(t.writes[0].body).toEqual({ business_name: 'Juniper Floral Co.' });
    await done.locator('#new-close').click();
    await expect(dlg).toBeHidden();
  });

  test('+ New site from a starter kit: a blank site first, the kits after; a kit that didn’t apply can be tried again', async ({ page }) => {
    const t = await openSites(page, [BISTRO, CAFE], {
      kits: { data: [{ id: 'k1', name: 'Florist starter', industry_key: 'florist', created_from_site: 's1', created_by: 'owner@studio.example', created_at: '2026-11-01T00:00:00Z' }] },
      made: { data: { site_id: 's-made', client_id: 'c-made', name: 'Willow Florist', kit: { id: 'k1', name: 'Florist starter', failed: true } } },
    });
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-from .opt strong')).toHaveText(['A blank site', 'Florist starter']);
    await expect(dlg.locator('#new-from input[value=""]')).toBeChecked();
    await dlg.locator('#new-biz').fill('Willow Florist');
    await dlg.locator('#new-from .opt', { hasText: 'Florist starter' }).click();
    await dlg.locator('#new-submit').click();
    const done = dlg.locator('#new-done');
    await expect(done).toContainText('Willow Florist’s site is ready');
    await expect(done.locator('#new-kit-line')).toHaveText('The Florist starter kit didn’t apply. The site is ready without it.');
    expect(t.writes[0].body).toEqual({ business_name: 'Willow Florist', kit_id: 'k1' });
    await done.locator('#new-kit-again').click();
    await expect(done.locator('#new-kit-line')).toHaveText('It starts from the Florist starter: 6 services, 4 FAQs, the voice, the colors.');
    await expect(done.locator('#new-kit-again')).toHaveCount(0);
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /agency/sites', 'POST /agency/kits/k1/apply']);
    expect(t.writes[1].body).toEqual({ site_id: 's-made' });
  });

  // items 135 + 145 together: + New site lists templates beside starter kits, each saying what it brings
  test('+ New site from a template: it says what a template brings, then the pages that came across', async ({ page }) => {
    const t = await openSites(page, [BISTRO, CAFE], {
      kits: { data: [
        { id: 't1', name: 'Realty — three pages', kind: 'template', summary: { pages: 3, sections: 14, photos: 9 } },
        { id: 'k1', name: 'Florist starter', kind: 'kit', summary: null },
      ] },
      made: { data: { site_id: 's-made', client_id: 'c-made', name: 'Oak Lane Realty', kit: { id: 't1', name: 'Realty — three pages', applied: { offerings: 4, faqs: 2, voice: true, colors: true }, skipped: [], layout: { applied: true, pages: 3, sections: 14, menu: 3, photos: 9, photos_failed: 0 } } } },
    });
    await page.getByRole('button', { name: '+ New site' }).click();
    const dlg = page.locator('#newDlg');
    await expect(dlg.locator('#new-from .opt', { hasText: 'Realty — three pages' })).toContainText('Template: 3 pages with their sections and photos, the menu and the look, plus services, FAQs, voice and colors.');
    await expect(dlg.locator('#new-from .opt', { hasText: 'Florist starter' })).toContainText('Starter kit: the services, FAQs, voice and colors it was saved with.');
    await expect(dlg).toContainText('A template brings a saved site’s pages, sections, photos, menu and look');
    await dlg.locator('#new-biz').fill('Oak Lane Realty');
    await dlg.locator('#new-from .opt', { hasText: 'Realty — three pages' }).click();
    await dlg.locator('#new-submit').click();
    await expect(dlg.locator('#new-kit-line')).toHaveText('It starts from the Realty — three pages: 3 pages and 14 sections, 9 photos, 4 services, 2 FAQs, the voice, the colors.');
    expect(t.writes[0].body).toEqual({ business_name: 'Oak Lane Realty', kit_id: 't1' });
  });

  const JUNIPER = site({ site_id: 's4', name: 'Juniper Floral Co.', state: 'not_live', state_words: 'Not live yet', address: 'https://juniper-floral.netlify.app', thumb: 'draft', published_at: null, no_owner: true,
    plan: { key: 'presence', words: 'Website + tools', status: 'active', term: '', renews: { kind: 'none', at: null } } });

  test('Invite the owner: the card and the ⋯ menu offer it, it says what happens, and the address goes to the server', async ({ page }) => {
    const t = await openSites(page, [BISTRO, JUNIPER]);
    const card = page.locator('.scard[data-site="s4"]');
    await expect(card.locator('.owner')).toContainText('No owner yet');
    await expect(card.locator('.owner')).toContainText('Nobody has been emailed.');
    await expect(page.locator('.scard[data-site="s1"] .owner')).toHaveCount(0);
    await card.locator('[data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).toHaveText(['Pin to top', 'Duplicate site', 'Save as a template', 'Invite the owner', 'Ask for their content', 'Hand-over kit', 'Open record', 'Move to trash']);
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Invite the owner' }).click();
    const dlg = page.locator('#invDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#invFor')).toHaveText('Juniper Floral Co. · the site stays exactly as it is.');
    await expect(dlg).toContainText('Inviting them publishes nothing.');
    await dlg.locator('#inv-submit').click();                      // no email yet → nothing sent
    expect(t.writes).toHaveLength(0);
    await dlg.locator('#inv-name').fill('June Park');
    await dlg.locator('#inv-email').fill('june@juniper.example');
    await dlg.locator('#inv-submit').click();
    const done = dlg.locator('#inv-done');
    await expect(done).toContainText('Invitation sent');
    await expect(done).toContainText('June Park will get an email at june@juniper.example with a sign-in link to their client portal.');
    await expect(done).toContainText('Juniper Floral Co. is now one of your customers.');
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /agency/sites/s4/invite']);
    expect(t.writes[0].body).toEqual({ email: 'june@juniper.example', name: 'June Park' });
    await done.locator('#inv-close').click();
    await expect(dlg).toBeHidden();
  });

  test('Invite the owner, refused: the reason is said and the box stays open to fix it', async ({ page }) => {
    await openSites(page, [JUNIPER], { inviteStatus: 409, invite: { error: 'account_exists', message: 'That email already has a Studio OS account, so it can’t be a new owner here. Use another address for this business.' } });
    await page.locator('.scard[data-site="s4"]').getByRole('button', { name: 'Invite the owner' }).click();
    const dlg = page.locator('#invDlg');
    await dlg.locator('#inv-email').fill('owner@bistro.example');
    await dlg.locator('#inv-submit').click();
    await expect(page.locator('.dds-toast', { hasText: 'That email already has a Studio OS account' })).toBeVisible();
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#inv-submit')).toBeEnabled();
    await expect(dlg.locator('#inv-submit')).toHaveText('Send invitation');
    await expect(dlg.locator('#inv-done')).toBeHidden();
  });

  test('⌘K’s "New site" (#new) opens the box, and the address forgets it', async ({ page }) => {
    await openSites(page, [BISTRO, JUNIPER], { path: '/sites.html#new' });
    await expect(page.locator('#newDlg')).toBeVisible();
    await expect(page).not.toHaveURL(/#new/);                      // Back or a reload never reopens it
    await page.keyboard.press('Escape');
    await expect(page.locator('#newDlg')).toBeHidden();
  });

  test('a seat that can’t make sites sees no + New site, and No owner yet without the button', async ({ page }) => {
    await openSites(page, [BISTRO, JUNIPER], { body: { can_create: false, can_duplicate: false } });
    await expect(page.locator('#newSiteBtn')).toHaveCount(0);
    const card = page.locator('.scard[data-site="s4"]');
    await expect(card.locator('.owner')).toContainText('No owner yet');
    await expect(card.locator('.owner button')).toHaveCount(0);
    await card.locator('[data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).not.toContainText(['Invite the owner']);
  });

  test('phone width: the New site and Invite boxes fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSites(page, [JUNIPER]);
    await page.getByRole('button', { name: '+ New site' }).click();
    const box = await page.locator('#newDlg').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    await page.keyboard.press('Escape');
    await page.locator('.scard[data-site="s4"]').getByRole('button', { name: 'Invite the owner' }).click();
    const inv = await page.locator('#invDlg').boundingBox();
    expect(inv && inv.x >= 0 && inv.x + inv.width <= 375).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a card: address, status, plan and renewal, domain renewal, who can edit, and the three doors into that client', async ({ page }) => {
    await openSites(page);
    const card = page.locator('.scard[data-site="s1"]');
    await expect(card.locator('.sname')).toHaveText('Bistro Nine');
    await expect(card.locator('.saddr a')).toHaveText('bistro.example');
    await expect(card.locator('.saddr a')).toHaveAttribute('target', '_blank');
    await expect(card.locator('.pill')).toHaveText('Live');
    await expect(card).toContainText('Website + tools · Monthly · Renews Dec 1');
    await expect(card).toContainText('Domain renews Nov 20');
    await expect(card).toContainText('Can edit: You + 1 in your studio · 1 on their side');
    await expect(card.locator('.sacts a')).toHaveText(['Website', 'Analytics', 'Settings']);
    await expect(card.locator('.sacts a').nth(0)).toHaveAttribute('href', '/presence.html?client=s1');
    await expect(card.locator('.sacts a').nth(1)).toHaveAttribute('href', '/analytics.html?client=s1');
    await expect(card.locator('.sacts a').nth(2)).toHaveAttribute('href', '/settings.html?client=s1');
    const garage = page.locator('.scard[data-site="s2"]');
    await expect(garage.locator('.pill')).toHaveText('Hosted elsewhere');
    await expect(garage).toContainText('Watch · No renewal date');
    await expect(garage.locator('.tfall')).toContainText('Lives on their own host');
    const cafe = page.locator('.scard[data-site="s3"]');
    await expect(cafe.locator('.pill')).toHaveText('Not live yet');
    await expect(cafe).toContainText('Trial ends Nov 15');
    await expect(cafe.locator('.saddr')).toContainText('No address yet');
  });

  test('live pictures: the home page drawn in a sandboxed frame, scripts off, never for a site we only watch', async ({ page }) => {
    const t = await openSites(page);
    const frame = page.locator('.scard[data-site="s1"] .thumb iframe');
    await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');   // no allow-scripts
    await expect(frame).toHaveAttribute('tabindex', '-1');
    await expect(page.frameLocator('.scard[data-site="s1"] .thumb iframe').locator('#thumb-mark')).toHaveText('Bistro Nine home page');
    await page.locator('.scard[data-site="s3"]').scrollIntoViewIfNeeded();   // below the fold on a phone or tablet until scrolled to
    await expect(page.frameLocator('.scard[data-site="s3"] .thumb iframe').locator('#thumb-mark')).toHaveText('Cafe Eleven home page');
    await expect(page.locator('.scard[data-site="s2"] .thumb iframe')).toHaveCount(0);
    expect(t.thumbs).not.toContain('s2');
    expect(t.thumbs.filter((id) => id === 's1')).toHaveLength(1);
  });

  test('live pictures stay cheap: only the cards near the screen, never more than two at a time, each once', async ({ page }) => {
    const many = Array.from({ length: 14 }, (_, i) => site({ site_id: `m${i}`, name: `Client ${String(i).padStart(2, '0')}`, address: `https://c${i}.example` }));
    const t = await openSites(page, many, { thumbDelay: 250 });
    await expect(page.locator('.scard')).toHaveCount(14);
    await page.waitForTimeout(900);
    expect(t.thumbs.length).toBeGreaterThan(0);
    expect(t.thumbs.length).toBeLessThan(14);                     // the cards far below are not asked for yet
    // a card jumped past is never asked for; scrolled through, each one is
    for (let i = 0; i < 14; i++) await page.locator('.scard').nth(i).scrollIntoViewIfNeeded();
    await expect.poll(() => new Set(t.thumbs).size, { timeout: 15_000 }).toBe(14);
    expect(t.maxInFlight()).toBeLessThanOrEqual(2);
    expect(t.thumbs.length).toBe(14);                             // each one once
  });

  test('search hides cards without drawing any picture again; nothing matches → an honest line', async ({ page }) => {
    const t = await openSites(page);
    await expect(page.frameLocator('.scard[data-site="s1"] .thumb iframe').locator('#thumb-mark')).toBeVisible();
    const asked = t.thumbs.length;
    await page.locator('#search').fill('bistro');
    await expect(page.locator('.scard:visible')).toHaveCount(1);
    await expect(page.locator('.lmeta')).toContainText('1 site ·');
    await page.locator('#search').fill('staff@bistro');               // who can edit is searchable
    await expect(page.locator('.scard:visible')).toHaveCount(1);
    await page.locator('#search').fill('restaurant');                 // so are tags
    await expect(page.locator('.scard:visible .sname')).toHaveText(['Bistro Nine']);
    await page.locator('#search').fill('zzz');
    await expect(page.locator('#noMatch')).toBeVisible();
    await page.locator('#search').fill('');
    await expect(page.locator('.scard:visible')).toHaveCount(3);
    await expect(page.frameLocator('.scard[data-site="s1"] .thumb iframe').locator('#thumb-mark')).toBeVisible();
    expect(t.thumbs.length).toBe(asked);
  });

  // items 129 and 180 (Nov 11): Health, Visits and Search clicks join the table, and Team and
  // Published leave it (who can edit stays on each card); sites-numbers.spec.ts covers the numbers
  test('table: Site · Health · Visits · Search clicks · Plan · Last updated · Tags, sortable, and the choice is remembered', async ({ page }) => {
    await openSites(page);
    await page.locator('#dispTable').click();
    const table = page.locator('#tableHost table');
    await expect(table.locator('thead .thb')).toHaveText(['Site', 'Health', 'Visits', 'Search clicks', 'Plan', 'Last updated', 'Tags']);
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('#grid')).toBeHidden();               // one view at a time: no cards above the table
    await expect(page.locator('.scard:visible')).toHaveCount(0);
    const bistro = table.locator('tbody tr', { hasText: 'Bistro Nine' });
    await expect(bistro).toContainText('Website + tools');
    await expect(bistro).toContainText('Oct 5');
    await expect(bistro.locator('.tagchip')).toHaveText('restaurant');
    await expect(table.locator('tbody tr', { hasText: 'Cafe Eleven' })).toContainText('Not live yet');
    await table.locator('[data-sort="name"]').click();
    await expect(table.locator('tbody tr td:first-child .n')).toHaveText(['Bistro Nine', 'Cafe Eleven', 'Garage Ten']);
    await expect(table.locator('th[aria-sort="ascending"]')).toHaveCount(1);
    await table.locator('[data-sort="name"]').click();
    await expect(table.locator('tbody tr td:first-child .n')).toHaveText(['Garage Ten', 'Cafe Eleven', 'Bistro Nine']);
    await page.reload();
    await expect(page.locator('#dispTable')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tableHost table')).toBeVisible();
    await expect(page.locator('#grid')).toBeHidden();               // …also when the page opens on the table
    await page.locator('#dispCards').click();
    await expect(page.locator('#tableHost')).toBeHidden();
    await expect(page.locator('.scard:visible')).toHaveCount(3);
  });

  test('Pin (item 45): the ⋯ menu pins a site to the top — saved, moved, marked', async ({ page }) => {
    const t = await openSites(page);
    await page.locator('.scard[data-site="s3"] [data-menu]').click();
    const menu = page.locator('#rowMenuHost [role="menu"]');
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['Pin to top', 'Duplicate site', 'Save as a template', 'Ask for their content', 'Hand-over kit', 'Open record', 'Move to trash']);   // item 176 adds Ask for their content and Hand-over kit
    await menu.getByRole('menuitem', { name: 'Pin to top' }).click();
    await expect.poll(() => t.writes.find((w) => w.path === '/agency/sites/s3/pin')?.body).toEqual({ pinned: true });
    await expect(page.locator('.scard[data-site="s3"] .tpin')).toHaveText('Pinned');
    await expect(page.locator('.scard[data-site="s3"]')).toHaveCSS('order', '0');
    await expect(page.locator('.scard[data-site="s1"]')).toHaveCSS('order', '1');
    await page.locator('.scard[data-site="s3"] [data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]').first()).toHaveText('Unpin');
    await page.keyboard.press('Escape');
    await expect(page.locator('#rowMenuHost [role="menu"]')).toHaveCount(0);
  });

  test('a watch plan has no Duplicate, and no studio site means no Pin', async ({ page }) => {
    await openSites(page, [BISTRO, GARAGE], { body: { can_pin: false } });
    await page.locator('.scard[data-site="s2"] [data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).toHaveText(['View live site', 'Ask for their content', 'Hand-over kit', 'Open record', 'Move to trash']);
  });

  test('a seat that can’t open a client (view only, designer…) gets the live site, never a door that says no', async ({ page }) => {
    await openSites(page, [BISTRO, CAFE], { body: { can_open: false, can_duplicate: false, can_trash: false } });
    const card = page.locator('.scard[data-site="s1"]');
    await expect(card.locator('.sacts a')).toHaveText(['View live site']);
    await expect(card.locator('.sacts a')).toHaveAttribute('href', 'https://bistro.example');
    await expect(card.locator('.sname a')).toHaveCount(0);
    await expect(page.locator('.scard[data-site="s3"] .sacts a')).toHaveCount(0);   // not live yet: nothing to view
    await card.locator('[data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).toHaveText(['Pin to top', 'View live site']);
    await page.keyboard.press('Escape');
    await page.locator('#dispTable').click();
    await expect(page.locator('#tableHost tr[data-row]')).toHaveCount(0);           // rows don't open a client either
  });

  test('Duplicate site (item 45): sets up the customer, then starts their site from this one — and says what came across', async ({ page }) => {
    const t = await openSites(page);
    await page.locator('.scard[data-site="s1"] [data-menu]').click();
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Duplicate site' }).click();
    const dlg = page.locator('#dupDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('h3')).toHaveText('Duplicate Bistro Nine');
    await dlg.locator('#dup-submit').click();                        // no business name yet → nothing sent
    expect(t.writes).toHaveLength(0);
    await dlg.locator('#dup-biz').fill('Bistro Twelve');
    await dlg.locator('#dup-name').fill('Sam Lee');
    await dlg.locator('#dup-email').fill('sam@bistrotwelve.example');
    await dlg.locator('#dup-submit').click();
    await expect(dlg.locator('#dup-done')).toContainText('Site duplicated');
    await expect(dlg.locator('#dup-done')).toContainText('the Business Classic look, 4 services, 2 FAQs, the voice, the colors');
    await expect(dlg.locator('#dup-done')).toContainText('Invitation sent to sam@bistrotwelve.example');
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /sales/customers', 'POST /agency/sites/s1/duplicate']);
    expect(t.writes[0].body).toMatchObject({ mode: 'provision', business_name: 'Bistro Twelve', name: 'Sam Lee', email: 'sam@bistrotwelve.example', edition: 'presence' });
    expect(t.writes[1].body).toEqual({ site_id: 'snew' });
    await dlg.locator('#dup-close').click();
    await expect(dlg).toBeHidden();
  });

  test('Needs you is Home’s own list, laid over the status — with a link to the thing itself', async ({ page }) => {
    await openSites(page, [BISTRO, CAFE], { needs: { s1: { what: 'bistro.example expires in 12 days', verb: 'Fix', href: '/presence.html?client=s1#domain', kind: 'broken' } } });
    const card = page.locator('.scard[data-site="s1"]');
    await expect(card.locator('.pill')).toHaveText('Needs you');
    await expect(card.locator('[data-why="s1"] a')).toHaveText('Needs you: bistro.example expires in 12 days');
    await expect(card.locator('[data-why="s1"] a')).toHaveAttribute('href', '/presence.html?client=s1#domain');
    await expect(page.locator('.scard[data-site="s3"] .pill')).toHaveText('Not live yet');
  });

  test('honest failure: a failed read is never "No client sites yet"; none at all offers + New site', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': studioContext } });
    await page.route(/\/functions\/v1\/presence\/agency\/sites$/, (route) => route.fulfill(json({ error: 'boom' }, 500)));
    await page.goto('/sites.html');
    await expect(page.getByText('We couldn’t load your sites just now.')).toBeVisible();
    await expect(page.getByText('No client sites yet.')).toHaveCount(0);
    await page.unroute(/\/functions\/v1\/presence\/agency\/sites$/);
    await page.route(/\/functions\/v1\/presence\/agency\/sites$/, (route) => route.fulfill(json(sitesBody([]))));
    await page.locator('#retry').click();
    await expect(page.getByText('No client sites yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Add a customer' })).toHaveCount(0);
    await page.getByRole('button', { name: '+ New site' }).nth(1).click();   // the one in the middle of the empty page
    await expect(page.locator('#newDlg')).toBeVisible();
  });

  // ── the command center (Nov 9 2026): the band, Needs you up top, and the filters ──
  const NEEDS_ROW = { key: 'broken:1', kind: 'broken', site_id: 's1', client_id: 'c1', name: 'Bistro Nine', what: 'bistro.example expires in 12 days', when: '', verb: 'Fix', href: '/presence.html?client=s1#domain' };
  const NEXT = { s1: { what: 'bistro.example expires in 12 days', verb: 'Fix', href: '/presence.html?client=s1#domain', kind: 'broken' } };

  test('the band counts what the server already knows across every site, and a number filters the cards', async ({ page }) => {
    await openSites(page, [BISTRO, GARAGE, CAFE], { needs: NEXT, needsRows: [NEEDS_ROW] });
    const band = page.locator('.sband');
    await expect(band).toContainText('3 sites you look after');
    await expect(band).toContainText('1 live · 1 needs you · all answering');
    await expect(band.locator('[data-filter="live"] .v')).toHaveText('1');
    await expect(band.locator('[data-filter="needs"] .v')).toHaveText('1');
    await expect(band.locator('[data-filter="changes"] .v')).toHaveText('0');       // Cafe's changes don't count: it was never published
    await expect(band.locator('[data-filter="domains"] .v')).toHaveText('1');       // bistro.example, within 30 days
    await expect(band.locator('[data-filter="domains"] .n')).toContainText('bistro.example in');
    await band.locator('[data-filter="live"]').click();
    await expect(band.locator('[data-filter="live"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.scard:visible')).toHaveCount(1);
    await expect(page.locator('.scard:visible .sname')).toHaveText('Bistro Nine');
    await expect(page.locator('#fpills [data-filter="live"]')).toHaveAttribute('aria-pressed', 'true');
    await band.locator('[data-filter="live"]').click();   // the same number again clears it
    await expect(page.locator('.scard:visible')).toHaveCount(3);
  });

  test('Needs you up top is Home’s own list for these sites, each with its verb; the pills filter, and nothing under one says so', async ({ page }) => {
    await openSites(page, [BISTRO, GARAGE, CAFE], { needs: NEXT, needsRows: [NEEDS_ROW, { ...NEEDS_ROW, key: 'other', site_id: 'zzz', name: 'Someone else' }] });
    const strip = page.locator('.nstrip');
    await expect(strip.locator('.task')).toHaveCount(1);     // only rows that belong to a site on this page
    await expect(strip.locator('.task .tn')).toHaveText('Bistro Nine');
    await expect(strip.locator('.task .tw')).toHaveText('bistro.example expires in 12 days');
    await expect(strip.locator('.task a')).toHaveText('Fix');
    await expect(strip.locator('.task a')).toHaveAttribute('href', '/presence.html?client=s1#domain');
    await expect(page.locator('.nhead a')).toHaveAttribute('href', '/agency.html');
    await page.locator('#fpills [data-filter="notlive"]').click();
    await expect(page.locator('.scard:visible .sname')).toHaveText('Cafe Eleven');
    await expect(page.locator('.scard:visible .launch')).toContainText('Not published yet');
    await page.locator('#search').fill('garage');
    await expect(page.locator('#noMatch')).toBeVisible();
    await expect(page.locator('#noMatch')).toContainText('No sites under “Not published” match that.');
    await page.locator('#noMatch [data-filter="all"]').click();
    await expect(page.locator('.scard:visible .sname')).toHaveText('Garage Ten');
    await expect(page.locator('#fpills [data-filter="all"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('like Squarespace’s dashboard, the name and the picture open the site’s own home; the status sits on the picture', async ({ page }) => {
    await openSites(page);
    const card = page.locator('.scard[data-site="s1"]');
    await expect(card.locator('.sname a')).toHaveAttribute('href', '/today.html?client=s1');
    await expect(card.locator('.thumb a.tlink')).toHaveAttribute('href', '/today.html?client=s1');
    await expect(card.locator('.thumb .pill')).toHaveText('Live');
    const w = await card.locator('.thumb .pill').evaluate((n) => n.getBoundingClientRect().width);
    expect(w).toBeLessThan(120);   // a chip, not a bar across the picture
    await expect(card.locator('.sst').nth(0)).toContainText('Plan');
    await expect(card.locator('.sst').nth(1)).toContainText('Domain renews Nov 20');
    await expect(page.locator('.scard[data-site="s3"] .sst').nth(1)).toContainText('None connected');
  });

  test('phone width: one column, nothing wider than the screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSites(page);
    await expect(page.locator('.scard')).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const xs = await page.locator('.scard').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
    await expect(page.locator('.sband .kpi')).toHaveCount(4);   // two by two on a phone
    const ks = await page.locator('.sband .kpi').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(ks).size).toBe(2);
  });

  // Nov 11 2026: on a phone the h1 gave its width up to the buttons beside it and "Sites"
  // was drawn over the Cards/Table switch. The letters spill out of a squeezed h1, so its
  // own box isn't enough: the words are measured too.
  test('phone width: the title and the Cards/Table switch never overlap', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSites(page);
    await expect(page.locator('.lhead .seg')).toBeVisible();
    const b = await page.evaluate(() => {
      const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      const h1 = document.getElementById('pagehead')!, words = document.createRange();
      words.selectNodeContents(h1);
      return { h1: box(h1.getBoundingClientRect()), words: box(words.getBoundingClientRect()), seg: box(document.querySelector('.lhead .seg')!.getBoundingClientRect()) };
    });
    const apart = (a: typeof b.seg, z: typeof b.seg) => a.right <= z.left || z.right <= a.left || a.bottom <= z.top || z.bottom <= a.top;
    expect(apart(b.h1, b.seg)).toBe(true);
    expect(apart(b.words, b.seg)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

// ── Item 154 (Nov 10 review: file 02 finding 6): a trash for sites, 90 days to restore ──
test.describe('Sites: the trash (item 154)', () => {
  const TRASHED = [
    { site_id: 's8', name: 'Ortiz Photography', trashed_at: '2026-11-10T12:00:00Z', trashed_by: 'owner@studio.example', was_live: true, goes_at: '2027-02-08T12:00:00Z', days_left: 90 },
    { site_id: 's9', name: 'Maple Street Bakery', trashed_at: '2026-10-02T12:00:00Z', trashed_by: 'owner@studio.example', was_live: false, goes_at: '2026-12-31T12:00:00Z', days_left: 9 },
  ];

  test('Move to trash asks first and says what happens — offline now, 90 days to restore, the domain stays theirs', async ({ page }) => {
    const t = await openSites(page);
    await page.locator('.scard[data-site="s1"] [data-menu]').click();
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Move to trash' }).click();
    const dlg = page.locator('#trashDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('h3')).toHaveText('Move Bistro Nine to the trash?');
    await expect(dlg.locator('li')).toHaveCount(4);
    await expect(dlg).toContainText('It goes offline now: visitors see a short “temporarily offline” page.');
    await expect(dlg).toContainText('For 90 days you can restore it from the Trash at the foot of this page.');
    await expect(dlg).toContainText('it’s deleted for good: its website comes down. If its owner signs in, they keep their sign-in, files and invoices.');
    await expect(dlg).toContainText('Its domain, bistro.example, isn’t cancelled.');
    await dlg.locator('#trash-cancel').click();                     // Cancel moves nothing
    await expect(dlg).toBeHidden();
    expect(t.writes).toHaveLength(0);
    await page.locator('.scard[data-site="s1"] [data-menu]').click();
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Move to trash' }).click();
    await dlg.locator('#trash-go').click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('.dds-toast', { hasText: 'Bistro Nine is in the trash and offline. Restore it from the foot of the page within 90 days.' })).toBeVisible();
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /agency/sites/s1/trash']);
  });

  test('a site that was never published has nothing to take down, and no domain line', async ({ page }) => {
    await openSites(page, [BISTRO, CAFE]);
    await page.locator('.scard[data-site="s3"] [data-menu]').click();
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Move to trash' }).click();
    const dlg = page.locator('#trashDlg');
    await expect(dlg).toContainText('Nothing is online to take down: it was never published.');
    await expect(dlg.locator('li')).toHaveCount(3);
  });

  test('the Trash at the foot of the page: newest first, the day each goes, and Restore', async ({ page }) => {
    const t = await openSites(page, [BISTRO], { body: { trash: TRASHED } });
    const trash = page.locator('section.trash');
    await expect(trash.locator('h2')).toHaveText('Trash');
    await expect(trash.locator('.count')).toHaveText('2');
    await expect(trash.locator('.trow')).toHaveCount(2);
    await expect(trash.locator('.trow').nth(0)).toContainText('Ortiz Photography');
    await expect(trash.locator('.trow').nth(0)).toContainText('Moved Nov 10 · offline since then');
    await expect(trash.locator('.trow').nth(0)).toContainText('Deleted for good Feb 8, 2027 · 90 days left');
    await expect(trash.locator('.trow').nth(1).locator('.soon')).toContainText('9 days left');   // soon is said in the warning colour
    await expect(page.locator('.scard[data-site="s8"]')).toHaveCount(0);                   // a trashed site has no card
    await trash.getByRole('button', { name: 'Restore Ortiz Photography' }).click();
    await expect(page.locator('.dds-toast', { hasText: 'Restored Ortiz Photography. It stays offline until you publish it or bring it back online.' })).toBeVisible();
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /agency/sites/s8/restore']);
  });

  test('a seat without the right sees the Trash but no Restore and no Move to trash; none trashed, no Trash at all', async ({ page }) => {
    await openSites(page, [BISTRO], { body: { trash: TRASHED, can_trash: false } });
    await expect(page.locator('section.trash .trow')).toHaveCount(2);
    await expect(page.locator('section.trash [data-restore]')).toHaveCount(0);
    await page.locator('.scard[data-site="s1"] [data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).not.toContainText(['Move to trash']);
  });

  test('phone width: the Trash fits, Restore is a full-size tap', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSites(page, [BISTRO], { body: { trash: TRASHED } });
    const row = page.locator('section.trash .trow').first();
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    const btn = await row.locator('[data-restore]').boundingBox();
    expect(btn && btn.height >= 44).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

// ── Item 145 (Nov 10 review: file 02 finding 3, file 03 finding 3): Duplicate brings the pages,
//    a site can be saved as "my template", and what was copied waits to be changed or kept ──
test.describe('Sites: the pages travel (item 145)', () => {
  const COPIED = site({ site_id: 's5', name: 'Bistro Twelve', state: 'not_live', state_words: 'Not live yet', address: 'https://bistro-twelve.netlify.app', thumb: 'draft', published_at: null, copied: { from: 'Bistro Nine', kept: false } });

  test('Duplicate says what came across — pages, sections, photos, the menu — and what to do before publishing', async ({ page }) => {
    const t = await openSites(page, [BISTRO, CAFE], { dupPages: { pages: 1, sections: 5, menu: 2, photos: 2, photos_failed: 0 } });
    await page.locator('.scard[data-site="s1"] [data-menu]').click();
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Duplicate site' }).click();
    const dlg = page.locator('#dupDlg');
    await expect(dlg).toContainText('this one’s pages and sections, with their words and photos, the menu and the look');
    await dlg.locator('#dup-biz').fill('Bistro Twelve');
    await dlg.locator('#dup-email').fill('sam@bistrotwelve.example');
    await dlg.locator('#dup-submit').click();
    const done = dlg.locator('#dup-done');
    await expect(done).toContainText('Bistro Twelve’s site starts with 1 page and 5 sections, 2 photos, the menu, the Business Classic look, 4 services, 2 FAQs, the voice, the colors.');
    await expect(done).toContainText('Before you publish, change what belongs to Bistro Nine, or keep it from the new site’s card.');
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /sales/customers', 'POST /agency/sites/s1/duplicate']);
  });

  test('a site started from another one says so until it is kept — two presses, then the box goes', async ({ page }) => {
    const t = await openSites(page, [BISTRO, COPIED]);
    const card = page.locator('.scard[data-site="s5"]');
    await expect(card.locator('.copied')).toContainText('Started from Bistro Nine’s pages');
    await expect(card.locator('.copied')).toContainText('Publishing lists what’s still as copied.');
    await expect(page.locator('.scard[data-site="s1"] .copied')).toHaveCount(0);
    const keep = card.getByRole('button', { name: 'Keep them as they are' });
    await keep.click();                                            // the first press only asks
    await expect(card.locator('[data-keep]')).toHaveText('Keep everything copied from Bistro Nine? Press again');
    expect(t.writes).toHaveLength(0);
    await card.locator('[data-keep]').click();
    await expect(card.locator('.copied')).toHaveCount(0);
    await expect(page.locator('.dds-toast', { hasText: 'Kept. Bistro Twelve can publish with what was copied.' })).toBeVisible();
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /agency/sites/s5/copied']);
    expect(t.writes[0].body).toEqual({ keep: true });
  });

  test('kept, live, or a seat without the right: no box, or no Keep button', async ({ page }) => {
    await openSites(page, [site({ ...COPIED, site_id: 's6', copied: { from: 'Bistro Nine', kept: true } }), site({ ...COPIED, site_id: 's7', state: 'live', state_words: 'Live', published_at: '2026-11-01T00:00:00Z', thumb: 'live' })]);
    await expect(page.locator('.copied')).toHaveCount(0);
  });

  test('Save as a template: from the ⋯ menu, a name, and what it keeps; the server is asked for its pages too', async ({ page }) => {
    const t = await openSites(page, [BISTRO, GARAGE]);
    await page.locator('.scard[data-site="s2"] [data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).not.toContainText(['Save as a template']);   // a site we only watch has no pages of ours
    await page.keyboard.press('Escape');
    await page.locator('.scard[data-site="s1"] [data-menu]').click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).toHaveText(['Pin to top', 'Duplicate site', 'Save as a template', 'View live site', 'Ask for their content', 'Hand-over kit', 'Open record', 'Move to trash']);
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Save as a template' }).click();
    const dlg = page.locator('#tplDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#tplFrom')).toHaveText('From Bistro Nine’s site.');
    await expect(dlg).toContainText('Never its business details, reviews or contacts.');
    await dlg.locator('#tpl-save').click();                        // no name yet → nothing sent
    expect(t.writes).toHaveLength(0);
    await dlg.locator('#tpl-name').fill('Bistro — three pages');
    await dlg.locator('#tpl-save').click();
    const done = dlg.locator('#tpl-done');
    await expect(done).toContainText('Saved “Bistro — three pages”');
    await expect(done).toContainText('1 page, 5 sections, 2 photos. Pick it under Start from when you make a new site.');
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /agency/kits']);
    expect(t.writes[0].body).toEqual({ site_id: 's1', name: 'Bistro — three pages', with_pages: true });
  });
});

// ── Domains (item 52) ──
const DOMAINS = { data: {
  domains: [
    { domain: 'gone.example', site_id: 's9', name: 'Gone Deli', own: false, status: 'expired', status_words: 'Expired 2 days ago', tone: 'bad', days_left: -2, provider: 'Registrar A', expires_at: '2026-11-06T00:00:00Z', checked_at: '2026-11-08T00:00:00Z', record: 'ok', padlock_until: null, checks: [], dns_host: '', lock: true, warnings: [] as Array<{ key: string; severity: string; words: string }>, registered_at: '2019-04-01T00:00:00Z', renews: 'unknown', renews_confirmed_at: null as string | null, hosted: true },
    { domain: 'bistro.example', site_id: 's1', name: 'Bistro Nine', own: false, status: 'expiring', status_words: 'Expires in 12 days', tone: 'warn', days_left: 12, provider: 'Registrar B', expires_at: '2026-11-20T00:00:00Z', checked_at: '2026-11-08T00:00:00Z', record: 'ok', padlock_until: '2027-01-15T00:00:00Z', checks: [], dns_host: 'Cloudflare', lock: false, warnings: [{ key: 'unlocked', severity: 'warn', words: 'The transfer lock is off: anyone with the account could move it away' }], registered_at: null, renews: 'unknown', renews_confirmed_at: null as string | null, hosted: true },
    { domain: 'garage.example', site_id: 's2', name: 'Garage Ten', own: false, status: 'elsewhere', status_words: 'On their own host', tone: 'quiet', days_left: null, provider: '', expires_at: null, checked_at: null, record: 'ok', padlock_until: null, checks: [], dns_host: '', lock: null, warnings: [] as Array<{ key: string; severity: string; words: string }>, registered_at: null, renews: 'unknown', renews_confirmed_at: null as string | null, hosted: false },
    { domain: 'mystudio.example', site_id: 'own', name: 'Bright Studio', own: true, status: 'connected', status_words: 'Connected', tone: 'good', days_left: 200, provider: 'Registrar C', expires_at: '2027-05-27T00:00:00Z', checked_at: '2026-11-08T00:00:00Z', record: 'ok', padlock_until: '2027-03-01T00:00:00Z', checks: [], dns_host: '', lock: true, warnings: [] as Array<{ key: string; severity: string; words: string }>, registered_at: null, renews: 'unknown', renews_confirmed_at: null as string | null, hosted: true },
  ],
  builtin: [{ address: 'presence-cccccccccccc.netlify.app', site_id: 's3', name: 'Cafe Eleven', own: false }],
}, partial: false };

test.describe('Domains (builder list item 52)', () => {
  test('every domain: status, provider, expiry — the urgent first — and the built-in addresses', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: { '/portal/context': studioContext, '/agency/domains': DOMAINS } });
    await page.goto('/domains.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Domains' })).toBeVisible();
    await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText('Domains');
    await expect(page.locator('.lmeta')).toContainText('4 domains · 2 expiring or expired');
    const rows = page.locator('table[aria-label="Domains"] tbody tr');
    await expect(rows.locator('td:first-child .dom')).toHaveText(['gone.example', 'bistro.example', 'garage.example', 'mystudio.example']);
    await expect(rows.nth(0).locator('.pill')).toHaveText('Expired 2 days ago');
    await expect(rows.nth(1)).toContainText('Registrar B');
    await expect(rows.nth(1)).toContainText('Nov 20, 2026');
    await expect(rows.nth(1)).toContainText('In 12 days');
    await expect(rows.nth(1).locator('button.dom')).toHaveAttribute('aria-label', 'Details for bistro.example');   // item 162: the name opens its panel, where the links live
    await expect(rows.nth(2)).toContainText('Not known yet');
    await expect(rows.nth(3).locator('.own')).toHaveText('Your studio');
    const builtin = page.locator('tr[data-builtin="s3"]');
    await expect(builtin).toContainText('presence-cccccccccccc.netlify.app');
    await expect(builtin.locator('.rowact')).toHaveText('Connect a domain');
    await expect(builtin.locator('.rowact')).toHaveAttribute('href', '/presence.html?client=s3#domain');
    expect(errors).toEqual([]);
  });

  test('sort by a column, search keeps the caret, and the Sites tab goes back', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': studioContext, '/agency/domains': DOMAINS } });
    await page.goto('/domains.html');
    await page.locator('[data-sort="domain"]').click();
    await expect(page.locator('table[aria-label="Domains"] tbody td:first-child .dom')).toHaveText(['bistro.example', 'garage.example', 'gone.example', 'mystudio.example']);
    await page.locator('#search').pressSequentially('registrar c');
    await expect(page.locator('table[aria-label="Domains"] tbody tr')).toHaveCount(1);
    await expect(page.locator('#search')).toBeFocused();
    await expect(page.locator('#search')).toHaveValue('registrar c');
    await expect(page.locator('.tabs a[href="/sites.html"]')).toHaveText('Sites');
  });

  test('no domains yet, a failed read, and a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installApp(page, { api: { '/portal/context': studioContext, '/agency/domains': { data: { domains: [], builtin: [] }, partial: false } } });
    await page.goto('/domains.html');
    await expect(page.getByText('No domains yet.', { exact: false })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.route(/\/functions\/v1\/presence\/agency\/domains/, (route) => route.fulfill(json({ error: 'boom' }, 500)));
    await page.reload();
    await expect(page.getByText('We couldn’t load your domains just now.')).toBeVisible();
  });
});

// ── Nov 10 review, bug hunt group A ──
test.describe('Sites: the bug hunt fixes (A1, A10)', () => {
  test('A1 — after Refresh, one click on a number or a pill turns its filter on, and one more turns it off', async ({ page }) => {
    await openSites(page);
    await expect(page.locator('.scard')).toHaveCount(3);
    await page.locator('#refreshBtn').click();                     // one reload: two listeners used to cancel each other out
    await expect(page.locator('.scard')).toHaveCount(3);
    const band = page.locator('.sband');
    await band.locator('[data-filter="live"]').click();
    await expect(band.locator('[data-filter="live"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.scard:visible')).toHaveCount(1);
    await page.locator('#fpills [data-filter="live"]').click();
    await expect(page.locator('.scard:visible')).toHaveCount(3);
  });

  test('A10 — a dropped connection while copying says they’re set up, and Try copying again copies without setting them up twice', async ({ page }) => {
    const t = await openSites(page);
    let drop = true;
    await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/duplicate$/, (route) => { if (drop) { drop = false; return route.abort('connectionreset'); } return route.fallback(); });
    await page.locator('.scard[data-site="s1"] [data-menu]').click();
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Duplicate site' }).click();
    const dlg = page.locator('#dupDlg');
    await dlg.locator('#dup-biz').fill('Bistro Twelve');
    await dlg.locator('#dup-email').fill('sam@bistrotwelve.example');
    await dlg.locator('#dup-submit').click();
    const done = dlg.locator('#dup-done');
    await expect(done).toContainText('Set up, but nothing was copied');
    await expect(done).toContainText('We lost the connection while copying the setup. Their account is ready.');
    await expect(done).not.toContainText('starter kit');
    await done.locator('#dup-again').click();
    await expect(done).toContainText('Site duplicated');
    await expect(done.locator('#dup-again')).toHaveCount(0);
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /sales/customers', 'POST /agency/sites/s1/duplicate']);   // the customer once; the copy that got through once
  });
});

// ── Nov 10 review, builder list items 132 and 134: the Domains page tells the truth ──
test.describe('Domains: the padlock and an unreadable record (items 132, 134)', () => {
  test('a Padlock until column, a stuck padlock in the status, and "couldn’t read this domain’s record" instead of "Not known yet"', async ({ page }) => {
    const data = JSON.parse(JSON.stringify(DOMAINS)) as typeof DOMAINS;
    data.data.domains.push({ domain: 'www.oldhost.example', site_id: 's7', name: 'Old Host Bakery', own: false, status: 'padlock', status_words: 'Padlock not on yet', tone: 'warn', days_left: null, provider: '', expires_at: null, checked_at: '2026-11-08T00:00:00Z', record: 'unreadable', padlock_until: null, checks: [], hosted: true } as never);
    await installApp(page, { api: { '/portal/context': studioContext, '/agency/domains': data } });
    await page.goto('/domains.html');
    const table = page.locator('table[aria-label="Domains"]');
    await expect(table.locator('thead th')).toHaveText(['Domain', 'Site', 'Status', 'Provider', 'Expires', 'Padlock until', 'Last checked'].map((t) => new RegExp('^' + t)));
    const row = (d: string) => table.locator(`tbody tr[data-domain="${d}"]`);
    await expect(row('bistro.example').locator('td').nth(5)).toContainText('Jan 15, 2027');
    await expect(row('garage.example').locator('td').nth(5)).toHaveText('Their host’s');
    await expect(row('www.oldhost.example').locator('.pill')).toHaveText('Padlock not on yet');
    await expect(row('www.oldhost.example').locator('td').nth(3)).toHaveText('Couldn’t read it');
    await expect(row('www.oldhost.example').locator('td').nth(4)).toContainText('Couldn’t read this domain’s record');
    await expect(page.locator('.how')).toContainText('at 30, 15, 7 and 1 days and the day after it expires');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

// ── Nov 10 review, builder list item 134 (second half): "Connected" means it shows our site ──
test.describe('Domains: what the domain really shows (item 134)', () => {
  test('an old copy reads as such, and what still needs doing sits under the status', async ({ page }) => {
    const data = JSON.parse(JSON.stringify(DOMAINS)) as typeof DOMAINS;
    data.data.domains.unshift({ domain: 'www.harbor.example', site_id: 's8', name: 'Harbor Dental', own: false, status: 'old_copy', status_words: 'Showing an old copy', tone: 'bad', days_left: 200, provider: 'Registrar D', expires_at: '2027-05-27T00:00:00Z', checked_at: '2026-11-10T00:00:00Z', record: 'ok', padlock_until: '2027-02-01T00:00:00Z',
      checks: [{ ok: true, words: 'www.harbor.example points here' }, { ok: false, words: 'harbor.example doesn’t point here yet' }, { ok: false, words: 'Showing an old copy of the site (another hosting project or a cache is answering)' }], hosted: true } as never);
    await installApp(page, { api: { '/portal/context': studioContext, '/agency/domains': data } });
    await page.goto('/domains.html');
    const row = page.locator('table[aria-label="Domains"] tbody tr[data-domain="www.harbor.example"]');
    await expect(row.locator('.pill')).toHaveText('Showing an old copy');
    await expect(row.locator('td').nth(2).locator('.sub')).toContainText('harbor.example doesn’t point here yet');
    await expect(row.locator('td').nth(2).locator('.sub')).toContainText('Showing an old copy of the site');
    await expect(row.locator('td').nth(2).locator('.sub')).not.toContainText('points here yet points here');   // only what isn't fine
  });
});

// ── Nov 10 review, builder list item 162: the Domains page does things ──
const DETAIL_RECORDS = [
  ['bistro.example', 'A', '75.2.60.5'], ['bistro.example', 'MX', '10 mx1.mail.example'], ['bistro.example', 'MX', '20 mx2.mail.example'],
  ['bistro.example', 'TXT', 'v=spf1 include:mail.example ~all'], ['bistro.example', 'TXT', 'google-site-verification=AbC123'], ['bistro.example', 'TXT', 'facebook-domain-verification=xyz'],
  ['www.bistro.example', 'CNAME', 'presence-bistro.netlify.app'], ['www.bistro.example', 'TXT', 'old-host-verify=1'],
].map(([name, type, value]) => ({ name, type, value }));
const detailOf = (over: Record<string, unknown> = {}) => ({ data: {
  ...DOMAINS.data.domains[1], dns_host_full: 'Cloudflare', statuses: ['active'], records: DETAIL_RECORDS,
  all_checks: [{ key: 'points:bistro.example', ok: true, words: 'bistro.example points here' }, { key: 'points:www.bistro.example', ok: false, words: 'www.bistro.example doesn’t point here yet' }],
  notes: { account: '', renews: 'unknown', renews_confirmed_at: null, note: '', updated_by: null, updated_at: null }, ...over } });
async function openDomains(page: Page, opts: { check?: { status: number; body: unknown }; detail?: (siteId: string) => unknown } = {}) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  await installApp(page, { api: { '/portal/context': studioContext, '/agency/domains': DOMAINS } });
  await page.route(/\/functions\/v1\/presence\/agency\/domains\/[^/]+(\/(notes|check))?$/, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    const method = route.request().method();
    if (method === 'GET') return route.fulfill(json(opts.detail ? opts.detail(path.split('/')[3]) : detailOf()));
    writes.push({ method, path, body: route.request().postDataJSON() });
    if (path.endsWith('/notes')) return route.fulfill(json({ data: { ...route.request().postDataJSON(), updated_by: 'owner@studio.example', updated_at: new Date().toISOString() } }));
    const c = opts.check || { status: 200, body: detailOf({ status: 'connected', status_words: 'Connected', tone: 'good', checked_at: new Date().toISOString(), all_checks: [{ key: 'points:bistro.example', ok: true, words: 'bistro.example points here' }, { key: 'points:www.bistro.example', ok: true, words: 'www.bistro.example points here' }] }) };
    return route.fulfill(json(c.body, c.status));
  });
  await page.goto('/domains.html');
  await expect(page.locator('table[aria-label="Domains"] tbody tr')).toHaveCount(4);
  return { writes };
}

test.describe('Domains: the page does things (item 162)', () => {
  test('quick filters with counts: needs attention, expiring, waiting on records, no domain yet', async ({ page }) => {
    await openDomains(page);
    const chips = page.locator('.chips .chip');
    await expect(chips).toHaveText(['All', 'Needs attention2', 'Expiring2', 'Waiting on records0', 'No domain yet1']);
    const rows = page.locator('table[aria-label="Domains"] tbody td:first-child .dom');
    await page.locator('[data-filter="attention"]').click();
    await expect(page.locator('[data-filter="attention"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveText(['gone.example', 'bistro.example']);
    await expect(page.locator('tr[data-builtin]')).toHaveCount(0);
    await page.locator('[data-filter="attention"]').click();                    // again: back to all
    await expect(rows).toHaveCount(4);
    await expect(page.locator('tr[data-builtin="s3"]')).toBeVisible();
    await page.locator('[data-filter="nodomain"]').click();
    await expect(page.locator('table[aria-label="Domains"]')).toHaveCount(0);
    await expect(page.locator('tr[data-builtin="s3"]')).toBeVisible();
    await page.locator('[data-filter="waiting"]').click();
    await expect(page.getByText('Nothing under “Waiting on records”.')).toBeVisible();
  });

  test('each row says who runs the DNS, a lock that’s off, what the registry’s words mean, and when it was last checked', async ({ page }) => {
    await openDomains(page);
    const row = (d: string) => page.locator(`table[aria-label="Domains"] tbody tr[data-domain="${d}"]`);
    await expect(row('bistro.example').locator('td').nth(3)).toContainText('DNS at Cloudflare');
    await expect(row('bistro.example').locator('td').nth(3)).toContainText('Lock: off');
    await expect(row('bistro.example').locator('td').nth(2)).not.toContainText('transfer lock');   // said once, in Provider; the sentence is in the panel
    await expect(row('gone.example').locator('td').nth(3)).not.toContainText('Lock');
    await expect(row('garage.example').locator('td').nth(6)).toHaveText('Not yet');
    await expect(row('gone.example').locator('td').nth(6)).toHaveText(/ago$|^Just now$/);
  });

  test('Details: the whole story in a side panel, every record, notes that save, and Check now', async ({ page }) => {
    const t = await openDomains(page);
    const opener = page.locator('tr[data-domain="bistro.example"] [data-detail]');
    await opener.click();
    const dlg = page.locator('#dpanel');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#dpTitle')).toHaveText('bistro.example');
    await expect(dlg.locator('.dp-list li')).toHaveText(['bistro.example points here', 'www.bistro.example doesn’t point here yet', 'The transfer lock is off: anyone with the account could move it away']);
    await expect(dlg.locator('.dp-list li.warn')).toHaveText('The transfer lock is off: anyone with the account could move it away');   // a door left open, not trouble
    await expect(dlg.getByRole('link', { name: 'Open the client’s domain steps' })).toHaveAttribute('href', '/presence.html?client=s1#domain');
    await expect(dlg.getByRole('link', { name: 'Open Bistro Nine' })).toHaveAttribute('href', '/presence.html?client=s1');
    await expect(dlg.getByRole('link', { name: 'Visit bistro.example ↗' })).toHaveAttribute('href', 'https://bistro.example');
    const kv = async (k: string) => dlg.locator('dt', { hasText: new RegExp('^' + k + '$') }).locator('xpath=following-sibling::dd[1]');
    await expect(await kv('Records')).toHaveText('Cloudflare');                        // part two names where and how; without it, the DNS company
    await expect(await kv('Transfer lock')).toHaveText('Off');
    await expect(await kv('Registry says')).toHaveText('active');
    await expect(dlg.locator('table.dp-rec tbody tr')).toHaveCount(8);                 // the client's card stops at six; this lists them all
    await expect(dlg.locator('table.dp-rec')).toContainText('google-site-verification=AbC123');
    await dlg.locator('#dpAcct').fill('The client’s own account');
    await dlg.locator('#dpRenew').selectOption('yes');
    await dlg.locator('#dpConf').fill('2026-11-11');
    await dlg.locator('#dpNote').fill('Card on file ends 2027');
    await dlg.getByRole('button', { name: 'Save notes' }).click();
    await expect(dlg.locator('#dpSaved')).toHaveText('Saved.');
    expect(t.writes[0]).toEqual({ method: 'PUT', path: '/agency/domains/s1/notes', body: { account: 'The client’s own account', renews: 'yes', renews_confirmed_at: '2026-11-11', note: 'Card on file ends 2027' } });
    await dlg.locator('#dpCheck').click();
    await expect(dlg.locator('#dpMsg')).toHaveText('Checked just now.');
    await expect(dlg.locator('.dp-h .pill')).toHaveText('Connected');
    await expect(dlg.locator('.dp-list li.todo')).toHaveCount(0);                       // www. points here now
    await expect(dlg.locator('.dp-list li.warn')).toHaveCount(1);                       // only the open lock is left
    await expect(page.locator('tr[data-domain="bistro.example"] .pill')).toHaveText('Connected');   // the list behind it moved too
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['PUT /agency/domains/s1/notes', 'POST /agency/domains/s1/check']);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(page.locator('tr[data-domain="bistro.example"] [data-detail]')).toBeFocused();
  });

  test('Check now inside a minute says so in the panel, and the button comes back', async ({ page }) => {
    await openDomains(page, { check: { status: 429, body: { error: 'too_soon', message: 'Checked a moment ago. Give it a minute before checking again.' } } });
    await page.locator('tr[data-domain="bistro.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    await dlg.locator('#dpCheck').click();
    await expect(dlg.locator('#dpMsg')).toHaveText('Checked a moment ago. Give it a minute before checking again.');
    await expect(dlg.locator('#dpCheck')).toBeEnabled();
    await expect(dlg.locator('#dpCheck')).toHaveText('Check now');
  });

  test('Download gives the list as a spreadsheet, in its order', async ({ page }) => {
    await openDomains(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dlBtn').click()]);
    expect(dl.suggestedFilename()).toBe('domains.csv');
    const text = await new Promise<string>(async (resolve, reject) => { const s = await dl.createReadStream(); let b = ''; s.on('data', (c) => { b += c; }); s.on('end', () => resolve(b)); s.on('error', reject); });
    const lines = text.split('\n');
    expect(lines[0]).toBe('"Domain","Site","Status","Provider","DNS at","Expires","Renews by itself","Lock","Padlock until","Last checked"');   // Renews by itself: item 174
    expect(lines[2]).toBe('"bistro.example","Bistro Nine","Expires in 12 days","Registrar B","Cloudflare","2026-11-20","","off","2027-01-15","2026-11-08"');   // nobody has said whether it renews by itself yet
    expect(lines).toHaveLength(5);
  });

  test('on a phone: the panel fits, nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openDomains(page);
    await page.locator('tr[data-domain="bistro.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    await expect(dlg.locator('table.dp-rec tbody tr')).toHaveCount(8);
    const fits = await page.evaluate(() => { const d = document.getElementById('dpanel')!; const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 0.5 && d.scrollWidth <= d.clientWidth + 1; });
    expect(fits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

// ── Nov 10 review, builder list item 162, part two: where to go, the ready-made guides, mail and history ──
const WHERE = { registrar: 'Registrar B', dns_host: 'Cloudflare', records_at: { company: 'Cloudflare', sign_in: 'https://dash.cloudflare.com/', path: 'your domain, then DNS, then Records' }, renew_at: { company: 'Registrar B', sign_in: '', path: '' } };
const PART2 = {
  where: WHERE,
  mail: { has_mail: true, spf: true, dmarc: false, words: 'Email runs here but isn’t fully protected: no DMARC record.' },
  history: [{ at: '2026-10-19T12:00:00Z', words: '30-day reminder sent to the client and you' }, { at: '2026-10-01T12:00:00Z', words: 'Attached domain bistro.example, by your studio' }],
};
const RENEW_PLAN = { kind: 'registrar_care', title: 'Keep bistro.example safely yours', summary: 'Auto-renew and privacy are the two switches that prevent the two common domain disasters.',
  steps: [{ what: 'Sign in to Registrar B and turn on auto-renew for bistro.example.', automated: false }, { what: 'The platform keeps watching the expiration date', automated: true }], preview: true };
/** POST /foundations/prepare (routes/foundations.ts): what was asked, and inside whose site. */
async function trackPrepare(page: Page, reply?: (body: any) => { status: number; body: unknown }) {
  const calls: Array<{ body: any; scope: string }> = [];
  await page.route(/\/functions\/v1\/presence\/foundations\/prepare$/, async (route: Route) => {
    const body = route.request().postDataJSON();
    calls.push({ body, scope: route.request().headers()['x-dds-scope-site'] || '' });
    const r = reply ? reply(body) : { status: 200, body: { data: body.preview ? RENEW_PLAN : { ...RENEW_PLAN, preview: undefined, id: 'plan1', status: 'proposed' } } };
    return route.fulfill(json(r.body, r.status));
  });
  return calls;
}

test.describe('Domains panel, part two: where to go, the guides, mail and history (item 162)', () => {
  test('Registration says where records are edited and where renewal lives, with sign-in links; then mail and history', async ({ page }) => {
    await openDomains(page, { detail: () => detailOf(PART2) });
    await page.locator('tr[data-domain="bistro.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    const kv = (k: string) => dlg.locator('dt', { hasText: new RegExp('^' + k + '$') }).locator('xpath=following-sibling::dd[1]');
    await expect(kv('Records')).toHaveText('At Cloudflare: your domain, then DNS, then Records. Sign in to Cloudflare ↗');
    await expect(kv('Records').getByRole('link', { name: 'Sign in to Cloudflare ↗' })).toHaveAttribute('href', 'https://dash.cloudflare.com/');
    await expect(kv('Records').getByRole('link')).toHaveAttribute('target', '_blank');
    await expect(kv('Renewal')).toHaveText('At Registrar B.');                         // a seller we have no guide for: named, no made-up link
    await expect(kv('Renewal').getByRole('link')).toHaveCount(0);
    await expect(dlg.locator('#dpMail')).toHaveText('Email runs here but isn’t fully protected: no DMARC record.');
    await expect(dlg.locator('.dp-hist li')).toHaveText([/30-day reminder sent to the client and you$/, /Attached domain bistro\.example, by your studio$/]);
    await expect(dlg.locator('.dp-hist li').first().locator('.when')).toHaveText('Oct 19, 2026');
  });

  test('Help: the steps are read first, inside the client’s site, then put on the client’s page for their OK', async ({ page }) => {
    await openDomains(page, { detail: () => detailOf(PART2) });
    const calls = await trackPrepare(page);
    await page.locator('tr[data-domain="bistro.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    await expect(dlg.locator('[data-help]')).toHaveText(['Make sure it renews by itself', 'The records this site needs', 'Gmail on this domain', 'Move the domain']);   // Gmail: item 174
    await dlg.getByRole('button', { name: 'Make sure it renews by itself' }).click();
    await expect(dlg.locator('.dp-plan .dp-ptitle')).toHaveText('Keep bistro.example safely yours');
    await expect(dlg.locator('.dp-steps li')).toHaveText(['Sign in to Registrar B and turn on auto-renew for bistro.example.', 'Handled automatically: The platform keeps watching the expiration date']);
    await expect(dlg.getByRole('button', { name: 'Make sure it renews by itself' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls).toEqual([{ body: { goal: 'registrar_care', preview: true }, scope: 's1' }]);   // a preview saves nothing
    await dlg.getByRole('button', { name: 'Put it on the client’s page' }).click();
    await expect(dlg.locator('#dpSent')).toHaveText('Done. It’s on their Domain & email page, waiting for their OK.');
    expect(calls[1]).toEqual({ body: { goal: 'registrar_care' }, scope: 's1' });
  });

  test('the studio’s own domain: no client in between, and it says your page', async ({ page }) => {
    await openDomains(page, { detail: () => detailOf({ ...DOMAINS.data.domains[3], ...PART2 }) });
    const calls = await trackPrepare(page);
    await page.locator('tr[data-domain="mystudio.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    await dlg.getByRole('button', { name: 'Make sure it renews by itself' }).click();
    await dlg.getByRole('button', { name: 'Put it on your Domain & email page' }).click();
    await expect(dlg.locator('#dpSent')).toHaveText('Done. It’s on your Domain & email page.');
    expect(calls.map((c) => c.scope)).toEqual(['', '']);
  });

  test('a site on its own host has no “records this site needs”, and a refusal is said in the panel', async ({ page }) => {
    await openDomains(page, { detail: () => detailOf({ ...DOMAINS.data.domains[2], ...PART2 }) });
    const calls = await trackPrepare(page, () => ({ status: 400, body: { error: 'no_domain', message: 'Domain care needs a domain first.' } }));
    await page.locator('tr[data-domain="garage.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    await expect(dlg.locator('[data-help]')).toHaveText(['Make sure it renews by itself', 'Gmail on this domain', 'Move the domain']);
    await dlg.getByRole('button', { name: 'Move the domain' }).click();
    await expect(dlg.locator('#dpHelpOut')).toHaveText('Domain care needs a domain first.');
    expect(calls).toEqual([{ body: { goal: 'transfer_out', preview: true }, scope: 's2' }]);
  });

  test('on a phone: the guide’s steps fit, nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openDomains(page, { detail: () => detailOf(PART2) });
    await trackPrepare(page);
    await page.locator('tr[data-domain="bistro.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    await dlg.getByRole('button', { name: 'Make sure it renews by itself' }).click();
    await expect(dlg.locator('.dp-plan')).toBeVisible();
    expect(await page.evaluate(() => { const d = document.getElementById('dpanel')!; return d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth; })).toBe(true);
  });
});

// ── Nov 10 review, builder list item 174: borrowed from Namecheap and Squarespace ──
test.describe('Domains: borrowed from Namecheap and Squarespace (item 174)', () => {
  test('each row says whether it renews by itself, and its switch saves it to the domain’s notes', async ({ page }) => {
    const t = await openDomains(page);
    const sel = page.locator('tr[data-domain="bistro.example"] select[data-renews]');
    await expect(sel).toHaveValue('unknown');
    await sel.selectOption('yes');
    await expect.poll(() => t.writes.length).toBe(1);
    expect(t.writes[0].method).toBe('PUT');
    expect(t.writes[0].path).toBe('/agency/domains/s1/notes');
    expect(t.writes[0].body.renews).toBe('yes');
    expect(t.writes[0].body.renews_confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('[data-renews-conf="s1"]')).toHaveText(/^confirmed [A-Z][a-z]{2} \d+, \d{4}$/);
  });

  test('a refused save puts the switch back and says so', async ({ page }) => {
    await openDomains(page);
    await page.route(/\/functions\/v1\/presence\/agency\/domains\/s1\/notes$/, (route: Route) => route.fulfill(json({ error: 'forbidden', message: 'Your role can’t change that.' }, 403)));
    const sel = page.locator('tr[data-domain="bistro.example"] select[data-renews]');
    await sel.selectOption('no');
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'Your role can’t change that.' })).toBeVisible();
    await expect(sel).toHaveValue('unknown');
  });

  test('the panel offers Gmail’s records in one pick, and names the other domains that send visitors here', async ({ page }) => {
    await openDomains(page, { detail: () => detailOf({ ...PART2, forwards: ['old.example', 'www.old.example'] }) });
    const calls = await trackPrepare(page);
    await page.locator('tr[data-domain="bistro.example"] [data-detail]').click();
    const dlg = page.locator('#dpanel');
    const kv = (k: string) => dlg.locator('dt', { hasText: new RegExp('^' + k + '$') }).locator('xpath=following-sibling::dd[1]');
    await expect(kv('Also sends visitors here')).toHaveText('old.example, www.old.example');
    await dlg.getByRole('button', { name: 'Gmail on this domain' }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({ body: { goal: 'email_setup', provider: 'google_workspace', preview: true }, scope: 's1' });
  });
});
