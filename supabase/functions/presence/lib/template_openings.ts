// ── How the home page opens, and each built-in design's own fonts (builder item 330) ──
// Eric's picks in Figma (section A, node 455:3; the card "Which template opens which way",
// 461:138). Until Nov 22 2026 the eight designs were one layout in eight skins: the header,
// the business name as the headline, the buttons, then the photo in a box, and no design
// shipped fonts of its own. This file is the one home for:
//   · the front-page layouts a site can pick (presence_settings.hero_layout), with the
//     names the editor shows. Three are new here: 'panel' (two halves, the words on a soft
//     tint of the accent and the photo to the page's edge), 'editorial' (a big centred
//     headline, then up to three photos in a row) and 'type' (big words on a band of the
//     accent, with a row of facts the site really has). lib/template_kit.ts draws them;
//   · their stylesheet, which a site carries only while it uses one of them, so every
//     other site's stylesheet keeps its bytes (and its cached file name);
//   · which layout and which two fonts a NEW site starts with, per design. POST
//     /agency/sites writes them (agency/sites.ts) and fills only what is still empty: a
//     site that has a layout, or fonts, keeps them, and no existing site is ever changed.
// The fonts are library families (lib/fonts.ts), regular and bold only, saved as the same
// two style tokens Styles saves, so a publish carries their files like any other pick.
import { FONT_LIBRARY, fontStack, type LibraryFont } from './fonts.ts';

/** Every front-page layout, in the editor's order, with the name it shows. '' is Classic. */
export const HERO_LAYOUTS = [
  { value: '', name: 'Classic' },
  { value: 'split', name: 'Photo beside text' },
  { value: 'photo', name: 'Words over the photo' },
  { value: 'photo-light', name: 'Words over a light photo' },
  { value: 'panel', name: 'Split: words on a colour panel' },
  { value: 'editorial', name: 'Centred editorial' },
  { value: 'type', name: 'Type only' },
] as const;
export type HeroLayout = typeof HERO_LAYOUTS[number]['value'];

/** The three layouts item 330 adds; their rules ship only on a site drawn with one. */
export const NEW_OPENINGS = ['panel', 'editorial', 'type'] as const;
export type OpeningKind = typeof NEW_OPENINGS[number];

/** Is this a layout a site can save? Pure. */
export const isHeroLayout = (v: unknown): v is HeroLayout => typeof v === 'string' && HERO_LAYOUTS.some((l) => l.value === v);
/** Is this one of the three new layouts? Pure. */
export const isNewOpening = (v: unknown): v is OpeningKind => typeof v === 'string' && (NEW_OPENINGS as readonly string[]).includes(v);
/** The editor's name for a layout ('' when it isn't one). Pure. */
export const heroLayoutName = (v: unknown): string => HERO_LAYOUTS.find((l) => l.value === v)?.name || '';

// ═════════ what a new site starts with, per design (Figma card 461:138) ═════════
// Fonts by their library id (lib/fonts.ts FONT_LIBRARY), headings first.
export const TEMPLATE_OPENINGS: Record<string, { layout: HeroLayout; display: string; body: string }> = {
  'restaurant-classic': { layout: 'photo', display: 'playfair-display', body: 'manrope' },
  'slate': { layout: 'photo', display: 'space-grotesk', body: 'inter' },
  'aurora': { layout: 'photo-light', display: 'outfit', body: 'figtree' },
  'atelier': { layout: 'panel', display: 'dm-serif-display', body: 'dm-sans' },
  'business-classic': { layout: 'panel', display: 'plus-jakarta-sans', body: 'inter' },
  'meadow': { layout: 'editorial', display: 'cormorant-garamond', body: 'source-sans-3' },
  'editorial': { layout: 'editorial', display: 'libre-baskerville', body: 'nunito-sans' },
  'harbor': { layout: 'type', display: 'roboto-slab', body: 'work-sans' },
};

export interface OpeningStart {
  /** The design it is for. */
  slug: string;
  /** presence_settings.hero_layout for the new site. */
  hero_layout: HeroLayout;
  /** The two style tokens, as Styles saves a library font: its css name, then its fallback. */
  tokens: { font_display: string; font_body: string };
  /** The families' names, headings first, for the history and the answer. */
  fonts: [string, string];
}

/** What a new site on this design opens with, or null for a design with no pick. Pure. */
export function openingStartFor(slug: unknown): OpeningStart | null {
  const pick = typeof slug === 'string' ? TEMPLATE_OPENINGS[slug] : undefined;
  if (!pick) return null;
  const font = (id: string): LibraryFont | undefined => FONT_LIBRARY.find((f) => f.id === id);
  const d = font(pick.display), b = font(pick.body);
  if (!d || !b) return null;
  return { slug: slug as string, hero_layout: pick.layout, tokens: { font_display: fontStack(d), font_body: fontStack(b) }, fonts: [d.family, b.family] };
}

/** The history line for what a new site was given ('' when nothing was). Plain words. Pure. */
export function openingSummary(start: OpeningStart, layout: boolean, fonts: boolean): string {
  const name = heroLayoutName(start.hero_layout);
  const type = `headings in ${start.fonts[0]}, text in ${start.fonts[1]}`;
  if (layout && fonts) return `The home page opens with “${name}”; ${type}`;
  if (layout) return `The home page opens with “${name}”`;
  return fonts ? `Fonts: ${type}` : '';
}

// ═════════ the stylesheet, for a site drawn with a new layout ═════════
// Shared by the three (OPENING_BASE), then each one's own. The layouts keep each design's
// own voice: its kicker, its buttons, its heading font and weight; these rules only lay
// them out. No italics (the library fonts have none to show), no weight the library lacks.
// The open-now line (the strip's own script fills it) carries a dot for open or closed,
// in the words' own colour, so it reads on a light panel and a dark band alike.
const OPENING_BASE = `
.op{text-align:left}
.op h1{text-wrap:balance}
.op .op-line{font-size:1.18rem;line-height:1.55;max-width:46ch;color:var(--soft);font-style:normal}
.op .open-now{color:inherit}
.op .open-now::before{content:"";display:inline-block;width:.55em;height:.55em;border-radius:50%;margin-right:.45em;background:currentColor}
.op .open-now.yes::before{background:#2f9e5e}
.op .open-now.no::before{background:#d0533c}
.op .open-now:empty{display:none}`;

export const OPENING_CSS: Record<OpeningKind, string> = {
  panel: `
.op-panel{display:grid;grid-template-columns:1fr 1fr;min-height:min(86vh,800px);padding:0}
.op-panel .op-words{display:flex;align-items:center;background:var(--wash,#f2f2f2);background:color-mix(in srgb,var(--accent) 14%,var(--paper,var(--cream,#fff)));padding:clamp(48px,7vw,104px) clamp(24px,5vw,72px) clamp(48px,7vw,104px) max(24px,calc(50vw - 516px))}
.op-panel .op-in{max-width:560px}
.op-panel .kicker::after{margin-left:0}
.op-panel h1{font-size:clamp(2.4rem,4.6vw,4.3rem);line-height:1.04;max-width:13ch;margin:14px 0 18px}
.op-panel h1.op-long{font-size:clamp(2rem,3.4vw,3.1rem);max-width:20ch}
.op-panel .cta-row{justify-content:flex-start}
.op-proof{display:flex;flex-wrap:wrap;gap:6px 22px;margin-top:22px;font-size:.92rem;color:var(--ink)}
.op-panel .op-photo{position:relative;min-height:320px;overflow:hidden}
.op-panel .op-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
@media (max-width:760px){.op-panel{grid-template-columns:1fr;min-height:0}.op-panel .op-words{padding:40px 20px 36px}.op-panel .op-photo{aspect-ratio:4/3;min-height:0}}
@media (max-width:520px){.op-panel .op-photo{aspect-ratio:1/1}}`,
  editorial: `
.op-editorial{text-align:center}
.op-editorial h1{font-size:clamp(2.5rem,6.2vw,5.4rem);line-height:1.04;max-width:18ch;margin:18px auto}
.op-editorial h1.op-long{font-size:clamp(2.1rem,4.2vw,3.6rem);max-width:24ch}
.op-editorial .op-line{margin:0 auto}
.op-editorial .cta-row{justify-content:center}
.op-photos{display:grid;gap:clamp(10px,1.4vw,18px);margin-top:clamp(36px,5vw,64px)}
.op-photos.n2{grid-template-columns:1fr 1fr}
.op-photos.n3{grid-template-columns:repeat(3,1fr)}
.op-ph{overflow:hidden}
.op-ph img{display:block;width:100%;height:auto;aspect-ratio:3/4;object-fit:cover}
.op-photos.n1 .op-ph img{aspect-ratio:16/9}
.op-photos.n2 .op-ph img{aspect-ratio:4/5}
@media (max-width:640px){.op-photos.n3{grid-template-columns:1fr 1fr}.op-photos.n3 .op-ph:first-child{grid-column:1/-1}.op-photos .op-ph img{aspect-ratio:1/1}.op-photos.n1 .op-ph img{aspect-ratio:4/3}}`,
  type: `
.op-type{background:var(--accent-band,var(--accent-dark,#1c2434));color:#fff;padding-top:clamp(56px,9vw,112px);padding-bottom:clamp(44px,6vw,80px)}
.op-type h1{color:#fff;font-size:clamp(2.6rem,7vw,6rem);line-height:1.02;letter-spacing:-.02em;max-width:15ch;margin:0 0 20px}
.op-type h1.op-long{font-size:clamp(2.1rem,4.6vw,3.9rem);max-width:22ch}
.op-type .op-line{color:rgba(255,255,255,.9)}
.op-type .cta-row{justify-content:flex-start}
.op-type .btn{background:#fff;color:var(--accent-band,var(--accent-dark,#1c2434));border-color:#fff;box-shadow:none}
.op-type .btn:hover{background:rgba(255,255,255,.88);color:var(--accent-band,var(--accent-dark,#1c2434));border-color:#fff}
.op-type .btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.75)}
.op-type .btn.ghost:hover{background:rgba(255,255,255,.12);color:#fff;border-color:#fff}
.op-type a{color:#fff}
.op-type :focus-visible{outline-color:#fff}
.op-facts{list-style:none;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin:44px 0 0;padding:28px 0 0;border-top:1px solid rgba(255,255,255,.24)}
.op-fact .op-big{display:block;font-family:var(--font-display,inherit);font-size:clamp(1.4rem,2.6vw,2.1rem);font-weight:700;line-height:1.15;overflow-wrap:anywhere}
.op-fact .op-lb{display:block;margin-top:4px;font-size:.92rem;color:rgba(255,255,255,.85)}
.op-fact:has(.open-now:empty){display:none}
@media (max-width:860px){.op-facts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.op-type .cta-row .btn{flex:1 1 100%;text-align:center}}`,
};

/** The rules a site drawn with this layout carries, after its design's own. Pure. */
export const openingCss = (kind: OpeningKind): string => OPENING_BASE + OPENING_CSS[kind];
