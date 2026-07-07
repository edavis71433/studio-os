# Launch Track 2.5 — Product Positioning & Public Experience

*Strategy + audit. No backend, no platform change. The problem is entirely the public experience: a visitor learns nothing about the product.*

---

## Executive Summary

The public site is a **beautifully-crafted, founder-led web-design *service* site** — and it says nothing about the *product*. The homepage nav is "How we work / The experience / Industries / About / Free tools / Client login"; the primary call to action is **"Book a free call"**; the voice is a solo studio ("*I take on a small number of clients — on purpose*"). Searched the homepage for any sign of the product — "Presence," "Studio OS," "self-serve," "Business Moments," pricing, editions — and found **zero**. A stranger cannot discover that there is a product to buy.

Meanwhile the backend is an entire self-serve SaaS: signup, Stripe checkout, five editions (Presence Monitor → Presence → Presence Managed → Agency → Enterprise), the daily Business-Moments experience, connected platform, industry packs. **The product and the marketing site are two disconnected halves.**

The good news: the *voice* is already right, and the *editions already encode the positioning*. The homepage even promises the product's core value in agency language — "*You'll always know exactly where things stand*" **is** the Business Moments promise. The work is not new craft; it's **connecting the halves and leading with the product**.

**The single decision that unlocks everything:** name the product **Presence**, name the studio **Davis Digital Studio**, keep **Studio OS** internal (customers never see it), and present **one product line with three ways to engage** — *watch it, run it yourself, or have the studio run it* — which is exactly what the editions already are.

---

## Positioning Report

Three names exist; a visitor must never have to untangle them. Recommended resolution:

| Name | Is | Customer sees it? |
|---|---|---|
| **Presence** | the product (software) | **Yes — the hero brand** |
| **Davis Digital Studio** | the studio that builds it and can run it for you | Yes — the maker + the "done-for-you" option |
| **Studio OS** | the internal platform/engine | **No — never public** |

**The positioning, in one line:** *"Presence keeps your business's online presence correct, found, and growing — watch it free, run it yourself, or have the studio run it for you."*

**Are they buying software or services?** *Both, and it's a spectrum, not a fork* — and the editions already are that spectrum:
- **Presence Monitor** — watch your existing site (the free/cheap, no-migration front door).
- **Presence** — run your whole presence yourself.
- **Presence Managed** — the studio runs it for you (software + service — the bridge, and the premium upsell).
- **Agency / Enterprise** — do it at scale / for many locations.

This is a *strength no competitor has*: SaaS with a real studio behind it, and you choose how hands-on you want to be. Sell that.

## Product Story (the homepage narrative)

Lead the visitor through, top to bottom:

1. **Problem** — "Your website drifts. Hours go stale, your Google listing is wrong, you can't tell if you're being found — and you're not a webmaster." *(name the pain)*
2. **Confidence** — "Presence watches all of it for you and tells you, in plain words, the one or two things worth a look today. Nothing more." *(the calm promise)*
3. **Solution / hero: Business Moments** — show the **Today** screen: at most a few calm cards, no dashboards, no scores. *This is the hero — see Homepage below.*
4. **Connected Platform** — "Connect your Google listing, reviews, analytics — read-only, always with your approval. Presence gets smarter, never noisier." *(one calm sentence, a screenshot)*
5. **Growth** — "A quiet growth partner suggests the right thing at the right season — you approve, we prepare." *(the Coach, in plain words)*
6. **Publishing / ownership** — "Nothing changes on your live site until you publish it. Every version is kept. Your content and your domain are always yours — leave any time, take everything." *(Law 2 + approval, the trust moat)*
7. **Trust** — ownership, approval, privacy, accessibility, "a real studio behind the software." *(see Trust Report)*
8. **Choose how hands-on** — the three ways (watch / run it / we run it) as the pricing bridge.
9. **Call to action** — **"See what your site needs — free"** (the Monitor front door) as the primary CTA; "Talk to the studio" as the secondary (for Managed/Agency/Enterprise).

## Homepage Audit

**Verdict:** re-sequence and lead with the product; keep the craft and voice.

- **Hero (change):** today it's a personal agency promise + "Book." Make the hero the **product** — the one-line positioning + the **Business Moments "Today" screen** as the visual + a primary CTA "See what your site needs — free." *Yes, Business Moments should be the hero* (the milestone's question — answer: **yes**).
- **Keep:** the calm voice, the reveal craft, "you'll always know exactly where things stand" (re-cast as the *product* promise, not the service one), the founder/studio section (now framed as *"a real studio behind the software"* — a trust asset, moved down).
- **Merge/remove:** the two "Free tools" links (`audit.html` + `tools.html`) collapse into one **"See what your site needs"** — which *is* the Monitor demo. Consolidate the many industry landing pages (`restaurant-web-design`, `salon-web-design`, `retail-web-design`, `home-services-web-design`, `health-wellness-web-design`) into the product's Industries story (the Industry Platform now generates that value — let one page point at editions rather than five SEO pages). Retire or fold `roi-calculator`, `pricing-estimator`, `report-card`, `ai-critique`, `buy-audit` into the single Monitor demo + one clear pricing page.
- **What appears first:** positioning line → Today screen → "see what your site needs" CTA. Everything else scrolls.

## Navigation Audit

**Today:** How we work · The experience · Industries · About · Free tools · Client login — six items, agency-framed, no product path.
**Recommended (four calm words):** **Product · Pricing · Studio · Sign in** — where *Product* tells the Presence story, *Pricing* shows the three ways + editions, *Studio* is the Davis Digital Studio done-for-you/agency story (absorbing "How we work / About / Industries"), and *Sign in* is the portal. Add one persistent primary button: **"See what your site needs."** Fewer choices, one obvious next step.

## Trust Report

The trust *material* is world-class and mostly unsurfaced publicly. Place it deliberately:
- **On the hero / near the CTA:** "Nothing changes on your live site until you publish it" + "Your content and domain are always yours — leave any time, take everything." (ownership + approval — the strongest differentiators, and they belong *before* signup, not only inside the product).
- **On pricing:** "No metered fees, ever" (Law 20), the export/leave promise, "a real studio behind it."
- **A trust section:** privacy, accessibility statement (exists), security posture (encrypted, read-only connections), "we never post or change anything without your approval," and — when available — testimonials/portfolio (currently `work.html`).
- **AI honesty as a trust asset:** "AI helps draft; you always approve, and you can always do it by hand." State it plainly; it *builds* trust rather than spooking.

## Sales Funnel Review

**Current funnel is service-only:** land → "Book a free call" → done-for-you. **The self-serve funnel is invisible** even though it exists (signup → checkout → welcome → start → portal → the new Today).

Friction points, ranked:
1. **No product entry point** — nothing on the site leads to signup/pricing.
2. **Two conflicting CTAs unbuilt-together** — "Book a call" (service) is everywhere; "Start / See what your site needs" (product) is nowhere prominent.
3. **Pricing not connected to the story** — `pricing.html` exists but the homepage never routes there, and it must present the *three ways* clearly, with the ownership/no-metered-fees trust copy adjacent.
4. **First success is far** — the Monitor "check your site" result should be reachable *before* signup (the aha), then convert to an account.
5. **The Managed bridge is unsold** — the premium "we run it for you" option (the studio's best margin) isn't presented as the natural upgrade from self-serve.

**Recommended funnel:** land on product → **"See what your site needs" (Monitor demo, no signup)** → see calm findings on *your own* site → "Keep it fixed automatically — start free / choose your plan" → signup → guided first-run → first publish celebration (the Track 2 work). Book-a-call remains the parallel path into Managed/Agency/Enterprise.

## Marketing Review

- **Consolidate the SEO landing-page sprawl** into one Industries page backed by the Industry Platform; quality of one story beats a dozen thin pages.
- **Lead every channel with the product promise** ("know exactly what needs you today — at most a few calm things"), the calm/ownership differentiators, and the Monitor free front door.
- **The founder story is an asset, repositioned:** "built by a studio that also runs it for clients" is credibility, not the headline.

## Demo Strategy

**The best public demo already exists in the backend: the Monitor "check your site" flow.** Recommend an **interactive, no-signup "See what your site needs"** on the homepage — the visitor pastes their URL and sees the intelligence (evidence → a few calm, plain-language findings) on *their own* website. Nothing beats seeing the product understand *your* business in 20 seconds.
- **Show:** the Monitor findings (live, on their site) + a static **screenshot of the Today screen** (the calm daily experience) + one connected-platform line.
- **Keep hidden:** dashboards, scores, the engine, marketplace/enterprise/agency, anything technical.
- **Format:** interactive Monitor demo (primary) + a short scripted "a day with Presence" screenshot/GIF sequence (secondary). A sandbox/full video can wait.

---

## Public Launch Checklist

### 🔴 Must Fix Before Beta
1. **Decide and apply the positioning** — Presence (product) / Davis Digital Studio (studio) / Studio OS (internal, hidden). One line, everywhere.
2. **A product homepage** (or a prominent product section on the current homepage): positioning line → Business Moments "Today" as the hero → **"See what your site needs — free"** primary CTA.
3. **A self-serve entry point in the nav** and a persistent primary button that routes to the Monitor demo / signup.
4. **Pricing page tells the three ways** (watch / run it / we run it) with the ownership + "no metered fees" trust copy adjacent, routing to signup.
5. **Ownership + approval trust line above the fold** near the CTA.

### 🟡 Must Fix Before Public Launch
6. **Interactive "check your site" (Monitor) demo** on the homepage — the aha before signup.
7. **Consolidate the SEO landing pages** into one Industries story; retire the redundant tools/calculators into the single Monitor demo + one pricing page.
8. **Simplify nav to ~four items** (Product · Pricing · Studio · Sign in) + the primary CTA.
9. **A trust section** (ownership, approval, privacy, accessibility, security, "a real studio behind it," testimonials/portfolio).
10. **Wire the full self-serve funnel** end-to-end (demo → signup → guided first-run → first-publish celebration) and QA it live.

### 🟢 Future Improvements
11. Scripted "a day with Presence" video; a guided/sandbox demo.
12. Blog/FAQ/help content for SEO + support.
13. Case studies from the first Managed clients.
14. A shared design-token system so the marketing site, portal, and Today screen feel like one product.

---

## Final Questions (answered honestly)

*If someone has never heard of Davis Digital Studio…*
- **Would they understand Studio OS?** **No, today** — they'd think it's a solo web-design service and never learn a product exists. *After the recommendations:* yes — "Presence keeps your presence correct, found, and growing" lands in one line.
- **Would they know what they're buying?** No today (there's no product path). After: yes — software they run, a studio that can run it, or both.
- **Would they know why it's different?** No today. After: yes — calm daily Moments instead of dashboards, real ownership + approval, and a real studio behind the software.
- **Would they trust it?** The voice earns trust *inside* the funnel, but the ownership/approval proof isn't shown publicly yet. Surface it near the CTA and the answer is a strong yes.
- **Would they immediately want a demo?** Not with "Book a call." With **"See what your site needs — free"** on their own site — yes, strongly.
- **Would they know exactly what to do next?** No today (the only CTA is "Book"). After: yes — one primary button, one obvious next step.

**Bottom line:** the platform and the in-product experience are excellent; the public site is selling the wrong thing. Resolve the naming, lead with the product and the Business-Moments hero, add the Monitor "see what your site needs" demo, and route one obvious CTA into the existing self-serve funnel. The craft and voice are already there — the site just needs to point them at the product.

---

*Consolidate the 🔴/🟡 items into `LAUNCH-BOARD.md`. This is strategy + audit only — no code was written; the homepage/nav/demo build is the next execution step, owner-directed (it touches pricing and public positioning).*
