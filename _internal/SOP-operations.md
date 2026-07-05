# Davis Digital Studio — Operations SOPs

Three runbooks in one file: client onboarding, security baseline, and incident/backup.

---

## SOP 1 — Client Onboarding (prospect → kickoff)

You already have all the tools; this is the sequence so it runs the same way every time.

1. **Prospect inquiry** — contact form or referral lands.
2. **Discovery call** — send them `start.html` (pre-call intake) first so the call is focused.
3. **Proposal** — send pricing/scope. Quote against the locked tiers in `SOP-approved-copy.md`.
   Decision rule: simple brochure site → Custom HTML ($6,500); they need a backend their own
   customers use (booking, portal, checkout) → Custom Platform (from $12,000); portal for
   working with YOU → add-on.
4. **Contract** — generate from the `DEFAULT_CONTRACT` template in the admin panel. Send for signature.
5. **Create the client** — admin panel → Add New Client → invite (they set their own password).
6. **Kickoff** — client fills the Project Brief in the portal. You review, set the timeline.
7. **Project close** — send the post-project survey (`project-survey.html`). Capture a testimonial.

Checklist per new client:
- [ ] Intake form sent before call
- [ ] Proposal sent
- [ ] Contract signed
- [ ] Client invited to portal
- [ ] Project brief received
- [ ] Timeline set
- [ ] Survey + testimonial requested at close

---

## SOP 2 — Security Baseline (don't regress these)

These are the decisions behind the current build. Re-check before any major change.

- **Secrets live in env, never in code.** Anthropic, Resend, service-role, PSI key all read
  from `Deno.env.get()`. The one historical exception (hardcoded PSI key) is now fixed.
- **CORS is an allowlist**, not `*`. Add new origins to `ALLOWED_ORIGINS` in the Edge Function.
- **Privileged routes require `x-dds-admin`.** Account creation/invite are admin-only.
- **Rate limiting is on** for all AI/PSI/reset routes (12/min/IP).
- **Anon key in frontend is fine** (it's public by design, protected by RLS). Service-role key
  must NEVER appear in any `.html` or `.js`.
- **Admin + portal pages are `noindex` + `no-store`.**
- **Source files (`.ts`, `.py`) and `_internal/` are 404-blocked** in `_redirects`.
- **Key rotation:** rotate the PSI key and the admin shared secret if either is ever exposed.

Quarterly check:
- [ ] No service-role key in any client file (`grep -rn "service_role" *.html *.js`)
- [ ] CORS allowlist still correct
- [ ] Spend caps still set on Anthropic + Google Cloud
- [ ] Supabase backups still running

---

## SOP 3 — Incident & Backup

**Backups (set up once):** Supabase → Database → Backups → enable scheduled backups, OR run a
weekly export. The portal holds real client data (briefs, messages, invoices) — losing it is
unrecoverable. Document where the export lands.

**If the site is down:** Netlify status → check latest deploy → roll back to the previous
deploy if a bad push caused it.

**If the Edge Function errors:** Supabase → Edge Functions → `clever-api` → Logs. Most likely
cause after a deploy is a missing secret (the function fails closed on missing
`ADMIN_SHARED_SECRET` or `SERVICE_ROLE_KEY`).

**If client data looks wrong/lost:** stop writes, restore from the most recent backup, verify
in a staging check before pointing clients back at it.

**Restore drill:** once, before you have many clients, do a test restore so you know it works.
