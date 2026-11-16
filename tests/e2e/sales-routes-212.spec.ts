import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_NAV } from './helpers/app';
import { headerAction } from './helpers/page-header';   // builder item 165: on a phone the header's other actions wait behind ⋯

// ── The page halves of tests/presence/sales_routes_test.mjs (builder item 212) ──
// That suite used to read these pages' source and match its text. These are the same
// properties as behaviour, in a real browser against the real pages. Each was not
// already proven by another spec (the suite lists the ones that were):
//   · Add a customer on Contacts: the button opens the dialog with the name field
//     focused, every label names its field, the words are about their work (never a
//     software plan), "Invitation sent to …" and "They already have a workspace"
//   · Customers and Contacts (agency): a chosen kit is applied to the NEW site the
//     set-up names, and a kit that fails never repaints the set-up as a failure
//   · the proposal editor: each line picks from the studio's services (or Custom…),
//     a pick fills the name and price and stays editable; an empty catalog is free
//     text with a way to add services
//   · the New deal dialog names whose contact an email already belongs to
//   · the board and the deal page offer only the stage moves the server allows
//   · doc.html is never indexed
// Every write a test makes the page send is answered on purpose and asserted; any
// other write is caught by planWrites and fails the test. All names are made up.

const past = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const answer = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Catch every write the page sends that a test did not plan for (answered 500, listed).
// Register it BEFORE the planned routes: Playwright tries the newest route first.
async function planWrites(page: Page): Promise<string[]> {
  const unplanned: string[] = [];
  await page.route('**/functions/v1/presence/**', (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.fallback();
    unplanned.push(`${m} ${new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '')}`);
    return route.fulfill(answer(500, { error: 'unplanned_write' }));
  });
  return unplanned;
}

// ── Add a customer ───────────────────────────────────────────────────────────
const CONTACTS = { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Rivera Patios', updated_at: past(2) }] };
const CUSTOMERS = { data: [{ client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', project_name: 'Site', status: 'active', customer_site_id: 'site-acme', open_support: 0, project_count: 1 }] };
const NEW_SITE = 'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa';
const KIT_R = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', KIT_T = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const KITS = { data: [{ id: KIT_R, name: 'Restaurant starter' }, { id: KIT_T, name: 'Trades starter' }] };
const SET_UP = { data: { created: true, invited: true, client_id: 'c-9', site_id: NEW_SITE, portal_url: 'https://studio.example/portal.html' } };
const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
} };
const pin = (page: Page, key: string, value: string) =>
  page.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); } catch { /* storage denied */ } }, [key, value]);

test.describe('Add a customer on Contacts (sales routes, item 212)', () => {
  test('+ Add a customer opens the box focused on the name, its labels name their fields, and it saves the customer and nothing else', async ({ page }) => {
    await pin(page, 'dds-display:contacts', 'table');
    await installApp(page, { api: { '/sales/contacts': CONTACTS } });
    const unplanned = await planWrites(page);
    const posts: Array<Record<string, unknown>> = [];
    await page.route('**/functions/v1/presence/sales/customers', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts.push(route.request().postDataJSON());
      return route.fulfill(posts.length === 1 ? answer(201, { data: { mode: 'save', saved: true, created: true, client_id: 'c-7', email: 'jane@acmebakery.example' } })
        : answer(200, { data: { mode: 'save', saved: true, already: true, created: false, client_id: 'c-8', email: 'sam@example.com' } }));
    });
    await page.goto('/contacts.html');
    const add = page.locator('#addCust');
    await expect(add).toContainText('Add a customer');
    await (await headerAction(page, '#addCust')).click();
    const dlg = page.locator('#custDlg');
    await expect(dlg).toBeVisible();
    await expect(page.locator('#cu-name')).toBeFocused();   // the box's own focus lands a beat after it opens
    await expect(dlg).toContainText('No website is made and nobody is emailed.');
    expect((await dlg.textContent()) || '').not.toMatch(/subscription|SaaS|per month|\/mo\b/i);
    // each label names its field: filling by the words on screen reaches the right input
    await dlg.getByLabel('Their name').fill('Jane Doe');
    await dlg.getByLabel('Email', { exact: true }).fill('jane@acmebakery.example');
    await dlg.getByLabel('Business name (optional)').fill('Acme Bakery');
    await page.locator('#cu-submit').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ mode: 'save', name: 'Jane Doe', business_name: 'Acme Bakery', email: 'jane@acmebakery.example' });
    const done = page.locator('#cust-done');
    await expect(done.locator('h3')).toHaveText('Saved to your customers');
    // the same person again: the server says they're already a customer, and so does the box
    await done.getByRole('button', { name: 'Add another' }).click();
    await expect(page.locator('#cu-name')).toBeFocused();
    await dlg.getByLabel('Email', { exact: true }).fill('sam@example.com');
    await page.locator('#cu-submit').click();
    await expect(done.locator('h3')).toHaveText('Already your customer');
    await expect(done).toContainText('Nothing new was made.');
    expect(posts).toHaveLength(2);
    expect(unplanned).toEqual([]);
  });

  for (const file of ['customers.html', 'contacts.html'] as const) {
    test(`${file}: the box offers no starter kit and reads none (a kit starts a website, from New site)`, async ({ page }) => {
      await pin(page, file === 'customers.html' ? 'dds-display:customers' : 'dds-display:contacts', 'table');
      let kitReads = 0;
      await installApp(page, { api: { ...(file === 'customers.html' ? { '/studio/customers': CUSTOMERS } : { '/sales/contacts': CONTACTS }), '/portal/context': AGENCY_CTX } });
      await page.route('**/functions/v1/presence/agency/kits', (route) => { kitReads++; return route.fulfill(answer(200, KITS)); });
      await page.goto('/' + file);
      await (await headerAction(page, '#addCust')).click();
      await expect(page.locator('#cu-name')).toBeFocused();
      await expect(page.locator('#cu-kit, #cu-kit-wrap')).toHaveCount(0);
      expect(kitReads).toBe(0);
    });
  }
});

// ── Pipeline ─────────────────────────────────────────────────────────────────
const DEAL = 'dddddddd-2120-4212-8212-dddddddddd01';
const D_QUAL = 'dddddddd-2120-4212-8212-dddddddddd02', D_PROP = 'dddddddd-2120-4212-8212-dddddddddd03', D_CON = 'dddddddd-2120-4212-8212-dddddddddd04';
const D_WON = 'dddddddd-2120-4212-8212-dddddddddd05', D_LOST = 'dddddddd-2120-4212-8212-dddddddddd06';
const card = (id: string, title: string, stage: string) => ({ id, title, stage, source: 'manual', expected_value_cents: 120000, expected_close: null, contact_id: 'c1', converted_client_id: null, updated_at: past(1), created_at: past(5), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false });
const detail = (id: string, stage: string, extra: Record<string, unknown> = {}) => ({ data: {
  deal: { id, title: 'Blue Finch — site', stage, expected_value_cents: 0, contact_id: 'c1', converted_client_id: null, next_step: null, next_step_at: null, notes: '', lost_reason: '', retainer: null, ...extra },
  contact: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
} });
const SERVICES = { data: [{ name: 'Website build', price_cents: 320000 }, { name: 'Logo refresh', price_cents: 60000 }] };
const PIPE = {
  '/sales/deals': { data: [card(DEAL, 'Blue Finch — site', 'lead'), card(D_QUAL, 'Harbor Lane — logo', 'qualified'), card(D_PROP, 'Larkspur — booking', 'proposal'), card(D_CON, 'Juniper — menu', 'contract')] },
  [`/sales/deals/${DEAL}`]: detail(DEAL, 'lead'),
  [`/sales/deals/${D_WON}`]: detail(D_WON, 'won'),
  [`/sales/deals/${D_LOST}`]: detail(D_LOST, 'lost', { lost_reason: 'Went with a friend' }),
  [`/sales/deals/${DEAL}/tasks`]: { data: [] }, [`/sales/deals/${D_WON}/tasks`]: { data: [] }, [`/sales/deals/${D_LOST}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 4, open: { count: 4, value_cents: 480000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], expected: { value_cents: 0 }, ar: { outstanding_cents: 0, count: 0 } } },
  '/sales/contacts': { data: [{ id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', updated_at: past(1) }] },
  '/sales/templates': { data: [] },
  '/sales/services': SERVICES,
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Bright Studio' } },
};

test.describe('Pipeline (sales routes, item 212)', () => {
  test('a proposal line picks from the studio\'s services or Custom…, a pick fills the name and price, and the line stays editable', async ({ page }) => {
    await installApp(page, { api: PIPE });
    const unplanned = await planWrites(page);
    const saved: Array<Record<string, unknown>> = [];
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/proposals`, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      saved.push(route.request().postDataJSON());
      return route.fulfill(answer(201, { data: { id: 'p-new', status: 'draft' } }));
    });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    await page.locator('#addProp').click();
    await page.locator('#plMore').click();                                   // a fresh line
    const line = page.locator('#propForm .prop-line').last();
    const pick = line.locator('.pl-pick');
    await expect(pick).toHaveValue('');
    await expect(pick.locator('option')).toHaveText(['Pick a service…', 'Website build — $3,200', 'Logo refresh — $600', 'Custom…']);
    await expect(line.locator('.pl-custom')).toBeHidden();                  // nothing to type until something is picked
    await pick.selectOption({ label: 'Logo refresh — $600' });
    await expect(line.locator('.pl-label')).toHaveValue('Logo refresh');
    await expect(line.locator('.pl-price')).toHaveValue('600');
    await expect(line.locator('.pl-custom')).toBeVisible();
    await line.locator('.pl-label').fill('Logo refresh, two rounds');          // still the owner's to change
    // Custom… is a blank line to type into
    await page.locator('#plMore').click();
    const custom = page.locator('#propForm .prop-line').last();
    await custom.locator('.pl-pick').selectOption('__custom__');
    await expect(custom.locator('.pl-label')).toHaveValue('');
    await expect(custom.locator('.pl-label')).toBeFocused();
    await custom.locator('.pl-label').fill('Photo shoot');
    await custom.locator('.pl-price').fill('450');
    await page.locator('#plSave').click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0].line_items).toEqual(expect.arrayContaining([{ label: 'Logo refresh, two rounds', qty: 1, unit_cents: 60000 }, { label: 'Photo shoot', qty: 1, unit_cents: 45000 }]));
    expect(unplanned).toEqual([]);
  });

  test('with no services yet a proposal line is plain text, and "Add your services" opens the services editor', async ({ page }) => {
    await installApp(page, { api: { ...PIPE, '/sales/services': { data: [] } } });
    const unplanned = await planWrites(page);
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    await page.locator('#addProp').click();
    await expect(page.locator('#propForm .pl-pick')).toHaveCount(0);
    await expect(page.locator('#propForm .pl-label').first()).toBeVisible();
    await expect(page.locator('#propForm .pl-price').first()).toBeVisible();
    const hint = page.locator('#plManageHint');
    await expect(hint).toHaveText('Add your services');
    await hint.click();
    await expect(page.locator('#svcDlg')).toBeVisible();
    await page.locator('#svcCancel').click();
    await expect(page.locator('#svcDlg')).toBeHidden();
    expect(unplanned).toEqual([]);                                             // looking writes nothing
  });

  test('the New deal dialog says whose contact an email already belongs to, and links that contact', async ({ page }) => {
    await installApp(page, { api: PIPE });
    const unplanned = await planWrites(page);
    const contacts: unknown[] = [], deals: unknown[] = [];
    await page.route('**/functions/v1/presence/sales/contacts', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      contacts.push(route.request().postDataJSON());
      return route.fulfill(answer(200, { data: { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com' }, deduped: true }));
    });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?.*)?$/, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      deals.push(route.request().postDataJSON());
      return route.fulfill(answer(201, { data: { id: DEAL } }));
    });
    await page.goto('/pipeline.html');
    await page.locator('#newDeal').click();
    await page.locator('#f-title').fill('Sunrise Yoga — site');
    await page.locator('#f-name').fill('Jo Vance');
    await page.locator('#f-email').fill('dana@example.com');
    await page.locator('#formDlg').getByRole('button', { name: 'Create deal' }).click();
    const note = page.locator('.dds-toast').filter({ hasText: 'already belongs to' });
    await expect(note).toContainText('dana@example.com already belongs to Dana Lee');
    await expect(note).toContainText('The name you typed (Jo Vance) wasn’t kept.');
    expect(contacts).toEqual([{ email: 'dana@example.com', name: 'Jo Vance' }]);
    expect(deals).toEqual([{ title: 'Sunrise Yoga — site', contact_id: 'ct-2' }]);   // the contact that owns the email
    expect(unplanned).toEqual([]);
  });

  // The server's ladder (lib/sales_lifecycle.ts canTransition; tests/presence/sales_routes_test.mjs
  // drives every pair): one step on, one back, Not a fit from any open stage, Not a fit back
  // to New lead, and Won only by converting.
  const MOVES: Array<[string, string, string[]]> = [
    [DEAL, 'lead', ['Move to Qualified', 'Mark as not a fit']],
    [D_QUAL, 'qualified', ['Move to Proposal sent', 'Move to New lead', 'Mark as not a fit']],
    [D_PROP, 'proposal', ['Move to Agreement out', 'Move to Qualified', 'Mark as not a fit']],
    [D_CON, 'contract', ['Move to Proposal sent', 'Mark as not a fit']],
  ];
  test('the board\'s Move menu offers only the moves the server allows from each stage, and never Won', async ({ page }) => {
    await pin(page, 'dds-display:pipeline', 'board');
    await installApp(page, { api: PIPE });
    const unplanned = await planWrites(page);
    await page.goto('/pipeline.html');
    for (const [id, stage, labels] of MOVES) {
      if ((page.viewportSize()?.width || 0) <= 760) await page.locator(`[data-stab="${stage}"]`).click();   // a phone shows one stage at a time
      const move = page.locator(`#board .bcard[data-id="${id}"] .bc-move`);
      await move.click();
      await expect(page.locator('#board .bc-menu').getByRole('menuitem')).toHaveText(labels);
      await page.keyboard.press('Escape');
      await expect(page.locator('#board .bc-menu')).toHaveCount(0);
    }
    expect(unplanned).toEqual([]);
  });

  test('the deal page offers Not a fit only where the server allows it, and a Not a fit deal only reopens as a new lead', async ({ page }) => {
    await installApp(page, { api: PIPE });
    const unplanned = await planWrites(page);
    const moved: unknown[] = [];
    await page.route(`**/functions/v1/presence/sales/deals/${D_LOST}/stage`, (route) => {
      moved.push(route.request().postDataJSON());
      return route.fulfill(answer(200, { data: { id: D_LOST, stage: 'lead' } }));
    });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await expect(page.locator('#markLost')).toBeVisible();                   // an open deal can be marked Not a fit
    await page.goto(`/pipeline.html?deal=${D_WON}`);
    await expect(page.locator('#dealLife')).toBeVisible();
    await expect(page.locator('#markLost')).toHaveCount(0);                  // a won deal moves nowhere
    await expect(page.locator('#dealLife [data-stage]')).toHaveCount(0);
    await page.goto(`/pipeline.html?deal=${D_LOST}`);
    await expect(page.locator('#markLost')).toHaveCount(0);
    const reopen = page.locator('#dealLife').getByRole('button', { name: 'Reopen this deal' });
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect.poll(() => moved.length).toBe(1);
    expect(moved[0]).toEqual({ to: 'lead' });
    expect(unplanned).toEqual([]);
  });
});

// ── doc.html ─────────────────────────────────────────────────────────────────
test.describe('doc.html (sales routes, item 212)', () => {
  test('the document viewer asks search engines not to index it, and a dead link gets the friendly message', async ({ page }) => {
    await page.route('**/functions/v1/presence/sales/doc/**', (route) => route.fulfill({ status: 403, contentType: 'text/plain; charset=utf-8', body: 'refused' }));
    await page.goto('/doc.html?t=an-old-link');
    await expect(page.locator('#state h1')).toHaveText('This document link isn’t working');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
