import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { expectOneHeader } from './helpers/page-header';

// Builder item 165 (Figma 295:3), group 3: the one page header on Settings and the pages that live
// inside it — Connections, Sharing & access, Developer tools and Recently deleted. Each page loads
// with fixtures shaped like its own spec's, then the shared helper checks the header the same way
// on every page, and axe reads the header in light and dark. Every name here is made up.

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' },
} };
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };

// ── Settings: settings.spec's reads ──
const SETTINGS_API = {
  '/identity': { data: { site_id: 's1', business_name: 'Fern Street Bakery', email: 'hello@fern.example', phone: '', service_area: 'Springfield', tagline: '', description: '', story: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '', updated_at: '2026-10-01T00:00:00Z' } },
  '/settings': { data: { industry_key: 'generic' } },
  '/connections': { data: { edition: 'studio_os', note: '', groups: { Google: [{ key: 'google_analytics', label: 'Google Analytics', connection: { status: 'connected', health: 'ok' } }] } } },
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-11-03T00:00:00Z', in_grace: false, has_service_billing: false } },
};

// ── Connections: connections.spec's groups shape ──
const svc = (key: string, label: string, connection: Record<string, unknown>) => ({ key, label, purpose: 'See how people find you.', reads: ['the searches that lead to you'],
  approval: 'You approve access on the provider’s sign-in screen.', availability: 'Read-only', data: null,
  connection: { health: 'unknown', last_sync_at: null, connected_at: null, reason: '', ...connection } });
const CONNECTIONS = (gsc: Record<string, unknown>) => ({ data: { edition: 'presence_monitor', note: 'Connect the services you already use.', groups: {
  'Being found': [svc('google_search_console', 'how you show up in Google Search', gsc)],
  'Your numbers': [svc('google_analytics', 'your visitor numbers', { status: 'connected', health: 'ok', last_sync_at: '2026-10-19T16:20:00Z', connected_at: '2026-09-30T00:00:00Z' })],
} } });

// ── Sharing & access: sharing.spec's people and shares ──
const PEOPLE = { data: [], owner: { name: 'Sam Reyes', email: 'owner@example.com', signed_in: true, me: true }, studio: null, transfer: null, transfer_ready: true, can_transfer: 'owner' };
const SHARES_NONE = { data: { shares: [] } };
const SITES = { data: [{ site_id: CLIENT, name: 'Marlow’s Kitchen', domain: 'marlows.example' }, { site_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: 'Harbor Dental', address: 'https://harbor.example' }] };

// ── Developer tools: developer-mode.spec's files ──
const DEV_API = {
  '/dev/files': { data: { files: [{ path: 'theme/tokens.json', kind: 'theme', editable: true }], template: { slug: 'meadow', version: '1.0.0' } } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: ['accent', 'ink', 'font_body'] } },
};
const DEV_LINE = 'Your site’s colors and type, your own styles and a block of your own HTML. These are for you, not your clients. Changes save as you go.';

// ── Recently deleted: recently-deleted-83.spec's list ──
const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const DELETED = { data: { days: 30, partial: [],
  deals: [{ id: 'dddddddd-0000-4000-8000-0000000000a1', title: 'Website rebuild — Lakeside Books', stage: 'proposal', stage_label: 'Proposal sent', value_cents: 240000, person: 'Chris Park', deleted_at: ago(3) }],
  contacts: [{ id: 'cccccccc-0000-4000-8000-0000000000b1', name: 'Sam Ortiz', email: 'sam@harboryoga.example', company: 'Harbor Yoga', deleted_at: ago(22) }],
  todos: [{ id: 'abababab-0000-4000-8000-0000000000c1', title: 'Call back about the menu photos', due_date: '2026-11-06', deal_id: null, deal_title: '', for_name: 'Harbor Yoga', deleted_at: ago(6) }],
} };
const NOTHING_DELETED = { data: { days: 30, partial: [], deals: [], contacts: [], todos: [] } };

type Open = (page: Page) => Promise<void>;
const PAGES: Array<{ name: string; open: Open; want: Parameters<typeof expectOneHeader>[1]; axeSkip?: string[] }> = [
  { name: 'Settings', open: async (page) => { await installApp(page, { api: SETTINGS_API }); await page.goto('/settings.html'); },
    want: { title: 'Settings', icon: 'settings', line: 'Fern Street Bakery · Studio OS', filled: null } },
  { name: 'Settings inside a client', open: async (page) => { await installApp(page, { api: { ...SETTINGS_API, '/portal/context': SCOPED_CTX } }); await page.goto(`/settings.html?client=${CLIENT}`); },
    want: { title: 'Settings — Marlow’s Kitchen', icon: 'settings', filled: null } },
  { name: 'Connections', open: async (page) => { await installApp(page, { api: { '/connections': CONNECTIONS({ status: 'expired', health: 'attention' }) } }); await page.goto('/connections.html'); },
    want: { title: 'Connections', icon: 'connections', trail: 'Settings', line: 'Google, your calendar and email sending, in one place · 1 connected · 1 needs attention', filled: null } },
  { name: 'Connections inside a client', open: async (page) => {
      await installApp(page, { api: { '/connections': CONNECTIONS({ status: 'disconnected' }), '/portal/context': SCOPED_CTX } });
      await page.goto(`/connections.html?client=${CLIENT}`);
      await expect(page.locator('#askClient')).toHaveCount(1); },
    want: { title: 'Connections', icon: 'connections', trail: 'Settings', line: 'Google, your calendar and email sending, in one place · 1 connected', filled: null } },
  { name: 'Sharing & access', open: async (page) => { await installApp(page, { api: { '/portal/members': PEOPLE, '/portal/shares': SHARES_NONE } }); await page.goto('/sharing.html'); await expect(page.locator('#peopleCard')).toBeVisible(); },
    want: { title: 'Sharing & access', icon: 'sharing', trail: 'Settings', line: 'Who can sign in, each with a role, and what a reviewer sees', filled: null } },
  { name: 'Sharing & access at studio level', open: async (page) => { await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/agency/sites': SITES } }); await page.goto('/sharing.html'); },
    want: { title: 'Sharing & access', icon: 'sharing', trail: 'Settings', line: '2 clients, each with their own people and their own switches for what they see. Choose one.', filled: null } },
  { name: 'Developer tools', open: async (page) => { await installApp(page, { api: DEV_API }); await page.goto('/developer.html'); await expect(page.locator('[data-tok="accent"]')).toBeVisible(); },
    want: { title: 'Developer tools', icon: 'developer', trail: 'Settings', line: DEV_LINE, filled: null }, axeSkip: ['iframe.pv'] },
  { name: 'Recently deleted', open: async (page) => { await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': DELETED } }); await page.goto('/recently-deleted.html'); },
    want: { title: 'Recently deleted', icon: 'deleted', trail: 'Settings', line: '3 things deleted in the last 30 days', filled: null } },
  { name: 'Recently deleted, nothing waiting', open: async (page) => { await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': NOTHING_DELETED } }); await page.goto('/recently-deleted.html'); },
    want: { title: 'Recently deleted', icon: 'deleted', trail: 'Settings', line: 'Customers, deals, contacts and to-dos you delete wait here for 30 days', filled: null } },
];

test.describe('One page header, group 3 (builder item 165)', () => {
  for (const p of PAGES) {
    test(`${p.name}: the icon, the title, its line, the trail, no filled action`, { tag: '@layout' }, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await p.open(page);
      await expectOneHeader(page, p.want);
      const head = page.locator('header.dds-ph');
      if ((page.viewportSize()?.width || 0) < 761 && await head.locator('.dds-ph-more > *').count()) {
        // the others wait behind ⋯ in a sheet; Escape puts it away
        await head.locator('.dds-ph-dots').click();
        await expect(head.locator('.dds-ph-more')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(head.locator('.dds-ph-more')).toBeHidden();
      }
      // nothing in the header spills sideways (the header and everything in it end inside the window)
      expect(await head.evaluate((h) => {
        // a strip that slides (the tabs on a phone, item 215's five) counts by its own edge, not the tabs scrolled inside it
        const inStrip = (e: Element) => { for (let p = e.parentElement; p && p !== h; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true; return false; };
        return Math.max(...[h, ...h.querySelectorAll('*')].filter((e) => e.getClientRects().length > 0 && !inStrip(e)).map((e) => e.getBoundingClientRect().right)) - window.innerWidth;
      })).toBeLessThanOrEqual(0);
      expect(await head.evaluate((h) => h.scrollWidth - h.clientWidth)).toBeLessThanOrEqual(0);   // and nothing inside the header runs past its own edge (a sliding strip keeps its tabs to itself)
      expect(errors).toEqual([]);
    });
  }

  test('Connections inside a client: the ask is the header’s one other action, outline, and it still asks', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: { '/connections': CONNECTIONS({ status: 'disconnected' }), '/portal/context': SCOPED_CTX } });
    await page.route('**/functions/v1/presence/connections/ask', (route) => route.fulfill(json({ data: { asked: ['google_search_console'], emailed: true, message: 'Asked — we emailed them a link.' } })));
    await page.goto(`/connections.html?client=${CLIENT}`);
    const ask = page.locator('header.dds-ph .dds-ph-more #askClient');
    await expect(ask).toHaveText('Ask Marlow’s Kitchen to connect their Google');
    await expect(ask).not.toHaveClass(/primary/);
    const phone = (page.viewportSize()?.width || 0) < 761;
    if (phone) await page.locator('header.dds-ph .dds-ph-dots').click();
    await ask.click();
    if (phone) await expect(page.locator('header.dds-ph .dds-ph-more')).toBeHidden();   // the phone's sheet steps aside for the question
    await expect(page.getByRole('dialog')).toContainText('Email Marlow’s Kitchen a link to connect their Google?');
  });

  test('Recently deleted: the line counts down as things come back', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/deleted': DELETED } });
    await page.route((u) => /\/sales\/deals\/[^/]+\/restore$/.test(u.pathname), (route) => route.fulfill(json({ data: { ok: true, restored: true } })));
    await page.goto('/recently-deleted.html');
    await expect(page.locator('header.dds-ph .dds-ph-line')).toHaveText('3 things deleted in the last 30 days');
    await page.getByRole('button', { name: 'Restore Website rebuild — Lakeside Books' }).click();
    await expect(page.locator('header.dds-ph .dds-ph-line')).toHaveText('2 things deleted in the last 30 days');
  });

  for (const p of PAGES) {
    test(`${p.name}: no serious or critical accessibility findings in the header, light and dark`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once');
      test.slow();
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await p.open(page);
        await expect(page.locator('header.dds-ph h1')).toBeVisible();
        if (p.want.line) await expect(page.locator('header.dds-ph .dds-ph-line')).toHaveText(p.want.line);
        let axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('header.dds-ph');
        for (const sel of p.axeSkip || []) axe = axe.exclude(sel);   // axe hangs on the sandboxed preview frame
        const results = await axe.analyze();
        const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        expect(serious.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      }
    });
  }
});
