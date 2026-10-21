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
    // Phase 1 overhaul: every row carries "Open record" (the hub) + "Their website"
    await expect(marlow.locator('.rowact')).toHaveText(['Open record', 'Their website', '⋯']);   // ⋯ = tags · owner · note · archive (Oct 2026)
    await expect(dental.locator('.rowact')).toHaveText(['Open record', 'Their website', '⋯']);
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

  test('/agency/me failure recovery: Try again re-runs the FULL boot — real agency name, queues mounted', async ({ page }) => {
    // trouble()'s Try-again used to call load() alone: after a failed /agency/me,
    // a succeeding portfolio read rendered with ME=null placeholders ("Your
    // agency") and the queues cockpit never mounted. The retry must re-run the
    // whole boot path (me + load + mounts).
    await installApp(page, { api: agencyApi });
    let meCalls = 0;
    await page.route('**/functions/v1/presence/agency/me', (route) => {
      meCalls++;
      if (meCalls === 1) return route.fulfill(boom());
      return route.fulfill(ok(agencyApi['/agency/me']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('We couldn’t load your portfolio just now.');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');          // the roster recovered…
    await expect(page.locator('.top .brand')).toContainText('Bright Studio');       // …with the REAL agency name, not "Your agency"
    await expect(page.locator('#queues .rcard .rh')).toContainText('High priority'); // …and the queues cockpit mounted
    expect(meCalls).toBe(2);   // the retry really re-ran /agency/me
  });

  test('a genuinely EMPTY portfolio still earns the honest first-run copy', async ({ page }) => {
    await installApp(page, { api: { ...agencyApi, '/agency/portfolio': { data: [] }, '/studio/customers': { data: [] } } });   // nothing on either list
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('No clients yet.');
    await expect(page.locator('#main').getByRole('button', { name: '+ Add a customer' })).toBeVisible();   // onboarding lives on the home page now
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
    await page.waitForURL(/crm\.html\?project=p1&client=a1/);
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
    await expect(q.locator('.qhead')).toContainText('Needs you');
    await expect(q.locator('.rcard .rh')).toContainText('High priority');
    const link = q.locator('.rrows a').first();
    await expect(link).toContainText('SSL certificate is missing');
    await expect(link).toHaveAttribute('href', '/today.html?client=a1');
  });

  test('soft ↻ re-reads the queues panel too, not just the roster (request-count pin)', async ({ page }) => {
    // ↻ used to wire only load(true); mountQueues ran at boot and via its own
    // Try-again, so a morning's stale cockpit survived every refresh click.
    await installApp(page, { api: agencyApi });
    let qcalls = 0;
    await page.route(/\/functions\/v1\/presence\/agency\/queues/, (route) => {
      qcalls++;
      return route.fulfill(ok(agencyApi['/agency/queues']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#queues .rcard .rh')).toContainText('High priority');
    expect(qcalls).toBe(1);                    // boot mounted the cockpit once
    await page.locator('#refreshBtn').click();
    await expect.poll(() => qcalls).toBe(2);   // ↻ re-read the queues as well
    await expect(page.locator('#queues .rcard .rh')).toContainText('High priority');   // and it still renders
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

// ── Oct 2026 studio audit, change 3: ONE home, ONE roster ─────────────────────
// agency.html is the page the agency lands on: the studio's own money, This week
// and Key deals (today.html's, read from the studio's OWN site), the queues, and
// the one roster — the portfolio merged with the bridge list customers.html used
// to show. customers.html forwards an agency member here.
const past = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
const ymd = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const homeApi = {
  ...agencyApi,
  '/studio/customers': { data: [
    { client_id: 'c1', customer_site_id: 'a1', project_id: 'p1', name: 'Marlow’s Kitchen', email: 'ana@marlows.example', status: 'active', open_support: 1, project_count: 1 },
    { client_id: 'c4', customer_site_id: 'a4', project_id: null, name: 'Park Florist', email: 'jo@parkflorist.example', status: 'active', open_support: 0, project_count: 0 },   // bridged, not on the portfolio yet
  ] },
  '/sales/summary': { data: { total: 2, open: { count: 1, value_cents: 500000 }, won_month: { count: 1, value_cents: 800000 }, win_rate: { pct: 50, won: 1, lost: 1 }, by_stage: [], ar: { outstanding_cents: 120000, overdue_cents: 0, count: 1, overdue_count: 0 } } },
  '/sales/deals': { data: [
    { id: DEAL, title: 'Cedar Garage — new website', stage: 'proposal', expected_value_cents: 500000, expected_close: ymd(20), contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: 'Send the proposal', next_step_at: ymd(0), last_contacted_at: past(3) },
    { id: 'won-1', title: 'Bright Dental — redesign', stage: 'won', expected_value_cents: 800000, expected_close: ymd(-2), contact_id: 'ct-2', converted_client_id: null, updated_at: past(2), next_step: null, next_step_at: null },
  ] },
};

test.describe('Agency home — one home, one roster', () => {
  test('the studio strip: money tiles, This week and Key deals from the studio’s own site', async ({ page }) => {
    await installApp(page, { api: homeApi });
    await page.goto('/agency.html');
    const strip = page.locator('#studio');
    await expect(strip).toBeVisible();
    await expect(strip.locator('#stat-owed')).toContainText('$1,200');
    await expect(strip.locator('#stat-owed')).toContainText('1 invoice');
    await expect(strip.locator('#stat-won')).toContainText('$8,000');
    await expect(strip.locator('#stat-open')).toContainText('1');
    await expect(strip.locator('#this-week .rrows a')).toHaveCount(1);
    await expect(strip.locator('#this-week .rrows a').first()).toContainText('Send the proposal');
    await expect(strip.locator('#this-week .rrows a').first()).toHaveAttribute('href', `/crm.html?deal=${DEAL}`);
    await expect(strip.locator('#key-deals .rrows a').first()).toContainText('Cedar Garage');
    await expect(strip.locator('#key-deals .rrows a').first()).toHaveAttribute('href', `/pipeline.html?deal=${DEAL}`);
    await expect(strip.locator('#key-deals .rrows a')).toHaveCount(1);   // the won deal is not an open deal
  });

  test('the strip hides entirely when sales reads fail or are forbidden — never fake zeros', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    await page.route(/\/functions\/v1\/presence\/sales\/(summary|deals)/, (route) => route.fulfill(boom(403)));
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    await expect(page.locator('#studio')).toBeHidden();
    await expect(page.locator('#stat-owed')).toHaveCount(0);
  });

  test('one roster: the bridge list folds into the portfolio rows, and a bridged-only customer still gets a row', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: homeApi });
    await page.goto('/agency.html');
    const table = page.locator('.tscroll table');
    const marlow = table.locator('tbody tr', { hasText: 'Marlow’s Kitchen' });
    await expect(marlow).toContainText('ana@marlows.example');                       // the bridge list's email, on the portfolio row
    await expect(marlow.locator('.bits')).toContainText('1 support request open');    // and its waiting support
    const park = table.locator('tbody tr', { hasText: 'Park Florist' });
    await expect(park).toHaveCount(1);                                                 // on the bridge list only → still a row
    await expect(park.locator('.rowact')).toHaveText(['Open record']);                 // Their website only when the portfolio knows the site
    await expect(page.locator('.lhead .lmeta')).toContainText('4 businesses');
    await page.locator('[data-view="attention"]').click();
    await expect(table.locator('tbody tr')).toHaveCount(1);                            // Marlow (open support counts as needing attention)
    await page.locator('[data-view="clear"]').click();
    await expect(table.locator('tbody tr', { hasText: 'Park Florist' })).toHaveCount(1);
  });

  test('+ Add a customer lives on the home page and POSTs /sales/customers (customers.html’s dialog)', async ({ page }) => {
    await installApp(page, { api: { ...homeApi, '/sales/customers': { data: { invited: true, portal_url: 'https://studio.example/portal.html' } } } });
    await page.goto('/agency.html');
    await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
    await expect(page.locator('#custDlg')).toBeVisible();
    await expect(page.locator('#cu-name')).toBeFocused();   // the dialog's 20ms autofocus — let it land before filling (under load a fill() racing it lands in the wrong field)
    await page.locator('#cu-name').fill('Jo Park');
    await page.locator('#cu-email').fill('jo@parkflorist.example');
    await page.locator('#cu-biz').fill('Park Florist');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/sales/customers'));
    await page.locator('#cu-submit').click();
    expect((await posted).postDataJSON()).toMatchObject({ mode: 'provision', email: 'jo@parkflorist.example', business_name: 'Park Florist', edition: 'presence' });
    await expect(page.locator('#cust-done')).toContainText('Invitation sent');
    await expect(page.locator('#cust-done')).toContainText('land in their client portal');   // honest: the link opens the portal
  });

  // ── Oct 2026 studio audit, change 4: onboarding is findable, honest, and needs no password ──
  const KITS = { data: [{ id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', name: 'Restaurant starter', industry_key: 'restaurant' }, { id: 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa', name: 'Trades starter', industry_key: 'trades' }] };
  const PROVISIONED = { data: { created: true, invited: true, site_id: 'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa', client_id: 'c9', portal_url: 'https://studio.example/portal.html' } };

  test('⌘K’s "Add a customer" lands on /agency.html#add: the dialog opens and the hash is cleared', async ({ page }) => {
    await installApp(page, { api: homeApi });
    await page.goto('/agency.html#add');
    await expect(page.locator('#custDlg')).toBeVisible();
    await expect(page.locator('#cu-name')).toBeFocused();
    expect(new URL(page.url()).hash).toBe('');                    // Back / reload never reopen it
    // already on the home, the palette only changes the hash — that opens it too
    await page.locator('#cu-cancel').click();
    await expect(page.locator('#custDlg')).toBeHidden();
    await page.evaluate(() => { location.hash = '#add'; });
    await expect(page.locator('#custDlg')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('Start from a kit: the select lists /agency/kits, a chosen kit is applied to the NEW site, and the done screen names it', async ({ page }) => {
    await installApp(page, { api: { ...homeApi, '/agency/kits': KITS, '/sales/customers': PROVISIONED,
      '/agency/kits/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa/apply': { data: { applied: { offerings: 6, faqs: 4, voice: true, colors: true, industry: 'restaurant' }, skipped: [] } } } });
    await page.goto('/agency.html');
    await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
    const kit = page.locator('#cu-kit');
    await expect(page.locator('#cu-kit-wrap')).toBeVisible();
    await expect(kit.locator('option')).toHaveText(['No kit — start empty', 'Restaurant starter', 'Trades starter']);
    await expect(kit).toHaveValue('');                                                     // empty is the default
    await expect(page.locator('#cu-name')).toBeFocused();   // the dialog's 20ms autofocus — let it land before filling (under load a fill() racing it lands in the wrong field)
    await page.locator('#cu-email').fill('ana@marlows.example');
    await page.locator('#cu-biz').fill('Marlow’s Kitchen');
    await kit.selectOption({ label: 'Restaurant starter' });
    const provision = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/sales/customers'));
    const apply = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/agency/kits/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa/apply'));
    await page.locator('#cu-submit').click();
    expect((await provision).postDataJSON()).not.toHaveProperty('kit_id');              // the kit is applied AFTER, never sent to provisioning
    expect((await apply).postDataJSON()).toEqual({ site_id: 'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa' });   // the site the response named
    await expect(page.locator('#cust-done')).toContainText('Invitation sent');
    await expect(page.locator('#cust-done #cu-kit-line')).toHaveText('Restaurant starter applied.');
    await expect(page.locator('#cust-done')).toContainText('They’ll sign in from the email and land in their client portal.');
    await expect(page.locator('#cust-done')).not.toContainText('password');
  });

  test('a kit that won’t apply never repaints the set-up as a failure; no kit chosen → no apply call; no kits → no field', async ({ page }) => {
    await installApp(page, { api: { ...homeApi, '/agency/kits': KITS, '/sales/customers': PROVISIONED } });
    await page.route('**/functions/v1/presence/agency/kits/*/apply', (route) => route.fulfill(boom(500)));
    await page.goto('/agency.html');
    await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
    await expect(page.locator('#cu-name')).toBeFocused();   // the dialog's 20ms autofocus — let it land before filling (under load a fill() racing it lands in the wrong field)
    await page.locator('#cu-email').fill('ana@marlows.example');
    await page.locator('#cu-kit').selectOption({ label: 'Trades starter' });
    await page.locator('#cu-submit').click();
    await expect(page.locator('#cust-done')).toContainText('Invitation sent');
    await expect(page.locator('#cust-done #cu-kit-line')).toContainText('The Trades starter kit didn’t apply');
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'couldn’t set them up' })).toHaveCount(0);
    // no kit chosen → nothing is applied
    let applies = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/apply')) applies++; });
    await page.locator('#cu-close').click();
    await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
    await expect(page.locator('#cu-kit')).toHaveValue('');
    await expect(page.locator('#cu-name')).toBeFocused();   // the dialog's 20ms autofocus — let it land before filling (under load a fill() racing it lands in the wrong field)
    await page.locator('#cu-email').fill('jo@parkflorist.example');
    await page.locator('#cu-submit').click();
    await expect(page.locator('#cust-done')).toContainText('Invitation sent');
    await expect(page.locator('#cust-done #cu-kit-line')).toHaveCount(0);
    expect(applies).toBe(0);
    // a studio with no kits yet is never offered an empty select
    await installApp(page, { api: { ...homeApi, '/sales/customers': PROVISIONED } });   // homeApi: '/agency/kits' → []
    await page.goto('/agency.html');
    await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
    await expect(page.locator('#custDlg')).toBeVisible();
    await expect(page.locator('#cu-kit-wrap')).toBeHidden();
  });

  test('honest money copy: provision mode never shows the pricing box; connect mode does', async ({ page }) => {
    await installApp(page, { api: homeApi });
    await page.goto('/agency.html');
    await page.locator('#top').getByRole('button', { name: '+ Add a customer' }).click();
    const dlg = page.locator('#custDlg');
    await expect(dlg.locator('#cu-signup')).toBeHidden();                              // the pricing box is not on the page the operator sees
    expect(await dlg.locator('#cust-fields').innerText()).not.toContain('pay for their plan');   // innerText = rendered text only (toContainText reads hidden copy too)
    await expect(dlg.locator('#cu-provision-only')).toContainText('Adding them creates their client workspace and their site, and emails them a sign-in link. You bill them for your work the usual way — they never pay for software here.');
    await expect(dlg.locator('#cu-mode')).toContainText('Create their workspace and email them a sign-in link.');
    await expect(dlg).not.toContainText('set their password');
    await page.locator('input[name="cumode"][value="connect"]').check();
    await expect(dlg.locator('#cu-signup')).toBeVisible();
    await expect(dlg.locator('#cu-signup-link')).toHaveValue(/\/pricing\.html$/);
    await expect(dlg.locator('#cu-kit-wrap')).toBeHidden();                            // nothing is provisioned, so nothing to start from
  });

  test('the home is never scoped: a stray ?client= is dropped before the shell reads it', async ({ page }) => {
    await installApp(page, { api: homeApi });
    await page.goto('/agency.html?client=aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    expect(new URL(page.url()).search).toBe('');
    await expect(page.locator('#dds-ctxbar')).toHaveCount(0);
  });

  test('the Health Center door is a status line in the top row (staff only)', async ({ page }) => {
    await installApp(page, { api: { ...homeApi, '/admin/health-center': { data: { overall: 'attention', areas: [
      { key: 'domains', label: 'Domains', state: 'attention', detail: '1 expiring.' }, { key: 'cron', label: 'Scheduled operations', state: 'ok', detail: 'Running.' }, { key: 'billing', label: 'Billing', state: 'attention', detail: '1 with trouble.' },
    ] } } } });
    await page.goto('/agency.html');
    const door = page.locator('#top #healthDoor');
    await expect(door).toContainText('Platform: 2 areas need a look');
    await expect(door).toHaveAttribute('href', '/admin-health.html');
    // a non-staff member never sees it
    await installApp(page, { api: homeApi });
    await page.route('**/functions/v1/presence/admin/health-center', (route) => route.fulfill(boom(403)));
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    await expect(page.locator('#healthDoor')).toHaveCount(0);
  });
});

// ── Money on the roster (Oct 2026 studio audit, change 10) ───────────────────
// An Outstanding column (sortable) and chip, from /sales/receivables grouped by
// the invoice's customer — the deal's converted client / site. Best-effort: no
// receivables → blank cells, never a fake $0.
test.describe('Agency roster — Outstanding', () => {
  const receivables = { data: { items: [
    { id: 'i1', title: 'Deposit', amount_cents: 120000, due_date: ymd(5), status: 'open', state: 'upcoming', overdue: false, deal_id: DEAL, deal: 'Marlow rebuild', stripe_url: 'https://pay.example/1', client_id: 'c1', customer_site_id: 'a1' },
    { id: 'i2', title: 'Balance', amount_cents: 80000, due_date: ymd(-3), status: 'open', state: 'overdue', overdue: true, deal_id: DEAL, deal: 'Marlow rebuild', stripe_url: 'https://pay.example/2', client_id: 'c1', customer_site_id: 'a1' },
    { id: 'i3', title: 'Invoice', amount_cents: 30000, due_date: null, status: 'open', state: 'upcoming', overdue: false, deal_id: 'd2', deal: 'Park Florist site', stripe_url: null, client_id: 'c4', customer_site_id: null },   // bridged-only customer: grouped by client id
    { id: 'i4', title: 'Invoice', amount_cents: 50000, due_date: null, status: 'open', state: 'upcoming', overdue: false, deal_id: 'd3', deal: 'Unconverted deal', stripe_url: null, client_id: null, customer_site_id: null },   // no customer yet → nowhere on the roster
  ], paid: [], total_cents: 280000, overdue_cents: 80000, processing_cents: 0 } };

  test('the column totals what each client owes, marks overdue, and sorts', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: { ...homeApi, '/sales/receivables': receivables } });
    await page.goto('/agency.html');
    const table = page.locator('.tscroll table');
    await expect(table.locator('thead')).toContainText('Outstanding');
    const marlow = table.locator('tbody tr', { hasText: 'Marlow’s Kitchen' });
    await expect(marlow.locator('td.money .owed')).toHaveText('$2,000');
    await expect(marlow.locator('td.money .owed')).toHaveClass(/late/);
    await expect(marlow.locator('td.money .sub')).toHaveText('$800 overdue');
    const park = table.locator('tbody tr', { hasText: 'Park Florist' });
    await expect(park.locator('td.money .owed')).toHaveText('$300');
    await expect(park.locator('td.money .owed')).not.toHaveClass(/late/);
    await expect(table.locator('tbody tr', { hasText: 'Bright Dental' }).locator('td.money')).toHaveText('—');
    await expect(marlow.locator('td.num')).toHaveText('2');   // the leads cell is still the one td.num
    await page.locator('.thb[data-sort="owed"]').click();
    await page.locator('.thb[data-sort="owed"]').click();      // descending
    await expect(table.locator('tbody tr').first()).toContainText('Marlow’s Kitchen');
    await expect(page.locator('.lmeta')).toContainText('Sorted by Outstanding — descending');
  });

  test('the Outstanding chip shows only clients who owe; an overdue client is never "All clear"', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: { ...homeApi, '/sales/receivables': receivables } });
    await page.goto('/agency.html');
    await page.locator('[data-view="owed"]').click();
    await expect(page.locator('[data-view="owed"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody')).toContainText('Marlow’s Kitchen');
    await expect(page.locator('tbody')).toContainText('Park Florist');
    await page.locator('[data-view="clear"]').click();
    await expect(page.locator('tbody tr', { hasText: 'Park Florist' })).toHaveCount(1);   // owes, but nothing overdue → still clear
    await expect(page.locator('tbody tr', { hasText: 'Marlow’s Kitchen' })).toHaveCount(0);
  });

  test('cards view says it under the name; no receivables at all → nothing invented', async ({ page }) => {
    await pinDisplay(page, 'cards');
    await installApp(page, { api: { ...homeApi, '/sales/receivables': receivables } });
    await page.goto('/agency.html');
    await expect(page.locator('.client', { hasText: 'Marlow’s Kitchen' }).locator('.bitln')).toContainText('$2,000 outstanding · $800 overdue');
    await expect(page.locator('.client', { hasText: 'Bright Dental' }).locator('.bitln')).toHaveCount(0);
  });

  test('a failed receivables read leaves the column blank — the roster still loads', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: homeApi });
    await page.route(/\/functions\/v1\/presence\/sales\/receivables/, (route) => route.fulfill(boom(500)));
    await page.goto('/agency.html');
    await expect(page.locator('tbody tr')).toHaveCount(4);
    await expect(page.locator('tbody td.money')).toHaveText(['—', '—', '—', '—']);
  });
});
// ── Oct 2026 studio audit, change 6: client housekeeping on the roster row ────
// PATCH /agency/clients/:site (tags · owner · note · archive/restore) existed with
// no page. Owners, admins and account managers get a ⋯ on each portfolio row that
// opens an inline form; tags paint as chips; an Archived view fetches the other
// half of the portfolio on demand. Bridged-only rows (no portfolio link) have none.
test.describe('Agency roster — housekeeping', () => {
  const ROW_API = { ...homeApi, '/agency/portfolio': { data: [
    { ...MARLOW, tags: ['restaurant', 'burbank'], owner: 'eric@brightstudio.example', notes: 'Prefers texts over email.', has_notes: true },
    DENTAL, CEDAR,
  ] } };

  test('tags paint as chips, the ⋯ opens the form prefilled, Save PATCHes tags/owner/notes and the row repaints', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: ROW_API });
    const patches: unknown[] = [];
    await page.route('**/functions/v1/presence/agency/clients/*', (route) => {
      patches.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { site_id: 'a1', status: 'active', ...(route.request().postDataJSON() as object) } }) });
    });
    await page.goto('/agency.html');
    const marlow = page.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).first();
    await expect(marlow.locator('.tagchip')).toHaveText(['restaurant', 'burbank']);
    await expect(marlow.locator('.notedot')).toBeVisible();
    await marlow.getByRole('button', { name: 'More for Marlow’s Kitchen' }).click();
    const form = page.locator('form[data-hkform="a1"]');
    await expect(form).toBeVisible();
    await expect(form.locator('[name="tags"]')).toHaveValue('restaurant, burbank');
    await expect(form.locator('[name="owner"]')).toHaveValue('eric@brightstudio.example');
    await expect(form.locator('[name="notes"]')).toHaveValue('Prefers texts over email.');
    await form.locator('[name="tags"]').fill('restaurant, burbank, vip');
    await form.locator('[name="notes"]').fill('Prefers texts. Invoices go to Ana.');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Saved.');
    expect(patches).toEqual([{ tags: ['restaurant', 'burbank', 'vip'], owner_email: 'eric@brightstudio.example', notes: 'Prefers texts. Invoices go to Ana.' }]);
    await expect(page.locator('form[data-hkform="a1"]')).toHaveCount(0);                      // the form closes
    await expect(page.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).first().locator('.tagchip')).toHaveText(['restaurant', 'burbank', 'vip']);
  });

  test('Archive is a two-press action: the row leaves the list, the Archived view fetches ?archived=true and offers Restore', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: ROW_API });
    const calls: string[] = [];
    await page.route(/\/functions\/v1\/presence\/agency\/portfolio/, (route) => {
      const u = new URL(route.request().url()); calls.push(u.search);
      return route.fulfill(ok(u.searchParams.get('archived') === 'true' ? { data: [{ ...DENTAL, site_id: 'a9', name: 'Old Bakery', archived: true }] } : ROW_API['/agency/portfolio']));
    });
    await page.route('**/functions/v1/presence/agency/clients/*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { site_id: 'a3', status: (route.request().postDataJSON() as { status: string }).status } }) }));
    await page.goto('/agency.html');
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(4);                        // 3 on the portfolio + the bridged-only Park Florist
    await page.locator('tbody tr', { hasText: 'Cedar Garage' }).getByRole('button', { name: 'More for Cedar Garage' }).click();
    const arch = page.locator('form[data-hkform="a3"]').getByRole('button', { name: /Archive/ });
    await arch.click();
    await expect(arch).toContainText('Press again');
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(4);                        // armed, nothing sent
    await arch.click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'archived' })).toContainText('Cedar Garage archived');
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(3);
    await expect(page.locator('.lhead .lmeta')).toContainText('3 businesses');
    // the Archived view is its own read, made the first time it is asked for
    expect(calls.filter((c) => c.includes('archived=true'))).toHaveLength(0);
    await page.locator('[data-view="archived"]').click();
    await expect(page.locator('tbody tr', { hasText: 'Old Bakery' })).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'Cedar Garage' })).toBeVisible();        // the one just archived joins it
    expect(calls.filter((c) => c.includes('archived=true'))).toHaveLength(1);
    await page.locator('tbody tr', { hasText: 'Cedar Garage' }).getByRole('button', { name: 'More for Cedar Garage' }).click();
    await page.locator('form[data-hkform="a3"]').getByRole('button', { name: 'Restore client' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'restored' })).toContainText('Cedar Garage restored');   // the archive toast may still be up
    await expect(page.locator('tbody tr', { hasText: 'Cedar Garage' })).toHaveCount(0);
    await page.locator('[data-view="all"]').click();
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(4);
  });

  // Post-merge review of #47: a client archived from the ⋯ menu came BACK after a
  // reload — load() folded every /studio/customers entry the (non-archived) portfolio
  // did not know into All as a bridge-only row, ⋯-less, while the same client also sat
  // under Archived. The portfolio read now carries archived_site_ids and the roster
  // skips them. Also: ↻ re-reads the Archived list once it has been read (it used to
  // stay cached for the session).
  test('an archived client stays under Archived after a reload — never back in All as a bridge-only row; Restore from there brings it back; ↻ re-reads Archived', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: { ...ROW_API, '/studio/customers': { data: [
      ...homeApi['/studio/customers'].data,
      { client_id: 'c3', customer_site_id: 'a3', project_id: 'p3', name: 'Cedar Garage', email: 'cedar@garage.example', status: 'active', open_support: 0, project_count: 1 },   // the bridge list keeps knowing an archived client
    ] } } });
    let archivedOnServer = false;
    const calls: string[] = [];
    await page.route(PF_RE, (route) => {
      const u = new URL(route.request().url()); calls.push(u.search);
      const cedar = { ...CEDAR, archived: true };
      if (u.searchParams.get('archived') === 'true') return route.fulfill(ok({ data: archivedOnServer ? [cedar] : [] }));
      return route.fulfill(ok(archivedOnServer ? { data: [MARLOW, DENTAL], archived_site_ids: ['a3'] } : { data: [MARLOW, DENTAL, CEDAR], archived_site_ids: [] }));
    });
    await page.route('**/functions/v1/presence/agency/clients/*', (route) => {
      const st = (route.request().postDataJSON() as { status: string }).status; archivedOnServer = st === 'archived';
      return route.fulfill(ok({ data: { site_id: 'a3', status: st } }));
    });
    await page.goto('/agency.html');
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(4);                        // Marlow · Dental · Cedar + the bridged-only Park Florist
    await page.locator('tbody tr', { hasText: 'Cedar Garage' }).getByRole('button', { name: 'More for Cedar Garage' }).click();
    const arch = page.locator('form[data-hkform="a3"]').getByRole('button', { name: /Archive/ });
    await arch.click(); await arch.click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'archived' })).toContainText('Cedar Garage archived');
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(3);
    // the reload: the server knows a3 is archived; the bridge list still lists it
    await page.reload();
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(3);
    await expect(page.locator('tbody tr', { hasText: 'Cedar Garage' })).toHaveCount(0);      // NOT back as a bridge-only row
    await expect(page.locator('tbody tr', { hasText: 'Park Florist' })).toHaveCount(1);      // a genuinely bridge-only customer still gets its row
    await page.locator('[data-view="archived"]').click();
    const cedarArch = page.locator('tbody tr', { hasText: 'Cedar Garage' });
    await expect(cedarArch).toHaveCount(1);
    await expect(cedarArch.getByRole('button', { name: 'More for Cedar Garage' })).toBeVisible();   // the ⋯ is there, so Restore is reachable
    expect(calls.filter((c) => c.includes('archived=true'))).toHaveLength(1);
    // ↻ re-reads the Archived list now that it has been read
    await page.locator('#refreshBtn').click();
    await expect.poll(() => calls.filter((c) => c.includes('archived=true')).length).toBe(2);
    await expect(page.locator('tbody tr', { hasText: 'Cedar Garage' })).toHaveCount(1);
    // Restore from Archived brings the client back to All
    await page.locator('tbody tr', { hasText: 'Cedar Garage' }).getByRole('button', { name: 'More for Cedar Garage' }).click();
    await page.locator('form[data-hkform="a3"]').getByRole('button', { name: 'Restore client' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'restored' })).toContainText('Cedar Garage restored');
    await expect(page.locator('tbody tr', { hasText: 'Cedar Garage' })).toHaveCount(0);
    await page.locator('[data-view="all"]').click();
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(4);
    await expect(page.locator('tbody tr', { hasText: 'Cedar Garage' }).getByRole('button', { name: 'More for Cedar Garage' })).toBeVisible();
    await page.reload();                                                                      // and it stays back
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(4);
  });

  test('Escape in the housekeeping form closes it and puts focus back on the ⋯ (Cancel’s contract)', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: ROW_API });
    await page.goto('/agency.html');
    await page.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).first().getByRole('button', { name: 'More for Marlow’s Kitchen' }).click();
    const form = page.locator('form[data-hkform="a1"]');
    await expect(form.locator('[name="tags"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More for Marlow’s Kitchen' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'More for Marlow’s Kitchen' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a read-only member sees no ⋯; a bridged-only customer has none either; the search matches tags', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: ROW_API });
    await page.goto('/agency.html');
    await expect(page.locator('tbody tr', { hasText: 'Park Florist' }).getByRole('button', { name: /More for/ })).toHaveCount(0);   // bridge-only: no portfolio row to patch
    await page.locator('#search').fill('burbank');
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(1);
    await expect(page.locator('tbody tr[data-open]').first()).toContainText('Marlow’s Kitchen');
    await installApp(page, { api: { ...ROW_API, '/agency/me': { data: { agency: 'Bright Studio', role: 'readonly', plan: 'agency', branding: {} } } } });
    await page.goto('/agency.html');
    await expect(page.locator('tbody tr[data-open]')).toHaveCount(4);
    await expect(page.getByRole('button', { name: /More for/ })).toHaveCount(0);
  });
});
