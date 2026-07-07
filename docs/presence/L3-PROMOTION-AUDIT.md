# Optimization Promotion Audit — before L3.1

**Documentation only.** No code. This audits how the 28 providers' observations should (and should not) become customer-facing, so that L3.1 (Optimization Judgment Depth) promotes evidence into recommendations **without breaking the calm-software philosophy**. It answers the four questions directly and proposes a disposition for every optimization observation.

Grounded in the product laws it must protect: *health is a sentence, never a score* (13); *calm is default, color is information, noise must earn its existence* (15); *plain language, merchant words* (16); *failure copy leads with what's safe* (18).

---

## The decisive lens: who owns the fix?

The single most useful question — more useful than severity — is **who can actually fix this?** Because Studio OS owns the whole pipeline (renderer → template → hosting → deploy), most "SEO / accessibility / performance problems" are **ours**, not the customer's. That is the calm superpower: a tool that doesn't own the pipeline can only *nag*; we can *fix*. Three owners:

- **Platform owns it** (renderer / template / hosting default) → **fix once, silently.** Every site benefits; no one is ever shown the problem or the fix. This is the largest category and the biggest calm win.
- **Operator owns it** (a per-site human judgment — a domain, a lapsed cert, a real outage) → **operator surface, never the customer.**
- **Customer owns it** (a fact only they know, a decision only they can make — their hours, their story, their menu, whether to connect a profile) → **customer-facing, but calmly:** grouped, gated, and in their words.

**The edition modifier.** The *same* observation changes owner by edition. On a **Presence** site (we host, we own the template) a missing canonical tag is *ours* → silent. On a **Monitor** site (the customer's existing external site, we only observe) the same tag is *theirs* → it becomes evidence in the migration story, shown gently. L3.1 must read `edition` before choosing an audience. A rule that's silent for Presence is often customer-informative for Monitor.

The four questions map onto four levers this lens produces:

| Question | Lever |
|---|---|
| Never customer-facing? | audience = platform (silent) or operator |
| Only when severe? | a severity/threshold gate before surfacing |
| Silent background improvement? | platform-owned → fix once, emit nothing to anyone |
| Grouped into one Moment? | bundle by job-to-be-done, not by technical type |

---

## Q1 — Which observations should NEVER be customer-facing?

Two sub-cases: **platform-owned** (fix silently, below) and **operator-owned** (a human acts behind the scenes). Never the customer, because the customer cannot act on them and showing them only creates anxiety.

**Operator-only (per-site human judgment):**
- `website.hosting_missing`, `website.http_status`, `website.live_fetch_failed` — availability; the studio acts, the customer is never alarmed about infrastructure.
- `infrastructure.dns_apex_unresolved`, `dns_www_unresolved`, `http_not_redirected`, `redirect_chain` — DNS/redirect plumbing on a **Presence** site (on **Monitor**, these are the customer's host → migration evidence, shown).
- `infrastructure.domain_expiring` — critical, but the operator renews or nudges through the existing foundations flow, not a raw alarm. (Customer-facing *only* as the calm "keep your domain safely yours" plan, never as "EXPIRES IN 45 DAYS.")
- `trust.ssl_missing`, `trust.security_header_missing` — cert/headers are ours to hold; operator, silent to the customer.
- `analytics.not_connected`, `local_presence.profile_unconnected`, `local_presence.apple_business_unconnected`, `reviews.source_unconnected` — **dormant**: these describe integrations that don't exist yet. Emit for completeness; surface *nothing* until the destination ships, then a single gentle "connect your Google profile?" prompt — never a standing "not connected" complaint.

**Platform-internal (a bug in our own output → operator/engineering, never customer):**
- `structured_data.schema_missing`, `schema_field_missing`, `ldjson_invalid` — our renderer emits schema; if it's wrong that's our defect.
- `seo.robots_blocks_all`, `seo.orphan_page`, `seo.sitemap_page_missing` — our build controls robots/sitemap/linking.

> Law in action: **never show a person a problem they cannot fix.** For a business owner, "your DMARC record is missing" is anxiety with no exit. Either we fix it, or we translate it into a decision they *can* make — never a raw defect.

---

## Q2 — Which should appear ONLY when severe?

Observations where a little is normal and only an extreme earns a calm word. Gate on a threshold (many already carry one in the catalog); below it, silence.

- `freshness.publish_stale` (≥90d), `updates_quiet` (≥120d), `menu_unchanged` (≥180d) — surface seasonally, once, and only well past the threshold. A two-week-old site is not "stale."
- `performance.image_oversized` — only genuinely heavy images (a 2 MB hero), and even then prefer the silent fix (we re-encode). Never flag a slightly-large image.
- `performance.slow_response` — only clearly past budget, and it's usually **ours** to fix (hosting) → silent unless persistent, then operator.
- `content.thin_content`, `content.reading_hard`, `content.description_thin` — only when *severe* (a nearly-empty page, a genuinely hard read), grouped into content guidance — not "this page is 38 words."
- `reviews.testimonials_stale`, `reviews.velocity_slowing` — only when pronounced; a warm seasonal nudge, never a metric.
- `media.unused`, `media.duplicate_image` — low stakes; surface only if there are *many*, otherwise silent housekeeping.

> The test: *would a calm, competent studio owner mention this unprompted?* If only in the extreme, gate it there.

---

## Q3 — Which should become silent background improvements?

The heart of calm: **anything the platform controls end-to-end, fixed once at the template/renderer/hosting level — the customer never sees the problem or the fix.** These should not become recommendations at all; they should become *engineering work on our defaults*, after which the observation stops firing for every site.

- **Search hygiene we render:** `seo.canonical_missing`, `seo.robots_missing`, `seo.sitemap_missing`, `seo.twitter_card_missing`, `metadata.og_missing`, `metadata.favicon_missing`, `seo.title_length` (template can enforce sane bounds). Our templates should just emit these correctly.
- **Schema:** all `structured_data.*` and `aeo.faq_schema_missing`, `aeo.entity_links_missing` — the renderer should emit valid, complete schema (incl. FAQPage, sameAs) from the structured content it already has. Silent.
- **Accessibility baked into templates:** `accessibility.lang_missing`, `landmark_missing`, `heading_skip`, `tabindex_positive`, `aria_hidden_focusable`, `table_structure`, `form_label_missing` — these are template/component correctness. Fix the templates once; they can't recur on our sites. (On **Monitor** sites they're customer evidence, since it's their HTML.)
- **Performance we host:** `performance.compression_missing`, `cache_headers_missing`, `cdn_absent`, `blocking_scripts`, `font_swap_missing`, `lazy_loading_missing`, `image_dimensions_missing` — hosting/build config and the renderer. Fix globally; silent forever after.
- **Foundations we manage:** `infrastructure.caa_missing`, `spf_missing`, `dmarc_missing` — when we manage the domain, these become part of the guided foundations setup, applied on the customer's behalf; not a customer recommendation.

> This is the differentiator to protect: competitors turn these into a 40-item "SEO audit" the owner is guilted into fixing. We turn ~two-thirds of the list into **things that are simply correct**, once, for everyone — and never mention them. The optimization engine's real customer value is the *short* list that survives after the platform has quietly handled the rest.

---

## Q4 — Which should be grouped into ONE Business Moment?

Group by the **customer's job-to-be-done**, never by the technical taxonomy. One Moment per intention, ranked, with the specifics inside — never a stream of notifications. (M9.x already groups several of these; L3.1 extends the same rules, it does not invent a new surface.)

| One calm Moment | Bundles these observations | Voice |
|---|---|---|
| "Let's finish your business details" | `business_info.identity_incomplete`, `hours_incomplete`, `address_incomplete`, `holiday_hours_missing`, `trust.contact_missing`, `business_info.phone_mismatch` | attentive |
| "Make it easy to book or buy" | `conversion.booking_missing`, `ordering_missing`, `prices_missing`, `content.cta_missing` | encouraging |
| "Help people find you on maps" | `local_presence.nap_inconsistent`, `map_signal_missing`, (later) profile/apple connect prompts | informative |
| "Get ready for AI search" | `aeo.answers_thin`, `citation_facts_incomplete`, `location_terms_missing` (schema pieces handled silently) | informative |
| "A few accessibility touch-ups" (customer content only) | `accessibility.img_alt_missing`, `link_text_vague` on *their* copy/images | attentive |
| "Time for a seasonal refresh" | the `freshness.*` family, severity-gated | encouraging |
| "Your menu and your site disagree" (per document) | `knowledge.item_unlisted`, `price_mismatch`, `phone_mismatch`, `hours_available` | attentive |
| "Show the people behind the business" | `trust.team_info_missing`, `reviews.testimonials_none` | encouraging |

Rule of thumb: **if two observations would be fixed in the same sitting by the same person for the same reason, they are one Moment.**

---

## Proposed disposition (the L3.1 promotion map)

| Disposition | Meaning | Representative types |
|---|---|---|
| **Platform-fix (silent)** | Fix once in template/renderer/hosting; surface to no one | schema, canonical/robots/sitemap/OG/twitter/favicon, template a11y, compression/cache/cdn/lazy/fonts |
| **Operator-only** | Human studio action, behind the scenes | website availability, DNS/redirects (Presence), SSL/headers, domain expiry |
| **Dormant** | Emit, surface nothing until the feature exists | analytics/GBP/Apple/reviews "not connected" |
| **Customer — severe-only** | Surface past a threshold, gently, seasonal where apt | freshness, thin/hard content, oversized images, stale reviews |
| **Customer — bundled** | One Moment per job-to-be-done | business details, conversion, local, AEO, content a11y, knowledge mismatches, trust/story |
| **Edition-flip** | Silent/operator on Presence → customer evidence on Monitor | most template/infra/a11y types, as migration signals |

---

## Guardrails for L3.1 (so promotion stays calm)

1. **Default is silent.** A newly promoted observation surfaces to a customer only if it passes: *they own the fix* **and** *it's severe or bundled* **and** *it survived the platform's own auto-fix*. Everything else stays operator/silent.
2. **Fix-first, tell-never.** Before writing a rule that shows an issue, ask if the platform should just fix it for every site. Prefer the engineering fix; it's the calmer product and it scales.
3. **One Moment per job.** Never emit N notifications where one grouped Moment serves. Cap what a single observation cycle can raise.
4. **No scores, no counts, no jargon** (Laws 13, 16). "A few pages could load faster," never "Performance 72 / 4 issues / LCP 3.1s."
5. **Failure-safe and reversible** (Laws 18, 10–12). A promoted recommendation is a suggestion that can be ignored for free; a withheld one simply doesn't appear.
6. **Edition-aware audience.** Read `edition` first: Monitor turns many silent items into honest migration evidence; Presence keeps them ours.
7. **Earn the interruption.** `noise must earn its existence` — if you can't name the customer's job and the reason today, keep it suppressed. The suppressed-by-default posture the Foundation shipped is the safe place to promote *from*, deliberately, a few rules at a time.

**Bottom line for L3.1:** promote a *small* set of customer-owned, bundled, severity-gated observations into a handful of job-shaped Moments; route infrastructure and template correctness to operators or to silent platform fixes; keep everything else suppressed until it earns its place. The engine already observes everything — calm comes from how little of it the customer is ever asked to care about.
