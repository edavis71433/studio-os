import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 179, part two: every to-do opens the thing itself, and a
// client approves or comments on the website draft inside the portal. Drawn in
// Figma first (page "Client portal — parts 2 to 4", part 2).
const PID = '11111111-1111-4111-8111-111111111111';
const AW = 'a0a0a0a0-0000-4000-8000-000000000001';   // the website draft, waiting for an OK
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria',
} };
const TASKS = [
  { id: 'c1', title: 'Send back your project questionnaire', status: 'todo', client_action_required: true, source: 'checklist:questionnaire_returned', derived: {} },
  { id: 'c2', title: 'Send your content and photos', status: 'todo', client_action_required: true, source: 'checklist:content_received', derived: {} },
  { id: 'c3', title: 'Review the design draft', status: 'todo', client_action_required: true, source: 'checklist:client_review', derived: {} },
  { id: 't9', title: 'Pick your two brand colours', detail: 'Any two you love. We’ll test them on the homepage.', status: 'todo', client_action_required: true, source: 'manual', due_date: '2099-01-10', derived: { overdue: false } },
];
const WEBSITE_AP = { id: AW, subject_type: 'website', subject_id: 'e0e0e0e0-0000-4000-8000-000000000000', title: 'Your website draft', summary: 'Does this feel like your shop?', content_hash: 'hw1', status: 'pending' };
const OLD_AP = { id: 'a-old', subject_type: 'custom', title: 'Colour palette', summary: '', content_hash: 'x', status: 'approved', decided_at: '2026-10-28T00:00:00Z' };
const bundle = (over: Record<string, unknown> = {}) => ({ data: {
  project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: TASKS, events: [], deliverables: [],
  approvals: [WEBSITE_AP, OLD_AP], surveys: [{ id: 'sv1', title: 'Project questionnaire' }], progress: { total: 10, done: 2, pct: 20 }, ...over,
} });
const DRAFT_HOME = { data: {
  approval: { id: AW, status: 'pending' }, page: '',
  pages: [{ slug: '', title: 'Home' }, { slug: 'menu', title: 'Our menu' }],
  sections: [{ id: 'features:b1', name: 'Features' }, { id: 'gallery:b2', name: 'Photo gallery' }],
  notes: [{ id: 'n1', page: '', page_title: 'Home', part: 'Photo gallery', body: 'Brighter please', status: 'done', created_at: '2026-11-09T00:00:00Z' }],
  html: '<html><body><h1 id="dh">Fresh flowers daily</h1><a id="tomenu" href="#dds-draft-page=%2Fmenu%2F">Menu</a></body></html>',
} };
const DRAFT_MENU = { data: { ...DRAFT_HOME.data, page: 'menu', sections: [{ id: 'pricing:p1', name: 'Pricing' }], html: '<html><body><h1 id="dh">Our menu</h1></body></html>' } };
const API = {
  '/portal/context': CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: bundle(),
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/support': { data: [] },
  '/client/billing': { data: { invoices: [] } },
  '/client/surveys/sv1': { data: { survey: { title: 'Project questionnaire', questions: [
    { key: 'goal', label: 'What should visitors do first?', type: 'text' },
    { key: 'feel', label: 'Three words for your shop', type: 'text' },
    { key: 'rate', label: 'How ready are your photos?', type: 'rating' },
  ] }, my_response: null } },
};

async function start(page: Page, api: Record<string, unknown> = {}) {
  await installApp(page, { api: { ...API, ...api } });
  await page.route(`**/functions/v1/presence/client/approvals/${AW}/draft*`, (route) => {
    const pg = new URL(route.request().url()).searchParams.get('page') || '';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pg === 'menu' ? DRAFT_MENU : DRAFT_HOME) });
  });
}
const row = (page: Page, title: string) => page.locator('#needs-body .qrow', { has: page.getByRole('heading', { name: title }) });
const frameText = (page: Page, sel: string) => page.locator(sel).evaluate((f: HTMLIFrameElement) => (f.contentDocument && f.contentDocument.body ? f.contentDocument.body.textContent : '') || '');

test.describe('Client portal part two — every to-do opens the thing itself (item 179)', () => {
  test('Home: one row per to-do, each with its own verb; the draft stands in for “Review the design draft”', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await expect(page.locator('#main h1').first()).toHaveText(/, Maria\.$/);   // the name on the studio's record
    await expect(page.locator('#needs-h')).toHaveText('Needs you · 4');
    const draft = row(page, 'Your website draft');
    await expect(draft.locator('.kchip')).toHaveText('Draft');
    await expect(draft).toContainText('Marlow & Co asked: “Does this feel like your shop?”');
    await expect(draft.getByRole('button', { name: 'Open — Your website draft' })).toHaveClass(/approve/);   // the top row's verb is the one filled button
    await expect(row(page, 'Send back your project questionnaire').getByRole('button', { name: 'Start — Send back your project questionnaire' })).toBeVisible();
    await expect(row(page, 'Send your content and photos').getByRole('button', { name: 'Send — Send your content and photos' })).toBeVisible();
    await expect(row(page, 'Pick your two brand colours').getByRole('button', { name: 'Open — Pick your two brand colours' })).toBeVisible();
    await expect(page.locator('#needs-body').getByRole('heading', { name: 'Review the design draft', exact: true })).toHaveCount(0);
    await expect(page.locator('#needs-body').getByRole('heading', { name: 'Project questionnaire', exact: true })).toHaveCount(0);   // its survey rides on the to-do
    await expect(page.locator('#needs-body button.approve')).toHaveCount(1);
  });

  test('the draft opens in place, page by page, and full screen inside the portal', async ({ page }) => {
    await start(page);
    await page.goto('/client.html');
    await row(page, 'Your website draft').getByRole('button', { name: /^Open/ }).click();
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
    await expect(page.locator('#main h1')).toBeFocused();
    await expect(page.locator('.askcard')).toContainText('Marlow & Co asked');
    await expect(page.locator('.askcard')).toContainText('“Does this feel like your shop?”');
    await expect.poll(() => frameText(page, '#dpic iframe')).toContain('Fresh flowers daily');
    // the picture is drawn with scripts off
    await expect(page.locator('#dpic iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
    const pills = page.getByRole('group', { name: 'Pages in the draft' });
    await expect(pills.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await pills.getByRole('button', { name: 'Our menu' }).click();
    await expect.poll(() => frameText(page, '#dpic iframe')).toContain('Our menu');
    await expect(page.locator('#npart option')).toHaveText(['The whole page (Our menu)', 'Pricing']);
    await pills.getByRole('button', { name: 'Home', exact: true }).click();
    await expect.poll(() => frameText(page, '#dpic iframe')).toContain('Fresh flowers daily');
    // full screen: the page at its own size; a link between the draft's pages turns the page there
    await page.getByRole('button', { name: 'Full screen ↗' }).click();
    const dialog = page.getByRole('dialog', { name: 'Your website draft, full screen' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await expect.poll(() => frameText(page, '#dfull iframe')).toContain('Fresh flowers daily');
    await page.frameLocator('#dfull iframe').locator('#tomenu').click();
    await expect.poll(() => frameText(page, '#dfull iframe')).toContain('Our menu');
    await expect(dialog.getByRole('button', { name: 'Our menu' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Full screen ↗' })).toBeFocused();
    // back goes where it came from
    await page.getByRole('link', { name: '‹ Home' }).click();
    await expect(page.locator('#needs-h')).toBeVisible();
  });

  test('approving sends the exact version seen, then says thank you', async ({ page }) => {
    await start(page);
    let body: Record<string, unknown> | null = null;
    await page.route(`**/functions/v1/presence/client/approvals/${AW}/decide`, (route) => { body = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'approved' } }) }); });
    await page.goto('/client.html');
    await row(page, 'Your website draft').getByRole('button', { name: /^Open/ }).click();
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
    await expect(page.getByText('You approved Colour palette')).toBeVisible();   // what was decided before stays in view
    await page.getByRole('button', { name: 'Looks good — approve' }).click();
    await expect(page.getByRole('heading', { name: 'Approved — thank you.' })).toBeVisible();
    expect(body).toEqual({ decision: 'approved', presented_hash: 'hw1', note: '' });
    await expect(page.locator('.thanks')).toContainText('Marlow & Co has been told. They’ll put it live and let you know here.');
    await page.getByRole('button', { name: 'Back to Home' }).click();
    await expect(page.locator('#needs-h')).toBeVisible();
  });

  test('asking for a change needs words, and sends them', async ({ page }) => {
    await start(page);
    let body: Record<string, unknown> | null = null;
    await page.route(`**/functions/v1/presence/client/approvals/${AW}/decide`, (route) => { body = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'changes_requested' } }) }); });
    await page.goto(`/client.html?project=${PID}&approval=${AW}`);   // the "Needs your OK" email's button
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
    const ask = page.getByRole('button', { name: 'Ask for a change' });
    await ask.click();
    await expect(ask).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#apchgt')).toBeFocused();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.locator('#toast')).toContainText('Say what you’d like changed.');
    expect(body).toBeNull();
    await page.locator('#apchgt').fill('Make the logo bigger');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('heading', { name: 'Sent — your studio will take a look.' })).toBeVisible();
    expect(body).toEqual({ decision: 'changes_requested', presented_hash: 'hw1', note: 'Make the logo bigger' });
  });

  test('a note pinned to one part goes to the studio and joins the list', async ({ page }) => {
    await start(page);
    let body: Record<string, unknown> | null = null;
    await page.route(`**/functions/v1/presence/client/approvals/${AW}/notes`, (route) => {
      body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'n2', page: '', page_title: 'Home', part: 'Features', body: 'Bigger photos', status: 'open', created_at: new Date().toISOString() } }) });
    });
    await page.goto(`/client.html?project=${PID}&approval=${AW}`);
    await expect.poll(() => frameText(page, '#dpic iframe')).toContain('Fresh flowers daily');
    await expect(page.locator('#draftnotes')).toContainText('Brighter please');
    await expect(page.locator('#draftnotes')).toContainText('Done');
    await page.getByRole('button', { name: 'Send note' }).click();
    await expect(page.locator('#toast')).toContainText('Write a note first.');
    await page.locator('#npart').selectOption({ label: 'Features' });
    await page.locator('#nbody').fill('Bigger photos');
    await page.getByRole('button', { name: 'Send note' }).click();
    await expect(page.locator('#notelist li').first()).toContainText('Home · Features');
    await expect(page.locator('#notelist li').first()).toContainText('“Bigger photos”');
    await expect(page.locator('#draftnotes h2')).toHaveText('Your notes on this draft · 2');
    expect(body).toEqual({ page: '', block_id: 'features:b1', body: 'Bigger photos' });
    await expect(page.locator('#nbody')).toHaveValue('');
  });

  test('a draft that changed under the client is read again, never decided blind', async ({ page }) => {
    await start(page);
    let reads = 0;
    await page.route(`**/functions/v1/presence/client/projects/${PID}`, (route) => { reads++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle()) }); });
    await page.route(`**/functions/v1/presence/client/approvals/${AW}/decide`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'version_mismatch', message: 'This item was updated — reload the latest version before deciding.' }) }));
    await page.goto(`/client.html?project=${PID}&approval=${AW}`);
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
    const before = reads;
    await page.getByRole('button', { name: 'Looks good — approve' }).click();
    await expect(page.locator('#toast')).toContainText('This item was updated');
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: 'Looks good — approve' })).toBeEnabled();
  });

  test('the photos to-do: several files at once, then tell the studio', async ({ page }) => {
    let recorded = 0, urls = 0;
    const sent: string[] = [];
    await start(page);
    await page.route(`**/functions/v1/presence/client/projects/${PID}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle({ deliverables: recorded ? [
      { id: 'u1', title: 'Shopfront.jpg', note: 'Uploaded by the client.', created_at: '2026-11-10T00:00:00Z' },
      { id: 'u2', title: 'Logo.png', note: 'Uploaded by the client.', created_at: '2026-11-10T00:00:00Z' },
    ] : [] })) }));
    await page.route('**/functions/v1/presence/client/projects/*/upload-url', (route) => { urls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { media_id: 'm' + urls, upload_url: 'https://storage.example/up/' + urls } }) }); });
    await page.route('https://storage.example/**', (route) => route.fulfill({ status: 200, body: '' }));
    await page.route('**/functions/v1/presence/client/projects/*/uploads', (route) => { recorded++; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'nd' + recorded } }) }); });
    await page.route(`**/functions/v1/presence/client/projects/${PID}/messages`, (route) => {
      if (route.request().method() === 'POST') sent.push(JSON.parse(route.request().postData() || '{}').body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: route.request().method() === 'POST' ? { id: 'mg9' } : [] }) });
    });
    await page.goto('/client.html');
    await row(page, 'Send your content and photos').getByRole('button', { name: /^Send/ }).click();
    await expect(page.locator('#main h1')).toHaveText('Send your content and photos');
    await expect(page.getByRole('heading', { name: 'What helps most' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sent so far · 0' })).toBeVisible();
    // a file the store can't take is refused before anything is sent
    await page.locator('#dfiles').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
    await expect(page.locator('#toast')).toContainText('That kind of file can’t be sent here');
    expect(urls).toBe(0);
    await page.locator('#dfiles').setInputFiles([
      { name: 'Shopfront.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') },
      { name: 'Logo.png', mimeType: 'image/png', buffer: Buffer.from('png') },
    ]);
    await expect(page.getByRole('heading', { name: 'Sent so far · 2' })).toBeVisible();
    expect(urls).toBe(2);
    expect(recorded).toBe(2);
    await page.getByRole('button', { name: 'I’ve sent everything — tell my studio' }).click();
    await expect(page.getByRole('button', { name: 'Your studio has been told ✓' })).toBeDisabled();
    expect(sent).toEqual(['I’ve sent everything for “Send your content and photos”.']);
  });

  test('the questionnaire: one question at a time, kept on this device until it’s sent', async ({ page }) => {
    await start(page);
    let answers: Record<string, unknown> | null = null;
    await page.route('**/functions/v1/presence/client/surveys/sv1/respond', (route) => { answers = JSON.parse(route.request().postData() || '{}').answers; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); });
    await page.goto('/client.html');
    await row(page, 'Send back your project questionnaire').getByRole('button', { name: /^Start/ }).click();
    await expect(page.locator('#main h1')).toHaveText('Project questionnaire');
    await expect(page.locator('#qprog')).toHaveText('Question 1 of 3');
    await page.getByLabel('What should visitors do first?').fill('Call us');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#qprog')).toHaveText('Question 2 of 3');
    await expect(page.getByLabel('Three words for your shop')).toBeFocused();
    await page.getByLabel('Three words for your shop').fill('Fresh, local, warm');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('What should visitors do first?')).toHaveValue('Call us');
    // leave and come back: the answers are still here
    await page.goto('/client.html');
    await row(page, 'Send back your project questionnaire').getByRole('button', { name: /^Start/ }).click();
    await expect(page.getByLabel('What should visitors do first?')).toHaveValue('Call us');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByLabel('Three words for your shop')).toHaveValue('Fresh, local, warm');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('How ready are your photos?').selectOption('4');
    await page.getByRole('button', { name: 'Send your answers' }).click();
    await expect(page.locator('#toast')).toContainText('Thank you!');
    await expect(page.locator('#needs-h')).toBeVisible();
    expect(answers).toEqual({ goal: 'Call us', feel: 'Fresh, local, warm', rate: '4' });
    expect(await page.evaluate(() => localStorage.getItem('dds-survey-draft:sv1'))).toBeNull();
  });

  test('any other to-do opens with its own words and Mark done', async ({ page }) => {
    await start(page);
    let done = 0;
    await page.route(`**/functions/v1/presence/client/projects/${PID}/tasks/t9/done`, (route) => { done++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); });
    await page.goto('/client.html');
    await row(page, 'Pick your two brand colours').getByRole('button', { name: /^Open/ }).click();
    await expect(page.locator('#main h1')).toHaveText('Pick your two brand colours');
    await expect(page.getByText('Any two you love. We’ll test them on the homepage.')).toBeVisible();
    await expect(page.getByText('Due Jan 10, 2099.')).toBeVisible();
    await page.getByRole('button', { name: 'Mark done' }).click();
    await expect(page.locator('#toast')).toContainText('Marked done');
    await expect(page.locator('#needs-h')).toBeVisible();
    expect(done).toBe(1);
  });

  test('a file waiting for an OK shows its picture on the page', async ({ page }) => {
    await start(page, { [`/client/projects/${PID}`]: bundle({
      approvals: [{ id: 'af1', subject_type: 'deliverable', subject_id: 'd1', title: 'Homepage mockup', summary: '', content_hash: 'hf', status: 'pending' }],
      deliverables: [{ id: 'd1', title: 'Homepage mockup.png', note: '', created_at: '2026-11-08T00:00:00Z' }],
      tasks: [], surveys: [],
    }), '/client/deliverables/d1/download': { data: { url: 'https://files.example/mock.png', title: 'Homepage mockup.png' } } });
    await page.route('https://files.example/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
    await page.goto('/client.html');
    await row(page, 'Homepage mockup').getByRole('button', { name: /^Open/ }).click();
    await expect(page.locator('#main h1')).toHaveText('Homepage mockup');
    await expect(page.getByRole('img', { name: 'Homepage mockup.png' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open full size — Homepage mockup.png' })).toBeVisible();
  });

  test('from the project page: the draft and the to-dos open in place, and back returns to the project', async ({ page }) => {
    await start(page);
    await page.goto(`/client.html?project=${PID}`);
    await expect(page.locator('#main h1')).toHaveText('Website build');
    await page.locator('#sec-todos .card', { hasText: 'Review the design draft' }).getByRole('button', { name: 'See the draft' }).click();
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
    await page.getByRole('link', { name: '‹ Website build' }).click();
    await expect(page.locator('#main h1')).toHaveText('Website build');
    await page.locator('#sec-todos .card', { hasText: 'Send your content and photos' }).getByRole('button', { name: 'Send files' }).click();
    await expect(page.locator('#main h1')).toHaveText('Send your content and photos');
    await page.getByRole('link', { name: '‹ Website build' }).click();
    await expect(page.locator('#main h1')).toHaveText('Website build');
    await page.locator('#sec-approvals').getByRole('button', { name: 'See the draft — Your website draft' }).click();
    await expect(page.locator('#main h1')).toHaveText('Your website draft');
  });

  test('on a computer the draft sits left of the answer; on a phone the ask, the draft and the answer stack', async ({ page }) => {
    await start(page);
    await page.goto(`/client.html?project=${PID}&approval=${AW}`);
    await expect.poll(() => frameText(page, '#dpic iframe')).toContain('Fresh flowers daily');
    const thing = await page.locator('.s-thing').boundingBox();
    const answer = await page.locator('.s-answer').boundingBox();
    const ask = await page.locator('.s-ask').boundingBox();
    const wide = (page.viewportSize()?.width || 0) >= 1000;
    if (wide) {
      expect(thing!.x + thing!.width).toBeLessThanOrEqual(answer!.x + 1);
      expect(Math.abs(ask!.x - answer!.x)).toBeLessThan(2);
    } else {
      expect(ask!.y).toBeLessThan(thing!.y);
      expect(thing!.y).toBeLessThan(answer!.y);
    }
    // nothing on the page scrolls sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
