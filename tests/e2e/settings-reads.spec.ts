import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Bug hunt C (Nov 10 2026), Settings.
// C3  the four stalled-days boxes save as one set, from the boxes on screen, one save
//     at a time: change two in a row and both are kept (the first used to be lost
//     under two "Saved.")
// C4  a read that failed is not "nothing saved yet": the part it feeds says it
//     couldn't load and keeps its save off (it showed blanks, and the next save wrote
//     them over the real settings); Try again reads it again
// C9  a link straight to Plan & billing stays on it while the parts above fill in
// C16 the Deal stages row needs configure like its section; Plan & billing lights up
//     in the side list; "chances set" only when one differs from its usual percent;
//     Your menu greys its switches while one saves, and for a role that can't change it

const IDENTITY = { data: { site_id: 's1', business_name: 'Brightline Studio', email: 'hello@brightline.example', phone: '555 0100', service_area: 'Burbank, CA' } };
const CHANCES = { lead: 10, qualified: 25, proposal: 50, contract: 75 };
const STAGES = (chances: Record<string, number> = CHANCES) => ({ data: { labels: { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' }, custom: {}, defaults: {}, chances: { ...chances, won: 100, lost: 0 }, chance_defaults: { ...CHANCES, won: 100, lost: 0 } } });
const API = {
  '/identity': IDENTITY,
  '/settings': { data: { industry_key: 'salon', invoice_reminders: true, stage_stale_days: { proposal: 7 } } },
  '/sales/stages': STAGES(),
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-12-03T00:00:00Z', in_grace: false, has_service_billing: false } },
};
const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
} };
const CHOICES = ['Sites', 'Inbox', 'Customers', 'Pipeline', 'Projects', 'Files'].map((label) => ({ key: label.toLowerCase(), label, what: `${label}, in the menu.` }));
const MENU = (over: Record<string, unknown> = {}) => ({ data: { hidden: ['files'], choices: CHOICES, can_edit: true, ...over } });
const TEAM = {
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'eric@bright.example', member_id: 'm-1' } },
  '/agency/members': { data: ['eric', 'sam', 'kim', 'lee', 'pat'].map((n, i) => ({ id: 'm-' + (i + 1), email: `${n}@bright.example`, role: i ? 'designer' : 'owner', status: 'active', created_at: '2026-01-10T00:00:00Z' })) },
  '/agency/usage': { data: { plan: 'agency', seats: { used: 5, limit: 6 } } },
};
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const toast = (page: Page, text: string) => page.locator('.dds-toast', { hasText: text });

test.describe('Settings — the stalled-days boxes (bug hunt C3)', () => {
  test('two boxes changed one after the other: both are kept', async ({ page }) => {
    const stored: Record<string, unknown> = { industry_key: 'salon', invoice_reminders: true, stage_stale_days: { proposal: 7 } };
    const puts: Array<Record<string, unknown>> = [];
    let release!: () => void; let held: Promise<void> | null = new Promise<void>((r) => { release = r; });
    await installApp(page, { api: API });
    await page.route((u) => u.pathname.endsWith('/presence/settings'), async (route) => {
      if (route.request().method() !== 'PUT') return route.fulfill(json(200, { data: stored }));
      const body = route.request().postDataJSON(); puts.push(body);
      if (held) { const h = held; held = null; await h; }   // the first save is slow
      Object.assign(stored, body);
      return route.fulfill(json(200, { data: { ...stored } }));
    });
    await page.goto('/settings.html');
    await expect(page.locator('#st-proposal')).toHaveValue('7');
    await page.locator('#st-lead').fill('20');
    await page.locator('#st-lead').press('Tab');            // first save goes, and waits
    await expect.poll(() => puts.length).toBe(1);
    await page.locator('#st-qualified').fill('30');
    await page.locator('#st-qualified').press('Tab');       // changed while the first is saving
    release();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[0]).toEqual({ stage_stale_days: { proposal: 7, lead: 20 } });
    expect(puts[1]).toEqual({ stage_stale_days: { proposal: 7, lead: 20, qualified: 30 } });
    await expect(page.locator('#st-lead')).toHaveValue('20');
    await expect(page.locator('#st-qualified')).toHaveValue('30');
    expect(stored.stage_stale_days).toEqual({ proposal: 7, lead: 20, qualified: 30 });
  });

  test('a switch saved meanwhile never puts the old days back', async ({ page }) => {
    const stored: Record<string, unknown> = { industry_key: 'salon', invoice_reminders: true, stage_stale_days: { proposal: 7 } };
    await installApp(page, { api: API });
    let releaseSwitch!: () => void; const switchHeld = new Promise<void>((r) => { releaseSwitch = r; });
    await page.route((u) => u.pathname.endsWith('/presence/settings'), async (route) => {
      if (route.request().method() !== 'PUT') return route.fulfill(json(200, { data: stored }));
      const body = route.request().postDataJSON();
      const snapshot = { ...stored, ...body };   // the answer as the server wrote it, at this moment
      if ('deal_nudges' in body) await switchHeld;       // the switch's answer comes back late
      Object.assign(stored, body);
      return route.fulfill(json(200, { data: snapshot }));
    });
    await page.goto('/settings.html');
    await expect(page.locator('#st-proposal')).toHaveValue('7');
    await page.locator('#sw-deal').click();                // its answer will carry proposal: 7
    await page.locator('#st-proposal').fill('12');
    await page.locator('#st-proposal').press('Tab');
    await expect(toast(page, 'Saved.')).toBeVisible();
    releaseSwitch();
    await expect(page.locator('#sw-deal')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#st-proposal')).toHaveValue('12');
  });
});

test.describe('Settings — a read that failed (bug hunt C4)', () => {
  test('the details didn’t load: the card says so, Save is off, and Try again loads them', async ({ page }) => {
    let fail = true; let puts = 0;
    await installApp(page, { api: API });
    await page.route((u) => u.pathname.endsWith('/presence/identity'), (route) => {
      if (route.request().method() === 'PUT') { puts++; return route.fulfill(json(200, IDENTITY)); }
      return route.fulfill(fail ? json(502, { error: 'read_failed' }) : json(200, IDENTITY));
    });
    await page.goto('/settings.html');
    const card = page.locator('#studio');
    await expect(card.locator('.unread')).toContainText('Your details couldn’t load just now. Saving is off until they do');
    await expect(page.locator('#profileSave')).toBeDisabled();
    await expect(page.locator('#profileForm')).toBeHidden();
    fail = false;
    await card.locator('.unread button').click();
    await expect(card.locator('.unread')).toHaveCount(0);
    await expect(page.locator('#f-name')).toHaveValue('Brightline Studio');
    await expect(page.locator('#profileSave')).toBeEnabled();
    expect(puts).toBe(0);
  });

  test('/settings didn’t load: the automations and stalled days are held, nothing can be flipped', async ({ page }) => {
    let puts = 0;
    await installApp(page, { api: API });
    await page.route((u) => u.pathname.endsWith('/presence/settings'), (route) => {
      if (route.request().method() === 'PUT') { puts++; return route.fulfill(json(200, { data: {} })); }
      return route.abort('internetdisconnected');
    });
    await page.goto('/settings.html');
    await expect(page.locator('#automations .unread')).toContainText('Your automations couldn’t load just now.');
    await expect(page.locator('#sw-ack')).toBeHidden();
    await expect(page.locator('#stages .unread')).toContainText('couldn’t load just now');
    await expect(page.locator('#staleRow')).toBeHidden();
    await expect(page.locator('#stageNames')).toBeVisible();   // the names come from their own read, which answered
    await expect(page.locator('#studio .unread')).toBeVisible(); // the kind of business is a setting too
    await expect(page.locator('#profileSave')).toBeDisabled();
    expect(puts).toBe(0);
  });

  test('a good read: no notices, everything as saved', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await expect(page.locator('#f-industry')).toHaveValue('salon');
    await expect(page.locator('#sw-inv')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.unread')).toHaveCount(0);
  });
});

test.describe('Settings — a link straight to Plan & billing (bug hunt C9)', () => {
  test('it lands on billing and stays there while Team and Your menu fill in above it', async ({ page }) => {
    let release!: () => void; const held = new Promise<void>((r) => { release = r; });
    await installApp(page, { api: { ...API, ...TEAM, '/portal/context': AGENCY_CTX, '/agency/nav': MENU() } });
    await page.route((u) => /\/presence\/agency\/(members|nav)$/.test(u.pathname), async (route) => { await held; return route.fallback(); });
    await page.goto('/settings.html#billing');
    await expect(page.locator('#plan')).toContainText('Studio');
    const before = (await page.locator('#billing').boundingBox())!.y;
    release();
    await expect(page.locator('#people')).toContainText('pat@bright.example');
    await expect(page.locator('#menuRows .swrow')).toHaveCount(6);
    // billing is the last part, so it sits as high as the page lets it; Team and Your menu
    // (several hundred pixels) arriving above it used to push it below the screen
    const vh = page.viewportSize()!.height;
    expect(before).toBeLessThan(vh - 100);
    await expect.poll(async () => Math.abs((await page.locator('#billing').boundingBox())!.y - before)).toBeLessThan(40);
    await expect(page.locator('#billingHead')).toBeInViewport();
  });
});

test.describe('Settings — the side list and its rows (bug hunt C16)', () => {
  test('a member who may not configure sees no Deal stages row, as the section itself is hidden', async ({ page }) => {
    // an invited staff seat (an owner lacks nothing): no configure
    const ctx = { data: { ...AGENCY_CTX.data, site_role: 'business_staff', is_agency: false, capabilities: ['edit', 'publish', 'invite', 'view_all'] } };
    await installApp(page, { api: { ...API, '/portal/context': ctx } });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="studio"]')).toBeVisible();
    await expect(page.locator('[data-card="stages"]')).toBeHidden();
    await expect(page.locator('#stages')).toBeHidden();
  });

  test('at the bottom of the page Plan & billing is the part marked, and a click marks its row', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the list beside the sections is for wider screens');
    await page.setViewportSize({ width: 1360, height: 900 });
    await installApp(page, { api: API });
    await page.goto('/settings.html');
    await expect(page.locator('#plan')).toContainText('Studio');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('[data-card="billing"]')).toHaveAttribute('aria-current', 'location');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('[data-card="studio"]')).toHaveAttribute('aria-current', 'location');
    await page.locator('[data-card="billing"]').click();
    await expect(page.locator('[data-card="billing"]')).toHaveAttribute('aria-current', 'location');
  });

  test('“chances set” only once a percent differs from its usual one, and it follows a save', async ({ page }) => {
    await installApp(page, { api: { ...API, '/sales/stages': STAGES() } });
    await page.route((u) => u.pathname.endsWith('/presence/sales/stages'), (route) => route.request().method() === 'PUT'
      ? route.fulfill(json(200, STAGES({ ...CHANCES, ...route.request().postDataJSON().chances })))
      : route.fallback());
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="stages"] .st')).toHaveText('4 stages');
    await page.locator('#sc-proposal').fill('60');
    await page.locator('#scSave').click();
    await expect(page.locator('#scMsg')).toContainText('Saved.');
    await expect(page.locator('[data-card="stages"] .st')).toHaveText('4 stages · chances set');
  });

  test('Your menu greys every switch while one saves, so a second press can’t vanish unsent', async ({ page }) => {
    const puts: unknown[] = [];
    let release!: () => void; const held = new Promise<void>((r) => { release = r; });
    await installApp(page, { api: { ...API, '/portal/context': AGENCY_CTX, '/agency/nav': MENU() } });
    await page.route((u) => u.pathname.endsWith('/presence/agency/nav'), async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON(); puts.push(body); await held;
      return route.fulfill(json(200, { data: { hidden: body.hidden, choices: CHOICES, can_edit: true } }));
    });
    await page.goto('/settings.html');
    await expect(page.locator('#menuRows .swrow')).toHaveCount(6);
    await page.locator('#sw-menu-sites').click();
    await expect(page.locator('#sw-menu-sites')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#menuRows .sw[aria-disabled="true"]')).toHaveCount(6);
    await page.locator('#sw-menu-pipeline').click({ force: true });   // pressed while greyed
    release();
    await expect(page.locator('#menuRows .sw[aria-disabled="true"]')).toHaveCount(0);
    expect(puts).toEqual([{ hidden: ['files', 'sites'] }]);
    await expect(page.locator('#sw-menu-pipeline')).toHaveAttribute('aria-checked', 'true');   // the greyed press did nothing, and shows nothing
  });

  test('Your menu by keyboard: the switch keeps focus through its save and redraws', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': AGENCY_CTX, '/agency/nav': MENU() } });
    await page.route((u) => u.pathname.endsWith('/presence/agency/nav'), (route) => route.request().method() === 'PUT'
      ? route.fulfill(json(200, { data: { hidden: route.request().postDataJSON().hidden, choices: CHOICES, can_edit: true } }))
      : route.fallback());
    await page.goto('/settings.html');
    await page.locator('#sw-menu-sites').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.dds-toast', { hasText: 'Hidden.' })).toBeVisible();
    await expect(page.locator('#sw-menu-sites')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#sw-menu-sites')).toBeFocused();
  });

  test('a role the server won’t let change the menu sees it, greyed, with a word why', async ({ page }) => {
    let puts = 0;
    await installApp(page, { api: { ...API, '/portal/context': AGENCY_CTX, '/agency/nav': MENU({ can_edit: false }) } });
    await page.route((u) => u.pathname.endsWith('/presence/agency/nav'), (route) => { if (route.request().method() === 'PUT') puts++; return route.fallback(); });
    await page.goto('/settings.html');
    await expect(page.locator('#menuRows .sw[aria-disabled="true"]')).toHaveCount(6);
    await expect(page.locator('#menuNote')).toContainText('Your role can see the menu but not change it.');
    await page.locator('#sw-menu-sites').click({ force: true });   // pressed anyway
    await expect(page.locator('#sw-menu-sites')).toHaveAttribute('aria-checked', 'true');
    expect(puts).toBe(0);
  });
});
