import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 200 (Nov 15 2026), what clients receive (review file 06, findings 60 and 61):
//   · the monthly report waits until the website is live, and the client's card and the
//     studio's list say so instead of promising next month;
//   · a hand-over kit file asks for a fresh link when it is tapped, so it still opens long
//     after Help was opened, and says plainly when it can't.
// The pitch and review pages' half (finding 62) is in pitch-pack.spec.ts and
// public-pages.spec.ts. Fake names only.

const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const FILE = '11111111-2222-4333-8444-555555555555';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};

// ══ the monthly report waits for the website ══
const SCOPED_CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, scope: { site_id: CLIENT, name: 'Maple Street Studio' } } };
const AGENCY_CTX = { data: { ...SCOPED_CTX.data, scope: null } };
const STATE = {
  enabled: true, note: '', last_month: null, last_result: null, tries: null, blocked: null, updated_by: null, updated_at: null, note_max: 600, next_month: '2026-11',
  pdf: true, ai_checks: false, ai_month: null, ai_result: null, ai_tries: null, ai_questions: 7, ai_cost: 'About 42 cents a month for 7 questions',
  parts_off: [], cc: [], copy_to: null, quiet_min: null, propose: { mode: 'off', text: '', pick: null, log: [] },
  to: 'sam@maple.example', client_name: 'Sam Ortiz', me: 'eric@studio.example', cc_max: 4, cc_blocked: {}, quiet_default: 30, propose_max: 400,
  propose_next: null, propose_options: [], live: false,
};
async function openCard(page: Page, over: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = { ...JSON.parse(JSON.stringify(STATE)), ...over };
  await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': SCOPED_CTX } as never });
  await page.route(/\/functions\/v1\/presence\/report\/monthly$/, async (route) => {
    if (route.request().method() === 'PUT') { state = { ...state, ...(route.request().postDataJSON() as Record<string, unknown>) }; return route.fulfill(json({ data: state })); }
    return route.fulfill(json({ data: state }));
  });
  await page.goto(`/settings.html?client=${CLIENT}#report`);
  await expect(page.locator('#report')).toBeVisible();
}

test.describe('The monthly report waits until the website is live (item 200)', () => {
  test('switched on during the build: the card says it is waiting, not a date', async ({ page }) => {
    await openCard(page);
    const sec = page.locator('#report');
    await expect(sec.locator('#reportNext')).toHaveText('Waits for the site to go live');
    await expect(sec.locator('#reportNext')).toHaveClass(/wait/);
    await expect(sec.locator('#reportLast')).toHaveText('Waiting for their website to go live. The first report goes out early in the month after it does.');
    await expect(sec).not.toContainText('Next one:');
    await noSideScroll(page);
  });

  test('off before the site is live: it says it can be switched on now, and the toast says when the first one goes', async ({ page }) => {
    await openCard(page, { enabled: false });
    const sec = page.locator('#report');
    await expect(sec.locator('#reportLast')).toHaveText('Their website isn’t live yet. Switch this on now if you like: the report waits until it is.');
    await expect(sec.locator('#reportNext')).toHaveText('');
    await sec.locator('#sw-report').click();
    await expect(page.locator('.dds-toast').last()).toContainText('On. The first report goes out the month after their website goes live.');
    await expect(sec.locator('#reportNext')).toHaveText('Waits for the site to go live');
  });

  test('a month skipped because the site wasn’t live says so once it is live, and the date comes back', async ({ page }) => {
    await openCard(page, { live: true, last_month: '2026-10', last_result: { month: '2026-10', status: 'skipped', reason: 'not_live', at: '2026-11-01T09:00:00Z' } });
    const sec = page.locator('#report');
    await expect(sec.locator('#reportLast')).toHaveText('The October 2026 report wasn’t sent: the website wasn’t live yet.');
    await expect(sec.locator('#reportNext')).toHaveText('Next one: December 4 to 6 · to 1 person');
    await expect(sec.locator('#reportNext')).not.toHaveClass(/wait/);
  });

  test('a server without the news reads as live, as before', async ({ page }) => {
    const { live: _gone, ...older } = STATE;
    await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': SCOPED_CTX } as never });
    await page.route(/\/functions\/v1\/presence\/report\/monthly$/, (route) => route.fulfill(json({ data: older })));
    await page.goto(`/settings.html?client=${CLIENT}#report`);
    await expect(page.locator('#reportNext')).toHaveText('Next one: December 4 to 6 · to 1 person');
  });

  test('the studio’s list: a client still being built waits, and a skipped month says why', async ({ page }) => {
    const ROWS = [
      { site_id: CLIENT, name: 'Maple Street Studio', who: 'Sam', email: 'sam@maple.example', enabled: true, blocked: null, more: 0, copy: false, propose: 'off', last: null, live: false },
      { site_id: OTHER, name: 'Bluebird Bakery', who: 'Jo', email: 'jo@bluebird.example', enabled: false, blocked: null, more: 0, copy: false, propose: 'off', last: { month: '2026-10', status: 'skipped', reason: 'not_live' }, live: false },
    ];
    await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': AGENCY_CTX } as never });
    await page.route(/\/functions\/v1\/presence\/agency\/monthly-reports$/, (route) => route.fulfill(json({ data: { rows: ROWS, can_change: true } })));
    await page.route(/\/functions\/v1\/presence\/report\/monthly$/, (route) => route.fulfill(json({ data: { enabled: true } })));
    await page.goto('/settings.html#reports');
    const sec = page.locator('#reports');
    await expect(sec.locator(`[data-report="${CLIENT}"] .rpill`)).toHaveText('Waits for the site to go live');
    await expect(sec.locator(`[data-report="${CLIENT}"] .rpill`)).toHaveClass(/wait/);
    await expect(sec.locator(`[data-report="${OTHER}"] .rpill`)).toHaveText('October · site wasn’t live');
    await sec.locator(`[data-report="${OTHER}"]`).getByRole('switch').click();
    await expect(page.locator('.dds-toast').last()).toContainText('On. Bluebird Bakery gets a report the month after their website goes live.');
    await noSideScroll(page);
  });
});

// ══ a hand-over kit file opens whenever it is tapped ══
const CLIENT_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
  sees_full_workspace: true, is_client_portal: false, is_managed_client: true, capabilities: ['view_all'],
  landing: '/client.html', attention_count: 0, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
  studio: { name: 'Bright Studio', logo_url: null },
} };
const KIT = { data: {
  contact: { name: 'Sam at Bright Studio', email: 'hello@bright.example', phone: '(555) 010-4477', hours: 'Weekdays 9 to 5' },
  guides: [], videos: [],
  files: [{ id: FILE, name: 'Brand colours and fonts', mime: 'application/pdf', url: 'https://files.example/when-help-opened?download=Brand' }],
  website: { address: 'https://harbordental.example', live_since: '2026-10-03T09:00:00Z', domain: 'harbordental.example', domain_expires_at: '2027-03-14T00:00:00Z' },
} };
async function openHelp(page: Page, answer: (route: import('@playwright/test').Route) => unknown) {
  const fetched: string[] = [], asked: string[] = [];
  await installApp(page, { api: {
    '/portal/context': CLIENT_CTX,
    '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
    '/client/projects': { data: [] }, '/client/notifications': { data: [], unread_count: 0 },
    '/client/faq': { data: { html: '', faq: { items: [] } } },
    '/client/kit': KIT,
  } });
  await page.route('**/functions/v1/presence/client/kit/files/**', (route) => { asked.push(new URL(route.request().url()).pathname.replace(/^.*\/presence/, '')); return answer(route) as Promise<void>; });
  // the storage's signed links: a download, so the portal stays where it is
  await page.route('https://files.example/**', (route) => { fetched.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="Brand colours and fonts.pdf"' }, body: '%PDF-1.4 test' }); });
  await page.goto('/client.html#help');
  await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();
  return { fetched, asked };
}

test.describe('Hand-over kit files open whenever they are tapped (item 200)', () => {
  test('a tap asks for a fresh link and downloads it; the portal stays put', async ({ page }) => {
    const { fetched, asked } = await openHelp(page, (route) => route.fulfill(json({ data: { url: 'https://files.example/fresh?download=Brand', name: 'Brand colours and fonts', mime: 'application/pdf' } })));
    const link = page.locator('#sec-kit').getByRole('link', { name: /Brand colours and fonts/ });
    await expect(link).toHaveAttribute('data-kit-file', FILE);
    await link.click();
    await expect.poll(() => fetched).toEqual(['https://files.example/fresh?download=Brand']);
    expect(asked).toEqual([`/client/kit/files/${FILE}`]);
    await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();   // a download, not a page change
    await noSideScroll(page);
  });

  test('a file taken out of the kit since says so, and nothing opens', async ({ page }) => {
    const { fetched } = await openHelp(page, (route) => route.fulfill(json({ error: 'not_in_kit', message: 'That file isn’t in your kit any more.' }, 404)));
    await page.locator('#sec-kit').getByRole('link', { name: /Brand colours and fonts/ }).click();
    await expect(page.getByText('That file isn’t in your kit any more.')).toBeVisible();
    expect(fetched).toEqual([]);
  });

  test('storage not answering says to try again in a moment', async ({ page }) => {
    const { fetched } = await openHelp(page, (route) => route.fulfill(json({ error: 'unavailable', message: 'That file couldn’t open just now. Try again in a moment.' }, 502)));
    await page.locator('#sec-kit').getByRole('link', { name: /Brand colours and fonts/ }).click();
    await expect(page.getByText('That file couldn’t open just now. Try again in a moment.')).toBeVisible();
    expect(fetched).toEqual([]);
  });

  test('a server without the route yet: the link that came with the list is used', async ({ page }) => {
    const { fetched } = await openHelp(page, (route) => route.fulfill(json({ error: 'not_found' }, 404)));
    await page.locator('#sec-kit').getByRole('link', { name: /Brand colours and fonts/ }).click();
    await expect.poll(() => fetched).toEqual(['https://files.example/when-help-opened?download=Brand']);
  });
});
