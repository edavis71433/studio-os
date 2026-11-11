import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Settings: team and account safety (sales list items 101 and 109, bug hunt I1 to I7) ──
// 101: the Monthly report switch greys while it saves, like Your menu. I1: an invite never
// rewrites someone already on the team; a removed person comes back only on a second press.
// I2: a closing already asked for shows on every visit, with its date and Cancel. I3: two
// switches flipped close together stay as pressed whatever order the answers come in. I4: a
// monthly report that couldn't be read is held, never blanked. I5: Team and Plan say so when
// their read drops. I6: a status line says what is wrong first. I7: a billing link followed
// inside a client opens nothing of the studio's billing.
const IDENTITY = { data: { site_id: 's1', business_name: 'Davis Digital Studio', email: 'hello@example.com', phone: '', service_area: 'Burbank, CA', updated_at: '2026-10-01T00:00:00Z' } };
const SUB = { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-12-03T00:00:00Z', in_grace: false, has_service_billing: false, deletion: null };
const API = {
  '/identity': IDENTITY,
  '/settings': { data: { industry_key: 'generic' } },
  '/connections': { data: { groups: {} } },
  '/commerce/subscription': { data: SUB },
};
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' },
} };
const AGENCY_CTX = { data: { ...SCOPED_CTX.data, scope: undefined } };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('Settings — the monthly report card (101, I4)', () => {
  const REPORT = { enabled: false, note: 'Thanks for a great month.', last_month: null, last_result: null, tries: null, blocked: null, updated_by: null, updated_at: null, note_max: 600, next_month: '2026-11' };

  test('101 — the switch greys while it saves; a press meanwhile does nothing and sends nothing; the line waits too', async ({ page }) => {
    let state: Record<string, unknown> = { ...REPORT };
    const puts: unknown[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await installApp(page, { api: { ...API, '/portal/context': SCOPED_CTX } });
    await page.route(/\/functions\/v1\/presence\/report\/monthly$/, async (route) => {
      if (route.request().method() !== 'PUT') return route.fulfill(json({ data: state }));
      const body = route.request().postDataJSON(); puts.push(body);
      await held;
      state = { ...state, ...body };
      return route.fulfill(json({ data: state }));
    });
    await page.goto(`/settings.html?client=${CLIENT}`);
    await page.locator('[data-card="report"]').click();
    const sw = page.locator('#sw-report');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sw).toHaveAttribute('aria-disabled', 'true');      // greyed while it saves
    await expect(page.locator('#reportSave')).toBeDisabled();        // and the line waits its turn
    await sw.click({ force: true });                                 // Playwright won't press a greyed switch unless forced
    await expect(sw).toHaveAttribute('aria-checked', 'true');        // the press showed nothing…
    expect(puts).toEqual([{ enabled: true }]);                       // …and sent nothing
    release();
    await expect(sw).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#reportSave')).toBeEnabled();
    await expect(page.locator('.dds-toast', { hasText: 'On. The first report goes out' })).toBeVisible();
    await sw.click();                                                // free again: a press is sent
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => puts).toEqual([{ enabled: true }, { enabled: false }]);
    await page.locator('#report-note').fill('A new line.');
    await page.locator('#reportSave').click();
    await expect(page.locator('#reportMsg')).toHaveText('Saved.');
    expect(puts[2]).toEqual({ note: 'A new line.' });
  });

  test('I4 — a report that could not be read is held: it says so, nothing can be pressed or saved, Try again reads it', async ({ page }) => {
    let fail = true;
    const puts: unknown[] = [];
    await installApp(page, { api: { ...API, '/portal/context': SCOPED_CTX } });
    await page.route(/\/functions\/v1\/presence\/report\/monthly$/, (route) => {
      if (route.request().method() === 'PUT') { puts.push(route.request().postDataJSON()); return route.fulfill(json({ data: {} })); }
      if (fail) return route.fulfill(json({ error: 'read_failed' }, 502));
      return route.fulfill(json({ data: { ...REPORT, enabled: true, note: 'The line we had' } }));
    });
    await page.goto(`/settings.html?client=${CLIENT}`);
    await page.locator('[data-card="report"]').click();          // the side list still opens the card…
    const sec = page.locator('#report');
    await expect(sec).toBeVisible();
    await expect(sec.locator('.unread')).toContainText('This client’s monthly report couldn’t load just now.');   // …which says why
    await expect(page.locator('#sw-report')).toBeHidden();        // no switch that lies
    await expect(page.locator('#report-note')).toBeHidden();      // no blank line to save over the real one
    await expect(page.locator('#reportSave')).toBeHidden();
    expect(puts).toEqual([]);
    fail = false;
    await sec.locator('.unread button').click();
    await expect(sec.locator('.unread')).toHaveCount(0);
    await expect(page.locator('#sw-report')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#report-note')).toHaveValue('The line we had');
    expect(puts).toEqual([]);
  });
});

test.describe('Settings — the team (I1, I5)', () => {
  const ME = { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'eric@brightstudio.example', member_id: 'm-1' } };
  const MEMBERS = { data: [
    { id: 'm-1', email: 'eric@brightstudio.example', role: 'owner', status: 'active', created_at: '2026-01-10T00:00:00Z' },
    { id: 'm-2', email: 'sam@brightstudio.example', role: 'designer', status: 'active', created_at: '2026-06-01T00:00:00Z' },
    { id: 'm-3', email: 'jo@brightstudio.example', role: 'designer', status: 'revoked', created_at: '2026-07-01T00:00:00Z' },
  ] };
  const USAGE = { data: { plan: 'agency', seats: { used: 2, limit: 5 }, clients: { used: 3, active: 3, archived: 0, limit: 10 }, editions: {}, publishes_30d: 1 } };
  const teamApi = { ...API, '/portal/context': AGENCY_CTX, '/agency/me': ME, '/agency/members': MEMBERS, '/agency/usage': USAGE,
    '/commerce/subscription': { data: { ...SUB, plan: 'agency', plan_name: 'Agency', can_manage_billing: false } } };

  test('I1 — an email already on the team is never re-invited; a removed one comes back only on a second press', async ({ page }) => {
    const posts: Array<Record<string, unknown>> = [];
    await installApp(page, { api: teamApi });
    await page.route('**/functions/v1/presence/agency/members', (route) => {
      if (route.request().method() !== 'POST') return route.fulfill(json(MEMBERS));
      const b = route.request().postDataJSON(); posts.push(b);
      // another tab added them meanwhile: the server refuses, and the page says so
      if (b.email === 'kim@brightstudio.example') return route.fulfill(json({ error: 'already_member', message: 'kim@brightstudio.example is already on the team. Change their role in the list.' }, 409));
      return route.fulfill(json({ data: { id: 'm-3', email: b.email, role: b.role, status: 'active', emailed: true, restored: b.restore === true } }));
    });
    await page.goto('/settings.html#team');
    await expect(page.locator('#people .member')).toHaveCount(3);
    // the only owner, typed with capitals: said so, nothing sent, the owner untouched
    await page.locator('#inv-email').fill('Eric@BrightStudio.example');
    await page.locator('#inviteBtn').click();
    await expect(page.locator('.dds-toast', { hasText: 'eric@brightstudio.example is already on the team as Owner. Change their role in the list.' })).toBeVisible();
    await expect(page.locator('#people .member').nth(0)).toContainText('Owner · you');
    // a teammate: their role select is where to change it
    await page.locator('#inv-email').fill('sam@brightstudio.example');
    await page.locator('#inviteBtn').click();
    await expect(page.locator('select[data-role="m-2"]')).toBeFocused();
    await expect(page.locator('select[data-role="m-2"]')).toHaveValue('designer');
    expect(posts).toEqual([]);
    // someone removed: asked first, naming what they come back as
    await page.locator('#inv-email').fill('jo@brightstudio.example');
    await page.locator('#inv-role').selectOption('support');
    await page.locator('#inviteBtn').click();
    await expect(page.locator('#inviteBtn')).toHaveText('Bring them back');
    await expect(page.locator('.dds-toast', { hasText: 'jo@brightstudio.example was removed from the team. Press “Bring them back” to let them in again as Support.' })).toBeVisible();
    expect(posts).toEqual([]);
    await page.locator('#inv-email').fill('jo@brightstudio.exampl');           // typing takes the armed press back
    await expect(page.locator('#inviteBtn')).toHaveText('Invite');
    await page.locator('#inv-email').fill('jo@brightstudio.example');
    await page.locator('#inviteBtn').click();                                  // asks again
    await expect(page.locator('#inviteBtn')).toHaveText('Bring them back');
    expect(posts).toEqual([]);
    await page.locator('#inviteBtn').click();
    await expect.poll(() => posts).toEqual([{ email: 'jo@brightstudio.example', role: 'support', restore: true }]);
    await expect(page.locator('.dds-toast', { hasText: 'jo@brightstudio.example is back on the team as Support.' })).toBeVisible();
    await expect(page.locator('#inviteBtn')).toHaveText('Invite');
    await expect(page.locator('#people .member').nth(2)).not.toHaveClass(/revoked/);
    await expect(page.locator('[data-card="agency_team"] .st')).toHaveText('3 on the team');
    // the server's own refusal is said in its words, and changes nothing here
    await page.locator('#inv-email').fill('kim@brightstudio.example');
    await page.locator('#inviteBtn').click();
    await expect(page.locator('.dds-toast', { hasText: 'kim@brightstudio.example is already on the team. Change their role in the list.' })).toBeVisible();
    await expect(page.locator('#people .member')).toHaveCount(3);
    expect(posts.map((p) => p.email)).toEqual(['jo@brightstudio.example', 'kim@brightstudio.example']);
  });

  test('I5 — a dropped connection on Team or Plan says so, with Try again, never "no plan"', async ({ page }) => {
    let drop = true;
    await installApp(page, { api: teamApi });
    await page.route(/\/functions\/v1\/presence\/(agency\/members|commerce\/subscription)$/, (route) => drop ? route.abort('failed') : route.fallback());
    await page.goto('/settings.html');
    await page.locator('[data-card="agency_team"]').click();
    await expect(page.locator('#people .unread')).toContainText('We couldn’t load your team just now.');
    await expect(page.locator('#inviteForm')).toBeHidden();
    await page.locator('[data-card="billing"]').click();
    await expect(page.locator('#plan .unread')).toContainText('Your plan couldn’t load just now.');
    await expect(page.locator('#plan')).not.toContainText('We couldn’t find a plan');
    drop = false;
    await page.locator('#people .unread button').click();
    await expect(page.locator('#people .member')).toHaveCount(3);
    await expect(page.locator('#inviteForm')).toBeVisible();
    await page.locator('#plan .unread button').click();
    await expect(page.locator('#planLine')).toContainText('Agency · Active');
    await expect(page.locator('#plan .unread')).toHaveCount(0);
  });
});

test.describe('Settings — closing the account (I2)', () => {
  test('a closing already asked for shows on every visit, with its real date and Cancel', async ({ page }) => {
    const posts: string[] = [];
    await installApp(page, { api: { ...API, '/commerce/subscription': { data: { ...SUB, deletion: { scheduled_for: '2026-12-11T12:00:00Z', status: 'pending' } } } } });
    await page.route('**/functions/v1/presence/commerce/delete-*', (route) => {
      const what = new URL(route.request().url()).pathname.split('/').pop()!;
      posts.push(what);
      return route.fulfill(json({ data: what === 'delete-request'
        ? { ok: true, completes_within_days: 30, scheduled_for: '2027-01-10T12:00:00Z', already_pending: false }
        : { ok: true, canceled: true, message: 'Your deletion request was canceled — your account stays active.' } }));
    });
    await page.goto('/settings.html');
    const ask = page.locator('#deleteAsk'), cancel = page.locator('#deleteCancel');
    await expect(page.locator('[data-card="billing"] .st')).toHaveText('Closing Dec 11');
    await page.locator('[data-card="billing"]').click();
    await expect(page.locator('#deleteCard')).toHaveAttribute('open', '');    // Cancel is in sight, not behind a fold
    await expect(ask).toHaveText('Scheduled for December 11, 2026');
    await expect(ask).toBeDisabled();
    await expect(cancel).toBeVisible();
    await expect(page.locator('#planClosing')).toHaveText('Your account is set to close on December 11, 2026. You can cancel that under Close your account until then.');
    expect(posts).toEqual([]);
    await cancel.click();
    await expect(ask).toHaveText('Request deletion');
    await expect(ask).toBeEnabled();
    await expect(cancel).toBeHidden();
    await expect(page.locator('#planClosing')).toHaveCount(0);
    await expect(page.locator('[data-card="billing"] .st')).toHaveText('Studio · Active');
    // asked again: the card says the day the server set, not "30 days" from today
    await ask.click(); await ask.click();
    await expect(ask).toHaveText('Scheduled for January 10, 2027');
    await expect(page.locator('#planClosing')).toContainText('January 10, 2027');
    expect(posts).toEqual(['delete-cancel', 'delete-request']);
  });
});

test.describe('Settings — automations and the status lines (I3, I6, I7)', () => {
  test('I3 — two switches flipped close together stay as pressed while their answers come back in either order', async ({ page }) => {
    const row: Record<string, unknown> = { industry_key: 'generic', auto_ack_enquiries: false, deal_nudges: false, invoice_reminders: false };
    const answers: Array<() => Promise<void>> = [];
    await installApp(page, { api: { ...API, '/settings': { data: { ...row } } } });
    await page.route('**/functions/v1/presence/settings', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON();
      Object.assign(row, body);
      const snapshot = { ...row };   // the whole row as it stood after THIS write, answered later
      answers.push(() => route.fulfill(json({ data: snapshot })));
    });
    await page.goto('/settings.html#automations');
    const ack = page.locator('#sw-ack'), deal = page.locator('#sw-deal'), inv = page.locator('#sw-inv');
    await expect(ack).toHaveAttribute('aria-checked', 'false');
    await ack.click();
    await deal.click();
    await expect.poll(() => answers.length).toBe(2);
    await answers[1]();                                         // the second answer lands first
    await expect(page.locator('.dds-toast', { hasText: 'Saved.' }).first()).toBeVisible();
    await expect(ack).toHaveAttribute('aria-checked', 'true');  // its own save is still out: it stays as pressed
    await expect(deal).toHaveAttribute('aria-checked', 'true');
    await answers[0]();                                         // then the first (it still says deal_nudges: false)
    await expect.poll(async () => [await ack.getAttribute('aria-checked'), await deal.getAttribute('aria-checked')]).toEqual(['true', 'true']);
    // the other order: the first answer lands while the second switch's save is out
    await inv.click();
    await ack.click();
    await expect.poll(() => answers.length).toBe(4);
    await answers[2]();
    await expect(inv).toHaveAttribute('aria-checked', 'true');
    await expect(ack).toHaveAttribute('aria-checked', 'false');   // pressed off, its answer not back yet: not repainted on
    await answers[3]();
    await expect.poll(async () => [await inv.getAttribute('aria-checked'), await ack.getAttribute('aria-checked'), await deal.getAttribute('aria-checked')]).toEqual(['true', 'false', 'true']);
  });

  test('I6 — the Domain & email row says what is wrong first, and those words are never cut off', async ({ page }) => {
    await installApp(page, { api: { ...API,
      '/email/sending': { data: { from: 'hello@a-rather-long-studio-name.example.com', sending: 'not_verified' } },
      '/connections': { data: { groups: { Google: [
        { key: 'google_analytics', label: 'Google Analytics', connection: { status: 'connected', health: 'ok' } },
        { key: 'google_search_console', label: 'Search Console', connection: { status: 'connected', health: 'ok' } },
        { key: 'google_business_profile', label: 'Business Profile', connection: { status: 'expired', health: 'attention' } },
      ] } } } } });
    await page.goto('/settings.html');
    const st = page.locator('[data-card="domains"] .st');
    const words = 'Not verified, so emails may land in spam';
    await expect(st).toHaveText(`${words} · from hello@a-rather-long-studio-name.example.com`);
    await expect(st).toHaveAttribute('title', `${words} · from hello@a-rather-long-studio-name.example.com`);
    const shown = await st.evaluate((el, w) => {
      const r = document.createRange(); r.setStart(el.firstChild as Text, 0); r.setEnd(el.firstChild as Text, w.length);
      const a = r.getBoundingClientRect(), b = el.getBoundingClientRect();
      return a.bottom <= b.bottom + 1 && a.right <= b.right + 1;
    }, words);
    expect(shown).toBe(true);
    await expect(page.locator('[data-card="connections"] .st')).toHaveText('1 needs attention · 2 connected — Google Analytics, Search Console');
  });

  test('I7 — a billing link followed inside a client opens nothing of the studio’s billing', async ({ page }) => {
    await installApp(page, { api: { ...API, '/portal/context': SCOPED_CTX } });
    await page.goto(`/settings.html?client=${CLIENT}#billing`);
    await expect(page.locator('#studio')).toBeVisible();
    await expect(page.locator('#billing')).toBeHidden();
    await expect(page.locator('#deleteAsk')).toBeHidden();
    await expect(page.locator('[data-card="billing"]')).toHaveCount(0);
  });
});
