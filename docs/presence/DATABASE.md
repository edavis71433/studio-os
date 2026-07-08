# Database Reference — Studio OS Presence

Postgres via Supabase. **Every `presence_*` table is deny-all RLS** (no permissive policies) and is reached only through the edge function using the service role (`svc`) or an RLS-scoped caller token (`asUser`). A customer never touches the database directly.

## The RLS model (the security spine)

- **Deny-all + function-mediated.** Tables have RLS enabled with **no policies**, so direct client access returns nothing; all access is through the `presence` function, which resolves the caller's site via RLS (`resolveSite`) and scopes every query to `site_id`/`client_id`. This is tenant isolation — see [SECURITY](SECURITY.md).
- **Sensitive material is out-of-row and encrypted.** Provider tokens live in `presence_connection_secrets` (AES-256-GCM ciphertext, never returned to a client); the connection row holds only a `secret_ref`.
- **Audit ledgers are append-only** (`presence_change_events`, `presence_connection_events`) — trigger-protected; invariant INV-7 enforces their existence.
- **Approval is a DB law.** Every plan table carries `requires_approval boolean not null default true check (requires_approval = true)`.

## Tables by subsystem (54)

**Core content (source of truth):** `presence_sites`, `presence_identity`, `presence_locations`, `presence_offerings`, `presence_faqs`, `presence_posts`, `presence_testimonials`, `presence_voice`, `presence_settings`, `presence_media`, `presence_redirects`.
**Publishing:** `presence_publishes`, `presence_snapshots`, `presence_change_events` (audit), `presence_notes`, `presence_first_run`.
**Intelligence pipeline:** `presence_evidence`, `presence_evidence_runs`, `presence_judgments`, `presence_recommendations`, `presence_moments`.
**Creative/AI:** `presence_ai_drafts`, `presence_ai_reviews`, `presence_brand_profile`, `presence_brand_reports`, `presence_knowledge_docs`, `presence_growth_opportunities`.
**AI operations:** `presence_ai_usage` (monthly rollup), `presence_ai_usage_events` (append-only detail), `presence_scheduled_runs`.
**Visual Studio:** `presence_visual_plans` (approval-gated generations; drafts promoted to `presence_media` on approval).
**Connected Platform:** `presence_connections`, `presence_connection_secrets` (encrypted, out-of-row), `presence_connected_data` (normalized read cache, one-deep + `prev`), `presence_connection_events` (audit), `presence_connection_writes` (write plans).
**Industry/Marketplace:** `presence_pack_installs`, `presence_pack_operations`.
**Enterprise:** `presence_organizations`, `presence_regions`, `presence_org_config` (diffs only), `presence_org_operations`.
**Agency:** `presence_agencies`, `presence_agency_members`, `presence_agency_clients`, `presence_agency_jobs`.
**Platform Services (infra):** `presence_infra_plans`, `presence_dns_zones`, `presence_dns_zone_history`, `presence_zone_snapshots`, `presence_monitor_connections`.
**Commerce:** `presence_signups`, `presence_entitlements`, `presence_plan_notices`.

## Key relationships

- `presence_sites.client_id` → the Studio OS client; **one site per client** (DB-enforced). Optional `org_id`/`region_id` link a site into an Enterprise hierarchy.
- Content entities → `site_id`. Media referenced by `offerings.media_id`, `posts.hero_media_id` (delete is refused while referenced).
- Pipeline tables → `site_id`; each stage row traces to the prior (evidence → judgment → recommendation → moment).
- Plan tables (`*_plans`, `*_writes`, `*_operations`) carry `status` + a claim-timestamp column for the atomic single-winner execution claim.

## Migration reference

- **45 migrations, `0000`–`0044`**, in `supabase/migrations/`. `0000` is the baseline (pre-Presence Studio OS + tenancy); Presence tables begin at `0015`.
- **Fenced:** `0003`–`0005` are **never applied** (superseded tenancy migrations).
- **Applying a migration** uses the **hold-back technique** (remote history tracks a subset) — see [DEPLOYMENT-AND-OPERATIONS § Migrations](DEPLOYMENT-AND-OPERATIONS.md#applying-a-migration-the-hold-back-technique). Recent Presence migrations: 0038–0041 Connected, 0042 Marketplace, 0043 Enterprise, **0044 Visual Studio**.
- Each migration file ends with a `-- rollback:` comment giving the inverse.

## Maintaining the schema

Add a table/column via a new numbered migration (deny-all RLS, `updated_at` trigger, a `rollback` comment). Never edit an applied migration. Keep this doc's table list in sync. Extend, don't mutate — the pipeline and spine tables are frozen shapes.
