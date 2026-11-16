// ── aurora 1.0.0 — the look ──────────────────────────────────────────────────
// "Aurora": bright and modern. Bold type, pill buttons and a soft indigo glow on a
// light ground, for fitness, consultants and events.
// Everything else (the page shell, the home page's section order, every page, the helpers
// and the site files) is the one drawing all eight templates share: lib/template_kit.ts.
import { BLOCK_CSS } from '../../../lib/site_blocks.ts';
import { SEARCH_CSS } from '../../../lib/search_index.ts';
import { makeRender } from '../../../lib/template_kit.ts';

// ═════════ CSS — a modern, confident, industry-neutral look (zero external assets) ═════════
// G1 radius token: big surfaces (hero/split images, svc/card, svc img, inputs, post hero) take var(--radius,<current>); pills (btn/nav/kicker, 999px) and the brandlogo chip stay hardcoded — pill-ness is the design.
const CSS = `:root{--ink:#16171d;--soft:#636471;--paper:var(--bg,#ffffff);--card:#ffffff;--accent:#4f46e5;--accent-dark:#3730a3;--line:#eaeaf1;--wash:#f4f3fc}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.65;font-size:1.04rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,inherit);line-height:1.08;letter-spacing:-.03em;font-weight:800}
h1{font-size:clamp(2.4rem,6vw,4rem)}h2{font-size:clamp(1.5rem,3.4vw,2.1rem);margin-bottom:16px}h3{font-size:1.12rem;letter-spacing:-.02em}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.hero-split{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center;text-align:left}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{border-radius:var(--radius,22px);overflow:hidden;box-shadow:0 30px 70px rgba(79,70,229,.16)}
.hero-split .split-img img{width:100%;height:100%;min-height:300px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr}}
.annbar{background:var(--accent);color:#fff;text-align:center;padding:10px 16px;font-size:.95rem;font-weight:500}
.annbar a{color:#fff;text-decoration:underline}
.notice{background:#fdf3e4;color:#6b4c12;text-align:center;padding:10px 16px;font-size:.95rem}
header.site{background:rgba(255,255,255,.82);backdrop-filter:saturate(1.6) blur(12px);-webkit-backdrop-filter:saturate(1.6) blur(12px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:15px;padding-bottom:15px;flex-wrap:wrap}
.brand{font-family:var(--font-display,inherit);font-weight:800;font-size:1.2rem;letter-spacing:-.03em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:8px}
nav.primary ul{display:flex;gap:2px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:9px 14px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.94rem;border-radius:999px}
nav.primary a:hover{color:var(--ink);background:var(--wash)}
nav.primary a[aria-current="page"]{color:#fff;background:var(--accent)}
.hero{padding-top:calc(88px * var(--spacing-scale,1));padding-bottom:calc(56px * var(--spacing-scale,1))}
.hero .kicker{display:inline-block;color:var(--accent-dark);background:var(--wash);font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;padding:6px 14px;border-radius:999px}
.hero h1{margin:16px 0 14px;max-width:18ch;text-wrap:balance}
.tagline{font-size:1.28rem;color:var(--soft);max-width:54ch;line-height:1.5}
.cta-row{display:flex;gap:12px;margin-top:30px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:1rem;box-shadow:0 8px 22px rgba(79,70,229,.28);transition:transform .12s,box-shadow .12s}
.btn:hover{background:var(--accent-dark);transform:translateY(-1px);box-shadow:0 12px 28px rgba(79,70,229,.34)}
.btn.ghost{background:transparent;color:var(--accent-dark);border:2px solid var(--line);box-shadow:none}
.btn.ghost:hover{background:var(--wash);border-color:var(--accent);transform:none}
.hero-img{margin-top:44px;border-radius:var(--radius,22px);overflow:hidden;box-shadow:0 30px 70px rgba(79,70,229,.16)}
.hero-img img{width:100%;height:auto;display:block}
.strip{background:var(--ink);color:#e7e7ef;font-size:.92rem}
.strip .wrap{display:flex;gap:22px;flex-wrap:wrap;padding:12px 24px}
.strip a{color:#c7c4f5}
.open-now{font-weight:700}.open-now.yes{color:#8fd0a5}.open-now.no{color:#f0b9ad}
.block{padding-top:calc(60px * var(--spacing-scale,1));padding-bottom:calc(60px * var(--spacing-scale,1))}
.block.alt{background:var(--wash)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px;margin-top:8px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:var(--radius,18px);padding:24px;box-shadow:0 1px 3px rgba(22,23,40,.05);transition:transform .12s,box-shadow .12s}
.svc:hover{transform:translateY(-3px);box-shadow:0 16px 40px rgba(22,23,40,.09)}
.svc .nm{font-weight:800;font-size:1.08rem;letter-spacing:-.01em}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:6px}
.svc .pr{color:var(--accent-dark);font-weight:800;margin-top:10px}
.svc img{width:100%;height:auto;border-radius:var(--radius,12px);margin-top:12px}
.block--bg-accent .svc,.block--bg-dark .svc{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22)}
.cat-h{margin-top:38px;padding-bottom:8px;border-bottom:2px solid var(--wash)}
h2.cat-h{margin-bottom:0;font-size:1.12rem;letter-spacing:-.02em}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius,18px);padding:24px;box-shadow:0 4px 24px rgba(22,23,40,.05)}
blockquote.t p{font-size:1.05rem}
blockquote.t footer{margin-top:12px;color:var(--soft);font-size:.92rem;font-weight:700}
dl.faq dt{font-weight:800;margin-top:22px;letter-spacing:-.01em}
dl.faq dd{color:var(--soft);margin-top:6px}
table.hours{border-collapse:collapse;width:100%;max-width:420px}
table.hours caption{text-align:left;font-weight:800;margin-bottom:10px;font-size:1.05rem}
table.hours th{text-align:left;font-weight:600;padding:7px 14px 7px 0;color:var(--soft)}
table.hours td{padding:7px 0}
.holiday{margin-top:14px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card label{font-weight:700;font-size:.94rem}
form.card input,form.card textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius,12px);font:inherit;margin-top:5px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
form.card p{margin-bottom:14px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:24px 0;border-bottom:1px solid var(--line)}
.post-meta{color:var(--soft);font-size:.9rem;margin:4px 0 8px}
article.post{max-width:720px}
article.post p{margin-bottom:16px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.3em 0 .4em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--accent);text-decoration:underline}
footer.site{background:var(--ink);color:#dfe0ea;padding:52px 0 34px;margin-top:72px}
footer.site a{color:#c7c4f5}
footer.site h2{font-size:1.1rem}
footer.site table.hours th{color:#b4b5c6}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:30px}
.credit{margin-top:30px;padding-top:18px;border-top:1px solid rgba(255,255,255,.14);font-size:.88rem;color:#9a9bb0;display:flex;gap:14px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn,.svc{transition:none}}
@media (max-width:640px){.hero{padding-top:60px;padding-bottom:40px}.block{padding-top:44px;padding-bottom:44px}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#16171d;--soft:#636471;--paper:var(--bg,#ffffff);--accent:#4f46e5;--line:#eaeaf1}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65;font-size:16.5px}h1{font-size:clamp(2.4rem,6vw,4rem);line-height:1.08;letter-spacing:-.03em;font-weight:800}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:15px;padding-bottom:15px;flex-wrap:wrap}nav.primary ul{display:flex;gap:2px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:9px 14px;text-decoration:none;color:#636471;font-weight:600}.hero{padding-top:88px;padding-bottom:56px}`;

export const render = makeRender({
  css: CSS, critical: CRITICAL,
  favicon: (letter) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4f46e5" data-accent="fill"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#f7f7f5" text-anchor="middle">${letter}</text></svg>`,
  postFrame: 'margin:20px 0;border-radius:var(--radius,14px);overflow:hidden',
});
