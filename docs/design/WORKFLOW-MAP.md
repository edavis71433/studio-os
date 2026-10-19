# Workflow map — the six things an operator does most

Click counts are for a signed-in studio operator on a desktop, counted on the
e2e fixtures (`tests/e2e/helpers/app.ts`) with the Phase 1 hub + the visual
refresh in place. "Target" is where Phases 2–4 of the overhaul plan (Studio OS
UX Review, Oct 2026) leave each one. The invoice "before" figure is the one
measured in that review on the pre-Phase-1 app; the other "before" paths were
not measured, so they are not guessed here.

| Workflow | Before | Now (Phase 1 + refresh) | Target (Phases 2–4) | What closes the gap |
| --- | --- | --- | --- | --- |
| Send a customer an invoice | 12 clicks, 5 pages | 2 from anywhere: ⌘K "Send invoice to Claud" → amount → Save (Phase 2); 3 via Customers → the record → **Send invoice** | done | — |
| Turn a new enquiry into a customer | — | 2: enquiry → **Make customer** → confirm (contact + customer + optional deal, Phase 2); spam and not-a-fit never reach the queue (Phase 4) | done | — |
| See who owes you and chase it | — | 2: ⌘K "invoice" → the open invoice (Phase 2); Pipeline → Outstanding tile → "see who". Today, Pipeline, Analytics and the bell now agree (Phase 3) | 1: an Outstanding tile on Today | a Today stat strip (not yet built) |
| Kick off a won deal's project | — | 2: record → **Open project**; the lifecycle bar names it as the next step | 2, plus the kickoff task and welcome message offered on the record | Phase 3 stage-aware actions |
| Approve a client's website change | — | 3: Today → **Review & approve** → Approve, one row per record (Phase 3) | done | — |
| Reply to a client message | — | 3: Inbox → the conversation → type → Send, each person listed once (Phase 4); 2 from the record or ⌘K "Message Claud" (Phase 2) | done | — |

## Rules the phases must keep

- One filled button per screen: the single most likely next action. Everything else is quiet or under **More**.
- The customer record is the hub. Every other surface links INTO it (rosters, pipeline cards, project headers, Inbox threads, ⌘K) and the record never sends you out to finish a money action.
- Counts come from one service and are deduped before they are shown. If Today says 4 things need you, the bell says 4 and Analytics says 4.
- The lifecycle bar on a record runs Lead → Qualified → Proposal → Agreement → Won → Project → Growth, so "what's next" is always on screen.
- Nothing destructive is one click: contact and file deletes confirm, with undo.
