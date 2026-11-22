// ── The ready-made looks' own layer (builder list item 333, Nov 2026) ─────────────
// Eric picked twelve looks in Figma (section D: Golden hour, Hand-lettered, Hard hat, Night shift,
// Big & bright, Clinic calm, Garden, Blush, Black & gold, Newsprint, Steady navy, Playground).
// Each sets the site's colours, fonts and button set through the style settings (lib/devmode.ts),
// and presence-edit.js (STYLE_LOOKS) holds the twelve. A few things a look needs have their own
// setting, drawn here:
//   heading_case: upper        headings in capitals (Hard hat)
//   heading_weight: 400        headings at regular weight, for a face drawn in one weight (Blush)
//   button_radius: <n>px       every button's corners, over its set's (Hand-lettered 14px, Night shift 4px...)
//   button_shadow: offset      a solid shadow beside the main button (Playground)
//   look: <its key>            the look's own small layer of rules, so every word reads with its colours
//   scheme: dark               a dark page: the template's light surfaces follow the look's dark colours
// The look's colours on a template's cards, rules and shaded bands are plain colour settings
// (card, line, wash, accent_band) that the style layer writes as the variables templates read.
// A site that sets none of these is drawn exactly as before: the style is written only when one
// is set, and it ships only the rules of what is set. A template that keeps its own colours
// (Slate) takes the shapes and type and none of the colour rules.
// tests/presence/style_looks_333_test.mjs reads every word on every page of every template under
// every look. This file imports nothing, so a browser spec can draw a page with it.
type FileMap = Record<string, string | Uint8Array>;

const R = ':root';
/** The settings this layer draws, each with the rules it writes. */
const HEADINGS_UPPER = `${R} :is(h1,h2,h3){text-transform:uppercase;letter-spacing:.01em}`;
// a face with one weight is never thickened by the browser: headings and the site's name are set at it
const HEADINGS_REGULAR = `${R}{font-synthesis-weight:none}${R} :is(h1,h2,h3,.brand){font-weight:400}`;
const BUTTON_CORNERS = `${R} .btn,${R} .btn.ghost,${R} .btn.btn-outline{border-radius:var(--button-radius)}`;
const MAIN_BTN = `${R} .btn:not(.ghost):not(.btn-outline)`;
const BUTTON_OFFSET = `${MAIN_BTN}{box-shadow:3px 3px 0 var(--ink)}${MAIN_BTN}:hover{box-shadow:1px 1px 0 var(--ink)}`;

// A look keeps its words readable on every template. Its accent is the colour a button is filled
// with; small words drawn in the accent (an eyebrow, the stars, a form's required mark) take its
// darker shade, which every look picks to read on light shaded bands too. The templates' second
// colours (Atelier's bronze words, Harbor's steel blue) follow the look's accent, example words in a
// box are the look's soft text, a footer's quieter words are its own words (as on the bands), and
// the menu's little arrow is as strong as its link. Each rule stays under the accent and dark sections' own
// (BLOCK_CSS, 0,3,0), so words on a band keep the band's white.
const LOOK_LAYER = `${R}{--accent-ink:var(--accent-dark);--steel:var(--accent);--steel-dark:var(--accent-dark)}`
  + `${R} footer.site,${R} .strip{--accent:var(--accent-dark)}`
  + `${R} :is(.sp-eyebrow,.rw-stars,.rev-stars,.rw-agg-stars),${R} label .ff-req{color:var(--accent-dark)}`
  + `${R} ::placeholder{color:var(--soft);opacity:1}`
  + `${R} footer.site{--soft:currentColor}${R} nav.primary .sub-caret{opacity:1}`;
// What a template draws in its own way. Harbor draws its headings, names and figures in the accent,
// and its footer and top strip on it under light grey-blue words: under a look the headings take the
// accent's darker shade and the footer the look's text colour. Aurora's and Meadow's see-through
// headers are tinted with their own page colour, and Meadow's page has a green glow at the top:
// under a look the header is tinted with the look's page colour and the glow goes.
const TEMPLATE_LAYER: Record<string, string> = {
  aurora: `${R} header.site{background:color-mix(in srgb,var(--paper) 82%,transparent)}`,
  meadow: `${R} body{background-image:none}${R} header.site{background:color-mix(in srgb,var(--paper) 85%,transparent)}`,
  harbor: `${R} :where(h1,h2,h3),${R} .brand,${R} :where(.svc) .nm,${R} dl.faq dt,${R} :where(.hp-stats) .num,${R} .checklist li::before{color:var(--accent-dark)}`
    + `${R} footer.site,${R} .strip{background:var(--ink)}`,
};

// A dark page. The template's cards, rules and shaded bands take the look's dark colours through
// their variables (and a box's own fill, which some templates leave to the page colour, follows
// it); what a template draws in its text colour (footers, top strips) is drawn on the dark card
// colour and its header on the page's own; what carries white words on the accent (the
// announcement bar, the steps' numbers, and on Aurora and Meadow the page's place in the menu)
// sits on the deeper accent band; links a template leaves in the browser's blue take the accent's shade.
const DARK_LAYER = `${R}{color-scheme:dark;--paper:var(--bg)}`
  + `${R} header.site{background:var(--paper)}`
  + `${R} footer.site,${R} .strip{background:var(--card)}`
  + `${R} .annbar,${R} .skip:focus,${R} .bk-done-ic{background:var(--accent-band);color:#fff}`
  + `${R} ol.process li::before{background:var(--accent-band);color:#fff}`
  + `${R} .annbar a{color:#fff}`
  + `${R} :where(a:not([class])){color:var(--accent-dark)}`;

const TEMPLATE_DARK_LAYER: Record<string, string> = {
  aurora: `${R} nav.primary a[aria-current="page"]{background:var(--accent-band)}`,
  meadow: `${R} nav.primary a[aria-current="page"]{background:var(--accent-band)}`,
};

/** The settings, as stored, that this layer reads. Anything else (or a value the style layer
 *  refuses) draws nothing. Pure. */
export function lookSettings(tokens: Record<string, unknown> | null | undefined) {
  const t = tokens || {};
  const s = (k: string) => (typeof t[k] === 'string' ? t[k] as string : '');
  return {
    upper: s('heading_case') === 'upper',
    regular: s('heading_weight') === '400',
    corners: /^([0-9]|[1-3][0-9]|40)px$/.test(s('button_radius')),
    offset: s('button_shadow') === 'offset',
    look: /^[a-z][a-z0-9_]{1,30}$/.test(s('look')),
    dark: s('scheme') === 'dark',
  };
}

/** Where a look is drawn: `fixed`, a template that keeps its own colours (Slate), takes the shapes
 *  and type only; `template` picks that template's own few rules. */
export interface LookPlace { fixed?: boolean; template?: string }
/** The style element for a site's look, or '' when it sets none of these. Pure. */
export function lookStyle(tokens: Record<string, unknown> | null | undefined, place: LookPlace = {}): string {
  const s = lookSettings(tokens), colours = !place.fixed;
  const css = (s.upper ? HEADINGS_UPPER : '') + (s.regular ? HEADINGS_REGULAR : '') + (s.corners ? BUTTON_CORNERS : '') + (s.offset ? BUTTON_OFFSET : '')
    + (s.look && colours ? LOOK_LAYER + (TEMPLATE_LAYER[place.template || ''] || '') : '') + (s.dark && colours ? DARK_LAYER + (TEMPLATE_DARK_LAYER[place.template || ''] || '') : '');
  return css ? `<style id="dds-look">${css}</style>` : '';
}

/** The colour settings a template that keeps its own colours never takes. */
export const LOOK_COLOUR_TOKENS = ['scheme', 'card', 'line', 'wash', 'accent_band'] as const;

/** Every page, given the site's settings: the look's style at the end of each page's head, after
 *  the button set's (so a look's button corners win) and before the developer layer (so a
 *  developer's own CSS still has the last word). Nothing set, the pages are left exactly as they
 *  were. Pure. */
export function applyLookLayer(fileMap: FileMap, tokens: Record<string, unknown> | null | undefined, place: LookPlace = {}): FileMap {
  const style = lookStyle(tokens, place);
  if (!style) return fileMap;
  const out: FileMap = {};
  for (const [path, html] of Object.entries(fileMap)) {
    if (typeof html !== 'string' || !path.endsWith('.html') || !html.includes('</head>') || html.includes('id="dds-look"')) { out[path] = html; continue; }
    out[path] = html.replace('</head>', `${style}</head>`);
  }
  return out;
}

/** A dark look's colours, which only read together. */
export const DARK_LOOK_TOKENS = ['scheme', 'bg', 'ink', 'soft', 'accent', 'accent_dark', 'card', 'line', 'wash', 'accent_band', 'look'] as const;
/** A brand colour applied over a dark look starts from the template's own colours, on a light page
 *  (routes/dev.ts applyKitTokens; the editor's DARK_LOOK_CLEAR does the same for a palette or a
 *  background picked over one). Any other style is returned as it is. Pure. */
export function leaveDarkLook(tokens: Record<string, string> | null | undefined): Record<string, string> {
  const t = tokens || {};
  if (t.scheme !== 'dark') return t;
  return Object.fromEntries(Object.entries(t).filter(([k]) => !(DARK_LOOK_TOKENS as readonly string[]).includes(k)));
}
