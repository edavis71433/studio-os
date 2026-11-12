import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 176 (Nov 2026): folders, tags and saved views on Sites, borrowed from
// Wix Studio's Sites list. The fixtures match the REAL shapes: GET /agency/sites/organize and
// its writes in supabase/functions/presence/agency/site_folders.ts (folders f-xxxxxxxx, views
// v-xxxxxxxx, sites by UUID), and PATCH /agency/clients/:id for one site's tags.
// tests/presence/site_folders_test.mjs checks those shapes against the server.

const ID = {
  bistro: '0b1c0000-0000-4000-8000-000000000001', taco: '0b1c0000-0000-4000-8000-000000000002',
  garage: '0b1c0000-0000-4000-8000-000000000003', cafe: '0b1c0000-0000-4000-8000-000000000004',
};
const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live',
  address: '', domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
  tags: [] as string[], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
  unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: 'live', copied: null, no_owner: false,
  owner: null, transfer: null,
  ...over,
});
// opened most recently first, so the order on screen is the order here
const BISTRO = site({ site_id: ID.bistro, name: 'Bistro Nine', address: 'https://bistro.example', domain: 'bistro.example', tags: ['restaurant', 'downtown'], opened_at: '2026-11-09T09:00:00Z' });
const TACO = site({ site_id: ID.taco, name: 'Taco Twelve', address: 'https://taco.example', domain: 'taco.example', tags: ['restaurant'], opened_at: '2026-11-08T09:00:00Z' });
const GARAGE = site({ site_id: ID.garage, name: 'Garage Ten', edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', address: 'https://garage.example', domain: 'garage.example', opened_at: '2026-11-07T09:00:00Z' });
const CAFE = site({ site_id: ID.cafe, name: 'Cafe Eleven', state: 'not_live', state_words: 'Not live yet', thumb: 'draft', published_at: null, tags: ['downtown'], opened_at: '2026-11-06T09:00:00Z' });
const FOLDERS = () => [
  { id: 'f-rest0001', name: 'Restaurants', color: 'amber', sites: [ID.bistro, ID.taco] },
  { id: 'f-tria0001', name: 'Trials', color: 'teal', sites: [ID.cafe] },
];
const VIEWS = () => [{ id: 'v-down0001', name: 'Downtown, table', folder: '', tag: 'downtown', filter: 'all', q: '', sort: null, display: 'table' }];

const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [
  { key: 'sites', label: 'Sites', href: '/sites.html' }, { key: 'domains', label: 'Domains', href: '/domains.html', hidden: true },
] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const COLORS = ['violet', 'amber', 'teal', 'green', 'rose', 'blue', 'slate'];

type Folder = { id: string; name: string; color: string; sites: string[] };
type Opts = { canChange?: boolean; orgStatus?: number; folders?: Folder[]; views?: unknown[]; needs?: Record<string, unknown> };
/** Sites plus a small fake of the organize routes: it keeps what was saved, the way the
 *  server does (applyFolderList, moveSites, normalizeSiteViews, retag), so a later paint
 *  shows what the page sent. Registered after the harness, so these routes win. */
async function openSites(page: Page, opts: Opts = {}) {
  const rows = [BISTRO, TACO, GARAGE, CAFE].map((r) => ({ ...r, tags: [...r.tags] }));
  let folders: Folder[] = opts.folders ?? FOLDERS();
  let views: any[] = (opts.views ?? VIEWS()) as any[];
  let made = 0;
  const writes: Array<{ method: string; path: string; body: any }> = [];
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: rows, partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90 },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: opts.needs || {}, next_by_client: {} } },
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/thumb/, (route: Route) => route.fulfill(json({ data: { html: '<!doctype html><html><body><h1>Home page</h1></body></html>', version: 'live' } })));
  await page.route(/\/functions\/v1\/presence\/agency\/(sites\/(organize|folders|folders\/move|views|tags)|clients\/[0-9a-f-]{36})(\?.*)?$/, async (route: Route) => {
    const req = route.request(), method = req.method();
    const path = new URL(req.url()).pathname.replace(/^.*\/presence/, '');
    if (path === '/agency/sites/organize') {
      if (opts.orgStatus) return route.fulfill(json({ error: opts.orgStatus === 404 ? 'not_found' : 'read_failed', message: 'Your folders and views couldn’t load just now.' }, opts.orgStatus));
      return route.fulfill(json({ data: { folders, views, colors: COLORS, can_change: opts.canChange ?? true } }));
    }
    const body = req.postDataJSON();
    writes.push({ method, path, body });
    if (path === '/agency/sites/folders') {
      folders = (body.folders as Array<Partial<Folder>>).map((f) => {
        const was = folders.find((x) => x.id === f.id);
        const used = new Set(folders.map((x) => x.color));
        return { id: was?.id || `f-new0000${++made}`, name: String(f.name), color: String(f.color || was?.color || COLORS.find((c) => !used.has(c)) || 'violet'), sites: was ? was.sites : [] };
      });
      return route.fulfill(json({ data: { folders } }));
    }
    if (path === '/agency/sites/folders/move') {
      const moving = new Set<string>(body.site_ids);
      folders = folders.map((f) => {
        const kept = f.sites.filter((s) => !moving.has(s));
        return f.id === body.folder ? { ...f, sites: [...kept, ...body.site_ids] } : { ...f, sites: kept };
      });
      return route.fulfill(json({ data: { folders } }));
    }
    if (path === '/agency/sites/views') {
      views = (body.views as any[]).map((v) => ({ ...v, id: v.id || `v-new0000${++made}` }));
      return route.fulfill(json({ data: { views } }));
    }
    if (path === '/agency/sites/tags') {
      const out = rows.filter((r) => body.site_ids.includes(r.site_id)).map((r) => {
        const t = r.tags.filter((x: string) => x !== body.remove);
        if (body.add && !t.includes(body.add)) t.push(body.add);
        r.tags = t; return { site_id: r.site_id, tags: t };
      });
      return route.fulfill(json({ data: { sites: out } }));
    }
    const id = path.split('/')[3];
    return route.fulfill(json({ data: { site_id: id, status: 'active', tags: body.tags, owner_email: '', assigned: [], notes: '' } }));
  });
  await page.goto('/sites.html');
  await expect(page.locator('.scard').first()).toBeVisible();
  return { writes, get folders() { return folders; } };
}
const names = (page: Page, sel = '.scard:visible .sname') => page.locator(sel);
const isPhone = (page: Page) => (page.viewportSize()?.width || 1280) < 768;
const tiles = (page: Page) => page.locator('.fstrip .ftile');
const toast = (page: Page, text: string) => page.locator('.dds-toast', { hasText: text });
// several inputs' values, in order (toHaveValues is for one multi-select)
const valuesOf = (l: ReturnType<Page['locator']>) => expect.poll(() => l.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)));
// the serious and critical axe findings, with where they are
const serious = async (page: Page, sel: string) => (await new AxeBuilder({ page }).include(sel).analyze()).violations
  .filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test.describe('Sites: folders (builder list item 176)', () => {
  test('under the tabs: every site, each folder with how many need you, no folder, a new one; a folder scopes the cards, the band and the count', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openSites(page, { needs: { [ID.bistro]: { what: 'bistro.example expires in 12 days', verb: 'Fix', href: `/presence.html?client=${ID.bistro}#domain`, kind: 'broken' } } });
    await expect(page.locator('.fstrip')).toHaveAttribute('aria-label', 'Folders');
    await expect(tiles(page).locator('b')).toHaveText(['All sites', 'Restaurants', 'Trials', 'No folder', 'New folder']);
    await expect(tiles(page).nth(0)).toContainText('4 sites');
    await expect(tiles(page).nth(1)).toContainText('2 sites · 1 needs you');
    await expect(tiles(page).nth(2)).toContainText('1 site');
    await expect(tiles(page).nth(3)).toContainText('1 site');
    await expect(tiles(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#manageFolders')).toHaveText('Rename or remove…');
    // on every site, a card in a folder says which; one in no folder says nothing
    await expect(page.locator(`.scard[data-site="${ID.bistro}"] .stags .fchip`)).toHaveText('Restaurants');
    await expect(page.locator(`.scard[data-site="${ID.garage}"] .stags .fchip`)).toHaveCount(0);

    await tiles(page).filter({ hasText: 'Restaurants' }).click();
    await expect(tiles(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(tiles(page).nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(tiles(page).nth(1)).toBeFocused();
    await expect(names(page)).toHaveText(['Bistro Nine', 'Taco Twelve']);
    await expect(page.locator('.sband .eyebrow')).toHaveText('In this folder');
    await expect(page.locator('.sband .hi')).toHaveText('2 sites in Restaurants');
    await expect(page.locator('#lmeta')).toContainText('2 sites in Restaurants ·');
    // inside the folder, its name isn't said again on each card
    await expect(page.locator(`.scard[data-site="${ID.bistro}"] .stags .fchip`)).toHaveCount(0);

    // the folder is remembered on this device
    await page.reload();
    await expect(tiles(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(names(page)).toHaveText(['Bistro Nine', 'Taco Twelve']);

    await tiles(page).filter({ hasText: 'No folder' }).click();
    await expect(names(page)).toHaveText(['Garage Ten']);
    await expect(page.locator('.sband .hi')).toHaveText('1 site in no folder');
    await expect(page.locator('#lmeta')).toContainText('1 site in no folder ·');

    // a card's folder line opens that folder
    await tiles(page).filter({ hasText: 'All sites' }).click();
    await page.locator(`.scard[data-site="${ID.cafe}"] .stags .fchip`).click();
    await expect(tiles(page).filter({ hasText: 'Trials' })).toHaveAttribute('aria-pressed', 'true');
    await expect(names(page)).toHaveText(['Cafe Eleven']);
    expect(errors).toEqual([]);
  });

  test('+ New folder: a name, and it is there, picked and empty, with where to go next', async ({ page }) => {
    const t = await openSites(page);
    await page.locator('#newFolderBtn').click();
    const ask = page.locator('dialog.dds-ask');
    await expect(ask.locator('h2')).toHaveText('New folder');
    await ask.locator('input').fill('Florists');
    await ask.getByRole('button', { name: 'Make folder' }).click();
    await expect(toast(page, '“Florists” is made. Move sites into it from their ⋯ menu, or tick them in the table.')).toBeVisible();
    expect(t.writes.map((w) => `${w.method} ${w.path}`)).toEqual(['PUT /agency/sites/folders']);
    expect(t.writes[0].body).toEqual({ folders: [{ id: 'f-rest0001', name: 'Restaurants', color: 'amber' }, { id: 'f-tria0001', name: 'Trials', color: 'teal' }, { name: 'Florists' }] });
    const fl = tiles(page).filter({ hasText: 'Florists' });
    await expect(fl).toHaveAttribute('aria-pressed', 'true');
    await expect(fl).toContainText('0 sites');
    await expect(page.locator('.sband .hi')).toHaveText('0 sites in Florists');
    await expect(page.locator('#noMatch')).toHaveText('No sites in Florists yet. Move one here from its ⋯ menu.');
  });

  test('Move to folder from a site’s ⋯ menu; a new folder named there is made first; focus comes back', async ({ page }) => {
    const t = await openSites(page);
    const garage = page.locator(`.scard[data-site="${ID.garage}"]`);
    await garage.locator('[data-menu]').click();
    const items = page.locator('#rowMenuHost [role="menuitem"]');
    await expect(items.nth(1)).toHaveText('Move to folder…');
    await expect(items.nth(2)).toHaveText('Tags…');
    await items.nth(1).click();
    const dlg = page.locator('#folderDlg');
    await expect(dlg.locator('#folderHead')).toHaveText('Move Garage Ten to');
    await expect(dlg.locator('.fopt')).toHaveText(['Restaurants', 'Trials', 'No folder now']);
    await expect(dlg.getByRole('radio', { name: 'No folder' })).toBeChecked();
    await dlg.getByRole('radio', { name: 'Restaurants' }).check();
    await dlg.getByRole('button', { name: 'Move' }).click();
    await expect(toast(page, 'Moved to Restaurants.')).toBeVisible();
    await expect(dlg).toBeHidden();
    expect(t.writes.at(-1)).toEqual({ method: 'POST', path: '/agency/sites/folders/move', body: { site_ids: [ID.garage], folder: 'f-rest0001' } });
    await expect(tiles(page).filter({ hasText: 'Restaurants' })).toContainText('3 sites');
    await expect(tiles(page).filter({ hasText: 'No folder' })).toContainText('0 sites');
    await expect(garage.locator('.stags .fchip')).toHaveText('Restaurants');
    await expect(garage.locator('[data-menu]')).toBeFocused();

    // a name typed for a new folder: the folder is made, then the site goes in
    const cafe = page.locator(`.scard[data-site="${ID.cafe}"]`);
    await cafe.locator('[data-menu]').click();
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Move to folder…' }).click();
    await expect(dlg.getByRole('radio', { name: 'Trials' })).toBeChecked();
    await dlg.locator('#folder-new').fill('Coffee');
    await expect(dlg.getByRole('radio', { name: 'Trials' })).not.toBeChecked();
    await dlg.getByRole('button', { name: 'Move' }).click();
    await expect(toast(page, 'Moved to Coffee.')).toBeVisible();
    expect(t.writes.slice(-2).map((w) => `${w.method} ${w.path}`)).toEqual(['PUT /agency/sites/folders', 'POST /agency/sites/folders/move']);
    expect(t.writes.at(-1)!.body).toEqual({ site_ids: [ID.cafe], folder: 'f-new00001' });
    await expect(tiles(page).filter({ hasText: 'Coffee' })).toContainText('1 site');
    await expect(tiles(page).filter({ hasText: 'Trials' })).toContainText('0 sites');
  });

  test('Rename or remove: names, colours and order saved together; the folder you were in, removed, goes back to All sites', async ({ page }) => {
    const t = await openSites(page);
    await tiles(page).filter({ hasText: 'Restaurants' }).click();
    await page.locator('#manageFolders').click();
    const dlg = page.locator('#mfDlg');
    await expect(dlg.locator('#mfHead')).toHaveText('Your folders');
    await valuesOf(dlg.locator('[data-mf] input')).toEqual(['Restaurants', 'Trials']);
    await expect(dlg.getByRole('button', { name: 'Move Restaurants up' })).toBeDisabled();
    await dlg.getByRole('button', { name: 'Move Trials up' }).click();
    await valuesOf(dlg.locator('[data-mf] input')).toEqual(['Trials', 'Restaurants']);
    await dlg.getByLabel('Colour of folder 1').selectOption('rose');
    await dlg.getByLabel('Name of folder 1').fill('Trial sites');
    await dlg.getByRole('button', { name: 'Remove Restaurants' }).click();
    await expect(dlg.locator('[data-mf]')).toHaveCount(1);
    await dlg.getByRole('button', { name: 'Save folders' }).click();
    await expect(toast(page, 'Your folders are saved.')).toBeVisible();
    expect(t.writes.at(-1)).toEqual({ method: 'PUT', path: '/agency/sites/folders', body: { folders: [{ id: 'f-tria0001', name: 'Trial sites', color: 'rose' }] } });
    await expect(tiles(page).locator('b')).toHaveText(['All sites', 'Trial sites', 'No folder', 'New folder']);
    await expect(tiles(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(names(page)).toHaveCount(4);
  });
});

test.describe('Sites: tags (builder list item 176)', () => {
  test('on each card; a tag shows every site with it; + Tag edits one site’s; the Tag picker counts them', async ({ page }) => {
    const t = await openSites(page);
    const bistro = page.locator(`.scard[data-site="${ID.bistro}"]`);
    await expect(bistro.locator('.stags .tagchip')).toHaveText(['restaurant', 'downtown']);
    await bistro.getByRole('button', { name: 'Tagged downtown: show every site with it' }).click();
    await expect(page.locator('#tagBtn .vname')).toHaveText('downtown');
    await expect(names(page)).toHaveText(['Bistro Nine', 'Cafe Eleven']);
    await expect(page.locator('#lmeta')).toContainText('2 sites tagged downtown ·');

    await page.locator('#tagBtn').click();
    const menu = page.locator('#orgMenuHost [role="menu"]');
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Any tag', 'downtown · 2', 'restaurant · 2']);
    await expect(menu.getByRole('menuitemradio', { name: /^downtown/ })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemradio', { name: /^downtown/ })).toBeFocused();
    await menu.getByRole('menuitemradio', { name: 'Any tag' }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('#tagBtn')).toBeFocused();
    await expect(names(page)).toHaveCount(4);

    // one site's tags: chips, the ones used elsewhere to add, and typed ones
    const taco = page.locator(`.scard[data-site="${ID.taco}"]`);
    await taco.getByRole('button', { name: 'Tags for Taco Twelve' }).click();
    const dlg = page.locator('#tagDlg');
    await expect(dlg.locator('#tagHead')).toHaveText('Tags for Taco Twelve');
    await expect(dlg.locator('.chip')).toHaveText(['restaurant✕']);
    await expect(dlg.locator('#tagSug button')).toHaveText(['+ downtown']);
    await expect(dlg.locator('#tag-in')).toBeFocused();
    await dlg.locator('#tagSug button').click();
    await expect(dlg.locator('#tagSugWrap')).toBeHidden();
    await dlg.locator('#tag-in').fill('Late Night');
    await dlg.locator('#tag-in').press('Enter');
    await expect(dlg.locator('.chip')).toHaveText(['restaurant✕', 'downtown✕', 'late night✕']);
    await dlg.getByRole('button', { name: 'Done' }).click();
    await expect(toast(page, 'Tags saved.')).toBeVisible();
    expect(t.writes.at(-1)).toEqual({ method: 'PATCH', path: `/agency/clients/${ID.taco}`, body: { tags: ['restaurant', 'downtown', 'late night'] } });
    await expect(taco.locator('.stags .tagchip')).toHaveText(['restaurant', 'downtown', 'late night']);
    await expect(taco.getByRole('button', { name: 'Tags for Taco Twelve' })).toBeFocused();
    await page.locator('#tagBtn').click();
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Any tag', 'downtown · 3', 'restaurant · 2', 'late night · 1']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tagBtn')).toBeFocused();
  });

  test('the table: a tick box a row, not a way in; the picked bar moves, tags and untags them; Clear', async ({ page }) => {
    const t = await openSites(page);
    await page.locator('#dispTable').click();
    const table = page.locator('#tableHost');
    await expect(table.getByRole('checkbox', { name: 'Pick every site shown' })).toBeVisible();
    await expect(table.locator('thead .thb').last()).toHaveText('Folder · Tags');
    await table.getByRole('checkbox', { name: 'Pick Bistro Nine' }).check();
    await expect(table.getByRole('checkbox', { name: 'Pick Bistro Nine' })).toBeFocused();
    await table.getByRole('checkbox', { name: 'Pick Garage Ten' }).check();
    await expect(page).toHaveURL(/\/sites\.html$/);   // ticking a row never opens the site
    const bar = page.getByRole('region', { name: 'Picked sites' });
    await expect(bar.locator('b')).toHaveText('2 sites picked');
    await expect(bar.getByRole('button')).toHaveText(['Move to folder', 'Add a tag', 'Remove a tag ▾', 'Clear']);

    await bar.getByRole('button', { name: 'Add a tag' }).click();
    const ask = page.locator('dialog.dds-ask');
    await expect(ask.locator('h2')).toHaveText('Add a tag to 2 sites');
    await ask.locator('input').fill('Spring Promo');
    await ask.getByRole('button', { name: 'Add tag' }).click();
    await expect(toast(page, '“spring promo” is on 2 sites.')).toBeVisible();
    expect(t.writes.at(-1)).toEqual({ method: 'POST', path: '/agency/sites/tags', body: { site_ids: [ID.bistro, ID.garage], add: 'spring promo' } });

    await bar.getByRole('button', { name: 'Remove a tag ▾' }).click();
    const menu = page.locator('#orgMenuHost [role="menu"]');
    await expect(menu.getByRole('menuitem')).toHaveText(['downtown', 'restaurant', 'spring promo']);
    await menu.getByRole('menuitem', { name: 'restaurant' }).click();
    await expect(toast(page, '“restaurant” is off the 2 sites picked.')).toBeVisible();
    expect(t.writes.at(-1)).toEqual({ method: 'POST', path: '/agency/sites/tags', body: { site_ids: [ID.bistro, ID.garage], remove: 'restaurant' } });

    await bar.getByRole('button', { name: 'Move to folder' }).click();
    const dlg = page.locator('#folderDlg');
    await expect(dlg.locator('#folderHead')).toHaveText('Move 2 sites to');
    await expect(dlg.getByRole('radio', { checked: true })).toHaveCount(0);   // two sites, maybe two folders: nothing picked for you
    await dlg.getByRole('button', { name: 'Move' }).click();
    await expect(toast(page, 'Pick a folder, or name a new one.')).toBeVisible();
    await dlg.getByRole('radio', { name: 'Trials' }).check();
    await dlg.getByRole('button', { name: 'Move' }).click();
    await expect(toast(page, '2 sites moved to Trials.')).toBeVisible();
    expect(t.writes.at(-1)).toEqual({ method: 'POST', path: '/agency/sites/folders/move', body: { site_ids: [ID.bistro, ID.garage], folder: 'f-tria0001' } });
    await expect(bar.getByRole('button', { name: 'Move to folder' })).toBeFocused();
    await expect(table.locator(`tr[data-row="${ID.garage}"] .fline`)).toHaveText('Trials');

    await bar.getByRole('button', { name: 'Clear' }).click();
    await expect(bar).toHaveCount(0);
    await expect(table.getByRole('checkbox', { name: 'Pick every site shown' })).toBeFocused();
    await table.getByRole('checkbox', { name: 'Pick every site shown' }).check();
    await expect(bar.locator('b')).toHaveText('4 sites picked');
  });
});

test.describe('Sites: saved views (builder list item 176)', () => {
  test('View: Everything; save what is on screen for the studio; it stays on until something changes; pick it again later', async ({ page }) => {
    const t = await openSites(page);
    const vb = page.locator('#viewBtn');
    await expect(vb).toHaveText(/View:\s*Everything/);
    await tiles(page).filter({ hasText: 'Restaurants' }).click();
    await page.locator('#fpills [data-filter="live"]').click();
    await page.locator('#dispTable').click();
    await page.locator('#saveViewBtn').click();
    const dlg = page.locator('#svDlg');
    await expect(dlg.locator('#svKeeps .keep')).toHaveText(['Folder: Restaurants', 'Live', 'Table']);
    await expect(dlg.locator('#sv-name')).toBeFocused();
    await dlg.locator('#sv-name').fill('Live restaurants');
    await dlg.getByRole('button', { name: 'Save view' }).click();
    await expect(toast(page, '“Live restaurants” is saved. Everyone in your studio sees it in the View picker.')).toBeVisible();
    expect(t.writes.at(-1)).toEqual({ method: 'PUT', path: '/agency/sites/views', body: { views: [VIEWS()[0], { name: 'Live restaurants', folder: 'f-rest0001', tag: '', filter: 'live', q: '', sort: null, display: 'table' }] } });
    await expect(vb.locator('.vname')).toHaveText('Live restaurants');
    await expect(vb).toHaveClass(/\bon\b/);

    // anything changed: the view is let go
    await tiles(page).filter({ hasText: 'All sites' }).click();
    await expect(vb.locator('.vname')).toHaveText('Everything');

    await vb.click();
    const menu = page.locator('#orgMenuHost [role="menu"]');
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Everything', 'Downtown, table', 'Live restaurants']);
    await expect(menu.getByRole('menuitem')).toHaveText(['Save this view…', 'Rename or delete a view…']);
    await expect(menu.getByRole('menuitemradio', { name: 'Everything' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Downtown, table' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(vb.locator('.vname')).toHaveText('Downtown, table');
    await expect(vb).toBeFocused();
    await expect(page.locator('#dispTable')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tagBtn .vname')).toHaveText('downtown');
    await expect(page.locator('#tableHost tbody .n')).toHaveText(['Bistro Nine', 'Cafe Eleven']);

    await vb.click();
    await menu.getByRole('menuitemradio', { name: 'Live restaurants' }).click();
    await expect(tiles(page).filter({ hasText: 'Restaurants' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#fpills [data-filter="live"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tableHost tbody .n')).toHaveText(['Bistro Nine', 'Taco Twelve']);
    await vb.click();
    await menu.getByRole('menuitemradio', { name: 'Everything' }).click();
    await expect(page.locator('#tableHost tbody .n')).toHaveCount(4);
    await expect(tiles(page).nth(0)).toHaveAttribute('aria-pressed', 'true');

    // rename or delete
    await vb.click();
    await menu.getByRole('menuitem', { name: 'Rename or delete a view…' }).click();
    const mv = page.locator('#mvDlg');
    await valuesOf(mv.locator('[data-mv] input')).toEqual(['Downtown, table', 'Live restaurants']);
    await mv.getByLabel('Name of view 1').fill('Downtown');
    await mv.getByRole('button', { name: 'Delete Live restaurants' }).click();
    await mv.getByRole('button', { name: 'Save views' }).click();
    await expect(toast(page, 'Your saved views are updated.')).toBeVisible();
    expect(t.writes.at(-1)).toEqual({ method: 'PUT', path: '/agency/sites/views', body: { views: [{ ...VIEWS()[0], name: 'Downtown' }] } });
    await vb.click();
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Everything', 'Downtown']);
  });
});

test.describe('Sites: who can change them, and an older server (builder list item 176)', () => {
  test('a role that can’t change them: folders and views to look through, nothing to change', async ({ page }) => {
    const t = await openSites(page, { canChange: false });
    await expect(tiles(page).locator('b')).toHaveText(['All sites', 'Restaurants', 'Trials', 'No folder']);
    await expect(page.locator('#newFolderBtn, #manageFolders, #saveViewBtn')).toHaveCount(0);
    await expect(page.locator('[data-tagedit]')).toHaveCount(0);
    await page.locator('#viewBtn').click();
    await expect(page.locator('#orgMenuHost').getByRole('menuitem')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator(`.scard[data-site="${ID.bistro}"] [data-menu]`).click();
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).not.toContainText(['Move to folder…']);
    await expect(page.locator('#rowMenuHost [role="menuitem"]')).not.toContainText(['Tags…']);
    await page.keyboard.press('Escape');
    await page.locator('#dispTable').click();
    await expect(page.locator('#tableHost input[type="checkbox"]')).toHaveCount(0);
    expect(t.writes).toEqual([]);
  });

  for (const status of [404, 502]) {
    test(`folders that couldn’t load (${status}): no tiles, no views, nothing saved over them; tags still work`, async ({ page }) => {
      const t = await openSites(page, { orgStatus: status });
      await expect(page.locator('.fstrip, #viewBtn, #saveViewBtn')).toHaveCount(0);
      await expect(page.locator('[data-tagedit]')).toHaveCount(0);
      await expect(page.locator(`.scard[data-site="${ID.bistro}"] .stags .tagchip`)).toHaveText(['restaurant', 'downtown']);
      await page.locator(`.scard[data-site="${ID.taco}"] .stags .tagchip`).click();
      await expect(names(page)).toHaveText(['Bistro Nine', 'Taco Twelve']);
      await page.locator(`.scard[data-site="${ID.bistro}"] [data-menu]`).click();
      await expect(page.locator('#rowMenuHost [role="menuitem"]')).not.toContainText(['Move to folder…']);
      await page.keyboard.press('Escape');
      await page.locator('#dispTable').click();
      await expect(page.locator('#tableHost thead .thb').last()).toHaveText('Tags');
      await expect(page.locator('#tableHost input[type="checkbox"]')).toHaveCount(0);
      expect(t.writes).toEqual([]);
    });
  }
});

test.describe('Sites: folders on every size (builder list item 176)', () => {
  test('the tiles, the View and Tag pickers and the tick boxes fit; nothing spills sideways; big enough for a finger; no serious axe issues', async ({ page }) => {
    await openSites(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const strip = await page.locator('.fstrip').boundingBox();
    const vw = page.viewportSize()!.width;
    expect(strip!.x + strip!.width).toBeLessThanOrEqual(vw + 1);   // a long row of folders scrolls inside its strip
    if (isPhone(page)) {
      for (const sel of ['.fstrip .ftile >> nth=0', '#viewBtn', '#saveViewBtn', '#tagBtn', '#manageFolders']) {
        const b = await page.locator(sel).boundingBox();
        expect(b!.height, sel).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await serious(page, '#main')).toEqual([]);

    await page.locator('#dispTable').click();
    await page.locator('#tableHost').getByRole('checkbox', { name: 'Pick Taco Twelve' }).check();
    await expect(page.getByRole('region', { name: 'Picked sites' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    if (isPhone(page)) {
      const pk = await page.locator(`#tableHost tr[data-row="${ID.taco}"] td.pick .pk`).boundingBox();
      expect(pk!.width).toBeGreaterThanOrEqual(44);
      expect(pk!.height).toBeGreaterThanOrEqual(44);
      const all = await page.locator('#tableHost th.pick .pk').boundingBox();
      expect(all!.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator('#tableHost th.pick .pkw')).toBeVisible();
      // the tick box and the name don't sit on each other
      const nm = await page.locator(`#tableHost tr[data-row="${ID.taco}"] td.name .n`).boundingBox();
      expect(nm!.x).toBeGreaterThanOrEqual(pk!.x + pk!.width - 4);
      for (const b of await page.getByRole('region', { name: 'Picked sites' }).getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await serious(page, '#main')).toEqual([]);

    // the dialogs, on screen and checked too
    await page.getByRole('region', { name: 'Picked sites' }).getByRole('button', { name: 'Move to folder' }).click();
    const dlg = await page.locator('#folderDlg').boundingBox();
    expect(dlg!.x).toBeGreaterThanOrEqual(0);
    expect(dlg!.x + dlg!.width).toBeLessThanOrEqual(vw + 1);
    expect(await serious(page, '#folderDlg')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#folderDlg')).toBeHidden();
    await page.locator('#saveViewBtn').click();
    expect(await serious(page, '#svDlg')).toEqual([]);
  });
});
