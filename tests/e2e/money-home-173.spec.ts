import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 173 (Nov 22 2026 review), direction A, the money wall: the Invoices page opens on a
// deep plum band (what is owed, a bar of it by how late, overdue, paid this month and this year),
// then money in by month, the three customers who owe most, and Stripe's side of the month for
// the platform's own studio; the chips, the search and the table stay under it. An older server
// (no /sales/money-home) leaves the month chart and the Stripe strip out. Set SHOTS_DIR to keep
// a picture of the desktop and the phone.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: true, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const ymd = (ms: number) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const day = (n: number) => ymd(Date.now() + n * 86400000);
const iso = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const isPhone = (page: Page) => (page.viewportSize()?.width || 1200) < 768;
const I = (n: number) => `abababab-0000-4000-8000-00000000000${n}`;
const DEAL = 'dddddddd-0000-4000-8000-000000000003';
const row = (n: number, over: Record<string, unknown>) => ({ id: I(n), number_label: `#00${60 + n}`, title: 'Website work', amount_cents: 100000, status: 'open', state: 'upcoming', due_date: day(6), issued_at: iso(-8), paid_at: null, paid_method: '', processing: false, payment_for: null, deal_id: DEAL, business: 'Maple & Rye Bakery', person: 'Jordan Lee', has_link: true, pay_url: 'https://pay.example/x', ...over });
const INVOICES = { data: { today: day(0), partial: false, items: [
  row(1, { number_label: '#0064', title: 'Website rebuild, balance', amount_cents: 180000, due_date: day(6) }),
  row(2, { number_label: '#0063', title: 'Care plan, November', amount_cents: 35000, state: 'processing', processing: true, business: 'Northside Dental', person: 'Priya Shah', has_link: false, pay_url: null }),
  row(3, { number_label: '#0062', title: 'Booking page add-on', amount_cents: 65000, state: 'overdue', due_date: day(-11), issued_at: iso(-18), business: 'Harbor Yoga', person: 'Sam Ortiz' }),
  row(4, { number_label: '#0061', title: 'Deposit, new site', amount_cents: 120000, state: 'overdue', due_date: day(-45), issued_at: iso(-52), business: 'Blue Heron Plumbing', person: 'Alex Kim' }),
  row(5, { number_label: '#0060', title: 'Logo refresh', amount_cents: 65000, state: 'overdue', due_date: day(-70), issued_at: iso(-80), business: 'Cedar & Sage Salon', person: 'Mia Torres' }),
  row(6, { number_label: '#0059', title: 'Website rebuild, deposit', amount_cents: 180000, status: 'paid', state: 'paid', paid_at: iso(-1), paid_method: 'check', due_date: day(-5), has_link: false, pay_url: null }),
  row(7, { number_label: '#0058', title: 'Holiday banner', amount_cents: 25000, status: 'void', state: '', due_date: day(-30), issued_at: iso(-40), business: 'Lakeside Books', person: 'Chris Park', has_link: false, pay_url: null }),
] } };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const months = () => { const out = []; const now = new Date(); for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); out.push({ month: ym, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, cents: [48, 90, 70, 120, 60, 150, 95, 130, 80, 160, 110, 215][11 - i] * 1000, retainer_cents: i === 0 ? 40000 : 0 }); } return out; };
const HOME = (stripe: boolean) => ({ data: { today: day(0), months: months(), total_12_cents: 1328000, stripe_books: stripe, stripe_failed: false, stripe: stripe ? { month: day(0).slice(0, 7), paid_online_cents: 180000, fee_cents: 5520, net_cents: 174480, reached_bank_cents: 139500, next_payout: { cents: 35000, arrival: day(3) }, more: false } : null } });
const API = (stripe = true) => ({ '/portal/context': STUDIO_CTX, '/sales/invoices': INVOICES, '/sales/money-home': HOME(stripe) });
const shots = process.env.SHOTS_DIR || '';

test.describe('Invoices as a money home (sales item 173, direction A)', () => {
  test('the band: what is owed, by how late; the three debtors; Stripe this month; the table under it', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/invoices.html');
    const wall = page.locator('.wall');
    await expect(wall).toBeVisible();
    await expect(wall.locator('.tot.hero .v')).toHaveText('$4,650');            // 1,800 + 350 + 650 + 1,200 + 650
    await expect(wall.locator('.tot.bad .v')).toHaveText('$2,500');             // 650 + 1,200 + 650
    const pieces = wall.locator('.agebar button');
    await expect(pieces).toHaveText([/Not due yet · \$1,800/, /1 to 30 days late · \$650/, /31 to 60 days · \$1,200/, /Over 60 days · \$650/]);
    // the three who owe most: the oldest debt first
    const who = page.locator('.mcard', { hasText: 'Who owes most' });
    await expect(who.locator('.who .r b')).toHaveText(['Cedar & Sage Salon', 'Blue Heron Plumbing', 'Harbor Yoga']);
    await expect(who.locator('.who .r').first()).toContainText('70 days late');
    await expect(who.locator('#remindAll')).toHaveText('Remind all three');
    // money in by month, twelve bars, this month marked
    const chart = page.locator('.mcard.wide');
    await expect(chart.locator('.bar')).toHaveCount(12);
    await expect(chart.locator('.bar.now')).toHaveCount(1);
    await expect(chart.locator('.note')).toContainText('so far: $2,150 · $400 of it from retainers');
    // Stripe this month, for the platform's own studio
    const stripe = page.locator('.mcard.stripe');
    await expect(stripe.locator('.tot .v')).toHaveText(['$1,800', '−$55.20', '$1,395', /\$350 · /]);
    // the chips, the search and the table are still there, under the band
    await expect(page.locator('.chip').first()).toHaveText(/All\s*7/);
    await expect(page.locator('#find')).toBeVisible();
    if (!isPhone(page)) await expect(page.locator('tbody tr:not(.part)')).toHaveCount(7);
    else await expect(page.locator('.card')).toHaveCount(7);
    if (shots) await page.screenshot({ path: `${shots}/money-home-${isPhone(page) ? 'phone' : 'desktop'}.png`, fullPage: true });
  });

  test('a piece of the bar shows those invoices; pressing it again clears', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/invoices.html');
    await page.locator('.agebar button', { hasText: '31 to 60 days' }).click();
    const rows = page.locator(isPhone(page) ? '.card' : 'tbody tr:not(.part)');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Blue Heron Plumbing');
    await expect(page.locator('.agebar button[aria-pressed="true"]')).toHaveText(/31 to 60 days/);
    await expect(page.locator('.agebar button[aria-pressed="true"]')).toBeFocused();
    await page.locator('.agebar button', { hasText: '31 to 60 days' }).click();
    await expect(rows).toHaveCount(7);
  });

  test('Remind all three sends one reminder each, about the oldest overdue invoice', async ({ page }) => {
    await installApp(page, { api: API() });
    const sent: string[] = [];
    await page.route((u) => u.pathname.includes('/functions/v1/presence/sales/invoices/') && u.pathname.endsWith('/remind'), (route) => { sent.push(new URL(route.request().url()).pathname.replace(/^.*\/sales\/invoices\//, '')); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { sent: true, to_first: 'them' } }) }); });
    await page.goto('/invoices.html');
    page.once('dialog', (d) => d.accept());
    await page.locator('#remindAll').click();
    await page.locator('.ask-yes .ask-ok').click();
    await expect.poll(() => sent.length).toBe(3);
    expect(sent.sort()).toEqual([`${I(3)}/remind`, `${I(4)}/remind`, `${I(5)}/remind`].sort());
    await expect(page.locator('.dds-toast', { hasText: 'Reminded 3 customers.' })).toBeVisible();
  });

  test('a studio that is not the platform gets no Stripe strip; an older server gets the band and the debtors only', async ({ page }) => {
    await installApp(page, { api: API(false) });
    await page.goto('/invoices.html');
    await expect(page.locator('.wall')).toBeVisible();
    await expect(page.locator('.mcard.stripe')).toHaveCount(0);
    await expect(page.locator('.mcard.wide')).toHaveCount(1);
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/invoices': INVOICES } });
    await page.goto('/invoices.html');
    await expect(page.locator('.wall .tot.hero .v')).toHaveText('$4,650');
    await expect(page.locator('.mcard.wide')).toHaveCount(0);
    await expect(page.locator('.mcard', { hasText: 'Who owes most' })).toBeVisible();
  });
});
