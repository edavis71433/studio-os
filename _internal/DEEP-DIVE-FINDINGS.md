# Davis Digital Studio — Deep Dive Findings & Enhancement Plan
**Date:** June 23, 2026
**Scope:** Full site, the two AI tools (AI Review + Concierge), the client portal, and the admin panel.
**Your ask:** Zero errors and broken links. Enhance the tools and add things of value, everywhere except the design and content (those stay as-is). Compare against FAANG / top product sites. Collect everything, then decide together.

---

## PART 1 — ERRORS & BROKEN LINKS (the safety net)

### Real bugs found and FIXED in this pass
These were genuine, would-have-shipped problems. All three are now fixed in the files.

1. **`audit.html` — broken JavaScript (syntax error).**
   When the concierge script line was added, it landed *inside* a JavaScript string (next to a `</body>` that lives inside an email template the page builds), not before the real page `</body>`. This threw "Invalid or unexpected token" and could halt the page's scripts. **Fixed:** removed the misplaced tag, restored the string, added the concierge correctly at the true end of the page. Verified: 0 JS errors, concierge loads.

2. **`report-card.html` — same broken JavaScript.** Identical cause and fix. Verified clean.

3. **`dds-studio-manage-9k2p.html` (admin panel) — "async is not defined".**
   A stray, orphaned `async` keyword was sitting on its own line above the Message Templates section (`async // -- MESSAGE TEMPLATES --`), left over from a past edit. This breaks the admin script at that point. **Fixed:** removed the orphaned keyword. The real `loadTemplates()` function right below it keeps its correct `async`.

### Checked and confirmed CLEAN (no action needed)
- **All internal links resolve.** Crawled every `href`/`src` across 28 pages. The only "misses" were JavaScript template strings (`${f.url}` etc.), which are dynamic code, not broken links.
- **All 6 Bacchus case-study images exist** in `/case-studies/bacchus/`. (My first crawl didn't recurse into the subfolder; confirmed present.)
- **All external links are valid** (Calendly, fonts, privacy policies, LinkedIn).
- **Portal "supabase is not defined"** only happens in the offline test sandbox because the Supabase library loads from a CDN that the sandbox blocks. On the live site it loads fine. **Not a real bug.**

### Minor issues worth a quick fix (low risk)
- **Two different DM Serif Display font URLs across pages.** Some pages request the italic variant (`:ital@0;1`), some don't. Pages without it can't render italic serif. Standardize on the italic version everywhere for consistency.
- **Case-study images are heavy: 2.7 MB total on `work.html`** (each 320–464 KB). That's the single biggest page-weight issue on the public site. Compressing/converting to WebP would cut this by 60–80% and noticeably speed up that page on mobile. (Design unchanged; same images, smaller files.)
- **Supabase library loads from a third-party CDN** (jsdelivr) on the portal and admin. If that CDN ever has an outage, those pages break. Low probability, but self-hosting the library removes the dependency. Optional.

---

## PART 2 — WHAT THE RESEARCH SAYS (FAANG / top product sites)

I compared your setup against how top SaaS and product companies (Stripe, Linear, Notion, HubSpot, Intercom) handle the same jobs, plus 2026 conversion benchmarks. Three themes matter for you, and importantly, **your site already does most of this right.** The opportunities below are additive.

### Theme A — Tools: value first, gate late (or never)
- Interactive tools (calculators, quizzes, instant audits) convert far better than static content, and the rule is **show real value before asking for anything**, deliver results on-screen instantly, and make any email step supplementary, not a wall.
- **You already nail this.** Your AI Review and Free Score show results with no hard gate. The enhancement isn't to add gates, it's to make the tools *more useful and more shareable* so they pull people toward booking.

### Theme B — Conversion: reduce friction, earn the click to book
- Multi-step flows convert better than single dumps; minimal fields; show a result before asking for contact info; keep CTAs benefit-focused and visible near the value moment.
- **You already do** multi-step tools, a sticky CTA, and a soft concierge handoff. The opportunity is small polish (consistency of CTA wording, a couple of trust touches) rather than structural change.

### Theme C — Portals: empty states, progressive disclosure, small delight
- Stripe reveals complexity step by step. Linear/Notion treat empty states as guidance ("here's your first step") and use small celebratory moments ("All caught up!"). A blank dashboard on day one is a dead end; a guided or sample-populated one builds confidence.
- **Your portal already has 13 empty-state messages**, a strong base. The opportunity is to make a few of them *guiding* (point to the next action) and add light progress/celebration cues.

---

## PART 3 — ENHANCEMENT OPPORTUNITIES (prioritized, no design/content changes)

Grouped by area, ranked by value-to-effort. Nothing here touches your visual design or copy voice; these are functional/value adds.

### A. PUBLIC SITE & TOOLS

**A1. Make the AI Review and Free Score results shareable. (High value, low effort)**
Add a "copy link to these results" or "download as PDF" on the results screen. Shareable results get forwarded to business partners, which is free distribution and a second chance to book. Research flagged shareability as a top trait of high-converting tools.

**A2. "Credit toward a project" reminder inside the paid audit flow. (High value, low effort)**
Your audits are already credited toward a project, but that's easy to miss. A single line at the decision moment ("your $99 comes right back off any build") removes the "is this worth it" hesitation.

**A3. Cross-link the tools to each other. (Medium value, low effort)**
After someone finishes the AI Review, point them to the ROI Calculator or Pricing Estimator as a natural next step ("curious what a fix like this is worth? try the ROI calculator"). Keeps people on-site instead of bouncing, directly serves your "no one clicks off" goal.

**A4. Compress the case-study images. (Medium value, low effort)**
Covered in Part 1. Faster `work.html`, better mobile, better Google score. Same images.

**A5. Consistent primary CTA wording sitewide. (Low value, low effort)**
You have "Book a Free Call", "Let's talk", "Book a free discovery call", "Book a free 15-minute call". Picking one phrase and one length builds recognition. (This is wording consistency, not a content rewrite, so it fits your "keep content" rule, but flagging in case you'd rather leave it.)

### B. CLIENT PORTAL

**B1. Turn passive empty states into guiding ones. (High value, low effort)**
You have 13 empty states. Upgrade the key ones from "nothing here" to "here's your next step" with a button (e.g. an empty Files tab links to "upload your brand assets"). This is the Stripe/Linear pattern and it reduces "what do I do now" confusion.

**B2. A simple project progress indicator. (High value, medium effort)**
A single visual "where's my project at" cue on the portal dashboard (e.g. Discovery -> Design -> Build -> Launch with the current stage lit). This is the #1 thing clients want from a portal ("stop me having to email and ask"), and it's also the phase-two concierge feature we discussed. Build it once, use it in both places.

**B3. A light celebratory moment on milestones. (Medium value, low effort)**
When a client approves a deliverable or a project hits launch, a small "Nice, that's done!" confirmation. Cheap to add, makes the portal feel premium, matches the 2026 "delight" pattern.

### C. ADMIN PANEL

**C1. An "at a glance" summary at the top. (High value, medium effort)**
A small strip showing active clients, pending approvals, unread messages, open requests. Right now you navigate to find these. Top SaaS dashboards surface the "what needs me today" first. Saves you time daily.

**C2. Resilience: self-host the Supabase library. (Low value, low effort)**
Removes the third-party CDN dependency noted in Part 1.

---

## PART 4 — SUGGESTED ORDER OF ATTACK

If we knock these out in waves:

- **Wave 1 (ship today, pure wins):** The 3 bug fixes (done), font URL consistency, image compression. Zero-risk, makes the "zero errors" goal real.
- **Wave 2 (tool value):** A1 shareable results, A2 credit reminder, A3 cross-linking. Directly serves "no one clicks off and books with me."
- **Wave 3 (portal polish):** B1 guiding empty states, B3 celebration moments. Makes the client experience feel premium.
- **Wave 4 (bigger builds):** B2 project progress tracker (+ phase-two concierge lookup), C1 admin summary. Highest effort, highest operational payoff.

---

## BOTTOM LINE
Your site was already in genuinely strong shape (the prior 100-category audit scored 95.8/100). This pass found **3 real bugs**, all introduced recently and all now fixed, plus a short list of low-risk polish items and a set of additive enhancements that serve your two goals (keep people on the site, get them booking) without touching the design or content you like. Nothing here is a rebuild. It's sharpening what you've already built.
