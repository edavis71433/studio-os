# P2-B — Capability-Preservation Matrix (mandatory first step)

**Rule:** no page is removed, redirected, or retired until every reachable capability has a documented destination. **Data is disposable; functionality is not.** Destinations: **Studio** (Studio App), **Client** (Client App), **Moved** (existing Presence route/surface), **Deferred → P2-C/D/E/F** (rebuild later; page stays as temporary compat until then), **Removed** (duplicate/obsolete).

**Investigation basis:** `presence.html` chrome + JS read directly; `portal.html`/`portal-workspace.html` inventoried against the six Presence Client-App pages; `shell.js` + `buildNav` (`lib/navigation.ts`) read as the nav source of truth.

---

## `presence.html` — the website editor (Client App, backend = `presence`)
Its left **rail** is an in-page **view switcher** (SPA tabs), not cross-page nav; its JS (`api()` with M9 `If-Match`, `whisper()` save-state, `go()` view switch, publish ritual) is the editor and must not change.

| Capability | Destination | Note |
|---|---|---|
| Website editing views (Today/Business/Menu/Questions/Kind words/Updates/Files/Design/History) | **Client** (stays) | The editor; unchanged. Rail = its section switcher. |
| Draft save (M3 hash) · preview (M8) · **If-Match optimistic lock + stale-draft (M9)** · publish review + summary | **Client** (stays, untouched) | Preserved verbatim — the P2-B shell adoption does not touch `api()`/save/publish. Guarded by `optimistic_lock_test`. |
| Cross-page links (Connections/Visual Studio/Sharing/Files/Preview-client-view) | **Moved → shell** | Now provided by the shared top bar (`buildNav`); the inline links remain as deep-links but nav is unified. |
| Save-state indicator (`#topWhisper`) + toasts | **Client** (kept) + **shared states** | `toast()` now delegates to the shared `window.ddsToast`; `whisper()` unchanged. |
| Own top bar / bottom dock chrome | **Client** (kept, reconciled) | Shell top bar added above; the rail's duplicate wordmark is hidden under the shell. |

## Shared shell (`shell.js` + `shell.css` + `buildNav`) — the frame for both apps
| Capability | Destination | Note |
|---|---|---|
| One authoritative nav (role/edition/capability-aware) | **Studio + Client** | `buildNav` (`lib/navigation.ts`) — already separates surfaces (below). No rebuild. |
| Command palette (⌘K) · notifications (bell → `/portal/feed`) · profile/account · sign-out | **Studio + Client** | Reused as-is; now also on `presence.html`. |
| Shared state helpers `ddsEmpty`/`ddsSkeleton`/`ddsError`/`ddsToast` | **Studio + Client** | The one loading/empty/error/success/**conflict** set; `presence.html` now uses `ddsToast`. |
| Scope switch (`?client=` → `x-dds-scope-site`, "Studio › {client}") | **Studio** | Operator "acting for a client"; unchanged. |
| Internal DDS tools link (`dds-studio-manage-9k2p.html`) | **Internal** | Only shown when `is_operator`; **never in `buildNav`**, so never exposed to clients. |

### `buildNav` surface separation (verified — already correct, no change)
- **Client work:** Today · Customers · Analytics · Inbox (outcome-only primary bar).
- **Website management:** the *Website* section → `presence.html` (+ Business info/Design/Publish/History sub-items).
- **Account & workspace settings:** *Settings* (utility → profile menu) incl. Sharing & access, Developer, **Billing lives here**.
- **Studio operations:** *Studio* → `agency.html` (agency roles only) + scope switching.
- **Internal DDS-only tools:** not in `buildNav`; only the shell profile menu, gated by `is_operator`.
- **Client reviewer** gets the single calm surface (`reviewerNav` → `/client.html`).

## `portal.html` — legacy client portal **+ the product's sign-in/landing page** (backend = `clever-api`)
**Cannot be retired in P2-B:** it is the sign-in/sign-out target for ~40 pages + `shell.js`, and holds 7 capabilities not yet rebuilt. Stays as a temporary compatibility surface.

| Capability | Destination | Note |
|---|---|---|
| Sign-in / auth / landing | **Client** (stays — the auth entry) | Retiring it would break sign-in/out everywhere. Keep. |
| Home / updates · Approvals · Files (upload/download/comment/delete) | **Moved** (already in Presence) | `today.html`/`client.html`, `approve.html`, `files.html`. |
| Two-way Conversation / messaging | **Deferred → P2-D** | No Presence equivalent yet; portal.html keeps it until P2-D. |
| Billing / invoice payment | **Deferred → P2-E** | No Presence equivalent yet. |
| Contract / agreement signing | **Deferred → P2-C** | No Presence equivalent yet. |
| Onboarding / project brief / intake | **Deferred → P2-C** | No Presence equivalent yet. |
| Feedback + add-on / service requests | **Deferred → P2-D** | Support surface. |
| In-portal AI project assistant | **Deferred → P2-D** | (or E if not near-term.) |
| Growth Partnership (workspace/recs/goals/reviews) | **Deferred → Phase 8** (interim: Internal) | Classified E in P2-A. |

## `portal-workspace.html` — standalone Growth workspace (backend = `clever-api`)
**Safe to retire now (reversible redirect):** **zero inbound links** anywhere in the repo, and **every** capability is already inside `portal.html`'s Growth tab (same `gp_workspace`/`gp_submit_request`; `gp_rec_respond` ≈ `gp_rec_action`).

| Capability | Destination | Note |
|---|---|---|
| Sign-in gate | **Moved → `portal.html`** | The canonical sign-in. |
| Growth workspace · business/site health · monthly review · work log · recommendations · goals · content · requests | **Moved → `portal.html#growth`** (redirect target) | Duplicate — no capability lost; interim until Phase 8 productizes Growth. |
| Anything unique | **none** | Confirmed no unique capability. |

**Retirement decision:** `portal-workspace.html` → **reversible redirect to `portal.html`** (its Growth capability's live home). `portal.html` and every Presence Client-App page → **kept** (no capability has an unbuilt-destination problem only where deferred, and those pages stay).

---

## P2-B retirement scope (from this matrix)
- **Retire now:** `portal-workspace.html` (reversible redirect; zero inbound links; pure duplicate).
- **Keep (temporary compat):** `portal.html` — sign-in entry + 7 deferred capabilities (retire only after P2-C/D/E rebuild them + Phase 8 Growth).
- **Adopt the shell:** `presence.html` (the last major Client-App page not on `shell.js`).
- **No capability becomes unreachable:** every deferred capability remains reachable on `portal.html` until its rebuild milestone lands.
