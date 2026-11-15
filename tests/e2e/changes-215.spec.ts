import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, CLIENT_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 215 (Nov 2026; review file 03, finding 4): Changes, who changed what and
// when, as drawn in Figma (page 410:2) and approved. At the studio's level, a tab beside
// Usage: the week by who made the changes, then each change in a sentence. Inside a client:
// that site's changes, this month by who made them, and who sees the page. The fixtures'
// shape is routes/change_log.ts's (change_log_215_test.mjs covers the server). Fake names only.

const NOW = '2026-11-15T18:00:00Z';
const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222';
const item = (over: Record<string, unknown>) => ({ id: '', at: NOW, from: null, site_id: S1, area: 'website', who: 'Eric', who_note: '', side: 'studio', text: '', detail: '', where: 'Website', go: '/presence.html#business', count: 1, key: 'k', site: 'Bluebird Bakery', ...over });
const ITEMS = [
  item({ id: 'publish:p1', at: '2026-11-15T16:40:00Z', area: 'live', text: 'published the site. 3 changes went live', where: 'Website › Versions', go: '/presence.html#history', publish_id: 'ffffffff-0000-4000-8000-000000000001' }),
  item({ id: 'event:2', at: '2026-11-15T16:32:00Z', text: 'changed the opening hours', where: 'Website › Hours and location' }),
  item({ id: 'event:3', at: '2026-11-15T14:10:00Z', site_id: S2, site: 'Pine & Pour', who: 'Sam Lee', who_note: 'the owner', side: 'owner', text: 'changed the phone number', where: 'Website › Business details' }),
  item({ id: 'event:4', at: '2026-11-14T17:21:00Z', from: '2026-11-14T17:18:00Z', site_id: S2, site: 'Pine & Pour', who: 'Jo Park', who_note: 'staff', side: 'seat', area: 'photos', text: 'added 4 photos', where: 'Files › Photos', go: '/files.html', count: 4 }),
  item({ id: 'member:5', at: '2026-11-14T10:00:00Z', area: 'people', text: 'invited lee@pixel.example as a Designer', where: 'People', go: '/sharing.html' }),
  item({ id: 'event:6', at: '2026-11-14T09:00:00Z', area: 'settings', text: 'took the website offline', detail: 'Visitors see a simple “temporarily offline” page', where: 'Site settings', go: null }),
  item({ id: 'event:7', at: '2026-11-13T09:00:00Z', who: 'Studio OS', side: 'auto', area: 'live', text: 'published the site', where: 'Website › Versions', go: '/presence.html#history' }),
];
const DAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map((day, i) => ({ day, studio: [2, 8, 12, 6, 5, 6, 2][i], client: [0, 3, 2, 4, 1, 3, 2][i], auto: [1, 1, 1, 1, 2, 1, 1][i] }));
const WEEK = { days: DAYS, total: 64, went_live: 9, by_side: { studio: 41, client: 15, auto: 8 }, people: [{ who: 'Eric', who_note: '', side: 'studio', count: 33 }, { who: 'Mia Chen', who_note: '', side: 'studio', count: 8 }, { who: 'Sam Lee', who_note: 'the owner', side: 'owner', count: 10 }, { who: 'Jo Park', who_note: 'staff', side: 'seat', count: 5 }, { who: 'Studio OS', who_note: '', side: 'auto', count: 8 }], site_count: 2, sites: [{ site_id: S1, count: 40, name: 'Bluebird Bakery' }] };
const STUDIO = { data: { items: ITEMS, next_before: '2026-11-13T09:00:00Z', sites: { [S1]: 'Bluebird Bakery', [S2]: 'Pine & Pour' }, week: WEEK, can_people: true } };
const OLDER = { data: { items: [item({ id: 'event:8', at: '2026-11-10T09:00:00Z', text: 'changed the menu', where: 'Website › Menu', go: '/presence.html#design' })], next_before: null, sites: STUDIO.data.sites, week: WEEK, can_people: true } };
const SITE_ONE = { data: { items: ITEMS.filter((i) => i.site_id === S1).map((i) => ({ ...i, site: undefined })), next_before: null, site_name: 'Bluebird Bakery', month: { label: 'November', total: 22, went_live: 4, by_side: { studio: 15, client: 6, auto: 1 }, people: [{ who: 'Eric', who_note: '', side: 'studio', count: 14 }, { who: 'Sam Lee', who_note: 'the owner', side: 'owner', count: 5 }, { who: 'Studio OS', who_note: '', side: 'auto', count: 1 }] }, can_people: true, viewer_side: 'studio' } };
const WENT = { data: { kept: true, first: false, sentences: ['Saturday hours change from “9am–3pm” to “8am–4pm”.', '“Birthday cake” changes from $38 to $42.'] } };
const NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }, { key: 'changes', label: 'Changes', href: '/changes.html', hidden: true }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: NAV, plan_key: 'agency', upsell: null } };
const clientContext = { data: { ...studioContext.data, nav: CLIENT_NAV, scope: { site_id: S1, name: 'Bluebird Bakery' } } };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openChanges(page: Page, o: { url?: string; status?: number; site?: unknown } = {}) {
  const errors: string[] = [];
  const asked: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(NOW));
  await installApp(page, { api: { '/portal/context': o.url && o.url.includes('client=') ? clientContext : studioContext, '/agency/sites': { data: [], partial: false, can_open: true, can_create: true, trash: [], trash_days: 90 } } as never });
  await page.route(/\/functions\/v1\/presence\/(agency\/)?change-log(\/went-live)?(\?.*)?$/, (route: Route) => {
    const u = new URL(route.request().url());
    asked.push(`${u.pathname.replace(/^.*\/presence/, '')}?${u.searchParams.toString()}|${route.request().headers()['x-dds-scope-site'] || ''}`);
    if (/went-live/.test(u.pathname)) return route.fulfill(json(WENT));
    if (/agency/.test(u.pathname)) return route.fulfill(json(o.status && o.status !== 200 ? { error: 'x' } : u.searchParams.get('before') ? OLDER : STUDIO, o.status ?? 200));
    return route.fulfill(json(o.site ?? SITE_ONE));
  });
  await page.goto(o.url ?? '/changes.html');
  return { errors, asked };
}

test.describe('Changes (builder list item 215)', () => {
  test('at the studio’s level: the tab, the week by who made the changes, and each change in a sentence', async ({ page }) => {
    const { errors, asked } = await openChanges(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Sites' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Sites, domains, templates, usage and changes' });
    await expect(tabs.getByRole('link')).toHaveText(['Sites', 'Domains', 'Templates', 'Usage', 'Changes']);
    await expect(tabs.getByRole('link', { name: 'Changes' })).toHaveAttribute('aria-current', 'page');
    const band = page.getByRole('region', { name: 'This week in changes' });
    await expect(band.locator('.big')).toHaveText('64 changes');
    // the busiest day's label sits under the chart's title, never on it
    const title = await band.locator('.chart .ct').boundingBox(), peak = await band.locator('.bar b').boundingBox();
    expect(peak!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
    await expect(band.locator('.sub')).toHaveText('on 2 sites, by 4 people · 9 went live');
    await expect(band.locator('.fact .fv')).toHaveText(['41 by your studio', '15 by clients', '9 went live', 'Bluebird Bakery']);
    await expect(band.locator('.fact .fn').first()).toHaveText('Eric 33 · Mia Chen 8');
    await expect(band.getByRole('img')).toHaveAttribute('aria-label', /Changes each day: Mon 9 3, .*Wed 11 15/);
    await expect(band.locator('.bar b')).toHaveText('15 on Wed 11');
    // the sentences: who in bold, the site named, the place and the time
    const rows = page.locator('li.ch');
    await expect(rows).toHaveCount(7);
    await expect(rows.nth(0).locator('.t')).toHaveText('Eric published Bluebird Bakery. 3 changes went live.');
    await expect(rows.nth(1).locator('.t')).toHaveText('Eric changed the opening hours on Bluebird Bakery.');
    await expect(rows.nth(2).locator('.t')).toHaveText('Sam Lee, the owner, changed the phone number on Pine & Pour.');
    await expect(rows.nth(3).locator('.t')).toHaveText('Jo Park, staff, added 4 photos on Pine & Pour.');
    await expect(rows.nth(3).locator('.s')).toHaveText('Files › Photos · 5:18 PM to 5:21 PM');
    await expect(rows.nth(5).locator('.t')).toHaveText('Eric took Bluebird Bakery offline.');
    await expect(rows.nth(5).locator('.s')).toHaveText('Visitors see a simple “temporarily offline” page · Site settings · 9:00 AM');
    await expect(rows.nth(6).locator('.ckind')).toHaveText('Automatic');
    await expect(page.locator('h3.day')).toHaveText(['Today · Sunday, Nov 15', 'Yesterday · Saturday, Nov 14', 'Friday, Nov 13']);
    // a change opens its place on that client's site
    await expect(rows.nth(1).getByRole('link', { name: /Open/ })).toHaveAttribute('href', `/presence.html?client=${S1}#business`);
    expect(asked[0]).toMatch(/^\/agency\/change-log\?tz=UTC\|$/);
    expect(errors).toEqual([]);
  });

  test('a publish opens what went live; older changes come below', async ({ page }) => {
    const { asked } = await openChanges(page);
    const pub = page.locator('li.ch').first();
    await pub.getByRole('button', { name: /What went live/ }).click();
    await expect(pub.locator('.went li')).toHaveText(['Saturday hours change from “9am–3pm” to “8am–4pm”.', '“Birthday cake” changes from $38 to $42.']);
    await expect(pub.getByRole('button', { name: /Hide/ })).toHaveAttribute('aria-expanded', 'true');
    expect(asked.some((a) => a.startsWith(`/agency/change-log/went-live?site=${S1}&id=ffffffff-0000-4000-8000-000000000001`))).toBe(true);
    await page.getByRole('button', { name: 'Show older changes' }).click();
    await expect(page.locator('li.ch')).toHaveCount(8);
    await expect(page.locator('li.ch').last().locator('.t')).toHaveText('Eric changed the menu on Bluebird Bakery.');
    await expect(page.getByRole('button', { name: 'Show older changes' })).toHaveCount(0);
    expect(asked.some((a) => /before=2026-11-13T09%3A00%3A00Z/.test(a))).toBe(true);
  });

  test('filters: who made them, what kind, which site, each asked of the server', async ({ page }) => {
    const { asked } = await openChanges(page);
    await page.getByRole('group', { name: 'Who made them' }).getByRole('button', { name: 'Clients' }).click();
    await expect(page.getByRole('button', { name: 'Clients' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('group', { name: 'Which changes' }).getByRole('button', { name: 'Photos' }).click();
    // picked while Photos is still reading: the pick stays, and one more read asks with every pick
    await page.getByLabel('Which site').selectOption(S2);
    await expect.poll(() => asked.some((a) => new RegExp(`who=client&area=photos&site=${S2}`).test(a))).toBe(true);
    await expect(page.getByLabel('Which site')).toHaveValue(S2);
    await expect(page.getByRole('button', { name: 'Photos' })).toHaveAttribute('aria-pressed', 'true');
    expect(asked.some((a) => /who=client&area=photos(&|\|)/.test(a))).toBe(true);
  });

  test('inside a client: that site’s changes, this month by who made them, and who sees the page', async ({ page }) => {
    const { errors, asked } = await openChanges(page, { url: `/changes.html?client=${S1}` });
    await expect(page.getByRole('heading', { level: 1, name: 'Changes' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Where you are' }).getByRole('link', { name: 'Website' })).toHaveAttribute('href', `/presence.html?client=${S1}`);
    const band = page.getByRole('region', { name: 'November in changes' });
    await expect(band.locator('.big')).toHaveText('22 changes');
    await expect(band.locator('.sub')).toHaveText('by 2 people and Studio OS · 4 went live');
    await expect(band.locator('.wrow .nm b')).toHaveText(['Eric', 'Sam Lee', 'Studio OS']);
    await expect(page.getByRole('region', { name: 'Who sees this page' }).locator('.role b')).toHaveText(['Owner and co-owners', 'Staff', 'Designer', 'Reviewer', 'Your studio']);
    await expect(page.locator('li.ch').first().locator('.t')).toHaveText('Eric published the site. 3 changes went live.');
    await expect(page.getByLabel('Which site')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Who made them' }).getByRole('button')).toHaveText(['Everyone', 'Your studio', 'The client', 'Automatic']);
    expect(asked[0]).toBe(`/change-log?tz=UTC|${S1}`);
    expect(errors).toEqual([]);
  });

  test('an owner on their own site reads “You”; without People rights there is no People filter', async ({ page }) => {
    const own = { data: { ...SITE_ONE.data, viewer_side: 'client', can_people: false, items: [item({ id: 'e1', who: 'You', side: 'you', text: 'changed the phone number', site: undefined }), item({ id: 'e2', who: 'Eric', who_note: 'from your studio', text: 'changed the opening hours', site: undefined })] } };
    await openChanges(page, { status: 403, site: own });
    await expect(page.locator('li.ch .t')).toHaveText(['You changed the phone number.', 'Eric, from your studio, changed the opening hours.']);
    await expect(page.getByRole('group', { name: 'Which changes' }).getByRole('button', { name: 'People' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Who sees this page' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Who made them' }).getByRole('button')).toHaveText(['Everyone', 'Your studio', 'You and your team', 'Automatic']);
  });

  test('a phone: each change is a card, every control 44 px, no sideways scroll', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) > 640, 'phone only');
    await openChanges(page);
    await expect(page.locator('li.ch').first()).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide).toBeLessThanOrEqual(0);
    for (const sel of ['.pill', '.seg button', 'li.ch .go']) {
      const h = await page.locator(sel).first().evaluate((n) => (n as HTMLElement).getBoundingClientRect().height);
      expect(h, sel).toBeGreaterThanOrEqual(44);
    }
    const card = await page.locator('li.ch').first().evaluate((n) => getComputedStyle(n).borderRadius);
    expect(card).toBe('14px');
    // the kind of change is a label, not a control: it stays one line high beside Open
    const kind = await page.locator('li.ch .ckind').first().evaluate((n) => (n as HTMLElement).getBoundingClientRect().height);
    expect(kind).toBeLessThan(30);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious accessibility problems (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openChanges(page);
      await expect(page.locator('li.ch')).toHaveCount(7);
      await page.locator('li.ch').first().getByRole('button', { name: /What went live/ }).click();
      await expect(page.locator('.went li')).toHaveCount(2);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.map((n) => n.target.join(' ') + ' ' + String(n.any[0]?.message || '').slice(0, 170)).join(' | ')}`);
      expect(bad).toEqual([]);
    });
  }
});
