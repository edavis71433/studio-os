import { test, expect, type Page, type Route } from '@playwright/test';
import { pressButton } from './helpers/app';

// ── card.html: where a retainer email's "Update your card" link lands (sales item 129) ──
// The Stripe review (Nov 15 2026, finding 3) found a client whose retainer card failed had
// no way to put in a new one. The studio's Email the card link sends a link that lasts 30
// days; this page asks the server for a fresh Stripe page and goes there, and Stripe sends
// the client back here saying whether a card was saved. The server and Stripe are pretend:
// every call this page makes is answered here, and anything else fails the test.

const STRIPE_PAGE = 'https://billing.stripe.com/p/session/test_e2e';
const STUDIO = { name: 'Test Studio', accent: '#2f6a4a' };

async function serve(page: Page, answers: Array<{ status: number; body: unknown }>): Promise<string[]> {
  const sent: string[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (path !== '/retainer-card' || route.request().method() !== 'POST') {
      expect.soft(`${route.request().method()} ${path}`, 'card.html called the server for something this test did not plan').toBe('POST /retainer-card');
      return route.fulfill({ status: 501, contentType: 'application/json', body: '{}' });
    }
    sent.push(String((route.request().postDataJSON() || {}).token || ''));
    const a = answers[Math.min(sent.length - 1, answers.length - 1)];
    return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
  });
  await page.route('https://billing.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe</title><h1>Update your payment method</h1>' }));
  return sent;
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe('card.html — the emailed Update your card link', () => {
  test('opens Stripe’s own page for a new card, with the link’s token', async ({ page }) => {
    const sent = await serve(page, [{ status: 200, body: { data: { url: STRIPE_PAGE, studio: STUDIO } } }]);
    await page.goto('/card.html?t=card-token-1');
    await expect(page).toHaveURL(STRIPE_PAGE);
    expect(sent).toEqual(['card-token-1']);
  });

  test('a link past its 30 days says so, and whom to ask, in the studio’s colours', async ({ page }) => {
    const sent = await serve(page, [{ status: 410, body: { error: 'expired', message: 'This link has run out. Ask Test Studio to send a new one.', studio: STUDIO } }]);
    await page.goto('/card.html?t=old-token');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link has run out');
    await expect(page.locator('#p')).toHaveText('This link has run out. Ask Test Studio to send a new one.');
    await expect(page.locator('#studio')).toContainText('Test Studio');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();   // trying again can't help
    await expect(page).toHaveTitle('This link has run out | Test Studio');
    expect(sent).toHaveLength(1);
    await noOverflow(page);
  });

  test('a retainer that ended says there’s no card to change', async ({ page }) => {
    await serve(page, [{ status: 409, body: { error: 'not_live', message: 'This retainer has ended, so there’s no card to change. Ask Test Studio if that’s a surprise.', studio: STUDIO } }]);
    await page.goto('/card.html?t=ended-token');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('There’s no card to change');
    await expect(page.locator('#p')).toContainText('This retainer has ended');
  });

  test('Stripe’s page not opening offers Try again, which works the second time', async ({ page }) => {
    const sent = await serve(page, [
      { status: 502, body: { error: 'card_page_failed', message: 'We couldn’t open Stripe’s card page just now. Please try again in a minute.', studio: STUDIO } },
      { status: 200, body: { data: { url: STRIPE_PAGE, studio: STUDIO } } },
    ]);
    await page.goto('/card.html?t=card-token-2');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stripe’s page didn’t open');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    const again = page.getByRole('button', { name: 'Try again' });
    await expect(again).toBeVisible();
    const box = await again.boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);   // a finger-sized button
    await pressButton(again);
    await expect(page).toHaveURL(STRIPE_PAGE);
    expect(sent).toEqual(['card-token-2', 'card-token-2']);
  });

  test('no token at all asks the server nothing and says the link isn’t right', async ({ page }) => {
    const sent = await serve(page, []);
    await page.goto('/card.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link isn’t right');
    expect(sent).toHaveLength(0);
  });

  test('back from Stripe with a new card: saved, nothing else to do', async ({ page }) => {
    const sent = await serve(page, []);
    await page.goto('/card.html?done=1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your new card is saved');
    await expect(page.locator('#p')).toContainText('Stripe uses it for your next charge.');
    await expect(page.locator('#card')).toHaveClass(/\bgood\b/);
    expect(sent).toHaveLength(0);
    await noOverflow(page);
  });

  test('back from Stripe without saving: nothing changed, and the link still works', async ({ page }) => {
    const sent = await serve(page, []);
    await page.goto('/card.html?left=1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your card wasn’t changed');
    await expect(page.locator('#p')).toContainText('works for 30 days');
    expect(sent).toHaveLength(0);
  });
});
