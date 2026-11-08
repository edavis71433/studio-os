// ── Picker pictures, step 2: photograph the rendered pages (list item 25) ───────
//   node scripts/thumbnails/shoot.mjs <out-dir>
// Serves what render.ts wrote and saves small JPEGs the builder shows:
//   thumbs/templates/<slug>.jpg  — the top of each template's sample home page, 640×440
//   thumbs/sections/<type>.jpg   — each section type on its own, 440×248
// Re-run both steps after a template or section changes how it draws, and commit.
import { createServer } from 'node:http';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const src = process.argv[2];
if (!src) { console.error('usage: shoot.mjs <out-dir>'); process.exit(2); }
const ROOT = fileURLToPath(new URL('../../', import.meta.url));   // a decoded path: the folder may hold a space
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.json': 'application/json', '.pdf': 'application/pdf' };

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p += 'index.html';
  try { const body = await readFile(join(src, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

// Templates: each is served from its own folder, so /assets and /ph resolve there.
const templates = await readdir(join(src, 'templates'));
await mkdir(join(ROOT, 'thumbs/templates'), { recursive: true });
for (const slug of templates) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 880 }, deviceScaleFactor: 0.5 });
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    return route.continue({ url: `${base}/templates/${slug}${u.pathname.replace(`/templates/${slug}`, '')}` });
  });
  await page.goto(`${base}/templates/${slug}/`, { waitUntil: 'networkidle' });
  // the top of the page, however the template scrolls (Harbor's smooth scroll had moved it)
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(ROOT, `thumbs/templates/${slug}.jpg`), type: 'jpeg', quality: 72 });
  await page.close();
}

// Sections: the section alone, with the site's header and footer out of the picture.
const sections = await readdir(join(src, 'sections'));
await mkdir(join(ROOT, 'thumbs/sections'), { recursive: true });
for (const type of sections) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 0.4 });
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    return route.continue({ url: `${base}/sections/${type}${u.pathname.replace(`/sections/${type}`, '')}` });
  });
  await page.goto(`${base}/sections/${type}/`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'header,footer,.skip,.strip,#presence-preview-badge{display:none!important}body{padding-top:0!important}html{scroll-behavior:auto!important}' });
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator(`#main > [data-dds-key^="block_${type}"]`).first().boundingBox();
  if (!box) throw new Error(`section ${type} did not draw`);
  await page.screenshot({ path: join(ROOT, `thumbs/sections/${type}.jpg`), type: 'jpeg', quality: 72,
    clip: { x: 0, y: Math.max(0, box.y - 8), width: 1100, height: 620 } });
  await page.close();
}
await browser.close();
server.close();
console.log(`shot ${templates.length} templates and ${sections.length} sections`);
