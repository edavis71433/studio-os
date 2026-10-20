import { defineConfig, devices } from '@playwright/test';

// Workflow-audit walks (docs/design/WORKFLOW-AUDIT-2026-10.md). Not part of the e2e suite.
// Run from the repo root:  npx playwright test -c docs/design/audit/walks/playwright.walks.config.ts
process.env.TZ = 'UTC';
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4198', serviceWorkers: 'block', timezoneId: 'UTC' },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: { command: 'npx http-server . -p 4198 -c-1 --silent', cwd: '../../../..', url: 'http://127.0.0.1:4198/today.html', reuseExistingServer: false, timeout: 60_000 },
});
