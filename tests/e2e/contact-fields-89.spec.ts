import { test, expect, Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 89 (Nov 2026): a contact holds an address, a job title, a second phone and
// tags; every phone number is a tap to call, and a call made from a deal offers to log
// it on the way back. Item 105's Save & New rides along on the two add forms (a contact,
// a deal). Drawn in Figma, section 13 (frames 4, 5 and 13). Every name is made up.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const PEOPLE = [
  { id: 'ct-1', name: 'Marcus Bell', email: 'marcus@harbordental.example', phone: '(555) 010-4410', phone2: '', company: 'Harbor Dental', job_title: 'Office manager', tags: ['dental', 'referral'], updated_at: '2026-11-01T00:00:00Z' },
  { id: 'ct-2', name: 'Maya Ruiz', email: 'maya@bluefinch.example', phone: '(555) 010-6120', phone2: '', company: 'Blue Finch Café', job_title: 'Owner', tags: ['restaurant'], updated_at: '2026-10-28T00:00:00Z' },
  { id: 'ct-3', name: 'Sam Ortiz', email: 'sam@ortizphoto.example', phone: '', phone2: '', company: '', job_title: '', tags: [], updated_at: '2026-10-20T00:00:00Z' },
];
async function contactsRoute(page: Page, people = PEOPLE) {
  const posts: Record<string, unknown>[] = [], patches: Record<string, unknown>[] = [], gets: URL[] = [];
  await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?.*)?$/, (route) => {
    const r = route.request();
    if (r.method() === 'POST') { const b = r.postDataJSON(); posts.push(b); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'new-' + posts.length, ...b } }) }); }
    const u = new URL(r.url()); gets.push(u);
    const tag = u.searchParams.get('tag');
    const rows = tag ? people.filter((c) => c.tags.includes(tag)) : people;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows, total: rows.length, limit: 100, offset: 0 }) });
  });
  await page.route(/\/functions\/v1\/presence\/sales\/contacts\/ct-[0-9]+$/, (route) => {
    const r = route.request();
    if (r.method() === 'PATCH') { patches.push(r.postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); }
    const c = people.find((x) => r.url().endsWith(x.id))!;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { contact: { ...c, address: { street: '12 Elm St', city: 'Glendale', state: 'CA', zip: '91203' }, found_via: 'Referral', custom: {} }, deals: [], timeline: [], custom_fields: [] } }) });
  });
  return { posts, patches, gets };
}
const wide = (page: Page) => (page.viewportSize()?.width || 0) > 760;

test.describe('Contacts hold more (item 89)', () => {
  test('a new contact takes a job title, a second phone, an address and tags', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    const seen = await contactsRoute(page);
    await page.goto('/contacts.html');
    await page.locator('#new').click();
    const dlg = page.locator('#newDlg');
    await expect(dlg).toBeVisible();
    await dlg.locator('#c-name').fill('Ana Ruiz');
    await dlg.locator('#c-email').fill('ana@example.com');
    await dlg.locator('#c-phone').fill('(555) 010-2211');
    await dlg.locator('#c-phone2').fill('(555) 010-3300');
    await dlg.locator('#c-title').fill('Owner');
    await dlg.locator('#c-company').fill('Bluebird Bakery');
    await dlg.locator('#c-street').fill('12 Elm St');
    await dlg.locator('#c-city').fill('Glendale');
    await dlg.locator('#c-state').fill('CA');
    await dlg.locator('#c-zip').fill('91203');
    const tags = dlg.locator('#c-tags');
    await tags.fill('Referral'); await tags.press('Enter');
    await tags.pressSequentially('restaurant,');
    await expect(dlg.locator('.dds-tags .chip')).toHaveText(['referral✕', 'restaurant✕']);
    await dlg.locator('.dds-tags .chip button').first().click();   // ✕ takes one off
    await expect(dlg.locator('.dds-tags .chip')).toHaveCount(1);
    await tags.fill('past client');                               // still being typed when saved: it counts
    await dlg.locator('#c-found').selectOption('Google');
    await dlg.locator('#c-add').click();
    await expect.poll(() => seen.posts.length).toBe(1);
    expect(seen.posts[0]).toMatchObject({ name: 'Ana Ruiz', phone2: '(555) 010-3300', job_title: 'Owner', company: 'Bluebird Bakery', address: { street: '12 Elm St', city: 'Glendale', state: 'CA', zip: '91203' }, tags: ['restaurant', 'past client'], found_via: 'Google' });
    await expect(dlg).toBeHidden();
  });

  test('Save & New saves and clears the form for the next person (item 105)', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    const seen = await contactsRoute(page);
    await page.goto('/contacts.html');
    await page.locator('#new').click();
    const dlg = page.locator('#newDlg');
    for (const [name, title] of [['Ana Ruiz', 'Owner'], ['Theo Grant', 'Chef']]) {
      await dlg.locator('#c-name').fill(name);
      await dlg.locator('#c-title').fill(title);
      await dlg.locator('#c-tags').fill('expo'); await dlg.locator('#c-tags').press('Enter');
      await dlg.locator('#c-again').click();
      await expect(page.getByText(`${name} added — ready for the next one.`)).toBeVisible();
      await expect(dlg).toBeVisible();
      await expect(dlg.locator('#c-name')).toHaveValue('');
      await expect(dlg.locator('#c-title')).toHaveValue('');
      await expect(dlg.locator('.dds-tags .chip')).toHaveCount(0);
      await expect(dlg.locator('#c-name')).toBeFocused();
    }
    expect(seen.posts.map((p) => p.name)).toEqual(['Ana Ruiz', 'Theo Grant']);
    await dlg.locator('#c-cancel').click();
    await expect(dlg).toBeHidden();
  });

  test('rows show the job title and tags; a tag lists everyone with it', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    await contactsRoute(page);
    await page.goto('/contacts.html');
    const marcus = page.locator('[data-open="ct-1"]');
    await expect(marcus).toContainText('Office manager');
    await expect(marcus.locator('[data-tag]')).toHaveText(['dental', 'referral']);
    await marcus.locator('[data-tag="referral"]').click();
    await expect(page.locator('#listZone [data-open]')).toHaveCount(1);
    await expect(page.locator('.tagfilter')).toContainText('Tagged referral');
    await expect(page.locator('#tagOff')).toBeFocused();
    await page.locator('#tagOff').click();
    await expect(page.locator('#listZone [data-open]')).toHaveCount(3);
  });

  test('a tag past the first hundred people is asked of the server', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    // the first page holds one "restaurant" person; two more are past it
    const many = [{ ...PEOPLE[1] }, ...Array.from({ length: 99 }, (_, i) => ({ ...PEOPLE[2], id: 'ct-' + (100 + i), name: `Person ${i}` })),
      { ...PEOPLE[1], id: 'ct-200', name: 'Lena Ortiz' }, { ...PEOPLE[1], id: 'ct-201', name: 'Kai Brooks' }];
    const gets: URL[] = [];
    await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?.*)?$/, (route) => {
      const u = new URL(route.request().url()); gets.push(u);
      const tag = u.searchParams.get('tag');
      const rows = tag ? many.filter((c) => c.tags.includes(tag)) : many.slice(0, 100);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows, total: tag ? rows.length : many.length, limit: 100, offset: 0 }) });
    });
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await page.locator('#listZone [data-tag="restaurant"]').first().click();
    await expect.poll(() => gets.some((u) => u.searchParams.get('tag') === 'restaurant')).toBe(true);
    await expect(page.locator('#listZone [data-open]')).toHaveCount(3);
    await expect(page.locator('#lmeta')).toContainText('3 contacts');
  });

  test('Edit fills and saves the new fields', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    const seen = await contactsRoute(page);
    await page.goto('/contacts.html');
    await page.locator('[data-edit="ct-1"]').first().click();
    const dlg = page.locator('#editDlg');
    await expect(dlg.locator('#e-title')).toHaveValue('Office manager');
    await expect(dlg.locator('#e-city')).toHaveValue('Glendale');
    await expect(dlg.locator('#e-found')).toHaveValue('Referral');
    await expect(dlg.locator('.dds-tags .chip')).toHaveCount(2);
    await dlg.locator('#e-phone2').fill('(555) 010-9999');
    await dlg.locator('#e-save').click();
    await expect.poll(() => seen.patches.length).toBe(1);
    expect(seen.patches[0]).toMatchObject({ phone2: '(555) 010-9999', job_title: 'Office manager', tags: ['dental', 'referral'], address: { city: 'Glendale' }, found_via: 'Referral' });
  });
});

// ── the record ──
const RECORD = { data: {
  identity: { client_id: 'c-harbor', customer_site_id: 'site-harbor', project_id: null, deal_id: 'd-1', contact_id: 'ct-1' },
  header: { name: 'Harbor Dental', person: 'Marcus Bell', company: 'Harbor Dental', email: 'marcus@harbordental.example', phone: '(555) 010-4410', phone2: '(555) 010-6619', job_title: 'Office manager', address: '12 Elm St, Glendale, CA 91203', tags: ['dental', 'referral'], status: 'customer' },
  highlights: {}, sections: { overview: true, details: true, deal: true }, default_tab: 'details', canonical: { key: 'client', value: 'site-harbor' },
} };
test.describe('The record shows them (item 89)', () => {
  test('job title, both phones as calls, the address and the tags', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/record': RECORD, '/crm/activity': { data: { items: [], upcoming: [] } } } });
    await page.goto('/crm.html?client=site-harbor');
    const card = page.locator('.dcard');
    await expect(card).toContainText('Office manager');
    await expect(card).toContainText('12 Elm St, Glendale, CA 91203');
    await expect(card.locator('.dds-tag')).toHaveText(['dental', 'referral']);
    await expect(card.locator('a[href="tel:5550104410"]')).toHaveAttribute('data-call-deal', 'd-1');
    await expect(card.locator('a[href="tel:5550106619"]')).toBeVisible();
  });
});

// ── tap to call on Pipeline, then log it ──
const DEALS = [{ id: 'd-1', title: 'Harbor Dental — new website', stage: 'proposal', contact_id: 'ct-1', expected_value_cents: 420000, source: 'manual', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-08T00:00:00Z' }];
const PIPE = {
  '/portal/context': STUDIO_CTX,
  '/sales/deals': { data: DEALS },
  '/sales/contacts': { data: PEOPLE },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 420000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], expected: { value_cents: 0 }, ar: { outstanding_cents: 0, count: 0, overdue_cents: 0, overdue_count: 0, processing_cents: 0 } } },
  '/settings': { data: { stage_stale_days: {} } },
  '/crm/activity': { data: { items: [], upcoming: [] } },
  '/sales/deals/d-1': { data: { deal: { ...DEALS[0], expected_close: null, next_step: null, next_step_at: null, notes: '', converted_client_id: null, retainer: null },
    contact: { id: 'ct-1', name: 'Marcus Bell', email: 'marcus@harbordental.example', phone: '(555) 010-4410', phone2: '(555) 010-6619', company: 'Harbor Dental', notes: '' },
    proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null } },
  '/sales/deals/d-1/tasks': { data: [] },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Example Studio' } },
};
test.describe('Tap to call (item 89)', () => {
  test('the deal’s preview and the deal itself call the contact; back from the call, it offers to log it', async ({ page }) => {
    await installApp(page, { api: PIPE });
    await page.goto('/pipeline.html');
    if (!wide(page)) await page.locator('[data-stab="proposal"]').click();
    await page.locator('#board .bcard[data-id="d-1"]').click();
    const call = page.locator('#dprev a.dp-call');
    await expect(call).toHaveText(/Call \(555\) 010-4410/);
    await expect(call).toHaveAttribute('href', 'tel:5550104410');
    // a tap leaves for the dialler (the page goes hidden), then comes back: one prompt
    await page.evaluate(() => { document.addEventListener('click', (e) => { if ((e.target as Element).closest('a[href^="tel:"]')) e.preventDefault(); }); });
    await call.evaluate((a) => (a as HTMLElement).click());   // a tel: tap, without waiting on a navigation that never comes
    await page.evaluate(() => {
      const set = (v: string) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
      set('hidden'); set('visible');
    });
    const ask = page.locator('.dds-toast').filter({ hasText: 'Back from your call with Marcus Bell?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Log it' }).click();
    await expect(page.locator('#dds-cr')).toBeVisible();   // + Create's Log a call, on that deal
  });

  test('a tap that never left the page asks nothing', async ({ page }) => {
    await installApp(page, { api: PIPE });
    await page.goto('/pipeline.html?deal=d-1');
    const link = page.locator('.dh-sub a[href="tel:5550104410"]');
    await expect(link).toBeVisible();
    await expect(page.locator('.dh-sub a[href="tel:5550106619"]')).toBeVisible();
    await page.evaluate(() => { document.addEventListener('click', (e) => { if ((e.target as Element).closest('a[href^="tel:"]')) e.preventDefault(); }); });
    await link.evaluate((a) => (a as HTMLElement).click());
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(400);
    await expect(page.locator('.dds-toast').filter({ hasText: 'Back from your call' })).toHaveCount(0);
  });

  test('New deal has Save & New (item 105)', async ({ page }) => {
    await installApp(page, { api: PIPE });
    const posts: string[] = [];
    await page.route(/\/functions\/v1\/presence\/sales\/deals$/, (route) => route.request().method() === 'POST'
      ? (posts.push(route.request().postDataJSON().title), route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'd-' + (posts.length + 1) } }) }))
      : route.fallback());
    await page.goto('/pipeline.html');
    await page.locator('#newDeal').click();
    const dlg = page.locator('#formDlg');
    await dlg.locator('#f-title').fill('Blue Finch — online orders');
    await dlg.locator('#f-again').click();
    await expect(page.getByText('“Blue Finch — online orders” added — ready for the next one.')).toBeVisible();
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#f-title')).toHaveValue('');
    await expect(dlg.locator('#f-title')).toBeFocused();
    expect(posts).toEqual(['Blue Finch — online orders']);
  });
});

test.describe('People: a phone number is a call (item 89)', () => {
  test('the People tab’s phone is a tap to call', async ({ page }, info) => {
    test.skip(!['desktop-chromium', 'tablet'].includes(info.project.name), 'a phone hides the phone column (the row opens the preview)');
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/studio/customers': { data: [] }, '/sales/receivables': { data: { items: [] } } } });
    await contactsRoute(page);
    await page.goto('/customers.html?tab=people');
    await expect(page.locator('tr[data-person="ct-1"] td[data-col="phone"] a')).toHaveAttribute('href', 'tel:5550104410');
  });
});
