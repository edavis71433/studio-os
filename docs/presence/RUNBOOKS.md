# Presence Operational Runbooks (M6)

Procedures for operating client websites. Written for an operator who has never
seen the codebase. Everything here is done through the **presence function's
admin API** with a staff login — you never need the Netlify dashboard for
routine operations, and you never need direct database access.

**How to call the admin API.** Every call below is an HTTPS request to
`https://<project>.supabase.co/functions/v1/presence/<route>` with two headers:
`Authorization: Bearer <anon key>` and `x-dds-user-jwt: <your staff session token>`.
Your staff session token is what the Admin panel uses when you're signed in; when
the Presence screens land in the Admin panel these calls become buttons. Until
then, any HTTP client works.

- Production project: `qksstlqzbhesadrrofgn`
- Staging project: `wjlpursnwbmlcdwbeowv`
- All responses are JSON: `{"data": ...}` on success, `{"error", "message"}` on failure.
- Every message is plain language; `error_text` and deploy ids appear only in
  operator views, never to clients.

---

## 1. Creating a new customer (client → live website)

Provisioning is **idempotent**: running it twice never creates duplicates, and
rerunning it repairs a partial or broken state. There is exactly one site per
client (enforced by the database).

1. Make sure the client exists in Studio OS (you need their `client_id` uuid —
   visible in the Admin panel URL or the clients list).
2. Provision:
   ```
   POST /admin/sites
   { "client_id": "<uuid>" }
   ```
   Optional: `"template_slug"`, `"template_version"` (default `restaurant-classic@1.0.0`),
   `"entitlement_status"` (`active` default, or `paused`).
3. A successful response includes `netlify_url` (the site's permanent
   `https://presence-….netlify.app` address) and `status: "ready"`. The system
   has: created the hosting site, verified it exists, activated the Presence
   entitlement, and seeded the initial draft with the client's business name.
4. The site is NOT live yet — it has no published content. Fill in the draft
   (client via their portal/room, or operator), then publish:
   ```
   POST /admin/sites/<site_id>/publish
   ```
   If content is incomplete you get a `422` listing exactly what's missing, in
   plain language (e.g. "identity.business_name"). Fix and repeat.
5. Verify: open the `netlify_url`. Check `GET /admin/sites/<site_id>/health` —
   `hosting.connected` should be `true`, `publishing.last_successful_publish`
   set, `content.draft.blockers` 0.

**If provisioning fails partway:** just run step 2 again. It adopts whatever
already exists (site record, hosting, entitlement) and finishes the rest.
Nothing is ever left half-made.

---

## 2. Connecting a custom domain

Prereq: the client owns the domain and can edit its DNS (or you can, at their
registrar).

1. Attach the domain:
   ```
   POST /admin/sites/<site_id>/domain
   { "domain": "www.restaurantname.com" }
   ```
   The response tells you the DNS state immediately — normally
   `health: "dns_pending"` with the exact instruction, e.g.
   *"Set a CNAME for www.restaurantname.com to presence-abc123.netlify.app"*.
2. At the registrar, create that **CNAME** record (for an apex/root domain, an
   ALIAS/ANAME record to the same target, or an A record to `75.2.60.5`).
3. Wait for DNS to propagate (minutes to a few hours), checking:
   ```
   GET /admin/sites/<site_id>/domain
   ```
   `health` walks `dns_pending → ssl_pending → ok`. The HTTPS certificate is
   issued automatically once DNS points at the site; `ssl_pending` normally
   resolves within the hour.
4. Done when `health: "ok"`. The site now serves on the custom domain (the
   netlify.app address keeps working as a fallback).

**To remove a domain:** `DELETE /admin/sites/<site_id>/domain`. The site
immediately falls back to its netlify.app address; nothing else changes.

---

## 3. Recovering a failed publish

A failed publish **never** changes the live site — deploys are atomic; the live
site flips only when a deploy completes. So a failure means "the live site is
still the previous version", never "half-updated".

1. Look at what failed:
   ```
   GET /admin/sites/<site_id>/health
   ```
   `publishing.last_error.error_text` names the failing stage:
   - `config: …` — hosting not connected → run provisioning (Runbook 1).
   - `images: …` — a media variant failed → check the named image, re-upload it, or delete it from the draft.
   - `deploy: …` — the hosting provider hiccuped or the token is bad → see Runbooks 5/6.
   - `render/validate: …` — content problem; the message names the field.
2. Fix the cause, then retry **the exact same content** that failed:
   ```
   POST /admin/sites/<site_id>/retry
   ```
   (add `{ "publish_id": "<uuid>" }` to retry a specific older failure). Retry
   re-runs the retained snapshot through the same pipeline — nothing is
   re-serialized, so you retry exactly what was attempted.
3. Or publish fresh (picks up the current draft): `POST /admin/sites/<site_id>/publish`.
4. A publish stuck as `queued` (e.g. a crashed run) blocks new publishes
   (one-at-a-time rule). Clear it:
   ```
   POST /admin/sites/<site_id>/cancel
   ```
   Note: only *queued* publishes cancel. One already *deploying* completes or
   fails atomically on its own; give it a minute — history reconciles itself.

---

## 4. Restoring a site (two distinct tools)

**A. Instant restore (operational, seconds).** Flips the live site back to a
previous *deploy* at the host. Use when a publish shipped something wrong and
you need it gone NOW.

1. `GET /admin/sites/<site_id>/deploys` — pick the deploy to return to
   (they're newest-first with timestamps and titles like `publish <id>`).
2. ```
   POST /admin/restore-deploy
   { "site_id": "<uuid>", "deploy_id": "<id>" }
   ```
3. The live site flips within seconds. Note: this changes only what's served —
   the draft content in the database is unchanged, so the *next* publish
   publishes the current draft again.

**B. Snapshot restore (business recovery, ~a minute).** Re-publishes a retained
content *snapshot* through the full pipeline. Use to bring back an earlier
version of the client's content as the live site.

1. Find the version: `GET /admin/sites/<site_id>/publishes` — restorable rows
   have a `snapshot_id`.
2. ```
   POST /admin/sites/<site_id>/restore-snapshot
   { "snapshot_id": "<uuid>" }
   ```
   (Clients can do the same for their own site with `POST /restore
   { "publish_id": … }` from their portal.)
3. This runs the normal pipeline (validate → render → deploy) and writes
   history + provenance like any publish. A `410` means the snapshot has aged
   out of retention — use an instant restore (A) instead.

---

## 5. Rotating Netlify credentials

The Netlify token exists in exactly ONE place per environment: the presence
function secret `NETLIFY_AUTH_TOKEN`. It is never in the repo, never in a
build, never client-side.

1. Create the new token: app.netlify.com → avatar → User settings →
   Applications → Personal access tokens → **New access token** (name it e.g.
   `presence-publisher-2026-08`; prefer no expiration — rotation is this
   runbook, not an expiry surprise).
2. Set it (both environments):
   ```
   supabase secrets set NETLIFY_AUTH_TOKEN=<new token> --project-ref qksstlqzbhesadrrofgn
   supabase secrets set NETLIFY_AUTH_TOKEN=<new token> --project-ref wjlpursnwbmlcdwbeowv
   ```
   Edge functions pick up new secrets within moments; no redeploy needed.
3. Verify: `GET /admin/sites/<any site>/health` → `hosting.connected: true`.
   (With a bad token this shows a hosting lookup failure, and publishes fail
   at the `deploy:` stage with a 401 in the operator error text.)
4. Revoke the old token in the same Netlify screen.
5. If the token was ever exposed (pasted somewhere public, in a log), do steps
   1–4 immediately and check the Netlify audit log for unfamiliar deploys.

---

## 6. Recovering from a Netlify outage

Symptoms: publishes fail at the `deploy:` stage across MULTIPLE sites at once,
or health shows hosting lookup failures for everyone. Check
https://www.netlifystatus.com first.

**During the outage:**
- Already-published sites almost always keep serving (Netlify's CDN degrades
  separately from its API). Do nothing for live sites.
- Publishes will fail cleanly and clients see the calm message ("nothing
  changed on your live site" — true, by design). No action needed per-site.
- Do NOT retry in a loop; wait for the status page to clear.

**After the outage:**
1. For each site that failed during the window, run:
   ```
   POST /admin/sites/<site_id>/retry
   ```
   which re-publishes the exact snapshot that failed. Affected sites are easy
   to list: `GET /admin/sites`, then check `/publishes` for `failed` rows in
   the window.
2. A publish that was mid-flight when the outage hit either completed (history
   reconciles it to `live` automatically on the next `/publishes` read) or
   shows `failed` — retry those.
3. If a Netlify *site* was lost entirely (extremely unlikely), health shows
   **HOSTING DISCONNECTED**. Rerun provisioning (Runbook 1) — it recreates or
   re-adopts hosting on the same deterministic name — then
   `POST /admin/sites/<site_id>/publish` to restore content from the draft, or
   restore-snapshot for a specific version. DNS records don't change (the
   netlify.app name is preserved), so custom domains come back with it.

---

## Appendix: lifecycle states

`draft → provisioning → ready → live ⇄ paused → archived → deleting`

Transition with `POST /admin/sites/<site_id>/lifecycle { "to": "<state>" }`.
Illegal moves are rejected with the allowed list. Notes:
- **paused**: clients can't publish (they see "contact your studio"); operators
  still can (force publish). Use for billing disputes or content emergencies.
- **archived**: nobody can publish; hosting keeps serving the last version.
  Reactivate with `{ "to": "ready" }`.
- **deleting**: removes the hosting site immediately (live site goes away);
  content, snapshots, history and provenance are retained in the database
  forever (append-only by design). Terminal — a client needing a site again
  gets fresh provisioning only after support review.
