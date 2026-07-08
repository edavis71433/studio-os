# Phase UX — End-to-End User Journey Certification

*Certifies the EXPERIENCE, not the code: four personas walked end-to-end as strangers, judged on confusion/friction/delight/trust/efficiency/confidence. No credit for invisible architecture. One honest method caveat: I cannot run a browser — every step below is walked through the exact rendered markup, copy, and API responses a customer would receive (code-accurate simulation); the human Gold-Master browser pass remains the final visual confirmation. Implemented this phase: **FD-R2** (the workspace now speaks the business's language) — which also fixed a functional preview bug. Consolidates all ten required reports.*

---

## Persona 1 — Small business owner (a plumber, no technical knowledge)

**The journey as she experiences it:** finds the site → pricing page exists with 7 plans + trials (**hesitation #1: the public front door undersells the product — the known Phase-H gap; everything after signup is better than the marketing promises**) → signup (3 fields, calm errors, rate-limited invisibly) → lands in **get-started**: two questions, her services pre-filled for plumbing, "Studio OS drafts your site" → **delight #1: a real draft of her actual business appears for review, not a blank editor** → review/preview (device toggle) → publish with approval → her site says *Services*, carries `@type:Plumber`, a working contact form, generated privacy + accessibility pages, her logo after one tap, hours after one click ("typical hours") → **delight #2 (new this phase): her workspace now says "Services" too — nav, page, buttons; before today it said "Menu," the single most jarring incoherence in her day** → Search Console = paste one code → leads arrive in an inbox with prefilled replies; Moments tell her what matters in sentences → trial ending? She's told at T-3, calmly; card fails? "your site is still up"; cancels? 60-day window + export forever. **Confidence: yes — the system never surprises her and never asks her to know anything technical.**残り friction: colors/fonts aren't hers to change yet (FD-T6, the top V1.1 want), and section on/off (FD-T12).

## Persona 2 — Freelancer

First client: fast (starter draft + controls + Developer Mode when wanted). Fifth client: **the reuse wall** — no duplication, no presets, re-entering brand/SEO/config every time (FD-18/FD-B5, top of V1.1, unchanged by this walk). Billing/support tiers now explicit (Phase P). **Verdict: chooses Studio OS for quality + calm; keeps a Duda tab open for volume until FD-18 ships.**

## Persona 3 — Agency (20 clients)

Portfolio, roles (9, composed), unified approvals, bulk cadence, per-client CRM + foundations: **operations scale**. Authoring doesn't (same reuse wall) and bulk infra views are V1.1 (FD-INF4). White-label exists. **Verdict: can run 20 clients today with more per-client calm than HighLevel; onboarding the 20 is where the hours go.**

## Persona 4 — Enterprise procurement

Asks for: security posture (RLS/deny-all, rate limits, sanitized dev-mode — documented), compliance (SOC-2-inherited stack, generated site privacy/accessibility, DPA = P3 owner item), governance (constitutional approvals + audit ledgers + org→region→location), service description (**the AEM-style spec doc exists — unusual for a product this size and procurement notices**), SLAs (honest inherited-posture; formal statement at launch). **Verdict: trusts the governance story more than most mid-market SaaS; will ask for the DPA and SSO (V1.1 note) before signing big.**

## Workspace cohesion & competitor workflows

One shell, one nav source, one design language, edition-aware, no dead ends (guard-tested); the last visible seam — vocabulary — closed this phase. Workflow-for-workflow: onboarding beats Wix/Squarespace (drafted-for-you vs template-shopping); publishing safety beats everyone at this price (preview/versions-with-names/rollback/approval); SEO/AI-search beats plugin-land by construction; lifecycle honesty beats all nine (verified: none of them tell you "your site is still up" when a card fails). Where competitors win V1: visual freedom (Webflow/Framer), template galleries (Squarespace), reuse at volume (Duda/HighLevel) — all tracked, none load-bearing for the target customer.

## Implemented this phase (FD-R2 — and a functional bug it exposed)

Vocabulary table + boot-time application in the workspace: nav item, page title, sub-copy, add/hide/restore buttons, and tags now follow the business (**Menu/Products/Classes/Programs/Services**), template-first (restaurant-classic keeps Menu) then industry. **Bonus real bug fixed: the preview's page-word button pointed at `/menu/` for every site — a page that doesn't exist on business-classic sites** (broken preview nav for every non-food customer). Six dynamic strings + four static elements; parse-clean; frontend-only; full regression green (invariants 14/14).

## Final questions (honest)

- **Would a small business owner love it?** The post-signup product: **yes** — drafted-for-you, calm, honest, jargon-free; the walk found delight where competitors have chores. The pre-signup story still undersells it (Phase H).
- **Freelancer over competitors?** For craft yes; for volume, after FD-18.
- **Agency scale?** Operationally yes today; authoring-reuse is the ceiling (known, queued).
- **Enterprise trust?** The governance/services story is genuinely strong; DPA + SSO are the asks.
- **One week before launch?** Spend it exactly where the roadmap already points: the **front door** (Phase H — pricing/positioning copy so the marketing matches the product) and the **human browser pass** (Phase K). Zero engineering days needed — that's not a boast, it's this certification's finding.
- **Would I launch today? Not today — but not for product reasons.** The product experience certifies. What blocks launch is operational: owner activation (secrets/cron/PITR/Resend domain), the human browser/mobile/AT pass over pages built sightless, and a front door that tells the truth about how good the product now is. All three are on the board, none is engineering.

**Phase UX — End-to-End User Journey Certification complete.**
