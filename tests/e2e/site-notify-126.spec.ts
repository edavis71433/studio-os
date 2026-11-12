import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 126 (Nov 2026): each client site has one notifications switch, then
// a Dashboard channel (Home and the bell) and an Email channel; repeats fold into one
// line ("3 new enquiries on Bacchus Kitchen"); a line names the site, the number and
// one link.

const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const AGENCY_CTX = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, attention_stale: false, scope: null,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 4, nav: STUDIO_NAV, ...over,
} });
const SETTINGS_API = {
  '/identity': { data: { site_id: 'own', business_name: 'Brightline Studio', email: 'hello@brightline.example' } },
  '/settings': { data: { industry_key: 'salon' } },
  '/agency/nav': { data: { hidden: [], choices: [], can_edit: true } },
};
const NOTIFY = (over: Record<string, unknown> = {}) => ({ data: { sites: [
  { site_id: S1, name: 'Bacchus Kitchen', on: true, dashboard: true, email: true },
  { site_id: S2, name: 'Harbor Dental', on: true, dashboard: true, email: true },
], can_edit: true, ...over } });
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function notifyRoutes(page: Page, opts: { fail?: boolean } = {}) {
  const puts: Array<{ site: string; body: Record<string, unknown> }> = [];
  await page.route(/\/functions\/v1\/presence\/agency\/notify\/[^/?]+$/, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const site = decodeURIComponent(route.request().url().split('/agency/notify/')[1]);
    const body = route.request().postDataJSON(); puts.push({ site, body });
    if (opts.fail) return route.fulfill(json(502, { error: 'write_failed', message: 'That didn’t save.' }));
    const was = NOTIFY().data.sites.find((x) => x.site_id === site)!;
    return route.fulfill(json(200, { data: { ...was, ...body } }));
  });
  return puts;
}

test.describe('item 126 — one notifications switch per client site', () => {
  test('a studio’s Settings lists each client site with its switch and two channels, saving as you flip', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/notify': NOTIFY() } });
    const puts = await notifyRoutes(page);
    await page.goto('/settings.html');
    const card = page.locator('[data-card="notify"]');
    await expect(card).toHaveAttribute('href', '#notify');
    await expect(card).toContainText('One switch for each client’s site');
    await card.click();
    const part = page.locator('#notify');
    await expect(part).toBeVisible();
    await expect(page.locator('#notifyHead')).toBeFocused();
    await expect(part.locator('[data-notify-site]')).toHaveCount(2);
    const bacchus = part.locator(`[data-notify-site="${S1}"]`);
    await expect(bacchus.getByRole('switch', { name: 'Bacchus Kitchen' })).toHaveAttribute('aria-checked', 'true');
    await expect(bacchus.getByRole('checkbox', { name: 'On Home and in the bell' })).toBeChecked();
    await expect(bacchus.getByRole('checkbox', { name: 'By email' })).toBeChecked();
    // the switch off: one save, both channels wait, and the row says what that means
    await bacchus.getByRole('switch', { name: /Bacchus Kitchen/ }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ site: S1, body: { on: false } });
    await expect(bacchus.getByRole('switch', { name: /Bacchus Kitchen/ })).toHaveAttribute('aria-checked', 'false');
    await expect(bacchus.getByRole('checkbox', { name: 'By email' })).toBeDisabled();
    await expect(bacchus).toContainText('Off. Nothing about this site reaches you');
    await expect(bacchus.locator('.nsaved')).toHaveText('Saved');
    // one channel off on the other site
    const harbor = part.locator(`[data-notify-site="${S2}"]`);
    await harbor.getByRole('checkbox', { name: 'By email' }).uncheck();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1]).toEqual({ site: S2, body: { email: false } });
    await expect(harbor).toContainText('No emails to you about this site');
    await expect(part.locator('#notifyNote')).toContainText('Money owed, something broken and messages from your clients always reach you');
  });

  test('a change that doesn’t save puts the switch back and says so', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/notify': NOTIFY() } });
    await notifyRoutes(page, { fail: true });
    await page.goto('/settings.html#notify');
    const sw = page.locator(`#sw-n-${S1}`);
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(page.getByText('That didn’t save.')).toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(`[data-notify-site="${S1}"] .nsaved`)).toHaveCount(0);
  });

  test('inside a client, only that client’s site', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX({ scope: { site_id: S2, name: 'Harbor Dental' } }), '/agency/notify': NOTIFY() } });
    await page.goto(`/settings.html?client=${S2}`);
    const card = page.locator('[data-card="notify"]');
    await expect(card).toHaveAttribute('href', '#notify');
    await card.click();
    await expect(page.locator('#notify [data-notify-site]')).toHaveCount(1);
    await expect(page.locator(`#notify [data-notify-site="${S2}"]`)).toContainText('Harbor Dental');
  });

  test('a role that can’t change them sees them greyed, and the read failing leaves the part away', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX(), '/agency/notify': NOTIFY({ can_edit: false }) } });
    await page.goto('/settings.html#notify');
    await expect(page.locator(`#sw-n-${S1}`)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator(`#ch-e-${S1}`)).toBeDisabled();
    await expect(page.locator('#notifyNote')).toContainText('Your role can see these but not change them');
    await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX() } });
    await page.route(/\/functions\/v1\/presence\/agency\/notify$/, (route) => route.fulfill(json(502, { error: 'read_failed', message: 'x' })));
    await page.goto('/settings.html');
    await page.locator('[data-card="notify"]').click();
    await expect(page.getByText('Your notification choices couldn’t load just now.')).toBeVisible();
    await expect(page.locator('#notify')).toBeHidden();
  });

  test('a business owner’s Notifications card still opens the Inbox', async ({ page }) => {
    await installApp(page, { api: SETTINGS_API });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="notify"]')).toHaveAttribute('href', '/inbox.html');
    await expect(page.locator('#notify')).toBeHidden();
  });
});

test.describe('item 126 — repeats fold into one line in the bell', () => {
  test('a site’s three enquiries are one line that names the site, the number and one link; news lines carry the server’s words', async ({ page }) => {
    const enq = (id: string, who: string, when: string) => ({ key: 'enquiry:' + id, kind: 'enquiry', site_id: S1, client_id: null, name: 'Bacchus Kitchen', what: 'new enquiry from ' + who, when, verb: 'Reply', href: `/inbox.html?client=${S1}#enquiries?sel=lead:${id}` });
    const needs = { data: {
      rows: [
        { key: 'money:i1', kind: 'money', site_id: S2, client_id: 'c2', name: 'Harbor Dental', what: 'invoice $800 is overdue by 3 days', when: 'Sent Nov 1 · no payment yet', verb: 'Resend', href: '/crm.html' },
        enq('e1', 'Sam', '3 days ago · contact form'), enq('e2', 'Dana', 'Yesterday'), enq('e3', 'Lee', 'Today'),
        { key: 'enquiry:e9', kind: 'enquiry', site_id: S2, client_id: null, name: 'Harbor Dental', what: 'new enquiry from Ana', when: 'Today', verb: 'Reply', href: `/inbox.html?client=${S2}#enquiries?sel=lead:e9` },
      ],
      more: 0, rest: [], total: 5, snoozed: [], old: { count: 0, items: [] }, empty_line: '', partial: false, own_site: true, update_notices: [], snooze_ready: true, next_by_site: {}, next_by_client: {},
      news: [
        { id: 'b2', site_id: S1, name: 'Bacchus Kitchen', kind: 'new_booking', count: 3, title: '3 new bookings on Bacchus Kitchen', sub: 'The latest: Colour — Sat 10am', link: 'Open bookings', headline: 'New booking: Colour — Sat 10am', body: '', at: '2026-11-11T10:00:00Z', href: `/presence.html?client=${S1}#bookings`, tier: 'update' },
        { id: 't1', site_id: S2, name: 'Harbor Dental', kind: 'traffic_spike', count: 1, title: 'Traffic spike on Harbor Dental: 78 page views', sub: 'About 4 times a usual day.', link: 'View analytics', headline: 'A busy day: 78 page views yesterday', body: '', at: '2026-11-12T06:00:00Z', href: `/analytics.html?client=${S2}`, tier: 'update' },
      ],
    } };
    await installApp(page, { api: { '/portal/context': AGENCY_CTX({ landing: '/agency.html' }), '/agency/needs-you': needs } });
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-pop[aria-label="Notifications"]');
    await expect(pop).toBeVisible();
    const folded = pop.locator('.row', { hasText: '3 new enquiries on Bacchus Kitchen' });
    await expect(folded).toHaveCount(1);
    await expect(folded).toHaveAttribute('href', `/inbox.html?client=${S1}#enquiries`);
    await expect(folded.locator('.go')).toHaveText('Reply');
    await expect(folded).toContainText('The oldest: 3 days ago');
    await expect(pop.locator('.row', { hasText: 'new enquiry from Sam' })).toHaveCount(0);
    // one enquiry on another site stays its own line; money stays first
    await expect(pop.locator('.row', { hasText: 'Harbor Dental — new enquiry from Ana' })).toHaveCount(1);
    await expect(pop.locator('.row').first()).toContainText('Harbor Dental — invoice $800 is overdue by 3 days');
    // the news lines: the server's words, and the one link named
    const spike = pop.locator('.row', { hasText: 'Traffic spike on Harbor Dental: 78 page views' });
    await expect(spike).toHaveAttribute('href', `/analytics.html?client=${S2}`);
    await expect(spike.locator('.go')).toHaveText('View analytics');
    await expect(pop.locator('.row', { hasText: '3 new bookings on Bacchus Kitchen' }).locator('.go')).toHaveText('Open bookings');
  });
});
