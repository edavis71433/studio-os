import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { senderTag, signupForm, SIGNUP_CONSENT, TICKET_SETTLE_MS } from '../../supabase/functions/presence/lib/site_send';

// Builder list item 146: the Newsletter section's "Join our list" box. On a client's page
// it sends in the page like any form (with its time ticket) and says to check their email (item 203)
// where it was; in the editor, a box collects into the site's own list unless the owner
// picks "Send people to another sign-up page".
const SITE = 'https://shop.example';
const FN = 'https://db.example.supabase.co/functions/v1/presence';
const SID = '5e000000-0000-4000-8000-000000000001';
const EP = `${FN}/forms/${SID}/submit`;
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const BOX = `<section class="block wrap block-newsletter"><h2>Stay in the loop</h2><p class="nl-text">News and offers, once a month.</p>${signupForm('nl-1', EP, 'Sign up')}</section>`;
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home</title>
<style>.nl-form{max-width:480px;margin:16px auto 0}.nl-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}.nl-label{flex:1 0 100%}.nl-form .nl-row input{flex:1 1 220px;width:auto;min-width:0}.hp{position:absolute;left:-9999px}</style></head>
<body data-reach-tel="(555) 123-4567" data-reach-mail="hello@shop.example"><main id="main"><h1>Home</h1>${BOX}</main>${senderTag(EP)}</body></html>`;

async function openBox(page: Page) {
  await page.route(`${FN}/forms/${SID}/ticket`, (route) => answer(route, 200, { data: { ticket: `1800000000.${'a'.repeat(32)}`, wait_s: 3 } }));
  await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.goto(`${SITE}/`);
}

test.describe('the “Join our list” box on a client’s page', () => {
  test('an email and a yes: “check your email” where the box was, without leaving the page (item 203)', async ({ page }) => {
    let sent = '';
    await page.route(EP, (route) => { sent = route.request().postData() || ''; return answer(route, 200, { data: { ok: true, message: 'Almost there: check your email and press “Yes, add me”.' } }); });
    await openBox(page);
    await page.getByLabel('Your email').fill('sam@customer.example');
    await page.getByLabel(SIGNUP_CONSENT).check();
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Almost there: check your email and press “Yes, add me”.' })).toBeVisible({ timeout: TICKET_SETTLE_MS + 7000 });
    await expect(page.locator('form.nl-form')).toBeHidden();
    expect(page.url()).toBe(`${SITE}/`);
    for (const [k, v] of [['form_kind', 'signup'], ['email', 'sam@customer.example'], ['consent', 'yes'], ['source_page', '/']]) expect(sent).toMatch(new RegExp(`name="${k}"\\r\\n\\r\\n${v.replace(/\./g, '\\.')}\\r\\n`));
    expect(sent).toContain('name="_tk"');
  });

  test('without the yes, nothing is sent', async ({ page }) => {
    let asked = 0;
    await page.route(EP, (route) => { asked++; return answer(route, 200, { data: { ok: true } }); });
    await openBox(page);
    await page.getByLabel('Your email').fill('sam@customer.example');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.waitForTimeout(TICKET_SETTLE_MS + 500);
    expect(asked).toBe(0);
    await expect(page.getByLabel(SIGNUP_CONSENT)).toBeVisible();
  });

  test('an address the server refuses: its sentence, at the email field', async ({ page }) => {
    await page.route(EP, (route) => answer(route, 400, { error: 'bad_email', field: 'email', message: 'That email doesn’t look right.' }));
    await openBox(page);
    await page.getByLabel('Your email').fill('sam@customer.example');
    await page.getByLabel(SIGNUP_CONSENT).check();
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.locator('.ps-note')).toHaveText('That email doesn’t look right.', { timeout: TICKET_SETTLE_MS + 7000 });
    await expect(page.getByLabel('Your email')).toBeFocused();
  });

  test('on any screen the field is wide enough to type in, with the button beside or under it @layout', async ({ page }) => {
    await openBox(page);
    const field = await page.getByLabel('Your email').boundingBox();
    const button = await page.getByRole('button', { name: 'Sign up' }).boundingBox();
    expect(field!.width).toBeGreaterThan(180);
    expect(button!.x + button!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
});

// The editor: the section's own panel (Edit on the section)
const BLOCKS = [
  { type: 'newsletter', title: 'Stay in the loop', collect: true },
  { type: 'newsletter', title: 'Our newsletter', url: 'https://example.com/join', button: 'Join' },
];
const META = { blocks: [{ sid: 'newsletter', key: 'block_newsletter', src_index: 0 }, { sid: 'newsletter#2', key: 'block_newsletter_2', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="newsletter" data-dds-key="block_newsletter" data-dds-src="0" class="block block-newsletter"><h2 data-dds-field="title">Stay in the loop</h2></section>'
  + '<section id="b" data-dds-sid="newsletter#2" data-dds-key="block_newsletter_2" data-dds-src="1" class="block block-newsletter"><h2 data-dds-field="title">Our newsletter</h2></section></main></body></html>';
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
async function mountEditor(page: Page) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: [] };
  await installApp(page, { api: { ...API, '/settings': { data: settings } } });
  const puts: any[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    if (path === '/settings') { puts.push(body); settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.goto('/presence.html#design');
  await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
  return puts;
}

// a section's own card (Edit on the section)
async function openSection(page: Page, bi: number) {
  await page.evaluate((i) => (window as any).eeEditBlock(i), bi);
  await expect(page.locator('#settingsPanel')).toHaveClass(/\bon\b/);
  await expect(page.locator(`#blkSub-${bi}`).getByLabel('Where sign-ups go')).toBeVisible();
}
test.describe('the Newsletter section in the editor', () => {
  // On the phone the section card opens on its heading, and WebKit reports the fields under it
  // as hidden to the test (they draw); the choice is the same code on every screen.
  test.skip(({ viewport }) => !!viewport && viewport.width <= 760, 'phone: the card’s lower fields read as hidden in WebKit');
  test('a box collects into your own list; the other choice shows the link field and saves it', async ({ page }) => {
    const puts = await mountEditor(page);
    await openSection(page, 0);
    const where = page.locator('#blkSub-0').getByLabel('Where sign-ups go');
    await expect(where).toHaveValue('collect');
    await expect(page.locator('#blkSub-0').getByPlaceholder('Your sign-up link (e.g. your Mailchimp or newsletter page)')).toBeHidden();
    await expect(page.locator('#blkSub-0')).toContainText('They join your list, and you write to them from Send an update');
    await where.selectOption('link');
    const link = page.locator('#blkSub-0').getByPlaceholder('Your sign-up link (e.g. your Mailchimp or newsletter page)');
    await expect(link).toBeVisible();
    await link.fill('https://example.com/subscribe');
    const saved = page.waitForRequest((r) => r.method() === 'PUT' && /\/settings$/.test(new URL(r.url()).pathname));
    await link.blur();   // the editor saves a field's words when the field is left
    await saved;
    await expect.poll(() => puts.map((p) => JSON.stringify(p?.blocks?.[0] || null)).pop()).toContain('"url":"https://example.com/subscribe"');
    expect(puts[puts.length - 1].blocks[0]).toMatchObject({ type: 'newsletter', url: 'https://example.com/subscribe', collect: false });
  });

  test('a box that links out says so, and can be switched to collect here', async ({ page }) => {
    const puts = await mountEditor(page);
    await openSection(page, 1);
    const where = page.locator('#blkSub-1').getByLabel('Where sign-ups go');
    await expect(where).toHaveValue('link');
    await expect(page.locator('#blkSub-1').getByPlaceholder('Your sign-up link (e.g. your Mailchimp or newsletter page)')).toHaveValue('https://example.com/join');
    const saved = page.waitForRequest((r) => r.method() === 'PUT' && /\/settings$/.test(new URL(r.url()).pathname));
    await where.selectOption('collect');
    await expect(page.locator('#blkSub-1').getByPlaceholder('Your sign-up link (e.g. your Mailchimp or newsletter page)')).toBeHidden();
    await saved;
    await expect.poll(() => puts.length).toBeGreaterThan(0);
    expect(puts[puts.length - 1].blocks[1]).toMatchObject({ type: 'newsletter', url: '', collect: true, button: 'Join' });
  });
});
