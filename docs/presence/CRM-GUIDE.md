# CRM — Guide

*The one guide for the Client Relationship Center (Phase C). Studio OS's CRM is an **operational relationship hub**, not a sales CRM: it aggregates what the platform already records into one calm per-client view, plus relationship notes. Sections below double as the CRM, Agency, Enterprise, Customer, Operational, Architecture, Integration, and Permission guides.*

---

## The one principle

**The CRM is a lens, not a datastore.** With one exception (relationship notes), it stores nothing new — it reads publishes, content changes, connected events, Business Moments, and pending approvals, and presents them as one calm relationship view. It never sells, scores, or manages a sales pipeline. If a feature exists mainly to mimic another CRM and doesn't strengthen relationships, improve operations, reduce friction, or increase trust, it isn't here — it's in the Feature Discovery Queue.

---

## CRM Guide (what it is, how to use it)

Open **Relationship** (`/crm.html`) from Today or, for agencies, from a client in the portfolio. You see:

- **Profile + health** — the business name, a calm health word (*Healthy · Needs attention · Getting set up*), and a one-line plain-language summary of where things stand.
- **Quick facts** — website live/last-published, approvals waiting, connected services (and how many need a look), moments worth a look, team with access.
- **Relationship notes** — internal (studio-only) and shared (the client can see). Add, pin, remove.
- **Activity** — a unified, newest-first timeline: publishes, content changes, connected events, moments, approvals, and notes, each in plain language.
- **Open in context** — doorways to the real surfaces (Moments, Connected, Website & publishing, Sharing, Export). The CRM connects them; it doesn't replace them.

Nothing to configure. Nothing auto-acts — every change still flows through approval.

---

## Agency Guide

The **agency portfolio** (`/agency.html`) is the roster (search, tags, health at a glance). Drilling into a client opens the **relationship view** for that client — the operational detail. Together they are the operating system over many businesses: roster → relationship → act (in context). Internal notes are visible to agency members and operators; shared notes reach the client. Tags live on the agency client record and are surfaced here, not re-modeled.

---

## Enterprise Guide

Enterprise needs no separate CRM. The relationship view reads per **site/location**, and the existing Organization→Region→Location model (M13/L5.6) provides the roll-ups. An enterprise sees each location's relationship view with the same calm health and activity; org-level queues already exist in the agency/enterprise surfaces. (Enterprise *procurement* concerns — SSO, SOC 2, SLA — are separate from the CRM and tracked from A9.)

---

## Customer Guide (the business owner)

If you own the business, Relationship is your calm "account" view: is my site live, what changed recently, what's waiting for my approval, which services are connected. You see **shared** items — not your studio's internal notes. You can leave a note for your studio, and export everything you own at any time. No scores, no dashboards, no upsells.

---

## Operational Guide (daily use)

- **Start of day:** open Relationship for a client → the health chip + summary tell you if anything needs attention.
- **Something pending?** the approvals fact + timeline show what's waiting; the doorway opens the approval flow.
- **Keep context:** drop an internal note (a call, a decision) so the relationship has memory; share a note when the client should see it.
- **Hand off:** any teammate opening the view sees the same history — the timeline is the shared memory and the human-facing audit.

The view collapses 4–5 surfaces into one; you act by following a doorway, never by leaving the relationship behind.

---

## Architecture Guide

```
  agency.html (roster) ──▶ crm.html (relationship)
                                │  /crm/profile · /crm/timeline · /crm/notes
                                ▼
        ┌───────────── routes/crm.ts (audience: studio vs client) ─────────────┐
        │  crm/store.ts  — aggregators (read-only over existing tables)         │
        │    publishes · change_events · connection_events · moments ·         │
        │    infra_plans · connection_writes · site_members · connections      │
        │  crm/contract.ts — pure: normalizers · audience rule · health ·      │
        │    summary · merge/cap                                               │
        │  presence_relationship_notes — the ONE new table (internal/shared)   │
        └──────────────────────────────────────────────────────────────────────┘
```

- **Pure core** (`crm/contract.ts`): tested in isolation (24 tests) — normalizers, audience filter, merge/sort/cap, calm health, summary, note validation.
- **Aggregators** (`crm/store.ts`): parallel, capped queries; no N+1.
- **Routes** (`routes/crm.ts`): reached through the normal site gate; the reviewer boundary already refuses `/crm/*`.
- **One new table**: `presence_relationship_notes`, deny-all RLS, function-mediated, soft-delete.
- **Frozen spines untouched**: Intelligence Pipeline and Approved-Plan Lifecycle unchanged; invariants 14/14.

---

## Integration Guide

The CRM surfaces (not rebuilds) every capability:

| Capability | In the CRM | Where it's managed |
|---|---|---|
| Publishing / versioning / rollback | timeline events | the room / Developer Mode |
| Business Moments | active count + timeline | today.html |
| Connected Platform | count + needs-attention + events | connections.html |
| Approvals | pending count + timeline | approval flow (foundations/connections) |
| Developer Mode | dev-layer publish shows as a publish | developer.html |
| People/access | team count | sharing.html |
| Ownership | Export doorway | `/export` |
| Billing | link out | commerce surface |

Every integration is read-only aggregation + a doorway. No engine was modified.

---

## Permission Guide

The CRM introduces **no new permission or visibility model** — it reuses existing signals:

- **Reviewer (client portal audience):** cannot reach `/crm/*` at all (the A7.2 reviewer boundary refuses non-whitelisted routes). Relationship is a workspace surface.
- **Client side (business owner on their own account):** sees the profile, **shared** notes, and the shared timeline (publishes, changes, connected, moments, approvals). Never sees studio-internal notes or internal-note changes.
- **Studio side (operator + agency member):** sees everything, including internal notes and internal items; can pin/remove notes.
- **Audience enforcement** is server-side in `routes/crm.ts` (`isStudioSide` = operator/system principal OR agency membership) and in the store (internal notes filtered out for the client side). Deny-all RLS underneath.

Authoring: internal notes require the studio side; shared notes may be authored by anyone with workspace access (a two-way relationship record). Pin/remove is studio-side.

---

*See also: [PHASE-C-CRM](PHASE-C-CRM.md) (discovery, feature triage, final questions), [WORKSPACE-EXPERIENCE-A72](WORKSPACE-EXPERIENCE-A72.md), [FEATURE-DISCOVERY-QUEUE](FEATURE-DISCOVERY-QUEUE.md).*
