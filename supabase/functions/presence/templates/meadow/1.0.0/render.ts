// ── meadow 1.0.0 — the look (#183 template family) ───────────────────────────
// "Meadow": a warm, organic look for wellness, health, nonprofits, and family
// businesses. Soft warm cream ground with deep moss-green ink, a muted sage/moss
// accent, large friendly corner radii, airy spacing, green-tinted layered shadows,
// a gentle sage→cream hero wash, pill buttons, hand-warmed testimonial cards with
// a tilted quote mark, and small leaf-like CSS dots (zero images).
// Everything else (the page shell, the home page's section order, every page, the helpers
// and the site files) is the one drawing all eight templates share: lib/template_kit.ts.
import { BLOCK_CSS } from '../../../lib/site_blocks.ts';
import { SEARCH_CSS } from '../../../lib/search_index.ts';
import { makeRender } from '../../../lib/template_kit.ts';

// ═════════ CSS — warm, organic, garden-calm (zero external assets) ═════════
// Ground: warm cream. Ink: deep moss. Accent: muted sage/moss (#4a7c59 — white on
// it is 4.87:1, AA). Soft (#55624f) is 5.8:1 on cream and 5.6:1 on the sage wash.
// Radii are large and friendly (20–26px), shadows are layered with a green tint,
// G1 radius token: those large surface radii (hero/split images, svc/card, svc img, inputs, footer top, post hero) take var(--radius,<current>); pills (btn/nav/kicker, 999px) and the brandlogo chip stay hardcoded — pill-ness is the design.
// buttons are pills, headings use --font-display with a Georgia-ending fallback,
// and leaf-like dots (pure CSS radial-gradients) mark section headings.
const CSS = `:root{--ink:#243428;--soft:#55624f;--paper:var(--bg,#faf7f0);--card:#fffdf7;--accent:#4a7c59;--accent-dark:#345c41;--line:#e4dfcd;--wash:#edf2e2;--sprout:#7ba374;--seed:#b8cfa2}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,"Seravek","Gill Sans",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background-color:var(--paper);background-image:radial-gradient(120% 620px at 50% -120px,#e7efd9 0%,rgba(231,239,217,0) 72%);background-repeat:no-repeat;color:var(--ink);line-height:1.7;font-size:1.04rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);line-height:1.14;letter-spacing:-.015em;font-weight:700}
h1{font-size:clamp(2.3rem,5.6vw,3.7rem)}h2{font-size:clamp(1.5rem,3.2vw,2.05rem);margin-bottom:18px}h3{font-size:1.16rem}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.hero-split{display:grid;grid-template-columns:1.1fr 1fr;gap:44px;align-items:center;text-align:left}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{border-radius:var(--radius,26px);overflow:hidden;box-shadow:0 3px 8px rgba(53,92,66,.07),0 28px 64px rgba(53,92,66,.14)}
.hero-split .split-img img{width:100%;height:100%;min-height:300px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr}}
.annbar{background:var(--accent);color:#fff;text-align:center;padding:11px 16px;font-size:.95rem;font-weight:500}
.annbar a{color:#fff;text-decoration:underline}
.notice{background:#fbf0dc;color:#6a4d15;text-align:center;padding:10px 16px;font-size:.95rem}
header.site{background:rgba(250,247,240,.85);backdrop-filter:saturate(1.4) blur(12px);-webkit-backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:16px;padding-bottom:16px;flex-wrap:wrap}
.brand{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-weight:700;font-size:1.3rem;letter-spacing:-.015em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:10px}
nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:9px 16px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.94rem;border-radius:999px}
nav.primary a:hover{color:var(--accent-dark);background:var(--wash)}
nav.primary a[aria-current="page"]{color:#fff;background:var(--accent)}
.hero{padding-top:calc(100px * var(--spacing-scale,1));padding-bottom:calc(64px * var(--spacing-scale,1))}
.hero .kicker{display:inline-block;color:var(--accent-dark);background:var(--wash);border:1px solid #dbe6cb;font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;padding:7px 16px;border-radius:999px}
.hero h1{margin:18px 0 14px;max-width:20ch;text-wrap:balance}
.tagline{font-size:1.26rem;color:var(--soft);max-width:54ch;line-height:1.55}
.cta-row{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:15px 30px;border-radius:999px;text-decoration:none;font-weight:700;font-size:1rem;box-shadow:0 2px 6px rgba(53,92,66,.12),0 10px 26px rgba(53,92,66,.22);transition:transform .12s,box-shadow .12s,background-color .12s}
.btn:hover{background:var(--accent-dark);transform:translateY(-1px);box-shadow:0 3px 8px rgba(53,92,66,.14),0 14px 32px rgba(53,92,66,.26)}
.btn.ghost{background:transparent;color:var(--accent-dark);border:2px solid #cfdcc0;box-shadow:none}
.btn.ghost:hover{background:var(--wash);border-color:var(--accent);transform:none}
.hero-img{margin-top:48px;border-radius:var(--radius,26px);overflow:hidden;box-shadow:0 3px 8px rgba(53,92,66,.07),0 32px 72px rgba(53,92,66,.15)}
.hero-img img{width:100%;height:auto;display:block}
.strip{background:var(--ink);color:#dfe7db;font-size:.92rem}
.strip .wrap{display:flex;gap:22px;flex-wrap:wrap;padding:13px 24px}
.strip a{color:#c2dcc0}
.open-now{font-weight:700}.open-now.yes{color:#8fd0a5}.open-now.no{color:#f0b9ad}
.block{padding-top:calc(76px * var(--spacing-scale,1));padding-bottom:calc(76px * var(--spacing-scale,1))}
.block.alt{background:var(--wash)}
.block>.wrap>h1::before,.block.wrap>h1::before,.block>.wrap>h2::before,.block.wrap>h2::before{content:"";display:block;width:46px;height:10px;margin-bottom:14px;background:radial-gradient(9px 10px at 5px 5px,var(--accent) 60%,transparent 64%),radial-gradient(9px 10px at 22px 5px,var(--sprout) 60%,transparent 64%),radial-gradient(9px 10px at 39px 5px,var(--seed) 60%,transparent 64%)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:22px;margin-top:8px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:var(--radius,24px);padding:26px;box-shadow:0 1px 3px rgba(53,92,66,.05),0 6px 18px rgba(53,92,66,.05);transition:transform .12s,box-shadow .12s}
.svc:hover{transform:translateY(-3px);box-shadow:0 2px 6px rgba(53,92,66,.07),0 20px 44px rgba(53,92,66,.12)}
.svc .nm{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-weight:700;font-size:1.12rem}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:6px}
.svc .pr{color:var(--accent-dark);font-weight:700;margin-top:10px}
.svc img{width:100%;height:auto;border-radius:var(--radius,16px);margin-top:14px}
.block--bg-accent .svc,.block--bg-dark .svc{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22)}
.cat-h{margin-top:42px;padding-bottom:8px;border-bottom:2px solid #dbe6cb}
h2.cat-h{margin-bottom:0;font-size:1.16rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius,24px);padding:26px;box-shadow:0 1px 3px rgba(53,92,66,.05),0 8px 26px rgba(53,92,66,.06)}
blockquote.t{position:relative;padding-top:16px}
blockquote.t::before{content:"\\201C";position:absolute;top:-8px;left:-4px;font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-size:3.6rem;line-height:1;color:var(--accent);opacity:.3;transform:rotate(-9deg)}
blockquote.t p{font-size:1.05rem}
blockquote.t footer{margin-top:12px;color:var(--soft);font-size:.92rem;font-weight:700}
dl.faq dt{font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif);font-weight:700;margin-top:24px;font-size:1.08rem}
dl.faq dd{color:var(--soft);margin-top:6px}
table.hours{border-collapse:collapse;width:100%;max-width:420px}
table.hours caption{text-align:left;font-weight:700;margin-bottom:10px;font-size:1.05rem}
table.hours th{text-align:left;font-weight:600;padding:7px 14px 7px 0;color:var(--soft)}
table.hours td{padding:7px 0}
.holiday{margin-top:14px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card label{font-weight:700;font-size:.94rem}
form.card input,form.card textarea{width:100%;padding:12px 14px;border:1px solid #d5d0bd;border-radius:var(--radius,14px);font:inherit;margin-top:5px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
form.card p{margin-bottom:14px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:26px 0;border-bottom:1px solid var(--line)}
.post-list h2 a{color:var(--ink)}
.post-meta{color:var(--soft);font-size:.9rem;margin:4px 0 8px}
article.post{max-width:720px}
article.post p{margin-bottom:16px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.3em 0 .4em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--accent-dark);text-decoration:underline}
footer.site{background:var(--ink);color:#dfe7db;padding:56px 0 36px;margin-top:80px;border-radius:var(--radius,26px) var(--radius,26px) 0 0}
footer.site a{color:#bcd9bb}
footer.site h2{font-size:1.15rem}
footer.site table.hours th{color:#a9bda5}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:32px}
.credit{margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.16);font-size:.88rem;color:#9db29a;display:flex;gap:14px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn,.svc{transition:none}.btn:hover,.svc:hover{transform:none}}
@media (max-width:640px){.hero{padding-top:64px;padding-bottom:44px}.block{padding-top:52px;padding-bottom:52px}}
@media print{body{background:#fff}.annbar,.skip{display:none}header.site{position:static}.btn,.svc,.card,.hero-img{box-shadow:none}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#243428;--soft:#55624f;--paper:var(--bg,#faf7f0);--accent:#4a7c59;--line:#e4dfcd}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-body,"Seravek","Gill Sans",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background-color:var(--paper);background-image:radial-gradient(120% 620px at 50% -120px,#e7efd9 0%,rgba(231,239,217,0) 72%);background-repeat:no-repeat;color:var(--ink);line-height:1.7;font-size:16.5px}h1{font-size:clamp(2.3rem,5.6vw,3.7rem);line-height:1.14;letter-spacing:-.015em;font-weight:700;font-family:var(--font-display,"Palatino Linotype",Palatino,Georgia,serif)}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:16px;padding-bottom:16px;flex-wrap:wrap}nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:9px 16px;text-decoration:none;color:#55624f;font-weight:600}.hero{padding-top:100px;padding-bottom:64px}`;

export const render = makeRender({
  css: CSS, critical: CRITICAL,
  favicon: (letter) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="#4a7c59" data-accent="fill"/><text x="32" y="44" font-family="Georgia,serif" font-size="34" font-weight="700" fill="#faf7f0" text-anchor="middle">${letter}</text></svg>`,
  postFrame: 'margin:20px 0;border-radius:var(--radius,20px);overflow:hidden',
});
