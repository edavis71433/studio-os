// ── business-classic 1.0.0 — the look (Phase T3) ─────────────────────────────
// THE neutral production default: crisp cards and a calm green, for every kind of
// business. The site's kind of business picks the words, paths, buttons and
// schema.org type (lib/industry_vocab.ts): a plumber gets "Services" and
// @type:Plumber, a salon HairSalon, a restaurant Menu and @type:Restaurant.
// Everything else (the page shell, the home page's section order, every page, the helpers
// and the site files) is the one drawing all eight templates share: lib/template_kit.ts.
import { BLOCK_CSS } from '../../../lib/site_blocks.ts';
import { SEARCH_CSS } from '../../../lib/search_index.ts';
import { makeRender } from '../../../lib/template_kit.ts';

// ═════════ CSS — a modern, confident, industry-neutral look (zero external assets) ═════════
const CSS = `:root{--ink:#1c2430;--soft:#5b6572;--paper:var(--bg,#f7f7f5);--card:#ffffff;--accent:#23635a;--accent-dark:#17453f;--line:#e2e4e1;--wash:#eef1ee}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.65;font-size:1.03rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,inherit);line-height:1.15;letter-spacing:-.015em;font-weight:700}
h1{font-size:clamp(2.1rem,5.5vw,3.4rem)}h2{font-size:clamp(1.35rem,3vw,1.8rem);margin-bottom:16px}h3{font-size:1.1rem}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}
.wrap{max-width:1000px;margin:0 auto;padding:0 22px}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.hero-split{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;align-items:center;text-align:left}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(28,36,48,.14)}
.hero-split .split-img img{width:100%;height:100%;min-height:280px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr}}
.annbar{background:var(--accent);color:#fff;text-align:center;padding:9px 16px;font-size:.95rem}
.annbar a{color:#fff;text-decoration:underline}
.notice{background:#fdf3e4;color:#6b4c12;text-align:center;padding:10px 16px;font-size:.95rem}
header.site{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}
.brand{font-family:var(--font-display,inherit);font-weight:800;font-size:1.15rem;letter-spacing:-.01em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:6px}
nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:9px 12px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.95rem;border-radius:8px}
nav.primary a:hover{color:var(--ink);background:var(--wash)}
nav.primary a[aria-current="page"]{color:var(--accent-dark);background:var(--wash)}
.hero{padding-top:calc(72px * var(--spacing-scale,1));padding-bottom:calc(48px * var(--spacing-scale,1))}
.hero .kicker{color:var(--accent-dark);font-weight:700;font-size:.85rem;letter-spacing:.1em;text-transform:uppercase}
.hero h1{margin:10px 0 12px;max-width:20ch;text-wrap:balance}
.tagline{font-size:1.2rem;color:var(--soft);max-width:52ch}
.cta-row{display:flex;gap:12px;margin-top:26px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:13px 24px;border-radius:var(--radius,10px);text-decoration:none;font-weight:700;font-size:1rem}
.btn:hover{background:var(--accent-dark)}
.btn.ghost{background:transparent;color:var(--accent-dark);border:2px solid var(--accent)}
.btn.ghost:hover{background:var(--wash)}
.hero-img{margin-top:36px;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(28,36,48,.14)}
.hero-img img{width:100%;height:auto;display:block}
.strip{background:var(--ink);color:#e8ebe9;font-size:.92rem}
.strip .wrap{display:flex;gap:22px;flex-wrap:wrap;padding:11px 22px}
.strip a{color:#bfe3da}
.open-now{font-weight:700}.open-now.yes{color:#8fd0a5}.open-now.no{color:#f0b9ad}
.block{padding-top:calc(52px * var(--spacing-scale,1));padding-bottom:calc(52px * var(--spacing-scale,1))}
.block.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin-top:8px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius,10px) + 4px);padding:20px 22px}
.block.alt .svc{background:var(--paper)}
.svc .nm{font-weight:700;font-size:1.05rem}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:6px}
.svc .pr{color:var(--accent-dark);font-weight:700;margin-top:10px}
.svc img{width:100%;height:auto;border-radius:10px;margin-top:12px}
.block--bg-accent .svc,.block--bg-dark .svc{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22)}
.cat-h{margin-top:34px;padding-bottom:8px;border-bottom:2px solid var(--wash)}
h2.cat-h{margin-bottom:0;font-size:1.1rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius,10px) + 4px);padding:22px}
blockquote.t p{font-size:1.02rem}
blockquote.t footer{margin-top:12px;color:var(--soft);font-size:.92rem;font-weight:600}
dl.faq dt{font-weight:700;margin-top:20px}
dl.faq dd{color:var(--soft);margin-top:6px}
table.hours{border-collapse:collapse;width:100%;max-width:420px}
table.hours caption{text-align:left;font-weight:700;margin-bottom:10px;font-size:1.05rem}
table.hours th{text-align:left;font-weight:600;padding:7px 14px 7px 0;color:var(--soft)}
table.hours td{padding:7px 0}
.holiday{margin-top:14px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card label{font-weight:600;font-size:.94rem}
form.card input,form.card textarea{width:100%;padding:11px;border:1px solid var(--line);border-radius:var(--radius,9px);font:inherit;margin-top:5px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
form.card p{margin-bottom:14px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:22px 0;border-bottom:1px solid var(--line)}
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
footer.site{background:var(--ink);color:#dfe4e1;padding:46px 0 32px;margin-top:64px}
footer.site a{color:#bfe3da}
footer.site h2{font-size:1.1rem}
footer.site table.hours th{color:#b4bdb9}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:30px}
.credit{margin-top:30px;padding-top:18px;border-top:1px solid rgba(255,255,255,.14);font-size:.88rem;color:#9aa5a0;display:flex;gap:14px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (max-width:640px){.hero{padding-top:52px;padding-bottom:36px}.block{padding-top:40px;padding-bottom:40px}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#1c2430;--soft:#5b6572;--paper:var(--bg,#f7f7f5);--accent:#23635a;--line:#e2e4e1}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65;font-size:16.5px}h1{font-size:clamp(2.1rem,5.5vw,3.4rem);line-height:1.15;letter-spacing:-.015em}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:1000px;margin:0 auto;padding:0 22px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:9px 12px;text-decoration:none;color:#5b6572;font-weight:600}.hero{padding-top:72px;padding-bottom:48px}`;

export const render = makeRender({
  css: CSS, critical: CRITICAL,
  favicon: (letter) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#23635a" data-accent="fill"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#f7f7f5" text-anchor="middle">${letter}</text></svg>`,
  postFrame: 'margin:20px 0;border-radius:14px;overflow:hidden',
});
