import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 264 (the full review of Nov 22 2026): the service worker must install.
// Its install step stored four marketing pages that now forward to the Squarespace site, and
// one page a worker can't fetch fails the whole install, so in a new browser there was no
// worker: no installable app, no phone alerts. The suite keeps workers out of every other spec
// (playwright.config.ts: they bypass page.route in WebKit); this one lets the real /sw.js
// install against the served site, on Chromium only, and asks for it to be ready.
test.describe('item 264 — the service worker installs against the built site', () => {
  test.use({ serviceWorkers: 'allow' });
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium instruments worker traffic (see playwright.config.ts)');

  test('the real /sw.js registers and becomes active (its install list is fetchable)', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const state = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await Promise.race([
        navigator.serviceWorker.ready.then((r) => (r.active ? 'active' : 'no-active')),
        new Promise<string>((res) => setTimeout(() => res('not-ready'), 15000)),
      ]);
      return reg;
    });
    expect(state).toBe('active');
    const stored = await page.evaluate(async () => {
      const keys = await caches.keys();
      const name = keys.find((k) => /^dds-v\d+$/.test(k)) || '';
      if (!name) return { name: '', paths: [] as string[] };
      const c = await caches.open(name);
      const reqs = await c.keys();
      return { name, paths: reqs.map((r) => new URL(r.url).pathname).sort() };
    });
    expect(stored.name).toMatch(/^dds-v(19|[2-9]\d)$/);
    expect(stored.paths).toEqual(['/404.html']);
  });
});
