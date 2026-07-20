import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Inbox — the split-view console (redesign slice 2). List pane of every
// conversation (client messages · support · enquiries · approvals) with REAL
// per-thread unread dots; reading pane renders the selection in place.
// Hermetic: fixtures below stand in for /portal/feed (with the slice-2
// client_messages/enquiries additions), /crm/activity, and /support/:id.

const FEED = { data: {
  role: 'business_owner',
  moments: [{ id: 'm1', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', created_at: '2026-07-01T00:00:00Z' }],
  notices: [{ id: 'n1', kind: 'lead_followup', headline: 'A quote request is waiting for a reply', body: '', href: '/leads.html' }],
  pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
  last_published: null,
  client_messages: [
    { type: 'message', project: 'Site build', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 3, thread_key: 'client:c-1', unread: true, href: '/crm.html?project=aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa&tab=messages' },
    { type: 'support', id: 's-1', subject: 'Logo tweak', status: 'open', project: '', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
  ],
  enquiries: [
    { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', status: 'new', created_at: '2026-07-13T00:00:00Z', thread_key: 'lead:l-9', unread: true },
  ],
} };

const API = {
  '/portal/feed': FEED,
  '/notifications': { data: [
    { kind: 'milestone_done', label: 'Milestone reached — Design', href: '/projects/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', created_at: '2026-07-10T00:00:00Z', read: false },
  ], unread_count: 1 },
  '/crm/activity': { data: {
    upcoming: [],
    items: [
      { id: 'i1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Hello — how is it going?', at: '2026-07-15T00:00:00Z', meta: null, href: null },
      { id: 'i2', kind: 'activity', type: 'call', title: 'You logged a call', body: null, at: '2026-07-11T00:00:00Z', meta: 'Logged call', href: null },
    ],
    reply_to: '/projects/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa/messages', reply_support_to: null,
  } },
  '/support/s-1': { data: {
    request: { id: 's-1', subject: 'Logo tweak', status: 'open', body: 'Please tweak the logo', created_at: '2026-07-14T00:00:00Z' },
    messages: [{ id: 'sm1', body: 'Can we make it bigger?', author_kind: 'client', created_at: '2026-07-14T01:00:00Z' }],
    is_studio_view: true,
  } },
};

test.describe('Inbox — split-view console', () => {
  test('list pane renders every conversation kind with unread dots + meta line', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    const rows = page.locator('#rows');
    await expect(rows.getByRole('option').filter({ hasText: 'Marlow’s Kitchen' }).first()).toBeVisible();
    await expect(rows.getByRole('option').filter({ hasText: 'Sam Rivera' })).toBeVisible();
    await expect(rows.getByRole('option').filter({ hasText: 'Protect your email' })).toBeVisible();
    // real unread dots (SLDS unread-indicator idiom, aria-label "Unread")
    expect(await page.locator('.unread-dot').count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#lmeta')).toContainText('conversations');
    await expect(page.locator('#lmeta')).toContainText('need');
    // the old sections 5–6 fold in as dimmed system rows (Everything view)
    await expect(rows.locator('.sysrow').filter({ hasText: 'Milestone reached — Design' })).toBeVisible();
    await expect(rows.locator('.sysrow').filter({ hasText: 'A quote request is waiting for a reply' })).toBeVisible();
    // opening the Inbox still marks section-level activity seen (bell clears)
  });

  test('opening a row clears ITS dot optimistically and fires POST /threads/read', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    const msgRow = page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first();
    await expect(msgRow.locator('.unread-dot')).toBeVisible();
    const readReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/threads/read'));
    await msgRow.click();
    const req = await readReq;
    expect(req.postDataJSON()).toEqual({ thread_key: 'client:c-1' });
    // the dot cleared without waiting on the server; the row is the Selected Item
    await expect(msgRow.locator('.unread-dot')).toHaveCount(0);
    await expect(msgRow).toHaveAttribute('aria-selected', 'true');
    // other rows keep their dots — nothing was bulk-cleared (count, not
    // visibility: <760px the open pane covers the list)
    await expect(page.locator('#rows [role=option]').filter({ hasText: 'Logo tweak' }).locator('.unread-dot')).toHaveCount(1);
  });

  test('a client-message row opens the record timeline + Message composer in place', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first().click();
    const pane = page.locator('#rpane');
    await expect(pane).toContainText('Marlow’s Kitchen');
    await expect(pane.getByRole('link', { name: 'Open full record →' })).toHaveAttribute('href', /crm\.html\?client_id=c-1&tab=messages/);
    // the activity timeline (slice-1 anatomy) rendered from GET /crm/activity
    await expect(pane.locator('.ti').filter({ hasText: 'The client sent a message' })).toBeVisible();
    await expect(pane.locator('.ti').filter({ hasText: 'You logged a call' })).toBeVisible();
    // Message-only composer, posting to the reply target
    const sendReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/projects/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa/messages'));
    await pane.locator('#msgBody').fill('On it — draft coming today.');
    await pane.getByRole('button', { name: 'Send' }).click();
    const req = await sendReq;
    expect(req.postDataJSON()).toEqual({ body: 'On it — draft coming today.', audience: 'client' });
  });

  test('view dropdown switches the fixed views (D3)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    const rows = page.locator('#rows');
    await expect(rows.getByRole('option').first()).toBeVisible();
    // Support view → only the support thread
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="support"]').click();
    await expect(page.locator('#viewBtn')).toContainText('Support');
    await expect(rows.getByRole('option')).toHaveCount(1);
    await expect(rows.getByRole('option').first()).toContainText('Logo tweak');
    // Needs your OK → only the approval
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="ok"]').click();
    await expect(rows.getByRole('option')).toHaveCount(1);
    await expect(rows.getByRole('option').first()).toContainText('Protect your email');
    // Enquiries → only the lead
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="enquiries"]').click();
    await expect(rows.getByRole('option')).toHaveCount(1);
    await expect(rows.getByRole('option').first()).toContainText('Sam Rivera');
    // Messages → only the client conversation
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="messages"]').click();
    await expect(rows.getByRole('option')).toHaveCount(1);
    await expect(rows.getByRole('option').first()).toContainText('Marlow’s Kitchen');
  });

  test('support: reading pane changes status through PATCH /support/:id', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Logo tweak' }).click();
    const pane = page.locator('#rpane');
    await expect(pane).toContainText('Please tweak the logo');
    await expect(pane).toContainText('Can we make it bigger?');
    // legal transitions only (open → in_progress/resolved/closed)
    const select = pane.locator('#paneStatus');
    await expect(select).toBeVisible();
    const patchReq = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/support/s-1'));
    await select.selectOption('in_progress');
    const req = await patchReq;
    expect(req.postDataJSON()).toEqual({ status: 'in_progress' });
    // reply composer posts to the existing support reply route
    const replyReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/support/s-1/messages'));
    await pane.locator('#supBody').fill('Done — take a look.');
    await pane.getByRole('button', { name: 'Send' }).click();
    expect((await replyReq).postDataJSON()).toEqual({ body: 'Done — take a look.' });
  });

  test('approval row: inline Approve posts to its decide_path', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Protect your email' }).click();
    const pane = page.locator('#rpane');
    await expect(pane).toContainText('Add email authentication.');
    const decideReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/foundations/plans/p1/decide'));
    await pane.getByRole('button', { name: 'Approve' }).click();
    expect((await decideReq).postDataJSON()).toEqual({ decision: 'approve' });
  });

  test('enquiry row: lead card actions (Mark read → /forms/inbox/:id)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' }).click();
    const pane = page.locator('#rpane');
    await expect(pane).toContainText('Can I get a quote for a patio?');
    await expect(pane.getByRole('link', { name: 'Reply' })).toHaveAttribute('href', /^mailto:sam%40example\.com/);
    await expect(pane.getByRole('button', { name: '→ Deal' })).toBeVisible();
    const readReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/forms/inbox/l-9'));
    await pane.getByRole('button', { name: 'Mark read' }).click();
    expect((await readReq).postDataJSON()).toEqual({ status: 'read' });
  });

  test('split view collapses and reopens (edge toggle, SLDS labels)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the edge toggle is a ≥760px affordance; <760px stacks');
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    const edge = page.locator('#edgeBtn');
    await expect(edge).toHaveAttribute('aria-label', 'Close Split View');
    await edge.click();
    await expect(edge).toHaveAttribute('aria-label', 'Open Split View');
    await expect(page.locator('.lpane')).toBeHidden();
    await edge.click();
    await expect(edge).toHaveAttribute('aria-label', 'Close Split View');
    await expect(page.locator('.lpane')).toBeVisible();
  });

  test('mobile: panes stack — picking a row pushes the pane in, back returns (D5)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'stacked panes are the <760px behaviour');
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await expect(page.locator('#rpane')).toBeHidden();   // list first
    await page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first().click();
    await expect(page.locator('#rpane')).toBeVisible();  // the pane pushed in
    await expect(page.locator('.lpane')).toBeHidden();
    await page.locator('#paneBack').click();             // back to the list
    await expect(page.locator('#rpane')).toBeHidden();
    await expect(page.locator('.lpane')).toBeVisible();
  });

  test('keyboard: arrows move, Enter opens (listbox idiom)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'keyboard path once, on desktop');
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await page.locator('#rows').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('#rows [role=option][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('#rpane .phead')).toBeVisible();
  });

  test('deploy-order: a PRE-slice-2 feed shape still renders every conversation', async ({ page }) => {
    // The OLD function build: client_messages rows carry NO thread_key/unread/
    // status/project_id, one row is fully unattributed (client_id:''), and the
    // feed has NO enquiries key at all. The page must (F2) never drop the
    // unattributed row, (F11) fall back to its own /forms/inbox read for leads,
    // and derive dots from the needs-reply heuristic.
    await installApp(page, { api: {
      '/portal/feed': { data: {
        role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null,
        client_messages: [
          { type: 'message', project: 'Site build', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 3, href: '/crm.html?project=aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa&tab=messages' },
          { type: 'message', project: '', client_id: '', client: '', created_at: '2026-07-14T12:00:00Z', needs_reply: true, count: 1, href: '' },
          { type: 'message', project: 'Rebrand', client_id: 'c-2', client: 'Beacon Bakery', created_at: '2026-07-14T06:00:00Z', needs_reply: false, count: 2, href: '' },
          { type: 'support', id: 's-1', subject: 'Logo tweak', project: '', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-14T00:00:00Z', href: '/projects.html?support=s-1' },
        ],
      } },
      '/notifications': { data: [], unread_count: 0 },
      '/forms/inbox': { data: { submissions: [
        { id: 'l-1', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote?', status: 'new', created_at: '2026-07-13T00:00:00Z' },
        { id: 'l-2', form_kind: 'contact', name: 'Dana Lee', email: 'dana@example.com', phone: '', message: 'Loved it', status: 'read', created_at: '2026-07-02T00:00:00Z' },
        { id: 'l-3', form_kind: 'contact', name: 'Gone Person', email: 'gone@example.com', phone: '', message: 'Old', status: 'archived', created_at: '2026-06-01T00:00:00Z' },
      ], unread: 1 } },
    } });
    await page.goto('/inbox.html');
    const rows = page.locator('#rows');
    // F2: the unattributed conversation lands in the misc bucket, never dropped
    const misc = rows.getByRole('option').filter({ hasText: 'Other clients' });
    await expect(misc).toBeVisible();
    // F11/C7: no enquiries key → leads come from the page's own /forms/inbox read,
    // counting NON-ARCHIVED (new + read — the same arithmetic as leads.html Open);
    // archived stays out
    await expect(rows.getByRole('option').filter({ hasText: 'Sam Rivera' })).toBeVisible();
    await expect(rows.getByRole('option').filter({ hasText: 'Dana Lee' })).toBeVisible();
    await expect(rows.getByRole('option').filter({ hasText: 'Gone Person' })).toHaveCount(0);
    // dots fall back to the needs-reply heuristic (no unread field anywhere);
    // a READ lead never fakes an unread dot
    await expect(rows.getByRole('option').filter({ hasText: 'Marlow’s Kitchen' }).first().locator('.unread-dot')).toHaveCount(1);
    await expect(rows.getByRole('option').filter({ hasText: 'Beacon Bakery' }).locator('.unread-dot')).toHaveCount(0);
    await expect(rows.getByRole('option').filter({ hasText: 'Dana Lee' }).locator('.unread-dot')).toHaveCount(0);
    // the meta line counts what is RENDERED (3 message groups + 1 support + 2 leads)
    await expect(page.locator('#lmeta')).toContainText('6 conversations');
    // the misc row still opens — with its old href fallback on the record link
    await misc.click();
    await expect(page.locator('#rpane').getByRole('link', { name: 'Open full record →' })).toHaveAttribute('href', '/projects.html');
  });

  test('a failed POST /threads/read leaves the optimistic dot cleared and the console consistent', async ({ page }) => {
    await installApp(page, { api: API });
    // override AFTER installApp: later routes match first, so only /threads/read 502s
    await page.route('**/functions/v1/presence/threads/read', (r) =>
      r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed' }) }));
    await page.goto('/inbox.html');
    const msgRow = page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first();
    const readReq = page.waitForResponse((r) => r.url().includes('/threads/read'));
    await msgRow.click();
    expect((await readReq).status()).toBe(502);
    // the dot is optimistic by design: it stays cleared for THIS session even
    // though the mark didn't persist — and nothing else is disturbed.
    await expect(msgRow.locator('.unread-dot')).toHaveCount(0);
    await expect(msgRow).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#rows [role=option]').filter({ hasText: 'Logo tweak' }).locator('.unread-dot')).toHaveCount(1);
    await expect(page.locator('#rpane .phead')).toBeVisible();   // the pane opened normally
  });

  test('client row: /crm/activity is asked with BOTH keys and the composer opens (F5)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    const actReq = page.waitForRequest((r) => r.url().includes('/crm/activity'));
    await page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first().click();
    const u = new URL((await actReq).url());
    expect(u.searchParams.get('client_id')).toBe('c-1');
    expect(u.searchParams.get('project')).toBe('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
    // reply_to present in the fixture → the Message composer opened in place
    await expect(page.locator('#rpane #msgBody')).toBeVisible();
  });

  test('empty inbox: all-clear art in the reading pane', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, client_messages: [], enquiries: [] } },
      '/notifications': { data: [], unread_count: 0 },
      '/forms/inbox': { data: { submissions: [], unread: 0 } },
    } });
    await page.goto('/inbox.html');
    await expect(page.locator('#rows')).toContainText('all caught up');
    // ≥760px the pane shows the calm all-clear; mobile shows the list only
  });
});

// ── SS6 — C2 search · C3 saved-reply insert · C7 enquiry count · a11y ────────
test.describe('SS6 — inbox console quick wins', () => {
  const SAVED = { data: { replies: [
    { id: 'r1', title: 'Opening hours', body: 'We open at 9am, Monday to Saturday.' },
    { id: 'r2', title: 'Thanks', body: 'Thanks for reaching out!' },
  ] } };

  test('C2 — the list-pane search filters visibleRows without rebuilding the input', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    const rows = page.locator('#rows');
    await expect(rows.getByRole('option').first()).toBeVisible();
    const q = page.locator('#q');
    await q.evaluate((el) => { (el as HTMLElement).dataset.marker = 'kept'; });
    await q.pressSequentially('sam');
    // conversations AND system rows filter down to the match
    await expect(rows.getByRole('option')).toHaveCount(1);
    await expect(rows.getByRole('option').first()).toContainText('Sam Rivera');
    expect(await q.evaluate((el) => (el as HTMLElement).dataset.marker)).toBe('kept');
    // the meta line follows what the list shows
    await expect(page.locator('#lmeta')).toContainText('1 conversation');
    await q.fill('');
    await expect(rows.getByRole('option').filter({ hasText: 'Marlow’s Kitchen' }).first()).toBeVisible();
    // no-match stays honest
    await q.fill('zzz-nobody');
    await expect(rows).toContainText('Nothing here');
  });

  test('C3 — the message composer gains an Insert-saved-reply picker (lazy /service/saved-replies)', async ({ page }) => {
    await installApp(page, { api: { ...API, '/service/saved-replies': SAVED } });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first().click();
    const pane = page.locator('#rpane');
    const pick = pane.locator('select[aria-label="Insert a saved reply"]');
    await expect(pick).toBeVisible();
    await pane.locator('#msgBody').fill('Hi Sam —');
    await pick.selectOption('r1');
    // the body appends after what's typed; the picker resets for the next insert
    await expect(pane.locator('#msgBody')).toHaveValue('Hi Sam —\n\nWe open at 9am, Monday to Saturday.');
    await expect(pick).toHaveValue('');
  });

  test('C3 — the support composer gains the same picker', async ({ page }) => {
    await installApp(page, { api: { ...API, '/service/saved-replies': SAVED } });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Logo tweak' }).click();
    const pane = page.locator('#rpane');
    const pick = pane.locator('select[aria-label="Insert a saved reply"]');
    await expect(pick).toBeVisible();
    await pick.selectOption('r2');
    await expect(pane.locator('#supBody')).toHaveValue('Thanks for reaching out!');
  });

  test('C3 — no saved replies (or the route failing) renders no picker and stays quiet', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: API });   // default harness: no saved-replies fixture
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first().click();
    await expect(page.locator('#rpane #msgBody')).toBeVisible();
    await expect(page.locator('#rpane select[aria-label="Insert a saved reply"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('C7 — the Enquiries view labels its count: non-archived total with the new qualifier', async ({ page }) => {
    await installApp(page, { api: { ...API,
      // fallback path: NO enquiries key — the page's own /forms/inbox read counts
      '/portal/feed': { data: { ...FEED.data, enquiries: undefined } },
      '/forms/inbox': { data: { submissions: [
        { id: 'l-1', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Quote?', status: 'new', created_at: '2026-07-13T00:00:00Z' },
        { id: 'l-2', form_kind: 'contact', name: 'Dana Lee', email: 'dana@example.com', phone: '', message: 'Loved it', status: 'read', created_at: '2026-07-02T00:00:00Z' },
        { id: 'l-3', form_kind: 'contact', name: 'Gone Person', email: 'gone@example.com', phone: '', message: 'Old', status: 'archived', created_at: '2026-06-01T00:00:00Z' },
      ], unread: 1 } },
    } });
    await page.goto('/inbox.html');
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="enquiries"]').click();
    const rows = page.locator('#rows');
    await expect(rows.getByRole('option')).toHaveCount(2);   // non-archived: new + read
    // one queue, one vocabulary: "N enquiries · M new" — leads.html's arithmetic
    await expect(page.locator('#lmeta')).toContainText('2 enquiries · 1 new');
  });

  test('a11y — sr-only h1, aria-live reading pane, zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page, { api: API });
    await page.goto('/inbox.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeAttached();
    await expect(page.locator('h1')).toHaveCount(1);
    // opening a conversation: the reading pane announces thread updates
    await page.locator('#rows [role=option]').filter({ hasText: 'Sent you a message' }).first().click();
    await expect(page.locator('#pbody')).toHaveAttribute('aria-live', 'polite');
    expect(errors).toEqual([]);
  });
});

// ── Batch A (post-redesign audit) — inbox regressions ────────────────────────
test.describe('Batch A regressions — inbox', () => {
  test('A5 — approval decide refreshes IN PLACE: the row leaves, the console survives, no page reload', async ({ page }) => {
    let feedCalls = 0;
    await installApp(page, { api: API });
    // after the decide, the server's feed no longer carries the approval —
    // the in-place refresh must converge on that without a navigation
    await page.route('**/functions/v1/presence/portal/feed', (route) => {
      feedCalls++;
      const body = feedCalls <= 1 ? FEED : { data: { ...FEED.data, pending_approvals: [] } };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/inbox.html');
    // a marker that only survives if the document is never reloaded
    await page.evaluate(() => { (window as unknown as { __noReload?: boolean }).__noReload = true; });
    await page.locator('#rows [role=option]').filter({ hasText: 'Protect your email' }).click();
    const decideReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/foundations/plans/p1/decide'));
    await page.locator('#rpane').getByRole('button', { name: 'Approve' }).click();
    await decideReq;
    // the decided row is gone from the list — and the loaders re-ran (feed refetched)
    await expect(page.locator('#rows [role=option]').filter({ hasText: 'Protect your email' })).toHaveCount(0);
    await expect.poll(() => feedCalls).toBeGreaterThanOrEqual(2);
    // the other conversations are still there; the document never navigated
    await expect(page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test('A9 — exactly one read failing renders the surviving half PLUS the honest partial notice', async ({ page }) => {
    await installApp(page, { api: API });
    // the feed 500s; the enquiry read (default /forms/inbox fixture) survives
    await page.route('**/functions/v1/presence/portal/feed', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/inbox.html');
    const notice = page.locator('#lnotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Part of your inbox couldn’t load just now');
    await expect(notice).toContainText('messages and approvals');
    // the surviving half still renders (the page's own /forms/inbox read)
    await expect(page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' })).toBeVisible();
    // and a healthy load shows no notice
    await page.unroute('**/functions/v1/presence/portal/feed');
    await page.locator('#refreshBtn').click();
    await expect(notice).toBeHidden();
  });

  test('A8 — the 7-13 day band reads "1 week ago", never "1 weeks ago"', async ({ page }) => {
    const D8 = new Date(Date.now() - 8 * 86400000).toISOString();
    await installApp(page, { api: { ...API,
      '/portal/feed': { data: { ...FEED.data,
        enquiries: [{ id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Quote?', status: 'new', created_at: D8, thread_key: 'lead:l-9', unread: true }],
      } },
    } });
    await page.goto('/inbox.html');
    const row = page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' });
    await expect(row.locator('.rwhen')).toHaveText('1 week ago');
  });
});
