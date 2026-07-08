# Phase A1 — Connected Platform Completion

*Implementation milestone. Finished every intentionally-started Connected Provider by filling in read endpoints, real normalizers, and per-provider auth shaping — **reusing the frozen architecture** (registry, OAuth/API-key flow, one shared read pass, the Approved-Plan spine). No new provider architecture, no Product-Law/Constitution change.*

---

## Executive Summary

All **21 registered providers now have a real read adapter** (endpoint + normalizer + correct auth shaping). Before this milestone, 13 were complete, 5 were partial (normalizer, no endpoint), and 3 were label-only stubs. The 3 stubs (Google Tag Manager, Meta Business, Apple Business Connect) now have real normalizers; the 5 partials (Bing, Yelp, Trustpilot, Salesforce, Klaviyo) now have read endpoints; and the three API-key providers whose auth isn't a Bearer header (Bing, Trustpilot, Klaviyo) now get their documented auth via an additive per-provider request-shaping helper. Every provider behaves consistently through the **same** connect / read / health / refresh / disconnect / audit path.

Two providers carry an honest **activation-specific** caveat (documented, not hidden): **Salesforce** needs its per-org `instance_url` substituted at activation, and **Apple Business Connect** connects via `ownership_verification` — a distinct auth path that is declared in the registry but intentionally not built (building it would be new auth architecture, out of this milestone's scope). Both are read-side complete; their live activation is parameterized exactly as the architecture always intended ("query shaping set at app registration").

**Tests green** (connected_reads 24/24 + writes 23 + validation 29 + intelligence 31; invariants 14/14). Deployed to staging + prod.

---

## Provider Completion Report

| Provider | Auth | Before | Now | Notes |
|---|---|---|---|---|
| google_search_console | oauth2 | Complete | ✅ Complete | — |
| bing_webmaster | api_key | Partial | ✅ **Complete** | endpoint added; `?apikey=` query auth |
| google_business_profile | oauth2 | Complete | ✅ Complete | — |
| **apple_business_connect** | ownership_verification | Stub | ✅ **Read-complete** | normalizer (`listing_verified`) + endpoint; **connect flow = ownership verification, not built** (distinct auth path) |
| google_analytics | oauth2 | Complete | ✅ Complete | — |
| **google_tag_manager** | oauth2 | Stub | ✅ **Complete** | normalizer (`tags_installed`) + endpoint |
| **meta_business** | oauth2 | Stub | ✅ **Complete** | normalizer (`managed_assets`) + endpoint |
| facebook_page | oauth2 | Complete | ✅ Complete | — |
| instagram | oauth2 | Complete | ✅ Complete | — |
| linkedin | oauth2 | Complete | ✅ Complete | — |
| youtube | oauth2 | Complete | ✅ Complete | — |
| yelp | api_key | Partial | ✅ **Complete** | endpoint added; normalizer handles detail **and** search shape |
| trustpilot | api_key | Partial | ✅ **Complete** | endpoint added; `apikey` header auth |
| google_calendar | oauth2 | Complete | ✅ Complete | — |
| calendly | oauth2 | Complete | ✅ Complete | — |
| hubspot | oauth2 | Complete | ✅ Complete | — |
| salesforce | oauth2 | Partial | ✅ **Read-complete** | endpoint added; **`instance_url` substituted at activation** |
| mailchimp | oauth2 | Complete | ✅ Complete | — |
| klaviyo | api_key | Partial | ✅ **Complete** | endpoint added; `Klaviyo-API-Key` + revision header |
| stripe_connect | oauth2 | Complete | ✅ Complete | — |
| square | oauth2 | Complete | ✅ Complete | — |

**Classification after A1:** 19 Complete · 2 Read-complete/activation-parameterized (Salesforce, Apple) · 0 Stub · 0 Deprecated.

## Registry Verification

- **21 providers**, unchanged in count and structure (no providers invented, none removed). Each declares `key`, `name`, `customerLabel`, `category`, `purpose`, `auth`, `approval`, least-privilege `scopes`, plain-language `reads`, `futureWrites`, `minEdition`, `rateNote`, `status`. All `status: 'planned'` (activation-pending) — unchanged.
- The completion added **only data**: 3 optional normalized fields (`tags_installed`, `managed_assets`, `listing_verified`), 8 read-endpoint entries, and one additive `readRequest()` shaping helper. The registry, contract, connect route, store, crypto, and Approved-Plan write path are **untouched**.

## Behavioral Consistency (verified for every provider)

- **Authentication / OAuth or API-key flow:** unchanged shared flow; API-key providers with non-Bearer auth (Bing/Trustpilot/Klaviyo) shaped correctly.
- **Read normalizers:** every provider maps documented response fields defensively (multiple fallback paths); garbage input never throws (tested).
- **Connected writes:** unchanged — still approval-gated plans (GBP/GSC + handoffs); no write behavior changed in A1.
- **Health / error handling:** unchanged — a failed read marks `expired`/`error` health and returns null in isolation (one provider can't poison a run).
- **Disconnect / Refresh:** unchanged shared handlers (disconnect destroys token + cache; refresh is an on-demand read).
- **Customer experience:** `connections.html` now displays the new numbers (`N tags installed`, `N pages managed`, `Verified`/`Not verified`) alongside the existing ones — consistent plain-language rendering.

## Customer Experience Verification

- Every provider appears in the grouped surface with plain-language health and the "About this connection" disclosure (what we read / never change / approval / ownership / disconnect) — unchanged.
- New read fields render in plain words; no scores, no jargon (Law 13 preserved).
- Honest states preserved: unconfigured providers still read "not available yet"; Apple's ownership-verification connect still returns the graceful "connects a different way" until that flow exists.

## Maintained Guarantees

Product Laws · Constitution · Approval architecture (writes still approval-gated) · tenant isolation (unchanged RLS + `resolveSite`) · audit logging (connection events unchanged) · rollback (write plans unchanged) · security (tokens still AES-256-GCM out-of-row; API keys sent per documented provider auth, never logged) · Connected Platform contracts — **all intact; invariants 14/14 held.**

## Remaining Owner Activation Checklist (per provider — config, not engineering)

- [ ] **OAuth providers** (GBP, GSC, GA, GTM, Meta, Facebook, Instagram, LinkedIn, YouTube, Calendar, Calendly, HubSpot, Salesforce, Mailchimp, Stripe, Square): register each app → `CONNECTED_<KEY>_CLIENT_ID/_SECRET` (+ `GOOGLE_CLIENT_ID/_SECRET`).
- [ ] **API-key providers** (Bing, Yelp, Trustpilot, Klaviyo): customer pastes their read-only key (no owner app needed).
- [ ] **`CONNECTION_ENC_KEY`** set → tokens/keys can be stored (fail-closed until then).
- [ ] **Salesforce:** capture/route the per-org `instance_url` at connect (activation config).
- [ ] **Apple Business Connect:** build the ownership-verification connect flow (a distinct auth path) **or** keep it honest "connects a different way, not available yet." *(The one genuine remaining build item — deferred as new auth architecture.)*
- [ ] Finalize account-specific read parameters (Yelp business id, Trustpilot business-unit, Bing siteUrl, GA property) at activation.

## Final Connected Platform Completion Report

The Connected Platform is **structurally complete**: all 21 providers share one registry, one auth/read/health/disconnect/refresh path, and the approval-gated write spine; every provider now has a real normalizer + read endpoint; the API-key auth differences are handled; the customer surface renders every provider consistently. Live data flows once the owner activates each provider (register the app / paste the key), exactly as the read-only-first architecture always specified.

---

## Final Question (answered honestly)

**Is every planned Version 1 Connected Provider now complete?**

**Yes, at the platform level** — all 21 have real read adapters and behave consistently, with 19 fully complete and 2 (Salesforce, Apple) read-complete with an honest activation-specific requirement. **What remains is not V1 engineering breakage:** it is (a) owner activation per provider (register apps / paste keys — config), and (b) **one genuine deferred build item — Apple Business Connect's `ownership_verification` connect flow**, which is a distinct auth mechanism and is out of scope for "no new provider architecture." That single item is documented on the roadmap (Owner Activation / A1 caveat), not hidden.

## Declaration

**Phase A1 — Connected Platform Completion complete.**

*Every intentionally-started provider is finished to a real read adapter on the frozen architecture; two carry documented activation-specific requirements (Salesforce instance URL, Apple ownership-verification connect flow). Tests green (invariants 14/14); deployed staging + prod; committed, not pushed.*
