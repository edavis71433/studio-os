import { test, expect, devices, Page, Route } from '@playwright/test';
import { installApp, ALL_FEATURES } from './helpers/app';

// ── Deep pass, Part 7.11 (list item 111): the thin spots in the Nov 8 work, a test each ──
// The Welcome panel when its status read fails, and a live site taken offline from it; a
// first tap on another section's words, and the formatting toolbar used by touch while the
// words are being edited; a review-day count the switch can't use. Each feature's other
// tests are in site-home.spec.ts and settings.spec.ts; the mount below is a small copy of
// site-home's, so this file doesn't reach into that one.
const BLOCKS = [
  { type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' },
  { type: 'richtext', title: 'Our story', body: 'Fresh bread daily' },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] },
  '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] }, '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'] } },
};
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main">'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section>'
  + '<section id="b" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1" class="block"><h2 data-dds-field="title">Our story</h2>'
  + '<div class="prose" data-dds-field="body" data-dds-md="1"><p>Fresh bread daily</p></div></section>'
  + '</main><footer id="ft" style="padding:40px">Footer</footer></body></html>';
type Write = { method: string; path: string; body: any };
async function mount(page: Page, url: string, api: Record<string, unknown> = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: [] };
  await installApp(page, { api: { ...API, ...api, '/settings': { data: settings } } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
  await page.goto(url);
  return writes;
}

test.describe('the Welcome panel’s status', () => {
  const SHOWN = { '/commerce/first-run': { data: { dismissed: false } } };
  const LIVE = { '/site': { data: { site: { ...SITE, custom_domain: 'marlows.example', last_published_at: '2026-10-30T15:00:00Z' }, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } } };
  const status = (offline: string | null) => ({ draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-10-30T15:00:00Z', offline_since: offline } });

  test('when its status read fails, it shows what it knows, and asks again the next time it opens', async ({ page }) => {
    await mount(page, '/presence.html', { ...SHOWN, ...LIVE });
    let asked = 0;
    await page.route('**/functions/v1/presence/preview/status', (r) => { asked++; return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed', message: 'We couldn’t load that just now.' }) }); });
    await page.locator('#ssTodo').click();
    await expect.poll(() => asked).toBe(1);
    await expect(page.locator('#siteStatusBadge')).toHaveText('Public');   // the site's own last publish says so
    await expect(page.locator('#siteStatusCard a')).toHaveText('marlows.example');
    await expect(page.locator('#siteStatusBtn')).toHaveText('Take offline…');
    await page.locator('#btnTodoClose').click();
    await page.locator('#ssTodo').click();
    await expect.poll(() => asked).toBe(2);   // a failed read isn't kept as the answer
    await expect(page.locator('#siteStatusBadge')).toHaveText('Public');
  });

  test('a live site taken offline from it: the question says what happens, and the panel follows', async ({ page }) => {
    await mount(page, '/presence.html', { ...SHOWN, ...LIVE });
    let off: string | null = null, sent = 0;
    await page.route('**/functions/v1/presence/preview/status', (r) => r.fulfill({ json: { data: status(off) } }));
    await page.route('**/functions/v1/presence/site/offline', (r) => { sent++; off = '2026-11-08T12:00:00Z'; return r.fulfill({ json: { data: { ok: true } } }); });
    await page.locator('#ssTodo').click();
    await expect(page.locator('#siteStatusBadge')).toHaveText('Public');
    let question = '';
    page.once('dialog', (d) => { question = d.message(); return d.accept(); });
    await page.locator('#siteStatusBtn').click();
    await expect.poll(() => sent).toBe(1);
    expect(question).toContain('Take Marlow’s Kitchen OFFLINE now?');
    expect(question).toContain('Visitors immediately stop seeing your website.');
    expect(question).toContain('Nothing is deleted');
    await expect(page.locator('#siteStatusBadge')).toHaveText('Offline');
    await expect(page.locator('#siteStatusCard a')).toHaveCount(0);   // no address to visit while it's offline
    await expect(page.locator('#siteStatusCard')).toContainText('temporarily offline');
    await expect(page.locator('#siteStatusBtn')).toHaveText('Bring back online');
  });

  test('saying no to the question changes nothing', async ({ page }) => {
    await mount(page, '/presence.html', { ...SHOWN, ...LIVE });
    let sent = 0;
    await page.route('**/functions/v1/presence/preview/status', (r) => r.fulfill({ json: { data: status(null) } }));
    await page.route('**/functions/v1/presence/site/offline', (r) => { sent++; return r.fulfill({ json: { data: { ok: true } } }); });
    await page.locator('#ssTodo').click();
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#siteStatusBtn').click();
    await expect(page.locator('#siteStatusBadge')).toHaveText('Public');
    await page.waitForTimeout(300);
    expect(sent).toBe(0);
  });
});

// Editing by touch (list item 31): the first tap on a section selects it, a second tap on its
// words edits them. The site-home spec taps sections; these tap words and the toolbar.
const touchCanvas = async (page: Page) => {
  const writes = await mount(page, '/presence.html#design');
  const frame = page.frameLocator('#designPreview');
  await frame.locator('section#b [data-dds-field="body"]').waitFor();
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  await page.waitForLoadState('networkidle');
  return { writes, frame };
};
const touchChecks = () => {
  test('a first tap on another section’s words moves the selection there, and edits nothing', async ({ page }) => {
    const { frame } = await touchCanvas(page);
    await frame.locator('section#a').tap();
    await expect(frame.locator('section#a')).toHaveClass(/dc-hot/);
    const words = frame.locator('section#b [data-dds-field="body"] p');
    await words.tap();
    await expect(frame.locator('section#b')).toHaveClass(/dc-hot/);
    await expect(frame.locator('section#a')).not.toHaveClass(/dc-hot/);
    await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
    await expect(frame.locator('[contenteditable]')).toHaveCount(0);
    await words.tap();   // the second tap on them edits
    await expect(frame.locator('section#b [data-dds-field="body"]')).toHaveAttribute('contenteditable', 'true');
  });
  test('while words are being edited, Bold works by touch and the editing carries on', async ({ page }) => {
    const { writes, frame } = await touchCanvas(page);
    const body = frame.locator('section#b [data-dds-field="body"]');
    await frame.locator('section#b').tap();
    await body.locator('p').tap();
    await expect(body).toHaveAttribute('contenteditable', 'true');
    const bar = frame.locator('#dds-ipe-bar');
    await expect(bar).toHaveClass(/\bon\b/);
    await body.evaluate((el) => {   // "bread" selected, as a long press would
      const t = el.querySelector('p')!.firstChild!, r = document.createRange(), s = getSelection()!;
      r.setStart(t, 6); r.setEnd(t, 11); s.removeAllRanges(); s.addRange(r);
    });
    await bar.getByRole('button', { name: 'Bold' }).tap();
    await expect(body.locator('strong')).toHaveText('bread');
    await expect(body).toHaveAttribute('contenteditable', 'true');   // the tap didn't end the editing
    await expect(frame.locator('#dds-dc-bar')).not.toHaveClass(/\bon\b/);
    await body.press('Control+Enter');
    await expect.poll(() => writes.filter((w) => w.path === '/settings' && w.body && Array.isArray(w.body.blocks)).map((w) => w.body.blocks[1].body).at(-1)).toBe('Fresh **bread** daily');
  });
};
test.describe('editing by touch: Safari on a phone and a tablet', { tag: '@touch' }, () => {
  test.beforeEach(({}, testInfo) => { test.skip(!testInfo.project.use.hasTouch, 'touch devices only'); });
  touchChecks();
});
test.describe('editing by touch: Chrome on an Android phone', { tag: '@touch' }, () => {
  const { defaultBrowserType: _d, ...PIXEL } = devices['Pixel 7'];
  test.use(PIXEL);
  test.beforeEach(({ browserName }) => { test.skip(browserName !== 'chromium', 'Chrome only'); });
  touchChecks();
});

test.describe('the review switch’s days', () => {
  const SETTINGS_API = {
    '/identity': { data: { site_id: 's1', business_name: 'Test Studio', email: 'hello@example.com', phone: '', service_area: 'Anytown' } },
    '/connections': { data: { edition: 'studio_os', note: '', groups: {} } },
    '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-11-03T00:00:00Z', in_grace: false, has_service_billing: false } },
  };
  const SAVED = { industry_key: 'generic', review_requests: true, review_request_after_days: 3 };

  test('a day count it can’t use is put back in range, said in the sentence, and saved that way', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/settings': { data: SAVED } } });
    const sent: Array<Record<string, unknown>> = [];
    const row: Record<string, unknown> = { ...SAVED };
    await page.route('**/functions/v1/presence/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON();
      sent.push(body); Object.assign(row, body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...row } }) });
    });
    await page.goto('/settings.html#automations');
    const n = page.locator('#n-rev');
    await expect(n).toHaveValue('3');
    for (const [typed, kept] of [['0', '3'], ['200', '90'], ['', '3'], ['7.5', '7']]) {
      await n.fill(typed);
      await n.press('Tab');
      await expect(n).toHaveValue(kept);
      await expect(page.locator('#n-rev-echo')).toHaveText(kept);   // the sentence names the days it will wait
      await expect.poll(() => sent.at(-1)).toEqual({ review_request_after_days: Number(kept) });
    }
    expect(sent).toHaveLength(4);
  });
});
