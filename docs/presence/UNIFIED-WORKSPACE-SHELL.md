# Unified Workspace Shell — Guide

*Phase C1. The one application frame for every signed-in Studio OS surface. Covers the shell, navigation architecture, cross-workspace experience, cross-platform readiness, and how to add a page.*

---

## What the shell is

One injected frame (`shell.js` + `shell.css`) that renders consistent chrome on every signed-in page: brand, global navigation, current-workspace indicator, search, notifications, help, profile/context menu. It is a **thin renderer over `buildNav`** — it defines no navigation, permission, or visibility model of its own. Adaptation by role/edition/capability/entitlement is entirely buildNav's (the one source of truth), fetched via `/portal/context`.

There is exactly **one** shell. Pages do not roll their own cross-workspace nav.

---

## Navigation Architecture

```
  lib/navigation.ts  buildNav(role, edition, capabilities, isAgency, isOperator)
        │   ONE catalog → visible sections (empty sections dropped)
        ▼
  /portal/context  → { nav, landing, site_role, edition, capabilities, is_agency, is_operator }
        │
        ▼
  shell.js  → renders the top bar; activeItemKey() highlights the current page;
             flatten()+search power the command palette
```

- **One source of truth:** `buildNav`. Add or move a destination there and it appears in the shell, the palette, and the mobile drawer at once. Never add a second nav list.
- **Adaptation is subtraction:** a capability the caller lacks is simply absent — no empty menus, no dead ends, no per-edition build.
- **Matching:** `normalizePath` makes `/crm.html`, `/crm`, `/crm/`, and `/crm?x#y` equal; `activeItemKey` highlights the best match (exact wins, else longest prefix), and returns null rather than a false highlight.
- **Pure + tested:** `lib/shell.ts` holds `normalizePath`/`activeItemKey`/`flatten`/`searchDestinations`, locked by `shell_test.mjs` (18 tests). `shell.js` mirrors them at runtime (no build step ships TS to the browser).

---

## Shell elements (and how each adapts)

| Element | Source | Adapts by |
|---|---|---|
| Brand + current-workspace | static + `activeItemKey` | current page |
| Global nav | `buildNav` sections | role · edition · capabilities · agency |
| Search / command palette | flatten(buildNav) | whatever nav shows |
| Notifications (bell) | lazy `/portal/feed` | pending approvals + moments for the role |
| Profile / context menu | `/portal/context` | email, role·edition, agency, operator |
| Agency client switcher | profile menu → portfolio; `dds-acting-as` | agency membership |
| Developer Mode entry | buildNav Settings | `use_developer_mode` |
| Help / Support | static | always |
| Mobile drawer | `buildNav` | same nav, touch-first |

Nothing here is a separate system; each is a view of buildNav + existing endpoints.

---

## Cross-Workspace Experience

Moving between CMS, CRM, Business OS, Client Portal, Approvals, Publishing, Developer Mode, Preview, Restore, and Admin, the frame is constant: same bar, brand, nav (with the destination highlighted), search, notifications, and profile. Only the page body changes. The client reviewer is the one intentional minimal case (their shell is just "Your updates").

---

## Cross-Platform Readiness

Because navigation is data and the shell is a thin renderer:

- **Browser** — shipped.
- **Desktop** — a native window hosts the same pages; the fixed top bar + palette is a desktop-native pattern.
- **Mobile** — the responsive bar + hamburger drawer already carry the full nav; the palette is touch-first.

A future native surface consumes the same `/portal/context.nav`; the IA is authored once. (Native packaging is a separate, later milestone.)

---

## Adding a page (do this, not that)

1. Add the destination to **`buildNav`** in `lib/navigation.ts`, gated by the right capability/edition. *Do not* add a nav link to any page.
2. Include the shell in the page `<head>`:
   ```html
   <link rel="stylesheet" href="/shell.css">
   <script src="/shell.js" defer></script>
   ```
3. If the page has its own *intentional* in-page navigation (like the CMS editor's rooms/dock), keep it — the shell frames it, it doesn't replace it.
4. Add the path prefix to the service worker's always-fresh list if it's a living app surface.

That's it — the page is now framed, reachable, searchable, and highlighted, with zero bespoke chrome.

---

## Design tokens

The canonical tokens live in `shell.css` `:root` as `--dds-*` (palette `#5b3fa0`, neutrals, type, spacing, radii, shadow), theme-aware. The shell renders all chrome from these. Page bodies still define matching inline tokens today; consolidating them onto `--dds-*` is queued (FD-15) and must preserve the pages' no-CDN resilience.

---

*See also: [PHASE-C1-UNIFIED-SHELL](PHASE-C1-UNIFIED-SHELL.md) (audit, reviews, seam register, final questions), [WORKSPACE-INFORMATION-ARCHITECTURE-A75](WORKSPACE-INFORMATION-ARCHITECTURE-A75.md) (the IA buildNav encodes), [FEATURE-DISCOVERY-QUEUE](FEATURE-DISCOVERY-QUEUE.md).*
