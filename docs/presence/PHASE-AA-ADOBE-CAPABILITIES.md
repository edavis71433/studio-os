# Phase AA — Adobe Enterprise Capability Implementation

*Applies the strict implementation filter (improves V1 ∧ fits the Constitution ∧ removes complexity ∧ improves browser authoring ∧ helps customers+freelancers+agencies ∧ no duplicate architecture) to every item from the [AEM Spec Comparison](AEM-SPEC-COMPARISON.md). Implemented what passed; classified the rest honestly.*

## Decisions (the specific items)

| Item | Verdict | Reasoning |
|---|---|---|
| **Named Versions (FD-7)** | **✅ IMPLEMENTED** | passes every filter clause: tiny, constitutional, pure browser-authoring win for all three audiences ("Spring menu" beats a timestamp) |
| **Availability Statement** | **✅ IMPLEMENTED** | customer-facing reliability promise on `help.html` (honest: static-CDN sites survive platform outages; every version restorable; no maintenance windows; provider SOC 2) — the AEM-Managed-Services commitment, in plain words |
| **Enterprise Service Description** | ✅ already done | [TECHNICAL-REQUIREMENTS-AND-SERVICE-DESCRIPTION](TECHNICAL-REQUIREMENTS-AND-SERVICE-DESCRIPTION.md) (prior turn) |
| Operational docs surfaced in-product | ✅ (existing + new) | the Foundations Desk already surfaces infra posture in plain words; the new help.html reliability section completes it |
| FD-AEM1 Headless API | V1.1+ | doesn't improve *V1* (new market surface); the snapshot is already headless-shaped, so no urgency |
| Visual version compare (FD-12) | V1.1 | real diff-rendering work; change-summary sentences cover V1 |
| Launches (FD-T7) | V1.1 | a second draft lane is genuine architecture work — not rushed at the launch gate |
| Content reuse (FD-18/B5) | V1.1 top | unchanged — the agency multiplier, sized beyond this milestone |
| Translation (FD-R4) | V1.1+ decision | unchanged |
| Enterprise browser workflows | V1.1 (P12 flag) | operator-flagged until their UIs exist — deliberate |
| Any *additional* Adobe capability for V1? | **No** | the comparison accounted for all 60; nothing else passes the filter |

## Named Versions — what shipped (verified)

- **Migration 0053**: `presence_publishes.version_label` (additive; applied staging + prod).
- **`POST /publishes/:id/label`**: set/rename/clear (empty) the name on any kept version — site-scoped, 60-char cap, control-chars stripped, provenance-logged ("Named a kept version 'Spring menu'"). Route smoke-verified (unauth → 401).
- **History payload** carries `label`; the **journal UI** leads a named version with **"Name" — summary**, and every live version gets a "Name it"/"Rename" inline affordance (input, Enter/blur saves, Escape cancels — same pattern as alt-editing).
- Restore/preview/rollback untouched — a name is metadata on the journal, never a second history.

## Availability statement — what shipped

A "Reliability & your website's uptime" section on help.html: static-CDN sites keep serving through platform outages, every published version kept + one-click restorable, zero-downtime deploys ("your site never goes down for updates"), infrastructure with published SLAs + SOC 2, and the plain-words incident promise. The formal operator-facing posture lives in the Technical Requirements doc; self-declared uptime numbers wait until we can measure them (FD-S1/S2 — honest).

## Testing

deno check clean · presence.html parse-clean · migration 0053 applied both envs · function deployed both envs · live room 38/38 + pipeline 30/30 post-deploy · label route smoke (401 unauth) · pure sweep green (business_classic 28/28, render 28/28, commercial 30/30, pricing 14/14, editions 36/36, invariants **14/14**).

## Final questions (honest)

- **Does Studio OS now deliver the enterprise strengths that matter without becoming Adobe?** **Yes.** The strengths that matter to our market — versioned trust (now with names), approval governance, audit trails, correct-by-construction SEO/a11y, a written service description, and a plain-words reliability promise — are all present. What makes AEM *Adobe* (freeform authoring, personalization engines, agent fleets, enterprise PM tooling) is absent on purpose.
- **What's intentionally absent?** Drag-and-drop authoring, personalization/targeting, project dashboards, runtime componentization, on-site search at brochure scale, self-hosted deployment matrices — each rejected in writing with constitutional reasoning across T4/AEM-comparison/this phase.
- **Any additional Adobe-inspired improvements before launch?** **No new ones** — the remaining Adobe-class items (Launches, visual diff, reuse, headless, translation) are correctly V1.1: each is real architecture that would delay launch without changing what a V1 customer can do this month. The pre-launch path stays: FD-R1 (lifecycle comms/policy) → activation → browser QA (now including "Name it" + the help section) → front door → push.

**Phase AA — Adobe Enterprise Capability Implementation complete.**
