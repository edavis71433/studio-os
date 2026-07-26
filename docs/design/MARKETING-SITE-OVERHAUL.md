<!-- Marketing half from recon workflow (36 published root pages, 5 auditors). Companion to STUDIO-STANDARDS-SWEEP.md (the app + portal half of the estate). -->

# MARKETING SITE OVERHAUL — slice plan (2026-07-26)

Directive (Eric, 2026-07-26, after using davisdigitalstudio.com): **"we need to redo
the architecture or structure… so many clicks to get places and seems complicated…
my pricing disappeared… the tools pages look like a whole different site."**
Method: five parallel read-only recon auditors over the published marketing surface
(root `*.html` on the Netlify dist allowlist), every page judged three ways —
**IA** (every inbound link, click depth from home, nav placement vs importance) ·
**BRAND** (index.html's design system, or "a whole different site") ·
**CONTENT TRUTH** (stale claims, orphaned links, duplicate narratives). NOTHING is
built yet — each slice ships only on Eric's approval through the usual pipeline.
Concurrent: a triage agent is rebuilding pricing.html as services pricing (Web
design from $1,500 · Growth Partnership $400/mo) + a nav link; this plan assumes
that lands — MS1 verifies before building on it.

**The standard, in one paragraph:** index.html IS the design system, and every
marketing page wears it. One header/footer from ONE source (never hand-copied),
Fraunces/Inter preloaded, styles.css tokens only — no page-local `:root` forks, no
hardcoded hexes, no purple pill buttons, no emoji icon sets (stroked SVG only).
Section anatomy ends dark CTA → footer — **one** closer, not a gauntlet of four.
Reveal animations always behind the `.js-anim` gate. One dark-mode policy sitewide,
not a per-page skin change at the conversion moment. Clean extensionless URLs with
explicit `_redirects` rules — nothing rides on implicit resolution. One price truth,
sourced from /pricing, quoted identically everywhere. One booking front door
(/contact); Calendly lives behind it, never deep-linked around it. Same label →
same destination, everywhere.

**The three complaints, diagnosed:**

| Eric said | Root cause (verified) |
|---|---|
| "so many clicks / seems complicated" | 8-slot nav spends slots 1–2 on ONE story told twice (how-we-work ≈70% = the-experience); the 6-tool lead-gen cluster hangs off a footer link; the price answer is 3 clicks deep and self-contradicting; tool pages end in 3–4 stacked CTAs |
| "my pricing disappeared" | pricing.html was repurposed into SaaS-product pricing and orphaned; the hand-copied nav means the new Pricing link exists on only 2 of ~30 pages; three contradictory price architectures survive at depth 2 ($850/mo retainer, dead package catalog, unlabeled $99–$899 audits) |
| "the tools pages look like a whole different site" | They are one — a second, undocumented "purple tool template" (page-local tokens, pill buttons, gradient bands, emoji icons, exit popups, custom cursor) sharing only header/footer with index; styleguide.html documents the *app* system and falsely claims it covers the public site |

---

## 1. The click-depth map

### Today

```
/ (index) ─ depth 0 ─ the design reference; zero pricing signal above the fold
│
├─ PRIMARY NAV — 8 top-level items + 2 actions, hand-copied per page, ≥4 stale generations live
│   ├─ How we work ············ 1  ┐ one story, two nav slots
│   ├─ The experience ········· 1  ┘ (~70% overlap; not even in the footer)
│   ├─ Services ▾ ············· 1  sub-label promises "Pricing and the full picture" — page defers
│   │   ├─ Web design ········· 1  one number ($1,500); 3 conflicting timelines sitewide
│   │   ├─ SEO strategy ······· 1  NO price anywhere on the site
│   │   └─ Growth Partnership · 1  $400/mo — contradicted at depth 2 ($850/mo)
│   ├─ Industries ············· 1
│   │   └─ 5 landers ·········· 1  NO _redirects rules — the only family riding implicit .html
│   ├─ Results (work) ········· 1  zero published work; Bacchus case-study assets orphaned in dist
│   ├─ About ·················· 1
│   ├─ Free site review ······· 1  audit.html: also the UNLABELED $99–$899 paid-audit price page;
│   │                              never links back to /contact in-body — one-way funnel exit
│   ├─ [Client login → portal.html]   [Book a free call → /contact] · 1 (only page with dark mode)
│
├─ FOOTER-ONLY
│   └─ Free tools hub ········· 1 (footer)  biggest lead-gen cluster, no nav presence
│       ├─ AI critique ········ 2  white-on-white hero text (live legibility bug)
│       ├─ Report card ········ 2  exit popup + custom cursor + 68px dead band
│       ├─ ROI calculator ····· 2  dead package catalog in the slider
│       ├─ Pricing estimator ·· 2  emails leads "$850/mo retainer required" (real: $400)
│       ├─ Local visibility ··· 2
│       └─ buy-audit ·········· 2  Stripe checkout with ZERO site chrome
│
└─ GHOSTS — orphaned yet still served by the *.html allowlist glob
    pricing (SaaS page → rebuild in flight) · start · contact-disclaimer ·
    email-signature · styleguide · a11y · signup · welcome · get-started · studio
```

**The pricing hunt** (the "my pricing disappeared" trace — four answers, none agreeing):
1. Home → Services ("Pricing and the full picture") → two "starts around" → "Full pricing" → web-design → **one number**. 3 clicks, dead end.
2. Home → Free site review → unlabeled **$99/$499/$899** audit tiers, published nowhere else.
3. Home → footer → Free tools → Pricing estimator → **Template $1,500 / Custom + Photography $3,800 / Custom HTML $6,500 + "Managed retainer required ($850/mo)"** — a catalog that no longer exists, emailed to leads.
4. Home → /pricing → **a SaaS product page for a different business** (rebuild in flight).

### Proposed

```
/ ─ 0 ─ hero: /contact dominant, /audit clearly secondary; in-body links to /services + /pricing
│
├─ NAV — 6 slots + 2 actions, ONE shared definition propagated everywhere
│   ├─ Services ▾ ············· 1   Web design · SEO · Growth Partnership — each quoting /pricing's numbers
│   ├─ Pricing ················ 1   THE money page: packages + $400/mo + audits-from-$99 + "estimate" path
│   ├─ How it works ··········· 1   how-we-work + the-experience merged; cost FAQ included
│   ├─ Industries ············· 1 → 5 landers · 2 (also 1 via home chips; _redirects rules added)
│   ├─ Free tools ············· 1   audit headline + 4 siblings · 2; buy-audit · 2 (slim shared chrome)
│   ├─ About ·················· 1
│   ├─ [Client login → /portal]   [Book a free call → /contact] · 1
│
├─ Results ···················· 1 or footer — P3 decides (Bacchus published vs demoted-until-real)
└─ FOOTER — Free tools · Pricing · legal row (Privacy / Terms / Accessibility / AI disclaimer)
```

Every money/decision page ≤1 click from home; every tool ≤2; zero orphans served;
one nav definition so "Pricing disappeared" is structurally impossible to regress.

---

## 2. Page-by-page verdicts

Depth `99` = orphan/unreachable. Disposition: keep · merge · retire · rebuild.

**The spine**

| Page | Role | Depth | Brand | Disposition |
|---|---|---|---|---|
| index.html | Homepage, the design reference | 0→0 | on-brand | **keep** — fix the nav it propagates |
| how-we-work.html | Process narrative + pre-sale FAQ | 1→1 | on-brand | **merge-into** — becomes THE narrative page |
| the-experience.html | Emotional twin of how-we-work | 1→— | on-brand | **retire** — 301 → /how-we-work (P1) |
| about.html | Founder story + beliefs | 1→1 | on-brand | **keep** — trim the duplicated 4-card grid |
| work.html | "Results" with zero published work | 1→1/footer | on-brand | **rebuild** — Bacchus study or footer demotion (P3) |
| contact.html | Conversion endpoint (form/Calendly) | 1→1 | on-brand | **keep** — resolve its lone dark mode (P4), add price anchor |

**Services & money**

| Page | Role | Depth | Brand | Disposition |
|---|---|---|---|---|
| services.html | All-services hub | 1→1 | on-brand | **keep** — make "Pricing and the full picture" true |
| web-design.html | Service detail, $1,500 start | 1→1 | on-brand | **keep** — one timeline, one platform story, fix reveals |
| seo-strategy.html | SEO detail — priced nowhere | 1→1 | on-brand | **keep** — add the cost beat |
| monthly-retainer.html | Growth Partnership $400/mo | 1→1 | on-brand | **keep** — 301 → /growth-partnership (P5), single retainer truth |
| pricing.html | Orphaned SaaS pricing → rebuilt | 99→1 | different-site | **rebuild** (in flight) — canonical price truth, indexed, in nav |
| pricing-estimator.html | 5-question price quiz | 2→2 | different-site | **rebuild** — live catalog, kill $850/mo, index skin (P2) |
| roi-calculator.html | ROI sliders, dead catalog | 2→— | drifted | **merge** — into the estimator (P2) |
| audit.html | Free review + paid audits $99–$899 | 1→1 | drifted | **keep + reskin** — label the paid tiers, drain to /contact |
| buy-audit.html | Stripe checkout, zero chrome | 2→2 | different-site | **keep** — slim shared chrome, tier copy from one source |

**Tools family**

| Page | Role | Depth | Brand | Disposition |
|---|---|---|---|---|
| tools.html | Resources hub, footer-only | 1(footer)→1(nav) | on-brand | **keep** — promote to nav, fix the canon of six |
| ai-critique.html | AI website review wizard | 2→2 | different-site | **keep tool, rebuild skin** — white-on-white text is an immediate hotfix |
| report-card.html | Personal 1-page snapshot offer | 2→2 | different-site | **keep offer, rebuild page** — delete popup/cursor/progress bar |
| local-visibility.html | Local-search self-quiz | 2→2 | drifted | **keep** — healthiest content, reskin + trim closers |

**Industries**

| Page | Role | Depth | Brand | Disposition |
|---|---|---|---|---|
| industries.html | Hub + "not listed" catch-all | 1→1 | on-brand | **keep** — resync chrome, add a process bridge |
| restaurant / salon / retail / home-services / health-wellness-web-design.html | 5 SEO landers, ~80% shared boilerplate | 1→1–2 | on-brand | **keep** — add `_redirects` rules, templatize the shared shell (one edit, not five) |

**Legal & utility**

| Page | Role | Depth | Brand | Disposition |
|---|---|---|---|---|
| terms.html | ToS (site + free tools) | 1→1 | on-brand | **keep** — retemplate chrome; subscription gap → P6 |
| privacy.html | Privacy policy, best-maintained | 1→1 | on-brand | **keep** — retemplate chrome only |
| accessibility.html | WCAG statement | 1→1 | on-brand | **keep** — retemplate; exclude sibling a11y.html from build |
| ai-disclaimer.html | Legally load-bearing for AI tools | 2→2 | drifted | **rebuild** on the terms/privacy template — broken CSS traps its dark mode |
| contact-disclaimer.html | Retired, still served | 99→— | drifted | **retire** — delete; 301 already covers it |
| 404.html | Not-found page | 99→n/a | on-brand | **keep + fix** — relative links 404 from nested paths; add money-path rescues |

**Entry cluster, SaaS & internal ghosts**

| Page | Role | Depth | Brand | Disposition |
|---|---|---|---|---|
| start.html | Retired pre-call intake, still served | 99→— | drifted | **retire** — delete the file |
| get-started.html | SaaS onboarding squatting a marketing URL | 99→app | different-site | **keep as app page** — evict from marketing namespace (P6) |
| signup.html / welcome.html | SaaS signup + checkout return, funnel broken at both ends | 99→app | different-site | **park/move** with the product (P6) |
| studio.html | Operator sign-in door | 99→app | different-site | **keep** — excluded from marketing IA |
| email-signature.html | Internal signature doc on the public CDN | 99→— | different-site | **retire from public build** |
| styleguide.html | App design-system doc, claims to cover the public site (false) | 99→— | different-site | **keep internal, exclude from build**; document the marketing system |

---

## 3. THE SLICE PLAN

Ordering: visitor impact first — the nav every visitor touches, then the money
question, then the "different site" cluster, then narrative/proof/SEO surfaces,
then hygiene. **One Eric approval per slice.** The ai-critique legibility bug
(MS3.0) is a standalone hotfix that need not wait for its slice.

### MS1 — One nav, one chrome — **M** — decisions P3 + P4 first; verify triage's /pricing landed
The structural fix for all three complaints' propagation layer; touches ~30 files once, then never again.
1. **The consolidated nav:** 6 slots + 2 actions — Services ▾ · Pricing · How it
   works · Industries · Free tools · About + [Client login → /portal] [Book a free
   call]. "How it works" points at /how-we-work (content merge is MS4; the nav
   stops selling one story twice today). Results placed per P3. Free tools
   promoted out of footer-only.
2. **One chrome source:** header/footer extracted to a single include stamped at
   build time by build-public.sh (mechanic is the builder's call), plus a drift
   test that fails if any page's chrome diverges — kills the hand-copy drift class
   ("my pricing disappeared", four stale nav generations) permanently.
3. Propagate to every marketing page incl. legal, tools, landers, 404 — the
   missing-Pricing navs die in one pass.
4. **IA safety:** explicit `_redirects` 200 rules for the five landers (the only
   published family riding implicit .html resolution); /pricing clean-URL rule +
   sitemap entry verified; 404.html converted to absolute clean URLs with
   Contact/Pricing/Free-review rescue links.
5. **Label/destination sanity:** "See what your site needs" → /audit everywhere
   (today it forks to /tools on 8+ pages); aria-current fixed on the landers;
   homepage body gains /services + /pricing links; audit.html gains an in-body
   /contact link (closes the one-way funnel exit).
6. Dark-mode policy per P4 executed at the chrome level (tool bodies wait for MS3).

### MS2 — The money path — **M** — parallel-safe with MS1; needs triage's /pricing live
One price truth, quoted identically at every depth. This slice fixes NUMBERS; skins wait for MS3.
1. /pricing = canonical: web-design packages from $1,500, Growth Partnership
   $400/mo, paid audits from $99 (linking /audit#pricing), and an honest
   standalone-SEO answer.
2. services.html: at-a-glance price block + /pricing link — "Pricing and the full
   picture" becomes true; "Full pricing" buttons stop promising what web-design
   can't deliver.
3. web-design.html: ONE timeline (45-day vs the estimator's 2–10 weeks — pick and
   propagate), ONE platform story (Squarespace/Webflow/custom vs WordPress/Wix);
   restore the dead `.js-anim` reveal wiring (also seo-strategy).
4. seo-strategy.html: the site's only unpriced service gets its cost beat
   (standalone vs bundled into the Growth Partnership).
5. monthly-retainer.html: single retainer truth; 301 → /growth-partnership per P5;
   font preload aligned with index.
6. **Purge the dead catalog at depth 2:** pricing-estimator's Template/Custom +
   Photography/Custom HTML tiers, 25% rush, and the $850/mo "required" retainer
   rebuilt against the live catalog; roi-calculator's slider relabeled. No visitor
   is ever again *emailed* a price the site doesn't sell.
7. contact.html: one reassurance line ("Web design from $1,500 — full pricing →");
   how-we-work FAQ gains the cost question linking /pricing.

### MS3 — Tools family onto the index system — **L** — depends on MS1 (chrome) + MS2 (catalog) + P2
The direct answer to "the tools pages look like a whole different site."
0. **HOTFIX (cherry-pick immediately):** ai-critique's white-on-light text — scan
   chips, hero intro, loading steps, pale `em` — key copy is near-invisible in
   light mode today.
1. One tool-page template on index anatomy: styles.css tokens (page-local `:root`
   forks deleted), radius-2px ink buttons (purple pills die), stroked SVG icons
   (both emoji sets die), `.js-anim`-gated reveals, ONE closer (the 3–4-deep
   CTA gauntlets collapse), one breadcrumb standard (Home / Free tools / X), the
   soft-capture band rebuilt once as a tokenized component (kills the
   #EDE8F7/#5b3fa0 inline-hex copies — reused by MS5).
2. audit.html: the 1,665-line hybrid restyled; free score + paid tiers kept but
   *labeled* ("Free review" vs "Paid audits from $99"); duplicate og meta removed;
   cookie-banner/trust-strip becomes one sitewide policy, not tools-family quirk.
3. report-card.html: exit-intent popup, custom cursor, scroll progress bar, 68px
   dead band, unconditional `.reveal` hide, and the unbacked "weekly tips" promise
   all deleted.
4. pricing-estimator.html: restyled (numbers fixed in MS2); ONE tier taxonomy end
   to end; results CTA → /contact.
5. roi-calculator.html: per P2 — retire into the estimator as its "what it's
   worth" module (its results CTA anatomy is the family's best; carry it over);
   either way the 382% default anchor is calmed.
6. local-visibility.html: reskin + trim closers; content untouched (the cluster's
   healthiest).
7. buy-audit.html: slim shared header/footer at the payment moment; tier copy
   generated from audit.html's source; clean back-link.
8. **One booking front door:** the Calendly deep links in estimator/ai-critique
   results and error paths → /contact (Calendly remains, behind it).
9. tools.html: the "six tools" canon matches the tool-switch grid (ROI's slot per
   P2); nav promotion already landed in MS1.

### MS4 — One story: narrative consolidation — **M** — depends on P1 + MS1
1. **Merge the-experience into how-we-work:** absorb beats 02/03/05 + the pmock
   workspace figure; retitle "How it works"; delete the not-a-step step 04;
   301 /the-experience → /how-we-work; rewire the ~8 body links pointing at it.
2. **De-triplicate the workspace pitch:** index keeps the master grid; about's
   near-duplicate 4-card grid trimmed; work.html's false claim ("isn't a mockup —
   it's right here") corrected to honest copy — it links an explicitly decorative
   hand-built mock, on the page whose premise is honesty.
3. about.html: origin story + beliefs + signature kept whole; the "Not
   credentials" framing squared with the credentials it then leans on.

### MS5 — Industries family templatization — **M** — depends on MS1 (rules + chrome); reuses MS3's soft-capture component
1. The ~80%-identical shared shell (H2, "organized and effortless" paragraph,
   Explore chips, CTA, soft-capture) extracted so a family edit is one change;
   unique content (lede, bullets, FAQs — the real substance) stays per-page.
2. Double closer collapsed to the standard dark-CTA → footer; soft-capture
   tokenized.
3. industries.html: one-line "every industry gets the same process" bridge to
   /how-we-work so the hub click isn't empty.
4. health-wellness: the "private" booking/intake bullet softened or substantiated.
5. Noted, no action: health-wellness is the first merge-into-hub candidate if
   maintenance weight ever bites.

### MS6 — Proof: the Results page — **S–M** — depends on P3 + MS4 (claim fix)
- **If Bacchus permission lands (recommended):** publish the case study from the
  orphaned, already-shipping 7-shot jpg+webp set (case-studies/bacchus/) using
  work.html's own 4-beat template; the four apology sections shrink to zero;
  Results earns its nav slot; the five landers' proof links get a real target. **M**
- **If not:** Results demoted to footer (already wired in MS1's nav per P3);
  work.html trimmed to one honest paragraph + the framework. **S**

### MS7 — Entry, legal & ghost sweep — **M** — depends on P6
1. Delete dead files: start.html, contact-disclaimer.html (their 301s already do
   the job; the files are live unmonitored duplicates today).
2. **The allowlist stops glob-shipping everything:** email-signature, styleguide,
   a11y excluded from the public build (internal instructions, mail-provider
   setup steps, and mock client data are all guessable-URL public right now).
3. ai-disclaimer rebuilt on the terms/privacy legal template — the stray-brace CSS
   currently traps its dark-mode variant behind a ≤900px media query; added to the
   footer legal row (it's legally load-bearing and body-link-only today).
4. terms.html: extended for subscriptions or SaaS signup repointed at real
   subscription terms — today signup records acceptance of a ToS that covers only
   "this website and the free tools."
5. SaaS namespace per P6: /get-started returned to marketing; signup/welcome/
   studio out of marketing IA; signup's no-plan fallback stops dumping old links
   onto agency pricing.

---

## 4. Eric decision points

**P1 — the-experience → how-we-work (MS4).** ~70% overlap, same "You feel:"
device, same retainer hand-off; two top-nav slots for one story is the single
clearest cause of "so many clicks." **Recommend: retire-into** (301 + absorb the
best 3 beats and the pmock figure). Alternative: keep both and de-dup — preserves
a URL nobody links from the footer, keeps the nav wide.

**P2 — Pricing-tool shape (MS3).** Three defensible shapes: (a) /pricing absorbs
estimator + ROI as on-page modules — one money surface, heavier page; (b)
**recommended:** /pricing stays the fast honest read, pricing-estimator remains
the standalone interactive tool (it's the strongest intent-capture and now linked
from /pricing), ROI retires into it as a module; (c) keep both standalone,
corrected — cheapest, keeps two overlapping surfaces to maintain.

**P3 — The Results nav slot (MS1/MS6).** Today a top-level slot apologizes for
being empty while a complete Bacchus image set ships unused. (a) **Recommend:**
ask Bacchus, publish, keep the slot; (b) demote Results to footer until the first
real study exists — ship (b) in MS1 if permission is slow, flip later.

**P4 — Dark mode (MS1/MS3).** contact.html (plus tools/buy-audit recipes) is the
only dark-capable chrome — the site changes skin at the conversion moment.
(a) **Recommend: strip** the page-scoped variants now — one light system, dark
becomes its own properly-tested future effort; (b) promote contact's token flip
into styles.css sitewide — a real feature with ~30 pages of testing weight.

**P5 — /monthly-retainer → /growth-partnership (MS2).** The URL is the exact
"maintenance retainer" frame the page's copy disavows. **Recommend: rename + 301.**
Alternative: keep the URL — free, but the address contradicts the brand story
forever.

**P6 — SaaS on the agency domain (MS7).** get-started/signup/welcome/studio wear
Studio OS branding at marketing-adjacent URLs; an anonymous prospect at
/get-started hits a SaaS login door. (a) **Recommend:** move them under /app/* (or
a subdomain) and release the pretty URLs; (b) interim: keep serving, noindex,
remove from marketing IA only. Either way, marketing owns the phrase "get started."

---

## 5. What this plan does NOT cover

- **The Studio app (24 operator surfaces):** its own slice queue in
  STUDIO-STANDARDS-SWEEP.md — untouched here.
- **The client portal (client.html / portal.html):** the portal half of that same
  sweep; marketing touches it only at the "Client login" link.
- **The Presence SaaS product itself** (plans, checkout, onboarding): this plan
  only evicts it from the marketing namespace (P6/MS7); where that product
  actually lives and sells is a separate product decision.
- **Backend & edge functions** (Supabase CRM intake, clever-api, PSI, Stripe):
  funnels are re-pointed at the link level only — no API changes.
- **Case-study production** beyond assembling the Bacchus page: permission,
  photography, and future studies are Eric's workflow, not a slice.
- **A real sitewide dark mode:** P4 only picks one consistent system today; dark
  as a feature is its own future approved effort.
