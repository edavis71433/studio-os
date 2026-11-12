import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// sign.html — the client's ONE page from proposal to deposit (benchmark 2026-10,
// item 5). The email's link lands here with a deal-bound `flow` token; the page
// walks Choose → Sign → Pay in a forced order: the proposal first, the agreement
// unlocks once it's accepted, the deposit once the agreement is signed. Done
// steps fold away below the open one; the steps still to come wait in the strip.
// Sales items 88 and 106 (drawn in Figma, page 257:4330): the proposal answered
// with a question or a reason, the agreement as a document signed by both sides,
// and a proposal paid in parts.
//
// The page is PUBLIC: no session, no supabase-js — it fetches the presence
// function directly with the link's token, so the harness here mocks only that
// function (GET /sales/p/<token> + the POSTs) and the page's real JS runs.

const TOKEN = 'Zmxvdw.abc123';
const STRIPE = 'https://pay.example.test/deposit-1';
const PDF = 'https://example.test/functions/v1/presence/sales/doc/abc?format=pdf';
const HASH = 'ab'.repeat(32);
const PROPOSAL = { id: 'p-1', title: 'Website build', line_items: [{ label: 'Design', qty: 1, unit_cents: 200000 }, { label: 'Build', qty: 1, unit_cents: 300000 }], subtotal_cents: 500000, currency: 'usd', terms: 'Half up front, the rest on launch.', status: 'sent', expired: false };
const AGREEMENT_OPEN = { id: 'k-1', title: 'Service agreement', body: 'A deposit of 50% of the project fee is due at signing.\nThe balance is due on launch.', content_hash: HASH, status: 'sent', signed_at: null, signer_name: null };
const AGREEMENT_LOCKED = { id: 'k-1', title: 'Service agreement', status: 'sent', locked: true };
const AGREEMENT_SIGNED = { ...AGREEMENT_OPEN, status: 'signed', signed_at: '2026-07-15T10:00:00.000Z', signer_name: 'Sam Rivera' };
const DEPOSIT_LOCKED = { amount_cents: 250000, status: 'open', paid_at: null, url: null };
const DEPOSIT_READY = { ...DEPOSIT_LOCKED, url: STRIPE };
// sales item 106: the parts as the server lays them out (lib/proposal_schedule.ts scheduleView)
const PARTS = [
  { n: 1, of: 3, pct: 34, amount_cents: 170000, when: 'sign', words: 'When you sign the agreement', date: null, days: null },
  { n: 2, of: 3, pct: 33, amount_cents: 165000, when: 'date', words: 'Due Dec 15, 2026', date: '2026-12-15', days: null },
  { n: 3, of: 3, pct: 33, amount_cents: 165000, when: 'done', words: 'Due when the work is done', date: null, days: null },
];
// sales item 88: the agreement as the studio writes it, who signs for the studio, who it is for
const AGREEMENT_DOC = { ...AGREEMENT_OPEN, body: 'PROJECT AGREEMENT\n\n1. SCOPE OF WORK\nThe studio designs and builds the pages in the proposal.\n\n2. PAYMENT TERMS\n(a) $1,700 when this agreement is signed.\n(b) $1,650 by Dec 15, 2026.\n\n3. REVISIONS\nTwo rounds of changes per page.' };
const SIGNER = { name: 'Alex Rivera', title: 'Owner', business: 'Test Studio' };
const CLIENT = { name: 'Sam Rivera', business: 'Corner Café' };

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
async function serve(page: Page, opts: { start?: keyof typeof STATE; view?: () => unknown; viewStatus?: number; decide?: { status: number; body: unknown }; sign?: { status: number; body: unknown }; ask?: { status: number; body: unknown } } = {}): Promise<Served> {
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
      if (path === '/sales/ask') return opts.ask ? reply(opts.ask.status, opts.ask.body) : reply(200, { data: { sent: true } });
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
    await expect(page.locator('#step-choose .total')).toContainText('$5,000');
    await expect(page.locator('#accept')).toBeVisible();
    await expect(page.locator('#decline')).toBeVisible();
    // what comes next is said beside the answer — and the agreement's text is NOT on the page
    await expect(page.locator('#step-choose .side')).toContainText('A $2,500 deposit is due when you sign the agreement.');
    await expect(page.locator('#step-choose .side')).toContainText('Accepting opens the agreement to sign, right here.');
    await expect(page.locator('#step-sign')).toHaveCount(0);
    await expect(page.locator('#nm')).toHaveCount(0);
    await expect(page.getByText('due at signing')).toHaveCount(0);
    await expect(page.locator('#step-pay')).toHaveCount(0);
    await expect(page.locator('#pay')).toHaveCount(0);
  });

  test('Accept POSTs the decision with the link token; then Choose folds away and the agreement unlocks', async ({ page, isMobile }) => {
    const served = await serve(page);
    await open(page);
    await page.locator('#accept').click();
    // the open step, and the folded one below it
    const chosen = page.locator('details#step-choose');
    await expect(chosen).toBeVisible();
    await expect(chosen.locator('summary')).toContainText('Proposal accepted — $5,000 total');
    await expect(chosen).not.toHaveAttribute('open', '');
    await expect(page.locator('#accept')).toHaveCount(0);
    expect(served.posts).toEqual([{ path: '/sales/proposals/p-1/decide', body: { token: TOKEN, decision: 'accepted' } }]);
    await expect(steps(page).nth(0)).toHaveClass(/done/);
    await expect(steps(page).nth(0)).toHaveText('✓Chosen — done');
    await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(steps(page).nth(2)).toHaveClass(/locked/);
    // the agreement is readable now, with the typed-name signature form + consent line
    await expect(page.locator('h1')).toHaveText('Agreement · Acme website');
    await expect(page.locator('#step-sign .body')).toContainText('due at signing');
    await expect(page.locator('#sign')).toBeVisible();
    await expect(page.locator('#step-sign')).toContainText('Typing your name here counts as your signature.');
    if (!isMobile) await expect(page.locator('#nm')).toBeFocused();   // the next step gets the keyboard
    // the proposal is still there to re-read
    await chosen.locator('summary').click();
    await expect(chosen.locator('table')).toBeVisible();
    await expect(chosen.locator('.total')).toContainText('$5,000');
  });

  test('Sign POSTs the typed name + the presented hash; the news, the signature and the Pay step follow', async ({ page }) => {
    const served = await serve(page, { start: 'accepted' });
    await open(page);
    await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await page.locator('#nm').fill('Sam Rivera');
    await expect(page.locator('#ink')).toHaveText('Sam Rivera');   // the signature, as they type it
    await page.locator('#em').fill('sam@example.com');
    await page.locator('#sign').click();
    await expect(page.locator('#pay')).toBeVisible();
    expect(served.posts).toEqual([{ path: '/sales/contracts/k-1/sign', body: { token: TOKEN, signer_name: 'Sam Rivera', signer_email: 'sam@example.com', presented_hash: HASH } }]);
    // the news + the copy line (the server said it emailed one)
    await expect(page.getByRole('heading', { name: 'Signed on Jul 15, 2026' })).toBeVisible();
    await expect(page.getByText('Your signed copy is on its way to your email, with the PDF attached.')).toBeVisible();
    await expect(page.locator('.sigcard')).toContainText('Sam Rivera');
    // Pay is now the open step: the real Stripe link, the amount in the label
    await expect(steps(page).nth(1)).toHaveClass(/done/);
    await expect(steps(page).nth(2)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#pay')).toHaveAttribute('href', STRIPE);
    await expect(page.locator('#pay')).toHaveText('Pay $2,500 securely');
    await expect(page.locator('#step-pay')).toContainText('This page keeps the link — come back any time.');
    // the signed agreement folded below, with its certificate for the record
    const signed = page.locator('details#step-sign');
    await expect(signed.locator('summary')).toContainText('Service agreement, signed Jul 15, 2026');
    await expect(signed).not.toHaveAttribute('open', '');
    await signed.locator('summary').click();
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

  test('sales item 88: a name without an email is refused before any request goes out', async ({ page }) => {
    const served = await serve(page, { start: 'accepted' });
    await open(page);
    await expect(page.locator('label[for="em"]')).toHaveText('Your email, for your signed copy');
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#sign').click();
    await expect(page.locator('#softErr')).toHaveText('Type your email too, so your signed copy can reach you.');
    await expect(page.locator('#em')).toBeFocused();
    expect(served.posts).toEqual([]);
  });

  test('a stale version (409) keeps the agreement on screen and swaps the action for "Load the latest version"', async ({ page }) => {
    await serve(page, { start: 'accepted', sign: { status: 409, body: { error: 'version_mismatch', message: 'This agreement was updated — please reload the latest version before signing.' } } });
    await open(page);
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#em').fill('sam@example.com');   // sales item 88: the signer's email is needed
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
    await page.locator('#em').fill('sam@example.com');   // sales item 88: the signer's email is needed
    await page.locator('#sign').click();
    await expect(page.locator('#softErr')).toHaveText('Accept the proposal first — the agreement unlocks right after.');
    await expect(page.locator('#sign')).toBeEnabled();
  });

  test('sales item 88: Decline opens its own sheet; Keep it open sends nothing, a reason and a note go with the decline', async ({ page }) => {
    const served = await serve(page);
    await open(page);
    await page.locator('#decline').click();
    const sheet = page.getByRole('dialog', { name: 'Before you decline' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('What would make this a yes? Optional, and it only goes to Test Studio.');
    await expect(sheet.locator('.chip')).toHaveText(['The price', 'The timing', 'What’s included', 'We went another way']);
    await sheet.getByRole('button', { name: 'Keep it open' }).click();
    await expect(sheet).toHaveCount(0);
    expect(served.posts).toEqual([]);
    await expect(page.locator('#accept')).toBeVisible();
    // a reason is one tap; a second tap takes it back
    await page.locator('#decline').click();
    const price = sheet.getByRole('button', { name: 'The price' }), timing = sheet.getByRole('button', { name: 'The timing' });
    await price.click();
    await expect(price).toHaveAttribute('aria-pressed', 'true');
    await timing.click();
    await expect(price).toHaveAttribute('aria-pressed', 'false');
    await expect(timing).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByLabel('A note for Test Studio').fill('Spring would work');
    await page.route('**/functions/v1/presence/sales/p/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flow({ proposal: { ...PROPOSAL, status: 'declined' } })) }));
    await sheet.getByRole('button', { name: 'Decline the proposal' }).click();
    await expect(page.getByText('You declined this proposal.')).toBeVisible();
    expect(served.posts).toEqual([{ path: '/sales/proposals/p-1/decide', body: { token: TOKEN, decision: 'declined', reason: 'timing', note: 'Spring would work' } }]);
    await expect(page.locator('#accept')).toHaveCount(0);
    await expect(page.locator('#nm')).toHaveCount(0);
    await expect(steps(page).nth(1)).toHaveClass(/locked/);
  });

  test('a decline with no reason and no note sends the decision alone', async ({ page }) => {
    const served = await serve(page);
    await open(page);
    await page.locator('#decline').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Decline the proposal' }).click();
    await expect.poll(() => served.posts).toEqual([{ path: '/sales/proposals/p-1/decide', body: { token: TOKEN, decision: 'declined' } }]);
  });

  test('accepted but the agreement isn’t ready: the page says the studio is preparing it; Pay stays waiting', async ({ page }) => {
    await serve(page, { view: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: null, contract_pending: true, deposit: null }) });
    await open(page);
    await expect(steps(page).nth(0)).toHaveClass(/done/);
    await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#step-sign')).toContainText('You’ve accepted — your studio has been told and is preparing the agreement. You’ll get an email when it’s ready to sign; nothing to do now.');
    await expect(page.locator('#nm')).toHaveCount(0);
    await expect(steps(page).nth(2)).toHaveClass(/locked/);
    await expect(page.locator('#pay')).toHaveCount(0);
  });

  test('between versions (the studio revised the proposal and hasn’t sent v2): Choose waits, Sign stays locked, nothing is readable', async ({ page }) => {
    const served = await serve(page, { view: () => flow({ proposal: null, proposal_pending: true, contract: AGREEMENT_LOCKED }) });
    await open(page);
    await expect(steps(page)).toHaveText(['1Choose — this step', '2Sign — not yet', '3Pay — not yet']);
    await expect(page.locator('#step-choose')).toHaveClass(/locked/);
    await expect(page.locator('#step-choose')).toContainText('Your studio is updating the proposal — you’ll get an email when the new version is ready. Nothing to do now.');
    await expect(page.locator('#accept')).toHaveCount(0);
    await expect(page.locator('#step-sign')).toHaveClass(/locked/);
    await expect(page.locator('#step-sign')).toContainText('Unlocks once you accept the updated proposal.');
    await expect(page.locator('#nm')).toHaveCount(0);
    await expect(page.getByText('due at signing')).toHaveCount(0);
    expect(served.posts).toEqual([]);
  });

  test('all done: accepted, signed, deposit paid — three done steps, the documents folded, the certificate kept', async ({ page }) => {
    await serve(page, { view: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: AGREEMENT_SIGNED, deposit: { amount_cents: 250000, status: 'paid', paid_at: '2026-07-16T10:00:00.000Z', url: null } }) });
    await open(page);
    await expect(steps(page)).toHaveText(['✓Chosen — done', '✓Signed — done', '✓Paid — done']);
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
    await expect(page.locator('details#step-choose')).not.toHaveAttribute('open', '');
    await expect(page.locator('details#step-sign')).not.toHaveAttribute('open', '');   // a later visit: folded
    await expect(page.locator('#step-pay .ok')).toContainText('Deposit paid — thank you.');
    await expect(page.locator('#pay')).toHaveCount(0);
    await expect(page.getByText('Your signed agreement stays on this page whenever you need it.')).toBeVisible();   // not "on its way" again
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
    await expect(page.locator('#askBtn')).toHaveText('Ask for an updated one');
    await expect(steps(page).nth(1)).toHaveClass(/locked/);
    await expect(page.locator('#nm')).toHaveCount(0);
  });

  test('a dead link (403) shows the honest dead-end, not a broken page', async ({ page }) => {
    await serve(page, { view: () => ({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }), viewStatus: 403 });
    await open(page);
    await expect(page.locator('h1')).toHaveText('This link isn’t working');
    await expect(page.getByText('This link isn’t valid or has expired.')).toBeVisible();
    await expect(page.locator('.steps')).toHaveCount(0);
  });

  test('an old per-document link (a proposal token) still renders the single proposal and accepts it', async ({ page }) => {
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
    await serve(page, { view: () => ({ data: { kind: 'contract', brand: { name: 'Test Studio', accent: '#5b3fa0' }, ...AGREEMENT_OPEN, studio_signer: SIGNER } }) });
    await open(page);
    await expect(page.locator('.steps')).toHaveCount(0);
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#em').fill('sam@example.com');   // sales item 88: the signer's email is needed
    await page.locator('#sign').click();
    await expect(page.locator('.paybtn')).toHaveAttribute('href', STRIPE);
    await expect(page.getByRole('heading', { name: /^Signed by both of you on / })).toBeVisible();
    await expect(page.locator('.cert')).toContainText('Signature certificate');
    await expect(page.locator('.cert')).toContainText('Alex Rivera, Owner for Test Studio');
  });

  test('phone width: the strip, the proposal and the agreement fit — no horizontal page scroll', { tag: '@layout' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    for (const start of ['sent', 'accepted', 'signed'] as const) {
      await serve(page, { start });
      await open(page);
      await expect(page.locator('.steps')).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, start).toBeLessThanOrEqual(0);
      await page.unroute('**/functions/v1/presence/**');
    }
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

test.describe('sign.html — sales item 106: a proposal paid in parts', () => {
  const inParts = (over: Flow = {}) => flow({ proposal: { ...PROPOSAL, schedule: PARTS }, deposit: { ...DEPOSIT_LOCKED, amount_cents: 170000 }, ...over });

  test('the header, How you’ll pay and the answer beside it all say the same parts', async ({ page }) => {
    await serve(page, { view: () => inParts() });
    await open(page);
    await expect(page.locator('.hero .pill')).toHaveText('Paid in 3 parts · $1,700 when you sign');
    const parts = page.locator('#step-choose .parts li');
    await expect(parts).toHaveCount(3);
    await expect(parts.nth(0)).toContainText('Part 1 of 3');
    await expect(parts.nth(0)).toContainText('When you sign the agreement');
    await expect(parts.nth(0)).toContainText('$1,700');
    await expect(parts.nth(0)).toContainText('Paid on this page, right after you sign');
    await expect(parts.nth(1)).toContainText('Due Dec 15, 2026');
    await expect(parts.nth(1)).toContainText('Comes with its own invoice');
    await expect(parts.nth(2)).toContainText('Due when the work is done');
    await expect(page.locator('#step-choose .side .why')).toHaveText('Paid in 3 parts. The first, $1,700, when you sign the agreement.');
  });

  test('signed by both, with Part 1 of 3 to pay and when the rest come', async ({ page }) => {
    const both = { ...AGREEMENT_SIGNED, signer_email: 'sam@example.com', countersigned_name: 'Alex Rivera', countersigned_title: 'Owner', countersigned_at: AGREEMENT_SIGNED.signed_at, pdf_url: PDF };
    await serve(page, { view: () => inParts({ proposal: { ...PROPOSAL, status: 'accepted', schedule: PARTS }, contract: both, deposit: { ...DEPOSIT_READY, amount_cents: 170000 }, client: CLIENT, studio_signer: SIGNER }) });
    await open(page);
    await expect(page.getByRole('heading', { name: 'Signed by both of you on Jul 15, 2026' })).toBeVisible();
    await expect(page.locator('#pdf')).toHaveAttribute('href', PDF);
    await expect(page.locator('#pdf')).toHaveText('Download the PDF');
    const sigs = page.locator('.sigcard .sig');
    await expect(sigs.nth(0)).toContainText('For Corner Café');
    await expect(sigs.nth(0)).toContainText('sam@example.com');
    await expect(sigs.nth(1)).toContainText('For Test Studio');
    await expect(sigs.nth(1)).toContainText('Alex Rivera, Owner');
    await expect(sigs.nth(1)).toContainText('Countersigned when Sam Rivera signed.');
    await expect(page.locator('.sigcard .fp')).toContainText('Fingerprint of the signed text: ababab…abab.');
    await expect(page.locator('#step-pay h3')).toHaveText('Part 1 of 3');
    await expect(page.locator('#pay')).toHaveText('Pay $1,700 securely');
    await expect(page.locator('#step-pay')).toContainText('Then $1,650 by Dec 15, 2026 and $1,650 when the work is done. Each comes with its own invoice.');
    await expect(page.locator('details#step-sign .cert')).toContainText('Alex Rivera, Owner for Test Studio');
  });

  test('a deposit that isn’t part 1 (asked for by hand) is just the deposit, with no promise about the rest', async ({ page }) => {
    await serve(page, { view: () => inParts({ proposal: { ...PROPOSAL, status: 'accepted', schedule: PARTS }, contract: AGREEMENT_SIGNED, deposit: DEPOSIT_READY }) });
    await open(page);
    await expect(page.locator('#step-pay h3')).toHaveText('Your deposit');
    await expect(page.locator('#step-pay')).not.toContainText('Then ');
  });
});

test.describe('sign.html — sales item 88: a question, and the agreement signed by both', () => {
  test('Ask a question: the question goes to the studio, and the page says where the answer goes', async ({ page, isMobile }) => {
    const served = await serve(page, { view: () => flow({ ask: { email: 's…@example.com', needs_email: false } }) });
    await open(page);
    await page.locator('#askBtn').click();
    await expect(page.getByRole('dialog', { name: 'Ask Test Studio' })).toBeVisible();
    const sheet = page.getByRole('dialog');   // its name becomes "Sent" once it has gone
    await expect(sheet).toContainText('They answer by email, and the proposal stays open while you wait.');
    await expect(sheet).toContainText('Answer to s…@example.com');
    await sheet.getByRole('button', { name: 'Send question' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Write your question first.');
    expect(served.posts).toEqual([]);
    await sheet.getByLabel('Your question').fill('Can we start in May?');
    await sheet.getByRole('button', { name: 'Send question' }).click();
    await expect(sheet.getByRole('heading', { name: 'Sent' })).toBeVisible();
    await expect(sheet).toContainText('Test Studio will answer by email at s…@example.com. The proposal stays open while you wait.');
    expect(served.posts).toHaveLength(1);
    expect(served.posts[0].path).toBe('/sales/ask');
    expect(served.posts[0].body).toEqual({ token: TOKEN, body: 'Can we start in May?', key: expect.stringMatching(/^[a-z0-9]{8,}$/), kind: 'proposal' });
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    if (!isMobile) await expect(page.locator('#askBtn')).toBeFocused();
    await expect(page.locator('#accept')).toBeVisible();   // the proposal stays open
  });

  test('with no address on the deal, the sheet asks where the answer should go', async ({ page }) => {
    const served = await serve(page, { view: () => flow({ ask: { email: '', needs_email: true } }) });
    await open(page);
    await page.locator('#askBtn').click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Your question').fill('Is hosting included?');
    await sheet.getByLabel('Your email, for the answer').fill('nope');
    await sheet.getByRole('button', { name: 'Send question' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Add your email so the answer can reach you.');
    expect(served.posts).toEqual([]);
    await sheet.getByLabel('Your email, for the answer').fill('sam@example.com');
    await sheet.getByRole('button', { name: 'Send question' }).click();
    await expect(sheet).toContainText('Test Studio will answer by email at sam@example.com.');
    expect(served.posts[0].body).toMatchObject({ body: 'Is hosting included?', email: 'sam@example.com', kind: 'proposal' });
  });

  test('a question that doesn’t send keeps the sheet and what was written', async ({ page }) => {
    await serve(page, { ask: { status: 429, body: { error: 'too_many', message: 'Too many tries — wait a minute and try again.' } } });
    await open(page);
    await page.locator('#askBtn').click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Your question').fill('Can we start in May?');
    await sheet.getByRole('button', { name: 'Send question' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Too many tries — wait a minute and try again.');
    await expect(sheet.getByLabel('Your question')).toHaveValue('Can we start in May?');
    await expect(sheet.getByRole('button', { name: 'Send question' })).toBeEnabled();
  });

  test('the agreement reads as a document: contents, numbered sections, both parties, and the studio’s signature waiting beside theirs', async ({ page, isMobile }) => {
    const served = await serve(page, { view: () => flow({ proposal: { ...PROPOSAL, status: 'accepted' }, contract: AGREEMENT_DOC, client: CLIENT, studio_signer: SIGNER }) });
    await open(page);
    if (isMobile) await expect(page.locator('.toc summary')).toHaveText('In this agreement · 3 sections');
    else await expect(page.locator('.rail a[data-for]')).toHaveText(['1Scope of work', '2Payment terms', '3Revisions']);
    await expect(page.locator('#step-sign .doc-t')).toHaveText('Service agreement');
    await expect(page.locator('#ag-s1')).toHaveText('1Scope of work');
    await expect(page.locator('#step-sign .ag-item').first()).toHaveText('(a)$1,700 when this agreement is signed.');
    await expect(page.locator('.parties')).toContainText('Alex Rivera, Owner');
    await expect(page.locator('.parties')).toContainText('Corner Café');
    const studio = page.locator('.sig.studio');
    await expect(studio).toContainText('For Test Studio');
    await expect(studio).toContainText('Signs automatically the moment you sign, with the same date and time. Nothing else to wait for.');
    await expect(page.locator('.sig.you .eyebrow')).toHaveText('For Corner Café');
    await expect(page.locator('#step-sign')).toContainText('Signing opens your $2,500 deposit to pay, right here.');
    await page.locator('#askSign').click();
    await expect(page.getByRole('dialog', { name: 'Ask Test Studio' })).toContainText('the agreement stays open while you wait');
    await page.getByRole('dialog').getByLabel('Your question').fill('Can the launch move a week?');
    await page.getByRole('dialog').getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Sent' })).toBeVisible();
    expect(served.posts[0].body).toMatchObject({ kind: 'contract', body: 'Can the launch move a week?' });
  });

  test('phone: Accept and Ask ride a bar at the bottom of the screen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    await serve(page);
    await open(page);
    const bar = page.locator('#chooseRow');
    await expect(bar).toHaveCSS('position', 'fixed');
    const box = await bar.boundingBox();
    const vh = page.viewportSize()!.height;
    expect(Math.round(box!.y + box!.height)).toBe(vh);
    await expect(page.locator('#accept')).toHaveText('Accept this proposalAccept · $5,000');
    await expect(page.locator('#accept .sm')).toBeVisible();
    await expect(page.locator('#accept .lg')).toBeHidden();
  });
});
