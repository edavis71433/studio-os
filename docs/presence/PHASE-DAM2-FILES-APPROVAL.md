# Phase DAM-2 — Files Approval & Publishing Workflow

*Approval before publish for any file that affects the live site — reusing the existing `asset_status` lifecycle, the one approval feed (Inbox/Today), the reviewer surface, `writeChangeEvent` audit, the agency portfolio, and the publish pipeline. No second workflow, notification, or audit log.*

## The model — "staged replace" (why it's safe)
Discovery proved the serializer does **not** gate on `asset_status`, so a pending asset *would* go live if referenced. Rather than mutate the frozen render path, DAM-2 stages the change **before** it's referenced:

**Draft → Pending → Approved → Live**, via a replace:
- Under an approval policy, replacing an **in-use** file does **not** repoint live references. The old (approved) version **stays live**; the new one waits as `asset_status='pending'` (`metadata.pending_replace`, `submitted_by/at`).
- **Approve** repoints references old→new (so the approved version goes live on the next publish), retires the old as a prior version, and stamps `approved_by/approved_at`.
- **Reject** discards the proposed file (archived) and leaves the old version untouched and live.

Because an unapproved file is never referenced by live content, the publish pipeline and serializer are **completely untouched** — no duplicate publishing path, and the live site can never show an unapproved file.

## Which operations require approval (Step 2 — don't over-approve)
`replaceNeedsApproval(policy, inUse, submitRequested)` (pure): approval is required **only for an in-use file** (one that affects the live site — logo, hero, a referenced PDF/menu/brochure). Never for unused/private/temporary files. By edition policy (reused `assetApprovalPolicy`): **enterprise → required**, **agency → optional** (owner may submit), **solo owner → immediate** (they are the approver). An unused file, an alt-text edit, or an internal document never triggers approval.

## Reuse map (zero duplicate systems)
| Concern | Reused |
|---|---|
| Approval state | `presence_media.asset_status` (draft/pending/approved/published/archived) — no new table |
| Who/when approved | `metadata` jsonb (`approved_by/at`, `submitted_by/at`) — no new columns |
| Inbox + Today | the ONE `pending_approvals` feed in `handlePortalFeed` — a `kind:'file'` item linking to `/files.html?focus=…` |
| Shell bell badge | `attention_count` in `handlePortalContext` (parallel count added) |
| Reviewer approval | `reviewerAllowed` + `/assets/:id/status` (action-restricted to approve/reject in the handler) |
| Audit | `writeChangeEvent(entityType:'media')` — the existing append-only ledger |
| Agency | `gather`+`buildPortfolio` gains `files_pending` folded into the one `attention` number |
| Publish / rollback / versions | unchanged — approve repoints, the existing pipeline publishes |

## Files experience (Step 5)
- Tile badge: **Pending** (amber) on files awaiting approval.
- Detail panel: a state badge (**Live / Pending / Approved / Draft**), *who submitted / who approved & when*, and — for an approver — **Approve** / **Ask for changes** controls inline. A staged replace toasts *"Sent for approval — it goes live once approved."*

## Final CTO review — answered honestly
1. **Does Files now feel complete?** Yes — upload, organize, replace-safely, version, **and** approve-before-live, all in one calm surface.
2. **Did we duplicate approvals?** No — it *is* the existing approval spine (`asset_status` + the one feed + `writeChangeEvent`).
3. **Does this strengthen trust?** Yes — a client/reviewer's OK is required before a logo or hero changes on the live site.
4. **Would agencies use it?** Yes — the portfolio's `attention` now includes files waiting, and the client reviewer approves in the same place they approve everything else.
5. **Would business owners understand it?** Yes — "Pending" badge, "Waiting for approval," "Approve / Ask for changes." No jargon.
6. **Does it reduce mistakes?** Yes — an in-use logo/hero/PDF can't silently go live without a yes.
7. **Measurable customer value?** Yes — fewer wrong-file-live incidents; a real audit of who approved what.
8. **Would I ship this?** Yes.
9. **Would I trust it for my own business?** Yes — the lifecycle is proven against a real database (10/10 live).

## Standing gap-check (Files audit)
- Duplicated workflows: **none** — one approval spine, one feed, one audit.
- Unnecessary approvals: **avoided** — only in-use files under a required/optional policy; solo owners never see friction.
- Terminology: consistent (Pending/Approved/Live/Draft; "Ask for changes" not "reject").
- Hidden tech debt: none — no new tables/columns (metadata reused); serializer untouched.
- Simplify: the reject path deliberately archives the proposed file (recoverable) rather than hard-deleting — safe by default.
- **No feature creep recommended.** The one honest note: a brand-new asset attached to *brand-new content* (not a replace) is a *content*-approval concern, not a file-approval one, and is out of scope here — flagged, not built.

## Verification
- **Pure:** `files_test` **30/30** (adds `replaceNeedsApproval` don't-over-approve matrix + `fileState` badges). Full regression green (`dam` 32, `agency` 28, `workspace_roles` 42, `invariants` 14, …). `deno check` clean.
- **Live integration:** `dam2_integration_test` **10/10** against real Postgres — staged replace stays pending (old stays live), surfaces in the approval feed, **approve** repoints live + retires old + stamps who/when, **reject** discards + keeps old live. Isolated rows + the temporary enterprise entitlement cleaned up.
- Deployed to staging + prod. No migration (pure reuse).

**Phase DAM-2 — Files Approval & Publishing Workflow complete.**
