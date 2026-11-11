import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// One icon set, readable small text, one clear main button per card (builder list item 34, Nov
// 2026). Across the editor's bar, dock and cards: no words smaller than 12 pixels, no typed ↑, ↓,
// ✕, ×, ⋯, ✓ or ◌ standing in for an icon (and every icon button has a name), and one filled
// main button in a card at a time.
const BLOCKS = [{ type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>section{padding:48px 24px}</style></head><body>'
  + '<header class="site"><b>Marlow’s Kitchen</b></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'abc' };
const LOCK = '11111111-2222-4333-8444-555555555555';
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen', description: 'Fresh bread every morning in Burbank since 2014.' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/page-locks': { data: { ids: [], ready: true } },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
type Own = { slug: string; title: string; blocks: unknown[]; hideNav?: boolean; access?: string; lock?: string; noHeader?: boolean; noFooter?: boolean };
const OWN: Own[] = [
  { slug: 'gallery', title: 'Gallery', blocks: [] },
  { slug: 'landing', title: 'Landing', blocks: [], hideNav: true, noHeader: true, noFooter: true },
];
type Write = { method: string; path: string; body: any };
async function mount(page: Page, opts: { pages?: Own[]; api?: Record<string, unknown> } = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, pages: opts.pages ?? OWN };
  await installApp(page, { api: { ...API, ...(opts.api || {}), '/settings': { data: settings } } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/settings') { settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    if (path === '/page-locks') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: LOCK } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return writes;
}

const run = (page: Page, f: string, ...a: unknown[]) => page.evaluate(([fn, args]) => (window as any)[fn as string](...(args as unknown[])), [f, a] as const);
const REGIONS = '.dc-bar, #dcDock, #pagesCard, #settingsPanel, #trayPanel, #ritualWrap, #view-history';
// every visible bit of words in the editor's own parts, and its size
const smallWords = (page: Page) => page.evaluate((sel) => {
  const out: string[] = [];
  document.querySelectorAll(sel).forEach((region) => {
    const walk = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = (n.textContent || '').trim(); if (!t) continue;
      const p = n.parentElement!; const r = p.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const st = getComputedStyle(p); if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
      if (parseFloat(st.fontSize) < 12) out.push(t.slice(0, 24) + ' @' + st.fontSize);
    }
  });
  return out;
}, REGIONS);
const typedIcons = (page: Page) => page.evaluate((sel) => {
  const out: string[] = [];
  document.querySelectorAll(sel).forEach((region) => region.querySelectorAll('button').forEach((b) => {
    const t = (b.textContent || '').trim();
    if (/^[↑↓✕×⋯✓◌]$/.test(t)) out.push(t + ' (' + (b.getAttribute('aria-label') || b.title || '') + ')');
    if (b.querySelector('svg') && !t && !(b.getAttribute('aria-label') || b.title || b.getAttribute('aria-labelledby'))) out.push('unnamed icon button');
  }));
  return out;
}, REGIONS);

test.describe('one icon set, readable small text, one main button (builder item 34)', () => {
  test('the bar, the dock and every card: no words under 12 pixels and no typed icons', async ({ page }) => {
    await mount(page);
    const seen: string[] = [], icons: string[] = [];
    const look = async () => { seen.push(...await smallWords(page)); icons.push(...await typedIcons(page)); };
    await look();
    await run(page, 'openPagesCard', 'dcPageSwitch'); await page.waitForTimeout(200); await look();
    await page.locator('#pagesCard .pg-gear').first().click(); await page.waitForTimeout(200); await look();
    await run(page, 'closeDesignPanels');
    for (const t of ['looks', 'colours', 'fonts']) { await run(page, 'openSettingsPanel', 'styles'); await run(page, 'stylesTab', t); await page.waitForTimeout(200); await look(); }
    await run(page, 'eeEditBlock', 0); await page.waitForTimeout(250); await look();
    for (const tab of ['style', 'layout', 'when']) { await run(page, 'insTab', tab); await page.waitForTimeout(150); await look(); }
    await run(page, 'closeDesignPanels');
    await run(page, 'openTrayPanel', 'add'); await page.waitForTimeout(250); await look();
    expect(seen).toEqual([]);
    expect(icons).toEqual([]);
  });

  test('the Pages card: with a page’s settings open, Done is its one main button', async ({ page }) => {
    await mount(page);
    await run(page, 'openPagesCard', 'dcPageSwitch');
    const add = page.locator('#pagesCard .pc-add');
    const filled = () => add.evaluate((b) => /gradient/.test(getComputedStyle(b).backgroundImage));
    expect(await filled()).toBe(true);   // the list: Add page leads
    await page.locator('#pagesCard .pg-gear').first().click();
    await expect(page.locator('#pagesCard')).toHaveClass(/\bpane-open\b/);
    expect(await filled()).toBe(false);  // a page's settings: Done leads, Add page steps back
    await page.locator('#pcBack').click();
    await expect(page.locator('#pagesCard')).not.toHaveClass(/\bpane-open\b/);
    expect(await filled()).toBe(true);
  });
});
