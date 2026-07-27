#!/usr/bin/env node
/* ============================================================
   sync-industry-shell.mjs — MS5's one-shell propagator for the
   industry landers (the sibling of sync-marketing-chrome.mjs).

   Reads the canonical shared shell from
   scripts/industry-shell.template.html and rewrites the delimited
   regions

     <!-- dds-industry-approach-head:start --> ... <!-- dds-industry-approach-head:end -->
     <!-- dds-industry-ethos:start -->         ... <!-- dds-industry-ethos:end -->
     <!-- dds-industry-explore:start -->       ... <!-- dds-industry-explore:end -->
     <!-- dds-industry-capture:start -->       ... <!-- dds-industry-capture:end -->
     <!-- dds-industry-closer:start -->        ... <!-- dds-industry-closer:end -->

   in every lander listed in PAGES. Output is committed static
   HTML — no runtime include, so SEO and no-JS behavior are
   untouched. Nothing outside the regions is ever modified: the
   unique content (hero lede, approach paragraph, feature bullets,
   FAQs, schema) is the pages' own.

   Per-page stamping (the only variance between landers):
     - {{industry}} in the closer heading becomes the lander's
       industry phrase (already HTML-escaped in the manifest).

   Modes:
     node scripts/sync-industry-shell.mjs           # write
     node scripts/sync-industry-shell.mjs --check   # verify only,
       exit 1 on drift (used by build-public.sh + marketing.spec.ts)

   industries.html (the hub) is NOT in the manifest: it has its own
   anatomy and no shared shell.
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'scripts', 'industry-shell.template.html');

// [file, industry phrase (HTML-escaped, as it appears in the closer H2)]
export const PAGES = [
  ['restaurant-web-design.html', 'restaurants &amp; bars'],
  ['salon-web-design.html', 'salons &amp; spas'],
  ['retail-web-design.html', 'retail &amp; boutiques'],
  ['home-services-web-design.html', 'home services'],
  ['health-wellness-web-design.html', 'health &amp; wellness'],
];

export const REGIONS = [
  'dds-industry-approach-head',
  'dds-industry-ethos',
  'dds-industry-explore',
  'dds-industry-capture',
  'dds-industry-closer',
];

function extractRegion(source, name, where) {
  const re = new RegExp(`<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->`);
  const m = source.match(re);
  if (!m) throw new Error(`region ${name} not found in ${where}`);
  return m[0];
}

/** Stamp the per-lander industry phrase into a shell region. */
export function stampIndustry(block, industry) {
  // function replacement — an industry phrase containing $&, $` or $' must
  // never be interpreted as a replacement pattern (same law as placeRegion)
  return block.replaceAll('{{industry}}', () => industry);
}

function placeRegion(html, name, stamped, file) {
  // exactly one start and one end marker — a duplicated region would silently
  // pass --check (only the first occurrence is compared) and ship twice
  for (const mark of [`<!-- ${name}:start`, `<!-- ${name}:end -->`]) {
    const n = html.split(mark).length - 1;
    if (n !== 1) throw new Error(`${file}: ${n} occurrences of ${mark} — must be exactly 1`);
  }
  const re = new RegExp(`<!-- ${name}:start[\\s\\S]*?<!-- ${name}:end -->`);
  if (!re.test(html)) throw new Error(`${file}: region ${name} missing — adopt by hand`);
  // function replacement — a template containing $&, $` or $' must never be
  // interpreted as a replacement pattern (it would silently corrupt all pages)
  return html.replace(re, () => stamped);
}

function main() {
  const check = process.argv.includes('--check');
  const template = readFileSync(TEMPLATE, 'utf8');
  const canon = Object.fromEntries(
    REGIONS.map((r) => [r, extractRegion(template, r, 'template')])
  );

  const drifted = [];
  let written = 0;
  for (const [file, industry] of PAGES) {
    const path = join(ROOT, file);
    const before = readFileSync(path, 'utf8');
    let after = before;
    for (const region of REGIONS) {
      after = placeRegion(after, region, stampIndustry(canon[region], industry), file);
    }
    if (after === before) continue;
    if (check) {
      drifted.push(file);
    } else {
      writeFileSync(path, after);
      written++;
      console.log(`sync-industry-shell: wrote ${file}`);
    }
  }

  if (check && drifted.length) {
    console.error(
      `sync-industry-shell: DRIFT — ${drifted.length} lander(s) diverge from the canonical shell:\n` +
        drifted.map((f) => `  ${f}`).join('\n') +
        '\nRun: node scripts/sync-industry-shell.mjs'
    );
    process.exit(1);
  }
  console.log(
    check
      ? `sync-industry-shell: OK — all ${PAGES.length} landers match the canonical shell`
      : `sync-industry-shell: ${written} lander(s) written, ${PAGES.length - written} already current`
  );
}

// run only as a CLI — importable (PAGES, REGIONS, stampIndustry) without
// side effects, e.g. from tests/e2e/marketing.spec.ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
