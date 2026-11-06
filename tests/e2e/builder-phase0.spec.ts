import { readFileSync } from 'node:fs';
import { test, expect, Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Website builder, Phase 0 (Nov 2026): what a client hit in production.
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Test Studio', description: 'Hello' }, location: null } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/moments': { data: [] }, '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [] } },
  '/portal/context': { data: {
    site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
    is_agency: false, is_operator: false, sees_full_workspace: true,
    capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
    landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
  } },
};
const FIRST_RUN_HEALTH = { '/health': { data: { state: 'needs_attention', sentence: 'x', detail: '', first_run: true, facts: {
  website: { state: 'none', label: 'Not live yet', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' },
  last_publish: { label: '—', detail: '' }, domain: { label: 'No custom domain yet', state: 'none', detail: '' },
} } } };

test.describe('the image rule', () => {
  // The hermetic server never sends _headers, so this drives the real production
  // policy through a real browser: it is the check that would have caught this.
  const csp = (readFileSync('_headers', 'utf8').match(/Content-Security-Policy:\s*(.+)/) || [])[1];
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAwAEAAH/qvY1kgAAAABJRU5ErkJggg==', 'base64');
  const IMG = 'https://qksstlqzbhesadrrofgn.supabase.co/storage/v1/render/image/sign/presence-media/a.jpg?token=x';

  test('the production CSP lets a library photo load, on the page and inside a srcdoc proof', async ({ page }) => {
    await page.route(IMG, (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
    await page.route('**/csp-probe.html', (r) => r.fulfill({
      contentType: 'text/html', headers: { 'Content-Security-Policy': csp },
      body: `<!doctype html><img id="a" src="${IMG}"><iframe id="f" srcdoc='<img id="b" src="${IMG}">'></iframe>`,
    }));
    await page.goto('/csp-probe.html');
    await expect.poll(() => page.locator('#a').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
    await expect.poll(() => page.frameLocator('#f').locator('#b').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
    const blobOk = await page.evaluate(async () => {
      const blob = await new Promise<Blob>((res) => { const c = document.createElement('canvas'); c.width = c.height = 1; c.toBlob((b) => res(b as Blob)); });
      return new Promise((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = URL.createObjectURL(blob); });
    });
    expect(blobOk).toBe(true);
  });
});

test.describe('a client view shows the client', () => {
  const NOTICE = { '/commerce/notices': { data: { notices: [{ id: 'n1', kind: 'deal_signed', headline: 'Agreement signed — ready to convert Someone Else', body: 'The client signed.', dismissible: true }] } } };
  const FIRST = { '/commerce/first-run': { data: { dismissed: false, complete: false, done: 0, total: 1, steps: [{ key: 'details', title: 'Add your business details', done: false }] } } };

  test('the studio’s own notices and checklist stay out of ?client=', async ({ page }) => {
    await installApp(page, { api: { ...API, ...FIRST_RUN_HEALTH, ...NOTICE, ...FIRST } });
    await page.goto('/presence.html?client=c1');
    await expect(page.locator('#view-today')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByText('ready to convert Someone Else')).toHaveCount(0);
    await expect(page.locator('#setupCard')).toBeHidden();
  });

  test('a sales alert stays off the website page: it belongs to the bell, Home and Pipeline', async ({ page }) => {
    await installApp(page, { api: { ...API, ...FIRST_RUN_HEALTH, ...NOTICE, ...FIRST } });
    await page.goto('/presence.html');
    await expect(page.locator('#siteStage')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByText('ready to convert Someone Else')).toHaveCount(0);
  });

  test('any alert that isn’t about this site or account stays off it too, however new the kind', async ({ page }) => {
    const notices = (kind: string, headline: string) => ({ '/commerce/notices': { data: { notices: [{ id: 'n2', kind, headline, body: 'b' }] } } });
    await installApp(page, { api: { ...API, ...notices('deposit_landed', 'Deposit from a client') } });
    await page.goto('/presence.html');
    await expect(page.locator('#siteStage')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByText('Deposit from a client')).toHaveCount(0);
    // one about the site still shows, with its way to fix it
    await installApp(page, { api: { ...API, ...notices('publish_failed', 'Your last publish didn’t go through') } });
    await page.goto('/presence.html?v=2');
    await expect(page.getByText('Your last publish didn’t go through')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your website' })).toBeVisible();
  });
});

test('History counts changes the way the Publish button does', async ({ page }) => {
  await installApp(page, { api: { ...API,
    '/changes': { data: { count: 1, first_publish: true, changes: [{ section: 'site', sentence: 'Your website goes live for the first time.' }], blockers: 0, warnings: 0, draft_hash: 'h' } },
    '/preview/status': { data: { draft: { unpublished_changes: 14 }, preview: { exists: false }, live: { published: false } } },
  } });
  await page.goto('/presence.html#history');
  await page.locator('#versionMore summary').click();
  await expect(page.getByText('1 unpublished change', { exact: true })).toBeVisible();
  await expect(page.getByText('14 unpublished changes')).toHaveCount(0);
});

test.describe('a watch plan', () => {
  const WATCH = { ...API, ...FIRST_RUN_HEALTH,
    '/site': { data: { site: { id: 's2', edition: 'monitor', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: {}, location: null } },
    '/changes': { data: { count: 2, first_publish: true, changes: [{ section: 'site', sentence: 'x' }], blockers: 3, warnings: 0, draft_hash: 'h' } },
  };
  const refuse = (page: Page) => page.route('**/functions/v1/presence/preview**', (r) => r.fulfill({
    status: 403, contentType: 'application/json',
    body: JSON.stringify({ error: 'feature_not_in_plan', feature: 'website', upgrade: true, message: 'Editing and publishing your website is part of the CMS.' }),
  }));

  test('Design says the plan doesn’t include it, with no building tools and no dead buttons', async ({ page }) => {
    await installApp(page, { api: WATCH }); await refuse(page);
    await page.goto('/presence.html#design');
    await expect(page.locator('#dpEmptyTitle')).toHaveText('Editing isn’t part of this plan.');
    await expect(page.getByText('The proof couldn’t draw just now.')).toHaveCount(0);
    for (const sel of ['#pagesBar', '.dc-bar', '#btnAddFab', '#designPreviewEmpty .ea']) await expect(page.locator(sel)).toBeHidden();
    await page.waitForTimeout(600);   // past the tip's delay: "pick a look" means nothing here
    await expect(page.locator('.dds-hint.dds-live')).toHaveCount(0);
  });

  test('the overview drops the publish steps it can’t do', async ({ page }) => {
    await installApp(page, { api: WATCH }); await refuse(page);
    await page.goto('/presence.html');
    await expect(page.locator('#monitorNote')).toBeVisible();
    await expect(page.locator('.envelope, .welcomebar')).toHaveCount(0);
    await expect(page.locator('#statWaiting')).toBeHidden();
    await expect(page.locator('#recentWrap')).toBeHidden();
  });

  test('a drafting plan keeps every tool', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/presence.html#design');
    await expect(page.locator('.dc-bar')).toBeVisible();
  });
});

test.describe('the publish page names what is holding it up', () => {
  const blocked = (extra = {}) => ({ '/changes': { data: { count: 1, first_publish: true, changes: [{ section: 'site', sentence: 'Your website goes live for the first time.' }], blockers: 2, warnings: 0, draft_hash: 'h', ...extra } } });

  test('each thing, with a Fix that lands in the field', async ({ page }) => {
    await installApp(page, { api: { ...API, ...blocked({ blocker_list: [
      { field: 'identity.phone', message: 'Add a phone number or an email so customers can reach you.' },
      { field: 'location', message: 'Your address and hours are required before publishing.' },
      { field: 'identity.phone', message: 'Add a phone number or an email so customers can reach you.' },
    ] }) } });
    await page.goto('/presence.html#publish');
    const rows = page.locator('#ritBlockers .blocklist li');
    await expect(rows).toHaveCount(2);   // the same sentence twice is one thing to do
    await expect(page.locator('#ritBlockers')).toContainText('2 things to finish');
    await rows.first().getByRole('button', { name: /^Fix/ }).click();
    await expect(page.locator('#ritualWrap')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#view-business')).toBeVisible();
    await expect(page.locator('#f-phone')).toBeFocused();
  });

  test('a function not yet redeployed keeps the old sentence', async ({ page }) => {
    await installApp(page, { api: { ...API, ...blocked() } });
    await page.goto('/presence.html#publish');
    await expect(page.locator('#ritBlockers')).toContainText('Publishing waits until 2 small things are complete');
    await expect(page.locator('#ritBlockers .blocklist')).toHaveCount(0);
  });
});

test.describe('one tip at a time', () => {
  test('leaving a view retires its tip, and a visit gets one', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/presence.html#search');
    const tip = page.locator('.dds-hint.dds-live');
    await expect(tip).toContainText('Search settings');
    await page.evaluate(() => (window as any).go('media'));
    await expect(tip).toHaveCount(0);
    await page.waitForTimeout(700);        // past the tip's own delay
    await expect(tip).toHaveCount(0);      // Files has a tip too, but not on this visit
    await expect(page.locator('#view-media')).toBeVisible();
  });
});

test.describe('the preview stage', () => {
  const LOOKS = { '/site/templates': { data: { current: { slug: 'business-classic' }, templates: [
    { slug: 'business-classic', name: 'Business Classic', version: 1 }, { slug: 'editorial', name: 'Editorial', version: 1 },
  ] } } };
  test('the template gallery is folded until asked for, and the preview gets the room', async ({ page }) => {
    await installApp(page, { api: { ...API, ...LOOKS } });
    await page.goto('/presence.html');
    // the header's button on a desktop, the dock's on a phone
    await page.locator('button:visible', { hasText: /^Preview$/ }).first().click();
    const width = page.viewportSize()!.width;
    const bar = await page.locator('.stagebar').boundingBox();
    // one row on a desktop, two on a tablet: it was over 300px with the gallery in it
    expect(bar!.height).toBeLessThan(width > 1180 ? 90 : 130);
    if (width <= 760) {                     // a phone changes its template in Styles
      await expect(page.locator('#lookSeg')).toBeHidden();
      return;
    }
    const toggle = page.getByRole('button', { name: /Try another template/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#lookDrawer [data-look]').first()).toBeHidden();
    await toggle.click();
    await expect(page.locator('#lookDrawer [data-look="editorial"]')).toBeVisible();
    await page.locator('#lookDrawer [data-look="editorial"]').click();
    await expect(page.getByRole('button', { name: 'Use this template' })).toBeVisible();
  });
});

test.describe('the builder’s icons', () => {
  test('the section tray and the page tree draw SVG, not emoji', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/presence.html#design');
    await page.locator('#btnTrayOpen').click();
    await expect(page.locator('.tray-item .ti-ico svg').first()).toBeVisible();
    const text = await page.locator('#designTray').innerText();
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    await expect(page.locator('#btnComments')).toHaveText('Comments');
  });
});

test.describe('forms on your own pages', () => {
  const FORM = { type: 'form', id: 'contact', title: 'Contact us', kind: 'contact', fields: [{ key: 'name', label: 'Your name', type: 'text' }], rules: [] };
  const SETTINGS = { blocks: [{ type: 'richtext', body: 'home', id: 'r1' }, FORM], pages: [{ slug: 'visit', title: 'Visit', blocks: [{ type: 'richtext', body: 'visit' }] }] };

  test('the Forms card follows the page: a new form lands on that page, with an id no other page uses', async ({ page }) => {
    await installApp(page, { api: { ...API, '/settings': { data: SETTINGS } } });
    const puts: any[] = [];
    await page.route('**/functions/v1/presence/settings', async (r) => {
      if (r.request().method() === 'PUT') { const body = r.request().postDataJSON(); puts.push(body); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...SETTINGS, ...body } }) }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: SETTINGS }) });
    });
    await page.goto('/presence.html#design');
    await expect(page.locator('#formsCard label').first()).toHaveText('Forms on your home page');
    await page.locator('#pagesBar .page-pill', { hasText: 'Visit' }).click();
    await expect(page.locator('#formsCard label').first()).toHaveText('Forms on “Visit”');
    await page.evaluate(() => (window as any).openSettingsPanel('forms'));
    await page.locator('#formsCard').getByRole('button', { name: 'Contact form' }).click();
    await expect.poll(() => puts.length).toBe(1);   // forms save themselves
    expect(puts[0].blocks).toBeUndefined();                 // the home page wasn't rewritten
    const visit = puts[0].pages.find((p: any) => p.slug === 'visit');
    const added = visit.blocks.filter((b: any) => b.type === 'form');
    expect(added).toHaveLength(1);
    expect(added[0].id).not.toBe('contact');                // home already has "contact"
    expect(visit.blocks[0].type).toBe('richtext');
  });

  test('saving on the home page leaves a form where the owner put it', async ({ page }) => {
    const settings = { blocks: [FORM, { type: 'richtext', body: 'after', id: 'r1' }], pages: [] };
    await installApp(page, { api: { ...API, '/settings': { data: settings } } });
    const puts: any[] = [];
    await page.route('**/functions/v1/presence/settings', async (r) => {
      if (r.request().method() === 'PUT') { const body = r.request().postDataJSON(); puts.push(body); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...settings, ...body } }) }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) });
    });
    await page.goto('/presence.html#design');
    await page.evaluate(() => (window as any).openSettingsPanel('forms'));
    await page.locator('#formsCard input[placeholder="Form title"]').first().fill('Say hello');
    await page.locator('#formsCard input[placeholder="Form title"]').first().blur();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].blocks.map((b: any) => b.type)).toEqual(['form', 'richtext']);
  });
});

test('the page and the shell share one auth client', async ({ page }) => {
  await installApp(page, { api: API });
  await page.addInitScript(() => {
    (window as any).__clients = 0;
    let real: any;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return real; },
      set(v) { const make = v.createClient; v.createClient = function (...a: unknown[]) { (window as any).__clients++; return make.apply(this, a); }; real = v; },
    });
  });
  await page.goto('/presence.html');
  await expect(page.locator('#view-today')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__clients)).toBe(1);
});
