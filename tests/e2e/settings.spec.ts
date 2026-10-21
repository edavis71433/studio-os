import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Oct 2026 review: Settings is its own page ────────────────────────────────
// /presence.html#settings landed on the website builder, which waited on its
// whole read wave before it could switch views ("Setting the table…"). The nav
// now points at /settings.html: eight cards that route to where each thing
// already lives, plus the studio profile editable inline (GET/PUT /identity,
// the industry via /settings). The old hash keeps working as a deep link.
const IDENTITY = { data: { site_id: 's1', business_name: 'Davis Digital Studio', email: 'hello@example.com', phone: '', service_area: 'Burbank, CA', tagline: '', description: '', story: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '', updated_at: '2026-10-01T00:00:00Z' } };
// GET /connections answers the GROUPS shape (routes/connections.ts) — the card's
// status read `data.services` for a year and never rendered (studio audit bug 2).
const CONNECTIONS = { data: { edition: 'studio_os', note: '', groups: {
  'Google': [
    { key: 'google_analytics', label: 'Google Analytics', connection: { status: 'connected', health: 'ok' } },
    { key: 'google_search_console', label: 'Search Console', connection: { status: 'connected', health: 'ok' } },
    { key: 'google_business_profile', label: 'Business Profile', connection: { status: 'expired', health: 'attention' } },
  ],
  'Email': [{ key: 'resend', label: 'Email sending', connection: { status: 'disconnected', health: 'unknown' } }],
} } };
const API = {
  '/identity': IDENTITY,
  '/settings': { data: { industry_key: 'generic' } },
  '/connections': CONNECTIONS,
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-11-03T00:00:00Z', in_grace: false, has_service_billing: false } },
};
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
/** An agency member drilled into a client — the shell's context carries scope.name (what the "Viewing client" bar shows). */
const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' },
} };
const AGENCY_CTX = { data: { ...SCOPED_CTX.data, scope: undefined } };

test.describe('Settings page', () => {
  test('the shell’s Settings link points at the page, and the page loads in one go', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.locator('#dds-settings')).toHaveAttribute('href', '/settings.html');
    // the nine areas (Automations joined in Oct 2026 — benchmark item 6), each a link to where the thing lives
    const cards = page.locator('#cards .setcard');
    await expect(cards).toHaveCount(9);
    await expect(page.locator('[data-card="auto"]')).toHaveAttribute('href', '#automations');
    await expect(page.locator('[data-card="team"]')).toHaveAttribute('href', '/sharing.html');
    await expect(page.locator('[data-card="connections"]')).toHaveAttribute('href', '/connections.html');
    await expect(page.locator('[data-card="dev"]')).toHaveAttribute('href', '/developer.html');
    await expect(page.locator('[data-card="money"]')).toHaveAttribute('href', '/pipeline.html?services=1');
    await expect(page.locator('[data-card="domains"]')).toHaveAttribute('href', '/presence.html#domain');
    await expect(page.locator('[data-card="billing"]')).toHaveAttribute('href', '#billing');   // inline now — never the builder's Business view
    // the profile form is pre-filled from /identity — no second load, no loadline
    await expect(page.locator('#f-name')).toHaveValue('Davis Digital Studio');
    await expect(page.locator('#f-area')).toHaveValue('Burbank, CA');
    await expect(page.locator('#f-industry')).toHaveValue('generic');
    await expect(page.locator('#main')).not.toContainText('Setting the table');
    // quick statuses, never blockers
    await expect(page.locator('[data-card="connections"] .st')).toContainText('2 connected · 1 needs attention');
    await expect(page.locator('[data-card="billing"] .st')).toContainText('Studio · Active');
  });

  test('Save writes PUT /identity and PUT /settings (industry) with what was typed', async ({ page }) => {
    const puts: Array<{ path: string; body: unknown }> = [];
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      puts.push({ path: new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...IDENTITY.data, business_name: 'DDS', industry_key: 'web_design' } }) });
    });
    await page.goto('/settings.html');
    await expect(page.locator('#f-name')).toHaveValue('Davis Digital Studio');
    await page.locator('#f-name').fill('DDS');
    await page.locator('#f-phone').fill('555-0100');
    const opts = await page.locator('#f-industry option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const pick = opts.includes('web_design') ? 'web_design' : opts[1];
    await page.locator('#f-industry').selectOption(pick);
    await page.locator('#profileSave').click();
    await expect(page.locator('.dds-toast')).toContainText('Saved');
    expect(puts).toEqual([
      { path: '/identity', body: { business_name: 'DDS', email: 'hello@example.com', phone: '555-0100', service_area: 'Burbank, CA' } },
      { path: '/settings', body: { industry_key: pick } },
    ]);
  });

  // ── studio audit 2026-10, change 5: the plan lives on Settings ──────────────
  test('a self-serve plan: the inline section reads plan · status · renews, and Manage billing POSTs /commerce/portal then follows Stripe’s url', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/commerce/portal', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { url: '/help.html?from=billing-portal' } }) })
      : route.fallback());
    await page.goto('/settings.html');
    const sec = page.locator('#billing');
    await expect(sec).toBeVisible();
    await expect(sec.getByRole('heading', { level: 2, name: 'Plan & billing' })).toBeVisible();
    await expect(page.locator('#planLine')).toHaveText('Studio · Active · renews Nov 3');
    await expect(page.locator('#planLimits')).toHaveCount(0);          // not an agency: no limits line
    await expect(page.locator('#planTeam')).toHaveCount(0);            // self-serve: the button, not the sentence
    const btn = page.locator('#manageBilling');
    await expect(btn).toHaveText('Manage billing');
    await expect(page.locator('#billing button')).toHaveCount(1);      // ONE action
    const posted = page.waitForRequest((r) => r.method() === 'POST' && /\/commerce\/portal$/.test(new URL(r.url()).pathname));
    await btn.click();
    expect((await posted).postDataJSON()).toEqual({});
    await expect(page).toHaveURL(/\/help\.html\?from=billing-portal/);
  });

  test('the Agency plan: the limits line from /agency/usage, no button, and the sentence that changes go through our team', async ({ page }) => {
    const seen: string[] = [];
    page.on('request', (r) => { if (/\/functions\/v1\/presence\//.test(r.url())) seen.push(new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '')); });
    await installApp(page, { api: { ...API, '/portal/context': AGENCY_CTX,
      '/commerce/subscription': { data: { plan: 'agency', plan_name: 'Agency', status: 'active', can_manage_billing: false, current_period_end: '2026-11-03T00:00:00Z', in_grace: false, has_service_billing: true } },
      '/agency/usage': { data: { plan: 'agency', seats: { used: 1, limit: 3 }, clients: { used: 4, active: 3, archived: 1, limit: 10 }, editions: {}, publishes_30d: 2 } },
    } });
    await page.goto('/settings.html');
    await expect(page.locator('#planLine')).toHaveText('Agency · Active · renews Nov 3');
    await expect(page.locator('#planLimits')).toHaveText('3 of 10 clients · 1 of 3 seats');   // active clients, not archived ones
    await expect(page.locator('#billing button')).toHaveCount(0);
    await expect(page.locator('#planTeam')).toContainText('Changes to your Agency plan go through our team.');
    await expect(page.locator('#planTeam a')).toHaveAttribute('href', /^mailto:support@davisdigitalstudio\.com\?subject=/);
    await expect(page.locator('#billing .aside')).toContainText('billed separately');
    await expect(page.locator('[data-card="billing"] .st')).toHaveText('Agency · Active');
    expect(seen).toContain('/agency/usage');
  });

  test('a paused plan keeps the page’s own words and offers Update payment', async ({ page }) => {
    await installApp(page, { api: { ...API, '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'paused', can_manage_billing: true, current_period_end: '2026-11-03T00:00:00Z', in_grace: true } } } });
    await page.goto('/settings.html');
    await expect(page.locator('#planLine')).toContainText('Studio · Paused — payment needs attention');
    await expect(page.locator('#planLine')).toContainText('a payment didn’t go through — your site stays up while you fix it');
    await expect(page.locator('#planLine')).not.toContainText('renews');
    await expect(page.locator('#manageBilling')).toHaveText('Update payment');
    await expect(page.locator('[data-card="billing"] .st')).toHaveClass(/warn/);
  });

  test('the Plan & billing card opens the inline section; #billing deep-links to it', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await page.locator('[data-card="billing"]').click();
    await expect(page.locator('#billing')).toBeVisible();
    await expect(page).toHaveURL(/settings\.html$/);                   // handled on the page, no hash hop
    await page.goto('/settings.html#billing');
    await expect(page.locator('#billing')).toBeVisible();
    await expect(page.locator('#planLine')).toHaveText('Studio · Active · renews Nov 3');
  });

  test('Domain & email: platform staff keep the operators-only view, even drilled in', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': { data: { ...SCOPED_CTX.data, is_operator: true } } } });
    await page.goto('/settings.html?client=' + CLIENT);
    await expect(page.locator('[data-card="domains"]')).toHaveAttribute('href', '/admin-health.html');
    await expect(page.locator('[data-card="domains"]')).toHaveAttribute('data-noscope', '1');
  });

  // ── scope honesty while drilled in (?client=) ───────────────────────────────
  test('drilled into a client, the page says whose settings these are and every card either carries the client or says it leaves them', async ({ page }) => {
    const seen: Array<[string, string]> = [];
    page.on('request', (r) => { if (/\/functions\/v1\/presence\//.test(r.url())) seen.push([new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), r.headers()['x-dds-scope-site'] || '']); });
    await installApp(page, { api: { ...API, '/portal/context': SCOPED_CTX, '/identity': { data: { ...IDENTITY.data, business_name: 'Marlow’s Kitchen' } } } });
    await page.goto('/settings.html?client=' + CLIENT);
    // the title and the heading name the client; the profile section says it is theirs
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings — Marlow’s Kitchen');
    await expect(page).toHaveTitle('Settings — Marlow’s Kitchen — Studio OS');
    await expect(page.locator('#profileHead')).toHaveText('Marlow’s Kitchen’s profile');
    await expect(page.locator('#profileNote')).toContainText('These are Marlow’s Kitchen’s details, not your studio’s');
    await expect(page.locator('[data-card="studio"] b')).toHaveText('Marlow’s Kitchen’s profile');
    await expect(page.locator('#f-name')).toHaveValue('Marlow’s Kitchen');
    await expect(page.locator('label[for="f-name"]')).toHaveText('Business name');
    await expect(page.locator('label[for="f-area"]')).toHaveText('Where they work from');
    // the cards that act on a site carry the client
    await expect(page.locator('[data-card="team"]')).toHaveAttribute('href', '/sharing.html?client=' + CLIENT);
    await expect(page.locator('[data-card="connections"]')).toHaveAttribute('href', '/connections.html?client=' + CLIENT);
    await expect(page.locator('[data-card="notify"]')).toHaveAttribute('href', '/inbox.html?client=' + CLIENT);
    await expect(page.locator('[data-card="domains"]')).toHaveAttribute('href', '/presence.html?client=' + CLIENT + '#domain');
    for (const k of ['team', 'connections', 'notify', 'domains']) await expect(page.locator(`[data-card="${k}"]`)).not.toHaveAttribute('data-noscope', /./);
    // the developer tools are the studio's: the card stays unscoped and says so
    await expect(page.locator('[data-card="dev"]')).toHaveAttribute('href', '/developer.html');
    await expect(page.locator('[data-card="dev"]')).toHaveAttribute('data-noscope', '1');
    await expect(page.locator('[data-card="dev"] b')).toHaveText('Your studio’s developer tools');
    await expect(page.locator('[data-card="dev"]')).toContainText('leaves the client');
    // the studio's own plan never shows inside a client
    await expect(page.locator('[data-card="billing"]')).toHaveCount(0);
    await expect(page.locator('#billing')).toBeHidden();
    await expect(page.locator('[data-card="connections"] .st')).toContainText('2 connected · 1 needs attention');
    expect(seen.map(([p]) => p)).not.toContain('/commerce/subscription');
    expect(seen.map(([p]) => p)).not.toContain('/agency/usage');
    expect(seen.filter(([p, scope]) => p === '/identity' && scope !== CLIENT)).toEqual([]);   // the profile read IS the client's
  });

  test('cards a plan or role does not include are left out; the billing card is owner-only', async ({ page }) => {
    const ctx = { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'cms_only', edition_name: 'CMS', edition_features: ['website', 'forms'],
      is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish'],
      landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
    } };
    await installApp(page, { api: { ...API, '/portal/context': ctx } });
    await page.goto('/settings.html?client=' + CLIENT);
    await expect(page.locator('[data-card="studio"]')).toBeVisible();
    await expect(page.locator('[data-card="domains"]')).toBeVisible();
    await expect(page.locator('[data-card="team"]')).toHaveCount(0);        // no client_portal / invite
    await expect(page.locator('[data-card="connections"]')).toHaveCount(0); // no 'connected'
    await expect(page.locator('[data-card="dev"]')).toHaveCount(0);
    await expect(page.locator('[data-card="billing"]')).toHaveCount(0);     // scoped into a client: never the studio's own billing
  });

  test('the old /presence.html#settings deep link still opens the builder’s Business view — and before the data lands', async ({ page }) => {
    const PRESENCE_API = {
      '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
      '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
      '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
      '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
      '/moments': { data: [] }, '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, updated_at: null, updated_by: null } },
      '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
    };
    await installApp(page, { api: PRESENCE_API });
    // hold the slowest read of the wave: the page must NOT sit on Today's loadline meanwhile
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/media', async (route) => { await held; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }); });
    await page.goto('/presence.html#settings');
    await expect(page.locator('#view-business')).toBeVisible();
    await expect(page.locator('#view-today')).toBeHidden();
    release();
    await expect(page.locator('#view-business')).toBeVisible();
  });
});

// ── Three switches, not a workflow builder (benchmark 2026-10, item 6) ────────
// Acknowledge new enquiries · remind unpaid invoices −7/due/+N · nudge me on a
// quiet deal — each default off, each showing the exact sentence it sends, each
// saving itself to /settings the moment it is flipped. Plus the per-stage
// "stale after" (item 13). The studio's own; never shown while scoped.
test.describe('Settings — automations', () => {
  const SAVED = { industry_key: 'generic', auto_ack_enquiries: true, invoice_reminders: true, invoice_remind_after_days: 5, deal_nudges: false, deal_nudge_days: 7, stage_stale_days: { proposal: 7 } };
  /** record every PUT and answer it the way the route does: the whole row, with the patch applied */
  const puts = async (page: import('@playwright/test').Page, base: Record<string, unknown>) => {
    const out: Array<{ path: string; body: Record<string, unknown> }> = [];
    const row = { ...base };
    await page.route('**/functions/v1/presence/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON();
      out.push({ path: new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body });
      Object.assign(row, body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...row } }) });
    });
    return out;
  };

  test('the card opens the section: three switches, all off by default, each with the sentence it will send', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await page.locator('[data-card="auto"]').click();
    await expect(page.locator('#automations')).toBeVisible();
    await expect(page.locator('#automations [role="switch"]')).toHaveCount(3);
    for (const id of ['sw-ack', 'sw-inv', 'sw-deal']) await expect(page.locator('#' + id)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#say-ack')).toHaveText('Thanks for getting in touch — we’ve got your message and will reply within one business day.');
    await expect(page.locator('#say-inv')).toContainText('Just a friendly nudge: the invoice for $1,250.00 is still open.');
    await expect(page.locator('#say-deal')).toHaveText('This deal has had no next step for 3 days — a quick follow-up keeps it moving.');
    await expect(page.locator('#n-inv')).toHaveValue('2');
    await expect(page.locator('#n-deal')).toHaveValue('3');
  });

  test('a saved row paints on; flipping a switch PUTs just that field and the sentence follows N', async ({ page }) => {
    await installApp(page, { api: { ...API, '/settings': { data: SAVED } } });
    const sent = await puts(page, SAVED);
    await page.goto('/settings.html#automations');
    await expect(page.locator('#sw-ack')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#sw-inv')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#sw-deal')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#n-inv')).toHaveValue('5');
    await expect(page.locator('#n-inv-echo')).toHaveText('5');
    await expect(page.locator('#say-deal')).toHaveText('This deal has had no next step for 7 days — a quick follow-up keeps it moving.');
    await expect(page.locator('#st-proposal')).toHaveValue('7');
    await expect(page.locator('#st-lead')).toHaveValue('');
    await page.locator('#sw-deal').click();
    await expect(page.locator('#sw-deal')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.dds-toast')).toContainText('Saved');
    await page.locator('#sw-inv').click();
    await expect.poll(() => sent.length).toBe(2);
    await page.locator('#n-deal').fill('10');
    await page.locator('#n-deal').press('Tab');
    await expect(page.locator('#say-deal')).toHaveText('This deal has had no next step for 10 days — a quick follow-up keeps it moving.');
    await expect.poll(() => sent.length).toBe(3);
    await page.locator('#st-lead').fill('21');
    await page.locator('#st-lead').press('Tab');
    await expect.poll(() => sent.map((p) => p.body)).toEqual([
      { deal_nudges: true },
      { invoice_reminders: false },
      { deal_nudge_days: 10 },
      { stage_stale_days: { proposal: 7, lead: 21 } },
    ]);
    expect(sent.every((p) => p.path === '/settings')).toBe(true);
  });

  test('a refused save flips the switch back and says so', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/settings', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"write_failed","message":"That didn’t save — nothing was changed. Please try again."}' }) : route.fallback());
    await page.goto('/settings.html#automations');
    await page.locator('#sw-ack').click();
    await expect(page.locator('.dds-toast')).toContainText('didn’t save');
    await expect(page.locator('#sw-ack')).toHaveAttribute('aria-checked', 'false');
  });

  test('drilled into a client the studio’s switches stay out of sight', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': SCOPED_CTX } });
    await page.goto('/settings.html?client=' + CLIENT + '#automations');
    await expect(page.locator('[data-card="auto"]')).toHaveCount(0);
    await expect(page.locator('#automations')).toBeHidden();
  });
});
