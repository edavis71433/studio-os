import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

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
  test('a live provider renders Connect; a planned one honestly says coming soon', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE() } });
    await page.goto('/connections.html');

    // THE bug: this button did not exist for any provider, for any customer.
    const connect = page.locator('#svc-google_search_console button[data-connect]');
    await expect(connect).toBeVisible();
    await expect(connect).toHaveText('Connect');
    await expect(page.locator('#svc-google_search_console .badge')).toHaveText('Not connected');

    // and a genuinely-unshipped provider still tells the truth rather than
    // offering a button that would dead-end
    await expect(page.locator('#svc-bing_webmaster button[data-connect]')).toHaveCount(0);
    await expect(page.locator('#svc-bing_webmaster')).toContainText('This one’s coming soon.');
  });

  test('an attention badge carries the REASON it needs attention', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE({
      connection: { status: 'expired', health: 'attention', last_sync_at: null, connected_at: null,
        reason: 'The permission lapsed on the service’s side. Reconnecting takes one tap and fixes it.' },
    }) } });
    await page.goto('/connections.html');
    await expect(page.locator('#svc-google_search_console .badge')).toHaveText('Needs a quick reconnect');
    // a badge with no reason beside it leaves "press Connect again and hope"
    await expect(page.locator('#svc-google_search_console .why'))
      .toContainText('The permission lapsed on the service’s side.');
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
