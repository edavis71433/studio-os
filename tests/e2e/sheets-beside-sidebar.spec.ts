import { test, expect, Page, Locator } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// From 761px wide the app's sidebar floats at the left (shell.css html.dds-side), drawn above every
// layer of presence.html (z 2147483000). The sheets, the publish ritual, page settings, the action
// toasts and the preview used the whole screen, so on a tablet the sidebar hid their left edge: the
// Domain & email sheet read "ure it renews by itself", and a press on "Show all (8)" landed on the
// sidebar. They now start beside it (presence.html --page-left), as the shell's own toasts do.
// Phones keep their bottom sheets, and Edit mode hides the shell, so its sheets keep the whole screen.
const PRESENCE_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
  // GET /changes returns an OBJECT (routes/room.ts handleChanges); one change so the ritual has words
  '/changes': { data: { count: 1, first_publish: false, changes: [{ section: 'business', sentence: 'The phone number changed.' }], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/moments': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, updated_at: null, updated_by: null } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
    is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
    landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
// the Domain & email sheet's routes, in the shapes domain-sheet.spec.ts uses
const RECORDS = Array.from({ length: 8 }, (_, i) => ({ type: i < 2 ? 'A' : 'TXT', name: 'bistro.example', value: 'v' + i, plain: `Record number ${i + 1}` }));
const API = { ...PRESENCE_API,
  '/foundations': { data: {
    domain: { name: 'bistro.example', sentence: 'Your address is bistro.example.' },
    dns: { record_count: RECORDS.length, records: RECORDS, sentence: '8 records answer for bistro.example right now.' },
    ssl: { state: 'pending', sentence: 'The security certificate is being arranged.' },
    email: { has_mail: false, spf: false, dmarc: false, sentence: 'No email runs on this domain — nothing to protect.' },
    hosting: { managed: true, sentence: 'Hosted here.' },
  } },
  '/foundations/plans': { data: [] }, '/launch': { data: { launched: false, sentence: 'Getting there.', items: [] } },
  '/foundations/domain': { data: { custom_domain: 'bistro.example', health: 'dns_pending', message: '', netlify_subdomain: 'bistro.netlify.app',
    dns: { ok: false, expected_apex_ip: ['75.2.60.5'], expected_cname: 'bistro.netlify.app' }, ssl: { state: 'pending' },
    provider: { registrar: 'Registrar B', dns_host: 'Cloudflare', records_at: { company: 'Cloudflare', sign_in: 'https://dash.cloudflare.com/', path: 'your domain, then DNS, then Records' }, renew_at: { company: 'Registrar B', sign_in: '', path: '' } } } },
};

const wide = (page: Page) => page.viewportSize()!.width >= 761;   // the shell is the sidebar (shell.css html.dds-side)
// where the sidebar's card ends; a phone's shell is the top and bottom bars, so 0
const sideEdge = (page: Page) => page.evaluate(() => {
  const s = document.getElementById('dds-shell');
  return s && innerWidth >= 761 && getComputedStyle(s).display !== 'none' ? s.getBoundingClientRect().right : 0;
});
// the topmost thing just inside the box's left edge is the box: nothing lies over that edge
const leftEdgeOnTop = (box: Locator) => box.evaluate((n) => {
  const r = n.getBoundingClientRect();
  const t = document.elementFromPoint(r.left + 2, Math.min(r.top + r.height / 2, innerHeight - 4));
  return !!t && (t === n || n.contains(t));
});
async function besideSidebar(page: Page, box: Locator) {
  await expect(box).toBeVisible();
  await box.scrollIntoViewIfNeeded();   // a long sheet scrolls inside itself
  const b = (await box.boundingBox())!;
  const vw = page.viewportSize()!.width;
  if (wide(page)) expect(b.x).toBeGreaterThanOrEqual(await sideEdge(page));
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vw + 0.5);
  expect(await leftEdgeOnTop(box)).toBe(true);
}

test.describe('sheets and covers on the website workspace start beside the sidebar', () => {
  test('Domain & email: the whole sheet clears the sidebar, and a press at a button’s left edge lands', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/presence.html#domain');
    const sheet = page.locator('#deskScrim .sheetcard');
    const card = page.locator('#deskResults .deskopt').filter({ hasText: '8 records answer for bistro.example right now.' });
    await expect(card).toContainText('Record number 6');
    await besideSidebar(page, sheet);
    await besideSidebar(page, page.locator('[data-help="more"]').getByRole('button', { name: 'Make sure it renews by itself' }));
    if (!wide(page)) {   // a phone keeps its bottom sheet, edge to edge
      const b = (await sheet.boundingBox())!;
      expect([Math.round(b.x), Math.round(b.width)]).toEqual([0, page.viewportSize()!.width]);
    }
    const all = card.getByRole('button', { name: 'Show all (8)' });
    await all.scrollIntoViewIfNeeded();
    const b = (await all.boundingBox())!;
    await all.click({ position: { x: 2, y: b.height / 2 }, timeout: 5_000 });   // the press the sidebar used to take
    await expect(card).toContainText('Record number 8');
  });

  test('the dimmed backdrop and Escape still close a sheet', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/presence.html#domain');
    const scrim = page.locator('#deskScrim');
    await expect(scrim).toHaveClass(/\bon\b/);
    const s = (await page.locator('#deskScrim .sheetcard').boundingBox())!;
    await page.mouse.click(page.viewportSize()!.width - 3, s.y - 6);   // above and right of the card: the backdrop
    await expect(scrim).not.toHaveClass(/\bon\b/);
    await page.evaluate(() => (window as any).openFoundationsDesk({ domain: true }));
    await expect(scrim).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await expect(scrim).not.toHaveClass(/\bon\b/);
  });

  // `ready` is the view the address shows; the cover opens once the page has drawn it
  const COVERS: { name: string; url: string; ready?: string; open?: (p: Page) => Promise<unknown>; box: string }[] = [
    { name: 'the restore sheet', url: '/presence.html#history', ready: '#view-history.on', open: (p) => p.evaluate(() => (window as any).openSheet('restoreScrim')), box: '#restoreScrim .sheetcard' },
    { name: 'the photo picker', url: '/presence.html#media', ready: '#view-media.on', open: (p) => p.evaluate(() => (window as any).openSheet('pickerScrim')), box: '#pickerScrim .sheetcard' },
    { name: 'the sections sheet', url: '/presence.html#business', ready: '#view-business.on', open: (p) => p.evaluate(() => (window as any).openSheet('sectionsScrim')), box: '#sectionsScrim .sheetcard' },
    { name: 'the publish ritual', url: '/presence.html#publish', box: '#ritualWrap h1' },
    { name: 'page settings', url: '/presence.html#pages', ready: '#view-pages.on', open: (p) => p.evaluate(() => (window as any).pgOpenSettings({ href: '/' })), box: '#pageSettings .dc-modal' },
    { name: 'a toast with a button', url: '/presence.html#pages', ready: '#view-pages.on', box: '#toasts .toast',
      open: (p) => p.evaluate(() => (window as any).toastAction('Deleted “Gallery”. It’s kept 30 days in Recently deleted pages, and Undo brings it straight back.', 'Undo', () => {}, 20000)) },
    { name: 'the preview', url: '/presence.html?view=preview', box: '#stage' },
  ];
  for (const c of COVERS) {
    test(`${c.name} clears the sidebar`, async ({ page }) => {
      await installApp(page, { api: API });
      await page.goto(c.url);
      if (c.ready) await expect(page.locator(c.ready)).toBeVisible();
      if (c.open) await c.open(page);
      await besideSidebar(page, page.locator(c.box).first());
    });
  }

  test('the publish ritual’s Back takes a press at its left edge', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/presence.html#publish');
    const back = page.locator('#btnRitualBack');
    await expect(back).toBeVisible();
    await back.click({ position: { x: 2, y: 8 }, timeout: 5_000 });
    await expect(page.locator('#ritualWrap')).not.toHaveClass(/\bon\b/);
  });

  test('Edit mode hides the shell: its sheets keep the whole screen, and the publish card stays put', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/presence.html#design');
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    const vw = page.viewportSize()!.width;
    await page.evaluate(() => (window as any).openSheet('pickerScrim'));
    const s = (await page.locator('#pickerScrim').boundingBox())!;
    expect([Math.round(s.x), Math.round(s.width)]).toEqual([0, vw]);
    await page.keyboard.press('Escape');
    await page.locator('#dcBtnPublish').click();
    const card = page.locator('#ritualWrap.as-card');
    await expect(card).toBeVisible();
    const c = (await card.boundingBox())!;
    if (wide(page)) expect(Math.round(c.x + c.width)).toBe(vw - 16);   // a card at the right (right:16px), as before
    else expect(Math.round(c.x)).toBe(8);                               // a phone's card floats 8px in from each side
  });
});
