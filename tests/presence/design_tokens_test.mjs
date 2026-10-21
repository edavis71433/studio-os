// ── Design tokens for spacing and motion (benchmark item 11, 2026-10) ────────
//   deno run --allow-read tests/presence/design_tokens_test.mjs
// Pins the sheet: the spacing scale, the corner set, the motion ladder and the
// reduced-motion block live in shell.css; no operator page (and not shell.css)
// declares a transition with a raw second/millisecond value — every one rides
// --dds-t-fast / -base / -slow; and DESIGN-SYSTEM.md names every token.
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const css = read('shell.css');
const shell = read('shell.js');
const doc = read('docs/design/DESIGN-SYSTEM.md');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };

// the operator pages: every root *.html that loads shell.js
const PAGES = [];
for (const e of Deno.readDirSync(new URL('../../', import.meta.url))) {
  if (!e.isFile || !e.name.endsWith('.html')) continue;
  const html = read(e.name);
  if (/<script[^>]*src="\/?shell\.js/.test(html)) PAGES.push(e.name);
}
PAGES.sort();
ok(`the sweep covers the shelled pages (${PAGES.length} found)`, PAGES.length >= 20 && PAGES.includes('today.html') && PAGES.includes('agency.html') && PAGES.includes('crm.html'));

// ═══ the tokens exist, once, on :root (theme-independent) ═══
const STEPS = { s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '20px', s6: '24px', s7: '32px', s8: '40px' };
for (const [k, v] of Object.entries(STEPS)) ok(`spacing: --dds-${k} is ${v}`, new RegExp(`--dds-${k}:${v.replace('.', '\\.')}[;}]`).test(css));
ok('spacing: --dds-gutter is s7 and --dds-card-pad is s4', /--dds-gutter:var\(--dds-s7\)/.test(css) && /--dds-card-pad:var\(--dds-s4\)/.test(css));
ok('spacing: the scale is declared ONCE (a :root block, not per theme)', (css.match(/--dds-s1:/g) || []).length === 1);
ok('spacing: under 761px the scale shrinks one step (s4 → 12, s5 → 16, s7 → 16)', /@media \(max-width:760\.98px\)\{:root\{--dds-s4:12px; --dds-s5:16px; --dds-s7:16px\}\}/.test(css));
ok('corners: sm 6 · r 8 · lg 10 · xl 14', /--dds-r-sm:6px; --dds-r:8px; --dds-r-lg:10px; --dds-r-xl:14px;/.test(css));
ok('motion: fast 120ms · base 200ms · slow 320ms · ease-out', /--dds-t-fast:120ms; --dds-t-base:200ms; --dds-t-slow:320ms; --dds-ease:ease-out;/.test(css));
ok('motion: the ladder is declared once', (css.match(/--dds-t-fast:120ms/g) || []).length === 1);
ok('motion: reduce-motion sets all three durations to 0ms', /@media \(prefers-reduced-motion:reduce\)\{:root\{--dds-t-fast:0ms; --dds-t-base:0ms; --dds-t-slow:0ms\}\}/.test(css));

// ═══ no raw durations on a transition — anywhere an operator page or the shell declares one ═══
// A var() fallback (`var(--dds-t-base,200ms)`) is not a raw value: strip var()
// groups first, then look for a bare number of seconds/milliseconds.
const stripVars = (s) => { let prev; do { prev = s; s = s.replace(/var\([^()]*\)/g, 'V'); } while (s !== prev); return s; };
// (`visibility 0s linear …` is the no-transition-but-delayed idiom, not a duration)
const RAW_TRANSITION = /transition(?:-duration)?\s*[:=]\s*['"]?[^;}{'"]*?(?<![\w.-])(?!0+m?s\b)\d*\.?\d+m?s\b/;
const rawIn = (src) => { const m = RAW_TRANSITION.exec(stripVars(src)); return m ? m[0] : null; };
for (const p of PAGES) {
  const hit = rawIn(read(p).replace(/transition-duration:\.001ms !important/g, ''));   // the builder's reduce-motion stopper is not a transition
  ok(`${p}: no transition with a raw duration${hit ? ` (found: ${hit.slice(0, 60)})` : ''}`, !hit);
}
ok('shell.css: no transition with a raw duration', !rawIn(css));
ok('shell.js: the styles it injects carry no raw transition', !rawIn(shell));
// …and the ladder is actually in use
ok('shell.css transitions ride the ladder with the one curve', /transition:opacity var\(--dds-t-base\) var\(--dds-ease\),transform var\(--dds-t-base\) var\(--dds-ease\)/.test(css));
ok('the pages ride the ladder (fast · base · slow all appear)', PAGES.some((p) => /var\(--dds-t-fast/.test(read(p))) && PAGES.some((p) => /var\(--dds-t-base/.test(read(p))) && PAGES.some((p) => /var\(--dds-t-slow/.test(read(p))));
ok('the pages use the spacing scale', PAGES.filter((p) => /var\(--dds-s[1-8]/.test(read(p))).length === PAGES.length);
ok('the builder’s own --dur/--ease alias the ladder', /--dur:var\(--dds-t-base,200ms\); --ease:var\(--dds-ease,ease-out\);/.test(read('presence.html')));

// ═══ DESIGN-SYSTEM.md names every token ═══
for (const k of Object.keys(STEPS)) ok(`DESIGN-SYSTEM.md names --dds-${k}`, doc.includes(`--dds-${k}`));
for (const k of ['--dds-gutter', '--dds-card-pad', '--dds-t-fast', '--dds-t-base', '--dds-t-slow', '--dds-ease', '--dds-r-sm', '--dds-r-lg', '--dds-r-xl']) ok(`DESIGN-SYSTEM.md names ${k}`, doc.includes(k));
ok('DESIGN-SYSTEM.md names --dds-r', /--dds-r[^-\w]/.test(doc));
ok('DESIGN-SYSTEM.md carries the three rules and links the canvas', /One filled button per view/.test(doc) && /Sentence case/.test(doc) && /761px/.test(doc) && /claude\.ai\/artifact\/BkaE4KvwNxCXXgrNXTke7a/.test(doc));
ok('DESIGN-SYSTEM.md says what reduce motion does', /reduce motion|reduced motion/i.test(doc) && /0ms|become 0|→ 0/.test(doc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
