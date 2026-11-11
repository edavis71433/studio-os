import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 184 (Nov 2026): a fuller monthly report and one Do next list per client.
// Settings › Monthly report says what the report holds, attaches a PDF copy (a switch) and
// downloads last month's (GET /report/monthly/pdf). The client's Overview shows one Do next
// list (GET /agency/sites/:id/do-next) from Needs you, health, Search, reviews, AI answers
// and the coach's ideas, with Done, Not relevant and Undo (POST …/do-next/decide). A coach
// idea opens the plan in the editor (#plan). Fake names only.

const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};

test.describe('Settings › Monthly report: what it holds, the PDF copy (builder list item 184)', () => {
  const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, scope: { site_id: CLIENT, name: 'Maple Street Studio' } } };
  const STATE = { enabled: true, note: '', last_month: null, last_result: null, tries: null, blocked: null, updated_by: null, updated_at: null, note_max: 600, next_month: '2026-11', pdf: true, ai_checks: false, ai_month: null, ai_result: null, ai_tries: null, ai_questions: 7, ai_cost: 'About 42 cents a month for 7 questions' };

  async function openReport(page: Page, pdf: (route: Route) => Promise<void> | void) {
    const puts: unknown[] = [];
    let state: Record<string, unknown> = { ...STATE };
    await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': CTX } as never });
    await page.route(/\/functions\/v1\/presence\/report\/monthly$/, (route) => {
      if (route.request().method() === 'PUT') { const b = route.request().postDataJSON(); puts.push(b); state = { ...state, ...b }; }
      return route.fulfill(json({ data: state }));
    });
    await page.route(/\/functions\/v1\/presence\/report\/monthly\/pdf$/, pdf);
    await page.goto(`/settings.html?client=${CLIENT}#report`);
    await expect(page.locator('#report')).toBeVisible();
    return puts;
  }
  const okPdf = (route: Route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="Maple-Street-Studio-October-2026.pdf"', 'Access-Control-Expose-Headers': 'Content-Disposition' }, body: '%PDF-1.4\n%%EOF\n' });

  test('the parts of the report as chips; AI answers says off until its check is on', async ({ page }) => {
    await openReport(page, okPdf);
    const sec = page.locator('#report');
    await expect(sec.locator('#reportInL')).toHaveText('In the report:');
    await expect(sec.locator('#reportIn li')).toHaveText(['Visitors', 'Enquiries', 'Google searches', 'AI answers, off', 'Reviews', 'Website health', 'Pages read most', 'What changed', 'PDF copy']);
    await expect(sec.locator('#reportIn li').nth(3)).toHaveClass(/off/);
    await expect(sec).toContainText('how they did on Google and in AI answers, their reviews, the website’s health');
    await sec.locator('#sw-ai').click();
    await expect(sec.locator('#reportIn li').nth(3)).toHaveText('AI answers');
    await expect(sec.locator('#reportIn li').nth(3)).not.toHaveClass(/off/);
  });

  test('Attach a PDF copy: on by default, saves as it flips, and the chip follows', async ({ page }) => {
    const puts = await openReport(page, okPdf);
    const sec = page.locator('#report');
    await expect(sec.locator('#sw-pdf')).toHaveAttribute('aria-checked', 'true');
    await sec.locator('#sw-pdf').click();
    await expect(sec.locator('#sw-pdf')).toHaveAttribute('aria-checked', 'false');
    expect(puts).toEqual([{ pdf: false }]);
    await expect(page.locator('.dds-toast').last()).toContainText('Off. The report goes without a PDF.');
    await expect(sec.locator('#reportIn li').last()).toHaveText('PDF copy, off');
  });

  test('Download last month’s PDF saves the file under its own name', async ({ page }) => {
    await openReport(page, okPdf);
    const sec = page.locator('#report');
    const [dl] = await Promise.all([page.waitForEvent('download'), sec.getByRole('button', { name: 'Download last month’s PDF' }).click()]);
    expect(dl.suggestedFilename()).toBe('Maple-Street-Studio-October-2026.pdf');
    await expect(sec.locator('#reportMsg')).toHaveText('Downloaded Maple-Street-Studio-October-2026.pdf.');
    await expect(sec.getByRole('button', { name: 'Download last month’s PDF' })).toBeEnabled();
  });

  test('a PDF that fails says so and changes nothing', async ({ page }) => {
    await openReport(page, (route) => route.fulfill(json({ error: 'failed' }, 502)));
    const sec = page.locator('#report');
    await sec.getByRole('button', { name: 'Download last month’s PDF' }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('The PDF didn’t download.');
    await expect(sec.locator('#reportMsg')).toHaveText('');
    await expect(sec.getByRole('button', { name: 'Download last month’s PDF' })).toBeEnabled();
  });

  test('phone width: the chips wrap, nothing wider than the screen', async ({ page }) => {
    await openReport(page, okPdf);
    await expect(page.locator('#reportIn li').first()).toBeVisible();
    await noSideScroll(page);
  });
});

test.describe('The client’s Overview: one Do next list (builder list item 184)', () => {
  const ctx = { data: {
    site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
    edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
    capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
    scope: { site_id: CLIENT, name: 'Maple Street Studio' }, site_live: true,
  } };
  const RECORD = { data: {
    identity: { contact_id: null, deal_id: null, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
    header: { name: 'Maple Street Studio', company: '', email: 'hello@example.com', phone: '', status: 'customer' },
    highlights: { value_cents: 0, stage: 'won', owed_cents: 0 },
    sections: { overview: true, messages: true, deal: false, delivery: false, details: false }, default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
  } };
  const QUIET = { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } };
  const SITE_ROW = {
    site_id: CLIENT, name: 'Maple Street Studio', edition: 'presence', state: 'live', state_words: 'Live', address: 'https://maplestreet.example', domain: 'maplestreet.example',
    domain_registrar: null, domain_expires_at: null, plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
    team: [], tags: [], published_at: '2026-11-04T00:00:00Z', updated_at: '2026-11-07T00:00:00Z', unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: null,
  };
  const ws = `/presence.html?client=${CLIENT}`;
  const ITEMS = [
    { key: 'enquiry:e1', source: 'needs', title: 'Reply to 2 enquiries', sub: 'Waiting since Monday', verb: 'Reply', href: `/inbox.html?site=${CLIENT}` },
    { key: 'health:links.internal_broken', source: 'health', title: 'Links to pages that aren’t there', sub: 'Links', verb: 'Fix', href: `${ws}#health` },
    { key: 'search:console', source: 'search', title: 'Connect Google Search Console', sub: 'See what people search to find them.', verb: 'Open', href: `${ws}#search` },
    { key: 'reviews:google', source: 'reviews', title: 'Reply to a Google review', sub: 'Replies show under the review on Google.', verb: 'Reply', href: `${ws}#search` },
    { key: 'ai:who-is-a-good-florist', source: 'ai', title: 'Claude doesn’t suggest them for “Who is a good florist?”', sub: 'A page that answers it, in their words, helps.', verb: 'Plan', href: `${ws}#search` },
    { key: 'idea:aaaaaaaa-0000-4000-8000-000000000001', source: 'idea', title: 'Post this weekend’s open studio as an update', sub: 'This week', verb: 'Open', href: `${ws}#plan` },
  ];

  async function openOverview(page: Page, doNext: ((route: Route) => Promise<void> | void) | null) {
    const scopes: string[] = [];
    const posts: unknown[] = [];
    let items = ITEMS.slice(), decided: Array<{ key: string; title: string; state: string; at: string }> = [];
    await installApp(page, { api: { '/portal/context': ctx, '/crm/record': RECORD, '/sales/summary': QUIET } });
    await page.route(/\/functions\/v1\/presence\/agency\/sites(\/|$|\?)/, (route) => route.fulfill(json({ data: [SITE_ROW], partial: false, can_open: true, can_pin: true, can_duplicate: true })));
    // registered after the sites list, so it answers first
    await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/do-next(\/decide)?$/, async (route) => {
      scopes.push(route.request().headers()['x-dds-scope-site'] ?? 'none');
      if (doNext) return doNext(route);
      if (route.request().method() === 'POST') {
        const b = route.request().postDataJSON(); posts.push(b);
        if (b.decision === 'undo') { const d = decided.find((x) => x.key === b.key); decided = decided.filter((x) => x.key !== b.key); const back = ITEMS.find((x) => x.key === d?.key); if (back) items = ITEMS.filter((x) => x === back || items.includes(x)); }
        else { items = items.filter((x) => x.key !== b.key); decided = [...decided, { key: b.key, title: b.title, state: b.decision, at: '2026-11-11T10:00:00Z' }]; }
      }
      return route.fulfill(json({ data: { items, more: 0, decided } }));
    });
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#client-site')).toBeVisible();
    return { scopes, posts };
  }

  test('one list from every source, each with its door, under their website and above their facts; read at studio level', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const { scopes } = await openOverview(page, null);
    const card = page.locator('#do-next');
    await expect(card.getByRole('heading', { name: 'Do next' })).toBeVisible();
    await expect(card.locator('.dn-h .n')).toHaveText('6 to do');
    await expect(card.locator('.dn-list li .dn-tag')).toHaveText(['Needs you', 'Health', 'Search', 'Reviews', 'AI answers', 'Idea']);
    const first = card.locator('.dn-list li').first();
    await expect(first.locator('.dn-t b')).toHaveText('Reply to 2 enquiries');
    await expect(first.locator('.dn-t span')).toHaveText('Waiting since Monday');
    await expect(first.getByRole('link', { name: 'Reply' })).toHaveAttribute('href', new RegExp(`^/inbox\\.html\\?site=${CLIENT}`));   // the shell keeps the client in the link
    await expect(card.locator('.dn-list li').last().getByRole('link', { name: 'Open' })).toHaveAttribute('href', `${ws}#plan`);
    const [deckBottom, top, factsTop] = await Promise.all([page.locator('#client-site').evaluate((n) => n.getBoundingClientRect().bottom), card.evaluate((n) => n.getBoundingClientRect().top), page.locator('#client-facts').evaluate((n) => n.getBoundingClientRect().top)]);
    expect(top).toBeGreaterThanOrEqual(deckBottom);
    expect(top).toBeLessThan(factsTop);
    expect(new Set(scopes)).toEqual(new Set(['']));
    expect(errors).toEqual([]);
  });

  test('Done takes it off for 30 days, Not relevant for good, and Show them brings both back with Undo', async ({ page }) => {
    const { posts } = await openOverview(page, null);
    const card = page.locator('#do-next');
    await card.getByRole('button', { name: 'Done: Reply to a Google review' }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('Done. It’s off the list for 30 days.');
    await expect(card.locator('.dn-list li')).toHaveCount(5);
    await card.getByRole('button', { name: 'Not relevant: Claude doesn’t suggest them for “Who is a good florist?”' }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('Off the list for good.');
    await expect(card.locator('.dn-h .n')).toHaveText('4 to do');
    expect(posts).toEqual([
      { key: 'reviews:google', decision: 'done', title: 'Reply to a Google review' },
      { key: 'ai:who-is-a-good-florist', decision: 'not_relevant', title: 'Claude doesn’t suggest them for “Who is a good florist?”' },
    ]);
    const more = card.locator('.dn-more');
    await expect(more).toHaveText('1 done and 1 not relevant this month · Show them');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(card.locator('.dn-more')).toHaveAttribute('aria-expanded', 'true');
    const done = card.locator('.dn-done li');
    await expect(done.locator('.dn-tag')).toHaveText(['Done', 'Not relevant']);
    await card.getByRole('button', { name: 'Undo: Reply to a Google review' }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('Back on the list.');
    await expect(card.locator('.dn-list:not(.dn-done) li')).toHaveCount(5);
    expect(posts[2]).toEqual({ key: 'reviews:google', decision: 'undo', title: '' });
  });

  test('a decision that fails to save says so and leaves the list as it was', async ({ page }) => {
    let calls = 0;
    await openOverview(page, (route) => {
      calls++;
      if (route.request().method() === 'POST') return route.fulfill(json({ error: 'write_failed', message: 'That didn’t save.' }, 502));
      return route.fulfill(json({ data: { items: ITEMS, more: 0, decided: [] } }));
    });
    const card = page.locator('#do-next');
    await card.getByRole('button', { name: 'Done: Reply to 2 enquiries' }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('That didn’t save.');
    await expect(card.locator('.dn-list li')).toHaveCount(6);
    await expect(card.getByRole('button', { name: 'Done: Reply to 2 enquiries' })).toBeEnabled();
    expect(calls).toBe(2);
  });

  test('nothing to do says so', async ({ page }) => {
    await openOverview(page, (route) => route.fulfill(json({ data: { items: [], more: 0, decided: [] } })));
    await expect(page.locator('#do-next .dn-h .n')).toHaveText('Nothing waiting');
    await expect(page.locator('#do-next')).toContainText('Nothing to do for this client right now.');
    await expect(page.locator('#do-next .dn-more')).toHaveCount(0);
  });

  test('a list that can’t be read: no card, the website and facts as they were', async ({ page }) => {
    await openOverview(page, (route) => route.fulfill(json({ error: 'failed' }, 500)));
    await expect(page.locator('#client-facts')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('#do-next')).toHaveCount(0);
  });

  test('phone width: each row stacks, the buttons are big enough to tap, nothing wider than the screen', async ({ page }) => {
    await openOverview(page, null);
    const row = page.locator('#do-next .dn-list li').first();
    await expect(row).toBeVisible();
    await noSideScroll(page);
    if ((page.viewportSize()?.width || 1280) <= 700) {
      const h = await row.getByRole('button', { name: /^Done:/ }).evaluate((b) => b.getBoundingClientRect().height);
      expect(h).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('A coach idea opens the plan in the editor (builder list item 184)', () => {
  const PAGE_API = {
    '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
    '/settings': { data: { blocks: [], section_meta: {}, pages: [] } },
    '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
    '/coach/opportunities': { data: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', area: 'seasonal', opportunity: 'Post this weekend’s open studio as an update', timing_phrase: 'This week', why_it_matters: 'People plan their weekends on Thursday.', expected_benefit: 'more visits', estimated_effort: 'ten minutes', suggested_next_step: 'Write a short update', supporting_evidence: [], ai_can_draft: false }] },
  };
  test('#plan opens Worth planning for with the coach’s ideas', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: PAGE_API as never });
    await page.goto('/presence.html#plan');
    await expect(page.locator('#deskTitle')).toContainText('Worth planning for');
    await expect(page.locator('#deskResults')).toContainText('Post this weekend’s open studio as an update');
    expect(errors).toEqual([]);
  });
});
