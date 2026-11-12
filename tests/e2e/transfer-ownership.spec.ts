import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// ── Transfer ownership: the page the emails open (builder list item 53) ──────
// The owner agrees to a request their studio started; the new owner accepts. The
// page reads GET /transfers (what is waiting on the signed-in person) and answers
// POST /transfers/:id/(agree|accept|decline). Nothing changes until Accept.

const ASKED_OWNER = { id: '11111111-1111-4111-8111-111111111111', business: 'Maple & Main Realty', step: 'agree', status: 'asked_owner', started_side: 'studio', studio: 'Bright Studio', owner_name: 'Sam Reyes', from_email: 'owner@example.com', to_email: 'ana@maple.example', keep_old: true, expires_at: '2026-11-25T00:00:00Z' };
const ASKED_NEW = { ...ASKED_OWNER, id: '22222222-2222-4222-8222-222222222222', step: 'accept', status: 'asked_new', from_email: 'sam@maple.example', to_email: 'owner@example.com' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('Transfer ownership page', () => {
  test('the owner sees who asks, to whom, what happens to them, and agrees', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: { '/transfers': { data: [ASKED_OWNER] } } });
    await page.goto('/transfer.html?id=' + ASKED_OWNER.id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your studio asks to hand Maple & Main Realty to ana@maple.example');
    await expect(page.locator('.brand')).toContainText('Bright Studio');
    await expect(page.locator('.hand')).toContainText('Sam Reyes');
    await expect(page.locator('.hand')).toContainText('ana@maple.example');
    await expect(page.locator('main')).toContainText('You stay on as Co-owner.');
    await expect(page.locator('main')).toContainText('Only you can agree, because you own Maple & Main Realty.');
    const agreed = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/transfers/${ASKED_OWNER.id}/agree`));
    await page.route(/\/presence\/transfers\/[0-9a-f-]+\/agree$/, (r) => r.fulfill(json({ data: { status: 'asked_new', emailed: true, message: 'Thanks. We’ve emailed ana@maple.example to accept. Nothing changes until they do.' } })));
    await page.getByRole('button', { name: 'Agree' }).click();
    await agreed;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanks, that’s agreed');
    await expect(page.locator('main')).toContainText('We’ve emailed ana@maple.example to accept.');
    expect(errors).toEqual([]);
  });

  test('the new owner accepts, and the site is theirs', async ({ page }) => {
    await installApp(page, { api: { '/transfers': { data: [ASKED_NEW] } } });
    await page.goto('/transfer.html?id=' + ASKED_NEW.id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sam Reyes wants you to own Maple & Main Realty');
    await expect(page.locator('main')).toContainText('Bright Studio keeps working on it as Website manager.');
    await expect(page.locator('main')).toContainText('Sam stays on as Co-owner until you say otherwise.');
    await expect(page.locator('main')).toContainText('Signed in as owner@example.com');
    await page.route(/\/presence\/transfers\/[0-9a-f-]+\/accept$/, (r) => r.fulfill(json({ data: { status: 'done', site_id: 's1', business: 'Maple & Main Realty', message: 'Maple & Main Realty is yours now.' } })));
    const accepted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/transfers/${ASKED_NEW.id}/accept`));
    await page.getByRole('button', { name: 'Accept and become the owner' }).click();
    await accepted;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maple & Main Realty is yours now');
    await expect(page.getByRole('link', { name: 'Open Maple & Main Realty' })).toHaveAttribute('href', '/portal.html');
  });

  test('a refusal says why, and the buttons stay usable', async ({ page }) => {
    await installApp(page, { api: { '/transfers': { data: [ASKED_NEW] } } });
    await page.route(/\/presence\/transfers\/[0-9a-f-]+\/accept$/, (r) => r.fulfill(json({ error: 'owns_another', message: 'You already own a business here, and one sign-in can own one. Ask for a Co-owner place instead: you can switch between both.' }, 409)));
    await page.goto('/transfer.html');
    await page.getByRole('button', { name: 'Accept and become the owner' }).click();
    await expect(page.getByRole('alert')).toContainText('Ask for a Co-owner place instead');
    await expect(page.getByRole('button', { name: 'Accept and become the owner' })).toBeEnabled();
  });

  test('saying no changes nothing, and says so', async ({ page }) => {
    await installApp(page, { api: { '/transfers': { data: [ASKED_OWNER] } } });
    await page.route(/\/presence\/transfers\/[0-9a-f-]+\/decline$/, (r) => r.fulfill(json({ data: { status: 'declined', message: 'Done. Nothing changes.' } })));
    await page.goto('/transfer.html');
    const said = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/transfers/${ASKED_OWNER.id}/decline`));
    await page.getByRole('button', { name: 'Say no' }).click();
    await said;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Done. Nothing changes.');
    await expect(page.locator('main')).toContainText('Your studio has been told.');
  });

  test('two waiting: ?id= picks one and the other is linked', async ({ page }) => {
    await installApp(page, { api: { '/transfers': { data: [ASKED_OWNER, { ...ASKED_NEW, business: 'Juniper Floral Co.' }] } } });
    await page.goto('/transfer.html?id=' + ASKED_NEW.id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sam Reyes wants you to own Juniper Floral Co.');
    await expect(page.locator('.also').getByRole('link', { name: 'Maple & Main Realty' })).toHaveAttribute('href', '/transfer.html?id=' + ASKED_OWNER.id);
  });

  test('nothing waiting says so plainly', async ({ page }) => {
    await installApp(page, { api: { '/transfers': { data: [] } } });
    await page.goto('/transfer.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing is waiting on you');
    await expect(page.locator('main')).toContainText('lapsed after 14 days');
  });

  test('signed out: a sign-in form that keeps the request in its link, and asks nothing of the server', async ({ page }) => {
    await installApp(page, { session: null });
    let asked = 0;
    page.on('request', (r) => { if (r.url().includes('/presence/transfers')) asked++; });
    await page.goto('/transfer.html?id=' + ASKED_OWNER.id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to answer');
    await page.getByLabel('Your email').fill('owner@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.locator('#sent')).toContainText('a sign-in link is on its way');
    expect(asked).toBe(0);
  });

  test('no serious or critical accessibility problems (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: { '/transfers': { data: [ASKED_NEW] } } });
    await page.goto('/transfer.html');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
});
