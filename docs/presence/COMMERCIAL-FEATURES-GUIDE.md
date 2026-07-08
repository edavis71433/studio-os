# Commercial Features — Guide

*Phase F. The customer/operator-facing commercial features. Sections double as the Publishing, Preview, Forms, SEO, CRM-Integration, and Notification guides.*

---

## Publishing Guide (incl. scheduling)

- **Publish now:** edit a draft → preview → publish. One calm step; every publish is a restorable version; the live site never changes until you publish.
- **Schedule a publish (FD-1):** `POST /schedule {scheduled_for, note}` freezes the **current draft** into a snapshot and queues it — so "publish the holiday hours at 6am Friday" is set-and-forget. `GET /schedule` lists pending; `POST /schedule/:id/cancel` cancels.
- **Content expiry / revert:** `POST /schedule {kind:'revert', publish_id, scheduled_for}` schedules a restore of a chosen prior version — a promo that retires itself.
- **How it fires:** the scheduler (`/system/run`, cron) runs `runDuePublishes` each tick, claiming due rows atomically and running the **same** publish pipeline as a manual publish. No second path. Failures are recorded and alert-emailed.

## Preview Guide

- **Pixel-perfect:** `/preview` renders through `renderSnapshot` — the exact renderer publish uses, including the Developer-Mode layer (Phase B1). Preview differs from production only by unpublished changes.
- **Versions:** `?version=live` or `?publish_id=` previews any retained snapshot; `?version=draft` (default) shows current edits.
- **Publish readiness:** `validateSnapshot` blockers/warnings ride in the preview response headers and the room, so a customer sees what needs fixing before publishing.
- *Shareable no-login preview links are V1.1 (FD-6).*

## Forms Guide (lead capture)

- **Activation:** when a site publishes, its contact page renders a real `<form>` posting to the public capture endpoint (was a mailto CTA before).
- **Submit:** `POST /forms/:siteId/submit` (public) accepts `{form_kind: contact|quote|booking, name, email, phone, message, fields, _hp}`. Validation requires an email or phone; a filled honeypot (`_hp`) marks spam silently (the bot still gets a 200). Every field is length-capped; control characters stripped; no raw IP stored (salted hash for abuse only).
- **Inbox:** `GET /forms/inbox` (owner) lists submissions with an unread count; `POST /forms/inbox/:id {status}` marks read/archived.
- **CRM:** every non-spam lead appears in the relationship timeline as a shared `lead` item.
- **Notify:** the owner is emailed best-effort on each lead (needs `RESEND_KEY`).

## SEO Guide

The template already produces, from the structured snapshot:
- `<meta name="description">`, **canonical** URLs, **Open Graph** (title, description, image, type, url, site_name), Twitter (covered by OG), and **structured data** (`application/ld+json`).
- **`sitemap.xml`** and **`robots.txt`** as published files.
- **Redirect management** via `presence_redirects` (carried in the snapshot, applied at publish).

SEO is thus deterministic and non-technical: a customer edits business facts; correct metadata follows. No per-page meta editing is required (or exposed) — the structured model guarantees it. *(Per-page meta overrides, if ever needed, would be a template/SDK feature, not a runtime editor.)*

## CRM Integration Guide

The relationship timeline (`/crm/timeline`) aggregates, in one calm feed: publishes, content changes, connected events, Business Moments, pending approvals, relationship notes, **and now leads** (FD-2). Leads are shared items (the client's own inbound), so both studio and client see them. The CRM is the one place the relationship — including new inbound — is legible.

## Notification Guide

- **One-tap approval (FD-3):** `POST /approve/send` (owner/operator) emails the client a focused one-tap link per pending approval — a stateless HMAC-signed token (one-week expiry, no table). The client taps → `approve.html` shows the item → approve/reject applies through the existing approval spine. The token authorizes exactly one decision on one plan and fails closed (bad/expired/tampered → refused).
- **Lead notifications:** best-effort email to the owner per non-spam lead.
- **Operational alerts:** scheduled-publish failures email the ops address (existing scheduler alerting).
- All email is via `sendEmail` (Resend) and degrades gracefully when `RESEND_KEY` is unset — the platform never breaks pre-activation; one-tap returns a clear 503 until `APPROVAL_SECRET`/`SCHEDULER_SECRET` is set.

---

*See also: [PHASE-F-COMMERCIAL-READINESS](PHASE-F-COMMERCIAL-READINESS.md) (report, matrix, final questions), [DEPLOYMENT-AND-OPERATIONS](DEPLOYMENT-AND-OPERATIONS.md) (cron + secrets), [CRM-GUIDE](CRM-GUIDE.md).*
