import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Locked sections (builder list item 155, Nov 2026; Figma "A · Locked sections"): the studio locks
// a section from its More menu so the client can't move, restyle, copy or delete it by accident.
// Its words can stay open to the client or not. The client sees a padlock and fewer tools, and the
// card says why; only the studio unlocks. (The server's half is tests/presence/section_lock_test.mjs.)
const LOCK = (words: boolean) => ({ id: 'lk-0123456789', words });
const BLOCKS = (lock: unknown = null) => [
  { type: 'title', title: 'Fresh bread', subtitle: 'Baked daily', ...(lock ? { lock } : {}) },
  { type: 'richtext', title: 'Our story', body: 'Hello' },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}section{padding:56px 24px;min-height:360px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2><p data-dds-field="subtitle">Baked daily</p></section>'
  + '<section id="b" class="block block-richtext" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1"><h2 data-dds-field="title">Our story</h2><p>Hello</p></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const ctx = (studio: boolean) => ({ data: { site_role: studio ? 'agency_owner' : 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: studio, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } });
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
};
type Put = { blocks?: Array<Record<string, any>> };
async function mount(page: Page, { studio, lock }: { studio: boolean; lock?: unknown }) {
  let settings: Record<string, unknown> = { blocks: BLOCKS(lock), section_meta: META };
  await installApp(page, { api: { ...API, '/portal/context': ctx(studio), '/settings': { data: settings } } });
  const puts: Put[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    if (path === '/settings') { puts.push(body); settings = { ...settings, ...body }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  let draws = 0;
  await page.route('**/functions/v1/presence/preview**', (route: Route) => { draws++; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }); });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto(studio ? '/presence.html?client=s1#design' : '/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  const frame = page.frameLocator('#designPreview');
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  // after a save the page is drawn again: wait for that, so a tap doesn't land on the page being replaced
  const redrawn = async (before: number) => {
    await expect.poll(() => draws).toBeGreaterThan(before);
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await page.waitForTimeout(300);
  };
  return { frame, puts, draws: () => draws, redrawn, lastBlocks: () => (puts.filter((p) => p && Array.isArray(p.blocks)).at(-1) || {}).blocks };
}
// a phone brings the toolbar with a tap, a mouse with a hover
async function pick(page: Page, frame: ReturnType<Page['frameLocator']>, sel: string) {
  const phone = (page.viewportSize()?.width || 1200) < 768;
  const sec = frame.locator(sel);
  if (phone) await sec.tap({ position: { x: 40, y: 20 } }); else await sec.locator('h2').hover();
  await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
}
const tools = (frame: ReturnType<Page['frameLocator']>) => frame.locator('#dds-dc-bar .dc-b .dc-sr').allTextContents();

test.describe('the studio locks a section (builder item 155)', () => {
  test('More → Lock this section saves a lock with its words open; the name wears a padlock; More then offers Unlock', async ({ page }) => {
    const { frame, lastBlocks, draws, redrawn } = await mount(page, { studio: true });
    await pick(page, frame, '#a');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).click();
    const before = draws();
    await frame.locator('#dds-dc-more .dc-mi', { hasText: 'Lock this section' }).click();
    await expect.poll(() => lastBlocks()?.[0]?.lock).toEqual({ id: expect.stringMatching(/^lk-[a-z0-9-]{6,}$/), words: true });
    expect(lastBlocks()?.[1]?.lock).toBeUndefined();
    await redrawn(before);
    await pick(page, frame, '#a');
    await expect(frame.locator('#dds-dc-chip')).toHaveClass(/\blocked\b/);
    await expect(frame.locator('#dds-dc-chip svg')).toHaveCount(1);
    expect(await tools(frame)).toEqual(['Move', 'Edit', 'Duplicate', 'Style', 'Delete', 'More']);   // the studio keeps every tool
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).click();
    await expect(frame.locator('#dds-dc-more .dc-mi', { hasText: 'Unlock' })).toBeVisible();
  });

  test('its card: the note, the words switch and Unlock', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page, { studio: true, lock: LOCK(true) });
    await pick(page, frame, '#a');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'Edit' }).first().click();
    const note = page.locator('#insLock');
    await expect(note).toContainText('Locked for your client.');
    await expect(note.getByLabel('Client can change its words')).toBeChecked();
    await note.getByLabel('Client can change its words').uncheck();
    await expect.poll(() => lastBlocks()?.[0]?.lock).toEqual({ id: 'lk-0123456789', words: false });
    await page.locator('#insLock').getByRole('button', { name: 'Unlock' }).click();
    await expect.poll(() => lastBlocks()?.[0] && 'lock' in lastBlocks()![0]).toBe(false);
    await expect(page.locator('#insLock')).toHaveCount(0);
  });

  test('a copy is never locked', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page, { studio: true, lock: LOCK(true) });
    await pick(page, frame, '#a');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'Duplicate' }).click();
    await expect.poll(() => (lastBlocks() || []).length).toBe(3);
    expect(lastBlocks()![0].lock).toEqual(LOCK(true));
    expect(lastBlocks()![1].lock).toBeUndefined();
  });
});

test.describe('the client sees a locked section (builder item 155)', () => {
  test('words open: Edit words and a padlock, nothing else; its card has only Content, and the words save', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page, { studio: false, lock: LOCK(true) });
    await pick(page, frame, '#a');
    expect(await tools(frame)).toEqual(['Edit words', 'Locked']);
    await expect(frame.locator('#dds-dc-chip')).toHaveClass(/\blocked\b/);
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'Edit words' }).click();
    await expect(page.locator('#insLock')).toHaveText(/Your studio locked this section so it stays as designed\. You can change its words; ask your studio for anything else\./);
    for (const tab of ['style', 'layout', 'when']) await expect(page.locator(`#inspectorSeg [data-itab="${tab}"]`)).toBeHidden();
    await expect(page.locator('#inspectorSeg [data-itab="content"]')).toBeVisible();
    const heading = page.locator('#blocksCard input[id^="insTitle-"]');
    await expect(heading).toBeEditable();
    await expect(page.locator('#blocksCard .ins-foot button')).toBeDisabled();   // no hiding it either
    await heading.fill('Fresh bread, every morning'); await heading.blur();   // a field saves when it's left
    await expect.poll(() => lastBlocks()?.[0]?.title).toBe('Fresh bread, every morning');
    expect(lastBlocks()![0].lock).toEqual(LOCK(true));
  });

  test('words shut: only the padlock; the card says to ask, and nothing in it can change', async ({ page }) => {
    const { frame, puts } = await mount(page, { studio: false, lock: LOCK(false) });
    await pick(page, frame, '#a');
    expect(await tools(frame)).toEqual(['Locked']);
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'Locked' }).click();
    await expect(page.locator('#insLock')).toContainText('Ask your studio if it needs to change.');
    await expect(page.locator('#blocksCard input[id^="insTitle-"]')).not.toBeEditable();
    await page.locator('#btnSettingsClose').click();
    // a double-click on its words opens the card instead of typing on the page
    await frame.locator('#a h2').dblclick();
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'section');
    await expect(frame.locator('#a h2[contenteditable="true"]')).toHaveCount(0);
    expect(puts.filter((p) => p && Array.isArray(p.blocks))).toEqual([]);
  });

  test('the Contents list keeps it where it is: its move and remove are greyed, the other section’s aren’t', async ({ page }) => {
    await mount(page, { studio: false, lock: LOCK(true) });
    const held = page.locator('#designTreeList button[aria-label="Your studio locked this section so it stays as designed."]');
    await expect(held).toHaveCount(3);   // up, down and remove
    for (const b of await held.all()) await expect(b).toBeDisabled();
    await expect(page.locator('#designTreeList button[aria-label="Remove this section"]')).toHaveCount(1);
    await expect(page.locator('#designTreeList button[aria-label="Remove this section"]')).toBeEnabled();
  });

  test('an unlocked section keeps every tool, and the studio’s Lock isn’t offered', async ({ page }) => {
    const { frame } = await mount(page, { studio: false, lock: LOCK(true) });
    await pick(page, frame, '#b');
    expect(await tools(frame)).toEqual(['Move', 'Edit', 'Duplicate', 'Style', 'Delete', 'More']);
    await expect(frame.locator('#dds-dc-chip')).not.toHaveClass(/\blocked\b/);
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).click();
    await expect(frame.locator('#dds-dc-more .dc-mi', { hasText: /Lock this section|Unlock/ })).toHaveCount(0);
  });
});
