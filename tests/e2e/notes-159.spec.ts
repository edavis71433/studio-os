import { test, expect, type Page, type Route } from '@playwright/test';
import { mountCanvas } from './helpers/editor';
import { injectFeedbackPanel } from '../../supabase/functions/presence/lib/feedback_panel';

// Builder list item 159 (Nov 2026): notes take a picture, a thread shows Open, Done or
// All, and feedback on a shared draft carries the name the person typed.
// tests/presence/comments_159_test.mjs covers the server and the panel's script.

const PIC = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#c9a77c"/></svg>');
const THREADS = { data: { total_open: 2, threads: [{ page_slug: '', block_id: '', open_count: 2, comments: [
  { id: 'c1', page_slug: '', block_id: '', author_kind: 'client', author_name: 'Dana', body: 'The phone number is wrong', status: 'open', created_at: '2026-11-12T10:00:00Z', picture: { url: PIC, w: 320, h: 180 } },
  { id: 'c2', page_slug: '', block_id: '', author_kind: 'client', author_name: null, body: 'Love the photos', status: 'open', created_at: '2026-11-12T09:00:00Z', picture: null },
  { id: 'c3', page_slug: '', block_id: '', author_kind: 'operator', body: 'Fixed the hours', status: 'resolved', created_at: '2026-11-11T09:00:00Z', picture: null },
] }] } };
// a small real PNG for the file picker (1x1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function openNotes(page: Page) {
  const posts: Array<Record<string, unknown>> = [];
  await mountCanvas(page, { beforeGoto: async (p) => {
    await p.route(/\/functions\/v1\/presence\/comments$/, (route: Route) => {
      if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(THREADS) });
    });
  } });
  await page.evaluate(async () => { const w = window as unknown as { cmLoad: () => Promise<void>; openCommentsThread: (s: string, b: string, n: string) => void }; await w.cmLoad(); w.openCommentsThread('', '', 'Home'); });
  const panel = page.locator('#cmPanelBody');
  await expect(panel.locator('.cm-item').first()).toBeVisible();
  return { panel, posts };
}

test.describe('item 159 — notes in the editor', () => {
  test('a thread shows its open notes first, then Done or All', async ({ page }) => {
    const { panel } = await openNotes(page);
    const seg = panel.getByRole('group', { name: 'Show notes' });
    await expect(seg.getByRole('button', { name: 'Open (2)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.cm-item')).toHaveCount(2);
    await seg.getByRole('button', { name: 'Done (1)' }).click();
    await expect(panel.locator('.cm-item')).toHaveCount(1);
    await expect(panel.locator('.cm-item')).toContainText('Fixed the hours');
    await expect(panel.getByRole('button', { name: 'Done (1)' })).toBeFocused();
    await panel.getByRole('button', { name: 'All' }).click();
    await expect(panel.locator('.cm-item')).toHaveCount(3);
  });

  test('a client’s note shows the name they gave and its picture, which opens full size', async ({ page }) => {
    const { panel } = await openNotes(page);
    const first = panel.locator('.cm-item').first();
    await expect(first.locator('.cm-who')).toContainText('Client');
    await expect(first.locator('.cm-name')).toHaveText('Dana');
    const link = first.locator('a.cm-pic');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link.locator('img')).toHaveAttribute('alt', 'Picture sent with this note');
    await expect(panel.locator('.cm-item').nth(1).locator('.cm-name')).toHaveCount(0);   // no name given: just "Client"
  });

  test('the studio adds a picture to its own note, and can take it back off', async ({ page }) => {
    const { panel, posts } = await openNotes(page);
    await panel.locator('.cm-attach input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    await expect(panel.locator('.cm-thumb img')).toBeVisible();
    await panel.locator('.cm-thumb').getByRole('button', { name: 'Remove' }).click();
    await expect(panel.locator('.cm-thumb')).toBeHidden();
    await panel.locator('.cm-attach input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    await panel.getByRole('textbox', { name: 'Your note' }).fill('Like this one');
    await panel.getByRole('button', { name: 'Reply' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].body).toBe('Like this one');
    expect(String(posts[0].image)).toMatch(/^data:image\/jpeg;base64,/);
    expect(posts[0].w).toBe(1); expect(posts[0].h).toBe(1);
  });
});

test.describe('item 159 — feedback on a shared draft', () => {
  test('a name typed once goes with every note, and a screenshot goes with its note', async ({ page }) => {
    const sent: Array<Record<string, unknown>> = [];
    await page.route(/\/functions\/v1\/presence\/p\/s\/[^/]+\/sections/, (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { page_slug: '', sections: [{ id: 'gallery', name: 'Photo gallery' }] } }) }));
    await page.route(/\/functions\/v1\/presence\/p\/s\/[^/]+\/comments/, (route: Route) => { sent.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) }); });
    // the draft as the server sends it, with its feedback panel (the real one, from the server's own code)
    const html = injectFeedbackPanel('<!doctype html><html lang="en"><head><title>Draft</title></head><body><main><h1>Marlow’s Kitchen</h1></main></body></html>', { pfx: 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/p/s/tok123', page: '/' });
    await page.route(/\/functions\/v1\/presence\/p\/s\/tok123\?/, (route: Route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto('/draft.html?s=tok123');
    await page.getByRole('button', { name: /Leave feedback/ }).click();
    const name = page.getByLabel('Your name (so the studio knows who wrote)');
    await expect(name).toBeVisible();
    await name.fill('Dana');
    const whole = page.locator('.pfb-row').first();
    await whole.locator('textarea').fill('The phone number is wrong');
    await whole.locator('.pfb-pic input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    await expect(whole.locator('.pfb-thumb img')).toBeVisible();
    await whole.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].name).toBe('Dana');
    expect(sent[0].body).toBe('The phone number is wrong');
    expect(String(sent[0].image)).toMatch(/^data:image\/jpeg;base64,/);
    await expect(whole).toContainText('Thanks');
    // the next note on another section carries the same name, typed once
    const gallery = page.locator('.pfb-row', { hasText: 'Photo gallery' });
    await gallery.getByRole('button', { name: 'Add a note' }).click();
    await gallery.locator('textarea').fill('More of the bread, please');
    await gallery.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ page: '/', block_id: 'gallery', body: 'More of the bread, please', name: 'Dana' });
  });
});
