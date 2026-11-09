import { test, expect, Page, Route } from '@playwright/test';
import { deflateSync } from 'zlib';
import { installApp, spyRequestBodies, sentBodies } from './helpers/app';

// Items 39 + 117 (Nov 2026): the photo editor on the Files page. Crop to a shape,
// rotate and flip, sliders and named filters, and "Remove background" for a
// plain backdrop. Saving makes a NEW file beside the original. Each test reads
// the picture that was actually uploaded, back in the browser, pixel by pixel.
// The pictures are made up here: a half-red, half-blue "photo" and a dark round
// "logo" on a white card.

// ── a small PNG writer, so the fixtures are real pictures with known pixels ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(fn(x, y), y * (w * 4 + 1) + 1 + x * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const RED: [number, number, number, number] = [220, 40, 40, 255], BLUE: [number, number, number, number] = [40, 60, 220, 255];
const PHOTO_PNG = png(800, 600, (x) => (x < 400 ? RED : BLUE));
const LOGO_PNG = png(400, 300, (x, y) => (Math.hypot(x - 200, y - 150) < 90 ? [30, 40, 120, 255] : [252, 251, 250, 255]));
// what the cut-out service answers for the photo: the same size, only a round subject left
const CUT_PNG = png(800, 600, (x, y) => (Math.hypot(x - 400, y - 300) < 150 ? [200, 120, 60, 255] : [0, 0, 0, 0]));

const NOW = new Date().toISOString();
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NEW_ID = id(90);
const file = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n), name: `Photo ${n}`, kind: 'image', mime: 'image/png', in_use: false, favorite: false, alt_text: `A clear description ${n}`,
  tags: [], collection: '', metadata: { title: `Photo ${n}` }, asset_status: 'approved', state: 'approved', bytes: 120000, width: 800, height: 600, created_at: NOW, ...extra,
});
const PHOTO = file(1, { name: 'Storefront', metadata: { title: 'Storefront', caption: 'Open late on Fridays' }, alt_text: 'The shop front at dusk', collection: 'Outside', tags: ['shop', 'evening'] });
const LOGO = file(2, { name: 'Logo', metadata: { title: 'Logo' }, alt_text: 'Our round logo', mime: 'image/jpeg', width: 400, height: 300, brand: true });
const DOC = file(3, { name: 'Price list', kind: 'document', mime: 'application/pdf', metadata: { title: 'Price list' }, width: null, height: null });
const COPY = file(90, { name: 'Storefront (edited)', metadata: { title: 'Storefront (edited)', edited_from: PHOTO.id, edited_from_name: 'Storefront' }, collection: 'Outside', width: 600, height: 600 });
const detail = (asset: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ data: {
  asset, usage: [], usage_complete: true, versions: { has_history: false }, summary: { headline: 'Not on your site yet.' },
  thumb_fallback: `/__e2e_photo__/${asset.id}.png`, download_url: `/__e2e_photo__/${asset.id}.png?download=1`, ...extra,
} });
const STORAGE = { used_bytes: 125 * 1048576, files: 42, max_bytes: 1073741824, max_files: 100, level: 'ok' };
const api = (extra: Record<string, unknown> = {}) => ({
  '/assets/collections': { data: [{ name: 'Outside', count: 1 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [PHOTO, LOGO, DOC], total: 3, shown: 3, live_count: 0, policy: 'immediate', storage: STORAGE } },
  ['/assets/' + PHOTO.id]: detail(PHOTO), ['/assets/' + LOGO.id]: detail(LOGO), ['/assets/' + DOC.id]: detail(DOC), ['/assets/' + NEW_ID]: detail(COPY),
  ...extra,
});
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const fnPath = (route: Route) => new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');

interface Seen { uploads: Array<Record<string, unknown>>; patches: Array<Record<string, unknown>>; other: string[] }
/** The app, the two pictures, and a record of every write the page makes. */
async function setup(page: Page, opts: { api?: Record<string, unknown>; uploadFails?: boolean } = {}): Promise<Seen> {
  const seen: Seen = { uploads: [], patches: [], other: [] };
  await page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'table'); } catch { /* denied */ } });
  await spyRequestBodies(page);
  await installApp(page, { api: api(opts.api) });
  await page.route(/\/__e2e_photo__\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: route.request().url().includes(LOGO.id) ? LOGO_PNG : PHOTO_PNG }));
  await page.route(/\/__e2e_put__/, (route) => route.fulfill({ status: 200, body: '' }));
  await page.route('**/functions/v1/presence/**', (route) => {
    const p = fnPath(route), m = route.request().method();
    if (m !== 'GET' && p !== '/media/upload-url' && !p.startsWith('/assets/' + NEW_ID)) seen.other.push(`${m} ${p}`);
    if (p === '/media/upload-url') {
      seen.uploads.push(route.request().postDataJSON());
      return opts.uploadFails
        ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'quota_exceeded', message: 'This site has reached its media limit of 100 files. Remove a few you no longer need, then try again.' }) })
        : route.fulfill(ok({ data: { media_id: NEW_ID, upload_url: '/__e2e_put__', storage_path: 'presence-media/x.png' } }));
    }
    if (p === '/assets/' + NEW_ID && m === 'PATCH') seen.patches.push(route.request().postDataJSON());
    return route.fallback();
  });
  await page.goto('/files.html');
  await expect(page.locator(`tr[data-open="${PHOTO.id}"]`)).toBeVisible();
  return seen;
}
async function openEditor(page: Page, asset = PHOTO, button = 'Edit photo') {
  await page.locator(`tr[data-open="${asset.id}"]`).click();
  await page.locator('#panel').getByRole('button', { name: button }).click();
  const dlg = page.locator('dialog.dds-ie');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#ie-msg')).toBeHidden();   // the photo is open
  return dlg;
}
/** The uploaded picture, decoded in the browser: its size and the pixels asked for. */
async function savedPicture(page: Page, points: Array<[number, number]>) {
  const put = (await sentBodies(page)).filter((b) => b.method === 'PUT' && b.url.includes('__e2e_put__')).pop();
  expect(put, 'the edited picture was uploaded').toBeTruthy();
  return page.evaluate(async ({ b64, type, points }) => {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u], { type }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d') as CanvasRenderingContext2D; x.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, type, px: points.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data)) };
  }, { b64: put!.body.toString('base64'), type: put!.type, points });
}
const dims = async (page: Page) => {
  const m = (await page.locator('#ie-dim').textContent() || '').match(/Crop: (\d+) × (\d+) px/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

test.describe('Photo editor — saving', () => {
  test('crop to a square and save: a NEW file beside the original, in its folder', async ({ page }) => {
    const seen = await setup(page);
    const dlg = await openEditor(page);
    await expect(dlg.locator('#ie-title')).toHaveText('Edit photo');
    await expect(dlg.getByRole('tab', { name: 'Crop' })).toHaveAttribute('aria-selected', 'true');
    await expect(dlg.locator('#ie-note')).toHaveText('Saving makes a new file. The original stays exactly as it is.');
    await expect(dlg.locator('#ie-save')).toBeDisabled();   // nothing changed yet
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 800 × 600 px');
    await dlg.locator('[data-shape="square"]').click();
    await expect(dlg.locator('[data-shape="square"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 600 × 600 px');
    await dlg.getByRole('button', { name: 'Save as a new file' }).click();
    await expect(page.locator('.dds-toast', { hasText: 'Saved as a new file. The original is unchanged.' })).toBeVisible();
    await expect(dlg).toHaveCount(0);

    expect(seen.uploads).toHaveLength(1);
    expect(seen.uploads[0]).toMatchObject({ mime: 'image/png', width: 600, height: 600, alt_text: 'The shop front at dusk' });
    expect(String(seen.uploads[0].content_hash)).toMatch(/^[0-9a-f]{64}$/);
    const pic = await savedPicture(page, [[150, 300], [450, 300]]);
    expect([pic.w, pic.h]).toEqual([600, 600]);
    expect(pic.px[0].slice(0, 3)).toEqual(RED.slice(0, 3));    // the middle 600 px: red on the left…
    expect(pic.px[1].slice(0, 3)).toEqual(BLUE.slice(0, 3));   // …blue on the right
    expect(seen.patches).toHaveLength(1);
    const patch = seen.patches[0] as { name: string; collection: string; tags: string[]; caption: string; metadata: Record<string, any> };
    expect(patch.name).toBe('Storefront (edited)');
    expect(patch.collection).toBe('Outside');
    expect(patch.tags).toEqual(['shop', 'evening']);
    expect(patch.caption).toBe('Open late on Fridays');
    expect(patch.metadata.edited_from).toBe(PHOTO.id);
    expect(patch.metadata.edits).toMatchObject({ v: 1, shape: 'square', rotate: 0, crop: { x: 0.125, y: 0, w: 0.75, h: 1 } });
    expect(seen.other, 'the original was never replaced, changed or deleted').toEqual([]);

    // the panel now shows the copy, and the way back to the original
    await expect(page.locator('#editedFrom')).toContainText('An edited copy of “Storefront”. The original is unchanged.');
    await page.locator('#editedFrom').getByRole('button', { name: 'Open the original' }).click();
    await expect(page.locator('#panel #f-name')).toHaveValue('Storefront');
    await expect(page.locator('#editedFrom')).toHaveCount(0);
  });

  test('rotate, flip and a filter are in the saved pixels', async ({ page }) => {
    await setup(page);
    const dlg = await openEditor(page);
    await dlg.getByRole('button', { name: 'Rotate right' }).click();
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 600 × 800 px');   // the left (red) half is now on top
    await dlg.getByRole('button', { name: 'Flip upside down' }).click();
    await expect(dlg.getByRole('button', { name: 'Flip upside down' })).toHaveAttribute('aria-pressed', 'true');
    await dlg.getByRole('tab', { name: 'Filters' }).click();
    // the filter tiles are drawn from this photo: Original shows its colour, Black & white is grey
    const tile = (key: string) => page.evaluate((k) => {
      const c = document.querySelector(`.ie-fil[data-filter="${k}"] canvas`) as HTMLCanvasElement;
      return Array.from((c.getContext('2d') as CanvasRenderingContext2D).getImageData(80, 10, 1, 1).data);
    }, key);
    await expect.poll(() => tile('none')).not.toEqual([0, 0, 0, 0]);
    const [plain, mono] = [await tile('none'), await tile('mono')];
    expect(plain[2]).toBeGreaterThan(plain[0]);   // blue, at the top after the flip
    expect(Math.abs(mono[0] - mono[1]) <= 1 && Math.abs(mono[1] - mono[2]) <= 1).toBe(true);
    await dlg.locator('[data-filter="mono"]').click();
    await expect(dlg.locator('[data-filter="mono"]')).toHaveAttribute('aria-pressed', 'true');
    await dlg.getByRole('button', { name: 'Save as a new file' }).click();
    await expect(dlg).toHaveCount(0);
    const pic = await savedPicture(page, [[300, 150], [300, 650]]);
    expect([pic.w, pic.h]).toEqual([600, 800]);
    const [top, bottom] = pic.px;
    for (const p of [top, bottom]) expect(Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2])).toBeLessThanOrEqual(1);   // grey
    expect(top[0]).toBeLessThan(bottom[0]);   // blue (now on top) greys darker than red
  });

  test('Remove background: one tap takes out a plain backdrop, saved as a PNG', async ({ page }) => {
    const seen = await setup(page);
    const dlg = await openEditor(page, LOGO, 'Remove background');
    await expect(dlg.getByRole('tab', { name: 'Background' })).toHaveAttribute('aria-selected', 'true');
    await expect(dlg.locator('#ie-bg-on')).toBeChecked();
    await expect(dlg.locator('#ie-bg-say')).toContainText(/Took out \d+% of the picture\./);
    await expect(dlg.locator('#ie-bg-say')).not.toContainText('aren’t one plain colour');
    await expect(dlg.locator('#ie-save')).toBeEnabled();
    await dlg.getByRole('button', { name: 'Save as a new file' }).click();
    await expect(dlg).toHaveCount(0);
    expect(seen.uploads[0]).toMatchObject({ mime: 'image/png', width: 400, height: 300, alt_text: 'Our round logo' });   // a JPEG logo comes back a PNG
    const pic = await savedPicture(page, [[5, 5], [395, 295], [200, 150]]);
    expect(pic.type).toBe('image/png');
    expect(pic.px[0][3]).toBe(0);
    expect(pic.px[1][3]).toBe(0);
    expect(pic.px[2]).toEqual([30, 40, 120, 255]);   // the logo itself, untouched
    expect((seen.patches[0] as { brand?: boolean }).brand).toBe(true);   // a brand file's copy is a brand file
    expect(seen.other.filter((w) => w.includes('remove-background')), 'the old AI route is not called').toEqual([]);
  });

  test('a panel left open past the hour its links last reads the file again first', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'));
    await setup(page);
    let reads = 0;
    await page.route(new RegExp('/functions/v1/presence/assets/' + PHOTO.id + '$'), (route) => { if (route.request().method() === 'GET') reads++; return route.fallback(); });
    await page.locator(`tr[data-open="${PHOTO.id}"]`).click();
    await expect(page.locator('#panel #f-name')).toHaveValue('Storefront');
    expect(reads).toBe(1);
    await page.clock.setFixedTime(new Date('2026-11-08T12:51:00Z'));
    await page.locator('#panel').getByRole('button', { name: 'Edit photo' }).click();
    await expect(page.locator('dialog.dds-ie #ie-msg')).toBeHidden();
    expect(reads).toBe(2);
  });

  test('a refused upload keeps the editor open, with the reason and the edits', async ({ page }) => {
    await setup(page, { uploadFails: true });
    const dlg = await openEditor(page);
    await dlg.getByRole('button', { name: 'Rotate left' }).click();
    await dlg.getByRole('button', { name: 'Save as a new file' }).click();
    await expect(dlg.locator('#ie-note')).toContainText('This site has reached its media limit of 100 files.');
    await expect(dlg.locator('#ie-note')).toHaveAttribute('role', 'alert');
    await expect(dlg).toBeVisible();
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 600 × 800 px');   // the turn is still there
    await expect(dlg.locator('#ie-save')).toBeEnabled();
  });
});

test.describe('Photo editor — the crop', () => {
  test('drag a corner; a held shape keeps its shape', async ({ page }) => {
    await setup(page);
    const dlg = await openEditor(page);
    const handle = dlg.locator('.ie-h[data-h="se"]');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 30, { steps: 4 });
    await page.mouse.up();
    const free = (await dims(page))!;
    expect(free.w).toBeLessThan(800);
    expect(free.h).toBeLessThan(600);
    await dlg.locator('[data-shape="16:9"]').click();
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 800 × 450 px');
    const b2 = (await handle.boundingBox())!;
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2 - 80, b2.y + b2.height / 2 - 10, { steps: 4 });
    await page.mouse.up();
    const held = (await dims(page))!;
    expect(held.w).toBeLessThan(800);
    expect(Math.abs(held.w / held.h - 16 / 9)).toBeLessThan(0.01);
    // turning the shape tall keeps the same shape, the other way up
    await dlg.getByRole('button', { name: 'Make it tall' }).click();
    await expect(dlg.locator('[data-shape="16:9"]')).toContainText('9:16');
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 338 × 600 px');
    await expect(dlg.getByRole('button', { name: 'Make it wide' })).toBeVisible();
  });

  test('with a keyboard: arrows move the crop, Shift and an arrow resize it', async ({ page }) => {
    await setup(page);
    const dlg = await openEditor(page);
    await dlg.locator('[data-shape="square"]').click();
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 600 × 600 px');   // drawn: the box is in its new place
    const crop = dlg.locator('#ie-crop');
    await crop.focus();
    const left = async () => Number((await crop.evaluate((el) => (el as HTMLElement).style.left)).replace('%', ''));
    const before = await left();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await left()).toBeCloseTo(before + 2, 5);
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 600 × 600 px');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('#ie-dim')).toHaveText('Crop: 592 × 592 px');   // still square
  });
});

test.describe('Photo editor — leaving, undo, who sees it', () => {
  test('leaving with changes asks first; Undo goes back; Escape never closes the panel behind', async ({ page }) => {
    await setup(page);
    const dlg = await openEditor(page);
    await dlg.getByRole('tab', { name: 'Adjust' }).click();
    await dlg.locator('#ie-a-brightness').fill('40');
    await expect(dlg.locator('#ie-o-brightness')).toHaveText('+40');
    await page.keyboard.press('Escape');
    await expect(dlg.locator('#ie-ask')).toBeVisible();
    await expect(dlg.locator('#ie-ask')).toContainText('Leave without saving?');
    await dlg.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dlg.locator('#ie-ask')).toBeHidden();
    await expect(dlg.locator('#ie-o-brightness')).toHaveText('+40');
    await dlg.getByRole('button', { name: 'Undo' }).click();
    await expect(dlg.locator('#ie-o-brightness')).toHaveText('0');
    await expect(dlg.locator('#ie-save')).toBeDisabled();
    await dlg.getByRole('button', { name: 'Redo' }).click();
    await expect(dlg.locator('#ie-o-brightness')).toHaveText('+40');
    await dlg.getByRole('button', { name: 'Start over' }).click();
    await expect(dlg.locator('#ie-o-brightness')).toHaveText('0');
    await expect(dlg.locator('#ie-save')).toBeDisabled();
    // the worst case: focus has fallen out of the editor to the page itself
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await page.keyboard.press('Escape');   // nothing changed now: it just closes
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('#panel')).toHaveClass(/\bon\b/);   // the file's panel is still open
    await expect(page.locator('#panel #f-name')).toHaveValue('Storefront');
  });

  test('only photos, and only for someone who can edit', async ({ page }) => {
    await setup(page);
    await page.locator(`tr[data-open="${DOC.id}"]`).click();
    await expect(page.locator('#panel #f-name')).toHaveValue('Price list');
    await expect(page.locator('#panel').getByRole('button', { name: 'Edit photo' })).toHaveCount(0);
    await expect(page.locator('#panel').getByRole('button', { name: 'Remove background' })).toHaveCount(0);
  });

  test('a viewer sees no Edit photo', async ({ page }) => {
    await setup(page, { api: { '/portal/context': { data: { site_role: 'business_staff', edition: 'presence', edition_key: 'studio_os', capabilities: ['view_all'], nav: [], landing: '/today.html' } } } });
    await page.locator(`tr[data-open="${PHOTO.id}"]`).click();
    await expect(page.locator('#panel #f-name')).toBeDisabled();
    await expect(page.locator('#panel').getByRole('button', { name: 'Edit photo' })).toHaveCount(0);
  });

  test('on a small screen the photo, the tools and Save all fit', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await setup(page);
    const dlg = await openEditor(page);
    const vw = 390;
    const box = (await dlg.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(vw + 1);
    await expect(dlg.locator('#ie-save')).toBeInViewport();
    await expect(dlg.locator('#ie-cv')).toBeInViewport();
    await expect(dlg.getByRole('tab', { name: 'Background' })).toBeInViewport();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide).toBeLessThanOrEqual(vw + 1);
  });
});

// ── Cut out the subject: the server's cut-out service (lib/cutout.ts), mocked ──
const JOB = 'pred0000starting.' + 'A'.repeat(32);
const withCutout = { ['/assets/' + PHOTO.id]: detail(PHOTO, { cutout_available: true }), ['/assets/' + LOGO.id]: detail(LOGO, { cutout_available: true }) };
/** Answer the cut-out calls: `first` for the POST (a PNG, a job, or a refusal), the PNG for a job. */
async function cutoutService(page: Page, first: 'png' | 'job' | 'refuse') {
  const calls: string[] = [];
  await page.route(/\/functions\/v1\/presence\/assets\/(cutout\/|[0-9a-f-]{36}\/cutout)/, (route) => {
    const p = fnPath(route);
    calls.push(`${route.request().method()} ${p}`);
    if (p.startsWith('/assets/cutout/')) return route.fulfill({ status: 200, contentType: 'image/png', body: CUT_PNG });
    if (first === 'job') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ data: { pending: true, job: JOB, note: 'Starting up.' } }) });
    if (first === 'refuse') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited', message: 'That’s a lot of requests in a short time — please wait a minute and try again.' }) });
    return route.fulfill({ status: 200, contentType: 'image/png', body: CUT_PNG });
  });
  return calls;
}

test.describe('Photo editor — cut out the subject', () => {
  test('Remove background on a busy photo cuts out the subject by itself, even while the service starts up', async ({ page }) => {
    const seen = await setup(page, { api: withCutout });
    const calls = await cutoutService(page, 'job');
    const dlg = await openEditor(page, PHOTO, 'Remove background');   // red and blue halves: no one plain edge colour
    await expect(dlg.locator('#ie-cut-say')).toContainText('Cut out.', { timeout: 15000 });
    expect(calls).toEqual([`POST /assets/${PHOTO.id}/cutout`, `GET /assets/cutout/${JOB}`]);
    await expect(dlg.locator('#ie-cut')).toHaveText('Put the background back');
    await expect(dlg.locator('#ie-bg-on')).toBeDisabled();   // the plain tool has nothing left to do
    await dlg.getByRole('button', { name: 'Save as a new file' }).click();
    await expect(dlg).toHaveCount(0);
    expect(seen.uploads[0]).toMatchObject({ mime: 'image/png', width: 800, height: 600 });
    const pic = await savedPicture(page, [[10, 10], [790, 590], [400, 300]]);
    expect(pic.px[0][3]).toBe(0);
    expect(pic.px[1][3]).toBe(0);
    expect(pic.px[2]).toEqual([200, 120, 60, 255]);
    expect((seen.patches[0] as { metadata: { edits: { cutout: boolean } } }).metadata.edits.cutout).toBe(true);
  });

  test('a plain backdrop keeps the free tool: the service isn’t asked', async ({ page }) => {
    await setup(page, { api: withCutout });
    const calls = await cutoutService(page, 'png');
    const dlg = await openEditor(page, LOGO, 'Remove background');
    await expect(dlg.locator('#ie-bg-say')).toContainText(/Took out \d+% of the picture\./);
    await expect(dlg.locator('#ie-cut')).toHaveText('Cut out the subject');
    await page.waitForTimeout(400);
    expect(calls).toEqual([]);
  });

  test('cut out by hand, put the background back, cut out again: one call to the service', async ({ page }) => {
    await setup(page, { api: withCutout });
    const calls = await cutoutService(page, 'png');
    const dlg = await openEditor(page);
    await dlg.getByRole('tab', { name: 'Background' }).click();
    await dlg.getByRole('button', { name: 'Cut out the subject' }).click();
    await expect(dlg.locator('#ie-cut')).toHaveText('Put the background back');
    await expect(dlg.locator('#ie-save')).toBeEnabled();
    await dlg.getByRole('button', { name: 'Put the background back' }).click();
    await expect(dlg.locator('#ie-cut')).toHaveText('Cut out the subject');
    await expect(dlg.locator('#ie-save')).toBeDisabled();   // back to the photo as it was
    await dlg.getByRole('button', { name: 'Cut out the subject' }).click();
    await expect(dlg.locator('#ie-cut')).toHaveText('Put the background back');
    await dlg.getByRole('button', { name: 'Undo' }).click();
    await expect(dlg.locator('#ie-cut')).toHaveText('Cut out the subject');
    expect(calls).toEqual([`POST /assets/${PHOTO.id}/cutout`]);
  });

  test('a refused cut-out says why and changes nothing', async ({ page }) => {
    await setup(page, { api: withCutout });
    await cutoutService(page, 'refuse');
    const dlg = await openEditor(page);
    await dlg.getByRole('tab', { name: 'Background' }).click();
    await dlg.getByRole('button', { name: 'Cut out the subject' }).click();
    await expect(dlg.locator('#ie-cut-say')).toContainText('That’s a lot of requests in a short time');
    await expect(dlg.locator('#ie-cut-say')).toHaveClass(/ie-err/);
    await expect(dlg.locator('#ie-cut')).toHaveText('Cut out the subject');
    await expect(dlg.locator('#ie-save')).toBeDisabled();
  });

  test('without the service’s key there is no cut-out button', async ({ page }) => {
    await setup(page);
    const dlg = await openEditor(page, LOGO, 'Remove background');
    await expect(dlg.locator('#ie-bg-say')).toContainText('Took out');
    await expect(dlg.locator('#ie-cut')).toHaveCount(0);
    await expect(dlg.getByText('Cut out the subject')).toHaveCount(0);
  });
});
