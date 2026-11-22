import { test, expect, Route } from '@playwright/test';
import { SHELL_CSS, SHELL_CRITICAL, SHELL_NOSCRIPT, MENU_JS, menuButtonHtml } from '../../supabase/functions/presence/lib/site_shell';
import { BLOCK_JS, BLOCK_CSS } from '../../supabase/functions/presence/lib/site_blocks';
import { NAV_DROPDOWN_CSS } from '../../supabase/functions/presence/lib/site_nav';

// Builder items 288, 294, 298 and 307 (Nov 22 2026 review), on a visitor's page scrolled and pressed for
// real: the phone menu (a slim bar, the sheet, a dropdown on a tap, Escape, scripts off), the room a jump
// leaves for the stuck header, and the gallery's zoom view (Escape, the arrow keys, the keyboard kept inside,
// no step added to the Back button) with the carousel's arrows and dots. The page is drawn here from the
// same parts the renderer uses (lib/site_shell.ts, lib/site_blocks.ts), served at a made-up address.

const MENU = `<ul><li><a href="/" aria-current="page">Home</a></li><li class="has-sub"><a href="/services/" aria-haspopup="true">Services<span class="sub-caret" aria-hidden="true">▾</span></a><ul class="subnav"><li><a href="/services/repairs/">Repairs</a></li></ul></li><li class="has-sub nav-folder"><a role="button" tabindex="0" aria-haspopup="true">More<span class="sub-caret" aria-hidden="true">▾</span></a><ul class="subnav"><li><a href="/about/">About</a></li></ul></li><li><a href="/contact/">Contact</a></li></ul>`;
const GALLERY = `<section class="block wrap block-gallery v-zoom" id="gallery"><h2>Gallery</h2><div class="gallery" id="lb-0">${[1, 2, 3].map((i) => `<figure class="ga"><a class="ga-zoom" href="#lb-0-${i}" aria-label="View image ${i} larger"><img src="/img/${i}.webp" alt="Photo ${i}" width="400" height="300" loading="lazy"></a></figure>`).join('')}</div>${[1, 2, 3].map((i) => `<figure class="lb" id="lb-0-${i}" role="dialog" aria-modal="true" aria-label="Image ${i} of 3"><a class="lb-bg" href="#lb-0" aria-hidden="true" tabindex="-1"></a><a class="lb-close" href="#lb-0" aria-label="Close and return to the gallery">✕<span class="lb-close-t">Close</span></a><span class="lb-frame"><img src="/img/${i}.webp" alt="Photo ${i}" width="400" height="300"></span><span class="lb-count">${i} / 3</span><a class="lb-prev" href="#lb-0-${i === 1 ? 3 : i - 1}" aria-label="Previous image">‹</a><a class="lb-next" href="#lb-0-${i === 3 ? 1 : i + 1}" aria-label="Next image">›</a></figure>`).join('')}</section>`;
const CAROUSEL = `<section class="block wrap block-carousel" id="slides"><div class="carousel" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Image carousel"><div class="cr-track">${[1, 2, 3].map((i) => `<figure class="cr-slide"><img src="/img/${i}.webp" alt="Slide ${i}" width="400" height="300" loading="lazy"></figure>`).join('')}</div></div><p class="cr-hint">Swipe or scroll →</p></section>`;
// the few template rules the shell builds on (a sticky header, the row, a gallery grid, a scrolling track)
const BASE_CSS = `body{margin:0;font-family:system-ui,sans-serif}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}header.site{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;z-index:20}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:15px;padding-bottom:15px;flex-wrap:wrap}nav.primary ul{display:flex;gap:2px;list-style:none;margin:0;padding:0}nav.primary a{display:inline-block;padding:9px 14px;text-decoration:none;color:#333}.sitesearch{display:flex;border:1px solid #ddd;border-radius:999px;padding:5px 12px;max-width:200px}.sitesearch input{border:0;width:100%}.block{padding:60px 0}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.gallery img{width:100%;height:auto;display:block}.lb{display:none;position:fixed;inset:0;z-index:9999;margin:0;padding:20px;background:rgba(12,10,16,.93);flex-direction:column;align-items:center;justify-content:center}.lb:target{display:flex}.lb-bg{position:absolute;inset:0}.lb-close,.lb-prev,.lb-next{color:#fff;position:relative}.cr-track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory}.cr-slide{flex:0 0 100%;scroll-snap-align:center;margin:0}.cr-slide img{width:100%;display:block}`;
const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${SHELL_CRITICAL}</style><style>${BASE_CSS}${BLOCK_CSS}${NAV_DROPDOWN_CSS}${SHELL_CSS}</style>${SHELL_NOSCRIPT}</head><body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site"><div class="wrap nav"><a class="brand" href="/">Marlow’s Kitchen</a>${menuButtonHtml()}<div class="site-menu" id="site-menu"><nav class="primary" aria-label="Main">${MENU}</nav><form class="sitesearch" role="search" action="/search/" method="get"><input type="search" name="q" aria-label="Search this site" placeholder="Search"></form></div></div></header>
<main id="main"><section class="hero wrap" style="height:900px"><h1>Marlow’s Kitchen</h1><a class="btn" href="#gallery">See the gallery</a></section>${GALLERY}${CAROUSEL}<section class="block wrap" id="last" style="height:1200px"><h2>The end</h2></section></main>
<footer class="site"><div class="wrap"><p>© Marlow’s Kitchen</p></div></footer>
<script src="/assets/site-zz.js" defer></script></body></html>`;

async function serve(page: import('@playwright/test').Page, scripts = true) {
  await page.route('**/zz-site/**', (route: Route) => {
    const url = route.request().url();
    if (url.includes('/img/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#c96"/></svg>' });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
  });
  await page.route('**/assets/site-zz.js', (route: Route) => route.fulfill({ status: scripts ? 200 : 404, contentType: 'text/javascript', body: scripts ? `${MENU_JS}\n${BLOCK_JS}` : '' }));
  await page.goto('/zz-site/');
}
const isPhone = (page: import('@playwright/test').Page) => page.viewportSize()!.width <= 720;

test.describe('the phone menu on a published site (builder item 288)', () => {
  test('a slim bar with a Menu button on a phone; the whole menu in the row on a wide screen', async ({ page }) => {
    await serve(page);
    const btn = page.locator('.menu-btn'), sheet = page.locator('.site-menu');
    if (isPhone(page)) {
      await expect(btn).toBeVisible();
      await expect(sheet).toBeHidden();
      const bar = await page.locator('header.site').evaluate((n) => n.getBoundingClientRect().height);
      expect(bar).toBeLessThanOrEqual(64);
      const box = (await btn.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    } else {
      await expect(btn).toBeHidden();
      await expect(page.locator('nav.primary a', { hasText: 'Contact' })).toBeVisible();
      await expect(page.locator('.sitesearch')).toBeVisible();
    }
  });

  test('the sheet opens and closes on the button and on Escape, and says so to a screen reader', async ({ page }) => {
    test.skip(!isPhone(page), 'the menu folds on a phone only');
    await serve(page);
    const btn = page.locator('.menu-btn'), sheet = page.locator('.site-menu');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toHaveAttribute('aria-controls', 'site-menu');
    await btn.click();
    await expect(sheet).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.site-menu .sitesearch')).toBeVisible();   // the search box moved into the sheet
    for (const a of await page.locator('.site-menu nav.primary > ul > li > a').all()) expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();
    await btn.click();
    await page.mouse.click(200, 700);   // a tap outside closes it too
    await expect(sheet).toBeHidden();
  });

  test('a dropdown opens on a tap: a page’s first tap opens it, a folder toggles, Enter works', async ({ page }) => {
    test.skip(!isPhone(page), 'the menu folds on a phone only');
    await serve(page);
    await page.locator('.menu-btn').click();
    const services = page.locator('li.has-sub:not(.nav-folder)'), folder = page.locator('li.nav-folder');
    await expect(services.locator('ul.subnav')).toBeHidden();
    await services.locator('> a').click();
    await expect(services).toHaveClass(/\bopen\b/);
    await expect(services.locator('ul.subnav a', { hasText: 'Repairs' })).toBeVisible();
    expect(page.url()).toContain('/zz-site/');   // the first tap opened it; the page did not change
    await folder.locator('> a').focus();
    await page.keyboard.press('Enter');
    await expect(folder).toHaveClass(/\bopen\b/);
    await expect(folder.locator('> a')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(folder).not.toHaveClass(/\bopen\b/);
  });

  test('with scripts off the menu simply shows, as it always did', async ({ page }) => {
    await serve(page, false);
    await page.evaluate(() => { const s = document.createElement('style'); s.textContent = '@media (max-width:720px){.site-menu{display:block;position:static;box-shadow:none;max-height:none;padding:0 0 10px}.menu-btn{display:none}.site-menu nav.primary ul.subnav{display:block}}'; document.head.appendChild(s); });   // what <noscript> holds, since the browser ran the page with scripts on
    await expect(page.locator('nav.primary a', { hasText: 'Contact' })).toBeVisible();
    if (isPhone(page)) await expect(page.locator('.menu-btn')).toBeHidden();
  });
});

test.describe('a jump lands under the stuck header no more (builder item 294)', () => {
  test('the page keeps the header’s height clear when it scrolls to a spot', async ({ page }) => {
    await serve(page);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hdr-h').trim())).toMatch(/^\d+px$/);
    await page.locator('a.btn', { hasText: 'See the gallery' }).click();
    await page.waitForTimeout(400);
    const [top, header] = await page.evaluate(() => [document.getElementById('gallery')!.getBoundingClientRect().top, document.querySelector('header.site')!.getBoundingClientRect().bottom]);
    expect(top).toBeGreaterThanOrEqual(header);   // the section's first line sits below the header
    expect(top - header).toBeLessThan(40);
  });
});

test.describe('the gallery’s zoom view and the carousel (builder items 298 and 307)', () => {
  test('Escape closes, the arrow keys move, the keyboard stays inside, and moving adds no step to Back', async ({ page }) => {
    await serve(page);
    await page.locator('a.ga-zoom').first().click();
    await expect(page.locator('#lb-0-1')).toBeVisible();
    await expect(page.locator('#lb-0-1 .lb-close')).toBeFocused();
    const steps = await page.evaluate(() => history.length);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);   // the address changes, then the view follows
    await expect(page.locator('#lb-0-2')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    await expect(page.locator('#lb-0-1')).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(steps);   // moving replaced the address
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');   // Safari's Tab skips links; focus that lands outside comes back to Close
    expect(await page.evaluate(() => !!document.activeElement?.closest('.lb'))).toBe(true);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.lb'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#lb-0-1')).toBeHidden();
    await expect(page.locator('a.ga-zoom').first()).toBeFocused();
    expect(await page.evaluate(() => history.length)).toBe(steps);
  });

  test('the carousel gets Previous and Next and a dot a slide, and the swipe hint goes', async ({ page }) => {
    await serve(page);
    const c = page.locator('.block-carousel');
    await expect(c.locator('.cr-dot')).toHaveCount(3);
    await expect(c.locator('.cr-hint')).toBeHidden();
    await expect(c.locator('.cr-dot').first()).toHaveAttribute('aria-current', 'true');
    for (const b of await c.locator('.cr-prev, .cr-next, .cr-dot').all()) { const box = (await b.boundingBox())!; expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44); }
    await c.locator('.cr-next').click();
    await expect(c.locator('.cr-dot').nth(1)).toHaveAttribute('aria-current', 'true');
    await c.locator('.cr-dot').nth(2).click();
    await expect(c.locator('.cr-dot').nth(2)).toHaveAttribute('aria-current', 'true');
    await c.locator('.cr-prev').click();
    await expect(c.locator('.cr-dot').nth(1)).toHaveAttribute('aria-current', 'true');
  });
});
