import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// SS2 (standards sweep) — the Agency roster wears the redesign anatomy: shared
// .lhead with ↻ refresh under REQ_SEQ, fixed-view chips, sortable typed columns
// behind a persisted Table ⇄ Cards toggle, caret-preserving search, honest
// failure states (a failed portfolio read is NEVER "No clients yet"), one-POST
// starter-kit actions, and ?client= carried on every drill.
//
// The portfolio fixtures below match the REAL /agency/portfolio row shape —
// buildPortfolio() in supabase/functions/presence/agency/portfolio.ts returns
// site_id/name/edition/status/archived/tags/domain/domain_registrar/
// domain_expires_at/leads_waiting/search_issues/billing_issue/attention/… and
// routes.ts wraps rows as { data: [...] }.
const soon = new Date(Date.now() + 12 * 86400_000).toISOString();   // ~12 days out → "expires in Nd"
const nearer = new Date(Date.now() + 5 * 86400_000).toISOString();  // ~5 days out
const far = new Date(Date.now() + 200 * 86400_000).toISOString();   // far future → not "expiring"

const row = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', status: 'ready',
  archived: false, tags: [], owner: 'owner@studio.example', assigned: [], has_notes: false,
  domain: null, domain_registrar: null, domain_expires_at: null,
  moments: 0, criticals: 0, open_opportunities: 0, plans_waiting: 0, drafts_waiting: 0,
  leads_waiting: 0, files_pending: 0, search_issues: 0, billing_issue: false,
  attention: 0, review_open: false, migration: null,
  last_published_at: '2026-07-01T00:00:00Z', unpublished_changes: false, last_change_at: null,
  ...over,
});
const MARLOW = row({ site_id: 'a1', name: 'Marlow’s Kitchen', attention: 4, leads_waiting: 2,
  domain: 'marlows.example.com', domain_registrar: 'GoDaddy.com, LLC', domain_expires_at: soon,
  search_issues: 1, billing_issue: true, plans_waiting: 1 });
const DENTAL = row({ site_id: 'a2', name: 'Bright Dental', domain: 'brightdental.example.com', domain_expires_at: far });
const CEDAR = row({ site_id: 'a3', name: 'Cedar Garage', leads_waiting: 1,
  domain: 'cedargarage.example.com', domain_expires_at: nearer });

const agencyApi = {
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: [MARLOW, DENTAL, CEDAR] },
  '/agency/queues': { data: { queues: [
    { key: 'high_priority', title: 'High priority', items: [
      { site_id: 'a1', name: 'Marlow’s Kitchen', why: 'SSL certificate is missing' },
    ] },
  ], patterns: [] } },
  '/agency/kits': { data: [] },
  // the FIX 7 delivery map: Marlow has a delivery project, the others don't
  '/studio/customers': { data: [
    { client_id: 'c1', customer_site_id: 'a1', project_id: 'p1', name: 'Marlow’s Kitchen' },
  ] },
};

// The display default is viewport-driven (small → cards); pin one BEFORE page
// scripts run so tests behave the same across all three projects. (set only when
// absent — the persistence test needs the user's own choice to survive reload)
const pinDisplay = (page: Page, v: 'table' | 'cards') =>
  page.addInitScript((val) => { try { if (!localStorage.getItem('dds-display:agency')) localStorage.setItem('dds-display:agency', val); } catch { /* denied */ } }, v);

const PF_RE = /\/functions\/v1\/presence\/agency\/portfolio/;
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const boom = (status = 500) => ({ status, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });

test.describe('Agency portfolio', () => {
  test('boots under the roster anatomy: .lhead, ONE h1, lmeta count — zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Your clients' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.lhead .lmeta')).toContainText('3 businesses · Updated just now');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    await expect(page.locator('.top .brand')).toContainText('Bright Studio');
    expect(errors).toEqual([]);
  });

  test('table view renders the typed columns from the real portfolio payload', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const table = page.locator('.tscroll table');
    for (const th of ['Name', 'Edition', 'Status', 'Waiting', 'Leads', 'Domain']) {
      await expect(table.locator('thead')).toContainText(th);
    }
    const marlow = table.locator('tbody tr', { hasText: 'Marlow’s Kitchen' });
    await expect(marlow).toContainText('presence');
    await expect(marlow.locator('.pill')).toContainText('ready');
    await expect(marlow.locator('.badge')).toContainText('4 waiting');
    await expect(marlow.locator('td.num')).toHaveText('2');            // leads_waiting
    await expect(marlow).toContainText('marlows.example.com');
    await expect(marlow.locator('.domln .exp')).toContainText('expires in');
    // bits that have no column of their own still surface under the name
    await expect(marlow.locator('.bits')).toContainText('1 search issue · billing needs a look');
    const dental = table.locator('tbody tr', { hasText: 'Bright Dental' });
    await expect(dental.locator('.badge')).toContainText('all clear');
    await expect(dental.locator('.bits')).toHaveCount(0);
    // Marlow has a delivery project → the secondary action rides the row
    await expect(marlow.locator('.rowact')).toHaveText('Manage their website');
    await expect(dental.locator('.rowact')).toHaveCount(0);
  });

  test('cards view keeps the original at-a-glance card (badge + status bits)', async ({ page }) => {
    await pinDisplay(page, 'cards');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const marlow = page.locator('.client', { hasText: 'Marlow’s Kitchen' });
    await expect(marlow.locator('.badge')).toContainText('4 waiting');
    await expect(marlow).toContainText('2 leads waiting');
    await expect(marlow).toContainText('domain expires in');
    await expect(marlow).toContainText('GoDaddy');
    await expect(marlow).toContainText('billing needs a look');
    await expect(page.locator('.client', { hasText: 'Bright Dental' }).locator('.badge')).toContainText('all clear');
  });

  test('sorting: header clicks toggle order with aria-sort; the lmeta names the sort', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    // default: Name ascending
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Name');
    await expect(page.locator('tbody tr').first()).toContainText('Bright Dental');
    await expect(page.locator('.lmeta')).toContainText('Sorted by Name — ascending');
    // Leads reads most-first on its first click (numeric, like files' Size)
    await page.locator('.thb', { hasText: 'Leads' }).click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Leads');
    await expect(page.locator('tbody tr .n').first()).toHaveText('Marlow’s Kitchen');   // 2 leads
    await expect(page.locator('.lmeta')).toContainText('Sorted by Leads — descending');
    await page.locator('.thb', { hasText: 'Leads' }).click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Leads');
    await expect(page.locator('tbody tr .n').first()).toHaveText('Bright Dental');      // 0 leads
  });

  test('fixed-view chips filter correctly and carry aria-pressed', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    await expect(page.locator('[data-view="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.locator('[data-view="attention"]').click();
    await expect(page.locator('[data-view="attention"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-view="all"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('Marlow’s Kitchen');
    await page.locator('[data-view="domain"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(2);   // Marlow (12d) + Cedar (5d); Dental's is far out
    await expect(page.locator('tbody')).toContainText('Cedar Garage');
    await page.locator('[data-view="billing"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('Marlow’s Kitchen');
    await page.locator('[data-view="clear"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);   // Cedar's expiring domain keeps it out of All clear
    await expect(page.locator('tbody tr')).toContainText('Bright Dental');
    await expect(page.locator('.lmeta')).toContainText('1 business ·');
  });

  test('domain-expiring threshold matches the platform alert window (45d): a ~40d-out client is "expiring", never "all clear"', async ({ page }) => {
    // The platform's canonical domain-expiring alert fires at days <= 45 with
    // severity critical (optimization/providers.ts:27, catalog.ts) — so a 31-45d
    // client must NOT sit in "All clear" while the queues panel calls it High
    // priority. This pins the roster to the platform's window, red against the
    // old de<=30 code.
    await pinDisplay(page, 'table');
    const fern = row({ site_id: 'a6', name: 'Fern Florist', domain: 'fern.example.com',
      domain_expires_at: new Date(Date.now() + 40 * 86400_000).toISOString() });   // 31-45d: the contradiction window
    await installApp(page, { api: { ...agencyApi, '/agency/portfolio': { data: [MARLOW, DENTAL, CEDAR, fern] } } });
    await page.goto('/agency.html');
    await page.locator('[data-view="domain"]').click();
    await expect(page.locator('tbody')).toContainText('Fern Florist');   // 40d ≤ 45 → in "Domain expiring"
    await expect(page.locator('tbody tr')).toHaveCount(3);               // Marlow ~12d + Cedar ~5d + Fern ~40d
    await page.locator('[data-view="clear"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);               // Bright Dental (~200d) alone…
    await expect(page.locator('tbody')).not.toContainText('Fern Florist'); // …a 31-45d domain is NOT "all clear"
  });

  test('search-issues-only clients surface in "Needs attention" (they are platform-flagged), never in "All clear"', async ({ page }) => {
    // A client with attention=0 but search_issues>0 used to appear ONLY in "All"
    // — invisible in every focused view. They're platform-flagged, so "Needs
    // attention" must include them; "All clear" already excluded them (kept).
    await pinDisplay(page, 'table');
    const quarry = row({ site_id: 'a7', name: 'Quiet Quarry', search_issues: 2 });   // attention 0, search issues only
    await installApp(page, { api: { ...agencyApi, '/agency/portfolio': { data: [MARLOW, DENTAL, CEDAR, quarry] } } });
    await page.goto('/agency.html');
    await page.locator('[data-view="attention"]').click();
    await expect(page.locator('tbody')).toContainText('Quiet Quarry');   // platform-flagged → visible in the focused view
    await expect(page.locator('tbody tr')).toHaveCount(2);               // Marlow (attention 4) + Quarry (search issues only)
    await page.locator('[data-view="clear"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);               // Bright Dental alone…
    await expect(page.locator('tbody')).not.toContainText('Quiet Quarry'); // …open search issues are never "all clear"
  });

  test('search re-renders never destroy the input, its caret POSITION, or focus (the L bug)', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const q = page.locator('#search');
    await q.click();
    await q.pressSequentially('marl', { delay: 40 });   // every keystroke re-renders #main
    await page.keyboard.press('ArrowLeft');   // park the caret INSIDE the value…
    await page.keyboard.press('ArrowLeft');   // …at index 2 (a collapsed selection)
    await expect(q).toBeFocused();            // the SAME control still holds focus…
    await expect(q).toHaveValue('marl');      // …the typed value survived every swap…
    const caret = await q.evaluate((el) => ({ s: (el as HTMLInputElement).selectionStart, e: (el as HTMLInputElement).selectionEnd }));
    expect(caret).toEqual({ s: 2, e: 2 });    // …and so did the caret position
    // and the filter really applied — one roster row left (table or cards),
    // scoped to rows because the kit-card selects legitimately list every client
    const rows = page.locator('tbody tr[data-open], button.client');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Marlow’s Kitchen');
  });

  test('failed portfolio read: couldn’t-load + Try-again refetches — NEVER "No clients yet"', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    let calls = 0;
    await page.route(PF_RE, (route) => {
      calls++;
      if (calls === 1) return route.fulfill(boom());
      return route.fulfill(ok(agencyApi['/agency/portfolio']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('We couldn’t load your portfolio just now.');
    await expect(page.locator('#main')).not.toContainText('No clients yet');   // failure ≠ empty
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    expect(calls).toBe(2);   // Try-again really refetched
  });

  test('a genuinely EMPTY portfolio still earns the honest first-run copy', async ({ page }) => {
    await installApp(page, { api: { ...agencyApi, '/agency/portfolio': { data: [] } } });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('No clients yet — add businesses from your studio tools.');
  });

  test('↻ refresh soft-fails: a failed refresh keeps the list (leads.html contract)', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    let calls = 0;
    await page.route(PF_RE, (route) => {
      calls++;
      if (calls > 1) return route.fulfill(boom());
      return route.fulfill(ok(agencyApi['/agency/portfolio']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    await page.locator('#refreshBtn').click();
    await page.waitForTimeout(300);   // give a wrong implementation time to wipe the page
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');   // list kept
    await expect(page.locator('#main')).not.toContainText('We couldn’t load your portfolio just now.');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('a STALE slower portfolio response never paints over a newer one (REQ_SEQ)', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    let calls = 0;
    await page.route(PF_RE, async (route) => {
      calls++;
      if (calls === 2) { await new Promise((r) => setTimeout(r, 1200)); return route.fulfill(ok({ data: [row({ site_id: 's1', name: 'StaleCo' })] })); }
      if (calls === 3) return route.fulfill(ok({ data: [row({ site_id: 'f1', name: 'FreshCo' })] }));
      return route.fulfill(ok(agencyApi['/agency/portfolio']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    await page.locator('#refreshBtn').click();   // read #2 departs — the server answers SLOWLY
    await page.locator('#refreshBtn').click();   // read #3 — answers fast
    await expect(page.locator('#main')).toContainText('FreshCo');
    await page.waitForTimeout(1400);             // read #2 resolves late — it must be DROPPED
    await expect(page.locator('#main')).toContainText('FreshCo');
    await expect(page.locator('#main')).not.toContainText('StaleCo');
  });

  test('saving a starter kit fires exactly ONE POST per click (the duplicate-listener bug)', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    let posts = 0;
    await page.route(/\/functions\/v1\/presence\/agency\/kits$/, (route) => {
      if (route.request().method() === 'POST') { posts++; return route.fulfill(ok({ data: { id: 'k' + posts, name: 'Kit ' + posts } })); }
      return route.fulfill(ok({ data: [] }));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    await page.locator('#kitFromSite').selectOption('a1');
    await page.locator('#kitName').fill('Contractor Starter');
    await page.locator('#kitSave').click();
    await expect(page.locator('.dds-toast')).toContainText('Kit saved.');
    expect(posts).toBe(1);
    // the second save is where the old page double-POSTed (loadKits re-attached
    // its listener to the same button after every save)
    await page.locator('#kitFromSite').selectOption('a2');
    await page.locator('#kitName').fill('Dental Starter');
    await page.locator('#kitSave').click();
    await expect.poll(() => posts).toBe(2);   // NOT 3
    await page.waitForTimeout(250);           // give any duplicate listener time to fire
    expect(posts).toBe(2);
  });

  test('display toggle: persists to localStorage and restores on reload (aria-pressed)', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    await expect(page.locator('.tscroll')).toBeVisible();
    await expect(page.locator('#dispTable')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#dispCards').click();
    await expect(page.locator('.client').first()).toBeVisible();
    await expect(page.locator('.tscroll')).toHaveCount(0);
    await expect(page.locator('#dispCards')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('dds-display:agency'))).toBe('cards');
    await page.reload();
    await expect(page.locator('.client').first()).toBeVisible();   // the choice survived the reload
    await expect(page.locator('#dispCards')).toHaveAttribute('aria-pressed', 'true');
  });

  test('small screens default to Cards; large screens to Table', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const small = (page.viewportSize()?.width || 1280) < 760;
    await expect(page.locator(small ? '.client' : '.tscroll').first()).toBeVisible();
  });

  test('row drill-ins carry the client scope (SC-1): delivery project + plain record', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    // Marlow has a delivery project → project drill WITH minted client scope
    await page.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).click();
    await page.waitForURL(/crm\.html\?project=p1&tab=delivery&client=a1/);
    await page.goBack();
    // Dental has no project → client-record drill, scope carried
    await page.locator('tbody tr', { hasText: 'Bright Dental' }).click();
    await page.waitForURL(/crm\.html\?client=a2/);
  });

  test('keyboard: Enter on a focused row opens the drill-in', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    await page.locator('tbody tr', { hasText: 'Bright Dental' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/crm\.html\?client=a2/);
  });

  test('work queues render as rail-cards whose rows carry ?client=', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const q = page.locator('#queues');
    await expect(q.locator('.qhead')).toContainText('What needs you today');
    await expect(q.locator('.rcard .rh')).toContainText('High priority');
    const link = q.locator('.rrows a').first();
    await expect(link).toContainText('SSL certificate is missing');
    await expect(link).toHaveAttribute('href', '/today.html?client=a1');
  });

  test('queues failure surfaces honestly (never silent absence) and Try again refetches', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    let calls = 0;
    await page.route(/\/functions\/v1\/presence\/agency\/queues/, (route) => {
      calls++;
      if (calls === 1) return route.fulfill(boom());
      return route.fulfill(ok(agencyApi['/agency/queues']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#queues')).toContainText('Your queues wouldn’t load just now');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');   // the roster is not held hostage
    await page.locator('#qretry').click();
    await expect(page.locator('#queues .rcard .rh')).toContainText('High priority');
    expect(calls).toBe(2);
  });

  test('dark theme resolves --warn/--good from the shell tokens (the old page hand-copied a dark block without them)', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    const probe = (v: string) => page.evaluate((tok) => {
      const el = document.createElement('span');
      el.style.color = `var(${tok})`;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    }, v);
    expect(await probe('--warn')).toBe('rgb(211, 172, 110)');   // --dds-warn dark, not the light #775d31
    expect(await probe('--good')).toBe('rgb(139, 191, 159)');   // --dds-good dark
    expect(await probe('--warn-soft')).toBe('rgb(42, 35, 22)'); // the soft pair follows too
  });

  test('non-agency accounts are turned away, not shown an empty portfolio', async ({ page }) => {
    await installApp(page);
    // registered AFTER installApp so it takes precedence (Playwright matches last-added first)
    await page.route('**/functions/v1/presence/agency/me', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('This isn’t an agency account.');
    await expect(page.locator('.client')).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
});
