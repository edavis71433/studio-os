// ── restaurant-classic 1.0.0 — the look ──────────────────────────────────────
// Made for food: warm cream, a brick-red accent and serif headings, a Menu page
// drawn as a printed menu, and a Reserve a table button. Always a restaurant,
// whatever kind of business the site says. It was the first template, and keeps
// a few older choices of its own (TemplateLook.classic in lib/template_kit.ts).
// Everything else (the page shell, the home page's section order, every page, the helpers
// and the site files) is the one drawing all eight templates share: lib/template_kit.ts.
import { BLOCK_CSS } from '../../../lib/site_blocks.ts';
import { SEARCH_CSS } from '../../../lib/search_index.ts';
import { vocabFor } from '../../../lib/industry_vocab.ts';
import { makeRender } from '../../../lib/template_kit.ts';

// ═════════ CSS (one hand-authored sheet; system font stack — zero external assets) ═════════
// G2 parity: hero_layout 'split' (photo beside the welcome text, cream-framed) and
// nav_style 'centered' (stacked, centered header) — same settings as business-classic.
const CSS = `:root{--ink:#241d1a;--soft:#6b5f58;--cream:var(--bg,#faf6ef);--card:#ffffff;--accent:#8c3b2e;--accent-dark:#6f2e24;--line:#e7ddd0;--good:#2e6b46}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
html{scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
body{font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",sans-serif);background:var(--cream);color:var(--ink);line-height:1.65;font-size:1.03rem}
h1,h2,h3,.brand{font-family:var(--font-display,Georgia,'Iowan Old Style','Times New Roman',serif);font-weight:400;line-height:1.2;text-wrap:balance}
h1{font-size:clamp(2rem,5.5vw,3.2rem)}h2{font-size:clamp(1.5rem,3.5vw,2rem);margin-bottom:.6em}h3{font-size:1.15rem}
a{color:var(--accent)}a:hover{color:var(--accent-dark)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:2px}
.skip{position:absolute;left:-9999px;top:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99;border-radius:0 0 8px 0}
.skip:focus{left:0}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.site{background:var(--cream);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:18px;padding-bottom:18px;flex-wrap:wrap}
.nav.centered{flex-direction:column;gap:8px;justify-content:center;text-align:center}
.brand{font-size:1.35rem;color:var(--ink);text-decoration:none}
nav.primary ul{display:flex;gap:6px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:10px 12px;text-decoration:none;color:var(--ink);border-radius:8px;font-size:.95rem;min-height:44px;line-height:24px}
nav.primary a:hover{background:rgba(140,59,46,.08)}
nav.primary a[aria-current=page]{color:var(--accent);font-weight:600}
main{display:block}
.hero{padding-top:64px;padding-bottom:40px;text-align:center}
.hero .tagline{font-size:1.15rem;color:var(--soft);max-width:38rem;margin:14px auto 0}
.hero-img{margin-top:32px}.hero-img img{width:100%;max-width:860px;border-radius:14px;display:block;margin:0 auto}
.cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:26px}
.hero-split{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;align-items:center;text-align:left}
.hero-split .tagline{margin:14px 0 0}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{border-radius:var(--radius,14px);overflow:hidden;border:1px solid var(--line);background:var(--card)}
.hero-split .split-img img{width:100%;height:100%;min-height:280px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr;text-align:center}.hero-split .cta-row{justify-content:center}.hero-split .tagline{margin:14px auto 0}}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;min-height:44px}
.btn:hover{background:var(--accent-dark);color:#fff}
.btn.ghost{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
.strip{background:var(--ink);color:#f7f1e8;padding:12px 0;font-size:.95rem}
.strip .wrap{display:flex;gap:10px 24px;justify-content:center;flex-wrap:wrap;text-align:center}
.strip a{color:#f7f1e8}
.notice{background:#7a2f24;color:#fff;padding:12px 0;text-align:center;font-weight:600}
.block{padding-top:calc(44px * var(--spacing-scale,1));padding-bottom:calc(44px * var(--spacing-scale,1))}
section.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.menu-cat{margin-bottom:34px}
.menu-cat h2{color:var(--accent);letter-spacing:.04em;text-transform:uppercase;font-size:.95rem;font-family:var(--font-body,system-ui,sans-serif);font-weight:700;margin-bottom:14px;border-bottom:1px solid var(--line);padding-bottom:8px}
ul.items{list-style:none}
.item{display:flex;gap:16px;justify-content:space-between;align-items:baseline;padding:10px 0}
.item .nm{font-weight:600}
.item .ds{color:var(--soft);font-size:.95rem;margin-top:2px;max-width:34rem}
.item .pr{white-space:nowrap;color:var(--ink);font-variant-numeric:tabular-nums}
.dots{flex:1;border-bottom:1px dotted var(--line);transform:translateY(-4px);min-width:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius,10px) + 4px);padding:22px}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius,10px) + 4px);padding:22px}
.svc .nm{font-weight:600;font-size:1.05rem}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:6px}
.block--bg-accent .svc,.block--bg-dark .svc{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22)}
blockquote.t{font-size:1.05rem}
blockquote.t footer{margin-top:10px;color:var(--soft);font-size:.9rem;font-style:normal}
.faq dt{font-weight:600;margin-top:18px}
.faq dd{margin:6px 0 0;color:var(--soft)}
table.hours{border-collapse:collapse;width:100%;max-width:420px}
table.hours caption{text-align:left;font-weight:600;margin-bottom:8px}
table.hours th{text-align:left;font-weight:600;padding:6px 14px 6px 0}
table.hours td{padding:6px 0;color:var(--soft)}
table.hours tr[data-today] th,table.hours tr[data-today] td{color:var(--accent);font-weight:600}
.open-now{font-weight:700}.open-now.yes{color:#8fd0a5}.open-now.no{color:#f0b9ad}
.holiday{margin-top:14px;font-size:.95rem;color:var(--soft)}
article.post p{margin:0 0 1em}article.post h2,article.post h3{margin:1.4em 0 .5em}
article.post ul,article.post ol{margin:0 0 1em 1.4em}
article.post blockquote{border-left:3px solid var(--accent);padding-left:16px;color:var(--soft);margin:0 0 1em}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.4em 0 .5em}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:0 0 1em;color:var(--soft)}
.prose a{color:var(--accent);text-decoration:underline}
.post-meta{color:var(--soft);font-size:.9rem}
.post-list article{padding:22px 0;border-bottom:1px solid var(--line)}
.annbar{background:var(--accent);color:#fff;text-align:center;padding:9px 16px;font-size:.95rem}
.annbar a{color:#fff;text-decoration:underline}
.brandlogo{height:34px;width:auto;vertical-align:middle;margin-right:10px;border-radius:6px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
footer.site{background:var(--ink);color:#e9e0d2;padding:44px 0 30px;margin-top:56px}
footer.site a{color:#f2d9b8}
footer.site .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:28px}
footer.site h2{font-size:1.05rem;color:#fff;margin-bottom:10px}
footer.site table.hours td,footer.site table.hours th{color:#cfc4b2}
.credit{margin-top:30px;padding-top:16px;border-top:1px solid rgba(255,255,255,.15);font-size:.85rem;color:#a99e8c;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media(max-width:560px){.item{flex-wrap:wrap}.dots{display:none}.item .pr{width:100%}}
${BLOCK_CSS}
${SEARCH_CSS}`;

const CRITICAL = `:root{--ink:#241d1a;--soft:#6b5f58;--cream:#faf6ef;--accent:#8c3b2e;--line:#e7ddd0}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--cream);color:var(--ink);line-height:1.65;font-size:16.5px}h1,.brand{font-family:Georgia,'Times New Roman',serif;font-weight:400;line-height:1.2}h1{font-size:clamp(2rem,5.5vw,3.2rem)}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:#fff;padding:10px 18px;z-index:99}.wrap{max-width:960px;margin:0 auto;padding:0 20px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:18px;padding-bottom:18px;flex-wrap:wrap}nav.primary ul{display:flex;gap:6px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:10px 12px;text-decoration:none;color:var(--ink)}.hero{padding-top:64px;padding-bottom:40px;text-align:center}`;

export const render = makeRender({
  css: CSS, critical: CRITICAL,
  favicon: (letter) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#8c3b2e" data-accent="fill"/><text x="32" y="44" font-family="Georgia,serif" font-size="36" fill="#faf6ef" text-anchor="middle">${letter}</text></svg>`,
  postFrame: 'margin:20px 0',
  offerings: 'menu',
  vocab: { ...vocabFor('restaurant'), primaryAction: 'Reserve a table' },
  words: {
    reviews: 'What guests say', where: 'Where to find us', reach: 'Visit or call',
    contactDescription: (name) => `Address, phone, and opening hours for ${name}.`,
    offeringsDescription: (_label, name) => `The menu at ${name}.`,
    seeOfferings: () => 'See the menu',
  },
  classic: {
    plainWelcome: true, heroPhotoSizes: '(max-width: 900px) 100vw, 860px', inlineForm: true, reservations: true,
    files: { headers: `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n`, initial: 'P' },
  },
});

export default render;
