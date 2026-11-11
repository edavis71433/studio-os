import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Bug hunt C (Nov 10 2026), Projects.
// C7  a project marked complete (or renamed) in its record is where it now belongs on
//     the board when you go back — it used to sit in its old column until Refresh
// C11 the board, the record and its report send the studio's own day (?today=), so a
//     step due today isn't "overdue" from mid-afternoon Pacific
// C14 past 100 projects the roster reads on, a page at a time, and asks where each
//     stands 60 at a time — not only for the first 60; a list still cut says so

const DAY = 86_400_000;
const ymd = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const proj = (n: number, over: Record<string, unknown> = {}) => ({ id: P(n), name: `Project ${n}`, status: 'active', client_visible: true, client_id: null, target_date: ymd(30), ...over });
const facts = (stage: string) => ({ progress: { done: 1, total: 4, pct: 25 }, pending_approvals: 0, stage, next: null, waiting: null, overdue: 0 });
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const card = (page: Page, n: number) => page.locator(`#list .card[data-id="${P(n)}"]`);
const col = (page: Page, k: string) => page.locator(`section[aria-labelledby="pcol-${k}"]`);
const localDay = (page: Page) => page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); });

// a small studio: two running projects; the record's reads answer what the last write left
async function studio(page: Page) {
  const rows = [proj(1, { name: 'Website build' }), proj(2, { name: 'Booking page' })];
  const seen: string[] = [];
  await installApp(page, { api: { '/studio/customers': { data: [] }, '/support': { data: [] } } });
  await page.route((u) => /\/presence\/projects(\/|$)/.test(u.pathname), (route) => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/^.*\/presence/, '');
    seen.push(path + u.search);
    if (path === '/projects') return route.fulfill(json({ data: rows, is_studio_view: true }));
    if (path === '/projects/progress') return route.fulfill(json({ data: Object.fromEntries(rows.map((p) => [p.id, facts('review')])) }));
    const m = /^\/projects\/([0-9a-f-]{36})(\/[a-z-]+)?$/.exec(path);
    if (!m) return route.fulfill(json({ data: [] }));
    const p = rows.find((x) => x.id === m[1])!;
    if (m[2] === '/status' && req.method() === 'POST') { p.status = req.postDataJSON().to; return route.fulfill(json({ data: { ok: true } })); }
    if (!m[2] && req.method() === 'PATCH') { Object.assign(p, req.postDataJSON()); return route.fulfill(json({ data: p })); }
    if (m[2] === '/report') return route.fulfill(json({ data: { summary: { progress: { done: 1, total: 4, pct: 25 }, pending_approvals: 0 } } }));
    if (!m[2]) return route.fulfill(json({ data: { project: { ...p, description: '' }, milestones: [], tasks: [], deliverables: [], approvals: [], progress: { done: 1, total: 4, pct: 25 }, is_studio_view: true } }));
    return route.fulfill(json({ data: [] }));
  });
  return seen;
}

test.describe('Projects — the board follows the record (bug hunt C7)', () => {
  test('Mark complete, go back: the card has moved to Done', async ({ page }) => {
    await studio(page);
    await page.goto('/projects.html');
    await expect(card(page, 2)).toBeVisible();
    await expect(col(page, 'review').locator(`[data-id="${P(2)}"]`)).toHaveCount(1);
    await card(page, 2).click();
    await expect(page.locator('#dtitle')).toHaveText('Booking page');
    await page.locator('#statusBtn').click();
    await page.locator('[data-pstatus="complete"]').click();
    await expect(page.locator('.rec-sub .pill')).toHaveText('complete');
    await page.locator('#closeDetail').click();
    await expect(col(page, 'done').locator(`[data-id="${P(2)}"]`)).toHaveCount(1);
    await expect(col(page, 'review').locator(`[data-id="${P(2)}"]`)).toHaveCount(0);
    await expect(card(page, 2)).toBeFocused();   // back on the card you left
  });

  test('Rename, go back: the card has the new name', async ({ page }) => {
    await studio(page);
    await page.goto('/projects.html');
    await card(page, 1).click();
    await page.locator('#renameProj').click();
    await page.locator('#renInput').fill('Website build, phase two');
    await page.locator('#renSave').click();
    await expect(page.locator('#dtitle')).toHaveText('Website build, phase two');
    await page.locator('#closeDetail').click();
    await expect(card(page, 1)).toContainText('Website build, phase two');
  });

  test('archived from its record: gone from All when you go back, and focus has somewhere to land', async ({ page }) => {
    await studio(page);
    await page.goto('/projects.html');
    await card(page, 2).click();
    await page.locator('#statusBtn').click();
    await page.locator('[data-pstatus="archived"]').click();
    await expect(page.locator('.rec-sub .pill')).toHaveText('archived');
    await page.locator('#closeDetail').click();
    await expect(card(page, 2)).toHaveCount(0);
    await expect(page.locator('#filters [data-view="archived"]')).toContainText('1');
    await expect(page.locator('#list [data-id]').first()).toBeFocused();
  });
});

test.describe('Projects — overdue on your own day (bug hunt C11)', () => {
  test('the board, the record and its report all send the computer’s own day', async ({ page }) => {
    const seen = await studio(page);
    await page.goto('/projects.html');
    await expect(card(page, 1)).toBeVisible();
    const today = await localDay(page);
    await expect.poll(() => seen.find((s) => s.startsWith('/projects/progress'))).toContain(`&today=${today}`);
    await card(page, 1).click();
    await expect(page.locator('#dtitle')).toBeVisible();
    expect(seen).toContain(`/projects/${P(1)}?today=${today}`);
    expect(seen).toContain(`/projects/${P(1)}/report?today=${today}`);
  });
});

test.describe('Projects — every project, and where each one stands (bug hunt C14)', () => {
  async function many(page: Page, total: number) {
    const all = Array.from({ length: total }, (_, i) => proj(i + 1));
    const asked: string[][] = [], pages: number[] = [];
    await installApp(page, { api: { '/studio/customers': { data: [] }, '/support': { data: [] } } });
    await page.route((u) => /\/presence\/projects(\/|$)/.test(u.pathname), (route) => {
      const u = new URL(route.request().url()), path = u.pathname.replace(/^.*\/presence/, '');
      if (path === '/projects') {
        const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset') || 0);
        pages.push(offset);
        return route.fulfill(json({ data: all.slice(offset, offset + limit), is_studio_view: true }));
      }
      if (path === '/projects/progress') {
        const ids = (u.searchParams.get('ids') || '').split(',');
        asked.push(ids);
        return route.fulfill(json({ data: Object.fromEntries(ids.map((id) => [id, facts('design')])) }));
      }
      return route.fulfill(json({ data: [] }));
    });
    return { asked, pages };
  }

  test('230 projects: three pages read, and all 230 placed on the board, 60 to a question', async ({ page }) => {
    const { asked, pages } = await many(page, 230);
    await page.goto('/projects.html');
    await expect(page.locator('#filters [data-view="all"]')).toContainText('230');
    await expect(col(page, 'design').locator('.pcol-h')).toContainText('230');
    await expect(col(page, 'none')).toHaveCount(0);   // nobody left under "No stage yet"
    expect(pages).toEqual([0, 100, 200]);
    expect(asked.map((a) => a.length).sort((x, y) => y - x)).toEqual([60, 60, 60, 50]);
    expect(new Set(asked.flat()).size).toBe(230);
    await expect(page.locator('.lmeta')).not.toContainText('most recently changed');
  });

  test('a list still cut after five pages says so', async ({ page }) => {
    const { pages } = await many(page, 520);
    await page.goto('/projects.html');
    await expect(page.locator('.lmeta')).toContainText('only the 500 most recently changed are listed');
    expect(pages).toEqual([0, 100, 200, 300, 400]);
  });
});
