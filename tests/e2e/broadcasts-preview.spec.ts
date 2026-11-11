import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Bug hunt C (Nov 10 2026), Send an update.
// C1: "Send now" sends the SAVED draft, so it may only be pressed under a preview of
//     what is in the boxes. Once the subject or message changes after Preview, the card
//     says it is out of date and offers Preview again in place of Send.
// C6: a dropped connection used to leave Preview (and every other button) dead until
//     the page was reloaded, and Send stuck on "Sending…". It now says so, and the
//     buttons come back.

const D_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SEGS = { data: { segments: [
  { key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 3 },
] } };
const DETAIL = (subject: string) => ({ data: {
  broadcast: { id: D_ID, subject, body: 'Hi', audience: 'contacts', status: 'draft', scheduled_at: null },
  audience_label: 'All contacts', recipient_count: 3, suppressed_count: 0,
  preview_subject: subject, preview_html: `<html><body><p>${subject}</p></body></html>`,
} });
const API = { '/broadcasts/segments': SEGS, '/broadcasts': { data: { broadcasts: [] } }, '/identity': { data: { business_name: 'Brightline Studio' } } };

// the draft: POST makes it, PATCH saves it, GET reads it back (with the subject last saved)
async function drafts(page: Page) {
  const saved: Array<{ method: string; body: { subject?: string; body?: string } }> = [];
  let subject = '';
  await page.route((u) => /\/presence\/broadcasts(\/[0-9a-f-]{36})?$/.test(u.pathname), async (route) => {
    const req = route.request(), m = req.method();
    if (m === 'POST' || m === 'PATCH') {
      const b = req.postDataJSON(); saved.push({ method: m, body: b }); subject = b.subject;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: D_ID, subject: b.subject, body: b.body, audience: b.audience } }) });
    }
    if (/[0-9a-f-]{36}$/.test(new URL(req.url()).pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL(subject)) });
    return route.fallback();
  });
  return saved;
}
const write = async (page: Page, subject: string, body: string) => { await page.locator('#subj').fill(subject); await page.locator('#bodytx').fill(body); };

test.describe('Send an update — the preview is what goes out (bug hunt C1)', () => {
  test('a change after Preview makes the card out of date: no Send until it is previewed again', async ({ page }) => {
    await installApp(page, { api: API });
    const saved = await drafts(page);
    await page.goto('/broadcasts.html');
    await write(page, 'Spring hours', 'We open at 9 from Monday.');
    await page.locator('#preview').click();
    await expect(page.locator('#stage')).toContainText('This is exactly what lands in their inbox.');
    await expect(page.locator('#send')).toHaveText('Send now');
    // fix a typo in the message above the card
    await page.locator('#bodytx').fill('We open at 8 from Monday.');
    await expect(page.locator('#pvStale')).toContainText('You changed the message after this preview, so it’s out of date.');
    await expect(page.locator('#send')).toHaveCount(0);
    await expect(page.locator('#bodytx')).toBeFocused();   // the typing carries on where it was
    // Preview again saves the fix and shows it
    await page.locator('#pvAgain').click();
    await expect(page.locator('#send')).toHaveText('Send now');
    expect(saved.at(-1)).toMatchObject({ method: 'PATCH', body: { body: 'We open at 8 from Monday.' } });
  });

  test('the subject counts too, and so does + First name; Close puts the card away', async ({ page }) => {
    await installApp(page, { api: API });
    await drafts(page);
    await page.goto('/broadcasts.html');
    await write(page, 'Spring hours', 'Hello');
    await page.locator('#preview').click();
    await expect(page.locator('#send')).toBeVisible();
    await page.locator('#subj').fill('Spring hours!');
    await expect(page.locator('#pvStale')).toBeVisible();
    await page.locator('#pvAgain').click();
    await expect(page.locator('#send')).toBeVisible();
    await page.locator('#bodytx').click();
    await page.locator('[data-var="{{first_name}}"]').click();
    await expect(page.locator('#pvStale')).toBeVisible();
    await page.locator('#pvClose').click();
    await expect(page.locator('#stage')).toBeEmpty();
    await expect(page.locator('#subj')).toBeFocused();
  });

  test('nothing changed, nothing out of date: Send me a test leaves a current preview alone', async ({ page }) => {
    await installApp(page, { api: { ...API, [`/broadcasts/${D_ID}/test`]: { data: { to: 'owner@example.com' } } } });
    await drafts(page);
    await page.goto('/broadcasts.html');
    await write(page, 'Spring hours', 'Hello');
    await page.locator('#preview').click();
    await expect(page.locator('#send')).toBeVisible();
    await page.locator('#sendTest').click();
    await expect(page.locator('.dds-toast', { hasText: 'Test sent to owner@example.com' })).toBeVisible();
    await expect(page.locator('#send')).toBeVisible();
    await expect(page.locator('#pvStale')).toHaveCount(0);
  });

  test('typed while the preview was being built: the card comes up out of date', async ({ page }) => {
    await installApp(page, { api: API });
    await drafts(page);
    let release!: () => void; const held = new Promise<void>((r) => { release = r; });
    await page.route((u) => new RegExp(`/presence/broadcasts/${D_ID}$`).test(u.pathname), async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await held;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL('Spring hours')) });
    });
    await page.goto('/broadcasts.html');
    await write(page, 'Spring hours', 'Hello');
    await page.locator('#preview').click();
    await page.locator('#bodytx').fill('Hello again');
    release();
    await expect(page.locator('#pvStale')).toBeVisible();
    await expect(page.locator('#send')).toHaveCount(0);
  });
});

test.describe('Send an update — a dropped connection (bug hunt C6)', () => {
  test('Preview says so, and Preview, Send me a test and the rest still work once it is back', async ({ page }) => {
    await installApp(page, { api: { ...API, [`/broadcasts/${D_ID}/test`]: { data: {} } } });
    await drafts(page);
    let offline = true;
    await page.route((u) => /\/presence\/broadcasts$/.test(u.pathname), (route) => (offline && route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback()));
    await page.goto('/broadcasts.html');
    await write(page, 'Spring hours', 'Hello');
    await page.locator('#preview').click();
    await expect(page.locator('.dds-toast', { hasText: 'check your connection' })).toBeVisible();
    await expect(page.locator('#stage')).toBeEmpty();
    offline = false;
    await page.locator('#sendTest').click();
    await expect(page.locator('.dds-toast', { hasText: 'Test sent' })).toBeVisible();
    await page.locator('#preview').click();
    await expect(page.locator('#send')).toHaveText('Send now');
  });

  test('Send now says it can’t tell whether it went, and gives the button back', async ({ page }) => {
    await installApp(page, { api: API });
    await drafts(page);
    await page.route((u) => u.pathname.endsWith(`/broadcasts/${D_ID}/send`), (route) => route.abort('internetdisconnected'));
    await page.goto('/broadcasts.html');
    await write(page, 'Spring hours', 'Hello');
    await page.locator('#preview').click();
    await page.locator('#send').click();
    await page.locator('dialog[open] button', { hasText: 'Send now' }).click();
    await expect(page.locator('.dds-toast', { hasText: 'we can’t tell whether it went' })).toBeVisible();
    await expect(page.locator('#send')).toBeEnabled();
    await expect(page.locator('#send')).toHaveText('Send now');
  });
});
