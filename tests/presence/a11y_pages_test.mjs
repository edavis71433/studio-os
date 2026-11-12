// ── Builder list item 150 (Nov 2026; review file 05, finding 18) ─────────────
//   deno run --allow-read tests/presence/a11y_pages_test.mjs
// The accessibility scan (axe, WCAG 2 A and AA) covered eight pages; the ones built since
// weren't among them. Each now has a scan in light and dark beside its own fixtures, in
// its own browser spec. This keeps it so: a page whose spec loses its scan, or its dark
// one, fails here, and so does a page added to the list without one.
const PAGES = ['sites', 'domains', 'files', 'analytics', 'projects', 'broadcasts', 'settings', 'connections', 'sharing'];
// and the eight from before, which a11y.spec.ts and the pages' own specs scan in light
const BEFORE = ['today', 'contacts', 'customers', 'inbox', 'pipeline', 'presence', 'help', 'client'];

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const dir = new URL('../e2e/', import.meta.url);
const specs = [];
for (const e of Deno.readDirSync(dir)) if (e.isFile && e.name.endsWith('.spec.ts')) specs.push({ name: e.name, src: Deno.readTextFileSync(new URL(e.name, dir)) });
const opens = (src, page) => new RegExp(`goto\\(['\`]/${page}\\.html`).test(src);
const scans = (src) => /new AxeBuilder\(\{ page \}\)/.test(src);
const bothSchemes = (src) => /for \(const scheme of \['light', 'dark'\] as const\)/.test(src) && /emulateMedia\(\{ colorScheme: scheme \}\)/.test(src);

for (const page of PAGES) {
  const where = specs.filter((s) => opens(s.src, page) && scans(s.src) && bothSchemes(s.src)).map((s) => s.name);
  ok(`${page}.html is scanned in light and dark`, where.length > 0, 'no spec opens it, scans it with axe and loops light and dark');
}
for (const page of BEFORE) {
  ok(`${page}.html is still scanned`, specs.some((s) => opens(s.src, page) && scans(s.src)) || (page === 'client' && /'\/client\.html'/.test(specs.find((s) => s.name === 'a11y.spec.ts')?.src || '')));
}
const passed = results.filter((x) => x.p).length;
console.log(`\n════ ACCESSIBILITY PAGES (item 150): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
