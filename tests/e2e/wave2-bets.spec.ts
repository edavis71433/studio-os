import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Wave 2 — the benchmark's bigger bets (docs/design/BENCHMARK-2026-10.md §7):
//   10  keyboard beyond ⌘K      `/` search · `?` shortcuts · `n` New
//    8  the bell grows up       All · Needs you · Updates, Mark read vs Clear, priority rows
//    7  AI shows its sources    chips under a concierge answer; Draft a reply in the Inbox
//   12  sample data on a trial  Today's example-data card and its two-step Remove
// Hermetic like every other spec: the harness fixtures stand in for the API.

const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';   // a real (dismissible) notice id
const FEED_TAGGED = { data: {
  role: 'business_owner',
  moments: [{ id: 'm1', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', created_at: '2026-07-01T00:00:00Z', tier: 'update', priority: false }],
  notices: [
    { id: U, kind: 'lead_followup', period: 'lead:l1', dismissible: true, headline: 'A quote request is waiting for a reply', body: 'Sam reached out about a day ago.', href: '/inbox.html#enquiries?sel=lead:l1', tier: 'needs_you', priority: false },
    { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', kind: 'deal_followup', period: 'invremind:cccccccc-3333-4333-8333-cccccccccccc', dismissible: false, headline: 'Still unpaid: Deposit $1,600', body: 'Marlow’s Kitchen — due last week.', href: '/pipeline.html', tier: 'needs_you', priority: true },
    { id: 'dddddddd-4444-4444-8444-dddddddddddd', kind: 'invoice_paid', period: 'paid:x', dismissible: true, headline: 'Paid: Photos $400', body: 'Hettie Orange paid this morning.', href: '/pipeline.html', tier: 'update', priority: false },
  ],
  pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide', tier: 'needs_you', priority: true }],
  last_published: null,
} };

const INBOX_API = {
  '/portal/feed': { data: {
    role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null,
    client_messages: [{ type: 'message', project: 'Site build', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 3, thread_key: 'client:c-1', unread: true, href: '/crm.html?project=aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa&tab=messages', tier: 'needs_you', priority: false }],
    enquiries: [{ id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', status: 'new', created_at: '2026-07-13T00:00:00Z', thread_key: 'lead:l-9', unread: true, tier: 'needs_you', priority: false }],
  } },
  '/forms/inbox': { data: { submissions: [{ id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-07-13T00:00:00Z' }], unread: 1 } },
  '/notifications': { data: [], unread_count: 0 },
  '/crm/activity': { data: { upcoming: [], items: [{ id: 'i1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Hello — how is it going?', at: '2026-07-15T00:00:00Z', meta: null, href: null }], reply_to: '/projects/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa/messages', reply_support_to: null } },
  '/writer/rewrite': { data: { text: 'Hi Marlow’s Kitchen — it’s going well. The homepage draft is ready for you to look at this week.' } },
};

test.describe('Wave 2 bets', () => {
  // ── 10 · keyboard ──
  test('10: `/` opens the search and focuses its input; `?` opens the shortcuts sheet; Escape closes it', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Inbox');
    await page.keyboard.press('/');
    const pal = page.locator('.dds-palette');
    await expect(pal).toHaveClass(/\bopen\b/);
    await expect(pal.locator('input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pal).not.toHaveClass(/\bopen\b/);
    await page.keyboard.press('?');
    const sheet = page.locator('.dds-keys');
    await expect(sheet).toHaveClass(/\bopen\b/);
    await expect(sheet).toContainText('Keyboard shortcuts');
    await expect(sheet.locator('kbd')).toHaveText([/^(⌘K|Ctrl K)$/, '/', 'n', '?', 'Esc']);   // the first row follows the host platform (⌘K on a Mac, Ctrl K elsewhere)
    await expect(sheet).not.toContainText('In the Inbox');                           // the Inbox keys list only there
    await page.keyboard.press('Escape');
    await expect(sheet).not.toHaveClass(/\bopen\b/);
  });

  test('10: keys are ignored while typing; on the Inbox the sheet lists the Inbox’s own keys', async ({ page }) => {
    await installApp(page, { api: INBOX_API });
    await page.goto('/inbox.html');
    const q = page.locator('#q');
    await q.click();
    await q.type('a?/n');
    await expect(page.locator('.dds-palette')).toHaveCount(0);
    await expect(page.locator('.dds-keys')).toHaveCount(0);
    await expect(q).toHaveValue('a?/n');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    const sheet = page.locator('.dds-keys');
    await expect(sheet).toHaveClass(/\bopen\b/);
    await expect(sheet).toContainText('In the Inbox');
    await expect(sheet).toContainText('Move between conversations');
  });

  test('10: `n` fires the page’s New action (the Inbox’s + New enquiry) and says so when a page has none', async ({ page }) => {
    await installApp(page, { api: INBOX_API });
    await page.goto('/inbox.html#enquiries');
    await expect(page.locator('#newEnq')).toBeVisible();
    await page.keyboard.press('n');
    await expect(page.locator('#newForm')).toBeVisible();
    // Today has no New button: an honest toast, nothing invented
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Inbox');
    await page.keyboard.press('n');
    await expect(page.locator('.dds-toast')).toContainText('Nothing to create on this page.');
  });

  // ── 8 · the bell ──
  test('8: tabs filter by tier; priority rows (money + approvals) sit on top with the accent', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': FEED_TAGGED } });
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await expect(pop).toContainText('Needs a look');
    const rows = pop.locator('.body .row');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toHaveClass(/\bpri\b/);                    // the unpaid invoice…
    await expect(rows.nth(0)).toContainText('Still unpaid');
    await expect(rows.nth(1)).toHaveClass(/\bpri\b/);                    // …and the approval, first
    await expect(rows.nth(1)).toContainText('Waiting for approval');
    await expect(rows.nth(2)).toContainText('A quote request is waiting for a reply');
    await expect(rows.nth(3)).toContainText('Paid: Photos');            // updates after the asks
    await expect(rows.nth(4)).toContainText('Add your holiday hours');
    await pop.getByRole('tab', { name: 'Needs you' }).click();
    await expect(rows).toHaveCount(3);
    await expect(pop).not.toContainText('Paid: Photos');
    await pop.getByRole('tab', { name: 'Updates' }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Paid: Photos');
    await expect(pop.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
    // the footer still sends you to the one place
    await expect(pop.locator('a.foot')).toContainText('See everything in your Inbox');
  });

  test('8: Mark read dims the rows and quiets the badge until the count changes; Clear dismisses only what a hand may clear', async ({ page }) => {
    const dismissed: string[] = [];
    await installApp(page, { api: { '/portal/feed': FEED_TAGGED } });
    await page.route('**/functions/v1/presence/commerce/notices/dismiss', (route) => {
      dismissed.push(route.request().postDataJSON().id);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.goto('/today.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await expect(pop.locator('.body .row')).toHaveCount(5);
    await pop.getByRole('button', { name: 'Mark read' }).click();
    await expect(pop.locator('.body .row.seen')).toHaveCount(5);
    await expect(page.locator('#dds-bell .dot')).toHaveCount(0);        // quiet…
    await page.reload();
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Inbox');
    await expect(page.locator('#dds-bell .dot')).toHaveCount(0);        // …and still quiet: the count did not change
    // Clear: the dismissible notices go through the existing dismiss route; the
    // protected money row, the approval and the moment stay
    await page.locator('#dds-bell').click();
    await pop.getByRole('button', { name: 'Clear' }).click();
    await expect.poll(() => dismissed.sort()).toEqual([U, 'dddddddd-4444-4444-8444-dddddddddddd']);
    await expect(pop.locator('.body .row')).toHaveCount(3);
    await expect(pop).toContainText('Still unpaid');
    await expect(pop).toContainText('Waiting for approval');
    await expect(pop).not.toContainText('A quote request is waiting for a reply');
    await expect(pop.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  test('8: a feed without tiers (an older function build) still renders — every row an ask', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await expect(pop.locator('.body .row')).toHaveCount(3);
    await pop.getByRole('tab', { name: 'Updates' }).click();
    await expect(pop.locator('.body .row')).toHaveCount(1);   // the moment is always an update
    await expect(pop).toContainText('Add your holiday hours');
  });

  // ── 7 · AI shows its sources; drafts replies ──
  test('7: chips name what the concierge drew on, plus an honest line on low confidence (Today and Help)', async ({ page }) => {
    const answer = { data: { verb: 'explain', answer: 'Your Saturday hours are missing from the Contact page — add them and publish.', source_labels: ['Your hours are missing', 'No opening hours were found on the Contact page.'], low_confidence: true, grounded: true, sources: { moment_id: 'm1', recommendation_ids: [], evidence_count: 1 } } };
    await installApp(page, { api: { '/concierge/ask': answer } });
    await page.goto('/today.html');
    await page.locator('#q').fill('What should I do first?');
    await page.locator('#askBtn').click();
    const box = page.locator('#askAns');
    await expect(box).toContainText('Your Saturday hours are missing');
    await expect(box.locator('.src')).toHaveText(['Your hours are missing', 'No opening hours were found on the Contact page.']);
    await expect(box.locator('.lowc')).toContainText('Part of this is judgment');
    await page.goto('/help.html');
    await page.getByLabel('Ask a question').fill('What should I do first?');
    await page.getByRole('button', { name: 'Ask' }).click();
    const ans = page.locator('#ans');
    await expect(ans).toContainText('Your Saturday hours are missing');
    await expect(ans.locator('.src')).toHaveCount(2);
    await expect(ans.locator('.lowc')).toBeVisible();
  });

  test('7: no sources → no chips; a confident answer → no judgment line', async ({ page }) => {
    await installApp(page, { api: { '/concierge/ask': { data: { answer: 'Nothing’s waiting for you to start on.', source_labels: [], low_confidence: false } } } });
    await page.goto('/today.html');
    await page.locator('#q').fill('Anything?');
    await page.keyboard.press('Enter');
    const box = page.locator('#askAns');
    await expect(box).toContainText('Nothing’s waiting');
    await expect(box.locator('.src')).toHaveCount(0);
    await expect(box.locator('.lowc')).toHaveCount(0);
  });

  test('7: Draft a reply calls /writer/rewrite, lands in the textarea for editing, never sends', async ({ page }) => {
    const asks: Array<Record<string, unknown>> = [];
    const sends: string[] = [];
    await installApp(page, { api: INBOX_API });
    await page.route('**/functions/v1/presence/writer/rewrite', (route) => { asks.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INBOX_API['/writer/rewrite']) }); });
    await page.route('**/functions/v1/presence/projects/**', (route) => { sends.push(route.request().method()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"ok":true}}' }); });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Marlow’s Kitchen' }).first().click();
    const pane = page.locator('#rpane');
    await expect(pane.locator('#msgBody')).toBeVisible();
    await pane.getByRole('button', { name: 'Draft a reply' }).click();
    await expect(pane.locator('#msgBody')).toHaveValue(/homepage draft is ready/);
    await expect(pane.locator('.ai-note')).toHaveText('Drafted by AI — edit before sending.');
    await expect.poll(() => asks.length).toBe(1);
    expect(asks[0].action).toBe('write');
    expect(String(asks[0].prompt)).toContain('how is it going');
    expect(sends).toEqual([]);                                   // nothing was sent
    await pane.locator('#msgBody').press('End');
    await pane.locator('#msgBody').type(' Thanks!');
    await expect(pane.locator('.ai-note')).toHaveCount(0);       // the note leaves on the first edit
    await expect(pane.getByRole('button', { name: 'Send' })).toBeVisible();   // Send is still the operator's click
    // the enquiry and support composers carry the same button. Under 760px the
    // panes stack and the open conversation hides the list (inbox.html's D5:
    // picking a row pushes the pane in), so a phone steps back to the list
    // first — the same move an operator makes; on wider screens there is no
    // back button and both panes already show.
    const back = page.locator('#paneBack');
    if (await back.isVisible()) await back.click();
    await page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' }).first().click();
    await expect(pane.getByRole('button', { name: 'Draft a reply' })).toBeVisible();
  });

  test('7: a plan without drafting gets the server’s sentence, and the textarea is untouched', async ({ page }) => {
    await installApp(page, { api: INBOX_API });
    await page.route('**/functions/v1/presence/writer/rewrite', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'plan_upgrade_required', message: 'Your current plan doesn’t include this — upgrading adds it.' }) }));
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Marlow’s Kitchen' }).first().click();
    const pane = page.locator('#rpane');
    await pane.locator('#msgBody').fill('Hi —');
    await pane.getByRole('button', { name: 'Draft a reply' }).click();
    await expect(page.locator('.dds-toast')).toContainText('upgrading adds it');
    await expect(pane.locator('#msgBody')).toHaveValue('Hi —');
    await expect(pane.locator('.ai-note')).toHaveCount(0);
  });

  // ── 12 · sample data on a new trial ──
  test('12: Today shows the example-data card; Remove is two steps and deletes through the one route', async ({ page }) => {
    const calls: string[] = [];
    await installApp(page, { api: { '/commerce/example-data': { data: { present: true, counts: { contacts: 1, deals: 1, enquiries: 1 } } } } });
    await page.route('**/functions/v1/presence/commerce/example-data/remove', (route) => { calls.push(route.request().method()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, removed: { contacts: 1, deals: 1, enquiries: 1 } } }) }); });
    await page.goto('/today.html');
    const card = page.locator('#example-data');
    await expect(card).toContainText('You’re looking at example data.');
    await expect(card).toContainText('Marlow’s Kitchen');
    await page.getByRole('button', { name: 'Remove example data' }).click();
    await expect(card).toContainText('Remove the example customer, deal and enquiry?');
    await page.getByRole('button', { name: 'Keep' }).click();                      // changed your mind → back to the quiet button
    await expect(page.getByRole('button', { name: 'Remove example data' })).toBeVisible();
    expect(calls).toEqual([]);
    await page.getByRole('button', { name: 'Remove example data' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => calls).toEqual(['POST']);
    await expect(card).toHaveCount(0);
    await expect(page.locator('.dds-toast')).toContainText('Example data removed.');
  });

  test('12: no example rows (or a failed read) → no card; a drilled-in operator never reads it', async ({ page }) => {
    const reads: string[] = [];
    await installApp(page, { api: { '/commerce/example-data': { data: { present: false, counts: { contacts: 0, deals: 0, enquiries: 0 } } } } });
    await page.goto('/today.html');
    await expect(page.locator('#greeting')).toBeVisible();
    await expect(page.locator('#example-data')).toHaveCount(0);
    await page.route('**/functions/v1/presence/commerce/example-data', (route) => { reads.push(route.request().url()); return route.fulfill({ status: 500, body: '{}' }); });
    await page.goto('/today.html');
    await expect(page.locator('#greeting')).toBeVisible();
    await expect(page.locator('#example-data')).toHaveCount(0);
    await expect.poll(() => reads.length).toBe(1);
    await page.goto('/today.html?client=aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    await expect(page.locator('#greeting')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(reads.length).toBe(1);                                                  // not read under a client scope
  });

  // ── axe on the new surfaces ──
  test('no serious/critical axe violations with the bell open, with the shortcuts sheet open, and on the example card', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: { '/portal/feed': FEED_TAGGED, '/commerce/example-data': { data: { present: true, counts: { contacts: 1, deals: 1, enquiries: 1 } } } } });
    await page.goto('/today.html');
    await expect(page.locator('#example-data')).toBeVisible();
    await page.locator('#dds-bell').click();
    await expect(page.locator('.dds-bell-pop .body .row')).toHaveCount(5);
    let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    let serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.locator('.dds-keys')).toHaveClass(/\bopen\b/);
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
