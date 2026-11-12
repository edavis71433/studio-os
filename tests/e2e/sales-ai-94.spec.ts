import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 94 (Nov 2026): AI help on the sales side and the month's goal, drawn in Figma
// first (page "Sales 94 · 105 · 93 · 120", parts 1 to 3) and approved by Eric. Draft it for
// me fills the Email box on a record (and Draft a reply the Inbox's boxes) and never sends;
// Where things stand sums a record up in three lines and a Next, kept with its date; both are
// off until the studio's owner switches AI help on in Settings, about 1¢ a press, 50 a day.
// The goal shows on Home and above Pipeline's board. Runs at all three sizes.
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'delete', 'export'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const HOUR = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();
const DEAL = 'dddddddd-1111-4111-8111-dddddddddddd', CID = 'cccccccc-1111-4111-8111-cccccccccccc';
const RECORD = { data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: null, customer_site_id: null, project_id: null },
  header: { name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'contact' },
  highlights: { stage: 'proposal', value_cents: 320000, next_step: 'Send revised logo' },
  sections: { overview: false, details: true, deal: true, delivery: false }, default_tab: 'deal', canonical: { key: 'deal', value: DEAL }, related_projects: [], related_deals: [],
} };
const ACTIVITY = { data: { upcoming: [], reply_to: null, reply_support_to: null, items: [
  { id: 'i1', kind: 'activity', type: 'call', title: 'You called Ivy · 12 min', body: 'Agreed the stacked logo; she’ll confirm colours by Friday.', at: ago(2), meta: null, href: null },
  { id: 'i2', kind: 'message', type: 'message', title: 'Ivy sent a message', body: 'Could we try the stacked version on the homepage?', at: ago(30), meta: null, href: null },
] } };
const EMAIL = { data: { to: { name: 'Ivy Chen', email: 'ivy@juniper.example' }, stopped: null, unsubscribed: false, as: 'Brightline Studio', from: 'hello@example.test', replies: 'inbox', reply_to: 'site@reply.example.test' } };
const REPLIES = { data: { replies: [{ id: 'r1', title: 'Thanks for reaching out', body: 'Thanks for reaching out!' }] } };
const RECORD_API = { '/portal/context': STUDIO_CTX, '/crm/record': RECORD, '/crm/activity': ACTIVITY, '/sales/email': EMAIL, '/service/saved-replies': REPLIES, '/sales/ai/summary': { data: { summary: null } } };
const LINES = ['Ivy liked the green stacked logo on Tuesday’s call and is waiting on your revised quote.', 'The $1,200 deposit is paid; the $650 balance is due Nov 18.', 'The website build is 70% done.'];
const DRAFT = 'Hi Ivy,\n\nThanks for the call on Tuesday. I’ll send the revised quote by Friday.\n\nBrightline Studio';
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
type Asked = { method: string; path: string; body: Record<string, unknown> | null };
// the AI presses answer from `answers` (one per press, the last repeats); every POST is kept
async function spyAi(page: Page, asked: Asked[], path: string, answers: Array<{ status: number; body: unknown; wait?: Promise<void> }>) {
  let n = 0;
  await page.route((u) => u.pathname.endsWith('/functions/v1/presence' + path), async (route: Route) => {
    const r = route.request(); if (r.method() !== 'POST') return route.fallback();
    asked.push({ method: 'POST', path, body: r.postDataJSON?.() ?? null });
    const a = answers[Math.min(n++, answers.length - 1)];
    if (a.wait) await a.wait;
    return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) }).catch(() => {});
  });
}
async function spySends(page: Page, sent: string[]) {
  await page.route((u) => /\/presence\/(sales\/email|forms\/inbox\/.+|projects\/.+\/messages)$/.test(u.pathname), (route: Route) => {
    if (route.request().method() === 'GET') return route.fallback();
    sent.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"sent":true}}' });
  });
}
async function openEmail(page: Page) {
  await page.goto(`/crm.html?deal=${DEAL}&tab=activity`);
  const tab = page.locator('#composer [data-ct="email"]');
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(page.locator('#emBody')).toBeVisible();
}

test.describe('sales item 94 — AI help and the month’s goal', () => {
  test('record: Where things stand sums them up in three lines and a Next, at the top of the rail', async ({ page }) => {
    const asked: Asked[] = [];
    await installApp(page, { api: RECORD_API });
    await spyAi(page, asked, '/sales/ai/summary', [{ status: 200, body: { data: { summary: { lines: LINES, next: 'send the revised quote by Friday.', at: new Date().toISOString() }, kept: true, cost_cents: 0.8, used_today: 1, day_limit: 50 } } }]);
    await page.goto(`/crm.html?deal=${DEAL}&tab=activity`);
    const card = page.locator('#aicard .ai-sum');
    await expect(card.getByRole('heading', { name: 'Where things stand' })).toBeVisible();
    await expect(card).toContainText('Three lines on Ivy and this deal, written from this record: calls, emails, money and to-dos.');
    await expect(card).toContainText('about 1¢');
    await noOverflow(page);
    await card.getByRole('button', { name: 'Sum them up' }).click();
    await expect(card.locator('li')).toHaveText(LINES);
    await expect(card.locator('.ai-next')).toHaveText('Next: send the revised quote by Friday.');
    await expect(card.locator('.ai-foot')).toHaveText('Written by AI from this record just now · check it before you rely on it');
    await expect(card.getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(asked).toHaveLength(1);
    expect(asked[0].body).toMatchObject({ deal: DEAL, contact: CID });
    await noOverflow(page);
  });

  test('record: a kept summary comes back with its date and what happened since, without asking again', async ({ page }) => {
    const asked: Asked[] = [];
    const at = ago(24 * 3);
    await installApp(page, { api: { ...RECORD_API, '/sales/ai/summary': { data: { summary: { lines: LINES, next: 'send the revised quote by Friday.', at } } } } });
    await spyAi(page, asked, '/sales/ai/summary', [{ status: 200, body: { data: { summary: { lines: LINES, next: 'call Ivy.', at: new Date().toISOString() } } } }]);
    await page.goto(`/crm.html?deal=${DEAL}&tab=activity`);
    const card = page.locator('#aicard .ai-sum');
    await expect(card.locator('li')).toHaveCount(3);
    const day = new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    await expect(card.locator('.ai-foot')).toHaveText(`Written by AI on ${day} · 2 new things since then · check it before you rely on it`);
    expect(asked).toHaveLength(0);
    await card.getByRole('button', { name: 'Refresh' }).click();   // Refresh asks again
    await expect(card.locator('.ai-next')).toHaveText('Next: call Ivy.');
    expect(asked).toHaveLength(1);
  });

  test('record: Draft it for me fills the Email box, says what it read, and Undo puts your words back; nothing is sent', async ({ page }) => {
    const asked: Asked[] = [], sent: string[] = [];
    await installApp(page, { api: RECORD_API });
    await spySends(page, sent);
    await spyAi(page, asked, '/sales/ai/draft', [{ status: 200, body: { data: { text: DRAFT, from: 'your call on Tuesday, Ivy’s messages and this deal', cost_cents: 0.9, used_today: 1, day_limit: 50 } } }]);
    await openEmail(page);
    const row = page.locator('#emBox .dm-t');
    await expect(row.getByRole('button', { name: 'Draft it for me' })).toBeVisible();
    await expect(row).toContainText('AI help · about 1¢ a draft');
    await expect(row.getByLabel('Insert a saved reply')).toBeVisible();   // the saved replies share the row
    await page.locator('#emSubject').fill('Following up on your quote');
    await page.locator('#emBody').fill('Hi Ivy,');
    await row.getByRole('button', { name: 'Draft it for me' }).click();
    await expect(page.locator('#emBody')).toHaveValue(DRAFT);
    const band = page.locator('#emBox .ai-band');
    await expect(band).toContainText('Drafted by AI from your call on Tuesday, Ivy’s messages and this deal. Read it and change anything. Nothing is sent until you press Send email.');
    expect(asked[0].body).toMatchObject({ kind: 'record', deal: DEAL, contact: CID, subject: 'Following up on your quote', typed: 'Hi Ivy,' });
    await noOverflow(page);
    await band.getByRole('button', { name: 'Undo draft' }).click();
    await expect(page.locator('#emBody')).toHaveValue('Hi Ivy,');
    await expect(page.locator('#emBox .ai-band')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send email' })).toBeEnabled();
    expect(sent).toEqual([]);
  });

  test('record: while it writes, Send waits and Cancel puts your words back', async ({ page }) => {
    const asked: Asked[] = [];
    let release = () => {};
    const wait = new Promise<void>((r) => { release = r; });
    await installApp(page, { api: RECORD_API });
    await spyAi(page, asked, '/sales/ai/draft', [{ status: 200, body: { data: { text: DRAFT, from: 'this deal' } }, wait }]);
    await openEmail(page);
    await page.locator('#emBody').fill('My own words');
    await page.getByRole('button', { name: 'Draft it for me' }).click();
    const band = page.locator('#emBox .ai-band');
    await expect(band).toContainText('Writing a draft from Ivy’s messages and this deal…');
    await expect(page.getByRole('button', { name: 'Send email' })).toBeDisabled();
    await band.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#emBody')).toHaveValue('My own words');
    await expect(page.getByRole('button', { name: 'Send email' })).toBeEnabled();
    release();
    await page.waitForTimeout(300);
    await expect(page.locator('#emBody')).toHaveValue('My own words');   // the late draft is dropped
  });

  test('record: AI help off says how to switch it on; the day’s limit and a failure say so, and the box is untouched', async ({ page }) => {
    const asked: Asked[] = [];
    await installApp(page, { api: RECORD_API });
    await spyAi(page, asked, '/sales/ai/draft', [
      { status: 409, body: { error: 'ai_off', can_switch: true, message: 'AI help is off. Switch it on in Settings, under Goal and AI help. It costs about 1¢ each time you press Draft or Sum up.' } },
      { status: 429, body: { error: 'day_limit', message: 'That’s 50 AI helps today (about 50¢). It starts again tomorrow.' } },
      { status: 502, body: { error: 'ai_failed', message: 'Couldn’t write a draft just now. Your message is as you left it.' } },
    ]);
    await openEmail(page);
    await page.locator('#emBody').fill('Hi Ivy,');
    const pill = page.getByRole('button', { name: 'Draft it for me' });
    const band = page.locator('#emBox .ai-band');
    await pill.click();
    await expect(band).toHaveClass(/warn/);
    await expect(band).toContainText('AI help is off. Switch it on in Settings, under Goal and AI help.');
    await expect(band.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings.html#goal');
    await expect(page.locator('#emBody')).toHaveValue('Hi Ivy,');
    await pill.click();
    await expect(band).toHaveText('That’s 50 AI helps today (about 50¢). It starts again tomorrow.');
    await pill.click();
    await expect(band).toHaveClass(/bad/);
    await expect(band).toContainText('Couldn’t write a draft just now. Your message is as you left it.');
    await expect(band.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('#emBody')).toHaveValue('Hi Ivy,');
    await noOverflow(page);
  });

  test('a person on their own (no rail): Where things stand sits above the tabs', async ({ page }) => {
    const contact = { data: { ...RECORD.data, identity: { ...RECORD.data.identity, deal_id: null }, highlights: {}, sections: { overview: false, details: true, deal: false, delivery: false }, default_tab: 'details', canonical: { key: 'contact', value: CID } } };
    await installApp(page, { api: { ...RECORD_API, '/crm/record': contact } });
    await page.goto(`/crm.html?contact=${CID}&tab=activity`);
    const card = page.locator('#aicardMain .ai-sum');
    await expect(card).toContainText('Three lines on Ivy, written from this record');
    await expect(page.locator('#aicard')).toBeEmpty();
    await noOverflow(page);
  });

  test('Inbox: Draft a reply on an enquiry reads the enquiry and your services, and Send stays yours', async ({ page }) => {
    const asked: Asked[] = [], sent: string[] = [];
    const lead = { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: ago(5) };
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, client_messages: [], enquiries: [{ ...lead, thread_key: 'lead:l-9', unread: true, tier: 'needs_you', priority: false }] } },
      '/forms/inbox': { data: { submissions: [lead], unread: 1 } }, '/notifications': { data: [], unread_count: 0 }, '/service/saved-replies': { data: { replies: [] } },
    } });
    await spySends(page, sent);
    await spyAi(page, asked, '/sales/ai/draft', [{ status: 200, body: { data: { text: 'Hi Sam,\n\nYes, we can quote a patio. Would Thursday suit for a look?\n\nBrightline Studio', from: 'Sam’s enquiry and your services' } } }]);
    await page.goto('/inbox.html');
    await page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' }).first().click();
    const pane = page.locator('#rpane');
    await expect(pane.locator('#leadBody')).toBeVisible();
    await expect(pane.locator('.ai-row')).toContainText('AI help · about 1¢ a draft · reads this enquiry and your services');
    await pane.getByRole('button', { name: 'Draft a reply' }).click();
    await expect(pane.locator('#leadBody')).toHaveValue(/Yes, we can quote a patio/);
    await expect(pane.locator('.ai-band')).toContainText('Drafted by AI from Sam’s enquiry and your services. Read it and change anything. Nothing is sent until you press Send reply.');
    expect(asked[0].body).toMatchObject({ kind: 'enquiry', id: 'l-9' });
    expect(sent).toEqual([]);
    await noOverflow(page);
  });

  test('Settings: the goal saves, the owner flips AI help, and it says what it costs and what it used', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/sales/goal-ai': { data: { goal_cents: null, ai_on: false, ai_on_at: null, can_switch: true, from_studio: false, ready: true, usage: { month_uses: 23, month_cents: 21.6, last_at: ago(1), today_uses: 2, day_limit: 50, cents_each: 1 } } },
      '/sales/summary': { data: { total: 4, open: { count: 3, value_cents: 975000 }, won_month: { count: 1, value_cents: 195000 }, expected: { value_cents: 418000 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], goal: null } },
    } });
    await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/goal-ai'), (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const b = route.request().postDataJSON(); puts.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { goal_cents: b.goal_cents ?? 800000, ai_on: b.ai_on ?? false, ai_on_at: b.ai_on ? new Date().toISOString() : null } }) });
    });
    await page.goto('/settings.html#goal');
    const sec = page.locator('#goal');
    await expect(sec.getByRole('heading', { name: 'Goal and AI help' })).toBeVisible();
    await expect(sec.locator('.aifacts li')).toHaveText([
      'About 1¢ each press. Nothing runs by itself: only Draft, Sum them up and Refresh ask.',
      'Never sends anything. A draft lands in the box for you to change; Send stays yours.',
      'Stops at 50 a day (about 50¢), so a stuck button can’t run up a bill.',
      'Off for every new studio. Only the owner can switch it on or off.',
    ]);
    await expect(sec.locator('#goalEx')).toHaveText('No goal yet, so Home and Pipeline show none.');
    await sec.getByLabel('Monthly sales goal').fill('8,000');
    await expect(sec.locator('#goalEx')).toHaveText('This month so far: $1,950 won · $4,180 still expected · $1,870 left to find');
    await sec.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ goal_cents: 800000 });
    await expect(page.locator('.dds-toast, .toast').filter({ hasText: 'Home and Pipeline show this month against $8,000' }).first()).toBeVisible();
    const sw = sec.getByRole('switch', { name: 'AI help: draft a reply, and sum a person up' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1]).toEqual({ ai_on: true });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sec.locator('#aiUse')).toContainText('This month: 23 uses, about 22¢ · last used today at');
    await noOverflow(page);
  });

  test('Settings: anyone but the owner sees the switch greyed, with the reason, and it asks nothing', async ({ page }) => {
    const puts: unknown[] = [];
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/sales/goal-ai': { data: { goal_cents: 800000, ai_on: false, ai_on_at: null, can_switch: false, from_studio: false, ready: true, usage: { month_uses: 0, month_cents: 0, last_at: null, today_uses: 0, day_limit: 50, cents_each: 1 } } },
      '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [] } },
    } });
    await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/goal-ai'), (route: Route) => { if (route.request().method() === 'PUT') puts.push(1); return route.fallback(); });
    await page.goto('/settings.html#goal');
    const sec = page.locator('#goal');
    await expect(sec.getByLabel('Monthly sales goal')).toHaveValue('8,000');
    const sw = sec.getByRole('switch', { name: 'AI help: draft a reply, and sum a person up' });
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    await expect(sec.locator('#aiOwner')).toHaveText('Only the studio’s owner can switch AI help on or off.');
    await sw.dispatchEvent('click');   // a greyed switch still answers a press: with the reason, and nothing asked
    await expect(page.locator('.dds-toast, .toast').filter({ hasText: 'Only the studio’s owner can switch AI help on or off.' }).first()).toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(puts).toEqual([]);
  });

  test('Home: the month’s goal card, won against the goal, with what open deals should still bring', async ({ page }) => {
    const goal = { goal_cents: 800000, won_cents: 195000, expected_cents: 418000, left_cents: 187000, reached: false };
    await installApp(page, { api: {
      '/portal/context': STUDIO_CTX,
      '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
      '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
      '/sales/summary': { data: { total: 4, open: { count: 3, value_cents: 975000 }, won_month: { count: 1, value_cents: 195000 }, expected: { value_cents: 418000 }, win_rate: { pct: 100, won: 1, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0 }, goal } },
      '/sales/deals': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } }, '/sales/my-tasks': { data: { partial: false, total: 0, items: [] } },
      '/sales/setup': { data: { steps: [], hidden: true, shows: false, done: 0, total: 0 } },
      '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'Everything is paid and published.', partial: false, own_site: true, next_by_site: {}, next_by_client: {}, old: { count: 0, items: [] }, snooze_ready: true, snoozed: [] } },
    } });
    await page.goto('/agency.html');
    const card = page.locator('#goalCard');
    const month = new Date().toLocaleDateString('en-US', { month: 'long' });
    await expect(card.getByRole('heading', { name: `${month} goal` })).toBeVisible();
    await expect(card.locator('.gamt')).toHaveText('$1,950 of $8,000');
    await expect(card.locator('.gleft')).toContainText(/\d+ days? left · Edit goal/);
    await expect(card.getByRole('link', { name: 'Edit goal' })).toHaveAttribute('href', '/settings.html#goal');
    await expect(card.locator('.glegend li')).toHaveText(['Won $1,950', 'Still expected $4,180', 'Left to find $1,870']);
    await expect(card.locator('.gbar')).toHaveAttribute('aria-label', 'Won $1,950, still expected $4,180, left to find $1,870');
    const widths = await card.locator('.gbar span').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
    expect(widths).toEqual(['24.4%', '52.3%']);
    await noOverflow(page);
  });

  test('Pipeline: the goal above the board, the same three numbers', async ({ page }) => {
    const D = '11111111-1111-4111-8111-1111111111d1';
    await installApp(page, { api: {
      '/sales/deals': { data: [{ id: D, title: 'Blue Finch — site', stage: 'proposal', contact_id: null, expected_value_cents: 975000, source: 'manual', created_at: ago(40), updated_at: ago(1) }] },
      '/sales/contacts': { data: [] }, '/settings': { data: { stage_stale_days: {} } },
      '/sales/summary': { data: { total: 2, open: { count: 1, value_cents: 975000 }, won_month: { count: 1, value_cents: 195000 }, win_rate: { pct: 100, won: 1, lost: 0 }, by_stage: [], expected: { value_cents: 418000 }, ar: { outstanding_cents: 0, count: 0 },
        goal: { goal_cents: 800000, won_cents: 195000, expected_cents: 418000, left_cents: 187000, reached: false } } },
    } });
    await page.goto('/pipeline.html');
    const strip = page.locator('#goalStrip');
    await expect(strip.locator('.gs-t')).toHaveText(`${new Date().toLocaleDateString('en-US', { month: 'long' })} goal $8,000`);
    await expect(strip.locator('.glegend li')).toHaveText(['Won $1,950', 'Still expected $4,180', 'Left to find $1,870']);
    await expect(strip.getByRole('link', { name: 'Edit the month’s goal' })).toHaveAttribute('href', '/settings.html#goal');
    await noOverflow(page);
  });
});
