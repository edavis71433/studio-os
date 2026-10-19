# Workflow map — the six things an operator does most

Click counts are for a signed-in studio operator on a desktop, counted on the
e2e fixtures (`tests/e2e/helpers/app.ts`) with the Phase 1 hub + the visual
refresh in place. "Target" is where Phases 2–4 of the overhaul plan (Studio OS
UX Review, Oct 2026) leave each one. The invoice "before" figure is the one
measured in that review on the pre-Phase-1 app; the other "before" paths were
not measured, so they are not guessed here.

| Workflow | Before | Now (Phase 1 + refresh) | Target (Phases 2–4) | What closes the gap |
| --- | --- | --- | --- | --- |
| Send a customer an invoice | 12 clicks, 5 pages | 3: Customers → the record → **Send invoice** → amount → Save (2 on the record itself) | 2 from anywhere: ⌘K "Send invoice to Claud" → amount → Save | Phase 2 global search with actions |
| Turn a new enquiry into a customer | — | 5+: Today → enquiry → **→ Deal** → new-deal form → Save, then proposal/agreement before Convert | 2: enquiry → **Convert** (creates contact + customer + optional deal) | Phase 2 one customer model; Phase 4 triage so spam never reaches this step |
| See who owes you and chase it | — | 2: Pipeline → Outstanding tile → "see who"; or the record's Outstanding tile → Resend | 1: Today's Outstanding tile and alert → Resend | Phase 3 one source for numbers (Today, Pipeline, Analytics, the bell agree) |
| Kick off a won deal's project | — | 2: record → **Open project**; the lifecycle bar names it as the next step | 2, plus the kickoff task and welcome message offered on the record | Phase 3 stage-aware actions |
| Approve a client's website change | — | 3: Today → **Review & approve** → Approve | 2: the same, with duplicates and test items gone from Needs you | Phase 3 dedupe by record id; Phase 4 onboarding cleanup |
| Reply to a client message | — | 3: Inbox → the conversation → type → Send; or 2 from the record (Message tab is one click) | 3, with each conversation listed once | Phase 4 enquiry triage; Phase 2 links so the Inbox row opens the right record |

## Rules the phases must keep

- One filled button per screen: the single most likely next action. Everything else is quiet or under **More**.
- The customer record is the hub. Every other surface links INTO it (rosters, pipeline cards, project headers, Inbox threads, ⌘K) and the record never sends you out to finish a money action.
- Counts come from one service and are deduped before they are shown. If Today says 4 things need you, the bell says 4 and Analytics says 4.
- The lifecycle bar on a record runs Lead → Qualified → Proposal → Agreement → Won → Project → Growth, so "what's next" is always on screen.
- Nothing destructive is one click: contact and file deletes confirm, with undo.
