import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 176 (Nov 2026): three agency tools from Wix Studio.
//   · Sites: "Ask for their content" (the content form) and "Hand-over kit" on a
//     card's ⋯ menu, each card's line saying where they stand, Plan my week up top;
//   · intake.html: the client's side of the content form, with no sign-in;
//   · week.html: Plan my week;
//   · client.html: the kit at the top of Help in the client's portal.
// The fixtures match the real shapes: agency/client_tools.ts, routes/intake_public.ts,
// routes/client_kit.ts and lib/week_plan.ts (tests/presence/*_test.mjs drive those).
// All names are made up.

const S1 = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', S2 = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', S3 = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const TOKEN = 'c1c1c1c1c1c14c1c8c1cc1c1c1c1c1c1' + 'ab'.repeat(20);
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const pathOf = (r: Route) => new URL(r.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
async function noSideScroll(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1] + 1);
}
async function captureCopies(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { (window as unknown as { __copied: string }).__copied = t; } } });
  });
}

// ══ Sites ══
const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live', address: '', domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [{ who: 'sam@studio.example', email: 'sam@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
  tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: null,
  ...over,
});
const SITES = [
  site({ site_id: S1, name: 'Juniper Floral Co.', state: 'not_live', state_words: 'Not live yet', published_at: null }),
  site({ site_id: S2, name: 'Harbor Dental', address: 'https://harbordental.example', domain: 'harbordental.example' }),
  site({ site_id: S3, name: 'Kiln Street Bakery', address: 'https://kiln.example', domain: 'kiln.example' }),
];
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };
const TOOLS = { data: {
  [S1]: { intake: { status: 'open', answered: 9, total: 11, files: 6, opened_at: '2026-11-10T10:00:00Z', saved_at: '2026-11-12T18:00:00Z', sent_at: '2026-11-12T18:02:00Z', seen_at: null, emailed_at: '2026-11-09T10:00:00Z', created_at: '2026-11-09T09:00:00Z', unread: true }, kit: null },
  [S2]: { intake: null, kit: { shown: true, shown_at: '2026-11-01T00:00:00Z', emailed_at: null, updated_at: '2026-11-01T00:00:00Z' } },
} };
const QS = (ids: string[]) => ids.map((id) => ({ id, label: { about: 'About your business', offer: 'What you offer', hours: 'Opening hours', people: 'You, your team and your place', menu: 'Your menu' }[id] || id, hint: 'A hint', kind: id === 'people' || id === 'menu' ? 'files' : 'words' }));
const bank = (extra: Array<{ id: string; label: string; kind: string }>) => [
  { id: 'about', label: 'About your business', hint: 'What you do', kind: 'words', on: true },
  { id: 'offer', label: 'What you offer', hint: 'One per line', kind: 'words', on: true },
  ...extra.map((e) => ({ ...e, hint: 'Extra', on: true })),
  { id: 'hours', label: 'Opening hours', hint: 'When', kind: 'words', on: true },
  { id: 'people', label: 'You, your team and your place', hint: 'Faces', kind: 'files', on: true },
  { id: 'likes', label: 'Websites you like', hint: 'Links', kind: 'words', on: false },
];
const KINDS = [{ key: 'food', label: 'Restaurant or café' }, { key: 'shop', label: 'Shop' }, { key: 'other', label: 'Something else' }];
const BANK = { food: bank([{ id: 'menu', label: 'Your menu', kind: 'files' }]), shop: bank([{ id: 'sellers', label: 'Your best sellers', kind: 'words' }]), other: bank([]) };
const FORM = (over: Record<string, unknown> = {}) => ({
  v: 1, kind: 'food', questions: QS(['about', 'offer', 'menu', 'hours']), status: 'open', business_name: 'Kiln Street Bakery', studio_site_id: 'x',
  created_at: '2026-11-11T10:00:00Z', created_by: 'sam@studio.example', updated_at: '2026-11-11T10:00:00Z', opened_at: null, saved_at: null, answered: 0, total: 4, files: 0,
  sent_at: null, seen_at: null, notified_at: null, emailed_to: null, emailed_at: null, link: `https://app.example/intake?t=${TOKEN}`, unread: false, ...over,
});

async function openSites(page: Page, opts: { hash?: string; body?: Record<string, unknown> } = {}) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: SITES, partial: false, can_open: true, can_pin: true, can_duplicate: true, ...(opts.body || {}) },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    '/agency/site-tools': TOOLS,
  } });
  let form: Record<string, unknown> | null = null;
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/(intake|kit)/, async (route: Route) => {
    const path = pathOf(route), m = route.request().method();
    const id = path.split('/')[3];
    const body = m === 'GET' ? null : route.request().postDataJSON();
    if (m !== 'GET') writes.push({ method: m, path, body });
    if (path.endsWith('/intake/answers')) return route.fulfill(json({ data: { form: FORM({ business_name: 'Juniper Floral Co.', answered: 9, total: 11, sent_at: '2026-11-12T18:02:00Z' }), answers: [
      { id: 'about', label: 'About your business', kind: 'words', text: 'Family florist since 2009.\nWeddings and bouquets.', files: [] },
      { id: 'people', label: 'You, your team and your place', kind: 'files', text: '', files: [{ id: 'f1', name: 'shop front.jpg', mime: 'image/jpeg', thumb_url: null, url: 'https://files.example/1' }, { id: 'f2', name: 'menu.pdf', mime: 'application/pdf', thumb_url: null, url: 'https://files.example/2' }] },
      { id: 'hours', label: 'Opening hours', kind: 'words', text: '', files: [] },
    ] } }));
    if (path.endsWith('/intake') && m === 'GET') return route.fulfill(json({ data: { form: id === S1 ? FORM({ business_name: 'Juniper Floral Co.', answered: 9, sent_at: '2026-11-12T18:02:00Z', unread: true }) : form, business_name: 'Kiln Street Bakery', owner_email: 'owner@kiln.example', kinds: KINDS, bank: BANK, can_edit: true } }));
    if (path.endsWith('/intake') && m === 'PUT') { form = FORM({ kind: body.kind, questions: QS([...body.picks, ...body.own.map((_: unknown, n: number) => 'own' + (n + 1))]) }); return route.fulfill(json({ data: { form } })); }
    if (path.endsWith('/intake/email')) { form = { ...(form || FORM()), emailed_to: body.to, emailed_at: '2026-11-11T10:05:00Z' }; return route.fulfill(json({ data: { form } })); }
    if (path.endsWith('/intake/state')) { form = { ...(form || FORM()), status: body.open ? 'open' : 'closed' }; return route.fulfill(json({ data: { form } })); }
    if (path.endsWith('/kit') && m === 'GET') return route.fulfill(json({ data: {
      kit: { v: 1, contact: { name: 'Bright Studio', email: 'hello@bright.example', phone: '(555) 010-4477', hours: '' }, guides: [{ title: 'Change a photo or some words', body: 'Send it in Requests.' }], videos: [], files: [], shown: false, shown_at: null, emailed_at: null, updated_at: null, updated_by: null },
      saved: false, business_name: 'Harbor Dental',
      facts: { address: 'https://harbordental.example', live_since: '2026-10-03T09:00:00Z', domain: 'harbordental.example', domain_expires_at: '2027-03-14T00:00:00Z', domain_registrar: 'Namecheap' },
      files: [{ id: 'm1', name: 'Logo — full colour', mime: 'image/png', created_at: '2026-10-01T00:00:00Z' }, { id: 'm2', name: 'Brand colours and fonts', mime: 'application/pdf', created_at: '2026-10-02T00:00:00Z' }],
      owner: { name: 'Ana Ruiz', email: 'ana@harbor.example' }, can_edit: true,
    } }));
    if (path.endsWith('/kit') && m === 'PUT') return route.fulfill(json({ data: { kit: { ...body, v: 1, shown_at: body.shown ? '2026-11-11T10:00:00Z' : null, emailed_at: null, updated_at: '2026-11-11T10:00:00Z', updated_by: 'sam@studio.example' } } }));
    if (path.endsWith('/kit/email')) return route.fulfill(json({ data: { kit: { v: 1, contact: {}, guides: [], videos: [], files: [], shown: true, emailed_at: '2026-11-11T10:06:00Z' } } }));
    return route.fulfill(json({ error: 'not_found' }, 404));
  });
  await page.goto('/sites.html' + (opts.hash || ''));
  await expect(page.locator('.scard')).toHaveCount(3);
  return { writes };
}
async function openMenu(page: Page, id: string) {
  const btn = page.locator(`.scard[data-site="${id}"] [data-menu]`);
  await btn.click();
  await expect(page.locator('#rowMenuHost [role="menu"]')).toBeVisible();
}

test.describe('Sites: the content form and the hand-over kit (item 176)', () => {
  test('each card says where its form and kit stand; the menu has both tools; Plan my week is up top', async ({ page }) => {
    await openSites(page);
    await expect(page.locator(`[data-tools="${S1}"]`)).toContainText('Words and photos arrived · Read them');
    await expect(page.locator(`[data-tools="${S2}"]`)).toContainText('Hand-over kit · in their portal');
    await expect(page.locator(`[data-tools="${S3}"]`)).toBeHidden();
    await expect(page.locator('#weekBtn')).toHaveAttribute('href', '/week.html');
    await openMenu(page, S3);
    const menu = page.locator('#rowMenuHost [role="menu"]');
    await expect(menu.getByRole('menuitem', { name: 'Ask for their content' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Hand-over kit' })).toBeVisible();
  });

  test('a seat that can’t change them gets no new menu doors, but can still read what came back', async ({ page }) => {
    await openSites(page, { body: { can_duplicate: false } });
    await openMenu(page, S3);
    await expect(page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Ask for their content' })).toHaveCount(0);
    await expect(page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Hand-over kit' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator(`[data-tools="${S1}"] [data-ct="answers"]`).click();
    await expect(page.locator('#answersDlg')).toContainText('Family florist since 2009.');
  });

  test('Ask for their content: pick the kind and the questions, add your own, make the link, email it, stop it', async ({ page }) => {
    await captureCopies(page);
    const { writes } = await openSites(page);
    await openMenu(page, S3);
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Ask for their content' }).click();
    const dlg = page.locator('#intakeDlg');
    await expect(dlg.getByRole('heading', { name: 'Ask Kiln Street Bakery for their words and photos' })).toBeVisible();
    await expect(dlg.locator('[data-q="likes"]')).not.toBeChecked();      // starts unticked
    await dlg.getByText('Restaurant or café').click();                      // the kind changes the questions
    await expect(dlg.getByText('Your menu')).toBeVisible();
    await dlg.locator('[data-q="hours"]').uncheck();
    await dlg.locator('#ct-own').fill('Which cakes sell out first?');
    await dlg.getByRole('button', { name: 'Add' }).click();
    await expect(dlg.getByText('Which cakes sell out first?')).toBeVisible();
    await dlg.getByRole('button', { name: 'Make the link' }).click();
    await expect(dlg.getByRole('heading', { name: /Kiln Street Bakery’s content form/ })).toBeVisible();
    const put = writes.find((w) => w.method === 'PUT');
    expect(put!.body).toEqual({ kind: 'food', picks: ['about', 'offer', 'menu', 'people'], own: [{ label: 'Which cakes sell out first?', kind: 'words' }] });
    await expect(dlg.locator('#ct-link')).toHaveValue(`https://app.example/intake?t=${TOKEN}`);
    await dlg.getByRole('button', { name: 'Copy link' }).click();
    expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(`https://app.example/intake?t=${TOKEN}`);
    await expect(dlg.locator('#ct-to')).toHaveValue('owner@kiln.example');    // the owner's address, to start with
    await dlg.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(dlg).toContainText('Emailed to owner@kiln.example');
    expect(writes.find((w) => w.path.endsWith('/intake/email'))!.body).toEqual({ to: 'owner@kiln.example' });
    await dlg.getByRole('button', { name: 'Stop the link' }).click();
    await expect(dlg.getByRole('button', { name: 'Open it again' })).toBeVisible();
    await expect(dlg.locator('#ct-to')).toHaveCount(0);                       // a stopped link can't be emailed
    expect(writes.find((w) => w.path.endsWith('/intake/state'))!.body).toEqual({ open: false });
  });

  test('a card’s "Read them" opens their words and photos; a link from Plan my week opens them too', async ({ page }) => {
    await openSites(page);
    await page.locator(`[data-tools="${S1}"] [data-ct="answers"]`).click();
    const dlg = page.locator('#answersDlg');
    await expect(dlg.getByRole('heading', { name: /Juniper Floral Co\.’s words and photos/ })).toBeVisible();
    await expect(dlg).toContainText('Family florist since 2009.');
    await expect(dlg).toContainText('Not answered yet');
    await expect(dlg.locator('.thumbs a')).toHaveCount(2);
    await expect(dlg.getByRole('link', { name: 'Open their Files' })).toHaveAttribute('href', `/files.html?client=${S1}`);
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(dlg).toBeHidden();
    await page.goto(`/sites.html#answers=${S1}`);
    await expect(page.locator('#answersDlg')).toBeVisible();
    await expect(page.locator('#answersDlg')).toContainText('Family florist since 2009.');
    // Chrome delivers the Close above a frame late; landing after the link opened it again, it emptied the box
    await page.locator('#answersDlg').evaluate((d) => d.dispatchEvent(new Event('close')));
    await expect(page.locator('#answersDlg')).toContainText('Family florist since 2009.');
  });

  test('Hand-over kit: the facts fill in; who to call, a video and a file; switched on and saved', async ({ page }) => {
    const { writes } = await openSites(page);
    await openMenu(page, S2);
    await page.locator('#rowMenuHost').getByRole('menuitem', { name: 'Hand-over kit' }).click();
    const dlg = page.locator('#kitDlg');
    await expect(dlg.getByRole('heading', { name: 'Hand-over kit for Harbor Dental' })).toBeVisible();
    await expect(dlg.locator('.facts')).toContainText('harbordental.example');
    await expect(dlg.locator('.facts')).toContainText('Mar 14, 2027 · with Namecheap');
    await expect(dlg).toContainText('Not saved yet');
    await dlg.locator('#kt-hours').fill('Weekdays 9 to 5');
    await dlg.getByRole('button', { name: '+ Add a video link' }).click();
    await dlg.locator('[data-video="0"] [data-vt]').fill('A 3-minute tour');
    await dlg.locator('[data-video="0"] [data-vu]').fill('https://www.loom.com/share/7d0c');
    await dlg.locator('[data-file="m2"]').check();
    await dlg.locator('#kt-shown').check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(dlg.getByRole('button', { name: 'Tell them it’s ready' })).toBeVisible();
    const put = writes.find((w) => w.method === 'PUT' && w.path.endsWith('/kit'))!.body;
    expect(put.contact).toEqual({ name: 'Bright Studio', phone: '(555) 010-4477', email: 'hello@bright.example', hours: 'Weekdays 9 to 5' });
    expect(put.videos).toEqual([{ title: 'A 3-minute tour', url: 'https://www.loom.com/share/7d0c' }]);
    expect(put.files).toEqual(['m2']);
    expect(put.shown).toBe(true);
    await dlg.getByRole('button', { name: 'Tell them it’s ready' }).click();
    await expect(dlg).toContainText('They were told');
  });
});

// ══ the client's content form ══
const PUBLIC_FORM = (over: Record<string, unknown> = {}) => ({ data: {
  status: 'open', business_name: 'Juniper Floral Co.', studio: { name: 'Bright Studio', logo_url: null, accent: '#5b3fa0' },
  questions: [
    { id: 'about', label: 'About your business', hint: 'What you do, and who it’s for', kind: 'words' },
    { id: 'hours', label: 'Opening hours', hint: '', kind: 'words' },
    { id: 'people', label: 'You, your team and your place', hint: 'Faces build trust', kind: 'files' },
    { id: 'story', label: 'Your story', hint: '', kind: 'words' },
  ],
  answers: { about: { text: 'Family florist since 2009.', files: [] } },
  answered: 1, total: 4, files: 0, sent_at: null, saved_at: null,
  limits: { text: 4000, files_per_question: 20, files_per_form: 60, kinds: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }, ...over,
} });
async function openForm(page: Page, form: unknown = PUBLIC_FORM(), status = 200) {
  const posts: Array<{ path: string; method: string; type: string; body: string }> = [];
  await installApp(page);
  await page.route(/\/functions\/v1\/presence\/intake\//, async (route: Route) => {
    const r = route.request(), path = pathOf(route), m = r.method();
    if (m === 'GET') return route.fulfill(json(form, status));
    posts.push({ path, method: m, type: r.headers()['content-type'] || '', body: m === 'POST' && !path.includes('/files') ? r.postData() || '' : '' });
    if (path.includes('/files') && m === 'POST') return route.fulfill(json({ data: { file: { id: 'f9', name: 'team.png', mime: 'image/png', thumb_url: null }, answered: 2, total: 4, files: 1 } }));
    if (path.includes('/files/') && m === 'DELETE') return route.fulfill(json({ data: { answered: 1, total: 4, files: 0 } }));
    const b = JSON.parse(r.postData() || '{}');
    return route.fulfill(json({ data: { saved_at: '2026-11-11T10:00:00Z', sent_at: b.send ? '2026-11-11T10:01:00Z' : null, answered: 2, total: 4, files: 0 } }));
  });
  await page.goto(`/intake.html?t=${TOKEN}`);
  return { posts };
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

test.describe('The client’s content form (intake.html, item 176)', () => {
  test('opens on the studio’s name: the questions, what’s saved, and how far along', async ({ page }) => {
    await openForm(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Tell us about Juniper Floral Co.' })).toBeVisible();
    await expect(page.locator('header.brand')).toContainText('Bright Studio');
    await expect(page.locator('#progW')).toHaveText('1 of 4 answered');
    await expect(page.getByLabel('About your business')).toHaveValue('Family florist since 2009.');
    await expect(page.getByRole('button', { name: 'Send to Bright Studio' })).toBeVisible();
    await noSideScroll(page);
  });

  test('words save as they type (one plain-text request), a photo goes up and comes off, Send says it’s sent', async ({ page }) => {
    const { posts } = await openForm(page);
    await page.getByLabel('Opening hours').fill('Tue–Sat 9 to 6');
    await expect(page.locator('#sv-hours')).toHaveText('✓ Saved');
    const save = posts.find((p) => p.method === 'POST' && p.path === `/intake/${TOKEN}`)!;
    expect(save.type).toContain('text/plain');
    expect(JSON.parse(save.body)).toEqual({ answers: { hours: 'Tue–Sat 9 to 6' } });
    await expect(page.locator('#progW')).toHaveText('2 of 4 answered');
    await page.locator('#fi-people').setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('#fl-people [data-file="f9"]')).toBeVisible();
    const up = posts.find((p) => p.path.includes('/files'))!;
    expect(up.type).toBe('image/png');
    await page.getByRole('button', { name: 'Remove team.png' }).click();
    await expect(page.locator('#fl-people [data-file="f9"]')).toHaveCount(0);
    expect(posts.some((p) => p.method === 'DELETE' && p.path === `/intake/${TOKEN}/files/f9`)).toBe(true);
    await page.getByRole('button', { name: 'Send to Bright Studio' }).click();
    await expect(page.locator('#sentBanner')).toContainText('Sent to Bright Studio');
    expect(posts.some((p) => p.body.includes('"send":true'))).toBe(true);
  });

  test('a file that isn’t a photo or a PDF is turned away before it’s sent', async ({ page }) => {
    const { posts } = await openForm(page);
    await page.locator('#fi-people').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('#fe-people')).toContainText('isn’t a photo we can use');
    expect(posts.some((p) => p.path.includes('/files'))).toBe(false);
  });

  test('a stopped form, a dead link and half a link each say so plainly', async ({ page }) => {
    await openForm(page, { data: { status: 'closed', business_name: 'Juniper Floral Co.', studio: { name: 'Bright Studio', logo_url: null, accent: '#5b3fa0' } } });
    await expect(page.getByRole('heading', { name: 'This form is closed' })).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    await openForm(page, { error: 'not_found' }, 404);
    await expect(page.getByRole('heading', { name: 'This link isn’t live' })).toBeVisible();
    await page.goto('/intake.html?t=abc');
    await expect(page.getByRole('heading', { name: 'This link isn’t complete' })).toBeVisible();
  });
});

// ══ Plan my week ══
const WEEK = { data: {
  today: '2026-11-16', end: '2026-11-22', late: 2, total: 5, partial: false, text: 'Plan for 2026-11-16 to 2026-11-22\n\nMaple & Main Realty (first) — A late invoice',
  days: [{ day: 'late', count: 2 }, { day: '2026-11-16', count: 2 }, { day: '2026-11-17', count: 0 }, { day: '2026-11-18', count: 1 }, { day: '2026-11-19', count: 0 }, { day: '2026-11-20', count: 0 }, { day: '2026-11-21', count: 0 }, { day: '2026-11-22', count: 0 }],
  clients: [
    { key: `site:${S2}`, site_id: S2, client_id: null, name: 'Maple & Main Realty', own: false, first: true, why: 'A late invoice, and their domain to renew', items: [
      { key: 'money:i1', kind: 'money', what: 'Invoice $1,600 is 6 days overdue', verb: 'Resend', href: '/pipeline.html#outstanding', day: '2026-11-10', when: 'late', late_days: 6 },
      { key: `broken:domain:${S2}`, kind: 'broken', what: 'maplemain.example ends in 4 days', verb: 'Renew', href: '/domains.html', day: null, when: 'today', late_days: 0 },
    ] },
    { key: `site:${S1}`, site_id: S1, client_id: null, name: 'Juniper Floral Co.', own: false, first: false, why: 'Their words and photos arrived, and an estimate runs out Wed', items: [
      { key: `intake:${S1}`, kind: 'intake', what: 'Their words and photos arrived', verb: 'Read them', href: `/sites.html#answers=${S1}`, day: null, when: 'today', late_days: 0 },
      { key: 'estimate:e1', kind: 'estimate', what: 'Estimate $2,400 runs out', verb: 'Follow up', href: '/pipeline.html?deal=d1', day: '2026-11-18', when: 'day', late_days: 0 },
    ] },
    { key: 'own', site_id: null, client_id: null, name: 'Not tied to a client', own: true, first: false, why: 'Your own deals, to-dos and messages', items: [
      { key: 'deal:d9', kind: 'task', what: 'Next step: send the proposal · Rivera Law', verb: 'Open deal', href: '/pipeline.html?deal=d9', day: '2026-11-15', when: 'late', late_days: 1 },
    ] },
  ],
} };
async function openWeek(page: Page, body: unknown = WEEK) {
  await installApp(page, { api: { '/portal/context': studioContext, '/agency/week': body } });
  await page.goto('/week.html');
}

test.describe('Plan my week (week.html, item 176)', () => {
  test('every client in the order they need you: late first, the first one marked, the studio’s own last', async ({ page }) => {
    await openWeek(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Your week' })).toBeVisible();
    await expect(page.locator('.lmeta')).toContainText('5 things across 2 clients and your own · 2 late');
    const cards = page.locator('.ccard');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Maple & Main Realty');
    await expect(cards.nth(0)).toContainText('Needs you first');
    await expect(cards.nth(0).locator('.thing').first()).toContainText('Late · 6 days');
    await expect(cards.nth(0).getByRole('link', { name: 'Resend' })).toHaveAttribute('href', '/pipeline.html#outstanding');
    await expect(cards.nth(1).getByRole('link', { name: 'Read them' })).toHaveAttribute('href', `/sites.html#answers=${S1}`);
    await expect(cards.nth(2)).toContainText('Not tied to a client');
    await noSideScroll(page);
  });

  test('a day narrows the cards to it; Copy as a list copies the plain lines', async ({ page }) => {
    await captureCopies(page);
    await openWeek(page);
    await page.locator('[data-day="late"]').click();
    await expect(page.locator('.ccard')).toHaveCount(2);                     // Maple's late invoice and the studio's late step
    await expect(page.locator('.thing')).toHaveCount(2);
    await expect(page.locator('.intro')).toContainText('Showing what’s late');
    await page.getByRole('link', { name: 'Show the whole week' }).click();
    await expect(page.locator('.thing')).toHaveCount(5);
    await page.getByRole('button', { name: 'Copy as a list' }).click();
    expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toContain('Maple & Main Realty (first)');
  });

  test('a quiet week says so', async ({ page }) => {
    await openWeek(page, { data: { ...WEEK.data, total: 0, late: 0, clients: [], days: WEEK.data.days.map((d) => ({ ...d, count: 0 })), text: '' } });
    await expect(page.getByRole('heading', { name: 'Nothing this week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy as a list' })).toHaveCount(0);
  });
});

// ══ the client's portal: the kit under Help ══
const CLIENT_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
  sees_full_workspace: true, is_client_portal: false, is_managed_client: true, capabilities: ['view_all'],
  landing: '/client.html', attention_count: 0, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
  studio: { name: 'Bright Studio', logo_url: null },
} };
const KIT = { data: {
  contact: { name: 'Sam at Bright Studio', email: 'hello@bright.example', phone: '(555) 010-4477', hours: 'Weekdays 9 to 5' },
  guides: [{ title: 'Change a photo or some words', body: 'Send us the new photo in Requests.' }],
  videos: [{ title: 'A 3-minute tour', url: 'https://www.loom.com/share/7d0c' }],
  files: [{ name: 'Brand colours and fonts', mime: 'application/pdf', url: 'https://files.example/brand' }],
  website: { address: 'https://harbordental.example', live_since: '2026-10-03T09:00:00Z', domain: 'harbordental.example', domain_expires_at: '2027-03-14T00:00:00Z' },
} };
async function openHelp(page: Page, kit: unknown) {
  await installApp(page, { api: {
    '/portal/context': CLIENT_CTX,
    '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
    '/client/projects': { data: [] }, '/client/notifications': { data: [], unread_count: 0 },
    '/client/faq': { data: { html: '', faq: { items: [] } } },
    '/client/kit': kit,
  } });
  await page.goto('/client.html#help');
  await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();
}

test.describe('The kit under Help in the client’s portal (item 176)', () => {
  test('who to call (call and email), their website, how-tos, videos and files — above the help articles', async ({ page }) => {
    await openHelp(page, KIT);
    const kit = page.locator('#sec-kit');
    await expect(kit.getByRole('heading', { name: /Your website kit · from/ })).toBeVisible();
    await expect(kit.getByRole('link', { name: 'Call (555) 010-4477' })).toHaveAttribute('href', 'tel:5550104477');
    await expect(kit.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:hello@bright.example');
    await expect(kit).toContainText('harbordental.example');
    await expect(kit).toContainText('Live since Oct 3, 2026 · domain renews Mar 14, 2027');
    await kit.getByText('Change a photo or some words').click();
    await expect(kit).toContainText('Send us the new photo in Requests.');
    await expect(kit.getByRole('link', { name: /A 3-minute tour/ })).toHaveAttribute('href', 'https://www.loom.com/share/7d0c');
    await expect(kit.getByRole('link', { name: /Brand colours and fonts/ })).toHaveAttribute('href', 'https://files.example/brand');
    const kitTop = await kit.boundingBox(), search = await page.locator('#faqSearch').boundingBox();
    expect(kitTop!.y).toBeLessThan(search!.y);
    await noSideScroll(page);
  });

  test('no kit: Help is as it was', async ({ page }) => {
    await openHelp(page, { data: null });
    await expect(page.locator('#sec-kit')).toHaveCount(0);
    await expect(page.locator('#faqSearch')).toBeVisible();
  });
});
