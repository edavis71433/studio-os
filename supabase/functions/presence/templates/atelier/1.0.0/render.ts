// ── atelier 1.0.0 — the look ─────────────────────────────────────────────────
// An elegant boutique/luxury design language for salons, studios, photographers,
// and premium services: ivory ground, near-black ink, fine serif display
// headings, a restrained bronze accent used ONLY for rules/kickers/small-caps
// labels (never large fills), hairline rules instead of shadows, a centered hero
// with a small-caps letterspaced kicker over a huge serif headline, offerings as
// a refined name — dotted leader — price list, understated 1px-ink-border
// buttons that fill with ink on hover, and a quiet centered colophon footer.
// Everything else (the page shell, the home page's section order, every page, the helpers
// and the site files) is the one drawing all eight templates share: lib/template_kit.ts.
import { BLOCK_CSS } from '../../../lib/site_blocks.ts';
import { SEARCH_CSS } from '../../../lib/search_index.ts';
import { makeRender } from '../../../lib/template_kit.ts';

// ═════════ CSS — ivory, ink, bronze hairlines: quiet luxury (zero external assets) ═════════
// Contrast notes (AA): ink #1c1b18 on ivory #fbfaf7 ≈ 15.9:1; soft #5b564c ≈ 7.0:1;
// bronze TEXT uses the darkened --accent-ink #7a5f3a ≈ 5.7:1 — the lighter #9a7b4f
// bronze is reserved for 1px rules and decorative leaders only.
const CSS = `:root{--ink:#1c1b18;--soft:#5b564c;--paper:var(--bg,#fbfaf7);--card:#ffffff;--accent:#9a7b4f;--accent-ink:#7a5f3a;--accent-dark:#7a5f3a;--line:#e5e0d5;--wash:#f4f1e9}
html{font-size:calc(100% * var(--font-scale,1))}
*{margin:0;padding:0;box-sizing:border-box}
picture{display:contents}
body{font-family:var(--font-body,"Avenir Next","Helvetica Neue",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.7;font-size:1.02rem;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--font-display,Georgia,"Times New Roman",serif);line-height:1.08;letter-spacing:-.01em;font-weight:500}
h1{font-size:clamp(2.7rem,7vw,4.8rem)}h2{font-size:clamp(1.6rem,3.4vw,2.3rem);margin-bottom:18px}h3{font-size:1.25rem}
.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:var(--paper);padding:10px 18px;z-index:99}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.annbar{background:var(--ink);color:#f6f2ea;text-align:center;padding:10px 16px;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase}
.annbar a{color:#f6f2ea;text-decoration:underline}
.notice{background:var(--wash);color:#6a5533;text-align:center;padding:10px 16px;font-size:.92rem;border-bottom:1px solid var(--line)}
header.site{background:var(--paper);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:18px;padding-bottom:18px;flex-wrap:wrap}
.nav.centered{flex-direction:column;gap:10px;justify-content:center;text-align:center}
.brand{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.45rem;letter-spacing:.02em;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.brandlogo{height:36px;width:auto;vertical-align:middle;margin-right:12px}
nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}
nav.primary a{display:inline-block;padding:8px 12px;text-decoration:none;color:var(--soft);font-weight:600;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;border-bottom:1px solid transparent}
nav.primary a:hover{color:var(--accent-ink)}
nav.primary a[aria-current="page"]{color:var(--ink);border-bottom:1px solid var(--accent)}
.hero{padding-top:calc(96px * var(--spacing-scale,1));padding-bottom:calc(64px * var(--spacing-scale,1));text-align:center}
.hero .kicker{display:inline-block;color:var(--accent-ink);font-weight:600;font-size:.74rem;letter-spacing:.28em;text-transform:uppercase}
.hero .kicker::after{content:"";display:block;width:36px;margin:14px auto 0;border-top:1px solid var(--accent)}
.hero h1{margin:18px auto 16px;max-width:17ch;text-wrap:balance}
.tagline{font-size:1.22rem;color:var(--soft);max-width:52ch;margin:0 auto;line-height:1.6}
.cta-row{display:flex;gap:14px;margin-top:34px;flex-wrap:wrap;justify-content:center}
.btn{display:inline-block;background:transparent;color:var(--ink);border:1px solid var(--ink);padding:15px 32px;text-decoration:none;font-weight:600;font-size:.74rem;letter-spacing:.2em;text-transform:uppercase;font-family:inherit;cursor:pointer;transition:background .15s,color .15s}
.btn:hover{background:var(--ink);color:var(--paper)}
.btn.ghost{border-color:var(--line);color:var(--soft)}
.btn.ghost:hover{background:transparent;border-color:var(--ink);color:var(--ink)}
.hero-img{margin:52px auto 0;max-width:960px;overflow:hidden;border:1px solid var(--line)}
.hero-img img{width:100%;height:auto;display:block}
.hero-split{display:grid;grid-template-columns:1.05fr 1fr;gap:44px;align-items:center;text-align:left}
.hero-split h1{margin-left:0;margin-right:0}
.hero-split .tagline{margin-left:0}
.hero-split .kicker::after{margin-left:0}
.hero-split .cta-row{justify-content:flex-start}
.hero-split .split-img{overflow:hidden;border:1px solid var(--line)}
.hero-split .split-img img{width:100%;height:100%;min-height:320px;object-fit:cover;display:block}
@media (max-width:760px){.hero-split{grid-template-columns:1fr;text-align:center}.hero-split .cta-row{justify-content:center}.hero-split .tagline{margin:0 auto}.hero-split .kicker::after{margin-left:auto}}
.strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--soft)}
.strip .wrap{display:flex;gap:28px;flex-wrap:wrap;justify-content:center;padding:14px 24px}
.strip a{color:var(--accent-ink);text-decoration:none}
.open-now{font-weight:700}.open-now.yes{color:#2e6b45}.open-now.no{color:#9b3a26}
.strip a:hover{text-decoration:underline}
.block{padding-top:calc(64px * var(--spacing-scale,1));padding-bottom:calc(64px * var(--spacing-scale,1))}
.block>.wrap>h1::after,.block>.wrap>h2::after,.block.wrap>h1::after,.block.wrap>h2::after{content:"";display:block;width:44px;border-top:1px solid var(--accent);margin-top:16px}
.block.alt{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 48px;margin-top:10px}
.svc{border-top:1px solid var(--line);padding:18px 0}
.svc-line{display:flex;align-items:baseline;gap:10px}
.svc .nm{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.18rem}
.svc .lead{flex:1;min-width:24px;border-bottom:1px dotted var(--accent);position:relative;top:-4px}
.svc .pr{color:var(--accent-ink);font-size:.95rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.svc .ds{color:var(--soft);font-size:.95rem;margin-top:5px;max-width:60ch}
.svc img{width:100%;height:auto;margin-top:14px}
.cat-h{margin-top:44px;padding-bottom:8px;border-bottom:1px solid var(--ink);font-size:.76rem;letter-spacing:.24em;text-transform:uppercase;color:var(--accent-ink);font-weight:600}
h2.cat-h{margin-bottom:0}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}
.card{background:var(--card);border:1px solid var(--line);padding:28px}
blockquote.t p{font-family:var(--font-display,Georgia,serif);font-size:1.24rem;font-style:italic;line-height:1.5}
blockquote.t footer{margin-top:14px;color:var(--soft);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
dl.faq dt{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.18rem;margin-top:24px;padding-top:24px;border-top:1px solid var(--line)}
dl.faq dt:first-of-type{border-top:none;padding-top:0;margin-top:0}
dl.faq dd{color:var(--soft);margin-top:8px}
table.hours{border-collapse:collapse;width:100%;max-width:440px}
table.hours caption{text-align:left;font-family:var(--font-display,Georgia,serif);font-weight:500;margin-bottom:12px;font-size:1.15rem}
table.hours th{text-align:left;font-weight:400;padding:8px 14px 8px 0;color:var(--soft)}
table.hours td{padding:8px 0;font-variant-numeric:tabular-nums}
table.hours tr{border-bottom:1px solid var(--line)}
.holiday{margin-top:16px;font-size:.94rem}.holiday ul{margin:6px 0 0 18px}
address{font-style:normal}
form.card{margin-top:28px}
form.card label{font-weight:600;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
form.card input,form.card textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius,0);font:inherit;margin-top:6px;background:var(--paper)}
form.card input:focus,form.card textarea:focus{outline:2px solid var(--accent-ink);outline-offset:1px}
form.card p{margin-bottom:16px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.post-list article{padding:26px 0;border-top:1px solid var(--line)}
.post-list article:first-of-type{border-top:none}
.post-list h2 a{color:var(--ink);text-decoration:none}
.post-list h2 a:hover{color:var(--accent-ink)}
.post-meta{color:var(--soft);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;margin:6px 0 10px}
article.post{max-width:680px;margin:0 auto}
article.post p{margin-bottom:18px}
.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.4em 0 .5em}
.prose h2::after{display:none}
.prose p{margin:0 0 1em}
.prose ul,.prose ol{margin:0 0 1em;padding-left:1.4em}
.prose li{margin:.2em 0}
.prose blockquote{border-left:1px solid var(--accent);padding-left:18px;margin:0 0 1em;color:var(--soft);font-style:italic}
.prose a{color:var(--accent-ink);text-decoration:underline}
footer.site{background:var(--paper);color:var(--ink);border-top:1px solid var(--line);padding:56px 0 40px;margin-top:80px;text-align:center}
footer.site a{color:var(--accent-ink)}
footer.site h2{font-family:var(--font-display,Georgia,serif);font-size:1.35rem;font-weight:500}
footer.site h2::after{content:"";display:block;width:36px;border-top:1px solid var(--accent);margin:12px auto 14px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:34px;justify-items:center}
.cols table.hours{margin:0 auto}
.cols table.hours caption{text-align:center}
.credit{margin-top:36px;padding-top:22px;border-top:1px solid var(--line);font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--soft);display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
:focus-visible{outline:2px solid var(--accent-ink);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.btn{transition:none}}
@media print{body{background:#fff;color:#000}.annbar,.skip{display:none}header.site{position:static}}
@media (max-width:640px){.hero{padding-top:64px;padding-bottom:44px}.block{padding-top:48px;padding-bottom:48px}.svc-grid{gap:0}}
${BLOCK_CSS}
${SEARCH_CSS}
/* Item 67: the shared section and search styles colour some text with --accent, which here is
   the light bronze (3.8:1 on ivory). They take --accent-dark instead (#7a5f3a, 5.7:1), which a
   chosen palette or a section's own colour still sets. Other templates' accents already pass. */
.search-hit .sh-kind,.post-tags li,.block-spotlight .sp-eyebrow,.block-linklist ul.linklist a,.block-progress .pgb-pct{color:var(--accent-dark)}
.tagchip.on,ol.process li::before,.bk-done-ic{background:var(--accent-dark);border-color:var(--accent-dark)}`;

const CRITICAL = `:root{--ink:#1c1b18;--soft:#5b564c;--paper:var(--bg,#fbfaf7);--accent:#9a7b4f;--accent-ink:#7a5f3a;--accent-dark:#7a5f3a;--line:#e5e0d5}html{font-size:calc(100% * var(--font-scale,1))}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-body,"Avenir Next","Helvetica Neue",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif);background:var(--paper);color:var(--ink);line-height:1.7;font-size:16.5px}h1{font-size:clamp(2.7rem,7vw,4.8rem);line-height:1.08;font-family:var(--font-display,Georgia,serif);font-weight:500}.skip{position:absolute;left:-9999px}.skip:focus{left:0;background:var(--ink);color:var(--paper);padding:10px 18px;z-index:99}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}header.site{border-bottom:1px solid var(--line)}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:18px;padding-bottom:18px;flex-wrap:wrap}.brand{font-family:var(--font-display,Georgia,serif);font-weight:500;font-size:1.45rem;color:var(--ink);text-decoration:none}nav.primary ul{display:flex;gap:4px;list-style:none;flex-wrap:wrap}nav.primary a{display:inline-block;padding:8px 12px;text-decoration:none;color:#5b564c;font-weight:600;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase}.hero{padding-top:96px;padding-bottom:64px;text-align:center}`;

export const render = makeRender({
  css: CSS, critical: CRITICAL,
  favicon: (letter) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#1c1b18" data-accent="fill"/><text x="32" y="44" font-family="Georgia,serif" font-size="34" font-weight="500" fill="#fbfaf7" text-anchor="middle">${letter}</text></svg>`,
  postFrame: 'margin:20px 0;border:1px solid var(--line);overflow:hidden',
  offerings: 'lines',
});
