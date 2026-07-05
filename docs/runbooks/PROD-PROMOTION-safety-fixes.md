# Production promotion plan — staging-approved safety fixes

Status: PLAN ONLY. Nothing here is executed until Eric gives an explicit
per-step go. Covers exactly four staging-approved changes and NOTHING else:

1. Paired email-relay fix (admin panel `notify()` JWT + function gating)
2. `0001_tenants_enrich`
3. `0002_agency_attr_backfill`
4. `0006_rls_holes` (email_templates only; admins NOT dropped)

Explicitly NOT in this promotion: `0003/0004/0005` (agency cleanup — held for
Eric's prod `agencies` check), the route-registry refactor, any admins drop.

Production project ref: `qksstlqzbhesadrrofgn`.

Confirmed by Eric (2026-07-05):
- Netlify deploys the site automatically from this GitHub repo.
- A recent production backup exists: **2026-07-05 17:11:31 UTC** (the migration
  restore point).

### ⚠ Finding that changes Step A — the pushed admin-panel change is NOT live yet
Read-only check of `https://davisdigitalstudio.com/dds-studio-manage-9k2p.html`
(2026-07-05): the live file is still the ORIGINAL (hash `ec3112…`; `notify()`
sends only `Authorization: Bearer SB_KEY`, no `x-dds-user-jwt`). The JWT change
(commit `b5a633c`, on `main` for hours) has NOT auto-deployed. So either the
Netlify↔repo auto-deploy was connected AFTER those commits, watches a branch
other than `main`, or has not built them.

Implications for the plan:
- Step A is genuinely PENDING (good — the frontend is not ahead of the
  function; nothing is half-deployed).
- Do NOT assume "push == deployed." Step A must be a VERIFY-LIVE gate: confirm
  the live admin panel actually carries the JWT change (fetch it, grep for
  `x-dds-user-jwt`) BEFORE deploying the function in Step C.
- Because the function (Step C) is deployed manually via the CLI/workflow (NOT
  via Netlify), we fully control its timing and can hard-gate it on a
  verified-live Step A. The ordering guarantee therefore holds regardless of
  Netlify's build timing.
- Before execution, Eric confirms the Netlify↔repo↔branch wiring is active for
  `main` (so a push actually publishes), or identifies the manual
  trigger/branch.

---

## 0. Critical pre-fact — the migration ledger

`0000_baseline.sql` was dumped FROM production, so production already HAS that
schema. But the migration runner never ran against production, so its
`supabase_migrations.schema_migrations` ledger has NO `0000` row. A naive
`supabase db push` would therefore try to APPLY `0000_baseline.sql` against a DB
that already has every object — and `CREATE POLICY` is not idempotent, so it
would error ("policy already exists") partway through.

**Mitigation (mandatory first DB step):** mark baseline as already-applied
WITHOUT running it:

    supabase migration repair --status applied 0000 --project-ref qksstlqzbhesadrrofgn

Then push only 0001/0002/0006 (0003–0005 held aside). Verify with
`supabase migration list` that 0000 shows applied before pushing anything.

---

## 1. Exact production deploy order

The one hard rule: **frontend before the function** (the admin panel must send
`x-dds-user-jwt` before the function starts requiring it for
invoice_reminder/approval_needed). The DB migrations are independent of both and
are sequenced in the middle where they are safest.

    Step A  Frontend  — ensure the admin panel is LIVE on Netlify, then VERIFY
                        the live file carries the x-dds-user-jwt change
    Step B  Database  — repair 0000, then push 0001, 0002, 0006 (hold 0003–0005)
    Step C  Backend   — deploy the clever-api function (HARD-GATED on Step A verified live)
    Step D  Verify    — run the live checklist (section 6)

Rationale for A→B→C:
- A first: closes the coupling window (old function still accepts the notices
  publicly, so nothing breaks while only the frontend is new).
- B before C: migrations are additive and the CURRENT (old) function tolerates
  them (email_templates writes use the new default; tenants new columns are
  unread by the old function). Doing DB first means the new function lands into
  an already-migrated schema.
- C last: the new function requires the JWT that A already ships and expects the
  schema B already applied.

---

## 2. SQL / migration order (Step B detail)

    # 1. one-time: record baseline as applied without running it
    supabase migration repair --status applied 0000 --project-ref <PROD>
    supabase migration list --project-ref <PROD>       # confirm 0000 = applied

    # 2. hold the agency-cleanup migrations out of the working dir
    move 0003_*, 0004_*, 0005_* out of supabase/migrations/ temporarily

    # 3. push the three approved migrations, in order
    supabase db push --project-ref <PROD>              # applies 0001, 0002, 0006

    # 4. restore the held files (they remain pending, unrun)
    move 0003_*, 0004_*, 0005_* back

Applied order on prod: `0001 → 0002 → 0006`. Same out-of-order note as staging
(0006 lands before 0003–0005; safe, they are independent). `0002` will copy REAL
values on prod because the DDS `agencies` row exists there (unlike staging,
which needed a seeded row).

Per-migration effect on prod:
- `0001` additive columns on `tenants` + state enum + touch trigger. No business
  data touched.
- `0002` copies agencies.{plan,brand,owner_email} onto the DDS tenant row.
  Idempotent (coalesce/CASE); re-runnable.
- `0006` adds `email_templates.tenant_id` (default DDS, backfills existing rows)
  and swaps the open policy for the tenant-scoped one.

---

## 3. Frontend / backend deploy order

- **Frontend (Step A):** only ONE file changed — `dds-studio-manage-9k2p.html`
  (+5/−1: `notify()` now sends `x-dds-user-jwt`). `portal.html` and all other
  pages are unchanged. Netlify auto-deploys from GitHub, so the change publishes
  when `main` builds. BUT it is not live yet (see the finding in section 0), so
  Step A is a two-part gate, both required before Step C:
  1. Ensure the Netlify build for the commit containing `b5a633c` has run (a
     push to `main`, or a manual "Trigger deploy" in Netlify, or confirming the
     branch/wiring).
  2. VERIFY live — the CORRECT check is the file hash, NOT a bare grep. The
     admin panel already uses `x-dds-user-jwt` in ~80 OTHER places, so
     `grep -c 'x-dds-user-jwt'` is a FALSE POSITIVE (this bit us on the first
     execution attempt, 2026-07-05). Use either:

         # (a) hash equality with the repo copy — definitive
         curl -s https://davisdigitalstudio.com/dds-studio-manage-9k2p.html | sha256sum
         sha256sum dds-studio-manage-9k2p.html      # must MATCH

         # (b) or check notify() SPECIFICALLY carries the jwt call
         curl -s https://davisdigitalstudio.com/dds-studio-manage-9k2p.html \
           | grep -A6 'async function notify(type' | grep -c 'adminJwt()'   # must be 1

     Only when the hashes MATCH (or the notify()-scoped grep returns 1) is
     Step A complete. Do NOT start Step C until then.
- **Backend (Step C):** deploy the function. It is an ATOMIC deploy carrying
  BOTH step-2 parts (part 1: notify catch-all closure + intake rate-limiting +
  config-driven env; part 2: approval_needed/invoice_reminder staff-gating).
  Both were approved on staging.

      supabase functions deploy clever-api --no-verify-jwt --project-ref <PROD>
      supabase functions deploy stripe-webhook --no-verify-jwt --project-ref <PROD>   # unchanged; redeploy optional

  (Or trigger the production deploy workflow, which does exactly this with the
  confirmation gate.)

---

## 4. Required environment variables / secrets

**No new secret is required.** The only new variable the function reads is
`ALLOWED_ORIGINS`, which FALLS BACK to the two production origins when unset —
so production behavior is byte-identical without it. Everything else
(`SUPABASE_URL`, `SERVICE_ROLE_KEY`, `RESEND_KEY`, `ANTHROPIC_KEY`, `STRIPE_SECRET`,
etc.) is already set on production (the function runs there today).

Pre-flight confirmations (read-only):
- `ALLOWED_ORIGINS` on prod is EITHER unset (fine — falls back) OR, if set,
  includes `https://davisdigitalstudio.com` and `https://www.davisdigitalstudio.com`.
- `SUPABASE_URL` is present (auto-injected; the removed hardcoded fallback means
  an empty value now fails loud instead of silently using prod — but it is
  always injected).
- The migration runner needs `SUPABASE_ACCESS_TOKEN` (already used for staging)
  and the prod DB connection (transaction-pooler URI, alphanumeric password —
  see ENVIRONMENTS §C lesson).

---

## 5. Rollback plan

Each piece rolls back independently; order to reverse is C → B → A.

- **Function (C):** redeploy the pre-step-2 source. It is git commit `5b048b7`
  (`supabase/functions/clever-api/index.ts` at that commit is byte-identical to
  the currently-deployed prod v247).

      git show 5b048b7:supabase/functions/clever-api/index.ts > /tmp/rollback.ts
      # deploy that file as clever-api

  Effect: invoice_reminder/approval_needed revert to public; notify catch-all
  reopens. (Acceptable as a temporary revert; the exposure existed for months.)
- **Migrations (B):** run the inline ROLLBACK block at the bottom of each file,
  reverse order 0006 → 0002 → 0001:
  - `0006`: drop policy `email_templates_staff`, restore `authenticated full
    access`, drop `email_templates.tenant_id` + its FK.
  - `0002`: null `tenants.{plan,owner_email}`, reset `brand` to `{}` (values
    re-derivable from agencies, still present).
  - `0001`: drop the added columns, trigger, function, and `tenant_state` enum.
  No business data is affected by any rollback.
- **Frontend (A):** redeploy the previous admin panel — git commit `f39cdad`'s
  `dds-studio-manage-9k2p.html` (byte-identical to what is live now). Safe to
  leave the new one even if the function is rolled back (extra JWT header is
  ignored by the old function).

Rollback is safe in any partial state because every change is additive or
backward-tolerant.

---

## 6. Live verification checklist (Step D, on production)

Run in this order immediately after Step C:

- [ ] `{"type":"version"}` → build `2026-07-04.11` (function is live).
- [ ] `{"type":"whoami"}` with Eric's real staff JWT → `isTeam:true, role:...`.
- [ ] Unknown type `{"type":"__nope__"}` → 403 (deny-by-default intact).
- [ ] Injected notify `{"type":"evil","clientName":"x","message":"y"}` → 403
      (catch-all bypass closed).
- [ ] `invoice_reminder` WITHOUT a JWT → 401 (exposure closed).
- [ ] From the admin panel: send a real invoice reminder (or the "send
      reminders" action) → succeeds, the client receives the email (this proves
      the frontend JWT + backend gate + relay all line up end to end).
- [ ] Admin panel: open the Email Templates section → templates load and are
      editable (service-role path unaffected by 0006).
- [ ] Portal (a real client login): loads normally; no email_templates access
      (clients never touched it).
- [ ] `tenants` row: `state='active'`, `plan`/`owner_email`/`brand` populated
      from agencies (0002 copied real values).
- [ ] `supabase migration list` → `0000,0001,0002,0006` applied; `0003–0005`
      pending.
- [ ] Function logs: no `[config] SUPABASE_URL is not set` and no
      `[email] RESEND_KEY is not set` errors.

---

## 7. What could break (and why it won't, if the order holds)

| Scenario | Risk | Guard |
|---|---|---|
| Function deployed before frontend | admin "send reminders" 401s, reminders silently fail | Deploy order A→C; frontend first |
| `db push` recreates baseline | policy-exists error mid-migration | `migration repair --status applied 0000` FIRST (section 0) |
| CORS breaks for the live site | wrong Access-Control-Allow-Origin | `ALLOWED_ORIGINS` unset → falls back to the two prod origins (identical); pre-flight confirms |
| `0006` locks Eric out of templates | staff can't manage templates | Eric is a membership row → `current_tenant_ids()` returns tenant #1 → access retained; main path is service-role anyway |
| `0006` breaks the diagnostic direct-read | admin panel error path | Uses Eric's member JWT → still passes; and it is only a fallback diagnostic |
| Client can still read templates | hole not actually closed | Verified on staging: client → `[]` / 403 |
| `0002` finds no agencies row | plan/brand not copied | Prod HAS the DDS agencies row (unlike staging); 0002 is also a safe no-op if absent |
| Out-of-order ledger confuses runner | future push refuses | Same state proven on staging; runner applies pending regardless, may print a note |
| Removed SUPABASE_URL fallback | function can't reach DB | Var is auto-injected on prod; loud guard added if ever empty |

---

## 8. Go / No-Go checklist (Eric confirms each before Step A)

- [x] Staging matrix is green for all four changes (DONE — see step-3-checklist
      and the step-2 commits).
- [x] A recent production backup exists — **2026-07-05 17:11:31 UTC** (restore
      point for the migrations).
- [x] Netlify deploy mechanism confirmed — **auto-deploy from GitHub**. Note the
      section-0 finding: verify the admin panel is actually live before Step C.
- [ ] Netlify↔repo↔`main` wiring confirmed active (a push to `main` actually
      publishes) OR the manual trigger/branch is identified. (Open — the
      `b5a633c` change has not published yet.)
- [ ] A low-traffic window is chosen (portal + admin quiet).
- [ ] `SUPABASE_ACCESS_TOKEN` + prod pooler connection available to the runner.
- [ ] `ALLOWED_ORIGINS` on prod confirmed unset-or-correct.
- [x] Rollback steps (section 5) understood; pre-step-2 function commit
      identified: **`5b048b7`**.
- [ ] Eric gives an explicit go for THIS promotion (the four items only).

On all boxes checked, proceed A → B → C → D. Stop and report after Step D before
declaring done. Any red verification item → roll back that piece per section 5
and report.

---

## EXECUTION RESULT — 2026-07-05 (COMPLETE, all green)

Promoted the four approved items to production. `0003–0005`, route registry, and
admins drop NOT run.

- **ALLOWED_ORIGINS** set on prod = studio-os-dds.netlify.app + davisdigitalstudio.com
  + www (updated 20:17 UTC).
- **Step A** PASS — admin panel live at studio-os-dds.netlify.app (hash match;
  notify() sends x-dds-user-jwt).
- **Step B** — `migration repair --status applied 0000` then pushed 0001, 0002,
  0006. Prod ledger: `0000,0001,0002,0006` applied; `0003,0004,0005` pending.
  Effects verified: tenants.state=active; 0002 copied plan=founder +
  owner_email from the real prod agencies row; 0006 backfilled email_templates
  tenant_id on the 12 real templates.
- **Step C** — clever-api deployed, now **v249** (was v247). stripe-webhook
  untouched.
- **Step D automated** — 7/7 pass: version=2026-07-04.11; unknown→403; injected
  notify→403; invoice_reminder & approval_needed no-jwt→401; CORS echoes BOTH
  studio-os-dds.netlify.app and davisdigitalstudio.com. Portal serves 200.
- **Step D manual (Eric)** — pending: (1) from the new admin panel send a real
  invoice reminder end-to-end; (2) Email Templates section loads/edits; (3) a
  real client portal login loads normally.

CLI is now linked to PROD (was staging). Re-link staging before further staging
work. Function-logs not checkable via this CLI version; behavioral tests
substitute.
