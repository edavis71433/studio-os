import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Sales item 37 (Nov 2026, drawn in Figma and agreed): once a second person is on the
// team, every deal, to-do and request has an owner. Pipeline gets Everyone / Mine in
// front of the stage chips and each card shows its owner; the deal changes it. To-dos
// and Support open on Mine. With one person, nothing shows. Hermetic; names made up.

const ME = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', SAM = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const D1 = '11111111-1111-4111-8111-111111111111', D2 = '22222222-2222-4222-8222-222222222222', D3 = '33333333-3333-4333-8333-333333333333';
const TEAM_API = {
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', email: 'owner@example.com', member_id: 'm1' } },
  '/agency/members': { data: [
    { id: 'm1', email: 'owner@example.com', role: 'owner', status: 'active', user_id: ME },
    { id: 'm2', email: 'sam@example.com', role: 'designer', status: 'active', user_id: SAM },
    { id: 'm3', email: 'gone@example.com', role: 'designer', status: 'revoked', user_id: 'cccccccc-3333-4333-8333-cccccccccccc' },
  ] },
};
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const deal = (id: string, title: string, stage: string, owner: string | null) => ({ id, title, stage, source: 'manual', expected_value_cents: 100000, expected_close: null, contact_id: null, converted_client_id: null, assigned_to: owner, updated_at: past(1), created_at: past(3), next_step: null, next_step_at: null, last_contacted_at: null });
const DEALS = [deal(D1, 'Acme website', 'lead', ME), deal(D2, 'Birch booking', 'qualified', null), deal(D3, 'Cedar shop', 'proposal', SAM)];
const PIPE_API = {
  '/sales/deals': { data: DEALS },
  [`/sales/deals/${D3}`]: { data: { deal: { ...DEALS[2], notes: '', retainer: null }, contact: null, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null } },
  [`/sales/deals/${D3}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 3, open: { count: 3, value_cents: 300000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};
/** Every PATCH / POST the page sends to a path, with its body. */
function spy(page: Page, method: string, part: string) {
  const sent: unknown[] = [];
  page.on('request', (r) => { if (r.method() === method && new URL(r.url()).pathname.endsWith(part)) sent.push(r.postDataJSON()); });
  return sent;
}

test.describe('item 37 — Pipeline: owners, and Everyone / Mine', () => {
  test('the board shows each deal’s owner; Mine shows yours (a deal with no owner is the business owner’s) and is remembered', async ({ page }) => {
    await installApp(page, { api: { ...PIPE_API, ...TEAM_API } });
    await page.goto('/pipeline.html');
    await page.evaluate(() => { try { localStorage.removeItem('dds-pipeline-mine'); } catch { /* */ } });
    await page.reload();
    const bar = page.locator('#ownerBar');
    await expect(bar.getByRole('button', { name: 'Everyone 3' })).toHaveAttribute('aria-pressed', 'true');
    await expect(bar.getByRole('button', { name: 'Mine 2' })).toBeVisible();
    await expect(page.locator('#board .bcard')).toHaveCount(3);
    const cedar = page.locator('#board .bcard').filter({ hasText: 'Cedar shop' });
    await expect(cedar.locator('.own-b')).toHaveAttribute('aria-label', 'Owner: Sam');
    await expect(cedar.locator('.own-b')).toHaveClass(/mate/);
    await expect(page.locator('#board .bcard').filter({ hasText: 'Birch booking' }).locator('.own-b')).toHaveAttribute('aria-label', 'Owner: You');
    await bar.getByRole('button', { name: 'Mine 2' }).click();
    await expect(bar.getByRole('button', { name: 'Mine 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#board .bcard')).toHaveCount(2);
    await expect(page.locator('#board .bcard').filter({ hasText: 'Cedar shop' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#ownerBar').getByRole('button', { name: 'Mine 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#board .bcard')).toHaveCount(2);
    await page.locator('#ownerBar').getByRole('button', { name: 'Everyone 3' }).click();
    await expect(page.locator('#board .bcard')).toHaveCount(3);
  });

  test('the deal changes its owner, to someone on the team', async ({ page }) => {
    await installApp(page, { api: { ...PIPE_API, ...TEAM_API } });
    const sent = spy(page, 'PATCH', `/sales/deals/${D3}`);
    await page.goto(`/pipeline.html?deal=${D3}`);
    const owner = page.getByLabel('Owner', { exact: true });
    await expect(owner).toHaveValue(SAM);
    await expect(owner.locator('option')).toHaveText(['You', 'Sam']);   // a revoked seat isn't offered
    await owner.selectOption(ME);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ assigned_to: ME });
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('It’s yours now.');
  });

  test('the quick view of a deal shows its owner too', async ({ page }) => {
    await installApp(page, { api: { ...PIPE_API, ...TEAM_API } });
    const sent = spy(page, 'PATCH', `/sales/deals/${D1}`);
    await page.goto('/pipeline.html');
    await page.locator('#board .bcard').filter({ hasText: 'Acme website' }).click();
    const sel = page.locator('#dprev [data-own-sel]');
    await expect(sel).toHaveValue(ME);
    await sel.selectOption(SAM);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ assigned_to: SAM });
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Sam owns it now.');
  });

  test('with one person on the team nothing changes: no switch, no badges, no Owner', async ({ page }) => {
    await installApp(page, { api: PIPE_API });
    await page.goto(`/pipeline.html?deal=${D3}`);
    await expect(page.locator('#dtitle')).toBeVisible();
    await expect(page.locator('#dOwnSlot')).toBeHidden();
    await page.locator('#closeD').click();
    await expect(page.locator('#board .bcard')).toHaveCount(3);
    await expect(page.locator('#ownerBar')).toBeHidden();
    await expect(page.locator('#board .own-b')).toHaveCount(0);
  });

  test('on a phone the switch has its own row of 44px buttons and nothing scrolls sideways', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout');
    await installApp(page, { api: { ...PIPE_API, ...TEAM_API } });
    await page.goto('/pipeline.html');
    const mine = page.locator('#ownerBar').getByRole('button', { name: /^Mine/ });
    await expect(mine).toBeVisible();
    const box = await mine.boundingBox();
    expect(box && box.height >= 44).toBeTruthy();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const TASKS = { data: { items: [
  { kind: 'deal_task', id: 't1', parent_id: D1, title: 'Send the quote', due: today, context: 'Acme website', href: `/pipeline.html?deal=${D1}`, for: 'deal', blocked: false, owner: ME },
  { kind: 'deal_task', id: 't2', parent_id: D3, title: 'Call about the photos', due: today, context: 'Cedar shop', href: `/pipeline.html?deal=${D3}`, for: 'deal', blocked: false, owner: SAM },
  { kind: 'next_step', id: D2, parent_id: D2, title: 'Book the call', due: null, context: 'Birch booking', href: `/pipeline.html?deal=${D2}`, for: 'deal', blocked: false, owner: null },
  { kind: 'project_task', id: 'p1', parent_id: 'pr-1', title: 'Upload the team photos', due: null, context: 'Birch booking site', href: '/projects.html', for: 'project', blocked: false },
], total: 4, done: [
  { id: 'd1', title: 'Sent the welcome', context: 'Acme website', href: '/todos.html', completed_at: past(1), due: null, for: 'deal', owner: SAM },
], done_days: 30, partial: false } };

test.describe('item 37 — To-dos opens on Mine', () => {
  test('Mine is yours; Everyone shows the team’s with each owner; a new one can be a teammate’s', async ({ page }) => {
    await installApp(page, { api: { '/sales/tasks': TASKS, '/sales/contacts': { data: [] }, '/studio/customers': { data: [] }, '/sales/deals': { data: [] }, ...TEAM_API } });
    const posts = spy(page, 'POST', '/sales/tasks');
    await page.goto('/todos.html');
    const mine = page.getByRole('button', { name: 'Mine 3' }), all = page.getByRole('button', { name: 'Everyone 4' });
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tlist [data-row]')).toHaveCount(3);
    await expect(page.locator('#tlist')).not.toContainText('Call about the photos');
    await expect(page.locator('.ownc')).toHaveCount(0);   // Mine: every row is yours, so no owner chips
    await all.click();
    await expect(page.locator('#tlist [data-row]')).toHaveCount(4);
    await expect(page.locator('[data-row="deal_task:t2"] .ownc')).toHaveText('Sam');
    await expect(page.locator('[data-row="next_step:' + D2 + '"] .ownc')).toHaveText('Yours');
    await expect(page.locator('[data-row="project_task:p1"] .ownc')).toHaveCount(0);
    // done ones follow the switch too
    await page.locator('[data-show="done"]').click();
    await expect(page.locator('[data-done-row="d1"]')).toBeVisible();
    await page.getByRole('button', { name: /^Mine/ }).click();
    await expect(page.locator('[data-done-row="d1"]')).toHaveCount(0);
    // a new one for Sam
    await page.locator('[data-show="open"]').click();
    await page.getByLabel('What needs doing?').fill('Check the logo files');
    await page.getByLabel('Whose to-do it is').selectOption(SAM);
    await page.getByRole('button', { name: 'Add to-do' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ title: 'Check the logo files', assigned_to: SAM });
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Added for Sam: Check the logo files');
  });

  test('with one person on the team: no switch, no owner picker, everything listed', async ({ page }) => {
    await installApp(page, { api: { '/sales/tasks': TASKS, '/sales/contacts': { data: [] }, '/studio/customers': { data: [] }, '/sales/deals': { data: [] } } });
    await page.goto('/todos.html');
    await expect(page.locator('#tlist [data-row]')).toHaveCount(4);
    await expect(page.getByRole('button', { name: /^Mine/ })).toHaveCount(0);
    await expect(page.locator('#addOwner')).toHaveCount(0);
  });
});

const SUP_A = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee', SUP_B = 'ffffffff-6666-4666-8666-ffffffffffff';
const STUDIO_CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV } };
const sup = (id: string, subject: string, client: string, owner: string | null) => ({ type: 'support', id, subject, status: 'open', priority: 'normal', assigned_to: owner, project: '', client_id: 'c-' + id.slice(0, 4), client, created_at: past(0.1), thread_key: `support:${id}`, unread: true, href: '/projects.html' });
const INBOX_API = {
  '/portal/context': STUDIO_CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, enquiries: [], client_messages: [sup(SUP_A, 'Swap the hero photo', 'Northside Dental', null), sup(SUP_B, 'New opening hours', 'Harbor Yoga', SAM)] } },
  '/forms/inbox': { data: { submissions: [], unread: 0 } },
  '/notifications': { data: [], unread_count: 0 },
  [`/support/${SUP_A}`]: { data: { request: { id: SUP_A, subject: 'Swap the hero photo', status: 'open', priority: 'normal', assigned_to: null, body: 'The new one is attached', created_at: past(0.1) }, messages: [], is_studio_view: true } },
  ...TEAM_API,
};

test.describe('item 37 — Support opens on Mine', () => {
  test('Mine lists yours (one a client sent with no owner is the business owner’s); Everyone names each owner; the request changes it', async ({ page }) => {
    await installApp(page, { api: INBOX_API });
    const sent = spy(page, 'PATCH', `/support/${SUP_A}`);
    await page.goto('/inbox.html#support');
    const own = page.locator('#supOwn');
    await expect(own.getByRole('button', { name: 'Mine 1' })).toHaveAttribute('aria-pressed', 'true');
    const rows = page.locator('#rows').getByRole('option');
    await expect(rows.filter({ hasText: 'Northside Dental' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Harbor Yoga' })).toHaveCount(0);
    await own.getByRole('button', { name: 'Everyone 2' }).click();
    await expect(rows.filter({ hasText: 'Harbor Yoga' }).locator('.asg')).toHaveText('Sam');
    await expect(rows.filter({ hasText: 'Northside Dental' }).locator('.asg')).toHaveText('Yours');
    await rows.filter({ hasText: 'Northside Dental' }).click();
    const owner = page.getByRole('combobox', { name: /^Owner/ });   // the label wraps the picker, as Priority's does
    await expect(owner).toHaveValue(ME);   // no owner reads as the business owner
    await owner.selectOption(SAM);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ assigned_to: SAM });
  });
});
