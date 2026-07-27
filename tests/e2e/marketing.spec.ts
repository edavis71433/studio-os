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
