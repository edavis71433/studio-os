import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';
import { pinClock, PINNED_NOW, daysFrom } from './helpers/clock';

// Sales items of the Nov 22 2026 review, the page halves (the server halves are in
// tests/presence/sales_three_nov23_test.mjs):
//   192  the Contacts box finds a phone number by its digits, a whole tag and a town
//   211  "Good to know about them" on the record, beside Where things stand, and
//        "How I write, and my terms" in Settings, under Goal and AI help
// Items 201 (the enquiry alert) and 212 (Download my data) are server-only.
// Every name below is made up.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'delete', 'export'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const toastWith = (page: Page, text: string | RegExp) => page.locator('.dds-toast').filter({ hasText: text });

// ── 192: the Contacts box ──
const PEOPLE = [
  { id: 'ct-1', name: 'Marcus Bell', email: 'marcus@harbordental.example', phone: '(555) 010-4410', phone2: '', company: 'Harbor Dental', job_title: 'Office manager', tags: ['dental', 'referral'], address: { city: 'Glendale', state: 'CA' }, updated_at: daysFrom(PINNED_NOW, -3) },
  { id: 'ct-2', name: 'Maya Ruiz', email: 'maya@bluefinch.example', phone: '818-213-4567', phone2: '(626) 555-0199', company: 'Blue Finch Café', job_title: 'Owner', tags: ['restaurant'], address: { city: 'Burbank' }, updated_at: daysFrom(PINNED_NOW, -5) },
  { id: 'ct-3', name: 'Sam Ortiz', email: 'sam@ortizphoto.example', phone: '', phone2: '', company: '', job_title: '', tags: [], address: {}, updated_at: daysFrom(PINNED_NOW, -9) },
];
test.describe('item 192 — the Contacts box finds a number, a tag and a town', () => {
  test('a phone number by its digits (either number), a whole tag and a town each find the person', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?.*)?$/, (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: PEOPLE, total: PEOPLE.length, limit: 100, offset: 0 }) }));
    await page.goto('/contacts.html');
    const box = page.locator('#q');
    await expect(box).toHaveAttribute('placeholder', 'Search name, email, phone, tag or town…');
    const names = page.locator('#listZone [data-open]').filter({ hasText: /Marcus Bell|Maya Ruiz|Sam Ortiz/ });
    await expect(page.locator('#listZone')).toContainText('Sam Ortiz');
    const shows = async (q: string, who: string[]) => {
      await box.fill(q);
      for (const n of ['Marcus Bell', 'Maya Ruiz', 'Sam Ortiz']) {
        if (who.includes(n)) await expect(page.locator('#listZone')).toContainText(n);
        else await expect(page.locator('#listZone')).not.toContainText(n);
      }
    };
    await shows('5550104410', ['Marcus Bell']);        // typed with no marks
    await shows('010-4410', ['Marcus Bell']);          // a piece of it, written another way
    await shows('626 555 0199', ['Maya Ruiz']);        // the second phone
    await shows('1234', []);                           // digits in that order, with others between: nobody
    await shows('restaurant', ['Maya Ruiz']);          // a whole tag
    await shows('glendale', ['Marcus Bell']);          // a town
    await shows('owner', ['Maya Ruiz']);               // a job title, as before
    await box.fill('');
    await expect(names).toHaveCount(3);
    await noOverflow(page);
  });
});

// ── 211: the record's note ──
const DEAL = 'dddddddd-1111-4111-8111-dddddddddddd', CID = 'cccccccc-1111-4111-8111-cccccccccccc';
const RECORD = { data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: null, customer_site_id: null, project_id: null, person_id: CID },
  header: { name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'contact' },
  highlights: { stage: 'proposal', value_cents: 320000, next_step: 'Send revised logo' },
  sections: { overview: false, details: true, deal: true, delivery: false }, default_tab: 'deal', canonical: { key: 'deal', value: DEAL }, related_projects: [], related_deals: [],
} };
const ACTIVITY = { data: { upcoming: [], reply_to: null, reply_support_to: null, items: [] } };
const CONTACT = (good: string | null) => ({ data: { contact: { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example', phone: '', company: 'Juniper Floral Co.', notes: '', custom: {}, found_via: '', job_title: '', phone2: '', address: {}, tags: [], ...(good === null ? {} : { good_to_know: good }) }, deals: [], timeline: [], last_contacted_at: null, custom_fields: [] } });
async function contactRoute(page: Page, good: string | null, patches: Array<Record<string, unknown>>, answer?: (b: Record<string, unknown>) => { status: number; body: unknown }) {
  await page.route((u) => u.pathname.endsWith(`/functions/v1/presence/sales/contacts/${CID}`), (route: Route) => {
    const r = route.request();
    if (r.method() === 'PATCH') {
      const b = r.postDataJSON(); patches.push(b);
      const a = answer ? answer(b) : { status: 200, body: { data: { id: CID, good_to_know: String(b.good_to_know || '') } } };
      return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONTACT(good)) });
  });
}
const RECORD_API = { '/portal/context': STUDIO_CTX, '/crm/record': RECORD, '/crm/activity': ACTIVITY, '/sales/ai/summary': { data: { summary: null } } };

test.describe('item 211 — Good to know about them, beside Where things stand', () => {
  test('the note shows under Where things stand; Edit, Save keeps it on the person', async ({ page }) => {
    await pinClock(page);
    const patches: Array<Record<string, unknown>> = [];
    await installApp(page, { api: RECORD_API });
    await contactRoute(page, 'Prefers texts.', patches);
    await page.goto(`/crm.html?deal=${DEAL}&tab=activity`);
    const box = page.locator('section.gtk');
    await expect(box.getByRole('heading', { name: 'Good to know about Ivy' })).toBeVisible();
    await expect(box.locator('.gtk-t')).toHaveText('Prefers texts.');
    // it sits right under the AI card, in the same column
    const order = await page.evaluate(() => { const a = document.querySelector('.ai-sum'), g = document.querySelector('section.gtk'); return !!(a && g && (a.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)); });
    expect(order).toBe(true);
    await box.getByRole('button', { name: 'Edit' }).click();
    const ta = box.getByRole('textbox', { name: 'Good to know about Ivy' });
    await expect(ta).toBeFocused();
    await expect(box.locator('#gtkHow')).toHaveText('AI help reads this whenever it drafts to Ivy or sums them up.');
    await ta.fill('Prefers texts.\nHer partner Luis pays the invoices.');
    await box.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({ good_to_know: 'Prefers texts.\nHer partner Luis pays the invoices.' });
    await expect(box.locator('.gtk-t')).toHaveText('Prefers texts.\nHer partner Luis pays the invoices.');
    await expect(toastWith(page, 'Saved. AI help will keep it in mind.')).toBeVisible();
    await expect(box.getByRole('button', { name: 'Edit' })).toBeFocused();
    await noOverflow(page);
  });

  test('an empty note offers Add a note; a failed save keeps what was typed; Cancel changes nothing', async ({ page }) => {
    await pinClock(page);
    const patches: Array<Record<string, unknown>> = [];
    await installApp(page, { api: RECORD_API });
    await contactRoute(page, '', patches, () => ({ status: 409, body: { error: 'fields_unavailable', message: '“Good to know about them” needs a quick database update before it can be saved.' } }));
    await page.goto(`/crm.html?deal=${DEAL}&tab=activity`);
    const box = page.locator('section.gtk');
    await expect(box.locator('.gtk-t')).toHaveText('Nothing yet. Add what AI help should keep in mind when it writes to them.');
    await box.getByRole('button', { name: 'Add a note' }).click();
    const ta = box.getByRole('textbox', { name: 'Good to know about Ivy' });
    await ta.fill('Closed on Mondays.');
    await box.getByRole('button', { name: 'Save' }).click();
    await expect(toastWith(page, 'needs a quick database update')).toBeVisible();
    await expect(ta).toHaveValue('Closed on Mondays.');
    await box.getByRole('button', { name: 'Cancel' }).click();
    await expect(box.locator('.gtk-t')).toHaveText('Nothing yet. Add what AI help should keep in mind when it writes to them.');
    expect(patches).toHaveLength(1);
  });

  test('before the database update (no note on the person) the record shows no box', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: RECORD_API });
    await contactRoute(page, null, []);
    await page.goto(`/crm.html?deal=${DEAL}&tab=activity`);
    await expect(page.locator('.ai-sum')).toBeVisible();
    await expect(page.locator('section.gtk')).toHaveCount(0);
  });
});

// ── 211: Settings ──
test.describe('item 211 — How I write, and my terms', () => {
  test('the box under Goal and AI help shows what is kept and saves when you leave it', async ({ page }) => {
    await pinClock(page);
    const puts: Array<Record<string, unknown>> = [];
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/sales/goal-ai': { data: { goal_cents: null, ai_on: true, ai_on_at: null, can_switch: true, from_studio: false, ready: true, writing: 'Friendly, first names.', usage: { month_uses: 0, month_cents: 0, last_at: null, today_uses: 0, day_limit: 50, cents_each: 1 } } },
      '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, expected: { value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], goal: null } },
    } });
    await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/goal-ai'), (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const b = route.request().postDataJSON(); puts.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { goal_cents: null, ai_on: true, ai_on_at: null, writing: String(b.writing || '') } }) });
    });
    await page.goto('/settings.html#goal');
    const sec = page.locator('#goal');
    const box = sec.getByRole('textbox', { name: 'How I write, and my terms' });
    await expect(box).toHaveValue('Friendly, first names.');
    await expect(sec.locator('#aiWritingHow')).toContainText('Your website’s voice stays in Business details, under How you sound.');
    await box.fill('Friendly, first names. 50% deposit to start; invoices due in 14 days.');
    await box.blur();
    await expect(sec.locator('#fs-writing')).toHaveText('Saved');
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ writing: 'Friendly, first names. 50% deposit to start; invoices due in 14 days.' });
    await box.focus(); await box.blur();   // left again with nothing changed: nothing more is sent
    await page.waitForTimeout(150);
    expect(puts).toHaveLength(1);
    await noOverflow(page);
  });
});
