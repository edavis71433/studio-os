import { test, expect, type Page } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { pinClock } from './helpers/clock';
import { smallTargets, type Miss } from './helpers/tap-walk';
import { CONTACTS_API, PROJECTS_API, AGENCY_API, BROADCASTS_API, CUSTOMERS_API } from './tap-targets-98.fixtures';
import { SETTINGS_98 } from './tap-targets-98.settings';
import { SHARING_98 } from './tap-targets-98.sharing';
import { ANALYTICS_98 } from './tap-targets-98.analytics';
import { INBOX_98 } from './tap-targets-98.inbox';
import { PIPELINE_98 } from './tap-targets-98.pipeline-phone-numbers';
import { RECORD_98, RECORD_98_CLIENT } from './tap-targets-98.phone-tablet-walk';
import { CID, PROFILE_241, WITH_SITE, CUSTOMERS_241 } from './tap-targets-98.customer-steps';

// ── Builder item 98: on a touch screen, every control is a finger-sized target ─────────
// The Nov 8 review measured taps of 16 to 32px where 44px is the phone standard: link-style
// buttons, list toolbars, chips, switches, tags, the shell's brand mark. This walks back-office
// pages on the phone and tablet projects (both touch screens) and, for every control on the
// page, presses the four edges of the 44x44 box centred on it: a finger that lands anywhere in
// that box must press that control, not the page and not a neighbour. A bigger hit area that
// keeps a small look (padding, a pseudo-element) passes; two controls closer than 44px apart
// don't. A link inside a sentence is the one exception (WCAG 2.5.8 lets those be).
// The made-up businesses in the fixtures are invented.


const PAGES: Array<{ name: string; path: string; api: Record<string, unknown>; ready: string }> = [
  { name: 'Home', path: '/agency.html', api: AGENCY_API, ready: 'header.dds-ph' },
  { name: 'Customers', path: '/customers.html', api: CUSTOMERS_API, ready: 'header.dds-ph' },
  { name: 'Contacts', path: '/contacts.html', api: CONTACTS_API, ready: 'header.dds-ph' },
  { name: 'Projects', path: '/projects.html', api: PROJECTS_API, ready: 'header.dds-ph' },
  { name: 'Send an update', path: '/broadcasts.html', api: BROADCASTS_API, ready: 'header.dds-ph' },
  { name: 'Pipeline', path: '/pipeline.html', api: PIPELINE_98, ready: 'header.dds-ph' },
  { name: 'The record', path: `/crm.html?client=${RECORD_98_CLIENT}`, api: RECORD_98, ready: '#act-invoice' },
  { name: 'Inbox', path: '/inbox.html', api: INBOX_98, ready: 'header.dds-ph' },
  { name: 'Settings', path: '/settings.html', api: SETTINGS_98, ready: 'header.dds-ph' },
  { name: 'Sharing', path: '/sharing.html', api: SHARING_98, ready: 'header.dds-ph' },
  { name: 'Analytics', path: '/analytics.html', api: ANALYTICS_98, ready: 'header.dds-ph' },
];

test.describe('every control is a finger-sized target on a touch screen (builder item 98)', () => {
  for (const pg of PAGES) {
    test(`${pg.name}`, async ({ page }) => {
      test.skip(!test.info().project.use.hasTouch, 'touch screens only: a mouse keeps the compact desktop sizes');
      await pinClock(page, '2026-11-16T18:00:00Z');
      await installApp(page, { api: pg.api as never });
      await page.goto(pg.path);
      await expect(page.locator(pg.ready)).toBeVisible();
      await settled(page);
      const small = await smallTargets(page);
      expect(small, small.map((m) => `${m.el} "${m.text}" ${m.w}x${m.h} misses ${m.side}`).join('\n')).toEqual([]);
    });
  }

  test('the Add a customer box', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only');
    await pinClock(page, '2026-11-16T18:00:00Z');
    await installApp(page, { api: CUSTOMERS_API as never });
    await page.goto('/customers.html');
    await page.locator('#addCust').click();
    const box = page.locator('dialog[open]');
    await expect(box).toBeVisible();
    await settled(page);
    const small = await smallTargets(page, 'dialog[open]');
    expect(small, small.map((m) => `${m.el} "${m.text}" ${m.w}x${m.h} misses ${m.side}`).join('\n')).toEqual([]);
  });

  // Builder item 241 (PR 466) came in after this walk was written: a customer's steps card,
  // its Invite form and "lives somewhere else" field, the Delete customer box, and Delete
  // customer… in Customers' preview.
  const say = (small: Miss[]) => small.map((m) => `${m.el} "${m.text}" ${m.w}x${m.h} misses ${m.side}`).join('\n');
  test('a customer’s steps card, its Invite form and its other-host field', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only');
    await pinClock(page, '2026-11-16T18:00:00Z');
    await installApp(page, { api: PROFILE_241() as never });
    await page.goto(`/crm.html?client_id=${CID}`);
    await expect(page.locator('#custsteps .cs-row')).toBeVisible();
    await settled(page);
    let small = await smallTargets(page);
    expect(small, say(small)).toEqual([]);
    await page.getByRole('button', { name: 'Invite to their portal' }).click();
    await expect(page.getByRole('button', { name: 'Send the invite' })).toBeVisible();
    await settled(page);
    small = await smallTargets(page, '#custsteps');
    expect(small, say(small)).toEqual([]);
    await page.getByRole('button', { name: 'Their site lives somewhere else?' }).click();
    await expect(page.getByRole('button', { name: 'Watch it' })).toBeVisible();
    await settled(page);
    small = await smallTargets(page, '#custsteps');
    expect(small, say(small)).toEqual([]);
  });

  test('the Delete customer box', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only');
    await pinClock(page, '2026-11-16T18:00:00Z');
    await installApp(page, { api: PROFILE_241({ [`/sales/customers/${CID}`]: WITH_SITE }) as never });
    await page.goto(`/crm.html?client_id=${CID}`);
    await expect(page.locator('#custsteps .cs-row')).toBeVisible();
    await page.locator('#act-more').click();
    await page.getByRole('button', { name: 'Delete customer…' }).click();
    await expect(page.locator('#custDelDlg')).toBeVisible();
    await settled(page);
    const small = await smallTargets(page, '#custDelDlg');
    expect(small, say(small)).toEqual([]);
  });

  test('Delete customer… in Customers’ preview', async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touch screens only');
    await pinClock(page, '2026-11-16T18:00:00Z');
    await installApp(page, { api: CUSTOMERS_241 as never });
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'table'); } catch (_) { /* */ } });
    await page.goto('/customers.html');
    await page.getByRole('row', { name: /Preview Willow & Ash Bakery/ }).click();
    await expect(page.locator('#cprev').getByRole('button', { name: 'Delete customer…' })).toBeVisible();
    await settled(page);
    const small = await smallTargets(page, '#cprev');
    expect(small, say(small)).toEqual([]);
  });
});
