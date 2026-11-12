# Walls between studios

The suites that prove one studio can't read or change another's data. They need a
real database: real sign-ins, the real row rules and the real servers. Builder item
212 (Nov 2026) made them run before every release, on a scratch database made for
the run and thrown away after it.

## How they run

`.github/workflows/isolation.yml` runs `scripts/isolation-scratch.sh` on a GitHub
runner. The script:

1. starts a scratch Supabase with Docker, made by the CLI version `deploy.yml`
   deploys with, and applies every migration production has. 0003 to 0005 are left
   out because production never applied them (they are fenced; ci.yml checks they
   stay in the folder);
2. serves `presence` and `clever-api` from the commit being checked, with made-up
   link secrets and no real keys;
3. seeds the DDS tenant and two studios (`scratch_seed.mjs`). Each studio has an
   owner who signs in, a client record with the owner's email, an active Presence
   entitlement, a website and its business details, the way the Sites page leaves a
   new one. The seed checks that each owner's sign-in opens their own website and not
   the other's before any suite runs;
4. runs the suites below. A suite that fails, skips itself, skips one of its checks,
   or never reports a pass fails the run: a skip means a suite didn't get what it
   needed, so it can't count as a pass.

It reads no repository secret. The keys are the scratch database's own and exist only
on that runner.

## When they run

- Before every production deploy: `deploy.yml` calls `isolation.yml` beside the
  pull request checks and the browser gate, and nothing deploys unless it passed. It
  takes about ten minutes and runs while the browser gate waits, so a deploy takes no
  longer.
- On a pull request that changes the workflow, the script or this folder.
- By hand: Actions, "Walls between studios (scratch database)", Run workflow.

Locally, with Docker running: `SUPABASE_CLI_VERSION=2.122.0 bash scripts/isolation-scratch.sh`.

## What runs

- `isolation_test.ts`, the tenant suite. Two tenants, a staff member and a client in
  each, with real sign-ins and the row rules: no reading, adding, changing or deleting
  across tenants; a client sees only their own invoices; leads stay in their tenant;
  clients can't use staff routes. Then the old server's door: no sign-in is refused,
  a staff member is refused an owner's route, a suspended tenant and a sign-in older
  than a role change are refused, the rate limit holds, each refusal writes one audit
  row, and staff and public traffic are counted in separate buckets. Since item 213
  it calls only request kinds a page still sends.
- Twelve suites in `tests/presence`, run as studio one and studio two against the
  presence server:
  - the three that exist for the walls: `sales_tenant_isolation_e2e`,
    `sales_closing_isolation_e2e`, `projects_isolation_e2e`. One studio can't read,
    change, move or attach to another's deals, contacts, proposals, contracts,
    projects, tasks or milestones, and a signed link made for one studio's proposal
    can't open another record;
  - nine end-to-end suites whose last checks are also cross-studio:
    `sales_e2e`, `sales_foundation_e2e`, `sales_closing_e2e`, `projects_e2e`,
    `project_comms_e2e`, `project_delivery_e2e`, `project_report_e2e`,
    `service_intake_e2e`, `service_lifecycle_e2e`.

## Left out on purpose

Five suites in `tests/presence` still need a live project and still skip in the pure
sweep: `admin_test`, `pipeline_test`, `room_test`, `service_test` and the optional
live tier of `evidence_test`. They walk publishing and hosting journeys (provision a
site on Netlify, publish, restore, change domains), and the scratch database has no
hosting. None of them is a wall between studios. They wait for a test copy of the
hosting service; until then their checks run only in the pure sweep's fixture-based
parts.

## Last run

- Before Nov 2026: by hand on the staging project `wjlpursnwbmlcdwbeowv`, last on
  2026-07-05, 22 of 22 passed. That project no longer exists.
- First full run on a scratch database: 2026-11-12, all 204 checks passed (GitHub
  Actions run 43218372665, commit c757c85). Every later run is on the Actions tab
  under "Walls between studios (scratch database)", and each run's summary says how
  many checks passed, the date and the commit.

Getting there found four things, all fixed in the same change:

- two signed-link refusals in `sales_closing_isolation_e2e` had passed on a broken
  token since Oct 2026 (the suite read the old link shape). With a real token they
  are refused as they should be, and the suite now also checks the token opens its
  own proposal first and that the other studio's proposal is left unchanged;
- signing has needed the signer's email since sales item 88, support links open
  inside the project since Jul 11, and a project made from a deal starts with the
  delivery checklist: three suites were brought up to date;
- two comments read like imports of missing files, which stopped the local
  `supabase functions serve`;
- presence's email sender now reads `RESEND_API_URL` (default unchanged), so the run
  can point it at a stand-in.

## Next

The suite will gain storage-path checks when files move to studio-prefixed paths.
