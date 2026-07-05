# Davis Digital Studio — Admin Panel & Client Portal QA

Reviewed: admin panel (`dds-studio-manage-9k2p.html`) and client portal (`portal.html`).
Findings are ordered by severity. Each one says what's wrong, why it matters, and the fix.

---

## Critical — these break real functionality

### 1. New client creation is broken (admin panel)
**Where:** `createClient()` in the admin panel.
**What:** It creates the client's login by calling Supabase's admin endpoint `/auth/v1/admin/users` directly from the browser, using your public anon key. The anon key is not permitted to call admin endpoints, so Supabase rejects the request. The function stops at "Auth error" and no client gets created.
**Why it matters:** The moment you try to add a second client through the panel, it fails. Bacchus probably works only because that account was made directly in Supabase, not through this button.
**Fix:** Move user creation into your `clever-api` Edge Function, which can safely hold the `service_role` key server-side. The browser calls the Edge Function; the Edge Function creates the auth user. Never put the service_role key in the HTML. (Step-by-step in the "What to do" section below.)

### 2. Feedback form silently fails (client portal)
**Where:** `submitFeedback()` vs the feedback form fields.
**What:** The function reads `document.getElementById("fbSubject")` and `"fbText"`, but the actual form fields are `id="fb-subject"` and `id="fb-text"` (with hyphens). The IDs don't match, so `.value` throws on a null element and the submit handler dies. A client filling out feedback clicks Submit and nothing happens.
**Why it matters:** A core portal feature looks fine but is dead for the client.
**Fix:** Make the IDs match. Either rename the form fields to `fbSubject`/`fbText`, or change the function to read `fb-subject`/`fb-text`. (I can do this for you — see below.)

---

## High — duplication and data-integrity issues

### 3. Four identical copies of the same functions (client portal)
**Where:** `submitFeedback`, `loadFeedback`, `submitBrief`, `initContract`, and `var fbPriority` are each defined four times (around lines 26, 193, 360, 1917). The four copies are byte-for-byte identical.
**What:** In JavaScript the last definition wins, so the earlier three are dead weight. It also means a past edit got pasted repeatedly instead of replacing.
**Why it matters:** It bloats the file, and it's a trap: if you ever edit one copy thinking you fixed something, the real (last) copy still runs the old code. This is almost certainly how the `fb-subject` bug above survived.
**Fix:** Delete the duplicate copies, keep one clean version of each.

### 4. Contract acknowledgment only saved to localStorage (client portal)
**Where:** `initContract()` — `localStorage.setItem("contract_acked_" + CLIENT.id, date)`.
**What:** When a client acknowledges the contract, it's recorded only in their browser's localStorage, not in Supabase. You added a `contract_acked_at` column to the clients table in an earlier session, but the portal never writes to it.
**Why it matters:** If the client clears their browser, switches devices, or you check from the admin side, there's no record they ever agreed. For a legal agreement, that's a real gap.
**Fix:** On acknowledgment, also write `contract_acked_at` to the client's row in Supabase. Then the admin Client Hub can show contract status truthfully.

---

## Medium — security and robustness

### 5. Admin password is a client-side check
**Where:** `doLogin()` compares a hash of the typed password to `PASS_HASH` baked into the HTML.
**What:** The "login" only hides and shows page sections. Anyone who views source can see the structure, and more importantly the admin page loads all its Supabase calls with the anon key regardless of login. The password doesn't actually protect the data; Supabase Row Level Security (RLS) does.
**Why it matters:** It's fine as a convenience lock so the page doesn't sit open, but don't treat it as real security. The thing actually protecting client data is your RLS policies on the tables. Worth confirming RLS is enabled and correct on every table (clients, messages, files, invoices, approvals, timeline, audit_leads).
**Fix:** Keep the password gate for convenience, but verify RLS is on for all tables so the anon key can't read or write across clients. This is the real protection.

### 6. No error handling on several portal data loads
**Where:** Various `await sb.from(...).select()` calls assign `data` and use it without checking for the error case.
**What:** If a query fails (network blip, RLS rejection), the code often proceeds as if it got empty data, so the client sees an empty section rather than a "couldn't load" state.
**Why it matters:** Hard to diagnose later, and a client might think their files vanished.
**Fix:** Low priority, but adding simple error toasts on the main loads makes the portal feel sturdier.

---

## Low — cleanup

### 7. Stale error copy
The portal login error still reads "Incorrect username or password" though the field is now Email. Minor wording.

### 8. One leftover `console.log` in the portal
Harmless, but worth removing before it multiplies.

### 9. `lf-speed_test` / `lf-local_visibility` lead filters
These buttons assume the `tool` column uses those exact strings. Worth confirming your Edge Function writes `tool` values that match (`speed_test`, `local_visibility`, `pricing_estimator`, `audit`) or the filters show nothing.

---

## What's solid (no action needed)
- Auth itself (`signInWithPassword`) is done correctly — passwords hashed server-side by Supabase, no plaintext stored in the clients table.
- Storing feedback and project briefs as tagged messages in the `messages` table is a clean, sensible design.
- Message polling cleans up its interval properly (`clearInterval` before re-setting).
- Both files use the anon key (not service_role) for normal data — correct and safe.
- The new Client Hub reads existing tables correctly and added no new schema needs.

---

## Priority order to fix
1. **#1 createClient** — needed before you onboard client #2.
2. **#2 + #3 feedback bug + duplicates** — quick win, restores a dead feature.
3. **#4 contract_acked_at** — closes the legal-record gap.
4. **#5 confirm RLS** — verify your data is actually protected.
5. The rest is polish.
