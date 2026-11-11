// ── No new hard-coded colours in the website editor (builder list item 36, Nov 2026) ──
// The editor's own parts take their colours from the shared settings (var(--plum), var(--clay),
// var(--sage), var(--amber), var(--ink)…), so they follow the light and dark looks. A colour
// written out as #rrggbb in presence.html is allowed only where it is one of the kinds below,
// each with its reason; anything else fails here with the line, so it gets a setting instead.
// A setting's own back-up value, var(--x,#hex), is fine: it only shows if the setting is missing.
//
// The inline styles left from before the new look are capped too: their count may go down,
// never up (a new look belongs in a class in the <style> block).
//
//   deno run --allow-read tests/presence/colour_literals_test.mjs
const ROOT = new URL('../../', import.meta.url);
const src = Deno.readTextFileSync(new URL('presence.html', ROOT));
const lines = src.split('\n');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL  ' + n); } };

// The colours that stay written out, and why.
const ALLOWED = [
  ['a colour setting is defined', (l) => /--[\w-]+\s*:\s*[^;{}]*#[0-9a-f]{3,8}/i.test(l)],
  ['Google’s own result colours in the search preview', (l) => /\.srp-(title|desc)/.test(l)],
  ['white words and dots over a photo', (l) => /\.mcell \.(badge|del|alt|fldot)|\.medit\b/.test(l)],
  ['the publish stage, dark in both looks', (l) => /\.stage\b|\.stagebar|\.papertabs|\.pagewords|\.deskseg|#171320-derived/.test(l)],
  ['white paper standing in for a web page', (l) => /\.ss-frame iframe|\.proof\{|\.dp-frame|\.tg-shot|\.tg-demo/.test(l)],
  ['the hint chip, which stays light in the dark look', (l) => /\.dds-hint|white-on-white/.test(l)],
  ['on the site’s own page in the canvas, not the editor’s cards', (l) => /\.dc-emptyzone/.test(l)],
  ['the canvas reads the shell’s colours, with a back-up', (l) => /\bv\("--dds-[\w-]+",\s*"#/.test(l)],
  ['written into the Preview frame, which has no shell colours', (l) => /\bpvWrite\(/.test(l)],
  ['a site’s colours: template, theme and background choices, and their defaults', (l) => /\b(bg|ink|accent|accent_dark|soft|paper|card|wash|btn|primary|accentDark)\s*:\s*"#|tokens:\s*\{|BG_OPTS|linear-gradient\(135deg,#8c3b2e,#23635a\)|\b[tT]\.(ink|accent|bg)\)?\s*\|\|\s*"#|kit\.primary/.test(l)],
  ['contrast arithmetic against pure white and black', (l) => /\bov(DarkenUntil|Contrast|Mix|Lum)\b|"#(ffffff|000000)"/.test(l)],
  ['an example colour in a field', (l) => /placeholder = "#/.test(l)],
];

// strip what isn't a written-out colour: a setting's back-up value, comments, entities, issue numbers
const styleEnd = src.indexOf('</style>');
const styleEndLine = src.slice(0, styleEnd).split('\n').length;
const found = [];
lines.forEach((raw, i) => {
  let l = raw.replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, '').replace(/\/\*.*?\*\//g, '');
  if (i + 1 > styleEndLine) l = l.replace(/(^|[^:"'`\\])\/\/.*$/, '$1');
  for (const m of l.matchAll(/(?<![&\w])#([0-9a-fA-F]{3,8})\b/g)) {
    if (/^\d+$/.test(m[1]) && !/(color|background|border|fill|stroke)\s*:\s*$/.test(l.slice(0, m.index))) continue;   // #180: an issue number
    found.push({ n: i + 1, hex: m[0].toLowerCase(), raw });
  }
});
const used = new Set();
for (const f of found) {
  const rule = ALLOWED.find(([, t]) => t(f.raw));
  if (rule) used.add(rule[0]);
  ok(`presence.html:${f.n} writes out ${f.hex}; use a colour setting (var(--plum), var(--clay), var(--sage), var(--amber), var(--ink)…) instead: ${f.raw.trim().slice(0, 120)}`, !!rule);
}
ok('the check found the colours it allows (it reads the file)', found.length > 40);
for (const [why] of ALLOWED) ok(`an allowed kind is still in use (else drop it from the list): ${why}`, used.has(why));

// the editor's leftovers from before item 36 stay on the shared settings
ok('the domain change button’s words follow the filled-button ink (they were white on a light purple in the dark look)', src.includes('background:var(--plum,#5b3fa0);color:var(--fill-ink);border-radius:999px;padding:8px 16px;cursor:pointer";'));
ok('the questions’ danger button is clay, not a written red', /border:1px solid var\(--clay\);background:var\(--clay\);color:var\(--fill-ink\)/.test(src));
ok('the contrast check’s chips use the good and bad settings', src.includes('"background:var(--sage-soft);color:var(--sage)" : "background:var(--clay-soft);color:var(--clay)"'));
ok('the filled button’s gradient is one setting: written out only in it and in the canvas’s back-up', lines.filter((l) => l.includes('linear-gradient(135deg,#6d3fd4 0%,#7a4bdd 100%)') && !/--plum-grad:|v\("--dds-grad-btn"/.test(l)).length === 0 && (src.match(/var\(--plum-grad\)/g) || []).length >= 3);

// inline styles: the count may only go down
const CAP = { cssText: 477, attr: 74, prop: 225, oldPlum: 105 };   // Nov 11 2026, when item 36 shipped
const count = (re) => (src.match(re) || []).length;
const now = {
  cssText: count(/\.style\.cssText\s*=/g),
  attr: count(/\sstyle="/g),
  prop: count(/\.style\.(?!cssText\b)[a-zA-Z]+\s*=(?!=)/g),
  oldPlum: count(/#5b3fa0/gi),
};
ok(`style.cssText sites: ${now.cssText}, at most ${CAP.cssText} (use a class instead)`, now.cssText <= CAP.cssText);
ok(`style="" attributes: ${now.attr}, at most ${CAP.attr} (use a class instead)`, now.attr <= CAP.attr);
ok(`.style.x = sites: ${now.prop}, at most ${CAP.prop} (use a class instead)`, now.prop <= CAP.prop);
ok(`the old purple #5b3fa0: ${now.oldPlum} uses, at most ${CAP.oldPlum} (use var(--plum))`, now.oldPlum <= CAP.oldPlum);

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  colour literals — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
