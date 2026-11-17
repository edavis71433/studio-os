// ── slate 1.0.0 — the look ───────────────────────────────────────────────────
// "Slate": a bold, confident dark theme for trades, consultants, and tech-
// adjacent businesses. Near-black charcoal ground with off-white ink, ONE
// electric teal accent used sparingly (CTAs, links, current-nav), crisp 6–8px
// radii, strong 1px grid lines instead of soft shadows, uppercase letterspaced
// kickers, heavy condensed-feeling headings, bordered panels on a slightly
// lighter ground with a subtle inner glow, and a sticky translucent dark-blur
// header.
// Everything else (the page shell, the home page's section order, every page, the helpers
// and the site files) is the one drawing all eight templates share: lib/template_kit.ts.
import { BLOCK_CSS } from '../../../lib/site_blocks.ts';
import { SEARCH_CSS } from '../../../lib/search_index.ts';
import { makeRender } from '../../../lib/template_kit.ts';

// ═════════ CSS — Slate: bold dark charcoal, one electric teal accent, crisp grid lines ═════════
// Slate is dark, and the builder's palettes and Background choice are written for light pages
// (dark text, dark accents). So its own colours win: html:root outranks the style layer's :root
// wherever that sits. Fonts, sizes, corners and spacing still follow the Styles panel.
// Both teals are light, as a dark page needs, so a section on the accent band (BLOCK_CSS
// .block--bg-accent: white words) takes a deeper teal of the same family: white reads 7.58:1
// on it, 2.49:1 on #14b8a6. tests/presence/accent_band_test.mjs. Its boxes (review cards, the
// Cards section, a spotlight) are darker than either band, so on a band they keep their own
// fill (--band-box): white reads 17.95:1 on it. tests/presence/band_words_test.mjs
// G1 radius token: surfaces (btn, hero/split images, svc/card, svc img, inputs, post hero) take var(--radius,<current>); the tiny 6px nav/kicker chips and brandlogo stay hardcoded — structural to Slate's crisp-grid look.
const CSS = `:root{color-scheme:dark;--ink:#eef1f5;--soft:#9ba4b5;--paper:var(--bg,#101216);--card:#161a21;--accent:#2dd4bf;--accent-dark:#14b8a6;--accent-band:#115e59;--band-box:var(--wash);--line:#262a33;--wash:#14171d}
html:root{--ink:#eef1f5;--soft:#9ba4b5;--paper:#101216;--accent:#2dd4bf;--accent-dark:#14b8a6}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.65;font-size:1.02rem;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
h1,h2,h3{font-family:var(--font-display,inherit);line-height:1.05;letter-spacing:-.035em;font-weight:800}
h1{font-size:clamp(2.5rem,6.4vw,4.2rem)}h2{font-size:clamp(1.5rem,3.4vw,2.1rem);margin-bottom:16px}h3{font-size:1.12rem;letter-spacing:-.02em}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--accent);color:#06201c;padding:10px 18px;z-index:99}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.hero-split{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center;text-align:left}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{border:1px solid var(--line);border-radius:var(--radius,8px);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.hero-split .split-img img{width:100%;height:100%;min-height:300px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr}}
.annbar{background:var(--accent);color:#06201c;text-align:center;padding:10px 16px;font-size:.92rem;font-weight:700;letter-spacing:.02em}
.annbar a{color:#06201c;text-decoration:underline}
.notice{background:#241d0d;color:#ecc862;border-bottom:1px solid var(--line);text-align:center;padding:10px 16px;font-size:.95rem}
header.site{background:rgba(16,18,22,.8);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}
.brand{font-family:var(--font-display,inherit);font-weight:800;font-size:1.16rem;letter-spacing:-.02em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:32px;width:auto;vertical-align:middle;margin-right:10px;border-radius:6px}
nav.primary ul{display:flex;gap:2px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:8px 12px;text-decoration:none;color:var(--soft);font-weight:700;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;border:1px solid transparent;border-radius:6px;transition:color .12s,background .12s}
nav.primary a:hover{color:var(--ink);background:var(--card)}
nav.primary a[aria-current="page"]{color:var(--accent);background:var(--card);border-color:var(--line)}
.hero{padding-top:calc(88px * var(--spacing-scale,1));padding-bottom:calc(56px * var(--spacing-scale,1))}
.hero .kicker{display:inline-block;color:var(--accent);background:var(--card);border:1px solid var(--line);font-weight:700;font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;padding:6px 12px;border-radius:6px}
.hero h1{margin:18px 0 14px;max-width:20ch;text-wrap:balance}
.tagline{font-size:1.25rem;color:var(--soft);max-width:54ch;line-height:1.55}
.cta-row{display:flex;gap:12px;margin-top:30px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--accent);color:#06201c;border:1px solid var(--accent);padding:13px 24px;border-radius:var(--radius,8px);text-decoration:none;font-weight:800;font-size:.95rem;letter-spacing:.02em;transition:background .12s,border-color .12s,color .12s}
.btn:hover{background:var(--accent-dark);border-color:var(--accent-dark);color:#06201c}
.btn.ghost{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.btn.ghost:hover{background:rgba(45,212,191,.12);border-color:var(--accent);color:var(--accent)}
.hero-img{margin-top:44px;border:1px solid var(--line);border-radius:var(--radius,8px);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.hero-img img{width:100%;height:auto;display:block}
.strip{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--soft);font-size:.9rem}
.strip .wrap{display:flex;gap:22px;flex-wrap:wrap;padding:12px 24px}
.strip a{color:var(--accent)}
.open-now{font-weight:700}.open-now.yes{color:#8fd0a5}.open-now.no{color:#f0b9ad}
.block{padding-top:calc(60px * var(--spacing-scale,1));padding-bottom:calc(60px * var(--spacing-scale,1))}
.block.alt{background:var(--wash);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:8px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:var(--radius,8px);padding:22px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04);transition:border-color .12s}
.svc:hover{border-color:#3a4150}
.svc .nm{font-weight:800;font-size:1.06rem;letter-spacing:-.01em}
.svc .ds{color:var(--soft);font-size:.94rem;margin-top:6px}
.svc .pr{color:var(--accent);font-weight:800;margin-top:10px;font-variant-numeric:tabular-nums}
.svc img{width:100%;height:auto;border:1px solid var(--line);border-radius:var(--radius,6px);margin-top:12px}
.cat-h{margin-top:38px;padding-bottom:8px;border-bottom:1px solid var(--line);text-transform:uppercase;letter-spacing:.14em;font-size:.85rem}
h2.cat-h{margin-bottom:0}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius,8px);padding:24px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
blockquote.t p{font-size:1.05rem}
blockquote.t footer{margin-top:12px;color:var(--soft);font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
dl.faq dt{font-weight:800;margin-top:22px;padding-top:22px;border-top:1px solid var(--line);letter-spacing:-.01em}
dl.faq dt:first-of-type{border-top:none;padding-top:0;margin-top:0}
dl.faq dd{color:var(--soft);margin-top:6px}
table.hours{border-collapse:collapse;width:100%;max-width:420px}
table.hours caption{text-align:left;font-weight:800;margin-bottom:10px;font-size:1.02rem}
table.hours th{text-align:left;font-weight:600;padding:7px 14px 7px 0;color:var(--soft)}
table.hours td{padding:7px 0;font-variant-numeric:tabular-nums}
table.hours tr{border-bottom:1px solid var(--line)}
.holiday{margin-top:14px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card label{font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--soft)}
form.card input,form.card textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius,6px);font:inherit;margin-top:6px;background:var(--paper);color:var(--ink)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
form.card p{margin-bottom:14px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:24px 0;border-bottom:1px solid var(--line)}
.post-list h2 a{color:var(--ink);text-decoration:none}
.post-list h2 a:hover{color:var(--accent)}
.post-meta{color:var(--soft);font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;margin:4px 0 8px}
article.post{max-width:720px}
article.post p{margin-bottom:16px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.3em 0 .4em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:2px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--accent);text-decoration:underline}
footer.site{background:#0b0d10;color:var(--ink);border-top:1px solid var(--line);padding:52px 0 34px;margin-top:72px}
footer.site a{color:var(--accent)}
footer.site h2{font-size:1rem;text-transform:uppercase;letter-spacing:.12em}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:30px}
.credit{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:.85rem;color:var(--soft);display:flex;gap:14px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn,.svc,nav.primary a{transition:none}}
@media (max-width:640px){.hero{padding-top:60px;padding-bottom:40px}.block{padding-top:44px;padding-bottom:44px}}
@media print{:root,html:root{color-scheme:light;--ink:#000;--soft:#444;--paper:#fff;--card:#fff;--accent:#0f766e;--accent-dark:#0f766e;--line:#999;--wash:#fff}body{background:#fff;color:#000}header.site{position:static;background:#fff;backdrop-filter:none;-webkit-backdrop-filter:none}.annbar,.notice{display:none}.btn{background:#fff;color:#000;border:1px solid #000}footer.site{background:#fff;color:#000}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{color-scheme:dark;--ink:#eef1f5;--soft:#9ba4b5;--paper:var(--bg,#101216);--accent:#2dd4bf;--line:#262a33}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65;font-size:16.5px}h1{font-size:clamp(2.5rem,6.4vw,4.2rem);line-height:1.05;letter-spacing:-.035em;font-weight:800}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--accent);color:#06201c;padding:10px 18px;z-index:99}.wrap{max-width:1120px;margin:0 auto;padding:0 24px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}nav.primary ul{display:flex;gap:2px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:8px 12px;text-decoration:none;color:#9ba4b5;font-weight:700;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase}.hero{padding-top:88px;padding-bottom:56px}`;

export const render = makeRender({
  css: CSS, critical: CRITICAL,
  favicon: (letter) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#101216"/><rect x="2" y="2" width="60" height="60" rx="8" fill="none" stroke="#2dd4bf" stroke-width="3"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="800" fill="#2dd4bf" text-anchor="middle">${letter}</text></svg>`,
  postFrame: 'margin:20px 0;border:1px solid var(--line);border-radius:var(--radius,8px);overflow:hidden',
});
