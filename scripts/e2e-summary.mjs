// ── One device's browser run, in words, for the run's summary page ───────────
//   node scripts/e2e-summary.mjs test-results/results.json desktop-chromium >> "$GITHUB_STEP_SUMMARY"
// Reads Playwright's JSON results (playwright.config.ts writes them on CI) and
// names every flaky and failed test. A test that fails and then passes on its
// retry leaves the run green, so before Nov 8 2026 its name sat in a log nobody
// opened, and every known flaky test was found on a laptop instead.
// Prints Markdown and always exits 0: the test step decides pass or fail.
import { readFileSync } from 'node:fs';
import process from 'node:process';

const [file, device = 'this device'] = process.argv.slice(2);
const out = [`### The browser suite on ${device}`, ''];

let report = null;
try { report = JSON.parse(readFileSync(file, 'utf8')); } catch { /* reported below */ }
if (!report) {
  out.push('No results: the run stopped before the suite finished. The step above says why.', '');
  console.log(out.join('\n'));
  process.exit(0);
}

const flaky = [];
const failed = [];
// A file is the outer suite; describes nest inside it. A test's name is its
// describes and its own title, after the file and line that find it.
function walk(suite, path) {
  const here = suite.file && suite.title === suite.file ? path : [...path, suite.title];
  for (const spec of suite.specs || []) {
    const name = `\`${spec.file}:${spec.line}\` ${[...here, spec.title].filter(Boolean).join(' › ')}`;
    for (const t of spec.tests || []) {
      if (t.status === 'flaky') flaky.push(name);
      else if (t.status === 'unexpected') failed.push(name);
    }
  }
  for (const child of suite.suites || []) walk(child, here);
}
for (const suite of report.suites || []) walk(suite, []);

const st = report.stats || {};
const n = (x) => Number(x || 0).toLocaleString('en-US');
out.push(`${n(st.expected)} passed, ${n(st.flaky)} flaky, ${n(st.unexpected)} failed, ${n(st.skipped)} skipped.`, '');
if (flaky.length) {
  out.push('**Flaky**, each failed once and passed on the retry. The run stays green, but each one is a timing bug in the test or the page:', '');
  for (const x of flaky) out.push(`- ${x}`);
  out.push('');
} else {
  out.push('No flaky tests.', '');
}
if (failed.length) {
  out.push('**Failed:**', '');
  for (const x of failed) out.push(`- ${x}`);
  out.push('');
}
console.log(out.join('\n'));
