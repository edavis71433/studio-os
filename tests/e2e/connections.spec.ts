import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── connections.html + connections-callback.html ─────────────────────────────
// The "Search Console circle": Eric pressed Connect Search Console and came
// back to where he started, three separate times over.
//   • no provider was ever 'read_only', so NO card had a Connect button;
//   • the operator-for-a-client OAuth flow could not complete, because the
//     return leg dropped the client scope the connect leg had signed against;
//   • and every failure collapsed into the same 2.6-second toast, so none of
//     it was legible.
// These tests hold the three doors open.

// One card per state. `availability` mirrors inventory.ts STATUS_PLAIN, which is
// what the page keys off (it is the registry `status`, humanised).
const SURFACE = (over: Record<string, unknown> = {}) => ({ data: {
  edition: 'presence_monitor',
  note: 'Connect the services you already use — read-only, always with your approval, and yours to disconnect any time.',
  groups: {
    'Being found': [
      {
        key: 'google_search_console', label: 'how you show up in Google Search',
        purpose: 'See which searches bring people to you, and whether Google can find your pages.',
        reads: ['the searches that lead to you'], approval: 'You approve access on the provider’s sign-in screen.',
        availability: 'Read-only',
        connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' },
        data: null,
        ...over,
      },
      {
        key: 'bing_webmaster', label: 'how you show up in Bing',
        purpose: 'The same visibility picture for Bing.',
        reads: ['search terms and clicks on Bing'], approval: 'You paste a read-only key you control.',
        availability: 'Planned',
        connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' },
        data: null,
      },
    ],
  },
} });

test.describe('Connections — the Connect button exists at all', () => {
  test('a live provider renders Connect; a planned one honestly says there is nothing to connect yet', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE() } });
    await page.goto('/connections.html');

    // THE bug: this button did not exist for any provider, for any customer.
    const connect = page.locator('#svc-google_search_console button[data-connect]');
    await expect(connect).toBeVisible();
    await expect(connect).toHaveText('Connect');
    await expect(page.locator('#svc-google_search_console .chip.status')).toHaveText('Not connected');

    // and a genuinely-unshipped provider still tells the truth rather than
    // offering a button that would dead-end
    await expect(page.locator('#svc-bing_webmaster button[data-connect]')).toHaveCount(0);
    await expect(page.locator('#svc-bing_webmaster')).toContainText('Nothing to connect yet.');
  });

  test('an attention badge carries the REASON it needs attention', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE({
      connection: { status: 'expired', health: 'attention', last_sync_at: null, connected_at: null,
        reason: 'The permission lapsed on the service’s side. Reconnecting takes one tap and fixes it.' },
    }) } });
    await page.goto('/connections.html');
    await expect(page.locator('#svc-google_search_console .chip.status')).toHaveText('Needs a quick reconnect');
    // a badge with no reason beside it leaves "press Connect again and hope"
    await expect(page.locator('#svc-google_search_console .why'))
      .toContainText('The permission lapsed on the service’s side.');
  });
});

// ── the refresh anatomy: crumb · title + chips · a warning band · rows · rail ──
test.describe('Connections — the refreshed page says what is connected, and what needs you', () => {
  const MIXED = () => { const s = SURFACE({
    connection: { status: 'expired', health: 'attention', last_sync_at: '2026-10-12T09:00:00Z', connected_at: '2026-08-02T00:00:00Z',
      reason: 'The permission lapsed on the service’s side. Reconnecting takes one tap and fixes it.' },
  }); (s.data.groups as Record<string, unknown[]>)['Your numbers'] = [{
    key: 'google_analytics', label: 'your visitor numbers', purpose: 'Understand how many people visit and what they look at — in plain numbers.',
    reads: ['visitors and page views'], approval: 'You approve access on the provider’s sign-in screen.', availability: 'Read-only',
    connection: { status: 'connected', health: 'ok', last_sync_at: '2026-10-19T16:20:00Z', connected_at: '2026-09-30T00:00:00Z', reason: '' },
    property: { id: '1', name: 'Bacchus Kitchen', auto_selected: true }, data: { visitors: 512, pageviews: 2100, as_of: '2026-10-19T16:20:00Z' },
  }]; return s; };

  test('crumb, title chips and the warning band are derived from the rows — and Reconnect in the band is the row’s own action', async ({ page }) => {
    await installApp(page, { api: { '/connections': MIXED() } });
    await page.goto('/connections.html');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Settings');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]')).toHaveText('Connections');
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible();
    // 1 ok + 1 attention + 1 planned → the two counts, nothing invented
    await expect(page.locator('#counts .chip')).toHaveText(['1 connected', '1 needs attention']);
    // the band names the row and the reason, and its button is the SAME connect action
    const band = page.locator('#attention');
    await expect(band).toContainText('How you show up in Google Search needs attention.');
    await expect(band).toContainText('The permission lapsed on the service’s side.');
    await expect(band.locator('button[data-connect="google_search_console"]')).toHaveText('Reconnect');
    // the row itself: icon · sentence-cased name · one-line meaning · chip · action
    const row = page.locator('#svc-google_search_console');
    await expect(row.locator('.t > b')).toHaveText('How you show up in Google Search');
    await expect(row.locator('.t > span').first()).toHaveText('See which searches bring people to you, and whether Google can find your pages.');
    await expect(row.locator('.chip.status')).toHaveText('Needs a quick reconnect');
    await expect(row.locator('button[data-connect]')).toHaveText('Reconnect');
    // grouped exactly as the server groups them
    await expect(page.locator('.col-main .sec-h h2')).toHaveText(['Being found', 'Your numbers']);
  });

  test('a connected row folds Refresh and Disconnect behind Manage; the rail lists what each connection reads and when it was read', async ({ page }) => {
    await installApp(page, { api: { '/connections': MIXED() } });
    await page.goto('/connections.html');
    const row = page.locator('#svc-google_analytics');
    await expect(row.locator('.chip.status')).toHaveText('Connected');
    await expect(row).toContainText('512 recent visitors');
    const manage = row.getByRole('button', { name: 'Manage' });
    await expect(manage).toHaveAttribute('aria-expanded', 'false');
    await expect(row.locator('[data-refresh]')).toBeHidden();
    await manage.click();
    await expect(manage).toHaveAttribute('aria-expanded', 'true');
    await expect(row.locator('[data-refresh]')).toBeVisible();
    await expect(row.locator('[data-disc]')).toBeVisible();
    await expect(row.locator('#more-google_analytics')).toContainText('visitors and page views');
    // the rail: only the CONNECTED rows, with what they read; activity from the rows' own timestamps
    const what = page.locator('.col-rail .card').first();
    await expect(what).toContainText('What connecting does');
    await expect(what.locator('.tl li')).toHaveCount(1);
    await expect(what.locator('.tl li')).toContainText('Your visitor numbers');
    await expect(what.locator('.tl li')).toContainText('Reads visitors and page views.');
    const activity = page.locator('.col-rail .card').nth(1);
    await expect(activity).toContainText('Recent activity');
    await expect(activity.locator('.tl li').first()).toContainText('Read your visitor numbers');
    await expect(activity.locator('.tl li').first()).toContainText('Oct 19');
    await expect(activity).toContainText('Connected your visitor numbers');
  });

  test('nothing connected → no band, an honest header chip, and an empty-but-true rail', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE() } });
    await page.goto('/connections.html');
    await expect(page.locator('#counts .chip')).toHaveText(['Nothing connected yet']);
    await expect(page.locator('#attention')).toHaveCount(0);
    await expect(page.locator('.col-rail .card').first()).toContainText('Nothing is connected yet.');
    await expect(page.locator('.col-rail .card').nth(1)).toContainText('Nothing yet');
    // the concierge still lives on the page (its endpoint and ids unchanged)
    await expect(page.locator('#cq')).toBeVisible();
    await expect(page.locator('#cask')).toHaveText('Ask');
  });

  test('no serious/critical axe violations (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: { '/connections': MIXED() } });
    await page.goto('/connections.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#svc-google_analytics')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});

test.describe('Connections — failures say what went wrong, and stay said', () => {
  test('a 503 names the missing secrets inline, and does not evaporate', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE() } });
    await page.route('**/functions/v1/presence/connections/google_search_console/connect', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: 'not_available',
        message: 'Google Search Console isn’t switched on yet — it needs its Google Search Console app registered and three Supabase Edge Function secrets set.',
        missing: ['CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID', 'CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET', 'CONNECTION_ENC_KEY'],
        redirect_uri: 'https://davisdigitalstudio.com/connections-callback.html',
      }) }));
    await page.goto('/connections.html');
    await page.locator('#svc-google_search_console button[data-connect]').click();

    const prob = page.locator('#prob-google_search_console');
    await expect(prob).toContainText('isn’t switched on yet');
    // the exact secret names — Eric is the owner; he is the one who can set them
    await expect(prob).toContainText('CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID');
    await expect(prob).toContainText('CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET');
    await expect(prob).toContainText('CONNECTION_ENC_KEY');
    await expect(prob).toContainText('https://davisdigitalstudio.com/connections-callback.html');
    // a toast would have been gone by now; an action item must not be
    await page.waitForTimeout(3200);
    await expect(prob).toBeVisible();
    // and the button is usable again, not stuck on "One moment…"
    await expect(page.locator('#svc-google_search_console button[data-connect]')).toBeEnabled();
  });

  test('no_site 404 says "open a client first" and offers the door — not "refresh in a moment"', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/connections', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'no_site', message: 'No Presence site is set up for this account yet.' }) }));
    await page.goto('/connections.html');
    await expect(page.getByRole('heading', { name: 'Open a client first.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pick a client from Studio →' })).toHaveAttribute('href', '/agency.html');
    // the copy that sent him round the loop — refreshing can never fix a no_site
    await expect(page.getByText('Please refresh in a moment.')).toHaveCount(0);
  });
});

// ── GA4: the property choice ─────────────────────────────────────────────────
// A Google account usually holds SEVERAL GA4 properties; the numbers are
// meaningless until exactly one is chosen. Connected-with-a-choice says which;
// connected-without-one asks, from the account's real list; every failure state
// is inline and honest (the page's problem-panel idiom, never a 2.6s toast).
test.describe('Connections — Google Analytics chooses its property', () => {
  const GA_SURFACE = (over: Record<string, unknown> = {}) => ({ data: {
    edition: 'presence_monitor',
    note: 'Connect the services you already use.',
    groups: { 'Your numbers': [{
      key: 'google_analytics', label: 'your visitor numbers',
      purpose: 'Understand how many people visit and what they look at — in plain numbers.',
      reads: ['visitors and page views'], approval: 'You approve access on the provider’s sign-in screen.',
      availability: 'Read-only',
      connection: { status: 'connected', health: 'ok', last_sync_at: null, connected_at: '2026-08-01T00:00:00Z', reason: '' },
      property: null, data: null,
      ...over,
    }] },
  } });
  const PROPS = (list: Array<{ id: string; name: string; account?: string }>) =>
    ({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { properties: list, selected: null, note: list.length ? 'Pick the property that measures this website.' : 'That Google account has no Google Analytics property yet — connect the account that owns this website’s Analytics, or create the property first.' } }) });

  test('the registry flip: Google Analytics renders a Connect button at all', async ({ page }) => {
    await installApp(page, { api: { '/connections': GA_SURFACE({ connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' } }) } });
    await page.goto('/connections.html');
    const connect = page.locator('#svc-google_analytics button[data-connect]');
    await expect(connect).toBeVisible();
    await expect(connect).toHaveText('Connect');
    await expect(page.locator('#svc-google_analytics')).not.toContainText('Nothing to connect yet.');
  });

  test('MANY properties → "Which property is this website?" with the real list; picking one records it', async ({ page }) => {
    let picked = '';
    await installApp(page, { api: { '/connections': GA_SURFACE() } });
    await page.route('**/functions/v1/presence/connections/google_analytics/properties', (route) =>
      route.fulfill(PROPS([{ id: '313646501', name: 'Bacchus Kitchen', account: 'Davis Digital Studio' }, { id: '313646502', name: 'davisdigitalstudio.com', account: 'Davis Digital Studio' }])));
    await page.route('**/functions/v1/presence/connections/google_analytics/property', async (route) => {
      picked = JSON.parse(route.request().postData() || '{}').property_id || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { selected: { id: '313646501', name: 'Bacchus Kitchen' }, message: 'Reading Bacchus Kitchen from here on.' } }) });
    });
    await page.goto('/connections.html');
    await expect(page.getByText('Which property is this website?')).toBeVisible();
    const btn = page.locator('#pick-google_analytics button[data-gaprop="313646501"]');
    await expect(btn).toContainText('Bacchus Kitchen');
    await btn.click();
    await expect.poll(() => picked).toBe('313646501');
  });

  test('ONE property (auto-selected server-side) → the card says which, and that it was automatic', async ({ page }) => {
    await installApp(page, { api: { '/connections': GA_SURFACE({ property: { id: '313646501', name: 'Bacchus Kitchen', auto_selected: true }, data: { visitors: 512, pageviews: 2100, as_of: '2026-08-09T07:30:00Z' } }) } });
    await page.goto('/connections.html');
    const card = page.locator('#svc-google_analytics');
    await expect(card).toContainText('Reading the Bacchus Kitchen property');
    await expect(card).toContainText('picked automatically');
    // no picker when the choice is made
    await expect(page.locator('#pick-google_analytics')).toHaveCount(0);
    // and the numbers flow, plainly
    await expect(card).toContainText('512 recent visitors');
  });

  test('ZERO properties → an honest dead-end sentence, nothing to press', async ({ page }) => {
    await installApp(page, { api: { '/connections': GA_SURFACE() } });
    await page.route('**/functions/v1/presence/connections/google_analytics/properties', (route) => route.fulfill(PROPS([])));
    await page.goto('/connections.html');
    await expect(page.locator('#pick-google_analytics'))
      .toContainText('That Google account has no Google Analytics property yet');
    await expect(page.locator('#pick-google_analytics button')).toHaveCount(0);
  });

  test('a failed property list → inline failure that stays put, not a toast', async ({ page }) => {
    await installApp(page, { api: { '/connections': GA_SURFACE() } });
    await page.route('**/functions/v1/presence/connections/google_analytics/properties', (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed', message: 'We couldn’t list the properties just now.' }) }));
    await page.goto('/connections.html');
    const box = page.locator('#pick-google_analytics');
    await expect(box).toContainText('We couldn’t list that account’s Analytics properties just now');
    await page.waitForTimeout(3200);   // a toast would be gone; this must not be
    await expect(box).toContainText('Nothing changed');
  });

  test('a rejected pick → the server’s reason lands in the problem panel; the button recovers', async ({ page }) => {
    await installApp(page, { api: { '/connections': GA_SURFACE() } });
    await page.route('**/functions/v1/presence/connections/google_analytics/properties', (route) =>
      route.fulfill(PROPS([{ id: '1', name: 'A' }, { id: '2', name: 'B' }])));
    await page.route('**/functions/v1/presence/connections/google_analytics/property', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'bad_request', message: 'That property isn’t on the connected Google account. Pick one from the list — or reconnect with the account that owns it.' }) }));
    await page.goto('/connections.html');
    const btn = page.locator('#pick-google_analytics button[data-gaprop="1"]');
    await btn.click();
    await expect(page.locator('#prob-google_analytics')).toContainText('isn’t on the connected Google account');
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('A');
  });

  test('the 503 names the GA-specific Google Cloud steps (scope + the two APIs)', async ({ page }) => {
    await installApp(page, { api: { '/connections': GA_SURFACE({ connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' } }) } });
    await page.route('**/functions/v1/presence/connections/google_analytics/connect', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: 'not_available',
        message: 'Google Analytics isn’t switched on yet — it needs its Google Analytics app registered and three Supabase Edge Function secrets set: CONNECTED_GOOGLE_ANALYTICS_CLIENT_ID, CONNECTED_GOOGLE_ANALYTICS_CLIENT_SECRET, CONNECTION_ENC_KEY. The app’s redirect URI must be https://davisdigitalstudio.com/connections-callback.html. The same Google Cloud app Search Console uses works here — add the https://www.googleapis.com/auth/analytics.readonly scope to its consent screen, and enable the Google Analytics Data API and Google Analytics Admin API on the project. Nothing is wrong with your account; this is a one-time setup on the Studio side.',
        missing: ['CONNECTED_GOOGLE_ANALYTICS_CLIENT_ID', 'CONNECTED_GOOGLE_ANALYTICS_CLIENT_SECRET', 'CONNECTION_ENC_KEY'],
        redirect_uri: 'https://davisdigitalstudio.com/connections-callback.html',
      }) }));
    await page.goto('/connections.html');
    await page.locator('#svc-google_analytics button[data-connect]').click();
    const prob = page.locator('#prob-google_analytics');
    await expect(prob).toContainText('CONNECTED_GOOGLE_ANALYTICS_CLIENT_ID');
    await expect(prob).toContainText('analytics.readonly');
    await expect(prob).toContainText('Google Analytics Data API');
    await expect(prob).toContainText('Google Analytics Admin API');
  });
});

test.describe('Connections — the operator connects FOR a client', () => {
  const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

  test('the connect leg scopes the call and remembers which client it was for', async ({ page }) => {
    let sentScope = '';
    await installApp(page, { api: { '/connections': SURFACE() } });
    await page.route('**/functions/v1/presence/connections/google_search_console/connect', (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'] || '';
      // land on the callback WITHOUT a code, so it stops at its early bail and
      // leaves the remembered scope intact for us to inspect (a completed
      // callback deliberately clears it)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        mode: 'oauth', authorize_url: '/connections-callback.html', state: 'xyz',
      } }) });
    });
    await page.goto(`/connections.html?client=${CLIENT}`);
    await page.locator('#svc-google_search_console button[data-connect]').click();
    await page.waitForURL(/connections-callback\.html/);

    expect(sentScope).toBe(CLIENT);
    // the state was signed against THIS client's site; the return leg is on a
    // bare redirect URI, so the scope has to survive the round trip
    expect(await page.evaluate(() => localStorage.getItem('dds-pending-scope'))).toBe(CLIENT);
    // even the abandoned path exits back to the CLIENT's page, never the bare
    // /connections.html that 404s for an operator
    await expect(page.getByRole('link', { name: 'Back to your connections' }))
      .toHaveAttribute('href', `/connections.html?client=${CLIENT}`);
  });

  test('the callback replays the scope, and the way out carries ?client= (the loop)', async ({ page }) => {
    let sentScope: string | undefined = undefined;
    await installApp(page);
    await page.addInitScript((c) => {
      localStorage.setItem('dds-pending-connection', 'google_search_console');
      localStorage.setItem('dds-pending-label', 'how you show up in Google Search');
      localStorage.setItem('dds-pending-scope', c as string);
    }, CLIENT);
    await page.route('**/functions/v1/presence/connections/google_search_console/callback', (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { connected: true, message: 'Connected.' } }) });
    });
    await page.goto('/connections-callback.html?code=abc&state=xyz');
    await expect(page.locator('#card h1')).toHaveText('Connected.');

    // without this header the server resolves a DIFFERENT site from the JWT:
    // no_site 404 for an operator who owns none, or bad_state 400 on mismatch
    expect(sentScope).toBe(CLIENT);
    // and the exit must not land on the bare /connections.html that 404s — that
    // was the literal circle
    await expect(page.getByRole('link', { name: 'Back to your connections' }))
      .toHaveAttribute('href', `/connections.html?client=${CLIENT}`);
  });

  test('the callback renders the SERVER’s reason, not a generic shrug', async ({ page }) => {
    await installApp(page);
    await page.addInitScript(() => {
      localStorage.setItem('dds-pending-connection', 'google_search_console');
      localStorage.setItem('dds-pending-label', 'how you show up in Google Search');
    });
    await page.route('**/functions/v1/presence/connections/google_search_console/callback', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
        error: 'bad_state',
        message: 'That connection couldn’t be verified, so nothing was connected. Usually the approval screen was left open too long (there’s a 10-minute window) — start again from the same client’s Connections page and it will go through.',
      }) }));
    await page.goto('/connections-callback.html?code=abc&state=stale');
    await expect(page.getByText('the approval screen was left open too long')).toBeVisible();
    // the message the page used to show for all four distinct server errors
    await expect(page.getByText('Please try connecting again from your presence.')).toHaveCount(0);
  });
});

// ── Speak as the studio when acting for a client (studio audit Oct 2026, change 2) ──
// The row's "About" panel told a scoped operator "Who owns it: you do. It's your
// account and your permission" — the owner's sentence, in the studio's hands.
// Scoped in, the row now says who is connecting for whom; the owner's own page
// keeps its words.
test.describe('Connections — the row speaks as the studio when scoped into a client', () => {
  const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const SCOPED_CTX = { data: {
    site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
    edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
    capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
    scope: { site_id: CLIENT, name: 'Joe’s Plumbing' },
  } };

  test('scoped: "You connect this for <client> with a Google account that has access to their property."', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE(), '/portal/context': SCOPED_CTX } });
    await page.goto(`/connections.html?client=${CLIENT}`);
    await expect(page.locator('#dds-ctxbar')).toContainText('Joe’s Plumbing');
    const row = page.locator('#svc-google_search_console');
    await row.getByRole('button', { name: 'About' }).click();
    const more = row.locator('#more-google_search_console');
    await expect(more).toBeVisible();
    await expect(more).toContainText('You connect this for Joe’s Plumbing with a Google account that has access to their property.');
    await expect(more).not.toContainText('Who owns it: you do');
  });

  test('un-scoped: the owner still reads "Who owns it: you do"', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE() } });
    await page.goto('/connections.html');
    const row = page.locator('#svc-google_search_console');
    await row.getByRole('button', { name: 'About' }).click();
    const more = row.locator('#more-google_search_console');
    await expect(more).toContainText('Who owns it: you do. It’s your account and your permission');
    await expect(more).not.toContainText('You connect this for');
  });
});
