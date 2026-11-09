// ── The phone and tablet walk (sales list item 43, Nov 2026) ─────────────────
//   deno run --allow-read tests/presence/phone_tablet_walk_test.mjs
// Walked in the iOS Simulator's real Safari (iPhone 17, iPad upright). These pin
// the rules that keep what broke there from coming back — the browser spec
// tests/e2e/phone-tablet-walk.spec.ts measures the same things on the page:
//  · the 44px touch floor reaches every touch screen, not only phone widths,
//    and outranks the sidebar's own icon sizes;
//  · a drop-down on a touch screen is drawn by the app (Safari keeps a native
//    one at its own height whatever min-height says);
//  · the Inbox's script and stylesheet agree on where the panes stack, the two
//    stacked ranges meet with no gap, and a stacked pane is sized to the screen
//    Safari actually shows (dvh), with a vh fallback first;
//  · beside the sidebar, the tip and the toast centre on the content;
//  · the record header puts no separator between the status chip and the email.
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const css = read('shell.css');
const inbox = read('inbox.html');
const crm = read('crm.html');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };

// the bodies of every @media block whose query is exactly `q`; block() → the
// first one that says `must` (shell.css has several (max-width:760.98px) blocks)
function blocks(src, q) {
  const out = [];
  for (let at = src.indexOf('@media ' + q + '{'); at >= 0; at = src.indexOf('@media ' + q + '{', at + 1)) {
    let i = src.indexOf('{', at) + 1, depth = 1;
    const start = i;
    for (; i < src.length && depth; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; }
    out.push(src.slice(start, i - 1));
  }
  return out;
}
const block = (src, q, must = '') => blocks(src, q).find((b) => b.includes(must)) || null;
const selectorsOf = (body, prop) => {
  const out = new Set();
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[2].includes(prop)) for (const s of m[1].split(',')) out.add(s.trim());
  return out;
};

// ═══ shell.css: the touch floor ═══
const phone = block(css, '(max-width:760.98px)', 'min-height:44px');
const touch = block(css, '(pointer:coarse)', 'min-height:44px');
ok('the phone floor (block 4) is still there', !!phone && /min-height:44px/.test(phone));
ok('a (pointer:coarse) block exists — every touch screen, any width', !!touch);
if (phone && touch) {
  const phoneSel = selectorsOf(phone, 'min-height:44px');
  const touchSel = selectorsOf(touch, 'min-height:44px');
  const missing = [...phoneSel].filter((s) => !touchSel.has(s));
  ok(`every control the phone floor lifts is lifted on any touch screen (${phoneSel.size} selectors)`, phoneSel.size >= 6 && missing.length === 0);
  if (missing.length) console.log('   missing from the touch block:', missing.join(' | '));
  ok('touch: the shell icons are 44 × 44, and the sidebar\'s own sizes are outranked (html.dds-side.dds-app)',
    /\.dds-ic,html\.dds-side\.dds-app \.dds-ic,html\.dds-side\.dds-app #dds-waffle\{\s*width:44px;\s*height:44px;\s*\}/.test(touch));
  ok('touch: the sidebar\'s rows and its search are 44px', /html\.dds-side \.dds-nav \.sec > \.it/.test(touch) && /html\.dds-side #dds-search/.test(touch));
  for (const sel of ['.lbtn', '.rowact', '.abtn', '.seg button', '.crow button', '#viewBtn', '[role="tab"]'])
    ok(`touch: ${sel} gets the floor (scoped to the app)`, touchSel.has('html.dds-app ' + sel));
  const drop = touch.match(/html\.dds-app select:not\(\[multiple\]\)\{([^}]*)\}/);
  ok('touch: a drop-down is drawn by the app — 44px AND appearance:none (Safari ignores min-height on a native one)',
    !!drop && /min-height:44px/.test(drop[1]) && /(^|[;\s])appearance:none/.test(drop[1]) && /-webkit-appearance:none/.test(drop[1]) && /background-image:url\(/.test(drop[1]));
  ok('touch: links in a header or a sentence become inline-flex 44px (min-height alone does nothing on an inline link)',
    /\.rec-sub a,html\.dds-app \.dkv a\{\s*display:inline-flex;\s*align-items:center;\s*min-height:44px;\s*\}/.test(touch));
}

// ═══ shell.css: the tip and the toast beside the sidebar ═══
const side = (() => { const re = /@media \(min-width:761px\)\{\s*html\.dds-side \.dds-hint,html\.dds-side \.dds-toast\{left:calc\(50% \+ \(var\(--dds-side-w\) \+ var\(--dds-side-gap\) \* 2\) \/ 2\)\}/; return re.test(css); })();
ok('beside the sidebar the tip and the toast centre on the content, not the window', side);
ok('…and neither is wider than the content', /html\.dds-side \.dds-hint\{max-width:min\(560px,calc\(100vw - var\(--dds-side-w\) - var\(--dds-side-gap\) \* 2 - 32px\)\)\}/.test(css)
  && /html\.dds-side \.dds-toast\{max-width:min\(460px,calc\(100vw - var\(--dds-side-w\) - var\(--dds-side-gap\) \* 2 - 32px\)\)\}/.test(css));

// ═══ inbox.html: where the panes stack ═══
const phoneStack = block(inbox, '(max-width:759px)');
const tabletStack = block(inbox, '(min-width:760px) and (max-width:1023px)');
ok('Inbox: phones stack (≤759px)', !!phoneStack && /\.console\.pane-open \.rpane\{display:flex/.test(phoneStack));
ok('Inbox: an upright iPad stacks too (760–1023px) — the two ranges meet with no gap', !!tabletStack && /\.console\.pane-open \.rpane\{display:flex/.test(tabletStack) && /\.rpane\{display:none\}/.test(tabletStack) && /\.pback\{display:inline-flex\}/.test(tabletStack));
const mq = [...inbox.matchAll(/matchMedia\('\(max-width:(\d+)px\)'\)/g)].map((m) => Number(m[1]));
ok('Inbox: the script moves focus to "← Inbox" over exactly the stacked range (≤1023px)', mq.length === 1 && mq[0] === 1023);
ok('Inbox: no comment or rule still says the split view starts at 760px', !/split view ≥760px/.test(inbox) && !/<760px: push the pane in/.test(inbox));
const dvh = (b) => !!b && /height:calc\(100vh[^;]*\);height:calc\(100dvh[^;]*\)/.test(b);
ok('Inbox: a stacked pane is sized to the screen Safari shows (dvh after a vh fallback) — phones', dvh(phoneStack));
ok('Inbox: …and on an upright iPad', dvh(tabletStack));
ok('Inbox: the phone pane also leaves room for the home-bar inset', !!phoneStack && /100dvh - var\(--dds-shell-h,54px\) - 72px - env\(safe-area-inset-bottom,0px\)/.test(phoneStack));
ok('Inbox: the split view is also sized to the screen Safari shows (an iPad held sideways hid Send under its toolbar)', /\.console\{display:flex;align-items:stretch;height:calc\(100vh - var\(--dds-shell-h,54px\)\);height:calc\(100dvh - var\(--dds-shell-h,54px\)\)/.test(inbox));
const wrap = block(inbox, '(max-width:1279px)');
ok('Inbox: below a wide laptop the pane header and the reply row wrap instead of squeezing', !!wrap && /\.phead\{flex-wrap:wrap/.test(wrap) && /\.crow\{flex-wrap:wrap/.test(wrap) && /\.crow>\.muted\{flex:1 0 100%\}/.test(wrap));
ok('Inbox: where the list column is 21rem, "Send an update" steps aside (it stays under ⋯)',
  /@media \(min-width:1024px\) and \(max-width:1100px\)\{a\.lsend\{display:none\}\}/.test(inbox) && /id="ovfSend"/.test(inbox));

// ═══ crm.html: the record header ═══
ok('record: no separator between the status chip and the email (it dangled at a line end on phones)',
  !/'Prospect'\}<\/span>\$\{bits\.length\?' <span class="sep">/.test(crm) && /'Prospect'\}<\/span>\$\{bits\.length\?' <span>'\+bits\.join\(' <span class="sep">·<\/span> '\)/.test(crm));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
