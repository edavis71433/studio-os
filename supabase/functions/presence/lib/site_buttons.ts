// ── Button sets and form styles (builder list item 217, Nov 2026) ─────────────
// Squarespace's Site Styles offers matched button packs and a Forms card (review file 01,
// finding 6). Studio OS buttons took each template's own look plus one Corners choice. Two
// style settings (lib/devmode.ts) now restyle every button and every box people type into:
//   buttons: filled | outline | pill | square | underline   (none: the template's own)
//   forms:   line | soft | round                             (none: the template's own)
// Main buttons are `.btn`; the second one beside it is `.btn.ghost` (the templates and the
// pop-up) or `.btn.btn-outline` (the sections). The chosen set is one small <style> in each
// page's head, written only when something is picked, so a site without a choice is drawn
// exactly as before, and it ships only the rules of the one set it uses.
// Colours come from the site itself. Whether a filled button's words are white or dark, and
// whether it fills with the accent or the darker accent, is worked out from the site's actual
// colours (the template's own, or the owner's palette over them), so every set reads at 4.5:1
// on the page, on dark sections and on accent sections. tests/presence/button_sets_test.mjs
// checks every template under every palette and look the editor offers.
// This file imports nothing, so a browser spec can draw a page with it.
type FileMap = Record<string, string | Uint8Array>;

export const BUTTON_SETS = ['filled', 'outline', 'pill', 'square', 'underline'] as const;
export const FORM_STYLES = ['line', 'soft', 'round'] as const;
export type ButtonSet = typeof BUTTON_SETS[number];
export type FormStyle = typeof FORM_STYLES[number];

/** The setting as stored, or null for the template's own. Pure. */
export function buttonSetOf(raw: unknown): ButtonSet | null { return (BUTTON_SETS as readonly unknown[]).includes(raw) ? raw as ButtonSet : null; }
export function formStyleOf(raw: unknown): FormStyle | null { return (FORM_STYLES as readonly unknown[]).includes(raw) ? raw as FormStyle : null; }

// ── colour arithmetic (WCAG 2), the same formulas as lib/brand_kit.ts ──
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export function hex6(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!HEX.test(s)) return null;
  const h = s.slice(1).toLowerCase();
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h);
}
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h: string) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export function contrast(a: string, b: string): number { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** `a` mixed into `b`: t = 0 is b, t = 1 is a. */
export function mixHex(a: string, b: string, t: number): string {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(B[i] + (v - B[i]) * t).toString(16).padStart(2, '0')).join('');
}
const WHITE = '#ffffff', NEAR_BLACK = '#111111';

/** The site's colours as its pages draw them. */
export interface SiteColours { paper: string; ink: string; accent: string; accentDark: string; card: string; soft: string }

/** Rules outside @media blocks, as {selectors, declarations}. */
function screenRules(css: string): Array<{ sels: string[]; decl: string }> {
  let s = css, i: number;
  while ((i = s.indexOf('@media')) >= 0) {
    let k = s.indexOf('{', i), depth = 0;
    for (; k < s.length; k++) { if (s[k] === '{') depth++; else if (s[k] === '}' && --depth === 0) break; }
    s = s.slice(0, i) + s.slice(k + 1);
  }
  return [...s.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(',').map((x) => x.trim()), decl: m[2] }));
}
/** var(--x, fallback), innermost first, followed to a hex colour. */
function resolve(value: string | undefined, vars: Record<string, string>): string | null {
  let s = String(value ?? '');
  for (let n = 0, m: RegExpExecArray | null; n < 12 && (m = /var\(--([\w-]+)\s*(?:,\s*([^()]*))?\)/.exec(s)); n++) s = s.replace(m[0], vars[m[1]] ?? m[2] ?? '');
  const h = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(s);
  return h ? hex6(h[0]) : null;
}

/** The colours a page draws with: the template's :root variables from its stylesheet, with the
 *  owner's style settings over them (the dev layer writes the same variables later in the page),
 *  and the page background from the body rule where the template has no --paper. Pure. */
export function siteColours(css: string, tokens?: Record<string, string> | null): SiteColours {
  const rules = screenRules(css);
  const vars: Record<string, string> = {};
  for (const r of rules) if (r.sels.includes(':root')) for (const m of r.decl.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) vars[m[1]] = m[2].trim();
  for (const [k, v] of Object.entries(tokens || {})) {
    if (!/^(accent|accent_dark|ink|soft|bg)$/.test(k) || !hex6(v)) continue;
    vars[k] = String(v); vars[k.replace(/_/g, '-')] = String(v);
  }
  const bodyBg = (() => {
    let v: string | undefined;
    for (const r of rules) if (r.sels.includes('body')) { const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/.exec(r.decl); if (m) v = m[1].trim(); }
    return v;
  })();
  const paper = resolve(vars.paper, vars) || resolve(bodyBg, vars) || resolve(vars.bg, vars) || WHITE;
  const ink = resolve(vars.ink, vars) || (contrast(NEAR_BLACK, paper) >= contrast(WHITE, paper) ? '#1c2430' : '#eef1f5');
  const accent = resolve(vars.accent, vars) || ink;
  return {
    paper, ink, accent,
    accentDark: resolve(vars['accent-dark'], vars) || accent,
    card: resolve(vars.card, vars) || paper,
    soft: resolve(vars.soft, vars) || ink,
  };
}

/** What every set draws with, chosen so the words read on this site's colours. Each colour has
 *  the variable it came from where there is one, so the editor's canvas follows a palette picked
 *  after the page was drawn. Pure. */
export interface ButtonChoice {
  fill: string; fillVar: string; onFill: string;     // a filled main button and its words
  line: string; lineVar: string; onLine: string;     // ruled and underlined buttons, and a ruled one when pressed
  text: string;                                      // a second button drawn as words
  tint: string;                                      // a filled set's second button
  field: string; fieldBorder: string;                // the Soft boxes, and the Round boxes' rule
  placeholder: string;                               // the example words in a Soft or Round box
}
export function buttonChoice(c: SiteColours): ButtonChoice {
  const darkWords = (bg: string) => { const best = [c.ink, NEAR_BLACK, '#000000'].find((x) => contrast(x, bg) >= 4.5); return best || '#000000'; };
  let fill = c.accent, fillVar = 'var(--accent)', onFill = WHITE;
  if (contrast(WHITE, c.accent) < 4.5) {
    if (contrast(WHITE, c.accentDark) >= 4.5) { fill = c.accentDark; fillVar = 'var(--accent-dark,var(--accent))'; }
    else onFill = darkWords(c.accent);
  }
  const lines: Array<[string, string]> = [[c.accentDark, 'var(--accent-dark,var(--accent))'], [c.accent, 'var(--accent)'], [c.ink, 'var(--ink)']];
  const [line, lineVar] = lines.find(([h]) => contrast(h, c.paper) >= 4.5) || [c.ink, 'var(--ink)'];
  const onLine = contrast(WHITE, line) >= 4.5 ? WHITE : darkWords(line);
  const text = contrast(c.ink, c.paper) >= 4.5 ? c.ink : (contrast(NEAR_BLACK, c.paper) >= contrast(WHITE, c.paper) ? NEAR_BLACK : WHITE);
  const tint = [0.12, 0.08, 0.05].map((t) => mixHex(fill, c.paper, t)).find((h) => contrast(line, h) >= 4.5) || c.paper;
  const field = [0.08, 0.05].map((t) => mixHex(c.ink, c.paper, t)).find((h) => contrast(c.ink, h) >= 4.5) || c.paper;
  const fieldBorder = [0.35, 0.45, 0.55, 0.7, 1].map((t) => mixHex(c.ink, c.paper, t)).find((h) => contrast(h, c.paper) >= 3) || c.ink;
  // the boxes sit on the Soft fill or the card; the example words read on the darker of the two
  const under = contrast(c.ink, field) < contrast(c.ink, c.card) ? field : c.card;
  const placeholder = [c.soft, mixHex(c.ink, c.soft, 0.5), c.ink].find((h) => contrast(h, under) >= 4.5) || c.ink;
  return { fill, fillVar, onFill, line, lineVar, onLine, text, tint, field, fieldBorder, placeholder };
}

// ── the rules ──
// :root raises each rule just above the template's own (.btn, .btn.ghost, .btn:hover); the
// style is written after the stylesheet, so a tie goes to the set. The sections' dark and
// accent bands (BLOCK_CSS .block.block--bg-*) are answered by name, as they turn words white.
const R = ':root';
const MAIN = `${R} .btn`;
const SECOND = `${R} .btn.ghost,${R} .btn.btn-outline`;
const SECOND_HOVER = `${R} .btn.ghost:hover,${R} .btn.btn-outline:hover`;
const ON_DARK = (s: string) => `${R} .block--bg-dark ${s}`;
const BANDS = (s: string) => `${R} .block--bg-accent ${s},${R} .block--bg-dark ${s}`;
const BANDS_SECOND = `${BANDS('.btn.ghost')},${BANDS('.btn.btn-outline')}`;
// the words of a second button drawn as words: underlined, close to the words
const AS_WORDS = 'background:none;border-color:transparent;box-shadow:none;padding-left:0;padding-right:0;text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:.28em';
const SOLID = 'background:var(--dds-bf);color:var(--dds-bi);border:2px solid transparent;box-shadow:none';
const RULED = 'background:transparent;color:var(--dds-bl);border:2px solid currentColor;box-shadow:none';
const PRESS = 'box-shadow:inset 0 0 0 999px rgba(0,0,0,.1)';   // darkens the fill, never the words

const SETS: Record<ButtonSet, string> = {
  filled: `${MAIN}{${SOLID};border-radius:12px}${MAIN}:hover{${PRESS}}`
    + `${SECOND}{background:var(--dds-bm);color:var(--dds-bl);border-color:transparent;border-radius:12px}${SECOND_HOVER}{${PRESS}}`
    + `${ON_DARK('.btn')}{${SOLID}}`
    // on a dark section the second one is a soft white; on an accent section it is ruled, so its
    // words read exactly as the section's own white words do
    + `${ON_DARK('.btn.ghost')},${ON_DARK('.btn.btn-outline')}{background:rgba(255,255,255,.12);color:#fff;border-color:transparent}`
    + `${R} .block--bg-accent .btn.ghost,${R} .block--bg-accent .btn.btn-outline{background:transparent;color:#fff;border-color:#fff}`,
  outline: `${MAIN}{${RULED};border-radius:10px}${MAIN}:hover{background:var(--dds-bl);color:var(--dds-bli);border-color:var(--dds-bl)}`
    + `${SECOND}{${AS_WORDS};color:var(--dds-bt)}${SECOND_HOVER}{background:none;color:var(--dds-bl)}`
    + `${BANDS('.btn')}{background:transparent;color:#fff;border-color:#fff}${BANDS('.btn:hover')}{background:#fff;color:#1a1622;border-color:#fff}`
    + `${BANDS_SECOND},${BANDS('.btn.ghost:hover')},${BANDS('.btn.btn-outline:hover')}{background:none;color:#fff;border-color:transparent}`,
  pill: `${MAIN}{${SOLID};border-radius:999px}${MAIN}:hover{${PRESS}}`
    + `${SECOND}{${RULED};border-radius:999px}${SECOND_HOVER}{background:transparent;box-shadow:inset 0 0 0 999px rgba(0,0,0,.05)}`
    + `${ON_DARK('.btn')}{${SOLID}}`
    + `${BANDS_SECOND}{background:transparent;color:#fff;border-color:#fff}`,
  square: `${MAIN}{${SOLID};border-radius:0;text-transform:uppercase;letter-spacing:.08em;font-size:.9rem}${MAIN}:hover{${PRESS}}`
    + `${SECOND}{${RULED};border-radius:0}${SECOND_HOVER}{background:transparent;box-shadow:inset 0 0 0 999px rgba(0,0,0,.05)}`
    + `${ON_DARK('.btn')}{${SOLID}}`
    + `${BANDS_SECOND}{background:transparent;color:#fff;border-color:#fff}`,
  underline: `${MAIN}{background:none;color:var(--dds-bl);border-color:transparent;border-radius:0;box-shadow:none;padding-left:0;padding-right:0;font-weight:700;text-decoration:underline;text-decoration-thickness:3px;text-underline-offset:.32em}`
    + `${R} .btn:not(.ghost):not(.btn-outline)::after{content:"\\2192";display:inline-block;margin-left:.45em}@media (prefers-reduced-motion:no-preference){${R} .btn::after{transition:transform .15s}${R} .btn:hover::after{transform:translateX(3px)}}`
    + `${SECOND}{${AS_WORDS};color:var(--dds-bt);font-weight:600}${SECOND_HOVER}{background:none;color:var(--dds-bl)}`
    + `${BANDS('.btn')},${BANDS('.btn:hover')}{background:none;color:#fff;border-color:transparent}`,
};

// every box people type into, on forms, the sign-up box, bookings and the pop-up
const FIELD = `${R} :is(input:not([type=checkbox],[type=radio],[type=file],[type=submit],[type=button],[type=reset],[type=hidden],[type=range],[type=color],[type=image]),textarea,select)`;
const FORMS: Record<FormStyle, string> = {
  line: `${FIELD}{border:0;border-bottom:2px solid currentColor;border-radius:0;background:transparent;color:inherit;padding-left:2px;padding-right:2px;box-shadow:none}${FIELD}::placeholder{color:inherit;opacity:.78}`,
  soft: `${FIELD}{border:1.5px solid transparent;border-radius:12px;background:var(--dds-ff);color:var(--ink);box-shadow:none}${FIELD}::placeholder{color:var(--dds-fp);opacity:1}`,
  round: `${FIELD}{border:1.5px solid var(--dds-fb);border-radius:999px;background:var(--card,#fff);color:var(--ink);padding-left:18px;padding-right:18px;box-shadow:none}${R} textarea:not([hidden]){border-radius:20px}${FIELD}::placeholder{color:var(--dds-fp);opacity:1}`,
};
const FOCUS = `${FIELD}:focus-visible{outline:2px solid var(--dds-bl);outline-offset:2px}`;

/** The style element for a site: its set, its form style, and the colours they use. Empty
 *  when neither is chosen. Pure. */
export function buttonStyle(set: ButtonSet | null, form: FormStyle | null, colours: SiteColours): string {
  if (!set && !form) return '';
  const ch = buttonChoice(colours);
  const vars = set
    ? `--dds-bf:${ch.fillVar};--dds-bi:${ch.onFill};--dds-bl:${ch.lineVar};--dds-bli:${ch.onLine};--dds-bt:${ch.text};--dds-bm:${ch.tint};`
    : `--dds-bl:${ch.lineVar};`;
  const fieldVars = form === 'soft' ? `--dds-ff:${ch.field};--dds-fp:${ch.placeholder};` : form === 'round' ? `--dds-fb:${ch.fieldBorder};--dds-fp:${ch.placeholder};` : '';
  return `<style id="dds-buttons">:root{${vars}${fieldVars}}${set ? SETS[set] : ''}${form ? FORMS[form] + FOCUS : ''}</style>`;
}

/** Every page, given the site's two settings. Neither chosen, the pages are left exactly as they
 *  were. `fixedColours`: a template that keeps its own colours (Slate) ignores the palette. Pure. */
export function applyButtonStyles(fileMap: FileMap, tokens: Record<string, string> | null | undefined, fixedColours = false): FileMap {
  const set = buttonSetOf(tokens?.buttons), form = formStyleOf(tokens?.forms);
  if (!set && !form) return fileMap;
  const cssKey = Object.keys(fileMap).find((k) => /^assets\/.*\.css$/.test(k));
  const css = cssKey && typeof fileMap[cssKey] === 'string' ? fileMap[cssKey] as string : '';
  const style = buttonStyle(set, form, siteColours(css, fixedColours ? null : tokens));
  const out: FileMap = {};
  for (const [path, html] of Object.entries(fileMap)) {
    if (typeof html !== 'string' || !path.endsWith('.html') || !html.includes('</head>') || html.includes('id="dds-buttons"')) { out[path] = html; continue; }
    out[path] = html.replace('</head>', `${style}</head>`);
  }
  return out;
}
