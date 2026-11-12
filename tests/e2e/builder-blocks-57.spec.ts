import { test, expect, Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountCanvas, PAGE_HTML } from './helpers/editor';

// Builder list item 57, the editor half: blocks inside a section (Figma node 324:789). The canvas
// is a Blocks section and a Text section as the real renderer stamps them (tests/presence/
// blocks_57_test.mjs writes the fixture and fails when it goes stale). On a desktop, a tablet
// and a phone: Blocks in Add a section, picking a block and its toolbar, moving one and Undo,
// a block's own card, Add a block (and the answer to "embed"), Layers, a Text section turning
// into blocks and back, typing on the page, the phone's block bar, and Publish.
type Item = { kind: string; text?: string; body?: string; buttons?: Array<{ label: string }> };
type Block = { type: string; items?: Item[]; title?: string; body?: string };
const FIX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'blocks-57', 'canvas.json'), 'utf8')) as { blocks: Block[]; meta: unknown; sections: string };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAAFElEQVR42mPYsmoBSYhhVMPQ1AAALgk+0OxUxMMAAAAASUVORK5CYII=', 'base64');
const phone = (page: Page) => (page.viewportSize()?.width || 0) <= 760;

async function open(page: Page, extra?: (p: Page) => Promise<unknown>) {
  const m = await mountCanvas(page, { html: PAGE_HTML(FIX.sections), settings: { blocks: FIX.blocks, section_meta: FIX.meta }, beforeGoto: async (p) => {
    await p.route('**/img/**', (route: Route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    if (extra) await extra(p);
  } });
  await expect(page.locator('#blocksCard')).toBeAttached();
  await expect(m.frame.locator('section.block-stack [data-dds-item="3"]')).toHaveAttribute('data-dc-blk', '1');   // the blocks are wired
  return m;
}
const stackIn = (put: Record<string, unknown> | undefined) => ((put?.blocks as Block[]) || []).find((b) => b.type === 'stack');
const kinds = (put: Record<string, unknown> | undefined) => (stackIn(put)?.items || []).map((it) => it.kind).join(',');
// a press on a block, the way the person's device presses: a tap on a phone, a click elsewhere
const press = async (page: Page, loc: ReturnType<ReturnType<Page['frameLocator']>['locator']>) => { if (phone(page)) await loc.tap(); else await loc.click(); };

// @touch: on a pull request the tablet runs these too (e2e.yml runs only @touch and @layout there)
test.describe('Blocks inside a section, in the editor', { tag: '@touch' }, () => {
  test('Add a section offers Blocks first, and it arrives with a heading, words and a button', async ({ page }) => {
    const { puts } = await open(page);
    await page.locator('#btnTrayOpen').click();
    const first = page.locator('#designTray .stk-first .tray-item');
    await expect(first).toContainText('Blocks');
    await expect(first).toContainText('New');
    await first.click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const added = (puts[0].blocks as Block[])[2];
    expect(added.type).toBe('stack');
    expect((added.items || []).map((it) => it.kind)).toEqual(['heading', 'text', 'button']);
  });

  test('a press picks a block; it moves down a place, and Undo puts it back', async ({ page }) => {
    const { frame, puts } = await open(page);
    const image = frame.locator('section.block-stack [data-dds-item="2"]');
    await press(page, image);
    await expect(image).toHaveClass(/dc-blk-on/);
    if (phone(page)) {
      // a phone: the block's tools take the dock's place, a word under each
      await expect(page.locator('#dcBlkBar')).toBeVisible();
      await expect(page.locator('#dcDock')).toBeHidden();
      await page.locator('#dcBlkBar').getByRole('button', { name: 'Move this block down' }).click();
    } else {
      const tb = frame.locator('#dds-dc-blk');
      await expect(tb).toBeVisible();
      await expect(tb.locator('.dc-blk-name')).toHaveText('Image');
      const t = await tb.boundingBox(), b = await image.boundingBox();
      expect(t!.y + t!.height <= b!.y || t!.y >= b!.y + b!.height).toBe(true);   // above the block, or under it: never over it
      await tb.getByRole('button', { name: 'Move this block down' }).click();
    }
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(kinds(puts[0])).toBe('heading,text,button,image');
    await page.locator('#btnUndo').click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    expect(kinds(puts[1])).toBe('heading,text,image,button');
  });

  test('a block’s own card: its words save, Layout and When stay with the section, and the way back lists every block', async ({ page }) => {
    const { frame, puts } = await open(page);
    await press(page, frame.locator('section.block-stack [data-dds-item="1"]'));
    const tools = phone(page) ? page.locator('#dcBlkBar') : frame.locator('#dds-dc-blk');
    await tools.getByRole('button', { name: 'Edit this block' }).click();
    const card = page.locator('#settingsPanel');
    await expect(card).toHaveClass(/\bon\b/);
    await expect(page.locator('#settingsTitle')).toHaveText('Text');
    await expect(page.locator('#settingsSub')).toHaveText('Block in Our story · on Home');
    await expect(page.locator('#inspectorSeg [data-itab="layout"]')).toBeHidden();
    await expect(page.locator('#inspectorSeg [data-itab="when"]')).toBeHidden();
    const words = card.getByLabel('Words', { exact: true });
    await expect(words).toHaveValue('Started as a **Saturday stall** at the farmers market.');
    await words.fill('Started at the farmers market, **ten years ago**.');
    await words.blur();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBeGreaterThan(0);
    expect(stackIn(puts[puts.length - 1])!.items![1].body).toBe('Started at the farmers market, **ten years ago**.');
    await card.locator('.stk-back').first().click();
    await expect(page.locator('#settingsTitle')).toHaveText('Our story');
    await expect(card.locator('.stk-li')).toHaveCount(4);
    await expect(card.locator('.stk-li').nth(2)).toContainText('Loaves cooling');
  });

  test('Add block on the section: “embed” says why not, and a spacer joins the end', async ({ page }) => {
    const { frame, puts } = await open(page);
    const sec = frame.locator('section.block-stack');
    if (phone(page)) await sec.tap({ position: { x: 6, y: 6 } }); else await sec.hover({ position: { x: 6, y: 6 } });
    const add = frame.locator('#dds-dc-bar').getByRole('button', { name: 'Add a block to this section' });
    await expect(add).toBeVisible();
    await expect(add).toContainText('Add block');
    await add.click();
    await expect(page.locator('#trayPanel')).toHaveClass(/\bon\b/);
    await expect(page.locator('#trayTitle')).toHaveText('Add a block');
    await expect(page.locator('#traySub')).toHaveText('Goes under Button, in Our story');
    const search = page.locator('#designBlockAdd .tray-search');
    await search.fill('embed');
    await expect(page.locator('#designBlockAdd .stk-away')).toContainText('Code from other websites can’t go on your page');
    await expect(page.locator('#designBlockAdd .stk-kind')).toHaveText([/Video/, /Map/]);
    await search.fill('');
    await expect(page.locator('#designBlockAdd .stk-kind')).toHaveCount(9);
    await page.locator('#designBlockAdd .stk-kind[data-kind="spacer"]').click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(kinds(puts[0])).toBe('heading,text,image,button,spacer');
    await expect(page.locator('#trayPanel')).not.toHaveClass(/\bon\b/);
  });

  test('Layers lists each block under its section; a row picks it on the page and moves it', async ({ page }) => {
    const { frame, puts } = await open(page);
    if (phone(page)) await page.locator('#dkMore').click();
    await page.locator('#dkLayers').click();
    await expect(page.locator('#trayTitle')).toHaveText('Layers');
    const rows = page.locator('#designTreeList .stk-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.locator('.dc-tree-name')).toHaveText(['Heading', 'Text', 'Image', 'Button']);
    await expect(rows.nth(2).locator('.dc-tree-meta')).toHaveText('Loaves cooling');
    await rows.nth(2).locator('.dc-tree-main').click();
    await expect(frame.locator('section.block-stack [data-dds-item="2"]')).toHaveClass(/dc-blk-on/);
    await expect(rows.nth(2)).toHaveClass(/\bsel\b/);
    await rows.nth(2).getByRole('button', { name: 'Move this block up' }).click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(kinds(puts[0])).toBe('heading,image,text,button');
  });

  test('a Text section turns into blocks with Add block, words as they were; Undo turns it back', async ({ page }) => {
    const { frame, puts } = await open(page);
    const sec = frame.locator('section.block-richtext');
    await sec.scrollIntoViewIfNeeded();
    if (phone(page)) await sec.tap({ position: { x: 6, y: 6 } }); else await sec.hover({ position: { x: 6, y: 6 } });
    await frame.locator('#dds-dc-bar').getByRole('button', { name: /^Add a block: this section becomes a Blocks section/ }).click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const turned = (puts[0].blocks as Block[])[1];
    expect(turned.type).toBe('stack');
    expect(turned.items).toEqual([{ kind: 'heading', text: 'Visit us' }, { kind: 'text', body: 'Open every day from seven.' }]);
    await expect(page.getByText('“Visit us” is made of blocks now')).toBeVisible();
    await expect(page.locator('#trayTitle')).toHaveText('Add a block');   // and Add a block is open on it
    await page.locator('#btnTrayClose').click();
    await page.locator('#btnUndo').click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    expect((puts[1].blocks as Block[])[1]).toEqual({ type: 'richtext', title: 'Visit us', body: 'Open every day from seven.' });
  });

  test('typing on the page writes into the block, at its place in the section', async ({ page }) => {
    const { frame, puts } = await open(page);
    const h = frame.locator('section.block-stack [data-dds-item="0"]');
    await h.focus();
    await page.keyboard.press('Enter');
    await expect(h).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Our bakery');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(stackIn(puts[0])!.items![0]).toEqual({ kind: 'heading', text: 'Our bakery' });
  });

  test('copying and deleting a block: each one step, and a delete says so with Undo', async ({ page }) => {
    const { frame, puts } = await open(page);
    const btn = frame.locator('section.block-stack [data-dds-item="3"]');
    await press(page, btn);
    const tools = phone(page) ? page.locator('#dcBlkBar') : frame.locator('#dds-dc-blk');
    await tools.getByRole('button', { name: 'Copy this block' }).click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(kinds(puts[0])).toBe('heading,text,image,button,button');
    await press(page, frame.locator('section.block-stack [data-dds-item="2"]'));
    await tools.getByRole('button', { name: 'Delete this block' }).click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    expect(kinds(puts[1])).toBe('heading,text,button,button');
    await expect(page.getByText('Image deleted')).toBeVisible();
  });

  test('Publish with a Blocks section lists what changed and publishes it', async ({ page }) => {
    const published: string[] = [];
    await open(page);   // opens with nothing to publish; the review below reads the change the server would list
    await page.route('**/functions/v1/presence/changes**', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { count: 1, first_publish: false, changes: [{ section: 'site', sentence: '“Our story” on your home page: a button added.' }], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } }) }));
    await page.route('**/functions/v1/presence/publish', (route: Route) => { published.push(route.request().method()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'live' } }) }); });
    await page.locator('#dcBtnPublish').click();
    await expect(page.locator('#ritualWrap')).toHaveClass(/\bon\b/);
    await expect(page.locator('#ritualWrap .jrow')).toContainText('“Our story” on your home page: a button added.');
    await page.locator('#ritualWrap .pubbtn').click();
    await expect.poll(() => published, { timeout: 6000 }).toEqual(['POST']);
  });
});
