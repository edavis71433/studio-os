// ── harbor 1.0.0 — the look ──────────────────────────────────────────────────
// "Harbor": a structured, trustworthy design language for finance, legal,
// insurance, and home services. White ground anchored by deep navy (#1b2a4a)
// with a steel-blue secondary (#4a6fa5); strong left-aligned hierarchy; every
// section opens on a 40px/3px navy accent bar; boxed cards with 10px radii,
// 1px steel borders and a crisp 2px navy bottom rule; a split hero — text left,
// stat/checklist panel on a pale steel wash right; nav links underline on a
// 2px navy rule; tabular numerals on prices/stats; a dark-navy trust strip
// carrying the contact details.
// Everything else (the page shell, the home page's section order, every page, the helpers
// and the site files) is the one drawing all eight templates share: lib/template_kit.ts.
import { BLOCK_CSS } from '../../../lib/site_blocks.ts';
import { SEARCH_CSS } from '../../../lib/search_index.ts';
import { makeRender } from '../../../lib/template_kit.ts';

// ═════════ CSS — structured, trustworthy: navy anchor on a white ground (zero external assets) ═════════
// G1 radius token: surfaces (btn, hero panel, hero/split images, svc/card, svc img, inputs, post hero) take var(--radius,<current>); the tiny brandlogo chip stays hardcoded — structural.
const CSS = `:root{--ink:#1c2434;--soft:#4a556a;--paper:var(--bg,#ffffff);--card:#ffffff;--accent:#1b2a4a;--accent-dark:#12203a;--steel:#4a6fa5;--steel-dark:#3a5a8a;--line:#c9d5e6;--wash:#eef2f8}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.65;font-size:1.02rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,inherit);line-height:1.14;letter-spacing:-.015em;font-weight:700;color:var(--accent)}
h1{font-size:clamp(2.1rem,5vw,3.15rem);font-weight:800}h2{font-size:clamp(1.45rem,3vw,1.9rem);margin-bottom:16px}h3{font-size:1.08rem}
.block>.wrap>h1::before,.block>.wrap>h2::before,.block.wrap>h1::before,.block.wrap>h2::before{content:"";display:block;width:40px;border-top:3px solid var(--accent);margin:0 0 14px}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--accent);color:#fff;padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.annbar{background:var(--steel-dark);color:#fff;text-align:center;padding:10px 16px;font-size:.94rem;font-weight:600}
.annbar a{color:#fff;text-decoration:underline}
.notice{background:#fdf3e4;color:#6b4c12;text-align:center;padding:10px 16px;font-size:.95rem}
header.site{background:var(--paper);border-top:4px solid var(--accent);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}
.brand{font-family:var(--font-display,inherit);font-weight:800;font-size:1.18rem;letter-spacing:-.02em;color:var(--accent);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:6px}
nav.primary ul{display:flex;gap:18px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:9px 2px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.93rem;border-bottom:2px solid transparent}
nav.primary a:hover{color:var(--accent);border-bottom-color:var(--accent)}
nav.primary a[aria-current="page"]{color:var(--accent);border-bottom-color:var(--accent)}
.hero{padding-top:calc(72px * var(--spacing-scale,1));padding-bottom:calc(60px * var(--spacing-scale,1))}
.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:44px;align-items:center}
.hero-grid.solo{grid-template-columns:1fr}
.hero .kicker{display:inline-block;color:var(--steel-dark);font-weight:700;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;border-left:3px solid var(--accent);padding-left:10px}
.hero h1{margin:14px 0 12px;max-width:20ch;text-wrap:balance}
.tagline{font-size:1.22rem;color:var(--soft);max-width:54ch;line-height:1.55}
.cta-row{display:flex;gap:12px;margin-top:28px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:12px 26px;border:2px solid var(--accent);border-radius:var(--radius,8px);text-decoration:none;font-weight:700;font-size:.98rem;transition:background .12s,border-color .12s}
.btn:hover{background:var(--accent-dark);border-color:var(--accent-dark)}
.btn.ghost{background:transparent;color:var(--steel-dark);border-color:var(--steel)}
.btn.ghost:hover{background:var(--wash);color:var(--accent);border-color:var(--steel-dark)}
.hero-panel{background:var(--wash);border:1px solid var(--line);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:26px 28px}
.hp-title{font-size:.76rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--steel-dark);margin-bottom:10px}
.checklist{list-style:none}
.checklist li{position:relative;padding:9px 0 9px 26px;border-bottom:1px solid var(--line);font-weight:600;font-size:.97rem}
.checklist li:last-child{border-bottom:0}
.checklist li::before{content:"✓";position:absolute;left:2px;top:8px;color:var(--accent);font-weight:800}
.hp-stats{display:flex;gap:26px;flex-wrap:wrap;margin-top:16px}
.hp-stats .num{display:block;font-size:1.55rem;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;line-height:1.2}
.hp-stats .hp-lb{display:block;font-size:.78rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--soft)}
.hp-contact{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);font-weight:600;font-variant-numeric:tabular-nums}
.hp-contact a{color:var(--steel-dark)}
.split-img{border-radius:var(--radius,10px);overflow:hidden;border:1px solid var(--line);border-bottom:2px solid var(--accent)}
.split-img img{width:100%;height:100%;min-height:300px;object-fit:cover;display:block}
.hero-img{margin-top:40px;border-radius:var(--radius,10px);overflow:hidden;border:1px solid var(--line);border-bottom:2px solid var(--accent)}
.hero-img img{width:100%;height:auto;display:block}
.strip{background:var(--accent);color:#d9e1f0;font-size:.92rem;font-variant-numeric:tabular-nums}
.strip .wrap{display:flex;gap:24px;flex-wrap:wrap;padding:12px 24px}
.strip a{color:#b9cdea}
.open-now{font-weight:700}.open-now.yes{color:#8fd0a5}.open-now.no{color:#f0b9ad}
.block{padding-top:calc(60px * var(--spacing-scale,1));padding-bottom:calc(60px * var(--spacing-scale,1))}
.block.alt{background:var(--wash)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin-top:8px}
.svc{background:var(--card);border:1px solid var(--steel);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:22px;transition:transform .12s,box-shadow .12s}
.svc:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(27,42,74,.12)}
.svc .nm{font-weight:700;font-size:1.06rem;color:var(--accent)}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:6px}
.svc .pr{color:var(--steel-dark);font-weight:800;margin-top:10px;font-variant-numeric:tabular-nums}
.svc img{width:100%;height:auto;border-radius:var(--radius,6px);margin-top:12px}
.block--bg-accent .svc,.block--bg-dark .svc{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22)}
.cat-h{margin-top:38px;border-left:3px solid var(--accent);padding-left:12px}
h2.cat-h{margin-bottom:0;font-size:1.08rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--steel);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:24px}
blockquote.t p{font-size:1.02rem}
blockquote.t footer{margin-top:12px;color:var(--soft);font-size:.92rem;font-weight:700}
dl.faq dt{font-weight:700;margin-top:22px;color:var(--accent)}
dl.faq dd{color:var(--soft);margin-top:6px}
table.hours{border-collapse:collapse;width:100%;max-width:420px;font-variant-numeric:tabular-nums}
table.hours caption{text-align:left;font-weight:700;margin-bottom:10px;font-size:1.02rem}
table.hours th{text-align:left;font-weight:600;padding:7px 14px 7px 0;color:var(--soft)}
table.hours td{padding:7px 0}
.holiday{margin-top:14px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card label{font-weight:700;font-size:.94rem}
form.card input,form.card textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius,8px);font:inherit;margin-top:5px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--steel-dark);outline-offset:1px}
form.card p{margin-bottom:14px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:24px 0;border-bottom:1px solid var(--line)}
.post-meta{color:var(--soft);font-size:.9rem;margin:4px 0 8px;font-variant-numeric:tabular-nums}
article.post{max-width:720px}
article.post p{margin-bottom:16px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.3em 0 .4em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--steel-dark);text-decoration:underline}
footer.site{background:var(--accent);color:#d9e1f0;padding:50px 0 32px;margin-top:72px;border-top:3px solid var(--steel)}
footer.site a{color:#b9cdea}
footer.site h2{font-size:1.08rem;color:#fff}
footer.site table.hours th{color:#d0d9ea}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:30px}
.credit{margin-top:30px;padding-top:18px;border-top:1px solid rgba(255,255,255,.16);font-size:.88rem;color:#a7b6d1;display:flex;gap:14px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--steel-dark);outline-offset:2px}
footer.site :focus-visible,.strip :focus-visible,.annbar :focus-visible{outline-color:#b9cdea}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn,.svc{transition:none}.svc:hover{transform:none}}
@media (max-width:860px){.hero-grid{grid-template-columns:1fr;gap:28px}}
@media (max-width:640px){.hero{padding-top:52px;padding-bottom:40px}.block{padding-top:44px;padding-bottom:44px}}
@media print{.annbar,.sitesearch,.skip,.cta-row{display:none}header.site{position:static;border-top-color:#000}.strip,footer.site{background:#fff;color:#000;border:0}.strip a,footer.site a{color:#000}footer.site h2{color:#000}footer.site table.hours th{color:#333}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#1c2434;--soft:#4a556a;--paper:var(--bg,#ffffff);--accent:#1b2a4a;--steel:#4a6fa5;--line:#c9d5e6;--wash:#eef2f8}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65;font-size:16.3px}h1{font-size:clamp(2.1rem,5vw,3.15rem);line-height:1.14;letter-spacing:-.015em;font-weight:800;color:var(--accent)}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--accent);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}header.site{border-top:4px solid var(--accent);border-bottom:1px solid var(--line)}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}nav.primary ul{display:flex;gap:18px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:9px 2px;text-decoration:none;color:#4a556a;font-weight:600;border-bottom:2px solid transparent}.hero{padding-top:72px;padding-bottom:60px}.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:44px;align-items:center}.hero-panel{background:var(--wash);border:1px solid var(--line);border-bottom:2px solid var(--accent);border-radius:var(--radius,10px);padding:26px 28px}@media (max-width:860px){.hero-grid{grid-template-columns:1fr;gap:28px}}`;

export const render = makeRender({
  css: CSS, critical: CRITICAL,
  favicon: (letter) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1b2a4a" data-accent="fill"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`,
  postFrame: 'margin:20px 0;border-radius:var(--radius,10px);overflow:hidden;border:1px solid var(--line)',
  hero: 'panel',
  words: { reviews: 'What clients say' },
});
