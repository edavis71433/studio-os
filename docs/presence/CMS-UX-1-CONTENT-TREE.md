# CMS-UX-1 — Client Content Tree

**Status:** backend complete + tested (staging deploy + Client-App frontend pending). A read-only projection that gives a non-technical owner a calm map of their website — which pages exist, which sections are on each, what's complete/missing/changed/live, and where to click to edit.

## Architecture — a pure projection, no new stores
The tree is a **derivation over the existing authoritative model**, not a second copy. One editor, one renderer, one publish pipeline, one content model — all unchanged.

- **`lib/content_tree.ts`** — the pure adapter `buildContentTree(input) → ContentTree`. Same inputs → same output. No I/O, no rendering, no persistence. The **Website Navigator (later milestone) reuses this same adapter** — do not fork it.
- **`routes/room.ts` → `handleContentTree(site, cors)`** — the read-only route. One bounded batch: the same `serializeDraft` / last-live-snapshot / `validateSnapshot` / `describeChanges` reads the room already makes, plus **one** scheduled-publish probe. Feeds the adapter, returns the client-safe shape.
- **`index.ts`** — `GET /content-tree` dispatched in the authed, tenant-resolved section (mirrors `/changes`, `/health`).

## Reused systems (nothing rebuilt)
| Concern | Reused from |
|---|---|
| Pages | `manifest.pages: {path, kind}` via `getTemplate()` (`lib/render.ts`) |
| Section catalogue | the content entities (`identity`/`offerings`/`testimonials`/`faqs`/`posts`) + home `SiteBlock`s |
| Labels | `vocabFor(settings.industry)` (`lib/industry_vocab.ts`) — "Menu"/"Services"/"Products"/"Classes"… |
| Draft | the ONE serializer `serializeDraft` (`lib/serializer.ts`) |
| Live | latest `status='live'` publish → `presence_snapshots.content` |
| Validation | `validateSnapshot()` (`lib/manifest_validate.ts`) blockers/warnings by field path |
| Change detection | `describeChanges()` (`lib/diff.ts`) grouped by section |
| Publish state | `presence_publishes` (live/failed) + `presence_scheduled_publishes` (pending) |
| Deep links | the existing editor hash contract `/presence.html#<tab>` |

No new table, no migration, no new editor/renderer/pipeline.

## Status derivation (deterministic + explainable)
Per section, computed from the signals above, with a documented priority (lowest rank wins):
`publish_failed` → `missing_required` → `needs_review` → `draft_changes` → `scheduled` → `published` → `complete` → `empty_optional`.
A page's status is the worst of its sections. Field paths map to sections by prefix (`identity.*`→business, `location.*`→contact, `offerings.*`→offerings, `faqs`→questions, `posts.*`→updates); change sections map 1:1. All status labels are plain-language (`STATUS_LABEL`), never the enum key.

## Deep-link contract
Rows link into the existing editor via its hash contract: `/presence.html#{business|offerings|faqs|testimonials|updates|design}`. Unknown/removed areas fall back safely (skipped; the page still renders as an "automatic" row). No new editor, no per-entity anchor invented (finer deep-linking is a Navigator concern).

## Security / tenant isolation
- The route runs after site resolution — `site` is already scoped to the caller (RLS under the caller's JWT; agency drill-in via `x-dds-scope-site` → `resolveScopedSite`, fail-closed). Every DB read is hand-scoped `site_id=eq.${site.id}`.
- **No client-supplied site id is trusted.** The projection carries only presentation-safe data — **no DB id, block id, field path, manifest key, or JSON leaks** (asserted by test #14).
- Read-only + Monitor-safe: the tree shows edit links, but the editor itself enforces edition/role; the projection reveals nothing an owner can't already see.

## Files
- `supabase/functions/presence/lib/content_tree.ts` (new — the adapter)
- `supabase/functions/presence/routes/room.ts` (added `handleContentTree` + import)
- `supabase/functions/presence/index.ts` (registered `GET /content-tree`)
- `tests/presence/content_tree_test.mjs` (new — 33 assertions)

## Tests
- **`content_tree_test.mjs` — 33/33 pass.** Covers: tree generation, required/optional, template change, industry vocab (Menu/Services/Products), draft/live change, missing-required, needs-review, published, scheduled, publish-failed, **status priority**, deep-links, unknown-kind fallback, **client-safe shape**, empty state, attention rollup.
- **Regression: 12/12 green** (`deno run -A`): platform_invariants **14/14**, draft_hash, optimistic_lock, publish_guard 21/21, render, site_blocks 38/38, registry, nav_integrity, editions 36/36, feature_boundary, business_classic + content_tree.
- **Typecheck clean** across the whole `presence` function.

## Deployment
- Additive only — **no migration**. Rollback = revert the commit (route disappears; nothing else touched).
- **Pending:** deploy the `presence` edge function to staging → smoke-test `GET /content-tree` → prod deploy per policy. Static Client-App view stays behind the push fence.

## Remaining owner / live QA
- Deploy backend to staging + run the live tenant-isolation test (`tenant_isolation_test.mjs`) to prove Tenant A cannot read Tenant B's tree.
- Build the **Client-App frontend view** (accessible nested-list tree + deep-links) — behind the fence.
- Human browser/mobile/AT pass on the rendered tree.

## Readiness for Website Navigator
The adapter is intentionally shaped so the Navigator reuses it (same projection + status model). **Do not begin the Navigator** — CMS-UX-1 is scoped to the read-only tree only.
