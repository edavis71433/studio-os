import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 105 (Nov 2026): charts on a list and a printable list.
//   Pipeline  Charts counts the deals in view by stage (with their value) and by
//             where they came from; Print puts exactly those deals on paper, in
//             the order they show. On a phone both live in More.
//   Contacts  How they found you, and tags; Print first loads the rest of the view.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const did = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deal = (n: number, title: string, stage: string, cents: number, found_via: string, more: Record<string, unknown> = {}) =>
  ({ id: did(n), title, stage, source: 'manual', expected_value_cents: cents, found_via, contact_id: null, created_at: ago(n), updated_at: ago(n), ...more });
const DEALS = [
  deal(1, 'Harbor Dental — new website', 'proposal', 420000, 'Google', { contact_id: 'c1', expected_close: '2026-11-30', next_step: 'Nudge Tue' }),
  deal(2, 'Juniper Floral — new site', 'qualified', 320000, 'Referral'),
  deal(3, 'Blue Finch — online orders', 'proposal', 185000, 'Google'),
  deal(4, 'Maple & Main — listings site', 'lead', 240000, ''),
  deal(5, 'Lena Ortiz — dental site', 'lead', 320000, 'Google'),
  deal(6, 'Ortiz Photography — booking', 'lead', 90000, 'Word of mouth'),
  deal(7, 'Harbor Dental — patient forms', 'contract', 140000, 'Referral', { contact_id: 'c1' }),
  deal(8, 'Copper Kettle — menu site', 'won', 480000, 'Google'),
];
const API = {
  '/sales/deals': { data: DEALS },
  '/sales/contacts': { data: [{ id: 'c1', name: 'Marcus Bell', email: 'marcus@example.com', company: 'Harbor Dental' }] },
  '/sales/summary': { data: { total: 8, open: { count: 7, value_cents: 1715000 }, won_month: { count: 1, value_cents: 480000 }, win_rate: { pct: null, won: 1, lost: 0 }, by_stage: [], expected: { value_cents: 0 }, ar: { outstanding_cents: 0, count: 0 } } },
  '/settings': { data: { stage_stale_days: {} } },
};
const phone = (page: Page) => (page.viewportSize()?.width || 0) <= 600;
// Charts and Print are toolbar buttons, or items in More on a phone
async function tool(page: Page, which: 'charts' | 'print') {
  if (!phone(page)) { await page.locator(which === 'charts' ? '#chartsBtn' : '#printBtn').click(); return; }
  await page.locator('#moreBtn').click();
  await page.locator(`#moreMenu [data-more="${which}"]`).click();
}
const rowsOf = (page: Page, panel: number) => page.locator('#charts .dc-panel').nth(panel).locator('.dc-row');
// window.print is a dialog the test can't press, so it notes what would print instead
async function catchPrint(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __printed: unknown; print: () => void };
    w.__printed = null;
    w.print = () => {
      const d = document.getElementById('ddsPrint');
      w.__printed = d ? {
        on: document.body.getAttribute('data-print'),
        title: d.querySelector('h1')?.textContent, sub: d.querySelector('.pl-sub')?.textContent,
        head: [...d.querySelectorAll('th')].map((t) => t.textContent),
        rows: [...d.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)),
      } : 'nothing';
    };
  });
}
type Printed = { on: string; title: string; sub: string; head: string[]; rows: string[][] };
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: unknown }).__printed) as Promise<Printed | null>;

test.describe('Pipeline: charts on the list (item 105)', () => {
  test('Charts counts the open deals on the board by stage and by where they came from; a search narrows it; it stays on', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#board .bcard')).toHaveCount(7);
    await expect(page.locator('#charts')).toBeHidden();
    await tool(page, 'charts');
    await expect(page.locator('#charts')).toBeVisible();
    if (!phone(page)) await expect(page.locator('#chartsBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#charts h3')).toHaveText(['Open deals by stage', 'Where they came from']);
    // label · count · value, in stage order; won deals aren't on the board, so they aren't counted
    await expect(rowsOf(page, 0)).toHaveText([/^New lead\s*3 deals\s*\$6,500$/, /^Qualified\s*1 deal\s*\$3,200$/, /^Proposal sent\s*2 deals\s*\$6,050$/, /^Agreement out\s*1 deal\s*\$1,400$/]);
    // most first; "Not recorded" last, in grey
    await expect(rowsOf(page, 1)).toHaveText([/^Google\s*3 deals$/, /^Referral\s*2 deals$/, /^Word of mouth\s*1 deal$/, /^Not recorded\s*1 deal$/]);
    await expect(rowsOf(page, 1).last()).toHaveClass(/\bnone\b/);
    await expect(page.locator('#charts .dc-foot')).toHaveText('From the 7 deals in this view.');
    // the longest bar fills its track; the others are as long as their count
    const widths = await rowsOf(page, 0).locator('.dc-fill').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
    expect(widths).toEqual(['100%', '33%', '67%', '33%']);
    // a search narrows the board, and the charts with it
    await page.locator('#dealSearch').fill('harbor');
    await expect(page.locator('#charts .dc-foot')).toHaveText('From the 2 deals in this view.');
    await expect(rowsOf(page, 0)).toHaveText([/^Proposal sent\s*1 deal\s*\$4,200$/, /^Agreement out\s*1 deal\s*\$1,400$/]);
    await expect(rowsOf(page, 1)).toHaveText([/^Google\s*1 deal$/, /^Referral\s*1 deal$/]);
    // remembered on the next visit
    await page.reload();
    await expect(page.locator('#charts .dc-foot')).toHaveText('From the 7 deals in this view.');
  });

  test('pointing at a row says its share of the view', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'hover is a mouse thing');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await page.locator('#chartsBtn').click();
    await rowsOf(page, 1).first().hover();
    await expect(page.locator('.dc-tip')).toBeVisible();
    await expect(page.locator('.dc-tip')).toHaveText('Google: 3 deals · 43% of this view');
    await page.mouse.move(5, 5);
    await expect(page.locator('.dc-tip')).toBeHidden();
  });

  test('the list counts every deal it shows, won ones too', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await page.locator('#viewList').click();
    await expect(page.locator('#list .card')).toHaveCount(8);
    await tool(page, 'charts');
    await expect(page.locator('#charts h3').first()).toHaveText('Deals by stage');
    await expect(rowsOf(page, 0).last()).toHaveText(/^Won\s*1 deal\s*\$4,800$/);
    await expect(page.locator('#charts .dc-foot')).toHaveText('From the 8 deals in this view.');
  });

  test('a phone or an iPad stacks the two charts; a computer sets them side by side', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await tool(page, 'charts');
    const [a, b] = await page.locator('#charts .dc-panel').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    if (page.viewportSize()!.width >= 1000) expect(b).toBe(a); else expect(b).toBeGreaterThan(a);
    // nothing wider than the screen
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  test('dark: the bars take the dark chart colours', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'one browser is enough for a colour');
    await page.emulateMedia({ colorScheme: 'dark' });
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await page.locator('#chartsBtn').click();
    const [fill, grey, track] = await page.evaluate(() => {
      const rows = document.querySelectorAll('#charts .dc-panel:nth-child(2) .dc-row');
      const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : '');
      return [bg(rows[0].querySelector('.dc-fill')), bg(rows[rows.length - 1].querySelector('.dc-fill')), bg(rows[0].querySelector('.dc-track'))];
    });
    expect([fill, grey, track]).toEqual(['rgb(150, 119, 238)', 'rgb(119, 114, 143)', 'rgb(45, 41, 68)']);
  });
});

test.describe('Pipeline: a printable list (item 105)', () => {
  test('Print puts the deals in view on paper, in the order they show, then gives the page back', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await page.locator('#viewList').click();
    await expect(page.locator('#list .card')).toHaveCount(8);
    await catchPrint(page);
    await tool(page, 'print');
    await expect.poll(() => printed(page)).not.toBeNull();
    const p = (await printed(page))!;
    expect(p.on).toBe('list');
    expect(p.title).toBe('Pipeline · All deals');
    expect(p.sub).toMatch(/^8 deals · \$21,950 · printed [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(p.head).toEqual(['Deal', 'Contact', 'Stage', 'Value', 'Close date', 'Next step']);
    expect(p.rows).toHaveLength(8);
    expect(p.rows[0]).toEqual(['Harbor Dental — new website', 'Marcus Bell', 'Proposal sent', '$4,200', 'Nov 30, 2026', 'Nudge Tue']);
    expect(p.rows[7]).toEqual(['Copper Kettle — menu site', '', 'Won', '$4,800', '', '']);   // closed deals sink, as on screen
    // the print is done: the page is back
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#ddsPrint')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-print', /./);
  });

  test('the board prints its own name and chip: a search narrows the paper too', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#board .bcard')).toHaveCount(7);
    await page.locator('#dealSearch').fill('harbor');
    await expect(page.locator('#board .bcard')).toHaveCount(2);
    await catchPrint(page);
    await tool(page, 'print');
    await expect.poll(() => printed(page)).not.toBeNull();
    const p = (await printed(page))!;
    expect(p.title).toBe('Pipeline · Open deals');
    expect(p.sub).toMatch(/^2 deals · \$5,600 · matching “harbor” · printed /);
    expect(p.rows.map((r) => r[2])).toEqual(['Proposal sent', 'Agreement out']);   // the board's columns, left to right
  });

  test('on paper only the list shows: no sidebar, no toolbar, no page', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'print styles are the same everywhere');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await page.locator('#viewList').click();
    await expect(page.locator('#list .card')).toHaveCount(8);
    await page.evaluate(() => { (window as unknown as { print: () => void }).print = () => { /* left open */ }; });
    await page.locator('#printBtn').click();
    await expect(page.locator('body')).toHaveAttribute('data-print', 'list');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#ddsPrint')).toBeVisible();
    await expect(page.locator('#ddsPrint tbody tr')).toHaveCount(8);
    await expect(page.locator('#listWrap')).toBeHidden();
    await expect(page.locator('#dds-shell')).toBeHidden();
    // ink on white, whatever the theme
    expect(await page.locator('#ddsPrint td').first().evaluate((e) => getComputedStyle(e).color)).toBe('rgb(23, 21, 34)');
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('#ddsPrint')).toBeHidden();   // never on screen
  });
});

test.describe('Pipeline inside a client (item 105)', () => {
  const SCOPED_CTX = { data: {
    site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
    is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
    capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
    landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null,
    scope: { site_id: 'site-acme', label: 'Acme Bakery' },
  } };
  test('no Charts or Print: deals live at the studio level', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': SCOPED_CTX, '/sales/deals': { data: [] } } });
    await page.goto('/pipeline.html?client=site-acme');
    await expect(page.locator('#chartsBtn')).toBeHidden();
    await expect(page.locator('#printBtn')).toBeHidden();
    if (phone(page)) {
      await page.locator('#moreBtn').click();
      await expect(page.locator('#moreMenu [data-more="charts"]')).toHaveCount(0);
    }
  });
});

// Contacts: 240 people, 100 a page, like the server
const cid = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOW = ['Google', 'Referral', 'Word of mouth', ''];
const PEOPLE = Array.from({ length: 240 }, (_, i) => ({
  id: cid(i + 1), name: `Person ${String(i + 1).padStart(3, '0')}`, email: `p${i + 1}@example.com`, phone: i % 2 ? '' : '555 0100', company: i % 3 ? '' : 'Harbor Lane',
  job_title: i === 0 ? 'Owner' : '', updated_at: ago(i), found_via: HOW[i % 4], tags: i % 5 === 0 ? ['restaurant', 'past client'] : i % 5 === 1 ? ['restaurant'] : [],
}));
async function serveContacts(page: Page) {
  const offsets: number[] = [];
  await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const u = new URL(route.request().url()), offset = Number(u.searchParams.get('offset')) || 0;
    offsets.push(offset);
    const rows = [...PEOPLE].sort((a, b) => (a.name < b.name ? -1 : 1));
    const body: Record<string, unknown> = { data: rows.slice(offset, offset + 100), limit: 100, offset };
    if (u.searchParams.get('total') === '1') body.total = rows.length;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return offsets;
}

test.describe('Contacts: charts and a printable list (item 105)', () => {
  test('Charts counts how the people in view found you and their tags, and says when more are not loaded yet', async ({ page }) => {
    await installApp(page);
    await serveContacts(page);
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await page.locator('#chartsBtn').click();
    await expect(page.locator('#chartsBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#charts h3')).toHaveText(['How they found you', 'Tags']);
    await expect(rowsOf(page, 0)).toHaveText([/^Google\s*25 contacts$/, /^Referral\s*25 contacts$/, /^Word of mouth\s*25 contacts$/, /^Not recorded\s*25 contacts$/]);
    await expect(rowsOf(page, 1)).toHaveText([/^restaurant\s*40 contacts$/, /^past client\s*20 contacts$/]);
    await expect(page.locator('#charts .dc-foot')).toHaveText('From the 100 contacts loaded so far, out of 240. Show more to count the rest.');
    await page.locator('#moreBtn').click();
    await expect(page.locator('#charts .dc-foot')).toHaveText('From the 200 contacts loaded so far, out of 240. Show more to count the rest.');
    await page.locator('#moreBtn').click();
    await expect(page.locator('#charts .dc-foot')).toHaveText('From the 240 contacts in this view.');
    await expect(rowsOf(page, 0).first()).toHaveText(/^Google\s*60 contacts$/);
  });

  test('Print first gets everyone in the view, then prints them all', async ({ page }) => {
    await installApp(page);
    const offsets = await serveContacts(page);
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await catchPrint(page);
    await page.locator('#printBtn').click();
    await expect.poll(() => printed(page)).not.toBeNull();
    expect(offsets).toEqual([0, 100, 200]);
    const p = (await printed(page))!;
    expect(p.title).toBe('Contacts · All contacts');
    expect(p.sub).toMatch(/^240 contacts · printed /);
    expect(p.head).toEqual(['Name', 'Company', 'Email', 'Phone', 'Tags']);
    expect(p.rows).toHaveLength(240);
    expect(p.rows[0]).toEqual(['Person 001', 'Owner, Harbor Lane', 'p1@example.com', '555 0100', 'restaurant, past client']);
    await expect(page.locator('#listZone [data-open]')).toHaveCount(240);   // the page shows them all now too
  });
});
