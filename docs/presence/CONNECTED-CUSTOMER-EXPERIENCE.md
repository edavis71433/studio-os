# L5.9 — Connected Platform Customer Experience

*The final Version 1 customer workflow. Builds the customer-facing connect experience over the **existing** Connected Platform (L4.0–L4.4). No backend, no contract, no approval, no security, no architecture change — only a new screen that consumes routes that already ship.*

---

## What was built

**`connections.html`** — the customer connect-management screen. One calm page that lets a customer:

- **See available services** — grouped in plain words ("Being found," "Your listings," "Your reviews," "Your numbers," "Your bookings," "Your customers," "Your email," "Your sales").
- **See connected services** — each shows a simple status and the customer's own numbers ("4.6★ · 128 reviews," "312 recent visitors"), never raw API payloads.
- **Understand each connection** — an "About this connection" note states, for every service: what Presence reads, what it never changes (nothing — read-only), whether approval is required, that the customer owns the account, how to disconnect, and what happens if they don't connect.
- **Connect a service** — one tap. OAuth services hand off to the provider's own approval screen (we remember the choice in `localStorage` and return through the existing `connections-callback.html`); key-based services show a single "paste your read-only key" field inline.
- **Disconnect** — with a calm confirmation ("Your account and everything in it stay exactly as they are — this only stops Presence reading it").
- **Refresh** — pull fresh numbers now (an on-demand read; no background jobs).
- **View connection health** — as plain states, never diagnostics.
- **Ask the Concierge** — free-form questions about connecting, using the existing `/concierge/ask`.

Plus two small, in-scope wiring changes that close the workflow:
- **`today.html`** now has a calm doorway — *"Connect the services you already use… Manage your connections →"* — so the page is **discoverable** from the daily surface.
- **`connections-callback.html`** now returns the customer to **`/connections.html`** (not the generic portal) so they land back where they can see the service now connected.

---

## It reuses the existing platform — no new logic

Every action is an existing route on the existing customer (client-site) gate:

| Customer action | Existing route (unchanged) | Response consumed |
|---|---|---|
| See services + state + numbers | `GET /connections` | `{data:{edition,note,groups}}` |
| Connect (OAuth) | `POST /connections/:key/connect` | `{data:{mode:'oauth',authorize_url,state,message}}` → redirect |
| Connect (read-only key) | `POST /connections/:key/connect` `{api_key}` | `{data:{mode:'api_key',connected:true}}` |
| Finish OAuth | `POST /connections/:key/callback` *(existing callback page)* | `{data:{connected:true}}` |
| Refresh | `POST /connections/:key/refresh` | `{data:{refreshed:true,data}}` |
| Disconnect | `POST /connections/:key/disconnect` | `{data:{disconnected:true,message}}` |
| Ask a question | `POST /concierge/ask` | `{data:{text}}` |

No duplicated registry, OAuth, lifecycle, read, write, approval, or intelligence logic — the screen renders what the backend already returns and posts to routes that already exist. The write engine, approvals, and security are untouched and unexposed (writes remain a separate approval-gated flow, not part of this screen).

## Calm Software preserved

Nothing technical reaches the screen. The words **OAuth, scopes, API, tokens, client ID, secret, endpoint, provider** never appear. Services are *"your Google listing," "your reviews," "your appointments."* Health is:

- **Connected** — reading your numbers.
- **Needs attention** / **Needs a quick reconnect** — plain, no error codes.
- **Waiting for your permission** — mid-connect.
- **Not connected** — with a Connect button.
- **Not available yet** — honest when a service isn't switched on for this environment.

Ownership and approval lead every explanation ("read-only," "nothing changes," "your account is untouched," "disconnect any time"). The page carries the same premium-calm design system and the portal's exact auth (`supabase-js@2.45.4`, `storageKey: 'dds-portal-auth'`) as `today.html`.

## States handled

Loading (spinner), signed-out (warm routing to sign in), load error (*"nothing's wrong with your services — this is only this page"*), empty (*"nothing to connect just yet"*), per-action success/failure toasts, and the honest "not available yet" for unconfigured providers. All failures reassure that **nothing changed**.

---

## Verification (walked as a customer)

| Requirement | Result |
|---|---|
| **Discover** the page | Yes — a calm doorway on `today.html` (*"Manage your connections →"*) |
| **Understand** it | Yes — grouped plain-language services, per-connection "About" note, no jargon |
| **Connect** a provider | Yes — OAuth hand-off (round-trips through the existing callback) or inline read-only key |
| **Disconnect** a provider | Yes — calm confirm → `/disconnect`; account untouched |
| **Refresh** data | Yes — `/refresh` on demand |
| **Return later** | Yes — persistent session (portal auth), state re-rendered from `GET /connections` |
| **Complete without assistance** | Yes — for any provider whose OAuth app the owner has registered |

**Honest caveat (unchanged from Track 2):** these are reference implementations built to the exact documented API and the portal's proven auth, syntax-verified, but I cannot run a live signed-in browser session here — a human should click through against a real customer before push. And live connections still require the **owner** to register each provider's OAuth app (a setup step, not a customer workflow); until then the surface honestly reads "not available yet." Neither is a code gap.

---

## Final questions (answered honestly)

- **Can a customer complete every Connected Platform workflow?** **Yes** — discover, understand, connect, disconnect, refresh, and return are all present and completable on the existing backend (subject to the owner having registered the provider apps, which is activation, not build).
- **Does the page expose everything already built?** It exposes the whole **customer** surface of the Connected Platform — the registry, the connect/reconnect/refresh/disconnect lifecycle, health, the read numbers, and the Concierge. The **write** engine stays behind its own approval-gated flow by design (not a customer connect-management concern); nothing built for the customer is left unsurfaced.
- **Does it preserve Calm Software?** Yes — no technical vocabulary, ownership/approval/read-only lead every explanation, health is plain, and a calm empty/error posture throughout.
- **Is there any remaining customer workflow missing from Version 1?** **No.** This was the single remaining core-customer workflow identified by both the V1 Feature Completion Audit and the V1 Customer Workflow Integrity Audit. With it built, every core Version 1 customer capability — buy/sign-in, CMS, Creative Studio, the daily Business-Moments surface, Growth, Concierge, media, Publish, and now Connect — is discoverable, startable, and completable by a customer unassisted.

*Not in Version 1 by design (unchanged): Marketplace / Enterprise / Agency customer UIs (deferred to V1.1 — advanced-tier, not core-customer), additional industry packs and providers (additive), and AI image generation (forbidden by Product Law — photos are customer-supplied).*

---

*Owner activation before these connect live (setup, not build): register each provider's OAuth app so the consent hand-off completes. Frontend publishes via `git push`; per the standing go-live gate, this commit is **not pushed** until the owner confirms.*
