import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// ── Builder list items 426, 427 and 428 (the full review of Nov 22, 2026) ──
// 426: a plan reads the way Sites says it ("Website + tools") in the account menu and on
//      Settings' header line, never "Studio OS plan"; with no plan on file nothing is named.
//      (Analytics' Plan column is pinned in analytics.spec.ts.)
// 427: Settings' list runs in the page's own order, the parts on this page before the rows
//      that open another page, and no two rows on one screen share a picture.
// 428: beside the sidebar there is no Menu button (it listed the sidebar's own links again);
//      a phone keeps the bar's Menu. Prospects has a full-size picture, not the small dot.

const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 761;
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const NAV = [...STUDIO_LEVEL_NAV.slice(0, 4), { key: 'prospects', label: 'Prospects', items: [{ key: 'prospects', label: 'Prospects', href: '/prospects.html' }] }, ...STUDIO_LEVEL_NAV.slice(4)];
const ctx = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: NAV, plan_key: 'presence', plan_words: 'Website + tools', upsell: null, scope: null, ...over,
} });
const API = {
  '/identity': { data: { site_id: 's1', business_name: 'Bright Studio', email: 'hello@example.com', phone: '', service_area: 'Burbank, CA', tagline: '', description: '', social: {} } },
  '/settings': { data: { industry_key: 'generic' } },
  '/commerce/subscription': { data: { plan: 'presence', plan_name: 'Website + tools', status: 'active', can_manage_billing: true, in_grace: false, has_service_billing: false } },
};

test.describe('item 426: the plan in Sites’ words', () => {
  test('the account menu and Settings’ header name the plan as Sites does', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': ctx() } });
    await page.goto('/settings.html');
    await expect(page.locator('#subline')).toHaveText('Bright Studio · Website + tools');
    await page.locator('#dds-profile').click();
    await expect(page.locator('.dds-pop .who .r')).toHaveText('Owner · Website + tools plan');
    expect(await page.locator('.dds-pop .who .r').evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');   // shown as written, not "Website + Tools Plan"
    await expect(page.locator('.dds-pop')).not.toContainText('Studio OS plan');
  });

  test('with no plan on file, no plan is named at all', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': ctx({ plan_key: null, plan_words: '' }) } });
    await page.goto('/settings.html');
    await expect(page.locator('#subline')).toHaveText('Bright Studio');
    await page.locator('#dds-profile').click();
    await expect(page.locator('.dds-pop .who .r')).toHaveText('Owner');
  });
});

// what one screen of Settings' list shows: each row's link and picture, and where each in-page part sits
const listFacts = (page: Page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#cards .setcard')];
  const href = (a: Element) => (a.getAttribute('href') || '');
  const here = (a: Element) => /^#/.test(href(a));
  const sections = [...document.querySelectorAll('section.card[id]')].map((s) => s.id);
  const inPage = rows.filter(here).map((a) => href(a).slice(1));
  return {
    inPage,
    at: inPage.map((id) => sections.indexOf(id)),
    lastHere: rows.map(here).lastIndexOf(true),
    firstAway: rows.findIndex((a) => !here(a)),
    pictures: rows.map((a) => (a.querySelector('svg') || { innerHTML: '' }).innerHTML),
    drawn: rows.every((a) => !!a.querySelector('svg > *')),   // every row has a drawing (On every invoice had an empty one)
    titles: rows.map((a) => (a.textContent || '').trim().slice(0, 30)),
  };
});
const inOrder = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

test.describe('item 427: Settings in one order, a picture each', () => {
  test('at studio level: the list follows the page, then the rows that open another page; no picture twice', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': ctx() } });
    await page.goto('/settings.html');
    await expect(page.locator('#cards .setcard').first()).toBeVisible();
    const f = await listFacts(page);
    expect(f.inPage.length).toBeGreaterThan(6);
    expect(inOrder(f.at), `${f.inPage.join(', ')} sit at ${f.at.join(', ')}`).toBe(true);
    expect(f.lastHere).toBeLessThan(f.firstAway);
    expect(new Set(f.pictures).size, f.titles.join(' | ')).toBe(f.pictures.length);
    expect(f.drawn, f.titles.join(' | ')).toBe(true);
    // a search that finds nearly everything, the website's own settings included
    await page.locator('#setFind').fill('e');
    await expect(page.locator('#cards .setcard', { hasText: 'Who can see your website' })).toBeVisible();
    const s = await listFacts(page);
    expect(new Set(s.pictures).size, s.titles.join(' | ')).toBe(s.pictures.length);
    expect(s.drawn, s.titles.join(' | ')).toBe(true);
  });

  test('inside a client: the same order, and no picture twice', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': ctx({ scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } }) } });
    await page.goto(`/settings.html?client=${CLIENT}`);
    await expect(page.locator('#cards .setcard').first()).toBeVisible();
    const f = await listFacts(page);
    expect(f.inPage.length).toBeGreaterThan(2);
    expect(inOrder(f.at), `${f.inPage.join(', ')} sit at ${f.at.join(', ')}`).toBe(true);
    expect(f.lastHere).toBeLessThan(f.firstAway);
    expect(new Set(f.pictures).size, f.titles.join(' | ')).toBe(f.pictures.length);
    expect(f.drawn, f.titles.join(' | ')).toBe(true);
  });
});

test.describe('item 428: no second copy of the sidebar', () => {
  test('beside the sidebar there is no Menu button; a phone keeps the bar’s Menu', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': ctx() } });
    await page.goto('/settings.html');
    if (isPhone(page)) {
      await expect(page.locator('#dds-mbar-menu')).toBeVisible();
      await expect(page.locator('#dds-waffle')).toBeHidden();
      return;
    }
    await expect(page.locator('.dds-nav')).toBeVisible();
    await expect(page.locator('#dds-waffle')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
  });

  test('Prospects has a full-size picture of its own in the sidebar', async ({ page }) => {
    test.skip(isPhone(page), 'the sidebar shows ≥761px');
    await installApp(page, { api: { ...API, '/portal/context': ctx() } });
    await page.goto('/settings.html');
    const rows = page.locator('.dds-nav .sec > .it');
    await expect(rows.filter({ hasText: 'Prospects' })).toBeVisible();
    const pics = await rows.evaluateAll((els) => els.map((el) => {
      const svg = el.querySelector('svg');
      const box = svg && svg.firstElementChild ? (svg.firstElementChild as SVGGraphicsElement).getBBox() : { width: 0, height: 0 };
      return { name: (el.textContent || '').trim(), pic: svg ? svg.innerHTML : '', h: box.height };
    }));
    const pro = pics.find((p) => p.name === 'Prospects')!;
    expect(pro.h, 'drawn across most of the box, like the rest').toBeGreaterThan(12);
    expect(pics.filter((p) => p.pic === pro.pic).length, 'not the picture of another place').toBe(1);
  });
});
