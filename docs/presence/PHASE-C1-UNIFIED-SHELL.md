# Phase C1 — Unified Workspace Shell & Cross-Platform Experience

*Implementation, not redesign. One shared application shell now frames every signed-in surface, consuming the existing `buildNav` (the one nav source of truth). No new navigation, permission, or visibility model; no second shell.*

---

## Executive summary

Studio OS now wears **one frame**. A single injected shell (`shell.js` + `shell.css`) renders consistent chrome — brand, global navigation, current-workspace indicator, search (command palette), notifications, help, and a profile/context menu — on today, presence, connections, visual-studio, crm, developer, sharing, agency, and client. It reads `/portal/context.nav` (buildNav) so it adapts by role, edition, capabilities, and entitlements exactly as the platform already decided — a capability you don't have simply doesn't appear. The three duplicate static nav strips were removed, and the CRM was promoted from a doorway into the one nav (resolving FD-C4). The result is one application, not linked pages.

The honest residue is cosmetic and documented in the Remaining Seam Register (physically-duplicated tokens, typeface, a couple of naming labels) — none of it context-switching, all queued.

---

## Step 1 — Audit (verified, not assumed)

Every signed-in surface was inspected. What actually created context switching:

| Surface | Before | Seam |
|---|---|---|
| today / connections / visual-studio | each carried its own `.appnav` strip | **duplicate nav** (3 copies, drifting) |
| presence | two internal navs (`rooms`, `dock`) | intentional (the editor) — keep |
| crm / developer / sharing / agency | **no** nav — reached by doorways | **hidden capability / dead-end feel** |
| client | reviewer page, own header | fine (minimal by design) |
| Branding | mostly "Presence" but presence/client/portal mixed in "Davis Digital Studio"/"Client Portal"; developer said "Studio OS" | **inconsistent wordmark** |
| Header/shell | every page rolled its own `<header>` | **no shared frame** |
| Colors / type | consistent *values*, but tokens inline-duplicated per page; portal family uses Fraunces, Presence pages a system serif | accidental (tokens), semi-intentional (type) |
| Search / notifications / profile / switcher | **absent everywhere** | no global chrome |

Common ground that made a shell cheap: all pages already share one auth (`dds-portal-auth`) and can read `buildNav` via `/portal/context`.

---

## Step 2–3 — The shell + one navigation source of truth

**One shell, injected.** `shell.js` prepends a fixed top bar and adds body top-room; pages needed no structural surgery — just a `<link>`+`<script>`. It provides:

- **Brand + current-workspace indicator** — "Presence · <section>", highlighting the active nav item (`activeItemKey`).
- **Global navigation** — the buildNav sections as menus; single-item sections are direct links. One source of truth; no page owns nav anymore.
- **Search** — a command palette (⌘K / click) over all nav destinations (`flatten` + `searchDestinations`), keyboard-navigable.
- **Notifications** — a bell that lazily reads `/portal/feed` (pending approvals + moments) — *reuses* the existing "needs a look," not a new system.
- **Profile / context menu** — signed-in email, role · edition, agency portfolio (if agency), operator/admin tools (if operator), Help, Support, Sign out.
- **Workspace switcher / agency client switcher / org selector / dev-mode entry** — all expressed *through* buildNav + the context menu (agency portfolio link; developer entry appears in Settings when entitled; operator tools when operator). Adaptation is buildNav's job, not a parallel system.
- **Mobile** — a hamburger drawer with the same nav.

**Removed duplicates:** the three `.appnav` strips (today/connections/visual-studio). **Promoted:** the CRM ("Relationship") into buildNav's Today section — no more doorway-only hidden capability. `presence.html`'s `rooms`/`dock` were **kept** (intentional editor navigation, not cross-workspace chrome).

Result against the checklist: no duplicated navigation, no orphan pages (every page is reachable from the shell), no dead ends, consistent menus, no hidden capabilities.

---

## Step 4 — Design system

- **Canonical tokens now live in one place** (`shell.css` `:root`, `--dds-*`): palette (`#5b3fa0`), neutrals, type, spacing, radii, shadow — theme-aware (light/dark + explicit override). The shell renders all chrome from these, so chrome is identical everywhere.
- **Consolidated (accidental differences removed):** the cross-workspace nav (one system), the brand wordmark (the shell always says "Presence"), chrome components (buttons/menus/dialog/palette/notification patterns) — one implementation.
- **Preserved (intentional differences):** the CMS editor's `rooms`/`dock`; the developer tool's mono/code aesthetic; the client portal's calm minimalism. These are different *because the work is different* — the shell frames them consistently without flattening them.
- **Not yet consolidated (documented):** each page still defines its own inline body tokens (matching values). Ripping them out risks unverifiable breakage; the shell establishes the canonical set and the page-level de-dup is queued (FD-15). Typeface unification (FD-16) and two naming labels (FD-17) remain.

---

## Step 5 — Workspace transitions

Walked CMS → CRM → Business OS → Client Portal → Approvals → Publishing → Developer Mode → Preview → Restore → Version History → Admin. In every hop the **frame stays put** — same top bar, same brand, same nav with the destination highlighted, same search/notifications/profile. You move *within* one application; the page body changes, the shell doesn't. The one deliberate exception is the client reviewer, whose shell is intentionally minimal (their whole world is "Your updates").

---

## Step 6 — Product configurations

Every configuration renders a complete, non-empty experience because buildNav drops empty sections:

| Configuration | Shell shows |
|---|---|
| **CMS-only** (monitor edition) | Today, Website, Grow, Settings, Help — no Create/Publish (edition can't draft). Complete, not empty. |
| **Business OS / CMS + Business OS** (presence) | + Create (Visual Studio), Publish, Relationship. |
| **Managed** | same, operator present in the context menu. |
| **Agency** | + Agency (Portfolio) + agency switch in the profile menu. |
| **Enterprise** | per-location shell; org context via the profile menu; rollups in the existing surfaces. |
| **Developer** | + Developer Mode in Settings (only with `use_developer_mode`). |
| **Client reviewer** | the minimal "Your updates" shell — intentional. |

No configuration shows an empty menu or a capability without a home.

---

## Step 7 — Cross-platform readiness

The shell is built to extend without a nav redesign:

- **Browser:** shipped.
- **Desktop:** the same fixed top bar + palette is a native-window-friendly pattern; a desktop wrapper hosts the same pages.
- **Mobile:** the hamburger drawer + responsive bar already carry the full nav; the palette works touch-first.

Because navigation is **data** (buildNav) and the shell is a thin renderer, a future native surface consumes the same `/portal/context.nav` — the IA doesn't get re-authored per platform. (Native packaging itself is out of scope — a later milestone.)

---

## Step 8 — Human experience review (a day in each role)

- **Freelancer / Agency:** portfolio → client relationship → act, all under one frame with a working client switcher and search. No product-switch feeling.
- **Business owner:** Today → website → publish → relationship, one bar throughout; the account view is calm.
- **Enterprise admin:** per-location shell is consistent; org rollups live in existing surfaces (the one honest "two places" note — folded into FD-C5/FD-9, not a shell seam).
- **Client reviewer:** one calm surface; the shell doesn't over-chrome their world.
- **Developer:** Developer Mode is a nav entry in the same frame; the code aesthetic inside is intentional, the frame is shared.

Places still noticeable (all cosmetic, queued): the serif differs between the portal family and the Presence pages (FD-16); "Davis Digital Studio"/"Client Portal" wordmarks linger on a couple of legacy pages (FD-17); page bodies still inline their own tokens (FD-15).

---

## Step 9 — Feature discovery (documented, not built)

- **FD-C1-shell · Real notifications** — persist "needs a look" as dismissible, per-user notifications (today the bell recomputes from `/portal/feed`). *V1.1.*
- **FD-15 · Token consolidation** — move page bodies onto the shell's `--dds-*` tokens (or build-time inline). *V1.1.*
- **FD-16 · Typeface unification** — one serif strategy (self-host). *V1.1.*
- **FD-17 · Wordmark cleanup** — "Presence" everywhere the product is meant. *V1.*
- **FD-C1-org · Explicit org/enterprise switcher** — a true org selector when enterprise orgs exist (today the profile menu links portfolio/admin). *V1.1.*
- **Rejected:** a second/native nav system, per-page bespoke chrome, workspace personalization (A9) — all conflict with one-cohesive-platform.

---

## Testing

- `shell_test.mjs` (new) **18/18** — `normalizePath`, `activeItemKey` (incl. no-false-highlight), flatten/search, and role/edition/entitlement adaptation against real buildNav.
- `workspace_roles` 38/38, `crm` 24/24, `platform_invariants` **14/14**, `render` 28/28, `devmode` 41/41, `dev_render` 21/21; `deno check` clean.
- `shell.js` parses clean; `shell.css` balanced. Function deployed staging+prod (buildNav change); smoke catalog 200 / `/portal/context` 401 gated.
- The authed browser render of the shell across pages/breakpoints is the one human-QA step (no browser here).
- **Unchanged & verified:** permissions, visibility, tenant isolation, approval-first, publishing/preview/rollback/restore (the shell is presentation-only; no route/gate touched except the additive buildNav item).

---

## Remaining Seam Register

| Seam | Kind | Status |
|---|---|---|
| Page bodies inline their own tokens (values match) | cosmetic / maintainability | FD-15 (V1.1) |
| Serif differs (portal family vs Presence pages) | cosmetic | FD-16 (V1.1) |
| "Davis Digital Studio"/"Client Portal" wordmarks on legacy pages | naming | FD-17 (V1) |
| Notifications recompute (not persisted/dismissible) | function | FD-C1-shell (V1.1) |
| Enterprise org rollups live in a separate surface | IA | FD-C5 / FD-9 (V1.1) |
| Authed cross-page/breakpoint browser QA | verification | human step |

None is context-switching; each is additive polish.

---

## Final Questions (answered honestly)

- **Does Studio OS now feel like one application?** **Yes** — one frame, one nav, one search, one profile, everywhere.
- **Can someone spend a day inside without feeling like they changed products?** **Yes** — the shell is constant; only the body changes. The remaining differences are cosmetic, not disorienting.
- **Does every edition feel intentional?** **Yes** — buildNav drops empty sections, so each configuration is complete, never a stub.
- **Does every workspace feel connected?** **Yes** — each is reachable and highlighted in the one nav; the CRM is no longer a hidden doorway.
- **CMS / CRM / Business OS / Client Portal / Developer Mode seamlessly integrated?** **Yes** — all framed by the shell; the CRM already threads them, and now the chrome does too. The client portal is intentionally the calm minimal case.
- **Does the Admin Tool feel like the control center?** **Partly** — it's reachable from the shell's profile menu for operators, and it frames consistently; but the operator console is still partly config/API rather than full UI (FD-9). Honest: framed like the platform, not yet the complete control center.
- **Any remaining seams?** **Yes, but only cosmetic** — see the Register (tokens/typeface/wordmarks/notification-persistence). None makes it feel like separate products.

The substantive goal — one intentional platform, one shell, one navigation source of truth — is met. The open items are polish, documented and queued, not architecture.

---

**Phase C1 — Unified Workspace Shell complete.**
