import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder items 247 and 335 (the full review of Nov 22 2026), direction A, Eric's pick: "A,
// website hero". The portal wears the studio's colour and heading font on every screen; Home opens
// with a band that carries the website as the hero (the site in a browser frame and a phone frame,
// one line saying where it stands, the project's steps as dots); Needs you is one bold card with
// the first row big; the studio is a card with its reply hours; the project page is a tracker with
// dates and whose move it is; icons are drawn, never emoji; approving is a moment; the sign-in
// page has a real picture; Settings holds the cover picture and the heading font.

const PID = '11111111-1111-4111-8111-111111111111';
const AW = '22222222-2222-4222-8222-222222222222';
const STUDIO_SITE = 'cccccccc-3333-4333-8333-cccccccccccc';
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false, site_id: STUDIO_SITE, cover_url: null, font: 'fraunces' };
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ymd = (offsetDays: number) => { const t = new Date(Date.now() + offsetDays * 86400000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

const CTX = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria', portal: { off: [], welcome: '', home_off: [], signin: { google: false, password: true }, reply: { within: 'within one business day', hours: 'Mon to Fri, 9 to 5' } }, ...over,
} });
const MS = [
  { id: 'm1', title: 'Kick-off', status: 'complete', due_date: ymd(-20), completed_at: new Date(Date.now() - 20 * 86400000).toISOString() },
  { id: 'm2', title: 'Design', status: 'open', due_date: ymd(5) },
  { id: 'm3', title: 'Build', status: 'open', due_date: ymd(15) },
  { id: 'm4', title: 'Launch', status: 'open', due_date: ymd(20) },
];
const PROJECT = { id: PID, name: 'juniperfloral.com', status: 'active', target_date: ymd(20) };
const bundle = (over: Record<string, unknown> = {}) => ({ data: {
  project: PROJECT, milestones: MS, tasks: [{ id: 't1', title: 'Send your logo and photos', status: 'todo', client_action_required: true, source: 'checklist:content' }],
  events: [], surveys: [], progress: { total: 4, done: 1, pct: 25 }, deliverables: [],
  approvals: [{ id: AW, title: 'Your website draft', subject_type: 'website', status: 'pending', summary: 'Does this feel like your shop?', content_hash: 'h1', created_at: new Date().toISOString() }], ...over,
} });
const API = (over: Record<string, unknown> = {}) => ({
  '/portal/context': CTX(),
  '/portal/feed': { data: { role: 'business_owner', moments: [{ id: 'mo1', headline: 'Your photo gallery is live', summary: 'Twelve photos, in place.', moment_type: 'good_news', created_at: new Date().toISOString() }], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [PROJECT] },
  [`/client/projects/${PID}`]: bundle(),
  [`/client/projects/${PID}/messages`]: { data: [] },
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: [] } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
  '/client/portal-pages': { data: { pages: [], links: [] } },
  '/client/website-stats': { data: { published: false, month: null, search: null } },
  '/client/website-thumb': { data: { html: '<html><body><h1 data-thumb-proof>Juniper Floral</h1></body></html>', version: 'draft' } },
  '/client/book': { data: { site_id: STUDIO_SITE } },
  '/portal/members': { data: [] },
  '/auth/backup-codes': { data: { remaining: 0, total: 0, created_at: null } },
  ...over,
});
const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const phone = () => /mobile/.test(test.info().project.name);

test.describe('direction A — the website is the hero', () => {
  test('the band carries the hero at every width: the kicker, "Launching in 20 days.", the steps, the site in a browser and a phone frame', async ({ page }) => {
    await installApp(page, { api: API({ [`/client/projects/${PID}`]: bundle({ approvals: [] }) }) });   // no draft yet: the launch line
    await page.goto('/client.html');
    const hero = page.locator('#hero-site');
    await expect(hero).toBeVisible();
    await expect(hero.locator('.hkick')).toHaveText(/^Your website · launch /);
    await expect(hero.locator('.hline')).toHaveText('Launching in 20 days.');
    await expect(hero.locator('.hsub')).toContainText('Marlow & Co is building it');
    const steps = hero.locator('.hsteps li');
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toHaveClass(/done/);
    await expect(steps.nth(1)).toHaveClass(/now/);
    await expect(steps.nth(3)).toHaveClass(/next/);
    await expect(hero.locator('#hpic-b iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
    await expect(hero.locator('#hpic-p iframe')).toHaveCount(1);
    await expect(page.frameLocator('#hpic-b iframe').locator('[data-thumb-proof]')).toHaveText('Juniper Floral');
    // the band is the studio's colour, and the hero sits inside it
    const band = await page.locator('#home-hero').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(band).not.toBe('rgba(0, 0, 0, 0)');
    expect(await cssVar(page, '--p')).toBe('#8c3b2e');
    // no numbers card while the site isn't live
    await expect(page.locator('#home-website')).toBeHidden();
    // the old emoji are gone from the page
    expect(await page.locator('#main').textContent()).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  test('a live site: "Live since", the address, visits, and the numbers card beside Needs you', async ({ page }) => {
    const since = new Date(Date.now() - 10 * 86400000).toISOString();
    await installApp(page, { api: API({ '/client/website-stats': { data: { published: true, site: { url: 'https://juniperfloral.example', last_published_at: since }, month: { visitors: 214, actions: 11, weekly: [40, 50, 60, 64], top_source: { source: 'Google', visitors: 120 } }, search: null } } }) });
    await page.goto('/client.html');
    const hero = page.locator('#hero-site');
    await expect(hero.locator('.hline')).toHaveText(/^Live since /);
    await expect(hero.locator('.hsub b')).toHaveText('214 people');
    await expect(hero.getByRole('link', { name: 'See your site' })).toHaveAttribute('href', 'https://juniperfloral.example');
    const numbers = page.locator('#home-website .wscard');
    await expect(numbers).toBeVisible();
    await expect(numbers.locator('.tag')).toHaveText('This month');
    await expect(numbers.locator('#wspic')).toHaveCount(0);   // the picture lives in the hero now
  });

  test('a draft ready: the hero says so, and See the design opens it', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.route(`**/functions/v1/presence/client/approvals/${AW}/draft*`, (route) => route.fulfill(json(200, { data: { approval: { id: AW, status: 'pending' }, page: '', pages: [{ slug: '', title: 'Home' }], sections: [], notes: [], html: '<html><body><h1>Fresh flowers daily</h1></body></html>' } })));
    await page.goto('/client.html');
    const hero = page.locator('#hero-site');
    await expect(hero.locator('.hline')).toHaveText('Your draft is ready to look at.');
    await hero.getByRole('button', { name: 'See the design' }).click();
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
  });

  test('Needs you is one bold card with the first row big; the studio’s card has its reply hours and one button', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/client.html');
    const first = page.locator('#needs-body .qcard .qrow').first();
    await expect(first).toBeVisible();
    const size = await first.locator('h3').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThanOrEqual(23);
    const studio = page.locator('#home-studio .studcard');
    await expect(studio.locator('.sname')).toHaveText('Marlow & Co');
    await expect(studio.locator('.shours')).toHaveText('Marlow & Co replies within one business day · Mon to Fri, 9 to 5');
    await expect(studio.getByRole('button', { name: 'Message Marlow & Co' })).toBeVisible();
    await expect(page.locator('#home-studio .launchcard .lk')).toHaveText('Launch day');
    await expect(page.locator('#home-studio .launchcard .ls')).toHaveText('20 days to go.');
    if (!phone()) {
      const top = (sel: string) => page.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().top));
      if ((await page.viewportSize())!.width >= 1000) expect(Math.abs(await top('#home-studio') - await top('#home-needs'))).toBeLessThan(4);
    }
    await studio.getByRole('button', { name: 'Message Marlow & Co' }).click();
    await expect(page.locator('#mpane #gmsg')).toBeVisible();
  });

  test('body text reads at 15px or more on the cards', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto('/client.html');
    await expect(page.locator('#needs-body .qmain p').first()).toBeVisible();
    const sizes = await page.locator('#main .card p, #main .muted').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(14.5);
  });

  test('the project page is a tracker: dates, what is done, and whose move it is', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto(`/client.html?project=${PID}`);
    const now = page.locator('#sec-overview .tracknow');
    await expect(now).toContainText('Now:');
    await expect(now.locator('b')).toHaveText('Design');
    await expect(now).toContainText('your move');
    const rows = page.locator('#sec-overview .track li');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toHaveClass(/done/);
    await expect(rows.nth(0).locator('.tm')).toContainText('Done');
    await expect(rows.nth(1)).toHaveClass(/now/);
    await expect(rows.nth(1).locator('.tw')).toHaveText('You');
    await expect(rows.nth(1).locator('.tm')).toContainText('Due');
    await expect(rows.nth(3).locator('.tm')).toContainText('Planned for');
    await expect(page.locator('#sec-milestones')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'A quick survey' })).toHaveCount(0);
  });

  test('approving is a moment: the words, and a burst that keeps nothing in the way', async ({ page }) => {
    await installApp(page, { api: API({ [`POST /client/approvals/${AW}/decide`]: { data: { ok: true } } }) });
    await page.route(`**/functions/v1/presence/client/approvals/${AW}/draft*`, (route) => route.fulfill(json(200, { data: { approval: { id: AW, status: 'pending' }, page: '', pages: [{ slug: '', title: 'Home' }], sections: [], notes: [], html: '<html><body><h1>Fresh flowers daily</h1></body></html>' } })));
    await page.goto(`/client.html?project=${PID}&approval=${AW}`);
    await page.locator('#apok').click();
    await expect(page.locator('#main h1')).toHaveText('Approved — thank you.');
    await expect(page.locator('#toast')).toContainText('Approved. Thank you.');
    const burst = page.locator('.confetti');
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!reduced) await expect(burst).toHaveCount(1);
    await expect(burst).toHaveCount(0, { timeout: 5000 });   // gone again; nothing lingers over the page
  });

  test('the heading font follows the studio’s choice', async ({ page }) => {
    await installApp(page, { api: API({ '/portal/context': CTX({ studio: { ...STUDIO, font: 'inter' } }) }) });
    await page.goto('/client.html');
    await expect(page.locator('#home-hero h1')).toBeVisible();
    expect(await cssVar(page, '--serif')).toMatch(/^["']Inter["']/);
  });
});

test.describe('direction A — a touch screen', () => {
  test.use({ hasTouch: true });
  test('every button in Needs you is a full finger’s tap (44px), the small rows too', { tag: '@touch' }, async ({ page }) => {
    const two = bundle({ tasks: [
      { id: 't1', title: 'Send your logo and photos', status: 'todo', client_action_required: true, source: 'checklist:content' },
      { id: 't2', title: 'Write a few words about your shop', status: 'todo', client_action_required: true },
    ] });
    await installApp(page, { api: API({ [`/client/projects/${PID}`]: two }) });
    await page.goto('/client.html');
    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
    const rows = page.locator('#needs-body .qcard .qrow');
    await expect(rows.nth(1)).toBeVisible();   // a second, small row
    const acts = page.locator('#needs-body .qcard .qact button, #needs-body .qcard .qact a');
    await expect(rows.nth(1).locator('.qact button, .qact a').first()).toBeVisible();
    const heights = await acts.evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
    expect(heights.length).toBeGreaterThan(1);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});

test.describe('direction A — the sign-in page and Settings', () => {
  test('the sign-in page has a real picture behind the words, and the studio’s own when it chose one', async ({ page }) => {
    await installApp(page, { session: null, api: { [`/public/studio/${STUDIO_SITE}/brand`]: { data: { ...STUDIO, cover_url: 'https://pictures.example/cover.jpg', signin: { google: false, password: true } } } } });
    await page.route('https://pictures.example/**', (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.alloc(0) }));
    await page.goto(`/portal.html?studio=${STUDIO_SITE}`);
    await expect(page.locator('#brand .word')).toHaveText('Marlow & Co');
    await expect(page.locator('.glimpse')).toHaveCount(0);
    await expect.poll(() => page.locator('.side').evaluate((e) => (e as HTMLElement).style.backgroundImage)).toContain('pictures.example/cover.jpg');
    await installApp(page, { session: null, api: { [`/public/studio/${STUDIO_SITE}/brand`]: { data: { ...STUDIO, signin: { google: false, password: true } } } } });
    await page.goto(`/portal.html?studio=${STUDIO_SITE}`);
    expect(await page.locator('.side').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('portal-cover.jpg');
  });

  test('Settings: the cover picture comes from Files and the heading font saves with the portal’s choices', async ({ page }) => {
    const saves: unknown[] = [];
    await installApp(page, { api: {
      '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, scope: null, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV } },
      '/agency/portal': { data: { off: [], welcome: '', home_off: [], signin: { google: false, password: true }, reply: { within: '', hours: '' }, look: { cover_media_id: null, heading_font: 'fraunces' }, clients: [], parts: [], cards: [], welcome_max: 500, can_edit: true } },
      '/agency/portal/overview': { data: { address: 'https://app.example/portal.html?studio=x', slug: '', counts: {}, clients: [], setup: [], can_edit: true } },
      '/media': { data: [{ id: '44444444-4444-4444-8444-444444444444', alt_text: 'The shop front', thumb: 'https://pictures.example/t.jpg', width: 1200, height: 800 }] },
      '/brand/studio': { data: { ...STUDIO, cover_url: 'https://pictures.example/cover.jpg' } },
    } });
    await page.route('https://pictures.example/**', (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.alloc(0) }));
    await page.route('**/functions/v1/presence/agency/portal', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON(); saves.push(body);
      return route.fulfill(json(200, { data: { off: [], welcome: '', home_off: [], signin: { google: false, password: true }, reply: { within: '', hours: '' }, look: body.look } }));
    });
    await page.goto('/settings.html#portalParts');
    await expect(page.locator('#portalLookRow')).toBeVisible();
    await page.locator('#portalFont').selectOption('inter');
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toMatchObject({ look: { heading_font: 'inter' } });
    await page.locator('#portalCoverPick').click();
    await page.locator('[data-cover]').first().click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1]).toMatchObject({ look: { cover_media_id: '44444444-4444-4444-8444-444444444444', heading_font: 'inter' } });
    await expect(page.locator('#portalCoverPic')).toBeVisible();
  });
});
