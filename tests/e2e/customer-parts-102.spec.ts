import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';
import { headerAction } from './helpers/page-header';

// Builder item 102 (Nov 16 2026): the Add a customer box and the deal stage bar each exist
// once. Home, Customers and Contacts used to carry three hand-kept copies of the box, and
// the record and the Pipeline two copies of the bar; the copies had drifted (one box said
// templates, one didn't). Now every page draws the same thing from customer-add.js and
// deal-path.js. Hermetic; every name is made up.

// ── one Add a customer box ──
const BOX_PAGES = [
  { where: 'Home', path: '/agency.html', api: {}, open: '#top button:has-text("+ Add a customer")', list: '/agency/portfolio' },
  { where: 'Customers', path: '/customers.html', api: { '/studio/customers': { data: [] } }, open: '#addCust', list: '/studio/customers' },
  { where: 'Contacts', path: '/contacts.html', api: { '/sales/contacts': { data: [] } }, open: '#addCust', list: '/sales/contacts' },
];
/** What the box offers, read off the page as a person meets it (labels, choices, words). */
async function boxAsSeen(page: Page) {
  const dlg = page.locator('#custDlg');
  await expect(dlg).toBeVisible();
  return dlg.evaluate((d) => ({
    labels: [...d.querySelectorAll('label[for]')].map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim()),
    choices: d.querySelectorAll('input[type=radio], select').length,
    lead: (d.querySelector('.cu-lead')?.textContent || '').trim(),
    button: (d.querySelector('#cu-submit')?.textContent || '').trim(),
  }));
}

test('Home, Customers and Contacts open the very same Add a customer box', async ({ page }) => {
  test.slow();   // three pages in one test
  const seen: Record<string, unknown> = {};
  for (const p of BOX_PAGES) {
    await installApp(page, { api: p.api });
    await page.goto(p.path);
    await (await headerAction(page, p.open)).first().click();   // behind ⋯ on a phone (builder item 165)
    seen[p.where] = await boxAsSeen(page);
    await expect(page.locator('#custDlg')).toHaveCount(1);       // one box on the page, never two
  }
  expect(seen.Customers).toEqual(seen.Home);
  expect(seen.Contacts).toEqual(seen.Home);
  const home = seen.Home as { labels: string[]; choices: number; button: string };
  expect(home.labels).toEqual(['Their name', 'Business name (optional)', 'Email']);   // builder item 241: the customer and nothing else
  expect(home.choices).toBe(0);
  expect(home.button).toBe('Save customer');
});

for (const p of BOX_PAGES) {
  test(`${p.where}: saving sends who they are, and the list is read again after`, async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await installApp(page, { api: { ...p.api, 'POST /sales/customers': (b: Record<string, unknown>) => { sent = b; return { data: { mode: 'save', saved: true, created: true, client_id: 'cccccccc-6666-4666-8666-cccccccccccc' } }; } } });
    await page.goto(p.path);
    await (await headerAction(page, p.open)).first().click();
    const reads: string[] = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (r.method() === 'GET' && u.pathname.endsWith('/presence' + p.list)) reads.push(u.pathname); });
    const dlg = page.locator('#custDlg');
    await expect(page.locator('#cu-name')).toBeFocused();
    await page.locator('#cu-name').fill('Rosa Lind');
    await page.locator('#cu-biz').fill('Lind Café');
    await page.locator('#cu-email').fill('rosa@lindcafe.example');
    await page.locator('#cu-submit').click();
    await expect(page.locator('#cust-done')).toContainText('Saved to your customers');
    expect(sent).toEqual({ mode: 'save', name: 'Rosa Lind', business_name: 'Lind Café', email: 'rosa@lindcafe.example' });
    await expect.poll(() => reads.length).toBeGreaterThan(0);   // the page's own list, read again once they were saved
    await page.locator('#cust-done').getByRole('button', { name: 'Add another' }).click();
    await expect(page.locator('#cu-name')).toBeFocused();
    await expect(page.locator('#cu-name')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });
}

// ── one deal stage bar ──
const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const DEAL_ROW = { id: DEAL, title: 'Website refresh', stage: 'proposal', expected_value_cents: 500000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null, updated_at: '2026-11-10T12:00:00Z' };
const DEAL_READ = { data: { deal: DEAL_ROW, contact: { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example', phone: '', company: 'Juniper Floral Co.', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null, retainer_paid: { cents: 0, count: 0, last_at: null } } };
const LABELS = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };
const STAGES = { data: { labels: LABELS, custom: {}, defaults: LABELS, chances: { lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 }, chance_defaults: {},
  notes: { proposal: 'Follow up two days after it goes out.' }, notes_custom: {}, note_defaults: {} } };
const BAR_API = {
  '/crm/record': { data: { identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null }, header: { name: 'Juniper Floral Co.', person: 'Ivy Chen', email: 'ivy@juniper.example', status: 'customer' },
    highlights: { value_cents: 500000, stage: 'proposal' }, sections: { overview: true, messages: true, deal: true, delivery: false, details: true }, default_tab: 'deal', canonical: { key: 'client', value: CLIENT } } },
  '/crm/activity': { data: { items: [], upcoming: [], project_id: null, deal_id: DEAL, reply_to: null, reply_support_to: null } },
  [`/sales/deals/${DEAL}`]: DEAL_READ,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  [`/sales/contacts/${CID}`]: { data: { contact: { id: CID, name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '' }, custom_fields: [], deals: [] } },
  '/sales/stages': STAGES,
  '/sales/deals': { data: [DEAL_ROW] },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 500000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};
/** The four steps as a person and a screen reader meet them. */
async function stepsAsSeen(page: Page, host: string) {
  const steps = page.locator(`${host} .path [data-pstep]`);
  await expect(steps).toHaveCount(4);
  return steps.evaluateAll((els) => els.map((e) => ({
    stage: e.getAttribute('data-pstep'), text: (e.textContent || '').trim(), name: e.getAttribute('aria-label'),
    state: ['done', 'current', 'canback', 'lost-terminal'].filter((c) => e.classList.contains(c)).join(' '),
    pressable: e.getAttribute('tabindex') !== '-1', look: getComputedStyle(e).borderTopColor + ' ' + getComputedStyle(e).fontWeight,
  })));
}

test('the record and the Pipeline draw the same stage bar for the same deal', async ({ page }) => {
  test.slow();   // two pages in one test
  await installApp(page, { api: BAR_API });
  await page.goto(`/crm.html?client=${CLIENT}`);
  const onRecord = await stepsAsSeen(page, '#pathwrap');
  await installApp(page, { api: BAR_API });
  await page.goto(`/pipeline.html?deal=${DEAL}`);
  const inPipeline = await stepsAsSeen(page, '#pathHost');
  expect(inPipeline).toEqual(onRecord);
  expect(onRecord.map((s) => [s.text, s.state, s.pressable])).toEqual([
    ['✓ New lead', 'done', false], ['✓ Qualified', 'done canback', true], ['Proposal sent', 'current', true], ['Agreement out', '', false],
  ]);
});

test('on the record, the step back asks first and the note under the bar is the shared one', async ({ page }) => {
  let moved: unknown = null;
  await installApp(page, { api: { ...BAR_API, [`POST /sales/deals/${DEAL}/stage`]: (b: unknown) => { moved = b; return { data: { ...DEAL_ROW, stage: 'qualified' } }; } } });
  await page.goto(`/crm.html?client=${CLIENT}`);
  const bar = page.locator('#pathwrap');
  await expect(bar.locator('.stage-note .sn-steps li')).toHaveText(['Follow up two days after it goes out.']);
  await bar.getByRole('button', { name: /^Qualified — complete\. Activate to move the deal back here\./ }).click();
  await expect(bar.locator('.path-confirm')).toContainText('Move this deal back to Qualified?');
  expect(moved).toBeNull();
  await bar.getByRole('button', { name: 'Move back' }).click();
  await expect.poll(() => moved).toEqual({ to: 'qualified' });
  await expect(bar.locator('[data-pstep="qualified"]')).toHaveClass(/current/);
});
