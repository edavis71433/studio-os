# Presence API Inventory — v1 FROZEN (M5)

**Frozen 2026-07-06 at end of M5.** This is the surface the mobile app and future
clients consume. **Any change requires explicit approval** (Constitution / M3.75
§2 governance): additive-only in a minor (new route, new optional field, new
optional param with a safe default); renames, removals, type/semantic/auth/
error-shape changes are majors requiring a shipped-binary compatibility review.

## Conventions (frozen)
- **Base:** `POST/GET/PUT/DELETE {SUPABASE_URL}/functions/v1/presence/<route>`
- **Auth:** caller JWT in header `x-dds-user-jwt` (identical to clever-api; no new pattern). `Authorization: Bearer <anon>` also sent by the platform.
- **Response envelope:** success `{ "data": ... }`; error `{ "error": "<code>", "message": "<plain language>" , ...optional }`. Never a stack trace, never an internal identifier.
- **Boundary order (every request):** CORS → resolvePrincipal (`_shared`) → [admin routes] → resolve caller site (RLS) → entitlement gate → router.
- **Entitlement:** `active`→full · `paused`→reads ok, writes 403 `entitlement_paused` · `lapsed`/none→403 `entitlement_inactive` · staff→bypass.

## Client routes (auth + entitlement)

| Verb | Route | Request | Success `data` | Errors |
|---|---|---|---|---|
| GET | `/site` | — | `{site, identity, location, voice, counts, last_published_at, has_unpublished_changes}` | 401, 404 `no_site`, 403 entitlement |
| GET | `/identity` | — | identity singleton or `null` | 401/403/404, 502 `read_failed` |
| PUT | `/identity` | identity fields (closed set; unknown keys rejected) | saved identity row | 400 `bad_json`/`empty_update`, 422 `validation_failed` (+`fields[]`), 403 `entitlement_paused`, 502 `write_failed` |
| GET | `/preview?page=/path/` | — | **`text/html` document** (`no-store`; headers `X-Presence-Draft-Blockers`, `X-Presence-Draft-Warnings`) | 401/403/404, 404 `page_not_found`, 500 `template_missing` |
| POST | `/publish` | — | `{status:'live'|'publishing', message, summary}` | 422 `validation_failed` (+`fields[]`,`warnings[]`), 409 `publish_in_progress`, 403 `entitlement_paused`, 502 `publish_failed` (calm) |
| POST | `/restore` | `{publish_id}` | `{status, message, summary}` | 400 `bad_request`, 404 `not_found`, 410 `not_restorable`, 409, 403, 502 |
| GET | `/publishes` | — | `[{id, kind, status:'live'|'publishing'|'failed', summary, at, completed_at, restorable}]` (reconciles pending) | 401/403/404 |
| POST | `/media/upload-url` | `{mime, bytes, alt_text, width?, height?}` | `{media_id, upload_url, storage_path}` | 422 `unsupported_type`/`too_large`/`alt_required`/`media_cap`, 400 |
| DELETE | `/media/:id` | — | `{ok:true}` | 400 `bad_request`, 409 `in_use` (names blockers), 403 |

## Admin routes (staff role; entitlement bypass; before site resolution)

Added in M6 (additive — does not alter the frozen client surface). Operator
views MAY include `error_text` and deploy ids; raw Netlify responses are never
passed through. Non-staff callers get 403 on every `/admin/*` route.

| Verb | Route | Request | Success `data` | Errors |
|---|---|---|---|---|
| POST | `/admin/sites` | `{client_id, template_slug?, template_version?, entitlement_status?}` | `{site_id, status, template, netlify_site_id, netlify_url, already_existed}` (201 created / 200 idempotent rerun; rerun also REPAIRS lost hosting) | 400, 404 `not_found`, 409 `conflict` (deleting), 502 `provision_failed`/`hosting_unconfigured` |
| GET | `/admin/sites` | — | `[{id, client, client_email, status, template, custom_domain, netlify_site_id, last_published_at, created_at}]` | — |
| GET | `/admin/sites/:id` | — | full site row | 404 |
| GET | `/admin/sites/:id/health` | — | `{site, hosting{connected,url,state|message}, domain, publishing{in_flight,last_publish,last_successful_publish,last_error,last_published_at}, content{template,contract,draft blockers/warnings}, media{count,missing[]}}` | 404 |
| POST | `/admin/sites/:id/domain` | `{domain}` | domain status `{custom_domain, health: no_domain|dns_pending|ssl_pending|ok, message, netlify_subdomain, dns, ssl}` | 400, 409 `not_provisioned`, 502 `domain_failed` |
| GET | `/admin/sites/:id/domain` | — | domain status (same shape) | 404 |
| DELETE | `/admin/sites/:id/domain` | — | `{ok, message}` | 404, 502 |
| POST | `/admin/sites/:id/lifecycle` | `{to}` | `{status, previous}` (`deleting` also tears down hosting; data retained) | 400, 409 `invalid_transition` (+`allowed[]`), 502 |
| GET | `/admin/sites/:id/deploys` | — | `[{id, state, created_at, published_at, title}]` | 409 `not_provisioned`, 502 |
| GET | `/admin/sites/:id/publishes` | — | operator records incl. `error_text`, `netlify_deploy_id`, `duration_seconds` | 404 |
| POST | `/admin/sites/:id/publish` | — | force publish (same ONE pipeline; validation enforced; works on paused sites) | 422, 409 `lifecycle_blocked`/`publish_in_progress`, 502 |
| POST | `/admin/sites/:id/retry` | `{publish_id?}` | re-runs the failed publish's retained snapshot | 404, 410 `not_restorable`, 409, 502 |
| POST | `/admin/sites/:id/cancel` | — | `{ok, canceled}` (queued only; deploying completes/fails atomically) | 409 `nothing_queued` |
| POST | `/admin/sites/:id/restore-snapshot` | `{snapshot_id}` | operator snapshot restore (same pipeline, kind=restore) | 400, 404, 409, 502 |
| POST | `/admin/restore-deploy` | `{site_id, deploy_id}` | `{ok:true}` (instant Netlify deploy restore) | 403 `forbidden`, 400 `bad_request`, 404 `not_found`, 502 `restore_failed` |

**Site lifecycle (0018):** `draft → provisioning → ready → live ⇄ paused → archived → deleting`; publishes additionally allow status `canceled`.

## Internal (never client-exposed)
`error_text`, `netlify_deploy_id`, `snapshot_id`, deploy state, render/validation internals — stored, operator-only. Clients receive plain-language status and the calm failure message only.

## Not in v1 (future milestones, per PPFR)
Content CRUD for offerings/testimonials/faqs/posts/location/voice (M7 room consumes them via routes to be added — additive), admin site-create/domain routes (M6/M8), AI routes (M9), GBP/destinations (M10). Adding these is additive and does not break this frozen surface.
