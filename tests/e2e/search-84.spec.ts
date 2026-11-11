import { test, expect, Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 84 (Nov 2026): ⌘K finds a phone number, a note, an enquiry, a proposal, a
// to-do, a website, a domain and a message. The results come in groups under small
// headings, the typed words in bold, "Open website" beside a website row, and a search
// that couldn't run says so instead of "Nothing matches". Drawn in Figma, section 13.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const HARBOR = { data: { partial: false, results: [
  { kind: 'customer', group: 'people', label: 'Harbor Dental', sub: 'Customer', href: '/crm.html?client=site-harbor' },
  { kind: 'contact', group: 'people', label: 'Marcus Bell', sub: 'Contact · Harbor Dental', href: '/crm.html?contact=ct-1&tab=details' },
  { kind: 'website', group: 'websites', label: 'Harbor Dental', sub: 'harbordental.example · Live', href: '/presence.html?client=site-harbor', alt: { label: 'Open website', href: 'https://harbordental.example' } },
  { kind: 'enquiry', group: 'enquiries', label: 'Lena Ortiz', snippet: '“…do you redo dental sites like Harbor’s?”', sub: 'Enquiry · Nov 3', href: '/inbox.html#enquiries?sel=lead:e-1' },
  { kind: 'deal', group: 'deals', label: 'Harbor Dental — new website', sub: 'Deal · Proposal sent', href: '/crm.html?deal=d-1&tab=deal' },
  { kind: 'proposal', group: 'deals', label: 'Harbor Dental website proposal', sub: 'Proposal · Sent · Nov 2', href: '/crm.html?deal=d-1&tab=deal' },
  { kind: 'todo', group: 'todos', label: 'Send Harbor the logo options', sub: 'To-do · due Nov 12', href: '/crm.html?deal=d-1&tab=deal' },
  { kind: 'message', group: 'messages', label: '“The Harbor photos are in the shared folder”', sub: 'Project message · Oct 30', href: '/crm.html?project=p-1&tab=activity' },
  { kind: 'note', group: 'notes', label: '“Harbor wants Spanish pages next year”', sub: 'Note on Marcus Bell', href: '/crm.html?contact=ct-1&tab=details' },
] } };

async function openPalette(page: Page) {
  await expect(page.locator('#dds-search')).toBeVisible();   // the shortcut is wired once the shell has drawn
  await page.locator('#dds-search').click();
  const pal = page.locator('.dds-palette');
  await expect(pal).toBeVisible();
  return pal;
}

test.describe('⌘K: everything, in groups (item 84)', () => {
  test('results come under their headings, in order, with the typed word in bold', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/search': HARBOR } });
    await page.goto('/agency.html');
    const pal = await openPalette(page);
    await pal.locator('input').fill('harbor');
    await expect(pal.locator('.gh')).toHaveText(['People', 'Websites', 'Enquiries', 'Deals and documents', 'To-dos', 'Messages', 'Notes']);
    await expect(pal.locator('.res')).toHaveCount(9);
    await expect(pal.locator('.res').first()).toHaveClass(/sel/);
    await expect(pal.locator('.res').first().locator('.rl b')).toHaveText('Harbor');
    // the enquiry shows the words found inside it, the word in bold there too
    const enq = pal.locator('.res', { hasText: 'Lena Ortiz' });
    await expect(enq.locator('.rs')).toContainText('do you redo dental sites');
    await expect(enq.locator('.rs b')).toHaveText('Harbor');
    await expect(enq).toHaveAttribute('href', '/inbox.html#enquiries?sel=lead:e-1');
    // every row is an option of the one list, each group named for screen readers
    await expect(pal.locator('[role=group][aria-labelledby]')).toHaveCount(7);
    await expect(pal.locator('[role=option]')).toHaveCount(9);
    await expect(pal.locator('.hint')).toContainText('Enter to open');
  });

  test('a website row opens the site in Studio OS; "Open website" (and Shift+Enter) opens the site itself', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/search': HARBOR } });
    await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
    await page.goto('/agency.html');
    const pal = await openPalette(page);
    await pal.locator('input').fill('harbor');
    const site = pal.locator('.res', { has: page.locator('.alt') });
    await expect(site).toHaveAttribute('href', '/presence.html?client=site-harbor');
    await site.locator('.alt').click();
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://harbordental.example']);
    await expect(pal).toBeVisible();   // the pill didn't follow the row's own link
    // keyboard: down to the website row, Shift+Enter
    const input = pal.locator('input');
    await input.press('ArrowDown'); await input.press('ArrowDown');
    await expect(site).toHaveClass(/sel/);
    await expect(pal.locator('.hint')).toContainText('Shift+Enter opens the website');
    await input.press('Shift+Enter');
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toHaveLength(2);
  });

  test('a phone number typed as digits marks the digits in the written number', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/search': { data: { results: [
      { kind: 'contact', group: 'people', label: 'Marcus Bell', sub: '(555) 010-4410 · Harbor Dental', href: '/crm.html?contact=ct-1&tab=details' },
      { kind: 'enquiry', group: 'enquiries', label: 'Theo Grant', sub: '555 010 4410 · Nov 8', href: '/inbox.html#enquiries?sel=lead:e-2' },
    ] } } } });
    await page.goto('/agency.html');
    const pal = await openPalette(page);
    await pal.locator('input').fill('0104410');
    await expect(pal.locator('.res')).toHaveCount(2);
    await expect(pal.locator('.res').first().locator('.s b')).toHaveText('010-4410');
    await expect(pal.locator('.res').nth(1).locator('.s b')).toHaveText('010 4410');
  });

  test('a search that couldn’t run says so, and the places that match still show', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX } });
    await page.route('**/functions/v1/presence/crm/search**', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed' }) }));
    await page.goto('/agency.html');
    const pal = await openPalette(page);
    await pal.locator('input').fill('deal stages');
    await expect(pal.locator('.pnote')).toContainText('We couldn’t search just now');
    await expect(pal.locator('.none')).toHaveCount(0);
    await expect(pal.locator('.res', { hasText: 'Deal stages' })).toHaveAttribute('href', '/settings.html#stages');
  });

  test('a partial answer is said quietly under the results', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/search': { data: { partial: true, results: HARBOR.data.results.slice(0, 2) } } } });
    await page.goto('/agency.html');
    const pal = await openPalette(page);
    await pal.locator('input').fill('harbor');
    await expect(pal.locator('.res')).toHaveCount(2);
    await expect(pal.locator('.pnote.quiet')).toHaveText('Some places couldn’t be searched just now.');
  });

  test('Settings cards are places: "automations" opens Settings at Automations', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/search': { data: { results: [] } } } });
    await page.goto('/agency.html');
    const pal = await openPalette(page);
    await pal.locator('input').fill('automations');
    await expect(pal.locator('.res.sel')).toHaveAttribute('href', '/settings.html#automations');
    await expect(pal.locator('.gh').first()).toHaveText('Places');
  });

  test('on a phone search fills the screen, and Cancel closes it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/search': HARBOR } });
    await page.goto('/agency.html');
    await expect(page.locator('#dds-search')).toBeAttached();
    await page.evaluate(() => document.getElementById('dds-search')!.click());
    const pal = page.locator('.dds-palette');
    await expect(pal).toBeVisible();
    await pal.locator('input').fill('harbor');
    await expect(pal.locator('.res')).toHaveCount(9);
    const box = await pal.locator('.box').boundingBox();
    expect(box && box.height).toBeGreaterThan(800);
    await pal.locator('.pclose').click();
    await expect(pal).toBeHidden();
  });

  test('a seat that can’t change settings isn’t offered them', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': { data: { ...STUDIO_CTX.data, site_role: 'business_staff', capabilities: ['edit', 'publish', 'invite', 'view_all'] } }, '/crm/search': { data: { results: [] } } } });
    await page.goto('/agency.html');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-dds-lacks'));
    const pal = await openPalette(page);
    await pal.locator('input').fill('automations');
    await expect(pal.locator('.res', { hasText: 'Automations' })).toHaveCount(0);
  });
});
