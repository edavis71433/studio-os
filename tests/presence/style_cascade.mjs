// ── What colour a browser gives each word of a page, without a browser ───────────────────────
// A small CSS cascade for pure tests (band_words_test.mjs, Nov 2026). It reads a rendered page's
// own markup and its stylesheets in document order, matches and cascades them the way CSS does
// for the selectors, values and at-rules Studio OS pages use, and answers, for any element: its
// words' colour and what is drawn behind them. It reads one viewport width and the page as first
// drawn: nothing hovered, focused or targeted, and nothing a script builds later.
// Whatever it can't read it lists in `unread` instead of guessing, so a check built on it fails
// loud when the pages outgrow it. When written it agreed with Chromium's computed colours on
// every word of every template's full sample, on both bold bands, with every button set.
// Imports nothing.

// ── markup ──
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// raw text: never elements (noscript too, as a browser with scripts on reads it)
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : ENT[e.toLowerCase()] ?? m);

/** The page as a tree of elements: { tag, attrs, classes, parent, children (elements), text (its
 *  own words, decoded), nodes (its words and elements in order), raw (a raw-text element's
 *  contents) }. */
export function parseHtml(html) {
  const root = { tag: '#document', attrs: {}, classes: new Set(), parent: null, children: [], nodes: [], text: '' };
  const stack = [root];
  const tagRe = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  let last = 0, m;
  const text = (s) => { if (s) { const t = decode(s), top = stack[stack.length - 1]; top.text += t; top.nodes.push(t); } };
  while ((m = tagRe.exec(html))) {
    text(html.slice(last, m.index));
    last = tagRe.lastIndex;
    if (m[1]) {   // an end tag closes the nearest open element of its name
      const t = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === t) { stack.length = k; break; }
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase(), attrs = {};
    for (const a of m[3].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    const parent = stack[stack.length - 1];
    const el = { tag, attrs, classes: new Set((attrs.class || '').split(/\s+/).filter(Boolean)), parent, children: [], nodes: [], text: '' };
    parent.children.push(el); parent.nodes.push(el);
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      el.raw = html.slice(last, end < 0 ? html.length : end);
      tagRe.lastIndex = last = end < 0 ? html.length : html.indexOf('>', end) + 1;
      continue;
    }
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return root;
}
/** All the words under an element, in order (the DOM's textContent). */
export const textOf = (el) => (el.raw ?? '') + el.nodes.map((n) => (typeof n === 'string' ? n : textOf(n))).join('');
/** Every element under `node`, in document order. */
export function* elementsIn(node) { for (const c of node.children) { yield c; yield* elementsIn(c); } }

// ── stylesheets ──
/** Split `s` at `sep` where it isn't inside brackets or quotes. */
function splitTop(s, sep) {
  const out = []; let d = 0, q = '', cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { cur += c + s[++i]; continue; } if (c === q) q = ''; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') d--;
    else if (c === sep && !d) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
/** Where the block that opens at `open` closes. */
function blockEnd(s, open) {
  let d = 0, q = '';
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '{') d++;
    else if (c === '}' && --d === 0) return i;
  }
  return s.length;
}
const px = (v, unit) => Number(v) * (unit === 'em' || unit === 'rem' ? 16 : 1);
/** Does a media query list hold at this viewport? Unknown features are noted and don't hold. */
function mediaHolds(q, env, unread) {
  return splitTop(q, ',').some((one) => {
    let s = one.trim().toLowerCase(), neg = false;
    if (s.startsWith('not ')) { neg = true; s = s.slice(4); }
    s = s.replace(/^only\s+/, '');
    const ok = s.split(/\s+and\s+/).every((part) => {
      part = part.trim();
      if (part === 'screen' || part === 'all') return true;
      if (part === 'print' || part === 'speech') return false;
      const f = /^\(\s*([\w-]+)\s*(?::\s*([^)]*))?\)$/.exec(part);
      if (!f) { unread.add(`@media ${q}`); return false; }
      const [, name, raw = ''] = f, val = raw.trim(), n = /^([\d.]+)(px|em|rem)?$/.exec(val);
      switch (name) {
        case 'min-width': return n ? env.width >= px(n[1], n[2]) : (unread.add(`@media ${q}`), false);
        case 'max-width': return n ? env.width <= px(n[1], n[2]) : (unread.add(`@media ${q}`), false);
        case 'prefers-reduced-motion': return val === 'no-preference';
        case 'prefers-color-scheme': return val === 'light';
        case 'prefers-contrast': return val === 'no-preference';
        case 'forced-colors': return val === 'none';
        case 'hover': case 'any-hover': return val === 'hover';
        case 'pointer': case 'any-pointer': return val === 'fine';
        case 'orientation': return val === (env.width > env.height ? 'landscape' : 'portrait');
        default: unread.add(`@media ${q}`); return false;
      }
    });
    return neg ? !ok : ok;
  });
}

// ── selectors ──
const NO_STATE = new Set(['hover', 'active', 'focus', 'focus-visible', 'focus-within', 'target', 'target-within', 'visited', 'user-invalid', 'user-valid', 'autofill', '-webkit-autofill', 'fullscreen', 'modal', 'popover-open', 'playing', 'paused', 'indeterminate']);
const PSEUDO_EL = new Set(['before', 'after', 'placeholder', 'marker', 'selection', 'first-line', 'first-letter', 'backdrop', 'file-selector-button', '-webkit-details-marker', '-webkit-input-placeholder', '-webkit-scrollbar', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track']);
/** A selector list as complex selectors: each a list of compounds right to left, a compound
 *  { parts, pseudo, comb (how the compound on its left relates to it) }. */
function parseSelectorList(text, unread) { return splitTop(text, ',').map((s) => parseComplex(s.trim(), unread)).filter(Boolean); }
function parseComplex(sel, unread) {
  const compounds = []; let cur = { parts: [], any: false, pseudo: null }, i = 0;
  const flush = (comb) => { compounds.push(cur); cur = { parts: [], any: false, pseudo: null }; compounds[compounds.length - 1].combLeft = comb; };
  while (i < sel.length) {
    const c = sel[i];
    if (/\s|>|\+|~/.test(c)) {
      let j = i, comb = ' ';
      while (j < sel.length && /\s|>|\+|~/.test(sel[j])) { if (!/\s/.test(sel[j])) comb = sel[j]; j++; }
      if (cur.parts.length || cur.pseudo || cur.any) flush(comb);
      i = j; continue;
    }
    let m;
    if (c === '*') { cur.any = true; i += 1; continue; }
    if ((m = /^[a-zA-Z][\w-]*/.exec(sel.slice(i)))) { cur.parts.push({ k: 'tag', v: m[0].toLowerCase() }); i += m[0].length; continue; }
    if ((m = /^#(-?[_a-zA-Z][\w-]*)/.exec(sel.slice(i)))) { cur.parts.push({ k: 'id', v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\.(-?[_a-zA-Z][\w-]*)/.exec(sel.slice(i)))) { cur.parts.push({ k: 'class', v: m[1] }); i += m[0].length; continue; }
    if (c === '[') {
      const end = sel.indexOf(']', i), body = sel.slice(i + 1, end);
      const a = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*$/.exec(body);
      if (!a) { unread.add(`selector ${sel}`); return null; }
      cur.parts.push({ k: 'attr', name: a[1].toLowerCase(), op: a[2], v: a[3] ?? a[4] ?? a[5], ci: !!a[6] });
      i = end + 1; continue;
    }
    if (c === ':') {
      const el = sel[i + 1] === ':';
      const nm = /^[\w-]+/.exec(sel.slice(i + (el ? 2 : 1)));
      if (!nm) { unread.add(`selector ${sel}`); return null; }
      const name = nm[0].toLowerCase(); i += (el ? 2 : 1) + nm[0].length;
      let arg = null;
      if (sel[i] === '(') { let d = 1, j = i + 1; while (j < sel.length && d) { if (sel[j] === '(') d++; else if (sel[j] === ')') d--; j++; } arg = sel.slice(i + 1, j - 1); i = j; }
      if (el || ['before', 'after', 'first-line', 'first-letter'].includes(name)) {
        if (!PSEUDO_EL.has(name)) unread.add(`selector ${sel}`);
        cur.pseudo = name === '-webkit-input-placeholder' ? 'placeholder' : name; continue;
      }
      cur.parts.push(pseudoClass(name, arg, sel, unread));
      continue;
    }
    unread.add(`selector ${sel}`); return null;
  }
  if (cur.parts.length || cur.pseudo || cur.any || !compounds.length) compounds.push(cur);
  // right to left: the subject first; comb = how the next one (to its left) relates
  const out = compounds.reverse().map((x, k, all) => ({ parts: x.parts, pseudo: x.pseudo, comb: k + 1 < all.length ? all[k + 1].combLeft : null }));
  return { compounds: out, spec: specOf(out), text: sel };
}
function pseudoClass(name, arg, sel, unread) {
  if (['is', 'where', 'matches', '-webkit-any', 'not', 'has'].includes(name)) {
    if (name === 'has') return { k: 'has', list: splitTop(arg, ',').map((s) => s.trim()).map((r) => { const m = /^([>+~])?\s*(.*)$/.exec(r); return { comb: m[1] || ' ', sel: parseComplex(m[2], unread) }; }) };
    return { k: name === 'not' ? 'not' : name === 'where' ? 'where' : 'is', list: parseSelectorList(arg, unread) };
  }
  if (/^nth-(last-)?(child|of-type)$/.test(name)) {
    const [an, of] = arg.split(/\s+of\s+/);
    const s = an.trim().toLowerCase().replace(/\s+/g, '');
    const m = s === 'odd' || s === 'even' ? [] : /^([+-]?\d*)n([+-]\d+)?$/.exec(s) || /^([+-]?\d+)$/.exec(s);
    if (!m) { unread.add(`selector ${sel}`); return { k: 'never' }; }
    const a = s === 'odd' || s === 'even' ? 2 : s.includes('n') ? (m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1])) : 0;
    const b = s === 'odd' ? 1 : s === 'even' ? 0 : s.includes('n') ? Number(m[2] || 0) : Number(m[1]);
    return { k: 'nth', last: name.includes('last'), type: name.endsWith('of-type'), a, b, of: of ? parseSelectorList(of, unread) : null };
  }
  const simple = { 'first-child': [false, false], 'last-child': [true, false], 'first-of-type': [false, true], 'last-of-type': [true, true] }[name];
  if (simple) return { k: 'nth', a: 0, b: 1, last: simple[0], type: simple[1], of: null };
  if (NO_STATE.has(name)) return { k: 'never' };
  if (['only-child', 'only-of-type', 'empty', 'root', 'checked', 'disabled', 'enabled', 'required', 'optional', 'placeholder-shown', 'link', 'any-link', 'defined', 'scope', 'read-only', 'read-write'].includes(name)) return { k: 'state', name };
  unread.add(`selector ${sel}`);
  return { k: 'never' };
}
const add = (x, y) => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
const cmpSpec = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
const most = (list) => list.reduce((best, s) => (cmpSpec(s.spec, best) > 0 ? s.spec : best), [0, 0, 0]);
function specOf(compounds) {
  let s = [0, 0, 0];
  for (const c of compounds) {
    if (c.pseudo) s = add(s, [0, 0, 1]);
    for (const p of c.parts) {
      if (p.k === 'id') s = add(s, [1, 0, 0]);
      else if (p.k === 'tag') s = add(s, [0, 0, 1]);
      else if (p.k === 'is' || p.k === 'not') s = add(s, most(p.list));
      else if (p.k === 'has') s = add(s, most(p.list.map((r) => r.sel).filter(Boolean)));
      else if (p.k === 'where') { /* adds nothing */ }
      else if (p.k === 'nth' && p.of) s = add(add(s, [0, 1, 0]), most(p.of));
      else s = add(s, [0, 1, 0]);
    }
  }
  return s;
}
const siblingsOf = (el) => (el.parent ? el.parent.children : [el]);
function nthMatch(el, p) {
  const sibs = siblingsOf(el).filter((s) => (!p.type || s.tag === el.tag) && (!p.of || p.of.some((x) => matches(s, x))));
  const idx = sibs.indexOf(el); if (idx < 0) return false;
  const n = p.last ? sibs.length - idx : idx + 1;
  if (!p.a) return n === p.b;
  const k = (n - p.b) / p.a;
  return Number.isInteger(k) && k >= 0;
}
function partMatches(el, p) {
  switch (p.k) {
    case 'tag': return el.tag === p.v;
    case 'id': return el.attrs.id === p.v;
    case 'class': return el.classes.has(p.v);
    case 'attr': {
      if (!(p.name in el.attrs)) return false;
      if (!p.op) return true;
      let have = el.attrs[p.name], want = p.v;
      if (p.ci) { have = have.toLowerCase(); want = want.toLowerCase(); }
      switch (p.op) {
        case '=': return have === want;
        case '~=': return have.split(/\s+/).includes(want);
        case '|=': return have === want || have.startsWith(want + '-');
        case '^=': return !!want && have.startsWith(want);
        case '$=': return !!want && have.endsWith(want);
        case '*=': return !!want && have.includes(want);
      }
      return false;
    }
    case 'is': case 'where': return p.list.some((x) => matches(el, x));
    case 'not': return !p.list.some((x) => matches(el, x));
    case 'has': return p.list.some((r) => {
      if (!r.sel) return false;
      if (r.comb === '>') return el.children.some((c) => matches(c, r.sel));
      if (r.comb === ' ') return [...elementsIn(el)].some((c) => matches(c, r.sel));
      const sibs = siblingsOf(el), i = sibs.indexOf(el);
      return sibs.slice(i + 1, r.comb === '+' ? i + 2 : undefined).some((c) => matches(c, r.sel));
    });
    case 'nth': return nthMatch(el, p);
    case 'never': return false;
    case 'state': {
      const a = el.attrs, field = ['input', 'textarea', 'select', 'button'].includes(el.tag);
      switch (p.name) {
        case 'only-child': return siblingsOf(el).length === 1;
        case 'only-of-type': return siblingsOf(el).filter((s) => s.tag === el.tag).length === 1;
        case 'empty': return !el.children.length && !el.text && !el.raw;
        case 'root': case 'scope': return el.tag === 'html';
        case 'checked': return (el.tag === 'input' && /^(checkbox|radio)$/.test(a.type || '') && 'checked' in a) || (el.tag === 'option' && 'selected' in a);
        case 'disabled': return field && 'disabled' in a;
        case 'enabled': return field && !('disabled' in a);
        case 'required': return field && 'required' in a;
        case 'optional': return field && !('required' in a);
        case 'placeholder-shown': return (el.tag === 'input' || el.tag === 'textarea') && 'placeholder' in a && !(a.value || el.raw);
        case 'link': case 'any-link': return (el.tag === 'a' || el.tag === 'area') && 'href' in a;
        case 'defined': return true;
        case 'read-only': return !(field && !('readonly' in a)) && el.attrs.contenteditable === undefined;
        case 'read-write': return field && !('readonly' in a);
      }
    }
  }
  return false;
}
const compoundMatches = (el, c) => c.parts.every((p) => partMatches(el, p));
/** Does `el` match a complex selector (its pseudo-element aside)? */
function matches(el, complex, k = 0) {
  if (!complex || el.tag === '#document') return false;
  const c = complex.compounds[k];
  if (!compoundMatches(el, c)) return false;
  if (k + 1 === complex.compounds.length) return true;
  switch (c.comb) {
    case '>': return !!el.parent && matches(el.parent, complex, k + 1);
    case ' ': for (let a = el.parent; a && a.tag !== '#document'; a = a.parent) if (matches(a, complex, k + 1)) return true; return false;
    case '+': { const s = siblingsOf(el), i = s.indexOf(el); return i > 0 && matches(s[i - 1], complex, k + 1); }
    case '~': { const s = siblingsOf(el), i = s.indexOf(el); return s.slice(0, i).some((x) => matches(x, complex, k + 1)); }
  }
  return false;
}

// ── the browser's own styles, the little of them these pages lean on ──
const UA = `[hidden],head,script,style,template,title,meta,link,noscript,input[type=hidden]{display:none}
a:any-link{color:#0000ee;text-decoration:underline}
input,textarea,select{color:fieldtext;background-color:field}
button{color:buttontext;background-color:buttonface}
input::placeholder,textarea::placeholder{color:#757575}
mark{background-color:mark;color:marktext}`;

// ── colours ──
const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1], yellow: [255, 255, 0, 1], darkgray: [169, 169, 169, 1], darkgrey: [169, 169, 169, 1], gray: [128, 128, 128, 1], grey: [128, 128, 128, 1] };
// the system colours, light and dark (a page that says color-scheme:dark gets the dark ones)
const SYSTEM = {
  light: { canvas: [255, 255, 255, 1], canvastext: [0, 0, 0, 1], field: [255, 255, 255, 1], fieldtext: [0, 0, 0, 1], buttonface: [239, 239, 239, 1], buttontext: [0, 0, 0, 1], mark: [255, 255, 0, 1], marktext: [0, 0, 0, 1] },
  dark: { canvas: [18, 18, 18, 1], canvastext: [255, 255, 255, 1], field: [59, 59, 59, 1], fieldtext: [255, 255, 255, 1], buttonface: [107, 107, 107, 1], buttontext: [255, 255, 255, 1], mark: [255, 255, 0, 1], marktext: [0, 0, 0, 1] },
};
/** A colour value (vars already in) as [r, g, b, a]; `current` stands for currentColor. Null if
 *  unread. */
function parseColour(v, current, scheme) {
  const s = v.trim().toLowerCase();
  if (s === 'currentcolor') return current;
  if (NAMED[s]) return NAMED[s];
  if (SYSTEM[scheme][s]) return SYSTEM[scheme][s];
  let m;
  if ((m = /^#([\da-f]{3,8})$/.exec(s))) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return [...h].map((c, i) => (i < 3 ? parseInt(c + c, 16) : parseInt(c + c, 16) / 255)).concat(h.length === 3 ? [1] : []);
    if (h.length === 6 || h.length === 8) return [0, 2, 4, 6].slice(0, h.length / 2).map((i, k) => (k < 3 ? parseInt(h.slice(i, i + 2), 16) : parseInt(h.slice(i, i + 2), 16) / 255)).concat(h.length === 6 ? [1] : []);
    return null;
  }
  if ((m = /^rgba?\((.*)\)$/.exec(s))) {
    const p = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (p.length < 3) return null;
    const ch = (x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x));
    const al = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    return [ch(p[0]), ch(p[1]), ch(p[2]), al];
  }
  if ((m = /^color-mix\(\s*in\s+srgb\s*,(.*)\)$/.exec(s))) {
    const [x, y] = splitTop(m[1], ',').map((t) => { const pm = /^(.*?)\s+([\d.]+)%$/.exec(t.trim()); return pm ? { c: parseColour(pm[1], current, scheme), p: Number(pm[2]) / 100 } : { c: parseColour(t, current, scheme), p: null }; });
    if (!x?.c || !y?.c) return null;
    let p1 = x.p, p2 = y.p;
    if (p1 === null && p2 === null) { p1 = p2 = 0.5; } else if (p1 === null) p1 = 1 - p2; else if (p2 === null) p2 = 1 - p1;
    const sum = p1 + p2; if (!sum) return null;
    const scale = Math.min(sum, 1); p1 /= sum; p2 /= sum;
    const a = x.c[3] * p1 + y.c[3] * p2;   // premultiplied, as CSS Color 5 mixes
    const rgb = a ? [0, 1, 2].map((i) => (x.c[i] * x.c[3] * p1 + y.c[i] * y.c[3] * p2) / a) : [0, 0, 0];
    return [...rgb, a * scale];
  }
  return null;
}
/** `top` drawn over an opaque `under`. */
export const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat([1]);
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
/** WCAG 2 contrast of two opaque colours. */
export const contrastOf = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const hexOf = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// ── the cascade ──
/** The stylesheets under `node` (a page, or its head or body), in document order: <style>
 *  elements and linked sheets (`files` maps a path such as assets/site-1.css to its text). */
export function sheetsOf(node, files) {
  const out = [];
  for (const el of elementsIn(node)) {
    if (el.tag === 'style' && /^\s*(screen|all)?\s*$/i.test(el.attrs.media || '')) out.push(el.raw);
    else if (el.tag === 'link' && /\bstylesheet\b/i.test(el.attrs.rel || '') && el.attrs.href) {
      const text = files[el.attrs.href.replace(/^\//, '').replace(/[?#].*$/, '')];
      out.push(typeof text === 'string' ? text : null);
    }
  }
  return out;
}

// A stylesheet is read once per viewport: its rules (media and @supports worked out) and an
// index by each selector's subject (its id, a class or its tag), so an element tries only the
// rules that could match it. What one sheet matches on an element is kept on the element, so
// the same page drawn with another button set or palette only matches what is new.
const SHEETS = new Map();
let sheetIds = 0;
function readSheet(css, env) {
  const view = `${env.width}x${env.height}`;
  let byText = SHEETS.get(view);
  if (!byText) SHEETS.set(view, byText = new Map());
  const known = byText.get(css);
  if (known) return known;
  const unread = new Set(), rules = [];
  let order = 0;
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (from, to) => {
    for (let i = from; i < to;) {
      const open = s.indexOf('{', i), semi = s.indexOf(';', i);
      if (semi >= 0 && semi < to && (open < 0 || semi < open) && s.slice(i, semi).trim().startsWith('@')) { i = semi + 1; continue; }   // @import, @charset
      if (open < 0 || open >= to) break;
      const close = blockEnd(s, open), head = s.slice(i, open).trim(), body = s.slice(open + 1, close);
      i = close + 1;
      if (head.startsWith('@media')) { if (mediaHolds(head.slice(6).trim(), env, unread)) walk(open + 1, close); }
      else if (head.startsWith('@supports')) { if (!/^@supports\s+not\b/.test(head)) walk(open + 1, close); }
      else if (/^@(keyframes|-webkit-keyframes|font-face|page|property|counter-style|font-feature-values)\b/.test(head)) { /* draws no words' colours */ }
      else if (head.startsWith('@')) unread.add(head.split(/[\s{(]/)[0]);
      else {
        const decls = declsOf(body).flatMap((d) => longhands(d.prop, d.value).map(([prop, value]) => ({ prop, value, important: d.important })));
        if (!decls.length) continue;
        const o = order++;
        for (const sel of parseSelectorList(head, unread)) rules.push({ sel, decls, order: o });
      }
    }
  };
  walk(0, s.length);
  const index = new Map(), keyOf = (c) => { const p = c.parts.find((x) => x.k === 'id') || c.parts.find((x) => x.k === 'class') || c.parts.find((x) => x.k === 'tag'); return p ? `${p.k}:${p.v}` : '*'; };
  for (const r of rules) { const k = keyOf(r.sel.compounds[0]); if (!index.has(k)) index.set(k, []); index.get(k).push(r); }
  const sheet = { id: sheetIds++, rules, index, unread };
  byText.set(css, sheet);
  return sheet;
}
/** The rules of one sheet that match an element or one of its pseudo-elements. */
function hitsIn(sheet, el, pseudo) {
  const per = (el.hits ||= new Map()), key = `${sheet.id}|${pseudo}`;
  const known = per.get(key);
  if (known) return known;
  const { index } = sheet, seen = new Set(), hits = [];
  const cands = [index.get('*'), el.attrs.id && index.get(`id:${el.attrs.id}`), ...[...el.classes].map((c) => index.get(`class:${c}`)), index.get(`tag:${el.tag}`)];
  for (const list of cands) if (list) for (const r of list) {
    if (seen.has(r)) continue; seen.add(r);
    if ((r.sel.compounds[0].pseudo || null) === pseudo && matches(el, r.sel)) hits.push(r);
  }
  per.set(key, hits);
  return hits;
}
const UA_SHEET = (env) => readSheet(UA, env);
const CUSTOM = Symbol('custom properties');

/** A page's cascade at one viewport (env: { width, height, later, root }). `sheets` as sheetsOf
 *  gives them (null: a linked sheet the files don't have, noted in `unread`). env.root holds
 *  custom properties for the page's :root, as a :root rule after every sheet would set them (a
 *  palette's style layer, a button set's colours): an html:root rule still outranks them. */
export function cascade(doc, sheets, env = { width: 1280, height: 900 }) {
  const unread = new Set();
  if (sheets.includes(null)) unread.add('a linked stylesheet the files lack');
  const list = [UA_SHEET(env), ...sheets.filter((x) => x !== null).map((css) => readSheet(css, env))];
  list.forEach((sh) => sh.unread.forEach((u) => unread.add(u)));
  const listKey = list.map((sh) => sh.id).join(',');
  const html = doc.children.find((c) => c.tag === 'html');
  const rootRaw = env.root || {};
  let rootWon;   // the page's :root with env.root over it: this cascade's own
  /** The winning declaration of every property, for an element or one of its pseudo-elements. */
  function winners(el, pseudo = null) {
    const own = el === html && !pseudo && Object.keys(rootRaw).length;
    if (own && rootWon) return rootWon;
    const per = (el.won ||= new Map()), key = pseudo ? `${listKey}|${pseudo}` : listKey;
    const known = !own && per.get(key);
    if (known) return known;
    const won = {};
    const rank = (x) => (x.important ? (x.inline ? 3 : 2) : 1) * 4 + (x.ua ? 0 : x.inline ? 2 : 1);
    const offer = (prop, d) => {
      const cur = won[prop];
      if (!cur) { won[prop] = d; return; }
      const a = rank(d), b = rank(cur);
      if (a !== b ? a > b : (cmpSpec(d.spec, cur.spec) || d.order - cur.order) > 0) won[prop] = d;
    };
    list.forEach((sheet, k) => {
      for (const r of hitsIn(sheet, el, pseudo)) for (const d of r.decls) offer(d.prop, { value: d.value, important: d.important, spec: r.sel.spec, order: k * 1e7 + r.order, ua: k === 0 });
    });
    if (own) for (const [prop, value] of Object.entries(rootRaw)) offer(prop, { value, important: false, spec: [0, 1, 0], order: list.length * 1e7, ua: false });
    if (!pseudo && el.attrs.style) for (const d of declsOf(el.attrs.style)) for (const [prop, value] of longhands(d.prop, d.value)) offer(prop, { value, important: d.important, spec: [0, 0, 0], order: Infinity, ua: false, inline: true });
    Object.defineProperty(won, CUSTOM, { value: Object.keys(won).filter((p) => p.startsWith('--')) });
    if (own) rootWon = won; else per.set(key, won);
    return won;
  }
  // this cascade's answers, per element: a property's value under its own name, what is worked
  // out from it under a name starting with #
  const memo = new Map();
  const remember = (el, key, make) => { let per = memo.get(el); if (!per) memo.set(el, per = new Map()); if (per.has(key)) return per.get(key); const v = make(); per.set(key, v); return v; };
  const top = (el) => !el.parent || el.parent.tag === '#document';
  /** Custom properties, computed and inherited. */
  function customsOf(el, pseudo = null) {
    return remember(el, pseudo ? `#--${pseudo}` : '#--', () => {
      const parent = pseudo ? customsOf(el) : top(el) ? {} : customsOf(el.parent);
      const mine = Object.create(parent), raw = {};   // inherited through the prototype
      const won = winners(el, pseudo);
      for (const p of won[CUSTOM]) raw[p] = won[p].value;
      const resolving = new Set();
      const compute = (p) => {
        if (resolving.has(p)) return undefined;   // a cycle: invalid
        resolving.add(p);
        const v = substitute(raw[p], (n) => (n in raw ? compute(n) : parent[n]));
        resolving.delete(p);
        return v;
      };
      for (const p of Object.keys(raw)) { const v = compute(p); if (v === undefined || v.trim() === 'initial') mine[p] = undefined; else if (v.trim() !== 'inherit') mine[p] = v.trim(); }
      return mine;
    });
  }
  /** A property's value with its vars in, or null where nothing sets it (or a var is missing). */
  function computedRaw(el, prop, pseudo = null) {
    return remember(el, pseudo ? `${prop}|${pseudo}` : prop, () => {
      const d = winners(el, pseudo)[prop];
      return d ? substitute(d.value, (n) => customsOf(el, pseudo)[n]) ?? null : null;
    });
  }
  let schemeSeen;
  const schemeOf = () => (schemeSeen ??= (() => { const v = html ? computedRaw(html, 'color-scheme') : null; return v && /\bdark\b/.test(v) && !/\blight\b/.test(v) ? 'dark' : 'light'; })());
  /** The words' colour, [r, g, b, a]. */
  function colourOf(el, pseudo = null) {
    return remember(el, pseudo ? `#color|${pseudo}` : '#color', () => {
      const inherited = pseudo ? colourOf(el) : top(el) ? SYSTEM[schemeOf()].canvastext : colourOf(el.parent);
      const v = computedRaw(el, 'color', pseudo);
      if (v === null || /^(inherit|unset|currentcolor)$/i.test(v.trim())) return inherited;
      if (/^initial$/i.test(v.trim())) return SYSTEM[schemeOf()].canvastext;
      const c = parseColour(v, inherited, schemeOf());
      if (!c) unread.add(`color: ${v}`);
      return c || inherited;
    });
  }
  /** Its own background colour, [r, g, b, a], and whether it has a background image. */
  function backgroundOf(el, pseudo = null) {
    return remember(el, pseudo ? `#bg|${pseudo}` : '#bg', () => {
      const v = computedRaw(el, 'background-color', pseudo), img = computedRaw(el, 'background-image', pseudo);
      let c = NAMED.transparent;
      if (v !== null && !/^(transparent|none|initial|unset)$/i.test(v.trim())) {
        if (/^inherit$/i.test(v.trim())) c = top(el) ? c : backgroundOf(el.parent).colour;
        else c = parseColour(v, colourOf(el, pseudo), schemeOf()) || (unread.add(`background-color: ${v}`), c);
      }
      return { colour: c, image: !!img && !/^(none|initial|unset)$/i.test(img.trim()) };
    });
  }
  /** Is it drawn for people to read: visible, on the page, not clipped to nothing or a 1px box
   *  (a form's trap for robots, words for screen readers)? With env.later, words that show
   *  later count too: a closed answer, another tab, a photo opened large, a phone-only line
   *  (display:none drops them otherwise). */
  function drawn(el) {
    return remember(el, '#drawn', () => {
      if (!env.later && /^none$/i.test(computedRaw(el, 'display') || '')) return false;
      const pos = computedRaw(el, 'position') || '', left = parseFloat(computedRaw(el, 'left') || ''), clip = computedRaw(el, 'clip') || '';
      if (/^(absolute|fixed)$/.test(pos.trim()) && left <= -999) return false;
      if (/rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(clip)) return false;
      if (/^1px$/.test((computedRaw(el, 'width') || '').trim()) && /^1px$/.test((computedRaw(el, 'height') || '').trim()) && /hidden/.test(computedRaw(el, 'overflow') || '')) return false;
      if (/^(hidden|collapse)$/.test((visibilityOf(el) || '').trim())) return false;
      return top(el) || drawn(el.parent);
    });
  }
  const visibilityOf = (el) => remember(el, '#visibility', () => computedRaw(el, 'visibility') ?? (top(el) ? 'visible' : visibilityOf(el.parent)));
  /** What is drawn behind an element's words: its own fill over its ancestors', down to the
   *  first solid one (the page's canvas below them all). */
  function behind(el, pseudo = null) {
    return remember(el, pseudo ? `#behind|${pseudo}` : '#behind', () => {
      const own = backgroundOf(el, pseudo);
      const under = pseudo ? behind(el) : own.colour[3] >= 1 || top(el) ? { colour: SYSTEM[schemeOf()].canvas, image: false } : behind(el.parent);
      return { colour: own.colour[3] > 0 ? over(own.colour, under.colour) : under.colour, image: own.image || under.image };
    });
  }
  const opacityOf = (el) => remember(el, '#opacity', () => { const v = parseFloat(computedRaw(el, 'opacity') ?? ''); return (isNaN(v) ? 1 : v) * (top(el) ? 1 : opacityOf(el.parent)); });
  /** Every word an element draws: its own words, a box's value or example words, and words
   *  its ::before/::after put in. Each with its colour over what's behind it. */
  function words(el) {
    const field = el.tag === 'textarea' || el.tag === 'select' || (el.tag === 'input' && !/^(hidden|checkbox|radio|range|color|file|image)$/i.test(el.attrs.type || ''));
    const content = (pe) => { const v = computedRaw(el, 'content', pe); return v && !/^(none|normal|""|'')$/.test(v.trim()) ? v.trim() : null; };
    if (!el.text.trim() && !field && !content('before') && !content('after')) return [];
    if (!drawn(el)) return [];
    const out = [], op = opacityOf(el);
    const put = (what, fg, bg, image) => { const f = over([fg[0], fg[1], fg[2], fg[3] * op], bg); out.push({ el, what, fg: f, bg, image, ratio: contrastOf(f, bg) }); };
    const b = behind(el);
    if (el.text.trim() || field) put(el.text.trim() || el.attrs.value || el.raw || '(box)', colourOf(el), b.colour, b.image);
    for (const pe of ['before', 'after']) {
      const what = content(pe);
      if (!what || /^none$/i.test(computedRaw(el, 'display', pe) || '')) continue;
      const pb = behind(el, pe);
      put(`::${pe} ${what.replace(/\\([\da-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))}`, colourOf(el, pe), pb.colour, pb.image);
    }
    if ((el.tag === 'input' || el.tag === 'textarea') && el.attrs.placeholder && !(el.attrs.value || el.raw)) {
      const ph = colourOf(el, 'placeholder'), o = computedRaw(el, 'opacity', 'placeholder');
      put(`::placeholder ${el.attrs.placeholder}`, [ph[0], ph[1], ph[2], ph[3] * (o === null ? 1 : parseFloat(o))], b.colour, b.image);
    }
    return out;
  }
  return { words, colourOf, behind, drawn, computedRaw, unread };
}

/** Declarations of a rule body: [{ prop, value, important }]. */
function declsOf(body) {
  return splitTop(body, ';').map((d) => {
    const i = d.indexOf(':'); if (i < 0) return null;
    const prop = d.slice(0, i).trim(), rest = d.slice(i + 1).trim();
    if (!prop || !rest) return null;
    const imp = /!\s*important\s*$/i.test(rest);
    return { prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value: imp ? rest.replace(/!\s*important\s*$/i, '').trim() : rest, important: imp };
  }).filter(Boolean);
}
/** The longhands a declaration sets that this cascade reads: `background` sets its colour and
 *  image (worked out once its vars are in, see substitute()). */
function longhands(prop, value) {
  if (prop === 'background') return [['background-color', `background(${value})`], ['background-image', `background-image(${value})`]];
  return [[prop, value]];
}
/** var() substitution, then the background shorthand's parts. `get(name)` is a custom property's
 *  computed value or undefined. Undefined when a var with no fallback is missing. */
function substitute(value, get) {
  if (value === undefined || value === null) return undefined;
  let s = String(value);
  for (let n = 0; n < 50; n++) {
    const i = s.lastIndexOf('var(');
    if (i < 0) break;
    let d = 1, j = i + 4; while (j < s.length && d) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; }
    const parts = splitTop(s.slice(i + 4, j - 1), ',');
    const name = parts[0].trim(), fb = parts.length > 1 ? parts.slice(1).join(',').trim() : undefined;
    let v = get(name);
    if (v === undefined) v = fb;
    if (v === undefined) return undefined;
    s = s.slice(0, i) + v + s.slice(j);
  }
  const bg = s.startsWith('background(') && /^background\(([\s\S]*)\)$/.exec(s), bgi = s.startsWith('background-image(') && /^background-image\(([\s\S]*)\)$/.exec(s);
  if (bg || bgi) {
    const layers = splitTop((bg || bgi)[1], ',');
    if (bgi) return layers.some((l) => /\b(url|[\w-]*gradient|image-set)\(/.test(l)) ? 'image' : 'none';
    // the colour is in the last layer: the one token that reads as a colour
    const toks = splitTop(layers[layers.length - 1].trim(), ' ').map((t) => t.trim()).filter(Boolean);
    const colourTok = toks.find((t) => /^(#[\da-f]{3,8}|rgba?\(|hsla?\(|color-mix\(|transparent$|currentcolor$|white$|black$|inherit$|initial$|unset$|none$)/i.test(t) || NAMED[t.toLowerCase()]);
    if (!colourTok) return toks.every((t) => /^(none|no-repeat|repeat|center|top|left|right|bottom|cover|contain|fixed|scroll|[\d.]+(px|%)?|\/|url\(|[\w-]*gradient\()/.test(t)) ? 'transparent' : `unread(${toks.join(' ')})`;
    return colourTok === 'none' ? 'transparent' : colourTok;
  }
  return s;
}
