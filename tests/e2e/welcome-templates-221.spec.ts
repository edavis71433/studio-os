import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { capabilitiesOf } from '../../supabase/functions/presence/lib/site_roles';

// Builder list item 221 (Nov 15 2026), drawn in Figma and agreed: on Send an update,
//   · the Welcome email card: the email each new person on the list gets right after
//     "Yes, add me", on from the start in standard words; the switch saves as it flips,
//     the words when Save is pressed, a test goes to you, the standard words come back;
//   · Templates: the studio's kept updates, to start an update for any client; Save as a
//     template from the message, Keep as a template from a sent update, rename, remove.
// Shapes follow routes/list_welcome.ts and agency/update_templates.ts. Fake names only.

const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const T1 = 'dddddddd-4444-4444-8444-dddddddddddd', T2 = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const toast = (page: Page) => page.locator('.dds-toast').last();
const narrow = (page: Page) => (page.viewportSize()?.width || 0) <= 760;
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};
const STD = { subject: 'Welcome to {{business_name}}', body: 'Hi {{first_name}},\n\nThanks for joining our list. You’ll hear from us now and then with news, offers and what’s new.\n\nReply to this email any time if you have a question.' };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const welcomeOf = (over: Record<string, unknown> = {}) => {
  const w: Record<string, unknown> = { enabled: true, subject: '', body: '', updated_by: null, updated_at: null, sent: 14, last_sent_at: daysAgo(3), standard: STD, subject_max: 200, body_max: 4000, reply_to: 'hello@marlow.example', ...over };
  w.words = { subject: (w.subject as string) || STD.subject, body: (w.body as string) || STD.body };
  return w;
};
const SCOPED = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' },
} };
const TEMPLATES = [
  { id: T1, name: 'Spring offer', subject: 'Spring offer at {{business_name}}', preview: 'Hi {{first_name}}, our spring menu starts this week…', from_site: CLIENT, from_name: 'Marlow’s Kitchen', created_by: 'sam@bright.example', created_at: '2026-11-12T10:00:00Z' },
  { id: T2, name: 'Holiday hours', subject: 'Our holiday hours', preview: 'Hi {{first_name}}, here’s when we’re open over the holidays.', from_site: 'other', from_name: 'Bright Smile Dental', created_by: 'sam@bright.example', created_at: '2026-11-03T10:00:00Z' },
];
const FULL: Record<string, Record<string, unknown>> = {
  [T1]: { ...TEMPLATES[0], body: 'Hi {{first_name}},\n\nOur spring menu starts this week.\n\n{{booking_link}}' },
  [T2]: { ...TEMPLATES[1], body: 'Hi {{first_name}},\n\nWe’re closed on the 25th and the 1st.' },
};

interface Opts { welcome?: (route: Route) => unknown; templates?: unknown; ctx?: unknown }
async function open(page: Page, o: Opts = {}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let welcome = welcomeOf();
  let list = JSON.parse(JSON.stringify(TEMPLATES));
  await installApp(page, { api: {
    '/portal/context': o.ctx || SCOPED,
    '/identity': { data: { site_id: CLIENT, business_name: 'Marlow’s Kitchen', booking_url: 'https://book.example/marlow' } },
    '/broadcasts/segments': { data: { segments: [{ key: 'subscribers', label: 'People who joined your list', description: 'Everyone who signed up with the “Join our list” box on your website.', count: 14 }, { key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 40 }] } },
    '/broadcasts': { data: { broadcasts: [{ id: SENT, subject: 'Spring menu is here', audience: 'subscribers', status: 'sent', scheduled_at: null, sent_at: '2026-11-10T10:00:00Z', recipient_count: 14, sent_count: 13, skipped_count: 1, failed_count: 0, created_at: '2026-11-10T09:00:00Z' }] } },
    ['/broadcasts/' + SENT]: { data: { broadcast: { id: SENT, site_id: CLIENT, subject: 'Spring menu is here', body: 'Hi {{first_name}},\n\nThe spring menu is here.\n\n![Patio](media:11111111-2222-4333-8444-555555555555)', audience: 'subscribers', status: 'sent', sent_at: '2026-11-10T10:00:00Z', sent_count: 13, skipped_count: 1, failed_count: 0 }, audience_label: 'People who joined your list', recipient_count: 14, suppressed_count: 1, preview_subject: 'Spring menu is here', preview_html: '<p>Hi there, the spring menu is here.</p>' } },
  } as never });
  await page.route('**/functions/v1/presence/broadcasts/welcome**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/presence/, '');
    const body = req.method() === 'GET' ? null : req.postDataJSON();
    calls.push({ method: req.method(), path, body });
    if (o.welcome && req.method() === 'GET') return o.welcome(route);
    if (path === '/broadcasts/welcome/test') return json(route, { data: { sent_to: 'eric@studio.example' } });
    if (req.method() === 'PUT') {
      const b = body as Record<string, unknown>;
      const by = { updated_by: 'eric@studio.example', updated_at: new Date().toISOString() };
      if (typeof b.enabled === 'boolean') welcome = welcomeOf({ ...welcome, enabled: b.enabled, ...by });
      if (b.standard) welcome = welcomeOf({ ...welcome, subject: '', body: '', ...by });
      if (typeof b.subject === 'string') welcome = welcomeOf({ ...welcome, subject: b.subject === STD.subject ? '' : b.subject, body: b.body === STD.body ? '' : b.body, ...by });
      return json(route, { data: welcome });
    }
    return json(route, { data: welcome });
  });
  await page.route('**/functions/v1/presence/agency/update-templates**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/presence/, '');
    const body = req.method() === 'GET' || req.method() === 'DELETE' ? null : req.postDataJSON();
    calls.push({ method: req.method(), path, body });
    if (o.templates !== undefined && req.method() === 'GET' && path === '/agency/update-templates') return typeof o.templates === 'function' ? (o.templates as (r: Route) => unknown)(route) : json(route, o.templates);
    const id = path.split('/')[3];
    if (req.method() === 'GET' && !id) return json(route, { data: list, available: true, can_manage: true, max: 50 });
    if (req.method() === 'GET') return json(route, { data: FULL[id] });
    if (req.method() === 'POST') {
      const b = body as Record<string, string>;
      const t = { id: 'ffffffff-6666-4666-8666-ffffffffffff', name: b.name, subject: b.subject, preview: 'Hi {{first_name}}, …', from_site: b.site_id, from_name: 'Marlow’s Kitchen', created_by: 'eric@studio.example', created_at: new Date().toISOString() };
      list = [t, ...list];
      return json(route, { data: t, photos_left: /media:/.test(b.body) ? 1 : 0 }, 201);
    }
    if (req.method() === 'PATCH') { const t = list.find((x: { id: string }) => x.id === id); t.name = (body as { name: string }).name; return json(route, { data: t }); }
    if (req.method() === 'DELETE') { list = list.filter((x: { id: string }) => x.id !== id); return json(route, { data: { ok: true } }); }
    return json(route, {}, 405);
  });
  await page.goto(`/broadcasts.html?client=${CLIENT}`);
  await expect(page.locator('#subj')).toBeVisible();
  return calls;
}
const card = (page: Page) => page.locator('#welcome');

test.describe('Send an update › the welcome email (item 221)', () => {
  test('on from the start: how many went, who replies reach, the standard words, and what they get', async ({ page }) => {
    await open(page);
    const c = card(page);
    await expect(c.getByRole('heading', { name: 'Welcome email' })).toBeVisible();
    await expect(c.getByRole('switch', { name: 'Send the welcome email' })).toHaveAttribute('aria-checked', 'true');
    await expect(c.locator('#welSo')).toHaveText('Sent to 14 people so far · the last one 3 days ago');
    await expect(c).toContainText('It comes from Marlow’s Kitchen, and their replies go to hello@marlow.example.');
    await expect(c.locator('#welSubj')).toHaveValue(STD.subject);
    await expect(c.locator('#welBody')).toHaveValue(STD.body);
    await expect(c.getByRole('button', { name: 'Use the standard words' })).toHaveCount(0);   // they already are
    await expect(c).toContainText('Standard words until someone changes them.');
    if (narrow(page)) {
      await expect(c.locator('#welPv')).toBeHidden();   // a phone keeps the preview behind a tap
      await c.getByRole('button', { name: /See what they get/ }).click();
    }
    const pv = c.locator('#welPv');
    await expect(pv.locator('.mail-subj')).toHaveText('Welcome to Marlow’s Kitchen');
    await expect(pv).toContainText('Hi there,');
    await expect(pv).toContainText('Don’t want these emails? Unsubscribe');
    await noSideScroll(page);
  });

  test('the switch saves as it flips and says so; the words wait while it is off', async ({ page }) => {
    const calls = await open(page);
    const c = card(page);
    await c.getByRole('switch', { name: 'Send the welcome email' }).click();
    await expect(toast(page)).toContainText('Off. New people on your list get no welcome email.');
    await expect(c.getByRole('switch', { name: 'Send the welcome email' })).toHaveAttribute('aria-checked', 'false');
    await expect(c.locator('#welSo')).toHaveText('Off. People who join your list get no welcome email. The words below wait here until you switch it on.');
    await expect(c.locator('#welBody')).toHaveValue(STD.body);
    expect(calls.filter((x) => x.method === 'PUT')).toEqual([{ method: 'PUT', path: '/broadcasts/welcome', body: { enabled: false } }]);
    await c.getByRole('switch', { name: 'Send the welcome email' }).click();
    await expect(toast(page)).toContainText('On. Each new person on your list gets it.');
  });

  test('new words: the preview follows as you type, Save keeps them, and the standard words can come back', async ({ page }) => {
    const calls = await open(page);
    const c = card(page);
    if (narrow(page)) await c.getByRole('button', { name: /See what they get/ }).click();
    await c.locator('#welSubj').fill('Hello from {{business_name}}');
    await c.locator('#welBody').fill('Hi {{first_name}},\n\nThanks for joining. Here’s 10% off your first visit.');
    await expect(c.locator('#welPv .mail-subj')).toHaveText('Hello from Marlow’s Kitchen');
    await expect(c.locator('#welPv')).toContainText('Here’s 10% off your first visit.');
    await c.getByRole('switch', { name: 'Send the welcome email' }).click();   // flipping the switch keeps words still being written
    await expect(c.getByRole('switch', { name: 'Send the welcome email' })).toHaveAttribute('aria-checked', 'false');
    await expect(c.locator('#welSubj')).toHaveValue('Hello from {{business_name}}');
    await c.getByRole('switch', { name: 'Send the welcome email' }).click();
    await expect(c.getByRole('switch', { name: 'Send the welcome email' })).toHaveAttribute('aria-checked', 'true');
    await c.getByRole('button', { name: 'Save the words' }).click();
    await expect(toast(page)).toContainText('Saved. The next person who joins gets these words.');
    expect(calls.filter((x) => x.method === 'PUT').pop()).toEqual({ method: 'PUT', path: '/broadcasts/welcome', body: { subject: 'Hello from {{business_name}}', body: 'Hi {{first_name}},\n\nThanks for joining. Here’s 10% off your first visit.' } });
    await expect(c).toContainText(/Saved .* by eric@studio\.example\./);
    await c.getByRole('button', { name: 'Use the standard words' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Use the standard words' }).click();
    await expect(toast(page)).toContainText('The standard words are back.');
    expect(calls.filter((x) => x.method === 'PUT').pop()).toEqual({ method: 'PUT', path: '/broadcasts/welcome', body: { standard: true } });
    await expect(c.locator('#welSubj')).toHaveValue(STD.subject);
    await expect(c.getByRole('button', { name: 'Use the standard words' })).toHaveCount(0);
  });

  test('Send me a test sends the words on the card, saved or not, to you only', async ({ page }) => {
    const calls = await open(page);
    const c = card(page);
    await c.locator('#welSubj').fill('Draft subject');
    await c.getByRole('button', { name: 'Send me a test' }).click();
    await expect(toast(page)).toContainText('A test went to eric@studio.example, marked [Test], with the words as they are now.');
    expect(calls.filter((x) => x.path === '/broadcasts/welcome/test')).toEqual([{ method: 'POST', path: '/broadcasts/welcome/test', body: { subject: 'Draft subject', body: STD.body } }]);
  });

  test('+ First name goes in where the cursor is; + Booking link adds the Book a time button on a line of its own', async ({ page }) => {
    await open(page);
    const c = card(page);
    const body = c.locator('#welBody');
    await body.fill('Hi ,');
    await body.evaluate((t: HTMLTextAreaElement) => { t.focus(); t.setSelectionRange(3, 3); });
    await c.getByRole('button', { name: '+ First name' }).click();
    await expect(body).toHaveValue('Hi {{first_name}},');
    await c.getByRole('button', { name: '+ Booking link' }).click();
    await expect(body).toHaveValue('Hi {{first_name}},\n{{booking_link}}');
    if (narrow(page)) await c.getByRole('button', { name: /See what they get/ }).click();
    await expect(c.locator('#welPv .mail-cta')).toHaveText('Book a time');
  });

  test('an older server shows no card; a failed read says so, and Try again brings it', async ({ page }) => {
    await open(page, { welcome: (route) => json(route, { error: 'not_found' }, 404) });
    await expect(page.locator('#welcome')).toHaveCount(0);
    let fail = true;
    await page.goto('about:blank');
    await open(page, { welcome: (route) => fail ? json(route, { error: 'boom' }, 500) : json(route, { data: welcomeOf() }) });
    await expect(card(page)).toContainText('Your welcome email couldn’t load just now.');
    fail = false;
    await card(page).getByRole('button', { name: 'Try again' }).click();
    await expect(card(page).getByRole('switch', { name: 'Send the welcome email' })).toBeVisible();
  });

  test('a team member who can’t change settings doesn’t see the card', async ({ page }) => {
    const staff = { data: { ...SCOPED.data, site_role: 'business_staff', is_agency: false, scope: null, capabilities: capabilitiesOf('business_staff') } };
    await open(page, { ctx: staff, templates: (route: Route) => json(route, { error: 'forbidden', message: 'This account isn’t part of an agency.' }, 403) });
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-dds-lacks') || '')).toContain('configure');
    await expect(page.locator('#welcome')).toBeHidden();
  });
});

test.describe('Send an update › templates (item 221)', () => {
  test('Templates lists the studio’s; Use asks before replacing written words, then brings the words in', async ({ page }) => {
    const calls = await open(page);
    await page.locator('#subj').fill('Something I started');
    await page.getByRole('button', { name: /^Templates/ }).click();
    const d = page.getByRole('dialog', { name: 'Start from a template' });
    await expect(d).toContainText('Pick one and its words come in here, for Marlow’s Kitchen.');
    await expect(d.locator('.tpl')).toHaveCount(2);
    await expect(d).toContainText('From Bright Smile Dental · kept Nov 3');
    await d.getByRole('button', { name: 'Use Holiday hours' }).click();
    const ask = page.getByRole('dialog').filter({ hasText: 'Replace what you wrote?' });
    await expect(ask).toContainText('“Holiday hours” comes in. Who it goes to stays as it is.');
    await ask.getByRole('button', { name: 'Use the template' }).click();
    await expect(page.locator('#subj')).toHaveValue('Our holiday hours');
    await expect(page.locator('#bodytx')).toHaveValue('Hi [First name],\n\nWe’re closed on the 25th and the 1st.');   // sales item 208: the code reads as its words in the box
    await expect(page.locator('.frompost')).toContainText('Started from your template “Holiday hours”.');
    await expect(toast(page)).toContainText('“Holiday hours” is in.');
    expect(calls.some((x) => x.method === 'GET' && x.path === `/agency/update-templates/${T2}`)).toBe(true);
    await noSideScroll(page);
  });

  test('Save as a template keeps the subject and the words, named from the subject; a photo stays behind', async ({ page }) => {
    const calls = await open(page);
    await page.locator('#subj').fill('Patio season');
    await page.locator('#bodytx').fill('Hi {{first_name}},\n\n![Patio](media:11111111-2222-4333-8444-555555555555)\n\nThe patio is open.');
    await page.getByRole('button', { name: 'Save as a template' }).click();
    const d = page.getByRole('dialog', { name: 'Keep this as a template' });
    await expect(d.getByLabel('Name')).toHaveValue('Patio season');
    await expect(d).toContainText('The photo stays with Marlow’s Kitchen.');
    await d.getByLabel('Name').fill('Patio opening');
    await d.getByRole('button', { name: 'Keep template' }).click();
    await expect(toast(page)).toContainText('Kept as “Patio opening”. Its photo stays with Marlow’s Kitchen.');
    expect(calls.filter((x) => x.method === 'POST')).toEqual([{ method: 'POST', path: '/agency/update-templates', body: { site_id: CLIENT, name: 'Patio opening', subject: 'Patio season', body: 'Hi {{first_name}},\n\n![Patio](media:11111111-2222-4333-8444-555555555555)\n\nThe patio is open.' } }]);
    await expect(page.getByRole('button', { name: /^Templates/ }).locator('.n')).toHaveText('3');
  });

  test('a sent update can be kept as a template from Recent updates', async ({ page }) => {
    const calls = await open(page);
    await page.getByRole('button', { name: /Spring menu is here/ }).click();
    await page.locator(`#d-${SENT}`).getByRole('button', { name: 'Keep as a template' }).click();
    const d = page.getByRole('dialog', { name: 'Keep this as a template' });
    await d.getByRole('button', { name: 'Keep template' }).click();
    await expect(toast(page)).toContainText('Kept as “Spring menu is here”.');
    expect((calls.find((x) => x.method === 'POST')?.body as Record<string, string>).subject).toBe('Spring menu is here');
  });

  test('Rename and Remove from a template’s ••• menu', async ({ page }) => {
    const calls = await open(page);
    await page.getByRole('button', { name: /^Templates/ }).click();
    const d = page.getByRole('dialog', { name: 'Start from a template' });
    await d.getByLabel('More for Spring offer').click();
    await d.getByRole('button', { name: 'Rename' }).click();
    const ask = page.getByRole('dialog').filter({ hasText: 'Rename this template' });
    await ask.getByRole('textbox').fill('Spring offer, patio');
    await ask.getByRole('button', { name: 'Rename' }).click();
    await expect(d.locator('.tpl .tn').first()).toHaveText('Spring offer, patio');
    await d.getByLabel('More for Holiday hours').click();
    await d.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Remove this template?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(d.locator('.tpl')).toHaveCount(1);
    await expect(toast(page)).toContainText('Removed.');
    expect(calls.filter((x) => x.method === 'PATCH' || x.method === 'DELETE').map((x) => `${x.method} ${x.path}`)).toEqual([`PATCH /agency/update-templates/${T1}`, `DELETE /agency/update-templates/${T2}`]);
  });

  test('none yet says how to keep one; a business owner who isn’t a studio sees no templates', async ({ page }) => {
    await open(page, { templates: { data: [], available: true, can_manage: true } });
    await page.getByRole('button', { name: /^Templates/ }).click();
    await expect(page.getByRole('dialog', { name: 'Start from a template' })).toContainText('No templates yet');
    await page.goto('about:blank');
    await open(page, { templates: (route: Route) => json(route, { error: 'forbidden', message: 'This account isn’t part of an agency.' }, 403) });
    await expect(page.getByRole('button', { name: /^Templates/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save as a template' })).toHaveCount(0);
    await expect(card(page)).toBeVisible();   // the welcome card is the owner's too
  });

  test('before the database step there are no templates to show', async ({ page }) => {
    await open(page, { templates: { data: [], available: false, can_manage: true } });
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Templates/ })).toHaveCount(0);
  });

  test('accessibility: the welcome card and the templates sheet pass axe', async ({ page }) => {
    test.slow();   // two full scans; WebKit on a busy machine needs the room
    await open(page);
    await expect(card(page).getByRole('switch', { name: 'Send the welcome email' })).toBeVisible();
    const a = await new AxeBuilder({ page }).include('#welcome').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(a.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    await page.getByRole('button', { name: /^Templates/ }).click();
    await expect(page.locator('#tplDlg')).toBeVisible();
    const b = await new AxeBuilder({ page }).include('#tplDlg').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(b.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    await noSideScroll(page);
    await page.getByRole('dialog', { name: 'Start from a template' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('#tplDlg')).toBeHidden();
  });
});
