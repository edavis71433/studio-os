import { test, expect, Page, Route } from '@playwright/test';
import { mountCanvas, API, SETTINGS } from './helpers/editor';
import { installApp, settled } from './helpers/app';
import { pinClock } from './helpers/clock';
import { SHELL_CSS, SHELL_CRITICAL, menuButtonHtml } from '../../supabase/functions/presence/lib/site_shell';

// Small editor fixes from the Nov 22 review, pressed in the real editor: the dock's Versions lists the
// saved versions above the page and draws the one pressed (builder item 322); the section search finds
// what owners type, with tiles for a contact form and the hours (324); the dock has no Find and Layers
// says what it lists (326); the browser's own font is named in words (327); How you sound is one row in
// Business details, saved where the AI writer reads it, and the writer's box says so (328); and a long
// business name keeps the phone bar near 60px (430).

test.use({ timezoneId: 'America/Los_Angeles' });
test.beforeEach(async ({ page }) => { await pinClock(page); });   // PINNED_NOW, before any page.goto (item 421)

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const phone = (page: Page) => page.viewportSize()!.width <= 720;
// on a phone the dock is a pill along the bottom, with Layers and Versions behind More
async function dockTool(page: Page, sel: string) {
  if (phone(page)) await page.locator('#dkMore').click();
  await page.locator(sel).click();
}
const PUBS = [
  { id: 'pub-new', at: '2026-11-20T18:00:00Z', status: 'live', summary: 'Holiday hours' },
  { id: 'pub-old', at: '2026-11-12T17:00:00Z', status: 'superseded', summary: 'New photos' },
  { id: 'pub-bad', at: '2026-11-14T17:00:00Z', status: 'failed', summary: '' },
];
const CPS = [{ id: 'cp-1', name: 'Before the winter menu', at: '2026-11-16T17:00:00Z' }];
const PAST = (id: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main"><section class="hero"><h1>Past version ${id}</h1></section></main></body></html>`;

test.describe('Versions in the dock (builder item 322)', () => {
  test('the saved versions, newest first, sit above the page; a press draws that version', async ({ page }) => {
    const asked: string[] = [];
    const { frame } = await mountCanvas(page, { beforeGoto: async (p) => {
      // past versions on the canvas are the studio's (site-home.spec: a client's dock has Notes only)
      await p.route('**/functions/v1/presence/portal/context', (r) => json(r, { data: { ...(API['/portal/context'] as { data: Record<string, unknown> }).data, is_agency: true } }));
      await p.route('**/functions/v1/presence/publishes/checkpoints', (r) => json(r, { data: CPS }));
      await p.route('**/functions/v1/presence/publishes', (r) => json(r, { data: PUBS }));
      await p.route('**/functions/v1/presence/preview**', (r) => {
        const u = new URL(r.request().url()), id = u.searchParams.get('publish_id') || u.searchParams.get('launch_id');
        if (!id) return r.fallback();
        asked.push((u.searchParams.has('launch_id') ? 'launch:' : 'publish:') + id);
        return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAST(id) });
      });
    } });
    await dockTool(page, '#dcModeSeg [data-dcmode="timewarp"]');
    const bar = page.locator('#dcTwBar'), chips = page.locator('#dcTwList .dc-tw-v');
    await expect(bar).toBeVisible();
    await expect(chips).toHaveCount(3);   // the failed publish has nothing to show
    await expect(chips.nth(0)).toContainText('Nov 20');
    await expect(chips.nth(0)).toContainText('Live now');
    await expect(chips.nth(1)).toContainText('Saved, never live');
    await expect(chips.nth(2)).toContainText('Nov 12');
    // above the page, not over the site's own header
    const barBox = (await bar.boundingBox())!, frameBox = (await page.locator('#designPreview').boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(frameBox.y + 1);
    for (const c of await chips.all()) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await chips.nth(1).click();
    await expect(frame.locator('h1')).toHaveText('Past version cp-1');
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#dcTwMsg')).toHaveText(/^Your draft as you saved it on November 16, 2026 at 9:00 AM\.$/);
    await chips.nth(0).click();
    await expect(frame.locator('h1')).toHaveText('Past version pub-new');
    await expect(page.locator('#dcTwMsg')).toContainText('It’s what’s live now.');
    expect(asked).toEqual(['launch:cp-1', 'publish:pub-new']);
    await page.locator('#dcTwBack').click();
    await expect(bar).toBeHidden();
    await expect(frame.locator('h1')).not.toHaveText(/Past version/);
  });
});

test.describe('finding a section, and the dock (builder items 324 and 326)', () => {
  test('the words owners type find tiles; the dock has no Find; Layers says what it lists', async ({ page }) => {
    await mountCanvas(page);
    await expect(page.locator('#dkFind')).toHaveCount(0);
    await page.locator('#btnTrayOpen').click();
    const search = page.locator('#designTray .tray-search'), names = page.locator('#designTray .ti-name');
    const want: Array<[string, string[]]> = [
      ['form', ['Contact form', 'Newsletter sign-up']], ['contact', ['Contact form', 'Map & directions']], ['hours', ['Hours']],
      ['menu', ['Pricing / packages']], ['hero', ['Opening with a photo', 'Spotlight']], ['faq', ['Accordion']],
      ['testimonial', ['Reviews wall', 'Review rating badge']], ['blog', ['Updates']],
    ];
    for (const [q, tiles] of want) {
      await search.fill(q);
      for (const t of tiles) await expect(names.filter({ hasText: new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '$') }), `"${q}" finds ${t}`).toHaveCount(1);
    }
    await search.fill('contact');
    await expect(page.locator('#designTray .tray-grp').first().locator('.ti-name').first()).toHaveText('Contact form');   // the tile that answers the word leads
    await search.fill('');
    expect((await names.allTextContents()).filter((n) => /\((native|expandable)\)/.test(n))).toEqual([]);
    await page.locator('#btnTrayClose').click();
    await dockTool(page, '#dkLayers');
    await expect(page.locator('#designTreeList .dc-tree-hd').first()).toHaveText('Sections on this page');
  });

  test('the Contact form tile puts a contact form on the page; Hours opens beside the page', async ({ page }) => {
    const { puts } = await mountCanvas(page);
    await page.locator('#btnTrayOpen').click();
    await page.locator('#designTray .tray-search').fill('contact form');
    await page.locator('#designTray .tray-route[data-route="contact_form"]').click();
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'forms');
    await expect.poll(() => puts.some((b) => Array.isArray(b.blocks) && (b.blocks as Array<Record<string, unknown>>).some((x) => x.type === 'form' && x.kind === 'contact'))).toBe(true);
    await settled(page);
    await page.locator('#btnTrayOpen').click();
    await page.locator('#designTray .tray-search').fill('hours');
    await page.locator('#designTray .tray-route[data-route="hours"]').click();
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'core');
    await expect(page.locator('#settingsPanel #bizHoursH')).toBeInViewport();
  });
});

test.describe('plain words (builder item 327)', () => {
  test('a font the browser picks is named in words, never system-ui', async ({ page }) => {
    await mountCanvas(page, { beforeGoto: (p) => p.route('**/functions/v1/presence/dev/customization', (r) => json(r, { data: { ...API['/dev/customization'].data, theme_tokens: { font_body: 'system-ui, sans-serif' } } })) });
    await page.locator('#btnSettingsOpen').click();
    await page.locator('#stylesSeg [data-stab="fonts"]').click();
    const row = page.locator('#settingsPanel .st-fontrow').filter({ hasText: 'Text' });
    await expect(row.locator('.v')).toHaveText('Your device’s own font');
    await expect(page.locator('#settingsPanel')).not.toContainText('system-ui');
  });
});

test.describe('How you sound (builder item 328)', () => {
  test('one row in Business details, saved where the writer reads it, and the writer\'s box says so', async ({ page }) => {
    const sent: unknown[] = [];
    await installApp(page, { api: { ...API, '/settings': { data: SETTINGS },
      'GET /brand/profile': { data: { voice_characteristics: '' } },   // a plain key would answer the PUT too
      'PUT /brand/profile': (body: Record<string, unknown>) => { sent.push(body); return { data: { voice_characteristics: body.voice_characteristics } }; },
    } });
    await page.goto('/presence.html#business');
    const sel = page.locator('#f-voice');
    await expect(sel).toBeVisible();
    expect(await sel.locator('option').allTextContents()).toEqual(['Not chosen yet', 'Warm and friendly', 'Calm and professional', 'Upbeat and fun', 'Simple and to the point', 'Polished and upscale', 'In my own words']);
    await settled(page);
    await sel.selectOption('Warm and friendly');
    await expect.poll(() => sent).toEqual([{ voice_characteristics: 'Warm and friendly' }]);
    await sel.selectOption('own');
    const own = page.locator('#f-voice-own');
    await expect(own).toBeFocused();
    await own.fill('Honest and down to earth, no jargon');
    await own.press('Tab');
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ voice_characteristics: 'Honest and down to earth, no jargon' });
    await page.locator('#bizAboutH .biz-help').click();
    await expect(page.locator('#deskVoice')).toHaveText('Written in your voice: Honest and down to earth, no jargon. Change it in Business details, under How you sound.');
  });
});

test.describe('a long business name on a phone (builder item 430)', () => {
  test('the bar stays near 60px: the name holds to two lines, a little smaller', async ({ page }) => {
    test.skip(!phone(page), 'the menu folds into the bar on a phone');
    const name = 'Marlow’s Kitchen and Catering Company of Greater Los Angeles';
    const base = 'body{margin:0;font-family:system-ui,sans-serif}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}header.site{border-bottom:1px solid #ddd}.nav{display:flex;align-items:center;justify-content:space-between}.brand{font-weight:800;font-size:1.2rem;color:#222;text-decoration:none;display:inline-flex;align-items:center}';
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${SHELL_CRITICAL}</style><style>${base}${SHELL_CSS}</style></head><body>`
      + `<header class="site"><div class="wrap nav"><a class="brand" href="/"><span class="brand-name">${name}</span></a>${menuButtonHtml()}<div class="site-menu" id="site-menu"></div></div></header><main><h1>Hello</h1></main></body></html>`);
    const bar = await page.locator('header.site').evaluate((n) => n.getBoundingClientRect().height);
    expect(bar).toBeLessThanOrEqual(62);
    const lines = await page.locator('.brand-name').evaluate((n) => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)));
    expect(lines).toBeLessThanOrEqual(2);
    await expect(page.locator('.menu-btn')).toBeVisible();
  });
});
