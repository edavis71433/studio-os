import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 179, part four: the papers shelf. Files and Invoices fold into
// Documents: invoices, proposals and estimates, agreements and files on one shelf,
// newest first by month, each with the one thing to do, and what you owe on top.
// Five tabs become four. Drawn in Figma first (page "Client portal — parts 2 to 4",
// part 4).
const PID = '11111111-1111-4111-8111-111111111111';
const AP = 'a0a0a0a0-0000-4000-8000-000000000009';   // an OK asked on one of the files
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria',
} };
const ymd = (offsetDays: number) => {
  const t = new Date(Date.now() + offsetDays * 86400000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const DELIVERABLES = [
  { id: 'f1', title: 'Homepage mockup.png', note: '', created_at: '2026-11-03T15:00:00Z' },
  { id: 'f2', title: 'Kitchen photos.jpg', note: 'Uploaded by the client.', created_at: '2026-10-15T15:00:00Z' },
  { id: 'f3', title: 'Logo options.pdf', note: '', created_at: '2026-10-16T15:00:00Z' },
];
const bundle = { data: {
  project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [],
  progress: { total: 0, done: 0, pct: 0 }, deliverables: DELIVERABLES,
  approvals: [{ id: AP, subject_type: 'deliverable', subject_id: 'f3', title: 'Logo options', summary: 'Which one feels like you?', content_hash: 'h9', status: 'pending' }],
} };
const INVOICES = [
  { id: 'i1', name: 'Website build, second half', amount: 450, status: 'open', due_date: ymd(3), created_at: '2026-11-04T15:00:00Z', pay_url: 'https://pay.example/i1', view_url: 'https://docs.example/i1' },
  { id: 'i3', name: 'Deposit', amount: 600, status: 'paid', paid_at: '2026-10-02T15:00:00Z', due_date: '2026-10-05', created_at: '2026-10-01T15:00:00Z', view_url: 'https://docs.example/i3' },
];
const DOCS = [
  { kind: 'estimate', id: 'e1', title: 'Spring refresh', status: 'sent', amount: 1200, created_at: '2026-10-21T15:00:00Z', view_url: 'https://docs.example/e1' },
  { kind: 'proposal', id: 'p1', title: 'Your new website', status: 'accepted', amount: 2400, created_at: '2026-09-03T15:00:00Z', view_url: 'https://docs.example/p1' },
  { kind: 'contract', id: 'c1', title: 'Website agreement', status: 'signed', signed_at: '2026-09-03T18:00:00Z', created_at: '2026-09-03T16:00:00Z', view_url: 'https://docs.example/c1' },
];
const API = {
  '/portal/context': CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: bundle,
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/documents': { data: { documents: DOCS } },
  '/client/billing': { data: { invoices: INVOICES } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
};
async function start(page: Page, api: Record<string, unknown> = {}) {
  await installApp(page, { api: { ...API, ...api } });
}
const openShelf = async (page: Page) => {
  await page.locator('#tabnav [data-tab="documents"]').click();
  await expect(page.locator('#shelf .srow').first()).toBeVisible();
};
const row = (page: Page, title: string) => page.locator('#shelf .srow', { has: page.getByRole('heading', { name: title, exact: true }) });

test.describe('Client portal part four — the papers shelf (item 179)', () => {
  test('four tabs; Documents opens on everything, newest first by month, what you owe on top with the one filled Pay', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    const tabs = page.locator('#tabnav [data-tab]');
    await expect(tabs).toHaveCount(4);
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')))).toEqual(['home', 'messages', 'documents', 'help']);
    await openShelf(page);
    await expect(page).toHaveTitle('Documents — Marlow & Co');
    await expect(page.locator('#main .shelfhead .sub')).toHaveText('Everything Marlow & Co has sent you, in one place.');
    // what you owe: the total, the invoice and its day, and the one filled button
    const owe = page.locator('#inv-unpaid');
    await expect(owe.locator('.owet')).toHaveText('You owe $450');
    await expect(owe.locator('.owes')).toContainText('Website build, second half · due ');
    await expect(page.getByRole('link', { name: 'Pay $450 — Website build, second half' })).toHaveAttribute('href', 'https://pay.example/i1');
    await expect(page.locator('#shelf .approve')).toHaveCount(1);
    // newest first, under each month
    await expect(page.locator('#shelf .shelfmonth')).toHaveText(['November', 'October', 'September']);
    await expect(page.locator('#shelf .srow .fname')).toHaveText([
      'Website build, second half', 'Homepage mockup.png', 'Spring refresh', 'Logo options.pdf', 'Kitchen photos.jpg', 'Deposit', 'Website agreement', 'Your new website',
    ]);
    // each paper with its one thing to do
    await expect(row(page, 'Website build, second half').getByRole('link', { name: 'Pay — Website build, second half' })).toHaveAttribute('href', 'https://pay.example/i1');
    expect(await row(page, 'Website build, second half').getByRole('link', { name: 'Pay — Website build, second half' }).getAttribute('target')).toBeNull();   // Pay stays in this tab (G9)
    await expect(row(page, 'Homepage mockup.png').getByRole('button', { name: 'Save — Homepage mockup.png' })).toBeVisible();
    await expect(row(page, 'Spring refresh').getByRole('link', { name: 'Look — Spring refresh' })).toHaveAttribute('target', '_blank');
    await expect(row(page, 'Logo options.pdf').getByRole('button', { name: 'Look — Logo options.pdf' })).toBeVisible();
    await expect(row(page, 'Deposit').getByRole('link', { name: 'Receipt — Deposit' })).toHaveAttribute('href', 'https://docs.example/i3');
    await expect(row(page, 'Website agreement').getByRole('link', { name: 'View — Website agreement' })).toHaveAttribute('rel', 'noopener');
    // the line under each name says what it is and where it stands
    await expect(row(page, 'Spring refresh').locator('.fmeta')).toHaveText('Estimate · $1,200 · waiting for your OK');
    await expect(row(page, 'Deposit').locator('.fmeta')).toHaveText('Invoice · $600 · paid Oct 2');
    await expect(row(page, 'Kitchen photos.jpg').locator('.fmeta')).toHaveText('File you sent · Oct 15');
  });

  test('the filters: each kind on its own, with counts in the rail on a computer', async ({ page }, testInfo) => {
    await start(page);
    await page.goto('/client.html');
    await openShelf(page);
    const nav = page.locator('#shelf .shelfnav');
    await expect(nav.locator('[data-shelf]')).toHaveCount(5);   // All, Invoices, Proposals and estimates, Agreements, Files
    await expect(nav.locator('[data-shelf="all"]')).toHaveAttribute('aria-pressed', 'true');
    if (testInfo.project.name === 'desktop-chromium') {
      await expect(nav.locator('[data-shelf="files"] .sc')).toHaveText('3');
      await expect(nav.locator('[data-shelf="proposals"] .sl')).toHaveText('Proposals and estimates');
      // the rail stands beside the list
      const navBox = await nav.boundingBox(), listBox = await page.locator('#shelf .shelfbody').boundingBox();
      expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(listBox!.x);
    } else {
      await expect(nav.locator('[data-shelf="files"] .sc')).toBeHidden();   // a phone's chips stay short
    }
    await nav.locator('[data-shelf="files"]').click();
    await expect(page.locator('#shelf .srow .fname')).toHaveText(['Homepage mockup.png', 'Logo options.pdf', 'Kitchen photos.jpg']);
    await expect(page.locator('#inv-unpaid')).toHaveCount(0);   // what you owe rides on All and Invoices only
    await expect(nav.locator('[data-shelf="files"]')).toBeFocused();
    await nav.locator('[data-shelf="invoices"]').click();
    await expect(page.locator('#shelf .srow .fname')).toHaveText(['Website build, second half', 'Deposit']);
    await expect(page.locator('#inv-unpaid .owet')).toHaveText('You owe $450');
    await expect(page.getByText('Your website subscription is billed separately.')).toBeVisible();
    await nav.locator('[data-shelf="agreements"]').click();
    await expect(page.locator('#shelf .srow .fname')).toHaveText(['Website agreement']);
  });

  test('several unpaid: You owe sums them and points to the Invoices filter', async ({ page }) => {
    await start(page, { '/client/billing': { data: { invoices: [
      ...INVOICES,
      { id: 'i2', name: 'Photo refresh', amount: 150, status: 'open', due_date: ymd(1), created_at: '2026-11-02T15:00:00Z', pay_url: 'https://pay.example/i2' },
    ] } } });
    await page.goto('/client.html');
    await openShelf(page);
    await expect(page.locator('#inv-unpaid .owet')).toHaveText('You owe $600');
    await expect(page.locator('#inv-unpaid .owes')).toContainText('2 invoices · the next due ');
    await page.getByRole('button', { name: 'See invoices' }).click();
    await expect(page.locator('#shelf [data-shelf="invoices"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'See invoices' })).toHaveCount(0);   // already there
  });

  test('a file waiting for your OK opens in place, and its back link returns to the shelf', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await openShelf(page);
    await expect(row(page, 'Logo options.pdf').locator('.fst')).toHaveText('Your OK');
    await row(page, 'Logo options.pdf').getByRole('button', { name: 'Look — Logo options.pdf' }).click();
    await expect(page.locator('#main h1')).toHaveText('Logo options');
    await expect(page.getByRole('button', { name: 'Looks good — approve' })).toBeVisible();
    await page.getByRole('link', { name: '‹ Documents' }).click();
    await expect(page.locator('#main').getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await expect(page.locator('#tabnav [data-tab="documents"]')).toHaveAttribute('aria-current', 'page');
  });

  test('old links keep working: #files and #invoices open the shelf on that filter', async ({ page }) => {
    await start(page);
    await page.goto('/client.html#files');
    await expect(page.locator('#shelf [data-shelf="files"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tabnav [data-tab="documents"]')).toHaveAttribute('aria-current', 'page');
    await page.goto('about:blank');   // a fresh load: an address that only changes its # stays on the same page
    await page.goto('/client.html#invoices');
    await expect(page.locator('#shelf [data-shelf="invoices"]')).toHaveAttribute('aria-pressed', 'true');
    // and the tab itself always opens on everything
    await page.locator('#tabnav [data-tab="home"]').click();
    await page.locator('#tabnav [data-tab="documents"]').click();
    await expect(page.locator('#shelf [data-shelf="all"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Send a file: the form names the limits, sends to the project, and the shelf shows it', async ({ page }) => {
    let recorded = false;
    await start(page);
    await page.route(`**/functions/v1/presence/client/projects/${PID}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
      ...bundle.data, deliverables: recorded ? [{ id: 'n1', title: 'Team photo.png', note: 'Uploaded by the client.', created_at: new Date().toISOString() }, ...DELIVERABLES] : DELIVERABLES,
    } }) }));
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { media_id: 'm1', upload_url: 'https://storage.example/up/1' } }) }));
    await page.route('https://storage.example/**', (route) => route.fulfill({ status: 200, body: '' }));
    await page.route('**/functions/v1/presence/client/projects/*/uploads', (route) => { recorded = true; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'n1' } }) }); });
    await page.goto('/client.html');
    await openShelf(page);
    await page.locator('#ffile').setInputFiles({ name: 'Team photo.png', mimeType: 'image/png', buffer: Buffer.from('png') });
    await expect(page.locator('#fsend .fshare-d')).toHaveText('JPEG, PNG or WebP images up to 10MB, or PDFs up to 25MB. It lands in your project’s files right away.');
    await page.locator('#fgo').click();
    await expect(page.locator('#toast')).toContainText('Sent to your studio');
    await expect(row(page, 'Team photo.png').locator('.fst')).toHaveText('You shared');
    await expect(page.locator('#fchoose')).toBeFocused();
  });

  test('Help’s starter answers send you to Documents to send a file and to pay', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="help"]').click();
    await expect(page.locator('#main')).toContainText('Open Documents and press Send a file.');
    await expect(page.locator('#main')).toContainText('Open Documents: what you owe is at the top, with Pay.');
    await expect(page.locator('#main')).not.toContainText('Open Files');
    await expect(page.locator('#main')).not.toContainText('Open Invoices');
  });

  test('monthly reports: the ones that went out, under the month they arrived; Open downloads the PDF with the sign-in and the New goes', async ({ page }) => {
    await start(page, { '/client/reports': { data: { reports: [{ month: '2026-10', label: 'October 2026' }, { month: '2026-09', label: 'September 2026' }] } } });
    await page.route('**/functions/v1/presence/client/reports/2026-10/pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf',
      headers: { 'Content-Disposition': 'attachment; filename="Report - October 2026.pdf"', 'Access-Control-Expose-Headers': 'Content-Disposition' }, body: Buffer.from('%PDF-1.4 test') }));
    await page.goto('/client.html');
    await openShelf(page);
    const oct = row(page, 'October report');
    await expect(oct.locator('.fmeta')).toHaveText('Monthly report · PDF · visitors, searches and what changed');
    await expect(oct.locator('.fst')).toHaveText('New');                      // the newest, not opened yet
    await expect(oct.locator('.fst')).toBeVisible();                            // on a phone too, beside Open (as drawn)
    await expect(row(page, 'September report').locator('.fst')).toHaveText('');
    // filed under the month it went out: October's report arrived in November
    const nov = page.locator('#shelf .shelfgroup', { has: page.locator('.shelfmonth', { hasText: 'November' }) });
    await expect(nov.getByRole('heading', { name: 'October report', exact: true })).toBeVisible();
    // its own filter, first in the list
    await expect(page.locator('#shelf .shelfnav [data-shelf]').nth(1)).toHaveAttribute('data-shelf', 'reports');
    await page.locator('#shelf [data-shelf="reports"]').click();
    await expect(page.locator('#shelf .srow .fname')).toHaveText(['October report', 'September report']);
    // Open: a fetch with the sign-in, saved as a download
    const req = page.waitForRequest((r) => r.url().includes('/client/reports/2026-10/pdf'));
    await page.getByRole('button', { name: 'Open — October report' }).click();
    expect((await req).headers()['authorization'] || '').toMatch(/^Bearer /);
    await expect(page.locator('#toast')).toContainText('Downloaded Report - October 2026.pdf.');
    await expect(row(page, 'October report').locator('.fst')).toHaveText('');   // opened: the New goes
    await expect(page.locator('#shelf [data-shelf="reports"]')).toHaveAttribute('aria-pressed', 'true');   // and the filter stays
  });

  test('monthly reports: a failed read says so; a server without the read yet says nothing', async ({ page }) => {
    await start(page);
    await page.route('**/functions/v1/presence/client/reports', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
    await page.goto('/client.html');
    await openShelf(page);
    await expect(page.getByText('We couldn’t load your monthly reports just now — please try again in a moment.')).toBeVisible();
    await page.unroute('**/functions/v1/presence/client/reports');
    await page.route('**/functions/v1/presence/client/reports', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }));
    await page.locator('#tabnav [data-tab="home"]').click();
    await openShelf(page);
    await expect(page.getByText('monthly reports', { exact: false })).toHaveCount(0);
  });

  test('phone: a row shows its one button or a chip, and nothing runs off the screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the one-line rows are the phone layout');
    await start(page);
    await page.goto('/client.html');
    await openShelf(page);
    await expect(row(page, 'Website agreement').locator('.fst')).toBeHidden();      // View is the button; "signed Sep 3" says the rest
    await expect(row(page, 'Website agreement').getByRole('link', { name: 'View — Website agreement' })).toBeVisible();
    await expect(row(page, 'Website agreement').locator('.fmeta')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
