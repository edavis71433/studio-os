import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 185 (Nov 2026): the map rank grid on the Search tab. For a client and a
// search a customer would type, where the business comes up on Google Maps from a grid of spots
// around it, coloured top 3, 4 to 10, 11 to 20 and not in the top 20. The studio switches it on,
// matches the business on Google, scans now and then, and sees each scan's cost; the client sees
// their own grid and its numbers once it is on, never a cost, a rival or the setup. The fixtures
// are GET /visibility/maps and its writes (routes/rank_grid.ts); tests/presence/rank_grid_test.mjs
// covers the server with Google scripted. Fake names only.

const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'copperline.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [], search_hidden: false, llms_txt: null } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/site': { data: { site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'copperline.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' }, identity: { business_name: 'Copperline Plumbing', seo_title: 'Copperline Plumbing, Burbank', seo_description: '' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [] } },
  '/foundations/domain': { data: { custom_domain: 'copperline.example', health: 'ok' } },
  '/redirects': { data: [] },
  '/search/health': { data: { verification: { google: true, bing: false }, seo_fields: { title: true, description: true }, schema: { type: 'LocalBusiness', industry: 'generic' }, sitemap: true, robots: true, internal_links: 'correct_by_construction', hidden_pages: [], links: [] } },
  '/visibility': { data: { state: 'ready', address: { url: 'https://copperline.example/', domain: 'copperline.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai-visibility', console: { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'measuring', unavailable: false, has_data: false }, listing: { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', property: null, data: null } } },
};

const ME = 'ChIJ_copperline_plumbing_01';
// the drawing's grid: strong to the north and east, weak to the south-west; 0 = not in the top 20
const GRID = [9, 6, 4, 4, 3, 5, 8, 7, 4, 3, 2, 2, 3, 6, 11, 5, 2, 1, 1, 2, 4, 14, 8, 3, 1, 1, 2, 5, 0, 12, 6, 2, 3, 4, 9, 0, 17, 10, 7, 6, 8, 13, 0, 0, 15, 12, 11, 14, 18];
const top3 = (r: Array<number | null>) => r.filter((v) => v != null && v >= 1 && v <= 3).length;
const RIVALS = [{ id: 'ChIJ_rivera_rooter_0001', first: 18, top3: 31 }, { id: 'ChIJ_blueline_plumb_002', first: 9, top3: 27 }, { id: 'ChIJ_valley_drain_pro_03', first: 6, top3: 14 }];
const TOPS = GRID.map((v, i) => (v === 1 ? [ME, RIVALS[0].id, RIVALS[1].id] : [RIVALS[i % 3].id, RIVALS[(i + 1) % 3].id, RIVALS[(i + 2) % 3].id]));
const NAMES: Record<string, string> = { ChIJ_rivera_rooter_0001: 'Rivera Rooter & Drain', ChIJ_blueline_plumb_002: 'BlueLine Plumbing Co.', ChIJ_valley_drain_pro_03: 'Valley Drain Pros', [ME]: 'Copperline Plumbing' };
const worse = (k: number) => GRID.map((v, i) => (v === 0 ? 0 : i % 3 === 0 ? (v + k > 20 ? 0 : v + k) : v));
const scan = (o: Record<string, unknown> = {}) => {
  const ranks = (o.ranks as number[]) || GRID;
  return {
    id: 'scan-nov', phrase: 'plumber', kind: 'monthly', scanned_at: '2026-11-01T08:00:00.000Z', size: 7, spacing: 1, ranks,
    total: ranks.length, read: ranks.filter((v) => v != null).length, top3: top3(ranks), top10: ranks.filter((v) => v >= 1 && v <= 10).length,
    found: ranks.filter((v) => v > 0).length, out: ranks.filter((v) => v === 0).length, avg: 6.5,
    change: { top3: 3, since: '2026-10-22T17:00:00.000Z' },
    place_id: ME, tops: TOPS, rivals: RIVALS, center: { lat: 34.18, lng: -118.33 }, requests: { ids_only: 49, location: 1 }, cost_usd: 0.005, cost_words: 'half a cent',
    ...o,
  };
};
const hist = (id: string, phrase: string, kind: string, at: string, ranks: number[]) => ({ id, phrase, kind, scanned_at: at, size: 7, ranks, total: 49, top3: top3(ranks), found: ranks.filter((v) => v > 0).length, avg: 7.1, cost_usd: 0.005, cost_words: 'half a cent' });
const HISTORY = [
  hist('scan-nov', 'plumber', 'monthly', '2026-11-01T08:00:00.000Z', GRID),
  hist('scan-nov-e', 'emergency plumber', 'monthly', '2026-11-01T08:00:00.000Z', worse(4)),
  hist('scan-oct22', 'plumber', 'now', '2026-10-22T17:00:00.000Z', worse(3)),
  hist('scan-oct', 'plumber', 'monthly', '2026-10-01T08:00:00.000Z', worse(2)),
  hist('scan-sep', 'plumber', 'monthly', '2026-09-01T08:00:00.000Z', worse(3)),
];
const STUDIO = (over: Record<string, unknown> = {}) => ({ data: {
  ready: true, studio: true, enabled: true, phrases: ['plumber', 'emergency plumber'], size: 7, spacing: 1, next: 'Dec 1',
  latest: { plumber: scan(), 'emergency plumber': scan({ id: 'scan-nov-e', phrase: 'emergency plumber', ranks: worse(4), change: null }) },
  history: HISTORY,
  key: true, place: { id: ME, source: 'listing', confirmed_by: 'eric@studio.example', confirmed_at: '2026-10-01T00:00:00Z', maps: `https://www.google.com/maps/place/?q=place_id:${ME}` },
  suggested: null, last_result: { month: '2026-11', status: 'scanned', reason: null, at: '2026-11-01T08:00:00Z' },
  today: { used: 1, cap: 3 },
  prices: { as_of: '2026-11-12', source: 'https://developers.google.com/maps/billing-and-pricing/pricing', scan_usd: 0.005, scan_words: 'half a cent', hidden_usd: 0.037, hidden_words: '3½ cents', name_usd: 0.017, find_usd: 0.032 },
  ...over,
} });
// what a client's own view carries: no cost, no rivals, no place ids, no setup
const strip = (s: any) => { const { tops, rivals, center, requests, cost_usd, cost_words, place_id, ...rest } = s; return rest; };
const CLIENT = () => ({ data: { ready: true, studio: false, enabled: true, phrases: ['plumber', 'emergency plumber'], size: 7, spacing: 1, next: 'Dec 1',
  latest: { plumber: strip(scan()), 'emergency plumber': strip(scan({ id: 'scan-nov-e', phrase: 'emergency plumber', ranks: worse(4), change: null })) },
  history: HISTORY.map(({ cost_usd, cost_words, ...h }) => h) } });

async function openGrid(page: Page, first: unknown, o: { after?: unknown; find?: unknown } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const sent: Array<{ method: string; path: string; body: any }> = [];
  let data: any = first;
  await installApp(page, { api: PAGE_API as never });
  await page.route(/\/functions\/v1\/presence\/visibility\/maps(\/[a-z]+)?(\?.*)?$/, async (route: Route) => {
    const req = route.request(); const u = new URL(req.url()); const path = u.pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const method = req.method();
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/visibility/maps' && method === 'GET') return json(data);
    if (path === '/visibility/maps/names') {
      const ids = (u.searchParams.get('ids') || '').split(',');
      sent.push({ method, path, body: ids });
      return json({ data: { names: ids.map((id) => ({ id, name: NAMES[id] || null, address: id === ME ? '4410 W Olive Ave, Burbank' : '1 Main St, Burbank', maps: `https://maps.google.com/?cid=${id.length}` })), cost_words: '5 cents' } });
    }
    const body = req.postDataJSON(); sent.push({ method, path, body });
    if (path === '/visibility/maps/find') return json(o.find ?? { data: { query: 'Copperline Plumbing, 4410 W Olive Ave, Burbank, CA', found: [
      { id: ME, name: 'Copperline Plumbing', address: '4410 W Olive Ave, Burbank, CA 91505', kind: 'Plumber', maps: 'https://maps.google.com/?cid=1' },
      { id: 'ChIJ_copper_line_elec_02', name: 'Copper Line Electric', address: '233 E Magnolia Blvd, Burbank, CA 91502', kind: 'Electrician', maps: 'https://maps.google.com/?cid=2' },
    ], cost_words: '3 cents' } });
    if (o.after) data = o.after;
    if (path === '/visibility/maps/scan') return json({ data: scan({ id: 'scan-new', phrase: body.phrase, kind: 'now', ranks: worse(0) }) }, 201);
    return json({ data: { ok: true } });
  });
  await page.goto('/presence.html#search');
  await expect(page.locator('#view-search')).toBeVisible();
  return { errors, sent };
}
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};
const closeTip = async (page: Page) => { const got = page.getByRole('button', { name: 'Got it' }); if (await got.count()) await got.first().click().catch(() => {}); };

test.describe('The map rank grid (builder list item 185)', () => {
  test('the studio’s card: 49 spots in four bands, the numbers, who comes up ahead and the cost', async ({ page }) => {
    const { errors, sent } = await openGrid(page, STUDIO());
    const card = page.locator('#rgCard');
    await expect(card).toBeVisible();
    await expect(card.locator('#rgMeta')).toHaveText('Scanned Nov 1, 2026 · next scan Dec 1 · every month');
    await expect(card.locator('#rgLeft')).toHaveText('2 of 3 scans left today');
    const dots = card.locator('.rg-dots .rg-dot');
    await expect(dots).toHaveCount(49);
    await expect(card.locator('.rg-dot.top3')).toHaveCount(15);
    await expect(card.locator('.rg-dot.out')).toHaveCount(4);
    await expect(card.locator('.rg-dot.out').first()).toHaveText('20+');
    await expect(card.locator('.rg-dot.home')).toHaveText('1');
    await expect(card.locator('.rg-dots button.rg-cell').nth(0)).toHaveAttribute('aria-label', '3 miles north, 3 miles west: 9th');
    await expect(card.locator('.rg-big b')).toHaveText('15 of 49');
    await expect(card.locator('.rg-big .sv-chg.up [aria-hidden="true"]')).toHaveText('▲ 3 since Oct 22');
    await expect(card.locator('.rg-lead')).toHaveText('spots where Copperline Plumbing comes up in the top 3 on Google Maps for “plumber”');
    await expect(card.locator('.rg-two')).toContainText('Average place6.5');
    await expect(card.locator('.rg-two')).toContainText('Not in the top 204 spots');
    await expect(card.locator('.rg-rivals li')).toHaveCount(3);
    await expect(card.locator('.rg-rivals li').first()).toContainText('Rivera Rooter & Drain');   // names come from Google as the card opens
    await expect(card.locator('.rg-rivals li').first()).toContainText('#1 at 18 spots · top 3 at 31');
    expect(sent.filter((s) => s.path === '/visibility/maps/names').map((s) => s.body)).toContainEqual(RIVALS.map((r) => r.id));
    await expect(card.locator('.rg-cost')).toContainText('Only the studio sees this');
    await expect(card.locator('.rg-cost')).toContainText('This scan cost half a cent at Google’s prices');
    // a bar a month from that month's monthly scan: October is Oct 1's, not the Scan now of Oct 22
    await expect(card.locator('.rg-chart')).toHaveAttribute('aria-label', `Spots in the top 3, month by month: September ${top3(worse(3))}, October ${top3(worse(2))}, November 15`);
    expect(top3(worse(2))).not.toBe(top3(worse(3)));
    await expect(card.locator('.rg-mini')).toHaveCount(3);
    await expect(card.locator('.rg-tab[aria-pressed="true"]')).toHaveText('plumber · 15 in the top 3');
    await noSideScroll(page);
    expect(errors).toEqual([]);
  });

  test('a spot opens its top 3 there, named by Google, and opens in Google Maps', async ({ page }) => {
    await openGrid(page, STUDIO()); await closeTip(page);
    await page.locator('#rgCard .rg-dots button.rg-cell').nth(42).click();   // the south-west corner: not in the top 20
    const dlg = page.locator('dialog.sv-dlg');
    await expect(dlg.locator('h2')).toHaveText('3 miles south, 3 miles west');
    await expect(dlg).toContainText('Searching “plumber” here, Copperline Plumbing is not in the top 20.');
    await expect(dlg.locator('.rg-spot li')).toHaveCount(3);
    await expect(dlg.locator('.rg-spot li').first()).toContainText('Rivera Rooter & Drain');
    const open = dlg.getByRole('link', { name: 'Open this spot in Google Maps ↗' });
    const href = await open.getAttribute('href');
    expect(href).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/plumber\/@34\.13\d+,-118\.38\d+,14z$/);
    await expect(open).toHaveAttribute('target', '_blank');
  });

  test('Scan now scans the search shown, and the card follows; at three a day it rests', async ({ page }) => {
    const after = STUDIO({ today: { used: 3, cap: 3 } });
    const { sent } = await openGrid(page, STUDIO(), { after }); await closeTip(page);
    await page.locator('#rgCard .rg-tab', { hasText: 'emergency plumber' }).click();
    await expect(page.locator('#rgCard .rg-big b')).toHaveText(`${top3(worse(4))} of 49`);
    await page.locator('#btnRgScan').click();
    await expect(page.locator('.dds-toast, #toast').first()).toContainText('Scanned “emergency plumber”');
    expect(sent.find((s) => s.path === '/visibility/maps/scan')?.body).toEqual({ phrase: 'emergency plumber' });
    await expect(page.locator('#rgLeft')).toHaveText('0 of 3 scans left today');
    await expect(page.locator('#btnRgScan')).toBeDisabled();
  });

  test('settings: the business suggested from the listing, searches, the grid, then Save sends one change', async ({ page }) => {
    const first = STUDIO({ enabled: false, place: null, suggested: { id: ME, source: 'listing', maps: `https://www.google.com/maps/place/?q=place_id:${ME}` }, phrases: [], latest: {}, history: [] });
    const { sent } = await openGrid(page, first); await closeTip(page);
    const card = page.locator('#rgCard');
    await expect(card.locator('.rg-off')).toContainText('See where Copperline Plumbing comes up on Google Maps from 49 spots');
    await expect(card.locator('.rg-off')).toContainText('About half a cent a scan. Only you see the cost');
    await expect(page.locator('#btnRgScan')).toBeHidden();
    await card.getByRole('button', { name: 'Set it up' }).click();
    const dlg = page.locator('dialog.sv-dlg');
    await expect(dlg.locator('.rg-biz')).toContainText('From their Google listing');
    await expect(dlg.locator('.rg-biz b')).toHaveText('Copperline Plumbing');
    await expect(dlg.locator('.rg-biz')).toContainText('4410 W Olive Ave, Burbank');
    await dlg.getByRole('button', { name: 'Yes, that’s them' }).click();
    await expect.poll(() => sent.find((s) => s.path === '/visibility/maps/place')?.body).toEqual({ place_id: ME, source: 'listing' });
    await dlg.getByLabel('A search to scan, the way a customer would type it').fill('plumber');
    await dlg.getByRole('button', { name: 'Add', exact: true }).click();
    await dlg.getByLabel('A search to scan, the way a customer would type it').fill('water heater repair');
    await dlg.getByLabel('A search to scan, the way a customer would type it').press('Enter');
    await expect(dlg.locator('.rg-chip')).toHaveCount(2);
    await dlg.getByRole('button', { name: '5 × 5 · 25 spots' }).click();
    await dlg.getByRole('button', { name: '½ mile' }).click();
    await expect(dlg).toContainText('Covers 2 miles across, centred on the business.');
    await expect(dlg.locator('.rg-costbox')).toContainText('Each scan: 25 searches that only list places, free, and one look-up of where the business is, half a cent, or 3½ cents for a business that hides its address on Google. 2 searches a month: 1 cent.');
    await dlg.locator('#rgSwitch').check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => sent.find((s) => s.path === '/visibility/maps' && s.method === 'PUT')?.body).toEqual({ enabled: true, phrases: ['plumber', 'water heater repair'], size: 5, spacing: 0.5 });
  });

  test('finding the business by name: Google’s answers to pick from, and only the id is sent', async ({ page }) => {
    const { sent } = await openGrid(page, STUDIO({ enabled: false, place: null, suggested: null, latest: {}, history: [] })); await closeTip(page);
    await page.locator('#btnRgSettings').click();
    const settings = page.locator('dialog.sv-dlg').first();
    await settings.getByRole('button', { name: 'Find the business on Google' }).click();
    const find = page.locator('dialog.sv-dlg').last();
    await expect(find.locator('h2')).toHaveText('Which one is Copperline Plumbing?');
    await expect(find.locator('.rg-cand')).toHaveCount(2);
    await expect(find).toContainText('This search cost about 3 cents at Google’s prices.');
    await expect(find.getByRole('button', { name: 'Use this one' })).toBeDisabled();
    await find.locator('.rg-cand', { hasText: 'Copperline Plumbing' }).click();
    await find.getByRole('button', { name: 'Use this one' }).click();
    await expect.poll(() => sent.find((s) => s.path === '/visibility/maps/place')?.body).toEqual({ place_id: ME, source: 'search' });
    expect(sent.find((s) => s.path === '/visibility/maps/find')?.body).toEqual({ query: '' });   // the server starts from the name and address on file
  });

  test('an earlier scan shows in its place, and back to the newest', async ({ page }) => {
    await openGrid(page, STUDIO()); await closeTip(page);
    const card = page.locator('#rgCard');
    await card.locator('.rg-mini').nth(1).click();
    await expect(card.locator('.rg-past')).toContainText('Showing the scan of Oct 1, 2026.');
    await expect(card.locator('.rg-big b')).toHaveText(`${top3(worse(2))} of 49`);
    await expect(card.locator('.rg-cost')).toHaveCount(0);
    await expect(card.locator('.rg-dots button')).toHaveCount(0);   // a past scan is to look at; spots open on the newest
    await card.getByRole('button', { name: 'Back to the newest' }).click();
    await expect(card.locator('.rg-big b')).toHaveText('15 of 49');
    await card.getByRole('button', { name: 'Every scan ›' }).click();
    const dlg = page.locator('dialog.sv-dlg');
    await expect(dlg.locator('tbody tr')).toHaveCount(5);
    await expect(dlg.locator('tbody tr').nth(2)).toContainText('Scan now');
    await expect(dlg.locator('tbody tr').first()).toContainText('half a cent');
  });

  test('the client’s own view: the grid and its numbers, never a cost, a rival or the setup', async ({ page }) => {
    const { errors, sent } = await openGrid(page, CLIENT());
    const card = page.locator('#rgCard');
    await expect(card).toBeVisible();
    await expect(card.locator('#rgMeta')).toHaveText('Checked by your studio on Nov 1, 2026');
    await expect(card.locator('.rg-dots .rg-dot')).toHaveCount(49);
    await expect(card.locator('.rg-dots button')).toHaveCount(0);
    await expect(card.locator('.rg-lead')).toHaveText('spots where you come up in the top 3 on Google Maps for “plumber”');
    await expect(page.locator('#btnRgSettings')).toBeHidden();
    await expect(page.locator('#btnRgScan')).toBeHidden();
    await expect(card.locator('.rg-cost, .rg-rivals, .rg-hist-h .sv-linkbtn')).toHaveCount(0);
    await expect(card).not.toContainText('cent');
    expect(sent.filter((s) => s.path === '/visibility/maps/names')).toEqual([]);   // no names asked of Google for a client
    await noSideScroll(page);
    expect(errors).toEqual([]);
  });

  test('a business that hides its address on Google: the grid centres on its business details, and the cost says so', async ({ page }) => {
    const hidden = { requests: { ids_only: 49, location: 1, address: 1, from: 'address' }, cost_usd: 0.037, cost_words: '3½ cents' };
    await openGrid(page, STUDIO({ latest: { plumber: scan(hidden), 'emergency plumber': scan({ ...hidden, id: 'scan-nov-e', phrase: 'emergency plumber', ranks: worse(4), change: null }) } })); await closeTip(page);
    const card = page.locator('#rgCard');
    await expect(card.locator('.rg-cost')).toContainText('This scan cost 3½ cents at Google’s prices: 49 searches that only list places, free, and a look-up of the address in the business details, as Google hides this business’s address.');
    await page.locator('#btnRgSettings').click();
    const dlg = page.locator('dialog.sv-dlg');
    await expect(dlg.locator('.rg-biz')).toContainText('Google hides this business’s address, so the grid centres on the address in its business details.');
    await expect(dlg.locator('.rg-costbox')).toContainText('2 searches a month: 7½ cents.');
  });

  test('the client sees nothing while it is off', async ({ page }) => {
    await openGrid(page, { data: { ready: true, studio: false, enabled: false } });
    await expect(page.locator('#svTools, #seoTasks').first()).toBeAttached();
    await expect(page.locator('#rgCard')).toBeHidden();
  });

  test('every size fits the screen: no sideways scroll, and every spot is big enough to tap', async ({ page }) => {
    await openGrid(page, STUDIO()); await closeTip(page);
    const card = page.locator('#rgCard');
    await card.scrollIntoViewIfNeeded();
    await noSideScroll(page);
    const vw = page.viewportSize()!.width;
    const map = await card.locator('.rg-map').boundingBox();
    expect(map!.width).toBeLessThanOrEqual(vw);
    expect(Math.abs(map!.width - map!.height)).toBeLessThanOrEqual(2);   // the map stays square
    const dot = await card.locator('.rg-dots .rg-dot').first().boundingBox();
    expect(dot!.width).toBeGreaterThanOrEqual(vw < 761 ? 30 : 36);
    const cell = await card.locator('.rg-cell').first().boundingBox();
    expect(cell!.width).toBeGreaterThanOrEqual(vw < 761 ? 40 : 44);   // the spot's whole cell is the target's room
    if (vw < 761) {
      const side = await card.locator('.rg-side').boundingBox();
      expect(side!.y).toBeGreaterThan(map!.y + map!.height - 1);   // on a phone the numbers sit under the map
    }
  });
});

// ── follow-up (approved Nov 12): the grid in the monthly report. Settings › Monthly report gets an
// "On Google Maps" part, which waits (", off") until the grid is switched on, like AI answers.
const RCLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const RCTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, scope: { site_id: RCLIENT, name: 'Copperline Plumbing' } } };
const RSTATE = {
  enabled: true, note: '', last_month: null, last_result: null, tries: null, blocked: null, updated_by: null, updated_at: null, note_max: 600, next_month: '2026-11',
  pdf: true, ai_checks: false, ai_month: null, ai_result: null, ai_tries: null, ai_questions: 7, ai_cost: 'About 42 cents a month for 7 questions',
  parts_off: [], cc: [], copy_to: null, quiet_min: null, propose: { mode: 'off', text: '', pick: null, log: [] },
  to: 'sam@copperline.example', client_name: 'Sam Ortiz', me: 'eric@studio.example', cc_max: 4, cc_blocked: {}, quiet_default: 30, propose_max: 400,
  propose_next: null, propose_options: [],
};
async function openReportCard(page: Page, mapsOn: boolean) {
  const puts: Array<Record<string, unknown>> = [];
  let state: Record<string, unknown> = { ...RSTATE, maps_on: mapsOn };
  await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': RCTX } as never });
  await page.route(/\/functions\/v1\/presence\/report\/monthly$/, async (route: Route) => {
    if (route.request().method() === 'PUT') { const b = route.request().postDataJSON() as Record<string, unknown>; puts.push(b); state = { ...state, ...b }; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state }) });
  });
  await page.goto(`/settings.html?client=${RCLIENT}#report`);
  await expect(page.locator('#report')).toBeVisible();
  return puts;
}

test.describe('The map rank grid in the monthly report (builder list item 185)', () => {
  test('On Google Maps waits for the grid, says how to switch it on, and the last part that can show stays', async ({ page }) => {
    const puts = await openReportCard(page, false);
    const sec = page.locator('#report');
    const maps = sec.locator('#reportIn button').nth(3);
    await expect(maps).toHaveText('On Google Maps, off');
    await expect(maps).toHaveClass(/off/);
    await expect(maps).toHaveAttribute('aria-pressed', 'false');
    await maps.click();
    await expect(page.locator('.dds-toast').last()).toContainText('Switch the map rank grid on from this client’s Search tab');
    expect(puts).toEqual([]);
    // with the grid and the AI check both off, the last of the other seven can't go
    for (const p of ['Visits', 'Enquiries', 'On Google', 'Reviews', 'Website health', 'Most read pages']) { await sec.getByRole('button', { name: p, exact: true }).click(); await expect(sec.getByRole('button', { name: p, exact: true })).toHaveAttribute('aria-pressed', 'false'); }
    const before = puts.length;
    await sec.getByRole('button', { name: 'What changed', exact: true }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('Leave at least one part in the report.');
    expect(puts.length).toBe(before);
  });

  test('once the grid is on, On Google Maps is a part like the others', async ({ page }) => {
    const puts = await openReportCard(page, true);
    const maps = page.locator('#report #reportIn button').nth(3);
    await expect(maps).toHaveText('On Google Maps');
    await expect(maps).toHaveAttribute('aria-pressed', 'true');
    await maps.click();
    await expect(maps).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => puts[0]).toEqual({ parts_off: ['maps'] });
    await expect(page.locator('.dds-toast').last()).toContainText('On Google Maps is left out of the report.');
  });
});
