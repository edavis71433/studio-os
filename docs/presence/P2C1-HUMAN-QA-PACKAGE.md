# P2-C1 — Human QA Launch Package

**Everything a tester needs to run the browser/mobile/keyboard/screen-reader checklist against the *validated staging* environment.** The automated gate already passed (foundation 16/16, tenant isolation 8/8 — see `P2C1-VALIDATION-RESULTS.md`). This is the last step to complete P2-C1.

---

## 1. Start the app (points at staging, reversible)
The app pages hardcode prod config, so a plain browser would hit prod (no `0074`). This harness serves the **unchanged** pages with the prod→staging config swapped **in memory** — no repo file is edited.

```bash
cd C:/Users/edavi/Documents/app
C:/Users/edavi/Tools/deno/deno.exe run --allow-read --allow-net scripts/qa-staging-serve.mjs
```
Leave it running. It prints:
- **Desktop:** `http://localhost:8788/`
- **Mobile:** `http://<this-machine-LAN-IP>:8788/` (phone on the same Wi-Fi; find the IP with `ipconfig` → IPv4 Address)

**To revert:** press **Ctrl+C**. Nothing was modified — the committed pages still point at prod. (If port 8788 is busy: `QA_PORT=8799 deno run --allow-read --allow-net scripts/qa-staging-serve.mjs`.)

## 2. Test accounts (staging, Business OS — relationship enabled)
| | Studio A | Studio B (for isolation spot-check) |
|---|---|---|
| Email | `e2e-a-1783662060@example.com` | `e2e-b-1783662060@example.com` |
| Password | `Valid1234pass` | `Valid1234pass` |

## 3. Log in
1. Open `http://localhost:8788/` → the sign-in page.
2. Enter Studio A's email + password → sign in.
3. You land in the workspace. Open **Customers → Pipeline** from the top nav (or go to `http://localhost:8788/pipeline.html`).

---

## 4. Checklists + expected results

### Pages under test
`http://localhost:8788/pipeline.html` (Pipeline) · `/leads.html` (Messages) · `/crm.html` (Customers). Focus is these three sales surfaces (the account is Business-OS, so the "Website" editor is observe-only — that's expected, not a bug).

### A. Browser (desktop) — `pipeline.html`
| Check | Expected |
|---|---|
| Page loads on the shared shell (top bar, ⌘K, account menu); no console errors | Loads cleanly |
| **+ New deal** → dialog opens; title required; create | Deal appears in the list |
| Stage filter chips (All/Lead/Qualified/…) switch the list | List filters correctly |
| Open a deal → **only valid next-stage buttons** show | e.g. a Lead shows Qualified/Lost, never Won |
| Add proposal (inline form) → add line item + price | Draft proposal listed with total |
| Add agreement (inline form) → text → Send | Agreement listed; "link copied" toast |
| Convert step shows a **plan picker**; leave it (don't convert unless testing P2-C2) | Picker renders |
| Empty state (a fresh account) / loading skeleton / error (disable network) | Each renders, no blank screen |
| Deep link `pipeline.html?deal=<id>` opens that deal | Opens the deal directly |

### B. Browser — `leads.html` (Messages) + `crm.html` (Customers)
| Check | Expected |
|---|---|
| `leads.html` lists form submissions; **"→ Deal"** on one | Creates a deal + lands you in `pipeline.html?deal=…` (no re-typing) |
| `leads.html` Reply / Mark-read / Archive | Work as before |
| `crm.html` renders timeline + notes; add a note | Note saves + appears |

### C. Mobile (real device on LAN, or browser device-emulation ≤ 400px)
| Check | Expected |
|---|---|
| No horizontal page scroll on any of the 3 pages | Content fits |
| Cards, dialogs, and inline forms are tappable and fit the width | Usable one-handed |
| Shell mobile sheet (waffle App Launcher / bottom-bar Menu) opens; nav works | Opens, navigable |

### D. Keyboard only (no mouse)
| Check | Expected |
|---|---|
| Tab reaches every action; visible focus ring throughout | Focus always visible |
| Enter/Space activate buttons; dialogs open | Works |
| Esc closes dialogs; focus returns sensibly | Closes, focus restored |

### E. Screen reader (VoiceOver / NVDA)
| Check | Expected |
|---|---|
| Buttons + inputs are announced with a meaningful label | No "unlabeled button" |
| The deal list / toasts announce updates (`aria-live`) | Changes are spoken |
| Both light and dark themes keep text contrast legible | Readable in both |

### F. Isolation spot-check (optional, confirms the automated result by hand)
Sign in as **Studio B**, open `pipeline.html` → you should see **only B's deals**, never A's. (Automated step 3 already proved this 8/8.)

---

## 5. Record the result
Mark each row pass/fail. If something fails, note the page + step + what you saw. **Do not mark P2-C1 complete until every checklist item passes** (or a failure is triaged as a real defect to fix vs. a non-blocking cosmetic note).

## What this package is NOT
- Not prod. It's staging (`wjlpursnwbmlcdwbeowv`), where `0074` is applied.
- Not a config fork — the swap is in-memory only; committed pages are untouched.
- Not P2-C2 — don't exercise the full convert-to-customer unless you're deliberately smoke-checking it; P2-C2 is a separate, later milestone.
