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

| Verb | Route | Request | Success | Errors |
|---|---|---|---|---|
| POST | `/admin/restore-deploy` | `{site_id, deploy_id}` | `{ok:true}` (instant Netlify deploy restore) | 403 `forbidden`, 400 `bad_request`, 404 `not_found`, 502 `restore_failed` |

## Internal (never client-exposed)
`error_text`, `netlify_deploy_id`, `snapshot_id`, deploy state, render/validation internals — stored, operator-only. Clients receive plain-language status and the calm failure message only.

## Not in v1 (future milestones, per PPFR)
Content CRUD for offerings/testimonials/faqs/posts/location/voice (M7 room consumes them via routes to be added — additive), admin site-create/domain routes (M6/M8), AI routes (M9), GBP/destinations (M10). Adding these is additive and does not break this frozen surface.
