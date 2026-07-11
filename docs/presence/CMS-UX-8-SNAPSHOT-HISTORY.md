# CMS-UX-8 — Snapshot History

**Status:** backend complete + tested + deployed to staging; Client-App page built (fenced). A customer-friendly history answering *"What versions of my website exist?"* — like flipping through previous editions, not browsing technical deployments. Not Git, not version control, not deployment history.

Completes another pillar: … Business Insights ("what should I know") · **Snapshot History ("which versions can I revisit or restore")**.

## Architecture — a re-framing of existing version history
Same pattern as CMS-UX-1–7: a pure adapter + a thin route. **No new snapshot system, no forked restore/preview logic.**

- **`lib/snapshot_history.ts`** — pure `buildSnapshotHistory(input) → SnapshotHistory`. Re-frames the platform's publish/version rows as saved website versions grouped Current / Previous / Restored. Reuses `humanWhen` for dates.
- **`routes/history_page.ts` → `handleSnapshotHistory(site, cors)`** — calls `publishHistoryRows` (the shared row-builder) and feeds the adapter.
- **`index.ts`** — `GET /snapshot-history` in the authed, tenant-resolved section.

## Capability inventory + preservation matrix
Every version is a real published row; every name is real.

| Version detail | Existing source | Reuse strategy |
|---|---|---|
| The version list + status | `presence_publishes` (live) via `publishHistoryRows` | **extracted** from `handlePublishHistory` so `/publishes` and Snapshot History share ONE builder (incl. `reconcileSitePublishes`) |
| Version name | `presence_publishes.version_label` (the customer's own name) | reuse; else the existing summary; else the date |
| What changed | `presence_publishes.change_summary` (with the existing customer-facing fallback) | reuse verbatim |
| Published when | `created_at` / `completed_at` | reuse + `humanWhen` |
| Publish vs restore | `presence_publishes.kind` (`publish` / `restore`) | drives the Previous vs Restored grouping |
| Restorable? | `!!snapshot_id && status='live'` (the existing flag) | reuse |
| Preview / restore actions | the existing editor version-history surface (`/presence.html#history`) + `POST /restore` | link to it — no forked flow |

The existing `GET /publishes` response is **byte-for-byte unchanged** (the extracted builder is wrapped and `snapshot_id` is stripped back out).

## Honesty Rule
- **Names are never invented.** A version's name is the customer's own `version_label`; failing that, the existing customer-facing summary; failing that, the publish date ("Version from July 1, 2026"). No fabricated themed names ("Spring Update" only appears if the customer typed it).
- **Only live versions are shown** — failed or in-flight publishes aren't "versions you can revisit," so they're excluded.
- **What-changed is the existing summary**, shown only when it adds something beyond the name (no duplication, no estimation).
- **No "Draft Snapshots" category** — the platform doesn't persist a customer-restorable draft-snapshot stream, so that category is omitted rather than invented.

## Customer language
`Snapshot 42` → the version's name/date · `Deployment` → "Published version" · `Rollback` → "Restore this version" · `Immutable snapshot` → "Saved version". The current live version is badged "Live now".

## Categories
Current website · Previous versions · Restored versions — only non-empty groups appear. Each version card answers: what changed · when published · why this version exists · can I preview · can I restore.

## Security / tenant isolation
Runs after site resolution (`site` scoped to caller; agency drill-in via `resolveScopedSite`); `publishHistoryRows` reads `presence_publishes?site_id=eq.${site.id}` only. Client-safe output — no publish ids, snapshot ids, table names, or raw statuses (asserted by test #11); preview/restore route to the existing surface (no ids needed).

## Accessibility
Keyboard-complete, screen-reader friendly, reduced-motion aware, visible focus. The "Live now" state is a text badge (not colour); actions are labelled links; version icons are decorative (`aria-hidden`).

## Files
- `supabase/functions/presence/lib/snapshot_history.ts` (new — pure adapter)
- `supabase/functions/presence/routes/history_page.ts` (new — route)
- `supabase/functions/presence/routes/publish.ts` (extracted `publishHistoryRows`; `/publishes` response preserved exactly)
- `supabase/functions/presence/index.ts` (registered `GET /snapshot-history`)
- `tests/presence/snapshot_history_test.mjs` (new — 30 assertions)
- `snapshot-history.html` (new — the Client-App page, fenced) + `today.html` doorway

## Validation evidence
- **`snapshot_history_test.mjs` — 30/30 pass**: Current/Previous/Restored grouping, name fallback (label → summary → date, never invented), current-not-restorable / previewable, restore-kind routing, live-only filtering, order, dates, empty state, **client-safe shape**.
- **Regression: 148/148 pure + structural pass** (invariants 14/14; **publish_guard 21/21** confirms the publish.ts extraction is safe; CMS-UX-1–7 all green). 6 skipped suites are creds-gated live tests.
- **Typecheck clean** across the whole `presence` function.
- **Deployed to staging**; `GET /snapshot-history` returns **401 auth-gated**; `GET /publishes` still **401** (unchanged, not broken).

## Remaining owner-only checks
- Authed **cross-tenant live test** on staging (owner-held `SALES_E2E_*` two-tenant creds) — proves Tenant A can't read Tenant B's versions.
- Human **browser/mobile/AT pass**, including confirming Preview/Restore land on the editor version-history surface correctly.
- Prod deploy of the function (additive read-only route; the customer page stays behind the push fence).

## Future direction (noted, not built)
Built as one section of the future **Workspace Home**. Today was **not** redesigned; navigation **not** consolidated; the refinement overhaul **not** begun.

## Boundaries respected
Stopped at CMS-UX-8. Did **not** begin CMS-UX-9.
