import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// CRM surfaces: the leads inbox (leads.html) and the relationship view (crm.html).
test.describe('Leads inbox', () => {
  test('renders leads with kind + a one-tap prefilled reply', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    const leads = page.locator('.lead');
    await expect(leads).toHaveCount(2);                       // Open filter: both non-archived
    await expect(page.getByText('Sam Rivera')).toBeVisible();
    await expect(page.getByText('Quote request')).toBeVisible();
    const reply = page.locator('a.reply').first();
    // the page URI-encodes the recipient (encodeURIComponent), so '@' → '%40'
    await expect(reply).toHaveAttribute('href', /^mailto:sam%40example\.com/);
    await expect(reply).toHaveAttribute('href', /subject=/);  // prefilled subject
  });

  test('the new-lead filter shows only unread', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await page.locator('[data-f="new"]').click();
    await expect(page.locator('.lead')).toHaveCount(1);
    await expect(page.getByText('Sam Rivera')).toBeVisible();
  });

  test('marking a lead read confirms with a toast', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await page.locator('[data-read]').first().click();
    // the page prefers the shell's shared toast (window.ddsToast → .dds-toast)
    // over its own #toast fallback
    await expect(page.locator('.dds-toast')).toContainText('Marked read.');
  });

  test('signed-out shows a sign-in prompt, not leads', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/leads.html');
    // scope to the page body — the signed-out shell also shows a "Sign in" icon link
    await expect(page.locator('#main').getByRole('link', { name: /Sign in/ })).toBeVisible();
    await expect(page.locator('.lead')).toHaveCount(0);
  });

  // ── SS6 (C2/C5/C7): search · honest filter group · REQ_SEQ ────────────────
  test('boots quiet: one h1, the search bar, zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page);
    await page.goto('/leads.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Website enquiries' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#q')).toBeVisible();
    await expect(page.locator('.lmeta')).toContainText('2 enquiries · 1 new · Updated just now');
    expect(errors).toEqual([]);
  });

  test('C2 — search filters the queue client-side without rebuilding the input', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await expect(page.locator('.lead')).toHaveCount(2);
    const q = page.locator('#q');
    // mark the live input node: list-only re-renders must never replace it
    await q.evaluate((el) => { (el as HTMLElement).dataset.marker = 'kept'; });
    await q.pressSequentially('dana');
    await expect(page.locator('.lead')).toHaveCount(1);
    await expect(page.locator('.lead').first()).toContainText('Dana Lee');
    expect(await q.evaluate((el) => (el as HTMLElement).dataset.marker)).toBe('kept');
    // the meta line reflects what the queue shows (C7 vocabulary: count + new)
    await expect(page.locator('.lmeta')).toContainText('1 enquiry');
    await q.fill('');
    await expect(page.locator('.lead')).toHaveCount(2);
    // no-match stays honest, never a blank page
    await q.fill('zzz-nobody');
    await expect(page.locator('#main')).toContainText('No enquiries match');
  });

  test('C5 — the status filters are an honest role=group with aria-pressed (no fake tablist)', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    const filters = page.locator('.filters');
    await expect(filters).toHaveAttribute('role', 'group');
    await expect(filters.locator('[role=tab]')).toHaveCount(0);
    await expect(filters.locator('[data-f="open"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.locator('[data-f="new"]')).toHaveAttribute('aria-pressed', 'false');
    await filters.locator('[data-f="new"]').click();
    await expect(filters.locator('[data-f="new"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.locator('[data-f="open"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('REQ_SEQ — a slow superseded load never paints over the newest one', async ({ page }) => {
    await installApp(page);
    const sub = (id: string, name: string) => ({ id, form_kind: 'contact', name, email: 'x@example.com', phone: '', message: 'Hi', source_page: '/', status: 'new', created_at: '2026-07-07T00:00:00Z' });
    let call = 0;
    // registered AFTER installApp so it wins for the list GET only (the POST
    // status routes carry an /:id segment and fall through to the harness)
    await page.route('**/functions/v1/presence/forms/inbox', (route) => {
      call++;
      const fulfill = (subs: unknown[]) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { submissions: subs, unread: 1 } }) });
      // call 2 is delayed WITHOUT blocking the handler (an awaited sleep here
      // would serialize the responses and defeat the race under test)
      if (call === 2) { setTimeout(() => { fulfill([sub('l2', 'Stale Lead')]).catch(() => {}); }, 700); return; }
      return fulfill(call === 1 ? [sub('l1', 'Boot Lead')] : [sub('l3', 'Fresh Lead')]);
    });
    await page.goto('/leads.html');
    await expect(page.locator('.lead')).toContainText(['Boot Lead']);
    // two refreshes in quick succession: the FIRST response is delayed and lands
    // last — the page must keep the newest request's rows, not the stale ones
    await page.locator('#refreshBtn').click();
    await page.locator('#refreshBtn').click();
    await expect(page.locator('.lead')).toContainText(['Fresh Lead']);
    await page.waitForTimeout(900);   // let the stale response land
    await expect(page.locator('.lead')).toContainText(['Fresh Lead']);
    await expect(page.locator('#main')).not.toContainText('Stale Lead');
  });
});

test.describe('Relationship view', () => {
  // crm.html is the Lightning-style Client Record now: it resolves the URL's
  // identity key via GET /crm/record (a bare /crm.html shows a picker), renders
  // the record header + Details card on the left, and the ONE activity timeline
  // + composer (Message · Note) in the right rail. The timeline reads
  // GET /crm/activity and falls back to /crm/messages + /crm/timeline when the
  // new route isn't served yet — which is exactly what these fixtures exercise.
  const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
  test('renders the business, the composer, and the activity timeline', async ({ page }) => {
    await installApp(page, { api: {
      '/crm/record': { data: {
        identity: { contact_id: null, deal_id: null, client_id: null, customer_site_id: CLIENT, project_id: null },
        header: { name: 'Marlow’s Kitchen', company: '', email: '', phone: '', status: 'customer' },
        highlights: {},
        sections: { overview: true, messages: false, deal: false, delivery: false, details: false },
        default_tab: 'overview',
        canonical: { key: 'client', value: CLIENT },   // matches the URL → no canonical redirect
      } },
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.getByRole('heading', { name: 'Marlow’s Kitchen' })).toBeVisible();
    // the composer replaces the old Notes section — Note is one of its tabs
    await expect(page.getByRole('tab', { name: 'Message' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Note' })).toBeVisible();
    // the merged timeline carries the site events (served here by the fallback pair)
    await expect(page.getByText('Quote request from Sam Rivera')).toBeVisible();
    await expect(page.getByText('Published the site')).toBeVisible();
  });

  // ── the SERVER path: GET /crm/activity actually deployed ──────────────────
  const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
  const PROJECT = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
  const RECORD = { data: {
    identity: { contact_id: null, deal_id: DEAL, client_id: null, customer_site_id: CLIENT, project_id: PROJECT },
    header: { name: 'Marlow’s Kitchen', company: '', email: '', phone: '', status: 'customer' },
    highlights: {},
    sections: { overview: true, messages: true, deal: false, delivery: false, details: false },
    default_tab: 'overview',
    canonical: { key: 'client', value: CLIENT },
  } };
  const activityFx = (over: Record<string, unknown> = {}) => ({ data: {
    items: [], upcoming: [], project_id: PROJECT, deal_id: DEAL, reply_to: null, reply_support_to: null, ...over,
  } });

  test('server /crm/activity feeds the timeline, the Upcoming band, and an enabled composer', async ({ page }) => {
    await installApp(page, { api: {
      '/crm/record': RECORD,
      '/crm/activity': activityFx({
        items: [
          { id: 'conv:message:m1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Hello there', at: '2026-07-10T00:00:00Z', meta: null, href: null },
          { id: 'deal:ev1', kind: 'deal_event', type: 'system', title: 'Moved to Proposal sent', body: null, at: '2026-07-08T00:00:00Z', meta: 'Deal', href: `/pipeline.html?deal=${DEAL}` },
        ],
        upcoming: [{ kind: 'task', id: 'task-1', title: 'Chase signature', due: '2026-07-01', overdue: true, href: null }],
        reply_to: `/projects/${PROJECT}/messages`,
      }),
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.getByText('The client sent a message')).toBeVisible();   // timeline row (message)
    await expect(page.getByText('Moved to Proposal sent')).toBeVisible();      // timeline row (system)
    await expect(page.getByText('Upcoming & overdue')).toBeVisible();          // the band
    await expect(page.getByText('Chase signature')).toBeVisible();
    const body = page.locator('#msgBody');
    await expect(body).toBeVisible();                                          // reply target exists → composer live
    await expect(page.locator('#msgForm button[type=submit]')).toBeEnabled();
    // a project reply carries the explicit client audience
    await body.fill('On it!');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(`/projects/${PROJECT}/messages`));
    await page.locator('#msgForm button[type=submit]').click();
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ body: 'On it!', audience: 'client' });
  });

  test('with only an open support thread, the reply POSTs {body} with no audience', async ({ page }) => {
    await installApp(page, { api: {
      '/crm/record': RECORD,
      '/crm/activity': activityFx({ reply_support_to: '/support/s1/messages' }),
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const body = page.locator('#msgBody');
    await body.fill('Following up');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/support/s1/messages'));
    await page.locator('#msgForm button[type=submit]').click();
    // the support reply route owns the audience — the page must NOT add one
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ body: 'Following up' });
  });

  test('the Upcoming checkbox PATCHes the to-do done', async ({ page }) => {
    await installApp(page, { api: {
      '/crm/record': RECORD,
      '/crm/activity': activityFx({ upcoming: [{ kind: 'task', id: 'task-1', title: 'Chase signature', due: null, overdue: false, href: null }] }),
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const cb = page.locator('[data-updone="task-1"]');
    const patched = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/sales/deal-tasks/task-1'));
    await cb.click();
    expect(JSON.parse((await patched).postData() || '{}')).toEqual({ status: 'done' });
    await expect(page.locator('.dds-toast')).toContainText('Done.');
  });

  test('a failed to-do PATCH re-unchecks the box', async ({ page }) => {
    await installApp(page, { api: {
      '/crm/record': RECORD,
      '/crm/activity': activityFx({ upcoming: [{ kind: 'task', id: 'task-1', title: 'Chase signature', due: null, overdue: false, href: null }] }),
    } });
    // registered AFTER installApp so it wins: the PATCH fails
    await page.route('**/functions/v1/presence/sales/deal-tasks/**', (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed' }) }));
    await page.goto(`/crm.html?client=${CLIENT}`);
    const cb = page.locator('[data-updone="task-1"]');
    await cb.click();
    await expect(cb).not.toBeChecked();   // the optimistic tick rolls back
    await expect(cb).toBeEnabled();
    await expect(page.locator('.dds-toast')).toContainText('update that to-do');
  });
});
