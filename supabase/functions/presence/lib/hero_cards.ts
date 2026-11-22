// ── A card on the welcome photo (the openings per kind of business, Nov 22 2026) ──────────────
// Two of the openings Eric picked in Figma put a card beside the words over the welcome photo
// (section B: C2 for home services, R1 for a restaurant). The style setting hero_card picks one
// (lib/devmode.ts), and it is drawn only with the "Words over the photo" layouts and a photo:
//   estimate  "Get an estimate": a short form (name, phone or email, what needs doing) that posts
//             to the site's own form address as a quote request, the same address, spam checks and
//             inbox as the Contact page's form (lib/site_send.ts sends it from the page). With no
//             address (the builder's canvas, the pictures) the form is drawn without one, like a
//             Form section's.
//   today     "Today": today's opening hours, worked out in the visitor's browser in the business's
//             own time zone from the same hours data the Open now line reads (holiday hours first),
//             a link to all the hours, the booking button, and the ordering link when there is one.
//             Nothing is made up: a day with no hours says it is closed, and with scripts off no day
//             is shown. A site with no hours, booking or ordering link gets no card.
// lib/template_kit.ts draws the markup. The rules and the one small script here ship only on a
// site that shows a card, so every other site's stylesheet keeps its bytes. This file imports
// nothing.

/** The card's rules: beside the words on a wide screen, under them on a narrow one, the words set
 *  to the left of it (a design that centres its welcome too). The card is the site's own card
 *  colour with its own words, whatever the photo's veil; every tap is 44px. */
export const HERO_CARD_CSS = `
.hero-photo .hc-with{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,380px);gap:clamp(28px,4vw,64px);align-items:end}
.hero-photo .hc-words{min-width:0;text-align:left}
.hero-photo .hc-words .cta-row{justify-content:flex-start}
.hero-photo .hc-words .kicker::after{margin-left:0}
.hero-card{background:var(--card,#fff);color:var(--ink,#1c1c1c);border-radius:var(--radius,12px);padding:clamp(20px,2.4vw,28px);box-shadow:0 18px 48px rgba(0,0,0,.28);text-align:left}
.hero-card .hc-h{margin:0 0 6px;font-size:1.45rem;line-height:1.2}
.hero-card .hc-sub{margin:0 0 14px;color:var(--soft)}
.hero-card form p{margin:0 0 12px}
.hero-card label{display:block;margin:0 0 4px;font-size:.88rem;font-weight:600}
.hero-card input:not([type=hidden]),.hero-card textarea{display:block;box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--line,#c9c9c9);border-radius:var(--radius,8px);background:var(--paper,#fff);color:var(--ink,inherit);font:inherit}
.hero-card textarea{min-height:88px;resize:vertical}
.hero-card .btn{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;min-height:44px;text-align:center}
.hero-card .hc-when{margin:0 0 4px;font-weight:600}
.hero-card .hc-days{margin:0 0 4px}
.hero-card .hc-go{margin:12px 0 0}
.hero-card .hc-all,.hero-card .hc-note{margin:0}
.hero-card .hc-all a,.hero-card a.hc-link{display:inline-flex;align-items:center;gap:.35em;min-height:44px;color:var(--accent-dark,var(--accent));font-weight:600}
@media (max-width:860px){.hero-photo .hc-with{grid-template-columns:minmax(0,1fr)}.hero-card{max-width:520px}}`;

/** Today's line on the "today" card: the holiday's own line for today's date when there is one,
 *  else the weekday's, from the hours data the Open now line reads, in the business's time zone.
 *  Under 0.5 KB; it never writes words, it only shows one of the lines the page already has. */
export const TODAY_JS = `(function(){var box=document.getElementById('hc_today'),d=document.getElementById('hours-data');if(!box||!d)return;try{var cfg=JSON.parse(d.textContent);if(!cfg.tz)return;var now=new Date(new Date().toLocaleString('en-US',{timeZone:cfg.tz}));var ds=['sun','mon','tue','wed','thu','fri','sat'];var key=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');var row=box.querySelector('[data-date="'+key+'"]')||box.querySelector('[data-day="'+ds[now.getDay()]+'"]');if(row)row.hidden=false}catch(e){}})();`;
