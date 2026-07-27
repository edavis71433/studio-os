import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ============================================================
// MS3 — tools-family pins (docs/design/MARKETING-SITE-OVERHAUL.md §MS3).
//
// "The tools pages look like a whole different site" — because they were one:
// a second, undocumented purple template (page-local :root token forks, pill
// buttons, gradient bands, emoji icon sets, exit popups, a custom cursor,
// 3–4-deep CTA gauntlets, page-scoped dark skins). MS3 rebuilt the family
// onto the index design system. This spec makes THAT drift class structurally
// impossible to regress, and pins that each tool still FUNCTIONS — this was
// a reskin, not a logic rewrite.
//
// Written red-first: every pin below failed against the pre-MS3 pages.
// Chrome-region byte-identity is marketing.spec.ts's job — not re-pinned here.
// ============================================================

function findRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, '_redirects')) && existsSync(join(dir, 'index.html'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found from ' + process.cwd());
}
const ROOT = findRoot();
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

// The MS3 estate. tools.html is the hub; the five TOOL_PAGES share the
// tool-page.css template (local-visibility sat outside MS3's file fence and
// joined in the gap-closure pass — same template, same pins); buy-audit is the
// slim payment chrome (deliberately outside the sync manifest — see
// scripts/sync-marketing-chrome.mjs); email-signature is an internal doc
// pending MS7 build-exclusion.
const HUB = 'tools.html';
const TOOL_PAGES = ['ai-critique.html', 'report-card.html', 'roi-calculator.html', 'pricing-estimator.html', 'local-visibility.html'];
const FAMILY = [HUB, ...TOOL_PAGES];
const ALL = [...FAMILY, 'buy-audit.html', 'email-signature.html'];

const inlineCss = (html: string) =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

// WCAG relative-luminance contrast from two computed "rgb(r, g, b)" strings.
function contrast(fg: string, bg: string): number {
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

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  // Third-party CDNs are unreachable in the CI sandbox (same policy as
  // marketing.spec.ts). Anything local or script-thrown still fails.
  const external = /fonts\.googleapis|fonts\.gstatic|googletagmanager/;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (external.test(msg.text()) || external.test(msg.location()?.url ?? '')) return;
    errors.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Static pins — the purple template's anatomy may not return
// ---------------------------------------------------------------------------
test.describe('tools family (static pins)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'filesystem pins run once, on desktop');
  });

  // Every stylesheet a family page links, resolved to repo files. styles.css
  // (the token owner) and enhance.css (the shared enhancement layer, which
  // carries motion-token :root vars) are the only sanctioned shared layers —
  // anything else a page links is scanned with the page (C5: a one-line
  // <link> must not be able to smuggle the purple fork back in).
  const SANCTIONED_SHARED = new Set(['styles.css', 'enhance.css']);
  const linkedLocalCss = (html: string): string[] =>
    [...html.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]
      .map((m) => m[1])
      .filter((h) => !/^https?:/.test(h))
      .map((h) => h.replace(/^\//, ''));

  test('no :root token fork on any tools-family page — inline OR page-local linked stylesheet', () => {
    for (const f of ALL) {
      const html = read(f);
      expect(inlineCss(html), `${f}: styles.css owns the tokens`).not.toMatch(/:root\s*\{/);
      for (const css of linkedLocalCss(html).filter((c) => !SANCTIONED_SHARED.has(c))) {
        const src = read(css);
        expect(src, `${f} -> ${css}: styles.css owns the tokens`).not.toMatch(/:root\s*\{/);
        // token re-declarations outside :root (e.g. body{--p:...}) are the same fork
        expect(src, `${f} -> ${css}: design-token re-declaration`).not.toMatch(
          /(^|[{;\s])--(ink|paper|paper-2|p|p-deep|p-mist|muted|hair|hair-dk|brass|brass-deep)\s*:/m
        );
      }
    }
  });

  test('no page-scoped dark skin (P4: one light system; styles.css owns the dark token remap)', () => {
    // Pages ship no prefers-color-scheme blocks. The family CSS layers
    // (tool-page.css / tools.css / buy-audit.css) MAY carry dark SURFACE
    // counterparts — the contact.css recipe blessed in marketing.spec.ts —
    // but the token-fork pin above keeps them from repainting the system.
    for (const f of ALL) {
      expect(read(f), `${f}: page-scoped prefers-color-scheme block`).not.toContain('prefers-color-scheme');
    }
  });

  test('no emoji icon sets — stroked SVG only', () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const f of ALL) {
      const m = read(f).match(emoji);
      expect(m, `${f}: emoji icon "${m?.[0]}"`).toBeNull();
    }
  });

  test('no exit popup, no custom cursor, no scroll progress bar', () => {
    for (const f of ALL) {
      const html = read(f);
      for (const gimmick of ['exit-overlay', 'exitOverlay', 'exit_shown', 'cursor-dot', 'cursor-ring']) {
        expect(html, `${f}: ${gimmick}`).not.toContain(gimmick);
      }
      // the fixed 3px gradient scroll bar both ai-critique and report-card injected
      expect(html, `${f}: scroll progress bar`).not.toMatch(/position:fixed;top:0;left:0;height:3px/);
    }
  });

  test('no purple pill buttons in family markup or family css (generalized — not just the retired bytes)', () => {
    // C4: the old pin banned only the deleted code's literal constants
    // (100px + lowercase #5b3fa0), so a 999px / #5B3FA0 pill sailed through.
    // Generalized: any pill-scale radius and any literal purple as page
    // styling fail, in every family source plus every page-local linked css.
    const sources = new Map<string, string>();
    for (const f of ALL) {
      sources.set(f, read(f));
      for (const css of linkedLocalCss(read(f)).filter((c) => c !== 'styles.css' && c !== 'enhance.css')) {
        sources.set(css, read(css));
      }
    }
    for (const [name, raw] of sources) {
      // scan styling, not prose: drop comments, and the theme-color meta
      // (which legitimately carries the brand hex for browser chrome)
      const src = raw
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<meta name="theme-color"[^>]*>/g, '');
      // pill radii: the family's largest sanctioned radius is 20px (cards).
      // Anything pill-scale (>=40px, or >=3em/rem) is the retired anatomy.
      for (const decl of src.matchAll(/border-radius:([^;}"']*)/gi)) {
        for (const t of decl[1].matchAll(/([\d.]+)(px|r?em)/g)) {
          const limit = t[2] === 'px' ? 40 : 3;
          expect(parseFloat(t[1]), `${name}: pill-scale border-radius "${decl[0].trim()}"`).toBeLessThan(limit);
        }
      }
      // purple as a background, in any spelling
      expect(src, `${name}: purple button/surface background`).not.toMatch(
        /background(?:-color)?\s*:\s*(?:#5b3fa0\b|rgb\(\s*91\s*,\s*63\s*,\s*160\s*\))/i
      );
      // and in the family proper (email-signature excepted: email clients
      // force literal hexes there), no literal purple hex at all — purple
      // reaches pages only as var(--p), so the dark remap can lift it
      if (name !== 'email-signature.html') {
        expect(src, `${name}: literal purple hex outside the token system`).not.toMatch(/#5b3fa0\b/i);
        expect(src, `${name}: literal purple rgb outside the token system`).not.toMatch(/rgb\(\s*91\s*,\s*63\s*,\s*160\s*\)/);
      }
    }
  });

  test('single closer: one dark final CTA, last section before the footer; the gauntlet is gone', () => {
    for (const f of FAMILY) {
      const html = read(f);
      expect(html, `${f}: dds-final-cta gradient band`).not.toContain('dds-final-cta');
      expect(html, `${f}: cta-band`).not.toContain('cta-band');
      expect(html, `${f}: gradient band`).not.toContain('linear-gradient(135deg');
      expect(html, `${f}: trust strip band`).not.toContain('TRUST STRIP');
      const closers = html.match(/class="[^"]*final-cta[^"]*"/g) || [];
      expect(closers.length, `${f}: exactly one closer`).toBe(1);
      expect(html, `${f}: closer wears the standard dark panel`).toMatch(/class="[^"]*panel-dark[^"]*final-cta[^"]*"/);
      const last = html.lastIndexOf('<section');
      expect(html.slice(last, last + 120), `${f}: closer is the last section`).toContain('final-cta');
      // C3: count ANY dark CTA band anatomy, not just the final-cta class —
      // a second <section class="pad panel-dark"> (no final-cta) is exactly
      // how a gauntlet regrows, and it must fail here, not ship.
      const darkBands = html.match(/<section\b[^>]*class="[^"]*\b(?:panel-dark|cta-band)\b[^"]*"/g) || [];
      expect(darkBands.length, `${f}: exactly one dark band <section>`).toBe(1);
      expect(darkBands[0], `${f}: the one dark band IS the closer`).toContain('final-cta');
    }
  });

  test('soft-capture is the tokenized component — the #EDE8F7/#5b3fa0 inline-hex copies are dead', () => {
    for (const f of TOOL_PAGES) {
      const html = read(f);
      expect(html, `${f}: inline-hex soft capture`).not.toContain('#EDE8F7');
      expect(html, `${f}: .soft-capture component`).toContain('soft-capture');
    }
    expect(read('tool-page.css'), 'component defined once, for MS5 reuse').toContain('.soft-capture');
  });

  test('one breadcrumb standard: Home / Free tools / X on every tool page', () => {
    for (const f of TOOL_PAGES) {
      const html = read(f);
      const crumb = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0];
      expect(crumb, `${f}: breadcrumb nav`).toBeTruthy();
      expect(crumb!, `${f}: Home crumb`).toContain('href="/"');
      expect(crumb!, `${f}: Free tools crumb`).toContain('href="/tools"');
    }
  });

  test('reveal animation rides the .js-anim gate — never an unconditional hide', () => {
    for (const f of ALL) {
      expect(inlineCss(read(f)), `${f}: unconditional .reveal hide`).not.toMatch(
        /\.reveal\s*\{[^}]*opacity:\s*0/
      );
    }
  });

  test('booking front door: no Calendly deep links in tool pages (Calendly lives behind /contact)', () => {
    for (const f of FAMILY) {
      expect(read(f), `${f}: calendly deep link`).not.toContain('calendly.com');
    }
  });

  test('report-card: dead band, weekly-tips promise and newsletter are gone; the offer flow stays', () => {
    const html = read('report-card.html');
    expect(html).not.toMatch(/padding-top:\s*68px/);
    expect(html).not.toContain('weekly tips');
    expect(html).not.toContain('subscribeNL');
    // the actual tool survives
    expect(html).toContain('submitReportCard');
    expect(html).toContain('rcSuccess');
  });

  test('roi-calculator: dead package catalog is out of the slider; the math stays', () => {
    const html = read('roi-calculator.html');
    for (const ghost of ['Custom + Photography', 'Custom HTML', "'Template'"]) {
      expect(html, `dead catalog label: ${ghost}`).not.toContain(ghost);
    }
    // the no-JS fallback no longer anchors on the old 382% headline
    expect(html, 'calmed default anchor').not.toContain('382%');
    expect(html, 'calc() preserved').toContain('function calc()');
    expect(html, 'lead intake preserved').toContain('lead_intake');
  });

  test('pricing-estimator: published numbers only, one taxonomy, results CTA → /contact', () => {
    const html = read('pricing-estimator.html');
    // MS2's corrected numbers hold
    for (const amt of ['$1,500', '$3,800', '$6,500']) expect(html, amt).toContain(amt);
    expect(html).toContain('around $400 a month');
    expect(html).not.toContain('$850');
    // the second, internal taxonomy no longer leaks into Q2's option badges
    // (Q4's add-on price badges are real published add-on numbers and stay)
    expect(html).not.toContain('>Studio+<');
    const q2 = html.match(/<div class="q-card" id="q2">[\s\S]*?<div class="q-card" id="q3">/)?.[0] ?? '';
    expect(q2, 'Q2 exists').toContain('How many pages');
    expect(q2.match(/class="opt-price"/g), 'Q2 taxonomy badges removed').toBeNull();
    // results CTAs point at the one booking front door
    expect(html).toContain("ctaUrl: '/contact'");
    expect(html).not.toContain('ctaUrl: \'https://');
  });

  test('local-visibility: the gap page rides the template — both stylesheets, chrome regions, one h1; the quiz machinery survives', () => {
    const html = read('local-visibility.html');
    // the shared layers, in order: tokens first, then the tool-page layer
    expect(html, 'styles.css loads').toContain('href="styles.css"');
    expect(html.indexOf('href="tool-page.css"'), 'tool-page.css loads after styles.css').toBeGreaterThan(
      html.indexOf('href="styles.css"')
    );
    // chrome regions present (byte-identity stays marketing.spec.ts's job)
    for (const marker of ['dds-marketing-nav:start', 'dds-marketing-nav:end', 'dds-marketing-footer:start', 'dds-marketing-footer:end']) {
      expect(html, `chrome marker ${marker}`).toContain(marker);
    }
    expect(html.match(/<h1[\s>]/g)?.length, 'exactly one h1').toBe(1);
    // the SEO head survives the reskin
    expect(html, 'canonical kept').toContain('href="https://davisdigitalstudio.com/local-visibility"');
    // the closer books through the one front door
    const closer = html.match(/<section class="pad panel-dark final-cta">[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(closer, 'closer CTA → /contact').toContain('href="/contact"');
    // a reskin, not a rewrite: the scoring, results, and lead intake are intact
    for (const bit of ['calcScore', 'showResults()', 'lead_intake', 'score-big', 'q6_city']) {
      expect(html, `quiz machinery: ${bit}`).toContain(bit);
    }
  });

  test('tools.html hub: the canon of six matches the tool-switch grid, audit is the headline path', () => {
    const html = read(HUB);
    const canon = ['/audit', '/ai-critique', '/report-card', '/roi-calculator', '/pricing-estimator', '/local-visibility'];
    for (const url of canon) expect(html, `hub links ${url}`).toContain(`href="${url}"`);
    // audit leads the hero
    const hero = html.match(/<section class="hero">[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(hero, 'hero primary CTA → /audit').toMatch(/href="\/audit"[^>]*class="btn btn-primary"/);
    // every tool of the canon has a question card in the grid
    const grid = html.match(/<div class="res-grid[\s\S]*?<\/div>\s*<p class="hint/)?.[0] ?? html;
    for (const url of canon) expect(grid, `canon card ${url}`).toContain(`href="${url}"`);
  });

  test('every tool-switch grid lists the same six tools (five links + the current page)', () => {
    for (const f of TOOL_PAGES) {
      const html = read(f);
      const section = html.match(/<section class="tool-switch-section">[\s\S]*?<\/section>/)?.[0];
      expect(section, `${f}: tool-switch section`).toBeTruthy();
      const links = [...section!.matchAll(/href="(\/[a-z-]+)" class="tool-switch-item"/g)].map((m) => m[1]);
      expect(links.length, `${f}: five sibling links`).toBe(5);
      expect(section!, `${f}: current marker`).toContain('tool-switch-item current');
    }
  });

  test('buy-audit: slim shared payment chrome on styles.css tokens; checkout machinery intact', () => {
    const html = read('buy-audit.html');
    expect(html, 'styles.css is the token source').toContain('href="styles.css"');
    expect(html, 'brand mark present (shared chrome)').toContain('class="brand"');
    expect(html, 'clean back-link to the tier table').toContain('href="/audit#pricing"');
    expect(html, 'legacy .html back-link gone').not.toContain('audit.html#pricing');
    expect(html, 'footer legal row').toContain('href="/privacy"');
    expect(html, 'stays noindex').toContain('noindex');
    // the checkout function is untouched
    for (const bit of ['public_audit_checkout', 'startCheckout', 'Starter Audit', '$499', '$899']) {
      expect(html, `checkout: ${bit}`).toContain(bit);
    }
  });

  test('email-signature: the copyable signature still outputs, minus the pill + emoji styling', () => {
    const html = read('email-signature.html');
    expect(html).toContain('SIGNATURE START');
    expect(html).toContain('SIGNATURE END');
    for (const link of [
      'https://davisdigitalstudio.com',
      'mailto:eric@davisdigitalstudio.com',
      'https://www.linkedin.com/in/eric-davis-4b1034b8/',
      'https://davisdigitalstudio.com/report-card',
    ]) {
      expect(html, `signature link ${link}`).toContain(link);
    }
    expect(html, 'stays out of search').toContain('noindex');
  });

  test('sync-marketing-chrome --check still passes after the MS3 rebuild', () => {
    execFileSync('node', ['scripts/sync-marketing-chrome.mjs', '--check'], { cwd: ROOT });
  });
});

// ---------------------------------------------------------------------------
// Live pins — tokens resolve, tools function, contrast holds (desktop + mobile)
// ---------------------------------------------------------------------------
test.describe('tools family (live)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!['desktop-chromium', 'mobile'].includes(testInfo.project.name), 'desktop + mobile');
  });

  for (const f of ALL) {
    test(`console-clean boot + tokens resolve from styles.css: /${f}`, async ({ page }) => {
      const errors = await collectErrors(page);
      await page.goto(`/${f}`);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
      // one light system: warm paper + aubergine ink from styles.css
      const body = await page.evaluate(() => {
        const s = getComputedStyle(document.body);
        return { bg: s.backgroundColor, color: s.color, font: s.fontFamily };
      });
      expect(body.bg, `${f} paper`).toBe('rgb(251, 250, 247)');
      expect(body.color, `${f} ink`).toBe('rgb(27, 21, 37)');
      expect(body.font, `${f} Inter`).toContain('Inter');
      // no horizontal overflow at any viewport
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${f} horizontal overflow`).toBeLessThanOrEqual(1);
      // C3 (computed variant): exactly one RENDERED dark section per family
      // page — catches a dark band no matter how it's classed or styled.
      const darkSections = await page.evaluate(() => {
        const lum = (c: string) => {
          const m = c.match(/[\d.]+/g);
          if (!m) return 1;
          const [r, g, b] = m.slice(0, 3).map(Number).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        return [...document.querySelectorAll('main section')]
          .filter((s) => {
            const bg = getComputedStyle(s).backgroundColor;
            if (!bg || bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg)) return false;
            return lum(bg) < 0.2;
          })
          .map((s) => s.className);
      });
      const expected = FAMILY.includes(f) ? 1 : 0;
      expect(darkSections.length, `${f}: rendered dark sections ${JSON.stringify(darkSections)}`).toBe(expected);
      if (FAMILY.includes(f)) expect(darkSections[0], `${f}: the dark section is the closer`).toContain('final-cta');
    });
  }

  test('ROI calculator computes on driven input (and the 382% anchor is calmed)', async ({ page }) => {
    await page.goto('/roi-calculator.html');
    // the default anchor is no longer the old 382% headline
    await expect(page.locator('#res-roi')).not.toHaveText('382%');
    // drive the sliders and verify the arithmetic end to end
    const drive = async (id: string, value: string) => {
      await page.locator(`#${id}`).evaluate((el, v) => {
        (el as HTMLInputElement).value = v as string;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    };
    await drive('revenue', '20000');
    await drive('web-pct', '40');
    await drive('improvement', '30');
    await drive('package', '3800');
    // 20000 × 40% × 30% = 2400/mo · 28800/yr · ROI (28800−3800)/3800 = 658%
    await expect(page.locator('#res-monthly')).toHaveText('$2,400');
    await expect(page.locator('#res-annual')).toHaveText('$28,800');
    await expect(page.locator('#res-roi')).toHaveText('658%');
    await expect(page.locator('#res-payback')).toContainText('1.6 month');
    // results CTA anatomy (the family's best — carried over)
    await expect(page.locator('.results a[href="/audit"]')).toBeVisible();
    await expect(page.locator('.results a[href="/contact"]')).toBeVisible();
  });

  test('estimator: growth flow reaches its result on published numbers', async ({ page }) => {
    await page.goto('/pricing-estimator.html');
    await page.click('#q1_new');
    await page.click('#q1next');
    await page.click('#q2_4-7');
    await page.click('#q2next');
    await page.click('#q3_squarespace');
    await page.click('#q3next');
    await page.click('#q4_none');
    await page.click('#q4next');
    await page.click('#q5_flexible');
    await page.click('#q5next');
    await expect(page.locator('#peResults')).toBeVisible();
    await expect(page.locator('#tierCard')).toContainText('$3,800');
    // the result books through the front door, not a Calendly deep link
    await expect(page.locator('#tierCard a[href="/contact"]')).toBeVisible();
  });

  test('estimator: studio flow carries the corrected retainer line, include-list legible', async ({ page }) => {
    await page.goto('/pricing-estimator.html');
    await page.click('#q1_ecommerce');
    await page.click('#q1next');
    await page.click('#q2_15\\+');
    await page.click('#q2next');
    await page.click('#q3_custom');
    await page.click('#q3next');
    await page.click('#q4_none');
    await page.click('#q4next');
    await page.click('#q5_flexible');
    await page.click('#q5next');
    await expect(page.locator('#peResults')).toBeVisible();
    const card = page.locator('.tier-result');
    await expect(card).toContainText('$6,500');
    // the previously-dim open item: the Studio include-list on its dark gradient.
    // First: no gradient surface at all (a gradient defeats any bg-color walk) —
    // then the text must clear WCAG AA against its actual background.
    const bgImage = await card.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bgImage, 'tier card is a flat tokenized surface').toBe('none');
    const li = card.locator('.tier-includes li').filter({ hasText: '$400 a month' });
    await expect(li).toBeVisible();
    const [fg, bg] = await li.evaluate((el) => {
      const color = getComputedStyle(el).color;
      let n: HTMLElement | null = el as HTMLElement;
      let back = 'rgba(0, 0, 0, 0)';
      while (n) {
        const b = getComputedStyle(n).backgroundColor;
        if (b && !b.includes('0, 0, 0, 0') && b !== 'transparent') { back = b; break; }
        n = n.parentElement;
      }
      return [color, back];
    });
    expect(contrast(fg, bg), `include-list contrast ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  test('critique form validates: bad URL blocked, good URL advances the wizard', async ({ page }) => {
    await page.goto('/ai-critique.html');
    await page.click('#toStep2');
    await expect(page.locator('#step2')).toBeHidden(); // empty URL: refused
    await page.fill('#critUrl', 'not a url');
    await page.click('#toStep2');
    await expect(page.locator('#step2')).toBeHidden(); // invalid URL: refused
    await page.fill('#critUrl', 'example.com');
    await page.click('#toStep2');
    await expect(page.locator('#step2')).toBeVisible(); // valid URL: advances
    await expect(page.locator('#toStep3')).toBeDisabled();
    await page.click('#bizChips .crit-chip >> nth=0');
    await expect(page.locator('#toStep3')).toBeEnabled();
    await page.click('#toStep3');
    await expect(page.locator('#step3')).toBeVisible();
    await expect(page.locator('#runCrit')).toBeDisabled();
    await page.click('#goalChips .crit-chip >> nth=0');
    await expect(page.locator('#runCrit')).toBeEnabled();
  });

  test('critique loading checklist is legible in the one light system', async ({ page }) => {
    await page.goto('/ai-critique.html');
    // put the loading section into its live state without a network round-trip
    await page.evaluate(() => {
      document.getElementById('critLoading')!.hidden = false;
      document.getElementById('ls0')!.classList.add('active');
    });
    const [fg, bg] = await page.evaluate(() => {
      const el = document.getElementById('ls0')!;
      const color = getComputedStyle(el).color;
      let n: HTMLElement | null = el;
      let back = '';
      while (n) {
        const b = getComputedStyle(n).backgroundColor;
        if (b && !b.includes('0, 0, 0, 0') && b !== 'transparent') { back = b; break; }
        n = n.parentElement;
      }
      return [color, back];
    });
    expect(contrast(fg, bg), `active loading step ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  test('report card validates then submits (stubbed) and confirms without a newsletter pitch', async ({ page }) => {
    await page.route('**/formspree.io/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.route('**/functions/v1/clever-api', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.goto('/report-card.html');
    await page.click('#rcSubmit');
    await expect(page.locator('#rcError')).toBeVisible();
    await expect(page.locator('#rcError')).toContainText('business name');
    await page.fill('#rcName', "Rosa's Bakery");
    await page.selectOption('#rcType', 'Restaurant / Bar / Café');
    await page.fill('#rcCity', 'Burbank');
    await page.fill('#rcEmail', 'rosa@example.com');
    await page.click('#rcSubmit');
    await expect(page.locator('#rcSuccess')).toBeVisible();
    await expect(page.locator('#rcSuccessName')).toHaveText("Rosa's Bakery");
    await expect(page.locator('#rcSuccess')).not.toContainText('weekly');
  });

  test('local visibility: Next gates on selection, Back retreats, six answers make a scored result', async ({ page }) => {
    await page.route('**/functions/v1/clever-api', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.goto('/local-visibility.html');
    // Next is locked until an option is chosen
    await expect(page.locator('#q1next')).toBeDisabled();
    await page.click('#q1_restaurant');
    await expect(page.locator('#q1next')).toBeEnabled();
    await page.click('#q1next');
    await expect(page.locator('#q2')).toBeVisible();
    // Back returns to the previous question
    await page.click('#q2 .back-btn');
    await expect(page.locator('#q1')).toBeVisible();
    await expect(page.locator('#q2')).toBeHidden();
    await page.click('#q1next');
    // an unmanaged GBP (20) + decent reviews (15) + a basic site (8) + a few
    // directories (7) = 50/100, the "ok" band — per the untouched calcScore()
    await page.click('#q2_yes_unclaimed');
    await page.click('#q2next');
    await page.click('#q3_decent');
    await page.click('#q3next');
    await page.click('#q4_partial');
    await page.click('#q4next');
    await page.click('#q5_some');
    await page.click('#q5next');
    // the text step gates on BOTH fields
    await expect(page.locator('#q6next')).toBeDisabled();
    await page.fill('#q6_name', "Rosa's Bakery");
    await expect(page.locator('#q6next')).toBeDisabled();
    await page.fill('#q6_city', 'Burbank');
    await expect(page.locator('#q6next')).toBeEnabled();
    await page.click('#q6next');
    await expect(page.locator('#lvResults')).toBeVisible();
    await expect(page.locator('#lvScoreNum')).toHaveText('50');
    await expect(page.locator('#lvScoreNum')).toHaveClass(/\bok\b/);
    await expect(page.locator('#lvGrade')).toHaveText('Room to improve');
    await expect(page.locator('#lvBizName')).toContainText("Rosa's Bakery");
    await expect(page.locator('#signalsGrid .signal-card')).toHaveCount(4);
    // results CTA anatomy: the $99-audit upsell and the booking front door
    await expect(page.locator('.results a[href="/audit"]')).toBeVisible();
    await expect(page.locator('#lvUpsell a[href="/contact"]')).toBeVisible();
    // the emailed-results follow-up validates, then submits (stubbed) and confirms
    await page.click('#leadSubmit');
    await expect(page.locator('#leadError')).toBeVisible();
    await page.fill('#leadEmail', 'rosa@example.com');
    await page.click('#leadSubmit');
    await expect(page.locator('#leadThanks')).toBeVisible();
    await expect(page.locator('#leadThanks')).toContainText("Rosa's Bakery");
    // restart resets the whole run — stepper, gates, and the lead card
    await page.click('.restart-btn');
    await expect(page.locator('#lvResults')).toBeHidden();
    await expect(page.locator('#q1')).toBeVisible();
    await expect(page.locator('#q1next')).toBeDisabled();
    await expect(page.locator('#leadForm')).toBeHidden(); // results (and the card) are closed again
  });

  test('buy-audit: tier catalog renders from the URL; checkout validates then hands off to Stripe', async ({ page }) => {
    await page.goto('/buy-audit.html?tier=health');
    await expect(page.locator('#a-title')).toHaveText('Digital Health Check');
    await expect(page.locator('#a-price')).toHaveText('$499');
    await expect(page.locator('#a-includes li')).toHaveCount(8);
    // validation first
    await page.click('#a-go');
    await expect(page.locator('#a-err')).toBeVisible();
    // then the real handoff, stubbed at the network edge
    await page.route('**/functions/v1/clever-api', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: '/buy-audit.html?tier=health#stub-checkout' }) })
    );
    await page.fill('#a-name', "Rosa's Bakery");
    await page.fill('#a-email', 'rosa@example.com');
    await page.click('#a-go');
    await page.waitForURL(/#stub-checkout/);
  });

  test('email-signature: the signature block outputs with its links intact', async ({ page }) => {
    await page.goto('/email-signature.html');
    const sig = page.locator('table').first();
    await expect(sig).toBeVisible();
    await expect(sig).toContainText('Eric Davis');
    await expect(sig.locator('a[href="https://davisdigitalstudio.com"]')).toBeVisible();
    await expect(sig.locator('a[href="https://davisdigitalstudio.com/report-card"]')).toBeVisible();
  });

  test('soft-capture band renders as the tokenized component on every tool page', async ({ page }) => {
    for (const f of TOOL_PAGES) {
      await page.goto(`/${f}`);
      const band = page.locator('.soft-capture');
      await expect(band, `${f}: soft-capture`).toHaveCount(1);
      const bg = await band.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, `${f}: p-mist token`).toBe('rgb(237, 232, 247)');
      const radius = await band.locator('form button').evaluate((el) => getComputedStyle(el).borderRadius);
      expect(radius, `${f}: ink button, not a pill`).toBe('2px');
    }
  });

  test('hub: six question cards, six tools, audit leads', async ({ page }) => {
    await page.goto('/tools.html');
    await expect(page.locator('.res-card')).toHaveCount(6);
    for (const url of ['/audit', '/ai-critique', '/report-card', '/roi-calculator', '/pricing-estimator', '/local-visibility']) {
      await expect(page.locator(`.res-card a[href="${url}"]`), url).toHaveCount(1);
    }
    // single dark closer ends the page — counted by dark-band anatomy, not
    // just the final-cta class (C3)
    const closer = page.locator('main section.panel-dark, main section.cta-band');
    await expect(closer).toHaveCount(1);
    const bg = await closer.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, 'closer wears --p-deep').toBe('rgb(42, 27, 74)');
  });
});
