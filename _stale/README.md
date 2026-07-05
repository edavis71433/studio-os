# _stale/ — quarantined files. DO NOT DEPLOY ANYTHING IN THIS FOLDER.

Every file here is a superseded copy of the `clever-api` Edge Function (or its
deploy manifest) kept for history only. Deploying any of them would delete
dozens of production routes. See `docs/adr/0001-canonical-clever-api-source.md`
for the evidence and the rule.

The one and only deployable source is:

    supabase/functions/clever-api/index.ts

| File | What it is | Why it is stale |
|---|---|---|
| `notify-client-2026-07-05.ts` | 8,702-line sibling snapshot of clever-api (was inside `clever-api.zip`) | Missing ~40+ routes the deployed build has (no `DDS_BUILD`, no `PUBLIC_ROUTES`, no PI/quotes/lifecycle modules) |
| `clever-api.repo-copy-2026-07-04.ts` | 8,049-line copy from the site repo root | Strict subset of notify-client (missing `invoice_paylink`, opportunities, sales_moves, and everything newer) |
| `clever-api-COMPLETE-2026-06-24.ts` | 889-line ancestor from `_internal/` | Months of routes behind; was still named as the deploy target by the June 24 manifest |
| `bright-service-clever-api-LEGACY.ts` | 226-line legacy email-only stub (dashboard download of the `bright-service` function) | Pre-dates the entire platform; had a hardcoded Resend key (rotated dead on 2026-07-02, redacted here). If a `bright-service` function is still deployed in Supabase, delete it there too. |
| `DEPLOY-MANIFEST-2026-06-24-SUPERSEDED.txt` | June 24 deploy manifest | Named `clever-api-COMPLETE.ts` as the deploy target; that instruction is void. It has also been removed from `davis-digital-studio-main.zip`. |

History note: the repo-file-vs-deployed-reality mismatch caused real production
incidents (see MASTER-CHECKLIST.md item 1, and the "PORTED PRODUCTION ROUTES"
banner inside the deployed function itself). This folder exists so those files
can never be mistaken for deployable again.
