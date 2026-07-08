# Phase M (round 2) — Site Operations & Feature Optimization

*A second optimization pass, built on a deep two-survey member-experience audit of every signed-in surface. The goal was smoother operations, not more features — reduce clicks, remove dead ends, make the next step obvious. Consolidates the Site Operations / Workflow / Cross-Workspace / per-workspace optimization reviews + the Feature Discovery update.*

---

## Executive summary

Two full file surveys (core member pages + the onboarding/secondary pages) produced a ranked, line-anchored friction list. The clear, safe, V1 wins were **implemented directly** across `leads.html`, `schedule.html`, `today.html`, and `crm.html`; the bigger items were triaged to V1.1 and tracked (FD-M1…M12). No architecture change, no duplicated systems, no new features — purely making what exists easier and clearer. Full pure regression green (invariants 14/14); pages parse-clean; frontend-only, so no redeploy.

---

## Step 1 — Discovery (what the audit found)

The recurring friction across surfaces:
- **Error/empty states were manual-refresh dead ends** — every "trouble" state told the member to reload the browser; nothing offered a retry.
- **The highest-value action (replying to a lead) was unassisted** — a bare `mailto:`, no `tel:` for phone leads, and leads had to be marked read by hand.
- **Scheduling was done "blind"** — a member froze and time-released a draft with no way to see what would publish and no timezone cue.
- **Small polish gaps** — a dismissed moment left a dimmed inert card; a moment's "walk me through it" asked a fix-framed question regardless of the moment; an all-clear day offered no next step; a leads filter's label didn't match its key.

---

## Step 2 — Operational optimizations (implemented)

**Lead management (`leads.html`)** — the single most business-critical workflow, now assisted:
- **Prefilled reply** — the reply email opens with a subject, a greeting by first name, and the customer's message quoted, instead of a blank draft.
- **`tel:` links + a "Call" action** for phone-only leads (previously plain, un-tappable text with no action).
- **Auto-mark-read on reply** — replying clears the "new" state; no manual bookkeeping.
- **Filter coherence** — the "Open / New / All" filters now use keys that match their labels.
- **"Try again"** retry on the error state.

**Scheduling (`schedule.html`)** — no longer blind:
- **"Preview your draft" link** so the member sees exactly what will publish before scheduling it.
- **Local-timezone hint** on the time field + a `min` that blocks past times in the picker.
- **"Try again"** retry.

**Business Moments / Today (`today.html`)**:
- **Clean dismiss animation** (fade + remove, reduced-motion aware) instead of a dimmed, inert leftover card — matching the workspace's behavior.
- **Neutral, contextual concierge question** ("What does this mean, and what should I do about it?") instead of a fix-framed one — right for reminders and opportunities, not just problems.
- **A doorway in the all-clear state** (open website · see leads) so a quiet day still offers a next step.

**Relationship (`crm.html`)** — **"Try again"** retry on the error state.

Every change reduces clicks or confusion and increases trust; none adds a system.

---

## Step 3 — Cross-workspace review

The unified shell (Phase C1) keeps the frame constant, so *where am I / how do I get back* is answered everywhere. This pass improved *what happens next*: Today's all-clear now points into the website and leads; scheduling points to preview; leads points to the relationship view (and vice-versa). Transitions between CMS ↔ CRM ↔ Business OS ↔ Client Portal remain one-shell, one-nav, with the new doorways making the connective tissue more visible. The audit did flag deeper cross-surface inconsistencies (the self-serve secondary pages use four different nav patterns; the signup→welcome handoff lacks the guided checklist that portal.html has) — those are tracked (FD-M5, FD-M12), not V1-blocking.

## Step 4 — Site operations review

Publishing, preview, scheduling (now with a preview + timezone), restore/rollback, SEO (auto from structure), redirects, media, forms, **leads (now assisted)**, Business Moments (now cleaner), connected (auto-refresh verified), monitoring (`/system/health` dashboard from Phase J), notifications, search (palette), exports/imports, recovery — all present and, after this pass, more polished at the exact friction points a premium SaaS would be judged on.

## Step 5 — Customer experience (personas)

- **Freelancer / business owner:** the two moments that felt unpolished — replying to a lead and scheduling — are now assisted and transparent.
- **Agency:** same wins per client; nothing new to learn.
- **Client reviewer / developer / operator:** unchanged surfaces; the retry pattern removes their dead ends too.

---

## Per-workspace optimization notes

- **CMS (presence.html):** untouched by this pass (deliberately — no editor surgery without a browser); audit flagged `#welcomeWrap` container contention + all-closed hours default → tracked (FD-M12), not changed.
- **CRM:** retry added; optimistic note-update (avoid full reload) tracked (FD-M11).
- **Client Portal:** benefits from the studio-side leads/approval polish; reviewer surface unchanged.
- **Admin / Agency / Developer / Enterprise:** unchanged; no friction of consequence found beyond what's tracked.

---

## Step 6/7 — Feature discovery + what was deferred

**Implemented (V1, this pass):** the leads/schedule/today/crm wins above.
**Tracked V1.1 (documented, not built):** FD-M1 auto-draft starter site · FD-M5 guided self-serve welcome · FD-M6 auto-populate brief · FD-M7 magic-link invites · FD-M8 proactive Google-connect · FD-M9 AI alt-text/multi-photo/PDF import · FD-M10 surface Coach on Today · FD-M11 optimistic UI + light polling · FD-M12 smart hours default + self-serve nav shell. **Also queued (V1 hardening/compliance):** FD-M2 rate limiting on public endpoints · FD-M3 legal pages on customer sites · FD-M4 account deletion. All in the [Feature Discovery Queue](FEATURE-DISCOVERY-QUEUE.md).

---

## Testing

Pages parse-clean; full pure regression green — nav_integrity 3/3, editions 36/36, shell 18/18, workspace 38/38, commercial 25/25, crm 24/24, devmode 41/41, render 28/28, commerce 38/38, activation 10/10, **invariants 14/14**. Frontend-only changes → no function/migration change, no redeploy. The authed browser pass over these surfaces is the standing human-QA step (Phase K).

---

## Final Questions (answered honestly)

- **Does Studio OS now feel effortless to operate?** **More so than before this pass** — the specific rough edges (replying to leads, scheduling blind, refresh-dead-ends) are gone. The daily loop is click-light and the next step is usually obvious.
- **Can a freelancer run multiple clients / an agency manage many businesses?** **Yes** — one shell, per-client relationship, assisted leads, transparent scheduling.
- **Can a business owner accomplish common tasks without confusion?** **Yes** — and the two most-common friction moments are now assisted.
- **Can a developer customize safely / an operator support quickly?** **Yes** — unchanged and intact.
- **Do all the workspaces feel like one cohesive operating system?** **Yes** — the shell frames everything; the new doorways strengthen the connective tissue.
- **Is there anything that still feels awkward?** Honestly, three things, all tracked, none V1-blocking: the **self-serve onboarding lacks the guided checklist** the agency portal already has (FD-M5); a few **automations are latent, not surfaced** (the starter-site drafter is manual — FD-M1); and the **secondary self-serve pages don't share one nav shell** (FD-M12). And the browser-QA pass (Phase K) still owes these pages a real device check.
- **Is there anything that should be optimized before launch?** The highest-value *pre-launch* optimization is **FD-M1 (auto-draft the starter site at first-run)** — it's the difference between a new member facing a blank workspace and being handed a complete draft to review. It's automation, not a new feature (the engine exists), so it fits this milestone's spirit — but it's a meaningful build, so it's flagged for a decision rather than slipped in here.

---

**Phase M — Site Operations & Feature Optimization complete.**
