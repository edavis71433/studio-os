// ── The page's bands keep its side margins; Features cards read on bold bands ─────
//   deno run --allow-read --allow-env tests/presence/template_bands_test.mjs
// Found Nov 8 2026. Every template's `.block{padding:N 0}` (and `.hero`, and the header's
// `.nav`) came after `.wrap{padding:0 Xpx}` and set its sides to 0, so a band drawn
// `class="block wrap"` (the template's own About us, most sections), the welcome band and the
// header row touched a phone's screen edges, and sat wider than the other bands on a desktop.
// The divider's `margin:N 0` took the page width's centring the same way. On Aurora, Business
// Classic, Harbor and Meadow, the Features cards stayed white on a dark or brand-colour band,
// under the band's white text. Restaurant Classic's `section.block` outranked the sections'
// spacing option, so tight and roomy did nothing there.
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { TEMPLATES, fixture, fullFixture } from './full_fixture.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const SITE = { baseUrl: 'https://example.com', formEndpoint: 'https://example.com/forms/submit', bookEndpoint: 'https://example.com/book' };

// every style rule's selectors and declarations, inside @media and @supports too
function rules(css) {
  const out = [], s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (from, to) => {
    for (let i = from; i < to;) {
      const open = s.indexOf('{', i);
      if (open < 0 || open >= to) break;
      let d = 1, j = open + 1;
      while (j < to && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
      const head = s.slice(i, open).trim();
      if (/^@(media|supports)\b/.test(head)) walk(open + 1, j - 1);
      else if (!head.startsWith('@')) out.push({ sel: head, body: s.slice(open + 1, j - 1) });
      i = j;
    }
  };
  walk(0, s.length);
  return out;
}
const top = (list) => { const out = []; let d = 0, cur = ''; for (const c of list) { if (c === '(' || c === '[') d++; if (c === ')' || c === ']') d--; if (!d && c === ',') { out.push(cur.trim()); cur = ''; } else cur += c; } return [...out, cur.trim()]; };
const parts = (v) => { const out = []; let d = 0, cur = ''; for (const c of v.trim()) { if (c === '(') d++; if (c === ')') d--; if (!d && c === ' ') { if (cur) out.push(cur); cur = ''; } else cur += c; } return cur ? [...out, cur] : out; };
const decl = (body, prop) => (new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body) || [])[1]?.trim();
// the classes a selector's last compound needs, outside (…) and […]
const subject = (sel) => { let bare = '', d = 0; for (const c of sel.split(/[\s>+~]+/).pop()) { if (c === '(' || c === '[') d++; if (!d) bare += c; if (c === ')' || c === ']') d--; } return [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]); };
const sides = (v) => { const p = parts(v); return p.length === 1 ? [p[0], p[0]] : p.length === 4 ? [p[1], p[3]] : [p[1], p[1]]; };   // [right, left]

for (const slug of TEMPLATES) {
  const drawn = [await renderSnapshot(fixture(slug), SITE), await renderSnapshot(fullFixture(slug), SITE)];
  const pages = drawn.flatMap((f) => Object.entries(f).filter(([k]) => k.endsWith('.html')).map(([, v]) => String(v)));
  // every class set an element carries alongside `wrap`
  const wraps = pages.flatMap((h) => [...h.matchAll(/\sclass="([^"]*)"/g)].map((m) => new Set(m[1].split(/\s+/)))).filter((c) => c.has('wrap'));
  // the stylesheet, and the first-paint styles in each page's head
  const css = drawn.map((f) => String(f[Object.keys(f).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k))])).join('\n') + '\n'
    + [...new Set(pages.flatMap((h) => [...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1])))].join('\n');
  const all = rules(css);

  // ═══ 1. nothing undoes the page width's side padding or centring ═══
  const undo = [];
  for (const r of all) {
    const pad = decl(r.body, 'padding'), mar = decl(r.body, 'margin');
    const wipesPad = pad && sides(pad).some((x) => x === '0' || x === '0px');
    const wipesMar = mar && sides(mar).some((x) => x !== 'auto');
    if (!wipesPad && !wipesMar) continue;
    for (const sel of top(r.sel)) {
      const need = subject(sel);
      if (need.includes('wrap') || !need.length) continue;   // a rule for .wrap itself means it
      if (wraps.some((c) => need.every((x) => c.has(x)))) undo.push(`${sel}{${wipesPad ? 'padding:' + pad : 'margin:' + mar}}`);
    }
  }
  ok(`[${slug}] no rule undoes the page width's side padding or centring (bands, the welcome band, the header row, the divider)`, undo.length === 0, [...new Set(undo)].slice(0, 4).join(' | '));

  // ═══ 2. Features cards read on the bold bands ═══
  // A band's text is white, so light cards (the card colour the template's :root names) must
  // turn see-through there; dark cards (Slate) already read.
  const own = rules(String(drawn[0][Object.keys(drawn[0]).find((k) => /^assets\/site-[0-9a-f]+\.css$/.test(k))]));
  const root = own.find((r) => r.sel === ':root')?.body || '';
  const card = own.filter((r) => top(r.sel).includes('.svc')).map((r) => decl(r.body, 'background')).filter(Boolean).pop() || 'none';
  const hex = (/#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(card.startsWith('var(') ? decl(root, (/var\((--[\w-]+)/.exec(card) || [])[1] || '-') || '' : card) || [])[1];
  const light = !!hex && (() => { const h = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex; const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.5; })();
  const band = (b) => own.some((r) => top(r.sel).includes(`.block--bg-${b} .svc`) && /rgba\(255,\s*255,\s*255,\s*\.1\d*\)/.test(decl(r.body, 'background') || ''));
  ok(`[${slug}] light Features cards turn see-through on the dark and brand-colour bands`, !light || (band('dark') && band('accent')), `cards ${card} with no band rule`);

  // ═══ 3. the sections' spacing option outranks the template's band padding ═══
  const outranks = all.filter((r) => top(r.sel).some((s) => /^[a-z]+\.block$/.test(s)) && /padding/.test(r.body)).map((r) => r.sel);
  ok(`[${slug}] the band padding is a plain .block rule, so tight and roomy spacing can win`, outranks.length === 0, outranks.join(' | '));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ TEMPLATE BANDS: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
