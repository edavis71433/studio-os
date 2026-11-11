import { test, expect, Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installApp } from './helpers/app';

// ── List items 143 and 144: pages draw sooner, fetch nothing from Google, and keep
// working under the app host's tighter content rule ───────────────────────────
// The local server sends no _headers, so the rule is read from the file and put on
// every page this spec opens, the way Netlify sends it.
const ROOT = join(__dirname, '..', '..');
const HEADERS = readFileSync(join(ROOT, '_headers'), 'utf8');
const CSP = (HEADERS.match(/^\/\*\n(?:\s+.*\n)*?\s+Content-Security-Policy:\s*(.+)$/m) || [])[1] || '';

/** Put the app host's content rule on our own pages and record anything it blocks. */
async function underTheRule(page: Page, baseURL: string | undefined): Promise<() => Promise<string[]>> {
  expect(CSP, 'the content rule was read from _headers').toContain("default-src 'self'");
  await page.addInitScript(() => {
    const w = window as unknown as { __blocked: string[] };
    w.__blocked = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__blocked.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  const origin = new URL(baseURL || 'http://127.0.0.1').origin;
  await page.route((url) => url.origin === origin, async (route: Route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': CSP } });
  });
  return () => page.evaluate(() => (window as unknown as { __blocked: string[] }).__blocked);
}

test.describe('the sign-in library no longer holds up a page (item 143)', () => {
  // Deals, Projects, sign-up and set-password loaded it in the head: nothing drew until it
  // arrived. Hold it back and the page above its script is already there.
  for (const [path, shown] of [
    ['/pipeline.html', '#listWrap'],
    ['/projects.html', '#listWrap'],
    ['/signup.html', '#headline'],
    ['/set-password.html', '#formState'],
  ] as const) {
    test(`${path} lays out before the library arrives`, async ({ page }) => {
      let release = () => {};
      const held = new Promise<void>((r) => { release = r; });
      await page.route(/\/vendor\/supabase-js/, async (route) => {
        await held;
        await route.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:function(){return{auth:{getSession:async function(){return{data:{session:null}}},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}}}}}}};' });
      });
      try {
        await page.goto(path, { waitUntil: 'commit' });
        await expect(page.locator(shown)).toBeAttached({ timeout: 5000 });
        if (path !== '/projects.html') await expect(page.locator(shown)).toBeVisible();   // Projects draws its header in script
      } finally {
        release();   // never leave the request hanging, or the page can't close
      }
    });
  }
});

test.describe('fonts come from our own server (item 143)', () => {
  for (const [path, faces] of [
    ['/index.html', ['Fraunces', 'Inter']],
    ['/web-design.html', ['Fraunces', 'Inter']],
    ['/404.html', ['Fraunces', 'Inter']],
    ['/site-review.html', ['Playfair Display', 'Inter']],
  ] as const) {
    test(`${path} draws in its brand faces and asks Google for nothing`, async ({ page }) => {
      const asked: string[] = [];
      page.on('request', (r) => asked.push(r.url()));
      await page.goto(path);
      await page.waitForLoadState('load');
      const loaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
      });
      for (const face of faces) expect(loaded, `${path}: ${face} loaded`).toContain(face);
      expect(asked.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);
      expect(asked.some((u) => /\/fonts\/brand\.css$/.test(u)), `${path}: brand.css requested`).toBe(true);
    });
  }

  test('/favicon.ico answers with an icon', async ({ request }) => {
    const r = await request.get('/favicon.ico');
    expect(r.status()).toBe(200);
    const b = await r.body();
    expect([...b.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  });
});

test.describe("the app host's content rule breaks nothing (item 144)", () => {
  for (const path of ['/index.html', '/web-design.html', '/contact.html', '/privacy.html', '/404.html', '/site-review.html', '/ai-visibility.html']) {
    test(`${path} under the rule: nothing blocked`, async ({ page, baseURL }) => {
      const blocked = await underTheRule(page, baseURL);
      await page.goto(path);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      expect(await blocked()).toEqual([]);
    });
  }

  for (const [path, ready] of [
    ['/today.html', '#main'],
    ['/pipeline.html', '#listWrap'],
    ['/projects.html', '#listWrap'],
    ['/files.html', 'body'],
    ['/settings.html', 'body'],
    ['/presence.html', 'body'],
  ] as const) {
    test(`${path}, signed in, under the rule: nothing blocked`, async ({ page, baseURL }) => {
      const blocked = await underTheRule(page, baseURL);
      await installApp(page);
      await page.goto(path);
      await expect(page.locator(ready).first()).toBeAttached();
      await page.waitForLoadState('load');
      await page.waitForTimeout(500);
      // fixture pictures point at made-up addresses; only those may be refused
      expect((await blocked()).filter((v) => !/^img-src https:\/\/(example\.(com|org)|[\w.-]+\.example)\b/.test(v))).toEqual([]);
    });
  }
});
