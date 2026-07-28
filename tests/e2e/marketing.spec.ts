import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  'industries.html', 'restaurant-web-design.html',
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
/**
 * Label-honesty pin (C6): every occurrence of `label` in the page (HTML
 * comments stripped) must sit inside an anchor — parsed attribute-order-
 * independently — whose href is exactly `dest`. Returns the occurrence count
 * so callers can assert the pin isn't vacuous. An occurrence outside any
 * parseable anchor fails loudly instead of silently skipping the check.
 */
function labelAnchorPin(html: string, f: string, label: RegExp, dest: string): number {
  const src = html.replace(/<!--[\s\S]*?-->/g, '');
  const anchors = [...src.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    href: m[1].match(/href="([^"]+)"/)?.[1] ?? null,
  }));
  let count = 0;
  for (const occ of src.matchAll(label)) {
    count++;
    const covering = anchors.find((a) => a.start <= occ.index! && occ.index! < a.end);
    expect(covering, `${f}: "${occ[0]}" not inside any parseable <a>`).toBeTruthy();
    expect(covering!.href, `${f}: "${occ[0]}" label destination`).toBe(dest);
  }
  return count;
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

  test('_redirects is well-formed: every rule parses, no status glued to its target, local .html targets exist', () => {
    // A missing separator ("/x.html200") silently parses as a redirect to a
    // nonexistent file with the default 301 — Netlify's parser accepts it
    // without error, so only this pin stands between a typo and a dead page.
    const lines = read('_redirects')
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      expect(parts.length, `"${line}": 2-3 whitespace-separated fields`).toBeGreaterThanOrEqual(2);
      expect(parts.length, `"${line}": 2-3 whitespace-separated fields`).toBeLessThanOrEqual(3);
      const [from, to, status] = parts;
      expect(from, `"${line}": source is a path`).toMatch(/^\//);
      expect(to, `"${line}": status glued to the target`).not.toMatch(/\.html\d/);
      if (status !== undefined) expect(status, `"${line}": valid status`).toMatch(/^\d{3}!?$/);
      if (/^\/[^*:]+\.html$/.test(to)) {
        expect(existsSync(join(ROOT, to.replace(/^\//, ''))), `"${line}": target file exists`).toBe(true);
      }
    }
  });

  test('_headers: every sitemap clean URL carries the explicit no-cache policy', () => {
    // The /*.html no-cache rule cannot match extensionless paths, so each
    // canonical clean URL needs its own entry — a page missing from the list
    // silently falls through to the cacheable /* rule and can serve
    // hour-stale content after a deploy (the /pricing gap, C7).
    const blocks = new Map<string, string>();
    let current: string | null = null;
    for (const raw of read('_headers').split('\n')) {
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      if (!/^\s/.test(raw)) { current = raw.trim(); blocks.set(current, ''); }
      else if (current) blocks.set(current, blocks.get(current)! + raw.trim() + '\n');
    }
    const locs = [...read('sitemap.xml').matchAll(/<loc>https:\/\/davisdigitalstudio\.com([^<]*)<\/loc>/g)]
      .map((m) => m[1] || '/');
    expect(locs.length).toBeGreaterThan(0);
    for (const path of locs) {
      expect(blocks.get(path)?.includes('no-cache'), `_headers: ${path} has a no-cache entry`).toBe(true);
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
    // C6: parsed attribute-order-independently, and every occurrence of the
    // label must resolve to a parseable anchor — a reordered or re-wrapped
    // link can no longer make the pin pass vacuously.
    let total = 0;
    for (const f of PAGES) {
      total += labelAnchorPin(read(f), f, /See what your site needs/g, '/audit');
    }
    expect(total, 'the label exists somewhere (pin is not vacuous)').toBeGreaterThan(0);
  });

  test('P4: contact.html no longer ships its page-scoped TOKEN flip (chrome stays canonical)', () => {
    // Honest scope: the sitewide dark remap (styles.css) and the tool bodies'
    // MS3-owned local skins still exist; 7 tool pages restate chrome dark rules
    // byte-identical to styles.css's (benign). What MS1 removed is contact's
    // inline token-flip STYLE BLOCK. contact.css now carries the two dark
    // SURFACE rules (review F1) so dark-OS visitors keep a legible form —
    // that file-level media query is expected and correct.
    expect(read('contact.html')).not.toContain('prefers-color-scheme');
    expect(read('contact.css')).toContain('prefers-color-scheme: dark');
    expect(read('contact.css')).toContain('#241d38');
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

// ============================================================
// MS2 — the money path (docs/design/MARKETING-SITE-OVERHAUL.md §MS2).
//
// One price truth, quoted identically at every depth. /pricing is canonical:
//   web design starts around $1,500 · Growth Partnership starts around $400
//   a month · paid audits from $99 (audit.html's own published tiers).
// These pins make the price-drift class regress-proof:
//   - PUBLISHED NUMBERS ONLY: no money page may carry an amount outside the
//     published set (the $850-retainer class of bug dies at grep level)
//   - one phrasing family ("starts around", never "starts at"/"from $400")
//   - label honesty: "Full pricing" may only ever land on /pricing
//   - every money page links /pricing in its own body, not just the chrome
//   - audit tiers labeled (free review vs paid audits from $99), one
//     credited-toward-a-full-project story
//   - ONE timeline (how-we-work's published FAQ ranges), the 45-day fork dies
//   - the single-closer rule: dark CTA -> footer, nothing interactive between
// ============================================================

// The money pages (MS2's file set — the funnel's price-bearing surfaces).
const MONEY_PAGES = [
  'services.html', 'web-design.html', 'seo-strategy.html',
  'monthly-retainer.html', 'audit.html', 'pricing.html',
];
// Every price published anywhere on the money path. /pricing owns the first
// two; audit.html's tier table owns the rest. Anything else is an invention.
const PUBLISHED_AMOUNTS = new Set(['$1,500', '$400', '$99', '$499', '$899']);

const mainOf = (html: string, f: string): string => {
  const start = html.indexOf('<main');
  const end = html.indexOf('</main>');
  if (start < 0 || end < 0) throw new Error(`${f}: no <main> region`);
  return html.slice(start, end);
};

test.describe('MS2 money path (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  test('published numbers only: no money page carries an amount outside the published set', () => {
    for (const f of MONEY_PAGES) {
      for (const m of read(f).matchAll(/\$\d{1,3}(?:,\d{3})*(?:\.\d+)?/g)) {
        expect(PUBLISHED_AMOUNTS.has(m[0]), `${f}: "${m[0]}" is not a published price`).toBe(true);
      }
    }
  });

  test('one phrasing family: every $1,500 and $400 reads "starts around", never "starts at" / bare "From"', () => {
    for (const f of MONEY_PAGES) {
      const html = read(f);
      // the contradicting families die outright
      expect(html, `${f}: "starts at" contradicts /pricing's "starts around"`).not.toMatch(/starts? at \$/i);
      expect(html, `${f}: bare "From $400" contradicts /pricing's "starts around $400"`).not.toMatch(/from \$400/i);
      for (const m of html.matchAll(/\$(?:1,500|400)/g)) {
        const ctx = html.slice(Math.max(0, m.index! - 160), m.index! + 160);
        expect(
          /start(?:s|ing)? around/i.test(ctx),
          `${f} @${m.index}: "${m[0]}" outside the "starts around" family:\n…${ctx}…`
        ).toBe(true);
      }
      // $400 is always a monthly number, said so in the same breath
      for (const m of html.matchAll(/\$400/g)) {
        const ctx = html.slice(m.index!, m.index! + 120);
        expect(/(a month|\/month)/i.test(ctx), `${f} @${m.index}: $400 without its "/month" cadence`).toBe(true);
      }
    }
  });

  test('label honesty: a "Full pricing" label may only land on /pricing', () => {
    // C6: same parse-robust pin — attribute order and nested <span>s can't
    // exempt a link, and a non-anchor occurrence fails instead of skipping.
    for (const f of MONEY_PAGES) {
      labelAnchorPin(read(f), f, /Full pricing/gi, '/pricing');
    }
  });

  test('every money page links /pricing in its own body; /pricing cross-quotes the audit tiers', () => {
    for (const f of MONEY_PAGES.filter((p) => p !== 'pricing.html')) {
      expect(mainOf(read(f), f).includes('href="/pricing"'), `${f}: in-body /pricing link`).toBe(true);
    }
    const pmain = mainOf(read('pricing.html'), 'pricing.html');
    expect(pmain, 'pricing: audits quoted from their source').toMatch(/audits from \$99/i);
    expect(pmain, 'pricing: links the audit tiers').toContain('href="/audit#pricing"');
    // the honest standalone-SEO answer: no invented number, a real link instead
    expect(pmain, 'pricing: answers the SEO cost question').toContain('href="/seo-strategy"');
  });

  test('audit tiers labeled: free review vs paid audits from $99, one credited-toward story', () => {
    const html = read('audit.html');
    const main = mainOf(html, 'audit.html');
    // the four tiers, named, in the published order
    for (const name of ['Site Score', 'Starter Audit', 'Digital Health Check', 'Competitive Intelligence']) {
      expect(main, `audit tier named: ${name}`).toContain(name);
    }
    expect(main, 'free tier labeled Free').toMatch(/tier-badge free">\s*Free/);
    expect(main, 'the free/paid split is stated, not implied').toMatch(/paid audits from \$99/i);
    // ONE credit story: "a full project" (the FAQ's own words) — the
    // "full redesign" variant contradicted it on the same page
    expect(html, 'no "credited toward a full redesign" fork').not.toContain('credited toward a full redesign');
    expect(html, 'credit fact stated in its canonical form').toContain('credited toward a full project');
    // the in-body /contact drain stays (the one-way funnel exit stays closed)
    expect(main, 'in-body /contact link').toContain('href="/contact"');
  });

  test('one timeline: web-design quotes how-we-work\'s published FAQ range; the 45-day fork dies', () => {
    const wd = read('web-design.html');
    expect(wd, 'no 45-day claim').not.toMatch(/45[- ]day/i);
    const range = /4(?:&ndash;|–|–)6 weeks/;
    expect(wd, 'web-design quotes the published custom-build range').toMatch(range);
    expect(read('how-we-work.html'), 'the range is how-we-work\'s own published number').toMatch(range);
  });

  test('price-story truth: no absolute "no SEO price anywhere" claim; the $499 upsell sells only $499 content', () => {
    // C1: the estimator publishes a standalone "SEO Strategy $800" add-on
    // (its catalog framing is flagged for Eric, not silently rewritten), so
    // an absolute "you won't find one anywhere on this site" clause on
    // /pricing is falsified one click away. seo-strategy.html's softer
    // phrasing ("There's no separate SEO price list") is the defensible form.
    expect(read('pricing.html'), 'pricing: absolute SEO-price claim').not.toMatch(/anywhere on this site/i);
    // C2: competitor analysis is exclusively the $899 Competitive
    // Intelligence tier (audit.html's tier table, buy-audit's TIERS catalog,
    // and the schema.org offers all agree). The free-score upsell sells the
    // $499 Digital Health Check and may not promise competitor work.
    const upsell = read('audit.html').match(/goes 10x deeper[^']*/)?.[0] ?? '';
    expect(upsell, 'audit: free-score upsell copy found').toBeTruthy();
    expect(upsell, 'audit: the $499 upsell may not promise the $899 tier\'s competitor work').not.toMatch(/competitor/i);
  });

  test('monthly-retainer font loading matches index (preload + async swap + noscript)', () => {
    const html = read('monthly-retainer.html');
    expect(html).toMatch(/<link rel="preload" href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" as="style" onload=/);
    expect(html).toContain('<noscript><link href="https://fonts.googleapis.com/css2');
  });
});

// ============================================================
// MS4 — one story (docs/design/MARKETING-SITE-OVERHAUL.md §MS4, P1).
//
// the-experience.html retired into /how-we-work: its three additive
// beats (02 one place / 03 approvals / 05 money) + the pmock workspace
// figure moved over verbatim; everything else on it was duplicate.
// /the-experience and /the-experience.html 301 to /how-we-work, and no
// source file may reference the retired URL again.
// ============================================================
test.describe('MS4 one story (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  test('the-experience is gone from disk (page + its page-only stylesheet)', () => {
    expect(existsSync(join(ROOT, 'the-experience.html')), 'the-experience.html deleted').toBe(false);
    expect(existsSync(join(ROOT, 'the-experience.css')), 'the-experience.css deleted').toBe(false);
  });

  test('_redirects: /the-experience and /the-experience.html 301 to /how-we-work; the 200 rule is gone', () => {
    const rules = parseRedirects();
    for (const from of ['/the-experience', '/the-experience.html']) {
      const matching = rules.filter((x) => x.from === from);
      expect(matching, `${from}: exactly one rule (nothing shadows the 301)`).toHaveLength(1);
      expect(matching[0].to, `${from} -> /how-we-work`).toBe('/how-we-work');
      expect(matching[0].code, `${from} is a permanent redirect`).toBe('301');
    }
    // the 301 lands on a clean URL that itself resolves to a real file
    const to = targetOf(rules, '/how-we-work');
    expect(to && existsSync(join(ROOT, to.replace(/^\//, ''))), '301 chain resolves to a real file').toBe(true);
  });

  test('no source file references the-experience anymore (outside _redirects)', () => {
    // root-level pages, scripts, styles, and the sitemap — the whole published
    // surface. _redirects (the 301s) is the only place the old URL may live.
    const files = readdirSync(ROOT).filter((f) => /\.(html|js|css|xml)$/.test(f));
    for (const f of files) {
      expect(read(f).includes('the-experience'), `${f}: references the retired the-experience URL`).toBe(false);
    }
  });

  test('how-we-work carries the merged story: the three beats + the workspace figure', () => {
    const html = read('how-we-work.html');
    const main = mainOf(html, 'how-we-work.html');
    // the three absorbed beats (the-experience's 02/03/05), moved verbatim
    expect(main, 'beat: one place').toContain('Everything lives in one place.');
    expect(main, 'beat: approvals').toContain('Reviewing and approving work is simple.');
    expect(main, 'beat: money').toContain('Money is clear, never awkward.');
    // the pmock workspace figure + its caption
    expect(main, 'pmock figure moved over').toContain('class="pmock"');
    expect(main, 'figure caption moved over').toContain('This is what you see when you log in');
    expect(html, 'portal-mock.css loaded for the figure').toContain('href="portal-mock.css"');
    // the not-a-step step 04 is deleted (its self-referential link died with it)
    expect(main, 'step 04 deleted').not.toContain('See exactly what that looks like');
    // still exactly ONE dark closer on the merged page
    expect(main.match(/panel-dark|cta-band/g)?.length, 'one dark closer').toBe(1);
  });
});

// ============================================================
// MS5 — industries family templatization (docs/design/MARKETING-SITE-OVERHAUL.md §MS5).
//
// The five landers shipped an ~80%-identical hand-copied shell — the same
// drift class MS1 killed for the chrome. The shell (approach head, the
// "organized and effortless" ethos, Explore chips, soft-capture, closer)
// now propagates from scripts/industry-shell.template.html via
// scripts/sync-industry-shell.mjs into delimited regions; the unique
// content (lede, approach paragraph, bullets, FAQs — the real substance)
// stays per-page. The double closer collapsed to the standard
// soft-capture -> ONE dark CTA -> footer, the soft-capture band is MS3's
// tokenized component (tool-page.css — built once, reused here), and the
// generalized pill/purple scan extends to this family. Written red-first
// against the pre-MS5 pages.
// ============================================================
const INDUSTRY_LANDERS = [
  'restaurant-web-design.html', 'salon-web-design.html', 'retail-web-design.html',
  'home-services-web-design.html', 'health-wellness-web-design.html',
];
const INDUSTRY_FAMILY = ['industries.html', ...INDUSTRY_LANDERS];
const SHELL_REGIONS = [
  'dds-industry-approach-head', 'dds-industry-ethos', 'dds-industry-explore',
  'dds-industry-capture', 'dds-industry-closer',
];
// the ONLY tolerated variance in the shell: the closer's stamped industry phrase
const normalizeShell = (block: string) =>
  block.replace(/obvious choice for (?:\{\{industry\}\}|[^<?]+)\?/, 'obvious choice for X?');

test.describe('MS5 industries family (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  test('sync-industry-shell --check passes (committed landers == canonical shell template)', () => {
    execFileSync('node', ['scripts/sync-industry-shell.mjs', '--check'], { cwd: ROOT });
  });

  test('the shell is template-generated: all five regions on every lander, byte-identical to the template (industry phrase normalized)', () => {
    const tpl = read('scripts/industry-shell.template.html');
    for (const name of SHELL_REGIONS) {
      const canon = normalizeShell(region(tpl, name, 'template'));
      for (const f of INDUSTRY_LANDERS) {
        expect(normalizeShell(region(read(f), name, f)), `${f} region ${name}`).toBe(canon);
      }
    }
  });

  test('no pills, no literal purple: the generalized scan extends to the industries family (incl. linked css)', () => {
    // Same scan as marketing-tools.spec.ts (C4): pill-scale radii and literal
    // purple fail in every family source plus every page-local linked css —
    // the Explore chips' 100px pills and the inline-hex soft capture die here.
    const SANCTIONED_SHARED = new Set(['styles.css', 'enhance.css']);
    const sources = new Map<string, string>();
    for (const f of INDUSTRY_FAMILY) {
      const html = read(f);
      sources.set(f, html);
      for (const m of html.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)) {
        const href = m[1];
        if (/^https?:/.test(href)) continue;
        const css = href.replace(/^\//, '');
        if (!SANCTIONED_SHARED.has(css)) sources.set(css, read(css));
      }
    }
    for (const [name, raw] of sources) {
      const src = raw
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<meta name="theme-color"[^>]*>/g, '');
      for (const decl of src.matchAll(/border-radius:([^;}"']*)/gi)) {
        for (const t of decl[1].matchAll(/([\d.]+)(px|r?em)/g)) {
          const limit = t[2] === 'px' ? 40 : 3;
          expect(parseFloat(t[1]), `${name}: pill-scale border-radius "${decl[0].trim()}"`).toBeLessThan(limit);
        }
      }
      expect(src, `${name}: literal purple hex outside the token system`).not.toMatch(/#5b3fa0\b/i);
      expect(src, `${name}: literal purple rgb outside the token system`).not.toMatch(/rgb\(\s*91\s*,\s*63\s*,\s*160\s*\)/);
    }
  });

  test('soft-capture is MS3\'s tokenized component on every lander — the inline-hex copy is dead', () => {
    for (const f of INDUSTRY_LANDERS) {
      const html = read(f);
      expect(html, `${f}: inline-hex soft capture`).not.toContain('#EDE8F7');
      expect(html, `${f}: .soft-capture component`).toContain('soft-capture');
      // the component's home loads, after the token owner
      expect(html.indexOf('href="tool-page.css"'), `${f}: tool-page.css loads after styles.css`).toBeGreaterThan(
        html.indexOf('href="styles.css"')
      );
    }
  });

  test('single closer: on every industry page the dark CTA is the last section, soft-capture above it', () => {
    for (const f of INDUSTRY_FAMILY) {
      const html = read(f);
      const darkBands = html.match(/<section\b[^>]*class="[^"]*\b(?:panel-dark|cta-band)\b[^"]*"/g) || [];
      expect(darkBands.length, `${f}: exactly one dark band <section>`).toBe(1);
      const last = html.lastIndexOf('<section');
      expect(html.slice(last, last + 120), `${f}: the dark closer is the last section`).toContain('panel-dark');
      if (f !== 'industries.html') {
        expect(html.indexOf('soft-capture'), `${f}: soft-capture sits above the closer`).toBeLessThan(
          html.indexOf('panel-dark')
        );
      }
    }
  });

  test('industries.html: the one-line process bridge — the hub click lands a step from /how-we-work', () => {
    const main = mainOf(read('industries.html'), 'industries.html');
    expect(main, 'the bridge names the shared process').toMatch(/same process/i);
    expect(main, 'the bridge links /how-we-work in the body').toContain('href="/how-we-work"');
  });

  test('health-wellness: the unsubstantiated "private" intake bullet is softened to the page\'s own published framing', () => {
    const html = read('health-wellness-web-design.html');
    // "private" implied a security/compliance promise nothing on the site
    // backs; the page's own FAQ answer ("simple", "without friction") is the
    // honest form ("calm" lives in the adjacent pre-existing bullet already).
    expect(html, 'the "private" claim is gone').not.toMatch(/simple and private/i);
    expect(html, 'softened to the FAQ\'s published phrasing').toContain('simple, without friction');
  });
});

// ============================================================
// MS4 leftovers, folded into MS5 per the punchlist: about.html
// (doc §MS4 2-3). The origin story, beliefs, and signature stay whole;
// the near-duplicate 4-card workspace grid (redundant with index's
// master grid + the merged /how-we-work beats) is trimmed, and the
// "Not credentials" framing stops contradicting the credentials the
// same page leans on.
// ============================================================
test.describe('MS5 about.html leftovers (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  test('the near-duplicate 4-card workspace grid is trimmed to one founder-direct beat + a /how-we-work link', () => {
    const main = mainOf(read('about.html'), 'about.html');
    // the duplicated cards are gone (index keeps the master grid;
    // /how-we-work carries the merged beats)
    for (const card of [
      'One person, start to finish', 'Clear expectations, in plain language',
      'Everything in one project workspace', 'You approve every decision',
    ]) {
      expect(main, `about: duplicated card "${card}"`).not.toContain(card);
    }
    // the About-specific point (founder-direct) stays, and hands off to the
    // page that owns the day-to-day story
    expect(main, 'founder-direct beat kept').toContain('No account managers');
    const section = main.match(/<section[^>]*>(?:(?!<\/section>)[\s\S])*No account managers[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section, 'the trimmed section hands off to /how-we-work').toContain('href="/how-we-work"');
  });

  test('"Not credentials" framing squared with the credentials the page leans on', () => {
    const html = read('about.html');
    const main = mainOf(html, 'about.html');
    expect(main, 'the self-contradicting "Not credentials." lede is gone').not.toContain('Not credentials.');
    // the honest form: the credentials are owned, then subordinated to the beliefs
    expect(main, 'the lede owns the credentials it later cites').toMatch(/nearly a decade/i);
    // kept whole per the doc: origin story + beliefs + signature
    expect(main, 'origin story kept').toContain('Why I started this.');
    expect(main, 'beliefs kept').toContain('Three beliefs I don\'t compromise on');
    expect(main, 'signature moment kept').toContain('refuse to do to a client');
  });
});

// ============================================================
// MS6 — entry & legal sweep (docs/design/MARKETING-SITE-OVERHAUL.md §MS7,
// built as MS6 per the approved build order — Results was footer-demoted
// in MS1 per P3, so the doc's §MS6 slice shipped early and the entry/legal
// sweep moved up a slot).
//
// Three jobs, written red-first against the pre-MS6 pages:
//   1. The LAST inline-hex (#EDE8F7/#5b3fa0) 100px-pill soft-capture
//      copies die. The punchlist recorded services + web-design; the
//      red-first estate sweep found the SAME byte-identical band on
//      pricing, seo-strategy, and monthly-retainer — all five join the
//      tokenized .soft-capture component (and the styles.css
//      div[style*="background:#EDE8F7"] dark shims that served the inline
//      copies went with them), and the generalized pill/purple scan
//      extends over them.
//   2. The legal set (privacy/terms/accessibility/ai-disclaimer) rides ONE
//      legal template: styles.css tokens only, no page <style> forks, no
//      dark closer (legal pages end content -> footer). ai-disclaimer was
//      the last purple-template survivor — a page-scoped :root fork, a
//      100px pill badge, a dark legal-hero, and stray-brace CSS that
//      trapped its dark-mode variant inside a <=900px media query.
//      VISUAL/STRUCTURAL ONLY: the legal copy itself is Eric's
//      (docs/design/LEGAL-DRAFTS-166.md) and is pinned UNCHANGED here.
//   3. Ghost sweep (doc §MS7 1-2): start.html + contact-disclaimer.html
//      deleted from disk (their 301s already do the job); the internal
//      pages (email-signature, styleguide, a11y) stop glob-shipping in
//      the public build and their URLs force-404.
// ============================================================
const MS6_CAPTURE_PAGES = [
  'services.html', 'web-design.html', 'pricing.html', 'seo-strategy.html', 'monthly-retainer.html',
];
const LEGAL_PAGES = ['privacy.html', 'terms.html', 'accessibility.html', 'ai-disclaimer.html'];
const MS6_FAMILY = [...MS6_CAPTURE_PAGES, ...LEGAL_PAGES, '404.html'];
const INTERNAL_PAGES = ['email-signature.html', 'styleguide.html', 'a11y.html'];

test.describe('MS6 entry & legal sweep (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  test('no pills, no literal purple: the generalized scan extends to the entry/legal estate (incl. linked css)', () => {
    // Same scan as marketing-tools.spec.ts (C4) / the MS5 family scan —
    // pill-scale radii and literal purple fail in every estate source plus
    // every page-local linked css. This is where services/web-design's
    // 100px-pill captures and ai-disclaimer's purple-template <style> die.
    // portal-mock.css joins the sanctioned shared layers: it is the
    // decorative miniature of the CLIENT APP's UI (its own --pm-* palette,
    // drawn as an illustration of a different product surface, blessed
    // verbatim in MS4) — not marketing styling.
    const SANCTIONED_SHARED = new Set(['styles.css', 'enhance.css', 'portal-mock.css']);
    const sources = new Map<string, string>();
    for (const f of MS6_FAMILY) {
      const html = read(f);
      sources.set(f, html);
      for (const m of html.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)) {
        const href = m[1];
        if (/^https?:/.test(href)) continue;
        const css = href.replace(/^\//, '');
        if (!SANCTIONED_SHARED.has(css)) sources.set(css, read(css));
      }
    }
    for (const [name, raw] of sources) {
      const src = raw
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<meta name="theme-color"[^>]*>/g, '');
      for (const decl of src.matchAll(/border-radius:([^;}"']*)/gi)) {
        for (const t of decl[1].matchAll(/([\d.]+)(px|r?em)/g)) {
          const limit = t[2] === 'px' ? 40 : 3;
          expect(parseFloat(t[1]), `${name}: pill-scale border-radius "${decl[0].trim()}"`).toBeLessThan(limit);
        }
      }
      expect(src, `${name}: literal purple hex outside the token system`).not.toMatch(/#5b3fa0\b/i);
      expect(src, `${name}: literal purple rgb outside the token system`).not.toMatch(/rgb\(\s*91\s*,\s*63\s*,\s*160\s*\)/);
    }
  });

  test('soft-capture is MS3\'s tokenized component on every money page that carries one — the LAST inline-hex copies are dead', () => {
    for (const f of MS6_CAPTURE_PAGES) {
      const html = read(f);
      expect(html, `${f}: inline-hex soft capture`).not.toContain('#EDE8F7');
      expect(html, `${f}: .soft-capture component`).toContain('soft-capture');
      // the component's home loads, after the token owner
      expect(html.indexOf('href="tool-page.css"'), `${f}: tool-page.css loads after styles.css`).toBeGreaterThan(
        html.indexOf('href="styles.css"')
      );
      // the capture keeps its function: the same GET-to-/audit form,
      // optional email and all — a reskin, not a rewrite
      const capture = html.match(/<section[^>]*soft-capture[\s\S]*?<\/section>/)?.[0] ?? '';
      expect(capture, `${f}: capture form still GETs /audit`).toMatch(/<form action="\/audit" method="get">/);
      expect(capture, `${f}: optional email field kept`).toContain('aria-label="Your email (optional)"');
      // and it still sits ABOVE the one dark closer (nothing interactive
      // after the closer — the live MS2 single-closer pin enforces the rest)
      expect(html.indexOf('soft-capture'), `${f}: capture above the closer`).toBeLessThan(html.indexOf('panel-dark'));
    }
    // nothing anywhere on the marketing estate paints the inline-hex band now
    // (audit.html's page-local :root still DECLARES the hex as a token value —
    // a pre-existing MS2-era fork outside this slice's fence, flagged)
    for (const f of PAGES) {
      expect(read(f), `${f}: inline-hex capture band survivor`).not.toContain('background:#EDE8F7');
    }
    // and styles.css no longer needs its inline-capture dark shims
    expect(read('styles.css'), 'dead div[style*=EDE8F7] dark shim').not.toContain('div[style*="background:#EDE8F7"]');
  });

  test('the legal set rides ONE legal template: token styling only, standard hero, no dark closer, no page forks', () => {
    for (const f of LEGAL_PAGES) {
      const html = read(f);
      // styles.css owns every token and both schemes — a legal page carries
      // no <style> block, no :root fork, no page-scoped scheme flip
      expect(html, `${f}: page-scoped <style> block`).not.toContain('<style');
      expect(html, `${f}: page-scoped prefers-color-scheme`).not.toContain('prefers-color-scheme');
      // the template anatomy: light hero (eyebrow + one h1), then content
      const main = mainOf(html, f);
      expect(main, `${f}: standard light hero`).toContain('<section class="hero">');
      expect(main, `${f}: hero eyebrow`).toContain('class="eyebrow reveal"');
      expect(html.match(/<h1[\s>]/g)?.length, `${f}: exactly one h1`).toBe(1);
      // legal pages end content -> footer: NO dark band of any anatomy
      expect(html.match(/panel-dark|cta-band|legal-hero/g), `${f}: dark band on a legal page`).toBeNull();
      // references resolve on the clean-URL system, not legacy .html spellings
      expect(main, `${f}: legacy portal-terms.html spelling`).not.toContain('href="portal-terms.html"');
    }
  });

  test('ai-disclaimer: rebuilt on the legal template with its legal substance UNCHANGED (Eric owns the words)', () => {
    const html = read('ai-disclaimer.html');
    const main = mainOf(html, 'ai-disclaimer.html');
    // the purple-template anatomy is dead (the :root fork, the pill badge,
    // and the stray-brace CSS that trapped dark mode are all in the killed
    // <style> block — pinned structurally above; the class names go too)
    for (const ghost of ['legal-hero', 'legal-summary', 'class="updated"', 'concierge.js', 'hero-grid.css']) {
      expect(html, `ai-disclaimer: purple-template remnant "${ghost}"`).not.toContain(ghost);
    }
    // the legal substance is retained verbatim — every section, the date,
    // and the operative sentences (visual conformance only; content is
    // docs/design/LEGAL-DRAFTS-166.md territory)
    expect(main, 'date line kept').toContain('Last updated: June 25, 2026');
    for (const h of ['Informational Only', 'No Warranty', 'No Guarantees of Outcomes',
      'What We Send to the AI', 'Third-Party Sites', 'Limitation of Liability', 'Contact']) {
      expect(main, `section kept: ${h}`).toContain(`>${h}</h2>`);
    }
    for (const sentence of [
      'provided for general informational purposes only',
      'no warranty of accuracy, completeness, or fitness for a particular purpose',
      'does not ensure any specific result',
      'Do not submit confidential information through the AI Tools',
      'not a statement of fact about that business',
      'not liable for any loss or damage arising from use of',
    ]) {
      expect(main, `operative sentence kept: "${sentence}"`).toContain(sentence);
    }
    // its in-body privacy link survives the rebuild
    expect(main, 'privacy link kept').toContain('href="/privacy"');
  });

  test('entry pages load fonts the index way: preload + async swap + noscript (404 was blocking; ai-disclaimer nested its noscript)', () => {
    for (const f of ['404.html', 'ai-disclaimer.html']) {
      const html = read(f);
      expect(html, `${f}: font preload`).toMatch(
        /<link rel="preload" href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" as="style" onload=/
      );
      expect(html, `${f}: noscript fallback`).toContain('<noscript><link href="https://fonts.googleapis.com/css2');
      expect(html, `${f}: nested noscript`).not.toMatch(/<noscript>[^<]*<link rel="preload"/);
    }
  });

  test('ghost files are OFF DISK; their .html spellings 301 with the clean URLs (doc §MS7.1)', () => {
    // /start and /contact-disclaimer 301s are pinned above (MS1); the files
    // themselves were live unmonitored duplicates — now the redirect is the
    // only thing that answers, in both spellings.
    expect(existsSync(join(ROOT, 'start.html')), 'start.html deleted').toBe(false);
    expect(existsSync(join(ROOT, 'contact-disclaimer.html')), 'contact-disclaimer.html deleted').toBe(false);
    const rules = parseRedirects();
    const r301 = (from: string) => rules.find((x) => x.from === from && x.code === '301');
    expect(r301('/start.html')?.to, '/start.html 301').toBe('/contact');
    expect(r301('/contact-disclaimer.html')?.to, '/contact-disclaimer.html 301').toBe('/privacy');
    // no source file references the ghosts anymore (outside _redirects)
    const files = readdirSync(ROOT).filter((f) => /\.(html|js|css|xml)$/.test(f));
    for (const f of files) {
      expect(read(f).includes('contact-disclaimer'), `${f}: references the deleted contact-disclaimer`).toBe(false);
      expect(read(f).includes('start.html'), `${f}: references the deleted start.html`).toBe(false);
    }
  });

  test('the public build excludes the internal pages; their URLs force-404 (doc §MS7.2)', () => {
    // email-signature (mail-provider setup steps), styleguide (internal
    // design instructions), and a11y (an internal check page) were
    // guessable-URL public because the build glob-ships every root *.html.
    // The build is the truth here, so RUN it and inspect dist/ — a comment
    // in the script can't drift a green test.
    execFileSync('bash', ['scripts/build-public.sh'], { cwd: ROOT });
    for (const f of INTERNAL_PAGES) {
      expect(existsSync(join(ROOT, 'dist', f)), `${f} staged into dist/`).toBe(false);
    }
    // ...while the public estate still ships (fail-visible, not fail-open)
    for (const f of ['index.html', 'privacy.html', '404.html', 'services.html']) {
      expect(existsSync(join(ROOT, 'dist', f)), `${f} missing from dist/`).toBe(true);
    }
    // _redirects force-404s both spellings as defense-in-depth (the files
    // also physically no longer exist in the publish dir)
    const rules = parseRedirects();
    for (const page of INTERNAL_PAGES) {
      const clean = '/' + page.replace(/\.html$/, '');
      for (const from of [clean, `${clean}.html`]) {
        const r = rules.find((x) => x.from === from);
        expect(r?.to, `${from} forced 404 target`).toBe('/404.html');
        expect(r?.code, `${from} forced 404 status`).toBe('404!');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// MS6 — live behavior (desktop)
// ---------------------------------------------------------------------------
test.describe('MS6 entry & legal sweep (live, desktop)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop behavior');
  });

  test('the tokenized capture renders on both service pages: p-mist band, ink button, light-scheme AA', async ({ page }) => {
    for (const f of MS6_CAPTURE_PAGES) {
      await page.goto(`/${f}`);
      const band = page.locator('.soft-capture');
      await expect(band, `${f}: one capture band`).toHaveCount(1);
      expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor), `${f}: p-mist token`).toBe('rgb(237, 232, 247)');
      expect(await band.locator('form button').evaluate((el) => getComputedStyle(el).borderRadius), `${f}: ink button, not a pill`).toBe('2px');
      expect(await contrastOf(page, '.soft-capture h2'), `${f}: capture heading (large)`).toBeGreaterThanOrEqual(3);
      expect(await contrastOf(page, '.soft-capture p'), `${f}: capture copy`).toBeGreaterThanOrEqual(4.5);
    }
  });

  for (const path of ['/ai-disclaimer.html', '/privacy.html', '/accessibility.html', '/404.html']) {
    test(`console-clean boot: ${path}`, async ({ page }) => {
      const errors: string[] = [];
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
// MS5 — live behavior (desktop)
// ---------------------------------------------------------------------------
test.describe('MS5 industries family (live, desktop)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop behavior');
  });

  // Single-closer rule, live: nothing interactive between the dark CTA and
  // the footer (the old anatomy parked the capture form exactly there).
  for (const f of INDUSTRY_FAMILY) {
    test(`single closer: ${f} ends dark CTA -> footer`, async ({ page }) => {
      await page.goto(`/${f}`);
      const result = await page.evaluate(() => {
        const closers = [...document.querySelectorAll('main section.panel-dark, main section.cta-band')];
        const footer = document.querySelector('footer.site');
        if (!footer) return { closers: closers.length, offenders: ['no footer'] };
        const last = closers[closers.length - 1];
        if (!last) return { closers: 0, offenders: ['no dark closer'] };
        const offenders = [...document.querySelectorAll('a[href], button, form, input, select, textarea')]
          .filter(
            (el) =>
              !last.contains(el) &&
              !footer.contains(el) &&
              last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
              el.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
          )
          .map((el) => `${el.tagName}:${(el.textContent || (el as HTMLElement).getAttribute?.('aria-label') || '').trim().slice(0, 40)}`);
        return { closers: closers.length, offenders };
      });
      expect(result.closers, `${f}: exactly one dark closer`).toBe(1);
      expect(result.offenders, `${f}: nothing interactive between the closer and the footer`).toEqual([]);
    });
  }

  test('lander shell renders tokenized: soft-capture on --p-mist, ink chips (not pills), light-scheme contrast holds', async ({ page }) => {
    await page.goto('/salon-web-design.html');
    const band = page.locator('.soft-capture');
    await expect(band).toHaveCount(1);
    expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor), 'p-mist token').toBe('rgb(237, 232, 247)');
    expect(await band.locator('form button').evaluate((el) => getComputedStyle(el).borderRadius), 'ink button, not a pill').toBe('2px');
    const chip = page.locator('.ind-chip').first();
    await expect(chip).toBeVisible();
    expect(await chip.evaluate((el) => getComputedStyle(el).borderRadius), 'chip radius is ink-scale').toBe('3px');
    // changed text pairs, light scheme
    expect(await contrastOf(page, '.ind-chip'), 'chip label').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.soft-capture h2'), 'capture heading (large)').toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, '.soft-capture p'), 'capture copy').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.feature-box .fb-list li'), 'feature bullets').toBeGreaterThanOrEqual(4.5);
  });

  for (const path of ['/industries.html', '/restaurant-web-design.html', '/health-wellness-web-design.html', '/about.html']) {
    test(`console-clean boot: ${path}`, async ({ page }) => {
      const errors: string[] = [];
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
// MS2 — live behavior (desktop)
// ---------------------------------------------------------------------------
test.describe('MS2 money path (live, desktop)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop behavior');
  });

  // Single-closer rule: each money page has exactly ONE dark closer, and
  // nothing interactive stands between it and the footer — the funnel's last
  // beat is the closer, not a gauntlet.
  for (const f of MONEY_PAGES) {
    test(`single closer: ${f} ends dark CTA -> footer`, async ({ page }) => {
      await page.goto(`/${f}`);
      const result = await page.evaluate(() => {
        const closers = [...document.querySelectorAll('main section.panel-dark, main section.cta-band')];
        const footer = document.querySelector('footer.site');
        if (!footer) return { closers: closers.length, offenders: ['no footer'] };
        const last = closers[closers.length - 1];
        if (!last) return { closers: 0, offenders: ['no dark closer'] };
        const offenders = [...document.querySelectorAll('a[href], button, form, input, select, textarea')]
          .filter(
            (el) =>
              !last.contains(el) &&
              !footer.contains(el) &&
              last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
              el.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
          )
          .map((el) => `${el.tagName}:${(el.textContent || (el as HTMLElement).getAttribute?.('aria-label') || '').trim().slice(0, 40)}`);
        return { closers: closers.length, offenders };
      });
      expect(result.closers, `${f}: exactly one dark closer`).toBe(1);
      expect(result.offenders, `${f}: nothing interactive between the closer and the footer`).toEqual([]);
    });
  }

  test('the services price journey: "See pricing" lands on real pricing', async ({ page }) => {
    await page.goto('/services.html');
    const main = page.locator('main');
    // the retargeted button: an in-body pricing link that means what it says
    const seePricing = main.locator('a[href="/pricing"]').first();
    await expect(seePricing).toBeVisible();
    // no button in the body promises "Full pricing" from a page that lacks it
    for (const href of await main
      .locator('a', { hasText: /Full pricing/i })
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
      expect(href, 'services: Full-pricing label destination').toBe('/pricing');
    }
    // the destination really is the money page (local server: resolve the
    // clean URL through the parsed _redirects rule, as MS1's tests do)
    const rules = parseRedirects();
    await page.goto(targetOf(rules, '/pricing')!);
    await expect(page.locator('main')).toContainText('New sites start around $1,500 depending on scope');
    await expect(page.locator('main')).toContainText('$400');
  });

  for (const f of ['web-design.html', 'seo-strategy.html']) {
    test(`reveal wiring restored: ${f} runs the .js-anim gate`, async ({ page }) => {
      await page.goto(`/${f}`);
      await expect(page.locator('html')).toHaveClass(/js-anim/);
      // at least one reveal actually resolves to visible
      await expect(page.locator('.reveal.in').first()).toBeVisible({ timeout: 10_000 });
    });
  }

  for (const path of ['/web-design.html', '/seo-strategy.html', '/monthly-retainer.html', '/audit.html']) {
    test(`console-clean boot: ${path}`, async ({ page }) => {
      const errors: string[] = [];
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
// MS2 — live behavior (mobile)
// ---------------------------------------------------------------------------
test.describe('MS2 money path (live, mobile)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile behavior');
  });

  test('pricing renders the whole price story on a phone: both offers, audits row, one closer', async ({ page }) => {
    await page.goto('/pricing.html');
    const main = page.locator('main');
    await expect(main).toContainText('New sites start around $1,500 depending on scope');
    await expect(main.getByText('$1,500', { exact: false }).first()).toBeVisible();
    await expect(main).toContainText(/audits from \$99/i);
    await expect(main.locator('a[href="/audit#pricing"]')).toBeVisible();
    const closerCount = await page.evaluate(
      () => document.querySelectorAll('main section.panel-dark, main section.cta-band').length
    );
    expect(closerCount).toBe(1);
  });
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

// ---------------------------------------------------------------------------
// Dark scheme — the styles.css sitewide remap flips the shared tokens; these
// pins measure the chrome/closer pairs the MS2+MS3 review found failing (P9)
// so they can't regress. WCAG helpers mirror marketing-tools.spec.ts.
// ---------------------------------------------------------------------------
function wcag(fg: string, bg: string): number {
  const lum = (c: string) => {
    const [r, g, b] = (c.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).slice(0, 3).map(Number);
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** min contrast across matches, vs the alpha-composited effective background */
async function contrastOf(page: Page, selector: string, pseudo?: string): Promise<number> {
  const pairs = await page.evaluate(([sel, ps]) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
    };
    return [...document.querySelectorAll(sel as string)].map((el) => {
      const stack: number[][] = [];
      let n: Element | null = el;
      while (n) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg && bg[3] > 0) { stack.push(bg); if (bg[3] >= 1) break; }
        n = n.parentElement;
      }
      let bg = [255, 255, 255];
      for (let i = stack.length - 1; i >= 0; i--) {
        const [r, g, b, a] = stack[i];
        bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
      }
      const fg4 = parse(getComputedStyle(el, (ps as string) || null).color)!;
      const fg = fg4[3] >= 1
        ? fg4.slice(0, 3)
        : [fg4[0] * fg4[3] + bg[0] * (1 - fg4[3]), fg4[1] * fg4[3] + bg[1] * (1 - fg4[3]), fg4[2] * fg4[3] + bg[2] * (1 - fg4[3])];
      return { fg, bg };
    });
  }, [selector, pseudo ?? null] as const);
  if (!pairs.length) throw new Error(`contrastOf: nothing matches "${selector}"`);
  return Math.min(...pairs.map((p) => wcag(`rgb(${p.fg.join(',')})`, `rgb(${p.bg.join(',')})`)));
}

// ============================================================
// Photos A — the repo-asset photo slots (docs/design/MARKETING-PHOTOS.md,
// Group A). Six slots, zero NEW imagery: the same real founder photo
// contact.html already ships lands beside every credential card ("who
// you're hiring" gets a literal face), About's origin story gets the
// three unused life/ candids, and Work's decisions intro gets the desk
// shot. The plan's honesty law ("real people on this site = the real
// founder only") isn't pinnable as an idea — but the touched sections
// CAN be pinned to reference nothing outside the known real-photo list,
// and every slot signs the anti-CLS contract (width/height + lazy +
// async — these all sit below the fold).
// ============================================================
const REAL_PHOTOS = new Set([
  // the founder, as already shipped on index/contact/about/how-we-work
  'eric-davis-small.jpg', 'eric-davis-hero-avatar.jpg',
  'eric-davis.jpg', 'eric-davis.webp',
  'eric-davis-founder.jpg', 'eric-davis-founder.webp',
  // the real life/ candids
  'life/eric-dog.jpg', 'life/eric-gym.jpg', 'life/eric-rome.jpg', 'life/eric-work.jpg',
]);
const imgAttrs = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
/** the contract every Group A photo signs: real asset, honest alt, no CLS, lazy */
function pinPhoto(tag: string | undefined, ctx: string, src: string, w: number, h: number): Record<string, string> {
  expect(tag, `${ctx}: <img> present`).toBeTruthy();
  const a = imgAttrs(tag!);
  expect(a.src, `${ctx}: src`).toBe(src);
  expect(a.alt, `${ctx}: honest alt text`).toBeTruthy();
  expect(+(a.width ?? NaN), `${ctx}: width attr`).toBe(w);
  expect(+(a.height ?? NaN), `${ctx}: height attr`).toBe(h);
  expect(a.loading, `${ctx}: below-the-fold loading`).toBe('lazy');
  expect(a.decoding, `${ctx}: decoding`).toBe('async');
  return a;
}
// the six touched sections, extracted the way each page anchors them —
// shared by the per-slot pins and the real-asset allowlist sweep below
const PHOTO_SLOTS: Record<string, () => string> = {
  'pricing.html § who-you\'re-hiring card': () =>
    read('pricing.html').match(/<div class="reveal mt-l"[^>]*paper-2[^>]*>[\s\S]*?<\/ul>\s*<\/div>/)?.[0] ?? '',
  'services.html § who-you\'re-hiring card': () =>
    read('services.html').match(/<div class="reveal mt-l"[^>]*paper-2[^>]*>[\s\S]*?<\/ul>\s*<\/div>/)?.[0] ?? '',
  'monthly-retainer.html § who-stays card': () =>
    read('monthly-retainer.html').match(/<div class="reveal" style="border:1px solid var\(--hair\);border-radius:18px[\s\S]*?<\/ul>/)?.[0] ?? '',
  'audit.html § trust strip': () =>
    read('audit.html').match(/<!-- TRUST STRIP -->[\s\S]*?<\/section>/)?.[0] ?? '',
  'about.html § origin section': () =>
    read('about.html').match(/<section class="pad ab-origin-section">[\s\S]*?<\/section>/)?.[0] ?? '',
  'work.html § decisions section': () =>
    read('work.html').match(/<section class="pad-sm wk-decisions-section">[\s\S]*?<\/section>/)?.[0] ?? '',
};

test.describe('Photos A — repo-asset slots (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  test('A1-A3: the credential cards carry the founder avatar — index\'s .hero-sig anatomy, label riding beside the face', () => {
    const CARDS: Array<[string, string]> = [
      ['pricing.html § who-you\'re-hiring card', "Who you're hiring"],
      ['services.html § who-you\'re-hiring card', "Who you're hiring"],
      ['monthly-retainer.html § who-stays card', 'Who stays on your account'],
    ];
    for (const [slot, label] of CARDS) {
      const card = PHOTO_SLOTS[slot]();
      expect(card, `${slot}: card found`).toBeTruthy();
      // ONE .hero-sig wrapper holds both the face and the card's label —
      // the index/contact anatomy reused, not a parallel CSS copy
      const sig = card.match(/<div class="hero-sig"[^>]*>\s*(<img[^>]*>)[\s\S]{0,400}?<\/div>/);
      expect(sig, `${slot}: .hero-sig wrapper`).toBeTruthy();
      expect(sig![0], `${slot}: label rides beside the face`).toContain(label);
      const a = pinPhoto(sig![1], `${slot} avatar`, 'eric-davis-small.jpg', 56, 56);
      expect(a.alt, `${slot}: avatar alt`).toBe('Eric Davis');
    }
  });

  test('A4: the audit trust strip\'s Founder cell gets the face beside the name — and ONLY that cell changed', () => {
    const strip = PHOTO_SLOTS['audit.html § trust strip']();
    expect(strip, 'trust strip found').toContain('footer-trust-inner');
    const cell = strip.match(/>Founder<\/div>[\s\S]*?(<img[^>]*>)/);
    const a = pinPhoto(cell?.[1], 'audit Founder cell avatar', 'eric-davis-small.jpg', 46, 46);
    expect(a.alt, 'audit avatar alt').toBe('Eric Davis');
    // the cell's copy is untouched beside it, and the avatar is the strip's
    // ONLY img (the sibling cells stay text — no decoration creep)
    expect(strip, 'name kept').toContain('Eric Davis</div>');
    expect(strip, 'role kept').toContain('Web Design &amp; SEO Strategist');
    expect(strip.match(/<img/g)?.length, 'one avatar, no strip-wide creep').toBe(1);
  });

  test('A1-A4 consistency: all four avatar slots are the SAME real photo — a recurring signature, not four faces', () => {
    const srcs: string[] = [];
    for (const f of ['pricing.html', 'services.html', 'monthly-retainer.html', 'audit.html']) {
      for (const m of read(f).matchAll(/<img[^>]*src="([^"]*eric-davis[^"]*)"[^>]*>/g)) srcs.push(m[1]);
    }
    expect(srcs.length, 'four avatar slots sitewide').toBe(4);
    expect([...new Set(srcs)], 'one asset, four surfaces').toEqual(['eric-davis-small.jpg']);
  });

  test('A5: About\'s origin section carries the 3-tile life strip — the unused candids, one shared caption', () => {
    const section = PHOTO_SLOTS['about.html § origin section']();
    const strip = section.match(/<figure class="ab-life-strip"[\s\S]*?<\/figure>/)?.[0] ?? '';
    expect(strip, 'life-strip figure inside the origin section').toBeTruthy();
    // a sibling BELOW the origin grid, not wedged inside the split
    expect(section.indexOf('ab-life-strip'), 'strip sits after the grid').toBeGreaterThan(section.indexOf('ab-origin-grid'));
    const tiles = [...strip.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
    expect(tiles.length, 'exactly 3 tiles').toBe(3);
    pinPhoto(tiles[0], 'life strip tile 1', 'life/eric-dog.jpg', 512, 1024);
    pinPhoto(tiles[1], 'life strip tile 2', 'life/eric-gym.jpg', 666, 1000);
    pinPhoto(tiles[2], 'life strip tile 3', 'life/eric-rome.jpg', 512, 1024);
    // eric-work.jpg belongs to /how-we-work (and now A6) — never this strip
    expect(strip, 'the desk shot stays off the strip').not.toContain('eric-work.jpg');
    expect(strip.match(/<figcaption/g)?.length, 'ONE mono caption for the whole strip').toBe(1);
    // styling lives in the page\'s own layer, scoped like everything there
    expect(read('about.css'), 'about.css owns the strip').toContain('body[data-page="about"] .ab-life-tiles');
  });

  test('A6: Work\'s decisions intro gets the desk shot — .hww-shot treatment, the caption names the method', () => {
    const section = PHOTO_SLOTS['work.html § decisions section']();
    const fig = section.match(/<figure class="hww-shot[^"]*"[^>]*>[\s\S]*?<\/figure>/)?.[0] ?? '';
    expect(fig, 'framed figure inside the decisions section').toBeTruthy();
    // it follows the "Not a portfolio." lead — an illustration of that exact
    // claim (reasoning-on-paper), not a header decoration
    expect(section.indexOf('Not a portfolio.'), 'figure sits after the lead').toBeLessThan(section.indexOf('<figure'));
    pinPhoto(fig.match(/<img[^>]*>/)?.[0], 'work desk shot', 'life/eric-work.jpg', 512, 1024);
    expect(fig, 'the caption').toContain('<figcaption>The reasoning happens on paper first.</figcaption>');
  });

  test('the honesty law, structurally: the six touched sections reference ONLY known real-photo assets', () => {
    for (const [slot, extract] of Object.entries(PHOTO_SLOTS)) {
      const src = extract();
      expect(src, `${slot}: section found`).toBeTruthy();
      const refs = [...src.matchAll(/(?:src|srcset)="([^"]+\.(?:jpe?g|webp|png|avif|gif))"/g)].map((m) => m[1]);
      expect(refs.length, `${slot}: the slot actually ships imagery`).toBeGreaterThan(0);
      for (const r of refs) {
        expect(REAL_PHOTOS.has(r.replace(/^\//, '')), `${slot}: "${r}" is not on the real-photo list`).toBe(true);
      }
    }
  });
});

test.describe('Photos A (live, desktop)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop behavior');
  });

  test('every Group A photo resolves and renders (no broken src); the avatar is a literal face-in-a-circle', async ({ page }) => {
    const SLOTS: Array<[string, string, number]> = [
      ['/pricing.html', 'main img[src="eric-davis-small.jpg"]', 1],
      ['/services.html', 'main img[src="eric-davis-small.jpg"]', 1],
      ['/monthly-retainer.html', 'main img[src="eric-davis-small.jpg"]', 1],
      ['/audit.html', 'img[src="eric-davis-small.jpg"]', 1],
      ['/about.html', '.ab-life-tiles img', 3],
      ['/work.html', '.wk-decisions-section .hww-shot img', 1],
    ];
    for (const [url, sel, n] of SLOTS) {
      await page.goto(url);
      const imgs = page.locator(sel);
      await expect(imgs, `${url}: ${sel}`).toHaveCount(n);
      for (let i = 0; i < n; i++) {
        await imgs.nth(i).scrollIntoViewIfNeeded(); // they're lazy — earn the load
        await expect
          .poll(() => imgs.nth(i).evaluate((el) => (el as HTMLImageElement).naturalWidth), { message: `${url}: ${sel} [${i}] decodes` })
          .toBeGreaterThan(0);
      }
    }
    // the .hero-sig treatment actually applied: round crop at avatar scale
    await page.goto('/pricing.html');
    const av = page.locator('.hero-sig img');
    await expect(av, 'round avatar').toHaveCSS('border-radius', '50%');
    expect(await av.evaluate((el) => (el as HTMLElement).offsetWidth), 'avatar scale').toBe(56);
  });

  test('the strip + desk-shot captions hold AA in the light scheme', async ({ page }) => {
    await page.goto('/about.html');
    expect(await contrastOf(page, '.ab-life-strip figcaption'), 'about strip caption').toBeGreaterThanOrEqual(4.5);
    await page.goto('/work.html');
    expect(await contrastOf(page, '.wk-decisions-section .hww-shot figcaption'), 'work caption').toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('dark scheme (chrome + closer fine print)', () => {
  test.use({ colorScheme: 'dark' });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'scheme pins run once, on desktop');
  });

  test('footer brand line and closer fine print stay legible in dark (P9)', async ({ page }) => {
    // the footer ships on every page via the chrome — one page proves the rule
    await page.goto('/index.html');
    expect(await contrastOf(page, 'footer.site .brand'), 'footer brand line').toBeGreaterThanOrEqual(4.5);
    await page.goto('/web-design.html');
    expect(await contrastOf(page, 'main section.panel-dark .hint'), 'closer fine print').toBeGreaterThanOrEqual(4.5);
    await page.goto('/audit.html');
    expect(await contrastOf(page, 'section.cta-band > p'), 'audit CTA band copy').toBeGreaterThanOrEqual(4.5);
  });

  test('MS5: the industry shell reads in dark — chips, bullets, FAQ, capture band, bridge, about handoff', async ({ page }) => {
    // one lander proves the template (the shell is byte-identical family-wide)
    await page.goto('/restaurant-web-design.html');
    expect(await contrastOf(page, '.ind-chip'), 'Explore chip').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.feature-box .fb-list li'), 'feature bullets').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.panel-warm details summary'), 'FAQ question').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.soft-capture h2'), 'capture heading (large)').toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, '.soft-capture p'), 'capture copy').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, 'main section.panel-dark .lead-muted'), 'closer copy').toBeGreaterThanOrEqual(4.5);
    // the new copy on the hub and about pages
    await page.goto('/industries.html');
    expect(await contrastOf(page, 'main .textlink'), 'bridge link').toBeGreaterThanOrEqual(4.5);
    await page.goto('/about.html');
    expect(await contrastOf(page, 'main .textlink'), 'about handoff link').toBeGreaterThanOrEqual(4.5);
  });

  test('MS6: the legal template, the rebuilt ai-disclaimer, the 404 rescues, and the service captures read in dark', async ({ page }) => {
    // ai-disclaimer's old page-scoped :root fork trapped its dark variant
    // behind a <=900px media query — at desktop widths the page went
    // dark-on-dark. Rebuilt on the legal template, styles.css's sitewide
    // remap simply applies; measure the whole anatomy.
    await page.goto('/ai-disclaimer.html');
    expect(await contrastOf(page, 'main h1'), 'legal h1 (display)').toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, 'main h2'), 'legal section headings').toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, 'main .lead-muted'), 'legal body copy').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, 'main .lead-muted a'), 'legal in-body links').toBeGreaterThanOrEqual(4.5);
    await page.goto('/privacy.html');
    expect(await contrastOf(page, 'main .lead-muted'), 'privacy body copy').toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, 'main .lead-muted a'), 'privacy in-body links').toBeGreaterThanOrEqual(4.5);
    await page.goto('/404.html');
    expect(await contrastOf(page, 'main h1'), '404 headline').toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, 'main p a'), '404 rescue links').toBeGreaterThanOrEqual(4.5);
    // one capture page proves the tokenized band (byte-identical markup on both)
    await page.goto('/services.html');
    expect(await contrastOf(page, '.soft-capture h2'), 'capture heading (large)').toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, '.soft-capture p'), 'capture copy').toBeGreaterThanOrEqual(4.5);
  });

  test('Photos A: the life-strip and desk-shot captions read in dark', async ({ page }) => {
    // the photographs themselves stay light (photograph-as-artifact — the
    // pmock precedent); the captions are page-surface text and must hold AA
    await page.goto('/about.html');
    expect(await contrastOf(page, '.ab-life-strip figcaption'), 'about strip caption (dark)').toBeGreaterThanOrEqual(4.5);
    await page.goto('/work.html');
    expect(await contrastOf(page, '.wk-decisions-section .hww-shot figcaption'), 'work caption (dark)').toBeGreaterThanOrEqual(4.5);
  });
});
