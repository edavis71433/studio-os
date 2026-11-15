import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Speed (Nov 15 2026): the database is in Oregon, but Supabase runs the server in the region
// nearest the visitor, so from the east coast every small database call behind one answer
// crossed the country (about 1 s an answer, 0.4 s beside the database). Every studio page
// now asks for Oregon with the x-region header, as the client portal does
// (portal-being-built-179.spec.ts). tests/presence/fn_region_test.mjs pins each call in the
// source; this proves the pages really send it, the shell's own reads included.
const PAGES = [
  '/today.html', '/sites.html', '/pipeline.html', '/crm.html', '/contacts.html', '/customers.html', '/inbox.html',
  '/projects.html', '/files.html', '/invoices.html', '/settings.html', '/analytics.html', '/domains.html', '/presence.html',
  '/connections.html', '/help.html', '/broadcasts.html', '/todos.html', '/week.html', '/usage.html', '/templates.html',
  '/sharing.html', '/agency.html', '/prospects.html', '/developer.html', '/recently-deleted.html', '/visual-studio.html',
];

test.describe('every server read asks to run beside the database', () => {
  for (const path of PAGES) {
    test(`${path}`, async ({ page }) => {
      await installApp(page);
      const sent: string[] = [];
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname.includes('/functions/v1/presence/') && r.method() !== 'OPTIONS') {
          sent.push(`${r.method()} ${u.pathname.replace(/^.*\/functions\/v1\/presence/, '')} → ${r.headers()['x-region'] || 'none'}`);
        }
      });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.filter((s) => !s.endsWith('→ us-west-2'))).toEqual([]);
    });
  }
});
