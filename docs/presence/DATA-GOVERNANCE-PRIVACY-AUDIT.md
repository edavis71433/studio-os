# Version 1 — Data Governance & Privacy Audit

*Independent privacy-consultant review. Verification + documentation only — no code changed. Every claim is grounded in the actual codebase (files cited). Its purpose: know exactly what data Studio OS collects, where it goes, and how it is protected, so future legal documents can be written to match the software's real behavior.*

---

## 1. Executive Summary

Studio OS Presence handles customer data conservatively and transparently. Three findings stand out, all verified in code:

1. **Data minimization is strong.** The personal data collected is overwhelmingly **public-facing business facts** (business name, phone, email, address — the things meant to appear on the website) plus **account emails**. There is **no** stored payment-card data, **no** special-category data (health, biometrics, etc.), and signups store **no IP address or user-agent**.
2. **AI respects ownership and privacy.** The Writer sends only the **business fact sheet** (public facts) to the model — never account credentials. The **Concierge calls no AI model at all** (fully deterministic). The **Visual Studio sends only a text prompt** — a customer's own photos never reach the image model. Every AI output is customer-approved and customer-owned (`ai_approved` provenance), with manual parity always available.
3. **External access is least-privilege and revocable.** Connected providers are **read-only by default**; tokens are **AES-256-GCM encrypted out-of-row** and never returned to a client; **disconnect hard-deletes** the token and cached data, after which Studio OS **cannot access the customer's account**. Every external write is an approval-gated plan.

**Isolation** is deny-all RLS with function-mediated, JWT-scoped access; **audit logs record field names, never values**; the **export right** returns everything portable ("nothing here requires Studio OS").

**Gaps found (documentation/process, not correctness):** there is **no self-serve full-account-deletion endpoint** (deletion is per-entity + operator-mediated); original uploaded images retain EXIF/GPS **privately** (only published variants are stripped); one email address is logged on an email-misconfiguration warning; and the **legal document set (Privacy Policy, DPA, subprocessor list, retention policy) does not yet exist** to match this behavior. None is a data-leak; all are handled in the Risk Register and Recommended Legal Updates. **Nothing was changed.**

**Would an enterprise security review likely approve this architecture?** On the technical merits — deny-all RLS, encrypted-out-of-row secrets, approval-gated writes, no card storage, least-privilege connected access, comprehensive export — **yes, likely**, conditional on publishing the legal/retention/subprocessor documentation and adding (or documenting the SLA for) account erasure.

---

## 2. Data Inventory (by subsystem, verified)

| Subsystem | Data collected | Store |
|---|---|---|
| Accounts / Auth | Account email, name (Studio OS `clients`); signup email + business_name + single-use verify_token (`presence_signups`) | Postgres |
| CMS / content | Business identity (name, phone, email), location (address, city, postal), offerings, FAQs, posts, testimonials, voice, settings, redirects | `presence_identity/locations/offerings/faqs/posts/testimonials/voice/settings/redirects` |
| Media | Uploaded images + alt text + dimensions/mime/bytes (metadata only in DB; bytes in private bucket) | `presence_media` + Storage `presence-media` |
| Knowledge base | Uploaded document filename + extracted text | `presence_knowledge_docs` |
| Intelligence (Moments/Judgment/Recs/Evidence) | Derived observations about the site (no new PII) | `presence_evidence/judgments/recommendations/moments` |
| Growth Coach | Seasonal opportunities (derived) | `presence_growth_opportunities` |
| Concierge | Questions answered from pipeline output (deterministic) | not persisted as PII |
| Creative Studio (Writer/Editor/Reviewer/Guardian) | AI drafts (options) + prompt summary; brand profile; review reports | `presence_ai_drafts/ai_reviews/brand_profile/brand_reports` |
| Visual Studio | Generation brief, brand snapshot, draft variations, chosen asset | `presence_visual_plans` + Storage |
| Connected Platform | Encrypted provider tokens; normalized read numbers; event log | `presence_connection_secrets` (encrypted), `presence_connected_data`, `presence_connections`, `presence_connection_events` |
| Publishing | Rendered site versions + snapshots | `presence_publishes/snapshots` |
| Commerce / Billing | Email, business_name, edition, subscription status, entitlement, usage rollup; **no card data** | `presence_signups/entitlements/plan_notices/ai_usage` |
| Audit / Approvals | Change events (field names only), plan decisions, connection events | `presence_change_events/*_plans/*_operations/connection_events` |
| Industry/Marketplace | Pack install/operation records (no PII) | `presence_pack_installs/operations` |
| Enterprise | Org/region/location config diffs | `presence_organizations/regions/org_config/org_operations` |
| Agency | Member name + email + role; client links; jobs | `presence_agency_members/clients/jobs` |
| Platform Services | DNS zones/history, monitor connections | `presence_dns_zones/zone_history/monitor_connections` |
| System logs | Structured console tags; durable scheduled-run rows | Supabase function logs + `presence_scheduled_runs` |

---

## 3. Data Classification Matrix

| Data | Class | Req/Opt | Purpose (why it exists) |
|---|---|---|---|
| Account / signup email | PII · Persistent · Internal | Required | Identify the account, send commerce/verification email |
| Business name / phone / email | PII (business) · Persistent · **Public** | Required (at publish) | Appears on the customer's own website/listings |
| Location address | PII (business) · Persistent · **Public** | Optional | Shown on the site; local-presence intelligence |
| Media (images) | Content · Persistent · Public-on-publish | Optional | The customer's own photography on their site |
| Knowledge docs (text) | Content · Persistent · Internal | Optional | Grounds Writer facts; never published verbatim |
| Brand profile | Content · Persistent · Internal | Optional | Voice/brand for Creative + Visual |
| Provider tokens | **Sensitive** · Persistent · Internal · **Encrypted** | Optional | Read the customer's connected services (read-only) |
| Connected read numbers | Derived · Persistent (one-deep) · Internal | Optional | Corroborate/celebrate in the pipeline |
| AI drafts / prompt summary | Content · Persistent · Internal | Optional | The customer's own drafts, approved before use |
| Visual generations | Content · Temporary (drafts) / Persistent (approved) | Optional | Customer's images; drafts ephemeral |
| Subscription / entitlement | Account · Persistent · Internal | Required | Gate capability; billing state |
| Agency member email | PII · Persistent · Internal | Required (agency) | Team access + roles |
| Verify token | Secret · **Temporary** (single-use) | Required (signup) | Email verification nonce |
| Change events | Audit · Persistent · Internal (**field names only**) | System | Provenance/traceability |

No special-category data (health, biometrics, government IDs, precise-location tracking) is collected. **No payment-card data is stored** (see §8).

---

## 4. Data Flow (per the fourteen questions, verified)

For each data type: **origin → store → encrypted? → leaves? → to AI? → to providers? → cached? → logged? → backed up? → exported? → deleted? → retained? → versioned? → audited?**

- **CMS content:** originates from the customer → Postgres (RLS) → not separately encrypted (DB-at-rest by Supabase) → does **not** leave except (a) the *published* site (public by intent) and (b) the fact sheet to the Writer model when the customer asks → not to providers → not cached externally → audited (field names) → PITR-backed → **exported** via `/export` → soft-deletable → retained until deleted → **versioned** on publish.
- **Media:** customer upload → private bucket + metadata row → not encrypted at field level (private bucket, signed URLs only) → published variants are public (EXIF/GPS **stripped** at publish); originals stay private → not sent to AI → delete removes the storage object + soft-deletes the row → exported (references) → versioned via publishes.
- **Provider tokens:** OAuth/key → **AES-256-GCM sealed, out-of-row** (`presence_connection_secrets`) → **never leave**, never returned to a client → used only to read the provider → disconnect **hard-deletes** them.
- **Connected read numbers:** provider → normalized → `presence_connected_data` (one-deep + prev) → into the pipeline → cleared on disconnect.
- **AI drafts / visual generations:** customer request → model (text only) → stored as the customer's drafts → approved → owned (`ai_approved`) → drafts ephemeral / discardable.
- **Commerce:** email/business_name → `presence_signups`/`entitlements`; **payment instruments go to Stripe, not stored here**; subscription *status* syncs back via webhook.
- **Audit:** every mutation → one append-only change event with **field names only, never values** (`lib/provenance.ts`).

---

## 5. AI Data Handling Report

| Workflow | Sent to model | Never sent | Output | Approval | Parity | Ownership |
|---|---|---|---|---|---|---|
| Writer | The business **fact sheet** (public facts) + the task, injection-hardened (`<<<FACTS…>>>`) | Account credentials, tokens, other tenants' data | Draft options (stored as the customer's drafts) | Yes — customer accepts into draft | Yes | Customer (`ai_approved`) |
| Editor | The selected text + edit instruction | Same as above | Edited option | Yes | Yes | Customer |
| Reviewer / Brand Guardian | Content being reviewed | Same | Findings (no publishing) | n/a (advisory) | Yes | Customer |
| Growth Coach | Derived seasonal signals | PII beyond business facts | Opportunities | Yes (prepare→approve) | Yes | Customer |
| **Concierge** | **Nothing — no model call** (deterministic, grounded in pipeline output) | Everything | Grounded answer | n/a | Yes | Customer |
| **Visual Studio** | A **text brief** (subject + brand cues), claim-scrubbed | **The customer's own photos** (never uploaded to the model) | Generated images | Yes — approve one | Yes (upload always works) | Customer (`ai_approved`) |

- **Identifiers removed / not sent:** the models receive only business-public facts or a text brief; no account email/password/token, no cross-tenant data. The Writer's prompt is hardened so DB content is treated as data, not instructions.
- **Prompts/outputs stored:** as the customer's own drafts (`presence_ai_drafts`, `presence_visual_plans`) — their property, deletable/discardable.
- **Gating:** AI is dark-but-honest without `ANTHROPIC_KEY` / `VISUAL_MODEL_KEY`; it never fabricates.

---

## 6. Connected Platform Data Report

Per provider (registry `connected/providers.ts`): declared **reads** (plain language), optional **future writes**, and least-privilege scopes.

- **Read:** only what the customer authorizes; normalized to plain numbers.
- **Write:** none by default; where supported (GBP post/hours, GSC verify) it is an **approval-gated plan** with a reviewed rollback. Handoffs (calendar/email/social) are prepared, **never auto-sent**.
- **Credentials:** delegated tokens sealed **AES-256-GCM**, stored out-of-row (`presence_connection_secrets`, ciphertext+iv, one per site+provider), **never returned to a client**.
- **Disconnect** (`connected/store.ts`): DELETEs the sealed token, DELETEs the cached data, marks disconnected, logs it. **After disconnect, Studio OS holds no credential and cannot access the customer's account.** The contract for a provider-side account deletion is "mark disconnected; keep nothing that isn't ours to keep."
- **Ownership:** the account and its data stay entirely the customer's; Studio OS only ever *read* what was permitted.

---

## 7. Visual Studio Data Report

- **Uploaded images:** the customer's own photos go to the private media bucket (metadata in `presence_media`); **they are never sent to the AI model.**
- **Sent to AI:** a **text brief only** (subject + brand cues, claim-scrubbed). Generation is text-to-image; "edit" is instruction-guided regeneration (still text).
- **Metadata stored:** brief, brand snapshot, draft variation references, chosen asset, provenance.
- **Ownership:** an approved asset is the customer's — `ai_approved` provenance records origin for honesty only, never to limit use. Unapproved drafts are ephemeral and discarded.
- **Deletion / recoverability:** `deleteMedia` removes the storage **object** and soft-deletes the row — the image bytes are gone (not recoverable via the app); the metadata row persists with `deleted_at` (see Risk R3). EXIF/GPS on originals is retained privately, stripped on any published variant (Risk R4).

---

## 8. Commerce Data Report

- **Stored by Studio OS:** email, business_name, chosen edition, subscription **status**, entitlement, usage rollup (`presence_signups/entitlements/ai_usage/plan_notices`). Verify token is single-use.
- **Stored by Stripe (NOT Studio OS):** all payment instruments — card numbers, CVV, bank details. A codebase search for card/PAN/CVV storage returns **nothing**; `commerce/stripe.ts` only calls the Stripe API (checkout sessions, subscriptions). Founder pricing is a plan/price configuration, not stored card data.
- **Flow:** signup → Stripe checkout → idempotent provisioning (one site per client) → webhook syncs subscription status → entitlement drives capability. On lapse: read-only + export preserved (grace model in `commerce/subscriptions.ts`).

**Studio OS is out of PCI card-data scope** — it never sees or stores a card.

---

## 9. Customer Rights Report

| Right | Mechanism | Status |
|---|---|---|
| **Export account data** | `GET /export` → content, media refs, brand, knowledge, redirects, **and the fully rendered site** ("host it anywhere; nothing requires Studio OS") | ✅ Self-serve |
| **Download data** | Same export (portable JSON + HTML) | ✅ |
| **Delete media** | `DELETE /media/:id` — removes the object, soft-deletes the row, refuses while referenced (names blockers) | ✅ Self-serve |
| **Delete content** | Soft-delete (`deleted_at`) via the CMS | ✅ Self-serve |
| **Disconnect a provider** | `POST /connections/:key/disconnect` — token + cache destroyed | ✅ Self-serve |
| **Delete connected data** | Happens automatically on disconnect | ✅ |
| **Ownership guarantee** | Constitutional (content + domain always the customer's; no metered fees; leave any time) | ✅ |
| **Delete entire account / erasure** | **No self-serve endpoint**; operator-mediated (`clients.deleted_at`); per-entity deletes exist | ⚠️ **Operator-assisted** (Risk R1) |

---

## 10. Security & Privacy Report

Verified (cross-references [SECURITY](SECURITY.md), [QA-RELEASE-VERIFICATION](QA-RELEASE-VERIFICATION.md)):

- **Encryption:** provider tokens AES-256-GCM, out-of-row, fail-closed; DB/storage at rest managed by Supabase; site traffic over HTTPS.
- **Secrets:** dashboard-only, never in repo; rotation cadence documented.
- **Access control / least privilege:** deny-all RLS on all 54 `presence_*` tables; `svc` (service role) vs `asUser` (RLS-scoped); operators gate on `staff||system`.
- **Tenant isolation:** site resolved from JWT via RLS — a customer addresses only their own site.
- **Organization / agency isolation:** enterprise config scoped to the org tree; agency reads only its portfolio (403 otherwise).
- **Approval enforcement:** `requires_approval=true` DB CHECK on all five plan tables + atomic single-winner claim.
- **Audit logging:** append-only, **field names only, never values** — a privacy-preserving ledger.
- **Backups/restore:** Supabase PITR (verify quarterly); export is the customer-facing backstop.
- **Data leakage:** no stack traces/internal ids at the boundary; no card data; no PII in logs **except** one recipient-email warning line (Risk R2).

---

## 11. Compliance Mapping Report

The software's behavior vs the legal documents it will need. **The legal documents do not yet exist** — this maps what each MUST state to be accurate (see §15; not rewritten here).

| Document | Must accurately state | Behavior match |
|---|---|---|
| Privacy Policy | Collects business facts + account email; no card data; AI receives business facts/text prompts only; export + per-entity delete; account erasure is operator-assisted | Software matches once the policy states these (esp. the erasure SLA) |
| Terms of Service | Ownership (content + domain), no metered fees, leave-any-time | Matches (constitutional) |
| Cookie Policy | Auth/session storage (`dds-portal-auth` localStorage); no third-party ad/tracking cookies found | Matches (minimal) — verify no analytics cookies on the public site |
| AI Policy | AI drafts only, human-approved, manual parity, ownership `ai_approved`, no autonomous publishing, no customer photos to the image model | **Matches exactly** |
| Connected Platform disclosures | Read-only default; least-privilege; encrypted tokens; disconnect destroys access; writes approval-gated | **Matches exactly** |
| Security Statement | Deny-all RLS, encryption, approval enforcement, isolation, audit | Matches |
| Accessibility Statement | Keyboard/focus/ARIA/reduced-motion/theming present; a formal audit is pending | Matches structurally; needs a live audit |
| DPA | Names the subprocessors (below) and the data each processes | **Does not exist** → create |
| Subprocessor List | Supabase (host/DB/storage), Netlify (site hosting), Stripe (payments), Anthropic (AI, when enabled), image-model provider (Visual, when enabled), Resend (email), Google & other providers (Connected, per customer authorization) | **Does not exist** → create |
| Data Retention Policy | Content/audit/publishes retained until deleted; connected cache cleared on disconnect; soft-deleted rows persist; no auto-purge | **Does not exist** → create (see §12) |

---

## 12. Data Retention Report

- **Retained until explicitly deleted:** CMS content, media metadata, brand profile, knowledge docs, AI drafts, visual plans.
- **Retained indefinitely by design (ownership/traceability):** published versions + snapshots (`presence_publishes/snapshots`), audit ledgers (append-only).
- **Cleared automatically:** connected tokens + cached read data on **disconnect**; connected read cache is one-deep (prev overwritten).
- **Single-use / temporary:** signup verify token; visual draft variations (until approve/abandon).
- **No automatic TTL/purge of customer data** exists (the only "ttl" in code is a 30-day *moment-suppression* UX window, not deletion). **Soft-deleted rows persist** with `deleted_at` (media *bytes* are removed from storage; the row remains). → A retention/erasure purge job is a V1.1 candidate (Risk R3).

---

## 13. Data Export / Delete Report

- **Export:** `GET /export` (`platform/exporter.ts`) returns a portable `studio-os-export/1` bundle — structured content, media references, brand profile, knowledge docs, redirects, and the **fully rendered, framework-free website**. Self-serve, complete, with an explicit ownership note.
- **Delete:** self-serve for media (object removed, row soft-deleted, refused while referenced), content (soft-delete), and connections (token + cache hard-deleted). **Full-account deletion is operator-mediated** (no self-serve endpoint) — the one erasure gap (R1).

---

## 14. Privacy Risk Register

| # | Risk | Severity | Finding | Recommendation (documentation-only; **not implemented**) |
|---|---|---|---|---|
| R1 | No self-serve account deletion / erasure | **Medium** | Deletion is per-entity + operator-mediated (`clients.deleted_at`) | Document an operator-assisted erasure process + SLA in the Privacy Policy; consider a self-serve delete-account endpoint in V1.1 |
| R2 | Recipient email logged on email-misconfig | Low | `commerce/account.ts` `console.warn(... , to)` when `RESEND_KEY` unset | Redact/remove the address from the log line in V1.1 |
| R3 | Soft-deleted rows persist | Low | `deleted_at` rows remain (media bytes are removed; metadata row stays); no purge job | Document retention of soft-deleted rows; add an optional purge job in V1.1 |
| R4 | Originals retain EXIF/GPS privately | Low | Only *published* variants are EXIF/GPS-stripped; originals in the private bucket keep metadata (never served publicly) | Note in Privacy Policy; consider strip-on-upload in V1.1 |
| R5 | Legal/DPA/subprocessor/retention docs absent | Medium (process) | The software behaves well but the documents that describe it don't exist yet | Author them (next milestone) to match §11/§12 |
| R6 | Accessibility/security/pen not live-tested | Low | Structural controls present; no live audit run | Schedule pre-launch live passes |

**No data-leakage, cross-tenant-exposure, unencrypted-secret, or card-storage risk was found.**

---

## 15. Recommended Legal Updates (documentation only — NOT written here)

To make future legal documents accurate to the code, they must state:
1. **Privacy Policy:** the exact data inventory (§2) and classification (§3); that **no payment-card data is stored** (Stripe is the processor); that **AI receives only business facts / text prompts** and **customer photos are never sent to the image model**; the export right; per-entity self-serve deletion; and that **full-account erasure is operator-assisted** with a stated SLA.
2. **DPA + Subprocessor List:** enumerate Supabase, Netlify, Stripe, Anthropic (AI), the image-model provider (Visual), Resend (email), and per-customer-authorized Connected providers (Google, etc.), with the data each processes and the activation-gated ones marked.
3. **Data Retention Policy:** §12 verbatim in intent — retained-until-deleted, indefinite publishes/audit, disconnect-clears-connected, soft-delete persistence, no auto-purge.
4. **AI Policy & Connected disclosures:** already match the code (§5, §6) — state them plainly.
5. **Cookie Policy:** auth/session localStorage only; confirm the public site adds no third-party tracking cookies.

*(Writing these is the next milestone — Legal & Compliance Freeze. This audit does not write them.)*

---

## Final Questions (answered honestly)

- **Does Studio OS collect only the data it needs?** Yes — overwhelmingly public-facing business facts + account emails; no card data, no special-category data, no signup IP/UA.
- **Does every piece of customer data have a purpose?** Yes — each is tied to publishing the site, running the pipeline, billing, or an authorized connection (§3).
- **Can customers understand what happens to their data?** In-product, yes (plain-language, read-only/approval/ownership messaging); externally, **once the legal docs in §15 are written** (they don't exist yet — R5).
- **Can customers export their data?** Yes — `/export`, complete and portable.
- **Can customers delete their data?** Per-entity yes (media/content/connections); **full-account erasure is operator-assisted** (R1).
- **Can customers disconnect every external service?** Yes — disconnect destroys the token + cache; Studio OS then cannot access the account.
- **Does every AI workflow respect ownership?** Yes — approval-gated, manual parity, `ai_approved`, no autonomous publishing, no customer photos to the model.
- **Does every Connected workflow preserve ownership?** Yes — read-only default, encrypted least-privilege tokens, approval-gated writes, revocable.
- **Would an enterprise security review likely approve this architecture?** Likely **yes** on technical merits, **conditional** on publishing the legal/DPA/subprocessor/retention documentation (R5) and formalizing account erasure (R1).
- **Would I be comfortable explaining every data flow to a customer?** **Yes** — every flow is traceable, minimal, and honest; the only caveats are the documentation gaps above, not hidden behavior.

---

## Declaration

**Version 1 Data Governance & Privacy Audit complete.**

*Verification and documentation only. No feature, workflow, or data change was made. The identified items (R1–R6) are recorded for the Legal & Compliance milestone and V1.1; nothing was implemented, removed, or rewritten.*
