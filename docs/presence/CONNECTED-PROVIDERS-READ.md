# L4.1 — Read-Only Connected Providers

The read engine on top of the L4.0 foundation: Studio OS can now safely connect to external services, read what they know, and turn it into understanding — **without ever changing anything outside Studio OS.** One architecture, every provider; read-only, from encryption to evidence.

## Connected Provider Guide

Everything routes through **one** set of pieces — no provider-specific architecture:

- **`connected/providers.ts`** — the 21-provider registry (L4.0). What each is, reads, will eventually write, its scopes, its edition floor.
- **`connected/auth.ts`** — one OAuth + API-key flow, config-driven by an endpoint map. Adding auth for a provider is an entry, not a new flow.
- **`connected/crypto.ts`** — AES-256-GCM sealing of tokens (below).
- **`connected/store.ts`** — the token vault + connection lifecycle, identical for every provider.
- **`connected/adapters.ts`** — a pure normalizer per provider (raw JSON → one shared shape) plus a thin, isolated bearer-GET read. **Read-only: adapters only ever GET.**
- **`connected/evidence.ts`** — the bridge: normalized data → evidence → the frozen pipeline.
- **`routes/connections.ts`** — the customer surface: connect / callback / refresh / disconnect, in plain words.

A provider goes live when its app credentials are registered (see setup); until then it reports an honest "not available on this environment yet" — never a fake success.

## OAuth Architecture

- **Consent** — `POST /connections/:key/connect` returns the provider's own authorize URL, built from `client_id`, our redirect, the least-privilege `scope`, and a `state`. The customer approves on the *provider's* screen; Studio OS never sees a password.
- **Exchange** — the provider redirects to `connections-callback.html`, which posts the code to `POST /connections/:key/callback`; the function exchanges it for tokens and seals them.
- **Refresh** — tokens are refreshed silently by the read path when expired; the customer is never asked to re-auth for maintenance, only for genuinely new permissions.
- **Revoke** — `disconnect` best-effort revokes at the provider, then destroys the local token.
- **App credentials** — per-provider env secrets `CONNECTED_<KEY>_CLIENT_ID` / `_SECRET`, registered by the owner (setup below). API-key providers instead take a read-only key the customer pastes.

## Connection Lifecycle

```
disconnected → connect → pending → connected → [expired | error | revoked] → disconnected
```

| Step | What happens |
|---|---|
| **Connect** | OAuth consent → token exchange → seal → record `connected` (or paste a read-only API key). |
| **Reconnect** | the same connect flow, re-run — used when a token has truly lapsed. |
| **Refresh** | `POST /connections/:key/refresh` — an **on-demand** read (no background jobs): fetch, normalize, cache, update `last_sync_at`. |
| **Disconnect** | revoke at the provider (best-effort) → destroy the sealed token → clear the cache → mark `disconnected` → audit. Always available; the customer's data at the provider is untouched. |

Every step is logged append-only in `presence_connection_events`.

## Provider Capability Matrix

The full matrix is generated in **`CONNECTED-PLATFORM-INVENTORY.md`** (per provider: reads, future writes, auth, permissions, approval, editions, status). At L4.1, every provider's **read** path is built behind the one contract; **no write** path exists for any provider. Representative normalizers are implemented for reviews (rating, count, unreplied), search (clicks, impressions), analytics (visitors, pageviews), social (followers), scheduling (upcoming), CRM (contacts), email (subscribers, open rate), and payments (revenue) — the shared shape every adapter fills.

## Read-Only Provider Inventory

See `CONNECTED-PLATFORM-INVENTORY.md` (generated from the registry). Status remains `Planned` per provider until its app credentials are registered and its read is verified live, at which point it flips to `Read-only`. Nothing is or ever becomes `Read/Write` in L4.1.

## Connected data becomes Evidence (no bypass)

The read path caches a **normalized** snapshot (`presence_connected_data`, honest `fetched_at`). The evidence collector loads it into `input.connected`; a pure `connected` provider in the one evidence registry emits observations (`reviews.connected_*`, `seo.connected_search`, `analytics.connected_traffic`). These flow **through** Evidence → Judgment (the `connected_observed` rule) and are, for now, **judged-but-suppressed** — the customer sees their numbers *directly* on the Connections surface ("your rating: 4.6, 12 reviews"), while turning connected observations into Business Moments is a deliberate later step (L4.2), never a side effect of connecting a service. **No provider can bypass the Evidence Engine** — a connected observation is an evidence type or it doesn't exist (the catalog enforces it).

## Security review

- **OAuth** — least-privilege scopes declared *before* consent; the customer approves on the provider's own screen.
- **Least privilege** — only `reads`-satisfying scopes are requested; only granted scopes are recorded.
- **Token lifecycle** — sealed on receipt, refreshed silently, destroyed on disconnect.
- **Encryption** — AES-256-GCM; the key is an edge-function env secret (`CONNECTION_ENC_KEY`); the DB holds only ciphertext + iv, out-of-row, never returned to a client; **fail-closed** (no key → refuse to store, never plaintext). Verified on staging: the stored ciphertext never contains the key.
- **Rotation** — a new `CONNECTION_ENC_KEY` invalidates old sealed tokens (customers re-connect); no tokens are lost in the clear.
- **Audit** — every lifecycle event append-only in `presence_connection_events`.
- **Connection isolation** — a failing adapter marks its own health and returns null; it never throws, never affects another provider or the run.

## Connection Troubleshooting Guide

| Symptom | Cause | What Studio OS does / you do |
|---|---|---|
| "Connecting X isn't available on this environment yet" | app credentials not registered | register `CONNECTED_<KEY>_CLIENT_ID/SECRET` (setup) |
| "Secure connection storage isn't set up" | `CONNECTION_ENC_KEY` unset | set the encryption key secret |
| Connection shows "needs a quick reconnect" | token expired and refresh lapsed | one tap re-connect — calm, never red |
| Health = down | provider outage / read error | last-known data kept, labelled by `last_sync_at`; retried on the next natural read |
| Health = attention | rate-limited or a soft error | backs off; nothing shown to the customer |
| Disconnected unexpectedly | permission revoked at the provider | treated as a clean disconnect; thanked, not chased |
| No numbers after connect | first read pending or empty | `refresh` pulls on demand; empty is honest, never invented |

## Setup (owner steps — per provider, dashboard-only)

For each OAuth provider: register an app at the provider's developer console, set the redirect URI to `https://davisdigitalstudio.com/connections-callback.html`, request the least-privilege scopes shown in the inventory, and add `CONNECTED_<KEY>_CLIENT_ID` / `_SECRET` as edge-function secrets. The `CONNECTION_ENC_KEY` (32-byte base64) is already set on staging and prod. API-key providers need nothing — the customer pastes a read-only key. *(This is the same "dashboard steps I can't do for you" pattern as the Stripe/webhook setup.)*

## Tests

`tests/presence/connected_reads_test.mjs` — 17 pure + 6 staging-integration: token encryption round-trips and fails closed; the one OAuth flow builds a correct consent URL from config; normalizers turn raw provider JSON into the shared shape (and never throw on garbage); connected data becomes evidence that flows through the pipeline (every type catalogued, mapped to exactly one judgment rule, judged-and-suppressed — **no bypass**); a broken provider is isolated. Integration: a real connect → **encrypted** secret stored (ciphertext ≠ key) → connection record connected → disconnect destroys the secret. Regression green: evidence 25 (29 providers), optimization 33, judgment 23, recommendation 26, moments 23.

## Final review

- **Can customers safely connect their services?** Yes — read-only, consent on the provider's own screen, least-privilege, encrypted tokens, disconnect any time.
- **Does every provider follow one architecture?** Yes — registry + one auth flow + one store + one adapter contract; no per-provider architecture.
- **Does every provider preserve ownership?** Yes — the account and authorization are the customer's; Studio OS holds delegated, encrypted, revocable tokens; disconnect leaves their data untouched.
- **Can future providers be added without redesign?** Yes — a registry entry + a normalizer + an endpoint; the L4.0 extensibility test still holds.
- **Does every provider feed the Evidence Engine correctly?** Yes — connected data enters as evidence through the one pipeline; it cannot bypass it.
- **Is the customer experience calm?** Yes — "your Google listing", "your reviews", grouped by intent, no OAuth/scopes/tokens/limits ever shown.
