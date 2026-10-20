import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Scheduling lives in ONE place: the publish page's "Publish later" ─────────
// Oct 2026 workflow audit, change 3. schedule.html is retired (it forwards to
// /presence.html#schedule); the ritual's schedule block does everything it did —
// pick a time, an optional note, see and cancel what's scheduled. The contract
// underneath is unchanged:
//   GET  /schedule               → { data: { scheduled: [row…] } }
//   POST /schedule               ← { scheduled_for: ISO, kind: 'publish', note }
//   POST /schedule/:id/cancel

const CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} };
const PRESENCE = {
  '/portal/context': CTX,
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/settings': { data: {} }, '/notes': { data: [] },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.' } },
  '/changes': { data: { count: 2, first_publish: false, changes: [{ section: 'business', sentence: 'Saturday hours change.' }, { section: 'about', sentence: 'A new tagline.' }], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, updated_at: null, updated_by: null } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/moments': { data: [] },
  '/commerce/first-run': { data: { dismissed: true } },
};
const ONE = { data: { scheduled: [{ id: 'sc-1', kind: 'publish', scheduled_for: '2026-12-24T18:00:00Z', summary: 'Holiday hours' }] } };

test.describe('Scheduling — one place, inside Publish', () => {
  test('#schedule opens the publish page on its schedule block, and "Schedule it" is the one filled button', async ({ page }) => {
    await installApp(page, { api: PRESENCE });
    await page.goto('/presence.html#schedule');
    const rit = page.locator('#ritualWrap');
    await expect(rit).toHaveClass(/\bon\b/);
    await expect(rit.getByLabel('Publish these changes at')).toBeVisible();
    await expect(rit.getByLabel('A note for yourself (optional)')).toBeVisible();
    // the job on screen is scheduling: publish-now steps back, Schedule it is filled
    await expect(rit.locator('#ritActions .pubbtn')).toHaveClass(/\bquiet\b/);
    await expect.poll(() => rit.getByRole('button', { name: 'Schedule it' }).evaluate((b) => getComputedStyle(b).backgroundColor)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // focus leaving the panel for something else puts publish-now back as the filled button
    await rit.getByRole('button', { name: /Not yet/ }).focus();
    await expect(rit.locator('#ritActions .pubbtn')).not.toHaveClass(/\bquiet\b/);
  });

  // Oct 2026 audit, gap 1: from the menu, Website → Publish → Schedule it is three
  // clicks. The panel is on the page the moment the ritual opens; it rests
  // (Schedule it outlined, publish-now filled) until it holds focus.
  test('the publish page opens with the schedule panel already on it — resting until the date field has focus', async ({ page }) => {
    await installApp(page, { api: PRESENCE });
    await page.goto('/presence.html#publish');
    const rit = page.locator('#ritualWrap');
    await expect(rit).toHaveClass(/\bon\b/);
    const date = rit.getByLabel('Publish these changes at');
    await expect(date).toBeVisible();   // no "Publish later" click in between
    const go = rit.getByRole('button', { name: 'Schedule it' });
    const transparent = /rgba\(0, 0, 0, 0\)|transparent/;
    // resting: publish-now is the one filled button, Schedule it is outlined
    await expect(rit.locator('#ritActions .pubbtn')).not.toHaveClass(/\bquiet\b/);
    expect(await go.evaluate((b) => getComputedStyle(b).backgroundColor)).toMatch(transparent);
    // armed: the panel holds focus → Schedule it is filled, publish-now steps back
    // (a click, not focus(): WebKit's datetime field does not take programmatic focus)
    await date.click();
    await expect(rit.locator('#ritActions .pubbtn')).toHaveClass(/\bquiet\b/);
    await expect.poll(() => go.evaluate((b) => getComputedStyle(b).backgroundColor)).not.toMatch(transparent);
    // …and the third click schedules — no extra step between the menu and the POST
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/schedule$/.test(new URL(r.url()).pathname));
    await go.click();
    expect((await post).postDataJSON().kind).toBe('publish');
  });

  test('Schedule it POSTs the moment, kind publish and the note', async ({ page }) => {
    await installApp(page, { api: PRESENCE });
    await page.goto('/presence.html#schedule');
    const rit = page.locator('#ritualWrap');
    await rit.getByLabel('A note for yourself (optional)').fill('Holiday hours');
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/schedule$/.test(new URL(r.url()).pathname));
    await rit.getByRole('button', { name: 'Schedule it' }).click();
    const body = (await post).postDataJSON();
    expect(body.kind).toBe('publish');
    expect(body.note).toBe('Holiday hours');
    expect(new Date(body.scheduled_for).getTime()).toBeGreaterThan(Date.now());
  });

  test('what is already scheduled is listed with its own Cancel', async ({ page }) => {
    await installApp(page, { api: { ...PRESENCE, '/schedule': ONE } });
    await page.goto('/presence.html#publish');
    const rit = page.locator('#ritualWrap');
    await expect(rit.getByText('Holiday hours')).toBeVisible();
    const cancel = page.waitForRequest((r) => r.method() === 'POST' && /\/schedule\/sc-1\/cancel$/.test(new URL(r.url()).pathname));
    await rit.getByRole('button', { name: 'Cancel' }).click();
    await cancel;
  });

  test('the overview\'s "Schedule it for later" opens the same block', async ({ page }) => {
    await installApp(page, { api: PRESENCE });
    await page.goto('/presence.html');
    await page.getByRole('link', { name: 'Schedule it for later' }).click();
    await expect(page.locator('#ritualWrap').getByLabel('Publish these changes at')).toBeVisible();
  });

  test('the retired Scheduled page forwards to the schedule block, keeping the client scope', async ({ page }) => {
    await installApp(page, { api: PRESENCE });
    await page.goto('/schedule.html?client=marlows');
    await expect(page).toHaveURL(/\/presence\.html\?client=marlows#schedule$/);
  });
});
