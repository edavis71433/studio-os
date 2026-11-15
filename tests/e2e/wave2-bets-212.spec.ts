import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_NAV } from './helpers/app';

// Builder item 212 (review finding 108): the wave 2 bets (docs/design/BENCHMARK-2026-10.md §7)
// that tests/presence/wave2_bets_test.mjs used to "check" by reading shell.js, shell.css,
// today.html, inbox.html and sales-ai.js as text, checked here by what the pages do. The
// rest of each bet is already in wave2-bets.spec.ts (and sales-ai-94.spec.ts); this file
// holds what nothing in the browser checked yet.
//   10  keyboard: the palette and the tour hold the plain keys; `?` twice; Shift+N; a
//       textarea, a select and an editable block; a modifier held; signed out; which button
//       `n` presses; the Inbox's three keys; the sheet as a shell layer; its key caps
//    8  the bell: one tablist of three; Clear never sends a made-up row; the priority accent;
//       the badge back when the count changes; opening it reads /portal/feed and nothing else
//    7  AI: at most four chips and never an empty one; the older `text` answer; Draft a reply
//       on a support request; in each composer Draft is a pill and the one filled button sends
// Hermetic like every spec, and every write a page sends here is answered on purpose and
// checked (see planWrites).

const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';   // a real (dismissible) notice id
const FEED_TAGGED = { data: {
  role: 'business_owner',
  moments: [{ id: 'm1', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', created_at: '2026-07-01T00:00:00Z', tier: 'update', priority: false }],
  notices: [
    { id: U, kind: 'lead_followup', period: 'lead:l1', dismissible: true, headline: 'A quote request is waiting for a reply', body: 'Sam reached out about a day ago.', href: '/inbox.html#enquiries?sel=lead:l1', tier: 'needs_you', priority: false },
    { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', kind: 'deal_followup', period: 'invremind:cccccccc-3333-4333-8333-cccccccccccc', dismissible: false, headline: 'Still unpaid: Deposit $1,600', body: 'Marlow’s Kitchen, due last week.', href: '/pipeline.html', tier: 'needs_you', priority: true },
    { id: 'dddddddd-4444-4444-8444-dddddddddddd', kind: 'invoice_paid', period: 'paid:x', dismissible: true, headline: 'Paid: Photos $400', body: 'Avery Stone paid this morning.', href: '/pipeline.html', tier: 'update', priority: false },
  ],
  pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide', tier: 'needs_you', priority: true }],
  last_published: null,
} };

const PROJECT = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const INBOX_FEED = { data: {
  role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null,
  client_messages: [
    { type: 'message', project: 'Site build', project_id: PROJECT, client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 3, thread_key: 'client:c-1', unread: true, href: `/crm.html?project=${PROJECT}&tab=messages`, tier: 'needs_you', priority: false },
    { type: 'support', id: 's-1', subject: 'Logo tweak', status: 'open', project: '', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, needs_reply: true, href: '/projects.html?support=s-1', tier: 'needs_you', priority: false },
  ],
  enquiries: [{ id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', status: 'new', created_at: '2026-07-13T00:00:00Z', thread_key: 'lead:l-9', unread: true, tier: 'needs_you', priority: false }],
} };
const INBOX_API = {
  '/portal/feed': INBOX_FEED,
  '/forms/inbox': { data: { submissions: [{ id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-07-13T00:00:00Z' }], unread: 1 } },
  '/notifications': { data: [], unread_count: 0 },
  '/crm/activity': { data: { upcoming: [], items: [{ id: 'i1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Hello, how is it going?', at: '2026-07-15T00:00:00Z', meta: null, href: null }], reply_to: `/projects/${PROJECT}/messages`, reply_support_to: null } },
  '/support/s-1': { data: {
    request: { id: 's-1', subject: 'Logo tweak', status: 'open', body: 'Please make the logo bigger.', created_at: '2026-07-14T00:00:00Z' },
    messages: [{ id: 'sm1', body: 'Bigger on the phone too, please.', author_kind: 'client', created_at: '2026-07-14T01:00:00Z' }],
    is_studio_view: true,
  } },
  '/service/saved-replies': { data: { replies: [] } },
};

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const pathOf = (url: string) => new URL(url).pathname.replace(/^.*\/functions\/v1\/presence/, '');
type Sent = { method: string; path: string; body: unknown };
// Every write the page sends must be one this test planned: each planned path (matched on the
// path after /presence, `*` standing for one segment) is answered by its handler and kept; any
// other write is answered 418 and kept as unplanned, so `done()` fails the test.
async function planWrites(page: Page, plan: Record<string, (body: unknown) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>>) {
  const sent: Sent[] = [], unplanned: string[] = [];
  const rules = Object.entries(plan).map(([p, h]) => [new RegExp('^' + p.replace(/[.?+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+') + '$'), h] as const);
  await page.route('**/functions/v1/presence/**', async (route: Route) => {
    const r = route.request();
    if (r.method() === 'GET' || r.method() === 'HEAD') return route.fallback();
    const path = pathOf(r.url()).split('?')[0];
    let body: unknown = null; try { body = r.postDataJSON(); } catch { body = r.postData(); }
    const rule = rules.find(([re]) => re.test(path));
    if (!rule) { unplanned.push(`${r.method()} ${path}`); return route.fulfill(json({ error: 'unplanned_write' }, 418)); }
    sent.push({ method: r.method(), path, body });
    const out = await rule[1](body);
    return route.fulfill(json(out.body, out.status)).catch(() => {});
  });
  return { sent, done: () => expect(unplanned, 'writes the test did not plan').toEqual([]) };
}
const ok200 = (data: unknown = { ok: true }) => () => ({ status: 200, body: { data } });
const shellReady = (page: Page) => expect(page.locator('#dds-shell .dds-nav')).toContainText('Inbox');
const nothingOpened = async (page: Page) => {
  await expect(page.locator('.dds-palette.open')).toHaveCount(0);
  await expect(page.locator('.dds-keys.open')).toHaveCount(0);
  await expect(page.locator('.dds-toast')).toHaveCount(0);
};

test.describe('Wave 2 bets, item 212', () => {
  // ── 10 · keyboard (shell.js) ──
  test.describe('keyboard', () => {
    test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop-chromium', 'keys need a keyboard'); });

    test('10: while the search or the tour is open the plain keys do nothing', async ({ page }) => {
      await installApp(page);
      const w = await planWrites(page, {});
      await page.goto('/today.html');
      await shellReady(page);
      await page.keyboard.press('/');
      const pal = page.locator('.dds-palette');
      await expect(pal).toHaveClass(/\bopen\b/);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());   // out of the search box, the search still open
      await expect(pal).toHaveClass(/\bopen\b/);
      await page.keyboard.press('?');
      await page.keyboard.press('n');
      await expect(page.locator('.dds-keys')).toHaveCount(0);
      await expect(page.locator('.dds-toast')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(pal).not.toHaveClass(/\bopen\b/);
      await page.evaluate(() => (window as unknown as { ddsTour: () => void }).ddsTour());
      const card = page.locator('.dds-tour-card');
      await expect(card).toBeVisible();
      for (const k of ['/', '?', 'n']) await page.keyboard.press(k);
      await nothingOpened(page);
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      await page.keyboard.press('?');                                        // the keys are live again
      await expect(page.locator('.dds-keys')).toHaveClass(/\bopen\b/);
      w.done();
    });

    test('10: `?` again puts the sheet away; Shift+N and keys with a modifier held do nothing; plain `n` still works', async ({ page }) => {
      await installApp(page, { api: INBOX_API });
      const w = await planWrites(page, { '/notifications/read': ok200() });
      await page.goto('/inbox.html#enquiries');
      await expect(page.locator('#newEnq')).toBeVisible();
      const sheet = page.locator('.dds-keys');
      await page.keyboard.press('?');
      await expect(sheet).toHaveClass(/\bopen\b/);
      await page.keyboard.press('?');
      await expect(sheet).not.toHaveClass(/\bopen\b/);
      await page.keyboard.press('Shift+N');
      for (const k of ['Alt+n', 'Control+n', 'Alt+/', 'Control+/']) await page.keyboard.press(k);
      await expect(page.locator('#newForm')).toBeHidden();
      await expect(page.locator('.dds-palette.open')).toHaveCount(0);
      await page.keyboard.press('n');
      await expect(page.locator('#newForm')).toBeVisible();
      w.done();
    });

    test('10: typing in a text box, a list or an editable block never fires a key', async ({ page }) => {
      await installApp(page);
      const w = await planWrites(page, {});
      await page.goto('/today.html');
      await shellReady(page);
      await page.evaluate(() => {
        const box = document.createElement('div');
        box.innerHTML = '<textarea id="e2eTa" aria-label="Notes"></textarea><select id="e2eSel" aria-label="Pick"><option>One</option><option>Two</option></select><div id="e2eCe" contenteditable="true" aria-label="Editable">Edit me</div>';
        document.body.appendChild(box);
      });
      for (const sel of ['#e2eTa', '#e2eSel', '#e2eCe']) {
        await page.locator(sel).focus();
        for (const k of ['/', '?', 'n']) await page.keyboard.press(k);
        await nothingOpened(page);
      }
      await expect(page.locator('#e2eTa')).toHaveValue('/?n');                  // the keys went where they were typed
      await expect(page.locator('#e2eCe')).toContainText('/?n');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('?');
      await expect(page.locator('.dds-keys')).toHaveClass(/\bopen\b/);
      w.done();
    });

    test('10: signed out, the keys do nothing', async ({ page }) => {
      await installApp(page, { session: null });
      const w = await planWrites(page, {});
      await page.goto('/today.html');
      await expect(page.locator('#dds-shell .dds-brand')).toContainText('Studio OS');
      for (const k of ['/', '?', 'n']) await page.keyboard.press(k);
      await expect(page.locator('.dds-palette')).toHaveCount(0);
      await expect(page.locator('.dds-keys')).toHaveCount(0);
      await expect(page.locator('.dds-toast')).toHaveCount(0);
      w.done();
    });

    test('10: `n` presses the [data-new] control first, else the first + / New / Add button, a filled one before a plain one, never a hidden, disabled or shell one', async ({ page }) => {
      await installApp(page);
      const w = await planWrites(page, {});
      await page.goto('/today.html');
      await shellReady(page);
      await page.evaluate(() => {
        const w = document.createElement('div');
        w.id = 'e2eNew';
        w.innerHTML = '<button type="button" id="bHidden" style="display:none">+ Hidden</button><button type="button" id="bOff" disabled>+ Turned off</button>'
          + '<button type="button" id="bAdd">Add a note</button><button type="button" id="bNew" class="primary">New invoice</button>'
          + '<a id="bLink" href="#later">+ A link</a><button type="button" id="bMarked" data-new>Start something</button>';
        document.body.appendChild(w);
        const win = window as unknown as { __pressed: string[] };
        win.__pressed = [];
        w.addEventListener('click', (e) => { e.preventDefault(); win.__pressed.push((e.target as HTMLElement).id); });
      });
      const pressed = () => page.evaluate(() => (window as unknown as { __pressed: string[] }).__pressed.splice(0));
      await page.keyboard.press('n');
      expect(await pressed()).toEqual(['bMarked']);
      await page.evaluate(() => document.getElementById('bMarked')!.remove());
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('n');
      expect(await pressed()).toEqual(['bNew']);                                // filled, though "Add a note" comes first
      await page.evaluate(() => { document.getElementById('bNew')!.className = ''; (document.activeElement as HTMLElement | null)?.blur(); });
      await page.keyboard.press('n');
      expect(await pressed()).toEqual(['bAdd']);                                // the first plain one; the hidden and the turned-off are passed over
      await page.evaluate(() => { for (const id of ['bAdd', 'bNew', 'bLink']) document.getElementById(id)!.remove(); (document.activeElement as HTMLElement | null)?.blur(); });
      await page.keyboard.press('n');
      expect(await pressed()).toEqual([]);                                      // only a hidden and a turned-off one are left: nothing to press
      await expect(page.locator('.dds-toast')).toContainText('Nothing to create on this page.');
      w.done();
    });

    test('10: on the Inbox the sheet lists its three keys, each with what it does', async ({ page }) => {
      await installApp(page, { api: INBOX_API });
      const w = await planWrites(page, { '/notifications/read': ok200() });
      await page.goto('/inbox.html');
      await expect(page.locator('#rows [role=option]').first()).toBeVisible();
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('?');
      const sheet = page.locator('.dds-keys');
      await expect(sheet.locator('.grp')).toHaveText('In the Inbox');
      const inboxRows = sheet.locator('.grp ~ .krow');
      await expect(inboxRows.locator('kbd')).toHaveText(['↑ ↓', 'Enter', 'Esc']);
      await expect(inboxRows.locator('span')).toHaveText(['Move between conversations', 'Open the conversation', 'Close a menu or sheet']);
      w.done();
    });

    test('10: the sheet is a shell layer: a click outside, the bell or the search closes it', async ({ page }) => {
      await installApp(page);
      const w = await planWrites(page, {});
      await page.goto('/today.html');
      await shellReady(page);
      const sheet = page.locator('.dds-keys');
      await page.keyboard.press('?');
      await expect(sheet).toHaveClass(/\bopen\b/);
      await page.locator('#greeting').click();
      await expect(sheet).not.toHaveClass(/\bopen\b/);
      await page.keyboard.press('?');
      await expect(sheet).toHaveClass(/\bopen\b/);
      await page.locator('#dds-bell').click();
      await expect(sheet).not.toHaveClass(/\bopen\b/);
      await expect(page.locator('.dds-bell-pop')).toHaveClass(/\bopen\b/);
      await page.keyboard.press('Escape');
      await page.keyboard.press('?');
      await expect(sheet).toHaveClass(/\bopen\b/);
      await page.keyboard.press('/');
      await expect(page.locator('.dds-palette')).toHaveClass(/\bopen\b/);
      await expect(sheet).not.toHaveClass(/\bopen\b/);
      w.done();
    });

    test('10: the sheet draws each key as a key cap', async ({ page }) => {
      await installApp(page);
      const w = await planWrites(page, {});
      await page.goto('/today.html');
      await shellReady(page);
      await page.keyboard.press('?');
      const cap = page.locator('.dds-keys kbd').first();
      await expect(cap).toBeVisible();
      const s = await cap.evaluate((el) => { const c = getComputedStyle(el); return { border: `${c.borderTopWidth} ${c.borderTopStyle}`, minWidth: c.minWidth, align: c.textAlign, radius: c.borderTopLeftRadius }; });
      expect(s.border).toBe('1px solid');
      expect(s.minWidth).toBe('46px');
      expect(s.align).toBe('center');
      expect(parseFloat(s.radius)).toBeGreaterThan(0);
      w.done();
    });
  });

  // ── 8 · the bell (shell.js, shell.css) ──
  test('8: the bell’s views are one tablist of three, and All brings every row back', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': FEED_TAGGED } });
    const w = await planWrites(page, {});
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    const list = pop.getByRole('tablist', { name: 'Notification views' });
    await expect(list.getByRole('tab')).toHaveText(['All', 'Needs you', 'Updates']);
    await expect(list.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    const rows = pop.locator('.body .row');
    await expect(rows).toHaveCount(5);
    await list.getByRole('tab', { name: 'Updates' }).click();
    await expect(rows).toHaveCount(2);
    await list.getByRole('tab', { name: 'All' }).click();
    await expect(rows).toHaveCount(5);
    await expect(list.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    await expect(list.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'false');
    w.done();
  });

  test('8: Clear sends only real notices, never a made-up row, even one marked dismissible', async ({ page }) => {
    const feed = { data: { ...FEED_TAGGED.data, notices: [
      ...FEED_TAGGED.data.notices,
      { id: 'new-enquiries', kind: 'website_enquiry', period: null, dismissible: true, headline: '2 new enquiries came in', body: 'Someone reached out.', href: '/inbox.html#enquiries', tier: 'needs_you', priority: false },
    ] } };
    await installApp(page, { api: { '/portal/feed': feed } });
    const w = await planWrites(page, { '/commerce/notices/dismiss': ok200({ ok: true }) });
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await expect(pop.locator('.body .row')).toHaveCount(6);
    await pop.getByRole('button', { name: 'Clear' }).click();
    await expect.poll(() => w.sent.map((s) => (s.body as { id: string }).id).sort()).toEqual([U, 'dddddddd-4444-4444-8444-dddddddddddd']);
    await expect(pop).toContainText('2 new enquiries came in');                      // the made-up row stays
    expect(w.sent.every((s) => s.method === 'POST' && s.path === '/commerce/notices/dismiss')).toBe(true);
    w.done();
  });

  test('8: a priority row carries the accent on its left edge; the others don’t', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': FEED_TAGGED } });
    const w = await planWrites(page, {});
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const rows = page.locator('.dds-bell-pop .body .row');
    await expect(rows).toHaveCount(5);
    const edge = (i: number) => rows.nth(i).evaluate((el) => { const c = getComputedStyle(el); return { width: c.borderLeftWidth, style: c.borderLeftStyle, color: c.borderLeftColor }; });
    const accent = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--dds-p)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color; probe.remove(); return c;
    });
    const pri = await edge(0), plain = await edge(2);
    expect(pri).toEqual({ width: '3px', style: 'solid', color: accent });
    expect(accent).not.toBe('rgba(0, 0, 0, 0)');
    expect(plain.color).toBe('rgba(0, 0, 0, 0)');
    w.done();
  });

  test('8: after Mark read the badge stays quiet only until the count changes', async ({ page }) => {
    const ctx = (n: number) => ({ data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
      is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false,
      capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: n, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
    } });
    await installApp(page, { api: { '/portal/context': ctx(2), '/portal/feed': FEED_TAGGED } });
    const w1 = await planWrites(page, {});
    await page.goto('/today.html');
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
    await page.locator('#dds-bell').click();
    await expect(page.locator('.dds-bell-pop .body .row')).toHaveCount(5);
    await page.getByRole('button', { name: 'Mark read' }).click();                 // the operator's own mark: nothing is sent
    await expect(page.locator('#dds-bell .dot')).toHaveCount(0);
    w1.done();
    // something new arrives: the server's count is 3 now
    await installApp(page, { api: { '/portal/context': ctx(3), '/portal/feed': FEED_TAGGED } });
    const w2 = await planWrites(page, {});
    await page.goto('/today.html');
    await shellReady(page);
    await expect(page.locator('#dds-bell .dot')).toHaveText('3');
    w2.done();
  });

  test('8: opening the bell reads /portal/feed and nothing else', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': FEED_TAGGED } });
    const w = await planWrites(page, {});
    await page.goto('/today.html');
    await shellReady(page);
    await page.waitForLoadState('networkidle');
    const asked: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/functions/v1/presence/')) asked.push(`${r.method()} ${pathOf(r.url())}`); });
    await page.locator('#dds-bell').click();
    await expect(page.locator('.dds-bell-pop .body .row')).toHaveCount(5);
    await page.waitForTimeout(300);
    expect(asked).toEqual(['GET /portal/feed']);
    w.done();
  });

  // ── 7 · AI shows its sources (today.html) ──
  test('7: Today shows at most four chips and never an empty one, and reads an answer sent in the older `text` key', async ({ page }) => {
    const answers = [
      { data: { answer: 'Your Saturday hours are missing.', source_labels: ['Your hours are missing', '', 'No hours on the Contact page', 'Google lists other hours', 'Your last publish was in May', 'A fifth thing'], low_confidence: false } },
      { data: { text: 'An older server said this.' } },
      { data: {} },
    ];
    await installApp(page);
    const w = await planWrites(page, { '/concierge/ask': () => ({ status: 200, body: answers.shift() }) });
    await page.goto('/today.html');
    const box = page.locator('#askAns');
    await page.locator('#q').fill('What should I do first?');
    await page.locator('#askBtn').click();
    await expect(box).toContainText('Your Saturday hours are missing.');
    await expect(box.locator('.src')).toHaveText(['Your hours are missing', 'No hours on the Contact page', 'Google lists other hours', 'Your last publish was in May']);
    await page.locator('#q').fill('And then?');
    await page.locator('#askBtn').click();
    await expect(box).toHaveText('An older server said this.');
    await expect(box.locator('.src')).toHaveCount(0);
    await page.locator('#q').fill('Anything else?');
    await page.locator('#askBtn').click();
    await expect(box).toContainText('I don’t have anything measured on that yet');   // neither key: the honest fallback, never a blank box
    expect(w.sent.map((s) => (s.body as { question: string }).question)).toEqual(['What should I do first?', 'And then?', 'Anything else?']);
    w.done();
  });

  // ── 7 · Draft a reply in the Inbox (inbox.html + sales-ai.js) ──
  test('7: Draft a reply on a support request asks AI help about that request; Send waits while it writes; nothing is sent, and never through the old writer', async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    const asked: string[] = [];
    await installApp(page, { api: INBOX_API });
    page.on('request', (r) => { if (r.url().includes('/functions/v1/presence/')) asked.push(pathOf(r.url())); });
    const w = await planWrites(page, {
      '/notifications/read': ok200(), '/threads/read': ok200(),
      '/sales/ai/draft': async () => { await held; return { status: 200, body: { data: { text: 'Hi Jo, a bigger logo is on its way, phone included.', from: 'this request' } } }; },
      '/support/*/messages': ok200({ sent: true }),
    });
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Logo tweak' }).first().click();
    const pane = page.locator('#rpane');
    await expect(pane.locator('#supBody')).toBeVisible();
    await pane.locator('#supBody').fill('Hi Jo,');
    const send = pane.locator('#supForm button.primary');
    await expect(send).toHaveText('Send');
    await pane.getByRole('button', { name: 'Draft a reply' }).click();
    await expect(pane.locator('.ai-band')).toContainText('Writing a draft from this request…');
    await expect(send).toBeDisabled();                                                // Send waits while it writes
    release();
    await expect(pane.locator('#supBody')).toHaveValue('Hi Jo, a bigger logo is on its way, phone included.');
    await expect(pane.locator('.ai-band')).toContainText('Drafted by AI from this request. Read it and change anything. Nothing is sent until you press Send.');
    await expect(pane.locator('.ai-band').getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(pane.locator('.ai-band').getByRole('button', { name: 'Undo draft' })).toBeVisible();
    await expect(send).toBeEnabled();
    const drafts = w.sent.filter((s) => s.path === '/sales/ai/draft');
    expect(drafts.length).toBe(1);
    expect(drafts[0].body).toMatchObject({ kind: 'support', id: 's-1', typed: 'Hi Jo,' });
    await pane.getByRole('button', { name: 'Undo draft' }).click();
    await expect(pane.locator('#supBody')).toHaveValue('Hi Jo,');
    expect(w.sent.filter((s) => s.path.includes('/messages'))).toEqual([]);          // nothing was sent
    expect(asked.filter((p) => p.startsWith('/writer/'))).toEqual([]);              // the old writer is never asked
    w.done();
  });

  test('7: in each Inbox composer Draft a reply is a pill, and the one filled button is the one that sends', async ({ page }) => {
    await installApp(page, { api: INBOX_API });
    const w = await planWrites(page, { '/notifications/read': ok200(), '/threads/read': ok200(), '/forms/inbox/*': ok200() });
    await page.goto('/inbox.html');
    const pane = page.locator('#rpane');
    const back = page.locator('#paneBack');
    // an enquiry not yet in the pipeline sends with "Reply & make it a deal" (the reply goes, and a deal is made)
    for (const [row, form, draft, sendLabel] of [['Sent you a message', '#msgForm', '#msgDraft', 'Send'], ['Logo tweak', '#supForm', '#supDraft', 'Send'], ['Sam Rivera', '#leadForm', '#leadDraft', 'Reply & make it a deal']] as const) {
      if (await back.isVisible()) await back.click();
      await page.locator('#rows [role=option]').filter({ hasText: row }).first().click();
      const pill = pane.locator(draft);
      await expect(pill).toBeVisible();
      await expect(pill).toHaveText('Draft a reply');
      await expect(pill).toHaveClass(/\bai-pill\b/);
      await expect(pill).not.toHaveClass(/\bprimary\b/);
      const f = pane.locator(form);
      await expect(f.locator(draft)).toHaveCount(1);                                // the pill sits in the composer it drafts for
      await expect(f.locator('button.primary')).toHaveCount(1);
      await expect(f.locator('button.primary')).toHaveText(sendLabel);
    }
    w.done();
  });
});
