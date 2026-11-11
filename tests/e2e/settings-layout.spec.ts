import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Bold redesign — Settings (Nov 2026). On a computer the areas are a list on the
// left that follows you down the page and marks the section you're reading, with
// the sections beside it; a card that leaves the page shows an arrow. On a phone
// the areas are a simple list — each row its name, a one-line status and a ›.
// Deal stages is a section of its own: the names, the chances, and when a deal
// counts as stalled (they lived under Automations).

const API = {
  '/identity': { data: { site_id: 's1', business_name: 'Brightline Studio', email: 'hello@brightline.example', phone: '', service_area: 'Burbank, CA', tagline: '', description: '', story: '', booking_url: '', ordering_url: '', social: {}, seo_title: '' } },
  '/settings': { data: { industry_key: 'generic', stage_stale_days: { proposal: 7 } } },
  '/sales/stages': { data: { labels: { lead: 'Enquiry', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' }, custom: { lead: 'Enquiry' }, defaults: {}, chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  '/connections': { data: { edition: 'studio_os', note: '', groups: { Google: [{ key: 'google_analytics', label: 'Google Analytics', connection: { status: 'connected', health: 'ok' } }] } } },
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-12-03T00:00:00Z', in_grace: false, has_service_billing: false } },
};

test.describe('Settings — the list beside the sections (bold redesign)', () => {
  test('Deal stages is its own section, its card says where things stand', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    const card = page.locator('[data-card="stages"]');
    await expect(card).toHaveAttribute('href', '#stages');
    await expect(card.locator('.st')).toHaveText('4 stages · 1 renamed');   // bug hunt C16: every percent is its usual one, so no "chances set"
    const sec = page.locator('#stages');
    await expect(sec).toBeVisible();
    await expect(sec.getByRole('heading', { level: 2, name: 'Deal stages' })).toBeVisible();
    // the names, the chances and the stalled days all live here now — not under Automations
    for (const id of ['#stageNames', '#stageChances', '#st-lead']) await expect(sec.locator(id)).toHaveCount(1);
    await expect(page.locator('#automations #stageNames')).toHaveCount(0);
    await expect(page.locator('#st-proposal')).toHaveValue('7');
  });

  test('a computer: the list sits beside the sections and marks the one you are reading', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the side-by-side layout is for wider screens');
    await page.setViewportSize({ width: 1360, height: 900 });
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    const nav = page.getByRole('navigation', { name: 'Settings areas' });
    const [n, s] = await Promise.all([nav.boundingBox(), page.locator('#studio').boundingBox()]);
    expect(n!.x + n!.width).toBeLessThanOrEqual(s!.x);           // side by side
    expect(Math.abs(n!.y - s!.y)).toBeLessThan(4);
    await expect(page.locator('[data-card="studio"]')).toHaveAttribute('aria-current', 'location');
    await page.locator('[data-card="stages"]').click();
    await expect(page.locator('#stagesHead')).toBeFocused();
    await expect(page.locator('[data-card="stages"]')).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('[data-card="studio"]')).not.toHaveAttribute('aria-current', /./);
    // the list follows you down the page
    await page.locator('#billing').scrollIntoViewIfNeeded();
    expect((await nav.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    // a card that leaves the page says so; an in-page one doesn't
    await expect(page.locator('[data-card="connections"] .go')).toHaveText('→');
    await expect(page.locator('[data-card="studio"] .go')).toHaveCount(0);
  });

  test('the Calendar row says whether the private link is on, and opens Connections on the calendar card', async ({ page }) => {
    await installApp(page, { api: { ...API, '/calendar/link': { data: { on: true, url: 'https://example.com/cal/abc.ics', created_at: null, can_manage: true } } } });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="calendar"] .st')).toHaveText('Your calendar link is on');
    await page.locator('[data-card="calendar"]').click();
    await expect(page).toHaveURL(/\/connections\.html#calSec$/);
    await expect(page.locator('#calSec')).toBeInViewport();
    await expect(page.locator('#calUrl')).toHaveValue('https://example.com/cal/abc.ics');
  });

  test('#stages opens straight onto the section', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html#stages');
    await expect(page.locator('#stages')).toBeInViewport();
  });

  test('a phone: a simple list — name, a one-line status, and a ›; nothing spills sideways', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    const list = page.locator('#cards');
    const rows = list.locator('.setcard');
    await expect(rows.first()).toBeVisible();
    const [r0, r1, lw] = await Promise.all([rows.nth(0).boundingBox(), rows.nth(1).boundingBox(), list.boundingBox()]);
    expect(r1!.y).toBeGreaterThan(r0!.y + r0!.height - 2);      // one under the other
    expect(r0!.width).toBeGreaterThan(lw!.width - 20);           // each row takes the width
    await expect(page.locator('[data-card="connections"] .dsc')).toBeHidden();
    await expect(page.locator('[data-card="connections"] .st')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('[data-card="stages"]').click();
    await expect(page.locator('#stages')).toBeInViewport();
  });

  test('no serious/critical axe violations', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await expect(page.locator('#stages')).toBeVisible();
    const r = await new AxeBuilder({ page }).include('#main').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});
