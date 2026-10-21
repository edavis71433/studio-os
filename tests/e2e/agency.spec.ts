import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// SS2 (standards sweep) — the Agency roster wears the redesign anatomy: shared
// .lhead with ↻ refresh under REQ_SEQ, fixed-view chips, sortable typed columns
// behind a persisted Table ⇄ Cards toggle, caret-preserving search, honest
// failure states (a failed portfolio read is NEVER "No clients yet"), and
// ?client= carried on every drill.
//
// Oct 2026 home rebuild: the home shows only what needs the STUDIO. "Needs you"
// is one list from /agency/needs-you (money · enquiries · support · late deal
// steps · broken things · approved plans · unpublished changes), each row
// "Name — what" · when · ONE verb. The roster says Name · Status (Live · Not
// live yet · Needs you · Archived) · Next · Outstanding, with one button and a
// ⋯ menu (Their website · Save as a starter kit · Tags, owner, note, archive).
// Edition, Waiting, Leads, Domain, the "N search issues" line and the Starter
// kits card are gone from the home.
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

// the REAL /agency/needs-you shape (needsYouPayload in agency/needs_you.ts)
const SSL_ROW = { key: 'broken:ev:a1:trust.ssl_missing', kind: 'broken', site_id: 'a1', client_id: null, name: 'Marlow’s Kitchen', what: 'SSL certificate is missing', when: 'Found by the health check', verb: 'Fix', href: '/presence.html?client=a1#domain' };
const needsYou = (rows: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({ data: {
  rows: rows.slice(0, 8), more: Math.max(0, rows.length - 8), rest: rows.slice(8), total: rows.length,
  empty_line: rows.length ? '' : 'Everything is paid and published.', partial: false, own_site: true,
  next_by_site: Object.fromEntries(rows.filter((r) => r.site_id).map((r) => [r.site_id, { what: r.what, verb: r.verb, href: r.href, kind: r.kind }]).reverse()),
  next_by_client: Object.fromEntries(rows.filter((r) => r.client_id).map((r) => [r.client_id, { what: r.what, verb: r.verb, href: r.href, kind: r.kind }]).reverse()),
  ...over,
} });
const agencyApi = {
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: [MARLOW, DENTAL, CEDAR] },
  '/agency/needs-you': needsYou([SSL_ROW]),
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

  test('table view: Name · Status · Next · Outstanding, one button and a ⋯ — never Edition/Waiting/Leads/Domain', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const table = page.locator('.tscroll table');
    await expect(table.locator('thead .thb')).toHaveText(['Name▲', 'Status', 'Next', 'Outstanding']);   // ▲ = the default Name sort
    const marlow = table.locator('tbody tr', { hasText: 'Marlow’s Kitchen' });
    await expect(marlow.locator('.pill')).toHaveText('Needs you');                      // a row in Needs you → the status says so
    await expect(marlow.locator('td.next')).toHaveText('SSL certificate is missing');   // that client's first Needs-you row
    await expect(marlow.locator('td.money')).toHaveText('—');
    // nothing from the old columns, nothing from the website's own report
    await expect(marlow).not.toContainText('presence');
    await expect(marlow).not.toContainText('waiting');
    await expect(marlow).not.toContainText('search issue');
    await expect(marlow).not.toContainText('marlows.example.com');
    const dental = table.locator('tbody tr', { hasText: 'Bright Dental' });
    await expect(dental.locator('.pill')).toHaveText('Live');                            // published, nothing to do
    await expect(dental.locator('td.next')).toHaveText('Nothing — all quiet');
    // one button per row (the hub) + the ⋯ menu
    await expect(marlow.locator('.rowact')).toHaveText(['Open record', '⋯']);
    await expect(dental.locator('.rowact')).toHaveText(['Open record', '⋯']);
  });

  test('status words: Not live yet for an unpublished site, Live for a monitored one; search issues alone are NOT "Needs you"', async ({ page }) => {
    // Eric's complaint: every roster row said "5 search issues" for sites that
    // weren't even live, and read as needing him. Search issues stay on the
    // client's Website page; the home's status is about the studio's work.
    await pinDisplay(page, 'table');
    const quarry = row({ site_id: 'a7', name: 'Quiet Quarry', search_issues: 5, last_published_at: null, status: 'ready' });
    const watch = row({ site_id: 'a8', name: 'Watched Bakery', edition: 'monitor', last_published_at: null, status: 'ready', search_issues: 2 });
    await installApp(page, { api: { ...agencyApi, '/agency/portfolio': { data: [MARLOW, DENTAL, CEDAR, quarry, watch] } } });
    await page.goto('/agency.html');
    const q = page.locator('tbody tr', { hasText: 'Quiet Quarry' });
    await expect(q.locator('.pill')).toHaveText('Not live yet');
    await expect(q.locator('td.next')).toHaveText('Nothing — all quiet');
    await expect(q).not.toContainText('search issue');
    await expect(page.locator('tbody tr', { hasText: 'Watched Bakery' }).locator('.pill')).toHaveText('Live');
    await page.locator('[data-view="needs"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);   // Marlow alone — the one with a Needs-you row
    await expect(page.locator('tbody')).not.toContainText('Quiet Quarry');
  });

  test('cards view: name, email, Next line, the status word, Open record + ⋯', async ({ page }) => {
    await pinDisplay(page, 'cards');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const marlow = page.locator('.client', { hasText: 'Marlow’s Kitchen' });
    await expect(marlow.locator('.badge')).toHaveText('Needs you');
    await expect(marlow).toContainText('Next: SSL certificate is missing');
    await expect(marlow).not.toContainText('leads waiting');
    await expect(marlow).not.toContainText('GoDaddy');
    const dental = page.locator('.client', { hasText: 'Bright Dental' });
    await expect(dental.locator('.badge')).toHaveText('Live');
    await expect(dental).toContainText('Next: Nothing — all quiet');
    await expect(page.locator('.managerow').first().getByRole('button', { name: 'Open record →' })).toBeVisible();
    await expect(page.locator('.managerow').first().getByRole('button', { name: /More for/ })).toBeVisible();
  });

  test('sorting: header clicks toggle order with aria-sort; the lmeta names the sort', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    // default: Name ascending
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Name');
    await expect(page.locator('tbody tr').first()).toContainText('Bright Dental');
    await expect(page.locator('.lmeta')).toContainText('Sorted by Name — ascending');
    // Status: Needs you sorts before Not live yet before Live
    await page.locator('.thb', { hasText: 'Status' }).click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Status');
    await expect(page.locator('tbody tr .n').first()).toHaveText('Marlow’s Kitchen');   // Needs you
    await expect(page.locator('.lmeta')).toContainText('Sorted by Status — ascending');
    await page.locator('.thb', { hasText: 'Status' }).click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Status');
    await expect(page.locator('tbody tr .n').last()).toHaveText('Marlow’s Kitchen');
  });

  test('fixed-view chips are All · Needs you · Outstanding · Archived, filter correctly and carry aria-pressed', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    await expect(page.locator('.filters button')).toHaveText(['All', 'Needs you', 'Outstanding', 'Archived']);
    await expect(page.locator('[data-view="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.locator('[data-view="needs"]').click();
    await expect(page.locator('[data-view="needs"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-view="all"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('Marlow’s Kitchen');
    await expect(page.locator('.lmeta')).toContainText('1 business ·');
    await page.locator('[data-view="owed"]').click();
    await expect(page.locator('#main')).toContainText('No clients match that.');   // no receivables in this fixture → nobody owes
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
    await expect(page.locator('#needs .need .row')).toContainText('SSL certificate is missing'); // …and Needs you mounted
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

  test('Save as a starter kit lives in the row’s ⋯: one dialog, exactly ONE POST per save, no kits card on the home', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    const posts: unknown[] = [];
    await page.route(/\/functions\/v1\/presence\/agency\/kits$/, (route) => {
      if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill(ok({ data: { id: 'k' + posts.length, name: 'Kit ' + posts.length } })); }
      return route.fulfill(ok({ data: [] }));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');
    await expect(page.locator('#kits, .kitcard, #kitFromSite')).toHaveCount(0);   // the Starter kits card left the home
    await page.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).getByRole('button', { name: 'More for Marlow’s Kitchen' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem')).toHaveText(['Their website', 'Save as a starter kit', 'Tags, owner, note, archive']);
    await page.getByRole('menuitem', { name: 'Save as a starter kit' }).click();
    const dlg = page.locator('#kitDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('From Marlow’s Kitchen’s setup.');
    await expect(page.locator('#kit-name')).toBeFocused();
    await page.locator('#kit-name').fill('Contractor Starter');
    await page.locator('#kit-save').click();
    await expect(page.locator('.dds-toast')).toContainText('Kit saved');
    await expect(dlg).toBeHidden();
    expect(posts).toEqual([{ site_id: 'a1', name: 'Contractor Starter' }]);
    // a second save from another row is one more POST, never two
    await page.locator('tbody tr', { hasText: 'Bright Dental' }).getByRole('button', { name: 'More for Bright Dental' }).click();
    await page.getByRole('menuitem', { name: 'Save as a starter kit' }).click();
    await page.locator('#kit-name').fill('Dental Starter');
    await page.locator('#kit-save').click();
    await expect.poll(() => posts.length).toBe(2);
    await page.waitForTimeout(250);
    expect(posts.length).toBe(2);
    expect(posts[1]).toEqual({ site_id: 'a2', name: 'Dental Starter' });
  });

  test('the ⋯ menu: "Their website" opens the client’s website editor in their scope; Escape closes the menu back to the ⋯', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const more = page.locator('tbody tr', { hasText: 'Bright Dental' }).getByRole('button', { name: 'More for Bright Dental' });
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: 'Their website' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More for Bright Dental' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'More for Bright Dental' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'More for Bright Dental' }).click();
    await page.getByRole('menuitem', { name: 'Their website' }).click();
    await page.waitForURL(/presence\.html\?client=a2/);
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

  test('Needs you: one list, each row "Name — what" · when · ONE verb; the button carries the client scope', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    await page.goto('/agency.html');
    const n = page.locator('#needs');
    await expect(n.locator('.qhead')).toHaveText('Needs you · 1');
    const row = n.locator('.need .row').first();
    await expect(row.locator('.t b')).toHaveText('Marlow’s Kitchen');
    await expect(row.locator('.t')).toContainText('Marlow’s Kitchen — SSL certificate is missing');
    await expect(row.locator('.when')).toHaveText('Found by the health check');
    await expect(row.locator('a.rowact')).toHaveText('Fix');
    await expect(row.locator('a.rowact')).toHaveAttribute('href', '/presence.html?client=a1#domain');
    await expect(row.locator('a, button')).toHaveCount(1);   // exactly one verb
    // nothing of the old queue dump
    await expect(n).not.toContainText('High priority');
    await expect(n).not.toContainText('Growth');
  });

  test('Needs you is the studio’s own work in a fixed order: money · enquiry · support · deal · broken · plan · publish', async ({ page }) => {
    const rows = [
      { key: 'money:i1', kind: 'money', site_id: 'a1', client_id: 'c1', name: 'Marlow’s Kitchen', what: 'invoice $1,600 is overdue by 3 days', when: 'Sent Oct 14 · no payment yet', verb: 'Resend', href: '/crm.html?deal=d1&tab=billing' },
      { key: 'money:i2', kind: 'money', site_id: 'a2', client_id: 'c2', name: 'Bright Dental', what: 'invoice $800 is due Nov 3', when: 'Sent Oct 20 · no payment yet', verb: 'Resend', href: '/crm.html?deal=d2&tab=billing' },
      { key: 'enquiry:e1', kind: 'enquiry', site_id: 'a3', client_id: null, name: 'Cedar Garage', what: 'new enquiry from Maria', when: '2 days ago · quote form', verb: 'Reply', href: '/inbox.html?client=a3#enquiries?sel=lead:e1' },
      { key: 'support:s1', kind: 'support', site_id: 'a1', client_id: 'c1', name: 'Marlow’s Kitchen', what: 'support request: the gallery page', when: 'Opened yesterday', verb: 'Reply', href: '/inbox.html#support?sel=sup:s1' },
      { key: 'deal:d9', kind: 'deal', site_id: null, client_id: 'c9', name: 'Claud Beltran', what: 'next step “Book the kickoff call” is 74 days late', when: 'On the deal Bacchus Kitchen · due Aug 8', verb: 'Open deal', href: '/crm.html?deal=d9' },
      { key: 'broken:publish:a2', kind: 'broken', site_id: 'a2', client_id: null, name: 'Bright Dental', what: 'the last publish failed', when: 'Failed today', verb: 'Fix', href: '/presence.html?client=a2#publish' },
      { key: 'plan:p1', kind: 'plan', site_id: 'a3', client_id: null, name: 'Cedar Garage', what: 'approved “Protect your email” — not applied yet', when: 'Approved plan', verb: 'Apply', href: '/presence.html?client=a3#foundations' },
      { key: 'publish:a1', kind: 'publish', site_id: 'a1', client_id: null, name: 'Marlow’s Kitchen', what: 'changes are sitting unpublished', when: 'Last change today', verb: 'Review', href: '/presence.html?client=a1#publish' },
    ];
    await installApp(page, { api: { ...agencyApi, '/agency/needs-you': needsYou(rows) } });
    await page.goto('/agency.html');
    const n = page.locator('#needs');
    await expect(n.locator('.qhead')).toHaveText('Needs you · 8');
    await expect(n.locator('.need .row a.rowact')).toHaveText(['Resend', 'Resend', 'Reply', 'Reply', 'Open deal', 'Fix', 'Apply', 'Review']);
    await expect(n.locator('.need .row').first()).toContainText('Marlow’s Kitchen — invoice $1,600 is overdue by 3 days');
    await expect(n.locator('.need .row').nth(4)).toContainText('Claud Beltran — next step “Book the kickoff call” is 74 days late');
    await expect(n.locator('#needsMore')).toHaveCount(0);
    // the roster's Status/Next read from the same list — first row per client
    await pinDisplay(page, 'table');
    await page.reload();
    const table = page.locator('.tscroll table');
    await expect(table.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).locator('td.next')).toHaveText('invoice $1,600 is overdue by 3 days');
    await expect(table.locator('tbody tr', { hasText: 'Cedar Garage' }).locator('td.next')).toHaveText('new enquiry from Maria');
    await expect(table.locator('tbody tr', { hasText: 'Cedar Garage' }).locator('.pill')).toHaveText('Needs you');
  });

  test('Needs you keeps the first 8 rows and "+N more" expands the rest in place', async ({ page }) => {
    const rows = Array.from({ length: 11 }, (_, k) => ({ key: 'enquiry:e' + k, kind: 'enquiry', site_id: 'a1', client_id: null, name: 'Marlow’s Kitchen', what: 'new enquiry from Visitor ' + k, when: `${k + 1} days ago`, verb: 'Reply', href: `/inbox.html?client=a1#enquiries?sel=lead:e${k}` }));
    await installApp(page, { api: { ...agencyApi, '/agency/needs-you': needsYou(rows) } });
    await page.goto('/agency.html');
    const n = page.locator('#needs');
    await expect(n.locator('.qhead')).toHaveText('Needs you · 11');
    await expect(n.locator('.need .row')).toHaveCount(8);
    await expect(n.locator('#needsMore')).toHaveText('+ 3 more');
    await n.locator('#needsMore').click();
    await expect(n.locator('.need .row')).toHaveCount(11);
    await expect(n.locator('#needsMore')).toHaveCount(0);
    await expect(n.locator('.need .row').nth(8).locator('a.rowact')).toBeFocused();   // focus lands on the first revealed row
  });

  test('empty state: "Nothing needs you." plus one honest line; a partial read says so', async ({ page }) => {
    await pinDisplay(page, 'table');   // the roster pill is read from the table (phones default to Cards)
    await installApp(page, { api: { ...agencyApi, '/agency/needs-you': needsYou([], { empty_line: 'Claud Beltran owes $1,600, due Nov 3.' }) } });
    await page.goto('/agency.html');
    const n = page.locator('#needs');
    await expect(n).toBeVisible();
    await expect(n.locator('#needsEmpty .nn')).toHaveText('Nothing needs you.');
    await expect(n.locator('#needsEmpty')).toContainText('Claud Beltran owes $1,600, due Nov 3.');
    await expect(n.locator('.pnote')).toHaveCount(0);
    await expect(page.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).locator('.pill')).toHaveText('Live');   // nothing needs the studio → the roster agrees
    await installApp(page, { api: { ...agencyApi, '/agency/needs-you': needsYou([], { partial: true }) } });
    await page.goto('/agency.html');
    await expect(page.locator('#needs .pnote')).toContainText('couldn’t be checked just now');
  });

  test('soft ↻ re-reads Needs you too, not just the roster (request-count pin)', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    let qcalls = 0;
    await page.route(/\/functions\/v1\/presence\/agency\/needs-you/, (route) => {
      qcalls++;
      return route.fulfill(ok(agencyApi['/agency/needs-you']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#needs .need .row')).toContainText('SSL certificate is missing');
    expect(qcalls).toBe(1);                    // boot mounted it once
    await page.locator('#refreshBtn').click();
    await expect.poll(() => qcalls).toBe(2);   // ↻ re-read it as well
    await expect(page.locator('#needs .need .row')).toContainText('SSL certificate is missing');   // and it still renders
  });

  test('Needs you failure surfaces honestly (never silent absence) and Try again refetches', async ({ page }) => {
    await installApp(page, { api: agencyApi });
    let calls = 0;
    await page.route(/\/functions\/v1\/presence\/agency\/needs-you/, (route) => {
      calls++;
      if (calls === 1) return route.fulfill(boom());
      return route.fulfill(ok(agencyApi['/agency/needs-you']));
    });
    await page.goto('/agency.html');
    await expect(page.locator('#needs')).toContainText('Needs you wouldn’t load just now');
    await expect(page.locator('#main')).toContainText('Marlow’s Kitchen');   // the roster is not held hostage
    await page.locator('#needsRetry').click();
    await expect(page.locator('#needs .need .row')).toContainText('SSL certificate is missing');
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
    await expect(marlow.locator('.sub')).toHaveText('ana@marlows.example');            // the bridge list's email, small under the name
    const park = table.locator('tbody tr', { hasText: 'Park Florist' });
    await expect(park).toHaveCount(1);                                                 // on the bridge list only → still a row
    await expect(park.locator('.rowact')).toHaveText(['Open record']);                 // no ⋯: nothing of theirs to edit or save here
    await expect(park.locator('.pill')).toHaveText('Not live yet');
    await expect(page.locator('.lhead .lmeta')).toContainText('4 businesses');
    await page.locator('[data-view="needs"]').click();
    await expect(table.locator('tbody tr')).toHaveCount(1);                            // Marlow — the one with a Needs-you row
  });

  test('a bridged-only customer gets Status "Needs you" and a Next line from the list’s next_by_client', async ({ page }) => {
    await pinDisplay(page, 'table');
    const owes = { key: 'money:i7', kind: 'money', site_id: null, client_id: 'c4', name: 'Park Florist', what: 'invoice $300 is due Oct 24', when: 'Sent Oct 17 · no payment yet', verb: 'Resend', href: '/crm.html?deal=d7&tab=billing' };
    await installApp(page, { api: { ...homeApi, '/agency/needs-you': needsYou([SSL_ROW, owes]) } });
    await page.goto('/agency.html');
    const park = page.locator('tbody tr', { hasText: 'Park Florist' });
    await expect(park.locator('.pill')).toHaveText('Needs you');
    await expect(park.locator('td.next')).toHaveText('invoice $300 is due Oct 24');
    await page.locator('[data-view="needs"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
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
    // #31 money states: Marlow PAID this one and Stripe is still settling it — the
    // server leaves it out of total_cents (processing_cents carries it), so the
    // roster must not call it owed
    { id: 'i5', title: 'Balance (ACH)', amount_cents: 40000, due_date: ymd(-1), status: 'open', state: 'processing', overdue: false, processing_since: new Date(Date.now() - 3600_000).toISOString(), deal_id: DEAL, deal: 'Marlow rebuild', stripe_url: 'https://pay.example/5', client_id: 'c1', customer_site_id: 'a1' },
  ], paid: [], total_cents: 280000, overdue_cents: 80000, processing_cents: 40000 } };

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
    await page.locator('.thb[data-sort="owed"]').click();      // Outstanding reads most-first on its first click
    await expect(table.locator('tbody tr').first()).toContainText('Marlow’s Kitchen');
    await expect(page.locator('.lmeta')).toContainText('Sorted by Outstanding — descending');
  });

  test('a settling (processing) payment is not owed: Outstanding matches the server’s total_cents, never the sum of every row', async ({ page }) => {
    await pinDisplay(page, 'table');
    // Marlow's only open money is the $400 the client already paid — nothing is owed
    const settling = { data: { ...receivables.data, items: receivables.data.items.filter((i) => i.client_id !== 'c1' || i.state === 'processing'), total_cents: 80000, overdue_cents: 0, processing_cents: 40000 } };
    await installApp(page, { api: { ...homeApi, '/sales/receivables': settling } });
    await page.goto('/agency.html');
    const table = page.locator('.tscroll table');
    await expect(table.locator('tbody tr', { hasText: 'Park Florist' }).locator('td.money .owed')).toHaveText('$300');   // the column is live…
    await expect(table.locator('tbody tr', { hasText: 'Marlow’s Kitchen' }).locator('td.money')).toHaveText('—');          // …and Marlow owes nothing
    await page.locator('[data-view="owed"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).not.toContainText('Marlow’s Kitchen');
  });

  test('the Outstanding chip shows only clients who owe', async ({ page }) => {
    await pinDisplay(page, 'table');
    await installApp(page, { api: { ...homeApi, '/sales/receivables': receivables } });
    await page.goto('/agency.html');
    await page.locator('[data-view="owed"]').click();
    await expect(page.locator('[data-view="owed"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody')).toContainText('Marlow’s Kitchen');
    await expect(page.locator('tbody')).toContainText('Park Florist');
    await expect(page.locator('tbody')).not.toContainText('Bright Dental');
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
    await page.getByRole('menuitem', { name: 'Tags, owner, note, archive' }).click();
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
    await page.getByRole('menuitem', { name: 'Tags, owner, note, archive' }).click();
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
    await page.getByRole('menuitem', { name: 'Tags, owner, note, archive' }).click();
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
    await page.getByRole('menuitem', { name: 'Tags, owner, note, archive' }).click();
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
    await page.getByRole('menuitem', { name: 'Tags, owner, note, archive' }).click();
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
    await page.getByRole('menuitem', { name: 'Tags, owner, note, archive' }).click();
    const form = page.locator('form[data-hkform="a1"]');
    await expect(form.locator('[name="tags"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More for Marlow’s Kitchen' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'More for Marlow’s Kitchen' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a read-only member’s ⋯ holds only "Their website"; a bridged-only customer has no ⋯; the search matches tags', async ({ page }) => {
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
    await page.getByRole('button', { name: 'More for Marlow’s Kitchen' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Their website']);   // no kit, no housekeeping without manage_clients
  });
});

// ── Wave 2 doors (Oct 2026 studio audit change 11 + bug 10) ───────────────────
test.describe('Agency home — the Health Center door and the kits anchor', () => {
  test('all areas fine → "Platform: all clear →", still a link to the Health Center', async ({ page }) => {
    await installApp(page, { api: { ...homeApi, '/admin/health-center': { data: { overall: 'ok', areas: [
      { key: 'cron', label: 'Scheduled operations', state: 'ok', detail: 'Running.' }, { key: 'ai', label: 'AI', state: 'off', detail: 'Not configured.' },
    ] } } } });
    await page.goto('/agency.html');
    const door = page.locator('#top #healthDoor');
    await expect(door).toContainText('Platform: all clear');
    await expect(door).toHaveAttribute('href', '/admin-health.html');
    await expect(page.locator('#healthLine .warnw')).toHaveCount(0);
  });

  test('⌘K "Starter kits" lands on #kits: the kits card left the home, so Add a customer opens (where "Start from a kit" lives)', async ({ page }) => {
    await installApp(page, { api: { ...homeApi, '/agency/kits': { data: [{ id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', name: 'Restaurant starter', industry_key: 'restaurant' }] } } });
    await page.goto('/agency.html#kits');
    await expect(page.locator('#custDlg')).toBeVisible();
    await expect(page.locator('#cu-kit-wrap')).toBeVisible();
    await expect(page.locator('#cu-kit option')).toHaveText(['No kit — start empty', 'Restaurant starter']);
    expect(new URL(page.url()).hash).toBe('');
    await expect(page.locator('#kits, .kitcard')).toHaveCount(0);
  });
});
