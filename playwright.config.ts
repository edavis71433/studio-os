import { defineConfig, devices } from '@playwright/test';

// The fixtures are written in UTC (e.g. '2026-07-01T00:00:00Z' is expected to
// render as "Jul 1"), and the pages format dates in the BROWSER's zone. CI runs
// in UTC and passed; a laptop west of Greenwich rendered "Jun 30" and failed
// the same specs. Pin both halves — the Node side (specs that compute "today"
// with the same Intl calls the pages use) and every browser context — so the
// suite is the same suite wherever it runs.
process.env.TZ = 'UTC';

// ── Studio OS browser E2E (Phase PW) ─────────────────────────────────────────
// The suite is HERMETIC: a local static server serves the real HTML/JS/CSS, and
// every test stubs the Supabase client + mocks the /functions/v1/presence API
// with fixtures (see tests/e2e/helpers/app.ts). So it exercises the REAL page
// behaviour against controlled data — no backend, no credentials, no data
// mutation. Deterministic, independent, repeatable, fast, CI-ready.
export default defineConfig({
  testDir: './tests/e2e',
  snapshotDir: './tests/e2e/__screenshots__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,      // a stray test.only fails the CI gate
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],
  timeout: 30_000,
  expect: { timeout: 7_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The shell registers the real /sw.js, which calls skipWaiting() +
    // clients.claim() and so controls the page from its FIRST load. In WebKit
    // (the iPhone project) requests from a worker-controlled page bypass
    // page.route — even ones the worker's fetch handler declines — so a
    // cross-origin POST/PATCH reached the real Supabase host (CORS 401) and a
    // reload fetched the real supabase-js instead of the stub, landing on the
    // signed-out view. Chromium instruments worker traffic, which is why the
    // desktop project never saw it. No spec exercises the worker; keep it out
    // of the hermetic harness on every engine.
    serviceWorkers: 'block',
    timezoneId: 'UTC',   // see process.env.TZ above — fixtures are UTC
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npx http-server . -p 4173 -c-1 --silent',
    url: 'http://127.0.0.1:4173/today.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
