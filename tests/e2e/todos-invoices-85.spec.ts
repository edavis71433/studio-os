import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 85 (Nov 2026): To-dos and Invoices each get a page in the menu (drawn in Figma,
// sections 261:442 and 262:724).
//   To-dos    every open to-do for anyone, grouped by when it's due on the local day; Done with
//             Undo for each kind; add one for a person, a customer, a deal or nobody; narrow it
//             to one person; the Done tab
//   Invoices  four totals on the local day; chips, a search and a month; the status in words; a
//             part payment under its invoice; open the deal, the PDF, record a payment by hand

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const ymd = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const day = (n: number) => ymd(Date.now() + n * 86400000);
const isPhone = (page: Page) => (page.viewportSize()?.width || 1200) < 768;
type Sent = { method: string; path: string; body: unknown };
async function spy(page: Page, sent: Sent[], match: RegExp, answer: (s: Sent) => unknown = () => ({ data: { ok: true } })) {
  await page.route((u) => u.pathname.includes('/functions/v1/presence/') && match.test(u.pathname), (route: Route) => {
    const r = route.request(); if (r.method() === 'GET') return route.fallback();
    const s = { method: r.method(), path: new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '') + new URL(r.url()).search, body: r.postDataJSON?.() ?? null };
    sent.push(s);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(s)) });
  });
}

// ── To-dos ──
const T = (n: number) => `abababab-0000-4000-8000-00000000000${n}`;
const TASKS = { data: { partial: false, done_days: 30, total: 6, items: [
  { kind: 'deal_task', id: T(1), parent_id: 'cccccccc-0000-4000-8000-000000000001', title: 'Send the revised quote', due: day(-2), context: 'Jordan Lee', href: '/crm.html?contact=cccccccc-0000-4000-8000-000000000001', blocked: false, later: false, order: null, for: 'person' },
  { kind: 'next_step', id: 'dddddddd-0000-4000-8000-000000000001', parent_id: 'dddddddd-0000-4000-8000-000000000001', title: 'Call back about the menu photos', due: day(0), context: 'Maple & Rye Bakery', href: '/pipeline.html?deal=dddddddd-0000-4000-8000-000000000001', blocked: false, later: false, order: null },
  { kind: 'project_task', id: T(3), parent_id: 'eeeeeeee-0000-4000-8000-000000000001', title: 'Upload the new team photos', due: day(3), context: 'Northside Dental', href: '/projects.html?project=eeeeeeee-0000-4000-8000-000000000001', blocked: false, later: false, order: 1 },
  { kind: 'deal_task', id: T(4), parent_id: '', title: 'Renew my insurance', due: day(20), context: 'Your own to-do', href: '/todos.html', blocked: false, later: false, order: null, for: 'me' },
  { kind: 'project_task', id: T(5), parent_id: 'eeeeeeee-0000-4000-8000-000000000001', title: 'Wait on their logo', due: null, context: 'Northside Dental', href: '/projects.html?project=eeeeeeee-0000-4000-8000-000000000001', blocked: true, later: false, order: 2 },
  { kind: 'deal_task', id: T(6), parent_id: 'cccccccc-0000-4000-8000-000000000002', title: 'Send the yearly check-in', due: day(1), context: 'Harbor Yoga', href: '/crm.html?client_id=cccccccc-0000-4000-8000-000000000002', blocked: false, later: false, order: null, for: 'customer' },
], done: [{ id: T(7), title: 'Send the welcome pack', context: 'Jordan Lee', href: '/crm.html?contact=cccccccc-0000-4000-8000-000000000001', for: 'person', completed_at: new Date(Date.now() - 2 * 86400000).toISOString() }] } };
const TODO_API = {
  '/portal/context': STUDIO_CTX, '/sales/tasks': TASKS,
  '/sales/contacts': { data: [{ id: 'cccccccc-0000-4000-8000-000000000001', name: 'Jordan Lee', email: 'jordan@example.com' }] },
  '/studio/customers': { data: [{ client_id: 'cccccccc-0000-4000-8000-000000000002', name: 'Harbor Yoga' }] },
  '/sales/deals': { data: [{ id: 'dddddddd-0000-4000-8000-000000000001', title: 'Maple & Rye Bakery', stage: 'proposal', converted_client_id: null }] },
};
test.describe('The To-dos page (item 85)', () => {
  test('every open to-do, grouped by when it is due; each says who it is for and how late', async ({ page }) => {
    await installApp(page, { api: TODO_API });
    await page.goto('/todos.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('To-dos');
    await expect(page.locator('.stat')).toHaveText([/6\s*All open/, /1\s*Overdue/, /1\s*Today/, /2\s*This week/, /2\s*Later/, /1\s*Done · last 30 days/]);
    await expect(page.locator('.ghead')).toHaveText([/Overdue · 1/, /Today · 1/, /This week · 2/, /Later · 1/, /No date · 1/]);
    const row = (t: string) => page.locator('.trow', { hasText: t });
    await expect(row('Send the revised quote').locator('.due')).toHaveText('2 days late');
    await expect(row('Send the revised quote').locator('.who')).toHaveAttribute('href', '/crm.html?contact=cccccccc-0000-4000-8000-000000000001');
    await expect(row('Call back about the menu photos').locator('.kind')).toHaveText('Next step');
    await expect(row('Call back about the menu photos').locator('.due')).toHaveText('Today');
    await expect(row('Send the yearly check-in').locator('.due')).toHaveText('Tomorrow');
    await expect(row('Upload the new team photos').locator('.kind')).toHaveText('Project step');
    await expect(row('Wait on their logo').getByRole('button', { name: 'Done: Wait on their logo' })).toBeDisabled();   // blocked on the project
    // Later waits behind Show on the whole list
    await expect(page.locator('.trow', { hasText: 'Renew my insurance' })).toHaveCount(0);
    await page.locator('.ghead', { hasText: 'Later' }).getByRole('button', { name: 'Show ▾' }).click();
    await expect(row('Renew my insurance')).toBeVisible();
    await expect(row('Renew my insurance').locator('.who')).toHaveCount(0);   // your own: no one to name
    // a chip shows its part
    await page.locator('.stat', { hasText: 'Overdue' }).click();
    await expect(page.locator('.trow[data-row]')).toHaveCount(1);
    // the Done tab
    await page.locator('.stat', { hasText: 'Done' }).click();
    await expect(page.locator('.trow.isdone')).toHaveCount(1);
    await expect(page.locator('.trow.isdone')).toContainText('Send the welcome pack');
  });

  test('Done uses the route that owns each kind, and Undo puts it back', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: TODO_API });
    await spy(page, sent, /\/sales\/(deal-tasks|deals)\/|\/projects\//);
    await page.goto('/todos.html');
    await page.getByRole('button', { name: 'Done: Send the revised quote' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'PATCH', path: `/sales/deal-tasks/${T(1)}`, body: { status: 'done' } });
    await expect(page.locator('.trow', { hasText: 'Send the revised quote' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Done: Call back about the menu photos' })).toBeFocused();   // focus moves to the next one
    await page.locator('.dds-toast', { hasText: 'Done: Send the revised quote' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ method: 'PATCH', path: `/sales/deal-tasks/${T(1)}`, body: { status: 'open' } });
    await page.getByRole('button', { name: 'Done: Call back about the menu photos' }).click();
    await expect.poll(() => sent.length).toBe(3);
    expect(sent[2]).toEqual({ method: 'PATCH', path: '/sales/deals/dddddddd-0000-4000-8000-000000000001', body: { next_step: '', next_step_at: '' } });
    await page.getByRole('button', { name: 'Done: Upload the new team photos' }).click();
    await expect.poll(() => sent.length).toBe(4);
    expect(sent[3]).toEqual({ method: 'PATCH', path: `/projects/eeeeeeee-0000-4000-8000-000000000001/tasks/${T(3)}`, body: { status: 'done' } });
  });

  test('add a to-do for anyone, or for nobody; narrow the list to one person', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: TODO_API });
    await spy(page, sent, /\/sales\/tasks$/, () => ({ data: { id: T(9) } }));
    await page.goto('/todos.html');
    await page.locator('#addTitle').fill('Send the spring offer');
    await page.locator('#addDue').fill('2030-03-01');
    await expect(page.locator('#addFor option')).toContainText(['For anyone', 'Jordan Lee', 'Harbor Yoga', 'Maple & Rye Bakery']);
    await page.locator('#addFor').selectOption({ label: 'Jordan Lee' });
    await page.locator('#addGo').click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'POST', path: '/sales/tasks', body: { title: 'Send the spring offer', due_date: '2030-03-01', contact_id: 'cccccccc-0000-4000-8000-000000000001' } });
    await expect(page.locator('#addTitle')).toHaveValue('');
    await expect(page.locator('#addTitle')).toBeFocused();
    await page.locator('#addTitle').fill('Back up my laptop');
    await page.locator('#addFor').selectOption({ label: 'For anyone' });
    await page.locator('#addTitle').press('Enter');
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].body).toEqual({ title: 'Back up my laptop' });
    // one person's list
    await page.locator('#forFilter').selectOption({ label: 'For: Harbor Yoga' });
    await expect(page.locator('.trow[data-row]')).toHaveCount(1);
    await expect(page.locator('.trow[data-row]')).toContainText('Send the yearly check-in');
  });

  test('on a phone the counts are one sliding row, and nothing runs off the side', async ({ page }) => {
    test.skip(!isPhone(page), 'phone only');
    await installApp(page, { api: TODO_API });
    await page.goto('/todos.html');
    const tops = await page.locator('.stat').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

// ── Invoices ──
const I = (n: number) => `eeeeeeee-1111-4000-8000-00000000000${n}`;
const iso = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const INVOICES = { data: { today: day(0), partial: false, items: [
  { id: I(1), number_label: '#0064', title: 'Website rebuild — balance', amount_cents: 180000, status: 'open', state: 'upcoming', due_date: day(6), issued_at: iso(-8), paid_at: null, paid_method: '', processing: false, payment_for: null, deal_id: 'dddddddd-0000-4000-8000-000000000001', business: 'Maple & Rye Bakery', person: 'Jordan Lee' },
  { id: I(2), number_label: '#0063', title: 'Care plan — November', amount_cents: 35000, status: 'open', state: 'processing', due_date: day(4), issued_at: iso(-10), paid_at: null, paid_method: '', processing: true, payment_for: null, deal_id: null, business: 'Northside Dental', person: 'Priya Shah' },
  { id: I(3), number_label: '#0062', title: 'Booking page add-on', amount_cents: 65000, status: 'open', state: 'overdue', due_date: day(-11), issued_at: iso(-18), paid_at: null, paid_method: '', processing: false, payment_for: null, deal_id: 'dddddddd-0000-4000-8000-000000000003', business: 'Harbor Yoga', person: 'Sam Ortiz' },
  { id: I(4), number_label: '#0061', title: 'Deposit — new site', amount_cents: 120000, status: 'paid', state: 'paid', due_date: day(-5), issued_at: iso(-20), paid_at: iso(-1), paid_method: 'check', processing: false, payment_for: null, deal_id: null, business: 'Blue Heron Plumbing', person: 'Alex Kim' },
  { id: I(5), number_label: '', title: 'Part payment', amount_cents: 20000, status: 'paid', state: 'paid', due_date: null, issued_at: iso(-2), paid_at: iso(-2), paid_method: 'zelle', processing: false, payment_for: I(3), deal_id: 'dddddddd-0000-4000-8000-000000000003', business: 'Harbor Yoga', person: 'Sam Ortiz' },
  { id: I(6), number_label: '#0058', title: 'Holiday banner', amount_cents: 25000, status: 'void', state: '', due_date: day(-30), issued_at: iso(-40), paid_at: null, paid_method: '', processing: false, payment_for: null, deal_id: null, business: 'Lakeside Books', person: 'Chris Park' },
] } };
const INV_API = { '/portal/context': STUDIO_CTX, '/sales/invoices': INVOICES };
test.describe('The Invoices page (item 85)', () => {
  test('four totals on your day; every invoice with its status in words; a part payment under its invoice', async ({ page }) => {
    await installApp(page, { api: INV_API });
    await page.goto('/invoices.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invoices');
    const tot = page.locator('.tot');
    await expect(tot.nth(0).locator('.v')).toHaveText('$2,800');      // open: 1,800 + 350 + 650
    await expect(tot.nth(1).locator('.v')).toHaveText('$650');        // one overdue
    await expect(tot.nth(2).locator('.v')).toHaveText(new Date(Date.now() - 86400000).getMonth() === new Date().getMonth() ? '$1,400' : /\$/);
    await expect(page.locator('.chip')).toHaveText([/All\s*5/, /Unpaid\s*3/, /Overdue\s*1/, /Paid\s*1/, /Void\s*1/]);
    if (!isPhone(page)) {
      const rows = page.locator('tbody tr:not(.part)');
      await expect(rows).toHaveCount(5);
      await expect(rows.nth(0).locator('.st')).toHaveText('Due in 6 days');
      await expect(rows.nth(1).locator('.st')).toHaveText('Processing');
      await expect(rows.nth(2).locator('.st')).toHaveText('Overdue 11 days');
      await expect(rows.nth(3).locator('.st')).toHaveText('Paid by check');
      await expect(rows.nth(4).locator('.st')).toHaveText('Void');
      await expect(page.locator('tbody tr.part')).toContainText('Part paid $200 by Zelle');
      await expect(page.locator('.foot')).toContainText('5 invoices · $4,000 billed · $2,800 unpaid');
      await expect(page.locator('.foot')).toContainText('the void one isn’t counted');
    } else {
      await expect(page.locator('.card')).toHaveCount(5);
      await expect(page.locator('.card').nth(2).locator('.st')).toHaveText('Overdue 11 days');
    }
    // a search and a chip narrow the list; the totals stay whole
    await page.locator('#find').fill('harbor');
    await expect(page.locator('#find')).toBeFocused();
    await expect(page.locator(isPhone(page) ? '.card' : 'tbody tr:not(.part)')).toHaveCount(1);
    await page.locator('#find').fill('');
    await page.locator('.chip', { hasText: 'Unpaid' }).click();
    await expect(page.locator(isPhone(page) ? '.card' : 'tbody tr:not(.part)')).toHaveCount(3);
    await expect(tot.nth(0).locator('.v')).toHaveText('$2,800');
  });

  test('a row opens its deal, gets its PDF, and records a payment by hand', async ({ page }) => {
    const sent: Sent[] = [];
    await installApp(page, { api: { ...INV_API, [`/sales/invoices/${I(1)}/document`]: { url: 'https://app.example/doc.html?t=x', pdf_url: 'https://fn.example/sales/doc/x?format=pdf' } } });
    await spy(page, sent, /\/sales\/invoices\/[^/]+\/payment$/, () => ({ data: { ok: true } }));
    await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null; }) as typeof window.open; });
    await page.goto('/invoices.html');
    const menuOf = (n: string) => page.getByRole('button', { name: `More for invoice ${n}` }).locator('visible=true');
    await menuOf('#0064').click();
    await page.getByRole('menuitem', { name: 'Download PDF' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://fn.example/sales/doc/x?format=pdf']);
    await menuOf('#0062').click();
    await expect(page.getByRole('menuitem')).toHaveText(['Open the deal', 'Download PDF', 'Record a payment']);
    await page.getByRole('menuitem', { name: 'Record a payment' }).click();
    const dlg = page.getByRole('dialog', { name: 'Record a payment' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#payAmt')).toHaveValue('650.00');
    await dlg.locator('#payAmt').fill('400');
    await dlg.getByRole('button', { name: 'Record payment' }).click();
    await expect(dlg.locator('#payErr')).toHaveText('Pick how they paid.');
    await dlg.locator('#payHow').selectOption('check');
    await dlg.locator('#payNote').fill('Check #1042');
    await dlg.getByRole('button', { name: 'Record payment' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].path).toBe(`/sales/invoices/${I(3)}/payment?today=${day(0)}`);
    expect(sent[0].body).toEqual({ amount_cents: 40000, paid_on: day(0), method: 'check', note: 'Check #1042' });
    await expect(page.locator('.dds-toast', { hasText: 'Recorded $400. The rest stays due.' })).toBeVisible();
    // a paid or processing invoice offers no payment to record
    await menuOf('#0063').click();
    await expect(page.getByRole('menuitem')).toHaveText(['Download PDF']);
    await page.keyboard.press('Escape');
    await menuOf('#0062').click();
    await page.getByRole('menuitem', { name: 'Open the deal' }).click();
    await expect(page).toHaveURL(/\/pipeline\.html\?deal=dddddddd-0000-4000-8000-000000000003&dtab=billing/);
  });

  test('Download CSV gives the rows in view', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'one browser is enough for the file');
    await installApp(page, { api: INV_API });
    await page.goto('/invoices.html');
    await page.locator('.chip', { hasText: 'Overdue' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#csvBtn').click()]);
    const text = await (await dl.createReadStream())!.toArray().then((b) => Buffer.concat(b).toString('utf8'));
    expect(text.split('\n')[0]).toBe('Number,Customer,Person,What for,Amount,Issued,Due,Status');
    expect(text.split('\n')[1]).toContain('#0062,Harbor Yoga,Sam Ortiz,Booking page add-on,650.00');
    expect(text.trim().split('\n')).toHaveLength(2);
  });

  test('an older server says the page is on its way', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    await page.route((u) => u.pathname.endsWith('/sales/invoices'), (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
    await page.goto('/invoices.html');
    await expect(page.locator('.center h2')).toHaveText('Invoices is on its way.');
    await expect(page.getByRole('link', { name: 'Open Who owes you →' })).toHaveAttribute('href', '/pipeline.html#outstanding');
  });

  test('To-dos on an older server says so too', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    await page.route((u) => u.pathname.endsWith('/sales/tasks'), (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
    await page.goto('/todos.html');
    await expect(page.locator('.center h2')).toHaveText('To-dos is on its way.');
    await expect(page.getByRole('link', { name: 'Open Pipeline →' })).toBeVisible();
  });
});

test.describe('Both pages read clearly (item 85)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`To-dos and Invoices pass the contrast check (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: { ...TODO_API, '/sales/invoices': INVOICES } });
      await page.goto('/todos.html');
      await expect(page.locator('.trow[data-row]').first()).toBeVisible();
      expect((await new AxeBuilder({ page }).include('#main').withRules(['color-contrast']).analyze()).violations).toEqual([]);
      await page.goto('/invoices.html');
      await expect(page.locator('.tot').first()).toBeVisible();
      expect((await new AxeBuilder({ page }).include('#main').withRules(['color-contrast']).analyze()).violations).toEqual([]);
    });
  }
});
