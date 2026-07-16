import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Today — the home surface. It must tell ONE story with the bell (Phase OS): the
// same notices + approvals appear here as "needs you" cards, plus Moments.
test.describe('Today', () => {
  test('renders needs-you cards (notices + approvals) above moments', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const todo = page.locator('.moment.todo');
    await expect(todo).toHaveCount(2); // 1 notice + 1 approval
    await expect(page.locator('.moment.todo').first()).toContainText('A quote request is waiting for a reply');
    await expect(page.locator('.moment.todo').first()).toHaveAttribute('href', '/leads.html');
    await expect(page.getByText('Protect your email')).toBeVisible();
    // the moment card + its dismiss affordance
    await expect(page.getByRole('heading', { name: 'Add your holiday hours' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();
  });

  test('the ONE health experience is the Business Health Coach (PT-2C)', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    // the coach line is secondary context now — it lives inside the collapsed
    // "More about your business" disclosure; open it first. At phone widths the
    // one-time page hint floats over it and auto-scroll parks it under the fixed
    // bottom bar — dismiss the hint and center it before clicking.
    await page.locator('.dds-hint').getByRole('button', { name: 'Got it' }).click();
    const summary = page.locator('details.more > summary');
    await summary.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await summary.click();
    await expect(page.getByText('One thing could help.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Take a look →' })).toHaveAttribute('href', '/leads.html');
  });

  test('the Customer Journey celebrates milestones, never a score', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    // the journey strip lives inside the collapsed "More about your business"
    // disclosure; open it first (same phone-width hint + fixed-bar dance as PT-2C).
    await page.locator('.dds-hint').getByRole('button', { name: 'Got it' }).click();
    const summary = page.locator('details.more > summary');
    await summary.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await summary.click();
    await expect(page.getByText('Your journey')).toBeVisible();
    // appears twice by design: the celebration line + the milestone row
    await expect(page.getByText('Your website went live for the first time.').first()).toBeVisible();
    await expect(page.getByText('Your presence began')).toBeVisible();
    // no numeric score anywhere in the journey card
    const journeyText = await page.locator('div', { hasText: 'Your journey' }).last().innerText();
    expect(journeyText).not.toMatch(/\b\d+\s*(\/|%|points|score|out of)/i);
  });

  test('attention is consistent — Today card count equals the bell badge', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('.moment.todo')).toHaveCount(2);
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
  });

  test('dismissing a moment removes its card', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const card = page.locator('article.moment', { hasText: 'Add your holiday hours' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
  });

  test('all-clear empty state (website edition) speaks website language', async ({ page }) => {
    await installApp(page, { api: {
      // attention_count must be 0 too — the page trusts the bell count and
      // renders a "things need you → Inbox" card instead of "all clear" otherwise.
      '/portal/context': { data: {
        site_role: 'business_owner', edition: 'presence',
        edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
        is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false,
        capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
        landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
        plan_key: 'presence', upsell: null,
      } },
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    await expect(page.getByText('All clear')).toBeVisible();
    await expect(page.getByText('Everything we watch looks good.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your website' })).toBeVisible();
  });

  test('CRM edition empty state speaks relationship language (PP-5)', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': { data: {
        site_role: 'business_owner', edition: 'monitor', edition_key: 'business_os_only', edition_name: 'Business OS',
        edition_features: ['business_moments', 'connected', 'ai', 'relationship', 'reports', 'client_portal'],
        is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['view_all'],
        landing: '/today.html', attention_count: 0,
        nav: [{ key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] }],
      } },
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    await expect(page.getByText('Everything’s quiet across your business.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Customers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your website' })).toHaveCount(0);
  });

  test('upgrade orientation card appears once, then dismisses (PP-6)', async ({ page }) => {
    // seed a PRIOR edition so studio_os reads as an upgrade. Guarded: init
    // scripts re-run on reload, and an unguarded seed would overwrite the
    // advanced marker and re-trigger the card — falsifying the reload assertion.
    await page.addInitScript(() => {
      if (!localStorage.getItem('dds-oriented')) localStorage.setItem('dds-oriented', JSON.stringify({ key: 'cms_only', feats: ['website', 'developer', 'forms', 'client_portal', 'reports'] }));
    });
    await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } }, '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.getByText('Welcome to Studio OS')).toBeVisible();
    await expect(page.getByText(/daily updates/)).toBeVisible(); // a gained feature, named (v1.0 outcome language)
    // #orientDone, not a bare name query: the page hint's dismiss button is
    // also accessibly named "Got it" (its visible text — WCAG 2.5.3).
    await page.locator('#orientDone').click();
    await expect(page.getByText('Welcome to Studio OS')).toHaveCount(0);
    // and it does not return on reload (localStorage was advanced)
    await page.reload();
    await expect(page.getByText('Welcome to Studio OS')).toHaveCount(0);
  });

  test('first sight of an edition orients silently (no false upgrade)', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } }, '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.getByText(/^Welcome to/)).toHaveCount(0);
  });
});
