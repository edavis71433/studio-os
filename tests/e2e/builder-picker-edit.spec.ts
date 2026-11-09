import { test, expect, Page } from '@playwright/test';
import { deflateSync } from 'zlib';
import { installApp } from './helpers/app';

// Found Nov 9 while building item 39: the website builder's "Choose a photograph"
// picker gets the same photo editor as Files. Edit on a photo opens it; saving makes a
// NEW file beside the original, and that copy is what the slot gets. Cancel leaves the
// picker open. Also: the picker's own stock search says why a search failed, instead of
// "No matches". The editor's own controls are tested in image-editor.spec.ts; these
// pin the picker's side. The pictures are made up here.

// ── a small PNG writer, so the fixture is a real picture ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(fn(x, y), y * (w * 4 + 1) + 1 + x * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO_PNG = png(800, 600, (x) => (x < 400 ? [220, 40, 40, 255] : [40, 60, 220, 255]));

const NOW = new Date().toISOString();
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NEW_ID = id(90);
// GET /media's rows (routes/room.ts handleMediaList): what the picker draws
const row = (n: number, alt: string, mime: string) => ({
  id: id(n), alt_text: alt, mime, width: 800, height: 600, bytes: 120000, created_at: NOW, used_by: [],
  thumb: mime.startsWith('image/') ? `/__e2e_photo__/thumb-${id(n)}.png` : null,
});
const ROWS = [row(1, 'The shop front at dusk', 'image/png'), row(2, 'Our round logo', 'image/jpeg'), row(3, 'Price list', 'application/pdf')];
const PHOTO = {
  id: id(1), name: 'Storefront', kind: 'image', mime: 'image/png', alt_text: 'The shop front at dusk', collection: 'Outside', tags: ['shop', 'evening'],
  metadata: { title: 'Storefront', caption: 'Open late on Fridays' }, width: 800, height: 600, created_at: NOW,
};
const detail = { data: {
  asset: PHOTO, usage: [], usage_complete: true, versions: { has_history: false },
  thumb_fallback: `/__e2e_photo__/${PHOTO.id}.png`, download_url: `/__e2e_photo__/${PHOTO.id}.png?download=1`, cutout_available: false,
} };
const REFUSED = 'The stock library’s key for Pexels isn’t being accepted, so no photos came back. Your studio can renew it.';

interface Seen { uploads: Array<Record<string, unknown>>; patches: Array<Record<string, unknown>>; puts: number }
async function setup(page: Page, opts: { uploadFails?: boolean; stock?: 'refused' | 'empty' } = {}): Promise<Seen> {
  const seen: Seen = { uploads: [], patches: [], puts: 0 };
  await installApp(page, { api: { '/media': { data: ROWS }, ['/assets/' + PHOTO.id]: detail } });
  await page.route(/\/__e2e_photo__\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PHOTO_PNG }));
  await page.route(/\/__e2e_put__/, (route) => { seen.puts++; return route.fulfill({ status: 200, body: '' }); });
  await page.route('**/functions/v1/presence/**', (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), m = route.request().method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/media/upload-url') {
      seen.uploads.push(route.request().postDataJSON());
      return opts.uploadFails
        ? json(422, { error: 'quota_exceeded', message: 'This site has reached its media limit of 100 files. Remove a few you no longer need, then try again.' })
        : json(200, { data: { media_id: NEW_ID, upload_url: '/__e2e_put__', storage_path: 'presence-media/x.png' } });
    }
    if (p === '/assets/' + NEW_ID && m === 'PATCH') { seen.patches.push(route.request().postDataJSON()); return json(200, { data: { ok: true } }); }
    if (p.startsWith('/stock/search') && opts.stock === 'refused') return json(502, { error: 'stock_failed', message: REFUSED });
    if (p.startsWith('/stock/search') && opts.stock === 'empty') return json(200, { data: { images: [], provider: 'Pexels', license: { name: 'Pexels License' } } });
    return route.fallback();
  });
  await page.goto('/presence.html');
  await page.waitForFunction('typeof openPicker === "function" && Array.isArray(S.media) && S.media.length === 3');
  await page.evaluate('openPicker((id) => { window.__picked = id; })');
  await expect(page.locator('#pickerScrim')).toHaveClass(/\bon\b/);
  return seen;
}
const picked = (page: Page) => page.evaluate(() => (window as unknown as { __picked?: string | null }).__picked);
async function openEditor(page: Page) {
  await page.locator('#pickerGrid').getByRole('button', { name: 'Edit The shop front at dusk' }).click();
  const dlg = page.locator('dialog.dds-ie');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#ie-msg')).toBeHidden();   // the photo is open
  return dlg;
}

test.describe('the builder’s photo picker — Edit', () => {
  test('photos get Edit beside their own button; a PDF doesn’t', async ({ page }) => {
    await setup(page);
    const grid = page.locator('#pickerGrid');
    await expect(grid.locator('.medit')).toHaveCount(2);
    await expect(grid.getByRole('button', { name: 'Edit The shop front at dusk' })).toBeVisible();
    await expect(grid.getByRole('button', { name: 'Edit Our round logo' })).toBeVisible();
    await expect(grid.locator('.mwrap .mcell')).toHaveCount(2);         // each photo still picks with one tap…
    await expect(grid.locator(':scope > .mcell')).toHaveCount(1);       // …and the PDF is a plain tile, with nothing to crop
    await expect(grid.locator('.mcell .medit')).toHaveCount(0);         // Edit is never inside the photo's own button
  });

  test('save: a NEW copy beside the original, and the copy is what the slot gets', async ({ page }) => {
    const seen = await setup(page);
    const dlg = await openEditor(page);
    await expect(dlg.locator('#ie-note')).toHaveText('Saving makes a new file and puts it here. The original stays exactly as it is.');
    await dlg.locator('[data-shape="square"]').click();
    await dlg.getByRole('button', { name: 'Save a copy and use it' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('#pickerScrim')).not.toHaveClass(/\bon\b/);
    expect(await picked(page)).toBe(NEW_ID);
    await expect(page.locator('.dds-toast', { hasText: 'Saved as a new file. The original is unchanged.' })).toBeVisible();

    expect(seen.uploads).toHaveLength(1);
    expect(seen.uploads[0]).toMatchObject({ mime: 'image/png', width: 600, height: 600, alt_text: 'The shop front at dusk' });
    expect(String(seen.uploads[0].content_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(seen.puts).toBe(1);
    expect(seen.patches).toHaveLength(1);
    const patch = seen.patches[0] as { name: string; collection: string; tags: string[]; caption: string; metadata: Record<string, any> };
    expect(patch.name).toBe('Storefront (edited)');
    expect(patch.collection).toBe('Outside');
    expect(patch.tags).toEqual(['shop', 'evening']);
    expect(patch.caption).toBe('Open late on Fridays');
    expect(patch.metadata.edited_from).toBe(PHOTO.id);
    expect(patch.metadata.edits).toMatchObject({ shape: 'square' });
  });

  test('cancel leaves the picker open, and nothing is saved or placed', async ({ page }) => {
    const seen = await setup(page);
    const dlg = await openEditor(page);
    await dlg.locator('#ie-cancel').click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('#pickerScrim')).toHaveClass(/\bon\b/);
    await expect(page.locator('#pickerGrid .medit').first()).toHaveText('Edit');
    expect(await picked(page)).toBeUndefined();
    expect(seen.uploads).toHaveLength(0);
    // Escape closes the editor alone: the picker behind it stays open
    await openEditor(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.dds-ie')).toHaveCount(0);
    await expect(page.locator('#pickerScrim')).toHaveClass(/\bon\b/);
  });

  test('a refused upload keeps the editor open with the reason; nothing is placed', async ({ page }) => {
    const seen = await setup(page, { uploadFails: true });
    const dlg = await openEditor(page);
    await dlg.locator('[data-shape="square"]').click();
    await dlg.getByRole('button', { name: 'Save a copy and use it' }).click();
    await expect(dlg.locator('#ie-note')).toContainText('This site has reached its media limit of 100 files.');
    await expect(dlg.locator('#ie-note')).toHaveAttribute('role', 'alert');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#ie-save')).toBeEnabled();   // the edit is still there to try again
    await expect(page.locator('#pickerScrim')).toHaveClass(/\bon\b/);
    expect(seen.uploads).toHaveLength(1);
    expect(seen.puts).toBe(0);
    expect(await picked(page)).toBeUndefined();
  });
});

test.describe('the builder’s photo picker — stock search', () => {
  test('a refused search says why, never “No matches”', async ({ page }) => {
    await setup(page, { stock: 'refused' });
    await page.locator('#pickTabStock').click();
    await page.locator('#pickStockQ').fill('coffee');
    await page.locator('#pickStockGo').click();
    const grid = page.locator('#pickStockGrid');
    await expect(grid).toContainText(REFUSED);
    await expect(grid).not.toContainText('No matches');
    await expect(page.locator('#pickStockNote')).toHaveText('');
  });

  test('…and a search that finds nothing still says so', async ({ page }) => {
    await setup(page, { stock: 'empty' });
    await page.locator('#pickTabStock').click();
    await page.locator('#pickStockQ').fill('zzzz');
    await page.locator('#pickStockGo').click();
    await expect(page.locator('#pickStockGrid')).toContainText('No matches — try another word.');
  });
});
