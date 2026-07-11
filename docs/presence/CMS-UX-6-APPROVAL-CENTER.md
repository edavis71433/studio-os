# CMS-UX-6 — Approval Center

**Status:** backend complete + tested + deployed to staging; Client-App page built (fenced). The single place a customer answers *"What am I waiting to approve?"* — where they review and approve work before it goes live. Not project management, not an activity feed, not another notification center.

Completes another customer-story pillar: Content Tree (what exists) · Timeline (what happened) · Attention Center (what needs attention) · Website Health (is it healthy) · Upcoming Changes (what's next) · **Approval Center (what needs my approval)**.

## Architecture — a projection over existing approval state
Same pattern as CMS-UX-1–5: a pure adapter + a thin gathering route. **No new approval system, no duplicated workflow.** Each card links to the existing surface where the approval actually happens (reusing existing customer actions — the decide logic is not forked).

- **`lib/approval_center.ts`** — pure `buildApprovalCenter(input) → ApprovalCenter`. Groups approvals and applies one shared, plain-language copy block per kind (what / why / if-approved / if-wait). Reuses `whenWord` (future) and `humanWhen` (past).
- **`routes/approvals_page.ts` → `handleApprovalCenter(site, cors)`** — gathers the existing approval rows (own site + bridge) and calls the adapter.
- **`index.ts`** — `GET /approval-center` in the authed, tenant-resolved section.

## Capability inventory + preservation matrix
Every card is backed by a real pending or decided row.

| Approval | Existing source | Reuse strategy | Group |
|---|---|---|---|
| Website update ready (self-publish) | Content Tree `has_unpublished_changes` + no blockers | reuse `siteContentTree` | Ready now |
| Website / infrastructure change | `presence_infra_plans` (proposed) | reuse (same as portal feed / attention) | Waiting on you |
| Connected-service write | `presence_connection_writes` (proposed) | reuse | Waiting on you |
| File replacement | `presence_media` (`pending`, `pending_replace`) | reuse | Waiting on you |
| Studio deliverable / agreement / proposal | `presence_approvals` (pending, client-visible, via bridge) — `subject_type` → delivery/agreement/proposal | reuse `linksForCustomer`; client-visible only | Waiting on you |
| Scheduled publish (already approved) | `presence_scheduled_publishes` (pending) | reuse | Scheduled |
| Recently approved | `presence_approvals` (approved, client-visible, `decided_at`) | reuse | Recently approved |
| Relative dates | `whenWord` / `humanWhen` | reuse | — |

**Honesty Rule:** only real rows are shown — no fabricated approvals, no estimated dates, no invented workflow. Proposals/contracts are **not a separate invented source** — they are `presence_approvals` rows (`subject_type` `project`/`custom`) the studio already creates, surfaced with friendly wording. Same evidence standard as Timeline / Health / Upcoming / Attention.

## Card model — what a customer needs to decide
Each waiting card answers all four, in business language:
- **What is this?** → `title` (the studio's own title, else a plain default)
- **Why am I seeing it?** → `why` (the studio's summary, else a per-kind default)
- **What happens if I approve?** → `if_approved`
- **What happens if I wait?** → `if_wait`
- **One obvious action** → `action_label` + `action_href` (links to the existing approve surface: Foundations / Connections / Files / the Client delivery view / Publish)

Scheduled cards show they're *already approved* (only an "if you wait" note + a View action). Recently-approved cards are reassurance only (no action).

## Customer language
`Pending Publish` → "Website update ready" · `Awaiting Content Approval` → "Review these changes" · `Pending Contract` → "Agreement ready to review" · `Proposal Status` → "Project proposal ready". No technical terms, ids, or internal states reach the screen.

## Organization
**Ready now** (your own update to publish) · **Waiting on you** (prepared for your OK) · **Scheduled** (already approved, going live on a date) · **Recently approved** (reassurance, capped at 5). Only groups with evidence are shown — no empty categories.

## Security / tenant isolation
Runs after site resolution (`site` scoped to caller; agency drill-in via `resolveScopedSite`). Own-site reads hand-scoped `site_id=eq.${site.id}`; bridge reads reuse `linksForCustomer(site.client_id)` filtered to `client_visible=is.true` on the agency site — the P2-D isolation gate. Best-effort bridge block. Client-safe output only — no ids, table names, `subject_type`, or internal kinds (asserted by test #9).

## Accessibility
Keyboard-complete, screen-reader friendly, reduced-motion aware, visible focus. Each card carries a text status word / relative-time badge (not colour); the "If you approve / If you wait" outcomes are labelled text rows.

## Files
- `supabase/functions/presence/lib/approval_center.ts` (new — pure adapter)
- `supabase/functions/presence/routes/approvals_page.ts` (new — gathering route)
- `supabase/functions/presence/index.ts` (registered `GET /approval-center`)
- `tests/presence/approval_center_test.mjs` (new — 36 assertions)
- `approval-center.html` (new — the Client-App page, fenced) + `today.html` doorway

## Validation evidence
- **`approval_center_test.mjs` — 36/36 pass**: all-clear, self-approval Ready-now, the what/why/if-approved/if-wait shape, kind→copy + studio-title override, scheduled = already-approved (not pending), recently-approved cap/order, group ordering, headline/counts, **client-safe shape**.
- **Regression: 146/146 pure + structural pass** (invariants 14/14; CMS-UX-1–5 all green). 6 skipped suites are creds-gated live tests.
- **Typecheck clean** across the whole `presence` function.
- **Deployed to staging**; `GET /approval-center` returns **401 auth-gated** unauthenticated (route live, not 404).

## Remaining owner-only checks
- Authed **cross-tenant live test** on staging (owner-held `SALES_E2E_*` two-tenant creds) — proves Tenant A can't read Tenant B's approvals and bridged approvals are client-visible only.
- Human **browser/mobile/AT pass** on the rendered page.
- Prod deploy of the function (additive read-only route; the customer page stays behind the push fence).

## Note — read-only by design
The Approval Center is a unified **view** of everything awaiting approval; each action links to the existing surface that already owns the approve/reject flow (no forked decide logic, no new POST paths). Inline one-tap approve is a possible future enhancement once the Workspace Home consolidation begins.

## Future direction (noted, not built)
Built as one section of the future **Workspace Home**. Today was **not** redesigned; Workspace Home is **not** started.

## Boundaries respected
Stopped at CMS-UX-6. Did **not** begin CMS-UX-7.
