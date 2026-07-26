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

// The MS3 estate. tools.html is the hub; the four TOOL_PAGES share the
// tool-page.css template; buy-audit is the slim payment chrome (deliberately
// outside the sync manifest — see scripts/sync-marketing-chrome.mjs);
// email-signature is an internal doc pending MS7 build-exclusion.
const HUB = 'tools.html';
const TOOL_PAGES = ['ai-critique.html', 'report-card.html', 'roi-calculator.html', 'pricing-estimator.html'];
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

  test('no page-local :root token fork on any tools-family page', () => {
    for (const f of ALL) {
      expect(inlineCss(read(f)), `${f}: styles.css owns the tokens`).not.toMatch(/:root\s*\{/);
    }
  });

  test('no page-scoped dark skin (P4: one light system; styles.css owns dark)', () => {
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

  test('no purple pill buttons in family markup or family css', () => {
    const sources = [...ALL.map(read), read('tools.css'), read('tool-page.css')];
    const names = [...ALL, 'tools.css', 'tool-page.css'];
    sources.forEach((src, i) => {
      expect(src, `${names[i]}: pill radius`).not.toMatch(/border-radius:\s*100px/);
      expect(src, `${names[i]}: inline purple button`).not.toContain('background:#5b3fa0');
    });
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
    // single dark closer ends the page
    const closer = page.locator('section.final-cta');
    await expect(closer).toHaveCount(1);
    const bg = await closer.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, 'closer wears --p-deep').toBe('rgb(42, 27, 74)');
  });
});
