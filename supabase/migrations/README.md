# Migrations

Forward-only, numbered, applied to staging first. No dashboard schema
changes. (Build Brief §2.7, §7.)

## File convention

    NNNN_short_name.sql

- `NNNN` is a zero-padded sequence number; `0000_baseline.sql` is the frozen
  production schema (capture procedure: `docs/runbooks/ENVIRONMENTS.md` §C).
- First line of every file is a rollback note:

      -- rollback: drop the two columns added below (alter table x drop column y);
      -- or, if irreversible:
      -- rollback: not reversible in place — restore from backup (see DR runbook)

## Applying

    npx supabase link --project-ref <STAGING_REF>
    npx supabase db push          # applies pending files in order

Production apply happens only after the same file has run green on staging
and Eric has approved. Never edit an applied migration — write the next one.

## Pre-existing SQL in the repo root

`01-add-scheduler-columns.sql` and `02-schedule-cron.sql` are historical
run-once dashboard scripts from before this convention existed. Their effects
are already part of the live schema and will therefore be inside
`0000_baseline.sql`. They stay in the root as documentation and must not be
re-run.
