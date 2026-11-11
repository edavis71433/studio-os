import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { popupTags, POPUP_STYLE, POPUP_CLOSE, FORM_LINK_SCRIPT, senderTag, signupForm, type PopupSettings } from '../../supabase/functions/presence/lib/site_send';

// Builder list item 148: one calm pop-up per site, with timing rules, driven through the
// very script a publish puts on the page; and a form that opens from a button (#form-<id>).
const SITE = 'https://shop.example';
const FN = 'https://db.example.supabase.co/functions/v1/presence';
const SID = '5e000000-0000-4000-8000-000000000001';
const EP = `${FN}/forms/${SID}/submit`;
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const BASE: PopupSettings = { on: true, heading: '10% off your first visit', text: 'Join our list and we’ll send the code.', action: 'signup', buttons: [], after: 'seconds', seconds: 8, scroll: 50, pages: 'all', picked: [], again: 'week', phones: true, from: '', until: '' };
const QUOTE = `<dialog id="form-quote" class="ps-pop ps-pop-form" aria-labelledby="form-quote-h"><div class="ps-pop-in">${POPUP_CLOSE}<h2 id="form-quote-h">Request a quote</h2>
<form id="presence-form-quote" class="card presence-form" method="post" action="${EP}" novalidate><input type="hidden" name="form_id" value="quote"><input type="hidden" name="form_kind" value="quote">
<div class="ff" data-field="name"><p><label for="f-quote-name">Your name</label><input type="text" id="f-quote-name" name="name" required></p></div><button class="btn" type="submit">Request a quote</button></form></div></dialog>`;
const page_ = (p: PopupSettings, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home</title></head>
<body data-reach-tel="(555) 123-4567"><main id="main"><h1>Home</h1><p style="height:3000px">A long page.</p>${extra}</main>${POPUP_STYLE}${popupTags(p, EP)}${QUOTE}${FORM_LINK_SCRIPT}${senderTag(EP)}</body></html>`;

async function openSite(page: Page, p: PopupSettings, extra = '') {
  await page.route(`${FN}/forms/${SID}/ticket`, (route) => answer(route, 200, { data: { ticket: `1800000000.${'a'.repeat(32)}`, wait_s: 3 } }));
  await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: page_(p, extra) }));
  await page.goto(`${SITE}/`);
}
const pop = (page: Page) => page.getByRole('dialog', { name: '10% off your first visit' });

test.describe('the pop-up on a client’s page', () => {
  test('it waits its seconds, closes with Escape, and stays away for the week it was set to', async ({ page }) => {
    await page.clock.install();
    await openSite(page, BASE);
    await page.clock.runFor(5000);   // the page's clock also runs in real time: keep well short of 8 seconds
    await expect(pop(page)).toBeHidden();
    await page.clock.runFor(3500);
    await expect(pop(page)).toBeVisible();
    await expect(pop(page)).toContainText('Join our list and we’ll send the code.');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#ps-pop'))).toBe(true);   // focus moved into it
    await page.keyboard.press('Escape');
    await expect(pop(page)).toBeHidden();
    await page.reload();
    await page.clock.runFor(20_000);
    await expect(pop(page)).toBeHidden();                          // closed: not again this week
    await page.clock.fastForward(8 * 86400_000);
    await page.reload();
    await page.clock.runFor(9000);
    await expect(pop(page)).toBeVisible();                         // a week later it may show again
  });

  test('“once they’ve scrolled”: it shows part-way down the page, not before', async ({ page }) => {
    await openSite(page, { ...BASE, after: 'scroll', scroll: 50 });
    await page.evaluate(() => window.scrollTo(0, 300));   // phones have no mouse wheel
    await page.waitForTimeout(300);
    await expect(pop(page)).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.7));
    await expect(pop(page)).toBeVisible();
  });

  test('joining the list in it says so there, and it never shows again', async ({ page }) => {
    await page.clock.install();
    await page.route(EP, (route) => answer(route, 200, { data: { ok: true, message: 'You’re on the list. Thank you!' } }));
    await openSite(page, BASE);
    await page.clock.runFor(8500);
    const dlg = pop(page);
    await dlg.getByLabel('Your email').fill('sam@customer.example');
    await dlg.getByLabel('Yes, send me updates by email. I can unsubscribe at any time.').check();
    await dlg.getByRole('button', { name: 'Sign up' }).click();
    await page.clock.runFor(4000);
    await expect(dlg.getByRole('status')).toHaveText('You’re on the list. Thank you!');
    await dlg.getByRole('button', { name: 'Close' }).click();
    await page.clock.setSystemTime(new Date(Date.now() + 40 * 86400_000));   // a jump this long overflows fastForward
    await page.reload();
    await page.clock.runFor(9000);
    await expect(pop(page)).toBeHidden();
  });

  test('joining from the page’s own Newsletter box also keeps it away', async ({ page }) => {
    await page.clock.install();
    await page.route(EP, (route) => answer(route, 200, { data: { ok: true, message: 'You’re on the list. Thank you!' } }));
    await openSite(page, { ...BASE, seconds: 30 }, `<section class="block-newsletter"><h2>Stay in the loop</h2>${signupForm('nl-1', EP, 'Join')}</section>`);
    const box = page.locator('.block-newsletter');
    await box.getByLabel('Your email').fill('sam@customer.example');
    await box.getByLabel('Yes, send me updates by email. I can unsubscribe at any time.').check();
    await box.getByRole('button', { name: 'Join' }).click();
    await page.clock.runFor(4000);
    await expect(box.getByRole('status')).toHaveText('You’re on the list. Thank you!');
    await page.reload();
    await page.clock.runFor(31_000);
    await expect(pop(page)).toBeHidden();
  });

  test('outside its dates it doesn’t show; with phones switched off it shows only on bigger screens', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-10T12:00:00') });
    await openSite(page, { ...BASE, until: '2026-11-09' });
    await page.clock.runFor(9000);
    await expect(pop(page)).toBeHidden();
    await page.unroute(`${SITE}/**`);
    await openSite(page, { ...BASE, from: '2026-11-10', until: '2026-11-30', phones: false });
    await page.clock.runFor(9000);
    if (page.viewportSize()!.width <= 640) await expect(pop(page)).toBeHidden();
    else await expect(pop(page)).toBeVisible();
  });

  test('its button can open a form over the page, and the backdrop closes it', async ({ page }) => {
    await page.clock.install();
    await openSite(page, { ...BASE, action: 'buttons', buttons: [{ label: 'Get a quote', url: '#form-quote' }] });
    await page.clock.runFor(8500);
    await pop(page).getByRole('link', { name: 'Get a quote' }).click();
    await expect(pop(page)).toBeHidden();
    const form = page.getByRole('dialog', { name: 'Request a quote' });
    await expect(form).toBeVisible();
    await expect(form.getByLabel('Your name')).toBeVisible();
    await page.mouse.click(5, 5);                                   // the backdrop
    await expect(form).toBeHidden();
    await page.reload();
    await page.clock.runFor(9000);
    await expect(pop(page)).toBeHidden();                           // a button used counts as seen
  });
});

// The editor: the pop-up's card under the announcement bar's (the Updates view)
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
test.describe('the pop-up’s card in the editor', () => {
  test('off until switched on; on, it asks for what it still needs and saves each change', async ({ page }) => {
    let settings: Record<string, unknown> = { blocks: [], section_meta: { blocks: [], pages: {} }, pages: [{ slug: 'our-work', title: 'Our work', blocks: [] }], popup: null };
    await installApp(page, { api: { ...API, '/settings': { data: settings } } });
    const puts: any[] = [];
    await page.route('**/functions/v1/presence/settings', (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON(); puts.push(body); settings = { ...settings, ...body };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) });
    });
    await page.goto('/presence.html#updates');
    const card = page.locator('#popCard');
    await expect(card).toBeVisible();
    await expect(card.getByLabel('Show a pop-up on your website')).not.toBeChecked();
    await expect(card.locator('#pop-body')).toBeHidden();
    await card.getByLabel('Show a pop-up on your website').check();
    await expect(card.locator('#pop-body')).toBeVisible();
    await expect(card.locator('#pop-say')).toHaveText('Add a heading and it can show.');
    await card.getByLabel('Heading').fill('10% off your first visit');
    await card.getByLabel('Heading').blur();
    await expect(card.locator('#pop-say')).toHaveText('');
    await card.getByLabel('Where').selectOption('pick');
    await expect(card.locator('#pop-say')).toHaveText('Pick at least one page, or it shows on every page.');
    await card.getByLabel('Our work').check();
    await expect.poll(() => puts.length).toBeGreaterThan(2);
    expect(puts[puts.length - 1].popup).toMatchObject({ on: true, heading: '10% off your first visit', action: 'signup', after: 'seconds', seconds: 8, pages: 'pick', picked: ['page:our-work'], again: 'week', phones: true });
  });
});
