import { test, expect, Page, Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installApp, settled } from './helpers/app';
import { editHome, homeLine, lastPut, mountPages, undo } from './helpers/editor';

// ── Builder item 142: the site as Netlify publishes it, packed and fingerprinted, still works ──
// Every other spec runs the repo's own readable files. What ships is scripts/build-public.sh's
// copy: packed by scripts/pack-public.mjs, the app's scripts and styles at /v/<fingerprint>/.
// This builds that copy and serves it in place of the repo's files, so a packing or pointing
// mistake shows here, on every device's own browser engine, and not on the live app.
const ROOT = join(__dirname, '..', '..');
let OUT = '';
test.beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), 'packed-site-'));
  execFileSync('bash', ['scripts/build-public.sh'], { cwd: ROOT, env: { ...process.env, BUILD_OUT: OUT }, stdio: 'pipe' });
});
test.afterAll(() => { if (OUT) rmSync(OUT, { recursive: true, force: true }); });

/** Answer the test server's addresses from the built copy, as the app host would. */
async function servePacked(page: Page, baseURL: string | undefined) {
  const origin = new URL(baseURL || 'http://127.0.0.1').origin;
  const asked: string[] = [];
  await page.route((url) => url.origin === origin, (route: Route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    asked.push(path);
    const tries = path === '/' ? ['index.html'] : [path.slice(1), path.slice(1) + '.html'];
    for (const t of tries) {
      const f = join(OUT, t);
      if (f.startsWith(OUT) && existsSync(f) && statSync(f).isFile()) return route.fulfill({ path: f });
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not in the build' });
  });
  return asked;
}

// The signed-in app's pages: the ones that load the shell.
const APP_PAGES = () => readdirSync(ROOT).filter((f) => f.endsWith('.html') && /src="\/shell\.js"/.test(readFileSync(join(ROOT, f), 'utf8')));

test.describe('the packed site (item 142)', () => {
  test('the build packs the code and points the app pages at fingerprinted copies', async () => {
    const page = readFileSync(join(OUT, 'presence.html'), 'utf8');
    const shell = page.match(/src="(\/v\/[0-9a-f]{12}\/shell\.js)"/);
    expect(shell, 'the editor loads a fingerprinted shell.js').not.toBeNull();
    expect(page).toMatch(/href="\/v\/[0-9a-f]{12}\/shell\.css"/);
    expect(page, 'and no plain one').not.toMatch(/["']\/shell\.js["']/);
    // the copy is the packed file, and smaller than the readable one
    const packed = readFileSync(join(OUT, shell![1]), 'utf8');
    expect(packed.length).toBeLessThan(readFileSync(join(ROOT, 'shell.js'), 'utf8').length * 0.7);
    // the tools host's pages keep the plain names that host serves (list item 139)
    expect(readFileSync(join(OUT, 'site-review.html'), 'utf8')).toMatch(/src="\/site-review\.js\?v=\d+"/);
    // the editor's styles are written into its page (data-inline), so it draws without a second request
    expect(page).toMatch(/<style>[^<]{1000,}<\/style>/);
    expect(page, 'no request for presence.css').not.toMatch(/presence\.css/);
  });

  for (const name of APP_PAGES()) {
    test(`${name} runs from the packed copy`, async ({ page, baseURL }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await installApp(page);
      const asked = await servePacked(page, baseURL);
      await page.goto('/' + name);
      await page.waitForLoadState('load');
      await settled(page);
      expect(errors).toEqual([]);
      expect(asked.some((p) => /^\/v\/[0-9a-f]{12}\/shell\.js$/.test(p)), 'the fingerprinted shell.js was loaded').toBe(true);
      expect(asked.filter((p) => /^\/(shell\.(js|css)|fresh-code\.js)$/.test(p)), 'no plain shared file was asked for').toEqual([]);
    });
  }

  test('the packed editor edits, saves and undoes', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await servePacked(page, baseURL);   // first, so the editor's own answers (registered after) win
    const { frame, puts } = await mountPages(page);
    await editHome(page, frame, 'Packed and working');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(lastPut(puts).blocks?.[0].subtitle).toBe('Packed and working');
    await undo(page);
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    expect(lastPut(puts).blocks?.[0].subtitle).toBe('A quiet sub line');
    await expect(homeLine(frame)).toHaveText('A quiet sub line');
    expect(errors).toEqual([]);
  });
});
