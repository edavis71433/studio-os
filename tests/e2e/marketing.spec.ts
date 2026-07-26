import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ============================================================
// MS1 — marketing chrome + IA pins (docs/design/MARKETING-SITE-OVERHAUL.md).
//
// The marketing pages are static HTML with a hand-copy history (>=12 nav
// generations were live at once — "my pricing disappeared"). MS1 replaced
// that with ONE canonical chrome (scripts/marketing-chrome.template.html)
// propagated into delimited regions by scripts/sync-marketing-chrome.mjs.
// This spec makes the drift class structurally impossible to regress:
//   - byte-identity of the nav/footer regions across every marketing page
//     (normalized only for the per-page aria-current stamps)
//   - the 6-slot IA itself (no page may carry the old 8-slot nav)
//   - _redirects / sitemap reality (the local static server does NOT
//     execute _redirects, so the rules are pinned by parsing the file and
//     the .html targets are exercised directly)
//   - live behavior: submenu accessibility, link resolution, mobile
//     drawer, console-clean boots.
// No Supabase stub needed — these pages have no backend.
// ============================================================

function findRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, '_redirects')) && existsSync(join(dir, 'index.html'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root (with _redirects + index.html) not found from ' + process.cwd());
}
const ROOT = findRoot();
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

// The marketing estate (buy-audit.html deliberately excluded: it ships
// chromeless today; MS3 owns its slim payment-moment chrome per the plan).
const PAGES = [
  'index.html', 'services.html', 'web-design.html', 'seo-strategy.html',
  'monthly-retainer.html', 'pricing.html', 'how-we-work.html',
  'the-experience.html', 'industries.html', 'restaurant-web-design.html',
  'salon-web-design.html', 'retail-web-design.html',
  'home-services-web-design.html', 'health-wellness-web-design.html',
  'tools.html', 'audit.html', 'ai-critique.html', 'report-card.html',
  'roi-calculator.html', 'pricing-estimator.html', 'local-visibility.html',
  'about.html', 'work.html', 'contact.html', 'privacy.html', 'terms.html',
  'accessibility.html', 'ai-disclaimer.html', '404.html',
];

const region = (html: string, name: string, file: string): string => {
  const m = html.match(new RegExp(`<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->`));
  if (!m) throw new Error(`${file}: region ${name} missing`);
  return m[0];
};
// the ONLY tolerated per-page variance in the chrome
const normalize = (block: string) => block.replace(/ aria-current="(?:page|true)"/g, '');

type Rule = { from: string; to: string; code: string };
function parseRedirects(): Rule[] {
  return read('_redirects')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter((p) => p.length >= 3)
    .map(([from, to, code]) => ({ from, to, code }));
}
/** clean URL -> served .html file (via the parsed _redirects 200 rules) */
function targetOf(rules: Rule[], url: string): string | null {
  const r = rules.find((x) => x.from === url && x.code.startsWith('200'));
  return r ? r.to : null;
}
const chromeHrefs = (): string[] => {
  const tpl = read('scripts/marketing-chrome.template.html');
  const nav = region(tpl, 'dds-marketing-nav', 'template');
  const foot = region(tpl, 'dds-marketing-footer', 'template');
  const hrefs = [...(nav + foot).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(hrefs.filter((h) => h.startsWith('/')))];
};

// ---------------------------------------------------------------------------
// Static pins — filesystem truth, one project is enough
// ---------------------------------------------------------------------------
test.describe('marketing chrome (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  test('nav + footer are byte-identical across every marketing page (aria-current normalized)', () => {
    const tpl = read('scripts/marketing-chrome.template.html');
    const canonNav = normalize(region(tpl, 'dds-marketing-nav', 'template'));
    const canonFoot = region(tpl, 'dds-marketing-footer', 'template');
    for (const f of PAGES) {
      const html = read(f);
      expect(normalize(region(html, 'dds-marketing-nav', f)), `${f} nav region`).toBe(canonNav);
      expect(region(html, 'dds-marketing-footer', f), `${f} footer region`).toBe(canonFoot);
    }
  });

  test('sync-marketing-chrome --check passes (committed pages == canonical template)', () => {
    execFileSync('node', ['scripts/sync-marketing-chrome.mjs', '--check'], { cwd: ROOT });
  });

  test('no page carries the old 8-slot nav; every page carries the 6 slots + 2 actions', () => {
    for (const f of PAGES) {
      const nav = region(read(f), 'dds-marketing-nav', f);
      // the retired slots (footer may still link Results/audit — the nav must not)
      expect(nav, `${f}: the-experience nav slot retired (P1)`).not.toContain('href="/the-experience"');
      expect(nav, `${f}: Results nav slot footer-demoted (P3)`).not.toContain('href="/work"');
      expect(nav, `${f}: Free site review slot folded into Free tools`).not.toContain('>Free site review<');
      expect(nav, `${f}: "How we work" label renamed`).not.toContain('>How we work<');
      // the 6 slots
      for (const key of ['services', 'pricing', 'how-it-works', 'industries', 'tools', 'about']) {
        expect(nav, `${f}: nav slot ${key}`).toContain(`data-nav="${key}"`);
      }
      // the 2 actions
      expect(nav, `${f}: Client login -> /portal`).toContain('href="/portal" class="nav-login"');
      expect(nav, `${f}: Book a free call -> /contact`).toMatch(/href="\/contact"[^>]*>Book a free call</);
    }
  });

  test('aria-current stamped per page: exact page + section', () => {
    const navOf = (f: string) => region(read(f), 'dds-marketing-nav', f);
    expect(navOf('pricing.html')).toMatch(/data-nav="pricing" aria-current="page"/);
    expect(navOf('how-we-work.html')).toMatch(/data-nav="how-it-works" aria-current="page"/);
    expect(navOf('tools.html')).toMatch(/data-nav="tools" aria-current="page"/);
    // service detail: sub-link is the page, Services toggle is the section
    expect(navOf('web-design.html')).toMatch(/data-nav="web-design" aria-current="page"/);
    expect(navOf('web-design.html')).toMatch(/data-nav="services"[^>]*aria-current="true"/);
    // landers mark the Industries section; tool pages + audit mark Free tools
    expect(navOf('salon-web-design.html')).toMatch(/data-nav="industries" aria-current="true"/);
    expect(navOf('audit.html')).toMatch(/data-nav="tools" aria-current="true"/);
    // 404 claims nothing
    expect(navOf('404.html')).not.toContain('aria-current');
  });

  test('every marketing page loads nav.js exactly once (the accessible submenu/burger behavior)', () => {
    for (const f of PAGES) {
      const html = read(f);
      expect(html.match(/<script src="\/?nav\.js" defer><\/script>/g)?.length, f).toBe(1);
    }
  });

  test('_redirects: every chrome destination has a clean-URL 200 rule to a real file', () => {
    const rules = parseRedirects();
    for (const url of chromeHrefs()) {
      const to = targetOf(rules, url);
      expect(to, `rule for ${url}`).toBeTruthy();
      expect(existsSync(join(ROOT, to!.replace(/^\//, ''))), `${url} -> ${to} exists`).toBe(true);
    }
  });

  test('_redirects: the 5 industry landers ride explicit rules, not implicit .html resolution', () => {
    const rules = parseRedirects();
    for (const lander of [
      '/restaurant-web-design', '/salon-web-design', '/retail-web-design',
      '/home-services-web-design', '/health-wellness-web-design',
    ]) {
      expect(targetOf(rules, lander), lander).toBe(`${lander}.html`);
    }
  });

  test('_redirects: ghost 301s pinned (start, contact-disclaimer, free-site-review)', () => {
    const rules = parseRedirects();
    const r301 = (from: string) => rules.find((x) => x.from === from && x.code === '301');
    expect(r301('/start')?.to).toBe('/contact');
    expect(r301('/contact-disclaimer')?.to).toBe('/privacy');
    expect(r301('/free-site-review')?.to).toBe('/audit');
    // each 301 lands on a URL that itself resolves
    for (const from of ['/start', '/contact-disclaimer', '/free-site-review']) {
      const to = targetOf(rules, r301(from)!.to);
      expect(to && existsSync(join(ROOT, to.replace(/^\//, ''))), `${from} chain`).toBe(true);
    }
  });

  test('sitemap.xml reflects reality: every URL resolves; every indexable chrome destination is listed', () => {
    const rules = parseRedirects();
    const locs = [...read('sitemap.xml').matchAll(/<loc>https:\/\/davisdigitalstudio\.com([^<]*)<\/loc>/g)].map(
      (m) => m[1] || '/'
    );
    expect(locs.length).toBeGreaterThan(0);
    for (const path of locs) {
      const to = targetOf(rules, path);
      expect(to, `sitemap ${path} has a 200 rule`).toBeTruthy();
      expect(existsSync(join(ROOT, to!.replace(/^\//, ''))), `sitemap ${path} -> ${to}`).toBe(true);
    }
    // chrome destinations belong in the sitemap — except /portal (app door,
    // deliberately unindexed) and the legal-utility 404 target set
    for (const url of chromeHrefs()) {
      if (url === '/portal') continue;
      expect(locs, `sitemap lists ${url}`).toContain(url);
    }
  });

  test('404.html uses only absolute URLs (it serves at nested paths)', () => {
    const html = read('404.html');
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      expect(m[1], `404.html link ${m[1]}`).toMatch(/^(https?:|\/|#|mailto:)/);
    }
    // money-path rescues per the plan
    for (const rescue of ['/contact', '/pricing', '/audit']) {
      expect(html.includes(`href="${rescue}"`), `404 rescue ${rescue}`).toBe(true);
    }
  });

  test('label honesty: "See what your site needs" always means /audit', () => {
    for (const f of PAGES) {
      for (const m of read(f).matchAll(/<a href="([^"]+)"[^>]*>See what your site needs/g)) {
        expect(m[1], `${f}: label destination`).toBe('/audit');
      }
    }
  });

  test('one light system (P4): no marketing page ships a page-scoped dark chrome', () => {
    // chrome = the delimited regions + the tokens they render with. The tool
    // bodies keep their (MS3-owned) local skins for now; what MUST be gone is
    // contact.html's token flip — the only one that re-skinned header/footer.
    expect(read('contact.html')).not.toContain('prefers-color-scheme');
  });
});

// ---------------------------------------------------------------------------
// Live behavior — desktop
// ---------------------------------------------------------------------------
test.describe('marketing nav (live, desktop)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop nav behavior');
  });

  test('index: 6-slot nav renders, /pricing is one click from home, submenu opens on hover and closes on Escape', async ({ page }) => {
    await page.goto('/index.html');
    const nav = page.locator('header.nav');
    await expect(nav.locator('a[data-nav="pricing"]')).toBeVisible();
    await expect(nav.locator('a[data-nav="tools"]')).toBeVisible();
    await expect(nav.locator('.nav-links > a, .nav-links > .nav-has-sub')).toHaveCount(6);

    const toggle = nav.locator('.nav-sub-toggle');
    await toggle.hover();
    await expect(nav.locator('.nav-sub')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.locator('.nav-sub a[data-nav="growth-partnership"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('every nav + footer link on the served page resolves 200 locally', async ({ page }) => {
    await page.goto('/index.html');
    const hrefs: string[] = await page.$$eval('header.nav a[href], footer.site a[href]', (as) =>
      as.map((a) => a.getAttribute('href')!)
    );
    const rules = parseRedirects();
    const targets = new Set<string>();
    for (const href of hrefs) {
      if (!href.startsWith('/')) continue; // no external/anchor links expected, asserted below
      targets.add(targetOf(rules, href) ?? href); // .html hrefs pass through
    }
    expect(hrefs.every((h) => h.startsWith('/') || h.startsWith('#'))).toBe(true);
    for (const t of targets) {
      const res = await page.request.get(t);
      expect(res.status(), `${t}`).toBe(200);
    }
  });

  test('aria-current is visible where stamped (styles.css active treatment)', async ({ page }) => {
    await page.goto('/pricing.html');
    const active = page.locator('.nav-links a[aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveText('Pricing');
  });

  for (const path of ['/index.html', '/pricing.html', '/services.html', '/tools.html']) {
    test(`console-clean boot: ${path}`, async ({ page }) => {
      const errors: string[] = [];
      // Third-party CDNs (fonts, consent-gated GA) are unreachable in the CI
      // sandbox; their load failures carry the URL in location(), not text().
      // Anything local (127.0.0.1) or script-thrown still fails the test.
      const external = /fonts\.googleapis|fonts\.gstatic|googletagmanager/;
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (external.test(msg.text()) || external.test(msg.location()?.url ?? '')) return;
        errors.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
      });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Live behavior — mobile drawer
// ---------------------------------------------------------------------------
test.describe('marketing nav (live, mobile)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile drawer behavior');
  });

  test('burger opens the drawer with all 6 slots + both actions', async ({ page }) => {
    await page.goto('/index.html');
    const burger = page.locator('.burger');
    await expect(burger).toBeVisible();
    await burger.click();
    await expect(page.locator('body')).toHaveClass(/mobile-open/);
    for (const key of ['pricing', 'how-it-works', 'industries', 'tools', 'about', 'services']) {
      await expect(page.locator(`.nav-links [data-nav="${key}"]`)).toBeVisible();
    }
    // At phone widths styles.css hides .nav-login by design — the footer's
    // Start column is the Client login home there. Book a free call stays.
    await expect(page.locator('.nav-actions a[href="/contact"]')).toBeVisible();
    await page.keyboard.press('Escape'); // close the drawer (it overlays the page)
    const footerLogin = page.locator('footer.site a[href="/portal"]');
    await footerLogin.scrollIntoViewIfNeeded();
    await expect(footerLogin).toBeVisible();
  });
});
