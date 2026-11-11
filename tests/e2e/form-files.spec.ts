import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { senderTag, FILE_MAX_MB } from '../../supabase/functions/presence/lib/site_send';

// Builder list item 147: a visitor attaches photos or a PDF to a form; the Inbox shows
// them and opens one; each form has its own table of answers, with what's new, seen
// against sent, and a spreadsheet download.
const SITE = 'https://shop.example';
const FN = 'https://db.example.supabase.co/functions/v1/presence';
const SID = '5e000000-0000-4000-8000-000000000001';
const EP = `${FN}/forms/${SID}/submit`;
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
// a form with a "Photo or file" field, as lib/forms.ts draws it (form_files_test.mjs pins that markup)
const FORM = `<form id="presence-form-quote" class="card presence-form" method="post" action="${EP}" enctype="multipart/form-data" novalidate>
<input type="hidden" name="form_id" value="quote"><input type="hidden" name="form_kind" value="quote"><input type="hidden" name="source_page" value="/">
<div class="ff" data-field="name"><p><label for="f-quote-name">Your name</label><input type="text" id="f-quote-name" name="name" required></p></div>
<div class="ff" data-field="photos"><p><label for="f-quote-photos">Photos of the problem</label><input type="file" id="f-quote-photos" name="photos" accept="image/jpeg,image/png,image/webp,application/pdf" multiple aria-describedby="f-quote-photos-help"><span class="ff-help" id="f-quote-photos-help">Photos or PDFs: up to 3, 10 MB each.</span></p></div>
<button class="btn" type="submit">Request a quote</button></form>`;
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quote</title></head>
<body data-reach-tel="(555) 123-4567" data-reach-mail="hello@shop.example"><main id="main"><h1>Get a quote</h1>${FORM}</main>${senderTag(EP)}</body></html>`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

async function openForm(page: Page) {
  await page.route(`${FN}/forms/${SID}/ticket`, (route) => answer(route, 200, { data: { ticket: `1800000000.${'a'.repeat(32)}`, wait_s: 3 } }));
  await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.goto(`${SITE}/quote/`);
}

test.describe('a photo sent with a form', () => {
  test('a visitor attaches a photo and it goes with the form, in the page', async ({ page }) => {
    const sent: Array<string | null> = [];
    await page.route(EP, (route) => { const b = route.request().postDataBuffer(); sent.push(b ? b.toString('latin1') : null); return answer(route, 200, { data: { ok: true, message: 'Got it, a quote is on its way.' } }); });
    await openForm(page);
    await page.getByLabel('Your name').fill('Ana');
    await page.getByLabel('Photos of the problem').setInputFiles({ name: 'roof.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await page.getByRole('button', { name: 'Request a quote' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Got it, a quote is on its way.' })).toBeVisible({ timeout: 12_000 });
    expect(sent).toHaveLength(1);
    // WebKit doesn't hand a file upload's body to the test; where it does, the photo is in it
    if (sent[0]) { expect(sent[0]).toContain('filename="roof.jpg"'); expect(sent[0]).toContain('Content-Type: image/jpeg'); }
  });

  test('a file over the limit is caught in the page, before anything is sent', async ({ page }) => {
    let asked = 0;
    await page.route(EP, (route) => { asked++; return answer(route, 200, { data: { ok: true } }); });
    await openForm(page);
    await page.getByLabel('Your name').fill('Ana');
    await page.getByLabel('Photos of the problem').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(FILE_MAX_MB * 1024 * 1024 + 1, 0xff) });
    await page.getByRole('button', { name: 'Request a quote' }).click();
    await expect(page.locator('.ps-note')).toHaveText(`“huge.jpg” is bigger than ${FILE_MAX_MB} MB. Try a smaller one.`);
    expect(asked).toBe(0);
  });
});

test.describe('the Inbox shows what came with an enquiry', () => {
  test('its files are listed by name and size, and one opens in its own tab', async ({ page, context }) => {
    const LEAD = { id: 'l-9', form_kind: 'quote', name: 'Ana Ruiz', email: 'ana@example.com', phone: '', message: 'The gutter is falling off.', source_page: '/quote/', status: 'new', created_at: '2026-07-13T00:00:00Z',
      files: [{ n: 0, key: 'photos', name: 'roof.jpg', type: 'image/jpeg', size: 1258291 }, { n: 1, key: 'photos', name: 'plan.pdf', type: 'application/pdf', size: 20480 }], form_id: 'quote' };
    await installApp(page, { api: {
      '/portal/feed': { data: { role: 'business_owner', notices: [], pending_approvals: [], client_messages: [], enquiries: [] } },
      '/forms/inbox': { data: { submissions: [LEAD], unread: 1 } },
    } });
    const asked: string[] = [];
    await page.route('**/functions/v1/presence/forms/inbox/l-9/files/*', (route) => { asked.push(new URL(route.request().url()).pathname); return answer(route, 200, { data: { url: 'https://db.example.supabase.co/storage/v1/object/sign/presence-media/forms/x.jpg?token=t', name: 'roof.jpg', type: 'image/jpeg' } }); });
    await context.route('https://db.example.supabase.co/storage/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG }));
    await page.goto('/inbox.html#enquiries');
    await page.locator('#rows').getByRole('option').filter({ hasText: 'Ana Ruiz' }).click();
    const pane = page.locator('#rpane');
    await expect(pane).toContainText('Sent with it: roof.jpg (1.2 MB) · plan.pdf (20 KB)');
    const [tab] = await Promise.all([context.waitForEvent('page'), pane.getByRole('button', { name: 'roof.jpg' }).click()]);
    await tab.waitForURL(/\/storage\/v1\/object\/sign\/presence-media\/forms\/x\.jpg/);
    expect(asked).toEqual(['/functions/v1/presence/forms/inbox/l-9/files/0']);
  });
});

// The editor's Forms card: Answers on a form
const FORM_BLOCK = { type: 'form', id: 'quote', title: 'Request a quote', kind: 'quote', fields: [{ key: 'name', label: 'Your name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }, { key: 'photos', label: 'Photos of the problem', type: 'file' }], rules: [] };
const ANSWERS = { data: {
  form: { id: 'quote', title: 'Request a quote', kind: 'quote', fields: [{ key: 'name', label: 'Your name', type: 'text' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'photos', label: 'Photos of the problem', type: 'file' }] },
  rows: [
    { id: 'a1', created_at: '2026-11-09T15:04:00Z', status: 'new', name: 'Ana', email: 'ana@x.example', phone: '', values: { name: 'Ana', email: 'ana@x.example', photos: 'roof.jpg' }, files: [{ n: 0, key: 'photos', name: 'roof.jpg', type: 'image/jpeg', size: 9 }] },
    { id: 'a2', created_at: '2026-11-01T09:00:00Z', status: 'replied', name: 'Ben', email: 'ben@x.example', phone: '', values: { name: 'Ben', email: 'ben@x.example', photos: '' }, files: [] },
  ], more: false, new: 1, last30: { seen: 214, sent: 9 },
} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section></main></body></html>';
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/settings': { data: { blocks: [FORM_BLOCK], section_meta: { blocks: [], pages: {} }, pages: [] } },
  '/forms/answers': ANSWERS,
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};

test.describe('a form’s own answers, from the editor', () => {
  // on the phone the Forms card doesn't open from the Add tray the way this drives it; the
  // table itself is the same page on every screen
  test.skip(({ viewport }) => !!viewport && viewport.width <= 760, 'phone: the Forms card opens another way');
  test('Answers opens the form’s table: what’s new, seen against sent, and a spreadsheet', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
    const asked: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/forms/answers')) asked.push(new URL(r.url()).search); });
    await page.goto('/presence.html#design');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await page.locator('#btnTrayOpen').click();
    await page.locator('.tray-more').getByRole('button', { name: 'Forms' }).click();
    await expect(page.locator('#formsCard')).toBeVisible();
    await page.locator('#formsCard').getByRole('button', { name: 'Answers' }).click();
    const dlg = page.getByRole('dialog', { name: 'Answers to “Request a quote”' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('2 answers · 1 new');
    await expect(dlg).toContainText('In the last 30 days about 214 visitors saw it and 9 sent it (4.2%).');
    await expect(dlg.getByRole('columnheader')).toHaveText(['Sent', 'Your name', 'Email', 'Photos of the problem', 'Status', 'Open']);
    await expect(dlg.getByRole('row').nth(1)).toContainText('roof.jpg');
    await expect(dlg.getByRole('link', { name: 'Open' }).first()).toHaveAttribute('href', '/inbox.html#enquiries?sel=lead:a1');
    expect(asked).toEqual(['?form=quote']);
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Download spreadsheet' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^request-a-quote-answers-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = (await (await import('node:fs')).promises.readFile(await download.path())).toString('utf8');
    expect(text.replace(/^﻿/, '').split('\r\n')[0]).toBe('Sent,Your name,Email,Photos of the problem,Status');
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('#formsCard').getByRole('button', { name: 'Answers' })).toBeFocused();
  });
});
