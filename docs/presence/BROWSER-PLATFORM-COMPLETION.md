# Version 1 — Browser Platform Completion Review

*Senior frontend/UX/browser/accessibility/performance review. Verification + documentation only — nothing was changed or fixed. Grounded in the actual customer HTML (`portal.html`, `today.html`, `connections.html`, `visual-studio.html`, `connections-callback.html`, `signup.html`, `set-password.html`, `manifest.json`, `sw.js`). Live cross-browser / screen-reader / Lighthouse passes cannot run in this environment and are noted as pending.*

---

## 1. Executive Summary

The customer browser app is made of **two good halves that don't yet feel like one product.**

- **`portal.html`** — a mature (v8) workspace: email/password login, self-serve **forgot-password**, tab navigation, **autosave** with `localStorage` draft persistence, toasts, modals, a **global keyboard focus ring**, responsive mobile layouts. It carries the **purple "Davis Digital Studio"** identity (Fraunces via Google Fonts, `dds-foundation.css`).
- **`today.html` / `connections.html` / `visual-studio.html`** — the newer, self-contained **"Presence"** surfaces in a calm warm-brown identity (system serif, inline CSS), each with loading/empty/error/signed-out states, XSS-escaping, `aria`/`:focus-visible`/reduced-motion, and light/dark theming.

Each surface, on its own, is polished. **The gap is cohesion:** the two identities look like different apps, and the Presence pages are **orphaned from the workspace navigation** (portal links none of them). PWA assets exist but belong to the **marketing site**, and the service worker doesn't correctly handle the new pages. There is no offline/reconnect handling, and two of the new pages use **native `confirm()`/`prompt()` dialogs** that break the premium feel.

**Verdict:** individually shippable; **not yet one cohesive premium app.** The "Must Complete Before QA" items are wiring/cohesion fixes, not new features. Everything is documented, not fixed.

---

## 2. Browser Platform Review

| Capability | State (verified) |
|---|---|
| Browser compatibility | Standard APIs only (fetch, localStorage, CSS grid/flex, `prefers-color-scheme`); no browser-specific APIs that would break. Not live-tested here. |
| Responsive / resizing | `viewport` set on all; portal has mobile media queries (`max-width:640/520`); new pages use fluid `max-width`/`clamp`. Good. |
| Session persistence / refresh | supabase-js `persistSession` + `autoRefreshToken`, `storageKey: 'dds-portal-auth'`; survives refresh; expired → signed-out state. Good. |
| Deep linking / history / back-forward | **Multi-page** app (separate `.html`) → per-page URLs, back/forward, and bookmarks work naturally. **Within portal**, tabs are JS-switched with **no hash/pushState** → tab state isn't bookmarkable and Back exits the app. (Finding B-10.) |
| Multiple tabs/windows | localStorage session shared across tabs (sign-in reflects across tabs); no cross-tab conflict handling for drafts. |
| Uploads / image previews | Media upload via signed URLs; Visual Studio previews via signed URLs + `loading="lazy"`. Good. |
| Clipboard / drag-drop / printing | Not implemented (not required for V1). |
| Downloads | Export (`/export`) is a download; no other download UX. |
| Keyboard navigation / focus | Portal has a **global `:focus-visible` ring**; new pages set `:focus-visible` + `aria-label`. Focus order follows DOM (reasonable). |
| Keyboard shortcuts | Essentially none (power-user gap; V1.1). |
| Loading states | Portal `.spinner`; new pages spinner + skeleton-free. No skeleton loaders (polish). |
| Empty / error / signed-out states | **Present on the new pages** (built in); portal has inline states. Good. |
| Offline / reconnect | **None** — a dropped connection surfaces an error, not a graceful "reconnecting." (Finding B-5.) |
| Autosave / draft recovery / form persistence | Portal: **autosave + `localStorage.setItem`** draft persistence. New pages: no forms needing autosave. Good. |
| Undo | Publishing has versioned restore (server-side); no in-editor undo stack. |
| Confirmation dialogs | Portal: styled modals. New pages: **native `confirm()` (connections) / `prompt()` (visual alt-text)** — inconsistent. (Finding B-7.) |
| `beforeunload` unsaved guard | None (mitigated by autosave). |

## 3. Browser UX Review

- **Navigation/menus:** portal has internal tabs; **there is no unified nav** tying Today ↔ Workspace ↔ Connections ↔ Visual Studio. Today links out to connections/visual, but portal links to none of them, and nothing links back to Today. (Finding B-2 — the biggest UX gap.)
- **Dialogs/modals:** portal styled; new pages native — inconsistent (B-7).
- **Toasts/notifications:** both have toast systems (portal ×6; new pages inline toast). Consistent in concept, different in style.
- **Animations/transitions:** tasteful, reduced-motion-aware on the new pages; portal transitions present.
- **Success/failure/recoverability:** clearly handled — "nothing changed," "your account is untouched," calm error copy. Strong.
- **Consistency:** **the weak point** — two visual identities (purple/Fraunces vs brown/serif), two CSS architectures (external foundation vs inline). (Finding B-1.)

## 4. Browser Performance Review

- **Payload:** no framework, no bundler; pages are small (new pages ~200–250 lines; portal one 5.4k-line document). External JS = supabase-js (CDN). Portal also loads **Google Fonts + `dds-foundation.css`**; new pages use **system fonts** (more resilient, no FOUT/CDN dependency).
- **Loading:** `preconnect` to fonts (portal); `loading="lazy"` on Visual Studio images. No heavy images in the app shell.
- **Memory/leaks:** simple event listeners; no long-lived subscriptions or growing structures observed. Low risk.
- **Rendering:** static HTML + light JS; fast first paint expected. **Not Lighthouse-verified here** (pending).
- **Finding:** portal's Google-Fonts dependency is a single point of visual delay/failure the new pages avoid — an inconsistency worth resolving (B-8).

## 5. Browser Accessibility Review

- **Keyboard-only:** operable; **global focus ring** in portal; `:focus-visible` on new pages.
- **ARIA / roles:** `aria-label` on controls, `role="status"` on loaders, live regions for async messages (new pages); portal uses roles/aria more sparingly.
- **Contrast / typography:** calm palettes with adequate contrast; responsive/scalable type (`clamp`), theme-aware.
- **Reduced motion:** honored (`prefers-reduced-motion`) on new pages and portal.
- **Touch targets:** portal mobile CSS enforces `min-height:40px` on file actions; new pages use comfortably-sized controls.
- **Gaps:** no verified **screen-reader** pass; **native `prompt()`** for alt text is itself an accessibility irony (a modal that's hard to style/label); high-contrast-mode not explicitly handled. A **formal AT audit is pending** (matches the Accessibility Statement).

## 6. Browser Security Review

- **Session:** stored in `localStorage` (`dds-portal-auth`) — the standard supabase-js pattern; refreshed automatically; expiry → signed-out. Token in JS-accessible storage is an accepted trade-off (finding for high-security tiers).
- **CSRF:** **not applicable in the usual sense** — the API authenticates via a **bearer JWT in a header** (`x-dds-user-jwt`), not cookies, so cross-site form posts can't ride ambient credentials. Good.
- **XSS:** the new pages **escape all interpolated data** (`esc()`); portal is a mature v8 surface (its escaping was not fully re-audited here — recommend a spot-check).
- **Uploads:** signed-URL uploads with server-side validation (mime/size/alt). Good.
- **Cookies/permissions/clipboard:** essential auth storage only; no geolocation/camera/clipboard permission use; `noindex,nofollow` on the portal. Good.

## 7. Responsive Design Review

All customer surfaces are responsive: `viewport` (portal adds `viewport-fit=cover` for notches), mobile media queries in portal, fluid `max-width`/`clamp`/grid on the new pages, theme-aware. Phone/tablet/desktop layouts hold. No horizontal-scroll issues observed in code. **Not device-lab-verified here.**

## 8. Installable App Review

- **What exists:** `manifest.json` + `sw.js` — but for the **marketing site**: name "Davis Digital Studio," purple `theme_color #5b3fa0`, `start_url:/`, shortcuts to `/audit`, `/report-card`, `/contact`. If a customer "installs," they get the **studio marketing app, not the Presence product**. (Finding B-4.)
- **Service worker:** correctly **excludes `/portal`, supabase, `/set-password`, `/config.js`** (a living app must not be served stale). **But `today.html` / `connections.html` / `visual-studio.html` are neither excluded nor network-first** → they fall into **cache-first** and could be served a **stale shell** after a deploy. (Finding B-3 — a correctness risk.)
- **Push / background sync / offline shell:** none for the app.
- **Recommendation:** a dedicated **Presence PWA** (own manifest, icons, install prompt, standalone, and SW rules that treat the app pages as network-first) is **V1.1** — and should follow the product-vs-studio **identity decision** (a positioning task), not precede it. For V1, at minimum **exclude the new app pages from the marketing SW's cache-first path** (B-3) so they're never stale.

## 9. Browser Compatibility Matrix (by inspection; not live-tested)

| Browser | Expected | Notes |
|---|---|---|
| Chrome / Edge (Chromium) | ✅ Full | Primary target; all APIs supported |
| Safari (macOS/iOS) | ✅ Expected | `-webkit-` prefixes present; `viewport-fit=cover`; localStorage/PWA supported. Verify iOS standalone + font rendering |
| Firefox | ✅ Expected | Standard APIs; verify focus-ring + theme toggle |
| Legacy/IE | ❌ Unsupported | Modern CSS (grid, custom properties, `clamp`) — acceptable for V1 |

*Live verification across the four browsers is a pre-QA step (cannot run here).*

## 10. Browser Feature Matrix

| Feature | Portal | Today/Connections/Visual |
|---|---|---|
| Auth / session / refresh | ✅ | ✅ |
| Forgot password | ✅ | (uses portal) |
| Autosave / drafts | ✅ | n/a |
| Loading/empty/error states | ✅ inline | ✅ explicit |
| Focus ring / ARIA | ✅ global ring | ✅ per-control |
| Reduced motion / theming | ✅ / partial | ✅ / ✅ light-dark |
| Styled dialogs | ✅ modals | ❌ native confirm/prompt |
| Unified nav to other surfaces | ❌ | ⚠️ Today→out only |
| Self-contained (no external CSS/fonts) | ❌ (Google Fonts + foundation css) | ✅ |
| In marketing PWA/SW | excluded (correct) | ⚠️ cache-first (stale risk) |
| Offline / reconnect | ❌ | ❌ |

## 11. Browser Risk Register

| # | Finding | Severity | Group |
|---|---|---|---|
| B-1 | Two design systems/identities (portal purple/Fraunces vs Presence brown/serif) | High | Must Before QA |
| B-2 | New Presence pages orphaned from workspace nav; no unified navigation | High | Must Before QA |
| B-3 | Marketing SW serves new app pages cache-first → stale-shell risk after deploy | High | Must Before QA |
| B-4 | Installable PWA identity is the marketing site, not Presence | Medium | Recommended / V1.1 |
| B-5 | No offline / reconnect handling | Medium | Recommended |
| B-7 | Native `confirm()`/`prompt()` in new pages break the premium feel | Medium | Recommended |
| B-8 | Portal depends on Google Fonts CDN + external foundation CSS (resilience/consistency) | Medium | Recommended |
| B-9 | No live cross-browser / screen-reader / Lighthouse verification | Medium | Recommended (pre-QA) |
| B-6 | No `beforeunload` unsaved-changes guard (mitigated by autosave) | Low | V1.1 |
| B-10 | No deep-linking/bookmarkable tabs within portal (no hash/pushState) | Low | V1.1 |
| B-11 | No keyboard shortcuts | Low | V1.1 |
| B-12 | Spinners not skeletons; no high-contrast-mode styling | Low | V1.1 |

## 12. Browser Completion Checklist (grouped)

### Must Complete Before QA
- [ ] **Resolve the identity split** (B-1) — one design system/brand across portal + Presence pages (or a deliberate, consistent bridge). *(Ties to the positioning track; do not redesign features — align tokens/typography/naming.)*
- [ ] **Wire unified navigation** (B-2) — Today ↔ Workspace ↔ Connections ↔ Visual Studio reachable from a single, consistent nav.
- [ ] **Fix the SW stale-shell risk** (B-3) — exclude/networking-first the new app pages so they're never served stale.

### Recommended Before Launch
- [ ] Replace native `confirm()`/`prompt()` with styled dialogs (B-7).
- [ ] Add offline/reconnect handling + a calm "connection lost" state (B-5).
- [ ] Decide the font/CSS strategy (self-host fonts or system stack; shared foundation) (B-8).
- [ ] Run live cross-browser + screen-reader + Lighthouse passes (B-9).

### Version 1.1
- [ ] Dedicated Presence PWA (manifest, icons, install prompt, standalone, push/background-sync) (B-4).
- [ ] `beforeunload` guard, bookmarkable tabs, keyboard shortcuts, skeleton loaders, high-contrast mode (B-6/10/11/12).

## 13. Version 1 Browser Readiness Report — Final Questions

- **Does Studio OS feel like a premium browser application?** **Each surface does; the whole does not yet.** Two identities and orphaned pages make it feel like two apps rather than one product.
- **Could someone use it every day in Chrome?** Yes, functionally. **Safari / Edge / Firefox?** Expected yes (standard APIs) — not live-verified here.
- **Does anything feel unfinished?** Yes — the **seams**: the identity switch between portal and the Presence pages, the missing unified navigation, and native dialogs.
- **Is anything missing before QA?** Yes — the three "Must Before QA" cohesion items (B-1/B-2/B-3). They are wiring/consistency, not new features.
- **Would I personally ship this browser experience?** **Not yet as one product** — I'd unify the identity, wire the navigation, and fix the stale-shell risk first. The individual pieces are ship-quality; the seams are not.

*Documented, not fixed, per milestone scope.*
