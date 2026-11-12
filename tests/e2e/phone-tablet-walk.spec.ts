import { test, expect, Page, Locator } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Sales list item 43 — the phone and tablet walk (Nov 2026). Home, Customers, a
// record, Pipeline and the Inbox were walked in the iOS Simulator's real Safari
// (iPhone 17 at 402px, iPad at 820px upright) with made-up data. What broke there
// is pinned here, at every project size:
//  · Inbox on an upright iPad: the split view left the reading pane ~180px wide —
//    the name ran over three lines, Resolve/Close sat on the chips, Send hung off
//    the edge. Under 1024px the panes now stack (list, then the conversation with
//    ← Inbox); the pane header and the reply row wrap instead of squeezing.
//  · On a 402px iPhone the same reply row put "… gets an email" one word per line
//    and pushed Send off the screen.
//  · The Inbox's view title spilled into "Send an update" where its column is 21rem.
//  · A touch screen of any width gets 44px controls — block 4 of shell.css only
//    reached phones, so an iPad's buttons, tabs, chips and drop-downs were 21–36px.
//  · Beside the sidebar the one-time tip centres on the content (it slid under it).
//  · The record's header kept a "·" at the end of a line when the email wrapped.

const ctx = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/agency.html', attention_count: 2, attention_stale: false, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };

const INBOX = {
  '/portal/context': ctx,
  '/portal/feed': { data: {
    role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, enquiries: [],
    client_messages: [
      { type: 'support', id: 's-1', subject: 'Logo files — please review the stacked one', status: 'open', priority: 'high', project: '', client_id: 'c-3', client: 'Juniper Floral Co.', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
    ],
  } },
  '/forms/inbox': { data: { submissions: [], unread: 0 } },
  '/notifications': { data: [], unread_count: 0 },
  '/support/s-1': { data: {
    request: { id: 's-1', subject: 'Logo files — please review the stacked one', status: 'open', priority: 'high', body: 'The new logo looks great. Could we try the stacked version on the homepage before Friday?', created_at: '2026-07-14T00:00:00Z' },
    messages: [{ id: 'sm1', body: 'Absolutely — two options this afternoon.', author_kind: 'studio', created_at: '2026-07-14T01:00:00Z' }],
    is_studio_view: true,
  } },
};

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const RECORD = {
  '/portal/context': ctx,
  '/crm/record': { data: {
    identity: { contact_id: null, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
    header: { name: 'Juniper Floral Co.', company: 'Juniper Floral Co.', email: 'ivy@juniperfloral.example', phone: '(555) 010-2299', status: 'customer' },
    highlights: {}, sections: { overview: true, messages: true, deal: true, delivery: false, details: true },
    default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
  } },
  '/crm/activity': { data: {
    items: [
      { id: 'act:c1', kind: 'activity', type: 'call', title: 'You logged a call', body: 'Walked through the homepage.', at: '2026-07-10T00:00:00Z', meta: 'Logged call', href: null },
      { id: 'act:n1', kind: 'activity', type: 'note', title: 'You added a note', body: 'Prefers email in the mornings.', at: '2026-07-08T00:00:00Z', meta: 'Note', href: null },
    ],
    upcoming: [], deal_id: DEAL, reply_to: null, reply_support_to: null,
  } },
};

const coarse = (page: Page) => page.evaluate(() => matchMedia('(pointer:coarse)').matches);
const vw = (page: Page) => page.evaluate(() => document.documentElement.clientWidth);
async function rect(l: Locator) { const b = await l.boundingBox(); if (!b) throw new Error('not laid out'); return b; }
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

test.describe('Phone and tablet walk (sales list item 43)', () => {
  test('Inbox: an open conversation fits the screen — the name, the triage buttons and Send', async ({ page }) => {
    await installApp(page, { api: INBOX });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Juniper Floral Co.' }).click();
    const pane = page.locator('#rpane');
    await expect(pane.locator('#supBody')).toBeVisible();
    const width = await vw(page);
    if (width < 1024) {
      // stacked: the conversation replaces the list and offers the way back
      await expect(page.locator('.lpane')).toBeHidden();
      await expect(page.locator('#paneBack')).toBeVisible();
    } else {
      await expect(page.locator('.lpane')).toBeVisible();
      await expect(page.locator('#paneBack')).toBeHidden();
    }
    // nothing the pane offers hangs off the right edge
    for (const l of [pane.locator('.pname'), pane.getByRole('button', { name: 'Resolve', exact: true }), pane.getByRole('button', { name: 'Send', exact: true }), pane.locator('#supReplyResolve')]) {
      const b = await rect(l);
      expect(b.x, 'starts on screen').toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, 'ends on screen').toBeLessThanOrEqual(width + 1);
    }
    // the triage buttons never sit on the name or its chips
    const name = await rect(pane.locator('.pname'));
    for (const chip of await pane.locator('.phead .pchip').all()) expect(overlaps(await rect(chip), await rect(pane.getByRole('button', { name: 'Resolve', exact: true })))).toBe(false);
    expect(overlaps(name, await rect(pane.getByRole('button', { name: 'Close', exact: true })))).toBe(false);
    // the name reads as a name: at most two lines, never one word per line
    expect(name.height).toBeLessThan(80);
    // "… gets an email" is a sentence, not a column of single words
    const reach = await rect(pane.locator('.crow > .muted'));
    expect(reach.height).toBeLessThan(60);
    // Send is inside the window vertically too (the pane fits the screen)
    const send = await rect(pane.getByRole('button', { name: 'Send', exact: true }));
    expect(send.y + send.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight) + 1);
  });

  test('Inbox: the view title never runs into "Send an update"', async ({ page }) => {
    for (const w of [1100, 1280]) {
      if ((await page.evaluate(() => matchMedia('(pointer:coarse)').matches)) && w !== 1280) continue;
      await page.setViewportSize({ width: w, height: 900 });
      await installApp(page, { api: INBOX });
      await page.goto('/inbox.html');
      await expect(page.locator('#rows [role=option]').first()).toBeVisible();
      const title = page.locator('#viewBtn');
      const spill = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
      const send = page.locator('#sendUpdate');
      if (await send.isVisible()) {
        expect(spill, `the title fits its box at ${w}px`).toBeLessThanOrEqual(1);
        expect(overlaps(await rect(title), await rect(send))).toBe(false);
      }
      // either way "Send an update" stays one tap away under ⋯
      await page.locator('#ovfBtn').click();
      await expect(page.locator('#ovfSend')).toBeVisible();
    }
  });

  test('A touch screen gets 44px controls; a mouse keeps the compact desktop sizes', async ({ page }) => {
    await installApp(page, { api: RECORD });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#act-invoice')).toBeVisible();
    const controls = ['#act-invoice', '#act-message', '#act-email', '#act-log', '.composer-tabs [role=tab]', '[id^=tab-]', '#dds-bell'];
    if (await coarse(page)) {
      for (const sel of controls) {
        for (const el of await page.locator(sel).all()) {
          if (!(await el.isVisible())) continue;
          const b = await rect(el);
          expect(b.height, `${sel} is a finger-sized target`).toBeGreaterThanOrEqual(43.5);
        }
      }
      // the sidebar's rows on a touch tablet (phones use the bottom bar instead)
      if ((await vw(page)) > 760) {
        for (const row of await page.locator('#dds-shell .dds-nav .sec > .it').all()) if (await row.isVisible()) expect((await rect(row)).height).toBeGreaterThanOrEqual(43.5);
      }
    } else {
      // a mouse and a trackpad keep the desktop density this pass didn't touch
      expect((await rect(page.locator('#act-invoice'))).height).toBeLessThan(40);
    }
  });

  test('A drop-down on a touch screen is drawn 44px tall (Safari ignores min-height on a native one)', async ({ page }) => {
    test.skip(!(await coarse(page)), 'touch screens only');
    await installApp(page, { api: INBOX });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Juniper Floral Co.' }).click();
    const sel = page.locator('#rpane select').first();
    await expect(sel).toBeVisible();
    expect(await sel.evaluate((el) => getComputedStyle(el).appearance || getComputedStyle(el).webkitAppearance)).toBe('none');
    expect((await rect(sel)).height).toBeGreaterThanOrEqual(43.5);
  });

  test('Beside the sidebar, the one-time tip sits clear of it', async ({ page }) => {
    await installApp(page, { api: RECORD });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const tip = page.locator('.dds-hint.show');
    await expect(tip).toBeVisible();
    const sidebar = page.locator('html.dds-side #dds-shell');
    if (await sidebar.count() && (await vw(page)) > 760) {
      const s = await rect(sidebar), t = await rect(tip);
      expect(t.x, 'the tip starts right of the sidebar').toBeGreaterThanOrEqual(s.x + s.width - 1);
    }
    const t = await rect(tip);
    expect(t.x + t.width).toBeLessThanOrEqual((await vw(page)) + 1);
  });

  test('The record header never leaves a "·" at the end of a line', async ({ page }) => {
    await installApp(page, { api: RECORD });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const sub = page.locator('.rec-sub');
    await expect(sub).toContainText('ivy@juniperfloral.example');
    // the only separators sit BETWEEN the email and the phone, inside one group
    await expect(sub.locator(':scope > .sep')).toHaveCount(0);
    await expect(sub.locator('.sep')).toHaveCount(1);
  });
});
