#!/usr/bin/env node
/* ============================================================
   sync-marketing-chrome.mjs — MS1's one-chrome propagator.

   Reads the canonical header/footer from
   scripts/marketing-chrome.template.html and rewrites the
   delimited regions

     <!-- dds-marketing-nav:start -->    ... <!-- dds-marketing-nav:end -->
     <!-- dds-marketing-footer:start --> ... <!-- dds-marketing-footer:end -->

   in every marketing page listed in PAGES. Output is committed
   static HTML — no runtime include, so SEO and no-JS behavior are
   untouched. Nothing outside the two regions is ever modified.

   Per-page stamping (the only variance between pages):
     - aria-current="page" on chrome links whose href equals the
       page's clean URL
     - aria-current="true" on the manifest's section link (data-nav)

   Modes:
     node scripts/sync-marketing-chrome.mjs           # write
     node scripts/sync-marketing-chrome.mjs --check   # verify only,
       exit 1 on drift (used by build-public.sh + marketing.spec.ts)

   Adoption: a page without the markers gets migrated once — the
   legacy skip-link..</header> span and <footer class="site">..
   </footer> span are replaced in place (the script refuses if the
   legacy anatomy is ambiguous).

   NOT in the manifest (deliberate):
     - buy-audit.html — ships with zero chrome today; MS3 owns its
       "slim shared chrome at the payment moment" per the overhaul
       plan (docs/design/MARKETING-SITE-OVERHAUL.md).
     - every app/portal page — different shell (shell.js), not
       marketing chrome.
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'scripts', 'marketing-chrome.template.html');

// [file, cleanUrl, sectionDataNav?]
// cleanUrl null (404.html) = never a current page, no stamping.
export const PAGES = [
  ['index.html', '/'],
  ['services.html', '/services'],
  ['web-design.html', '/web-design', 'services'],
  ['seo-strategy.html', '/seo-strategy', 'services'],
  ['monthly-retainer.html', '/monthly-retainer', 'services'],
  ['pricing.html', '/pricing'],
  ['how-we-work.html', '/how-we-work'],
  ['the-experience.html', '/the-experience'], // published until MS4 301s it into /how-we-work
  ['industries.html', '/industries'],
  ['restaurant-web-design.html', '/restaurant-web-design', 'industries'],
  ['salon-web-design.html', '/salon-web-design', 'industries'],
  ['retail-web-design.html', '/retail-web-design', 'industries'],
  ['home-services-web-design.html', '/home-services-web-design', 'industries'],
  ['health-wellness-web-design.html', '/health-wellness-web-design', 'industries'],
  ['tools.html', '/tools'],
  ['audit.html', '/audit', 'tools'],
  ['ai-critique.html', '/ai-critique', 'tools'],
  ['report-card.html', '/report-card', 'tools'],
  ['roi-calculator.html', '/roi-calculator', 'tools'],
  ['pricing-estimator.html', '/pricing-estimator', 'tools'],
  ['local-visibility.html', '/local-visibility', 'tools'],
  ['about.html', '/about'],
  ['work.html', '/work'], // footer-demoted per P3; keeps full chrome
  ['contact.html', '/contact'],
  ['privacy.html', '/privacy'],
  ['terms.html', '/terms'],
  ['accessibility.html', '/accessibility'],
  ['ai-disclaimer.html', '/ai-disclaimer'],
  ['404.html', null],
];

const REGIONS = ['dds-marketing-nav', 'dds-marketing-footer'];

function extractRegion(source, name, where) {
  const re = new RegExp(`<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->`);
  const m = source.match(re);
  if (!m) throw new Error(`region ${name} not found in ${where}`);
  return m[0];
}

/** Stamp aria-current into a chrome block for one page. */
export function stampAriaCurrent(block, cleanUrl, section) {
  return block.replace(/<a ([^>]*)>/g, (whole, attrs) => {
    const href = (attrs.match(/href="([^"]*)"/) || [])[1];
    const dataNav = (attrs.match(/data-nav="([^"]*)"/) || [])[1];
    if (cleanUrl && href === cleanUrl) return `<a ${attrs} aria-current="page">`;
    if (section && dataNav === section) return `<a ${attrs} aria-current="true">`;
    return whole;
  });
}

/** The normalization the byte-identity pin uses: chrome minus per-page stamps. */
export function normalizeChrome(block) {
  return block.replace(/ aria-current="(?:page|true)"/g, '');
}

function count(haystack, needle) {
  let n = 0, i = -1;
  while ((i = haystack.indexOf(needle, i + 1)) !== -1) n++;
  return n;
}

/** Replace a region in a page; migrate from legacy anatomy if markers absent. */
function placeRegion(html, name, stamped, file) {
  const re = new RegExp(`<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->`);
  // function replacement — a template containing $&, $` or $' must never be
  // interpreted as a replacement pattern (it would silently corrupt all pages)
  if (re.test(html)) return html.replace(re, () => stamped);

  // one-time adoption of a page still carrying hand-copied chrome
  if (name === 'dds-marketing-nav') {
    const SKIP = '<a href="#main-content" class="skip-link">';
    const HEADER = '<header class="nav"';
    if (count(html, SKIP) !== 1 || count(html, HEADER) !== 1) {
      throw new Error(`${file}: ambiguous legacy header anatomy — adopt by hand`);
    }
    const start = html.indexOf(SKIP);
    const headerAt = html.indexOf(HEADER);
    const between = html.slice(html.indexOf('</a>', start) + 4, headerAt);
    if (headerAt < start || between.trim() !== '') {
      throw new Error(`${file}: content between skip-link and header — adopt by hand`);
    }
    const end = html.indexOf('</header>', headerAt);
    if (end === -1) throw new Error(`${file}: unterminated legacy header`);
    return html.slice(0, start) + stamped + html.slice(end + '</header>'.length);
  }

  const FOOTER = '<footer class="site">';
  if (count(html, FOOTER) !== 1) {
    throw new Error(`${file}: ambiguous legacy footer anatomy — adopt by hand`);
  }
  const start = html.indexOf(FOOTER);
  const end = html.indexOf('</footer>', start);
  if (end === -1) throw new Error(`${file}: unterminated legacy footer`);
  return html.slice(0, start) + stamped + html.slice(end + '</footer>'.length);
}

function main() {
  const check = process.argv.includes('--check');
  const template = readFileSync(TEMPLATE, 'utf8');
  const canon = Object.fromEntries(
    REGIONS.map((r) => [r, extractRegion(template, r, 'template')])
  );

  const drifted = [];
  let written = 0;
  for (const [file, cleanUrl, section] of PAGES) {
    const path = join(ROOT, file);
    const before = readFileSync(path, 'utf8');
    let after = before;
    for (const region of REGIONS) {
      const stamped =
        region === 'dds-marketing-nav'
          ? stampAriaCurrent(canon[region], cleanUrl, section)
          : canon[region]; // footer is byte-identical on every page
      after = placeRegion(after, region, stamped, file);
    }
    if (after === before) continue;
    if (check) {
      drifted.push(file);
    } else {
      writeFileSync(path, after);
      written++;
      console.log(`sync-marketing-chrome: wrote ${file}`);
    }
  }

  if (check && drifted.length) {
    console.error(
      `sync-marketing-chrome: DRIFT — ${drifted.length} page(s) diverge from the canonical chrome:\n` +
        drifted.map((f) => `  ${f}`).join('\n') +
        '\nRun: node scripts/sync-marketing-chrome.mjs'
    );
    process.exit(1);
  }
  console.log(
    check
      ? `sync-marketing-chrome: OK — all ${PAGES.length} pages match the canonical chrome`
      : `sync-marketing-chrome: ${written} page(s) written, ${PAGES.length - written} already current`
  );
}

// run only as a CLI — importable (PAGES, stampAriaCurrent, normalizeChrome)
// without side effects, e.g. from tests/e2e/marketing.spec.ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
