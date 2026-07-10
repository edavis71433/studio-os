# Phase 3A — Davis Digital Studio Website Audit

**2026-07-10.** A positioning / messaging / trust / conversion audit of the public DDS agency website, from the perspective of *"if I were a prospective client, would this convince me to hire Davis Digital Studio?"* Method: three parallel expert reviews (brand/narrative, service/SEO, conversion/CRO), each reading the real pages, plus reuse of this session's technical audit (`HTML-DEEP-AUDIT.md`) for SEO/a11y/mobile so nothing is duplicated. **Audit + strategy only — no changes were made.**

> **The one-line verdict:** the *writing* is already premium — a calm, honest, first-person voice that is the brand's real moat. The gap between "reads beautifully" and "reads like an incredibly premium agency" is almost entirely three things: **(1) proof** (there is none — no testimonials, results, or case studies anywhere), **(2) showing (not just asserting) the client experience**, and **(3) consistency** (names, CTAs, lead capture, and trust placement drift page to page). Fixing those three converts the existing good words into a closing machine.

Pages in scope (public): index · services · web-design · seo-strategy · monthly-retainer · industries + 5 industry pages · work · about · how-we-work · the-experience · contact · tools · audit · ai-critique · report-card · pricing-estimator · roi-calculator · local-visibility · buy-audit · start.

---

## 1. Page-by-page findings

### Homepage — `index.html`
- **Strong:** the hero *"A website built to work. / A partner built to stay."* is the best line on the site — parallel, concrete, ownable. **Keep it.** The "client experience" section already shows a real portal screenshot. Voice is excellent.
- **Weak:** the credibility line right under the hero (*"Based in Los Angeles · working with small businesses nationwide"*) wastes a prime position restating the footer. The free-tools band puts **four competing actions** in the first screen-and-a-half. No proof of any kind above or below the fold. The charming "typical exchange" reply card is `aria-hidden` — its reassurance is invisible to screen readers. Promise-chip *"Client Portal ↗"* is the most "product-name" moment on the site (secrecy soft spot).

### `the-experience.html` — the portal-as-benefit page (the model page)
- **Strong:** the best execution of "show the client experience as feelings" — six beats each tagged with *"You feel:"* (in control, organized, looped in…), all secrecy-compliant, with a real portal screenshot. This page *is* the differentiator.
- **Weak:** it *describes* an exceptional experience with **no one vouching it's real** — the single highest-leverage spot on the site for a testimonial. No service standard ("you hear back within one business day"). Only one CTA cluster at the very bottom of a long scroll. Missing a 7th beat for the *post-launch / effortless-changes* benefit.

### `how-we-work.html` — process
- **Strong:** the 5-step timeline with *"You feel:"* lines is a premium touch; SEO-foundation step signals competence.
- **Weak:** steps 03 ("in the loop") and 04 ("never left guessing") overlap — the middle loses momentum. No typical **timeline/duration**, no **guarantee** stated outright, no "what I need from you." Talks about the portal but shows **no screenshot** of it. Contains the *"I built a proper client portal"* phrasing (secrecy soft spot — "built" implies engineering software).

### `about.html` — founder story
- **Strong:** the emotional core, very well written — specific, credible, differentiating (first-gen, former foster youth, M.S. Business Analytics CSUN, values with real consequences). The signature line is the best sentence on the site.
- **Weak:** proves **character** and reliability thoroughly but under-proves **web/SEO craft** — the experience cited is call-centers/reception/claims, not the discipline being bought. Needs one calm sentence establishing craft credibility. No proof/testimonial about the reliability the page is entirely about.

### `work.html` — "proof of judgment, not volume"
- **Strong:** the "four decisions I make on every project" are the most *capability-revealing* content on the site; the no-portfolio disclosure is a graceful way to own the current gap. Commented-in case-study template shows the right instinct.
- **Weak:** it is a **portfolio page with no portfolio** — the sharpest instance of the sitewide proof gap. Not in the primary nav (footer-only). Thin SEO. This is the #1 "fill it for real the moment a client says yes" target.

### `services.html` — the hub (title says "Solutions", nav says "Services")
- **Strong:** the strongest-written page — the three-station "get found → earn trust → convert" system is a real differentiator; pricing framing (*"start around $1,500 … a real number on the call"*) is perfect premium-service framing.
- **Weak:** title/eyebrow "Solutions" vs nav/URL/breadcrumb "Services" — self-inflicted relevance dilution. Zero proof. **Secrecy risk:** the aside *"I occasionally build software … the same capability behind the systems running this studio"* gestures at the internal platform — reframe to pure custom-build-for-client. No BreadcrumbList schema.

### `web-design.html`
- **Strong:** outcome-led H1; best-optimized page (Service + BreadcrumbList schema, full OG); deliverables copy is excellent ("SEO built in from day one, not sold as an add-on").
- **Weak:** literally says *"Featured client work is coming soon"* — on the one page where the work *is* the product, there is **zero work shown**. No FAQ, no mini-timeline for the "45 days" stat.

### `seo-strategy.html`
- **Strong:** excellent anti-jargon H1 (*"The best customer is the one already searching"*); credible, specific deliverables; honestly-hedged stats.
- **Weak:** **no pricing anywhere** (the only service page without a number, despite the site's stated pricing transparency). No FAQ (a huge miss on an SEO page). No ranking-movement proof.

### `monthly-retainer.html` — "Growth Partnership" (the most sophisticated page)
- **Strong:** the "peak on launch day → quiet drift" narrative is genuinely premium; *"This isn't maintenance. It's momentum."* is a keeper; the no-fake-data "Still Moving" card is exactly right; **the best real portal screenshot on the site.**
- **Weak:** still no testimonial (a "two years in" quote would be devastatingly effective here). No "cancel anytime / no lock-in" reassurance near the recurring price. Keyword-thin title.

### `industries.html` + 5 industry pages — the weakest cluster
- **Strong:** the hub's card one-liners are the best industry copy anywhere (restaurant: *"Get found by hungry locals, fill tables…"*).
- **Weak:** the 5 pages are **thin near-duplicates** (~147 lines, ~half verbatim-identical boilerplate — the same second paragraph and CTA on all five). Google will see five competing thin pages. No FAQ, no case study, no imagery, no pricing, templated non-outcome H1s (*"Web design for restaurants & bars"*), and **no in-body internal links to the service pages** (pure-upside SEO miss). No BreadcrumbList/FAQPage/ItemList schema.

### Conversion surfaces
- **`contact.html`** — the strongest conversion page; low-friction (2 required fields), dual async-form + Calendly, best-in-class thank-you with "what happens now." **But:** no trust density at the point of decision (the credential strip that lives on the *free-tool* pages is absent here), no proof near the form, portal-as-benefit never previewed in the "Not ready for a call?" sidebar. Near-invisible form hint (`rgba(255,255,255,0.35)` on a light card).
- **`tools.html`** — excellent "teach before selling" hub; risk is **dispersion** (six equal doorways, no recommended default for the confused owner). Title "Resources" ≠ everything else calling it "Free tools."
- **`audit.html`** — impressive engine + real Google data + the site's **strongest trust strip** (credentials); "credited toward a project" is a strong risk-reverser. **But** it front-loads the **most** friction of any tool (email + 3 fields *before* showing a score), then gates the rest behind a second email — while ai-critique shows everything for free. Duplicate "Free tools" footer label; nav label inconsistency.
- **`ai-critique.html`** — the best lead *magnet* (zero friction, honest, real value); only records a lead if the user clicks "email me." Stale audit-tier JSON-LD (old "Essential/Growth/Studio" names). Duplicate footer label.
- **`report-card.html`** — fair email-for-deliverable exchange, but **delayed gratification** (nothing on screen, wait for inbox) — and it points to the "instant results" mini-audit right above its own form.
- **`pricing-estimator.html`** — 🔴 **captures NO lead.** A visitor gives build + pages + extras + timeline, sees a price, and you capture nothing unless they independently click Calendly.
- **`roi-calculator.html`** — 🔴 **captures NO lead** at peak motivation (after showing "382% ROI, pays for itself in 2.5 months"). Flattering default scenario risks reading as a generic calculator (a premium brand should default conservative).
- **`local-visibility.html`** — 🔴 **worst leak:** it explicitly collects **business name + city** ("so I can personalize your results"), then sends **nothing anywhere** — a fully-qualified local-SEO prospect leaves no trace.
- **`buy-audit.html`** — clean, competent checkout; "why each item matters" does real selling. **But** no human/credential trust at the moment of payment, no refund/guarantee line, a brief JS-load flash of the wrong price/delivery, and a **NAP mismatch** (Burbank vs the footer's Los Angeles).
- **`start.html`** — right tool for its job (post-booking intake), well-handled budget field. **But** it's **visually off-brand** (DM Sans/DM Serif vs the site's Fraunces/Inter) at the very first post-booking touch, uses `alert()` for validation, and the budget option "Custom platform / web app" should drop "platform."

---

## 2. Trust gaps (the #1 finding — all three reviewers agree)
- **There is no third-party validation anywhere on the entire site** — no testimonial, client name, logo, review count, named result, "X sites launched," or case study. A skeptical high-value buyer has zero external proof.
- **Trust is inverted:** the richest credibility (M.S. Business Analytics, enterprise background, "9+ years," real Google data) lives on the *free-tool* pages; the pages where money and commitment happen (contact, buy-audit, estimator) have the *least*.
- **Competence is under-proven:** the site proves *character* (about) and *judgment* (work) beautifully, but rarely proves *web/SEO craft* — which is what's being bought.
- The honesty positioning ("selective by design," "work shown only with permission") is on-brand and should be **kept** — the fix is **not** to fabricate. It's to add the proof categories that don't need a big portfolio: specific credentials, a written promise/guarantee, anonymized outcomes, and 1–2 permissioned testimonials.

## 3. Conversion gaps
- 🔴 **Three lead-gen tools capture zero leads** (ROI, pricing-estimator, local-visibility) — the single biggest revenue leak. Local-visibility even discards identity it collected.
- **Inconsistent lead-capture philosophy** across the six tools (instant-no-email vs email-gate-up-front vs email-only-deliverable vs no-capture). The two lowest-friction wins are inverted (the impressive Site Score asks the most; the AI review asks nothing).
- **No proof at the decision points** (contact, checkout).
- **Portal-as-benefit is a selling point never used** on any conversion page.
- **Homepage** offers four competing first-screen actions; **tools hub** offers six equal doorways with no default path.
- **Free Site Score** requires an email just to run.

## 4. Missing pages
1. **A Results / Testimonials / Case-Study page** (the biggest structural gap). `work.html` exists but shows nothing; it should become this, or a new `results.html` should.
2. **An engagement FAQ** (only `audit.html` has one, and it's audit-specific). Objections at the point of decision — cost, timeline, "what if I'm not local," "do I own my site," "what if I'm not techy" — are unanswered.
3. **A "What happens after you book" page/section** (the contact thank-you card is the seed — expand it into a reassurance surface).

## 5. Missing sections (within existing pages)
- Homepage: a proof band; a "who this is for" / industries signal; a scope gesture toward services.
- the-experience: a testimonial; a service-standard line; a 7th "effortless changes" beat.
- how-we-work: typical timeline; a stated guarantee; "what I need from you"; a portal screenshot.
- about: one craft-credibility sentence; a reliability testimonial.
- service pages: FAQ blocks (web-design, seo-strategy); pricing on seo-strategy.
- industry pages: FAQ, mini case study, imagery, internal links (all five).
- contact + buy-audit: a testimonial + credential strip near the action.

## 6. Weak messaging (fix)
- Offer names drift: the retainer is **"Growth Partnership" / "Ongoing care" / "ongoing partnership" / "monthly-retainer"** (four names); the hub is **"Solutions" / "Services"** (two). Pick one each.
- Templated industry H1s (*"Web design for [industry]"*) — replace with the outcome one-liners.
- Homepage credibility whisper (location restatement) — replace with a real trust line.
- the-experience & how-we-work heroes are soft/expected (the audit provides concrete rewrite options for the Master Plan).

## 7. Strong messaging (keep / protect — this is the moat)
- The whole **voice**: calm, confident, first-person, anti-hype, honest, no fabricated proof. Do not sand this off in any rewrite.
- Keepers: index hero (*"A website built to work. A partner built to stay."*); *"This isn't maintenance. It's momentum."*; about's signature line; work's four decisions; services' three-station system; seo's *"The best customer is the one already searching."*; the *"You feel:"* device.

## 8. CTA improvements
- **Standardize the primary CTA** to one verb across the site: *"Book a free call →"* (contact) as the single conversion goal; free tools funnel *toward* it.
- **Fix the confirmed inconsistencies:** the duplicate "Free tools / Free tools" footer links (`audit.html:668-669`, `ai-critique.html:640-641`); the same `audit.html` link labeled "Free tools" on some pages and "Free site review" on others; the "See what your site needs" phrase resolving to different destinations — pick one label + one destination each.
- **Reduce competing CTAs** on the homepage first screen (one primary tool CTA, not two) and on the tools hub (one recommended "start here" path).
- Every tool result screen should end with a **single benefit-led next step** toward a call.

## 9. Navigation improvements
- Add **"Work" (or "Results") to the primary nav** — proof shouldn't be footer-only.
- Unify the retainer nav label to **"Growth Partnership."**
- Resolve the tools.html/audit.html "Free tools" overlap into two clear items: **"Free site review"** (the audit) + **"Free tools"** (the hub).
- **Fence check (secrecy):** the nav/footer route to `help.html`, which links `/pricing.html` (the hidden SaaS page). `help.html`, `pricing.html`, `signup.html`, `studio-os-demo.html` are publicly reachable — keep them `noindex` (done) *and* ensure no public marketing page links into that chain.

## 10. Screenshot recommendations (real product, framed as "your private client space")
Available real assets today: `portal-home.png`, `portal-progress.png`, `portal-preview.png` + mobile variants, founder photos. Currently used on only ~3 marketing pages.
- **Capture / surface, tastefully cropped, real (non-placeholder) data:** an **approvals** "ready for your review" moment; an **invoices/billing** "paid / what's due" view (the most reassuring-to-a-buyer and least-shown screen); a **files** list; a **progress/timeline** view; a **"monthly report, in plain English"** view.
- **Placement:** the-experience gets the richest set (2–3 small crops mapped to the beats); how-we-work step 04 gets a progress view; services + web-design reuse the portal-home shot; seo-strategy gets the report view; contact + buy-audit get a small "how it feels" preview.
- **Rule:** every screenshot must show clean, real, tasteful sample data — a premium shot with lorem-ipsum project names undercuts everything.

## 11. Image recommendations
- **Keep the human/photographic register** on about (portrait) and how-we-work (Eric working) — do not replace with product shots.
- **Add real work imagery** to web-design + work + industry pages (before/after, a live-site thumbnail) the moment permissioned work exists.
- **Add a face** (Eric) near the contact and checkout CTAs.
- Convert large PNG screenshots to WebP; ensure every image has width/height (CLS) and descriptive alt.
- Ensure `og-image.jpg` (present) is on-brand and current.

## 12. Portfolio recommendations
- `work.html` should evolve from "proof of judgment" to "**judgment + one real result**." The commented case-study template is ready; the only blocker is permission.
- Pursue **1–3 permissioned projects**; even one transforms the page. Until then, keep showing nothing rather than stock.
- Add **anonymized/composite outcomes** now (secrecy- and permission-safe): *"A local service business, unfindable on Google, now on page one for the searches that matter."*

## 13. Testimonial strategy
- **Get 2–4 permissioned testimonials**, prioritized by theme: **reliability** ("he actually stays after launch"), **the calm experience** ("it really did feel organized"), and **results** ("we get found now").
- **Placement:** one on the-experience (highest leverage), one on the homepage proof band, one near the contact form, one on monthly-retainer (a long-term client).
- Format: real name + business + (ideally) face. If a client can't be named, use first name + industry + city with permission.
- **Never fabricate** — a single real quote beats five invented ones, and honesty is the brand.

## 14. Case study strategy
- One-page, decision-led format (mirrors the four "decisions" on work.html): *the situation → what we fixed first → the choice we made → the result.*
- Start with **one** flagship case; template it (the HTML template already exists commented in `work.html`).
- Lead with a concrete outcome (found in local search, more enquiries, faster site) — permission-respecting, no vanity metrics.
- Cross-link case studies from the relevant service + industry pages.

## 15. SEO recommendations (reused + extended from `HTML-DEEP-AUDIT.md`)
- **Fix the shipping meta bug:** double-escaped entities (`&amp;amp;`, `&amp;amp;mdash;`) in OG/Twitter tags on the 5 industry pages + industries.html render as "&amp;amp;" in share cards. (Introduced in this session's SEO-meta pass — correct to single-escape.)
- **Reconcile stale JSON-LD:** `ai-critique.html` advertises old audit tiers ("Essential/Growth/Studio") vs the live "Starter/Digital Health Check/Competitive Intelligence."
- **Canonical-name alignment:** `/services` page titled "Solutions" dilutes relevance — title should say "Services."
- **Add schema:** BreadcrumbList (services, industries, 5 industry pages); FAQPage (once FAQs exist on web-design, seo-strategy, industry pages, engagement FAQ); ItemList (industries hub); **Organization/LocalBusiness** with `sameAs` + logo + areaServed (site-wide E-E-A-T — currently everything is `Person`).
- **Industry pages:** unique FAQ content + internal links to service pages = the biggest ranking lift (they're thin near-duplicates today).
- **NAP consistency:** one canonical address (Burbank vs Los Angeles) — directly affects the local credibility being sold.
- **Analytics/consent parity:** services, industries, and the 5 industry pages have no GA/cookie/SW — you're blind on your highest-intent SEO pages. Standardize.
- OG/favicon/theme-color were added site-wide this session (wave 9); keep parity in any new pages.

## 16. Accessibility recommendations (reused from `HTML-DEEP-AUDIT.md`)
- Already handled this session: the shared keyboard-operability + focus-trap enhancer, announced result/error regions on the tools, expanded accessibility statement.
- Remaining for Phase 3: expose the homepage "typical exchange" reply-card content to AT (currently `aria-hidden`); fix the near-invisible contact form hint (`rgba(255,255,255,0.35)` on light); replace `start.html`'s `alert()` validation with inline announced errors; verify the nav dropdown is keyboard-operable and `aria-expanded` updates; contrast-check the dark-panel `rgba(255,255,255,.4/.6)` fine print.

## 17. Mobile recommendations
- The site is broadly mobile-sound (viewport, responsive grids, mobile `<picture>` sources on portal shots). Verify: 44px+ touch targets on nav/CTAs; no horizontal overflow on the tool result cards; the homepage four-CTA first screen isn't cramped on small viewports; the industry pages' feature boxes stack cleanly.
- Standardize on the async font-load (`preload`+`onload`) pattern site-wide (8 pages still render-blocking) so mobile first paint is fast.

## 18. Overall implementation priority (highest ROI first)
1. 🔴 **Add lead capture to ROI, pricing-estimator, local-visibility** (biggest revenue leak — fully-qualified prospects vanish today). *High ROI, low effort.*
2. **Trust/proof program:** secure 2–4 permissioned testimonials + 1 case study + anonymized outcomes; place proof on homepage, the-experience, contact, checkout, work. *Highest premium-perception lever.*
3. **Canonicalize the two offer names** ("Growth Partnership", "Services") + fix nav/footer/CTA label inconsistencies + stale JSON-LD + the OG double-escape bug + NAP. *Cheap, credibility-protecting.*
4. **Move/replicate the credential trust strip** onto contact + buy-audit; add a face at the decision points.
5. **Surface the portal-as-benefit** on the conversion pages (contact sidebar, start thank-you, checkout) + add the *effortless-changes / AI-assisted-updates* benefit as a hire reason across index / the-experience / how-we-work / about — all secrecy-safe, benefit-framed.
6. **De-friction the free Site Score** (run on URL alone; gate only the full report).
7. **Rebuild the 5 industry pages** into rank-worthy pages (unique FAQ + schema, outcome H1s, imagery, internal links) — and extract the shared nav/footer/reveal script into one include to kill drift.
8. **Add the missing pages:** Results/Testimonials, engagement FAQ, "what happens after you book."
9. **Soften the secrecy soft spots** (services "same capability…", how-we-work "I built a proper client portal", index "Client Portal ↗" chip, start "Custom platform") and confirm no public page links into the `help.html → /pricing.html` chain.
10. **Polish:** async fonts site-wide, WebP screenshots, remaining a11y items, homepage/tools CTA de-cluttering, `start.html` re-skin to the studio brand.

*Deliverable #1 complete. The Master Plan (`WEBSITE-MASTER-PLAN.md`) and Messaging Guide (`MESSAGING-GUIDE.md`) turn this into an authoritative blueprint before any implementation.*
