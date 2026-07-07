# L4.0 — Connected Platform Foundation

Studio OS is becoming the single place a business manages its digital presence. Before it can safely touch any external service, it needs **one architecture that treats every external platform the same way**. This milestone defines and builds that foundation — and nothing more. No live OAuth, no data sync, no writes, no background jobs, no account changes. Read-only first, from the ground up.

This is the same move M12 made for infrastructure ("infrastructure replaceable, customer trust not"), now applied to connected services: Studio OS is the stable control plane; Google, Meta, booking systems, CRMs, and the rest are adapters behind one contract, never bespoke integrations.

## 1. Connected Platform Architecture

Two halves, deliberately separated:

- **The provider declaration** (`connected/providers.ts`) — static data: what a platform *is*, what it can read, what it could eventually write, how the customer authorizes it, which editions may use it. Adding the 25th provider is appending one entry.
- **The connection record** (`presence_connections`) — a customer's live *link* to a provider: status, health, granted scopes, last-sync, errors. One row per (site, provider).

Both express the **same unified concepts** — Connection, Capabilities, Health, Status, Synchronization, Permissions, Last Sync, Errors, Rate Limits, Ownership, Edition Requirements, Future Write Support — so no provider ever needs its own architecture. The registry is introspectable at `GET /admin/connections` (the living inventory) and surfaced to customers at `GET /connections`.

## 2. Provider Contract (`connected/contract.ts`)

```ts
ConnectedProvider = {
  key, name, customerLabel,     // "your Google listing" — never an API name
  category, purpose,            // one plain sentence
  auth, approval, scopes,       // least-privilege permissions, declared
  reads, futureWrites,          // read-only-first; writes declared, never built here
  minEdition, rateNote, status  // technical floor, rate posture, Planned/Read-only/Read/Write
}
```

Capabilities use the M12 vocabulary — `automatic | guided | unsupported` — and the same law: **declared, never assumed**; an adapter never claims what it cannot do. Every provider in the registry is `status: planned` at L4.0.

## 3. Authentication Model

- **Who owns authentication?** The customer. Always. The Google/Meta/booking/CRM account is theirs; they grant access, they revoke it.
- **Who owns refresh tokens?** Studio OS holds *delegated*, encrypted, least-privilege tokens — never a password, never ownership. It refreshes its own delegated tokens silently; the customer is asked to re-authorize only for genuinely new permissions, never for maintenance.
- **How is it stored?** Tokens are **never** in the connection row. `secret_ref` points at an encrypted secret held out-of-row (a vault/KMS handle, added with the first live adapter). The row carries only status, granted scopes, and health.
- **Methods** (declared per provider): secure sign-in (OAuth2), a read-only key the customer pastes (API key), or a one-time ownership check — chosen by what the provider supports, translated to plain words in the customer surface.

## 4. Capability Model

- **Read capabilities** (`reads`) — what a shipped adapter observes, in the customer's terms ("the searches that lead to you", "your rating and recent reviews").
- **Future write capabilities** (`futureWrites`) — declared so the write architecture is provably supportable, but built by **no adapter at L4.0**. A provider becomes `read_write` only when a write adapter is deliberately shipped and every change is customer-approved.
- **Rate limits** (`rateNote`) — each provider declares its posture; the platform backs off and prefers stale-but-honest over hammering.
- **Least privilege** — `scopes` is the smallest set that satisfies `reads`; consent is honest before a single token is minted.

## 5. Connection Lifecycle

```
disconnected → (customer approves) → pending → connected → [expired | error | revoked] → disconnected
```

- **Connect** (L4.1): the customer approves on the provider's own screen; Studio OS records granted scopes and stores the delegated token encrypted. *(No connect flow ships in L4.0 — read-only foundation.)*
- **Health/Status/Last Sync** live on the record; the customer sees "connected / needs a quick reconnect", never a raw error.
- **Disconnect** (shipped now): removes the record and — with a live adapter — destroys the token and revokes at the provider. **Always available, never penalized** (Laws 3, 4); the customer's data at the provider is untouched. Every lifecycle event is logged append-only in `presence_connection_events` (provenance + revocation history).

## 6. Synchronization Philosophy

L4.0 synchronizes nothing (no jobs, no sync — by fence). The *philosophy* it establishes: reads are **pull, on a gentle cadence, honest about freshness** (`last_sync_at` tells the truth; data is labelled as-of its last sync, never invented). Observation feeds the existing Evidence Engine as just another provider input — connected data becomes evidence, judged and surfaced through the one frozen pipeline, never a parallel system. Nothing is ever written back without a deliberate write adapter and per-change approval.

## 7. Failure Handling (`ERROR_PHILOSOPHY`)

External systems fail; Studio OS stays calm. Each mode has a defined, gentle degradation:

| Failure | Behavior |
|---|---|
| OAuth expired | silently refresh; if it truly lapses, "needs a quick reconnect" — one tap, never red |
| Rate limited | back off; the customer sees nothing; stale-but-honest beats hammering |
| Provider outage | health = down; last-known data kept and labelled by its sync time; never invented |
| Permission revoked | treated as a clean disconnect the customer chose — thank, don't chase |
| Account deleted | mark disconnected; keep nothing that isn't ours |
| API change | the adapter fails **closed and isolated** — one provider breaking never touches another |
| Network failure | transient; last-sync tells the truth; retried on the next natural pass, never a storm |

**Provider isolation** is structural, exactly like the evidence providers: a throwing adapter contributes nothing and poisons nothing.

## 8. Provider Extension Guide

Adding a provider — no redesign, ever:
1. Append a `ConnectedProvider` entry to `connected/providers.ts` (all fields; `status: 'planned'`).
2. Declare least-privilege `scopes` that satisfy the `reads`; write `customerLabel`/`purpose`/`reads` in the customer's words (no jargon — the test enforces it).
3. Set `minEdition` (technical floor) and `rateNote`.
4. The inventory, the customer surface, and the admin introspection all pick it up automatically (generated from the registry).
5. When building the live adapter (L4.1+): a read-only fetch behind the contract, feeding evidence; flip `status` to `read_only`. A write adapter later flips it to `read_write` — same contract.

## 9. Future Write Architecture

The foundation supports writes without changing shape: `futureWrites` is already declared per provider; a write adapter is a new capability on the *same* contract, gated by (a) an explicit write scope the customer separately approves, (b) the M12/M14 approval-plan law (prepare → approve → apply, nothing without consent), and (c) `status: read_write` only when shipped. The read-only-first posture means every provider earns trust as an observer before it is ever allowed to change anything — and even then, never without per-change approval.

## Customer experience

The customer never thinks about APIs. `GET /connections` returns their world grouped by intent — *Being found, Your listings, Your numbers, Your social, Your reviews, Your bookings, Your customers, Your email, Your sales* — each item a plain "your Google listing", its purpose, what it would read, how they approve, and whether it's connected. Providers below their edition simply don't appear.

## Edition behavior (technical capability, not pricing)

Support is a contiguous range from each provider's floor upward, and the connectable set **grows** up the ladder: Monitor reaches the observation providers (search, listings, analytics, reviews — fitting its "watch your existing presence" purpose); Presence adds social, scheduling, email, and payments; CRM sits at Managed/Agency. Pricing is deliberately not set here.

## Security review

- **OAuth / consent** — the customer approves on the provider's own screen; scopes are least-privilege and declared before consent.
- **Token storage / encryption** — never in-row; `secret_ref` → encrypted out-of-row secret; deny-all RLS on both tables; reads are function-mediated and never return `secret_ref`.
- **Rotation** — delegated tokens refreshed silently; re-auth only for new permissions.
- **Revocation** — disconnect destroys tokens and revokes at the provider; always available.
- **Audit** — every lifecycle event append-only in `presence_connection_events`.
- **Provider isolation** — adapters fail closed and independent; no shortcuts.

## Tests

`tests/presence/connected_test.mjs` — 20 checks: one shared contract for all 21 providers; read-only-first (none is `read_write`); least-privilege scopes; no API/OAuth jargon in the customer surface; edition capability well-formed and growing up the ladder; ownership + error philosophy as platform constants; the inventory generated with no drift; and a brand-new provider flowing through the same contract unchanged.

## Final review

- **Can future providers be added without redesign?** Yes — a registry entry; the test proves a new one flows through unchanged.
- **Can every provider share one architecture?** Yes — 21 providers, one contract, no per-provider code.
- **Does the customer experience remain calm?** Yes — "your Google listing", grouped by intent, no APIs, no jargon (lint-enforced).
- **Does the foundation preserve ownership?** Yes — the customer owns the account and authorization; tokens are delegated, encrypted, revocable; disconnect is always free and untouches their data.
- **Does it support future write-capable adapters without changing the architecture?** Yes — `futureWrites` is declared, writes are a capability on the same contract, gated by separate scope + the approval-plan law + a deliberate `read_write` status.
