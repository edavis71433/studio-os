import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// sign.html — the client's ONE page from proposal to deposit (benchmark 2026-10,
// item 5). The email's link lands here with a deal-bound `flow` token; the page
// walks Choose → Sign → Pay in a forced order: the proposal first, the agreement
// unlocks once it's accepted, the deposit once the agreement is signed. Done
// steps collapse above; the next step is open; the rest are locked.
//
// The page is PUBLIC: no session, no supabase-js — it fetches the presence
// function directly with the link's token, so the harness here mocks only that
// function (GET /sales/p/<token> + the two POSTs) and the page's real JS runs.

const TOKEN = 'Zmxvdw.abc123';
const STRIPE = 'https://pay.example.test/deposit-1';
const HASH = 'ab'.repeat(32);
const PROPOSAL = { id: 'p-1', title: 'Website build', line_items: [{ label: 'Design', qty: 1, unit_cents: 200000 }, { label: 'Build', qty: 1, unit_cents: 300000 }], subtotal_cents: 500000, currency: 'usd', terms: 'Half up front, the rest on launch.', status: 'sent', expired: false };
const AGREEMENT_OPEN = { id: 'k-1', title: 'Service agreement', body: 'A deposit of 50% of the project fee is due at signing.\nThe balance is due on launch.', content_hash: HASH, status: 'sent', signed_at: null, signer_name: null };
const AGREEMENT_LOCKED = { id: 'k-1', title: 'Service agreement', status: 'sent', locked: true };
const AGREEMENT_SIGNED = { ...AGREEMENT_OPEN, status: 'signed', signed_at: '2026-07-15T10:00:00.000Z', signer_name: 'Sam Rivera' };
const DEPOSIT_LOCKED = { amount_cents: 250000, status: 'open', paid_at: null, url: null };
const DEPOSIT_READY = { ...DEPOSIT_LOCKED, url: STRIPE };

type Flow = Record<string, unknown>;
const flow = (over: Flow = {}): { data: Flow } => ({ data: {
  kind: 'flow', brand: { name: 'Test Studio', accent: '#5b3fa0' }, deal: { id: 'd-1', title: 'Acme website' },
  proposal: PROPOSAL, contract: AGREEMENT_LOCKED, contract_pending: false, deposit: DEPOSIT_LOCKED, ...over,
} });

// the three states the page walks, as the server would answer them
const STATE = {
  sent: () => flow(),
  accepted: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: AGREEMENT_OPEN }),
  signed: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: AGREEMENT_SIGNED, deposit: DEPOSIT_READY }),
};

interface Served { posts: Array<{ path: string; body: Record<string, unknown> }> }
/** Mock the presence function around a tiny state machine: the GET answers the
 *  current state; a decide/sign POST advances it (unless `reply` overrides). */
async function serve(page: Page, opts: { start?: keyof typeof STATE; view?: () => unknown; viewStatus?: number; decide?: { status: number; body: unknown }; sign?: { status: number; body: unknown } } = {}): Promise<Served> {
  let state: keyof typeof STATE = opts.start || 'sent';
  const served: Served = { posts: [] };
  await page.route('**/functions/v1/presence/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const method = route.request().method();
    const reply = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method === 'GET' && path.startsWith('/sales/p/')) {
      if (opts.view) return reply(opts.viewStatus || 200, opts.view());
      return reply(200, STATE[state]());
    }
    if (method === 'POST') {
      served.posts.push({ path, body: JSON.parse(route.request().postData() || '{}') });
      if (/\/decide$/.test(path)) {
        if (opts.decide) return reply(opts.decide.status, opts.decide.body);
        const decision = served.posts[served.posts.length - 1].body.decision;
        if (decision === 'accepted') state = 'accepted';
        return reply(200, { data: { status: decision } });
      }
      if (/\/sign$/.test(path)) {
        if (opts.sign) return reply(opts.sign.status, opts.sign.body);
        state = 'signed';
        return reply(200, { data: { status: 'signed', pay_url: STRIPE, pay_amount_cents: 250000, copy_emailed: true } });
      }
    }
    return reply(404, { error: 'not_found' });
  });
  return served;
}

const steps = (page: Page) => page.locator('.steps li');
const open = (page: Page) => page.goto(`/sign.html?t=${TOKEN}`);

test.describe('sign.html — one page from proposal to deposit', () => {
  test('lands on Choose: the proposal is open with Accept, the agreement and deposit are locked and unreadable', async ({ page }) => {
    await serve(page);
    await open(page);
    await expect(page.locator('h1')).toHaveText('Acme website');
    await expect(page.getByText('Prepared by Test Studio')).toBeVisible();
    // the strip: three steps, the first is current, nothing done yet
    await expect(steps(page)).toHaveText(['1Choose — this step', '2Sign — not yet', '3Pay — not yet']);
    await expect(steps(page).nth(0)).toHaveAttribute('aria-current', 'step');
    await expect(steps(page).nth(0)).toHaveClass(/now/);
    await expect(steps(page).nth(1)).toHaveClass(/locked/);
    // the proposal, with its honest total and the one filled action
    await expect(page.locator('#step-choose table')).toContainText('Design');
    await expect(page.locator('#step-choose .total')).toContainText('$5,000.00');
    await expect(page.locator('#accept')).toBeVisible();
    await expect(page.locator('#decline')).toBeVisible();
    // locked steps say what unlocks them — and the agreement's text is NOT on the page
    await expect(page.locator('#step-sign')).toHaveClass(/locked/);
    await expect(page.locator('#step-sign')).toContainText('Unlocks once you accept the proposal above.');
    await expect(page.locator('#nm')).toHaveCount(0);
    await expect(page.getByText('due at signing')).toHaveCount(0);
    await expect(page.locator('#step-pay')).toHaveClass(/locked/);
    await expect(page.locator('#step-pay')).toContainText('Pay the $2,500.00 deposit');
    await expect(page.locator('#step-pay')).toContainText('Unlocks once you’ve signed.');
    await expect(page.locator('#pay')).toHaveCount(0);
  });

  test('Accept POSTs the decision with the link token; then Choose collapses and the agreement unlocks', async ({ page, isMobile }) => {
    const served = await serve(page);
    await open(page);
    await page.locator('#accept').click();
    // the collapsed step above, the open step below
    const chosen = page.locator('details#step-choose');
    await expect(chosen).toBeVisible();
    await expect(chosen.locator('summary')).toContainText('Proposal accepted — $5,000.00 total');
    await expect(chosen).not.toHaveAttribute('open', '');
    await expect(page.locator('#accept')).toHaveCount(0);
    expect(served.posts).toEqual([{ path: '/sales/proposals/p-1/decide', body: { token: TOKEN, decision: 'accepted' } }]);
    await expect(steps(page).nth(0)).toHaveClass(/done/);
    await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(steps(page).nth(2)).toHaveClass(/locked/);
    // the agreement is readable now, with the typed-name signature form + consent line
    await expect(page.locator('#step-sign')).not.toHaveClass(/locked/);
    await expect(page.locator('#step-sign .body')).toContainText('due at signing');
    await expect(page.locator('#sign')).toBeVisible();
    await expect(page.locator('#step-sign')).toContainText('Typing your name here counts as your signature.');
    if (!isMobile) await expect(page.locator('#nm')).toBeFocused();   // the next step gets the keyboard
    // the proposal is still there to re-read
    await chosen.locator('summary').click();
    await expect(chosen.locator('table')).toBeVisible();
    await expect(chosen.locator('.total')).toContainText('$5,000.00');
  });

  test('Sign POSTs the typed name + the presented hash; Pay unlocks with the Stripe link and the certificate shows', async ({ page }) => {
    const served = await serve(page, { start: 'accepted' });
    await open(page);
    await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#em').fill('sam@example.com');
    await page.locator('#sign').click();
    await expect(page.locator('#pay')).toBeVisible();
    expect(served.posts).toEqual([{ path: '/sales/contracts/k-1/sign', body: { token: TOKEN, signer_name: 'Sam Rivera', signer_email: 'sam@example.com', presented_hash: HASH } }]);
    // the celebration + the copy line (the server said it emailed one)
    await expect(page.getByRole('heading', { name: 'Signed — welcome aboard! 🎉' })).toBeVisible();
    await expect(page.getByText('A copy of your signed agreement is on its way to your email.')).toBeVisible();
    // Pay is now the open step: the real Stripe link, the amount in the label
    await expect(steps(page).nth(1)).toHaveClass(/done/);
    await expect(steps(page).nth(2)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#pay')).toHaveAttribute('href', STRIPE);
    await expect(page.locator('#pay')).toHaveText('Pay the $2,500.00 deposit →');
    await expect(page.locator('#step-pay')).toContainText('This page keeps the link — come back any time.');
    // the signed agreement collapsed above — opened on a fresh signature so the certificate is seen
    const signed = page.locator('details#step-sign');
    await expect(signed.locator('summary')).toContainText('Signed by Sam Rivera on');
    await expect(signed).toHaveAttribute('open', '');
    await expect(signed).toContainText('Signature certificate');
    await expect(signed.locator('.kv').filter({ hasText: 'Signed by' })).toContainText('Sam Rivera');
    await expect(signed.locator('.mono')).toHaveText(HASH);
    await expect(signed.locator('.body')).toContainText('due at signing');
    await expect(signed.getByRole('button', { name: 'Print / save a copy' })).toBeVisible();
  });

  test('an empty name is refused before any request goes out', async ({ page }) => {
    const served = await serve(page, { start: 'accepted' });
    await open(page);
    await page.locator('#sign').click();
    await expect(page.locator('#softErr')).toHaveText('Type your full name in the box above — that’s your signature.');
    expect(served.posts).toEqual([]);
    await expect(page.locator('#sign')).toBeEnabled();
  });

  test('a stale version (409) keeps the agreement on screen and swaps the action for "Load the latest version"', async ({ page }) => {
    await serve(page, { start: 'accepted', sign: { status: 409, body: { error: 'version_mismatch', message: 'This agreement was updated — please reload the latest version before signing.' } } });
    await open(page);
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#sign').click();
    await expect(page.locator('#softErr')).toContainText('reload the latest version');
    await expect(page.locator('#reloadBtn')).toBeVisible();
    await expect(page.locator('#sign')).toHaveCount(0);
    await expect(page.locator('#step-sign .body')).toContainText('due at signing');   // nothing lost
  });

  test('the server’s forced order is surfaced honestly (409 accept_first)', async ({ page }) => {
    await serve(page, { start: 'accepted', sign: { status: 409, body: { error: 'accept_first', message: 'Accept the proposal first — the agreement unlocks right after.' } } });
    await open(page);
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#sign').click();
    await expect(page.locator('#softErr')).toHaveText('Accept the proposal first — the agreement unlocks right after.');
    await expect(page.locator('#sign')).toBeEnabled();
  });

  test('Decline takes two deliberate taps, POSTs declined, and nothing unlocks', async ({ page }) => {
    const served = await serve(page);
    await open(page);
    const decline = page.locator('#decline');
    await decline.click();
    await expect(decline).toHaveText('Tap again to decline — this is final');
    expect(served.posts).toEqual([]);
    await page.route('**/functions/v1/presence/sales/p/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flow({ proposal: { ...PROPOSAL, status: 'declined' } })) }));
    await decline.click();
    await expect(page.getByText('You declined this proposal.')).toBeVisible();
    expect(served.posts).toEqual([{ path: '/sales/proposals/p-1/decide', body: { token: TOKEN, decision: 'declined' } }]);
    await expect(page.locator('#accept')).toHaveCount(0);
    await expect(page.locator('#step-sign')).toHaveClass(/locked/);
    await expect(page.locator('#step-pay')).toHaveClass(/locked/);
  });

  test('accepted but the agreement isn’t ready: the page says the studio is preparing it; Pay stays locked', async ({ page }) => {
    await serve(page, { view: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: null, contract_pending: true, deposit: null }) });
    await open(page);
    await expect(steps(page).nth(0)).toHaveClass(/done/);
    await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#step-sign')).toContainText('You’ve accepted — your studio has been told and is preparing the agreement. You’ll get an email when it’s ready to sign; nothing to do now.');
    await expect(page.locator('#nm')).toHaveCount(0);
    await expect(page.locator('#step-pay')).toHaveClass(/locked/);
    await expect(page.locator('#step-pay')).toContainText('Pay the deposit');
  });

  test('all done: accepted, signed, deposit paid — three done steps, the documents collapsed, the certificate kept', async ({ page }) => {
    await serve(page, { view: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: AGREEMENT_SIGNED, deposit: { amount_cents: 250000, status: 'paid', paid_at: '2026-07-16T10:00:00.000Z', url: null } }) });
    await open(page);
    await expect(steps(page)).toHaveText(['✓Choose — done', '✓Sign — done', '✓Pay — done']);
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
    await expect(page.locator('details#step-choose')).not.toHaveAttribute('open', '');
    await expect(page.locator('details#step-sign')).not.toHaveAttribute('open', '');   // a later visit: collapsed
    await expect(page.locator('#step-pay .ok')).toContainText('Deposit paid — thank you.');
    await expect(page.locator('#pay')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /welcome aboard/ })).toHaveCount(0);   // the celebration is for the moment, not forever
    await page.locator('details#step-sign summary').click();
    await expect(page.locator('details#step-sign')).toContainText('Signature certificate');
  });

  test('signed with no deposit on the deal says nothing to pay right now', async ({ page }) => {
    await serve(page, { view: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: AGREEMENT_SIGNED, deposit: null }) });
    await open(page);
    await expect(page.locator('#step-pay')).toContainText('Nothing to pay right now — your studio has been told you signed and will send an invoice when it’s time.');
    await expect(steps(page).nth(2)).toHaveAttribute('aria-current', 'step');
  });

  test('a deal with no proposal starts at the agreement — two steps, Sign current', async ({ page }) => {
    await serve(page, { view: () => flow({ proposal: null, contract: AGREEMENT_OPEN }) });
    await open(page);
    await expect(steps(page)).toHaveCount(2);
    await expect(steps(page).nth(0)).toHaveText('1Sign — this step');
    await expect(page.locator('#step-choose')).toHaveCount(0);
    await expect(page.locator('#sign')).toBeVisible();
  });

  test('an expired proposal in the flow offers no Accept and says to ask for an updated one', async ({ page }) => {
    await serve(page, { view: () => flow({ proposal: { ...PROPOSAL, expired: true } }) });
    await open(page);
    await expect(page.locator('#accept')).toHaveCount(0);
    await expect(page.locator('#step-choose')).toContainText('This proposal has expired — ask your studio to send an updated one. Nothing is lost.');
    await expect(page.locator('#step-sign')).toHaveClass(/locked/);
  });

  test('a dead link (403) shows the honest dead-end, not a broken page', async ({ page }) => {
    await serve(page, { view: () => ({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }), viewStatus: 403 });
    await open(page);
    await expect(page.locator('h1')).toHaveText('This link isn’t working');
    await expect(page.getByText('This link isn’t valid or has expired.')).toBeVisible();
    await expect(page.locator('.steps')).toHaveCount(0);
  });

  test('an old per-document link (a proposal token) still renders the single proposal exactly as before', async ({ page }) => {
    const served = await serve(page, { view: () => ({ data: { kind: 'proposal', brand: { name: 'Test Studio', accent: '#5b3fa0' }, expired: false, ...PROPOSAL } }) });
    await open(page);
    await expect(page.locator('h1')).toHaveText('Website build');
    await expect(page.locator('.steps')).toHaveCount(0);
    await expect(page.locator('#step-sign')).toHaveCount(0);
    await expect(page.locator('#accept')).toBeVisible();
    await page.locator('#accept').click();
    await expect(page.locator('h1')).toHaveText('Accepted — thank you!');
    expect(served.posts).toEqual([{ path: '/sales/proposals/p-1/decide', body: { token: TOKEN, decision: 'accepted' } }]);
  });

  test('an old per-document link (a contract token) still signs and hands over the deposit link', async ({ page }) => {
    await serve(page, { view: () => ({ data: { kind: 'contract', brand: { name: 'Test Studio', accent: '#5b3fa0' }, ...AGREEMENT_OPEN } }) });
    await open(page);
    await expect(page.locator('.steps')).toHaveCount(0);
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#sign').click();
    await expect(page.locator('.paybtn')).toHaveAttribute('href', STRIPE);
    await expect(page.locator('.cert')).toContainText('Signature certificate');
  });

  test('phone width: the strip and the proposal fit — no horizontal page scroll', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    await serve(page);
    await open(page);
    await expect(page.locator('#accept')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  test('no serious/critical axe violations at each of the three steps', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    for (const start of ['sent', 'accepted', 'signed'] as const) {
      await serve(page, { start });
      await open(page);
      await expect(page.locator('.steps')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${v.id} (${v.nodes.length})`), start).toEqual([]);
      await page.unroute('**/functions/v1/presence/**');
    }
  });
});
