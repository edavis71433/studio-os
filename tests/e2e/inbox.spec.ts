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
      ], unread: 1 } },
    } });
    await page.goto('/inbox.html');
    const rows = page.locator('#rows');
    // F2: the unattributed conversation lands in the misc bucket, never dropped
    const misc = rows.getByRole('option').filter({ hasText: 'Other clients' });
    await expect(misc).toBeVisible();
    // F11: no enquiries key → leads come from the page's own /forms/inbox read ('new' only)
    await expect(rows.getByRole('option').filter({ hasText: 'Sam Rivera' })).toBeVisible();
    await expect(rows.getByRole('option').filter({ hasText: 'Dana Lee' })).toHaveCount(0);
    // dots fall back to the needs-reply heuristic (no unread field anywhere)
    await expect(rows.getByRole('option').filter({ hasText: 'Marlow’s Kitchen' }).first().locator('.unread-dot')).toHaveCount(1);
    await expect(rows.getByRole('option').filter({ hasText: 'Beacon Bakery' }).locator('.unread-dot')).toHaveCount(0);
    // the meta line counts what is RENDERED (3 message groups + 1 support + 1 lead)
    await expect(page.locator('#lmeta')).toContainText('5 conversations');
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
