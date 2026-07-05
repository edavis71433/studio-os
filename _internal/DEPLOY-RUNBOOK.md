# Davis Digital Studio — Deploy Runbook & Post-Change Punch List

This file lives in `_internal/` and is blocked from public serving. It is your single
source of truth for deploying and for the dashboard steps I could not do for you.

---

## PART 1 — What changed in this pass (already done in the files)

### Edge Function (`_internal/clever-api-COMPLETE.ts`) — deploy this as `clever-api`
- **CORS locked down.** `Access-Control-Allow-Origin: '*'` replaced with an allowlist
  (`davisdigitalstudio.com` + `www`). Per-request CORS via `corsFor(req)`.
- **Privileged actions gated.** `create_client_auth` and `invite_client` now require an
  `x-dds-admin` header that must equal the `ADMIN_SHARED_SECRET` secret. Requests without
  it get `401 unauthorized`. Fails closed if the secret is unset.
- **Rate limiting added.** `psi_fetch`, `deep_audit`, `ai_critique`, `ai_critique_email`,
  `concierge`, and `reset_password` are capped at 12 requests/minute per IP (`429` over that).
- **PSI key moved to env.** `PSI_KEY` now reads `Deno.env.get('PSI_KEY')` instead of being
  hardcoded.
- **`reset_password` intentionally left client-callable** (portal "forgot password"), since
  Supabase only emails the real account owner — but it is rate-limited.

### Admin panel (`dds-studio-manage-9k2p.html`)
- Added `const ADMIN_SECRET = "REPLACE_WITH_YOUR_SECRET";` near the SB config.
- Both privileged calls now send `"x-dds-admin": ADMIN_SECRET`.

### Repo hygiene
- Deleted duplicate `clever-api-index.ts` (canonical is `clever-api-COMPLETE.ts`).
- Moved internal docs to `_internal/` and added a `/_internal/*` 404 rule in `_redirects`.

---

## PART 2 — What YOU must do for these fixes to work (dashboard steps)

> The security fix is INERT until you do the steps below. Steps 1 and 2 are ALREADY DONE
> for you — your secret has been generated and placed in the admin panel. You just need
> Steps 3–6.

### ✅ Step 1 — DONE: secret generated
Your shared secret is:
```
71377f613a8ab6077cb4fcfba68cfc3018c1fb8df1cdc9abf6101a4d207af004
```

### ✅ Step 2 — DONE: secret placed in the admin panel
`dds-studio-manage-9k2p.html` already contains this secret (no action needed):
```
const ADMIN_SECRET = "71377f613a8ab6077cb4fcfba68cfc3018c1fb8df1cdc9abf6101a4d207af004";
```

### Step 3 — Put the SAME secret in Supabase (this is the part you do)
Supabase Dashboard → Project → Edge Functions → `clever-api` → Secrets (or Settings →
Edge Functions → Secrets). Add/confirm:
- `ADMIN_SHARED_SECRET` = `71377f613a8ab6077cb4fcfba68cfc3018c1fb8df1cdc9abf6101a4d207af004`
- `PSI_KEY` = your PageSpeed API key (use the NEW rotated key from Step 4)
- `ANTHROPIC_KEY`, `RESEND_KEY`, `SERVICE_ROLE_KEY`, `SUPABASE_URL` — confirm still set

> Both sides now hold the same key. If you ever get an "unauthorized" error when adding a
> client, it means the value in Supabase and the value in the admin file don't match exactly.

### Step 4 — Rotate the PageSpeed key (it was previously hardcoded/exposed)
Google Cloud Console → APIs & Services → Credentials → find the PageSpeed key →
either regenerate it or delete and create a new one → restrict it to the PageSpeed
Insights API → paste the new value into the `PSI_KEY` secret in Step 3.

### Step 5 — Deploy
1. Deploy the Edge Function first:
   `supabase functions deploy clever-api` (point it at `_internal/clever-api-COMPLETE.ts`,
   or copy that file to your functions directory first).
2. Then push the site files to Netlify (one batched deploy).
   - Deploy order matters: function first so the new admin header has something to talk to.

### Step 6 — Smoke test after deploy
- [ ] Load the homepage — no console errors.
- [ ] Run the AI critique tool once — returns a result (proves rate-limit path + CORS OK).
- [ ] In the admin panel, add a test client — the invite/create works (proves the
      `x-dds-admin` header matches the secret). If you get "unauthorized," the secret in
      the admin panel and the Supabase secret don't match.
- [ ] Submit the contact form — still works.
- [ ] Open the AI tool's network tab from a different site/origin — should be blocked by CORS.

---

## PART 3 — Remaining items I could NOT do from here (your hands needed)

| Item | Where | Why it's yours |
|---|---|---|
| C3 — Search Console verify | search.google.com/search-console | Needs your Google login; paste the meta token into `index.html` `<head>` and I can wire it, or just use DNS verification |
| H2 — Anthropic spend cap | console.anthropic.com → Billing → Limits | Dashboard-only |
| H2 — PSI key restriction | Google Cloud Console | Dashboard-only (Step 4 above) |
| H4 — Supabase backups | Supabase → Database → Backups | Toggle scheduled backups / set up weekly export |
| M4 — Uptime monitor | e.g. a free uptime service | External signup; ping homepage + the Edge Function |
| M5 — Accessibility contrast pass | Lighthouse/axe on the live site | Run against the deployed URL and save the report |

When you've done Step 1–5, tell me and we can knock out C3 (I'll give you the exact meta
tag to drop in) and the remaining SOPs.
