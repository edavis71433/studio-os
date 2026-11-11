import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { applyPhoneBar } from '../../supabase/functions/presence/lib/phone_bar';

// The phone bar (builder list item 122, Nov 2026; Figma "A · Phone bar"): Call, Directions, Hours
// and Email along the bottom of every page on a phone, from the business details, with one choice,
// Off, Light or Dark, in the Footer card. Here: the card's choice and what it says, the page redrawn
// with the bar, the canvas at a phone's width, then a visitor's page on a phone and on a computer.
const WEEK = [
  { day: 'mon', closed: false, intervals: [{ open: '09:00', close: '17:00' }] }, { day: 'tue', closed: false, intervals: [{ open: '09:00', close: '17:00' }] },
  { day: 'wed', closed: false, intervals: [{ open: '09:00', close: '17:00' }] }, { day: 'thu', closed: false, intervals: [{ open: '09:00', close: '17:00' }] },
  { day: 'fri', closed: false, intervals: [{ open: '09:00', close: '20:00' }] }, { day: 'sat', closed: false, intervals: [{ open: '10:00', close: '16:00' }] },
  { day: 'sun', closed: true, intervals: [] },
];
const IDENTITY = { business_name: 'Marlow’s Kitchen', phone: '(555) 010-0100', email: 'hello@marlows.example' };
const LOCATION = { address_line1: '12 Olive Ave', city: 'Burbank', region: 'CA', postal_code: '91502', timezone: 'America/Los_Angeles', hours: WEEK };
const DETAILS = { identity: IDENTITY, locations: [LOCATION] };
const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--accent:#23635a}body{margin:0}header.site{background:#fff;padding:18px 24px}section{padding:48px 24px;min-height:500px}footer.site{background:#201b17;color:#fff;padding:40px 24px}</style></head><body>'
  + '<header class="site"><a class="brand" href="/">Marlow’s Kitchen</a></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2></section></main>'
  + '<footer class="site"><div class="wrap"><h2>Marlow’s Kitchen</h2><p>12 Olive Ave, Burbank</p></div></footer></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Write = { method: string; path: string; body: any };
// The editor on the canvas, with these business details and this phone bar choice to start with.
// The page is drawn the way the server draws it: with the bar when the choice is on.
async function mount(page: Page, opts: { identity?: object; location?: object; bar?: string } = {}) {
  const identity = opts.identity || IDENTITY, location = opts.location || LOCATION;
  let tokens: Record<string, string> = opts.bar ? { phone_bar: opts.bar } : {};
  await installApp(page, { api: { ...API,
    '/site': { data: { site: SITE, identity, location } },
    '/settings': { data: { blocks: BLOCKS, section_meta: META } },
    '/dev/customization': { data: { theme_tokens: tokens, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  } });
  const writes: Write[] = [];
  let draws = 0;
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/dev/customization') { tokens = body.theme_tokens || {}; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...body, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => {
    draws++;
    const body = applyPhoneBar({ 'index.html': HTML }, tokens.phone_bar, { identity, locations: [location] })['index.html'] as string;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return { writes, draws: () => draws, tokens: () => tokens };
}
const frame = (page: Page) => page.frameLocator('#designPreview');
const panel = (page: Page) => page.locator('#settingsPanel');
async function openFooter(page: Page) {   // by the footer's own chip, the keyboard's way in, the same on every screen
  await frame(page).locator('footer.site .dc-hf-chip').focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toHaveAttribute('data-mode', 'footer');
}
const picked = (page: Page) => page.locator('#pbSeg button[aria-pressed="true"]');

test.describe('the phone bar, in the Footer card (builder item 122)', () => {
  test('Off, Light and Dark under "Phone bar · phones only", Off to start, saying what it does', async ({ page }) => {
    await mount(page);
    await openFooter(page);
    await expect(page.locator('#hfCard .ins-lbl').filter({ hasText: 'Phone bar' })).toHaveText('Phone bar · phones only');
    await expect(page.locator('#pbSeg button')).toHaveText(['Off', 'Light', 'Dark']);
    await expect(picked(page)).toHaveText('Off');
    await expect(page.locator('#pbSays')).toHaveText('Call, Directions, Hours and Email along the bottom of every page on a phone, from your business details.');
    await expect(page.locator('#pbSee')).toHaveCount(0);
    await expect(frame(page).locator('.dds-phonebar')).toHaveCount(0);
  });

  test('Dark saves as a style and the page is drawn again with the bar; Off takes the setting away', async ({ page }) => {
    const m = await mount(page);
    await openFooter(page);
    const before = m.draws();
    await page.locator('#pbSeg').getByRole('button', { name: 'Dark' }).click();
    await expect.poll(() => m.writes.filter((w) => w.path === '/dev/customization').at(-1)?.body?.theme_tokens).toEqual({ phone_bar: 'dark' });
    await expect.poll(() => m.draws()).toBeGreaterThan(before);
    await expect(frame(page).locator('nav.dds-phonebar')).toBeAttached();
    await expect(picked(page)).toHaveText('Dark');
    await expect(page.locator('#pbSays')).toHaveText('On a phone, every page with the footer shows Call, Directions, Hours and Email along the bottom.');
    await page.locator('#pbSeg').getByRole('button', { name: 'Off' }).click();
    await expect.poll(() => m.writes.filter((w) => w.path === '/dev/customization').at(-1)?.body?.theme_tokens).toEqual({});
    await expect(frame(page).locator('nav.dds-phonebar')).toHaveCount(0);
    await expect(picked(page)).toHaveText('Off');
  });

  test('it says what the business details are missing', async ({ page }) => {
    await mount(page, { bar: 'light', identity: { business_name: 'Marlow’s Kitchen', phone: '(555) 010-0100' }, location: { hours: WEEK } });
    await openFooter(page);
    await expect(picked(page)).toHaveText('Light');
    await expect(page.locator('#pbSays')).toHaveText('On a phone, every page with the footer shows Call and Hours along the bottom. Add an address and an email to your business details to show Directions and Email too.');
  });

  test('with nothing in the business details, it says what to add', async ({ page }) => {
    await mount(page, { bar: 'light', identity: { business_name: 'Marlow’s Kitchen' }, location: {} });
    await openFooter(page);
    await expect(page.locator('#pbSays')).toHaveText('Add a phone number, an address, opening hours or an email to your business details, and the bar can show them.');
  });

  test('on a computer, “See it on a phone” draws the page at a phone’s width with the bar at its foot', async ({ page }) => {
    test.skip(page.viewportSize()!.width <= 1180, 'the device switch is for a computer’s screen; a tablet or phone is already its own size');
    await mount(page, { bar: 'dark' });
    await openFooter(page);
    await expect(frame(page).locator('nav.dds-phonebar')).toBeHidden();   // a computer's width: not shown, as on the live site
    await page.locator('#pbSee').click();
    await expect.poll(() => page.locator('#designPreview').evaluate((n) => (n as HTMLIFrameElement).contentWindow!.innerWidth)).toBeLessThanOrEqual(390);
    await expect(frame(page).locator('nav.dds-phonebar')).toBeVisible();
    await expect(frame(page).locator('nav.dds-phonebar')).toHaveClass(/dc-hf-on/);   // the Footer card is open: it's marked with the footer
    const gap = await frame(page).locator('nav.dds-phonebar').evaluate((n) => Math.round(innerHeight - n.getBoundingClientRect().bottom));
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    await expect(page.locator('#pbSee')).toHaveCount(0);
  });

  test('a press on the bar on the canvas opens the Footer card and goes nowhere', async ({ page }) => {
    await mount(page, { bar: 'light' });
    if (page.viewportSize()!.width > 1180) {   // a computer: the page as a phone shows it
      await page.locator('#dpDevSeg [data-dpdev="phone"]').click();
      await expect.poll(() => page.locator('#designPreview').evaluate((n) => (n as HTMLIFrameElement).contentWindow!.innerWidth)).toBeLessThanOrEqual(390);
    }
    const bar = frame(page).locator('nav.dds-phonebar');
    if (!(await bar.isVisible())) test.skip(true, 'this screen draws the canvas wider than a phone, where the bar isn’t shown');
    const url = await page.locator('#designPreview').evaluate((n) => (n as HTMLIFrameElement).contentWindow!.location.href);
    // the editor's own bars never sit over it
    const call = (await bar.getByRole('link', { name: 'Call' }).boundingBox())!;
    const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.id || '', [call.x + call.width / 2, call.y + call.height / 2]);
    expect(on).toBe('designPreview');
    await bar.getByRole('link', { name: 'Call' }).click();
    await expect(panel(page)).toHaveAttribute('data-mode', 'footer');
    await expect(page.locator('#pbSeg')).toBeVisible();
    expect(await page.locator('#designPreview').evaluate((n) => (n as HTMLIFrameElement).contentWindow!.location.href)).toBe(url);
    await expect(frame(page).locator('#main')).toBeAttached();
  });
});

// ── a visitor's page ──
const LIVE = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--accent:#23635a}body{margin:0;font-family:system-ui}main{height:1600px;padding:24px}footer.site{background:#eee;padding:24px}</style></head><body>'
  + '<header class="site"><a href="/">Marlow’s Kitchen</a></header><main id="main"><p>Fresh bread</p></main><footer class="site"><p id="last">The last line</p></footer></body></html>';
async function visit(page: Page, mode: 'light' | 'dark', size: { width: number; height: number }) {
  const html = applyPhoneBar({ 'index.html': LIVE }, mode, DETAILS)['index.html'] as string;
  await page.route('**/zz-phonebar/', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.setViewportSize(size);
  await page.goto('/zz-phonebar/');
  return page.locator('nav.dds-phonebar');
}
test.describe('the phone bar on a visitor’s screen (builder item 122)', () => {
  test('on a phone: fixed along the bottom, Call to Email, the last line of the page clear of it', async ({ page }) => {
    const bar = await visit(page, 'light', { width: 390, height: 760 });
    await expect(bar).toBeVisible();
    await expect(bar.locator(':scope > a, :scope > details > summary')).toHaveText(['Call', 'Directions', 'Hours', 'Email']);
    await expect(bar.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:5550100100');
    await expect(bar.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:hello@marlows.example');
    await expect(bar.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('12 Olive Ave, Burbank, CA 91502'));
    const r = (await bar.boundingBox())!;
    expect(Math.round(r.y + r.height)).toBe(760);
    expect(r.width).toBe(390);
    expect(await bar.getByRole('link', { name: 'Call' }).locator('svg').evaluate((n) => getComputedStyle(n).stroke)).toBe('rgb(35, 99, 90)');   // the site's accent
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = (await page.locator('#last').boundingBox())!, top = (await bar.boundingBox())!.y;
    expect(last.y + last.height).toBeLessThanOrEqual(top);
  });

  test('Hours opens the week with today marked, and closes on a tap elsewhere or Escape', async ({ page }) => {
    const bar = await visit(page, 'dark', { width: 390, height: 760 });
    const tray = bar.locator('.dds-pb-tray');
    await expect(tray).toBeHidden();
    await bar.locator('summary').click();
    await expect(tray).toBeVisible();
    await expect(tray.locator('tr th')).toHaveText(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    await expect(tray.locator('tr[data-day="fri"] td')).toHaveText('9am–8pm');
    await expect(tray.locator('tr[data-day="sun"] td')).toHaveText('Closed');
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }).format(new Date()).slice(0, 3).toLowerCase();
    await expect(tray.locator('tr[data-today]')).toHaveAttribute('data-day', today);
    const t = (await tray.boundingBox())!, b = (await bar.boundingBox())!;
    expect(t.y + t.height).toBeLessThanOrEqual(b.y);   // above the bar
    await page.mouse.click(195, 200);
    await expect(tray).toBeHidden();
    await bar.locator('summary').click();
    await expect(tray).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tray).toBeHidden();
    await expect(bar.locator('summary')).toBeFocused();
    expect(await bar.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe('rgb(32, 27, 23)');   // dark
  });

  test('on a computer or a tablet held either way it isn’t there, nor any space for it', async ({ page }) => {
    for (const size of [{ width: 1280, height: 800 }, { width: 810, height: 1080 }]) {
      const bar = await visit(page, 'light', size);
      await expect(bar).toBeHidden();
      await expect(page.locator('.dds-pb-gap')).toBeHidden();
      await page.unroute('**/zz-phonebar/');
    }
  });
});
