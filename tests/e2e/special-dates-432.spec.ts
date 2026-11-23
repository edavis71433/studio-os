import { test, expect, type Page } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { pinClock } from './helpers/clock';

// ── Special dates in Business details, and each day's hours on one line on a phone (builder item 432, the Nov 5 phone line) ──
// The Hours card lists the dates still to come (today in the site's own time zone), adds one
// closed or open its own hours with a short note, changes and removes one, and opens with a
// date filled in from the Do next holiday line (#hours-2026-11-26), saving nothing until Add.
// On a phone each day of the week keeps to one line, its short name standing in for the long
// one. Hermetic: every write is recorded, nothing leaves. The names and dates are made up.

const NOW = '2026-11-23T18:00:00Z';   // a Monday, 10am in Burbank
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: day === 'mon', intervals: day === 'mon' ? [] : [{ open: '17:00', close: day === 'thu' ? '23:00' : '22:00' }] }));
const GONE = { date: '2026-11-20', label: 'Staff day', closed: true, intervals: [] };
const THANKSGIVING = { date: '2026-11-26', label: 'Closed for Thanksgiving', closed: true, intervals: [] };
const XMAS_EVE = { date: '2026-12-24', label: 'Closing early for Christmas Eve', closed: false, intervals: [{ open: '09:00', close: '14:00' }] };
const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: {} }, '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, font_library: [] } },
};
const SITE = (special: unknown[]) => ({ data: {
  site: { id: id(1), client_id: id(2), status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: 'restaurant-classic', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' },
  identity: { business_name: 'Marlow’s Kitchen', phone: '(555) 010-0142' },
  location: { address_line1: '12 Main St', city: 'Burbank', region: 'CA', postal_code: '91502', timezone: 'America/Los_Angeles', hours: WEEK, holiday_exceptions: special },
  voice: {}, offerings: [], faqs: [], testimonials: [], posts: [],
} });

type Saved = Array<{ date: string; label: string; closed: boolean; intervals: Array<{ open: string; close: string }> }>;
async function open(page: Page, hash = '#business', special: unknown[] = [GONE, XMAS_EVE, THANKSGIVING]): Promise<Saved[]> {
  const saves: Saved[] = [];
  await installApp(page, { api: { ...PAGE_API, '/site': SITE(special) } as never });
  await page.route('**/functions/v1/presence/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (req.method() === 'PUT' && path === '/location') {
      const body = req.postDataJSON() as { holiday_exceptions?: Saved };
      if (body.holiday_exceptions) saves.push(body.holiday_exceptions);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
    }
    return route.fallback();
  });
  await pinClock(page, NOW, { ticking: true });   // ticking: the editor's own short timers still settle
  await page.goto('/presence.html' + hash);
  await expect(page.locator('#view-business')).toBeVisible();
  return saves;
}
const rows = (page: Page) => page.locator('#sdList li');

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.addInitScript(() => {
    const w = window as unknown as { __errToasts: string[] }; w.__errToasts = [];
    let real: ((...a: unknown[]) => unknown) | undefined;
    Object.defineProperty(window, 'ddsToast', { configurable: true, get: () => real,
      set(fn) { real = function (this: unknown, ...a: unknown[]) { if (a[1] === 'err') w.__errToasts.push(String(a[0])); return fn.apply(this, a); }; } });
  });
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __errToasts?: string[] }).__errToasts ?? [])).toEqual([]);
});

test.describe('Special dates (builder item 432)', () => {
  test('the dates still to come, in date order, each with its hours and note; a date gone by isn’t there', async ({ page }) => {
    await open(page);
    await expect(page.locator('#sdH')).toHaveText('Special dates');
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText('Thursday, Nov 26');
    await expect(rows(page).nth(0).locator('.sd-hours')).toHaveText('Closed');
    await expect(rows(page).nth(0).locator('.sd-note')).toHaveText('Closed for Thanksgiving');
    await expect(rows(page).nth(1).locator('.sd-hours')).toHaveText('9am to 2pm');
    await expect(page.locator('#specialDates')).not.toContainText('Staff day');
    await expect(page.locator('#sdForm')).toBeHidden();
  });

  test('Add a date: closed all day with a note, saved whole and in date order, without the day gone by', async ({ page }) => {
    const saves = await open(page);
    await page.getByRole('button', { name: 'Add a date' }).click();
    await expect(page.locator('#sdDate')).toBeFocused();
    await expect(page.locator('#sdClosed')).toBeChecked();
    await page.locator('#sdDate').fill('2026-12-31');
    await expect(page.locator('#sdWd')).toHaveText('Thursday');
    await page.locator('#sdNote').fill('Closed for New Year’s Eve');
    await page.getByRole('button', { name: 'Add this date' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual([THANKSGIVING, XMAS_EVE, { date: '2026-12-31', label: 'Closed for New Year’s Eve', closed: true, intervals: [] }]);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2)).toContainText('Thursday, Dec 31');
    await expect(page.locator('#sdForm')).toBeHidden();
    await expect(rows(page).nth(2).getByRole('button', { name: 'Change Thursday, Dec 31' })).toBeFocused();
  });

  test('open different hours: unticking Closed brings that weekday’s own hours, and the times are saved', async ({ page }) => {
    const saves = await open(page);
    await page.getByRole('button', { name: 'Add a date' }).click();
    await page.locator('#sdDate').fill('2026-12-31');
    await expect(page.locator('#sdOpen')).toBeDisabled();
    await page.locator('#sdClosed').uncheck();
    await expect(page.locator('#sdOpen')).toHaveValue('17:00');   // a Thursday: the week's Thursday
    await expect(page.locator('#sdClose')).toHaveValue('23:00');
    await page.locator('#sdClose').fill('20:00');
    await page.locator('#sdNote').press('Enter');   // Enter adds it, as the button does
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0][2]).toEqual({ date: '2026-12-31', label: '', closed: false, intervals: [{ open: '17:00', close: '20:00' }] });
    await expect(rows(page).nth(2).locator('.sd-hours')).toHaveText('5pm to 8pm');
  });

  test('what can’t be saved is said in plain words, and nothing is sent', async ({ page }) => {
    const saves = await open(page);
    await page.getByRole('button', { name: 'Add a date' }).click();
    const add = page.getByRole('button', { name: 'Add this date' }), say = page.locator('#sdMsg');
    await add.click();
    await expect(say).toHaveText('Pick the date first.');
    await page.locator('#sdDate').fill('2026-11-20');
    await add.click();
    await expect(say).toHaveText('That day has gone by. Pick today or a day to come.');
    await page.locator('#sdDate').fill('2027-12-01');
    await add.click();
    await expect(say).toHaveText('Pick a date within the next year.');
    await page.locator('#sdDate').fill('2026-12-31');
    await page.locator('#sdClosed').uncheck();
    await page.locator('#sdClose').fill('17:00');
    await add.click();
    await expect(say).toHaveText('Set the times you open and close that day, or tick Closed all day.');
    await settled(page);
    expect(saves).toEqual([]);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#sdForm')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add a date' })).toBeFocused();
  });

  test('Change fills the form with the date as it is and saves it in place; Remove takes it off', async ({ page }) => {
    const saves = await open(page);
    await page.getByRole('button', { name: 'Change Thursday, Dec 24' }).click();
    await expect(page.locator('#sdFormH')).toHaveText('Change Thursday, Dec 24');
    await expect(page.locator('#sdClosed')).not.toBeChecked();
    await expect(page.locator('#sdOpen')).toHaveValue('09:00');
    await expect(page.locator('#sdNote')).toHaveValue('Closing early for Christmas Eve');
    await page.locator('#sdNote').fill('Open until 2 on Christmas Eve');
    await page.getByRole('button', { name: 'Save this date' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual([THANKSGIVING, { ...XMAS_EVE, label: 'Open until 2 on Christmas Eve' }]);
    await page.getByRole('button', { name: 'Remove Thursday, Nov 26' }).click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].map((e) => e.date)).toEqual(['2026-12-24']);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Add a date' })).toBeFocused();
  });

  test('the Do next holiday line (#hours-2026-11-26) opens the form with that date, focus on Closed all day, and saves nothing', async ({ page }) => {
    const saves = await open(page, '#hours-2026-11-26', []);
    await expect(page.locator('#sdForm')).toBeVisible();
    await expect(page.locator('#sdDate')).toHaveValue('2026-11-26');
    await expect(page.locator('#sdWd')).toHaveText('Thursday');
    await expect(page.locator('#sdFormH')).toHaveText('Add a date');
    await expect(page.locator('#sdClosed')).toBeFocused();
    await expect(page.locator('#sdForm')).toBeInViewport();
    await settled(page);
    expect(saves).toEqual([]);
    await page.locator('#sdNote').fill('Closed for Thanksgiving');
    await page.getByRole('button', { name: 'Add this date' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual([THANKSGIVING]);
  });

  test('a date already set opens as itself from the same link', async ({ page }) => {
    await open(page, '#hours-2026-11-26');
    await expect(page.locator('#sdFormH')).toHaveText('Change Thursday, Nov 26');
    await expect(page.locator('#sdNote')).toHaveValue('Closed for Thanksgiving');
    await expect(page.getByRole('button', { name: 'Save this date' })).toBeVisible();
  });
});

test.describe('the week on one line (the Nov 5 phone line) @layout', () => {
  for (const width of [0, 375]) {
    test(`each day’s name, times and Closed share one line${width ? ` at ${width}px` : ''}`, async ({ page }, info) => {
      // a desktop browser's time box carries a clock a phone's doesn't, so a phone's width is a phone's test
      test.skip(!!width && info.project.name === 'desktop-chromium', 'a phone width is tested on the phone and the tablet');
      if (width) await page.setViewportSize({ width, height: 812 });
      await open(page);
      const days = page.locator('#hoursGrid .hrow');
      await expect(days).toHaveCount(7);
      const lines = await days.evaluateAll((rs) => rs.map((r) => {
        const mid = (e: Element | null) => { const b = e!.getBoundingClientRect(); return b.top + b.height / 2; };
        const parts = [r.querySelector('.day'), ...r.querySelectorAll('input[type=time]'), r.querySelector('.closedlab')];
        const ys = parts.map(mid);
        return Math.max(...ys) - Math.min(...ys);
      }));
      expect(lines.every((d) => d < 12), JSON.stringify(lines)).toBe(true);
      // a narrow card shows the short name and a screen reader still has the long one
      const narrow = await page.locator('#hoursGrid').evaluate((g) => g.closest('.biz-card')!.clientWidth < 440);
      const tue = days.nth(1);
      if (narrow) await expect(tue.locator('.day-short')).toBeVisible();
      else await expect(tue.locator('.day-short')).toBeHidden();
      await expect(tue.locator('.day-long')).toHaveText('Tuesday');
      await expect(tue.getByRole('checkbox', { name: 'Tuesday closed' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    });
  }

  test('@touch Special dates’ buttons and Closed all day are full taps', async ({ page }) => {
    await open(page);
    test.skip(!(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)), 'a mouse needs no 44px tap');
    await page.getByRole('button', { name: 'Add a date' }).click();
    const taps = [page.getByRole('button', { name: 'Change Thursday, Nov 26' }), page.getByRole('button', { name: 'Remove Thursday, Nov 26' }), page.locator('#sdForm .closedlab'), page.getByRole('button', { name: 'Add this date' }), page.getByRole('button', { name: 'Cancel' })];
    for (const t of taps) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
