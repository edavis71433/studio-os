import { test, expect, type Page } from '@playwright/test';
import { installApp, OWNER_SESSION } from './helpers/app';

// ── The client's side, fixed from the Nov 10 2026 review ─────────────────────
// Findings G2, G3, G6 to G12 (reports/full-review-2026-11-10/bug-hunt/G-client-portal.md)
// and the small bugs from the live walk (../hands-on/client-portal-live-walk.md).
// Each test walks the real page against the hermetic fixtures; a dropped connection
// is a route.abort(), which is what a phone in a tunnel looks like to fetch.

const PID = '11111111-1111-4111-8111-111111111111';
const CLIENT_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
  sees_full_workspace: true, is_client_portal: false, is_managed_client: true, capabilities: ['view_all'],
  landing: '/client.html', attention_count: 0, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
} };
const REVIEWER_CTX = { data: { ...CLIENT_CTX.data, site_role: 'client_reviewer', is_managed_client: false, sees_full_workspace: false, is_client_portal: true, capabilities: ['view_shared'] } };
const FEED = { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } };
const BUNDLE = (over: Record<string, unknown> = {}) => ({ data: {
  project: { id: PID, name: 'Website redesign', status: 'active', target_date: '2026-08-01' },
  milestones: [], events: [], deliverables: [], surveys: [], approvals: [],
  tasks: [{ id: 't1', title: 'Send your logo', status: 'todo', client_action_required: true, source: 'manual', derived: { overdue: false } }],
  progress: { total: 4, done: 0, pct: 0 },
  ...over,
} });
const CLIENT_API: Record<string, unknown> = {
  '/portal/context': CLIENT_CTX,
  '/portal/feed': FEED,
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website redesign', status: 'active', target_date: '2026-08-01' }] },
  [`/client/projects/${PID}`]: BUNDLE(),
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/support': { data: [] },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: [{ id: 'inv-1', name: 'Deposit', amount: 500, status: 'open', due_date: '2099-07-20', pay_url: 'https://pay.example/inv-1' }], summary: { open_count: 1, paid_count: 0 } } },
};
const signIn = (page: Page, session: unknown = OWNER_SESSION) => page.addInitScript((s) => { (window as unknown as { __E2E_SESSION: unknown }).__E2E_SESSION = s; }, session);
const tab = (page: Page, t: string) => page.locator(`#tabnav [data-tab="${t}"]`).click();

test.describe('G2 — an email button keeps where it was going through the sign-in', () => {
  test('“Open your project” signed out → sign in → the project opens, once', async ({ page }) => {
    await installApp(page, { session: null, api: CLIENT_API });
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.getByText('Sign in to see your updates.')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dds-portal-return') || 'null')?.project)).toBe(PID);
    // the door signs them in and sends them to the bare portal address
    await signIn(page);
    await page.goto('/client.html');
    await expect(page.locator('#main h1')).toHaveText('Website redesign');
    expect(await page.evaluate(() => localStorage.getItem('dds-portal-return'))).toBeNull();
    // it's used once: the next visit is Home
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  });

  test('a tab named in the address (#invoices) survives the sign-in too; a stale one (over half an hour) is ignored', async ({ page }) => {
    await installApp(page, { session: null, api: CLIENT_API });
    await page.goto('/client.html#invoices');
    await expect(page.getByText('Sign in to see your updates.')).toBeVisible();
    await signIn(page);
    await page.goto('/client.html');
    // item 179 part four: invoices live on the Documents shelf — the address opens its Invoices filter
    await expect(page.locator('#main').getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await expect(page.locator('#shelf [data-shelf="invoices"]')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => localStorage.setItem('dds-portal-return', JSON.stringify({ tab: 'invoices', at: Date.now() - 31 * 60000 })));
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  });
});

test.describe('G3 — with no connection, buttons come back and say so', () => {
  test('Home: Approve with the network down → a try-again line and the button is live again', async ({ page }) => {
    await installApp(page, { api: { ...CLIENT_API, '/portal/feed': { data: { ...FEED.data, pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: '', decide_path: '/foundations/plans/p1/decide' }] } } } });
    await page.route('**/functions/v1/presence/foundations/plans/p1/decide', (r) => r.abort());
    await page.goto('/client.html');
    const approve = page.getByRole('button', { name: 'Approve — Protect your email' });
    await approve.click();
    await expect(page.locator('#toast')).toContainText('That didn’t go through — please try again.');
    await expect(approve).toBeEnabled();
  });

  test('the project page: Send with the network down keeps the message and the button', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.route(`**/functions/v1/presence/client/projects/${PID}/messages`, (r) => r.request().method() === 'POST' ? r.abort() : r.fallback());
    await page.goto(`/client.html?project=${PID}`);
    await page.locator('#msg').fill('Are we still on for Friday?');
    await page.locator('#send').click();
    await expect(page.locator('#toast')).toContainText('That didn’t send.');
    await expect(page.locator('#send')).toBeEnabled();
    await expect(page.locator('#msg')).toHaveValue('Are we still on for Friday?');
  });

  test('opening a project with no connection says so — never “that project isn’t available”', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.route(`**/functions/v1/presence/client/projects/${PID}`, (r) => r.abort());
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.getByText('We couldn’t load this project just now — please try again in a moment.')).toBeVisible();
    await expect(page.locator('#toast')).not.toContainText('isn’t available');
  });
});

// ── sign.html (G3 + G11) ──
const TOKEN = 'Zmxvdw.abc123';
const PROPOSAL = { id: 'p-1', title: 'Website build', status: 'sent', expired: false, currency: 'usd', terms: '',
  line_items: [{ label: 'Logo', qty: 0, unit_cents: 40000 }, { label: 'Build', qty: 1, unit_cents: 15000 }, { label: 'Pages', qty: 3, unit_cents: 10000 }] };
const flow = { data: { kind: 'flow', brand: { name: 'Test Studio', accent: '#5b3fa0' }, deal: { id: 'd-1', title: 'Acme website' },
  proposal: PROPOSAL, contract: { id: 'k-1', title: 'Service agreement', status: 'sent', locked: true }, deposit: { amount_cents: 25000, status: 'open', url: null } } };
async function serveSign(page: Page, opts: { getFails?: number; postAborts?: boolean } = {}) {
  let gets = 0; const posts: string[] = [];
  await page.route('**/functions/v1/presence/**', (route) => {
    const method = route.request().method();
    if (method === 'GET') { gets++; if (gets <= (opts.getFails || 0)) return route.abort(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flow) }); }
    posts.push(new URL(route.request().url()).pathname);
    if (opts.postAborts) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'accepted' } }) });
  });
  return { posts, gets: () => gets };
}

test.describe('sign.html — no signal, and the zero-quantity line', () => {
  test('G3: opened with no signal → “couldn’t load” with Try again (not “this link isn’t working”), and Try again works', async ({ page }) => {
    const s = await serveSign(page, { getFails: 1 });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.locator('h1')).toHaveText('We couldn’t load this just now');
    await expect(page.getByText('This link isn’t working')).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('h1')).toHaveText('Acme website');
    expect(s.gets()).toBe(2);
  });

  test('G3: Accept with no signal → the button is live again with a try-again line; the proposal stays', async ({ page }) => {
    await serveSign(page, { postAborts: true });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await page.locator('#accept').click();
    await expect(page.locator('#softErr')).toHaveText('We couldn’t reach your studio — check your connection and try again.');
    await expect(page.locator('#accept')).toBeEnabled();
    await expect(page.locator('#step-choose')).toBeVisible();
  });

  test('G11: a quantity-0 line reads × 0 and $0.00, and the lines add up to the total', async ({ page }) => {
    await serveSign(page);
    await page.goto(`/sign.html?t=${TOKEN}`);
    const rows = page.locator('#step-choose table tr');
    await expect(rows.filter({ hasText: 'Logo' })).toHaveText(/Logo × 0\s*\$0\.00/);
    await expect(rows.filter({ hasText: 'Pages' })).toHaveText(/Pages × 3\s*\$300\.00/);
    await expect(rows.filter({ hasText: 'Build' })).not.toContainText('×');
    await expect(rows.filter({ hasText: 'Total' })).toContainText('$450.00');
  });
});

// ── approve.html (G7) ──
async function serveApprove(page: Page, post: 'abort' | number, getAbort = false) {
  let gets = 0;
  await page.route('**/functions/v1/presence/approve**', (route) => {
    if (route.request().method() === 'GET') {
      gets++;
      if (getAbort && gets === 1) return route.abort();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { title: 'Protect your email', summary: 'Add email authentication.', kind: 'infrastructure', business_name: 'Marlow’s' } }) });
    }
    if (post === 'abort') return route.abort();
    const body = post === 400 ? { error: 'expired', message: 'This link has expired — open your workspace to review.' } : post === 409 ? { error: 'already_decided', message: 'This was already handled.' } : { error: 'boom' };
    return route.fulfill({ status: post, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
test.describe('G7 — the one-tap approval page tells a dead link from a dropped connection', () => {
  test('no signal on Approve → the buttons stay, with a line to try again', async ({ page }) => {
    await serveApprove(page, 'abort');
    await page.goto('/approve.html?token=tok');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('alert')).toContainText('That didn’t go through. Check your connection');   // sales item 92: no "your studio"
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Not yet' })).toBeEnabled();
    await expect(page.getByText('This link isn’t usable.')).toHaveCount(0);
  });
  test('a busy server (503) also keeps the buttons; too many tries (429) says to wait', async ({ page }) => {
    await serveApprove(page, 503);
    await page.goto('/approve.html?token=tok');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('alert')).toContainText('try again');
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await page.unrouteAll();
    await serveApprove(page, 429);
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('alert')).toContainText('wait a minute');
  });
  test('the server saying the link is spent (400) is still a dead link; already decided (409) says so', async ({ page }) => {
    await serveApprove(page, 400);
    await page.goto('/approve.html?token=tok');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('This link isn’t usable.')).toBeVisible();
    await page.unrouteAll();
    await serveApprove(page, 409);
    await page.goto('/approve.html?token=tok');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Already handled.')).toBeVisible();
  });
  test('opened with no signal → “couldn’t load”, the link is still good, and Try again loads it', async ({ page }) => {
    await serveApprove(page, 200, true);
    await page.goto('/approve.html?token=tok');
    await expect(page.getByText('We couldn’t load this just now.')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Protect your email' })).toBeVisible();
  });
});

// ── project-survey.html (G6) ──
test.describe('G6 — the older survey page sends once and says saved only when it is', () => {
  test('a double tap sends once; the thanks waits for the server', async ({ page }) => {
    let calls = 0;
    await page.route('**/functions/v1/clever-api', async (route) => { calls++; await new Promise((r) => setTimeout(r, 400)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, saved: true, emailed: true }) }); });
    await page.goto('/project-survey.html?c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await page.getByRole('button', { name: '3 stars' }).click();
    const send = page.locator('#sendBtn');
    await send.click();
    await send.click({ force: true }).catch(() => {});
    await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
    expect(calls).toBe(1);
  });
  test('no signal → the form stays with a try-again line and the button works again', async ({ page }) => {
    await page.route('**/functions/v1/clever-api', (route) => route.abort());
    await page.goto('/project-survey.html?c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await page.getByRole('button', { name: '5 stars' }).click();
    await page.locator('#sendBtn').click();
    await expect(page.getByRole('alert')).toHaveText('That didn’t send — check your connection and try again. Nothing is lost.');
    await expect(page.locator('#sendBtn')).toBeEnabled();
    await expect(page.locator('#surveyForm')).toBeVisible();
  });
  test('nothing saved and nothing emailed is not a success', async ({ page }) => {
    await page.route('**/functions/v1/clever-api', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, saved: false, emailed: false }) }));
    await page.goto('/project-survey.html');
    await page.getByRole('button', { name: '2 stars' }).click();
    await page.locator('#sendBtn').click();
    await expect(page.getByRole('alert')).toContainText('That didn’t send');
    await expect(page.getByRole('heading', { name: 'Thank you' })).toBeHidden();
  });
  test('an old link’s name is wiped from the address bar (the id stays)', async ({ page }) => {
    await page.goto('/project-survey.html?c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&n=Sam%20Rivera');
    await expect(page).toHaveURL(/project-survey(\.html)?\?c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/);
  });
});

test.describe('G9 — after paying, the portal doesn’t still say Pay', () => {
  test('Pay opens Stripe in the same tab (no second copy of the portal)', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await tab(page, 'documents');
    const pay = page.getByRole('link', { name: 'Pay — Deposit' });
    await expect(pay).toHaveAttribute('href', 'https://pay.example/inv-1');
    expect(await pay.getAttribute('target')).toBeNull();
    await tab(page, 'home');
    expect(await page.locator('#needs-body [data-pay]').getAttribute('target')).toBeNull();
  });
  test('a payment finished in another tab turns this tab’s Pay into “confirming”', async ({ page, context }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/client.html');
    await tab(page, 'documents');
    await expect(page.getByRole('link', { name: 'Pay — Deposit' })).toBeVisible();
    const other = await context.newPage();
    await other.goto('/payment-canceled.html');
    await other.evaluate(() => localStorage.setItem('dds-paid-pending', JSON.stringify({ id: 'inv-1', at: Date.now() })));
    await expect(page.getByText('Paid — confirming your payment.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pay — Deposit' })).toHaveCount(0);
    await other.close();
  });
  test('the cancelled-payment page goes back to the invoices', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.goto('/payment-canceled.html');
    await page.getByRole('link', { name: 'Back to your invoices →' }).click();
    await expect(page.locator('#main').getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await expect(page.locator('#shelf [data-shelf="invoices"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/client\.html$/);
  });
});

test.describe('G12 — no doomed reads for a reviewer, and old approval links reach the portal', () => {
  test('a reviewer’s second visit skips the projects read it is always refused', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': REVIEWER_CTX, '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } } } });
    const reads: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/client/projects')) reads.push(r.url()); });
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    expect(reads.length).toBe(1);   // the first visit can't know yet
    await page.goto('/client.html');
    await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(reads.length).toBe(1);
  });
  test('…and someone remembered as a reviewer who is now a client still gets their projects', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.addInitScript(() => localStorage.setItem('dds-portal-persona:e2e-owner', 'reviewer'));
    await page.goto('/client.html');
    await expect(page.locator('[data-proj]')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('dds-portal-persona:e2e-owner'))).toBeNull();
  });
  test('an old approval link: a client goes to their portal, the studio keeps the Inbox', async ({ page }) => {
    await installApp(page, { api: CLIENT_API });
    await page.addInitScript(() => { if (location.pathname.startsWith('/approval-center')) localStorage.setItem('dds-client-auth', '{"access_token":"x"}'); });
    await page.goto('/approval-center.html');
    await expect(page).toHaveURL(/\/client\.html$/);
  });
});

test.describe('the live walk — what a client sees', () => {
  test('Recent updates keeps owner asks (publish, Business details) off a client’s Home', async ({ page }) => {
    await installApp(page, { api: { ...CLIENT_API, '/portal/feed': { data: { ...FEED.data, moments: [
      { id: 'm1', moment_type: 'reminder', headline: '10 changes have waited 119 days to go live.', summary: 'Look them over, then publish. It’s one button.' },
      { id: 'm2', moment_type: 'needs_attention', headline: 'A few basics are missing.', summary: 'Add a phone number in Business details.' },
      { id: 'm3', moment_type: 'opportunity', headline: 'Help AI assistants recommend you.', summary: '' },
      { id: 'm4', moment_type: 'celebration', headline: 'More people are finding you lately.', summary: 'Visits are up.' },
    ] } } } });
    await page.goto('/client.html');
    const updates = page.locator('#home-updates');
    await expect(updates.getByText('More people are finding you lately.')).toBeVisible();
    await expect(updates.getByText('go live')).toHaveCount(0);
    await expect(updates.getByText('A few basics are missing.')).toHaveCount(0);
    await expect(updates.getByText('Help AI assistants recommend you.')).toHaveCount(0);
  });

  test('no “Good morning, j.”: a one-letter name is no name; statuses are said in words', async ({ page }) => {
    await installApp(page, { session: { ...OWNER_SESSION, user: { ...OWNER_SESSION.user, email: 'j@example.com', user_metadata: { name: 'j' } } }, api: CLIENT_API });
    await page.goto('/client.html');
    await expect(page.locator('#main h1').first()).toHaveText(/^Good (morning|afternoon|evening)\.$/);
    // item 179: the glance strip left Home — the project's status in words now
    // lives on the project card and the record chip alone
    await expect(page.locator('[data-proj]')).toContainText('Status: In progress');
    await expect(page.locator('[data-proj]')).toContainText('Just getting started');
    await expect(page.locator('[data-proj]')).not.toContainText('0% along');
    await page.locator('[data-proj]').click();
    await expect(page.locator('.statuschip')).toHaveText('In progress');
  });

  test('each of the studio’s asks points at where it’s done', async ({ page }) => {
    const tasks = [
      { id: 'c1', title: 'Send back your project questionnaire', status: 'todo', client_action_required: true, source: 'checklist:questionnaire_returned', derived: {} },
      { id: 'c2', title: 'Send your content and photos', status: 'todo', client_action_required: true, source: 'checklist:content_received', derived: {} },
      { id: 'c3', title: 'Review the design draft', status: 'todo', client_action_required: true, source: 'checklist:client_review', derived: {} },
    ];
    await installApp(page, { api: { ...CLIENT_API, [`/client/projects/${PID}`]: BUNDLE({ tasks }) } });
    await page.goto(`/client.html?project=${PID}`);
    const todos = page.locator('#sec-todos');
    // nothing sent yet: the questionnaire and the draft say so plainly; content points at the file box
    await expect(todos.locator('.card', { hasText: 'questionnaire' })).toContainText('Your studio sends the questionnaire by email.');
    await expect(todos.locator('.card', { hasText: 'Review the design draft' })).toContainText('Your studio will share the draft here for your OK.');
    await expect(todos.locator('.card', { hasText: 'Review the design draft' }).getByRole('button')).toHaveCount(0);
    // item 179 part two: the content ask opens its own page, with the file box right there
    await expect(todos.locator('.card', { hasText: 'questionnaire' }).getByRole('button', { name: 'Send it here' })).toBeVisible();
    await todos.locator('.card', { hasText: 'Send your content and photos' }).getByRole('button', { name: 'Send files' }).click();
    await expect(page.locator('#main h1')).toHaveText('Send your content and photos');
    await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  });

  test('…and once the studio has sent them, the questionnaire opens and the draft is one tap away', async ({ page }) => {
    const tasks = [
      { id: 'c1', title: 'Send back your project questionnaire', status: 'todo', client_action_required: true, source: 'checklist:questionnaire_returned', derived: {} },
      { id: 'c3', title: 'Review the design draft', status: 'todo', client_action_required: true, source: 'checklist:client_review', derived: {} },
    ];
    await installApp(page, { api: { ...CLIENT_API,
      [`/client/projects/${PID}`]: BUNDLE({ tasks, surveys: [{ id: 'sv1', title: 'Project questionnaire' }], approvals: [{ id: 'a1', subject_type: 'deliverable', title: 'Homepage draft', summary: '', content_hash: 'h1', status: 'pending' }] }),
      '/client/surveys/sv1': { data: { survey: { title: 'Project questionnaire', questions: [{ key: 'biz', label: 'Your business name', type: 'text' }] }, my_response: null } },
    } });
    await page.goto(`/client.html?project=${PID}`);
    const todos = page.locator('#sec-todos');
    await todos.getByRole('button', { name: 'Review it' }).click();
    await expect(page.locator('#sec-approvals [data-adec]')).toBeFocused();
    await todos.getByRole('button', { name: 'Open the questionnaire' }).click();
    await expect(page.locator('#main h1')).toHaveText('Project questionnaire');
  });

  test('Help: no articles yet → the basics, searchable — never an empty box', async ({ page }) => {
    await installApp(page, { api: { ...CLIENT_API, '/client/faq': { data: { html: '', faq: { items: [] } } } } });
    await page.goto('/client.html');
    await tab(page, 'help');
    await expect(page.locator('#faqStarter')).toHaveText('Your studio hasn’t added its own help articles yet, so here are the basics.');
    await expect(page.locator('#faqBody .faq-item')).toHaveCount(5);
    await page.locator('#faqSearch').fill('password');
    await expect(page.locator('#faqBody .faq-item:visible')).toHaveCount(1);
    await expect(page.locator('#faqBody .faq-item:visible summary')).toHaveText('How do I change my password?');
  });
});
