import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 165 (Nov 2026; review file 05, findings 9 and 10; Figma 295:100 and 296:2).
// Settings saved three ways: a Save pill on the profile, two different Save buttons on Deal
// stages (whose day boxes had none) and switches that saved as they flipped. Now everything
// saves as you go — a box when you leave it, a pick when you make it, a switch when you flip
// it — with a small "Saved" tick beside what changed, and "Couldn't save · Try again" in the
// same place when a save doesn't go, the box keeping your words. On a phone a card's title
// has its own line ("Your men / u" broke beside its hint). Developer tools and Get started
// leave the old cream for the shared look, in plain words. Names are made up.

const IDENTITY = { data: { site_id: 's1', business_name: 'Brightline Studio', email: 'hello@brightline.example', phone: '', service_area: 'Burbank, CA' } };
const STAGES = { data: { labels: { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' }, custom: {}, defaults: {}, chances: { lead: 10, qualified: 30, proposal: 60, contract: 85, won: 100, lost: 0 }, chance_defaults: { lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 } } };
const API = {
  '/identity': IDENTITY,
  '/settings': { data: { industry_key: 'generic', stage_stale_days: { lead: 7, qualified: 10, proposal: 14, contract: 7 } } },
  '/sales/stages': STAGES,
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-12-03T00:00:00Z', in_grace: false, has_service_billing: false } },
};
const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
} };
const CHOICES = ['Sites', 'Inbox', 'Customers', 'Pipeline', 'Projects', 'Files'].map((label) => ({ key: label.toLowerCase(), label, what: `${label}, in the menu.` }));
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 761;

test.describe('Settings: one way to save (builder item 165)', () => {
  test('no Save buttons anywhere; every card that changes things says “Changes save as you go.”', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': AGENCY_CTX, '/agency/nav': { data: { hidden: [], choices: CHOICES, can_edit: true } } } });
    await page.goto('/settings.html');
    await expect(page.locator('#f-name')).toHaveValue('Brightline Studio');
    await expect(page.locator('#menuRows .swrow')).toHaveCount(6);
    await expect(page.locator('#stageGrid')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save\b/ })).toHaveCount(0);
    for (const id of ['#profileHint', '#stagesHint', '#autoHint']) await expect(page.locator(id)).toContainText('Changes save as you go.');
    await expect(page.locator('#menu .card-h .hint')).toContainText('Changes save as you go.');
    // the drawn Deal stages: a row per open stage — name, chance, stalled after
    await expect(page.locator('#stageGrid .sthead')).toHaveText(/Stage\s*Chance\s*Stalled after/);
    await expect(page.locator('#sc-proposal')).toHaveValue('60');
    await expect(page.locator('#st-qualified')).toHaveValue('10');
    await expect(page.locator('#sn-lead')).toHaveAttribute('placeholder', 'New lead');
  });

  test('a box that didn’t save says so beside its label, keeps your words, and Try again saves them', async ({ page }) => {
    let fail = true;
    const puts: unknown[] = [];
    await installApp(page, { api: API });
    await page.route((u) => u.pathname.endsWith('/presence/identity'), (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      puts.push(route.request().postDataJSON());
      return fail ? route.abort('internetdisconnected') : route.fulfill(json(200, { data: { ...IDENTITY.data, ...route.request().postDataJSON() } }));
    });
    await page.goto('/settings.html#studio');
    await expect(page.locator('#f-name')).toHaveValue('Brightline Studio');
    const phone = page.locator('#f-phone'), said = page.locator('#fs-f-phone');
    await phone.fill('(818) 555-0123');
    await phone.press('Tab');
    await expect(said).toHaveText('Couldn’t save · Try again');
    await expect(phone).toHaveValue('(818) 555-0123');
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    fail = false;
    await said.getByRole('button', { name: 'Try again' }).click();
    await expect(said).toHaveText('Saved');
    await expect(phone).not.toHaveAttribute('aria-invalid', 'true');
    expect(puts).toEqual([{ phone: '(818) 555-0123' }, { phone: '(818) 555-0123' }]);
    // a refusal that says why says it (and Try again wouldn't help)
    await page.route((u) => u.pathname.endsWith('/presence/identity'), (route) => route.request().method() === 'PUT'
      ? route.fulfill(json(422, { error: 'validation_failed', message: 'Some fields need a second look.', fields: [{ field: 'email', message: 'Doesn’t look like an email address.' }] }))
      : route.fallback());
    await page.locator('#f-email').fill('hello at brightline');
    await page.locator('#f-email').press('Tab');
    await expect(page.locator('#fs-f-email')).toHaveText('Couldn’t save. Doesn’t look like an email address.');
    await expect(page.locator('#f-email')).toHaveValue('hello at brightline');
  });

  // the box's own message, in builder item 202's words: a business owner's business, a studio's studio
  for (const [who, ctx, words] of [['a business owner', null, 'Give the business a name.'], ['a studio', AGENCY_CTX, 'Give your studio a name.']] as const) {
    test(`a name can’t be left empty: the box says so (${who}) and nothing is sent`, async ({ page }) => {
      let puts = 0;
      await installApp(page, { api: ctx ? { ...API, '/portal/context': ctx } : API });
      await page.route((u) => u.pathname.endsWith('/presence/identity'), (route) => { if (route.request().method() === 'PUT') puts++; return route.fallback(); });
      await page.goto('/settings.html#studio');
      await expect(page.locator('#f-name')).toHaveValue('Brightline Studio');
      await page.locator('#f-name').fill('');
      await page.locator('#f-name').press('Tab');
      await expect(page.locator('#fs-f-name')).toHaveText(words);
      await expect(page.locator('#f-name')).toHaveAttribute('aria-invalid', 'true');
      expect(puts).toBe(0);
    });
  }

  test('a stalled-after box saves when it’s left, and its row says Saved', async ({ page }) => {
    const sent: unknown[] = [];
    await installApp(page, { api: API });
    await page.route((u) => u.pathname.endsWith('/presence/settings'), (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      sent.push(route.request().postDataJSON());
      return route.fulfill(json(200, { data: { ...API['/settings'].data, ...route.request().postDataJSON() } }));
    });
    await page.goto('/settings.html#stages');
    await expect(page.locator('#st-contract')).toHaveValue('7');
    await page.locator('#st-contract').fill('21');
    await page.locator('#st-contract').press('Tab');
    await expect(page.locator('#fs-stage-contract')).toHaveText('Saved');
    expect(sent).toEqual([{ stage_stale_days: { lead: 7, qualified: 10, proposal: 14, contract: 21 } }]);
  });

  test('on a phone a card’s title has its own line and the hint drops under it, never a word broken', { tag: '@layout' }, async ({ page }) => {
    test.skip(!isPhone(page), 'a phone’s width');
    await installApp(page, { api: { ...API, '/portal/context': AGENCY_CTX, '/agency/nav': { data: { hidden: [], choices: CHOICES, can_edit: true } } } });
    await page.goto('/settings.html');
    await expect(page.locator('#menuRows .swrow')).toHaveCount(6);
    for (const id of ['menu', 'stages', 'automations', 'studio']) {
      const h = page.locator(`#${id} .card-h h2`), hint = page.locator(`#${id} .card-h .hint`);
      await h.scrollIntoViewIfNeeded();
      const hb = (await h.boundingBox())!, nb = (await hint.boundingBox())!;
      expect(nb.y).toBeGreaterThanOrEqual(hb.y + hb.height - 1);                 // the hint is under the title
      // every word of the title on one line with itself: a word broken mid-way makes the title
      // taller than its own words need (measured with the same font, unbroken)
      const broken = await h.evaluate((el) => {
        const r = document.createRange(); r.selectNodeContents(el);
        const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
        const words = (el.textContent || '').trim().split(/\s+/);
        return lines.size > words.length;
      });
      expect(broken).toBe(false);
    }
    // the stage table fits the screen
    await page.locator('#stageGrid').scrollIntoViewIfNeeded();
    const vw = page.viewportSize()!.width;
    for (const sel of ['#sn-contract', '#scc-contract', '#stc-contract']) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(vw);
    }
  });

  test('Your menu: a switch says Saved beside itself; a refused flip goes back and says so', async ({ page }) => {
    let fail = false;
    await installApp(page, { api: { ...API, '/portal/context': AGENCY_CTX, '/agency/nav': { data: { hidden: [], choices: CHOICES, can_edit: true } } } });
    await page.route((u) => u.pathname.endsWith('/presence/agency/nav'), (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      return fail ? route.fulfill(json(502, { error: 'write_failed' })) : route.fulfill(json(200, { data: { hidden: route.request().postDataJSON().hidden, choices: CHOICES, can_edit: true } }));
    });
    await page.goto('/settings.html#menu');
    await expect(page.locator('#menuRows .swrow')).toHaveCount(6);
    await page.locator('#sw-menu-files').click();
    await expect(page.locator('#fs-menu-files')).toHaveText('Saved');
    await expect(page.locator('.dds-toast')).toHaveCount(0);   // said in place, not in a passing toast
    fail = true;
    await page.locator('#sw-menu-inbox').click();
    await expect(page.locator('#fs-menu-inbox')).toHaveText('Couldn’t save · Try again');
    await expect(page.locator('#sw-menu-inbox')).toHaveAttribute('aria-checked', 'true');
  });

  test('Settings has no serious or critical accessibility findings with a tick and a failure showing, light and dark', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once');
    test.slow();   // two full scans of a long page
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: API });
      await page.route((u) => u.pathname.endsWith('/presence/identity'), (route) => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.fallback());
      await page.goto('/settings.html#studio');
      await expect(page.locator('#f-name')).toHaveValue('Brightline Studio');
      await page.locator('#f-industry').selectOption('plumber');
      await expect(page.locator('#fs-f-industry')).toHaveText('Saved');
      await page.locator('#f-phone').fill('555 0100');
      await page.locator('#f-phone').press('Tab');
      await expect(page.locator('#fs-f-phone')).toContainText('Couldn’t save');
      // a colour still easing in reads as its halfway shade: the side list marks the open section with a
      // 0.12s change, and axe caught it mid-way in dark about one run in five. Let what's moving settle first.
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).include('#main').analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    }
  });
});

// ── the three cream pages, in plain words (Figma 296:2) ──────────────────────
const DEV_FILES = { data: { files: [
  { path: 'theme/tokens.json', kind: 'theme', editable: true },
  { path: 'styles/custom.css', kind: 'css', editable: true },
  { path: 'blocks/custom.html', kind: 'html', editable: true },
  { path: 'templates/home.tsx', kind: 'template', editable: false },
], template: { slug: '', version: '' } } };
const DEV_CUST = { data: { theme_tokens: { accent: '#6d3fd4' }, custom_css: '', custom_html: '', allowed_tokens: ['accent', 'ink'] } };
const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('Developer tools, Get started and the Health Center, in plain words (builder item 165)', () => {
  test('Developer tools: its name, one plain line, the shared look, no Save buttons and no stray @', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: { '/dev/files': DEV_FILES, '/dev/customization': DEV_CUST } });
    await page.goto('/developer.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Developer tools' })).toBeVisible();
    await expect(page).toHaveTitle('Developer tools — Studio OS');
    await expect(page.locator('header.dds-ph .dds-ph-line')).toHaveText('Your site’s colors and type, your own styles and a block of your own HTML. These are for you, not your clients. Changes save as you go.');
    await expect(page.locator('#main')).not.toContainText('Developer Mode');
    await expect(page.locator('#main')).not.toContainText('@');                  // the empty template read "@"
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await bg(page)).toBe('rgb(243, 243, 248)');                           // the cool grey, not the cream (250, 248, 245)
    await page.locator('[data-path="templates/home.tsx"]').click();
    await expect(page.locator('.readonly')).toContainText('This file comes with your site’s template, so it can’t be changed here.');
    await expect(page.locator('.readonly')).not.toContainText('SDK');
  });

  test('Developer tools save as you go: a box when it’s left, a file when you leave it, and a failure says so', async ({ page }) => {
    let fail = false;
    const sent: Array<Record<string, unknown>> = [];
    await installApp(page, { api: { '/dev/files': DEV_FILES, '/dev/customization': DEV_CUST } });
    await page.route((u) => u.pathname.endsWith('/presence/dev/customization'), (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON(); sent.push(body);
      return fail ? route.fulfill(json(502, { error: 'write_failed' })) : route.fulfill(json(200, { data: { saved: body } }));
    });
    await page.goto('/developer.html');
    const accent = page.locator('[data-tok="accent"]');
    await expect(accent).toHaveValue('#6d3fd4');
    await accent.fill('#226644');
    await accent.press('Tab');
    await expect(page.locator('#devSaved')).toHaveText('Saved');
    expect(sent.map((b) => (b.theme_tokens as Record<string, string>).accent)).toEqual(['#226644']);
    await page.locator('[data-path="styles/custom.css"]').click();
    await page.locator('#css').fill('.hero h1 { letter-spacing: -0.02em; }');
    fail = true;
    await page.locator('[data-path="blocks/custom.html"]').click();              // leaving the file saves it
    await expect(page.locator('#devSaved')).toHaveText('Couldn’t save · Try again');
    expect(sent.at(-1)!.custom_css).toBe('.hero h1 { letter-spacing: -0.02em; }');
    fail = false;
    await page.locator('#devSaved').getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#devSaved')).toHaveText('Saved');
    expect(sent).toHaveLength(3);
  });

  test('Get started: three boxes a screen reader can name, the tab says Studio OS, no footer, the shared look', { tag: '@layout' }, async ({ page }) => {
    await installApp(page, { api: { '/identity': IDENTITY, '/settings': { data: {} }, '/offerings': { data: [] } } });
    await page.goto('/get-started.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Let’s build your website.');
    await expect(page).toHaveTitle('Get started — Studio OS');
    await expect(page.getByRole('textbox', { name: 'First thing you offer' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Second thing you offer' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Third thing you offer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove the first thing you offer' })).toBeVisible();
    await expect(page.getByRole('group', { name: /A few things you offer/ })).toBeVisible();
    await expect(page.locator('footer')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Presence');
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await bg(page)).toBe('rgb(243, 243, 248)');
  });

  test('the Health Center says what it is in plain words', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': { data: { overall: 'ok', areas: [{ key: 'platform', label: 'Platform', state: 'ok', detail: 'All required configuration is present.' }] } } } });
    await page.goto('/admin-health.html');
    await expect(page.locator('#sub')).toHaveText('How every site is doing, in one place: online, fast, secure and found on Google.');
    await expect(page.locator('body')).not.toContainText('One operational read');
  });

  for (const scheme of ['light', 'dark'] as const) for (const path of ['/developer.html', '/get-started.html']) {
    test(`${path} has no serious or critical accessibility findings (${scheme})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once');
      test.slow();
      await page.emulateMedia({ colorScheme: scheme });
      await installApp(page, { api: { '/dev/files': DEV_FILES, '/dev/customization': DEV_CUST, '/identity': IDENTITY, '/settings': { data: {} }, '/offerings': { data: [] } } });
      {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // the preview is a sandboxed frame with no scripts; axe can't reach into it (it hangs), so it is left out
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('iframe.pv').analyze();
        const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        expect(serious.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 100)).join(' | ')}`)).toEqual([]);
      }
    });
  }
});
