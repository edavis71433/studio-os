# API Reference — Studio OS Presence (Version 1, current)

The complete route surface of the `presence` edge function as of V1. Supersedes `API-INVENTORY-v1-FROZEN.md` (which froze the M5 subset). Grounded in `supabase/functions/presence/index.ts`.

## Conventions

- **Base:** `{METHOD} {SUPABASE_URL}/functions/v1/presence/<route>`
- **Auth headers:** `Authorization: Bearer <anon key>` (always) + `x-dds-user-jwt: <caller session token>` (for authed routes).
- **Envelope:** success `{ "data": ... }`; error `{ "error": "<code>", "message": "<plain language>", ...optional }`. Never a stack trace or internal id.
- **Boundary order (every request):** CORS → `resolvePrincipal` (→ `staff` | `client` | `system` | `public`) → public/operator routes → `resolveSite(jwt)` (RLS → tenant isolation) → entitlement gate → router.
- **Principal kinds:** `staff` (operator, entitlement-bypass), `client` (customer, owns one site), `system` (scheduler — requires `SCHEDULER_SECRET` in body), `public` (unauthenticated / service-role default).
- **Entitlement:** `active` → full · `paused` → reads OK, writes 403 `entitlement_paused` · `lapsed`/none → 403 `entitlement_inactive` · `staff` → bypass.
- **API governance:** additive-only in a minor (new route / optional field / optional param with safe default). Renames, removals, type/semantic/auth/error changes are majors requiring a compatibility review (the mobile app and future clients consume this).

---

## Customer routes (auth + entitlement; act on the caller's own site)

**Content / CMS**
- `GET|PUT /identity` · `GET|PUT /location` · `GET|PUT /voice` · `GET|PUT /settings` — the structured-content singletons.
- `GET|POST|PUT|DELETE /<collection>` — collection entities (offerings, faqs, posts, testimonials…) via the `SPECS`-driven matcher.
- `GET /site` — site + identity + location + voice + counts + publish state.
- `GET /changes` — the change ledger (provenance).

**Preview & Publishing**
- `GET /preview?page=/path/` — rendered draft HTML (`no-store`; draft-blocker/warning headers).
- `POST /publish` — draft → live (validated, atomic deploy, versioned).
- `GET /publishes` — publish history (reconciles pending).
- `POST /restore` — restore a prior published version.
- `POST /restore-to-draft` — pull a published version back to draft.

**Media & Visual Studio**
- `POST /media/upload-url` — signed upload + media row (alt text required).
- `DELETE /media/:id` — delete (refused while referenced).
- `GET /visual/kinds` — asset kinds + honesty promises + availability.
- `POST /visual/generate` — `{kind, subject, count?, palette?}` → proposed plan + brand-aware variations.
- `GET /visual/plans` · `GET /visual/plans/:id` — generations (with signed previews).
- `POST /visual/plans/:id/vary` · `/edit` · `/decide` — more variations / instruction-guided edit / approve→store or abandon.

**Intelligence surfaces**
- `GET /moments` · `POST /moments/:id/dismiss` — the daily Business Moments.
- `POST /concierge/ask` — grounded Q&A.
- `GET /coach/opportunities` · `POST /coach/run` — Growth Coach.

**Creative Studio (AI, gated by edition + capacity)**
- `POST /writer/generate` · `GET /writer/drafts` — Writer (fact-guarded; 403 `plan_upgrade_required` on Monitor).
- `POST /editor/improve` — Editor.
- `POST /review/run` · `GET /review/reports` — Reviewer.
- `POST /brand/review` · `GET /brand/reports` · `GET|PUT /brand/profile` — Brand Guardian + brand profile.

**Connected Platform**
- `GET /connections` — the surface (grouped services + state + numbers).
- `GET /connections/:key` — one provider profile.
- `POST /connections/:key/connect` — OAuth URL or store a read-only key.
- `POST /connections/:key/callback` — finish OAuth (signed state verified).
- `POST /connections/:key/refresh` — on-demand read.
- `POST /connections/:key/disconnect` — revoke + destroy.
- `POST /connections/:key/write/{prepare|<id>/decide|<id>/execute|<id>/rollback}` · `GET /connections/:key/write` — approval-gated write plans.

**Knowledge, Monitor, Foundations, Launch, Export**
- `POST /knowledge/import` · `GET /knowledge/docs` · `DELETE /knowledge/docs/:id`.
- `GET|DELETE /monitor/connection` · `POST /monitor/connect|verify|import-inventory` · `GET /monitor/readiness`.
- `GET /foundations` · `GET /foundations/plans` · `POST /foundations/prepare` · `POST /foundations/plans/:id/decide` · `/foundations/dns` · `/foundations/dns/rollback` · `/foundations/email` — infrastructure plans (Approved-Plan spine).
- `GET /launch` — the Launch Assistant checklist.
- `GET /export` — the ownership/export right (download everything).
- `GET /health` · `GET /notes`.

**Commerce (some public — see below)**
- `GET /commerce/plans` (public) · signup/checkout/subscription/first-run/notices — see [COMMERCE](COMMERCE.md). `GET /commerce/notices` · `POST /commerce/notices/dismiss` (capacity notice).

---

## Operator / advanced-tier routes (gated `staff || system`, before the client-site gate; operators own no site)

- **Admin/Ops:** `/admin/*` (operator inventory, ops), `/system/*` (scheduler cron endpoints — require `SCHEDULER_SECRET` in body).
- **Marketplace:** `GET /marketplace` (list) · `GET /marketplace/audit` · `POST /marketplace/:key/prepare` · `POST /marketplace/operations/:id/{decide|execute|rollback}`. (`GET /marketplace/features` is the *customer* view, handled with a site.)
- **Enterprise:** `POST /enterprise/operations/:id/{decide|execute|rollback}` · `GET /enterprise/:org/locations/:loc/config` · org/region/location management. See [ENTERPRISE](ENTERPRISE.md).
- **Agency:** `/agency/*` — organizations, portfolio, rollups, approvals, rollouts. Portfolio-scoped (403 `forbidden` outside your portfolio). See [AGENCY-PLATFORM](AGENCY-PLATFORM.md).

---

## Common error codes

`bad_json` / `bad_request` (400) · `validation_failed` (422, +`fields[]`) · `unauthorized` (401) · `forbidden` / `entitlement_paused` / `entitlement_inactive` / `plan_upgrade_required` (403) · `not_found` (404) · `not_restorable` (410) · `publish_in_progress` / `in_progress` / `not_approved` (409) · `not_available` (503, honest capability gate) · `read_failed` / `write_failed` / `publish_failed` (502, calm). Every message is plain language.

## Maintaining this reference

When you add or change a route in `index.ts`, update this file in the same change. The invariant that the envelope and boundary order never change is enforced by the integration suites (room/service/admin/pipeline) — keep them green.
