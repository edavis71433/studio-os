import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { applyButtonStyles, BUTTON_SETS, FORM_STYLES } from '../../supabase/functions/presence/lib/site_buttons';

// Builder list item 217 (Nov 2026): Styles › Buttons. One set restyles every button on the site
// (filled, outline, pill, square, underline) and one form style every box people type into
// (line, soft, round); none chosen keeps the template's own. The editor's tab, then a page drawn
// with each set in a real browser. tests/presence/button_sets_test.mjs covers the server.
const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--paper:#fbf8f3;--ink:#231c17;--accent:#8a4b2a;--accent-dark:#6b3a20;--card:#ffffff}body{margin:0;background:var(--paper)}section{padding:48px 24px;min-height:420px}</style></head><body>'
  + '<main id="main"><section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2><a class="btn" href="/menu/">Book a table</a></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'n1' };
const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/media': { data: [] }, '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] }, '/publishes': { data: [] }, '/launches': { data: [] },
  '/preview/status': { data: { draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-11-10T15:00:00Z' } } },
  '/portal/context': CTX,
};
type Write = { method: string; path: string; body: any };
const json = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
async function editor(page: Page, tokens: Record<string, string> = {}) {
  let saved: Record<string, string> = { ...tokens };
  await installApp(page, { api: { ...API,
    '/settings': { data: { blocks: BLOCKS, section_meta: META } },
    '/dev/customization': { data: { theme_tokens: saved, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  } });
  const writes: Write[] = []; const draws = { n: 0 };
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/dev/customization') { saved = body.theme_tokens || {}; return json(route, { ...body, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false }); }
    return json(route, body || {});
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => { draws.n++; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }); });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  await page.locator('#btnSettingsOpen').click();
  await page.locator('#stylesSeg [data-stab="buttons"]').click();
  await expect(page.locator('#stylesSeg [data-stab="buttons"]')).toHaveAttribute('aria-selected', 'true');
  return { writes, draws };
}
const lastTokens = (m: { writes: Write[] }) => m.writes.filter((w) => w.path === '/dev/customization').at(-1)?.body?.theme_tokens;
const sets = (page: Page) => page.getByRole('group', { name: 'Button set' });
const forms = (page: Page) => page.getByRole('group', { name: 'Forms' });

test.describe('Styles › Buttons (builder item 217)', () => {
  test('six sets and four form styles, the template’s own in use, and only this tab’s rows show', async ({ page }) => {
    await editor(page);
    await expect(sets(page).locator('.st-set-l')).toHaveText(['Your template’s ✓', 'Filled', 'Outline', 'Pill', 'Square', 'Underline']);
    await expect(forms(page).locator('.st-set-l')).toHaveText(['Template’s ✓', 'Line', 'Soft', 'Round']);
    await expect(sets(page).getByRole('button', { name: 'Pill', exact: true })).toHaveAttribute('aria-pressed', 'false');   // the drawing inside is hidden from screen readers
    await expect(sets(page).getByRole('button', { name: 'Your template’s ✓' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#designCard')).toContainText('Every button on the site at once: the main one and the second one beside it, on every page and section.');
    await expect(page.locator('#designCard')).toContainText('Every set stays readable on light, dark and accent sections. It is checked on every template and palette.');
    // each tile is drawn in the site's own colours: the accent the canvas draws with, white words on it
    const main = sets(page).getByRole('button', { name: 'Pill' }).locator('.bs-main');
    await expect(main).toHaveCSS('background-color', 'rgb(138, 75, 42)');
    await expect(main).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(main).toHaveCSS('border-top-left-radius', '999px');
    await expect(sets(page).getByRole('button', { name: 'Square' }).locator('.bs-main')).toHaveCSS('text-transform', 'uppercase');
    // the other tabs' rows stay hidden
    await expect(page.locator('#siteIconRow')).toBeHidden();
  });

  test('a set and a form style are picked, saved and drawn on the canvas; the template’s own takes them away', async ({ page }) => {
    const m = await editor(page);
    const before = m.draws.n;
    await sets(page).getByRole('button', { name: 'Pill', exact: true }).click();
    await expect.poll(() => lastTokens(m)).toEqual({ buttons: 'pill' });
    await expect(sets(page).getByRole('button', { name: 'Pill ✓' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => m.draws.n).toBeGreaterThan(before);   // the server draws the set, so the canvas is drawn again
    await forms(page).getByRole('button', { name: 'Soft', exact: true }).click();
    await expect.poll(() => lastTokens(m)).toEqual({ buttons: 'pill', forms: 'soft' });
    await expect(forms(page).getByRole('button', { name: 'Soft ✓' })).toHaveAttribute('aria-pressed', 'true');
    await sets(page).getByRole('button', { name: 'Your template’s', exact: true }).click();
    await expect.poll(() => lastTokens(m)).toEqual({ forms: 'soft' });
    await forms(page).getByRole('button', { name: 'Template’s', exact: true }).click();
    await expect.poll(() => lastTokens(m)).toEqual({});
  });

  test('a site with a set opens on it', async ({ page }) => {
    await editor(page, { buttons: 'underline', forms: 'line' });
    await expect(sets(page).getByRole('button', { name: 'Underline ✓' })).toHaveAttribute('aria-pressed', 'true');
    await expect(forms(page).getByRole('button', { name: 'Line ✓' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sets(page).getByRole('button', { name: 'Your template’s', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('five tabs fit the card, every name whole, and the tiles stay on screen @layout', async ({ page }) => {
    await editor(page);
    for (const tab of await page.locator('#stylesSeg button').all()) {
      expect(await tab.evaluate((b) => b.scrollWidth <= b.clientWidth + 0.5)).toBe(true);
    }
    const w = page.viewportSize()!.width;
    for (const b of await page.locator('#designCard .st-set').all()) {
      await b.scrollIntoViewIfNeeded();
      const r = (await b.boundingBox())!;
      expect(r.x).toBeGreaterThanOrEqual(-0.5); expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
  });
});

// ── a page drawn with each set, in a real browser ──
// The colours and rules a template draws with (Business Classic's), the sections' dark and accent
// bands as BLOCK_CSS draws them, then the set's own style as lib/site_buttons.ts writes it.
const SITE_CSS = ':root{--paper:#f7f7f5;--ink:#1c2430;--accent:#23635a;--accent-dark:#17453f;--wash:#eef1ee;--card:#ffffff;--line:#e2e4e1;--soft:#5b6572}'
  + 'body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,sans-serif}'
  + '.block{padding:40px 22px}.btn{display:inline-block;background:var(--accent);color:#fff;padding:13px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:1rem}'
  + '.btn:hover{background:var(--accent-dark)}.btn.ghost{background:transparent;color:var(--accent-dark);border:2px solid var(--accent)}.btn-outline{background:transparent;color:var(--accent-dark);border:2px solid var(--accent)}'
  + 'form.card input,form.card textarea{width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;font:inherit;margin-top:5px;background:var(--paper)}'
  + '.block.block--bg-accent{background:var(--accent-dark,var(--accent));color:#fff}.block.block--bg-dark{background:#1a1622;color:#f2eef8}'
  + '.block.block--bg-accent .btn{background:#fff;color:var(--accent-dark,var(--accent));border-color:#fff}.block.block--bg-dark .btn{background:var(--accent);color:#fff;border-color:var(--accent)}';
const BODY = '<main><section class="block" id="light"><a class="btn" id="m1" href="#">Book a table</a> <a class="btn ghost" id="s1" href="#">See the menu</a> <a class="btn btn-outline" id="o1" href="#">Call us</a></section>'
  + '<section class="block block--bg-dark" id="dark"><a class="btn" id="m2" href="#">Book a table</a> <a class="btn ghost" id="s2" href="#">See the menu</a></section>'
  + '<section class="block block--bg-accent" id="acc"><a class="btn" id="m3" href="#">Book a table</a> <a class="btn ghost" id="s3" href="#">See the menu</a></section>'
  + '<section class="block"><form class="card"><label>Your name <input id="f1" name="n" placeholder="Sam"></label><label>Message <textarea id="f2" name="m"></textarea></label><label><input type="checkbox" id="f3"> Keep me posted</label><button class="btn" type="submit" id="m4">Send</button></form></section></main>';
async function draw(page: Page, tokens: Record<string, string>) {
  const map = { 'index.html': `<!doctype html><html><head><meta charset="utf-8"><style>${SITE_CSS}</style></head><body>${BODY}</body></html>`, 'assets/site-0001.css': SITE_CSS };
  await page.setContent(String(applyButtonStyles(map, tokens)['index.html']));
}
// the words on an element against the colour behind them, both read from the page
async function wordsContrast(page: Page, id: string) {
  return page.evaluate((id) => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) => [r, g, b].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    const el = document.getElementById(id)!;
    let bg: number[] = [0, 0, 0, 0], n: HTMLElement | null = el;
    while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c[3] ?? 1) > 0.5) { bg = c; break; } n = n.parentElement; }
    const fg = rgb(getComputedStyle(el).color);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  }, id);
}

test.describe('a page drawn with each set (builder item 217)', () => {
  test('nothing chosen: the template’s own buttons and boxes', async ({ page }) => {
    await draw(page, {});
    await expect(page.locator('#dds-buttons')).toHaveCount(0);
    await expect(page.locator('#m1')).toHaveCSS('border-top-left-radius', '10px');
  });

  for (const set of BUTTON_SETS) {
    test(`${set}: every button takes the set and its words read`, async ({ page }) => {
      await draw(page, { buttons: set });
      await expect(page.locator('#dds-buttons')).toHaveCount(1);
      const radius = { filled: '12px', outline: '10px', pill: '999px', square: '0px', underline: '0px' }[set];
      await expect(page.locator('#m1')).toHaveCSS('border-top-left-radius', radius);
      if (set === 'square') await expect(page.locator('#m1')).toHaveCSS('text-transform', 'uppercase');
      if (set === 'outline' || set === 'underline') {
        expect(await page.locator('#s1').evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('underline');
        expect(await page.locator('#o1').evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('underline');   // the sections' second button too
      }
      if (set === 'underline') expect(await page.locator('#m1').evaluate((e) => getComputedStyle(e, '::after').content)).toBe('"→"');
      // every button's words read on what is behind them, on the page and on dark and accent sections
      for (const id of ['m1', 's1', 'o1', 'm2', 's2', 'm3', 's3', 'm4']) expect(await wordsContrast(page, id), `${set} #${id}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const form of FORM_STYLES) {
    test(`${form}: every box takes the style; tick boxes and buttons don’t`, async ({ page }) => {
      await draw(page, { forms: form });
      const box = page.locator('#f1');
      if (form === 'line') { await expect(box).toHaveCSS('border-top-width', '0px'); await expect(box).toHaveCSS('border-bottom-width', '2px'); await expect(box).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)'); }
      if (form === 'soft') { await expect(box).toHaveCSS('border-top-left-radius', '12px'); expect(await box.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgb(247, 247, 245)'); }
      if (form === 'round') { await expect(box).toHaveCSS('border-top-left-radius', '999px'); await expect(page.locator('#f2')).toHaveCSS('border-top-left-radius', '20px'); }
      await expect(page.locator('#f3')).not.toHaveCSS('border-top-left-radius', '999px');
      await expect(page.locator('#m4')).toHaveCSS('border-top-left-radius', '10px');   // a form style leaves the buttons to the set
      expect(await wordsContrast(page, 'f1')).toBeGreaterThanOrEqual(4.5);
      await box.focus();
      await expect(box).toHaveCSS('outline-style', 'solid');
    });
  }
});
