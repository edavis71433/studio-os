import { test, expect, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// The phone frame inside the editor (builder list item 51, Nov 2026): the bar's device switch
// draws the page at a phone's width, and a section there has the same tools as on a computer
// (drag, edit, duplicate, style, delete, more) and its name. The name sits above a narrow
// section, clear of its heading, instead of on it.
const BLOCKS = [{ type: 'title', title: 'Your heading', subtitle: 'A quiet sub line' }, { type: 'richtext', title: 'Our story', body: 'Hello' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>section{padding:48px 24px}.block{min-height:420px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Your heading</h2></section>'
  + '<section id="b" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1" class="block"><h2 data-dds-field="title">Our story</h2></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};

test.describe('the phone frame inside the editor (builder item 51)', () => {
  test('a section at a phone’s width has the same tools and its name, clear of its heading', async ({ page }) => {
    test.skip(page.viewportSize()!.width <= 1180, 'the device switch is for a computer’s screen; a tablet or phone is already its own size');
    await installApp(page, { api: { ...API, '/settings': { data: { blocks: BLOCKS, section_meta: META } } } });
    await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
    await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
    await page.goto('/presence.html#design');
    const fr = page.frameLocator('#designPreview');
    await expect(fr.locator('#dds-dc-bar')).toBeAttached();
    // the same tools at a computer's width first
    await fr.locator('#b h2').hover();
    await expect(fr.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
    const wide = await fr.locator('#dds-dc-bar button').evaluateAll((ns) => ns.map((n) => n.getAttribute('aria-label')));
    await page.locator('#dpDevSeg [data-dpdev="phone"]').click();
    await expect.poll(() => page.locator('#designPreview').evaluate((n) => (n as HTMLIFrameElement).contentWindow!.innerWidth)).toBeLessThanOrEqual(390);
    await fr.locator('#a h2').hover();
    await fr.locator('#b h2').hover();
    await expect(fr.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
    expect(await fr.locator('#dds-dc-bar button').evaluateAll((ns) => ns.map((n) => n.getAttribute('aria-label')))).toEqual(wide);
    await expect(fr.locator('#dds-dc-chip')).toHaveClass(/\bon\b/);
    await expect(fr.locator('#dds-dc-chip')).toContainText('Our story');
    const chip = (await fr.locator('#dds-dc-chip').boundingBox())!, head = (await fr.locator('#b h2').boundingBox())!, sec = (await fr.locator('#b').boundingBox())!;
    expect(chip.y + chip.height).toBeLessThanOrEqual(sec.y + 1);   // above the section
    expect(chip.y + chip.height <= head.y || chip.y >= head.y + head.height).toBe(true);   // never on its heading
    await fr.locator('#dds-dc-bar').getByRole('button', { name: 'Edit this section' }).click();
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'section');
  });
});
