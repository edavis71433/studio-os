import { test, expect, type Page } from '@playwright/test';
import { installApp, onAsk } from './helpers/app';

// Builder item 212 (review finding 108): tests/presence/client_record_test.mjs used to
// read crm.html, pipeline.html, projects.html and customers.html as text. What those
// checks meant, and no existing browser test already proves, is proven here by what
// the pages do. Every write a test makes the page send is answered by a route the test
// registers on purpose and is listed in its `writes` check. Every name below is made up.
//   the record page (crm.html): its tabs, old links, the picker, the related-list cards
//     and their unscoped reads, the Path (fact line, forward button, convert link), the
//     timeline's fallback and its six icons, the Notes view, the composer's no-target
//     hint, ONE LINK's guards, and a stray convert message changing nothing
//   pipeline.html: ?embed=1 hides the shell and the list; the money guard on the
//     combined send; convert in embed mode tells the record and stays put
//   projects.html: ?embed=1 hides the shell, the list and the breadcrumb
//   customers.html: a row's own "Open record" opens the record

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';   // the customer's own site
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const PROJECT = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const NOTE_PINNED = 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
const NOTE_PLAIN = 'aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa';

const HEADER = { name: 'Juniper Floral Co.', person: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'customer' };
const record = (over: Record<string, unknown> = {}) => ({ data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: PROJECT },
  header: HEADER, highlights: { value_cents: 500000, stage: 'proposal', owed_cents: 0 },
  sections: { overview: true, messages: true, deal: true, delivery: true, details: true },
  default_tab: 'delivery', canonical: { key: 'client', value: CLIENT }, ...over,
} });
const DEAL_ROW = { id: DEAL, title: 'Website refresh', stage: 'proposal', expected_value_cents: 500000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null };
const dealRead = (over: Record<string, unknown> = {}) => ({ data: {
  deal: DEAL_ROW, contact: { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null,
  retainer_paid: { cents: 0, count: 0, last_at: null }, ...over,
} });
const PROJECT_READ = { data: {
  project: { id: PROJECT, name: 'Juniper website', status: 'active', client_visible: true },
  milestones: [], tasks: [], events: [], deliverables: [], approvals: [], progress: { total: 0, done: 0, pct: 0 },
} };
const activity = (over: Record<string, unknown> = {}) => ({ data: { items: [], upcoming: [], project_id: PROJECT, deal_id: DEAL, reply_to: null, reply_support_to: null, ...over } });
const API = (over: Record<string, unknown> = {}) => ({
  '/crm/record': record(),
  [`/sales/deals/${DEAL}`]: dealRead(),
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  [`/projects/${PROJECT}`]: PROJECT_READ,
  '/crm/activity': activity(),
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  [`/sales/contacts/${CID}`]: { data: { contact: { id: CID, name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '' }, custom_fields: [], deals: [] } },
  ...over,
});
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const DRAFT_PROP = { id: 'p-1', title: 'Website refresh', status: 'draft', version: 1, subtotal_cents: 500000, line_items: [{ label: 'Build', qty: 1, unit_cents: 500000 }] };
const DRAFT_CON = { id: 'k-1', title: 'Service agreement', status: 'draft', body: 'A deposit of 50% is due at signing.' };

// every write the page sends to the presence API, in order ("METHOD /path")
function watchWrites(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const m = r.method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
    const u = new URL(r.url());
    if (!u.pathname.includes('/functions/v1/presence/')) return;
    seen.push(`${m} ${u.pathname.replace(/^.*\/functions\/v1\/presence/, '')}`);
  });
  return seen;
}
// the presence paths the page asked for, with each request's scope header
function watchReads(page: Page): Array<{ path: string; query: string; scope: string | null }> {
  const seen: Array<{ path: string; query: string; scope: string | null }> = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() !== 'GET' || !u.pathname.includes('/functions/v1/presence/')) return;
    seen.push({ path: u.pathname.replace(/^.*\/functions\/v1\/presence/, ''), query: u.search, scope: r.headers()['x-dds-scope-site'] ?? null });
  });
  return seen;
}
const exact = (s: string) => new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');

test.describe('the record page (crm.html)', () => {
  test('the tabs read Activity, Details, Deal, Invoices, Project, Files, and the record opens on Activity', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: API() });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const tabs = page.getByRole('tablist', { name: 'Record sections' }).getByRole('tab');
    await expect(tabs).toHaveText(['Activity', 'Details', 'Deal', 'Invoices', 'Project', 'Files']);
    await expect(page.locator('#tab-activity')).toHaveAttribute('aria-selected', 'true');
    // the highlights are tiles, each a label over its value
    const first = page.locator('#hlpanel .hl').first();
    await expect(first.locator('.hl-k')).toBeVisible();
    const k = await first.locator('.hl-k').boundingBox();
    const v = await first.locator('.hl-v').boundingBox();
    expect(!!k && !!v && k!.y + k!.height <= v!.y + 1).toBe(true);
    expect(writes).toEqual([]);
  });

  test('old links keep working: ?tab=messages opens Activity (where the message box is), ?tab=overview opens Details', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: API({ '/crm/activity': activity({ reply_to: `/projects/${PROJECT}/messages` }) }) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=messages`);
    await expect(page.locator('#tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#msgBody')).toBeVisible();
    await page.goto(`/crm.html?client=${CLIENT}&tab=overview`);
    await expect(page.locator('#tab-details')).toHaveAttribute('aria-selected', 'true');
    expect(writes).toEqual([]);
  });

  test('with no client in the address it shows a picker, and reads no record and no profile', async ({ page }) => {
    const reads = watchReads(page);
    await installApp(page);
    await page.goto('/crm.html');
    await expect(page.getByRole('heading', { name: 'Open a client to see their record.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Customers →' })).toHaveAttribute('href', '/customers.html');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    expect(reads.filter((x) => /^\/crm\/(record|profile|activity)/.test(x.path))).toEqual([]);
  });

  test('Deal and Project are cards that link out to pipeline and projects; nothing is framed, and their reads run unscoped', async ({ page }) => {
    const reads = watchReads(page);
    const writes = watchWrites(page);
    await installApp(page, { api: API() });
    await page.goto(`/crm.html?client=${CLIENT}&tab=deal`);
    await expect(page.getByRole('link', { name: 'Open in pipeline →' })).toHaveAttribute('href', `/pipeline.html?deal=${DEAL}&client=`);
    await page.getByRole('tab', { name: 'Project', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open project →' })).toHaveAttribute('href', `/projects.html?project=${PROJECT}&client=`);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('a[href*="embed=1"]')).toHaveCount(0);
    // the record is read in the customer's scope; the deal and the project live on the studio's own site
    const scopeOf = (p: string) => reads.find((x) => x.path === p)?.scope;
    expect(scopeOf('/crm/record')).toBe(CLIENT);
    expect(scopeOf(`/sales/deals/${DEAL}`)).toBeNull();
    expect(scopeOf(`/projects/${PROJECT}`)).toBeNull();
    expect(writes).toEqual([]);
  });

  test('the Path\'s fact line says both what happened and what to do next', async ({ page }) => {
    const writes = watchWrites(page);
    const declined = { ...DRAFT_PROP, status: 'declined', decided_at: '2026-11-06T18:00:00Z', expires_at: '2099-01-01T00:00:00Z' };
    await installApp(page, { api: API({ [`/sales/deals/${DEAL}`]: dealRead({ proposals: [declined] }) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#pathwrap .sn-fact')).toHaveText('They declined your proposal. Revise it and send it again, or mark the deal not a fit.');
    expect(writes).toEqual([]);
  });

  test('the Path\'s forward button names the next stage and moves the deal there', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: API() });
    let body: unknown = null;
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/stage`, (route) => { body = route.request().postDataJSON(); return route.fulfill(json({ data: { ...DEAL_ROW, stage: 'contract' } })); });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const fwd = page.locator('#markComplete');
    await expect(fwd).toHaveText('Move to Agreement out →');
    await fwd.click();
    await expect(page.locator('.dds-toast')).toContainText('Moved to Agreement out.');
    expect(body).toEqual({ to: 'contract' });
    await expect(page.locator('#pathwrap')).toContainText('Get the agreement signed to convert');   // the agreement isn't signed, so no further move
    expect(writes).toEqual([`POST /sales/deals/${DEAL}/stage`]);
  });

  test('once they have signed, the Path offers Convert as a link into the pipeline; a won deal offers nothing', async ({ page }) => {
    const writes = watchWrites(page);
    const signed = { id: 'k-1', title: 'Service agreement', status: 'signed', signer_name: 'Ivy Chen', signed_at: '2026-11-01T12:00:00Z' };
    await installApp(page, { api: API({ [`/sales/deals/${DEAL}`]: dealRead({ deal: { ...DEAL_ROW, stage: 'contract' }, contracts: [signed] }) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#pathwrap').getByRole('link', { name: 'Convert to customer →' })).toHaveAttribute('href', `/pipeline.html?deal=${DEAL}&client=`);
    await expect(page.locator('#markComplete')).toHaveCount(0);
    await expect(page.locator('#pathwrap .sn-fact')).toHaveText('They’ve signed. Convert them to a customer to start the project.');
    await installApp(page, { api: API({ [`/sales/deals/${DEAL}`]: dealRead({ deal: { ...DEAL_ROW, stage: 'won', converted_client_id: 'cl-1' }, contracts: [signed] }) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#pathwrap .pstep').first()).toBeVisible();
    await expect(page.locator('#pathwrap .path-side')).toBeEmpty();
    await expect(page.locator('#markComplete')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('when /crm/activity isn\'t there, the timeline comes from /crm/messages and /crm/timeline, each item as the server would type it', async ({ page }) => {
    const reads = watchReads(page);
    const writes = watchWrites(page);
    const at = (d: number, h = 9) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
    await installApp(page, { api: API({
      '/crm/messages': { data: { items: [
        { id: 'm1', kind: 'message', from: 'client', body: 'Can we swap the photo?', created_at: at(10) },
        { id: 's1', kind: 'support', from: 'client', subject: 'Login trouble', status: 'open', body: 'Link expired', created_at: at(9) },
        { id: 'r1', kind: 'support_reply', from: 'studio', body: 'Fresh link sent', created_at: at(9, 12) },
        { id: 'e1', kind: 'enquiry', from: 'client', subject: 'Website enquiry', body: 'A new site, please', created_at: at(1) },
        { id: 'b1', kind: 'booking', from: 'client', subject: 'Booked: Intro call', body: '', created_at: at(2) },
        { id: 'u1', kind: 'broadcast', from: 'studio', subject: 'Winter hours', body: '', created_at: at(3) },
        { id: 'a1', kind: 'activity', activity_kind: 'call', from: 'studio', body: 'Talked about photos', created_at: at(4) },
        { id: 'a2', kind: 'activity', activity_kind: 'email', from: 'studio', body: 'Sent the brief', created_at: at(5) },
        { id: 'a3', kind: 'activity', activity_kind: 'meeting', from: 'studio', body: 'Site visit', created_at: at(6) },
        { id: 'a4', kind: 'activity', activity_kind: 'note', from: 'studio', body: 'Prefers mornings', created_at: at(7) },
      ], project_id: PROJECT, reply_to: `/projects/${PROJECT}/messages`, reply_support_to: null } },
      '/crm/timeline': { data: { items: [
        { id: 'n1', kind: 'note', audience: 'internal', title: 'Note', detail: 'Ivy runs the shop', at: at(8) },
        { id: 'pb1', kind: 'publish', audience: 'shared', title: 'Published the site', at: at(8, 10) },
        { id: 'ld1', kind: 'lead', audience: 'shared', title: 'Quote request from Ivy Chen', detail: 'Needs a shop', at: '2026-10-30T09:00:00Z' },
      ], is_studio_view: true } },
      [`/sales/deals/${DEAL}/tasks`]: { data: [{ id: 't1', title: 'Collect the logo', status: 'done', completed_at: at(6, 12), created_at: at(1) }] },
    }) });
    await page.route('**/functions/v1/presence/crm/activity**', (route) => route.fulfill(json({ error: 'not_found', message: 'No route for GET /crm/activity.' }, 404)));
    await page.goto(`/crm.html?client=${CLIENT}`);
    const rows: Array<[string, string]> = [
      ['The client sent a message', 'message'], ['The client opened a support request — Login trouble', 'message'], ['You replied', 'message'],
      ['The client reached out from your website', 'message'], ['Booked: Intro call', 'call'], ['You sent an update — Winter hours', 'email'],
      ['You logged a call', 'call'], ['You logged an email', 'email'], ['You logged a meeting', 'call'], ['You added a note', 'note'],
      ['Note', 'note'], ['Published the site', 'system'], ['Quote request from Ivy Chen', 'system'], ['To-do completed — Collect the logo', 'task'],
    ];
    for (const [title, type] of rows) await expect(page.locator(`#timeline .ti.t-${type}`).filter({ has: page.locator('.ti-title', { hasText: exact(title) }) }), `${title} as ${type}`).toHaveCount(1);
    const classes = await page.locator('#timeline .ti').evaluateAll((els) => els.map((e) => (e.className.match(/\bt-(\w+)/) || [])[1]));
    expect(classes.length).toBe(rows.length);
    expect(classes.every((c) => ['message', 'email', 'call', 'task', 'note', 'system'].includes(String(c)))).toBe(true);
    // both old routes were asked, with the record's keys
    const msg = reads.find((x) => x.path === '/crm/messages');
    expect(msg?.query).toContain(`project=${PROJECT}`);
    expect(msg?.query).toContain('client_id=cl-1');
    expect(msg?.query).toContain(`deal=${DEAL}`);
    expect(reads.some((x) => x.path === '/crm/timeline')).toBe(true);
    expect(writes).toEqual([]);
  });

  test('each of the six timeline types gets its own icon', async ({ page }) => {
    const writes = watchWrites(page);
    const it = (id: string, kind: string, type: string, title: string, d: number) => ({ id, kind, type, title, body: null, at: `2026-11-${String(d).padStart(2, '0')}T09:00:00Z`, meta: null, href: null });
    await installApp(page, { api: API({ '/crm/activity': activity({ items: [
      it('x1', 'message', 'message', 'The client sent a message', 10), it('x2', 'broadcast', 'email', 'You sent an update — Winter hours', 9),
      it('x3', 'activity', 'call', 'You logged a call', 8), it('x4', 'task', 'task', 'To-do completed — Collect the logo', 7),
      it('x5', 'note', 'note', 'Shared note', 6), it('x6', 'deal_event', 'system', 'Moved to Won', 5),
    ] }) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const icons: string[] = [];
    for (const type of ['message', 'email', 'call', 'task', 'note', 'system']) {
      const row = page.locator(`#timeline .ti.t-${type}`);
      await expect(row, type).toHaveCount(1);
      icons.push(await row.locator('.ti-icon').innerHTML());
    }
    expect(new Set(icons).size).toBe(6);
    expect(writes).toEqual([]);
  });

  test('the Notes chip is a real notes view: the server\'s pinned-first order, Pin and Unpin', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: API({ '/crm/notes': { data: { notes: [
      { id: NOTE_PINNED, audience: 'internal', body: 'Ivy prefers mornings', pinned: true, created_at: '2026-11-01T09:00:00Z' },
      { id: NOTE_PLAIN, audience: 'shared', body: 'Sent the brief', pinned: false, created_at: '2026-11-05T09:00:00Z' },
    ], can_write_internal: true } } }) });
    const pins: unknown[] = [];
    await page.route('**/functions/v1/presence/crm/notes/*/pin', (route) => { pins.push([new URL(route.request().url()).pathname.split('/').slice(-2)[0], route.request().postDataJSON()]); return route.fulfill(json({ data: { ok: true } })); });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.locator('#fchips [data-f="note"]').click();
    const notes = page.locator('#timeline .ti.t-note');
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0).locator('.ti-title')).toHaveText('Pinned note');
    await expect(notes.nth(0).locator('.ti-meta')).toHaveText('Internal note');
    await expect(notes.nth(0).locator('[data-pin]')).toHaveText('Unpin');
    await expect(notes.nth(1).locator('.ti-title')).toHaveText('Note');
    await expect(notes.nth(1).locator('[data-pin]')).toHaveText('Pin');
    await notes.nth(1).locator('[data-pin]').click();
    await expect.poll(() => pins.length).toBe(1);
    await expect(page.locator('#timeline .ti.t-note')).toHaveCount(2);   // read again: the order is the server's
    await page.locator('#timeline .ti.t-note').nth(0).locator('[data-pin]').click();
    await expect.poll(() => pins.length).toBe(2);
    expect(pins).toEqual([[NOTE_PLAIN, { pinned: true }], [NOTE_PINNED, { pinned: false }]]);
    expect(writes).toEqual([`POST /crm/notes/${NOTE_PLAIN}/pin`, `POST /crm/notes/${NOTE_PINNED}/pin`]);
  });

  test('with no project and no open support thread, the message box says when replies open instead of offering a box', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: API({
      '/crm/record': record({ identity: { contact_id: null, deal_id: null, client_id: null, customer_site_id: CLIENT, project_id: null }, header: { ...HEADER, email: '' }, sections: { overview: true, messages: false, deal: false, delivery: false, details: false }, default_tab: 'overview' }),
      '/crm/activity': activity({ project_id: null, deal_id: null }),
    }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#composer')).toContainText('Replies open once this client has a project or an open support thread.');
    await expect(page.locator('#msgBody')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('ONE LINK: the three front buttons end with "Send proposal & agreement"; a won, converted or replaced draft never collapses the sends', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: API({ [`/sales/deals/${DEAL}`]: dealRead({ proposals: [DRAFT_PROP], contracts: [DRAFT_CON] }) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#actbar > .abtn')).toHaveText(['Log a call', 'Message', 'Send proposal & agreement']);
    await expect(page.locator('#act-send-both')).toHaveClass(/primary/);
    for (const [why, read] of [
      ['a won deal', dealRead({ deal: { ...DEAL_ROW, stage: 'won' }, proposals: [DRAFT_PROP], contracts: [DRAFT_CON] })],
      ['a deal already converted', dealRead({ deal: { ...DEAL_ROW, stage: 'contract', converted_client_id: 'cl-1' }, proposals: [DRAFT_PROP], contracts: [DRAFT_CON] })],
      ['a draft proposal that a newer one replaced', dealRead({ proposals: [{ ...DRAFT_PROP, line_items: [...DRAFT_PROP.line_items, { __meta__: { superseded_by: 'p-2' } }] }], contracts: [DRAFT_CON] })],
    ] as Array<[string, unknown]>) {
      await installApp(page, { api: API({ [`/sales/deals/${DEAL}`]: read }) });
      await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
      await expect(page.locator('[data-doc="contracts:k-1"]'), why).toBeVisible();
      await expect(page.locator('#sendBothBtn'), why).toHaveCount(0);
      await expect(page.locator('#act-send-both'), why).toHaveCount(0);
      await expect(page.locator('[data-send-con="k-1"]'), why).toHaveText('Send for signature');   // the agreement keeps its own send
    }
    expect(writes).toEqual([]);
  });

  test('a stray "deal converted" message changes nothing on the record (it has no frames to listen to)', async ({ page }) => {
    const reads = watchReads(page);
    const writes = watchWrites(page);
    await installApp(page, { api: API() });
    await page.goto(`/crm.html?client=${CLIENT}&tab=details`);
    await expect(page.locator('#tab-details')).toHaveAttribute('aria-selected', 'true');
    const url = page.url(), recordReads = reads.filter((x) => x.path === '/crm/record').length;
    await page.evaluate(() => { (window as unknown as { __stay: number }).__stay = 1; window.postMessage({ type: 'dds-deal-converted', project_id: 'p-new', site_id: 'site-new', client_id: 'c-new' }, location.origin); });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);   // no reload
    await expect(page.locator('#tab-details')).toHaveAttribute('aria-selected', 'true');
    expect(reads.filter((x) => x.path === '/crm/record').length).toBe(recordReads);
    expect(writes).toEqual([]);
  });
});

// ── pipeline.html ──
const DEAL7 = '77777777-7777-4777-8777-777777777777';
const DEAL8 = '88888888-8888-4888-8888-888888888888';
const CUSTOMER_SITE = 'cccccccc-9999-4999-8999-cccccccccccc';
const CONTACT = { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' };
const pipeDeal = (id: string, deal: Record<string, unknown>, rest: Record<string, unknown> = {}) => ({ data: {
  deal: { id, title: 'Marlow rebuild', stage: 'qualified', expected_value_cents: 500000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null, ...deal },
  contact: CONTACT, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null, ...rest,
} });
const PIPE_API = {
  '/sales/deals': { data: [{ id: DEAL7, title: 'Marlow rebuild', stage: 'contract', source: 'manual', expected_value_cents: 500000, expected_close: null, contact_id: 'ct-1', converted_client_id: null, updated_at: '2026-11-10T00:00:00Z', next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: true }] },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 500000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: '2026-11-10T00:00:00Z' }] },
  '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  '/identity': { data: { business_name: 'Test Studio' } },
  [`/sales/deals/${DEAL7}/tasks`]: { data: [] }, [`/sales/deals/${DEAL8}/tasks`]: { data: [] },
};
const SIGNED = { id: 'k-sg', title: 'Service agreement', status: 'signed', signer_name: 'Sam Rivera', signed_at: '2026-11-01T10:00:00.000Z', version: 1, terms_snapshot: null, body: 'A non-refundable deposit of 50% of the total project fee is due before work begins.' };

test.describe('pipeline.html, as the record\'s partner', () => {
  test('?embed=1 hides the shell\'s menu and search and the deal list', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: PIPE_API });
    await page.goto('/pipeline.html');
    await expect(page.locator('.dds-search')).toBeAttached();
    await expect(page.locator('#listWrap')).toBeVisible();
    await page.goto('/pipeline.html?embed=1');
    await expect(page.locator('html')).toHaveClass(/dds-embed/);
    await expect(page.locator('.dds-search')).toBeAttached();
    const shown = await page.evaluate(() => ['.dds-nav', '.dds-search', '#listWrap'].map((s) => [s, document.querySelector(s) ? getComputedStyle(document.querySelector(s) as Element).display : 'absent']));
    expect(shown).toEqual([['.dds-nav', 'none'], ['.dds-search', 'none'], ['#listWrap', 'none']]);
    expect(writes).toEqual([]);
  });

  test('the combined send runs the agreement\'s money guard too: declining sends nothing, agreeing sends the pair', async ({ page }) => {
    const writes = watchWrites(page);
    const valueless = { id: 'k-b', title: 'Service agreement', status: 'draft', signer_name: null, signed_at: null, version: 1, terms_snapshot: null, body: 'Project fee: [project fee]. A deposit of [50% deposit] is due at signing.' };
    const proposal = { id: 'p-b', title: 'Website build', status: 'draft', version: 1, line_items: [{ label: 'Build', qty: 1, unit_cents: 0 }], first_viewed_at: null, expires_at: null };
    await installApp(page, { api: { ...PIPE_API, [`/sales/deals/${DEAL8}`]: pipeDeal(DEAL8, { expected_value_cents: 0 }, { proposals: [proposal], contracts: [valueless] }) } });
    let sent: unknown = null;
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL8}/send`, (route) => { sent = route.request().postDataJSON(); return route.fulfill(json({ data: { proposal: { id: 'p-b', status: 'sent' }, contract: { id: 'k-b', status: 'sent' }, deposit: { minted: false } }, url: 'https://example.test/sign.html?t=flow', emailed: true })); });
    await page.goto(`/pipeline.html?deal=${DEAL8}&dtab=billing`);
    let asked = '';
    await onAsk(page, (q) => { asked = q; return false; });
    await page.locator('#sendBothBtn').click();
    await expect(page.locator('.dds-toast')).toContainText('Not sent — set the deal value in Details first.');
    expect(asked).toContain('the deal has no value set');
    expect(writes).toEqual([]);
    await onAsk(page, () => true);
    await page.locator('#sendBothBtn').click();
    await expect.poll(() => sent).toEqual({ proposal_id: 'p-b', contract_id: 'k-b' });
    expect(writes).toEqual([`POST /sales/deals/${DEAL8}/send`]);
  });

  test('converting inside the record (?embed=1) tells the record it happened and stays on the deal', async ({ page }) => {
    const writes = watchWrites(page);
    await page.addInitScript(() => { const w = window as unknown as { __msgs: unknown[] }; w.__msgs = []; window.addEventListener('message', (e) => w.__msgs.push(e.data)); });
    await installApp(page, { api: PIPE_API });
    let converted = false;
    await page.route((u) => new RegExp(`/presence/sales/deals/${DEAL7}(/convert)?$`).test(u.pathname), (route) => {
      if (route.request().method() === 'POST') { converted = true; return route.fulfill(json({ data: { converted: true, client_id: 'c-marlow', site_id: CUSTOMER_SITE, project_id: 'p-new', invited: true } })); }
      return route.fulfill(json(converted ? pipeDeal(DEAL7, { stage: 'won', converted_client_id: 'c-marlow', converted_site_id: CUSTOMER_SITE, created_project_id: 'p-new' }, { contracts: [SIGNED] }) : pipeDeal(DEAL7, { stage: 'contract' }, { contracts: [SIGNED] })));
    });
    await page.goto(`/pipeline.html?deal=${DEAL7}&embed=1&dtab=billing`);
    await page.evaluate(() => { (window as unknown as { __stay: number }).__stay = 1; });
    await page.locator('#convert').click();
    await page.locator('#convYes').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __msgs: Array<{ type?: string }> }).__msgs.filter((m) => m && m.type === 'dds-deal-converted')))
      .toEqual([{ type: 'dds-deal-converted', project_id: 'p-new', site_id: CUSTOMER_SITE, client_id: 'c-marlow' }]);
    // it stays: the same document (no reload, no navigation), still embedded, still on the deal
    expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
    await expect(page.locator('html')).toHaveClass(/dds-embed/);
    expect(new URL(page.url()).pathname).toBe('/pipeline.html');
    expect(new URL(page.url()).searchParams.get('deal')).toBe(DEAL7);
    expect(writes).toEqual([`POST /sales/deals/${DEAL7}/convert`]);
  });

  test('converting on the pipeline page itself sends no such message', async ({ page }) => {
    const writes = watchWrites(page);
    await page.addInitScript(() => { const w = window as unknown as { __msgs: unknown[] }; w.__msgs = []; window.addEventListener('message', (e) => w.__msgs.push(e.data)); });
    await installApp(page, { api: PIPE_API });
    let converted = false;
    await page.route((u) => new RegExp(`/presence/sales/deals/${DEAL7}(/convert)?$`).test(u.pathname), (route) => {
      if (route.request().method() === 'POST') { converted = true; return route.fulfill(json({ data: { converted: true, client_id: 'c-marlow', site_id: CUSTOMER_SITE, project_id: 'p-new', invited: true } })); }
      return route.fulfill(json(converted ? pipeDeal(DEAL7, { stage: 'won', converted_client_id: 'c-marlow', converted_site_id: CUSTOMER_SITE, created_project_id: 'p-new' }, { contracts: [SIGNED] }) : pipeDeal(DEAL7, { stage: 'contract' }, { contracts: [SIGNED] })));
    });
    await page.goto(`/pipeline.html?deal=${DEAL7}&dtab=billing`);
    await page.locator('#convert').click();
    await page.locator('#convYes').click();
    await expect.poll(() => converted).toBe(true);
    await expect(page.locator('.dds-toast')).toContainText('Converted');
    expect(await page.evaluate(() => (window as unknown as { __msgs: Array<{ type?: string }> }).__msgs.filter((m) => m && m.type === 'dds-deal-converted'))).toEqual([]);
    expect(writes).toEqual([`POST /sales/deals/${DEAL7}/convert`]);
  });
});

// ── projects.html ──
const PROJECTS_API = {
  '/projects': { data: [{ id: 'p1', name: 'Acme website build', status: 'active', client_visible: true, client_id: 'c-acme', deal_id: null, start_date: null, target_date: '2026-12-01', updated_at: '2026-11-10T00:00:00Z' }], is_studio_view: true },
  '/studio/customers': { data: [{ client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', status: 'active', customer_site_id: 'site-acme', open_support: 0, project_count: 1 }] },
  '/projects/progress': { data: {} },
  '/projects/p1': { data: { project: { id: 'p1', name: 'Acme website build', status: 'active', client_visible: true, client_id: 'c-acme', target_date: '2026-12-01' }, milestones: [], tasks: [], deliverables: [], approvals: [], progress: { pct: 0, done: 0, total: 0 }, is_studio_view: true } },
  '/projects/p1/report': { data: { summary: { progress: { pct: 0, done: 0, total: 0 }, milestones: { complete: 0, total: 0 }, open_client_actions: 0, pending_approvals: 0, shared_files: 0 } } },
  '/projects/p1/messages': { data: [] }, '/projects/p1/surveys': { data: [] }, '/projects/p1/client-messages': { data: [], customer: { name: 'Acme Bakery' } },
  '/support': { data: [] },
};

test.describe('projects.html, as the record\'s partner', () => {
  test('?embed=1 hides the shell\'s menu and search, the project list and the breadcrumb', async ({ page }) => {
    const writes = watchWrites(page);
    await installApp(page, { api: PROJECTS_API });
    await page.goto('/projects.html');
    await expect(page.locator('#listWrap')).toBeVisible();
    await page.goto('/projects.html?embed=1');
    await expect(page.locator('html')).toHaveClass(/dds-embed/);
    await expect(page.locator('.dds-search')).toBeAttached();
    const shown = await page.evaluate(() => ['.dds-nav', '.dds-search', '#listWrap'].map((s) => [s, document.querySelector(s) ? getComputedStyle(document.querySelector(s) as Element).display : 'absent']));
    expect(shown).toEqual([['.dds-nav', 'none'], ['.dds-search', 'none'], ['#listWrap', 'none']]);
    await page.goto('/projects.html?project=p1&embed=1');
    await expect(page.locator('#detailWrap')).toBeVisible();
    await expect(page.locator('#detailInner')).toContainText('Acme website build');
    const crumbs = await page.evaluate(() => [...document.querySelectorAll('.crumbs')].map((e) => getComputedStyle(e).display));
    expect(crumbs.length).toBeGreaterThan(0);
    expect(crumbs.every((d) => d === 'none')).toBe(true);
    expect(writes).toEqual([]);
  });
});

// ── customers.html ──
test.describe('customers.html, a way into the record', () => {
  test('a row\'s own "Open record" opens the record at the customer\'s site, or by their id when they have none', async ({ page }) => {
    const writes = watchWrites(page);
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'table'); } catch { /* denied */ } });
    await installApp(page, { api: { '/studio/customers': { data: [
      { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', project_name: 'Site', status: 'active', customer_site_id: 'site-acme', open_support: 0, project_count: 1 },
      { client_id: 'c-zeta', name: 'Zeta Gym', email: 'z@zeta.example', project_id: 'p3', project_name: 'Site', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 },
    ] } } });
    await page.goto('/customers.html');
    await page.locator('[data-rec="c-acme"]').first().click();
    await page.waitForURL(/\/crm\.html\?client=site-acme$/);
    await page.goto('/customers.html');
    await page.locator('[data-rec="c-zeta"]').first().click();
    await page.waitForURL(/\/crm\.html\?client_id=c-zeta$/);
    expect(writes).toEqual([]);
  });
});
