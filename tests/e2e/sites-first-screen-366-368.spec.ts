import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { pinClock } from './helpers/clock';

// Builder items 366 and 368 (Nov 2026, review files 06 and 11):
//   366  On Sites a site shows on the first screen: the band of numbers, Needs you and the
//        folders are slim rows above the list, not a screen of their own.
//   368  The picked bar's many-sites actions gain Monthly report on or off, Notifications on
//        or off, and Check domains now. Each goes through that site's own route, one site after
//        another (PUT /report/monthly in the site's scope, PUT /agency/notify/:site, POST
//        /agency/domains/:site/check), so the rules are the ones of doing it one at a time.
// Fixtures follow the real shapes (agency/sites.ts buildSites, the needs-you rows, site_folders.ts);
// the names are made up.

const ID = {
  bistro: '0b1c0000-0000-4000-8000-000000000001', taco: '0b1c0000-0000-4000-8000-000000000002',
  garage: '0b1c0000-0000-4000-8000-000000000003', cafe: '0b1c0000-0000-4000-8000-000000000004',
};
const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live',
  address: '', domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2027-12-01T00:00:00Z' } },
  team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
  tags: [] as string[], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
  unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: 'live', copied: null, no_owner: false,
  owner: null, transfer: null,
  ...over,
});
const ROWS = [
  site({ site_id: ID.bistro, name: 'Bistro Nine', address: 'https://bistro.example', domain: 'bistro.example', opened_at: '2026-11-09T09:00:00Z' }),
  site({ site_id: ID.taco, name: 'Taco Twelve', address: 'https://taco.example', domain: 'taco.example', opened_at: '2026-11-08T09:00:00Z' }),
  site({ site_id: ID.garage, name: 'Garage Ten', edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', address: 'https://garage.example', domain: 'garage.example', opened_at: '2026-11-07T09:00:00Z' }),
  site({ site_id: ID.cafe, name: 'Cafe Eleven', state: 'not_live', state_words: 'Not live yet', thumb: 'draft', published_at: null, opened_at: '2026-11-06T09:00:00Z' }),
];
const FOLDERS = [
  { id: 'f-rest0001', name: 'Restaurants', color: 'amber', sites: [ID.bistro, ID.taco] },
  { id: 'f-tria0001', name: 'Trials', color: 'teal', sites: [ID.cafe] },
];
const need = (siteId: string, name: string, what: string) => ({ key: `domain:${siteId}`, site_id: siteId, name, what, when: 'Today', verb: 'Fix', href: `/presence.html?client=${siteId}#domain` });
const NEEDS = [need(ID.bistro, 'Bistro Nine', 'bistro.example expires in 12 days'), need(ID.taco, 'Taco Twelve', 'a form is waiting for a reply'), need(ID.cafe, 'Cafe Eleven', 'changes are sitting unpublished')];

const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

type Write = { method: string; path: string; scope: string | null; body: any };
async function openSites(page: Page, opts: { manage?: boolean; refuse?: Record<string, { status: number; body: unknown }> } = {}) {
  const writes: Write[] = [];
  await page.addInitScript(() => { try { localStorage.setItem('dds-display:sites', 'cards'); } catch { /* storage may be denied */ } });
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: ROWS, partial: false, can_open: true, can_pin: true, can_duplicate: opts.manage ?? true, can_create: opts.manage ?? true, can_trash: opts.manage ?? true, can_people: opts.manage ?? true, trash: [], trash_days: 90 },
    '/agency/needs-you': { data: { rows: NEEDS, more: 0, rest: [], total: NEEDS.length, empty_line: '', partial: false, own_site: true, next_by_site: { [ID.bistro]: NEEDS[0], [ID.taco]: NEEDS[1], [ID.cafe]: NEEDS[2] }, next_by_client: {} } },
    '/agency/sites/organize': { data: { folders: FOLDERS, views: [], colors: ['violet', 'amber', 'teal'], can_change: true } },
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/thumb/, (route: Route) => route.fulfill(json({ data: { html: '<!doctype html><html><body><h1>Home page</h1></body></html>', version: 'live' } })));
  // the three one-site routes the bar goes through, answered as the server answers them
  await page.route(/\/functions\/v1\/presence\/(report\/monthly|agency\/notify\/[^/]+|agency\/domains\/[^/]+\/check)$/, async (route: Route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/presence/, '');
    let body: any = null; try { body = req.postDataJSON(); } catch { /* a check sends nothing */ }
    const scope = req.headers()['x-dds-scope-site'] || null;
    writes.push({ method: req.method(), path, scope, body });
    const refused = opts.refuse && opts.refuse[`${path}|${scope || ''}`];
    if (refused) return route.fulfill(json(refused.body, refused.status));
    if (path === '/report/monthly') return route.fulfill(json({ data: { enabled: body.enabled } }));
    if (path.startsWith('/agency/notify/')) return route.fulfill(json({ data: { site_id: path.split('/')[3], on: body.on, dashboard: true, email: true, client_down: true } }));
    return route.fulfill(json({ data: { site_id: path.split('/')[3], domain: 'x.example', status_words: 'Working', tone: 'good', can_manage: true } }));
  });
  await pinClock(page);   // the fixtures hold dates (renewals, openings)
  await page.goto('/sites.html');
  await expect(page.locator('.scard').first()).toBeVisible();
  return writes;
}
async function toTable(page: Page) {
  const more = page.locator('.dds-ph-dots');
  if (await more.isVisible()) await more.click();
  await page.locator('#dispTable').click();
  await expect(page.locator('#tableHost table')).toBeVisible();
}
async function pick(page: Page, ids: string[]) {
  for (const id of ids) await page.locator(`#tableHost [data-pick="${id}"]`).check();
  await expect(page.locator('.pbar b')).toHaveText(`${ids.length} site${ids.length === 1 ? '' : 's'} picked`);
}

test.describe('Sites: a site on the first screen (builder item 366)', () => {
  for (const [w, h] of [[1280, 800], [375, 812]]) {
    test(`at ${w}×${h} the first site’s picture is on the first screen, under the folders, the numbers and Needs you`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openSites(page);
      await expect(page.locator('.fstrip .ftile')).toHaveCount(5);   // All sites, two folders, No folder, New folder
      await expect(page.locator('.sband .kpi')).toHaveCount(4);
      await expect(page.locator('.nstrip .task')).toHaveCount(1);    // one slim line: the first of three (on a phone, each card says it)…
      await expect(page.locator('.nhead .count')).toHaveText('3');   // …saying how many there are
      const top = await page.locator('.scard').first().evaluate((n) => n.getBoundingClientRect().top);
      expect(top, `the first site starts ${Math.round(top)}px down a ${h}px screen`).toBeLessThan(h - (w < 768 ? 140 : 300));
      // every row above it is slim: no tile, number or task taller than it needs
      for (const sel of ['.fstrip .ftile', '.sband .kpi', '.nstrip .task']) {
        const hs = await page.locator(sel).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((x) => x > 0));
        if (!hs.length) continue;
        expect(Math.max(...hs), sel).toBeLessThanOrEqual(56);
        expect(Math.min(...hs), `${sel} keeps a 44px tap target`).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
  test('the slim Needs you line keeps its task, its verb and See all on Home', async ({ page }) => {
    await openSites(page);
    const task = page.locator('.nstrip .task');
    await expect(task.locator('.tn')).toHaveText('Bistro Nine');
    await expect(task.locator('.tw')).toHaveText('bistro.example expires in 12 days');
    await expect(task.locator('a')).toHaveText('Fix');
    await expect(page.locator('.nhead a')).toHaveAttribute('href', '/agency.html');
  });
});

test.describe('Sites: reports, notifications and domains for many sites at once (builder item 368)', () => {
  test('Monthly report on goes through each picked site’s own switch, in its scope, and says so', async ({ page }) => {
    const writes = await openSites(page);
    await toTable(page);
    await pick(page, [ID.bistro, ID.taco]);
    await page.locator('.pbar [data-bulk="report"]').click();
    await page.locator('#orgMenuHost').getByRole('menuitem', { name: 'Turn on for 2 sites' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'Monthly report on for 2 sites.' }).first()).toBeVisible();
    expect(writes.map((x) => [x.method, x.path, x.scope, x.body])).toEqual([
      ['PUT', '/report/monthly', ID.bistro, { enabled: true }],
      ['PUT', '/report/monthly', ID.taco, { enabled: true }],
    ]);
  });

  test('a site the server refuses is counted out, with the server’s own reason', async ({ page }) => {
    const writes = await openSites(page, { refuse: { [`/report/monthly|${ID.taco}`]: { status: 409, body: { error: 'blocked', blocked: 'no_email', message: 'There’s no email on their record yet.' } } } });
    await toTable(page);
    await pick(page, [ID.bistro, ID.taco]);
    await page.locator('.pbar [data-bulk="report"]').click();
    await page.locator('#orgMenuHost').getByRole('menuitem', { name: 'Turn on for 2 sites' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'Monthly report on for 1 of 2 sites. The other one: There’s no email on their record yet.' }).first()).toBeVisible();
    expect(writes).toHaveLength(2);
  });

  test('Notifications off, and Check domains now only for the picked sites that have a domain', async ({ page }) => {
    const writes = await openSites(page);
    await toTable(page);
    await pick(page, [ID.bistro, ID.cafe]);
    await page.locator('.pbar [data-bulk="notify"]').click();
    await page.locator('#orgMenuHost').getByRole('menuitem', { name: 'Turn off for 2 sites' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'Notifications off for 2 sites.' }).first()).toBeVisible();
    await page.locator('.pbar [data-bulk="check"]').click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'Checked 1 domain just now. Domains has what we found.' }).first()).toBeVisible();
    expect(writes.map((x) => [x.method, x.path, x.body])).toEqual([
      ['PUT', `/agency/notify/${ID.bistro}`, { on: false }],
      ['PUT', `/agency/notify/${ID.cafe}`, { on: false }],
      ['POST', `/agency/domains/${ID.bistro}/check`, null],   // Cafe Eleven has no domain of its own
    ]);
  });

  test('a seat that can’t manage clients isn’t offered the three', async ({ page }) => {
    await openSites(page, { manage: false });
    await toTable(page);
    await pick(page, [ID.bistro]);
    await expect(page.locator('.pbar [data-bulk="move"]')).toBeVisible();   // folders and tags are their own permission
    await expect(page.locator('.pbar [data-bulk="report"], .pbar [data-bulk="notify"], .pbar [data-bulk="check"]')).toHaveCount(0);
  });
});
