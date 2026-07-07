# L4.3 — Write-Capable Adapters

The first time Studio OS changes anything *outside* itself. Every external write is a **plan the customer reviews and approves before anything happens** — the same safety core as M12 Infrastructure Change Plans, now applied to connected providers. There is one architecture for every provider, approval is a law (not a setting), and nothing is ever automated behind the customer's back.

## The write pipeline (never shortcut)

```
Observation → Evidence → Judgment → Recommendation → PLAN
  → Human Approval → Execute → Audit → Verify   (→ Rollback if reversible)
```

A write plan can cite the recommendation it serves (`recommendation_hash`), so every external change traces back through the whole intelligence pipeline to the observation that motivated it. Nothing writes from a shortcut.

## Two kinds, both safe by construction

| Kind | What it is | Can it touch a provider? |
|---|---|---|
| **write** | A real provider write (GBP post, GBP hours, Search Console verification) — approval-gated, verified by read-back, reversible or explained | Yes, only after approval, only when the owner has registered write scopes |
| **handoff** | The platform *prepares* content (an email, a social post, a calendar booking); the customer sends/posts/adds it themselves | **No — structurally incapable of an external write** |

The six launch workflows (the safest, highest-value):

1. **`gbp_post`** — publish a post to your Google listing *(write)*
2. **`gbp_hours`** — update the hours on your Google listing *(write; prior hours snapshotted for rollback)*
3. **`gsc_verify`** — request Search Console verification *(write; grants visibility only, nothing public changes)*
4. **`calendar_hold`** — prepare a booking you add yourself *(handoff — Google Calendar stays read-only)*
5. **`email_draft`** — prepare an email for your list, **not send** *(handoff)*
6. **`social_draft`** — prepare a post for you to publish, **not auto-post** *(handoff)*

Providers with no safe, verifiable write (Analytics, Yelp, Calendar's live API, …) **stay read-only** — the milestone's rule, enforced by the registry: no write spec, no write path.

## Every write carries (the plan)

`connected/writes.ts` builds a complete `WritePlan` for each workflow — enforced by test that none is missing:

- **Plain-language plan** — title + summary in the customer's words, no jargon.
- **What will change** — the concrete effect.
- **What will not change** — the reassurance, always present (hours won't touch your website; a post won't touch your reviews; a handoff sends nothing).
- **Risk** — honest, plain words.
- **Rollback** — how to undo, or *why undo is unneeded/impossible* (an irreversible verification changes nothing public; a handoff sent nothing).
- **Verify** — how we confirm it worked.
- **Customer approval** — `requires_approval: true`, a schema CHECK constant, exactly like the recommendation and infra-plan approval laws.
- **Audit trail** — every step (`write_prepare`, `write_approve`/`write_abandon`, `write_execute`/`write_fail`, `write_rollback`) appended to `presence_connection_events`.
- **Provider response** + **verification result** — captured on the plan row.

## One architecture, no provider-specific path

`connected/execute.ts` is the **single** place an external write can happen. It:

1. **Re-enforces the approval law** — a plan that isn't `approved` cannot execute, ever (defense in depth over the route's check).
2. For a **handoff** — packages the content and returns it; never opens a socket.
3. For a **write** — checks the owner has registered write scopes, loads the delegated token, performs the *declared* method + endpoint (from `WRITE_SPECS`, data not code), captures the response, then **verifies by reading the provider back**.
4. **Never throws** — a failed write marks the plan `failed`, leaves nothing half-done, and keeps the plan retryable; the customer's approval still stands.

Adding a write workflow is a `WRITE_SPECS` entry + a plan builder — never a new code path. Verified by test: every spec targets a registered provider, writes declare method+endpoint, handoffs declare neither.

## Live activation (owner setup — the honest gate)

Real writes are **off until the owner registers write scopes** for a provider and sets `CONNECTED_<KEY>_WRITE=1` — the same "dashboard step I can't do for you" pattern as read activation (L4.1) and Stripe (L1). Until then an approved real write returns an honest *"writing to your Google listing isn't switched on for this environment yet — your approval is saved,"* never a fake success and never a silent drop. Handoffs need nothing, because they depend on no external permission.

## Ownership, disconnect, calm — preserved

- **Ownership** — the account and authorization stay the customer's; writes use delegated, encrypted, revocable tokens; the customer approves every change.
- **Disconnect** — unchanged and always available; disconnecting destroys tokens and ends all write ability instantly; the account at the provider is untouched.
- **Calm** — writes never surprise: nothing happens without an explicit approval; every plan reads in plain words; a handoff reassures that nothing was sent.

## Rollback

`POST /connections/:key/write/:id/rollback` — for a reversible executed write, prepares the **inverse as a new proposed plan** (so even undoing is reviewed and approved); for a handoff, confirms there was nothing to undo; for an irreversible write, returns the honest explanation. `gbp_hours` restores the snapshotted prior hours; `gbp_post` prepares a delete.

## Routes

```
POST /connections/:key/write/prepare        → a proposed plan (optionally cites a recommendation)
GET  /connections/:key/write                → the plans and their status
POST /connections/:key/write/:id/decide     → { decision: approve | abandon }
POST /connections/:key/write/:id/execute    → runs an APPROVED plan (law enforced)
POST /connections/:key/write/:id/rollback   → undo (reviewed) or honest explanation
```

## Tests & validation

`tests/presence/connected_writes_test.mjs` — 23 pure + 7 staging integration. Pure: every workflow builds a complete plain-language plan; one architecture (writes declare method+endpoint, handoffs neither; read-only providers have no write path); approval enforced in the executor; handoffs never touch a provider; real writes gated + honest; rollback real or explained; no jargon; a garbage plan never throws. **Integration (staging, live):** prepare → *execute-before-approve refused (409)* → approve → execute (handoff verified prepared-not-sent) → full audit trail; a real GBP write honestly gated (503) with approval preserved. Full pipeline regression green.

## Final review

- **Can every write be reviewed first?** Yes — it exists only as a proposed plan until an explicit approval; nothing executes otherwise.
- **Can every write be traced?** Yes — `recommendation_hash` links to the pipeline; every lifecycle step is an append-only audit event; the plan stores the provider response and verification.
- **Can every write fail safely?** Yes — the executor never throws, a failure marks the plan `failed` with nothing half-done, and the approval stands for a retry.
- **Can every write be undone or explained if undo is impossible?** Yes — reversible writes snapshot prior state and undo through a reviewed inverse plan; irreversible ones carry a plain explanation of why undo isn't needed.
- **Did any provider bypass the shared architecture?** No — one plan shape, one executor, one route surface; specs are data. Providers without a safe write stay read-only.
- **Did any workflow become automation instead of approval?** No — every write requires an explicit recorded approval; handoffs send nothing at all.
