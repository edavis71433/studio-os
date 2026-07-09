# Architecture v1.0 — Implementation Migration (compliance report)

*Execution phase. No redesign. The codebase is brought into conformance with the frozen [Studio OS Architecture v1.0](STUDIO-OS-ARCHITECTURE-V1.md) and [Product Constitution](PRODUCT-CONSTITUTION.md). Engineering names (CMS/CRM/DAM/…) stay internal; only the customer-facing surface changed.*

## The two frozen refinements, now implemented
1. **Primary bar = outcomes only; utilities overflow.** `buildNav` still composes from Edition × Role, but Settings, Connections, and Help are flagged `utility:true`; the shell renders them in the profile/overflow menu, leaving the primary bar to **Today · Website · Customers · Files · Analytics · Inbox · (Studio)**. ⌘K still reaches every capability (primary + utility).
2. **Analytics is first-class.** Added as a composed nav outcome (`hasReports`) with a canonical home, `analytics.html`, framed as plain-English understanding (reuses the existing Business-understanding signals; the later Analytics phase enriches this same home). Not a locked placeholder — it renders real signal or a calm empty state.

## ✅ Migrated in this phase
| Surface | Old | New |
|---|---|---|
| Nav model (`navigation.ts`) | Settings/Connections/Help in primary bar; no Analytics | Analytics first-class; Settings/Connections/Help → `utility` (profile menu) |
| Shell (`shell.js`) | all sections in top bar; ⌘K = nav labels only | primary vs utility split; utilities in profile menu; ⌘K also searches **Files** (`/assets?q=`, scope-aware) |
| `presence.html` | title *"Your Presence — Davis Digital Studio"*; media view **"Photos"** | *"Website — Studio OS"*; view **"Files"** (+ deep-link to the canonical Files page) |
| `today.html` | title *"— Your Presence"*; label **"Business Moments"**; *"Open your relationships / Your connections"* | *"— Studio OS"*; **"your daily updates"**; *"Open Customers / Connections"* |
| `crm.html` | doorways **"Business Moments →" / "Leads →"** | **"Today →" / "Messages →"** |
| `leads.html` | title/H1/badge/footer **"Leads — Presence"** | **"Messages — Studio OS"** |
| `connections.html` | title/H1 **"Your connections — Presence"** | **"Connections — Studio OS"** |
| `agency.html` | title/header **"Agency — Presence" / "Agency workspace · Presence"** | **"Studio — Studio OS" / "Studio"** |
| `help.html` | link **"Relationship"** | **"Customers"** |
| `sharing.html` | share toggles **"Business Moments" / "Media"** | **"Today" / "Files"** |
| `inbox.html` | *"Open in your leads →"* | *"Open in Messages →"* |
| Titles: `visual-studio / schedule / sharing / client / help / developer` | *"— Presence"* | *"— Studio OS"* |
| `analytics.html` | (did not exist) | new canonical first-class Analytics home |
| Shell brand assertion (`shell.spec`) | *"Presence"* | *"Studio OS"* |

## ✅ Already compliant (verified, no change needed)
- `buildNav` composes from Edition × Role (never hard-coded); empty sections dropped so every edition feels intentional; no CMS/CRM/DAM/Portal words in any label (invariant-tested).
- Agency drill-in (SC-1): scope is a request, re-validated server-side, fail-closed, with breadcrumb `Studio › {client}`, scoped `api()` header, scoped ⌘K/notifications, and an audit ledger (SC-2). No tenant leakage.
- Reviewer nav = one calm surface (`/client.html`); reviewers are 403 on `/assets/*` and every non-reviewer route.
- Files: `files.html` is the canonical customer-facing Files home over the internal DAM (`/assets/*` + `presence_media`); no "DAM"/"asset library" jargon reaches the page.
- `crm.html`, `files.html`, `inbox.html` titles were already `— Studio OS`.

## ⚠ Intentionally deferred (separate roadmap phases — not compliance gaps)
- **Analytics depth** — visits/sources/key-action sentences fed by the Moments/Evidence pipeline. The home + nav slot are reserved; the *content build* is the Analytics phase (explicitly out of scope here).
- **DAM feature depth** — video, richer version timelines, bulk operations. `files.html` + the Files backend (usage graph, replace/rollback/duplicate, PDF documents) are the paused **DAM-1** build and are terminology-compliant; further feature expansion is DAM-1's own phase.
- **`presence.html` in-editor Files view** — the Website editor keeps an in-context image view (relabelled **Files**, with a deep-link to the canonical page). Consolidating it to a pure deep-link would remove editing functionality, so it's left as an editing convenience, not a duplicate top-level destination.
- **Public marketing site** (`index/about/contact/portal/the-experience`) and the **operator admin tool** (`dds-studio-manage`, `admin-growth`) — outside the customer-app surface and behind the pre-launch fence / internal-only; their CRM/Relationship/Client-Portal language is intentionally untouched.

## ❌ Not compliant
None in the signed-in customer app.

## Verification
- **Pure:** `workspace_roles` **42/42** (adds locks: Analytics first-class + non-utility; Connections/Settings/Help `utility:true`; primary bar = outcome keys only), `files` **21/21**, `dam` **32/32**, `nav_integrity` **3/3**, `shell` **18/18**, `scope` **14/14**, `scoped_access_audit` **17/17**, `platform_invariants` **14/14**.
- **Playwright (run in CI):** `files.spec.ts` (Files mounts under the shell, shows collections, no DAM jargon, forwards the scope header); `shell.spec.ts` (primary bar shows Analytics, hides utilities; profile menu carries Settings/Connections/Help); `cms.spec.ts` + `today.spec.ts` updated to v1.0 language; `STUDIO_NAV` fixture mirrors the composed nav.
- **Backend:** `deno check` clean; function deployed to staging + prod; live probe of `/assets*` returns healthy auth-gating (401, not 500).
- **Migration:** `0065_files_documents.sql` (widens the media mime CHECK to include `application/pdf`) applied to staging + prod.

**Architecture v1.0 migration complete.**
