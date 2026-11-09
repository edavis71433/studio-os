# Migrations

Forward-only and numbered. Every schema change is a file here; none is made
only in the dashboard.

## File convention

    NNNN_short_name.sql

- `NNNN` is a zero-padded sequence number; `0000_baseline.sql` is the frozen
  production schema the sequence starts from (capture procedure:
  `docs/runbooks/ENVIRONMENTS.md` §C).
- Branches take numbers in parallel. Right before pushing a migration, check
  `main` and every open pull request for its number.
- Where the change can be undone, say how in a rollback note at the top:

      -- rollback: drop the two columns added below (alter table x drop column y);
      -- or, if irreversible:
      -- rollback: not reversible in place — restore from backup (see DR runbook)

- Never edit a migration once it has been applied — write the next one.

## Applying, as it works today

Nothing applies migrations automatically. There is no staging step and no
`supabase db push`: the deploy workflow ships the functions only. Production
gets each migration by hand:

1. The pull request that adds `NNNN_*.sql` also adds its apply pack,
   `docs/presence/APPLY-NNNN-prod.sql`: the same change written so it is safe
   to run more than once (`if not exists`, constraints dropped and re-added),
   ending with a read-only check query.
2. After the merge, and only with Eric's yes, the pack is run on production
   (the Supabase SQL editor, or the Supabase connector), and the check query's
   answer is read before the step is called done.
3. Code that reads new columns has to keep working until the pack has run:
   fall back to the old shape, or say the feature isn't available yet.

Apply packs start at 0109. Of the migrations since then, 0115 to 0120, 0123,
0127 and 0128 have no pack and no record of being applied; checking them
against production is its own piece of work.

## Older SQL kept for the record

`supabase/ops/clever-api-legacy/` holds `01-add-scheduler-columns.sql` and
`02-schedule-cron.sql`, run-once dashboard scripts from before this convention
existed (clever-api's daily scheduler; its nightly job is switched off on
production). Their effects are already in the live schema, so they are inside
`0000_baseline.sql`. They must not be re-run.
