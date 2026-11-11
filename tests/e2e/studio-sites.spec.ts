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
  unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: 'live',
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
const sitesBody = (rows: unknown[], over: Record<string, unknown> = {}) => ({ data: rows, partial: false, can_open: true, can_pin: true, can_duplicate: true, ...over });

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
async function openSites(page: Page, rows: unknown[] = [BISTRO, GARAGE, CAFE], opts: { body?: Record<string, unknown>; thumbDelay?: number; needs?: Record<string, unknown>; needsRows?: unknown[] } = {}) {
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
  await page.route(/\/functions\/v1\/presence\/(agency\/sites\/[^/]+\/(pin|duplicate)|sales\/customers)/, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    const body = route.request().postDataJSON();
    writes.push({ method: route.request().method(), path, body });
    if (path.endsWith('/pin')) return route.fulfill(json({ data: { site_id: path.split('/')[3], pinned: body.pinned, pins: body.pinned ? [path.split('/')[3]] : [] } }));
    if (path === '/sales/customers') return route.fulfill(json({ data: { created: true, client_id: 'c-new', site_id: 'snew', invited: true } }, 201));
    return route.fulfill(json({ data: { site_id: 'snew', from_site_id: path.split('/')[3], look: 'Business Classic', applied: { offerings: 4, faqs: 2, voice: true, colors: true, industry: 'restaurant' }, skipped: [] } }));
  });
  await page.goto('/sites.html');
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

  // Nov 9 2026: like Squarespace's account dashboard, the list of sites is where a new one
  // starts. Every site belongs to a client, so "+ New site" opens Home's Add a customer,
  // which says it emails them a sign-in link before anything is sent.
  test('+ New site, at the top of the page, opens Add a customer', async ({ page }) => {
    await openSites(page);
    const btn = page.getByRole('link', { name: '+ New site' });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', '/agency.html#add');
    await btn.click();
    await expect(page).toHaveURL(/\/agency\.html/);             // Home opens the dialog, then tidies #add from the address
    await expect(page.locator('#custDlg')).toBeVisible();
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

  test('table: Name · Team · Plan · Published · Last updated · Tags, sortable, and the choice is remembered', async ({ page }) => {
    await openSites(page);
    await page.locator('#dispTable').click();
    const table = page.locator('#tableHost table');
    await expect(table.locator('thead .thb')).toHaveText(['Name', 'Team', 'Plan', 'Published', 'Last updated', 'Tags']);
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('#grid')).toBeHidden();               // one view at a time: no cards above the table
    await expect(page.locator('.scard:visible')).toHaveCount(0);
    const bistro = table.locator('tbody tr', { hasText: 'Bistro Nine' });
    await expect(bistro.locator('.av')).toHaveCount(3);
    await expect(bistro).toContainText('Website + tools');
    await expect(bistro).toContainText('Oct 1');
    await expect(bistro.locator('.tagchip')).toHaveText('restaurant');
    await expect(table.locator('tbody tr', { hasText: 'Cafe Eleven' })).toContainText('Not yet');
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
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['Pin to top', 'Duplicate site', 'Open record']);
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
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).toHaveText(['View live site', 'Open record']);
  });

  test('a seat that can’t open a client (view only, designer…) gets the live site, never a door that says no', async ({ page }) => {
    await openSites(page, [BISTRO, CAFE], { body: { can_open: false, can_duplicate: false } });
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

  test('honest failure: a failed read is never "No client sites yet"; none at all offers Add a customer', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': studioContext } });
    await page.route(/\/functions\/v1\/presence\/agency\/sites$/, (route) => route.fulfill(json({ error: 'boom' }, 500)));
    await page.goto('/sites.html');
    await expect(page.getByText('We couldn’t load your sites just now.')).toBeVisible();
    await expect(page.getByText('No client sites yet.')).toHaveCount(0);
    await page.unroute(/\/functions\/v1\/presence\/agency\/sites$/);
    await page.route(/\/functions\/v1\/presence\/agency\/sites$/, (route) => route.fulfill(json(sitesBody([]))));
    await page.locator('#retry').click();
    await expect(page.getByText('No client sites yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Add a customer' })).toHaveAttribute('href', '/agency.html#add');
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
});

// ── Domains (item 52) ──
const DOMAINS = { data: {
  domains: [
    { domain: 'gone.example', site_id: 's9', name: 'Gone Deli', own: false, status: 'expired', status_words: 'Expired 2 days ago', tone: 'bad', days_left: -2, provider: 'Registrar A', expires_at: '2026-11-06T00:00:00Z', checked_at: '2026-11-08T00:00:00Z', hosted: true },
    { domain: 'bistro.example', site_id: 's1', name: 'Bistro Nine', own: false, status: 'expiring', status_words: 'Expires in 12 days', tone: 'warn', days_left: 12, provider: 'Registrar B', expires_at: '2026-11-20T00:00:00Z', checked_at: '2026-11-08T00:00:00Z', hosted: true },
    { domain: 'garage.example', site_id: 's2', name: 'Garage Ten', own: false, status: 'elsewhere', status_words: 'On their own host', tone: 'quiet', days_left: null, provider: '', expires_at: null, checked_at: null, hosted: false },
    { domain: 'mystudio.example', site_id: 'own', name: 'Bright Studio', own: true, status: 'connected', status_words: 'Connected', tone: 'good', days_left: 200, provider: 'Registrar C', expires_at: '2027-05-27T00:00:00Z', checked_at: '2026-11-08T00:00:00Z', hosted: true },
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
    await expect(rows.nth(1).locator('.rowact')).toHaveAttribute('href', '/presence.html?client=s1#domain');
    await expect(rows.nth(2)).toContainText('Not known yet');
    await expect(rows.nth(2).locator('.rowact')).toHaveText('Open site');
    await expect(rows.nth(3).locator('.own')).toHaveText('Your studio');
    await expect(rows.nth(3).locator('.rowact')).toHaveAttribute('href', '/presence.html#domain');
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
