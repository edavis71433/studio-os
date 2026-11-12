import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list items 160 and 176 (Nov 2026), drawn in Figma and agreed. A client's Settings ›
// Monthly report: who gets it (their email, up to four more people, a copy to you, skip a
// quiet month), what it says (each part in or out), and one suggestion a month for what to
// do next (picked from their Do next list, your own words, or none). Every control saves as
// it changes, one save at a time. The studio's own Settings: every client's report on one
// card, each switch that client's own. Fake names only.

const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const NOMAIL = 'cccccccc-3333-4333-8333-cccccccccccc';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const toast = (page: Page) => page.locator('.dds-toast').last();
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};
const SCOPED_CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, scope: { site_id: CLIENT, name: 'Maple Street Studio' } } };
const AGENCY_CTX = { data: { ...SCOPED_CTX.data, scope: null } };
const IDEA = { key: 'idea:11111111-2222-4333-8444-555555555555', source: 'idea', text: 'A page for open houses. Draft it this week.' };
const AIQ = { key: 'ai:best-realtor-in-burbank', source: 'ai', text: 'When people ask an AI assistant “best realtor in burbank”, it doesn’t name you yet. A page that answers it, in your words, would help.' };
const STATE = {
  enabled: true, note: '', last_month: null, last_result: null, tries: null, blocked: null, updated_by: null, updated_at: null, note_max: 600, next_month: '2026-11',
  pdf: true, ai_checks: true, ai_month: null, ai_result: null, ai_tries: null, ai_questions: 7, ai_cost: 'About 42 cents a month for 7 questions',
  parts_off: [], cc: [], copy_to: null, quiet_min: null, propose: { mode: 'off', text: '', pick: null, log: [] },
  to: 'sam@maple.example', client_name: 'Sam Ortiz', me: 'eric@studio.example', cc_max: 4, cc_blocked: {}, quiet_default: 30, propose_max: 400,
  propose_next: null, propose_options: [IDEA, AIQ],
};

async function openCard(page: Page, opts: { hold?: Promise<void>; failRead?: () => boolean } = {}) {
  const puts: Array<Record<string, unknown>> = [];
  let state: Record<string, unknown> = JSON.parse(JSON.stringify(STATE));
  await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': SCOPED_CTX } as never });
  await page.route(/\/functions\/v1\/presence\/report\/monthly$/, async (route) => {
    if (route.request().method() === 'PUT') {
      const b = route.request().postDataJSON() as Record<string, unknown>; puts.push(b);
      if (opts.hold) await opts.hold;
      if (Array.isArray(b.parts_off) && (b.parts_off as string[]).length >= 8) return route.fulfill(json({ error: 'bad_request', message: 'Leave at least one part in the report.' }, 400));
      const next: Record<string, unknown> = { ...state };
      for (const k of ['parts_off', 'cc', 'quiet_min', 'enabled', 'note', 'pdf', 'ai_checks']) if (k in b) next[k] = b[k];
      if ('copy' in b) next.copy_to = b.copy ? 'eric@studio.example' : null;
      if (b.propose) {
        const p = { ...(state.propose as Record<string, unknown>), ...(b.propose as Record<string, unknown>) };
        next.propose = p;
        next.propose_next = p.mode === 'off' ? null : p.mode === 'own' ? { key: 'own', source: 'own', text: p.text } : (p.pick === AIQ.key ? AIQ : IDEA);
      }
      if (Array.isArray(b.cc)) next.cc_blocked = (b.cc as string[]).includes('gone@maple.example') ? { 'gone@maple.example': 'unsubscribed' } : {};
      state = next;
      return route.fulfill(json({ data: state }));
    }
    if (opts.failRead && opts.failRead()) return route.fulfill(json({ error: 'read_failed' }, 502));
    return route.fulfill(json({ data: state }));
  });
  await page.goto(`/settings.html?client=${CLIENT}#report`);
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#sw-report')).toHaveAttribute('aria-checked', 'true');
  return puts;
}

test.describe('Settings › Monthly report: who gets it (builder list item 160)', () => {
  test('their email on the record; up to four more people, each taken off with ×; one that unsubscribed is said so', async ({ page }) => {
    const puts = await openCard(page);
    const sec = page.locator('#report');
    await expect(sec.locator('#reportNext')).toHaveText('Next one: December 1 · to 1 person');
    await expect(sec.locator('#reportTo li.main')).toContainText('Sam Ortiz');
    await expect(sec.locator('#reportTo li.main')).toContainText('sam@maple.example · on their record');
    await sec.getByRole('button', { name: 'Add someone' }).click();
    await expect(sec.locator('#ccIn')).toBeFocused();
    await sec.locator('#ccIn').fill('not an email');
    await sec.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(toast(page)).toContainText('That isn’t an email address.');
    expect(puts).toEqual([]);
    await sec.locator('#ccIn').fill('Office@Maple.example');
    await sec.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(toast(page)).toContainText('Added. office@maple.example gets the next report.');
    expect(puts).toEqual([{ cc: ['office@maple.example'] }]);
    await expect(sec.locator('#reportTo')).toContainText('office@maple.example');
    await expect(sec.locator('#reportNext')).toHaveText('Next one: December 1 · to 2 people');
    await expect(sec.getByRole('button', { name: 'Add someone' })).toBeFocused();   // ready for the next one
    // the client’s own address isn’t added twice
    await sec.getByRole('button', { name: 'Add someone' }).click();
    await sec.locator('#ccIn').fill('sam@maple.example');
    await sec.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(toast(page)).toContainText('They already get it.');
    await sec.locator('#ccIn').fill('gone@maple.example');
    await sec.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(sec.locator('#ccWarn')).toHaveText('gone@maple.example is left out: unsubscribed.');
    await expect(sec.locator('#reportNext')).toHaveText('Next one: December 1 · to 2 people');   // the one who unsubscribed doesn’t count
    await sec.getByRole('button', { name: 'Take gone@maple.example off' }).click();
    await expect(toast(page)).toContainText('Taken off.');
    expect(puts[puts.length - 1]).toEqual({ cc: ['office@maple.example'] });
    await expect(sec.locator('#ccWarn')).toBeHidden();
  });

  test('Send me a copy goes to whoever switched it on; Skip a quiet month takes a number', async ({ page }) => {
    const puts = await openCard(page);
    const sec = page.locator('#report');
    await expect(sec.locator('#copyHow')).toHaveText('To eric@studio.example, the same email marked “Your copy”. Handy for checking what went out.');
    await sec.locator('#sw-copy').click();
    await expect(sec.locator('#sw-copy')).toHaveAttribute('aria-checked', 'true');
    await expect(toast(page)).toContainText('On. You’ll get a copy of each report.');
    await expect(sec.locator('#reportNext')).toHaveText('Next one: December 1 · to 2 people');
    await sec.locator('#sw-quiet').click();
    await expect(sec.locator('#sw-quiet')).toHaveAttribute('aria-checked', 'true');
    await expect(toast(page)).toContainText('On. A month under 30 visits is skipped.');
    await sec.locator('#n-quiet').fill('12');
    await sec.locator('#n-quiet').press('Enter');
    await expect(toast(page)).toContainText('Saved. A month under 12 visits is skipped.');
    await sec.locator('#sw-quiet').click();
    await expect(sec.locator('#sw-quiet')).toHaveAttribute('aria-checked', 'false');
    expect(puts).toEqual([{ copy: true }, { quiet_min: 30 }, { quiet_min: 12 }, { quiet_min: null }]);
  });
});

test.describe('Settings › Monthly report: what it says (builder list item 160)', () => {
  test('a part pressed is left out, and back in; the last one can’t go; AI answers needs its check', async ({ page }) => {
    const puts = await openCard(page);
    const sec = page.locator('#report');
    const health = sec.getByRole('button', { name: 'Website health' });
    await expect(health).toHaveAttribute('aria-pressed', 'true');
    await health.click();
    await expect(health).toHaveAttribute('aria-pressed', 'false');
    await expect(toast(page)).toContainText('Website health is left out of the report.');
    await health.click();
    await expect(toast(page)).toContainText('Website health is back in the report.');
    expect(puts).toEqual([{ parts_off: ['health'] }, { parts_off: [] }]);
    // seven off, one left: that one stays
    for (const p of ['Visits', 'Enquiries', 'On Google', 'AI answers', 'Reviews', 'Website health', 'Most read pages']) { await sec.getByRole('button', { name: p, exact: true }).click(); await expect(sec.getByRole('button', { name: p, exact: true })).toHaveAttribute('aria-pressed', 'false'); }
    const before = puts.length;
    await sec.getByRole('button', { name: 'What changed' }).click();
    await expect(toast(page)).toContainText('Leave at least one part in the report.');
    expect(puts.length).toBe(before);
    await expect(sec.getByRole('button', { name: 'What changed' })).toHaveAttribute('aria-pressed', 'true');
    // with the AI check off, AI answers can't go in yet
    await sec.locator('#sw-ai').click();
    await expect(sec.locator('#reportIn button').nth(3)).toHaveText('AI answers, off');
    await sec.locator('#reportIn button').nth(3).click();
    await expect(toast(page)).toContainText('Switch on “Check AI answers every month” below');
  });
});

test.describe('Settings › Monthly report: what to suggest next (builder list item 176)', () => {
  test('pick for me shows December’s suggestion and where it came from; pick another; edit the words; leave it out', async ({ page }) => {
    const puts = await openCard(page);
    const sec = page.locator('#report');
    await expect(sec.getByRole('radio', { name: 'Leave it out' })).toHaveAttribute('aria-checked', 'true');
    await expect(sec.locator('#sugBox')).toBeHidden();
    await sec.getByRole('radio', { name: 'Pick for me each month' }).click();
    await expect(toast(page)).toContainText('On. Each report suggests one thing from their Do next list.');
    await expect(sec.locator('#sugBox')).toBeVisible();
    await expect(sec.locator('#sugEye')).toHaveText('December 1 report suggests');
    await expect(sec.locator('#sugText')).toHaveText(IDEA.text);
    await expect(sec.locator('#sugFrom')).toHaveText('From their Do next list: a Growth Coach idea');
    await sec.getByRole('button', { name: 'Pick another ▾' }).click();
    await expect(sec.locator('#sugMenu')).toBeVisible();
    await sec.getByRole('menuitemradio', { name: /best realtor in burbank/ }).click();
    await expect(toast(page)).toContainText('That one goes in the next report.');
    await expect(sec.locator('#sugText')).toContainText('best realtor in burbank');
    await sec.getByRole('button', { name: 'Edit the words' }).click();
    await expect(sec.locator('#sug-text')).toBeFocused();
    await expect(sec.locator('#sug-text')).toHaveValue(AIQ.text);
    await sec.locator('#sug-text').fill('A spring open-house page, live before April.');
    await sec.getByRole('button', { name: 'Save the suggestion' }).click();
    await expect(toast(page)).toContainText('Saved. It goes in every report until you change it.');
    await expect(sec.getByRole('radio', { name: 'My own words' })).toHaveAttribute('aria-checked', 'true');
    await sec.getByRole('radio', { name: 'Leave it out' }).click();
    await expect(toast(page)).toContainText('Off. The report goes without a suggestion.');
    expect(puts).toEqual([
      { propose: { mode: 'auto' } },
      { propose: { mode: 'auto', pick: AIQ.key } },
      { propose: { mode: 'own', text: 'A spring open-house page, live before April.' } },
      { propose: { mode: 'off' } },
    ]);
    // the arrow keys move along the choices, as in any radio group
    await sec.getByRole('radio', { name: 'Leave it out' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(sec.getByRole('radio', { name: 'My own words' })).toBeFocused();
  });

  test('my own words with nothing written yet waits for the button, and an empty one is refused', async ({ page }) => {
    const puts = await openCard(page);
    const sec = page.locator('#report');
    await sec.getByRole('radio', { name: 'My own words' }).click();
    await expect(sec.locator('#sug-text')).toBeFocused();
    expect(puts).toEqual([]);
    await sec.getByRole('button', { name: 'Save the suggestion' }).click();
    await expect(toast(page)).toContainText('Write the suggestion, or pick one of ours.');
    expect(puts).toEqual([]);
  });
});

test.describe('Settings › Monthly report: one save at a time, and a read that failed (items 101 and I4)', () => {
  test('while one saves, every new control waits; a report that couldn’t be read hides the new rows', async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    let fail = false;
    const puts = await openCard(page, { hold: held, failRead: () => fail });
    const sec = page.locator('#report');
    await sec.locator('#sw-copy').click();
    for (const id of ['#sw-copy', '#sw-quiet', '#sw-pdf', '#sw-ai', '#sw-report']) await expect(sec.locator(id)).toHaveAttribute('aria-disabled', 'true');
    await expect(sec.getByRole('button', { name: 'Website health' })).toBeDisabled();
    await expect(sec.getByRole('button', { name: 'Add someone' })).toBeDisabled();
    await expect(sec.getByRole('radio', { name: 'Pick for me each month' })).toBeDisabled();
    await sec.locator('#sw-quiet').dispatchEvent('click');   // straight to the switch: a forced tap at its spot lands on a phone's bottom bar
    expect(puts).toEqual([{ copy: true }]);
    release();
    await expect(sec.locator('#sw-quiet')).not.toHaveAttribute('aria-disabled', 'true');
    fail = true;
    await page.reload();
    await expect(page.locator('#report .unread')).toContainText('This client’s monthly report couldn’t load just now.');
    for (const id of ['#reportTo', '#sw-copy', '#sw-quiet', '#reportIn', '#sugModes', '#reportSave']) await expect(page.locator(id)).toBeHidden();
  });
});

test.describe('Settings › Monthly reports, every client (builder list item 160)', () => {
  const ROWS = [
    { site_id: OTHER, name: 'Bluebird Bakery', who: 'Jo', email: 'jo@bluebird.example', enabled: false, blocked: null, more: 0, copy: false, propose: 'off', last: null },
    { site_id: CLIENT, name: 'Maple Street Studio', who: 'Sam', email: 'sam@maple.example', enabled: true, blocked: null, more: 1, copy: true, propose: 'auto', last: { month: '2026-10', status: 'sent', reason: null } },
    { site_id: NOMAIL, name: 'Ortiz Photography', who: '', email: null, enabled: false, blocked: 'no_email', more: 0, copy: false, propose: 'off', last: null },
  ];
  async function openList(page: Page, opts: { fail?: boolean; role?: 'can' | 'cannot' } = {}) {
    const puts: Array<{ scope: string | null; body: unknown }> = [];
    if (page.url() !== 'about:blank') await page.goto('about:blank');   // a second open loads the page again, not just its #hash
    await installApp(page, { api: { '/identity': { data: { site_id: 's1', business_name: 'Studio', email: 'hello@example.com' } }, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': AGENCY_CTX } as never });
    let fail = !!opts.fail;
    await page.route(/\/functions\/v1\/presence\/agency\/monthly-reports$/, (route) => fail ? route.fulfill(json({ error: 'read_failed' }, 502)) : route.fulfill(json({ data: { rows: JSON.parse(JSON.stringify(ROWS)), can_change: opts.role !== 'cannot' } })));
    await page.route(/\/functions\/v1\/presence\/report\/monthly$/, (route) => {
      const scope = route.request().headers()['x-dds-scope-site'] || null;
      puts.push({ scope, body: route.request().postDataJSON() });
      return route.fulfill(json({ data: { enabled: true } }));
    });
    await page.goto('/settings.html#reports');
    return { puts, heal: () => { fail = false; } };
  }

  test('one row a client: who it goes to, what it suggests, how the last one went; a switch is that client’s own', async ({ page }) => {
    const { puts } = await openList(page);
    const sec = page.locator('#reports');
    await expect(sec).toBeVisible();
    await expect(page.locator('[data-card="reports"]')).toHaveAttribute('href', '#reports');
    const maple = sec.locator(`[data-report="${CLIENT}"]`);
    await expect(maple).toContainText('Sam + 1 more, and you');
    await expect(maple).toContainText('Picked each month');
    await expect(maple.locator('.rpill')).toHaveText('October · sent');
    await expect(maple.getByRole('link', { name: 'Change →' })).toHaveAttribute('href', `/settings.html?client=${CLIENT}#report`);
    const ortiz = sec.locator(`[data-report="${NOMAIL}"]`);
    await expect(ortiz).toContainText('No email on their record');
    await expect(ortiz.getByRole('link', { name: 'Fix →' })).toHaveAttribute('href', `/crm.html?client=${NOMAIL}`);
    await expect(ortiz.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
    await ortiz.getByRole('switch').dispatchEvent('click');
    await expect(toast(page)).toContainText('It can’t go out: there’s no email on their record.');
    const blue = sec.locator(`[data-report="${OTHER}"]`);
    await blue.getByRole('switch').click();
    await expect(blue.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(toast(page)).toContainText('On. Bluebird Bakery gets a report in the first days of next month.');
    expect(puts).toEqual([{ scope: OTHER, body: { enabled: true } }]);   // the client's own switch, with that client in scope
    await expect(sec.getByRole('button', { name: 'Switch on everyone who can get it' })).toBeHidden();   // nobody left who can
  });

  test('Switch on everyone who can get it skips who can’t be emailed', async ({ page }) => {
    const { puts } = await openList(page);
    await page.locator('#reports').getByRole('button', { name: 'Switch on everyone who can get it' }).click();
    await expect(toast(page)).toContainText('On for 1 more client.');
    expect(puts.map((p) => p.scope)).toEqual([OTHER]);
  });

  test('a role that can’t change them sees them, greyed; a failed read says so, with Try again', async ({ page }) => {
    await openList(page, { role: 'cannot' });
    await expect(page.locator('#reportsNote')).toContainText('Your role can see the reports but not switch them.');
    await expect(page.locator(`[data-report="${OTHER}"]`).getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#reportsAll')).toBeHidden();
    const { heal } = await openList(page, { fail: true });
    await expect(page.locator('#reports .unread')).toContainText('Your clients’ monthly reports couldn’t load just now.');
    heal();
    await page.locator('#reports .unread').getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator(`[data-report="${CLIENT}"]`)).toBeVisible();
  });

  test('phone width: each client stacks, nothing wider than the screen; the client card too', async ({ page }) => {
    await openList(page);
    await expect(page.locator(`[data-report="${CLIENT}"]`)).toBeVisible();
    await noSideScroll(page);
    await openCard(page);
    await page.locator('#sugModes').scrollIntoViewIfNeeded();
    await noSideScroll(page);
  });

  test('accessibility: the studio card and the client card pass axe', async ({ page }) => {
    await openList(page);
    await expect(page.locator(`[data-report="${CLIENT}"]`)).toBeVisible();
    const a = await new AxeBuilder({ page }).include('#reports').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(a.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    await openCard(page);
    await page.locator('#report').getByRole('radio', { name: 'Pick for me each month' }).click();
    await expect(page.locator('#sugBox')).toBeVisible();
    const b = await new AxeBuilder({ page }).include('#report').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(b.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
