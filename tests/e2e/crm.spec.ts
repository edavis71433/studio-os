import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// CRM surfaces: the leads inbox (leads.html) and the relationship view (crm.html).
test.describe('Leads inbox', () => {
  test('renders leads with kind + a Reply that opens a prefilled composer (mail app only as the fallback)', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    const leads = page.locator('.lead');
    await expect(leads).toHaveCount(2);                       // Open filter: both non-archived
    await expect(page.getByText('Sam Rivera')).toBeVisible();
    await expect(page.getByText('Quote request')).toBeVisible();
    await leads.first().getByRole('button', { name: 'Reply' }).click();
    const box = leads.first().locator('.lcompose');
    await expect(box.locator('textarea')).toBeFocused();
    await expect(box.locator('textarea')).toHaveValue(/^Hi Sam,/);
    // the page URI-encodes the recipient (encodeURIComponent), so '@' → '%40'
    const fb = box.getByRole('link', { name: 'Use your email app instead' });
    await expect(fb).toHaveAttribute('href', /^mailto:sam%40example\.com/);
    await expect(fb).toHaveAttribute('href', /subject=/);  // prefilled subject
  });

  // ── Oct 2026 workflow audit, change 5: the reply is sent from Studio OS ──
  test('Send reply POSTs the text, marks the enquiry Replied, and shows what was sent', async ({ page }) => {
    await installApp(page, { api: { '/forms/inbox/l1/reply': { data: { sent: true, status: 'replied' } } } });
    await page.goto('/leads.html');
    const card = page.locator('.lead').first();
    await card.getByRole('button', { name: 'Reply' }).click();
    await card.locator('.lcompose textarea').fill('Hi Sam,\n\nHappy to quote — what size is the patio?');
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/forms\/inbox\/l1\/reply$/.test(new URL(r.url()).pathname));
    await card.getByRole('button', { name: 'Send reply' }).click();
    expect((await post).postDataJSON()).toEqual({ body: 'Hi Sam,\n\nHappy to quote — what size is the patio?' });
    await expect(page.locator('.dds-toast')).toContainText('Sent to sam@example.com');
    const sent = page.locator('.lead').first();
    await expect(sent.locator('.lreply')).toContainText('what size is the patio?');
    await expect(sent.locator('.stchip')).toHaveText(/Replied/);
  });

  test('a send that fails keeps the words and says nothing went out', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/forms/inbox/l1/reply', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'not_sent', message: 'We couldn’t send that just now — nothing went out.' }) }));
    await page.goto('/leads.html');
    const card = page.locator('.lead').first();
    await card.getByRole('button', { name: 'Reply' }).click();
    await card.locator('.lcompose textarea').fill('Hi Sam, yes we can.');
    await card.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.locator('.dds-toast')).toContainText('nothing went out');
    await expect(card.locator('.lcompose textarea')).toHaveValue('Hi Sam, yes we can.');
    await expect(card.getByRole('button', { name: 'Send reply' })).toBeEnabled();
  });

  test('an untouched greeting is not sent', async ({ page }) => {
    let posts = 0;
    await installApp(page);
    page.on('request', (r) => { if (r.method() === 'POST' && /\/reply$/.test(new URL(r.url()).pathname)) posts++; });
    await page.goto('/leads.html');
    const card = page.locator('.lead').first();
    await card.getByRole('button', { name: 'Reply' }).click();
    await card.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Write your reply first.');
    expect(posts).toBe(0);
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
    // visual refresh: the page sits under a Website › Enquiries breadcrumb, with
    // the New enquiry action beside the title and counts on the Open/New chips
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Website' })).toHaveAttribute('href', '/presence.html');
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Enquiries');
    await expect(page.getByRole('button', { name: 'New enquiry' })).toBeVisible();
    await expect(page.locator('.filters [data-f="open"] .n')).toHaveText('2');
    await expect(page.locator('.filters [data-f="new"] .n')).toHaveText('1');
    await expect(page.locator('.filters [data-f="all"] .n')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a card carries the refreshed anatomy: initials avatar · kind chip · time · email · message · the action row', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    const sam = page.locator('.lead').filter({ hasText: 'Sam Rivera' });
    await expect(sam).toHaveClass(/\bnew\b/);                       // unread rows keep the accent edge
    await expect(sam.locator('.av')).toHaveText('SR');
    await expect(sam.locator('.kindtag')).toHaveText('Quote request');
    await expect(sam.locator('.when')).toContainText('ago');
    await expect(sam.locator('.contact a')).toHaveAttribute('href', 'mailto:sam@example.com');
    await expect(sam.locator('.msg')).toHaveText('Can I get a quote for a patio?');
    // the action row, in the board's order; Spam is the quiet one at the end
    const acts = sam.locator('.acts');
    await expect(acts.locator('button.reply[data-compose]')).toHaveText(/Reply/);   // opens the in-card composer (audit change 5)
    await expect(acts.locator('[data-deal]')).toHaveText('→ Deal');
    await expect(acts.locator('[data-convert]')).toHaveText('Make customer');
    await expect(acts.locator('[data-read]')).toHaveText('Mark read');
    await expect(acts.locator('[data-arch]')).toHaveText('Not a fit');
    await expect(acts.locator('button.quiet[data-spam]')).toHaveText(/Spam/);
    // a read row (Dana) shows no Mark read and a one-letter-pair avatar of its own
    const dana = page.locator('.lead').filter({ hasText: 'Dana Lee' });
    await expect(dana).not.toHaveClass(/\bnew\b/);
    await expect(dana.locator('[data-read]')).toHaveCount(0);
    await expect(dana.locator('.av')).toHaveText('DL');
  });

  test('the kind filter and the sort re-render the list only — the search input node survives', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    const q = page.locator('#q');
    await q.evaluate((el) => { (el as HTMLElement).dataset.marker = 'kept'; });
    // kind: only the quote request
    await page.locator('#kindf').selectOption('quote');
    await expect(page.locator('.lead')).toHaveCount(1);
    await expect(page.locator('.lead').first()).toContainText('Sam Rivera');
    await expect(page.locator('.lmeta')).toContainText('1 enquiry');
    // a kind nobody matches stays honest
    await page.locator('#kindf').selectOption('booking');
    await expect(page.locator('#main')).toContainText('No enquiries match that filter');
    await page.locator('#kindf').selectOption('all');
    await expect(page.locator('.lead')).toHaveCount(2);
    // sort: newest first by default (Sam, Jul 7), oldest flips it (Dana, Jul 2)
    await expect(page.locator('.lead').first()).toContainText('Sam Rivera');
    await page.locator('#sortf').selectOption('oldest');
    await expect(page.locator('.lead').first()).toContainText('Dana Lee');
    expect(await q.evaluate((el) => (el as HTMLElement).dataset.marker)).toBe('kept');
  });

  test('New enquiry logs a phone/walk-in enquiry through the EXISTING contact + deal routes, then opens the deal', async ({ page }) => {
    await installApp(page, { api: { '/sales/contacts': { data: { id: 'ct-9' } }, '/sales/deals': { data: { id: 'd-9' } } } });
    await page.goto('/leads.html');
    const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/presence/sales/')) posts.push({ path: new URL(r.url()).pathname.replace(/^.*\/presence/, ''), body: r.postDataJSON() }); });
    await page.getByRole('button', { name: 'New enquiry' }).click();
    const dlg = page.locator('dialog#newDlg[open]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#ne-name')).toBeFocused();
    await dlg.locator('#ne-name').fill('Pat Moreno');
    await dlg.locator('#ne-email').fill('pat@example.com');
    await dlg.locator('#ne-phone').fill('(818) 555-0101');
    await dlg.locator('#ne-msg').fill('Wants a quote for a patio');
    await dlg.getByRole('button', { name: 'Log enquiry' }).click();
    await page.waitForURL(/crm\.html\?deal=d-9&tab=deal/);
    // one contact, then one MANUAL deal on it — no new endpoint, no form submission id
    expect(posts.map((p) => p.path)).toEqual(['/sales/contacts', '/sales/deals']);
    expect(posts[0].body).toMatchObject({ name: 'Pat Moreno', email: 'pat@example.com', phone: '(818) 555-0101', notes: 'Enquiry: Wants a quote for a patio' });
    expect(posts[1].body).toMatchObject({ title: 'Pat Moreno', contact_id: 'ct-9', source: 'manual' });
    expect(posts[1].body).not.toHaveProperty('source_submission_id');
  });

  test('New enquiry with nothing filled in asks for a name, email, or phone — and posts nothing', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST') posts++; });
    await page.getByRole('button', { name: 'New enquiry' }).click();
    await page.locator('dialog#newDlg[open]').getByRole('button', { name: 'Log enquiry' }).click();
    await expect(page.locator('.dds-toast')).toContainText('A name, email, or phone is enough to start.');
    expect(posts).toBe(0);
    await expect(page.locator('dialog#newDlg[open]')).toBeVisible();   // still open to finish
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

  // ── Phase 1 overhaul: the record is the HUB — action bar + Billing tab ─────
  // Money actions live ON the record now (the same /sales routes pipeline.html
  // calls). "Send invoice" is two clicks from the customer, not a dozen.
  const HUB_RECORD = { data: {
    identity: { contact_id: null, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: PROJECT },
    header: { name: 'Marlow’s Kitchen', company: 'Marlow’s', email: 'm@example.com', phone: '', status: 'customer' },
    highlights: { value_cents: 320000, stage: 'won', owed_cents: 160000 },
    sections: { overview: true, details: true, deal: true, delivery: true },
    default_tab: 'details',
    canonical: { key: 'client', value: CLIENT },
  } };
  const HUB_DEAL = { data: {
    deal: { id: DEAL, title: 'Marlow’s Kitchen', stage: 'won', expected_value_cents: 320000, converted_client_id: 'cl-1' },
    proposals: [{ id: 'p-1', title: 'Proposal', status: 'draft', subtotal_cents: 320000 }],
    contracts: [{ id: 'k-1', title: 'Service agreement', status: 'signed', signer_name: 'Marlow' }],
    invoices: [
      { id: 'i-1', title: 'Deposit', purpose: 'deposit', amount_cents: 160000, status: 'paid', stripe_url: 'https://pay.test/a' },
      { id: 'i-2', title: 'Invoice', purpose: 'service', amount_cents: 160000, status: 'open', stripe_url: 'https://pay.test/b' },
    ],
  } };
  test('P1 — the action bar sends an invoice from the record in two clicks (POST /sales/deals/:id/invoice)', async ({ page }) => {
    await installApp(page, { api: { '/crm/record': HUB_RECORD, [`/sales/deals/${DEAL}`]: HUB_DEAL, '/crm/activity': activityFx(), [`/projects/${PROJECT}`]: { data: { project: { id: PROJECT, name: 'Marlow’s Kitchen', status: 'active' }, milestones: [], tasks: [], deliverables: [] } } } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.getByRole('tab', { name: 'Billing' })).toBeVisible();
    await page.locator('#act-invoice').click();                         // 1: the action bar
    await expect(page.getByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'true');
    await page.locator('#bf-amt').fill('1600');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(`/sales/deals/${DEAL}/invoice`));
    await page.locator('#bf-go').click();                               // 2: Send invoice
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ purpose: 'service', amount_cents: 160000 });
  });
  test('P1 — Billing lists invoices with Resend · Copy link · Void · View / print, and a won deal demotes the unsent draft', async ({ page }) => {
    await installApp(page, { api: { '/crm/record': HUB_RECORD, [`/sales/deals/${DEAL}`]: HUB_DEAL, '/crm/activity': activityFx(), [`/projects/${PROJECT}`]: { data: { project: { id: PROJECT, name: 'Marlow’s Kitchen', status: 'active' }, milestones: [], tasks: [], deliverables: [] } } } });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await expect(page.locator('.brow .schip.warn', { hasText: 'Awaiting payment' })).toHaveCount(1);
    await expect(page.locator('[data-send-inv="i-2"]')).toHaveText('Resend');
    await expect(page.locator('[data-copy="https://pay.test/b"]')).toBeVisible();
    await expect(page.locator('[data-void-inv="i-2"]')).toBeVisible();
    await expect(page.locator('[data-void-inv="i-1"]')).toHaveCount(0);   // a paid invoice cannot be voided
    await expect(page.locator('[data-doc="invoices:i-1"]')).toBeVisible();
    // stage-aware: the won deal's action bar does NOT headline the unsent draft proposal
    await expect(page.locator('#act-proposal')).toHaveCount(0);
    await expect(page.locator('#act-invoice')).toBeVisible();
    // Phase 3 (stage-aware): a won deal never offers to send the unsent draft —
    // Billing keeps the draft viewable, the Send control is gone
    await expect(page.locator('[data-send-prop="p-1"]')).toHaveCount(0);
    await expect(page.locator('[data-doc="proposals:p-1"]')).toBeVisible();
  });

  // Comms routing pin (F1/F3): an EMAIL-landed client message is a plain
  // kind:'message' timeline item on the record — it renders inline with the
  // support ticket chronologically (one conversation), and the composer replies
  // into the PROJECT thread, not a fresh support request.
  test('an email-landed client message renders in the ONE record timeline beside support — reply goes to the project', async ({ page }) => {
    await installApp(page, { api: {
      '/crm/record': RECORD,
      '/crm/activity': activityFx({
        items: [
          { id: 'conv:message:m2', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Replying by email — new hours attached.', at: '2026-07-12T00:00:00Z', meta: null, href: null },
          { id: 'conv:support:s1', kind: 'support', type: 'message', title: 'The client opened a support request — Old ticket', body: 'From before the fix', at: '2026-07-01T00:00:00Z', meta: 'Support · open', href: null },
        ],
        reply_to: `/projects/${PROJECT}/messages`,
        reply_support_to: '/support/s1/messages',
      }),
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    // both channels render in the ONE merged timeline (bodies expand on demand)
    await expect(page.getByText('The client sent a message')).toBeVisible();
    await expect(page.getByText('The client opened a support request — Old ticket')).toBeVisible();
    await page.locator('[data-x="conv:message:m2"]').click();
    await expect(page.getByText('Replying by email — new hours attached.')).toBeVisible();
    // with BOTH targets available the project thread wins (reply_to precedence)
    await page.locator('#msgBody').fill('Got it — updating now.');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes(`/projects/${PROJECT}/messages`));
    await page.locator('#msgForm button[type=submit]').click();
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ body: 'Got it — updating now.', audience: 'client' });
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

  // ── SS6: C3 saved-reply insert · ACT_SEQ · real tablist keyboard ───────────
  test('C3 — the record composer gains an Insert-saved-reply picker above #msgBody', async ({ page }) => {
    await installApp(page, { api: {
      '/crm/record': RECORD,
      '/crm/activity': activityFx({ reply_to: `/projects/${PROJECT}/messages` }),
      '/service/saved-replies': { data: { replies: [{ id: 'r1', title: 'Opening hours', body: 'We open at 9am.' }] } },
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const body = page.locator('#msgBody');
    await expect(body).toBeVisible();
    const pick = page.locator('select[aria-label="Insert a saved reply"]');
    await expect(pick).toBeVisible();
    await body.fill('Hi —');
    await pick.selectOption('r1');
    await expect(body).toHaveValue('Hi —\n\nWe open at 9am.');
    await expect(pick).toHaveValue('');   // reset for the next insert
  });

  test('C3 — no saved replies → no picker, no noise', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: {
      '/crm/record': RECORD,
      '/crm/activity': activityFx({ reply_to: `/projects/${PROJECT}/messages` }),
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#msgBody')).toBeVisible();
    await expect(page.locator('select[aria-label="Insert a saved reply"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('ACT_SEQ — a slow superseded activity load never repaints the rail', async ({ page }) => {
    await installApp(page, { api: { '/crm/record': RECORD } });
    const fx = (items: unknown[], upcoming: unknown[]) => JSON.stringify({ data: {
      items, upcoming, project_id: PROJECT, deal_id: DEAL, reply_to: null, reply_support_to: null,
    } });
    const item = (id: string, title: string) => ({ id, kind: 'message', type: 'message', title, body: null, at: '2026-07-10T00:00:00Z', meta: null, href: null });
    const tk = (id: string, title: string) => ({ kind: 'task', id, title, due: null, overdue: false, href: null });
    let call = 0;
    await page.route(/\/functions\/v1\/presence\/crm\/activity(\?|$)/, (route) => {
      call++;
      const fulfill = (b: string) => route.fulfill({ status: 200, contentType: 'application/json', body: b });
      if (call === 1) return fulfill(fx([item('i1', 'Baseline item')], [tk('t1', 'First to-do'), tk('t2', 'Second to-do')]));
      // call 2 (after the first checkbox) delays WITHOUT blocking the handler
      if (call === 2) { setTimeout(() => { fulfill(fx([item('i2', 'Stale item')], [tk('t2', 'Second to-do')])).catch(() => {}); }, 700); return; }
      return fulfill(fx([item('i3', 'Fresh item')], []));
    });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#timeline')).toContainText('Baseline item');
    await page.locator('[data-updone="t1"]').click();       // → activity call 2 (slow)
    await page.locator('[data-updone="t2"]').click();       // → activity call 3 (fast)
    await expect(page.locator('#timeline')).toContainText('Fresh item');
    await page.waitForTimeout(900);                          // the stale response lands
    await expect(page.locator('#timeline')).toContainText('Fresh item');
    await expect(page.locator('#acard')).not.toContainText('Stale item');
  });

  test('E2 — both tablists honor the arrow-key contract (roving tabindex, selection follows focus)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'keyboard path once, on desktop');
    await installApp(page, { api: {
      '/crm/record': { data: {
        identity: { contact_id: 'ct-1', deal_id: DEAL, client_id: null, customer_site_id: CLIENT, project_id: PROJECT },
        header: { name: 'Marlow’s Kitchen', company: '', email: '', phone: '', status: 'customer' },
        highlights: {},
        sections: { overview: true, details: true, deal: true, delivery: true },
        default_tab: 'details',
        canonical: { key: 'client', value: CLIENT },
      } },
      '/crm/activity': activityFx(),
      '/sales/contacts/ct-1': { data: { contact: { id: 'ct-1', name: 'Sam' }, custom_fields: [], deals: [] } },
      '/sales/deals': { data: { deal: { id: DEAL, title: 'Site build', stage: 'qualified' }, proposals: [], contracts: [], invoices: [] } },
      ['/projects/' + PROJECT]: { data: { project: { id: PROJECT, name: 'Site', status: 'active' }, milestones: [], tasks: [], deliverables: [], progress: {} } },
    } });
    await page.goto(`/crm.html?client=${CLIENT}&tab=details`);
    // record-section tablist: roving tabindex + arrows move AND select
    const tabs = page.locator('.tabs[role=tablist] [data-tab]');
    await expect(tabs.first()).toHaveAttribute('tabindex', '0');
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(tabs.first()).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Home');
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    // composer tablist: same contract (the re-render must hand focus back)
    const ct = page.locator('.composer-tabs [role=tab]');
    await ct.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(ct.nth(1)).toBeFocused();
    await expect(ct.nth(1)).toHaveAttribute('aria-selected', 'true');
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

// ── The record page's own Edit / Delete for a contact ────────────────────────
// contacts.html hands a contact off to /crm.html?contact=…&tab=details, so the
// two actions Eric asked for have to exist here as well as on the row. The
// Details tab already DISPLAYED the owner's custom fields; the inline Edit now
// writes them too. Delete is the same two-step contract as the roster's: an
// unconfirmed DELETE writes nothing and returns what's attached.
test.describe('Client record — editing and removing the contact', () => {
  const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
  const SITE = 'cccccccc-3333-4333-8333-cccccccccccc';
  const CONTACT_RECORD = { data: {
    identity: { contact_id: CID, deal_id: null, client_id: null, customer_site_id: null, project_id: null },
    header: { name: 'Claud Beltran', company: 'Bacchus Kitchen + Wine Bar', email: 'claud.beltran@gmail.com', phone: '(626) 234-6081', status: 'customer' },
    highlights: {},
    sections: { overview: false, details: true, deal: false, delivery: false },
    default_tab: 'details',
    canonical: { key: 'contact', value: CID },
  } };
  const DETAIL = { data: {
    contact: { id: CID, name: 'Claud Beltran', company: 'Bacchus Kitchen + Wine Bar', email: 'claud.beltran@gmail.com', phone: '(626) 234-6081', custom: { referred_by: 'Walk-in' } },
    custom_fields: [{ key: 'referred_by', label: 'Referred by', type: 'text' }],
    deals: [], timeline: [], last_contacted_at: null,
  } };

  test('the inline Edit saves the four facts AND the owner’s custom fields', async ({ page }) => {
    await installApp(page, { api: { '/crm/record': CONTACT_RECORD, ['/sales/contacts/' + CID]: DETAIL } });
    let patched: Record<string, unknown> | null = null;
    await page.route(new RegExp('/functions/v1/presence/sales/contacts/' + CID), (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      patched = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: CID } }) });
    });
    await page.goto(`/crm.html?contact=${CID}&tab=details`);
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#ec-name')).toHaveValue('Claud Beltran');
    // the custom field the Details card already displayed is now editable here
    await expect(page.locator('#eccf-referred_by')).toHaveValue('Walk-in');
    await page.locator('#ec-phone').fill('(626) 234-6081 ext 2');
    await page.locator('#eccf-referred_by').fill('Referred by Hettie');
    await page.locator('#ec-save').click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'Saved.' }).first()).toBeVisible();
    expect(patched).toEqual({
      name: 'Claud Beltran', company: 'Bacchus Kitchen + Wine Bar', email: 'claud.beltran@gmail.com',
      phone: '(626) 234-6081 ext 2', custom: { referred_by: 'Referred by Hettie' },
    });
  });

  test('Delete warns with the attached history by name, and only removes the contact', async ({ page }) => {
    await installApp(page, { api: { '/crm/record': CONTACT_RECORD, ['/sales/contacts/' + CID]: DETAIL } });
    const writes: string[] = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/functions/v1/presence')) writes.push(`${r.method()} ${new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '')}${new URL(r.url()).search}`); });
    await page.route(new RegExp('/functions/v1/presence/sales/contacts/' + CID), (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      const confirmed = new URL(route.request().url()).searchParams.get('confirm') === '1';
      return confirmed
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, deleted: true, name: 'Claud Beltran', kept_items: ['1 deal', '1 signed agreement', '1 paid invoice', '1 project'] } }) })
        : route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
            error: 'has_history', name: 'Claud Beltran', has_history: true, converted: true,
            items: ['1 deal', '1 signed agreement', '1 paid invoice', '1 project'],
            message: 'Claud Beltran has 1 deal, 1 signed agreement, 1 paid invoice and 1 project. They became a customer. Removing them takes them off your contact list only — the deal, the agreement, the invoices and the project all stay exactly where they are, and nothing is deleted with them.',
          }) });
    });
    await page.goto(`/crm.html?contact=${CID}&tab=details`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#ec-del')).toBeVisible();

    // ONE dialog listener for the whole test — a per-click `once` races with
    // Playwright's auto-dismiss and the second dialog arrives already handled.
    const seen: string[] = [];
    let answer: 'dismiss' | 'accept' = 'dismiss';
    page.on('dialog', (d) => { seen.push(d.message()); answer === 'accept' ? d.accept() : d.dismiss(); });

    // FIRST: back out. The dry run has already happened; nothing else may write.
    await page.locator('#ec-del').click();
    await expect.poll(() => seen.length).toBe(1);   // the confirm follows the dry run, so wait on the dialog
    expect(writes).toEqual([`DELETE /sales/contacts/${CID}`]);
    // the confirm NAMED what is attached — not a generic "Are you sure?"
    expect(seen[0]).toContain('1 deal, 1 signed agreement, 1 paid invoice and 1 project');
    expect(seen[0]).toContain('nothing is deleted with them');

    // THEN: accept. Exactly one more write — the confirmed delete. Nothing cascades.
    answer = 'accept';
    await page.locator('#ec-del').click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'their 1 deal, 1 signed agreement, 1 paid invoice, 1 project stayed' }).first()).toBeVisible();
    expect(writes).toEqual([
      `DELETE /sales/contacts/${CID}`,
      `DELETE /sales/contacts/${CID}`,
      `DELETE /sales/contacts/${CID}?confirm=1`,
    ]);
  });
});
