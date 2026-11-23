// ── What every published page shares beyond its template's look (builder items 288, 293, 294, 306, Nov 2026 review) ──
// The eight templates draw one shell (lib/template_kit.ts); these are the rules and the few
// lines of script that shell carries on every site, whatever the template:
//   · item 288: the phone menu. Under 721px the header is a slim bar, the business name and a
//     Menu button, and the menu's links and the search box sit in a sheet that opens under it.
//     A dropdown opens on a tap. The button says whether the sheet is open (aria-expanded),
//     Escape closes it and puts the keyboard back on the button, and with scripts off the whole
//     menu simply shows, as it did before. On a wider screen nothing here changes the layout:
//     the sheet is display:contents, so the links keep their place in the header row.
//   · item 294: a jump to a spot on the page (a menu link to a section, the skip link, a button
//     to a form, closing a photo opened large) lands under the stuck header. The script measures
//     the header and the page scrolls to leave room for it (scroll-padding-top); a header that
//     scrolls away leaves none.
//   · item 293: the welcome photo takes a shape, 16:9 on wide screens and 4:3 on a phone, cropped
//     around the focal point the owner set (template_kit draws the point).
//   · item 306: on a phone, the small links a thumb must hit (phone numbers, email, the footer's
//     Privacy and Accessibility, the sign-up box's tick, "All updates") are 44px tall.
//   · item 430: a business name long enough to wrap keeps the phone bar at about 60px: the name
//     is a little smaller there and holds to two lines (its own box, .brand-name, in template_kit)
// This file imports nothing, so a browser spec can draw a page with it and reach only this file.

export const MENU_BREAK = 720;   // px: at this width and under, the menu folds

/** The Menu button in the header's bar. Its icon is drawn here (no outside file); the words
 *  stay beside it, since an unlabelled ☰ is the thing people miss. */
export function menuButtonHtml(): string {
  return `<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-menu">`
    + `<svg class="mb-open" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`
    + `<svg class="mb-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`
    + `<span>Menu</span></button>`;
}

/** The first-paint rules for the phone menu, in every page's head beside the template's own, so a
 *  phone never paints the whole menu before the stylesheet arrives. */
export const SHELL_CRITICAL = `.menu-btn{display:none}.site-menu{display:contents}@media (max-width:${MENU_BREAK}px){.site-menu{display:none}.menu-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;min-width:44px;padding:0 14px;border:1px solid var(--line,#ddd);border-radius:999px;background:transparent;color:inherit;font:inherit;font-weight:600}}`;

/** With scripts off, the menu shows whole, as it always did, and the button goes. */
export const SHELL_NOSCRIPT = `<noscript><style>@media (max-width:${MENU_BREAK}px){.site-menu{display:block;position:static;box-shadow:none;max-height:none;padding:0 0 10px}.menu-btn{display:none}.site-menu nav.primary ul.subnav{display:block}}</style></noscript>`;

// (the rules below are explained at the top of this file; no comments ride to the site)
export const SHELL_CSS = `
html{scroll-padding-top:calc(var(--hdr-h,72px) + 12px)}
.hero-img img{aspect-ratio:16/9;object-fit:cover}
@media (max-width:640px){.hero-img img{aspect-ratio:4/3}}
.hero-photo{position:relative;isolation:isolate;overflow:hidden;min-height:min(72vh,640px);display:flex;align-items:center}
.hero-photo .hero-bg{position:absolute;inset:0;z-index:-2}
.hero-photo .hero-bg picture,.hero-photo .hero-bg img{width:100%;height:100%;object-fit:cover;display:block}
.hero-photo::before{content:"";position:absolute;inset:0;z-index:-1;background:rgba(12,10,16,.55)}
.hero-photo.veil-light::before{background:rgba(255,255,255,.72)}
.hero-photo .hero-copy{width:100%}
.hero-photo.veil-dark,.hero-photo.veil-dark h1,.hero-photo.veil-dark .tagline{color:#fff}
.hero-photo.veil-dark .kicker{color:#fff;background:rgba(255,255,255,.16)}
.hero-photo.veil-dark .btn.ghost{color:#fff;border-color:rgba(255,255,255,.75);background:transparent}
.hero-photo.veil-dark .hp-title,.hero-photo.veil-dark .hp-contact a{color:#fff}
@media (max-width:640px){.hero-photo{min-height:min(60vh,520px)}}
.brandlogo{width:auto}
.brand[style] .brandlogo{height:var(--logo-h)}
.brand-logo-only .brandlogo{margin-right:0}
.sitesearch:focus-within{outline:2px solid var(--accent,#333);outline-offset:2px}
.sitesearch input{font-size:max(16px,.92rem)}
.menu-btn{display:none}
.site-menu{display:contents}
@media (max-width:${MENU_BREAK}px){
html{--hdr-h:64px}
header.site .nav{position:relative;flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:12px;padding-top:8px;padding-bottom:8px}
header.site .brand{font-size:1.05rem;line-height:1.2;min-height:44px;display:inline-flex;align-items:center;min-width:0}
header.site .brand-name{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
header.site .brand[style] .brandlogo{height:min(var(--logo-h),44px)}
.menu-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;min-width:44px;padding:0 14px;border:1px solid var(--line,#ddd);border-radius:999px;background:transparent;color:inherit;font:inherit;font-weight:600;font-size:.95rem;cursor:pointer;flex:none}
.menu-btn svg{display:block}
.menu-btn .mb-close{display:none}
.menu-btn[aria-expanded="true"] .mb-open{display:none}
.menu-btn[aria-expanded="true"] .mb-close{display:block}
.site-menu{display:none;position:absolute;left:0;right:0;top:100%;background:var(--card,var(--paper,#fff));border-bottom:1px solid var(--line,#ddd);box-shadow:0 18px 40px rgba(0,0,0,.14);padding:8px 16px 18px;max-height:calc(100vh - 72px);overflow:auto;z-index:30;text-align:left}
.site-menu.open{display:block}
.site-menu nav.primary ul{display:flex;flex-direction:column;gap:0;padding:0;justify-content:flex-start}
.site-menu nav.primary li{margin:0}
.site-menu nav.primary a{display:flex;align-items:center;justify-content:space-between;min-height:48px;padding:10px 8px;font-size:1.02rem;border-radius:10px;border-bottom:0}
.site-menu nav.primary ul.subnav{display:none;position:static;box-shadow:none;border:0;padding:0 0 6px 18px;min-width:0;background:transparent}
.site-menu nav.primary li.has-sub.open>ul.subnav,.site-menu nav.primary li.has-sub:focus-within>ul.subnav{display:block}
.site-menu nav.primary li.has-sub.open>a .sub-caret{transform:rotate(180deg)}
.site-menu .sitesearch{max-width:none;margin:10px 0 0;min-height:44px}
}
@media (max-width:${MENU_BREAK}px){
a[href^="tel:"],a[href^="mailto:"],.strip a,.credit a,.post-more a,footer.site .cols a,.map-dir a,.annbar a{display:inline-flex;align-items:center;min-height:44px}
.nl-form .nl-consent label{min-height:44px;align-items:center}
.nl-form .nl-consent input{width:22px;height:22px;margin:0 2px 0 0}
}
@media print{.menu-btn{display:none}.site-menu{display:block;position:static}}`;

// The header's height, for the page's jumps; the sheet; a dropdown that opens on a tap.
// Tiny and first-party: the site's own content rule names it by its fingerprint (lib/site_csp.ts).
export const MENU_JS = '(function(){var r=document.documentElement,h=document.querySelector("header.site"),b=h&&h.querySelector(".menu-btn"),m=h&&h.querySelector(".site-menu");'
  + 'function size(){var p=h?getComputedStyle(h).position:"";r.style.setProperty("--hdr-h",(h&&(p==="sticky"||p==="fixed")?h.offsetHeight:0)+"px")}size();window.addEventListener("resize",size);'
  + 'if(!b||!m)return;var mq=window.matchMedia("(max-width:' + MENU_BREAK + 'px)");'
  + 'function set(on){m.classList.toggle("open",on);b.setAttribute("aria-expanded",on?"true":"false");if(on)h.classList.remove("dds-hdr-off")}'
  + 'b.addEventListener("click",function(){set(!m.classList.contains("open"))});'
  + 'document.addEventListener("keydown",function(e){if(e.key==="Escape"&&m.classList.contains("open")){set(false);b.focus()}});'
  + 'document.addEventListener("click",function(e){if(m.classList.contains("open")&&!h.contains(e.target))set(false)});'
  + 'if(mq.addEventListener)mq.addEventListener("change",function(){if(!mq.matches)set(false)});'
  + 'm.addEventListener("click",function(e){if(!mq.matches)return;var a=e.target.closest&&e.target.closest("li.has-sub>a");if(!a||!m.contains(a))return;var li=a.parentNode,open=li.classList.contains("open");if(a.getAttribute("role")==="button"||!open){e.preventDefault();li.classList.toggle("open",!open);a.setAttribute("aria-expanded",open?"false":"true")}});'
  + 'm.addEventListener("keydown",function(e){var t=e.target;if((e.key==="Enter"||e.key===" ")&&t&&t.matches&&t.matches("li.has-sub>a[role=button]")){e.preventDefault();t.click()}})})();';
