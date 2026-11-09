import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Bold redesign — Projects (Nov 2026). The roster is a board by stage: Kickoff,
// Design & build, Review, Launch, then Done. Each card says who the project is
// for, how far along it is, whose move it is (waiting on the client, or yours)
// and when it's due. Chips with counts filter it in place; List is the sortable
// table it always was, and Calendar puts each project on its target date. Where
// a project stands comes from the server's one progress read (stage · next ·
// waiting · overdue), and a project the server can't place is never guessed.

const DAY = 86_400_000;
const ymd = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const P = (n: number) => `bbbbbbbb-0000-4000-8000-00000000000${n}`;
const LIST = { data: [
  { id: P(1), name: 'Booking page', status: 'active', client_visible: true, client_id: 'c-ortiz', target_date: ymd(33) },
  { id: P(2), name: 'Website build', status: 'active', client_visible: true, client_id: 'c-juniper', target_date: ymd(25) },
  { id: P(3), name: 'Online orders', status: 'active', client_visible: true, client_id: 'c-finch', target_date: ymd(3) },
  { id: P(4), name: 'Listings site', status: 'active', client_visible: true, client_id: 'c-maple', target_date: ymd(-2) },
  { id: P(5), name: 'Class booking', status: 'on_hold', client_visible: true, client_id: 'c-kestrel', target_date: null },
  { id: P(6), name: 'Website refresh', status: 'complete', client_visible: true, client_id: 'c-juniper', target_date: ymd(-20) },
  { id: P(7), name: 'Old flyer', status: 'archived', client_visible: true, client_id: null, target_date: null },
  { id: P(8), name: 'Odd jobs', status: 'active', client_visible: false, client_id: null, target_date: null },
], is_studio_view: true };
const CUSTOMERS = { data: [
  { client_id: 'c-ortiz', name: 'Ortiz Photography', person_name: 'Sam Ortiz' },
  { client_id: 'c-juniper', name: 'Juniper Floral Co.', person_name: 'Ivy Chen' },
  { client_id: 'c-finch', name: 'Blue Finch Café', person_name: 'Maya Ruiz' },
  { client_id: 'c-maple', name: 'Maple & Main Realty', person_name: '' },
  { client_id: 'c-kestrel', name: 'Kestrel Yoga', person_name: 'Kai Young' },
] };
const pr = (done: number, total: number) => ({ done, total, pct: Math.round((done * 100) / total) });
const PROGRESS = { data: {
  [P(1)]: { progress: pr(2, 10), pending_approvals: 0, stage: 'kickoff', next: { title: 'Send your content and photos', theirs: true, due_date: null }, waiting: { kind: 'task', title: 'Send your content and photos' }, overdue: 0 },
  [P(2)]: { progress: pr(7, 10), pending_approvals: 1, stage: 'review', next: { title: 'Apply the changes', theirs: false, due_date: null }, waiting: { kind: 'approval', title: 'Stacked logo' }, overdue: 0 },
  [P(3)]: { progress: pr(9, 10), pending_approvals: 0, stage: 'launch', next: { title: 'Point the domain', theirs: false, due_date: null }, waiting: null, overdue: 0 },
  [P(4)]: { progress: pr(8, 10), pending_approvals: 0, stage: 'review', next: { title: 'Check the listings', theirs: false, due_date: null }, waiting: null, overdue: 1 },
  [P(5)]: { progress: pr(3, 10), pending_approvals: 0, stage: 'design', next: null, waiting: null, overdue: 0 },
  [P(6)]: { progress: pr(10, 10), pending_approvals: 0, stage: 'launch', next: null, waiting: null, overdue: 0 },
  [P(7)]: { progress: pr(1, 1), pending_approvals: 0, stage: 'launch', next: null, waiting: null, overdue: 0 },
  [P(8)]: { progress: pr(1, 4), pending_approvals: 0, stage: null, next: { title: 'Call the printer', theirs: false, due_date: null }, waiting: null, overdue: 0 },
} };
const detail = (n: number) => ({ data: {
  project: { ...LIST.data[n - 1], description: '' }, milestones: [], tasks: [], deliverables: [], approvals: [],
  progress: PROGRESS.data[P(n)].progress, is_studio_view: true,
} });
const API: Record<string, unknown> = {
  '/projects': LIST,
  '/projects/progress': PROGRESS,
  '/studio/customers': CUSTOMERS,
  '/support': { data: [] },
};
for (const n of [2, 3]) {
  API[`/projects/${P(n)}`] = detail(n);
  API[`/projects/${P(n)}/report`] = { data: { summary: { progress: PROGRESS.data[P(n)].progress, pending_approvals: PROGRESS.data[P(n)].pending_approvals } } };
  API[`/projects/${P(n)}/messages`] = { data: [] };
  API[`/projects/${P(n)}/surveys`] = { data: [] };
  API[`/projects/${P(n)}/client-messages`] = { data: [], customer: null };
}
const col = (page: Page, k: string) => page.locator(`section[aria-labelledby="pcol-${k}"]`);
const card = (page: Page, n: number) => page.locator(`#list .card[data-id="${P(n)}"]`);

test.describe('Projects — the board (bold redesign)', () => {
  test('each project sits in its stage, with how far along it is and whose move it is', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(page.locator('#dispBoard')).toHaveAttribute('aria-pressed', 'true');
    // the columns, in delivery order — the one the server couldn't place first, never guessed
    await expect(page.locator('.pcol-h')).toHaveText(['No stage yet 1', 'Kickoff 1', 'Design & build 1', 'Review 2', 'Launch 1', 'Done 1']);
    await expect(col(page, 'none')).toContainText('Odd jobs');
    await expect(col(page, 'kickoff')).toContainText('Booking page');
    await expect(col(page, 'review').locator('.card')).toHaveCount(2);
    // who it's for, how far along
    await expect(card(page, 2).locator('.pc-c')).toHaveText('Juniper Floral Co.');
    await expect(card(page, 2).locator('.pc-pct')).toHaveText('70%');
    await expect(card(page, 8).locator('.pc-c')).toHaveText('Your studio');
    // whose move: the client's (by their first name), or yours
    await expect(card(page, 1).locator('.pc-chip')).toHaveText(['Waiting on Sam · Send your content and photos']);
    await expect(card(page, 2).locator('.pc-chip')).toHaveText(['Waiting on Ivy · Stacked logo', 'Your move · Apply the changes']);
    // late says how late; launching this week says when
    await expect(card(page, 4).locator('.pc-d.late')).toContainText('2 days late');
    await expect(card(page, 3).locator('.pc-chip.soon')).toContainText('Launching');
    await expect(card(page, 5).locator('.pc-chip')).toHaveText(['On hold']);
    await expect(card(page, 6).locator('.pc-chip')).toHaveText(['✓ Done']);
    // archived work stays off the board until asked for
    await expect(page.locator('#list')).not.toContainText('Old flyer');
    // the studio at a glance, under the title
    const meta = page.locator('.lmeta');
    for (const t of ['5 running', '2 waiting on them', '1 launching this week', '1 late', '1 on hold']) await expect(meta).toContainText(t);
  });

  test('the chips carry their counts and filter the board in place', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(page.locator('#filters .chip')).toHaveText(['All 7', 'Waiting on them 2', 'Late 1', 'Launching soon 1', 'On hold 1', 'Done 1', 'Archived 1']);
    await page.locator('#filters [data-view="waiting"]').click();
    await expect(page.locator('#list .card')).toHaveCount(2);
    await expect(page.locator('#list .card .pc-n')).toHaveText(['Booking page', 'Website build']);
    await expect(col(page, 'done')).toHaveCount(0);   // finished work isn't waiting on anyone
    await expect(page.locator('.lmeta')).toContainText('showing 2 projects');
    await page.locator('#filters [data-view="late"]').click();
    await expect(page.locator('#list .card .pc-n')).toHaveText(['Listings site']);
    await page.locator('#filters [data-view="archived"]').click();
    await expect(page.locator('#list .pgrid .card .pc-n')).toHaveText(['Old flyer']);
    // the search narrows whatever the chips show
    await page.locator('#filters [data-view="all"]').click();
    await page.locator('#q').fill('juniper');
    await expect(page.locator('#list .card .pc-n')).toHaveText(['Website build', 'Website refresh']);
  });

  test('an older server (no stages yet) keeps the running work in one column — no guessing', async ({ page }) => {
    const bare = { data: Object.fromEntries(Object.entries(PROGRESS.data).map(([k, v]) => [k, { progress: v.progress, pending_approvals: v.pending_approvals }])) };
    await installApp(page, { api: { ...API, '/projects/progress': bare } });
    await page.goto('/projects.html');
    await expect(page.locator('.pcol-h')).toHaveText(['In progress 6', 'Done 1']);   // the five running and the one on hold
    // an open approval still says who it's waiting on
    await expect(card(page, 2).locator('.pc-chip.wait')).toHaveText('Waiting on Ivy · an approval');
  });

  test('a card is a button: Enter opens the record, and coming back re-reads where that project stands', async ({ page }) => {
    await installApp(page, { api: API });
    const reads: string[] = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/projects/progress')) reads.push(u.searchParams.get('ids') || ''); });
    await page.goto('/projects.html');
    await expect(card(page, 2)).toBeVisible();
    expect(reads).toHaveLength(1);
    await card(page, 2).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dtitle')).toHaveText('Website build');
    await page.locator('#closeDetail').click();
    await expect(card(page, 2)).toBeFocused();
    await expect.poll(() => reads.length).toBe(2);
    expect(reads[1]).toBe(P(2));   // just the project that was open
    await expect(card(page, 2).locator('.pc-pct')).toHaveText('70%');   // its card still tells the truth
  });

  test('+ New project sits in the header and opens the dialog', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await page.locator('.lhead #newProject').click();
    await expect(page.locator('#newDlg')).toBeVisible();
    await expect(page.locator('#np-name')).toBeFocused();
  });

  test('the client’s side: their turn, and no studio controls', async ({ page }) => {
    await installApp(page, { api: { ...API, '/projects': { ...LIST, is_studio_view: false } } });
    await page.goto('/projects.html');
    await expect(card(page, 1).locator('.pc-chip.wait')).toHaveText('Your turn · Send your content and photos');
    await expect(page.locator('#filters [data-view="waiting"]')).toHaveText('Waiting on you 2');
    await expect(page.locator('#newProject')).toHaveCount(0);
    await expect(page.locator('.pc-chip.mine')).toHaveCount(0);
  });

  test('a phone stacks the board — empty stages step aside, cards take the width', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: { ...API, '/projects/progress': { data: { ...PROGRESS.data, [P(3)]: { ...PROGRESS.data[P(3)], stage: 'review' } } } } });
    await page.goto('/projects.html');
    await expect(col(page, 'launch')).toBeHidden();   // nothing in it now
    await expect(col(page, 'review')).toBeVisible();
    const [cw, lw] = await Promise.all([card(page, 1).evaluate((e) => e.getBoundingClientRect().width), page.locator('#list').evaluate((e) => e.getBoundingClientRect().width)]);
    expect(Math.abs(cw - lw)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('no serious/critical axe violations on the board', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(card(page, 2)).toBeVisible();
    const r = await new AxeBuilder({ page }).include('#listWrap').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});

test.describe('Projects — the calendar (bold redesign)', () => {
  const CAL_API = { ...API, '/projects': { data: [
    { ...LIST.data[2], target_date: ymd(0) },   // Online orders, due today
    { ...LIST.data[0] },                          // Booking page, 33 days out
    { ...LIST.data[7] },                          // Odd jobs, no date
  ], is_studio_view: true } };
  const monthName = (offset: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };

  test('each project on its target date; the month steps and comes home; an entry opens the record', async ({ page }) => {
    await installApp(page, { api: CAL_API });
    await page.goto('/projects.html');
    await page.locator('#dispCal').click();
    await expect(page.locator('#dispCal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#calTitle')).toHaveText(monthName(0));
    const phone = page.viewportSize()!.width <= 960;   // a tablet or a phone gets the month as a list
    const where = phone ? page.locator('.cal-ag') : page.locator('table.cal-t');
    await expect(where).toBeVisible();
    await expect(phone ? page.locator('table.cal-t') : page.locator('.cal-ag')).toBeHidden();
    if (!phone) await expect(page.locator('td.cal-today')).toContainText('Online orders');
    await expect(where.locator(`[data-open="${P(3)}"]`)).toBeVisible();
    await expect(page.locator('.cal-note')).toContainText('1 running project has no date yet');
    // the month steps forward and back; "This month" comes home
    await page.locator('#calNext').click();
    await expect(page.locator('#calTitle')).toHaveText(monthName(1));
    await expect(page.locator('#calNext')).toBeFocused();
    await expect(where.locator(`[data-open="${P(3)}"]`)).toHaveCount(0);
    await page.locator('#calNow').click();
    await expect(page.locator('#calTitle')).toHaveText(monthName(0));
    await expect(page.locator('#calNow')).toHaveCount(0);
    // an entry is the way into the project
    await where.locator(`[data-open="${P(3)}"]`).click();
    await expect(page.locator('#dtitle')).toHaveText('Online orders');
  });

  test('the choice is remembered', async ({ page }) => {
    await installApp(page, { api: CAL_API });
    await page.goto('/projects.html');
    await page.locator('#dispCal').click();
    await expect(page.locator('#calTitle')).toBeVisible();
    await page.reload();
    await expect(page.locator('#dispCal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#calTitle')).toHaveText(monthName(0));
  });
});
